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
export function toDrumTab(lanes, { bpm, offset = 0, subdiv = 4, beatsPerBar = 4, barsPerLine = 4, separate = false } = {}) {
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
  if (separate) {
    // each track as its own full-length block, blank line between tracks
    for (const r of rowsOut) {
      for (let bar = 0; bar < totalBars; bar += barsPerLine) {
        out.push(rowFor(r, bar, Math.min(barsPerLine, totalBars - bar)));
      }
      out.push('');
    }
  } else {
    // interleaved: HH/SD/BD together, blank line between 4-bar systems
    for (let bar = 0; bar < totalBars; bar += barsPerLine) {
      const bars = Math.min(barsPerLine, totalBars - bar);
      for (const r of rowsOut) out.push(rowFor(r, bar, bars));
      out.push('');
    }
  }
  return out.join('\n').replace(/\n+$/, '');
}
