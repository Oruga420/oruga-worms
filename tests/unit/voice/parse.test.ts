import { describe, expect, it } from 'vitest';
import { parseUtterance } from '../../../src/voice/parse.ts';
import { findNumber, findWeapon, fold } from '../../../src/voice/lexicon.ts';

const NAMES = ['Rojo', 'Rita', 'Raúl', 'Ana', 'Azul', 'Ash'];

describe('lexicon', () => {
  it('folds accents and case', () => {
    expect(fold('¡Raúl, Cañón!')).toBe('raul canon');
  });
  it('finds weapons by their spoken names, longest first', () => {
    expect(findWeapon('saca la granada santa')?.id).toBe('holy_hand_grenade');
    expect(findWeapon('la granada')?.id).toBe('grenade');
    expect(findWeapon('kame hame ha')?.id).toBe('kamehameha');
    expect(findWeapon('Kamehameha')?.id).toBe('kamehameha');
    expect(findWeapon('gear 5')?.id).toBe('gear_five');
    expect(findWeapon('explosión final')?.id).toBe('final_explosion');
    expect(findWeapon('ataque aéreo')?.id).toBe('air_strike');
  });
  it('does not hear a mine inside "camina"', () => {
    expect(findWeapon('camina a la izquierda')).toBeNull();
  });
  it('reads numbers in digits and words', () => {
    expect(findNumber(['cinco', 'pasos'])).toBe(5);
    expect(findNumber(['a', 'la', 'izquierda', '7'])).toBe(7);
    expect(findNumber(['treinta', 'y', 'cinco', 'grados'])).toBe(35);
    expect(findNumber(['a', 'la', 'derecha'])).toBeNull();
  });
});

describe('parseUtterance', () => {
  it('picks the worm and lets the AI fire the Kamehameha', () => {
    expect(parseUtterance('Raúl, yo te elijo, utiliza Kamehameha', NAMES)).toEqual([
      { tool: 'choose_worm', args: { worm: 'Raúl' } },
      { tool: 'ai_attack', args: { weapon: 'kamehameha' } },
    ]);
  });
  it('walks counting the steps', () => {
    expect(parseUtterance('camina a la izquierda cinco pasos', NAMES)).toEqual([{ tool: 'walk', args: { direction: 'left', steps: 5 } }]);
    expect(parseUtterance('walk right 3 steps', NAMES)).toEqual([{ tool: 'walk', args: { direction: 'right', steps: 3 } }]);
  });
  it('chains orders: walk, change weapon, fire', () => {
    expect(parseUtterance('camina a la derecha 2 pasos, saca la escopeta y dispara', NAMES)).toEqual([
      { tool: 'walk', args: { direction: 'right', steps: 2 } },
      { tool: 'select_weapon', args: { weapon: 'shotgun' } },
      { tool: 'fire', args: {} },
    ]);
  });
  it('aims by angle and by nudges', () => {
    expect(parseUtterance('apunta a 30 grados', NAMES)).toEqual([{ tool: 'aim', args: { angle: 30 } }]);
    expect(parseUtterance('sube la mira 10', NAMES)).toEqual([{ tool: 'aim', args: { change: 10 } }]);
    expect(parseUtterance('baja la mira', NAMES)).toEqual([{ tool: 'aim', args: { change: -10 } }]);
  });
  it('attacks a named enemy with a weapon', () => {
    expect(parseUtterance('ataca a Ana con la granada', NAMES)).toEqual([{ tool: 'ai_attack', args: { weapon: 'grenade', target: 'Ana' } }]);
  });
  it('a worm named first is the one that acts', () => {
    expect(parseUtterance('Rita camina a la derecha 4 pasos', NAMES)).toEqual([
      { tool: 'choose_worm', args: { worm: 'Rita' } },
      { tool: 'walk', args: { direction: 'right', steps: 4 } },
    ]);
  });
  it('jumps, flips, passes and stops', () => {
    expect(parseUtterance('salta', NAMES)).toEqual([{ tool: 'jump', args: { kind: 'jump' } }]);
    expect(parseUtterance('haz una voltereta', NAMES)).toEqual([{ tool: 'jump', args: { kind: 'backflip' } }]);
    expect(parseUtterance('pasa el turno', NAMES)).toEqual([{ tool: 'skip_turn', args: {} }]);
    expect(parseUtterance('alto', NAMES)).toEqual([{ tool: 'stop', args: {} }]);
  });
  it('fires with a power', () => {
    expect(parseUtterance('dispara al 60 por ciento', NAMES)).toEqual([{ tool: 'fire', args: { power: 60 } }]);
  });
  it('opens and closes the weapon menu, and picks a weapon said on its own while it is open', () => {
    expect(parseUtterance('abre el menú de armas', NAMES)).toEqual([{ tool: 'weapon_menu', args: { action: 'open' } }]);
    expect(parseUtterance('cierra el menú', NAMES)).toEqual([{ tool: 'weapon_menu', args: { action: 'close' } }]);
    expect(parseUtterance('la escopeta', NAMES, { menuOpen: true })).toEqual([{ tool: 'select_weapon', args: { weapon: 'shotgun' } }]);
    expect(parseUtterance('abre las armas y la oveja', NAMES)).toEqual([
      { tool: 'weapon_menu', args: { action: 'open' } },
      { tool: 'select_weapon', args: { weapon: 'sheep' } },
    ]);
  });
  it('sets the sheep off instead of picking it', () => {
    expect(parseUtterance('¡detona la oveja!', NAMES)).toEqual([{ tool: 'detonate', args: {} }]);
    expect(parseUtterance('explota', NAMES)).toEqual([{ tool: 'detonate', args: {} }]);
    expect(parseUtterance('saca la oveja y dispara', NAMES)).toEqual([
      { tool: 'select_weapon', args: { weapon: 'sheep' } },
      { tool: 'fire', args: {} },
    ]);
  });
  it('turns the screens\' buttons into presses, and a click on a worm into a map click', () => {
    expect(parseUtterance('empieza', [])).toEqual([{ tool: 'press_button', args: { button: 'start' } }]);
    expect(parseUtterance('pausa', NAMES)).toEqual([{ tool: 'press_button', args: { button: 'pause' } }]);
    expect(parseUtterance('continua', NAMES)).toEqual([{ tool: 'press_button', args: { button: 'resume' } }]);
    expect(parseUtterance('otra partida', NAMES)).toEqual([{ tool: 'press_button', args: { button: 'restart' } }]);
    expect(parseUtterance('cambia el mapa y más equipos', [])).toEqual([
      { tool: 'press_button', args: { button: 'map' } },
      { tool: 'press_button', args: { button: 'add' } },
    ]);
    expect(parseUtterance('clic en Ana', NAMES)).toEqual([{ tool: 'click_map', args: { worm: 'Ana' } }]);
    expect(parseUtterance('acerca la cámara', NAMES)).toEqual([{ tool: 'camera', args: { zoom: 'in' } }]);
  });
});
