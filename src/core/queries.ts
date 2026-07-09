/**
 * Read-only helpers over GameState. Safe to use from the UI and from actions.
 */
import {
  CAPITAL_EXTRA_INCOME,
  CITY_BASE_INCOME,
  CITY_TERRITORY_GROWTH_LEVEL,
  CITY_TERRITORY_RADIUS,
  CITY_TERRITORY_RADIUS_GROWN,
  FREE_UNITS_PER_CITY,
  PASSABLE_TERRAIN,
  UNIT_STATS,
  VISION_RADIUS,
} from './constants';
import { neighbors, tilesWithin } from './grid';
import type { City, GameState, Player, PlayerId, Unit } from './types';

export function unitAt(state: GameState, tileIndex: number): Unit | undefined {
  return state.units.find((u) => u.tileIndex === tileIndex);
}

export function cityAt(state: GameState, tileIndex: number): City | undefined {
  return state.cities.find((c) => c.tileIndex === tileIndex);
}

export function playerById(state: GameState, id: PlayerId): Player {
  const player = state.players.find((p) => p.id === id);
  if (!player) {
    throw new Error(`playerById: unknown player ${id}`);
  }
  return player;
}

export function isPassable(state: GameState, tileIndex: number): boolean {
  const tile = state.tiles[tileIndex];
  return tile !== undefined && PASSABLE_TERRAIN.has(tile.terrain);
}

export function territoryRadius(city: City): number {
  return city.level >= CITY_TERRITORY_GROWTH_LEVEL
    ? CITY_TERRITORY_RADIUS_GROWN
    : CITY_TERRITORY_RADIUS;
}

/** Tile indexes controlled by a city (its border). */
export function territoryOf(state: GameState, city: City): number[] {
  return tilesWithin(city.tileIndex, territoryRadius(city), state.mapSize);
}

/** Owner of the territory a tile belongs to, or null if unclaimed. */
export function territoryOwner(state: GameState, tileIndex: number): PlayerId | null {
  for (const city of state.cities) {
    if (territoryOf(state, city).includes(tileIndex)) {
      return city.ownerId;
    }
  }
  return null;
}

/** Tiles currently visible to a player: around their units and cities. */
export function visibleTiles(state: GameState, playerId: PlayerId): Set<number> {
  const visible = new Set<number>();
  const reveal = (center: number) => {
    for (const index of tilesWithin(center, VISION_RADIUS, state.mapSize)) {
      visible.add(index);
    }
  };
  for (const unit of state.units) {
    if (unit.ownerId === playerId) {
      reveal(unit.tileIndex);
    }
  }
  for (const city of state.cities) {
    if (city.ownerId === playerId) {
      reveal(city.tileIndex);
    }
  }
  return visible;
}

/**
 * Tiles the unit can move to this turn: BFS over passable, unoccupied tiles
 * up to the unit's movement. Other units block both passage and destination.
 */
export function reachableTiles(state: GameState, unit: Unit): Set<number> {
  const movement = UNIT_STATS[unit.kind].movement;
  const occupied = new Set<number>();
  for (const u of state.units) {
    if (u.id !== unit.id) {
      occupied.add(u.tileIndex);
    }
  }
  const distances = new Map<number, number>([[unit.tileIndex, 0]]);
  const queue = [unit.tileIndex];
  const result = new Set<number>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    const distance = distances.get(current)!;
    if (distance === movement) {
      continue;
    }
    for (const next of neighbors(current, state.mapSize)) {
      if (distances.has(next) || !isPassable(state, next) || occupied.has(next)) {
        continue;
      }
      distances.set(next, distance + 1);
      result.add(next);
      queue.push(next);
    }
  }
  return result;
}

export function grossIncomeFor(state: GameState, playerId: PlayerId): number {
  return state.cities
    .filter((c) => c.ownerId === playerId)
    .reduce(
      (total, c) => total + CITY_BASE_INCOME + c.level + (c.isCapital ? CAPITAL_EXTRA_INCOME : 0),
      0,
    );
}

/** Army maintenance: every unit beyond one per city costs a star per turn. */
export function upkeepFor(state: GameState, playerId: PlayerId): number {
  const unitCount = state.units.filter((u) => u.ownerId === playerId).length;
  const cityCount = state.cities.filter((c) => c.ownerId === playerId).length;
  return Math.max(0, unitCount - cityCount * FREE_UNITS_PER_CITY);
}

/** Net income applied at the start of the player's turn. May be negative. */
export function incomeFor(state: GameState, playerId: PlayerId): number {
  return grossIncomeFor(state, playerId) - upkeepFor(state, playerId);
}
