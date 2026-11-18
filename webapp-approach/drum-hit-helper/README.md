# Drum-hit helper — prototype

A throwaway, dependency-free spike to answer one question: **how well can we pull
a basic drum map (hi-hat / snare / kick) straight out of a mixed track in the
browser, with no ML and no server?**

Upload an audio or video file → it decodes and analyses automatically → you get a
three-lane timeline of detected onsets with a playhead locked to the video, so you
can watch the hits line up with what you hear. Each lane has its own **live
threshold slider**, because a dense mix needs the snare band stricter and the
hi-hat band looser at the same time.

## Run

```
npm install
npm run gui        # vite on http://localhost:5180
```

Open the page, pick a media file, let it analyse, then press play.

## How it works (`classify.js`)

Not transcription — **band-energy onset detection**. The band *is* the classifier:

| Lane   | Filter (×2, ~24 dB/oct) | Catches                    |
| ------ | ----------------------- | -------------------------- |
| hi-hat | highpass ~7 kHz         | high-freq transients       |
| snare  | bandpass ~250 Hz        | backbeat body              |
| kick   | lowpass ~110 Hz         | low thumps                 |

Pipeline per band: render the filtered signal offline → RMS energy envelope
(~11.6 ms hops) → positive log-flux → adaptive-threshold peak-pick with a
per-voice refractory gap. Onsets are raw timestamps (no tempo grid).

The **snare** also requires a *crack coincidence*: a real snare slaps a broadband
burst in the high-mids (~3 kHz) at the same instant as the low body thump, which
tonal bass notes and vocals don't — so a body onset is kept only when a crack
transient lines up with it. On a dense mix this roughly halves the snare's
false positives.

## Controls & editing

- **Transport** lives *below* the video (custom bar), so it never overlaps the
  picture: play/pause, a seek bar, and the clock.
- **Keys**: `Space` play/pause · `A` / `D` nudge ∓0.1 s (`Shift` = ∓1 s) ·
  `1` / `2` / `3` tap a hi-hat / snare / kick in at the playhead.
- **Click** a track to seek there. **Double-click** a lane to add a hit (it snaps
  to the nearest detected *candidate* transient if one is close, else drops where
  you click); double-click a hit to remove it. Hand edits are **outlined** and
  are re-applied on top of detection, so moving a threshold slider never wipes
  them.
- **Candidates** (toggle): every percussive transient, any band, at a low
  threshold — the snap targets. Off by default (a dense mix has one every ~60 ms).
- **LRC**: upload a `.lrc` to map the lyrics onto a timed track, with a karaoke
  readout that follows the playhead.

## What to expect

A **draft for review, not a finished chart.** Kick is usually solid; hi-hat and
snare bleed from cymbals, busy guitars and vocal sibilance, so expect false
positives on a dense mix. Each lane's **threshold slider** re-picks that lane
instantly (envelopes are cached), so you dial snare and hi-hat separately until
the lanes match what you hear.

If native band energy proves too noisy here, the next rungs are Essentia.js
(WASM onset/beat tracking, still in-browser) and then Demucs stem separation
(server/ML) — but this spike exists to see whether we even need them.

## Files

- `classify.js` — decode, band-split, envelope, onset picking (pure, reusable).
- `gui.js` — upload wiring, lane-timeline drawing, playhead sync, live retune.
- `index.html` — the shell + styles.
