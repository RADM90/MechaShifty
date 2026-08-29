/* WeaponSystem — 발사, 충전, 탄약, 재장전, 워밍업, 조작 (§9).

   여기 있는 숫자 모형은 명세가 구조를 정하고 **화면 녹화 실측**이 값을 정한다
   (등기부 메커니즘 14). 예열이 시간이 아니라 발수 기준이라는 것, 냉각 곡선의 모양,
   재장전 모션 0.2초가 재장전 속도의 영향을 안 받는다는 것이 전부 관측이다. */

import { StateFlag, StatCode } from './codes.js';
import { hasFlag, setFlag } from './runtime.js';
import {
  resolveMaxAmmo, reloadSec, reloadSegmentAmmo, coreHitProbability, pct,
} from './damage.js';

export class WeaponSystem {
  constructor(runtime, effects, battle) {
    this.runtime = runtime;
    this.effects = effects;
    this.battle = battle;
  }

  /* ── 연사 속도 (§9.2, §9.3) ──────────────────────────────

     예열은 **누적 발사 수** 기준이다 — 한 발 쏠 때마다 한 계단 오른다. 시간 기준 램프와
     달리 발수 기준은 스스로를 가속한다. 공격 속도 버프는 보간 결과에 곱한다. */
  fireRatePerSec(charIdx) {
    const w = this.runtime.chars[charIdx].weapon;
    const ws = this.runtime.weaponStates[charIdx];
    const stats = this.effects.statsFor(charIdx);
    let rate = w.fireRatePerSec;
    if (w.warmupStepPerShot > 0) {
      rate = Math.min(
        w.warmupFireRateStartPerSec + w.warmupStepPerShot * ws.warmupShotCount,
        w.warmupFireRateEndPerSec || w.warmupFireRateStartPerSec,
      );
    }
    return Math.max(1e-6, rate * (1 + pct(stats[StatCode.spinupRatePct])));
  }

  warmupCap(charIdx) {
    const w = this.runtime.chars[charIdx].weapon;
    if (!(w.warmupStepPerShot > 0)) return 0;
    return Math.max(0, Math.ceil(
      (w.warmupFireRateEndPerSec - w.warmupFireRateStartPerSec) / w.warmupStepPerShot));
  }

  /* ── 냉각 (§9.3 + 실측 곡선) ─────────────────────────────

     사격을 멈추는 순간 0 이 되지도, 계속 남아 있지도 않는다. 실측한 곡선을 그대로 쓴다
     (0.3초까지 유지, 0.5초 39%, 1.0초 13%, 1.4초 0). 사이는 선형으로 잇는다.

     남는 양을 **비율**로 다루는 이유: 실측은 전부 최고 열에서 잰 것이라 부분적으로
     달아오른 상태에서 어떻게 식는지는 모른다. 비율이면 어느 높이에서 멈추든 같은
     모양으로 식어서, 아는 것만큼만 말하는 셈이 된다.

     명세 §9.3 은 "직전에 예약된 발사 간격의 1.5배보다 길 때만 감소를 시작한다"고 하고,
     실측 곡선의 첫 구간(0.3초 유지)이 그 유예에 해당한다. */
  cool(charIdx, frameIdx) {
    const ws = this.runtime.weaponStates[charIdx];
    if (ws.lastShotFrame < 0 || !ws.warmupShotCount) return;
    if (!this.warmupCap(charIdx)) { ws.warmupShotCount = 0; return; }
    const o = this.runtime.options;
    const gapSec = (frameIdx - ws.lastShotFrame) / o.frameRate;
    const curve = o.heatDecayCurve;
    if (!curve || !curve.length) return;
    let keep = curve[curve.length - 1][1];
    for (let i = 1; i < curve.length; i++) {
      const [t0, k0] = curve[i - 1], [t1, k1] = curve[i];
      if (gapSec <= t1) {
        keep = t1 === t0 ? k1 : k0 + (k1 - k0) * (gapSec - t0) / (t1 - t0);
        break;
      }
    }
    /* 소수로 남긴다. 내림하면 1.15~1.4초 구간이 "완전 초기화" 와 구별되지 않는데,
       실측은 1.13초에서 열 1.4 를 봤다. */
    ws.warmupShotCount = Math.max(0, ws.warmupShotCount * keep);
  }

