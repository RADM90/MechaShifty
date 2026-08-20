/* 순수 모듈 검증 — `node mekami/test/run.js`.

   `Model_combat_mechanics.md` §7.3 의 체크리스트를 그대로 옮겼다. 브라우저 없이
   돌아가야 하는 이유는 여기서 보는 게 전부 숫자이기 때문이다. 화면을 띄워 놓고
   눈으로 재는 것보다 소수점까지 못박는 편이 빠르고 정확하다. */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { hitDamage, bonusLayer, resolveAmmo, RULE, KIND } from '../assets/formula.js';
import { compile } from '../assets/effects.js';
import { simulate } from '../assets/engine.js';
import { bondCap, defaultInput } from '../assets/defaults.js';
import { TYPE_DMG } from '../assets/effects.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, '..', 'data');
const combat = rid => JSON.parse(readFileSync(join(DATA, 'combat', `c${rid}.json`), 'utf-8'));

let pass = 0, fail = 0;
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}${detail ? '  :: ' + detail : ''}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? '  :: ' + detail : ''}`); }
}

function eq(name, got, want, eps = 1e-6) {
  ok(name, near(got, want, eps), `${round(got)} (기대 ${round(want)})`);
}

const round = v => (typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : v);
const head = t => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 58 - t.length))}`);

/* ══ 대미지 공식 ═══════════════════════════════════════════ */

head('BonusMultiplier 는 합연산인가 (문서 §4.2③ 실측)');

/* 문서의 실측: 기본 2521 -> 크리 3781(×1.5) -> 코어 5042(×2.0)
   -> 코어+크리 6302(×2.5) -> +풀버스트 7563(×3.0).
   기본 크리 확률 15% 를 상쇄해 "크리 없음"을 만들려고 critRate 에 -0.15 를 준다. */
const noCrit = { critRate: -RULE.CRIT_RATE };
const allCrit = { critRate: 1 };
const core = { coreHitRate: 1, coreDamage: 200 };

eq('기본 = ×1.0', bonusLayer(noCrit, KIND.NORMAL, {}), 1.0);
eq('크리 = ×1.5', bonusLayer(allCrit, KIND.NORMAL, {}), 1.5);
eq('코어 = ×2.0', bonusLayer(noCrit, KIND.NORMAL, core), 2.0);
eq('코어+크리 = ×2.5', bonusLayer(allCrit, KIND.NORMAL, core), 2.5);
eq('코어+크리+풀버 = ×3.0',
   bonusLayer(allCrit, KIND.NORMAL, { ...core, fullBurst: true }), 3.0);

const base = 2521;
eq('실측값 2521 -> 7563', base * bonusLayer(allCrit, KIND.NORMAL, { ...core, fullBurst: true }),
   7563, 1);

head('공격 유형별 적용표 (문서 §4.3)');

const ctxAll = { coreHitRate: 1, coreDamage: 200, fullBurst: true, inRange: true };
ok('버스트 스킬은 풀버스트 +50% 를 못 받는다',
   near(bonusLayer(noCrit, KIND.BURST, ctxAll), 1.0),
   `${round(bonusLayer(noCrit, KIND.BURST, ctxAll))}`);
ok('스킬 1·2 는 풀버스트를 받는다',
   near(bonusLayer(noCrit, KIND.SKILL, ctxAll), 1.5),
   `${round(bonusLayer(noCrit, KIND.SKILL, ctxAll))}`);
ok('코어는 평타만', near(bonusLayer(noCrit, KIND.SKILL, { ...core }), 1.0));
ok('거리 보너스는 평타만', near(bonusLayer(noCrit, KIND.SKILL, { inRange: true }), 1.0));
eq('평타는 거리 +30%', bonusLayer(noCrit, KIND.NORMAL, { inRange: true }), 1.3);

head('차지 배율은 평타 전용 (문서 §4.2⑤)');
const chg = { chargeDmg: 0.5, critRate: -RULE.CRIT_RATE };
eq('평타 차지 ×1.5',
   hitDamage({ atk: 1000, ratio: 1, kind: KIND.NORMAL, buff: chg }).breakdown.charge, 1.5);
eq('스킬 차지 ×1.0',
   hitDamage({ atk: 1000, ratio: 1, kind: KIND.SKILL, buff: chg }).breakdown.charge, 1.0);

head('방어력은 뺄셈, 음수는 0 으로 자르고 알린다 (문서 §4.2④ · §8-1)');
eq('공격력 1000 - 방어력 300 = 700',
   hitDamage({ atk: 1000, ratio: 1, buff: noCrit, ctx: { enemyDef: 300 } }).breakdown.attack, 700);
const under = hitDamage({ atk: 100, ratio: 1, buff: noCrit, ctx: { enemyDef: 300 } });
ok('방어력이 더 높으면 0 + 경고', under.value === 0 && under.underDefended === true);

head('시전자 기준 버프는 받는 쪽 공격력에 안 걸린다');
const flat = { atkFlat: 5000, critRate: -RULE.CRIT_RATE };
eq('공격력 10000 + 시전자분 5000',
   hitDamage({ atk: 10000, ratio: 1, buff: flat }).breakdown.attack, 15000);

head('우월코드 (문서 §4.2①)');
eq('우월코드 없음 ×1.0',
   hitDamage({ atk: 1, ratio: 1, buff: noCrit, ctx: {} }).breakdown.element, 1);
eq('우월코드 ×1.1',
   hitDamage({ atk: 1, ratio: 1, buff: noCrit, ctx: { isElement: true } }).breakdown.element, 1.1);
eq('우월코드 + 큐브 19.09% -> ×1.2909',
   hitDamage({ atk: 1, ratio: 1, buff: { ...noCrit, elemDmg: 0.1909 },
               ctx: { isElement: true } }).breakdown.element, 1.2909);

head('주는/받는 대미지는 다른 계열이라 곱한다 (문서 §4.2②)');
eq('(1+0.5) × (1+0.2) = 1.8',
   hitDamage({ atk: 1, ratio: 1, buff: { ...noCrit, damageUp: 0.5, receivedUp: 0.2 } })
     .breakdown.damage, 1.8);

/* ══ 장탄수 계열 분리 (문서 §3.3) ═══════════════════════════ */

head('장탄수는 계열마다 따로 반올림한다');

/* SR 6발에 오버로드 장탄 27.84%(계열 A)와 큐브 9.5%(계열 B).
   합쳐서 한 번 반올림하면 6 + round(6×0.3734) = 6+2 = 8.
   계열을 갈라 따로 반올림하면 6 + round(6×0.2784) + round(6×0.095) = 6+2+1 = 9. */
const split = resolveAmmo(6, { A: 0.2784, B: 0.095 });
const naive = 6 + Math.round(6 * (0.2784 + 0.095));
eq('계열 분리 = 9발', split, 9);
eq('합산 방식이었다면 8발', naive, 8);
ok('둘이 1발 어긋난다 — 이래서 계열을 갈라야 한다', split - naive === 1);
eq('MG 300발 + 소장품 9.5% = 329발', resolveAmmo(300, { B: 0.095 }), 329);

/* ══ MG 예열 (문서 §3.5) ═══════════════════════════════════ */

head('MG 예열 — 화면 녹화 실측과 맞는가 (60fps, 라피 : 레드 후드)');

const rh = combat('016');
const rof = rh.shot.rof;
eq('시작 60 RPM', rof.start, 60);
eq('최대 4200 RPM', rof.end, 4200);
eq('발당 +100 RPM (올라갈 때 계단)', rof.perShot, 100);

