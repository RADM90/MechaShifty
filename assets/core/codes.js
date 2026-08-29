/* 정수 코드 — 프레임 루프가 문자열을 비교하지 않게 하는 자리 (명세 §2.2, §11).

   저장 파일과 UI 는 문자열을 쓴다. 컴파일 때 여기 있는 표로 한 번 바꾸고 그 뒤로는 숫자만 돈다.
   표에 없는 이름은 무시하지 않고 오류다 (§13) — 지원하지 않는 스킬이 소리 없이 사라지면 아무도 모른다. */

/* ── 능력치 ────────────────────────────────────────────────

   순서가 곧 `baseStats[charIdx * STAT_COUNT + statCode]` 의 자리다. 가운데에 끼우지 말고 끝에만 늘린다 — 저장된 인덱스가 어긋난다. */
export const STAT_NAMES = [
  /* 대미지 식이 직접 읽는 것 (§6.1) */
  'atkPct',            // 공격력 %          ② 실효 공격력
  'atkFlat',           // 고정 공격력        ② 실효 공격력
  'atkFromCaster',     // 시전자 기준 공격력 % -> 걸 때 재서 고정 수치로 박는다
  'critRatePct',       // 크리티컬 확률      난수 판정 (칸이 아님)
  'critDmgPct',        // 크리티컬 피해      ③ 가산
  'coreDmgPct',        // 코어 피해 증가     ③ 가산
  'defIgnorePct',      // 방어 무시          ② 실효 방어력
  'normalAtkDmgPct',   // 일반 공격 피해     ① 계수
  'atkDmgPct',         // 모든 공격 피해     ⑤ 공격 유형
  'chargeDmgPct',      // 충전 피해 증가     ④ 배율에 가산
  'chargeDmgMagPct',   // 충전 배율 증가     ④ 배율에 곱
  'elementDmgPct',     // 우월 코드 피해     ⑦

  /* ⑤ 공격 유형 — 타격 태그와 1:1 로 짝지어야 한다 (아래 TYPE_STAT_BY_TAG) */
  'burstDmgPct',
  'aoeBurstDmgPct',
  'pierceDmgPct',
  'armorBreakDmgPct',
  'dotDmgPct',
  'projectileDmgPct',
  'stickDmgPct',
  'sequentialDmgPct',
  'partDmgPct',
  'shieldDmgPct',
  'singleBurstDmgPct',
  'blockDmgPct',    // 저지 부위 공격 피해

  /* ⑥ 적이 받는 쪽 — 적에게 걸리는 디버프다 */
  'receivedDmgPct',
  'distributedDmgPct',
  'defDownPct',        // 적 방어력 감소. 감소는 **음수**로 저장한다 (§6.1 ②)

  /* 사격 (칸이 아님, §9) */
  'maxAmmoPct',
  'reloadSpeedPct',
  'reloadAmountPct',
  'chargeSpeedPct',
  'chargeTimeFixSec',
  'spinupRatePct',
  'ammoChargeCount',
  'shotConditionCount',

  /* 버스트·게이지 (칸이 아님, §10) */
  'burstCooldownSec',
  'burstGaugePct',
  'burstGaugeSpeedPct',

  /* 대미지 밖 */
  'defPct',
  'explosionRangePx',
  'healPct',
  'shieldPct',
];

export const StatCode = Object.freeze(
  Object.fromEntries(STAT_NAMES.map((name, idx) => [name, idx])),
);
export const STAT_COUNT = STAT_NAMES.length;

/* ── 타격 태그 (§6.2) ──────────────────────────────────────

   비트 집합이라 한 타격이 여러 태그를 동시에 단다 — 자칼 버스트는 BURST | SINGLE_BURST 다. */
export const HitTag = Object.freeze({
  BURST: 1 << 0,
  AOE_BURST: 1 << 1,
  PIERCE: 1 << 2,
  ARMOR_BREAK: 1 << 3,
  DOT: 1 << 4,
  PROJECTILE: 1 << 5,
  SEQUENTIAL: 1 << 6,
  PART: 1 << 7,
  DISTRIBUTED: 1 << 8,
  STICK: 1 << 9,
  SINGLE_BURST: 1 << 10,
  SHIELD: 1 << 11,
  BLOCK: 1 << 12,
});

