/* 버스트 사이클 실측 대조 — `node mekami/test/cycle.js [반응시간]`.

   2분 협동 작전에서 크라운·마스트 스쿼드가 실제로 돈 버스트 시각이다. 화면의
   남은 시간(카운트다운)으로 적혀 있어 경과 시간으로 뒤집었다. `마`·`크` 는 그
   사이클의 2단계 자리를 마스트가 맡았는지 크라운이 맡았는지다.

     02:00 시작 · 01:56 마 · 01:43 크 · 01:29 마 · 01:16 크 · 01:03 크
     00:49 마 · 00:36 크 · 00:24 크 · 00:10 마 · 00:00 종료

   이 로그가 값을 하는 이유는 **만충 기준값이 CDN 에 없기 때문**이다. 발당 수급량은
   실값이 있는데 "얼마나 모아야 만충인가" 는 없어서, 사이클 길이를 실제로 재 본
   기록이 그 자리를 대신한다. 여기서 하는 일이 그 역산이다.

   그리고 `크` 가 44초와 57초에 13초 간격으로 두 번 나온 것이 **버스트 쿨감이 실제로
   돌고 있다는 증거**다. 크라운 버스트는 20초 쿨인데 13초 만에 다시 나왔다 — 아니스 :
   스타의 "풀 버스트 타임 종료 시 아군 전체 버스트 스킬 재사용 시간 7.48초 ▼" 가
   매 사이클 걸리면 20 − 7.48 = 12.52초가 되어 딱 맞는다. */

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

/* 남은 시간 -> 경과 시간. 전투는 120초다. */
const SECONDS = 120;
const OBSERVED = [
  ['마', '01:56'], ['크', '01:43'], ['마', '01:29'], ['크', '01:16'], ['크', '01:03'],
  ['마', '00:49'], ['크', '00:36'], ['크', '00:24'], ['마', '00:10'],
].map(([who, mmss]) => {
  const [m, s] = mmss.split(':').map(Number);
  return { who, t: SECONDS - (m * 60 + s) };
});

const REACTION = Number(process.argv[2] || 0.23);
/* 1단계 자리는 로그에 안 적혀 있다. 바꿔 가며 어느 쪽이 실측을 재현하는지 볼 수
   있게 인자로 뺐다 — 017 아니스 : 스타 / 082 리타. */
const STEP1 = String(process.argv[3] || '017');

const NEED = ['syncro_stat', 'attraction_stat', 'attraction_grade', 'equip_stat',
  'equip_option', 'cube_stat', 'collection_stat', 'collection_bonus', 'cp_penalty'];
const T = buildTables(Object.fromEntries(NEED.map(k => [k, read(`data/raw/${k}.json`)])));
const cubes = read('mekami/data/cubes_effect.json');
const collection = read('mekami/data/collection.json');
const index = read('mekami/data/index.json').nikkes;

const LEVEL = 400;
function build(rid) {
  const combat = read(`mekami/data/combat/c${rid}.json`);
  const m = index.find(x => x.rid === Number(rid));
  const input = defaultInput({ rarity: m.rarity, class: m.class, corporation: m.corporation },
                             { weapon: combat.shot.weapon });
  const cp = compute(T, input, LEVEL);
  const { buffs, ammo } = staticBuffs({ T, input, weapon: combat.shot.weapon, cubes, collection });
  return { id: `c${rid}`, combat, name: combat.name.ko,
           effects: compile(read(`mekami/data/effects/c${rid}.json`), combat),
           stats: cp.stats, staticBuffs: buffs, staticAmmo: ammo, isElement: true };
}

/* Ⅰ(인자로 교체) · 크라운/마스트(Ⅱ) · 라피 : 레드 후드/신데렐라 : CW(Ⅲ 교대). */
const squad = [STEP1, '330', '354', '016', '515'].map(build);
const WHO = { 마: 'c354', 크: 'c330' };

/* 2단계 자리는 **로그에 적힌 순서 그대로** 넣는다. 실측은 마·크·마·크·크·마·크·크·마 라
   단순 교대가 아니고, 크라운이 44초와 57초에 13초 간격으로 두 번 나온다. 크라운
   버스트는 20초 쿨이므로 이 무늬가 성립하려면 쿨감이 실제로 돌아야 한다 — 그래서
   교대 무늬로 바꿔 치면 검증이 헐거워진다. 3단계는 로그에 없어 교대로 둔다. */
const ROTATION = OBSERVED.map((o, i) => ({
  step1: `c${STEP1}`, step2: WHO[o.who], step3: i % 2 ? 'c515' : 'c016',
}));

const run = (gaugeMax, reaction = REACTION, rotation = ROTATION) => simulate({
  squad, rotation,
  enemy: { def: 0, coreHitRate: 0.5 },
  battle: { seconds: SECONDS, sample: SECONDS, reaction, gaugeMax },
});

/* 로그에 적힌 것은 **2단계를 누른 시각**(`마`/`크`)이므로 모형에서도 같은 것을
   집는다. 풀버스트 시작으로 재면 반응 한 박자와 버스트 적용 지연만큼 어긋난다. */
const step2At = r => r.log.filter(l => l.kind === 'burst' && l.step === 'step2')
  .map(l => ({ t: l.t, id: l.actor }));
const meanGap = list => (list.length < 2
  ? null : (list[list.length - 1] - list[0]) / (list.length - 1));

const OBS_GAP = meanGap(OBSERVED.map(o => o.t));

/* 화면의 카운트다운은 초 단위라 `01:56` 은 경과 4.0~5.0초 어디든 될 수 있다.
   그래서 초 단위로 같은 칸에 떨어지면 맞은 것으로 센다 — 소수점까지 맞추라고
   요구하면 있지도 않은 정밀도를 쫓게 된다. */
