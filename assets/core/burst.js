/* BurstSystem — 게이지, 1→2→3 단계, 재진입, 풀 버스트 (§10).

   명세 §10 이 뼈대를 주고, 이번 세션의 실측·지시가 살을 붙인다. 명세에 없는 것 넷:

     · **체인 창 10초** (메커니즘 3) — 한 단계를 누른 뒤 이 안에 다음 단계가 안 나오면
       체인이 무효가 되고 게이지가 0 부터 다시 찬다
     · **게이지 잠금** (메커니즘 6) — 체인이 진행 중이거나 풀 버스트 중에는 게이지가
       안 찬다. 넘친 몫을 이월하지도 않는다
     · **니케마다 따로 도는 쿨타임** (메커니즘 16) — 단계에 걸리는 게 아니라 개인에게
       걸린다. 그래서 40초 쿨 니케가 둘이면 번갈아 쓰는 무늬가 생긴다
     · **"기본 버스트 단계" 판정** (메커니즘 18) — AllStep 과 재진입 니케는 그 단계에
       **없는 것으로 친다.** 아비스타(1버스트 재진입) · 레드 후드(AllStep) ·
       라피 : 레드후드가 있으면 1단계 자리는 비어 있고, 그래서 라피가 1버스트로 동작한다

   상태 (§10.1):
     idle → stage:1 → (reenter:1)* → switching → stage:2 → ... → stage:3 → full_burst */

import { StatCode, TriggerCode } from './codes.js';

export const STAGES = ['1', '2', '3'];

/* 어느 니케가 어느 단계를 낼 수 있는가. 자리 제약은 없고 `AllStep` 은 어느 단계든 낸다. */
export function canCast(char, stage) {
  return char.burstStage === stage || char.burstStage === 'AllStep';
}

/* 기본 버스트 단계 판정 (메커니즘 18). AllStep 과 재진입 니케는 자기 단계를 안 차지하고 그 자리는 빈 것으로 본다. */
export function occupiesStage(char, stage) {
  if (char.burstStage === 'AllStep') return false;
  if (char.reentryStage != null) return false;
  return char.burstStage === stage;
}

export class BurstSystem {
  constructor(runtime, effects, battle) {
    this.runtime = runtime;
    this.effects = effects;
    this.battle = battle;

    this.gauge = 0;
    this.state = 'idle';
    this.stageIdx = 0;
    this.chainDeadlineFrame = -1;
    this.nextActionFrame = -1;
    this.fullBurstEndFrame = -1;
    this.inFullBurst = false;
    this.burstCount = 0;
    this.cycleCount = 0;
    this.lastCasterIdx = -1;
    this.wastedGauge = 0;
    /* 잠긴 동안 버려진 명중 횟수. "몇 발이 헛돌았나" 는 사람이 세는 단위고 게이지 양은 그 발들이 얼마였는지다. */
    this.wastedHits = 0;
    /* fixed 모드의 준비 시각 (§10.4) */
    this.readyFrame = Math.round(
      runtime.options.firstBurstAtSec * runtime.options.frameRate);
    this.chainDone = new Set();
    /* 사람의 반응 지연은 **첫 누름에만** 실린다 (메커니즘 15) */
    this.pressDelayPending = true;
  }

  get gaugeMax() { return this.runtime.options.burstGaugeMax; }

  /* ── 게이지 (§10.4, 메커니즘 2·6·13) ─────────────────────

     게이지는 **표적마다** 찬다 — 대미지는 아니다. 한 발이 두 표적에 닿으면 두 몫이
     들어온다. 만충은 표적 하나 기준 20,000 이다.

     체인이 진행 중이거나 풀 버스트 중에는 **안 찬다.** 그 구간에 들어온 몫은 버려지고
     기여도 집계에서도 빠진다 — 넘친 값을 더하면 사이클당 합이 100% 를 넘는다. */
  charge(charIdx, perTargetAmount, source) {
    if (this.state !== 'idle' || this.inFullBurst) {
      this.wastedGauge += perTargetAmount * this.runtime.options.targetCount;
      this.wastedHits++;
      return 0;
    }
    if (this.runtime.options.burstGaugeMode === 'fixed') return 0;

    const stats = this.effects.statsFor(charIdx);
    const speed = 1 + (stats[StatCode.burstGaugeSpeedPct] || 0) / 100;
    const amount = perTargetAmount * this.runtime.options.targetCount * speed;

    const room = this.gaugeMax - this.gauge;
    const applied = Math.min(room, amount);
    this.gauge += applied;
    /* 100% 를 넘긴 초과분은 **이월하지 않는다** (§10.4). */
    if (amount > applied) this.wastedGauge += amount - applied;

    this.battle.countGaugeContribution(charIdx, applied, source);
    return applied;
  }

  /* 즉발 게이지 (스킬의 "버스트 게이지 N% 충전"). 퍼센트로 들어온다. */
  chargePct(charIdx, gaugePct) {
    return this.charge(charIdx, (gaugePct / 100) * this.gaugeMax
      / Math.max(1, this.runtime.options.targetCount), 'skill');
  }

