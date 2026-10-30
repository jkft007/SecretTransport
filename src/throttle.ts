// Slows down repeated wrong guesses on THIS device. It cannot stop someone who copies the image and
// guesses offline (that is what Argon2id and a strong passphrase are for); it only makes casual
// guessing at the keyboard tedious.

export interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const FREE_ATTEMPTS = 4; // failures allowed before delays start
const BASE_MS = 5_000;
const MAX_MS = 5 * 60_000;
const FORGET_AFTER_MS = 24 * 60 * 60_000;

export interface LockState {
  locked: boolean;
  waitMs: number;
  failures: number;
}

interface Record {
  n: number; // failures so far
  until: number; // locked until (ms epoch)
  t: number; // time of last failure
}

const PREFIX = 'st-attempts:';

function read(store: Store, fp: string, now: number): Record {
  try {
    const r = JSON.parse(store.getItem(PREFIX + fp) ?? 'null') as Record | null;
    if (r && typeof r.n === 'number' && now - r.t < FORGET_AFTER_MS) return r;
  } catch {
    /* corrupted or unavailable: start fresh */
  }
  return { n: 0, until: 0, t: now };
}

function state(r: Record, now: number): LockState {
  const waitMs = Math.max(0, r.until - now);
  return { locked: waitMs > 0, waitMs, failures: r.n };
}

export function checkLock(store: Store, fp: string, now = Date.now()): LockState {
  return state(read(store, fp, now), now);
}

export function recordFailure(store: Store, fp: string, now = Date.now()): LockState {
  const r = read(store, fp, now);
  r.n += 1;
  r.t = now;
  r.until = r.n >= FREE_ATTEMPTS ? now + Math.min(MAX_MS, BASE_MS * 2 ** (r.n - FREE_ATTEMPTS)) : 0;
  try {
    store.setItem(PREFIX + fp, JSON.stringify(r));
  } catch {
    /* storage unavailable: the lockout just will not persist */
  }
  return state(r, now);
}

export function recordSuccess(store: Store, fp: string): void {
  try {
    store.removeItem(PREFIX + fp);
  } catch {
    /* ignore */
  }
}

/** Identifies a set of images without storing anything about their content. */
export async function fingerprint(images: { data: Uint8ClampedArray }[]): Promise<string> {
  const hex = (u: ArrayBuffer) => [...new Uint8Array(u)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const parts = await Promise.all(images.map(async (i) => hex(await crypto.subtle.digest('SHA-256', i.data as unknown as BufferSource))));
  parts.sort(); // order of adding images does not matter
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('|')))).slice(0, 24);
}

export function memoryStore(): Store {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

/** localStorage when available (so a reload does not reset the counter), otherwise memory. */
export function defaultStore(): Store {
  try {
    const s = window.localStorage;
    s.setItem('st-probe', '1');
    s.removeItem('st-probe');
    return s;
  } catch {
    return memoryStore();
  }
}
