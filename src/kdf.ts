// Passphrase -> key derivation. Argon2id is memory-hard, so every guess costs an attacker
// real RAM as well as time, which blunts GPU and custom-hardware guessing.
import { argon2id } from 'hash-wasm';

export type KdfSpec = { type: 'argon2id'; memLog2: number; iterations: number } | { type: 'pbkdf2' };

/** 64 MiB, 3 passes: about a quarter of a second on a laptop. Recorded in every packet header. */
export const DEFAULT_KDF: Extract<KdfSpec, { type: 'argon2id' }> = { type: 'argon2id', memLog2: 16, iterations: 3 };

// Parameters read from an untrusted header are capped so a crafted image cannot exhaust memory.
export const MAX_MEM_LOG2 = 18; // 256 MiB
export const MAX_ITERATIONS = 10;

let current: KdfSpec = DEFAULT_KDF;
const layoutCache = new Map<string, Promise<Uint8Array>>();

/** Used by the tests to run with cheap parameters. Not exposed in the UI. */
export function setDefaultKdf(k: KdfSpec) {
  current = k;
  layoutCache.clear();
}
export const defaultKdf = (): KdfSpec => current;

const nfkc = (s: string) => new TextEncoder().encode(s.normalize('NFKC'));

export async function argon2Bytes(passphrase: string, salt: Uint8Array, memLog2: number, iterations: number): Promise<Uint8Array> {
  if (memLog2 > MAX_MEM_LOG2 || memLog2 < 3 || iterations > MAX_ITERATIONS || iterations < 1) throw new Error('Unsupported key-derivation settings');
  return argon2id({
    password: nfkc(passphrase),
    salt,
    parallelism: 1,
    iterations,
    memorySize: 2 ** memLog2, // KiB
    hashLength: 32,
    outputType: 'binary',
  });
}

const LAYOUT_SALT = new TextEncoder().encode('SecretTransport-layout-v1').slice(0, 16);

/**
 * Key that decides WHERE data is hidden (photo and fake-QR modes). The position of the hidden
 * data is checkable by a decoder without decrypting anything, so it must cost as much to guess
 * as the encryption key itself: derived with the same memory-hard function, once per passphrase.
 */
export async function layoutKey(passphrase: string, label: string): Promise<Uint8Array> {
  const k = current;
  const spec = k.type === 'argon2id' ? k : DEFAULT_KDF;
  const cacheKey = `${spec.memLog2}:${spec.iterations}:${passphrase}`;
  let master = layoutCache.get(cacheKey);
  if (!master) {
    master = argon2Bytes(passphrase, LAYOUT_SALT, spec.memLog2, spec.iterations);
    if (layoutCache.size > 4) layoutCache.clear();
    layoutCache.set(cacheKey, master);
    master.catch(() => layoutCache.delete(cacheKey));
  }
  const m = await master;
  const label8 = new TextEncoder().encode('|' + label);
  const buf = new Uint8Array(m.length + label8.length);
  buf.set(m);
  buf.set(label8, m.length);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
}

/** The old, fast derivation (a single SHA-256). Kept only so images made before the change still open. */
export async function legacyLayoutKey(label: string, passphrase: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${label}|${passphrase.normalize('NFKC')}`)));
}
