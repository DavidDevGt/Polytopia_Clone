/**
 * Canvas 2D isometric renderer, v2. Pure presentation: it reads GameState and
 * a view descriptor and draws them; it never modifies core state.
 *
 * Visual language: extruded tile blocks for depth, animated shore water,
 * fog-of-war clouds, territory tinting with hard borders, tweened units with
 * health bars, and a particle layer for damage numbers and captures.
 */
import { toCoords } from '../core/grid';
import type { GameEvent } from '../core/actions';
import { maxHpOf } from '../core/combat';
import type { GameState, Terrain, UnitKind } from '../core/types';
import { Particles, UnitTweens, type WorldPoint } from './animation';

export const TILE_W = 64;
export const TILE_H = 32;
const BLOCK_DEPTH = 10;
const WATER_SINK = 5;

const PLAYER_COLORS = ['#ff5d55', '#4d9fff', '#ffd147', '#c07bff'];

export function playerColor(playerId: number): string {
  return PLAYER_COLORS[playerId % PLAYER_COLORS.length]!;
}

const UNIT_INITIALS: Record<UnitKind, string> = {
  warrior: 'G',
  archer: 'A',
  rider: 'J',
  defender: 'D',
};

const TERRAIN_TOP: Record<Terrain, string> = {
  field: '#96c358',
  forest: '#7fb04c',
  mountain: '#a8b0bd',
  water: '#3aa7dd',
  ocean: '#20719f',
};

const FOG_COLOR = '#161d2e';

/** Multiply a #rrggbb color's brightness by `factor`. */
function shade(hex: string, factor: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 0xff) * factor));
  const g = Math.min(255, Math.round(((n >> 8) & 0xff) * factor));
  const b = Math.min(255, Math.round((n & 0xff) * factor));
  return `rgb(${r}, ${g}, ${b})`;
}

/** Deterministic per-tile jitter for decoration placement. */
function tileHash(index: number, salt: number): number {
  let h = (index * 2654435761 + salt * 97) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h >>> 16) & 0xffff) / 0xffff;
}

