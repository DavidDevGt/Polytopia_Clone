/**
 * UI layer: owns the mutable reference to the current GameState, translates
 * DOM/pointer events into Actions, runs the AI turns, and feeds the renderer.
 */
import './style.css';
import {
  applyActionWithEvents,
  GameRuleError,
  type Action,
  type GameEvent,
  type GameRuleErrorCode,
} from './core/actions';
import { nextAiAction } from './core/ai';
import { forecastBattle, inAttackRange, maxHpOf } from './core/combat';
import { DEFAULT_MAP_SIZE, DEFAULT_PLAYER_COUNT, HARVEST_INFO, UNIT_STATS } from './core/constants';
import { createGame } from './core/game';
import {
  cityAt,
  grossIncomeFor,
  playerById,
  reachableTiles,
  territoryOf,
  unitAt,
  upkeepFor,
  visibleTiles,
} from './core/queries';
import type { City, GameState, Resource, Terrain, Unit, UnitKind } from './core/types';
import { Minimap } from './render/minimap';
import { playerColor, Renderer } from './render/renderer';
import { SoundManager } from './render/sound';

// ---------- localized strings ----------

const UNIT_NAMES: Record<UnitKind, string> = {
  warrior: 'Guerrero',
  archer: 'Arquero',
  rider: 'Jinete',
  defender: 'Defensor',
};

const TERRAIN_NAMES: Record<Terrain, string> = {
  field: 'Pradera',
  forest: 'Bosque',
  mountain: 'Montaña',
  water: 'Costa',
  ocean: 'Océano',
};

const RESOURCE_NAMES: Record<Resource, string> = {
  fruit: 'Fruta',
  animal: 'Caza',
  metal: 'Metal',
  fish: 'Pesca',
};

const ERROR_MESSAGES: Record<GameRuleErrorCode, string> = {
  GAME_OVER: 'La partida ha terminado',
  UNIT_NOT_FOUND: 'Esa unidad no existe',
  NOT_YOUR_UNIT: 'Esa unidad no es tuya',
  UNIT_ALREADY_MOVED: 'Esa unidad ya gastó su turno',
  UNIT_ALREADY_ATTACKED: 'Esa unidad ya atacó este turno',
  UNREACHABLE_TILE: 'La unidad no puede llegar ahí',
  OUT_OF_RANGE: 'Objetivo fuera de alcance',
  INVALID_TARGET: 'Objetivo no válido',
  NOTHING_TO_CAPTURE: 'Aquí no hay nada que capturar',
  CITY_NOT_FOUND: 'Esa ciudad no existe',
  NOT_YOUR_CITY: 'Esa ciudad no es tuya',
  TILE_OCCUPIED: 'La casilla está ocupada',
  NOT_ENOUGH_STARS: 'No tienes estrellas suficientes',
  NOTHING_TO_HARVEST: 'No hay recurso que cosechar',
  OUTSIDE_TERRITORY: 'Fuera de las fronteras de la ciudad',
};

// ---------- DOM helpers ----------

function element<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing #${id} in index.html`);
  }
  return el as T;
}

const canvas = element<HTMLCanvasElement>('board-canvas');
const minimapCanvas = element<HTMLCanvasElement>('minimap');
const playerBadge = element<HTMLSpanElement>('player-badge');
const turnLabel = element<HTMLSpanElement>('turn-label');
const starsLabel = element<HTMLSpanElement>('stars-label');
const seedInput = element<HTMLInputElement>('seed-input');
const modeSelect = element<HTMLSelectElement>('mode-select');
const inspector = element<HTMLElement>('inspector');
const eventLog = element<HTMLDivElement>('event-log');
const turnBanner = element<HTMLDivElement>('turn-banner');
const forecastBox = element<HTMLDivElement>('forecast');
const toast = element<HTMLDivElement>('toast');
const overlay = element<HTMLDivElement>('overlay');
const endTurnButton = element<HTMLButtonElement>('end-turn');

// ---------- session state ----------

type Mode = 'ai' | 'hotseat';

const renderer = new Renderer(canvas);
const minimap = new Minimap(minimapCanvas);
const sound = new SoundManager();

