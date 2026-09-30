/**
 * Boot (Phase 2.4, first playable): builds a quick 2 team game (red human, blue CPU) over a
 * procedural island, wires the renderer, camera, input and the game controller, and drives them
 * from the fixed timestep loop. The human moves with the arrows, aims with up and down, holds
 * Space to charge and releases to fire; the CPU plays its turns through the same fire path with
 * the heuristic backend (the model backend joins when the sidecar is reachable).
 *
 * Kept for the Playwright smoke: the "Orugas boot" console line and the dev only window.__orugas
 * hook, extended with the terrain solid pixel count and a fireBazooka helper so the smoke can
 * assert a shot carves the terrain.
 */

import { CANVAS_IDS, WORLD_SIZE_DEFAULT } from './config/constants.ts';
import { AUDIO_TARGETS, DEFAULT_SETTINGS, isAudioTarget, withAudio, withKeybinds, type Settings } from './persistence/save-schema.ts';
import { loadSettings, saveSettings, storageOrNull } from './persistence/settings.ts';
import { SIM_HZ } from './config/units.ts';
import { createLoop, createRafScheduler } from './core/loop.ts';
import { createRng, seedFromString } from './core/rng.ts';
import { createCamera, follow, moveTo, screenToWorld, shake, updateCamera, worldToScreen, zoomBy, type Camera } from './engine/camera.ts';
import type { Size } from './engine/canvas-types.ts';
import { bindDomInput } from './engine/input-dom.ts';
import { createInputController } from './engine/input.ts';
import { createParticleSystem, drawParticles, spawnExplosion } from './engine/particles.ts';
import { createRenderer } from './engine/renderer.ts';
import { createBrowserMixerDeps, createMixer } from './engine/audio.ts';
import { assetUrl } from './engine/asset-url.ts';
import { createCpuClient } from './ai/client.ts';
import { createController, type Controller, type ControllerOptions } from './game/controller.ts';
import { drawGame, teamColor, type CharacterSprites, type Scratch } from './game/render.ts';
import { createGore, drawGore, drawLens, goreEnabledFromSearch, resetGore, updateGore } from './game/gore.ts';
import { advanceFx, applyFxEvents, createFx, drawFxScreen, drawFxWorld, noteWeapon, wormAnim, type FxDeps, type FxState } from './game/fx.ts';
import { cinematicFor } from './game/cinematic.ts';
import { GAME_CONFIG } from './config/game-config.ts';
import { loadAtlas } from './engine/atlas.ts';
import { drawHud, hudKey } from './game/hud.ts';
import { pickMatchSeed, pickRestartSeed } from './game/match-seed.ts';
import { hitTestWeaponPanel, isInsideWeaponPanel, layoutWeaponPanel, type PanelLayout } from './game/weapon-panel.ts';
import { drawPauseScreen, hitTestPause, layoutPauseScreen, type PauseLayout } from './ui/screens/pause.ts';
import { buildScoreboard } from './ui/screens/end-screen.ts';
import { drawOptionsScreen, hitTestOptions, layoutOptionsScreen, type OptionsAction, type OptionsLayout } from './ui/screens/options.ts';
import { rebind, shiftedKeyCode, type Action, type Keybinds } from './config/keybinds.ts';
import { drawEndScreen, drawTitleScreen, hitTestTitle, layoutTitleScreen, type TitleLayout } from './game/screens.ts';
import { DEVICE_KEY, resolveDeviceMode, type DeviceMode } from './config/device.ts';
import { createTouchControls, type TouchControlsView } from './ui/touch-controls.ts';
import { createFrameOverlay, overlayEnabledFromSearch } from './engine/frame-overlay.ts';
import { createSoundDirector } from './game/sound.ts';
import { INITIAL_DIRECTOR, updateCameraTarget, type CameraDirector } from './game/camera-target.ts';
import { clampPan } from './engine/audio.ts';
import { buildGame, quickGame } from './game/setup.ts';
import {
  DEFAULT_TEAM_SETUP,
  drawTeamSetup,
  hitTestTeamSetup,
  layoutTeamSetup,
  reduceTeamSetup,
  toMatchSetup,
  type TeamSetupLayout,
  type TeamSetupState,
} from './ui/screens/team-setup.ts';
import type { MatchState } from './match/state.ts';
import { aliveTeams } from './match/win.ts';
import { DEFAULT_MATCH_CONFIG } from './match/deps.ts';
import { createDomContextFactory } from './terrain/context.ts';
import { WEAPONS, WEAPON_IDS } from './weapons/registry.ts';
import { solidCount } from './terrain/terrain.ts';
import { firstSolidBelow } from './terrain/queries.ts';
import { findWorm as findBody } from './sim/world.ts';
import type { DevourBeat, HexBeat } from './sim/types.ts';
import { WORM_HEIGHT } from './sim/constants.ts';
import { muzzlePoint } from './weapons/behaviors/types.ts';
import { pickCrateColumn, spawnCrate } from './sim/crate.ts';
import { activeTeamOf, activeWormOf } from './match/ledger.ts';
import { fire } from './weapons/fire.ts';

/** How hard each beat of Gear 5 shakes the camera: the drums and the awakening hardest. */
const DEVOUR_SHAKE: Readonly<Record<DevourBeat, number>> = Object.freeze({ drum: 3.5, awake: 7, stretch: 0, grab: 1.5, snap: 0, chomp: 2.5, gulp: 4, burp: 3 });
/** How hard each beat of the Freezer shakes the camera: the throbs harder and harder, the burst hardest (its blast shakes too). */
const HEX_SHAKE: Readonly<Record<HexBeat, number>> = Object.freeze({ shot: 1.5, enter: 3, fizzle: 1, pulse: 1.5, burst: 8 });

