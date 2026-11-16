// Merge a timing-free chord model (chordsheet.ts) with a timed LRC (lrc.ts) into
// a TIMED chart. The lyrics are the join key — "best match with reuse": each LRC
// line borrows chords from the most similar pasted line, so a repeated chorus
// reuses the one pasted chorus with no special-casing. A single global `offset`
// shifts everything to lock the chart to the track the band plays along to.

import type { ParsedSheet, ParsedChord } from './chordsheet';
import type { LrcDoc } from './lrc';

const THRESHOLD = 0.34;

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(s: string): string[] {
  const n = normalize(s);
  return n ? n.split(' ') : [];
}

export function similarity(aToks: string[], bToks: string[]): number {
  if (!aToks.length || !bToks.length) return 0;
  const A = new Set(aToks);
  const B = new Set(bToks);
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const jaccard = inter / (A.size + B.size - inter);
  const exact = aToks.join(' ') === bToks.join(' ') ? 0.15 : 0;
  return Math.min(1, jaccard + exact);
}

interface Candidate {
  lyrics: string;
  chords: ParsedChord[];
  section: string | null;
  firstOfSection: boolean;
  toks: string[];
}

function candidateLines(model: ParsedSheet): Candidate[] {
  const cands: Candidate[] = [];
  let section: string | null = null;
  let firstOfSection = false;
  for (const line of model.lines) {
    if (line.kind === 'section') {
      section = line.label ?? null;
      firstOfSection = true;
      continue;
    }
    const lyrics = line.lyrics ?? '';
    if (!lyrics.trim()) continue;
    cands.push({ lyrics, chords: line.chords ?? [], section, firstOfSection, toks: tokens(lyrics) });
    firstOfSection = false;
  }
  return cands;
}

export interface AlignedChordTime {
  chord: string;
  time: number;
}
export interface AlignedLine {
  time: number;
  dur: number;
  lyrics: string;
  matched: boolean;
  sim: number;
  source: { lyrics: string; chords: ParsedChord[]; section: string | null } | null;
  chords: AlignedChordTime[];
}
export interface AlignedChart {
  title: string | null;
  artist: string | null;
  lengthSec: number;
  offset: number;
  coverage: number;
  labels: Array<{ time: number; label: string }>;
  lines: AlignedLine[];
  events: AlignedChordTime[];
}

export interface AlignOpts {
  offset?: number;
  songLength?: number;
}

export function align(model: ParsedSheet, lrc: LrcDoc, opts: AlignOpts = {}): AlignedChart {
  const offset = opts.offset ?? 0;
  const songLength = opts.songLength ?? lrc.lengthSec ?? 0;
  const cands = candidateLines(model);

  const emittedSections = new Set<string>();
  const labels: Array<{ time: number; label: string }> = [];
  const lines: AlignedLine[] = [];
  const events: AlignedChordTime[] = [];

  for (let i = 0; i < lrc.lines.length; i++) {
    const cur = lrc.lines[i];
    const start = cur.time + offset;
    const nextRaw = i + 1 < lrc.lines.length ? lrc.lines[i + 1].time : songLength;
    const dur = Math.max(0.1, nextRaw + offset - start);

    const lt = tokens(cur.text);
    let best: Candidate | null = null;
    let bestSim = 0;
    for (const c of cands) {
      const sim = similarity(lt, c.toks);
      if (sim > bestSim) {
        bestSim = sim;
        best = c;
      }
    }

    const matched = !!best && bestSim >= THRESHOLD;
    const chords: AlignedChordTime[] = [];
    if (matched && best) {
      const len = best.lyrics.length || 1;
      for (const ch of best.chords) {
        const t = start + (Math.min(ch.offset, len) / len) * dur;
        chords.push({ chord: ch.chord, time: round(t) });
        events.push({ chord: ch.chord, time: round(t) });
      }
      if (best.firstOfSection && best.section && !emittedSections.has(best.section)) {
        emittedSections.add(best.section);
        labels.push({ time: round(start), label: best.section });
      }
    }

    lines.push({
      time: round(start),
      dur: round(dur),
      lyrics: cur.text,
      matched,
      sim: round(bestSim, 2),
      source: matched && best ? { lyrics: best.lyrics, chords: best.chords, section: best.section } : null,
      chords,
    });
  }

  events.sort((a, b) => a.time - b.time);
  return {
    title: lrc.title || model.title,
    artist: lrc.artist || model.artist,
    lengthSec: round(songLength),
    offset,
    coverage: round(lines.filter((l) => l.matched).length / (lines.length || 1), 2),
    labels,
    lines,
    events,
  };
}

function round(n: number, p = 1): number {
  const f = 10 ** p;
  return Math.round(n * f) / f;
}
