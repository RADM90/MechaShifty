/* 다리 — 앱의 데이터(CDN 전투 JSON + 손으로 쓴 효과표)를 코어의 캐릭터 계약으로 옮긴다.

   코어는 명세 어휘(`atkPct`·`PIERCE`·`normalHit`)로 말하고, 효과표는 1세대 어휘(`pierceDmg`·`shots`)에 값도 비율(0.0802)이다.
   그 둘을 잇는 표가 이 파일이다. 여기 없는 이름은 떨어뜨리지 않고 오류로 올린다 — 스킬 하나가 소리 없이 사라지면 아무도 모른다 (§13).
   효과표를 다시 쓰지 않고 이미 들어 있는 정보를 유도로 얹는다. */

import { SimInputError } from './codes.js';

/* ── 능력치 이름 (효과표 -> 코어) ─────────────────────────── */

export const STAT_MAP = Object.freeze({
  atkPct: 'atkPct',
  atkFromCaster: 'atkFromCaster',
  damageUp: 'atkDmgPct',            // "모든 공격 대미지" — ⑤ 의 바탕
  receivedUp: 'receivedDmgPct',
  elemDmg: 'elementDmgPct',
  critRate: 'critRatePct',
  critDmg: 'critDmgPct',
  coreDmg: 'coreDmgPct',
  defPct: 'defPct',
  chargeSpeed: 'chargeSpeedPct',
  chargeTimeFix: 'chargeTimeFixSec',
  reloadSpeed: 'reloadSpeedPct',
  maxAmmo: 'maxAmmoPct',
  ammoCharge: 'ammoChargeCount',
  spinupRate: 'spinupRatePct',
  burstGaugeSpeed: 'burstGaugeSpeedPct',
  explosionRange: 'explosionRangePx',
  shotCondition: 'shotConditionCount',
  burstCooldown: 'burstCooldownSec',
  burstGauge: 'burstGaugePct',
  /* ⑤ 공격 유형 */
  distributedDmg: 'distributedDmgPct',
  dotDmg: 'dotDmgPct',
  trueDmg: 'armorBreakDmgPct',
  chargeDmg: 'chargeDmgPct',
  pierceDmg: 'pierceDmgPct',
  partsDmg: 'partDmgPct',
  blockDmg: 'blockDmgPct',
  explosionDmg: 'projectileDmgPct',
  stickDmg: 'stickDmgPct',
  normalAtkPct: 'normalAtkDmgPct',
  burstSkillDmg: 'burstDmgPct',
  singleBurstDmg: 'singleBurstDmgPct',
  sequentialDmg: 'sequentialDmgPct',
  shieldDmg: 'shieldDmgPct',
  /* 대미지 식 밖 — 아직 모형에 안 들어온 것들. 떨어뜨리되 이름은 남긴다. */
  normalAsTrue: null,
  chargeOverflow: null,
  heal: null,
  stun: null,
});

/* 어느 스탯이 **적에게** 걸리는가. 이것들은 대상이 적이다. */
const ENEMY_STATS = new Set(['receivedDmgPct', 'distributedDmgPct', 'defDownPct']);

/* 값을 퍼센트 포인트로. 효과표는 비율(0.0802), 코어는 퍼센트 포인트(8.02) 다. 초 단위 스탯만 그대로 둔다. */
const SECONDS_STATS = new Set(['burstCooldownSec', 'chargeTimeFixSec']);
const COUNT_STATS = new Set(['ammoChargeCount', 'shotConditionCount', 'explosionRangePx']);

function valueFor(coreStat, raw) {
  if (SECONDS_STATS.has(coreStat) || COUNT_STATS.has(coreStat)) return raw;
  return raw * 100;
}

/* ── 트리거 ───────────────────────────────────────────────── */

export const TRIGGER_MAP = Object.freeze({
  battleStart: 'battleStart',
  fullBurstStart: 'fullBurstStart',
  fullBurstEnd: 'fullBurstEnd',
  burstUse: 'burstUse',
  burstStep1Enter: 'burstStageEnter',
  burstStep2Enter: 'burstStageEnter',
  burstStep3Enter: 'burstStageEnter',
  shots: 'normalHit',
  squadShots: 'squadHitCount',
  coreHits: 'coreHit',
  reloadDone: 'reloadDone',
  lastBullet: 'lastBullet',
  fullChargeHit: 'fullChargeHit',
  healApplied: 'healApplied',
  interval: 'interval',
});

/* ── 대상 ─────────────────────────────────────────────────── */

