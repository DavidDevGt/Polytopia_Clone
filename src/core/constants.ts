import type { Terrain, UnitKind } from './types';

export const DEFAULT_MAP_SIZE = 16;
export const DEFAULT_PLAYER_COUNT = 2;

export const STARTING_STARS = 5;

/** Every city yields CITY_BASE_INCOME + level stars per turn. */
export const CITY_BASE_INCOME = 1;
export const CAPITAL_EXTRA_INCOME = 1;

export interface UnitStats {
  readonly cost: number;
  readonly hp: number;
  readonly attack: number;
  readonly defense: number;
  readonly movement: number;
  readonly range: number;
}

export const UNIT_STATS: Record<UnitKind, UnitStats> = {
  warrior: { cost: 2, hp: 10, attack: 2, defense: 2, movement: 1, range: 1 },
  archer: { cost: 3, hp: 10, attack: 2, defense: 1, movement: 1, range: 2 },
  rider: { cost: 3, hp: 10, attack: 2, defense: 1, movement: 2, range: 1 },
  defender: { cost: 3, hp: 15, attack: 1, defense: 3, movement: 1, range: 1 },
};

/**
 * Terrain units can walk on. Mountains and water will become passable later
 * through the tech tree (climbing, sailing).
 */
export const PASSABLE_TERRAIN: ReadonlySet<Terrain> = new Set<Terrain>(['field', 'forest']);
