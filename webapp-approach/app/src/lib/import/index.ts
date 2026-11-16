// Public surface of the song-import pipeline. Import from here, not the
// individual modules. `buildImport` is the one-call facade: raw paste → a timed
// chart in every form the UI needs, so callers don't orchestrate the steps.

export * from './chordsheet';
export * from './lrc';
export * from './align';
export * from './emit';

import type { SongObject } from '../model';
import { parseChordSheet } from './chordsheet';
import { parseLrc } from './lrc';
import { align, type AlignedChart } from './align';
import { buildObjects, toChartJson, type ChartJson } from './emit';

export interface ImportMeta {
  title: string | null;
  artist: string | null;
  lengthSec: number;
}
export interface ImportResult {
  aligned: AlignedChart | null; // null until both a chord sheet and an LRC are present
  objects: SongObject[]; // the app's timed flow
  meta: ImportMeta;
  chart: ChartJson | null; // {title, roleId, objects} — the Editor's import shape
}

const EMPTY: ImportResult = {
  aligned: null,
  objects: [],
  meta: { title: null, artist: null, lengthSec: 0 },
  chart: null,
};

/** Paste (Ultimate Guitar / ChordPro) + LRC → a timed chart, aligned on lyrics.
 *  Returns everything the UI renders and exports. Never throws: malformed or
 *  empty input yields an empty result. */
export function buildImport(chordsText: string, lrcText: string, offset = 0): ImportResult {
  if (!chordsText.trim() || !lrcText.trim()) return EMPTY;
  let aligned: AlignedChart;
  try {
    aligned = align(parseChordSheet(chordsText), parseLrc(lrcText), { offset });
  } catch {
    return EMPTY;
  }
  const objects = buildObjects(aligned);
  const meta: ImportMeta = { title: aligned.title, artist: aligned.artist, lengthSec: aligned.lengthSec };
  return { aligned, objects, meta, chart: toChartJson(objects, meta) };
}
