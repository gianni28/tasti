// Lógica de una partida, sin pantalla ni sonido: aciertos, combo, puntaje, notas largas y pedal.
// Los tiempos son segundos de la canción.

export const WINDOW_PERFECT = 0.05;
export const WINDOW_GOOD = 0.1;
const MISS_AFTER = 0.14;
const PEDAL_TIME = 10; // segundos que dura el pedal con el medidor lleno
const PEDAL_MIN = 0.5; // hace falta medio medidor para pisarlo

export class Game {
  constructor(chart) {
    this.chart = chart;
    this.notes = chart.notes.map((n, i) => ({ ...n, id: i, grade: null, holding: false, holdDone: false }));
    this.byLane = Array.from({ length: 8 }, () => []);
    for (const n of this.notes) this.byLane[n.lane].push(n);
    this.next = new Array(8).fill(0); // primera nota sin juzgar de cada carril
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.perfect = 0;
    this.good = 0;
    this.miss = 0;
    this.pedal = 0; // 0..1
    this.pedalOn = false;
    this.events = []; // lo que pasó desde la última vez que la pantalla preguntó
  }

  get multiplier() {
    return Math.min(4, 1 + Math.floor(this.combo / 10)) * (this.pedalOn ? 2 : 1);
  }

  get judged() { return this.perfect + this.good + this.miss; }

  get accuracy() {
    const j = this.judged;
    return j ? (this.perfect + this.good * 0.6) / j : 1;
  }

  /** Se pulsó un carril en el tiempo t. Devuelve la nota acertada o null. */
  press(lane, t) {
    const list = this.byLane[lane];
    let best = null, bestD = Infinity;
    for (let i = this.next[lane]; i < list.length; i++) {
      const n = list[i];
      if (n.t - t > WINDOW_GOOD) break;
      if (n.grade) continue;
      const d = Math.abs(n.t - t);
      if (d <= WINDOW_GOOD && d < bestD) { best = n; bestD = d; }
    }
    if (!best) {
      // tecla al aire: no suena nada y se corta la racha
      if (this.combo > 0) this.events.push({ type: "break", lane, t });
      this.combo = 0;
      return null;
    }
    best.grade = bestD <= WINDOW_PERFECT ? "perfect" : "good";
    if (best.grade === "perfect") { this.perfect++; this.addPedal(0.025); } else this.good++;
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.score += (best.grade === "perfect" ? 50 : 30) * this.multiplier;
    if (best.hold) best.holding = true;
    this.advance(lane);
    this.events.push({ type: "hit", grade: best.grade, note: best, t });
    return best;
  }

  /** Se soltó un carril. Devuelve la nota larga que se estaba manteniendo, si había. */
  release(lane, t) {
    for (const n of this.byLane[lane]) {
      if (n.holding) {
        n.holding = false;
        n.releasedAt = t;
        return n;
      }
    }
    return null;
  }

  pressPedal() {
    if (this.pedalOn || this.pedal < PEDAL_MIN) return false;
    this.pedalOn = true;
    this.events.push({ type: "pedal" });
    return true;
  }

  addPedal(x) { if (!this.pedalOn) this.pedal = Math.min(1, this.pedal + x); }

  advance(lane) {
    const list = this.byLane[lane];
    while (this.next[lane] < list.length && list[this.next[lane]].grade) this.next[lane]++;
  }

  /** Avanza el reloj: marca fallos, suma notas largas, gasta el pedal. Devuelve notas largas que terminaron. */
  update(t, dt) {
    const finished = [];
    for (let lane = 0; lane < 8; lane++) {
      const list = this.byLane[lane];
      for (let i = this.next[lane]; i < list.length; i++) {
        const n = list[i];
        if (n.t > t - MISS_AFTER) break;
        if (!n.grade) {
          n.grade = "miss";
          this.miss++;
          this.combo = 0;
          this.events.push({ type: "miss", note: n, t });
        }
      }
      this.advance(lane);
      for (const n of list) {
        if (!n.holding) continue;
        const end = n.t + n.hold;
        const step = Math.max(0, Math.min(dt, end - (t - dt)));
        this.score += Math.round(step * 40 * this.multiplier);
        if (t >= end) {
          n.holding = false;
          n.holdDone = true;
          this.addPedal(0.06);
          finished.push(n);
        }
      }
    }
    if (this.pedalOn) {
      this.pedal -= dt / PEDAL_TIME;
      if (this.pedal <= 0) { this.pedal = 0; this.pedalOn = false; this.events.push({ type: "pedalEnd" }); }
    }
    return finished;
  }

  takeEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }
}

/** El crítico: una reseña según cómo te fue. */
export function review(game) {
  const a = game.accuracy;
  const total = game.notes.length;
  const pick = (arr) => arr[Math.floor((game.score / 7) % arr.length)];
  if (game.judged < total * 0.5) return { title: "Se fue en el intermedio", text: "El crítico no alcanzó a escribir nada.", stars: 0 };
  if (a >= 0.97) return { stars: 5, title: "Sublime", text: pick(["El público olvidó toser.", "Hubo quien lloró en la fila tres. De emoción, esta vez."]) };
  if (a >= 0.9) return { stars: 4, title: "Brillante", text: pick(["Un par de tropiezos que solo notó el crítico.", "El compositor asintió desde su retrato."]) };
  if (a >= 0.78) return { stars: 3, title: "Correcto, pero sin alma", text: pick(["Las manos llegaron a tiempo; el alma se quedó en el vestíbulo.", "Bach habría pedido otra toma."]) };
  if (a >= 0.6) return { stars: 2, title: "Valiente", text: pick(["El piano lo agradeció a medias.", "Hubo pasajes que sonaron a pánico."]) };
  return { stars: 1, title: "El compositor se revolcó", text: pick(["La fila tres recordó otro compromiso.", "Hasta el afinador se fue."]) };
}
