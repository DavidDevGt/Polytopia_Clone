/**
 * The rules engine. All state changes go through applyAction, which validates
 * the action against the current state and returns a brand-new state without
 * mutating the input. Invalid actions throw GameRuleError.
 */
import { UNIT_STATS } from './constants';
import { cityAt, incomeFor, playerById, reachableTiles, unitAt } from './queries';
import type { GameState, UnitKind } from './types';

export type Action =
  | { readonly type: 'moveUnit'; readonly unitId: number; readonly to: number }
  | { readonly type: 'trainUnit'; readonly cityId: number; readonly unitKind: UnitKind }
  | { readonly type: 'endTurn' };

export type GameRuleErrorCode =
  | 'UNIT_NOT_FOUND'
  | 'NOT_YOUR_UNIT'
  | 'UNIT_ALREADY_MOVED'
  | 'UNREACHABLE_TILE'
  | 'CITY_NOT_FOUND'
  | 'NOT_YOUR_CITY'
  | 'TILE_OCCUPIED'
  | 'NOT_ENOUGH_STARS';

export class GameRuleError extends Error {
  constructor(
    readonly code: GameRuleErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'GameRuleError';
  }
}

export function applyAction(state: GameState, action: Action): GameState {
  switch (action.type) {
    case 'moveUnit':
      return moveUnit(state, action.unitId, action.to);
    case 'trainUnit':
      return trainUnit(state, action.cityId, action.unitKind);
    case 'endTurn':
      return endTurn(state);
  }
}

function moveUnit(state: GameState, unitId: number, to: number): GameState {
  const unit = state.units.find((u) => u.id === unitId);
  if (!unit) {
    throw new GameRuleError('UNIT_NOT_FOUND', `Unit ${unitId} does not exist`);
  }
  if (unit.ownerId !== state.currentPlayerId) {
    throw new GameRuleError('NOT_YOUR_UNIT', 'That unit belongs to another player');
  }
  if (unit.hasMoved) {
    throw new GameRuleError('UNIT_ALREADY_MOVED', 'That unit already acted this turn');
  }
  if (!reachableTiles(state, unit).has(to)) {
    throw new GameRuleError('UNREACHABLE_TILE', 'The unit cannot reach that tile');
  }

  const units = state.units.map((u) =>
    u.id === unitId ? { ...u, tileIndex: to, hasMoved: true } : u,
  );

  // Capture: stepping onto a village founds a city; stepping onto an enemy
  // city flips its owner. (Polytopia requires standing a full turn — see the
  // roadmap in README.md.)
  const targetTile = state.tiles[to]!;
  if (targetTile.hasVillage) {
    const tiles = state.tiles.map((t, i) => (i === to ? { ...t, hasVillage: false } : t));
    const newCity = {
      id: state.nextEntityId,
      tileIndex: to,
      ownerId: unit.ownerId,
      level: 1,
      isCapital: false,
    };
    return {
      ...state,
      units,
      tiles,
      cities: [...state.cities, newCity],
      nextEntityId: state.nextEntityId + 1,
    };
  }

  const enemyCity = cityAt(state, to);
  if (enemyCity && enemyCity.ownerId !== unit.ownerId) {
    const cities = state.cities.map((c) =>
      c.id === enemyCity.id ? { ...c, ownerId: unit.ownerId } : c,
    );
    return { ...state, units, cities };
  }

  return { ...state, units };
}

function trainUnit(state: GameState, cityId: number, unitKind: UnitKind): GameState {
  const city = state.cities.find((c) => c.id === cityId);
  if (!city) {
    throw new GameRuleError('CITY_NOT_FOUND', `City ${cityId} does not exist`);
  }
  if (city.ownerId !== state.currentPlayerId) {
    throw new GameRuleError('NOT_YOUR_CITY', 'That city belongs to another player');
  }
  if (unitAt(state, city.tileIndex)) {
    throw new GameRuleError('TILE_OCCUPIED', 'There is already a unit standing on the city');
  }
  const stats = UNIT_STATS[unitKind];
  const player = playerById(state, state.currentPlayerId);
  if (player.stars < stats.cost) {
    throw new GameRuleError(
      'NOT_ENOUGH_STARS',
      `Training a ${unitKind} costs ${stats.cost} stars, you have ${player.stars}`,
    );
  }

  const newUnit = {
    id: state.nextEntityId,
    kind: unitKind,
    ownerId: player.id,
    tileIndex: city.tileIndex,
    hp: stats.hp,
    hasMoved: true, // freshly trained units act starting next turn
  };
  return {
    ...state,
    players: state.players.map((p) =>
      p.id === player.id ? { ...p, stars: p.stars - stats.cost } : p,
    ),
    units: [...state.units, newUnit],
    nextEntityId: state.nextEntityId + 1,
  };
}

function endTurn(state: GameState): GameState {
  const nextPlayerId = (state.currentPlayerId + 1) % state.players.length;
  const income = incomeFor(state, nextPlayerId);
  return {
    ...state,
    turn: nextPlayerId === 0 ? state.turn + 1 : state.turn,
    currentPlayerId: nextPlayerId,
    players: state.players.map((p) =>
      p.id === nextPlayerId ? { ...p, stars: p.stars + income } : p,
    ),
    units: state.units.map((u) => (u.ownerId === nextPlayerId ? { ...u, hasMoved: false } : u)),
  };
}
