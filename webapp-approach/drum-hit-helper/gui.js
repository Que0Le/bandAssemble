// Drum-hit helper — review + edit GUI.
// Upload a media file → decode + analyze on upload → a lane timeline
// (hi-hat / snare / kick) with a playhead locked to the <video>. Each lane has a
// live threshold slider; you can hand-edit hits (double-click), tap them in from
// the keyboard, and map an uploaded .lrc onto a timed lyric track.

import { analyze, repick, decodeFile } from './classify.js';
import { estimateTempo, toDrumTab } from './drumtab.js';

const $ = (id) => document.getElementById(id);
const file = $('file');
const lrcInput = $('lrc');
const video = $('video');
const status = $('status');
const zoom = $('zoom');
const zoomVal = $('zoomVal');
const gutter = $('gutter');
const scroll = $('scroll');
const content = $('content');
const ph = $('ph');
const pp = $('pp');
const seek = $('seek');
const tcur = $('tcur');
const tdur = $('tdur');
const candtog = $('candtog');
const karaoke = $('karaoke');
const bpm = $('bpm');
const grid = $('grid');
const offsetInput = $('offset');
const copytab = $('copytab');
const dltab = $('dltab');
const tabout = $('tabout');
const manualonly = $('manualonly');
const septracks = $('septracks');
const clearMediaBtn = $('clearmedia');
const clearLrcBtn = $('clearlrc');
const lrcoffset = $('lrcoffset');
const loopbtn = $('loopbtn');
const setAbtn = $('setA');
const setBbtn = $('setB');
const clearabBtn = $('clearab');
const repeatbtn = $('repeatbtn');
const resetEditsBtn = $('resetedits');
const barstog = $('barstog');
const abreadout = $('abreadout');

const AXIS_H = 22;
const LANE_H = 64;
const LYRIC = { id: 'ly', name: 'lyric', color: '#b6a6ff', lyric: true };

let state = null; // { duration, sampleRate, lanes:[...], candidates:[...] }
let lyricsRaw = null; // parsed .lrc at its original times, or null
let lyrics = null; // lyricsRaw shifted by the LRC offset (what everything renders), or null
let pxPerSec = Number(zoom.value);
let mediaUrl = null;
let mediaName = '';
let raf = 0;
let loopA = null, loopB = null, looping = false; // A–B range (seconds) + loop state

const fmt = (t) => {
  if (!isFinite(t)) t = 0;
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
};
const near = (t, arr, tol) => {
  for (const x of arr) if (Math.abs(x - t) <= tol) return x;
  return null;
};
// Musical grid, shared with the drum-tab panel (BPM + Start offset). Used for the
// bar overlay, A/B snapping, and the grid-locked pattern repeat.
const beatDur = () => 60 / (Number(bpm.value) || 120);
const barDur = () => 4 * beatDur();
const gridOffset = () => Number(offsetInput.value) || 0;
const snapToBar = (t) => { const bd = barDur(); return Math.max(0, gridOffset() + Math.round((t - gridOffset()) / bd) * bd); };
// Which rows are drawn: the detected lanes, plus the lyric row when loaded.
const rows = () => (lyrics ? [...state.lanes, LYRIC] : state.lanes);
const countsText = () => state.lanes.map((l) => `${l.onsets.length} ${l.name}`).join(' · ');
// A lane's gutter count: hit total + an "✎N" marker once it has manual edits.
const countLabel = (l) =>
  l.lyric
    ? `${lyrics.length}`
    : manualonly.checked
      ? `${l.added.length} ✎`
      : `${l.onsets.length}${l.editCount ? ` ✎${l.editCount}` : ''}`;
// Escape .lrc text before it goes into innerHTML.
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---- upload media → analyze ----------------------------------------------

