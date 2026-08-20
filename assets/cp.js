/* 전투력(CP) 계산 — DOM 을 모르는 순수 모듈.

   공식의 출처와 검증 결과는 COMBAT_POWER.md 참고. 요약하면:
     스탯 = round((기본×돌파계수 + 호감도 + 콘솔 + 고정보정×돌파수) × 코강계수 + 장비4부위 + 큐브 + 소장품)
     CP   = (round(HP×0.7) + round(ATK×19.35) + round(DEF×70)) × ((4)+(5)) / 100

   시트를 그대로 옮기지 않은 곳이 두 군데 있고, 둘 다 실계정 176명 대조로 확인한 것이다:
     - 소장품 R0 계수. 시트는 0을 주지만(미착용과 혼동) 실제로는 skill1+6.33.
     - 레벨 보정. 시트는 전부 상한(cap)으로 짰지만 협전·솔레는 '고정'이라 사용자 레벨이 더 낮아도 지정 레벨로 올라간다. mode 로 구분한다. */

export const K = {
  HP: 0.7, ATK: 19.35, DEF: 70,          // 스탯 -> CP 환산 계수
  ELEM_DMG: 0.00828, OTHER_OPT: 0.0069,  // 오버로드 옵션 레벨 계수
  CUBE: 0.0092, COLLECTION: 0.0069,      // 큐브 / 소장품 계수
  PER_BREAK: 0.02, PER_CORE: 0.02,       // 돌파·코강 1단계당
  /* 돌파 1단계당 고정 증가량. 등급마다 다르다 — 니케별 roledata 의 stat_enhance_detail
     (grade_hp · grade_attack · grade_defence) 에서 왔고, 같은 등급이면 니케·클래스가 달라도 같다. */
  FIXED: {
    SSR: { hp: 3000, atk: 20, def: 100 },
    SR: { hp: 2300, atk: 18, def: 90 },
    R: { hp: 2300, atk: 16, def: 80 },
  },
  SKILL_BASE: 130,                       // 스킬계수의 기본값 (÷100)
  R_BONUS: 6.33, SR_BONUS: 10.66,        // 소장품 등급별 가산
  CUBE_LOW: 1, CUBE_HIGH: 4,             // 큐브 Lv<5 / Lv>=5 가산
};

/* Increase Elemental Damage(우월코드 대미지 증가) 만 계수가 다르다. */
export const ELEM_DAMAGE = '우코';
export const SLOTS = ['머리', '몸', '팔', '다리'];

/* 장비 등급 — 원본 표에는 티어(T1~T10)뿐이고, '기업' 은 T9 에 붙는 보너스다. */
export const TIERS = ['9티어_일반', '9티어_기업', '오버로드'];
const TIER_SEED = {
  '9티어_일반': ['T9', false],
  '9티어_기업': ['T9', true],
  오버로드: ['T10', false],
};

/* 계수는 곱이 아니라 괄호 하나 안의 합이다 — 5강 기업 장비는 기본의 1.8 배. */
export const ENHANCE_MAX = 5;
const GEAR_CORP_BONUS = 0.3;      // 장비 기업 == 니케 기업일 때
const GEAR_ENHANCE_BONUS = 0.1;   // 강화 1 단계당

/* 오버로드 옵션 이름의 다른 언어 표기. */
const OPTION_SHORT = {
  en: {
    우코: 'Elem.DMG', 공증: 'ATK', 장탄: 'Ammo', 크댐: 'Crit.DMG', 크확: 'Crit.Rate',
    차속: 'Chg.Speed', 명중: 'Hit', 방어: 'DEF', 차댐: 'Chg.DMG',
  },
  /* 일본어는 임의로 줄이지 않고 일본 커뮤니티 툴(nikke-tools 등)이 실제로 쓰는 표기를 그대로 따른다 —
     有利コード·最大装弾数·クリダメ·クリ率 … */
  ja: {
    우코: '有利コード', 공증: '攻撃力', 장탄: '装弾数', 크댐: 'クリダメ', 크확: 'クリ率',
    차속: 'チャージ速度', 명중: '命中率', 방어: '防御力', 차댐: 'チャージダメ',
  },
};
export const optionLabel = (name, lang) => (OPTION_SHORT[lang] || {})[name] || name;

