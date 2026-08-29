/* Mekami 전투·DPS 계산 코어 — 공개 입구.

     import { simulateBattle } from './core/index.js';

   DOM 을 읽거나 쓰지 않는다. 메인 스레드·Web Worker·단위 테스트에서 같은 API 로 돈다
   (§17 완료 기준). */

export { simulateBattle, BattleLoop, HitFlag } from './battle.js';
export {
  DEFAULT_SIM_OPTIONS, DEFAULT_TARGET, DURATION_PRESETS_SEC, ALLOWED_FRAME_RATES,
  normalizeSimOptions, normalizeTarget, secToFrame, frameToSec, createRng,
} from './normalize.js';
export {
  calcHitDamage, roundHalfEven, chargeTerm, hitCoeffPct, hitsPerShot,
  resolveMaxAmmo, reloadSec, reloadSegmentAmmo, coreHitProbability,
  ProbabilityAccumulator, statsFromNames, effectiveAttack, effectiveDefense, pct,
} from './damage.js';
export {
  StatCode, STAT_NAMES, STAT_COUNT, HitTag, HitKind, StateFlag, TriggerCode,
  ActionCode, StackingCode, ElementCode, WeaponCode, ELEMENT_NAMES, WEAPON_NAMES,
  OPTIMAL_RANGE_BY_WEAPON, hasElementAdvantage, SimInputError,
} from './codes.js';
export { compileRuntime, MAX_SQUAD } from './runtime.js';
export { EffectStore } from './effect-store.js';
export { WeaponSystem } from './weapon.js';
export { BurstSystem, STAGES, canCast, occupiesStage } from './burst.js';
export { ResultWriter } from './result.js';
export { LEDGER, OPEN, PROVISIONAL } from './ledger.js';
