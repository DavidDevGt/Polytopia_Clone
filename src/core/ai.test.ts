import { describe, expect, it } from 'vitest';
import { applyAction, type Action } from './actions';
import { nextAiAction } from './ai';
import { createGame } from './game';
import { toIndex } from './grid';
import type { GameState, Tile, Unit } from './types';

const SIZE = 5;

function makeUnit(partial: Partial<Unit> & Pick<Unit, 'id' | 'ownerId' | 'tileIndex'>): Unit {
  return {
    kind: 'warrior',
    hp: 10,
    kills: 0,
    veteran: false,
    hasMoved: false,
    hasAttacked: false,
    ...partial,
  };
}

function makeState(overrides: Partial<GameState> = {}): GameState {
  const tiles: Tile[] = Array.from({ length: SIZE * SIZE }, () => ({
    terrain: 'field',
    resource: null,
    hasVillage: false,
  }));
  const explored = new Array<boolean>(SIZE * SIZE).fill(true);
  return {
    seed: 0,
    mapSize: SIZE,
    turn: 1,
    currentPlayerId: 0,
    tiles,
    players: [
      { id: 0, stars: 5, eliminated: false, explored },
      { id: 1, stars: 5, eliminated: false, explored },
    ],
    cities: [
      {
        id: 1,
        tileIndex: toIndex(0, 0, SIZE),
        ownerId: 0,
        level: 1,
        population: 0,
        isCapital: true,
      },
      {
        id: 2,
        tileIndex: toIndex(4, 4, SIZE),
        ownerId: 1,
        level: 1,
        population: 0,
        isCapital: true,
      },
    ],
    units: [makeUnit({ id: 3, ownerId: 0, tileIndex: toIndex(1, 1, SIZE) })],
    winnerId: null,
    nextEntityId: 10,
    ...overrides,
  };
}

describe('nextAiAction', () => {
  it('captures the village its unit is standing on', () => {
    const state = makeState({
      tiles: makeState().tiles.map((t, i) =>
        i === toIndex(1, 1, SIZE) ? { ...t, hasVillage: true } : t,
      ),
    });
    expect(nextAiAction(state)).toEqual({ type: 'capture', unitId: 3 });
  });

  it('takes a favorable fight', () => {
    const state = makeState({
      units: [
        makeUnit({ id: 3, ownerId: 0, tileIndex: toIndex(1, 1, SIZE) }),
        makeUnit({ id: 4, ownerId: 1, tileIndex: toIndex(2, 1, SIZE), hp: 1 }),
      ],
    });
    expect(nextAiAction(state)).toEqual({ type: 'attack', attackerId: 3, defenderId: 4 });
  });

  it('walks toward a known village', () => {
    const villageAt = toIndex(4, 1, SIZE);
    const state = makeState({
      tiles: makeState().tiles.map((t, i) => (i === villageAt ? { ...t, hasVillage: true } : t)),
    });
    const action = nextAiAction(state);
    expect(action.type).toBe('moveUnit');
  });

  it('always terminates its turn within a bounded number of actions', () => {
    let state = makeState();
    let steps = 0;
    let action: Action;
    do {
      action = nextAiAction(state);
      state = applyAction(state, action);
      steps++;
      expect(steps).toBeLessThan(50);
    } while (action.type !== 'endTurn');
  });

  it('plays a full AI-vs-AI opening deterministically', () => {
    const run = (): string[] => {
      let state = createGame({ seed: 2024, mapSize: 16, playerCount: 2 });
      const trace: string[] = [];
      for (let i = 0; i < 120 && state.winnerId === null; i++) {
        const action = nextAiAction(state);
        trace.push(JSON.stringify(action));
        state = applyAction(state, action);
      }
      return trace;
    };
    expect(run()).toEqual(run());
  });
});
