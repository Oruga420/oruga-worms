/**
 * The words a spoken order is made of, in Spanish and English: how a weapon is called out loud
 * ("bazuca", "la granada santa", "kame hame ha"), numbers said as words ("cinco pasos"), and the
 * folding that makes "Raúl" and "raul" the same name. Pure, shared by the local parser (parse.ts)
 * and the tools (tools.ts), which accept a weapon by id or by any of these names.
 */

import type { WeaponId } from '../weapons/types.ts';

/** Lower case, no accents, ñ as n, punctuation as spaces, single spaces. */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim();
}

/** Every way to call each weapon, folded. Longest names are tried first, so "granada santa" beats "granada". */
export const WEAPON_ALIASES: Readonly<Record<WeaponId, readonly string[]>> = Object.freeze({
  bazooka: ['bazooka', 'bazuca', 'bazuka', 'cohete', 'lanzacohetes', 'rocket'],
  homing_missile: ['homing missile', 'misil teledirigido', 'misil guiado', 'misil', 'homing'],
  mortar: ['mortar', 'mortero'],
  grenade: ['grenade', 'granada'],
  cluster_bomb: ['cluster bomb', 'bomba de racimo', 'bomba racimo', 'racimo', 'cluster'],
  banana_bomb: ['banana bomb', 'bomba banana', 'bomba platano', 'banana', 'platano'],
  holy_hand_grenade: ['holy hand grenade', 'granada santa', 'granada sagrada', 'granada bendita', 'holy grenade', 'holy'],
  dynamite: ['dynamite', 'dinamita', 'tnt'],
  tank: ['tank cannon', 'tanque', 'canon', 'tank'],
  napalm: ['napalm gun', 'napalm', 'lanzallamas'],
  handgun: ['handgun', 'pistola', 'pistol'],
  shotgun: ['shotgun', 'escopeta'],
  uzi: ['uzi', 'metralleta'],
  minigun: ['minigun', 'ametralladora'],
  longbow: ['longbow', 'arco', 'flecha', 'bow'],
  sonic_blast: ['sonic blast', 'onda sonica', 'sonico', 'sonic'],
  kamehameha: ['kamehameha', 'kame hame ha', 'kame hameha', 'kamehame ha', 'kamejameja', 'kame'],
  freezer: ['freezer', 'freeza', 'frieza', 'rayo mortal', 'death beam'],
  fire_punch: ['fire punch', 'puno de fuego', 'shoryuken', 'punetazo'],
  baseball_bat: ['baseball bat', 'bate de beisbol', 'bate', 'bat'],
  ryuko_ranbu: ['ryuko ranbu', 'ryuko', 'ranbu', 'super combo', 'combo'],
  gear_five: ['gear five', 'gear 5', 'gear cinco', 'quinto gear', 'nika', 'gear'],
  mine: ['mine', 'mina'],
  air_strike: ['air strike', 'ataque aereo', 'bombardeo', 'airstrike'],
  parachute: ['parachute', 'paracaidas'],
  jetpack: ['jetpack', 'jet pack', 'mochila cohete', 'mochila propulsora'],
  teleport: ['teleport', 'teletransporte', 'teletransportar', 'teletransportate'],
  girder: ['girder', 'viga'],
  skip_go: ['skip go'],
  sheep: ['sheep', 'oveja', 'ovejita', 'borrego', 'borrega', 'borreguito', 'chip', 'ship', 'shiip', 'chiip', 'la oveja'],
  saibaman: ['saibaman', 'saiba man', 'semilla'],
  antares: ['antares', 'aguja escarlata', 'scarlet needle', 'milo'],
  galaxian: ['explosion de galaxias', 'galaxian explosion', 'galaxias', 'galaxian', 'galaxia'],
  tenbu_horin: ['tesoro del cielo', 'tenbu horin', 'tenbu', 'shaka'],
  hiken: ['hiken', 'puno ardiente', 'fire fist', 'puno de fuego de ace'],
  meteor: ['meteorito', 'meteoro', 'meteor', 'fujitora'],
  santoryu: ['santoryu', 'santo ryu', 'tres espadas', 'three swords', 'zoro'],
  zoltraak: ['zoltraak', 'zoltrak', 'frieren'],
  final_explosion: ['explosion final', 'final explosion', 'big bang', 'vegeta'],
} satisfies Record<WeaponId, readonly string[]>);

