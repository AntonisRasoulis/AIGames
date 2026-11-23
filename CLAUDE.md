# Fire Run: guide for working on this game

Read this first. It covers what the game is, how it's built, the rules of thumb the game follows,
how the owner likes to work, and what's still to do. The README has the detailed numbers for every
mechanic (keep it up to date when you change one).

## What the game is

**Fire Run** is a pixel-art endless runner in the browser, for 2 players on one keyboard (or 1 player; or 3-4, v7.61).
The screen is split: Red runs on top (W A S D), Blue on the bottom (arrow keys). Both race through the
**same** endless course while a wall of fire chases them and keeps speeding up (35 px/s, +0.9 px/s every
second; runners do 96 px/s). The fire catching you ends your race; the last one left wins. Dying to a
danger is not the end: you respawn a little behind (1 s later, 40 px back, on a safe spot), so dying
costs ground to the fire. 1 Player: one big view, race the fire for distance (best is remembered).

- Plain HTML, CSS and JavaScript. No frameworks, no build step, no sound or image files: the sounds
  are synthesized (sound.js) and the art is drawn in code (sprites.js).
- Repo: `AntonisRasoulis/VibeCodingPractice`. Development branch: `claude/nice-meitner-muga6l`
  (a fresh chat may be given a different branch: use the one you're told).
- Published as a claude.ai Artifact (a single bundled HTML file):
  **https://claude.ai/artifact/Uh5CKSPymdWERadhojnY7P** (Version 183 at the time of writing). Always
  republish to this same URL (pass it as `url`); never create a new artifact for the game.

## Style

- **Look:** chunky pixel art. Each view is 400 x 120 game pixels (a tile is 8 px, 15 rows), drawn at 2x.
  Font: "Press Start 2P". Sprites are rows of letters (one per pixel) turned into canvases
  (`spriteFromRows`), or drawn pixel by pixel in code. Glows are pre-made soft circles (`makeGlow`,
  `drawGlowAt`), drawn in steps so they still look like pixels.
- **Feel:** fast, readable, a bit silly, always fair. Every danger gives you a warning and a way out.
- **Words in the game:** short, shouty pop-ups ("ZAPPED!", "HOOKED!", "FLOATING!"), and the
  How to play section in index.html in plain, friendly English.
- **Code:** comments in plain, simple English that explain *why*, matching the style around them. All
  tunable numbers live in `config.js` as named objects with a comment on every value (e.g. `SAW`,
  `TURRET`, `SPORES`). Keep functions near their siblings and follow the existing patterns.

## How the code fits together

Scripts load in this order (all globals, no modules), each with a `?v=` cache-busting stamp in index.html:
`config.js` → `sound.js` → `level.js` → `player.js` → `sprites.js` → `render.js` → `game.js` → `main.js`.

- **config.js:** every number worth tweaking. Also `BIOMES` (the normal rotation), `SECRET_BIOMES`
  (`forest`, `ruins`, `camp`), `BIOME_NAMES`.
- **level.js (`Level`):** the endless course, built in sections just ahead of the leader (`ensure`,
  `addSection`, `SECTIONS.*`). `cols[col][row]` holds tiles (`T_EMPTY`, `T_GROUND`, `T_SPIKE`,
  `T_SHOOTER`). Obstacles are arrays on the level (`maces`, `saws`, `shooters`, `platforms`, `orbs`,
  `turrets`, `flytraps`, `sporeShrooms`, `sleepShrooms`, ...). Seeded random (`this.rng`), so a level
  can be rebuilt from its seed. Biome changes come at a wooden sign (`newBiome`), every 250-450 tiles.
  Key helpers: `groundTop(x)`, `threatened(x, y)` (could anything hurt someone standing here?),
  `safeSpotBefore/After(x)`, `biomeAt(col)`.
- **player.js (`Player`):** running, jumping, collisions, hazards (`checkHazards`), dying and respawning.
  `update(dt, input, level)` gets the course the player is on. Hitbox 6 x 11.
- **game.js (`Game`):** the loop (fixed step of 1/120 s), input, the fire, and everything that isn't
  part of the course: orbs and powers, missiles, bears, vultures, jaguars, turrets' arrows, hands,
  drones, monkeys, loose saws, the sleep mushroom and forest trips. `Game.world` holds all live state.
  `Game.start(players, { biomes, biomeList, wild })`.
- **render.js (`Renderer`):** draws each player's view (`drawView`) and the text on top (`drawText`).
- **sprites.js:** all pixel art, built once at start (`buildSprites`).
- **3 and 4 players** (v7.61): picked with the 1 2 3 4 buttons (start screen, top left, runners' colours; one Play button).
  Green T F G H, Yellow I J K L (`CONTROLS`, `RUNNERS`). Every view full size (`Renderer.layout`: 4 = 2 x 2 grid, Red Blue / Green Yellow; 3 = Red Blue on top,
  Green bottom middle, v7.64); the picture is twice as wide, fit inside the usual box (`object-fit: contain`) and the race goes fullscreen
  (`.game-wrapper.grid`). Caught = out, race goes on till one's left. Powers aimed at "the other player" go for the leader,
  or second place if you're the leader (`rivalOf`, `leaderAhead`); the bolt and the hand catch whoever they touch. Still a
  2-player game at heart: always keep 2 players working exactly as before.
- **main.js:** the page around the game: Start buttons, Biomes on/off and the biome picker (regular biomes, and a
  "Secret biomes" row: the forest and the ruins; all regular ones off = a race in the secret ones as plain biomes, no timer or exit (v7.5); forest off = no sleep mushrooms, ruins off = no portal, with Biomes on or off since v7.60), Mode
  (Normal / Wild), the **multipliers** (v7.49, `TUNING`: Speed and Jump 1-2x, Fire wall 0.5-1.5x, sliders in the start
  screen's top right, behind a Multipliers button since v7.50, with a mark under each step), biomes **still being made are locked** (v8.10: `DEV_BIOMES` = camp; password "shaw", the owner's, kept as a hash in `DEV_LOCK`; off every time the page opens, unlocked for the visit; presets include them only once unlocked; take a biome out of `DEV_BIOMES` when it's finished), the **Presets** (v8.9: `PRESETS` Standard / Basic / Full set the biomes and reset the multipliers; 1-player bests per preset and mode, `fire-run-best-<preset>[-wild]`, Custom keeps the old key; a race with a multiplier changed saves no best), the **Secret biomes: special / regular** switch (v7.47: a squared-off sliding toggle, gold since v7.48, knob left = special, right = regular; v7.46, `secretRegular`: regular puts the secret biomes left on into
  the rotation like any biome, no sleep mushroom or portal), Sound, Pause, win counters, best distance (all remembered in `localStorage`).

### Important patterns

- **Shared dangers are worked out from the clock.** Maces, saws, shooters' spikes, moving platforms,
  river logs, spore and sleep-mushroom spores: positions come from `world.time` (or `level.time`), not
  stored state, so both players' views always agree and nothing drifts.
- **Per-player copies** where each player should face it themselves: crumbling platforms, icicles,
  coconuts, bear traps, tumbleweeds, rolling snowballs (`fallState`, `icicleState`, ... on the player).
- **"Caught" means out of the race.** Nearly every system skips players with `caught` (and usually
  `dead` / `held`). The forest trick below relies on this.
- **Realms (the enchanted forest).** A player in the forest has `p.realm` = a separate `Level` (biome
  `forest`, with `realmEnd`) that covers the same x positions as the main course, so distance and the
  fire carry over naturally. Each step: every player updates on `p.realm || world.level`; then
  `onCourse(level, fn)` runs the main course's systems with everyone who's elsewhere temporarily
  marked `caught`, and each forest gets its own (loose saws, spores, sounds). Each view draws its
  player's course (`render`: a `view` object with `level` swapped and the main course's creatures
  emptied). Particles that belong to a course carry `level` so they only show there. Drawing code must read the `view` object's
  fields (`world.monsoon` etc. there), never Game's global state for main-course things: v8.8 fixed a freeze where the flood
  was drawn in a realm view (Game.floodSurface said water, the view's monsoon was null). The loop asks for its next frame
  first (`frame`), so a thrown error loses one frame, not the game. Getting in and
  out: `p.dream` ({ kind: "sleep" | "fireflies", t }), `moveTo`, `makeForest`, `dreamDark`.
- **Powers:** an orb sets `p.power` (one at a time); S / Down calls `usePower`. Solo mode swaps some
  powers for helpful versions (drone and firehawk guard you, snowball gives skates, monkey ferries you
  forward). The HUD label maps in `drawText` need an entry for every power (missing ones showed
  "undefined" once).

## What's in the game now

- **Shared obstacles:** steps, spike groups, pits, floating / moving / crumbling platforms, blue-to-orange
  portals, swinging maces, diagonal spike shooters, saw blades (in a ground slot, on a pole, in a pit).
- **Biomes** (off by default, turned on with the Biomes button; the arrow picks which): **prairie**
  (missiles, bear traps, bushes to hide in), **taiga** (`snow` in the code: ice, icicles, rolling snowballs, thin ice over
  ponds, bears), **desert** (cactuses, quicksand, tumbleweeds, sinkholes, vultures), **jungle** (bamboo
  and thorn bushes, rivers with drifting logs, palms dropping coconuts, flytraps, jaguars and panthers,
  ancient turrets shooting arrows: plain, poison, sleep and blunt). Biome dangers start at 400 m
  (some at 500 m). **Wild mode** brings everything from the start, faster, and more of it.
- **Orbs** (about 3 per biome): **gold** works at once (swap places, freeze, dash; sandstorm, snowstorm,
  monsoon in their biomes). **Light blue** is used with S / Down (wind dash, lightning, mystic hand,
  rescue drone; firehawk, snowball, monkey in their biomes). **Purple** catch-up orbs appear only for
  whoever has fallen off the leader's screen (alone: when the fire is on your screen), out of sight of
  both, just one per player per race (`catchupGiven`): portal gun, grapple (2 players only), vine. **The portal gun** (v7.62, owner:
  the grapple's opposite): takes you halfway to the leader (safe ground, never past them; you're the leader: you keep it);
  alone, the next biome (biomes off, 3 obstacles). (v7.32-7.61 it went to the next biome, never past the leader.)
- **The enchanted forest** (a hidden biome, never in the normal rotation): reached by falling asleep
  under a **sleep mushroom** (purple, spore-mushroom style, exactly one per race, on the main course after
  400 m: one chance at the forest, `sleepPlaced`; a slow light rain of spores for 3-10 s, then 10 s rest; its cap glows just before). You wake in
  a twilight forest 156-216 tiles long (v7.42: 13-18 s of running, the shortest as long as a ruins trip; it was 100-250, then 180-264) (fireflies, glowing mushrooms, thorn-vine spikes, all obstacles
  restyled in dark purple wood: no brown). The forest is "secretly out to get you": 1 in 5 saws breaks
  loose with a faint magic, bursts out and rolls at you half-buried with a magic trail; spike shooters
  float left and right (rideable), sometimes stacked 2-3 high; crumbling platforms are rotten branches that
  snap after 0.7 s of standing on them in all (`FOREST.branchHold`, `snap` platforms) and you drop; **bouncy mushrooms**
  over some gaps (`BOUNCY`, orange caps on twisting stems; bounce higher the faster you land, press jump on
  landing for a spinning super bounce; some sway, rotten ones pop after one bounce, per player); **Mushroom Lobbers**
  (`LOBBER`, lilac puffballs that lean at the nearest runner and lob a little mushroom once a second: red kills,
  green kills after 3 s of poison screen, pink floats you off the top, blue wakes you up with no gifts:
  `updateLobbers`, `lobHit`, dream kind `woken`); **alive trees** (`ALIVE_TREE`, look like background trees but
  sway; the ground cracks where you'll be, then a root that kills; each tree's first attack is a grab that pulls
  you under and wakes you up: `updateAliveTrees`, `drawAliveTrees`, `drawTreeStrikes`); **spore mushrooms** (curvy S stems; red =
  faster, blue = higher jumps, green = poison screen, 10 s; pink = float up for 5 s; they stack). At the
  end, fireflies (the background's too) swarm you into a ball of light and you wake on the main course
  at the same distance. The only orb in the forest is its own **mushroom orb** (v7.24, below), and it's the only power you can use there (you keep the others).
- **Leave, the forest's walking tree** (v7.54, `LEAVE`, `level.leaveTrees`, `updateLeaves`, `drawLeave` / `drawLeaveFront`;
  designed in mockups: it closely resembles a background tree, bare, no eyes): near the start of 1 in 3 forest stretches
  (from 400 m) and 1 in 5 dream forests. Asleep until someone's past it (running through it from behind is harmless), then
  it follows through its forest (never leaving it): 40 px in from the left edge of the furthest-behind runner's screen
  (hurrying at 170 px/s), otherwise creeping at you at 32 px/s, walking on five roots slammed down one at a time. Every
  3-4 s it attacks (v7.55: still creeping at its normal speed while it does, never hurrying; v7.54 stood still), never the same twice in a row: **roots** (one, or two if everyone
  can see it, curl up and slam steeply into the ground just in front of it; a glow races underground; the ground cracks
  0.6 s where you'll be, never behind you; a 42 px spike: stop short), **leaves** (grows a canopy, three bursts each
  tearing a third off, swooping into a bunch and flying at you, low = jump, high = stay down; regrows after 15 s),
  **seeds** (3-5 flung round the leader; 1 s later Lobbers 60% / spore mushrooms 10% each grow and stay, `born`).
  v7.56: half the seed attacks, one seed grows a **Spore Lobber** instead (`LOBBER.dark`, `lb.dark`; D3 midnight blue with a
  muted pale moon blue pore, P2; one alive at a time): as soon as it's grown it lobs 10, one every 0.1 s (no blue), then
  bursts in a puff of dark spores (v7.59, design B, `drawWither`). Touching it: grabbed, thrown forward 80 px, spiked; you respawn at least 40 px in front of it (`Player.die`).
- **The forest's orb: the mushroom orb** (v7.24, `MUSHROOM_ORB`, power `"mushroom"`; icon chosen E2: a red toadstool with a white
  "?" on a 12 x 12 light blue orb): on an all-forest main course (30% of orbs) and the only orb in the dream forest. S / Down
  throws a mushroom straight up (showing its colour); after 1 s it always lands on you: one of the 4 spore mushrooms, 1 in 4
  each, their effects and times (`giveSpore`). Only affects you.
- **The forest's reverse orb** (v7.29, `REVERSE`, `p.reversed`; gold, icon v7.36: P3, a 12 x 12 gold coin with a spinning purple spiral (`drawReverseOrb`); over your head a spinning hypnosis spiral, v7.35: S2, just the line, no disc): everyone
  on that course (the grabber too) for 8 s: left/right swap and jump/action swap (in `readInput`). All-forest course (15%) and
  the dream forest (35%, the rest mushroom orbs), alone too.
- **Skates for the snowstorm's winner** (v7.33; the owner likes the name skates: shown as SKATES, code `crownIceWalker`,
  `Player.iceWalker`): 2 players: when a snowstorm ends, whoever moved further during it gets the 1-player skates for good (1.5x faster on ice), taking it from the other; a tie changes nothing.
