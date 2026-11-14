# 03 — Data Model

The **project / arrangement** is the band's reusable asset and the app's core value
(it's also the "documentation" revisitable months later). Positions are **seconds into
the master audio**, which is used **as-is in V1** (no cut/insert), so imported LRC
timestamps stay valid forever.

## The core idea: a flat array of timed objects

An arrangement is **one ordered array of objects**. There is no verse / section / nesting
in the data — that hierarchy is only how people *talk* about a song. Each object is:

- **timed** — `startSec` / `endSec` (position on the master audio), and
- **shown as one line-block** on screen.

The workhorse object is a **line**: a lyric line with **chords embedded inline** (saves
space — no separate chord row), an optional **strum** row shown beneath it, and an
optional **note**. A `kind` tag types the line — a sung lyric by default, or `solo` /
`instrumental` / … for non-vocal flow. Everything but the timing is optional, so the
*same* shape covers every case. Three specials round it out: a `label` (a section/jump
marker), a `tab` block (multi-line notation text can't express), and a `chorddef` (a
custom chord fingering that feeds the chord diagrams — **not** part of the timed flow).

One such array is a **Chart** — the notation for a single **Role**. A **Project**
bundles a shared **Base** (the audio reference + timed lyrics) with **one Chart per
Role**. Every device holds all Charts (they're tiny text); only the **Maestro** holds
the audio file (see [`../SPEC.md`](../SPEC.md) §Terminology).

```
   [Em]So close no matter how [D]far      ← text  (chords embedded)
   ↓  ↓↑ ↓↑↓                               ← strum (shown below)
   (let ring)                              ← note  (shown below)
```

TypeScript as the source of truth:

The realized types live in [`app/src/lib/model.ts`](app/src/lib/model.ts); this mirrors it.

```ts
// ---- Top level ----
// A Project = a shared Base (audio ref + timed lyrics) + one Chart per Role. Charts
// are tiny text and replicate to EVERY device; the audio file stays on the
// Maestro. See ../SPEC.md §Terminology (Maestro / Player / Base / Chart).
interface Project {
  schemaVersion: 4;          // 4 = typed flow lines (line.kind) + chorddef objects
  id: string;
  title: string;
  base: Base;                // the Maestro-authored skeleton everyone clones from
  roles: Role[];             // the musical parts
  charts: Record<string, Chart>;  // roleId -> that Role's Chart
}

// The shared skeleton. A Role's Chart starts as a clone of `base.lyrics`.
interface Base {
  audio?: AudioRef;          // reference only — the file bytes live on the Maestro (IndexedDB)
  lengthSec: number;         // master audio length; all positions are seconds into it
  bpm?: number;              // optional — drives the practice-mode metronome only
  lyrics: SongObject[];      // timed lyric lines (+ labels): the clonable skeleton
}

// One Role's notation: a flat, ordered array of timed objects.
interface Chart {
  roleId: string;
  objects: SongObject[];     // kept sorted by startSec
}

// ---- Audio ----
// Just the reference. The bytes live in IndexedDB on the Maestro's device,
// keyed by project id (see lib/media); Players don't need the file.
interface AudioRef {
  fileName: string;
  durationSec: number;
}

// ---- The object array ----------------------------------------------------
// Positions are seconds into the master audio. `line` does almost everything;
// `label`, `tab` and `chorddef` are the specials.

interface ObjBase {
  id: string;
  startSec: number;
  endSec: number;            // for `label`/`chorddef`, not a span (a point / untimed)
}

// The workhorse — one displayed flow line. All of text/strum/note are optional:
//   text only          → a sung lyric line
//   text = chords only  → an instrumental bar, e.g. "[Em] [Em] [Am] [C]"
//   strum only          → a rhythm-only line
//   note only           → a spoken/structural cue
interface LineObject extends ObjBase {
  type: 'line';
  kind?: string;   // flow-line type: undefined/'lyric' = sung; else 'solo', 'instrumental', …
  text?: string;   // lyrics with EMBEDDED inline chords: "[Em]So close how [D]far"
  strum?: string;  // rhythm row shown BELOW the text (Unicode glyphs — see §Strum)
  note?: string;   // free annotation shown below: "let ring", "build", "x2"
}

// A section name / jump target. A point in time, not a span.
interface LabelObject extends ObjBase {
  type: 'label';
  text: string;    // "Intro", "Verse 1", "Chorus", "Guitar solo"
  color?: string;
}

// Escape hatch: multi-line notation (GuitarPro / TuxGuitar-style guitar tab).
interface TabObject extends ObjBase {
  type: 'tab';
  lines: string[]; // monospace tab rows, e.g. ["e|--0--2--|","B|--1--3--|", …]
  caption?: string;
}

// A custom chord fingering ("Am7 [x02010]"). NOT part of the timed flow — an
// annotation that feeds the chord diagrams (see lib/chords gripToFrets).
interface ChordDefObject extends ObjBase {
  type: 'chorddef';
  name: string;    // "Am7"
  grip: string;    // "x02010", or spaced for 2-digit frets: "x 0 12 0 1 0"
}

type SongObject = LineObject | LabelObject | TabObject | ChordDefObject;

// ---- Roles ---------------------------------------------------------------
// Free-form parts; `kind` is only a hint for default notation. A band may have
// several of a kind (vocal1, vocal2) or split one instrument (guitar-strum,
// guitar-solo). Each Role has exactly one Chart in `Project.charts`.
type InstrumentKind = 'vocals' | 'guitar' | 'bass' | 'keys' | 'drums' | 'other';
interface Role {
  id: string;                // "vocal1", "guitar-strum", "bass"…
  kind: InstrumentKind;      // hint for default notation
  label: string;             // "Vocal 1", "Guitar (strum)"
}
```

## Chords: embedded inline, as text

Chords live **inside the lyric text** in brackets — `[Em]So close` — exactly how the
band already writes and pastes them. The parser's only job is to recognize `[...]`
tokens for display, transpose, or coloring; the text itself is the source of truth.
Tokens are opaque strings (`"Em"`, `"A7"`, `"G/B"`, `"N.C."`), parsed lazily only when a
feature needs the root (transpose = shift the root and re-emit; capo = a display offset).

An **instrumental bar** is just a line whose `text` is chords with no words:
`"[Em] [Em] [Am] [C] [D]"`, optionally with a `strum`. No separate "bars" type needed.

## Strum: a row of Unicode glyphs, below the text {#strum}

Strumming is **not** a fixed "pattern" field — it's a short string of stroke glyphs shown
on its own row beneath the text:

| glyph | meaning | | glyph | meaning |
|---|---|---|---|---|
| `↓` | down | | `×` | muted / dead stroke |
| `↑` | up | | `>` | accent (on the stroke before it) |
| ` ` (space) | rest / gap | | `~` | let ring |
|  |  | | `PM` | palm mute (over a run) |

Because it's just a sequence, two hard parts become free:
- **Frequent changes** → split the object. An object can be "a sentence *or part of
  it*," so where the feel changes you start a new, shorter object with its own `strum`.
  One pattern per object; change = next object. No multi-pattern-per-line machinery.
- **Special effects** → extra glyphs in the string.

Alignment is **per-object (per phrase/bar), not per-syllable** — the strum row sits under
the line it belongs to. Syllable-precise alignment is engraving-grade and out of scope.
Clean bar alignment with `%` and time-signature changes (the Intro-grid case) is only
possible with the optional `tempo` bar grid; without it, the strum is an evenly-spaced
hint under its line.

## Rendering: it's all Unicode text

**Yes — every object renders as plain Unicode text, no special HTML widgets.** This is a
deliberate property, not an accident:

- `text` is literal characters; embedded `[chords]` are literal characters.
- `strum` is Unicode glyphs (`↓ ↑ × > ~`).
- `tab` is monospace ASCII/Unicode rows — standard guitar tab already *is* text.

So an object paints as 1–3 stacked text lines, and a whole song is a block of monospace
text. That is also the authoring format (paste a chord sheet in, get objects out) and the
share format.

**What text gives you:** trivial copy/paste in and out, tiny payloads over the wire,
perfect round-trip, and a viewer that works anywhere a monospace font does.

**The caveats to respect:**
- Use a **monospace font**; column alignment depends on it. Mixed-width glyphs (arrows,
  emoji) and Vietnamese combining diacritics can nudge columns — another reason strum
  aligns per-line, not per-character.
- For the **live app**, still render **each object as its own element** (not one giant
  `<pre>`), so the sync engine can highlight the current object and auto-scroll to it.
  The content inside each element is Unicode text; the *current-line emphasis, scroll,
  and tap-to-jump* are UI concerns layered on top with CSS — never baked into the text.

## Roles, Charts, and the Base

Each **Role** owns a separate **Chart** (its own object array). A device shows the Chart
for whichever Role it's currently on, and anyone can switch Roles freely. The Charts are
small text, so **every device holds all of them** — switching Role is instant, nothing to
fetch.

A new Role's Chart starts as a **clone of `base.lyrics`** (the Maestro's lyric + timing
skeleton); the Player then layers that part's chords / strum / solo on top.

**Editing & Hand off.** Edits are a **local draft** on the editing device — nobody else is
affected. When ready, the Player **hands the draft off** to the Maestro, which distributes
it so every device's copy of that Role's Chart updates. **Last hand-off wins** (no
locking; all friends). The Maestro is the single distribution point, matching the star
topology (Players only talk to the Maestro).

## Sync lookup

The playhead finds the object in the **current Role's Chart** where
`startSec ≤ now < endSec` and highlights / scrolls to it. Keeping each Chart's `objects`
sorted by `startSec` makes this a cheap lookup. `chorddef` objects are **not** in the
flow, so highlighting skips them (`objectIndexAt` in `model.ts`).

### Authoring times as "m:ss"

Internally every position is `startSec` / `endSec` in **seconds**. For hand-annotation,
the Editor's paste-JSON format also accepts human `startMin` / `endMin` strings (`"1:42"`,
also `"1.42"`) — way easier to read off a normal player's elapsed-time display. On load,
a present clock string **wins** over the raw seconds; on export the Editor emits both
(`secToClock` / `clockToSec` in `lib/util.ts`). The stored model keeps only seconds.

## Sharing boundary (see `../SPEC.md` §Licensing)

A *shareable* arrangement serializes structure, timing, chords and strum — but strips the
copyright-sensitive payloads: **audio bytes**, **lyric words**, and **`tab` content**.

Because chords are embedded in `text`, "strip the words" is a parse, not a field delete:
keep every `[chord]` token and the object's timing, blank the surrounding words. The
result is a legal chord-and-rhythm chart (chords + strum + structure + timing, no lyrics).

## Open model decisions
- **Audio storage: embedded vs linked.** Embedded = portable but large; linked = small but
  fragile. `sha256` lets a re-linked file be verified. Leaning *linked with hash* for the
  editor, *embedded* only for an explicit "export bundle."
- **IDs**: uuid v4 everywhere; keep `objects` sorted by `startSec`.
- **Persistence**: editor saves a `.json` (gzip later). Consider IndexedDB on the client
  for an offline copy of the arrangement after join.
- **Bar grid**: adopt `tempo` only if real songs need `%` / time-sig / tight strum
  alignment often enough to justify marking barlines. Default stays seconds-only.
