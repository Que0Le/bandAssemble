// Tiny shared helpers used across the app (formatting, slugs, downloads).

/** Round to 2 decimal places — the precision we keep per-object timing at. */
export const r2 = (n: number): number => Math.round(n * 100) / 100;

/** Seconds → "m:ss" (empty string for 0 / falsy, so callers can inline it). */
export function mmss(sec: number): string {
  if (!sec) return '';
  const m = Math.floor(sec / 60);
  const ss = Math.round(sec % 60)
    .toString()
    .padStart(2, '0');
  return `${m}:${ss}`;
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
