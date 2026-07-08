/**
 * Canvas 2D isometric renderer. Pure presentation: it reads GameState and
 * draws it, but never modifies it.
 */
import { toCoords, toIndex } from '../core/grid';
import type { GameState, Terrain, UnitKind } from '../core/types';

export const TILE_WIDTH = 56;
export const TILE_HEIGHT = 28;

const BACKGROUND = '#101423';

const TERRAIN_COLORS: Record<Terrain, string> = {
  field: '#7cb342',
  forest: '#7cb342',
  mountain: '#8d9199',
  water: '#4fc3f7',
  ocean: '#0277bd',
};

const RESOURCE_COLORS = {
  fruit: '#ff7043',
  animal: '#795548',
  metal: '#eceff1',
  fish: '#01579b',
} as const;

const PLAYER_COLORS = ['#e53935', '#1e88e5', '#fdd835', '#8e24aa'];

const UNIT_INITIALS: Record<UnitKind, string> = {
  warrior: 'G',
  archer: 'A',
  rider: 'J',
  defender: 'D',
};

export function playerColor(playerId: number): string {
  return PLAYER_COLORS[playerId % PLAYER_COLORS.length]!;
}

export interface RenderSelection {
  readonly selectedUnitId: number | null;
  readonly selectedCityId: number | null;
  readonly reachable: ReadonlySet<number>;
}

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D is not supported in this browser');
    }
    this.ctx = ctx;
  }

  /** Match the drawing buffer to the CSS size and device pixel ratio. */
  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const { clientWidth, clientHeight } = this.canvas;
    this.canvas.width = Math.max(1, Math.round(clientWidth * dpr));
    this.canvas.height = Math.max(1, Math.round(clientHeight * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Center of a tile's diamond, in CSS pixels. */
  private tileToScreen(state: GameState, x: number, y: number): { sx: number; sy: number } {
    const originX = this.canvas.clientWidth / 2;
    const originY = (this.canvas.clientHeight - state.mapSize * TILE_HEIGHT) / 2 + TILE_HEIGHT / 2;
    return {
      sx: originX + ((x - y) * TILE_WIDTH) / 2,
      sy: originY + ((x + y) * TILE_HEIGHT) / 2,
    };
  }

  /** Inverse of tileToScreen; returns a tile index or null outside the map. */
  screenToTile(state: GameState, px: number, py: number): number | null {
    const originX = this.canvas.clientWidth / 2;
    const originY = (this.canvas.clientHeight - state.mapSize * TILE_HEIGHT) / 2 + TILE_HEIGHT / 2;
    const dx = (px - originX) / (TILE_WIDTH / 2);
    const dy = (py - originY) / (TILE_HEIGHT / 2);
    const x = Math.round((dy + dx) / 2);
    const y = Math.round((dy - dx) / 2);
    if (x < 0 || x >= state.mapSize || y < 0 || y >= state.mapSize) {
      return null;
    }
    return toIndex(x, y, state.mapSize);
  }

  draw(state: GameState, selection: RenderSelection): void {
    const { ctx } = this;
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);

    for (let i = 0; i < state.tiles.length; i++) {
      this.drawTile(state, i, selection);
    }
    for (const city of state.cities) {
      const { x, y } = toCoords(city.tileIndex, state.mapSize);
      const { sx, sy } = this.tileToScreen(state, x, y);
      this.drawCity(sx, sy, playerColor(city.ownerId), city.isCapital, city.level);
    }
    for (const unit of state.units) {
      const { x, y } = toCoords(unit.tileIndex, state.mapSize);
      const { sx, sy } = this.tileToScreen(state, x, y);
      this.drawUnit(sx, sy, unit.kind, playerColor(unit.ownerId), {
        dimmed: unit.hasMoved,
        selected: unit.id === selection.selectedUnitId,
      });
    }
  }

  private diamondPath(sx: number, sy: number): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(sx, sy - TILE_HEIGHT / 2);
    ctx.lineTo(sx + TILE_WIDTH / 2, sy);
    ctx.lineTo(sx, sy + TILE_HEIGHT / 2);
    ctx.lineTo(sx - TILE_WIDTH / 2, sy);
    ctx.closePath();
  }

  private drawTile(state: GameState, index: number, selection: RenderSelection): void {
    const { ctx } = this;
    const tile = state.tiles[index]!;
    const { x, y } = toCoords(index, state.mapSize);
    const { sx, sy } = this.tileToScreen(state, x, y);

    this.diamondPath(sx, sy);
    ctx.fillStyle = TERRAIN_COLORS[tile.terrain];
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.lineWidth = 1;
    ctx.stroke();

    if (tile.terrain === 'forest') {
      this.drawTriangle(sx, sy, 8, '#33691e');
    } else if (tile.terrain === 'mountain') {
      this.drawTriangle(sx, sy, 10, '#eceff1');
    }
    if (tile.resource) {
      ctx.beginPath();
      ctx.arc(sx + TILE_WIDTH / 5, sy + TILE_HEIGHT / 6, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = RESOURCE_COLORS[tile.resource];
      ctx.fill();
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
      ctx.stroke();
    }
    if (tile.hasVillage) {
      ctx.fillStyle = '#6d4c41';
      ctx.fillRect(sx - 5, sy - 6, 10, 8);
      this.drawTriangle(sx, sy - 8, 7, '#4e342e');
    }
    if (selection.reachable.has(index)) {
      this.diamondPath(sx, sy);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.fill();
    }
  }

  private drawTriangle(sx: number, sy: number, size: number, color: string): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(sx, sy - size);
    ctx.lineTo(sx + size * 0.8, sy + size * 0.5);
    ctx.lineTo(sx - size * 0.8, sy + size * 0.5);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  private drawCity(sx: number, sy: number, color: string, isCapital: boolean, level: number): void {
    const { ctx } = this;
    ctx.fillStyle = color;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.fillRect(sx - 7, sy - 8, 14, 11);
    ctx.strokeRect(sx - 7, sy - 8, 14, 11);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 8px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(isCapital ? '★' : String(level), sx, sy - 2.5);
  }

  private drawUnit(
    sx: number,
    sy: number,
    kind: UnitKind,
    color: string,
    flags: { dimmed: boolean; selected: boolean },
  ): void {
    const { ctx } = this;
    ctx.save();
    if (flags.dimmed) {
      ctx.globalAlpha = 0.55;
    }
    ctx.beginPath();
    ctx.arc(sx, sy - 12, 9, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = flags.selected ? '#ffffff' : 'rgba(0, 0, 0, 0.6)';
    ctx.lineWidth = flags.selected ? 2.5 : 1.5;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(UNIT_INITIALS[kind], sx, sy - 12);
    ctx.restore();
  }
}
