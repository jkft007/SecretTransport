// Minimal QR Code encoder (byte mode, versions 1-40, levels L/M/Q/H) that exposes the final
// codewords, which fake-QR mode needs. Layout follows ISO/IEC 18004.
import { rsEncode } from './ecc';

export type Ecl = 'L' | 'M' | 'Q' | 'H';
const ECL_INDEX: Record<Ecl, number> = { L: 0, M: 1, Q: 2, H: 3 };
const FORMAT_BITS: Record<Ecl, number> = { L: 1, M: 0, Q: 3, H: 2 };

// Index 0 is unused padding.
const ECC_PER_BLOCK = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];
const NUM_BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

export interface QrLayout {
  version: number;
  ecl: Ecl;
  size: number;
  total: number; // total codewords
  nb: number; // number of RS blocks
  eccLen: number; // EC codewords per block
  dataCw: number;
  shortLen: number;
  numShort: number;
}

export interface QrSymbol {
  version: number;
  ecl: Ecl;
  mask: number;
  size: number;
  modules: boolean[][];
  codewords: Uint8Array; // final interleaved codewords (data + EC)
}

function rawModules(ver: number): number {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const na = Math.floor(ver / 7) + 2;
    r -= (25 * na - 10) * na - 55;
    if (ver >= 7) r -= 36;
  }
  return r;
}

export function layout(version: number, ecl: Ecl): QrLayout {
  const i = ECL_INDEX[ecl];
  const total = Math.floor(rawModules(version) / 8);
  const nb = NUM_BLOCKS[i][version];
  const eccLen = ECC_PER_BLOCK[i][version];
  return { version, ecl, size: version * 4 + 17, total, nb, eccLen, dataCw: total - eccLen * nb, shortLen: Math.floor(total / nb), numShort: nb - (total % nb) };
}

/** Bytes of payload that fit in byte mode. */
export function byteCapacity(version: number, ecl: Ecl): number {
  const l = layout(version, ecl);
  return Math.floor((l.dataCw * 8 - 4 - (version <= 9 ? 8 : 16)) / 8);
}

/** For each interleaved codeword index, which RS block it belongs to. */
export function blockMap(l: QrLayout): Int16Array {
  const out = new Int16Array(l.total);
  let k = 0;
  for (let i = 0; i < l.shortLen + 1; i++)
    for (let j = 0; j < l.nb; j++) if (i !== l.shortLen - l.eccLen || j >= l.numShort) out[k++] = j;
  return out;
}

function dataCodewords(bytes: Uint8Array, l: QrLayout): Uint8Array {
  const bits: number[] = [];
  const push = (v: number, n: number) => {
    for (let i = n - 1; i >= 0; i--) bits.push((v >> i) & 1);
  };
  push(4, 4);
  push(bytes.length, l.version <= 9 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  const cap = l.dataCw * 8;
  if (bits.length > cap) throw new Error('Data too long for this QR version');
  push(0, Math.min(4, cap - bits.length));
  while (bits.length % 8) bits.push(0);
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) push(pad, 8);
  const out = new Uint8Array(l.dataCw);
  bits.forEach((b, i) => (out[i >> 3] |= b << (7 - (i & 7))));
  return out;
}

function addEccAndInterleave(data: Uint8Array, l: QrLayout): Uint8Array {
  const blocks: number[][] = [];
  let k = 0;
  for (let i = 0; i < l.nb; i++) {
    const len = l.shortLen - l.eccLen + (i < l.numShort ? 0 : 1);
    const dat = data.subarray(k, k + len);
    k += len;
    const block = Array.from(dat);
    if (i < l.numShort) block.push(0);
    blocks.push(block.concat(Array.from(rsEncode(dat, l.eccLen))));
  }
  const out: number[] = [];
  for (let i = 0; i < blocks[0].length; i++)
    for (let j = 0; j < l.nb; j++) if (i !== l.shortLen - l.eccLen || j >= l.numShort) out.push(blocks[j][i]);
  return Uint8Array.from(out);
}

// ---- matrix construction ----------------------------------------------------

function alignmentPositions(ver: number): number[] {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2;
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
  const out = [6];
  for (let pos = ver * 4 + 10; out.length < n; pos -= step) out.splice(1, 0, pos);
  return out;
}