export const TARGET_MAP = Object.freeze({
  self: 'self',
  allies: 'allies',
  alliesLowerDef: 'alliesLowerDef',
  highestAtkAlly: 'highestAtk',
  lowestDefAlly: 'lowestAtk',
  burstUsersThisCycle: 'burstUsersThisCycle',
  nonBurstUsersThisCycle: 'nonBurstUsersThisCycle',
  enemy: 'enemy',
});

/* ── 조건 ─────────────────────────────────────────────────── */

function conditionsFrom(when, where) {
  const out = [];
  for (const key of Object.keys(when || {})) {
    const value = when[key];
    switch (key) {
      case 'fullBurst': out.push({ typeCode: 'inFullBurst', value }); break;
      case 'squadHasStep1': out.push({ typeCode: 'squadHasStage', value: '1', want: value });
        /* 조건의 방향을 값으로 못 넘기므로 아래에서 뒤집는다 */
        out[out.length - 1] = value
          ? { typeCode: 'squadHasStage', value: '1' }
          : { typeCode: 'squadLacksStage', value: '1' };
        break;
      case 'usedStep': out.push({ typeCode: 'usedStage', value: String(value).replace('Step', '') }); break;
      case 'selfState':
        if (typeof value === 'string' && value.startsWith('!')) {
          out.push({ typeCode: 'notState', value: value.slice(1) });
        } else out.push({ typeCode: 'hasState', value });
        break;
      case 'enemyState': out.push({ typeCode: 'enemyState', value }); break;
      case 'squadHasWeapon': out.push({ typeCode: 'squadHasWeapon', value }); break;
      case 'burstUsedThisCycle': out.push({ typeCode: 'burstUsedThisCycle', value }); break;
      case 'stacksAtMax': out.push({ typeCode: 'stacksAtMax', effectId: where, max: value }); break;
      case 'hasStacks': out.push({ typeCode: 'hasStacks', effectId: where }); break;
      default:
        throw new SimInputError(`옮길 수 없는 조건: '${key}'`, { where, condition: key });
    }
  }
  return out;
}

/* ── 타격 ─────────────────────────────────────────────────── */

const TAG_MAP = Object.freeze({
  burstSkillDmg: 'BURST', singleBurstDmg: 'SINGLE_BURST', pierceDmg: 'PIERCE',
  trueDmg: 'ARMOR_BREAK', dotDmg: 'DOT', explosionDmg: 'PROJECTILE',
  stickDmg: 'STICK', sequentialDmg: 'SEQUENTIAL', partsDmg: 'PART',
  distributedDmg: 'DISTRIBUTED', shieldDmg: 'SHIELD', blockDmg: 'BLOCK',
});

/* 효과표는 1세대 어휘지만 코어가 필요한 정보가 이미 들어 있다.
     hit.kind === 'burst'  -> 버스트 스킬 본체
     hit.gauge === false   -> "추가 대미지" 리더 (초안 생성기가 원문의 `추가` 를 보고 달았다)
     그 밖                  -> 스킬 투사체 */
function hitDefFrom(hit, where) {
  const tags = [];
  for (const t of [].concat(hit.type || [])) {
    if (TAG_MAP[t]) tags.push(TAG_MAP[t]);
  }
  const kind = hit.gauge === false ? 'EXTRA'
    : hit.kind === 'burst' ? 'BURST_SKILL' : 'SKILL';
  if (kind === 'BURST_SKILL' && !tags.includes('BURST')) tags.push('BURST');
  return {
    coeffPct: (hit.ratio || 0) * 100,
    tags,
    kind,
    times: hit.times || 1,
    everySec: hit.every || 0,
    isCoreHit: hit.coreHit === true,
    ignoresDefense: [].concat(hit.type || []).includes('trueDmg'),
    chargesGauge: hit.gauge !== false,
  };
}

/* ── 규칙 하나 -> 효과 여럿 ───────────────────────────────── */

