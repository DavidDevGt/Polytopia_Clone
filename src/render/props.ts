/**
 * Prop library: every object that lives on a tile, drawn as small vector
 * "miniatures" with one shared light (top-left) and one shared outline
 * language. Coordinates are screen pixels; (cx, cy) is the tile top center
 * and `z` the camera zoom.
 */
import type { UnitKind } from '../core/types';
import { DARK_FACE, LIGHT_FACE, PALETTE, shade, tileHash } from './palette';

const OUTLINE = 'rgba(23, 21, 34, 0.55)';
const SKIN = '#f2dcbc';

function softShadow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(20, 24, 38, 0.28)';
  ctx.fill();
}

// ---------------------------------------------------------------- forests

function drawTree(
  ctx: CanvasRenderingContext2D,
  x: number,
  baseY: number,
  s: number,
  sway: number,
  tone: number,
): void {
  softShadow(ctx, x + s * 0.2, baseY + s * 0.16, s * 0.85, s * 0.32);
  // Trunk
  ctx.fillStyle = PALETTE.trunk;
  ctx.fillRect(x - s * 0.14, baseY - s * 0.7, s * 0.28, s * 0.75);
  // Two-layer canopy, lit toward the sun (left) — lower layer first.
  const dark = shade(PALETTE.canopyDark, 0.9 + tone * 0.2);
  const light = shade(PALETTE.canopyLight, 0.9 + tone * 0.25);
  ctx.beginPath();
  ctx.moveTo(x + sway * 0.5, baseY - s * 1.35);
  ctx.lineTo(x + s * 0.78, baseY - s * 0.42);
  ctx.lineTo(x - s * 0.78, baseY - s * 0.42);
  ctx.closePath();
  ctx.fillStyle = dark;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x + sway, baseY - s * 1.95);
  ctx.lineTo(x + s * 0.55, baseY - s * 0.95);
  ctx.lineTo(x - s * 0.55, baseY - s * 0.95);
  ctx.closePath();
  ctx.fillStyle = light;
  ctx.fill();
  // Sun kiss on the left of the top layer.
  ctx.beginPath();
  ctx.moveTo(x + sway, baseY - s * 1.95);
  ctx.lineTo(x - s * 0.55, baseY - s * 0.95);
  ctx.lineTo(x - s * 0.2, baseY - s * 0.95);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255, 244, 200, 0.18)';
  ctx.fill();
}

export function drawForest(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  z: number,
  index: number,
  now: number,
): void {
  // Fewer, FAT trees: at readable zoom each conifer must own its silhouette.
  const count = 2 + (tileHash(index, 2) > 0.45 ? 1 : 0); // 2..3 trees
  for (let i = 0; i < count; i++) {
    // Cluster toward the center with per-tree jitter; sort by row for depth.
    const ox = (tileHash(index, 10 + i) - 0.5) * 26 * z;
    const oy = (tileHash(index, 20 + i) - 0.5) * 11 * z;
    const s = (8.5 + tileHash(index, 30 + i) * 4) * z;
    const sway = Math.sin(now / 1100 + index * 1.7 + i * 2.1) * 1.3 * z;
    drawTree(ctx, cx + ox, cy + oy + 2 * z, s, sway, tileHash(index, 40 + i));
  }
}

// --------------------------------------------------------------- mountains

