/* 효과 DSL — 손으로 쓴 스킬 해석을 엔진이 읽는 모양으로 바꾼다. DOM 을 모른다.

   CDN 은 스킬을 산문으로만 준다. 버프의 대상·트리거·스택 규칙은 기계가 읽을
   형태로 없고, 그걸 가리키는 함수 표는 공개돼 있지 않다. 그래서 *의미* 는
   `mekami/data/effects/cNNN.json` 에 손으로 적는다.

   **그 파일은 숫자를 적지 않는다.** `{"v": 7}` 은 "이 스킬의 7번째 값 자리"라는
   뜻이고, 실제 수치는 CDN 이 준 `values[6][레벨-1]` 에서 온다. 스킬 레벨을 바꾸든
   밸런스 패치가 오든 값이 저절로 따라오고, 손으로 관리하는 것은 "어느 스탯을·
   누구에게·언제·얼마 동안" 뿐이라 잘 안 바뀐다.

   규칙 한 줄의 모양:

     { "on": "fullBurstStart",              언제
       "if": { "selfState": "전투 보조" },    조건 (없으면 무조건)
       "to": "allies",                      누구에게
       "apply": [ { "stat": "damageUp", "v": 7, "dur": { "v": 8 } } ],
       "set":   { "state": "전투 보조" },     이름 붙은 상태 부여
       "clear": ["나만의 별"],                상태 제거
       "hit":   { "ratio": { "v": 5 }, "kind": "burst" } }   즉시 대미지

   반영하지 못한 효과는 지우지 않고 `unmodeled` 에 원문을 적어 둔다. 화면이 그걸
   그대로 띄운다 — 계산에 안 들어간 것을 숨기면 결과를 믿을 수가 없다. */

/* **특정 공격 타입에만 걸리는 배수.** 니케 199명의 스킬 문구를 전수 조사해 뽑았고,
   하모니 큐브가 같은 분류를 그대로 보여 준다 (렐릭 디바이드=분배 · 렐릭 피어싱=관통 ·
   렐릭 크래시=방어력 무시 · 렐릭 디스트로이=파츠 · 택티컬 어설트=차지).

   범용 버킷과 갈라 두는 이유가 크다. 예를 들어 마스트 : 로망틱 메이드의
   "분배 대미지 15.03% X 취기 중첩 수 ▲" 를 '받는 대미지' 로 넣으면 스쿼드 전체
   대미지에 ×1.45 가 붙어 버리는데, 실제로는 **분배 공격이 하나도 없으면 0** 이다.
   분배 대미지를 만드는 건 홍련 : 흑영의 1스킬 같은 특정 스킬뿐이다.

   문구가 두 모양으로 나온다:
     [최종 공격력 565% 분배 대미지]   그 타입의 타격을 만든다  -> hit.type
     [분배 대미지 15.03% ▲]          그 타입에만 걸리는 배수    -> 여기 스탯 */
const TYPE_DMG_LIST = [
  'distributedDmg',   // 분배 대미지
  'dotDmg',           // 지속 대미지
  'trueDmg',          // 방어력 무시 대미지
  'chargeDmg',        // 차지 대미지 (차지 평타)
  'pierceDmg',        // 관통 대미지
  'partsDmg',         // 파츠 대미지
  'blockDmg',         // 저지 부위 공격 대미지
  'explosionDmg',     // 발사체 폭발 대미지
  'stickDmg',         // 발사체 부착 대미지
  'normalAtkPct',     // 일반 공격 대미지 배율
  'burstSkillDmg',    // 버스트 스킬 대미지
  /* 자칼 버스트: "대상 설명이 '~ 적 1기에게'로 끝나는 버스트 스킬 대미지 ▲".
     헬름·신데렐라 : 크리스탈 웨이브처럼 단일 대상 버스트에만 걸린다. 그런 타격은
     ['burstSkillDmg', 'singleBurstDmg'] 두 타입을 함께 단다. */
  'singleBurstDmg',
  'sequentialDmg',    // 순차 공격 대미지
  'shieldDmg',        // 보호막에 가하는 대미지
];
export const TYPE_DMG = new Set(TYPE_DMG_LIST);

