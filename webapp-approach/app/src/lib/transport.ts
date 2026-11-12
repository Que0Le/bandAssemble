// Pluggable transport. WsTransport is the MVP impl; a future RtcTransport
// (WebRTC-over-LAN) would implement the same interface (see ../../02-architecture.md).

import type { Envelope, Seat } from './protocol';

export type StatusHandler = (status: 'connecting' | 'connected' | 'disconnected') => void;
type AnyHandler = (payload: unknown, env: Envelope) => void;

export interface Transport {
  connect(): void;
  send(kind: string, payload: unknown): void;
  on<T = unknown>(kind: string, fn: (payload: T, env: Envelope) => void): void;
  onStatus(fn: StatusHandler): void;
  close(): void;
}

function relayUrl(sessionId: string): string {
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

  constructor(
    private sessionId: string,
    private deviceId: string,
    private seat: Seat,
  ) {}

  connect(): void {
    this.statusFn('connecting');
    this.ws = new WebSocket(relayUrl(this.sessionId));
    this.ws.onopen = () => this.statusFn('connected');
    this.ws.onclose = () => {
      this.statusFn('disconnected');
      setTimeout(() => this.connect(), 1000);
    };
    this.ws.onerror = () => this.statusFn('disconnected');
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
