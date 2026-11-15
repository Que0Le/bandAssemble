// Pluggable transport. WsTransport is the MVP impl; a future RtcTransport
// (WebRTC-over-LAN) would implement the same interface (see ../../02-architecture.md).

import type { Envelope, Seat } from './protocol';

/** Extra context passed with a status change, so the UI can show WHY a socket
 *  failed (the url it dialed, the close code/reason) — key for debugging a device
 *  that loads the page but can't open the WebSocket (e.g. iOS on a blocked LAN). */
export interface StatusDetail {
  url?: string;
  code?: number; // WebSocket CloseEvent.code (1006 = abnormal: network blocked/unreachable)
  reason?: string;
  attempts?: number;
}
export type StatusHandler = (status: 'connecting' | 'connected' | 'disconnected', detail?: StatusDetail) => void;
type AnyHandler = (payload: unknown, env: Envelope) => void;

export interface Transport {
  connect(): void;
  send(kind: string, payload: unknown): void;
  on<T = unknown>(kind: string, fn: (payload: T, env: Envelope) => void): void;
  onStatus(fn: StatusHandler): void;
  close(): void;
}

export function relayUrl(sessionId: string): string {
  const q = `?session=${encodeURIComponent(sessionId)}`;
  // Dev: Vite serves pages on :5173, relay runs on :8080.
  // Prod: the relay serves the built app, so WS is same-origin.
  if (import.meta.env.DEV) return `ws://${location.hostname}:8080/ws${q}`;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws${q}`;
}

export class WsTransport implements Transport {
  private ws?: WebSocket;
  private handlers = new Map<string, AnyHandler>();
  private statusFn: StatusHandler = () => {};
  private attempts = 0;
  private openTimer?: ReturnType<typeof setTimeout>;
  /** The last WebSocket URL we dialed — shown in the UI so a device that can't
   *  connect reveals exactly what host/port it tried (catches localhost mix-ups). */
  wsUrl = '';

  constructor(
    private sessionId: string,
    private deviceId: string,
    private seat: Seat,
  ) {
    // Reconnect as soon as the page comes back: iOS freezes the tab (and kills the
    // socket) on screen-lock/backgrounding, and the pending reconnect timer is
    // frozen with it — so on resume we don't wait, we reconnect immediately. This
    // is what brings the live sync (and a joiner's re-adopt via session/hello) back
    // after an unlock without needing a manual refresh.
    const resume = () => {
      const st = this.ws?.readyState;
      if (st === WebSocket.OPEN || st === WebSocket.CONNECTING) return;
      this.connect();
    };
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) resume();
    });
    window.addEventListener('pageshow', resume); // bfcache restore
    window.addEventListener('online', resume);
  }

  connect(): void {
    clearTimeout(this.openTimer);
    // Drop any previous socket's handlers first, so a resume-triggered reconnect
    // can't leave two sockets (or two reconnect loops) racing.
    if (this.ws) {
      this.ws.onopen = this.ws.onclose = this.ws.onerror = this.ws.onmessage = null;
      try {
        this.ws.close();
      } catch {
        /* already closed */
      }
    }
    const url = relayUrl(this.sessionId);
    this.wsUrl = url;
    this.attempts++;
    this.statusFn('connecting', { url, attempts: this.attempts });
    try {
      this.ws = new WebSocket(url);
    } catch (e) {
      // Some browsers throw synchronously (e.g. a disallowed/mixed-content URL).
      this.statusFn('disconnected', { url, reason: (e as Error).message, attempts: this.attempts });
      setTimeout(() => this.connect(), 1000);
      return;
    }
    // Connect watchdog: iOS can leave a cold-start socket hung in CONNECTING —
    // it never opens AND never fires close/error, so nothing else would retry and
    // a fresh joiner is stuck on a blank screen. If it hasn't opened in time, tear
    // it down and dial again (the next attempt usually lands).
    this.openTimer = setTimeout(() => {
      if (this.ws?.readyState !== WebSocket.OPEN) {
        this.statusFn('disconnected', { url, reason: 'connect timed out', attempts: this.attempts });
        this.connect();
      }
    }, 5000);
    this.ws.onopen = () => {
      clearTimeout(this.openTimer);
      this.statusFn('connected', { url });
    };
    this.ws.onclose = (ev) => {
      clearTimeout(this.openTimer);
      this.statusFn('disconnected', { url, code: ev.code, reason: ev.reason, attempts: this.attempts });
      setTimeout(() => this.connect(), 1000);
    };
    this.ws.onerror = () => this.statusFn('disconnected', { url, attempts: this.attempts });
    this.ws.onmessage = (ev) => {
      let env: Envelope;
      try {
        env = JSON.parse(ev.data);
      } catch {
        return;
      }
      this.handlers.get(env.kind)?.(env.payload, env);
    };
  }

  send(kind: string, payload: unknown): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    const env: Envelope = {
      v: 1,
      sessionId: this.sessionId,
      from: this.deviceId,
      seat: this.seat,
      kind,
      ts: performance.now(),
      payload,
    };
    this.ws.send(JSON.stringify(env));
  }

  on<T = unknown>(kind: string, fn: (payload: T, env: Envelope) => void): void {
    this.handlers.set(kind, fn as AnyHandler);
  }
  onStatus(fn: StatusHandler): void {
    this.statusFn = fn;
  }
  close(): void {
    this.ws?.close();
  }
}
