# Terranova (Polytopia Clone)

Juego de estrategia 4X por turnos inspirado en [The Battle of Polytopia](https://polytopia.io/), construido con **TypeScript + Canvas 2D + Vite**, sin motor de juego ni dependencias en runtime.

> 📐 La auditoría del prototipo, la matriz de balance y todas las decisiones de diseño están en [`docs/DESIGN.md`](docs/DESIGN.md).

## Inicio rápido

```bash
npm install
npm run dev      # abre http://localhost:5173
```

## Scripts

| Comando              | Descripción                                |
| -------------------- | ------------------------------------------ |
| `npm run dev`        | Servidor de desarrollo con hot reload      |
| `npm run build`      | Typecheck + build de producción en `dist/` |
| `npm run preview`    | Sirve el build de producción               |
| `npm test`           | Ejecuta los tests (Vitest)                 |
| `npm run test:watch` | Tests en modo watch                        |
| `npm run bench`      | Micro-benchmarks de las rutas calientes    |
| `npm run typecheck`  | Verificación de tipos sin emitir           |
| `npm run lint`       | ESLint (con reglas type-checked)           |
| `npm run format`     | Formatea todo con Prettier                 |

## Arquitectura

La regla central del proyecto: **la lógica del juego está separada del render y es 100 % pura y determinista.**

```
src/
├── core/              Lógica del juego: datos puros + funciones puras. Sin DOM,
│   │                  sin Math.random, sin Date.now. Testeable sin navegador.
│   ├── types.ts       Modelo de dominio (GameState, Tile, Unit, City, Player)
│   ├── constants.ts   Balance: stats, ingresos, costes, bonos de combate
│   ├── rng.ts         PRNG con semilla (mulberry32): misma semilla → misma partida
│   ├── grid.ts        Cuadrícula: vecinos precomputados (8 dir), distancias
│   ├── map/
│   │   ├── noise.ts   Value noise + fBm deterministas (hash, sin Math.random)
│   │   └── generateMap.ts  Elevación+humedad → continentes, lagos, cordilleras
│   ├── game.ts        createGame(config) → GameState inicial
│   ├── queries.ts     Lecturas: alcance, visibilidad, territorio, ingresos
│   ├── combat.ts      Fórmula determinista + pronóstico exacto de batalla
│   ├── actions.ts     Motor de reglas: applyAction(WithEvents) → estado + eventos
│   └── ai.ts          IA por objetivos: nextAiAction(state) pura y determinista
├── render/            Solo presentación (lee estado, nunca lo modifica)
│   ├── renderer.ts    Isométrico con profundidad, niebla, territorio, cámara
│   ├── animation.ts   Tweens (mover/embestir/aparecer) + partículas
│   ├── minimap.ts     Minimapa con viewport y click-para-saltar
│   └── sound.ts       SFX sintetizados con Web Audio (sin assets)
└── main.ts            Capa de UI: eventos DOM → Actions, HUD, inspector, IA
```

### Por qué así

- **`applyAction(state, action) → newState`** es la única forma de cambiar el estado; `applyActionWithEvents` además devuelve **eventos de juego** (`unitMoved`, `attackResolved`…) que la UI consume para animar, sonar y loguear sin diffear estados. Nunca se muta: guardado/carga, replays y multijugador salen gratis.
- **Determinismo total**: RNG sembrado en el núcleo, ruido por hash en el mapa, combate sin dados (con pronóstico exacto en la UI) e IA pura. La misma semilla y las mismas acciones reproducen la partida entera — hay un test que juega una apertura IA-vs-IA dos veces y exige trazas idénticas.
- **ESLint hace cumplir la pureza**: `src/core` tiene prohibido usar `window`, `document`, `Math.random`, `Date.now` o importar desde `render/`.

## Estado actual (v0.2 — vertical slice)

**Mecánicas**

- ⚔ Combate determinista: contraataques, bono defensivo de bosque/ciudad/capital, flanqueo, avance al matar, veteranía (+vida al promocionar) y curación por descanso
- 🏘 Captura con turno completo (aldeas → ciudades; capital enemiga → eliminación y victoria por dominación)
- 🌾 Economía con decisiones: cosechar recursos (★ → población → nivel → ingresos y fronteras más amplias) compite con reclutar; mantenimiento por unidad extra
- 🌫 Niebla de guerra de dos niveles por jugador, persistida en el estado
- 🤖 IA por objetivos (captura → combate favorable → expansión/exploración → economía), determinista
- 🗺 Mapas fBm: continentes, lagos, cordilleras, costas naturales; capitales siempre conectadas por tierra

**Presentación**

- Render isométrico con profundidad (bloques extruidos), agua animada, banderas ondeando, fronteras de territorio
- Game feel: tweens de movimiento y embestida, números de daño, partículas, sacudida de cámara, banner de turno
- UI: inspector lateral contextual, pronóstico de combate al apuntar, log de eventos, minimapa con viewport, toasts de error, ayuda, atajos (␣ N C Esc M ?)
- Cámara con paneo (arrastrar), zoom (rueda) y easing; SFX sintetizados (sin assets) con silencio (M)
- Modos: vs IA y 2 jugadores (hotseat)

## Hoja de ruta

1. **Árbol tecnológico** — desbloquear terrenos (escalada, navegación), unidades T2 y economía avanzada
2. **Tribus** — tecnología inicial, paleta y una regla distintiva por tribu
3. **ZOC, altura y ríos** — junto al paso del render a sprites
4. **Guardado y replays** — serializar estado + lista de acciones
5. **Audio ambiental y accesibilidad**

## Convenciones

- Código y commits en inglés; UI y docs en español
- Cambios de reglas del juego siempre acompañados de tests en `src/core/**/*.test.ts`
- CI (GitHub Actions) exige lint + formato + typecheck + tests + build en verde
