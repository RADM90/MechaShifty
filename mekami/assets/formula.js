/* 한 발의 대미지 — 시간도 DOM 도 모르는 순수 모듈.

   구조는 `Model_combat_mechanics.md` §4 를 그대로 옮겼다. 이 게임의 대원칙은
   **같은 계열은 합연산, 다른 계열은 곱연산** 이고, 레이어를 잘못 묶는 것이
   계산기에서 가장 흔한 오류라 레이어를 함수로 갈라 놨다.

     타격 = Element × DamageMultiplier × BonusMultiplier
          × EffectiveAttack × ChargeMultiplier × SkillCoefficient

   BonusMultiplier 가 특히 헷갈리는 자리다. 크리티컬·코어·풀버스트·거리는 **서로
   곱하지 않고 더한다.** 커뮤니티 실측이 이걸 못박아 준다 (test/formula.test.js):

     기본 2521 -> 크리 3781(×1.5) -> 코어 5042(×2.0) -> 코어+크리 6302(×2.5)
     -> 코어+크리+풀버 7563(×3.0)      즉 1 + 0.5 + 1.0 + 0.5

   확률 항(크리티컬·코어)은 몬테카를로가 아니라 **해석적 기댓값**으로 넣는다.
   장시간 누적에서는 대수의 법칙으로 충분히 정확하고, 버스트 순서를 비교할 때
   난수가 끼면 순위가 흔들려 비교 자체가 안 된다. */

/* 게임 상수. 전부 문서 §4.2 의 표에서 왔고 신뢰도를 주석에 남긴다.
   무기·니케마다 다른 값(코어 대미지 200%, 크리 15%/150%)은 여기 두지 않는다 —
   CDN 이 니케별로 주므로 데이터에서 읽는다. */
export const RULE = {
  CRIT_RATE: 0.15,      // 기본 크리티컬 확률          [관측]
  CRIT_DMG: 0.50,       // 기본 크리티컬 대미지         [확정]
  FULL_BURST: 0.50,     // 풀버스트                    [확정]
  DISTANCE: 0.30,       // 적정 거리                   [관측]
  ELEMENT: 1.10,        // 우월코드 기본                [확정]
};

/* 공격 유형. 어떤 보너스가 붙는지가 이걸로 갈린다 (문서 §4.3).

     보너스        평타  스킬1·2  버스트
     코어 히트      O     X       X
     차지 대미지     O     X       X
     거리 보너스     O     X       X
     풀버스트       O     O       X   <- 버스트 스킬 자신만 제외
     크리티컬       O     O       O
     우월코드·공증   O     O       O

   버스트 스킬이 풀버스트를 못 받는 이유는 순서다 — 버스트를 쓰고 나서 풀버스트에
   들어가므로, 버스트 스킬 자체는 진입 전에 판정된다. 문서가 "빈번한 버그 지점"
   으로 지목한 곳이라 표를 코드로 박아 둔다. */
export const KIND = { NORMAL: 'normal', SKILL: 'skill', BURST: 'burst' };

const APPLIES = {
  [KIND.NORMAL]: { core: true, charge: true, distance: true, fullBurst: true },
  [KIND.SKILL]: { core: false, charge: false, distance: false, fullBurst: true },
  [KIND.BURST]: { core: false, charge: false, distance: false, fullBurst: false },
};

const sum = (o, k) => (o && o[k]) || 0;

/* ── 레이어 ────────────────────────────────────────────────── */

/* ① 속성. 우월코드면 1.1 에 우코 대미지 증가를 **더한다**. 오버로드 옵션·큐브의
   안티 코드 HC·스킬이 전부 이 한 칸에 합산된다. */
export function elementLayer(buff, isElement) {
  return isElement ? RULE.ELEMENT + sum(buff, 'elemDmg') : 1;
}

/* ② 대미지 증감. '주는 대미지'와 '받는 대미지(적 디버프)'는 서로 다른 계열이라
   곱한다. 각 계열 안은 합이다. */
export function damageLayer(buff) {
  return (1 + sum(buff, 'damageUp')) * (1 + sum(buff, 'receivedUp'));
}

/* ③ 타격 판정 보너스. 여기가 전부 합연산이다.

   코어의 기본값은 무기가 들고 있다 — CDN 의 `coreDamage` 가 200(%) 이면 보너스는
   +1.0 이다. 소장품(AR +17.04%)·옵션이 그 위에 더해진다. 무기군마다 200% 가
   맞는지는 문서 §8-3 이 미검증으로 남겨 뒀는데, 데이터에서 읽으므로 다른 값이
   나오면 저절로 따라간다. */
export function bonusLayer(buff, kind, ctx) {
  const on = APPLIES[kind] || APPLIES[KIND.SKILL];
  const critRate = Math.min(RULE.CRIT_RATE + sum(buff, 'critRate'), 1);
  const critDmg = RULE.CRIT_DMG + sum(buff, 'critDmg');
  let bonus = 1 + critRate * critDmg;

  if (on.fullBurst && ctx.fullBurst) bonus += RULE.FULL_BURST;
  if (on.core && ctx.coreHitRate > 0) {
    const base = (ctx.coreDamage || 200) / 100 - 1;      // 200% -> +1.0
    bonus += ctx.coreHitRate * (base + sum(buff, 'coreDmg'));
  }
  /* 거리 보너스는 적정 사거리 안에서만. RL 은 니케 데이터의 사거리가 [0,0] 이라
     "거리 무관"이 제원에 이미 들어 있다 — 무기군을 보고 예외 처리하지 않는다. */
  if (on.distance && ctx.inRange) bonus += RULE.DISTANCE;
  return bonus;
}

