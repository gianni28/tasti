// El público: espectadores sentados en el escenario, a los dos lados de la pista, mirando el piano.
// Viven en el mismo espacio 3D que la pista (x de lado a lado, u hacia el fondo, h hacia arriba),
// así que se achican con la distancia. Reaccionan a cómo vas: se mecen, aplauden, se ponen de pie
// y tiran rosas, tosen cuando fallas, cuchichean y, si la cosa va muy mal, se van.

const CLOTH = ["#1b1b22", "#2a1420", "#3a1a2a", "#1d2433", "#4a1424", "#23301f", "#2e2a24"];
const HAIR = ["#2a1a10", "#e6dfd0", "#6b4a2a", "#111111", "#a07a4a", "#e6dfd0", "#3a2a1a"];
const SKIN = ["#e8c9a6", "#c99a74", "#a8784f", "#f1d6b8", "#8a5a3a"];
const ROWS = [-70, 60, 190, 320, 450, 580]; // u de cada fila
const COUGHS = ["cof", "¡cof!", "ejem", "cof, cof"];

// número pseudoaleatorio fijo por espectador, para que cada uno sea siempre igual
const hash = (n) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export function createCrowd() {
  const people = [];
  let id = 0;
  for (const side of [-1, 1]) {
    ROWS.forEach((u, r) => {
      const n = r < 2 ? 4 : 3;
      for (let c = 0; c < n; c++) {
        const h = hash(++id);
        const x = side * (372 + c * 98 + (r % 2) * 46 + h * 14);
        people.push({
          id, side, x, u: u + (hash(id + 9) - 0.5) * 24, x0: x,
          cloth: CLOTH[Math.floor(hash(id + 1) * CLOTH.length)],
          hair: HAIR[Math.floor(hash(id + 2) * HAIR.length)],
          skin: SKIN[Math.floor(hash(id + 3) * SKIN.length)],
          bun: hash(id + 4) < 0.3,
          hat: hash(id + 5) < 0.08,
          size: 0.92 + hash(id + 6) * 0.16,
          phase: hash(id + 7) * Math.PI * 2,
          clapper: hash(id + 8), // cuanto más bajo, antes empieza a aplaudir
          stand: 0, // 0 sentado … 1 de pie
          standUntil: -Infinity, // la cuenta inicial va en tiempos negativos
          coughUntil: -Infinity,
          turnUntil: -Infinity,
          turnDir: 0,
          leaving: -1, // momento en que se levantó para irse
          gone: false,
        });
      }
    });
  }
  people.sort((a, b) => b.u - a.u); // del fondo hacia adelante

  const crowd = {
    people,
    flowers: [],
    words: [], // { person, text, t }
    sounds: [], // lo que main debe hacer sonar: "cough" | "applause" | "ovation"
    energy: 0.75, // qué tan contento está el público (0..1)
    combo: 0,
    pedalOn: false,
    beat: 0, // fase del pulso 0..1
    lastCough: -9,
    lastLeave: -9,
    missStreak: 0,
    left: 0,
  };

  const present = () => people.filter((p) => !p.gone && p.leaving < 0);
  const pick = (list) => list[Math.floor(Math.random() * list.length)];

  crowd.hit = (t, combo) => {
    crowd.combo = combo;
    crowd.missStreak = 0;
    crowd.energy += (1 - crowd.energy) * 0.04;
    if (combo > 0 && combo % 50 === 0) crowd.ovation(t, 6 + Math.min(10, combo / 25));
  };

  crowd.miss = (t) => {
    crowd.combo = 0;
    crowd.missStreak++;
    crowd.energy += (0 - crowd.energy) * 0.07;
    // alguien tose (no todos los fallos, para que no sea un coro)
    if (t - crowd.lastCough > 0.8 && Math.random() < 0.5) {
      const p = pick(present().filter((p) => p.u < 400));
      if (p) {
        crowd.lastCough = t;
        p.coughUntil = t + 0.7;
        crowd.words.push({ person: p, text: pick(COUGHS), t });
        crowd.sounds.push("cough");
      }
    }
    // varios fallos seguidos: los vecinos se miran entre ellos
    if (crowd.missStreak >= 3 && crowd.missStreak % 3 === 0) {
      const p = pick(present());
      if (p) {
        const near = present().filter((q) => q !== p && q.side === p.side && Math.abs(q.u - p.u) < 70 && Math.abs(q.x - p.x) < 130);
        const q = near[0];
        if (q) {
          const dir = Math.sign(q.x - p.x);
          p.turnDir = dir; q.turnDir = -dir;
          p.turnUntil = q.turnUntil = t + 1.6;
        }
      }
    }
  };

  /** Todos de pie, aplausos y rosas al escenario. */
  crowd.ovation = (t, flowers = 8, long = false) => {
    for (const p of present()) p.standUntil = t + (long ? 4 : 1.8) + hash(p.id) * 0.4;
    crowd.sounds.push(long ? "ovation" : "applause");
    const throwers = present().filter((p) => p.u < 460);
    for (let i = 0; i < flowers; i++) {
      const p = pick(throwers);
      if (!p) break;
      const tx = p.side * (300 + Math.random() * 40); // al borde de la pista, sin tapar los carriles
      const tu = 120 + Math.random() * 520;
      const dur = 0.9 + Math.random() * 0.4;
      crowd.flowers.push({
        x: p.x, u: p.u, h: 130, t0: t + i * 0.08,
        vx: (tx - p.x) / dur, vu: (tu - p.u) / dur, vh: 260 + Math.random() * 80, dur,
        spin: Math.random() * Math.PI * 2, landed: false,
      });
    }
  };

  crowd.update = (t, dt, { combo, pedalOn, beat, judged }) => {
    crowd.combo = combo;
    crowd.pedalOn = pedalOn;
    crowd.beat = beat;
    for (const p of people) {
      if (p.gone) continue;
      const wantStand = t < p.standUntil || p.leaving >= 0;
      p.stand += ((wantStand ? 1 : 0) - p.stand) * Math.min(1, dt * 7);
      if (p.leaving >= 0) {
        // se va caminando hacia el costado
        const walk = t - p.leaving - 0.6;
        if (walk > 0) p.x = p.x0 + p.side * walk * 140;
        if (walk > 4) p.gone = true;
      }
    }
    // si va muy mal, de vez en cuando alguien se levanta y se va (como mucho seis)
    if (judged > 30 && crowd.energy < 0.35 && t - crowd.lastLeave > 6 && crowd.left < 6) {
      const p = pick(present().filter((p) => p.u > 50));
      if (p) {
        p.leaving = t;
        crowd.lastLeave = t;
        crowd.left++;
        crowd.words.push({ person: p, text: pick(["Con permiso…", "Se me hizo tarde", "Bueno, yo me voy"]), t });
      }
    }
    for (const f of crowd.flowers) {
      if (f.landed || t < f.t0) continue;
      const a = t - f.t0;
      if (a >= f.dur) {
        f.landed = true;
        f.landedAt = t;
        f.x += f.vx * f.dur; f.u += f.vu * f.dur; f.h = 4;
      }
    }
    crowd.flowers = crowd.flowers.filter((f) => !f.landed || t - f.landedAt < 8);
    crowd.words = crowd.words.filter((w) => t - w.t < 1.6);
  };

  crowd.takeSounds = () => { const s = crowd.sounds; crowd.sounds = []; return s; };
  return crowd;
}

