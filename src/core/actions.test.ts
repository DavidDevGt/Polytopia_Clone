import { describe, expect, it } from 'vitest';
import { applyAction, GameRuleError } from './actions';
import { STARTING_STARS, UNIT_STATS } from './constants';
import { toIndex } from './grid';
import type { GameState, Tile } from './types';

/** Small handcrafted 5x5 all-field state: precise fixtures for rule tests. */
function testState(overrides: Partial<GameState> = {}): GameState {
  const size = 5;
  const tiles: Tile[] = Array.from({ length: size * size }, () => ({
    terrain: 'field',
    resource: null,
    hasVillage: false,
  }));
  return {
    seed: 0,
    mapSize: size,
    turn: 1,
    currentPlayerId: 0,
    tiles,
    players: [
      { id: 0, stars: STARTING_STARS },
      { id: 1, stars: STARTING_STARS },
    ],
    cities: [
      { id: 1, tileIndex: toIndex(0, 0, size), ownerId: 0, level: 1, isCapital: true },
      { id: 2, tileIndex: toIndex(4, 4, size), ownerId: 1, level: 1, isCapital: true },
    ],
    units: [
      {
        id: 3,
        kind: 'warrior',
        ownerId: 0,
        tileIndex: toIndex(1, 1, size),
        hp: 10,
        hasMoved: false,
      },
      {
        id: 4,
        kind: 'warrior',
        ownerId: 1,
        tileIndex: toIndex(3, 3, size),
        hp: 10,
        hasMoved: false,
      },
    ],
    nextEntityId: 5,
    ...overrides,
  };
}

function withTile(state: GameState, tileIndex: number, patch: Partial<Tile>): GameState {
  return {
    ...state,
    tiles: state.tiles.map((t, i) => (i === tileIndex ? { ...t, ...patch } : t)),
  };
}

describe('applyAction', () => {
  it('never mutates the input state', () => {
    const state = testState();
    const snapshot = structuredClone(state);
    applyAction(state, { type: 'moveUnit', unitId: 3, to: toIndex(2, 1, 5) });
    applyAction(state, { type: 'trainUnit', cityId: 1, unitKind: 'warrior' });
    applyAction(state, { type: 'endTurn' });
    expect(state).toEqual(snapshot);
  });
});

describe('moveUnit', () => {
  it('moves the unit and marks it as moved', () => {
    const to = toIndex(2, 2, 5);
    const next = applyAction(testState(), { type: 'moveUnit', unitId: 3, to });
    const unit = next.units.find((u) => u.id === 3);
    expect(unit?.tileIndex).toBe(to);
    expect(unit?.hasMoved).toBe(true);
  });

  it('rejects moving another player unit', () => {
    expect(() =>
      applyAction(testState(), { type: 'moveUnit', unitId: 4, to: toIndex(2, 3, 5) }),
    ).toThrow(GameRuleError);
  });

  it('rejects moving twice in the same turn', () => {
    const once = applyAction(testState(), { type: 'moveUnit', unitId: 3, to: toIndex(2, 1, 5) });
    expect(() => applyAction(once, { type: 'moveUnit', unitId: 3, to: toIndex(3, 1, 5) })).toThrow(
      GameRuleError,
    );
  });

  it('rejects tiles beyond the unit movement range', () => {
    expect(() =>
      applyAction(testState(), { type: 'moveUnit', unitId: 3, to: toIndex(4, 1, 5) }),
    ).toThrow(GameRuleError);
  });

  it('rejects impassable terrain', () => {
    const mountainAt = toIndex(2, 1, 5);
    const state = withTile(testState(), mountainAt, { terrain: 'mountain' });
    expect(() => applyAction(state, { type: 'moveUnit', unitId: 3, to: mountainAt })).toThrow(
      GameRuleError,
    );
  });

  it('captures a village and founds a city', () => {
    const villageAt = toIndex(2, 2, 5);
    const state = withTile(testState(), villageAt, { hasVillage: true });
    const next = applyAction(state, { type: 'moveUnit', unitId: 3, to: villageAt });
    expect(next.tiles[villageAt]?.hasVillage).toBe(false);
    const city = next.cities.find((c) => c.tileIndex === villageAt);
    expect(city?.ownerId).toBe(0);
    expect(city?.isCapital).toBe(false);
  });

  it('captures an enemy city by stepping onto it', () => {
    // Bring the enemy capital within reach of player 0's warrior.
    const enemyCityAt = toIndex(2, 2, 5);
    const base = testState();
    const state: GameState = {
      ...base,
      cities: base.cities.map((c) => (c.id === 2 ? { ...c, tileIndex: enemyCityAt } : c)),
    };
    const next = applyAction(state, { type: 'moveUnit', unitId: 3, to: enemyCityAt });
    expect(next.cities.find((c) => c.id === 2)?.ownerId).toBe(0);
  });
});

describe('trainUnit', () => {
  it('creates the unit on the city and charges its cost', () => {
    const next = applyAction(testState(), { type: 'trainUnit', cityId: 1, unitKind: 'rider' });
    const rider = next.units.find((u) => u.kind === 'rider');
    expect(rider?.tileIndex).toBe(toIndex(0, 0, 5));
    expect(rider?.ownerId).toBe(0);
    expect(rider?.hasMoved).toBe(true);
    expect(next.players[0]?.stars).toBe(STARTING_STARS - UNIT_STATS.rider.cost);
  });

  it('rejects training in an enemy city', () => {
    expect(() =>
      applyAction(testState(), { type: 'trainUnit', cityId: 2, unitKind: 'warrior' }),
    ).toThrow(GameRuleError);
  });

  it('rejects training without enough stars', () => {
    const broke = testState({
      players: [
        { id: 0, stars: 1 },
        { id: 1, stars: 1 },
      ],
    });
    expect(() => applyAction(broke, { type: 'trainUnit', cityId: 1, unitKind: 'warrior' })).toThrow(
      GameRuleError,
    );
  });

  it('rejects training when a unit is standing on the city', () => {
    const base = testState();
    const state: GameState = {
      ...base,
      units: base.units.map((u) => (u.id === 3 ? { ...u, tileIndex: toIndex(0, 0, 5) } : u)),
    };
    expect(() => applyAction(state, { type: 'trainUnit', cityId: 1, unitKind: 'warrior' })).toThrow(
      GameRuleError,
    );
  });
});

describe('endTurn', () => {
  it('activates the next player and pays their city income', () => {
    const next = applyAction(testState(), { type: 'endTurn' });
    expect(next.currentPlayerId).toBe(1);
    expect(next.turn).toBe(1);
    // One capital at level 1: base income 1 + level 1 + capital bonus 1 = 3.
    expect(next.players[1]?.stars).toBe(STARTING_STARS + 3);
  });

  it('resets the activated player units and increments the round on wrap', () => {
    const afterPlayer0 = applyAction(
      applyAction(testState(), { type: 'moveUnit', unitId: 3, to: toIndex(2, 1, 5) }),
      { type: 'endTurn' },
    );
    const backToPlayer0 = applyAction(afterPlayer0, { type: 'endTurn' });
    expect(backToPlayer0.currentPlayerId).toBe(0);
    expect(backToPlayer0.turn).toBe(2);
    expect(backToPlayer0.units.find((u) => u.id === 3)?.hasMoved).toBe(false);
  });
});
