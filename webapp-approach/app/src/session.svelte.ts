// Reactive session controller (Svelte 5 runes). Wires transport + clock sync +
// the Maestro's audio, runs the per-frame playhead update, and exposes $state for
// the UI. Fine-grained reactivity: the rAF loop writes `playhead` each frame and
// only the bound DOM updates — no VDOM diff (the reason we chose Svelte over React).
//
// Terminology (see ../SPEC.md §Terminology):
//   Maestro = the one device with the audio + clock authority (was "master")
//   Player  = any following device (was "client")
// "Role" now means the musical part and lives in the data model, not here.

import { WsTransport } from './lib/transport';
import { ClockSync } from './lib/clockSync';
import { MasterAudio } from './lib/audio';
import { labels } from './lib/model';
import type { SongObject } from './lib/model';
import { charts, setChart, meta, activeId } from './view.svelte';
import type { Seat, TransportMsg, PingMsg, PongMsg, LoopRange, ChartMsg } from './lib/protocol';

const params = new URLSearchParams(location.search);
const seatParam = params.get('seat');
export type Mode = 'maestro' | 'player' | 'editor';
export const SEAT: Mode | null =
  seatParam === 'maestro' || seatParam === 'player' || seatParam === 'editor' ? seatParam : null;
// The relay session is scoped to the PROJECT: everyone on the same song shares a
// session and syncs; different projects never cross-talk. Without this, every
// client defaulted to one shared id, so a window open on project A broadcast its
// charts (via distributeCharts on hello) into project B — silently overwriting
// B's stored chart with A's. An explicit ?session= still overrides, for a
// deliberate cross-device band where the project ids differ.
const SESSION_ID = params.get('session') || activeId;
const DEVICE_ID = Math.random().toString(36).slice(2, 8);

interface Follow {
  state: 'playing' | 'paused';
  atSec: number;
  localStart: number;
  rate: number;
  loop: LoopRange | null;
}

export class Session {
  readonly seat: Seat;
  readonly deviceId = DEVICE_ID;
  readonly sessionId = SESSION_ID;

  // reactive UI state
  conn = $state<'connecting' | 'connected' | 'disconnected'>('connecting');
  playhead = $state(0);
  uiState = $state<'playing' | 'paused'>('paused');
  rate = $state(1);
  loopOn = $state(false);
  metronome = $state(true);
  offset = $state(0);
  rtt = $state(Infinity);
  lastSync = $state(0);
  detached = $state(false); // Player force-stopped locally & ignoring the band
  songLoaded = $state(false); // Maestro: the project's recording is decoded & ready

  private transport: WsTransport;
  private clock: ClockSync;
  private audio?: MasterAudio;

  // Maestro authoritative state
  private tState: 'playing' | 'paused' = 'paused';
  private loop: LoopRange | null = null;

  // Player follow state
  private follow: Follow | null = null;

  constructor(seat: Seat) {
    this.seat = seat;
    this.transport = new WsTransport(SESSION_ID, DEVICE_ID, seat);
    this.clock = new ClockSync((k, p) => this.transport.send(k, p));
    if (seat === 'maestro') this.audio = new MasterAudio(meta.base.bpm ?? 100);
    this.wire();
  }

  private now() {
    return performance.now();
  }

