/* BattleLoop — 프레임 진행과 구성 요소 호출 순서 보장 (§5), 그리고 공개 API (§2).

     const result = simulateBattle({ characters, target, options, controlEvents, rngSeed });

   입력 객체를 안 바꾸고 새 결과 객체를 돌려준다. 같은 입력·같은 시드면 같은 결과다 (§2, §17).
   DOM 을 안 보므로 메인 스레드·Web Worker·단위 테스트에서 같은 코드가 돈다.

   한 프레임의 순서는 고정이다 (§5):
     1. 주기 피해 -> 만료·주기 트리거
     2. 게이지·단계 전환·풀 버스트 진입/종료
     3. 스쿼드 순서대로 무기·캐릭터
     4. 예약된 결과 반영 (타격 -> 즉시 효과 -> 회복·보호막 -> 로그) */

import {
  StatCode, HitTag, HitKind, StateFlag, TriggerCode, TRIGGER_COUNT, ActionCode,
  hasElementAdvantage, SimInputError,
} from './codes.js';
import {
  normalizeSimOptions, normalizeTarget, createRng, frameToSec,
} from './normalize.js';
import { compileRuntime, hasFlag, setFlag } from './runtime.js';
import { EffectStore, MAX_EVENTS_PER_FRAME, resetUid, ENEMY_MASK } from './effect-store.js';
import { WeaponSystem } from './weapon.js';
import { BurstSystem, STAGES, occupiesStage } from './burst.js';
import { ResultWriter, HitFlag } from './result.js';
import {
  calcHitDamage, hitCoeffPct, hitsPerShot, statAt, ProbabilityAccumulator, pct,
} from './damage.js';

/* 화면이 비중 막대를 칠할 때 쓰는 이름. 원문이 그 타격을 무엇이라고 부르는가다
   (메커니즘 8) — "평타냐 스킬이냐" 로 가르는 표가 아니다. */
const KIND_NAME = {
  [HitKind.NORMAL]: '평타',
  [HitKind.BURST_SKILL]: '버스트스킬',
  [HitKind.EXTRA]: '추가',
  [HitKind.SKILL]: '스킬',
};

class BattleLoop {
  constructor({ characters, target, options, controlEvents }) {
    resetUid();
    this.options = normalizeSimOptions(options);
    this.target = normalizeTarget(target);
    this.runtime = compileRuntime({
      characters, target: this.target, options: this.options, controlEvents,
    });

    this.rng = createRng(this.options.rngSeed);
    this.effects = new EffectStore(this.runtime);
    this.weapons = new WeaponSystem(this.runtime, this.effects, this);
    this.burst = new BurstSystem(this.runtime, this.effects, this);
    this.writer = new ResultWriter(this.runtime);
    this.accumulator = new ProbabilityAccumulator();

    this.frameIdx = 0;
    this.nowSec = 0;
    this.framesProcessed = 0;
    this.fullBurstFrames = 0;
    this.totalGaugeCharged = 0;
    this.states = this.runtime.chars.map(() => new Map());
    this.enemyStates = new Map();
    this.lastUsedStage = new Array(this.runtime.charCount).fill(null);

    this.counters = this.runtime.chars.map(() => ({
      damage: 0, normalDamage: 0, shotCount: 0, hitCount: 0,
      critHitCount: 0, coreHitCount: 0, reloadCount: 0, burstCount: 0,
      gaugeCharged: 0, gaugeByNormal: 0, gaugeBySkill: 0,
      damageBySource: Object.create(null),
      /* 타격 종류별 누적 (§12.1 의 normal/skill 을 원문 선언 단위로 더 가른다).
         화면의 비중 막대가 이 넷으로 칠해진다. */
      damageByKind: Object.create(null),
    }));

    /* 같은 프레임의 이벤트는 재사용 FIFO 큐로 직렬화한다 (§11). 헤드 인덱스를 옮기고 `shift()` 를 안 쓴다. */
    this.queueType = [];
    this.queueChar = [];
    this.queuePayload = [];
    this.queueHead = 0;

    this.pendingHits = [];
    this.controlHead = 0;
  }