/* 스탯 이름. 엔진의 계열 버킷과 1:1 이라 여기 없는 이름은 오타로 본다.
   틀린 이름을 조용히 무시하면 효과가 통째로 사라진 것을 아무도 모른다. */
export const STATS = new Set([
  /* 모든 공격에 곱해지는 범용 버킷. 레이어가 정해져 있다 (formula.js). */
  'atkPct', 'atkFromCaster', 'damageUp', 'receivedUp', 'elemDmg',
  'critRate', 'critDmg', 'defPct',
  /* 코어 대미지는 타입 배수가 아니다. 무기 제원의 "코어 대미지 200%" 에 **합연산**
     으로 얹혀 BonusMultiplier 의 코어 항으로 들어간다 (formula.js). */
  'coreDmg',
  /* "일반 공격을 방어력 무시 대미지로 적용" (은화 : 택티컬 업). 평타의 타입 자체를
     바꿔 방어력 무시 배수를 받고 **뺄셈 방어력도 건너뛴다**. */
  'normalAsTrue',
  /* 레드 후드: "차지 속도 100% 초과 시 초과된 값을 차지 대미지로 변환".
     값은 변환 배수 (초과분의 240% -> 2.40). */
  'chargeOverflow',
  // 시간·자원 레이어
  'chargeSpeed', 'chargeTimeFix', 'reloadSpeed', 'maxAmmo', 'ammoCharge',
  'spinupRate', 'burstGaugeSpeed', 'explosionRange',
  // 트리거 조건 자체를 깎는 것 (라피 : 레드 후드 "스킬2 발동 횟수 조건 60회 ▼")
  'shotCondition',
  ...TYPE_DMG_LIST,
]);

/* 즉발이라 지속시간이 없는 것들. "버스트 스킬 재사용 시간 7.48초 ▼" 는 버프가
   아니라 그 순간 남은 쿨타임을 깎는 행위다. 버프로 다루면 지속시간이 끝날 때
   쿨타임이 되돌아가 버린다.

   `burstGauge` 는 "[버스트 게이지 충전 12%]" 의 **만충 대비 퍼센트**다. 그래서
   RATIO_STATS 에 넣지 않는다 — 100 으로 나누는 것은 만충 값을 곱하는 엔진 쪽 일이다.
   게이지는 스쿼드가 하나를 공유하므로 "아군 전체에게" 라고 적혀 있어도 한 번만 찬다. */
export const INSTANT_STATS = new Set(['burstCooldown', 'burstGauge', 'heal', 'stun']);

/* 버스트 단계 진입은 단계별로 이름을 나눈다. 조건으로 빼면 규칙마다 `if` 를 하나씩
   더 달아야 하는데, 트리거 이름이 곧 조건이면 효과표가 원문과 더 닮는다
   ("버스트 1단계 진입 시" -> burstStep1Enter). */
export const TRIGGERS = new Set([
  'battleStart', 'fullBurstStart', 'fullBurstEnd', 'burstUse',
  'burstStep1Enter', 'burstStep2Enter', 'burstStep3Enter',
  'shots', 'coreHits', 'reloadDone', 'interval', 'fullChargeHit', 'healApplied',
  /* "아군이 소비한 탄의 총합이 N발이 될 때 마다" — 스쿼드가 함께 세는 카운터다.
     자기 사격만 세는 `shots` 와 달라서, MG 아군이 있으면 훨씬 빨리 돈다.
     신데렐라 : 크리스탈 웨이브·리틀 머메이드가 이걸로 버스트 게이지를 채운다. */
  'squadShots',
  /* "마지막 탄환 명중 시" — 탄창을 비우는 그 한 발. 장탄 수를 **줄이는** 스킬이
     이걸 더 자주 터뜨리는 설계가 있다 (프리바티 1스킬이 장탄을 50% 깎는다). */
  'lastBullet',
]);

