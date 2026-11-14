// The arrangement model — a shared Base plus one Chart per Role.
// See ../../03-data-model.md and ../SPEC.md §Terminology.
// Positions are seconds into the master audio.

export interface ObjBase {
  id: string;
  startSec: number;
  endSec: number; // for 'label' this is ignored (a label is a point)
}

// The workhorse — one displayed flow line. kind says what it is (lyric by
// default, else solo / instrumental / … — an open set); text/strum/note optional.
export interface LineObject extends ObjBase {
  type: 'line';
  kind?: string; // flow-line kind: undefined/'lyric' = a sung line; else 'solo', 'instrumental', …
  text?: string; // lyrics with EMBEDDED inline chords: "[Em]So close how [D]far"
  strum?: string; // rhythm row shown below (Unicode glyphs; spaces preserved)
  note?: string; // free annotation shown below
}

// A section name / jump target. A point in time.
export interface LabelObject extends ObjBase {
  type: 'label';
  text: string;
  color?: string;
}

// Escape hatch: multi-line guitar tab (GuitarPro/TuxGuitar-style), as text rows.
export interface TabObject extends ObjBase {
  type: 'tab';
  lines: string[];
  caption?: string;
}

// A custom chord fingering ("Am7 [x02010]"). NOT part of the timed flow — an
// annotation that feeds the chord diagrams. grip is a 6-string fingering.
export interface ChordDefObject extends ObjBase {
  type: 'chorddef';
  name: string; // "Am7"
  grip: string; // "x02010" or spaced "x 0 12 0 1 0" — see lib/chords gripToFrets
}

export type SongObject = LineObject | LabelObject | TabObject | ChordDefObject;

// ---- Roles & Charts ------------------------------------------------------

export type InstrumentKind = 'vocals' | 'guitar' | 'bass' | 'keys' | 'drums' | 'other';

/** A musical part. `kind` is only a hint for default notation. */
export interface Role {
  id: string; // "guitar", "vocal1", "bass"…
  kind: InstrumentKind;
  label: string; // "Guitar", "Vocal 1"
}

/** One Role's notation: a flat, ordered array of timed objects. */
export interface Chart {
  roleId: string;
  objects: SongObject[]; // kept sorted by startSec
}

export interface AudioRef {
  fileName: string;
  durationSec: number;
}

/** The Maestro-authored skeleton every Chart clones from. */
export interface Base {
  audio?: AudioRef; // the file itself lives only on the Maestro
  lengthSec: number; // master audio length; positions are seconds into it
  bpm?: number; // optional, for the metronome only
  lyrics: SongObject[]; // timed lyric lines (+ labels): the clonable skeleton
}

export interface Project {
  schemaVersion: 4;
  id: string;
  title: string;
  base: Base;
  roles: Role[];
  charts: Record<string, Chart>; // roleId -> Chart
}

// ---- helpers -------------------------------------------------------------

/** Index of the flow object whose time range contains `head` (objects ordered by
 *  start). Chord-def objects aren't part of the flow, so they're never returned. */
export function objectIndexAt(objects: SongObject[], head: number): number {
  let idx = -1;
  for (let i = 0; i < objects.length; i++) {
    if (objects[i].type === 'chorddef') continue; // not timed; skip for highlighting
    if (objects[i].startSec <= head) idx = i;
    else break;
  }
  return idx;
}

/** Start time of the object after `i`, or `lengthSec` for the last one. */
export function nextStart(objects: SongObject[], i: number, lengthSec: number): number {
  return i < objects.length - 1 ? objects[i + 1].startSec : lengthSec;
}

/** Label objects as simple jump targets. */
export function labels(objects: SongObject[]): Array<{ atSec: number; label: string }> {
  return objects
    .filter((o): o is LabelObject => o.type === 'label')
    .map((o) => ({ atSec: o.startSec, label: o.text }));
}

/** Deep-copy objects with fresh ids (used when cloning the Base into a Chart). */
export function cloneObjects(objs: SongObject[]): SongObject[] {
  return objs.map((o) => ({ ...o, id: id(), ...(o.type === 'tab' ? { lines: [...o.lines] } : {}) }));
}

