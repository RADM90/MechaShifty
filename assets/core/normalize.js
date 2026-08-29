/* 입력 검증과 프레임 격자 (명세 §3.1, §5, §13, §14.8).

   누락된 값을 0 이나 평균으로 때우지 않고 입력 검증 오류로 낸다 — 조용히 무시하면 스킬이 사라진 줄 아무도 모른다. */

import { SimInputError, ElementCode, lookupCode, normalizeRange } from './codes.js';

export const DURATION_PRESETS_SEC = Object.freeze({ SHORT: 90, STANDARD: 180 });
export const ALLOWED_FRAME_RATES = new Set([30, 60]);

export const DEFAULT_SIM_OPTIONS = Object.freeze({
  durationSec: DURATION_PRESETS_SEC.STANDARD,
  frameRate: 60,

  /* ── 버스트 (§3.1, §10) ──────────────────────────────────

     `firstBurstAtSec` 는 `burstGaugeMode: 'fixed'` 에서만 쓴다. 실측 모드
     (`'accumulate'`)는 게이지가 실제로 차는 시각이 정한다. */
  firstBurstAtSec: 3.0,
  burstSwitchDelaySec: 0.1,
  burstReenterDelaySec: 0.5,
  maxBurstCount: null,
  burstSequence: null,
  burstGaugeMode: 'accumulate',   // 'fixed' | 'accumulate'

  rngMode: 'random',              // 'random' | 'expected'
  cameraCharacterId: null,
  cameraMode: 'single',
  logLevel: 'summary',            // 'none' | 'summary' | 'full'

  /* ── 실측 상수 (등기부 메커니즘 13·15·16) ────────────────

     명세에 없는 값이다. 명세가 구조를 정하고, 이 숫자들은 화면 녹화에서 나왔다. */

  /* 만충 기준값, 표적 하나 기준이다 (메커니즘 13). nikke.top 의 `perTargetShot / baseChargeRate` 가 88명 중 86명에서 200 이라 20,000 으로 못박힌다. */
  burstGaugeMax: 20000,
  /* 한 발이 표적 몇 개에 닿는가. 게이지만 표적마다 차고 대미지는 아니다. 콘텐츠마다 다르다 (신데렐라 : CW 1.96, 하베스터 9) — 열린 물음 N. */
  targetCount: 2,
  /* 게이지가 차고 사람이 Ⅰ 을 누르기까지 (메커니즘 15). 풀 스쿼드 영상 10사이클 중앙값이다.
     첫 누름에만 실린다 — Ⅱ·Ⅲ 은 연출이 끝나는 프레임에 이미 눌려 있다. */
  burstPressDelaySec: 0.52,
  /* 컷신은 사이클에서 뺀다 (메커니즘 15) — 연출 중에는 전투가 안 흐르므로 시뮬레이션 시간이 아니다.
     컷신 중에도 흐르는 부분이 밝혀지면 여기에 그 몫만 넣는다 (열린 물음 M). */
  burstCutInSec: 0,
  fullBurstEnterDelaySec: 0,
  /* 체인 창 (메커니즘 3). 한 단계를 누른 뒤 이 안에 다음 단계가 안 나오면 체인이 무효가 되고 게이지가 0 부터 다시 찬다. */
  burstChainWindowSec: 10,
  fullBurstDurationSec: 10,

  /* 사격 (메커니즘 14). 전부 화면 녹화 실측이다. */
  reloadMotionSec: 0.2,
  heatDecayCurve: [[0, 1], [0.3, 1], [0.5, 0.39], [0.8, 0.25], [1.05, 0.13],
                   [1.15, 0.03], [1.4, 0]],

  /* 코어 명중 확률의 모델 상수 (§7.1). 없으면 확률 계산을 거부한다 — 대신 `target.coreAlwaysHit` 로 메커니즘 19 를 쓴다. */
  coreProbabilityExponent: null,

  controlMode: 'auto',            // 'auto' | 'manual'
  manualChargeRatio: 1,
  sampleIntervalSec: 0,
  rngSeed: 1,
});