/* ID 는 규칙 자리에서 결정론적으로 만든다. 전역 카운터로 매기면 편성·레벨이 바뀔 때마다 ID 가 달라져 화면과 굳힌 파일이 안 맞는다. */
export function effectsFromRule(rule, ownerId) {
  const where = rule.where || `${ownerId} ?`;
  const triggers = [].concat(rule.on || ['battleStart']);
  const conditions = conditionsFrom(rule.when, where);
  const target = TARGET_MAP[rule.to || 'self'];
  if (!target) {
    throw new SimInputError(`옮길 수 없는 대상: '${rule.to}'`, { where, target: rule.to });
  }

  const out = [];
  for (const trig of triggers) {
    const triggerCode = TRIGGER_MAP[trig];
    if (!triggerCode) {
      throw new SimInputError(`옮길 수 없는 트리거: '${trig}'`, { where, trigger: trig });
    }
    const common = {
      targetRule: { typeCode: target, count: 1 },
      triggerRule: { typeCode: triggerCode, count: rule.count || 1 },
      conditions,
      intervalSec: rule.every > 0 && trig === 'interval' ? rule.every : null,
    };

    /* 상태 세우기·걷기 */
    if (rule.set || (rule.clear && rule.clear.length)) {
      out.push({
        id: `${where}#state@${trig}`,
        displayName: rule.note || where,
        ...common,
        setState: rule.set ? rule.set.state : null,
        setStateDurationSec: rule.set ? rule.set.duration : null,
        clearStates: rule.clear || [],
      });
    }

    /* 타격 */
    if (rule.hit) {
      out.push({
        id: `${where}#hit@${trig}`,
        displayName: rule.note || where,
        ...common,
        hitDef: hitDefFrom(rule.hit, where),
      });
    }

    /* 버프 — 한 규칙이 여러 스탯을 걸면 효과도 그만큼 는다 */
    for (const a of rule.apply || []) {
      const coreStat = STAT_MAP[a.stat];
      if (coreStat === undefined) {
        throw new SimInputError(`옮길 수 없는 능력치: '${a.stat}'`, { where, stat: a.stat });
      }
      if (coreStat === null) continue;   // 아직 모형 밖 — 이름은 표에 남아 있다
      out.push({
        id: `${where}#${a.stat}@${trig}${(rule.apply || []).filter(x => x.stat === a.stat).length > 1 ? ':' + (rule.apply || []).indexOf(a) : ''}`,
        displayName: rule.note || where,
        statCode: coreStat,
        value: valueFor(coreStat, a.value),
        /* 적에게 걸리는 스탯은 대상이 적이다 — 규칙의 `to` 와 무관하다. */
        targetRule: ENEMY_STATS.has(coreStat)
          ? { typeCode: 'enemy', count: 1 } : common.targetRule,
        triggerRule: common.triggerRule,
        conditions,
        intervalSec: common.intervalSec,
        /* 즉발은 버프로 살지 않는다 (버스트 게이지·쿨타임). */
        durationSec: a.instant ? Infinity : (a.duration == null ? Infinity : a.duration),
        stackLimit: rule.stack && rule.stack.max ? rule.stack.max : 1,
        stackingCode: rule.stack ? 'refresh' : 'replace',
        /* 장탄은 **계열별로** 따로 반올림해야 한다 (§9.5). 효과표의 `series` 가 그 계열이다. */
        ammoSeries: `${ownerId}:${a.series || a.stat}`,
        stateName: rule.set ? rule.set.state : (rule.stateName ?? null),
      });
    }
  }
  return out;
}

/* ── 무기 ─────────────────────────────────────────────────── */

/* CDN 의 `damage` 는 총구당 배율이다 (총구 둘이면 값이 정확히 절반). 분열(`shot_count`)은 대미지를 안 늘린다 — 곱하면 SG 가 다른 무기군의 14배가 된다.
   게이지는 반대로 발사체 하나하나가 센다 (메커니즘 4·13).
   그래서 `pelletCount: 1` · `muzzleCount: pellets` 로 넘긴다 — §14.6 의 "타격 계수 = 무기 계수 / pelletCount" 를 그대로 쓰면 총구당인 값을 또 나눈다. */
export function weaponFrom(shot) {
  const rof = shot.rof || {};
  const warmup = rof.perShot > 0 && rof.end > rof.start;
  return {
    weaponCode: shot.weapon,
    fireMode: shot.control === 'charge' ? 'charge' : (warmup ? 'auto_warmup' : 'auto'),
    damageCoeffPct: shot.damage,
    /* 제원의 RPM 을 초당 발수로. 예열 무기는 램프의 시작값이 실제 첫 발 속도다. */
    fireRatePerSec: Math.max(1e-6, (warmup ? rof.start : (rof.start || rof.end || 60)) / 60),
    warmupFireRateStartPerSec: (rof.start || 60) / 60,
    warmupFireRateEndPerSec: (rof.end || rof.start || 60) / 60,
    warmupStepPerShot: warmup ? rof.perShot / 60 : 0,
    magazineSize: shot.maxAmmo,
    reloadSec: shot.reload,
    reloadSegmentCount: shot.reloadSegmentCount || 1,
    pelletCount: 1,
    muzzleCount: shot.pellets || 1,
    projectilePerShot: shot.shotCount || 1,
    spreadDiameterPx: (shot.acc && shot.acc.end) || 100,
    coreMultiplierPct: shot.coreDamage || 200,
    fullChargeMultiplierPct: (shot.charge && shot.charge.fullDamage) || 100,
    chargeSec: (shot.charge && shot.charge.time) || 0,
    burstEnergyPerTargetShot: (shot.burstEnergy && shot.burstEnergy.perTargetShot) || 0,
    hitTags: [
      ...(shot.penetration > 0 ? ['PIERCE'] : []),
      ...(shot.explosionRange > 0 ? ['PROJECTILE'] : []),
    ],
  };
}

