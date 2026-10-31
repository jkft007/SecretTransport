import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

describe('lazy-loaded reveal animations', () => {
  it('main.ts loads the animation code with a dynamic import, never a static one', () => {
    expect(main).toContain("import('./reveal-anim')");
    const staticImports = [...main.matchAll(/^import\s+(?!type\b)[^;]*from\s+'\.\/reveal-anim'/gm)];
    expect(staticImports).toHaveLength(0);
  });

  it('the style list lives in a module that does not import the animations', () => {
    const styles = readFileSync(new URL('../src/reveal-styles.ts', import.meta.url), 'utf8');
    expect(styles).not.toMatch(/from\s+'\.\/reveal-anim'/);
    expect(styles).toContain('export const STYLES');
  });
});
