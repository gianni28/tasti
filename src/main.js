import "@fontsource/playfair-display/700.css";
import "@fontsource/playfair-display/900.css";
import "@fontsource/playfair-display/700-italic.css";
import "@fontsource/playfair-display/900-italic.css";
import "@fontsource/cormorant-garamond/500.css";
import "@fontsource/cormorant-garamond/500-italic.css";
import "@fontsource/cormorant-garamond/700.css";
import "./style.css";

import { readMidi } from "./midi.js";
import { buildChart, DIFFS, starsFor } from "./convert.js";
import { Game, review } from "./game.js";
import { audioCtx, unlockAudio, loadPiano, playNote, stopAll, isSynth, playClick, playCough, playApplause, setVolumes } from "./audio.js";
import { createCrowd } from "./crowd.js";
import { createRenderer } from "./renderer.js";
import { buildTutorial } from "./tutorial.js";
import { portraitSVG, moodFor } from "./portrait.js";
import { loadSettings, saveSettings, keyName, DEFAULT_KEYS } from "./settings.js";
import { SONGS } from "./songs.js";
import * as net from "./net.js";
import { openAdmin } from "./admin.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const BOT = params.has("bot"); // el piano toca solo (para probar y para mostrar)
const LEAD_IN = 2.2; // segundos mínimos antes de la primera nota (más si la cuenta 1-2-3-4 lo pide)
const STAR = '<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><polygon points="12,2 15,9 22,9.5 16.5,14 18.5,21.5 12,17.5 5.5,21.5 7.5,14 2,9.5 9,9" fill="FILL" stroke="#8a2236" stroke-width="1.6"/></svg>';
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const fmtNum = (n) => Number(n).toLocaleString("es-CO");
const starsText = (n) => "★".repeat(n) + "☆".repeat(5 - n);
const isPhoneLayout = () => innerHeight < 520 && innerWidth > innerHeight;
const isTouch = () => matchMedia("(pointer: coarse)").matches;

const settings = loadSettings();
setVolumes(settings.pianoVol, settings.roomVol);

const app = {
  songs: SONGS.map((s) => ({ ...s, builtin: true })),
  sel: null,
  diff: localStorage.getItem("tasti.diff") || "medium",
  filter: "",
  raws: new Map(), // id → notas leídas del MIDI
  r: null,
  song: null, // la pieza que se está tocando
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
  mood: "",
  pointers: new Map(), // dedo → carril
  sideTap: { L: -9, R: -9 },
  previewing: false,
};
app.sel = app.songs[0];
if (!DIFFS[app.diff]) app.diff = "medium";

function toast(msg, ms = 2600) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.add("hidden"), ms);
}

/* ================= biblioteca ================= */
async function loadLibrary() {
  if (!net.ONLINE) return;
  $("libStatus").textContent = "Cargando la biblioteca…";
  try {
    const rows = await net.fetchLibrary();
    const remote = rows.map((r) => ({
      id: r.id, title: r.title, composer: r.composer, years: r.years, work: r.work, quip: r.quip,
      remote: true, length: r.duration ? fmtTime(r.duration) : "", stars: r.stars || {},
    }));
    const ids = new Set(remote.map((r) => r.id));
    const keepSel = app.sel?.id;
    app.songs = app.songs.filter((s) => !s.remote && !ids.has(s.id)).concat(remote);
    app.sel = app.songs.find((s) => s.id === keepSel) || app.songs[0];
    $("libStatus").textContent = "";
  } catch {
    $("libStatus").textContent = "No se pudo cargar la biblioteca. Por ahora están las piezas incluidas.";
  }
  renderSongs();
  renderStand();
}

async function rawFor(song) {
  if (song.raw) return song.raw;
  if (app.raws.has(song.id)) return app.raws.get(song.id);
  let buf;
  if (song.remote) buf = await net.fetchMidi(song.id);
  else {
    const res = await fetch(song.file);
    if (!res.ok) throw new Error(`No se pudo abrir ${song.file}`);
    buf = await res.arrayBuffer();
  }
  const raw = readMidi(buf, song.title);
  app.raws.set(song.id, raw);
  return raw;
}