const HEAT_MAX = Math.ceil((rof.end - rof.start) / rof.perShot);
eq('계단 수는 올림 — 41 이면 4160 에 주저앉는다', HEAT_MAX, 42);

/* 실측한 발사 간격 (프레임). 냉각된 상태에서 쏘기 시작했을 때 2발째부터. */
const MEASURED = [23, 13, 10, 8, 6, 5, 5, 4, 4, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2];
const modelGap = n => 3600 / Math.min(rof.start + rof.perShot * n, rof.end);
let worst = 0;
MEASURED.forEach((g, i) => { worst = Math.max(worst, Math.abs(modelGap(i + 1) - g)); });
ok('CDN 램프가 실측 간격과 맞는다 (2~21발째)', worst < 1.0,
   `최대 오차 ${round(worst)}프레임 · 모델 ${MEASURED.map((_, i) => Math.round(modelGap(i + 1))).join(' ')}`);

head('최고 연사는 프레임레이트에 걸린다 (한 프레임에 한 발)');

/* 실측은 **첫 발부터 300발째까지**를 잰 것이다. 방아쇠를 당기고 첫 발이 나가기까지의
   1.00초(열 0 에서의 발 간격)는 그 앞에 따로 붙으므로 여기서 빼고 비교한다. */
const magOf = (fps, heat0 = 0) => {
  let s = 0, h = heat0;
  for (let n = 0; n < rh.shot.maxAmmo; n++) {
    const gap = Math.max(60 / Math.min(rof.start + rof.perShot * h, rof.end), 1 / fps);
    if (n > 0) s += gap;                        // 첫 발 앞의 간격은 제외
    h = Math.min(h + 1, HEAT_MAX);
  }
  return s;
};
eq('60fps 첫 발~300발째 = 6.52초 (실측)', magOf(60), 6.52, 0.1);
eq('60fps 탄창 평균 = 46.0발/초 (실측)', 300 / magOf(60), 46.0, 0.7);
eq('CDN 상한 4200 RPM = 70발/초', rof.end / 60, 70);
ok('프레임 상한을 안 걸면 실측보다 빨라진다',
   magOf(1e9) < magOf(60) - 0.3, `상한없음 ${round(magOf(1e9))}초 vs 60fps ${round(magOf(60))}초`);

const solo60 = simulate({
  squad: [{ id: 'x', combat: rh, effects: { rules: [], unmodeled: [], problems: [] },
            stats: { atk: 1e5, def: 0, hp: 1 } }],
  rotation: [], enemy: { def: 0, coreHitRate: 0 },
  battle: { seconds: 1 + 6.52, sample: 8, fps: 60 },
});
eq('엔진도 (첫 발 대기 1.00초 + 6.52초) 에 300발', solo60.byActor[0].shots, 300, 4);

head('냉각 — 실측 곡선 (0.3초 유지 · 1.4초면 완전 초기화)');

/* 멈춘 뒤 재개했을 때 첫 간격에서 역산한 열. 표는 engine.js DEFAULTS.heatDecay.
   0.25초는 재개 간격이 1프레임이라 "82% 이상"까지만 알 수 있다 — 프레임 상한에
   가려 그 위는 구분이 안 된다. 그래서 그 점만 하한으로 본다. */
const COOL = [[0.5, 0.39], [0.83, 0.25], [1.03, 0.13], [1.13, 0.03], [1.45, 0]];
const cool = gap => {
  const c = [[0, 1], [0.3, 1], [0.5, 0.39], [0.8, 0.25], [1.05, 0.13], [1.15, 0.03], [1.4, 0]];
  for (let i = 1; i < c.length; i++) {
    if (gap <= c[i][0]) {
      return c[i - 1][1] + (c[i][1] - c[i - 1][1]) * (gap - c[i - 1][0]) / (c[i][0] - c[i - 1][0]);
    }
  }
  return 0;
};
for (const [gap, want] of COOL) {
  ok(`${gap}초 멈추면 열 ${Math.round(want * 100)}% 남는다`,
     Math.abs(cool(gap) - want) < 0.12, `모델 ${Math.round(cool(gap) * 100)}%`);
}
ok('재장전 2.5초 > 1.4초 — 재장전마다 완전히 식는다', cool(rh.shot.reload) === 0,
   `${rh.shot.reload}초 -> ${Math.round(cool(rh.shot.reload) * 100)}%`);
ok('0.25초 끊김은 82% 이상 남는다 (실측 하한)', cool(0.25) >= 0.82,
   `${Math.round(cool(0.25) * 100)}%`);

head('탄착군도 같은 모양의 두 번째 램프 — MG 만 수렴한다');
const acc = rh.shot.acc;
eq('MG 250 -> 10, 발당 -7', (acc.start - acc.end) / acc.perShot, 240 / 7, 1e-9);
eq('35발째 수렴', Math.ceil((acc.start - acc.end) / acc.perShot), 35);

/* ══ 엔진 ══════════════════════════════════════════════════ */

head('엔진 — 사격·재장전·예열이 시간축에서 맞물리는가');

const dummy = { rules: [], unmodeled: [], problems: [] };
const one = (rid, extra = {}) => ({
  id: `a${rid}`, combat: combat(rid), effects: dummy,
  stats: { atk: 100000, def: 10000, hp: 1000000 },
  isElement: false, ...extra,
});

const solo = simulate({
  squad: [one('016')],
  rotation: [],
  enemy: { def: 0, coreHitRate: 0 },
  battle: { seconds: 60, sample: 1 },
});
const a0 = solo.byActor[0];
ok('발사 수가 상수 최고연사 가정보다 적다 (첫 예열 + 재장전)',
   a0.shots < 60 * 70, `${a0.shots}발 (상수 4200RPM 이면 ${60 * 70}발)`);

/* 재장전이 열을 완전히 날리므로 탄창마다 조건이 같다. 한 바퀴는
   첫 발 대기 1.00초 + 299발 6.48초 + 재장전 2.5초 = 9.98초. */
const cycleLen = 1 + magOf(60) + rh.shot.reload;
const N = 5;
const five = simulate({
  squad: [one('016')], rotation: [], enemy: { def: 0, coreHitRate: 0 },
  battle: { seconds: cycleLen * N, sample: 60 },
});
eq(`다섯 탄창 = ${300 * N}발`, five.byActor[0].shots, 300 * N, 5);
eq('그동안 재장전 5번', five.byActor[0].reloads, N);
eq('재장전까지 넣은 지속 연사 ≈ 30발/초', 300 / cycleLen, 30.1, 0.4);

head('예열이 오르고, 재장전에서 완전히 식는가');

const warm = simulate({
  squad: [one('016')],
  rotation: [],
  enemy: { def: 0, coreHitRate: 0 },
  battle: { seconds: 24, sample: 0.5 },
});
const heat = warm.series.map(s => s.heat[0]);
/* t=0.5 에는 아직 0 이다 — 열이 0 이면 연사가 60 RPM 이라 첫 발이 1.0초에 나간다. */
ok('첫 발 전에는 0', heat[0] === 0, `t=0.5 에서 ${round(heat[0])}`);
ok('오르는 동안 뒷걸음질하지 않는다',
   heat.slice(0, 8).every((h, i, arr) => i === 0 || h >= arr[i - 1]),
   heat.slice(0, 8).map(round).join(' -> '));
ok('3.5초쯤 최대', heat[7] === 1, `t=3.5 에서 ${round(heat[7])}`);
ok('재장전(2.5초 > 1.4초)을 지나면 0 부터 다시', heat.slice(16).some(h => h === 0),
   `표본: ${heat.map(round).join(' ')}`);