export const TARGETS = new Set([
  'self', 'allies', 'alliesLowerDef', 'highestAtkAlly', 'lowestDefAlly',
  'burstUsersThisCycle', 'nonBurstUsersThisCycle', 'enemy',
]);

const SLOTS = ['s1', 's2', 'burst'];

/* ── 값 풀기 ───────────────────────────────────────────────── */

/* `{v: 7}` -> 그 스킬 7번째 자리의, 이 스킬 레벨에서의 값.
   `{n: 12.5}` -> 그대로 (미출시 니케를 손으로 넣을 때 쓴다).

   자리가 비었거나 레벨이 표를 벗어나면 조용히 0 을 주지 않고 알린다 — 0 은
   "효과 없음"과 구별이 안 돼서 틀린 계산이 조용히 지나간다. */
export function valueOf(spec, values, level, where, problems) {
  if (spec == null) return null;
  if (typeof spec === 'number') return spec;
  if (typeof spec.n === 'number') return spec.n;
  if (typeof spec.v !== 'number') {
    problems.push(`${where}: 값 자리를 못 읽었습니다 (${JSON.stringify(spec)})`);
    return 0;
  }
  const row = values && values[spec.v - 1];
  if (!row) {
    problems.push(`${where}: {${spec.v}} 자리가 데이터에 없습니다`);
    return 0;
  }
  const got = row[Math.min(Math.max(level, 1), row.length) - 1];
  if (typeof got !== 'number') {
    problems.push(`${where}: {${spec.v}} 레벨 ${level} 값이 숫자가 아닙니다 (${got})`);
    return 0;
  }
  return got;
}

/* 퍼센트로 적힌 값을 배수로 눕힌다. 게임 문구가 "34%" 면 계산에서는 0.34 다.
   초·발·회처럼 퍼센트가 아닌 자리는 그대로 둔다. */
const RATIO_STATS = new Set([
  'atkPct', 'atkFromCaster', 'damageUp', 'receivedUp', 'elemDmg', 'critRate',
  'critDmg', 'coreDmg', 'partsDmg', 'pierceDmg', 'normalAtkPct', 'chargeDmg',
  'defPct', 'chargeSpeed', 'reloadSpeed', 'maxAmmo', 'spinupRate',
  'burstGaugeSpeed', 'explosionRange', 'coreDmg',
  ...TYPE_DMG_LIST,
]);

/* ── 컴파일 ────────────────────────────────────────────────── */

/* 전투 한 판 동안 스킬 레벨은 안 바뀌므로 값을 미리 다 풀어 둔다. 매 발마다
   자리를 되짚으면 5천 발 × 5인이 그대로 낭비다.

   애장품은 스킬을 더하는 게 아니라 **갈아끼운다.** `favorite.replaces.s2` 가
   있으면 s2 의 값 표가 통째로 바뀌므로, 효과표도 애장품용 규칙(`s2@fav`)이
   있으면 그쪽을 쓴다. */
