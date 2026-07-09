/**
 * The rules engine. All state changes go through applyAction / applyActionWithEvents,
 * which validate the action against the current state and return a brand-new
 * state without mutating the input. Invalid actions throw GameRuleError.
 *
 * applyActionWithEvents additionally reports what happened as GameEvents so
 * the presentation layer can animate, log and play sounds without diffing.
 */
import {
  HARVEST_INFO,
  HEAL_HOME_TERRITORY,
  HEAL_IDLE,
  KILLS_FOR_VETERAN,
  UNIT_STATS,
} from './constants';
import { forecastBattle, inAttackRange, maxHpOf } from './combat';
import { neighbors } from './grid';
import {
  cityAt,
  incomeFor,
  playerById,
  reachableTiles,
  territoryOf,
  territoryOwner,
  unitAt,
  visibleTiles,
} from './queries';
import type { City, GameState, PlayerId, Resource, Unit, UnitKind } from './types';

export type Action =
  | { readonly type: 'moveUnit'; readonly unitId: number; readonly to: number }
  | { readonly type: 'attack'; readonly attackerId: number; readonly defenderId: number }
  | { readonly type: 'capture'; readonly unitId: number }
  | { readonly type: 'trainUnit'; readonly cityId: number; readonly unitKind: UnitKind }
  | { readonly type: 'harvest'; readonly cityId: number; readonly tileIndex: number }
  | { readonly type: 'endTurn' };

export type GameEvent =
  | {
      readonly type: 'unitMoved';
      readonly unitId: number;
      readonly from: number;
      readonly to: number;
    }
  | {
      readonly type: 'attackResolved';
      readonly attackerId: number;
      readonly defenderId: number;
      readonly defenderTile: number;
      readonly attackerTile: number;
      readonly damageToDefender: number;
      readonly damageToAttacker: number;
      readonly defenderDied: boolean;
      readonly attackerDied: boolean;
      readonly attackerAdvancedTo: number | null;
      readonly promotedUnitId: number | null;
    }
  | {
      readonly type: 'cityCaptured';
      readonly cityId: number;
      readonly tileIndex: number;
      readonly byPlayer: PlayerId;
      readonly founded: boolean;
      readonly capital: boolean;
    }
  | {
      readonly type: 'unitTrained';
      readonly unitId: number;
      readonly kind: UnitKind;
      readonly tileIndex: number;
    }
  | {
      readonly type: 'harvested';
      readonly cityId: number;
      readonly tileIndex: number;
      readonly resource: Resource;
      readonly leveledUpTo: number | null;
    }
  | { readonly type: 'playerEliminated'; readonly playerId: PlayerId }
  | {
      readonly type: 'turnStarted';
      readonly playerId: PlayerId;
      readonly income: number;
      readonly healedUnitIds: readonly number[];
    }
  | { readonly type: 'gameWon'; readonly playerId: PlayerId };

export interface ActionResult {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
}

export type GameRuleErrorCode =
  | 'GAME_OVER'
  | 'UNIT_NOT_FOUND'
  | 'NOT_YOUR_UNIT'
  | 'UNIT_ALREADY_MOVED'
  | 'UNIT_ALREADY_ATTACKED'
  | 'UNREACHABLE_TILE'
  | 'OUT_OF_RANGE'
  | 'INVALID_TARGET'
  | 'NOTHING_TO_CAPTURE'
  | 'CITY_NOT_FOUND'
  | 'NOT_YOUR_CITY'
  | 'TILE_OCCUPIED'
  | 'NOT_ENOUGH_STARS'
  | 'NOTHING_TO_HARVEST'
  | 'OUTSIDE_TERRITORY';

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
  return applyActionWithEvents(state, action).state;
}

export function applyActionWithEvents(state: GameState, action: Action): ActionResult {
  if (state.winnerId !== null) {
    throw new GameRuleError('GAME_OVER', 'The game is over');
  }
  const result = dispatch(state, action);
  return { state: updateExploration(result.state), events: result.events };
}

