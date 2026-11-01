import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

describe('burning clear-out', () => {
  it('the reading-time timer burns the result away, while Clear now stays immediate', () => {
    expect(main).toContain('void burnAndClear()');
    expect(main).toMatch(/\$\('btn-clear'\)\.onclick = clearResult/);
  });

  it('a new reveal or a manual clear stops a burn that is running', () => {
    expect(main).toMatch(/function clearResult\(\) \{\s*burnToken\+\+/);
  });
});
