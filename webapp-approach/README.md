# webapp-approach

Deep-dive feasibility & design research for building **bandAssemble as a web app**
(plain web, not Flutter), with a stateless relay and an authoritative browser-master.
Produced 2026-11-11. Parent product spec: [`../SPEC.md`](../SPEC.md).

> **Verify versions before installing.** Numbers here came from secondary sources at
> research time and the JS ecosystem moves fast. Run `npm view <pkg> version` and check
> `peerDependencies` before committing to a version.

## Bottom line

**Feasible, no blocking unknowns.** Every needed capability has a mature browser API or
well-supported library. Build the MVP as **relay + two browser windows on one PC**
(`localhost`), which sidesteps every secure-context headache and proves the core
concept (authoritative-master sync + audio + role-scroll) before any phone or install.

Three things to keep an eye on (none fatal):
1. **Version knot:** Svelte 5 / Vite 6 / `@sveltejs/vite-plugin-svelte` v5 must agree.
2. **Time-stretch license:** use SoundTouch AudioWorklet; **avoid Rubberband (GPL)** in
   a potentially commercial product.
3. **HTTPS-on-LAN:** wake-lock/camera/PWA-install need a secure context; the *core*
   (ws + audio + scroll + QR-via-native-camera) runs fine on plain-HTTP LAN.

## Documents

| # | File | Covers |
|---|---|---|
| 01 | [tech-stack-feasibility](01-tech-stack-feasibility.md) | Stack choices, pinned versions, compatibility, license + secure-context risks, risk register |
| 02 | [architecture](02-architecture.md) | Star topology, dumb relay vs host, deploy modes, module layout, the `Transport` abstraction, MVP definition |
| 03 | [data-model](03-data-model.md) | `Project`/arrangement TypeScript types, tagged-union notes, sharing boundary, open decisions |
| 04 | [sync-and-signaling](04-sync-and-signaling.md) | NTP-style clock sync, intent→authoritative-state protocol, follower math, QR discovery, secure-context table, future WebRTC path |

## Recommended stack (verify versions)

- **Svelte 5** + **Vite 6** + **@sveltejs/vite-plugin-svelte v5** + **TypeScript**
- **Node 24 LTS** + **`ws`** for the stateless relay (also static-serves in prod)
- **wavesurfer.js v7** for the editor waveform (draw only); **Web Audio API** for
  playback + the authoritative clock
- **@soundtouchjs/audio-worklet** for practice slow-down (later)
- QR discovery via on-screen code + phone's **native camera**; **@sec-ant/barcode-detector**
  only if in-app scanning is ever needed

## Next step

The Phase 0 spike, now concretely scoped: stand up the relay on `localhost`, open two
browser windows, and demonstrate the master→client sync loop in
[02-architecture](02-architecture.md) §"What the MVP must demonstrate". This proves the
*technical* risk. The *adoption* risk (will a band author + adopt) is a separate,
cheaper test described in `../SPEC.md` §Viability.
