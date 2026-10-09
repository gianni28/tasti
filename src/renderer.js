import { drawCrowd } from "./crowd.js";

// La sala y la pista, dibujadas en un canvas 2D con perspectiva propia.
// La pista es un plano inclinado (como en la maqueta): cada punto tiene x (de lado a lado),
// u (a lo largo de la pista, desde el borde de abajo) y h (altura sobre la pista).

const LAYOUTS = {
  desk: { W: 1280, H: 720, planeW: 560, planeH: 1500, keyLen: 200, tilt: 64, persp: 1000, originY: 100, bottomY: 640, noteLen: 60, noteT: 16, keyT: 24, keyDown: 12, blackT: 34, colH: 260, letters: true },
  phone: { W: 844, H: 390, planeW: 560, planeH: 760, keyLen: 160, tilt: 62, persp: 700, originY: 30, bottomY: 340, noteLen: 50, noteT: 12, keyT: 18, keyDown: 9, blackT: 26, colH: 160, letters: false },
};
const KEY_LETTERS = ["A", "S", "D", "F", "J", "K", "L", "Ñ"];
const BLACK_AT = [1, 2, 4, 5, 6]; // entre qué carriles van las teclas negras (Do# Re# Fa# Sol# La#)

const GOLD = "#e3bb5c";

