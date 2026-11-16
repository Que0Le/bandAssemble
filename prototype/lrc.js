// Parse an .lrc file (synced lyrics) into timed lines.
//
// Standard LRC is one timestamp per line: `[mm:ss.xx]lyric text`. A line may
// carry several timestamps (the same lyric sung at multiple times) — we expand
// those into one entry each. Enhanced LRC word tags `<mm:ss.xx>` are stripped
// (we only need line-level timing for the spike). Metadata tags [ti:], [ar:],
// [length:] are captured.
//
// Output: { title, artist, lengthSec, lines: [ { time, text } ] }  (time in seconds, sorted)

const TS = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

function toSec(min, sec, frac) {
  const f = frac ? Number(`0.${frac}`) : 0;
  return Number(min) * 60 + Number(sec) + f;
}

export function parseLrc(text) {
  const out = { title: null, artist: null, lengthSec: null, lines: [] };

  for (const raw of text.split(/\r?\n/)) {
    // Metadata tags: [ti:...] [ar:...] [length:mm:ss]
    const meta = raw.match(/^\[(ti|ar|length):\s*(.*?)\]\s*$/i);
    if (meta) {
      const key = meta[1].toLowerCase();
      if (key === 'ti') out.title = meta[2].trim();
      else if (key === 'ar') out.artist = meta[2].trim();
      else if (key === 'length') {
        const m = meta[2].match(/(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?/);
        if (m) out.lengthSec = toSec(m[1], m[2], m[3]);
      }
      continue;
    }

    // Collect all timestamps on this line, then the trailing lyric text.
    TS.lastIndex = 0;
    const stamps = [];
    let m;
    while ((m = TS.exec(raw))) stamps.push(toSec(m[1], m[2], m[3]));
    if (!stamps.length) continue;

    const lyric = raw
      .replace(TS, '')
      .replace(/<\d{1,2}:\d{2}(?:[.:]\d{1,3})?>/g, '') // enhanced word tags
      .trim();
    for (const time of stamps) out.lines.push({ time, text: lyric });
  }

  out.lines.sort((a, b) => a.time - b.time);
  if (out.lengthSec == null && out.lines.length) {
    // Guess the song end: last line start + the median gap.
    const gaps = out.lines.slice(1).map((l, i) => l.time - out.lines[i].time).sort((a, b) => a - b);
    const median = gaps.length ? gaps[gaps.length >> 1] : 4;
    out.lengthSec = out.lines[out.lines.length - 1].time + median;
  }
  return out;
}
