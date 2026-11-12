# 01 — Tech Stack Feasibility & Version Pinning

_Research date: 2026-11-11. All version numbers were current at research time from
secondary sources (npm mirrors, release trackers, caniuse). **Before `npm install`,
verify each with `npm view <pkg> version` and check `peerDependencies`** — the JS
ecosystem moves weekly and a few sources were stale/conflicting._

## Verdict

**The stack is feasible with no blocking unknowns.** Every capability the app needs
has at least one mature browser-native API or well-supported library. The only items
needing care are (a) version pinning across the Svelte/Vite/plugin trio, (b) the
time-stretch library's **license**, and (c) the secure-context (HTTPS-on-LAN)
constraint, which is an architecture issue, not a feasibility blocker (see
[04-sync-and-signaling](04-sync-and-signaling.md) and §"Secure context" below).

## Recommended stack (pin these, then verify)

| Layer | Choice | Version (verify!) | Notes |
|---|---|---|---|
| Framework | **Svelte 5** | `5.57.x` (stable since Oct 2024; latest ~Oct 2026) | Runes = fine-grained reactivity, no VDOM. The reason we dropped React. |
| Build/dev | **Vite** | `6.x` | Hot reload; the dev-speed you want. |
| Svelte plugin | **@sveltejs/vite-plugin-svelte** | `v5` (for Vite 6; requires svelte ≥5.26) | **This is the trio that must agree.** v6 of the plugin targets Vite's newer Rolldown builds — only adopt if you move to that. |
| Language | **TypeScript** | `5.x` (6.x may be out — check) | The arrangement data model is the core asset; type it. |
| Routing/app shape | **SvelteKit** (optional) with `adapter-static`, **or** plain Svelte SPA | SvelteKit 3 reportedly Oct 2026 (unverified; needs Node 22+/TS6) | For a LAN-served SPA you may not need SvelteKit. A plain Svelte + Vite SPA keeps the served bundle dead simple. Decide in [02-architecture](02-architecture.md). |
| Styling | **Tailwind** (optional) | current | Fast iteration; skip if you prefer plain CSS. |
| Server (relay + static) | **Node** + **`ws`** | Node **24 LTS** (safe) or 26 LTS; `ws` ~`8.18.x` | Node 24 = Active LTS through 2028, the conservative pick. Node 26 just entered LTS (Oct 2026). `ws` is the standard, battle-tested WS server. |
| Waveform (editor) | **wavesurfer.js v7** | `7.9.x` | TypeScript rewrite. Default playback backend is **MediaElement**; a WebAudio backend exists but docs conflict by version — don't depend on it, drive audio yourself (below). |
| Audio playback/timing | **Web Audio API** (native) | — | `AudioContext.currentTime` is the authoritative clock. No library needed for play/seek. |
| Metronome/click (later) | lookahead scheduler (hand-written) | — | ~100 ms interval timer, ~150 ms lookahead, schedule on `currentTime`, +~50 ms start margin. Pattern is standard; see §Audio timing. |
| Time-stretch (practice slow-down) | **@soundtouchjs/audio-worklet** | `2.0.3` | ⚠️ See license + options note below. |
| QR (discovery) | **native camera app** + on-screen QR; in-app scan via **@sec-ant/barcode-detector** (polyfill, ZXing-C++ WASM) if needed | `1.3.x` | Avoid `html5-qrcode` — effectively unmaintained (last real release 2023). |

## Key feasibility notes

### Svelte 5 + Vite + plugin — the one version knot
The single most likely incompatibility is mismatching **svelte / vite /
vite-plugin-svelte**. Rule of thumb from the research:
- Plugin **v5** → **Vite 6**, needs **svelte ≥ 5.26**.
- Plugin **v6** → Vite's Rolldown line (newer, only if you opt in).
Pin all three together and read the plugin's `peerDependencies` before installing.
Don't mix a plugin major with the wrong Vite major.

### Audio: drive it yourself, don't rely on wavesurfer for playback
wavesurfer.js v7 is excellent for **drawing the waveform in the editor**, but its
playback backend story changed across v7 and is ambiguous. **Decouple:** use
wavesurfer for the *visual* waveform + seek UI, and use the **Web Audio API directly**
for actual playback and the playhead clock (`AudioContext.currentTime`). This keeps
your timing authority in one place and avoids depending on a library feature that may
move. Web Audio playback (not mic) does **not** require a secure context, so it works
on a plain-HTTP LAN page.

### Time-stretch (slow-down for practice) — license matters
Options found, with the catch that decides it:
- **@soundtouchjs/audio-worklet** (v2.0.3) — runs in an AudioWorklet. Set
  `preservesPitch = false` on the media element so the browser doesn't double-correct.
  Reasonable quality, permissive-ish. **Recommended default.**
- **rubberband-wasm** (v2.0.2) — best-known algorithm, **but GPL-2.0**. GPL in a
  product you might sell is a real legal constraint — **avoid unless you accept GPL**.
