/* EffectStore — 활성 효과의 등록·만료·중첩·대상 마스크·조건·주기 (§8, §11).

   활성 효과를 캐릭터마다 중복 보관하지 않고 여기가 중앙에서 들며, 대상은 `targetMask` 로 표현한다 (§4).
   `uid` 는 단조 증가 정수이고 배열 위치를 장기 식별자로 안 쓴다 (§8.1).
   후속 트리거는 재귀 호출하지 않고 이벤트 큐에 넣는다 — 자기를 다시 발동하는 경우에 대비해 프레임당 최대 처리 수를 둔다 (§8.2). */

import { StatCode, STAT_COUNT, StackingCode, TriggerCode } from './codes.js';

/* 적을 가리키는 대상 마스크. 캐릭터가 최대 5명이라 하위 5비트만 쓰므로 위쪽 한 비트를 표식으로 둔다 — 어떤 캐릭터에도 안 걸린다. */
export const ENEMY_MASK = 1 << 30;

export const MAX_EVENTS_PER_FRAME = 4096;

let nextUid = 1;
export function resetUid() { nextUid = 1; }

export class EffectStore {
  constructor(runtime) {
    this.runtime = runtime;
    this.active = [];
    /* 순회 중 배열을 직접 수정하지 않는다 (§11) — 지울 것은 여기 모았다가 뒤에 턴다. */
    this.pendingRemove = [];
  }

  /* ── 대상 (§8.3) ──────────────────────────────────────────

     동률은 스쿼드 순서로 결정한다. 무작위 대상은 시드 난수 생성기를 쓴다. */
  resolveTargetMask(effectDef, sourceIdx, battle) {
    const rt = this.runtime;
    const n = rt.charCount;
    const all = (1 << n) - 1;
    const rule = effectDef.targetTypeCode;

    switch (rule) {
      case 'self': return 1 << sourceIdx;
      case 'squad': return all;
      case 'allies': return all & ~(1 << sourceIdx);
      case 'burstCaster':
        return battle.lastBurstCasterIdx >= 0 ? (1 << battle.lastBurstCasterIdx) : 0;
      /* 적에게 거는 디버프. 스쿼드가 아니라 적 하나를 가리키므로 캐릭터 비트 대신 최상위 비트를 표식으로 둔다. */
      case 'enemy': return ENEMY_MASK;
      case 'alliesLowerDef': {
        let mask = 0;
        const mine = rt.chars[sourceIdx].baseAttack;
        for (let i = 0; i < n; i++) {
          if (i !== sourceIdx && rt.chars[i].baseAttack < mine) mask |= 1 << i;
        }
        return mask;
      }
      case 'burstUsersThisCycle': case 'nonBurstUsersThisCycle': {
        const want = rule === 'burstUsersThisCycle';
        let mask = 0;
        for (let i = 0; i < n; i++) if (battle.usedBurstThisCycle(i) === want) mask |= 1 << i;
        return mask;
      }
      case 'byWeapon': case 'byClass': case 'byCompany': case 'byElement': {
        const key = { byWeapon: 'weaponName', byClass: 'className',
                      byCompany: 'company', byElement: 'elementCode' }[rule];
        let mask = 0;
        for (let i = 0; i < n; i++) {
          const c = rt.chars[i];
          const value = key === 'weaponName' ? c.weapon.weaponName : c[key];
          if (value === effectDef.targetFilter) mask |= 1 << i;
        }
        return mask;
      }
      case 'highestAtk': case 'lowestAtk': case 'highestHp': case 'lowestHp': {
        const stat = rule.endsWith('Atk') ? 'atk' : 'hp';
        const order = [];
        for (let i = 0; i < n; i++) {
          order.push([i, stat === 'atk' ? battle.attackOf(i) : rt.chars[i].baseAttack]);
        }
        const desc = rule.startsWith('highest');
        /* 동률은 스쿼드 순서 — 안정 정렬이 필요하므로 인덱스를 2차 키로 둔다. */
        order.sort((a, b) => (desc ? b[1] - a[1] : a[1] - b[1]) || (a[0] - b[0]));
        let mask = 0;
        for (let k = 0; k < Math.min(effectDef.targetCount, n); k++) mask |= 1 << order[k][0];
        return mask;
      }
      case 'random': {
        const pool = [];
        for (let i = 0; i < n; i++) pool.push(i);
        let mask = 0;
        const take = Math.min(effectDef.targetCount, n);
        for (let k = 0; k < take; k++) {
          const pick = Math.floor(battle.rng.next() * pool.length);
          mask |= 1 << pool.splice(pick, 1)[0];
        }
        return mask;
      }
      default: return 1 << sourceIdx;
    }
  }

