/**
 * Core domain model. Everything here is plain, immutable data: the whole game
 * can be serialized with JSON.stringify and replayed deterministically.
 */

export type PlayerId = number;

export type Terrain = 'field' | 'forest' | 'mountain' | 'water' | 'ocean';

export type Resource = 'fruit' | 'animal' | 'metal' | 'fish';

export type UnitKind = 'warrior' | 'archer' | 'rider' | 'defender';

export interface Tile {
  readonly terrain: Terrain;
  readonly resource: Resource | null;
  /** An unclaimed village. A unit standing on it can spend a turn to capture. */
  readonly hasVillage: boolean;
}

export interface City {
  readonly id: number;
  readonly tileIndex: number;
  readonly ownerId: PlayerId;
  /** Drives income and territory radius. Grows by accumulating population. */
  readonly level: number;
  /** Population harvested toward the next level (threshold = level + 1). */
  readonly population: number;
  readonly isCapital: boolean;
}

export interface Unit {
  readonly id: number;
  readonly kind: UnitKind;
  readonly ownerId: PlayerId;
  readonly tileIndex: number;
  readonly hp: number;
  readonly kills: number;
  /** Earned after KILLS_FOR_VETERAN kills: +max HP and a full heal. */
  readonly veteran: boolean;
  /** Reset when the owner's turn starts. Attacking also spends the move. */
  readonly hasMoved: boolean;
  readonly hasAttacked: boolean;
}

export interface Player {
  readonly id: PlayerId;
  readonly stars: number;
  /** Set when the player's capital falls. Eliminated players never act again. */
  readonly eliminated: boolean;
  /** Fog of war: tiles this player has seen at least once (index = tile). */
  readonly explored: readonly boolean[];
}

export interface GameState {
  readonly seed: number;
  readonly mapSize: number;
  /** Full round counter; increments every time play wraps around. */
  readonly turn: number;
  readonly currentPlayerId: PlayerId;
  readonly tiles: readonly Tile[];
  readonly players: readonly Player[];
  readonly cities: readonly City[];
  readonly units: readonly Unit[];
  /** Set when only one player remains. No further actions are legal. */
  readonly winnerId: PlayerId | null;
  /** Monotonic id generator for cities and units. */
  readonly nextEntityId: number;
}
