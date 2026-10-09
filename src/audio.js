// Piano: muestras de un piano de cola real (Salamander Grand Piano, de Alexander Holm, CC BY 3.0)
// cada tercera menor; las notas intermedias se afinan cambiando la velocidad de la muestra.
// Si no cargan (sin internet), suena un piano sintetizado para que el juego siga funcionando.

const SAMPLE_BASE = "https://tonejs.github.io/audio/salamander/";
const SAMPLE_NOTES = [];
for (let m = 21; m <= 108; m += 3) SAMPLE_NOTES.push(m); // A0, C1, D#1, F#1 … C8
const SAMPLE_NAME = { 0: "C", 3: "Ds", 6: "Fs", 9: "A" };
const sampleUrl = (m) => `${SAMPLE_BASE}${SAMPLE_NAME[m % 12]}${Math.floor(m / 12) - 1}.mp3`;

let ctx = null;
let master = null; // todo pasa por aquí
let reverbIn = null;
const buffers = new Map(); // midi → AudioBuffer
const live = new Set(); // voces sonando o programadas, para poder callarlas al salir
let synthOnly = false;

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
let silentEl = null;

function silentWavUrl() {
  const rate = 8000, n = rate; // 1 s de silencio, 8 bits, mono
  const b = new ArrayBuffer(44 + n), v = new DataView(b);
  const w = (o, str) => [...str].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, 36 + n, true); w(8, "WAVE"); w(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  w(36, "data"); v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
  return URL.createObjectURL(new Blob([b], { type: "audio/wav" }));
}

export function audioCtx() {
  if (!ctx) {
    try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch {}
    ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: "interactive" });
    buildChain();
  }
  return ctx;
}

/** Llamar desde un toque o una tecla: en iPhone hace que suene aunque esté en silencio. */
export function unlockAudio() {
  const c = audioCtx();
  try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch {}
  if (isIOS && !navigator.audioSession) {
    if (!silentEl) {
      silentEl = document.createElement("audio");
      // un segundo de silencio en bucle pone la página en modo "reproducción"
      silentEl.src = silentWavUrl();
      silentEl.loop = true;
      silentEl.setAttribute("playsinline", "");
    }
    silentEl.play().catch(() => {});
  }
  if (c.state === "suspended") c.resume().catch(() => {});
}

function buildChain() {
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 3;
  comp.attack.value = 0.005;
  comp.release.value = 0.2;
  comp.connect(ctx.destination);

  master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(comp);

  // sala de conciertos: reverberación hecha con ruido que se apaga
  const len = Math.floor(ctx.sampleRate * 2.2);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
  }
  const conv = ctx.createConvolver();
  conv.buffer = ir;
  const wet = ctx.createGain();
  wet.gain.value = 0.22;
  reverbIn = ctx.createGain();
  reverbIn.connect(conv);
  conv.connect(wet);
  wet.connect(comp);
}

/** Carga las muestras que hacen falta para notas entre lo y hi. onProgress(0..1). */
export async function loadPiano(lo = 21, hi = 108, onProgress = () => {}) {
  audioCtx();
  const need = SAMPLE_NOTES.filter((m) => m >= lo - 3 && m <= hi + 3 && !buffers.has(m));
  if (!need.length) return { synth: synthOnly };
  let done = 0;
  const results = await Promise.allSettled(
    need.map(async (m) => {
      const res = await fetch(sampleUrl(m));
      if (!res.ok) throw new Error(res.status);
      const buf = await ctx.decodeAudioData(await res.arrayBuffer());
      buffers.set(m, buf);
      onProgress(++done / need.length);
    })
  );
  synthOnly = buffers.size === 0;
  if (results.some((r) => r.status === "rejected") && !synthOnly) console.warn("Tasti: faltan algunas muestras de piano");
  return { synth: synthOnly };
}

function nearestSample(midi) {
  let best = null, dist = Infinity;
  for (const m of buffers.keys()) {
    const d = Math.abs(m - midi);
    if (d < dist) { dist = d; best = m; }
  }
  return best;
}

/**
 * Toca una nota. when: tiempo del AudioContext (por defecto ya). dur: cuánto se sostiene antes de soltar.
 * Devuelve la voz, con release(at) para soltarla antes (notas largas que el jugador suelta).
 */
export function playNote(midi, vel = 0.6, when = 0, dur = 0.5) {
  const c = audioCtx();
  const t0 = Math.max(c.currentTime, when || 0);
  const gain = c.createGain();
  const level = 0.15 + Math.pow(Math.min(1, vel), 1.4) * 0.75;
  gain.connect(master);
  gain.connect(reverbIn);
  let stopAt;
  const voice = { sources: [], gain, ended: false };

  const s = !synthOnly && nearestSample(midi);
  if (s != null && s !== false) {
    const src = c.createBufferSource();
    src.buffer = buffers.get(s);
    src.playbackRate.value = Math.pow(2, (midi - s) / 12);
    src.connect(gain);
    gain.gain.setValueAtTime(level, t0);
    src.start(t0);
    voice.sources.push(src);
    stopAt = t0 + Math.min(src.buffer.duration / src.playbackRate.value, Math.max(0.05, dur) + 1.2);
  } else {
    // piano sintetizado: martillo (ataque rápido) y cuerda que se apaga
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    for (const [type, mult, amp] of [["triangle", 1, 0.6], ["sine", 2, 0.25], ["sine", 3, 0.1]]) {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = f * mult;
      const g = c.createGain();
      g.gain.value = amp;
      o.connect(g);
      g.connect(gain);
      o.start(t0);
      voice.sources.push(o);
    }
    const decay = 0.6 + (108 - midi) / 60;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(level * 0.8, t0 + 0.005);
    gain.gain.setTargetAtTime(level * 0.25, t0 + 0.01, decay * 0.25);
    stopAt = t0 + Math.max(0.05, dur) + 1.2;
  }

  // apagador: cuando se suelta la nota, se apaga rápido como en un piano real
  const off = t0 + Math.max(0.05, dur);
  gain.gain.setTargetAtTime(0, off, 0.09);
  for (const src of voice.sources) src.stop(stopAt);
  voice.sources[0].onended = () => { voice.ended = true; live.delete(voice); try { gain.disconnect(); } catch {} };

  voice.release = (at) => {
    if (voice.ended) return;
    const t = Math.max(c.currentTime, at || 0);
    gain.gain.cancelScheduledValues(t);
    gain.gain.setTargetAtTime(0, t, 0.08);
    for (const src of voice.sources) { try { src.stop(t + 0.6); } catch {} }
  };
  live.add(voice);
  return voice;
}

/** Calla todo lo que suena o está programado (reiniciar, salir). */
export function stopAll() {
  for (const v of live) v.release(0);
  live.clear();
}

export const isSynth = () => synthOnly;
