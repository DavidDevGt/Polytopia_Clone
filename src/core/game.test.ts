import { describe, expect, it } from 'vitest';
import { STARTING_STARS } from './constants';
import { createGame } from './game';

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
      const capital = state.cities.find((c) => c.ownerId === player.id && c.isCapital);
      expect(capital).toBeDefined();
      const warrior = state.units.find((u) => u.ownerId === player.id);
      expect(warrior?.kind).toBe('warrior');
      expect(warrior?.tileIndex).toBe(capital?.tileIndex);
    }
  });

  it('starts on turn 1 with player 0 active', () => {
    const state = createGame(CONFIG);
    expect(state.turn).toBe(1);
    expect(state.currentPlayerId).toBe(0);
  });
});
