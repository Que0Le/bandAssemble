// Device-local view state + the live arrangement (meta + roles + charts), kept
// reactive so edits, clones, distribution and Open all re-render. Everything is
// auto-saved to localStorage as a Project (the same shape as the save/open file)
// and restored on load; the Base stays editable only via Open (clones read it).

import { PROJECT, cloneObjects } from './lib/model';
import type { Role, SongObject, Base, Chart, Project } from './lib/model';

const KEY = 'bandassemble:' + PROJECT.id;

interface Snapshot {
  meta: { id: string; title: string; base: Base };
  roles: Role[];
  charts: Record<string, SongObject[]>;
}

function defaultCharts(): Record<string, SongObject[]> {
  const c: Record<string, SongObject[]> = {};
  for (const r of PROJECT.roles) c[r.id] = PROJECT.charts[r.id]?.objects ?? [];
  return c;
}

function fromProject(p: Project): Snapshot {
  const ch: Record<string, SongObject[]> = {};
  for (const id of Object.keys(p.charts)) ch[id] = p.charts[id].objects;
  return { meta: { id: p.id, title: p.title, base: p.base }, roles: p.roles, charts: ch };
}

function restore(): Snapshot {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Project;
      if (p && p.schemaVersion === 3 && Array.isArray(p.roles) && p.charts && p.base) {
        return fromProject(p);
      }
    }
  } catch {
    /* ignore — private mode, bad data, etc. */
  }
  return {
    meta: { id: PROJECT.id, title: PROJECT.title, base: PROJECT.base },
    roles: PROJECT.roles.map((r) => ({ ...r })),
    charts: defaultCharts(),
  };
}

const seeded = restore();

export const meta = $state(seeded.meta);
export const view = $state<{ roleId: string; editing: boolean }>({
  roleId: seeded.roles[0]?.id ?? PROJECT.roles[0].id,
  editing: false,
});
export const roles = $state<Role[]>(seeded.roles);
export const charts = $state<Record<string, SongObject[]>>(seeded.charts);

/** The live arrangement as a Project — the storage AND save/open file format. */
export function currentProject(): Project {
  const c: Record<string, Chart> = {};
  for (const id of Object.keys(charts)) c[id] = { roleId: id, objects: charts[id] };
  return {
    schemaVersion: 3,
    id: meta.id,
    title: meta.title,
    base: meta.base,
    roles: [...roles],
    charts: c,
  };
}

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(currentProject()));
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
      .replace(/(^-|-$)/g, '') || 'project'
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
  charts[roleId] = cloneObjects(meta.base.lyrics);
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

/** Download the whole arrangement as a .band.json project file. */
export function saveProjectFile(): void {
  const text = JSON.stringify(currentProject(), null, 2);
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = slug(meta.title) + '.band.json';
  a.click();
  URL.revokeObjectURL(url);
}

/** Open a project file: validate, persist, reload so everything re-seeds cleanly. */
export async function openProjectFile(file: File): Promise<void> {
  const p = JSON.parse(await file.text()) as Project;
  if (!p || p.schemaVersion !== 3 || !Array.isArray(p.roles) || !p.charts || !p.base) {
    throw new Error('Not a bandAssemble project file (schemaVersion 3).');
  }
  localStorage.setItem(KEY, JSON.stringify(p));
  location.reload();
}
