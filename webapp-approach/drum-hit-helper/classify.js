// Drum-onset classifier — native Web Audio, fully offline, no dependencies.
//
// Detects kick / snare / hi-hat onsets from a MIXED track by splitting it into
// three frequency bands and peak-picking the energy flux in each. The band *is*
// the classifier: a transient in the low band is a kick, high band a hi-hat, mid
// band a snare.
//
// This is a DRAFT detector built for review, NOT a transcriber. Cymbals, busy
// guitars and vocal sibilance bleed across bands, so expect false positives and
// misses — the whole point of the prototype is to SEE how well raw band energy
// lines up with what you actually hear, before investing in anything heavier
// (stem separation, ML). Everything runs in the browser on an uploaded file.

// Each lane: a band-pass-ish filter + a per-voice refractory (min gap between
// hits — hats can be fast 16ths, kick/snare can't).
export const BANDS = [
  { id: 'hh', name: 'hi-hat', color: '#5ad1ff', type: 'highpass', freq: 7000, q: 0.7, refractoryMs: 40 },
  // Snare also carries a `crack` band: a real snare slaps a broadband noise burst
  // in the high-mids at the same instant as the low body thump. Bass notes and
  // sung vowels have the body energy but NO crack, so we keep a snare onset only
  // when the body hit coincides with a crack transient — the big false-positive
  // cut on a dense mix.
  {
    id: 'sd', name: 'snare', color: '#ffd166', type: 'bandpass', freq: 250, q: 1.1, refractoryMs: 90,
    crack: { type: 'bandpass', freq: 3000, q: 0.7 },
  },
  { id: 'bd', name: 'kick', color: '#ff6b9d', type: 'lowpass', freq: 110, q: 0.7, refractoryMs: 90 },
];

const HOP = 512; // analysis hop in samples (~11.6ms @ 44.1k)
const WIN = 1024; // RMS window in samples

/** Decode an uploaded File/Blob into an AudioBuffer (works for audio files and
 *  the audio track of most video files in Chrome). Offline context → no autoplay
 *  gesture needed, and a fixed 44.1k rate keeps the analysis consistent. */
export async function decodeFile(file) {
  const bytes = await file.arrayBuffer();
  const ctx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 1, 44100);
  return await ctx.decodeAudioData(bytes);
}

/** Render one frequency band of the buffer to a mono Float32Array. Two filter
 *  stages in series ≈ 24 dB/oct, which tightens the band and cuts bleed. The
 *  mono (1-channel) offline context auto-downmixes a stereo source. */
async function renderBand(buffer, band) {
  const ctx = new OfflineAudioContext(1, buffer.length, buffer.sampleRate);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const f1 = ctx.createBiquadFilter();
  const f2 = ctx.createBiquadFilter();
  for (const f of [f1, f2]) {
    f.type = band.type;
    f.frequency.value = band.freq;
    f.Q.value = band.q;
  }
  src.connect(f1);
  f1.connect(f2);
  f2.connect(ctx.destination);
  src.start();
  const out = await ctx.startRendering();
  return out.getChannelData(0);
}

/** A per-hop RMS energy envelope of a signal. env[h] is the loudness around
 *  time (h*HOP + WIN/2) / sampleRate seconds. */
function envelope(data) {
  const hops = Math.max(0, Math.floor((data.length - WIN) / HOP) + 1);
  const env = new Float32Array(hops);
  for (let h = 0; h < hops; h++) {
    const start = h * HOP;
    let sum = 0;
    for (let i = 0; i < WIN; i++) {
      const s = data[start + i];
      sum += s * s;
    }
    env[h] = Math.sqrt(sum / WIN);
  }
  return env;
}

/** Peak-pick onsets from an energy envelope.
 *  - positive log-flux (level-robust rise detection)
 *  - adaptive threshold = local-mean-flux × k, scaled by `sensitivity`
 *  - an absolute gate (ignore hits in near-silent stretches)
 *  - a refractory period so one hit isn't counted several times
 *  Returns onset times in seconds. Pure + fast, so the UI re-runs this live on
 *  the cached envelope when you move the sensitivity slider (no re-decode). */