  get inFullBurst() { return this.burst.inFullBurst; }
  get lastBurstCasterIdx() { return this.burst.lastCasterIdx; }

  log(type, frameIdx, charIdx, payload) {
    this.writer.writeEvent(type, frameIdx, charIdx, payload);
  }

  hasState(charIdx, name) { return this.states[charIdx].has(name); }
  hasEnemyState(name) { return this.enemyStates.has(name); }
  usedBurstThisCycle(charIdx) {
    return hasFlag(this.runtime, charIdx, StateFlag.BURST_CASTED);
  }
  squadHasWeapon(weaponName) {
    return this.runtime.chars.some(c => c.weapon.weaponName === weaponName);
  }
  /* 니케에게 걸린 효과별 중첩 수. 한 겹뿐인 것은 뺀다 — 화면이 세팅 버프로 도배된다. */
  stackCounts(charIdx) {
    const out = Object.create(null);
    for (const a of this.effects.active) {
      if (a.dead || !(a.targetMask & (1 << charIdx))) continue;
      if (a.stackCount <= 1) continue;
      const key = a.effectDef.note || a.effectDef.displayName || a.effectDef.id;
      out[key] = (out[key] || 0) + a.stackCount;
    }
    return out;
  }

  stacksOf(charIdx, effectId) {
    let n = 0;
    for (const a of this.effects.active) {
      if (a.dead || a.effectDef.id !== effectId) continue;
      if (!(a.targetMask & (1 << charIdx))) continue;
      n += a.stackCount;
    }
    return n;
  }

  /* ── 이름 붙은 상태 ──────────────────────────────────────

     효과표는 스킬 원문의 `[취기 : ~]` 같은 선언을 상태로 옮겨 적는다. 상태가 걷히면
     **그 상태가 낳은 버프도 같이 걷힌다** — 상태만 지우고 버프를 남기면 조건이 꺼진
     뒤에도 효과가 산다. */
  setState(charIdx, name, durationSec) {
    const until = durationSec == null || !(durationSec > 0)
      ? Infinity
      : this.frameIdx + Math.round(durationSec * this.options.frameRate);
    this.states[charIdx].set(name, until);
    this.log('stateOn', this.frameIdx, charIdx, { state: name, untilFrame: until });
  }

  clearState(charIdx, name) {
    if (!this.states[charIdx].delete(name)) return;
    const dropped = this.effects.dropByState(name, this.frameIdx, this);
    this.log('stateOff', this.frameIdx, charIdx, { state: name, buffsDropped: dropped });
  }

  tickStates(frameIdx) {
    for (let i = 0; i < this.runtime.charCount; i++) {
      for (const [name, until] of this.states[i]) {
        if (until !== Infinity && frameIdx >= until) this.clearState(i, name);
      }
    }
  }
  lastUsedStageOf(charIdx) { return this.lastUsedStage[charIdx]; }
  baseStageCount(stage) { return this.burst.baseStageCount(stage); }

  attackOf(charIdx) {
    const stats = this.effects.statsFor(charIdx);
    const base = this.runtime.chars[charIdx].baseAttack;
    return base * (1 + pct(stats[StatCode.atkPct])) + stats[StatCode.atkFlat];
  }

  /* ── 트리거 (§8.4, §11) ─────────────────────────────────

     후속 트리거는 **재귀 호출하지 않고** 큐에 넣는다. 한 효과가 자신을 다시 발동하는
     경우를 대비해 프레임당 최대 처리 이벤트 수를 둔다 (§8.2). */
  queueTrigger(triggerCode, charIdx, payload = null) {
    this.queueType.push(triggerCode);
    this.queueChar.push(charIdx);
    this.queuePayload.push(payload);
  }

