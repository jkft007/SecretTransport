import { argon2Bytes, defaultKdf, type KdfSpec } from './kdf';
import { TAG_LEN, buildHeader, finishPacket, parsePacket } from './packet';

const PBKDF2_ITERATIONS = 600_000; // version 1 packets only
const subtle = globalThis.crypto.subtle;
const bs = (u: Uint8Array) => u as unknown as BufferSource;

export class WrongPassphraseError extends Error {
  constructor() {
    super('Wrong passphrase, or the image is damaged');
  }
}

const aesKey = (raw: Uint8Array, usages: KeyUsage[]) => subtle.importKey('raw', bs(raw), { name: 'AES-GCM', length: 256 }, false, usages);

async function deriveKey(passphrase: string, salt: Uint8Array, kdf: KdfSpec): Promise<CryptoKey> {
  if (kdf.type === 'argon2id') {
    const raw = await argon2Bytes(passphrase, salt, kdf.memLog2, kdf.iterations);
    return aesKey(raw, ['encrypt', 'decrypt']);
  }
  const raw = await subtle.importKey('raw', bs(new TextEncoder().encode(passphrase.normalize('NFKC'))), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', salt: bs(salt), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    raw,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bs(data)]).stream().pipeThrough(stream as unknown as ReadableWritablePair));
  return new Uint8Array(await out.arrayBuffer());
}
const deflate = (d: Uint8Array) => pipe(d, new CompressionStream('deflate-raw'));
const inflate = (d: Uint8Array) => pipe(d, new DecompressionStream('deflate-raw'));

export type Payload = { kind: 'text'; text: string } | { kind: 'file'; name: string; data: Uint8Array };

/** Strips paths and characters that are unsafe in file names; never returns an empty name. */
export function safeFileName(raw: string): string {
  let n = raw.split(/[\\/]/).pop() ?? '';
  n = n.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_').replace(/^[. ]+|[. ]+$/g, '');
  if (n.length > 120) {
    const dot = n.lastIndexOf('.');
    const ext = dot > 0 && n.length - dot <= 12 ? n.slice(dot) : '';
    n = n.slice(0, 120 - ext.length) + ext;
  }
  return n || 'secret-file';
}

function encodePayload(p: Payload): Uint8Array {
  if (p.kind === 'text') return new TextEncoder().encode(p.text);
  const name = new TextEncoder().encode(safeFileName(p.name));
  const out = new Uint8Array(2 + name.length + p.data.length);
  new DataView(out.buffer).setUint16(0, name.length);
  out.set(name, 2);
  out.set(p.data, 2 + name.length);
  return out;
}

function decodeFile(plain: Uint8Array): Payload {
  if (plain.length < 2) throw new Error('Damaged file data');
  const n = new DataView(plain.buffer, plain.byteOffset).getUint16(0);
  if (2 + n > plain.length) throw new Error('Damaged file data');
  const name = safeFileName(new TextDecoder('utf-8').decode(plain.subarray(2, 2 + n)));
  return { kind: 'file', name, data: plain.slice(2 + n) };
}

/** A decrypted payload plus the optional settings the sender stored with it. */
export type Opened = Payload & {
  anim?: number; // reveal animation (1-based id)
  expires?: number; // Unix seconds after which the reveal step refuses to show it
  readSecs?: number; // how long the revealed secret stays on screen (NEVER_CLEAR = until cleared by hand)
};

/** The stored reading time that means "do not clear automatically". */
export const NEVER_CLEAR = 0xffff;

/** Thrown after a correct passphrase when the sender's expiry time has passed. */
export class ExpiredError extends Error {
  constructor(public readonly expires: number) {
    super(`This secret expired on ${new Date(expires * 1000).toLocaleString()} and can no longer be revealed.`);
  }
}

/**
 * Encrypts a text or file payload with `passphrase` and returns a framed packet.
 * `anim` (1..255) is the sender's chosen reveal animation and `expiresAt` (Unix seconds, 0 = never) the time
 * after which the reveal step refuses to show it. Both are stored inside the encryption.
 * A non-empty `passcode` adds a second way in: the image key is stored in the image, locked by the pass code.
 */
export async function sealPayload(
  payload: Payload,
  passphrase: string,
  mode: number,
  kdf: KdfSpec = defaultKdf(),
  anim = 0,
  expiresAt = 0,
  passcode = '',
  readSecs = 0,
): Promise<Uint8Array> {
  let data = encodePayload(payload);
  const hasAnim = anim > 0 && anim < 256;
  const hasExpiry = expiresAt > 0 && expiresAt < 2 ** 32;
  const hasRead = readSecs > 0 && readSecs <= NEVER_CLEAR;
  const metaLen = (hasAnim ? 1 : 0) + (hasExpiry ? 4 : 0) + (hasRead ? 2 : 0);
  if (metaLen) {
    const tagged = new Uint8Array(metaLen + data.length);
    let o = 0;
    if (hasAnim) tagged[o++] = anim;
    if (hasExpiry) {
      new DataView(tagged.buffer).setUint32(o, Math.floor(expiresAt));
      o += 4;
    }
    if (hasRead) {
      new DataView(tagged.buffer).setUint16(o, Math.floor(readSecs));
      o += 2;
    }
    tagged.set(data, o);
    data = tagged;
  }
  let compressed = false;
  const z = await deflate(data);
  if (z.length < data.length) {
    data = z;
    compressed = true;
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  let slot: Uint8Array | undefined;
  let key: CryptoKey;
  if (passcode) {
    // The image key (made from the passphrase) is also stored in the image, locked by a key made from the pass code.
    if (kdf.type !== 'argon2id') throw new Error('A pass code needs the Argon2id key derivation');
    const raw = await argon2Bytes(passphrase, salt, kdf.memLog2, kdf.iterations);
    key = await aesKey(raw, ['encrypt', 'decrypt']);
    const saltB = crypto.getRandomValues(new Uint8Array(16));
    const ivB = crypto.getRandomValues(new Uint8Array(12));
    const keyB = await deriveKey(passcode, saltB, kdf);
    const wrapped = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: bs(ivB), additionalData: bs(salt) }, keyB, bs(raw)));
    slot = new Uint8Array(saltB.length + ivB.length + wrapped.length);
    slot.set(saltB, 0);
    slot.set(ivB, 16);
    slot.set(wrapped, 28);
  } else {
    key = await deriveKey(passphrase, salt, kdf);
  }
  const header = buildHeader(mode, compressed, salt, iv, data.length + TAG_LEN, payload.kind === 'file', kdf, hasAnim, hasExpiry, slot, hasRead);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: bs(iv), additionalData: bs(header) }, key, bs(data)));
  return finishPacket(header, ct);
}