  /* ── 탄약 (§9.5) ─────────────────────────────────────────

     장탄 증가는 **원천별로** 기본 장탄에 걸고 따로 정수화한 뒤 합산한다. 먼저 더하고 한
     번 반올림하면 SR 6발·RL 5발에서 1발이 어긋나고, 그 1발이 DPS 를 10% 넘게 흔든다. */
  refreshMaxAmmo(charIdx) {
    const w = this.runtime.chars[charIdx].weapon;
    const next = resolveMaxAmmo(w.magazineSize, this.effects.ammoPctList(charIdx));
    if (next !== this.runtime.maxAmmo[charIdx]) {
      this.runtime.maxAmmo[charIdx] = next;
      /* 최대 장탄이 줄면 현재 탄약도 따라 줄인다. 늘어날 때는 자동으로 안 채운다. */
      if (this.runtime.ammo[charIdx] > next) this.runtime.ammo[charIdx] = next;
      this.battle.log('ammoMax', this.battle.frameIdx, charIdx, { maxAmmo: next });
    }
    return next;
  }

  /* ── 한 프레임 (§5, §9.2) ────────────────────────────────

     예약 발사 프레임이 현재 프레임보다 이르면 발사한다. **발사 동작은 프레임당 최대 한
     번**이다 — 밀린 발사를 한 프레임에 몰아 따라잡지 않는다. 그래서 60 FPS 에서 한
     캐릭터의 상한은 초당 60회고, MG 의 4200 RPM(70발/초)은 실기에서 안 나온다
     (탄창 300발이 6.52초, 평균 46.0발/초로 관측됐다).

     프레임 상한은 **발사 동작 수**에 걸리고 타격 수에는 안 걸린다. 한 발사 동작에서
     pelletCount × muzzleCount 개의 타격이 생기는 것은 허용된다 (§9.2). */
  tickCharacter(charIdx, frameIdx) {
    const rt = this.runtime;
    const ws = rt.weaponStates[charIdx];
    const w = rt.chars[charIdx].weapon;

    if (hasFlag(rt, charIdx, StateFlag.STUNNED)) return;
    if (hasFlag(rt, charIdx, StateFlag.IN_COVER)) return;
    if (!ws.firing) return;

    /* 재장전 완료 — 분할 재장전은 탄창이 찰 때까지 반복한다 (§9.6) */
    if (hasFlag(rt, charIdx, StateFlag.RELOADING)) {
      if (frameIdx >= ws.reloadEndFrame) this.finishReloadSegment(charIdx, frameIdx);
      return;
    }

    /* 냉각은 다음 발을 잡을 때 따진다. 쏘는 순간에 따지면 재장전 직후 첫 발이 최고 연사로 나간다 (1세대에서 실효 연사가 9% 부풀었다). */
    this.cool(charIdx, frameIdx);

    if (w.fireMode === 'charge') { this.tickCharge(charIdx, frameIdx); return; }

    if (frameIdx >= ws.nextShotFrame) {
      this.fireOnce(charIdx, frameIdx, 1);
      const intervalFrames = rt.options.frameRate / this.fireRatePerSec(charIdx);
      ws.scheduledIntervalFrames = intervalFrames;
      ws.nextShotFrame += intervalFrames;
      if (ws.nextShotFrame <= frameIdx) ws.nextShotFrame = frameIdx + 1;
    }
  }

