// Inline-chord parsing. Chords live inside the lyric text as [X] tokens.
// The parser only recognizes the tokens for display/transpose; the text is
// the source of truth. See ../../03-data-model.md.

import type { SongObject } from './model';

export interface Seg {
  chord?: string; // the chord token that starts this segment, e.g. "Em", "A7", "G/B"
  text: string; // the lyric chunk under/after it ("" for a chord with no following text)
}

const TOKEN = /\[([^\]]*)\]/g;

/**
 * Split a line into segments. Each [X] starts a new segment carrying the text
 * that follows it until the next [X]. Leading text before the first chord
 * becomes a chordless segment.
 *
 *   "Vì [Am]ta đã [Em]lang bạt"
 *   -> [{text:"Vì "}, {chord:"Am", text:"ta đã "}, {chord:"Em", text:"lang bạt"}]
 */
export function parseInline(text: string): Seg[] {
  const segs: Seg[] = [];
  let lastIndex = 0;
  let pending: string | undefined; // chord awaiting its text
  let m: RegExpExecArray | null;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(text)) !== null) {
    const before = text.slice(lastIndex, m.index);
    if (pending !== undefined) {
      segs.push({ chord: pending, text: before });
    } else if (before.length > 0) {
      segs.push({ text: before });
    }
    pending = m[1].trim();
    lastIndex = m.index + m[0].length;
  }
  const tail = text.slice(lastIndex);
  if (pending !== undefined) segs.push({ chord: pending, text: tail });
  else if (tail.length > 0 || segs.length === 0) segs.push({ text: tail });
  return segs;
}

/** Does this line contain any chord tokens? */
export function hasChords(text: string): boolean {
  TOKEN.lastIndex = 0;
  return TOKEN.test(text);
}

/** The chord tokens in order (for a chords-only line, or a quick summary). */
export function chordsOf(text: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(text)) !== null) out.push(m[1].trim());
  return out;
}

/**
 * Strip lyric words but keep chord tokens + spacing — the sharing transform
 * ("chord chart without lyrics"). Words become spaces so chord spacing is kept.
 */
export function stripLyrics(text: string): string {
  return parseInline(text)
    .map((s) => (s.chord ? `[${s.chord}]` : '') + s.text.replace(/\S/g, ' '))
    .join('');
}

// ---- custom chord fingerings (Ultimate-Guitar style: "Am7 [x02010]") --------

/**
 * Parse a fingering grip into 6 fret numbers, low-E → high-e (-1 = muted,
 * 0 = open). Accepts the compact form "x02010" (single digits) or the spaced
 * form "x 0 12 0 1 0" (needed for two-digit frets). Null if not 6 valid frets.
 */
export function gripToFrets(grip: string): number[] | null {
  const t = grip.trim();
  const toks = /\s/.test(t) ? t.split(/\s+/) : [...t];
  if (toks.length !== 6) return null;
  const out: number[] = [];
  for (const tk of toks) {
    if (/^[xX]$/.test(tk)) out.push(-1);
    else if (/^\d{1,2}$/.test(tk)) out.push(parseInt(tk, 10));
    else return null;
  }
  return out;
}

/** True if `grip` is a well-formed 6-string fingering. */
export function isGrip(grip: string): boolean {
  return gripToFrets(grip) !== null;
}

/** Chord name → grip, collected from a chart's chorddef objects. */
export function chordDefs(objects: SongObject[]): Record<string, string> {
  const m: Record<string, string> = {};
  for (const o of objects) if (o.type === 'chorddef') m[o.name] = o.grip;
  return m;
}

// ---- transpose ------------------------------------------------------------
// Non-destructive: the inline [X] text stays canonical; a transpose is applied
// at render (and on export). Spelling defaults to sharps — good enough; a
// key-aware speller can come later.

const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTE_IDX: Record<string, number> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, Fb: 4, F: 5, 'E#': 5,
  'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11, Cb: 11,
};

function shiftNote(note: string, semis: number): string | null {
  const i = NOTE_IDX[note];
  if (i === undefined) return null;
  return SHARPS[(((i + semis) % 12) + 12) % 12];
}

/** Transpose a chord NAME by `semis` semitones, keeping its quality suffix and
 *  shifting a slash-bass note too. Returns the input unchanged if it has no
 *  recognizable root (so non-chord tokens pass through). */
export function transposeChordName(name: string, semis: number): string {
  if (!semis) return name;
  const m = name.match(/^([A-G][#b]?)(.*)$/);
  if (!m) return name;
  const root = shiftNote(m[1], semis);
  if (!root) return name;
  let rest = m[2];
  const slash = rest.match(/^(.*)\/([A-G][#b]?)(.*)$/);
  if (slash) {
    const bass = shiftNote(slash[2], semis);
    if (bass) rest = `${slash[1]}/${bass}${slash[3]}`;
  }
  return root + rest;
}

/** Transpose every inline [X] token in a line of text. */
export function transposeText(text: string, semis: number): string {
  if (!semis) return text;
  return text.replace(/\[([^\]]*)\]/g, (_, c) => `[${transposeChordName(String(c).trim(), semis)}]`);
}
