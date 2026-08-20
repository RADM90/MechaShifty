/* 2버 자리 비교 — `node mekami/test/compare.js [초] [레벨]`.

   스탯은 지어내지 않고 MechaShifty 의 `assets/cp.js` 로 낸다. 기본 세팅
   (defaults.js)을 그대로 넣고 지정한 니케 레벨에서 공격력을 뽑는다 — 레벨 40 은
   협동 작전처럼 레벨이 고정되는 컨텐츠 기준이다. */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildTables, compute } from '../../assets/cp.js';
import { compile } from '../assets/effects.js';
import { simulate } from '../assets/engine.js';
import { defaultInput, bondCap, DEFAULT_LABEL, staticBuffs } from '../assets/defaults.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const read = p => JSON.parse(readFileSync(join(ROOT, p), 'utf-8'));

const SECONDS = Number(process.argv[2] || 90);
const LEVEL = Number(process.argv[3] || 40);

const NEED = ['syncro_stat', 'attraction_stat', 'attraction_grade', 'equip_stat',
  'equip_option', 'cube_stat', 'collection_stat', 'collection_bonus', 'cp_penalty'];
const T = buildTables(Object.fromEntries(NEED.map(k => [k, read(`data/raw/${k}.json`)])));

const nikkes = read('data/nikkes.json');
const cubes = read('mekami/data/cubes_effect.json');
const collection = read('mekami/data/collection.json');

const won = n => (n >= 1e8 ? `${(n / 1e8).toFixed(2)}억` : `${(n / 1e4).toFixed(1)}만`);

function build(rid, opts = {}) {
  const combat = read(`mekami/data/combat/c${rid}.json`);
  const meta = nikkes.find(n => n.resource_id === Number(rid));
  const input = defaultInput(meta, { weapon: combat.shot.weapon });
  const cp = compute(T, input, LEVEL);
  const { buffs, ammo } = staticBuffs({ T, input, weapon: combat.shot.weapon, cubes, collection });
  return {
    id: `c${rid}`, combat,
    effects: compile(read(`mekami/data/effects/c${rid}.json`), combat,
                     { favorite: !!opts.favorite }),
    stats: cp.stats,
    staticBuffs: buffs, staticAmmo: ammo,
    isElement: true,
    favorite: !!opts.favorite,
  };
}

/* 아니스(1버) · 크라운(2버) 은 고정. 나머지 셋이 비교 대상이다. */
const CORE = [['017'], ['330']];
const PLANS = {
  '마스트 : 로망틱 메이드 (2버)': {
    squad: [...CORE, ['354'], ['016'], ['515']],
    /* 3버가 둘이라 번갈아 쓰고, 2버는 크라운·마스트가 번갈아 든다. */
    rotation: [{ step1: 'c017', step2: 'c330', step3: 'c016' },
               { step1: 'c017', step2: 'c354', step3: 'c515' }],
  },
  '프리바티 + 애장품 (3버)': {
    squad: [...CORE, ['170', { favorite: true }], ['016'], ['515']],
    /* 프리바티가 3버라 3버가 셋이 된다. 크라운(20초 쿨)은 매 사이클, 3버는 셋이
       돌아가며 — 40초 쿨을 세 명이 나눠 받아 쿨타임이 남지 않는다. */
    rotation: [{ step1: 'c017', step2: 'c330', step3: 'c016' },
               { step1: 'c017', step2: 'c330', step3: 'c515' },
               { step1: 'c017', step2: 'c330', step3: 'c170' }],
  },
};

console.log(`니케 레벨 ${LEVEL} · ${SECONDS}초 · 적 방어력 0 · 코어 히트 50% · 우월코드 적용`);
console.log(`세팅: ${DEFAULT_LABEL.ko.replace('400레벨', `${LEVEL}레벨`)}\n`);

const results = [];
for (const [name, plan] of Object.entries(PLANS)) {
  const squad = plan.squad.map(([rid, o]) => build(rid, o));
  const r = simulate({
    squad, rotation: plan.rotation,
    enemy: { def: 0, coreHitRate: 0.5 },
    battle: { seconds: SECONDS, sample: 1 },
  });
  results.push({ name, r, squad });
}

results.sort((a, b) => b.r.total - a.r.total);
const top = results[0].r.total;

console.log('── 2버 자리 비교 ' + '─'.repeat(46));
for (const { name, r } of results) {
  const diff = r.total === top ? '—' : `${((r.total / top - 1) * 100).toFixed(1)}%`;
  console.log(`  ${name.padEnd(26)} ${won(r.total).padStart(9)}  ${diff.padStart(7)}`
    + `   (초당 ${won(r.dps)})`);
}

for (const { name, r, squad } of results) {
  console.log(`\n── ${name} ` + '─'.repeat(Math.max(0, 56 - name.length)));
  console.log(`  ${'니케'.padEnd(22)} ${'공격력'.padStart(8)} ${'대미지'.padStart(9)} `
    + `${'비중'.padStart(6)}  발사   장탄`);
  for (const a of [...r.byActor].sort((x, y) => y.damage - x.damage)) {
    const s = squad.find(q => q.id === a.id);
    console.log(`  ${a.name.padEnd(22)} ${s.stats.atk.toLocaleString().padStart(8)} `
      + `${won(a.damage).padStart(9)} ${(a.share * 100).toFixed(1).padStart(5)}%  `
      + `${String(a.shots).padStart(5)}  ${a.ammo}`);
  }
  const fb = r.log.filter(l => l.kind === 'fbStart').length;
  console.log(`  풀버스트 ${fb}회 (${fb * 10}초 / ${SECONDS}초 = `
    + `${(fb * 10 / SECONDS * 100).toFixed(0)}%)`);
  if (r.warnings.length) {
    for (const w of new Set(r.warnings)) console.log(`  ! ${w}`);
  }
}