export function compile(effectDoc, combat, opts = {}) {
  const level = opts.levels || { s1: 10, s2: 10, burst: 10 };
  const favorite = !!opts.favorite;
  const problems = [];
  const rules = [];

  if (!effectDoc) {
    return { rules: [], unmodeled: [], problems: ['효과표가 없습니다'], stale: true };
  }

  /* 효과표를 쓸 때 본 원문과 지금 원문이 같은지. 다르면 해석이 낡았을 수 있다. */
  const stale = !!(effectDoc.textHash && combat.textHash
                   && effectDoc.textHash !== combat.textHash);

  for (const slot of SLOTS) {
    const favKey = `${slot}@fav`;
    const useFav = favorite && Array.isArray(effectDoc[favKey]);
    const list = useFav ? effectDoc[favKey] : effectDoc[slot];
    if (!Array.isArray(list)) continue;

    const source = (favorite && combat.favorite && combat.favorite.replaces
                    && combat.favorite.replaces[slot]) || (combat.skills || {})[slot];
    const values = source && source.values;
    const lv = level[slot] || 10;

    list.forEach((rule, i) => {
      const where = `${combat.rid ? 'c' + String(combat.rid).padStart(3, '0') : '?'} ${slot}[${i}]`;
      rules.push(compileRule(rule, values, lv, slot, where, problems));
    });
  }

  return { rules, unmodeled: effectDoc.unmodeled || [], problems, stale,
           confidence: effectDoc.confidence || '추정' };
}

