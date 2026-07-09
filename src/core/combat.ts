/**
 * Deterministic combat resolution, inspired by Polytopia's formula.
 *
 * Damage depends on the attack/defense ratio weighted by remaining HP, the
 * defender's terrain (forest, city walls) and flanking support from allies
 * adjacent to the defender. No dice: a fight can always be predicted, so the
 * UI shows an exact forecast before committing.
 */
import {
  DAMAGE_SCALE,
  DEFENSE_BONUS_CAPITAL,
  DEFENSE_BONUS_CITY,
  DEFENSE_BONUS_FOREST,
  SUPPORT_BONUS_PER_ALLY,
  UNIT_STATS,
  VETERAN_HP_BONUS,
} from './constants';
import { chebyshevDistance, neighbors } from './grid';
import { cityAt } from './queries';
import type { GameState, Unit } from './types';

export function maxHpOf(unit: Unit): number {
  return UNIT_STATS[unit.kind].hp + (unit.veteran ? VETERAN_HP_BONUS : 0);
}

/** Terrain/structure multiplier applied to the defender. */
export function defenseBonusAt(state: GameState, defender: Unit): number {
  const city = cityAt(state, defender.tileIndex);
  if (city && city.ownerId === defender.ownerId) {
    return city.isCapital ? DEFENSE_BONUS_CAPITAL : DEFENSE_BONUS_CITY;
  }
  if (state.tiles[defender.tileIndex]?.terrain === 'forest') {
    return DEFENSE_BONUS_FOREST;
  }
  return 1;
}

/** Flanking: allies of the attacker adjacent to the defender add pressure. */
export function supportBonus(state: GameState, attacker: Unit, defender: Unit): number {
  let allies = 0;
  for (const index of neighbors(defender.tileIndex, state.mapSize)) {
    const unit = state.units.find((u) => u.tileIndex === index);
    if (unit && unit.id !== attacker.id && unit.ownerId === attacker.ownerId) {
      allies++;
    }
  }
  return 1 + allies * SUPPORT_BONUS_PER_ALLY;
}

export interface BattleForecast {
  readonly damageToDefender: number;
  readonly damageToAttacker: number;
  readonly defenderDies: boolean;
  readonly attackerDies: boolean;
  /** Defender strikes back only if it survives and the attacker is in range. */
  readonly counterAttacks: boolean;
}

export function inAttackRange(state: GameState, attacker: Unit, defender: Unit): boolean {
  return (
    chebyshevDistance(attacker.tileIndex, defender.tileIndex, state.mapSize) <=
    UNIT_STATS[attacker.kind].range
  );
}

export function forecastBattle(state: GameState, attacker: Unit, defender: Unit): BattleForecast {
  const atk = UNIT_STATS[attacker.kind];
  const def = UNIT_STATS[defender.kind];

  const attackForce =
    atk.attack * (attacker.hp / maxHpOf(attacker)) * supportBonus(state, attacker, defender);
  const defenseForce =
    def.defense * (defender.hp / maxHpOf(defender)) * defenseBonusAt(state, defender);
  const total = attackForce + defenseForce;

  const damageToDefender = Math.max(
    1,
    Math.round((attackForce / total) * atk.attack * DAMAGE_SCALE),
  );
  const defenderDies = damageToDefender >= defender.hp;

  const defenderCanReach =
    chebyshevDistance(defender.tileIndex, attacker.tileIndex, state.mapSize) <= def.range;
  const counterAttacks = !defenderDies && defenderCanReach;
  const damageToAttacker = counterAttacks
    ? Math.max(1, Math.round((defenseForce / total) * def.defense * DAMAGE_SCALE))
    : 0;

  return {
    damageToDefender,
    damageToAttacker,
    defenderDies,
    attackerDies: damageToAttacker >= attacker.hp,
    counterAttacks,
  };
}