// ---- sample arrangement (a Vietnamese ballad) ----------------------------

let n = 0;
const id = () => `o${n++}`;
const line = (
  startSec: number,
  endSec: number,
  text?: string,
  strum?: string,
  note?: string,
  kind?: string,
): LineObject => ({ type: 'line', id: id(), startSec, endSec, text, strum, note, ...(kind ? { kind } : {}) });
const label = (startSec: number, text: string): LabelObject => ({
  type: 'label',
  id: id(),
  startSec,
  endSec: startSec,
  text,
});
const cdef = (name: string, grip: string): ChordDefObject => ({
  type: 'chorddef',
  id: id(),
  startSec: 0,
  endSec: 0,
  name,
  grip,
});

// The Guitar chart — the rich part (chords + strum + a solo tab).
const guitarObjects: SongObject[] = [
  cdef('Am7', 'x02010'),
  cdef('D/F#', '2x023x'),
  label(0, 'Verse 1'),
  line(0, 3, '[G]Đường tất nhiên còn dài', '↓   ↓ ↑   ↓   ↑'),
  line(3, 6, '[D]Ai tất nhiên cũng [G]ngại'),
  line(6, 9, '[C]Nhưng sực bạn dừng [Am]chân một bước'),
  line(9, 12, '[A7]Đưa mắt ngước lên [D]chông'),
  line(12, 15, '[G]Thời giờ tất nhiên không nhiều'),
  line(15, 18, '[D]Trời giờ đã buông ngân [G]chiều'),
  line(18, 21, 'Nhưng [C]hoa những ngày mà [Am]không biết ngắm'),
  line(21, 24, '[D]Đời phí lắm biết [G]không'),
  line(24, 26, '[C] [G]', undefined, 'turnaround', 'instrumental'),
  label(26, 'Pre-chorus'),
  line(26, 29, 'Vì [Am]ta đã lang bạt lâu quá lâu', '↓↓ ↑ ↑↓'),
  line(29, 32, '[Em]Nhưng nghĩ thơ chẳng ra mấy câu'),
  line(32, 36, '[A7]Đừng để lại tuột mất cơ duyên trời [D]ban nhé', undefined, 'rit. — slow'),
  label(36, 'Solo'),
  {
    type: 'tab',
    id: id(),
    startSec: 36,
    endSec: 46,
    caption: 'Em lick',
    lines: [
      'e|-----------------|',
      'B|-----------------|',
      'G|-------0-2-------|',
      'D|---0-2-----2-0---|',
      'A|-2---------------|',
      'E|-----------------|',
    ],
  },
  line(46, 48, undefined, undefined, 'let ring to the end'),
];

// The Base = the lyric + timing skeleton: labels + plain lyric lines (chords,
// strum, tab and notes stripped). A Role's Chart starts as a clone of this.
function toBaseLyrics(objs: SongObject[]): SongObject[] {
  const out: SongObject[] = [];
  for (const o of objs) {
    if (o.type === 'label') {
      out.push(label(o.startSec, o.text));
    } else if (o.type === 'line') {
      const plain = (o.text ?? '').replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
      if (plain) out.push(line(o.startSec, o.endSec, plain));
    }
    // tab and chords-only / empty lines are not part of the lyric skeleton
  }
  return out;
}

const baseLyrics = toBaseLyrics(guitarObjects);

export const PROJECT: Project = {
  schemaVersion: 4,
  id: 'sample-ballad',
  title: 'Đường còn dài (demo)',
  base: { lengthSec: 48, bpm: 76, lyrics: baseLyrics },
  roles: [
    { id: 'guitar', kind: 'guitar', label: 'Guitar' },
    { id: 'vocal', kind: 'vocals', label: 'Vocal' },
  ],
  charts: {
    guitar: { roleId: 'guitar', objects: guitarObjects },
    vocal: { roleId: 'vocal', objects: cloneObjects(baseLyrics) },
  },
};
