// The real arrangement model — a flat array of timed objects.
// See ../../03-data-model.md. Positions are seconds into the master audio.

export interface ObjBase {
  id: string;
  startSec: number;
  endSec: number; // for 'label' this is ignored (a label is a point)
  roles?: string[]; // optional: role ids that see this object (omit = everyone)
}

// The workhorse — one displayed line-block. text/strum/note all optional:
//   text only         -> sung lyric line
//   text = chords only -> instrumental bar, e.g. "[Em] [Em] [Am] [C]"
//   strum only         -> a rhythm-only line
//   note only          -> a cue
export interface LineObject extends ObjBase {
  type: 'line';
  text?: string; // lyrics with EMBEDDED inline chords: "[Em]So close how [D]far"
  strum?: string; // rhythm row shown below (Unicode glyphs: down up x > ~)
  note?: string; // free annotation shown below
}

// A section name / jump target. A point in time.
export interface LabelObject extends ObjBase {
  type: 'label';
  text: string; // "Intro", "Verse 1", "Chorus"
  color?: string;
}

// Escape hatch: multi-line guitar tab (GuitarPro/TuxGuitar-style), as text rows.
export interface TabObject extends ObjBase {
  type: 'tab';
  lines: string[];
  caption?: string;
}

export type SongObject = LineObject | LabelObject | TabObject;

export interface Project {
  schemaVersion: 2;
  id: string;
  title: string;
  lengthSec: number; // master audio length; positions are seconds into it
  bpm?: number; // optional, for the metronome only
  objects: SongObject[]; // ordered by startSec
}

// ---- helpers -------------------------------------------------------------

/** Index of the object whose time range contains `head` (objects ordered by start). */
export function objectIndexAt(objects: SongObject[], head: number): number {
  let idx = -1;
  for (let i = 0; i < objects.length; i++) {
    if (objects[i].startSec <= head) idx = i;
    else break;
  }
  return idx;
}

/** The start time of the object after `i` (or the song end). */
export function nextStart(p: Project, i: number): number {
  return i < p.objects.length - 1 ? p.objects[i + 1].startSec : p.lengthSec;
}

/** Label objects as simple jump targets. */
export function labels(p: Project): Array<{ atSec: number; label: string }> {
  return p.objects
    .filter((o): o is LabelObject => o.type === 'label')
    .map((o) => ({ atSec: o.startSec, label: o.text }));
}

// ---- sample arrangement (a Vietnamese ballad) ----------------------------
// Exercises every object type: label, line (text+chords), strum, note,
// chords-only line, and a tab block. Timings are synthetic but plausible.

let n = 0;
const id = () => `o${n++}`;
const line = (
  startSec: number,
  endSec: number,
  text?: string,
  strum?: string,
  note?: string,
): LineObject => ({ type: 'line', id: id(), startSec, endSec, text, strum, note });
const label = (startSec: number, text: string): LabelObject => ({
  type: 'label',
  id: id(),
  startSec,
  endSec: startSec,
  text,
});

export const PROJECT: Project = {
  schemaVersion: 2,
  id: 'sample-ballad',
  title: 'Đường còn dài (demo)',
  lengthSec: 48,
  bpm: 76,
  objects: [
    label(0, 'Verse 1'),
    line(0, 3, '[G]Đường tất nhiên còn dài', '↓   ↓ ↑   ↓   ↑'),
    line(3, 6, '[D]Ai tất nhiên cũng [G]ngại'),
    line(6, 9, '[C]Nhưng sực bạn dừng [Am]chân một bước'),
    line(9, 12, '[A7]Đưa mắt ngước lên [D]chông'),
    line(12, 15, '[G]Thời giờ tất nhiên không nhiều'),
    line(15, 18, '[D]Trời giờ đã buông ngân [G]chiều'),
    line(18, 21, 'Nhưng [C]hoa những ngày mà [Am]không biết ngắm'),
    line(21, 24, '[D]Đời phí lắm biết [G]không'),
    line(24, 26, '[C] [G]', undefined, 'turnaround'),
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
  ],
};
