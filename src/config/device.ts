/**
 * Device mode: which way the player drives the game. 'desktop' is keyboard and mouse, 'touch'
 * shows the on screen controls (ui/touch-controls.ts) for a phone or a tablet. The title screen
 * lets the player pick one; the pick is remembered in storage, and ?device=touch or
 * ?device=desktop overrides both the memory and the detection for a test or a shared link.
 */

export const DEVICE_MODES = ['desktop', 'touch'] as const;
export type DeviceMode = (typeof DEVICE_MODES)[number];

export const DEVICE_KEY = 'orugas.device';

export function parseDeviceMode(raw: unknown): DeviceMode | null {
  return typeof raw === 'string' && (DEVICE_MODES as readonly string[]).includes(raw) ? (raw as DeviceMode) : null;
}

export interface DeviceEnvironment {
  /** window.location.search. */
  readonly search: string;
  /** What a previous session stored under DEVICE_KEY, or null. */
  readonly stored: string | null;
  /** matchMedia('(pointer: coarse)').matches: the primary pointer is a finger. */
  readonly coarsePointer: boolean;
  /** navigator.maxTouchPoints. */
  readonly maxTouchPoints: number;
}

/** The URL wins, then the remembered pick, then a finger-first screen means touch. */
export function resolveDeviceMode(env: DeviceEnvironment): DeviceMode {
  const fromUrl = parseDeviceMode(new URLSearchParams(env.search).get('device'));
  if (fromUrl !== null) return fromUrl;
  const remembered = parseDeviceMode(env.stored);
  if (remembered !== null) return remembered;
  return env.coarsePointer && env.maxTouchPoints > 0 ? 'touch' : 'desktop';
}
