# 04 — Sync, Signaling & Discovery

Three separate problems, often conflated:
1. **Clock sync** — make devices agree on a shared time, roughly.
2. **Transport protocol** — what messages flow and how the master orchestrates.
3. **Discovery** — how a client finds the session in the first place.

Your loose-latency tolerance (no sub-50ms goal) makes all three easy.

---

## 1. Clock sync (NTP-style over WebSocket)

Goal: each client learns `offset = masterClock − localClock` so it can convert a
master timestamp into its own `performance.now()` frame.

**Four-timestamp probe** (standard NTP math; reliable sources agree on this):

```
t1 = client send time        (client clock)
t2 = master receive time     (master clock)
t3 = master send time        (master clock)
t4 = client receive time     (client clock)

RTT    = (t4 − t1) − (t3 − t2)
offset = ((t2 − t1) + (t3 − t4)) / 2
```

Practical rules the research converged on:
- **Send several probes** (e.g. 5–10), **keep the sample with the lowest RTT** (least
  jitter / least queuing), or take the median. A single probe over TCP is noisy.
- **Re-sync periodically** (every ~20–30 s, and after any `visibilitychange`/resume) —
  laptops suspend, phones sleep, clocks drift.
- Don't over-engineer precision: with ±100–200 ms tolerance, a lowest-of-10 RTT probe
  is far more than good enough.

> Note: because there's a **single audio master** that everyone *hears*, clock sync only
> governs *scroll position on silent followers*. A follower being 150 ms off scrolls
> slightly early/late — unnoticeable. This is why the problem is easy here and would be
> hard if every device played audio.

Keep this in `lib/clock/ClockSync.ts`, independent of the message protocol.

---

## 2. Transport protocol (authoritative master)

**Principle:** clients send *intents*; the master decides and broadcasts
*authoritative state*. No client ever changes the shared playhead directly.

### Message envelope
```ts
interface Envelope<T = unknown> {
  v: 1;                    // protocol version
  sessionId: string;
  from: string;            // device id
  role: 'master' | 'client';
  kind: string;            // see below
  ts: number;              // sender clock (master clock for master msgs)
  payload: T;
}
```

### Client → (relay) → master: intents
```ts
// "I want everyone to start from here"
{ kind: 'intent/play',  payload: { atSec: number } }
{ kind: 'intent/pause', payload: {} }
{ kind: 'intent/seek',  payload: { atSec: number } }
{ kind: 'intent/jumpMarker', payload: { markerId: string } }
{ kind: 'intent/loop',  payload: { fromSec: number; toSec: number; on: boolean } }
```

### Master → (relay) → all: authoritative transport state
```ts
// The core sync message. "At master-time startAtMasterTs, the playhead equals
// atSec, and it is playing/paused. Run your own clock from there."
{
  kind: 'state/transport',
  payload: {
    state: 'playing' | 'paused';
    atSec: number;            // playhead at the reference instant
    startAtMasterTs: number;  // master clock instant that atSec corresponds to
    rate: number;             // 1.0 normally; <1 for practice slow-down
    loop?: { fromSec: number; toSec: number } | null;
  }
}
```

### Follower math (client)
```
// convert master reference instant into local time:
localStart = startAtMasterTs − offset          // offset from ClockSync
// current playhead on a follower, each animation frame:
if state === 'playing':
    playheadSec = atSec + (localNow() − localStart) / 1000 * rate
else:
    playheadSec = atSec
// then auto-scroll notes/lyrics to playheadSec (binary-search the sorted arrays)
```

### Session housekeeping messages
```ts
{ kind: 'session/hello',   payload: { role, instrument?, name? } }
{ kind: 'session/roster',  payload: { devices: [...] } }      // master → all
{ kind: 'session/claimMaster', payload: {} }                  // manual promotion
{ kind: 'clock/ping',      payload: { t1 } }                  // → master
{ kind: 'clock/pong',      payload: { t1, t2, t3 } }          // master → client
```

### Why this shape
- The **master owns audio**, so `state/transport` is emitted whenever the master
  actually starts/pauses/seeks (including when honoring a client intent). Everyone,
  including the requester, realigns from the same authoritative message — no divergence.
- Followers **extrapolate locally** between messages (they don't need a position stream);
  the master only needs to re-broadcast on changes plus an occasional keepalive
  (e.g. every few seconds) for drift correction and late joiners.
- `rate` carries practice slow-down for free: a follower just scales its extrapolation;
  the master time-stretches its own audio (SoundTouch), everyone else only scrolls.

---

## 3. Discovery

**Chosen: QR code shown by the master.**
- Master displays a QR encoding `http(s)://<host>:<port>/s/<sessionId>`.
- Players scan it with their **phone's native camera app** → the link opens in their
  browser → they're in the session. **No in-app camera**, so no `getUserMedia`, so no
  secure-context requirement for joining over plain-HTTP LAN.
- Beats typing IPs and beats mDNS (`.local` resolution is inconsistent across
  Android/iOS).

Fallback: show the plain URL + a short room code for manual entry.

---

## Secure context & HTTPS-on-LAN (the deployment caveat)

Recap of what the research pinned down, because it drives deployment, not features:

| Capability | Needs secure context? | Works on plain-HTTP LAN? |
|---|---|---|
| WebSocket `ws://` | no | **yes** |
| Web Audio playback (no mic) | no | **yes** |
| Auto-scroll / rendering | no | **yes** |
| Screen Wake Lock | **yes** | no (unless local cert) |
| In-app camera (`getUserMedia`) | **yes** | no |
| Service worker / PWA install | **yes** | no |

So on a **plain-HTTP LAN** the *core* (sync + audio + scrolling + QR-via-native-camera)
**works**. Only wake-lock, in-app camera, and installability need a secure context.

**Dev:** all on `localhost` → secure context → everything works, no cert needed. This
is why the two-window localhost MVP has none of these headaches.

**Options when you later leave localhost:**
- **Cloud deploy** → real cert → everything works, needs internet.
- **LAN, no cert** → accept no wake lock (use the silent-looping-video "NoSleep" trick
  to keep screens on), no install.
- **LAN, local cert** (mkcert-style CA trusted once per device) → full secure context
  on the LAN, at the cost of a one-time trust step per phone.

---

## Future transport: WebRTC-over-LAN (no infra)

The real "browser-to-browser, no internet" answer is **WebRTC data channels**, not
WebSocket. When wanted, implement `RtcTransport` behind the same `Transport` interface:
- Master holds one `RTCPeerConnection` per client (hub).
- **Signaling** (the SDP/ICE handshake) still needs a rendezvous — can be the QR code
  (master encodes an offer) or a brief local relay.
- Everything above `Transport` (clock sync, protocol, scrolling) is unchanged.
This is strictly a later milestone; the WS relay covers dev + cloud + basic LAN now.
