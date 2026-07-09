import type { Resource, Terrain, UnitKind } from './types';

export const DEFAULT_MAP_SIZE = 16;
export const DEFAULT_PLAYER_COUNT = 2;

export const STARTING_STARS = 5;

/** Every city yields CITY_BASE_INCOME + level stars per turn. */
export const CITY_BASE_INCOME = 1;
export const CAPITAL_EXTRA_INCOME = 1;

/**
 * Expansion has a maintenance cost: every unit beyond one per owned city
 * costs 1 star per turn. Big armies demand a big economy.
 */
export const FREE_UNITS_PER_CITY = 1;

/** Tiles a city controls. Level 3+ pushes the border one ring further. */
export const CITY_TERRITORY_RADIUS = 1;
export const CITY_TERRITORY_RADIUS_GROWN = 2;
export const CITY_TERRITORY_GROWTH_LEVEL = 3;

/** Vision radius (Chebyshev) around units and cities for fog of war. */
export const VISION_RADIUS = 2;

/** Harvesting a resource: pay stars, gain city population. */
export const HARVEST_INFO: Record<
  Resource,
  { readonly cost: number; readonly population: number }
> = {
  fruit: { cost: 2, population: 1 },
  animal: { cost: 2, population: 1 },
  fish: { cost: 2, population: 1 },
  metal: { cost: 4, population: 2 },
};

export interface UnitStats {
  readonly cost: number;
  readonly hp: number;
  readonly attack: number;
  readonly defense: number;
  readonly movement: number;
  readonly range: number;
}

/**
 * Balance matrix — every unit has a role and a natural counter:
 * - warrior:  cheap line infantry; versatile, wins nothing outright.
 * - archer:   pokes without taking counters (range 2); melts to riders.
 * - rider:    flanker/raider; catches archers, bounces off defenders.
 * - defender: holds cities and chokepoints; archers chip it down safely.
 */
export const UNIT_STATS: Record<UnitKind, UnitStats> = {
  warrior: { cost: 2, hp: 10, attack: 2, defense: 2, movement: 1, range: 1 },
  archer: { cost: 3, hp: 8, attack: 2, defense: 1, movement: 1, range: 2 },
  rider: { cost: 3, hp: 10, attack: 2, defense: 1, movement: 2, range: 1 },
  defender: { cost: 3, hp: 15, attack: 1, defense: 3, movement: 1, range: 1 },
};

/** Combat tuning (see src/core/combat.ts for the formula). */
export const DAMAGE_SCALE = 4.5;
export const DEFENSE_BONUS_FOREST = 1.3;
export const DEFENSE_BONUS_CITY = 1.5;
export const DEFENSE_BONUS_CAPITAL = 1.8;
/** Flanking: each extra ally adjacent to the defender boosts the attack. */
export const SUPPORT_BONUS_PER_ALLY = 0.1;

export const KILLS_FOR_VETERAN = 2;
export const VETERAN_HP_BONUS = 5;

/** Units that spend a full turn idle recover HP (more in home territory). */
export const HEAL_IDLE = 2;
export const HEAL_HOME_TERRITORY = 4;

/**
 * Terrain units can walk on. Mountains and water will become passable later
 * through the tech tree (climbing, sailing).
 */
export const PASSABLE_TERRAIN: ReadonlySet<Terrain> = new Set<Terrain>(['field', 'forest']);
