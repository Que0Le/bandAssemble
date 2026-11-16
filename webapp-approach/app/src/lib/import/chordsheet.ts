// Parse a pasted chord sheet (Ultimate Guitar "chords over lyrics", or ChordPro)
// into a timing-free structured model — the "half-chart" with chords but no
// timing. Built on ChordSheetJS, which parses BOTH formats, so one paste box
// handles ~every chord site with no per-site integration.

import ChordSheetJS from 'chordsheetjs';

export interface ParsedChord {
  chord: string;
  offset: number; // character index into `lyrics` where the chord sits
}
export interface ParsedLine {
  kind: 'section' | 'lyric';
  label?: string; // for kind==='section'
  lyrics?: string; // for kind==='lyric'
  chords?: ParsedChord[];
}
export interface ParsedSheet {
  title: string | null;
  artist: string | null;
  format: 'ug' | 'chordpro';
  lines: ParsedLine[];
}

/** ChordPro has {directives} or [Chord] brackets INSIDE a lyric line; Ultimate
 *  Guitar puts chords on their own line above the lyric. */
export function detectFormat(text: string): 'ug' | 'chordpro' {
  if (/\{[a-z_]+\s*:/i.test(text)) return 'chordpro';
  if (/\[[A-G][#b]?[^\]]*\]\S/.test(text) || /\]\w/.test(text)) return 'chordpro';
  return 'ug';
}

interface CSItem {
  chords?: string;
  lyrics?: string;
  name?: string;
  value?: string;
  content?: string;
}
interface CSLine {
  items: CSItem[];
}
interface CSSong {
  title?: string;
  artist?: string;
  lines: CSLine[];
}

function isChordLyricsPair(item: CSItem): boolean {
  return !!item && typeof item.lyrics === 'string' && 'chords' in item;
}

function sectionLabel(line: CSLine): string | null {
  for (const item of line.items) {
    if (isChordLyricsPair(item)) return null;
    const name = item?.name ?? '';
    const value = item?.value ?? item?.content ?? '';
    if (/start_of_(verse|chorus|bridge|part)/i.test(name)) return value || name.replace(/start_of_/i, '');
    if (/^(comment|section|label)$/i.test(name) && value) return value;
  }
  return null;
}

export function parseChordSheet(text: string, formatHint?: 'ug' | 'chordpro'): ParsedSheet {
  const format = formatHint || detectFormat(text);
  const Parser = format === 'chordpro' ? ChordSheetJS.ChordProParser : ChordSheetJS.UltimateGuitarParser;
  const song = new Parser().parse(text) as unknown as CSSong;

  const out: ParsedSheet = { title: song.title || null, artist: song.artist || null, format, lines: [] };

  for (const line of song.lines) {
    if (!line.items.length) continue;

    const label = sectionLabel(line);
    if (label) {
      out.lines.push({ kind: 'section', label: label.trim() });
      continue;
    }

    let lyrics = '';
    const chords: ParsedChord[] = [];
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