/* 게임 정식 명칭. 좁은 칸에는 위의 약어를 쓰지만, 종합처럼 한 줄을 통째로 쓰는 자리에서는 인게임에 적힌 그대로 보여주는 쪽이 대조하기 좋다. */
const OPTION_FULL = {
  ko: {
    우코: '우월코드 대미지 증가', 공증: '공격력 증가', 장탄: '최대 장탄 수 증가',
    크댐: '크리티컬 대미지 증가', 크확: '크리티컬 확률 증가', 차속: '차지 속도 증가',
    명중: '명중률 증가', 방어: '방어력 증가', 차댐: '차지 대미지 증가',
  },
  en: {
    우코: 'Increase Elemental Damage', 공증: 'Increase ATK', 장탄: 'Increase Ammo',
    크댐: 'Increase Critical Damage', 크확: 'Increase Critical Rate',
    차속: 'Increase Charge Speed', 명중: 'Increase Hit Rate', 방어: 'Increase DEF',
    차댐: 'Increase Charge Damage',
  },
  ja: {
    우코: '有利コードダメージ増加', 공증: '攻撃力増加', 장탄: '最大装弾数増加',
    크댐: 'クリティカルダメージ増加', 크확: 'クリティカル確率増加',
    차속: 'チャージ速度増加', 명중: '命中率増加', 방어: '防御力増加',
    차댐: 'チャージダメージ増加',
  },
};
export const optionFullLabel = (name, lang) =>
  (OPTION_FULL[lang] || OPTION_FULL.ko)[name] || optionLabel(name, lang);

/* 돌파·코강 등급과 장비 등급도 데이터 키가 한국어 문자열이다('3돌'·'오버로드'). */
export function gradeLabel(key, t) {
  const core = /^([1-7])코강$/.exec(key);
  if (core) return t('cp.core', core[1]);
  const brk = /^([0-3])돌$/.exec(key);
  return brk ? t('cp.break', brk[1]) : key;
}
export const tierLabel = (key, t) => (key ? t('cp.tier_' + key) : '');

/* ── 원본 표 -> 조회용 인덱스 ────────────────────────────────
   data/raw/*.json 은 {columns, rows} 배열 형태라 그대로 쓰면 매번 컬럼을 찾아야 한다. */
export function buildTables(raw) {
  const ix = d => Object.fromEntries(d.columns.map((c, i) => [c.key, i]));
  const T = {};

  const s = raw.syncro_stat, si = ix(s);
  T.syncro = new Map();
  for (const r of s.rows) {
    T.syncro.set(`${r[si.rarity]}|${r[si.class]}|${r[si.level]}`, {
      hp: r[si.hp], atk: r[si.atk],
      def: Object.fromEntries(['smg', 'sg', 'ar', 'mg', 'sr', 'rl']
        .map(w => [w, r[si['def_' + w]]])),
    });
  }
  T.levels = [...new Set(s.rows.map(r => r[si.level]))].sort((a, b) => a - b);

  const a = raw.attraction_stat, ai = ix(a);
  T.bond = new Map(a.rows.map(r => [`${r[ai.class]}|${r[ai.level]}`,
    { hp: r[ai.hp], atk: r[ai.atk], def: r[ai.def] }]));
  T.bondMax = Math.max(...a.rows.map(r => r[ai.level]));

  const g = raw.attraction_grade, gi = ix(g);
  T.grades = g.rows.map(r => ({ key: r[gi.grade], breaks: r[gi.limit_break], cores: r[gi.core] }));

  /* 장비는 티어별 기본값만 들고, 강화·기업 보너스는 gearStat() 이 먹인다. */
  const e = raw.equip_stat, ei = ix(e);
  T.gearSeed = new Map(e.rows.map(r => [`${r[ei.class]}|${r[ei.slot]}|${r[ei.tier]}`,
    { hp: r[ei.hp], atk: r[ei.atk], def: r[ei.def] }]));

  const o = raw.equip_option, oi = ix(o);
  T.optionNames = o.columns.filter(c => c.key.startsWith('opt')).map(c => c.label.ko);
  T.optionLevels = o.rows.map(r => r[oi.level]);
  T.optionValue = new Map();               // '우코|10' -> 0.2215
  for (const r of o.rows) {
    T.optionNames.forEach((name, i) => T.optionValue.set(`${name}|${r[oi.level]}`, r[oi['opt' + i]]));
  }

  const c = raw.cube_stat, cci = ix(c);
  T.cube = new Map(c.rows.map(r => [r[cci.level],
    { hp: r[cci.hp], atk: r[cci.atk], def: r[cci.def], s1: r[cci.skill1], s2: r[cci.skill2] }]));
  T.cubeLevels = c.rows.map(r => r[cci.level]);

  const col = raw.collection_stat, li = ix(col);
  T.collection = new Map(col.rows.map(r => [`${r[li.kind]}|${r[li.grade]}`,
    { hp: r[li.hp], atk: r[li.atk], def: r[li.def], s1: r[li.skill1], s2: r[li.skill2] }]));
  T.collectionGrades = col.rows.filter(r => r[li.kind] === '소장품').map(r => r[li.grade]);
  T.favoriteLevels = col.rows.filter(r => r[li.kind] === '애장품').map(r => r[li.grade]);

  const b = raw.collection_bonus, bi = ix(b);
  T.console = new Map(b.rows.map(r => [r[bi.kind],
    { hp: r[bi.hp], atk: r[bi.atk], def: r[bi.def] }]));

  if (raw.cp_penalty) {
    const p = raw.cp_penalty, pi = ix(p);
    // 부족률 오름차순. 조회는 '주어진 값 이하 중 가장 큰 항목'.
    T.penalty = p.rows.map(r => [r[pi.deficit], r[pi.penalty]]).sort((x, y) => x[0] - y[0]);
  }
  return T;
}

