/* 한 타격의 피해 — 순수 함수, 시간도 DOM 도 모른다 (명세 §6).

     피해 = 반올림(① 계수 × ② 공방차 × ③ 가산 × ④ 충전 × ⑤ 공격 유형 × ⑥ 받는 피해 × ⑦ 우월 코드), 최종 = max(1, 피해)

   일곱 항은 곱하고, 한 항 안에서는 더한다.
   ③ 실측: 2521 -> 크리 3781(×1.5) -> 코어 5042(×2.0) -> 코어+크리 6302(×2.5) -> +풀버 7563(×3.0). 즉 1 + 0.5 + 1.0 + 0.5.
   정수화는 타격마다 한다 (§1.1) — 실수로 먼저 더하고 한 번만 반올림하면 다중 탄환에서 갈린다. */

import { HitTag, TYPE_STAT_BY_TAG, StatCode } from './codes.js';

/* ── 반올림 ────────────────────────────────────────────────

   짝수 반올림 (§6.2). 정확히 `.5` 인 값의 결과가 브라우저마다 흔들리면 안 되므로 직접 고정한다. */
export function roundHalfEven(value) {
  const lower = Math.floor(value);
  const fraction = value - lower;
  const epsilon = Number.EPSILON * Math.max(1, Math.abs(value)) * 4;

  if (fraction < 0.5 - epsilon) return lower;
  if (fraction > 0.5 + epsilon) return lower + 1;
  return lower % 2 === 0 ? lower : lower + 1;
}

/* 퍼센트 포인트 -> 배수 몫. 이 문서의 백분율은 전부 퍼센트 포인트다 (§0). */
export function pct(value = 0) {
  return (value || 0) / 100;
}

export function hasTag(tagMask, tag) {
  return (tagMask & tag) !== 0;
}

/* ── ① 계수 (§6.1 ①) ──────────────────────────────────────

     일반 공격: 무기 계수 × (1 + 일반 공격 피해%)      스킬 공격: 스킬에 기록된 계수

   `normalAtkDmgPct` 는 ⑤ 가 아니라 여기다 — ⑤ 로 옮기면 다른 유형 증댐과 한 칸에서 더해져 값이 달라진다.
   다중 탄환은 계수를 나눈다 (§14.6): 타격 수 = pelletCount × muzzleCount, 타격 계수 = 무기 계수 / pelletCount.
   총구 수로 다시 나누지 않는다. */
export function hitCoeffPct(weaponCoeffPct, pelletCount = 1) {
  const pellets = pelletCount > 0 ? pelletCount : 1;
  return weaponCoeffPct / pellets;
}

export function hitsPerShot(pelletCount = 1, muzzleCount = 1) {
  return Math.max(1, (pelletCount || 1)) * Math.max(1, (muzzleCount || 1));
}

/* ── ② 공격력과 방어력 (§6.1 ②) ───────────────────────────

   방어력은 곱이 아니라 뺄셈이고, 버프까지 먹인 공격력에서 뺀다 — 발당 피해가 낮은 SMG·MG 가 고방어 적에게 불리한 이유다.
   `defDownPct` 는 감소를 음수로 저장한다 (10% 감소 = -10). */
export function effectiveAttack(baseAttack, atkPct, atkFlat) {
  return baseAttack * (1 + pct(atkPct)) + (atkFlat || 0);
}

export function effectiveDefense(targetDefense, defDownPct, defIgnorePct, ignoresDefense) {
  if (ignoresDefense) return 0;
  const afterDown = Math.max(targetDefense * (1 + pct(defDownPct)), 0);
  return afterDown * Math.max(0, 1 - pct(defIgnorePct));
}

/* ── ④ 충전 (§6.1 ④) ──────────────────────────────────────

     충전 항 = 기본 풀 충전 배율 × (1 + 충전 배율 증가%) + 충전 피해 증가%

   두 종류는 서로 다른 효과다 — 350% 기준으로 chargeDmgPct 10% 는 3.60, chargeDmgMagPct 10% 는 3.85.
   `chargeRatio` 는 명세 밖의 확장이다 (§9.4 는 보간 규칙을 무기 데이터에 맡기고 갔다).
   비율을 칸 전체에 건다 — 배율만 깎고 버프는 두는 것이 아니다. 1 이면 명세의 식과 같다. */
