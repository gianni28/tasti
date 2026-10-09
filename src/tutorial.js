// El Ensayo: una pieza corta que enseña a tocar, paso a paso, con indicaciones en pantalla.
// Termina con el Himno de la alegría (Beethoven), con la izquierda acompañando.
import { buildChart } from "./convert.js";

const BPM = 92;
const B = 60 / BPM; // un pulso

// carriles 0-3 izquierda (Do3 Re3 Mi3 Fa3), 4-7 derecha (Do5 Re5 Mi5 Fa5)
const L = [48, 50, 52, 53];
const R = [72, 74, 76, 77];

export function buildTutorial(phone) {
  const notes = [];
  const steps = [];
  let t = 0;
  const note = (lane, beats = 0, vel = 0.62) => {
    const midi = lane < 4 ? L[lane] : R[lane - 4];
    notes.push({ t, lane, midi, vel, dur: Math.max(B * 0.9, beats * B), hold: beats ? beats * B : 0 });
  };
  const rest = (beats) => { t += beats * B; };
  const step = (text, sub, extra = {}) => { steps.push({ t: t - 3 * B, text, sub, ...extra }); };

  const right = phone ? "los 4 carriles de la derecha" : "J · K · L · Ñ";
  const left = phone ? "los 4 de la izquierda" : "A · S · D · F";

  rest(4);
  step(`Mano derecha: ${right}`, "Pisa cuando la nota quede justo encima de su botón dorado");
  for (const lane of [4, 5, 6, 7, 7, 6, 5, 4]) { note(lane); rest(2); }
  rest(2);
  step(`Mano izquierda: ${left}`, "Igual que antes, ahora con la otra mano");
  for (const lane of [0, 1, 2, 3, 3, 2, 1, 0]) { note(lane); rest(2); }
  rest(2);
  step("Las dos manos", "Primero se turnan, después van juntas");
  for (const [a, b] of [[0, 4], [1, 5], [2, 6], [3, 7]]) { note(a); rest(1); note(b); rest(1); }
  for (const [a, b] of [[0, 7], [1, 6], [2, 5], [3, 4]]) { note(a); note(b); rest(2); }
  rest(2);
  step("Notas largas", phone ? "Deja el dedo apoyado hasta que termine la cola" : "Mantén la tecla hasta que termine la cola");
  for (const lane of [4, 6, 1, 3]) { note(lane, 2); rest(3); }
  rest(1);
  step(phone ? "El pedal: toca a los dos lados de la pista a la vez" : "El pedal: Espacio", "Te llené la barra: písalo ahora y tus puntos se duplican", { pedal: true });
  rest(4);

  // Himno de la alegría: Mi Mi Fa Sol Sol Fa Mi Re Do Do Re Mi Mi Re Re
  step("Ahora, una pieza de verdad", "El Himno de la alegría, de Beethoven");
  // la melodía y el bajo pasan por el mismo conversor que las piezas de verdad
  const tune = [76, 76, 77, 79, 79, 77, 76, 74, 72, 72, 74, 76, 76, 74, 74, 76, 76, 77, 79, 79, 77, 76, 74, 72, 72, 74, 76, 74, 72, 72];
  const lens = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.5, 0.5, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.5, 0.5, 2];
  const raw = [];
  let pos = 0; // en pulsos
  tune.forEach((m, i) => {
    raw.push({ t: pos * B, dur: lens[i] * B * 0.95, midi: m, vel: 0.66, track: 1 });
    pos += lens[i];
  });
  for (let bar = 0; bar * 4 < pos; bar++) {
    raw.push({ t: bar * 4 * B, dur: B * 3.6, midi: [48, 48, 55, 48, 48, 48, 55, 48][bar % 8], vel: 0.5, track: 0 });
  }
  raw.sort((a, b) => a.t - b.t);
  const hymn = buildChart({ name: "Himno", notes: raw, beats: [], duration: pos * B }, "expert");
  for (const n of hymn.notes) notes.push({ ...n, t: n.t + t });
  t += pos * B;
  // acorde final
  notes.push({ t, lane: 0, midi: 48, vel: 0.55, dur: B * 4, hold: B * 3 });
  notes.push({ t, lane: 6, midi: 76, vel: 0.55, dur: B * 4, hold: 0 });
  notes.push({ t, lane: 4, midi: 72, vel: 0.55, dur: B * 4, hold: B * 3 });
  t += B * 4;

  const beats = [];
  for (let i = 0; i * B <= t + 1; i++) beats.push([i * B, i % 4 === 0 ? 1 : 0]);
  notes.sort((a, b) => a.t - b.t || a.lane - b.lane);
  return {
    name: "Ensayo",
    diff: "medium",
    lanes: [0, 1, 2, 3, 4, 5, 6, 7],
    lookahead: 2.3,
    notes,
    auto: [],
    beats,
    duration: t,
    steps,
    tutorial: true,
  };
}
