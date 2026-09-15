/**
 * Static taunt lines for the heuristic CPU (architecture.md section F: taunts in fallback mode
 * come from a per personality list). English, short, in character. The model backend writes its
 * own; these play when the heuristic is driving. Picked by a seeded index so a match is
 * reproducible.
 */

import type { CpuPersonality } from './contract.ts';

const TAUNTS: Readonly<Record<CpuPersonality, readonly string[]>> = Object.freeze({
  aggressive: Object.freeze(['Eat this!', 'Boom incoming!', 'No mercy for worms!', 'Say goodnight!']),
  cautious: Object.freeze(['Steady does it.', 'Measured and mean.', 'Patience pays.', 'One clean shot.']),
  chaotic: Object.freeze(['Wheee, chaos!', 'Watch this nonsense!', 'Anything can happen!', 'Surprise!']),
  sniper: Object.freeze(['One shot, one worm.', 'Right between the eyes.', 'You cannot hide.', 'Locked on.']),
});

const SKIP_TAUNTS: readonly string[] = Object.freeze(['Nothing worth wasting a shot on.', 'I will wait.', 'Not this turn.']);

export function pickTaunt(personality: CpuPersonality, index: number): string {
  const list = TAUNTS[personality];
  return list[Math.abs(Math.floor(index)) % list.length] ?? 'Take that!';
}

export function pickSkipTaunt(index: number): string {
  return SKIP_TAUNTS[Math.abs(Math.floor(index)) % SKIP_TAUNTS.length] ?? SKIP_TAUNTS[0]!;
}
