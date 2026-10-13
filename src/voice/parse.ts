/**
 * The local ear: a spoken order, as the browser's speech recognition heard it, into the same tool
 * calls the voice agent would make. Used when there is no ElevenLabs agent (speech.ts), so playing
 * by voice needs no key at all. Spanish first, English too:
 *
 *   "Raúl, yo te elijo, utiliza Kamehameha"  -> choose_worm Raúl, ai_attack kamehameha
 *   "camina a la izquierda cinco pasos"       -> walk left 5
 *   "saca la escopeta y dispara"              -> select_weapon shotgun, fire
 *   "apunta a 30 grados", "sube la mira 10"   -> aim 30, aim +10
 *   "ataca a Ana con la granada"              -> ai_attack grenade at Ana
 *
 * Pure: text and the worm names in play in, calls out. Unit tested.
 */

import type { WeaponId } from '../weapons/types.ts';
import { findNumber, findWeapon, fold } from './lexicon.ts';

export interface ToolCall {
  readonly tool: string;
  readonly args: Readonly<Record<string, string | number>>;
}

/** Splits an utterance into clauses at commas, "y", "luego", "después", "then", "and". */
function clauses(text: string): string[] {
  return text
    .split(/[,.;!?]+|\s+(?:y luego|y despues|y después|luego|despues|después|entonces|then|and then|y|and)\s+/i)
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

function has(folded: string, pattern: RegExp): boolean {
  return pattern.test(folded);
}

const WALK = /\b(camina|caminar|camine|avanza|avanzar|muevete|mueve|moverte|anda|ve|vete|corre|walk|move|go|steps?|pasos?)\b/;
const TURN = /\b(voltea|voltearte|gira|girate|mira hacia|mira a la|date la vuelta|turn|face)\b/;
const BACKFLIP = /\b(voltereta|mortal|marometa|maroma|backflip|back flip|pirueta)\b/;
const JUMP = /\b(salta|saltar|brinca|brincar|brinco|salto|jump|hop)\b/;
const SKIP = /\b(pasa el turno|pasa turno|salta el turno|saltar turno|paso|skip|pass|termina el turno)\b/;
const STOP = /\b(alto|detente|para ya|stop|quieto|espera|cancela)\b/;
const CHOOSE = /\b(yo te elijo|te elijo|elijo a|escojo a|te escojo|i choose you|choose)\b/;
const AUTO = /\b(utiliza|utilizar|usa|usar|lanza|lanzale|ataca|atacar|ataque|attack|use|haz|hazle|tirale|dale|acaba con|mata|destruye|con ia|con la ia|automatico|mejor tiro|best shot|ai)\b/;
const SELECT = /\b(saca|sacar|cambia|cambiar|cambiate|equipa|equipar|agarra|toma|selecciona|elige el|elige la|ponte|switch|select|equip|take|pick)\b/;
const FIRE = /\b(dispara|disparar|disparale|fuego|fire|shoot|suelta|tira|tirar|lanzalo|lanza)\b/;
const AIM = /\b(apunta|apuntar|mira|aim|angulo|grados?|degrees?)\b/;
const DETONATE = /\b(detona|detonar|detonala|detonalo|explota|explotala|explotalo|explotar|revienta|reventar|revientala|truena|tronala|bum|boom|kaboom|detonate|blow it|blow up)\b/;
const MENU = /\b(menu|armas|arsenal|inventario|weapons|inventory|arms)\b/;
const MENU_CLOSE = /\b(cierra|cerrar|cierralo|oculta|ocultar|quita|close|hide)\b/;
const MENU_OPEN = /\b(abre|abrir|abrelo|muestra|mostrar|muestrame|ensename|ver|open|show)\b/;
/** The buttons of the screens, said out loud: each becomes a press_button (voice/screen.ts). */
const SCREEN_ORDERS: readonly { readonly pattern: RegExp; readonly button: string }[] = Object.freeze([
  { pattern: /\b(otra partida|jugar de nuevo|juega otra vez|otra vez|revancha|play again|restart|reinicia|reiniciar)\b/, button: 'restart' },
  { pattern: /\b(me rindo|rendirse|rindete|surrender)\b/, button: 'surrender' },
  { pattern: /\b(reanuda|reanudar|continua|continuar|resume|unpause|quita la pausa)\b/, button: 'resume' },
  { pattern: /\b(pausa|pausar|pause)\b/, button: 'pause' },
  { pattern: /\b(opciones|options|ajustes|settings)\b/, button: 'options' },
  { pattern: /\b(regresa|regresar|volver|vuelve|back)\b/, button: 'back' },
  { pattern: /\b(empieza|empezar|comienza|comenzar|inicia|iniciar|arranca|jugar|start|play)\b/, button: 'start' },
  { pattern: /\b(cambia el mapa|otro mapa|siguiente mapa|next map|mapa)\b/, button: 'map' },
  { pattern: /\b(mas equipos|agrega un equipo|agrega equipo|more teams|add team)\b/, button: 'add' },
  { pattern: /\b(menos equipos|quita un equipo|quita equipo|fewer teams|remove team)\b/, button: 'remove' },
]);
const CLICK = /\b(clic|click|clickea|cliquea|picale|toca|tap)\b/;
const ZOOM_IN = /\b(acerca la camara|acercate|zoom in|mas cerca|acercar)\b/;
const ZOOM_OUT = /\b(aleja la camara|alejate|zoom out|mas lejos|alejar)\b/;
const UP = /\b(sube|subir|arriba|mas alto|up|raise|higher)\b/;
const DOWN = /\b(baja|bajar|abajo|mas bajo|down|lower)\b/;

function dirOf(folded: string): 'left' | 'right' | null {
  if (/\b(izquierda|izq|left)\b/.test(folded)) return 'left';
  if (/\b(derecha|der|right)\b/.test(folded)) return 'right';
  if (/\b(atras|back|backwards)\b/.test(folded)) return null;
  return null;
}

/** Worm names said in the clause, in order, as they are spelled in the game. */
function wormsSaid(folded: string, names: readonly string[]): string[] {
  const out: { name: string; at: number }[] = [];
  for (const name of names) {
    const key = fold(name);
    if (key === '') continue;
    const at = ` ${folded} `.indexOf(` ${key} `);
    if (at >= 0) out.push({ name, at });
  }
  return out.sort((a, b) => a.at - b.at).map((n) => n.name);
}

export interface ParseContext {
  /** The weapon panel is open: a weapon said on its own picks it instead of attacking with it. */
  readonly menuOpen?: boolean;
}

/**
 * Turns an utterance into tool calls. names are the worms in play, so "Raúl, ..." picks Raúl and
 * "ataca a Ana" aims at Ana; a worm named before any order picks it for the turn.
 */
export function parseUtterance(text: string, names: readonly string[], context: ParseContext = {}): ToolCall[] {
  let menuOpen = context.menuOpen === true;
  const calls: ToolCall[] = [];
  let lastWeapon: WeaponId | null = null;
  let chosen: string | null = null;
  const choose = (name: string): void => {
    if (chosen === name) return;
    chosen = name;
    calls.push({ tool: 'choose_worm', args: { worm: name } });
  };
  for (const clause of clauses(text)) {
    const folded = fold(clause);
    if (folded === '') continue;
    const words = folded.split(' ');
    const named = wormsSaid(folded, names);
    const weapon = findWeapon(folded);
    const weaponId = weapon?.id ?? null;

    // "¡Detona la oveja!": the sheep goes off, it is not a weapon to pick.
    if (has(folded, DETONATE)) {
      calls.push({ tool: 'detonate', args: {} });
      continue;
    }
    if (has(folded, ZOOM_IN) || has(folded, ZOOM_OUT)) {
      calls.push({ tool: 'camera', args: { zoom: has(folded, ZOOM_IN) ? 'in' : 'out' } });
      continue;
    }
    // "Clic en Ana": the map at that worm (an air strike, a teleport, the Meteorito once picked).
    if (has(folded, CLICK) && named[0] !== undefined) {
      calls.push({ tool: 'click_map', args: { worm: named[0] } });
      continue;
    }
    const screenOrder = weaponId === null && named.length === 0 ? SCREEN_ORDERS.find((order) => has(folded, order.pattern)) : undefined;
    if (screenOrder !== undefined) {
      calls.push({ tool: 'press_button', args: { button: screenOrder.button } });
      continue;
    }
    if (has(folded, MENU) && weaponId === null) {
      if (has(folded, MENU_CLOSE)) {
        menuOpen = false;
        calls.push({ tool: 'weapon_menu', args: { action: 'close' } });
        continue;
      }
      if (has(folded, MENU_OPEN) || words.length <= 3) {
        menuOpen = true;
        calls.push({ tool: 'weapon_menu', args: { action: 'open' } });
        continue;
      }
    }
    // With the panel up, a weapon said with no order ("la escopeta") is the one to take.
    if (menuOpen && weaponId !== null && !has(folded, AUTO) && !has(folded, FIRE)) {
      lastWeapon = weaponId;
      calls.push({ tool: 'select_weapon', args: { weapon: weaponId } });
      continue;
    }
    if (has(folded, STOP)) {
      calls.push({ tool: 'stop', args: {} });
      continue;
    }
    if (has(folded, SKIP) && !has(folded, FIRE)) {
      calls.push({ tool: 'skip_turn', args: {} });
      continue;
    }
    if (has(folded, CHOOSE)) {
      const who = named[0];
      if (who !== undefined) choose(who);
      // "yo te elijo" on its own clause after a name said in the one before: that one.
      else if (calls.length === 0 && chosen === null) continue;
      if (weaponId === null) continue;
    }

    // A clause that is only a name ("Raúl,") addresses that worm.
    if (named.length > 0 && words.length <= 2 && weaponId === null && !has(folded, WALK) && !has(folded, FIRE) && !has(folded, AUTO)) {
      const who = named[0];
      if (who !== undefined) choose(who);
      continue;
    }

    // An order that names the worm first ("Raúl camina..."): that worm.
    const first = named[0];
    const addressed = first !== undefined && ` ${folded}`.indexOf(` ${fold(first)} `) <= 1 ? first : undefined;
    if (addressed !== undefined) choose(addressed);
    const enemy = named.find((n) => n !== addressed && n !== chosen) ?? (addressed === undefined ? named[0] : undefined);

    if (has(folded, BACKFLIP)) {
      calls.push({ tool: 'jump', args: { kind: 'backflip' } });
      continue;
    }
    const dir = dirOf(folded);
    if (dir !== null && has(folded, TURN) && !has(folded, WALK)) {
      calls.push({ tool: 'turn_around', args: { direction: dir } });
      continue;
    }
    if (dir !== null && (has(folded, WALK) || words.length <= 3)) {
      calls.push({ tool: 'walk', args: { direction: dir, steps: findNumber(words) ?? 3 } });
      continue;
    }
    if (has(folded, JUMP) && !has(folded, /\bturno\b/)) {
      calls.push({ tool: 'jump', args: { kind: 'jump' } });
      continue;
    }
    if (weaponId !== null && has(folded, SELECT) && !has(folded, FIRE)) {
      lastWeapon = weaponId;
      calls.push({ tool: 'select_weapon', args: { weapon: weaponId } });
      continue;
    }
    if (weaponId !== null && (has(folded, AUTO) || has(folded, FIRE) || has(folded, CHOOSE) || words.length <= 3)) {
      lastWeapon = weaponId;
      calls.push({ tool: 'ai_attack', args: { weapon: weaponId, ...(enemy === undefined ? {} : { target: enemy }) } });
      continue;
    }
    if (has(folded, AUTO) && (enemy !== undefined || /\b(ia|ai|automatico|mejor|best)\b/.test(folded))) {
      calls.push({ tool: 'ai_attack', args: { ...(lastWeapon === null ? {} : { weapon: lastWeapon }), ...(enemy === undefined ? {} : { target: enemy }) } });
      continue;
    }
    if (has(folded, AIM) || has(folded, UP) || has(folded, DOWN)) {
      const n = findNumber(words);
      if (has(folded, UP) && !has(folded, /\b(a|en)\s+\d/)) {
        calls.push({ tool: 'aim', args: { change: n ?? 10 } });
        continue;
      }
      if (has(folded, DOWN) && !has(folded, /\b(a|en)\s+\d/)) {
        calls.push({ tool: 'aim', args: { change: -(n ?? 10) } });
        continue;
      }
      if (n !== null) {
        const negative = /\b(menos|minus|negativo)\b/.test(folded) || /-\s*\d/.test(clause);
        calls.push({ tool: 'aim', args: { angle: negative ? -n : n } });
        continue;
      }
    }
    if (has(folded, FIRE)) {
      const n = /\b(potencia|power|fuerza|al)\b/.test(folded) || /%/.test(clause) ? findNumber(words) : null;
      calls.push({ tool: 'fire', args: { ...(n === null ? {} : { power: n }), ...(enemy === undefined ? {} : { target: enemy }) } });
      continue;
    }
    if (weaponId !== null) {
      lastWeapon = weaponId;
      calls.push({ tool: 'select_weapon', args: { weapon: weaponId } });
    }
  }
  return calls;
}
