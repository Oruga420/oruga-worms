# Oruga Worms

A browser artillery game with destructible terrain, 38 weapons and utilities, animated worms,
local multiplayer, and a CPU opponent. Built with TypeScript, Vite, and Canvas 2D.

**Content warning:** the game shows cartoon blood and gore (blood sprays, stains, and worms bursting
into pieces). Add `?gore=0` to the URL to turn it off.

## Play

https://oruga-worms.vercel.app

Pick your device on the title screen: **Computer** (keyboard and mouse) or **Phone / Tablet**
(on-screen touch controls). The game suggests one from your screen and remembers your pick;
`?device=touch` or `?device=desktop` in the URL forces either. Then pick the map (the Island,
the Spaceship, the Castle or Kame House: click the Map row to cycle it), choose human or CPU
teams and start the match. `?map=castle` (or `spaceship`, `kame_house`) in the URL starts on one.

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
| Gear 5 | Pick it in Weapons, then press and release FIRE: the arm finds its own meal (costs 50 hp) |
| Freezer | Pick it in Weapons, then press and release FIRE: the light finds its own victim (costs 50 hp) |
| Saibaman seed | Pick it in Weapons (Animals), then press and release FIRE: it is planted in front |
| Antares, Explosión de Galaxias, Hiken, Zoltraak | Pick it in Weapons (Anime), aim with ▲ ▼, then press and release FIRE |
| Tesoro del Cielo | Pick it in Weapons (Anime), then press and release FIRE: it seals the nearest enemy in sight |
| Meteorito | Pick it in Weapons (Anime), then tap where it should fall |
| Santoryu | Pick it in Weapons (Anime), move the square with ▲ ▼, then press and release FIRE |
| Explosión Final | Pick it in Weapons (Anime), then press and release FIRE: it goes off where the worm stands |
| Look around | Drag the map |
| Play again | Play again button on the end screen |

### What's new

- **Three new maps**, picked on the team setup card (the Map row) or with `?map=` in the URL:
  - **Spaceship**: a long hull adrift in deep space, a banded planet and the stars behind it. The
    worms fight on the deck, between the bridge, the fins, two sunken hatches and the engines that
    burn at the stern; a cargo pod hangs under the keel. Whatever falls off is lost in the void.
  - **Castle**: a keep between two towers on a hill at dusk, the moon up and dark ridges behind,
    battlements along every top (a worm stands between the merlons), a gatehouse sealed in the
    keep's foot that a bazooka opens, flags flying from the towers.
  - **Kame House**: Master Roshi's island, a flat sandy beach in a turquoise sea with the pink
    house and its red dome in the middle (hollow, so a shot opens it), the KAME HOUSE sign on top,
    palms swaying either side and two rocks off shore.
  Every map is the sim's terrain like the island: it craters, it burns, it is cut into cubes, and
  the same spawn rules place every team on it, up to four teams of six. The island stays the
  default, random per game as before.
- **One super at a time, per worm**: a worm that uses a super (Ryuko Ranbu, the Kamehameha, Gear 5,
  the Freezer, the Saibaman seed or any technique of the Anime row) sits out supers for its own next
  turn; its team mates are not held by it. With six worms a team, that is the turn after the whole
  team has been round once. The panel greys the supers out with NEXT TURN across them while the worm
  rests, a worm that comes up with a resting super in hand starts on the bazooka, and everything else
  stays open. The CPU keeps to it too.
- **Explosión Final** (Majin Vegeta) joins the Anime row: the worm goes off where it stands and takes
  everyone within 70 px with it, itself first of all. See the row below.
- **Six worms a team**: every team now fields six worms (three before), each with a name of its own,
  and a full map of four teams still fits: on an island too bumpy for the usual spacing the worms
  stand a little closer. A team may grow to ten living worms with Saibamen (eight before).
- **The Tesoro del Cielo, toned down**: it takes the turns of the sealed worm only, not of its whole
  team. The team plays on with its other worms, and as each of those turns ends the wheel strikes
  the sealed worm; the third strike kills it. Only when the sealed worm is the last one its team has
  does the team lose the turn.
