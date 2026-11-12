# 02 — Architecture

## Topology: star with an authoritative master + dumb relay

```
            ┌─────────────┐
            │   RELAY      │  stateless; also static-serves the app in prod
            │ (Node + ws)  │
            └──────┬───────┘
      ws           │           ws
   ┌───────────────┼────────────────┐
   │               │                │
┌──▼───┐       ┌───▼────┐       ┌───▼────┐
│MASTER│       │ CLIENT │  ...  │ CLIENT │
│(laptop)      │(phone) │       │(phone) │
│ plays audio  │ scroll │       │ scroll │
│ owns playhead│ only   │       │ only   │
└──────┘       └────────┘       └────────┘
```

- **Relay** — a stateless message forwarder. Knows nothing about songs or time. It
  only (a) serves the built web app over HTTP in production and (b) relays WS messages
  within a session. Never needs redeployment as features grow. ~one small file.
- **Master** — one browser tab (ideally on the **laptop**, which is also the editor and
  is plugged into the room speakers). It is the **single source of truth**: it owns the
  authoritative playhead, plays the audio, and decides what everyone does.
- **Clients** — browser tabs on phones/tablets. They render one role's view and scroll
  to match the master. They never talk to each other and never play audio.

Rationale and the trade-offs behind this choice are recorded in `../SPEC.md`
(§Implementation). Key property: **clients only ever communicate with the master**
(logically), via the relay (physically). This removes mesh networking, peer discovery
between clients, and distributed conflict resolution — the hard parts of P2P.

## Why a dumb relay instead of "master is the server"

A browser tab cannot host a WebSocket server. Two ways around that:
1. **Dumb relay (chosen):** both master and client are the *same web app* in different
   roles; both are plain WS *clients* of a trivial relay. All app logic lives in the
   web app; the server stays tiny and stable.
2. Master runs a native host process (serves + relays). More capable, but then the
   master is a platform-specific install and the logic splits across two codebases.

We choose (1) for the MVP. The relay can later also be the thing a phone/laptop runs
locally to serve + relay on a LAN with no internet.

## Deployment modes (same app, different wire)

| Mode | Where relay runs | Internet? | Secure context? | Use |
|---|---|---|---|---|
| **Dev** | `localhost` | no | **yes** (localhost) | Two browser windows on one PC. Everything works. **This is the MVP harness.** |
| **Cloud** | small VPS | yes | yes (real cert) | Simplest real deploy; also enables remote/different-location rehearsal. |
| **LAN-local** | laptop on the Wi-Fi | no | no (LAN-HTTP) unless local cert | Venue with no signal. Loses Wake Lock/camera/PWA-install unless you add a trusted local cert; core sync+audio+scroll still work. |

The app code is identical across all three. Only the **transport endpoint** and
whether you ship a cert differ.

## Module layout (web app)

```
src/
  lib/
    transport/           # the pluggable wire
      Transport.ts       # interface: connect(), send(msg), onMessage(cb), close()
      WsTransport.ts     # WebSocket implementation (MVP)
      (future) RtcTransport.ts   # WebRTC-over-LAN, same interface
    clock/
      ClockSync.ts       # NTP-style offset estimation (see 04)
    session/
      roles.ts           # master vs client role logic
      protocol.ts        # message type definitions (see 04)
      MasterState.ts     # authoritative playhead/transport state (master only)
      FollowerClock.ts   # local timeline run from master events (client)
    audio/
      Player.ts          # Web Audio playback + AudioContext.currentTime clock (master)
      (future) Stretch.ts# SoundTouch AudioWorklet slow-down
    model/
      arrangement.ts     # the project/arrangement types (see 03)
      serialize.ts       # load/save project file
  routes (or views)/
    editor/              # laptop: waveform, lanes, note placement
    player/              # handheld: single-role auto-scroll view
    host/                # master controls + QR code display
server/
  relay.ts               # Node + ws; stateless forward; static-serve in prod
```

**The load-bearing abstraction is `Transport`.** Everything above it (clock sync,
master state, scrolling) is transport-agnostic. Swapping `WsTransport` for a future
`RtcTransport` (WebRTC-over-LAN for true no-infra) must not touch anything else.

## Roles are runtime, not separate apps

One web app. On joining a session a device is assigned (or claims) a role:
- **master** — exactly one; manually promoted (no auto-election, no failover — a
  deliberate simplification). If it dies, someone else taps "Become master" and
  clients reconnect.
- **player(instrument)** — many; each picks their instrument/role and sees that layer.

## What the MVP (dev mode) must demonstrate

1. Relay up on `localhost`; two browser windows connect (one master, one client).
2. Master loads an arrangement + audio, plays it; playhead advances on
   `AudioContext.currentTime`.
3. Master broadcasts transport events; client runs its own clock and auto-scrolls its
   role's notes in rough agreement (±100–200 ms is fine).
4. Client taps a marker / "start from here" → intent to master → master decides →
   broadcast → both realign.

That loop proves the concept with no phones, no installs, no secure-context issues.