const ZERO = { hp: 0, atk: 0, def: 0 };
const add = (a, b, k = 1) => ({ hp: a.hp + b.hp * k, atk: a.atk + b.atk * k, def: a.def + b.def * k });

/* ── 구성요소별 스탯 ───────────────────────────────────────── */
function baseStat(T, n, level) {
  const row = T.syncro.get(`${n.rarity}|${n.class}|${level}`);
  if (!row) return null;
  const def = row.def[(n.defWeapon || n.weapon || '').toLowerCase()];
  return def == null ? null : { hp: row.hp, atk: row.atk, def };
}

function cubeOf(T, level) {
  const row = T.cube.get(String(level));
  if (!row || level === '미착용') return { stat: ZERO, coef: 0 };
  const lv = Number(level);
  const coef = lv < 5 ? row.s1 + K.CUBE_LOW : row.s1 + row.s2 + K.CUBE_HIGH;
  return { stat: row, coef };
}

/* 소장품. kind 는 'none' | 'R' | 'SR' | '애장품'. */
function collectionOf(T, kind, level) {
  if (kind === 'none') return { stat: ZERO, coef: 0 };
  if (kind === '애장품') {
    const row = T.collection.get(`소장품|SR15`);
    return { stat: T.collection.get(`애장품|${level}`) || row,
      coef: row.s1 + row.s2 + K.SR_BONUS };
  }
  const row = T.collection.get(`소장품|${kind}${level}`);
  if (!row) return { stat: ZERO, coef: 0 };
  // 시트는 R0 에 계수 0 을 주지만 그건 '미착용'과 혼동한 버그다 (COMBAT_POWER.md)
  return { stat: row, coef: kind === 'SR' ? row.s1 + row.s2 + K.SR_BONUS : row.s1 + K.R_BONUS };
}

function consoleOf(T, levels) {
  let out = ZERO;
  for (const [kind, lv] of Object.entries(levels)) {
    const unit = T.console.get(kind);
    if (unit && lv) out = add(out, unit, lv);
  }
  return out;
}

/* 장비 한 칸의 스탯 — 티어 기본값 × (1 + 기업일치 + 강화). */
export function gearStat(T, cls, slot, tier, enhance = 0) {
  const seed = TIER_SEED[tier];
  const base = seed && T.gearSeed.get(`${cls}|${slot}|${seed[0]}`);
  if (!base) return null;
  const k = 1 + (seed[1] ? GEAR_CORP_BONUS : 0)
    + Math.min(Math.max(enhance, 0), ENHANCE_MAX) * GEAR_ENHANCE_BONUS;
  return { hp: Math.round(base.hp * k), atk: Math.round(base.atk * k),
    def: Math.round(base.def * k) };
}