const inBucket = (model, obs) => Math.floor(model + 1e-9) === obs;

console.log(`\n실측 — 2분 협전 · 크라운/마스트 스쿼드`);
console.log(`  풀버스트 ${OBSERVED.length}회 · 첫 발동 ${OBSERVED[0].t}초 · `
  + `평균 사이클 ${OBS_GAP.toFixed(2)}초`);
console.log('  간격: ' + OBSERVED.slice(1)
  .map((o, i) => (o.t - OBSERVED[i].t).toFixed(0)).join(' · ') + '초');

/* ── 만충 기준값 역산 ────────────────────────────────────────
   사이클 길이는 만충 값에 단조로 늘어난다 (많이 모을수록 오래 걸린다). 실측을
   재현하는 값을 훑어 찾되, 맞았는지는 **몇 칸이 같은 초에 떨어지는가**로 센다.
   평균만 맞추면 첫 발동이 통째로 밀려 있어도 통과해 버린다. */
function score(gaugeMax, reaction = REACTION) {
  const r = run(gaugeMax, reaction);
  const model = step2At(r);
  let hit = 0, err = 0;
  for (let i = 0; i < OBSERVED.length; i++) {
    if (model[i] == null) { err += 5; continue; }
    if (inBucket(model[i].t, OBSERVED[i].t)) hit++;
    err += Math.abs(model[i].t - OBSERVED[i].t);
  }
  return { r, model, hit, err, gap: meanGap(model.map(m => m.t)) };
}

console.log(`\n모형 — 1단계 ${squad[0].name} · 반응 시간 ${REACTION}초 · 기준 세팅 Lv.${LEVEL}`);
console.log('  만충값   횟수  첫발동  사이클  만충까지  붙잡는것  같은칸  총오차');
const grid = [];
for (let g = 7000; g <= 12000; g += 250) grid.push(g);
for (const g of grid) {
  const s = score(g);
  const b = s.r.burst;
  console.log(`  ${String(g).padStart(6)}  ${String(s.model.length).padStart(4)}회 `
    + `${(s.model[0] ? s.model[0].t.toFixed(1) : '—').padStart(6)}초 `
    + `${(s.gap ? s.gap.toFixed(2) : '—').padStart(6)}초 `
    + `${(b.avgFill != null ? b.avgFill.toFixed(2) : '—').padStart(7)}초 `
    + `${(b.bound === 'gauge' ? '게이지' : '쿨타임').padStart(8)} `
    + `${String(s.hit).padStart(6)}/9 ${s.err.toFixed(1).padStart(7)}초`
    + (s.hit === 9 ? '  ←' : ''));
}

const best = grid.map(g => ({ g, ...score(g) }))
  .sort((a, b) => (b.hit - a.hit) || (a.err - b.err))[0];
const floor = meanGap(step2At(run(100)).map(m => m.t));

console.log(`\n가장 잘 맞는 만충값: ${best.g}  (9칸 중 ${best.hit}칸 · 총오차 ${best.err.toFixed(1)}초)`);
console.log(`쿨타임만으로 정해지는 바닥: ${floor ? floor.toFixed(2) : '—'}초`
  + `  — 실측 ${OBS_GAP.toFixed(2)}초가 이보다 길면 게이지가 붙잡고 있다는 뜻이다`);

/* 반응 시간이 사이클에 얼마나 붙는지 — 한 사이클에 세 번 누른다. */
console.log(`\n반응 시간을 바꿔 보면 (만충 ${best.g} 고정)`);
for (const rt of [0, 0.1, 0.2, 0.23, 0.3, 0.5]) {
  const s = score(best.g, rt);
  console.log(`  ${rt.toFixed(2)}초 -> 사이클 ${s.gap ? s.gap.toFixed(2) : '—'}초 · `
    + `같은 칸 ${s.hit}/9`);
}

/* 마지막으로 시각을 하나씩 늘어놓고 어긋난 정도를 본다. */
const NAME = { c354: '마', c330: '크' };
console.log(`\n시각 대조 (만충 ${best.g} · 반응 ${REACTION}초)`);
console.log('   #   실측        모형        차이');
for (let i = 0; i < Math.max(OBSERVED.length, best.model.length); i++) {
  const o = OBSERVED[i], m = best.model[i];
  const who = m ? (NAME[m.id] || m.id) : '';
  const same = o && m && who === o.who;
  console.log(`  ${String(i + 1).padStart(2)}  ${o ? `${o.who} ${String(o.t).padStart(3)}초` : '   —  '}`
    + `    ${m ? `${who} ${m.t.toFixed(1).padStart(5)}초` : '     —'}`
    + `   ${o && m ? `${(m.t - o.t >= 0 ? '+' : '') + (m.t - o.t).toFixed(1)}초` : ''}`
    + `  ${o && m ? (inBucket(m.t, o.t) ? '같은 칸' : '') : ''}`
    + `${same ? '' : o && m ? '  ← 누른 사람이 다름' : ''}`);
}

/* 쿨타임 경고가 하나라도 나오면 이 무늬가 모형 안에서 성립하지 않는다는 뜻이다.
   크라운을 13초 간격으로 두 번 부르는 것이 쿨감 없이는 불가능하므로, 여기가
   조용한 것이 곧 "쿨감이 실제로 그만큼 돈다" 는 확인이다. */
const warns = [...new Set(best.r.warnings)].filter(w => w.includes('쿨타임'));
console.log(`\n쿨타임 충돌: ${warns.length ? warns.join(' / ') : '없음 — 실측 무늬가 모형 안에서 성립한다'}`);
