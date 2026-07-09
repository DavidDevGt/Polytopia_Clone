/**
 * Square-grid helpers. Tiles are stored in a flat array indexed row-major
 * (index = y * size + x). Adjacency is 8-directional, like Polytopia.
 */

export interface Coords {
  readonly x: number;
  readonly y: number;
}

export function toIndex(x: number, y: number, size: number): number {
  return y * size + x;
}

export function toCoords(index: number, size: number): Coords {
  return { x: index % size, y: Math.floor(index / size) };
}

export function inBounds(x: number, y: number, size: number): boolean {
  return x >= 0 && x < size && y >= 0 && y < size;
}

const DIRECTIONS: readonly Coords[] = [
  { x: -1, y: -1 },
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: -1, y: 1 },
  { x: 0, y: 1 },
  { x: 1, y: 1 },
];

// Neighbor lists are precomputed once per map size: adjacency is queried in
// every BFS, visibility sweep and AI evaluation, so this is the hottest path.
const neighborCache = new Map<number, readonly (readonly number[])[]>();

function buildNeighborTable(size: number): readonly (readonly number[])[] {
  const table: number[][] = [];
  for (let index = 0; index < size * size; index++) {
    const { x, y } = toCoords(index, size);
    const list: number[] = [];
    for (const d of DIRECTIONS) {
      const nx = x + d.x;
      const ny = y + d.y;
      if (inBounds(nx, ny, size)) {
        list.push(toIndex(nx, ny, size));
      }
    }
    table.push(list);
  }
  return table;
}

export function neighbors(index: number, size: number): readonly number[] {
  let table = neighborCache.get(size);
  if (!table) {
    table = buildNeighborTable(size);
    neighborCache.set(size, table);
  }
  return table[index]!;
}

/** All tile indexes within Chebyshev distance `radius` of `center`. */
export function tilesWithin(center: number, radius: number, size: number): number[] {
  const { x, y } = toCoords(center, size);
  const result: number[] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (inBounds(nx, ny, size)) {
        result.push(toIndex(nx, ny, size));
      }
    }
  }
  return result;
}

/** Distance where diagonal steps cost 1 — matches 8-directional movement. */
export function chebyshevDistance(a: number, b: number, size: number): number {
  const ca = toCoords(a, size);
  const cb = toCoords(b, size);
  return Math.max(Math.abs(ca.x - cb.x), Math.abs(ca.y - cb.y));
}