/* 냉각 곡선을 늘리면(=더 천천히 식으면) 재장전에서도 열이 남아 더 많이 쏜다.
   실측 곡선이 아니라 손잡이가 살아 있는지만 본다. */
const withDecay = curve => simulate({
  squad: [one('016')], rotation: [], enemy: { def: 0, coreHitRate: 0 },
  battle: { seconds: 60, sample: 60, heatDecay: curve },
}).byActor[0].shots;
ok('안 식는다고 두면 더 많이 쏜다',
   withDecay([[0, 1], [99, 1]]) > withDecay([[0, 1], [0.1, 0]]),
   `${withDecay([[0, 1], [99, 1]])}발 vs ${withDecay([[0, 1], [0.1, 0]])}발`);

head('사격 공백이 1.4초보다 짧으면 예열이 남아 그만큼 빨리 재개하는가');

/* 예열이 식는 기준은 재장전 시간이 아니라 **총을 못 쏘는 시간 전체**다.
   앞뒤 모션 0.2초가 거기 들어가므로, 재장전 속도로 아무리 깎아도 공백은
   0.2초 아래로 못 내려간다. 대조군은 무조건 완전 초기화하는 곡선이다. */
const ALWAYS_RESET = [[0, 1], [0.01, 0]];
const MOTION = 0.2;
const withReload = (speed, curve) => simulate({
  squad: [{ ...one('016'),
            staticBuffs: [{ stat: 'reloadSpeed', value: speed, source: '테스트' }] }],
  rotation: [], enemy: { def: 0, coreHitRate: 0 },
  battle: { seconds: 60, sample: 60, ...(curve ? { heatDecay: curve } : {}) },
}).byActor[0].shots;
/* 재장전 시간은 선형으로 깎인다 — 기본 × (1 − 속도). 100% 에서 정확히 0 이 되고,
   그게 인게임에서 검증된 "재장전 속도 100% 이상이면 재장전을 안 한다" 이다. */
const reloadOf = speed => Math.max(0, rh.shot.reload * (1 - speed));
const gapOf = speed => MOTION + reloadOf(speed);
eq('재장전 속도 100% 면 재장전 0초', reloadOf(1.0), 0);
eq('그때 사격 공백은 모션 0.2초뿐', gapOf(1.0), 0.2);

for (const speed of [0, 0.3, 0.6, 0.75, 0.9, 1.0]) {
  const gap = gapOf(speed);
  const want = gap < 1.4;
  const gain = withReload(speed, null) - withReload(speed, ALWAYS_RESET);
  ok(`속도 +${Math.round(speed * 100)}% — 재장전 ${reloadOf(speed).toFixed(2)}초 `
     + `+ 모션 = 공백 ${gap.toFixed(2)}초 — 열 유지 ${want ? '있음' : '없음'}`,
     (gain > 0) === want, `${gain > 0 ? '+' : ''}${gain}발`);
}
ok('공백이 짧을수록 이득이 커진다',
   withReload(1.0, null) - withReload(1.0, ALWAYS_RESET)
   > withReload(0.6, null) - withReload(0.6, ALWAYS_RESET),
   `공백 ${round(gapOf(1))}초 +${withReload(1.0, null) - withReload(1.0, ALWAYS_RESET)}발 vs `
   + `${round(gapOf(0.6))}초 +${withReload(0.6, null) - withReload(0.6, ALWAYS_RESET)}발`);

/* 무한탄창의 핵심: 공백 0.2초는 냉각 곡선의 유지 구간(0.3초) 안이라 예열이 통째로
   살아남는다. 그래서 MG 가 두 번째 탄창부터 최고 연사로 시작한다. */
const inf = simulate({
  squad: [{ ...one('016'),
            staticBuffs: [{ stat: 'reloadSpeed', value: 1.0, source: '무한탄창' }] }],
  rotation: [], enemy: { def: 0, coreHitRate: 0 }, battle: { seconds: 30, sample: 0.5 },
});
const infHeat = inf.series.map(s => s.heat[0]);
ok('무한탄창이면 예열이 한 번 오른 뒤 안 떨어진다',
   infHeat.slice(10).every(h => h > 0.95),
   `최저 ${round(Math.min(...infHeat.slice(10)))}`);
const plain = simulate({
  squad: [one('016')], rotation: [], enemy: { def: 0, coreHitRate: 0 },
  battle: { seconds: 30, sample: 30 },
}).byActor[0].shots;
ok('무한탄창이 기본 재장전보다 훨씬 많이 쏜다',
   inf.byActor[0].shots > plain * 1.5, `${inf.byActor[0].shots}발 vs ${plain}발`);

/* 모션은 재장전 속도의 영향을 안 받는다 — 재장전이 0 이어도 0.2초는 남는다. */
ok('재장전 속도를 아무리 올려도 탄창당 0.2초는 못 줄인다',
   gapOf(99) === MOTION, `공백 ${gapOf(99)}초`);

head('풀버스트와 열이 같은 타임라인 위에 있는가 (문서 §3.5.4)');

/* 램프업이 +50% 구간을 잠식하는지. 풀버스트 표본 중에 열이 덜 찬 게 하나도
   없다면 두 계산이 따로 놀고 있다는 뜻이다. */
const fbSim = simulate({
  squad: [one('016'), one('017'), one('330')],
  rotation: [{ step1: 'a017', step2: 'a330', step3: 'a016' }],
  enemy: { def: 0, coreHitRate: 0 },
  battle: { seconds: 120, cycle: 20, sample: 0.5 },
});
const fbSamples = fbSim.series.filter(s => s.fullBurst);
ok('풀버스트 구간이 표본에 잡힌다', fbSamples.length > 0, `${fbSamples.length}개`);
ok('풀버스트 중에도 열이 덜 찬 순간이 있다 — 램프업이 +50% 를 잠식한다',
   fbSamples.some(s => s.heat[0] < 0.9),
   `최저 ${round(Math.min(...fbSamples.map(s => s.heat[0])))}`);

head('버스트 쿨타임은 쓰는 즉시 시작 · 40초는 격턴');

/* 여기만 **고정 사이클**로 돌린다. 보려는 것이 "쿨타임 중에 부르면 어떻게 되는가"
   인데, 게이지 방식은 셋 다 풀릴 때까지 기다려 주므로 그 상황 자체가 안 생긴다.
   20초마다 무조건 부르는 자리를 만들어야 쿨타임 가드가 드러난다. */
const cd = simulate({
  squad: [one('016'), one('017'), one('330')],
  rotation: [{ step1: 'a017', step2: 'a330', step3: 'a016' }],
  enemy: { def: 0, coreHitRate: 0 },
  battle: { seconds: 100, burstMode: 'fixed', cycle: 20, sample: 10 },
});
const bursts = cd.log.filter(l => l.kind === 'burst' && l.actor === 'a016');
eq('라피 : 레드 후드(CD 40초)는 100초에 3번', bursts.length, 3);
ok('버스트 간격이 40초 이상',
   bursts.every((b, i) => i === 0 || b.t - bursts[i - 1].t >= 40 - 1e-6),
   bursts.map(b => round(b.t)).join(' -> '));
ok('쿨타임 중 요청은 경고로 남는다', cd.warnings.some(w => w.includes('쿨타임')),
   `경고 ${cd.warnings.length}건`);

