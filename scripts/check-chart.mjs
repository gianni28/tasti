// Revisa el conversor con un MIDI: cuántas notas tocas, cuántas suenan solas, y si los carriles tienen sentido.
// Uso: node scripts/check-chart.mjs [archivo.mid]
import { readFileSync } from "node:fs";
import { readMidi } from "../src/midi.js";
import { buildChart, DIFFS } from "../src/convert.js";

const file = process.argv[2] || "public/songs/bach-preludio-do.mid";
const raw = readMidi(readFileSync(file), file);
console.log(`${raw.name}: ${raw.notes.length} notas, ${raw.duration.toFixed(1)} s, ${raw.beats.length} pulsos\n`);

let problems = 0;
for (const key of Object.keys(DIFFS)) {
  const c = buildChart(raw, key);
  const holds = c.notes.filter((n) => n.hold).length;
  const nps = c.notes.length / c.duration;

  // reglas: carril válido; dos notas juntas nunca en el mismo carril; misma mano, nota distinta seguida → carril distinto
  let wrongDir = 0, sameLaneDiffPitch = 0, consecutive = 0;
  for (const hand of [0, 4]) {
    const mine = c.notes.filter((n) => n.lane >= hand && n.lane < hand + 4);
    const groups = [];
    for (const n of mine) {
      const g = groups[groups.length - 1];
      if (g && n.t - g.t < 0.03) g.push(n); else groups.push([n]);
    }
    for (const g of groups) {
      const lanes = new Set(g.map((n) => n.lane));
      if (lanes.size !== g.length) { problems++; console.log("  acorde con carril repetido en", g[0].t.toFixed(2)); }
    }
    for (let i = 1; i < groups.length; i++) {
      const a = groups[i - 1], b = groups[i];
      if (a.length !== 1 || b.length !== 1 || b[0].t - a[0].t > 1.2) continue;
      consecutive++;
      const d = b[0].midi - a[0].midi, dl = b[0].lane - a[0].lane;
      if (d !== 0 && dl === 0) sameLaneDiffPitch++;
      if ((d > 0 && dl < 0) || (d < 0 && dl > 0)) wrongDir++;
    }
  }
  for (const n of c.notes) if (n.lane < 0 || n.lane > 7) { problems++; console.log("  carril fuera de rango", n); }

  const perLane = new Array(8).fill(0);
  for (const n of c.notes) perLane[n.lane]++;
  console.log(
    `${DIFFS[key].label.padEnd(8)} tocas ${String(c.notes.length).padStart(4)} (${nps.toFixed(1)}/s, ${holds} largas) · solas ${String(c.auto.length).padStart(4)}` +
      ` · por carril [${perLane.join(" ")}]` +
      ` · seguidas ${consecutive}: mismo carril con otra nota ${sameLaneDiffPitch}, dirección al revés ${wrongDir}`
  );
}

// los dos primeros compases en Medio, para verlos a ojo
const c = buildChart(raw, "medium");
const NAMES = ["Do", "Do#", "Re", "Mib", "Mi", "Fa", "Fa#", "Sol", "Lab", "La", "Sib", "Si"];
console.log("\nMedio, primeros 4 s (tiempo · carril · nota):");
for (const n of c.notes.filter((n) => n.t < 4)) {
  const lane = n.lane < 4 ? `I${n.lane + 1}` : `D${n.lane - 3}`;
  console.log(`  ${n.t.toFixed(2).padStart(5)}  ${lane}  ${NAMES[n.midi % 12]}${Math.floor(n.midi / 12) - 1}${n.hold ? "  (larga " + n.hold.toFixed(1) + " s)" : ""}`);
}
if (problems) { console.log(`\n${problems} problemas`); process.exit(1); }
