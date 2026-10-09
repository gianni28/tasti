// Supabase por REST (sin librería): biblioteca, panel de admin, jugadores y clasificaciones.
import { SUPABASE_URL, SUPABASE_KEY, ONLINE } from "./config.js";

export { ONLINE };

async function req(path, opts = {}) {
  if (!ONLINE) throw new Error("Sin conexión con la biblioteca");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SUPABASE_KEY,
      // las claves nuevas (sb_publishable_…) no son JWT y van solo en apikey; las anon viejas (eyJ…) también van como Bearer
      ...(SUPABASE_KEY.startsWith("eyJ") ? { Authorization: `Bearer ${SUPABASE_KEY}` } : {}),
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { message: text.slice(0, 200) }; }
  if (!res.ok) {
    // tabla o función que no existe: falta correr el SQL en el proyecto
    if (["PGRST202", "PGRST205", "42P01", "42883"].includes(data?.code)) throw new Error("La base de datos aún no está instalada: corre supabase/tasti.sql en el SQL Editor de Supabase.");
    const msg = data?.message || data?.hint || `Error ${res.status}`;
    throw new Error(msg);
  }
  return data;
}
const rpc = (fn, args) => req(`rpc/${fn}`, { method: "POST", body: JSON.stringify(args) });

/* ---------- biblioteca ---------- */
const LIST_COLS = "id,title,composer,years,work,quip,duration,note_count,stars,created_at";

/** Canciones visibles, sin el MIDI (se baja al elegirla). */
export async function fetchLibrary() {
  return req(`songs?select=${LIST_COLS}&order=created_at.asc`);
}

/** El .mid de una canción, como ArrayBuffer. */
export async function fetchMidi(id) {
  const rows = await req(`songs?select=midi&id=eq.${encodeURIComponent(id)}`);
  if (!rows?.length) throw new Error("La pieza ya no está en la biblioteca");
  const bin = atob(rows[0].midi);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/* ---------- admin ---------- */
export const adminCheck = (code) => rpc("admin_check", { p_code: code });
export const adminSongs = (code) => rpc("admin_songs", { p_code: code });
export const adminSave = (code, song) => rpc("admin_save_song", { p_code: code, p_song: song });
export const adminDelete = (code, id) => rpc("admin_delete_song", { p_code: code, p_id: id });
export const adminSetCode = (oldCode, newCode) => rpc("admin_set_code", { p_old: oldCode, p_new: newCode });

export function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/* ---------- jugador: el nombre se pide una sola vez ---------- */
const TOKEN_KEY = "tasti.token", NAME_KEY = "tasti.name";
function token() {
  let t = localStorage.getItem(TOKEN_KEY);
  if (!t) {
    t = crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16));
    localStorage.setItem(TOKEN_KEY, t);
  }
  return t;
}
export const playerName = () => localStorage.getItem(NAME_KEY) || "";

/** Registra el nombre. Lanza "nombre_ocupado" si otra persona ya lo usa. */
export async function registerName(name) {
  const saved = await rpc("register_player", { p_token: token(), p_name: name });
  localStorage.setItem(NAME_KEY, saved);
  return saved;
}

export async function submitScore({ song, diff, score, accuracy, combo, notes }) {
  return rpc("submit_score", { p_token: token(), p_song: song, p_diff: diff, p_score: score, p_accuracy: accuracy, p_combo: combo, p_notes: notes });
}

export const topScores = (song, diff, limit = 10) => rpc("top_scores", { p_song: song, p_diff: diff, p_limit: limit });
export const topTotal = (limit = 10) => rpc("top_total", { p_limit: limit });