  /* ── 충전 무기 (§9.4) ────────────────────────────────────

     충전 시작·유지·발사를 분리한다. 최대 충전 시간에 도달하면 풀 충전으로 판정하고,
     조작 설정이 즉시 발사를 요구하면 그 프레임에 쏜다. */
  tickCharge(charIdx, frameIdx) {
    const rt = this.runtime;
    const ws = rt.weaponStates[charIdx];
    const w = rt.chars[charIdx].weapon;
    const stats = this.effects.statsFor(charIdx);

    const fixed = stats[StatCode.chargeTimeFixSec];
    const baseSec = fixed > 0 ? fixed : w.chargeSec;
    const chargeSec = Math.max(0, baseSec / (1 + pct(stats[StatCode.chargeSpeedPct])));
    const chargeFrames = Math.max(1, Math.round(chargeSec * rt.options.frameRate));

    if (ws.chargeStartFrame < 0) {
      if (frameIdx < ws.nextShotFrame) return;
      ws.chargeStartFrame = frameIdx;
      setFlag(rt, charIdx, StateFlag.CHARGING, true);
      return;
    }
    const held = frameIdx - ws.chargeStartFrame;
    /* 수동 운용이면 끝까지 안 당기고 끊을 수 있다. 그만큼만 ④ 칸을 받는다. */
    const wantRatio = rt.options.controlMode === 'manual'
      ? Math.min(1, Math.max(0, rt.options.manualChargeRatio)) : 1;
    const needFrames = Math.max(1, Math.round(chargeFrames * wantRatio));
    if (held < needFrames) return;

    ws.chargeStartFrame = -1;
    setFlag(rt, charIdx, StateFlag.CHARGING, false);
    this.fireOnce(charIdx, frameIdx, wantRatio);
    /* 충전 무기는 발사 간격이 곧 충전 시간이다 */
    ws.nextShotFrame = frameIdx + 1;
  }

  /* ── 한 발 (§9.2, §14.6) ────────────────────────────────

     한 발사 동작에서 pelletCount × muzzleCount 개의 타격이 나가고, 한 타격 계수는
     무기 계수 ÷ pelletCount 다. 총구 수로 다시 나누지 않는다. */
  fireOnce(charIdx, frameIdx, chargeRatio) {
    const rt = this.runtime;
    const ws = rt.weaponStates[charIdx];
    const w = rt.chars[charIdx].weapon;
    const infinite = hasFlag(rt, charIdx, StateFlag.INFINITE_AMMO);

    if (!infinite && rt.ammo[charIdx] <= 0) { this.startReload(charIdx, frameIdx); return; }

    this.battle.emitNormalHits(charIdx, frameIdx, chargeRatio);

    ws.lastShotFrame = frameIdx;
    ws.warmupShotCount = Math.min(ws.warmupShotCount + 1, this.warmupCap(charIdx));

    if (!infinite) {
      rt.ammo[charIdx]--;
      /* "마지막 탄환 명중 시" — 탄창을 비우는 그 한 발. 재장전을 걸기 **전에** 쏜다. */
      if (rt.ammo[charIdx] <= 0) this.battle.onLastBullet(charIdx, frameIdx);
    }

    /* 탄환 충전 — N발마다 몇 발이 돌아온다. 기본은 최대 장탄으로 제한한다 (§9.6). */
    const stats = this.effects.statsFor(charIdx);
    const per = stats[StatCode.shotConditionCount];
    const amount = stats[StatCode.ammoChargeCount];
    if (per > 0 && amount > 0) {
      const shots = this.battle.counters[charIdx].shotCount + 1;
      if (shots % Math.round(per) === 0) {
        rt.ammo[charIdx] = Math.min(rt.maxAmmo[charIdx], rt.ammo[charIdx] + Math.round(amount));
        this.battle.onAmmoCharge(charIdx, frameIdx);
      }
    }

    this.battle.counters[charIdx].shotCount++;
    if (!infinite && rt.ammo[charIdx] <= 0) this.startReload(charIdx, frameIdx);
  }

