/* 아레나 상대 난이도 프리셋 (화면 없음). 상대 스펙은 알 수 없으므로 고른 난이도의 가정 스펙으로 계정 로스터 항목과 같은 모양을 만든다.
   난이도: basic 기본(덱 구성만) · mirror 거울상(내 같은 니케 또는 같은 클래스·무기 평균) · pressure 실압근 · heavy 헤비급 · gorilla 메카고릴라.
   난이도별 돌파·스킬·장비·옵션 값은 TIERS, 옵션 배치는 LAYOUT, 니케별 분류는 data/arena_presets.json 에 있다. */

export const PRESETS = ['basic', 'mirror', 'pressure', 'heavy', 'gorilla'];

const SLOTS = ['머리', '몸', '팔', '다리'];
const RELOAD_CUBE = 1000303;
const CHARGE_CUBE = 1000305;

const TIERS = {
  pressure: {
    top: { grade: '4코강', skill: 10, gear: [5, 5, 5, 0], opt: 11 },
    rest: { grade: '3돌', skill: 7, gear: [4, 1, 3, 0], opt: 5 },
  },
  heavy: {
    top: { grade: '7코강', skill: 10, gear: [5, 5, 5, 5], opt: 11, chargeCube: true },
    rest: { grade: '3코강', skill: 10, gear: [5, 5, 5, 5], opt: 11, chargeCube: true },
  },
  gorilla: {
    top: { grade: '7코강', skill: 10, gear: [5, 5, 5, 5], opt: 15, chargeCube: true },
    rest: { grade: '7코강', skill: 10, gear: [5, 5, 5, 5], opt: 15, chargeCube: true },
  },
};

/* 부위별 옵션 3줄 */
const LAYOUT = {
  base: () => [0, 1, 2, 3].map(() => ['우코', '공증', '장탄']),
  charge: () => [0, 1, 2, 3].map(i => ['우코', '차속', i < 2 ? '공증' : '장탄']),
  cd4: () => [0, 1, 2, 3].map(() => ['우코', '공증', '크댐']),
  cd3am1: () => [0, 1, 2, 3].map(i => ['우코', '공증', i < 3 ? '크댐' : '장탄']),
  cd3cr1: () => [0, 1, 2, 3].map(i => ['우코', '공증', i < 3 ? '크댐' : '크확']),
};

const blank = level => ({
  level, grade: '0돌', bond: 1, skills: {}, cube: { tid: null, level: 0 }, arena_cube: { tid: null, level: 0 },
  collection: { kind: 'none', level: '0' }, gear: [],
});

const clone = e => JSON.parse(JSON.stringify(e));

/* 옵션 배치 이름 - critCore 의 layout 이 우선, 그다음 차속 핵심, 장탄 금지, 기본 */
export function layoutOf(rid, presets) {
  const crit = presets?.critCore?.[rid];
  if (crit) return crit.layout || 'cd4';
  if (presets?.chargeCore?.[rid]) return 'charge';
  if (presets?.noAmmo?.[rid]) return 'cd3cr1';
  return 'base';
}

export const isTier1 = (rid, presets) => !!presets?.tier1?.[rid];

/* 실압근·헤비급·메카고릴라 항목. nikke 는 nikkes.json 행(corporation 으로 호감도), weapon 은 arena.json 무기군. */
function tierEntry(preset, rid, { presets, nikke, weapon, level }) {
  const tier = TIERS[preset][isTier1(rid, presets) ? 'top' : 'rest'];
  const rows = LAYOUT[layoutOf(rid, presets)]();
  const cube = tier.chargeCube && (weapon === 'RL' || weapon === 'SR') ? CHARGE_CUBE : RELOAD_CUBE;
  return {
    level,
    grade: tier.grade,
    bond: nikke?.corporation === 'PILGRIM' ? 40 : 30,
    skills: { s1: tier.skill, s2: tier.skill, burst: tier.skill },
    cube: { tid: null, level: 0 },
    arena_cube: { tid: cube, level: 15 },
    collection: presets?.treasureDefault?.[rid] ? { kind: '애장품', level: '2.0' } : { kind: 'SR', level: '15' },
    gear: SLOTS.map((slot, i) => ({
      slot, tier: '오버로드', enhance: tier.gear[i],
      options: rows[i].map((name, k) => ({ name, level: tier.opt, pos: k + 1 })),
    })),
  };
}