function dispatch(state: GameState, action: Action): ActionResult {
  switch (action.type) {
    case 'moveUnit':
      return moveUnit(state, action.unitId, action.to);
    case 'attack':
      return attack(state, action.attackerId, action.defenderId);
    case 'capture':
      return capture(state, action.unitId);
    case 'trainUnit':
      return trainUnit(state, action.cityId, action.unitKind);
    case 'harvest':
      return harvest(state, action.cityId, action.tileIndex);
    case 'endTurn':
      return endTurn(state);
  }
}

/** Fog of war bookkeeping: everything currently visible becomes explored. */
function updateExploration(state: GameState): GameState {
  const players = state.players.map((player) => {
    if (player.eliminated) {
      return player;
    }
    const visible = visibleTiles(state, player.id);
    let changed = false;
    const explored = player.explored.map((seen, index) => {
      if (!seen && visible.has(index)) {
        changed = true;
        return true;
      }
      return seen;
    });
    return changed ? { ...player, explored } : player;
  });
  return { ...state, players };
}

function requireOwnUnit(state: GameState, unitId: number): Unit {
  const unit = state.units.find((u) => u.id === unitId);
  if (!unit) {
    throw new GameRuleError('UNIT_NOT_FOUND', `Unit ${unitId} does not exist`);
  }
  if (unit.ownerId !== state.currentPlayerId) {
    throw new GameRuleError('NOT_YOUR_UNIT', 'That unit belongs to another player');
  }
  return unit;
}

function moveUnit(state: GameState, unitId: number, to: number): ActionResult {
  const unit = requireOwnUnit(state, unitId);
  if (unit.hasMoved) {
    throw new GameRuleError('UNIT_ALREADY_MOVED', 'That unit already moved this turn');
  }
  if (!reachableTiles(state, unit).has(to)) {
    throw new GameRuleError('UNREACHABLE_TILE', 'The unit cannot reach that tile');
  }
  const from = unit.tileIndex;
  const units = state.units.map((u) =>
    u.id === unitId ? { ...u, tileIndex: to, hasMoved: true } : u,
  );
  return {
    state: { ...state, units },
    events: [{ type: 'unitMoved', unitId, from, to }],
  };
}

function attack(state: GameState, attackerId: number, defenderId: number): ActionResult {
  const attacker = requireOwnUnit(state, attackerId);
  if (attacker.hasAttacked) {
    throw new GameRuleError('UNIT_ALREADY_ATTACKED', 'That unit already attacked this turn');
  }
  const defender = state.units.find((u) => u.id === defenderId);
  if (!defender || defender.ownerId === attacker.ownerId) {
    throw new GameRuleError('INVALID_TARGET', 'The target is not a valid enemy unit');
  }
  if (!inAttackRange(state, attacker, defender)) {
    throw new GameRuleError('OUT_OF_RANGE', 'The target is out of range');
  }

  const forecast = forecastBattle(state, attacker, defender);
  const attackerDied = forecast.attackerDies;
  const defenderDied = forecast.defenderDies;

  const kills = attacker.kills + (defenderDied ? 1 : 0);
  const promoted = !attacker.veteran && kills >= KILLS_FOR_VETERAN;
  // Melee units step into the tile they just cleared.
  const advancedTo =
    defenderDied && UNIT_STATS[attacker.kind].range === 1 ? defender.tileIndex : null;

  const units = state.units.flatMap((u) => {
    if (u.id === defenderId) {
      return defenderDied ? [] : [{ ...u, hp: u.hp - forecast.damageToDefender }];
    }
    if (u.id === attackerId) {
      if (attackerDied) {
        return [];
      }
      const next: Unit = {
        ...u,
        hp: u.hp - forecast.damageToAttacker,
        kills,
        veteran: u.veteran || promoted,
        tileIndex: advancedTo ?? u.tileIndex,
        hasMoved: true,
        hasAttacked: true,
      };
      // Promotion celebrates the milestone with a full heal.
      return [promoted ? { ...next, hp: maxHpOf(next) } : next];
    }
    return [u];
  });

  return {
    state: { ...state, units },
    events: [
      {
        type: 'attackResolved',
        attackerId,
        defenderId,
        attackerTile: attacker.tileIndex,
        defenderTile: defender.tileIndex,
        damageToDefender: forecast.damageToDefender,
        damageToAttacker: forecast.damageToAttacker,
        defenderDied,
        attackerDied,
        attackerAdvancedTo: advancedTo,
        promotedUnitId: promoted ? attackerId : null,
      },
    ],
  };
}

