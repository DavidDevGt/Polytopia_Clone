import { describe, expect, it } from 'vitest';
import { PASSABLE_TERRAIN } from '../constants';
import { chebyshevDistance } from '../grid';
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

  it('respects the approximate water budget', () => {
    const map = generateMap(createRng(11), CONFIG);
    const wet = map.tiles.filter((t) => t.terrain === 'water' || t.terrain === 'ocean').length;
    expect(wet).toBeGreaterThan(0);
    expect(wet).toBeLessThanOrEqual(Math.floor(16 * 16 * CONFIG.waterRatio));
  });
});