export function pickOnsets(env, sampleRate, opts = {}) {
  const { sensitivity = 1, refractoryMs = 60 } = opts;
  const n = env.length;
  if (n < 3) return [];
  const hopSec = HOP / sampleRate;
  const offSec = WIN / 2 / sampleRate;

  let max = 0;
  for (let i = 0; i < n; i++) if (env[i] > max) max = env[i];
  // Energy gate relative to this band's OWN peak — the key discriminator. A
  // transient that merely leaks from another band (a kick bleeding into the
  // hi-hat band, a snare attack into the kick band) sits far below that band's
  // real hits, so a firm gate keeps the lanes distinct instead of every lane
  // firing on every drum. Sensitivity lowers the gate to catch softer hits.
  const gate = max * Math.min(0.6, 0.22 / sensitivity);

  const flux = new Float32Array(n);
  for (let i = 1; i < n; i++) {
    const d = Math.log(env[i] + 1e-6) - Math.log(env[i - 1] + 1e-6);
    flux[i] = d > 0 ? d : 0;
  }

  const W = 20; // ±20 hops (~±0.23s) local-mean window
  const refractory = refractoryMs / 1000;
  const onsets = [];
  let lastT = -Infinity;
  for (let i = 1; i < n - 1; i++) {
    if (env[i] < gate) continue;
    let sum = 0;
    const a = Math.max(0, i - W);
    const b = Math.min(n - 1, i + W);
    for (let j = a; j <= b; j++) sum += flux[j];
    const localMean = sum / (b - a + 1);
    const thr = (localMean * 3 + 0.03) / sensitivity; // more sensitivity → lower bar
    if (flux[i] > thr && flux[i] >= flux[i - 1] && flux[i] > flux[i + 1]) {
      const t = i * hopSec + offSec;
      if (t - lastT >= refractory) {
        onsets.push(t);
        lastT = t;
      }
    }
  }
  return onsets;
}

/** Is there a crack transient (a sharp rise in the high-mid band) near time `t`?
 *  A snare has one; a bass note or vowel in the body band does not. We test the
 *  crack band's positive log-flux in a small window around the body onset, so a
 *  SUSTAINED high-mid source (a held guitar chord) — high energy but no rise —
 *  doesn't count, only a transient does. Sensitivity loosens the bar. */
function crackPresent(crackEnv, t, sampleRate, sensitivity) {
  const h = Math.round((t * sampleRate - WIN / 2) / HOP);
  const fluxThr = 0.15 / sensitivity;
  for (let k = h - 2; k <= h + 3; k++) {
    if (k < 1 || k >= crackEnv.length) continue;
    const flux = Math.log(crackEnv[k] + 1e-6) - Math.log(crackEnv[k - 1] + 1e-6);
    if (flux > fluxThr) return true;
  }
  return false;
}

/** (Re)pick a lane's onsets from its cached envelope(s) at a given sensitivity.
 *  For a plain band that's just the body pick; for the snare (which has a cached
 *  crack envelope) it additionally requires a coincident crack transient. Pure +
 *  fast, so the UI calls it live on every threshold-slider move. */
export function repick(lane, sampleRate, sensitivity) {
  const base = pickOnsets(lane.env, sampleRate, { sensitivity, refractoryMs: lane.refractoryMs });
  if (!lane.crackEnv) return base;
  return base.filter((t) => crackPresent(lane.crackEnv, t, sampleRate, sensitivity));
}

/** Collapse near-duplicate times (keep the first of each cluster). */
function mergeTimes(times, tol) {
  const s = [...times].sort((a, b) => a - b);
  const out = [];
  for (const t of s) {
    if (out.length && t - out[out.length - 1] <= tol) continue;
    out.push(t);
  }
  return out;
}

/** Full pass: decode is done by the caller; here we band-split + envelope +
 *  pick. Keeps each band's envelope(s) so sensitivity can be retuned without the
 *  (slow) band rendering. Also returns `candidates`: every percussive transient,
 *  any band, at a low threshold — the "potential places" that hand-editing snaps
 *  to (could be a kick, snare or hat, even low-confidence). */
export async function analyze(buffer, { sensitivity = 1 } = {}) {
  const sampleRate = buffer.sampleRate;
  const lanes = [];
  for (const band of BANDS) {
    const env = envelope(await renderBand(buffer, band));
    const crackEnv = band.crack ? envelope(await renderBand(buffer, band.crack)) : null;
    const lane = { ...band, env, crackEnv, onsets: [] };
    lane.onsets = repick(lane, sampleRate, sensitivity);
    lanes.push(lane);
  }
  const cand = [];
  for (const l of lanes) {
    for (const t of pickOnsets(l.env, sampleRate, { sensitivity: 2.0, refractoryMs: 40 })) cand.push(t);
  }
  const candidates = mergeTimes(cand, 0.05);
  return { duration: buffer.duration, sampleRate, hop: HOP, lanes, candidates };
}
