import { describe, expect, it } from 'vitest';
import { VISION_RADIUS } from './constants';
import { chebyshevDistance, toIndex } from './grid';
import { incomeFor, territoryOf, territoryOwner, upkeepFor, visibleTiles } from './queries';
import type { GameState, Tile } from './types';

const SIZE = 7;

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
    players: [{ id: 0, stars: 5, eliminated: false, explored }],
    cities: [
      {
        id: 1,
        tileIndex: toIndex(3, 3, SIZE),
        ownerId: 0,
        level: 1,
        population: 0,
        isCapital: true,
      },
    ],
    units: [],
    winnerId: null,
    nextEntityId: 2,
    ...overrides,
  };
}

describe('territoryOf', () => {
  it('covers one ring at low level and two rings from level 3', () => {
    const state = makeState();
    expect(territoryOf(state, state.cities[0]!)).toHaveLength(9);
    const grown = makeState({
      cities: [{ ...state.cities[0]!, level: 3 }],
    });
    expect(territoryOf(grown, grown.cities[0]!)).toHaveLength(25);
  });
});

describe('territoryOwner', () => {
  it('claims tiles near the city and leaves the rest neutral', () => {
    const state = makeState();
    expect(territoryOwner(state, toIndex(2, 3, SIZE))).toBe(0);
    expect(territoryOwner(state, toIndex(0, 0, SIZE))).toBeNull();
  });
});

describe('visibleTiles', () => {
  it('reveals a square of VISION_RADIUS around units and cities', () => {
    const state = makeState();
    const visible = visibleTiles(state, 0);
    for (const index of visible) {
      expect(chebyshevDistance(index, state.cities[0]!.tileIndex, SIZE)).toBeLessThanOrEqual(
        VISION_RADIUS,
      );
    }
    expect(visible.size).toBe((VISION_RADIUS * 2 + 1) ** 2);
  });
});

describe('income and upkeep', () => {
  it('charges one star per unit beyond one per city', () => {
    const base = makeState();
    const state = makeState({
      units: [0, 1, 2].map((i) => ({
        id: 10 + i,
        kind: 'warrior',
        ownerId: 0,
        tileIndex: toIndex(i, 0, SIZE),
        hp: 10,
        kills: 0,
        veteran: false,
        hasMoved: false,
        hasAttacked: false,
      })),
    });
    expect(upkeepFor(base, 0)).toBe(0);
    expect(upkeepFor(state, 0)).toBe(2);
    // Capital level 1: gross 3; minus upkeep 2.
    expect(incomeFor(state, 0)).toBe(1);
  });
});