/* ================= menú ================= */
function renderSongs() {
  const list = $("songList");
  const q = app.filter.trim().toLowerCase();
  $("searchWrap").classList.toggle("hidden", app.songs.length <= 6);
  list.innerHTML = "";
  const shown = app.songs.filter((s) => !q || `${s.title} ${s.composer}`.toLowerCase().includes(q));
  for (const song of shown) {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.setAttribute("aria-pressed", String(song === app.sel));
    b.innerHTML = `<span class="info"><span class="t"></span><span class="c"></span></span><span class="d"></span>`;
    b.querySelector(".t").textContent = song.title;
    b.querySelector(".c").textContent = song.years ? `${song.composer}, ${song.years}` : song.composer;
    const best = bestOf(song, app.diff);
    b.querySelector(".d").textContent = (best ? "★ " : "") + (song.length || "");
    b.onclick = () => { stopPreview(); app.sel = song; renderSongs(); renderStand(); };
    li.appendChild(b);
    list.appendChild(li);
  }
  if (!shown.length) list.innerHTML = `<li class="empty">Nada con «${q.replace(/</g, "&lt;")}»</li>`;
}
$("search").addEventListener("input", (e) => { app.filter = e.target.value; renderSongs(); });

let standToken = 0;
async function renderStand() {
  const song = app.sel;
  const my = ++standToken;
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
    b.onclick = () => { app.diff = key; localStorage.setItem("tasti.diff", key); renderSongs(); renderStand(); };
    box.appendChild(b);
  }
  $("diffBlurb").textContent = DIFFS[app.diff].blurb;
  $("diffStats").textContent = "";
  renderMiniBoard(song);
  try {
    const raw = await rawFor(song);
    if (my !== standToken) return;
    const c = buildChart(raw, app.diff);
    if (!song.length) { song.length = fmtTime(raw.duration); renderSongs(); }
    const stars = song.stars?.[app.diff] || starsFor(c);
    const best = bestOf(song, app.diff);
    $("diffStats").textContent = `${starsText(stars)} · ${c.notes.length} notas para ti · ${c.auto.length} suenan solas · ${fmtTime(raw.duration)}` + (best ? ` · tu récord ${fmtNum(best)}` : "");
  } catch {
    if (my === standToken) $("diffStats").textContent = "No se pudo leer esta pieza.";
  }
}

const boardCache = new Map();
async function renderMiniBoard(song) {
  const box = $("miniBoard");
  if (!net.ONLINE || song.local) { box.classList.add("hidden"); return; }
  const key = `${song.id}|${app.diff}`;
  let rows = boardCache.get(key);
  try {
    if (!rows || Date.now() - rows.at > 30000) {
      rows = { at: Date.now(), list: await net.topScores(song.id, app.diff, 5) };
      boardCache.set(key, rows);
    }
  } catch { box.classList.add("hidden"); return; }
  if (song !== app.sel || key !== `${app.sel.id}|${app.diff}`) return;
  fillBoard($("miniBoardList"), rows.list, "Nadie la ha tocado en este nivel. El escenario es tuyo.");
  box.classList.remove("hidden");
}

function fillBoard(ol, rows, empty) {
  const me = net.playerName().toLowerCase();
  ol.innerHTML = "";
  if (!rows.length) { ol.innerHTML = `<li class="empty">${empty}</li>`; return; }
  for (const r of rows) {
    const li = document.createElement("li");
    if (r.name.toLowerCase() === me) li.className = "me";
    li.innerHTML = `<span class="rk"></span><span class="nm"></span><span class="sc"></span>`;
    li.querySelector(".rk").textContent = r.rank;
    li.querySelector(".nm").textContent = r.name;
    li.querySelector(".sc").textContent = fmtNum(r.score ?? r.total);
    ol.appendChild(li);
  }
}

$("midiFile").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try { addLocalSong(file.name, await file.arrayBuffer()); } catch { toast("Ese archivo no parece un MIDI que se pueda tocar."); }
  e.target.value = "";
});