export function chargeTerm({
  isFullCharge = false,
  fullChargeMultiplierPct = 100,
  chargeDmgPct = 0,
  chargeDmgMagPct = 0,
  chargeRatio = 1,
} = {}) {
  if (!isFullCharge) return 1;
  const full = pct(fullChargeMultiplierPct) * (1 + pct(chargeDmgMagPct)) + pct(chargeDmgPct);
  const ratio = chargeRatio >= 1 ? 1 : (chargeRatio > 0 ? chargeRatio : 0);
  return 1 + (full - 1) * ratio;
}

/* ── 한 타격 ───────────────────────────────────────────────

     hit    { coeffPct, tagMask, isNormal, isCrit, isCore, critProbability,
              coreProbability, inOptimalRange, isFullCharge, chargeRatio,
              ignoresDefense, coreMultiplierPct, fullChargeMultiplierPct }
     source { baseAttack, stats }          stats 는 Float64Array 또는 이름 객체
     target { defense, stats }
     battle { rngMode, inFullBurst }

   `stats` 는 `statAt()` 으로만 읽는다 — 프레임 루프는 TypedArray 를, 테스트는 이름 객체를 넘긴다.
   `explain` 이 참이면 일곱 항을 따로 낸다. 일반 실행은 타격마다 객체를 안 만들고 정수 하나만 낸다 (§6.2). */

export function statAt(stats, statCode) {
  if (!stats) return 0;
  if (typeof stats.length === 'number' && typeof stats[statCode] === 'number') {
    return stats[statCode];
  }
  return 0;
}

/* 이름 객체를 넘기고 싶을 때 쓰는 어댑터. 테스트와 UI 전용이다. */
export function statsFromNames(names = {}) {
  const out = new Float64Array(Object.keys(StatCode).length);
  for (const key of Object.keys(names)) {
    const code = StatCode[key];
    if (code === undefined) throw new Error(`알 수 없는 능력치: '${key}'`);
    out[code] = names[key];
  }
  return out;
}

export function calcHitDamage(hit, source, target, battle, explain = false) {
  const s = source.stats;
  const ts = target.stats;

  /* ① 계수 */
  const coeff = pct(hit.coeffPct)
    * (hit.isNormal ? 1 + pct(statAt(s, StatCode.normalAtkDmgPct)) : 1);

  /* ② 공방차 */
  const attack = effectiveAttack(
    source.baseAttack,
    statAt(s, StatCode.atkPct),
    statAt(s, StatCode.atkFlat),
  );
  const defense = effectiveDefense(
    target.defense,
    statAt(ts, StatCode.defDownPct),
    statAt(s, StatCode.defIgnorePct),
    hit.ignoresDefense,
  );
  const attackMinusDefense = Math.max(attack - defense, 0);

  /* ③ 가산 — 넷이 서로 곱하지 않고 1 에 더해진다 */
  const expected = battle.rngMode === 'expected';
  const critProbability = expected ? (hit.critProbability || 0) : Number(!!hit.isCrit);
  const coreProbability = expected ? (hit.coreProbability || 0) : Number(!!hit.isCore);

  const critContribution = critProbability * (0.5 + pct(statAt(s, StatCode.critDmgPct)));
  const fullBurstContribution = battle.inFullBurst ? 0.5 : 0;
  const rangeContribution = hit.isNormal && hit.inOptimalRange ? 0.3 : 0;
  const coreContribution = coreProbability * pct(
    (hit.coreMultiplierPct || 0) - 100 + statAt(s, StatCode.coreDmgPct),
  );
  const additive = 1
    + critContribution + fullBurstContribution + rangeContribution + coreContribution;

  /* ④ 충전 */
  const charge = chargeTerm({
    isFullCharge: hit.isFullCharge,
    fullChargeMultiplierPct: hit.fullChargeMultiplierPct,
    chargeDmgPct: statAt(s, StatCode.chargeDmgPct),
    chargeDmgMagPct: statAt(s, StatCode.chargeDmgMagPct),
    chargeRatio: hit.chargeRatio == null ? 1 : hit.chargeRatio,
  });

  /* ⑤ 공격 유형 — 그 타격이 해당 종류일 때만 더한다 */
  let typeBonusPct = statAt(s, StatCode.atkDmgPct);
  for (let i = 0; i < TYPE_STAT_BY_TAG.length; i++) {
    const pair = TYPE_STAT_BY_TAG[i];
    if (hasTag(hit.tagMask, pair[0])) typeBonusPct += statAt(s, pair[1]);
  }
  const attackType = 1 + pct(typeBonusPct);

  /* ⑥ 받는 피해 — 분배 피해 증가는 **적이 받는 쪽**이다 */
  const received = 1 + pct(
    statAt(ts, StatCode.receivedDmgPct)
    + (hasTag(hit.tagMask, HitTag.DISTRIBUTED) ? statAt(ts, StatCode.distributedDmgPct) : 0),
  );

  /* ⑦ 우월 코드 */
  const element = hit.hasElementAdvantage
    ? 1.1 + pct(statAt(s, StatCode.elementDmgPct))
    : 1;

  const raw = coeff * attackMinusDefense * additive * charge * attackType * received * element;
  const damage = Math.max(1, roundHalfEven(raw));

  if (!explain) return damage;
  return {
    damage,
    raw,
    terms: {
      coeff, attackMinusDefense, additive, charge, attackType, received, element,
    },
    attack, defense,
  };
}

