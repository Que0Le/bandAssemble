// Reactive session controller (Svelte 5 runes). Wires transport + clock sync +
// master audio, runs the per-frame playhead update, and exposes $state for the UI.
// Fine-grained reactivity: the rAF loop writes `playhead` each frame and only the
// bound DOM updates — no VDOM diff (the reason we chose Svelte over React).

import { WsTransport } from './lib/transport';
import { ClockSync } from './lib/clockSync';
import { MasterAudio } from './lib/audio';
import { PROJECT, labels } from './lib/model';
import type { Role, TransportMsg, PingMsg, PongMsg, LoopRange } from './lib/protocol';

const params = new URLSearchParams(location.search);
const roleParam = params.get('role');
export type AppRole = 'master' | 'client' | 'editor';
export const ROLE: AppRole | null =
  roleParam === 'master' || roleParam === 'client' || roleParam === 'editor' ? roleParam : null;
const SESSION_ID = params.get('session') || 'spike';
const DEVICE_ID = Math.random().toString(36).slice(2, 8);
const CHORUS_LOOP: LoopRange = { fromSec: 24, toSec: 40 };

interface Follow {
  state: 'playing' | 'paused';
  atSec: number;
  localStart: number;
  rate: number;
  loop: LoopRange | null;
}

export class Session {
  readonly role: Role;
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

  private transport: WsTransport;
  private clock: ClockSync;
  private audio?: MasterAudio;

  // master authoritative state
  private tState: 'playing' | 'paused' = 'paused';
  private loop: LoopRange | null = null;

  // client follow state
  private follow: Follow | null = null;

  constructor(role: Role) {
    this.role = role;
    this.transport = new WsTransport(SESSION_ID, DEVICE_ID, role);
    this.clock = new ClockSync((k, p) => this.transport.send(k, p));
    if (role === 'master') this.audio = new MasterAudio(PROJECT.bpm ?? 100);
    this.wire();
  }

  private now() {
    return performance.now();
  }

  private wire() {
    if (this.role === 'master') {
      this.transport.on('clock/ping', (p: PingMsg, env) =>
        this.transport.send('clock/pong', { t1: p.t1, t2: this.now(), t3: this.now(), to: env.from }),
      );
      this.transport.on('intent/play', () => this.masterPlay());
      this.transport.on('intent/pause', () => this.masterPause());
      this.transport.on('intent/seek', (p: { atSec: number }) => this.seek(p.atSec));
      this.transport.on('intent/jumpMarker', (p: { label: string }) => {
        const m = labels(PROJECT).find((x) => x.label === p.label);
        if (m) this.seek(m.atSec);
      });
      this.transport.on('session/hello', () => this.broadcast());
    } else {
      this.transport.on('state/transport', (p: TransportMsg) => {
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
    }
  }

  start() {
    this.transport.onStatus((s) => {
      this.conn = s;
      if (s === 'connected') {
        this.transport.send('session/hello', { role: this.role });
        if (this.role === 'client') this.clock.start();
        if (this.role === 'master') this.broadcast();
      }
    });
    this.transport.connect();

    if (this.role === 'master') {
      setInterval(() => {
        if (this.tState === 'playing') this.broadcast();
      }, 1500);
      setInterval(() => this.audio!.tick(), 25);
      setInterval(() => {
        if (this.tState === 'playing' && this.loop && this.audio!.playheadSec() >= this.loop.toSec) {
          this.seek(this.loop.fromSec);
        }
        if (this.audio!.playheadSec() >= PROJECT.lengthSec) this.masterPause();
      }, 50);
    }

    // Hybrid render driver. requestAnimationFrame gives a smooth 60fps update
    // while the window is focused/visible, but browsers pause rAF in any window
    // that loses focus or is backgrounded — which froze the follower's auto-scroll
    // the moment the master window was clicked. A watchdog interval takes over
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
    if (this.role === 'master') {
      this.playhead = this.audio!.playheadSec();
      this.uiState = this.tState;
      this.rate = this.audio!.rate;
    } else {
      this.playhead = this.clientPlayhead();
      this.uiState = this.follow?.state ?? 'paused';
    }
  }

  private clientPlayhead(): number {
    const f = this.follow;
    if (!f) return 0;
    if (f.state !== 'playing') return f.atSec;
    return f.atSec + ((this.now() - f.localStart) / 1000) * f.rate;
  }

  private broadcast() {
    if (this.role !== 'master') return;
    const msg: TransportMsg = {
      state: this.tState,
      atSec: this.audio!.playheadSec(),
      startAtMasterTs: this.now(),
      rate: this.audio!.rate,
      loop: this.loop,
    };
    this.transport.send('state/transport', msg);
  }

  // ---- master actions ----
  masterPlay() {
    if (this.role !== 'master') return;
    this.audio!.start(this.audio!.playheadSec());
    this.tState = 'playing';
    this.broadcast();
  }
  masterPause() {
    if (this.role !== 'master') return;
    this.audio!.stop();
    this.tState = 'paused';
    this.broadcast();
  }
  seek(atSec: number) {
    if (this.role !== 'master') return;
    this.audio!.seek(Math.max(0, Math.min(atSec, PROJECT.lengthSec)));
    this.broadcast();
  }
  restart() {
    this.seek(0);
  }
  setRate(rate: number) {
    if (this.role !== 'master') return;
    this.audio!.setRate(rate);
    this.rate = rate;
    this.broadcast();
  }
  toggleLoop(on: boolean) {
    if (this.role !== 'master') return;
    this.loop = on ? CHORUS_LOOP : null;
    this.loopOn = on;
    this.broadcast();
  }
  toggleMetronome(on: boolean) {
    if (this.audio) this.audio.metronome = on;
    this.metronome = on;
  }
  async loadFile(file: File) {
    if (this.audio) await this.audio.loadFile(file);
  }

  // ---- live compute (debug/testing; independent of the rAF loop) ----
  livePlayhead(): number {
    return this.role === 'master' ? this.audio!.playheadSec() : this.clientPlayhead();
  }
  liveState(): 'playing' | 'paused' {
    return this.role === 'master' ? this.tState : (this.follow?.state ?? 'paused');
  }

  // ---- client actions (intents) ----
  askPlay() {
    this.transport.send('intent/play', {});
  }
  askPause() {
    this.transport.send('intent/pause', {});
  }
  jump(label: string) {
    this.transport.send('intent/jumpMarker', { label });
  }
}

export const session =
  ROLE === 'master' || ROLE === 'client' ? new Session(ROLE) : null;

// debug handle for cross-tab verification (dev/testing only)
(globalThis as unknown as { __session?: Session | null }).__session = session;