/** Una pieza que se prueba en este navegador, sin subirla. */
export function addLocalSong(fileName, buffer, meta = {}) {
  const name = fileName.replace(/\.(mid|midi)$/i, "");
  const raw = readMidi(buffer, name);
  if (!raw.notes.length) throw new Error("vacío");
  const song = {
    id: `local-${name}`, title: meta.title || (raw.name !== "Sin título" ? raw.name : name), composer: meta.composer || "Tu archivo",
    years: meta.years || "", work: meta.work || "", raw, local: true, quip: meta.quip || "Pieza traída de casa. El público está expectante.",
  };
  app.songs = app.songs.filter((s) => s.id !== song.id).concat(song);
  app.sel = song;
  renderSongs();
  renderStand();
  return song;
}

const bestKey = (song, diff) => `tasti.best.${song.id}.${diff}`;
const bestOf = (song, diff) => Number(localStorage.getItem(bestKey(song, diff)) || 0);

/* ---------- escuchar un fragmento ---------- */
async function togglePreview() {
  if (app.previewing) { stopPreview(); return; }
  unlockAudio();
  const song = app.sel;
  const btn = $("listenBtn");
  btn.setAttribute("aria-pressed", "true");
  btn.querySelector("span").textContent = "Afinando…";
  app.previewing = true;
  try {
    const raw = await rawFor(song);
    const first = raw.notes[0]?.t || 0;
    const part = raw.notes.filter((n) => n.t < first + 12);
    await loadPiano(Math.min(...part.map((n) => n.midi)), Math.max(...part.map((n) => n.midi)));
    if (!app.previewing || song !== app.sel) return;
    btn.querySelector("span").textContent = "Detener";
    const t0 = audioCtx().currentTime + 0.15 - first;
    for (const n of part) playNote(n.midi, n.vel, t0 + n.t, Math.min(n.dur, first + 12 - n.t));
    clearTimeout(app.previewTimer);
    app.previewTimer = setTimeout(stopPreview, 12500);
  } catch {
    stopPreview();
    toast("No se pudo reproducir esta pieza.");
  }
}
function stopPreview() {
  if (!app.previewing) return;
  app.previewing = false;
  clearTimeout(app.previewTimer);
  stopAll();
  $("listenBtn").setAttribute("aria-pressed", "false");
  $("listenBtn").querySelector("span").textContent = "Escuchar un fragmento";
}
$("listenBtn").onclick = togglePreview;

/* ================= partida ================= */
const now = () => {
  const c = audioCtx();
  return c.currentTime - app.startAt - (c.outputLatency || c.baseLatency || 0) - settings.latency / 1000;
};