export const HIT_TAG_NAMES = Object.freeze(Object.keys(HitTag));

/* 태그 -> ⑤ 칸에서 더할 능력치. 여기 없는 태그는 ⑤ 에 아무것도 안 더한다
   (DISTRIBUTED 는 ⑥ 으로 가고, SINGLE_BURST 는 BURST 와 함께 달리므로 자기 몫만). */
export const TYPE_STAT_BY_TAG = Object.freeze([
  [HitTag.BURST, StatCode.burstDmgPct],
  [HitTag.AOE_BURST, StatCode.aoeBurstDmgPct],
  [HitTag.PIERCE, StatCode.pierceDmgPct],
  [HitTag.ARMOR_BREAK, StatCode.armorBreakDmgPct],
  [HitTag.DOT, StatCode.dotDmgPct],
  [HitTag.PROJECTILE, StatCode.projectileDmgPct],
  [HitTag.SEQUENTIAL, StatCode.sequentialDmgPct],
  [HitTag.PART, StatCode.partDmgPct],
  [HitTag.STICK, StatCode.stickDmgPct],
  [HitTag.SINGLE_BURST, StatCode.singleBurstDmgPct],
  [HitTag.SHIELD, StatCode.shieldDmgPct],
  [HitTag.BLOCK, StatCode.blockDmgPct],
]);

/* ── 캐릭터 상태 플래그 (§4) ──────────────────────────────── */
export const StateFlag = Object.freeze({
  IN_COVER: 1 << 0,
  CHARGING: 1 << 1,
  RELOADING: 1 << 2,
  BURST_CASTED: 1 << 3,
  INFINITE_AMMO: 1 << 4,
  STUNNED: 1 << 5,
});

/* ── 타격 종류 (§3.5, 실측 메커니즘 8) ─────────────────────

   "평타냐 스킬이냐" 가 아니라 그 타격이 원문에서 무엇이라고 선언되는가로 가른다.
   `EXTRA`("추가 대미지")는 이미 나간 총알에 얹히는 판정이라 게이지를 안 채운다 (메커니즘 4). */
export const HitKind = Object.freeze({
  NORMAL: 0,       // 무기로 쏘는 것 (충전 포함)
  BURST_SKILL: 1,  // "[최종 공격력 6000% 버스트 스킬 대미지]"
  EXTRA: 2,        // "[최종 공격력 N% 추가 대미지]"
  SKILL: 3,        // 그 밖의 스킬 타격
});

/* ── 트리거 (§8.4) ────────────────────────────────────────

   `Uint32Array(charCount * TRIGGER_COUNT)` 한 장에 발동 횟수를 센다 (§4). */
export const TRIGGER_NAMES = [
  'battleStart',
  'normalHit',
  'hitCount',
  'lastBullet',
  'reloadStart',
  'reloadDone',
  'ammoCharge',
  'critHit',
  'coreHit',
  'fullChargeHit',
  'burstUse',
  'fullBurstStart',
  'fullBurstEnd',
  'interval',
  'buffApplied',
  'buffExpired',
  'shieldBroken',
  'squadHitCount',
  /* 실측 쪽에서 온 것 — 명세 §8.4 목록에 없지만 효과표가 실제로 쓴다 */
  'burstStageEnter',   // 특정 버스트 단계가 열릴 때
  'healApplied',       // 회복이 들어갔을 때
];
export const TriggerCode = Object.freeze(
  Object.fromEntries(TRIGGER_NAMES.map((name, idx) => [name, idx])),
);
export const TRIGGER_COUNT = TRIGGER_NAMES.length;

/* ── 조작 (§9.7) ──────────────────────────────────────────

   엄폐 진입은 한 프레임을 소비한다. */
