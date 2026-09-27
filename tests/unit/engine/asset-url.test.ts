import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assetUrl } from '@/engine/asset-url.ts';
import { assetVersions, VERSIONED_PUBLIC_DIRS } from '../../../vite.config.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const PUBLIC = `${ROOT}public`;

describe('assetUrl', () => {
  it('appends the content hash the build knows, and leaves an unknown path alone', () => {
    const versions = { '/sprites/weapons/sheet.png': 'abc123' };
    expect(assetUrl('/sprites/weapons/sheet.png', versions)).toBe('/sprites/weapons/sheet.png?v=abc123');
    expect(assetUrl('/sprites/weapons/atlas.json', versions)).toBe('/sprites/weapons/atlas.json');
    // The mixer joins sound paths relative to the site root; they are the same files.
    expect(assetUrl('audio/sfx/a.ogg', { '/audio/sfx/a.ogg': 'def456' })).toBe('audio/sfx/a.ogg?v=def456');
    // Unit tests run without the build's define: every path is its own URL.
    expect(assetUrl('/audio/manifest.json')).toBe('/audio/manifest.json');
  });
});

describe('assetVersions: the build stamp', () => {
  const versions = assetVersions(PUBLIC);

  it('hashes every sprite and sound by the path it is served at', () => {
    const sheet = createHash('sha256').update(readFileSync(`${PUBLIC}/sprites/weapons/sheet.png`)).digest('hex').slice(0, 10);
    expect(versions['/sprites/weapons/sheet.png']).toBe(sheet);
    expect(versions['/sprites/weapons/atlas.json']).toMatch(/^[0-9a-f]{10}$/);
    expect(versions['/audio/manifest.json']).toMatch(/^[0-9a-f]{10}$/);
    for (const path of Object.keys(versions)) expect(path).toMatch(/^\/(sprites|audio)\/[^\\]+$/);
  });

  it('a changed file gets a new URL, an unchanged one keeps its own', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orugas-assets-'));
    try {
      mkdirSync(join(dir, 'sprites', 'weapons'), { recursive: true });
      mkdirSync(join(dir, 'levels'));
      writeFileSync(join(dir, 'sprites', 'weapons', 'sheet.png'), 'before');
      writeFileSync(join(dir, 'sprites', 'weapons', 'atlas.json'), '{}');
      writeFileSync(join(dir, 'levels', 'island.png'), 'not served immutable');
      const before = assetVersions(dir);
      writeFileSync(join(dir, 'sprites', 'weapons', 'sheet.png'), 'after');
      const after = assetVersions(dir);
      expect(Object.keys(after).sort()).toEqual(['/sprites/weapons/atlas.json', '/sprites/weapons/sheet.png']);
      expect(assetUrl('/sprites/weapons/sheet.png', after)).not.toBe(assetUrl('/sprites/weapons/sheet.png', before));
      expect(assetUrl('/sprites/weapons/atlas.json', after)).toBe(assetUrl('/sprites/weapons/atlas.json', before));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('versions every folder vercel.json serves immutable', () => {
    const vercel = JSON.parse(readFileSync(`${ROOT}vercel.json`, 'utf8')) as {
      headers: { source: string; headers: { key: string; value: string }[] }[];
    };
    const immutable = vercel.headers.filter((rule) => rule.headers.some((h) => h.key.toLowerCase() === 'cache-control' && h.value.includes('immutable')));
    expect(immutable.length).toBeGreaterThan(0);
    for (const rule of immutable) {
      const folder = /^\/([a-z0-9_-]+)\/\(\.\*\)$/.exec(rule.source)?.[1];
      expect(folder, rule.source).toBeDefined();
      expect(VERSIONED_PUBLIC_DIRS).toContain(folder);
    }
  });

  it('main loads sprites and sounds only through assetUrl', () => {
    const main = readFileSync(`${ROOT}src/main.ts`, 'utf8');
    const loads = [...main.matchAll(/['`]\/(sprites|audio)\//g)];
    expect(loads.length).toBeGreaterThan(0);
    for (const load of loads) expect(main.slice(Math.max(0, load.index - 9), load.index)).toBe('assetUrl(');
  });
});