function compileRule(rule, values, level, slot, where, problems) {
  const on = String(rule.on || '').split('|').filter(Boolean);
  for (const t of on) {
    if (!TRIGGERS.has(t)) problems.push(`${where}: 모르는 트리거 '${t}'`);
  }
  if (rule.to && !TARGETS.has(rule.to)) problems.push(`${where}: 모르는 대상 '${rule.to}'`);
  /* **모르는 조건은 반드시 짚는다.** `meets()` 는 모르는 키를 참으로 넘기므로, 오타가
     나면 조건이 통째로 사라져 규칙이 언제나 걸린다 — 조용히 과대 계산이 된다. */
  for (const k of Object.keys(rule.if || {})) {
    if (!COND_KEYS.has(k)) problems.push(`${where}: 모르는 조건 '${k}'`);
  }

  const apply = (rule.apply || []).map(a => {
    const known = STATS.has(a.stat) || INSTANT_STATS.has(a.stat);
    if (!known) problems.push(`${where}: 모르는 스탯 '${a.stat}'`);
    let value = valueOf(a, values, level, `${where} ${a.stat}`, problems);
    if (RATIO_STATS.has(a.stat)) value /= 100;
    if (a.dir === 'down') value = -value;
    return {
      stat: a.stat,
      value,
      instant: INSTANT_STATS.has(a.stat),
      series: a.series || 'A',                  // 장탄수 계열 (문서 §3.3)
      /* "분배 대미지 15.03% X 취기 중첩 수 ▲" — 값이 중첩 수에 비례하는 버프.
         중첩은 따로 세고 여기서는 어느 중첩을 보는지만 적는다. */
      perStack: a.perStack || null,
      duration: a.dur === 'permanent' || a.dur == null
        ? Infinity
        : valueOf(a.dur, values, level, `${where} dur`, problems),
    };
  });

  /* "사용 무기 변경" — 무기 제원을 통째로 갈아 끼운다. 원문이 바꾸는 항목만 적고
     나머지는 원래 무기를 그대로 쓴다.

       "weapon": { "damage": {"v":1}, "chargeTime": {"n":1}, "fullDamage": {"n":250},
                   "maxAmmo": {"n":15}, "type": "trueDmg", "dur": {"n":10} }

     Step3 딜러의 상당수가 이 장치로 굴러가서, 이게 없으면 그 니케들의 평타가
     통째로 틀린 배율로 계산된다. */
  const weapon = rule.weapon ? {
    label: rule.weapon.label || null,
    damage: num(rule.weapon.damage),
    maxAmmo: num(rule.weapon.maxAmmo),
    reload: num(rule.weapon.reload),
    coreDamage: num(rule.weapon.coreDamage),
    chargeTime: num(rule.weapon.chargeTime),
    fullDamage: num(rule.weapon.fullDamage),
    type: rule.weapon.type || null,
    duration: rule.weapon.dur == null ? Infinity
      : valueOf(rule.weapon.dur, values, level, `${where} weapon.dur`, problems),
  } : null;
  if (weapon) {
    for (const t of [].concat(weapon.type || [])) {
      if (!TYPE_DMG.has(t)) problems.push(`${where}: weapon.type 이 모르는 종류 '${t}'`);
    }
  }

  function num(spec) {
    return spec == null ? null : valueOf(spec, values, level, `${where} weapon`, problems);
  }

  /* "[취기 : 명중률 20% ▼] [3 중첩]" 처럼 이름 붙은 중첩을 쌓는 행위. */
  const stack = rule.stack ? {
    name: rule.stack.name,
    add: rule.stack.add == null ? 1 : rule.stack.add,
    max: valueOf(rule.stack.max, values, level, `${where} stack.max`, problems) || 1,
    clear: !!rule.stack.clear,                  // 최대 중첩에서 털어내는 스킬용
  } : null;

  /* `times` + `every` 는 "0.25초 간격으로 10초간" 같은 지속 타격을 편다
     (아니스 : 스타의 슈팅 스타). 한꺼번에 때려 버리면 풀버스트 +50% 를 받는
     구간이 통째로 어긋난다.
     `mult` 는 그 타격에만 걸리는 배수의 이름이다 — 라피 : 레드 후드의 유탄은
     "발사체 부착 대미지 ▲" 를 받지만 평타는 안 받는다. */
  const hit = rule.hit ? {
    kind: rule.hit.kind || 'skill',
    ratio: valueOf(rule.hit.ratio, values, level, `${where} hit`, problems) / 100,
    times: rule.hit.times || 1,
    every: rule.hit.every ? valueOf(rule.hit.every, values, level, `${where} hit.every`, problems) : 0,
    /* 이 타격의 종류. 그 종류의 배수만 곱해진다 — 분배 공격에만 분배 대미지가
       붙고, 유탄에만 발사체 부착 대미지가 붙는다. */
    type: rule.hit.type || rule.hit.mult || null,
    label: rule.hit.label || null,
    /* 이 타격이 버스트 게이지를 버는가. 기본은 번다 — 스킬 타격도 게이지를 채운다.
       "추가 대미지" 처럼 총알 한 발에 얹히는 판정만 `false` 로 끈다. 안 그러면 그
       한 발이 평타와 스킬로 두 번 세어진다. */
    gauge: rule.hit.gauge !== false,
    /* 원문이 "코어 명중 대미지" 라고 적은 타격 (신데렐라 : 크리스탈 웨이브 2스킬).
       스킬 타격이어도 코어 보너스를 받는다 — 가르는 것은 "평타냐 스킬이냐" 가 아니라
       **원문이 무엇이라고 선언했는가** 다.
       1세대 엔진은 이 필드를 안 보므로 그쪽 결과는 안 바뀐다. */
    '코어명중': rule.hit['코어명중'] === true,
  } : null;
  /* 한 타격이 여러 타입일 수 있다 — 신데렐라 : 크리스탈 웨이브의 버스트는
     '버스트 스킬 대미지'이면서 대상이 '적 1기'라 자칼의 조건부 배수도 받는다. */
  for (const t of (hit ? [].concat(hit.type || []) : [])) {
    if (!TYPE_DMG.has(t)) problems.push(`${where}: hit.type 이 모르는 대미지 종류 '${t}'`);
  }

  /* 상태에도 지속시간이 붙을 수 있다 (적에게 거는 "타겟 지정 … 10초 유지").
     `dur` 이 없으면 지속이다 — 아니스의 나만의 별처럼 해제 전까지 남는 것들. */
  const set = rule.set ? {
    ...rule.set,
    duration: rule.set.dur == null ? Infinity
      : valueOf(rule.set.dur, values, level, `${where} set.dur`, problems),
  } : null;

  return {
    on, where, slot,
    /* "[시작 횟수 별 효과] [하위 효과 중복 적용]" — 트리거가 **몇 번째로** 걸릴 때부터
       사는가. 1·2·3회째 갈래를 규칙 세 줄로 펴고 각각 `nth` 를 1·2·3 으로 두면,
       3회째에는 셋이 다 걸려 "하위 효과 중복 적용" 이 저절로 나온다.

       `limit`(전투 중 N회 발동)과 반대 방향이라 헷갈리기 쉽다 — `limit` 은 위에서
       자르고 `nth` 는 아래에서 연다.

       리타의 1스킬이 그 예다: 풀버스트 시작 1·2·3회째의 버스트 쿨감이 2.34 / 2.70 /
       3.17초인데, 3회째부터는 셋이 겹쳐 **8.21초**가 된다. 이걸 못 읽으면 리타가
       쓰이는 이유가 통째로 사라진다. */
    nth: rule.nth == null ? 0 : rule.nth,
    /* "전투 중 N회 발동" — 발동 횟수 제한. 꼬리표처럼 보이지만 아니다. 이걸
       빠뜨리면 한 번만 터져야 할 효과가 매번 터진다 (레드 후드의 버스트 쿨 40초
       감소가 매 버스트마다 걸리는 식으로). */
    limit: rule.limit == null ? 0
      : valueOf(rule.limit, values, level, `${where} limit`, problems),
    when: rule.if || null,
    to: rule.to || 'self',
    every: rule.every ? valueOf(rule.every, values, level, `${where} every`, problems) : 0,
    count: rule.count ? valueOf(rule.count, values, level, `${where} count`, problems) : 0,
    set,
    clear: rule.clear || null,
    apply, hit, stack, weapon,
    note: rule.note || '',
  };
}

