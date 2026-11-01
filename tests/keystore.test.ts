import { describe, expect, it } from 'vitest';
import { openPayload, sealPayload } from '../src/crypto';
import { KeyStoreError, exportBackup, parseBackup, protectKey, unprotectKey } from '../src/keystore';
import { MODE_CODEART } from '../src/packet';
import { generateKeyPair, keyId, photoPassFor } from '../src/pubkey';

describe('protected private keys', () => {
  it('opens with the right passphrase and a message locked to the public key opens with it', async () => {
    const k = await generateKeyPair('x25519');
    const stored = await protectKey(k, '  Bob  ', 'correct horse battery staple 77');
    expect(stored.label).toBe('Bob');
    expect(stored.id).toBe(await keyId({ type: k.type, raw: k.raw }));
    const id = await unprotectKey(stored, 'correct horse battery staple 77');
    expect(id).not.toBeNull();
    const pkt = await sealPayload({ kind: 'text', text: 'for bob' }, '', MODE_CODEART, undefined, 0, 0, '', 0, [{ type: k.type, raw: k.raw }]);
    expect(await openPayload(pkt, '', Date.now(), [id!])).toMatchObject({ text: 'for bob' });
  });

  it('does not open with a wrong passphrase, and the private half is not in the stored record in the clear', async () => {
    const k = await generateKeyPair('p256');
    const stored = await protectKey(k, 'Eve', 'a long enough phrase 9911');
    expect(await unprotectKey(stored, 'something else entirely')).toBeNull();
    const hay = Array.from(stored.ct).join(',');
    expect(hay).not.toContain(Array.from(k.pkcs8.subarray(16, 40)).join(','));
  });

  it('is not extractable once opened', async () => {
    const k = await generateKeyPair('x25519');
    const id = await unprotectKey(await protectKey(k, 'x', 'long enough phrase 1234'), 'long enough phrase 1234');
    await expect(crypto.subtle.exportKey('pkcs8', id!.priv)).rejects.toThrow();
  });
});

describe('key backups', () => {
  it('round-trips and still opens with the passphrase', async () => {
    const k = await generateKeyPair('x25519');
    const stored = await protectKey(k, 'Ann', 'backup phrase long enough 55');
    const back = await parseBackup(exportBackup(stored));
    expect(back.id).toBe(stored.id);
    expect(back.label).toBe('Ann');
    expect(await unprotectKey(back, 'backup phrase long enough 55')).not.toBeNull();
  });

  it('rejects things that are not backups, damaged ones and unreasonable settings', async () => {
    const k = await generateKeyPair('x25519');
    const text = exportBackup(await protectKey(k, 'Ann', 'backup phrase long enough 55'));
    await expect(parseBackup('hello')).rejects.toBeInstanceOf(KeyStoreError);
    await expect(parseBackup('{"format":"other"}')).rejects.toBeInstanceOf(KeyStoreError);
    await expect(parseBackup(text.replace(/"ct": "[^"]+"/, '"ct": "AAAA"'))).rejects.toBeInstanceOf(KeyStoreError);
    await expect(parseBackup(text.replace(/"memLog2": \d+/, '"memLog2": 30'))).rejects.toBeInstanceOf(KeyStoreError);
  });
});

describe('photo position for a public key', () => {
  it('is the same for the same key and differs between keys', async () => {
    const a = await generateKeyPair('x25519');
    const b = await generateKeyPair('x25519');
    expect(photoPassFor(a)).toBe(photoPassFor({ type: a.type, raw: a.raw }));
    expect(photoPassFor(a)).not.toBe(photoPassFor(b));
  });
});
