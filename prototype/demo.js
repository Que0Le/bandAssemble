// Run: npm run demo
// Parses both sample sheets and prints the structured model, so we can eyeball
// that chords land at the right character offsets and section labels survive.

import { readFileSync } from 'node:fs';
import { parseSheet, detectFormat } from './parse.js';

function show(file) {
  const text = readFileSync(new URL(file, import.meta.url), 'utf8');
  const model = parseSheet(text);
  console.log('\n═══════════════════════════════════════════');
  console.log(`FILE: ${file}   (detected: ${detectFormat(text)})`);
  console.log('═══════════════════════════════════════════');
  console.log(`title=${model.title}  artist=${model.artist}`);
  for (const line of model.lines) {
    if (line.kind === 'section') {
      console.log(`\n  ── [${line.label}] ──`);
    } else {
      const chordStr = line.chords.map((c) => `${c.chord}@${c.offset}`).join('  ') || '(no chords)';
      console.log(`  "${line.lyrics}"`);
      console.log(`     ${chordStr}`);
    }
  }
}

show('./sample-ug.txt');
show('./sample-chordpro.txt');
