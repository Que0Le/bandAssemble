// Prototype: turn a pasted chord sheet (Ultimate Guitar "chords over lyrics",
// or ChordPro) into a flat, timing-free structured model that the LRC aligner
// will later consume.
//
// Output shape (the "half-chart" with chords but no timing):
//   {
//     title, artist,
//     lines: [
//       { kind: 'section', label: 'Chorus' }
//       | { kind: 'lyric', lyrics: 'There is a house...', chords: [ { chord: 'Am', offset: 0 }, ... ] }
//     ]
//   }
// `offset` is the character index into `lyrics` where the chord sits — this is
// what the aligner interpolates into a timestamp within the line.

import ChordSheetJS from 'chordsheetjs';

/** Heuristic: ChordPro has {directives} or [Chord] brackets sitting inline
 *  INSIDE a lyric line. Ultimate Guitar puts chords on their own line above. */
export function detectFormat(text) {
  if (/\{[a-z_]+\s*:/i.test(text)) return 'chordpro'; // {title: ...}, {start_of_verse}
  // inline [X] with a lyric character right after the close bracket → chordpro
  if (/\[[A-G][#b]?[^\]]*\]\S/.test(text) || /\]\w/.test(text)) return 'chordpro';
  return 'ug';
}

function isChordLyricsPair(item) {
  return item && typeof item.lyrics === 'string' && 'chords' in item;
}

/** A line whose only real payload is a tag/comment is a section header. */
function sectionLabel(line) {
  for (const item of line.items) {
    if (isChordLyricsPair(item)) return null; // it carries lyrics → not a header
    const name = item?.name ?? '';
    const value = item?.value ?? item?.content ?? '';
    if (/start_of_(verse|chorus|bridge|part)/i.test(name)) {
      return value || name.replace(/start_of_/i, '');
    }
    if (/^(comment|section|label)$/i.test(name) && value) return value;
  }
  return null;
}

export function parseSheet(text, formatHint) {
  const format = formatHint || detectFormat(text);
  const Parser = format === 'chordpro' ? ChordSheetJS.ChordProParser : ChordSheetJS.UltimateGuitarParser;
  const song = new Parser().parse(text);

  const out = { title: song.title || null, artist: song.artist || null, format, lines: [] };

  for (const line of song.lines) {
    if (!line.items.length) continue;

    const label = sectionLabel(line);
    if (label) {
      out.lines.push({ kind: 'section', label: label.trim() });
      continue;
    }

    let lyrics = '';
    const chords = [];
    for (const item of line.items) {
      if (!isChordLyricsPair(item)) continue;
      if (item.chords) chords.push({ chord: item.chords.trim(), offset: lyrics.length });
      lyrics += item.lyrics ?? '';
    }
    lyrics = lyrics.replace(/\s+$/, '');
    if (lyrics.trim() || chords.length) out.lines.push({ kind: 'lyric', lyrics, chords });
  }
  return out;
}
