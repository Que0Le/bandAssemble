// IndexedDB-backed media store. Big audio/video blobs live here — NOT localStorage,
// which caps at ~5MB of strings. One record per project id. A 100MB file is a single
// `put` (the Blob is stored by reference, no base64), and reading it back yields a
// Blob we wrap in an object URL so the <audio>/<video> element streams it from disk.
// Only the Maestro device needs a project's media; players follow the clock + text.

const DB_NAME = 'bandassemble';
const STORE = 'media';
const VERSION = 1;

export interface MediaMeta {
  name: string;
  type: string; // MIME, e.g. "audio/mpeg" or "video/mp4"
  durationSec: number;
  size: number;
}
interface MediaRecord extends MediaMeta {
  blob: Blob;
}

let dbp: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
  return dbp;
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

/** Probe duration (and confirm it decodes) off a throwaway media element. */
function probeDuration(blob: Blob): Promise<number> {
  return new Promise((resolve) => {
    const el = document.createElement(blob.type.startsWith('video/') ? 'video' : 'audio');
    const url = URL.createObjectURL(blob);
    const done = (d: number) => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(d) && d > 0 ? d : 0);
    };
    el.preload = 'metadata';
    el.onloadedmetadata = () => done(el.duration);
    el.onerror = () => done(0);
    el.src = url;
  });
}

/** Store a project's media (overwriting any existing); returns its metadata. */
export async function putMedia(projectId: string, file: File): Promise<MediaMeta> {
  const durationSec = await probeDuration(file);
  const rec: MediaRecord = {
    blob: file,
    name: file.name,
    type: file.type || 'application/octet-stream',
    durationSec,
    size: file.size,
  };
  await tx('readwrite', (s) => s.put(rec, projectId));
  return { name: rec.name, type: rec.type, durationSec, size: rec.size };
}

async function getRecord(projectId: string): Promise<MediaRecord | null> {
  try {
    const rec = await tx<MediaRecord | undefined>('readonly', (s) => s.get(projectId));
    return rec ?? null;
  } catch {
    return null;
  }
}

/** Store a media blob with already-known metadata (no duration probe). Used when
 *  importing a .bandpack, where the duration travelled with the bundle. */
export async function putMediaBlob(
  projectId: string,
  blob: Blob,
  meta: MediaMeta,
): Promise<void> {
  const rec: MediaRecord = { blob, ...meta };
  await tx('readwrite', (s) => s.put(rec, projectId));
}

/** The raw blob + metadata for a project's media, or null. For export/bundling. */
export async function getMediaBlob(
  projectId: string,
): Promise<{ blob: Blob; meta: MediaMeta } | null> {
  const rec = await getRecord(projectId);
  if (!rec) return null;
  const { blob, ...meta } = rec;
  return { blob, meta };
}

/** Object URL for a project's media (the CALLER must revokeObjectURL), or null. */
export async function getMediaUrl(
  projectId: string,
): Promise<{ url: string; meta: MediaMeta } | null> {
  const rec = await getRecord(projectId);
  if (!rec) return null;
  const { blob, ...meta } = rec;
  return { url: URL.createObjectURL(blob), meta };
}

export async function getMediaMeta(projectId: string): Promise<MediaMeta | null> {
  const rec = await getRecord(projectId);
  if (!rec) return null;
  const { blob: _blob, ...meta } = rec;
  void _blob;
  return meta;
}

export async function hasMedia(projectId: string): Promise<boolean> {
  try {
    const n = await tx<number>('readonly', (s) => s.count(projectId));
    return n > 0;
  } catch {
    return false;
  }
}

export async function deleteMedia(projectId: string): Promise<void> {
  try {
    await tx('readwrite', (s) => s.delete(projectId));
  } catch {
    /* ignore */
  }
}

/** Ask the browser to keep our storage (don't evict under disk pressure). */
export async function requestPersist(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch {
    /* ignore */
  }
  return false;
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (navigator.storage?.estimate) {
      const e = await navigator.storage.estimate();
      return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
    }
  } catch {
    /* ignore */
  }
  return null;
}
