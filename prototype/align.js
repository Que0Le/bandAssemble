// The heart of the import: merge a timing-free chord model (parse.js) with a
// timed LRC (lrc.js) into a TIMED chart. The lyrics are the join key.
//
// Strategy — "best match with reuse":
//   For each LRC line (which has a real timestamp), find the pasted chord line
//   whose lyrics are most similar, and borrow its chords. Reuse is allowed, so a
//   chorus the LRC repeats three times all matches the ONE chorus line the user
//   pasted — repeats handled with no special case.
//
// Within a line, each chord's character offset becomes a time by interpolating
// across the line's duration. A single global `offset` shifts everything to lock
// the chart to whatever the band actually plays along to (e.g. the YouTube MV,
// whose intro may differ from the recording the LRC was synced to).

const THRESHOLD = 0.34; // min similarity to attach chords (below = instrumental/ad-lib)

export function normalize(s) {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(s) {
  const n = normalize(s);
  return n ? n.split(' ') : [];
}

/** Jaccard over token sets, with a small bonus for exact normalized equality so
 *  identical lines always win over partial overlaps. 0..1. */
export function similarity(aToks, bToks) {
  if (!aToks.length || !bToks.length) return 0;
  const A = new Set(aToks);
  const B = new Set(bToks);
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const jaccard = inter / (A.size + B.size - inter);
  const exact = aToks.join(' ') === bToks.join(' ') ? 0.15 : 0;
  return Math.min(1, jaccard + exact);
}

/** Flatten the chord model into candidate lyric lines, each tagged with the
 *  section it belongs to and whether it's the first line of that section. */
function candidateLines(model) {
  const cands = [];
  let section = null;
  let firstOfSection = false;
  for (const line of model.lines) {
    if (line.kind === 'section') {
      section = line.label;
      firstOfSection = true;
      continue;
    }
    if (!line.lyrics.trim()) continue;
    cands.push({
      lyrics: line.lyrics,
      chords: line.chords,
      section,
      firstOfSection,
      toks: tokens(line.lyrics),
    });
    firstOfSection = false;
  }
  return cands;
}

/**
 * @param model  output of parseSheet()
 * @param lrc    output of parseLrc()
 * @param opts   { offset?: seconds to shift all timing, songLength?: seconds }
 * @returns timed chart + a per-line match report
 */
export function align(model, lrc, opts = {}) {
  const offset = opts.offset ?? 0;
  const songLength = opts.songLength ?? lrc.lengthSec ?? 0;
  const cands = candidateLines(model);

  const emittedSections = new Set();
  const labels = []; // { time, label } — timed jump targets
  const lines = []; // per LRC line, with its (possibly empty) chord events
  const events = []; // flat chord list { time, chord }

  for (let i = 0; i < lrc.lines.length; i++) {
    const cur = lrc.lines[i];
    const start = cur.time + offset;
    const nextRaw = i + 1 < lrc.lines.length ? lrc.lines[i + 1].time : songLength;
    const dur = Math.max(0.1, (nextRaw + offset) - start);

    // Best candidate by lyric similarity (reuse allowed).
    const lt = tokens(cur.text);
    let best = null;
    let bestSim = 0;
    for (const c of cands) {
      const sim = similarity(lt, c.toks);
      if (sim > bestSim) {
        bestSim = sim;
        best = c;
      }
    }

    const matched = best && bestSim >= THRESHOLD;
    const chords = [];
    if (matched) {
      const len = best.lyrics.length || 1;
      for (const ch of best.chords) {
        const t = start + (Math.min(ch.offset, len) / len) * dur;
        chords.push({ chord: ch.chord, time: round(t) });
        events.push({ chord: ch.chord, time: round(t) });
      }
      // Timed section label the first time a section's opening line lands.
      if (best.firstOfSection && best.section && !emittedSections.has(best.section)) {
        emittedSections.add(best.section);
        labels.push({ time: round(start), label: best.section });
      }
    }

    lines.push({
      time: round(start),
      dur: round(dur),
      lyrics: cur.text,
      matched: !!matched,
      sim: round(bestSim, 2),
      matchedTo: matched ? best.lyrics : null,
      // The matched pasted line verbatim — so emit can rebuild its ChordPro
      // (chords positioned over the right words), while timing comes from here.
      source: matched ? { lyrics: best.lyrics, chords: best.chords, section: best.section } : null,
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

function round(n, p = 1) {
  const f = 10 ** p;
  return Math.round(n * f) / f;
}