  drainTriggers() {
    let processed = 0;
    while (this.queueHead < this.queueType.length) {
      if (++processed > MAX_EVENTS_PER_FRAME) {
        this.writer.warn(
          `프레임 ${this.frameIdx}: 한 프레임의 이벤트가 ${MAX_EVENTS_PER_FRAME} 을 넘어 잘렸습니다`);
        break;
      }
      const i = this.queueHead++;
      this.runTrigger(this.queueType[i], this.queueChar[i], this.queuePayload[i]);
    }
    this.queueType.length = 0;
    this.queueChar.length = 0;
    this.queuePayload.length = 0;
    this.queueHead = 0;
  }

  runTrigger(triggerCode, actorIdx, payload) {
    const rt = this.runtime;
    if (actorIdx >= 0) {
      rt.triggerCounters[actorIdx * TRIGGER_COUNT + triggerCode]++;
    }
    for (let i = 0; i < rt.charCount; i++) {
      for (const def of rt.chars[i].effects) {
        if (def.triggerCode !== triggerCode) continue;
        /* 자기 자신에게 걸린 트리거만 본다. 스쿼드 전체가 세는 것은 별도 코드다. */
        if (triggerCode !== TriggerCode.squadHitCount && i !== actorIdx
            && triggerCode !== TriggerCode.fullBurstStart
            && triggerCode !== TriggerCode.fullBurstEnd
            && triggerCode !== TriggerCode.battleStart) continue;
        /* N회 명중류는 횟수를 채워야 발동한다 */
        if (def.triggerCount > 1) {
          const count = rt.triggerCounters[i * TRIGGER_COUNT + triggerCode];
          if (count % def.triggerCount !== 0) continue;
        }
        this.applyEffectDef(def, i, payload);
      }
    }
  }

  applyEffectDef(def, sourceIdx, payload) {
    /* 상태 조작이 먼저다 — 한 규칙이 상태를 세우고 그 상태를 조건으로 쓰는 일이 있어, 뒤집히면 첫 프레임에 조건이 안 맞는다. */
    if (def.setState || def.clearStates.length) {
      if (!this.effects.meetsConditions(def, sourceIdx, this)) return;
      for (const name of def.clearStates) this.clearState(sourceIdx, name);
      if (def.setState) this.setState(sourceIdx, def.setState, def.setStateDurationSec);
      if (def.statCode < 0 && !def.hitDef) return;
    }
    if (def.hitDef) {
      if (!this.effects.meetsConditions(def, sourceIdx, this)) return;
      this.scheduleSkillHits(def, sourceIdx);
      if (def.statCode < 0) return;
    }
    /* 즉발 자원 (버스트 게이지·쿨타임·탄약) 은 버프로 살지 않고 그 자리에서 쓴다 */
    if (def.statCode === StatCode.burstGaugePct && def.durationSec === Infinity) {
      this.burst.chargePct(sourceIdx, def.value);
      return;
    }
    this.effects.apply(def, sourceIdx, this.frameIdx, this);
  }

  /* ── 스킬 타격 ───────────────────────────────────────────

     `times`/`everySec` 로 펴 놓은 지속 타격 (슈팅 스타의 별사탕 40대 등) 은 미래
     프레임에 예약한다. */
  scheduleSkillHits(def, sourceIdx) {
    const h = def.hitDef;
    const o = this.options;
    for (let n = 0; n < h.times; n++) {
      const delayFrames = h.everySec > 0 ? Math.round(h.everySec * n * o.frameRate) : 0;
      if (delayFrames === 0) {
        this.pendingHits.push({ def, sourceIdx, hitDef: h });
      } else {
        this.futureHits.push({ frame: this.frameIdx + delayFrames, def, sourceIdx, hitDef: h });
      }
    }
  }