/* ── 니케 한 명 ───────────────────────────────────────────── */

export const ELEMENT_MAP = Object.freeze({
  Electronic: 'electric', Water: 'water', Fire: 'fire', Wind: 'wind', Iron: 'iron',
  전격: 'electric', 수냉: 'water', 작열: 'fire', 풍압: 'wind', 철갑: 'iron',
});

/* 장비 옵션·큐브·소장품의 고정 버프를 코어 어휘로. 장탄은 계열별로 따로 반올림해야 해서 스탯 합산과 갈라 낸다 (§9.5). */
export function staticStatsFrom(buffs = [], ammoSeries = {}) {
  const stats = {};
  const ammoPct = [];
  for (const b of buffs) {
    const coreStat = STAT_MAP[b.stat];
    if (!coreStat) continue;
    if (coreStat === 'maxAmmoPct') { ammoPct.push(b.value * 100); continue; }
    stats[coreStat] = (stats[coreStat] || 0) + valueFor(coreStat, b.value);
  }
  for (const key of Object.keys(ammoSeries || {})) {
    ammoPct.push((ammoSeries[key] || 0) * 100);
  }
  return { stats, ammoPct };
}

export function elementCodeOf(combat) {
  return ELEMENT_MAP[combat.element] || ELEMENT_MAP[(combat.shot || {}).attackType] || null;
}

/* `actor` 는 앱이 만드는 것 (`mekami.js` 의 `actorOf`).
   `reentryStage` 는 스킬 원문의 `[버스트 재진입 N단계]` 에서 나온다 (메커니즘 17). */
export function characterFrom(actor, { reentryStage = null } = {}) {
  const combat = actor.combat;
  const shot = combat.shot;
  const rules = (actor.effects && actor.effects.rules) || [];

  const effects = [];
  for (const rule of rules) {
    for (const e of effectsFromRule(rule, actor.id)) effects.push(e);
  }

  /* 장비·큐브·소장품이 남긴 고정 버프. 값은 비율이라 퍼센트 포인트로 올린다. */
  const staticStats = {};
  const staticAmmoPct = [];
  for (const b of actor.staticBuffs || []) {
    const coreStat = STAT_MAP[b.stat];
    if (!coreStat) continue;
    if (coreStat === 'maxAmmoPct') { staticAmmoPct.push(b.value * 100); continue; }
    staticStats[coreStat] = (staticStats[coreStat] || 0) + valueFor(coreStat, b.value);
  }
  for (const key of Object.keys(actor.staticAmmo || {})) {
    staticAmmoPct.push((actor.staticAmmo[key] || 0) * 100);
  }

  return {
    id: actor.id,
    displayName: actor.name || actor.id,
    elementCode: elementCodeOf(combat),
    burstStage: combat.burst === 'AllStep' ? 'AllStep' : String(combat.burst).replace('Step', ''),
    burstCooldownSec: actor.burstCooldown,
    burstDurationSec: combat.burstDuration || 10,
    burstGaugeReadyDelaySec: 2,
    reentryStage,
    baseAttack: actor.stats.atk,
    critRatePct: (combat.crit && combat.crit.rate) != null ? combat.crit.rate : 15,
    weapon: weaponFrom(shot),
    staticStats,
    staticAmmoPct,
    className: combat.class ?? null,
    company: combat.corporation ?? null,
    effects,
  };
}

/* 스쿼드 통째로. 옮기다 걸린 것은 버리지 않고 모아 올린다 — 화면이 "이 니케의 스킬 N개가 안 들어갔다" 를 말할 수 있어야 한다. */
export function squadFrom(actors, { reentryOf = () => null } = {}) {
  const characters = [];
  const problems = [];
  for (const actor of actors) {
    try {
      characters.push(characterFrom(actor, { reentryStage: reentryOf(actor) }));
    } catch (e) {
      problems.push(`${actor.name || actor.id}: ${e.message}`);
    }
  }
  return { characters, problems };
}
