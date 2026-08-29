/* ResultWriter — 열 지향 로그와 캐릭터별 요약 (§12).

   매 타격마다 로그 객체를 만들지 않는다. 열 지향 배열에 숫자만 붙이고 UI 가 필요할 때만 그 구간을 객체로 바꾼다 (§11, §12.2).
   로그는 끌 수 있되 계산 결과가 로그 여부에 따라 달라지면 안 된다 (§12.3). */

export const HitFlag = Object.freeze({
  CRIT: 1 << 0,
  CORE: 1 << 1,
  NORMAL: 1 << 2,
  FULL_CHARGE: 1 << 3,
  FULL_BURST: 1 << 4,
});

const INITIAL_CAPACITY = 4096;

export class ResultWriter {
  constructor(runtime) {
    this.runtime = runtime;
    this.logLevel = runtime.options.logLevel;
    this.full = this.logLevel === 'full';

    this.hitCount = 0;
    this.capacity = this.full ? INITIAL_CAPACITY : 0;
    if (this.full) {
      this.frame = new Uint32Array(this.capacity);
      this.sourceIdx = new Uint8Array(this.capacity);
      this.damage = new Float64Array(this.capacity);
      this.flags = new Uint8Array(this.capacity);
      this.tagCode = new Uint16Array(this.capacity);
      this.skillIdx = new Int16Array(this.capacity);
    }

    /* 필수 로그 (§12.3) — 요약 수준에서도 남긴다. 이벤트 수가 타격 수와 자릿수가 달라 객체로 둬도 값이 싸다. */
    this.events = this.logLevel === 'none' ? null : [];
    this.snapshots = [];
    this.warnings = [];
  }

  grow() {
    const next = this.capacity * 2;
    const copy = (Ctor, src) => { const a = new Ctor(next); a.set(src); return a; };
    this.frame = copy(Uint32Array, this.frame);
    this.sourceIdx = copy(Uint8Array, this.sourceIdx);
    this.damage = copy(Float64Array, this.damage);
    this.flags = copy(Uint8Array, this.flags);
    this.tagCode = copy(Uint16Array, this.tagCode);
    this.skillIdx = copy(Int16Array, this.skillIdx);
    this.capacity = next;
  }

  writeHit(frameIdx, sourceIdx, damage, flags, tagMask, skillIdx) {
    if (!this.full) { this.hitCount++; return; }
    if (this.hitCount >= this.capacity) this.grow();
    const i = this.hitCount++;
    this.frame[i] = frameIdx;
    this.sourceIdx[i] = sourceIdx;
    this.damage[i] = damage;
    this.flags[i] = flags;
    this.tagCode[i] = tagMask & 0xffff;
    this.skillIdx[i] = skillIdx == null ? -1 : skillIdx;
  }

  writeEvent(type, frameIdx, charIdx, payload) {
    if (!this.events) return;
    this.events.push({
      type,
      frame: frameIdx,
      sec: frameIdx / this.runtime.options.frameRate,
      characterId: charIdx >= 0 ? this.runtime.charIdByIndex[charIdx] : null,
      ...payload,
    });
  }

  warn(message) {
    if (!this.warnings.includes(message)) this.warnings.push(message);
  }

  finish(battle) {
    const rt = this.runtime;
    const o = rt.options;
    const seconds = o.effectiveDurationSec;

    const characters = [];
    let totalDamage = 0;
    for (let i = 0; i < rt.charCount; i++) {
      const c = battle.counters[i];
      totalDamage += c.damage;
      characters.push({
        characterId: rt.charIdByIndex[i],
        displayName: rt.chars[i].displayName,
        damage: c.damage,
        dps: c.damage / seconds,
        normalDamage: c.normalDamage,
        skillDamage: c.damage - c.normalDamage,
        shotCount: c.shotCount,
        hitCount: c.hitCount,
        critHitCount: c.critHitCount,
        coreHitCount: c.coreHitCount,
        reloadCount: c.reloadCount,
        burstCount: c.burstCount,
        damageBySource: { ...c.damageBySource },
        damageByKind: { ...c.damageByKind },
        /* 버스트 충전 기여도는 게이지 기준이다 — 사이클 0→100% 중 이 니케가 몇 %p 를 넣었나.
           만충을 넘겨 버려진 몫은 안 센다 (더하면 사이클당 합이 100% 를 넘는다). */
        gaugeChargedTotal: c.gaugeCharged,
        gaugeChargedByNormal: c.gaugeByNormal,
        gaugeChargedBySkill: c.gaugeBySkill,
      });
    }

    /* 나누는 수는 **체인 횟수가 아니라 게이지를 채운 횟수**다.

       전투가 충전 도중에 끝나거나, Ⅰ 을 낼 니케가 쿨타임이라 만충으로 서 있는 채로
       끝나면 그 몫은 체인이 안 됐어도 **실제로 게이지에 들어간 충전량**이다. 체인
       횟수로 나누면 그만큼 합계가 100% 를 넘는다 — 쿨타임에 묶인 편성에서 125% 가 나왔다.

       잔량이 다음 사이클로 넘어가는 것이 아니다. 체인이 열리는 순간 게이지는 0 이
       되고 (무효가 나도 마찬가지), 만충을 넘긴 몫은 한 톨도 안 세고 버려진다.
       여기서 세는 것은 "이 니케가 게이지에 얼마를 넣었나" 하나뿐이다. */
    const gaugeFills = Math.max(1e-9, battle.totalGaugeCharged / o.burstGaugeMax);
    for (const row of characters) {
      const src = battle.counters[rt.charIndexById.get(row.characterId)];
      row.gaugeSharePct = battle.totalGaugeCharged > 0
        ? (src.gaugeCharged / battle.totalGaugeCharged) * 100 : 0;
      row.gaugePctPerCycle = (src.gaugeCharged / o.burstGaugeMax) / gaugeFills * 100;
    }

    return {
      requestedDurationSec: o.requestedDurationSec,
      effectiveDurationSec: seconds,
      frameRate: o.frameRate,
      framesProcessed: battle.framesProcessed,
      rngMode: o.rngMode,
      rngSeed: o.rngSeed,
      totalDamage,
      squadDps: totalDamage / seconds,
      characters,
      burst: {
        gaugeMode: o.burstGaugeMode,
        gaugeMax: o.burstGaugeMax,
        targetCount: o.targetCount,
        cycleCount: battle.burst.cycleCount,
        burstCount: battle.burst.burstCount,
        fullBurstSeconds: battle.fullBurstFrames / o.frameRate,
        /* 게이지를 0 에서 100% 까지 채운 횟수. 만충으로 선 채 전투가 끝나면 채우기는 했는데 체인은 안 열려 체인 횟수와 다르다. */
        gaugeFills: battle.totalGaugeCharged / o.burstGaugeMax,
        wastedGauge: battle.burst.wastedGauge,
        wastedHits: battle.burst.wastedHits,
        finalGauge: battle.burst.gauge,
      },
      logs: {
        level: this.logLevel,
        characterIds: rt.charIdByIndex.slice(),
        events: this.events || [],
        snapshots: this.snapshots,
        hits: this.full ? {
          count: this.hitCount,
          frame: this.frame.subarray(0, this.hitCount),
          sourceIdx: this.sourceIdx.subarray(0, this.hitCount),
          damage: this.damage.subarray(0, this.hitCount),
          flags: this.flags.subarray(0, this.hitCount),
          tagCode: this.tagCode.subarray(0, this.hitCount),
          skillIdx: this.skillIdx.subarray(0, this.hitCount),
        } : null,
      },
      warnings: this.warnings,
    };
  }
}
