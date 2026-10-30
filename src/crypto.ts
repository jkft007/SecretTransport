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

export type Payload = { kind: 'text'; text: string } | { kind: 'file'; name: string; data: Uint8Array };

/** Strips paths and characters that are unsafe in file names; never returns an empty name. */
export function safeFileName(raw: string): string {
  let n = raw.split(/[\\/]/).pop() ?? '';
  n = n.replace(/[\u0000-\u001f\u007f<>:\"|?*]/g, '_').replace(/^[. ]+|[. ]+$/g, '');
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

/** Encrypts a text or file payload with `passphrase` and returns a framed packet. */
export async function sealPayload(payload: Payload, passphrase: string, mode: number): Promise<Uint8Array> {
  let data = encodePayload(payload);
  let compressed = false;
  const z = await deflate(data);
  if (z.length < data.length) {
    data = z;
    compressed = true;
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const header = buildHeader(mode, compressed, salt, iv, data.length + TAG_LEN, payload.kind === 'file');
  const key = await deriveKey(passphrase, salt);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: bs(iv), additionalData: bs(header) }, key, bs(data)));
  return finishPacket(header, ct);
}

export const sealText = (text: string, passphrase: string, mode: number) => sealPayload({ kind: 'text', text }, passphrase, mode);

/** Verifies and decrypts a framed packet. Throws WrongPassphraseError on auth failure. */
export async function openPayload(buf: Uint8Array, passphrase: string): Promise<Payload> {
  const p = parsePacket(buf);
  const key = await deriveKey(passphrase, p.salt);
  let plain: Uint8Array;
  try {
    plain = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: bs(p.iv), additionalData: bs(p.header) }, key, bs(p.ciphertext)));
  } catch {
    throw new WrongPassphraseError();
  }
  if (p.compressed) plain = await inflate(plain);
  if (p.isFile) return decodeFile(plain);
  return { kind: 'text', text: new TextDecoder('utf-8', { fatal: true }).decode(plain) };
}

/** Text-only convenience wrapper. */
export async function openPacket(buf: Uint8Array, passphrase: string): Promise<string> {
  const p = await openPayload(buf, passphrase);
  if (p.kind !== 'text') throw new Error('This packet holds a file, not text');
  return p.text;
}