/* ---------------- dibujo ---------------- */

function ellipse(g, x, y, rx, ry, fill) {
  g.beginPath();
  g.ellipse(x, y, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, Math.PI * 2);
  g.fillStyle = fill;
  g.fill();
}

/** P(x, u, h) → [sx, sy, escala]. fadeU: desde qué u el escenario se pierde en la oscuridad. */
export function drawCrowd(g, P, crowd, t, fadeU) {
  const flowerDraw = (f) => {
    let x = f.x, u = f.u, h = f.h, rot = f.spin;
    if (!f.landed) {
      const a = Math.max(0, t - f.t0);
      x += f.vx * a; u += f.vu * a; h = 130 + f.vh * a - 380 * a * a;
      rot += a * 9;
    }
    const [sx, sy, k] = P(x, u, Math.max(4, h));
    const r = 7 * k;
    g.strokeStyle = "#3f6b3a";
    g.lineWidth = Math.max(1, 2.2 * k);
    g.beginPath();
    g.moveTo(sx, sy);
    g.lineTo(sx + Math.cos(rot) * 18 * k, sy + Math.sin(rot) * 18 * k);
    g.stroke();
    ellipse(g, sx, sy, r, r * 0.9, "#c0334f");
    ellipse(g, sx - r * 0.25, sy - r * 0.3, r * 0.45, r * 0.4, "#e8607a");
  };

  for (const f of crowd.flowers) if (f.landed) flowerDraw(f);

  const clapAmount = Math.max(0, Math.min(1, (crowd.combo - 12) / 40));
  for (const p of crowd.people) {
    if (p.gone) continue;
    const fog = Math.max(0.35, Math.min(1, 1 - (p.u - 80) / (fadeU * 1.1)));
    g.globalAlpha = p.leaving >= 0 ? Math.max(0, fog * (1 - Math.max(0, t - p.leaving - 3) )) : fog;

    const inward = -p.side; // hacia dónde está el piano
    const sway = Math.sin(t * 1.3 + p.phase) * 3 + (crowd.pedalOn ? Math.sin(t * 2.2) * 6 * inward : 0);
    const nod = crowd.energy > 0.7 ? Math.max(0, Math.cos(crowd.beat * Math.PI * 2)) * 4 : 0;
    const cough = t < p.coughUntil ? Math.abs(Math.sin((p.coughUntil - t) * 22)) * 6 : 0;
    const walking = p.leaving >= 0 && t - p.leaving > 0.6;
    const bob = walking ? Math.abs(Math.sin(t * 9)) * 5 : 0;
    const lift = p.stand * 42 + bob;
    const sz = p.size;

    const base = P(p.x, p.u, 0);
    const k = base[2];
    // sombra en el piso
    ellipse(g, base[0], base[1], 34 * k * sz, 9 * k * sz, "rgba(0,0,0,0.35)");

    // cuerpo
    const torso = P(p.x + sway * 0.5, p.u, (64 + lift) * sz);
    const tw = 25 * k * sz, th = 30 * k * sz;
    const grad = g.createLinearGradient(torso[0] - tw * inward, 0, torso[0] + tw * inward, 0);
    grad.addColorStop(0, p.cloth);
    grad.addColorStop(1, shade(p.cloth, 1.9));
    ellipse(g, torso[0], torso[1], tw, th, grad);
    // hombros
    ellipse(g, torso[0], torso[1] - th * 0.55, tw * 1.08, th * 0.42, p.cloth);

    // brazos: aplaudir, de pie con los brazos arriba, o tapándose la boca al toser
    const claps = !walking && p.clapper < clapAmount && p.stand < 0.5;
    const ovation = p.stand > 0.6 && !walking;
    g.strokeStyle = p.cloth;
    g.lineWidth = Math.max(1, 8 * k * sz);
    g.lineCap = "round";
    if (ovation || claps) {
      const hands = ovation
        ? [[-16, 120 + lift], [16, 120 + lift]]
        : (() => { const o = 4 + Math.abs(Math.sin(t * 13 + p.phase)) * 9; return [[-o, 92 + lift], [o, 92 + lift]]; })();
      for (const [hx, hh] of hands) {
        const sh = P(p.x + Math.sign(hx) * 18 * sz + sway * 0.5, p.u, (82 + lift) * sz);
        const hd = P(p.x + hx * sz + sway, p.u - 4, hh * sz);
        g.beginPath(); g.moveTo(sh[0], sh[1]); g.lineTo(hd[0], hd[1]); g.stroke();
        ellipse(g, hd[0], hd[1], 4.5 * k * sz, 4.5 * k * sz, p.skin);
      }
    }

    // cabeza: de espaldas, girada hacia el piano (se le ve un poco de cara y la oreja de ese lado)
    const turning = t < p.turnUntil ? p.turnDir : inward;
    const head = P(p.x + sway, p.u, (104 + lift - cough + nod * 0.5) * sz);
    const hr = 15 * k * sz;
    ellipse(g, head[0], head[1] + hr * 0.95, hr * 0.45, hr * 0.5, p.skin); // cuello
    ellipse(g, head[0], head[1], hr, hr * 1.08, p.skin);
    ellipse(g, head[0] - turning * hr * 0.32, head[1] - hr * 0.08, hr * 0.92, hr * 1.02, p.hair);
    if (p.bun) ellipse(g, head[0] - turning * hr * 0.2, head[1] - hr * 0.95, hr * 0.48, hr * 0.42, p.hair);
    if (p.hat) {
      g.fillStyle = "#0c0a0a";
      g.fillRect(head[0] - hr * 0.75, head[1] - hr * 2.1, hr * 1.5, hr * 1.4);
      g.fillRect(head[0] - hr * 1.15, head[1] - hr * 0.8, hr * 2.3, hr * 0.28);
    }
    // luz del escenario en el borde de la cabeza y los hombros
    g.strokeStyle = "rgba(255,214,140,0.55)";
    g.lineWidth = Math.max(1, 1.6 * k);
    g.beginPath();
    g.arc(head[0], head[1], hr, inward > 0 ? -Math.PI * 0.55 : -Math.PI * 0.95, inward > 0 ? Math.PI * 0.05 : -Math.PI * 0.45);
    g.stroke();
    // mano a la boca cuando tose
    if (cough > 0) ellipse(g, head[0] + turning * hr * 0.9, head[1] + hr * 0.5, 4.5 * k * sz, 4.5 * k * sz, p.skin);

    // respaldo de la silla, delante (lo vemos desde atrás)
    if (p.stand < 0.5 && !walking) {
      const c0 = P(p.x - 26 * sz, p.u - 12, 0), c1 = P(p.x + 26 * sz, p.u - 12, 0);
      const c2 = P(p.x + 26 * sz, p.u - 12, 74 * sz), c3 = P(p.x - 26 * sz, p.u - 12, 74 * sz);
      g.beginPath();
      g.moveTo(c0[0], c0[1]); g.lineTo(c1[0], c1[1]); g.lineTo(c2[0], c2[1]);
      g.quadraticCurveTo((c2[0] + c3[0]) / 2, c2[1] - 10 * k, c3[0], c3[1]);
      g.closePath();
      const cg = g.createLinearGradient(c3[0], 0, c2[0], 0);
      cg.addColorStop(0, "#4a0a17");
      cg.addColorStop(0.5, "#7d1b2d");
      cg.addColorStop(1, "#4a0a17");
      g.fillStyle = cg;
      g.fill();
      g.strokeStyle = "#a8803a";
      g.lineWidth = Math.max(1, 2 * k);
      g.stroke();
    } else if (!walking) {
      // la silla vacía queda ahí cuando están de pie
      const c3 = P(p.x - 26 * sz, p.u - 12, 74 * sz), c1 = P(p.x + 26 * sz, p.u - 12, 0);
      g.fillStyle = "rgba(90,16,30,0.9)";
      g.fillRect(c3[0], c3[1], c1[0] - c3[0], c1[1] - c3[1]);
    }
  }
  g.globalAlpha = 1;
  for (const f of crowd.flowers) if (!f.landed && t >= f.t0) flowerDraw(f);

  // lo que dicen o hacen (encima de su cabeza)
  for (const w of crowd.words) {
    if (w.person.gone) continue;
    const age = t - w.t;
    const head = P(w.person.x, w.person.u, 150 + age * 50);
    g.globalAlpha = Math.max(0, Math.min(1, (1.6 - age) * 2));
    g.font = `italic 600 ${Math.max(12, Math.round(30 * head[2]))}px "Cormorant Garamond", serif`;
    g.textAlign = "center";
    g.fillStyle = "#f3e6c8";
    g.shadowColor = "rgba(0,0,0,0.8)";
    g.shadowBlur = 4;
    g.fillText(w.text, head[0], head[1]);
    g.shadowBlur = 0;
  }
  g.globalAlpha = 1;
}

// aclara un color hex (luz del escenario sobre la ropa)
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.min(255, Math.round(v * f + 12));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
}