async function start(tutorial = false) {
  stopPreview();
  unlockAudio();
  stopAll();
  app.running = false;
  for (const id of ["results", "pause", "nameBox"]) $(id).classList.add("hidden");
  $("loading").classList.remove("hidden");
  $("loadingText").textContent = "Afinando el piano…";
  $("loadingBar").style.width = "0";

  let chart;
  let song = tutorial ? { id: "ensayo", title: "Ensayo", composer: "L. van Beethoven", tutorial: true } : app.sel;
  try {
    if (tutorial) chart = buildTutorial(isPhoneLayout() || isTouch());
    else chart = buildChart(await rawFor(song), app.diff);
  } catch {
    $("loading").classList.add("hidden");
    toast("No se pudo abrir la pieza.");
    return;
  }
  const pitches = chart.notes.concat(chart.auto).map((n) => n.midi);
  await loadPiano(Math.min(...pitches), Math.max(...pitches), (p) => ($("loadingBar").style.width = `${Math.round(p * 100)}%`));
  $("loading").classList.add("hidden");

  chart.lookahead /= settings.speed;
  app.song = song;
  app.chart = chart;
  app.game = new Game(chart);
  app.held.clear();
  app.voices.clear();
  app.pointers.clear();
  app.effects = [];
  app.words = [];
  app.autoIdx = 0;
  app.beatIdx = 0;
  app.ovated = false;
  app.endAt = chart.duration + 1.2;
  app.paused = false;
  app.mood = "";

  $("menu").classList.add("hidden");
  $("play").classList.remove("hidden");
  if (!app.r) app.r = createRenderer($("stage"));
  app.r.resize();
  app.crowd = createCrowd({ phone: app.r.phone });
  $("hudPiece").textContent = tutorial ? "Ensayo" : `${song.composer} · ${DIFFS[app.diff].label}`;
  $("hudPedalHint").textContent = app.r.phone || isTouch() ? "Toca a los dos lados de la pista" : `${keyName(settings.pedalKey)} cuando pase la mitad`;
  $("coach").classList.toggle("hidden", !tutorial);
  $("coachText").textContent = "";
  $("coachSub").textContent = "";
  if (isSynth()) app.words.push({ text: "Piano sintetizado", sub: "no cargaron las muestras del piano", t: -1.5, life: 3, color: "#d9c79c" });

  const ctx = audioCtx();
  if (ctx.state === "suspended") await ctx.resume().catch(() => {});
  // cuenta 1-2-3-4 con metrónomo, en los cuatro pulsos antes de la primera nota
  const beats = chart.beats;
  const bl = Math.min(1.2, Math.max(0.3, beats.length > 1 ? beats[1][0] - beats[0][0] : 0.6));
  const first = Math.min(chart.notes[0]?.t ?? Infinity, chart.auto[0]?.t ?? Infinity);
  const b0 = beats.filter(([bt]) => bt <= first + 0.01).pop()?.[0] ?? first;
  const count = [4, 3, 2, 1].map((i) => b0 - i * bl);
  app.startAt = ctx.currentTime + Math.max(LEAD_IN, -count[0] + 0.5);
  count.forEach((ct, i) => {
    playClick(app.startAt + ct + settings.latency / 1000, i === 0);
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
  if (!app.running || app.paused) return;
  if (app.game.pressPedal()) app.words.push({ judge: true, text: "¡Pedal!", sub: "puntos dobles", t: now(), life: 1, color: "#fff1c0" });
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
    playNote(a.midi, a.vel * 0.9, app.startAt + a.t + settings.latency / 1000, a.dur);
  }

  if (BOT) {
    for (const n of game.notes) {
      if (n.grade || n.t > t || n.t < t - 0.09) continue;
      laneDown(n.lane);
      const lane = n.lane;
      setTimeout(() => laneUp(lane), n.hold ? n.hold * 1000 : 70);
    }
    if (game.pedal >= 0.5 && !game.pedalOn) pedal();
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
  if (chart.tutorial) coach(t);
  app.effects = app.effects.filter((e) => t - e.t < 0.4);
  app.words = app.words.filter((w) => t - w.t < w.life);
  const holds = game.notes.filter((n) => n.holding).map((n) => ({ lane: n.lane, t, hold: true }));

  app.r.draw({
    now: t, chart, game, held: app.held, effects: app.effects.concat(holds), words: app.words,
    pedalOn: game.pedalOn, crowd: app.crowd, keyLabels: settings.keys.map(keyName),
  });
  hud(t);

  if (t > app.endAt) return finish();
  requestAnimationFrame(frame);
}

function coach(t) {
  const steps = app.chart.steps;
  let cur = null;
  for (const s of steps) if (s.t <= t) cur = s;
  const show = cur && t - cur.t < 6;
  // en el paso del pedal, la barra se llena para que se pueda probar
  if (cur?.pedal && !cur.filled) { cur.filled = true; app.game.pedal = Math.max(app.game.pedal, 0.6); }
  $("coach").classList.toggle("off", !show);
  if (cur && $("coachText").textContent !== cur.text) {
    $("coachText").textContent = cur.text;
    $("coachSub").textContent = cur.sub || "";
  }
}

let lastHud = "";
function hud(t) {
  const g = app.game;
  const key = `${g.score}|${g.combo}|${g.judged}|${Math.round(g.pedal * 100)}|${g.pedalOn}|${Math.floor(t)}`;
  if (key === lastHud) return;
  lastHud = key;
  $("hudScore").textContent = fmtNum(g.score);
  $("hudCombo").textContent = `×${g.combo}`;
  $("hudMult").textContent = `puntos ×${g.multiplier}`;
  $("hudAcc").textContent = `${Math.round(g.accuracy * 100)}%`;
  $("hudPedal").style.width = `${Math.round(g.pedal * 100)}%`;
  $("hudPedal").parentElement.classList.toggle("on", g.pedalOn);
  $("hudPedal").parentElement.classList.toggle("ready", g.pedal >= 0.5 && !g.pedalOn);
  $("hudProgress").style.width = `${Math.max(0, Math.min(100, (t / app.chart.duration) * 100))}%`;
  const mood = moodFor(app.crowd.energy, g.combo);
  if (mood !== app.mood) {
    app.mood = mood;
    $("portrait").innerHTML = portraitSVG(mood);
  }
}

async function finish() {
  app.running = false;
  const g = app.game;
  const song = app.song;
  const tutorial = !!app.chart.tutorial;
  const rv = tutorial
    ? { stars: Math.max(1, review(g).stars), title: "Ensayo terminado", text: g.accuracy >= 0.75 ? "El maestro asiente. Ya estás listo para la velada." : "Nadie nace sabiendo. Otro ensayo y quedas listo." }
    : review(g);
  if (tutorial) localStorage.setItem("tasti.tutorialDone", "1");
  const prev = tutorial ? Infinity : bestOf(song, app.diff);
  const record = g.score > prev;
  if (record) localStorage.setItem(bestKey(song, app.diff), String(g.score));

  $("resSub").textContent = tutorial ? "Reseña del ensayo" : `Reseña de la velada · ${song.title}, nivel ${DIFFS[app.diff].label}`;
  $("resTitle").textContent = rv.title;
  $("resText").textContent = rv.text;
  $("resStars").innerHTML = Array.from({ length: 5 }, (_, i) => STAR.replace("FILL", i < rv.stars ? "#8a2236" : "none")).join("");
  $("resStars").setAttribute("aria-label", `${rv.stars} de 5 estrellas`);
  $("resScore").textContent = fmtNum(g.score);
  $("resRecord").classList.toggle("hidden", !record);
  const rows = [
    ["Precisión", `${Math.round(g.accuracy * 100)}%`],
    ["Mejor combo", `×${g.maxCombo}`],
    ["Perfectas", g.perfect],
    ["Bien", g.good],
    ["Falladas", g.miss],
  ];
  if (app.chart.auto.length) rows.push(["Notas que sonaron solas", app.chart.auto.length]);
  $("resList").innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
  $("againBtn").textContent = tutorial ? "Repetir el ensayo" : "Tocar de nuevo";
  $("backBtn").textContent = tutorial ? "Ir al programa" : "Otra pieza";
  $("resBoard").classList.add("hidden");
  $("resNameBtn").classList.add("hidden");
  $("results").classList.remove("hidden");
  $("againBtn").focus();

  if (!tutorial && net.ONLINE && !song.local && g.judged > 0) await postScore();
}

/* ---------- clasificación al terminar ---------- */
async function postScore() {
  const g = app.game, song = app.song, diff = app.diff;
  const box = $("resBoard");
  $("resBoardTitle").textContent = `Clasificación · ${DIFFS[diff].label}`;
  $("resBoardNote").textContent = "";
  if (!net.playerName()) {
    if (!localStorage.getItem("tasti.nameAsked")) {
      localStorage.setItem("tasti.nameAsked", "1"); // el nombre se pide una sola vez
      const ok = await askName();
      if (!ok) { $("resNameBtn").classList.remove("hidden"); return showBoardOnly(); }
    } else { $("resNameBtn").classList.remove("hidden"); return showBoardOnly(); }
  }
  try {
    const r = await net.submitScore({ song: song.id, diff, score: g.score, accuracy: Math.round(g.accuracy * 1000) / 1000, combo: g.maxCombo, notes: g.notes.length });
    boardCache.delete(`${song.id}|${diff}`);
    $("resBoardNote").textContent = r.improved ? `Quedaste en el puesto ${r.rank}.` : `Tu mejor puntaje sigue siendo ${fmtNum(r.best)} (puesto ${r.rank}).`;
  } catch (e) {
    $("resBoardNote").textContent = "No se pudo guardar el puntaje en la clasificación.";
  }
  await showBoardOnly();
  box.classList.remove("hidden");
}
async function showBoardOnly() {
  try {
    const rows = await net.topScores(app.song.id, app.diff, 5);
    fillBoard($("resBoardList"), rows, "Todavía nadie en este nivel.");
    $("resBoard").classList.remove("hidden");
  } catch {}
}
$("resNameBtn").onclick = async () => {
  if (await askName()) { $("resNameBtn").classList.add("hidden"); await postScore(); }
};

function askName() {
  return new Promise((resolve) => {
    const box = $("nameBox"), input = $("nameInput"), err = $("nameErr");
    err.textContent = "";
    input.value = "";
    box.classList.remove("hidden");
    setTimeout(() => input.focus(), 50);
    const done = (ok) => { box.classList.add("hidden"); $("nameForm").onsubmit = null; $("nameSkip").onclick = null; resolve(ok); };
    $("nameSkip").onclick = () => done(false);
    $("nameForm").onsubmit = async (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (name.length < 2) { err.textContent = "Mínimo 2 letras."; return; }
      try {
        await net.registerName(name);
        done(true);
      } catch (e2) {
        err.textContent = /nombre_ocupado/.test(e2.message) ? "Ese nombre ya lo tiene otra persona. Prueba con otro." : e2.message;
      }
    };
  });
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
  for (const id of ["pause", "results", "play", "nameBox"]) $(id).classList.add("hidden");
  $("menu").classList.remove("hidden");
  renderSongs();
  renderStand();
}

/* ================= controles ================= */
let remapIndex = -1; // tecla que se está cambiando en Ajustes (0-7 carriles, 8 pedal)
window.addEventListener("keydown", (e) => {
  if (remapIndex >= 0) { e.preventDefault(); assignKey(e.code); return; }
  if (calib.on) { calibTap(); return; }
  if (e.repeat) return;
  if ($("play").classList.contains("hidden")) return;
  if (e.code === "Escape") { e.preventDefault(); if (app.running) pause(!app.paused); return; }
  if (e.code === settings.pedalKey) { e.preventDefault(); pedal(); return; }
  const lane = settings.keys.indexOf(e.code);
  if (lane >= 0) { e.preventDefault(); laneDown(lane); }
});
window.addEventListener("keyup", (e) => {
  const lane = settings.keys.indexOf(e.code);
  if (lane >= 0) laneUp(lane);
});

const stage = $("stage");
function pointerLane(e) {
  const rect = stage.getBoundingClientRect();
  return app.r.laneAt(e.clientX - rect.left, e.clientY - rect.top);
}
stage.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  unlockAudio();
  if (!app.r) return;
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

$("playBtn").onclick = () => start(false);
$("tutorialBtn").onclick = () => start(true);
$("pauseBtn").onclick = () => pause(true);
$("resumeBtn").onclick = () => pause(false);
$("restartBtn").onclick = () => start(!!app.chart?.tutorial);
$("quitBtn").onclick = quit;
$("againBtn").onclick = () => start(!!app.chart?.tutorial);
$("backBtn").onclick = quit;

/* ================= salón de la fama ================= */
let boardTab = "total";
async function openBoard(tab = boardTab) {
  boardTab = tab;
  $("board").classList.remove("hidden");
  $("tabTotal").setAttribute("aria-selected", String(tab === "total"));
  $("tabPiece").setAttribute("aria-selected", String(tab === "piece"));
  const list = $("boardList");
  if (!net.ONLINE) {
    $("boardSub").textContent = "";
    list.innerHTML = `<li class="empty">La clasificación aparece cuando el juego está conectado a la biblioteca.</li>`;
    return;
  }
  $("boardSub").textContent = tab === "total" ? "La suma de los mejores puntajes de cada quien en todas las piezas." : `${app.sel.title} · ${DIFFS[app.diff].label}`;
  list.innerHTML = `<li class="empty">Cargando…</li>`;
  try {
    const rows = tab === "total" ? await net.topTotal(20) : app.sel.local ? [] : await net.topScores(app.sel.id, app.diff, 20);
    fillBoard(list, rows, tab === "total" ? "Todavía nadie ha tocado." : "Nadie la ha tocado en este nivel.");
  } catch {
    list.innerHTML = `<li class="empty">No se pudo cargar la clasificación.</li>`;
  }
}
$("boardBtn").onclick = () => openBoard();
$("tabTotal").onclick = () => openBoard("total");
$("tabPiece").onclick = () => openBoard("piece");
$("boardClose").onclick = () => $("board").classList.add("hidden");

/* ================= ajustes ================= */
function openSettings() {
  $("settings").classList.remove("hidden");
  $("setLatency").value = settings.latency;
  $("setLatencyVal").textContent = latencyText();
  $("setSpeed").value = String(settings.speed);
  $("setPiano").value = settings.pianoVol;
  $("setRoom").value = settings.roomVol;
  $("keysRow").classList.toggle("hidden", isTouch() && !matchMedia("(pointer: fine)").matches);
  renderKeys();
}
const latencyText = () => (settings.latency === 0 ? "(sin corrección)" : `(${settings.latency > 0 ? "+" : ""}${settings.latency} ms)`);
function renderKeys() {
  const grid = $("keyGrid");
  grid.innerHTML = "";
  const labels = ["Izq. 1", "Izq. 2", "Izq. 3", "Izq. 4", "Der. 1", "Der. 2", "Der. 3", "Der. 4", "Pedal"];
  labels.forEach((label, i) => {
    const b = document.createElement("button");
    b.className = "key-btn" + (remapIndex === i ? " waiting" : "");
    b.innerHTML = `<span class="k"></span><span class="l"></span>`;
    b.querySelector(".k").textContent = remapIndex === i ? "…" : keyName(i < 8 ? settings.keys[i] : settings.pedalKey);
    b.querySelector(".l").textContent = label;
    b.onclick = () => { remapIndex = remapIndex === i ? -1 : i; renderKeys(); };
    grid.appendChild(b);
  });
}
function assignKey(code) {
  if (code === "Escape") { remapIndex = -1; renderKeys(); return; }
  const keys = [...settings.keys, settings.pedalKey];
  const other = keys.indexOf(code);
  if (other >= 0 && other !== remapIndex) keys[other] = keys[remapIndex]; // si ya estaba usada, se intercambian
  keys[remapIndex] = code;
  settings.keys = keys.slice(0, 8);
  settings.pedalKey = keys[8];
  saveSettings(settings);
  remapIndex = -1;
  renderKeys();
  updateKeysHint();
}
$("setLatency").oninput = (e) => { settings.latency = Number(e.target.value); $("setLatencyVal").textContent = latencyText(); saveSettings(settings); };
$("setSpeed").onchange = (e) => { settings.speed = Number(e.target.value); saveSettings(settings); };
$("setPiano").oninput = (e) => { settings.pianoVol = Number(e.target.value); setVolumes(settings.pianoVol, settings.roomVol); saveSettings(settings); };
$("setRoom").oninput = (e) => { settings.roomVol = Number(e.target.value); setVolumes(settings.pianoVol, settings.roomVol); saveSettings(settings); };
$("keysReset").onclick = () => { settings.keys = [...DEFAULT_KEYS]; settings.pedalKey = "Space"; saveSettings(settings); renderKeys(); updateKeysHint(); };
$("settingsBtn").onclick = openSettings;
$("settingsClose").onclick = () => { remapIndex = -1; $("settings").classList.add("hidden"); };
$("adminBtn").onclick = () => { $("settings").classList.add("hidden"); openAdmin(adminHooks); };

/* ---------- calibración: tocar al ritmo del metrónomo ---------- */
const calib = { on: false, clicks: [], taps: [] };
$("calibrateBtn").onclick = () => {
  $("calib").classList.remove("hidden");
  $("calibText").textContent = "Pulsa cualquier tecla (o toca la pantalla) cada vez que suene el metrónomo. Son 8 golpes.";
  $("calibDots").innerHTML = "";
  $("calibStart").classList.remove("hidden");
};
$("calibStart").onclick = () => {
  unlockAudio();
  const ctx = audioCtx();
  const t0 = ctx.currentTime + 1;
  calib.clicks = Array.from({ length: 8 }, (_, i) => t0 + i * 0.6);
  calib.taps = [];
  calib.clicks.forEach((t, i) => playClick(t, i % 4 === 0));
  calib.on = true;
  $("calibStart").classList.add("hidden");
  $("calibDots").innerHTML = calib.clicks.map(() => "<span></span>").join("");
  setTimeout(endCalib, 1000 + 8 * 600 + 700);
};
function calibTap() {
  const c = audioCtx();
  const t = c.currentTime - (c.outputLatency || c.baseLatency || 0);
  calib.taps.push(t);
  const dots = $("calibDots").children;
  if (dots[calib.taps.length - 1]) dots[calib.taps.length - 1].classList.add("on");
}
$("calib").addEventListener("pointerdown", (e) => { if (calib.on && e.target.tagName !== "BUTTON") calibTap(); });
function endCalib() {
  calib.on = false;
  const offsets = calib.taps
    .map((t) => {
      const near = calib.clicks.reduce((a, b) => (Math.abs(b - t) < Math.abs(a - t) ? b : a));
      return t - near;
    })
    .filter((d) => Math.abs(d) < 0.25)
    .sort((a, b) => a - b);
  if (offsets.length < 5) {
    $("calibText").textContent = "No alcancé a medir bien. Intenta otra vez, pulsando con cada golpe.";
    $("calibStart").classList.remove("hidden");
    return;
  }
  const median = offsets[Math.floor(offsets.length / 2)];
  settings.latency = Math.max(-200, Math.min(200, Math.round((median * 1000) / 5) * 5));
  saveSettings(settings);
  $("setLatency").value = settings.latency;
  $("setLatencyVal").textContent = latencyText();
  $("calibText").textContent = settings.latency === 0 ? "Vas perfectamente a tiempo: no hace falta corregir nada." : `Listo: corregí ${Math.abs(settings.latency)} ms (pulsabas ${settings.latency > 0 ? "un poco tarde" : "un poco antes"}).`;
}
$("calibClose").onclick = () => { calib.on = false; $("calib").classList.add("hidden"); };

/* ================= admin ================= */
const adminHooks = {
  reloadLibrary: () => { app.raws.clear(); boardCache.clear(); return loadLibrary(); },
  tryLocal: (fileName, buffer, meta) => {
    try { addLocalSong(fileName, buffer, meta); } catch { toast("Ese MIDI no se pudo leer."); return; }
    start(false);
  },
  toast,
};
if (location.hash === "#admin") openAdmin(adminHooks);

/* ================= arranque ================= */
document.addEventListener("visibilitychange", () => { if (document.hidden && app.running && !app.paused) pause(true); });
window.addEventListener("resize", () => {
  if (app.r && !$("play").classList.contains("hidden")) app.r.resize();
  checkRotate();
});
function checkRotate() {
  $("rotate").classList.toggle("show", isTouch() && innerHeight > innerWidth);
}
function updateKeysHint() {
  if (isTouch() && !matchMedia("(pointer: fine)").matches) {
    $("keysHint").textContent = "Celular apoyado y en horizontal: cada carril es una tecla. Pedal: toca a los dos lados de la pista.";
    return;
  }
  const k = settings.keys.map(keyName);
  $("keysHint").innerHTML = "";
  const parts = [[k.slice(0, 4).join(" "), "mano izquierda"], [k.slice(4).join(" "), "mano derecha"], [keyName(settings.pedalKey), "pedal"], ["Esc", "pausa"]];
  parts.forEach(([key, what], i) => {
    const b = document.createElement("b");
    b.textContent = key;
    $("keysHint").append(i ? " · " : "Teclas: ", b, ` ${what}`);
  });
}
if (!localStorage.getItem("tasti.tutorialDone")) $("tutorialBtn").classList.add("pulse");

updateKeysHint();
renderSongs();
renderStand();
checkRotate();
loadLibrary();
document.fonts?.ready.then(() => { if (app.r) app.r.resize(); });
if ("serviceWorker" in navigator && import.meta.env.PROD) navigator.serviceWorker.register("/sw.js").catch(() => {});