export const ACTION_NAMES = [
  'fireHold', 'fireRelease', 'fireTap', 'reload', 'reloadCancel',
  'coverOn', 'coverOff', 'chargeStart', 'fire', 'burst',
];
export const ActionCode = Object.freeze(
  Object.fromEntries(ACTION_NAMES.map((name, idx) => [name, idx])),
);

/* ── 중첩 규칙 (§3.5) ─────────────────────────────────────── */
export const StackingCode = Object.freeze({
  refresh: 0,      // 지속시간만 새로 잰다
  extend: 1,       // 남은 시간에 더한다
  independent: 2,  // 따로 산다 (중첩 수만큼 항이 는다)
  replace: 3,      // 기존 것을 지우고 새로 건다
});

/* ── 이벤트 (§11) ─────────────────────────────────────────── */
export const EventCode = Object.freeze({
  HIT: 0, EFFECT_APPLY: 1, EFFECT_EXPIRE: 2, RELOAD_DONE: 3,
  BURST_USE: 4, FULL_BURST_START: 5, FULL_BURST_END: 6, TRIGGER: 7,
});

/* ── 우월 코드 (§6.1 ⑦) ───────────────────────────────────

     전격 → 수냉 → 작열 → 풍압 → 철갑 → 전격
   `ELEMENT_BEATS[a] === b` 이면 a 가 b 를 상대로 우월 코드다. */
export const ELEMENT_NAMES = ['electric', 'water', 'fire', 'wind', 'iron'];
export const ElementCode = Object.freeze(
  Object.fromEntries(ELEMENT_NAMES.map((name, idx) => [name, idx])),
);
const BEATS = { electric: 'water', water: 'fire', fire: 'wind', wind: 'iron', iron: 'electric' };
export const ELEMENT_BEATS = Object.freeze(
  ELEMENT_NAMES.map(name => ElementCode[BEATS[name]]),
);

export function hasElementAdvantage(attackerCode, defenderCode) {
  if (attackerCode == null || defenderCode == null) return false;
  return ELEMENT_BEATS[attackerCode] === defenderCode;
}

/* ── 무기군 (§6.1 ③ 유효 사거리) ───────────────────────────

   RL 은 `null` 이라 유효 사거리 보너스를 영영 안 받는다. 무기군을 보고 예외 처리하는 게 아니라 표의 `null` 로 저절로 빠진다. */
export const WEAPON_NAMES = ['AR', 'SMG', 'RL', 'SR', 'MG', 'SG'];
export const WeaponCode = Object.freeze(
  Object.fromEntries(WEAPON_NAMES.map((name, idx) => [name, idx])),
);
export const OPTIMAL_RANGE_BY_WEAPON = Object.freeze({
  AR: 'mid', SMG: 'near', RL: null, SR: 'far', MG: 'mid', SG: 'near',
});

/* 화면은 한국어로 거리를 고른다. 코드 쪽 이름과 안 맞으면 유효 사거리 30% 가 영영 안 붙는데 오류도 안 나므로 표로 둔다. */
const RANGE_ALIAS = { 근거리: 'near', 중거리: 'mid', 원거리: 'far',
                      near: 'near', mid: 'mid', far: 'far' };

export function normalizeRange(value) {
  if (value == null) return null;
  const code = RANGE_ALIAS[value];
  if (code === undefined) {
    throw new SimInputError(`알 수 없는 교전거리: '${value}'`, { engagementRange: value });
  }
  return code;
}

/* ── 코드 조회 — 모르는 이름이면 오류 (§13) ────────────────── */

export class SimInputError extends Error {
  constructor(message, where = {}) {
    super(message);
    this.name = 'SimInputError';
    this.where = where;
  }
}

export function lookupCode(table, name, kind, where) {
  const code = table[name];
  if (code === undefined) {
    throw new SimInputError(`알 수 없는 ${kind}: '${name}'`, { ...where, [kind]: name });
  }
  return code;
}

/* 문자열 태그 배열 -> 비트 마스크. 모르는 태그면 오류. */
export function tagMaskOf(tags, where) {
  let mask = 0;
  for (const tag of [].concat(tags || [])) {
    mask |= lookupCode(HitTag, tag, 'hitTag', where);
  }
  return mask;
}
