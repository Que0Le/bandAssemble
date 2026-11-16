// GUI wiring — runs the SAME parse/align/emit modules as the Node demo (Vite
// resolves `chordsheetjs` for the browser), so the screen is a faithful preview
// of the app's "Import a song" feature.

import { parseSheet } from './parse.js';
import { parseLrc } from './lrc.js';
import { align } from './align.js';
import { buildObjects, toChartJson, toChordPro, toLrc } from './emit.js';
import sampleUg from './sample-ug.txt?raw';
import sampleLrc from './sample-rising-sun.lrc?raw';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const mmss = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

$('chords').value = sampleUg;
$('lrc').value = sampleLrc;

let aligned = null;
let meta = null;
let objs = null;

// ---- render a chord-over-lyric line from {lyrics, chords:[{chord,offset}]} ----
function seg(ch, tx) {
  return `<span class="seg"><span class="ch">${esc(ch)}</span><span class="tx">${esc(tx) || '&nbsp;'}</span></span>`;
}
function chordLineHtml(lyrics, chords) {
  if (!chords || !chords.length) return seg('', lyrics);
  const cs = [...chords].sort((a, b) => a.offset - b.offset);
  let html = '';
  if (cs[0].offset > 0) html += seg('', lyrics.slice(0, cs[0].offset));
  for (let i = 0; i < cs.length; i++) {
    const start = Math.min(cs[i].offset, lyrics.length);
    const end = i + 1 < cs.length ? Math.min(cs[i + 1].offset, lyrics.length) : lyrics.length;
    html += seg(cs[i].chord, lyrics.slice(start, end) || ' ');
  }
  return html;
}

// Merge labels + lines in time order for display.
function timelineRows(a) {
  const rows = a.lines.map((l, i) => {
    const end = i + 1 < a.lines.length ? a.lines[i + 1].time : a.lengthSec;
    return { kind: 'line', time: l.time, end, line: l };
  });
  for (const lb of a.labels) rows.push({ kind: 'label', time: lb.time, text: lb.label });
  rows.sort((x, y) => x.time - y.time || (x.kind === 'label' ? -1 : 1));
  return rows;
}

function render() {
  const model = parseSheet($('chords').value);
  const lrc = parseLrc($('lrc').value);
  const offset = parseFloat($('offset').value) || 0;
  aligned = align(model, lrc, { offset });
  meta = { title: lrc.title || model.title, artist: lrc.artist || model.artist, lengthSec: aligned.lengthSec };
  objs = buildObjects(aligned);

  $('cov').textContent = `${Math.round(aligned.coverage * 100)}%`;
  $('labels').textContent = aligned.labels.map((l) => `${l.label} @${mmss(l.time)}`).join('   ');

  const chart = $('chart');
  chart.innerHTML = timelineRows(aligned)
    .map((r) => {
      if (r.kind === 'label') return `<div class="label">${esc(r.text)}</div>`;
      const l = r.line;
      const cls = l.matched ? 'lrow' : 'lrow unmatched';
      const body = l.matched
        ? chordLineHtml(l.source.lyrics, l.source.chords)
        : esc(l.lyrics || '(instrumental)') + `<span class="tag">no match</span>`;
      return `<div class="${cls}" data-start="${l.time}" data-end="${r.end}"><div class="t">${mmss(l.time)}</div><div class="body">${body}</div></div>`;
    })
    .join('');

  renderExport();
}

// ---- exports ----
let exKind = 'cho';
function exText() {
  if (exKind === 'cho') return toChordPro(objs, meta);
  if (exKind === 'lrc') return toLrc(objs, meta);
  return JSON.stringify(toChartJson(objs, meta), null, 2);
}
function renderExport() {
  $('exout').textContent = exText();
}
for (const b of document.querySelectorAll('.extabs button')) {
  b.onclick = () => {
    exKind = b.dataset.ex;
    document.querySelectorAll('.extabs button').forEach((x) => x.classList.toggle('on', x === b));
    renderExport();
  };
}
$('copy').onclick = () => navigator.clipboard?.writeText(exText());
$('download').onclick = () => {
  const name = `${(meta.title || 'song').replace(/\s+/g, '-').toLowerCase()}.${exKind === 'json' ? 'json' : exKind}`;
  const blob = new Blob([exText()], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
};

// ---- playhead animation (the "wow": watch the chart scroll in time) ----
let playing = false;
let t0 = 0;
let base = 0;
function frame(now) {
  if (!playing) return;
  const t = base + (now - t0) / 1000;
  if (t >= aligned.lengthSec) {
    stop();
    return;
  }
  setClock(t);
  requestAnimationFrame(frame);
}
function setClock(t) {
  $('clock').textContent = mmss(t);
  $('prog').style.width = `${(t / aligned.lengthSec) * 100}%`;
  let cur = null;
  for (const row of document.querySelectorAll('.lrow')) {
    const s = +row.dataset.start;
    const e = +row.dataset.end;
    const on = t >= s && t < e;
    row.classList.toggle('cur', on);
    if (on) cur = row;
  }
  if (cur) cur.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
function play() {
  if (playing) return stop();
  playing = true;
  t0 = performance.now();
  $('play').textContent = '⏸ Pause';
  requestAnimationFrame(frame);
}
function stop() {
  playing = false;
  base = parseFloat($('clock').textContent.split(':').reduce((m, s) => m * 60 + +s)) || 0;
  $('play').textContent = '▶ Play';
}
$('play').onclick = play;
$('reset').onclick = () => {
  stop();
  base = 0;
  setClock(0);
  render();
};

// Live re-align on any edit.
for (const el of [$('chords'), $('lrc')]) el.oninput = render;
$('offset').oninput = () => {
  $('offsetVal').textContent = `${(parseFloat($('offset').value) || 0).toFixed(1)}s`;
  render();
};

render();
