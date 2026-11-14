// Shared-session "join code" helpers. The relay groups devices by a session id,
// which session.svelte defaults to the PROJECT id — fine for two windows on one
// device, but a real band is on different devices whose project ids differ. A
// hand-shared code lands them in one room via ?session=<code> (the override noted
// in session.svelte). See also lib/transport (relayUrl) and components/RoleChooser.

import qrcode from 'qrcode-generator';

const KEY = 'bandassemble:session';
// No 0/O/1/I so a code read aloud or typed on a phone is unambiguous.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A short, unambiguous code to read aloud or scan. */
export function newSessionCode(len = 4): string {
  const r = crypto.getRandomValues(new Uint8Array(len));
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[r[i] % ALPHABET.length];
  return out;
}

/** The last code used on THIS device (so the host's windows agree), else a fresh one. */
export function rememberedCode(): string {
  try {
    const v = localStorage.getItem(KEY);
    if (v) return v;
  } catch {
    /* private mode / blocked storage — fall through to a fresh code */
  }
  return newSessionCode();
}

/** Persist the code locally so the host's Maestro/Editor/Player windows agree. */
export function rememberCode(code: string): void {
  try {
    if (code) localStorage.setItem(KEY, code);
  } catch {
    /* ignore */
  }
}

/** Normalize to the code alphabet: uppercase, drop anything else. */
export function normalizeCode(v: string): string {
  return v.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** The URL a player opens to join — same origin the host was reached on (friends
 *  loaded the page from the host's address, so it's reachable from their device). */
export function joinUrl(code: string): string {
  const u = new URL(location.origin + location.pathname);
  if (code) u.searchParams.set('session', code);
  u.searchParams.set('seat', 'player');
  return u.toString();
}

/** True when the page was opened on a loopback host — a QR/URL pointing here won't
 *  be reachable from other devices; the host must reopen via their LAN address. */
export function isLoopbackHost(): boolean {
  const h = location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]';
}

/** A scannable QR for a string, as an <svg> string (dark modules on a white quiet
 *  zone, so it scans on the app's dark theme). */
export function qrSvg(text: string): string {
  const qr = qrcode(0, 'M'); // auto size; 'M' ≈ 15% error correction
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
}