export function createRenderer(canvas) {
  const g = canvas.getContext("2d");
  let L = LAYOUTS.desk, s = 1, ox = 0, oy = 0, dpr = 1, cw = 0, ch = 0;
  let cosT = 0, sinT = 0, laneW = 0;
  let back = null, front = null; // fondo y primer plano, dibujados una vez por tamaño

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    cw = canvas.clientWidth;
    ch = canvas.clientHeight;
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    L = ch < 520 && cw > ch ? LAYOUTS.phone : LAYOUTS.desk;
    s = Math.min(cw / L.W, ch / L.H);
    ox = (cw - L.W * s) / 2;
    oy = (ch - L.H * s) / 2;
    cosT = Math.cos((L.tilt * Math.PI) / 180);
    sinT = Math.sin((L.tilt * Math.PI) / 180);
    laneW = L.planeW / 8;
    back = paintBack();
    front = paintFront();
  }

  // punto de la pista → pantalla (px CSS)
  function P(x, u, h = 0) {
    const Y = L.bottomY - u * cosT - h * sinT;
    const Z = u * sinT - h * cosT;
    const k = L.persp / (L.persp + Z);
    return [ox + (L.W / 2 + x * k) * s, oy + (L.originY + (Y - L.originY) * k) * s, k * s];
  }
  const laneX = (i) => -L.planeW / 2 + i * laneW;

  function quad(a, b, c, d) {
    g.beginPath();
    g.moveTo(a[0], a[1]);
    g.lineTo(b[0], b[1]);
    g.lineTo(c[0], c[1]);
    g.lineTo(d[0], d[1]);
    g.closePath();
  }
  // caja sobre la pista: cara de arriba y cara de frente (la que mira al jugador)
  function box(x0, x1, u0, u1, h, top, side, alpha = 1) {
    const a = P(x0, u0, h), b = P(x1, u0, h), c = P(x1, u1, h), d = P(x0, u1, h);
    const a0 = P(x0, u0, 0), b0 = P(x1, u0, 0);
    g.globalAlpha = alpha;
    quad(a0, b0, b, a);
    g.fillStyle = side;
    g.fill();
    quad(a, b, c, d);
    if (typeof top === "string") g.fillStyle = top;
    else {
      const gr = g.createLinearGradient(0, d[1], 0, a[1]);
      gr.addColorStop(0, top[0]);
      gr.addColorStop(1, top[1]);
      g.fillStyle = gr;
    }
    g.fill();
    g.globalAlpha = 1;
    return [a, b, c, d];
  }

  function offscreen() {
    const c = document.createElement("canvas");
    c.width = canvas.width;
    c.height = canvas.height;
    const x = c.getContext("2d");
    x.scale(dpr, dpr);
    return [c, x];
  }

  /* ---------- fondo: sala, arco del escenario y piso de tablas ---------- */
  function paintBack() {
    const [c, x] = offscreen();
    const bg = x.createRadialGradient(cw / 2, ch * 0.2, 10, cw / 2, ch * 0.2, Math.max(cw, ch) * 0.8);
    bg.addColorStop(0, "#3a1218");
    bg.addColorStop(0.55, "#1a070b");
    bg.addColorStop(1, "#0a0305");
    x.fillStyle = bg;
    x.fillRect(0, 0, cw, ch);

    // telón de fondo dentro del arco
    const ax = ox + 126 * s * (L.W / 1280), aw = L.W * s - 2 * (ax - ox);
    const archTop = oy + (L === LAYOUTS.desk ? 46 : 26) * s;
    x.save();
    x.beginPath();
    x.moveTo(ax, oy + L.H * s);
    x.lineTo(ax, archTop + 80 * s);
    x.quadraticCurveTo(ax + aw / 2, archTop - 40 * s, ax + aw, archTop + 80 * s);
    x.lineTo(ax + aw, oy + L.H * s);
    x.closePath();
    x.clip();
    const fold = 90 * s;
    for (let fx = ax; fx < ax + aw; fx += fold) {
      const gr = x.createLinearGradient(fx, 0, fx + fold, 0);
      gr.addColorStop(0, "#2a0a10");
      gr.addColorStop(0.35, "#3d1019");
      gr.addColorStop(0.7, "#22080d");
      gr.addColorStop(1, "#2a0a10");
      x.fillStyle = gr;
      x.fillRect(fx, 0, fold + 1, ch);
    }
    const dim = x.createRadialGradient(cw / 2, ch * 0.3, 10, cw / 2, ch * 0.3, aw * 0.6);
    dim.addColorStop(0, "rgba(0,0,0,0)");
    dim.addColorStop(1, "rgba(0,0,0,0.75)");
    x.fillStyle = dim;
    x.fillRect(0, 0, cw, ch);
    x.restore();
    // marco dorado del arco
    x.strokeStyle = "#a8803a";
    x.lineWidth = 7 * s;
    x.beginPath();
    x.moveTo(ax, oy + L.H * s);
    x.lineTo(ax, archTop + 80 * s);
    x.quadraticCurveTo(ax + aw / 2, archTop - 40 * s, ax + aw, archTop + 80 * s);
    x.lineTo(ax + aw, oy + L.H * s);
    x.stroke();

    // piso de tablas que se va hacia el fondo
    const fw = L.planeW * 1.6;
    const p = (xx, u) => {
      const Y = L.bottomY - u * cosT, Z = u * sinT, k = L.persp / (L.persp + Z);
      return [ox + (L.W / 2 + xx * k) * s, oy + (L.originY + (Y - L.originY) * k) * s];
    };
    const f0 = p(-fw, 0), f1 = p(fw, 0), f2 = p(fw, L.planeH), f3 = p(-fw, L.planeH);
    x.beginPath();
    x.moveTo(f0[0], f0[1]); x.lineTo(f1[0], f1[1]); x.lineTo(f2[0], f2[1]); x.lineTo(f3[0], f3[1]); x.closePath();
    x.fillStyle = "#2c1a10";
    x.fill();
    x.lineWidth = Math.max(1, 1.5 * s);
    for (let px = -fw; px <= fw; px += 80) {
      const a = p(px, 0), b = p(px, L.planeH);
      x.strokeStyle = "rgba(10,5,2,0.9)";
      x.beginPath(); x.moveTo(a[0], a[1]); x.lineTo(b[0], b[1]); x.stroke();
      const a2 = p(px + 40, 0), b2 = p(px + 40, L.planeH);
      x.strokeStyle = "rgba(90,56,30,0.35)";
      x.beginPath(); x.moveTo(a2[0], a2[1]); x.lineTo(b2[0], b2[1]); x.stroke();
    }
    // luz del foco sobre las tablas
    const spot = p(0, L.keyLen + 120);
    const pool = x.createRadialGradient(spot[0], spot[1], 5, spot[0], spot[1], L.planeW * s * 0.9);
    pool.addColorStop(0, "rgba(255,200,120,0.22)");
    pool.addColorStop(1, "rgba(255,200,120,0)");
    x.fillStyle = pool;
    x.fillRect(0, 0, cw, ch);
    // el fondo del escenario se pierde en la oscuridad
    const fade = x.createLinearGradient(0, f3[1], 0, f3[1] + (f0[1] - f3[1]) * 0.55);
    fade.addColorStop(0, "rgba(16,5,8,1)");
    fade.addColorStop(1, "rgba(16,5,8,0)");
    x.fillStyle = fade;
    x.fillRect(0, f3[1] - 2, cw, (f0[1] - f3[1]) * 0.56);
    return c;
  }

  /* ---------- primer plano: foco, telones, cenefa, público, viñeta ---------- */
  function paintFront() {
    const [c, x] = offscreen();
    const W = L.W * s, H = L.H * s;
    // haz del foco
    x.save();
    x.globalCompositeOperation = "screen";
    const beam = x.createLinearGradient(0, oy, 0, oy + H);
    beam.addColorStop(0, "rgba(255,226,160,0.16)");
    beam.addColorStop(1, "rgba(255,226,160,0.03)");
    x.fillStyle = beam;
    x.beginPath();
    x.moveTo(ox + W * 0.47, oy);
    x.lineTo(ox + W * 0.53, oy);
    x.lineTo(ox + W * 0.75, oy + H * 0.92);
    x.lineTo(ox + W * 0.25, oy + H * 0.92);
    x.closePath();
    x.fill();
    x.restore();

    // telones laterales (llegan hasta el borde de la ventana)
    const cwid = (L === LAYOUTS.desk ? 140 : 28) * s;
    const drape = (x0, w, flip) => {
      x.save();
      x.beginPath();
      if (L === LAYOUTS.desk) {
        if (!flip) { x.moveTo(x0, 0); x.lineTo(x0 + w, 0); x.lineTo(x0 + w * 0.92, ch * 0.4); x.lineTo(x0 + w * 0.62, ch * 0.62); x.lineTo(x0 + w * 0.8, ch); x.lineTo(x0, ch); }
        else { x.moveTo(x0, 0); x.lineTo(x0 + w, 0); x.lineTo(x0 + w, ch); x.lineTo(x0 + w * 0.2, ch); x.lineTo(x0 + w * 0.38, ch * 0.62); x.lineTo(x0 + w * 0.08, ch * 0.4); }
      } else x.rect(x0, 0, w, ch);
      x.closePath();
      x.clip();
      const fold = 56 * s;
      for (let fx = x0 - fold; fx < x0 + w; fx += fold) {
        const gr = x.createLinearGradient(fx, 0, fx + fold, 0);
        gr.addColorStop(0, "#5e0f1e");
        gr.addColorStop(0.32, "#8a2236");
        gr.addColorStop(0.72, "#4a0a17");
        gr.addColorStop(1, "#5e0f1e");
        x.fillStyle = gr;
        x.fillRect(fx, 0, fold + 1, ch);
      }
      const sh = x.createLinearGradient(x0, 0, x0 + w, 0);
      sh.addColorStop(flip ? 1 : 0, "rgba(0,0,0,0.55)");
      sh.addColorStop(0.5, "rgba(0,0,0,0)");
      sh.addColorStop(flip ? 0 : 1, "rgba(0,0,0,0.35)");
      x.fillStyle = sh;
      x.fillRect(x0, 0, w, ch);
      x.restore();
    };
    drape(0, ox + cwid, false);
    drape(ox + W - cwid, ox + cwid, true);

    // cenefa con festón
    const vh = (L === LAYOUTS.desk ? 50 : 20) * s;
    for (let fx = 0; fx < cw; fx += 90 * s) {
      const gr = x.createLinearGradient(fx, 0, fx + 90 * s, 0);
      gr.addColorStop(0, "#6b1222");
      gr.addColorStop(0.33, "#8a2236");
      gr.addColorStop(0.66, "#560e1b");
      gr.addColorStop(1, "#6b1222");
      x.fillStyle = gr;
      x.fillRect(fx, 0, 90 * s + 1, oy + vh);
    }
    x.fillStyle = "#c9a24a";
    x.fillRect(0, oy + vh, cw, 3 * s);
    x.fillStyle = "#6b1222";
    const r = (L === LAYOUTS.desk ? 18 : 10) * s;
    for (let fx = r; fx < cw + r; fx += r * 2.2) {
      x.beginPath();
      x.arc(fx, oy + vh + 3 * s, r, 0, Math.PI);
      x.fill();
    }

    const vig = x.createRadialGradient(cw / 2, ch * 0.55, Math.min(cw, ch) * 0.35, cw / 2, ch * 0.55, Math.max(cw, ch) * 0.75);
    vig.addColorStop(0, "rgba(0,0,0,0)");
    vig.addColorStop(1, "rgba(0,0,0,0.55)");
    x.fillStyle = vig;
    x.fillRect(0, 0, cw, ch);
    return c;
  }

  /* ---------- cada cuadro ---------- */
  function draw(st) {
    const { now, chart, game, held, effects, pedalOn } = st;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.drawImage(back, 0, 0, cw, ch);

    const active = new Set(chart.lanes);
    const pps = (L.planeH - L.keyLen) / chart.lookahead;
    const uOf = (t) => L.keyLen + (t - now) * pps;
    const half = L.planeW / 2;
    const far = L.planeH;
    const fogAt = (u) => Math.max(0, Math.min(1, (far - u) / (far * 0.32)));

    // superficie de la pista
    const n0 = P(-half, L.keyLen), n1 = P(half, L.keyLen), f1 = P(half, far), f0 = P(-half, far);
    quad(n0, n1, f1, f0);
    const surf = g.createLinearGradient(0, f0[1], 0, n0[1]);
    surf.addColorStop(0, "rgba(14,4,7,0)");
    surf.addColorStop(0.3, "rgba(14,4,7,0.9)");
    surf.addColorStop(1, pedalOn ? "rgba(60,36,8,0.95)" : "rgba(28,10,15,0.95)");
    g.fillStyle = surf;
    g.fill();
    // carriles apagados (en Fácil la izquierda va sola)
    for (let i = 0; i < 8; i++) {
      if (active.has(i)) continue;
      quad(P(laneX(i), L.keyLen), P(laneX(i + 1), L.keyLen), P(laneX(i + 1), far), P(laneX(i), far));
      g.fillStyle = "rgba(0,0,0,0.45)";
      g.fill();
    }
    // carril pulsado: se ilumina hacia el fondo
    for (const i of held) {
      if (!active.has(i)) continue;
      const a = P(laneX(i), L.keyLen), b = P(laneX(i + 1), L.keyLen), c = P(laneX(i + 1), L.keyLen + 420), d = P(laneX(i), L.keyLen + 420);
      quad(a, b, c, d);
      const gr = g.createLinearGradient(0, c[1], 0, a[1]);
      gr.addColorStop(0, "rgba(255,214,120,0)");
      gr.addColorStop(1, "rgba(255,214,120,0.24)");
      g.fillStyle = gr;
      g.fill();
    }
    // pulsos del compás
    for (const [bt, strong] of chart.beats) {
      const u = uOf(bt);
      if (u < L.keyLen || u > far) continue;
      const a = P(-half, u), b = P(half, u);
      g.strokeStyle = `rgba(227,187,92,${(strong ? 0.34 : 0.15) * fogAt(u)})`;
      g.lineWidth = Math.max(1, (strong ? 2.5 : 1.5) * a[2]);
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
    }
    // líneas de carril (la del centro separa las manos)
    for (let i = 0; i <= 8; i++) {
      const a = P(laneX(i), L.keyLen), b = P(laneX(i), far);
      const gr = g.createLinearGradient(0, b[1], 0, a[1]);
      const strong = i === 4;
      gr.addColorStop(0, "rgba(227,187,92,0)");
      gr.addColorStop(0.5, `rgba(227,187,92,${strong ? 0.7 : 0.18})`);
      gr.addColorStop(1, `rgba(227,187,92,${strong ? 0.8 : 0.22})`);
      g.strokeStyle = gr;
      g.lineWidth = Math.max(1, (strong ? 4 : 1.2) * a[2]);
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
    }
    // barandas doradas
    for (const [x0, x1] of [[-half - 18, -half], [half, half + 18]]) {
      const a = P(x0, 0), b = P(x1, 0), c = P(x1, far), d = P(x0, far);
      quad(a, b, c, d);
      const gr = g.createLinearGradient(0, d[1], 0, a[1]);
      gr.addColorStop(0, "rgba(227,187,92,0)");
      gr.addColorStop(0.4, "rgba(201,162,74,0.85)");
      gr.addColorStop(1, "#e3bb5c");
      g.fillStyle = gr;
      g.fill();
    }

    // notas, de la más lejana a la más cercana
    const vis = [];
    for (const n of game.notes) {
      const u = uOf(n.t);
      const uEnd = n.hold ? uOf(n.t + n.hold) : u;
      if (uEnd < L.keyLen - 80 || u > far + 10) continue;
      if (n.grade && n.grade !== "miss" && !n.holding) continue;
      vis.push([n, u, uEnd]);
    }
    vis.sort((a, b) => b[1] - a[1]);
    const right = (n) => n.lane >= 4;
    // colas de las notas largas
    for (const [n, u, uEnd] of vis) {
      if (!n.hold) continue;
      const cx = laneX(n.lane) + laneW / 2, w = laneW * 0.13;
      const u0 = n.holding ? L.keyLen : u, u1 = Math.min(far, uEnd);
      if (u1 <= u0) continue;
      const a = P(cx - w, u0, 6), b = P(cx + w, u0, 6), c = P(cx + w, u1, 6), d = P(cx - w, u1, 6);
      quad(a, b, c, d);
      const gr = g.createLinearGradient(0, d[1], 0, a[1]);
      const col = right(n) ? "255,246,222" : "240,200,112";
      const miss = n.grade === "miss";
      gr.addColorStop(0, `rgba(${col},0)`);
      gr.addColorStop(0.25, `rgba(${col},${miss ? 0.15 : 0.55})`);
      gr.addColorStop(1, `rgba(${col},${miss ? 0.2 : n.holding ? 1 : 0.85})`);
      g.fillStyle = gr;
      g.fill();
    }
    for (const [n, u] of vis) {
      if (n.holding || n.grade === "perfect" || n.grade === "good") continue;
      const x0 = laneX(n.lane) + 5, x1 = laneX(n.lane + 1) - 5;
      const miss = n.grade === "miss";
      const alpha = fogAt(u) * (miss ? 0.35 : 1);
      if (alpha <= 0.01) continue;
      const top = miss ? ["#6b5a4a", "#4a3a2e"] : right(n) ? ["#fffaf0", "#e3d4ae"] : ["#f6d488", "#c99238"];
      const side = miss ? "#2e241c" : right(n) ? "#a3906a" : "#7a4f18";
      const [a, b] = box(x0, x1, u - L.noteLen / 2, u + L.noteLen / 2, L.noteT, top, side, alpha);
      // brillo del borde de arriba
      g.globalAlpha = alpha * 0.5;
      g.strokeStyle = "#fff";
      g.lineWidth = Math.max(1, 2 * a[2]);
      g.beginPath(); g.moveTo(a[0] + 3, a[1] - 1); g.lineTo(b[0] - 3, b[1] - 1); g.stroke();
      g.globalAlpha = 1;
    }

    // botones objetivo: la nota se pisa cuando su centro cae sobre la línea dorada del medio.
    // Cada botón se enciende a medida que se acerca su próxima nota.
    {
      const approach = new Array(8).fill(0);
      for (const i of active) {
        const list = game.byLane[i];
        for (let j = game.next[i]; j < list.length; j++) {
          const n = list[j];
          if (n.grade) continue;
          const d = n.t - now;
          if (d > 0.5) break;
          approach[i] = Math.max(approach[i], 1 - Math.max(0, d) / 0.5);
          break;
        }
      }
      const pu0 = L.keyLen - L.noteLen * 0.62, pu1 = L.keyLen + L.noteLen * 0.62;
      for (const i of active) {
        const a = approach[i], down = held.has(i);
        const x0 = laneX(i) + 4, x1 = laneX(i + 1) - 4;
        const warm = i >= 4 ? "255,240,205" : "255,208,110";
        const c0 = P(x0, pu0, 3), c1 = P(x1, pu0, 3), c2 = P(x1, pu1, 3), c3 = P(x0, pu1, 3);
        quad(P(x0, pu0, 0), P(x1, pu0, 0), c1, c0);
        g.fillStyle = "#0c0406";
        g.fill();
        quad(c0, c1, c2, c3);
        g.fillStyle = `rgba(${warm},${0.08 + a * a * 0.55 + (down ? 0.25 : 0)})`;
        g.fill();
        g.save();
        if (a > 0.6 || down) { g.shadowColor = `rgba(${warm},0.9)`; g.shadowBlur = (8 + a * 14) * s; }
        g.strokeStyle = down ? "#fff4d0" : `rgba(227,187,92,${0.55 + a * 0.45})`;
        g.lineWidth = Math.max(1.5, (2 + a * 2) * c0[2]);
        quad(c0, c1, c2, c3);
        g.stroke();
        g.restore();
      }
      // línea de golpe por el centro de los botones
      const a = P(-half, L.keyLen - 2.5, 4), b = P(half, L.keyLen - 2.5, 4), c = P(half, L.keyLen + 2.5, 4), d = P(-half, L.keyLen + 2.5, 4);
      g.save();
      g.shadowColor = "rgba(255,210,120,0.9)";
      g.shadowBlur = 14 * s;
      quad(a, b, c, d);
      g.fillStyle = pedalOn ? "#fff1c0" : "#f3d27a";
      g.fill();
      g.restore();
    }

    // destellos al acertar: brillo en la pista y columna de luz que sube de la tecla
    for (const e of effects) {
      const age = now - e.t;
      const life = e.hold ? 0.12 : 0.32;
      if (!e.hold && (age < 0 || age > life)) continue;
      const k = e.hold ? 0.75 : 1 - age / life;
      const x0 = laneX(e.lane), x1 = x0 + laneW, cx = x0 + laneW / 2;
      const warm = e.lane >= 4 ? "255,244,214" : "255,214,120";
      const base = P(cx, L.keyLen, 2);
      const glow = g.createRadialGradient(base[0], base[1], 2, base[0], base[1], laneW * 1.1 * base[2]);
      glow.addColorStop(0, `rgba(${warm},${0.85 * k})`);
      glow.addColorStop(1, `rgba(${warm},0)`);
      g.fillStyle = glow;
      g.beginPath(); g.ellipse(base[0], base[1], laneW * 1.1 * base[2], laneW * 0.5 * base[2], 0, 0, Math.PI * 2); g.fill();
      const hgt = L.colH * (e.hold ? 0.8 : 0.6 + 0.4 * (1 - k));
      for (const [w, a] of [[laneW / 2, 0.5], [laneW * 0.17, 0.95]]) {
        const q0 = P(cx - w, L.keyLen, 0), q1 = P(cx + w, L.keyLen, 0), q2 = P(cx + w, L.keyLen, hgt), q3 = P(cx - w, L.keyLen, hgt);
        quad(q0, q1, q2, q3);
        const gr = g.createLinearGradient(0, q3[1], 0, q0[1]);
        gr.addColorStop(0, `rgba(${warm},0)`);
        gr.addColorStop(1, `rgba(${warm},${a * k})`);
        g.fillStyle = gr;
        g.fill();
      }
      // chispas
      if (!e.hold) {
        for (let j = 0; j < 4; j++) {
          const sx = x0 + laneW * (0.2 + ((e.seed * (j + 3)) % 1) * 0.6);
          const sp = P(sx, L.keyLen, 20 + age * (300 + j * 120));
          g.fillStyle = `rgba(255,236,170,${k})`;
          g.beginPath(); g.arc(sp[0], sp[1], Math.max(1, 3 * sp[2]), 0, Math.PI * 2); g.fill();
        }
      }
    }

    // teclado: blancas con frente, negras encima. Termina antes de los botones para no taparlos.
    const keyEnd = L.keyLen - L.noteLen * 0.62 - 10;
    for (let i = 0; i < 8; i++) {
      const down = held.has(i);
      const on = active.has(i);
      const h = down ? L.keyDown : L.keyT;
      const lit = down && on;
      const top = lit ? (i >= 4 ? ["#f3e2b0", "#fffdf6"] : ["#f0c870", "#fff6dc"]) : on ? ["#cfc09a", "#fbf6e8"] : ["#6e6656", "#8d8572"];
      const side = lit ? "#b8955a" : on ? "#a8966a" : "#4a4436";
      const [a, b, c, d] = box(laneX(i) + 2, laneX(i + 1) - 2, 2, keyEnd, h, top, side);
      if (L.letters && on) {
        const p = P(laneX(i) + laneW / 2, 26, h);
        g.fillStyle = lit ? "#7a4f18" : "#7a5a36";
        g.font = `700 ${Math.round(30 * p[2])}px "Cormorant Garamond", serif`;
        g.textAlign = "center";
        g.textBaseline = "alphabetic";
        g.fillText(KEY_LETTERS[i], p[0], p[1]);
      }
    }
    for (const bi of BLACK_AT) {
      const cx = laneX(bi);
      const w = laneW * 0.26;
      box(cx - w, cx + w, keyEnd * 0.46, keyEnd, L.blackT, ["#4a3a2e", "#120c09"], "#0a0604");
    }

    // cuerpo del piano debajo de las teclas
    {
      const a = P(-half - 20, 0);
      const top = a[1] + L.keyT * 0.9 * a[2];
      const x0 = a[0] - 10 * s, x1 = P(half + 20, 0)[0] + 10 * s;
      const gr = g.createLinearGradient(0, top, 0, oy + L.H * s);
      gr.addColorStop(0, "#3a1f12");
      gr.addColorStop(1, "#1a0d07");
      g.fillStyle = gr;
      g.fillRect(x0, top, x1 - x0, ch - top);
      g.fillStyle = "#c9a24a";
      g.fillRect(x0, top, x1 - x0, 3 * s);
      if (L.letters && top + 30 * s < ch) {
        g.font = `700 ${Math.round(13 * s)}px "Cormorant Garamond", serif`;
        g.fillStyle = "rgba(227,187,92,0.75)";
        g.textBaseline = "middle";
        const my = top + 26 * s;
        g.textAlign = "left";
        g.fillText("M A N O   I Z Q U I E R D A", x0 + 30 * s, my);
        g.textAlign = "right";
        g.fillText("M A N O   D E R E C H A", x1 - 30 * s, my);
        g.textAlign = "center";
        g.font = `900 ${Math.round(22 * s)}px "Playfair Display", serif`;
        g.fillStyle = "#c9a24a";
        g.fillText("Tasti", (x0 + x1) / 2, my);
      }
    }

    if (st.crowd) drawCrowd(g, P, st.crowd, now, L.planeH * 0.55);

    g.drawImage(front, 0, 0, cw, ch);

    // palabras que flotan: juicio del acierto y toses del público
    for (const w of st.words) {
      const age = now - w.t;
      if (age < 0 || age > w.life) continue;
      const k = 1 - age / w.life;
      const [x, y] = w.cough
        ? [ox + w.x * L.W * s, oy + (L.H - 120 - age * 60) * s]
        : P(0, L.keyLen + (L === LAYOUTS.desk ? 360 : 190), 0);
      g.globalAlpha = Math.min(1, k * 2);
      g.textAlign = "center";
      g.textBaseline = "alphabetic";
      if (w.cough) {
        g.font = `italic 500 ${Math.round(22 * s)}px "Cormorant Garamond", serif`;
        g.fillStyle = "#d9c79c";
        g.fillText(w.text, x, y);
      } else {
        const size = Math.round((L === LAYOUTS.desk ? 48 : 30) * s * (1 + 0.15 * Math.max(0, 1 - age * 6)));
        g.font = `italic 900 ${size}px "Playfair Display", serif`;
        const depth = Math.round(6 * s);
        const steps = ["#c99a3e", "#b8892f", "#a67a28", "#946b22", "#7a5a1e", "#5f4111"];
        for (let d = depth; d >= 1; d--) {
          g.fillStyle = steps[Math.min(steps.length - 1, Math.floor(((d - 1) / depth) * steps.length))];
          g.fillText(w.text, x, y + d);
        }
        g.fillStyle = w.color || "#f6d27e";
        g.fillText(w.text, x, y);
        if (w.sub) {
          g.font = `italic 600 ${Math.round((L === LAYOUTS.desk ? 24 : 16) * s)}px "Cormorant Garamond", serif`;
          g.fillStyle = "#f3e6c8";
          g.fillText(w.sub, x, y + size * 0.55);
        }
      }
      g.globalAlpha = 1;
    }
  }

  /** Qué carril hay bajo un punto de la pantalla (para tocar con el dedo). -1 si ninguno. */
  function laneAt(px, py) {
    // buscar a qué altura de la pista corresponde esa y (la pista sube hacia el fondo)
    let u = 0;
    const yBottom = P(0, 0, L.keyT)[1];
    if (py < yBottom) {
      let lo = 0, hi = L.planeH;
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        if (P(0, mid)[1] > py) lo = mid; else hi = mid;
      }
      u = lo;
    }
    const left = P(-L.planeW / 2, u)[0], rightX = P(L.planeW / 2, u)[0];
    if (px < left || px > rightX) return { lane: -1, side: px < left ? "L" : "R" };
    return { lane: Math.min(7, Math.floor(((px - left) / (rightX - left)) * 8)) };
  }

  resize();
  return { resize, draw, laneAt, get phone() { return L === LAYOUTS.phone; } };
}
