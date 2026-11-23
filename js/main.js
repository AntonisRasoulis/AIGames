// Website glue: connects the page (buttons, win counters) to the game.

const startButton = document.getElementById("start-button");
const pauseButton = document.getElementById("pause-button");
const overlay = document.getElementById("game-overlay");
const message = document.getElementById("game-message");
const canvas = document.getElementById("game-canvas");
const gameWrapper = document.querySelector(".game-wrapper");
const fullscreenButton = document.getElementById("fullscreen-button");
const scoreLine = document.getElementById("score-line");
const soundButton = document.getElementById("sound-button");
const wins = { RED: 0, BLUE: 0, GREEN: 0, YELLOW: 0 };
const COLOR_NAMES = { RED: "Red", BLUE: "Blue", GREEN: "Green", YELLOW: "Yellow" };
let gameLoaded = false;
let lastMode = 0; // (how many played the last race: 0 before the first)
// How many players: 1-4, picked with the 1 2 3 4 buttons in the start screen's top left (v7.61; remembered). 2 to start with
let playerCount = 2;
try { playerCount = Number(localStorage.getItem("fire-run-players")) || 2; } catch (e) { /* storage blocked */ }
if (!(playerCount >= 1 && playerCount <= 4)) playerCount = 2;
let biomes = false; // snow, desert and jungle biomes: off until you turn them on (remembered by the browser)
try { biomes = localStorage.getItem("fire-run-biomes") === "1"; } catch (e) { /* storage blocked */ }
let biomeList = BIOMES.slice(); // ...and which ones you get with them on (picked with the arrow next to the button)
// (read further down, once the secret biomes are known: at least one of all of them has to be on)
try {
  const saved = JSON.parse(localStorage.getItem("fire-run-biome-list"));
  const known = Array.isArray(saved) ? saved.filter((b) => BIOMES.includes(b)) : [];
  if (Array.isArray(saved)) biomeList = known; // (it can be empty now, if a secret biome is on)
} catch (e) { /* storage blocked, or nothing saved */ }
// The secret biomes (reached in special ways, like the enchanted forest through a sleep mushroom): which are on.
// Turn every regular biome off and the race is in the secret ones instead.
let secretList = SECRET_BIOMES.slice();
try {
  const saved = JSON.parse(localStorage.getItem("fire-run-secret-list"));
  if (Array.isArray(saved)) secretList = saved.filter((b) => SECRET_BIOMES.includes(b));
  // (a secret biome that's new since the list was saved starts on)
  const seen = JSON.parse(localStorage.getItem("fire-run-secret-known")) || ["forest"];
  for (const b of SECRET_BIOMES) if (!seen.includes(b) && !secretList.includes(b)) secretList.push(b);
  localStorage.setItem("fire-run-secret-known", JSON.stringify(SECRET_BIOMES));
} catch (e) { /* storage blocked, or nothing saved */ }
// (the biomes still being made start off every time the page opens, locked until the password's typed: see DEV_BIOMES)
let devUnlocked = false;
secretList = secretList.filter((b) => !DEV_BIOMES.includes(b));
try { localStorage.setItem("fire-run-secret-list", JSON.stringify(secretList)); } catch (e) { /* storage blocked */ }
const devCheck = (word) => { let h = 2166136261; for (const ch of word.trim().toLowerCase()) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h === DEV_LOCK; };
if (!biomeList.length && !secretList.length) biomeList = BIOMES.slice();
// ...and whether they're found in special ways (a sleep mushroom, a portal) or come up like any other biome (remembered)
let secretRegular = false;
try { secretRegular = localStorage.getItem("fire-run-secret-regular") === "1"; } catch (e) { /* storage blocked */ }
let wild = false; // Wild mode (the hard one): off until you pick it (remembered by the browser)
let easy = false; // ...or Easy (v8.12): no special dangers, a slower fire, no best saved
try { const m = localStorage.getItem("fire-run-mode"); wild = m === "wild"; easy = m === "easy"; } catch (e) { /* storage blocked */ }
// The presets (v8.9): each sets the biomes (and puts the multipliers back to 1x). Standard: every biome, the secret ones found in
// special ways. Basic: the main biomes only. Full: every biome, the secret ones coming up like any other.
const PRESETS = {
  standard: { name: "Standard", biomeList: BIOMES, secrets: true, secretRegular: false },
  basic: { name: "Basic", biomeList: BIOMES, secrets: false, secretRegular: false },
  full: { name: "Full", biomeList: BIOMES, secrets: true, secretRegular: true },
};
// (the secret biomes a preset turns on: all of them, but the ones still being made only once they're unlocked)
const presetSecrets = (pr) => (pr.secrets ? SECRET_BIOMES.filter((b) => devUnlocked || !DEV_BIOMES.includes(b)) : []);
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
// which preset today's settings are (null: your own mix, "Custom")
function currentPreset() {
  if (!biomes) return null;
  for (const [id, pr] of Object.entries(PRESETS)) {
    if (!sameSet(biomeList, pr.biomeList) || !sameSet(secretList, presetSecrets(pr))) continue;
    if (pr.secrets && secretRegular !== pr.secretRegular) continue;
    return id;
  }
  return null;
}
// best distance in 1-player mode: one for each preset, and for your own mix, in each mode (remembered by the browser; your own
// mix keeps the best from before there were presets). A race with a multiplier changed doesn't count.
const bestKey = (preset = currentPreset(), w = wild) => (preset ? `fire-run-best-${preset}` : "fire-run-best") + (w ? "-wild" : "");
const readBest = (key) => { try { return Number(localStorage.getItem(key)) || 0; } catch (e) { return 0; } };
let best = 0;
function loadBest() { best = readBest(bestKey()); }
loadBest();
let race = null; // (what the race was started with: { key, preset, tuned })