- **The sandstorm blows orbs** (v7.30, `blowSandOrb`, `updateSandOrbs`, `SANDSTORM.orbs` ...): 3-6 random light blue orbs from
  any biome (alone: only ones that work alone) blow in, one at a time (v7.31), from the right of the leader's screen, left at 125 px/s, bobbing; grab
  them. Other player off the leader's screen: 2 fly over the leader too high, then sink for the one behind
  (those 2 come at their own times, alongside the others).
- **The ruins' orb: the laser gun** (v7.25, `LASER_GUN`, power `"laser"`; icon G2 rune blaster; v7.26: the beam is the ruins' own teal laser, `drawBeam`): on an
  all-ruins main course (30%) and the only orb inside a ruins trip (usable there). 0.3 s aim line, then a laser the way you
  face, chest height, through everything, forever, 0.5 s (deadly only the first 0.25 s so a jump during the aim line clears
  it: tested). Kills ("VAPORIZED!"). Alone: fired backwards it pushes the fire back 6 tiles; facing right, you keep it.
- **The ruins' blackout orb** (v7.27, `BLACKOUT`; gold, icon K2 eclipse; darkness D1 pitch black, owner: "only LASERS/the blue
  lights glow"): 8 s (v7.43; was 5) of pitch black on that course for everyone there, a circle of light round each runner (4 tiles across;
  the grabber 7), lights flicker off and on; only teal / blue pixels glow (`drawBlackout`, on its own canvas: never read
  pixels back off the main buffer, it makes all later frames ~3x slower). All-ruins course and ruins trips, alone too.
