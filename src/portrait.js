// Retrato del compositor, en caricatura, que reacciona a cómo vas.
// mood: "delight" (encantado) | "approve" (aprueba) | "neutral" | "frown" (desaprueba)

const FACES = {
  delight: {
    brows: '<path d="M33 49 Q40 44 47 48" /><path d="M53 48 Q60 44 67 49" />',
    eyes: '<path d="M36 57 Q41 53 46 57" /><path d="M54 57 Q59 53 64 57" />',
    mouth: '<path d="M40 76 Q50 86 60 76" />',
    cheeks: true,
  },
  approve: {
    brows: '<path d="M34 51 L46 50" /><path d="M54 48 Q60 43 67 49" />',
    eyes: '<circle cx="41" cy="58" r="2.4" class="fill" /><circle cx="59" cy="58" r="2.4" class="fill" />',
    mouth: '<path d="M43 78 Q50 83 57 78" />',
  },
  neutral: {
    brows: '<path d="M34 51 L46 51" /><path d="M54 51 L66 51" />',
    eyes: '<circle cx="41" cy="58" r="2.4" class="fill" /><circle cx="59" cy="58" r="2.4" class="fill" />',
    mouth: '<path d="M43 79 L57 79" />',
  },
  frown: {
    brows: '<path d="M34 48 L46 53" /><path d="M54 53 L66 48" />',
    eyes: '<circle cx="41" cy="59" r="2.4" class="fill" /><circle cx="59" cy="59" r="2.4" class="fill" />',
    mouth: '<path d="M42 82 Q50 75 58 82" />',
  },
};

export function portraitSVG(mood = "neutral") {
  const f = FACES[mood] || FACES.neutral;
  return `<svg viewBox="0 0 100 120" width="100%" height="100%" role="img" aria-label="El compositor, ${{ delight: "encantado", approve: "aprueba", neutral: "atento", frown: "desaprueba" }[mood]}">
  <rect width="100" height="120" fill="#3b1a1d"/>
  <ellipse cx="50" cy="36" rx="31" ry="23" fill="#efe6d4" stroke="#cbbd9f" stroke-width="1.5"/>
  <circle cx="22" cy="54" r="14" fill="#efe6d4" stroke="#cbbd9f" stroke-width="1.5"/>
  <circle cx="78" cy="54" r="14" fill="#efe6d4" stroke="#cbbd9f" stroke-width="1.5"/>
  <circle cx="17" cy="74" r="10" fill="#efe6d4" stroke="#cbbd9f" stroke-width="1.5"/>
  <circle cx="83" cy="74" r="10" fill="#efe6d4" stroke="#cbbd9f" stroke-width="1.5"/>
  <ellipse cx="50" cy="62" rx="22" ry="28" fill="#e8c9a6"/>
  ${f.cheeks ? '<circle cx="36" cy="68" r="4" fill="#e59a8a" opacity="0.6"/><circle cx="64" cy="68" r="4" fill="#e59a8a" opacity="0.6"/>' : ""}
  <g stroke="#2a1710" stroke-width="2" fill="none" stroke-linecap="round">${f.brows}${f.eyes}${f.mouth}</g>
  <path d="M50 60 L47 70 L52 70" stroke="#b58a62" stroke-width="1.8" fill="none" stroke-linecap="round"/>
  <path d="M10 120 L36 98 L36 120 Z" fill="#5a2a3f"/>
  <path d="M90 120 L64 98 L64 120 Z" fill="#5a2a3f"/>
  <path d="M36 96 L50 108 L64 96 L64 120 L36 120 Z" fill="#f4efe4"/>
  <style>.fill{fill:#2a1710;stroke:none}</style>
</svg>`;
}

export function moodFor(energy, combo) {
  if (energy > 0.86 && combo >= 20) return "delight";
  if (energy > 0.66) return "approve";
  if (energy > 0.42) return "neutral";
  return "frown";
}