file.addEventListener('change', async () => {
  const f = file.files && file.files[0];
  if (!f) return;
  if (mediaUrl) URL.revokeObjectURL(mediaUrl);
  mediaUrl = URL.createObjectURL(f);
  mediaName = f.name.replace(/\.[^.]+$/, '');
  video.src = mediaUrl;

  state = null;
  content.innerHTML = '';
  content.appendChild(ph);
  gutter.innerHTML = '';
  setStatus(`decoding “${f.name}”…`, 'work');
  try {
    const t0 = performance.now();
    const buffer = await decodeFile(f);
    setStatus('analysing bands…', 'work');
    await new Promise((r) => setTimeout(r, 20));
    state = await analyze(buffer, { sensitivity: 1 });
    for (const l of state.lanes) {
      l.sens = 1;
      l.auto = l.onsets; // detection result
      l.added = []; // hand-added times (survive re-pick)
      l.removed = []; // detected hits the user deleted
    }
    const ms = Math.round(performance.now() - t0);
    buildGutter();
    drawPlot();
    seedTab();
    setStatus(`done in ${ms} ms · ${countsText()} · ${fmt(state.duration)} long`, 'ok');
  } catch (err) {
    console.error(err);
    setStatus(`couldn't decode that file — ${err.message || err}`, 'bad');
  }
});

function setStatus(msg, kind) {
  status.textContent = msg;
  status.className = 'status' + (kind ? ' ' + kind : '');
}

// ---- edit model: displayed = (auto − removed) ∪ added, matched by proximity --

function recompute(l) {
  const tol = 0.05;
  const kept = l.auto.filter((a) => near(a, l.removed, tol) === null);
  const all = [...kept, ...l.added].sort((a, b) => a - b);
  const out = [];
  for (const t of all) {
    if (out.length && t - out[out.length - 1] <= 0.02) continue; // de-dupe
    out.push(t);
  }
  l.onsets = out;
  l.editCount = l.added.length + l.removed.length;
}

// snap a free time to the nearest candidate within tol, else keep it
function snap(t) {
  if (!state.candidates.length) return t;
  const win = Math.max(0.12, 7 / pxPerSec);
  let best = null, bd = win;
  for (const c of state.candidates) {
    const d = Math.abs(c - t);
    if (d <= bd) { bd = d; best = c; }
  }
  return best === null ? t : best;
}

function addHit(l, t) {
  const place = snap(t); // snaps to the nearest candidate if close, else the exact time
  if (near(place, l.onsets, Math.max(0.03, 4 / pxPerSec)) !== null) return; // already one here
  const rem = near(place, l.removed, 0.05);
  if (rem !== null) l.removed = l.removed.filter((x) => x !== rem); // un-delete a detected hit
  else l.added.push(place);
  recompute(l);
}

function toggleAt(l, t) {
  const tol = Math.max(0.04, 7 / pxPerSec);
  const hit = near(t, l.onsets, tol);
  if (hit !== null) {
    // remove: drop a manual add, or mark a detected hit deleted
    const added = near(hit, l.added, 0.02);
    if (added !== null) l.added = l.added.filter((x) => x !== added);
    else l.removed.push(hit);
    recompute(l);
  } else {
    addHit(l, t); // snaps to a candidate if close, else free-places (your choice)
  }
}

// ---- gutter (per-lane threshold sliders; lyric row has none) --------------

function buildGutter() {
  let g = `<div class="grow axis-spacer"></div>`;
  for (const l of rows()) {
    g += `<div class="grow" style="height:${LANE_H}px">
      <div class="gtop">
        <span class="dot" style="background:${l.color}"></span>
        <span class="nm">${l.name}</span>
        <span class="ct" id="ct-${l.id}" style="color:${l.color}">${countLabel(l)}</span>
      </div>
      ${
        l.lyric
          ? `<span class="gnote">from .lrc · timed</span>`
          : `<input class="lsens" id="s-${l.id}" type="range" min="0.3" max="3" step="0.1" value="${l.sens}"
               title="${l.name} threshold — right = more hits" />`
      }
    </div>`;
  }
  gutter.innerHTML = g;
  for (const l of state.lanes) {
    const slider = $(`s-${l.id}`);
    slider.addEventListener('input', () => {
      l.sens = Number(slider.value);
      l.auto = repick(l, state.sampleRate, l.sens);
      recompute(l); // re-apply manual edits on top
      refreshCount(l);
      queueDraw();
      renderTab();
      setStatus(`${countsText()} · tuning — drag a lane slider`, 'ok');
    });
  }
}