- **Every worm waits its first turn**: the scheme delays now count each worm's own turns, not the
  match's. A worm's supers, the Anime row's techniques, the Saibaman seed, the air strike and the
  jetpack open on its second own turn, and with six worms a team that is the second time it comes
  up, however late in the match that is. Before, they opened on match turn 2 for everyone at once.
- **Sonic Blast hits for 70**: the pressure wave now does real damage, 70 when the whole cone lands
  (five pellets of 14, the middle one on the aim), with the same push as before.
- **The Anime row**: eight techniques from Saint Seiya, One Piece, Frieren and Dragon Ball, one of each per worm,
  recharged by power orbs and locked on the opening turn like every super. Each one shouts its
  name across the screen with whose technique it is.
  - **Antares** (Milo of Scorpio, from turn 2). The worm points along the aim and its nail grows
    crimson; Scorpio is traced over the first worm on the line, and fourteen needles streak into it
    (¡AGUJA ESCARLATA!), each lighting one of its stars red, until Antares, the heart's star, swells
    and the last needle goes in (¡ANTARES!): the worm dies, whatever its health. The needles reach
    420 px but stop at the first wall. It costs half the health its user has (rounded up), paid as
    it starts, hit or miss; the panel marks it -50%♥.
  - **Explosión de Galaxias** (Saga of Gemini, from turn 2). Night falls round the worm as it crosses
    its arms overhead and the cosmos opens behind it; then it hurls a spinning galaxy along the aim,
    slow enough to watch, until it hits a worm or the land: every worm within 44 px of where it
    bursts dies, friends and the thrower too, and the crater is as wide. Like the other one hit
    kills, it costs 50 hp.
  - **Tesoro del Cielo** (Shaka of Virgo, from turn 2). The worm sits in the lotus, a golden halo
    behind its head and the twin Sala trees blossoming either side, and the treasure's golden wheel
    comes down over the nearest enemy in sight within 420 px and seals it (¡SELLADO!, 3 TURNOS SIN
    JUGAR). The sealed worm sits out its team's next three turns while its team plays them with its
    other worms (a small golden wheel hangs over it, a bead for every strike to come), and as each of
    those turns ends the wheel opens over the sealed worm and bites: the first takes its touch
    (−TACTO), the second its taste (−GUSTO), the third kills it. When the sealed worm is the last of
    its team, the team loses those turns instead (¡SIN SENTIDOS! on its banner). Every strike costs
    the caster 15 hp; if that kills the caster before the third, or the sealed worm dies another way,
    the seal breaks. The panel marks it -15♥×3.
  - **Hiken** (Portgas D. Ace, from turn 2). The worm draws its fist back, its arm catches fire, and
    it throws a fist of flame as big as a house straight along the aim (¡HIKEN!): a blast a little
    bigger than the bazooka's where it lands (55 at most), and nine burning blobs spill forward,
    away from the thrower.
  - **Meteorito** (Fujitora, from turn 2). The worm raises its sword at the sky, a purple swirl of
    gravity tightens over the spot you clicked or tapped, and a burning meteor comes down slanting
    out of the top of the world onto it: the biggest crater in the game, and 80 at most, the worm
    that called it included if it stands too close.
  - **Santoryu** (Roronoa Zoro, from turn 2). Three swords out, one in the mouth: six slashes
    criss-cross an 84 px square in front of the worm (moved with the aim), and the land in it falls
    apart in cubes (¡TODO EN CUBOS!); every worm inside takes 45 and is thrown.
  - **Zoltraak** (Frieren, from turn 2). Staff in hand, five magic circles open one by one over the
    worm, and each fires a beam of white light that meets the others on one point along the aim:
    18 at most each, 90 if all five land. They hardly push, so the first does not throw the target
    out of the way of the rest.
  - **Explosión Final** (Majin Vegeta, from turn 2). A ring round the worm shows its reach while it is
    picked. The worm plants its feet and a golden aura climbs round it, lightning crackling through
    it as it gathers everything it has (¡EXPLOSIÓN FINAL!, Adiós... Trunks); then it lets go: a
    sphere of white gold, the screen whited out, and every worm within 70 px of where it stood is
    gone, friends and enemies alike, the worm itself first of all (¡ADIÓS!), with a crater as wide
    as the holy hand grenade's. It costs no health: it costs the worm. The CPU uses it when a worm
    on its last legs stands among enough enemies to be worth it.

  The CPU uses all seven: it takes the price of the ones that cost health off what they are worth,
  keeps its friends and itself out of the blasts, and counts the turns a seal steals.