let mode: Mode = 'ai';
let state: GameState = createGame({
  seed: Number(seedInput.value) || 0,
  mapSize: DEFAULT_MAP_SIZE,
  playerCount: DEFAULT_PLAYER_COUNT,
});
let selectedUnitId: number | null = null;
let selectedCityId: number | null = null;
let hoverTile: number | null = null;
let aiBusy = false;
let toastTimer = 0;
let mouseX = 0;
let mouseY = 0;
const kills = new Map<number, number>();

function playerName(id: number): string {
  return mode === 'ai' && id === 1 ? 'IA' : `Jugador ${id + 1}`;
}

function viewerId(): number {
  return mode === 'ai' ? 0 : state.currentPlayerId;
}

function humanTurn(): boolean {
  return !aiBusy && state.winnerId === null && (mode === 'hotseat' || state.currentPlayerId === 0);
}

// Visibility is recomputed only when the state reference changes.
let visibleCacheState: GameState | null = null;
let visibleCache: Set<number> = new Set();
function viewerVisible(): Set<number> {
  if (visibleCacheState !== state) {
    visibleCache = visibleTiles(state, viewerId());
    visibleCacheState = state;
  }
  return visibleCache;
}

function selectedUnit(): Unit | undefined {
  return selectedUnitId === null ? undefined : state.units.find((u) => u.id === selectedUnitId);
}

function selectedCity(): City | undefined {
  return selectedCityId === null ? undefined : state.cities.find((c) => c.id === selectedCityId);
}

function currentReachable(): ReadonlySet<number> {
  const unit = selectedUnit();
  if (!unit || unit.hasMoved || unit.ownerId !== state.currentPlayerId || !humanTurn()) {
    return new Set();
  }
  return reachableTiles(state, unit);
}

/** Enemy tiles the selected unit can strike right now → defender unit id. */
function currentAttackable(): Map<number, number> {
  const result = new Map<number, number>();
  const unit = selectedUnit();
  if (!unit || unit.hasAttacked || unit.ownerId !== state.currentPlayerId || !humanTurn()) {
    return result;
  }
  const visible = viewerVisible();
  for (const enemy of state.units) {
    if (
      enemy.ownerId !== unit.ownerId &&
      visible.has(enemy.tileIndex) &&
      inAttackRange(state, unit, enemy)
    ) {
      result.set(enemy.tileIndex, enemy.id);
    }
  }
  return result;
}

// ---------- dispatch & events ----------

function dispatch(action: Action): boolean {
  const before = state;
  try {
    const result = applyActionWithEvents(state, action);
    renderer.playEvents(before, result.events, performance.now());
    state = result.state;
    handleEvents(before, result.events);
    updatePanels();
    return true;
  } catch (error) {
    if (error instanceof GameRuleError) {
      showToast(ERROR_MESSAGES[error.code]);
      sound.play('error');
      return false;
    }
    throw error;
  }
}

function handleEvents(before: GameState, events: readonly GameEvent[]): void {
  for (const event of events) {
    switch (event.type) {
      case 'unitMoved':
        sound.play('move');
        break;
      case 'attackResolved': {
        sound.play(event.defenderDied || event.attackerDied ? 'kill' : 'attack');
        const attacker = before.units.find((u) => u.id === event.attackerId);
        const defender = before.units.find((u) => u.id === event.defenderId);
        if (attacker && defender) {
          if (event.defenderDied) {
            kills.set(attacker.ownerId, (kills.get(attacker.ownerId) ?? 0) + 1);
            log(`⚔ ${UNIT_NAMES[attacker.kind]} elimina a ${UNIT_NAMES[defender.kind]}`);
          } else {
            log(`⚔ ${UNIT_NAMES[attacker.kind]} inflige ${event.damageToDefender} de daño`);
          }
          if (event.attackerDied) {
            kills.set(defender.ownerId, (kills.get(defender.ownerId) ?? 0) + 1);
            log(`💥 ${UNIT_NAMES[attacker.kind]} cae en el contraataque`);
          }
        }
        if (event.promotedUnitId !== null) {
          log('★ Unidad promovida a veterana');
          sound.play('levelup');
        }
        break;
      }
      case 'cityCaptured':
        sound.play('capture');
        log(
          event.founded
            ? `🏘 ${playerName(event.byPlayer)} funda una ciudad`
            : `🏰 ${playerName(event.byPlayer)} captura ${event.capital ? 'la CAPITAL enemiga' : 'una ciudad'}`,
        );
        break;
      case 'unitTrained':
        sound.play('train');
        log(`🛡 Recluta: ${UNIT_NAMES[event.kind]}`);
        break;
      case 'harvested':
        sound.play(event.leveledUpTo !== null ? 'levelup' : 'harvest');
        log(`🌾 Cosecha de ${RESOURCE_NAMES[event.resource].toLowerCase()}`);
        if (event.leveledUpTo !== null) {
          log(`📈 La ciudad sube a nivel ${event.leveledUpTo}`);
        }
        break;
      case 'turnStarted':
        sound.play('turn');
        showTurnBanner(`Turno ${state.turn} — ${playerName(event.playerId)}`);
        log(`🕐 ${playerName(event.playerId)} (${event.income >= 0 ? '+' : ''}${event.income}★)`);
        clearSelection();
        break;
      case 'playerEliminated':
        log(`☠ ${playerName(event.playerId)} ha sido eliminado`);
        break;
      case 'gameWon':
        sound.play('victory');
        showVictory(event.playerId);
        break;
    }
  }
  maybeRunAi();
}