interface OrugasDebug {
  readonly frames: () => number;
  readonly ticks: () => number;
  readonly simHz: number;
  readonly solidCount: () => number;
  readonly phase: () => string;
  readonly fireBazooka: (angleDeg?: number, power?: number) => void;
  readonly forceWin: () => void;
  readonly fireAll: () => readonly { weapon: string; ok: boolean; error?: string }[];
  /** Weapon panel and movement budget, for the smoke test: what the HUD shows, not a shortcut around it. */
  readonly selectedWeapon: () => string;
  readonly inventory: () => { activeId: string; fuseMs: number | null; worms: readonly { id: string; ammo: Readonly<Record<string, number>> }[]; drops: readonly { kind: string; landed: boolean }[] };
  readonly stepsRemaining: () => number;
  /** The match seed in play, so a test can prove ?seed=N pins the map. */
  readonly seed: () => number;
  /** The active worm's sim body, for diagnosing movement stalls (backlog 4.5). */
  readonly activeBody: () => { x: number; y: number; vx: number; vy: number; motion: string; onGround: boolean; fuelMs: number } | null;
  /** The settings in play (audio levels and key bindings), as loaded from storage at boot. */
  readonly settings: () => Settings;
  /** Pause overlay state and its button rects, so a test can pause with the key and click a real button. */
  readonly paused: () => boolean;
  /** The end screen's per team rows, winner first, so a test can check the scoreboard after a match. */
  readonly scoreboard: () => readonly { name: string; winner: boolean; points: number; aliveWorms: number }[];
  /** The turn clock in ms; it must hold while paused and run otherwise. */
  readonly turnRemainingMs: () => number;
  /** Options screen state and cells, and the live key bindings, for the smoke. */
  readonly optionsOpen: () => boolean;
  readonly optionsCells: () => readonly { id: string; x: number; y: number; w: number; h: number }[];
  readonly keybinds: () => Keybinds;
  /** Frames in the weapon atlas once it has loaded (0 before), so a test can prove the art shipped. */
  readonly weaponFrames: () => number;
  /** Picks a weapon by id through the controller's own guard (ammo, scheme delay); unknown ids are ignored. */
  readonly selectWeapon: (id: string) => void;
  /** 'desktop' or 'touch', as picked on the title screen, and the title's device buttons. */
  readonly deviceMode: () => string;
  readonly titleCells: () => readonly { id: string; x: number; y: number; w: number; h: number }[];
  /** The app screen ('menu', 'setup' or 'playing') and the team setup card's cells. */
  readonly appPhase: () => string;
  readonly teamSetupCells: () => readonly { id: string; x: number; y: number; w: number; h: number }[];
  readonly teamControllers: () => readonly string[];
  /** Options card rect, so a test can check it stays on screen. */
  readonly optionsCard: () => { x: number; y: number; w: number; h: number } | null;
  /** The action a clicked key row is waiting to rebind, armed on the tick after the click; null when none. */
  readonly optionsListening: () => string | null;
  readonly pauseCells: () => readonly { id: string; x: number; y: number; w: number; h: number }[];
  /** Sets one audio bus level, applies it to the mixer and persists it; false when nothing could be saved. */
  readonly setVolume: (target: string, level: number) => boolean;
  readonly panelOpen: () => boolean;
  /** Screen rects of the open panel's cells (empty when closed), so a test can click a real cell. */
  readonly panelCells: () => readonly { id: string; x: number; y: number; w: number; h: number; enabled: boolean }[];
  readonly dropCrate: () => void;
  readonly drownOne: () => boolean;
  readonly crateCount: () => number;
  readonly forceSuddenDeath: () => void;
  readonly suddenDeath: () => boolean;
  /** 'human' or 'cpu' for the team whose turn it is. */
  readonly activeController: () => string;
  readonly turn: () => number;
  readonly endTurn: () => void;
  /** Rolling average frame cost in ms, the same number the overlay draws. */
  readonly frameMs: () => number;
  readonly dpr: () => number;
  /** Lifts a non-active worm and drops it; exempt mirrors the post blast landing exemption. */
  readonly dropWorm: (exempt: boolean) => string | null;
  readonly wormHp: (id: string) => number;
  readonly onGround: (id: string) => boolean;
  /** Worms still alive in the match ledger, which is the truth the HUD and win check read. */
  readonly aliveCount: () => number;
  /** Camera centre and the followed projectile, for verifying the camera rides the shot. */
  readonly cameraDebug: () => { camX: number; camY: number; projX: number | null; projY: number | null; focus: string };
  /** Fires any panel weapon from the active worm straight through the sim, like fireBazooka. */
  readonly fireWeapon: (id: string, angleDeg?: number, power?: number) => boolean;
  /** Parks the nearest enemy (or the one named) dx world px in front of the active worm, on the ground. */
  readonly lineUpEnemy: (dx?: number, id?: string) => string | null;
  /** Live gore: flying and lying bits, blood on the lens, stain rects painted into the land. */
  readonly goreCount: () => { bits: number; lens: number; stains: number };
  /** Live super moves in the sim. */
  readonly combos: () => number;
  /** Beam supers still playing. */
  readonly beams: () => number;
  /** Gear 5 meals still playing. */
  readonly devours: () => number;
  /** Live Freezer hexes in the sim. */
  readonly hexes: () => number;
  /** Degrees the crosshair sits above the line from the muzzle to that worm's centre (below is negative); null when either is missing. */
  readonly aimOffBy: (id: string) => number | null;
}

declare global {
  interface Window {
    __orugas?: OrugasDebug;
  }
}

/** The small offscreen canvas the renderer composites wounds, hit flashes and silhouettes on. */
function createScratch(): Scratch | null {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  return ctx === null ? null : { canvas, ctx, size: 128 };
}

function acquireCanvas(id: string): HTMLCanvasElement {
  const canvas = document.getElementById(id);
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error(`canvas #${id} is missing from index.html`);
  return canvas;
}

/** One sim tick in ms, for the camera director's hold timer. */
const TICK_MS_CAMERA = 1000 / SIM_HZ;
/** The camera's normal worm-follow smoothing, restored after a shot. */
const DEFAULT_FOLLOW_TAU_MS = 150;