export const DEFAULT_TARGET = Object.freeze({
  defense: 31784,
  elementCode: null,
  coreDiameterPx: 0,
  hasParts: false,
  hasBlockPart: false,
  /* 메커니즘 19 — 코어에 닿는 적이면 평타는 전부 코어 명중으로 본다. 빈도를 안 두므로 상한값이고, 조준 실수는 모형 밖이다. */
  coreAlwaysHit: false,
  optimalRangeWeaponCodes: [],
  engagementRange: null,          // 'near' | 'mid' | 'far'
});

export function secToFrame(sec, frameRate) {
  return Math.max(0, Math.round(sec * frameRate));
}

export function frameToSec(frameIdx, frameRate) {
  return frameIdx / frameRate;
}

/* 프레임 수는 종료 시각을 포함해 한 번 더 실행하지 않는다 (§5).
   90초 · 30 FPS 는 정확히 2,700프레임이고 범위는 0 부터 2,699 까지다. */
export function normalizeSimOptions(input = {}) {
  const options = { ...DEFAULT_SIM_OPTIONS, ...input };
  const durationSec = Number(options.durationSec);
  const frameRate = Number(options.frameRate);

  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new SimInputError('durationSec 은 0 보다 큰 유한한 수여야 합니다',
      { durationSec: options.durationSec });
  }
  if (!ALLOWED_FRAME_RATES.has(frameRate)) {
    throw new SimInputError('frameRate 는 30 또는 60 이어야 합니다',
      { frameRate: options.frameRate });
  }
  if (options.rngMode !== 'random' && options.rngMode !== 'expected') {
    throw new SimInputError("rngMode 는 'random' 또는 'expected' 여야 합니다",
      { rngMode: options.rngMode });
  }
  if (options.burstGaugeMode !== 'fixed' && options.burstGaugeMode !== 'accumulate') {
    throw new SimInputError("burstGaugeMode 는 'fixed' 또는 'accumulate' 여야 합니다",
      { burstGaugeMode: options.burstGaugeMode });
  }
  if (!(options.burstGaugeMax > 0)) {
    throw new SimInputError('burstGaugeMax 는 0 보다 커야 합니다',
      { burstGaugeMax: options.burstGaugeMax });
  }

  const totalFrames = Math.max(1, Math.round(durationSec * frameRate));

  return Object.freeze({
    ...options,
    durationSec,
    frameRate,
    frameSec: 1 / frameRate,
    totalFrames,
    /* 지정 시간이 프레임 길이로 안 나누어지면 가장 가까운 프레임에 맞춘다. 결과에는 원래 값과 적용된 값을 둘 다 남긴다 (§5). */
    effectiveDurationSec: totalFrames / frameRate,
    requestedDurationSec: durationSec,
  });
}

export function normalizeTarget(input = {}) {
  const target = { ...DEFAULT_TARGET, ...input };
  if (!Number.isFinite(target.defense) || target.defense < 0) {
    throw new SimInputError('target.defense 는 0 이상의 유한한 수여야 합니다',
      { defense: input.defense });
  }
  /* 속성은 **여기서 정수 코드로 바꾼다.** 문자열로 남겨 두면 캐릭터 쪽은 코드,
     적 쪽은 문자열이라 우월 코드 비교가 영영 거짓이 된다. */
  const elementCode = target.elementCode == null
    ? null
    : lookupCode(ElementCode, target.elementCode, 'elementCode', { target: true });
  return Object.freeze({
    ...target,
    elementCode,
    engagementRange: normalizeRange(target.engagementRange),
    optimalRangeWeaponCodes: Object.freeze([...(target.optimalRangeWeaponCodes || [])]),
  });
}

/* 중복 ID 는 오류다 (§13) — 조용히 덮어쓰면 한 명이 통째로 사라진다. */
export function assertUniqueIds(items, kind) {
  const seen = new Set();
  for (const item of items) {
    if (item.id == null || item.id === '') {
      throw new SimInputError(`${kind} 의 id 가 비어 있습니다`, { kind });
    }
    if (seen.has(item.id)) {
      throw new SimInputError(`중복된 ${kind} id: '${item.id}'`, { kind, id: item.id });
    }
    seen.add(item.id);
  }
}

/* ── 시드 난수 (§7.2) ─────────────────────────────────────

   `Math.random()` 을 직접 부르지 않는다 (mulberry32). 같은 입력·같은 시드면 같은 결과여야 편성 둘을 비교할 수 있다. */
export function createRng(seed = 1) {
  let a = (seed >>> 0) || 1;
  const next = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, seed };
}