/* ── 조건 ──────────────────────────────────────────────────── */

/* 조건은 **그 순간** 판정한다. 미리 계산해 두면 "공격력이 가장 높은 아군" 같은
   조건이 버프가 붙기 전 상태로 굳어, 고공격력 서브딜러가 메인딜러 버프를
   가로채는 실제 현상을 재현하지 못한다 (문서 §2.3). */
/* `check()` 가 아는 조건 이름. 여기 없는 키가 `if` 에 오면 compile 이 문제로 남긴다. */
export const COND_KEYS = new Set([
  'usedStep', 'selfState', 'squadHasStep1', 'squadHasWeapon',
  'stacksAtMax', 'hasStacks', 'burstUsedThisCycle', 'fullBurst', 'enemyState',
]);

export function meets(when, actor, sim) {
  if (!when) return true;
  for (const [key, want] of Object.entries(when)) {
    if (!check(key, want, actor, sim)) return false;
  }
  return true;
}

/* **"기본 버스트 단계가 Step 1인 아군" 에 안 들어가는 두 부류가 있다.**

     AllStep    그 자리에 **쓸 수는 있어도** 기본 단계가 아니다. 레드 후드를 1버스트로
                써도 라피 : 레드 후드는 여전히 전투 보조(1버스트)로 남는다.
     재진입     `[버스트 재진입 N단계]` 를 아군 전체에게 주는 니케 (아비스타·티아·
                앨리스 : 원더랜드 바니·루피 : 윈터 쇼퍼·차임).

   아니스 : 스타는 재진입 문구가 있어도 **여기 안 들어간다.** 그의 것은
   `[모두의 별 : 버스트 재진입 1단계로 변경]` 으로, 아군에게 주는 것이 아니라 조건이
   맞을 때 자기 재진입 단계를 바꾸는 상태다. 그를 빼 버리면 아니스 : 스타 + 라피 :
   레드 후드 조합이 통째로 뒤집힌다. */
const 재진입문구 = /\[\s*버스트\s*재진입\s*\{?(\d+)\}?\s*단계\s*\]/;
const 재진입메모 = new WeakMap();

/* 이 니케가 아군 전체에게 주는 재진입 단계 (1·2·3). 없으면 null.
   `[버스트 재진입 1단계]` 만 센다 — 아니스 : 스타의 `[모두의 별 : … 1단계로 변경]` 은
   자기 재진입 단계를 바꾸는 상태라 여기 안 들어간다. */