- **The price of the one hit kills**: Gear 5 and the Freezer, the two supers that kill whatever they
  touch, now cost the worm that uses them 50 of its own health, or all it has left. The price is
  paid as the move starts (its life drains out of it in red embers, ¡PENITENCIA!). A worm that pays
  with its last health still finishes the move, then bursts, and its turn ends with it
  (¡SACRIFICIO!). The panel marks both with a red -50♥, and the HUD and the picked weapon's name say
  what it costs. Nobody scores the price. The CPU weighs it: it saves them for a target worth more
  than the price, and a worm on its last legs will trade them for an enemy.
- **Saibaman seed** (one per worm, unlocked from turn 2, in the Animals row). The worm holds a seed
  out and kneels to push it into the ground a stride in front of it; the ground shakes and cracks
  three times, green light shining up through the cracks, and a Saibaman leaps out of the crater
  (¡SAIBAMAN!, KEKEKE!): a small green worm with half a worm's health (50) and half its size, so a
  smaller target that fits through gaps a worm cannot. It joins the planter's team and takes its own
  turns, with the unlimited weapons (bazooka, grenade, guns, fire punch, skip go) and whatever crates
  and power orbs bring it. With no ground in front it goes in nearer or behind; a team is capped at
  ten living worms, and a seed planted past that wilts (NO ROOM!). The CPU plants one when it has
  no better shot.
- **Power orbs**: about one supply drop in three is now an orange ball with four red stars that
  falls out of the sky like a comet and floats glowing where it lands (POWER INCOMING in gold). The
  worm that takes it gets a super back: one it has already used if any (Ryuko Ranbu, the
  Kamehameha, Gear 5, the Freezer, the Saibaman seed or a technique of the Anime row), otherwise
  one more of any, and the name rises over it (+1 KAMEHAMEHA!). Every crate now says what it gave
  (+1 BAZOOKA, +25).
- **CPU worms move**: before they shoot they walk to a better spot and turn to face enemies behind
  them, and with nothing to shoot at they close in instead of standing still.
- Crates now land on the land. The top of the world is a thin bedrock ceiling, and every crate used
  to come to rest on it, off the top of the screen; the air strike's bombs also went off up there
  instead of on the target. Both come down under it now.
- **Freezer**, a super after Frieza's finger (one per worm, unlocked from turn 2). The worm takes
  the emperor's last form (white, a purple dome on its head, a dark purple aura) and holds out a
  finger while a pink light gathers on its tip. The light flies to the nearest enemy in plain sight
  within 340 px (a LOCK ON marker shows who) and sinks into its body (?!). The victim floats up,
  glowing pink from inside, and swells, throbbing and beeping faster and faster while pink light
  breaks out through its skin, until it bursts: twice the pieces of a normal death, a ring of blood
  and blood all over the lens, and a blast that hurts whoever stands close (the attacker too).
  A worm that bursts is gone, whatever its health. Then ¡KRILIIIN! and the emperor laughs, HO HO
  HO! With nobody in sight the light fizzles out. The CPU uses it too, unless a teammate stands in
  the blast.
