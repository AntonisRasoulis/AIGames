// The game itself: sets up a race, runs the game loop, reads the keyboard,
// moves the fire and decides who wins. The website (main.js) only uses:
//   Game.init(canvas, { onGameOver, onPauseChange })
//   Game.start(), Game.togglePause(), Game.isRunning()

const Game = (() => {
  const STEP = 1 / 120; // physics runs in small fixed steps so it's the same on every computer
  const CONTROLS = [
    { left: "KeyA", right: "KeyD", jump: "KeyW", fire: "KeyS" },
    { left: "ArrowLeft", right: "ArrowRight", jump: "ArrowUp", fire: "ArrowDown" },
    { left: "KeyF", right: "KeyH", jump: "KeyT", fire: "KeyG" }, // (3 and 4 players, v7.61: Green...)
    { left: "KeyJ", right: "KeyL", jump: "KeyI", fire: "KeyK" }, // (...and Yellow)
  ];
  const RUNNERS = [["RED", "red"], ["BLUE", "blue"], ["GREEN", "green"], ["YELLOW", "yellow"]]; // (names and colours, in order)
  const GAME_KEYS = new Set(CONTROLS.flatMap((c) => Object.values(c)));
  // Everything that makes up "where a player is" gets swapped by a swap orb
  const SWAP_FIELDS = ["x", "y", "vx", "vy", "facing", "onGround", "standingOn", "coyote",
    "portalCooldown", "safeSpots", "fallState", "icicleState", "coconutState", "snowballs", "snowballStarted", "onIce", "biome",
    "inQuick", "sink", "quickSurface", "tumbleweeds", "tumbleStarted", "trapState", "trapped", "trapId", "lastWiggle", "wiggleHeld", "hiddenIn", "inSink", "sinkT", "sinkFrom", "inPond", "pondHits", "onPond", "inRiver", "eatenBy", "rotState", "spinning", "spin"];

  let canvas, ctx, callbacks;
  let world;
  let lastTime = 0;
  let accumulator = 0;
  const keys = new Set();
  const jumpQueued = [false, false, false, false];
  const fireQueued = [false, false, false, false];
  let nextBoltId = 1;
  let racesStarted = 0; // the first race after opening the website always starts in the prairie
  let solo = false;     // 1-player mode: one runner, one big view, WASD or the arrow keys
  let count = 2;        // how many runners (1-4; v7.61: 3 and 4 on one keyboard too)
  let biomeList = ["prairie"]; // the biomes this race goes through (biomes off: just the prairie)
  let wild = false;     // Wild mode: the hard one
  let sleepShrooms = true; // are there sleep mushrooms (the way into the enchanted forest) on the main course?
  let ruinsOn = true;      // ...and a portal to the arcane ruins?
  let campOn = true;       // ...and the military camp's helicopter?

  function newWorld(startBiome = "prairie") {
    const level = new Level(Math.floor(Math.random() * 1e9), startBiome, { solo, biomes: biomeList.length > 1, biomeList, wild, sleepShrooms, ruins: ruinsOn, camp: campOn });
    level.ensure(VIEW_W * 2);
    const startX = 4 * TILE;
    const startY = level.groundRow * TILE - HITBOX_H;
    world = {
      level,
      players: RUNNERS.slice(0, count).map(([name, color]) => new Player(name, PALETTES[color], startX, startY)),
      solo,
      fire: { x: -FIRE.startOffset, speed: FIRE.startSpeed },
      state: "menu", // menu, countdown, playing, paused, ending, over
      countdown: 3,
      endTimer: 0,
      time: 0,
      swapFlash: 0,
      bolts: [], // lightning bolts flying along the course
      hands: [], // mystic hands flying, grabbing or swatting
      roots: [], // the enchanted forest's roots: holding someone and stabbing them, flinging them back, impaling them
      rootWall: null, // alone: the roots holding the fire back { t, x }
      missiles: [], // missiles zooming in, locking on, flying or exploding
      bears: [],    // bears chasing a player (snow only)
      jaguars: [],  // jaguars and black panthers hunting the leader (jungle only)
      decoys: [],   // harmless eyes blinking in the jungle's bushes
      arrows: [],   // arrows shot by the jungle's ancient turrets
      sandstorm: null, // the desert's sandstorm orb, blowing: { t, owner }
      snowstorm: null, // the snow's snowstorm orb, blowing: { t }
      thrownSnowballs: [], // snowballs thrown with the snowball orb
      monsoon: null,   // the jungle's monsoon orb, flooding the course: { t, logs }
      monkeys: [],     // monkeys swinging in on their vines (the monkey orb)
      sawBits: [],     // splinters, sparks and dirt thrown about by the forest's saws breaking loose
      quakes: [],      // the ground shaking where one slams down: { x, t }
      wisps: [],       // the magic trailing behind a loose saw: little glowing wisps drifting up and fading
      builtPortals: [], // brick portals you come out of: they build, open, close and rest again, never removed { level, x, gy, cy, style, state, t }
      stormBalls: [],   // the ruins' balls of lightning { level, x, y, angle, age }
      blackout: null,   // the ruins' blackout orb: the lights out on one course { level, owner, t }
      laserShots: [],   // the ruins' laser gun: { level, p, owner, x, y, dir, t }
      heli: null,       // the military camp's helicopter (once per race, on the main course): { x, y, dir, state, t, riders, loopY, ... }
      jetBombs: [],     // the jet's bombs, falling on the main course as it brings someone back { x, y, vx, vy }
      mushroomThrows: [], // the forest's mushroom orb: a mushroom thrown up, coming back down on its thrower { p, kind, t }
      mortarBombs: [],  // the ruins' mortar bombs in flight { level, x0, y0, x1, y1, top, age, seed }
      booms: [],        // ...and their explosions { level, x, y, gy, t, seed }
      blasts: [],       // ...and their explosions { level, x, y, t }
      nextCatchup: null, // when (world time) the next purple orb comes for whoever's fallen behind
      warps: [],       // portal gun: someone going into a portal and out of another one far ahead
      grapples: [],    // grapple hooks flying out to the leader, or reeling them back
      vines: [],       // vines swinging someone far forward (wherever they land)
      hawks: [],    // firehawks: flying out to drop a burning stick, or (alone) circling you
      sticks: [],   // burning sticks falling from a firehawk
      burns: [],    // a puff of fire where a firehawk burned an animal
      nextDecoy: null,
      vultures: [], // vultures circling, diving and skimming the ground (desert only)
      drones: [],   // rescue drones: guarding a player, or flying to grab the leader
      nextVulture: null, // the leader's distance (meters) when the next group comes
      wild,              // Wild mode (the hard one)
      nextWildMissile: null, // Wild: when (world time) the next missile comes in the prairie
      nextWildVulture: null, // Wild: when the next group of vultures comes in the desert
      nextWildBear: null,    // Wild: when the next bear charges in, in the snow
      nextWildJaguar: null,  // Wild: when the next jaguar comes, in the jungle
      winner: null,
    };
    for (const p of world.players) {
      p.onGround = true;
      p.biome = startBiome; // no "new biome" banner for the one you start in
    }
    Renderer.resetCameras(startX);
  }

  function readInput(i) {
    // In 1-player mode both sets of keys (WASD and the arrows) work
    const sets = solo ? [0, 1] : [i];
    const input = { left: false, right: false, jump: false, jumpPressed: false, firePressed: false };
    const p = world.players[i], flip = p && p.reversed > 0; // (the forest's reverse orb: left is right, and jump and action swap)
    for (const k of sets) {
      const c = CONTROLS[k];
      input.left ||= keys.has(flip ? c.right : c.left);
      input.right ||= keys.has(flip ? c.left : c.right);
      input.jump ||= keys.has(flip ? c.fire : c.jump);
      input.jumpPressed ||= flip ? fireQueued[k] : jumpQueued[k];
      input.firePressed ||= flip ? jumpQueued[k] : fireQueued[k];
      jumpQueued[k] = false;
      fireQueued[k] = false;
    }
    return input;
  }

  const NO_INPUT = { left: false, right: false, jump: false, jumpPressed: false };

  // Who a power aimed at "the other player" goes for (v7.61, with 3 or 4 runners): the leader, or second place if you're
  // the leader (whoever is furthest on, apart from you). With 2 runners that's simply the other one. null: nobody left
  function rivalOf(p) {
    let best = null;
    for (const q of world.players) if (q !== p && !q.caught && (!best || q.trackX > best.trackX)) best = q;
    return best;
  }

  // ...and the leader if they're ahead of you (for the catch-up orbs: the grapple, the vine, the portal gun, the drone)
  function leaderAhead(p, gap = 0) {
    const q = rivalOf(p);
    return q && q.trackX > p.trackX + gap ? q : null;
  }

  function step(dt) {
    if (world.swapFlash > 0) world.swapFlash -= dt * 2;
    for (const q of world.quakes) q.t -= dt;
    world.quakes = world.quakes.filter((q) => q.t > 0);
    for (const bit of world.sawBits) { bit.t -= dt; bit.vy += 500 * dt; bit.x += bit.vx * dt; bit.y += bit.vy * dt; }
    world.sawBits = world.sawBits.filter((bit) => bit.t > 0 && bit.y < VIEW_H + 4);
    for (const w of world.wisps) { w.t -= dt; w.x += w.vx * dt; w.y += w.vy * dt; w.vx *= 1 - dt * 2; }
    world.wisps = world.wisps.filter((w) => w.t > 0);

    if (world.state === "countdown") {
      const before = Math.ceil(world.countdown);
      world.countdown -= dt;
      if (world.countdown <= 0) {
        world.state = "playing";
        Sound.play("go");
      } else if (Math.ceil(world.countdown) < before) Sound.play("beep");
      jumpQueued.fill(false);
      fireQueued.fill(false);
      return;
    }

    world.time += dt;
    const { fire, level, players } = world;
    fire.speed = (FIRE.startSpeed + FIRE.speedGain * world.time) * TUNING.fire; // (the start screen's fire multiplier)
    if (!(world.rootWall && world.rootWall.t < ROOTS.wallTime)) fire.x += fire.speed * dt; // (alone: the roots can hold it back)

    level.ensure(Math.max(...players.map((p) => p.x)) + VIEW_W * 2);
    level.update(world.time);
    for (const f of forests()) {
      f.ensure(Math.max(...players.filter((p) => p.realm === f).map((p) => p.x)) + VIEW_W * 2);
      f.update(world.time);
    }

    if (world.state === "ending") {
      for (const p of players) p.update(dt, NO_INPUT, p.realm || level);
      world.endTimer -= dt;
      if (world.endTimer <= 0) {
        world.state = "over";
        callbacks.onGameOver(world.winner);
      }
      return;
    }

    const inputs = players.map((p, i) => readInput(i));
    players.forEach((p, i) => p.update(dt, inputs[i], p.realm || level)); // (each on their own course: the main one, or a forest)
    updateDreams(dt);
    updateFlights(dt);
    updateTrips(dt);
    updateBuiltPortals(dt);
    updateMushroomThrows(dt);
    updateLaserShots(dt);
    updateBlackout(dt);
    for (const p of players) if (p.reversed > 0) p.reversed -= dt; // (the reverse orb wears off)
    for (const bl of world.blasts) bl.t += dt;
    world.blasts = world.blasts.filter((bl) => bl.t < STORM.boom + 0.5); // (its scorch mark lingers a moment)
    for (const bm of world.booms) bm.t += dt;
    world.booms = world.booms.filter((bm) => bm.t < MORTAR.boom + 0.8);
    updateRootWall(dt);
    // The main course's dangers only see who's on it: anyone off in a forest (or on their way) counts as out of the race
    onCourse(level, () => mainCourse(dt, inputs));
    for (const f of forests()) {
      if (f.biome === "camp") onCourse(f, () => { checkOrbs(); updateBridges(dt); levelSounds(); });
      else if (f.biome === "ruins") onCourse(f, () => { world.players.forEach((p, i) => { if (inputs[i].firePressed && p.power === "laser") usePower(p, i); }); checkOrbs(); updateBridges(dt); updateRuins(f, dt); updateBiomeGates(f); updateStorms(dt); updateMortars(dt); updateRuneTiles(dt); levelSounds(); });
      else if (f.leg) onCourse(f, () => { updateBridges(dt); updateFlytraps(dt); checkThinIce(); levelSounds(); updateLeg(f); });
      else onCourse(f, () => { world.players.forEach((p, i) => { if (inputs[i].firePressed && p.power === "mushroom") usePower(p, i); }); checkOrbs(); updateBridges(dt); updateLooseSaws(dt); updateLooseMaces(dt); updateSpores(); updateLobbers(dt); updateAliveTrees(dt); updateLeaves(dt); levelSounds(); });
    }
    checkFire();
  }

  function mainCourse(dt, inputs) {
    world.players.forEach((p, i) => { if (inputs[i].firePressed) usePower(p, i); });
    updateSleepShrooms();
    updateRuinsGates();
    updateBiomeGates(world.level); // (a race that's all ruins has biome portals on the main course)
    updateBridges(dt);
    updateMonsoon(dt);
    const flooded = world.monsoon !== null; // (while it's flooded, every danger waits)
    updateDrones(dt);
    updateBolts(dt);
    updateHands(dt);
    updateRoots(dt, inputs);
    if (!flooded) {
      updateMissiles(dt);
      updateBears(dt);
      updateVultures(dt);
      updateFlytraps(dt);
      updateTurrets(dt);
      updateArrows(dt);
      updateLooseSaws(dt);
      updateLooseMaces(dt);
      updateSpores();
      updateLobbers(dt); // (a race that's all enchanted forest has them on the main course)
      updateAliveTrees(dt);
      updateLeaves(dt);
      updateStorms(dt); // (a race that's all ruins has them on the main course)
      updateMortars(dt);
      updateRuneTiles(dt);
    }
    updateMonkeys(dt);
    updateHeli(dt);
    updateWarps(dt);
    updateGrapples(dt);
    updateVines(dt);
    updateCatchup();
    updateSandstorm(dt);
    updateSnowstorm(dt);
    updateThrownSnowballs(dt);
    updateHawks(dt);
    if (!flooded) {
      updateSticks(dt);
      updateFires(dt);
      updateJaguars(dt);
      updateDecoys(dt);
    }
    checkOrbs();
    checkThinIce();
    checkTrapRescue();
    levelSounds();
  }

  // Running into someone stuck in a bear trap knocks them out of it... and you're caught in it instead
  function checkTrapRescue() {
    const { players, level } = world;
    for (const p of players) {
      if (p.trapped <= 0 || p.dead) continue;
      const t = level.traps.find((tt) => tt.id === p.trapId);
      if (!t) continue;
      for (const q of players) {
        if (q === p || q.dead || q.caught || q.held || q.trapped > 0 || q.rescueBlock > 0) continue;
        if (Math.abs(q.vx) < 20 || !overlaps(p.x, p.y, HITBOX_W, HITBOX_H, q.x, q.y, HITBOX_W, HITBOX_H)) continue; // has to run into them
        p.escapeTrap(level, "FREED!");
        p.rescueBlock = 1; // (so they can't knock it straight back onto you)
        q.trapped = TRAP.wiggles[t.size];
        q.trapId = t.id;
        q.lastWiggle = q.facing;
        q.wiggleHeld = q.facing;
        q.vx = 0;
        q.x = t.x - HITBOX_W / 2;
        q.showHit("TRAPPED!", "#d6dbe2");
        Sound.play("trapSnap");
        return;
      }
    }
  }

  // Both players standing on the same thin ice at once: too heavy, it breaks
  function checkThinIce() {
    const { players, level } = world;
    if (players.length < 2) return;
    for (const pond of level.ponds) {
      if (pond.state !== "ice") continue;
      const on = players.filter((p) => !p.dead && !p.caught && p.onGround && !p.standingOn && level.pondAt(p.x + HITBOX_W / 2) === pond);
      if (on.length >= 2) { // (two or more of you on it at once)
        level.breakPond(pond, (on[0].x + on[1].x) / 2 + HITBOX_W / 2);
        for (const p of on) p.freezeIn(pond); // both go in together: one block of ice
      }
    }
  }

  // Shooters firing and maces swooshing past, if a player is close enough to hear them
  function levelSounds() {
    const { level, players } = world;
    const near = (x) => players.some((p) => !p.dead && !p.caught && Math.abs(x - p.x) < VIEW_W * 0.6);
    for (const s of level.shooters) {
      if (!near(s.x)) continue;
      const volley = Math.floor(level.time / s.period - s.phase);
      if (s.lastVolley !== undefined && volley !== s.lastVolley) Sound.play(s.eye ? "laserFire" : "shooterFire");
      s.lastVolley = volley;
    }
    for (const gl of level.gearLasers) { // the ruins' gear lasers: a click as each locks into place, a zap as it fires
      if (!near(gl.x)) continue;
      const st = level.gearState(gl, level.time), was = gl.lastPhase;
      if (was === "turn" && st.phase !== "turn") Sound.play("gearClick");
      if (was !== "fire" && st.phase === "fire") Sound.play("laserFire");
      gl.lastPhase = st.phase;
    }
    for (const g of level.laserGates) { // the ruins' laser gates: a buzz as each comes on
      if (!near(g.x0)) continue;
      const on = level.laserState(g, level.time).on;
      if (on && g.wasOn === false) Sound.play("gateOn");
      g.wasOn = on;
    }
    for (const sw of level.laserSwords) { // the ruins' laser swords: a hum each time one lights again
      if (!near(sw.x)) continue;
      const on = level.swordState(sw, level.time).on;
      if (on && sw.wasOn === false) Sound.play("gateOn");
      sw.wasOn = on;
    }
    for (const m of level.maces) {
      if (!near(m.x) || m.loose) continue;
      const half = Math.floor(2 * (level.time / m.period + m.phase)); // changes as it swings through the bottom
      if (m.lastHalf !== undefined && half !== m.lastHalf) Sound.play("maceSwoosh");
      m.lastHalf = half;
    }
  }

  // The fire roars louder the closer it gets to whoever is nearest to it
  function fireLoudness() {
    if (world.state !== "playing") return 0;
    const runners = world.players.filter((p) => !p.caught);
    if (!runners.length) return 0;
    const gap = Math.min(...runners.map((p) => (p.trackX - world.fire.x) / TILE));
    return 0.12 + 0.88 * clamp(1 - gap / 40, 0, 1);
  }

  function checkOrbs() {
    for (const orb of world.level.orbs) {
      if (orb.used) continue;
      if (orb.purple && world.monsoon) continue; // (not while it's flooded)
      for (const p of world.players) {
        const other = rivalOf(p); // (a swap orb swaps you with the leader, or second place if you're the leader)
        if (p.dead || p.held || p.caught || (orb.kind === "swap" && (!other || other.dead || other.caught))) continue;
        if (orb.purple && orb.forWhom && orb.forWhom !== p) continue; // (a catch-up orb is only for the one it came for)
        if (overlaps(p.x, p.y, HITBOX_W, HITBOX_H, orb.x, orb.y, orb.w, orb.h)) {
          orb.used = true;
          if (orb.kind === "zap" || orb.kind === "hand" || orb.kind === "wind" || orb.kind === "drone" || orb.kind === "firehawk" || orb.kind === "snowball" || orb.kind === "monkey" || orb.kind === "mushroom" || orb.kind === "laser") {
            p.sparkle({ zap: "#bff4ff", hand: "#c9a3ff", wind: "#ffffff", drone: "#4fc0ff", firehawk: "#ff7a1a", snowball: "#e8f8ff", monkey: "#c8946a", mushroom: "#ff6a7a", laser: "#7af0d8" }[orb.kind]);
            Sound.play({ zap: "gotZap", hand: "gotHand", wind: "gotWind", drone: "gotDrone", firehawk: "gotHawk", snowball: "gotSnowball", monkey: "gotMonkey", mushroom: "gotMushroom", laser: "gotLaser" }[orb.kind]);
            // Alone, the drone (and the firehawk) start guarding you right away with no button press,
            // and the snowball (with nobody to throw it at) gives you skates
            if (world.solo && orb.kind === "drone") launchDrone(p);
            else if (world.solo && orb.kind === "firehawk") launchHawk(p);
            else if (world.solo && orb.kind === "snowball") { p.skate = SNOWBALL.skate; p.showHit("SKATES!", "#a8e0ff"); }
            else p.power = orb.kind; // holding one power at a time: the newest replaces the old
            return;
          }
          if (orb.purple) {
            p.sparkle("#d9a3ff");
            Sound.play("gotCatchup");
            if (orb.kind === "vine") launchVine(p);
            else p.power = orb.kind; // the portal gun and the grapple: used with S / Down
            return;
          }
          if (orb.kind === "monsoon") {
            if (!world.monsoon) startMonsoon();
            for (const q of world.players) if (!q.caught) q.showHit("MONSOON! STAY ON THE LOGS!", "#9fe0e8");
            Sound.play("monsoon");
            return;
          }
          if (orb.kind === "snowstorm") {
            world.snowstorm = { t: world.snowstorm ? Math.min(world.snowstorm.t, SNOWSTORM.fade) : 0, from: world.snowstorm ? world.snowstorm.from : world.players.map((q) => q.x) }; // (where everyone was: who gets further?)
            for (const q of world.players) if (!q.caught) q.showHit("SNOWSTORM! KEEP MOVING!", "#e8f8ff");
            Sound.play("snowstorm");
            return;
          }
          if (orb.kind === "reverse") { // the forest's reverse orb: everyone on this course, the grabber too
            for (const q of world.players) if (!q.caught) { q.reversed = REVERSE.time; q.showHit("REVERSED!", "#e0a0ff"); }
            Sound.play("reversed");
            return;
          }
          if (orb.kind === "blackout") { // the ruins' power shuts off (on this course)
            world.blackout = { level: world.level, owner: p, t: 0, back: false };
            for (const q of world.players) if (!q.caught) q.showHit("BLACKOUT!", "#7af0d8");
            Sound.play("powerDown");
            return;
          }
          if (orb.kind === "sandstorm") {
            world.sandstorm = { t: world.sandstorm ? Math.min(world.sandstorm.t, SANDSTORM.fade) : 0, owner: p, ...sandOrbPlan() };
            for (const q of world.players) if (!q.caught) q.showHit("SANDSTORM!", "#f0d8a0");
            Sound.play("sandstorm");
            return;
          }
          if (orb.kind === "dash") {
            p.dashHold = DASH.hold;
            Sound.play("dashCharge");
            p.x = orb.x + 1;
            p.y = orb.y + 4 - HITBOX_H / 2;
            p.vx = 0;
            p.vy = 0;
            p.jumpBuffer = 0;
            return;
          }
          if (orb.kind === "freeze") {
            p.frozen = FREEZE_TIME;
            p.vx = 0;
            p.sparkle("#a6e1ff");
            Sound.play("freeze");
            return;
          }
          const a = p, b = other;
          for (const f of SWAP_FIELDS) [a[f], b[f]] = [b[f], a[f]];
          // (a pond remembers who's frozen in it: that moves with the swap too)
          for (const pond of world.level.ponds) pond.frozen = pond.frozen.map((q) => (q === a ? b : q === b ? a : q));
          for (const f of world.level.flytraps) f.victim = f.victim === a ? b : f.victim === b ? a : f.victim; // (and a flytrap, who it's chewing)
          Renderer.swapCameras(world.players.indexOf(a), world.players.indexOf(b));
          world.swapFlash = 1;
          Sound.play("swap");
          a.sparkle("#ffd23f");
          b.sparkle("#ffd23f");
          return;
        }
      }
    }
  }

  // ---- Lightning bolts ----

  // S (Red) or Down (Blue): use whatever power you're holding
  function usePower(p, owner) {
    if (!p.power || p.dead || p.caught || p.held || p.frozen > 0 || p.dashHold > 0) return;
    if (p.power === "wind" && (p.stun > 0 || p.inQuick)) return; // can't dash out of a hand's throw or quicksand
    if (p.power === "zap") fireBolt(p, owner);
    else if (p.power === "hand") throwHand(p, owner);
    else if (p.power === "wind") p.windDash();
    else if (p.power === "drone") launchDrone(p);
    else if (p.power === "firehawk") launchHawk(p);
    else if (p.power === "snowball") throwSnowball(p);
    else if (p.power === "monkey") launchMonkey(p);
    else if (p.power === "mushroom") throwMushroom(p);
    else if (p.power === "laser") { if (!fireLaser(p, owner)) return; } // (alone, facing away from the fire: keep it)
    else if (p.power === "roots") { if (!rootGrab(p, owner)) return; } // (nobody to grab: keep it)
    else if (p.power === "portalgun" || p.power === "grapple") {
      if (world.monsoon || p.flood) return; // (keep it for after the flood)
      if (!(p.power === "portalgun" ? firePortalGun(p) : throwGrapple(p))) return; // (nothing happened: keep it)
    }
    p.power = null;
  }

  function fireBolt(p, owner) {
    const dir = p.facing; // fires whichever way you're facing right now
    const ground = world.level.groundTop(p.x + HITBOX_W / 2);
    world.bolts.push({
      id: nextBoltId++,
      owner,
      dir,
      x: dir > 0 ? p.x + HITBOX_W : p.x, // the bolt's head
      y: (ground ?? p.y + HITBOX_H) - ZAP.height,
      traveled: 0,
      born: world.time,
    });
    p.flash = 0.35;
    p.sparkle("#ffffff");
    p.sparkle("#bff4ff");
    Sound.play("zapFire");
  }

  function updateBolts(dt) {
    const { level, players } = world;
    for (const bolt of world.bolts) {
      const move = ZAP.speed * dt;
      bolt.x += bolt.dir * move;
      bolt.traveled += move;
      // Hug the ground: climb steps and drop down them, glide straight over pits
      const ground = level.groundTop(bolt.x);
      if (ground !== null) bolt.y += (ground - ZAP.height - bolt.y) * Math.min(1, dt * 40);

      // Only the other runners can be hit (whoever's touching the bolt)
      const tail = bolt.x - bolt.dir * ZAP.length;
      const left = Math.min(tail, bolt.x);
      const target = players.find((q, i) => i !== bolt.owner && !q.dead && !q.caught && q.x + HITBOX_W >= left && q.x <= left + ZAP.length);
      if (!target) continue;
      const groundThere = level.groundTop(target.x + HITBOX_W / 2);
      const boltY = groundThere === null ? bolt.y : groundThere - ZAP.height;
      if (overlaps(target.x, target.y, HITBOX_W, HITBOX_H, left, boltY - 1, ZAP.length, 3)) {
        target.zap();
        bolt.done = true;
      }
    }
    world.bolts = world.bolts.filter((b) => !b.done && b.traveled < ZAP.range);
  }

  // ---- Mystic hands ----

  function throwHand(p, owner) {
    const dir = p.facing;
    world.hands.push({
      owner,
      dir,
      x: p.x + HITBOX_W / 2 + dir * 6, // centre of the hand
      y: p.y + HITBOX_H / 2,           // flies straight at the height it was thrown from
      traveled: 0,
      state: "fly",                    // fly, then grab or swat if it catches someone, then fade
      t: 0,
    });
    p.sparkle("#c9a3ff");
    Sound.play("handThrow");
  }

  // Does a runner standing at (x, y) overlap the ground?
  function bodyInWall(x, y) {
    const lv = world.level;
    return lv.isSolid(Math.floor(x / TILE), Math.floor(y / TILE)) ||
      lv.isSolid(Math.floor((x + HITBOX_W - 0.01) / TILE), Math.floor(y / TILE)) ||
      lv.isSolid(Math.floor(x / TILE), Math.floor((y + HITBOX_H - 0.01) / TILE)) ||
      lv.isSolid(Math.floor((x + HITBOX_W - 0.01) / TILE), Math.floor((y + HITBOX_H - 0.01) / TILE));
  }

  // Let go of a caught player and fling them backwards (always to the left)
  function throwPlayer(target) {
    target.held = false;
    target.spin = 0;
    target.vx = -HAND.throwX;
    target.vy = -HAND.throwUp;
    target.onGround = false;
    target.standingOn = null;
    target.stun = HAND.stun;
  }

  function updateHands(dt) {
    const { level, players } = world;
    for (const h of world.hands) {
      h.t += dt;
      let target = h.victim; // (whoever it caught: any runner but its thrower, v7.61)

      if (h.state === "fly") {
        const move = HAND.speed * dt;
        h.x += h.dir * move;
        h.traveled += move;
        if (h.traveled >= HAND.range || level.isSolid(Math.floor(h.x / TILE), Math.floor(h.y / TILE))) {
          h.state = "fade";
          h.t = 0;
          continue;
        }
        const half = HAND.size / 2;
        target = players.find((q, i) => i !== h.owner && !q.dead && !q.caught && !q.held && overlaps(q.x, q.y, HITBOX_W, HITBOX_H, h.x - half, h.y - half, HAND.size, HAND.size));
        if (target) {
          h.victim = target;
          // Caught! Facing right it's a grab-and-suplex, facing left it's a backhand
          h.state = h.dir > 0 ? "grab" : "swat";
          h.t = 0;
          h.tx = target.x;
          h.ty = target.y;
          target.held = true;
          target.inQuick = false;
          target.inRiver = null;
          target.vx = target.vy = 0;
          target.dashHold = target.dashTime = target.windTime = 0;
          target.standingOn = null;
          target.flash = 0.3;
          target.showHit(h.dir > 0 ? "GRABBED!" : "SMACKED!", "#c9a3ff");
          Sound.play(h.dir > 0 ? "grab" : "windUp");
        }
      } else if (h.state === "grab") {
        // The fist closes, then swings them up and back over the top, like a suplex
        const close = 0.1;
        if (h.t > close) {
          const a = Math.min(1, (h.t - close) / (HAND.grabTime - close)) * Math.PI;
          const r = HAND.suplexRadius;
          const nx = h.tx - r + r * Math.cos(a);
          const ny = h.ty - r * Math.sin(a);
          if (!bodyInWall(nx, ny)) {
            target.x = nx;
            target.y = ny;
          }
          target.spin = -a;
          h.angle = -a;
        }
        if (h.t >= HAND.grabTime) {
          throwPlayer(target);
          target.sparkle("#c9a3ff");
          Sound.play("slam");
          h.state = "fade";
          h.t = 0;
        }
      } else if (h.state === "swat") {
        if (h.t >= HAND.swatTime) {
          throwPlayer(target);
          Sound.play("smack");
          target.sparkle("#ffffff");
          target.sparkle("#ffd23f");
          h.smackX = target.x + HITBOX_W / 2;
          h.smackY = target.y + HITBOX_H / 2;
          h.state = "fade";
          h.swatted = true;
          h.t = 0;
        }
      } else if (h.t > 0.3) {
        h.done = true;
      }
    }
    // If the caught player dies or is caught by the fire, let the hand go
    for (const h of world.hands) {
      if ((h.state === "grab" || h.state === "swat") && !(h.victim && h.victim.held)) { h.state = "fade"; h.t = 0; }
    }
    world.hands = world.hands.filter((h) => !h.done);
  }

  // ---- Missiles ----
  //
  // After 300m, a missile comes every so often (randomly). It zooms in from far
  // away in the background on the left or right of a player, locks on to the
  // closest player for a moment, then fires in a straight line. The black one
  // aims where you are; the red-striped one (after 400m) aims where you'll be.

  const rand = (a, b) => a + Math.random() * (b - a);

  function spawnMissile() {
    const { players } = world;
    // Missiles only come for the player in the lead, and only in the prairie
    const alive = players.filter((p) => !p.dead && !p.caught);
    if (!alive.length) return;
    const near = alive.reduce((a, b) => (b.x > a.x ? b : a));
    if (world.level.biomeAt(Math.floor((near.x + HITBOX_W / 2) / TILE)) !== "prairie") return;
    const leaderMeters = Math.max(...players.map((p) => p.x)) / TILE;
    const striped = leaderMeters > (world.wild ? 0 : MISSILE.stripedAt) && Math.random() < 0.5;
    const side = Math.random() < 0.5 ? -1 : 1; // comes in on the left or the right of the player
    world.missiles.push(makeMissile(near, striped, side));
    Sound.play("glint");
    Sound.play("incoming");
  }

  // While it zooms in, a missile is positioned relative to the player it came for,
  // so the whole entrance stays on their screen even while they run. It starts small
  // near the middle of their sky (far away) and grows out to where it arrives.
  // The player sits 35% across their view, so the view runs from 140px behind them
  // to 260px ahead; every point here stays well inside that.
  function makeMissile(near, striped, side) {
    const ox = side < 0 ? -rand(75, 110) : rand(90, 195); // arrival spot, left or right of the player
    const oy = rand(12, 24);                              // high in the sky: 60-75px above a runner on the ground
    const centre = VIEW_W * 0.5 - VIEW_W * 0.35;            // middle of their screen, relative to them
    return {
      striped,
      side,
      state: "approach",
      t: 0,
      anchor: near,
      ox, oy,
      sx: centre + (ox - centre) * 0.25,                   // start: far away, near the middle of the sky
      sy: Math.max(12, oy - 6),                           // (below the distance counters at the top)
      x: near.x + ox, y: oy,
      scale: 0.15,
      angle: 0,
      trail: [],
      smoke: [],     // smoke left behind while it zooms in (kept relative to the player, like the missile)
    };
  }

  function missileAim(m, target) {
    const tx = target.x + HITBOX_W / 2;
    const ty = target.y + HITBOX_H / 2;
    if (!m.striped) return { x: tx, y: ty };
    // Lead the target: where will they be by the time the missile gets there?
    let px = tx, py = ty;
    for (let i = 0; i < 3; i++) {
      const time = Math.hypot(px - m.x, py - m.y) / MISSILE.speed;
      px = tx + target.vx * time;
      py = ty + (target.onGround ? 0 : target.vy * time);
    }
    return { x: px, y: Math.min(py, VIEW_H) };
  }

  function explodeMissile(m) {
    m.state = "boom";
    m.t = 0;
    Sound.play("boom");
  }

  function updateMissiles(dt) {
    const { players, level } = world;
    // When the leader reaches one of the prairie's missile spots (past 400 m), a missile comes.
    // One at a time: if one is still in the air, the next waits for it.
    const leaderMeters = Math.max(...players.map((p) => p.x)) / TILE;
    if (world.wild) {
      // Wild: one at the leader the whole time they're in the prairie, the next as soon as the last
      // one has exploded or flown off
      const leader = players.filter((p) => !p.dead && !p.caught).sort((a, b) => b.x - a.x)[0];
      if (!leader || level.biomeAt(Math.floor((leader.x + HITBOX_W / 2) / TILE)) !== "prairie" || world.missiles.length) world.nextWildMissile = null;
      else if (world.nextWildMissile === null) world.nextWildMissile = world.time + WILD.missileEvery[0] + Math.random() * (WILD.missileEvery[1] - WILD.missileEvery[0]);
      else if (world.time >= world.nextWildMissile) {
        spawnMissile();
        world.nextWildMissile = null;
      }
    } else {
      for (const spot of level.missileSpots) {
        if (spot.used || leaderMeters < spot.col || world.missiles.length) continue;
        spot.used = true;
        if (spot.col >= MISSILE.startAt) spawnMissile();
      }
    }

    // You died (to something else) before the missile coming for you got there: it carries on and
    // fires anyway, at wherever you are by then, and a fresh one comes for you once you're back
    for (const p of players) if (!p.dead) p.missileDeath = false;
    for (const m of world.missiles) {
      const p = m.state === "approach" ? m.anchor : m.target;
      if (world.wild) break; // (in Wild they keep coming anyway)
      if (!p || !p.dead || p.caught || p.missileDeath || m.state === "boom" || m.owedFor === p) continue;
      p.missileOwed = true;
      m.owedFor = p;
    }
    for (const p of players) {
      if (!p.missileOwed || p.dead) continue;
      if (p.caught) { p.missileOwed = false; continue; }
      if (world.missiles.some((m) => !m.done && m.state !== "fly" && m.state !== "boom")) continue; // one at a time
      p.missileOwed = false;
      const striped = p.x / TILE > (world.wild ? 0 : MISSILE.stripedAt) && Math.random() < 0.5;
      world.missiles.push(makeMissile(p, striped, Math.random() < 0.5 ? -1 : 1));
      Sound.play("glint");
      Sound.play("incoming");
    }

    for (const m of world.missiles) {
      m.t += dt;
      if (m.state === "approach") {
        const ax = m.anchor.x; // (if they've died, it stays over where they were)
        const e = Math.min(1, m.t / MISSILE.approach) ** 2; // slow at first, rushing in at the end
        m.x = ax + m.sx + (m.ox - m.sx) * e;
        m.y = m.sy + (m.oy - m.sy) * e;
        m.scale = 0.15 + 0.85 * e;
        m.angle = Math.atan2(m.oy - m.sy, m.ox - m.sx);
        // drop a puff of smoke every few frames; it's thicker the closer (bigger) the missile is
        if ((m.smokeTimer = (m.smokeTimer || 0) + dt) > 0.025) {
          m.smokeTimer = 0;
          m.smoke.push({ rx: m.x - ax, y: m.y, s: m.scale, t: world.time });
        }
        if (m.t >= MISSILE.approach) {
          m.smokeAnchorX = ax; // from here the trail stays put in the world
          m.state = "lock";
          m.t = 0;
          Sound.play("lockOn");
          // Lock on to whoever is closest right now (if nobody's alive, at the spot its player died)
          const alive = players.filter((p) => !p.dead && !p.caught);
          if (!alive.length) {
            if (m.anchor.caught) { m.done = true; continue; }
            m.target = m.anchor;
          } else m.target = alive.reduce((best, p) =>
            Math.hypot(p.x - m.x, p.y - m.y) < Math.hypot(best.x - m.x, best.y - m.y) ? p : best);
        }
      } else if (m.state === "lock") {
        if (m.target.caught) { m.done = true; continue; }
        m.aim = missileAim(m, m.target); // (still dead: where they were; already back: where they are now)
        m.angle = Math.atan2(m.aim.y - m.y, m.aim.x - m.x);
        if (m.t >= MISSILE.lock) {
          // Fire! From here on it flies in a straight line and never turns
          m.state = "fly";
          m.t = 0;
          Sound.play("launch");
          m.vx = Math.cos(m.angle) * MISSILE.speed;
          m.vy = Math.sin(m.angle) * MISSILE.speed;
          m.traveled = 0;
        }
      } else if (m.state === "fly") {
        m.x += m.vx * dt;
        m.y += m.vy * dt;
        m.traveled += MISSILE.speed * dt;
        m.trail.push({ x: m.x, y: m.y, t: world.time });
        if (m.trail.length > 14) m.trail.shift();
        // the nose is a few pixels ahead of the middle
        const nx = m.x + Math.cos(m.angle) * 8;
        const ny = m.y + Math.sin(m.angle) * 8;
        if (level.isSolid(Math.floor(nx / TILE), Math.floor(ny / TILE))) explodeMissile(m);
        else if (players.some((p) => !p.dead && !p.caught && overlaps(p.x, p.y, HITBOX_W, HITBOX_H, nx - 2, ny - 2, 4, 4))) explodeMissile(m);
        else if (m.traveled > MISSILE.range || ny > VIEW_H + 20) m.done = true;
        if (m.state === "boom") { m.x = nx; m.y = ny; }
      } else if (m.state === "boom") {
        // The blast can catch anyone close by, for a moment
        if (m.t < MISSILE.lethalTime) {
          for (const p of players) {
            if (p.dead || p.caught) continue;
            const cx = clamp(m.x, p.x, p.x + HITBOX_W);
            const cy = clamp(m.y, p.y, p.y + HITBOX_H);
            if ((m.x - cx) ** 2 + (m.y - cy) ** 2 < MISSILE.blast ** 2) {
              p.showHit("BOOM!", "#f77f00");
              p.missileDeath = true; // (a missile got them: that doesn't send another one)
              p.die();
            }
          }
        }
        if (m.t >= MISSILE.blastTime) m.done = true;
      }
    }
    world.missiles = world.missiles.filter((m) => !m.done);
  }

  // ---- Bears (snow biome) ----

  // Where the bear's feet go: the highest ground under its body. Over a pit it
  // keeps its height (it leaps across), and it bounds over spikes.
  function bearGround(bear) {
    const { level } = world;
    let top = null;
    let leaping = false;
    for (let x = bear.x - BEAR_W + 4; x <= bear.x; x += 6) {
      let g = level.groundTop(x);
      if (g === null) { leaping = true; continue; }
      if (level.tile(Math.floor(x / TILE), g / TILE - 1) === T_SPIKE) { g -= TILE + 2; leaping = true; }
      if (top === null || g < top) top = g;
    }
    return { top, leaping };
  }

  // Could anyone see this bear? (each screen shows from a little behind its player)
  function bearOnScreen(bear) {
    return world.players.some((p) => {
      const left = p.x - VIEW_W * 0.35 - 8, right = left + VIEW_W + 16;
      return bear.x > left && bear.x - BEAR_W < right;
    });
  }

  function updateBears(dt) {
    const { level, players } = world;
    // Once per snow biome, when the leader reaches the bear's spot, it charges in from the left
    const runners = players.filter((p) => !p.dead && !p.caught);
    if (runners.length) {
      const leader = runners.reduce((a, b) => (b.x > a.x ? b : a));
      let busy = world.bears.some((bb) => bb.state !== "leave"); // one chase at a time
      const inSnow = level.biomeAt(Math.floor(leader.x / TILE)) === "snow";
      if (world.wild) {
        // Wild: always a bear after you in the snow: when one gives up, the next charges in
        if (!inSnow || busy) world.nextWildBear = null;
        else if (world.nextWildBear === null) world.nextWildBear = world.time + WILD.bearGap;
        else if (world.time >= world.nextWildBear) {
          world.nextWildBear = null;
          spawnBear(leader, ["polar", "brown", "black"][Math.floor(Math.random() * 3)]);
        }
      }
      for (const spot of world.wild ? [] : level.bearSpots) {
        if (spot.used || leader.x / TILE < spot.col) continue;
        if (busy) continue; // wait for the other bear
        spot.used = true;
        if (!inSnow) continue;
        const meters = leader.x / TILE;
        if (meters < level.baseAt) continue; // no bears this early
        let kindName = spot.kind;
        if (kindName === "polar" && meters < level.specialAt) kindName = Math.random() < 0.5 ? "brown" : "black"; // polar bears come later
        spawnBear(leader, kindName);
        busy = true;
      }
    }
    updateBearMoves(dt);
  }

  // A bear charges in from the left after the leader
  function spawnBear(leader, kindName) {
    const kind = BEAR[kindName];
    const bear = { kind: kindName, target: leader, x: leader.x - BEAR.startBehind, y: leader.y + HITBOX_H,
      state: "chase", t: 0, speed: kind.speed, chase: kind.chase, anim: 0, stepTimer: 0, lift: 0, trampled: new Set() };
    // Never pop into view on the other player's screen: if they're close enough behind to see
    // the spot, start just off the left of THEIR screen and charge through to the leader first.
    for (const q of world.players) {
      if (q === leader || q.dead || q.caught) continue;
      const left = q.x - VIEW_W * 0.35;
      if (bear.x - BEAR_W < left + VIEW_W && bear.x > left - 4) {
        bear.x = Math.min(bear.x, left - 4);
        bear.state = "approach";
      }
    }
    const g = bearGround(bear).top;
    if (g !== null) bear.y = g;
    world.bears.push(bear);
    Sound.play("roar");
  }

  function updateBearMoves(dt) {
    const { level, players } = world;
    for (const bear of world.bears) {
      bear.t += dt;
      const p = bear.target;
      const dir = bear.state === "leave" ? -1 : 1;
      if (bear.state === "approach" && bear.x >= p.x - BEAR.startBehind) {
        bear.state = "chase"; // reached the leader's screen: the chase starts now
        bear.t = 0;
      }
      if (bear.state === "chase" || bear.state === "leave" || bear.state === "approach") {
        const speed = bear.state === "leave" ? bear.speed * 0.7 : bear.state === "approach" ? BEAR.approachSpeed : bear.speed;
        bear.x += dir * speed * dt;
        bear.anim += speed * dt;
        const { top, leaping } = bearGround(bear);
        if (top !== null) bear.y += (top - bear.y) * Math.min(1, dt * 12);
        bear.lift = leaping ? Math.min(6, bear.lift + dt * 40) : Math.max(0, bear.lift - dt * 40);
        // heavy footsteps when someone is close enough to hear
        if ((bear.stepTimer -= dt) <= 0) {
          bear.stepTimer = 0.24;
          if (players.some((q) => Math.abs(q.x - bear.x) < VIEW_W * 0.6)) Sound.play("bearStep");
        }
      }
      // Running over the player it isn't chasing launches them high into the air
      if (bear.state === "chase" || bear.state === "approach") {
        for (const q of players) {
          if (q === p || q.dead || q.caught || q.held || bear.trampled.has(q)) continue;
          if (overlaps(q.x, q.y, HITBOX_W, HITBOX_H, bear.x - BEAR_W + 6, bear.y - 16, BEAR_W - 6, 16)) {
            bear.trampled.add(q);
            q.inQuick = false;
            q.inRiver = null;
            q.vy = -BEAR.tramplePop;
            q.onGround = false;
            q.standingOn = null;
            q.stun = 0.6; // tumbles, no control for a moment
            q.showHit("TRAMPLED!", "#ffb347");
            q.sparkle("#ffffff");
            Sound.play("trample");
          }
        }
      }
      if (p.caught && (bear.state === "approach" || bear.state === "chase" || bear.state === "regroup")) {
        bear.state = "leave"; // the fire got them: nothing left to chase
        bear.t = 0;
      } else if (p.dead && (bear.state === "approach" || bear.state === "chase")) {
        // They died to something else: go and wait where they'll come back, then carry on
        bear.resume = bear.state;
        bear.state = "regroup";
      }
      if (bear.state === "regroup") {
        // Run (forwards or backwards) to wait just behind where they'll come back, where you can see it.
        // Never so close that it could catch someone who runs flat out before its time is up.
        const left = bear.resume === "chase" ? Math.max(0, bear.chase - bear.t) : bear.chase;
        const behind = clamp((bear.speed - PHYSICS.runSpeed) * left + 16, BEAR.waitBehind, BEAR.startBehind);
        const goal = (p.dead ? p.respawnX : p.x) - behind;
        const step = BEAR.approachSpeed * dt;
        if (Math.abs(goal - bear.x) > step) {
          bear.facing = goal > bear.x ? 1 : -1;
          bear.x += bear.facing * step;
          bear.anim += step;
          const { top, leaping } = bearGround(bear);
          if (top !== null) bear.y += (top - bear.y) * Math.min(1, dt * 12);
          bear.lift = leaping ? Math.min(6, bear.lift + dt * 40) : Math.max(0, bear.lift - dt * 40);
        } else {
          bear.x = goal;
          bear.facing = 1;
          bear.lift = Math.max(0, bear.lift - dt * 40);
          if (!p.dead) {
            bear.state = bear.resume; // back on the chase (the clock kept running)
            Sound.play("roar");
          }
        }
        if (bear.resume === "chase" && bear.t >= bear.chase) {
          bear.state = "leave"; // time's up, even while waiting
          bear.t = 0;
          Sound.play("grumble");
        }
      } else if (bear.state === "chase") {
        if (bear.x >= p.x + 2 && p.y + HITBOX_H > bear.y - 34) {
          // Caught!
          bear.state = "swipe";
          bear.t = 0;
          if (bear.kind === "black") {
            p.honey = BEAR.honeyTime;
            p.showHit("HONEY!", "#ffb627");
            Sound.play("honey");
          } else {
            p.showHit("MAULED!", "#ff4d3d");
            Sound.play("maul");
            p.die();
          }
        } else if (bear.t >= bear.chase) {
          bear.state = "leave"; // gives up and heads back
          bear.t = 0;
          Sound.play("grumble");
        }
      } else if (bear.state === "swipe") {
        if (bear.t >= BEAR.swipeTime) { bear.state = "leave"; bear.t = 0; }
      } else if (bear.state === "leave") {
        // Heading home: it only disappears once nobody can see it (it runs out past the left
        // edge of every screen, including the player behind's, instead of vanishing in front of them)
        if (!bearOnScreen(bear) || bear.t > 30) bear.done = true;
      } else if (bear.state === "approach" && bear.t > 15) {
        bear.state = "leave"; // never caught up with the leader: give up (and leave out of sight)
        bear.t = 0;
      }
    }
    world.bears = world.bears.filter((b) => !b.done);
  }

  // ---- Rescue drone ----

  // Used by the player behind: fly to the leader and bring them back. Used by the leader
  // (or on your own): follow them and catch them once if they fall into a pit.
  function launchDrone(p) {
    const leader = leaderAhead(p);
    const drone = { owner: p, x: p.x + HITBOX_W / 2, y: p.y - 10, t: 0, done: false };
    if (leader) {
      Object.assign(drone, { mode: "hunt", target: leader });
    } else {
      // only one guard drone at a time: a new one replaces it
      world.drones = world.drones.filter((d) => !(d.mode === "guard" && d.owner === p));
      Object.assign(drone, { mode: "guard" });
    }
    world.drones.push(drone);
    p.sparkle("#4fc0ff");
    Sound.play("droneLaunch");
  }

  // The first firm, spike-free, quicksand-free ground ahead (two tiles wide)
  function landingAfter(x) {
    const { level } = world;
    for (let c = Math.floor(x / TILE) + 1; c < Math.floor(x / TILE) + 200 && c < level.cols.length - 2; c++) {
      const g = level.groundTop(c * TILE);
      if (g === null || level.groundTop((c + 1) * TILE) !== g || level.isQuick(c) || level.isQuick(c + 1)) continue;
      if (level.tile(c, g / TILE - 1) !== T_EMPTY || level.tile(c + 1, g / TILE - 1) !== T_EMPTY) continue;
      return { x: c * TILE + 1, y: g - HITBOX_H };
    }
    return null;
  }

  // Where a pulled-back leader is dropped: safe ground a little in front of the player behind,
  // but always at least two tiles behind where they were grabbed (never forward)
  function pullBackSpot(d) {
    const { level } = world;
    const limit = d.fromX - 2 * TILE;
    const from = Math.min(d.owner.x + DRONE.dropAhead, limit);
    return (limit - from > TILE && level.safeSpotAfter(from, limit - from)) || level.safeSpotBefore(from);
  }

  function updateDrones(dt) {
    const { level } = world;
    for (const d of world.drones) {
      d.t += dt;
      if (d.mode === "guard") {
        const p = d.owner;
        if (p.caught) { d.mode = "leave"; continue; }
        // hover just above and behind the player
        const hx = p.x + HITBOX_W / 2 - 10 * p.facing;
        const hy = Math.max(6, p.y - 14 + Math.sin(d.t * 4) * 2);
        d.x += (hx - d.x) * Math.min(1, dt * 8);
        d.y += (hy - d.y) * Math.min(1, dt * 8);
        // Falling into a pit? Catch them and carry them past it
        if (!p.dead && !p.held && !p.onGround && p.vy > 0 && p.y > VIEW_H - 14 && level.groundTop(p.x + HITBOX_W / 2) === null) {
          // Past the pit on safe ground; if there's none nearby (e.g. a shooter right there),
          // the next firm ground ahead will do: it never lets you fall
          const spot = level.safeSpotAfter(p.x + HITBOX_W) || landingAfter(p.x + HITBOX_W);
          if (spot) {
            d.mode = "carry";
            d.target = p;
            d.spot = spot;
            p.held = true;
            p.inQuick = false;
            p.inRiver = null;
            p.vx = p.vy = 0;
            p.showHit("SAVED!", "#4fc0ff");
            Sound.play("droneGrab");
          }
        }
      } else if (d.mode === "hunt") {
        const q = d.target;
        if (q.caught) { d.mode = "leave"; continue; }
        if (q.dead || q.held) { d.y += (20 - d.y) * Math.min(1, dt * 3); continue; } // wait for them
        // if the owner has caught up and passed them, there's no one to bring back
        if (d.owner.trackX >= q.trackX) { d.mode = "leave"; continue; }
        const tx = q.x + HITBOX_W / 2, ty = q.y - 3;
        const dist = Math.hypot(tx - d.x, ty - d.y);
        const step = DRONE.flySpeed * dt;
        if (dist <= step + 2) {
          d.mode = "carry";
          d.target = q;
          d.fromX = q.x; // where they were grabbed: they always end up behind this
          q.held = true;
          q.inQuick = false;
          q.inRiver = null;
          q.vx = q.vy = 0;
          q.showHit("PULLED BACK!", "#4fc0ff");
          Sound.play("droneGrab");
        } else {
          d.x += ((tx - d.x) / dist) * step;
          d.y += ((ty - d.y) / dist) * step;
        }
      } else if (d.mode === "carry") {
        const q = d.target;
        // Leader being pulled back: drop them safely a little in front of the player behind
        // (recomputed as that player moves). Guard save: drop them past the pit.
        if (d.target !== d.owner) d.spot = pullBackSpot(d) || d.spot;
        const spot = d.spot || { x: q.x, y: q.y };
        const tx = spot.x + HITBOX_W / 2, ty = Math.min(spot.y - 6, d.y);
        const dist = Math.hypot(tx - d.x, ty - d.y);
        const step = DRONE.carrySpeed * dt;
        if (dist > step) { d.x += ((tx - d.x) / dist) * step; d.y += ((ty - d.y) / dist) * step; }
        else { d.x = tx; d.y = ty; }
        q.x = d.x - HITBOX_W / 2;
        q.y = d.y + 5;
        if (dist <= step + 1) {
          // set them down gently on the safe spot
          q.held = false;
          q.x = spot.x;
          q.y = spot.y;
          q.vx = q.vy = 0;
          q.onGround = false;
          q.safeSpots.push({ x: spot.x, y: spot.y });
          Sound.play("droneDrop");
          d.mode = "leave";
          d.t = 0;
        }
      } else if (d.mode === "leave") {
        d.y -= 90 * dt;
        d.x += 60 * dt;
        if (d.y < -20) d.done = true;
      }
    }
    world.drones = world.drones.filter((d) => !d.done);
  }

  // ---- Flytraps (jungle) ----

  // A flytrap is shared: it rears back when anyone comes close, then snaps at everyone in its bite.
  // It eats the nearest; while it's chewing (someone, or nothing after a miss) it ignores everybody.
  function updateFlytraps(dt) {
    const { level, players } = world;
    const free = (p) => !p.dead && !p.caught && !p.held && !p.eatenBy && !p.inRiver;
    const inBite = (f, p) => {
      const reach = level.flytrapReach(f);
      return free(p) && p.x + HITBOX_W > f.x - reach && p.x < f.x + reach && p.y + HITBOX_H > f.gy - FLYTRAP.lunge && p.y < f.gy;
    };
    const snap = (f) => {
      const victim = players.filter((p) => inBite(f, p)).sort((p, q) => Math.abs(p.x - f.x) - Math.abs(q.x - f.x))[0];
      f.t = 0;
      if (victim) {
        f.state = "chew";
        f.victim = victim;
        victim.eatenBy = f;
        victim.vx = victim.vy = 0;
        victim.from = victim.x + HITBOX_W / 2 < f.x ? -1 : 1; // spat back out the way they came
        victim.showHit("CHOMP!", "#ff6a8a");
        Sound.play("flytrapChomp");
      } else {
        f.state = "chewNothing";
        Sound.play("flytrapSnap");
      }
    };
    for (const f of level.flytraps) {
      if (!players.some((p) => Math.abs(p.x - f.x) < VIEW_W * 1.5)) continue;
      f.t += dt;
      if (f.state === "open") {
        if (players.some((p) => inBite(f, p))) snap(f); // (right in front of it as it opens: no warning)
        else if (players.some((p) => free(p) && Math.abs(p.x + HITBOX_W / 2 - f.x) < level.flytrapSense(f) && p.y + HITBOX_H > f.gy - 60)) {
          f.state = "windup";
          f.t = 0;
          Sound.play("flytrapHiss");
        }
      } else if (f.state === "windup") {
        if (f.t >= level.flytrapWindup()) snap(f);
      } else if (f.state === "chew") {
        const v = f.victim;
        if (v && v.eatenBy === f && f.t > FLYTRAP.chew - 0.4 && f.big && !f.gulped) { f.gulped = true; Sound.play("flytrapGulp"); }
        if (f.t >= FLYTRAP.chew) {
          if (v && v.eatenBy === f) {
            v.eatenBy = null;
            if (f.big) {
              v.showHit("EATEN!", "#ff4d3d");
              v.die();
            } else {
              // spat out, back the way they came
              const dir = v.from || -1;
              v.x = f.x + dir * (level.flytrapReach(f) + 2) - HITBOX_W / 2;
              v.y = f.gy - HITBOX_H - 12;
              v.vx = dir * FLYTRAP.spit[0];
              v.vy = -FLYTRAP.spit[1];
              v.onGround = false;
              v.stun = FLYTRAP.spitStun;
              v.noCut = 0.5;
              v.showHit("SPAT OUT!", "#9be07a");
              Sound.play("flytrapSpit");
            }
          }
          f.victim = null;
          f.gulped = false;
          f.state = "opening";
          f.t = 0;
        }
      } else if (f.state === "chewNothing") {
        if (f.t >= (level.wild ? WILD.flytrapChewNothing : FLYTRAP.chewNothing)) { f.state = "opening"; f.t = 0; }
      } else if (f.state === "opening" && f.t >= FLYTRAP.open) {
        f.state = "open";
        f.t = 0;
      }
    }
  }

  // ---- The desert's orbs: sandstorm and firehawk ----

  // How hard the sandstorm is blowing (0 to 1): it builds up, blows, then dies down
  function sandstormStrength() {
    const st = world.sandstorm;
    if (!st) return 0;
    return Math.max(0, Math.min(1, st.t / SANDSTORM.fade, (SANDSTORM.time - st.t) / SANDSTORM.fade));
  }

  function updateSandstorm(dt) {
    const st = world.sandstorm;
    if (st) {
      st.t += dt;
      if (st.left) blowSandOrbs(st);
      if (st.t >= SANDSTORM.time) world.sandstorm = null;
    }
    updateSandOrbs(dt);
    const s = sandstormStrength();
    for (const p of world.players) p.windPush = p.caught ? 0 : s * SANDSTORM.push * (st && p === st.owner ? SANDSTORM.ownPush : 1);
  }

  // The sandstorm blows action orbs along with it (3-6 of them): one at a time, each once the last one's been grabbed or
  // has blown past the leader. If the other player has dropped off the leader's screen, two of them fly past the leader
  // too high to grab and sink slowly, so they're low enough by the time they reach the one behind: those come at their own
  // times (they can be out with another one)
  function sandOrbPlan() {
    const S = SANDSTORM, n = S.orbs[0] + Math.floor(Math.random() * (S.orbs[1] - S.orbs[0] + 1));
    return { left: n, next: S.orbsFrom, high: 0, highAt: Array.from({ length: S.behind }, () => S.orbsFrom + Math.random() * (S.orbsTo - S.orbsFrom)).sort((a, b) => a - b) };
  }
  function blowSandOrbs(st) {
    const S = SANDSTORM, runners = world.players.filter((p) => !p.caught && !p.dead);
    if (!runners.length || st.t > S.orbsTo) return;
    const lead = runners.reduce((a, b) => (b.x > a.x ? b : a)), back = runners.filter((p) => p !== lead).reduce((a, b) => (!a || b.x < a.x ? b : a), null); // (the one furthest behind)
    if (back && back.x < lead.x - VIEW_W * 0.35 && st.high < S.behind && st.t >= st.highAt[st.high]) { st.high++; st.left--; blowSandOrb(lead, back); }
    const coming = world.level.orbs.some((o) => o.sand && !o.sand.sink && !o.used && o.x > lead.x - 10); // (one still on its way to the leader)
    if (coming) st.next = Math.max(st.next, st.t + S.orbGap[0] + Math.random() * (S.orbGap[1] - S.orbGap[0]));
    else if (st.left > 0 && st.t >= st.next) { st.left--; blowSandOrb(lead, null); st.next = st.t + 0.1; }
  }
  // One comes in from the right of the leader's screen, at a height you can grab (running or with a jump); or, for the one
  // behind (back), too high for the leader, sinking once it's past them. Any action orb (alone, only the ones that do
  // something alone)
  function blowSandOrb(lead, back) {
    const S = SANDSTORM, level = world.level;
    const kinds = world.solo ? ["wind", "drone", "firehawk", "snowball", "monkey", "mushroom", "laser"] : ["wind", "zap", "hand", "drone", "firehawk", "snowball", "monkey", "mushroom", "laser"];
    // (heights are the orb's bottom edge: its top is 8 px higher)
    const x = lead.x + VIEW_W * 0.65 + 12, g = level.groundTop(lead.x + HITBOX_W / 2) ?? lead.y + HITBOX_H;
    const orb = { x, y: g - S.orbLow - Math.random() * (S.orbHigh - S.orbLow) - 8, w: 8, h: 8, used: false, kind: kinds[Math.floor(Math.random() * kinds.length)], sand: { phase: Math.random() * 6.28, sink: 0, floor: null } };
    if (back) {
      const gb = level.groundTop(back.x + HITBOX_W / 2) ?? back.y + HITBOX_H, closing = S.orbSpeed + PHYSICS.runSpeed;
      const past = (x - lead.x + 24) / closing, meet = (x - back.x) / closing; // (when it's past the leader; when it reaches the one behind)
      orb.y = g - S.tooHigh - 8 - S.bob;
      orb.sand.floor = gb - S.sinkTo - 8;
      orb.sand.wait = past; // it only starts sinking once it's past the leader...
      orb.sand.sink = Math.max(0, (orb.sand.floor - orb.y) / Math.max(0.3, (meet - past) * 0.8)); // (...and is low enough a little before it gets to them)
    }
    orb.sand.y = orb.y;
    level.orbs.push(orb);
  }
  function updateSandOrbs(dt) {
    const S = SANDSTORM, level = world.level, players = world.players.filter((p) => !p.caught);
    const leftmost = players.length ? Math.min(...players.map((p) => p.x)) : 0;
    for (const o of level.orbs) {
      if (!o.sand || o.used) continue;
      o.x -= S.orbSpeed * dt;
      if (o.sand.sink && (o.sand.wait -= dt) <= 0) o.sand.y = Math.min(o.sand.floor, o.sand.y + o.sand.sink * dt);
      o.sand.phase += dt * 5;
      o.y = Math.round(o.sand.y + Math.sin(o.sand.phase) * S.bob);
      if (o.x < leftmost - VIEW_W) o.used = true; // (blown away, past everyone)
    }
  }

  // ---- The jungle's orbs: monsoon and monkey ----

  // How high the water is (its surface, pixels from the top): rising up out of the ground, staying
  // up over everything, then draining away
  function floodSurface() {
    const m = world.monsoon;
    if (!m) return null;
    const low = VIEW_H + 4, high = MONSOON.surface;
    const up = Math.min(1, m.t / MONSOON.rise), down = Math.max(0, (m.t - (MONSOON.time - MONSOON.drain)) / MONSOON.drain);
    const ease = (u) => u * u * (3 - 2 * u);
    return low + (high - low) * ease(up) + (low - high) * ease(down);
  }

  // The water's coming: the dangers are washed away (or wait it out), everyone stuck in something
  // is let go, and a log rises up under everyone's feet
  function startMonsoon() {
    const { level, players } = world;
    world.monsoon = { t: 0, logs: [], draining: false };
    for (const v of world.vultures) v.done = true;
    for (const bear of world.bears) bear.done = true;
    for (const j of world.jaguars) j.done = true;
    world.missiles = [];
    world.arrows = [];
    world.sticks = [];
    level.fires = []; // (the rain puts them out)
    for (const tu of level.turrets) if (tu.state !== "hidden") { tu.state = "done"; tu.h = 0; tu.moving = false; }
    for (const p of players) {
      p.inRiver = null;
      p.inQuick = false;
      p.inSink = null;
      if (p.inPond) { p.inPond.frozen = p.inPond.frozen.filter((q) => q !== p); p.inPond = null; }
      p.trapped = 0;
      if (p.eatenBy) { p.eatenBy.victim = null; p.eatenBy.state = "opening"; p.eatenBy.t = 0; p.eatenBy = null; }
    }
    for (const p of players) if (!p.dead && !p.caught) addFloodLog(p.x + HITBOX_W / 2 - 20, 40);
    fillFloodLogs();
  }

  function addFloodLog(x, w) {
    const log = { kind: "flood", id: world.level.nextId++, x, y: (floodSurface() ?? VIEW_H) - 2, w, dx: 0 };
    world.monsoon.logs.push(log);
    world.level.platforms.push(log);
    return log;
  }

  // Logs all along the water, from well behind the last player to well ahead of the first, with an
  // easy hop between each
  function fillFloodLogs() {
    const m = world.monsoon, xs = world.players.map((p) => p.x);
    const from = Math.min(...xs) - VIEW_W, to = Math.max(...xs) + VIEW_W * 1.5;
    const gap = () => MONSOON.gap[0] + Math.random() * (MONSOON.gap[1] - MONSOON.gap[0]);
    const width = () => MONSOON.logWidths[Math.floor(Math.random() * MONSOON.logWidths.length)];
    const have = m.logs.slice().sort((a, c) => a.x - c.x);
    // walk along from behind everyone to out ahead, adding logs wherever there's room for one
    let x = Math.min(from, have.length ? have[0].x : from);
    for (const log of [...have, null]) {
      const end = log ? log.x - MONSOON.gap[0] : to;
      while (true) {
        const w = width();
        if (x + w > end) break;
        addFloodLog(x, w);
        x += w + gap();
      }
      if (log) x = Math.max(x, log.x + log.w + gap());
    }
  }

  function updateMonsoon(dt) {
    const m = world.monsoon, { level, players } = world;
    if (!m) { for (const p of players) p.flood = null; return; }
    m.t += dt;
    const surf = floodSurface();
    const riders = (log) => players.filter((p) => p.standingOn === log && !p.dead);
    if (!m.draining && m.t >= MONSOON.time - MONSOON.drain) {
      // draining away: each log someone's riding drifts them down onto the nearest safe ground
      m.draining = true;
      for (const log of m.logs) {
        const p = riders(log)[0];
        if (!p) continue;
        const a = level.safeSpotBefore(p.x + 1, 480), c = level.safeSpotAfter(p.x, 480);
        const spot = !a ? c : !c ? a : (p.x - a.x <= c.x - p.x ? a : c);
        if (spot) log.land = { x0: log.x, y0: log.y, dx: spot.x - p.x, y1: spot.y + HITBOX_H, t: 0 };
      }
    }
    for (const log of m.logs) {
      const ox = log.x, oy = log.y;
      if (log.land) {
        const L = log.land, u = Math.min(1, (L.t += dt) / MONSOON.drain), e = u * u * (3 - 2 * u);
        log.x = L.x0 + L.dx * e;
        log.y = L.y0 + (L.y1 - L.y0) * e;
      } else {
        if (m.t >= MONSOON.rise) log.x -= MONSOON.logSpeed * dt; // (they only start drifting once the water's all the way up)
        // (lying on the ground until the water reaches them and lifts them, bobbing)
        const rest = level.groundTop(log.x + log.w / 2) ?? VIEW_H + 4;
        log.y = Math.min(rest, surf - 2 + Math.sin(world.time * 3 + log.id) * 0.6);
      }
      log.dx = log.x - ox;
      // Rising up out of the ground, it scoops up whoever's standing there (the water mustn't beat it
      // to them); sinking as the water drains, it takes whoever's on it down with it (so they go
      // wherever it goes)
      if (log.y !== oy) for (const p of players) {
        if (p.dead || p.caught || p.held || p.inFlood || p.vy < 0 || p.x + HITBOX_W <= log.x || p.x >= log.x + log.w) continue;
        const feet = p.y + HITBOX_H;
        const on = log.y < oy ? feet >= log.y - 0.5 && feet <= oy + 2 : feet >= oy - 1 && feet <= oy + 3;
        if (on) { p.y = log.y - HITBOX_H; p.vy = 0; p.onGround = true; p.standingOn = log; }
      }
    }
    if (m.t >= MONSOON.time) {
      // gone: everyone's back on the ground (or wherever they were)
      level.platforms = level.platforms.filter((p) => p.kind !== "flood");
      for (const p of players) { if (p.standingOn && p.standingOn.kind === "flood") { p.standingOn = null; p.onGround = false; } p.flood = null; p.inFlood = false; }
      world.monsoon = null;
      return;
    }
    // logs drift off behind everyone and new ones come in ahead
    const minX = Math.min(...players.map((p) => p.x));
    const gone = m.logs.filter((l) => l.x + l.w < minX - VIEW_W * 1.5 && !riders(l).length);
    if (gone.length) {
      m.logs = m.logs.filter((l) => !gone.includes(l));
      level.platforms = level.platforms.filter((p) => !gone.includes(p));
    }
    if (!m.draining) fillFloodLogs();
    for (const p of players) p.flood = p.caught ? null : { surface: surf };
  }

  // The monkey swings in from the top of the screen on its vine, sweeping through the other player
  // (it aims for where they'll be at the bottom of its swing). Alone, it swings you forward instead.
  function launchMonkey(p) {
    const target = rivalOf(p);
    Sound.play("monkeySwing");
    if (!target || world.solo) {
      const spot = world.level.safeSpotAfter(p.x + MONKEY.ferryAhead * TILE, 480) || landingAfter(p.x + MONKEY.ferryAhead * TILE);
      if (!spot) return;
      world.monkeys.push({ mode: "fetch", owner: p, target: p, spot, t: 0, x: p.x - 60, y: -14, frame: "hang" });
      return;
    }
    const bottomT = MONKEY.swing / 2;
    const bx = target.x + HITBOX_W / 2 + target.vx * bottomT, by = target.y + HITBOX_H / 2;
    world.monkeys.push({ mode: "swing", owner: p, target, t: 0, ax: bx, ay: by - MONKEY.radius, x: bx + MONKEY.radius, y: by - MONKEY.radius, frame: "hang", facing: -1 });
  }

  function updateMonkeys(dt) {
    const { level } = world;
    for (const mk of world.monkeys) {
      mk.t += dt;
      const q = mk.target;
      const gone = q.dead || q.caught;
      if (mk.mode === "swing" || mk.mode === "carry") {
        // round the swing: from the right, down through the bottom (fastest) and up the left
        const u = Math.min(1, mk.t / MONKEY.swing), a = Math.PI * (1 - Math.cos(Math.PI * u)) / 2;
        if (mk.mode === "swing") {
          mk.x = mk.ax + Math.cos(a) * MONKEY.radius;
          mk.y = mk.ay + Math.sin(a) * MONKEY.radius;
        }
        mk.facing = -1;
        if (mk.mode === "swing" && !gone && !q.held && mk.y > mk.ay + MONKEY.radius - 8 && overlaps(q.x, q.y, HITBOX_W, HITBOX_H, mk.x - 4, mk.y - 4, 8, 8)) {
          mk.mode = "carry";
          mk.caughtAt = mk.t;
          q.held = true;
          q.vx = q.vy = 0;
          q.inQuick = false;
          q.trapped = 0;
          q.showHit("GRABBED BY A MONKEY!", "#c8946a");
          Sound.play("monkeyGrab");
        }
        if (mk.mode === "carry") {
          // swept up off their feet (a short way: the swing is fast)
          const c = Math.min(1, (mk.t - mk.caughtAt) / MONKEY.carry);
          if (!mk.from) mk.from = { x: q.x, y: q.y };
          mk.frame = "carry";
          q.x = mk.from.x - 14 * c;
          q.y = mk.from.y - 18 * c;
          mk.x = q.x + HITBOX_W / 2;
          mk.y = q.y - 6;
          if (mk.t - mk.caughtAt >= MONKEY.carry || gone) {
            // fling them back, and leap off after them
            q.held = false;
            q.vx = -MONKEY.fling[0];
            q.vy = -MONKEY.fling[1];
            q.onGround = false;
            q.standingOn = null;
            q.stun = 0.35;
            q.noCut = 0.5;
            mk.mode = "leap";
            mk.vx = -MONKEY.fling[0] * 0.6;
            mk.vy = -120;
          }
        } else if (u >= 0.62) {
          // missed: it lets go of its vine and comes after them anyway
          mk.mode = "leap";
          mk.vx = -60;
          mk.vy = -40;
        }
      } else if (mk.mode === "leap" || mk.mode === "chase") {
        mk.frame = mk.mode === "leap" ? "leap" : "hang";
        if (gone || mk.t > MONKEY.giveUp + MONKEY.swing) { mk.mode = "leave"; continue; }
        if (mk.mode === "leap") {
          mk.vy += PHYSICS.gravity * dt;
          mk.x += mk.vx * dt;
          mk.y += mk.vy * dt;
          const g = level.groundTop(mk.x) ?? VIEW_H;
          if (mk.y >= g - 6 && mk.vy > 0) { mk.y = g - 6; mk.mode = "chase"; }
        } else {
          // scamper after them at running speed, along the ground (or the logs)
          const dir = Math.sign(q.x + HITBOX_W / 2 - mk.x) || 1;
          mk.facing = dir;
          mk.x += dir * MONKEY.chaseSpeed * dt;
          const g = level.groundTop(mk.x);
          mk.y = g !== null ? g - 6 : Math.min(mk.y + 200 * dt, VIEW_H);
          mk.frame = Math.floor(mk.t * 10) % 2 ? "leap" : "hang";
        }
        // close enough: it jumps up onto their head
        if (!q.held && Math.abs(mk.x - (q.x + HITBOX_W / 2)) < 9 && Math.abs(mk.y - (q.y + 2)) < 22) {
          mk.mode = "ride";
          mk.t = 0;
          q.blind = MONKEY.blind;
          q.showHit("CAN'T SEE!", "#c8946a");
          Sound.play("monkeyHoot");
        }
      } else if (mk.mode === "ride") {
        mk.frame = "sit";
        mk.x = q.x + HITBOX_W / 2;
        mk.y = q.y - 4;
        if (gone || q.blind <= 0) { q.blind = 0; mk.mode = "leave"; mk.t = 0; }
      } else if (mk.mode === "fetch") {
        // alone: swing down to you, then carry you along an arc to the safe spot ahead
        const down = 0.35;
        if (mk.t < down) {
          const u = mk.t / down;
          mk.x = q.x + HITBOX_W / 2 - 60 * (1 - u);
          mk.y = -14 + (q.y - 4 + 14) * u * u;
          mk.frame = "hang";
          mk.facing = 1;
        } else {
          if (!mk.from) { mk.from = { x: q.x, y: q.y }; q.held = true; q.vx = q.vy = 0; Sound.play("monkeyGrab"); }
          const u = Math.min(1, (mk.t - down) / MONKEY.ferry), e = u * u * (3 - 2 * u);
          q.x = mk.from.x + (mk.spot.x - mk.from.x) * e;
          q.y = mk.from.y + (mk.spot.y - mk.from.y) * e - Math.sin(Math.PI * u) * 46;
          mk.x = q.x + HITBOX_W / 2;
          mk.y = q.y - 10;
          mk.frame = "carry";
          if (u >= 1) {
            q.held = false;
            q.x = mk.spot.x;
            q.y = mk.spot.y;
            q.vx = q.vy = 0;
            q.onGround = true;
            mk.mode = "leave";
            mk.t = 0;
          }
        }
      } else {
        // off it goes, up out of sight
        mk.frame = "leap";
        mk.y -= 180 * dt;
        mk.x += (mk.facing || 1) * 60 * dt;
        if (mk.y < -30 || mk.t > 3) mk.done = true;
      }
    }
    world.monkeys = world.monkeys.filter((mk) => !mk.done);
  }

  // ---- Getting into the enchanted forest (the giant sleep mushroom) and out (the fireflies) ----

  // The enchanted forests anyone is in right now (each is a course of its own, alongside the main one)
  function forests() {
    return [...new Set(world.players.map((p) => p.realm).filter(Boolean))];
  }

  // Run f with `course` as the course, and everyone who isn't on it (or is on their way between the two)
  // counted as out of the race for a moment
  function onCourse(course, f) {
    const main = world.level, off = world.players.filter((p) => (p.realm || main) !== course || p.dream);
    for (const p of off) { p.wasCaught = p.caught; p.caught = true; }
    world.level = course;
    world.mainCourse = main; // (so moving someone back to the main course knows where that is)
    try { f(); } finally {
      world.level = main;
      world.mainCourse = null;
      for (const p of off) p.caught = p.wasCaught;
    }
  }

  // Walk into a sleep mushroom's cloud and you fall asleep
  function updateSleepShrooms() {
    const { level } = world;
    for (const p of world.players) {
      if (p.dead || p.caught || p.held || p.dream) continue;
      const g = level.sleepShrooms.find((m) => Math.abs(m.x - p.x) < 80 && level.sleepSporeHits(m, p.x, p.y, world.time));
      if (!g) continue;
      p.dream = { kind: "sleep", t: 0, gate: g };
      p.held = true;
      p.vx = p.vy = 0;
      p.inQuick = false;
      p.inRiver = null;
      p.trapped = 0;
      Sound.play("fallAsleep");
    }
  }

  // Falling asleep and waking up in the forest, and the fireflies taking you back out at its end
  function updateDreams(dt) {
    const S = SLEEP_SHROOM;
    for (const p of world.players) {
      if (!p.dream) {
        // the end of the forest: the fireflies come for you
        if (p.realm && p.realm.biome === "forest" && !p.dead && !p.caught && !p.held && p.realm.realmExit !== undefined && p.x >= p.realm.realmExit) {
          p.dream = { kind: "fireflies", t: 0 };
          p.held = true;
          p.vx = p.vy = 0;
          Sound.play("fireflies");
        }
        continue;
      }
      const d = p.dream;
      d.t += dt;
      if (p.caught) { p.dream = null; continue; } // (the fire got you while you slept)
      // Nodding off (or bonked awake) mid-jump: you drop to the ground first, instead of hanging in the air
      if (!d.moved && d.kind !== "fireflies") {
        const g = (p.realm || world.level).groundTop(p.x + HITBOX_W / 2);
        if (g !== null && p.y + HITBOX_H < g) {
          p.vy = Math.max(0, p.vy) + PHYSICS.gravity * dt;
          p.y = Math.min(g - HITBOX_H, p.y + p.vy * dt);
          if (p.y + HITBOX_H >= g) { p.vy = 0; p.onGround = true; }
        }
      }
      const out = d.kind === "fireflies" ? S.fireflies : 0; // (the fireflies first, then the same fade as falling asleep)
      if (!d.moved && d.t >= out + S.sleep) {
        d.moved = true;
        // (the time spent falling asleep and waking up isn't lost: you wake as far on as you'd have run in it)
        if (d.kind === "sleep") {
          if (!d.gate.forest) d.gate.forest = makeForest(d.gate, p.x + travelGain(S.sleep + S.wake));
          moveTo(p, d.gate.forest, p.x + travelGain(S.sleep + S.wake));
        } else moveTo(p, null, p.x + travelGain(S.fireflies + S.sleep + S.wake));
        p.lying = true;
        Sound.play("wakeUp");
      }
      if (d.t >= out + S.sleep + S.wake) {
        p.dream = null;
        p.held = false;
        p.lying = false;
        if (d.kind === "fireflies") { // made it through the forest: its gifts, magic feet for the rest of the race, and its roots
          p.magicFeet = true;
          if (world.solo) p.rootGuard = true; // (alone it isn't a power: the roots just guard you from the fire, and you keep yours)
          else p.power = "roots";
          p.showHit("MAGIC FEET!", "#e2a6ff");
          p.sparkle("#e2a6ff");
          Sound.play("magicFeet");
        }
      }
    }
  }

  // How dark someone's screen is (0..1) while they fall asleep or wake up
  function dreamDark(p) {
    const d = p.dream, S = SLEEP_SHROOM;
    if (!d) return 0;
    const t = d.t - (d.kind === "fireflies" ? S.fireflies : 0);
    if (t < 0) return 0;
    return t < S.sleep ? t / S.sleep : Math.max(0, 1 - (t - S.sleep) / S.wake);
  }

  // A new enchanted forest for a sleep mushroom: it covers the same stretch as the main course from where
  // the mushroom stands (calm ground where you wake up), 100-250 tiles long, then flat ground (the fireflies)
  function makeForest(g, arrive) {
    const c0 = Math.floor(g.x / TILE) + 20;
    const len = Math.round(SLEEP_SHROOM.forest[0] + Math.random() * (SLEEP_SHROOM.forest[1] - SLEEP_SHROOM.forest[0]));
    const f = new Level(Math.floor(Math.random() * 1e9), "forest", { solo: world.solo, biomes: false, wild: world.wild, realmEnd: (c0 + len) * TILE });
    f.flat(Math.max(1, c0 - f.col), false);
    if (Math.random() < LEAVE.dreamChance) f.addLeave(arrive - LEAVE.wakeBehind, f.realmEnd); // (1 in 5: Leave, the walking tree, just behind where you wake)
    f.update(world.time);
    return f;
  }

  // Put someone on a course (realm: a forest, or null for the main course) at x, on safe ground near there
  // How far a runner would have got running for this long: a trip into or out of a special biome adds it to where you come
  // out, so travelling there doesn't cost you ground (v7.45)
  function travelGain(seconds) { return PHYSICS.runSpeed * seconds; }

  function moveTo(p, realm, x) {
    if (realm && realm === (world.mainCourse || world.level)) realm = null; // (back onto the main course: no realm)
    const course = realm || world.mainCourse || world.level;
    course.ensure(x + VIEW_W * 2);
    const g = course.groundTop(x + HITBOX_W / 2);
    let spot = g !== null && course.groundTop(x + 1) === g && course.groundTop(x + HITBOX_W - 1) === g && !course.threatened(x, g - HITBOX_H) ? { x, y: g - HITBOX_H } : null;
    if (!spot) {
      const before = course.safeSpotBefore(x), after = course.safeSpotAfter(x);
      spot = before && (!after || x - before.x <= after.x - x) ? before : after || before || { x, y: 40 };
    }
    p.realm = realm;
    Object.assign(p, { x: spot.x, y: spot.y, vx: 0, vy: 0, onGround: true, standingOn: null, inQuick: false, inRiver: null, inSink: null, inPond: null, onPond: null, hiddenIn: null, eatenBy: null, trapped: 0 });
    p.safeSpots = [{ x: spot.x, y: spot.y }];
    // (the things each player keeps track of on a course belong to the one they've left)
    for (const m of [p.fallState, p.icicleState, p.coconutState, p.trapState, p.tumbleStarted, p.snowballStarted, p.rotState]) m.clear();
    p.spinning = false;
    p.spin = 0;
    p.tumbleweeds = [];
    p.snowballs = [];
  }

  // ---- The military camp (the third secret world): a helicopter in, a jet back out ----

  // Where the helicopter's rope hangs from (its back door: the twin-rotor faces the way it flies)
  const ropeX = (h) => h.x + (h.dir < 0 ? 34 : 16);

  // Once per race, when the leader nears its spot, a twin-rotor helicopter flies in from the right, back toward the fire, a
  // rope with a loop hanging down. Jump and grab it: it carries on for 5 s (anyone else can grab on too), then climbs away
  // with everyone on the rope into the camp. But if the fire comes onto a rider's screen while it's carrying them, it turns
  // round and flies them 50 m ahead of the fire instead, where a missile shoots it down (they come back to life there).
  // Miss it and it flies off for good.
  function updateHeli(dt) {
    const { level, players } = world, Hc = HELI;
    const spot = level.heliSpots.find((s) => !s.used);
    if (spot && !world.heli) {
      const lead = players.filter((p) => !p.caught).reduce((a, b) => (!a || b.x > a.x ? b : a), null);
      if (lead && lead.x >= spot.x - VIEW_W * 0.3) {
        spot.used = true;
        world.heli = { level, x: lead.x + VIEW_W * 0.7, y: Hc.top, dir: -1, state: "in", t: 0, riders: [], loopY: null, ground: lead.y + HITBOX_H, vy: 0, chop: 0 };
      }
    }
    const h = world.heli;
    if (!h) return;
    h.t += dt;
    if (h.state === "in" || h.state === "carry") h.x -= Hc.speed * dt;
    else if (h.state === "rise" || h.state === "away") { h.x -= Hc.speed * 1.6 * dt; h.y -= 50 * dt; }
    else if (h.state === "rescue") h.x += Hc.rescueSpeed * dt;
    else if (h.state === "missile") h.x += world.fire.speed * dt; // (keeping its 50 m on the fire)
    else if (h.state === "hit") { h.vy += 320 * dt; h.y += h.vy * dt; h.x += 50 * dt; }
    // the rope's loop, hanging a jump's height over the ground (its length kept once it climbs)
    const g = level.groundTop(ropeX(h));
    if (g !== null) h.ground = g;
    if (h.state === "rise" || h.state === "away" || h.state === "hit") h.loopY = h.y + 15 + h.ropeLen;
    else {
      const want = h.ground - Hc.ropeLow;
      h.loopY = h.loopY === null ? want : h.loopY + Math.sign(want - h.loopY) * Math.min(Math.abs(want - h.loopY), 80 * dt);
      h.ropeLen = h.loopY - (h.y + 15);
    }
    if ((h.chop -= dt) <= 0) { h.chop = 0.11; if (players.some((p) => !p.realm && Math.abs(h.x + 25 - p.x) < VIEW_W)) Sound.play("heliChop"); }
    // grabbing the rope: jump and touch the loop (until it climbs away)
    if (h.state === "in" || h.state === "carry") {
      const [w, hh] = Hc.loop, lx = ropeX(h) - w / 2;
      for (const p of players) {
        if (h.riders.includes(p) || !freeRunner(p) || p.realm || p.jet || p.flight) continue;
        if (!overlaps(p.x, p.y, HITBOX_W, HITBOX_H, lx, h.loopY - 2, w, hh)) continue;
        h.riders.push(p);
        Object.assign(p, { held: true, vx: 0, vy: 0, standingOn: null, onGround: false, inQuick: false, inRiver: null, trapped: 0, dashHold: 0, dashTime: 0, windTime: 0, grabAt: world.time, grabX: p.x });
        p.showHit("HANG ON!", "#d8c89a");
        Sound.play("grab");
        if (h.state === "in") { h.state = "carry"; h.t = 0; }
      }
    }
    h.riders = h.riders.filter((p) => !p.caught);
    h.riders.forEach((p, i) => { p.x = ropeX(h) - HITBOX_W / 2; p.y = h.loopY - 2 - i * 12; p.facing = h.dir; });
    // the fire on a rider's screen: it won't take them in, it turns round (once it's climbing, it's too late for that)
    if (h.state === "carry" && h.riders.some((p) => world.fire.x >= p.x - VIEW_W * 0.35)) {
      Object.assign(h, { state: "rescue", t: 0, dir: 1, x: h.x - 18 }); // (turned round: the rope's at its other end now)
      for (const p of h.riders) p.showHit("TOO HOT! GETTING YOU OUT!", "#ffb347");
      Sound.play("heliChop");
    }
    if (h.state === "carry" && h.t >= Hc.carry) { h.state = "rise"; h.t = 0; Sound.play("heliChop"); }
    else if (h.state === "rise" && h.t >= Hc.rise) { // up and away: everyone on the rope goes to the camp
      const first = h.riders[0];
      if (first) h.camp = makeCamp(first.grabX + travelGain(world.time - first.grabAt + 0.6));
      for (const p of h.riders) p.flight = { kind: "in", t: 0, camp: h.camp };
      h.riders = [];
      h.state = "away";
    } else if (h.state === "rescue" && h.x >= world.fire.x + Hc.rescue * TILE) { h.state = "missile"; h.t = 0; Sound.play("incoming"); }
    else if (h.state === "missile" && h.t >= Hc.missile) { // shot down: everyone on board dies (and comes back to life there, safe)
      h.state = "hit"; h.t = 0; h.vy = -40;
      Sound.play("boom");
      for (let i = 0; i < 16; i++) world.sawBits.push({ x: h.x + 25, y: h.y + 8, vx: (Math.random() - 0.5) * 160, vy: -40 - Math.random() * 90, t: 0.8, c: ["#ffd040", "#ff7a1a", "#e84a2a", "#3a3a3a"][i % 4], big: i % 3 === 0, level });
      for (const p of h.riders) { p.held = false; p.showHit("SHOT DOWN!", "#ff7a3a"); p.die(); }
      h.riders = [];
    } else if (h.state === "hit" && h.y > VIEW_H + 20) world.heli = null;
    else if (h.state === "away" && h.y < -40) world.heli = null;
    else if (h.state === "in" && h.riders.length === 0 && players.every((p) => p.caught || p.realm || h.x + 60 < p.x - VIEW_W * (0.35 + Hc.gone))) world.heli = null; // (missed: gone for good)
  }

  // The camp: its own course covering the same stretch as the main one from where you come in (calm ground there), 156-216
  // tiles of it, then flat ground at the end, where the jet picks you up
  function makeCamp(arriveX) {
    const c0 = Math.floor(arriveX / TILE) - 2;
    const len = Math.round(CAMP.length[0] + Math.random() * (CAMP.length[1] - CAMP.length[0]));
    const f = new Level(Math.floor(Math.random() * 1e9), "camp", { solo: world.solo, biomes: false, wild: world.wild, realmEnd: (c0 + CAMP.arrive + len) * TILE });
    f.flat(Math.max(1, c0 - f.col), false);
    f.flat(CAMP.arrive, false);
    f.update(world.time);
    return f;
  }

  // Going in (the screen fades as the helicopter climbs away, and you come in at the camp), and coming back: at the camp's
  // end the screen fades and you're in a jet, flying in from the left over the main course, carpet-bombing it, until you're
  // over where you should be (as far on as you'd have run: no ground lost), then you parachute down
  function updateFlights(dt) {
    const J = JET;
    for (const p of world.players) {
      if (!p.flight && !p.jet && p.realm && p.realm.biome === "camp" && !p.dead && !p.caught && !p.held && p.realm.realmExit !== undefined && p.x >= p.realm.realmExit) {
        p.flight = { kind: "out", t: 0, from: p.x }; // (the end of the camp: your ride home)
        Object.assign(p, { held: true, vx: 0, vy: 0 });
        Sound.play("jetRoar");
      }
      const f = p.flight;
      if (f) {
        f.t += dt;
        if (p.caught) { p.flight = null; continue; }
        if (!f.moved && f.t >= 0.6) {
          f.moved = true;
          if (f.kind === "in") moveTo(p, f.camp, p.grabX + travelGain(world.time - p.grabAt));
          else { // onto the main course where you'll come out, then into the jet, well behind it
            moveTo(p, null, f.from + travelGain(0.6 + J.back / J.speed + J.chute));
            p.jet = { t: 0, x: p.x - J.back, to: { x: p.x, y: p.y }, phase: "fly", bomb: 0 };
            p.x = p.jet.x;
            p.y = J.height + 6;
          }
          p.held = true;
        }
        if (f.t >= 1.2) { p.flight = null; if (!p.jet) p.held = false; }
      }
      const jt = p.jet;
      if (!jt) continue;
      jt.t += dt;
      if (jt.phase === "fly") {
        jt.x = Math.min(jt.to.x, jt.x + J.speed * dt);
        p.x = jt.x;
        p.y = J.height + 6;
        if ((jt.bomb -= dt) <= 0) { jt.bomb = J.bombEvery; world.jetBombs.push({ x: jt.x + 4, y: J.height + 8, vx: J.speed * 0.55, vy: 30 }); }
        if (jt.x >= jt.to.x) { jt.phase = "chute"; jt.t = 0; Sound.play("grab"); }
      } else { // floating down under a parachute
        const k = Math.min(1, jt.t / J.chute);
        p.x = jt.to.x;
        p.y = J.height + 6 + (jt.to.y - J.height - 6) * k;
        if (k >= 1) { p.jet = null; p.held = false; p.onGround = true; p.vy = 0; p.safeSpots = [{ x: p.x, y: p.y }]; Sound.play("land"); }
      }
    }
    // the jet's bombs: falling on the main course and blowing up there (just for show, for now)
    const level = world.level;
    for (const b of world.jetBombs) {
      b.vy += 420 * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      const g = level.groundTop(b.x);
      if ((g !== null && b.y >= g - 1) || b.y > VIEW_H + 8) {
        b.gone = true;
        const y = (g ?? VIEW_H) - 2;
        for (let i = 0; i < 9; i++) world.sawBits.push({ x: b.x, y, vx: (Math.random() - 0.5) * 120, vy: -40 - Math.random() * 110, t: 0.55, c: ["#ffd040", "#ff7a1a", "#e84a2a", "#5a5040"][i % 4], big: i % 3 === 0, level });
        if (Math.random() < 0.5) world.quakes.push({ x: b.x, t: 0.12, level });
        Sound.play("bombBoom");
      }
    }
    world.jetBombs = world.jetBombs.filter((b) => !b.gone);
  }

  // How dark someone's screen is (0..1) as they go into the camp or come out of it
  function flightDark(p) {
    const f = p.flight;
    if (!f) return 0;
    return f.t < 0.6 ? f.t / 0.6 : Math.max(0, 1 - (f.t - 0.6) / 0.6);
  }

  // ---- The arcane ruins: its portal, the race against the clock inside, and the ways back out ----

  const freeRunner = (p) => !p.dead && !p.caught && !p.held && !p.dream && !p.trip;

  // The ruins portal on the main course: run over its button and it bursts on (the aurora pulling in anyone
  // close by); then anyone can jump into it; press the button again (anyone) and it breaks apart
  function updateRuinsGates() {
    const { level, players } = world;
    for (const g of level.ruinsGates) {
      if (!players.some((p) => Math.abs(p.x - g.x) < VIEW_W)) continue;
      if (g.state === "on" && world.time - g.openedAt >= RUINS.time) { g.state = "broken"; g.brokenAt = world.time; Sound.play("portalBreak"); } // (its time's up: it crumbles)
      for (const p of players) {
        const on = freeRunner(p) && p.onGround && p.x + HITBOX_W > g.x - 4 && p.x < g.x + 4 && Math.abs(p.y + HITBOX_H - g.gy) < 2;
        if (!on) { if (p.onButton === g.id) p.onButton = null; continue; }
        if (p.onButton === g.id) continue; // (still standing on it: one press)
        p.onButton = g.id;
        if (g.state === "broken") continue;
        g.presses++;
        Sound.play("buttonClick");
        if (g.state === "off") {
          g.state = "on";
          g.openedAt = world.time;
          g.burstAt = world.time;
          g.realm = makeRuins(g);
          Sound.play("portalOpen");
          for (const q of players) if (freeRunner(q) && !q.realm && Math.abs(q.x + HITBOX_W / 2 - g.x) < RUINS.grab) startTrip(q, "in", g); // (the aurora bursts out and grabs whoever's close)
        } else {
          g.state = "broken";
          g.brokenAt = world.time;
          Sound.play("portalBreak");
        }
      }
      if (g.state !== "on") continue;
      const cy = g.gy - RUINS.ringR - 1 - RUINS.floatUp;
      if (world.time - g.burstAt < RUINS.buildTime) continue; // (its ring is still building)
      for (const p of players) if (freeRunner(p) && !p.realm && touchesHole(p, g.x, cy)) startTrip(p, "in", g); // (jumping into it)
    }
  }

  const touchesSwirl = (p, x, y, r) => Math.hypot(clamp(x, p.x, p.x + HITBOX_W) - x, clamp(y, p.y, p.y + HITBOX_H) - y) < r; // (a smaller swirl: the optional biome portals)
  const touchesHole = (p, x, y) => Math.hypot(clamp(x, p.x, p.x + HITBOX_W) - x, clamp(y, p.y, p.y + HITBOX_H) - y) < RUINS.hole + 1; // (anywhere in its swirl; out of reach standing under it)

  // The arcane ruins behind a portal: the same stretch as the main course from the portal on, calm ground where you
  // arrive, then RUINS.length tiles to the exit portal
  function makeRuins(g) {
    const c0 = Math.floor(g.x / TILE) + 2 + Math.max(0, Math.round((travelGain(RUINS.pullTime + RUINS.buildTime + RUINS.outTime) - 8 * TILE) / TILE)); // (you arrive as far on as you'd have run while the portal took you: it used to be just 8 tiles on)
    const f = new Level(Math.floor(Math.random() * 1e9), "ruins", { solo: world.solo, biomes: false, wild: world.wild, realmEnd: (c0 + RUINS.arrive + RUINS.length) * TILE });
    f.flat(Math.max(1, c0 - f.col), false);
    f.flat(RUINS.arrive, false);
    f.gate = g;
    f.arriveX = (c0 + 6) * TILE;
    // where you arrive: a clean gateway (a stone arch between two rune pillars), resting until someone comes through
    f.arriveGate = { level: f, x: f.arriveX + HITBOX_W / 2, gy: f.groundRow * TILE, cy: f.groundRow * TILE - RUINS.gateUp, style: "clean", state: "rest", t: 0 };
    world.builtPortals.push(f.arriveGate);
    f.startX = f.arriveX;
    // its two biome portals (one forced, one optional), going to the biomes picked for this race (just one or none picked: any)
    const picked = biomeList.filter((b) => BIOMES.includes(b)), pool = picked.length > 1 ? picked : BIOMES;
    f.legBiomes = [0, 1].map(() => pool[Math.floor(Math.random() * pool.length)]);
    const a = c0 + RUINS.arrive;
    if (Math.random() < RUINS.forcedChance) f.forcedAt = a + RUINS.forcedAt[0] + Math.floor(Math.random() * (RUINS.forcedAt[1] - RUINS.forcedAt[0] + 1));
    else f.optionalAt = a + RUINS.optionalAlone[0] + Math.floor(Math.random() * (RUINS.optionalAlone[1] - RUINS.optionalAlone[0] + 1)); // (no forced one this time: just the optional one)
    f.update(world.time);
    return f;
  }

  // ---- The ruins' biome portals: a short, packed stretch of another biome, then back into the ruins ----

  // Into one: its stretch is a course of its own (made the first time anyone goes in, shared after that), covering
  // the same x as the ruins from the portal on; you come back out at outX (further on, for an optional one)
  function enterLeg(p, g, f) {
    if (!g.leg) {
      // where it ends: you come back out just as far along as it took you (an optional one's stretch runs to the calm patch
      // the ruins left for it, wherever that ended up)
      if (!g.forced) f.ensure(g.landCol * TILE + 40 * TILE);
      const c0 = Math.floor(g.x / TILE), endCol = g.forced || g.calmX === undefined ? c0 + 3 + g.L : Math.round(g.calmX / TILE) + 1;
      const leg = new Level(Math.floor(Math.random() * 1e9), g.biome, { solo: world.solo, biomes: false, wild: world.wild || RUINS.legWild, leg: true, realmEnd: endCol * TILE });
      leg.flat(Math.max(1, c0 - leg.col), false);
      leg.flat(3, false);
      leg.parent = f; leg.gate = f.gate; leg.biomeGate = g; leg.startX = f.startX;
      leg.ensure(endCol * TILE + 40 * TILE);
      g.outX = leg.realmExit + TILE;
      leg.update(world.time);
      g.leg = leg;
    }
    moveTo(p, g.leg, g.x);
    legFlash(p, g.biome);
  }
  function legFlash(p, biome) { // a burst of the portal's colours as you come through
    p.sparkle({ prairie: "#b8e04a", snow: "#e8f6ff", desert: "#ffcc66", jungle: "#2fbf5a", ruins: "#7af0d8" }[biome]);
    p.warpFlash = 0.25;
    Sound.play("portalPop");
  }
  // In the ruins: run through a forced one, or jump into an optional one
  function updateBiomeGates(f) {
    for (const g of f.biomeGates) for (const p of world.players) {
      if ((p.realm || world.mainCourse || world.level) !== f || !freeRunner(p) || (g.went && g.went.includes(p))) continue; // (each takes you through once)
      if (g.forced ? p.x + HITBOX_W / 2 >= g.x : touchesSwirl(p, g.x, g.gy - RUINS.optUp, RUINS.optHole)) { (g.went = g.went || []).push(p); enterLeg(p, g, f); }
    }
  }
  // In a stretch: reach its end and you're back in the ruins; the ruins' clock still counts down in here
  function updateLeg(leg) {
    const f = leg.parent, g = leg.biomeGate;
    leg.ensure(leg.realmEnd + 30 * TILE);
    for (const p of world.players) {
      if (p.realm !== leg || p.caught || p.trip) continue;
      if (ruinsLeft(f, p) <= 0) {
        if (p.dead) { p.dead = false; p.x = p.respawnX; p.y = p.respawnY; }
        p.showHit("TIME'S UP!", "#ff5a4a");
        startTrip(p, "fail", null);
        continue;
      }
      if (freeRunner(p) && leg.realmExit !== undefined && p.x >= leg.realmExit + TILE) {
        moveTo(p, f, g.outX !== undefined ? g.outX : p.x);
        legFlash(p, "ruins");
        if (!g.forced && f.gate) { // through an optional one: more time on your clock (in the ruins you reach by portal)
          p.ruinsBonus = (p.ruinsBonus || 0) + RUINS.timeBonus;
          p.showHit(`+${RUINS.timeBonus} SECONDS!`, "#7af0d8");
          Sound.play("auroraBack");
        }
      }
    }
  }

  // How many seconds a ruins has left
  function ruinsLeft(f, p) { // (p: whose clock: an optional biome portal gives you more time)
    const R = f && f.parent ? f.parent : f, bonus = p ? p.ruinsBonus || 0 : 0;
    return (R && R.gate && R.gate.openedAt !== null ? RUINS.time - (world.time - R.gate.openedAt) : RUINS.time) + bonus;
  }

  // The ruins' storm engines: each fires a ball of lightning on its own timer (when someone's near); a ball bursts out,
  // eases down to a drift after whoever's nearest, and blows up at the end of its life. Shared by everyone on the course.
  function updateStorms(dt) {
    const { level, players } = world, S = STORM;
    const runners = players.filter((p) => !p.dead && !p.caught && !p.held && !p.trip);
    const nearest = (x, y) => { let best = null, bd = Infinity; for (const p of runners) { const d = Math.hypot(p.x + HITBOX_W / 2 - x, p.y + HITBOX_H / 2 - y); if (d < bd) { bd = d; best = p; } } return best; };
    for (const s of level.storms) {
      const st = level.stormState(s, level.time);
      if (s.lastK !== undefined && st.k !== s.lastK && runners.some((p) => Math.abs(p.x - s.x) < S.sense)) {
        const y = s.gy - S.rise, p = nearest(s.x, y);
        world.stormBalls.push({ level, x: s.x, y, angle: p ? Math.atan2(p.y + HITBOX_H / 2 - y, p.x + HITBOX_W / 2 - s.x) : -Math.PI / 2, age: 0, seed: Math.floor(Math.random() * 1000) });
        Sound.play("stormFire");
      }
      if (st.charge > 0 && !s.whirring && runners.some((p) => Math.abs(p.x - s.x) < VIEW_W * 0.6)) { s.whirring = true; Sound.play("stormCharge"); }
      if (st.charge === 0) s.whirring = false;
      s.lastK = st.k;
    }
    for (const b of world.stormBalls) {
      if (b.level !== level || b.done) continue;
      b.age += dt;
      const p = nearest(b.x, b.y);
      if (p && b.age >= STORM.boost) { // (its burst out of the engine flies straight, where it was aimed: dodge it) then it turns towards them, a little at a time
        const want = Math.atan2(p.y + HITBOX_H / 2 - b.y, p.x + HITBOX_W / 2 - b.x);
        let d = want - b.angle; d = Math.atan2(Math.sin(d), Math.cos(d));
        b.angle += Math.max(-S.turn * dt, Math.min(S.turn * dt, d));
      }
      const speed = b.age < S.boost ? S.speed + (S.launch - S.speed) * (1 - b.age / S.boost) ** 2 : S.speed; // (the burst out of the engine)
      b.x += Math.cos(b.angle) * speed * dt;
      b.y += Math.sin(b.angle) * speed * dt;
      const g = level.groundTop(b.x);
      if (g !== null && b.y > g - 7) b.y = g - 7; // (it skims the ground, never sinks into it)
      if (b.y < 8) b.y = 8;
      for (const q of runners) { // touching it zaps you
        const nx = Math.max(q.x, Math.min(b.x, q.x + HITBOX_W)), ny = Math.max(q.y, Math.min(b.y, q.y + HITBOX_H));
        if (Math.hypot(b.x - nx, b.y - ny) < S.touch) q.die("ZAPPED!");
      }
      if (b.age >= S.life) { // it blows up: anyone in reach is caught in it
        b.done = true;
        for (const q of runners) {
          if (q.dead) continue;
          const nx = Math.max(q.x, Math.min(b.x, q.x + HITBOX_W)), ny = Math.max(q.y, Math.min(b.y, q.y + HITBOX_H));
          if (Math.hypot(b.x - nx, b.y - ny) < S.blast) q.die("BLASTED!");
        }
        world.blasts.push({ level, x: b.x, y: b.y, gy: g !== null ? g : b.y + 20, t: 0 });
        world.quakes.push({ level, x: b.x, t: S.boom });
        Sound.play("stormBoom");
      }
    }
    world.stormBalls = world.stormBalls.filter((b) => !b.done);
  }

  // The ruins' lightning mortar: one at a time on a course (the one whose stretch the leader's in). It turns to face
  // whichever runner is farthest from it, however far, glows, and lobs a bomb at where they are right then. A
  // bomb climbs, glides along the top of the screen if it has far to go, drops like a stone and blows up the moment it
  // lands. Shared by everyone on the course.
  function updateMortars(dt) {
    const { level, players } = world, M = MORTAR;
    const runners = players.filter((p) => !p.dead && !p.caught && !p.held && !p.trip);
    const lead = runners.length ? Math.max(...runners.map((p) => p.x)) : null;
    const farthest = (m) => { let best = null, bd = -1; for (const p of runners) { const d = Math.abs(p.x + HITBOX_W / 2 - m.x); if (d > bd) { bd = d; best = p; } } return best; };
    let awake = null; // (just one at a time: the one whose stretch the leader's in, the newest if two overlap)
    if (lead !== null) for (const m of level.mortars) if (lead >= (m.x0 ?? -Infinity) && lead < (m.x1 ?? Infinity)) awake = m;
    for (const m of level.mortars) {
      const st = level.mortarState(m, level.time), on = m === awake;
      m.on = on; // (only the mortar whose stretch the leader's in is awake: the others sit still)
      if (m.face === undefined) { m.face = 1; m.from = 1; m.turnK = -1; }
      if (on && st.turning > 0 && m.turnK !== st.k) { // time to turn: pick its runner, and face them
        m.turnK = st.k;
        m.target = farthest(m);
        m.from = m.face;
        if (m.target) m.face = Math.sign(m.target.x + HITBOX_W / 2 - m.x) || m.face;
      }
      if (on && m.lastK !== undefined && st.k !== m.lastK) { // fire
        const p = m.target && runners.includes(m.target) ? m.target : farthest(m);
        if (p) {
          const x0 = m.x + m.face * 11, y0 = m.gy - 25; // (the muzzle, the barrel at 45 degrees)
          // (v7.53: just behind where they'll be when it lands if they keep going, its blast's edge only just missing them: a far
          // shot takes longer, so work out when it lands and where they'll be then)
          const vx = Math.max(-PHYSICS.runSpeed * TUNING.speed, Math.min(PHYSICS.runSpeed * TUNING.speed, p.vx || 0)), back = vx !== 0 ? -Math.sign(vx) : -(p.facing || 1);
          const miss = (y) => (back < 0 ? y : y + HITBOX_W) + back * (M.blast + M.miss); // (the blast's edge just short of their nearer side)
          let x1 = miss(p.x), T = M.rise + M.fall;
          for (let i = 0; i < 8; i++) { x1 = miss(p.x + vx * T); T = Math.max(M.rise, Math.abs(x1 - x0) / M.glide) + M.fall; }
          const g = level.groundTop(x1), y1 = (g !== null ? g : m.gy + 24) - 6;
          world.mortarBombs.push({ level, x0, y0, x1, y1, T, top: M.top, age: 0, seed: Math.floor(Math.random() * 1000), face: Math.sign(x1 - x0) || m.face });
          m.firedAt = level.time;
          Sound.play("mortarFire");
        }
      }
      if (st.k !== m.lastK) m.target = null;
      m.lastK = st.k;
    }
    for (const b of world.mortarBombs) {
      if (b.level !== level || b.done) continue;
      b.age += dt;
      if (b.age >= b.T - M.fall && !b.whistled) { b.whistled = true; Sound.play("mortarFall"); } // (the whistle as it comes down)
      if (b.age < b.T) continue;
      b.done = true; // it lands: boom. Anyone close is caught in it
      for (const q of runners) {
        if (q.dead) continue;
        const nx = Math.max(q.x, Math.min(b.x1, q.x + HITBOX_W)), ny = Math.max(q.y, Math.min(b.y1, q.y + HITBOX_H));
        if (Math.hypot(b.x1 - nx, b.y1 - ny) < M.blast) q.die("BLASTED!");
      }
      const g = level.groundTop(b.x1);
      world.booms.push({ level, x: b.x1, y: b.y1, gy: g !== null ? g : null, t: 0, seed: b.seed });
      world.quakes.push({ level, x: b.x1, t: 0.45 });
      Sound.play("mortarBoom");
    }
    world.mortarBombs = world.mortarBombs.filter((b) => !b.done);
  }

  // The ruins' rune tiles: set one off (stand on it, or for the very cracked kind come near it) and after its own moment
  // it bursts, throwing anyone close away from it: straight up if they're over it, otherwise forward or back. Once each
  function updateRuneTiles(dt) {
    const { level, players } = world, R = RUNE_TILE;
    const runners = players.filter((p) => !p.dead && !p.caught && !p.held && !p.trip);
    for (const rt of level.runeTiles) {
      if (rt.state === "spent") { rt.t += dt; continue; }
      const k = R.kinds[rt.kind], cx = rt.x + TILE / 2;
      if (rt.state === "idle") {
        const on = runners.some((p) => {
          const mid = p.x + HITBOX_W / 2, onIt = p.onGround && Math.abs(p.y + HITBOX_H - rt.gy) < 2;
          if (k.trigger === "near") return Math.abs(mid - cx) < R.near && p.y + HITBOX_H > rt.gy - 30;
          if (k.trigger === "over") return onIt && Math.abs(mid - cx) <= 2; // (your middle over its middle)
          return onIt && p.x + HITBOX_W > rt.x && p.x < rt.x + TILE; // (a foot on it)
        });
        if (on) { rt.state = "armed"; rt.t = 0; Sound.play("runeArm"); }
        continue;
      }
      rt.t += dt;
      if (rt.t < k.delay) continue;
      rt.state = "spent"; rt.t = 0; // it bursts
      for (const q of runners) {
        const dx = q.x + HITBOX_W / 2 - cx, dy = q.y + HITBOX_H / 2 - rt.gy;
        if (Math.hypot(dx, dy) > R.reach) continue;
        q.onGround = false; q.standingOn = null; q.inQuick = false;
        if (Math.abs(dx) <= R.under) { q.vx = 0; q.vy = -R.up; }
        else { q.vx = Math.sign(dx) * R.side; q.vy = -R.lift; }
        q.stun = R.stun;
        q.showHit(Math.abs(dx) <= R.under ? "LAUNCHED!" : dx > 0 ? "BLASTED FORWARD!" : "BLASTED BACK!", "#8fd8ff");
      }
      world.quakes.push({ level, x: cx, t: 0.2 });
      Sound.play("runeBurst");
    }
  }

  // Where a mortar's bomb is in its flight: { x, y, u (0..1), falling (0..1) }. It climbs, slowing to the top of the
  // screen, glides along it if it has far to go (crossing the ground at a steady pace till then), and at the end drops
  // straight down onto its spot like a stone, faster and faster (it's heavy)
  function bombAt(b) {
    const M = MORTAR, H = b.T - M.fall, u = Math.min(1, b.age / b.T), x = b.x0 + (b.x1 - b.x0) * Math.min(1, b.age / H);
    if (b.age < M.rise) { const s = b.age / M.rise; return { x, y: b.y0 + (b.top - b.y0) * (1 - (1 - s) ** 2), u, falling: 0 }; }
    if (b.age < b.T - M.fall) return { x, y: b.top, u, falling: 0 };
    const s = Math.min(1, (b.age - (b.T - M.fall)) / M.fall);
    return { x, y: b.top + (b.y1 - b.top) * s * s, u, falling: s };
  }

  // Inside the ruins: the exit portal, the clock running out, and (in the last seconds) stones falling
  function updateRuins(f, dt) {
    const inside = world.players.filter((p) => p.realm === f && !p.caught && !p.trip);
    for (const p of inside) {
      const left = ruinsLeft(f, p);
      if (left <= 0) { // time's up: the aurora snatches you out as it all comes down
        if (p.dead) { p.dead = false; p.x = p.respawnX; p.y = p.respawnY; }
        p.showHit("TIME'S UP!", "#ff5a4a");
        startTrip(p, "fail", null);
        continue;
      }
      if (freeRunner(p) && f.exitPortal && touchesHole(p, f.exitPortal.x, f.exitPortal.y)) startTrip(p, "out", f.exitPortal);
      // the last seconds: stones dropping near you (a shadow on the ground first)
      if (left <= RUINS.collapse[2] && freeRunner(p)) {
        p.stoneT = (p.stoneT || 0) - dt;
        if (p.stoneT <= 0) {
          p.stoneT = RUINS.stoneEvery * (0.7 + Math.random() * 0.6);
          const x = p.x + HITBOX_W / 2 + (Math.random() * 60 - 12) + p.vx * RUINS.stoneWarn, gy = f.groundTop(x);
          if (gy !== null) f.stones.push({ x, gy, t: 0, w: 7 + Math.floor(Math.random() * 3) });
        }
      }
    }
    for (const st of f.stones) {
      const was = st.t;
      st.t += dt;
      if (was < RUINS.stoneWarn + RUINS.stoneFall && st.t >= RUINS.stoneWarn + RUINS.stoneFall) { // it lands: crumbles to bits
        for (let k = 0; k < 10; k++) world.sawBits.push({ level: f, x: st.x + (Math.random() - 0.5) * st.w, y: st.gy - 3, vx: (Math.random() - 0.5) * 120, vy: -40 - Math.random() * 90, t: 0.4 + Math.random() * 0.3, c: k % 3 ? "#7a8686" : "#4c5656", big: k % 2 === 0 });
        world.quakes.push({ level: f, x: st.x, t: 0.15 });
        Sound.play("stoneLand");
      }
    }
    f.stones = f.stones.filter((st) => st.t < RUINS.stoneWarn + RUINS.stoneFall + 0.1);
  }

  // Going in and out of the ruins: the aurora pulls you into a portal (the screen fading), you're moved across, a
  // portal builds itself out of old bricks where you come out, out you pop, and it falls apart again.
  // kind: "in" (into the ruins), "out" (escaped through its exit portal: the gift), "fail" (time's up: thrown back)
  function startTrip(p, kind, portal) {
    // where the aurora pulls you: into the portal's swirl (the ruins portal floats once it's on), or (time's up) straight up
    const to = kind === "in" ? { x: portal.x, y: portal.gy - RUINS.ringR - 1 - RUINS.floatUp } : kind === "out" ? { x: portal.x, y: portal.y } : { x: p.x + HITBOX_W / 2, y: p.y - 24 };
    p.trip = { kind, t: 0, stage: "pull", fromX: p.x, fromY: p.y, toX: to.x - HITBOX_W / 2, toY: to.y - HITBOX_H / 2, portal };
    p.held = true;
    p.vx = p.vy = 0;
    p.inQuick = false; p.inRiver = null; p.trapped = 0; p.knock = null;
    Sound.play(kind === "fail" ? "timesUp" : "auroraGrab");
  }

  function updateTrips(dt) {
    for (const p of world.players) {
      const tr = p.trip;
      if (!tr) continue;
      if (p.caught) { p.trip = null; continue; }
      tr.t += dt;
      if (tr.stage === "pull") { // the aurora wrapping round you and pulling you in
        const u = Math.min(1, tr.t / RUINS.pullTime), e = u * u * (3 - 2 * u);
        p.x = tr.fromX + (tr.toX - tr.fromX) * e;
        p.y = tr.fromY + (tr.toY - tr.fromY) * e;
        if (u < 1) continue;
        // across: into the ruins (its clean gateway where you arrive), or back out onto the main course (an old brick
        // portal builds itself where you land, and stays there afterwards)
        let realm = null, x = p.x;
        if (tr.kind === "in") { realm = tr.portal.realm; x = realm.arriveX; }
        else if (tr.kind === "out") x = tr.portal.x + travelGain(RUINS.pullTime + RUINS.buildTime + RUINS.outTime); // (as far on as you'd have run while the portal took you)
        else x = Math.max(0, p.x - RUINS.failBack);
        moveTo(p, realm, x);
        p.held = true;
        if (tr.kind === "in") { tr.built = realm.arriveGate; p.ruinsBonus = 0; } // (a fresh clock: no extra time carried in)
        else { tr.built = { level: world.level, x: p.x + HITBOX_W / 2, gy: p.y + HITBOX_H, cy: p.y + HITBOX_H - 24, style: "old", state: "rest", t: 0 }; world.builtPortals.push(tr.built); }
        Object.assign(tr.built, { state: "build", t: 0 });
        tr.landX = p.x; tr.landY = p.y;
        tr.stage = "build"; tr.t = 0;
        continue;
      }
      const midY = tr.built.cy - HITBOX_H / 2; // (inside its ring)
      if (tr.stage === "build") { // hidden while the bricks gather into a ring
        p.x = tr.landX; p.y = midY;
        if (tr.t < RUINS.buildTime) continue;
        tr.stage = "pop"; tr.t = 0;
        Object.assign(tr.built, { state: "open", t: 0 });
        Sound.play("portalPop");
        continue;
      }
      if (tr.stage === "pop") { // out you come, dropping to the ground
        const u = Math.min(1, tr.t / RUINS.outTime);
        p.x = tr.landX; p.y = midY + (tr.landY - midY) * u * u;
        if (u < 1) continue;
        p.y = tr.landY;
        p.held = false;
        p.onGround = true;
        Object.assign(tr.built, { state: "close", t: 0 }); // (its vortex closes and its bricks go back to resting: it stays)
        if (tr.kind === "out") { // escaped: the aurora's preservation, for the rest of the race
          p.aurora = { back: 0 };
          p.showHit("AURORA!", "#7af0d8");
          p.sparkle("#7af0d8");
          Sound.play("auroraGift");
        }
        p.trip = null;
      }
    }
  }

  // Brick portals: building (bricks gathering into a ring), open, closing (back to resting), resting. Never removed.
  function updateBuiltPortals(dt) {
    for (const bp of world.builtPortals) {
      bp.t += dt;
      if (bp.state === "close" && bp.t >= RUINS.breakTime) Object.assign(bp, { state: "rest", t: 0 });
    }
  }

  // How dark someone's screen is (0..1) while the aurora takes them across
  function tripDark(p) {
    const tr = p.trip;
    if (!tr) return 0;
    if (tr.stage === "pull") return Math.max(0, (tr.t - RUINS.pullTime * 0.55) / (RUINS.pullTime * 0.45));
    if (tr.stage === "build") return Math.max(0, 1 - tr.t / 0.35);
    return 0;
  }

  // ---- The enchanted forest's gift: magic feet ----

  // Anyone with magic feet gets a glowing bridge over every pit and river (a run of columns with no ground)
  // as they come near it, level with the bank on their side. (Quicksand, sinkholes and broken thin ice make
  // their own, right under you, when they go off: Player.magicCatch.) A bridge stays a while after they've
  // left it, for whoever's behind them, then flickers and fades away, but never from under someone's feet.
  function updateBridges(dt) {
    const { level, players } = world, M = MAGIC_FEET;
    const magic = players.filter((p) => p.magicFeet && !p.dead && !p.caught && !p.held);
    for (const p of magic) {
      for (let c = Math.max(0, Math.floor((p.x - M.near) / TILE)); c <= Math.floor((p.x + HITBOX_W + M.near) / TILE); c++) {
        const hole = level.holeAt(c);
        if (!hole) continue;
        const [c0, c1] = hole;
        const left = level.groundTop((c0 - 1) * TILE), right = level.groundTop(c1 * TILE);
        const fromLeft = p.x + HITBOX_W / 2 < (c0 + c1) * TILE / 2;
        const br = level.addBridge(c0 * TILE, c1 * TILE, (fromLeft ? left ?? right : right ?? left) ?? p.y + HITBOX_H);
        if (!br.chimed) { br.chimed = true; Sound.play("magicBridge"); }
        c = c1;
      }
    }
    for (const br of level.platforms) {
      if (br.kind !== "bridge") continue;
      br.t += dt;
      if (magic.some((p) => p.x + HITBOX_W > br.x - M.near && p.x < br.x + br.w + 16)) br.idle = 0;
      else if (players.some((p) => p.standingOn === br && !p.dead && !p.caught)) br.idle = Math.min(br.idle + dt, M.stay); // (someone's on it: it waits for them)
      else br.idle += dt;
    }
    level.platforms = level.platforms.filter((br) => br.kind !== "bridge" || br.idle < M.stay + M.fade);
  }

  // ---- The enchanted forest's roots (a power you come out of the forest with) ----

  // S / Down: roots burst out of the ground round the other player, wherever they are, and grab them.
  // Not if there's nobody to grab right now (dead, in a forest, already held...): then you keep it.
  function rootGrab(p, owner) {
    const v = rivalOf(p);
    if (!v || v.dead || v.caught || v.held || v.dream || v.realm || v.eatenBy || v.flood || world.monsoon) {
      if (v && !world.solo) p.showHit("OUT OF REACH!", "#a898b8");
      return false;
    }
    const level = world.level;
    // pulled down onto the ground under them (or held where they stand, on a platform or over a hole)
    const ground = level.groundTop(v.x + HITBOX_W / 2);
    let gy = v.onGround ? v.y + HITBOX_H : ground !== null && ground >= v.y + HITBOX_H ? ground : null;
    if (gy !== null) v.y = gy - HITBOX_H;
    else gy = VIEW_H + 6; // (over a hole: the roots come up from below)
    Object.assign(v, { held: true, vx: 0, vy: 0, spin: 0, standingOn: null, onGround: false, inQuick: false, inRiver: null, inSink: null, trapped: 0, hiddenIn: null, dashHold: 0, dashTime: 0, windTime: 0 });
    v.showHit("ROOTED!", "#a898b8");
    v.flash = 0.4;
    world.roots.push({ owner, victim: v, state: "grab", t: 0, end: ROOTS.hold, gy, x: v.x, y: v.y, stab: 0, jolt: 0 });
    Sound.play("rootGrab");
    return true;
  }

  // Held and stabbed (mash jump to tear free sooner), then flung back onto safe ground, and impaled on a last
  // root just before landing
  function updateRoots(dt, inputs) {
    const level = world.level;
    for (const r of world.roots) {
      const v = r.victim, i = world.players.indexOf(v);
      r.t += dt;
      if (r.jolt > 0) r.jolt -= dt;
      if (r.state !== "done" && (v.caught || (v.dead && r.state !== "impale"))) { r.state = "done"; r.t = 0; v.held = false; continue; } // (the fire got them first)
      if (r.state === "grab") {
        Object.assign(v, { x: r.x, y: r.y, vx: 0, vy: 0, held: true });
        if (inputs[i] && inputs[i].jumpPressed && r.t > ROOTS.rise) { // struggling: each press tears at the roots
          r.end = Math.max(ROOTS.minHold, r.end - ROOTS.tear);
          r.jolt = 0.12;
          Sound.play("rootCreak");
        }
        const stab = Math.floor(Math.max(0, r.t - ROOTS.rise) / ROOTS.stabEvery);
        if (stab > r.stab) {
          r.stab = stab;
          v.flash = 0.15;
          v.sparkle("#e2a6ff");
          Sound.play("rootStab");
        }
        if (r.t >= r.end) {
          // flung back: about 3 tiles, or as far as it takes to reach safe ground
          const spot = level.safeSpotBefore(v.x - ROOTS.throwBack, 600) || level.safeSpotBefore(v.x - ROOTS.throwBack, 4000) || level.safeSpotAfter(v.x) || { x: v.x, y: r.gy - HITBOX_H };
          // (a longer throw, when the nearest safe ground is further back, takes a little longer)
          const time = Math.max(ROOTS.throwTime, Math.abs(v.x - spot.x) / 300);
          Object.assign(r, { state: "throw", t: 0, time, from: { x: v.x, y: v.y }, to: spot, spike: { x: spot.x + HITBOX_W / 2, gy: spot.y + HITBOX_H } });
          Sound.play("rootFling");
        }
      } else if (r.state === "throw") {
        const u = Math.min(1, r.t / r.time);
        v.x = r.from.x + (r.to.x - r.from.x) * Math.min(1, u / ROOTS.impaleAt); // (right over the spot by the time the last root comes up)
        v.y = r.from.y + (r.to.y - r.from.y) * u - ROOTS.throwArc * 4 * u * (1 - u);
        v.spin = -u * Math.PI * 1.5;
        if (u >= ROOTS.impaleAt) { r.state = "impale"; r.t = 0; r.hitY = v.y; Sound.play("rootImpale"); }
      } else if (r.state === "impale") {
        if (r.t >= ROOTS.impaleRise && !v.dead) {
          v.held = false;
          v.spin = 0;
          v.showHit("IMPALED!", "#a898b8");
          v.die();
          r.state = "done";
          r.t = 0;
        }
      }
    }
    world.roots = world.roots.filter((r) => !(r.state === "done" && r.t > ROOTS.linger + 0.3));
  }

  // Alone: once the fire gets close, the roots go off by themselves and hold it back for a while
  function updateRootWall(dt) {
    if (!world.solo) return;
    const p = world.players[0];
    if (!world.rootWall && p.rootGuard && !p.caught && !p.dream && p.trackX - world.fire.x < ROOTS.fireNear) {
      p.rootGuard = false;
      world.rootWall = { t: 0, x: world.fire.x };
      p.showHit("ROOTS!", "#a898b8");
      Sound.play("rootGrab");
    }
    if (world.rootWall && (world.rootWall.t += dt) > ROOTS.wallTime + 0.6) world.rootWall = null;
  }

  // ---- The enchanted forest's alive trees ----

  // An alive tree strikes at the nearest runner who comes close: the ground cracks where they'll be, then a root
  // shoots up there (or, its first time, root fingers that grab them and pull them under: they wake up on the
  // main course). Then it pulls its root back in and rests a moment before it can strike again.
  // How close a runner has to come for a tree to strike: just close enough that running straight in at full
  // speed, they reach its trunk as the root comes up (stop short, or back off, and it misses)
  function treeSense(grab) {
    const A = ALIVE_TREE;
    return PHYSICS.runSpeed * (grab ? A.grabWindup : A.windup) + (grab ? A.grabReach : A.reach) + HITBOX_W / 2 - 4;
  }

  function updateAliveTrees(dt) {
    const { level, players } = world, A = ALIVE_TREE;
    const free = (p) => !p.dead && !p.caught && !p.held && !p.dream;
    for (const tr of level.trees) {
      tr.t += dt;
      if (tr.state === "idle") {
        if (tr.close !== undefined) tr.close += dt; // (the hole it struck from closing up: drawn by drawTreeStrikes)
        if (tr.cool > 0) { tr.cool -= dt; continue; }
        const grab = !tr.used;
        if (!players.some((p) => free(p) && Math.abs(p.x + HITBOX_W / 2 - tr.x) < treeSense(grab) && p.y + HITBOX_H > tr.gy - 60)) continue;
        Object.assign(tr, { state: "crack", t: 0, sx: tr.x, sgy: tr.gy, grab, w: grab ? A.grabWindup : A.windup, victim: null, caughtAt: null }); // (always right at its trunk)
        Sound.play("treeCrack");
      } else if (tr.state === "crack") {
        if (tr.t >= tr.w) { tr.state = "strike"; tr.t = 0; tr.used = true; Sound.play(tr.grab ? "treeGrab" : "treeStrike"); }
      } else if (tr.state === "strike") {
        const reach = tr.grab ? A.grabReach : A.reach, up = Math.min(1, tr.t / A.rise) * A.tall;
        if (!tr.victim && tr.caughtAt === null && tr.t < A.rise + A.hold) {
          const v = players.find((p) => free(p) && p.x + HITBOX_W > tr.sx - reach && p.x < tr.sx + reach && p.y + HITBOX_H > tr.sgy - up && p.y < tr.sgy);
          if (v && tr.grab) { // caught: flung up, coiled round, then yanked down into the dirt
            tr.victim = v;
            tr.caughtAt = tr.t;
            Object.assign(v, { held: true, vx: 0, vy: 0, x: tr.sx - HITBOX_W / 2, onGround: false, standingOn: null });
            v.showHit("GRABBED!", "#c080ff");
          } else if (v) { v.showHit("SKEWERED!", "#c080ff"); v.die(); }
        }
        const v = tr.victim;
        if (v && !v.dream) {
          const u = tr.t - tr.caughtAt, top = tr.sgy - HITBOX_H - A.fling, ground = tr.sgy - HITBOX_H;
          if (u < A.flingTime) { const k = u / A.flingTime; v.y = ground + (top - ground) * (1 - (1 - k) * (1 - k)); }  // flung up
          else if (u < A.flingTime + A.wrapTime) v.y = top + Math.sin(u * 60) * 0.8;                                         // coiled, struggling
          else if (u < A.flingTime + A.wrapTime + A.yankTime) {                                                               // yanked down, hard
            const k = (u - A.flingTime - A.wrapTime) / A.yankTime;
            v.y = top + (tr.sgy + 4 - top) * k * k;
            if (!tr.yanked) { tr.yanked = true; Sound.play("treeStrike"); }
          } else { v.y = tr.sgy + 4; v.dream = { kind: "woken", t: 0 }; tr.victim = null; tr.yanked = false; Sound.play("lobBonk"); } // under: and you wake up
        }
        const grabTime = tr.caughtAt !== null ? tr.caughtAt + A.flingTime + A.wrapTime + A.yankTime : 0;
        if (!tr.victim && tr.t >= Math.max(A.rise + A.hold, grabTime) + A.sink) { tr.state = "idle"; tr.cool = A.rest; tr.close = 0; }
      }
    }
  }

  // ---- Leave, the enchanted forest's walking tree ----

  // Can this runner see Leave? (Is it on their screen: it runs from 35% of its width behind them)
  function seesLeave(p, L) {
    const left = p.trackX - VIEW_W * 0.35;
    return L.x > left - 10 && L.x < left + VIEW_W + 10;
  }

  // Leave wakes once someone is past it, then follows them through its forest: hurrying to keep up at the left edge of
  // the screen of whoever is furthest behind, creeping at you otherwise. Every few seconds it stands still and attacks
  // (its roots, its leaves or its seeds), and touching it gets you grabbed, thrown forward and spiked.
  function updateLeaves(dt) {
    const { level, players } = world, E = LEAVE;
    const here = players.filter((p) => !p.caught); // (everyone on this course)
    for (const L of level.leaveTrees) {
      // standing on the ground under it (it steps up and down with it; over a hole it keeps to the last ground it had)
      const g = level.groundTop(L.x + 2);
      if (L.gy === null) { if (g === null) continue; L.gy = g; }
      else if (g !== null) L.gy += Math.sign(g - L.gy) * Math.min(Math.abs(g - L.gy), 120 * dt);
      // Who's past it: only they can be grabbed (anyone behind it, say just arrived, goes through it unharmed until they're past)
      for (const p of here) {
        if (p.x > L.x + E.body[1]) L.front.add(p);
        else if (p.x + HITBOX_W < L.x + E.body[0]) L.front.delete(p);
      }
      updateLeaveSpikes(L, dt);
      if (!L.awake) {
        if (!here.some((p) => freeRunner(p) && L.front.has(p) && p.x < L.x1)) continue;
        Object.assign(L, { awake: true, next: E.firstAttack, wakeT: 0 });
        Sound.play("leaveWake");
      }
      L.wakeT += dt;
      // touching it: a root grabs you
      if (!L.grab) {
        const v = here.find((p) => freeRunner(p) && L.front.has(p) && overlaps(p.x, p.y, HITBOX_W, HITBOX_H, L.x + E.body[0], L.gy - E.bodyUp, E.body[1] - E.body[0], E.bodyUp));
        if (v) leaveGrab(L, v);
      }
      if (L.grab) updateLeaveGrab(L, dt);
      L.moving = false;
      if (L.state !== "idle") { updateLeaveAttack(L, dt); if (!L.grab) moveLeave(L, here, dt, false); continue; } // (attacking, it keeps creeping, but never hurries)
      L.next -= dt;
      const targets = here.filter((p) => freeRunner(p) && L.front.has(p) && p.x < L.x1 && seesLeave(p, L));
      if (L.grab || L.pause > 0) { L.pause -= dt; continue; }
      if (L.next <= 0 && targets.length) startLeaveAttack(L, targets);
      else moveLeave(L, here, dt);
    }
    updateLeafShots(dt);
    updateLeaveSeeds(dt);
  }

  // Walking: hurrying to the left edge of the screen of whoever is furthest behind, or creeping at you (only forward,
  // and never out of its forest; it waits while anyone is still behind it). While it attacks it only creeps.
  function moveLeave(L, here, dt, canHurry = true) {
    const E = LEAVE;
    if (!here.length || here.some((p) => !L.front.has(p))) return;
    const edge = Math.min(...here.map((p) => p.trackX)) - VIEW_W * 0.35 + E.edge;
    const hurry = canHurry && L.x < edge - 0.5;
    let to = hurry ? Math.min(edge, L.x + E.catchUp * dt) : here.some((p) => !p.dead && !p.held && !p.dream) ? L.x + E.creep * dt : L.x;
    to = Math.min(to, L.x1 - E.endRoom);
    if (to <= L.x) return;
    const steps = Math.floor(L.walk * 5);
    L.walk += (dt / E.stride) * (hurry ? 1.8 : 1); // (its steps: longer and quicker when it hurries)
    L.x = to;
    L.moving = true;
    if (Math.floor(L.walk * 5) > steps) Sound.play("leaveStep"); // (a root slamming down)
  }

  // Its attacks, picked at random (never the same twice in a row; the leaves only once they've grown back)
  function startLeaveAttack(L, targets) {
    const E = LEAVE, kinds = ["roots", "seeds"];
    if (world.time >= L.leafAt) kinds.push("leaves");
    const pool = kinds.length > 1 ? kinds.filter((k) => k !== L.last) : kinds, kind = pool[Math.floor(Math.random() * pool.length)];
    Object.assign(L, { state: kind, t: 0, last: kind, next: E.every[0] + Math.random() * (E.every[1] - E.every[0]) });
    if (kind === "roots") { // one root, or two if every runner here can see it: one each (the nearer one gets the nearer root)
      const near = targets.slice().sort((p, q) => p.x - q.x).slice(0, 2);
      L.roots = near.length === 2 ? [{ p: near[0], foot: 6, d: 14 }, { p: near[1], foot: 14, d: 24 }] : [{ p: near[0], foot: 14, d: 24 }];
      Sound.play("leaveRoots");
    } else if (kind === "leaves") {
      L.leafAt = world.time + E.volleys[2] + E.regrow;
      L.lows = E.volleys.map(() => Math.random() < 0.5); // (each burst: low or high)
      Sound.play("leafGrow");
    } else {
      L.seedsLeft = E.seeds[0] + Math.floor(Math.random() * (E.seeds[1] - E.seeds[0] + 1));
      L.seedSpots = null;
      // (half the time, if this course has none alive, one of the seeds grows a Spore Lobber)
      const darkAlive = world.level.lobbers.some((lb) => lb.dark) || world.level.leaveSeeds.some((s) => s.kind === "dark");
      L.darkSeed = !darkAlive && Math.random() < LOBBER.dark.chance ? Math.floor(Math.random() * L.seedsLeft) : -1;
      Sound.play("seedShake");
    }
  }

  function updateLeaveAttack(L, dt) {
    const E = LEAVE, level = world.level, t0 = L.t;
    L.t += dt;
    const passed = (at) => t0 < at && L.t >= at;
    if (L.state === "roots") {
      const slam = E.rootRise + E.rootHold + E.rootSlam;
      if (passed(slam)) { // they slam down into the ground, and a glow races off underground to where each runner will be
        Sound.play("leaveSlam");
        for (const r of L.roots) {
          r.ex = L.x + 2 + r.foot * 0.15 + r.d; // (where it went in)
          const p = r.p;
          if (!freeRunner(p) || p.caught) continue;
          const mid = p.x + HITBOX_W / 2;
          let x = mid + Math.max(0, p.vx) * E.aim, gy = level.groundTop(x); // (where you'll be: never behind you)
          if (gy === null) { x = mid; gy = level.groundTop(x); } // (that's over a hole: right at you instead)
          if (gy !== null) L.spikes.push({ x, gy, t: -E.glow, from: r.ex });
        }
      }
      if (L.t >= slam + E.glow + E.crack + E.spikeRise + E.spikeHold + E.spikeSink + E.rootsOut) endLeaveAttack(L);
    } else if (L.state === "leaves") {
      E.volleys.forEach((at, v) => { if (passed(at)) leafVolley(L, v); });
      if (L.t >= E.volleys[2] + E.spread + 0.1) endLeaveAttack(L);
    } else if (L.state === "seeds") {
      const n = L.seedsLeft;
      for (let i = 0; i < n; i++) if (passed(E.shake * 0.8 + i * E.seedEvery)) throwSeed(L, i, n);
      if (L.t >= E.shake * 0.8 + n * E.seedEvery + 0.1) endLeaveAttack(L);
    }
  }

  function endLeaveAttack(L) {
    L.state = "idle";
    L.t = 0;
    L.next = Math.max(L.next, LEAVE.rest); // (it walks a while before the next one)
  }

  // A burst of leaves: a third of its canopy torn off, swooping down into a bunch in front of it, low or high
  function leafVolley(L, v) {
    const E = LEAVE, level = world.level, low = L.lows[v], [o0, o1] = low ? E.low : E.high;
    const gx = L.x + E.ahead;
    for (let k = v; k < E.perVolley * 3; k += 3) {
      const at = level.leaveLeaf(L, k);
      level.leafShots.push({ x: at.x, y: at.y, sx: at.x, sy: at.y, k, gx: gx + (Math.random() * 2 - 1) * E.jitter, ground: L.gy, off: o0 + Math.random() * (o1 - o0), vx: E.leafSpeed[0] + Math.random() * (E.leafSpeed[1] - E.leafSpeed[0]), delay: Math.random() * E.spread, t: 0, dist: 0 });
    }
    Sound.play("leafVolley");
  }

  function updateLeafShots(dt) {
    const { level, players } = world, E = LEAVE;
    for (const s of level.leafShots) {
      s.t += dt;
      const u = s.t - s.delay;
      if (u < 0) continue; // (still on its branch)
      if (u < E.gather) { // swooping down into the bunch
        const k = u / E.gather, e = 1 - (1 - k) * (1 - k), g = level.groundTop(s.gx);
        if (g !== null) s.ground = g;
        s.x = s.sx + (s.gx - s.sx) * e;
        s.y = s.sy + (s.ground - s.off - s.sy) * e;
      } else { // ...then flying at you, skimming the ground (over a hole, the ground it last had)
        const step = s.vx * dt, g = level.groundTop(s.x + 1);
        if (s.dist === 0) { s.x = s.gx; s.y = s.ground - s.off; }
        s.x += step;
        s.dist += step;
        if (g !== null) s.ground = g;
        const want = s.ground - s.off;
        s.y += Math.sign(want - s.y) * Math.min(Math.abs(want - s.y), 400 * dt);
      }
      const hit = players.find((p) => freeRunner(p) && overlaps(p.x, p.y, HITBOX_W, HITBOX_H, s.x, s.y, 3, 2));
      if (hit) { hit.showHit("SHREDDED!", "#c080ff"); hit.die(); s.gone = true; }
      if (s.dist > E.leafRange) s.gone = true;
    }
    level.leafShots = level.leafShots.filter((s) => !s.gone);
  }

  // A seed, flung up out of its branches in a high arc to land round whoever's in the lead (on flat, firm ground, clear of
  // other mushrooms and dangers); it lies glowing a second, then sprouts: a Lobber, or a spore mushroom
  function throwSeed(L, i, n) {
    const E = LEAVE, level = world.level;
    if (!L.seedSpots) {
      const lead = world.players.filter((p) => freeRunner(p) && !p.caught).sort((p, q) => q.x - p.x)[0];
      L.seedSpots = [];
      if (lead) {
        const base = lead.x + HITBOX_W / 2 + Math.max(0, lead.vx) * (E.seedFlight + ((n - 1) / 2) * E.seedEvery); // (where they'll be as the seeds land)
        for (let j = 0; j < n; j++) {
          const want = base + E.seedSpots[0] + ((E.seedSpots[1] - E.seedSpots[0]) * (j + 0.5)) / n + (Math.random() * 2 - 1) * 6;
          const spot = seedSpot(level, want, L.seedSpots.filter(Boolean).map((sp) => sp.x));
          L.seedSpots.push(spot);
        }
      }
    }
    const spot = L.seedSpots[i];
    if (!spot) return; // (nowhere for it to grow there)
    const x0 = L.x + 2 + (i - (n - 1) / 2) * 5, y0 = L.gy - 60;
    level.leaveSeeds.push({ x: x0, y: y0, x0, y0, tx: spot.x, gy: spot.gy, kind: i === L.darkSeed ? "dark" : pickWeighted(E.kinds), t: 0 });
  }

  // Somewhere near x a seed can grow: flat, firm ground (no hole, spikes or quicksand), clear of other mushrooms and of
  // anything dangerous (null: nowhere)
  function seedSpot(level, x, taken) {
    for (const d of [0, 6, -6, 12, -12, 18, -18, 24, -24]) {
      const sx = Math.round(x + d), g = level.groundTop(sx);
      if (g === null || level.groundTop(sx - 8) !== g || level.groundTop(sx + 8) !== g) continue;
      const c = Math.floor(sx / TILE), row = g / TILE;
      if ([c - 1, c, c + 1].some((cc) => level.isQuick(cc) || level.tile(cc, row - 1) !== T_EMPTY)) continue;
      const near = (ox, w) => Math.abs(ox - sx) < w, gap = LEAVE.seedGap;
      if (taken.some((tx) => near(tx, gap)) || level.lobbers.some((lb) => near(lb.x, gap)) || level.sporeShrooms.some((m) => near(m.x, SPORES.capW / 2 + gap))
        || level.trees.some((tr) => near(tr.x, 24)) || level.sleepShrooms.some((m) => near(m.x, 40)) || level.bouncies.some((m) => near(m.x0, 30))) continue;
      if (level.threatened(sx - HITBOX_W / 2, g - HITBOX_H, true)) continue; // (not right by a saw, a mace, a shooter...)
      return { x: sx, gy: g };
    }
    return null;
  }

  function updateLeaveSeeds(dt) {
    const level = world.level, E = LEAVE;
    for (const s of level.leaveSeeds) {
      const was = s.t;
      s.t += dt;
      if (s.t < E.seedFlight) { // up and over in a high arc
        const k = s.t / E.seedFlight, high = Math.max(55, Math.abs(s.tx - s.x0) * 0.22);
        s.x = s.x0 + (s.tx - s.x0) * k;
        s.y = s.y0 + (s.gy - 2 - s.y0) * k - Math.sin(k * Math.PI) * high;
        continue;
      }
      s.x = s.tx;
      s.y = s.gy - 2;
      if (was < E.seedFlight) Sound.play("seedLand");
      if (s.t < E.seedFlight + E.sprout) continue;
      // it sprouts (and stays for good)
      s.gone = true;
      if (s.kind === "lobber" || s.kind === "dark") level.lobbers.push({ id: level.nextId++, x: s.tx, gy: s.gy, dir: -1, t: 0, squash: 9, seed: Math.random(), born: world.time, dark: s.kind === "dark", shots: 0 });
      else level.sporeShrooms.push({ id: level.nextId++, x: s.tx, gy: s.gy, kind: s.kind, seed: Math.random(), lean: Math.random() < 0.5 ? -1 : 1, born: world.time });
      for (let i = 0; i < 8; i++) world.sawBits.push({ x: s.tx, y: s.gy - 1, vx: (Math.random() - 0.5) * 70, vy: -30 - Math.random() * 60, t: 0.45, c: i % 2 ? "#5a3a7e" : "#a24cf0", level });
      Sound.play("sprout");
    }
    level.leaveSeeds = level.leaveSeeds.filter((s) => !s.gone);
  }

  // Where its roots strike: a glow racing there underground, the ground cracking and glowing, then the spike
  function updateLeaveSpikes(L, dt) {
    const E = LEAVE;
    for (const sp of L.spikes) {
      const was = sp.t;
      sp.t += dt;
      if (was < 0 && sp.t >= 0) Sound.play("treeCrack");
      const st = sp.t - E.crack; // (since it burst up)
      if (st < 0 || st >= E.spikeRise + E.spikeHold) continue;
      if (!sp.burst) { sp.burst = true; Sound.play("treeStrike"); }
      const up = Math.min(1, st / E.spikeRise) * E.spikeTall;
      for (const p of world.players) if (freeRunner(p) && overlaps(p.x, p.y, HITBOX_W, HITBOX_H, sp.x - E.spikeReach, sp.gy - up, E.spikeReach * 2, up)) { p.showHit("SPIKED!", "#c080ff"); p.die(); }
    }
    L.spikes = L.spikes.filter((sp) => sp.t < E.crack + E.spikeRise + E.spikeHold + E.spikeSink + 0.4);
  }

  // Touch it: a root wraps round you and lifts you, throws you forward onto safe ground, and a spike bursts up as you land
  function leaveGrab(L, v) {
    L.grab = { v, t: 0, x: v.x, y: v.y };
    Object.assign(v, { held: true, vx: 0, vy: 0, standingOn: null, onGround: false, inQuick: false, inRiver: null, trapped: 0, dashHold: 0, dashTime: 0, windTime: 0 });
    v.showHit("GRABBED!", "#c080ff");
    Sound.play("treeGrab");
  }

  function updateLeaveGrab(L, dt) {
    const E = LEAVE, gr = L.grab, v = gr.v, level = world.level;
    gr.t += dt;
    if (v.caught || v.dead) { v.held = false; v.spin = 0; L.grab = null; return; } // (the fire got them first)
    if (gr.t < E.grabLift) { // lifted up off the ground
      const k = gr.t / E.grabLift;
      v.x = gr.x;
      v.y = gr.y - 14 * (1 - (1 - k) * (1 - k));
      return;
    }
    if (!gr.to) { // ...and thrown: about 10 tiles on, or as far as the next safe ground
      const want = gr.x + E.throwDist, g = level.groundTop(want + HITBOX_W / 2);
      gr.to = g !== null && !level.threatened(want, g - HITBOX_H) ? { x: want, y: g - HITBOX_H } : level.safeSpotAfter(want, 600) || { x: want, y: (g ?? L.gy) - HITBOX_H };
      gr.from = { x: v.x, y: v.y };
      Sound.play("rootFling");
    }
    const u = Math.min(1, (gr.t - E.grabLift) / E.throwTime);
    v.x = gr.from.x + (gr.to.x - gr.from.x) * u;
    v.y = gr.from.y + (gr.to.y - gr.from.y) * u - E.throwArc * 4 * u * (1 - u);
    v.spin = -u * Math.PI * 1.5;
    if (u < 1) return;
    // landing: right onto a spike
    L.spikes.push({ x: gr.to.x + HITBOX_W / 2, gy: gr.to.y + HITBOX_H, t: E.crack, burst: true, grab: true });
    Sound.play("rootImpale");
    Object.assign(v, { held: false, spin: 0, onGround: true });
    v.showHit("SPIKED!", "#c080ff");
    v.die();
    L.grab = null;
    L.pause = E.rest;
  }

  // ---- The enchanted forest's Mushroom Lobbers ----

  const LOB_LOOK = { red: ["SPLAT!", "#ff5a6a"], green: ["POISONED!", "#7aff6a"], pink: ["FLOATING AWAY!", "#ff7ae0"], blue: ["WOKEN UP!", "#7ab8ff"] };

  // Each Lobber leans toward the nearest runner in range and, once a second, squashes down and lobs a little
  // mushroom up and over at them (where they are, where they'll be, or just behind them). The lobs fly in an
  // arc and hit whoever they touch on the way, or pop on the ground.
  function updateLobbers(dt) {
    const { level, players } = world, L = LOBBER;
    const free = (p) => !p.dead && !p.caught && !p.held && !p.dream;
    for (const lb of level.lobbers) {
      lb.squash += dt;
      if (lb.born !== undefined && world.time < lb.born + LEAVE.growUp) continue; // (one of Leave's, still growing)
      if (lb.withering !== undefined) { // (a Spore Lobber, done: it swells and bursts)
        const was = lb.withering;
        if (was < L.dark.wither * 0.3 && (lb.withering += dt) >= L.dark.wither * 0.3) Sound.play("shroomPop");
        else if (was >= L.dark.wither * 0.3) lb.withering += dt;
        if (lb.withering >= L.dark.wither) lb.gone = true;
        continue;
      }
      const target = players.filter((p) => free(p) && Math.abs(p.x + HITBOX_W / 2 - lb.x) < L.range)
        .sort((p, q) => Math.abs(p.x - lb.x) - Math.abs(q.x - lb.x))[0];
      if (!target) { lb.t = 0; continue; }
      const mid = target.x + HITBOX_W / 2;
      lb.dir = mid < lb.x ? -1 : 1;
      if ((lb.t += dt) < (lb.dark ? L.dark.every : L.every)) continue;
      lb.t = 0;
      lb.squash = 0;
      if (lb.dark && ++lb.shots >= L.dark.shots) { lb.withering = -L.dark.squash; Sound.play("shroomCreak"); } // (its last one: squashed for it, then withering)
      // out of the pore on its upper front, squashed down: a lob that lands on the spot it picked
      const sx = lb.x + lb.dir * 6, sy = lb.gy - 12;
      const T = Math.min(L.flight[1], Math.max(L.flight[0], Math.abs(mid - sx) / L.speed));
      const aim = pickWeighted(L.aims), moving = Math.sign(target.vx) || target.facing;
      const tx = aim === "ahead" ? mid + target.vx * T : aim === "behind" ? mid - moving * L.behind : mid;
      const ty = (level.groundTop(tx) ?? target.y + HITBOX_H) - 2;
      level.lobShots.push({ x: sx, y: sy, vx: (tx - sx) / T, vy: (ty - sy) / T - 0.5 * L.gravity * T, kind: pickWeighted(lb.dark ? L.dark.kinds : L.kinds) });
      Sound.play("lobSpit");
    }
    level.lobbers = level.lobbers.filter((lb) => !lb.gone);
    for (const s of level.lobShots) {
      s.vy += L.gravity * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      const hit = players.find((p) => free(p) && overlaps(p.x, p.y, HITBOX_W, HITBOX_H, s.x - L.hit, s.y - L.hit, L.hit * 2, L.hit * 2));
      if (hit) { lobHit(hit, s.kind); s.gone = true; continue; }
      const g = level.groundTop(s.x);
      if ((g !== null && s.y >= g - 1) || s.y > VIEW_H + 8 || level.isSolid(Math.floor(s.x / TILE), Math.floor(s.y / TILE))) {
        s.gone = true; // plop: it bursts on the ground, harmless
        Sound.play("lobPlop");
        for (let i = 0; i < 6; i++) world.sawBits.push({ x: s.x, y: Math.min(s.y, (g ?? s.y) - 1), vx: (Math.random() - 0.5) * 60, vy: -30 - Math.random() * 50, t: 0.4, c: LOB_LOOK[s.kind][1], level });
      }
    }
    level.lobShots = level.lobShots.filter((s) => !s.gone);
  }

  // A lobbed mushroom lands on someone: red kills, green poisons (and kills when it's done), pink floats you away
  // up off the top of the screen, blue wakes you up (back on the main course, with no gifts)
  function lobHit(p, kind) {
    p.showHit(...LOB_LOOK[kind]);
    p.sparkle(LOB_LOOK[kind][1]);
    if (kind === "red") return p.die();
    if (kind === "green") { // (another green one doesn't start the countdown over)
      if (!p.poisonLethal) { p.poison = LOBBER.poison; p.poisonMax = LOBBER.poison; p.poisonLethal = true; }
      Sound.play("poisoned");
      return;
    }
    if (kind === "pink") { p.floatAway = 0.001; Sound.play("spore"); return; }
    p.dream = { kind: "woken", t: 0 }; // blue: the screen goes dark and you wake up on the main course
    p.held = true;
    p.vx = p.vy = 0;
    Sound.play("lobBonk");
  }

  // ---- The enchanted forest's spore mushrooms ----

  const SPORE_LOOK = { red: ["FAST!", "#ff6a7a"], blue: ["SUPER JUMP!", "#6ab8ff"], green: ["POISONED!", "#9aff6a"], pink: ["FLOATING!", "#ff9af0"] };

  // A spore drifting down from a spore mushroom that lands on you gives you its effect (catching more of the same
  // color just starts its time over; different colors stack)
  function updateSpores() {
    const { level } = world;
    for (const p of world.players) {
      if (p.dead || p.caught || p.held) continue;
      for (const m of level.sporeShrooms) {
        if (Math.abs(m.x - (p.x + HITBOX_W / 2)) > SPORES.capW + SPORES.lean) continue;
        if (!level.sporesOf(m, world.time).some((sp) => overlaps(p.x - 1, p.y - 2, HITBOX_W + 2, 6, sp.x - 1, sp.y - 1, 2, 2))) continue; // (one has to land on your head)
        giveSpore(p, m.kind);
      }
    }
  }

  // A spore mushroom's effect on someone (catching more of the same color just starts its time over; different colors stack)
  function giveSpore(p, kind, always) {
    const fresh = kind === "green" ? p.poison <= 0 : !(p.spores[kind] > 0);
    if (kind === "green") { p.poison = SPORES.time; p.poisonMax = SPORES.time; }
    else p.spores[kind] = kind === "pink" ? SPORES.floatTime : SPORES.time;
    if (fresh || always) {
      p.showHit(...SPORE_LOOK[kind]);
      p.sparkle(SPORE_LOOK[kind][1]);
      Sound.play(kind === "green" ? "poisoned" : "spore");
    }
  }

  // The ruins' blackout: the lights flicker off, pitch black for a few seconds, then they flicker back on
  function updateBlackout(dt) {
    const bo = world.blackout;
    if (!bo) return;
    bo.t += dt;
    if (!bo.back && bo.t >= BLACKOUT.time - BLACKOUT.flicker) { bo.back = true; Sound.play("powerUp"); }
    if (bo.t >= BLACKOUT.time) world.blackout = null;
  }
  // How dark a course is right now: 0 (lit) or 1 (black), flickering at the start and the end
  function blackoutDark(level, time) {
    const bo = world.blackout;
    if (!bo || bo.level !== level) return 0;
    const F = BLACKOUT.flicker, u = bo.t < F ? bo.t / F : bo.t > BLACKOUT.time - F ? (BLACKOUT.time - bo.t) / F : 1;
    return u >= 1 || hash(Math.floor(time * 20), 77) < u ? 1 : 0;
  }

  // The ruins' laser gun: an aim line along your line for a moment, then a teal laser (like the ruins' own) straight out the way you're
  // facing, through everything, forever, at chest height: anyone on that course it touches is vaporized. Alone it's
  // for the fire: fired backwards it pushes the fire back a little (facing right, nothing happens: keep it)
  function fireLaser(p, owner) {
    if (world.solo && p.facing > 0) return false;
    world.laserShots.push({ level: world.level, p, owner, x: p.x + HITBOX_W / 2 + p.facing * 4, y: Math.round(p.y + LASER_GUN.chest), dir: p.facing, t: 0 });
    Sound.play("laserCharge");
    return true;
  }
  function updateLaserShots(dt) {
    const G = LASER_GUN;
    for (const s of world.laserShots) {
      const was = s.t;
      s.t += dt;
      if (was < G.charge && s.t >= G.charge) { // it fires
        Sound.play("laserFire");
        if (world.solo && s.dir < 0) { world.fire.x = Math.max(world.fire.x - G.push, -1e9); s.p.showHit("FIRE PUSHED BACK!", "#7af0d8"); }
      }
      if (s.t >= G.charge && s.t < G.charge + G.deadly) for (const q of world.players) { // touch it and you're gone (while it's hot)
        if (q === s.p || q.dead || q.caught || q.held || (q.realm || world.level) !== s.level) continue;
        const ahead = s.dir > 0 ? q.x + HITBOX_W > s.x : q.x < s.x;
        if (ahead && q.y < s.y + G.thick / 2 + 1 && q.y + HITBOX_H > s.y - G.thick / 2) { q.die("VAPORIZED!"); if (q.dead) q.sparkle("#7af0d8"); }
      }
    }
    world.laserShots = world.laserShots.filter((s) => s.t < G.charge + G.beam);
  }

  // The forest's mushroom orb: throw a mushroom straight up; it's one of the four spore mushrooms (a 1 in 4 chance each,
  // its colour showing all the way) and it always comes back down on your head, wherever you've run to
  function throwMushroom(p) {
    world.mushroomThrows.push({ p, kind: SPORES.kinds[Math.floor(Math.random() * SPORES.kinds.length)], t: 0 });
    Sound.play("mushroomThrow");
  }
  function updateMushroomThrows(dt) {
    for (const m of world.mushroomThrows) {
      m.t += dt;
      if (m.t < MUSHROOM_ORB.flight) continue;
      m.done = true;
      if (!m.p.dead && !m.p.caught) giveSpore(m.p, m.kind, true); // (it lands on you)
    }
    world.mushroomThrows = world.mushroomThrows.filter((m) => !m.done);
  }

  // ---- The enchanted forest's saws that break loose ----

  // Some of the forest's saws break loose a while after someone first comes near: they shake and creak,
  // then drop (off their pole, or out of their slot or pit) and roll straight at whoever is nearest,
  // half sunk in the ground, until they fall into a pit or have rolled far enough
  function updateLooseSaws(dt) {
    const { level, players } = world;
    const runners = players.filter((p) => !p.caught && !p.dead);
    for (const s of level.saws) {
      if (!s.breaks || s.gone) continue;
      if (!s.loose) {
        if (s.breakAt === undefined) {
          if (runners.some((p) => Math.abs(p.x - s.x0) < VIEW_W * 0.5)) s.breakAt = world.time + FOREST.sawDelay[0] + Math.random() * (FOREST.sawDelay[1] - FOREST.sawDelay[0]);
          continue;
        }
        if (!s.creaked && world.time >= s.breakAt - FOREST.sawWarn) { s.creaked = true; Sound.play("sawCreak"); }
        const c = level.sawPos(s, world.time);
        // the forest's magic creeping in to where it's held, as it shakes (just a few faint wisps)
        if (world.time >= s.breakAt - FOREST.sawWarn && Math.random() < dt * 14) {
          const a = Math.random() * Math.PI * 2, t = 0.4 + Math.random() * 0.2;
          world.wisps.push({ level: world.level, x: c.x + Math.cos(a) * (s.r + 6), y: c.y + Math.sin(a) * (s.r + 4), vx: -Math.cos(a) * (s.r + 6) / t, vy: -Math.sin(a) * (s.r + 4) / t, t, max: t, pink: Math.random() < 0.3, ph: Math.random() * 6, faint: true });
        }
        if (world.time < s.breakAt) continue;
        if (c.y > s.gy + 2 || !runners.length) { s.breakAt += 0.2; continue; } // (down in its pit: wait until it's up)
        const target = runners.reduce((a, q) => (Math.abs(q.x - c.x) < Math.abs(a.x - c.x) ? q : a));
        const dir = Math.sign(target.x + HITBOX_W / 2 - c.x) || -1;
        const vy = -FOREST.sawJolt[s.kind];
        // Never straight into a pit: only once it would land on ground with a clear run at them
        if (!clearRun(c.x, c.y, vy, dir)) { s.breakAt += 0.25; continue; } // (it keeps shaking)
        s.loose = { x: c.x, y: c.y, vy, dir, rolling: false, from: c.x, angle: 0 };
        for (let k = 0; k < 8; k++) { // a soft puff of the magic that snapped it free
          const a = (k / 8) * Math.PI * 2, t = 0.35 + Math.random() * 0.2;
          world.wisps.push({ level: world.level, x: c.x, y: c.y, vx: Math.cos(a) * 45, vy: Math.sin(a) * 35 - 10, t, max: t, pink: k % 2 === 0, ph: k, faint: true });
        }
        sawBurst(s, c.x, c.y, 30, ["#4a2468", "#8a5ab0", "#2c1640", "#ff7ae0", "#ffd0f4"], 200); // its pole (or slot) bursting apart
        world.quakes.push({ level: world.level, x: c.x, t: 0.4 });
        Sound.play("sawBreak");
      }
      const L = s.loose;
      // the forest's magic driving it on: wisps streaming off behind it, curling up and fading
      if (Math.random() < dt * 32) {
        const t = 0.7 + Math.random() * 0.5;
        world.wisps.push({ level: world.level, x: L.x - L.dir * s.r * (0.2 + Math.random() * 0.7), y: L.y - Math.random() * s.r, vx: -L.dir * (10 + Math.random() * 20), vy: -12 - Math.random() * 18, t, max: t, pink: Math.random() < 0.4, ph: Math.random() * 6 });
      }
      L.x += L.dir * FOREST.sawSpeed * dt;
      L.angle += (L.dir * FOREST.sawSpeed * dt) / s.r * (L.rolling ? 1 : 1.6);
      const ground = level.groundTop(L.x);
      if (L.rolling) {
        if (ground === null || ground > L.y + 2) { L.rolling = false; L.vy = 0; } // off an edge: it falls
        else L.y = ground; // (up a step, it hops up onto it)
        if (Math.random() < dt * 45) world.sawBits.push({ level: world.level, x: L.x - L.dir * s.r * 0.7, y: L.y - 1, vx: -L.dir * (40 + Math.random() * 80), vy: -70 - Math.random() * 100, t: 0.45, c: Math.random() < 0.5 ? "#3c2148" : "#a24cf0", big: Math.random() < 0.4 }); // dirt thrown up behind it
      } else {
        L.vy += FOREST.sawGravity * dt;
        const was = L.y;
        L.y += L.vy * dt;
        if (ground !== null && was <= ground && L.y >= ground && L.vy > 0) {
          // slams down into the ground, and tears off along it
          L.y = ground;
          L.rolling = true;
          sawBurst(s, L.x, ground, 24, ["#3c2148", "#2a1634", "#a24cf0", "#ff9af0", "#ffd0f4"], 170);
          world.quakes.push({ level: world.level, x: L.x, t: 0.35 });
          Sound.play("sawSlam");
        }
      }
      const far = runners.every((p) => Math.abs(p.x - L.x) > VIEW_W);
      if (L.y > VIEW_H + s.r + 4 || Math.abs(L.x - L.from) > FOREST.sawRollFor || (far && runners.length)) { s.gone = true; s.loose = null; }
    }
  }

  // ---- The enchanted forest's maces that break loose ----

  // Some of the forest's maces (FOREST.maceBreaks) snap off their vines: once someone comes near, the vine
  // glows and cracks for a moment, then the ball is flung at where they are (or, half the time, where they'll be when it lands), in an arc that falls with
  // gravity. Of the throws that would hit them, it picks the one most in line with its swing, so it looks
  // like the swing threw it. Where it lands, it lies there: a spiked ball to jump over. Shared: whoever's nearest.
  function updateLooseMaces(dt) {
    const { level, players } = world, F = FOREST;
    const runners = players.filter((p) => !p.caught && !p.dead && !p.held && !p.dream);
    for (const m of level.maces) {
      if (!m.breaks || m.gone) continue;
      if (!m.loose) {
        if (m.breakAt === undefined) {
          if (runners.some((p) => Math.abs(p.x + HITBOX_W / 2 - m.x) < F.maceSense)) { m.breakAt = world.time + F.maceWarn; Sound.play("sawCreak"); }
          continue;
        }
        const now = level.macePoints(m, level.time);
        if (Math.random() < dt * 20) { // bits of vine and magic flicking off where it's cracking
          const k = now.links[Math.floor(now.links.length * 0.45)] || now.ball, t = 0.4 + Math.random() * 0.2;
          world.wisps.push({ level: world.level, x: k.x, y: k.y, vx: (Math.random() - 0.5) * 30, vy: -10 - Math.random() * 20, t, max: t, pink: Math.random() < 0.4, ph: Math.random() * 6, faint: true });
        }
        if (world.time < m.breakAt || !runners.length) continue;
        const ball = now.ball, prev = level.macePoints(m, level.time - 0.01).ball;
        const sx = (ball.x - prev.x) / 0.01, sy = (ball.y - prev.y) / 0.01; // which way the swing is carrying it
        const target = runners.reduce((a, q) => (Math.abs(q.x - ball.x) < Math.abs(a.x - ball.x) ? q : a));
        const tx = target.x + HITBOX_W / 2, ty = target.y + HITBOX_H / 2;
        const late = world.time > m.breakAt + F.maceWait;
        if (!late && (Math.sign(sx) !== Math.sign(tx - ball.x) || Math.abs(sx) < 40)) continue; // (wait for it to swing their way)
        const lead = Math.random() < F.maceAhead && Math.abs(target.vx) > 20 ? target.vx : 0; // (half the time it leads you: where you'll be when it lands)
        let best = null;
        for (let T = F.maceFlight[0]; T <= F.maceFlight[1] + 1e-6; T += 0.05) {
          const vx = (tx + lead * T - ball.x) / T, vy = (ty - ball.y) / T - 0.5 * F.maceGravity * T;
          const fit = (vx * sx + vy * sy) / (Math.hypot(vx, vy) * Math.hypot(sx, sy) || 1);
          if (!best || fit > best.fit) best = { vx, vy, fit };
        }
        m.loose = { x: ball.x, y: ball.y, vx: best.vx, vy: best.vy, spin: now.spin, turn: Math.sign(best.vx) * 9, landed: false, lead: lead !== 0 };
        sawBurst({ r: 4 }, ball.x, ball.y, 14, ["#2f6a2f", "#4f8a3f", "#7ac25a", "#c080ff", "#ffd0f4"], 120); // the vine snapping
        Sound.play("sawBreak");
        continue;
      }
      const L = m.loose;
      if (L.landed) continue;
      if (Math.random() < dt * 30) { // a trail of the magic that flung it
        const t = 0.4 + Math.random() * 0.3;
        world.wisps.push({ level: world.level, x: L.x, y: L.y, vx: -L.vx * 0.1, vy: -L.vy * 0.1 - 10, t, max: t, pink: Math.random() < 0.4, ph: Math.random() * 6, faint: true });
      }
      L.vy += F.maceGravity * dt;
      L.x += L.vx * dt;
      L.y += L.vy * dt;
      L.spin += L.turn * dt;
      const g = level.groundTop(L.x);
      if (g !== null && L.y + MACE_RADIUS > g + 4 && L.y - L.vy * dt + MACE_RADIUS > g + 4) { L.x -= L.vx * dt; L.vx *= -0.3; continue; } // (into the side of a step: it knocks back off it)
      if (g !== null && L.y + MACE_RADIUS >= g && L.y - L.vy * dt + MACE_RADIUS <= g + 4 && L.vy > 0) {
        // thuds down and stays there, half sunk in the moss
        L.y = g - MACE_RADIUS + 1;
        L.landed = true;
        sawBurst({ r: 6 }, L.x, g, 16, ["#3c2148", "#2a1634", "#a24cf0", "#ff9af0"], 140);
        world.quakes.push({ level: world.level, x: L.x, t: 0.3 });
        Sound.play("sawSlam");
      } else if (L.y > VIEW_H + 20) m.gone = true; // (down a pit)
    }
  }

  // Would a saw thrown from (x, y) going up at vy (and along at its speed) land on ground, with a clear run
  // from there (no pit, no drop) for FOREST.sawClear pixels?
  function clearRun(x, y, vy, dir) {
    const { level } = world, dt = STEP; // (the same steps the saw itself will take)
    for (let k = 0; k < 480; k++) {
      const was = y;
      vy += FOREST.sawGravity * dt;
      x += dir * FOREST.sawSpeed * dt;
      y += vy * dt;
      if (y > VIEW_H + 20) return false;
      const g = level.groundTop(x);
      if (g !== null && was <= g && y >= g && vy > 0) {
        for (let d = 2; d <= FOREST.sawClear; d += 2) {
          const g2 = level.groundTop(x + dir * d);
          if (g2 === null || g2 > g + 2) return false;
        }
        return true;
      }
    }
    return false;
  }

  // A burst of n bits flying out from (x, y)
  function sawBurst(s, x, y, n, colors, speed) {
    for (let k = 0; k < n; k++) {
      const a = -Math.PI * (0.1 + 0.8 * Math.random());
      const v = speed * (0.4 + Math.random() * 0.8);
      world.sawBits.push({ level: world.level, x: x + (Math.random() - 0.5) * s.r, y: y - Math.random() * s.r * 0.5, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0.5 + Math.random() * 0.5, c: colors[k % colors.length], big: k % 3 !== 2 });
    }
  }

  // ---- Purple catch-up orbs: portal gun, grapple and vine ----

  // Someone who's fallen off the leader's screen (alone: who has the fire on their screen) gets a purple
  // orb, out of sight of both of you, ahead of them: the further behind, the sooner. Only one each per race:
  // one chance to catch up, no second ones (Player.catchupGiven).
  function updateCatchup() {
    const { level, players, fire } = world;
    const runners = players.filter((p) => !p.caught);
    let behind = null, far = 0, lo = 0, hi = 0;
    if (world.solo) {
      const p = runners[0];
      if (p && !p.dead && p.x - fire.x < CATCHUP.fireNear) {
        behind = p;
        far = 1 - Math.max(0, p.x - fire.x) / CATCHUP.fireNear;
        lo = p.x + VIEW_W * 0.65 + CATCHUP.margin;
        hi = lo + VIEW_W;
      }
    } else if (runners.length >= 2) {
      // (3 or 4 runners: the one furthest behind who hasn't had theirs yet)
      const sorted = [...runners].sort((p, q) => p.trackX - q.trackX), lead = sorted[sorted.length - 1];
      const trail = sorted.find((q) => q !== lead && !q.catchupGiven) || sorted[0];
      const leadScreen = lead.x - VIEW_W * 0.35; // the left edge of the leader's screen
      if (!trail.dead && !lead.dead && trail.x + HITBOX_W < leadScreen) {
        behind = trail;
        far = Math.min(1, (leadScreen - trail.x - HITBOX_W) / CATCHUP.far);
        lo = trail.x + VIEW_W * 0.65 + CATCHUP.margin;
        hi = leadScreen - CATCHUP.margin - 8;
      }
    }
    if (!behind || world.monsoon || behind.catchupGiven) { world.nextCatchup = null; return; }
    const wait = CATCHUP.every[0] + (CATCHUP.every[1] - CATCHUP.every[0]) * far;
    if (world.nextCatchup === null) world.nextCatchup = world.time + wait;
    if (world.time < world.nextCatchup) return;
    world.nextCatchup = world.time + wait;
    const waiting = level.orbs.filter((o) => o.purple && !o.used && o.x > behind.x).length;
    if (waiting >= CATCHUP.maxWaiting || hi - lo < TILE * 2) return;
    // somewhere safe to stand under it, out of both screens, away from other orbs
    for (let from = lo; from < hi - TILE; from += 4 * TILE) {
      const spot = level.safeSpotAfter(from, hi - from - TILE);
      if (!spot) return;
      if (level.orbs.some((o) => !o.used && Math.abs(o.x - spot.x) < 6 * TILE)) { from = spot.x; continue; }
      const kinds = { ...CATCHUP.kinds };
      if (world.solo) delete kinds.grapple;
      level.orbs.push({ x: spot.x, y: spot.y + HITBOX_H - 32, w: 8, h: 8, used: false, kind: pickWeighted(kinds), purple: true, forWhom: behind });
      behind.catchupGiven = true; // (their one catch-up orb this race)
      return;
    }
  }

  // Where the next `n` obstacles ahead of x end: pits, dangers (maces, saws, traps, turrets...) and
  // long runs of spikes or quicksand. A single spike doesn't count. Dangers close together count as one.
  function obstaclesEnd(x, n) {
    const { level } = world;
    let count = 0, cur = null;
    const close = () => {
      if (cur && (cur.big || cur.cols >= PORTAL_GUN.bigRun)) count++;
      return count >= n;
    };
    const first = Math.floor(x / TILE) + 1;
    for (let c = first; c < first + 800 && c < level.cols.length - 2; c++) {
      const g = level.groundTop(c * TILE);
      let big = false, small = false;
      if (g === null) big = true;
      else {
        if (level.tile(c, g / TILE - 1) === T_SPIKE || level.isQuick(c)) small = true;
        if (level.threatened(c * TILE + TILE / 2 - HITBOX_W / 2, g - HITBOX_H)) big = true;
      }
      if (!big && !small) {
        if (cur && c - cur.end > PORTAL_GUN.merge) { if (close()) return (cur.end + 1) * TILE; cur = null; }
        continue;
      }
      if (!cur) cur = { end: c, cols: 0, big: false };
      cur.end = c;
      cur.cols++;
      cur.big ||= big;
    }
    return close() ? (cur.end + 1) * TILE : null;
  }

  // The obstacles between two places, as runs of columns [{ start, end }] (counted the same way as obstaclesEnd: pits,
  // dangers and long runs of spikes or quicksand; a single spike doesn't count; dangers close together count as one)
  function obstacleRuns(x0, x1) {
    const { level } = world, runs = [];
    let cur = null;
    const close = () => { if (cur && (cur.big || cur.cols >= PORTAL_GUN.bigRun)) runs.push({ start: cur.start, end: cur.end }); cur = null; };
    const first = Math.floor(x0 / TILE) + 1, last = Math.min(Math.floor(x1 / TILE), level.cols.length - 3);
    for (let c = first; c <= last; c++) {
      const g = level.groundTop(c * TILE);
      let big = false, small = false;
      if (g === null) big = true;
      else {
        if (level.tile(c, g / TILE - 1) === T_SPIKE || level.isQuick(c)) small = true;
        if (level.threatened(c * TILE + TILE / 2 - HITBOX_W / 2, g - HITBOX_H)) big = true;
      }
      if (!big && !small) { if (cur && c - cur.end > PORTAL_GUN.merge) close(); continue; }
      if (!cur) cur = { start: c, end: c, cols: 0, big: false };
      cur.end = c;
      cur.cols++;
      cur.big ||= big;
    }
    close();
    return runs;
  }
  // A safe place to come out between two x positions (after `from`, before `to`), or null
  function spotBetween(from, to) {
    const spot = world.level.safeSpotAfter(from, Math.max(0, to - from)) || landingAfter(from);
    return spot && spot.x > from - TILE && spot.x + HITBOX_W < to ? spot : null;
  }

  // The portal gun (v7.32): a portal opens right in front of you, you're pulled in, and you come out at the start of the
  // next biome. Never past the leader: at most as far as one obstacle behind them. Save it until you can see the leader
  // and it puts you one obstacle ahead of them instead. Alone it's just the next biome; with biomes off (no next biome),
  // past the next 3 obstacles as before (never past the leader either). Nowhere to go: keep it.
  function firePortalGun(p) {
    const { level } = world;
    level.ensure(p.x + VIEW_W * 12);
    // v7.62: the grapple's opposite: it takes you halfway to whoever is in the lead (on safe ground, never past them)
    const lead = leaderAhead(p, HITBOX_W);
    if (lead) {
      const mid = (p.x + lead.x) / 2;
      const after = level.safeSpotAfter(mid - 1, lead.x - mid), before = level.safeSpotBefore(mid, mid - p.x);
      const spot = after && (!before || after.x - mid <= mid - before.x) ? after : before; // (the safe ground nearest halfway)
      if (!spot || spot.x <= p.x + TILE || spot.x + HITBOX_W >= lead.x) return false; // (nowhere to come out: keep it)
      return warpTo(p, spot);
    }
    if (!world.solo) { p.showHit("NOBODY AHEAD", "#d9a3ff"); return false; } // (you're the leader: keep it)
    // Alone: the next biome (just past its sign), or with no biomes, past the next 3 obstacles
    const sign = level.signs.find((sg) => sg.x > p.x + VIEW_W * 0.65); // (not one you can already see: the one after it)
    let spot = null;
    if (sign) spot = level.safeSpotAfter(sign.x) || landingAfter(sign.x);
    else { const end = obstaclesEnd(p.x + HITBOX_W, PORTAL_GUN.passes); spot = end !== null && (level.safeSpotAfter(end) || landingAfter(end)); }
    if (!spot || spot.x <= p.x + TILE) return false;
    return warpTo(p, spot);
  }
  function warpTo(p, spot) {
    world.warps.push({ owner: p, from: { x: p.x, y: p.y }, door: p.x + HITBOX_W / 2 + 10, to: spot, t: 0, out: false });
    grab(p);
    p.facing = 1;
    Sound.play("portal");
    return true;
  }

  // Taken out of whatever they were doing: something else is moving them now
  function grab(p) {
    p.held = true;
    p.vx = p.vy = 0;
    p.inQuick = false;
    p.inRiver = null;
    p.trapped = 0;
    p.standingOn = null;
    p.dashHold = 0;
  }

  function updateWarps(dt) {
    for (const w of world.warps) {
      w.t += dt;
      if (w.done) continue; // (its portals fading away)
      const p = w.owner;
      if (p.caught || p.dead) { w.done = true; w.t = 0; p.warp = null; continue; }
      if (!w.out) {
        // sucked in, shrinking
        const u = Math.min(1, w.t / PORTAL_GUN.inTime);
        p.x = w.from.x + (w.door - HITBOX_W / 2 - w.from.x) * u;
        p.y = w.from.y;
        p.warp = { scale: 1 - u };
        if (u >= 1) { w.out = true; w.t = 0; p.x = w.to.x; p.y = w.to.y; Sound.play("portal"); }
      } else {
        const u = Math.min(1, w.t / PORTAL_GUN.outTime);
        p.warp = { scale: u };
        if (u >= 1) {
          w.done = true;
          w.t = 0;
          p.warp = null;
          p.held = false;
          p.onGround = false;
          p.safeSpots.push({ x: w.to.x, y: w.to.y });
        }
      }
    }
    world.warps = world.warps.filter((w) => !w.done || w.t < 0.5);
  }

  // The grapple: a hook flies to whoever is ahead and reels them back, halfway to you
  function throwGrapple(p) {
    const lead = leaderAhead(p), target = lead && !lead.dead ? lead : null;
    if (!target) { p.showHit("NOBODY AHEAD", "#d9a3ff"); return false; }
    world.grapples.push({ owner: p, target, x: p.x + HITBOX_W / 2, y: p.y + 4, mode: "fly", t: 0 });
    Sound.play("grappleThrow");
    return true;
  }

  function updateGrapples(dt) {
    const { level } = world;
    for (const g of world.grapples) {
      g.t += dt;
      const p = g.owner, q = g.target;
      if (g.mode === "fly") {
        if (q.caught || q.dead || p.caught || g.t > 6) { g.mode = "back"; continue; }
        const tx = q.x + HITBOX_W / 2, ty = q.y + 3;
        const dist = Math.hypot(tx - g.x, ty - g.y), step = GRAPPLE.speed * dt;
        if (dist > step) { g.x += ((tx - g.x) / dist) * step; g.y += ((ty - g.y) / dist) * step; continue; }
        g.x = tx;
        g.y = ty;
        if (q.held) continue; // (something else has them: hang on until it lets go)
        // hooked: reel them back to safe ground halfway between you
        const mid = (p.x + q.x) / 2;
        const spot = level.safeSpotBefore(mid) || level.safeSpotAfter(mid, q.x - mid);
        if (!spot || spot.x >= q.x) { g.mode = "back"; continue; }
        grab(q);
        q.eatenBy = null;
        q.hiddenIn = null;
        g.mode = "reel";
        g.from = { x: q.x, y: q.y };
        g.spot = spot;
        g.u = 0;
        q.showHit("HOOKED!", "#d9a3ff");
        Sound.play("grappleHook");
      } else if (g.mode === "reel") {
        if (q.caught || q.dead) { q.held = false; g.mode = "back"; continue; }
        const len = Math.max(1, Math.hypot(g.spot.x - g.from.x, g.spot.y - g.from.y));
        g.u = Math.min(1, g.u + (GRAPPLE.reel * dt) / len);
        q.x = g.from.x + (g.spot.x - g.from.x) * g.u;
        q.y = g.from.y + (g.spot.y - g.from.y) * g.u - Math.sin(Math.PI * g.u) * GRAPPLE.arc;
        g.x = q.x + HITBOX_W / 2;
        g.y = q.y + 3;
        if (g.u >= 1) {
          q.held = false;
          q.x = g.spot.x;
          q.y = g.spot.y;
          q.onGround = false;
          q.safeSpots.push({ x: g.spot.x, y: g.spot.y });
          g.mode = "back";
        }
      } else {
        // the rope zips back
        const tx = p.x + HITBOX_W / 2, ty = p.y + 4;
        const dist = Math.hypot(tx - g.x, ty - g.y), step = GRAPPLE.speed * 1.5 * dt;
        if (dist <= step || p.caught) g.done = true;
        else { g.x += ((tx - g.x) / dist) * step; g.y += ((ty - g.y) / dist) * step; }
      }
    }
    world.grapples = world.grapples.filter((g) => !g.done);
  }

  // The vine: it drops down, swings you up and flings you to where the player ahead of you was when you
  // grabbed it (whatever's there by then). Alone, or in the lead: far ahead, wherever.
  function launchVine(p) {
    world.level.ensure(p.x + VINE.distance[1] + VIEW_W * 2);
    const r = Math.max(60, p.y + 20); // (it hangs from just above the top of the screen)
    const dist = VINE.distance[0] + Math.random() * (VINE.distance[1] - VINE.distance[0]);
    const target = leaderAhead(p);
    const spot = target && vineLanding(target); // (where they are right now: it doesn't follow them)
    world.vines.push({ owner: p, spot, t: 0, mode: "drop", ax: p.x + HITBOX_W / 2, ay: p.y - r, r, dist, from: { x: p.x, y: p.y } });
    grab(p);
    p.facing = 1;
    p.spin = 0;
    Sound.play("vineSwing");
  }

  // Just above the player the vine takes you to (dead: where they'll come back), when you grab it
  function vineLanding(q) {
    return q.dead ? { x: q.respawnX, y: q.respawnY - 20 } : { x: q.x, y: q.y - 20 };
  }

  function updateVines(dt) {
    const { level } = world;
    for (const v of world.vines) {
      v.t += dt;
      const p = v.owner;
      if (p.caught || (p.dead && v.mode !== "gone")) { v.mode = "gone"; v.t = 0; }
      if (v.mode === "drop") {
        p.x = v.from.x;
        p.y = v.from.y;
        if (v.t >= VINE.drop) { v.mode = "swing"; v.t = 0; }
      } else if (v.mode === "swing") {
        const u = Math.min(1, v.t / VINE.swing), a = (Math.PI * 0.42) * u * u;
        p.x = v.ax + Math.sin(a) * v.r - HITBOX_W / 2;
        p.y = v.ay + Math.cos(a) * v.r;
        if (u >= 1) {
          v.mode = "fly";
          v.t = 0;
          v.start = { x: p.x, y: p.y };
          const lx = v.from.x + v.dist, g = level.groundTop(lx + HITBOX_W / 2);
          v.land = { x: lx, y: (g ?? VIEW_H - 20) - HITBOX_H - 20 };
          if (v.spot) v.land = v.spot;
          // (a long way takes longer: never faster than the camera can follow)
          v.flyTime = Math.max(VINE.fly, Math.abs(v.land.x - p.x) / VINE.topSpeed);
          Sound.play("vineFling");
        }
      } else if (v.mode === "fly") {
        const u = Math.min(1, v.t / v.flyTime);
        const mid = (v.start.y + v.land.y) / 2, h = mid - VINE.peak;
        p.x = v.start.x + (v.land.x - v.start.x) * u;
        p.y = v.start.y + (v.land.y - v.start.y) * u - h * 4 * u * (1 - u);
        p.spin = u * Math.PI * 2; // one somersault on the way
        if (u >= 1) {
          // let go: fall onto whatever's there
          p.held = false;
          p.spin = 0;
          p.vx = PHYSICS.runSpeed;
          p.vy = 60;
          p.onGround = false;
          v.mode = "gone";
          v.t = 0;
        }
      } else if (v.t > 0.5) v.done = true;
    }
    world.vines = world.vines.filter((v) => !v.done);
  }

  // ---- The snow's orbs: snowstorm and snowball ----

  function snowstormStrength() {
    const st = world.snowstorm;
    if (!st) return 0;
    return Math.max(0, Math.min(1, st.t / SNOWSTORM.fade, (SNOWSTORM.time - st.t) / SNOWSTORM.fade));
  }

  // While it blows (past its first half second), standing still freezes you (see Player.update)
  // The snowstorm's over: with 2 players, whoever got further during it gets skates now (for good: faster on
  // ice), taking it from the other one if they had it. A tie changes nothing
  function crownIceWalker(st) {
    if (world.solo || !st.from || world.players.length < 2) return;
    const went = world.players.map((q, i) => (q.caught ? -Infinity : q.x - st.from[i])), top = Math.max(...went);
    if (went.filter((w) => w > top - 1).length > 1) return; // (a tie for the furthest)
    const win = world.players[went.indexOf(top)];
    for (const lose of world.players) if (lose !== win && lose.iceWalker) { lose.iceWalker = false; lose.showHit("LOST SKATES!", "#a8e0ff"); }
    if (!win.iceWalker) { win.iceWalker = true; win.showHit("SKATES!", "#a8e0ff"); win.sparkle("#e8f8ff"); Sound.play("gotSnowball"); }
  }

  function updateSnowstorm(dt) {
    const st = world.snowstorm;
    if (st) {
      st.t += dt;
      if (st.t >= SNOWSTORM.time) { world.snowstorm = null; crownIceWalker(st); }
    }
    const on = snowstormStrength() >= 0.5;
    for (const p of world.players) p.snowstorm = on && !p.caught;
  }

  // Thrown the way you face, from about shoulder height, in a short low arc
  function throwSnowball(p) {
    const dir = p.facing;
    world.thrownSnowballs.push({ owner: p, x: p.x + HITBOX_W / 2 + dir * 4, y: p.y + 3, vx: dir * SNOWBALL.vx, vy: -SNOWBALL.vy });
    Sound.play("throwSnowball");
  }

  function updateThrownSnowballs(dt) {
    const { level, players } = world;
    for (const sb of world.thrownSnowballs) {
      sb.vy += SNOWBALL.gravity * dt;
      sb.x += sb.vx * dt;
      sb.y += sb.vy * dt;
      const half = SNOWBALL.size / 2;
      const hit = players.find((q) => q !== sb.owner && !q.dead && !q.caught && !q.held && !q.eatenBy &&
        overlaps(q.x, q.y, HITBOX_W, HITBOX_H, sb.x - half, sb.y - half, SNOWBALL.size, SNOWBALL.size));
      if (hit) {
        hit.iceLock = SNOWBALL.freeze;
        hit.stormIce = false; // (a snowstorm's ice gives way to the snowball's)
        hit.vx = 0;
        hit.showHit("FROZEN SOLID!", "#a8e0ff");
        hit.sparkle("#e8f8ff");
        Sound.play("freeze");
        sb.done = true;
      } else if (level.isSolid(Math.floor(sb.x / TILE), Math.floor((sb.y + half) / TILE)) || sb.y > VIEW_H + 10) {
        sb.done = true; // splat
        world.burns.push({ x: sb.x, y: sb.y - 1, t: 0, snow: true }); // (a puff of snow, drawn like a firehawk's burst)
      }
    }
    world.thrownSnowballs = world.thrownSnowballs.filter((sb) => !sb.done);
  }

  // Off it goes: out to the other player with a burning stick, or (alone) to circle you
  function launchHawk(p) {
    const other = rivalOf(p);
    const guard = world.solo || !other;
    world.hawks.push({ mode: guard ? "guard" : "attack", owner: p, target: other, x: p.x + HITBOX_W / 2, y: p.y - 6, t: 0, angle: -Math.PI / 2, facing: 1, flap: 0 });
    Sound.play("hawkScreech");
  }

  // The animals coming for p that a guarding firehawk will go for (once they're close)
  function preyFor(p) {
    const out = [];
    for (const v of world.vultures) if (v.target === p && ["circle", "diving", "skim", "carry"].includes(v.state)) out.push({ who: v, list: "vultures", x: v.x, y: v.y });
    for (const bear of world.bears) if (bear.target === p && bear.state !== "leave") out.push({ who: bear, list: "bears", x: bear.x - BEAR_W / 2, y: bear.y - 10 });
    for (const j of world.jaguars) if (j.target === p && ["leap", "run", "wait", "crouch", "attack"].includes(j.state)) out.push({ who: j, list: "jaguars", x: j.x, y: j.y - 6 });
    // ...and a missile locked on to you (it's not an animal, but it's coming for you all the same)
    for (const m of world.missiles) if (m.target === p && (m.state === "lock" || m.state === "fly")) out.push({ who: m, list: "missiles", x: m.x, y: m.y });
    return out.filter((a) => Math.abs(a.x - (p.x + HITBOX_W / 2)) < (a.list === "missiles" ? FIREHAWK.missileSense : FIREHAWK.guardSense));
  }

  function updateHawks(dt) {
    const { level } = world;
    for (const h of world.hawks) {
      h.t += dt;
      h.flap += dt * (h.mode === "dive" ? 4 : 8);
      const px = h.x, py = h.y;
      const steer = (tx, ty, speed) => {
        const dx = tx - h.x, dy = ty - h.y, d = Math.hypot(dx, dy);
        if (d <= speed * dt) { h.x = tx; h.y = ty; return true; }
        h.x += (dx / d) * speed * dt;
        h.y += (dy / d) * speed * dt;
        return false;
      };
      if (h.mode === "attack") {
        // fly to where the stick, dropped now, would land on them
        const q = h.target;
        const g = level.groundTop(q.x + HITBOX_W / 2) ?? q.y + HITBOX_H;
        const dropY = g - FIREHAWK.height;
        const fall = Math.sqrt((2 * Math.max(10, q.y + HITBOX_H / 2 - dropY)) / FIREHAWK.gravity);
        const aimX = q.x + HITBOX_W / 2 + (q.dead ? 0 : q.vx * fall);
        steer(aimX, dropY, FIREHAWK.speed);
        if (Math.abs(h.x - aimX) < 4 && Math.abs(h.y - dropY) < 6) {
          world.sticks.push({ x: h.x, y: h.y + 6, vy: 0, t: 0 });
          Sound.play("stickDrop");
          h.mode = "leave";
          h.t = 0;
        }
        if (h.t > 6) h.mode = "leave"; // (never caught up)
      } else if (h.mode === "guard") {
        const p = h.owner;
        h.angle += dt * 3;
        steer(p.x + HITBOX_W / 2 + Math.cos(h.angle) * FIREHAWK.guardRadius, p.y - 16 + Math.sin(h.angle) * 6, 200);
        if (!p.dead && !p.caught) {
          const prey = preyFor(p)[0];
          if (prey) { h.mode = "dive"; h.prey = prey; Sound.play("hawkScreech"); }
        }
      } else if (h.mode === "dive") {
        const prey = h.prey, who = prey.who;
        if (who.done || !world[prey.list].includes(who)) { h.mode = "guard"; continue; }
        const now = prey.list === "bears" ? [who.x - BEAR_W / 2, who.y - 10] : prey.list === "jaguars" ? [who.x, who.y - 6] : [who.x, who.y];
        if (steer(now[0], now[1], FIREHAWK.diveSpeed) || Math.hypot(now[0] - h.x, now[1] - h.y) < 8) {
          // burned up!
          if (prey.list === "vultures" && who.state === "carry") { const p = who.target; p.held = false; p.vx = p.vy = 0; p.onGround = false; p.stun = 0.3; }
          who.done = true;
          world.burns.push({ x: now[0], y: now[1], t: 0 });
          h.owner.showHit("FIREHAWK!", "#ff7a1a");
          Sound.play("hawkBurn");
          h.mode = "leave";
          h.t = 0;
        }
      } else {
        // off it goes, up and away
        h.x += h.facing * 160 * dt;
        h.y -= 110 * dt;
        if (h.y < -40 || h.t > 4) h.done = true;
      }
      if (h.mode !== "leave" && Math.abs(h.x - px) > 0.2) h.facing = h.x > px ? 1 : -1;
    }
    world.hawks = world.hawks.filter((h) => !h.done);
    for (const b of world.burns) b.t += dt;
    world.burns = world.burns.filter((b) => b.t < 0.8);
  }

  // A burning stick tumbling down: it kills whoever it hits, and sets the ground alight where it lands
  function updateSticks(dt) {
    const { level, players } = world;
    for (const st of world.sticks) {
      st.t += dt;
      st.vy += FIREHAWK.gravity * dt;
      st.y += st.vy * dt;
      for (const p of players) {
        if (p.dead || p.caught || p.held || p.eatenBy || !overlaps(p.x, p.y, HITBOX_W, HITBOX_H, st.x - 2, st.y - 2, 4, 4)) continue;
        p.showHit("BURNED!", "#ff7a1a");
        p.die();
      }
      const g = level.groundTop(st.x);
      if (g !== null && st.y >= g - 1) {
        level.fires.push({ x: st.x, gy: g, t: 0 });
        Sound.play("fireIgnite");
        st.done = true;
      } else if (st.y > VIEW_H + 10) st.done = true; // (down a pit)
    }
    world.sticks = world.sticks.filter((st) => !st.done);
  }

  // Burning ground: touch the flames and you die (they're low: jump over them)
  function updateFires(dt) {
    const { level, players } = world;
    for (const f of level.fires) {
      f.t += dt;
      const half = FIREHAWK.fireHalf * Math.min(1, f.t / FIREHAWK.spread);
      for (const p of players) {
        if (p.dead || p.caught || p.held || p.eatenBy) continue;
        if (p.x + HITBOX_W > f.x - half + 2 && p.x < f.x + half - 2 && p.y + HITBOX_H > f.gy - FIREHAWK.fireTall && p.y < f.gy + 2) {
          p.showHit("BURNED!", "#ff7a1a");
          p.die();
        }
      }
    }
    level.fires = level.fires.filter((f) => f.t < FIREHAWK.fireTime);
  }

  // ---- Ancient turrets (jungle) ----

  // A turret is shared: whoever comes first sets it off, and its arrows hit anyone in the way
  function updateTurrets(dt) {
    const { level, players } = world;
    const free = (p) => !p.dead && !p.caught && !p.held && !p.eatenBy && !p.inRiver;
    // Which arrows it'll shoot, picked when it wakes up: a sleep dart always goes first (so the next
    // arrow finds you asleep) and a blunt one always last (it knocks you out of reach of the rest)
    const ORDER = { sleep: 0, arrow: 1, poison: 1, blunt: 2 };
    const plan = (tu) => {
      const kinds = [];
      for (let i = 0; i < tu.shotsLeft; i++) kinds.push(Math.floor(tu.x / TILE) < level.baseAt ? "arrow" : pickWeighted(TURRET.kinds));
      tu.plan = kinds.sort((a, b) => ORDER[a] - ORDER[b]);
    };
    // what it shoots next: low or regular, and the next arrow in its plan
    const load = (tu) => {
      tu.low = Math.random() < 0.5;
      tu.kind = tu.plan.shift() || "arrow";
    };
    for (const tu of level.turrets) {
      if (tu.state === "done" || !players.some((p) => Math.abs(p.x - tu.x) < VIEW_W * 1.5)) continue;
      tu.t += dt;
      const shot = tu.low ? "low" : "regular";
      const want = tu.state === "sink" || tu.state === "hidden" || tu.state === "rumble" ? 0 : TURRET.heights[shot];
      tu.moving = tu.h !== want; // (it shakes while it grinds up or down)
      tu.h = approach(tu.h, want, (TURRET.heights.regular / (tu.state === "sink" ? TURRET.sink : TURRET.rise[shot])) * dt);
      if (tu.state === "hidden") {
        const near = (p) => free(p) && Math.abs(p.y + HITBOX_H - tu.gy) < 40 &&
          (tu.dir < 0 ? tu.x - p.x > 0 && tu.x - p.x < TURRET.sense : p.x - tu.x > tu.wait && p.x - tu.x < tu.wait + 60);
        if (players.some(near)) {
          tu.state = "rumble";
          tu.t = 0;
          tu.shotsLeft = level.wild ? WILD.turretShots : 1 + Math.floor(Math.random() * TURRET.shots[1]);
          plan(tu);
          load(tu);
          Sound.play("turretRumble");
        }
      } else if (tu.state === "rumble") {
        if (tu.t >= TURRET.rumble) { tu.state = "aim"; tu.t = 0; Sound.play("turretRise"); }
      } else if (tu.state === "aim") {
        // (the glow only starts once it's up)
        if (tu.h === want && tu.t >= TURRET.rise[shot] + (level.wild ? WILD.turretAim : TURRET.aim)[shot]) {
          world.arrows.push({ x: tu.x + tu.dir * 8, y: tu.gy - tu.h + 13, dir: tu.dir, kind: tu.kind, vx: tu.dir * TURRET.speed[shot], vy: 0, t: 0 });
          Sound.play("arrowShoot");
          tu.shotsLeft--;
          tu.state = tu.shotsLeft > 0 ? "reload" : "sink";
          tu.t = 0;
          if (tu.state === "sink") Sound.play("turretRise");
        }
      } else if (tu.state === "reload") {
        if (tu.t >= (level.wild ? WILD.turretReload : TURRET.reload)) {
          load(tu);
          // another shot, but only at someone still a fair way out in front of it (never point-blank)
          const next = tu.low ? "low" : "regular";
          const room = TURRET.closest + PHYSICS.runSpeed * (level.wild ? WILD.turretAim : TURRET.aim)[next];
          const mouth = tu.x + tu.dir * 8;
          if (players.some((p) => free(p) && (tu.dir < 0 ? mouth - (p.x + HITBOX_W) : p.x - mouth) > room)) { tu.state = "aim"; tu.t = TURRET.rise[next]; }
          else { tu.state = "sink"; tu.t = 0; Sound.play("turretRise"); }
        }
      } else if (tu.state === "sink" && tu.h === 0) {
        tu.state = "done";
        tu.moving = false; // (back in the ground: no more shaking or dust)
      }
    }
  }

  // Arrows fly fast along the ground, dropping a little as they go, until they hit someone or a
  // wall, or stick in the ground (where they stay a moment, harmless, then fade)
  function updateArrows(dt) {
    const { level, players } = world;
    for (const a of world.arrows) {
      a.t += dt;
      if (a.stuck) { if (a.t >= TURRET.stuck) a.done = true; continue; }
      a.vy += TURRET.drop * dt;
      a.x += a.vx * dt;
      a.y += a.vy * dt;
      if (a.y > VIEW_H || level.isSolid(Math.floor(a.x / TILE), Math.floor((a.y + 1) / TILE))) {
        const g = level.groundTop(a.x);
        if (g !== null && a.y + 1 >= g - 1 && a.y < g + 2) { a.stuck = true; a.y = g; a.t = 0; } // its tip digs into the ground
        else a.done = true; // (a wall, or down a pit)
        continue;
      }
      const bx = a.dir < 0 ? a.x : a.x - 12; // its tip is at a.x
      const p = players.find((q) => !q.dead && !q.caught && !q.held && !q.eatenBy && !q.inRiver && overlaps(q.x, q.y, HITBOX_W, HITBOX_H, bx, a.y, 12, 3));
      if (!p) continue;
      a.done = true;
      if (a.kind === "arrow") {
        p.showHit("ARROW!", "#ff4d3d");
        p.die();
      } else if (a.kind === "poison") {
        p.poison = TURRET.poison;
        p.poisonMax = TURRET.poison;
        p.showHit("POISONED!", "#7dff4a");
        Sound.play("poisoned");
      } else if (a.kind === "sleep") {
        p.asleep = TURRET.sleep;
        p.vx = 0;
        p.showHit("SLEEPY...", "#6ac8ff");
        Sound.play("sleepDart");
      } else {
        throwPlayer(p); // knocked back, as far as the hand's backhand
        p.dizzy = TURRET.bluntDizzy;
        p.showHit("THWACK!", "#ffd23f");
        p.sparkle("#ffd23f");
        Sound.play("smack");
      }
    }
    world.arrows = world.arrows.filter((a) => !a.done);
  }

  // ---- Jaguars (jungle) ----

  // Its box: [x, y, w, h], with (j.x, j.y) the middle of its feet
  const jaguarBox = (j) => [j.x - 12, j.y - 13, 24, 12];

  // It hides in one of the background bushes ahead (false: there isn't one there yet)
  function spawnJaguar(leader, kindName) {
    const bush = hidingBush(leader.x + JAGUAR.ahead[0], leader.x + JAGUAR.ahead[1]);
    if (!bush) return false;
    const ey = bush.y - Math.round(JUNGLE.backBushes[bush.v][1] * 0.6);
    world.jaguars.push({ kind: kindName, target: leader, state: "eyes", t: 0, ex: bush.x, ey, x: bush.x, y: bush.y - 6, dir: -1, attacks: JAGUAR[kindName].attacks, anim: 0 });
    return true;
  }

  // A background bush between x0 and x1 that nothing is peering out of already
  function hidingBush(x0, x1) {
    const taken = [...world.jaguars, ...world.decoys].map((e) => e.ex);
    const bushes = world.level.backBushes(x0, x1).filter((bu) => bu.x >= x0 && bu.x <= x1 && !taken.some((x) => Math.abs(x - bu.x) < 20));
    return bushes.length ? bushes[Math.floor(Math.random() * bushes.length)] : null;
  }

  // Harmless eyes that blink in a bush now and then, so you can never be sure (they never narrow)
  function updateDecoys(dt) {
    const runners = world.players.filter((p) => !p.dead && !p.caught);
    for (const d of world.decoys) d.t += dt;
    world.decoys = world.decoys.filter((d) => d.t < d.life);
    if (!runners.length) return;
    const p = runners[Math.floor(Math.random() * runners.length)];
    if (world.level.biomeAt(Math.floor(p.x / TILE)) !== "jungle") { world.nextDecoy = null; return; }
    if (world.nextDecoy === null) world.nextDecoy = world.time + rand(JAGUAR.decoys[0], JAGUAR.decoys[1]);
    if (world.time < world.nextDecoy) return;
    world.nextDecoy = null;
    const bush = hidingBush(p.x + 60, p.x + 240);
    if (!bush) return;
    const kinds = world.level.wild || p.x / TILE >= world.level.specialAt ? ["jaguar", "panther"] : ["jaguar"];
    world.decoys.push({ kind: kinds[Math.floor(Math.random() * kinds.length)], ex: bush.x, ey: bush.y - Math.round(JUNGLE.backBushes[bush.v][1] * 0.6), t: 0, life: rand(1.6, 2.8), blink: rand(0.6, 1.2) });
  }

  // Where it lands near x: the nearest firm ground (never in a pit or a river)
  function jaguarGround(x, fallbackY) {
    const { level } = world;
    for (let d = 0; d < 80; d += 4) for (const s of [1, -1]) {
      const g = level.groundTop(x + s * d);
      if (g !== null && !level.riverAt(x + s * d)) return { x: x + s * d, y: g };
    }
    return { x, y: fallbackY };
  }

  function updateJaguars(dt) {
    const { level, players } = world;
    const runners = players.filter((p) => !p.dead && !p.caught);
    if (runners.length) {
      const leader = runners.reduce((a, b) => (b.x > a.x ? b : a));
      const busy = world.jaguars.some((j) => j.state !== "leave");
      const inJungle = level.biomeAt(Math.floor(leader.x / TILE)) === "jungle";
      const pick = (meters) => (meters >= level.specialAt && Math.random() < 0.5 ? "panther" : "jaguar"); // black panthers come later
      if (world.wild) {
        // Wild: always one hunting you in the jungle: when one gives up, the next comes
        if (!inJungle || busy) world.nextWildJaguar = null;
        else if (world.nextWildJaguar === null) world.nextWildJaguar = world.time + WILD.jaguarGap;
        else if (world.time >= world.nextWildJaguar && spawnJaguar(leader, pick(leader.x / TILE))) world.nextWildJaguar = null;
      }
      let taken = busy;
      for (const spot of world.wild ? [] : level.jaguarSpots) {
        if (spot.used || leader.x / TILE < spot.col || taken) continue;
        if (!inJungle || leader.x / TILE < level.baseAt) { spot.used = true; continue; }
        if (spawnJaguar(leader, pick(leader.x / TILE))) { spot.used = true; taken = true; } // (else: the next bush ahead)
      }
    }

    for (const j of world.jaguars) {
      const k = JAGUAR[j.kind], p = j.target;
      j.t += dt;
      const pcx = p.x + HITBOX_W / 2;
      if (p.caught && j.state !== "leave") { j.state = "leave"; j.t = 0; }
      if (j.state === "eyes") {
        // glowing in the trees (it can't be got at here), then it leaps out at where you'll be
        if (j.t >= JAGUAR.eyes) {
          const side = Math.sign(j.ex - pcx) || 1; // the side it comes at you from
          Object.assign(j, { state: "leap", t: 0, fromX: j.ex, fromY: j.ey + 6, side, toX: pcx, toY: p.y + HITBOX_H, lunging: false });
          j.dir = -side;
          Sound.play("jaguarRoar");
        }
      } else if (j.state === "leap") {
        // Out of the bush and through the air at you, following you wherever you go (changing speed
        // won't help)...
        const where = p.dead ? p.respawnX + HITBOX_W / 2 : pcx;
        const ground = level.groundTop(where) ?? p.y + HITBOX_H;
        if (j.t < k.leap) {
          const u = j.t / k.leap;
          j.toX = where;
          j.toY = ground;
          const tx = where + j.side * 30, ty = ground - 3; // ...coming in low, just short of you...
          j.x = j.fromX + (tx - j.fromX) * u;
          j.y = j.fromY + (ty - j.fromY) * u - 22 * 4 * u * (1 - u);
          j.scale = 0.45 + 0.55 * u; // (coming out of the background towards you)
        } else {
          // ...then a low lunge straight through where you are: JUMP it
          if (!j.lunging) {
            const cross = where + p.vx * k.lunge * 0.5;
            const land = jaguarGround(cross + (cross - j.x), ground);
            Object.assign(j, { lunging: true, lx0: j.x, ly0: j.y, lx1: land.x, ly1: land.y, scale: 1 });
          }
          const u = Math.min(1, (j.t - k.leap) / k.lunge);
          j.x = j.lx0 + (j.lx1 - j.lx0) * u;
          j.y = j.ly0 + (j.ly1 - j.ly0) * u;
          if (jaguarHits(j)) continue;
          if (u >= 1) { j.state = j.attacks > 0 ? "run" : "leave"; j.t = 0; Sound.play("land"); }
        }
      } else if (j.state === "run" || j.state === "wait") {
        if (p.dead) {
          // you died to something else: it goes to wait just in front of where you'll come back
          const spot = jaguarGround(p.respawnX + HITBOX_W / 2 + JAGUAR.waitAhead, j.y);
          const d = spot.x - j.x;
          j.dir = Math.sign(d) || j.dir;
          if (Math.abs(d) > 2) { j.x += j.dir * Math.min(Math.abs(d), k.run * dt); j.anim += dt; }
          else j.dir = -1;
          const g = level.groundTop(j.x);
          if (g !== null) j.y = g;
          j.state = "wait";
          continue;
        }
        j.state = "run";
        const d = pcx - j.x;
        j.dir = Math.sign(d) || j.dir;
        // How far apart you'd be when it springs, if it crouched now. Too close (you're running at it,
        // or it landed right by you): it backs off first, so you always get a fair look at its crouch.
        const gap = Math.abs(d + p.vx * k.crouch);
        let move = 0;
        if (gap < JAGUAR.room) move = -j.dir;
        else if (Math.abs(d) < JAGUAR.strike || gap < JAGUAR.strike) {
          j.state = "crouch";
          j.t = 0;
          j.high = Math.random() < 0.5; // leap over you, or pounce at you
          Sound.play(j.high ? "jaguarGrowl" : "jaguarSnarl");
        } else move = j.dir;
        if (move) {
          j.x += move * k.run * dt;
          j.anim += dt;
          j.backing = move !== j.dir;
          const g = level.groundTop(j.x);
          if (g !== null) j.y = g;
        }
      } else if (j.state === "crouch") {
        // you're running right into it: it breaks off and backs away (then crouches again)
        if (Math.abs(pcx - j.x + p.vx * Math.max(0, k.crouch - j.t)) < JAGUAR.room - 6) { j.state = "run"; continue; }
        if (j.t >= k.crouch) {
          // spring: it passes over (or through) where you'll be 55% of the way through, and lands past you
          j.dur = j.high ? k.over : k.pounce;
          const cross = pcx + p.vx * j.dur * 0.55;
          const dir = Math.sign(cross - j.x) || j.dir;
          const far = Math.max(Math.abs(cross - j.x) / 0.55, Math.abs(cross - j.x) + JAGUAR.overshoot);
          const land = jaguarGround(j.x + dir * far, j.y);
          const under = level.groundTop(cross) ?? j.y;
          const mid = j.y + (land.y - j.y) * 0.55;
          const lift = j.high ? Math.max(JAGUAR.over, mid - (under - JAGUAR.over)) / 0.99 : 3;
          Object.assign(j, { state: "attack", t: 0, fromX: j.x, fromY: j.y, toX: land.x, toY: land.y, lift, crossX: cross });
          j.dir = land.x >= j.x ? 1 : -1;
          Sound.play("jaguarRoar");
        }
      } else if (j.state === "attack") {
        const u = Math.min(1, j.t / j.dur);
        j.x = j.fromX + (j.toX - j.fromX) * u;
        j.y = j.fromY + (j.toY - j.fromY) * u - j.lift * 4 * u * (1 - u);
        if (jaguarHits(j)) continue;
        if (u >= 1) {
          j.attacks--;
          j.state = j.attacks > 0 ? "run" : "leave";
          j.t = 0;
          Sound.play("land");
        }
      } else if (j.state === "leave") {
        // gives up and slinks off, away from you (gone once nobody can see it)
        j.dir = j.x >= pcx ? 1 : -1;
        j.x += j.dir * k.run * dt;
        j.anim += dt;
        const g = level.groundTop(j.x);
        if (g !== null) j.y = g;
        if (j.t > 8 || players.every((q) => Math.abs(j.x - (q.x + HITBOX_W / 2)) > VIEW_W)) j.done = true;
      }
    }
    world.jaguars = world.jaguars.filter((j) => !j.done);
  }

  // Did it get the player it's after? (Only them: it ignores anyone else.)
  function jaguarHits(j) {
    const p = j.target;
    if (p.dead || p.caught || p.held || p.eatenBy || p.inRiver) return false;
    if (!overlaps(p.x, p.y, HITBOX_W, HITBOX_H, ...jaguarBox(j))) return false;
    p.showHit("POUNCED!", "#ff4d3d");
    p.die();
    Sound.play("maul");
    j.state = "leave"; // got you: it's done
    j.t = 0;
    return true;
  }

  // ---- Vultures (desert) ----

  function spawnVultures(leader) {
    const n = Number(pickWeighted(VULTURE.groupSizes));
    const blackAllowed = leader.x / TILE >= world.level.specialAt; // black vultures come later
    for (let i = 0; i < n; i++) {
      const kind = blackAllowed && Math.random() < 0.5 ? "black" : "brown";
      world.vultures.push({ kind, target: leader, state: "wait", t: -i * VULTURE.stagger, x: leader.x + 270, y: -12, angle: Math.random() * 6.28, facing: -1 });
    }
  }

  function pickWeighted(weights) {
    const total = Object.values(weights).reduce((a, b) => a + b, 0);
    let roll = Math.random() * total;
    for (const [key, w] of Object.entries(weights)) if ((roll -= w) < 0) return key;
    return Object.keys(weights)[0];
  }

  // The height a skimming vulture flies at: just above the ground, at your feet
  function skimY(x, fallback) {
    const g = world.level.groundTop(x);
    return g === null ? fallback : g - 5;
  }

  function updateVultures(dt) {
    const { players, level } = world;
    const runners = players.filter((p) => !p.dead && !p.caught);
    if (runners.length) {
      const leader = runners.reduce((a, b) => (b.x > a.x ? b : a));
      const meters = leader.x / TILE;
      if (world.wild) {
        // Wild: vultures the whole time in the desert: when a group is done, the next comes in
        const busy = world.vultures.some((v) => v.state !== "leave");
        if (level.biomeAt(Math.floor(meters)) !== "desert" || busy) world.nextWildVulture = null;
        else if (world.nextWildVulture === null) world.nextWildVulture = world.time + WILD.vultureGap;
        else if (world.time >= world.nextWildVulture) {
          world.nextWildVulture = null;
          spawnVultures(leader);
        }
      } else if (level.biomeAt(Math.floor(meters)) === "desert" && meters >= level.baseAt) {
        if (world.nextVulture === null) world.nextVulture = meters + rand(20, VULTURE.every[1]);
        if (meters >= world.nextVulture) {
          spawnVultures(leader);
          world.nextVulture = meters + rand(VULTURE.every[0], VULTURE.every[1]);
        }
      }
    }

    for (const v of world.vultures) {
      v.t += dt;
      const p = v.target;
      const kind = VULTURE[v.kind];
      const lost = p.dead || p.caught;
      if (v.state === "wait") {
        if (v.t < 0) continue;
        if (p.dead && !p.caught) { v.t = 0; continue; } // not here yet: wait for them to come back
        v.t = 0;
        if (v.kind === "brown") { v.state = "circle"; Sound.play("vultureCry"); }
        else { v.state = "diving"; v.sx = p.x + 260; v.sy = 8; v.facing = -1; Sound.play("vultureScreech"); }
      }
      // Circling vultures don't give up when you die: they find where you come back and carry on.
      // (The fire getting you, or dying mid-dive, sends them off.)
      if ((p.caught || (p.dead && v.state !== "circle")) && v.state !== "leave" && v.state !== "carry" && v.state !== "wait") { v.state = "leave"; v.t = 0; }

      if (v.state === "circle") {
        // Glides in from the top right, then circles above the leader
        v.angle += dt * 3;
        if (p.dead) v.t -= dt; // the clock waits while they're gone
        const cx = (p.dead ? p.respawnX : p.x) + 50 + Math.cos(v.angle) * 34;
        const cy = 24 + Math.sin(v.angle) * 9;
        const ease = Math.min(1, v.t / 0.6);
        const px = v.x;
        v.x += (cx - v.x) * Math.min(1, dt * (2 + ease * 8));
        v.y += (cy - v.y) * Math.min(1, dt * (2 + ease * 8));
        v.facing = v.x >= px ? 1 : -1;
        if (v.t >= kind.circle) { v.state = "diving"; v.t = 0; v.sx = v.x; v.sy = v.y; Sound.play("vultureScreech"); }
      }
      if (v.state === "diving") {
        // Swoops down to the ground just in front of the leader (aiming for where they'll be)
        if (v.t < dt * 1.5) { v.ex = p.x + PHYSICS.runSpeed * kind.dive + 50; v.ey = skimY(v.ex, p.y + HITBOX_H - 5); }
        const u = Math.min(1, v.t / kind.dive);
        v.x = v.sx + (v.ex - v.sx) * u;
        v.y = v.sy + (v.ey - v.sy) * u * u;
        v.facing = -1;
        if (u >= 1) { v.state = "skim"; v.t = 0; }
      }
      if (v.state === "skim") {
        v.x -= kind.skim * dt;
        v.y = skimY(v.x, v.y);
        if (v.x < p.x - VIEW_W * 0.6) { v.state = "leave"; v.t = 0; }
      }
      if ((v.state === "diving" || v.state === "skim") && !p.held && !lost &&
          overlaps(p.x, p.y, HITBOX_W, HITBOX_H, v.x - 6, v.y - 3, 12, 6)) {
        if (v.kind === "black") {
          p.showHit("PECKED!", "#ff4d3d");
          Sound.play("vultureScreech");
          p.die();
          v.state = "leave";
        } else {
          p.showHit("SNATCHED!", "#e88a8a");
          Sound.play("vultureCry");
          p.held = true;
          p.inQuick = false;
          p.inRiver = null;
          p.vx = p.vy = 0;
          v.state = "carry";
        }
        v.t = 0;
      }
      if (v.state === "carry") {
        // Carries the player up and back, then drops them
        v.x -= VULTURE.carrySpeed * dt;
        const g = level.groundTop(v.x);
        v.y += ((g === null ? v.y : g - 34) - v.y) * Math.min(1, dt * 4);
        v.facing = -1;
        p.x = v.x - HITBOX_W / 2;
        p.y = v.y + 3;
        if (v.t >= VULTURE.carryTime && level.groundTop(v.x) !== null) {
          p.held = false;
          p.vx = 0;
          p.vy = 0;
          p.onGround = false;
          p.stun = 0.3;
          v.state = "leave";
          v.t = 0;
        }
      }
      if (v.state === "leave") {
        v.x -= 120 * dt;
        v.y -= 90 * dt;
        v.facing = -1;
        if (v.y < -30) v.done = true;
      }
    }
    world.vultures = world.vultures.filter((v) => !v.done);
  }

  function checkFire() {
    const caught = world.players.filter((p) => !p.caught && world.fire.x >= p.trackX + 2);
    if (caught.length === 0) return;

    for (const p of caught) p.burnUp();
    const left = world.players.filter((p) => !p.caught);
    if (world.solo) {
      world.winner = { solo: true, meters: Math.floor(world.players[0].trackX / TILE) };
      Sound.play("draw");
    } else if (left.length >= 2) { // (3 or 4 runners: you're out, the race goes on for the rest)
      for (const p of caught) p.showHit("OUT!", "#ff4d3d");
      Sound.play("draw");
      return;
    } else {
      world.winner = left.length === 1 ? left[0].name : null; // (the last one left wins; caught together: a draw)
      Sound.play(world.winner ? "win" : "draw");
    }
    world.state = "ending";
    world.endTimer = 1.5;
  }

  function frame(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    const isActive = () => ["countdown", "playing", "ending"].includes(world.state);
    if (isActive()) {
      accumulator += dt;
      // Stop as soon as the round is over, so leftover steps can't restart the ending
      while (accumulator >= STEP && isActive()) {
        step(STEP);
        accumulator -= STEP;
      }
    }
    if (!isActive()) accumulator = 0;
    Sound.setFire(fireLoudness(), dt);
    Renderer.render(ctx, world, dt);
    requestAnimationFrame(frame);
  }

  function setPaused(paused) {
    if (paused && world.state === "playing") world.state = "paused";
    else if (!paused && world.state === "paused") world.state = "playing";
    else return;
    callbacks.onPauseChange(world.state === "paused");
  }

  return {
    dreamDark,
    tripDark,
    flightDark,
    ruinsLeft,
    bombAt,
    firePortalGun, // (for tests)
    makeRuinsForTest: (g) => makeRuins(g), // (for tests)
    obstacleRuns,
    blackoutDark,
    sandstormStrength,
    floodSurface,
    monsoonStrength: () => (world.monsoon ? Math.max(0, Math.min(1, world.monsoon.t / 0.6, (MONSOON.time - world.monsoon.t) / 0.6)) : 0),
    snowstormStrength,
    init(canvasElement, cb) {
      canvas = canvasElement;
      canvas.width = VIEW_W * SCALE;
      canvas.height = (VIEW_H * 2 + DIVIDER) * SCALE;
      ctx = canvas.getContext("2d");
      callbacks = cb;
      Renderer.init();
      newWorld();

      // Load the pixel font so the canvas can use it
      if (document.fonts) document.fonts.load('12px "Press Start 2P"').catch(() => {});

      window.addEventListener("keydown", (e) => {
        if (GAME_KEYS.has(e.code) && this.isRunning()) e.preventDefault(); // stop arrows scrolling the page
        if (!e.repeat) {
          CONTROLS.forEach((c, i) => {
            if (e.code === c.jump) jumpQueued[i] = true;
            if (e.code === c.fire) fireQueued[i] = true;
          });
        }
        keys.add(e.code);
        if (GAME_KEYS.has(e.code)) Sound.unlock();
      });
      window.addEventListener("keyup", (e) => keys.delete(e.code));
      window.addEventListener("blur", () => {
        keys.clear();
        setPaused(true);
      });
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) setPaused(true);
      });

      lastTime = performance.now();
      requestAnimationFrame(frame);
    },

    // mode: 1 or 2 players
    start(players = 2, options = {}) {
      solo = players === 1;
      count = Math.max(1, Math.min(4, players));
      const picked = (options.biomeList || BIOMES).filter((b) => BIOMES.includes(b));
      const secret = (options.secretList || SECRET_BIOMES).filter((b) => SECRET_BIOMES.includes(b));
      // biomes off: the prairie. Every regular biome turned off: the race is in the secret biomes instead, as the
      // main course (no timer, no exit to reach: they just go on, like any biome)
      const allSecret = secret;
      biomeList = options.biomes !== true ? ["prairie"] : picked.length ? picked : allSecret.length ? allSecret : ["prairie"];
      // (a secret biome turned off in the picker: no way into it, with biomes on or off; v7.60: with biomes off it used to
      // be there whatever the picker said)
      sleepShrooms = secret.includes("forest");
      ruinsOn = secret.includes("ruins");
      campOn = secret.includes("camp");
      if (options.biomes === true && options.secretRegular && secret.length) { // secret biomes as regular ones: in the rotation like any biome, no sleep mushroom or portal
        biomeList = picked.concat(secret);
        sleepShrooms = false;
        ruinsOn = false;
        campOn = false;
      }
      wild = options.wild === true;
      const tune = options.tuning || {};
      TUNING.speed = tune.speed || 1; TUNING.jump = tune.jump || 1; TUNING.fire = tune.fire || 1;
      const L = Renderer.layout(count); // (3 and 4 players: a grid of full-size views, twice as wide)
      canvas.width = L.w * SCALE;
      canvas.height = L.h * SCALE;
      canvas.style.aspectRatio = count >= 3 ? "auto 800 / 484" : `auto ${canvas.width} / ${canvas.height}`; // (3 and 4: the grid fits inside the usual box, or fills the screen)
      Sound.unlock(); // the Start click lets the browser play sound
      // the first race after opening the website starts in the prairie (if it's one of them)
      const first = racesStarted++ === 0 && biomeList.includes("prairie");
      newWorld(first ? "prairie" : biomeList[Math.floor(Math.random() * biomeList.length)]);
      world.state = "countdown";
      Sound.play("beep");
      accumulator = 0;
    },

    togglePause() {
      setPaused(world.state !== "paused");
    },

    isRunning() {
      return ["countdown", "playing", "paused", "ending"].includes(world.state);
    },

    // Handy for poking at the game from the browser console: Game.world
    get world() {
      return world;
    },
  };
})();
