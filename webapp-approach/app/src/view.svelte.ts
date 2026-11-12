// Device-local view state: which Role is shown, whether we're editing, and the
// reactive per-Role chart objects. Chart updates — from a local hand-off or from
// the Maestro's distribution — replace an entry in `charts`, which re-renders.
// Role choice and edit state are per-device; the playhead/sync is unaffected.

import { PROJECT } from './lib/model';
import type { SongObject } from './lib/model';

const seed: Record<string, SongObject[]> = {};
for (const r of PROJECT.roles) seed[r.id] = PROJECT.charts[r.id]?.objects ?? [];

export const view = $state<{ roleId: string; editing: boolean }>({
  roleId: PROJECT.roles[0].id,
  editing: false,
});

export const charts = $state<Record<string, SongObject[]>>(seed);

export function currentObjects(): SongObject[] {
  return charts[view.roleId] ?? [];
}

export function setChart(roleId: string, objects: SongObject[]): void {
  charts[roleId] = objects;
}
