/**
 * The worms' tools: one list of what an agent may do in a match (look at the battle, pick the worm,
 * walk it counting the steps, turn, jump, aim, change weapon, fire, let the AI find the shot, pass,
 * shout), used three ways with the same names and the same answers:
 *
 * - WebMCP (webmcp.ts): registered on navigator.modelContext, for a browser agent;
 * - the ElevenLabs voice agent (elevenlabs.ts): its client tools, called over the conversation
 *   socket, created on the agent with these schemas by tools/voice/create-agent.ts;
 * - the local voice fallback (speech.ts + parse.ts): the browser's speech recognition, parsed here.
 *
 * Every tool goes through Controller.command (game/commands.ts), so it can do exactly what the
 * keys can on the human's turn and nothing more. Pure apart from the GameApi it is handed.
 */

import type { CommandResult, WormCommand } from '../game/commands.ts';
import type { WeaponId } from '../weapons/types.ts';
import { fold, resolveWeapon } from './lexicon.ts';

export interface BattleWorm {
  readonly id: string;
  readonly name: string;
  readonly team: string;
  readonly teamId: string;
  readonly hp: number;
  readonly alive: boolean;
  readonly x: number;
  readonly y: number;
  readonly active: boolean;
}

export interface BattleWeapon {
  readonly id: WeaponId;
  readonly name: string;
  /** -1 for unlimited. */
  readonly count: number;
  readonly ready: boolean;
  readonly super: boolean;
}

export interface BattleView {
  readonly phase: string;
  readonly turn: number;
  readonly humanTurn: boolean;
  readonly activeTeam: string | null;
  readonly activeTeamId: string | null;
  readonly activeWorm: string | null;
  readonly activeWormId: string | null;
  readonly weaponInHand: WeaponId | null;
  readonly aimDeg: number;
  readonly stepsLeft: number;
  readonly wind: number;
  readonly worms: readonly BattleWorm[];
  readonly weapons: readonly BattleWeapon[];
  readonly busy: boolean;
  /** The weapon panel is open on screen. */
  readonly menuOpen: boolean;
}

export type ScreenName = 'title' | 'setup' | 'playing' | 'weapons' | 'paused' | 'options' | 'end';

export interface ScreenButton {
  readonly id: string;
  readonly label: string;
  readonly enabled: boolean;
  /** Screen px of its centre; absent for the buttons that are keys on a desktop (pause, weapons, play again). */
  readonly at?: { readonly x: number; readonly y: number };
}

/** What is on screen and every button on it (built by screen.ts from the layouts the HUD draws). */
export interface ScreenView {
  readonly screen: ScreenName;
  readonly buttons: readonly ScreenButton[];
}

/** What the tools need from the game: a look at it, the command door, and a speech bubble. */
export interface GameApi {
  /** Null when no match is being played (title, team setup). */
  view(): BattleView | null;
  command(cmd: WormCommand): CommandResult;
  /** A line the active worm shouts, drawn as a comic bubble over it. */
  say(text: string): void;
  /** Opens or closes the weapon panel on screen; false when it cannot be open now (not the human's turn to aim). */
  menu(open: boolean): boolean;
  /** What is on screen and every button on it (screen.ts). */
  screen(): ScreenView;
  /** Clicks a button of the screen by id or label, through the same path as the mouse. */
  press(button: string): ToolAnswer;
  /** Clicks the map at a world point (a targeted weapon's destination). */
  clickMap(point: { readonly x: number; readonly y: number }): ToolAnswer;
  /** Zooms or pans the camera, as the wheel and a drag do. */
  camera(zoom: 'in' | 'out' | null, look: 'left' | 'right' | 'up' | 'down' | 'worm' | null): ToolAnswer;
}

export interface ToolParam {
  readonly type: 'string' | 'number';
  readonly description: string;
  readonly enum?: readonly string[];
}

export interface ToolDef {
  readonly name: string;
  readonly description: string;
  readonly params: Readonly<Record<string, ToolParam>>;
  readonly required: readonly string[];
}

export interface ToolAnswer {
  readonly ok: boolean;
  readonly text: string;
}

