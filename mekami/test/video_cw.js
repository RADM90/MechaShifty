/* 신데렐라 : CW 단독 영상 대조 — `node mekami/test/video_cw.js`.

   2026-08-17 촬영, 60fps, 26.6초. 영상 자체는 리포에 안 올린다 (개인 녹화 · 용량).
   여기 남기는 것은 **영상에서 읽어낸 수와 그것이 모형과 맞는지**다.

   ── 왜 이 영상 하나로 만충값이 나오나 ──────────────────────

   신데렐라 : CW 의 1스킬이 "아군이 소비한 탄 200발마다 버스트 게이지 12% 충전" 이다.
   그래서 게이지 막대에 **200발마다 계단**이 찍힌다. 계단 셋이 눈금 역할을 해서,
   막대의 픽셀↔수치 환산을 몰라도 값이 닫힌다:

     계단 J px = P × 트랙폭 W        (P = 스킬 충전 비율)
     계단 사이 상승 R px = 200발 × E  (E = 발당 수급량)
     만충에서 소비 = S발 × E + 3 × P × G

   미지수가 W·G·P 셋인데 식도 셋이라 풀린다. 그리고 **P 가 답으로 나온다** —
   넣지 않은 값이 12.04% 로 나왔고 CDN 의 스킬 레벨 10 값이 12.0% 다. 그게 이
   역산이 맞다는 증거다. */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Sim } from '../assets/engine.next.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = p => JSON.parse(readFileSync(join(ROOT, p), 'utf-8'));

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  PASS  ${name}${detail ? '  :: ' + detail : ''}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? '  :: ' + detail : ''}`); }
};
const near = (a, b, eps) => Math.abs(a - b) <= eps;
const head = t => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 52 - t.length))}`);

/* ── 영상에서 읽어낸 것 (픽셀 측정) ───────────────────────── */

const 관측 = {
  계단: [19.40, 19.50, 19.95],            // 12% 충전이 막대에 찍은 폭 (px)
  계단시각: [15.55, 18.88, 22.22],        // 영상 시각 (초)
  계단사이상승: [32.02, 31.91],           // 200발이 총알로 채운 양 (px)
  /* 막대가 사라진 프레임. **누른 것이 아니다** — 이 편성에는 1버스트 니케가 없어
     버스트가 한 번도 안 나갔다. UI 가 만충 상태의 버튼으로 바뀐 것이고, 23.2·24.5·26.0초
     프레임에 초록 Ⅰ 육각형이 켜진 채 그대로 서 있다. 즉 **만충 시각**이다. */
  만충시각: 23.067,
  총발사: 651,                             // 만충까지
};

head('영상에서 읽은 수 — 200발마다 계단이 찍힌다');

const 간격 = [관측.계단시각[1] - 관측.계단시각[0], 관측.계단시각[2] - 관측.계단시각[1]];
ok('계단 간격이 두 번 다 3.333초', 간격.every(g => near(g, 3.3333, 0.01)),
   간격.map(g => g.toFixed(3)).join(' · '));
/* 200발이 3.333초 = 60.0발/초. **프레임 상한 그대로다** — CDN 의 4200 RPM(70발/초)은
   60fps 기기에서 안 나온다. 실측이 이 규칙을 직접 보여 준다. */
ok('그러면 60.0발/초 — 프레임 상한과 같다',
   near(200 / 간격[0], 60, 0.1), `${(200 / 간격[0]).toFixed(1)}발/초`);

head('역산 — 넣지 않은 값이 답으로 나오는가');

const J = 관측.계단.reduce((a, b) => a + b) / 3;
const R = 관측.계단사이상승.reduce((a, b) => a + b) / 2;
const S = 관측.총발사;
const E = read('mekami/data/combat/c515.json').shot.burstEnergy.perTargetShot;
const W = (R * S + 600 * J) / 200;      // 트랙 폭 (px)
/* 이 영상이 재는 것은 **만충값 자체가 아니라 `만충 ÷ 표적 수`** 다. 발당 수급 E 는
   표적 하나당 값이므로, 한 발이 k 개에 닿았다면 실제 만충은 이것의 k 배다. */
const G1 = 200 * E * W / R;             // 만충 ÷ 표적 수
const P = J / W;                        // 스킬 충전 비율 — **이게 검증이다**

const 표값 = read('mekami/data/combat/c515.json').skills.s1.values[8].at(-1) / 100;
ok('역산이 스킬 충전 %를 되찾는다', near(P, 표값, 0.005),
   `역산 ${(P * 100).toFixed(2)}% vs CDN ${(표값 * 100).toFixed(1)}%`);