document.getElementById("year").textContent = new Date().getFullYear();
document.getElementById("game-version").textContent = "v" + GAME_VERSION; // (set in config.js)

const gameCallbacks = {
  onGameOver(winner) {
    if (winner && winner.solo) {
      // 1 player: how far did you get? (the best for what the race was started with: its preset and mode; not if a
      // multiplier was changed)
      const r = race || { key: bestKey(), preset: currentPreset(), tuned: false, wild };
      const before = readBest(r.key), record = !r.tuned && !r.easy && winner.meters > before;
      if (record) { try { localStorage.setItem(r.key, String(winner.meters)); } catch (e) { /* storage blocked */ } }
      loadBest();
      showPresets();
      message.textContent = record ? `New record: ${winner.meters} m!` : `You reached ${winner.meters} m`;
      message.className = "game-message red";
      const label = [r.preset ? PRESETS[r.preset].name : "Custom", r.wild ? "Wild" : ""].filter(Boolean).join(", ");
      scoreLine.textContent = r.easy ? "Easy mode: no best saved" : `Best (${label}): ${Math.max(before, record ? winner.meters : 0)} m` + (r.tuned ? " · multipliers changed: not saved" : "");
      scoreLine.hidden = false;
      showOverlay();
      return;
    }
    if (winner) {
      wins[winner]++;
      document.getElementById(winner.toLowerCase() + "-wins").textContent = wins[winner];
      message.textContent = `${COLOR_NAMES[winner]} wins!`;
      message.className = "game-message " + winner.toLowerCase();
    } else {
      message.textContent = "It's a draw!";
      message.className = "game-message";
    }
    // The win counters are hidden in fullscreen, so show the score on the game-over screen too
    scoreLine.innerHTML = Object.keys(COLOR_NAMES).slice(0, Math.max(2, lastMode)).map((k) => `<span class="${k.toLowerCase()}">${COLOR_NAMES[k]} ${wins[k]}</span>`).join(" &middot; ");
    scoreLine.hidden = false;
    showOverlay();
  },
  onPauseChange(paused) {
    pauseButton.textContent = paused ? "Resume" : "Pause";
  },
};

// If the game's files are missing or broken, say so instead of leaving a dead Start button.
// (The button starts out disabled in index.html and is only switched on here.)
try {
  Game.init(canvas, gameCallbacks);
  gameLoaded = true;
  startButton.disabled = false;
} catch (error) {
  const box = document.getElementById("game-error");
  box.textContent = "The game couldn't load. Make sure the whole folder was downloaded and unzipped, " +
    `then open index.html again. (Details: ${error.message})`;
  box.hidden = false;
}

function showOverlay() {
  startButton.textContent = lastMode === playerCount ? "Play again" : "Play";
  overlay.classList.remove("hidden");
  pauseButton.disabled = true;
  startButton.focus();
}

