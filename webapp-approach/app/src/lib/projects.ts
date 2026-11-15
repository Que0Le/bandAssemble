// Project registry (localStorage). The index lists every project; each project's
// full JSON lives at bandassemble:<id> — the same shape as the save/open file.
// Big media is NOT stored here: it lives in IndexedDB (see media.ts). Everything
// here is small text (title, roles, charts, timing), so localStorage is plenty.

import { PROJECT } from './model';
import type { Project } from './model';
import { deleteMedia, getMediaBlob, putMediaBlob } from './media';
import type { MediaMeta } from './media';
import { slug, download, uuid } from './util';

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
  const o = p as { schemaVersion?: number; roles?: unknown; charts?: unknown; base?: unknown } | null;
  // accept v3 and v4 — v3 objects are structurally valid v4 (kind/chorddef are additive)
  return (
    !!o &&
    (o.schemaVersion === 3 || o.schemaVersion === 4) &&
    Array.isArray(o.roles) &&
    !!o.charts &&
    !!o.base
  );
}

/** Upgrade an accepted project in place to the current schema (v3 -> v4). */
function migrate(p: Project): Project {
  p.schemaVersion = 4; // additive: v3 lines lack `kind` (= lyric), no chorddefs
  return p;
}

export function loadProject(id: string): Project | null {
  const p = read<Project>(projectKey(id));
  return isProject(p) ? migrate(p) : null;
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

/** A blank project: empty Base, no roles. Returns its new id. */
export function createProject(title: string): string {
  // Globally-unique id (not a title slug): two devices that both make a song
  // called "The Scientist" must NOT collide, or joining one would overwrite the
  // other's local project. The id is identity; the title is just a label.
  const id = uuid();
  saveProject({
    schemaVersion: 4,
    id,
    title: title.trim() || id,
    base: { lengthSec: 0, lyrics: [] },
    roles: [],
    charts: {},
  });
  return id;
}

/** Import a project (validated by the caller) under a fresh id — never clobbers. */
export function importProject(p: Project): string {
  const id = uuid();
  saveProject(migrate({ ...p, id }));
  return id;
}

export function duplicateProject(id: string): string | null {
  const p = loadProject(id);
  if (!p) return null;
  const newId = uuid();
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
  if (!isProject(p)) throw new Error('Not a bandAssemble project file (schemaVersion 3–4).');
  return importProject(p);
}

/** Download one project (by id) as a .band.json file. Text only — no media. */
export function exportProjectFile(id: string): void {
  const p = loadProject(id);
  if (!p) return;
  download(new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' }), slug(p.title) + '.band.json');
}

// --- .bandpack: a project bundled WITH its media, for moving between your own
// devices. It's a JSON wrapper { format, version, project, media? } where the
// media blob rides along base64-encoded. Plain .band.json stays text-only. ---

interface Bundle {
  format: 'bandpack';
  version: 1;
  project: Project;
  media?: MediaMeta & { dataBase64: string };
}

function isBundle(o: unknown): o is Bundle {
  const b = o as Bundle | null;
  return !!b && b.format === 'bandpack' && isProject(b.project);
}

/** Detect whether a file's text is a .bandpack bundle (vs a plain .band.json). */
export function looksLikeBundle(text: string): boolean {
  try {
    return isBundle(JSON.parse(text));
  } catch {
    return false;
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const s = fr.result as string; // "data:<type>;base64,<payload>"
      resolve(s.slice(s.indexOf(',') + 1));
    };
    fr.onerror = () => reject(fr.error ?? new Error('read failed'));
    fr.readAsDataURL(blob);
  });
}
function base64ToBlob(b64: string, type: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** Download a project AND its stored media as one .bandpack file. */
export async function exportBundle(id: string): Promise<void> {
  const p = loadProject(id);
  if (!p) return;
  const bundle: Bundle = { format: 'bandpack', version: 1, project: p };
  const m = await getMediaBlob(id);
  if (m) bundle.media = { ...m.meta, dataBase64: await blobToBase64(m.blob) };
  download(new Blob([JSON.stringify(bundle)], { type: 'application/json' }), slug(p.title) + '.bandpack');
}

/** Import a .bandpack as a NEW project (never clobbering), restoring its media
 *  into IndexedDB. Returns the new id. Throws on bad input. */
export async function importBundle(text: string): Promise<string> {
  const b = JSON.parse(text);
  if (!isBundle(b)) throw new Error('Not a bandAssemble bundle (.bandpack).');
  const id = importProject(b.project);
  if (b.media) {
    const { dataBase64, ...meta } = b.media;
    await putMediaBlob(id, base64ToBlob(dataBase64, meta.type), meta);
  }
  return id;
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
/** One-time cleanup: drop the bundled demo project if it's still untouched. The
 *  app no longer auto-seeds it, so once removed it stays gone; this also clears
 *  the pristine copy from devices that already have it. A demo the user actually
 *  edited is NOT touched — that's their data; they can delete it from the list. */
export function removePristineSample(): void {
  const existing = loadProject(PROJECT.id);
  if (existing && JSON.stringify(existing) === JSON.stringify(PROJECT)) {
    void deleteProject(PROJECT.id);
  }
}
