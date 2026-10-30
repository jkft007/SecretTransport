// JPEG-robust photo hiding: bits live in mid-frequency DCT coefficients of the brightness
// channel (the same 8x8 blocks JPEG uses), stored by quantization-index modulation with a
// step much larger than JPEG's own quantizer. Each bit is repeated across many scattered
// coefficients, soft-decoded, and the payload is Reed-Solomon protected.
// Survives recompression (roughly quality 50+). Does not survive crops, rotation or resizing.
import { decodeBuffer, encodeBuffer, encodedLength } from './ecc';
import type { Rgba } from './codeart';
import { layoutKey, legacyLayoutKey } from './kdf';

const COEFS: [number, number][] = [[1, 2], [2, 1], [2, 2], [0, 3], [3, 0], [1, 3]];
const STEP = 44;
const HEADER_BITS = 16;
const HEADER_REPS = 15;
const HEADER_SLOTS = HEADER_BITS * HEADER_REPS;
const MAX_REPS = 25;
const MIN_REPS = 3;

const COS: number[][] = Array.from({ length: 8 }, (_, u) =>
  Array.from({ length: 8 }, (_, x) => (u === 0 ? Math.sqrt(1 / 8) : Math.sqrt(2 / 8)) * Math.cos(((2 * x + 1) * u * Math.PI) / 16)),
);

export const MAX_COVER_SIDE = 1280;

/** Crops to a multiple of 8 so the JPEG block grid stays aligned. */
export function cropTo8(img: Rgba): Rgba {
  const w = img.width & ~7;
  const h = img.height & ~7;
  if (w === img.width && h === img.height) return img;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) data.set(img.data.subarray(y * img.width * 4, (y * img.width + w) * 4), y * w * 4);
  return { width: w, height: h, data };
}

const slotCount = (img: Rgba) => (img.width >> 3) * (img.height >> 3) * COEFS.length;

function repsFor(slots: number, payloadBits: number): number {
  return Math.min(MAX_REPS, Math.floor((slots - HEADER_SLOTS) / payloadBits));
}

/** Largest packet (bytes) that fits with at least MIN_REPS copies per bit. */
export function dctCapacity(img: Rgba): number {
  let lo = 0;
  let hi = 60000;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (repsFor(slotCount(img), encodedLength(mid) * 8) >= MIN_REPS) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

async function slotPermutation(S: number, passphrase: string, legacy: boolean): Promise<(k: number) => number> {
  const h = legacy ? await legacyLayoutKey('ST-dct', passphrase) : await layoutKey(passphrase, 'dct');
  const dv = new DataView(h.buffer);
  let a = (dv.getUint32(0) % S) | 1;
  while (gcd(a, S) !== 1) a = (a + 2) % S || 1;
  const b = dv.getUint32(4) % S;
  return (k) => (a * k + b) % S;
}

/** Slot indices for header bit i, copy r; payload bit j, copy r. */
function slotOf(perm: (k: number) => number, kind: 'h' | 'p', bit: number, rep: number, reps: number): number {
  return perm(kind === 'h' ? bit * HEADER_REPS + rep : HEADER_SLOTS + bit * reps + rep);
}

const luma = (d: Uint8ClampedArray, o: number) => 0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2];

function slotGeometry(img: Rgba, slot: number) {
  const block = Math.floor(slot / COEFS.length);
  const bw = img.width >> 3;
  return { bx: (block % bw) * 8, by: Math.floor(block / bw) * 8, coef: slot % COEFS.length, block };
}

function coefficient(img: Rgba, bx: number, by: number, u: number, v: number): number {
  let s = 0;
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) s += luma(img.data, ((by + y) * img.width + bx + x) * 4) * COS[u][y] * COS[v][x];
  return s;
}

