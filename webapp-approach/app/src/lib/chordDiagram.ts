// Self-contained chord-diagram generator: chord name -> inline SVG fretboard.
// No external images or network. Frets are [low-E, A, D, G, B, high-e];
// -1 = muted, 0 = open, n = fret number. A custom-fingering map (from the
// chart's "Name [grip]" defs) is checked first, then the built-ins; unknown
// chords return null.

import { gripToFrets } from './chords';

const SHAPES: Record<string, number[]> = {
  G: [3, 2, 0, 0, 0, 3],
  C: [-1, 3, 2, 0, 1, 0],
  D: [-1, -1, 0, 2, 3, 2],
  E: [0, 2, 2, 1, 0, 0],
  A: [-1, 0, 2, 2, 2, 0],
  Em: [0, 2, 2, 0, 0, 0],
  Am: [-1, 0, 2, 2, 1, 0],
  Dm: [-1, -1, 0, 2, 3, 1],
  F: [1, 3, 3, 2, 1, 1],
  G7: [3, 2, 0, 0, 0, 1],
  C7: [-1, 3, 2, 3, 1, 0],
  D7: [-1, -1, 0, 2, 1, 2],
  E7: [0, 2, 0, 1, 0, 0],
  A7: [-1, 0, 2, 0, 2, 0],
  B7: [-1, 2, 1, 2, 0, 2],
  Em7: [0, 2, 0, 0, 0, 0],
  Am7: [-1, 0, 2, 0, 1, 0],
  Dm7: [-1, -1, 0, 2, 1, 1],
};

/** Normalize cosmetic spellings so more tokens find a shape. */
function normalize(name: string): string {
  return name.trim().replace(/maj/i, '').replace(/\s+/g, '');
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Frets for a chord: a custom def (if given) wins, else a built-in shape. */
function fretsFor(name: string, defs?: Record<string, string>): number[] | null {
  const custom = defs?.[name];
  if (custom) {
    const g = gripToFrets(custom);
    if (g) return g;
  }
  return SHAPES[name] ?? SHAPES[normalize(name)] ?? null;
}

/** Return an inline SVG string for the chord, or null if we have no shape. */
export function chordSvg(name: string, defs?: Record<string, string>): string | null {
  const frets = fretsFor(name, defs);
  if (!frets) return null;

  // Geometry
  const W = 96,
    H = 116;
  const left = 18,
    gap = 12; // 6 strings at left, left+gap, ...
  const top = 30,
    rowH = 18,
    rows = 4;
  const bottom = top + rows * rowH;
  const xOf = (i: number) => left + i * gap;

  const positives = frets.filter((f) => f > 0);
  const maxF = positives.length ? Math.max(...positives) : 0;
  const minF = positives.length ? Math.min(...positives) : 1;
  const open = maxF <= 4; // open position -> show nut, frets 1..4
  const baseFret = open ? 1 : minF;

  const parts: string[] = [];

  // strings (vertical) and frets (horizontal)
  for (let i = 0; i < 6; i++)
    parts.push(
      `<line x1="${xOf(i)}" y1="${top}" x2="${xOf(i)}" y2="${bottom}" stroke="#8b98a8" stroke-width="1"/>`,
    );
  for (let r = 0; r <= rows; r++) {
    const y = top + r * rowH;
    const w = open && r === 0 ? 4 : 1; // thick nut at top in open position
    parts.push(
      `<line x1="${left}" y1="${y}" x2="${xOf(5)}" y2="${y}" stroke="${
        open && r === 0 ? '#cbd5e1' : '#8b98a8'
      }" stroke-width="${w}"/>`,
    );
  }

  // base-fret label when not in open position
  if (!open)
    parts.push(
      `<text x="6" y="${top + rowH - 4}" font-size="10" fill="#cbd5e1">${baseFret}fr</text>`,
    );

  // markers above the nut + dots
  frets.forEach((f, i) => {
    const x = xOf(i);
    if (f === -1) {
      parts.push(
        `<text x="${x}" y="22" font-size="11" fill="#9aa6b2" text-anchor="middle">×</text>`,
      );
    } else if (f === 0) {
      parts.push(
        `<circle cx="${x}" cy="18" r="4" fill="none" stroke="#9aa6b2" stroke-width="1"/>`,
      );
    } else {
      const row = open ? f : f - baseFret + 1;
      if (row >= 1 && row <= rows) {
        const cy = top + (row - 0.5) * rowH;
        parts.push(`<circle cx="${x}" cy="${cy}" r="5.2" fill="#f6ad55"/>`);
      }
    }
  });

  // chord name
  parts.push(
    `<text x="${W / 2}" y="${H - 6}" font-size="13" font-weight="700" fill="#e6edf3" text-anchor="middle">${esc(
      name,
    )}</text>`,
  );

  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(
    name,
  )} chord diagram">${parts.join('')}</svg>`;
}

/** Whether a diagram exists for this chord token (custom def or built-in). */
export function hasDiagram(name: string, defs?: Record<string, string>): boolean {
  return !!fretsFor(name, defs);
}