  /* ── 사용자 선택 (§10.2) ────────────────────────────────

     한 단계에서 한 명만 쓴다. 명시적인 시퀀스가 있으면 그 순서를 따르고, 자동 선택은
     **스쿼드 순서**를 우선한다. 앞 캐릭터가 재사용 대기 중이면 같은 단계의 다음 사용
     가능 캐릭터로 넘어간다. 쓸 수 있는 캐릭터가 없으면 그 단계에서 기다린다.

     쿨타임은 니케마다 따로 돈다 (메커니즘 16). */
  readyCasters(stage, frameIdx) {
    const rt = this.runtime;
    const out = [];
    for (let i = 0; i < rt.charCount; i++) {
      if (!canCast(rt.chars[i], stage)) continue;
      if (rt.burstCooldownEndFrame[i] > frameIdx) continue;
      out.push(i);
    }
    return out;
  }

  pickCaster(stage, frameIdx) {
    const seq = this.runtime.options.burstSequence;
    if (seq) {
      const wanted = seq[this.cycleCount % seq.length];
      const id = wanted && wanted['step' + stage];
      const idx = id == null ? undefined : this.runtime.charIndexById.get(id);
      if (idx !== undefined && this.runtime.burstCooldownEndFrame[idx] <= frameIdx
          && canCast(this.runtime.chars[idx], stage)) return idx;
    }
    const ready = this.readyCasters(stage, frameIdx);
    return ready.length ? ready[0] : -1;
  }

  /* 이 단계에 **기본 버스트 단계**로 들어가는 니케가 있는가 (메커니즘 18). */
  baseStageCount(stage) {
    let n = 0;
    for (const c of this.runtime.chars) if (occupiesStage(c, stage)) n++;
    return n;
  }

  /* ── 한 프레임 (§5) ─────────────────────────────────────── */
  tick(frameIdx) {
    const o = this.runtime.options;

    if (this.inFullBurst && frameIdx >= this.fullBurstEndFrame) this.endFullBurst(frameIdx);

    /* 체인 창 만료 — 다음 단계가 제때 안 나오면 체인이 무효다 (메커니즘 3) */
    if (this.state === 'chain' && frameIdx > this.chainDeadlineFrame) {
      this.battle.log('chainVoid', frameIdx, this.lastCasterIdx,
        { stage: STAGES[this.stageIdx] });
      this.reset(frameIdx);
      return;
    }

    if (this.state === 'idle') {
      if (o.maxBurstCount != null && this.cycleCount >= o.maxBurstCount) return;
      const ready = o.burstGaugeMode === 'fixed'
        ? frameIdx >= this.readyFrame
        : this.gauge >= this.gaugeMax;
      if (!ready) return;
      /* 게이지가 차고 사람이 Ⅰ 을 누르기까지 (메커니즘 15). 첫 누름에만 실린다 — Ⅱ·Ⅲ 은 연출이 끝나는 프레임에 이미 눌려 있다. */
      if (this.pressDelayPending) {
        this.pressDelayPending = false;
        this.nextActionFrame = frameIdx + Math.round(o.burstPressDelaySec * o.frameRate);
        this.state = 'pressing';
        this.battle.log('gaugeFull', frameIdx, -1, { gauge: this.gauge });
        return;
      }
      this.beginChain(frameIdx);
      return;
    }

    if (this.state === 'pressing' && frameIdx >= this.nextActionFrame) {
      /* **누를 사람이 없으면 체인을 안 연다.** 게이지는 만충으로 남는다.

         게임에서 Ⅰ 을 눌러야 체인이 열리는데, Ⅰ 을 낼 니케가 전부 쿨타임이면 애초에
         누를 수가 없다. 아이콘은 켜진 채로 서 있고 게이지도 그대로다.

         여기서 무턱대고 열면 **게이지를 만충째로 쓰고 10초 창을 태운 뒤 무효**가 된다.
         180초에 없던 무효 체인이 5~11번 생기고, 사이클 집계가 실제의 두세 배로 부푼다. */
      if (this.pickCaster(STAGES[0], frameIdx) < 0) {
        this.nextActionFrame = frameIdx + 1;
        return;
      }
      this.beginChain(frameIdx);
      return;
    }

    if (this.state === 'chain' && frameIdx >= this.nextActionFrame) {
      this.advance(frameIdx);
    }
  }

  beginChain(frameIdx) {
    const o = this.runtime.options;
    this.state = 'chain';
    this.stageIdx = 0;
    this.chainDone.clear();
    this.gauge = 0;
    this.cycleCount++;
    this.chainDeadlineFrame = frameIdx + Math.round(o.burstChainWindowSec * o.frameRate);
    this.nextActionFrame = frameIdx;
    this.battle.log('chainStart', frameIdx, -1, {});
    this.advance(frameIdx);
  }