const WORM = { type: 'string', description: 'Worm name as shown in the game (for example Rojo, Raúl, Ana). Optional: defaults to the worm whose turn it is.' } as const;
const DIRECTION = { type: 'string', description: 'left or right (izquierda o derecha).', enum: ['left', 'right'] } as const;
const WEAPON = { type: 'string', description: 'Weapon id or name, in Spanish or English: bazooka, granada, escopeta, kamehameha, gear 5, freezer, ryuko ranbu, ataque aereo, oveja, saibaman, antares, hiken, meteorito, santoryu, zoltraak, explosion final, ... get_battle_state lists what the worm can use.' } as const;

export const TOOLS: readonly ToolDef[] = Object.freeze([
  {
    name: 'get_screen',
    description: 'What is on screen (title, team setup, the match, the weapon panel, pause, options, the end screen) and every button that can be clicked there, by id. Call it before press_button when unsure.',
    params: {},
    required: [],
  },
  {
    name: 'press_button',
    description:
      'Click any button of the screen, exactly as the mouse would: on the title "desktop", "touch" or "start"; on the team setup "map", "team:0:name", "team:1:controller", "team:1:difficulty", "add", "remove", "start"; in the match "pause" and "weapons" (the panel) or a weapon cell by id; paused "resume", "options", "surrender"; in options "vol:music:plus", "key:fire", "reset", "back"; at the end "restart". A label works too.',
    params: { button: { type: 'string', description: 'Button id from get_screen, or its label.' } },
    required: ['button'],
  },
  {
    name: 'click_map',
    description: 'Click a point of the map, as the mouse does: where an air strike, a teleport, a girder or the Meteorito goes once picked. Give a worm name to click on it, or world x/y.',
    params: { worm: { type: 'string', description: 'Click on this worm.' }, x: { type: 'number', description: 'World x in px.' }, y: { type: 'number', description: 'World y in px.' } },
    required: [],
  },
  {
    name: 'camera',
    description: 'Zoom the camera in or out (the mouse wheel) or look around (a drag): look left, right, up, down, or back at the worm.',
    params: { zoom: { type: 'string', description: 'in or out.', enum: ['in', 'out'] }, look: { type: 'string', description: 'left, right, up, down or worm.', enum: ['left', 'right', 'up', 'down', 'worm'] } },
    required: [],
  },
  {
    name: 'get_battle_state',
    description: 'Look at the battle: whose turn it is, every worm (name, team, hp, position), the weapons the worm up can use right now, steps left, wind. Call it first when unsure of names or weapons.',
    params: {},
    required: [],
  },
  {
    name: 'choose_worm',
    description: 'Pick which worm of the team whose turn it is plays this turn ("Raúl, yo te elijo"). Only before that turn\'s worm has walked or fired.',
    params: { worm: { ...WORM, description: 'Name of the worm to pick.' } },
    required: ['worm'],
  },
  {
    name: 'walk',
    description: 'Walk the worm a number of steps left or right; the steps are counted out loud over its head. A turn has 10 steps in all.',
    params: { direction: DIRECTION, steps: { type: 'number', description: 'Steps to walk, 1 to 10.' }, worm: WORM },
    required: ['direction', 'steps'],
  },
  {
    name: 'turn_around',
    description: 'Make the worm face left or right without walking.',
    params: { direction: DIRECTION, worm: WORM },
    required: ['direction'],
  },
  {
    name: 'jump',
    description: 'Jump forward, or a backflip (spends 2 steps).',
    params: { kind: { type: 'string', description: 'jump or backflip (salto o voltereta).', enum: ['jump', 'backflip'] }, worm: WORM },
    required: [],
  },
  {
    name: 'aim',
    description: 'Set the aim: angle is the elevation in degrees (-90 straight down, 0 level, 90 straight up), or change moves it up (+) or down (-) by that many degrees.',
    params: { angle: { type: 'number', description: 'Elevation in degrees, -90..90.' }, change: { type: 'number', description: 'Degrees to move the aim by, positive is up.' }, worm: WORM },
    required: [],
  },
  {
    name: 'weapon_menu',
    description: 'Open or close the weapon panel on screen ("abre el menú de armas", "cierra el menú"), so the player sees every weapon, its ammo and which ones are locked. Then select_weapon picks one; the panel closes on its own after the pick.',
    params: { action: { type: 'string', description: 'open or close (abrir o cerrar).', enum: ['open', 'close'] } },
    required: [],
  },
  {
    name: 'select_weapon',
    description: 'Put a weapon in the worm\'s hands (the weapon panel, by voice).',
    params: { weapon: WEAPON, worm: WORM },
    required: ['weapon'],
  },
  {
    name: 'fire',
    description: 'Fire the weapon in hand at the current aim. power is 0-100 (full when left out). Weapons called from the sky (air strike, teleport, meteorito) need a target worm.',
    params: { power: { type: 'number', description: 'Charge 0-100, default 100.' }, target: { type: 'string', description: 'Enemy worm name, for the weapons that need a target point.' }, worm: WORM },
    required: [],
  },
  {
    name: 'ai_attack',
    description:
      'The worm lets the AI work out the best shot: it scans the enemies (a calculating animation plays), picks the target, walks if that helps, aims, charges and fires. Use it whenever the player says "use X", "attack", "dispara con todo", "utiliza Kamehameha". battle_cry is the line the worm shouts in a comic bubble before firing: make it short and fun, in the player\'s language.',
    params: { weapon: WEAPON, target: { type: 'string', description: 'Enemy worm to go for (optional; the AI picks otherwise).' }, battle_cry: { type: 'string', description: 'Short line the worm shouts (max 80 characters).' }, worm: WORM },
    required: [],
  },
  {
    name: 'detonate',
    description: 'Set off the team\'s sheep while it runs ("¡detona la oveja!", "¡explota!"), like a second press of fire. Only while a sheep of the team is running after it was fired.',
    params: {},
    required: [],
  },
  {
    name: 'skip_turn',
    description: 'Pass the turn.',
    params: {},
    required: [],
  },
  {
    name: 'stop',
    description: 'Stop whatever the worm is doing on command (a walk, an aim, a charge).',
    params: {},
    required: [],
  },
  {
    name: 'shout',
    description: 'The worm whose turn it is shouts a line in a comic bubble (taunts, battle cries).',
    params: { text: { type: 'string', description: 'What it shouts, max 80 characters.' } },
    required: ['text'],
  },
] satisfies readonly ToolDef[]);

