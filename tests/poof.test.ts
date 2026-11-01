import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

describe('vanishing clear-out', () => {
  it('the reading-time timer poofs the result away and a vortex takes it, while Clear now stays immediate', () => {
    expect(main).toContain('void vanishAndClear()');
    expect(main).toMatch(/\$\('btn-clear'\)\.onclick = clearResult/);
  });

  it('a new reveal or a manual clear stops a vanish that is running', () => {
    expect(main).toMatch(/function clearResult\(\) \{\s*vanishToken\+\+/);
  });
});