function refreshCount(l) {
  const el = $(`ct-${l.id}`);
  if (el) el.textContent = countLabel(l);
}

// ---- plot -----------------------------------------------------------------

let drawQueued = false;
function queueDraw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => { drawQueued = false; drawPlot(); });
}

function drawPlot() {
  if (!state) return;
  const list = rows();
  const width = Math.max(scroll.clientWidth, Math.ceil(state.duration * pxPerSec));
  const height = AXIS_H + list.length * LANE_H;
  content.style.width = width + 'px';
  content.style.height = height + 'px';

  let html = '';
  if (barstog.checked && Number(bpm.value) > 0) {
    // bar-grid overlay from BPM + Start: bar lines (bright, numbered) + beats (faint)
    const off = gridOffset(), bd = beatDur();
    for (let i = 0, t = off; t <= state.duration + 1e-6; i++, t = off + i * bd) {
      if (t < 0) continue;
      const x = t * pxPerSec;
      const isBar = i % 4 === 0;
      html += `<div class="grid ${isBar ? 'bar' : 'beat'}" style="left:${x.toFixed(1)}px;height:${height}px"></div>`;
      if (isBar) html += `<div class="barlab" style="left:${(x + 2).toFixed(1)}px">${i / 4 + 1}</div>`;
    }
  } else {
    const step = pxPerSec >= 80 ? 1 : pxPerSec >= 40 ? 2 : 5;
    for (let s = 0; s <= state.duration; s += step) {
      const x = s * pxPerSec;
      const major = s % 5 === 0;
      html += `<div class="grid${major ? ' major' : ''}" style="left:${x}px;height:${height}px"></div>`;
      if (major) html += `<div class="axlab" style="left:${x + 3}px">${fmt(s)}</div>`;
    }
  }
  if (loopA != null && loopB != null) {
    html += `<div class="sel" style="left:${(loopA * pxPerSec).toFixed(1)}px;width:${((loopB - loopA) * pxPerSec).toFixed(1)}px;height:${height}px"></div>`;
  }
  // candidate guide (faint full-height lines) — snap targets. Off by default:
  // a dense mix has a transient every ~60ms, so shown they're a wall. Snapping
  // still uses the full candidate set whether or not they're drawn.
  if (candtog.checked) {
    for (const c of state.candidates) {
      html += `<div class="cand" style="left:${(c * pxPerSec).toFixed(1)}px;height:${height}px"></div>`;
    }
  }
  list.forEach((l, i) => {
    const top = AXIS_H + i * LANE_H;
    html += `<div class="lane" style="top:${top}px;height:${LANE_H}px"></div>`;
    if (l.lyric) {
      for (const ln of lyrics) {
        const x = ln.t * pxPerSec;
        html += `<i style="left:${x.toFixed(1)}px;top:${top + 8}px;height:${LANE_H - 16}px;background:${l.color}"></i>`;
        html += `<span class="lyr" style="left:${(x + 4).toFixed(1)}px;top:${top + 6}px" title="${esc(ln.text)}">${esc(ln.text)}</span>`;
      }
    } else {
      const tickTop = top + 10;
      const tickH = LANE_H - 20;
      const addedSet = new Set(l.added);
      const hits = manualonly.checked ? l.added : l.onsets; // "manual only" hides detection
      for (const t of hits) {
        const edited = addedSet.has(t) ? ' edited' : '';
        html += `<i class="${edited.trim()}" style="left:${(t * pxPerSec).toFixed(1)}px;top:${tickTop}px;height:${tickH}px;background:${l.color}"></i>`;
      }
    }
  });
  if (loopA != null) html += `<div class="abmark a" style="left:${(loopA * pxPerSec).toFixed(1)}px;height:${height}px"></div>`;
  if (loopB != null) html += `<div class="abmark b" style="left:${(loopB * pxPerSec).toFixed(1)}px;height:${height}px"></div>`;
  content.innerHTML = html;
  content.appendChild(ph);
  ph.style.height = height + 'px';
  movePlayhead(video.currentTime || 0);
}