  private wire() {
    if (this.seat === 'maestro') {
      this.transport.on('clock/ping', (p: PingMsg, env) =>
        this.transport.send('clock/pong', { t1: p.t1, t2: this.now(), t3: this.now(), to: env.from }),
      );
      this.transport.on('intent/play', () => this.maestroPlay());
      this.transport.on('intent/pause', () => this.maestroPause());
      this.transport.on('intent/seek', (p: { atSec: number }) => this.seek(p.atSec));
      this.transport.on('intent/jumpMarker', (p: { label: string }) => {
        const m = labels(meta.base.lyrics).find((x) => x.label === p.label);
        if (m) this.seek(m.atSec);
      });
      this.transport.on('session/hello', () => {
        this.broadcast();
        this.distributeCharts(); // bring a late joiner up to date
      });
      this.transport.on('chart/handoff', (p: ChartMsg) => {
        setChart(p.roleId, p.objects); // apply, then distribute to everyone
        this.transport.send('chart/update', p);
      });
    } else {
      this.transport.on('state/transport', (p: TransportMsg) => {
        if (this.detached) return; // force-stopped locally; ignore the band until rejoin
        this.follow = {
          state: p.state,
          atSec: p.atSec,
          localStart: p.startAtMasterTs - this.clock.offset,
          rate: p.rate,
          loop: p.loop,
        };
        this.rate = p.rate;
        this.loopOn = !!p.loop;
      });
      this.transport.on('clock/pong', (p: PongMsg) => {
        if (p.to !== DEVICE_ID) return;
        this.clock.handlePong(p);
        this.offset = this.clock.offset;
        this.rtt = this.clock.bestRtt;
        this.lastSync = this.clock.lastSync;
      });
      this.transport.on('chart/update', (p: ChartMsg) => setChart(p.roleId, p.objects));
    }
  }

  // Apply an edited chart locally, then share it: the Maestro distributes it to
  // everyone; a Player sends it up to the Maestro to distribute. Last one wins.
  handOff(roleId: string, objects: SongObject[]) {
    setChart(roleId, objects);
    if (this.seat === 'maestro') this.transport.send('chart/update', { roleId, objects });
    else this.transport.send('chart/handoff', { roleId, objects });
  }

  private distributeCharts() {
    if (this.seat !== 'maestro') return;
    for (const roleId of Object.keys(charts)) {
      this.transport.send('chart/update', { roleId, objects: charts[roleId] });
    }
  }

