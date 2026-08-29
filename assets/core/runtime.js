/* 컴파일 — 읽기 쉬운 입력 객체를 인덱스·고정 배열 중심의 런타임으로 바꾼다 (§2.2, §4).

   문자열 ID 는 여기서 한 번만 숫자 인덱스로 바뀐다. 프레임 루프는 문자열 검색을 안 하고 (§17), 표에 없는 이름은 오류다 (§13).
   스쿼드가 최대 5명이라 대상 집합은 하위 5비트 마스크다 (`0b00101` = 0번과 2번). 외부 로그를 만들 때만 다시 ID 로 되돌린다. */

import {
  StatCode, STAT_COUNT, StateFlag, TriggerCode, TRIGGER_COUNT, StackingCode,
  ActionCode, ElementCode, WeaponCode, OPTIMAL_RANGE_BY_WEAPON, HitKind,
  SimInputError, lookupCode, tagMaskOf,
} from './codes.js';
import { assertUniqueIds, secToFrame } from './normalize.js';
import { resolveMaxAmmo } from './damage.js';

export const MAX_SQUAD = 5;

/* ── 무기 (§3.3) ──────────────────────────────────────────── */

const REQUIRED_WEAPON_NUMBERS = [
  'damageCoeffPct', 'fireRatePerSec', 'magazineSize', 'reloadSec',
];

function compileWeapon(weapon, where) {
  if (!weapon) throw new SimInputError('무기 데이터가 없습니다', where);
  if (weapon.weaponCode == null) {
    throw new SimInputError('무기 데이터 누락: weaponCode', { ...where, field: 'weaponCode' });
  }
  for (const field of REQUIRED_WEAPON_NUMBERS) {
    if (weapon[field] == null || !Number.isFinite(Number(weapon[field]))) {
      throw new SimInputError(`무기 데이터 누락: ${field}`, { ...where, field });
    }
  }
  const weaponCode = lookupCode(WeaponCode, weapon.weaponCode, 'weaponCode', where);
  const fireMode = weapon.fireMode || 'auto';
  if (!['auto', 'auto_warmup', 'charge'].includes(fireMode)) {
    throw new SimInputError(`알 수 없는 fireMode: '${fireMode}'`, where);
  }
  if (fireMode === 'charge' && !(weapon.chargeSec > 0)) {
    throw new SimInputError('충전 무기에 chargeSec 이 없습니다', where);
  }
  return Object.freeze({
    weaponCode,
    weaponName: weapon.weaponCode,
    fireMode,
    damageCoeffPct: Number(weapon.damageCoeffPct),
    fireRatePerSec: Number(weapon.fireRatePerSec),
    /* 예열 무기는 최소 -> 최대로 선형 보간한다 (§9.3). 실측 기준은 시간이 아니라 발수다 — 한 발 쏠 때마다 한 계단 (메커니즘 14). */
    warmupFireRateStartPerSec: Number(weapon.warmupFireRateStartPerSec
      ?? weapon.fireRatePerSec),
    warmupFireRateEndPerSec: Number(weapon.warmupFireRateEndPerSec
      ?? weapon.fireRatePerSec),
    warmupStepPerShot: Number(weapon.warmupStepPerShot ?? 0),
    magazineSize: Math.max(1, Math.round(Number(weapon.magazineSize))),
    reloadSec: Number(weapon.reloadSec),
    reloadSegmentCount: Math.max(1, Math.round(Number(weapon.reloadSegmentCount ?? 1))),
    pelletCount: Math.max(1, Math.round(Number(weapon.pelletCount ?? 1))),
    muzzleCount: Math.max(1, Math.round(Number(weapon.muzzleCount ?? 1))),
    spreadDiameterPx: Number(weapon.spreadDiameterPx ?? 100),
    coreMultiplierPct: Number(weapon.coreMultiplierPct ?? 200),
    fullChargeMultiplierPct: Number(weapon.fullChargeMultiplierPct ?? 100),
    chargeSec: Number(weapon.chargeSec ?? 0),
    optimalRange: OPTIMAL_RANGE_BY_WEAPON[weapon.weaponCode] ?? null,
    /* 게이지 수급은 발사체마다 센다 (메커니즘 4·13). 분열탄은 대미지를 안 늘리되 게이지는 조각 수만큼 채운다. */
    projectilePerShot: Math.max(1, Math.round(Number(weapon.projectilePerShot ?? 1))),
    burstEnergyPerTargetShot: Number(weapon.burstEnergyPerTargetShot ?? 0),
    hitTagMask: tagMaskOf(weapon.hitTags, where),
  });
}

