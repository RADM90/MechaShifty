/* 풀 스쿼드 영상 대조 — `node mekami/test/video_squad.js`.

   400레벨 제한 이상개체 요격전(하베스터) 클리어. 2026-08-17 촬영, 60fps, 214.5초.
   아니스 : 스타 · 크라운 · 신데렐라 : 크리스탈 웨이브 · 라피 : 레드 후드 · 프리바티.
   수동 조작. 영상 자체는 리포에 안 올린다 (개인 녹화 · 용량) — **읽어낸 수와 그것이
   모형과 맞는지**만 남긴다.

   `video_cw.js` 가 만충 기준값을 잡았다면 이쪽은 **사이클의 뼈대**를 잡는다:
   사람이 언제 누르는가, 컷신이 얼마를 먹는가, 그동안 전투가 흐르는가.

   ── 신호를 어떻게 갈랐나 ────────────────────────────────────

     게이지 만충 (Ⅰ 점등)  아이콘 자리 56×56 크롭의 **국소** 흰 섬광 (흰 화소 700→2,880)
     버스트 누름           8×8 로 줄인 **화면 전체** 밝기 섬광 (93→155)
     컷신                  그 뒤 밝기가 36 까지 떨어지는 0.7초 구간

   둘이 서로 다른 자리의 신호라 섞이지 않는다. 처음에는 육각형 색만 봤는데 배경 모래와
   불꽃이 전부 R>G>B 라 주황으로 잘못 잡혔다 — 채도 0.72 이상만 남기고서야 갈렸다.

   그리고 **컷신 도중에는 아이콘이 이전 단계 숫자를 그대로 든다.** "숫자가 바뀌는
   순간" 을 누름으로 읽으면 1.5초씩 늦게 잡힌다. */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { compile } from '../assets/effects.js';
import { Sim, simulate } from '../assets/engine.next.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = p => JSON.parse(readFileSync(join(ROOT, p), 'utf-8'));

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  PASS  ${name}${detail ? '  :: ' + detail : ''}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? '  :: ' + detail : ''}`); }
};
const near = (a, b, eps) => Math.abs(a - b) <= eps;
const head = t => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 54 - t.length))}`);

/* ── 영상에서 읽어낸 것 ─────────────────────────────────────── */

const 관측 = {
  길이: 214.5,
  사이클: 16.55,                 // Ⅰ 누름 사이의 평균 (12사이클)
  /* 사이클을 여섯 조각으로 갈라 잰 것. 합이 주기와 맞아야 한다. */
  충전: 1.55, 반응: 0.52, ⅠtoⅡ: 1.60, ⅡtoⅢ: 1.43, Ⅲto풀버스트: 1.45, 풀버스트: 10.00,
  /* 만충에서 Ⅰ 을 누르기까지, 10사이클. 사람이 정하는 유일한 값이다. */
  반응들: [0.50, 0.98, 0.17, 0.58, 0.60, 0.55, 0.52, 0.43, 0.52, 0.35],
  /* 컷신 동안 잔탄이 움직였는가 (신데렐라 : CW, MG). [시각, 잔탄] */
  잔탄: [[23.90, 504], [24.10, 492], [24.60, 484], [24.90, 484],
         [25.20, 484], [25.50, 484]],
  누름: 24.27,
  /* 풀버스트 종료 -> 만충. 막대는 종료 시점에 0 에서 시작한다 (잠금이 안 끊긴다). */
  만충까지: 1.47,
};

head('사이클 여섯 조각의 합이 주기와 맞는가');

const 합 = 관측.충전 + 관측.반응 + 관측.ⅠtoⅡ + 관측.ⅡtoⅢ + 관측.Ⅲto풀버스트 + 관측.풀버스트;
ok('여섯 조각을 더하면 실측 주기', near(합, 관측.사이클, 0.01),
   `${합.toFixed(2)}초 vs 주기 ${관측.사이클}초`);

const 컷신 = 관측.ⅠtoⅡ + 관측.ⅡtoⅢ + 관측.Ⅲto풀버스트;
ok('그중 컷신이 4.48초', near(컷신, 4.48, 0.01), `${컷신.toFixed(2)}초`);
/* **컷신을 빼면 모형이 돌려야 할 사이클이 남는다.** */
ok('빼고 남는 것이 12.07초', near(합 - 컷신, 12.07, 0.01), `${(합 - 컷신).toFixed(2)}초`);

head('컷신 동안 전투가 흐르는가 — 잔탄으로 (열린 물음 M 을 여기서 걷는다)');

const [t0, a0] = 관측.잔탄[0], [t1, a1] = 관측.잔탄[1];
ok('누르기 직전에는 60발/초로 쏘고 있었다', near((a0 - a1) / (t1 - t0), 60, 3),
   `${((a0 - a1) / (t1 - t0)).toFixed(0)}발/초`);

const 이후 = 관측.잔탄.filter(([t]) => t > 관측.누름);
const 멈춤 = 이후.every(([, a]) => a === 이후[0][1]);
const 구간 = 이후[이후.length - 1][0] - 관측.누름;
ok('누른 뒤로는 한 발도 안 나간다', 멈춤,
   `${구간.toFixed(2)}초 동안 ${이후[0][1]}발 그대로 (60발/초면 ${Math.round(구간 * 60)}발이 나갔어야)`);
/* 화면이 어두운 것은 0.72초뿐인데 밝은 앞뒤 0.78초에도 안 나간다 — **전환 전체가
   멈춘다.** 어두운 구간만 빼는 것이 아니라 통째로 빼는 것이 맞다. */
