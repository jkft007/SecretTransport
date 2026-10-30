import { describe, expect, it } from 'vitest';
import { DEFAULT_KDF, layoutKey, legacyLayoutKey, MAX_MEM_LOG2, setDefaultKdf } from '../src/kdf';
import { openPacket, openPayload, sealText, WrongPassphraseError } from '../src/crypto';
import { crc32, HEADER_LEN_V2, MODE_CODEART, MODE_DCT, MODE_FAKEQR, MODE_STEGO, parsePacket } from '../src/packet';
import { embed, extract } from '../src/stego';
import { embedDct, extractDct } from '../src/dct';
import { decodeFakeQr, encodeFakeQr } from '../src/qrmodes';
import { passphraseBits, strength } from '../src/strength';
import { checkLock, FREE_ATTEMPTS, memoryStore, recordFailure, recordSuccess } from '../src/throttle';
import type { Rgba } from '../src/codeart';

describe('Argon2id key derivation', () => {
  it('uses 64 MiB / 3 passes by default and records them in the header', async () => {
    expect(DEFAULT_KDF).toEqual({ type: 'argon2id', memLog2: 16, iterations: 3 });
    setDefaultKdf(DEFAULT_KDF);
    try {
      const t0 = Date.now();
      const p = await sealText('production parameters', 'a long unguessable passphrase 91', MODE_CODEART);
      const k = parsePacket(p);
      expect(k.kdf).toEqual({ type: 'argon2id', memLog2: 16, iterations: 3 });
      expect(p[2]).toBe(2);
      expect(k.header.length).toBe(HEADER_LEN_V2);
      expect(await openPacket(p, 'a long unguessable passphrase 91')).toBe('production parameters');
      expect(Date.now() - t0).toBeGreaterThan(50); // genuinely costs something
    } finally {
      setDefaultKdf({ type: 'argon2id', memLog2: 12, iterations: 1 });
    }
  });

  it('still opens version 1 (PBKDF2) packets made by the earlier release', async () => {
    const old = await sealText('from the old release', 'pw', MODE_CODEART, { type: 'pbkdf2' });
    expect(old[2]).toBe(1);
    expect(parsePacket(old).kdf).toEqual({ type: 'pbkdf2' });
    expect(await openPacket(old, 'pw')).toBe('from the old release');
    await expect(openPacket(old, 'nope')).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it('authenticates the stored settings: changing them breaks decryption', async () => {
    const p = await sealText('tamper', 'pw', MODE_CODEART);
    const t = p.slice();
    t[6] = 2; // pretend it used 2 passes instead of 1
    new DataView(t.buffer).setUint32(t.length - 4, crc32(t.subarray(0, t.length - 4)));
    await expect(openPayload(t, 'pw')).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it('refuses absurd settings from a crafted header instead of exhausting memory', async () => {
    const p = await sealText('x', 'pw', MODE_CODEART);
    const t = p.slice();
    t[5] = MAX_MEM_LOG2 + 4; // 4 GiB
    new DataView(t.buffer).setUint32(t.length - 4, crc32(t.subarray(0, t.length - 4)));
    await expect(openPayload(t, 'pw')).rejects.toThrow(/Unsupported key-derivation/);
  });
});

describe('layout key (where photo / fake-QR data hides)', () => {
  it('is memory-hard, deterministic per passphrase, and separated per use', async () => {
    const a = await layoutKey('pw', 'stego');
    expect(a.length).toBe(32);
    expect(await layoutKey('pw', 'stego')).toEqual(a);
    expect(await layoutKey('pw', 'dct')).not.toEqual(a);
    expect(await layoutKey('pw2', 'stego')).not.toEqual(a);
    // it is NOT the old fast hash, so a guesser cannot skip the expensive step
    expect(a).not.toEqual(await legacyLayoutKey('ST-stego', 'pw'));
  });

  const cover = (): Rgba => {
    const w = 400, h = 300;
    const data = new Uint8ClampedArray(w * h * 4);
    let s = 3;
    for (let i = 0; i < data.length; i++) data[i] = i % 4 === 3 ? 255 : 90 + ((s = (s * 1664525 + 1013904223) >>> 0) >>> 25) + 40 * Math.sin(i / 2000);
    return { width: w, height: h, data };
  };

  it('new images do not open with the old fast derivation, but legacy images still open', async () => {
    const pkt = await sealText('layout', 'pw', MODE_STEGO);
    const fresh = await embed(cover(), pkt, 'pw');
    expect(await openPacket(await extract(fresh, 'pw'), 'pw')).toBe('layout');
    await expect(extract(fresh, 'pw', true)).rejects.toThrow();

    const legacy = await embed(cover(), pkt, 'pw', true);
    await expect(extract(legacy, 'pw')).rejects.toThrow();
    expect(await openPacket(await extract(legacy, 'pw', true), 'pw')).toBe('layout');
  });

  it('the same holds for JPEG-safe photos and fake QR codes', async () => {
    const dct = await sealText('dct', 'pw', MODE_DCT);
    const img = await embedDct(cover(), dct, 'pw');
    expect(await openPacket(await extractDct(img, 'pw'), 'pw')).toBe('dct');
    await expect(extractDct(img, 'pw', true)).rejects.toThrow();
    const oldDct = await embedDct(cover(), dct, 'pw', true);
    expect(await openPacket(await extractDct(oldDct, 'pw', true), 'pw')).toBe('dct');

    const fq = await sealText('fake', 'pw', MODE_FAKEQR);
    const qr = await encodeFakeQr(fq, 'https://example.com', 'pw');
    expect(await openPacket(await decodeFakeQr(qr, 'pw'), 'pw')).toBe('fake');
    await expect(decodeFakeQr(qr, 'pw', undefined, true).then((b) => openPacket(b, 'pw'))).rejects.toThrow();
    const oldQr = await encodeFakeQr(fq, 'https://example.com', 'pw', true);
    expect(await openPacket(await decodeFakeQr(oldQr, 'pw', undefined, true), 'pw')).toBe('fake');
  });
});

describe('passphrase strength', () => {
  it('flags the passphrases people actually use', () => {
    for (const weak of ['password', 'Password123!', 'P@ssw0rd', 'qwerty123', 'abcdefgh', 'aaaaaaaaaaaa', '12345678', 'correct horse battery staple', 'letmein', 'sunshine99', 'iloveyou', 'hello world']) {
      expect(strength(weak).level, weak).toBe('weak');
    }
  });
  it('accepts long random and long word-based passphrases', () => {
    for (const ok of ['k7m2-xq9f-r4tp-w8hn-j3zc', 'tR7!pQ2#vL9$xM4&', 'maple harbor violet engine quartz lantern wobble']) {
      expect(strength(ok).level, ok).not.toBe('weak');
    }
    expect(strength('k7m2-xq9f-r4tp-w8hn-j3zc').level).toBe('strong');
  });
  it('trusts the generator, and never credits repetition', () => {
    expect(strength('qmxn-vvrt-zzkp-bwcl-ghdf', true).level).toBe('strong');
    expect(passphraseBits('abababababababababab')).toBeLessThan(passphraseBits('a7Gk2xQp9LmW4zRt8Yc'));
    expect(passphraseBits('')).toBe(0);
  });
});

describe('attempt throttle', () => {
  const fp = 'abc';
  it('allows a few free guesses, then backs off exponentially, and forgets on success', () => {
    const s = memoryStore();
    let t = 1_000_000;
    for (let i = 1; i < FREE_ATTEMPTS; i++) expect(recordFailure(s, fp, t).locked).toBe(false);
    const first = recordFailure(s, fp, t);
    expect(first.locked).toBe(true);
    expect(first.waitMs).toBe(5000);
    expect(checkLock(s, fp, t + 2000)).toMatchObject({ locked: true, waitMs: 3000 });
    expect(checkLock(s, fp, t + 5001).locked).toBe(false);
    t += 6000;
    expect(recordFailure(s, fp, t).waitMs).toBe(10000);
    t += 11000;
    expect(recordFailure(s, fp, t).waitMs).toBe(20000);
    recordSuccess(s, fp);
    expect(checkLock(s, fp, t).failures).toBe(0);
  });
  it('caps the delay, isolates images, and forgets after a day', () => {
    const s = memoryStore();
    let t = 5_000_000;
    let last = 0;
    for (let i = 0; i < 30; i++) {
      last = recordFailure(s, fp, t).waitMs;
      t += last + 1;
    }
    expect(last).toBe(5 * 60_000);
    expect(checkLock(s, 'other', t).failures).toBe(0);
    expect(checkLock(s, fp, t + 25 * 3600_000).failures).toBe(0);
  });
});
