// NTP-style clock sync (client side). offset = masterClock - clientClock.
// Keeps the lowest-RTT sample of each burst; re-syncs periodically and on resume.
// See ../../04-sync-and-signaling.md.

import type { PongMsg } from './protocol';

export class ClockSync {
  offset = 0; // ms to add to local clock to get master clock
  bestRtt = Infinity;
  lastSync = 0;

  private burstTimer?: number;
  private resyncTimer?: number;

  constructor(private send: (kind: string, payload: unknown) => void) {}

  private now() {
    return performance.now();
  }

  /** Call when a clock/pong addressed to us arrives. */
  handlePong(p: PongMsg): void {
    const t4 = this.now();
    const rtt = t4 - p.t1 - (p.t3 - p.t2);
    const offset = (p.t2 - p.t1 + (p.t3 - t4)) / 2;
    if (rtt < this.bestRtt) {
      this.bestRtt = rtt;
      this.offset = offset;
    }
    this.lastSync = this.now();
  }

  private burst(): void {
    this.bestRtt = Infinity; // re-evaluate each burst
    let n = 0;
    clearInterval(this.burstTimer);
    this.burstTimer = setInterval(() => {
      this.send('clock/ping', { t1: this.now() });
      if (++n >= 8) clearInterval(this.burstTimer);
    }, 60) as unknown as number;
  }

  start(): void {
    this.burst();
    this.resyncTimer = setInterval(() => this.burst(), 20000) as unknown as number;
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.burst();
    });
  }

  stop(): void {
    clearInterval(this.burstTimer);
    clearInterval(this.resyncTimer);
  }
}