  /* ── 런타임 조건 (§8.4) ──────────────────────────────────

     이벤트가 발생한 시점에 다시 평가한다. "현재 탄약이 절반 이하" 를 등록 시점에 한 번만 계산하면 영영 그때의 답을 쓴다. */
  meetsConditions(effectDef, sourceIdx, battle) {
    for (const cond of effectDef.conditions) {
      if (!this.meetsOne(cond, sourceIdx, battle)) return false;
    }
    return true;
  }

  meetsOne(cond, sourceIdx, battle) {
    const rt = this.runtime;
    const want = cond.value;
    switch (cond.typeCode) {
      case 'inFullBurst': return battle.inFullBurst === !!want;
      case 'ammoAtMostRatio':
        return rt.ammo[sourceIdx] <= rt.maxAmmo[sourceIdx] * want;
      case 'ammoAtLeastRatio':
        return rt.ammo[sourceIdx] >= rt.maxAmmo[sourceIdx] * want;
      /* AllStep 과 재진입 니케는 그 단계에 **없는 것으로 판정한다** (메커니즘 18).
         라피 : 레드후드가 "1버스트 니케가 없을 때에만 1버스트로 동작" 하는 조건이 이것을
         탄다 — 아비스타(재진입)와 레드 후드(AllStep)는 그 자리를 안 채운다. */
      case 'squadHasStage': return battle.baseStageCount(String(want)) > 0;
      case 'squadLacksStage': return battle.baseStageCount(String(want)) === 0;
      case 'usedStage': return battle.lastUsedStageOf(sourceIdx) === String(want);
      case 'hasState': return battle.hasState(sourceIdx, want);
      case 'notState': return !battle.hasState(sourceIdx, want);
      case 'timeAfterSec': return battle.nowSec >= want;
      case 'always': return true;
      case 'squadHasWeapon': return battle.squadHasWeapon(want);
      case 'burstUsedThisCycle': return battle.usedBurstThisCycle(sourceIdx) === !!want;
      case 'stacksAtMax': return battle.stacksOf(sourceIdx, cond.effectId) >= (cond.max || 1);
      case 'hasStacks': return battle.stacksOf(sourceIdx, cond.effectId) > 0;
      case 'enemyState': return battle.hasEnemyState(want);
      default:
        throw new Error(`알 수 없는 조건: '${cond.typeCode}'`);
    }
  }

