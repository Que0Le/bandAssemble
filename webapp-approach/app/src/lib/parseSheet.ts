// Parse a plain-text chord sheet back into objects — the inverse of
// serialize.ts, so paste -> edit -> copy round-trips. Recognizes:
//   Name [x02010]        -> chorddef   (custom chord fingering; not timed)
//   [Section]            -> label      (whole-line bracket, not a chord)
//   @kind text           -> line       (typed flow line: @solo, @instrumental, …)
//   ```tab (caption)     -> tab block  (fenced; blank line splits systems)
//   e| / B| / G| ...     -> tab block  (consecutive labelled string rows)
//   ↓ ↑ × > ~ (glyphs)   -> strum      (attached to the line above, else its own)
//   (anything)           -> note       (attached to the line above, else its own)
//   everything else      -> line       (a lyric flow line with inline [chords])
// See ../../03-data-model.md.

import type { SongObject, LineObject } from './model';
import { gripToFrets } from './chords';
import { r2 } from './util';

const SECTION_RE = /^\[([^\]]+)\]$/;
// Any 1–3 char string label followed by a bar: guitar (e B G D A E), bass, and
// drums (HH SD BD CC FT …) all gather into one tab block. Section/chorddef/note
// checks run first, so a lyric line isn't misread.
const TAB_RE = /^[A-Za-z]{1,3}\s*\|/;
// Explicit fence — the reliable way to mark tab, including hand-drawn /
// unlabelled rows the TAB_RE heuristic can't catch. Everything between the
// opening ```tab (optional caption) and the closing ``` is read as tab; a blank
// line inside splits systems into separate blocks, each independently timed and
// jumpable (so a long solo isn't one giant highlight on a small screen).
const FENCE_RE = /^`{3,}\s*tab\b\s*(?:\(([^)]*)\))?\s*$/i;
const FENCE_END_RE = /^`{3,}\s*$/;
const STRUM_RE = /^[\s↓↑×xX><~•._/\\]+$/u;
const NOTE_RE = /^\((.*)\)$/;
const CHORDDEF_RE = /^(\S+)\s+\[([^\]]+)\]$/; // "Am7 [x02010]" / "Am7 [x 0 12 0 1 0]"
const KIND_RE = /^@([\w-]+)\s*(.*)$/u; // "@solo Lead break"
const hasArrow = (s: string) => /[↓↑]/u.test(s);
const looksChord = (t: string) =>
  /^[A-G][#b]?(m|maj|min|dim|aug|sus|add|M)?\d{0,2}(sus\d)?(\/[A-G][#b]?)?$/.test(t);

let uid = 0;
const nid = () => `e${uid++}`;

// A standalone "(…)" note object directly above a tab block becomes its caption;
// pop it off so it isn't also rendered as a separate note line. Shared by the
// fenced and labelled tab branches.
function captionFromPrev(objs: SongObject[]): string | undefined {
  const prev = objs[objs.length - 1];
  if (prev && prev.type === 'line' && prev.note && !prev.text && !prev.strum) {
    objs.pop();
    return prev.note;
  }
  return undefined;
}

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

    // fenced tab: ```tab (caption) … ``` — unlabelled / hand-drawn rows work,
    // and a blank line inside splits systems into separate blocks (each timed
    // and jumpable). The caption rides on the first block.
    const fm = t.match(FENCE_RE);
    if (fm) {
      i++; // consume the opening fence line
      // caption: inline "(…)" on the fence line, else a standalone "(…)" above.
      let caption = fm[1]?.trim() || captionFromPrev(objs);
      let cur: string[] = [];
      const flush = () => {
        if (!cur.length) return;
        objs.push({ type: 'tab', id: nid(), startSec: 0, endSec: 0, lines: cur, ...(caption ? { caption } : {}) });
        caption = undefined; // first block only
        cur = [];
      };
      while (i < lines.length && !FENCE_END_RE.test(lines[i].trim())) {
        const row = lines[i].replace(/\s+$/, '');
        if (row.trim() === '') flush();
        else cur.push(row);
        i++;
      }
      flush();
      if (i < lines.length) i++; // consume the closing fence
      last = null;
      continue;
    }

    // tab block: gather consecutive string rows
    if (TAB_RE.test(t)) {
      const tabLines: string[] = [];
      while (i < lines.length && TAB_RE.test(lines[i].trim())) {
        tabLines.push(lines[i].replace(/\s+$/, ''));
        i++;
      }
      // A standalone "(…)" note immediately above becomes the block's caption.
      const caption = captionFromPrev(objs);
      objs.push({ type: 'tab', id: nid(), startSec: 0, endSec: 0, lines: tabLines, ...(caption ? { caption } : {}) });
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

/** A content key for time-carry: two objects with the same key are "the same
 *  block" regardless of position, so their timing is preserved across a re-parse. */
function timeKey(o: SongObject): string {
  const S = '\u0001';
  if (o.type === 'label') return 'L' + S + o.text;
  if (o.type === 'tab') return 'T' + S + o.lines.join(S);
  if (o.type === 'chorddef') return 'C' + S + o.name + S + o.grip;
  return 'l' + S + (o.text ?? '') + S + (o.strum ?? '') + S + (o.note ?? '') + S + (o.kind ?? '');
}

/**
 * Carry per-object times across a re-parse, matched by CONTENT (not index), so
 * inserting, editing or reordering a block keeps every *other* block's times;
 * only new/changed blocks get a sequential placeholder to tap. This is what the
 * Editor uses on re-parse so adding a solo tab mid-song doesn't wipe your timing.
 */
export function carryTimes(next: SongObject[], prev: SongObject[]): SongObject[] {
  const pools = new Map<string, Array<{ s: number; e: number }>>();
  for (const o of prev) {
    const k = timeKey(o);
    let q = pools.get(k);
    if (!q) pools.set(k, (q = []));
    q.push({ s: o.startSec, e: o.endSec });
  }
  let t = 0;
  for (const o of next) {
    const hit = pools.get(timeKey(o))?.shift();
    if (hit) {
      o.startSec = hit.s;
      o.endSec = hit.e;
      t = hit.e;
    } else {
      o.startSec = t;
      if (o.type !== 'label' && o.type !== 'chorddef') t += 3;
      o.endSec = t;
    }
  }
  // Keep the timed flow strictly increasing in start, so an inserted block that
  // landed exactly on its neighbour's start (two blocks were back-to-back, no gap
  // to borrow) stays reachable: objectIndexAt resolves a tie to the LATER index,
  // which would otherwise hide the earlier block (you could jump to 1 and 3 but
  // not an inserted 2). Labels/chorddefs are markers that may share a line's
  // start, so they don't participate. The nudge is 0.01s — imperceptible.
  let prevStart = -Infinity;
  for (const o of next) {
    if (o.type === 'label' || o.type === 'chorddef') continue;
    if (o.startSec <= prevStart) {
      o.startSec = r2(prevStart + 0.01);
      if (o.endSec < o.startSec) o.endSec = o.startSec;
    }
    prevStart = o.startSec;
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