  advance(frameIdx) {
    const o = this.runtime.options;
    const stage = STAGES[this.stageIdx];
    const casterIdx = this.pickCaster(stage, frameIdx);

    /* 쓸 캐릭터가 없으면 그 단계에서 기다린다 (§10.2). 체인 창이 만료되면 위 `tick` 이 무효 처리한다. */
    if (casterIdx < 0) { this.nextActionFrame = frameIdx + 1; return; }

    this.cast(casterIdx, stage, frameIdx);
  }

  cast(charIdx, stage, frameIdx) {
    const rt = this.runtime;
    const o = rt.options;
    const char = rt.chars[charIdx];
    const stats = this.effects.statsFor(charIdx);

    /* 니케가 각 단계에서 버스트 스킬을 쓰면 **개별 쿨타임이 돈다** (메커니즘 16). */
    const cd = Math.max(0, char.burstCooldownSec + (stats[StatCode.burstCooldownSec] || 0));
    rt.burstCooldownEndFrame[charIdx] = frameIdx + Math.round(cd * o.frameRate);

    this.lastCasterIdx = charIdx;
    this.burstCount++;
    this.chainDone.add(stage);
    this.battle.onBurstUse(charIdx, stage, frameIdx);
    this.battle.log('burstUse', frameIdx, charIdx, { stage, cooldownSec: cd });

    /* ── 재진입 (메커니즘 17) ──────────────────────────────

       재진입 니케의 버스트가 나가면 체인이 **그 단계로 되돌아간다.** 방금 쓴 니케는
       자기 쿨타임이 도는 중이라 바로 다시 못 쓰므로, 같은 단계의 다른 니케가 받는다.
       **체인 10초 제한은 재진입 버스트 사용 이후에 새로 시작한다.**
       조건만 맞으면 계속 반복한다. */
    const reentry = char.reentryStage;
    if (reentry != null && this.readyCasters(reentry, frameIdx).length > 0) {
      this.stageIdx = STAGES.indexOf(reentry);
      this.chainDone.delete(reentry);
      this.chainDeadlineFrame = frameIdx + Math.round(o.burstChainWindowSec * o.frameRate);
      this.nextActionFrame = frameIdx
        + Math.round((o.burstCutInSec + o.burstReenterDelaySec) * o.frameRate);
      this.battle.log('reentry', frameIdx, charIdx,
        { toStage: reentry, deadlineFrame: this.chainDeadlineFrame });
      return;
    }

    if (stage === '3') { this.enterFullBurst(frameIdx); return; }

    this.stageIdx++;
    /* 단계가 바뀔 때 전환 지연을 둔다 (§10.3). 컷신은 사이클에서 뺐고 `burstCutInSec` 은 기본 0 으로 자리만 남아 있다. */
    this.nextActionFrame = frameIdx
      + Math.round((o.burstCutInSec + o.burstSwitchDelaySec) * o.frameRate);
  }

  /* ── 풀 버스트 (§10.3) ───────────────────────────────────

     3단계 사용 후 **진입 효과를 먼저 활성화하고**, 같은 진입으로 발생하는 피해는 그
     효과가 적용된 상태에서 계산한다. 그래서 버스트 스킬 본체는 풀 버스트가 열리기 한
     박자 전에 때려서 저절로 1.5배를 못 받고, "추가 대미지" 는 열린 뒤에 때려서 받는다
     (메커니즘 10). 순서를 어기면 조용히 1.5배가 붙는다. */
  enterFullBurst(frameIdx) {
    const o = this.runtime.options;
    const durationSec = this.runtime.chars[this.lastCasterIdx]
      ? this.runtime.chars[this.lastCasterIdx].burstDurationSec
      : o.fullBurstDurationSec;
    this.state = 'fullBurst';
    this.inFullBurst = true;
    this.fullBurstEndFrame = frameIdx
      + Math.round((o.fullBurstEnterDelaySec + durationSec) * o.frameRate);
    this.battle.onFullBurst(true, frameIdx);
  }

  endFullBurst(frameIdx) {
    this.inFullBurst = false;
    /* 종료 알림을 모든 효과에 전달한 다음 `burstCasted` 를 초기화한다. 먼저 초기화하면 누가 이번 사이클에 버스트를 썼는지 알 수 없다 (§10.3). */
    this.battle.onFullBurst(false, frameIdx);
    this.reset(frameIdx);

    /* fixed 모드: 종료 시각에 캐릭터별 준비 지연을 더하고 전원이 준비된 시각에 다음 1단계를 연다.
       실질 대기는 스쿼드에서 가장 긴 `burstGaugeReadyDelaySec` 이다 (§10.4). */
    if (this.runtime.options.burstGaugeMode === 'fixed') {
      let longest = 0;
      for (const c of this.runtime.chars) {
        longest = Math.max(longest, c.burstGaugeReadyDelaySec);
      }
      this.readyFrame = frameIdx + Math.round(longest * this.runtime.options.frameRate);
    }
  }

  reset(frameIdx) {
    this.state = 'idle';
    this.stageIdx = 0;
    this.chainDone.clear();
    this.chainDeadlineFrame = -1;
    this.nextActionFrame = -1;
    this.gauge = 0;
    this.pressDelayPending = true;
  }
}
