/**
 * Art bible in code: the single source of truth for color and light.
 *
 * Rules (see docs/ART.md):
 * - One sun, top-left. Every volume lights its west face and shades its
 *   south-east face with the SAME factors (LIGHT_FACE / DARK_FACE).
 * - Warm, sun-lit palette: saturated but never neon; shadows are cool.
 * - Team colors are reserved for ownership. Terrain never uses them.
 */

export const LIGHT_FACE = 0.78; // west/left extrusion face
export const DARK_FACE = 0.55; // south-east/right extrusion face
export const RIM_DARK = 0.88; // subtle top-face edge

export const PALETTE = {
  // Terrain tops
  field: '#a4c964',
  fieldWarm: '#b5d16d', // hash-mixed variation
  forestFloor: '#8db956',
  mountainRock: '#a9a4b5',
  sand: '#ecd9a0',
  waterShore: '#4fc0e8',
  waterDeep: '#1d6fa6',
  foam: '#eafaff',

  // Props
  canopyDark: '#3f7d46',
  canopyLight: '#5da158',
  trunk: '#7a5236',
  rockLit: '#c3bfce',
  rockShade: '#8b8698',
  snow: '#f4f7fb',
  houseWall: '#f1e6d2',
  houseWallShade: '#d9c9ae',
  wallStone: '#b9b2a4',
  plaza: '#d9c193',

  // Resources
  fruit: '#ff8a3c',
  fruitLeaf: '#4f8f4a',
  animal: '#8a5a3b',
  metal: '#e4e9f2',
  fish: '#d7ecff',

  // Atmosphere
  skyTop: '#101726',
  skyHorizon: '#2c3550',
  glowWarm: 'rgba(255, 196, 120, 0.10)',
  fog1: '#232c42',
  fog2: '#2b3550',
  fogRim: '#39456600',

  // Feedback
  gold: '#ffcf5c',
  danger: '#ff6a5c',
  heal: '#b8f27c',
} as const;

export const PLAYER_COLORS = ['#e8524a', '#3f8fe8', '#f0b429', '#9c6ade'];
export const PLAYER_COLORS_SOFT = ['#f2857f', '#7fb4f0', '#f6cd6b', '#bd97e8'];

export function playerColor(playerId: number): string {
  return PLAYER_COLORS[playerId % PLAYER_COLORS.length]!;
}

export function playerColorSoft(playerId: number): string {
  return PLAYER_COLORS_SOFT[playerId % PLAYER_COLORS_SOFT.length]!;
}

/** Parse '#rrggbb' or 'rgb(r, g, b)' into channels, so shade/mix compose. */
function channels(color: string): [number, number, number] {
  if (color.startsWith('#')) {
    const n = parseInt(color.slice(1), 16);
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  }
  const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(color);
  if (!m) {
    throw new Error(`channels: unsupported color format "${color}"`);
  }
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Multiply a color's brightness by `factor` (>1 tints toward white). */
export function shade(color: string, factor: number): string {
  const [r0, g0, b0] = channels(color);
  const ch = (v: number) =>
    factor <= 1 ? Math.round(v * factor) : Math.round(v + (255 - v) * (factor - 1));
  return `rgb(${Math.min(255, ch(r0))}, ${Math.min(255, ch(g0))}, ${Math.min(255, ch(b0))})`;
}

/** Blend two colors. t=0 → a, t=1 → b. */
export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = channels(a);
  const [br, bg, bb] = channels(b);
  const c = (sa: number, sb: number) => Math.round(sa + (sb - sa) * t);
  return `rgb(${c(ar, br)}, ${c(ag, bg)}, ${c(ab, bb)})`;
}

/** Deterministic per-tile jitter for prop placement and variation. */
export function tileHash(index: number, salt: number): number {
  let h = (index * 2654435761 + salt * 40503) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h >>> 16) & 0xffff) / 0xffff;
}
