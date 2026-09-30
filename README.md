# Oruga Worms

A browser artillery game with destructible terrain, 29 weapons and utilities, animated worms,
local multiplayer, and a CPU opponent. Built with TypeScript, Vite, and Canvas 2D.

**Content warning:** the game shows cartoon blood and gore (blood sprays, stains, and worms bursting
into pieces). Add `?gore=0` to the URL to turn it off.

## Play

https://oruga-worms.vercel.app

Pick your device on the title screen: **Computer** (keyboard and mouse) or **Phone / Tablet**
(on-screen touch controls). The game suggests one from your screen and remembers your pick;
`?device=touch` or `?device=desktop` in the URL forces either. Then choose human or CPU teams
and start the match.

### Touch controls

| Action | Control |
| --- | --- |
| Walk / aim | ◀ ▶ / ▲ ▼ pad on the left |
| Charge and fire | Hold and release FIRE |
| Jump / backflip | Jump / Flip |
| Jetpack lift | Hold Jump or ▲ |
| Weapons, zoom, pause | Buttons at the top right |
| Target teleport, girder, or strike | Select weapon, then tap the destination |
| Super move (Ryuko Ranbu) | Pick it in Weapons, then press and release FIRE |
| Kamehameha | Pick it in Weapons, aim with ▲ ▼, then press and release FIRE |
| Gear 5 | Pick it in Weapons, then press and release FIRE: the arm finds its own meal |
| Look around | Drag the map |
| Play again | Play again button on the end screen |

### What's new

- **Gear 5**, a super after Luffy's Sun God Nika (one per worm, unlocked from turn 4). The drums of
  liberation beat four times (DON!) while the worm turns white, the sun god's rays spin behind it
  and a cloud of white steam wraps its neck; it awakens with GEAR 5! and the straw hat pops on. Its
  rubber arm shoots out to the nearest enemy in plain sight within 200 px (a LOCK ON marker shows
  who), grabs it and reels it into a giant mouth that bites it four times (CHOMP!, and blood
  everywhere) and swallows it whole: a worm eaten is gone, whatever its health. Then the worm burps
  the bandana, the bones and an eye back up, and laughs. With nobody in reach the arm grabs at the
  air. The CPU eats whoever it can reach.
- **Kamehameha**, a beam super (one per worm, unlocked from turn 3). Aim it like a gun and fire:
  the worm cups a ball of ki in its hands while it chants KA... ME... HA... ME..., then shouts HA!!!,
  the screen flashes and the beam leaves. It races 640 px along the aim, bores a tunnel through the
  land and hits every worm on the line once, friends included: 45 damage and a throw along the beam.
  Where it ends it blows up (a 90 px crater). The CPU fires it too: it picks the line through the
  most enemies, and a teammate on the line counts double against it.
- **Ryuko Ranbu**, a Kyokugen style super move (melee row, one per worm, unlocked from turn 2). It
  locks onto the nearest enemy in plain sight within 180 px (a red LOCK ON marker shows who), then
  the screen darkens while the attacker powers up, it dashes in, and the screen goes white, the two
  fighters in black and the blood in red, while it lands sixteen blows; a launching finisher ends
  it. 75 damage in all, with a hit counter, the move's name card and a K.O. call. A victim
  beaten to 0 hp keeps taking the beating and bursts on the finisher. With nobody in reach it whiffs.
- **Gore**: every hit sprays blood along the blow and stains the land it lands on (a crater erases
  the stain with the land). A worm reduced to 0 hp bursts into meat, guts, eyes, bones and its
  bandana; badly hurt worms bleed and drip, and heavy blows throw blood on the camera lens.
- **Animation**: hold poses per weapon family, recoil, hurt flashes, tumbling when thrown, a spinning
  backflip, landing squash, drowning worms that sink, and a victory hop. Rockets, grenades, bombs and
  arrows are drawn as themselves, with smoke trails and fuse countdowns; guns get muzzle flashes,
  tracers and casings; blasts get a flash and a shock ring; damage floats up as numbers; the camera
  follows worms thrown through the air.
