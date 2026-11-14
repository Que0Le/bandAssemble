# bandAssemble — Project Description & Roadmap

_Last updated: 2026-11-14 · Status: prototyping — Svelte web app under [`webapp-approach/`](webapp-approach/)_

## 1. Vision

A cross-platform app that helps **amateur bands arrange and perform covers** of songs.

Amateur bands have no arranger or conductor. They learn songs by ear and imitation,
so they can roughly reproduce a track but struggle with the **structural and
coordination** side of playing together:

- **Timing** — staying in tempo and knowing where they are in the song.
- **Chords** — remembering the progression.
- **Lyrics** — following along in real time while playing.
- **Sync** — everyone being at the same place at the same moment.

Today each player uses a personal device (iPhone, iPad, Android, laptop) as a
**passive** notes/sheet viewer. Nothing is interactive or coordinated.

bandAssemble turns those devices into a **synchronized, role-aware performance aid**,
and the editor doubles as the band's **arrangement documentation** — revisitable
months later.

## Terminology (glossary)

_The vocabulary the app and code use. This supersedes looser "master / role / mode"
wording elsewhere in this doc._

- **Session** — one live shared performance everyone joins (by code / QR).
- **Maestro** — the single device that holds and plays the master **audio**, drives the
  shared clock, authors the **Base**, and **distributes** Charts to the band.
  Transferable at runtime — anyone can take the seat (no security; all friends).
- **Player** — any other device. Performs a **Role** and can edit locally.
- **Role** — the musical part a device shows: vocal1, vocal2, bass, guitar-strum,
  guitar-solo, drum… Anyone can switch to any Role freely.
