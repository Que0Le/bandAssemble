// Canonical text form of an arrangement — the single source of truth for
// "copy the chart as text". The stored line `text` already carries inline
// [chords], so serializing is mostly joining rows; this is the inverse that
// guarantees a clean, paste-able chord sheet. See ../../03-data-model.md.

import type { SongObject } from './model';

/** One object as its text block (no trailing newline). */
export function objectText(o: SongObject): string {
  if (o.type === 'label') return `[${o.text}]`; // section header on its own line
  if (o.type === 'chorddef') return `${o.name} [${o.grip}]`; // custom fingering
  if (o.type === 'tab') {
    // Fence it so it always re-parses back to one block, even unlabelled rows.
    const cap = o.caption ? ` (${o.caption})` : '';
    return '```tab' + cap + '\n' + o.lines.join('\n') + '\n```';
  }
  // line: the flow row (@kind prefix for non-lyric), then strum, then note
  const rows: string[] = [];
  if (o.kind && o.kind !== 'lyric') rows.push(`@${o.kind}${o.text ? ' ' + o.text : ''}`);
  else if (o.text) rows.push(o.text);
  if (o.strum) rows.push(o.strum);
  if (o.note) rows.push(`(${o.note})`);
  return rows.join('\n');
}

/** Just the objects, as sheet text (no title) — used by the editor. */
export function objectsText(objects: SongObject[]): string {
  const out: string[] = [];
  for (const o of objects) {
    if (o.type === 'label' || o.type === 'tab') out.push(''); // blank before a section / tab block
    out.push(objectText(o));
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/** A copy-ready chord sheet for one chart: title + body. */
export function sheet(title: string, objects: SongObject[]): string {
  return `${title}\n\n${objectsText(objects)}`;
}
