// Drum-tab rendering — pure, no DOM. Turns per-lane onset times (seconds) into a
// classic ASCII drum tab by quantizing to a tempo grid. Non-destructive: the
// timeline keeps its raw onsets; this is only a quantized VIEW for export.

const ROWS = [
  { id: 'hh', label: 'HH', glyph: 'x' },
  { id: 'sd', label: 'SD', glyph: 'o' },
  { id: 'bd', label: 'BD', glyph: 'o' },
];

/** Rough tempo (BPM) from onset times via autocorrelation of a pulse train —
 *  enough to seed the BPM field; the user corrects it by eye. Feed it the kick +
 *  snare times (the steady pulse), not the hats. */
export function estimateTempo(times, duration) {
  if (!times.length || !duration) return 120;
  const R = 100; // bins per second
  const N = Math.ceil(duration * R);
  const pulse = new Float32Array(N);
  for (const t of times) {
    const i = Math.round(t * R);
    if (i >= 0 && i < N) pulse[i] += 1;
  }
  let best = { score: -1, lag: 0 };
  const lo = Math.round((60 / 200) * R); // 200 BPM
  const hi = Math.round((60 / 60) * R); // 60 BPM
  for (let lag = lo; lag <= hi; lag++) {
    let s = 0;
    for (let i = 0; i + lag < N; i++) s += pulse[i] * pulse[i + lag];
    if (s > best.score) best = { score: s, lag };
  }
  return best.lag ? Math.round(60 / (best.lag / R)) : 120;
}

/** Render lanes (each `{ id, onsets }`, ids hh/sd/bd) as an ASCII drum tab.
 *  `bpm` + `subdiv` (cells per beat: 2 = 8ths, 4 = 16ths) set the grid; `offset`
 *  is the downbeat time in seconds. Blocks of `barsPerLine` bars are separated by
 *  a blank line — which is also how bandAssemble's ```tab fence splits systems,
 *  so the output drops straight into a Sheet. */
export function toDrumTab(lanes, { bpm, offset = 0, subdiv = 4, beatsPerBar = 4, barsPerLine = 4 } = {}) {
  if (!bpm || bpm <= 0) return '';
  const cell = 60 / bpm / subdiv; // seconds per grid cell
  const cellsPerBar = beatsPerBar * subdiv;

  let maxT = 0;
  for (const l of lanes) for (const t of l.onsets) if (t > maxT) maxT = t;
  const neededCells = Math.max(cellsPerBar, Math.ceil((maxT - offset) / cell) + 1);
  const totalBars = Math.max(1, Math.ceil(neededCells / cellsPerBar));
  const totalCells = totalBars * cellsPerBar;

  const rowsOut = ROWS.filter((r) => lanes.some((l) => l.id === r.id)); // only emit the lanes passed in
  const grid = {};
  for (const r of rowsOut) {
    const lane = lanes.find((l) => l.id === r.id);
    const cells = new Array(totalCells).fill('-');
    if (lane) {
      for (const t of lane.onsets) {
        const idx = Math.round((t - offset) / cell);
        if (idx >= 0 && idx < totalCells) cells[idx] = r.glyph;
      }
    }
    grid[r.id] = cells;
  }

  const rowFor = (r, bar, bars) => {
    let row = r.label + '|';
    for (let b = 0; b < bars; b++) {
      const from = (bar + b) * cellsPerBar;
      row += grid[r.id].slice(from, from + cellsPerBar).join('') + '|';
    }
    return row;
  };

  const out = [];
  // the included tracks interleaved, blank line between 4-bar systems
  for (let bar = 0; bar < totalBars; bar += barsPerLine) {
    const bars = Math.min(barsPerLine, totalBars - bar);
    for (const r of rowsOut) out.push(rowFor(r, bar, bars));
    out.push('');
  }
  return out.join('\n').replace(/\n+$/, '');
}

// ---- bandAssemble export --------------------------------------------------

const r2 = (t) => Math.round(Math.max(0, t) * 100) / 100;

