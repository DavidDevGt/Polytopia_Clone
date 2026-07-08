import { STARTING_STARS, UNIT_STATS } from './constants';
import { DEFAULT_MAP_CONFIG, generateMap } from './map/generateMap';
import { createRng } from './rng';
import type { City, GameState, Player, Unit } from './types';

export interface GameConfig {
  readonly seed: number;
  readonly mapSize: number;
  readonly playerCount: number;
}

/** Builds the initial state: map, one capital and one warrior per player. */
export function createGame(config: GameConfig): GameState {
  const rng = createRng(config.seed);
  const map = generateMap(rng, {
    ...DEFAULT_MAP_CONFIG,
    size: config.mapSize,
    playerCount: config.playerCount,
  });

  const players: Player[] = [];
  const cities: City[] = [];
  const units: Unit[] = [];
  let nextEntityId = 1;

  map.capitalTileIndexes.forEach((tileIndex, playerId) => {
    players.push({ id: playerId, stars: STARTING_STARS });
    cities.push({ id: nextEntityId++, tileIndex, ownerId: playerId, level: 1, isCapital: true });
    units.push({
      id: nextEntityId++,
      kind: 'warrior',
      ownerId: playerId,
      tileIndex,
      hp: UNIT_STATS.warrior.hp,
      hasMoved: false,
    });
  });

  return {
    seed: config.seed,
    mapSize: config.mapSize,
    turn: 1,
    currentPlayerId: 0,
    tiles: map.tiles,
    players,
    cities,
    units,
    nextEntityId,
  };
}