export function drawMountain(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  z: number,
  index: number,
): void {
  softShadow(ctx, cx + 3 * z, cy + 5 * z, 20 * z, 6 * z);
  interface Peak {
    x: number;
    h: number;
    w: number;
    snow: boolean;
  }
  // Peaks that DOMINATE the tile — a mountain is a landmark, not a pebble.
  const main: Peak = {
    x: (tileHash(index, 3) - 0.5) * 8 * z,
    h: (24 + tileHash(index, 4) * 9) * z,
    w: (16 + tileHash(index, 5) * 5) * z,
    snow: tileHash(index, 6) > 0.35,
  };
  const side: Peak = {
    x: main.x + (tileHash(index, 7) > 0.5 ? 1 : -1) * (12 + tileHash(index, 8) * 5) * z,
    h: main.h * (0.5 + tileHash(index, 9) * 0.25),
    w: main.w * 0.7,
    snow: tileHash(index, 6) > 0.7,
  };
  // Far peak first.
  for (const peak of [side, main]) {
    const px = cx + peak.x;
    const top = cy + 3 * z - peak.h;
    // Lit west face.
    ctx.beginPath();
    ctx.moveTo(px, top);
    ctx.lineTo(px - peak.w, cy + 4 * z);
    ctx.lineTo(px - peak.w * 0.1, cy + 4 * z);
    ctx.closePath();
    ctx.fillStyle = shade(PALETTE.rockLit, 0.95 + tileHash(index, 11) * 0.1);
    ctx.fill();
    // Shaded east face.
    ctx.beginPath();
    ctx.moveTo(px, top);
    ctx.lineTo(px - peak.w * 0.1, cy + 4 * z);
    ctx.lineTo(px + peak.w * 0.85, cy + 4 * z);
    ctx.closePath();
    ctx.fillStyle = shade(PALETTE.rockShade, 0.92 + tileHash(index, 12) * 0.12);
    ctx.fill();
    if (peak.snow) {
      const sh = peak.h * 0.34;
      ctx.beginPath();
      ctx.moveTo(px, top);
      ctx.lineTo(px - peak.w * (sh / peak.h) * 0.95, top + sh);
      ctx.lineTo(px - peak.w * 0.02, top + sh * 0.72);
      ctx.lineTo(px + peak.w * (sh / peak.h) * 0.8, top + sh);
      ctx.closePath();
      ctx.fillStyle = PALETTE.snow;
      ctx.fill();
    }
  }
}

// -------------------------------------------------------------- buildings

function drawHouse(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  roof: string,
): void {
  softShadow(ctx, x + w * 0.1, y + h * 0.15, w * 0.75, h * 0.4);
  // Walls: lit left half, shaded right half.
  ctx.fillStyle = PALETTE.houseWall;
  ctx.fillRect(x - w / 2, y - h, w * 0.55, h);
  ctx.fillStyle = PALETTE.houseWallShade;
  ctx.fillRect(x - w / 2 + w * 0.55, y - h, w * 0.45, h);
  // Door.
  ctx.fillStyle = shade(PALETTE.trunk, 0.85);
  ctx.fillRect(x - w * 0.12, y - h * 0.55, w * 0.24, h * 0.55);
  // Gabled roof with lit/shaded halves.
  ctx.beginPath();
  ctx.moveTo(x, y - h * 1.75);
  ctx.lineTo(x - w * 0.62, y - h);
  ctx.lineTo(x, y - h);
  ctx.closePath();
  ctx.fillStyle = shade(roof, LIGHT_FACE + 0.3);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x, y - h * 1.75);
  ctx.lineTo(x, y - h);
  ctx.lineTo(x + w * 0.62, y - h);
  ctx.closePath();
  ctx.fillStyle = shade(roof, DARK_FACE + 0.25);
  ctx.fill();
}

export function drawVillage(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  z: number,
  index: number,
): void {
  const jitter = (tileHash(index, 55) - 0.5) * 4 * z;
  drawHouse(ctx, cx - 4 * z + jitter, cy + 3 * z, 14 * z, 8 * z, PALETTE.trunk);
  // A tiny neutral pennant tells "claimable" from afar.
  ctx.strokeStyle = '#d9d2c4';
  ctx.lineWidth = 1 * z;
  ctx.beginPath();
  ctx.moveTo(cx + 7 * z, cy + 2 * z);
  ctx.lineTo(cx + 7 * z, cy - 9 * z);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + 7 * z, cy - 9 * z);
  ctx.lineTo(cx + 12 * z, cy - 7.5 * z);
  ctx.lineTo(cx + 7 * z, cy - 6 * z);
  ctx.closePath();
  ctx.fillStyle = '#e8e0d2';
  ctx.fill();
}

