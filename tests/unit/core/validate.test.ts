import { describe, expect, it } from 'vitest';
import { dirnameUrl, isAssetId, isNonEmptyString, isRecord, isRelativePath, joinUrl, toFinite } from '@/core/validate.ts';

describe('validate: primitives', () => {
  it('isRecord accepts plain objects only', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord('x')).toBe(false);
    expect(isRecord(undefined)).toBe(false);
  });

  it('toFinite accepts finite JSON numbers only', () => {
    expect(toFinite(1.5)).toBe(1.5);
    expect(toFinite(0)).toBe(0);
    expect(toFinite(-3)).toBe(-3);
    expect(toFinite('1')).toBeNull();
    expect(toFinite(Number.NaN)).toBeNull();
    expect(toFinite(Number.POSITIVE_INFINITY)).toBeNull();
    expect(toFinite(undefined)).toBeNull();
    expect(toFinite(null)).toBeNull();
  });

  it('isNonEmptyString rejects blanks and non strings', () => {
    expect(isNonEmptyString('a')).toBe(true);
    expect(isNonEmptyString('')).toBe(false);
    expect(isNonEmptyString('   ')).toBe(false);
    expect(isNonEmptyString(1)).toBe(false);
  });

  it('isAssetId enforces the lowercase id pattern from the security requirements', () => {
    expect(isAssetId('wpn_bazooka_launch')).toBe(true);
    expect(isAssetId('exp_small_1')).toBe(true);
    expect(isAssetId('Wpn')).toBe(false);
    expect(isAssetId('a-b')).toBe(false);
    expect(isAssetId('a b')).toBe(false);
    expect(isAssetId('a.b')).toBe(false);
    expect(isAssetId('')).toBe(false);
    expect(isAssetId(42)).toBe(false);
  });
});

describe('validate: paths and urls', () => {
  it('isRelativePath keeps paths inside the asset root', () => {
    expect(isRelativePath('audio/sfx/a.ogg')).toBe(true);
    expect(isRelativePath('a.png')).toBe(true);
    expect(isRelativePath('levels/island-01_mask.png')).toBe(true);
    expect(isRelativePath('./x.json')).toBe(true);
  });

  it('isRelativePath rejects absolute paths, parent segments, schemes and odd characters', () => {
    expect(isRelativePath('/abs.png')).toBe(false);
    expect(isRelativePath('../x.png')).toBe(false);
    expect(isRelativePath('a/../b.png')).toBe(false);
    expect(isRelativePath('http://evil.example/x.png')).toBe(false);
    expect(isRelativePath('a\\b.png')).toBe(false);
    expect(isRelativePath('a//b.png')).toBe(false);
    expect(isRelativePath('x.png?y=1')).toBe(false);
    expect(isRelativePath('')).toBe(false);
    expect(isRelativePath(7)).toBe(false);
  });

  it('joinUrl puts exactly one slash between the parts', () => {
    expect(joinUrl('/assets', 'audio/manifest.json')).toBe('/assets/audio/manifest.json');
    expect(joinUrl('/assets/', './x.png')).toBe('/assets/x.png');
    expect(joinUrl('', 'x.png')).toBe('x.png');
    expect(joinUrl('https://host/a', 'b.json')).toBe('https://host/a/b.json');
  });

  it('dirnameUrl strips the last segment', () => {
    expect(dirnameUrl('/assets/manifest.json')).toBe('/assets');
    expect(dirnameUrl('manifest.json')).toBe('');
    expect(dirnameUrl('/manifest.json')).toBe('');
    expect(dirnameUrl('https://host/a/b.json')).toBe('https://host/a');
  });
});