export const sealText = (text: string, passphrase: string, mode: number, kdf?: KdfSpec) => sealPayload({ kind: 'text', text }, passphrase, mode, kdf);

/** Verifies and decrypts a framed packet. Throws WrongPassphraseError on auth failure. */
export async function openPayload(buf: Uint8Array, passphrase: string, now = Date.now()): Promise<Opened> {
  const p = parsePacket(buf);
  const decryptWith = async (k: CryptoKey) =>
    new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: bs(p.iv), additionalData: bs(p.header) }, k, bs(p.ciphertext)));
  let plain: Uint8Array;
  const key = await deriveKey(passphrase, p.salt, p.kdf);
  try {
    plain = await decryptWith(key);
  } catch {
    if (!p.slot) throw new WrongPassphraseError();
    // Not the passphrase: perhaps it is the pass code, which unlocks the image key stored in the slot.
    const keyB = await deriveKey(passphrase, p.slot.subarray(0, 16), p.kdf);
    try {
      const raw = new Uint8Array(
        await subtle.decrypt({ name: 'AES-GCM', iv: bs(p.slot.subarray(16, 28)), additionalData: bs(p.salt) }, keyB, bs(p.slot.subarray(28))),
      );
      plain = await decryptWith(await aesKey(raw, ['decrypt']));
    } catch {
      throw new WrongPassphraseError();
    }
  }
  if (p.compressed) plain = await inflate(plain);
  let anim: number | undefined;
  let expires: number | undefined;
  let readSecs: number | undefined;
  if (p.hasAnim) {
    if (plain.length < 1) throw new Error('Damaged data');
    anim = plain[0];
    plain = plain.subarray(1);
  }
  if (p.hasExpiry) {
    if (plain.length < 4) throw new Error('Damaged data');
    expires = new DataView(plain.buffer, plain.byteOffset).getUint32(0);
    plain = plain.subarray(4);
    // Only reached with the right passphrase, so a wrong guess never learns whether the secret has expired.
    if (now >= expires * 1000) throw new ExpiredError(expires);
  }
  if (p.hasRead) {
    if (plain.length < 2) throw new Error('Damaged data');
    readSecs = new DataView(plain.buffer, plain.byteOffset).getUint16(0);
    plain = plain.subarray(2);
  }
  const tag = {
    ...(anim === undefined ? {} : { anim }),
    ...(expires === undefined ? {} : { expires }),
    ...(readSecs === undefined ? {} : { readSecs }),
  };
  if (p.isFile) return { ...decodeFile(plain), ...tag };
  return { kind: 'text', text: new TextDecoder('utf-8', { fatal: true }).decode(plain), ...tag };
}

/** Text-only convenience wrapper. */
export async function openPacket(buf: Uint8Array, passphrase: string): Promise<string> {
  const p = await openPayload(buf, passphrase);
  if (p.kind !== 'text') throw new Error('This packet holds a file, not text');
  return p.text;
}
