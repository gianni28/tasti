// Ajustes del jugador, guardados en este navegador.
const KEY = "tasti.settings";

export const DEFAULT_KEYS = ["KeyA", "KeyS", "KeyD", "KeyF", "KeyJ", "KeyK", "KeyL", "Semicolon"];
const DEFAULTS = {
  latency: 0, // ms que se corre todo (positivo: las notas llegan más tarde)
  speed: 1, // velocidad de la pista
  pianoVol: 1,
  roomVol: 0.8,
  keys: DEFAULT_KEYS,
  pedalKey: "Space",
};

export function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "{}");
    const out = { ...DEFAULTS, ...s };
    if (!Array.isArray(out.keys) || out.keys.length !== 8) out.keys = DEFAULT_KEYS;
    return out;
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
}

// nombre legible de una tecla por su posición física (e.code): la de al lado de la L es la Ñ en teclado español
const NAMES = { Semicolon: "Ñ", Space: "Espacio", Quote: "´", BracketLeft: "`", BracketRight: "+", Backslash: "Ç", Comma: ",", Period: ".", Slash: "-", Minus: "'", Equal: "¡", ShiftLeft: "Mayús", ShiftRight: "Mayús", Enter: "Enter", Tab: "Tab", CapsLock: "Bloq Mayús", ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", ControlLeft: "Ctrl", AltLeft: "Alt", AltRight: "Alt Gr", Backspace: "Borrar" };
export function keyName(code) {
  if (NAMES[code]) return NAMES[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return "Num " + code.slice(6);
  return code;
}