ok('어두운 구간(0.72초)보다 오래 멈춘다 — 전환 전체가 멈춘 것',
   구간 > 0.72 + 0.3, `${구간.toFixed(2)}초 멈춤 vs 어두운 구간 0.72초`);

head('엔진이 이 값을 쓰고 있는가');

const eng = new Sim({ squad: [], battle: {} });
ok('반응 시간이 실측 중앙값', eng.o.pressDelay === 0.52, String(eng.o.pressDelay));
const 중앙 = [...관측.반응들].sort((a, b) => a - b);
ok('그 중앙값이 실제로 0.52초', near((중앙[4] + 중앙[5]) / 2, 0.52, 0.005),
   `${((중앙[4] + 중앙[5]) / 2).toFixed(3)}초 · 폭 ${중앙[0]}~${중앙[중앙.length - 1]}`);
/* 컷신은 사이클에서 뺀다 (메커니즘 16) — 자리는 남기고 값은 0 이다. */
ok('컷신은 사이클에서 빠져 있다', eng.o.cutIn === 0 && eng.o.fbDelay === 0,
   `cutIn ${eng.o.cutIn} · fbDelay ${eng.o.fbDelay}`);
/* 만충값은 아레나 도구 자료로 확정됐고(20,000), 표적 수 기본 2 는 신데렐라 : CW
   단독 영상이 잰 값이다. 둘은 짝이라 따로 보면 안 된다. */
ok('만충 20,000 · 표적 수 2', eng.o.gaugeMax === 20000 && eng.o.표적수 === 2,
   `${eng.o.gaugeMax} / ${eng.o.표적수}`);

head('같은 편성을 넣으면 — 아직 안 맞는 곳 (열린 물음 N)');

const build = rid => {
  const combat = read(`mekami/data/combat/c${rid}.json`);
  const cd = (combat.skills.burst && combat.skills.burst.cooldown) || [20];
  return {
    id: `c${rid}`, name: combat.name.ko, burst: combat.burst,
    burstDuration: combat.burstDuration, burstCooldown: cd[cd.length - 1],
    burstEnergy: combat.shot.burstEnergy.perTargetShot,
    critRate: combat.crit && combat.crit.rate != null ? combat.crit.rate / 100 : 0.15,
    combat, effects: compile(read(`mekami/data/effects/c${rid}.json`), combat),
    stats: { atk: 300000, def: 30000, hp: 1000000 },
  };
};
const squad = ['017', '330', '515', '016', '170'].map(build);
const out = simulate({ squad, enemy: { def: 0, 코어명중가능: true, 교전거리: '중거리' },
                       battle: { seconds: 160, sample: 0 } });
const b = out.fullBurst;

/* 영상 214.5초에서 컷신 12사이클 × 4.48초를 빼면 160초쯤이 모형의 시간이다.
   **횟수를 딱 12 로 못 박지 않는다.** 영상은 녹화한 사람의 레벨·큐브·오버로드를 안
   알려 주므로 여기 스탯은 어림값이고, 그것이 사격 속도를 거쳐 횟수를 한 번쯤 흔든다.
   보는 것은 "자릿수가 맞는가" 다. */
ok('풀버스트 횟수가 영상과 같은 자리에 있다', b.count >= 11 && b.count <= 13,
   `모형 ${b.count}회 · 영상 12회`);

/* **충전이 이 영상만 아직 안 맞는다.** 만충값은 밖에서 확정됐고 표적 수 기본 2 는
   단독 영상이 잰 값이니, 남는 물음은 "파츠가 여럿인 보스는 한 발이 몇 개에 닿나" 다.
   그 값을 **풀어서** 낸다 — 시간이 표적 수에 정확히 반비례하지는 않기 때문이다
   (12% 짜리 스킬 충전은 만충 대비 비율이라 표적 수와 무관하고, 만충에서 잘린다). */
const 만충까지 = 표적수 => {
  const r = simulate({ squad, enemy: { def: 0, 코어명중가능: true, 교전거리: '중거리' },
                       battle: { seconds: 160, sample: 0, 표적수 } });
  const e = r.log.filter(x => x.kind === 'fbEnd').map(x => x.t);
  const a = r.log.filter(x => x.kind === 'armed').map(x => x.t);
  const g = e.map(t => { const n = a.find(x => x > t); return n == null ? null : n - t; })
             .filter(Boolean);
  return g.length ? g.reduce((x, y) => x + y, 0) / g.length : Infinity;
};
const eng2 = new Sim({ squad: [], battle: {} });
let 최적 = eng2.o.표적수, 최소 = Infinity;
for (let k = 1; k <= 14; k++) {
  const d = Math.abs(만충까지(k) - 관측.만충까지);
  if (d < 최소) { 최소 = d; 최적 = k; }
}
ok('기본값에서는 충전이 실측보다 한참 느리다',
   만충까지(eng2.o.표적수) / 관측.만충까지 > 2,
   `${만충까지(eng2.o.표적수).toFixed(2)}초 vs 영상 ${관측.만충까지}초`);
ok('하베스터가 가리키는 표적 수는 기본값보다 크다', 최적 > eng2.o.표적수,
   `${최적} 개 (기본 ${eng2.o.표적수}) -> 만충까지 ${만충까지(최적).toFixed(2)}초`);
ok('그래도 터무니없는 수는 아니다', 최적 <= 12, `${최적} 개`);
ok('그 값을 넣으면 실측 충전 시간에 붙는다', 최소 < 0.2,
   `${만충까지(최적).toFixed(2)}초 vs 영상 ${관측.만충까지}초 (차 ${최소.toFixed(2)}초)`);

console.log(`\n${'═'.repeat(58)}`);
console.log(`  PASS ${pass} · FAIL ${fail}`);
process.exit(fail ? 1 : 0);
