/**
 * UI layer: owns the mutable reference to the current GameState, translates
 * DOM events into Actions, and re-renders after every change.
 */
import './style.css';
import { applyAction, GameRuleError, type Action } from './core/actions';
import { DEFAULT_MAP_SIZE, DEFAULT_PLAYER_COUNT, UNIT_STATS } from './core/constants';
import { createGame } from './core/game';
import { cityAt, incomeFor, playerById, reachableTiles, unitAt } from './core/queries';
import type { GameState, UnitKind } from './core/types';
import { playerColor, Renderer } from './render/renderer';

const UNIT_NAMES: Record<UnitKind, string> = {
  warrior: 'Guerrero',
  archer: 'Arquero',
  rider: 'Jinete',
  defender: 'Defensor',
};

function element<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing #${id} in index.html`);
  }
  return el as T;
}

const canvas = element<HTMLCanvasElement>('board-canvas');
const playerBadge = element<HTMLSpanElement>('player-badge');
const turnLabel = element<HTMLSpanElement>('turn-label');
const starsLabel = element<HTMLSpanElement>('stars-label');
const statusBar = element<HTMLElement>('status');
const seedInput = element<HTMLInputElement>('seed-input');
const trainButtonsBox = element<HTMLDivElement>('train-buttons');

const renderer = new Renderer(canvas);

let state: GameState = createGame({
  seed: Number(seedInput.value) || 0,
  mapSize: DEFAULT_MAP_SIZE,
  playerCount: DEFAULT_PLAYER_COUNT,
});
let selectedUnitId: number | null = null;
let selectedCityId: number | null = null;

function clearSelection(): void {
  selectedUnitId = null;
  selectedCityId = null;
}

function dispatch(action: Action): void {
  try {
    state = applyAction(state, action);
    statusBar.textContent = '';
  } catch (error) {
    if (error instanceof GameRuleError) {
      statusBar.textContent = error.message;
    } else {
      throw error;
    }
  }
  refresh();
}

function currentReachable(): ReadonlySet<number> {
  if (selectedUnitId === null) {
    return new Set();
  }
  const unit = state.units.find((u) => u.id === selectedUnitId);
  return unit ? reachableTiles(state, unit) : new Set();
}

function refresh(): void {
  const player = playerById(state, state.currentPlayerId);
  playerBadge.textContent = `Jugador ${player.id + 1}`;
  playerBadge.style.background = playerColor(player.id);
  turnLabel.textContent = `Turno ${state.turn}`;
  starsLabel.textContent = `★ ${player.stars} (+${incomeFor(state, player.id)})`;

  const selectedCity = state.cities.find((c) => c.id === selectedCityId);
  for (const button of trainButtonsBox.querySelectorAll('button')) {
    const kind = button.dataset['kind'] as UnitKind;
    const affordable = player.stars >= UNIT_STATS[kind].cost;
    const cityFree = selectedCity !== undefined && !unitAt(state, selectedCity.tileIndex);
    button.disabled =
      !selectedCity || selectedCity.ownerId !== player.id || !affordable || !cityFree;
  }

  renderer.draw(state, { selectedUnitId, selectedCityId, reachable: currentReachable() });
}

function newGame(): void {
  state = createGame({
    seed: Number(seedInput.value) || 0,
    mapSize: DEFAULT_MAP_SIZE,
    playerCount: DEFAULT_PLAYER_COUNT,
  });
  clearSelection();
  statusBar.textContent = '';
  refresh();
}

function onBoardClick(event: MouseEvent): void {
  const rect = canvas.getBoundingClientRect();
  const tileIndex = renderer.screenToTile(
    state,
    event.clientX - rect.left,
    event.clientY - rect.top,
  );
  if (tileIndex === null) {
    clearSelection();
    refresh();
    return;
  }

  if (selectedUnitId !== null && currentReachable().has(tileIndex)) {
    const unitId = selectedUnitId;
    clearSelection();
    dispatch({ type: 'moveUnit', unitId, to: tileIndex });
    return;
  }

  const unit = unitAt(state, tileIndex);
  const city = cityAt(state, tileIndex);
  clearSelection();
  if (unit && unit.ownerId === state.currentPlayerId && !unit.hasMoved) {
    selectedUnitId = unit.id;
  } else if (city && city.ownerId === state.currentPlayerId) {
    selectedCityId = city.id;
  }
  refresh();
}

function buildTrainButtons(): void {
  for (const kind of Object.keys(UNIT_STATS) as UnitKind[]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset['kind'] = kind;
    button.textContent = `${UNIT_NAMES[kind]} (${UNIT_STATS[kind].cost}★)`;
    button.addEventListener('click', () => {
      if (selectedCityId !== null) {
        dispatch({ type: 'trainUnit', cityId: selectedCityId, unitKind: kind });
      }
    });
    trainButtonsBox.appendChild(button);
  }
}

buildTrainButtons();
canvas.addEventListener('click', onBoardClick);
element<HTMLButtonElement>('end-turn').addEventListener('click', () => {
  clearSelection();
  dispatch({ type: 'endTurn' });
});
element<HTMLButtonElement>('new-game').addEventListener('click', newGame);

new ResizeObserver(() => {
  renderer.resize();
  refresh();
}).observe(canvas);

renderer.resize();
refresh();