// ---------- AI ----------

function maybeRunAi(): void {
  if (mode !== 'ai' || aiBusy || state.winnerId !== null || state.currentPlayerId !== 1) {
    return;
  }
  aiBusy = true;
  updatePanels();
  let guard = 0;
  const step = (): void => {
    if (state.winnerId !== null || state.currentPlayerId !== 1 || guard++ > 300) {
      aiBusy = false;
      updatePanels();
      return;
    }
    const action = nextAiAction(state);
    aiBusy = false; // allow dispatch → handleEvents → maybeRunAi to no-op re-entry
    const ok = dispatch(action);
    aiBusy = action.type !== 'endTurn' && ok && state.currentPlayerId === 1;
    if (aiBusy) {
      window.setTimeout(step, 230);
    } else {
      updatePanels();
    }
  };
  window.setTimeout(step, 450);
}

// ---------- HUD & inspector ----------

function log(message: string): void {
  const entry = document.createElement('div');
  entry.className = 'entry';
  entry.textContent = message;
  eventLog.prepend(entry);
  while (eventLog.children.length > 7) {
    eventLog.lastElementChild?.remove();
  }
}

function showToast(message: string): void {
  toast.textContent = message;
  toast.classList.remove('hidden');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.add('hidden'), 1900);
}

function showTurnBanner(text: string): void {
  turnBanner.textContent = text;
  turnBanner.classList.remove('hidden');
  // Restart the CSS animation.
  void turnBanner.offsetWidth;
  window.setTimeout(() => turnBanner.classList.add('hidden'), 1400);
}

function updatePanels(): void {
  const player = playerById(state, state.currentPlayerId);
  playerBadge.textContent = playerName(player.id);
  playerBadge.style.background = playerColor(player.id);
  turnLabel.textContent = `Turno ${state.turn}`;
  const gross = grossIncomeFor(state, player.id);
  const upkeep = upkeepFor(state, player.id);
  starsLabel.textContent = `★ ${player.stars}  (+${gross}${upkeep > 0 ? ` −${upkeep}` : ''})`;
  starsLabel.title = `Ingresos ${gross} · Mantenimiento ${upkeep}`;
  endTurnButton.disabled = !humanTurn();
  renderInspector();
}

function statRow(label: string, value: string | number): string {
  return `<span>${label}<b>${value}</b></span>`;
}

function renderInspector(): void {
  const unit = selectedUnit();
  const city = selectedCity();
  if (unit) {
    renderUnitPanel(unit);
    return;
  }
  if (city) {
    renderCityPanel(city);
    return;
  }
  renderHoverPanel();
}