export async function embedDct(cover: Rgba, packet: Uint8Array, passphrase: string, legacy = false): Promise<Rgba> {
  const img = cropTo8(cover);
  const S = slotCount(img);
  const enc = encodeBuffer(packet);
  const reps = repsFor(S, enc.length * 8);
  if (reps < MIN_REPS) throw new Error('Cover photo is too small for this message. Use a larger photo or less text.');
  const perm = await slotPermutation(S, passphrase, legacy);

  const want = new Int8Array(S).fill(-1);
  for (let i = 0; i < HEADER_BITS; i++)
    for (let r = 0; r < HEADER_REPS; r++) want[slotOf(perm, 'h', i, r, reps)] = (packet.length >> (HEADER_BITS - 1 - i)) & 1;
  for (let j = 0; j < enc.length * 8; j++) {
    const bit = (enc[j >> 3] >> (7 - (j & 7))) & 1;
    for (let r = 0; r < reps; r++) want[slotOf(perm, 'p', j, r, reps)] = bit;
  }

  const out: Rgba = { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
  for (let i = 3; i < out.data.length; i += 4) out.data[i] = 255;
  const nBlocks = S / COEFS.length;
  const delta = new Float64Array(64);
  for (let block = 0; block < nBlocks; block++) {
    let touched = false;
    delta.fill(0);
    const { bx, by } = slotGeometry(img, block * COEFS.length);
    for (let c = 0; c < COEFS.length; c++) {
      const b = want[block * COEFS.length + c];
      if (b < 0) continue;
      touched = true;
      const [u, v] = COEFS[c];
      const cur = coefficient(img, bx, by, u, v);
      const target = (Math.round(cur / STEP - b / 2) + b / 2) * STEP;
      const diff = target - cur;
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) delta[y * 8 + x] += diff * COS[u][y] * COS[v][x];
    }
    if (!touched) continue;
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) {
        const o = ((by + y) * img.width + bx + x) * 4;
        const d = delta[y * 8 + x];
        out.data[o] = Math.round(out.data[o] + d);
        out.data[o + 1] = Math.round(out.data[o + 1] + d);
        out.data[o + 2] = Math.round(out.data[o + 2] + d);
      }
  }
  return out;
}

export async function extractDct(img: Rgba, passphrase: string, legacy = false): Promise<Uint8Array> {
  const S = slotCount(img);
  if (S < HEADER_SLOTS + 8) throw new Error('No hidden data');
  const perm = await slotPermutation(S, passphrase, legacy);
  const cache = new Map<number, number>();
  // Positive soft value => bit 0, negative => bit 1.
  const soft = (slot: number): number => {
    let v = cache.get(slot);
    if (v === undefined) {
      const { bx, by, coef } = slotGeometry(img, slot);
      const [u, w] = COEFS[coef];
      const c = coefficient(img, bx, by, u, w);
      const d0 = Math.abs(c - Math.round(c / STEP) * STEP);
      const d1 = Math.abs(c - (Math.round(c / STEP - 0.5) + 0.5) * STEP);
      v = d1 - d0;
      cache.set(slot, v);
    }
    return v;
  };

  let len = 0;
  for (let i = 0; i < HEADER_BITS; i++) {
    let sum = 0;
    for (let r = 0; r < HEADER_REPS; r++) sum += soft(slotOf(perm, 'h', i, r, 0));
    len = (len << 1) | (sum > 0 ? 0 : 1);
  }
  const bits = encodedLength(len) * 8;
  if (len < 1) throw new Error('No hidden data');
  const reps = repsFor(S, bits);
  if (reps < MIN_REPS) throw new Error('No hidden data');
  const enc = new Uint8Array(bits / 8);
  for (let j = 0; j < bits; j++) {
    let sum = 0;
    for (let r = 0; r < reps; r++) sum += soft(slotOf(perm, 'p', j, r, reps));
    if (sum <= 0) enc[j >> 3] |= 1 << (7 - (j & 7));
  }
  return decodeBuffer(enc, len);
}
