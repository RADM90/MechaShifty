/* 1세대 · 2세대 나란히 — `node mekami/test/compare.next.js [초]`.

   같은 스쿼드·같은 씨앗으로 두 엔진을 돌려 **어디가 왜 달라졌는지**를 낸다.

   이 대조가 이번 단계의 주된 검증이다. 새 엔진이 "그럴듯한 숫자" 를 내는 것만으로는
   옮기기가 맞았는지 알 수 없다 — 무엇이 같아야 하고 무엇이 달라야 하는지를 미리
   정해 두고 그대로 나오는지 봐야 한다.

     같아야 하는 것   발사 수 · 재장전 수 · 장탄수
                      사격 기계장치를 그대로 옮겼으므로. 다르면 이식이 틀린 것이다
     달라야 하는 것   누적 대미지 · 게이지 · 사이클
                      공식과 게이지 규칙이 바뀌었으므로. 같으면 안 바뀐 것이다

   1세대를 정답으로 두고 맞추는 것이 아니다. 1세대는 네 군데가 틀린 채로 돌던
   물건이고, 여기서 하는 일은 **차이를 설명할 수 있는 상태로 만드는 것**이다. */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildTables, compute } from '../../assets/cp.js';
import { compile } from '../assets/effects.js';
import { defaultInput, staticBuffs } from '../assets/defaults.js';
/* **지금 앱이 돌리고 있는** 1세대를 부른다 (`assets/engine.js`). `legacy/` 의 사본은
   보관본이고, 대조 상대는 실제로 화면을 그리고 있는 쪽이어야 한다. */
import { simulate as 구세대 } from '../assets/engine.js';
import { simulate as 신세대 } from '../assets/engine.next.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const read = p => JSON.parse(readFileSync(join(ROOT, p), 'utf-8'));

const SECONDS = Number(process.argv[2] || 120);
const SEED = 1;
const LEVEL = 400;

const NEED = ['syncro_stat', 'attraction_stat', 'attraction_grade', 'equip_stat',
  'equip_option', 'cube_stat', 'collection_stat', 'collection_bonus', 'cp_penalty'];
const T = buildTables(Object.fromEntries(NEED.map(k => [k, read(`data/raw/${k}.json`)])));
const cubes = read('mekami/data/cubes_effect.json');
const collection = read('mekami/data/collection.json');
const index = read('mekami/data/index.json').nikkes;

/* 두 엔진이 **같은 배우**를 받아야 비교가 성립한다. 2세대가 더 많은 필드를 보므로
   합집합으로 만들어 넘긴다 — 1세대는 모르는 필드를 그냥 무시한다. */
function build(rid) {
  const combat = read(`mekami/data/combat/c${rid}.json`);
  const m = index.find(x => x.rid === Number(rid));
  const input = defaultInput({ rarity: m.rarity, class: m.class, corporation: m.corporation },
                             { weapon: combat.shot.weapon });
  const cp = compute(T, input, LEVEL);
  const { buffs, ammo } = staticBuffs({ T, input, weapon: combat.shot.weapon, cubes, collection });
  const cd = (combat.skills.burst && combat.skills.burst.cooldown) || [20];
  return {
    id: `c${rid}`, name: combat.name.ko, combat,
    effects: compile(read(`mekami/data/effects/c${rid}.json`), combat),
    stats: cp.stats, staticBuffs: buffs, staticAmmo: ammo, isElement: true,
    /* 2세대가 배우에게서 직접 읽는 것들 */
    burst: combat.burst,
    burstDuration: combat.burstDuration,
    burstCooldown: cd[cd.length - 1],
    burstEnergy: combat.shot.burstEnergy.perTargetShot,
    critRate: combat.crit && combat.crit.rate != null ? combat.crit.rate / 100 : 0.15,
  };
}

const SQUAD = ['017', '330', '354', '016', '515'];
const squad = SQUAD.map(build);

/* 1세대는 사이클 길이를 입력으로 받고 순서를 밖에서 적어 준다. 2세대는 둘 다
   스스로 정한다 — 그 자체가 큰 차이라 여기서 맞춰 주지 않는다. */
const old = 구세대({
  squad, rotation: [{ step1: 'c017', step2: 'c330', step3: 'c016' },
                    { step1: 'c017', step2: 'c354', step3: 'c515' }],
  enemy: { def: 0, coreHitRate: 1 },
  battle: { seconds: SECONDS, sample: SECONDS, reaction: 0 },
});
const next = 신세대({
  squad,
  enemy: { def: 0, 코어명중가능: true, 교전거리: null },
  battle: { seconds: SECONDS, sample: 0.5, seed: SEED, pressDelay: 0, snapshot: true },
});

