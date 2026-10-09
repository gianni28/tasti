// Panel de admin: subir canciones (.mid) a la biblioteca, editarlas, esconderlas y borrarlas.
// Todo pasa por funciones de Supabase que piden el código de admin; el código no se guarda en el servidor
// en claro y en este navegador solo vive mientras la pestaña está abierta.
import * as net from "./net.js";
import { readMidi } from "./midi.js";
import { buildChart, DIFFS, starsFor } from "./convert.js";

const $ = (id) => document.getElementById(id);
const CODE_KEY = "tasti.adminCode";
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const stars = (n) => "★".repeat(n) + "☆".repeat(5 - n);
let hooks = null;
let code = "";
let pending = []; // archivos elegidos que todavía no se suben
let bound = false;

/** Identificador corto y estable a partir del título y el compositor */
function slug(title, composer) {
  const last = (composer || "").split(/\s+/).pop() || "";
  const s = `${last} ${title}`
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return s.length >= 2 ? s : `pieza-${Date.now().toString(36)}`;
}

/** Adivina título y compositor del nombre del archivo: "Mozart - Sonata K545.mid", "chopin_nocturne_op9_2.mid" */
function guess(fileName, raw) {
  const base = fileName.replace(/\.(mid|midi)$/i, "").replace(/[_]+/g, " ").trim();
  const known = { bach: ["J. S. Bach", "1685–1750"], mozart: ["W. A. Mozart", "1756–1791"], beethoven: ["L. van Beethoven", "1770–1827"], chopin: ["F. Chopin", "1810–1849"], satie: ["E. Satie", "1866–1925"], debussy: ["C. Debussy", "1862–1918"], schubert: ["F. Schubert", "1797–1828"], schumann: ["R. Schumann", "1810–1856"], liszt: ["F. Liszt", "1811–1886"], tchaikovsky: ["P. I. Chaikovski", "1840–1893"], haydn: ["J. Haydn", "1732–1809"], handel: ["G. F. Händel", "1685–1759"], vivaldi: ["A. Vivaldi", "1678–1741"], grieg: ["E. Grieg", "1843–1907"], brahms: ["J. Brahms", "1833–1897"], mendelssohn: ["F. Mendelssohn", "1809–1847"], scarlatti: ["D. Scarlatti", "1685–1757"], joplin: ["S. Joplin", "1868–1917"], clementi: ["M. Clementi", "1752–1832"], pachelbel: ["J. Pachelbel", "1653–1706"], rachmaninoff: ["S. Rajmáninov", "1873–1943"] };
  let composer = "", years = "", title = raw.name && raw.name !== "Sin título" ? raw.name : base;
  const lower = `${base} ${raw.name || ""}`.toLowerCase();
  for (const [k, [name, y]] of Object.entries(known)) {
    if (lower.includes(k)) { composer = name; years = y; break; }
  }
  const dash = base.split(/\s+-\s+/);
  if (dash.length === 2 && composer && dash[0].toLowerCase().includes(composer.split(" ").pop().toLowerCase())) title = dash[1];
  else if (composer && title.toLowerCase().startsWith(composer.split(" ").pop().toLowerCase())) title = title.slice(composer.split(" ").pop().length).replace(/^[\s\-:]+/, "");
  title = title.charAt(0).toUpperCase() + title.slice(1);
  return { title: title || base, composer, years };
}

export function openAdmin(h) {
  hooks = h;
  bind();
  $("admin").classList.remove("hidden");
  code = sessionStorage.getItem(CODE_KEY) || "";
  if (!net.ONLINE) {
    $("adminLogin").classList.remove("hidden");
    $("adminPanel").classList.add("hidden");
    $("adminLogin").innerHTML = `<p>El juego todavía no está conectado a Supabase. Corre <b>supabase/tasti.sql</b> en tu proyecto y pon la URL y la clave anon en <b>src/config.js</b> (o en las variables VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY de Netlify).</p>`;
    return;
  }
  if (code) enter(code, true);
  else showLogin();
}

function showLogin(msg = "") {
  $("adminLogin").classList.remove("hidden");
  $("adminPanel").classList.add("hidden");
  $("adminErr").textContent = msg;
  setTimeout(() => $("adminCode").focus(), 50);
}

async function enter(c, silent = false) {
  try {
    const ok = await net.adminCheck(c);
    if (!ok) { sessionStorage.removeItem(CODE_KEY); return showLogin(silent ? "" : "Ese no es el código."); }
  } catch (e) {
    return showLogin(`No se pudo conectar: ${e.message}`);
  }
  code = c;
  sessionStorage.setItem(CODE_KEY, c);
  $("adminLogin").classList.add("hidden");
  $("adminPanel").classList.remove("hidden");
  renderPending();
  renderSongs();
}

