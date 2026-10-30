// Binary framing:
// 'S' 'T' | version(1) | mode(1) | salt(16) | iv(12) | ctLen(4, BE) | ciphertext+tag | crc32(4, BE)
// mode: low nibble = image mode, 0x10 = payload was deflated before encryption.

export const MODE_CODEART = 1;
export const MODE_STEGO = 2;
export const MODE_DCT = 3;
export const MODE_QR = 4;
export const MODE_FAKEQR = 5;
export const FLAG_COMPRESSED = 0x10;
export const VERSION = 1;
export const HEADER_LEN = 36;
export const TAG_LEN = 16;

export class PacketError extends Error {}

export interface Packet {
  mode: number;
  compressed: boolean;
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

export function buildHeader(mode: number, compressed: boolean, salt: Uint8Array, iv: Uint8Array, ctLen: number): Uint8Array {
  const h = new Uint8Array(HEADER_LEN);
  h[0] = 0x53;
  h[1] = 0x54;
  h[2] = VERSION;
  h[3] = mode | (compressed ? FLAG_COMPRESSED : 0);
  h.set(salt, 4);
  h.set(iv, 20);
  new DataView(h.buffer).setUint32(32, ctLen);
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
  if (buf[2] !== VERSION) throw new PacketError('unsupported version');
  const ctLen = new DataView(buf.buffer, buf.byteOffset).getUint32(32);
  if (HEADER_LEN + ctLen + 4 > buf.length || ctLen < TAG_LEN) throw new PacketError('truncated packet');
  const end = HEADER_LEN + ctLen;
  const crc = new DataView(buf.buffer, buf.byteOffset).getUint32(end);
  if (crc32(buf.subarray(0, end)) !== crc) throw new PacketError('checksum mismatch');
  return {
    mode: buf[3] & 0x0f,
    compressed: (buf[3] & FLAG_COMPRESSED) !== 0,
    salt: buf.slice(4, 20),
    iv: buf.slice(20, 32),
    header: buf.slice(0, HEADER_LEN),
    ciphertext: buf.slice(HEADER_LEN, end),
  };
}

/** Total packet size for a given ciphertext length (used for capacity estimates). */
export const packetSize = (ctLen: number): number => HEADER_LEN + ctLen + 4;