const n = v => (Math.abs(v) >= 1e8 ? `${(v / 1e8).toFixed(2)}억`
  : Math.abs(v) >= 1e4 ? `${(v / 1e4).toFixed(1)}만` : String(Math.round(v)));
const pct = v => `${(v * 100).toFixed(1)}%`;
const 배 = (a, b) => (b ? `${(a / b).toFixed(2)}배` : '—');

console.log(`\n예제 5인 · ${SECONDS}초 · 씨앗 ${SEED} · 적 방어력 0 · 코어 명중\n`);

/* ── 같아야 하는 것 ──────────────────────────────────────── */

/* **맨몸 대조가 먼저다.** 효과표를 통째로 비우고 돌리면 남는 것은 사격 기계장치뿐이라,
   여기가 어긋나면 이식이 틀린 것이다. 효과를 켠 채로 비교하면 버프 타이밍 차이와
   이식 오류가 섞여서 어느 쪽인지 가릴 수가 없다. */
const 맨몸 = squad.map(s => ({ ...s, effects: { rules: [], unmodeled: [], problems: [] } }));
const 맨몸구 = 구세대({
  squad: 맨몸, rotation: [], enemy: { def: 0, coreHitRate: 1 },
  battle: { seconds: SECONDS, sample: SECONDS, burstMode: 'fixed', cycle: 1e9 },
});
const 맨몸신 = 신세대({
  squad: 맨몸, enemy: { def: 0, 코어명중가능: true },
  battle: { seconds: SECONDS, sample: SECONDS, seed: SEED, gaugeMax: null },
});
console.log('── 맨몸 사격 — 효과표를 비우고 총만 쏜다 ' + '─'.repeat(24));
console.log('  니케                    1세대 발사   2세대 발사   재장전');
let 맨몸일치 = true;
for (const s of squad) {
  const o = 맨몸구.byActor.find(a => a.id === s.id);
  const w = 맨몸신.byActor.find(a => a.id === s.id);
  const 같음 = o.shots === w.shots && o.reloads === w.reloads;
  if (!같음) 맨몸일치 = false;
  console.log(`  ${s.name.padEnd(22)}${String(o.shots).padStart(9)}${String(w.shots).padStart(13)}`
    + `   ${o.reloads}/${w.reloads}${같음 ? '' : '   ← 다름'}`);
}
console.log(맨몸일치
  ? '  전부 일치 — **사격 이식이 맞다.** 아래에서 갈리는 것은 버프 탓이다'
  : '  ! 다르다 — 이식이 틀렸다. 예열·재장전·장탄 계열부터 본다');

console.log('\n── 사격 (효과 켠 채) — 버프 타이밍이 달라 갈릴 수 있다 ' + '─'.repeat(10));
console.log('  니케                    1세대 발사   2세대 발사   재장전   장탄');
let 사격일치 = true;
for (const s of squad) {
  const o = old.byActor.find(a => a.id === s.id);
  const w = next.byActor.find(a => a.id === s.id);
  const 같음 = o.shots === w.shots && o.reloads === w.reloads && o.ammo === w.ammo;
  if (!같음) 사격일치 = false;
  console.log(`  ${s.name.padEnd(22)}${String(o.shots).padStart(9)}`
    + `${String(w.shots).padStart(13)}   ${o.reloads}/${w.reloads}`
    + `   ${o.ammo}/${w.ammo}${같음 ? '' : '   ← 다름'}`);
}
console.log(사격일치
  ? '  전부 일치'
  : '  갈린다 — 재장전 속도 버프가 걸리는 시각과 기절 구간이 두 엔진에서 다르다.\n'
    + '  맨몸이 일치했다면 이건 이식 오류가 아니라 버프 차이다');

/* ── 달라야 하는 것 ──────────────────────────────────────── */

console.log('\n── 사이클 — 달라야 한다 (게이지 잠금·체인 무효가 새로 생겼다) ' + '─'.repeat(4));
const oFB = old.burst || {};
console.log(`  풀버스트     1세대 ${String(oFB.count).padStart(2)}회  ->  2세대 ${String(next.fullBurst.count).padStart(2)}회`);
console.log(`  업타임       1세대 ${pct(oFB.share || 0)}  ->  2세대 ${pct(next.fullBurst.share)}`);
console.log(`  평균 사이클  1세대 ${oFB.avgCycle ? oFB.avgCycle.toFixed(2) : '—'}초  ->  `
  + `2세대 ${next.fullBurst.count > 1 ? ((next.fullBurst.windows.at(-1).from - next.fullBurst.windows[0].from) / (next.fullBurst.count - 1)).toFixed(2) : '—'}초`);