function bind() {
  if (bound) return;
  bound = true;
  $("adminEnter").onclick = () => enter($("adminCode").value.trim());
  $("adminCode").addEventListener("keydown", (e) => { if (e.key === "Enter") enter($("adminCode").value.trim()); });
  $("adminClose").onclick = () => { $("admin").classList.add("hidden"); if (location.hash === "#admin") history.replaceState(null, "", location.pathname + location.search); };
  $("adminFiles").addEventListener("change", (e) => { addFiles([...e.target.files]); e.target.value = ""; });
  const drop = $("adminDrop");
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); addFiles([...e.dataTransfer.files].filter((f) => /\.midi?$/i.test(f.name))); });
  $("adminChangeCode").onclick = async () => {
    const nc = $("adminNewCode").value.trim();
    if (nc.length < 4) { $("adminCodeMsg").textContent = "Mínimo 4 caracteres."; return; }
    try {
      await net.adminSetCode(code, nc);
      code = nc;
      sessionStorage.setItem(CODE_KEY, nc);
      $("adminNewCode").value = "";
      $("adminCodeMsg").textContent = "Código cambiado.";
    } catch (e) { $("adminCodeMsg").textContent = e.message; }
  };
}

async function addFiles(files) {
  for (const file of files) {
    try {
      const buffer = await file.arrayBuffer();
      const raw = readMidi(buffer, file.name);
      if (!raw.notes.length) throw new Error("No tiene notas");
      const g = guess(file.name, raw);
      const charts = Object.keys(DIFFS).map((k) => [k, buildChart(raw, k)]);
      pending.push({
        file, buffer, raw,
        meta: { title: g.title, composer: g.composer, years: g.years, work: "", quip: "" },
        stars: Object.fromEntries(charts.map(([k, c]) => [k, starsFor(c)])),
        counts: Object.fromEntries(charts.map(([k, c]) => [k, c.notes.length])),
        tracks: new Set(raw.notes.map((n) => n.track)).size,
        status: "",
      });
    } catch (e) {
      hooks.toast(`${file.name}: no se pudo leer (${e.message})`);
    }
  }
  renderPending();
}

function field(label, value, onInput, opts = {}) {
  const wrap = document.createElement("label");
  wrap.className = "af" + (opts.wide ? " wide" : "");
  const span = document.createElement("span");
  span.textContent = label;
  const input = document.createElement(opts.area ? "textarea" : "input");
  input.className = "field";
  input.value = value || "";
  if (opts.max) input.maxLength = opts.max;
  if (opts.placeholder) input.placeholder = opts.placeholder;
  input.oninput = () => onInput(input.value);
  wrap.append(span, input);
  return wrap;
}

function renderPending() {
  const box = $("adminPending");
  box.innerHTML = "";
  for (const p of pending) {
    const card = document.createElement("div");
    card.className = "admin-item pending";
    const head = document.createElement("div");
    head.className = "ai-head";
    head.innerHTML = `<b></b><span class="dim"></span>`;
    head.querySelector("b").textContent = p.file.name;
    head.querySelector("span").textContent = `${fmtTime(p.raw.duration)} · ${p.raw.notes.length} notas · ${p.tracks} pista${p.tracks === 1 ? "" : "s"}` + (p.tracks === 1 ? " (las manos se separan por altura)" : "");
    const grid = document.createElement("div");
    grid.className = "ai-grid";
    grid.append(
      field("Título", p.meta.title, (v) => (p.meta.title = v), { max: 120 }),
      field("Compositor", p.meta.composer, (v) => (p.meta.composer = v), { max: 80, placeholder: "W. A. Mozart" }),
      field("Años", p.meta.years, (v) => (p.meta.years = v), { max: 30, placeholder: "1756–1791" }),
      field("Obra", p.meta.work, (v) => (p.meta.work = v), { max: 60, placeholder: "K. 545" }),
      field("Frase del compositor", p.meta.quip, (v) => (p.meta.quip = v), { max: 200, wide: true, placeholder: "«…»  (sale en el menú)" })
    );
    const diffs = document.createElement("div");
    diffs.className = "ai-diffs";
    diffs.textContent = Object.entries(DIFFS).map(([k, d]) => `${d.label} ${stars(p.stars[k])} (${p.counts[k]})`).join(" · ");
    const actions = document.createElement("div");
    actions.className = "ai-actions";
    const up = document.createElement("button");
    up.className = "btn-gold small";
    up.textContent = "Subir";
    up.onclick = () => upload(p, up);
    const tryBtn = document.createElement("button");
    tryBtn.className = "btn-line small";
    tryBtn.textContent = "Probarla antes";
    tryBtn.onclick = () => { $("admin").classList.add("hidden"); hooks.tryLocal(p.file.name, p.buffer, p.meta); };
    const rm = document.createElement("button");
    rm.className = "link-btn";
    rm.textContent = "Quitar";
    rm.onclick = () => { pending = pending.filter((x) => x !== p); renderPending(); };
    const st = document.createElement("span");
    st.className = "hint";
    st.textContent = p.status;
    actions.append(up, tryBtn, rm, st);
    card.append(head, grid, diffs, actions);
    box.appendChild(card);
  }
}

