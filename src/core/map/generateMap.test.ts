import { describe, expect, it } from 'vitest';
import { PASSABLE_TERRAIN } from '../constants';
import { chebyshevDistance, neighbors } from '../grid';
import { createRng } from '../rng';
import { DEFAULT_MAP_CONFIG, generateMap, type MapGenConfig } from './generateMap';

const CONFIG: MapGenConfig = { ...DEFAULT_MAP_CONFIG, size: 16, playerCount: 2 };

describe('generateMap', () => {
  it('is deterministic for the same seed', () => {
    const a = generateMap(createRng(42), CONFIG);
    const b = generateMap(createRng(42), CONFIG);
    expect(a).toEqual(b);
  });

  it('creates size * size tiles', () => {
    const map = generateMap(createRng(1), CONFIG);
    expect(map.tiles).toHaveLength(16 * 16);
  });

  it('places one capital per player, on distinct field tiles without villages', () => {
    const map = generateMap(createRng(7), CONFIG);
    expect(map.capitalTileIndexes).toHaveLength(2);
    expect(new Set(map.capitalTileIndexes).size).toBe(2);
    for (const index of map.capitalTileIndexes) {
      const tile = map.tiles[index]!;
      expect(tile.terrain).toBe('field');
      expect(tile.hasVillage).toBe(false);
    }
  });

  it('keeps all capitals mutually reachable over land', () => {
    for (const seed of [1, 7, 42, 99, 1234]) {
      const map = generateMap(createRng(seed), CONFIG);
      const [start, ...rest] = map.capitalTileIndexes;
      const reached = new Set([start!]);
      const queue = [start!];
      while (queue.length > 0) {
        const current = queue.pop()!;
        for (const next of neighbors(current, CONFIG.size)) {
          if (!reached.has(next) && PASSABLE_TERRAIN.has(map.tiles[next]!.terrain)) {
            reached.add(next);
            queue.push(next);
          }
        }
      }
      for (const capital of rest) {
        expect(reached.has(capital)).toBe(true);
      }
    }
  });

  it('places villages only on passable terrain, spaced apart', () => {
    const map = generateMap(createRng(3), CONFIG);
    const villages = map.tiles
      .map((tile, index) => ({ tile, index }))
      .filter(({ tile }) => tile.hasVillage);
    expect(villages.length).toBeGreaterThan(0);
    for (const { tile } of villages) {
      expect(PASSABLE_TERRAIN.has(tile.terrain)).toBe(true);
    }
    for (const a of villages) {
      for (const b of villages) {
        if (a.index !== b.index) {
          expect(chebyshevDistance(a.index, b.index, CONFIG.size)).toBeGreaterThanOrEqual(
            CONFIG.minVillageSpacing,
          );
        }
      }
    }
  });

  it('respects the approximate water budget on any seed', () => {
    for (const seed of [11, 77, 2024]) {
      const map = generateMap(createRng(seed), CONFIG);
      const wet = map.tiles.filter((t) => t.terrain === 'water' || t.terrain === 'ocean').length;
      const ratio = wet / map.tiles.length;
      expect(ratio).toBeGreaterThan(CONFIG.waterRatio * 0.5);
      expect(ratio).toBeLessThan(CONFIG.waterRatio * 1.2);
    }
  });

  it('forms contiguous landmasses rather than salt-and-pepper noise', () => {
    // The largest connected landmass should hold most of the passable tiles —
    // scattered random tiles would fragment into many small regions.
    const map = generateMap(createRng(5), CONFIG);
    const passable = new Set<number>();
    map.tiles.forEach((tile, index) => {
      if (PASSABLE_TERRAIN.has(tile.terrain)) {
        passable.add(index);
      }
    });
    const visited = new Set<number>();
    let largest = 0;
    for (const start of passable) {
      if (visited.has(start)) {
        continue;
      }
      let regionSize = 0;
      const queue = [start];
      visited.add(start);
      while (queue.length > 0) {
        const current = queue.pop()!;
        regionSize++;
        for (const next of neighbors(current, CONFIG.size)) {
          if (passable.has(next) && !visited.has(next)) {
            visited.add(next);
            queue.push(next);
          }
        }
      }
      largest = Math.max(largest, regionSize);
    }
    expect(largest / passable.size).toBeGreaterThan(0.6);
  });
});