interface AliasEntry {
  readonly alias: string;
  readonly id: WeaponId;
}

const ALIASES: readonly AliasEntry[] = Object.freeze(
  (Object.entries(WEAPON_ALIASES) as [WeaponId, readonly string[]][])
    .flatMap(([id, names]) => names.map((alias) => ({ alias: fold(alias), id })))
    .sort((a, b) => b.alias.length - a.alias.length),
);

/** Whole words: "mina" must not match inside "camina". */
function containsWords(haystack: string, needle: string): number {
  const at = ` ${haystack} `.indexOf(` ${needle} `);
  return at;
}

/** The weapon named in the text, with where it was said; an id ("gear_five") works as well. */
export function findWeapon(text: string): { readonly id: WeaponId; readonly at: number; readonly alias: string } | null {
  const folded = fold(text.replace(/_/g, ' '));
  const squashed = folded.replace(/ /g, '');
  let best: { id: WeaponId; at: number; alias: string } | null = null;
  for (const entry of ALIASES) {
    const at = containsWords(folded, entry.alias);
    if (at >= 0) {
      if (best === null || entry.alias.length > best.alias.length) best = { id: entry.id, at, alias: entry.alias };
    }
  }
  if (best !== null) return best;
  // "kame hame ha" heard as "kamehame ha" or run together: try without the spaces.
  for (const entry of ALIASES) {
    if (entry.alias.length >= 6 && squashed.includes(entry.alias.replace(/ /g, ''))) return { id: entry.id, at: 0, alias: entry.alias };
  }
  return null;
}

/** A weapon by id or by name, for the tools. */
export function resolveWeapon(name: string): WeaponId | null {
  return findWeapon(name)?.id ?? null;
}

const NUMBER_WORDS: Readonly<Record<string, number>> = Object.freeze({
  un: 1, uno: 1, una: 1, one: 1, a: 1,
  dos: 2, two: 2, par: 2,
  tres: 3, three: 3,
  cuatro: 4, four: 4,
  cinco: 5, five: 5,
  seis: 6, six: 6,
  siete: 7, seven: 7,
  ocho: 8, eight: 8,
  nueve: 9, nine: 9,
  diez: 10, ten: 10,
  once: 11, eleven: 11,
  doce: 12, twelve: 12,
  quince: 15, fifteen: 15,
  veinte: 20, twenty: 20,
  treinta: 30, thirty: 30,
  cuarenta: 40, forty: 40,
  cincuenta: 50, fifty: 50,
  sesenta: 60, sixty: 60,
  setenta: 70, seventy: 70,
  ochenta: 80, eighty: 80,
  noventa: 90, ninety: 90,
  cien: 100, hundred: 100,
});

/** The first number in the folded words, said in digits or as a word ("cinco", "five"); null when none. */
export function findNumber(words: readonly string[]): number | null {
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i] ?? '';
    const digits = /^(\d{1,3})%?$/.exec(word);
    if (digits !== null) return Number(digits[1]);
    // "a" counts as one only right before a step or a degree ("a step"), never as the Spanish preposition.
    if (word === 'a' && !/^(step|degree)/.test(words[i + 1] ?? '')) continue;
    const value = NUMBER_WORDS[word];
    if (value === undefined) continue;
    // "treinta y cinco"
    if (value >= 20 && value % 10 === 0 && words[i + 1] === 'y') {
      const unit = NUMBER_WORDS[words[i + 2] ?? ''];
      if (unit !== undefined && unit < 10) return value + unit;
    }
    return value;
  }
  return null;
}
