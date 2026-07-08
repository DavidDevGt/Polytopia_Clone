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
  /** An unclaimed village. Capturing it turns the tile into a city. */
  readonly hasVillage: boolean;
}

export interface City {
  readonly id: number;
  readonly tileIndex: number;
  readonly ownerId: PlayerId;
  readonly level: number;
  readonly isCapital: boolean;
}

export interface Unit {
  readonly id: number;
  readonly kind: UnitKind;
  readonly ownerId: PlayerId;
  readonly tileIndex: number;
  readonly hp: number;
  /** True once the unit acted this turn; reset when its owner's turn starts. */
  readonly hasMoved: boolean;
}

export interface Player {
  readonly id: PlayerId;
  readonly stars: number;
}

export interface GameState {
  readonly seed: number;
  readonly mapSize: number;
  /** Full round counter; increments every time play wraps back to player 0. */
  readonly turn: number;
  readonly currentPlayerId: PlayerId;
  readonly tiles: readonly Tile[];
  readonly players: readonly Player[];
  readonly cities: readonly City[];
  readonly units: readonly Unit[];
  /** Monotonic id generator for cities and units. */
  readonly nextEntityId: number;
}