function movePlayhead(t) {
  ph.style.left = t * pxPerSec + 'px';
  tcur.textContent = fmt(t);
  if (isFinite(video.duration) && video.duration > 0) seek.value = String((t / video.duration) * 100);
  updateKaraoke(t);
}

// ---- lane hit-testing for edits -------------------------------------------

function laneAtY(y) {
  const idx = Math.floor((y - AXIS_H) / LANE_H);
  return idx >= 0 && idx < state.lanes.length ? state.lanes[idx] : null; // null = lyric row / outside
}

content.addEventListener('click', (e) => {
  if (!state) return;
  const x = e.clientX - content.getBoundingClientRect().left;
  const t = Math.max(0, x / pxPerSec);
  video.currentTime = t;
  movePlayhead(t);
});

content.addEventListener('dblclick', (e) => {
  if (!state) return;
  const rect = content.getBoundingClientRect();
  const l = laneAtY(e.clientY - rect.top);
  if (!l) return;
  const t = Math.max(0, (e.clientX - rect.left) / pxPerSec);
  toggleAt(l, t);
  refreshCount(l);
  queueDraw();
  renderTab();
  setStatus(`${countsText()} · edited ${l.name}`, 'ok');
  e.preventDefault();
});

// ---- zoom + candidate toggle ----------------------------------------------

zoom.addEventListener('input', () => {
  pxPerSec = Number(zoom.value);
  zoomVal.textContent = pxPerSec + ' px/s';
  if (state) queueDraw();
});
candtog.addEventListener('change', () => { if (state) queueDraw(); });

// ---- transport (custom bar below the video) -------------------------------

const togglePlay = () => (video.paused ? video.play() : video.pause());
pp.addEventListener('click', togglePlay);
seek.addEventListener('input', () => {
  if (isFinite(video.duration)) {
    const t = (Number(seek.value) / 100) * video.duration;
    video.currentTime = t;
    movePlayhead(t);
  }
});
video.addEventListener('loadedmetadata', () => (tdur.textContent = fmt(video.duration)));
video.addEventListener('play', () => { pp.textContent = '⏸'; cancelAnimationFrame(raf); loop(); });
video.addEventListener('pause', () => { pp.textContent = '▶'; cancelAnimationFrame(raf); });
video.addEventListener('ended', () => { pp.textContent = '▶'; cancelAnimationFrame(raf); });
video.addEventListener('seeked', () => movePlayhead(video.currentTime));
video.addEventListener('timeupdate', () => { if (video.paused) movePlayhead(video.currentTime); });

function loop() {
  if (looping && loopA != null && loopB != null && video.currentTime >= loopB) video.currentTime = loopA;
  const t = video.currentTime;
  movePlayhead(t);
  const x = t * pxPerSec;
  if (x < scroll.scrollLeft + 40 || x > scroll.scrollLeft + scroll.clientWidth - 120) {
    scroll.scrollLeft = Math.max(0, x - scroll.clientWidth * 0.3);
  }
  raf = requestAnimationFrame(loop);
}

// ---- keyboard: Space / A / D / 1-2-3 --------------------------------------