  /* ── 등록 (§8.2) ─────────────────────────────────────────

     1. 발동 조건 확인  2. 대상 결정  3. 중첩 규칙  4. 등록
     5. 파생 캐시 무효화  6. 로그  7. 후속 트리거를 큐에 */
  apply(effectDef, sourceIdx, frameIdx, battle) {
    if (!this.meetsConditions(effectDef, sourceIdx, battle)) return null;

    const targetMask = this.resolveTargetMask(effectDef, sourceIdx, battle);
    if (!targetMask) return null;

    const durationFrames = effectDef.durationSec === Infinity
      ? Infinity
      : Math.round(effectDef.durationSec * this.runtime.options.frameRate);
    const endFrame = durationFrames === Infinity ? Infinity : frameIdx + durationFrames;

    const existing = this.active.find(
      a => a.effectDef === effectDef && a.sourceIdx === sourceIdx && !a.dead);

    if (existing) {
      switch (effectDef.stackingCode) {
        case StackingCode.refresh:
          existing.endFrame = endFrame;
          existing.stackCount = Math.min(effectDef.stackLimit, existing.stackCount + 1);
          break;
        case StackingCode.extend:
          existing.endFrame = existing.endFrame === Infinity
            ? Infinity : existing.endFrame + durationFrames;
          existing.stackCount = Math.min(effectDef.stackLimit, existing.stackCount + 1);
          break;
        case StackingCode.replace:
          existing.dead = true;
          this.pendingRemove.push(existing);
          break;
        case StackingCode.independent:
        default:
          break;
      }
      if (effectDef.stackingCode === StackingCode.refresh
          || effectDef.stackingCode === StackingCode.extend) {
        this.invalidate(existing.targetMask);
        battle.log('effectApply', frameIdx, sourceIdx, existing);
        return existing;
      }
    }

    /* independent 는 중첩 한도까지 따로 산다 */
    if (effectDef.stackingCode === StackingCode.independent) {
      const live = this.active.filter(
        a => a.effectDef === effectDef && a.sourceIdx === sourceIdx && !a.dead).length;
      if (live >= effectDef.stackLimit) return null;
    }

    const entry = {
      uid: nextUid++,
      effectDef,
      sourceIdx,
      targetMask,
      startFrame: frameIdx,
      endFrame,
      stackCount: 1,
      triggerCount: 0,
      nextIntervalFrame: effectDef.intervalSec > 0
        ? frameIdx + Math.round(effectDef.intervalSec * this.runtime.options.frameRate)
        : -1,
      dead: false,
      /* "시전자 기준 공격력 N%" 는 걸 때 재서 박는다. 시전자의 공격력에 비례하므로 최종 공격력으로 재면 서로를 키우는 되먹임이 생긴다.
         1세대가 164초에 63배까지 갔던 자리다. */
      frozenValue: effectDef.statCode === StatCode.atkFromCaster
        ? battle.attackOf(sourceIdx) * (effectDef.value / 100)
        : null,
    };
    this.active.push(entry);
    this.invalidate(targetMask);
    battle.log('effectApply', frameIdx, sourceIdx, entry);
    battle.queueTrigger(TriggerCode.buffApplied, sourceIdx);
    return entry;
  }

  /* ── 만료 (§8.2) ─────────────────────────────────────────

     1. 만료 직전 주기 효과 처리  2. 제거  3. 캐시 무효화  4. 로그  5. 만료 트리거

     동일 프레임에 지속 피해 만료와 주기 피해 시점이 겹치면 **마지막 주기 피해가 먼저**
     발생한다 (§5). */
  tick(frameIdx, battle) {
    for (let i = 0; i < this.active.length; i++) {
      const a = this.active[i];
      if (a.dead) continue;

      /* 주기 피해를 먼저 */
      if (a.nextIntervalFrame >= 0 && frameIdx >= a.nextIntervalFrame) {
        battle.fireIntervalEffect(a, frameIdx);
        a.nextIntervalFrame = frameIdx
          + Math.round(a.effectDef.intervalSec * this.runtime.options.frameRate);
      }

      if (a.endFrame !== Infinity && frameIdx >= a.endFrame) {
        /* 만료 직전 주기 효과 — 같은 프레임에 겹치면 위에서 이미 돌았다 */
        a.dead = true;
        this.pendingRemove.push(a);
        this.invalidate(a.targetMask);
        battle.log('effectExpire', frameIdx, a.sourceIdx, a);
        battle.queueTrigger(TriggerCode.buffExpired, a.sourceIdx);
      }
    }
    this.sweep();
  }

  sweep() {
    if (!this.pendingRemove.length) return;
    this.active = this.active.filter(a => !a.dead);
    this.pendingRemove.length = 0;
  }

  /* 이름 붙은 상태를 통째로 걷는다 (효과표의 `[취기]`). 그 상태가 낳은 버프도 같이 사라져야 조건이 꺼진 뒤 효과가 안 산다. */
  dropByState(stateName, frameIdx, battle) {
    let dropped = 0;
    for (const a of this.active) {
      if (a.dead || a.effectDef.stateName !== stateName) continue;
      a.dead = true;
      this.pendingRemove.push(a);
      this.invalidate(a.targetMask);
      battle.log('effectExpire', frameIdx, a.sourceIdx, a);
      dropped++;
    }
    this.sweep();
    return dropped;
  }