console.log(`  체인 무효    1세대 없음(개념이 없다)  ->  2세대 ${next.chains.voided.length}회`);
console.log(`  버려진 명중  1세대 없음(잠금이 없다)  ->  2세대 ${next.wastedHits}회`);

console.log('\n── 대미지 — 달라야 한다 (여섯 칸으로 다시 짰다) ' + '─'.repeat(18));
console.log(`  누적   1세대 ${n(old.total)}  ->  2세대 ${n(next.total)}   (${배(next.total, old.total)})`);
console.log('  니케                     1세대       2세대     비율');
for (const s of squad) {
  const o = old.byActor.find(a => a.id === s.id);
  const w = next.byActor.find(a => a.id === s.id);
  console.log(`  ${s.name.padEnd(22)}${n(o.damage).padStart(10)}${n(w.damage).padStart(12)}`
    + `${배(w.damage, o.damage).padStart(9)}`);
}

console.log('\n  달라진 이유 (설명할 수 있어야 한다):');
console.log('    · "~ 대미지 증가" 가 곱 -> 합. 겹칠수록 2세대가 낮다');
console.log('    · 분배 대미지가 공격 쪽 -> 적이 받는 칸');
console.log('    · 차지 대미지가 별도 레이어 -> 풀차지 배율과 같은 칸에서 합산');
console.log('    · 크리가 기댓값 -> 타격마다 난수 (씨앗에 따라 흔들린다)');
console.log('    · 풀버스트 보너스가 공격 종류 표 -> 타격 시각. 버스트 본체는 못 받고');
console.log('      "추가 대미지" 는 받는다 (2세대가 12건을 풀버스트 뒤로 미룬다)');
console.log('    · 사이클이 달라 풀버스트에 머무는 시간 자체가 다르다');

/* ── 지켜야 하는 것 ──────────────────────────────────────── */

console.log('\n── 불변식 — 하나라도 깨지면 이 하네스가 실패로 끝난다 ' + '─'.repeat(11));
const 깨짐 = [];

if (!맨몸일치) 깨짐.push('맨몸 사격이 1세대와 다르다 — 이식 오류');

const 순서경고 = next.warnings.filter(w => w.includes('순서가 어긋'));
console.log(`  순서 의무 (버스트 본체가 풀버스트 전)   ${순서경고.length ? '! ' + 순서경고.length + '건' : '지켜짐'}`);
if (순서경고.length) 깨짐.push('버스트 본체가 풀버스트 중에 판정됐다');

const 미룸 = next.log.filter(l => l.kind === 'riderHeld').length;
console.log(`  풀버스트 뒤로 미룬 "추가 대미지"        ${미룸}건`);

/* **되먹임 재발 방지.** 1세대는 시전자 기준 공격력이 서로를 키워 164초에 63배까지
   갔다. 표식은 크기가 아니라 **자라는 모양**이다 — 전반과 후반의 최고 배율이 비슷해야
   한다. 뒤로 갈수록 커지면 고리가 살아 있다는 뜻이다. */
const 부품 = s => Math.max(...s.actors.map(a => a.atk / a.atkBase));
const 반 = which => Math.max(...next.snapshots
  .filter(x => (which === 0 ? x.t < SECONDS / 2 : x.t > SECONDS / 2)).map(부품));
const [전반, 후반] = [반(0), 반(1)];
const 최고 = Math.max(전반, 후반);
console.log(`  공격력 최고 배율                       전반 ×${전반.toFixed(2)} · 후반 ×${후반.toFixed(2)}`);
if (최고 >= 10) 깨짐.push(`공격력이 기본의 ${최고.toFixed(1)}배까지 갔다 — 되먹임 의심`);
if (후반 > 전반 * 1.15) 깨짐.push('후반 배율이 전반보다 크게 자란다 — 되먹임 의심');

console.log(`  2세대 경고                             ${[...new Set(next.warnings)].length}종`);
for (const w of [...new Set(next.warnings)].slice(0, 5)) console.log(`     ${w}`);

console.log('\n── 잠정값 (결과가 여기 기대고 있다) ' + '─'.repeat(30));
for (const p of next.잠정) {
  console.log(`  ${p.이름} = ${p.쓰는값}  (${p.출처})`);
}

console.log();
if (깨짐.length) {
  for (const x of 깨짐) console.log(`  ! ${x}`);
  process.exit(1);
}
console.log('  불변식 전부 지켜짐\n');