const fb = cd.log.filter(l => l.kind === 'fbStart');
eq('풀버스트가 3번', fb.length, 3);
const fbEnd = cd.log.filter(l => l.kind === 'fbEnd');
eq('풀버스트 길이 10초', fbEnd[0].t - fb[0].t, rh.burstDuration);

head('거리 보너스 — RL 은 사거리가 [0,0] 이라 저절로 빠진다');
const anis = combat('017');
ok('아니스 : 스타(RL) 사거리 [0,0]', anis.range[0] === 0 && anis.range[1] === 0,
   JSON.stringify(anis.range));
ok('라피 : 레드 후드(MG) 사거리 [35,55]', rh.range[1] === 55, JSON.stringify(rh.range));

head('효과 DSL — 모르는 이름을 조용히 삼키지 않는가');

const bad = compile({ rid: 16, s1: [{ on: '없는트리거', to: '없는대상',
                                      apply: [{ stat: '없는스탯', v: 1 }] }] }, rh);
ok('모르는 트리거를 짚는다', bad.problems.some(p => p.includes('트리거')));
ok('모르는 대상을 짚는다', bad.problems.some(p => p.includes('대상')));
ok('모르는 스탯을 짚는다', bad.problems.some(p => p.includes('스탯')));

const good = compile({
  rid: 16, textHash: rh.textHash,
  burst: [{ on: 'burstUse', to: 'allies', apply: [{ stat: 'atkFromCaster', v: 3, dur: { v: 4 } }] }],
}, rh);
eq('값 자리 {3} 레벨 10 = 18.01% -> 0.1801', good.rules[0].apply[0].value, 0.1801);
eq('지속 {4} = 10초', good.rules[0].apply[0].duration, 10);
ok('textHash 가 맞으면 낡지 않았다', good.stale === false);

const stale = compile({ rid: 16, textHash: 'deadbeef0000', burst: [] }, rh);
ok('textHash 가 어긋나면 낡았다고 표시', stale.stale === true);

const lv1 = compile({
  rid: 16,
  burst: [{ on: 'burstUse', to: 'self', apply: [{ stat: 'atkPct', v: 3, dur: { v: 4 } }] }],
}, rh, { levels: { burst: 1 } });
eq('스킬 레벨 1 이면 11.16% -> 0.1116', lv1.rules[0].apply[0].value, 0.1116);

/* ══ 손으로 쓴 효과표 ═══════════════════════════════════════ */

head('효과표 5장이 오류 없이 읽히고 원문과 맞는가');

const effects = rid => JSON.parse(readFileSync(join(DATA, 'effects', `c${rid}.json`), 'utf-8'));
const SQUAD = ['017', '330', '354', '016', '515'];
const built = SQUAD.map(rid => {
  const c = combat(rid);
  return { id: `c${rid}`, combat: c, effects: compile(effects(rid), c),
           stats: { atk: 167632, def: 30000, hp: 1500000 }, isElement: true };
});
for (const a of built) {
  ok(`${a.combat.name.ko} — 모르는 이름 없음`, a.effects.problems.length === 0,
     a.effects.problems.join(' / ') || `규칙 ${a.effects.rules.length}개`);
  ok(`${a.combat.name.ko} — 원문이 안 바뀌었다`, a.effects.stale === false);
}

head('스쿼드를 돌렸을 때 손으로 적은 장치가 실제로 도는가');

/* 여기서 보는 것은 **효과표 배선**이지 사이클 길이가 아니다. 게이지 방식으로 돌리면
   취기 중첩·숙취·쿨감 횟수가 전부 만충 기준값(추정치)에 매달리게 되어, 그 값을
   조금만 손봐도 배선과 무관한 테스트가 우수수 깨진다. 그래서 여기만 20초로 고정하고,
   게이지 자체는 바로 아래 절에서 따로 본다. */
const run = simulate({
  squad: built,
  rotation: [{ step1: 'c017', step2: 'c330', step3: 'c016' },
             { step1: 'c017', step2: 'c330', step3: 'c515' }],
  enemy: { def: 30000, coreHitRate: 0.5 },
  battle: { seconds: 180, burstMode: 'fixed', cycle: 20, sample: 1 },
});
const kinds = k => run.log.filter(l => l.kind === k);

ok('순서 무늬가 되풀이된다 — 쿨타임 경고 0', run.warnings.length === 0,
   run.warnings.join(' / ') || '경고 없음');
eq('180초에 풀버스트 9번', kinds('fbStart').length, 9);

/* 마스트 : 취기가 1단계 진입마다 쌓여 3에서 숙취(기절 10초)로 털린다. */
const drunk = kinds('stack').filter(l => l.name === '취기');
eq('취기가 1 -> 2 -> 3 으로 쌓인다', drunk.slice(0, 3).map(l => l.count).join(''), 123,
   0);
eq('최대에서 털려 0', drunk[3].count, 0);
eq('숙취 기절 3번', kinds('stun').length, 3);
eq('기절은 10초', kinds('stun')[0].until - kinds('stun')[0].t, 10);
const mast = run.byActor.find(a => a.id === 'c354');
const crown = run.byActor.find(a => a.id === 'c330');
ok('기절한 만큼 마스트가 크라운보다 덜 쏜다', mast.shots < crown.shots,
   `${mast.shots}발 vs ${crown.shots}발`);

/* 중첩 비례 버프는 **시전자의 중첩**으로 값이 정해진다. 취기는 마스트에게만 쌓이지만
   그 값을 아군 전체가 받는다. 받는 쪽 중첩을 세면 크라운은 취기가 0 이라 버프가
   통째로 사라진다. */
const reloadBuffs = run.log.filter(l => l.kind === 'buff' && l.stat === 'reloadSpeed'
                                   && String(l.from).startsWith('c354'));
const drunkOn = new Set(kinds('stack').filter(l => l.name === '취기').map(l => l.actor));
ok('취기 중첩은 마스트에게만 쌓인다', drunkOn.size === 1 && drunkOn.has('c354'),
   [...drunkOn].join(' '));
const firstWave = reloadBuffs.filter(l => Math.abs(l.t - reloadBuffs[0].t) < 1e-6);
ok('그 값을 아군 5인 전원이 받는다', new Set(firstWave.map(l => l.actor)).size === 5,
   `${firstWave.length}명`);
ok('크라운도 마스트 중첩 기준 값을 그대로 받는다',
   firstWave.every(l => Math.abs(l.value - firstWave[0].value) < 1e-9)
   && firstWave[0].value > 0,
   `전원 +${round(firstWave[0].value * 100)}%`);
const later = reloadBuffs.find(l => l.value > firstWave[0].value * 1.5);
ok('중첩이 늘면 값도 배로 는다', !!later,
   later ? `${round(firstWave[0].value * 100)}% -> ${round(later.value * 100)}%` : '못 찾음');

/* 크라운 : 평타 43회마다 릴렉스, 20중첩에서 회복 -> 아군 전체 공격 대미지 ▲. */
ok('릴렉스가 쌓인다', kinds('stack').filter(l => l.name === '릴렉스').length > 100);
ok('회복이 아군 버프를 켠다', kinds('heal').length > 0, `${kinds('heal').length}회`);

/* 아니스 : 나만의 별 분기 + 아군 전체 쿨타임 감소. */
ok('아니스는 나만의 별 (이 스쿼드의 유일한 Step1)',
   kinds('state').some(l => l.actor === 'c017' && l.state === '나만의 별' && l.on));
ok('라피는 전투 보조가 아니다 (아니스가 Step1 이므로)',
   !kinds('state').some(l => l.actor === 'c016' && l.state === '전투 보조' && l.on));
