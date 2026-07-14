import {
  type Action,
  applyActionWithEvents,
  type GameEvent,
  GameRuleError,
  type GameRuleErrorCode,
} from './actions';
import { nextAiAction } from './ai';
import { DEFAULT_MAP_SIZE, DEFAULT_PLAYER_COUNT } from './constants';
import { createGame } from './game';
import { visibleTiles } from './queries';
import type { GameState } from './types';

export type Mode = 'ai' | 'hotseat';

export class GameStore {
  mode: Mode = 'ai';
  state: GameState;

  // UI Selection
  selectedUnitId: number | null = null;
  selectedCityId: number | null = null;
  hoverTile: number | null = null;
  mouseX = 0;
  mouseY = 0;

  // AI & Session Flags
  aiBusy = false;
  toastTimer = 0;

  // Statistics & Milestones
  kills = new Map<number, number>();
  killsByKind = new Map<string, number>();
  citiesFounded = new Map<number, number>();
  citiesConquered = new Map<number, number>();
  milestones: { turn: number; text: string }[] = [];

  // Visibility Cache
  private visibleCacheState: GameState | null = null;
  private visibleCache: Set<number> = new Set();

  // Callbacks
  onUpdate?: () => void;
  onEvent?: (before: GameState, events: readonly GameEvent[]) => void;
  onError?: (code: GameRuleErrorCode) => void;

  constructor(seed = 0, mode: Mode = 'ai') {
    this.mode = mode;
    this.state = createGame({
      seed,
      mapSize: DEFAULT_MAP_SIZE,
      playerCount: DEFAULT_PLAYER_COUNT,
    });
  }

  newGame(seed: number, mode: Mode): void {
    this.mode = mode;
    this.state = createGame({
      seed,
      mapSize: DEFAULT_MAP_SIZE,
      playerCount: DEFAULT_PLAYER_COUNT,
    });
    this.clearSelection();
    this.kills.clear();
    this.killsByKind.clear();
    this.citiesFounded.clear();
    this.citiesConquered.clear();
    this.milestones.length = 0;
    this.aiBusy = false;
    this.onUpdate?.();
  }

  clearSelection(): void {
    this.selectedUnitId = null;
    this.selectedCityId = null;
  }

  select(unitId: number | null, cityId: number | null): void {
    this.selectedUnitId = unitId;
    this.selectedCityId = cityId;
    this.onUpdate?.();
  }

  recordMilestone(text: string): void {
    this.milestones.push({ turn: this.state.turn, text });
    if (this.milestones.length > 40) {
      this.milestones.shift();
    }
  }

  viewerId(): number {
    return this.mode === 'ai' ? 0 : this.state.currentPlayerId;
  }

  humanTurn(): boolean {
    return (
      !this.aiBusy &&
      this.state.winnerId === null &&
      (this.mode === 'hotseat' || this.state.currentPlayerId === 0)
    );
  }

  viewerVisible(): Set<number> {
    if (this.visibleCacheState !== this.state) {
      this.visibleCache = visibleTiles(this.state, this.viewerId());
      this.visibleCacheState = this.state;
    }
    return this.visibleCache;
  }

  dispatch(action: Action): boolean {
    const before = this.state;
    try {
      const result = applyActionWithEvents(this.state, action);
      this.state = result.state;
      this.processEvents(before, result.events);
      this.onEvent?.(before, result.events);
      this.onUpdate?.();
      return true;
    } catch (error) {
      if (error instanceof GameRuleError) {
        this.onError?.(error.code);
        return false;
      }
      throw error;
    }
  }

  private processEvents(before: GameState, events: readonly GameEvent[]): void {
    for (const event of events) {
      switch (event.type) {
        case 'attackResolved': {
          const attacker = before.units.find((u) => u.id === event.attackerId);
          const defender = before.units.find((u) => u.id === event.defenderId);
          if (attacker && defender) {
            if (event.defenderDied) {
              this.kills.set(attacker.ownerId, (this.kills.get(attacker.ownerId) ?? 0) + 1);
              const kindKey = `${attacker.ownerId}:${attacker.kind}`;
              this.killsByKind.set(kindKey, (this.killsByKind.get(kindKey) ?? 0) + 1);
            }
            if (event.attackerDied) {
              this.kills.set(defender.ownerId, (this.kills.get(defender.ownerId) ?? 0) + 1);
              const kindKey = `${defender.ownerId}:${defender.kind}`;
              this.killsByKind.set(kindKey, (this.killsByKind.get(kindKey) ?? 0) + 1);
            }
          }
          break;
        }
        case 'cityCaptured': {
          if (event.founded) {
            this.citiesFounded.set(
              event.byPlayer,
              (this.citiesFounded.get(event.byPlayer) ?? 0) + 1,
            );
          } else {
            this.citiesConquered.set(
              event.byPlayer,
              (this.citiesConquered.get(event.byPlayer) ?? 0) + 1,
            );
          }
          break;
        }
      }
    }
  }

  nextAiAction(): Action {
    return nextAiAction(this.state);
  }
}
