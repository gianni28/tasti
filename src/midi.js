// Lee un archivo MIDI y lo deja en notas planas: { t, dur, midi, vel, track } en segundos.
import tonejsMidi from "@tonejs/midi";
const { Midi } = tonejsMidi;

/** buffer: ArrayBuffer o Uint8Array con el .mid */
export function readMidi(buffer, fallbackName = "Sin título") {
  const midi = new Midi(buffer);
  const notes = [];
  midi.tracks.forEach((track, ti) => {
    // canal 10 es percusión en General MIDI: no es piano
    if (track.channel === 9) return;
    for (const n of track.notes) {
      if (n.duration <= 0) continue;
      notes.push({ t: n.time, dur: n.duration, midi: n.midi, vel: n.velocity, track: ti });
    }
  });
  notes.sort((a, b) => a.t - b.t || a.midi - b.midi);

  // Pulsos: una línea en la pista por cada tiempo del compás (la primera de cada compás más marcada)
  const ppq = midi.header.ppq || 480;
  const sig = midi.header.timeSignatures[0]?.timeSignature || [4, 4];
  const beatTicks = ppq * (4 / sig[1]);
  const end = notes.length ? Math.max(...notes.map((n) => n.t + n.dur)) : 0;
  const beats = [];
  for (let tick = 0, i = 0; ; tick += beatTicks, i++) {
    const t = midi.header.ticksToSeconds(tick);
    if (t > end + 0.5 || i > 20000) break;
    beats.push([t, i % sig[0] === 0 ? 1 : 0]);
  }

  return { name: midi.header.name?.trim() || fallbackName, notes, beats, duration: end };
}
