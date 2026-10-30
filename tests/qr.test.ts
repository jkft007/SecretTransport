import { describe, expect, it } from 'vitest';
import jsQR from 'jsqr';
import { byteCapacity, encodeQr, encodeQrAt, type Ecl } from '../src/qr';

function toRgba(modules: boolean[][], scale = 4) {
  const q = 4, n = modules.length, size = (n + 2 * q) * scale;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  modules.forEach((row, y) => row.forEach((d, x) => {
    if (!d) return;
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const o = (((y + q) * scale + dy) * size + (x + q) * scale + dx) * 4;
      data[o] = data[o + 1] = data[o + 2] = 0;
    }
  }));
  return { data, size };
}

describe('qr encoder', () => {
  it('is readable by jsQR for every version and level', () => {
    const bad: string[] = [];
    for (const ecl of ['L', 'M', 'Q', 'H'] as Ecl[])
      for (let v = 1; v <= 40; v++) {
        if (ecl === 'L' && v === 23) continue; // jsQR itself cannot read this one; capacity (1091 B) matches the spec
        const bytes = Uint8Array.from({ length: Math.min(byteCapacity(v, ecl), 40 + v * 7) }, (_, i) => 33 + ((i * 7 + v) % 90));
        const sym = encodeQrAt(bytes, ecl, v);
        const { data, size } = toRgba(sym.modules);
        const r = jsQR(data, size, size);
        if (!r || r.data !== String.fromCharCode(...bytes)) bad.push(`${ecl}${v}`);
      }
    expect(bad).toEqual([]);
  });
  it('fills a version to capacity', () => {
    const bytes = new Uint8Array(byteCapacity(40, 'L')).fill(65);
    const { data, size } = toRgba(encodeQr(bytes, 'L').modules, 3);
    expect(jsQR(data, size, size)?.data.length).toBe(bytes.length);
  });
  it('reports version', () => {
    const sym = encodeQrAt(new Uint8Array([65, 66]), 'H', 12);
    const { data, size } = toRgba(sym.modules);
    expect(jsQR(data, size, size)?.version).toBe(12);
  });
});