  /* ── 재장전 (§9.6) ───────────────────────────────────────

     모션 0.2초는 제원의 재장전 시간에 안 들어 있는데 그동안 총을 못 쏘고, 예열도 그만큼
     더 식는다. **재장전 속도 증가의 영향을 안 받는 고정 비용**이라 재장전을 아무리
     줄여도 이 0.2초는 남는다 — MG 가 무한탄창 조합을 원하는 진짜 이유다 (0.2초는
     냉각 곡선의 유지 구간 0.3초 안이라 예열이 그대로 살아남는다). */
  startReload(charIdx, frameIdx) {
    const rt = this.runtime;
    if (hasFlag(rt, charIdx, StateFlag.RELOADING)) return;
    const ws = rt.weaponStates[charIdx];
    const w = rt.chars[charIdx].weapon;
    const stats = this.effects.statsFor(charIdx);

    setFlag(rt, charIdx, StateFlag.RELOADING, true);
    ws.reloadSegmentsDone = 0;
    const sec = reloadSec(w.reloadSec, stats[StatCode.reloadSpeedPct]);
    const perSegment = sec / w.reloadSegmentCount;
    ws.reloadSegmentSec = perSegment;
    ws.reloadEndFrame = frameIdx
      + Math.round((rt.options.reloadMotionSec + perSegment) * rt.options.frameRate);
    this.battle.counters[charIdx].reloadCount++;
    this.battle.onReloadStart(charIdx, frameIdx);
  }

  finishReloadSegment(charIdx, frameIdx) {
    const rt = this.runtime;
    const ws = rt.weaponStates[charIdx];
    const w = rt.chars[charIdx].weapon;
    const stats = this.effects.statsFor(charIdx);

    const max = this.refreshMaxAmmo(charIdx);
    const gain = reloadSegmentAmmo(max, w.reloadSegmentCount, stats[StatCode.reloadAmountPct]);
    rt.ammo[charIdx] = Math.min(max, rt.ammo[charIdx] + gain);
    ws.reloadSegmentsDone++;

    /* 마지막 분할이 끝나 완전히 찼을 때만 재장전 완료다 (§9.6, §14.7). 13발·분할 3 은 세 번에 12발만 차므로 네 번째를 더 돈다. */
    if (rt.ammo[charIdx] >= max) {
      setFlag(rt, charIdx, StateFlag.RELOADING, false);
      ws.reloadEndFrame = -1;
      ws.nextShotFrame = frameIdx;
      this.battle.onReloadDone(charIdx, frameIdx);
      return;
    }
    ws.reloadEndFrame = frameIdx + Math.round(ws.reloadSegmentSec * rt.options.frameRate);
  }

  /* 재장전 취소는 탄환을 안 채우고 완료 이벤트도 안 낸다. 취소 직후 별도의 후딜은 안 붙인다 (§9.6). */
  cancelReload(charIdx, frameIdx) {
    const rt = this.runtime;
    if (!hasFlag(rt, charIdx, StateFlag.RELOADING)) return;
    setFlag(rt, charIdx, StateFlag.RELOADING, false);
    rt.weaponStates[charIdx].reloadEndFrame = -1;
    rt.weaponStates[charIdx].nextShotFrame = frameIdx;
    this.battle.log('reloadCancel', frameIdx, charIdx, {});
  }

  /* ── 코어 명중 (§7.1, 메커니즘 19) ────────────────────────

     `coreAlwaysHit` 이면 확률을 안 쓴다 — 코어에 닿는 적이면 평타는 전부 코어 명중으로
     본다. 빈도를 따로 두지 않으므로 **상한값**이고, 조준 실수는 모형 밖이다.
     확률 모형을 쓰려면 `coreProbabilityExponent` 가 있어야 하고, 없으면 오류다 (§13). */
  coreProbability(charIdx) {
    const t = this.runtime.target;
    const o = this.runtime.options;
    if (t.coreAlwaysHit) return 1;
    if (!(t.coreDiameterPx > 0)) return 0;
    return coreHitProbability(t.coreDiameterPx,
      this.runtime.chars[charIdx].weapon.spreadDiameterPx, o.coreProbabilityExponent);
  }
}
