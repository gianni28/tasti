// De notas de piano a carriles: 4 por mano (0-3 izquierda, 4-7 derecha).
// La nota que suena es la real; el carril depende de dónde cae esa nota respecto a las que
// la rodean (más grave a la izquierda, más aguda a la derecha), no de qué tecla es.
// Lo que no se puede tocar con 4 dedos queda en `auto`: suena solo, para que la pieza esté completa.

export const DIFFS = {
  easy: { label: "Fácil", hands: ["R"], maxChord: 1, minGap: 0.4, lookahead: 2.4, blurb: "Solo mano derecha; la izquierda suena sola." },
  medium: { label: "Medio", hands: ["L", "R"], maxChord: 1, minGap: 0.18, minGapL: 0.4, lookahead: 2.0, blurb: "Ambas manos; la izquierda, sencilla." },
  hard: { label: "Difícil", hands: ["L", "R"], maxChord: 2, minGap: 0.12, lookahead: 1.7, blurb: "Ambas manos, hasta dos notas juntas." },
  expert: { label: "Experto", hands: ["L", "R"], maxChord: 3, minGap: 0.07, lookahead: 1.4, blurb: "Hasta tres notas juntas por mano." },
};

const SAME_ONSET = 0.03; // notas a menos de 30 ms cuentan como un acorde
const WINDOW = 0.9; // segundos a cada lado para decidir la posición relativa
const SUSTAIN_MIN = 0.45; // más largo que esto: nota larga (se puede mantener)
const LANE_MIN_GAP = 0.09; // dos notas en el mismo carril no pueden estar más pegadas

/** Mano de cada nota: por pista si hay dos o más, por altura si todo viene en una. */
export function assignHands(notes) {
  const byTrack = new Map();
  for (const n of notes) {
    const s = byTrack.get(n.track) || { sum: 0, count: 0 };
    s.sum += n.midi;
    s.count++;
    byTrack.set(n.track, s);
  }
  const tracks = [...byTrack.entries()].map(([id, s]) => ({ id, mean: s.sum / s.count, count: s.count }));
  if (tracks.length >= 2) {
    tracks.sort((a, b) => a.mean - b.mean);
    const mid = (tracks[0].mean + tracks[tracks.length - 1].mean) / 2;
    const left = new Set(tracks.filter((t) => t.mean < mid).map((t) => t.id));
    if (!left.size) left.add(tracks[0].id);
    return notes.map((n) => ({ ...n, hand: left.has(n.track) ? "L" : "R" }));
  }
  // Una sola pista: punto de corte que se mueve con lo que cada mano viene tocando
  let meanL = 48, meanR = 72;
  const out = [];
  for (const g of groupByOnset(notes)) {
    const split = Math.min(67, Math.max(52, (meanL + meanR) / 2));
    const sorted = [...g.notes].sort((a, b) => a.midi - b.midi);
    for (const n of sorted) {
      const hand = n.midi < split ? "L" : "R";
      out.push({ ...n, hand });
      if (hand === "L") meanL += (n.midi - meanL) * 0.1;
      else meanR += (n.midi - meanR) * 0.1;
    }
  }
  return out;
}

function groupByOnset(notes) {
  const groups = [];
  for (const n of notes) {
    const g = groups[groups.length - 1];
    if (g && n.t - g.t < SAME_ONSET) g.notes.push(n);
    else groups.push({ t: n.t, notes: [n] });
  }
  return groups;
}

// Qué notas de un acorde se quedan: en la derecha manda la de arriba (la melodía), en la izquierda el bajo
function pickChord(notes, hand, max) {
  const asc = [...notes].sort((a, b) => a.midi - b.midi);
  const order = [];
  let lo = 0, hi = asc.length - 1, fromTop = hand === "R";
  while (lo <= hi) {
    order.push(fromTop ? asc[hi--] : asc[lo++]);
    fromTop = !fromTop;
  }
  const keep = order.slice(0, max);
  return { keep, drop: order.slice(max) };
}

function percentile(sorted, p) {
  if (!sorted.length) return 60;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];
}