  /* ── 평타 (§9.2, §14.6) ────────────────────────────────── */
  emitNormalHits(charIdx, frameIdx, chargeRatio) {
    const rt = this.runtime;
    const w = rt.chars[charIdx].weapon;
    const coeffPct = hitCoeffPct(w.damageCoeffPct, w.pelletCount);
    const hits = hitsPerShot(w.pelletCount, w.muzzleCount);
    const coreProbability = this.weapons.coreProbability(charIdx);
    const inOptimalRange = w.optimalRange != null
      && (this.target.engagementRange === w.optimalRange
          || this.target.optimalRangeWeaponCodes.includes(w.weaponName));

    let tagMask = w.hitTagMask;
    if (this.target.hasParts) tagMask |= HitTag.PART;
    if (this.target.hasBlockPart) tagMask |= HitTag.BLOCK;

    for (let n = 0; n < hits; n++) {
      this.pendingHits.push({
        sourceIdx: charIdx,
        hitDef: {
          coeffPct, tagMask, kind: HitKind.NORMAL, isCoreHit: false,
          ignoresDefense: false, chargesGauge: true,
        },
        isNormal: true,
        inOptimalRange,
        coreProbability,
        isFullCharge: w.fireMode === 'charge',
        chargeRatio,
        fullChargeMultiplierPct: w.fullChargeMultiplierPct,
        coreMultiplierPct: w.coreMultiplierPct,
        source: '평타',
      });
    }

    /* 게이지는 발사체마다 센다 — 분열탄은 대미지를 안 늘리되 게이지는 조각 수만큼 채운다 (메커니즘 4·12·13). 차지 여부는 무관하다. */
    const projectiles = w.projectilePerShot * w.muzzleCount;
    this.burst.charge(charIdx, w.burstEnergyPerTargetShot * projectiles, 'normal');
  }

