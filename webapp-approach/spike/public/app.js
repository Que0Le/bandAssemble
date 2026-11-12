// bandAssemble spike — master/client sync logic (vanilla ES module).
//
// Proves the risky parts from webapp-approach/:
//   • dumb relay forwarding               (relay.js)
//   • NTP-style clock sync over WebSocket (ClockSync)
//   • authoritative-master transport      (intents -> master -> state/transport)
//   • audio-driven playhead on the master (Web Audio, AudioContext.currentTime)
//   • follower extrapolation + auto-scroll (silent clients)
//
// The production app uses Svelte, but this hot path (audio + clock + scroll) is
// framework-agnostic — exactly as 01-tech-stack-feasibility.md notes.

// ---------- role / session ----------
const params = new URLSearchParams(location.search);
const ROLE = params.get('role');               // 'master' | 'client' | null
const SESSION = params.get('session') || 'spike';
const DEVICE_ID = Math.random().toString(36).slice(2, 8);

const $ = (id) => document.getElementById(id);

if (!ROLE) {
  $('chooser').hidden = false;
} else {
  $('app').hidden = false;
  $('roleBadge').textContent = ROLE === 'master' ? '🎛️ MASTER' : '📱 CLIENT';
  $('roleBadge').className = 'role-badge ' + ROLE;
  $('masterControls').hidden = ROLE !== 'master';
  $('clientControls').hidden = ROLE !== 'client';
}

// ---------- synthetic "song" (stand-in arrangement) ----------
// positions in seconds; chords + lyrics on one shared timeline.
const SONG = {
  lengthSec: 48,
  markers: [
    { atSec: 0,  label: 'Intro' },
    { atSec: 8,  label: 'Verse 1' },
    { atSec: 24, label: 'Chorus' },
    { atSec: 40, label: 'Outro' },
  ],
  lines: [
    { atSec: 0,  chord: 'C',  lyric: '(intro — 4 bars)' },
    { atSec: 4,  chord: 'G',  lyric: '(intro — 4 bars)' },
    { atSec: 8,  chord: 'C',  lyric: 'Here comes the first line of the verse' },
    { atSec: 12, chord: 'Am', lyric: 'singing along to the clicking beat' },
    { atSec: 16, chord: 'F',  lyric: 'everybody find your place in time' },
    { atSec: 20, chord: 'G',  lyric: 'and we lift into the chorus now' },
    { atSec: 24, chord: 'C',  lyric: 'THIS is the chorus, big and bright' },
    { atSec: 28, chord: 'G',  lyric: 'all the devices scroll as one' },
    { atSec: 32, chord: 'Am', lyric: 'no conductor, just a shared clock' },
    { atSec: 36, chord: 'F',  lyric: 'press start and we are locked in' },
    { atSec: 40, chord: 'C',  lyric: '(outro — ritard… just kidding, steady)' },
    { atSec: 44, chord: 'G',  lyric: '(outro — end)' },
  ],
};
const BPM = 100;
const BEAT = 60 / BPM;

