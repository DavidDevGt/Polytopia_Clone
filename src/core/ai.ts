/**
 * Goal-driven AI. nextAiAction is a pure function of the state that returns
 * the single best action for the current player; the UI (or a test) calls it
 * repeatedly until it returns endTurn. Determinism comes for free: no
 * randomness, stable unit ordering, and every non-endTurn action consumes a
 * finite resource (a move, an attack, stars), so a turn always terminates.
 *
 * Priorities per turn:
 *   1. Capture anything a unit is already standing on.
 *   2. Take favorable fights (kills, or trades predicted to net damage).
 *   3. Advance units toward goals: villages > enemy cities (with an army
 *      advantage) > visible enemies; defenders garrison; idle units scout.
 *   4. Grow the economy: harvest the best-value resources.
 *   5. Reinforce: train a mixed army sized to what the economy supports.
 */
import type { Action } from './actions';
import { HARVEST_INFO, UNIT_STATS } from './constants';
import { forecastBattle, inAttackRange } from './combat';
import { chebyshevDistance, neighbors } from './grid';
import { cityAt, isPassable, reachableTiles, territoryOf, unitAt, visibleTiles } from './queries';
import type { GameState, Unit, UnitKind } from './types';

const TRAIN_ROTATION: readonly UnitKind[] = ['warrior', 'archer', 'rider', 'defender'];

export function nextAiAction(state: GameState): Action {
  const me = state.currentPlayerId;
  const myUnits = state.units.filter((u) => u.ownerId === me);
  const visible = visibleTiles(state, me);
  const explored = state.players.find((p) => p.id === me)!.explored;

  return (
    tryCapture(state, myUnits) ??
    tryAttack(state, myUnits, visible) ??
    tryMove(state, myUnits, visible, explored) ??
    tryHarvest(state, me) ??
    tryTrain(state, me, myUnits.length) ?? { type: 'endTurn' }
  );
}

function tryCapture(state: GameState, myUnits: readonly Unit[]): Action | null {
  for (const unit of myUnits) {
    if (unit.hasMoved || unit.hasAttacked) {
      continue;
    }
    const tile = state.tiles[unit.tileIndex]!;
    const city = cityAt(state, unit.tileIndex);
    if (tile.hasVillage || (city && city.ownerId !== unit.ownerId)) {
      return { type: 'capture', unitId: unit.id };
    }
  }
  return null;
}

function tryAttack(
  state: GameState,
  myUnits: readonly Unit[],
  visible: ReadonlySet<number>,
): Action | null {
  for (const unit of myUnits) {
    if (unit.hasAttacked) {
      continue;
    }
    let bestTarget: Unit | null = null;
    let bestScore = 0;
    for (const enemy of state.units) {
      if (enemy.ownerId === unit.ownerId || !visible.has(enemy.tileIndex)) {
        continue;
      }
      if (!inAttackRange(state, unit, enemy)) {
        continue;
      }
      const forecast = forecastBattle(state, unit, enemy);
      const enemyCityHere = cityAt(state, enemy.tileIndex);
      const garrisonBonus = enemyCityHere && enemyCityHere.ownerId !== unit.ownerId ? 15 : 0;
      const score =
        (forecast.defenderDies ? 100 : 0) +
        garrisonBonus +
        forecast.damageToDefender -
        forecast.damageToAttacker -
        (forecast.attackerDies ? 200 : 0);
      if (score > bestScore) {
        bestScore = score;
        bestTarget = enemy;
      }
    }
    if (bestTarget) {
      return { type: 'attack', attackerId: unit.id, defenderId: bestTarget.id };
    }
  }
  return null;
}

function tryMove(
  state: GameState,
  myUnits: readonly Unit[],
  visible: ReadonlySet<number>,
  explored: readonly boolean[],
): Action | null {
  for (const unit of myUnits) {
    if (unit.hasMoved || unit.hasAttacked) {
      continue;
    }
    const goal = chooseGoal(state, unit, visible, explored);
    const reachable = reachableTiles(state, unit);
    if (reachable.size === 0) {
      continue;
    }

    if (goal !== null) {
      // Step to the reachable tile that shortens the real walking path to the
      // goal (BFS over terrain, so detours around lakes/mountains work).
      const field = pathDistanceField(state, goal);
      let bestTile = -1;
      let bestDistance = field[unit.tileIndex] ?? Infinity;
      for (const tile of reachable) {
        const distance = field[tile] ?? Infinity;
        if (distance < bestDistance || (distance === bestDistance && tile === goal)) {
          bestDistance = distance;
          bestTile = tile;
        }
      }
      if (bestTile >= 0) {
        return { type: 'moveUnit', unitId: unit.id, to: bestTile };
      }
      continue;
    }

    // No goal in sight: scout toward the fog.
    let bestTile = -1;
    let bestUnknown = 0;
    for (const tile of reachable) {
      let unknown = 0;
      for (let i = 0; i < explored.length; i++) {
        if (!explored[i] && chebyshevDistance(tile, i, state.mapSize) <= 2) {
          unknown++;
        }
      }
      if (unknown > bestUnknown) {
        bestUnknown = unknown;
        bestTile = tile;
      }
    }
    if (bestTile >= 0) {
      return { type: 'moveUnit', unitId: unit.id, to: bestTile };
    }
  }
  return null;
}

