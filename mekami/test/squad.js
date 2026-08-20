/* 예제 5인을 실제로 돌려 본다 — `node mekami/test/squad.js`.

   숫자의 절대값을 검증할 방법은 아직 없다 (인게임 대조 전). 여기서 보는 것은
   효과표가 **말이 되게 굴러가는가** 다: 모르는 이름이 없는가, 버프가 실제로
   붙는가, 조건 분기가 의도한 쪽을 타는가, 버스트 순서를 바꾸면 결과가 달라지는가.

   스탯은 계정 없이 쓰는 기본 세팅(400레벨·0돌·호감도 40·재장전 큐브 15·SR15
   소장품·오버로드 4부위)에 가깝게 손으로 넣었다. 진짜 값은 화면이 cp.js 로 낸다. */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { compile } from '../assets/effects.js';
import { simulate } from '../assets/engine.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, '..', 'data');
const read = p => JSON.parse(readFileSync(join(DATA, p), 'utf-8'));

const SQUAD = ['017', '330', '354', '016', '515'];
const won = n => (n >= 1e8 ? `${(n / 1e8).toFixed(2)}억` : `${(n / 1e4).toFixed(1)}만`);

/* 재장전 큐브 Lv.15 = 재장전 속도 +29.69% + 우월 코드 공격 대미지 +19.09%.
   두 번째는 모든 큐브가 공유하는 안티 코드 HC 라 뭘 끼든 붙는다. */
const CUBE = [
  { stat: 'reloadSpeed', value: 0.2969, source: '큐브 퀵 리로드' },
  { stat: 'elemDmg', value: 0.1909, source: '큐브 안티 코드' },
];
/* 오버로드 4부위 × (우코 11레벨 + 공증 11레벨). equip_option.json 의 11행. */
const OVERLOAD = [
  { stat: 'elemDmg', value: 0.2554 * 4, source: '오버로드 우코' },
  { stat: 'atkPct', value: 0.1277 * 4, source: '오버로드 공증' },
];

function build(rid) {
  const combat = read(`combat/c${rid}.json`);
  const effects = compile(read(`effects/c${rid}.json`), combat);
  const coll = read('collection.json').byWeapon[combat.shot.weapon];
  const collSkill = coll && coll.SR && coll.SR.skills[0];
  const staticBuffs = [...CUBE, ...OVERLOAD];
  const staticAmmo = {};
  /* 소장품 SR15 는 값 배열의 4번째. 무기군마다 효과가 다르다 —
     AR 코어 대미지, SG/SMG 일반 공격 배율, MG 장탄, SR/RL 차지 대미지. */
  if (collSkill) {
    const v = collSkill.values[0][3];
    const text = collSkill.text.ko;
    if (text.includes('코어 대미지')) staticBuffs.push({ stat: 'coreDmg', value: v / 100, source: '소장품' });
    else if (text.includes('차지 대미지')) staticBuffs.push({ stat: 'chargeDmg', value: v / 100, source: '소장품' });
    else if (text.includes('최대 장탄')) staticAmmo.B = v / 100;
    else if (text.includes('일반 공격')) staticBuffs.push({ stat: 'normalAtkPct', value: v / 100, source: '소장품' });
  }
  return {
    id: `c${rid}`, combat, effects, staticBuffs, staticAmmo,
    stats: { atk: 167632, def: 30000, hp: 1500000 },
    isElement: true,
    levels: { s1: 10, s2: 10, burst: 10 },
  };
}

const squad = SQUAD.map(build);

console.log('── 효과표 읽기 ' + '─'.repeat(46));
let bad = 0;
for (const a of squad) {
  const e = a.effects;
  const tag = e.problems.length ? 'FAIL' : 'OK  ';
  if (e.problems.length) bad++;
  console.log(`  ${tag} ${a.combat.name.ko.padEnd(22)} 규칙 ${String(e.rules.length).padStart(2)}개 · `
    + `미반영 ${e.unmodeled.length}건 · 신뢰도 ${e.confidence}${e.stale ? ' · 원문 바뀜!' : ''}`);
  for (const p of e.problems) console.log(`       ${p}`);
}

/* 이 5인의 표준 편성: 1버 아니스 / 2버 크라운·마스트 / 3버 라피·신데. 3버가 둘 다
   40초 쿨이라 번갈아 써야 사이클이 안 끊긴다. */