function seekBy(d) {
  if (!isFinite(video.duration)) return;
  const t = Math.min(video.duration, Math.max(0, video.currentTime + d));
  video.currentTime = t;
  movePlayhead(t);
}
function tapIn(idx) {
  if (!state) return;
  const l = state.lanes[idx];
  if (!l) return;
  addHit(l, video.currentTime);
  refreshCount(l);
  queueDraw();
  renderTab();
  setStatus(`${countsText()} · tapped ${l.name}`, 'ok');
}
document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (e.code === 'Space' || k === ' ') { e.preventDefault(); togglePlay(); }
  else if (k === 'a') { e.preventDefault(); seekBy(e.shiftKey ? -1 : -0.1); }
  else if (k === 'd') { e.preventDefault(); seekBy(e.shiftKey ? 1 : 0.1); }
  else if (k === '1') tapIn(0);
  else if (k === '2') tapIn(1);
  else if (k === '3') tapIn(2);
  else if (k === '[') { e.preventDefault(); setLoopA(); }
  else if (k === ']') { e.preventDefault(); setLoopB(); }
  else if (k === 'l') { e.preventDefault(); toggleLoop(); }
});

// ---- LRC → timed lyric track ----------------------------------------------

function parseLrc(text) {
  const re = /\[(\d{1,2}):(\d{2}(?:[.:]\d{1,3})?)\]/g;
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const stamps = [...line.matchAll(re)];
    if (!stamps.length) continue;
    const txt = line.replace(re, '').trim();
    if (!txt) continue;
    for (const m of stamps) out.push({ t: parseInt(m[1], 10) * 60 + parseFloat(m[2].replace(':', '.')), text: txt });
  }
  return out.sort((a, b) => a.t - b.t);
}

lrcInput.addEventListener('change', async () => {
  const f = lrcInput.files && lrcInput.files[0];
  if (!f) return;
  const parsed = parseLrc(await f.text());
  if (!parsed.length) { setStatus(`no timestamps found in “${f.name}”`, 'bad'); return; }
  lyricsRaw = parsed;
  applyLyricOffset();
  if (state) { buildGutter(); drawPlot(); }
  updateKaraoke(video.currentTime || 0);
  setStatus(`loaded ${lyricsRaw.length} lyric lines from “${f.name}”`, 'ok');
});

// LRC offset: shift every lyric time (non-destructive — keeps lyricsRaw intact,
// so the offset is adjustable back and forth). Positive delays the lyrics.
function applyLyricOffset() {
  const off = Number(lrcoffset.value) || 0;
  lyrics = lyricsRaw ? lyricsRaw.map((l) => ({ t: l.t + off, text: l.text })) : null;
}
lrcoffset.addEventListener('input', () => {
  if (!lyricsRaw) return;
  applyLyricOffset();
  if (state) drawPlot();
  updateKaraoke(video.currentTime || 0);
});

// ---- clear / unload -------------------------------------------------------

function clearMedia() {
  video.pause();
  if (mediaUrl) { URL.revokeObjectURL(mediaUrl); mediaUrl = null; }
  video.removeAttribute('src');
  video.load();
  mediaName = '';
  state = null;
  loopA = null;
  loopB = null;
  looping = false;
  loopbtn.classList.remove('on');
  updateAB();
  content.innerHTML = '';
  content.appendChild(ph);
  gutter.innerHTML = '';
  tabout.textContent = 'Load a track — the tab is generated from the detected / edited hits.';
  file.value = ''; // let the same file be re-picked
  seek.value = '0';
  tcur.textContent = '0:00.0';
  tdur.textContent = '0:00.0';
  setStatus('Upload an audio or video file — analysis runs automatically when it finishes decoding.', '');
}

function clearLrc() {
  lyricsRaw = null;
  lyrics = null;
  lrcoffset.value = '0';
  lrcInput.value = '';
  if (state) { buildGutter(); drawPlot(); }
  karaoke.innerHTML = '<span class="none">— no lyrics loaded —</span>';
  setStatus('lyrics cleared', 'ok');
}

clearMediaBtn.addEventListener('click', clearMedia);
clearLrcBtn.addEventListener('click', clearLrc);