/* ── 효과 (§3.5, §8) ─────────────────────────────────────── */

const TARGET_RULES = new Set([
  /* 명세 §8.3 */
  'self', 'squad', 'allies', 'highestAtk', 'lowestAtk', 'highestHp', 'lowestHp',
  'random', 'byWeapon', 'byClass', 'byCompany', 'byElement', 'burstCaster',
  /* 실측 쪽 — 효과표 199장이 실제로 쓰는 것들. 명세 목록에 없다고 떨어뜨리면 그 스킬이 통째로 사라진다. */
  'enemy',                     // 적에게 거는 디버프
  'alliesLowerDef',            // 자신보다 방어력이 낮은 아군
  'burstUsersThisCycle',       // 이번 사이클에 버스트를 쓴 아군
  'nonBurstUsersThisCycle',    // 안 쓴 아군
]);

function compileEffect(effect, charIdx, where) {
  if (effect.statCode == null && effect.hitDef == null
      && effect.setState == null && !(effect.clearStates || []).length) {
    throw new SimInputError('효과에 statCode·hitDef·상태 조작이 하나도 없습니다', where);
  }
  const statCode = effect.statCode == null
    ? -1
    : lookupCode(StatCode, effect.statCode, 'statCode', where);

  const targetRule = effect.targetRule || { typeCode: 'self' };
  if (!TARGET_RULES.has(targetRule.typeCode)) {
    throw new SimInputError(`알 수 없는 대상 규칙: '${targetRule.typeCode}'`, where);
  }
  const triggerRule = effect.triggerRule || { typeCode: 'battleStart' };
  const triggerCode = lookupCode(TriggerCode, triggerRule.typeCode, 'trigger', where);

  const stackLimit = effect.stackLimit == null ? 1 : Number(effect.stackLimit);
  if (!(stackLimit > 0)) {
    throw new SimInputError(`최대 중첩이 0 이하입니다: ${stackLimit}`, where);
  }
  const stackingCode = lookupCode(
    StackingCode, effect.stackingCode || 'refresh', 'stackingCode', where);

  if (effect.intervalSec != null && !(effect.intervalSec > 0)) {
    throw new SimInputError(`주기 효과의 간격이 0 이하입니다: ${effect.intervalSec}`, where);
  }

  let hitDef = null;
  if (effect.hitDef) {
    const h = effect.hitDef;
    hitDef = Object.freeze({
      coeffPct: Number(h.coeffPct || 0),
      tagMask: tagMaskOf(h.tags, where),
      kind: lookupCode(HitKind, h.kind || 'SKILL', 'hitKind', where),
      times: Math.max(1, Math.round(Number(h.times ?? 1))),
      everySec: Number(h.everySec ?? 0),
      isCoreHit: h.isCoreHit === true,
      ignoresDefense: h.ignoresDefense === true,
      /* "추가 대미지" 는 이미 나간 총알에 얹히는 판정이라 게이지를 안 채운다
         (메커니즘 4). 나머지 스킬 투사체는 채운다. */
      chargesGauge: h.chargesGauge != null
        ? !!h.chargesGauge
        : (h.kind || 'SKILL') !== 'EXTRA',
    });
  }

  return Object.freeze({
    id: effect.id,
    displayName: effect.displayName || effect.id,
    sourceIdx: charIdx,
    statCode,
    value: Number(effect.value || 0),
    targetTypeCode: targetRule.typeCode,
    targetCount: Number(targetRule.count ?? 1),
    targetFilter: targetRule.filter ?? null,
    triggerCode,
    triggerCount: Number(triggerRule.count ?? 1),
    durationSec: effect.durationSec == null ? Infinity : Number(effect.durationSec),
    stackLimit,
    stackingCode,
    conditions: Object.freeze([...(effect.conditions || [])]),
    intervalSec: effect.intervalSec == null ? 0 : Number(effect.intervalSec),
    /* 장탄 효과는 원천별로 따로 반올림해야 하므로 계열 이름을 들고 간다 (§9.5). */
    ammoSeries: effect.ammoSeries || effect.id,
    /* 이름 붙은 상태 (효과표의 `[취기 : ~]` 같은 것). 이 규칙이 상태를 세우거나 걷는다.
       상태가 걷히면 그 상태가 낳은 버프도 같이 사라져야 한다 — 상태만 지우고 버프를 남기면 조건이 꺼진 뒤에도 효과가 산다. */
    /* 규칙 자리(`c016 s1[2]`)와 해석 메모. 계산에는 안 쓰지만 화면이 이걸로 출처를 푼다 — 없으면 어느 스킬에서 왔는지 못 읽는다. */
    source: effect.source ?? null,
    note: effect.note ?? null,
    stateName: effect.stateName ?? null,
    setState: effect.setState ?? null,
    setStateDurationSec: effect.setStateDurationSec ?? null,
    clearStates: Object.freeze([...(effect.clearStates || [])]),
    hitDef,
  });
}