/* 아니스의 쿨감은 전투 시작과 풀버스트 종료마다 아군 5인에게 걸린다. 횟수는 곧
   풀버스트가 몇 번 돌았는지라, 사이클이 바뀌면 같이 바뀐다 — 라피 : 레드 후드의
   버스트 원문이 두 갈래인 것을 반영해 그의 자기 쿨감 20초를 전투 보조 갈래 전용으로
   고치면서 사이클이 느려져 10번이 됐다. */
eq('쿨감이 아군 5인 × 10번(시작 + 풀버스트 종료 9번)', kinds('cooldown').length, 50);

/* 라피 : 유탄은 평타와 다른 배수를 받는다. */
const rapi = run.byActor.find(a => a.id === 'c016');
ok('유탄 부착·폭발이 평타와 따로 집계된다',
   rapi.bySource['유탄 부착'] > 0 && rapi.bySource['유탄 폭발'] > 0 && rapi.bySource['평타'] > 0,
   Object.keys(rapi.bySource).join(' · '));
ok('부착이 폭발보다 크다 (부착 배수 150.72% > 폭발 100.6%)',
   rapi.bySource['유탄 부착'] > rapi.bySource['유탄 폭발']);

/* 장탄수: MG 소장품 +9.5% 가 계열 B 로 들어가 300 -> 329. */
eq('MG 장탄 300 + 소장품 9.5% = 329',
   simulate({
     squad: [{ ...built[1], staticAmmo: { B: 0.095 } }],
     rotation: [], enemy: { def: 0 }, battle: { seconds: 30, sample: 30 },
   }).byActor[0].ammo, 329);

head('버스트 순서를 바꾸면 결과가 달라지는가');

const runWith = rotation => simulate({
  squad: built, rotation, enemy: { def: 30000, coreHitRate: 0.5 },
  battle: { seconds: 180, cycle: 20, sample: 60 },
}).total;
const fixed = runWith([{ step1: 'c017', step2: 'c330', step3: 'c016' },
                       { step1: 'c017', step2: 'c330', step3: 'c515' }]);
const swap = runWith([{ step1: 'c017', step2: 'c330', step3: 'c016' },
                      { step1: 'c017', step2: 'c354', step3: 'c515' }]);
/* 쿨타임만 보면 20초짜리 크라운을 매 사이클 쓰는 게 이득 같지만, 마스트를 끼우는
   쪽이 이긴다 — 취기 중첩이 붙은 마스트 버스트가 크리티컬 대미지·공격 대미지에
   시전자 기준 공격력까지 얹기 때문이다. 커뮤니티가 아니스 -> 마스트 -> 3버를
   쓰는 이유와 같다. */
ok('마스트를 끼우는 쪽이 크라운 고정보다 낫다',
   swap > fixed, `마스트 교대 ${(swap / 1e8).toFixed(1)}억 vs 크라운 고정 `
   + `${(fixed / 1e8).toFixed(1)}억 (+${((swap / fixed - 1) * 100).toFixed(1)}%)`);

head('대미지 종류 — 타입 한정 배수와 방어력 무시');

/* 타입 한정 배수는 그 종류의 타격에만 붙는다. 범용 버킷에 넣으면 스쿼드의 모든
   타격이 함께 올라가 실제보다 크게 나온다 (분배 대미지를 '받는 대미지'로 넣었다가
   마스트 우위가 32% -> 16% 로 반토막 난 자리다). */
const typed = (type, buff, def = 0) => simulate({
  squad: [{ ...one('016'),
            effects: { rules: [{ on: ['battleStart'], where: 't', slot: 's1', when: null,
                                 to: 'self', every: 0, count: 0, set: null, clear: null,
                                 stack: null, apply: [],
                                 hit: { ratio: 1, kind: 'skill', times: 1, every: 0, type } }],
                       unmodeled: [], problems: [] },
            staticBuffs: buff ? [buff] : [] }],
  rotation: [], enemy: { def, coreHitRate: 0 }, battle: { seconds: 0.1, sample: 0.1 },
}).total;

const plainHit = typed(null, null);
eq('분배 배수는 분배 타격에만',
   typed('distributedDmg', { stat: 'distributedDmg', value: 0.45 }) / plainHit, 1.45, 1e-9);
eq('분배 배수는 다른 타격에 안 붙는다',
   typed('pierceDmg', { stat: 'distributedDmg', value: 0.45 }) / plainHit, 1, 1e-9);

/* 방어력 무시는 배수만 받는 게 아니라 뺄셈 방어력을 통째로 건너뛴다.
   은화 : 택티컬 업 실측에서 약 4배 차이가 났다는 커뮤니티 보고와 같은 구조다. */
const HIGH = 75000;                       // 공격력 100,000 의 3/4 만큼 높은 방어력
ok('방어력 무시는 적 방어력을 건너뛴다',
   near(typed('trueDmg', null, HIGH) / typed(null, null, HIGH), 4, 0.01),
   `${round(typed('trueDmg', null, HIGH) / typed(null, null, HIGH))}배`);
eq('방어력 무시 배수도 같이 받는다',
   typed('trueDmg', { stat: 'trueDmg', value: 0.4224 }, HIGH) / typed('trueDmg', null, HIGH),
   1.4224, 1e-9);

/* "일반 공격을 방어력 무시 대미지로 적용" (은화 : 택티컬 업) — 평타의 타입을 바꾼다. */
const normalVs = flag => simulate({
  squad: [{ ...one('016'),
            staticBuffs: flag ? [{ stat: 'normalAsTrue', value: 1, source: '카모플라쥬' }] : [] }],
  rotation: [], enemy: { def: HIGH, coreHitRate: 0 }, battle: { seconds: 2, sample: 2 },
}).total;
ok('평타를 방어력 무시로 바꾸면 뺄셈 방어력도 건너뛴다',
   normalVs(true) > normalVs(false) * 3.9,
   `${round(normalVs(true) / normalVs(false))}배`);

/* 레드 후드: 차지 속도 100% 초과분을 차지 대미지로 변환 (초과분의 240%). */
const overflow = (speed, factor) => simulate({
  squad: [{ ...one('017'),
            staticBuffs: [{ stat: 'chargeSpeed', value: speed, source: 't' },
                          { stat: 'chargeOverflow', value: factor, source: 't' }] }],
  rotation: [], enemy: { def: 0, coreHitRate: 0 }, battle: { seconds: 12, sample: 12 },
}).total;
const noOver = (speed) => simulate({
  squad: [{ ...one('017'), staticBuffs: [{ stat: 'chargeSpeed', value: speed, source: 't' }] }],
  rotation: [], enemy: { def: 0, coreHitRate: 0 }, battle: { seconds: 12, sample: 12 },
}).total;
ok('차지 속도 130% 면 초과분 30 × 2.40 = 차지 대미지 +72%',
   near(overflow(1.3, 2.4) / noOver(1.3), 1.72, 0.02),
   `${round(overflow(1.3, 2.4) / noOver(1.3))}배`);
ok('100% 이하면 변환할 초과분이 없다',
   near(overflow(0.9, 2.4) / noOver(0.9), 1, 1e-9));

/* 자칼: "'~ 적 1기에게'로 끝나는 버스트 스킬 대미지 ▲" — 헬름·신데렐라 : 크리스탈
   웨이브처럼 단일 대상 버스트에만. 한 타격이 두 타입을 함께 단다. */