// The 1 2 3 4 buttons: how many play (Green's and Yellow's keys and win counters only show when they're in)
function showPlayerCount() {
  for (const b of document.querySelectorAll(".count-choice")) b.setAttribute("aria-pressed", String(Number(b.dataset.count) === playerCount));
  for (const el of document.querySelectorAll("[data-from]")) el.hidden = playerCount < Number(el.dataset.from);
  startButton.textContent = lastMode && lastMode === playerCount ? "Play again" : "Play";
}
for (const b of document.querySelectorAll(".count-choice")) b.addEventListener("click", () => {
  playerCount = Number(b.dataset.count);
  try { localStorage.setItem("fire-run-players", String(playerCount)); } catch (e) { /* storage blocked */ }
  showPlayerCount();
  b.blur();
});
showPlayerCount();

function startGame(players) {
  lastMode = players;
  overlay.classList.add("hidden");
  pauseButton.disabled = false;
  pauseButton.textContent = "Pause";
  startButton.blur();
  // 3 and 4 players: a grid of four full-size screens, best seen in fullscreen (it goes fullscreen as the race starts)
  gameWrapper.classList.toggle("grid", players >= 3);
  if (players >= 3 && document.fullscreenEnabled && !document.fullscreenElement) gameWrapper.requestFullscreen().catch(() => {});
  canvas.scrollIntoView({ behavior: "smooth", block: "center" });
  const tuning = readTuning();
  race = { key: bestKey(), preset: currentPreset(), wild, easy, tuned: Object.values(tuning).some((v) => Math.abs(v - 1) > 1e-6) };
  Game.start(players, { biomes, biomeList, secretList, secretRegular, wild, easy, tuning });
}

startButton.addEventListener("click", () => startGame(playerCount));

// The multipliers on the start screen: speed, jump and the fire wall (remembered by the browser)
const TUNE_IDS = ["speed", "jump", "fire"];
function readTuning() { const t = {}; for (const k of TUNE_IDS) t[k] = Number(document.getElementById("tune-" + k).value); return t; }
for (const k of TUNE_IDS) {
  const input = document.getElementById("tune-" + k), out = document.getElementById("tune-" + k + "-out");
  try { const saved = localStorage.getItem("fire-run-tune-" + k); if (saved) input.value = saved; } catch (e) { /* storage blocked */ }
  const show = () => { out.textContent = Number(input.value).toFixed(1).replace(/\.0$/, "") + "x"; };
  input.addEventListener("input", () => { show(); try { localStorage.setItem("fire-run-tune-" + k, input.value); } catch (e) { /* storage blocked */ } });
  input.showValue = show;
  show();
}
function resetTuning() {
  for (const k of TUNE_IDS) {
    const input = document.getElementById("tune-" + k);
    input.value = "1";
    input.showValue();
    try { localStorage.setItem("fire-run-tune-" + k, "1"); } catch (e) { /* storage blocked */ }
  }
}

// ...behind a button, like the biome picker: click it to open them (anywhere else, or Escape, closes them)
const tuneButton = document.getElementById("tune-button"), tunePanel = document.getElementById("tune-panel");
function openTune(open) { tunePanel.hidden = !open; tuneButton.setAttribute("aria-expanded", String(open)); }
tuneButton.addEventListener("click", () => openTune(tunePanel.hidden));
document.addEventListener("click", (e) => { if (!tunePanel.hidden && !e.target.closest(".tuning")) openTune(false); });
document.addEventListener("keydown", (e) => { if (e.code === "Escape") openTune(false); });