/** Spending a full turn on a village or enemy city claims it. */
function capture(state: GameState, unitId: number): ActionResult {
  const unit = requireOwnUnit(state, unitId);
  if (unit.hasMoved || unit.hasAttacked) {
    throw new GameRuleError('UNIT_ALREADY_MOVED', 'Capturing requires the unit’s full turn');
  }
  const tile = state.tiles[unit.tileIndex]!;
  const cityHere = cityAt(state, unit.tileIndex);
  const spendTurn = (units: readonly Unit[]) =>
    units.map((u) => (u.id === unitId ? { ...u, hasMoved: true, hasAttacked: true } : u));

  if (tile.hasVillage) {
    const newCity: City = {
      id: state.nextEntityId,
      tileIndex: unit.tileIndex,
      ownerId: unit.ownerId,
      level: 1,
      population: 0,
      isCapital: false,
    };
    return {
      state: {
        ...state,
        tiles: state.tiles.map((t, i) => (i === unit.tileIndex ? { ...t, hasVillage: false } : t)),
        cities: [...state.cities, newCity],
        units: spendTurn(state.units),
        nextEntityId: state.nextEntityId + 1,
      },
      events: [
        {
          type: 'cityCaptured',
          cityId: newCity.id,
          tileIndex: newCity.tileIndex,
          byPlayer: unit.ownerId,
          founded: true,
          capital: false,
        },
      ],
    };
  }

  if (cityHere && cityHere.ownerId !== unit.ownerId) {
    return captureCity(state, cityHere, unit, spendTurn);
  }

  throw new GameRuleError('NOTHING_TO_CAPTURE', 'There is nothing to capture on this tile');
}

function captureCity(
  state: GameState,
  city: City,
  unit: Unit,
  spendTurn: (units: readonly Unit[]) => Unit[],
): ActionResult {
  const events: GameEvent[] = [
    {
      type: 'cityCaptured',
      cityId: city.id,
      tileIndex: city.tileIndex,
      byPlayer: unit.ownerId,
      founded: false,
      capital: city.isCapital,
    },
  ];

  let cities = state.cities.map((c) => (c.id === city.id ? { ...c, ownerId: unit.ownerId } : c));
  let units = spendTurn(state.units);
  let players = state.players;
  let winnerId = state.winnerId;

  // Losing the capital eliminates the player: their army disbands and their
  // remaining cities fall to the conqueror as spoils of war.
  if (city.isCapital) {
    const loserId = city.ownerId;
    cities = cities.map((c) => (c.ownerId === loserId ? { ...c, ownerId: unit.ownerId } : c));
    units = units.filter((u) => u.ownerId !== loserId);
    players = players.map((p) => (p.id === loserId ? { ...p, eliminated: true } : p));
    events.push({ type: 'playerEliminated', playerId: loserId });

    const alive = players.filter((p) => !p.eliminated);
    if (alive.length === 1) {
      winnerId = alive[0]!.id;
      events.push({ type: 'gameWon', playerId: winnerId });
    }
  }

  return { state: { ...state, cities, units, players, winnerId }, events };
}

function trainUnit(state: GameState, cityId: number, unitKind: UnitKind): ActionResult {
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

  const newUnit: Unit = {
    id: state.nextEntityId,
    kind: unitKind,
    ownerId: player.id,
    tileIndex: city.tileIndex,
    hp: stats.hp,
    kills: 0,
    veteran: false,
    hasMoved: true, // freshly trained units act starting next turn
    hasAttacked: true,
  };
  return {
    state: {
      ...state,
      players: state.players.map((p) =>
        p.id === player.id ? { ...p, stars: p.stars - stats.cost } : p,
      ),
      units: [...state.units, newUnit],
      nextEntityId: state.nextEntityId + 1,
    },
    events: [
      { type: 'unitTrained', unitId: newUnit.id, kind: unitKind, tileIndex: city.tileIndex },
    ],
  };
}