function renderUnitPanel(unit: Unit): void {
  const stats = UNIT_STATS[unit.kind];
  const cap = maxHpOf(unit);
  const tile = state.tiles[unit.tileIndex]!;
  const cityHere = cityAt(state, unit.tileIndex);
  const canCapture =
    unit.ownerId === state.currentPlayerId &&
    !unit.hasMoved &&
    !unit.hasAttacked &&
    (tile.hasVillage || (cityHere && cityHere.ownerId !== unit.ownerId));

  inspector.innerHTML = `
    <div class="panel">
      <h3><span class="chip" style="background:${playerColor(unit.ownerId)}">${UNIT_NAMES[unit.kind]}</span>
      ${unit.veteran ? '<span title="Veterana">★</span>' : ''}</h3>
      <div class="bar"><i style="width:${Math.round((unit.hp / cap) * 100)}%"></i></div>
      <div class="statgrid">
        ${statRow('Vida', `${unit.hp}/${cap}`)}
        ${statRow('Ataque', stats.attack)}
        ${statRow('Defensa', stats.defense)}
        ${statRow('Movimiento', stats.movement)}
        ${statRow('Alcance', stats.range)}
        ${statRow('Bajas', unit.kills)}
      </div>
      <div class="hint">${
        unit.hasMoved && unit.hasAttacked
          ? 'Sin acciones este turno.'
          : 'Haz clic en una casilla clara para mover, o en un enemigo marcado en rojo para atacar.'
      }</div>
      ${canCapture ? '<div class="actions"><button data-action="capture">Capturar <span class="cost">🏳</span></button></div>' : ''}
    </div>`;

  inspector.querySelector('[data-action="capture"]')?.addEventListener('click', () => {
    if (dispatch({ type: 'capture', unitId: unit.id })) {
      clearSelection();
    }
  });
}

function renderCityPanel(city: City): void {
  const player = playerById(state, state.currentPlayerId);
  const threshold = city.level + 1;
  const income = 1 + city.level + (city.isCapital ? 1 : 0);
  const own = city.ownerId === state.currentPlayerId && humanTurn();
  const occupied = unitAt(state, city.tileIndex) !== undefined;

  const trainButtons = (Object.keys(UNIT_STATS) as UnitKind[])
    .map((kind) => {
      const cost = UNIT_STATS[kind].cost;
      const disabled = !own || occupied || player.stars < cost;
      return `<button data-train="${kind}" ${disabled ? 'disabled' : ''}
        title="ATQ ${UNIT_STATS[kind].attack} · DEF ${UNIT_STATS[kind].defense} · MOV ${UNIT_STATS[kind].movement} · ALC ${UNIT_STATS[kind].range}">
        ${UNIT_NAMES[kind]} <span class="cost">${cost}★</span></button>`;
    })
    .join('');

  const harvestables = territoryOf(state, city)
    .filter((t) => state.tiles[t]?.resource)
    .map((t) => {
      const resource = state.tiles[t]!.resource!;
      const info = HARVEST_INFO[resource];
      const disabled = !own || player.stars < info.cost;
      return `<button data-harvest="${t}" ${disabled ? 'disabled' : ''}>
        ${RESOURCE_NAMES[resource]} (+${info.population} pob.) <span class="cost">${info.cost}★</span></button>`;
    })
    .join('');

  inspector.innerHTML = `
    <div class="panel">
      <h3><span class="chip" style="background:${playerColor(city.ownerId)}">${city.isCapital ? '★ Capital' : 'Ciudad'}</span>
      Nv ${city.level}</h3>
      <div class="subtitle">Ingresos: +${income}★ por turno</div>
      <div class="bar pop"><i style="width:${Math.round((city.population / threshold) * 100)}%"></i></div>
      <div class="subtitle">Población ${city.population}/${threshold} para subir de nivel</div>
    </div>
    <div class="panel">
      <h3>Entrenar</h3>
      <div class="actions">${trainButtons}</div>
      ${occupied ? '<div class="hint">La ciudad está ocupada por una unidad.</div>' : ''}
    </div>
    ${
      harvestables
        ? `<div class="panel"><h3>Cosechar</h3><div class="actions">${harvestables}</div></div>`
        : '<div class="panel"><div class="hint">No quedan recursos dentro de las fronteras. Sube de nivel la ciudad para ampliarlas.</div></div>'
    }`;

  for (const button of inspector.querySelectorAll<HTMLButtonElement>('[data-train]')) {
    button.addEventListener('click', () => {
      dispatch({
        type: 'trainUnit',
        cityId: city.id,
        unitKind: button.dataset['train'] as UnitKind,
      });
    });
  }
  for (const button of inspector.querySelectorAll<HTMLButtonElement>('[data-harvest]')) {
    button.addEventListener('click', () => {
      dispatch({ type: 'harvest', cityId: city.id, tileIndex: Number(button.dataset['harvest']) });
    });
  }
}