// The presets: a button beside the multipliers, opening the three (the one matching today's settings lit up, each with its
// best distances). Picking one sets the biomes, Biomes on, and the multipliers back to 1x (the mode stays as it is)
const presetButton = document.getElementById("preset-button"), presetPanel = document.getElementById("preset-panel");
function openPresets(open) { presetPanel.hidden = !open; presetButton.setAttribute("aria-expanded", String(open)); }
function showPresets() {
  const now = currentPreset();
  presetButton.firstChild.textContent = `Presets: ${now ? PRESETS[now].name : "Custom"} `;
  for (const b of presetPanel.querySelectorAll(".preset-choice")) {
    const id = b.dataset.preset;
    b.setAttribute("aria-pressed", String(id === now));
    b.querySelector(".preset-best").textContent = `Best: ${readBest(bestKey(id, false))} m · Wild: ${readBest(bestKey(id, true))} m`;
  }
}
function applyPreset(id) {
  const pr = PRESETS[id];
  biomes = true;
  biomeList = pr.biomeList.slice();
  secretList = presetSecrets(pr);
  secretRegular = pr.secretRegular;
  try {
    localStorage.setItem("fire-run-biomes", "1");
    localStorage.setItem("fire-run-biome-list", JSON.stringify(biomeList));
    localStorage.setItem("fire-run-secret-list", JSON.stringify(secretList));
    localStorage.setItem("fire-run-secret-regular", secretRegular ? "1" : "0");
  } catch (e) { /* storage blocked */ }
  resetTuning();
  showBiomes();
  loadBest();
  scoreLine.hidden = true; // (the last race's best was for other settings)
}
presetButton.addEventListener("click", () => openPresets(presetPanel.hidden));
presetPanel.addEventListener("click", (e) => { const b = e.target.closest(".preset-choice"); if (b) { applyPreset(b.dataset.preset); b.blur(); } });
document.addEventListener("click", (e) => { if (!presetPanel.hidden && !e.target.closest(".presets")) openPresets(false); });
document.addEventListener("keydown", (e) => { if (e.code === "Escape") openPresets(false); });

const biomesButton = document.getElementById("biomes-button");
const biomeArrow = document.getElementById("biome-arrow");
const biomePanel = document.getElementById("biome-panel");
const secretModeButton = document.getElementById("secret-mode");
secretModeButton.addEventListener("click", () => {
  secretRegular = !secretRegular;
  try { localStorage.setItem("fire-run-secret-regular", secretRegular ? "1" : "0"); } catch (e) { /* storage blocked */ }
  showBiomes();
});
function showBiomes() {
  biomesButton.textContent = `Biomes: ${biomes ? "on" : "off"}`;
  biomesButton.setAttribute("aria-pressed", String(biomes));
  biomeArrow.hidden = !biomes; // the arrow to pick which biomes is only there with them on
  if (!biomes) openBiomePanel(false);
  const total = biomeList.length + secretList.length;
  for (const chip of biomePanel.querySelectorAll(".biome-choice")) {
    const on = (chip.dataset.secret ? secretList : biomeList).includes(chip.dataset.biome);
    chip.setAttribute("aria-pressed", String(on));
    chip.classList.toggle("locked", DEV_BIOMES.includes(chip.dataset.biome) && !devUnlocked);
    if (!chip.dataset.secret) chip.title = on && total === 1 ? "At least one biome has to be on" : "";
  }
  secretModeButton.querySelector(".secret-mode-label").textContent = secretRegular ? "REGULAR" : "SPECIAL";
  secretModeButton.setAttribute("aria-pressed", String(secretRegular));
  if (typeof showPresets === "function") { showPresets(); loadBest(); } // (which preset this is now, and its best)
}
function openBiomePanel(open) {
  biomePanel.hidden = !open;
  if (!open && typeof devBox !== "undefined") devBox.hidden = true;
  biomeArrow.setAttribute("aria-expanded", String(open));
}
biomesButton.addEventListener("click", () => {
  biomes = !biomes;
  try { localStorage.setItem("fire-run-biomes", biomes ? "1" : "0"); } catch (e) { /* storage blocked */ }
  showBiomes();
});
biomeArrow.addEventListener("click", () => openBiomePanel(biomePanel.hidden));
biomePanel.addEventListener("click", (e) => {
  const chip = e.target.closest(".biome-choice");
  if (!chip) return;
  const biome = chip.dataset.biome, secret = !!chip.dataset.secret;
  if (DEV_BIOMES.includes(biome) && !devUnlocked) { askPassword(biome); return; } // (still being made: locked)
  const list = secret ? secretList : biomeList, all = secret ? SECRET_BIOMES : BIOMES;
  let next;
  if (list.includes(biome)) {
    if (biomeList.length + secretList.length === 1) return; // always at least one (a secret one counts)
    next = list.filter((b) => b !== biome);
  } else next = all.filter((b) => b === biome || list.includes(b));
  if (secret) secretList = next; else biomeList = next;
  try {
    localStorage.setItem("fire-run-biome-list", JSON.stringify(biomeList));
    localStorage.setItem("fire-run-secret-list", JSON.stringify(secretList));
  } catch (e) { /* storage blocked */ }
  showBiomes();
});
// A biome still being made: a little password box under the chips. Right: unlocked for this visit, and it's turned on
const devBox = document.getElementById("dev-lock"), devInput = document.getElementById("dev-password"), devMsg = document.getElementById("dev-lock-msg");
let devFor = null;
function askPassword(biome) {
  devFor = biome;
  devBox.hidden = false;
  const name = BIOME_NAMES[biome] || biome; devMsg.textContent = `${name[0].toUpperCase() + name.slice(1)} is still being made. Password:`;
  devMsg.classList.remove("wrong");
  devInput.value = "";
  devInput.focus();
}
document.getElementById("dev-lock-form").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!devCheck(devInput.value)) { devMsg.textContent = "WRONG PASSWORD"; devMsg.classList.add("wrong"); devInput.select(); return; }
  devUnlocked = true;
  devBox.hidden = true;
  if (devFor && !secretList.includes(devFor)) secretList = SECRET_BIOMES.filter((b) => b === devFor || secretList.includes(b));
  try { localStorage.setItem("fire-run-secret-list", JSON.stringify(secretList)); } catch (err) { /* storage blocked */ }
  showBiomes();
});
// click anywhere else (or press Escape) to close it
document.addEventListener("click", (e) => { if (!biomePanel.hidden && !e.target.closest(".biome-picker")) openBiomePanel(false); });
document.addEventListener("keydown", (e) => { if (e.code === "Escape") openBiomePanel(false); });
showBiomes();

