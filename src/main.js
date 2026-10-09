import "@fontsource/playfair-display/700.css";
import "@fontsource/playfair-display/900.css";
import "@fontsource/playfair-display/700-italic.css";
import "@fontsource/playfair-display/900-italic.css";
import "@fontsource/cormorant-garamond/500.css";
import "@fontsource/cormorant-garamond/500-italic.css";
import "@fontsource/cormorant-garamond/700.css";
import "./style.css";

import { readMidi } from "./midi.js";
import { buildChart, DIFFS } from "./convert.js";
import { Game, review } from "./game.js";
import { audioCtx, unlockAudio, loadPiano, playNote, stopAll, isSynth, playClick, playCough, playApplause } from "./audio.js";
import { createCrowd } from "./crowd.js";
import { createRenderer } from "./renderer.js";
import { SONGS } from "./songs.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const BOT = params.has("bot"); // el piano toca solo (para probar y para mostrar)
const LEAD_IN = 2.2; // segundos mínimos antes de la primera nota (más si la cuenta 1-2-3-4 lo pide)

const KEY_LANES = { KeyA: 0, KeyS: 1, KeyD: 2, KeyF: 3, KeyJ: 4, KeyK: 5, KeyL: 6, Semicolon: 7 };
const STAR = '<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><polygon points="12,2 15,9 22,9.5 16.5,14 18.5,21.5 12,17.5 5.5,21.5 7.5,14 2,9.5 9,9" fill="FILL" stroke="#8a2236" stroke-width="1.6"/></svg>';

const app = {
  songs: [...SONGS],
  sel: SONGS[0],
  diff: localStorage.getItem("tasti.diff") || "medium",
  raws: new Map(), // id → notas leídas del MIDI
  r: null,
  chart: null,
  game: null,
  startAt: 0,
  running: false,
  paused: false,
  held: new Set(),
  voices: new Map(), // carril → voz de la nota larga que se está manteniendo
  effects: [],
  words: [],
  autoIdx: 0,
  lastNow: 0,
  crowd: null,
  beatIdx: 0,
  endAt: 0,
  ovated: false,
  pointers: new Map(), // dedo → carril
  sideTap: { L: -9, R: -9 },
};
if (!DIFFS[app.diff]) app.diff = "medium";

/* ---------------- menú ---------------- */
function renderSongs() {
  const list = $("songList");
  list.innerHTML = "";
  for (const song of app.songs) {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.setAttribute("aria-pressed", String(song === app.sel));
    b.innerHTML = `<span><span class="t"></span><span class="c"></span></span><span class="d"></span>`;
    b.querySelector(".t").textContent = song.title;
    b.querySelector(".c").textContent = song.years ? `${song.composer}, ${song.years}` : song.composer;
    b.querySelector(".d").textContent = song.length || "";
    b.onclick = () => { app.sel = song; renderSongs(); renderStand(); };
    li.appendChild(b);
    list.appendChild(li);
  }
}

async function rawFor(song) {
  if (song.raw) return song.raw;
  if (app.raws.has(song.id)) return app.raws.get(song.id);
  const res = await fetch(song.file);
  if (!res.ok) throw new Error(`No se pudo abrir ${song.file}`);
  const raw = readMidi(await res.arrayBuffer(), song.title);
  app.raws.set(song.id, raw);
  return raw;
}

const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

async function renderStand() {
  const song = app.sel;
  $("selTitle").textContent = song.title;
  $("selComposer").textContent = [song.composer, song.work].filter(Boolean).join(", ");
  $("selQuip").textContent = song.quip || "";
  const box = $("diffs");
  box.innerHTML = "";
  for (const [key, d] of Object.entries(DIFFS)) {
    const b = document.createElement("button");
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(key === app.diff));
    b.textContent = d.label;
    b.onclick = () => { app.diff = key; localStorage.setItem("tasti.diff", key); renderStand(); };
    box.appendChild(b);
  }
  $("diffBlurb").textContent = DIFFS[app.diff].blurb;
  $("diffStats").textContent = "";
  try {
    const raw = await rawFor(song);
    if (song !== app.sel) return;
    const c = buildChart(raw, app.diff);
    if (!song.length) { song.length = fmtTime(raw.duration); renderSongs(); }
    const best = bestOf(song, app.diff);
    $("diffStats").textContent = `${c.notes.length} notas para ti, ${c.auto.length} suenan solas · ${fmtTime(raw.duration)}` + (best ? ` · récord ${best.toLocaleString("es-CO")}` : "");
  } catch (e) {
    $("diffStats").textContent = "No se pudo leer este MIDI.";
  }
}