function gearOf(T, cls, gear) {
  let stat = ZERO, elemDmg = 0, other = 0;
  for (const g of gear || []) {
    if (!g || !g.tier) continue;
    const row = gearStat(T, cls, g.slot, g.tier, g.enhance || 0);
    if (row) stat = add(stat, row);
    for (const o of g.options || []) {
      if (!o || !o.name || !o.level) continue;
      if (o.name === ELEM_DAMAGE) elemDmg += o.level; else other += o.level;
    }
  }
  return { stat, elemDmg, other };
}

/* ── 본 계산 ──────────────────────────────────────────────── */
export function compute(T, input, level = input.level) {
  const grade = T.grades.find(g => g.key === input.grade) || { breaks: 0, cores: 0 };
  const base = baseStat(T, input, level);
  if (!base) return null;

  const breakK = 1 + K.PER_BREAK * grade.breaks;
  const coreK = 1 + K.PER_CORE * grade.cores;
  const bond = T.bond.get(`${input.class}|${input.bond}`) || ZERO;
  const con = consoleOf(T, input.console || {});
  const { stat: gearStat, elemDmg, other } = gearOf(T, input.class, input.gear);
  const cube = cubeOf(T, input.cube);
  const coll = collectionOf(T, input.collection?.kind || 'none', input.collection?.level);

  const fixed = K.FIXED[input.rarity] || K.FIXED.SSR;

  const stats = {};
  for (const k of ['hp', 'atk', 'def']) {
    const inner = base[k] * breakK + bond[k] + con[k] + fixed[k] * grade.breaks;
    stats[k] = Math.round(inner * coreK + gearStat[k] + cube.stat[k] + coll.stat[k]);
  }

  const s = input.skills || {};
  const skillCoef = (K.SKILL_BASE + (s.s1 || 0) + (s.s2 || 0) + (s.burst || 0) * 2) / 100;
  const c4 = skillCoef + elemDmg * K.ELEM_DMG + other * K.OTHER_OPT;
  // 시트가 이 항만 소수 4자리로 반올림한다. 결과가 달라지므로 그대로 따른다.
  const c5 = round(cube.coef * K.CUBE + coll.coef * K.COLLECTION, 4);

  const parts = {
    hp: Math.round(stats.hp * K.HP),
    atk: Math.round(stats.atk * K.ATK),
    def: Math.round(stats.def * K.DEF),
  };
  const cp = (parts.hp + parts.atk + parts.def) * (c4 + c5) / 100;

  return { level, stats, parts, skillCoef, elemDmg, other, c4, c5, cp,
    breaks: grade.breaks, cores: grade.cores };
}

const round = (v, d) => { const p = 10 ** d; return Math.round(v * p) / p; };

/* ── 컨텐츠별 보정 전투력 ──────────────────────────────────────
   cap = 사용자 레벨이 지정 레벨보다 높을 때만 깎는다
   (요격전) fix = 사용자 레벨과 무관하게 지정 레벨로 고정
   (협전·솔레·챔레나) none = 무보정 */
export function adjustedLevel(mode, level, at) {
  if (mode === 'cap') return Math.min(level, at);
  if (mode === 'fix') return at;
  return level;
}

export function byContent(T, input, contents) {
  return contents.map(c => {
    const lv = adjustedLevel(c.mode, input.level, c.level);
    const r = compute(T, input, lv);
    return { ...c, level: lv, cp: r ? r.cp : null, stats: r?.stats || null };
  });
}

/* ── 전투력 부족 페널티 ────────────────────────────────────────
   부족률 = round((대상 - 내CP) / 대상, 4) 이고, 표에서 그 값 이하의 가장 큰 항목을 고른다. */
export function penalty(T, targetCP, myCP) {
  if (!T.penalty || !targetCP || myCP >= targetCP) return { deficit: 0, penalty: 0 };
  const deficit = round((targetCP - myCP) / targetCP, 4);
  const probe = round(deficit, 3) + 0.0001;
  let hit = 0;
  for (const [d, p] of T.penalty) { if (d <= probe) hit = p; else break; }
  return { deficit, penalty: hit };
}
