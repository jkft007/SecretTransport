import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SITE_URL } from '../src/qrmodes';

const dir = new URL('../public/outlook/', import.meta.url);
const manifest = readFileSync(new URL('manifest.xml', dir), 'utf8');

describe('Outlook add-in files', () => {
  it('the manifest points only at files that ship and at this site', () => {
    const urls = [...manifest.matchAll(/(?:DefaultValue|AppDomain>)\s*="?(https:\/\/[^"<\s]+)/g)].map((m) => m[1]);
    const own = [...manifest.matchAll(/DefaultValue="(https:\/\/jkft007\.github\.io\/SecretTransport\/outlook\/[^"]+)"/g)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThan(0);
    expect(own.length).toBeGreaterThanOrEqual(7);
    for (const u of own) {
      expect(u.startsWith(SITE_URL + 'outlook/')).toBe(true);
      expect(existsSync(new URL(u.slice((SITE_URL + 'outlook/').length), dir))).toBe(true);
    }
    expect(manifest).toContain('<Permissions>ReadItem</Permissions>'); // it only reads the open email
    expect(manifest).toMatch(/<Id>[0-9a-f-]{36}<\/Id>/);
  });

  it('the pane takes only the data after #q= from a link, never follows it, and talks only to its own origin', () => {
    const js = readFileSync(new URL('taskpane.js', dir), 'utf8');
    expect(js).toContain('#q=');
    expect(js).toContain('location.origin');
    expect(js).not.toMatch(/window\.open|location\.href\s*=|fetch\(|XMLHttpRequest/);
  });
});