const cw = compile(effects('515'), combat('515'));
const cwBurst = cw.rules.find(r => r.hit && r.hit.kind === 'burst');
ok('신데렐라 : CW 버스트는 버스트 스킬 + 단일 대상 두 타입',
   cwBurst.hit.type.includes('burstSkillDmg') && cwBurst.hit.type.includes('singleBurstDmg'),
   JSON.stringify(cwBurst.hit.type));

/* 코어 대미지는 타입 배수가 아니라 무기의 "코어 대미지 200%" 에 합연산이다. */
ok('코어 대미지는 타입 목록에 없다', !TYPE_DMG.has('coreDmg'));
eq('무기 200% + 소장품 17.04% = 코어 항 1.1704',
   bonusLayer({ critRate: -RULE.CRIT_RATE, coreDmg: 0.1704 }, KIND.NORMAL,
              { coreHitRate: 1, coreDamage: 200 }) - 1, 1.1704, 1e-9);

head('자리는 자유롭지만 단계는 못 속인다');

/* 어느 니케든 어느 슬롯에 들어간다. 제약은 1·2·3단계가 하나씩 갖춰져야 풀버스트가
   돈다는 것뿐이다. 그래서 엔진은 "이 니케가 그 단계를 낼 수 있는가" 만 본다. */
const wrongStep = simulate({
  squad: built,
  rotation: [{ step1: 'c330', step2: 'c017', step3: 'c016' }],   // 크라운은 2버, 아니스는 1버
  enemy: { def: 30000, coreHitRate: 0.5 },
  battle: { seconds: 40, cycle: 20, sample: 40 },
});
ok('2버를 1버 자리에 넣으면 경고하고 안 쓴다',
   wrongStep.warnings.some(w => w.includes('실제 단계')),
   wrongStep.warnings.filter(w => w.includes('실제 단계'))[0] || '경고 없음');
ok('그러면 풀버스트가 안 열린다',
   wrongStep.log.filter(l => l.kind === 'fbStart').length === 0);

/* 단계를 바꾸는 스킬은 통과시켜야 한다 — 아니스가 유일한 Step1 이 아니게 되면
   라피 : 레드 후드가 전투 보조로 1단계에 선다. */
const onlyRapi = simulate({
  squad: built.filter(a => a.id !== 'c017'),
  rotation: [{ step1: 'c016', step2: 'c330', step3: 'c515' }],
  enemy: { def: 30000, coreHitRate: 0.5 },
  battle: { seconds: 40, cycle: 20, sample: 40 },
});
ok('Step1 이 없으면 라피가 전투 보조로 1버를 맡는다',
   onlyRapi.log.some(l => l.kind === 'state' && l.actor === 'c016' && l.state === '전투 보조')
   && onlyRapi.log.filter(l => l.kind === 'fbStart').length > 0,
   `풀버스트 ${onlyRapi.log.filter(l => l.kind === 'fbStart').length}회`);

/* ══ 버스트 게이지 ═════════════════════════════════════════ */

head('사이클은 입력이 아니라 결과다');

const ROT = [{ step1: 'c017', step2: 'c330', step3: 'c016' },
             { step1: 'c017', step2: 'c330', step3: 'c515' }];
/* 게이지 충전 속도 버프를 세팅으로 얹어 아니스 : 스타의 1스킬을 흉내 낸다.
   효과표를 거치지 않고 버킷만 건드리므로, 보고 있는 것이 게이지 장치 하나로 좁혀진다. */
const gaugeRun = (speed = 0, seconds = 180) => simulate({
  squad: built.map(a => (speed
    ? { ...a, staticBuffs: [{ stat: 'burstGaugeSpeed', value: speed, source: '시험' }] } : a)),
  rotation: ROT, enemy: { def: 30000, coreHitRate: 0.5 },
  battle: { seconds, sample: 1 },
});

const g0 = gaugeRun();
ok('전투 시작 게이지는 0 — 첫 풀버스트가 0초에 안 열린다',
   g0.log.find(l => l.kind === 'fbStart').t > 3,
   `첫 풀버스트 ${round(g0.log.find(l => l.kind === 'fbStart').t)}초`);
ok('만충까지 걸린 시간이 보고된다', g0.burst.avgFill > 0,
   `평균 ${round(g0.burst.avgFill)}초 · 사이클 ${round(g0.burst.avgCycle)}초`);
ok('아무도 쿨타임에 걸려 헛돌지 않는다 — 셋 다 풀릴 때까지 기다린다',
   !g0.warnings.some(w => w.includes('쿨타임')), g0.warnings.join(' / ') || '경고 없음');

/* 바닥이 둘이라 어느 쪽이 붙잡고 있는지가 스쿼드마다 다르다. 게이지를 넘치게
   부으면 버스트 쿨타임이 바닥으로 드러나고, 거기서 더 부어도 사이클이 안 줄어든다.
   이 판정이 곧 "아니스 : 스타를 쓸 자리인가" 라서 엔진이 직접 말해 준다. */
const fast = gaugeRun(5), faster = gaugeRun(20);
ok('게이지를 넘치게 부으면 쿨타임이 바닥으로 드러난다', fast.burst.bound === 'cooldown',
   `${fast.burst.bound} · 사이클 ${round(fast.burst.avgCycle)}초 · `
   + `만충 뒤 평균 ${round(fast.burst.avgWait)}초 대기`);
/* 여기도 횟수가 아니라 사이클로 본다. 바닥에 붙은 뒤에는 길이가 같은데, 전투가
   끝나는 자리가 어디 걸리느냐로 마지막 한 바퀴가 들어갔다 말았다 한다. */
eq('그 바닥 아래로는 아무리 부어도 안 내려간다',
   faster.burst.avgCycle, fast.burst.avgCycle, 0.05);
/* 사이클 길이로 본다. 풀버스트 **횟수**로 보면 차이가 한 바퀴에 못 미칠 때
   0 으로 반올림돼 통과해 버린다 — 실제로 이 스쿼드가 그렇다 (13.2초 vs 12.7초). */
ok('기본 스쿼드는 아직 게이지 쪽이 붙잡고 있다',
   g0.burst.bound === 'gauge' && g0.burst.avgCycle > fast.burst.avgCycle + 0.2,
   `${g0.burst.bound} · 사이클 ${round(g0.burst.avgCycle)}초 `
   + `(게이지를 부으면 ${round(fast.burst.avgCycle)}초)`);

/* 게이지가 느린 스쿼드를 만들려면 수급을 깎으면 된다. 아니스(RL) 혼자 3버 자리를
   빼고 세우는 것보다, 같은 스쿼드에서 수급량만 낮추는 편이 다른 변수가 안 섞인다. */
const slowSquad = built.map(a => ({
  ...a,
  combat: { ...a.combat,
            shot: { ...a.combat.shot,
                    burstEnergy: { perShot: a.combat.shot.burstEnergy.perShot / 8 } } },
}));
const slow = speed => simulate({
  squad: speed ? slowSquad.map(a => ({ ...a,
    staticBuffs: [{ stat: 'burstGaugeSpeed', value: speed, source: '시험' }] })) : slowSquad,
  rotation: ROT, enemy: { def: 30000, coreHitRate: 0.5 },
  battle: { seconds: 180, sample: 180 },
});
const s0 = slow(0), s1 = slow(1);
ok('수급이 느리면 이번엔 게이지가 붙잡는다', s0.burst.bound === 'gauge',
   `${s0.burst.bound} · 사이클 ${round(s0.burst.avgCycle)}초`);