async function upload(p, btn) {
  if (!p.meta.title.trim()) { p.status = "Falta el título."; return renderPending(); }
  btn.disabled = true;
  btn.textContent = "Subiendo…";
  const id = slug(p.meta.title, p.meta.composer);
  try {
    await net.adminSave(code, {
      id,
      title: p.meta.title.trim(), composer: p.meta.composer.trim(), years: p.meta.years.trim(), work: p.meta.work.trim(), quip: p.meta.quip.trim(),
      midi: net.toBase64(p.buffer), duration: Math.round(p.raw.duration * 10) / 10, note_count: p.raw.notes.length, stars: p.stars,
    });
    pending = pending.filter((x) => x !== p);
    hooks.toast(`«${p.meta.title}» ya está en la biblioteca`);
    renderPending();
    renderSongs();
    hooks.reloadLibrary();
  } catch (e) {
    p.status = e.message;
    btn.disabled = false;
    btn.textContent = "Subir";
    renderPending();
  }
}

async function renderSongs() {
  const box = $("adminSongs");
  box.innerHTML = `<p class="hint">Cargando…</p>`;
  let rows;
  try { rows = await net.adminSongs(code); } catch (e) { box.innerHTML = `<p class="err"></p>`; box.firstChild.textContent = e.message; return; }
  box.innerHTML = rows.length ? "" : `<p class="hint">Todavía no hay canciones subidas. El Preludio de Bach viene incluido en el juego.</p>`;
  for (const s of rows) {
    const item = document.createElement("div");
    item.className = "admin-item" + (s.hidden ? " is-hidden" : "");
    const head = document.createElement("div");
    head.className = "ai-head";
    head.innerHTML = `<b></b><span class="dim"></span>`;
    head.querySelector("b").textContent = s.title;
    head.querySelector("span").textContent = `${s.composer || "—"} · ${fmtTime(s.duration)}${s.hidden ? " · escondida" : ""}`;
    const actions = document.createElement("div");
    actions.className = "ai-actions";
    const edit = document.createElement("button");
    edit.className = "link-btn";
    edit.textContent = "Editar";
    const hide = document.createElement("button");
    hide.className = "link-btn";
    hide.textContent = s.hidden ? "Mostrar" : "Esconder";
    hide.onclick = async () => {
      try { await net.adminSave(code, { id: s.id, hidden: !s.hidden }); renderSongs(); hooks.reloadLibrary(); } catch (e) { hooks.toast(e.message); }
    };
    const del = document.createElement("button");
    del.className = "link-btn danger";
    del.textContent = "Borrar";
    del.onclick = async () => {
      if (!del.dataset.sure) { del.dataset.sure = "1"; del.textContent = "¿Seguro? Se borran también sus puntajes"; setTimeout(() => { delete del.dataset.sure; del.textContent = "Borrar"; }, 4000); return; }
      try { await net.adminDelete(code, s.id); hooks.toast(`«${s.title}» borrada`); renderSongs(); hooks.reloadLibrary(); } catch (e) { hooks.toast(e.message); }
    };
    actions.append(edit, hide, del);
    const form = document.createElement("div");
    form.className = "ai-grid hidden";
    const meta = { title: s.title, composer: s.composer, years: s.years, work: s.work, quip: s.quip };
    form.append(
      field("Título", meta.title, (v) => (meta.title = v), { max: 120 }),
      field("Compositor", meta.composer, (v) => (meta.composer = v), { max: 80 }),
      field("Años", meta.years, (v) => (meta.years = v), { max: 30 }),
      field("Obra", meta.work, (v) => (meta.work = v), { max: 60 }),
      field("Frase del compositor", meta.quip, (v) => (meta.quip = v), { max: 200, wide: true })
    );
    const save = document.createElement("button");
    save.className = "btn-gold small";
    save.textContent = "Guardar cambios";
    save.onclick = async () => {
      try { await net.adminSave(code, { id: s.id, ...meta }); hooks.toast("Guardado"); renderSongs(); hooks.reloadLibrary(); } catch (e) { hooks.toast(e.message); }
    };
    form.append(save);
    edit.onclick = () => form.classList.toggle("hidden");
    item.append(head, actions, form);
    box.appendChild(item);
  }
}
