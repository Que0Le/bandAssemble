// Run: node demo-align.js
// Full pipeline: UG chord paste + LRC  ->  timed chart.
// The LRC is lowercase, uses "risin'"/commas, has an instrumental intro line,
// and REPEATS the chorus — all to prove normalization, the match threshold, and
// chorus reuse against the single pasted chorus.

import { readFileSync } from 'node:fs';
import { parseSheet } from './parse.js';
import { parseLrc } from './lrc.js';
import { align } from './align.js';

const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');

const model = parseSheet(read('./sample-ug.txt'));
const lrc = parseLrc(read('./sample-rising-sun.lrc'));

function mmss(t) {
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
}

function showChart(chart) {
  console.log(`\n${chart.title} — ${chart.artist}`);
  console.log(`length=${mmss(chart.lengthSec)}  offset=${chart.offset}s  coverage=${(chart.coverage * 100).toFixed(0)}%`);
  console.log('labels:', chart.labels.map((l) => `${l.label}@${mmss(l.time)}`).join('  ') || '(none)');
  console.log('─'.repeat(60));
  for (const line of chart.lines) {
    const tag = line.matched ? `sim ${line.sim.toFixed(2)}` : 'UNMATCHED        ';
    const txt = line.lyrics || '(instrumental)';
    console.log(`[${mmss(line.time)}] ${tag}  "${txt}"`);
    if (line.chords.length) {
      console.log(`           ${line.chords.map((c) => `${c.chord}@${mmss(c.time)}`).join('  ')}`);
    }
  }
}

console.log('\n################  ALIGNED (offset 0)  ################');
showChart(align(model, lrc));

console.log('\n################  SAME, nudged +2.0s to lock to the MV  ################');
const nudged = align(model, lrc, { offset: 2.0 });
console.log('first chord moves:',
  mmss(align(model, lrc).events[0].time), '->', mmss(nudged.events[0].time));
