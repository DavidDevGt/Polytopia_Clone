import { describe, expect, it } from 'vitest';
import { applyAction, applyActionWithEvents, GameRuleError } from './actions';
import { forecastBattle } from './combat';
import { STARTING_STARS, UNIT_STATS } from './constants';
import { toIndex } from './grid';
import type { GameState, Tile, Unit } from './types';

const SIZE = 5;

function makeUnit(partial: Partial<Unit> & Pick<Unit, 'id' | 'ownerId' | 'tileIndex'>): Unit {
  return {
    kind: 'warrior',
    hp: UNIT_STATS[partial.kind ?? 'warrior'].hp,
    kills: 0,
    veteran: false,
    hasMoved: false,
    hasAttacked: false,
    ...partial,
  };
}

/** Small handcrafted 5x5 all-field state: precise fixtures for rule tests. */
function testState(overrides: Partial<GameState> = {}): GameState {
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
      { id: 0, stars: STARTING_STARS, eliminated: false, explored },
      { id: 1, stars: STARTING_STARS, eliminated: false, explored },
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
    units: [
      makeUnit({ id: 3, ownerId: 0, tileIndex: toIndex(1, 1, SIZE) }),
      makeUnit({ id: 4, ownerId: 1, tileIndex: toIndex(3, 3, SIZE) }),
    ],
    winnerId: null,
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

function withUnits(state: GameState, units: Unit[]): GameState {
  return { ...state, units };
}

describe('applyAction', () => {
  it('never mutates the input state', () => {
    const state = testState();
    const snapshot = structuredClone(state);
    applyAction(state, { type: 'moveUnit', unitId: 3, to: toIndex(2, 1, SIZE) });
    applyAction(state, { type: 'trainUnit', cityId: 1, unitKind: 'warrior' });
    applyAction(state, { type: 'endTurn' });
    expect(state).toEqual(snapshot);
  });

  it('rejects every action once the game is over', () => {
    const done = testState({ winnerId: 0 });
    expect(() => applyAction(done, { type: 'endTurn' })).toThrow(GameRuleError);
  });
});

describe('moveUnit', () => {
  it('moves the unit and marks it as moved (attack still available)', () => {
    const to = toIndex(2, 2, SIZE);
    const next = applyAction(testState(), { type: 'moveUnit', unitId: 3, to });
    const unit = next.units.find((u) => u.id === 3);
    expect(unit?.tileIndex).toBe(to);
    expect(unit?.hasMoved).toBe(true);
    expect(unit?.hasAttacked).toBe(false);
  });

  it('rejects moving another player unit', () => {
    expect(() =>
      applyAction(testState(), { type: 'moveUnit', unitId: 4, to: toIndex(2, 3, SIZE) }),
    ).toThrow(GameRuleError);
  });

  it('rejects moving twice in the same turn', () => {
    const once = applyAction(testState(), { type: 'moveUnit', unitId: 3, to: toIndex(2, 1, SIZE) });
    expect(() =>
      applyAction(once, { type: 'moveUnit', unitId: 3, to: toIndex(3, 1, SIZE) }),
    ).toThrow(GameRuleError);
  });

  it('rejects tiles beyond the unit movement range', () => {
    expect(() =>
      applyAction(testState(), { type: 'moveUnit', unitId: 3, to: toIndex(4, 1, SIZE) }),
    ).toThrow(GameRuleError);
  });

  it('rejects impassable terrain', () => {
    const mountainAt = toIndex(2, 1, SIZE);
    const state = withTile(testState(), mountainAt, { terrain: 'mountain' });
    expect(() => applyAction(state, { type: 'moveUnit', unitId: 3, to: mountainAt })).toThrow(
      GameRuleError,
    );
  });
});

describe('attack', () => {
  function duelState(defenderPatch: Partial<Unit> = {}, attackerPatch: Partial<Unit> = {}) {
    // Attacker at (1,1), defender adjacent at (2,1).
    const base = testState();
    return withUnits(base, [
      makeUnit({ id: 3, ownerId: 0, tileIndex: toIndex(1, 1, SIZE), ...attackerPatch }),
      makeUnit({ id: 4, ownerId: 1, tileIndex: toIndex(2, 1, SIZE), ...defenderPatch }),
    ]);
  }

  it('applies exactly the forecast damage, both ways', () => {
    const state = duelState();
    const attacker = state.units[0]!;
    const defender = state.units[1]!;
    const forecast = forecastBattle(state, attacker, defender);
    const next = applyAction(state, { type: 'attack', attackerId: 3, defenderId: 4 });
    expect(next.units.find((u) => u.id === 4)?.hp).toBe(defender.hp - forecast.damageToDefender);
    expect(next.units.find((u) => u.id === 3)?.hp).toBe(attacker.hp - forecast.damageToAttacker);
    expect(forecast.counterAttacks).toBe(true);
  });

  it('spends both the attack and the move', () => {
    const next = applyAction(duelState(), { type: 'attack', attackerId: 3, defenderId: 4 });
    const attacker = next.units.find((u) => u.id === 3);
    expect(attacker?.hasAttacked).toBe(true);
    expect(attacker?.hasMoved).toBe(true);
  });

  it('lets ranged units strike without receiving a counter', () => {
    const base = testState();
    const state = withUnits(base, [
      makeUnit({ id: 3, ownerId: 0, kind: 'archer', tileIndex: toIndex(0, 1, SIZE) }),
      makeUnit({ id: 4, ownerId: 1, tileIndex: toIndex(2, 1, SIZE) }),
    ]);
    const forecast = forecastBattle(state, state.units[0]!, state.units[1]!);
    expect(forecast.counterAttacks).toBe(false);
    const next = applyAction(state, { type: 'attack', attackerId: 3, defenderId: 4 });
    expect(next.units.find((u) => u.id === 3)?.hp).toBe(UNIT_STATS.archer.hp);
  });

  it('gives forest cover a defense bonus', () => {
    const open = duelState();
    const forest = withTile(open, toIndex(2, 1, SIZE), { terrain: 'forest' });
    const inOpen = forecastBattle(open, open.units[0]!, open.units[1]!);
    const inForest = forecastBattle(forest, forest.units[0]!, forest.units[1]!);
    expect(inForest.damageToDefender).toBeLessThan(inOpen.damageToDefender);
  });

  it('flanking allies increase the damage dealt', () => {
    const solo = duelState();
    const flanked = withUnits(solo, [
      ...solo.units,
      makeUnit({ id: 9, ownerId: 0, tileIndex: toIndex(3, 1, SIZE) }),
    ]);
    const before = forecastBattle(solo, solo.units[0]!, solo.units[1]!);
    const after = forecastBattle(flanked, flanked.units[0]!, flanked.units[1]!);
    expect(after.damageToDefender).toBeGreaterThanOrEqual(before.damageToDefender);
    expect(after.damageToAttacker).toBeLessThanOrEqual(before.damageToAttacker);
  });

  it('melee killers advance into the cleared tile', () => {
    const state = duelState({ hp: 1 });
    const next = applyAction(state, { type: 'attack', attackerId: 3, defenderId: 4 });
    expect(next.units.find((u) => u.id === 4)).toBeUndefined();
    expect(next.units.find((u) => u.id === 3)?.tileIndex).toBe(toIndex(2, 1, SIZE));
  });

  it('promotes to veteran after enough kills, with a full heal', () => {
    const state = duelState({ hp: 1 }, { kills: 1, hp: 4 });
    const next = applyAction(state, { type: 'attack', attackerId: 3, defenderId: 4 });
    const veteran = next.units.find((u) => u.id === 3);
    expect(veteran?.veteran).toBe(true);
    expect(veteran?.hp).toBe(UNIT_STATS.warrior.hp + 5);
  });

  it('rejects out-of-range targets and friendly fire', () => {
    const state = testState();
    expect(() => applyAction(state, { type: 'attack', attackerId: 3, defenderId: 4 })).toThrow(
      GameRuleError,
    );
    const allies = withUnits(state, [
      makeUnit({ id: 3, ownerId: 0, tileIndex: toIndex(1, 1, SIZE) }),
      makeUnit({ id: 5, ownerId: 0, tileIndex: toIndex(2, 1, SIZE) }),
    ]);
    expect(() => applyAction(allies, { type: 'attack', attackerId: 3, defenderId: 5 })).toThrow(
      GameRuleError,
    );
  });
});

describe('capture', () => {
  it('founds a city on a village, consuming the full turn', () => {
    const villageAt = toIndex(1, 1, SIZE);
    const state = withTile(testState(), villageAt, { hasVillage: true });
    const { state: next, events } = applyActionWithEvents(state, { type: 'capture', unitId: 3 });
    expect(next.tiles[villageAt]?.hasVillage).toBe(false);
    const city = next.cities.find((c) => c.tileIndex === villageAt);
    expect(city?.ownerId).toBe(0);
    expect(city?.isCapital).toBe(false);
    const unit = next.units.find((u) => u.id === 3);
    expect(unit?.hasMoved).toBe(true);
    expect(unit?.hasAttacked).toBe(true);
    expect(events.some((e) => e.type === 'cityCaptured')).toBe(true);
  });

  it('requires the unit full turn: no capture after moving', () => {
    const villageAt = toIndex(2, 1, SIZE);
    const state = withTile(testState(), villageAt, { hasVillage: true });
    const moved = applyAction(state, { type: 'moveUnit', unitId: 3, to: villageAt });
    expect(() => applyAction(moved, { type: 'capture', unitId: 3 })).toThrow(GameRuleError);
  });

  it('rejects capturing empty ground', () => {
    expect(() => applyAction(testState(), { type: 'capture', unitId: 3 })).toThrow(GameRuleError);
  });

  it('capturing the enemy capital eliminates them and wins a 2-player game', () => {
    const base = testState();
    const enemyCapital = base.cities.find((c) => c.id === 2)!;
    const state = withUnits(base, [
      makeUnit({ id: 3, ownerId: 0, tileIndex: enemyCapital.tileIndex }),
    ]);
    const { state: next, events } = applyActionWithEvents(state, { type: 'capture', unitId: 3 });
    expect(next.players.find((p) => p.id === 1)?.eliminated).toBe(true);
    expect(next.winnerId).toBe(0);
    expect(next.units.every((u) => u.ownerId === 0)).toBe(true);
    expect(next.cities.every((c) => c.ownerId === 0)).toBe(true);
    expect(events.some((e) => e.type === 'playerEliminated')).toBe(true);
    expect(events.some((e) => e.type === 'gameWon')).toBe(true);
  });
});

describe('trainUnit', () => {
  it('creates the unit on the city and charges its cost', () => {
    const next = applyAction(testState(), { type: 'trainUnit', cityId: 1, unitKind: 'rider' });
    const rider = next.units.find((u) => u.kind === 'rider');
    expect(rider?.tileIndex).toBe(toIndex(0, 0, SIZE));
    expect(rider?.ownerId).toBe(0);
    expect(rider?.hasMoved).toBe(true);
    expect(next.players[0]?.stars).toBe(STARTING_STARS - UNIT_STATS.rider.cost);
  });

  it('rejects training in an enemy city', () => {
    expect(() =>
      applyAction(testState(), { type: 'trainUnit', cityId: 2, unitKind: 'warrior' }),
    ).toThrow(GameRuleError);
  });

  it('rejects training without enough stars or on an occupied city', () => {
    const broke = testState({
      players: testState().players.map((p) => ({ ...p, stars: 1 })),
    });
    expect(() => applyAction(broke, { type: 'trainUnit', cityId: 1, unitKind: 'warrior' })).toThrow(
      GameRuleError,
    );
    const occupied = withUnits(testState(), [
      makeUnit({ id: 3, ownerId: 0, tileIndex: toIndex(0, 0, SIZE) }),
    ]);
    expect(() =>
      applyAction(occupied, { type: 'trainUnit', cityId: 1, unitKind: 'warrior' }),
    ).toThrow(GameRuleError);
  });
});

describe('harvest', () => {
  it('consumes the resource, pays stars and grows population', () => {
    const tileIndex = toIndex(1, 0, SIZE); // inside capital territory (radius 1)
    const state = withTile(testState(), tileIndex, { resource: 'fruit' });
    const next = applyAction(state, { type: 'harvest', cityId: 1, tileIndex });
    expect(next.tiles[tileIndex]?.resource).toBeNull();
    expect(next.players[0]?.stars).toBe(STARTING_STARS - 2);
    expect(next.cities.find((c) => c.id === 1)?.population).toBe(1);
  });

  it('levels the city up when population reaches the threshold', () => {
    const tileIndex = toIndex(1, 0, SIZE);
    const state = withTile(testState(), tileIndex, { resource: 'metal' }); // +2 pop
    const { state: next, events } = applyActionWithEvents(state, {
      type: 'harvest',
      cityId: 1,
      tileIndex,
    });
    const city = next.cities.find((c) => c.id === 1);
    expect(city?.level).toBe(2);
    expect(city?.population).toBe(0);
    expect(events).toContainEqual(expect.objectContaining({ type: 'harvested', leveledUpTo: 2 }));
  });

  it('rejects tiles outside the city borders', () => {
    const farTile = toIndex(3, 3, SIZE);
    const state = withTile(testState(), farTile, { resource: 'fruit' });
    expect(() => applyAction(state, { type: 'harvest', cityId: 1, tileIndex: farTile })).toThrow(
      GameRuleError,
    );
  });

  it('rejects empty tiles', () => {
    expect(() =>
      applyAction(testState(), { type: 'harvest', cityId: 1, tileIndex: toIndex(1, 0, SIZE) }),
    ).toThrow(GameRuleError);
  });
});

describe('endTurn', () => {
  it('activates the next player and pays net income (gross minus upkeep)', () => {
    const next = applyAction(testState(), { type: 'endTurn' });
    expect(next.currentPlayerId).toBe(1);
    expect(next.turn).toBe(1);
    // Capital level 1 = base 1 + level 1 + capital 1 = 3; one unit, one city → no upkeep.
    expect(next.players[1]?.stars).toBe(STARTING_STARS + 3);
  });

  it('charges upkeep for units beyond one per city', () => {
    const base = testState();
    const state = withUnits(base, [
      makeUnit({ id: 3, ownerId: 0, tileIndex: toIndex(1, 1, SIZE) }),
      makeUnit({ id: 4, ownerId: 1, tileIndex: toIndex(3, 3, SIZE) }),
      makeUnit({ id: 5, ownerId: 1, tileIndex: toIndex(3, 2, SIZE) }),
      makeUnit({ id: 6, ownerId: 1, tileIndex: toIndex(2, 3, SIZE) }),
    ]);
    const next = applyAction(state, { type: 'endTurn' });
    // Gross 3, upkeep = 3 units - 1 city = 2 → net +1.
    expect(next.players[1]?.stars).toBe(STARTING_STARS + 1);
  });

  it('heals idle units, faster inside home territory', () => {
    const base = testState();
    const state = withUnits(base, [
      makeUnit({ id: 3, ownerId: 0, tileIndex: toIndex(0, 0, SIZE), hp: 4 }), // on own capital
      makeUnit({ id: 5, ownerId: 0, tileIndex: toIndex(3, 0, SIZE), hp: 4 }), // open field
      makeUnit({ id: 6, ownerId: 0, tileIndex: toIndex(2, 2, SIZE), hp: 4, hasMoved: true }),
    ]);
    const next = applyAction(state, { type: 'endTurn' });
    expect(next.units.find((u) => u.id === 3)?.hp).toBe(8); // +4 at home
    expect(next.units.find((u) => u.id === 5)?.hp).toBe(6); // +2 afield
    expect(next.units.find((u) => u.id === 6)?.hp).toBe(4); // moved → no heal
  });

  it('does not heal units under siege (enemy adjacent)', () => {
    const base = testState();
    const state = withUnits(base, [
      makeUnit({ id: 3, ownerId: 0, tileIndex: toIndex(2, 2, SIZE), hp: 4 }),
      makeUnit({ id: 4, ownerId: 1, tileIndex: toIndex(3, 3, SIZE) }), // adjacent enemy
    ]);
    const next = applyAction(state, { type: 'endTurn' });
    expect(next.units.find((u) => u.id === 3)?.hp).toBe(4);
  });

  it('resets the activated player units and increments the round on wrap', () => {
    const afterPlayer0 = applyAction(
      applyAction(testState(), { type: 'moveUnit', unitId: 3, to: toIndex(2, 1, SIZE) }),
      { type: 'endTurn' },
    );
    const backToPlayer0 = applyAction(afterPlayer0, { type: 'endTurn' });
    expect(backToPlayer0.currentPlayerId).toBe(0);
    expect(backToPlayer0.turn).toBe(2);
    expect(backToPlayer0.units.find((u) => u.id === 3)?.hasMoved).toBe(false);
  });

  it('skips eliminated players', () => {
    const threePlayers = testState({
      players: [
        { id: 0, stars: 5, eliminated: false, explored: new Array<boolean>(25).fill(true) },
        { id: 1, stars: 5, eliminated: true, explored: new Array<boolean>(25).fill(true) },
        { id: 2, stars: 5, eliminated: false, explored: new Array<boolean>(25).fill(true) },
      ],
    });
    const next = applyAction(threePlayers, { type: 'endTurn' });
    expect(next.currentPlayerId).toBe(2);
  });
});