/* ④ 유효 공격력. 방어력은 곱이 아니라 **뺄셈**이다. 발당 대미지가 낮은 무기군
   (SMG·MG)이 고방어 적에게 극단적으로 불리한 이유가 이것이다.

   `atkFlat` 은 "시전자 기준 공격력 N% ▲" 가 남긴 값이다. 그 버프는 받는 쪽의
   공격력이 아니라 **시전자의 최종 공격력**에 비례하므로, 버프를 걸 때 시전자
   공격력을 재서 고정 수치로 넣어 둔다. 참조 계산기들이 크라운을 화력형 43% /
   지원형 53.75% / 방어형 64% 표로 박아 두는 건 이걸 클래스별로 미리 환산해 둔
   것인데, 우리는 시전자의 실제 공격력을 아니까 직접 계산한다. */
export function attackLayer(atk, buff, enemyDef) {
  const total = atk * (1 + sum(buff, 'atkPct')) + sum(buff, 'atkFlat');
  return total - (enemyDef || 0);
}

/* ⑤ 차지. 평타 전용이다.

   여기 들어가는 것은 '차지 대미지 증가' 옵션·큐브·소장품뿐이다. 풀차지 자체의
   배율(아니스 250%)은 그 발의 계수라 `ratio` 쪽에서 곱한다 — 레이어를 섞으면
   차지 옵션이 없을 때도 배율이 남거나 사라진다. */
export function chargeLayer(buff, kind) {
  return APPLIES[kind] && APPLIES[kind].charge ? 1 + sum(buff, 'chargeDmg') : 1;
}

/* ── 한 발 ─────────────────────────────────────────────────── */

/* ctx: { enemyDef, isElement, fullBurst, inRange, coreHitRate, coreDamage }
   buff: 계열별로 합쳐진 배수 모음 (비율. 34% 는 0.34)
   ratio: 그 발의 계수 (평타 5.57% -> 0.0557, 버스트 2808% -> 28.08)

   돌려주는 breakdown 은 화면에서 "무엇이 얼마나 기여했는지" 를 보여주는 데 쓴다.
   숫자 하나만 주면 틀렸을 때 어디가 틀렸는지 알 수가 없다. */
export function hitDamage({ atk, ratio, kind = KIND.NORMAL, buff = {}, ctx = {} }) {
  const element = elementLayer(buff, !!ctx.isElement);
  const damage = damageLayer(buff);
  const bonus = bonusLayer(buff, kind, ctx);
  const charge = chargeLayer(buff, kind);
  const raw = attackLayer(atk, buff, ctx.enemyDef);

  /* 유효 공격력이 음수면 대미지 하한이 얼마인지는 문서 §8-1 도 미검증이다.
     0 으로 자르고 그 사실을 밖으로 알린다 — 조용히 음수를 곱해서 부호가 뒤집힌
     누적 대미지를 내놓는 것보다 낫다. */
  const capped = Math.max(raw, 0);
  const value = element * damage * bonus * capped * charge * ratio;

  return {
    value,
    underDefended: raw <= 0,
    breakdown: { element, damage, bonus, attack: capped, charge, ratio },
  };
}

/* ── 장탄수 ────────────────────────────────────────────────── */

/* 문서 §3.3. 단순 합산 후 한 번 반올림이 아니다.

     계열 A  오버로드 장탄 옵션 + 장탄 증감 스킬
     계열 B  하모니 큐브
     계열 C  기타

   계열마다 **언제나 기본 장탄수를 기준으로** 계산하고 **계열별로 따로 반올림**
   한다. 전부 합쳐 한 번에 반올림하면 1발이 어긋나는데, 기본 장탄이 적은
   SR(6발)·SG(9발)·RL(5발)에서는 그 1발이 DPS 를 10% 넘게 흔든다. */
export function resolveAmmo(baseAmmo, series = {}) {
  let total = baseAmmo;
  for (const key of Object.keys(series)) {
    total += Math.round(baseAmmo * (series[key] || 0));
  }
  return Math.max(1, total);
}

/* ── 전투력 패널티 ─────────────────────────────────────────── */

/* 문서 §6.1 이 "딜 계산에서 가장 자주 누락되는 요소"로 꼽은 것.
   대미지 %가 아니라 **스탯 자체**를 깎으므로 시뮬레이션에 들어가기 전에 반영해야
   한다. 감소율 표는 MechaShifty 가 이미 들고 있다 (`data/raw/cp_penalty.json`,
   `assets/cp.js` 의 `penalty()`). 여기서는 그 결과를 스탯에 먹이기만 한다. */
export function applyPenalty(stats, rate) {
  if (!rate) return { ...stats };
  const k = 1 - rate;
  return { hp: stats.hp * k, atk: stats.atk * k, def: stats.def * k };
}
