/**
 * Grid-space minimap: terrain, fog, settlements and units at a glance, plus
 * an approximate viewport marker. Click-to-jump is wired up by the UI layer.
 */
import { toCoords, toIndex } from '../core/grid';
import type { GameState, Terrain } from '../core/types';
import { playerColor, TILE_H, TILE_W } from './renderer';

const MINI_COLORS: Record<Terrain, string> = {
  field: '#8db457',
  forest: '#5c8c46',
  mountain: '#9d99ab',
  water: '#3f9fcc',
  ocean: '#1d6491',
};

export class Minimap {
  private readonly ctx: CanvasRenderingContext2D;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D is not supported in this browser');
    }
    this.ctx = ctx;
  }

  private cell(state: GameState): number {
    return Math.max(2, Math.floor(this.canvas.width / state.mapSize));
  }

  draw(
    state: GameState,
    explored: readonly boolean[],
    visible: ReadonlySet<number>,
    camera: { x: number; y: number; zoom: number },
    viewportPx: { width: number; height: number },
  ): void {
    const { ctx } = this;
    const cell = this.cell(state);
    ctx.fillStyle = '#0c111d';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    for (let i = 0; i < state.tiles.length; i++) {
      const { x, y } = toCoords(i, state.mapSize);
      if (!explored[i]) {
        continue;
      }
      ctx.fillStyle = MINI_COLORS[state.tiles[i]!.terrain];
      ctx.globalAlpha = visible.has(i) ? 1 : 0.5;
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
    ctx.globalAlpha = 1;

    for (const city of state.cities) {
      if (!explored[city.tileIndex]) {
        continue;
      }
      const { x, y } = toCoords(city.tileIndex, state.mapSize);
      ctx.fillStyle = playerColor(city.ownerId);
      ctx.fillRect(x * cell - 1, y * cell - 1, cell + 2, cell + 2);
    }
    for (const unit of state.units) {
      if (!visible.has(unit.tileIndex)) {
        continue;
      }
      const { x, y } = toCoords(unit.tileIndex, state.mapSize);
      ctx.fillStyle = playerColor(unit.ownerId);
      ctx.beginPath();
      ctx.arc(x * cell + cell / 2, y * cell + cell / 2, Math.max(1.5, cell / 3), 0, Math.PI * 2);
      ctx.fill();
    }

    // Approximate viewport: convert the camera's world center to tile space.
    const tx = camera.y / TILE_H + camera.x / TILE_W;
    const ty = camera.y / TILE_H - camera.x / TILE_W;
    const halfW = viewportPx.width / 2 / camera.zoom;
    const halfH = viewportPx.height / 2 / camera.zoom;
    const radiusTiles = halfW / TILE_W + halfH / TILE_H;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = 1;
    ctx.strokeRect(
      (tx - radiusTiles / 2) * cell,
      (ty - radiusTiles / 2) * cell,
      radiusTiles * cell,
      radiusTiles * cell,
    );
  }

  /** Tile under a minimap pixel, or null outside the map. */
  tileAt(state: GameState, px: number, py: number): number | null {
    const cell = this.cell(state);
    const x = Math.floor(px / cell);
    const y = Math.floor(py / cell);
    if (x < 0 || x >= state.mapSize || y < 0 || y >= state.mapSize) {
      return null;
    }
    return toIndex(x, y, state.mapSize);
  }
}