- **Kali** (Descript) — LGPL, WSOLA-based, decent.
- **Superpowered / Bungee** — commercial, high quality, licensing cost.
Decision: start with **SoundTouch AudioWorklet**; treat Rubberband as off-limits for a
potentially commercial product because of GPL. Slow-down is a Phase-4 feature anyway.

### Wake Lock (keep phone screen on) — use a browser tab, not an installed PWA
- Screen Wake Lock API: iOS Safari **16.4+ partial, 18.4+ full** in a normal Safari
  tab; Android Chrome long supported.
- **Historically broken in iOS home-screen PWAs.** So: have players use the page in a
  **Safari/Chrome tab**, not "Add to Home Screen," for reliable wake lock.
- **Secure-context catch:** Wake Lock needs a secure context, which a plain-HTTP LAN
  page is **not**. So over LAN, either (a) accept no Wake Lock and use the
  silent-looping-video "NoSleep" hack, or (b) serve HTTPS with a locally-trusted cert.
  Fine on `localhost` during dev. See [04](04-sync-and-signaling.md).

### QR discovery sidesteps the camera/secure-context problem
In-browser camera (`getUserMedia`) needs a secure context — **unavailable on a
plain-HTTP LAN page**. But you don't need it: the **master displays a QR code**, and
followers scan it with their **phone's native camera app**, which opens the URL in the
browser. No in-app camera, no secure-context requirement for discovery. (If you ever
want in-app scanning, use the BarcodeDetector polyfill and you'll need HTTPS.)

### Secure context — the one thing that shapes deployment
- `localhost` **is** a secure context → **all dev on two localhost browser windows has
  zero secure-context problems.** Web Audio, Wake Lock, camera all work.
- A LAN IP over HTTP (`http://192.168.x.x`) is **not** secure → loses Wake Lock, camera,
  service-worker/PWA-install. **But WebSocket (`ws://`) and Web Audio playback work
  fine over plain HTTP.** So the core experience (sync + audio + scrolling) runs on a
  plain-HTTP LAN; only the "nice-to-haves" (wake lock, installability) need the
  cert work.

## Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| Svelte/Vite/plugin version mismatch | Low | Pin the trio; read peerDeps. |
| Time-stretch library license (GPL) | Med (if selling) | Use SoundTouch AudioWorklet, not Rubberband. |
| Wake Lock unreliable on iOS PWA / LAN-HTTP | Med | Use Safari tab + NoSleep video fallback; or local HTTPS cert. |
| wavesurfer playback backend ambiguity | Low | Use Web Audio directly for playback; wavesurfer for drawing only. |
| TCP/WebSocket jitter hurting clock sync | Low (loose tolerance) | Multi-probe, take min-RTT sample, periodic re-sync (see [04](04-sync-and-signaling.md)). |
| iOS-as-host unreliable | Med | Prefer laptop host; Android OK; iPhone host = fragile fallback. |

## Sources
- [Svelte 5 is alive](https://svelte.dev/blog/svelte-5-is-alive), [releases.sh svelte](https://releases.sh/svelte/svelte.md)
- [vite-plugin-svelte v5 dependency PRs](https://git.nemunai.re/nemunaire/reveil/pulls/224)
- [wavesurfer.js docs — Web Audio](https://wavesurfer.xyz/docs/web-audio/), [wavesurfer v7 README](https://github.com/suzanpradhan/wavesurfer.js)
- [rubberband-wasm](https://www.github.com/Daninet/rubberband-wasm), [@soundtouchjs/audio-worklet](https://cdn.jsdelivr.net/npm/@soundtouchjs/audio-worklet@2.0.3/README.md)
- [Screen Wake Lock — caniuse](https://caniuse.com/wake-lock), [web.dev wake lock](https://developer.chrome.com/docs/capabilities/web-apis/wake-lock), [WebKit bug: PWA wake lock](https://bugs.webkit.org/show_bug.cgi?id=254545)
- [Node.js 24 LTS](https://nodesource.com/blog/nodejs-24-becomes-lts), [Node 26 LTS](https://www.linuxcompatible.org/story/nodejs-26130-lithium-reaches-lts-support-through-april-2029/)
- [web.dev audio scheduling](https://web.dev/articles/audio-scheduling?hl=pl), [IRCAM scheduling tutorial](https://ircam-ismm.github.io/webaudio-tutorials/scheduling/timing-and-scheduling.html)
- [@sec-ant/barcode-detector](https://cdn.jsdelivr.net/npm/@sec-ant/barcode-detector@1.3.3/README.md), [Scanbot: html5-qrcode unmaintained](https://scanbot.io/blog/quagga2-vs-html5-qrcode-scanner/)
- [Secure origins — getUserMedia](https://groups.google.com/g/discuss-webrtc/c/QUdwwa-83K8), [Secure contexts features](https://www.thesslstore.com/blog/secure-contexts-features-chrome/)
