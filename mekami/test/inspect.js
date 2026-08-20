/* 어느 시점에 누구에게 무엇이 걸려 있나 — `node mekami/test/inspect.js [옵션]`.

     --at 42.5            그 시각의 스쿼드 전체 상태
     --nikke 크라운        한 명만 시간축으로 훑는다
     --layers             그 시각의 대미지 레이어 분해 (무엇이 배수를 만들었나)
     --top                공격력이 가장 부풀어 있는 순간을 찾아 준다
     --seconds 180        전투 시간 (기본 180)

   누적 대미지가 이상할 때 숫자 하나만 보면 어디가 틀렸는지 알 수가 없다. 버프는
   출처와 함께 한 줄씩 보여야 "이게 두 번 걸렸다" 나 "끝나야 할 게 안 끝났다" 가
   눈에 띈다. 그래서 여기서는 합친 값과 **그 값을 만든 줄들**을 같이 낸다. */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildTables, compute } from '../../assets/cp.js';
import { compile } from '../assets/effects.js';
import { simulate } from '../assets/engine.js';
import { defaultInput, staticBuffs } from '../assets/defaults.js';
import { hitDamage, KIND } from '../assets/formula.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const read = p => JSON.parse(readFileSync(join(ROOT, p), 'utf-8'));

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const has = name => argv.includes(`--${name}`);

const SECONDS = Number(flag('seconds', 180));
const AT = flag('at', null);
const ONLY = flag('nikke', null);

const NEED = ['syncro_stat', 'attraction_stat', 'attraction_grade', 'equip_stat',
  'equip_option', 'cube_stat', 'collection_stat', 'collection_bonus', 'cp_penalty'];
const T = buildTables(Object.fromEntries(NEED.map(k => [k, read(`data/raw/${k}.json`)])));
const cubes = read('mekami/data/cubes_effect.json');
const collection = read('mekami/data/collection.json');
const index = read('mekami/data/index.json').nikkes;

function build(rid) {
  const combat = read(`mekami/data/combat/c${rid}.json`);
  const m = index.find(x => x.rid === Number(rid));
  const input = defaultInput({ rarity: m.rarity, class: m.class, corporation: m.corporation },
                             { weapon: combat.shot.weapon });
  const cp = compute(T, input, 400);
  const { buffs, ammo } = staticBuffs({ T, input, weapon: combat.shot.weapon, cubes, collection });
  return { id: `c${rid}`, combat, name: combat.name.ko,
           effects: compile(read(`mekami/data/effects/c${rid}.json`), combat),
           stats: cp.stats, staticBuffs: buffs, staticAmmo: ammo, isElement: true };
}

/* 예제 5인 — 아니스 : 스타 · 크라운 · 마스트 · 라피 : 레드 후드 · 신데렐라 : CW */
const squad = ['017', '330', '354', '016', '515'].map(build);
const run = simulate({
  squad,
  rotation: [{ step1: 'c017', step2: 'c330', step3: 'c016' },
             { step1: 'c017', step2: 'c354', step3: 'c515' }],
  enemy: { def: 30000, coreHitRate: 0.5 },
  battle: { seconds: SECONDS, sample: 0.5, snapshot: true },
});

const n = v => (Math.abs(v) >= 1e8 ? `${(v / 1e8).toFixed(2)}억`
  : Math.abs(v) >= 1e4 ? `${(v / 1e4).toFixed(1)}만` : v.toFixed(0));
const pct = v => `${(v * 100).toFixed(1)}%`;