$("midiFile").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const name = file.name.replace(/\.(mid|midi)$/i, "");
    const raw = readMidi(await file.arrayBuffer(), name);
    if (!raw.notes.length) throw new Error("vacío");
    const song = { id: `local-${name}`, title: raw.name !== "Sin título" ? raw.name : name, composer: "Tu archivo", raw, quip: "Pieza traída de casa. El público está expectante." };
    app.songs = app.songs.filter((s) => s.id !== song.id).concat(song);
    app.sel = song;
    renderSongs();
    renderStand();
  } catch {
    $("diffStats").textContent = "Ese archivo no parece un MIDI que se pueda tocar.";
  }
  e.target.value = "";
});

const bestKey = (song, diff) => `tasti.best.${song.id}.${diff}`;
const bestOf = (song, diff) => Number(localStorage.getItem(bestKey(song, diff)) || 0);

/* ---------------- partida ---------------- */
const now = () => audioCtx().currentTime - app.startAt - (audioCtx().outputLatency || audioCtx().baseLatency || 0);

async function start() {
  unlockAudio();
  stopAll();
  $("results").classList.add("hidden");
  $("pause").classList.add("hidden");
  $("loading").classList.remove("hidden");
  $("loadingText").textContent = "Afinando el piano…";
  $("loadingBar").style.width = "0";
  let raw;
  try {
    raw = await rawFor(app.sel);
  } catch {
    $("loading").classList.add("hidden");
    $("diffStats").textContent = "No se pudo abrir la pieza.";
    return;
  }
  const lo = Math.min(...raw.notes.map((n) => n.midi)), hi = Math.max(...raw.notes.map((n) => n.midi));
  await loadPiano(lo, hi, (p) => ($("loadingBar").style.width = `${Math.round(p * 100)}%`));
  $("loading").classList.add("hidden");

  app.chart = buildChart(raw, app.diff);
  app.game = new Game(app.chart);
  app.held.clear();
  app.voices.clear();
  app.effects = [];
  app.words = [];
  app.autoIdx = 0;
  app.crowd = createCrowd();
  app.beatIdx = 0;
  app.ovated = false;
  app.endAt = app.chart.duration + 1.2;
  app.paused = false;

  $("menu").classList.add("hidden");
  $("play").classList.remove("hidden");
  if (!app.r) app.r = createRenderer($("stage"));
  app.r.resize();
  $("hudPiece").textContent = `${app.sel.composer} · ${DIFFS[app.diff].label}`;
  $("hudPedalHint").textContent = app.r.phone ? "Toca a los dos lados de la pista" : "Espacio cuando pase la mitad";
  if (isSynth()) app.words.push({ text: "Piano sintetizado (sin conexión)", t: 0, life: 3, color: "#d9c79c" });

  const ctx = audioCtx();
  if (ctx.state === "suspended") await ctx.resume().catch(() => {});
  // cuenta 1-2-3-4 con metrónomo, en los cuatro pulsos antes de la primera nota
  const beats = raw.beats;
  const bl = Math.min(1.2, Math.max(0.3, beats.length > 1 ? beats[1][0] - beats[0][0] : 0.6));
  const first = Math.min(app.chart.notes[0]?.t ?? Infinity, app.chart.auto[0]?.t ?? Infinity);
  const b0 = beats.filter(([bt]) => bt <= first + 0.01).pop()?.[0] ?? first;
  const count = [4, 3, 2, 1].map((i) => b0 - i * bl);
  app.startAt = ctx.currentTime + Math.max(LEAD_IN, -count[0] + 0.5);
  count.forEach((ct, i) => {
    playClick(app.startAt + ct, i === 0);
    app.words.push({ text: String(i + 1), t: ct, life: bl * 0.9, color: "#fff3d2" });
  });
  app.lastNow = now();
  app.running = true;
  requestAnimationFrame(frame);
}

function laneDown(lane) {
  if (!app.running || app.paused || app.held.has(lane)) return;
  app.held.add(lane);
  if (!app.chart.lanes.includes(lane)) return;
  const t = now();
  const n = app.game.press(lane, t);
  if (!n) return;
  const voice = playNote(n.midi, n.vel, 0, n.hold ? n.hold : Math.max(n.dur, 0.3));
  if (n.hold) app.voices.set(lane, voice);
  app.effects.push({ lane, t, seed: Math.random() });
}

function laneUp(lane) {
  if (!app.held.delete(lane) || !app.running) return;
  const n = app.game.release(lane, now());
  const v = app.voices.get(lane);
  if (n && v) v.release();
  app.voices.delete(lane);
}

function pedal() {
  if (app.running && !app.paused && app.game.pressPedal()) app.words.push({ text: "¡Pedal!", t: now(), life: 0.9, color: "#fff1c0" });
}