- **Aiming**: a reticle and a charge wedge at the worm, a laser sight for guns, the reach of melee
  weapons, and the name of a newly picked weapon over the worm.
- Each worm carries its own ammunition and remembers its selected weapon.
- A random supply crate parachutes down after every three completed turns. Contents can be
  weapons, utilities, or health. The worm that collects a crate receives the reward.
- Supply drops respect the five-crate map limit; health drops stop during sudden death.
- The HUD identifies the active inventory, shows ammunition, and counts down to the next drop.
- Fuse selection for supported explosives uses keys 1–5 and is shown in the HUD.
- Weapon behavior is covered by functional regression tests, including timed explosives,
  melee knockback, utility use, and independent inventories.

## Run locally

Requires Node.js 24 or later.

```sh
npm ci
cp .env.example .env
npm run dev
```

On PowerShell, use `Copy-Item .env.example .env`. Open the local URL printed by Vite.
The CPU works without API credentials using its built-in heuristic.

## Controls

| Action | Control |
| --- | --- |
| Walk | Left/Right or A/D |
| Aim | Up/Down or W/S |
| Charge and fire | Hold and release Space |
| Jump / backflip | Enter / Backspace |
| Jetpack | Select it, press/release Space; hold Up, W, or Enter to lift; Left/Right to steer |
| Open inventory | Tab or Shift+Q; click a weapon |
| First nine weapon slots | F1–F9 |
| Explosive fuse | 1–5, for weapons that allow those durations |
| Target teleport, girder, or strike | Select weapon, then click the destination |
| Zoom / pan camera | Mouse wheel / drag |
| Super move (Ryuko Ranbu) | Select it in the inventory, then press and release Space |
| Kamehameha | Select it in the inventory, aim with Up/Down, then press and release Space |
| Gear 5 | Select it in the inventory, then press and release Space |
| Pause and options | Escape or P |
| Restart after a match | R |

## Checks

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run e2e
```

The browser tests exercise gameplay locally and run a production smoke test.
Set `LIVE_URL` to override the production URL. Screenshots are written to `test-results/`.

## Deployment

The Vercel project builds with `npm run build` and serves `dist/`. Public hosting uses the
heuristic CPU. The optional development sidecar is not deployed as a serverless function.

## Optional CPU service

The local Vite server mounts the sidecar at `/api`. Configure `ORUGAS_CPU_BACKEND=api` and
`ANTHROPIC_API_KEY` in `sidecar/.env` to use the model backend. With no credentials, the
heuristic remains available. Never commit real `.env` files or API keys.

## Project layout

- `src/match`: turns, individual inventories, supply drops, scoring, and victory.
- `src/sim`, `src/terrain`: physics and destructible terrain.
- `src/weapons`: weapon definitions and behavior dispatch.
- `src/game`, `src/engine`: controller, rendering, animation cues (`fx.ts`), gore (`gore.ts`), the
  supers' camera work (`cinematic.ts`), input, sound, and HUD.
- `src/sim/combo.ts`, `src/weapons/behaviors/combo.ts`: the Ryuko Ranbu's timeline and target lock.
- `src/sim/beam.ts`, `src/weapons/behaviors/beam.ts`: the Kamehameha's charge, flight, tunnel and hits.
- `src/sim/devour.ts`, `src/weapons/behaviors/devour.ts`, `src/game/gear-five.ts`: Gear 5's timeline,
  its grab, and its look (the white, the cloud, the hat, the rubber arm and the giant mouth).
- `src/ai`, `sidecar`: CPU planning and optional local model service.
- `public/audio`, `public/sprites`: packaged game assets.
- `tests`: unit, integration, and browser regression tests.

Personal project, not affiliated with Team17. Art and audio were generated for this game.