  /* ── 타격 반영 (§5 4단계) ───────────────────────────────── */
  commitHits(frameIdx) {
    const rt = this.runtime;
    const expected = this.options.rngMode === 'expected';

    for (const p of this.pendingHits) {
      const charIdx = p.sourceIdx;
      const char = rt.chars[charIdx];
      const stats = this.effects.statsFor(charIdx);
      const h = p.hitDef;

      const critProbability = Math.min(1, Math.max(0,
        stats[StatCode.critRatePct] / 100));
      const coreProbability = p.coreProbability != null
        ? p.coreProbability
        : (h.isCoreHit ? 1 : 0);

      let isCrit = false, isCore = false;
      if (!expected) {
        isCrit = this.rng.next() < critProbability;
        isCore = coreProbability >= 1 ? true : this.rng.next() < coreProbability;
      }

      const hit = {
        coeffPct: h.coeffPct,
        tagMask: h.tagMask,
        isNormal: !!p.isNormal,
        isCrit, isCore,
        critProbability, coreProbability,
        inOptimalRange: !!p.inOptimalRange,
        isFullCharge: !!p.isFullCharge,
        chargeRatio: p.chargeRatio == null ? 1 : p.chargeRatio,
        ignoresDefense: !!h.ignoresDefense,
        coreMultiplierPct: p.coreMultiplierPct == null
          ? char.weapon.coreMultiplierPct : p.coreMultiplierPct,
        fullChargeMultiplierPct: p.fullChargeMultiplierPct == null
          ? char.weapon.fullChargeMultiplierPct : p.fullChargeMultiplierPct,
        hasElementAdvantage: hasElementAdvantage(char.elementCode, this.target.elementCode),
      };

      /* 있을 수 없는 조합 — 버스트 스킬 본체가 풀 버스트 중에 판정됐다 (메커니즘 10).
         순서를 어기면 조용히 1.5배가 붙으므로 짚는다. */
      if (h.kind === HitKind.BURST_SKILL && this.inFullBurst) {
        this.writer.warn(`${char.displayName}: 버스트 스킬 본체가 풀 버스트 중에 `
          + '판정됐습니다 — 순서가 어긋났습니다');
      }

      const damage = calcHitDamage(
        hit,
        { baseAttack: char.baseAttack, stats },
        { defense: this.target.defense, stats: this.targetStats() },
        { rngMode: this.options.rngMode, inFullBurst: this.inFullBurst },
      );

      const c = this.counters[charIdx];
      c.damage += damage;
      c.hitCount++;
      if (p.isNormal) c.normalDamage += damage;
      const source = p.source || (p.def ? p.def.displayName : '스킬');
      c.damageBySource[source] = (c.damageBySource[source] || 0) + damage;
      const kindName = KIND_NAME[h.kind] || '스킬';
      c.damageByKind[kindName] = (c.damageByKind[kindName] || 0) + damage;

      let flags = 0;
      if (p.isNormal) flags |= HitFlag.NORMAL;
      if (hit.isFullCharge) flags |= HitFlag.FULL_CHARGE;
      if (this.inFullBurst) flags |= HitFlag.FULL_BURST;

      /* 기대값 모드에서도 **발동 횟수는 정수**여야 하므로 누산기로 센다 (§7.3). */
      if (expected) {
        if (this.accumulator.add(`${charIdx}:crit`, critProbability)) {
          c.critHitCount++; this.queueTrigger(TriggerCode.critHit, charIdx);
        }
        if (this.accumulator.add(`${charIdx}:core`, coreProbability)) {
          c.coreHitCount++; this.queueTrigger(TriggerCode.coreHit, charIdx);
        }
      } else {
        if (isCrit) { c.critHitCount++; flags |= HitFlag.CRIT; this.queueTrigger(TriggerCode.critHit, charIdx); }
        if (isCore) { c.coreHitCount++; flags |= HitFlag.CORE; this.queueTrigger(TriggerCode.coreHit, charIdx); }
      }

      this.writer.writeHit(frameIdx, charIdx, damage, flags, h.tagMask, null);

      if (p.isNormal) this.queueTrigger(TriggerCode.normalHit, charIdx);
      this.queueTrigger(TriggerCode.hitCount, charIdx);
      this.queueTrigger(TriggerCode.squadHitCount, charIdx);
      if (hit.isFullCharge) this.queueTrigger(TriggerCode.fullChargeHit, charIdx);

      /* 스킬 투사체도 게이지를 채운다 (메커니즘 4). "추가 대미지" 는 이미 나간 총알에 얹히는 판정이라 안 채운다. */
      if (!p.isNormal && h.chargesGauge) {
        this.burst.charge(charIdx, rt.chars[charIdx].weapon.burstEnergyPerTargetShot, 'skill');
      }
    }
    this.pendingHits.length = 0;
  }

  targetStats() {
    if (!this._targetStats) {
      this._targetStats = new Float64Array(
        Object.keys(StatCode).length);
    }
    /* 적에게 걸린 디버프 — 누구에게 걸려 있든 적이 받는 값이다. 대상 마스크가 0 인 효과를 여기 모은다. */
    const out = this._targetStats;
    out.fill(0);
    for (const a of this.effects.active) {
      if (a.dead) continue;
      if (!(a.targetMask & ENEMY_MASK)) continue;
      const code = a.effectDef.statCode;
      if (code < 0) continue;
      out[code] += a.effectDef.value * a.stackCount;
    }
    return out;
  }

  countGaugeContribution(charIdx, applied, source) {
    const c = this.counters[charIdx];
    c.gaugeCharged += applied;
    if (source === 'normal') c.gaugeByNormal += applied;
    else c.gaugeBySkill += applied;
    this.totalGaugeCharged += applied;
  }

  /* ── 이벤트 훅 ──────────────────────────────────────────── */

  onLastBullet(charIdx, frameIdx) { this.queueTrigger(TriggerCode.lastBullet, charIdx); }
  onAmmoCharge(charIdx, frameIdx) { this.queueTrigger(TriggerCode.ammoCharge, charIdx); }

  onReloadStart(charIdx, frameIdx) {
    this.log('reloadStart', frameIdx, charIdx, {});
    this.queueTrigger(TriggerCode.reloadStart, charIdx);
  }

