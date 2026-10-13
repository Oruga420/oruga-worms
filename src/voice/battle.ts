/**
 * The battle as the tools see it (tools.ts BattleView): read off the controller each time a tool
 * asks, so it is always the live match. Names and numbers only, nothing the agent could act on
 * except through the command door.
 */

import type { Controller } from '../game/controller.ts';
import { activeTeamOf, activeWormOf } from '../match/ledger.ts';
import { superResting } from '../match/super-rest.ts';
import { WEAPON_IDS, getWeapon, isSuper } from '../weapons/registry.ts';
import type { BattleView, BattleWeapon, BattleWorm } from './tools.ts';

export function battleView(controller: Controller, menuOpen = false): BattleView {
  const state = controller.state();
  const world = controller.world();
  const team = activeTeamOf(state);
  const worm = activeWormOf(state);
  const worms: BattleWorm[] = [];
  for (const t of state.teams) {
    for (const w of t.worms) {
      const body = world.worms.find((b) => b.id === w.id);
      worms.push({ id: w.id, name: w.name, team: t.name, teamId: t.id, hp: w.hp, alive: w.alive && w.hp > 0, x: body?.x ?? 0, y: body?.y ?? 0, active: w.id === worm?.id });
    }
  }
  const weapons: BattleWeapon[] = [];
  if (worm !== undefined) {
    for (const id of WEAPON_IDS) {
      const count = worm.ammo[id] ?? 0;
      if (count === 0) continue;
      const def = getWeapon(id);
      const ready = worm.turns >= (def.delayTurns ?? 0) && !(isSuper(id) && superResting(worm));
      weapons.push({ id, name: def.name, count, ready, super: isSuper(id) });
    }
  }
  return {
    phase: state.phase,
    turn: state.turn,
    humanTurn: team?.controller === 'human' && state.phase !== 'MatchEnd',
    activeTeam: team?.name ?? null,
    activeTeamId: team?.id ?? null,
    activeWorm: worm?.name ?? null,
    activeWormId: worm?.id ?? null,
    weaponInHand: worm === undefined ? null : controller.selectedWeapon(),
    aimDeg: controller.aim().angleDeg,
    stepsLeft: controller.stepsRemaining(),
    wind: state.wind.step,
    worms,
    weapons,
    busy: controller.commandBusy(),
    menuOpen,
  };
}