const modeButton = document.getElementById("mode-button");
function showMode() {
  modeButton.textContent = `Mode: ${easy ? "Easy" : wild ? "Wild" : "Normal"}`;
  modeButton.setAttribute("aria-pressed", String(wild || easy));
  modeButton.classList.toggle("wild", wild);
  modeButton.classList.toggle("easy", easy);
}
modeButton.addEventListener("click", () => { // Normal, then Wild, then Easy, then back to Normal
  if (easy) easy = false;
  else if (wild) { wild = false; easy = true; }
  else wild = true;
  try { localStorage.setItem("fire-run-mode", easy ? "easy" : wild ? "wild" : "normal"); } catch (e) { /* storage blocked */ }
  loadBest();
  showMode();
});
showMode();
pauseButton.addEventListener("click", () => {
  Game.togglePause();
  pauseButton.blur(); // so the space bar / Enter don't press it again
});

window.addEventListener("keydown", (e) => {
  if (e.target.closest && e.target.closest("input")) return; // (typing in the password box: no shortcuts)
  if (gameLoaded && (e.code === "KeyP" || e.code === "Escape") && Game.isRunning()) Game.togglePause();
  if (gameLoaded && e.code === "KeyM") toggleSound();
  if (e.code === "KeyF" && document.fullscreenEnabled && !(gameLoaded && Game.isRunning() && Game.world.players.length >= 3)) toggleFullscreen(); // (F is Green's left key)
});

// ---- Sound ----

function showSoundState() {
  soundButton.textContent = Sound.muted ? "Sound: off" : "Sound: on";
}

function toggleSound() {
  Sound.unlock();
  Sound.toggleMute();
  showSoundState();
}

showSoundState();
soundButton.addEventListener("click", () => {
  toggleSound();
  soundButton.blur(); // so the space bar / Enter don't press it again
});

// ---- Fullscreen ----

function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    gameWrapper.requestFullscreen().catch(() => {}); // e.g. blocked by the browser
  }
}

if (document.fullscreenEnabled) {
  fullscreenButton.hidden = false;
  fullscreenButton.addEventListener("click", () => {
    toggleFullscreen();
    fullscreenButton.blur(); // so the space bar / Enter don't press it again
  });
  document.addEventListener("fullscreenchange", () => {
    const isFullscreen = document.fullscreenElement === gameWrapper;
    fullscreenButton.textContent = isFullscreen ? "Exit fullscreen" : "Fullscreen";
    // Leaving fullscreen with Esc mid-race pauses the game, so nobody gets caught by surprise
    if (!isFullscreen && gameLoaded && Game.isRunning() && Game.world.state === "playing") Game.togglePause();
  });
}
