// Reed-Solomon over GF(256) (poly 0x11d). Blocks are interleaved so a burst of
// damaged image cells is spread across many codewords.

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}

const mul = (a: number, b: number): number => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
const inv = (a: number): number => EXP[255 - LOG[a]];

function generator(nsym: number): number[] {
  let g = [1];
  for (let i = 0; i < nsym; i++) {
    const next = new Array<number>(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      next[j] ^= g[j];
      next[j + 1] ^= mul(g[j], EXP[i]);
    }
    g = next;
  }
  return g;
}

export function rsEncode(data: Uint8Array, nsym: number): Uint8Array {
  const gen = generator(nsym);
  const par = new Uint8Array(nsym);
  for (const d of data) {
    const f = d ^ par[0];
    par.copyWithin(0, 1);
    par[nsym - 1] = 0;
    if (f) for (let j = 0; j < nsym; j++) par[j] ^= mul(gen[j + 1], f);
  }
  return par;
}

function syndromes(cw: Uint8Array, nsym: number): Uint8Array {
  const s = new Uint8Array(nsym);
  for (let j = 0; j < nsym; j++) {
    const a = EXP[j];
    let acc = 0;
    for (const b of cw) acc = mul(acc, a) ^ b;
    s[j] = acc;
  }
  return s;
}

/** Corrects `cw` (data followed by nsym parity bytes) in place. Throws if uncorrectable. */
export function rsDecode(cw: Uint8Array, nsym: number): void {
  const n = cw.length;
  const S = syndromes(cw, nsym);
  if (S.every((v) => v === 0)) return;

  // Berlekamp-Massey: error locator C(x), lowest degree first.
  let C = [1];
  let B = [1];
  let L = 0;
  let m = 1;
  let b = 1;
  for (let i = 0; i < nsym; i++) {
    let d = S[i];
    for (let j = 1; j <= L; j++) d ^= mul(C[j] ?? 0, S[i - j]);
    if (d === 0) {
      m++;
      continue;
    }
    const coef = mul(d, inv(b));
    const T = C.slice();
    while (C.length < B.length + m) C.push(0);
    for (let j = 0; j < B.length; j++) C[j + m] ^= mul(coef, B[j]);
    if (2 * L <= i) {
      L = i + 1 - L;
      B = T;
      b = d;
      m = 1;
    } else {
      m++;
    }
  }
  if (L === 0 || 2 * L > nsym) throw new Error('uncorrectable');

  // Chien search: position p (power of x) is bad when C(alpha^-p) == 0.
  const pos: number[] = [];
  for (let p = 0; p < n; p++) {
    const x = EXP[(255 - p) % 255];
    let acc = 0;
    let xp = 1;
    for (let i = 0; i <= L; i++) {
      acc ^= mul(C[i] ?? 0, xp);
      xp = mul(xp, x);
    }
    if (acc === 0) pos.push(p);
  }
  if (pos.length !== L) throw new Error('uncorrectable');

  // Solve S_j = sum_k e_k * alpha^(j * p_k) for the error magnitudes.
  const A: number[][] = [];
  for (let j = 0; j < L; j++) {
    const row: number[] = [];
    for (let k = 0; k < L; k++) row.push(EXP[(j * pos[k]) % 255]);
    row.push(S[j]);
    A.push(row);
  }
  for (let col = 0; col < L; col++) {
    let piv = col;
    while (piv < L && A[piv][col] === 0) piv++;
    if (piv === L) throw new Error('uncorrectable');
    [A[col], A[piv]] = [A[piv], A[col]];
    const ip = inv(A[col][col]);
    for (let k = col; k <= L; k++) A[col][k] = mul(A[col][k], ip);
    for (let r = 0; r < L; r++) {
      const f = A[r][col];
      if (r !== col && f) for (let k = col; k <= L; k++) A[r][k] ^= mul(f, A[col][k]);
    }
  }
  for (let k = 0; k < L; k++) cw[n - 1 - pos[k]] ^= A[k][L];

  if (!syndromes(cw, nsym).every((v) => v === 0)) throw new Error('uncorrectable');
}

// ---- Buffer-level API ------------------------------------------------------

const BLOCK_DATA = 191;

function plan(len: number): { k: number; nsym: number }[] {
  const nb = Math.max(1, Math.ceil(len / BLOCK_DATA));
  const out = [];
  for (let b = 0; b < nb; b++) {
    const k = Math.floor(len / nb) + (b < len % nb ? 1 : 0);
    out.push({ k, nsym: Math.min(64, Math.max(20, Math.ceil(k * 0.34))) });
  }
  return out;
}

export function encodedLength(len: number): number {
  return plan(len).reduce((s, p) => s + p.k + p.nsym, 0);
}

export function encodeBuffer(data: Uint8Array): Uint8Array {
  const blocks: Uint8Array[] = [];
  let off = 0;
  for (const { k, nsym } of plan(data.length)) {
    const chunk = data.subarray(off, off + k);
    off += k;
    const cw = new Uint8Array(k + nsym);
    cw.set(chunk);
    cw.set(rsEncode(chunk, nsym), k);
    blocks.push(cw);
  }
  const out = new Uint8Array(encodedLength(data.length));
  const maxN = Math.max(...blocks.map((b) => b.length));
  let o = 0;
  for (let i = 0; i < maxN; i++) for (const blk of blocks) if (i < blk.length) out[o++] = blk[i];
  return out;
}

/** `enc` must hold at least encodedLength(len) bytes. Throws if a block is unrecoverable. */
export function decodeBuffer(enc: Uint8Array, len: number): Uint8Array {
  const pl = plan(len);
  const blocks = pl.map(({ k, nsym }) => new Uint8Array(k + nsym));
  const maxN = Math.max(...blocks.map((b) => b.length));
  let o = 0;
  for (let i = 0; i < maxN; i++) for (const blk of blocks) if (i < blk.length) blk[i] = enc[o++];
  const out = new Uint8Array(len);
  let off = 0;
  blocks.forEach((blk, idx) => {
    rsDecode(blk, pl[idx].nsym);
    out.set(blk.subarray(0, pl[idx].k), off);
    off += pl[idx].k;
  });
  return out;
}