function renderHoverPanel(): void {
  const explored = playerById(state, viewerId()).explored;
  let tileInfo = '<div class="hint">Pasa el cursor por el mapa para inspeccionar casillas.</div>';
  if (hoverTile !== null && explored[hoverTile]) {
    const tile = state.tiles[hoverTile]!;
    const cityHere = cityAt(state, hoverTile);
    const unitHere = viewerVisible().has(hoverTile) ? unitAt(state, hoverTile) : undefined;
    tileInfo = `
      <div class="statgrid">
        ${statRow('Terreno', TERRAIN_NAMES[tile.terrain])}
        ${tile.resource ? statRow('Recurso', RESOURCE_NAMES[tile.resource]) : ''}
        ${tile.hasVillage ? statRow('Aldea', 'libre') : ''}
        ${cityHere ? statRow('Ciudad', `${playerName(cityHere.ownerId)} · Nv ${cityHere.level}`) : ''}
        ${unitHere ? statRow('Unidad', `${UNIT_NAMES[unitHere.kind]} (${playerName(unitHere.ownerId)})`) : ''}
      </div>`;
  }
  inspector.innerHTML = `
    <div class="panel"><h3>Terreno</h3>${tileInfo}</div>
    <div class="panel">
      <h3>Atajos</h3>
      <div class="kbd-list">
        <kbd>␣</kbd><span>Terminar turno</span>
        <kbd>N</kbd><span>Siguiente unidad</span>
        <kbd>C</kbd><span>Capturar</span>
        <kbd>Esc</kbd><span>Deseleccionar</span>
        <kbd>M</kbd><span>Silenciar</span>
        <kbd>?</kbd><span>Ayuda</span>
      </div>
    </div>
    <div class="panel"><div class="hint">
      Captura aldeas para fundar ciudades, cosecha recursos para subirlas de nivel
      y toma la capital enemiga para ganar. Cada unidad extra cuesta mantenimiento:
      la expansión paga a tus ejércitos.
    </div></div>`;
}

// ---------- forecast tooltip ----------

function updateForecast(): void {
  const unit = selectedUnit();
  const attackable = currentAttackable();
  if (!unit || hoverTile === null || !attackable.has(hoverTile)) {
    forecastBox.classList.add('hidden');
    return;
  }
  const defender = state.units.find((u) => u.id === attackable.get(hoverTile!))!;
  const forecast = forecastBattle(state, unit, defender);
  forecastBox.innerHTML = `
    ⚔ Daño: <b style="color:var(--gold)">−${forecast.damageToDefender}</b>
    ${forecast.defenderDies ? ' <b style="color:var(--danger)">(muere)</b>' : ''}<br/>
    ${
      forecast.counterAttacks
        ? `↩ Contraataque: <b style="color:var(--danger)">−${forecast.damageToAttacker}</b>${forecast.attackerDies ? ' <b>(mueres)</b>' : ''}`
        : '↩ Sin contraataque'
    }`;
  forecastBox.style.left = `${mouseX + 18}px`;
  forecastBox.style.top = `${mouseY - 10}px`;
  forecastBox.classList.remove('hidden');
}

// ---------- overlays ----------

function showVictory(winnerId: number): void {
  const rows = state.players
    .map(
      (p) => `
      <div class="panel">
        <h3><span class="chip" style="background:${playerColor(p.id)}">${playerName(p.id)}</span></h3>
        <div class="statgrid">
          ${statRow('Bajas causadas', kills.get(p.id) ?? 0)}
          ${statRow('Ciudades', state.cities.filter((c) => c.ownerId === p.id).length)}
        </div>
      </div>`,
    )
    .join('');
  overlay.innerHTML = `
    <div class="card">
      <h2 class="victory-title">🏆 ¡${playerName(winnerId)} conquista Terranova!</h2>
      <p style="text-align:center">Victoria por dominación en el turno ${state.turn}.</p>
      <div class="scoreboard">${rows}</div>
      <button id="victory-new-game">Nueva partida</button>
    </div>`;
  overlay.classList.remove('hidden');
  overlay.querySelector('#victory-new-game')?.addEventListener('click', () => {
    overlay.classList.add('hidden');
    newGame();
  });
}