function updateKaraoke(t) {
  if (!lyrics) return;
  let cur = null;
  for (const ln of lyrics) { if (ln.t <= t + 0.05) cur = ln; else break; }
  karaoke.textContent = cur ? cur.text : '';
  if (!cur) karaoke.innerHTML = '<span class="none">♪</span>';
}

// ---- drum tab: quantized view + export ------------------------------------

const tabOpts = () => ({ bpm: Number(bpm.value), subdiv: Number(grid.value), offset: Number(offsetInput.value) || 0 });

function renderTab() {
  if (!state) return;
  // "manual only" exports just the hand-added hits; "separate tracks" lays each
  // lane out as its own block.
  const lanes = state.lanes.map((l) => ({ id: l.id, onsets: manualonly.checked ? l.added : l.onsets }));
  tabout.textContent = toDrumTab(lanes, { ...tabOpts(), separate: septracks.checked }) || '(no hits yet)';
}

// On a fresh analysis: seed the BPM from the kick+snare pulse and align the grid
// to the first kick, then render. The user fine-tunes BPM/grid/start by eye.
function seedTab() {
  const bd = state.lanes.find((l) => l.id === 'bd');
  const sd = state.lanes.find((l) => l.id === 'sd');
  const ks = [...(bd ? bd.onsets : []), ...(sd ? sd.onsets : [])];
  bpm.value = String(estimateTempo(ks, state.duration));
  offsetInput.value = bd && bd.onsets.length ? bd.onsets[0].toFixed(2) : '0';
  renderTab();
}

for (const el of [bpm, grid, offsetInput]) el.addEventListener('input', () => { renderTab(); if (state) drawPlot(); });

async function copyTab() {
  const text = tabout.textContent;
  // navigator.clipboard needs a secure context — absent over plain http on the
  // LAN (phones), so fall back to a hidden textarea + execCommand.
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      setStatus('tab copied', 'ok');
      return;
    }
  } catch { /* fall through */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { /* ignore */ }
  ta.remove();
  setStatus(ok ? 'tab copied' : 'couldn’t copy — select the tab and copy manually', ok ? 'ok' : 'bad');
}

