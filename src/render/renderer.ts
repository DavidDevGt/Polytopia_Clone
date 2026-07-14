/**
 * Canvas 2D isometric renderer, v3 — the art pass. Pure presentation: it
 * reads GameState plus a view descriptor and paints them; it never modifies
 * core state.
 *
 * Scene order: sky & clouds → tile blocks (varied tops, sand coasts, living
 * water) → territory → interaction overlays → props & units (row-sorted) →
 * particles → atmosphere (warm grade, edge haze, vignette).
 */
import { toCoords } from '../core/grid';
import type { GameEvent } from '../core/actions';
import { maxHpOf } from '../core/combat';
import type { GameState, Terrain } from '../core/types';
import { Particles, UnitTweens, type WorldPoint } from './animation';
import { DARK_FACE, LIGHT_FACE, PALETTE, mix, playerColor, shade, tileHash } from './palette';
import {
  drawCity,
  drawFogTile,
  drawForest,
  drawMountain,
  drawResourceProp,
  drawUnitSprite,
  drawVillage,
} from './props';

export { playerColor } from './palette';

export const TILE_W = 64;
export const TILE_H = 32;
const BLOCK_DEPTH = 11;
const WATER_SINK = 5;

const TERRAIN_TOP: Record<Terrain, string> = {
  field: PALETTE.field,
  forest: PALETTE.forestFloor,
  mountain: PALETTE.mountainRock,
  water: PALETTE.waterShore,
  ocean: PALETTE.waterDeep,
};

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
  /** unitId → timestamp until which the sprite flashes white (hit feedback). */
  private readonly flashes = new Map<number, number>();

  private camX = 0;
  private camY = 0;
  private zoom = 1.9;
  private targetCamX = 0;
  private targetCamY = 0;
  private targetZoom = 1.9;
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
    this.targetZoom = Math.min(3.2, Math.max(0.6, this.targetZoom * factor));
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
          if (!event.defenderDied) {
            this.flashes.set(event.defenderId, now + 200);
          }
          if (event.damageToAttacker > 0) {
            this.particles.damageText(from, `-${event.damageToAttacker}`, '#ff8f8f');
            if (!event.attackerDied) {
              this.flashes.set(event.attackerId, now + 200);
            }
          }
          if (event.defenderDied || event.attackerDied) {
            const at = event.defenderDied ? target : from;
            this.particles.burst(at, '#ffb0a0', 10);
            this.particles.ring(at, 'rgba(255, 255, 255, 0.8)');
            this.shake(5);
          }
          if (event.promotedUnitId !== null) {
            this.particles.damageText(from, '★ Veterano', PALETTE.gold);
            this.particles.burst(from, PALETTE.gold, 12);
          }
          break;
        }
        case 'cityCaptured': {
          const at = this.worldOfTile(state, event.tileIndex);
          this.particles.ring(at, playerColor(event.byPlayer));
          this.particles.burst(at, playerColor(event.byPlayer), 14);
          this.particles.burst(at, PALETTE.gold, 8);
          this.shake(event.capital ? 7 : 3);
          break;
        }
        case 'unitTrained':
          this.tweens.spawn(event.unitId, this.worldOfTile(state, event.tileIndex), now);
          break;
        case 'harvested': {
          const at = this.worldOfTile(state, event.tileIndex);
          this.particles.damageText(at, '+población', PALETTE.heal);
          this.particles.burst(at, PALETTE.heal, 6);
          if (event.leveledUpTo !== null) {
            this.particles.ring(at, PALETTE.gold);
          }
          break;
        }
        case 'gameWon': {
          const capital = state.cities.find((c) => c.ownerId === event.playerId && c.isCapital);
          if (capital) {
            const at = this.worldOfTile(state, capital.tileIndex);
            this.particles.burst(at, playerColor(event.playerId), 26);
            this.particles.burst(at, PALETTE.gold, 18);
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

    this.camX += (this.targetCamX - this.camX) * Math.min(1, dt * 10);
    this.camY += (this.targetCamY - this.camY) * Math.min(1, dt * 10);
    this.zoom += (this.targetZoom - this.zoom) * Math.min(1, dt * 12);
    this.shakeAmount = Math.max(0, this.shakeAmount - dt * 28);
    this.particles.update(dt);

    const { ctx } = this;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;

    this.drawSky(w, h, now);

    ctx.save();
    if (this.shakeAmount > 0) {
      const angle = now / 18;
      ctx.translate(
        Math.sin(angle) * this.shakeAmount,
        Math.cos(angle * 1.3) * this.shakeAmount * 0.6,
      );
    }

    this.drawOceanSkirt(state, now);

    const territory = this.territoryMap(state);
    for (let i = 0; i < state.tiles.length; i++) {
      this.drawTile(state, i, opts, territory, now);
    }
    this.drawEntities(state, opts, now);
    this.particles.draw(ctx, (p) => this.toScreen(p), this.zoom);
    ctx.restore();

    this.drawAtmosphere(w, h);
  }

  /** Bright day sky: blue above, pale warm horizon, drifting white clouds. */
  private drawSky(w: number, h: number, now: number): void {
    const { ctx } = this;
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, PALETTE.skyTop);
    sky.addColorStop(1, PALETTE.skyHorizon);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    const glow = ctx.createRadialGradient(w * 0.5, h * 0.5, h * 0.1, w * 0.5, h * 0.5, h * 0.9);
    glow.addColorStop(0, PALETTE.glowWarm);
    glow.addColorStop(1, 'rgba(255, 236, 190, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    for (let i = 0; i < 3; i++) {
      const cx = ((now / (40000 + i * 12000) + i * 0.37) % 1.3) * w * 1.3 - w * 0.15;
      const cy = h * (0.12 + i * 0.08);
      const r = 150 + i * 60;
      const cloud = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      cloud.addColorStop(0, 'rgba(255, 255, 255, 0.22)');
      cloud.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = cloud;
      // The rect must contain the full gradient circle or its clipped edges
      // read as a ghost rectangle in the sky.
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
  }

  /**
   * The board never floats in a void: a sunlit sea diamond extends past the
   * map bounds, so the world reads as an island in a bright ocean.
   */
  private drawOceanSkirt(state: GameState, now: number): void {
    const { ctx } = this;
    const last = state.mapSize - 1;
    const pad = TILE_W * 2.2;
    const north = this.toScreen({ x: 0, y: -pad * (TILE_H / TILE_W) });
    const east = this.worldOfTile(state, last); // x = last, y = 0
    const south = this.worldOfTile(state, last * state.mapSize + last);
    const west = this.worldOfTile(state, last * state.mapSize);
    const e = this.toScreen({ x: east.x + pad, y: east.y });
    const s = this.toScreen({ x: south.x, y: south.y + pad * (TILE_H / TILE_W) });
    const wpt = this.toScreen({ x: west.x - pad, y: west.y });

    ctx.beginPath();
    ctx.moveTo(north.x, north.y);
    ctx.lineTo(e.x, e.y);
    ctx.lineTo(s.x, s.y);
    ctx.lineTo(wpt.x, wpt.y);
    ctx.closePath();
    const sea = ctx.createLinearGradient(north.x, north.y, s.x, s.y);
    sea.addColorStop(0, shade(PALETTE.waterDeep, 1.08));
    sea.addColorStop(1, shade(PALETTE.waterDeep, 0.85));
    ctx.fillStyle = sea;
    ctx.fill();

    // Sparse drifting glints keep the open sea alive without stealing focus.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    for (let i = 0; i < 24; i++) {
      const t = tileHash(i, 200);
      const u = tileHash(i, 201);
      const tw = Math.sin(now / 1100 + i * 2.4);
      if (tw < 0.55) {
        continue;
      }
      const gx = north.x + (s.x - north.x) * 0.5 + (t - 0.5) * (e.x - wpt.x) * 0.92;
      const gy = north.y + (s.y - north.y) * (0.08 + u * 0.86);
      ctx.globalAlpha = (tw - 0.55) * 0.8;
      ctx.fillRect(gx, gy, 2.4 * this.zoom, 1.1 * this.zoom);
    }
    ctx.globalAlpha = 1;
  }

  /** A light warm grade — daylight needs no heavy haze or vignette. */
  private drawAtmosphere(w: number, h: number): void {
    const { ctx } = this;
    ctx.globalCompositeOperation = 'soft-light';
    ctx.fillStyle = 'rgba(255, 214, 150, 0.10)';
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';

    const vignette = ctx.createRadialGradient(w / 2, h / 2, h * 0.6, w / 2, h / 2, h * 1.15);
    vignette.addColorStop(0, 'rgba(20, 40, 70, 0)');
    vignette.addColorStop(1, 'rgba(20, 40, 70, 0.14)');
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

  private diamond(cx: number, cy: number, scale = 1): void {
    const { ctx } = this;
    const hw = (TILE_W / 2) * this.zoom * scale;
    const hh = (TILE_H / 2) * this.zoom * scale;
    ctx.beginPath();
    ctx.moveTo(cx, cy - hh);
    ctx.lineTo(cx + hw, cy);
    ctx.lineTo(cx, cy + hh);
    ctx.lineTo(cx - hw, cy);
    ctx.closePath();
  }

  /** 4-neighbor terrain lookup (E, S, W, N in grid space), or null off-map. */
  private neighborTerrain(state: GameState, index: number): (Terrain | null)[] {
    const { x, y } = toCoords(index, state.mapSize);
    const at = (nx: number, ny: number): Terrain | null =>
      nx < 0 || nx >= state.mapSize || ny < 0 || ny >= state.mapSize
        ? null
        : state.tiles[ny * state.mapSize + nx]!.terrain;
    return [at(x + 1, y), at(x, y + 1), at(x - 1, y), at(x, y - 1)];
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

    if (!opts.explored[index]) {
      drawFogTile(ctx, screen.x, screen.y, hw, hh, index, now);
      return;
    }

    const tile = state.tiles[index]!;
    const isWater = tile.terrain === 'water' || tile.terrain === 'ocean';
    const sink = isWater ? WATER_SINK * this.zoom : 0;
    const cx = screen.x;
    const cy = screen.y + sink;
    const depth = BLOCK_DEPTH * this.zoom;
    const neighbors4 = this.neighborTerrain(state, index);
    const waterAt = (t: Terrain | null) => t === 'water' || t === 'ocean';

    // Hash-varied top color so no two tiles read identical.
    const variation = tileHash(index, 1);
    let top = TERRAIN_TOP[tile.terrain];
    if (tile.terrain === 'field') {
      top = mix(PALETTE.field, PALETTE.fieldWarm, variation);
    } else if (tile.terrain === 'forest') {
      top = shade(PALETTE.forestFloor, 0.94 + variation * 0.12);
    } else if (tile.terrain === 'mountain') {
      top = shade(PALETTE.mountainRock, 0.94 + variation * 0.1);
    } else {
      // Water: keep tile-to-tile variation subtle or the sea reads patchy.
      top = shade(top, 0.98 + variation * 0.04);
    }

    if (!isWater) {
      // Extruded block: sunlit west face, shaded south-east face.
      ctx.beginPath();
      ctx.moveTo(cx - hw, cy);
      ctx.lineTo(cx, cy + hh);
      ctx.lineTo(cx, cy + hh + depth);
      ctx.lineTo(cx - hw, cy + depth);
      ctx.closePath();
      ctx.fillStyle = shade(top, LIGHT_FACE);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx + hw, cy);
      ctx.lineTo(cx, cy + hh);
      ctx.lineTo(cx, cy + hh + depth);
      ctx.lineTo(cx + hw, cy + depth);
      ctx.closePath();
      ctx.fillStyle = shade(top, DARK_FACE);
      ctx.fill();
    }

    // Top face.
    this.diamond(cx, cy);
    if (isWater) {
      const ripple = 1 + 0.05 * Math.sin(now / 640 + (world.x + world.y) / 42);
      ctx.fillStyle = shade(top, ripple);
    } else {
      ctx.fillStyle = top;
    }
    ctx.fill();

    if (isWater) {
      this.drawWaterDetail(state, index, cx, cy, hw, hh, neighbors4, now);
    } else {
      this.drawLandDetail(tile.terrain, index, cx, cy, hw, hh, neighbors4, waterAt);
    }

    if (tile.terrain === 'forest') {
      // Forest props draw in the entity pass for correct overlap; the floor
      // gets a soft inner shade suggesting undergrowth.
      this.diamond(cx, cy, 0.82);
      ctx.fillStyle = 'rgba(38, 74, 44, 0.18)';
      ctx.fill();
    }

    // Territory tint + hard borders against differently-owned neighbors.
    const owner = territory.get(index);
    if (owner !== undefined) {
      this.diamond(cx, cy);
      ctx.fillStyle = playerColor(owner);
      ctx.globalAlpha = 0.1;
      ctx.fill();
      ctx.globalAlpha = 1;
      this.drawTerritoryBorders(state, index, owner, territory, cx, cy, hw, hh);
    }

    // Interaction overlays.
    if (opts.reachable.has(index)) {
      this.diamond(cx, cy);
      ctx.fillStyle = `rgba(255, 255, 255, ${0.28 + 0.09 * Math.sin(now / 260)})`;
      ctx.fill();
      this.diamond(cx, cy, 0.9);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.lineWidth = 1.3;
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
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }

    // Explored but out of sight: dim the top face and both side faces
    // (never a bounding rect — it would bleed onto neighboring tiles).
    if (!opts.visible.has(index)) {
      ctx.fillStyle = 'rgba(52, 74, 105, 0.34)';
      this.diamond(cx, cy);
      ctx.fill();
      if (!isWater) {
        ctx.beginPath();
        ctx.moveTo(cx - hw, cy);
        ctx.lineTo(cx, cy + hh);
        ctx.lineTo(cx + hw, cy);
        ctx.lineTo(cx + hw, cy + depth);
        ctx.lineTo(cx, cy + hh + depth);
        ctx.lineTo(cx - hw, cy + depth);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  /** Waves, glints and coastal foam. */
  private drawWaterDetail(
    state: GameState,
    index: number,
    cx: number,
    cy: number,
    hw: number,
    hh: number,
    neighbors4: (Terrain | null)[],
    now: number,
  ): void {
    const { ctx } = this;
    const waterAt = (t: Terrain | null) => t === 'water' || t === 'ocean';

    // Two drifting wave strokes per tile.
    for (let i = 0; i < 2; i++) {
      const phase = now / 1400 + tileHash(index, 80 + i) * Math.PI * 2;
      const wx = cx + (tileHash(index, 82 + i) - 0.5) * hw * 0.9 + Math.sin(phase) * 3 * this.zoom;
      const wy = cy + (tileHash(index, 84 + i) - 0.5) * hh * 0.8;
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.1 + 0.08 * Math.sin(phase * 1.3)})`;
      ctx.lineWidth = 1.1 * this.zoom;
      ctx.beginPath();
      ctx.moveTo(wx - 4 * this.zoom, wy);
      ctx.quadraticCurveTo(wx, wy - 1.6 * this.zoom, wx + 4 * this.zoom, wy);
      ctx.stroke();
    }
    // Occasional sun glint.
    if (tileHash(index, 86) < 0.35) {
      const tw = Math.sin(now / 900 + tileHash(index, 87) * 40);
      if (tw > 0.86) {
        ctx.fillStyle = `rgba(255, 255, 255, ${(tw - 0.86) * 5})`;
        ctx.beginPath();
        ctx.arc(
          cx + (tileHash(index, 88) - 0.5) * hw,
          cy + (tileHash(index, 89) - 0.5) * hh,
          1.3 * this.zoom,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }
    // Foam along edges that touch land.
    const edges: Array<[[number, number], [number, number]]> = [
      [
        [cx + hw, cy],
        [cx, cy + hh],
      ], // E neighbor
      [
        [cx, cy + hh],
        [cx - hw, cy],
      ], // S
      [
        [cx - hw, cy],
        [cx, cy - hh],
      ], // W
      [
        [cx, cy - hh],
        [cx + hw, cy],
      ], // N
    ];
    edges.forEach((edge, i) => {
      const n = neighbors4[i]!;
      if (n !== null && !waterAt(n)) {
        const pulse = 0.3 + 0.18 * Math.sin(now / 750 + index + i);
        ctx.strokeStyle = `rgba(234, 250, 255, ${pulse})`;
        ctx.lineWidth = 1.8 * this.zoom;
        ctx.lineCap = 'round';
        // Inset toward the water center so the foam hugs the shore.
        const [a, b] = edge;
        const mxp = (a[0] + b[0]) / 2;
        const myp = (a[1] + b[1]) / 2;
        const inset = 0.14;
        ctx.beginPath();
        ctx.moveTo(a[0] + (cx - a[0]) * inset, a[1] + (cy - a[1]) * inset);
        ctx.quadraticCurveTo(
          mxp + (cx - mxp) * (inset * 0.3),
          myp + (cy - myp) * (inset * 0.3),
          b[0] + (cx - b[0]) * inset,
          b[1] + (cy - b[1]) * inset,
        );
        ctx.stroke();
        ctx.lineCap = 'butt';
      }
    });

    // Silence unused warning path: state kept for future depth blending.
    void state;
  }

  /** Sand shorelines, grass tufts, flowers, rock speckles. */
  private drawLandDetail(
    terrain: Terrain,
    index: number,
    cx: number,
    cy: number,
    hw: number,
    hh: number,
    neighbors4: (Terrain | null)[],
    waterAt: (t: Terrain | null) => boolean,
  ): void {
    const { ctx } = this;
    // Beach edge wherever land meets water.
    const corners: Array<[[number, number], [number, number]]> = [
      [
        [cx + hw, cy],
        [cx, cy + hh],
      ],
      [
        [cx, cy + hh],
        [cx - hw, cy],
      ],
      [
        [cx - hw, cy],
        [cx, cy - hh],
      ],
      [
        [cx, cy - hh],
        [cx + hw, cy],
      ],
    ];
    corners.forEach((edge, i) => {
      if (waterAt(neighbors4[i]!)) {
        const [a, b] = edge;
        ctx.strokeStyle = PALETTE.sand;
        ctx.lineWidth = 3.2 * this.zoom;
        ctx.lineCap = 'round';
        const inset = 0.08;
        ctx.beginPath();
        ctx.moveTo(a[0] + (cx - a[0]) * inset, a[1] + (cy - a[1]) * inset);
        ctx.lineTo(b[0] + (cx - b[0]) * inset, b[1] + (cy - b[1]) * inset);
        ctx.stroke();
        ctx.lineCap = 'butt';
      }
    });

    if (terrain === 'field') {
      // Grass tufts and the occasional wildflower.
      ctx.strokeStyle = 'rgba(74, 112, 44, 0.5)';
      ctx.lineWidth = 1 * this.zoom;
      for (let i = 0; i < 3; i++) {
        const gx = cx + (tileHash(index, 90 + i) - 0.5) * hw * 1.1;
        const gy = cy + (tileHash(index, 93 + i) - 0.5) * hh * 1.1;
        ctx.beginPath();
        ctx.moveTo(gx, gy);
        ctx.lineTo(gx + 1.2 * this.zoom, gy - 2.2 * this.zoom);
        ctx.stroke();
      }
      if (tileHash(index, 96) < 0.12) {
        ctx.fillStyle = tileHash(index, 97) < 0.5 ? '#ffd9e8' : PALETTE.gold;
        ctx.beginPath();
        ctx.arc(
          cx + (tileHash(index, 98) - 0.5) * hw * 0.9,
          cy + (tileHash(index, 99) - 0.5) * hh * 0.9,
          1.2 * this.zoom,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    } else if (terrain === 'mountain') {
      ctx.fillStyle = 'rgba(90, 86, 104, 0.4)';
      for (let i = 0; i < 2; i++) {
        ctx.beginPath();
        ctx.arc(
          cx + (tileHash(index, 100 + i) - 0.5) * hw,
          cy + (tileHash(index, 102 + i) - 0.5) * hh,
          1.1 * this.zoom,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
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
      { nx: x + 1, ny: y, a: [cx + hw, cy], b: [cx, cy + hh] },
      { nx: x, ny: y + 1, a: [cx, cy + hh], b: [cx - hw, cy] },
      { nx: x - 1, ny: y, a: [cx - hw, cy], b: [cx, cy - hh] },
      { nx: x, ny: y - 1, a: [cx, cy - hh], b: [cx + hw, cy] },
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

  private drawEntities(state: GameState, opts: DrawOptions, now: number): void {
    type Entity = { row: number; draw: () => void };
    const entities: Entity[] = [];
    const { ctx } = this;

    for (let i = 0; i < state.tiles.length; i++) {
      if (!opts.explored[i]) {
        continue;
      }
      const tile = state.tiles[i]!;
      const { x, y } = toCoords(i, state.mapSize);
      const p = this.toScreen(this.worldOfTile(state, i));
      if (tile.terrain === 'forest') {
        entities.push({ row: x + y, draw: () => drawForest(ctx, p.x, p.y, this.zoom, i, now) });
      } else if (tile.terrain === 'mountain') {
        entities.push({ row: x + y, draw: () => drawMountain(ctx, p.x, p.y, this.zoom, i) });
      }
      if (tile.resource) {
        entities.push({
          row: x + y,
          draw: () => drawResourceProp(ctx, p.x, p.y, this.zoom, tile.resource!, i, now),
        });
      }
      if (tile.hasVillage) {
        entities.push({ row: x + y, draw: () => drawVillage(ctx, p.x, p.y, this.zoom, i) });
      }
    }

    for (const city of state.cities) {
      if (!opts.explored[city.tileIndex]) {
        continue;
      }
      const { x, y } = toCoords(city.tileIndex, state.mapSize);
      const p = this.toScreen(this.worldOfTile(state, city.tileIndex));
      entities.push({
        row: x + y,
        draw: () =>
          drawCity(
            ctx,
            p.x,
            p.y,
            this.zoom,
            city.level,
            city.isCapital,
            playerColor(city.ownerId),
            city.id,
            now,
          ),
      });
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

  private drawUnit(state: GameState, unitId: number, opts: DrawOptions, now: number): void {
    const unit = state.units.find((u) => u.id === unitId);
    if (!unit) {
      return;
    }
    const { ctx } = this;
    const resting = this.worldOfTile(state, unit.tileIndex);
    const sample = this.tweens.sample(unitId, resting, now);
    const world = sample?.pos ?? resting;
    const p = this.toScreen(world);
    const spent = unit.hasMoved && unit.hasAttacked && unit.ownerId === state.currentPlayerId;
    const flashUntil = this.flashes.get(unitId) ?? 0;

    drawUnitSprite(ctx, p.x, p.y, this.zoom, unit.kind, playerColor(unit.ownerId), {
      dim: spent,
      selected: opts.selectedUnitId === unitId,
      flash: now < flashUntil,
      veteran: unit.veteran,
      scale: sample?.scale ?? 1,
      bob: Math.sin(now / 520 + unitId * 1.9) * 1.1 * this.zoom,
    });

    // Health bar only on wounded units — full-health armies stay clean.
    const cap = maxHpOf(unit);
    const ratio = unit.hp / cap;
    if (ratio < 1) {
      const barW = 16 * this.zoom;
      const by = p.y - 30 * this.zoom;
      ctx.fillStyle = 'rgba(12, 15, 26, 0.7)';
      ctx.beginPath();
      ctx.roundRect(p.x - barW / 2 - 1, by - 1, barW + 2, 3 * this.zoom + 2, 2);
      ctx.fill();
      ctx.fillStyle = ratio > 0.55 ? '#7ade6a' : ratio > 0.28 ? PALETTE.gold : PALETTE.danger;
      ctx.beginPath();
      ctx.roundRect(p.x - barW / 2, by, barW * ratio, 3 * this.zoom, 2);
      ctx.fill();
    }
  }
}
