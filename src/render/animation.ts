/**
 * Presentation-side animation primitives: easing, entity tweens and a small
 * particle system. Nothing here touches game state — it only shapes how the
 * already-decided outcome is shown.
 */

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

export interface WorldPoint {
  readonly x: number;
  readonly y: number;
}

type TweenKind = 'move' | 'lunge' | 'spawn';

interface Tween {
  readonly kind: TweenKind;
  readonly from: WorldPoint;
  readonly to: WorldPoint;
  readonly start: number;
  readonly duration: number;
}

/** Per-unit visual offsets: gliding moves, attack lunges, spawn pops. */
export class UnitTweens {
  private readonly tweens = new Map<number, Tween>();

  move(unitId: number, from: WorldPoint, to: WorldPoint, now: number): void {
    this.tweens.set(unitId, { kind: 'move', from, to, start: now, duration: 240 });
  }

  lunge(unitId: number, from: WorldPoint, toward: WorldPoint, now: number): void {
    this.tweens.set(unitId, { kind: 'lunge', from, to: toward, start: now, duration: 300 });
  }

  spawn(unitId: number, at: WorldPoint, now: number): void {
    this.tweens.set(unitId, { kind: 'spawn', from: at, to: at, start: now, duration: 320 });
  }

  /**
   * Where to draw the unit right now instead of its resting position, plus a
   * scale factor. Returns null when the unit has no active tween.
   */
  sample(
    unitId: number,
    restingAt: WorldPoint,
    now: number,
  ): { pos: WorldPoint; scale: number } | null {
    const tween = this.tweens.get(unitId);
    if (!tween) {
      return null;
    }
    const t = (now - tween.start) / tween.duration;
    if (t >= 1) {
      this.tweens.delete(unitId);
      return null;
    }
    switch (tween.kind) {
      case 'move': {
        const k = easeInOutQuad(t);
        return {
          pos: {
            x: tween.from.x + (tween.to.x - tween.from.x) * k,
            y: tween.from.y + (tween.to.y - tween.from.y) * k,
          },
          scale: 1,
        };
      }
      case 'lunge': {
        // Anticipate briefly, strike 40% of the way in, follow through back.
        const k =
          t < 0.45 ? easeOutCubic(t / 0.45) * 0.4 : 0.4 * (1 - easeInOutQuad((t - 0.45) / 0.55));
        return {
          pos: {
            x: tween.from.x + (tween.to.x - tween.from.x) * k,
            y: tween.from.y + (tween.to.y - tween.from.y) * k,
          },
          scale: 1,
        };
      }
      case 'spawn':
        return { pos: restingAt, scale: easeOutBack(t) };
    }
  }

  get active(): boolean {
    return this.tweens.size > 0;
  }
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  ttl: number;
  size: number;
  color: string;
  text?: string;
  ring?: boolean;
}

/** Floating damage numbers, capture rings, sparkles. World-space coordinates. */
export class Particles {
  private items: Particle[] = [];

  damageText(at: WorldPoint, text: string, color: string): void {
    this.items.push({
      x: at.x,
      y: at.y - 18,
      vx: 0,
      vy: -26,
      age: 0,
      ttl: 1.1,
      size: 13,
      color,
      text,
    });
  }

  ring(at: WorldPoint, color: string): void {
    this.items.push({
      x: at.x,
      y: at.y,
      vx: 0,
      vy: 0,
      age: 0,
      ttl: 0.7,
      size: 34,
      color,
      ring: true,
    });
  }

  burst(at: WorldPoint, color: string, count: number): void {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const speed = 34 + (i % 3) * 14;
      this.items.push({
        x: at.x,
        y: at.y - 8,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 24,
        age: 0,
        ttl: 0.8,
        size: 3,
        color,
      });
    }
  }

  update(dt: number): void {
    for (const p of this.items) {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.text ? 0 : 80 * dt; // gravity for sparks, not for text
    }
    this.items = this.items.filter((p) => p.age < p.ttl);
  }

  draw(ctx: CanvasRenderingContext2D, toScreen: (p: WorldPoint) => WorldPoint, zoom: number): void {
    for (const p of this.items) {
      const t = p.age / p.ttl;
      const alpha = 1 - easeInOutQuad(t);
      const { x, y } = toScreen(p);
      ctx.globalAlpha = alpha;
      if (p.ring) {
        ctx.beginPath();
        ctx.ellipse(
          x,
          y,
          p.size * zoom * (0.4 + t),
          p.size * zoom * (0.4 + t) * 0.5,
          0,
          0,
          Math.PI * 2,
        );
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2.5 * (1 - t) + 0.5;
        ctx.stroke();
      } else if (p.text) {
        ctx.font = `bold ${Math.round(p.size * zoom)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(10, 14, 24, 0.85)';
        ctx.strokeText(p.text, x, y);
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, x, y);
      } else {
        ctx.beginPath();
        ctx.arc(x, y, p.size * zoom * (1 - t * 0.5), 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  get active(): boolean {
    return this.items.length > 0;
  }
}
