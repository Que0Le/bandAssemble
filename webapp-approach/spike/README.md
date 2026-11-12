# Phase 0 spike — proving the sync tech

A minimal, dependency-light proof of the riskiest assumption in bandAssemble:
**one device drives an authoritative timeline and other devices follow in sync over a
local network.** Validated live on 2026-11-11 (see Results).

Deliberately **vanilla JS** (no Svelte/Vite): the hot path — audio clock, NTP sync,
follower extrapolation, auto-scroll — is framework-agnostic (see
[../01-tech-stack-feasibility.md](../01-tech-stack-feasibility.md)). The production app
will use Svelte 5, but the mechanism proven here is identical.

## What it proves

| Pillar | Mechanism | Where |
|---|---|---|
| Dumb relay forwarding | stateless per-session WS broadcast + static serve | `relay.js` |
| NTP-style clock sync | 4-timestamp probe, keep lowest-RTT sample, periodic re-sync | `public/app.js` → ClockSync |
| Authoritative master | client sends *intents*; master decides; broadcasts `state/transport` | `public/app.js` → MASTER/CLIENT |
| Audio-driven playhead | `AudioContext.currentTime` anchor + lookahead metronome scheduler | `public/app.js` → masterPlayheadSec / schedulerTick |
| Follower extrapolation | map master ts via clock offset, extrapolate per animation frame, auto-scroll | `public/app.js` → clientPlayheadSec / render |

Also demonstrated: practice **slow-down** (`rate` slider), **loop section**, optional
**load a real audio file**, and **end-of-song auto-pause**.

## Run it

```bash
cd webapp-approach/spike
npm install        # one dependency: ws
npm start          # relay on http://localhost:8080
```

Then open two browser windows:
- Master: http://localhost:8080/?role=master
- Client: http://localhost:8080/?role=client

Press **Play** on the master; the client follows silently and auto-scrolls. Click a
marker on either side to jump everyone. On the client, "start @ …" and "Ask to
play/pause" exercise the intent → authoritative-master → broadcast path.

> Because both windows are on `localhost`, this is a secure context — no HTTPS/wake-lock
> headaches during dev (see [../04-sync-and-signaling.md](../04-sync-and-signaling.md)).
> To try real phones over LAN, serve the same thing on the laptop's LAN IP; the core
> (ws + audio + scroll) works on plain HTTP, only wake-lock/camera need a cert.

## Results (measured 2026-11-11, two windows on one PC)

- **Clock sync:** best RTT **~1 ms** (0.0 ms displayed), offset stable (~62–64 ms,
  i.e. the two tabs' `performance.now()` origin gap) across re-syncs.
- **Playhead tracking:** master vs client stayed **~36 ms apart**, sustained from
  ~8 s to ~40 s of playback with **no drift accumulation** — far inside the
  ±100–200 ms tolerance target.
- **Intent path:** a client "start @ Verse 1" request propagated through the master;
  both devices realigned to **exactly 8.000 s**.
- **No console errors.** Node 24.15, `ws` 8.22.

**Conclusion: the core technical risk is retired.** The authoritative-master + dumb-relay
model syncs silent followers to a single audio master well within tolerance on a local
network, using only browser-native APIs.

## Notes / caveats

- Backgrounded browser tabs throttle `requestAnimationFrame`, so an inactive tab's
  on-screen readout freezes (the underlying WS state still updates). On real phones the
  player is looking at the screen, and Wake Lock keeps it awake — a non-issue in use,
  but relevant for automated multi-window testing (hence the `window.__spike` live
  accessor used for verification).
- The metronome click is audible only on the master; the "song" here is synthetic
  (chords/lyrics stand-in). Real audio files load via the master's "load audio" input.
- This is a spike, not production code: no reconnection-state recovery beyond basic WS
  retry, no auth (by design — see `../../SPEC.md`), single hard-coded session.

## Next steps toward the product

1. Re-implement this loop in **Svelte 5 + Vite + TS**, keeping `relay.js` as-is.
2. Put the `Transport` behind an interface so WebRTC-over-LAN can slot in later.
3. Replace the synthetic song with the real arrangement data model
   ([../03-data-model.md](../03-data-model.md)) and the editor.
4. Test on actual phones over LAN to surface the secure-context items for real.