- **Trips cost no ground** (v7.45, `travelGain`): going into or out of the forest or the ruins, you come out as far on as
  you'd have run in the time it took (not when the ruins' clock runs out).
- **Known slow spot:** the mortar's explosion (v7.22, drawn pixel by pixel) adds up to ~12 ms a frame while it's on screen.
- **Magic feet** (the forest's gift, `MAGIC_FEET`): coming out of the forest, you have it for the rest of
  the race. Magic holds you up over every hole: pits and rivers get a magic bridge as you get near
  (`updateBridges`); quicksand, sinkholes and thin ice still go off, then a bridge catches you
  (`Player.magicCatch`). A bridge is an invisible platform (kind `bridge`, first in `level.platforms`);
  all you see is the floating shooters' magic in a little stretch under whoever stands on it. Anyone can
  use it: 2 s after you've left it (then a 1 s fade), never from under someone. Bear traps unchanged.
- **The roots** (the forest's other gift, `ROOTS`, power `"roots"`): you come out holding them. Used, dark
  wooden roots grab the other player anywhere (no dodge), one coiled round them and four stabbing in turn
  for 5 s (mash jump: down to 2.5 s), fling them back onto safe ground and impale them on a last root
  (`rootGrab`, `updateRoots`, `world.roots`; drawn by `drawRoots`). Alone: they go off when the fire is
  close and hold it still for 5 s (`world.rootWall`); alone they're not a power at all (`p.rootGuard`, you keep yours).

- **The military camp** (the third secret world, v8.0; a first version: its own dangers, challenge and gift still to be
  talked through, owner said "will figure out"). Look chosen A: a realistic daytime army camp (tents, sandbags, watchtower,
  barbed-wire fence, olive drab); barbed-wire coils for its spikes (`makeCampLayers`, `makeCampTile`, `makeCampWire`). Way in
  (owner's design): once per race after 400 m a twin-rotor helicopter (v8.1: chosen T2, desert camo; tips into its motion, turns
  smoothly, rotors spinning, rope a damped pendulum tied under the ramp) flies in from the right; jump and grab the loop; it carries on 5 s (others can grab on), then climbs away into the camp (`updateHeli`, `world.heli`, `makeCamp`,
  `p.flight`). Miss it: gone. Fire on a rider's screen while carried (or within 0.8 s): it pulls away at once, flies them at twice the
  fire's speed until they're 100 m ahead of the fire, and the prairie's missile shoots it down (they die, back to life there); v8.2: it crashes and its wreck stays (`world.wrecks`). Way out (owner's design): v8.3: a jet parked at the camp's end, canopy open: jump into the cockpit (only the first
  gets it: `CAMP_JET`, `level.parkedJet`, `updateParkedJet`, `drawParkedJet`, `p.cockpit`); it rolls, takes off over the helicopter,
  and the screen fades. The rest board the helicopter standing past it: its two doors in the middle slide open left and right
  as you come (`ph.door`, `drawHeliDoors`; owner's ask); waits 5 s from the last one in; flies them back and they jump out
  (`updateParkedHeli`, `world.dropHelis`); if anyone's left in the camp it comes back and lands ahead of them. The jet flies
  in from the left over the main course carpet-bombing it (v8.4: the bombs hurt: each marks where it lands, a jump clears the blast, "BOMBED!"; `JET.blast`, `bombFrom`), then you parachute down
  where you'd have got to (`p.jet`, `world.jetBombs`, `drawJets`; `trackX` is the landing spot while flying). Camp is a
  secret-biome chip (`campOn`), regular-mode and all-camp races work.
- **The arcane ruins** (the second secret world; **a first, playable version is built**, v7.0): a portal on the
  main course (one per race after 400 m) with a button under it; inside, a 20 s race (v7.6; it was 60 s) to an exit portal past fire
  turrets, laser eye-stones and gear lasers, crumbling as time runs out; escape for the aurora's preservation.
  Code: `RUINS`, `FIRE_ROW`, `EYE`, `GEAR_LASER`, `AURORA` (config); `Level.ruinsGates`, `fireRows`, `gearLasers`,
  `stones`, `exitPortal`, `fireFlames`, `eyeState` / `eyeBeams`, `gearState` / `gearBeam`, `beamHits` (level);
  `updateRuinsGates`, `makeRuins`, `updateRuins`, `startTrip` / `updateTrips` (`p.trip`: in, out, fail),
  `world.builtPortals`, `auroraPush` (game); `drawRuinsBackground`, `drawRuinsTile`, `drawFireRows`, `drawEyeStone`,
  `drawGearLasers`, `drawRuinsGates`, `drawBuiltPortal`, `drawAuroraLights` (render). The full design (and what's
  still to build) is under "Still to do" below.

## Rules of thumb for designing

- **Always fair.** Every danger can be dodged by a normal player: jumpable heights, warnings before
  things fire or break, and there's always a safe spot to stand and wait between two dangers (tested).
  Respawn spots are never somewhere a danger reaches (`threatened`).
- **New players first:** biomes start off; special dangers wait until 400 m (except Wild mode).
- **Both players get the same course;** whatever affects "the other player" needs a sensible 1-player
  version (or is left out alone).
- **Check the numbers with tests,** then write them in the README (e.g. "caught 9 times in 10",
  "always lands at least 74 px from a pit").
- **Keep it readable at 400 x 120:** strong outlines and contrast against the background (dark things
  on dark purple vanish), glows for magic, warnings that read at a glance.

## How the owner likes to work

- **Before a big feature: ask questions first,** as lettered options in plain text (A / B / C), several
  numbered questions in one message. Don't use the AskUserQuestion tool: the owner couldn't see its
  options. Give a recommendation when you have one.
- **Show sprites before building art:** draw mockups / drafts (an HTML page with canvases, screenshot
  with Playwright, send the image) and get them approved. Expect a few rounds of "make it curvier",
  "no brown", "more subtle".
- **Make a captioned video** of each new feature on a test course and send it (record with Playwright's
  `recordVideo`, add captions as page overlays, crop with ffmpeg: 2 players `crop=800:484:50:6`,
  1 player `crop=800:240:50:2` after skipping the first ~3.4 s). Videos and mockups go in the
  scratchpad only, never in the repo. Check them with contact sheets of frames before sending.
- **Answer questions with numbers** when asked ("how many orbs per biome?" → a measured number).
- **Version:** `GAME_VERSION` in config.js, shown left of the logo (e.g. v6.16). Big updates (a new biome or
  secret world) bump the first number and reset the second; every other shipped change bumps the second.
- **Shipping every change:** test → bump `GAME_VERSION` → bump the `?v=` stamp on all 9 tags in index.html → bundle
  (`python3 tools/bundle.py . <scratchpad>/fire-run.html`) → smoke test the bundle
  (`node tools/smoke-test.mjs <absolute path>`) → commit (with the attribution lines the session asks
  for) → push to the branch → republish the artifact to the same URL. Update the README and the
  How to play section (index.html) for any new mechanic.
- Commit when asked to (a stop hook may ask you to commit outstanding work).
- Use they/them for the owner.

## Testing

- Playwright is at `/opt/node22/lib/node_modules/playwright/index.mjs` (Chromium pre-installed).
- Use `page.clock.install()` and `page.clock.runFor(ms)` for exact, fast tests. Errors thrown inside the
  game loop can be silent: wrap `requestAnimationFrame` to catch and log them.
- Common setup: `Game.start(...)`, hide `#game-overlay`, set `world.state = "playing"`,
  `world.countdown = 0`, build a test course (`new Level(seed, biome, { biomes: false, solo })`, then
  `l.flat(n)`, clear arrays you don't want, `l.addSection = function () { this.flat(40); }`), and drive
  players by wrapping `Player.prototype.update` with your own input.
- A 1-player test level must be made with `{ solo: true }` (otherwise it has swap orbs, which need a
  second player).
- Screenshots can advance the game a few frames, so a state can move on between your check and the
  picture.
- Worth re-running after changes: "a safe waiting spot between every pair of dangers" across many seeds
  and biomes, respawn distances, orbs per biome (about 3), and a full 2-player race with biomes on.

## Still to do / ideas parked

- Maybe a forest animal (a shadow wolf or an owl were offered; the forest's chaser is now Leave, v7.54).
- The floating shooters' stumps and thorns are small and dark: could be made easier to see.
- The **arcane ruins**: a first version is built (see above). **Still to build:** (v7.51-7.52: saws and maces are replaced by laser gates and laser swords there), more of its own dangers (to be
  talked through), teal mist in its pits. The full design the owner settled:
  - **A race against the clock:** you have **20 seconds to reach a set point** (v7.6: cut from 60 s, which is a long time in this game; v7.12: 130 tiles after 12 calm ones, so one death is fine but two are too many) in the ruins. Fail and you
    die and come back on the main course ("back at the top somehow": details to settle). Make it and you
    win its gift (like the forest's).
  - **The gift: the aurora's preservation.** Aurora lights circle round you for the rest of the race.
    They **block any attack** once, keeping you alive, then disappear and **come back after 5 seconds**.
    Each time they're back you can also **use them** with the action button: they disappear (recharging,
    the same 5 s) and give a **big, close-range circular push** that shoves away anything alive (the
    special creatures: bears, jaguars, ...) and the other player too. So: a shield and an attack that
    never run out, but share one recharge. Settled details:
    - The shield blocks **everything that would kill you except the fire and falling into a pit**.
    - **v7.16: the push was taken away: it's just the shield.** Its look (chosen A): three light spirits with shimmering tails
      weaving round you, bursting out in rings when they block, fading back in.
    - The other player is just **pushed back a bit** (no stun).
    - **Alone**, the push also **shoves the fire back a little**.
    - It **stacks** with the forest's gifts (magic feet, the roots): one player can have all of them.
  - **The way in: a portal** on the main course, in the ruins' style: its frame is rocks stacked tightly in a
    circle (none can drop out). **The portal itself (chosen: design A, the aurora vortex):** a deep navy well
    with four thin teal and green aurora streaks curling in towards a black centre, faint stars deep inside
    (dark and mysterious, not the bright blue swirl first mocked up). All the ruins' portals use it. It starts **turned off**. Right below it
    is a **button**: run over it and the portal turns on, and aurora lights burst violently out of it, **grabbing
    anyone nearby** and pulling them in. That grab only happens that first time: after that, anyone can
    **jump into the portal** if they want to. **Press the button a second time and the portal breaks apart**
    (no more way in). Settled details:
    - **One portal per race**, after 400 m, like the sleep mushroom (a race can have both).
    - The first grab pulls in **anyone within about 5 tiles (40 px)** of it.
    - **Anyone's** second press breaks it, the first presser's too (in 2 players: go in, and your opponent may
      not get to follow).
    - Afterwards, the portal **floats a little above the ground**: you have to **jump into it** on purpose;
      running under it doesn't take you in.
    - The button is **flush with the ground**: you press it just by running over it, so to *not* press it you
      have to **jump over it**.
  - **Running out of time:** the ruins **fall apart while you run**, and the aurora snatches you out at the end.
    Small cracks from the very start (dust trickling), worse in steps at 12 s, 7 s and 4 s left (were 30 / 15 / 10 with the 60 s clock) (pillars
    leaning and toppling in the background, stones dropping, the aurora flickering, the screen shaking at the
    end): you can see time running out. In the **last 4 s, real stones fall on the course** (a shadow on the
    ground first, like the floating rocks). At zero it all comes crashing down ("TIME'S UP!"), and at the last
    moment the **aurora grabs you and throws you back through a portal onto the main course, about 10 tiles
    (80 px) behind** the distance you'd reached, with no gift (never dropping in from the top of the screen).
  - **How tight the clock is:** fair but tense. Sized so that a runner who never has to stop or turn back can die
    **once and still make it, but not twice** (v7.12; it was 3 but not 4) (measure what a death really costs: the 1 s respawn plus the
    ground lost, and size the goal's distance from that).
  - **Timer and goal:** a big countdown at the top of your view, in the ruins' colors (teal / aurora, not
    red), turning red only when you're running out of time; a bar shows how far the goal is.
  - **The goal: an exit portal** at the end of the ruins, in the same style as the way in (rocks stacked in a
    circle, blue with some green). You **jump into it** to escape, and that gives you the gift. Back on the
    main course, the portal you come out of **builds itself**: grey bricks fly in and lock together in a
    circle, the portal opening in the middle of it (the same style as the other portals), and out you come.
    Settled: the exit portal **floats a little** (jump into it, like the entrance after its first grab); the
    built portal on the main course **falls apart** again once you're out (its bricks dropping and crumbling
    away); and when time runs out, the portal the aurora throws you through **builds itself the same way**.
    **Arriving in the ruins** works the same way too. The built portal (mocked up): grey bricks start as **an old
    structure nobody has touched in ages**: the top half of the old ring sticks up out of the ground like a
    half-buried arch (its end bricks broken off), the rest fallen round it (lying, one leaning on the arch, one
    on its end, one on an old mossy stone stump, a few sunk so only their tops peek out: never piled up), all
    overgrown (grass over their edges, a vine draped over the arch, little flowers). They shiver awake in place, hop up tumbling, swirl into a circle and clack into
    place (one latecomer last), then the portal opens; falling apart, they drop back down. The bricks have
    **personality**: each its own size and shade of grey, some mossy on top, some with a little crack, two
    with a small glowing teal rune.
  - **The old obstacles there:** restyled in stone and teal magic (like the forest's dark purple wood).
  - **The look (mocked up and approved, following the owner's first mockup closely):** a dark navy-to-teal
    sky with stars and two stepped aurora bands (green over teal); small floating rock chunks with a glowing
    teal rune; dark background pillar silhouettes (broken, jagged tops) and a broken arch; grey foreground
    rune pillars (capital on top, three teal glyphs, a few small cracks); ground of grey stone bricks under a
    mossy grass top, with small teal sparkle crosses; stone slab platforms with glowing teal dashes; teal mist
    in pits. **Wear and tear:** only short (3-6 px), jagged stone cracks with a lit edge, sometimes forking,
    a few crumbs of stone at ground edges and pillar feet, faint dust drifting down. **No missing square
    chunks of rock** (the owner didn't like those). Fire turrets: a stone vent flush with the ground, glowing
    teal slots; flames teal / aurora-green with a white-hot core, a soft glow, licks breaking off the tip
    (low about 11 px, tall about 46 px: higher than a jump's 39 px).
  - **2 players:** **one shared clock**, starting when the portal opens: whoever jumps in later has less time
    (and the collapse is the same for both).
  - **Its own dangers** (being talked through one at a time; others offered: rune pillars firing beams, magic
    flames that flare up, floating rocks that drop, rune tiles that burst, a guardian statue, gravity runes):
    - **Fire turrets** set in the ground, **replacing the spikes** there (like the forest's thorn vines):
      rows of **1-10** turrets, **teal / aurora-green magic fire** (not orange like the wall of fire), and
      touching it kills ("SCORCHED!"). Every row works the same way (there's no plain, always-on version):
      the fire runs along the row one turret at a time, **left to right, then right to left**, at different
      **speeds and heights**: some flames are **low** (jump over them as they pass), some **tall** (too high to
      jump: slip through behind them), and some **switch between high and low** as they go, so you have to
      time it *and* jump. On **big rows, several fires** can be running along it at once. **v7.7 (too hard to dodge):** a flame is only tall while running right (coming back it's low); only low-flame rows get a second fire (low on fast rows, low or switching on slow ones); speeds 6-10 turrets/s (you run 12). A turret's grate glows and puffs sparks as it
      changes, **just for looks** (not a warning). Fairness still applies (there must always be a way
      through: test it).
    - **The spike shooter, redone as a laser eye-stone** (v7.8 redesign, chosen G3 + star: a round grey stone with four carved
      points, a teal crystal at each tip, a 4-point star of energy in the middle aimed at the tips; nothing moves, light fills the
      star from the middle out during the warning; beams start at the crystal tips; v7.9: beams animated in `drawBeam`: flash, crackle, racing pulses, sparks). Older notes: a round stone with a narrow
      teal eye (the old shooter's place and rhythm, shared by both players). **Warning: 0.4 s**: the eye opens
      wide, the corners glow and faint dotted teal aim lines show exactly where each beam will go. Then each
      corner fires a **laser that's there instantly, all the way to whatever it hits** (white-hot core, teal
      edge, a glow; sparks and a scorch mark where it hits the ground), held for **0.5 s**, then fading. Beams
      stop only at the ground, walls and the screen's edge: they **go straight through players** (one beam
      can hit both). Fairness: test there's always a safe spot and time to get out of the lines.
  - **The laser gate** (v7.20; design chosen after many mockups: CH1, chain lifts: carved posts with a big and a small cog,
    the emitter on two chains, a rune counterweight opposite; v7.21 base B1: carved steps, iron brackets, a rune band lit while it's on): a laser between two of them, 4-12 tiles apart, sliding up
    and down, firing (v7.39) one 0.25 s shot going up and one going down (each gate at its own point 25-75% through the
    slide), 1 s dotted warning before each. `LASER_GATE`, `laserGates`, `laserState`. **v7.51:** they replace the ruins' saws (no saws there);
    5-12 tiles; half are **vertical** (chosen V3-H: a stone arch, a gear on a chain under it with the laser hanging off its hub,
    firing straight down as it slides left and right; energy runs along the chain from both ends into the gear while it warns;
    `g.vertical`, `drawArchGate`).
  - **Laser swords** (v7.52, `LASER_SWORD`, `laserSwords`, `swordState`, `drawLaserSwords`; in place of the ruins' maces): a laser
    blade hanging from a gear under the arch, swinging like a mace and stretching so its tip always touches the ground (no
    jumping it); off 0.4 s in the middle of each swing, outline flickering back for the last 0.2 s; each its own speed 2-3.5 s.
  - **Electric slabs** (v8.5, owner's design; look E2: a carved rune post at each end, v8.6 lightning L1: a jagged re-striking bolt with forks, white-hot post tips, sparks at the tips as a warning;
    `ELEC`, `p.elec`, `Level.elecState`, `drawRuinsPlatform`): every ruins platform; in a group every other one live, all swapping
    every 1.5 s (0.4 s warning); lone ones (moving, ledge) switch by themselves; live = "ZAPPED!"; the crumbling ones are electric instead. v8.7 (owner): the ruins' only platforms are the sliding slabs (`RUINS.mix`), quick (`ELEC.movePeriod` 1.6 s), and the mortar never fires at a sliding slab's pit (`MORTAR.slabClear`).
  - **Rune tiles** (v7.40, `RUNE_TILE`, `runeTiles`, `updateRuneTiles`, `drawRuneTiles`; the ruins' own trap): a ground tile
    (flush, grass on top) with a crack of blue light; small (step on, 0.3 s: thrown forward), medium (over its middle: launched
    up 76 px), very cracked (comes near: thrown back). The blast pushes away from its middle, never hurts, once for everyone.
  - **The lightning mortar** (v7.22, chosen after mockups: the rune cannon C on a stone plinth, the barrel only at 45 / 90 / 135
    degrees on the pixel diagonals so it's never jagged; bomb T1, the plasma lens orb in the ruins' teal and dark iron). **v7.23:
    just one, infinite range** (owner's answers B, A, B): one per ruins trip; in an all-ruins race one per 250-450-tile stretch
    (only the leader's stretch's one fires). Every 4 s it turns to the farthest runner (however far) and lobs a heavy bomb just behind where
    they'll be if they keep going, a near miss (v7.53, owner's ask; v7.28 it aimed at where they were, before that it led them): climbs 0.9 s, far shots glide along the top of the screen (4x your speed), then a straight drop 0.5 s; no ground
    warning (not even for bombs coming from off-screen), blows up on landing (5 tiles, a real fireball), touching the bomb is safe; v8.11: over a gap it falls through, no blast (`b.pit`).
    `MORTAR`, `mortars`, `mortarState`, `updateMortars`, `bombAt`, `drawMortars`, `drawMortarBombs`.
  - **The storm engine** (v7.16, chosen after many mockups: the arcane engine base with the clockwork tower's cog, a gyroscope
    of two stone rings on an iron yoke): fires a ball of lightning on its own timer; the ball bursts straight out (1 s), then
    drifts after whoever is nearest at half your speed, pulsing white (a turning 4-point star at its heart, no purple) and
    blows up after 3 s (5 tiles; fast, violent, white; blast line for the last 0.6 s). Touching it zaps you. `STORM`, `storms`.
  - **The gear laser** (a new ruins danger of its own; mocked up): a tall stone post (heights **vary**: 6 sizes, 5 to 10
    tiles; v7.4: 3 and 4 were too small) with iron bands and a pipe of teal energy, a housing on top, and a **big toothed gear** (rim, spokes,
    bolts, a rune at the hub) turned by a small drive gear, carrying a **sleek laser emitter** (pale metal,
    cooling fins, an energy line, a lens ring). It **turns** (about 0.6 s), **clicks into place** (a ratchet
    catch drops into its teeth) pointing **always some way down** (v7.2: 40-70 degrees below flat, left or right, in
    10 degree steps, i.e. 220-250 / 290-320 on a circle; never straight down its own post; `GEAR_LASER.below`; picked at random), **warns 0.4 s** (energy runs up the barrel, the lens glows, a dotted aim line), then
    **fires an instant laser** to whatever it hits, held **0.5 s**; then turns again (v7.11: a fair coin toss picks clockwise or anticlockwise, so it often takes the long way round). **Faster ones sometimes
    fake it out**: click into place, hold (no glow) and turn on without firing; slower ones always fire.
    **Its stem (chosen: the carved rune column):** carved stone sections with dark bands, glowing rune panels,
    a teal energy pipe spiralling up it, a stepped base with iron braces, a little moss and a crack; and a
    small **gearbox window**: a recessed housing (shadowed inner walls, a riveted back plate) with **two small
    six-tooth cogs** (hand-drawn 7 x 7, teal axles), **one top left, one bottom right**, meshing on the
    diagonal, each held by an iron bracket from the side wall (so they don't look like they float). They
    **turn with the big gear on top**, opposite ways (their frame comes from the big gear's angle: spinning
    while it turns, still when it's locked). The rune panels and carved bands keep clear of the window.
  - **Portal rework (built in v7.1):** the **main-course portal is the old overgrown
    brick arch** (not the stacked-rock ring): it lies half-buried until the button is pressed, then its bricks hop
    up into a ring, the vortex opens and the aurora grabs whoever's near; the ring then floats open (jump in).
    A second press: the vortex closes and the bricks **tumble back down into the old arch, lying there for good**.
    **Nothing ever just disappears:** portals open and close but always stay. The **ruins' portals** (arrival and
    exit) are a version **not worn by time**: the same ring of bricks, whole and clean (crisp carved stone,
    glowing teal runes), **held up between two carved rune pillars on a carved stone base** (the opening raised:
    you jump into it). Coming out of any portal: the ring builds, you come out, then its bricks **settle back
    into their resting shape** (the old arch on the main course; resting on the base between the pillars in the
    ruins). The ruins' exit uses the clean gateway too. The clean gateway's bricks **rest as a beautiful stone arch**
    (a glowing keystone at the top) that **unrolls into the ring**. Code: `drawBrickPortal(style "old" | "clean")`,
    `drawGateway`, `world.builtPortals` with `state` rest / build / open / close (never removed), `f.arriveGate`.
  - **Biome portals inside the ruins (built v7.13):** **2 per visit: one forced (the clean gateway, run through it; v7.63: only half the time, `RUINS.forcedChance`, also on an all-ruins main course), one
    optional (a small floating ring of stones, jump in; v7.44: 32 px up and only its swirl counts, so running under it doesn't take you in; v7.15: make it through and your clock gets +2 s, `RUINS.timeBonus`,
    `p.ruinsBonus`; it no longer moves you further on)**; stretches 20-25 tiles, v7.17: much harder (Wild, `RUINS.legMix`: mostly the biome's own dangers); v7.19: packed (`legSqueeze`, `trimLanding`, no repeats), ruins 133 tiles; v7.18: an all-ruins race has them on the main course too (from 400 m, `nextLegAt`; `world.mainCourse` set in `onCourse` so `moveTo` knows the way back); ruins 144 tiles so one death is fine, two too many. Code: `Level.biomeGates`, `SECTIONS.biomeGate`, `leg` levels, `enterLeg`,
    `updateBiomeGates`, `updateLeg`, `drawBiomeGates`, `VORTEX` tints. Older plan: each sending you into a **ramped-up stretch of
    another biome** for a while, then back into the ruins. Settled:
    - **Some optional, some forced** (a mix: some you choose to jump into, some sit right on the path).
    - **Which biomes:** only the ones turned on in the picker for that race; if just one biome is picked,
      any of them (all four regular ones).
    - **A visit:** a short stretch of about **40-60 tiles** (5-7 s of running); the clock keeps ticking.
    - **Ramped up:** that biome's dangers **packed closer together** (more of them), at their normal speed.
    - **Dying in there:** you respawn inside the stretch as usual (it costs time).
    - **Look:** the aurora vortex in the rock ring, **tinted with the biome's colours** (green for prairie,
      icy white for taiga, sandy gold for desert, deep green for jungle) so you can tell where each goes.
    - **A stretch replaces that piece of the ruins:** go in at tile 200, run 50 tiles of biome, come out at
      tile 250 (just as far along, a harder way across). A **forced** one is simply part of the path. An
      **optional** one is a **shortcut**: it brings you out further along than its length (e.g. 50 tiles of
      biome coming out at tile 280): harder, but saves time if you don't die in there. (Size the 60 s with
      the stretches counted as part of the run.)
- Ideas offered for more "the forest is out to get you": maces that swing harder when you're close,
  eyes blinking in tree trunks, shooters turning to face you.
