// Device-local view state: which Role is shown, whether we're editing, the list
// of Roles, and the reactive per-Role chart objects. Chart updates — from a local
// edit/clone or the Maestro's distribution — replace an entry in `charts`, which
// re-renders. A Role with no chart yet is "empty" until cloned from the Base.

import { PROJECT, cloneObjects } from './lib/model';
import type { Role, SongObject } from './lib/model';

const seed: Record<string, SongObject[]> = {};
for (const r of PROJECT.roles) seed[r.id] = PROJECT.charts[r.id]?.objects ?? [];

export const view = $state<{ roleId: string; editing: boolean }>({
  roleId: PROJECT.roles[0].id,
  editing: false,
});

export const roles = $state<Role[]>(PROJECT.roles.map((r) => ({ ...r })));
export const charts = $state<Record<string, SongObject[]>>(seed);

export function currentObjects(): SongObject[] {
  return charts[view.roleId] ?? [];
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'role'
  );
}

/** Add a new, empty Role locally; returns its id. */
export function addRole(label: string): string {
  const base = slug(label);
  let id = base;
  let k = 2;
  while (roles.some((r) => r.id === id)) id = `${base}-${k++}`;
  roles.push({ id, kind: 'other', label: label.trim() || id });
  charts[id] = [];
  return id;
}

/** Fill an empty Role's chart with a clone of the Base lyrics (the skeleton). */
export function cloneBaseInto(roleId: string): void {
  charts[roleId] = cloneObjects(PROJECT.base.lyrics);
}

/** Apply a chart (local edit or distributed). Auto-registers an unknown Role so
 *  a handed-off part shows up in everyone's Role list. */
export function setChart(roleId: string, objects: SongObject[]): void {
  if (!roles.some((r) => r.id === roleId)) {
    roles.push({ id: roleId, kind: 'other', label: roleId });
  }
  charts[roleId] = objects;
}