const ROTATIONS = {
  '크라운→라피 / 마스트→신데': [
    { step1: 'c017', step2: 'c330', step3: 'c016' },
    { step1: 'c017', step2: 'c354', step3: 'c515' },
  ],
  '크라운→신데 / 마스트→라피': [
    { step1: 'c017', step2: 'c330', step3: 'c515' },
    { step1: 'c017', step2: 'c354', step3: 'c016' },
  ],
  '크라운 고정 / 3버만 교대': [
    { step1: 'c017', step2: 'c330', step3: 'c016' },
    { step1: 'c017', step2: 'c330', step3: 'c515' },
  ],
};

console.log('\n── 버스트 순서 비교 (180초) ' + '─'.repeat(34));
const runs = [];
for (const [name, rotation] of Object.entries(ROTATIONS)) {
  const r = simulate({
    squad, rotation,
    enemy: { def: 30000, coreHitRate: 0.5 },
    battle: { seconds: 180, sample: 1 },
  });
  runs.push({ name, r });
}
runs.sort((a, b) => b.r.total - a.r.total);
const top = runs[0].r.total;
for (const { name, r } of runs) {
  /* 사이클 길이가 순서에 따라 달라진다 — 버스트 쿨감을 누가 언제 거느냐로 게이지가
     붙잡는 판이 되기도 하고 쿨타임이 붙잡는 판이 되기도 한다. 누적 대미지만 보면
     왜 이겼는지가 안 보인다. */
  const b = r.burst;
  console.log(`  ${name.padEnd(28)} ${won(r.total).padStart(9)}  `
    + `${(r.total === top ? '—' : ((r.total / top - 1) * 100).toFixed(1) + '%').padStart(6)}  `
    + `풀버스트 ${String(b.count).padStart(2)}회 · 사이클 `
    + `${b.avgCycle ? b.avgCycle.toFixed(1) : '—'}초 · ${b.bound === 'gauge' ? '게이지' : '쿨타임'}`);
}

const best = runs[0].r;
console.log('\n── 니케별 기여 (1위 순서) ' + '─'.repeat(36));
for (const a of [...best.byActor].sort((x, y) => y.damage - x.damage)) {
  const kinds = Object.entries(a.byKind)
    .map(([k, v]) => `${k} ${(v / a.damage * 100).toFixed(0)}%`).join(' · ');
  console.log(`  ${a.name.padEnd(22)} ${won(a.damage).padStart(9)} `
    + `(${(a.share * 100).toFixed(1)}%)  ${String(a.shots).padStart(4)}발 `
    + `${a.ammo}장탄 · ${kinds}`);
}

console.log('\n── 버스트·상태 타임라인 (처음 45초) ' + '─'.repeat(25));
for (const l of best.log) {
  if (l.t > 45) break;
  if (l.kind === 'burst') console.log(`  ${l.t.toFixed(1).padStart(5)}s  버스트 ${l.step} ${l.actor}`);
  if (l.kind === 'fbStart') console.log(`  ${l.t.toFixed(1).padStart(5)}s  ▶ 풀버스트 시작`);
  if (l.kind === 'fbEnd') console.log(`  ${l.t.toFixed(1).padStart(5)}s  ■ 풀버스트 종료`);
  if (l.kind === 'stun') console.log(`  ${l.t.toFixed(1).padStart(5)}s  기절 ${l.actor} -> ${l.until.toFixed(1)}s`);
  if (l.kind === 'state') console.log(`  ${l.t.toFixed(1).padStart(5)}s  상태 ${l.actor} ${l.state} ${l.on ? 'ON' : 'OFF'}`);
}

const fbTime = best.log.filter(l => l.kind === 'fbStart').length * 10;
console.log(`\n  버스트 사이클 효율 = 풀버스트 ${fbTime}초 / 전체 180초 = ${(fbTime / 180 * 100).toFixed(0)}%`);

if (best.warnings.length) {
  console.log('\n── 경고 ' + '─'.repeat(54));
  for (const w of new Set(best.warnings)) console.log(`  ${w}`);
}
console.log('\n── 미반영 효과 (화면에 그대로 띄운다) ' + '─'.repeat(24));
for (const u of best.unmodeled) console.log(`  ${u.actor}: ${u.text}`);

process.exit(bad ? 1 : 0);
