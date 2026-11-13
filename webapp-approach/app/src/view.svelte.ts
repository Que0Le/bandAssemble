// Device-local view state + the live arrangement (meta + roles + charts) for the
// ACTIVE project, kept reactive so edits, clones, distribution and Open all
// re-render. The project is chosen at load from ?project=<id> (else the last
// opened, else the seeded sample) and auto-saved to localStorage through the
// registry (lib/projects). Big media lives in IndexedDB (lib/media), not here.

import { cloneObjects } from './lib/model';
import type { Role, SongObject, Base, Chart, Project } from './lib/model';
import {
  seedSampleIfEmpty,
  loadProject,
  saveProject,
  importProjectFromText,
  importBundle,
  looksLikeBundle,
  getLastOpened,
  setLastOpened,
} from './lib/projects';
import { slug, r2, download } from './lib/util';

const params = new URLSearchParams(location.search);

/** Which project to open: ?project=, else last opened, else the seeded sample. */
function resolveActiveId(): string {
  const fallback = seedSampleIfEmpty(); // guarantees at least one loadable project
  const wanted = params.get('project');
  if (wanted && loadProject(wanted)) return wanted;
  const last = getLastOpened();
  if (last && loadProject(last)) return last;
  return fallback;
}

export const activeId = resolveActiveId();
setLastOpened(activeId);
const active: Project = loadProject(activeId)!; // resolveActiveId guarantees this loads

function chartsToObjects(p: Project): Record<string, SongObject[]> {
  const ch: Record<string, SongObject[]> = {};
  for (const id of Object.keys(p.charts)) ch[id] = p.charts[id].objects;
  return ch;
}

export const meta = $state<{ id: string; title: string; base: Base }>({
  id: active.id,
  title: active.title,
  base: active.base,
});
export const view = $state<{ roleId: string; editing: boolean; autoScroll: boolean }>({
  roleId: active.roles[0]?.id ?? '',
  editing: false,
  autoScroll: true, // auto-turn pages while playing; off = flip by hand (seeks still scroll)
});
export const roles = $state<Role[]>(active.roles.map((r) => ({ ...r })));
export const charts = $state<Record<string, SongObject[]>>(chartsToObjects(active));

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
  saveProject(currentProject());
}

export function currentObjects(): SongObject[] {
  return charts[view.roleId] ?? [];
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

/** Sources a Role's chart can be cloned from: the Base, plus any other Role that
 *  already has content (future: pick between variants). Excludes the target. */
export function cloneSources(targetRoleId: string): Array<{ key: string; label: string }> {
  const out = [{ key: 'base', label: 'Base lyrics' }];
  for (const r of roles) {
    if (r.id !== targetRoleId && (charts[r.id]?.length ?? 0) > 0)
      out.push({ key: r.id, label: r.label });
  }
  return out;
}

/** Clone ALL objects (chords, strum, tab, notes — everything but the audio, which
 *  charts never hold) from a source into a Role's chart. Source is 'base' or a Role id. */
export function cloneInto(targetRoleId: string, sourceKey: string): void {
  const src = sourceKey === 'base' ? meta.base.lyrics : (charts[sourceKey] ?? []);
  charts[targetRoleId] = cloneObjects(src);
  save();
}

/** Write the Base lyric/timing skeleton (what the sync step edits). Roles clone
 *  from this; it is NOT a Role, so it never appears in the Role list. */
export function setBase(objects: SongObject[]): void {
  meta.base.lyrics = objects;
  save();
}

/** Record the Base's media reference (filename + duration). The bytes live in
 *  IndexedDB; this just notes what's attached and sets the song length. */
export function setBaseAudio(fileName: string, durationSec: number): void {
  meta.base.audio = { fileName, durationSec };
  if (durationSec) meta.base.lengthSec = r2(durationSec);
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

/** Reload the active project from storage (discards unsaved in-memory state). */
export function resetProject(): void {
  location.reload();
}

/** Download the active arrangement as a .band.json project file. */
export function saveProjectFile(): void {
  const blob = new Blob([JSON.stringify(currentProject(), null, 2)], { type: 'application/json' });
  download(blob, slug(meta.title) + '.band.json');
}

/** Open a project or bundle file: import as a NEW project (never clobbering an
 *  existing one), then reload into it. A .band.json is text-only — any media must
 *  be re-attached on the device that needs it; a .bandpack carries its media. */
export async function openProjectFile(file: File): Promise<void> {
  const text = await file.text();
  const id = looksLikeBundle(text) ? await importBundle(text) : importProjectFromText(text);
  setLastOpened(id);
  const sp = new URLSearchParams(location.search);
  sp.set('project', id);
  location.search = sp.toString();
}
