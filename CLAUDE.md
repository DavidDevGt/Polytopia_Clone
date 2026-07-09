# CLAUDE.md

Turn-based 4X strategy game inspired by The Battle of Polytopia. TypeScript + Canvas 2D + Vite, no runtime dependencies.

## Commands

- `npm run dev` — dev server
- `npm test` — run tests (Vitest)
- `npm run bench` — micro-benchmarks for hot paths (map gen, BFS, AI)
- `npm run typecheck` — TypeScript, strict mode
- `npm run lint` / `npm run format` — ESLint (type-checked) / Prettier
- `npm run build` — typecheck + production build

## Architecture rules

- `src/core/` is the pure, deterministic game engine: plain data + pure functions. It must never touch the DOM, `Math.random`, or `Date.now` (ESLint enforces this), and must never import from `src/render/` or UI code.
- All state changes go through `applyAction(state, action)` in `src/core/actions.ts`. It validates, throws `GameRuleError` on illegal actions, and returns a **new** state — never mutate `GameState`.
- All randomness flows through the seeded `Rng` (`src/core/rng.ts`), threaded in as a parameter. Same seed ⇒ same game.
- Game balance numbers (unit stats, income, costs) live in `src/core/constants.ts`.
- `src/render/` only reads state; `src/main.ts` owns the current state reference and dispatches actions.

## Conventions

- Every rule change in `src/core` needs a test next to it (`*.test.ts`, Vitest).
- Code, comments and commits in English; user-facing UI text and README in Spanish.
- Before pushing: `npm run lint && npm run typecheck && npm test`.