/** JSON Schema of a tool's input, for WebMCP and the ElevenLabs agent. */
export function inputSchema(def: ToolDef, withEnums = true): { type: 'object'; properties: Record<string, Record<string, unknown>>; required: string[] } {
  const properties: Record<string, Record<string, unknown>> = {};
  for (const [key, param] of Object.entries(def.params)) {
    properties[key] = { type: param.type, description: param.description, ...(withEnums && param.enum !== undefined ? { enum: [...param.enum] } : {}) };
  }
  return { type: 'object', properties, required: [...def.required] };
}

const str = (args: Readonly<Record<string, unknown>>, key: string): string | undefined => {
  const value = args[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
};

const num = (args: Readonly<Record<string, unknown>>, key: string): number | undefined => {
  const value = args[key];
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
  return Number.isFinite(n) ? n : undefined;
};

/** left or right, in either language; null when it is neither. */
export function direction(raw: string | undefined): -1 | 1 | null {
  if (raw === undefined) return null;
  const word = fold(raw);
  if (/\b(left|izquierda|izq)\b/.test(word)) return -1;
  if (/\b(right|derecha|der)\b/.test(word)) return 1;
  return null;
}

/** A worm by name, folded and forgiving ("raul" is Raúl); the closest prefix when nothing matches exactly. */
export function findWormByName(worms: readonly BattleWorm[], name: string): BattleWorm | null {
  const wanted = fold(name);
  if (wanted === '') return null;
  const exact = worms.find((w) => fold(w.name) === wanted);
  if (exact !== undefined) return exact;
  const inside = worms.find((w) => ` ${wanted} `.includes(` ${fold(w.name)} `));
  if (inside !== undefined) return inside;
  return worms.find((w) => fold(w.name).startsWith(wanted) || wanted.startsWith(fold(w.name))) ?? null;
}

function describe(view: BattleView): string {
  const lines: string[] = [];
  lines.push(view.humanTurn ? `Turn ${view.turn}: ${view.activeWorm ?? '?'} of ${view.activeTeam ?? '?'} is up (${view.phase}), ${view.stepsLeft} steps left, aim ${Math.round(view.aimDeg)}°, ${view.weaponInHand ?? 'nothing'} in hand, wind ${view.wind}.` : `Turn ${view.turn}: ${view.activeTeam ?? '?'} (the CPU) is playing; wait for a human turn.`);
  const teams = new Map<string, BattleWorm[]>();
  for (const worm of view.worms) teams.set(worm.team, [...(teams.get(worm.team) ?? []), worm]);
  for (const [team, worms] of teams) lines.push(`${team}: ${worms.map((w) => (w.alive ? `${w.name} ${w.hp}hp at x${Math.round(w.x)}${w.active ? ' (up)' : ''}` : `${w.name} dead`)).join(', ')}`);
  if (view.humanTurn) {
    const ready = view.weapons.filter((w) => w.ready).map((w) => `${w.name}${w.count >= 0 ? ` x${w.count}` : ''}`);
    const resting = view.weapons.filter((w) => !w.ready && w.count !== 0).map((w) => w.name);
    lines.push(`Can use: ${ready.join(', ')}.`);
    if (resting.length > 0) lines.push(`Not yet: ${resting.join(', ')}.`);
  }
  return lines.join('\n');
}

const answer = (result: CommandResult): ToolAnswer => ({ ok: result.ok, text: result.text });

/**
 * A worm named in the call that is not the one up gets picked first ("Raúl, ..."): only one of the
 * team whose turn it is, and only before the turn's worm has moved.
 */
function bringUp(api: GameApi, view: BattleView, name: string | undefined): ToolAnswer | null {
  if (name === undefined) return null;
  const worm = findWormByName(view.worms, name);
  if (worm === null) return { ok: false, text: `There is no worm called ${name}. Worms: ${view.worms.filter((w) => w.alive).map((w) => w.name).join(', ')}.` };
  if (worm.active) return null;
  if (worm.teamId !== view.activeTeamId) return { ok: false, text: `${worm.name} is on ${worm.team}, and it is ${view.activeTeam}'s turn (${view.activeWorm} is up).` };
  const picked = api.command({ kind: 'select', wormId: worm.id });
  return picked.ok ? null : answer(picked);
}

/** Runs one tool by name with the agent's arguments; never throws. */
export function runTool(api: GameApi, name: string, args: Readonly<Record<string, unknown>> = {}): ToolAnswer {
  // The clicks work on every screen, the title and the team setup included.
  if (name === 'get_screen') {
    const screen = api.screen();
    return { ok: true, text: `Screen: ${screen.screen}. Buttons: ${screen.buttons.map((b) => `${b.id} = ${b.label}${b.enabled ? '' : ' [disabled]'}`).join('; ')}.` };
  }
  if (name === 'press_button') {
    const button = str(args, 'button');
    return button === undefined ? { ok: false, text: 'Which button?' } : api.press(button);
  }
  if (name === 'camera') {
    const zoom = fold(str(args, 'zoom') ?? '');
    const look = fold(str(args, 'look') ?? '');
    const z = /^(in|acerca|mas|zoom in|cerca)/.test(zoom) ? 'in' : /^(out|aleja|menos|lejos)/.test(zoom) ? 'out' : null;
    const l = (['left', 'right', 'up', 'down', 'worm'] as const).find((d) => d === look) ?? (look === 'izquierda' ? 'left' : look === 'derecha' ? 'right' : look === 'arriba' ? 'up' : look === 'abajo' ? 'down' : look === 'gusano' ? 'worm' : null);
    if (z === null && l === null) return { ok: false, text: 'Zoom in or out, or look left, right, up, down or at the worm?' };
    return api.camera(z, l);
  }
  const view = api.view();
  if (name === 'click_map') {
    if (view === null) return { ok: false, text: 'There is no map on screen: start a match first.' };
    const wormName = str(args, 'worm');
    if (wormName !== undefined) {
      const worm = findWormByName(view.worms, wormName);
      if (worm === null) return { ok: false, text: `There is no worm called ${wormName}.` };
      return api.clickMap({ x: worm.x, y: worm.y - 10 });
    }
    const x = num(args, 'x');
    const y = num(args, 'y');
    if (x === undefined || y === undefined) return { ok: false, text: 'Click where? Give a worm or x and y.' };
    return api.clickMap({ x, y });
  }
  if (view === null) return { ok: false, text: 'No match is being played yet: start one from the title screen.' };
  if (name === 'get_battle_state') return { ok: true, text: describe(view) };
  if (name === 'stop') return answer(api.command({ kind: 'stop' }));
  if (name === 'detonate') return answer(api.command({ kind: 'detonate' }));
  if (name === 'weapon_menu') {
    const open = !/^(close|cerrar|cierra|closed)/.test(fold(str(args, 'action') ?? 'open'));
    if (!api.menu(open)) return { ok: false, text: open ? 'The weapon panel opens only on your turn, before the shot.' : 'The weapon panel is already closed.' };
    if (!open) return { ok: true, text: 'Weapon panel closed.' };
    const ready = view.weapons.filter((w) => w.ready).map((w) => w.name);
    return { ok: true, text: `Weapon panel open. ${view.activeWorm ?? 'The worm'} can use: ${ready.join(', ')}.` };
  }
  if (name === 'shout') {
    const text = str(args, 'text');
    if (text === undefined) return { ok: false, text: 'Nothing to shout.' };
    api.say(text.slice(0, 80));
    return { ok: true, text: `${view.activeWorm ?? 'The worm'} shouts it.` };
  }
  if (!view.humanTurn) return { ok: false, text: `It is ${view.activeTeam ?? 'the CPU'}'s turn, not a human one: wait for yours.` };

  if (name === 'choose_worm') {
    const wanted = str(args, 'worm');
    if (wanted === undefined) return { ok: false, text: 'Which worm?' };
    const worm = findWormByName(view.worms, wanted);
    if (worm === null) return { ok: false, text: `There is no worm called ${wanted}.` };
    if (worm.active) return { ok: true, text: `${worm.name} is already up. ¡Yo te elijo!` };
    if (worm.teamId !== view.activeTeamId) return { ok: false, text: `${worm.name} is on ${worm.team}; it is ${view.activeTeam}'s turn.` };
    return answer(api.command({ kind: 'select', wormId: worm.id }));
  }

  const up = bringUp(api, view, str(args, 'worm'));
  if (up !== null) return up;

  switch (name) {
    case 'walk': {
      const dir = direction(str(args, 'direction'));
      if (dir === null) return { ok: false, text: 'Walk left or right?' };
      return answer(api.command({ kind: 'walk', dir, steps: Math.max(1, Math.round(num(args, 'steps') ?? 1)) }));
    }
    case 'turn_around': {
      const dir = direction(str(args, 'direction'));
      if (dir === null) return { ok: false, text: 'Face left or right?' };
      return answer(api.command({ kind: 'face', dir }));
    }
    case 'jump':
      return answer(api.command({ kind: /back|volte|mortal|marom/.test(fold(str(args, 'kind') ?? '')) ? 'backflip' : 'jump' }));
    case 'aim': {
      const angle = num(args, 'angle');
      if (angle !== undefined) return answer(api.command({ kind: 'aim', angleDeg: angle }));
      const change = num(args, 'change');
      if (change !== undefined) return answer(api.command({ kind: 'aimBy', deltaDeg: change }));
      return { ok: false, text: 'Aim at what angle?' };
    }
    case 'select_weapon': {
      const raw = str(args, 'weapon');
      const id = raw === undefined ? null : resolveWeapon(raw);
      if (id === null) return { ok: false, text: `I do not know a weapon called ${raw ?? '(nothing)'}.` };
      return answer(api.command({ kind: 'weapon', id }));
    }
    case 'fire': {
      const power = num(args, 'power');
      const targetName = str(args, 'target');
      const target = targetName === undefined ? null : findWormByName(view.worms, targetName);
      if (targetName !== undefined && target === null) return { ok: false, text: `There is no worm called ${targetName}.` };
      return answer(api.command({ kind: 'fire', ...(power === undefined ? {} : { power: Math.max(0, Math.min(100, power)) / 100 }), ...(target === null ? {} : { targetPoint: { x: target.x, y: target.y } }) }));
    }
    case 'ai_attack': {
      const raw = str(args, 'weapon');
      const weapon = raw === undefined ? undefined : resolveWeapon(raw);
      if (weapon === null) return { ok: false, text: `I do not know a weapon called ${raw ?? ''}.` };
      const targetName = str(args, 'target');
      const target = targetName === undefined ? null : findWormByName(view.worms, targetName);
      if (targetName !== undefined && target === null) return { ok: false, text: `There is no worm called ${targetName}.` };
      const cry = str(args, 'battle_cry');
      return answer(api.command({ kind: 'auto', ...(weapon === undefined ? {} : { weapon }), ...(target === null ? {} : { targetWormId: target.id }), ...(cry === undefined ? {} : { message: cry }) }));
    }
    case 'skip_turn':
      return answer(api.command({ kind: 'skip' }));
    default:
      return { ok: false, text: `Unknown tool ${name}.` };
  }
}
