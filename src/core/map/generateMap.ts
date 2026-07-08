import { PASSABLE_TERRAIN } from '../constants';
import { chebyshevDistance, neighbors, toIndex } from '../grid';
import { randInt, shuffle, type Rng } from '../rng';
import type { Resource, Terrain, Tile } from '../types';

export interface MapGenConfig {
  readonly size: number;
  readonly playerCount: number;
  /** Fraction of tiles turned into water/ocean. */
  readonly waterRatio: number;
  /** Fraction of the remaining land turned into mountains. */
  readonly mountainRatio: number;
  /** Fraction of the remaining land turned into forest. */
  readonly forestRatio: number;
  /** Minimum Chebyshev distance between villages (capitals included). */
  readonly minVillageSpacing: number;
  /** Villages to place per passable land tile. */
  readonly villageDensity: number;
}

export const DEFAULT_MAP_CONFIG: Omit<MapGenConfig, 'size' | 'playerCount'> = {
  waterRatio: 0.28,
  mountainRatio: 0.1,
  forestRatio: 0.18,
  minVillageSpacing: 3,
  villageDensity: 1 / 20,
};

export interface GeneratedMap {
  readonly tiles: readonly Tile[];
  /** One capital tile per player, ordered by player id. */
  readonly capitalTileIndexes: readonly number[];
}

const RESOURCE_CHANCE: Partial<Record<Terrain, { resource: Resource; chance: number }>> = {
  field: { resource: 'fruit', chance: 0.12 },
  forest: { resource: 'animal', chance: 0.18 },
  mountain: { resource: 'metal', chance: 0.25 },
  water: { resource: 'fish', chance: 0.15 },
};

export function generateMap(rng: Rng, config: MapGenConfig): GeneratedMap {
  const { size } = config;
  const tileCount = size * size;
  const terrain = new Array<Terrain>(tileCount).fill('field');

  carveWater(rng, terrain, size, Math.floor(tileCount * config.waterRatio));
  markOcean(terrain, size);
  placeReliefs(rng, terrain, config);

  const villages = placeVillages(rng, terrain, config);
  const capitals = chooseCapitals(rng, villages, size, config.playerCount);
  const capitalSet = new Set(capitals);
  const villageSet = new Set(villages.filter((v) => !capitalSet.has(v)));

  // Settlements always sit on clean fields so they are buildable and passable.
  for (const index of [...villageSet, ...capitalSet]) {
    terrain[index] = 'field';
  }

  const resources = rollResources(rng, terrain, villageSet, capitalSet);

  const tiles: Tile[] = [];
  for (let i = 0; i < tileCount; i++) {
    tiles.push({
      terrain: terrain[i]!,
      resource: resources[i]!,
      hasVillage: villageSet.has(i),
    });
  }
  return { tiles, capitalTileIndexes: capitals };
}

/** Grows water bodies with random walks until roughly `target` tiles are wet. */
function carveWater(rng: Rng, terrain: Terrain[], size: number, target: number): void {
  let placed = 0;
  let attempts = 0;
  while (placed < target && attempts < 1000) {
    attempts++;
    let x = randInt(rng, 0, size - 1);
    let y = randInt(rng, 0, size - 1);
    const walkLength = randInt(rng, size, size * 3);
    for (let step = 0; step < walkLength && placed < target; step++) {
      const index = toIndex(x, y, size);
      if (terrain[index] === 'field') {
        terrain[index] = 'water';
        placed++;
      }
      x = Math.min(size - 1, Math.max(0, x + randInt(rng, -1, 1)));
      y = Math.min(size - 1, Math.max(0, y + randInt(rng, -1, 1)));
    }
  }
}

/** Water with no adjacent land is deep ocean; the rest stays as shore water. */
function markOcean(terrain: Terrain[], size: number): void {
  const deep: number[] = [];
  for (let i = 0; i < terrain.length; i++) {
    if (terrain[i] === 'water' && !neighbors(i, size).some((n) => terrain[n] === 'field')) {
      deep.push(i);
    }
  }
  for (const i of deep) {
    terrain[i] = 'ocean';
  }
}

function placeReliefs(rng: Rng, terrain: Terrain[], config: MapGenConfig): void {
  const land: number[] = [];
  for (let i = 0; i < terrain.length; i++) {
    if (terrain[i] === 'field') {
      land.push(i);
    }
  }
  const shuffled = shuffle(rng, land);
  const mountainCount = Math.floor(land.length * config.mountainRatio);
  const forestCount = Math.floor(land.length * config.forestRatio);
  for (let i = 0; i < mountainCount; i++) {
    terrain[shuffled[i]!] = 'mountain';
  }
  for (let i = mountainCount; i < mountainCount + forestCount; i++) {
    terrain[shuffled[i]!] = 'forest';
  }
}

function placeVillages(rng: Rng, terrain: Terrain[], config: MapGenConfig): number[] {
  const candidates: number[] = [];
  for (let i = 0; i < terrain.length; i++) {
    if (PASSABLE_TERRAIN.has(terrain[i]!)) {
      candidates.push(i);
    }
  }
  const shuffled = shuffle(rng, candidates);
  const target = Math.max(
    config.playerCount,
    Math.round(candidates.length * config.villageDensity),
  );

  const villages: number[] = [];
  // Relax the spacing if the map is too crowded to fit one village per player.
  for (let spacing = config.minVillageSpacing; spacing >= 1; spacing--) {
    for (const candidate of shuffled) {
      if (villages.length >= target) {
        break;
      }
      const farEnough = villages.every(
        (v) => chebyshevDistance(v, candidate, config.size) >= spacing,
      );
      if (farEnough) {
        villages.push(candidate);
      }
    }
    if (villages.length >= config.playerCount) {
      break;
    }
  }
  if (villages.length < config.playerCount) {
    throw new Error(
      `generateMap: could not place ${config.playerCount} capitals on a ${config.size}x${config.size} map`,
    );
  }
  return villages;
}

/** Greedily picks capitals that maximize the distance between players. */
function chooseCapitals(
  rng: Rng,
  villages: readonly number[],
  size: number,
  playerCount: number,
): number[] {
  const first = villages[randInt(rng, 0, villages.length - 1)]!;
  const capitals = [first];
  while (capitals.length < playerCount) {
    let best = -1;
    let bestDistance = -1;
    for (const village of villages) {
      if (capitals.includes(village)) {
        continue;
      }
      const minDistance = Math.min(...capitals.map((c) => chebyshevDistance(c, village, size)));
      if (minDistance > bestDistance) {
        bestDistance = minDistance;
        best = village;
      }
    }
    capitals.push(best);
  }
  return capitals;
}

function rollResources(
  rng: Rng,
  terrain: readonly Terrain[],
  villageSet: ReadonlySet<number>,
  capitalSet: ReadonlySet<number>,
): (Resource | null)[] {
  const resources = new Array<Resource | null>(terrain.length).fill(null);
  for (let i = 0; i < terrain.length; i++) {
    if (villageSet.has(i) || capitalSet.has(i)) {
      continue;
    }
    const roll = RESOURCE_CHANCE[terrain[i]!];
    if (roll && rng() < roll.chance) {
      resources[i] = roll.resource;
    }
  }
  return resources;
}
