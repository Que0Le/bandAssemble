// Turn an align() result into the app's own model — the app already stores a
// line as ChordPro inline text ("[Am]There is a house") with one startSec/endSec,
// so emitting is: build the ChordPro string per matched line + set its start/end
// from the LRC timing. Also exports the same content to the two ecosystem
// standards (ChordPro, LRC) — no bespoke format invented.

import type { SongObject } from '../model';
import type { AlignedChart } from './align';
import type { ParsedChord } from './chordsheet';

let uid = 0;
const nid = () => `imp${uid++}`;
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Insert [chord] markers into a lyric at their character offsets (right-to-left
 *  so earlier offsets stay valid) → a ChordPro line. */
export function chordProLine(lyrics: string, chords: ParsedChord[]): string {
  if (!chords || !chords.length) return lyrics;
  let s = lyrics;
  for (const c of [...chords].sort((a, b) => b.offset - a.offset)) {
    const off = Math.max(0, Math.min(c.offset, s.length));
    s = s.slice(0, off) + `[${c.chord}]` + s.slice(off);
  }
  return s;
}

const stripChords = (text: string) => (text ?? '').replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();

/** align() result → SongObject[] (the app's timed flow). */
export function buildObjects(aligned: AlignedChart): SongObject[] {
  const lineObjs: SongObject[] = aligned.lines.map((l, i) => {
    const next = i + 1 < aligned.lines.length ? aligned.lines[i + 1].time : aligned.lengthSec;
    const endSec = Math.max(l.time, r1(next));
    if (l.matched && l.source) {
      return { type: 'line', id: nid(), startSec: l.time, endSec, text: chordProLine(l.source.lyrics, l.source.chords) };
    }
    if (!l.lyrics.trim()) return { type: 'line', id: nid(), startSec: l.time, endSec, kind: 'instrumental' };
    return { type: 'line', id: nid(), startSec: l.time, endSec, text: l.lyrics };
  });
  const labelObjs: SongObject[] = aligned.labels.map((lb) => ({
    type: 'label',
    id: nid(),
    startSec: lb.time,
    endSec: lb.time,
    text: lb.label,
  }));
  return [...labelObjs, ...lineObjs].sort((a, b) => a.startSec - b.startSec || (a.type === 'label' ? -1 : 1));
}

export interface ChartJson {
  title: string;
  roleId: string;
  objects: SongObject[];
}

/** SongObject[] → the Chart shape the app's Editor imports verbatim
 *  ({title, roleId, objects}). This is what "Use as sheet" feeds in. */
export function toChartJson(objs: SongObject[], meta: { title?: string | null; roleId?: string } = {}): ChartJson {
  return { title: meta.title || 'Imported song', roleId: meta.roleId || 'guitar', objects: objs };
}

export interface ExportMeta {
  title?: string | null;
  artist?: string | null;
  lengthSec?: number;
}

/** SongObject[] → ChordPro (.cho). Lines are already ChordPro; labels → {comment}. */
export function toChordPro(objs: SongObject[], meta: ExportMeta = {}): string {
  const out: string[] = [];
  if (meta.title) out.push(`{title: ${meta.title}}`);
  if (meta.artist) out.push(`{artist: ${meta.artist}}`);
  out.push('');
  for (const o of objs) {
    if (o.type === 'label') out.push(`{comment: ${o.text}}`);
    else if (o.type === 'line') out.push(o.text ? o.text : `{comment: ${o.kind || '…'}}`);
  }
  return out.join('\n').trim() + '\n';
}

const lrcStamp = (t: number): string => {
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(2).padStart(5, '0');
  return `[${String(m).padStart(2, '0')}:${s}]`;
};

/** SongObject[] → LRC (.lrc). Plain lyrics (chords stripped) with line times. */
export function toLrc(objs: SongObject[], meta: ExportMeta = {}): string {
  const out: string[] = [];
  if (meta.title) out.push(`[ti:${meta.title}]`);
  if (meta.artist) out.push(`[ar:${meta.artist}]`);
  if (meta.lengthSec) out.push(`[length:${lrcStamp(meta.lengthSec).slice(1, -1)}]`);
  for (const o of objs) {
    if (o.type === 'line' && o.text) {
      const plain = stripChords(o.text);
      if (plain) out.push(`${lrcStamp(o.startSec)}${plain}`);
    }
  }
  return out.join('\n') + '\n';
}