/* ── 캐릭터 ───────────────────────────────────────────────── */

function compileCharacter(character, charIdx) {
  const where = { characterId: character.id };
  if (!(character.baseAttack > 0)) {
    throw new SimInputError('필수 능력치 누락: baseAttack', where);
  }
  const burstStage = character.burstStage;
  if (!['1', '2', '3', 'AllStep', 1, 2, 3].includes(burstStage)) {
    throw new SimInputError(`알 수 없는 버스트 단계: '${burstStage}'`, where);
  }
  const effects = (character.effects || [])
    .map((effect, i) => compileEffect(effect, charIdx,
      { ...where, effectId: effect.id ?? `#${i}` }));
  assertUniqueIds(effects, 'effect');

  return {
    id: character.id,
    displayName: character.displayName || character.id,
    charIdx,
    elementCode: character.elementCode == null
      ? null
      : lookupCode(ElementCode, character.elementCode, 'elementCode', where),
    /* 버스트 단계는 문자열로 남긴다 — `'AllStep'` 이 숫자가 아니고 재진입 판정(메커니즘 18)이 이 값을 그대로 본다. */
    burstStage: String(burstStage),
    burstCooldownSec: Number(character.burstCooldownSec ?? 20),
    burstGaugeReadyDelaySec: Number(character.burstGaugeReadyDelaySec ?? 2),
    burstDurationSec: Number(character.burstDurationSec ?? 10),
    /* 재진입 단계 (메커니즘 17). `null` 이면 재진입하지 않는다. */
    reentryStage: character.reentryStage == null ? null : String(character.reentryStage),
    baseAttack: Number(character.baseAttack),
    critRatePct: Number(character.critRatePct ?? 15),
    weapon: compileWeapon(character.weapon, where),
    effects,
    /* 전투 시작 전에 이미 붙은 것 (장비 옵션·큐브·소장품). 버프 목록이 아니라 고정 가산이라 매 프레임 다시 안 센다. */
    staticStats: character.staticStats || {},
    staticAmmoPct: [...(character.staticAmmoPct || [])],
    className: character.className ?? null,
    company: character.company ?? null,
  };
}

/* ── 조작 (§9.7) ─────────────────────────────────────────── */

function compileControlEvents(controlEvents, charIndexById, frameRate) {
  const out = (controlEvents || []).map((input, order) => {
    const charIdx = charIndexById.get(input.characterId);
    if (charIdx === undefined) {
      throw new SimInputError(
        `존재하지 않는 대상을 가리키는 조작 입력: '${input.characterId}'`,
        { characterId: input.characterId, atSec: input.atSec });
    }
    return {
      frame: secToFrame(input.atSec, frameRate),
      charIdx,
      action: lookupCode(ActionCode, input.actionCode, 'actionCode',
        { characterId: input.characterId, atSec: input.atSec }),
      order,
    };
  });
  /* 동일 프레임의 조작은 입력 배열 순서를 유지하는 안정 정렬이다 (§9.7). */
  out.sort((a, b) => (a.frame - b.frame) || (a.order - b.order));
  return out;
}

