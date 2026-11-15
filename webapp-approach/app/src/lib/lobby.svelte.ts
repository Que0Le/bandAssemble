// Live-session discovery over the relay. There's no central directory — instead,
// every device that is HOSTING (a Maestro) beacons a tiny presence message into a
// reserved "__lobby__" room every few seconds; any device sitting on the Home page
// joins that room and collects the beacons into a live list. Beacons repeat (and
// entries expire) so it self-heals on the stateless relay: a late observer sees
// the next beacon within a few seconds, and a host that drops falls off on timeout.
//
// This only advertises WHICH session to join; the charts + project still stream
// from the Maestro on join (see session.svelte, project/meta + chart/update).

import { relayUrl } from './transport';

const LOBBY_ROOM = '__lobby__';
const BEACON_MS = 4000; // how often a host re-announces
const STALE_MS = 12000; // drop a host not heard from in this long

/** One advertised live session, as shown on the Home page. */
export interface HostEntry {
  code: string; // the session id to join (?session=<code>)
  projectId: string;
  title: string;
  device: string; // the host's device id (map key)
  seenAt: number; // local timestamp of the last beacon (for staleness)
}

/** What a host advertises about itself. */
export type Beacon = { code: string; projectId: string; title: string };

export class Lobby {
  /** Live hosts, keyed by device id — reactive, read by the Home list. */
  hosts = $state<Record<string, HostEntry>>({});

  private ws?: WebSocket;
  private beaconTimer?: ReturnType<typeof setInterval>;
  private pruneTimer?: ReturnType<typeof setInterval>;
  private openTimer?: ReturnType<typeof setTimeout>;
  private closed = false;
  private beacon?: () => Beacon | null;

  constructor(private deviceId: string) {}

  /** Connect to the lobby. Pass `beacon` to also advertise (Maestro); omit it to
   *  only observe (Home). `beacon` is polled each interval so it tracks the live
   *  title/session. */
  connect(beacon?: () => Beacon | null): void {
    this.beacon = beacon;
    this.open();
    this.pruneTimer = setInterval(() => {
      const now = Date.now();
      for (const k of Object.keys(this.hosts)) {
        if (now - this.hosts[k].seenAt > STALE_MS) delete this.hosts[k];
      }
    }, 3000);
  }

  private open(): void {
    if (this.closed) return;
    clearTimeout(this.openTimer);
    this.ws = new WebSocket(relayUrl(LOBBY_ROOM));
    // Same cold-start guard as the main transport: if this socket hangs in
    // CONNECTING (iOS), tear it down and redial so the Home list isn't stuck empty.
    this.openTimer = setTimeout(() => {
      if (this.ws && this.ws.readyState !== WebSocket.OPEN && !this.closed) {
        this.ws.onclose = null;
        try {
          this.ws.close();
        } catch {
          /* already closed */
        }
        this.open();
      }
    }, 5000);
    this.ws.onopen = () => {
      clearTimeout(this.openTimer);
      if (!this.beacon) return;
      this.sendBeacon();
      this.beaconTimer = setInterval(() => this.sendBeacon(), BEACON_MS);
    };
    this.ws.onmessage = (ev) => {
      let m: { kind?: string; device?: string } & Partial<Beacon>;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (!m.device || m.device === this.deviceId) return; // ignore our own echo
      if (m.kind === 'host' && m.code && m.projectId) {
        this.hosts[m.device] = {
          code: m.code,
          projectId: m.projectId,
          title: m.title ?? m.code,
          device: m.device,
          seenAt: Date.now(),
        };
      } else if (m.kind === 'bye') {
        delete this.hosts[m.device];
      }
    };
    this.ws.onclose = () => {
      clearTimeout(this.openTimer);
      clearInterval(this.beaconTimer);
      if (!this.closed) setTimeout(() => this.open(), 1500); // reconnect
    };
    this.ws.onerror = () => {};
  }

  private sendBeacon(): void {
    const b = this.beacon?.();
    if (b && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ kind: 'host', device: this.deviceId, ...b }));
    }
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.openTimer);
    clearInterval(this.beaconTimer);
    clearInterval(this.pruneTimer);
    try {
      if (this.beacon && this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ kind: 'bye', device: this.deviceId })); // leave cleanly
      }
    } catch {
      /* ignore */
    }
    this.ws?.close();
  }
}
