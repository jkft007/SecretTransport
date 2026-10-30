// Plain QR (packet as base64) and fake QR (valid QR for a decoy; real packet hidden in its
// error-correction budget).
import jsQR from 'jsqr';
import { decodeBuffer, encodedLength, encodeBuffer } from './ecc';
import { findBounds, type Rgba } from './codeart';
import { blockMap, byteCapacity, buildSymbol, encodeQr, encodeQrAt, layout, readCodewords, type QrSymbol } from './qr';

// ---- rendering / reading ----------------------------------------------------

export function qrToRgba(sym: QrSymbol): Rgba {
  const quiet = 4;
  const scale = Math.max(6, Math.ceil(360 / (sym.size + 2 * quiet)));
  const size = (sym.size + 2 * quiet) * scale;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  sym.modules.forEach((row, my) =>
    row.forEach((dark, mx) => {
      if (!dark) return;
      for (let dy = 0; dy < scale; dy++)
        for (let dx = 0; dx < scale; dx++) {
          const o = (((my + quiet) * scale + dy) * size + (mx + quiet) * scale + dx) * 4;
          data[o] = data[o + 1] = data[o + 2] = 0;
        }
    }),
  );
  return { width: size, height: size, data };
}

function scan(img: Rgba) {
  const r = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
  if (!r) throw new Error('No QR code found');
  return r;
}

/** Samples an axis-aligned QR symbol (white margin around it) into a module matrix. */
function sampleModules(img: Rgba, n: number): boolean[][] {
  const { top, bottom, left, right } = findBounds(img);
  const cw = (right - left + 1) / n;
  const ch = (bottom - top + 1) / n;
  const out: boolean[][] = [];
  for (let y = 0; y < n; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < n; x++) {
      const cx = left + (x + 0.5) * cw;
      const cy = top + (y + 0.5) * ch;
      const rx = Math.max(0.5, cw * 0.25);
      const ry = Math.max(0.5, ch * 0.25);
      let sum = 0;
      let cnt = 0;
      for (let py = Math.round(cy - ry); py <= Math.round(cy + ry); py++)
        for (let px = Math.round(cx - rx); px <= Math.round(cx + rx); px++) {
          if (px < 0 || py < 0 || px >= img.width || py >= img.height) continue;
          const o = (py * img.width + px) * 4;
          sum += (img.data[o] + img.data[o + 1] + img.data[o + 2]) / 3;
          cnt++;
        }
      row.push(sum / cnt < 128);
    }
    out.push(row);
  }
  return out;
}

// ---- plain QR ----------------------------------------------------------------

const toB64 = (u: Uint8Array) => {
  let s = '';
  for (const b of u) s += String.fromCharCode(b);
  return btoa(s);
};
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function encodePlainQr(packet: Uint8Array): Rgba {
  return qrToRgba(encodeQr(new TextEncoder().encode(toB64(packet)), 'M'));
}

export function decodePlainQr(img: Rgba): Uint8Array {
  return fromB64(scan(img).data);
}

// ---- fake QR -----------------------------------------------------------------

const HIDDEN_HEADER = 6; // payload length, 2 bytes x3 for majority voting

/** Hidden bytes a version can carry: half of what each RS block could correct stays free for noise. */
export function fakeQrCapacity(version: number): number {
  const l = layout(version, 'H');
  return l.nb * (l.eccLen >> 2) - HIDDEN_HEADER;
}

async function hiddenPlan(version: number, passphrase: string): Promise<number[]> {
  const l = layout(version, 'H');
  const blocks = blockMap(l);
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`ST-fakeqr|${version}|${passphrase.normalize('NFKC')}`)));
  const dv = new DataView(h.buffer);
  let a = dv.getUint32(0) | 1;
  let b = dv.getUint32(4);
  let c = dv.getUint32(8);
  let d = dv.getUint32(12);
  const rnd = () => {
    // sfc32
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = ((c << 21) | (c >>> 11)) >>> 0;
    c = (c + t) >>> 0;
    return t / 4294967296;
  };
  const per: number[][] = Array.from({ length: l.nb }, () => []);
  blocks.forEach((blk, idx) => per[blk].push(idx));
  for (const list of per)
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
  const budget = l.eccLen >> 2;
  const order: number[] = [];
  for (let r = 0; r < budget; r++) for (let j = 0; j < l.nb; j++) order.push(per[j][r]);
  return order;
}

export async function encodeFakeQr(packet: Uint8Array, decoy: string, passphrase: string): Promise<Rgba> {
  const need = encodedLength(packet.length);
  const decoyBytes = new TextEncoder().encode(decoy);
  let version = 0;
  for (let v = 1; v <= 40; v++)
    if (fakeQrCapacity(v) >= need && byteCapacity(v, 'H') >= decoyBytes.length) {
      version = v;
      break;
    }
  if (!version) throw new Error('Too much text for a fake QR code. Use a shorter secret or a shorter decoy.');

  const clean = encodeQrAt(decoyBytes, 'H', version);
  const plan = await hiddenPlan(version, passphrase);
  const hidden = new Uint8Array(HIDDEN_HEADER + need);
  for (let r = 0; r < 3; r++) {
    hidden[r * 2] = packet.length >> 8;
    hidden[r * 2 + 1] = packet.length & 255;
  }
  hidden.set(encodeBuffer(packet), HIDDEN_HEADER);
  const cw = clean.codewords.slice();
  hidden.forEach((byte, i) => (cw[plan[i]] ^= byte));
  return qrToRgba(buildSymbol(version, 'H', cw, clean.mask));
}

export async function decodeFakeQr(img: Rgba, passphrase: string): Promise<Uint8Array> {
  const res = scan(img);
  const clean = encodeQrAt(Uint8Array.from(res.binaryData), 'H', res.version);
  const observed = readCodewords(sampleModules(img, clean.size), res.version, clean.mask);
  const plan = await hiddenPlan(res.version, passphrase);
  const delta = (i: number) => observed[plan[i]] ^ clean.codewords[plan[i]];
  const vote = (k: number) => {
    const [x, y, z] = [delta(k), delta(k + 2), delta(k + 4)];
    return x === y || x === z ? x : y === z ? y : x;
  };
  const len = (vote(0) << 8) | vote(1);
  const need = encodedLength(len);
  if (len < 1 || HIDDEN_HEADER + need > plan.length) throw new Error('No hidden data');
  const enc = new Uint8Array(need);
  for (let i = 0; i < need; i++) enc[i] = delta(HIDDEN_HEADER + i);
  return decodeBuffer(enc, len);
}
