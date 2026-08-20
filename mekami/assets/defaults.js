/* 계정을 안 불러왔을 때의 기준 세팅 — DOM 을 모른다.

   딜 계산에서 "얼마나 나오나" 는 세팅에 통째로 달려 있어서, 기준이 안 보이면 숫자를
   믿을 수가 없다. 그래서 가정을 한 군데 모아 두고 화면에도 그대로 적는다.

   사용자가 정한 기준: 400레벨 · 0돌파 · 호감도 40 · 재장전 큐브 Lv.15 ·
   SR15 소장품 · 오버로드 4부위(0강, 우월코드 11 + 공격력 11).

   여기서 나오는 것은 둘이다:
     DEFAULT_INPUT   cp.js 가 스탯(공격력)을 내는 데 쓰는 입력
     staticBuffs()   전투 내내 붙어 있는 버프 (큐브·소장품·오버로드 옵션)

   장비 스탯과 대미지 버프를 갈라 놓은 이유: 오버로드의 '공격력 증가 11레벨' 은
   스탯이 아니라 **대미지 공식의 공격력 증가 계열**이다. cp.js 는 전투력을 내려고
   이걸 계수로 쓰지만, 딜 계산에서는 버킷에 들어가야 한다. */

/* 렐릭 베어(재장전) 큐브. 모든 큐브가 공유하는 안티 코드 HC 때문에 우월코드
   대미지도 같이 붙는다 — 큐브를 뭘 끼든 따라오는 값이라 빠뜨리면 안 된다. */
export const RELOAD_CUBE_TID = 1000303;

/* 호감도 상한은 돌파 수와 소속이 같이 정한다.

     0돌 10 · 1돌 20 · 2돌 30 · 3돌 40
     그리고 소속 상한이 한 번 더 걸린다 — 필그림/오버스펙 40, 그 외 30.

   그래서 "0돌인데 호감도 40" 같은 조합은 애초에 만들 수 없다. 기본 세팅이 그런
   값을 들고 있으면 실제로는 나올 수 없는 공격력으로 딜을 계산하게 된다.
   코어 강화(코강)는 3돌 뒤의 단계라 돌파 3으로 친다. */
export function bondCap(grade, corporation, subType) {
  const m = /^([0-3])돌$/.exec(String(grade || ''));
  const breaks = m ? Number(m[1]) : 3;          // 코강이면 이미 3돌을 지났다
  const pilgrim = corporation === 'PILGRIM' || subType === 'OVERSPEC';
  return Math.min(10 * (breaks + 1), pilgrim ? 40 : 30);
}

const BASE_INPUT = {
  level: 400,
  grade: '0돌',
  skills: { s1: 10, s2: 10, burst: 10 },
  cube: '15',
  cubeTid: RELOAD_CUBE_TID,
  collection: { kind: 'SR', level: '15' },
  gear: ['머리', '몸', '팔', '다리'].map(slot => ({
    slot, tier: '오버로드', enhance: 0,
    options: [{ name: '우코', level: 11 }, { name: '공증', level: 11 }],
  })),
};

/* 니케 하나의 기본 입력. 호감도는 소속·돌파에 맞춰 저절로 잡힌다.
   meta 는 `data/nikkes.json` 의 레코드 (rarity·class·corporation·…). */
export function defaultInput(meta, over = {}) {
  const grade = over.grade || BASE_INPUT.grade;
  return {
    ...BASE_INPUT, ...over, grade,
    rarity: meta.rarity,
    class: meta.class,
    weapon: over.weapon || meta.weapon_type,
    console: over.console || {},
    bond: over.bond != null ? over.bond
      : bondCap(grade, meta.corporation, meta.corporation_sub_type),
  };
}

/* 예전 이름. 호감도가 니케마다 다르므로 여기에는 넣지 않는다. */
export const DEFAULT_INPUT = BASE_INPUT;

/* 사람이 읽는 요약. 화면 위쪽에 그대로 띄운다. */
export const DEFAULT_LABEL = {
  ko: '400레벨 · 0돌파 · 호감도 상한(0돌 = 10) · 재장전 큐브 Lv.15 · SR15 소장품 · '
    + '오버로드 4부위 (우월코드 11 + 공격력 11)',
  en: 'Lv.400 · 0 limit break · Bond at cap (10 at 0 LB) · Reload cube Lv.15 · '
    + 'SR15 collection · 4 overload pieces (Elem.DMG 11 + ATK 11)',
  ja: 'Lv.400 · 0凸 · 好感度上限(0凸 = 10) · リロードキューブLv.15 · SR15コレクション · '
    + 'オーバーロード4部位 (有利コード11 + 攻撃力11)',
};

/* 소장품은 무기군마다 효과가 다르다. 어느 버킷에 들어가는지는 문구로 가른다 —
   `mekami/data/collection.json` 이 세 언어 원문을 들고 있으므로 한국어를 본다. */
const COLLECTION_STAT = [
  [/코어 대미지/, 'coreDmg'],
  [/차지 대미지/, 'chargeDmg'],
  [/일반 공격 대미지/, 'normalAtkPct'],
  [/최대 장탄/, 'maxAmmo'],
];

const pick = (values, idx) => {
  const row = values && values[0];
  return row ? row[Math.min(Math.max(idx, 1), row.length) - 1] : 0;
};

