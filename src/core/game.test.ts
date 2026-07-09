import { describe, expect, it } from 'vitest';
import { STARTING_STARS, VISION_RADIUS } from './constants';
import { createGame } from './game';
import { chebyshevDistance } from './grid';

const CONFIG = { seed: 42, mapSize: 16, playerCount: 2 };

describe('createGame', () => {
  it('is deterministic for the same seed', () => {
    expect(createGame(CONFIG)).toEqual(createGame(CONFIG));
  });

  it('starts each player with a capital and a warrior on it', () => {
    const state = createGame(CONFIG);
    expect(state.players).toHaveLength(2);
    for (const player of state.players) {
      expect(player.stars).toBe(STARTING_STARS);
      expect(player.eliminated).toBe(false);
      const capital = state.cities.find((c) => c.ownerId === player.id && c.isCapital);
      expect(capital).toBeDefined();
      const warrior = state.units.find((u) => u.ownerId === player.id);
      expect(warrior?.kind).toBe('warrior');
      expect(warrior?.tileIndex).toBe(capital?.tileIndex);
    }
  });

  it('starts on turn 1 with player 0 active and no winner', () => {
    const state = createGame(CONFIG);
    expect(state.turn).toBe(1);
    expect(state.currentPlayerId).toBe(0);
    expect(state.winnerId).toBeNull();
  });

  it('initializes fog of war: only the capital surroundings are explored', () => {
    const state = createGame(CONFIG);
    for (const player of state.players) {
      const capital = state.cities.find((c) => c.ownerId === player.id && c.isCapital)!;
      expect(player.explored[capital.tileIndex]).toBe(true);
      const exploredCount = player.explored.filter(Boolean).length;
      expect(exploredCount).toBeGreaterThan(0);
      expect(exploredCount).toBeLessThan(state.tiles.length);
      for (let i = 0; i < player.explored.length; i++) {
        if (player.explored[i]) {
          expect(chebyshevDistance(i, capital.tileIndex, state.mapSize)).toBeLessThanOrEqual(
            VISION_RADIUS + 1,
          );
        }
      }
    }
  });
});
