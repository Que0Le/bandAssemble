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
import { putMedia, requestPersist } from './lib/media';
import type { MediaMeta } from './lib/media';
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
/** How the chart is laid out: the two-page horizontal pager, or a single
 *  full-width column that scrolls down (teleprompter) — better on a phone held
 *  in portrait. Device-local; persisted so a phone stays in 'scroll'. */
export type ChartMode = 'pages' | 'scroll';
const CHART_MODE_KEY = 'bandassemble:chartMode';
function initialChartMode(): ChartMode {
  try {
    const v = localStorage.getItem(CHART_MODE_KEY);
    if (v === 'pages' || v === 'scroll') return v;
  } catch {
    /* blocked storage — fall through to the width default */
  }
  // No stored choice: default phones to the vertical scroll, wider screens to pages.
  return typeof window !== 'undefined' && window.innerWidth < 700 ? 'scroll' : 'pages';
}

export const view = $state<{
  roleId: string;
  editing: boolean;
  autoScroll: boolean;
  chartMode: ChartMode;
  ephemeral: boolean;
}>({
  roleId: active.roles[0]?.id ?? '',
  editing: false,
  autoScroll: true, // auto-turn pages while playing; off = flip by hand (seeks still scroll)
  chartMode: initialChartMode(),
  // A joined (discovered) session is live-only: we hold the host's project in
  // memory and persist NOTHING, so a device never accumulates copies of songs it
  // merely visited. "Save a copy" (saveJoinedCopy) turns it into a real project.
  ephemeral: false,
});

/** Switch the chart layout and remember it on this device. */
export function setChartMode(m: ChartMode): void {
  view.chartMode = m;
  try {
    localStorage.setItem(CHART_MODE_KEY, m);
  } catch {
    /* ignore */
  }
}
export const roles = $state<Role[]>(active.roles.map((r) => ({ ...r })));
export const charts = $state<Record<string, SongObject[]>>(chartsToObjects(active));

/** The live arrangement as a Project — the storage AND save/open file format. */
export function currentProject(): Project {
  const c: Record<string, Chart> = {};
  for (const id of Object.keys(charts)) c[id] = { roleId: id, objects: charts[id] };
  return {
    schemaVersion: 4,
    id: meta.id,
    title: meta.title,
    base: meta.base,
    roles: [...roles],
    charts: c,
  };
}

function save(): void {
  if (view.ephemeral) return; // joined session — live-only, never touches storage
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

/** Attach a file as the active project's media: store the bytes in IndexedDB,
 *  note the reference + song length on the Base, and ask to keep it from eviction.
 *  Shared by the Editor and the Maestro's media panel. */
export async function storeProjectMedia(file: File): Promise<MediaMeta> {
  const m = await putMedia(activeId, file);
  setBaseAudio(file.name, m.durationSec);
  void requestPersist();
  return m;
}

/** Adopt a joined session's AUTHORITATIVE project (id + title + Base + the full
 *  role & chart set) so a device that joined a discovered session mirrors the
 *  Maestro exactly. It REPLACES the whole role/chart set — any role the Maestro
 *  doesn't send is dropped — so a stale local chart (a leftover role, or diverged
 *  timings) can never linger and put the cursor on the wrong line. Lands as a
 *  SEPARATE local project keyed by the Maestro's id, so it never clobbers whatever
 *  template the device had open (e.g. the seeded sample). */
export function adoptProject(
  id: string,
  title: string,
  base: Base,
  incomingRoles: Role[],
  incomingCharts: Record<string, SongObject[]>,
): void {
  // A join is EPHEMERAL: mirror the host's live project in memory but persist
  // nothing — the device's own stored projects stay untouched, and it never
  // piles up copies of songs it only visited. (saveJoinedCopy keeps one on demand.)
  view.ephemeral = true;
  if (id) meta.id = id;
  meta.title = title;
  meta.base = base;
  // Replace roles wholesale (drop any the Maestro didn't send).
  roles.length = 0;
  for (const r of incomingRoles) roles.push({ ...r });
  // Replace charts wholesale.
  for (const k of Object.keys(charts)) delete charts[k];
  for (const k of Object.keys(incomingCharts)) charts[k] = incomingCharts[k];
  // Keep the current role if it still exists, else land on the first real one.
  if (!roles.some((r) => r.id === view.roleId)) view.roleId = roles[0]?.id ?? '';
  // Deliberately no save()/setLastOpened — the live arrangement stays in memory.
}

/** Persist the currently-joined (ephemeral) session as a real local project under
 *  a fresh id, so the user can keep practising it offline. Leaves ephemeral mode,
 *  so further host updates then save to this copy too. Returns the new id. */
export function saveJoinedCopy(): string {
  const id = crypto.randomUUID();
  meta.id = id;
  view.ephemeral = false;
  saveProject(currentProject());
  setLastOpened(id);
  return id;
}

/** Apply a chart (local edit or distributed). Auto-registers an unknown Role so
 *  a handed-off part shows up in everyone's Role list. */
export function setChart(roleId: string, objects: SongObject[]): void {
  if (!roles.some((r) => r.id === roleId)) {
    roles.push({ id: roleId, kind: 'other', label: roleId });
  }
  charts[roleId] = objects;
  // If the current selection is gone (e.g. right after adopting a joined song
  // cleared the old roles), land on the first role we receive so the chart shows.
  if (!roles.some((r) => r.id === view.roleId)) view.roleId = roleId;
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
