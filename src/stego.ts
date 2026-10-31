// Mode B: hide the packet in the least-significant bits of a cover photo.
// Bit positions follow a passphrase-keyed permutation of every RGB channel slot.
// Only survives lossless formats (PNG): any recompression destroys it.
import type { Rgba } from './codeart';
import { layoutKey, legacyLayoutKey } from './kdf';
import { laneOf, msgLaneSize, type Lane, type Layout, type Role } from './lanes';

const HEADER = 6; // 'S' 'T' + 4-byte length
const SINGLE: Layout = { nMsg: 1, nLoc: 0 };

/** Slots reserved for each pass-code locator record (see photo.ts). */
export const LOC_LSB = 2048;

const slotTotal = (img: Rgba) => img.width * img.height * 3;

/** Largest record (bytes) one message lane can carry. */
export function stegoCapacity(img: Rgba, layout: Layout = SINGLE): number {
  return Math.max(0, Math.floor(msgLaneSize(slotTotal(img), layout, LOC_LSB) / 8) - HEADER);
}

/** Whether a locator lane can carry a record of this many bytes. */
export const stegoLocatorFits = (bytes: number) => (bytes + HEADER) * 8 <= LOC_LSB;

// legacy: images made before the memory-hard layout key; they can be read, never created (except by tests)
async function laneFor(img: Rgba, key: string, layout: Layout, role: Role, index: number, legacy: boolean): Promise<Lane> {
  const h = legacy ? await legacyLayoutKey('ST-stego', key) : await layoutKey(key, role === 'msg' ? 'stego' : 'stego-loc');
  return laneOf(slotTotal(img), layout, LOC_LSB, role, index, h);
}

const slotOffset = (idx: number) => Math.floor(idx / 3) * 4 + (idx % 3);

export type StegoEntry = { role: Role; index: number; key: string; data: Uint8Array };

export async function embed(cover: Rgba, packet: Uint8Array, passphrase: string, legacy = false): Promise<Rgba> {
  return embedEntries(cover, [{ role: 'msg', index: 0, key: passphrase, data: packet }], SINGLE, legacy);
}

/** Hides every entry in its own lane of one photo. */
export async function embedEntries(cover: Rgba, entries: StegoEntry[], layout: Layout, legacy = false): Promise<Rgba> {
  const out: Rgba = { width: cover.width, height: cover.height, data: new Uint8ClampedArray(cover.data) };
  for (let i = 3; i < out.data.length; i += 4) out.data[i] = 255;
  for (const e of entries) {
    const lane = await laneFor(out, e.key, layout, e.role, e.index, legacy);
    if ((HEADER + e.data.length) * 8 > lane.size) throw new Error('Cover image is too small for this message');
    const payload = new Uint8Array(HEADER + e.data.length);
    payload[0] = 0x53;
    payload[1] = 0x54;
    new DataView(payload.buffer).setUint32(2, e.data.length);
    payload.set(e.data, HEADER);
    let k = 0;
    for (const byte of payload)
      for (let bit = 7; bit >= 0; bit--, k++) {
        const o = slotOffset(lane.at(k));
        out.data[o] = (out.data[o] & 0xfe) | ((byte >> bit) & 1);
      }
  }
  return out;
}

export async function extract(img: Rgba, passphrase: string, legacy = false): Promise<Uint8Array> {
  return extractLane(img, passphrase, SINGLE, 'msg', 0, legacy);
}

/** Reads the record in one lane, or throws when the key finds nothing there. */
export async function extractLane(img: Rgba, key: string, layout: Layout, role: Role, index: number, legacy = false): Promise<Uint8Array> {
  const lane = await laneFor(img, key, layout, role, index, legacy);
  if (lane.size < HEADER * 8) throw new Error('No hidden data found');
  let k = 0;
  const readBytes = (n: number): Uint8Array => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      let v = 0;
      for (let bit = 0; bit < 8; bit++, k++) v = (v << 1) | (img.data[slotOffset(lane.at(k))] & 1);
      out[i] = v;
    }
    return out;
  };
  const head = readBytes(HEADER);
  const len = new DataView(head.buffer).getUint32(2);
  if (head[0] !== 0x53 || head[1] !== 0x54 || (HEADER + len) * 8 > lane.size) throw new Error('No hidden data found');
  return readBytes(len);
}