// ---------- transport (WebSocket to the dumb relay) ----------
const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?session=${encodeURIComponent(SESSION)}`;
let ws;
const handlers = new Map(); // kind -> fn(payload, env)
function on(kind, fn) { handlers.set(kind, fn); }
function send(kind, payload) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ v: 1, sessionId: SESSION, from: DEVICE_ID, role: ROLE, kind, ts: now(), payload }));
  }
}
function connect() {
  ws = new WebSocket(wsUrl);
  ws.onopen = () => {
    setConn('connected', true);
    send('session/hello', { role: ROLE });
    if (ROLE === 'client') startClockSync();
    if (ROLE === 'master') broadcastTransport(); // announce current state to any peer
  };
  ws.onclose = () => { setConn('disconnected — retrying', false); setTimeout(connect, 1000); };
  ws.onerror = () => setConn('error', false);
  ws.onmessage = (ev) => {
    let env; try { env = JSON.parse(ev.data); } catch { return; }
    const fn = handlers.get(env.kind);
    if (fn) fn(env.payload, env);
  };
}
function setConn(text, ok) {
  const el = $('conn'); el.textContent = text;
  el.className = 'pill ' + (ok ? 'ok' : 'bad');
}
const now = () => performance.now(); // local monotonic clock, ms

// ======================================================================
//  CLOCK SYNC  (client estimates offset = masterClock - clientClock)
// ======================================================================
let clockOffset = 0;   // ms to add to local clock to get master clock
let bestRtt = Infinity;
let lastSyncAt = 0;

// master answers pings
on('clock/ping', (p, env) => {
  if (ROLE !== 'master') return;
  const t2 = now();
  send('clock/pong', { t1: p.t1, t2, t3: now(), to: env.from });
});

// client processes pongs (NTP four-timestamp)
on('clock/pong', (p) => {
  if (ROLE !== 'client' || p.to !== DEVICE_ID) return;
  const t4 = now();
  const rtt = (t4 - p.t1) - (p.t3 - p.t2);
  const offset = ((p.t2 - p.t1) + (p.t3 - t4)) / 2;
  if (rtt < bestRtt) { bestRtt = rtt; clockOffset = offset; } // keep lowest-RTT sample
  lastSyncAt = now();
});

function startClockSync() {
  const burst = () => {
    bestRtt = Infinity;                 // re-evaluate each burst
    let n = 0;
    const iv = setInterval(() => {
      send('clock/ping', { t1: now() });
      if (++n >= 8) clearInterval(iv);  // 8 probes, keep the best
    }, 60);
  };
  burst();
  setInterval(burst, 20000);            // periodic re-sync (drift / resume)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) burst(); });
}

// ======================================================================
//  MASTER  (authoritative playhead, audio, orchestration)
// ======================================================================
let audioCtx = null;
let transport = { state: 'paused', atSec: 0, rate: 1, loop: null };
// audio-clock anchor:
let anchorCtxTime = 0;   // audioCtx.currentTime at anchor
let anchorSec = 0;       // playhead seconds at anchor
let audioBuffer = null;  // optional loaded recording
let bufSource = null;

function masterPlayheadSec() {
  if (transport.state !== 'playing' || !audioCtx) return transport.atSec;
  return anchorSec + (audioCtx.currentTime - anchorCtxTime) * transport.rate;
}

function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function setAnchor(atSec) {
  anchorSec = atSec;
  anchorCtxTime = audioCtx ? audioCtx.currentTime : 0;
  nextClickSec = Math.ceil(atSec / BEAT) * BEAT; // realign metronome
  restartBufferPlayback();
}

// --- metronome (lookahead scheduler on the audio thread) ---
let nextClickSec = 0;
function schedulerTick() {
  if (!audioCtx || transport.state !== 'playing') return;
  if (!$('metChk')?.checked) return;
  const lookahead = 0.15;
  const head = masterPlayheadSec();
  while (nextClickSec < head + lookahead) {
    const ctxTime = anchorCtxTime + (nextClickSec - anchorSec) / transport.rate;
    if (ctxTime >= audioCtx.currentTime) scheduleClick(ctxTime, nextClickSec % (BEAT * 4) < 1e-6);
    nextClickSec += BEAT;
  }
}
function scheduleClick(ctxTime, strong) {
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.frequency.value = strong ? 1500 : 900;
  g.gain.setValueAtTime(0.0001, ctxTime);
  g.gain.exponentialRampToValueAtTime(strong ? 0.5 : 0.25, ctxTime + 0.001);
  g.gain.exponentialRampToValueAtTime(0.0001, ctxTime + 0.06);
  osc.connect(g).connect(audioCtx.destination);
  osc.start(ctxTime); osc.stop(ctxTime + 0.07);
}

// --- optional loaded recording ---
function restartBufferPlayback() {
  if (bufSource) { try { bufSource.stop(); } catch {} bufSource = null; }
  if (!audioBuffer || transport.state !== 'playing') return;
  bufSource = audioCtx.createBufferSource();
  bufSource.buffer = audioBuffer;
  bufSource.playbackRate.value = transport.rate;
  bufSource.connect(audioCtx.destination);
  const off = Math.max(0, Math.min(anchorSec, audioBuffer.duration - 0.01));
  bufSource.start(audioCtx.currentTime, off);
}

function broadcastTransport() {
  if (ROLE !== 'master') return;
  send('state/transport', {
    state: transport.state,
    atSec: masterPlayheadSec(),
    startAtMasterTs: now(),
    rate: transport.rate,
    loop: transport.loop,
  });
}

function masterAction(fn) { ensureAudio(); fn(); broadcastTransport(); }

function play()  { masterAction(() => { if (transport.state === 'playing') return; transport.state = 'playing'; setAnchor(transport.atSec); }); }
function pause() { masterAction(() => { transport.atSec = masterPlayheadSec(); transport.state = 'paused'; if (bufSource) { try { bufSource.stop(); } catch {} bufSource = null; } }); }
function seek(atSec) { masterAction(() => { transport.atSec = Math.max(0, Math.min(atSec, SONG.lengthSec)); if (transport.state === 'playing') setAnchor(transport.atSec); }); }

if (ROLE === 'master') {
  // intents from clients -> master decides -> rebroadcast
  on('intent/play', () => play());
  on('intent/pause', () => pause());
  on('intent/seek', (p) => seek(p.atSec));
  on('intent/jumpMarker', (p) => { const m = SONG.markers.find(x => x.label === p.label); if (m) seek(m.atSec); });
  // a newly-joined peer says hello -> tell it current state
  on('session/hello', () => broadcastTransport());

  $('btnPlay').onclick = play;
  $('btnPause').onclick = pause;
  $('btnRestart').onclick = () => seek(0);
  $('rate').oninput = (e) => masterAction(() => {
    const newRate = parseFloat(e.target.value);
    transport.atSec = masterPlayheadSec();        // re-anchor at current pos
    transport.rate = newRate;
    if (transport.state === 'playing') setAnchor(transport.atSec);
    $('rRate').textContent = newRate.toFixed(2) + '×';
  });
  $('loopChk').onchange = (e) => masterAction(() => {
    transport.loop = e.target.checked ? { fromSec: 24, toSec: 40 } : null; // Chorus loop
  });
  $('audioFile').onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    ensureAudio();
    audioBuffer = await audioCtx.decodeAudioData(await file.arrayBuffer());
    if (transport.state === 'playing') setAnchor(masterPlayheadSec());
  };

  // markers
  const mm = $('masterMarkers');
  SONG.markers.forEach(m => {
    const b = document.createElement('button');
    b.className = 'btn'; b.textContent = `${m.label} (${m.atSec}s)`;
    b.onclick = () => seek(m.atSec);
    mm.appendChild(b);
  });

  // keepalive broadcast + metronome scheduler + loop enforcement
  setInterval(() => { if (transport.state === 'playing') broadcastTransport(); }, 1500);
  setInterval(schedulerTick, 25);
  setInterval(() => {
    if (transport.state === 'playing' && transport.loop) {
      if (masterPlayheadSec() >= transport.loop.toSec) seek(transport.loop.fromSec);
    }
    if (masterPlayheadSec() >= SONG.lengthSec) pause();
  }, 50);
}

// ======================================================================
//  CLIENT  (silent follower: extrapolate + auto-scroll)
// ======================================================================
let follow = null; // last state/transport, mapped to local clock
on('state/transport', (p) => {
  if (ROLE !== 'client') return;
  follow = {
    state: p.state,
    atSec: p.atSec,
    localStart: p.startAtMasterTs - clockOffset, // master ts -> local ts
    rate: p.rate,
    loop: p.loop,
  };
});

function clientPlayheadSec() {
  if (!follow) return 0;
  if (follow.state !== 'playing') return follow.atSec;
  return follow.atSec + ((now() - follow.localStart) / 1000) * follow.rate;
}

if (ROLE === 'client') {
  on('session/roster', () => {});
  SONG.markers.forEach(m => {
    const b = document.createElement('button');
    b.className = 'btn'; b.textContent = `start @ ${m.label}`;
    b.onclick = () => send('intent/jumpMarker', { label: m.label });
    $('clientMarkers').appendChild(b);
  });
  $('cPlay').onclick = () => send('intent/play', {});
  $('cPause').onclick = () => send('intent/pause', {});
  $('chartTitle').textContent = 'Your chart (follows master)';
}

// ======================================================================
//  CHART rendering + render loop (both roles)
// ======================================================================
const chart = $('chart');
const scroller = document.createElement('div');
scroller.className = 'scroller';
if (chart) chart.appendChild(scroller);
const LINE_H = 42; // must roughly match CSS .line height
if (chart) {
  SONG.lines.forEach((ln) => {
    const el = document.createElement('div');
    el.className = 'line';
    el.dataset.at = ln.atSec;
    el.innerHTML = `<span class="t">${ln.atSec.toFixed(0)}s</span>` +
      `<span class="chord">${ln.chord}</span><span class="lyric">${ln.lyric}</span>`;
    scroller.appendChild(el);
  });
}

function currentPlayhead() { return ROLE === 'master' ? masterPlayheadSec() : clientPlayheadSec(); }

function render() {
  const head = currentPlayhead();
  // position the scroller so the active line sits at the center guide
  const idx = SONG.lines.findIndex((l, i) =>
    head >= l.atSec && (i === SONG.lines.length - 1 || head < SONG.lines[i + 1].atSec));
  // smooth fractional scroll between lines
  let y = 0;
  if (idx >= 0) {
    const l = SONG.lines[idx];
    const nextAt = (idx < SONG.lines.length - 1) ? SONG.lines[idx + 1].atSec : SONG.lengthSec;
    const frac = (head - l.atSec) / Math.max(0.001, nextAt - l.atSec);
    y = (idx + frac) * LINE_H;
  }
  if (chart) {
    scroller.style.transform = `translateY(${(chart.clientHeight / 2) - y}px)`;
    [...scroller.children].forEach((el, i) => el.classList.toggle('active', i === idx));
  }

  // readouts
  const st = ROLE === 'master' ? transport.state : (follow?.state ?? '—');
  const rate = ROLE === 'master' ? transport.rate : (follow?.rate ?? 1);
  $('rState').textContent = st;
  $('rPlayhead').textContent = head.toFixed(2) + 's';
  $('rRate').textContent = (rate || 1).toFixed(2) + '×';
  if (ROLE === 'client') {
    $('rOffset').textContent = clockOffset ? clockOffset.toFixed(1) + ' ms' : '—';
    $('rRtt').textContent = isFinite(bestRtt) ? bestRtt.toFixed(1) + ' ms' : '—';
    $('rSync').textContent = lastSyncAt ? ((now() - lastSyncAt) / 1000).toFixed(0) + 's ago' : '—';
  } else {
    $('rOffset').textContent = 'n/a (master)';
    $('rRtt').textContent = 'n/a';
    $('rSync').textContent = 'authoritative';
  }
  requestAnimationFrame(render);
}

// debug accessor for cross-tab verification (computes live, not rAF-dependent)
window.__spike = {
  role: ROLE,
  playhead: () => currentPlayhead(),
  state: () => (ROLE === 'master' ? transport.state : (follow?.state ?? null)),
  rate: () => (ROLE === 'master' ? transport.rate : (follow?.rate ?? null)),
  offset: () => clockOffset,
  rtt: () => bestRtt,
  gotFollow: () => !!follow,
};

if (ROLE) { connect(); requestAnimationFrame(render); }