  onReloadDone(charIdx, frameIdx) {
    this.log('reloadDone', frameIdx, charIdx, { ammo: this.runtime.ammo[charIdx] });
    this.queueTrigger(TriggerCode.reloadDone, charIdx);
  }

  onBurstUse(charIdx, stage, frameIdx) {
    setFlag(this.runtime, charIdx, StateFlag.BURST_CASTED, true);
    this.lastUsedStage[charIdx] = stage;
    this.counters[charIdx].burstCount++;
    this.queueTrigger(TriggerCode.burstUse, charIdx);
    this.stageJustEntered = stage;
    this.queueTrigger(TriggerCode.burstStageEnter, charIdx);
    /* 버스트 스킬 본체는 여기서 나간다 — **풀 버스트가 열리기 전**이다 (메커니즘 10). */
    this.drainTriggers();
    this.commitHits(frameIdx);
  }

  onFullBurst(on, frameIdx) {
    this.log(on ? 'fullBurstStart' : 'fullBurstEnd', frameIdx, -1, {});
    this.queueTrigger(on ? TriggerCode.fullBurstStart : TriggerCode.fullBurstEnd, -1);
    this.drainTriggers();
    if (!on) {
      for (let i = 0; i < this.runtime.charCount; i++) {
        setFlag(this.runtime, i, StateFlag.BURST_CASTED, false);
      }
    }
  }

  fireIntervalEffect(entry, frameIdx) {
    if (entry.effectDef.hitDef) {
      this.pendingHits.push({
        def: entry.effectDef, sourceIdx: entry.sourceIdx, hitDef: entry.effectDef.hitDef,
      });
    }
  }

  /* ── 조작 (§9.7) ─────────────────────────────────────────

     엄폐 진입은 한 프레임을 소비한다. */
  applyControlEvents(frameIdx) {
    const list = this.runtime.controlEvents;
    while (this.controlHead < list.length && list[this.controlHead].frame <= frameIdx) {
      const ev = list[this.controlHead++];
      const ws = this.runtime.weaponStates[ev.charIdx];
      switch (ev.action) {
        case ActionCode.fireHold: ws.firing = true; break;
        case ActionCode.fireRelease: ws.firing = false; break;
        case ActionCode.fireTap:
          ws.firing = true; ws.nextShotFrame = frameIdx; break;
        case ActionCode.reload: this.weapons.startReload(ev.charIdx, frameIdx); break;
        case ActionCode.reloadCancel: this.weapons.cancelReload(ev.charIdx, frameIdx); break;
        case ActionCode.coverOn:
          setFlag(this.runtime, ev.charIdx, StateFlag.IN_COVER, true);
          ws.nextShotFrame = Math.max(ws.nextShotFrame, frameIdx + 1);
          break;
        case ActionCode.coverOff:
          setFlag(this.runtime, ev.charIdx, StateFlag.IN_COVER, false); break;
        case ActionCode.chargeStart:
          ws.chargeStartFrame = frameIdx;
          setFlag(this.runtime, ev.charIdx, StateFlag.CHARGING, true); break;
        case ActionCode.fire:
          if (ws.chargeStartFrame >= 0) {
            const w = this.runtime.chars[ev.charIdx].weapon;
            const heldSec = (frameIdx - ws.chargeStartFrame) / this.options.frameRate;
            const ratio = w.chargeSec > 0 ? Math.min(1, heldSec / w.chargeSec) : 1;
            ws.chargeStartFrame = -1;
            setFlag(this.runtime, ev.charIdx, StateFlag.CHARGING, false);
            this.weapons.fireOnce(ev.charIdx, frameIdx, ratio);
          }
          break;
        default: break;
      }
      this.log('control', frameIdx, ev.charIdx, { action: ev.action });
    }
  }