ok('그 스쿼드에서는 충전 속도 +100% 가 풀버스트 횟수를 늘린다',
   s1.burst.count > s0.burst.count,
   `${s0.burst.count}회 -> ${s1.burst.count}회`);
ok('그리고 누적 대미지도 는다 — 고정 사이클이면 0 이 나올 차이다',
   s1.total > s0.total, `+${round((s1.total / s0.total - 1) * 100)}%`);

head('게이지 충전 효과 — 만충 대비 퍼센트, 스쿼드가 하나를 공유');

/* "[버스트 게이지 충전 25%]" 를 아군 전체에게 거는 규칙. 게이지는 스쿼드가 한 줄을
   쓰므로 대상이 다섯이어도 한 번만 차야 한다. 대상마다 걸면 5배가 되어 그 니케
   하나로 사이클이 반토막 나 버린다. */
const charger = (pct, to) => ({
  ...built[1],
  effects: { rules: [{ on: ['battleStart'], where: '충전', slot: 's1', when: null, to,
                       every: 0, count: 0, set: null, clear: null, stack: null,
                       apply: [{ stat: 'burstGauge', value: pct, instant: true }],
                       hit: null, weapon: null }],
             unmodeled: [], problems: [] },
});
const gaugeAfter = rule => simulate({
  squad: [rule], rotation: [], enemy: { def: 0, coreHitRate: 0 },
  battle: { seconds: 0.05, sample: 0.05 },
}).series[0].gauge;
eq('충전 25% = 만충의 25%', gaugeAfter(charger(25, 'self')), 0.25, 1e-9);
eq('아군 전체에게 걸어도 한 번만 찬다', gaugeAfter(charger(25, 'allies')), 0.25, 1e-9);

/* 풀버스트 중에는 게이지가 안 돈다 — Ⅰ 을 누르는 순간 소비되고 풀버스트가 끝나야
   0 에서 다시 찬다. 이게 없으면 풀버스트 10초 동안의 사격이 다음 게이지에 얹혀
   사이클이 실제보다 짧아진다. */
const during = g0.series.filter(s => s.fullBurst).map(s => s.gauge);
ok('풀버스트 중 게이지는 만충으로 멈춰 있거나 0 이다',
   during.every(v => v === 0 || v === 1), `표본 ${during.length}개`);

head('아군이 소비한 탄의 총합 — 스쿼드가 함께 세는 카운터');

/* 신데렐라 : 크리스탈 웨이브의 1스킬이 이 카운터로 버스트 게이지를 채운다. 자기
   사격만 세는 `shots` 와 달라서, MG 아군이 옆에 있으면 훨씬 빨리 돈다. */
const squadCounter = mates => simulate({
  squad: [{ ...built[1],
            effects: { rules: [{ on: ['squadShots'], where: '탄합계', slot: 's1', when: null,
                                 to: 'self', every: 0, count: 200, set: null, clear: null,
                                 stack: null,
                                 apply: [{ stat: 'burstGauge', value: 1, instant: true }],
                                 hit: null, weapon: null }],
                       unmodeled: [], problems: [] } },
           ...mates],
  rotation: [], enemy: { def: 0, coreHitRate: 0 }, battle: { seconds: 20, sample: 20 },
}).log.filter(l => l.kind === 'gauge').length;
const alone = squadCounter([]);
const withMates = squadCounter([built[3], built[4]]);
ok('아군이 늘면 같은 20초에 더 자주 터진다', withMates > alone * 2,
   `혼자 ${alone}회 -> 셋이서 ${withMates}회`);

head('단계별 누적 효과 — "[N회 별 효과] [하위 효과 중복 적용]"');

/* 리타의 1스킬이 이 꼴이다. 갈래를 규칙 세 줄로 펴고 `nth` 를 1·2·3 으로 두면
   3회째에 셋이 다 걸려 "중복 적용" 이 저절로 나온다. 이걸 못 읽으면 리타가 쓰이는
   이유(버스트 쿨감)가 통째로 사라지고 그냥 약한 서포터가 된다. */
const rita = compile(effects('082'), combat('082'));
ok('리타 효과표에 모르는 이름이 없다', rita.problems.length === 0,
   rita.problems.join(' / ') || `규칙 ${rita.rules.length}개`);

const ritaCd = rita.rules.filter(r => r.apply.some(a => a.stat === 'burstCooldown'));
eq('쿨감 갈래가 셋', ritaCd.length, 3);
eq('nth 가 1·2·3', ritaCd.map(r => r.nth).join(''), 123, 0);
eq('1회째 2.34초', Math.abs(ritaCd[0].apply[0].value), 2.34);
eq('셋이 겹치면 8.21초',
   ritaCd.reduce((s, r) => s + Math.abs(r.apply[0].value), 0), 8.21, 1e-9);

const mkActor = rid => {
  const c = combat(rid);
  return { id: `c${rid}`, combat: c, effects: compile(effects(rid), c),
           stats: { atk: 167632, def: 30000, hp: 1500000 }, isElement: true };
};
const ritaSquad = [mkActor('082'), ...built.slice(1)];
const ritaRun = (gaugeMax = 7500) => simulate({
  squad: ritaSquad,
  rotation: [{ step1: 'c082', step2: 'c354', step3: 'c016' },
             { step1: 'c082', step2: 'c330', step3: 'c515' }],
  enemy: { def: 30000, coreHitRate: 0.5 },
  battle: { seconds: 120, sample: 120, gaugeMax },
});
const rr = ritaRun();

/* 풀버스트 시작마다 몇 줄이 걸리는지 세면 누적이 눈에 보인다 — 아군 5인이므로
   1회째 5건(갈래 하나), 2회째 10건(둘), 3회째부터 15건(셋). */
const fbAt = rr.log.filter(l => l.kind === 'fbStart').map(l => l.t);
const cdCount = at => rr.log.filter(l => l.kind === 'cooldown' && Math.abs(l.t - at) < 1e-6).length;
eq('풀버스트 1회째 쿨감 5인 × 갈래 1', cdCount(fbAt[0]), 5);
eq('2회째는 갈래 둘이 겹쳐 10건', cdCount(fbAt[1]), 10);
eq('3회째부터 셋이 겹쳐 15건', cdCount(fbAt[2]), 15);
eq('그 뒤로도 15건에서 굳는다', cdCount(fbAt[3]), 15);

/* 게이지를 사실상 없애면 쿨타임 바닥만 남는다. 리타는 램프가 있어 처음 두 바퀴가
   길고, 3회째부터 20 − 8.21 = 11.79초 + 반응 시간에 눌러앉는다. */
const floorGaps = (() => {
  const t = ritaRun(100).log.filter(l => l.kind === 'fbStart').map(l => l.t);
  return t.slice(1).map((x, i) => x - t[i]);
})();
ok('첫 바퀴가 가장 길고 갈수록 짧아진다',
   floorGaps[0] > floorGaps[1] && floorGaps[1] > floorGaps[2],
   floorGaps.slice(0, 4).map(g => round(g)).join(' -> '));
eq('3회째부터 쿨타임 바닥에 눌러앉는다', floorGaps[3], floorGaps[2], 0.05);
ok('그 바닥이 20초 − 8.21초 근처다',
   Math.abs(floorGaps[3] - (20 - 8.21)) < 0.5, `${round(floorGaps[3])}초`);

head('스킬 타격도 게이지를 번다 — 슈팅 스타');