function drawFormat(m: boolean[][], fn: boolean[][], size: number, ecl: Ecl, mask: number) {
  const data = (FORMAT_BITS[ecl] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const set = (x: number, y: number, v: boolean) => {
    m[y][x] = v;
    fn[y][x] = true;
  };
  const bit = (i: number) => ((bits >>> i) & 1) !== 0;
  for (let i = 0; i <= 5; i++) set(8, i, bit(i));
  set(8, 7, bit(6));
  set(8, 8, bit(7));
  set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
  set(8, size - 8, true);
}

function functionPatterns(ver: number) {
  const size = ver * 4 + 17;
  const m = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (x: number, y: number, v: boolean) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    m[y][x] = v;
    fn[y][x] = true;
  };
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]])
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(cx + dx, cy + dy, d !== 2 && d !== 4);
      }
  const ap = alignmentPositions(ver);
  const last = ap.length - 1;
  ap.forEach((ax, i) =>
    ap.forEach((ay, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }),
  );
  drawFormat(m, fn, size, 'L', 0); // reserve the format areas
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const v = ((bits >>> i) & 1) !== 0;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, v);
      set(b, a, v);
    }
  }
  return { size, m, fn };
}

/** Zigzag order of the data modules (x, y). */
function dataPositions(fn: boolean[][], size: number): [number, number][] {
  const out: [number, number][] = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
        if (!fn[y][x]) out.push([x, y]);
      }
  }
  return out;
}

const maskBit = (mask: number, x: number, y: number): boolean => {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
};

function applyMask(m: boolean[][], fn: boolean[][], size: number, mask: number) {
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && maskBit(mask, x, y)) m[y][x] = !m[y][x];
}

function penalty(m: boolean[][], size: number): number {
  let score = 0;
  const finderLike = (get: (i: number) => boolean) => {
    for (let i = 0; i + 11 <= size; i++) {
      const a = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
      const b = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
      let ma = true;
      let mb = true;
      for (let k = 0; k < 11 && (ma || mb); k++) {
        const v = get(i + k) ? 1 : 0;
        if (v !== a[k]) ma = false;
        if (v !== b[k]) mb = false;
      }
      if (ma || mb) score += 40;
    }
  };
  for (let i = 0; i < size; i++) {
    for (const row of [true, false]) {
      const get = (j: number) => (row ? m[i][j] : m[j][i]);
      let run = 1;
      for (let j = 1; j < size; j++) {
        if (get(j) === get(j - 1)) run++;
        else {
          if (run >= 5) score += run - 2;
          run = 1;
        }
      }
      if (run >= 5) score += run - 2;
      finderLike(get);
    }
  }
  let dark = 0;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      if (m[y][x]) dark++;
      if (x + 1 < size && y + 1 < size && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) score += 3;
    }
  const total = size * size;
  score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return score;
}

/** Builds the symbol for arbitrary final codewords. Picks the best mask unless one is given. */
export function buildSymbol(version: number, ecl: Ecl, codewords: Uint8Array, mask?: number): QrSymbol {
  const { size, m, fn } = functionPatterns(version);
  const pos = dataPositions(fn, size);
  for (let i = 0; i < codewords.length * 8; i++) {
    const [x, y] = pos[i];
    m[y][x] = ((codewords[i >> 3] >>> (7 - (i & 7))) & 1) !== 0;
  }
  const finish = (mk: number) => {
    const c = m.map((r) => r.slice());
    applyMask(c, fn, size, mk);
    drawFormat(c, fn, size, ecl, mk);
    return c;
  };
  let best = mask ?? 0;
  if (mask === undefined) {
    let bestScore = Infinity;
    for (let mk = 0; mk < 8; mk++) {
      const s = penalty(finish(mk), size);
      if (s < bestScore) {
        bestScore = s;
        best = mk;
      }
    }
  }
  return { version, ecl, mask: best, size, modules: finish(best), codewords };
}

export function encodeQrAt(bytes: Uint8Array, ecl: Ecl, version: number): QrSymbol {
  const l = layout(version, ecl);
  return buildSymbol(version, ecl, addEccAndInterleave(dataCodewords(bytes, l), l));
}

/** Smallest version >= minVersion that fits. */
export function encodeQr(bytes: Uint8Array, ecl: Ecl, minVersion = 1): QrSymbol {
  for (let v = minVersion; v <= 40; v++) if (byteCapacity(v, ecl) >= bytes.length) return encodeQrAt(bytes, ecl, v);
  throw new Error('Too much data for a QR code');
}

/** Reads the final codewords out of a (sampled) module matrix, given the mask that was applied. */
export function readCodewords(modules: boolean[][], version: number, mask: number): Uint8Array {
  const { size, fn } = functionPatterns(version);
  const l = layout(version, 'L');
  const pos = dataPositions(fn, size);
  const out = new Uint8Array(l.total);
  for (let i = 0; i < l.total * 8; i++) {
    const [x, y] = pos[i];
    if (modules[y][x] !== maskBit(mask, x, y)) out[i >> 3] |= 1 << (7 - (i & 7));
  }
  return out;
}
