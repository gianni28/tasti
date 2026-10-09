# Tasti

Juego de ritmo de piano en el navegador, hermano de [Corde](https://github.com/gianni28/corde). Se toca con 8 dedos: `A S D F` para la mano izquierda y `J K L Ñ` para la derecha. Las piezas son clásicos de dominio público cargados desde archivos MIDI.

**Stack:** Vite · Canvas 2D con perspectiva propia · Web Audio API · @tonejs/midi · fuentes autoalojadas (@fontsource) · Netlify

## Cómo se juega

- Las notas bajan por una pista de 8 carriles (4 por mano) hasta el teclado. Pulsas la tecla de ese carril cuando la nota llega a la línea dorada.
- **Las notas que no te tocan suenan solas.** Si la dificultad recorta un acorde o deja la mano izquierda en automático, esas notas igual suenan, así que la pieza siempre suena completa.
- **Si fallas, esa nota no suena.** La pieza queda con un hueco y el público tose.
- **Notas largas:** se pueden mantener para sumar puntos y llenar el pedal. Si sueltas antes, la nota se apaga.
- **Pedal** (`Espacio`; en el celular, tocando a los dos lados de la pista a la vez): con medio medidor o más, duplica los puntos durante unos segundos.
- Al final, **el crítico** escribe una reseña según tu precisión.

| Dificultad | Qué tocas |
|---|---|
| Fácil | Solo la mano derecha; la izquierda suena sola |
| Medio | Ambas manos; la izquierda, sencilla (una nota cada 0,4 s como mínimo) |
| Difícil | Ambas manos, hasta 2 notas juntas por mano |
| Experto | Hasta 3 notas juntas por mano, pista más rápida |

En el celular se juega en horizontal y con el teléfono apoyado. Cada carril se toca con un dedo, y si deslizas el dedo hacia otro carril tocas un glissando.

## Cómo se convierte un MIDI en carriles (`src/convert.js`)

1. **Manos:** si el MIDI trae dos o más pistas, la más grave es la mano izquierda. Si trae una sola pista, se separa por altura con un punto de corte que se va moviendo según lo que viene tocando cada mano.
2. **Qué tocas:** según la dificultad, cada acorde se recorta a 1, 2 o 3 notas. En la derecha se queda la nota de arriba (la melodía) y en la izquierda el bajo. También se quitan las notas demasiado pegadas. Todo lo que se quita pasa a `auto` y suena solo.
3. **Carril de cada nota:** la nota real suena siempre; el carril depende de dónde cae esa nota respecto a las que la rodean (±0,9 s): la más grave va a la izquierda y la más aguda a la derecha. Después se corrige para que el carril siga la dirección de la melodía, que una nota repetida quede en el mismo carril y que dos notas distintas seguidas nunca compartan carril. Si una escala llega al borde, vuelve a empezar desde el otro lado, como una cascada.

`npm run check` revisa el conversor con un MIDI y muestra cuántas notas tocas por dificultad, cómo se reparten por carril y si alguna regla se rompe:

```bash
npm run check                    # el Preludio de Bach
npm run check -- otra-pieza.mid  # cualquier MIDI
```

## Puesta en marcha

```bash
npm install
npm run dev
```

Abre `http://localhost:5173`. Con `?bot` al final de la dirección, el juego toca solo (sirve para probar).

Para probar cualquier pieza: en el menú, **Cargar un MIDI propio**. Se convierte en el navegador; no se sube a ningún lado.

**Netlify:** conecta el repo. Build `npm run build`, carpeta `dist` (ya está en `netlify.toml`).

## Piezas

Cada pieza es un `.mid` en `public/songs/` con su ficha en `src/songs.js`.

- **Preludio en Do mayor, BWV 846 (Bach):** lo genera `scripts/make-bach.mjs` (`npm run make-bach`). Es una transcripción escrita aquí, así que el archivo no tiene dueño.

Para agregar más piezas, usa solo obras de dominio público y MIDIs con licencia libre, como los de [Mutopia](https://www.mutopiaproject.org/) o [IMSLP](https://imslp.org/). Muchos MIDIs de internet sí tienen dueño aunque la obra sea libre.

## Sonido

Piano de cola **Salamander Grand Piano** de Alexander Holm ([CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)), con las muestras servidas desde tonejs.github.io. Hay una muestra cada tercera menor y las notas intermedias se afinan cambiando la velocidad de reproducción. La reverberación de sala se genera en el navegador. Si las muestras no cargan (por ejemplo, sin conexión), suena un piano sintetizado.

## Estructura

```
src/
  midi.js       lee el .mid → notas planas en segundos y pulsos del compás
  convert.js    manos, dificultades y carriles; lo que no tocas queda en auto
  game.js       lógica: ventanas de acierto, combo, notas largas, pedal, el crítico (sin pantalla)
  audio.js      piano por muestras, reverberación, voces que se pueden soltar
  renderer.js   la sala y la pista en canvas 2D (perspectiva, notas con grosor, teclas con frente)
  main.js       menú, partida, controles (teclado y táctil), resultados
  songs.js      el programa
scripts/
  make-bach.mjs     genera el MIDI del Preludio
  check-chart.mjs   revisa el conversor
```

## Pendiente

- Más piezas (Mozart K. 545, Para Elisa, Gymnopédie n.º 1, Chopin)
- Calibración de latencia en Ajustes, teclas configurables
- Modo dúo (una mano por celular), clasificaciones con Supabase
- Retrato del compositor que reacciona y público que aplaude
