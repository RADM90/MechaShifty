/* 슈팅 스타 검증 — `node mekami/test/shooting_star.js`.

   "스킬 타격도 버스트 게이지를 번다" 를 눈으로 볼 수 있는 자리는 하나뿐이다.

   아니스 : 스타의 슈팅 스타는 Ⅰ 을 쓴 직후 켜져 **10초**를 간다. 그런데 풀버스트도
   10초라, 보통 조합에서는 별이 꺼진 뒤에 풀버스트가 끝난다. 게이지는 Ⅰ 을 누른
   순간부터 풀버스트가 끝날 때까지 잠겨 있으므로 **별이 번 게이지는 통째로 잠금
   구간 안에서 사라진다.** 그래서 2분 협전 로그로는 이 사실을 가릴 수 없었다.

   이사벨은 3단계인데 **풀버스트가 5초**다. 그러면 잠금이 풀리는 시점에 별사탕이
   4~5초 남아 있어서, 게이지가 눈에 띄게 빨리 찬다. 이 차이가 나오는지를 본다.

   같은 스쿼드 안에서 이사벨(5초)과 신데렐라(10초)를 번갈아 쓰므로, 바깥 조건을
   하나도 안 바꾸고 사이클끼리 직접 비교할 수 있다. */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildTables, compute } from '../../assets/cp.js';
import { compile } from '../assets/effects.js';
import { simulate } from '../assets/engine.js';
import { defaultInput, staticBuffs } from '../assets/defaults.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const read = p => JSON.parse(readFileSync(join(ROOT, p), 'utf-8'));

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

/* 전격 우코 조합 — 아니스 : 스타(Ⅰ) · 아르카나/크라운(Ⅱ) · 이사벨/신데렐라(Ⅲ). */
const squad = ['017', '581', '330', '231', '511'].map(build);
const rotation = [
  { step1: 'c017', step2: 'c581', step3: 'c231' },   // 이사벨 — 풀버스트 5초
  { step1: 'c017', step2: 'c330', step3: 'c511' },   // 신데렐라 — 풀버스트 10초
];

const run = simulate({
  squad, rotation, enemy: { def: 0, coreHitRate: 0.5 },
  battle: { seconds: 180, sample: 180 },
});

const fb = c => (c.fbEnd == null ? null : c.fbEnd - c.fbStart);
console.log('\n전격 우코 조합 — 아니스 : 스타 / 아르카나 · 크라운 / 이사벨 · 신데렐라');
console.log('사이클  3단계        풀버스트  잠금 해제  만충까지');
let prev = 0;
for (const c of run.burst.cycles) {
  if (c.fbStart == null) continue;
  const who = c.index % 2 === 0 ? '이사벨' : '신데렐라';
  const dur = fb(c);
  const fill = c.fullAt != null ? c.fullAt - (c.fbEnd ?? c.startAt) : null;
  console.log(`  ${String(c.index + 1).padStart(2)}   ${who.padEnd(10)} `
    + `${dur != null ? dur.toFixed(1).padStart(6) : '     —'}초 `
    + `${(c.fbEnd ?? 0).toFixed(1).padStart(8)}초 `
    + `${fill != null && fill >= 0 ? fill.toFixed(2).padStart(7) + '초' : '      —'}`);
  prev = c.fbEnd;
}

/* 두 부류의 만충 시간을 갈라 평균 낸다. 잠금이 풀린 시각부터 만충까지를 잰다 —
   그 구간에 별사탕이 살아 있느냐가 유일한 차이다. */
const fills = { 이사벨: [], 신데렐라: [] };
const CY = run.burst.cycles;
for (let i = 1; i < CY.length; i++) {
  const c = CY[i], p = CY[i - 1];
  if (c.fullAt == null || p.fbEnd == null) continue;
  fills[p.index % 2 === 0 ? '이사벨' : '신데렐라'].push(c.fullAt - p.fbEnd);
}
const mean = v => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
console.log('\n직전 풀버스트가 끝난 뒤 만충까지');
for (const k of ['이사벨', '신데렐라']) {
  const m = mean(fills[k]);
  console.log(`  ${k.padEnd(6)} (풀버스트 ${k === '이사벨' ? 5 : 10}초) 다음 — `
    + `${m != null ? m.toFixed(2) + '초' : '—'}  (${fills[k].length}회)`);
}
const a = mean(fills['이사벨']), b = mean(fills['신데렐라']);
console.log(a != null && b != null
  ? `\n5초 풀버스트 뒤가 ${(b / a).toFixed(1)}배 빠르다 — 별사탕이 남아 있는 만큼이다.`
  : '\n비교할 사이클이 모자랍니다.');

console.log('\n누가 게이지를 벌었나 (180초)');
for (const x of [...run.byActor].sort((p, q) => q.gauge - p.gauge)) {
  console.log(`  ${x.name.padEnd(14)} ${Math.round(x.gauge).toLocaleString().padStart(9)} `
    + `(${(x.gaugeShare * 100).toFixed(1)}%)`);
}
console.log(`\n풀버스트 ${run.burst.count}회 · 사이클 ${run.burst.avgCycle.toFixed(2)}초 · `
  + `${run.burst.bound === 'gauge' ? '게이지' : '쿨타임'}이 붙잡는다`);