function frame() {
  if (!app.running) return;
  if (app.paused) { requestAnimationFrame(frame); return; }
  const t = now();
  const dt = Math.max(0, Math.min(0.1, t - app.lastNow));
  app.lastNow = t;
  const { chart, game } = app;

  // lo que suena solo: se programa un poco antes para que caiga justo a tiempo
  const auto = chart.auto;
  while (app.autoIdx < auto.length && auto[app.autoIdx].t < t + 0.3) {
    const a = auto[app.autoIdx++];
    if (a.t + a.dur < t) continue;
    playNote(a.midi, a.vel * 0.9, app.startAt + a.t, a.dur);
  }

  if (BOT) {
    for (const n of game.notes) {
      if (n.grade || n.t > t) continue;
      if (n.t < t - 0.09) continue;
      laneDown(n.lane);
      const lane = n.lane;
      setTimeout(() => laneUp(lane), (n.hold ? n.hold * 1000 : 70));
    }
  }

  game.update(t, dt);
  for (const e of game.takeEvents()) {
    if (e.type === "hit") {
      app.words = app.words.filter((w) => !w.judge);
      const perfect = e.grade === "perfect";
      app.words.push({ judge: true, text: perfect ? "Perfecto" : "Bien", sub: perfect ? "" : e.offset < 0 ? "un poco pronto" : "un poco tarde", t, life: 0.55, color: perfect ? "#f6d27e" : "#e6d4a8" });
      if (game.combo > 0 && game.combo % 50 === 0) {
        app.words = app.words.filter((w) => !w.judge);
        app.words.push({ judge: true, text: `¡${game.combo} seguidas!`, t, life: 1.2, color: "#fff1c0" });
      }
      app.crowd.hit(t, game.combo);
    } else if (e.type === "miss") app.crowd.miss(t);
  }
  // fase del pulso, para que el público cabecee a tiempo
  const beats = chart.beats;
  while (app.beatIdx < beats.length - 2 && beats[app.beatIdx + 1][0] <= t) app.beatIdx++;
  const b = beats[app.beatIdx], bn = beats[app.beatIdx + 1];
  const beat = b && bn && t >= b[0] ? (t - b[0]) / (bn[0] - b[0]) : 0;
  app.crowd.update(t, dt, { combo: game.combo, pedalOn: game.pedalOn, beat, judged: game.judged });
  for (const snd of app.crowd.takeSounds()) {
    if (snd === "cough") playCough();
    else playApplause(snd === "ovation" ? 4.5 : 2.2, snd === "ovation" ? 1.3 : 0.8);
  }
  // final: si fue bien, ovación de pie antes de la reseña
  if (!app.ovated && t > chart.duration + 0.2) {
    app.ovated = true;
    if (game.accuracy >= 0.85 && game.judged >= game.notes.length * 0.5) {
      app.crowd.ovation(t, 16, true);
      app.endAt = chart.duration + 3.4;
    }
  }
  app.effects = app.effects.filter((e) => t - e.t < 0.4);
  app.words = app.words.filter((w) => t - w.t < w.life);
  const holds = game.notes.filter((n) => n.holding).map((n) => ({ lane: n.lane, t, hold: true }));

  app.r.draw({ now: t, chart, game, held: app.held, effects: app.effects.concat(holds), words: app.words, pedalOn: game.pedalOn, crowd: app.crowd });
  hud(t);

  if (t > app.endAt) return finish();
  requestAnimationFrame(frame);
}

let lastHud = "";
function hud(t) {
  const g = app.game;
  const key = `${g.score}|${g.combo}|${g.judged}|${Math.round(g.pedal * 100)}|${g.pedalOn}|${Math.floor(t)}`;
  if (key === lastHud) return;
  lastHud = key;
  $("hudScore").textContent = g.score.toLocaleString("es-CO");
  $("hudCombo").textContent = `×${g.combo}`;
  $("hudMult").textContent = `puntos ×${g.multiplier}`;
  $("hudAcc").textContent = `${Math.round(g.accuracy * 100)}%`;
  $("hudPedal").style.width = `${Math.round(g.pedal * 100)}%`;
  $("hudPedal").parentElement.classList.toggle("on", g.pedalOn);
  $("hudProgress").style.width = `${Math.max(0, Math.min(100, (t / app.chart.duration) * 100))}%`;
}

