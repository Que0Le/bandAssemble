# Import prototype — chord-sheet parser

Throwaway spike, isolated from the app code. Proves **step 2** of the import
pipeline: turn a pasted chord sheet (Ultimate Guitar "chords over lyrics", or
ChordPro) into a structured, timing-free model — the "half-chart" that holds
chords but no timing. The LRC aligner (next spike) adds the timing.

## Run

```bash
cd prototype
npm install
npm run demo
```

## What it does

- `parse.js` — `parseSheet(text)` auto-detects the format and returns:
  ```
  { title, artist, format, lines: [
    { kind: 'section', label: 'Chorus' } |
    { kind: 'lyric', lyrics: 'There is a house...', chords: [ { chord: 'Am', offset: 0 }, ... ] }
  ] }
  ```
  `offset` = character index into `lyrics` where the chord sits. That's the hook
  the aligner interpolates into a timestamp inside each line.
- Built on [ChordSheetJS](https://github.com/bettermusic/ChordSheetJS), which
  parses **both** Ultimate Guitar and ChordPro — so one paste box handles ~every
  chord site, no per-site integration.
- Samples are public-domain songs (House of the Rising Sun, Amazing Grace) so
  nothing copyrighted lives in the repo.

## Known rough edges (fine for a spike, fix when productionising)

- **Trailing chords collapse.** When a line has more chords than lyric width
  (e.g. `Am E Am C D F` over a short line), the overflow chords pile onto the last
  offsets. The aligner can spread them across the line's duration.
- **Free-text header lines** (a title line in the paste) come through as a
  chord-less lyric line; they simply won't match any LRC line and drop out during
  alignment.
- Section-label detection covers ChordPro `{start_of_*}` and UG `[Section]`
  headers; exotic labels may need adding to the heuristic in `sectionLabel()`.

## Step 3 — the aligner (DONE)

`lrc.js` + `align.js`, demoed by `node demo-align.js`.

- `parseLrc(text)` → `{ title, artist, lengthSec, lines:[{time, text}] }` from an
  `.lrc` file (handles multi-timestamp lines, strips enhanced word tags, reads
  `[ti]/[ar]/[length]`).
- `align(model, lrc, {offset, songLength})` merges the two on lyric text —
  **best-match-with-reuse**: each LRC line borrows chords from the most similar
  pasted line (Jaccard over normalized tokens, threshold 0.34). Emits a timed
  chart: `{ lengthSec, coverage, labels:[{time,label}], lines:[...], events:[{time,chord}] }`.
  Chord time = `lineStart + (offset/lineLength) × lineDuration`; one global
  `offset` shifts everything to lock to the YouTube MV.

Verified against `sample-ug.txt` + `sample-rising-sun.lrc` (lowercase, `risin'`,
commas, an instrumental intro line, and a repeated chorus):

- instrumental intro line → unmatched, no chords
- `"they call the risin' sun"` still matched (sim 0.67) despite spelling/case
- the repeated chorus reused the single pasted chorus's chords — no special case
- timed labels `Verse 1@0:12`, `Chorus@0:38` (each emitted once) → jump targets
- **89% line coverage** — i.e. auto-pass ~90%, tap-fix the rest

## Step 4 — emit app schema + ecosystem export (DONE)

`emit.js`, demoed by `node demo-emit.js` (writes `out/rising-sun.{json,cho,lrc}`).

The app already stores a line as ChordPro inline text (`[Am]There is a house`)
with one `startSec`/`endSec` — chords are positional in the text, not separately
timed. So we adopt the two ecosystem standards rather than inventing a format:

- `buildObjects(aligned)` → `SongObject[]` — ChordPro line text + times + labels.
- `toChartJson(objs, meta)` → `{title, roleId, objects}` — **the shape the app's
  Editor imports** (Editor.svelte accepts a bare array, `{objects}`, or
  `{title, roleId, objects}`). This is what you paste into the app.
- `toProject(objs, meta)` → a full `schemaVersion 4` Project (for programmatic
  creation via `projects.ts`, NOT Editor paste).
- `toChordPro(objs, meta)` / `toLrc(objs, meta)` → `.cho` / `.lrc` export.

**Round-trip proof:** `demo-emit.js` re-parses our own `.cho` with ChordSheetJS
and recovers the chords/title/artist — so the export is valid, interoperable
ChordPro, not a bespoke dialect.

## Step 5 — GUI (DONE)

```bash
npm run gui   # http://localhost:5180
```

`index.html` + `gui.js` — the "Import a song" screen, running the SAME
parse/align/emit modules in the browser (Vite resolves `chordsheetjs`). Paste
chords + LRC on the left; the right shows the live timed chart (chords over
words, section labels, unmatched lines greyed), a coverage %, an **Offset**
slider that re-aligns live, a **Play** button that scrolls a playhead through the
chart in real time, and ChordPro/LRC/JSON export tabs with copy + download.

## Still to do (app integration, not spikes)

1. **LRCLIB fetch** — `lrclib.net/api/get?track_name=&artist_name=&duration=` so
   the LRC is fetched automatically instead of pasted.
2. **Wire into the app** — a real "Import a song" route that calls `toProject()`
   and saves via `projects.ts`; optional `.cho`/`.lrc` import/export buttons.
3. **Tap-fix pass** — let the Maestro nudge any mistimed line while a track plays.
4. **Chord placement polish** — snap chords to word boundaries (they currently
   land at exact UG character offsets, so some sit mid-word).
