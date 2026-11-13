// Project registry (localStorage). The index lists every project; each project's
// full JSON lives at bandassemble:<id> — the same shape as the save/open file.
// Big media is NOT stored here: it lives in IndexedDB (see media.ts). Everything
// here is small text (title, roles, charts, timing), so localStorage is plenty.

import { PROJECT } from './model';
import type { Project } from './model';
import { deleteMedia } from './media';

const INDEX_KEY = 'bandassemble:index';
const LAST_KEY = 'bandassemble:last';
const projectKey = (id: string) => `bandassemble:${id}`;

/** One row in the home-page project list. */
export interface ProjectMeta {
  id: string;
  title: string;
  updatedAt: number;
  audioName?: string;
  lengthSec: number;
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function write(key: string, val: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {
    /* quota / private mode — ignore */
  }
}
function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function readIndex(): ProjectMeta[] {
  return read<ProjectMeta[]>(INDEX_KEY) ?? [];
}
function writeIndex(idx: ProjectMeta[]): void {
  write(INDEX_KEY, idx);
}

/** Projects, most-recently-updated first. */
export function listProjects(): ProjectMeta[] {
  return [...readIndex()].sort((a, b) => b.updatedAt - a.updatedAt);
}

function metaOf(p: Project): ProjectMeta {
  return {
    id: p.id,
    title: p.title,
    updatedAt: Date.now(),
    audioName: p.base.audio?.fileName,
    lengthSec: p.base.lengthSec,
  };
}

function isProject(p: unknown): p is Project {
  const o = p as Project | null;
  return (
    !!o && o.schemaVersion === 3 && Array.isArray(o.roles) && !!o.charts && !!o.base
  );
}

export function loadProject(id: string): Project | null {
  const p = read<Project>(projectKey(id));
  return isProject(p) ? p : null;
}

/** Persist a project and upsert its index row (bumps updatedAt). */
export function saveProject(p: Project): void {
  write(projectKey(p.id), p);
  const idx = readIndex();
  const m = metaOf(p);
  const i = idx.findIndex((e) => e.id === p.id);
  if (i >= 0) idx[i] = m;
  else idx.push(m);
  writeIndex(idx);
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'project'
  );
}
function uniqueId(base: string): string {
  const idx = readIndex();
  let id = base;
  let k = 2;
  while (idx.some((e) => e.id === id)) id = `${base}-${k++}`;
  return id;
}

/** A blank project: empty Base, no roles. Returns its new id. */
export function createProject(title: string): string {
  const id = uniqueId(slug(title));
  saveProject({
    schemaVersion: 3,
    id,
    title: title.trim() || id,
    base: { lengthSec: 0, lyrics: [] },
    roles: [],
    charts: {},
  });
  return id;
}

/** Import a project (validated by the caller); fresh id if it clashes — never clobbers. */
export function importProject(p: Project): string {
  const id = uniqueId(slug(p.title || p.id || 'project'));
  saveProject({ ...p, id });
  return id;
}

export function duplicateProject(id: string): string | null {
  const p = loadProject(id);
  if (!p) return null;
  const newId = uniqueId(slug(p.title) + '-copy');
  saveProject({ ...p, id: newId, title: p.title + ' (copy)' });
  return newId;
}

export function renameProject(id: string, title: string): void {
  const p = loadProject(id);
  if (!p) return;
  p.title = title.trim() || p.title;
  saveProject(p);
}

/** Parse + validate project text and import it as a new project. Throws on bad input. */
export function importProjectFromText(text: string): string {
  const p = JSON.parse(text) as Project;
  if (!isProject(p)) throw new Error('Not a bandAssemble project file (schemaVersion 3).');
  return importProject(p);
}

/** Download one project (by id) as a .band.json file. Text only — no media. */
export function exportProjectFile(id: string): void {
  const p = loadProject(id);
  if (!p) return;
  const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = slug(p.title) + '.band.json';
  a.click();
  URL.revokeObjectURL(url);
}

export async function deleteProject(id: string): Promise<void> {
  remove(projectKey(id));
  writeIndex(readIndex().filter((e) => e.id !== id));
  await deleteMedia(id);
  if (getLastOpened() === id) setLastOpened(null);
}

export function getLastOpened(): string | null {
  return read<string>(LAST_KEY);
}
export function setLastOpened(id: string | null): void {
  if (id) write(LAST_KEY, id);
  else remove(LAST_KEY);
}

/** Seed the bundled sample once so a fresh install isn't empty. Preserves an
 *  existing saved copy (e.g. from before the registry existed). Returns an id
 *  that is guaranteed to load. */
export function seedSampleIfEmpty(): string {
  const idx = readIndex();
  if (idx.length > 0) return idx[0].id;
  const existing = loadProject(PROJECT.id); // migrate a pre-registry install
  saveProject(existing ?? structuredClone(PROJECT));
  return PROJECT.id;
}