/* 세팅에서 나오는 상시 버프. 스킬이 아니라 장비라 효과표가 아니라 여기서 만든다.

   수치는 하나도 박아 넣지 않는다 — 전부 `cp.js` 가 만든 표(`T`)에서 끌어온다.
   오버로드 옵션 레벨별 %는 `T.optionValue`, 큐브·소장품의 **효과 단계**는
   `T.cube` / `T.collection` 의 skill1·skill2 열이다. 그래야 계정을 불러왔을 때
   그 사람의 실제 레벨이 그대로 반영되고, 기본 세팅과 같은 길로 계산된다.

   opts: { T, input, weapon, cubes, collection }
     T            cp.js buildTables 의 결과
     input        cp.js 에 넣는 그 입력 (gear · cube · collection 을 읽는다)
     weapon       'MG' 같은 무기군 코드 (소장품이 무기군마다 다르다)
     cubes        mekami/data/cubes_effect.json
     collection   mekami/data/collection.json
   돌려주는 것: { buffs: [{stat, value, source}], ammo: { 계열: 비율 } } */
export function staticBuffs(opts = {}) {
  const buffs = [];
  const ammo = {};
  const T = opts.T;
  const input = opts.input || DEFAULT_INPUT;

  /* 오버로드 옵션은 부위마다 따로 붙어 합산된다. 장탄만 계열 A 로 따로 샌다
     (문서 §3.3 — 계열마다 기본 장탄수에 걸고 따로 반올림). */
  for (const g of input.gear || []) {
    for (const o of g.options || []) {
      const value = T && T.optionValue ? (T.optionValue.get(`${o.name}|${o.level}`) || 0) : 0;
      if (!value) continue;
      if (o.name === '우코') buffs.push({ stat: 'elemDmg', value, source: '오버로드 우코' });
      else if (o.name === '공증') buffs.push({ stat: 'atkPct', value, source: '오버로드 공증' });
      else if (o.name === '크댐') buffs.push({ stat: 'critDmg', value, source: '오버로드 크댐' });
      else if (o.name === '크확') buffs.push({ stat: 'critRate', value, source: '오버로드 크확' });
      else if (o.name === '차댐') buffs.push({ stat: 'chargeDmg', value, source: '오버로드 차댐' });
      else if (o.name === '차속') buffs.push({ stat: 'chargeSpeed', value, source: '오버로드 차속' });
      else if (o.name === '장탄') ammo.A = (ammo.A || 0) + value;
      /* 명중·방어는 대미지 공식에 안 들어간다. MG 는 예열이 끝나면 탄착군이
         수렴해 명중률 자체가 사실상 무의미하다 (문서 §3.2). */
    }
  }

  /* 큐브 레벨 -> 효과 단계. `cube_stat.json` 의 skill1/skill2 열이 그대로 인덱스다
     (Lv.15 -> 3, 6). skill2 는 모든 큐브가 공유하는 안티 코드 HC 라, 어느 큐브를
     끼든 우월 코드 대미지가 따라온다. */
  const cubeRow = T && T.cube && T.cube.get(String(input.cube));
  const cube = opts.cubes && opts.cubes.byTid
    && opts.cubes.byTid[String(input.cubeTid || RELOAD_CUBE_TID)];
  if (cube && cubeRow) {
    const idx = [cubeRow.s1, cubeRow.s2];
    (cube.skills || []).forEach((sk, i) => {
      if (!sk || !idx[i]) return;
      const v = pick(sk.values, idx[i]) / 100;
      const text = (sk.text && sk.text.ko) || '';
      if (/재장전 속도/.test(text)) buffs.push({ stat: 'reloadSpeed', value: v, source: '큐브 재장전' });
      else if (/우월 코드/.test(text)) buffs.push({ stat: 'elemDmg', value: v, source: '큐브 안티 코드' });
      else if (/차지 대미지/.test(text)) buffs.push({ stat: 'chargeDmg', value: v, source: '큐브 차지' });
      else if (/차지 속도/.test(text)) buffs.push({ stat: 'chargeSpeed', value: v, source: '큐브 차지속도' });
      else if (/최대 장탄/.test(text)) ammo.B = (ammo.B || 0) + v;
      /* 탄환 충전(택티컬 베어)은 버프가 아니라 주기적으로 탄을 채우는 장치라
         엔진의 ammoCharge 로 따로 넘긴다 — 여기서는 안 다룬다. */
    });
  }

  /* 소장품도 같은 구조다. 애장품은 스탯·계수가 SR15 와 같으므로 그 행을 쓴다. */
  const c = input.collection || {};
  const key = c.kind === '애장품' ? '소장품|SR15' : `소장품|${c.kind}${c.level}`;
  const collRow = T && T.collection && T.collection.get(key);
  const coll = opts.collection && opts.collection.byWeapon
    && opts.collection.byWeapon[opts.weapon];
  const grade = c.kind === '애장품' ? 'SR' : c.kind;
  const set = coll && coll[grade];
  if (set && collRow) {
    (set.skills || []).forEach((sk, i) => {
      const step = i === 0 ? collRow.s1 : collRow.s2;
      if (!sk || !step) return;
      const text = (sk.text && sk.text.ko) || '';
      const hit = COLLECTION_STAT.find(([re]) => re.test(text));
      if (!hit) return;
      const v = pick(sk.values, step) / 100;
      if (hit[1] === 'maxAmmo') ammo.B = (ammo.B || 0) + v;   // 큐브·소장품은 계열 B
      else buffs.push({ stat: hit[1], value: v, source: '소장품' });
    });
  }

  return { buffs, ammo };
}
