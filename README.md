# Tasti

Juego de ritmo de piano en el navegador, hermano de [Corde](https://github.com/gianni28/corde). Se toca con 8 dedos: `A S D F` para la mano izquierda y `J K L Ñ` para la derecha. Las piezas son clásicos de dominio público en MIDI, con una biblioteca en línea a la que el admin sube canciones desde el mismo juego.

**Stack:** Vite · Canvas 2D con perspectiva propia · Web Audio API · @tonejs/midi · Supabase (Postgres + funciones SQL, sin Edge Functions) · Netlify

## Cómo se juega

- Las notas bajan por una pista de 8 carriles (4 por mano) hasta una fila de **botones dorados**, justo antes del teclado. Pulsas cuando la nota queda **encima de su botón**, partida por la línea dorada del medio. El botón se va encendiendo a medida que la nota se acerca.
- Antes de empezar, el juego **cuenta 1-2-3-4** con metrónomo, al tempo de la pieza. Si aciertas por poco, te dice si fue **un poco pronto** o **un poco tarde**.
- **Las notas que no te tocan suenan solas.** Si la dificultad recorta un acorde o deja una mano en automático, la pieza igual suena completa.
- **Si fallas, esa nota no suena.** La pieza queda con un hueco y el público tose.
- **Notas largas** (0,75 s o más): se mantienen para sumar puntos y llenar el pedal.
- **Pedal** (`Espacio`; en el celular, tocando a los dos lados de la pista): con media barra o más, duplica los puntos durante unos segundos.
- **El público** está sentado en el escenario, en 3D. Se mece y cabecea al pulso, aplaude con la racha y cada 50 seguidas se pone de pie y tira rosas. Al final hay ovación si tocaste bien. Cuando fallas tose, con varios fallos seguidos los vecinos se miran, y si la cosa va muy mal se van. El **retrato del compositor** también reacciona.
- Al final, **el crítico** escribe una reseña según tu precisión, y tu puntaje entra a la **clasificación**.

| Dificultad | Qué tocas |
|---|---|
| Fácil | Solo la mano derecha; la izquierda suena sola |
| Medio | Ambas manos; la izquierda, sencilla |
| Difícil | Ambas manos, hasta 2 notas juntas por mano |
| Experto | Hasta 3 notas juntas por mano, pista más rápida |

Cada nivel muestra su dificultad en estrellas (de 1 a 5), calculada por notas por segundo, acordes y velocidad de la pista.

**Ensayo:** un tutorial guiado de un minuto que enseña cada mano, las dos juntas, las notas largas y el pedal, y termina con el Himno de la alegría.

**Ajustes:** sincronía (con calibración por metrónomo), velocidad de la pista, volumen del piano y del público, y teclas configurables (se guardan por posición física, así sirven en teclados en español o en inglés).

**Celular:** en horizontal y con el teléfono apoyado. Cada carril se toca con un dedo, y si deslizas el dedo hacia otro carril tocas un glissando. Se puede instalar como app y funciona sin conexión con las piezas que ya se cargaron.

## Subir canciones

1. En el juego: **Ajustes → Subir canciones a la biblioteca** (o abre la página con `#admin` al final de la dirección) y escribe el código de admin.
2. Elige uno o varios `.mid`, o arrástralos a la ventana. El juego adivina el título y el compositor por el nombre del archivo (`Mozart - Sonata K545.mid` → «Sonata K545», W. A. Mozart, 1756–1791) y muestra cuántas notas y cuántas estrellas tendría cada nivel.
3. Corrige la ficha si hace falta. La **frase del compositor** es la que sale en el menú.
4. **Probarla antes** la abre para jugarla sin subirla. **Subir** la deja en la biblioteca para todos.
5. En la lista de abajo puedes **editar**, **esconder** o **borrar** las que ya están (al borrar una pieza se borran también sus puntajes). Ahí mismo se cambia el código de admin.

Funcionan mejor los MIDIs de piano con dos pistas (mano izquierda y mano derecha). Si viene todo en una pista, el juego separa las manos por altura. Usa solo obras de dominio público y MIDIs con licencia libre, como los de [Mutopia](https://www.mutopiaproject.org/) o [IMSLP](https://imslp.org/): muchos MIDIs de internet sí tienen dueño aunque la obra sea libre.

Cualquier jugador también puede **probar un MIDI de su computador** desde el menú. Ese MIDI se queda en su navegador y no se sube.

## Puesta en marcha

1. **Supabase:** crea un proyecto. En **SQL Editor** pega `supabase/tasti.sql`, cambia `TU-CODIGO` por tu código de admin en la última línea y dale **Run**. Crea las tablas de canciones, jugadores y puntajes, y las funciones que las protegen. Se puede volver a correr sin borrar nada.
2. **Conexión:** pon la **Project URL** y la **anon key** (Project Settings → API) en `src/config.js`, o como variables `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` (en un `.env` local o en Netlify). Las dos son públicas. La service role no se usa en ningún lado.
3. **Correr:**
   ```bash
   npm install
   npm run dev
   ```
   Con `?bot` al final de la dirección, el juego toca solo (sirve para probar).
4. **Netlify:** conecta el repo. Build `npm run build`, carpeta `dist` (ya está en `netlify.toml`).

Sin Supabase el juego igual funciona: solo con las piezas incluidas y sin clasificación.

## Cómo está protegida la biblioteca

- Todo lo que escribe pasa por funciones SQL `security definer`. Las tablas no aceptan escrituras directas desde la página.
- El código de admin se guarda con bcrypt (`pgcrypto`) y ninguna consulta lo puede leer. En el navegador solo vive mientras la pestaña está abierta.
- **Jugadores:** cada nombre existe una sola vez (sin distinguir mayúsculas) y se pide una sola vez. El navegador guarda un token, y el nombre queda atado a ese token.
- **Puntajes:** se guarda el mejor de cada jugador por pieza y nivel. Se rechazan puntajes imposibles para la cantidad de notas de la pieza, y envíos con menos de 3 segundos de diferencia.

## Cómo se convierte un MIDI en carriles (`src/convert.js`)

1. **Manos:** si el MIDI trae dos o más pistas, la más grave es la mano izquierda. Si trae una sola, se separa por altura con un punto de corte que se va moviendo según lo que viene tocando cada mano.
2. **Qué tocas:** según la dificultad, cada acorde se recorta a 1, 2 o 3 notas. En la derecha se queda la nota de arriba (la melodía) y en la izquierda el bajo. También se quitan las notas demasiado pegadas. Todo lo que se quita pasa a `auto` y suena solo.
3. **Carriles:** la nota real suena siempre; el carril se elige para toda la mano a la vez con **Viterbi**, buscando el camino más barato. Sale caro que una nota repetida cambie de carril, que dos notas distintas seguidas compartan carril o que el carril vaya al revés de la melodía. Sale barato quedarse cerca de la posición relativa de la nota entre las que la rodean (±0,9 s). En los acordes también cuenta que la separación de carriles se parezca a la de las notas.

`npm run check` revisa el conversor con un MIDI y muestra cuántas notas tocas por nivel, cómo se reparten por carril y si alguna regla se rompe:

```bash
npm run check                    # el Preludio de Bach
npm run check -- otra-pieza.mid  # cualquier MIDI
```

## Sonido

Piano de cola **Salamander Grand Piano** de Alexander Holm ([CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)), con las muestras servidas desde tonejs.github.io y guardadas en el navegador después de la primera vez. Hay una muestra cada tercera menor y las notas intermedias se afinan cambiando la velocidad de reproducción. La reverberación de sala, el metrónomo, los aplausos y las toses se sintetizan en el navegador. Si las muestras no cargan, suena un piano sintetizado.

## Estructura

```
src/
  main.js       menú, partida, controles, clasificación, ajustes, calibración
  midi.js       lee el .mid → notas planas en segundos y pulsos del compás
  convert.js    manos, dificultades, carriles (Viterbi), estrellas
  game.js       lógica: ventanas de acierto, combo, notas largas, pedal, el crítico (sin pantalla)
  renderer.js   la sala y la pista en canvas 2D (perspectiva, notas con grosor, teclas con frente)
  crowd.js      el público en 3D, sus reacciones y las rosas
  portrait.js   el retrato del compositor y sus caras
  audio.js      piano por muestras, sala, metrónomo, aplausos y toses
  tutorial.js   el Ensayo
  admin.js      panel para subir y editar canciones
  net.js        Supabase por REST: biblioteca, admin, jugadores, puntajes
  settings.js   ajustes del jugador
  config.js     URL y clave anon de Supabase
  songs.js      piezas incluidas en el juego
supabase/tasti.sql   todo el backend
scripts/
  make-bach.mjs     genera el MIDI del Preludio (transcripción propia, sin dueño)
  check-chart.mjs   revisa el conversor
public/
  sw.js, manifest.webmanifest, icons/   app instalable y sin conexión
```

## Pendiente

- Modo dúo (una mano por celular, en tiempo real)
- Editor para ajustar a mano los carriles de una pieza
