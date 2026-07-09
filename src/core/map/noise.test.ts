import { describe, expect, it } from 'vitest';
import { fbm, valueNoise } from './noise';

describe('valueNoise', () => {
  it('is deterministic for the same seed and coordinates', () => {
    expect(valueNoise(42, 1.37, 8.02)).toBe(valueNoise(42, 1.37, 8.02));
  });

  it('differs across seeds', () => {
    const a = Array.from({ length: 20 }, (_, i) => valueNoise(1, i * 0.7, i * 1.3));
    const b = Array.from({ length: 20 }, (_, i) => valueNoise(2, i * 0.7, i * 1.3));
    expect(a).not.toEqual(b);
  });

  it('stays within [0, 1)', () => {
    for (let i = 0; i < 500; i++) {
      const v = valueNoise(7, i * 0.31, i * 0.17);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('fbm', () => {
  it('stays within [0, 1) and is smooth-ish between close points', () => {
    for (let i = 0; i < 200; i++) {
      const v = fbm(11, i * 0.13, i * 0.29, 4);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    const a = fbm(11, 5.0, 5.0, 4);
    const b = fbm(11, 5.01, 5.0, 4);
    expect(Math.abs(a - b)).toBeLessThan(0.05);
  });
});
