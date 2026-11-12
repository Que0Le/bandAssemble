// Canonical text form of an arrangement — the single source of truth for
// "copy the chart as text". The stored line `text` already carries inline
// [chords], so serializing is mostly joining rows; this is the inverse that
// guarantees a clean, paste-able chord sheet. See ../../03-data-model.md.

import type { Project, SongObject } from './model';

/** One object as its text block (no trailing newline). */
export function objectText(o: SongObject): string {
  if (o.type === 'label') return `[${o.text}]`; // section header on its own line
  if (o.type === 'tab') {
    const cap = o.caption ? `${o.caption}\n` : '';
    return cap + o.lines.join('\n');
  }
  // line: lyric(+chords), then strum, then note — each on its own row
  const rows: string[] = [];
  if (o.text) rows.push(o.text);
  if (o.strum) rows.push(o.strum);
  if (o.note) rows.push(`(${o.note})`);
  return rows.join('\n');
}

/** Just the objects, as sheet text (no title) — used by the editor. */
export function objectsText(objects: SongObject[]): string {
  const out: string[] = [];
  for (const o of objects) {
    if (o.type === 'label') out.push(''); // blank line before a section
    out.push(objectText(o));
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/** The whole arrangement as a copy-ready chord sheet (title + body). */
export function projectText(p: Project): string {
  return `${p.title}\n\n${objectsText(p.objects)}`;
}
