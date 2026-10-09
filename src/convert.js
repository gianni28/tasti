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
const SUSTAIN_MIN = 0.75; // más largo que esto: nota larga (se puede mantener)
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

// combinaciones de m carriles entre 4, en orden (para acordes)
const COMBOS = [[], [], [], []].map((_, m) => {
  const out = [];
  const rec = (start, acc) => {
    if (acc.length === m) { out.push(acc); return; }
    for (let l = start; l < 4; l++) rec(l + 1, [...acc, l]);
  };
  if (m) rec(0, []);
  return out;
});

/**
 * Carriles 0-3 para los grupos que se tocan de una mano.
 * Se buscan los carriles de toda la mano de una vez (Viterbi): cada grupo puede caer en varias
 * posiciones y se elige el camino más barato, donde sale caro que una nota repetida cambie de
 * carril, que dos notas distintas seguidas compartan carril o que el carril vaya contra la melodía,
 * y sale barato quedarse cerca de la posición relativa de la nota entre las que la rodean.
 */
function laneHand(groups, hand) {
  if (!groups.length) return;
  const all = groups.flatMap((g) => g.notes.map((n) => n.midi)).sort((a, b) => a - b);
  const lo = percentile(all, 0.05), hi = Math.max(lo + 1, percentile(all, 0.95));
  const rel = (p) => Math.min(1, Math.max(0, (p - lo) / (hi - lo)));

  // posición relativa de cada nota dentro de su ventana (lo que el jugador "espera")
  let start = 0;
  for (const g of groups) {
    while (groups[start].t < g.t - WINDOW) start++;
    const pitches = new Set();
    for (let j = start; j < groups.length && groups[j].t <= g.t + WINDOW; j++) for (const n of groups[j].notes) pitches.add(n.midi);
    const P = [...pitches].sort((a, b) => a - b);
    const k = P.length, span = Math.min(3, k - 1);
    const mean = P.reduce((a, b) => a + b, 0) / k;
    const base = Math.round(rel(mean) * (3 - span)) ;
    g.sorted = [...g.notes].sort((a, b) => a.midi - b.midi);
    g.lead = hand === "R" ? g.sorted[g.sorted.length - 1] : g.sorted[0];
    g.want = g.sorted.map((n) => (k === 1 ? rel(n.midi) * 3 : base + (P.indexOf(n.midi) * span) / (k - 1)));
    g.states = COMBOS[g.sorted.length];
  }

  const leadIdx = (g) => (hand === "R" ? g.sorted.length - 1 : 0);
  const emit = (g, st) => {
    let c = 0;
    for (let i = 0; i < st.length; i++) c += Math.abs(st[i] - g.want[i]) * 0.45;
    if (st.length > 1) {
      // acordes: separación de carriles parecida a la separación de las notas
      const iv = g.sorted[g.sorted.length - 1].midi - g.sorted[0].midi;
      const want = Math.min(3, Math.max(st.length - 1, iv / 4));
      c += Math.abs(st[st.length - 1] - st[0] - want) * 0.3;
    }
    return c;
  };
  const trans = (a, sa, b, sb) => {
    const gap = b.t - a.t;
    const weight = gap > 1.5 ? 0.25 : 1;
    const pa = a.lead.midi, pb = b.lead.midi;
    const la = sa[leadIdx(a)], lb = sb[leadIdx(b)];
    const d = pb - pa, dl = lb - la;
    let c = 0;
    if (d === 0) c += dl === 0 ? 0 : 10;
    else if (dl === 0) c += 8; // nota distinta, mismo carril: parece repetida
    else if (Math.sign(dl) !== Math.sign(d)) c += 4; // carril al revés de la melodía
    else c += Math.abs(Math.abs(dl) - Math.min(3, Math.max(1, Math.abs(d) / 2.5))) * 0.6;
    // el resto de notas: una nota que se repite debe quedarse en su carril; una distinta no debe caer en el carril de otra recién tocada
    for (let i = 0; i < b.sorted.length; i++) {
      const n = b.sorted[i], ln = sb[i];
      for (let j = 0; j < a.sorted.length; j++) {
        const m = a.sorted[j], lm = sa[j];
        if (m.midi === n.midi && lm !== ln) c += 5;
        else if (m.midi !== n.midi && lm === ln && gap < 0.35) c += 3;
      }
    }
    return c * weight;
  };

  // Viterbi
  let cost = groups[0].states.map((st) => emit(groups[0], st));
  const back = [null];
  for (let i = 1; i < groups.length; i++) {
    const a = groups[i - 1], b = groups[i];
    const next = [], from = [];
    for (const sb of b.states) {
      let best = Infinity, arg = 0;
      a.states.forEach((sa, ai) => {
        const c = cost[ai] + trans(a, sa, b, sb);
        if (c < best) { best = c; arg = ai; }
      });
      next.push(best + emit(b, sb));
      from.push(arg);
    }
    cost = next;
    back.push(from);
  }
  let si = cost.indexOf(Math.min(...cost));
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i], st = g.states[si];
    g.sorted.forEach((n, j) => (n.lane = st[j]));
    if (i > 0) si = back[i][si];
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
    laneHand(kept, hand);
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

/** Dificultad de 1 a 5 de un chart: notas por segundo, acordes y velocidad de la pista. */
export function starsFor(chart) {
  if (!chart.notes.length) return 1;
  const span = Math.max(1, chart.notes[chart.notes.length - 1].t - chart.notes[0].t);
  const nps = chart.notes.length / span;
  let groups = 0;
  for (let i = 0; i < chart.notes.length; i++) if (i === 0 || chart.notes[i].t - chart.notes[i - 1].t > 0.03) groups++;
  const chordy = chart.notes.length / groups; // 1 = sin acordes
  const speed = 2.0 / chart.lookahead;
  const x = nps * (1 + (chordy - 1) * 0.6) * (0.8 + speed * 0.2);
  return x < 1.3 ? 1 : x < 2.3 ? 2 : x < 3.4 ? 3 : x < 4.8 ? 4 : 5;
}
