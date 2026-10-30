// Mode B: hide the packet in the least-significant bits of a cover photo.
// Bit positions follow a passphrase-keyed permutation of every RGB channel slot.
// Only survives lossless formats (PNG): any recompression destroys it.
import type { Rgba } from './codeart';

const HEADER = 6; // 'S' 'T' + 4-byte length

export function stegoCapacity(img: Rgba): number {
  return Math.max(0, Math.floor((img.width * img.height * 3) / 8) - HEADER);
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

async function permutation(img: Rgba, passphrase: string): Promise<(k: number) => number> {
  const M = img.width * img.height * 3;
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('ST-stego|' + passphrase.normalize('NFKC'))));
  const dv = new DataView(h.buffer);
  let a = (dv.getUint32(0) % M) | 1;
  while (gcd(a, M) !== 1) a = (a + 2) % M || 1;
  const b = dv.getUint32(4) % M;
  // a, k < M <= 2^26, so a * k stays below 2^53.
  return (k) => (a * k + b) % M;
}

const slotOffset = (idx: number) => Math.floor(idx / 3) * 4 + (idx % 3);

export async function embed(cover: Rgba, packet: Uint8Array, passphrase: string): Promise<Rgba> {
  if (packet.length > stegoCapacity(cover)) throw new Error('Cover image is too small for this message');
  const out: Rgba = { width: cover.width, height: cover.height, data: new Uint8ClampedArray(cover.data) };
  for (let i = 3; i < out.data.length; i += 4) out.data[i] = 255;
  const perm = await permutation(out, passphrase);
  const payload = new Uint8Array(HEADER + packet.length);
  payload[0] = 0x53;
  payload[1] = 0x54;
  new DataView(payload.buffer).setUint32(2, packet.length);
  payload.set(packet, HEADER);
  let k = 0;
  for (const byte of payload)
    for (let bit = 7; bit >= 0; bit--, k++) {
      const o = slotOffset(perm(k));
      out.data[o] = (out.data[o] & 0xfe) | ((byte >> bit) & 1);
    }
  return out;
}

export async function extract(img: Rgba, passphrase: string): Promise<Uint8Array> {
  const perm = await permutation(img, passphrase);
  let k = 0;
  const readBytes = (n: number): Uint8Array => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      let v = 0;
      for (let bit = 0; bit < 8; bit++, k++) v = (v << 1) | (img.data[slotOffset(perm(k))] & 1);
      out[i] = v;
    }
    return out;
  };
  const head = readBytes(HEADER);
  const len = new DataView(head.buffer).getUint32(2);
  if (head[0] !== 0x53 || head[1] !== 0x54 || len > stegoCapacity(img)) throw new Error('No hidden data found');
  return readBytes(len);
}
