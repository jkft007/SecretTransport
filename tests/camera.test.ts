import { describe, expect, it } from 'vitest';
import { openPacket, sealText } from '../src/crypto';
import { encodeFakeQr, encodePlainQr, tryDecodeQrFrame } from '../src/qrmodes';
import { MODE_FAKEQR, MODE_QR } from '../src/packet';
import type { Rgba } from '../src/codeart';

// Solve unit-square -> quad projective map (corners TL, TR, BR, BL), return its inverse as a function.
function quadInverse(q: number[][]) {
  const src = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const A: number[][] = [];
  src.forEach(([u, v], i) => {
    const [x, y] = q[i];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x, x], [0, 0, 0, u, v, 1, -u * y, -v * y, y]);
  });
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < 8; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k]; }
  }
  const h = A.map((r, i) => r[8] / r[i]);
  const [a, b, c, d, e, f, g, hh] = h;
  const M = [[a, b, c], [d, e, f], [g, hh, 1]];
  const det = M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
  const inv = [
    [M[1][1] * M[2][2] - M[1][2] * M[2][1], M[0][2] * M[2][1] - M[0][1] * M[2][2], M[0][1] * M[1][2] - M[0][2] * M[1][1]],
    [M[1][2] * M[2][0] - M[1][0] * M[2][2], M[0][0] * M[2][2] - M[0][2] * M[2][0], M[0][2] * M[1][0] - M[0][0] * M[1][2]],
    [M[1][0] * M[2][1] - M[1][1] * M[2][0], M[0][1] * M[2][0] - M[0][0] * M[2][1], M[0][0] * M[1][1] - M[0][1] * M[1][0]],
  ].map((r) => r.map((v) => v / det));
  return (x: number, y: number) => {
    const w = inv[2][0] * x + inv[2][1] * y + inv[2][2];
    return [(inv[0][0] * x + inv[0][1] * y + inv[0][2]) / w, (inv[1][0] * x + inv[1][1] * y + inv[1][2]) / w];
  };
}

function cameraShot(img: Rgba, quad: number[][], seed = 3): Rgba {
  const W = 960, H = 720;
  const inv = quadInverse(quad);
  const data = new Uint8ClampedArray(W * H * 4);
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const [u, v] = inv(x, y);
      let val = 70 + 40 * (x / W); // table background
      if (u >= 0 && u < 1 && v >= 0 && v < 1) {
        const sx = u * (img.width - 1), sy = v * (img.height - 1);
        const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
        const g = (xx: number, yy: number) => img.data[(Math.min(yy, img.height - 1) * img.width + Math.min(xx, img.width - 1)) * 4];
        val = (g(x0, y0) * (1 - fx) + g(x0 + 1, y0) * fx) * (1 - fy) + (g(x0, y0 + 1) * (1 - fx) + g(x0 + 1, y0 + 1) * fx) * fy;
        val = val * 0.8 + 20 + 25 * (x / W); // dimmer, uneven light
      }
      const o = (y * W + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = val; data[o + 3] = 255;
    }
  // blur + noise
  const out = new Uint8ClampedArray(data.length);
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += data[((y + dy) * W + x + dx) * 4];
      const o = (y * W + x) * 4;
      out[o] = out[o + 1] = out[o + 2] = sum / 9 + (rnd() - 0.5) * 10; out[o + 3] = 255;
    }
  return { width: W, height: H, data: out };
}

const tilted = [[250, 90], [700, 150], [670, 610], [210, 560]]; // rotated + perspective, ~450 px wide

describe('camera-style frames', () => {
  it('reads a plain QR from a tilted, blurred, dim frame', async () => {
    const frame = cameraShot(encodePlainQr(await sealText('camera plain', 'pw', MODE_QR)), tilted);
    const r = await tryDecodeQrFrame(frame, '');
    expect(r.kind).toBe('packet');
    if (r.kind === 'packet') expect(await openPacket(r.packet, 'pw')).toBe('camera plain');
  });
  it('reads a fake QR from a tilted, blurred, dim frame', async () => {
    const img = await encodeFakeQr(await sealText('camera fake secret', 'pw', MODE_FAKEQR), 'https://example.com', 'pw');
    const frame = cameraShot(img, tilted);
    const r = await tryDecodeQrFrame(frame, 'pw');
    expect(r.kind).toBe('packet');
    if (r.kind === 'packet') expect(await openPacket(r.packet, 'pw')).toBe('camera fake secret');
  });
  it('without the passphrase a fake QR is just a QR; wrong passphrase gives no secret', async () => {
    const img = await encodeFakeQr(await sealText('hidden', 'pw', MODE_FAKEQR), 'https://example.com', 'pw');
    const frame = cameraShot(img, tilted);
    expect((await tryDecodeQrFrame(frame, '')).kind).toBe('qr-no-secret');
    expect((await tryDecodeQrFrame(frame, 'wrong')).kind).toBe('qr-no-secret');
  });
  it('reports nothing for a frame without a QR', async () => {
    const blank = { width: 100, height: 100, data: new Uint8ClampedArray(100 * 100 * 4).fill(120) };
    expect((await tryDecodeQrFrame(blank, 'pw')).kind).toBe('none');
  });
});