/* 아니스 : 스타의 슈팅 스타는 Ⅰ 을 쓴 직후 켜져 10초를 간다. 풀버스트도 10초라
   보통 조합에서는 별이 꺼진 뒤에 풀버스트가 끝나고, 게이지는 그동안 잠겨 있으므로
   별이 번 것이 통째로 사라진다. 이사벨은 3단계인데 **풀버스트가 5초**라, 잠금이
   풀릴 때 별사탕이 4~5초 남아 있다. 같은 스쿼드 안에서 이사벨(5초)과
   신데렐라(10초)를 번갈아 쓰면 바깥 조건을 하나도 안 바꾸고 그 차이만 볼 수 있다. */
const zap = ['017', '581', '330', '231', '511'].map(mkActor);
eq('이사벨의 풀버스트는 5초', zap[3].combat.burstDuration, 5);
eq('신데렐라의 풀버스트는 10초', zap[4].combat.burstDuration, 10);

const zapRun = simulate({
  squad: zap,
  rotation: [{ step1: 'c017', step2: 'c581', step3: 'c231' },
             { step1: 'c017', step2: 'c330', step3: 'c511' }],
  enemy: { def: 0, coreHitRate: 0.5 },
  battle: { seconds: 180, sample: 180 },
});
/* 잠금이 풀린 시각(직전 풀버스트 종료)부터 만충까지. 그 구간에 별사탕이 살아
   있느냐가 두 부류의 유일한 차이다. */
const after = { 5: [], 10: [] };
const CY = zapRun.burst.cycles;
for (let i = 1; i < CY.length; i++) {
  if (CY[i].fullAt == null || CY[i - 1].fbEnd == null) continue;
  after[CY[i - 1].index % 2 === 0 ? 5 : 10].push(CY[i].fullAt - CY[i - 1].fbEnd);
}
const avg = v => v.reduce((a, b) => a + b, 0) / v.length;
ok('5초 풀버스트(이사벨) 뒤가 10초(신데렐라) 뒤보다 게이지가 빨리 찬다',
   avg(after[5]) < avg(after[10]) * 0.8,
   `${round(avg(after[5]))}초 vs ${round(avg(after[10]))}초 — `
   + `${round(avg(after[10]) / avg(after[5]))}배`);

/* 슈팅 스타를 빼면 그 차이가 사라져야 한다. 남아 있다면 별이 아니라 다른 것이
   만든 차이라는 뜻이고, 그러면 이 검증 자체가 헛것이다. */
const noStar = zap.map(a => (a.id !== 'c017' ? a : {
  ...a,
  effects: { ...a.effects,
             rules: a.effects.rules.filter(r => !(r.hit && r.hit.times > 10)) },
}));
const nsRun = simulate({
  squad: noStar,
  rotation: [{ step1: 'c017', step2: 'c581', step3: 'c231' },
             { step1: 'c017', step2: 'c330', step3: 'c511' }],
  enemy: { def: 0, coreHitRate: 0.5 },
  battle: { seconds: 180, sample: 180 },
});
const nsAfter = { 5: [], 10: [] };
const NCY = nsRun.burst.cycles;
for (let i = 1; i < NCY.length; i++) {
  if (NCY[i].fullAt == null || NCY[i - 1].fbEnd == null) continue;
  nsAfter[NCY[i - 1].index % 2 === 0 ? 5 : 10].push(NCY[i].fullAt - NCY[i - 1].fbEnd);
}
ok('슈팅 스타를 빼면 그 차이가 크게 줄어든다',
   avg(nsAfter[10]) / avg(nsAfter[5]) < avg(after[10]) / avg(after[5]),
   `별 있음 ${round(avg(after[10]) / avg(after[5]))}배 -> `
   + `별 없음 ${round(avg(nsAfter[10]) / avg(nsAfter[5]))}배`);

head('시전자 기준 공격력이 되먹임을 만들지 않는가');

/* 크라운이 자기 공격력의 N% 를 아군에게 주고, 아니스도 같은 것을 준다. 그 바탕을
   **최종** 공격력으로 잡으면 서로가 서로를 키운다 — 크라운의 최종 공격력에 아니스가
   준 가산이 들어 있고, 다음 사이클에 아니스가 그 부푼 크라운 몫까지 얹어 다시 준다.
   실제로 164초에 공격력이 63배까지 갔고 누적 대미지가 7배 부풀어 있었다.

   그래서 시전자 기준 값의 바탕은 **남에게 받은 고정 가산을 뺀** 공격력이다. */
const swellRun = simulate({
  squad: built,
  rotation: [{ step1: 'c017', step2: 'c330', step3: 'c016' },
             { step1: 'c017', step2: 'c354', step3: 'c515' }],
  enemy: { def: 30000, coreHitRate: 0.5 },
  battle: { seconds: 180, sample: 0.5, snapshot: true },
});
const swellOf = s => Math.max(...s.actors.map(a => a.atk / a.atkBase));
const peak = Math.max(...swellRun.snapshots.map(swellOf));
ok('어느 순간에도 공격력이 기본의 10배를 안 넘는다', peak < 10, `최고 ×${round(peak)}`);

/* 되먹임의 표식은 크기가 아니라 **자라는 모양**이다. 전반 60초의 최고와 후반 60초의
   최고가 비슷해야 한다 — 뒤로 갈수록 커지면 고리가 살아 있다는 뜻이다. */
const half = t => Math.max(...swellRun.snapshots.filter(s => (t === 0 ? s.t < 60 : s.t > 120))
  .map(swellOf));
ok('전반과 후반의 최고 배율이 비슷하다 — 사이클마다 자라지 않는다',
   half(1) < half(0) * 1.15, `전반 ×${round(half(0))} vs 후반 ×${round(half(1))}`);

/* 스냅샷이 실제로 쓸모 있는 모양인지도 같이 본다 — 버프마다 출처가 붙어 있어야
   "어느 스킬이 범인인가" 를 화면에서 답할 수 있다. */
const withBuffs = swellRun.snapshots.find(s => s.actors.some(a => a.buffs.length > 3));
ok('스냅샷에 버프가 출처와 함께 남는다',
   !!withBuffs && withBuffs.actors.every(a => a.buffs.every(b => b.stat && b.source)),
   `${withBuffs ? withBuffs.actors.reduce((n2, a) => n2 + a.buffs.length, 0) : 0}줄`);

head('호감도 상한 — 돌파와 소속이 같이 정한다');

/* 0돌 10 · 1돌 20 · 2돌 30 · 3돌 40, 그리고 소속 상한(필그림/오버스펙 40, 그 외 30).
   기본 세팅이 0돌이므로 호감도 40 은 애초에 만들 수 없는 값이다. */
eq('0돌 = 10', bondCap('0돌', 'ELYSION'), 10);
eq('1돌 = 20', bondCap('1돌', 'ELYSION'), 20);
eq('2돌 = 30', bondCap('2돌', 'ELYSION'), 30);
eq('3돌 일반 소속은 30 에서 막힌다', bondCap('3돌', 'ELYSION'), 30);
eq('3돌 필그림은 40', bondCap('3돌', 'PILGRIM'), 40);
eq('오버스펙도 40', bondCap('3돌', 'ABNORMAL', 'OVERSPEC'), 40);
eq('코강은 3돌 뒤라 같은 상한', bondCap('3코강', 'PILGRIM'), 40);
eq('기본 세팅(0돌)의 호감도는 10',
   defaultInput({ rarity: 'SSR', class: 'Attacker', corporation: 'ELYSION' }).bond, 10);

console.log(`\n${'═'.repeat(62)}`);
console.log(`  PASS ${pass} · FAIL ${fail}`);
process.exit(fail ? 1 : 0);
