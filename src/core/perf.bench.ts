/**
 * Micro-benchmarks for the hot paths (`npm run bench`). These are meant to
 * catch regressions when preparing for much larger maps.
 */
import { bench, describe } from 'vitest';
import { applyAction } from './actions';
import { nextAiAction } from './ai';
import { createGame } from './game';
import { generateMap, DEFAULT_MAP_CONFIG } from './map/generateMap';
import { reachableTiles, visibleTiles } from './queries';
import { createRng } from './rng';

const state = createGame({ seed: 7, mapSize: 16, playerCount: 2 });
const bigState = createGame({ seed: 7, mapSize: 48, playerCount: 4 });

describe('map generation', () => {
  bench('16x16', () => {
    generateMap(createRng(1), { ...DEFAULT_MAP_CONFIG, size: 16, playerCount: 2 });
  });
  bench('48x48', () => {
    generateMap(createRng(1), { ...DEFAULT_MAP_CONFIG, size: 48, playerCount: 4 });
  });
});

describe('queries', () => {
  bench('reachableTiles on 48x48', () => {
    reachableTiles(bigState, bigState.units[0]!);
  });
  bench('visibleTiles on 48x48', () => {
    visibleTiles(bigState, 0);
  });
});

describe('turn processing', () => {
  bench('endTurn on 48x48', () => {
    applyAction(bigState, { type: 'endTurn' });
  });
  bench('AI decision on 16x16', () => {
    nextAiAction(state);
  });
});
