import { describe, expect, it } from 'vitest';
import { parseDeviceMode, resolveDeviceMode } from '@/config/device.ts';

const DESKTOP = { search: '', stored: null, coarsePointer: false, maxTouchPoints: 0 };
const PHONE = { search: '', stored: null, coarsePointer: true, maxTouchPoints: 5 };

describe('device mode', () => {
  it('parses only the known modes', () => {
    expect(parseDeviceMode('touch')).toBe('touch');
    expect(parseDeviceMode('desktop')).toBe('desktop');
    expect(parseDeviceMode('tv')).toBeNull();
    expect(parseDeviceMode(null)).toBeNull();
  });

  it('detects a finger-first screen as touch and everything else as desktop', () => {
    expect(resolveDeviceMode(DESKTOP)).toBe('desktop');
    expect(resolveDeviceMode(PHONE)).toBe('touch');
    // A touch laptop whose main pointer is a mouse stays on the keyboard layout.
    expect(resolveDeviceMode({ ...DESKTOP, maxTouchPoints: 10 })).toBe('desktop');
  });

  it('prefers the remembered pick over detection, and the URL over both', () => {
    expect(resolveDeviceMode({ ...PHONE, stored: 'desktop' })).toBe('desktop');
    expect(resolveDeviceMode({ ...DESKTOP, stored: 'touch' })).toBe('touch');
    expect(resolveDeviceMode({ ...DESKTOP, stored: 'touch', search: '?device=desktop' })).toBe('desktop');
    expect(resolveDeviceMode({ ...DESKTOP, search: '?seed=3&device=touch' })).toBe('touch');
    expect(resolveDeviceMode({ ...PHONE, stored: 'garbage' })).toBe('touch');
  });
});