function boot(): void {
  const stage = document.getElementById('stage');
  if (!(stage instanceof HTMLElement)) throw new Error('#stage is missing from index.html');

  const rendererResult = createRenderer({
    world: acquireCanvas(CANVAS_IDS.world),
    hud: acquireCanvas(CANVAS_IDS.hud),
    devicePixelRatio: () => window.devicePixelRatio || 1,
    cssSize: () => ({ w: stage.clientWidth, h: stage.clientHeight }),
  });
  if (!rendererResult.ok) throw new Error(rendererResult.error.message);
  const renderer = rendererResult.value;

  const contextFactory = createDomContextFactory(document);
  if (contextFactory === null) throw new Error('this browser has no 2D canvas context');

  // A fresh island and fresh spawns every game; ?seed=N pins one map for a test or a bug report.
  const randomBits = (target: Uint32Array): Uint32Array => window.crypto.getRandomValues(target);
  const built = quickGame(pickMatchSeed(window.location.search, randomBits), contextFactory, WORLD_SIZE_DEFAULT);
  if (!built.ok) throw new Error(`game setup failed: ${built.error.message}`);

  // Always build the client; it probes the sidecar once and the controller falls back to the
  // heuristic when there is no backend, so the static build plays with zero backend. game and
  // controller are reassigned on restart (R at the end screen), so the loop closures read them live.
  const cpuOptions: ControllerOptions = { cpu: { client: createCpuClient({}), registry: WEAPONS } };
  let game = built.value;
  let controller: Controller = createController(game, cpuOptions);

  // Audio: load the generated manifest and unlock the context on the first user gesture (browsers
  // block audio until then). The sound director maps game events and turns onto play calls.
  // Settings remembered between sessions: audio bus levels and key bindings. A missing or corrupt
  // record falls back to the defaults inside loadSettings, so boot never depends on it.
  const settingsStore = storageOrNull(() => window.localStorage);
  let settings: Settings = loadSettings(settingsStore).settings;
  // Keyboard and mouse, or the on screen touch controls: picked on the title screen, remembered,
  // and guessed from the pointer the first time (config/device.ts).
  const readStored = (): string | null => {
    try {
      return settingsStore?.getItem(DEVICE_KEY) ?? null;
    } catch {
      return null;
    }
  };
  let deviceMode: DeviceMode = resolveDeviceMode({
    search: window.location.search,
    stored: readStored(),
    coarsePointer: window.matchMedia?.('(pointer: coarse)').matches ?? false,
    maxTouchPoints: navigator.maxTouchPoints || 0,
  });
  const chooseDevice = (mode: DeviceMode): void => {
    deviceMode = mode;
    try {
      settingsStore?.setItem(DEVICE_KEY, mode);
    } catch {
      // Private mode or blocked storage: the pick holds for this session only.
    }
  };
  // Sounds load by versioned URL like the sprites: the files are served immutable (asset-url.ts).
  const browserMixerDeps = createBrowserMixerDeps();
  const mixer = createMixer({ ...browserMixerDeps, fetchBytes: (url) => browserMixerDeps.fetchBytes(assetUrl(url)) });
  for (const target of AUDIO_TARGETS) mixer.setVolume(target, settings.audio[target]);
  const soundReady = fetch(assetUrl('/audio/manifest.json'))
    .then((response) => (response.ok ? response.json() : null))
    .then((json) => {
      if (json === null) return;
      const loaded = mixer.loadManifest(json, '/');
      if (loaded.ok) void mixer.preload();
    })
    .catch(() => undefined);
  const unlock = (): void => {
    void mixer.unlock().then(() => soundDirector.startMusic(), () => undefined);
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  void soundReady;
  let lastSoundState: MatchState | null = null;
  let cameraDirector: CameraDirector = INITIAL_DIRECTOR;

  // The input controller and its DOM binder are rebuilt when the key bindings change (options
  // screen), so `input` is reassigned; the loop reads the current one each tick.
  let input = createInputController(settings.keybinds);
  let unbindInput = bindDomInput(input, { pointerTarget: stage, keyTarget: window, binds: settings.keybinds });
  const rebindInput = (binds: Keybinds): void => {
    unbindInput();
    input = createInputController(binds);
    unbindInput = bindDomInput(input, { pointerTarget: stage, keyTarget: window, binds });
  };
  // Touch mode's on screen buttons feed the live input controller the same key events a keyboard does.
  const touchControls = createTouchControls({
    root: stage,
    sink: () => input,
    binds: () => settings.keybinds,
    onRestart: () => {
      if (controller.state().phase === 'MatchEnd') restart();
    },
  });
  const particles = createParticleSystem();
  const rng = createRng(seedFromString('orugas-fx'));
  // Gore and the animation effects: presentation only, on the tick clock, reset with each match.
  const gore = createGore();
  gore.enabled = goreEnabledFromSearch(window.location.search);
  let fx: FxState = createFx();
  const scratch = createScratch();
  const onScreen = (x: number, y: number): boolean => {
    const viewport = renderer.viewport();
    const p = worldToScreen(camera, viewport, { x, y });
    return p.x >= -20 && p.x <= viewport.w + 20 && p.y >= -20 && p.y <= viewport.h + 20;
  };
  const fxDeps: FxDeps = { gore, particles, rng, onScreen };
  const hpOf = (wormId: string): number => {
    for (const team of controller.state().teams) for (const worm of team.worms) if (worm.id === wormId) return worm.hp;
    return 0;
  };
  const resetEffects = (): void => {
    resetGore(gore);
    particles.clear();
    fx = createFx();
  };
  const scheduler = createRafScheduler();

  let camera = createCamera({ x: WORLD_SIZE_DEFAULT.w / 2, y: WORLD_SIZE_DEFAULT.h / 2, bounds: WORLD_SIZE_DEFAULT });
  let frames = 0;
  let lastHudKey = '';
  // Weapon panel: Shift+Q or Tab toggles it, a click on a cell selects and closes. The layout is
  // rebuilt every tick it is open so its ammo badges and greyed cells track the ledger.
  let panelOpen = false;
  let panelLayout: PanelLayout | null = null;

  const soundDirector = createSoundDirector({
    mixer,
    has: (id) => mixer.manifest()?.assets[id] !== undefined,
    random: () => rng.next(),
    panAt: (x) => clampPan((x - camera.x) / (WORLD_SIZE_DEFAULT.w / 2)),
  });

  // Generated character sprites, one set per team colour index. Loaded in the background: a
  // failure leaves the map empty and the renderer falls back to the procedural worms, so a missing
  // or broken sheet can never stop the game booting.
  const sprites = new Map<number, CharacterSprites>();
  // The weapon atlas (panel icons and held layers) loads the same way; until it lands the panel
  // shows letter glyphs and the worm's fist stays empty.
  let weaponSprites: CharacterSprites | null = null;
  // The mouse in world px, sampled each tick for the targeted weapons' crosshair.
  let pointerWorld = { x: 0, y: 0 };
  // Mouse look: dragging on the stage pans the camera and holds it there for a moment before the
  // follow takes over again; a drag that moved is never a click, so it cannot fire a targeted weapon.
  let dragFrom: { x: number; y: number } | null = null;
  let dragDistancePx = 0;
  let freeLookUntilMs = 0;
  const DRAG_CLICK_TOLERANCE_PX = 6;
  const FREE_LOOK_HOLD_MS = 2500;
  void (async (): Promise<void> => {
    try {
      const response = await fetch(assetUrl('/sprites/weapons/atlas.json'));
      if (!response.ok) return;
      const json: unknown = await response.json();
      const image = new Image();
      await new Promise<void>((done, fail) => {
        image.onload = () => done();
        image.onerror = () => fail(new Error('weapon sheet failed'));
        image.src = assetUrl('/sprites/weapons/sheet.png');
      });
      const atlas = loadAtlas(json, image);
      if (atlas.ok) {
        weaponSprites = { atlas: atlas.value, image };
        renderer.markHudDirty();
      }
    } catch {
      // Glyphs and empty fists stay in place.
    }
  })();
  void (async (): Promise<void> => {
    const roster: readonly { readonly id: string; readonly team: number }[] = [
      { id: 'olive_commando', team: 0 },
      { id: 'teal_rookie', team: 1 },
      { id: 'ochre_veteran', team: 2 },
      { id: 'night_stealth', team: 3 },
    ];
    await Promise.all(
      roster.map(async (entry) => {
        try {
          const response = await fetch(assetUrl(`/sprites/${entry.id}/atlas.json`));
          if (!response.ok) return;
          const json: unknown = await response.json();
          const image = new Image();
          await new Promise<void>((done, fail) => {
            image.onload = () => done();
            image.onerror = () => fail(new Error(`sheet failed for ${entry.id}`));
            image.src = assetUrl(`/sprites/${entry.id}/sheet.png`);
          });
          const atlas = loadAtlas(json, image);
          if (atlas.ok) sprites.set(entry.team, { atlas: atlas.value, image });
        } catch {
          // Fallback worms stay in place for this character.
        }
      }),
    );
    renderer.markHudDirty();
  })();

  // The app starts on a title screen; the match freezes until the player starts it.
  // Title, then the team setup card, then the match. The boot game above is what the setup screen
  // is drawn over; Start rebuilds it from the chosen teams.
  let appPhase: 'menu' | 'setup' | 'playing' = 'menu';
  let titleLayout: TitleLayout | null = null;
  let teamSetup: TeamSetupState = DEFAULT_TEAM_SETUP;
  let teamSetupLayout: TeamSetupLayout | null = null;
  // Pause: Escape or P while playing. While paused the controller is not ticked, so the turn
  // clock and the sim hold; the overlay's layout is the only source of its button rectangles.
  let paused = false;
  let pauseLayout: PauseLayout | null = null;
  // Options: opened from the pause overlay, frozen like it. listeningFor is the action waiting for
  // its new key; optionsNotice is the one line message the screen shows (a refused duplicate).
  let optionsOpen = false;
  let optionsLayout: OptionsLayout | null = null;
  let listeningFor: Action | null = null;
  let optionsNotice: string | null = null;
  const optionsModel = () => ({ audio: settings.audio, keybinds: settings.keybinds, listening: listeningFor, notice: optionsNotice });
  const applyOptionsAction = (action: OptionsAction): void => {
    switch (action.kind) {
      case 'volume':
      case 'volumeStep': {
        const level = action.kind === 'volume' ? action.level : settings.audio[action.target] + action.delta;
        settings = withAudio(settings, action.target, Math.round(level * 20) / 20);
        mixer.setVolume(action.target, settings.audio[action.target]);
        saveSettings(settingsStore, settings);
        optionsNotice = null;
        break;
      }
      case 'rebind':
        listeningFor = action.action;
        optionsNotice = null;
        break;
      case 'reset':
        settings = DEFAULT_SETTINGS;
        for (const target of AUDIO_TARGETS) mixer.setVolume(target, settings.audio[target]);
        rebindInput(settings.keybinds);
        saveSettings(settingsStore, settings);
        listeningFor = null;
        optionsNotice = 'Defaults restored';
        break;
      case 'back':
        optionsOpen = false;
        listeningFor = null;
        optionsNotice = null;
        break;
    }
    renderer.markHudDirty();
  };
  const startMatch = (): void => {
    if (appPhase !== 'menu') return;
    appPhase = 'setup';
    titleLayout = null;
    renderer.markHudDirty();
  };

  /** Builds the match from the chosen teams and starts it; a rejected setup leaves the card up. */
  const beginMatch = (seed: number): void => {
    const setup = toMatchSetup(teamSetup, seed, WORLD_SIZE_DEFAULT);
    const rebuilt = buildGame({ setup, createContext: contextFactory });
    if (!rebuilt.ok) return;
    game = rebuilt.value;
    controller = createController(game, cpuOptions);
    camera = createCamera({ x: WORLD_SIZE_DEFAULT.w / 2, y: WORLD_SIZE_DEFAULT.h / 2, bounds: WORLD_SIZE_DEFAULT });
    lastSoundState = null;
    cameraDirector = INITIAL_DIRECTOR;
    resetEffects();
    panelOpen = false;
    panelLayout = null;
    paused = false;
    pauseLayout = null;
    optionsOpen = false;
    optionsLayout = null;
    listeningFor = null;
    appPhase = 'playing';
    renderer.markHudDirty();
  };

  // Frame time overlay: on with ?overlay in the URL, toggled with F3. Draws on the HUD layer.
  let overlay = createFrameOverlay({ enabled: overlayEnabledFromSearch(window.location.search) });

  // Restart the match (R at the end screen) with a fresh seed; rebuild the world and controller.
  // R at the end screen: the same teams on a fresh island.
  const restart = (): void => {
    const rebuilt = buildGame({ setup: toMatchSetup(teamSetup, pickRestartSeed(window.location.search, randomBits), WORLD_SIZE_DEFAULT), createContext: contextFactory });
    if (!rebuilt.ok) return;
    game = rebuilt.value;
    controller = createController(game, cpuOptions);
    camera = createCamera({ x: WORLD_SIZE_DEFAULT.w / 2, y: WORLD_SIZE_DEFAULT.h / 2, bounds: WORLD_SIZE_DEFAULT });
    lastSoundState = null;
    cameraDirector = INITIAL_DIRECTOR;
    resetEffects();
    // A panel left open on the end screen must not cover the new match (review, run #36).
    panelOpen = false;
    panelLayout = null;
    paused = false;
    pauseLayout = null;
    optionsOpen = false;
    optionsLayout = null;
    listeningFor = null;
    renderer.markHudDirty();
  };
  window.addEventListener('keydown', (event) => {
    // Rebinding: while the options screen listens for an action, the next real key becomes its
    // binding. Escape cancels (the binder also turns it into the pause intent, which the tick treats
    // the same way), modifier keys alone are ignored, and a key already in use is refused with the
    // validator's message rather than corrupting the map.
    if (listeningFor !== null && optionsOpen) {
      if (event.code === 'Escape') return;
      if (/^(Shift|Control|Alt|Meta)(Left|Right)?$/.test(event.code)) return;
      event.preventDefault();
      const code = event.shiftKey ? shiftedKeyCode(event.code) : event.code;
      const result = rebind(settings.keybinds, listeningFor, [code]);
      if (result.ok) {
        settings = withKeybinds(settings, result.value);
        rebindInput(settings.keybinds);
        saveSettings(settingsStore, settings);
        optionsNotice = null;
      } else {
        optionsNotice = result.error.message;
      }
      listeningFor = null;
      renderer.markHudDirty();
      return;
    }
    if (event.key === 'F3') {
      overlay = createFrameOverlay({ enabled: !overlay.enabled });
      renderer.markHudDirty();
      return;
    }
    if (appPhase === 'menu' && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      chooseDevice(deviceMode === 'desktop' ? 'touch' : 'desktop');
      renderer.markHudDirty();
      return;
    }
    if (appPhase === 'menu' && (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar')) {
      chooseDevice(deviceMode);
      startMatch();
      return;
    }
    if (appPhase === 'setup' && event.key === 'Enter') {
      beginMatch(pickMatchSeed(window.location.search, randomBits));
      return;
    }
    if ((event.key === 'r' || event.key === 'R') && controller.state().phase === 'MatchEnd') restart();
  });

  const loop = createLoop(
    {
      tick: () => {
        const viewport = renderer.viewport();
        const intent = input.sample((screen) => screenToWorld(camera, viewport, screen));
        pointerWorld = intent.pointer;
        // Drag to look around: the screen delta becomes a world delta through the zoom, and the
        // camera stops chasing the worm while the player is looking.
        if (intent.pointerDown) {
          if (dragFrom === null) {
            dragFrom = { x: intent.pointerScreen.x, y: intent.pointerScreen.y };
            dragDistancePx = 0;
          } else {
            const dx = intent.pointerScreen.x - dragFrom.x;
            const dy = intent.pointerScreen.y - dragFrom.y;
            dragDistancePx += Math.hypot(dx, dy);
            if (dx !== 0 || dy !== 0) {
              // Move AND release the follow target: the camera keeps easing toward `target` every
              // update, so a bare moveTo is undone within a few ticks (measured: 834 -> 834 px).
              camera = follow(moveTo(camera, camera.x - dx / camera.zoom, camera.y - dy / camera.zoom), null);
              freeLookUntilMs = performance.now() + FREE_LOOK_HOLD_MS;
              dragFrom = { x: intent.pointerScreen.x, y: intent.pointerScreen.y };
            }
          }
        } else {
          dragFrom = null;
        }
        const dragged = dragDistancePx > DRAG_CLICK_TOLERANCE_PX;
        // The distance belongs to the press that just ended. A click whose down and up land in the
        // same tick never shows pointerDown, so without this reset it would inherit the last drag.
        if (!intent.pointerDown) dragDistancePx = 0;
        if (intent.zoomNotches !== 0) camera = zoomBy(camera, intent.zoomNotches);
        if (appPhase === 'setup') {
          teamSetupLayout = layoutTeamSetup(viewport, teamSetup);
          if (intent.pointerClicked) {
            const action = hitTestTeamSetup(teamSetupLayout, intent.pointerScreen);
            if (action !== null && action.kind === 'start') beginMatch(pickMatchSeed(window.location.search, randomBits));
            else if (action !== null) {
              teamSetup = reduceTeamSetup(teamSetup, action);
              renderer.markHudDirty();
            }
          }
        }
        // After the setup card, so the click that leaves the title cannot also press a setup cell.
        if (appPhase === 'menu') {
          // A tap on a device button picks it and starts; a tap anywhere else starts with the one lit.
          titleLayout = layoutTitleScreen(viewport, deviceMode);
          if (intent.pointerClicked) {
            chooseDevice(hitTestTitle(titleLayout, intent.pointerScreen) ?? deviceMode);
            startMatch();
          }
        }
        // While the title screen is up the match is frozen; input is still drained above.
        if (appPhase === 'playing') {
          // Pause: toggled by Escape or P, never on the end screen (R restarts there). While paused
          // nothing below runs, so the controller is not ticked and the clock and the sim hold; the
          // overlay's buttons resolve against the same layout the HUD draws (backlog 3.u).
          const pauseState = controller.state();
          if (pauseState.phase === 'MatchEnd') {
            paused = false;
            optionsOpen = false;
            listeningFor = null;
          } else if (intent.pause) {
            // Escape backs out one level: a pending rebind, then the options card, then the pause.
            if (optionsOpen) {
              if (listeningFor !== null) listeningFor = null;
              else optionsOpen = false;
            } else {
              paused = !paused;
            }
            renderer.markHudDirty();
          }
          if (paused) {
            if (optionsOpen) {
              optionsLayout = layoutOptionsScreen(viewport);
              if (intent.pointerClicked) {
                const action = hitTestOptions(optionsLayout, intent.pointerScreen);
                if (action !== null) applyOptionsAction(action);
              }
              pauseLayout = null;
              panelOpen = false;
              panelLayout = null;
              return;
            }
            optionsLayout = null;
            pauseLayout = layoutPauseScreen(viewport);
            if (intent.pointerClicked) {
              const action = hitTestPause(pauseLayout, intent.pointerScreen);
              if (action === 'surrender') {
                const human = pauseState.teams.find((team) => team.controller === 'human');
                if (human !== undefined) controller.surrender(human.id);
              }
              if (action === 'options') {
                optionsOpen = true;
                optionsNotice = null;
              } else if (action !== null) {
                paused = false;
              }
              if (action !== null) renderer.markHudDirty();
            }
            if (paused) {
              panelOpen = false;
              panelLayout = null;
              return;
            }
          }
          pauseLayout = null;
          optionsLayout = null;
          // The panel follows the F key rule: only during the human's Active turn. Leaving that
          // state (timer expiry, the shot, the CPU's turn, the end screen) closes it, so a pick can
          // never read the CPU team's ammo or land on a match that has ended (review, run #36).
          const panelState = controller.state();
          const panelAllowed = panelState.phase === 'Active' && activeTeamOf(panelState)?.controller === 'human';
          if (!panelAllowed) panelOpen = false;
          else if (intent.panelToggle) panelOpen = !panelOpen;
          // A click that lands while the panel is up belongs to the panel, never to the weapon.
          const clickTakenByPanel = panelOpen && intent.pointerClicked;
          if (panelOpen) {
            const worm = activeWormOf(panelState);
            panelLayout = worm === undefined ? null : layoutWeaponPanel(viewport, { ammo: worm.ammo, turnsElapsed: panelState.turn });
            if (panelLayout !== null && intent.pointerClicked) {
              const picked = hitTestWeaponPanel(panelLayout, intent.pointerScreen);
              if (picked !== null) {
                controller.selectWeapon(picked);
                panelOpen = false;
              } else if (!isInsideWeaponPanel(panelLayout, intent.pointerScreen)) {
                // Clicking off the card dismisses it, like any menu.
                panelOpen = false;
              }
            }
          }
          if (!panelOpen) panelLayout = null;
          controller.tick({
            moveX: intent.moveX,
            jump: intent.jump,
            backflip: intent.backflip,
            aimDelta: intent.aimDelta,
            fireHeld: intent.fireHeld,
            fireReleased: intent.fireReleased,
            thrust: intent.thrust,
            selectedSlot: intent.selectedSlot,
            fuse: intent.fuse,
            pointer: intent.pointer,
            pointerClicked: intent.pointerClicked && !clickTakenByPanel && !dragged,
          });
          const gameEvents = controller.drainEvents();
          soundDirector.handleEvents(gameEvents);
          applyFxEvents(fx, gameEvents, fxDeps);
          for (const event of gameEvents) {
            // Every blow of a super shakes the screen; the finisher and a worm bursting shake it hard.
            if (event.type === 'comboHit') camera = shake(camera, event.finisher ? 9 : 2.4);
            else if (event.type === 'gib') camera = shake(camera, 5);
            else if (event.type === 'comboStart') camera = shake(camera, 2);
            else if (event.type === 'beamFire') camera = shake(camera, 10);
            else if (event.type === 'devourBeat') {
              const kick = DEVOUR_SHAKE[event.beat];
              if (kick > 0) camera = shake(camera, kick);
            } else if (event.type === 'hexBeat') {
              camera = shake(camera, HEX_SHAKE[event.beat] + (event.beat === 'pulse' ? event.n * 0.5 : 0));
            }
            if (event.type === 'explosion') {
              // The fireworks scale with the weapon: a dynamite stick (blast tier 'big') used to get
              // the same intensity and shake as a grenade, which is what "the TNT effect sucks"
              // looked like. Big and holy blasts get a second, debris heavy burst and a harder kick.
              const tier = event.particle ?? 'medium';
              const intensity = tier === 'small' ? 0.6 : tier === 'medium' ? 0.9 : 1;
              const radius = event.radius ?? 30;
              spawnExplosion(particles, { x: event.x, y: event.y, radius, intensity }, rng);
              if (tier === 'big' || tier === 'holy') {
                spawnExplosion(particles, { x: event.x, y: event.y - radius * 0.3, radius: radius * 1.4, intensity: 1 }, rng);
              }
              const kick = tier === 'holy' ? 2.2 : tier === 'big' ? 1.6 : 1;
              camera = shake(camera, (event.shake ?? 4) * kick);
            }
          }
          const nowState = controller.state();
          soundDirector.observe(lastSoundState, nowState);
          lastSoundState = nowState;
          const activeNow = activeWormOf(nowState);
          if (activeNow !== undefined) noteWeapon(fx, activeNow.id, controller.selectedWeapon());
          // Ride the shot while it is in the air, hold on the impact, then back to the worm. While
          // the player is dragging the view (and for a beat after) the follow stands aside; a shot
          // in the air always wins, so the ride is never missed.
          const aim = updateCameraTarget(cameraDirector, controller.world(), TICK_MS_CAMERA, { halfW: viewport.w / camera.zoom / 2, halfH: viewport.h / camera.zoom / 2 });
          cameraDirector = aim.director;
          const freeLook = performance.now() < freeLookUntilMs && aim.director.focus === 'worm';
          if (aim.target !== null) {
            camera = follow(camera, aim.target, aim.tauMs);
          } else if (!freeLook) {
            const active = activeWormOf(nowState);
            const body = active === undefined ? undefined : findBody(controller.world(), active.id);
            if (body !== undefined) camera = follow(camera, { x: body.x, y: body.y }, DEFAULT_FOLLOW_TAU_MS);
          }
        }
        camera = updateCamera(camera, 1000 / SIM_HZ, viewport);
        particles.update(1 / SIM_HZ);
        advanceFx(fx, 1000 / SIM_HZ, appPhase === 'playing' ? { world: controller.world(), hpOf, maxHp: GAME_CONFIG.wormHp } : null, fxDeps);
        updateGore(gore, 1 / SIM_HZ, controller.world().terrain, rng);
      },
      render: () => {
        frames += 1;
        const touchView: TouchControlsView =
          deviceMode !== 'touch' || appPhase !== 'playing' ? 'hidden' : controller.state().phase === 'MatchEnd' ? 'end' : paused ? 'paused' : panelOpen ? 'panel' : 'play';
        touchControls.show(touchView);
        const now = scheduler.now();
        const stats = loop.stats();
        renderer.updateDpr(stats.averageFrameMs, now);
        const state = controller.state();
        const selected = controller.selectedWeapon();
        const activeBody = controller.world().worms.find((body) => body.id === activeWormOf(state)?.id);
        const targeting = WEAPONS[selected].requiresTargetSelect && activeTeamOf(state)?.controller === 'human' && !panelOpen && !paused;
        // The supers' camera work: the freeze dims and pulls in, the beating turns the screen white,
        // a beam darkens the world while it charges and pulls back as it fires, Gear 5 steps in on
        // every drum and closes in on the meal, the Freezer closes in on the victim as it swells.
        const cine = cinematicFor(controller.world().combos, controller.world().beams, controller.world().devours, controller.world().hexes);
        const view: Camera = cine.zoom === 1 ? camera : { ...camera, zoom: camera.zoom * cine.zoom };
        const model = {
          state,
          world: controller.world(),
          aim: controller.aim(),
          timeMs: now,
          sprites,
          weapon: selected,
          weaponSprites,
          pointer: pointerWorld,
          targeting,
          anim: (wormId: string) => wormAnim(fx, wormId),
          scratch,
          whiteout: cine.whiteout,
          dim: cine.dim,
          aura: cine.aura,
          aimAssist: activeTeamOf(state)?.controller === 'human' && !panelOpen,
          gore: gore.enabled,
        };
        // At MatchEnd the end screen carries the message, so the centre banner would collide with it.
        const hud = {
          state,
          aim: controller.aim(),
          weapon: controller.selectedWeapon(),
          banner: state.phase === 'MatchEnd' ? null : controller.banner(),
          steps: controller.stepsRemaining(),
          stepsTotal: controller.stepsPerTurn(),
          fuseMs: controller.selectedFuseMs(),
          dropEveryTurns: game.deps.config.crates.dropEveryTurns,
          jetpackFuelMs: activeBody?.motion === 'jetpacking' ? activeBody.fuelMs : null,
          panel: panelLayout,
          weaponSprites,
        };
        const key = hudKey(hud);
        if (key !== lastHudKey) {
          lastHudKey = key;
          renderer.markHudDirty();
        }
        const overlayChanged = overlay.update(
          { averageFrameMs: stats.averageFrameMs, fps: stats.fps, tickCount: stats.tickCount, dpr: renderer.dpr(), particleCount: particles.count(), discardedMs: stats.discardedMs },
          now,
        );
        if (overlayChanged) renderer.markHudDirty();
        renderer.render(
          (ctx, viewport: Size) => {
            drawGame(ctx, viewport, view, model);
            drawGore(ctx, gore, view, viewport, cine.whiteout);
            drawFxWorld(ctx, fx, view, viewport, sprites, cine.whiteout);
            drawParticles(ctx, particles, view, viewport);
            drawLens(ctx, gore, viewport);
            drawFxScreen(ctx, fx, viewport, { touch: deviceMode === 'touch' });
          },
          (ctx, viewport: Size) => {
            if (appPhase === 'menu') {
              drawTitleScreen(ctx, viewport, titleLayout ?? layoutTitleScreen(viewport, deviceMode));
            } else if (appPhase === 'setup') {
              drawTeamSetup(ctx, viewport, teamSetupLayout ?? layoutTeamSetup(viewport, teamSetup), teamSetup, teamColor);
            } else {
              drawHud(ctx, viewport, hud);
              if (paused && optionsOpen && optionsLayout !== null) drawOptionsScreen(ctx, viewport, optionsLayout, optionsModel());
              else if (paused && pauseLayout !== null) drawPauseScreen(ctx, viewport, pauseLayout);
              if (state.phase === 'MatchEnd') {
                const winner = aliveTeams(state)[0];
                drawEndScreen(ctx, viewport, {
                  winner: winner?.name ?? null,
                  color: winner === undefined ? '#f4f4f4' : teamColor(winner.colorIndex),
                  rows: buildScoreboard(state),
                  colorOf: teamColor,
                  touch: deviceMode === 'touch',
                });
              }
            }
            overlay.draw(ctx, viewport);
          },
        );
      },
    },
    scheduler,
  );

  window.addEventListener('resize', () => renderer.resize());

  if (import.meta.env.DEV) {
    window.__orugas = Object.freeze({
      frames: () => frames,
      ticks: () => loop.tickCount(),
      simHz: SIM_HZ,
      solidCount: () => solidCount(game.terrain),
      phase: () => controller.state().phase,
      fireBazooka: (angleDeg = -55, power = 0.5) => {
        const active = activeWormOf(controller.state());
        const body = active === undefined ? undefined : findBody(game.world, active.id);
        // Defaults are a steep down shot so it craters right by the worm whatever the terrain shape,
        // which is what the smoke asserts. Pass a flatter angle to send it on a long arc.
        if (body !== undefined) fire(game.world, body, WEAPONS.bazooka, { angleDeg, power });
      },
      // Fire every panel weapon once from the active worm, reporting which ones threw.
      selectedWeapon: () => controller.selectedWeapon(),
      inventory: () => ({
        activeId: activeWormOf(controller.state())?.id ?? '',
        fuseMs: controller.selectedFuseMs(),
        worms: controller.state().teams.flatMap((team) => team.worms.map((worm) => ({ id: worm.id, ammo: worm.ammo }))),
        drops: controller.world().crates.filter((crate) => crate.alive).map((crate) => ({ kind: crate.kind, landed: crate.landed })),
      }),
      stepsRemaining: () => controller.stepsRemaining(),
      seed: () => controller.state().seed,
      settings: () => settings,
      paused: () => paused,
      scoreboard: () => buildScoreboard(controller.state()).map((row) => ({ name: row.name, winner: row.winner, points: row.points, aliveWorms: row.aliveWorms })),
      turnRemainingMs: () => controller.state().timers.turnRemainingMs,
      optionsOpen: () => optionsOpen,
      optionsCells: () => (optionsLayout === null ? [] : optionsLayout.cells.map((c) => ({ id: c.id, x: c.x, y: c.y, w: c.w, h: c.h }))),
      keybinds: () => settings.keybinds,
      weaponFrames: () => (weaponSprites === null ? 0 : WEAPON_IDS.filter((id) => weaponSprites?.atlas.frame(WEAPONS[id].icon) !== undefined).length),
      selectWeapon: (id: string) => {
        const found = WEAPON_IDS.find((weapon) => weapon === id);
        if (found !== undefined) controller.selectWeapon(found);
      },
      appPhase: () => appPhase,
      deviceMode: () => deviceMode,
      titleCells: () => (titleLayout === null ? [] : titleLayout.buttons.map((b) => ({ id: b.id, x: b.x, y: b.y, w: b.w, h: b.h }))),
      teamSetupCells: () => (teamSetupLayout === null ? [] : teamSetupLayout.cells.map((c) => ({ id: c.id, x: c.x, y: c.y, w: c.w, h: c.h }))),
      teamControllers: () => controller.state().teams.map((team) => team.controller),
      optionsCard: () => optionsLayout?.card ?? null,
      optionsListening: () => listeningFor,
      pauseCells: () => (pauseLayout === null ? [] : pauseLayout.buttons.map((b) => ({ id: b.id, x: b.x, y: b.y, w: b.w, h: b.h }))),
      setVolume: (target: string, level: number) => {
        if (!isAudioTarget(target)) return false;
        settings = withAudio(settings, target, level);
        mixer.setVolume(target, settings.audio[target]);
        return saveSettings(settingsStore, settings);
      },
      activeBody: () => {
        const active = activeWormOf(controller.state());
        const body = active === undefined ? undefined : findBody(controller.world(), active.id);
        return body === undefined ? null : { x: body.x, y: body.y, vx: body.vx, vy: body.vy, motion: body.motion, onGround: body.onGround, fuelMs: body.fuelMs };
      },
      panelOpen: () => panelOpen,
      panelCells: () => (panelLayout === null ? [] : panelLayout.rows.flatMap((row) => row.cells.map((cell) => ({ id: cell.id, x: cell.x, y: cell.y, w: cell.w, h: cell.h, enabled: cell.enabled })))),
      fireAll: () => {
        const results: { weapon: string; ok: boolean; error?: string }[] = [];
        const active = activeWormOf(controller.state());
        const body = active === undefined ? undefined : findBody(game.world, active.id);
        if (body === undefined) return results;
        for (const id of WEAPON_IDS) {
          const def = WEAPONS[id];
          try {
            fire(game.world, body, def, {
              angleDeg: 45,
              power: 0.6,
              ...(def.requiresTargetSelect ? { targetPoint: { x: body.x + 120, y: body.y - 60 } } : {}),
              ...(def.fuse === undefined ? {} : { fuseMs: def.fuse.defaultMs }),
            });
            results.push({ weapon: id, ok: true });
          } catch (error: unknown) {
            results.push({ weapon: id, ok: false, error: error instanceof Error ? error.message : String(error) });
          }
        }
        return results;
      },
      dropCrate: () => {
        const world = controller.world();
        const x = pickCrateColumn(world) ?? Math.floor(world.terrain.width / 2);
        spawnCrate(world, 'health', x);
      },
      // Sink a worm that is NOT the active one, so the turn is not forfeited mid checklist.
      drownOne: () => {
        const activeId = activeWormOf(controller.state())?.id;
        const world = controller.world();
        const victim = world.worms.find((body) => body.alive && body.id !== activeId);
        if (victim === undefined) return false;
        victim.y = world.terrain.water.y + 6;
        victim.vy = 0;
        return true;
      },
      crateCount: () => controller.world().crates.filter((crate) => crate.alive).length,
      // Jump the round clock past roundMs so the next SuddenDeathCheck triggers sudden death.
      forceSuddenDeath: () => controller.advanceRoundClock(DEFAULT_MATCH_CONFIG.roundMs),
      suddenDeath: () => controller.state().suddenDeath,
      activeController: () => activeTeamOf(controller.state())?.controller ?? '',
      turn: () => controller.state().turn,
      // Expire the current turn timer so play passes to the next team.
      endTurn: () => controller.advanceRoundClock(DEFAULT_MATCH_CONFIG.turnMs),
      frameMs: () => loop.stats().averageFrameMs,
      dpr: () => renderer.dpr(),
      dropWorm: (exempt: boolean) => {
        const activeId = activeWormOf(controller.state())?.id;
        const victim = controller.world().worms.find((body) => body.alive && body.id !== activeId);
        if (victim === undefined) return null;
        // 250 px is well past the 8 px/frame fall damage threshold; clamp so the lift cannot
        // cross the top bedrock border. airborne() keys off motion, so set that too.
        victim.y = Math.max(20, victim.y - 250);
        victim.vx = 0;
        victim.vy = 0;
        victim.onGround = false;
        victim.motion = 'falling';
        victim.exemptNextLanding = exempt;
        return victim.id;
      },
      wormHp: (id: string) => {
        for (const team of controller.state().teams) for (const worm of team.worms) if (worm.id === id) return worm.hp;
        return -1;
      },
      onGround: (id: string) => controller.world().worms.find((body) => body.id === id)?.onGround ?? false,
      cameraDebug: () => {
        const p = controller.world().projectiles;
        const lead = p.length === 0 ? null : p.reduce((a, b) => (b.id > a.id ? b : a));
        return { camX: camera.x, camY: camera.y, projX: lead?.x ?? null, projY: lead?.y ?? null, focus: cameraDirector.focus };
      },
      aliveCount: () => controller.state().teams.reduce((total, team) => total + team.worms.filter((worm) => worm.alive).length, 0),
      fireWeapon: (id: string, angleDeg = 30, power = 0.7) => {
        const weapon = WEAPON_IDS.find((candidate) => candidate === id);
        const active = activeWormOf(controller.state());
        const body = active === undefined ? undefined : findBody(controller.world(), active.id);
        if (weapon === undefined || body === undefined) return false;
        const def = WEAPONS[weapon];
        fire(controller.world(), body, def, {
          angleDeg,
          power,
          ...(def.requiresTargetSelect ? { targetPoint: { x: body.x + body.facing * 120, y: body.y - 40 } } : {}),
          ...(def.fuse === undefined ? {} : { fuseMs: def.fuse.defaultMs }),
        });
        return true;
      },
      lineUpEnemy: (dx = 40, id?: string) => {
        const state = controller.state();
        const active = activeWormOf(state);
        const team = activeTeamOf(state);
        const world = controller.world();
        const body = active === undefined ? undefined : findBody(world, active.id);
        if (body === undefined || team === undefined) return null;
        const enemy = world.worms
          .filter((w) => w.alive && w.teamId !== team.id && (id === undefined || w.id === id))
          .sort((a, b) => Math.abs(a.x - body.x) - Math.abs(b.x - body.x))[0];
        if (enemy === undefined) return null;
        const x = Math.round(body.x + body.facing * dx);
        const ground = firstSolidBelow(world.terrain.mask, x, body.y - 40, 240);
        enemy.x = x;
        enemy.y = ground === null ? body.y : ground - 1;
        enemy.vx = 0;
        enemy.vy = 0;
        enemy.motion = 'falling';
        enemy.onGround = false;
        return enemy.id;
      },
      goreCount: () => ({ bits: gore.bits.activeCount(), lens: gore.lens.length, stains: gore.stains }),
      combos: () => controller.world().combos.length,
      beams: () => controller.world().beams.length,
      devours: () => controller.world().devours.length,
      hexes: () => controller.world().hexes.length,
      aimOffBy: (id: string) => {
        const world = controller.world();
        const active = activeWormOf(controller.state());
        const body = active === undefined ? undefined : findBody(world, active.id);
        const target = world.worms.find((worm) => worm.id === id);
        if (body === undefined || target === undefined) return null;
        const muzzle = muzzlePoint(body);
        const wanted = (Math.atan2(muzzle.y - (target.y - WORM_HEIGHT / 2), (target.x - muzzle.x) * body.facing) * 180) / Math.PI;
        return controller.aim().angleDeg - wanted;
      },
      // Surrender every team but the first one still alive, so the match reaches a real MatchEnd.
      forceWin: () => {
        const teams = controller.state().teams;
        const survivor = teams.find((team) => team.worms.some((worm) => worm.alive));
        if (survivor === undefined) return;
        for (const team of teams) {
          if (team.id !== survivor.id) controller.surrender(team.id);
        }
      },
    });
  }

  console.log(`Orugas boot: sim ${SIM_HZ} Hz, first playable, ${game.state.teams.length} teams`);
  loop.start();
}

boot();