  /* ── 파생 능력치 (§11) ───────────────────────────────────

     버프 목록이 바뀌면 버전을 올린다. 캐시에는 계산 당시 버전을 함께 저장하고, 버전이
     다를 때만 다시 계산한다. */
  invalidate(targetMask) {
    for (let i = 0; i < this.runtime.charCount; i++) {
      if (targetMask & (1 << i)) this.runtime.statsVersion[i]++;
    }
  }

  invalidateAll() {
    for (let i = 0; i < this.runtime.charCount; i++) this.runtime.statsVersion[i]++;
  }

  statsFor(charIdx) {
    const rt = this.runtime;
    if (rt.cachedVersion[charIdx] === rt.statsVersion[charIdx]) {
      return rt.cachedStats.subarray(charIdx * STAT_COUNT, (charIdx + 1) * STAT_COUNT);
    }
    const out = rt.cachedStats.subarray(charIdx * STAT_COUNT, (charIdx + 1) * STAT_COUNT);
    const base = rt.baseStats.subarray(charIdx * STAT_COUNT, (charIdx + 1) * STAT_COUNT);
    out.set(base);
    for (const a of this.active) {
      if (a.dead) continue;
      if (!(a.targetMask & (1 << charIdx))) continue;
      const def = a.effectDef;
      if (def.statCode < 0) continue;
      if (def.statCode === StatCode.atkFromCaster) {
        out[StatCode.atkFlat] += a.frozenValue * a.stackCount;
        continue;
      }
      out[def.statCode] += def.value * a.stackCount;
    }
    rt.cachedVersion[charIdx] = rt.statsVersion[charIdx];
    return out;
  }

  /* 장탄은 **원천별로** 기본 장탄에 걸고 따로 반올림해야 하므로 스탯 합산과 따로 센다
     (§9.5). 계열별 증가율 목록을 낸다. */
  ammoPctList(charIdx) {
    const out = [...this.runtime.chars[charIdx].staticAmmoPct];
    const bySeries = new Map();
    for (const a of this.active) {
      if (a.dead) continue;
      if (a.effectDef.statCode !== StatCode.maxAmmoPct) continue;
      if (!(a.targetMask & (1 << charIdx))) continue;
      const key = a.effectDef.ammoSeries;
      bySeries.set(key, (bySeries.get(key) || 0) + a.effectDef.value * a.stackCount);
    }
    for (const v of bySeries.values()) out.push(v);
    return out;
  }

  /* 버프 인스펙터가 읽는 한 줄.

     **스탯 이름과 실효 수치를 제 이름으로 낸다.** 화면은 줄을 스탯별로 묶어 합계를
     내고 겹친 줄을 출처와 함께 펴는데, 여기서 이름과 수치를 바꿔 담으면 "공격력
     +180% 가 한 줄인지 다섯 줄이 겹친 것인지" 를 못 읽는다.

     `source` 는 **규칙 자리**(`c016 s1[2]`)여야 한다 — 화면이 그걸로 니케·스킬
     이름을 풀고 해석 메모를 툴팁에 붙인다. */
  snapshot(charIdx) {
    const out = [];
    for (const a of this.active) {
      if (a.dead || !(a.targetMask & (1 << charIdx))) continue;
      const def = a.effectDef;
      /* 시전자 기준 공격력은 걸 때 재서 박은 고정 가산이라 화면에도 그 수를 낸다 — 퍼센트로 보여 주면 누구에게 걸렸든 같은 값이 된다. */
      const isCasterAtk = def.statCode === StatCode.atkFromCaster;
      out.push({
        uid: a.uid,
        effectId: def.id,
        statCode: isCasterAtk ? StatCode.atkFlat : def.statCode,
        value: (isCasterAtk ? a.frozenValue : def.value) * a.stackCount,
        source: def.source || def.id,
        note: def.note || def.displayName || null,
        displayName: def.displayName,
        sourceId: this.runtime.charIdByIndex[a.sourceIdx],
        stackCount: a.stackCount,
        endFrame: a.endFrame,
      });
    }
    return out;
  }
}