/* ── 장탄 (§9.5, §14.7) ───────────────────────────────────

   증가율은 원천별로 기본 장탄에 걸고 각각 정수화한 뒤 합산한다.
   먼저 더하고 한 번만 반올림하면 SR 6발·RL 5발에서 1발이 갈리고, 그 1발이 DPS 를 10% 넘게 흔든다. */
export function resolveMaxAmmo(baseAmmo, deltasPct = []) {
  let total = baseAmmo;
  for (const deltaPct of deltasPct) {
    total += roundHalfEven(baseAmmo * pct(deltaPct));
  }
  return Math.max(1, total);
}

/* ── 재장전 (§9.6, §14.7) ─────────────────────────────────

     재장전 시간   = 고정값이 있으면 그 값, 아니면 기본 × max(0, 1 - 재장전 속도% / 100)
     1회 충전 비율 = (1 / 분할 횟수) × max(0, 1 + 재장전량% / 100)
     1회 충전 탄수 = max(1, floor(최대 장탄 × 비율 + 0.5))

   재장전 속도는 선형으로 깎여, 속도 100% 면 재장전이 0 이 된다 — "무한탄창" 지점이다.
   `기본 ÷ (1 + 속도)` 로 두면 100% 에서도 절반이 남아 그 지점이 사라진다.
   충전량만 0.5 올림을 쓴다 (§6.2) — 그래서 여기만 `floor(x + 0.5)` 다. */
export function reloadSec(baseReloadSec, reloadSpeedPct, fixedReloadSec = null) {
  if (fixedReloadSec != null) return Math.max(0, fixedReloadSec);
  return Math.max(0, baseReloadSec * Math.max(0, 1 - pct(reloadSpeedPct)));
}

export function reloadSegmentAmmo(maxAmmo, segmentCount = 1, reloadAmountPct = 0) {
  const segments = segmentCount > 0 ? segmentCount : 1;
  const ratio = (1 / segments) * Math.max(0, 1 + pct(reloadAmountPct));
  return Math.max(1, Math.floor(maxAmmo * ratio + 0.5));
}

/* ── 코어 명중 확률 (§7.1) ────────────────────────────────

     R = max(spreadDiameterPx, 1) / 2
     r = coreDiameterPx / 2
     확률 = min(1, (r / R) ^ n)

   `n` 은 실측으로 맞추는 모델 상수다. 없으면 계산을 거부한다 (§13) — 0 이나 평균으로 때우면 코어가 늘 맞거나 영영 안 맞는다. */
export function coreHitProbability(coreDiameterPx, spreadDiameterPx, exponent) {
  if (!(coreDiameterPx > 0)) return 0;
  if (!Number.isFinite(exponent)) {
    throw new RangeError('코어 명중 계산에 필요한 보정 상수(coreProbabilityExponent)가 없습니다');
  }
  const R = Math.max(spreadDiameterPx, 1) / 2;
  const r = coreDiameterPx / 2;
  return Math.min(1, Math.pow(r / R, exponent));
}

/* ── 기대값 누산기 (§7.3) ─────────────────────────────────

   기대값 모드에서도 발동 횟수는 정수다. 확률을 쌓다가 1 을 넘을 때마다 한 번 발동시키고 1 을 뺀다.
   키에 캐릭터와 이벤트 종류를 반드시 넣는다 — 다른 캐릭터나 크리·코어가 한 누산기를 공유하면 안 된다. */
export class ProbabilityAccumulator {
  constructor() { this.slots = new Map(); }

  /* 쌓고, 이번에 몇 번 발동해야 하는지 돌려준다. */
  add(key, probability) {
    if (!(probability > 0)) return 0;
    if (probability > 1) {
      throw new RangeError(`기대값 모드에서 범위를 벗어난 확률: ${probability} (${key})`);
    }
    const next = (this.slots.get(key) || 0) + probability;
    const fires = Math.floor(next);
    this.slots.set(key, next - fires);
    return fires;
  }
}