  start() {
    this.transport.onStatus((s) => {
      this.conn = s;
      if (s === 'connected') {
        this.transport.send('session/hello', { seat: this.seat });
        if (this.seat === 'player') this.clock.start();
        if (this.seat === 'maestro') this.broadcast();
      }
    });
    this.transport.connect();

    if (this.seat === 'maestro') {
      setInterval(() => {
        if (this.tState === 'playing') this.broadcast();
      }, 1500);
      setInterval(() => this.audio!.tick(), 25);
      setInterval(() => {
        if (this.tState === 'playing' && this.loop && this.audio!.playheadSec() >= this.loop.toSec) {
          this.seek(this.loop.fromSec);
        }
        if (this.audio!.playheadSec() >= meta.base.lengthSec) this.maestroPause();
      }, 50);
    }

    // Hybrid render driver. requestAnimationFrame gives a smooth 60fps update
    // while the window is focused/visible, but browsers pause rAF in any window
    // that loses focus or is backgrounded — which froze the follower's auto-scroll
    // the moment the Maestro window was clicked. A watchdog interval takes over
    // whenever rAF has stalled. It detects the *actual* stall (no frame in >50ms)
    // rather than trusting document.hidden, so it also covers the unfocused-but-
    // visible case (two windows on one screen). The playhead is derived from the
    // clock, so even a coarser tick lands at the correct position.
    // (A fully-hidden background tab still clamps timers to ~1s — a hard browser
    // limit — so it degrades to ~1fps but stays correct, not frozen.)
    let lastFrameAt = this.now();
    const frame = () => {
      this.renderFrame();
      lastFrameAt = this.now();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    setInterval(() => {
      if (this.now() - lastFrameAt > 50) this.renderFrame();
    }, 25);
  }

  private renderFrame() {
    if (this.seat === 'maestro') {
      this.playhead = this.audio!.playheadSec();
      this.uiState = this.tState;
      this.rate = this.audio!.rate;
    } else {
      this.playhead = this.followPlayhead();
      this.uiState = this.follow?.state ?? 'paused';
    }
  }

  private followPlayhead(): number {
    const f = this.follow;
    if (!f) return 0;
    if (f.state !== 'playing') return f.atSec;
    return f.atSec + ((this.now() - f.localStart) / 1000) * f.rate;
  }

  private broadcast() {
    if (this.seat !== 'maestro') return;
    const msg: TransportMsg = {
      state: this.tState,
      atSec: this.audio!.playheadSec(),
      startAtMasterTs: this.now(),
      rate: this.audio!.rate,
      loop: this.loop,
    };
    this.transport.send('state/transport', msg);
  }

  // ---- Maestro actions ----
  maestroPlay() {
    if (this.seat !== 'maestro') return;
    this.audio!.start(this.audio!.playheadSec());
    this.tState = 'playing';
    this.broadcast();
  }
  maestroPause() {
    if (this.seat !== 'maestro') return;
    this.audio!.stop();
    this.tState = 'paused';
    this.broadcast();
  }
  seek(atSec: number) {
    if (this.seat !== 'maestro') return;
    this.audio!.seek(Math.max(0, Math.min(atSec, meta.base.lengthSec)));
    this.broadcast();
  }
  restart() {
    this.seek(0);
  }
  setRate(rate: number) {
    if (this.seat !== 'maestro') return;
    this.audio!.setRate(rate);
    this.rate = rate;
    this.broadcast();
  }
  toggleLoop(on: boolean) {
    if (this.seat !== 'maestro') return;
    this.loop = on ? this.currentSection() : null;
    this.loopOn = on;
    this.broadcast();
  }

  // The section around the current playhead: [this label, next label or end].
  private currentSection(): LoopRange {
    const ls = labels(meta.base.lyrics);
    const head = this.audio!.playheadSec();
    let from = 0;
    let to = meta.base.lengthSec;
    for (let i = 0; i < ls.length; i++) {
      if (ls[i].atSec <= head) {
        from = ls[i].atSec;
        to = i < ls.length - 1 ? ls[i + 1].atSec : meta.base.lengthSec;
      } else break;
    }
    return { fromSec: from, toSec: to };
  }
  toggleMetronome(on: boolean) {
    if (this.audio) this.audio.metronome = on;
    this.metronome = on;
  }
  /** Maestro only: attach (or detach) the project's media element — the real
   *  <video>/<audio> the Maestro watches and plays. While attached it IS the clock
   *  and the sound source; the metronome steps aside so the recording keeps time. */
  attachMedia(el?: HTMLMediaElement) {
    if (!this.audio) return;
    this.audio.attach(el);
    this.songLoaded = !!el;
    if (el) this.toggleMetronome(false); // the real track replaces the click
  }

  // ---- live compute (debug/testing; independent of the rAF loop) ----
  livePlayhead(): number {
    return this.seat === 'maestro' ? this.audio!.playheadSec() : this.followPlayhead();
  }
  liveState(): 'playing' | 'paused' {
    return this.seat === 'maestro' ? this.tState : (this.follow?.state ?? 'paused');
  }

  // ---- Player actions (intents to the Maestro) ----
  askPlay() {
    this.transport.send('intent/play', {});
  }
  askPause() {
    this.transport.send('intent/pause', {});
  }
  askSeek(atSec: number) {
    this.transport.send('intent/seek', { atSec });
  }
  jump(label: string) {
    this.transport.send('intent/jumpMarker', { label });
  }

  /** Emergency local stop. The Maestro just pauses (authoritative). A Player
   *  freezes where it is and detaches from the band — so a stale or delayed
   *  broadcast can't un-stop it (the point: survive a bad connection). */
  forceStop() {
    if (this.seat === 'maestro') {
      this.maestroPause();
      return;
    }
    const at = this.followPlayhead();
    this.follow = { state: 'paused', atSec: at, localStart: this.now(), rate: 1, loop: null };
    this.detached = true;
  }

  /** Re-join the band after a force stop: stop ignoring broadcasts and ask the
   *  Maestro to resend its current state so we resync. */
  rejoin() {
    if (this.seat !== 'player') return;
    this.detached = false;
    this.transport.send('session/hello', { seat: this.seat });
  }
}

export const session =
  SEAT === 'maestro' || SEAT === 'player' ? new Session(SEAT) : null;

// debug handle for cross-tab verification (dev/testing only)
(globalThis as unknown as { __session?: Session | null }).__session = session;
