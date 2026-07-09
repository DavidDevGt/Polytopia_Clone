/**
 * Procedural map generation, v2.
 *
 * Instead of scattering random tiles, the map is sculpted from two fractal
 * noise fields (elevation + moisture) with a radial falloff, which produces
 * continents with natural coastlines, inland lakes, mountain clusters along
 * high ground and moisture-driven forests. Thresholds are taken from
 * quantiles of the actual fields, so the configured terrain ratios hold on
 * every seed. Settlements are restricted to the largest connected landmass so
 * every capital can always reach every other one.
 */
import { PASSABLE_TERRAIN } from '../constants';
import { chebyshevDistance, neighbors, toCoords } from '../grid';
import { randInt, shuffle, type Rng } from '../rng';
import { fbm } from './noise';
import type { Resource, Terrain, Tile } from '../types';

export interface MapGenConfig {
  readonly size: number;
  readonly playerCount: number;
  /** Fraction of tiles turned into water/ocean. */
  readonly waterRatio: number;
  /** Fraction of the land turned into mountains. */
  readonly mountainRatio: number;
  /** Fraction of the land turned into forest. */
  readonly forestRatio: number;
  /** Minimum Chebyshev distance between villages (capitals included). */
  readonly minVillageSpacing: number;
  /** Villages to place per passable land tile. */
  readonly villageDensity: number;
}

export const DEFAULT_MAP_CONFIG: Omit<MapGenConfig, 'size' | 'playerCount'> = {
  waterRatio: 0.32,
  mountainRatio: 0.12,
  forestRatio: 0.22,
  minVillageSpacing: 3,
  villageDensity: 1 / 18,
};

export interface GeneratedMap {
  readonly tiles: readonly Tile[];
  /** One capital tile per player, ordered by player id. */
  readonly capitalTileIndexes: readonly number[];
}

const RESOURCE_CHANCE: Partial<Record<Terrain, { resource: Resource; chance: number }>> = {
  field: { resource: 'fruit', chance: 0.14 },
  forest: { resource: 'animal', chance: 0.2 },
  mountain: { resource: 'metal', chance: 0.3 },
  water: { resource: 'fish', chance: 0.18 },
};

export function generateMap(rng: Rng, config: MapGenConfig): GeneratedMap {
  const { size } = config;
  const tileCount = size * size;
  const noiseSeed = Math.floor(rng() * 2 ** 31);

  const terrain = sculptTerrain(noiseSeed, config);
  markOcean(terrain, size);

  const mainland = largestPassableRegion(terrain, size);
  const villages = placeVillages(rng, mainland, config);
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

/** Elevation + moisture fields → water, mountains, forests and fields. */
function sculptTerrain(noiseSeed: number, config: MapGenConfig): Terrain[] {
  const { size } = config;
  const tileCount = size * size;
  const elevation = new Array<number>(tileCount);
  const moisture = new Array<number>(tileCount);

  const frequency = 3.2 / size; // ~3 large landforms per map regardless of size
  for (let i = 0; i < tileCount; i++) {
    const { x, y } = toCoords(i, size);
    // Radial falloff sinks the borders so continents never touch the edge.
    const nx = (2 * x) / (size - 1) - 1;
    const ny = (2 * y) / (size - 1) - 1;
    const falloff = 1 - 0.55 * (nx * nx + ny * ny);
    elevation[i] = fbm(noiseSeed, x * frequency * 4, y * frequency * 4, 4) * falloff;
    moisture[i] = fbm(noiseSeed + 7919, x * frequency * 3 + 37, y * frequency * 3 + 91, 3);
  }

  // Quantile thresholds keep the configured ratios stable across seeds.
  const seaLevel = quantile(elevation, config.waterRatio);
  const terrain = new Array<Terrain>(tileCount);
  const landElevations: number[] = [];
  const landIndexes: number[] = [];
  for (let i = 0; i < tileCount; i++) {
    if (elevation[i]! < seaLevel) {
      terrain[i] = 'water';
    } else {
      terrain[i] = 'field';
      landElevations.push(elevation[i]!);
      landIndexes.push(i);
    }
  }

  const mountainLevel = quantile(landElevations, 1 - config.mountainRatio);
  const lowlandMoistures = landIndexes
    .filter((i) => elevation[i]! < mountainLevel)
    .map((i) => moisture[i]!);
  const forestLevel = quantile(lowlandMoistures, 1 - config.forestRatio);

  for (const i of landIndexes) {
    if (elevation[i]! >= mountainLevel) {
      terrain[i] = 'mountain';
    } else if (moisture[i]! >= forestLevel) {
      terrain[i] = 'forest';
    }
  }
  return terrain;
}

function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * q)));
  return sorted[index]!;
}

/** Water with no adjacent land is deep ocean; the rest stays as shore water. */
function markOcean(terrain: Terrain[], size: number): void {
  const isLand = (t: Terrain | undefined) => t !== 'water' && t !== 'ocean' && t !== undefined;
  const deep: number[] = [];
  for (let i = 0; i < terrain.length; i++) {
    if (terrain[i] === 'water' && !neighbors(i, size).some((n) => isLand(terrain[n]))) {
      deep.push(i);
    }
  }
  for (const i of deep) {
    terrain[i] = 'ocean';
  }
}

/** Largest 8-connected region of passable tiles: the game's mainland. */
function largestPassableRegion(terrain: readonly Terrain[], size: number): number[] {
  const visited = new Array<boolean>(terrain.length).fill(false);
  let best: number[] = [];
  for (let start = 0; start < terrain.length; start++) {
    if (visited[start] || !PASSABLE_TERRAIN.has(terrain[start]!)) {
      continue;
    }
    const region: number[] = [];
    const queue = [start];
    visited[start] = true;
    while (queue.length > 0) {
      const current = queue.pop()!;
      region.push(current);
      for (const next of neighbors(current, size)) {
        if (!visited[next] && PASSABLE_TERRAIN.has(terrain[next]!)) {
          visited[next] = true;
          queue.push(next);
        }
      }
    }
    if (region.length > best.length) {
      best = region;
    }
  }
  return best;
}

function placeVillages(rng: Rng, mainland: readonly number[], config: MapGenConfig): number[] {
  const shuffled = shuffle(rng, mainland);
  const target = Math.max(config.playerCount, Math.round(mainland.length * config.villageDensity));

  const villages: number[] = [];
  // Relax the spacing if the mainland is too small for one village per player.
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