/* 스탯 이름을 원문 말로 되돌린다. 영어 키만 보면 원문과 대조가 안 된다. */
const LABEL = {
  atkPct: '공격력', atkFlat: '시전자 기준 공격력', damageUp: '공격 대미지',
  receivedUp: '받는 대미지', elemDmg: '우월코드 대미지', critRate: '크리티컬 확률',
  critDmg: '크리티컬 대미지', coreDmg: '코어 대미지', defPct: '방어력',
  chargeSpeed: '차지 속도', chargeDmg: '차지 대미지', chargeTimeFix: '차지 시간 고정',
  reloadSpeed: '재장전 속도', maxAmmo: '최대 장탄', spinupRate: '예열 속도',
  burstGaugeSpeed: '게이지 충전 속도', explosionRange: '폭발 범위',
  normalAtkPct: '일반 공격 배율', explosionDmg: '발사체 폭발', stickDmg: '발사체 부착',
  pierceDmg: '관통', partsDmg: '파츠', distributedDmg: '분배', trueDmg: '방어력 무시',
  burstSkillDmg: '버스트 스킬', singleBurstDmg: '단일 대상 버스트',
  blockDmg: '저지 부위', dotDmg: '지속', sequentialDmg: '순차', shieldDmg: '보호막',
  chargeOverflow: '차지 초과분 변환', normalAsTrue: '평타를 방어력 무시로',
  shotCondition: '발동 횟수 조건',
};
const label = k => LABEL[k] || k;
/* 초 단위 값은 퍼센트로 적으면 안 읽힌다. */
const SECOND_STATS = new Set(['chargeTimeFix']);
const val = (k, v) => (SECOND_STATS.has(k) ? `${v.toFixed(2)}초`
  : k === 'atkFlat' ? `+${n(v)}` : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`);

function showActor(a, enemy) {
  const swell = a.atk / a.atkBase;
  console.log(`\n  ${a.name}  ${a.weapon}  공격력 ${n(a.atkBase)} -> ${n(a.atk)} `
    + `(×${swell.toFixed(2)})  탄 ${a.ammo}/${a.ammoMax}`
    + `${a.heat != null ? ` · 예열 ${pct(a.heat)}` : ''}${a.stunned ? ' · 기절' : ''}`);
  if (a.states.length) console.log(`    상태: ${a.states.join(' · ')}`);
  const st = Object.entries(a.stacks).filter(([, c]) => c > 0);
  if (st.length) console.log(`    중첩: ${st.map(([k, c]) => `${k} ${c}`).join(' · ')}`);

  if (!a.buffs.length) { console.log('    버프 없음'); return; }
  /* 같은 스탯끼리 묶어 합계와 그 합계를 만든 줄들을 같이 낸다. */
  const by = new Map();
  for (const b of a.buffs) {
    if (!by.has(b.stat)) by.set(b.stat, []);
    by.get(b.stat).push(b);
  }
  const rows = [...by].sort((x, y) =>
    Math.abs(y[1].reduce((s, b) => s + b.value, 0)) - Math.abs(x[1].reduce((s, b) => s + b.value, 0)));
  for (const [stat, list] of rows) {
    const total = list.reduce((s, b) => s + b.value, 0);
    console.log(`    ${label(stat).padEnd(16)} ${val(stat, total).padStart(12)}`
      + `${list.length > 1 ? `   ← ${list.length}줄` : ''}`);
    if (list.length > 1 || list[0].source !== '세팅') {
      for (const b of list) {
        console.log(`      ${val(stat, b.value).padStart(12)}  ${b.source}`
          + `${b.until != null ? ` (${b.until.toFixed(1)}초까지)` : ' [지속]'}`);
      }
    }
  }
  if (enemy.buffs.length) {
    console.log('    적에게 걸린 것 (스쿼드가 함께 받는다):');
    for (const b of enemy.buffs) {
      console.log(`      ${label(b.stat).padEnd(14)} ${val(b.stat, b.value).padStart(10)}  ${b.source}`
        + `${b.until != null ? ` (${b.until.toFixed(1)}초까지)` : ' [지속]'}`);
    }
  }
}

/* 대미지 레이어 분해 — 어느 레이어가 배수를 만들고 있나. */
function showLayers(snap) {
  console.log('\n  대미지 레이어 (평타 한 발 기준, 계수 제외)');
  console.log('    니케              속성   대미지증감   판정보너스   유효공격력   합계배수');
  for (const a of snap.actors) {
    const actor = squad.find(s => s.id === a.id);
    const shot = actor.combat.shot;
    const r = hitDamage({
      atk: a.atkBase, ratio: 1, kind: KIND.NORMAL, buff: a.buckets,
      ctx: { enemyDef: 30000, isElement: true, fullBurst: snap.fullBurst,
             inRange: !!(shot.range && shot.range[1] > 0), coreHitRate: 0.5,
             coreDamage: shot.coreDamage },
    });
    const b = r.breakdown;
    console.log(`    ${a.name.padEnd(18)}${b.element.toFixed(2).padStart(5)}`
      + `${b.damage.toFixed(2).padStart(12)}${b.bonus.toFixed(2).padStart(13)}`
      + `${n(b.attack).padStart(13)}${n(r.value).padStart(11)}`);
  }
  console.log('    (합계배수 = 속성 × 대미지증감 × 판정보너스 × 유효공격력)');
}

const snaps = run.snapshots;
const near = t => snaps.reduce((best, s) =>
  (Math.abs(s.t - t) < Math.abs(best.t - t) ? s : best), snaps[0]);

if (has('top')) {
  /* 공격력이 가장 부풀어 있는 순간. 대미지가 이상할 때 여기부터 본다. */
  let best = null;
  for (const s of snaps) {
    for (const a of s.actors) {
      const k = a.atk / a.atkBase;
      if (!best || k > best.k) best = { k, t: s.t, name: a.name, snap: s };
    }
  }
  console.log(`\n공격력이 가장 부푼 순간 — ${best.name} ×${best.k.toFixed(2)} @ ${best.t}초`);
  const s = best.snap;
  console.log(`\n══ ${s.t.toFixed(1)}초 ${s.fullBurst ? '· 풀버스트' : ''} `
    + `· 게이지 ${pct(s.gauge)}${s.armed ? ' (만충 대기)' : ''} ══`);
  for (const a of s.actors) showActor(a, s.enemy);
  showLayers(s);
} else if (ONLY) {
  /* 한 명을 시간축으로. 버프가 붙고 빠지는 자리만 찍는다 — 0.5초마다 다 찍으면
     360줄이 되어 아무도 안 읽는다. */
  console.log(`\n${ONLY} — 버프가 바뀌는 순간만`);
  let prev = '';
  for (const s of snaps) {
    const a = s.actors.find(x => x.name.includes(ONLY));
    if (!a) continue;
    const key = a.buffs.map(b => `${b.stat}:${b.value.toFixed(3)}:${b.source}`).sort().join('|')
      + '/' + a.states.join(',');
    if (key === prev) continue;
    prev = key;
    console.log(`\n── ${s.t.toFixed(1)}초 ${s.fullBurst ? '· 풀버스트' : ''}`);
    showActor(a, { buffs: [], states: [] });
  }
} else {
  const s = AT != null ? near(Number(AT)) : near(snaps[Math.floor(snaps.length / 2)].t);
  console.log(`\n══ ${s.t.toFixed(1)}초 ${s.fullBurst ? '· 풀버스트' : ''} `
    + `· 게이지 ${pct(s.gauge)}${s.armed ? ' (만충 대기)' : ''} ══`);
  if (s.enemy.states.length) console.log(`  적 상태: ${s.enemy.states.join(' · ')}`);
  for (const a of s.actors) showActor(a, s.enemy);
  if (has('layers')) showLayers(s);
}

console.log(`\n누적 ${n(run.total)} · 초당 ${n(run.dps)} · 풀버스트 ${run.burst.count}회`);
for (const a of [...run.byActor].sort((x, y) => y.damage - x.damage)) {
  const parts = Object.entries(a.bySource).sort((x, y) => y[1] - x[1]).slice(0, 4);
  console.log(`  ${a.name.padEnd(18)} ${n(a.damage).padStart(9)} (${pct(a.share)})  `
    + parts.map(([k, v]) => `${k} ${pct(v / a.damage)}`).join(' · '));
}