- **Chart** — the notation for one Role: a flat array of timed objects (line / label /
  tab / chorddef). **One Chart per Role.** Every device holds a full copy of **every**
  Chart (they're tiny text); only the Maestro holds the audio file.
- **Base** — the Maestro-authored skeleton: lyrics + timestamps (+ the audio reference).
  A Role's Chart starts by **cloning** the Base, then gets its own chords / strum / solo.
- **Edit** — a toggle on any device; changes are a **local draft** (work-in-progress)
  that affects nobody until…
- **Hand off** — …the Player hands the draft up to the Maestro, who distributes it so
  everyone's copy of that Role's Chart updates. **Last hand-off wins** (no locking).

## 2. Core principles / decisions

These are settled design decisions, not open questions:

1. **The app never listens to what is being played.** Audio detection is out of
   scope (voice control is a possible future, separate topic). The app *drives* the
   timeline; the band follows the app, not the other way around.
2. **Single audio master.** During a live cover, **one device** plays the original
   audio (volume adjustable). All other devices follow **silently**, scrolling each
   player's notes to match. Sound is shared physically in the room, so per-device
   audio clock sync is unnecessary.
3. **Loose latency tolerance.** No sub-50ms precision goal. Players naturally adjust
   to each other; follower devices lagging ~100–200ms is acceptable.
4. **The timeline is anchored to the master audio** (seconds into the file), used
   **as-is** in V1 (no cutting / inserting sections yet). Markers, lyrics, chords,
   and notes all hang off this one timeline.
5. **Any device can edit, but device class guides the work.** Editing is a **toggle**
   available to any Player on their current Role's Chart (local draft → Hand off), not
   a locked-down mode. In practice the **laptop (Maestro)** does the heavy authoring and
   audio; **handhelds** mostly consume and make light edits.
6. **Transport:** start with **local Wi-Fi** (one host broadcasts, others follow).
   **Bluetooth / no-infrastructure** is a later goal (harder cross-platform).
7. **Tech stack:** **Flutter** for cross-platform UI and the consume side.
8. **Notation is staged** (see §5): V1 uses cheap, high-value note types
   (chords, strumming patterns, lyrics, free text, images). Structured
   tab/sheet/drum editors come later.

## 3. The three modes

- **Edit / Arrange (laptop):** create project, upload master audio, import timed
  lyrics (LRC), lay out markers, place per-role notes along the timeline.
- **Play / Assist (live):** each player sees only their role's layer, auto-scrolling
  to the shared playhead. One device plays audio and broadcasts position; others
  follow.
- **Practice:** select a region between two markers, loop it, optional slow-down.
  (Practice is just "play the region between two markers," so it reuses the same
  machinery.)

## 4. Data model

The realized TypeScript types live in
[`webapp-approach/03-data-model.md`](webapp-approach/03-data-model.md); this is the
shape in words. A **Project** (the band's reusable arrangement / documentation) holds:

- **Base** — the shared skeleton, authored by the **Maestro**:
  - **Master audio** reference — the original recording, used as-is in V1. The file
    itself lives **only on the Maestro** and never crosses the wire.
  - **Lyrics + timestamps** — the timed skeleton (LRC import or tap-to-time), in audio
    seconds.
- **Roles** — the musical parts (vocal1, bass, guitar-strum, guitar-solo, drum…).
- **Charts** — **one per Role**, each a flat, ordered array of **timed objects**:
  - **line** — a lyric line with inline `[chords]`, an optional **strum** row, and an
    optional note. Rendered on one monospace grid so strokes align to the words. A
    `kind` tags non-lyric flow (`solo`, `instrumental`, …).
  - **label** — a section / jump point (Intro, Chorus…); doubles as a marker.
  - **tab** — a GuitarPro/TuxGuitar-style block for solos.
  - **chorddef** — a custom chord fingering (`Am7` → `x02010`) feeding the chord
    diagrams; an annotation, not part of the timed flow.
  - Flow objects carry `startSec` / `endSec` into the master audio (`chorddef` is untimed).

Position is always "seconds into the (as-is) audio," so imported timestamps stay valid
forever (the audio isn't edited in V1). **Charts are small text and are replicated to
every device; the audio is large and stays on the Maestro.** A Role's Chart begins as a
**clone of the Base**, then diverges with that part's own annotations.

## 5. Notation staging

| Stage | Note / notation types | Difficulty |
|-------|------------------------|------------|
| **V1** | chord symbols, strumming patterns, lyrics (LRC import), free text, **image uploads** (photo of existing tab/sheet) | low |
| **V2** | structured **guitar/bass tab editor** | medium |
| **Later / maybe external** | piano standard notation, drum notation — likely via importing MusicXML rather than an in-house editor | high |

The **image-pinned-to-position** trick gives every instrument *some* notation on day
one with zero notation engine, and directly serves the "documentation" goal.

## 6. Sync protocol (concept)

- One device is the **audio master**; it owns the authoritative playhead.
- Followers **do not** stream continuous audio position frame-by-frame. Instead:
  - Agree on a shared clock (rough is fine given loose tolerance).
  - Master broadcasts transport events: **start / pause / stop / seek**, each as
    "at clock-time T, be at position P, state = playing/paused."
  - Each follower runs its **own local timeline** from there and auto-scrolls.
  - Periodic lightweight position updates correct drift.
- Works over local Wi-Fi now; the low-bandwidth, event-based design is also friendly
  to Bluetooth later.

## 7. Known constraints / honest caveats

- The app **imposes the original recording's timing**; the band conforms to it
  (same mental model as a studio click track). Rubato / tempo drift in the original
  is simply followed by playing along with the audio.
- Flutter leans on **native plugins / packages** for the risky parts: audio playback,
  time-stretch (slow-down), and local networking. Quality varies — this is where
  technical risk lives.
- Cross-platform **Bluetooth** ad-hoc networking (iOS ↔ Android ↔ desktop) is a
  genuine research problem, deferred on purpose.

---

## 8. Roadmap / TODOs

### Phase 0 — Validation & setup
- [ ] Confirm Flutter package choices for: audio playback, waveform display,
      time-stretch/slow-down, local network discovery + messaging.
- [ ] Spike: play audio on one device, broadcast playhead over local Wi-Fi, scroll a
      second device in rough sync. (De-risk the core experience first.)
- [ ] Decide the project **file format** (the band's documentation artifact) and how
      the master audio is stored/referenced (embedded vs. linked).

### Phase 1 — Editor (laptop) MVP
- [ ] New project: upload master audio, show waveform + timeline.
- [ ] Import LRC lyrics; display timed lyric lines on the timeline.
- [ ] Drop / name / edit **markers**.
- [ ] Define **roles**.
- [ ] Place notes per role along the timeline (tap-to-drop while audio plays, or drag
      on waveform): chord symbols, free text, image upload.
- [ ] Strumming-pattern widget (per-bar beat grid, ↓/↑, rests, accents).
- [ ] Save / load project.

### Phase 2 — Handheld consume (play)
- [ ] Open project, pick role.
- [ ] Auto-scrolling view of that role's layer against the playhead.
- [ ] Lyrics view for vocalist; chords + strumming for guitarist; etc.
- [ ] Image notes render cleanly on small screens.

### Phase 3 — Sync (local Wi-Fi)
- [ ] Device discovery + session join on local network.
- [ ] Single audio master: plays audio, broadcasts transport events.
- [ ] Followers run local clock, auto-scroll, drift-correct.
- [ ] Start / pause / stop / seek broadcast; "jump to marker" for all.

### Phase 4 — Practice
- [ ] Select region between two markers; loop it.
- [ ] Slow-down (time-stretch) for practice.
- [ ] (Decide whether slow-down is needed earlier, in Phase 1/2.)

### Phase 5 — Polish & documentation value
- [ ] Export / share project (the band's arrangement memory).
- [ ] Revisit-months-later UX: readable overview of the whole arrangement.

### Future / deferred (explicitly out of V1)
- [ ] Audio editing: cut, insert solo/improv sections (EDL over the audio).
- [ ] Bluetooth / no-infrastructure transport.
- [ ] Structured guitar/bass **tab editor** (V2).
- [ ] Piano standard notation + drum notation (likely via MusicXML import).
- [ ] In-app lyric timing (tap-to-time) as an alternative to LRC import.
- [ ] Voice control.

---

## 10. Licensing / sharing stance

Pragmatic position (amateur-focused, low-risk by design):

- **Master audio stays user-supplied and local.** The app never distributes
  recordings — the user brings their own file, so the app is a tool, not a
  distributor (same model as Moises / Chordify / Capo).
- **Arrangements are shareable / sellable privately** between bands: markers,
  section structure, strumming patterns, chord symbols, fingering/capo/tuning,
  and the band's own text notes — i.e. the band's own work.
- **Strictly excluded from any sharing: audio and lyrics.** Lyrics are the
  copyrighted part that chord/tab sites have been hit over; importing LRC for
  personal use is fine, redistributing it is not.
- **Flag user-uploaded images** (photos of published tab/sheet) with the same
  caution as audio/lyrics — they're a backdoor for copyrighted material to flow
  through sharing. Exclude or warn when arrangements become shareable.
- **Revisit when selling scales.** Private, small-scale amateur sharing is
  negligible risk; a money-making *marketplace* of song-specific charts draws more
  scrutiny (composition rights, historical tab-site takedowns). Not a V1 concern.

Rule of thumb: **ship the structure and the band's own annotations, never the
source audio or lyrics.**

## 11. Viability / validation

Honest read: **worth building as a passion/learning project that solves your own
band's problem; worth building as a business only after validating behavior, not
just tech.**

**For:**
- Real, specific pain, and you've lived it (best reason to build).
- Genuine whitespace: amateur + upload-your-own-master + per-role synced views +
  infra-light sync is unserved by any single product.
- Already well de-scoped (single audio master, loose latency, LRC import,
  photos-as-notation, Wi-Fi-first) — buildable by a solo/small team in Flutter.

**Against (the risks that actually decide it):**
- **Amateur musicians monetize poorly** — price-sensitive, churn-prone; the buyer is
  a *band*, not an individual. Adjacent successes (BandHelper, Playback) serve
  gigging/worship teams *with budgets*.
- **Authoring burden is the silent killer.** Value depends entirely on arrangement
  entry being fast and pleasant. Slow authoring = bands do two songs and quit. This
  UX matters more than the sync.
- **Cold-start / adoption:** useful only when the *whole band* adopts and someone
  authors the chart. One holdout = back to paper.
- **Moat is UX ease, not tech.** Competitors (BandHelper has sync; Moises has audio
  practice) could add the amateur angle. Defensibility is fragile.

**Cheapest validation (before writing much code) — test *behavior*, not tech:**
1. Hand-make ONE arrangement for a song your band already plays (even a spreadsheet
   + shared timer).
2. Run one rehearsal: one device plays audio, everyone follows.
3. Decide by reaction: if the band says "I wish this were an app," build it. If it's
   a shrug, you've saved months.

(The Phase 0 spike proves the tech; this proves the people will use it. Do this
first.)

## 9. Open questions (to revisit)
- Do we want a simple global **slow-down** in V1, or defer all audio processing to
  Phase 4?
- Project file: embed audio (portable, large) or link it (small, fragile)?
- Shared-clock mechanism over local Wi-Fi: host-as-reference vs. NTP-style exchange.
