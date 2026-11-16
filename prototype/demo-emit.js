// Run: node demo-emit.js
// Full chain: paste + LRC -> aligned -> SongObject[] -> {project JSON, .cho, .lrc}
// Writes them to ./out and round-trips the .cho back through ChordSheetJS to
// prove it's valid, interoperable ChordPro (not a bespoke format).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import ChordSheetJS from 'chordsheetjs';
import { parseSheet } from './parse.js';
import { parseLrc } from './lrc.js';
import { align } from './align.js';
import { buildObjects, toChartJson, toChordPro, toLrc } from './emit.js';

const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
const write = (f, s) => writeFileSync(new URL(`./out/${f}`, import.meta.url), s);

const model = parseSheet(read('./sample-ug.txt'));
const lrc = parseLrc(read('./sample-rising-sun.lrc'));
const aligned = align(model, lrc);
const meta = { title: lrc.title, artist: lrc.artist, lengthSec: aligned.lengthSec };

const objs = buildObjects(aligned);
const chart = toChartJson(objs, meta); // {title, roleId, objects} — the app's import shape
const cho = toChordPro(objs, meta);
const lrcOut = toLrc(objs, meta);

write('rising-sun.chart.json', JSON.stringify(chart, null, 2));
write('rising-sun.cho', cho);
write('rising-sun.lrc', lrcOut);

console.log('=== SongObject[] (guitar chart) ===');
for (const o of objs) {
  if (o.type === 'label') console.log(`  [${o.startSec}] «${o.text}»`);
  else console.log(`  [${o.startSec}-${o.endSec}] ${o.text ?? '@' + o.kind}`);
}

console.log('\n=== ChordPro export (rising-sun.cho) ===\n' + cho);
console.log('=== LRC export (rising-sun.lrc) ===\n' + lrcOut);

// Round-trip proof: a real ChordPro tool must be able to read our export back.
const reparsed = new ChordSheetJS.ChordProParser().parse(cho);
const chords = new Set();
for (const line of reparsed.lines) for (const it of line.items) if (it.chords) chords.add(it.chords);
console.log('\n=== Round-trip: ChordSheetJS re-parsed our .cho ===');
console.log(`  title=${reparsed.title}  artist=${reparsed.artist}`);
console.log(`  distinct chords recovered: ${[...chords].sort().join(' ')}`);
console.log('\n=== Chart JSON (app import shape: {title, roleId, objects}) ===');
console.log(JSON.stringify(chart, null, 2).split('\n').slice(0, 8).join('\n') + '\n  ...');
console.log('\nWrote out/rising-sun.{chart.json,cho,lrc}');