export function 재진입단계(combat) {
  if (!combat) return null;
  if (재진입메모.has(combat)) return 재진입메모.get(combat);
  let n = null;
  const skills = combat.skills || {};
  for (const k of ['s1', 's2', 'burst']) {
    const m = 재진입문구.exec(((skills[k] || {}).text || {}).ko || '');
    if (m) { n = Number(m[1]); break; }
  }
  재진입메모.set(combat, n);
  return n;
}

function 기본단계(a) {
  const c = a.combat;
  if (!c) return a.burst;
  return 재진입단계(c) != null ? '재진입' : c.burst;
}

function check(key, want, actor, sim) {
  switch (key) {
    /* AllStep 니케는 **어느 단계로 쓰였느냐에 따라 버스트가 갈린다** — 레드 후드의
       원문이 빈 줄로 세 갈래로 나뉘고, 순서대로 Step1·Step2·Step3 자리다. */
    case 'usedStep':
      return actor.usedStep === want;
    case 'selfState': {
      const negate = String(want).startsWith('!');
      const name = negate ? String(want).slice(1) : String(want);
      return actor.states.has(name) !== negate;
    }
    /* "기본 버스트 단계가 Step 1인 아군" — 자기 자신은 세지 않는다. 아니스와
       라피가 서로를 보고 단계를 바꾸는 판정이라 여기가 틀리면 스쿼드 전체가
       어긋난다. */
    case 'squadHasStep1':
      return sim.actors.some(a => a !== actor && 기본단계(a) === 'Step1') === !!want;
    case 'squadHasWeapon':
      return sim.actors.some(a => a !== actor && a.combat.shot.weapon === want);
    case 'stacksAtMax': {
      const st = actor.stacks.get(want);
      return !!st && st.count >= st.max;
    }
    case 'hasStacks':
      return (actor.stacks.get(want) || { count: 0 }).count > 0;
    case 'burstUsedThisCycle':
      return sim.cycle.used.has(actor.id) === !!want;
    case 'fullBurst':
      return sim.fullBurst === !!want;
    /* 적에게 걸린 상태 (기절·타겟 지정 …). 아군 상태와 달리 한 곳에 모아 둔다 —
       적이 하나라는 전제라 대상별로 나눌 필요가 없다. */
    case 'enemyState': {
      const negate = String(want).startsWith('!');
      const name = negate ? String(want).slice(1) : String(want);
      const until = sim.enemyStates.get(name);
      return (until != null && until > sim.t) !== negate;
    }
    default:
      return true;                              // compile 이 이미 problems 로 짚었다
  }
}

/* ── 대상 ──────────────────────────────────────────────────── */

export function resolveTargets(to, actor, sim) {
  const all = sim.actors;
  switch (to) {
    case 'self': return [actor];
    case 'allies': return all.slice();
    /* "자신과 자신보다 최종 방어력이 낮은 아군" — 방어력도 버프를 받으므로 그때
       그때 잰다. */
    case 'alliesLowerDef':
      return all.filter(a => a === actor || sim.finalDef(a) < sim.finalDef(actor));
    case 'highestAtkAlly':
      return [all.reduce((best, a) => (sim.finalAtk(a) > sim.finalAtk(best) ? a : best), all[0])];
    case 'lowestDefAlly':
      return [all.reduce((best, a) => (sim.finalDef(a) < sim.finalDef(best) ? a : best), all[0])];
    case 'burstUsersThisCycle':
      return all.filter(a => sim.cycle.used.has(a.id));
    case 'nonBurstUsersThisCycle':
      return all.filter(a => !sim.cycle.used.has(a.id));
    case 'enemy': return [];                    // 적 버프는 sim 이 따로 받는다
    default: return [actor];
  }
}
