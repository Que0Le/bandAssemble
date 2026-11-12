// Inline-chord parsing. Chords live inside the lyric text as [X] tokens.
// The parser only recognizes the tokens for display/transpose; the text is
// the source of truth. See ../../03-data-model.md.

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