function showHelp(): void {
  overlay.innerHTML = `
    <div class="card">
      <h2>Cómo se juega</h2>
      <ul>
        <li><b>Objetivo:</b> captura la capital enemiga. Perder la tuya te elimina.</li>
        <li><b>Economía:</b> las ciudades dan ★ por turno. Cosecha recursos dentro de tus fronteras para ganar población y subir de nivel (más ingresos y fronteras más amplias desde nivel 3).</li>
        <li><b>Mantenimiento:</b> cada unidad por encima de una por ciudad cuesta 1★ por turno.</li>
        <li><b>Combate:</b> determinista y previsible: el pronóstico aparece al apuntar. El bosque y las ciudades dan bonus defensivo; los aliados junto al objetivo flanquean; el defensor contraataca si sobrevive y te tiene a alcance.</li>
        <li><b>Captura:</b> una unidad con el turno completo sobre una aldea o ciudad enemiga puede capturarla.</li>
        <li><b>Descanso:</b> las unidades que no actúan se curan (+2, +4 en territorio propio), salvo si tienen un enemigo adyacente: no hay curación bajo asedio.</li>
        <li><b>Veteranía:</b> a las 2 bajas, la unidad promociona: +5 de vida máxima y curación total.</li>
      </ul>
      <button id="close-help">Entendido</button>
    </div>`;
  overlay.classList.remove('hidden');
  overlay
    .querySelector('#close-help')
    ?.addEventListener('click', () => overlay.classList.add('hidden'));
}

// ---------- selection & input ----------

function clearSelection(): void {
  selectedUnitId = null;
  selectedCityId = null;
}

function selectNextUnit(): void {
  if (!humanTurn()) {
    return;
  }
  const mine = state.units.filter(
    (u) => u.ownerId === state.currentPlayerId && (!u.hasMoved || !u.hasAttacked),
  );
  if (mine.length === 0) {
    showToast('No quedan unidades con acciones');
    return;
  }
  const startIndex = mine.findIndex((u) => u.id === selectedUnitId);
  const next = mine[(startIndex + 1) % mine.length]!;
  clearSelection();
  selectedUnitId = next.id;
  renderer.centerOn(state, next.tileIndex);
  sound.play('select');
  updatePanels();
}

function onBoardClick(px: number, py: number): void {
  if (!humanTurn()) {
    return;
  }
  const tileIndex = renderer.screenToTile(state, px, py);
  if (tileIndex === null) {
    clearSelection();
    updatePanels();
    return;
  }

  const attackable = currentAttackable();
  const unit = selectedUnit();
  if (unit && attackable.has(tileIndex)) {
    dispatch({ type: 'attack', attackerId: unit.id, defenderId: attackable.get(tileIndex)! });
    return;
  }
  if (unit && currentReachable().has(tileIndex)) {
    dispatch({ type: 'moveUnit', unitId: unit.id, to: tileIndex });
    return; // keep it selected: it may still attack
  }

  const clickedUnit = unitAt(state, tileIndex);
  const clickedCity = cityAt(state, tileIndex);
  clearSelection();
  if (clickedUnit && clickedUnit.ownerId === state.currentPlayerId) {
    selectedUnitId = clickedUnit.id;
    sound.play('select');
  } else if (clickedCity && clickedCity.ownerId === state.currentPlayerId) {
    selectedCityId = clickedCity.id;
    sound.play('select');
  }
  updatePanels();
}

function newGame(): void {
  mode = modeSelect.value === 'hotseat' ? 'hotseat' : 'ai';
  state = createGame({
    seed: Number(seedInput.value) || 0,
    mapSize: DEFAULT_MAP_SIZE,
    playerCount: DEFAULT_PLAYER_COUNT,
  });
  clearSelection();
  kills.clear();
  aiBusy = false;
  eventLog.innerHTML = '';
  overlay.classList.add('hidden');
  const capital = state.cities.find((c) => c.ownerId === 0 && c.isCapital);
  if (capital) {
    renderer.centerOn(state, capital.tileIndex);
  }
  showTurnBanner('Turno 1 — ' + playerName(0));
  updatePanels();
}

