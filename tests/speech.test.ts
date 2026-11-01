import { describe, expect, it } from 'vitest';
import { onlyLocal, speechChunks } from '../src/speech';

describe('reading the secret aloud', () => {
  it('only ever offers voices that run on this device', () => {
    const voices = [
      { name: 'Online', localService: false },
      { name: 'Device', localService: true },
    ];
    expect(onlyLocal(voices).map((v) => v.name)).toEqual(['Device']);
    expect(onlyLocal([{ name: 'Online', localService: false }])).toEqual([]);
  });

  it('splits text into short pieces without losing any of it', () => {
    const text = 'First sentence. Second one! Is this the third? Yes: and more; then a long run ' + 'word '.repeat(80);
    const parts = speechChunks(text, 60);
    expect(parts.every((p) => p.length <= 60)).toBe(true);
    expect(parts.join(' ').replace(/\s+/g, ' ')).toBe(text.trim().replace(/\s+/g, ' '));
    expect(speechChunks('')).toEqual([]);
    expect(speechChunks('one\ntwo')).toEqual(['one', 'two']);
  });
});
