// Escribe public/songs/bach-preludio-do.mid: el Preludio en Do mayor (BWV 846) de J. S. Bach.
// La obra es de dominio público y esta transcripción se genera aquí mismo, así que el archivo
// no tiene dueño. Dos pistas, como la mayoría de MIDIs de piano: mano izquierda y mano derecha.
import tonejsMidi from "@tonejs/midi";
const { Midi } = tonejsMidi;
import { writeFileSync, mkdirSync } from "node:fs";

const BPM = 66;
const SIXTEENTH = 60 / BPM / 4;

const NAMES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const midiOf = (n) => {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(n);
  if (!m) throw new Error("nota rara: " + n);
  return 12 * (Number(m[3]) + 1) + NAMES[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
};

// Cada compás: [bajo, voz media, y las tres notas de la figura que repite la derecha]
const BARS = [
  "C4 E4 G4 C5 E5", "C4 D4 A4 D5 F5", "B3 D4 G4 D5 F5", "C4 E4 G4 C5 E5",
  "C4 E4 A4 E5 A5", "C4 D4 F#4 A4 D5", "B3 D4 G4 D5 G5", "B3 C4 E4 G4 C5",
  "A3 C4 E4 G4 C5", "D3 A3 D4 F#4 C5", "G3 B3 D4 G4 B4", "G3 Bb3 E4 G4 C#5",
  "F3 A3 D4 A4 D5", "F3 Ab3 D4 F4 B4", "E3 G3 C4 G4 C5", "E3 F3 A3 C4 F4",
  "D3 F3 A3 C4 F4", "G2 D3 G3 B3 F4", "C3 E3 G3 C4 E4", "C3 G3 Bb3 C4 E4",
  "F2 F3 A3 C4 E4", "F#2 C3 A3 C4 Eb4", "Ab2 F3 B3 C4 D4", "G2 F3 G3 B3 D4",
  "G2 E3 G3 C4 E4", "G2 D3 G3 C4 F4", "G2 D3 G3 B3 F4", "G2 Eb3 A3 C4 F#4",
  "G2 E3 G3 C4 G4", "G2 D3 G3 C4 F4", "G2 D3 G3 B3 F4", "C2 C3 G3 Bb3 E4",
].map((b) => b.split(" ").map(midiOf));

const midi = new Midi();
midi.header.setTempo(BPM);
midi.header.name = "Preludio en Do mayor, BWV 846";
const left = midi.addTrack();
left.name = "Mano izquierda";
const right = midi.addTrack();
right.name = "Mano derecha";

const s = (n) => n * SIXTEENTH;
let t = 0;
for (const [b, m, x, y, z] of BARS) {
  for (let half = 0; half < 2; half++) {
    const t0 = t + s(8 * half);
    left.addNote({ midi: b, time: t0, duration: s(8) * 0.98, velocity: 0.62 });
    left.addNote({ midi: m, time: t0 + s(1), duration: s(7) * 0.98, velocity: 0.52 });
    [x, y, z, x, y, z].forEach((p, i) => {
      right.addNote({ midi: p, time: t0 + s(2 + i), duration: s(1) * 1.4, velocity: i % 3 === 0 ? 0.6 : 0.5 });
    });
  }
  t += s(16);
}

// Coda: el bajo queda sobre Do y la derecha corre en semicorcheas hasta el acorde final.
const coda = [
  ["C2", "C3", "F3 A3 C4 F4 C4 A3 C4 A3 F3 A3 F3 D3 F3 D3"],
  ["C2", "B2", "G4 B4 D5 F5 D5 B4 D5 B4 G4 B4 D4 F4 E4 D4"],
];
for (const [b, m, run] of coda) {
  left.addNote({ midi: midiOf(b), time: t, duration: s(16) * 0.98, velocity: 0.62 });
  left.addNote({ midi: midiOf(m), time: t + s(1), duration: s(15) * 0.98, velocity: 0.52 });
  run.split(" ").forEach((n, i) => {
    right.addNote({ midi: midiOf(n), time: t + s(2 + i), duration: s(1) * 1.4, velocity: 0.55 });
  });
  t += s(16);
}
// Acorde final, con un poco de calderón
const fin = s(16) * 1.6;
left.addNote({ midi: midiOf("C2"), time: t, duration: fin, velocity: 0.6 });
left.addNote({ midi: midiOf("C3"), time: t, duration: fin, velocity: 0.55 });
for (const n of ["E4", "G4", "C5"]) right.addNote({ midi: midiOf(n), time: t, duration: fin, velocity: 0.55 });

mkdirSync("public/songs", { recursive: true });
writeFileSync("public/songs/bach-preludio-do.mid", Buffer.from(midi.toArray()));
console.log(`listo: ${left.notes.length + right.notes.length} notas, ${(t + fin).toFixed(1)} s`);