/* 내 로스터에서 '키운' 니케: 오버로드 장비나 아레나 큐브가 있다 (arena.js 자동 편성과 같은 기준) */
export const invested = e => !!e && ((e.gear || []).some(g => g.tier === '오버로드') || !!e.arena_cube?.tid);

const mode = xs => {
  const c = new Map();
  for (const x of xs) c.set(x, (c.get(x) || 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
};
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/* 옵션 한 줄의 수치 - 차속·장탄은 arena.json 표, 그 밖은 cp.js optionValue (전투력 계산기와 같은 표) */
function optValue(name, level, { data, T }) {
  if (name === '차속') return data.options?.charge?.[level - 1] || 0;
  if (name === '장탄') return data.options?.ammo?.[level - 1] || 0;
  return T?.optionValue?.get(`${name}|${level}`) || 0;
}
/* 줄당 수치 v 에 가장 가까운 단계 */
function levelFor(name, v, env) {
  let best = 1, gap = Infinity;
  for (let l = 1; l <= 15; l++) {
    const d = Math.abs(optValue(name, l, env) - v);
    if (d < gap) { gap = d; best = l; }
  }
  return best;
}

/* 내 니케 여럿의 평균 육성. 스킬·장비 강화·큐브 레벨은 반올림 평균, 돌파·소장품·장비 등급·큐브 종류는 가장 흔한 값이다.
   옵션은 종류별 (줄 수 평균, 줄당 수치 평균)을 단계로 되돌려 부위에 나눠 싣는다. */
function averageEntry(list, env, level) {
  const out = blank(level);
  out.grade = mode(list.map(e => e.grade)) || '0돌';
  out.bond = Math.round(mean(list.map(e => e.bond || 0)));
  out.skills = Object.fromEntries(['s1', 's2', 'burst'].map(k => [k, Math.round(mean(list.map(e => e.skills?.[k] ?? 10))) || 1]));
  const cubed = list.filter(e => e.arena_cube?.tid);
  if (cubed.length * 2 >= list.length) {
    out.arena_cube = { tid: mode(cubed.map(e => e.arena_cube.tid)), level: Math.max(1, Math.round(mean(cubed.map(e => e.arena_cube.level)))) };
  }
  const coll = mode(list.map(e => `${e.collection?.kind || 'none'}|${e.collection?.level ?? '0'}`)).split('|');
  out.collection = { kind: coll[0], level: coll[1] };
  const tiers = SLOTS.map((_, i) => mode(list.map(e => e.gear?.[i]?.tier).filter(Boolean)) || '오버로드');
  const enh = SLOTS.map((_, i) => Math.round(mean(list.map(e => e.gear?.[i]?.enhance || 0))));
  /* 옵션: 종류별 니케당 평균 줄 수와 줄당 평균 수치 */
  const per = new Map();
  for (const e of list) {
    const lines = (e.gear || []).flatMap(g => g.options || []);
    for (const name of new Set(lines.map(o => o.name))) {
      const mine = lines.filter(o => o.name === name);
      const r = per.get(name) || { lines: 0, value: 0, n: 0 };
      r.lines += mine.length;
      r.value += mine.reduce((s, o) => s + optValue(name, o.level, env), 0);
      r.n += mine.length;
      per.set(name, r);
    }
  }
  const want = [...per.entries()]
    .map(([name, r]) => ({ name, lines: Math.round(r.lines / list.length), level: levelFor(name, r.value / Math.max(1, r.n), env) }))
    .filter(x => x.lines > 0)
    .sort((a, b) => b.lines - a.lines);
  const rows = SLOTS.map(() => []);
  for (const o of want) {
    for (let k = 0; k < Math.min(4, o.lines); k++) {
      const slot = rows.map((r, i) => i).filter(i => rows[i].length < 3 && !rows[i].some(x => x.name === o.name))
        .sort((a, b) => rows[a].length - rows[b].length)[0];
      if (slot == null) break;
      rows[slot].push({ name: o.name, level: o.level, pos: rows[slot].length + 1 });
    }
  }
  /* 오버로드가 아닌 부위에는 옵션을 싣지 않는다 */
  out.gear = SLOTS.map((slot, i) => ({ slot, tier: tiers[i], enhance: enh[i], options: tiers[i] === '오버로드' ? rows[i] : [] }));
  return out;
}

/* 거울상: 내 로스터의 같은 니케(키운 경우), 아니면 내 같은 클래스·무기 니케 평균, 그것도 없으면 같은 클래스 평균, 없으면 기본 */
function mirrorEntry(rid, { rosterMap, nikkeOf, weaponOf, level, ...env }) {
  const own = rosterMap?.get(rid);
  if (invested(own)) return clone(own);
  const me = nikkeOf(rid);
  const pool = [...(rosterMap?.entries() || [])].filter(([r, e]) => r !== rid && invested(e));
  const same = pool.filter(([r]) => nikkeOf(r)?.class === me?.class && weaponOf(r) === weaponOf(rid)).map(([, e]) => e);
  const near = same.length ? same : pool.filter(([r]) => nikkeOf(r)?.class === me?.class).map(([, e]) => e);
  return near.length ? averageEntry(near, env, level) : blank(level);
}

/* 프리셋 하나의 상대 항목.
   env: { data, T(cp.js 표), presets(arena_presets.json), rosterMap(rid -> 내 로스터 항목), nikkeOf(rid), weaponOf(rid), level } */
export function presetEntry(preset, rid, env) {
  if (preset === 'mirror') return mirrorEntry(rid, env);
  if (TIERS[preset]) return tierEntry(preset, rid, { presets: env.presets, nikke: env.nikkeOf(rid), weapon: env.weaponOf(rid), level: env.level });
  return blank(env.level);
}

/* 슬롯별 수동 조정 덮어쓰기. ov: { charge(%), skills{s1,s2,burst}, cube{tid, level}, collection{kind, level} }
   차속은 오버로드 차속 줄을 빼고 그 % 를 그대로 쓴다 - 결과 항목의 chargeOverride 를 foeCfg 가 읽는다. */
export function applyOverrides(entry, ov) {
  if (!ov) return entry;
  const e = clone(entry);
  if (ov.skills) e.skills = { ...e.skills, ...ov.skills };
  if (ov.cube) e.arena_cube = ov.cube.tid ? { tid: ov.cube.tid, level: ov.cube.level || 15 } : { tid: null, level: 0 };
  if (ov.collection) e.collection = { ...ov.collection };
  if (ov.charge != null) {
    e.gear = e.gear.map(g => ({ ...g, options: g.options.filter(o => o.name !== '차속') }));
    e.chargeOverride = ov.charge;
  }
  return e;
}

/* 예전 저장 형식({charge, quantum, treasure})을 덮어쓰기 형식으로 */
export function migrateOverride(old, data) {
  if (!old || (old.charge == null && old.quantum == null && old.treasure == null)) return old;
  const ov = {};
  for (const k of ['skills', 'cube', 'collection']) if (old[k]) ov[k] = old[k];
  if (old.charge) ov.charge = old.charge;
  if (old.quantum) {
    const values = data.cubes?.['1000307']?.values || [];
    const lv = values.findIndex(v => Math.abs(v - old.quantum) < 0.01);
    ov.cube = { tid: 1000307, level: lv >= 0 ? lv + 1 : 15 };
  }
  if (old.treasure) ov.collection = { kind: '애장품', level: '2.0' };
  return Object.keys(ov).length ? ov : null;
}