/** Build a bandAssemble Chart object the editor can import directly:
 *  { title, roleId, objects }. Drum bars are grouped into timed TabObjects —
 *  `barsPerBlock` bars each, or (with `alignLyrics`) broken at lyric-line
 *  boundaries so each block sticks with its lyric sentence (and is captioned
 *  with it, as a COMMENT). Every block carries its own startSec/endSec, lyric-
 *  independent, so a solo lands exactly; empty blocks are skipped. The lyric is
 *  only ever a block caption (which bandAssemble shows as a note above the tab),
 *  never its own line object. Times are numeric seconds only (the editor's clock
 *  parser takes whole-second "m:ss", so startSec carries sub-second precision). */
export function toChart(lanes, {
  bpm, offset = 0, subdiv = 4, beatsPerBar = 4, barsPerBlock = 1,
  title = 'drums', roleId = 'drums', lyrics = null, alignLyrics = false,
} = {}) {
  const objects = [];
  if (bpm > 0) {
    const cell = 60 / bpm / subdiv;
    const barDur = beatsPerBar * (60 / bpm);
    const cellsPerBar = beatsPerBar * subdiv;
    const rowsOut = ROWS.filter((r) => lanes.some((l) => l.id === r.id));
    let maxT = 0;
    for (const l of lanes) for (const t of l.onsets) if (t > maxT) maxT = t;
    const totalBars = maxT > offset ? Math.ceil((maxT - offset) / barDur) + 1 : 0;
    const grid = {};
    for (const r of rowsOut) {
      const lane = lanes.find((l) => l.id === r.id);
      const cells = new Array(totalBars * cellsPerBar).fill('-');
      if (lane) for (const t of lane.onsets) { const i = Math.round((t - offset) / cell); if (i >= 0 && i < cells.length) cells[i] = r.glyph; }
      grid[r.id] = cells;
    }

    // Block boundaries = bar indices where a new TabObject starts.
    const aligned = alignLyrics && lyrics && lyrics.length > 0;
    const barOf = (t) => Math.max(0, Math.min(totalBars, Math.round((t - offset) / barDur)));
    let bounds;
    if (aligned) {
      const set = new Set([0, totalBars]);
      for (const l of lyrics) set.add(barOf(l.t)); // a new block at each lyric line
      bounds = [...set].sort((a, b) => a - b);
    } else {
      const step = Math.max(1, barsPerBlock);
      bounds = [];
      for (let b = 0; b <= totalBars; b += step) bounds.push(Math.min(b, totalBars));
      if (bounds[bounds.length - 1] !== totalBars) bounds.push(totalBars);
    }
    const lyricByBar = new Map();
    if (aligned) for (const l of lyrics) lyricByBar.set(barOf(l.t), l); // the lyric that opens each block

    for (let i = 0; i < bounds.length - 1; i++) {
      const startBar = bounds[i];
      const endBar = bounds[i + 1];
      if (endBar <= startBar) continue;
      const nbars = endBar - startBar;
      const lines = rowsOut.map((r) => {
        let row = r.label + '|';
        for (let b = 0; b < nbars; b++) { const from = (startBar + b) * cellsPerBar; row += grid[r.id].slice(from, from + cellsPerBar).join('') + '|'; }
        return row;
      });
      if (!lines.some((ln) => /[xo]/.test(ln))) continue; // skip blocks with no hits
      const start = offset + startBar * barDur;
      const end = offset + endBar * barDur;
      let caption;
      if (aligned) {
        const ly = lyricByBar.get(startBar);
        caption = ly ? ly.text.slice(0, 48) : `bars ${startBar + 1}–${endBar}`;
      } else {
        caption = nbars === 1 ? `bar ${startBar + 1}` : `bars ${startBar + 1}–${endBar}`;
      }
      objects.push({ type: 'tab', startSec: r2(start), endSec: r2(end), caption, lines });
    }
  }
  objects.sort((a, b) => a.startSec - b.startSec);
  return { title, roleId, objects };
}
