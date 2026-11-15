// Tiny shared helpers used across the app (formatting, slugs, downloads).

/** A v4 UUID that works over plain http. `crypto.randomUUID()` is only defined in
 *  a SECURE CONTEXT (https / localhost), so on a plain-http LAN IP — exactly how
 *  phones reach the relay — it's undefined and throws, which crashed the app on
 *  load. Build the UUID from getRandomValues (available on http), with a
 *  Math.random fallback, and use randomUUID only when it actually exists. */
export function uuid(): string {
  const c: Crypto | undefined = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10xx
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0'));
  return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`;
}

/** Round to 2 decimal places — the precision we keep per-object timing at. */
export const r2 = (n: number): number => Math.round(n * 100) / 100;

/** Seconds → "m:ss" (empty string for 0 / falsy, so callers can inline it). */
export function mmss(sec: number): string {
  return sec ? secToClock(sec) : '';
}

/** Seconds → "m:ss" clock the way a media player shows elapsed time (0 → "0:00").
 *  Used for the human-friendly startMin/endMin fields in exported chart JSON. */
export function secToClock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, '0')}`;
}

/** Parse a timestamp the way you'd read it off a player: "1:42" or "1.42"
 *  (minutes + seconds). A bare number (or numeric string) is taken as seconds.
 *  Returns NaN when it can't be parsed. */
export function clockToSec(v: string | number | null | undefined): number {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return NaN;
  const t = v.trim();
  if (!t) return NaN;
  const m = /^(\d+)[:.](\d{1,2})$/.exec(t); // "m:ss" or "m.ss"
  if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

/** URL/filename-safe slug from a title (never empty — falls back to "project"). */
export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'project';
}

/** Trigger a browser download of a blob under the given filename. */
export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