ok('만충 ÷ 표적 수', near(G1, 10192, 60), `${Math.round(G1).toLocaleString()}`);
/* 만충값은 아레나 도구 자료가 20,000 으로 못박는다. 그러면 이 녹화의 표적 수가
   나온다 — 한 발이 두 번 맞았다는 뜻이고, 엔진 기본값이 여기서 왔다. */
const eng0 = new Sim({ squad: [], battle: {} });
ok('만충 20,000 을 넣으면 이 판의 표적 수가 나온다', near(eng0.o.gaugeMax / G1, 2, 0.05),
   `${(eng0.o.gaugeMax / G1).toFixed(2)} 개`);
/* 트랙 왼쪽 끝은 "BURST" 글자 뒤에 가려 안 보인다. 역산이 그 폭까지 되찾는다. */
ok('트랙 폭도 되찾는다 (왼쪽 끝이 글자 뒤에 숨어 있다)', near(W, 162.9, 1),
   `${W.toFixed(1)}px`);

head('사격 모형 대조 — 게이지와 무관한 독립 검증');

/* 스킬·버프를 빼고 총만 쏘게 해서 발사 시각을 전부 받는다. */
const c = read('mekami/data/combat/c515.json');
const sim = new Sim({
  squad: [{ id: 'cw', name: 'CW', burst: 'Step3', burstDuration: c.burstDuration,
            burstCooldown: 40, burstEnergy: E, critRate: 0,
            combat: { shot: { ...c.shot, maxAmmo: 843 } },   // 영상의 실제 장탄
            effects: { rules: [], unmodeled: [], problems: [] },
            stats: { atk: 1, def: 0, hp: 1 } }],
  enemy: { def: 0 }, battle: { seconds: 14, gaugeMax: null, sample: 0 },
});
const times = [];
const orig = sim.onShot.bind(sim);
sim.onShot = ev => { times.push(sim.t); orig(ev); };
sim.run();

/* 실측 시각에서 모형 시각을 빼면 전투 시작 시각이 나온다. 네 지점이 한 점을
   가리켜야 모형이 맞는 것이다. */
const 지점 = [[200, 관측.계단시각[0]], [400, 관측.계단시각[1]],
              [600, 관측.계단시각[2]], [S, 관측.만충시각]];
const 시작 = 지점.map(([n, t]) => t - times[n - 1]);
const 폭 = Math.max(...시작) - Math.min(...시작);
ok('네 지점이 같은 전투 시작을 가리킨다 (13초 예측, 오차 10ms 이내)',
   폭 < 0.01, `${Math.min(...시작).toFixed(3)} ~ ${Math.max(...시작).toFixed(3)}초 (폭 ${(폭 * 1000).toFixed(0)}ms)`);
ok('최고 연사 구간이 맞는다',
   near(times[399] - times[199], 간격[0], 0.01),
   `실측 ${간격[0].toFixed(3)}초 · 모형 ${(times[399] - times[199]).toFixed(3)}초`);

/* 만충 시점의 발사 수를 모형이 그대로 짚는가 — 역산의 S 가 맞았다는 확인이다. */
const 시작평균 = 시작.reduce((a, b) => a + b) / 4;
ok('만충 시점 발사 수를 모형이 짚는다',
   near(시작평균 + times[S - 1], 관측.만충시각, 0.02),
   `${(시작평균 + times[S - 1]).toFixed(3)}초 vs 실측 ${관측.만충시각}초`);

head('엔진이 이 값을 쓰고 있는가');

const eng = new Sim({ squad: [], battle: {} });
ok('만충 기준값', eng.o.gaugeMax === 20000, String(eng.o.gaugeMax));
ok('기본 표적 수', eng.o.표적수 === 2, String(eng.o.표적수));
/* 둘을 나눈 값이 이 영상이 잰 것과 같아야 한다 — 기본 설정이 이 녹화를 재현한다. */
ok('만충 ÷ 표적 수 = 이 영상이 잰 값',
   near(eng.o.gaugeMax / eng.o.표적수, G1, 250),
   `${eng.o.gaugeMax / eng.o.표적수} vs ${Math.round(G1)}`);

console.log(`\n${'═'.repeat(56)}`);
console.log(`  PASS ${pass} · FAIL ${fail}`);
process.exit(fail ? 1 : 0);
