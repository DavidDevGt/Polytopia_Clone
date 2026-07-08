/**
 * Read-only helpers over GameState. Safe to use from the UI and from actions.
 */
import { CAPITAL_EXTRA_INCOME, CITY_BASE_INCOME, PASSABLE_TERRAIN, UNIT_STATS } from './constants';
import { neighbors } from './grid';
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

/**
 * Tiles the unit can move to this turn: BFS over passable, unoccupied tiles
 * up to the unit's movement. Other units block both passage and destination.
 */
export function reachableTiles(state: GameState, unit: Unit): Set<number> {
  const movement = UNIT_STATS[unit.kind].movement;
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
      if (distances.has(next) || !isPassable(state, next) || unitAt(state, next)) {
        continue;
      }
      distances.set(next, distance + 1);
      result.add(next);
      queue.push(next);
    }
  }
  return result;
}

export function incomeFor(state: GameState, playerId: PlayerId): number {
  return state.cities
    .filter((c) => c.ownerId === playerId)
    .reduce(
      (total, c) => total + CITY_BASE_INCOME + c.level + (c.isCapital ? CAPITAL_EXTRA_INCOME : 0),
      0,
    );
}
