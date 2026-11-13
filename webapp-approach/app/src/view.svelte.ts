// Device-local view state: which Role is shown, whether we're editing, the list
// of Roles, and the reactive per-Role chart objects. Chart updates — from a local
// edit/clone or the Maestro's distribution — replace an entry in `charts`, which
// re-renders. A Role with no chart yet is "empty" until cloned from the Base.
//
// Persistence: roles + charts are auto-saved to localStorage on every change and
// restored on load, so a reload doesn't wipe edits/added Roles. It's per-device;
// when connected, the Maestro's distribution still reconciles everyone. The Base
// (audio skeleton) stays the pristine PROJECT so clones start clean.

import { PROJECT, cloneObjects } from './lib/model';
import type { Role, SongObject } from './lib/model';

const KEY = 'bandassemble:' + PROJECT.id;
const SCHEMA = 3;

interface Saved {
  v: number;
  title: string;
  roles: Role[];
  charts: Record<string, SongObject[]>;
}

function defaults(): { roles: Role[]; charts: Record<string, SongObject[]> } {
  const c: Record<string, SongObject[]> = {};
  for (const r of PROJECT.roles) c[r.id] = PROJECT.charts[r.id]?.objects ?? [];
  return { roles: PROJECT.roles.map((r) => ({ ...r })), charts: c };
}

function restore(): { roles: Role[]; charts: Record<string, SongObject[]> } {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Saved;
      if (s && s.v === SCHEMA && Array.isArray(s.roles) && s.charts) {
        return { roles: s.roles, charts: s.charts };
      }
    }
  } catch {
    /* ignore — private mode, bad data, etc. */
  }
  return defaults();
}

const seeded = restore();

export const view = $state<{ roleId: string; editing: boolean }>({
  roleId: seeded.roles[0]?.id ?? PROJECT.roles[0].id,
  editing: false,
});

export const roles = $state<Role[]>(seeded.roles);
export const charts = $state<Record<string, SongObject[]>>(seeded.charts);

function save(): void {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ v: SCHEMA, title: PROJECT.title, roles, charts } satisfies Saved),
    );
  } catch {
    /* ignore — quota / unavailable */
  }
}

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
  save();
  return id;
}

/** Fill an empty Role's chart with a clone of the Base lyrics (the skeleton). */
export function cloneBaseInto(roleId: string): void {
  charts[roleId] = cloneObjects(PROJECT.base.lyrics);
  save();
}

/** Apply a chart (local edit or distributed). Auto-registers an unknown Role so
 *  a handed-off part shows up in everyone's Role list. */
export function setChart(roleId: string, objects: SongObject[]): void {
  if (!roles.some((r) => r.id === roleId)) {
    roles.push({ id: roleId, kind: 'other', label: roleId });
  }
  charts[roleId] = objects;
  save();
}

/** Discard the saved copy and reload the pristine sample. */
export function resetProject(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  location.reload();
}
