# Polytopia Clone

Juego de estrategia 4X por turnos inspirado en [The Battle of Polytopia](https://polytopia.io/), construido con **TypeScript + Canvas 2D + Vite**, sin motor de juego ni dependencias en runtime.

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
| `npm run typecheck`  | Verificación de tipos sin emitir           |
| `npm run lint`       | ESLint (con reglas type-checked)           |
| `npm run format`     | Formatea todo con Prettier                 |

## Arquitectura

La regla central del proyecto: **la lógica del juego está separada del render y es 100 % pura y determinista.**

```
src/
├── core/            Lógica del juego: datos puros + funciones puras. Sin DOM,
│   │                sin Math.random, sin Date.now. Testeable sin navegador.
│   ├── types.ts     Modelo de dominio (GameState, Tile, Unit, City, Player)
│   ├── constants.ts Balance del juego: stats de unidades, ingresos, costos
│   ├── rng.ts       PRNG con semilla (mulberry32): misma semilla → misma partida
│   ├── grid.ts      Cuadrícula: índices, vecinos (8 direcciones), distancias
│   ├── map/         Generación procedural de mapas
│   ├── game.ts      createGame(config) → GameState inicial
│   ├── queries.ts   Lecturas derivadas del estado (alcance, ingresos, etc.)
│   └── actions.ts   Motor de reglas: applyAction(state, action) → nuevo state
├── render/          Renderer isométrico en Canvas 2D (solo lee el estado)
└── main.ts          Capa de UI: traduce eventos del DOM a Actions y re-renderiza
```

### Por qué así

- **`applyAction(state, action) → newState`** es la única forma de cambiar el estado. Nunca se muta: cada acción devuelve un estado nuevo. Esto da gratis guardado/carga (`JSON.stringify` del estado), replays (lista de acciones), undo, y multijugador futuro (enviar acciones por red).
- **Determinismo**: toda la aleatoriedad pasa por el `Rng` sembrado. La misma semilla genera exactamente la misma partida, lo que hace los bugs reproducibles y los tests confiables.
- **ESLint hace cumplir la pureza**: `src/core` tiene prohibido por lint usar `window`, `document`, `Math.random` o importar desde `render/`/`ui/`.

## Estado actual (v0.1)

- ✅ Generación procedural de mapas con semilla: campo, bosque, montaña, agua/océano, recursos, aldeas y capitales alejadas entre sí
- ✅ Render isométrico en Canvas 2D con selección y resaltado de movimiento
- ✅ Turnos alternos (hotseat local, 2 jugadores) con economía de estrellas e ingresos por ciudad
- ✅ Movimiento de unidades (BFS, 8 direcciones), captura de aldeas y ciudades
- ✅ Entrenamiento de unidades (guerrero, arquero, jinete, defensor)

## Hoja de ruta

Aproximadamente en orden de dependencia:

1. **Combate** — fórmula determinista de ataque/defensa/contraataque, unidades a distancia
2. **Captura fiel a Polytopia** — exigir que la unidad permanezca un turno en la aldea/ciudad
3. **Niebla de guerra** — visibilidad por jugador y exploración
4. **Crecimiento de ciudades** — población por recursos cosechados, subida de nivel, bordes de territorio
5. **Árbol tecnológico** — desbloquear terrenos (escalada, navegación), unidades y mejoras
6. **Condiciones de victoria** — dominación (capturar capitales) y puntuación
7. **IA** — heurística simple: expandir → investigar → atacar
8. **Tribus** — tecnología inicial y estética por tribu
9. **Pulido** — animaciones, sonido, guardado en localStorage

## Convenciones

- Código y commits en inglés; UI y docs en español
- Cambios de reglas del juego siempre acompañados de tests en `src/core/**/*.test.ts`
- CI (GitHub Actions) exige lint + formato + typecheck + tests + build en verde