export interface DrawOptions {
  readonly viewerId: number;
  readonly explored: readonly boolean[];
  readonly visible: ReadonlySet<number>;
  readonly selectedUnitId: number | null;
  readonly selectedCityId: number | null;
  readonly reachable: ReadonlySet<number>;
  readonly attackableTiles: ReadonlySet<number>;
  readonly hoverTile: number | null;
}

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly tweens = new UnitTweens();
  private readonly particles = new Particles();

  private camX = 0;
  private camY = 0;
  private zoom = 1.4;
  private targetCamX = 0;
  private targetCamY = 0;
  private targetZoom = 1.4;
  private shakeAmount = 0;
  private lastFrame = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D is not supported in this browser');
    }
    this.ctx = ctx;
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    this.canvas.height = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ----- camera ------------------------------------------------------------

  worldOfTile(state: GameState, index: number): WorldPoint {
    const { x, y } = toCoords(index, state.mapSize);
    return { x: ((x - y) * TILE_W) / 2, y: ((x + y) * TILE_H) / 2 };
  }

  private toScreen(p: WorldPoint): WorldPoint {
    return {
      x: (p.x - this.camX) * this.zoom + this.canvas.clientWidth / 2,
      y: (p.y - this.camY) * this.zoom + this.canvas.clientHeight / 2,
    };
  }

  screenToTile(state: GameState, px: number, py: number): number | null {
    const wx = (px - this.canvas.clientWidth / 2) / this.zoom + this.camX;
    const wy = (py - this.canvas.clientHeight / 2) / this.zoom + this.camY;
    const x = Math.round(wy / TILE_H + wx / TILE_W);
    const y = Math.round(wy / TILE_H - wx / TILE_W);
    if (x < 0 || x >= state.mapSize || y < 0 || y >= state.mapSize) {
      return null;
    }
    return y * state.mapSize + x;
  }

  centerOn(state: GameState, index: number): void {
    const p = this.worldOfTile(state, index);
    this.targetCamX = p.x;
    this.targetCamY = p.y;
    this.camX = p.x;
    this.camY = p.y;
  }

  panBy(dx: number, dy: number): void {
    this.targetCamX -= dx / this.zoom;
    this.targetCamY -= dy / this.zoom;
    this.camX = this.targetCamX;
    this.camY = this.targetCamY;
  }

  zoomBy(factor: number): void {
    this.targetZoom = Math.min(2.4, Math.max(0.5, this.targetZoom * factor));
  }

  shake(amount: number): void {
    this.shakeAmount = Math.max(this.shakeAmount, amount);
  }

  get cameraInfo(): { x: number; y: number; zoom: number } {
    return { x: this.camX, y: this.camY, zoom: this.zoom };
  }

  // ----- events → animation -----------------------------------------------

  playEvents(state: GameState, events: readonly GameEvent[], now: number): void {
    for (const event of events) {
      switch (event.type) {
        case 'unitMoved':
          this.tweens.move(
            event.unitId,
            this.worldOfTile(state, event.from),
            this.worldOfTile(state, event.to),
            now,
          );
          break;
        case 'attackResolved': {
          const from = this.worldOfTile(state, event.attackerTile);
          const target = this.worldOfTile(state, event.defenderTile);
          if (!event.attackerDied) {
            if (event.attackerAdvancedTo !== null) {
              this.tweens.move(event.attackerId, from, target, now);
            } else {
              this.tweens.lunge(event.attackerId, from, target, now);
            }
          }
          this.particles.damageText(target, `-${event.damageToDefender}`, '#ffe066');
          if (event.damageToAttacker > 0) {
            this.particles.damageText(from, `-${event.damageToAttacker}`, '#ff8f8f');
          }
          if (event.defenderDied || event.attackerDied) {
            this.particles.burst(event.defenderDied ? target : from, '#ffb0a0', 10);
            this.shake(5);
          }
          if (event.promotedUnitId !== null) {
            this.particles.damageText(from, '★ Veterano', '#ffd147');
            this.particles.burst(from, '#ffd147', 12);
          }
          break;
        }
        case 'cityCaptured': {
          const at = this.worldOfTile(state, event.tileIndex);
          this.particles.ring(at, playerColor(event.byPlayer));
          this.particles.burst(at, playerColor(event.byPlayer), 14);
          this.shake(event.capital ? 7 : 3);
          break;
        }
        case 'unitTrained':
          this.tweens.spawn(event.unitId, this.worldOfTile(state, event.tileIndex), now);
          break;
        case 'harvested': {
          const at = this.worldOfTile(state, event.tileIndex);
          this.particles.damageText(at, '+población', '#b8f27c');
          if (event.leveledUpTo !== null) {
            this.particles.ring(at, '#ffd147');
          }
          break;
        }
        case 'gameWon': {
          const capital = state.cities.find((c) => c.ownerId === event.playerId && c.isCapital);
          if (capital) {
            const at = this.worldOfTile(state, capital.tileIndex);
            this.particles.burst(at, playerColor(event.playerId), 26);
          }
          break;
        }
        case 'playerEliminated':
        case 'turnStarted':
          break;
      }
    }
  }

  // ----- drawing ------------------------------------------------------------

  draw(state: GameState, opts: DrawOptions, now: number): void {
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000 || 0.016);
    this.lastFrame = now;

    // Smooth camera & decaying shake.
    this.camX += (this.targetCamX - this.camX) * Math.min(1, dt * 10);
    this.camY += (this.targetCamY - this.camY) * Math.min(1, dt * 10);
    this.zoom += (this.targetZoom - this.zoom) * Math.min(1, dt * 12);
    this.shakeAmount = Math.max(0, this.shakeAmount - dt * 28);
    this.particles.update(dt);

    const { ctx } = this;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;

    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#0d1322');
    sky.addColorStop(1, '#1b2438');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    if (this.shakeAmount > 0) {
      const angle = now / 18;
      ctx.translate(
        Math.sin(angle) * this.shakeAmount,
        Math.cos(angle * 1.3) * this.shakeAmount * 0.6,
      );
    }

    const territory = this.territoryMap(state);
    for (let i = 0; i < state.tiles.length; i++) {
      this.drawTile(state, i, opts, territory, now);
    }
    this.drawEntities(state, opts, now);
    this.particles.draw(ctx, (p) => this.toScreen(p), this.zoom);
    ctx.restore();

    // Soft vignette for depth.
    const vignette = ctx.createRadialGradient(w / 2, h / 2, h * 0.45, w / 2, h / 2, h);
    vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vignette.addColorStop(1, 'rgba(0, 0, 0, 0.38)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);
  }

  private territoryMap(state: GameState): Map<number, number> {
    const map = new Map<number, number>();
    for (const city of state.cities) {
      const radius = city.level >= 3 ? 2 : 1;
      const { x, y } = toCoords(city.tileIndex, state.mapSize);
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < state.mapSize && ny >= 0 && ny < state.mapSize) {
            map.set(ny * state.mapSize + nx, city.ownerId);
          }
        }
      }
    }
    return map;
  }

  private diamond(cx: number, cy: number): void {
    const { ctx } = this;
    const hw = (TILE_W / 2) * this.zoom;
    const hh = (TILE_H / 2) * this.zoom;
    ctx.beginPath();
    ctx.moveTo(cx, cy - hh);
    ctx.lineTo(cx + hw, cy);
    ctx.lineTo(cx, cy + hh);
    ctx.lineTo(cx - hw, cy);
    ctx.closePath();
  }

  private drawTile(
    state: GameState,
    index: number,
    opts: DrawOptions,
    territory: Map<number, number>,
    now: number,
  ): void {
    const { ctx } = this;
    const world = this.worldOfTile(state, index);
    const screen = this.toScreen(world);
    const hw = (TILE_W / 2) * this.zoom;
    const hh = (TILE_H / 2) * this.zoom;

    // Unexplored: a flat fog slab, nothing else.
    if (!opts.explored[index]) {
      this.diamond(screen.x, screen.y);
      ctx.fillStyle = FOG_COLOR;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
      ctx.stroke();
      return;
    }

    const tile = state.tiles[index]!;
    const isWater = tile.terrain === 'water' || tile.terrain === 'ocean';
    const sink = isWater ? WATER_SINK * this.zoom : 0;
    const cx = screen.x;
    const cy = screen.y + sink;
    const top = TERRAIN_TOP[tile.terrain];
    const depth = BLOCK_DEPTH * this.zoom;

    if (!isWater) {
      // Extruded block: left and right faces give the board its depth.
      ctx.beginPath();
      ctx.moveTo(cx - hw, cy);
      ctx.lineTo(cx, cy + hh);
      ctx.lineTo(cx, cy + hh + depth);
      ctx.lineTo(cx - hw, cy + depth);
      ctx.closePath();
      ctx.fillStyle = shade(top, 0.55);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx + hw, cy);
      ctx.lineTo(cx, cy + hh);
      ctx.lineTo(cx, cy + hh + depth);
      ctx.lineTo(cx + hw, cy + depth);
      ctx.closePath();
      ctx.fillStyle = shade(top, 0.4);
      ctx.fill();
    }

    // Top face.
    this.diamond(cx, cy);
    if (isWater) {
      const ripple = 1 + 0.06 * Math.sin(now / 620 + (world.x + world.y) / 40);
      ctx.fillStyle = shade(top, ripple);
    } else {
      ctx.fillStyle = top;
    }
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.12)';
    ctx.lineWidth = 1;
    ctx.stroke();

    if (tile.terrain === 'forest') {
      this.drawTrees(index, cx, cy, now);
    } else if (tile.terrain === 'mountain') {
      this.drawMountain(cx, cy);
    }
    if (tile.resource) {
      this.drawResource(tile.resource, cx, cy);
    }
    if (tile.hasVillage) {
      this.drawVillage(cx, cy);
    }

    // Territory tint + hard borders against differently-owned neighbors.
    const owner = territory.get(index);
    if (owner !== undefined) {
      this.diamond(cx, cy);
      ctx.fillStyle = playerColor(owner);
      ctx.globalAlpha = 0.12;
      ctx.fill();
      ctx.globalAlpha = 1;
      this.drawTerritoryBorders(state, index, owner, territory, cx, cy, hw, hh);
    }

    // Interaction overlays.
    if (opts.reachable.has(index)) {
      this.diamond(cx, cy);
      ctx.fillStyle = `rgba(255, 255, 255, ${0.3 + 0.09 * Math.sin(now / 260)})`;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
    if (opts.attackableTiles.has(index)) {
      this.diamond(cx, cy);
      ctx.strokeStyle = `rgba(255, 96, 80, ${0.75 + 0.25 * Math.sin(now / 200)})`;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
    if (opts.hoverTile === index) {
      this.diamond(cx, cy - 2 * this.zoom);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }

    // Explored but out of sight: dim it.
    if (!opts.visible.has(index)) {
      this.diamond(cx, cy);
      ctx.fillStyle = 'rgba(10, 14, 26, 0.45)';
      ctx.fill();
    }
  }

  private drawTerritoryBorders(
    state: GameState,
    index: number,
    owner: number,
    territory: Map<number, number>,
    cx: number,
    cy: number,
    hw: number,
    hh: number,
  ): void {
    const { ctx } = this;
    const { x, y } = toCoords(index, state.mapSize);
    const size = state.mapSize;
    const edges: Array<{ nx: number; ny: number; a: [number, number]; b: [number, number] }> = [
      { nx: x + 1, ny: y, a: [cx + hw, cy], b: [cx, cy + hh] }, // E-S edge
      { nx: x, ny: y + 1, a: [cx, cy + hh], b: [cx - hw, cy] }, // S-W edge
      { nx: x - 1, ny: y, a: [cx - hw, cy], b: [cx, cy - hh] }, // W-N edge
      { nx: x, ny: y - 1, a: [cx, cy - hh], b: [cx + hw, cy] }, // N-E edge
    ];
    ctx.strokeStyle = playerColor(owner);
    ctx.lineWidth = 1.6;
    ctx.globalAlpha = 0.85;
    for (const edge of edges) {
      const outside =
        edge.nx < 0 ||
        edge.nx >= size ||
        edge.ny < 0 ||
        edge.ny >= size ||
        territory.get(edge.ny * size + edge.nx) !== owner;
      if (outside) {
        ctx.beginPath();
        ctx.moveTo(edge.a[0], edge.a[1]);
        ctx.lineTo(edge.b[0], edge.b[1]);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawTrees(index: number, cx: number, cy: number, now: number): void {
    const { ctx } = this;
    const z = this.zoom;
    for (let i = 0; i < 3; i++) {
      const ox = (tileHash(index, i) - 0.5) * TILE_W * 0.4 * z;
      const oy = (tileHash(index, i + 7) - 0.5) * TILE_H * 0.4 * z;
      const sway = Math.sin(now / 900 + index + i) * 1.2 * z;
      const baseX = cx + ox;
      const baseY = cy + oy;
      const s = (6 + tileHash(index, i + 13) * 3) * z;
      ctx.beginPath();
      ctx.moveTo(baseX + sway, baseY - s * 1.7);
      ctx.lineTo(baseX + s * 0.7, baseY);
      ctx.lineTo(baseX - s * 0.7, baseY);
      ctx.closePath();
      ctx.fillStyle = i % 2 === 0 ? '#2f6b34' : '#3c8040';
      ctx.fill();
    }
  }

  private drawMountain(cx: number, cy: number): void {
    const { ctx } = this;
    const z = this.zoom;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 16 * z);
    ctx.lineTo(cx + 13 * z, cy + 4 * z);
    ctx.lineTo(cx - 13 * z, cy + 4 * z);
    ctx.closePath();
    ctx.fillStyle = '#8d95a3';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx, cy - 16 * z);
    ctx.lineTo(cx + 5 * z, cy - 8 * z);
    ctx.lineTo(cx - 5 * z, cy - 8 * z);
    ctx.closePath();
    ctx.fillStyle = '#e9edf4';
    ctx.fill();
  }

  private drawResource(resource: string, cx: number, cy: number): void {
    const { ctx } = this;
    const z = this.zoom;
    const x = cx + TILE_W * 0.22 * z;
    const y = cy + TILE_H * 0.12 * z;
    switch (resource) {
      case 'fruit':
        ctx.beginPath();
        ctx.arc(x, y, 3.4 * z, 0, Math.PI * 2);
        ctx.fillStyle = '#ff8a3c';
        ctx.fill();
        break;
      case 'animal':
        ctx.beginPath();
        ctx.arc(x - 2 * z, y, 2.8 * z, 0, Math.PI * 2);
        ctx.arc(x + 2.5 * z, y - 1.5 * z, 2 * z, 0, Math.PI * 2);
        ctx.fillStyle = '#8a5a3b';
        ctx.fill();
        break;
      case 'metal': {
        ctx.beginPath();
        ctx.moveTo(x, y - 3.6 * z);
        ctx.lineTo(x + 3.2 * z, y);
        ctx.lineTo(x, y + 3.6 * z);
        ctx.lineTo(x - 3.2 * z, y);
        ctx.closePath();
        ctx.fillStyle = '#dfe6ef';
        ctx.fill();
        ctx.strokeStyle = '#7c8794';
        ctx.stroke();
        break;
      }
      case 'fish':
        ctx.beginPath();
        ctx.ellipse(x, y, 3.6 * z, 2 * z, 0, 0, Math.PI * 2);
        ctx.fillStyle = '#cfe9ff';
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x - 3.4 * z, y);
        ctx.lineTo(x - 6 * z, y - 2 * z);
        ctx.lineTo(x - 6 * z, y + 2 * z);
        ctx.closePath();
        ctx.fill();
        break;
    }
  }

  private drawVillage(cx: number, cy: number): void {
    const { ctx } = this;
    const z = this.zoom;
    ctx.fillStyle = '#8d6e5a';
    ctx.fillRect(cx - 5 * z, cy - 5 * z, 10 * z, 7 * z);
    ctx.beginPath();
    ctx.moveTo(cx, cy - 11 * z);
    ctx.lineTo(cx + 6.5 * z, cy - 5 * z);
    ctx.lineTo(cx - 6.5 * z, cy - 5 * z);
    ctx.closePath();
    ctx.fillStyle = '#5d4437';
    ctx.fill();
  }

  private drawEntities(state: GameState, opts: DrawOptions, now: number): void {
    type Entity = { row: number; draw: () => void };
    const entities: Entity[] = [];

    for (const city of state.cities) {
      if (!opts.explored[city.tileIndex]) {
        continue;
      }
      const { x, y } = toCoords(city.tileIndex, state.mapSize);
      entities.push({ row: x + y, draw: () => this.drawCity(state, city.id, now) });
    }
    for (const unit of state.units) {
      const seen = unit.ownerId === opts.viewerId || opts.visible.has(unit.tileIndex);
      if (!seen) {
        continue;
      }
      const { x, y } = toCoords(unit.tileIndex, state.mapSize);
      entities.push({ row: x + y, draw: () => this.drawUnit(state, unit.id, opts, now) });
    }
    entities.sort((a, b) => a.row - b.row);
    for (const entity of entities) {
      entity.draw();
    }
  }

  private drawCity(state: GameState, cityId: number, now: number): void {
    const city = state.cities.find((c) => c.id === cityId);
    if (!city) {
      return;
    }
    const { ctx } = this;
    const z = this.zoom;
    const p = this.toScreen(this.worldOfTile(state, city.tileIndex));
    const color = playerColor(city.ownerId);

    // Houses.
    ctx.fillStyle = '#e8e0d2';
    ctx.fillRect(p.x - 9 * z, p.y - 6 * z, 8 * z, 7 * z);
    ctx.fillRect(p.x + 1 * z, p.y - 4 * z, 7 * z, 5 * z);
    ctx.fillStyle = shade(color, 0.85);
    ctx.beginPath();
    ctx.moveTo(p.x - 10 * z, p.y - 6 * z);
    ctx.lineTo(p.x - 5 * z, p.y - 11 * z);
    ctx.lineTo(p.x, p.y - 6 * z);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - 4 * z);
    ctx.lineTo(p.x + 4.5 * z, p.y - 8 * z);
    ctx.lineTo(p.x + 9 * z, p.y - 4 * z);
    ctx.closePath();
    ctx.fill();

    // Waving banner — tall enough to clear a garrisoned unit token.
    const poleX = p.x - 1 * z;
    const poleTop = p.y - 32 * z;
    ctx.strokeStyle = '#d9d2c4';
    ctx.lineWidth = 1.2 * z;
    ctx.beginPath();
    ctx.moveTo(poleX, p.y - 10 * z);
    ctx.lineTo(poleX, poleTop);
    ctx.stroke();
    const wave = Math.sin(now / 320 + cityId) * 2 * z;
    ctx.beginPath();
    ctx.moveTo(poleX, poleTop);
    ctx.quadraticCurveTo(
      poleX + 5 * z,
      poleTop + 1.5 * z + wave * 0.4,
      poleX + 10 * z,
      poleTop + wave,
    );
    ctx.lineTo(poleX + 10 * z, poleTop + 5 * z + wave);
    ctx.quadraticCurveTo(poleX + 5 * z, poleTop + 6.5 * z + wave * 0.4, poleX, poleTop + 5 * z);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();

    if (city.isCapital) {
      ctx.fillStyle = '#ffd147';
      ctx.font = `${Math.round(9 * z)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('★', poleX - 6 * z, poleTop + 2 * z);
    }

    // Level pips under the city.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    for (let i = 0; i < Math.min(city.level, 6); i++) {
      ctx.beginPath();
      ctx.arc(
        p.x - (city.level - 1) * 2.4 * z + i * 4.8 * z,
        p.y + 6.5 * z,
        1.7 * z,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }

  private drawUnit(state: GameState, unitId: number, opts: DrawOptions, now: number): void {
    const unit = state.units.find((u) => u.id === unitId);
    if (!unit) {
      return;
    }
    const { ctx } = this;
    const z = this.zoom;
    const resting = this.worldOfTile(state, unit.tileIndex);
    const sample = this.tweens.sample(unitId, resting, now);
    const world = sample?.pos ?? resting;
    const scale = (sample?.scale ?? 1) * z;
    const p = this.toScreen(world);
    const selected = opts.selectedUnitId === unitId;
    const lift = selected ? 3 * z : 0;
    const color = playerColor(unit.ownerId);
    const spent = unit.hasMoved && unit.hasAttacked && unit.ownerId === state.currentPlayerId;

    // Drop shadow.
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + 2 * z, 9 * scale, 4 * scale, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
    ctx.fill();

    if (selected) {
      ctx.beginPath();
      ctx.ellipse(
        p.x,
        p.y + 2 * z,
        (12 + Math.sin(now / 240) * 1.5) * z,
        (5.5 + Math.sin(now / 240) * 0.7) * z,
        0,
        0,
        Math.PI * 2,
      );
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }

    ctx.save();
    if (spent) {
      ctx.globalAlpha = 0.55;
    }
    const bodyY = p.y - 11 * z - lift;
    ctx.beginPath();
    ctx.arc(p.x, bodyY, 8.5 * scale, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(12, 16, 28, 0.7)';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.round(8.5 * scale)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(UNIT_INITIALS[unit.kind], p.x, bodyY + 0.5);

    if (unit.veteran) {
      ctx.fillStyle = '#ffd147';
      ctx.font = `${Math.round(7 * scale)}px system-ui, sans-serif`;
      ctx.fillText('★', p.x + 8 * scale, bodyY - 7 * scale);
    }

    // Health bar.
    const cap = maxHpOf(unit);
    const ratio = unit.hp / cap;
    const barW = 18 * z;
    ctx.fillStyle = 'rgba(10, 14, 24, 0.75)';
    ctx.fillRect(p.x - barW / 2, bodyY - 14 * z, barW, 3 * z);
    ctx.fillStyle = ratio > 0.55 ? '#7ade6a' : ratio > 0.28 ? '#ffd147' : '#ff6a5c';
    ctx.fillRect(p.x - barW / 2, bodyY - 14 * z, barW * ratio, 3 * z);
    ctx.restore();
  }
}