/** Carriles 0-3 para los grupos que se tocan de una mano */
function laneHand(groups) {
  const all = groups.flatMap((g) => g.notes.map((n) => n.midi)).sort((a, b) => a - b);
  const lo = percentile(all, 0.05), hi = Math.max(lo + 1, percentile(all, 0.95));
  const rel = (p) => Math.min(1, Math.max(0, (p - lo) / (hi - lo)));

  let start = 0;
  let prev = null; // último grupo de una sola nota
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    while (groups[start].t < g.t - WINDOW) start++;
    const pitches = new Set();
    for (let j = start; j < groups.length && groups[j].t <= g.t + WINDOW; j++) for (const n of groups[j].notes) pitches.add(n.midi);
    const P = [...pitches].sort((a, b) => a - b);
    const k = P.length;
    const span = Math.min(3, k - 1);
    const mean = P.reduce((s, p) => s + p, 0) / k;
    const base = Math.round(rel(mean) * (3 - span));

    const sorted = [...g.notes].sort((a, b) => a.midi - b.midi);
    for (const n of sorted) {
      const r = P.indexOf(n.midi);
      n.lane = k === 1 ? Math.round(rel(n.midi) * 3) : base + Math.round((r * span) / (k - 1));
    }
    // acorde: carriles distintos y en el mismo orden que las notas
    for (let j = 1; j < sorted.length; j++) if (sorted[j].lane <= sorted[j - 1].lane) sorted[j].lane = sorted[j - 1].lane + 1;
    const over = sorted[sorted.length - 1].lane - 3;
    if (over > 0) for (const n of sorted) n.lane -= over;

    // nota suelta: que el carril siga la dirección de la melodía
    if (sorted.length === 1) {
      const n = sorted[0];
      if (prev && g.t - prev.t < 1.2) {
        const d = n.midi - prev.midi;
        if (d === 0) n.lane = prev.lane;
        // sube pero ya estaba en el borde: vuelve a empezar desde el otro lado (como una cascada),
        // porque una nota distinta en el mismo carril se siente como repetir la misma
        else if (d > 0 && n.lane <= prev.lane) n.lane = prev.lane < 3 ? prev.lane + 1 : n.lane < 3 ? n.lane : 0;
        else if (d < 0 && n.lane >= prev.lane) n.lane = prev.lane > 0 ? prev.lane - 1 : n.lane > 0 ? n.lane : 3;
      }
      prev = { t: g.t, midi: n.midi, lane: n.lane };
    } else prev = null;
  }
}

/** raw: lo que devuelve readMidi. diff: clave de DIFFS. */
export function buildChart(raw, diffKey) {
  const diff = DIFFS[diffKey];
  const withHands = assignHands(raw.notes);
  const play = [], auto = [];

  for (const hand of ["L", "R"]) {
    const mine = withHands.filter((n) => n.hand === hand);
    if (!diff.hands.includes(hand)) {
      auto.push(...mine);
      continue;
    }
    const kept = [];
    let last = -Infinity;
    const minGap = hand === "L" && diff.minGapL ? diff.minGapL : diff.minGap;
    for (const g of groupByOnset(mine)) {
      if (g.t - last < minGap) {
        auto.push(...g.notes);
        continue;
      }
      const { keep, drop } = pickChord(g.notes, hand, diff.maxChord);
      auto.push(...drop);
      kept.push({ t: g.t, notes: keep.map((n) => ({ ...n })) });
      last = g.t;
    }
    laneHand(kept);
    const offset = hand === "L" ? 0 : 4;
    for (const g of kept) for (const n of g.notes) play.push({ ...n, lane: n.lane + offset });
  }

  // por carril: nada pegado, y una nota larga se corta antes de la siguiente del mismo carril
  play.sort((a, b) => a.t - b.t || a.lane - b.lane);
  const lastInLane = new Array(8).fill(null);
  const notes = [];
  for (const n of play) {
    const p = lastInLane[n.lane];
    if (p && n.t - p.t < LANE_MIN_GAP) {
      auto.push(n);
      continue;
    }
    if (p && p.hold && p.t + p.hold > n.t - 0.12) p.hold = Math.max(0, n.t - p.t - 0.12);
    const note = { t: n.t, lane: n.lane, midi: n.midi, vel: n.vel, dur: n.dur, hold: n.dur >= SUSTAIN_MIN ? n.dur : 0 };
    notes.push(note);
    lastInLane[n.lane] = note;
  }
  for (const n of notes) if (n.hold && n.hold < SUSTAIN_MIN * 0.6) n.hold = 0;

  auto.sort((a, b) => a.t - b.t);
  return {
    name: raw.name,
    diff: diffKey,
    lanes: diff.hands.length === 2 ? [0, 1, 2, 3, 4, 5, 6, 7] : [4, 5, 6, 7],
    lookahead: diff.lookahead,
    notes,
    auto: auto.map((n) => ({ t: n.t, midi: n.midi, vel: n.vel, dur: n.dur })),
    beats: raw.beats,
    duration: raw.duration,
  };
}
