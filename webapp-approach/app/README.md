# bandAssemble — Svelte port of the sync spike

The spike's proven sync loop, re-implemented in the **real production stack**:
**Svelte 5 + Vite + TypeScript**, with the same stateless Node relay. Verified live
2026-11-11. This is the base to grow the actual app from.

## Stack (resolved by the official Vite template — the known-good 2026 set)

| | Version |
|---|---|
| Svelte | 5.57.3 |
| Vite | 8.3.x |
| @sveltejs/vite-plugin-svelte | 7.3.1 |
| TypeScript | 6.0.x |
| ws (relay) | 8.22.x |
| Node | 24.15 LTS |

> Note: this is **newer** than `../01-tech-stack-feasibility.md` predicted (it guessed
> Vite 6 / plugin v5). The template pins the current compatible combination — exactly
> why that doc says "verify before install." Treat this table as the corrected truth.

Production bundle: **~53 KB JS (20 KB gzip)** + 2.7 KB CSS — Svelte's small-output win.
`svelte-check`: 0 errors.

## Run it

**Dev (hot reload) — two processes:**
```bash
npm install          # first time
npm run relay        # terminal 1: stateless relay + WS on :8080
npm run dev          # terminal 2: Vite dev server on :5173
```
Open `http://localhost:5173/?role=master` and `http://localhost:5173/?role=client`.
(In dev the page is on :5173 and the WebSocket connects to the relay on :8080 — handled
by `import.meta.env.DEV` in `src/lib/transport.ts`.)

**Prod-style (single origin, like the spike):**
```bash
npm run serve        # vite build, then relay serves ./dist + WS on :8080
```
Open `http://localhost:8080/?role=master` and `http://localhost:8080/?role=client`.

## How it maps to the research docs

| Concern | File |
|---|---|
| Wire protocol / message types | `src/lib/protocol.ts` |
| Pluggable transport (WS now, WebRTC later behind same iface) | `src/lib/transport.ts` |
| NTP-style clock sync | `src/lib/clockSync.ts` |
| Master audio engine (AudioContext clock + metronome) | `src/lib/audio.ts` |
| Reactive session controller (runes) — authoritative master / follower | `src/session.svelte.ts` |
| UI | `src/App.svelte`, `src/components/*` |
| Stateless relay + prod static serve | `relay.js` |
| Arrangement stand-in | `src/lib/song.ts` |

Architecture, data model and sync protocol are documented one level up in
[`../02-architecture.md`](../02-architecture.md),
[`../03-data-model.md`](../03-data-model.md),
[`../04-sync-and-signaling.md`](../04-sync-and-signaling.md).

## Results (two fresh windows, prod build, 2026-11-11)

- **Clock sync:** best RTT ~1 ms; offset settles to the tabs' true load-time gap.
- **Playhead tracking:** master vs client **32–41 ms** apart, sustained, no drift.
- **Intent path:** client "start @ Verse 1" (from 25.8 s) → master seeked to 8.03 s →
  both continued in lock-step (14.44 s vs 14.48 s).
- **Parity with the vanilla spike** confirmed — the stack change cost nothing in sync
  quality, and gained types, components, and a 20 KB bundle.

## Why Svelte 5 here (the perf point)

The per-frame playhead is a `$state` written by one `requestAnimationFrame` loop in
`session.svelte.ts`. Svelte's fine-grained reactivity updates only the bound DOM (the
chart transform, the readouts) — no virtual-DOM diff per frame. This is the concrete
reason we chose Svelte over React for a 60 fps playhead.

## Notes

- The render driver in `session.svelte.ts` is **hybrid**: `requestAnimationFrame` for
  60fps while the window is focused, plus a watchdog `setInterval` that keeps the view
  updating when rAF stalls (unfocused / backgrounded window). This fixed the follower
  auto-scroll freezing when the master window was focused. A fully-hidden background
  tab still clamps timers to ~1s (hard browser limit) — it degrades to ~1fps but stays
  correct, never frozen.
- `window.__session` is exposed only as a **debug handle** for cross-tab verification
  (`livePlayhead()`/`liveState()` compute from the audio clock / follower math directly,
  independent of the render loop). Remove both before any real release.
- Still a spike: synthetic song, single hard-coded session id, no reconnect-state
  recovery beyond basic WS retry, no auth (by design — see `../../SPEC.md`).

## Next steps toward the product

1. Put `WsTransport` fully behind the `Transport` interface call sites (done in
   structure) and add `RtcTransport` when the no-infra LAN milestone arrives.
2. Replace `song.ts` with the real arrangement model ([`../03-data-model.md`](../03-data-model.md))
   and build the **laptop editor** (waveform via wavesurfer.js, lane/marker/note placement).
3. Build the **handheld player view** per role (lyrics / chords+strum).
4. Add LRC import; add practice slow-down via SoundTouch AudioWorklet.
5. Test on real phones over LAN to surface the secure-context items for real.
