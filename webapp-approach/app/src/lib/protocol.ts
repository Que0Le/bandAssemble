// Wire protocol shared by master and client (see ../../04-sync-and-signaling.md).

export type Role = 'master' | 'client';

export interface Envelope<T = unknown> {
  v: 1;
  sessionId: string;
  from: string;
  role: Role;
  kind: string;
  ts: number;
  payload: T;
}

export interface LoopRange {
  fromSec: number;
  toSec: number;
}

/** Master → all: the authoritative transport state. */
export interface TransportMsg {
  state: 'playing' | 'paused';
  atSec: number; // playhead at the reference instant
  startAtMasterTs: number; // master clock instant atSec corresponds to
  rate: number; // 1.0 normal; <1 practice slow-down
  loop: LoopRange | null;
}

/** client clock/ping → master, master clock/pong → client */
export interface PingMsg {
  t1: number;
}
export interface PongMsg {
  t1: number;
  t2: number;
  t3: number;
  to: string; // device id of the pinger
}