function saveText(text, filename) {
  const blob = new Blob([text.replace(/\n*$/, '') + '\n'], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const LANE_FILE = { hh: 'hihat', sd: 'snare', bd: 'kick' };

// With "separate tracks" on, save one file per track (kick / snare / hi-hat);
// otherwise the combined tab. Respects "manual only".
function downloadTab() {
  if (!state) return;
  const base = mediaName || 'drum';
  if (septracks.checked) {
    let saved = 0;
    state.lanes.forEach((l, i) => {
      const text = toDrumTab([{ id: l.id, onsets: manualonly.checked ? l.added : l.onsets }], tabOpts());
      if (!text) return;
      saved++;
      setTimeout(() => saveText(text, `${base}-${LANE_FILE[l.id] || l.id}.txt`), i * 200);
    });
    setStatus(saved ? 'downloaded a tab per track (kick / snare / hi-hat)' : 'nothing to download', saved ? 'ok' : 'bad');
  } else {
    saveText(tabout.textContent, `${base}-drums.txt`);
    setStatus('tab downloaded', 'ok');
  }
}

copytab.addEventListener('click', copyTab);
dltab.addEventListener('click', downloadTab);
manualonly.addEventListener('change', () => {
  if (!state) return;
  for (const l of state.lanes) refreshCount(l);
  drawPlot();
  renderTab();
});
septracks.addEventListener('change', renderTab);

// ---- loop + grid-locked pattern repeat ------------------------------------

function updateAB() {
  abreadout.textContent = `A ${loopA != null ? fmt(loopA) : '–'} · B ${loopB != null ? fmt(loopB) : '–'}`;
  const ready = loopA != null && loopB != null;
  loopbtn.disabled = !ready;
  if (!ready && looping) { looping = false; loopbtn.classList.remove('on'); }
}
function setLoopA() {
  if (!state) return;
  loopA = snapToBar(video.currentTime);
  if (loopB != null && loopB <= loopA) loopB = null;
  updateAB();
  drawPlot();
}
function setLoopB() {
  if (!state) return;
  if (loopA == null) { setStatus('set A first ( [ )', 'bad'); return; }
  let b = snapToBar(video.currentTime);
  if (b <= loopA) b = loopA + barDur(); // at least one bar
  loopB = Math.min(b, state.duration);
  updateAB();
  drawPlot();
}
function clearLoop() {
  loopA = null;
  loopB = null;
  looping = false;
  loopbtn.classList.remove('on');
  updateAB();
  if (state) drawPlot();
}
function toggleLoop() {
  if (loopA == null || loopB == null) return;
  looping = !looping;
  loopbtn.classList.toggle('on', looping);
  if (looping && (video.currentTime < loopA || video.currentTime >= loopB)) { video.currentTime = loopA; movePlayhead(loopA); }
}

// Tile the A–B groove to the end, grid-locked. The pattern (hits in A–B,
// quantized to the grid) repeats every (B−A) seconds. Via the edit-override
// model: clear the detected hits in the fill range, add the tiled hits — so it's
// non-destructive and survives threshold tuning (shown as ✎).
function stampPattern() {
  if (!state) return;
  if (loopA == null || loopB == null || loopB <= loopA) { setStatus('set an A–B range first ( [ and ] )', 'bad'); return; }
  const period = loopB - loopA;
  const cellDur = beatDur() / (Number(grid.value) || 4);
  const totalPat = state.lanes.reduce((s, l) => s + l.onsets.filter((t) => t >= loopA - 1e-6 && t < loopB - 1e-6).length, 0);
  if (totalPat === 0) { setStatus('no hits in the A–B range to repeat', 'bad'); return; }
  for (const l of state.lanes) {
    const pat = l.onsets.filter((t) => t >= loopA - 1e-6 && t < loopB - 1e-6).map((t) => Math.round((t - loopA) / cellDur) * cellDur);
    if (!pat.length) continue; // this lane isn't part of the selected groove — leave it untouched
    for (const a of l.auto) if (a >= loopB && a < state.duration && near(a, l.removed, 0.02) === null) l.removed.push(a);
    l.added = l.added.filter((t) => t < loopB || t >= state.duration);
    for (let start = loopB; start < state.duration; start += period) {
      for (const rel of pat) { const t = start + rel; if (t < state.duration) l.added.push(t); }
    }
    recompute(l);
    refreshCount(l);
  }
  const copies = Math.floor((state.duration - loopB) / period);
  drawPlot();
  renderTab();
  setStatus(`repeated the ${period.toFixed(2)}s pattern ${copies}× to the end`, 'ok');
}

// Revert every lane to pure detection — clears all adds, removes and stamped
// patterns in one go (the detection + thresholds themselves are untouched).
function resetEdits() {
  if (!state) return;
  let n = 0;
  for (const l of state.lanes) {
    n += l.added.length + l.removed.length;
    l.added = [];
    l.removed = [];
    recompute(l);
    refreshCount(l);
  }
  drawPlot();
  renderTab();
  setStatus(n ? `cleared ${n} hand edits — back to detection` : 'no hand edits to clear', n ? 'ok' : '');
}

loopbtn.addEventListener('click', toggleLoop);
resetEditsBtn.addEventListener('click', resetEdits);
setAbtn.addEventListener('click', setLoopA);
setBbtn.addEventListener('click', setLoopB);
clearabBtn.addEventListener('click', clearLoop);
repeatbtn.addEventListener('click', stampPattern);
barstog.addEventListener('change', () => state && drawPlot());

// ---- init -----------------------------------------------------------------

zoomVal.textContent = pxPerSec + ' px/s';
updateAB();
window.addEventListener('resize', () => state && queueDraw());
