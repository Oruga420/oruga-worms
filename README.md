# Oruga Worms

A browser artillery game with destructible terrain, 26 weapons and utilities, animated worms,
local multiplayer, and a CPU opponent. Built with TypeScript, Vite, and Canvas 2D.

## Play

https://oruga-worms.vercel.app

Press Enter to open team setup, choose human or CPU teams, then start the match.

### What's new

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
| Open inventory | Tab or Shift+Q; click a weapon |
| First nine weapon slots | F1–F9 |
| Explosive fuse | 1–5, for weapons that allow those durations |
| Target teleport, girder, or strike | Select weapon, then click the destination |
| Zoom / pan camera | Mouse wheel / drag |
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
- `src/game`, `src/engine`: controller, rendering, input, sound, and HUD.
- `src/ai`, `sidecar`: CPU planning and optional local model service.
- `public/audio`, `public/sprites`: packaged game assets.
- `tests`: unit, integration, and browser regression tests.

Personal project, not affiliated with Team17. Art and audio were generated for this game.
