// Wire protocol shared by Maestro and Players (see ../../04-sync-and-signaling.md).

import type { SongObject, Base } from './model';

// The device's job in a session. Maestro = holds audio + clock authority;
// Player = follows. (Not to be confused with a musical "Role".)
export type Seat = 'maestro' | 'player';

export interface Envelope<T = unknown> {
  v: 1;
  sessionId: string;
  from: string;
  seat: Seat;
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

/** A Role's chart: handed off (Player → Maestro) or distributed (Maestro → all). */
export interface ChartMsg {
  roleId: string;
  objects: SongObject[];
}

/** Maestro → joiner on hello: the shared project skeleton (id + title + timed Base),
 *  so a device that joined a discovered session adopts the real song as its OWN
 *  local project (keyed by `id`) instead of overwriting whatever template it had
 *  open (e.g. the seeded sample). */
export interface ProjectMetaMsg {
  id: string;
  title: string;
  base: Base;
}

/** Player clock/ping → Maestro, Maestro clock/pong → Player */
export interface PingMsg {
  t1: number;
}
export interface PongMsg {
  t1: number;
  t2: number;
  t3: number;
  to: string; // device id of the pinger
}