/* ── 컴파일 ───────────────────────────────────────────────── */

export function compileRuntime({ characters, target, options, controlEvents }) {
  if (!Array.isArray(characters) || characters.length < 1) {
    throw new SimInputError('스쿼드는 1명 이상이어야 합니다', {});
  }
  if (characters.length > MAX_SQUAD) {
    throw new SimInputError(`스쿼드는 ${MAX_SQUAD}명 이하여야 합니다`,
      { count: characters.length });
  }
  assertUniqueIds(characters, 'character');

  const charCount = characters.length;
  const charIndexById = new Map(characters.map((c, i) => [c.id, i]));
  const compiled = characters.map(compileCharacter);

  const runtime = {
    charCount,
    charIndexById,
    charIdByIndex: compiled.map(c => c.id),
    chars: compiled,
    options,
    target,

    /* 고정 길이의 자주 접근하는 값 (§2.2) */
    ammo: new Int32Array(charCount),
    maxAmmo: new Int32Array(charCount),
    stateFlags: new Uint32Array(charCount),
    burstCooldownEndFrame: new Float64Array(charCount).fill(-1),

    /* 능력치는 [charIdx * STAT_COUNT + statCode] 로 접근한다 */
    baseStats: new Float64Array(charCount * STAT_COUNT),
    bonusStats: new Float64Array(charCount * STAT_COUNT),
    /* 파생 능력치 캐시. 버프 목록이 바뀌면 버전을 올리고 버전이 다를 때만 다시 계산한다 (§11). */
    statsVersion: new Uint32Array(charCount),
    cachedVersion: new Uint32Array(charCount).fill(0xffffffff),
    cachedStats: new Float64Array(charCount * STAT_COUNT),

    /* 트리거 횟수는 캐릭터마다 Map 을 만들지 않고 한 장에 센다 (§4) */
    triggerCounters: new Uint32Array(charCount * TRIGGER_COUNT),

    /* 무기별 가변 상태 — 구조가 무기마다 다르므로 평탄화하지 않는다 (§2.2) */
    weaponStates: compiled.map(c => ({
      nextShotFrame: 0,
      reloadEndFrame: -1,
      reloadSegmentsDone: 0,
      chargeStartFrame: -1,
      warmupShotCount: 0,
      lastShotFrame: -1,
      scheduledIntervalFrames: options.frameRate / Math.max(1e-9, c.weapon.fireRatePerSec),
      firing: true,
    })),
  };

  /* 6. 장탄 증가·감소를 포함한 최대 탄약 계산 -> 7. 현재 탄약을 최대로 채움 (§4) */
  for (let i = 0; i < charCount; i++) {
    runtime.maxAmmo[i] = resolveMaxAmmo(compiled[i].weapon.magazineSize,
                                        compiled[i].staticAmmoPct);
    runtime.ammo[i] = runtime.maxAmmo[i];
    /* 전투 시작 전에 붙어 있는 고정 능력치 */
    for (const key of Object.keys(compiled[i].staticStats)) {
      const code = StatCode[key];
      if (code === undefined) {
        throw new SimInputError(`알 수 없는 능력치: '${key}'`,
          { characterId: compiled[i].id, stat: key });
      }
      runtime.baseStats[i * STAT_COUNT + code] += compiled[i].staticStats[key];
    }
    runtime.baseStats[i * STAT_COUNT + StatCode.critRatePct] += compiled[i].critRatePct;
  }

  runtime.controlEvents = compileControlEvents(controlEvents, charIndexById, options.frameRate);

  return runtime;
}

/* ── 상태 플래그 (§4) ────────────────────────────────────── */

export function hasFlag(runtime, charIdx, flag) {
  return (runtime.stateFlags[charIdx] & flag) !== 0;
}

export function setFlag(runtime, charIdx, flag, enabled) {
  if (enabled) runtime.stateFlags[charIdx] |= flag;
  else runtime.stateFlags[charIdx] &= ~flag;
}

export { StateFlag, STAT_COUNT, TRIGGER_COUNT };