/** Pay stars to work a resource inside the city's borders: +population. */
function harvest(state: GameState, cityId: number, tileIndex: number): ActionResult {
  const city = state.cities.find((c) => c.id === cityId);
  if (!city) {
    throw new GameRuleError('CITY_NOT_FOUND', `City ${cityId} does not exist`);
  }
  if (city.ownerId !== state.currentPlayerId) {
    throw new GameRuleError('NOT_YOUR_CITY', 'That city belongs to another player');
  }
  const resource = state.tiles[tileIndex]?.resource;
  if (!resource) {
    throw new GameRuleError('NOTHING_TO_HARVEST', 'There is no resource on that tile');
  }
  if (!territoryOf(state, city).includes(tileIndex)) {
    throw new GameRuleError('OUTSIDE_TERRITORY', 'That tile is outside the city borders');
  }
  const info = HARVEST_INFO[resource];
  const player = playerById(state, state.currentPlayerId);
  if (player.stars < info.cost) {
    throw new GameRuleError(
      'NOT_ENOUGH_STARS',
      `Harvesting ${resource} costs ${info.cost} stars, you have ${player.stars}`,
    );
  }

  let population = city.population + info.population;
  let level = city.level;
  while (population >= level + 1) {
    population -= level + 1;
    level++;
  }
  const leveledUpTo = level > city.level ? level : null;

  return {
    state: {
      ...state,
      players: state.players.map((p) =>
        p.id === player.id ? { ...p, stars: p.stars - info.cost } : p,
      ),
      cities: state.cities.map((c) => (c.id === cityId ? { ...c, population, level } : c)),
      tiles: state.tiles.map((t, i) => (i === tileIndex ? { ...t, resource: null } : t)),
    },
    events: [{ type: 'harvested', cityId, tileIndex, resource, leveledUpTo }],
  };
}

function endTurn(state: GameState): ActionResult {
  // Units that held position all turn recover; home territory heals faster.
  // No healing while under siege (enemy adjacent): sieges must be breakable.
  const underSiege = (unit: Unit): boolean =>
    neighbors(unit.tileIndex, state.mapSize).some((tile) =>
      state.units.some((other) => other.tileIndex === tile && other.ownerId !== unit.ownerId),
    );
  const healedUnitIds: number[] = [];
  const healedUnits = state.units.map((u) => {
    if (u.ownerId !== state.currentPlayerId || u.hasMoved || u.hasAttacked) {
      return u;
    }
    const cap = maxHpOf(u);
    if (u.hp >= cap || underSiege(u)) {
      return u;
    }
    const inHome = territoryOwner(state, u.tileIndex) === u.ownerId;
    const healed = Math.min(cap, u.hp + (inHome ? HEAL_HOME_TERRITORY : HEAL_IDLE));
    healedUnitIds.push(u.id);
    return { ...u, hp: healed };
  });

  // Rotate to the next living player; a full wrap advances the round counter.
  let nextPlayerId = state.currentPlayerId;
  do {
    nextPlayerId = (nextPlayerId + 1) % state.players.length;
  } while (playerById(state, nextPlayerId).eliminated);
  const wrapped = nextPlayerId <= state.currentPlayerId;

  const income = incomeFor(state, nextPlayerId);
  return {
    state: {
      ...state,
      turn: wrapped ? state.turn + 1 : state.turn,
      currentPlayerId: nextPlayerId,
      players: state.players.map((p) =>
        p.id === nextPlayerId ? { ...p, stars: Math.max(0, p.stars + income) } : p,
      ),
      units: healedUnits.map((u) =>
        u.ownerId === nextPlayerId ? { ...u, hasMoved: false, hasAttacked: false } : u,
      ),
    },
    events: [{ type: 'turnStarted', playerId: nextPlayerId, income, healedUnitIds }],
  };
}
