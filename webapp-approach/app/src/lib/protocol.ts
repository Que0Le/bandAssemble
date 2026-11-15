// Wire protocol shared by Maestro and Players (see ../../04-sync-and-signaling.md).

import type { SongObject, Base, Role } from './model';

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

/** Maestro → joiner on hello: the AUTHORITATIVE whole project (id + title + timed
 *  Base + every Role and its chart). The joiner REPLACES its entire role/chart set
 *  with this — roles the Maestro doesn't send are dropped — so a stale local chart
 *  (a leftover role, or diverged timings) can never linger and mis-highlight. It
 *  still lands as a SEPARATE local project keyed by `id`, never clobbering whatever
 *  template the device had open (e.g. the seeded sample). */
export interface ProjectSyncMsg {
  id: string;
  title: string;
  base: Base;
  roles: Role[];
  charts: Record<string, SongObject[]>;
  /** The Maestro's currently-viewed role, so a fresh joiner lands on the SAME
   *  part (and line) instead of defaulting to the first role. */
  focusRole?: string;
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