function drawKeep(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  z: number,
  team: string,
  capital: boolean,
): void {
  const w = 11 * z;
  const h = (capital ? 19 : 15) * z;
  softShadow(ctx, x + 1.5 * z, y + 1.5 * z, w * 0.8, 3.4 * z);
  // Tower body, split lighting.
  ctx.fillStyle = shade(PALETTE.wallStone, 1.05);
  ctx.fillRect(x - w / 2, y - h, w * 0.55, h);
  ctx.fillStyle = shade(PALETTE.wallStone, 0.78);
  ctx.fillRect(x - w / 2 + w * 0.55, y - h, w * 0.45, h);
  // Crenellations.
  ctx.fillStyle = shade(PALETTE.wallStone, 0.92);
  for (let i = 0; i < 3; i++) {
    ctx.fillRect(x - w / 2 + i * (w / 2.6), y - h - 3 * z, w / 4.2, 3 * z);
  }
  // Arrow slit.
  ctx.fillStyle = 'rgba(23, 21, 34, 0.6)';
  ctx.fillRect(x - 0.8 * z, y - h * 0.62, 1.6 * z, 4.5 * z);
  if (capital) {
    // Gold trim marks the seat of power.
    ctx.fillStyle = PALETTE.gold;
    ctx.fillRect(x - w / 2, y - h + 1.2 * z, w, 1.4 * z);
  }
  // Team banner hanging from the top.
  ctx.fillStyle = team;
  ctx.fillRect(x - 1.8 * z, y - h + 2 * z, 3.6 * z, 6.5 * z);
  ctx.beginPath();
  ctx.moveTo(x - 1.8 * z, y - h + 8.5 * z);
  ctx.lineTo(x, y - h + 10.5 * z);
  ctx.lineTo(x + 1.8 * z, y - h + 8.5 * z);
  ctx.closePath();
  ctx.fill();
}

function drawWallFront(ctx: CanvasRenderingContext2D, cx: number, cy: number, z: number): void {
  // Low wall along the two south-facing edges, with a gate gap.
  ctx.strokeStyle = shade(PALETTE.wallStone, 0.9);
  ctx.lineWidth = 3 * z;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - 24 * z, cy + 2 * z);
  ctx.lineTo(cx - 7 * z, cy + 10.5 * z);
  ctx.moveTo(cx + 7 * z, cy + 10.5 * z);
  ctx.lineTo(cx + 24 * z, cy + 2 * z);
  ctx.stroke();
  ctx.lineCap = 'butt';
}