// Pointer: click vs drag-to-pan.
let pointerDown = false;
let dragged = false;
let lastPointerX = 0;
let lastPointerY = 0;

canvas.addEventListener('pointerdown', (e) => {
  pointerDown = true;
  dragged = false;
  lastPointerX = e.clientX;
  lastPointerY = e.clientY;
});

window.addEventListener('pointermove', (e) => {
  const rect = canvas.getBoundingClientRect();
  mouseX = e.clientX - rect.left;
  mouseY = e.clientY - rect.top;
  if (pointerDown) {
    const dx = e.clientX - lastPointerX;
    const dy = e.clientY - lastPointerY;
    if (dragged || Math.abs(dx) + Math.abs(dy) > 6) {
      dragged = true;
      canvas.classList.add('dragging');
      renderer.panBy(dx, dy);
      lastPointerX = e.clientX;
      lastPointerY = e.clientY;
    }
  } else {
    hoverTile = renderer.screenToTile(state, mouseX, mouseY);
    if (!selectedUnit() && !selectedCity()) {
      renderInspector();
    }
    updateForecast();
  }
});

window.addEventListener('pointerup', (e) => {
  if (!pointerDown) {
    return;
  }
  pointerDown = false;
  canvas.classList.remove('dragging');
  if (!dragged && e.target === canvas) {
    const rect = canvas.getBoundingClientRect();
    onBoardClick(e.clientX - rect.left, e.clientY - rect.top);
  }
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  renderer.zoomBy(e.deltaY < 0 ? 1.15 : 0.87);
});

minimapCanvas.addEventListener('click', (e) => {
  const rect = minimapCanvas.getBoundingClientRect();
  const tile = minimap.tileAt(state, e.clientX - rect.left, e.clientY - rect.top);
  if (tile !== null) {
    renderer.centerOn(state, tile);
  }
});

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) {
    return;
  }
  switch (e.key) {
    case ' ':
      e.preventDefault();
      if (humanTurn()) {
        clearSelection();
        dispatch({ type: 'endTurn' });
      }
      break;
    case 'Escape':
      clearSelection();
      overlay.classList.add('hidden');
      updatePanels();
      break;
    case 'n':
    case 'N':
      selectNextUnit();
      break;
    case 'c':
    case 'C': {
      const unit = selectedUnit();
      if (unit && humanTurn()) {
        dispatch({ type: 'capture', unitId: unit.id });
      }
      break;
    }
    case 'm':
    case 'M':
      element<HTMLButtonElement>('mute-btn').textContent = sound.toggleMute() ? '🔇' : '🔊';
      break;
    case '?':
      showHelp();
      break;
  }
});

endTurnButton.addEventListener('click', () => {
  if (humanTurn()) {
    clearSelection();
    dispatch({ type: 'endTurn' });
  }
});
element<HTMLButtonElement>('new-game').addEventListener('click', newGame);
element<HTMLButtonElement>('help-btn').addEventListener('click', showHelp);
element<HTMLButtonElement>('mute-btn').addEventListener('click', (e) => {
  (e.currentTarget as HTMLButtonElement).textContent = sound.toggleMute() ? '🔇' : '🔊';
});

new ResizeObserver(() => {
  renderer.resize();
}).observe(canvas);

// ---------- render loop ----------

function frame(now: number): void {
  const explored = playerById(state, viewerId()).explored;
  const visible = viewerVisible();
  renderer.draw(
    state,
    {
      viewerId: viewerId(),
      explored,
      visible,
      selectedUnitId,
      selectedCityId,
      reachable: currentReachable(),
      attackableTiles: new Set(currentAttackable().keys()),
      hoverTile,
    },
    now,
  );
  minimap.draw(state, explored, visible, renderer.cameraInfo, {
    width: canvas.clientWidth,
    height: canvas.clientHeight,
  });
  requestAnimationFrame(frame);
}

renderer.resize();
newGame();
requestAnimationFrame(frame);