- **Gear 5**, a super after Luffy's Sun God Nika (one per worm, unlocked from turn 2). The drums of
  liberation beat four times (DON!) while the worm turns white, the sun god's rays spin behind it
  and a cloud of white steam wraps its neck; it awakens with GEAR 5! and the straw hat pops on. Its
  rubber arm shoots out to the nearest enemy in plain sight within 200 px (a LOCK ON marker shows
  who), grabs it and reels it into a giant mouth that bites it four times (CHOMP!, and blood
  everywhere) and swallows it whole: a worm eaten is gone, whatever its health. Then the worm burps
  the bandana, the bones and an eye back up, and laughs. With nobody in reach the arm grabs at the
  air. The CPU eats whoever it can reach.
- **Kamehameha**, a beam super (one per worm, unlocked from turn 2). Aim it like a gun and fire:
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
  weapons, utilities, health, or a power orb that recharges a super. The worm that collects a
  crate receives the reward.
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
| Gear 5 | Select it in the inventory, then press and release Space (costs 50 hp) |
| Freezer | Select it in the inventory, then press and release Space (costs 50 hp) |
| Saibaman seed | Select it in the inventory, then press and release Space |
| Antares, Explosión de Galaxias, Hiken, Zoltraak | Select it in the inventory, aim with Up/Down, then press and release Space |
| Tesoro del Cielo | Select it in the inventory, then press and release Space: it seals the nearest enemy in sight |
| Meteorito | Select it in the inventory, then click where it should fall |
| Santoryu | Select it in the inventory, move the square with Up/Down, then press and release Space |
| Explosión Final | Select it in the inventory, then press and release Space: it goes off where the worm stands |
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
- `src/sim`, `src/terrain`: physics and destructible terrain; `src/terrain/scenarios.ts` and
  `src/terrain/scenarios/` build the Spaceship, the Castle and Kame House into the mask, and
  `src/game/scenery.ts` draws each map's sky, water and props (engines, flags, palms, the sign).
- `src/weapons`: weapon definitions and behavior dispatch.
- `src/game`, `src/engine`: controller, rendering, animation cues (`fx.ts`), gore (`gore.ts`), the
  supers' camera work (`cinematic.ts`), input, sound, and HUD.
- `src/sim/combo.ts`, `src/weapons/behaviors/combo.ts`: the Ryuko Ranbu's timeline and target lock.
- `src/sim/beam.ts`, `src/weapons/behaviors/beam.ts`: the Kamehameha's charge, flight, tunnel and hits.
- `src/sim/devour.ts`, `src/weapons/behaviors/devour.ts`, `src/game/gear-five.ts`: Gear 5's timeline,
  its grab, and its look (the white, the cloud, the hat, the rubber arm and the giant mouth).
- `src/sim/hex.ts`, `src/weapons/behaviors/hex.ts`, `src/game/freezer.ts`: the Freezer's timeline
  (the light, the float, the swell and the burst), its lock, and its look (the emperor's form, the
  pink light, the glow and the swelling).
- `src/sim/sprout.ts`, `src/weapons/behaviors/sprout.ts`, `src/game/saibaman.ts`: the Saibaman
  seed's timeline (the planting, the cracks, the leap), where it goes in, and its look (the seed,
  the mound, the cracks and the light through them); `src/sim/worm-size.ts` makes a small worm a
  small target everywhere.
- `src/game/power-orb.ts`, `src/match/crates.ts`: the power orb's look, and what it recharges.
- `src/weapons/defs/anime.ts`, `src/sim/techniques/`, `src/sim/technique.ts`: the Anime row's seven
  techniques and their timelines; `src/match/seals.ts` holds the Tesoro del Cielo's seals and the
  turns they steal; `src/game/antares.ts`, `galaxian.ts`, `tenbu.ts`, `hiken.ts`, `meteor.ts`,
  `santoryu.ts`, `zoltraak.ts`, `final-explosion.ts` and `technique-fx.ts` draw them;
  `src/ai/technique-eval.ts` scores them for the CPU; `src/match/super-rest.ts` holds the rest
  between a worm's supers.
- `src/ai`, `sidecar`: CPU planning and optional local model service.
- `public/audio`, `public/sprites`: packaged game assets.
- `tests`: unit, integration, and browser regression tests.

Personal project, not affiliated with Team17. Art and audio were generated for this game.