export function drawCity(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  z: number,
  level: number,
  isCapital: boolean,
  team: string,
  cityId: number,
  now: number,
): void {
  // Dirt plaza grounds the settlement on the tile.
  ctx.beginPath();
  ctx.moveTo(cx, cy - 10 * z);
  ctx.lineTo(cx + 24 * z, cy + 2 * z);
  ctx.lineTo(cx, cy + 13 * z);
  ctx.lineTo(cx - 24 * z, cy + 2 * z);
  ctx.closePath();
  ctx.fillStyle = PALETTE.plaza;
  ctx.globalAlpha = 0.9;
  ctx.fill();
  ctx.globalAlpha = 1;

  if (level >= 2) {
    drawWallFront(ctx, cx, cy, z);
  }
  // Polytopia rule made ours: every level visibly adds a house, so a city's
  // size is readable from the map alone. Spots ring the plaza north→south.
  const spots: Array<{ x: number; y: number; w: number }> = [
    { x: -11, y: 4, w: 12 },
    { x: 10, y: 6.5, w: 11 },
    { x: 14, y: 0, w: 10.5 },
    { x: -15, y: -1.5, w: 10 },
    { x: 3, y: 11, w: 10 },
  ];
  const houseCount = Math.min(1 + level, spots.length);
  const houseAt = (i: number): void => {
    const spot = spots[i]!;
    const roof = i % 2 === 0 ? team : PALETTE.trunk;
    drawHouse(ctx, cx + spot.x * z, cy + spot.y * z, spot.w * z, spot.w * 0.6 * z, roof);
  };
  // Back-row houses first, then the keep, then front-row houses over it.
  for (let i = 0; i < houseCount; i++) {
    if (spots[i]!.y < 0) {
      houseAt(i);
    }
  }
  if (level >= 3) {
    drawKeep(ctx, cx - 1 * z, cy - 1 * z, z, team, isCapital);
  }
  for (let i = 0; i < houseCount; i++) {
    if (spots[i]!.y >= 0) {
      houseAt(i);
    }
  }

  // Waving standard: every settlement flies its owner's colors.
  const poleX = cx - (level >= 3 ? 10 : 1) * z;
  const poleBase = cy - (level >= 3 ? 2 : 4) * z;
  const poleTop = poleBase - 22 * z;
  ctx.strokeStyle = '#d9d2c4';
  ctx.lineWidth = 1.2 * z;
  ctx.beginPath();
  ctx.moveTo(poleX, poleBase);
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
  ctx.fillStyle = team;
  ctx.fill();
  if (isCapital) {
    ctx.fillStyle = PALETTE.gold;
    ctx.font = `${Math.round(8 * z)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('★', poleX - 5 * z, poleTop + 2.5 * z);
  }
}

// --------------------------------------------------------------- resources

export function drawResourceProp(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  z: number,
  resource: string,
  index: number,
  now: number,
): void {
  const x = cx + (tileHash(index, 50) - 0.5) * 16 * z;
  const y = cy + (2 + tileHash(index, 51) * 4) * z;
  switch (resource) {
    case 'fruit': {
      // A small orchard tree heavy with fruit.
      drawTree(ctx, x, y, 5.5 * z, 0, 0.6);
      ctx.fillStyle = PALETTE.fruit;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(
          x + (tileHash(index, 60 + i) - 0.5) * 6 * z,
          y - (5 + tileHash(index, 63 + i) * 4) * z,
          1.5 * z,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      break;
    }
    case 'animal': {
      // A grazing critter: body, head, ears, legs.
      softShadow(ctx, x, y + 1.2 * z, 5.5 * z, 2 * z);
      ctx.fillStyle = PALETTE.animal;
      ctx.beginPath();
      ctx.ellipse(x, y - 2.5 * z, 4.4 * z, 2.7 * z, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x - 4.4 * z, y - 4.4 * z, 1.9 * z, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = PALETTE.animal;
      ctx.lineWidth = 1.1 * z;
      ctx.beginPath();
      ctx.moveTo(x - 2 * z, y - 0.4 * z);
      ctx.lineTo(x - 2 * z, y + 1.4 * z);
      ctx.moveTo(x + 2 * z, y - 0.4 * z);
      ctx.lineTo(x + 2 * z, y + 1.4 * z);
      ctx.stroke();
      break;
    }
    case 'metal': {
      // Rock outcrop with glinting ore.
      softShadow(ctx, x, y + 1 * z, 6 * z, 2.2 * z);
      ctx.beginPath();
      ctx.moveTo(x - 5 * z, y);
      ctx.lineTo(x - 2 * z, y - 5 * z);
      ctx.lineTo(x + 1.5 * z, y - 2.5 * z);
      ctx.lineTo(x + 5 * z, y - 4 * z);
      ctx.lineTo(x + 6 * z, y);
      ctx.closePath();
      ctx.fillStyle = shade(PALETTE.rockShade, 1.02);
      ctx.fill();
      const glint = 0.6 + 0.4 * Math.sin(now / 800 + index);
      ctx.fillStyle = PALETTE.metal;
      ctx.globalAlpha = glint;
      ctx.beginPath();
      ctx.moveTo(x - 1 * z, y - 2 * z);
      ctx.lineTo(x, y - 3.6 * z);
      ctx.lineTo(x + 1 * z, y - 2 * z);
      ctx.lineTo(x, y - 0.6 * z);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      break;
    }
    case 'fish': {
      // A school breaking the surface, with ripples.
      const hop = Math.sin(now / 600 + index) * 1.4 * z;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 0.9 * z;
      ctx.beginPath();
      ctx.ellipse(x, y - 1 * z, 4.5 * z, 1.6 * z, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = PALETTE.fish;
      ctx.beginPath();
      ctx.ellipse(x, y - 3 * z + hop, 3 * z, 1.5 * z, -0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x - 2.8 * z, y - 3 * z + hop);
      ctx.lineTo(x - 4.6 * z, y - 4.4 * z + hop);
      ctx.lineTo(x - 4.6 * z, y - 1.6 * z + hop);
      ctx.closePath();
      ctx.fill();
      break;
    }
  }
}

// ------------------------------------------------------------------- units

export interface UnitDrawFlags {
  readonly dim: boolean;
  readonly selected: boolean;
  readonly flash: boolean;
  readonly veteran: boolean;
  readonly scale: number;
  readonly bob: number;
}

function drawBody(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  color: string,
  slim = false,
): void {
  const w = (slim ? 6 : 7.5) * s;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - 12 * s, w, 9.5 * s, 3 * s);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.2 * s;
  ctx.stroke();
  // Head
  ctx.beginPath();
  ctx.arc(x, y - 14.5 * s, 3 * s, 0, Math.PI * 2);
  ctx.fillStyle = SKIN;
  ctx.fill();
  ctx.stroke();
}

/** Two dot eyes: enough face to make a soldier a character, not a token. */
function drawFace(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.fillStyle = '#2b2436';
  ctx.beginPath();
  ctx.arc(x - 1.05 * s, y, 0.55 * s, 0, Math.PI * 2);
  ctx.arc(x + 1.05 * s, y, 0.55 * s, 0, Math.PI * 2);
  ctx.fill();
}

export function drawUnitSprite(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  z: number,
  kind: UnitKind,
  color: string,
  flags: UnitDrawFlags,
): void {
  // 1.35× base scale: a soldier should read as a person at default zoom.
  const s = z * flags.scale * 1.35;
  const y = py + flags.bob;
  ctx.save();
  if (flags.dim) {
    ctx.globalAlpha = 0.55;
  }
  softShadow(ctx, px, py + 2.2 * z, 8 * s, 3.2 * s);

  if (flags.selected) {
    ctx.beginPath();
    ctx.ellipse(px, py + 2.2 * z, 11 * z, 5 * z, 0, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(px, py + 2.2 * z, 13.5 * z, 6.2 * z, 0, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.stroke();
  }

  switch (kind) {
    case 'warrior': {
      drawBody(ctx, px, y, s, color);
      drawFace(ctx, px, y - 14.3 * s, s);
      // Team headband ties the bare head to its army from any distance.
      ctx.fillStyle = color;
      ctx.fillRect(px - 3 * s, y - 17 * s, 6 * s, 1.3 * s);
      // Sword arm (east) and round shield (west, toward the light).
      ctx.strokeStyle = '#dfe4ee';
      ctx.lineWidth = 1.5 * s;
      ctx.beginPath();
      ctx.moveTo(px + 3.4 * s, y - 8 * s);
      ctx.lineTo(px + 6.4 * s, y - 13.5 * s);
      ctx.stroke();
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 1 * s;
      ctx.beginPath();
      ctx.moveTo(px + 3.6 * s, y - 9.6 * s);
      ctx.lineTo(px + 5.4 * s, y - 8.6 * s);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(px - 4.4 * s, y - 7.5 * s, 3.2 * s, 0, Math.PI * 2);
      ctx.fillStyle = '#cfd6e4';
      ctx.fill();
      ctx.strokeStyle = OUTLINE;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(px - 4.4 * s, y - 7.5 * s, 1.1 * s, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      break;
    }
    case 'archer': {
      drawBody(ctx, px, y, s, color, true);
      // Hood over the head.
      ctx.beginPath();
      ctx.moveTo(px, y - 18.5 * s);
      ctx.lineTo(px + 3.4 * s, y - 13 * s);
      ctx.lineTo(px - 3.4 * s, y - 13 * s);
      ctx.closePath();
      ctx.fillStyle = shade(color, 0.72);
      ctx.fill();
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 1 * s;
      ctx.stroke();
      drawFace(ctx, px, y - 13.3 * s, s * 0.9);
      // Bow.
      ctx.strokeStyle = PALETTE.trunk;
      ctx.lineWidth = 1.4 * s;
      ctx.beginPath();
      ctx.arc(px + 5 * s, y - 9 * s, 5 * s, -Math.PI / 2.4, Math.PI / 2.4);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(240, 240, 240, 0.8)';
      ctx.lineWidth = 0.7 * s;
      ctx.beginPath();
      ctx.moveTo(px + 6.9 * s, y - 13.5 * s);
      ctx.lineTo(px + 6.9 * s, y - 4.5 * s);
      ctx.stroke();
      break;
    }
    case 'rider': {
      // Mount: bay horse with team saddle cloth.
      softShadow(ctx, px, py + 2.6 * z, 10 * s, 3.4 * s);
      ctx.fillStyle = '#b9895c';
      ctx.beginPath();
      ctx.ellipse(px, y - 6.5 * s, 7.5 * s, 4 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 1.1 * s;
      ctx.stroke();
      // Legs.
      ctx.strokeStyle = '#96683f';
      ctx.lineWidth = 1.4 * s;
      ctx.beginPath();
      ctx.moveTo(px - 4.5 * s, y - 3.4 * s);
      ctx.lineTo(px - 4.5 * s, y + 0.6 * s);
      ctx.moveTo(px + 4 * s, y - 3.4 * s);
      ctx.lineTo(px + 4 * s, y + 0.6 * s);
      ctx.stroke();
      // Neck and head.
      ctx.fillStyle = '#b9895c';
      ctx.beginPath();
      ctx.ellipse(px - 7.5 * s, y - 10 * s, 2.4 * s, 3.6 * s, -0.5, 0, Math.PI * 2);
      ctx.fill();
      // Saddle cloth + rider.
      ctx.fillStyle = color;
      ctx.fillRect(px - 2.6 * s, y - 9.4 * s, 5.2 * s, 3.4 * s);
      ctx.beginPath();
      ctx.roundRect(px - 2 * s, y - 14 * s, 4 * s, 5.5 * s, 1.8 * s);
      ctx.fill();
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 1 * s;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(px, y - 15.8 * s, 2.2 * s, 0, Math.PI * 2);
      ctx.fillStyle = SKIN;
      ctx.fill();
      ctx.stroke();
      drawFace(ctx, px, y - 15.7 * s, s * 0.75);
      // Horse eye.
      ctx.fillStyle = '#2b2436';
      ctx.beginPath();
      ctx.arc(px - 8 * s, y - 11 * s, 0.45 * s, 0, Math.PI * 2);
      ctx.fill();
      // Lance with pennant.
      ctx.strokeStyle = '#d9d2c4';
      ctx.lineWidth = 1 * s;
      ctx.beginPath();
      ctx.moveTo(px + 4.4 * s, y - 6 * s);
      ctx.lineTo(px + 7.5 * s, y - 19 * s);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(px + 7.5 * s, y - 19 * s);
      ctx.lineTo(px + 11 * s, y - 17.6 * s);
      ctx.lineTo(px + 7.9 * s, y - 16.4 * s);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      break;
    }
    case 'defender': {
      drawBody(ctx, px, y, s, color);
      drawFace(ctx, px, y - 13.9 * s, s * 0.9);
      // Helmet.
      ctx.beginPath();
      ctx.arc(px, y - 15 * s, 3.1 * s, Math.PI, 0);
      ctx.fillStyle = '#cfd6e4';
      ctx.fill();
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 1 * s;
      ctx.stroke();
      // Tall kite shield covering the body.
      ctx.beginPath();
      ctx.moveTo(px - 3.6 * s, y - 12.5 * s);
      ctx.lineTo(px + 3.6 * s, y - 12.5 * s);
      ctx.lineTo(px + 3.6 * s, y - 6 * s);
      ctx.quadraticCurveTo(px + 3.6 * s, y - 2.4 * s, px, y - 1.4 * s);
      ctx.quadraticCurveTo(px - 3.6 * s, y - 2.4 * s, px - 3.6 * s, y - 6 * s);
      ctx.closePath();
      ctx.fillStyle = '#cfd6e4';
      ctx.fill();
      ctx.stroke();
      // Team chevron on the shield.
      ctx.beginPath();
      ctx.moveTo(px - 2.4 * s, y - 10.5 * s);
      ctx.lineTo(px, y - 7.8 * s);
      ctx.lineTo(px + 2.4 * s, y - 10.5 * s);
      ctx.lineTo(px + 2.4 * s, y - 8.4 * s);
      ctx.lineTo(px, y - 5.8 * s);
      ctx.lineTo(px - 2.4 * s, y - 8.4 * s);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      break;
    }
  }

  if (flags.veteran) {
    ctx.fillStyle = PALETTE.gold;
    ctx.font = `${Math.round(7 * s)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('★', px + 7 * s, y - 17 * s);
  }

  if (flags.flash) {
    ctx.globalCompositeOperation = 'source-atop';
    ctx.globalAlpha = 0.65;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(px - 14 * s, y - 24 * s, 28 * s, 28 * s);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

// ---------------------------------------------------------------------- fog

export function drawFogTile(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  hw: number,
  hh: number,
  index: number,
  now: number,
): void {
  // Polytopia-style unexplored: puffy WHITE clouds that invite exploring,
  // never darkness. Slightly oversized so neighboring clouds merge seamlessly.
  const drift = Math.sin(now / 5200 + index * 0.7) * hh * 0.08;
  const ow = hw * 1.04;
  const oh = hh * 1.08;
  ctx.beginPath();
  ctx.moveTo(cx, cy - oh);
  ctx.lineTo(cx + ow, cy);
  ctx.lineTo(cx, cy + oh);
  ctx.lineTo(cx - ow, cy);
  ctx.closePath();
  ctx.fillStyle = PALETTE.fog1;
  ctx.fill();

  // Cool under-shadow at the south edge gives the cloud sheet volume.
  ctx.fillStyle = 'rgba(158, 178, 205, 0.28)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + oh * 0.42, ow * 0.62, oh * 0.34, 0, 0, Math.PI * 2);
  ctx.fill();

  // Bright billows, sunlit from the top-left like everything else.
  ctx.fillStyle = PALETTE.fog2;
  ctx.beginPath();
  ctx.ellipse(
    cx + (tileHash(index, 70) - 0.5) * hw * 0.7,
    cy + (tileHash(index, 71) - 0.55) * hh * 0.5 + drift,
    hw * 0.5,
    hh * 0.48,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(
    cx + (tileHash(index, 72) - 0.5) * hw * 0.8,
    cy + (tileHash(index, 73) - 0.6) * hh * 0.6 - drift,
    hw * 0.36,
    hh * 0.36,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(
    cx + (tileHash(index, 74) - 0.5) * hw * 0.5,
    cy + (tileHash(index, 75) - 0.4) * hh * 0.4 + drift * 0.6,
    hw * 0.28,
    hh * 0.3,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
}
