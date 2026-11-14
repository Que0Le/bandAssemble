// Parse a plain-text chord sheet back into objects — the inverse of
// serialize.ts, so paste -> edit -> copy round-trips. Recognizes:
//   Name [x02010]        -> chorddef   (custom chord fingering; not timed)
//   [Section]            -> label      (whole-line bracket, not a chord)
//   @kind text           -> line       (typed flow line: @solo, @instrumental, …)
//   e| / B| / G| ...     -> tab block  (consecutive string rows)
//   ↓ ↑ × > ~ (glyphs)   -> strum      (attached to the line above, else its own)
//   (anything)           -> note       (attached to the line above, else its own)
//   everything else      -> line       (a lyric flow line with inline [chords])
// See ../../03-data-model.md.

import type { SongObject, LineObject } from './model';
import { gripToFrets } from './chords';

const SECTION_RE = /^\[([^\]]+)\]$/;
const TAB_RE = /^[eBGDAE]\s*\|/;
const STRUM_RE = /^[\s↓↑×xX><~•._/\\]+$/u;
const NOTE_RE = /^\((.*)\)$/;
const CHORDDEF_RE = /^(\S+)\s+\[([^\]]+)\]$/; // "Am7 [x02010]" / "Am7 [x 0 12 0 1 0]"
const KIND_RE = /^@([\w-]+)\s*(.*)$/u; // "@solo Lead break"
const hasArrow = (s: string) => /[↓↑]/u.test(s);
const looksChord = (t: string) =>
  /^[A-G][#b]?(m|maj|min|dim|aug|sus|add|M)?\d{0,2}(sus\d)?(\/[A-G][#b]?)?$/.test(t);

let uid = 0;
const nid = () => `e${uid++}`;

export function parseSheet(text: string): SongObject[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const objs: SongObject[] = [];
  let last: LineObject | null = null; // line that trailing strum/note attach to
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];
    const t = raw.trim();

    if (t === '') {
      last = null;
      i++;
      continue;
    }

    // tab block: gather consecutive string rows
    if (TAB_RE.test(t)) {
      const tabLines: string[] = [];
      while (i < lines.length && TAB_RE.test(lines[i].trim())) {
        tabLines.push(lines[i].replace(/\s+$/, ''));
        i++;
      }
      objs.push({ type: 'tab', id: nid(), startSec: 0, endSec: 0, lines: tabLines });
      last = null;
      continue;
    }

    // custom chord fingering: "Am7 [x02010]" (a chord name + a valid grip)
    const cdm = t.match(CHORDDEF_RE);
    if (cdm && looksChord(cdm[1]) && gripToFrets(cdm[2])) {
      objs.push({
        type: 'chorddef',
        id: nid(),
        startSec: 0,
        endSec: 0,
        name: cdm[1].trim(),
        grip: cdm[2].trim(),
      });
      last = null;
      i++;
      continue;
    }

    // section label (a whole-line bracket whose content isn't a chord)
    const sm = t.match(SECTION_RE);
    if (sm && !looksChord(sm[1].trim())) {
      objs.push({ type: 'label', id: nid(), startSec: 0, endSec: 0, text: sm[1].trim() });
      last = null;
      i++;
      continue;
    }

    // typed flow line: "@solo …", "@instrumental …" (kind + optional text)
    const km = t.match(KIND_RE);
    if (km) {
      const lo: LineObject = {
        type: 'line',
        id: nid(),
        startSec: 0,
        endSec: 0,
        kind: km[1],
        text: km[2].trim() || undefined,
      };
      objs.push(lo);
      last = lo;
      i++;
      continue;
    }

    // strum line — keep leading/internal spaces (players align strokes to the
    // words above); only strip trailing whitespace.
    if (hasArrow(t) && STRUM_RE.test(t)) {
      const strum = raw.replace(/\s+$/, '');
      if (last) last.strum = strum;
      else objs.push({ type: 'line', id: nid(), startSec: 0, endSec: 0, strum });
      i++;
      continue;
    }

    // note line in parentheses
    const nm = t.match(NOTE_RE);
    if (nm) {
      if (last) last.note = nm[1].trim();
      else objs.push({ type: 'line', id: nid(), startSec: 0, endSec: 0, note: nm[1].trim() });
      i++;
      continue;
    }

    // default: a lyric / chord line (keep inline [chords] verbatim)
    const lo: LineObject = { type: 'line', id: nid(), startSec: 0, endSec: 0, text: raw.trim() };
    objs.push(lo);
    last = lo;
    i++;
  }

  return objs;
}

/**
 * Re-apply timings from a previous version of a chart after re-parsing its text
 * (the sheet format carries no per-object times). Objects that line up by index
 * keep their old start/end; trailing new objects continue after the last known
 * time. Good enough for text edits that don't reorder; re-time in the full
 * editor for big structural changes.
 */
export function reTime(next: SongObject[], prev: SongObject[]): SongObject[] {
  let t = 0;
  for (let i = 0; i < next.length; i++) {
    if (i < prev.length) {
      next[i].startSec = prev[i].startSec;
      next[i].endSec = prev[i].endSec;
      t = prev[i].endSec;
    } else {
      next[i].startSec = t;
      if (next[i].type !== 'label' && next[i].type !== 'chorddef') t += 3;
      next[i].endSec = t;
    }
  }
  return next;
}

/**
 * Assign simple sequential times so a freshly parsed sheet has an order to edit.
 * Each timed object gets `perSec` seconds; labels take the next object's start.
 * The user then refines with tap-to-time.
 */
export function autoTime(objs: SongObject[], perSec = 3): SongObject[] {
  let t = 0;
  for (const o of objs) {
    if (o.type === 'label' || o.type === 'chorddef') {
      o.startSec = t;
      o.endSec = t;
    } else {
      o.startSec = t;
      t += perSec;
      o.endSec = t;
    }
  }
  return objs;
}