  /* ── 실행 (§5) ─────────────────────────────────────────── */
  run() {
    const o = this.options;
    const rt = this.runtime;
    this.futureHits = [];

    /* 초기화 도중 발생한 효과도 로그에 포함한다 (§4). */
    this.effects.invalidateAll();
    this.queueTrigger(TriggerCode.battleStart, -1);
    this.drainTriggers();
    this.commitHits(0);

    const sampleFrames = o.sampleIntervalSec > 0
      ? Math.max(1, Math.round(o.sampleIntervalSec * o.frameRate)) : 0;

    for (let frameIdx = 0; frameIdx < o.totalFrames; frameIdx++) {
      this.frameIdx = frameIdx;
      this.nowSec = frameToSec(frameIdx, o.frameRate);

      /* 1. 주기 피해를 먼저 발생시키고, 그 다음 만료와 주기 트리거를 처리한다 */
      this.effects.tick(frameIdx, this);
      this.tickStates(frameIdx);
      if (this.futureHits.length) {
        const due = this.futureHits.filter(f => f.frame <= frameIdx);
        if (due.length) {
          this.futureHits = this.futureHits.filter(f => f.frame > frameIdx);
          for (const f of due) {
            this.pendingHits.push({ def: f.def, sourceIdx: f.sourceIdx, hitDef: f.hitDef });
          }
        }
      }

      /* 2. 게이지, 단계 전환, 풀 버스트 진입·종료 */
      this.burst.tick(frameIdx);
      if (this.burst.inFullBurst) this.fullBurstFrames++;

      /* 3. 조작 -> 스쿼드 순서대로 무기와 캐릭터 상태 */
      this.applyControlEvents(frameIdx);
      for (let charIdx = 0; charIdx < rt.charCount; charIdx++) {
        this.weapons.tickCharacter(charIdx, frameIdx);
      }

      /* 4. 이번 프레임에 예약된 결과를 고정된 순서로 반영 */
      this.commitHits(frameIdx);
      this.drainTriggers();
      this.commitHits(frameIdx);

      if (sampleFrames && frameIdx % sampleFrames === 0) this.sample(frameIdx);
      this.framesProcessed++;
    }

    return this.writer.finish(this);
  }

  sample(frameIdx) {
    const rows = [];
    for (let i = 0; i < this.runtime.charCount; i++) {
      rows.push({
        characterId: this.runtime.charIdByIndex[i],
        attack: this.attackOf(i),
        ammo: this.runtime.ammo[i],
        maxAmmo: this.runtime.maxAmmo[i],
        damage: this.counters[i].damage,
        /* 예열이 지금 어디까지 올라와 있나 (0~1). 없는 무기는 null. */
        heat: (() => {
          const cap = this.weapons.warmupCap(i);
          return cap ? this.runtime.weaponStates[i].warmupShotCount / cap : null;
        })(),
        reloading: hasFlag(this.runtime, i, StateFlag.RELOADING),
        stunned: hasFlag(this.runtime, i, StateFlag.STUNNED),
        /* 이름 붙은 상태(`전투 보조` 같은 것)와 그 중첩 수. 조건이 이걸 보고 갈라지므로 결과가 이상할 때 먼저 볼 자리다. */
        states: [...this.states[i].keys()],
        stacks: this.stackCounts(i),
        buffs: this.effects.snapshot(i),
      });
    }
    this.writer.snapshots.push({
      frame: frameIdx,
      sec: frameToSec(frameIdx, this.options.frameRate),
      gauge: this.burst.gauge,
      gaugePct: (this.burst.gauge / this.options.burstGaugeMax) * 100,
      inFullBurst: this.burst.inFullBurst,
      characters: rows,
    });
  }
}

export function simulateBattle(input) {
  if (!input || typeof input !== 'object') {
    throw new SimInputError('시뮬레이션 입력이 없습니다', {});
  }
  const options = { ...(input.options || {}) };
  if (input.rngSeed != null) options.rngSeed = input.rngSeed;
  return new BattleLoop({ ...input, options }).run();
}

export { BattleLoop, STAGES, occupiesStage, HitFlag };