/**
 * Walking distance from every tile to `goal`, BFS over passable terrain
 * (units ignored: they move away over turns). The goal itself is included
 * even if impassable terrain-wise (cities/villages always are passable).
 */
function pathDistanceField(state: GameState, goal: number): number[] {
  const field = new Array<number>(state.tiles.length).fill(Infinity);
  field[goal] = 0;
  const queue = [goal];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++]!;
    for (const next of neighbors(current, state.mapSize)) {
      if (field[next] === Infinity && isPassable(state, next)) {
        field[next] = field[current]! + 1;
        queue.push(next);
      }
    }
  }
  return field;
}

/** Pick a destination worth walking toward, or null to scout instead. */
function chooseGoal(
  state: GameState,
  unit: Unit,
  visible: ReadonlySet<number>,
  explored: readonly boolean[],
): number | null {
  const me = unit.ownerId;

  // Defenders garrison the nearest own city that has no unit on it.
  if (unit.kind === 'defender') {
    const openCity = nearestBy(
      state,
      unit,
      state.cities
        .filter((c) => c.ownerId === me && !unitAt(state, c.tileIndex))
        .map((c) => c.tileIndex),
    );
    if (openCity !== null) {
      return openCity;
    }
  }

  // Free villages we know about (villages never move once seen).
  const villages: number[] = [];
  for (let i = 0; i < state.tiles.length; i++) {
    if (state.tiles[i]!.hasVillage && explored[i]) {
      villages.push(i);
    }
  }
  const village = nearestBy(state, unit, villages);
  if (village !== null) {
    return village;
  }

  // Push on enemy cities when we outnumber what we can see — or when the
  // army is at its economic cap: waiting any longer wins nothing (and two
  // cautious AIs would otherwise stare at each other forever).
  const visibleEnemies = state.units.filter((u) => u.ownerId !== me && visible.has(u.tileIndex));
  const myArmy = state.units.filter((u) => u.ownerId === me).length;
  const myCityCount = state.cities.filter((c) => c.ownerId === me).length;
  const committed = myArmy >= myCityCount * 2;
  if (myArmy > visibleEnemies.length || committed) {
    // At full military capacity, chasing field units forever wins nothing:
    // press the victory condition and march on the enemy capital itself.
    const enemyCities = state.cities.filter((c) => c.ownerId !== me && explored[c.tileIndex]);
    const capitals = enemyCities.filter((c) => c.isCapital);
    const pool = committed && capitals.length > 0 ? capitals : enemyCities;
    const enemyCity = nearestBy(
      state,
      unit,
      pool.map((c) => c.tileIndex),
    );
    if (enemyCity !== null) {
      return enemyCity;
    }
  }

  const enemy = nearestBy(
    state,
    unit,
    visibleEnemies.map((u) => u.tileIndex),
  );
  if (enemy !== null) {
    return enemy;
  }

  // Nothing known to fight or claim: march toward the nearest fog. Without a
  // global target, units park after exhausting local scouting and the game
  // can stall with everyone garrisoned forever.
  const unknowns: number[] = [];
  for (let i = 0; i < explored.length; i++) {
    if (!explored[i] && isPassable(state, i)) {
      unknowns.push(i);
    }
  }
  return nearestBy(state, unit, unknowns);
}

function nearestBy(state: GameState, unit: Unit, candidates: readonly number[]): number | null {
  let best: number | null = null;
  let bestDistance = Infinity;
  for (const tile of candidates) {
    const distance = chebyshevDistance(unit.tileIndex, tile, state.mapSize);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = tile;
    }
  }
  return best;
}

/** Harvest the best population-per-star resource we can afford. */
function tryHarvest(state: GameState, me: number): Action | null {
  const stars = state.players.find((p) => p.id === me)!.stars;
  let best: Action | null = null;
  let bestValue = 0;
  for (const city of state.cities) {
    if (city.ownerId !== me) {
      continue;
    }
    for (const tileIndex of territoryOf(state, city)) {
      const resource = state.tiles[tileIndex]?.resource;
      if (!resource) {
        continue;
      }
      const info = HARVEST_INFO[resource];
      if (info.cost > stars) {
        continue;
      }
      const value = info.population / info.cost;
      if (value > bestValue) {
        bestValue = value;
        best = { type: 'harvest', cityId: city.id, tileIndex };
      }
    }
  }
  return best;
}

/** Keep a mixed army roughly twice the size of the empire. */
function tryTrain(state: GameState, me: number, armySize: number): Action | null {
  const myCities = state.cities.filter((c) => c.ownerId === me);
  if (armySize >= myCities.length * 2 + 1) {
    return null;
  }
  const stars = state.players.find((p) => p.id === me)!.stars;
  const kind = TRAIN_ROTATION[armySize % TRAIN_ROTATION.length]!;
  const affordable: UnitKind = stars >= UNIT_STATS[kind].cost ? kind : 'warrior';
  if (stars < UNIT_STATS[affordable].cost) {
    return null;
  }
  for (const city of myCities) {
    if (!unitAt(state, city.tileIndex)) {
      return { type: 'trainUnit', cityId: city.id, unitKind: affordable };
    }
  }
  return null;
}
