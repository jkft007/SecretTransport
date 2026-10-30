import { describe, expect, it } from 'vitest';
import jpeg from 'jpeg-js';
import jsQR from 'jsqr';
import { decodePlainQr, decodeFakeQr, encodeFakeQr, encodePlainQr, fakeQrCapacity, packetFromQrText, packetLink, qrToRgba } from '../src/qrmodes';
import { encodeQr } from '../src/qr';
import { cropTo8, dctCapacity, embedDct, extractDct } from '../src/dct';
import { openPacket, sealText } from '../src/crypto';
import type { Rgba } from '../src/codeart';
import { MODE_DCT, MODE_FAKEQR, MODE_QR } from '../src/packet';

function jpegRoundtrip(img: Rgba, quality: number): Rgba {
  const enc = jpeg.encode({ width: img.width, height: img.height, data: img.data as never }, quality);
  const dec = jpeg.decode(enc.data, { useTArray: true });
  return { width: dec.width, height: dec.height, data: new Uint8ClampedArray(dec.data) };
}

function photo(w: number, h: number): Rgba {
  const data = new Uint8ClampedArray(w * h * 4);
  let s = 7;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      const n = (s >>> 24) / 255 * 24 - 12;
      const o = (y * w + x) * 4;
      data[o] = 90 + 80 * Math.sin(x / 37) + n + 40 * Math.cos(y / 53);
      data[o + 1] = 110 + 60 * Math.sin((x + y) / 61) + n;
      data[o + 2] = 140 + 50 * Math.cos(x / 29 + y / 41) + n;
      data[o + 3] = 255;
    }
  return { width: w, height: h, data };
}

describe('plain QR', () => {
  it('roundtrips, also after JPEG', async () => {
    const p = await sealText('qr secret', 'pw', MODE_QR);
    const img = encodePlainQr(p);
    expect(await openPacket(decodePlainQr(img), 'pw')).toBe('qr secret');
    expect(await openPacket(decodePlainQr(jpegRoundtrip(img, 60)), 'pw')).toBe('qr secret');
  });

  it('holds a link that opens the app with the encrypted packet in the fragment', async () => {
    const p = await sealText('open me from a camera', 'pw', MODE_QR);
    const base = 'https://example.com/app/';
    const link = packetLink(p, base);
    expect(link.startsWith(`${base}#q=`)).toBe(true);
    expect(link).toMatch(/^[\x21-\x7e]+$/); // plain printable text, with no '+', '/' or '=' that a URL could mangle
    expect(link.slice(base.length + 3)).toMatch(/^[A-Za-z0-9_-]+$/);
    const img = encodePlainQr(p, base);
    // what a phone camera reads is that link
    expect(jsQR(img.data, img.width, img.height)?.data).toBe(link);
    // and the app turns it back into the same packet
    expect([...packetFromQrText(link)]).toEqual([...p]);
    expect(await openPacket(decodePlainQr(img), 'pw')).toBe('open me from a camera');
  });

  it('still reads QR codes made by earlier versions (raw base64)', async () => {
    const p = await sealText('old qr', 'pw', MODE_QR);
    let s = '';
    for (const b of p) s += String.fromCharCode(b);
    const legacy = qrToRgba(encodeQr(new TextEncoder().encode(btoa(s)), 'M'));
    expect(await openPacket(decodePlainQr(legacy), 'pw')).toBe('old qr');
  });
});

describe('fake QR', () => {
  const decoy = 'https://example.com/welcome';
  it('scans as the decoy yet reveals the secret', async () => {
    const secret = 'the real message 🔐';
    const img = await encodeFakeQr(await sealText(secret, 'pw', MODE_FAKEQR), decoy, 'pw');
    expect(jsQR(img.data, img.width, img.height)?.data).toBe(decoy);
    expect(await openPacket(await decodeFakeQr(img, 'pw'), 'pw')).toBe(secret);
  });
  it('still works after JPEG recompression', async () => {
    const img = await encodeFakeQr(await sealText('survive jpeg', 'pw', MODE_FAKEQR), decoy, 'pw');
    const j = jpegRoundtrip(img, 70);
    expect(jsQR(j.data, j.width, j.height)?.data).toBe(decoy);
    expect(await openPacket(await decodeFakeQr(j, 'pw'), 'pw')).toBe('survive jpeg');
  });
  it('rejects a wrong passphrase and oversize input', async () => {
    const p = await sealText('x', 'pw', MODE_FAKEQR);
    const img = await encodeFakeQr(p, decoy, 'pw');
    await expect(decodeFakeQr(img, 'nope').then((b) => openPacket(b, 'nope'))).rejects.toThrow();
    expect(fakeQrCapacity(40)).toBeGreaterThan(400);
    await expect(encodeFakeQr(new Uint8Array(5000), decoy, 'pw')).rejects.toThrow();
  });
});

describe('JPEG-robust photo', () => {
  const cover = cropTo8(photo(640, 480));
  it('roundtrips losslessly', async () => {
    const out = await embedDct(cover, await sealText('lossless ok', 'pw', MODE_DCT), 'pw');
    expect(await openPacket(await extractDct(out, 'pw'), 'pw')).toBe('lossless ok');
  });
  for (const q of [85, 70, 50]) {
    it(`survives JPEG quality ${q}`, async () => {
      const text = 'meet at the old bridge at nine, bring the key. '.repeat(3);
      const out = await embedDct(cover, await sealText(text, 'pw', MODE_DCT), 'pw');
      expect(await openPacket(await extractDct(jpegRoundtrip(out, q), 'pw'), 'pw')).toBe(text);
    });
  }
  it('fails with wrong passphrase and reports capacity', async () => {
    const out = await embedDct(cover, await sealText('x', 'pw', MODE_DCT), 'pw');
    await expect(extractDct(out, 'nope').then((b) => openPacket(b, 'nope'))).rejects.toThrow();
    expect(dctCapacity(cover)).toBeGreaterThan(500);
  });
});
