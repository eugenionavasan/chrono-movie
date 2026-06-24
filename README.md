# CHRONO·MOVIE 🎬

Juego para construir una línea cronológica de cine: ves 30 segundos de un tráiler
(sin título, sin pistas) y adivinas en qué hueco del eje temporal encaja la película
según su año de estreno. Hecho con **Astro** y **responsive**.

> Los tráilers se muestran con fines lúdicos y educativos, sin ánimo de lucro.
> Todos los derechos pertenecen a sus respectivos propietarios.

## Requisitos

- Node.js 18.20+ / 20.3+ / 22+

## Puesta en marcha

```bash
npm install      # instalar dependencias
npm run dev      # servidor de desarrollo -> http://localhost:4321
npm run build    # genera el sitio estático en dist/
npm run preview  # sirve dist/ para previsualizar la build
```

Abre **http://localhost:4321** y pulsa **▶ INICIAR JUEGO** → cuenta atrás 3·2·1 →
**¡ACCIÓN!** y empieza la partida.

## Reglas

- El juego arranca con una **película de referencia** ya colocada en el eje.
- Cada ronda reproduce un **tráiler aleatorio durante 30 s**. El vídeo está recortado
  (CSS) y bloqueado para que no se vea el título.
- Usa los botones **＋** a cada lado de las tarjetas para colocar la película en el eje.
- Si aciertas, aparece la tarjeta (póster, título y **año en grande**) en su sitio.
- **Empate de año:** si el año coincide con un vecino del hueco elegido, cuenta como acierto.
- Si fallas o se acaban los 30 s, se revela la respuesta y pasa al siguiente tráiler.
- Cada ronda (acierto o fallo) suma **1 intento**.
- **Ganas** si llegas a **10 películas** en el eje. **Pierdes** si gastas los **20 intentos** antes.

## Estructura del proyecto

```
chrono-movie/
├── astro.config.mjs
├── package.json
├── tsconfig.json
└── src/
    ├── data/
    │   └── movies.json          # datos consumidos por el juego
    ├── layouts/
    │   └── Layout.astro         # <head>, fuentes y capas de ambiente (grano/viñeta)
    ├── components/
    │   ├── StartScreen.astro    # pantalla de inicio + reglas
    │   ├── CountdownScreen.astro# overlay 3·2·1·¡ACCIÓN!
    │   ├── GameScreen.astro     # HUD, reproductor y eje cronológico
    │   └── EndScreen.astro      # YOU WIN / YOU LOSE + play again
    ├── pages/
    │   └── index.astro          # ensambla las pantallas y carga el script
    ├── scripts/
    │   └── game.js              # lógica del juego + control de YouTube
    └── styles/
        └── global.css           # estilo cinematográfico + reglas responsive
```

## Responsive

- Layout fluido con `clamp()` en títulos y unidades relativas al viewport.
- Tarjetas, huecos y reproductor se redimensionan vía *custom properties*
  (`--card-w`, `--poster-h`, `--slot-w`) en breakpoints de **760px** y **560px**.
- Breakpoint específico para móviles en **horizontal** (`max-height: 480px`).
- El eje cronológico tiene scroll horizontal táctil; el HUD compacta su título en pantallas pequeñas.
- Se respeta `prefers-reduced-motion`.

## Cambiar los datos

Edita `src/data/movies.json` (cada entrada: `title`, `year`, `trailer_url`, `poster_url`).

> Si el primer tráiler no trae sonido, es el bloqueo de *autoplay* del navegador:
> pulsa el botón 🔊 de la esquina del reproductor.
