/**
 * Deterministic hash-based value noise with fractal Brownian motion (fBm).
 * No Math.random: the same seed always produces the same field, which keeps
 * map generation reproducible and testable.
 */

/** Integer hash of a lattice point, mapped to [0, 1). */
function hash2(seed: number, x: number, y: number): number {
  let h = (seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Bilinear value noise in [0, 1). Continuous over (x, y). */
export function valueNoise(seed: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothstep(x - x0);
  const ty = smoothstep(y - y0);
  const top = lerp(hash2(seed, x0, y0), hash2(seed, x0 + 1, y0), tx);
  const bottom = lerp(hash2(seed, x0, y0 + 1), hash2(seed, x0 + 1, y0 + 1), tx);
  return lerp(top, bottom, ty);
}

/** Fractal Brownian motion: layered octaves of value noise, output in [0, 1). */
export function fbm(seed: number, x: number, y: number, octaves: number): number {
  let total = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxAmplitude = 0;
  for (let octave = 0; octave < octaves; octave++) {
    total += valueNoise(seed + octave * 1013, x * frequency, y * frequency) * amplitude;
    maxAmplitude += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return total / maxAmplitude;
}
