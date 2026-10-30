import { TAG_LEN, buildHeader, finishPacket, parsePacket } from './packet';

const PBKDF2_ITERATIONS = 600_000;
const subtle = globalThis.crypto.subtle;
const bs = (u: Uint8Array) => u as unknown as BufferSource;

export class WrongPassphraseError extends Error {
  constructor() {
    super('Wrong passphrase, or the image is damaged');
  }
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
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

/** Encrypts `text` with `passphrase` and returns a framed packet. */
export async function sealText(text: string, passphrase: string, mode: number): Promise<Uint8Array> {
  let data: Uint8Array = new TextEncoder().encode(text);
  let compressed = false;
  const z = await deflate(data);
  if (z.length < data.length) {
    data = z;
    compressed = true;
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const header = buildHeader(mode, compressed, salt, iv, data.length + TAG_LEN);
  const key = await deriveKey(passphrase, salt);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: bs(iv), additionalData: bs(header) }, key, bs(data)));
  return finishPacket(header, ct);
}

/** Verifies and decrypts a framed packet. Throws WrongPassphraseError on auth failure. */
export async function openPacket(buf: Uint8Array, passphrase: string): Promise<string> {
  const p = parsePacket(buf);
  const key = await deriveKey(passphrase, p.salt);
  let plain: Uint8Array;
  try {
    plain = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: bs(p.iv), additionalData: bs(p.header) }, key, bs(p.ciphertext)));
  } catch {
    throw new WrongPassphraseError();
  }
  if (p.compressed) plain = await inflate(plain);
  return new TextDecoder('utf-8', { fatal: true }).decode(plain);
}