function finish() {
  app.running = false;
  const g = app.game;
  const rv = review(g);
  const prev = bestOf(app.sel, app.diff);
  const record = g.score > prev;
  if (record) localStorage.setItem(bestKey(app.sel, app.diff), String(g.score));

  $("resSub").textContent = `Reseña de la velada · ${app.sel.title}, nivel ${DIFFS[app.diff].label}`;
  $("resTitle").textContent = rv.title;
  $("resText").textContent = rv.text;
  $("resStars").innerHTML = Array.from({ length: 5 }, (_, i) => STAR.replace("FILL", i < rv.stars ? "#8a2236" : "none")).join("");
  $("resStars").setAttribute("aria-label", `${rv.stars} de 5 estrellas`);
  $("resScore").textContent = g.score.toLocaleString("es-CO");
  $("resRecord").classList.toggle("hidden", !record);
  const rows = [
    ["Precisión", `${Math.round(g.accuracy * 100)}%`],
    ["Mejor combo", `×${g.maxCombo}`],
    ["Perfectas", g.perfect],
    ["Bien", g.good],
    ["Falladas", g.miss],
    ["Notas que sonaron solas", app.chart.auto.length],
  ];
  $("resList").innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
  $("results").classList.remove("hidden");
  $("againBtn").focus();
}

function pause(on) {
  if (!app.running) return;
  app.paused = on;
  $("pause").classList.toggle("hidden", !on);
  const ctx = audioCtx();
  if (on) {
    for (const l of [...app.held]) laneUp(l);
    ctx.suspend();
    $("resumeBtn").focus();
  } else ctx.resume().then(() => { app.lastNow = now(); });
}

function quit() {
  app.running = false;
  app.paused = false;
  stopAll();
  audioCtx().resume().catch(() => {});
  $("pause").classList.add("hidden");
  $("results").classList.add("hidden");
  $("play").classList.add("hidden");
  $("menu").classList.remove("hidden");
  renderStand();
}

/* ---------------- controles ---------------- */
window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  if ($("play").classList.contains("hidden")) return;
  if (e.code === "Escape") { e.preventDefault(); if (app.running) pause(!app.paused); return; }
  if (e.code === "Space") { e.preventDefault(); pedal(); return; }
  const lane = KEY_LANES[e.code];
  if (lane !== undefined) { e.preventDefault(); laneDown(lane); }
});
window.addEventListener("keyup", (e) => {
  const lane = KEY_LANES[e.code];
  if (lane !== undefined) laneUp(lane);
});

const stage = $("stage");
function pointerLane(e) {
  const rect = stage.getBoundingClientRect();
  return app.r.laneAt(e.clientX - rect.left, e.clientY - rect.top);
}
stage.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  unlockAudio();
  const hit = pointerLane(e);
  if (hit.lane < 0) {
    // pedal en el celular: tocar a los dos lados de la pista casi a la vez
    const t = performance.now() / 1000;
    app.sideTap[hit.side] = t;
    if (Math.abs(app.sideTap.L - app.sideTap.R) < 0.35) pedal();
    return;
  }
  stage.setPointerCapture?.(e.pointerId);
  app.pointers.set(e.pointerId, hit.lane);
  laneDown(hit.lane);
});
stage.addEventListener("pointermove", (e) => {
  if (!app.pointers.has(e.pointerId)) return;
  const hit = pointerLane(e);
  const was = app.pointers.get(e.pointerId);
  if (hit.lane >= 0 && hit.lane !== was) {
    // deslizar el dedo: glissando
    laneUp(was);
    app.pointers.set(e.pointerId, hit.lane);
    laneDown(hit.lane);
  }
});
const endPointer = (e) => {
  if (!app.pointers.has(e.pointerId)) return;
  laneUp(app.pointers.get(e.pointerId));
  app.pointers.delete(e.pointerId);
};
stage.addEventListener("pointerup", endPointer);
stage.addEventListener("pointercancel", endPointer);
stage.addEventListener("contextmenu", (e) => e.preventDefault());

$("playBtn").onclick = start;
$("pauseBtn").onclick = () => pause(true);
$("resumeBtn").onclick = () => pause(false);
$("restartBtn").onclick = () => { app.running = false; start(); };
$("quitBtn").onclick = quit;
$("againBtn").onclick = start;
$("backBtn").onclick = quit;

document.addEventListener("visibilitychange", () => { if (document.hidden && app.running && !app.paused) pause(true); });
window.addEventListener("resize", () => {
  if (app.r && !$("play").classList.contains("hidden")) app.r.resize();
  checkRotate();
});

function checkRotate() {
  const touch = matchMedia("(pointer: coarse)").matches;
  $("rotate").classList.toggle("show", touch && innerHeight > innerWidth);
}

if (matchMedia("(pointer: coarse)").matches) $("keysHint").textContent = "Celular apoyado y en horizontal: cada carril es una tecla. Pedal: toca a los dos lados de la pista.";
renderSongs();
renderStand();
checkRotate();
document.fonts?.ready.then(() => { if (app.r) app.r.resize(); });
