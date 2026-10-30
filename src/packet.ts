// Binary framing, version 2 (current):
// 'S' 'T' | 2 | mode(1) | kdf(1) | memLog2(1) | iterations(1) | salt(16) | iv(12) | ctLen(4, BE) | ciphertext+tag | crc32(4, BE)
// Version 1 (older images, PBKDF2 with 600,000 rounds):
// 'S' 'T' | 1 | mode(1) | salt(16) | iv(12) | ctLen(4, BE) | ciphertext+tag | crc32(4, BE)
// mode: low nibble = image mode, 0x10 = payload was deflated before encryption, 0x20 = payload is a file.
// The whole header is authenticated by AES-GCM, so the stored key-derivation settings cannot be altered.
import type { KdfSpec } from './kdf';

export const MODE_CODEART = 1;
export const MODE_STEGO = 2;
export const MODE_DCT = 3;
export const MODE_QR = 4;
export const MODE_FAKEQR = 5;
export const FLAG_COMPRESSED = 0x10;
export const FLAG_FILE = 0x20;
export const VERSION = 1; // also the version of the split-part frame
export const VERSION_ARGON = 2;
export const HEADER_LEN = 36; // version 1
export const HEADER_LEN_V2 = 39;
export const TAG_LEN = 16;
const KDF_ARGON2ID = 1;

export class PacketError extends Error {}

export interface Packet {
  mode: number;
  compressed: boolean;
  isFile: boolean;
  kdf: KdfSpec;
  salt: Uint8Array;
  iv: Uint8Array;
  header: Uint8Array; // authenticated as AES-GCM additional data
  ciphertext: Uint8Array;
}

let crcTable: Uint32Array | undefined;
export function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const b of data) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function buildHeader(
  mode: number,
  compressed: boolean,
  salt: Uint8Array,
  iv: Uint8Array,
  ctLen: number,
  isFile = false,
  kdf: KdfSpec = { type: 'pbkdf2' },
): Uint8Array {
  const flags = mode | (compressed ? FLAG_COMPRESSED : 0) | (isFile ? FLAG_FILE : 0);
  const argon = kdf.type === 'argon2id';
  const h = new Uint8Array(argon ? HEADER_LEN_V2 : HEADER_LEN);
  h[0] = 0x53;
  h[1] = 0x54;
  h[2] = argon ? VERSION_ARGON : VERSION;
  h[3] = flags;
  let o = 4;
  if (kdf.type === 'argon2id') {
    h[4] = KDF_ARGON2ID;
    h[5] = kdf.memLog2;
    h[6] = kdf.iterations;
    o = 7;
  }
  h.set(salt, o);
  h.set(iv, o + 16);
  new DataView(h.buffer).setUint32(o + 28, ctLen);
  return h;
}

export function finishPacket(header: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  const out = new Uint8Array(header.length + ciphertext.length + 4);
  out.set(header);
  out.set(ciphertext, header.length);
  new DataView(out.buffer).setUint32(out.length - 4, crc32(out.subarray(0, out.length - 4)));
  return out;
}

export function parsePacket(buf: Uint8Array): Packet {
  if (buf.length < HEADER_LEN + TAG_LEN + 4 || buf[0] !== 0x53 || buf[1] !== 0x54) throw new PacketError('not a SecretTransport image');
  const v = buf[2];
  if (v !== VERSION && v !== VERSION_ARGON) throw new PacketError('unsupported version');
  let kdf: KdfSpec = { type: 'pbkdf2' };
  let o = 4; // start of the salt
  if (v === VERSION_ARGON) {
    if (buf.length < HEADER_LEN_V2 + TAG_LEN + 4 || buf[4] !== KDF_ARGON2ID) throw new PacketError('unsupported key derivation');
    kdf = { type: 'argon2id', memLog2: buf[5], iterations: buf[6] };
    o = 7;
  }
  const headerLen = o + 32;
  const dv = new DataView(buf.buffer, buf.byteOffset);
  const ctLen = dv.getUint32(o + 28);
  if (headerLen + ctLen + 4 > buf.length || ctLen < TAG_LEN) throw new PacketError('truncated packet');
  const end = headerLen + ctLen;
  if (crc32(buf.subarray(0, end)) !== dv.getUint32(end)) throw new PacketError('checksum mismatch');
  return {
    mode: buf[3] & 0x0f,
    compressed: (buf[3] & FLAG_COMPRESSED) !== 0,
    isFile: (buf[3] & FLAG_FILE) !== 0,
    kdf,
    salt: buf.slice(o, o + 16),
    iv: buf.slice(o + 16, o + 28),
    header: buf.slice(0, headerLen),
    ciphertext: buf.slice(headerLen, end),
  };
}

/** Total packet size for a given ciphertext length (used for capacity estimates). */
export const packetSize = (ctLen: number): number => HEADER_LEN + ctLen + 4;

// ---- split parts -------------------------------------------------------------
// 'S' 'P' | version(1) | setId(6) | index(1) | total(1) | chunk | crc32(4, BE)
// A large packet is cut into numbered chunks; each chunk travels in its own image.

export const PART_OVERHEAD = 15;
export const MAX_PARTS = 60;

export interface Part {
  setId: string; // hex
  index: number; // 0-based
  total: number;
  chunk: Uint8Array;
}

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, '0')).join('');

export function buildPart(setId: Uint8Array, index: number, total: number, chunk: Uint8Array): Uint8Array {
  const out = new Uint8Array(PART_OVERHEAD + chunk.length);
  out[0] = 0x53;
  out[1] = 0x50;
  out[2] = VERSION;
  out.set(setId, 3);
  out[9] = index;
  out[10] = total;
  out.set(chunk, 11);
  new DataView(out.buffer).setUint32(out.length - 4, crc32(out.subarray(0, out.length - 4)));
  return out;
}

export function parsePart(buf: Uint8Array): Part {
  if (buf.length < PART_OVERHEAD + 1 || buf[0] !== 0x53 || buf[1] !== 0x50) throw new PacketError('not a split part');
  if (buf[2] !== VERSION) throw new PacketError('unsupported version');
  const crc = new DataView(buf.buffer, buf.byteOffset).getUint32(buf.length - 4);
  if (crc32(buf.subarray(0, buf.length - 4)) !== crc) throw new PacketError('checksum mismatch');
  const index = buf[9];
  const total = buf[10];
  if (total < 2 || total > MAX_PARTS || index >= total) throw new PacketError('bad part numbering');
  return { setId: hex(buf.subarray(3, 9)), index, total, chunk: buf.slice(11, buf.length - 4) };
}

/** Accepts either a whole packet or one part; throws if it is neither. */
export function parseFrame(buf: Uint8Array): { kind: 'packet' } | { kind: 'part'; part: Part } {
  if (buf.length > 1 && buf[1] === 0x50) return { kind: 'part', part: parsePart(buf) };
  parsePacket(buf);
  return { kind: 'packet' };
}
