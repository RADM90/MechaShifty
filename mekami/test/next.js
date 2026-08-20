/* 2세대 엔진 검증 — `node mekami/test/next.js`.

   메커니즘이 하나 들어올 때마다 그것을 못박는 검사도 같이 는다. 1세대 테스트
   (`run.js`)는 그대로 두고 여기는 따로 쌓는다 — 두 엔진이 같은 답을 내야 하는지
   아닌지가 메커니즘마다 다르기 때문이다. */

import { Queue, simulate, canDo, rng, Sim, STEPS, HIT } from '../assets/engine.next.js';
import { LEDGER, OPEN } from '../assets/ledger.next.js';
import { 대미지, 기댓값, 적용, 적정거리, 종류, BASE, 차지계수 } from '../assets/formula.next.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  PASS  ${name}${detail ? '  :: ' + detail : ''}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? '  :: ' + detail : ''}`); }
};
const eq = (name, got, want) => ok(name, got === want, `${got} (기대 ${want})`);
const head = t => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 56 - t.length))}`);

/* ══ 시간 굴리기 ═══════════════════════════════════════════ */

head('이벤트 큐 — 이른 것부터, 같은 시각이면 넣은 순서대로');

const q = new Queue();
for (const [t, tag] of [[3, 'c'], [1, 'a'], [2, 'b'], [1, 'a2'], [5, 'e'], [1, 'a3']]) {
  q.push(t, { kind: 'x', tag });
}
const order = [];
for (;;) { const ev = q.pop(); if (!ev) break; order.push(ev.tag); }
eq('이른 시각부터 나온다', order.join(''), 'aa2a3bce');
eq('다 꺼내면 빈다', q.size, 0);
ok('빈 큐는 null 을 준다', new Queue().pop() === null);

/* 힙이 실제로 정렬을 지키는지는 무작위로 두들겨야 드러난다 — 손으로 고른 몇 개는
   운 좋게 통과할 수 있다. */
const rq = new Queue();
const times = [];
for (let i = 0; i < 2000; i++) {
  const t = Math.round(Math.random() * 1000) / 10;
  times.push(t);
  rq.push(t, { kind: 'x' });
}
times.sort((a, b) => a - b);
let sorted = true, i = 0;
for (;;) { const ev = rq.pop(); if (!ev) break; if (ev.t !== times[i++]) { sorted = false; break; } }
ok('무작위 2000개도 순서를 지킨다', sorted && i === times.length, `${i}개`);

/* ══ 메커니즘 1·3 — 체인 ═══════════════════════════════════ */

const N = (id, burst, extra = {}) => ({ id, name: id, burst, burstEnergy: 100,
                                        burstCooldown: 20, ...extra });
/* 풀버스트 길이는 Ⅲ 을 쓴 니케가 정한다 (5 / 10 / 15초). */
const FIVE = { burstDuration: 5 }, TEN = { burstDuration: 10 }, FIFTEEN = { burstDuration: 15 };

/* 게이지를 채우는 방법이 명중뿐이라, 체인을 시험하려면 그 시각에 만충시키면 된다.
   만충 1000 에 발당 100 이면 열 발이다. */
const MAX = 1000;
const fill = (t, id = 'i', bullets = 10) => ({ t, id, bullets });
/* 체인 **논리**를 보는 절에서는 조작·연출 지연을 0 으로 둔다. 그 지연은 실측값이라
   따로(메커니즘 16) 잠그고, 여기서는 "누가 언제 어떤 순서로 나가는가" 만 본다.
   섞어 두면 상수를 한 번 고칠 때마다 상관없는 기대값이 우수수 깨진다. */
const go = (squad, hits, battle = {}) =>
  simulate({ squad, scaffold: { hits },
             battle: { seconds: 60, gaugeMax: MAX,
                       pressDelay: 0, cutIn: 0, fbDelay: 0, ...battle } });

const squad5 = [N('i', 'Step1'), N('ii', 'Step2'), N('iii', 'Step3', TEN),
                N('x', 'Step2'), N('y', 'Step3', FIVE)];

head('메커니즘 1·3 — 만충 -> 버튼 -> Ⅰ·Ⅱ·Ⅲ -> 풀버스트');

const r1 = go(squad5, [fill(5)]);
const steps = r1.log.filter(l => l.kind === 'burst').map(l => l.step);
eq('Ⅰ→Ⅱ→Ⅲ 순서로 나간다', steps.join('>'), 'Step1>Step2>Step3');
eq('만충되기 전에는 안 눌린다', r1.log.find(l => l.kind === 'chainStart').t, 5);
eq('풀버스트가 한 번 열린다', r1.fullBurst.count, 1);
eq('길이는 Ⅲ 을 쓴 니케 것', r1.fullBurst.windows[0].to - r1.fullBurst.windows[0].from, 10);
eq('한 바퀴에 세 명만 쓴다', r1.log.filter(l => l.kind === 'burst').length, 3);
ok('경고 없음', r1.warnings.length === 0, r1.warnings.join(' / ') || '없음');

/* **게이지는 Ⅰ 을 누를 때 소비된다.** 체인이 무효화돼도 0 부터 다시라는 말이 그 뜻이다. */
eq('Ⅰ 을 누르면 게이지가 0 이 된다', r1.gauge.at, 0);

head('메커니즘 3 — 체인 창 10초, 못 채우면 무효');

/* Ⅱ 가 한 명뿐인데 쿨타임이 40초라, 두 번째 체인(20초)에서는 창(10초)이 닫힐
   때까지 못 누른다. Ⅰ·Ⅲ 은 쿨이 짧아 준비돼 있다 — 막히는 것이 Ⅱ 하나뿐인
   상황을 일부러 만든다. */
const oneTwo = [N('i', 'Step1', { burstCooldown: 1 }), N('ii', 'Step2', { burstCooldown: 40 }),
                N('iii', 'Step3', { ...TEN, burstCooldown: 1 }),
                N('a', 'Step1'), N('b', 'Step3', TEN)];
const voidRun = go(oneTwo, [fill(1), fill(20)]);
eq('체인은 두 번 시작했다', voidRun.chains.started, 2);
eq('그중 하나는 무효', voidRun.chains.voided.length, 1);
eq('무효가 된 것은 Ⅱ·Ⅲ 을 못 눌러서', voidRun.chains.voided[0].missing.join('·'), 'Step2·Step3');
eq('무효는 Ⅰ 을 누른 지 10초 뒤',
   voidRun.chains.voided[0].at - voidRun.log.filter(l => l.kind === 'chainStart')[1].t, 10);
eq('풀버스트는 한 번만', voidRun.fullBurst.count, 1);
ok('무효를 경고로 말한다', voidRun.warnings.some(w => w.includes('무효')),
   voidRun.warnings.find(w => w.includes('무효')) || '없음');

/* 무효가 돼도 Ⅰ 니케는 스킬을 썼으므로 쿨타임이 돈다 — 실패한 체인의 대가. */
const firstUse = voidRun.log.filter(l => l.kind === 'burst' && l.step === 'Step1');
eq('무효 체인의 Ⅰ 도 쿨타임이 돈다', firstUse.length, 2);
ok('쿨타임이 쓰는 즉시 시작한다',
   firstUse.every(l => Math.abs(l.readyAt - l.t - 1) < 1e-9),
   firstUse.map(l => `${l.t}→${l.readyAt}`).join(' · '));

head('메커니즘 3 — 쿨타임이 풀리면 그 안에서는 기다렸다 누른다');

/* Ⅱ 의 쿨타임이 12초. 두 번째 체인이 11초에 열리면 창은 21초까지라, 12초에
   풀리는 Ⅱ 를 기다렸다 누른다 — 무효가 아니다. 창보다 늦게 풀릴 때만 무효다. */
const waits = [N('i', 'Step1'), N('ii', 'Step2', { burstCooldown: 12 }),
               N('iii', 'Step3', TEN), N('a', 'Step1'), N('b', 'Step3', TEN)];
const waitRun = go(waits, [fill(0), fill(11)]);
eq('두 번째 체인도 완성된다', waitRun.chains.voided.length, 0);
const second = waitRun.log.filter(l => l.kind === 'burst' && l.step === 'Step2')[1];
eq('Ⅱ 는 쿨타임이 풀리는 그 시각에 눌린다', second.t, 12);
eq('Ⅰ 은 게이지가 다시 찬 11초에 눌렸다',
   waitRun.log.filter(l => l.kind === 'burst' && l.step === 'Step1')[1].t, 11);

head('메커니즘 6 — 체인·풀버스트 중에는 게이지가 안 찬다');

/* 풀버스트(0~10초) 안에서 아무리 때려도 게이지는 안 찬다. 그 명중은 버려진다. */
const locked = go(squad5, [fill(0), { t: 3, id: 'i', bullets: 50 },
                                     { t: 7, id: 'ii', bullets: 50 }]);
eq('풀버스트 중 명중은 버려진다', locked.wastedHits, 2);
eq('그래서 두 번째 체인은 안 열린다', locked.chains.started, 1);
eq('풀버스트가 끝난 시점의 게이지는 0', locked.gauge.at, 0);
ok('풀버스트 종료에 게이지를 0 으로 놓는다',
   locked.log.some(l => l.kind === 'gaugeReset' && l.t === 10));

/* 무효가 된 체인은 쿨타임뿐 아니라 **창 10초어치의 충전까지** 날린다. */
const voidWaste = go(oneTwo, [fill(1), fill(20), { t: 25, id: 'i', bullets: 50 }]);
ok('무효를 기다리는 동안의 명중도 버려진다', voidWaste.wastedHits >= 1,
   `버려진 명중 ${voidWaste.wastedHits}회`);

head('메커니즘 6 — 같은 단계가 둘이면 왼쪽 칸이 먼저');

/* squad5 는 Ⅱ 가 ii·x, Ⅲ 이 iii·y 다. 자동 전투는 왼쪽을 먼저 쓴다. */
const leftFirst = go(squad5, [fill(0)]);
const used = leftFirst.log.filter(l => l.kind === 'burst');
eq('Ⅱ 는 왼쪽의 ii', used.find(l => l.step === 'Step2').actor, 'ii');
eq('Ⅲ 은 왼쪽의 iii', used.find(l => l.step === 'Step3').actor, 'iii');
/* 자리를 바꾸면 결과도 바뀐다 — 순서가 곧 우선순위라는 뜻이다. */
const swapped = go([squad5[0], squad5[3], squad5[4], squad5[1], squad5[2]], [fill(0)]);
const su = swapped.log.filter(l => l.kind === 'burst');
eq('앞으로 옮기면 그쪽이 먼저 쓰인다', su.find(l => l.step === 'Step2').actor, 'x');
eq('Ⅲ 도 마찬가지', su.find(l => l.step === 'Step3').actor, 'y');
eq('그러면 풀버스트 길이도 달라진다 (y 는 5초)', swapped.fullBurst.uptime, 5);

head('메커니즘 1 — 편성이 모자라면 아예 안 돈다');

const noThree = go([N('i', 'Step1'), N('ii', 'Step2'), N('x', 'Step2'),
                    N('y', 'Step1'), N('z', 'Step2')], [fill(1)]);
eq('Ⅲ 이 없으면 풀버스트 0회', noThree.fullBurst.count, 0);
ok('무엇이 없는지 말한다', noThree.warnings.some(w => w.includes('Step3')),
   noThree.warnings[0] || '경고 없음');
/* 편성 문제는 전투 시작에 한 번만 말한다 — 체인마다 말하면 같은 소리가 쌓인다. */
eq('같은 소리를 되풀이하지 않는다',
   noThree.warnings.filter(w => w.includes('없어 풀버스트가')).length, 1);

/* `AllStep` 은 어느 자리든 메운다. 로스터에 레드 후드 한 명뿐이라 필터가 조용히
   떨어뜨리기 쉬운 자리다. */
const allStep = go([N('rh', 'AllStep', TEN), N('ii', 'Step2'), N('iii', 'Step3', TEN),
                    N('a', 'Step2'), N('b', 'Step2')], [fill(1, 'rh')]);
eq('AllStep 이 빈 Ⅰ 자리를 메운다', allStep.fullBurst.count, 1);
ok('AllStep 은 어느 단계든 된다', STEPS.every(s => canDo({ burst: 'AllStep' }, s)));
ok('Step1 은 Step2 를 못 낸다', !canDo({ burst: 'Step1' }, 'Step2'));

/* 길이를 모르면 지어내지 않는다. 기본값 10초를 몰래 끼우면 15초짜리 니케의
   결과가 조용히 틀린다. */
const noDur = go([N('i', 'Step1'), N('ii', 'Step2'), N('iii', 'Step3'),
                  N('a', 'Step2'), N('b', 'Step2')], [fill(1)]);
eq('풀버스트 길이를 모르면 안 연다', noDur.fullBurst.count, 0);
ok('그 사실을 말한다', noDur.warnings.some(w => w.includes('burstDuration')));

head('메커니즘 1 — 여러 바퀴와 전투 끝');

const three = go(squad5, [fill(0), fill(20), fill(40)]);
eq('세 바퀴면 풀버스트도 세 번', three.fullBurst.count, 3);
eq('풀버스트에 머문 시간 30초', three.fullBurst.uptime, 30);

/* 전투가 풀버스트 중에 끝나면 그 구간은 끝에서 잘린다. 안 자르면 60초 전투에서
   풀버스트가 65초 돈 것으로 나온다. */
const cut = go(squad5, [fill(55)], { seconds: 60 });
eq('끝에 걸친 창은 전투 시간에서 잘린다', cut.fullBurst.uptime, 5);
eq('그래도 한 번은 열렸다', cut.fullBurst.count, 1);

const long = go([N('i', 'Step1'), N('ii', 'Step2'), N('iii', 'Step3', FIFTEEN),
                 N('a', 'Step2'), N('b', 'Step2')], [fill(1)]);
eq('15초짜리 3버는 15초', long.fullBurst.uptime, 15);

/* ══ 메커니즘 2·4 — 게이지 ════════════════════════════════ */

head('메커니즘 2 — 명중할 때마다 그 니케 수치만큼 찬다');

const E = (id, burst, energy, extra = {}) => N(id, burst, { burstEnergy: energy, ...extra });
const gsquad = [E('rl', 'Step1', 280), E('mg', 'Step2', 10), E('sr', 'Step3', 550, TEN),
                E('smg', 'Step2', 20), E('sg', 'Step3', 40, FIVE)];
/* 만충을 아주 크게 잡아 체인이 안 열리게 한다 — 여기서 보는 것은 충전 자체다.
   **표적 수는 1 로 못박는다.** 이 절이 보는 것은 "한 발이 그 니케의 수치만큼 채우는가"
   라는 메커니즘이지 기본값이 아니다. 섞어 두면 기본값을 고칠 때마다 여기가 깨진다. */
const gauge = (hits, gaugeMax = 100000) =>
  simulate({ squad: gsquad, scaffold: { hits }, battle: { seconds: 60, gaugeMax, 표적수: 1 } });

eq('한 발 명중 = 그 니케 수치', gauge([{ t: 1, id: 'mg' }]).gauge.at, 10);
eq('니케마다 수치가 다르다', gauge([{ t: 1, id: 'rl' }]).gauge.at, 280);
/* 스쿼드가 하나를 공유한다 — 니케마다 따로 두면 "아군 전체 게이지 충전" 이 다섯
   배가 되고, 서로 다른 니케의 사격이 같은 바를 채우지 못한다. */
eq('스쿼드가 하나를 공유한다',
   gauge([{ t: 1, id: 'mg' }, { t: 2, id: 'rl' }, { t: 3, id: 'smg' }]).gauge.at, 310);
/* 산탄은 한 번 방아쇠에 여러 발이 맞는다. */
eq('여러 발이 맞으면 그만큼', gauge([{ t: 1, id: 'sg', bullets: 10 }]).gauge.at, 400);

/* 만충을 넘긴 몫은 버려진다. 기여도에도 안 들어간다 — 넘친 것까지 세면 "게이지를
   가장 많이 번 니케" 가 거짓말이 된다. */
/* Ⅲ 이 없는 스쿼드로 본다 — 있으면 만충되는 순간 체인이 열려 게이지를 써 버려서
   "넘치는지" 를 볼 수가 없다. */
/* Ⅰ 이 없으면 버튼이 켜져도 누를 사람이 없어 게이지가 그대로 남는다. Ⅲ 만 빼면
   Ⅰ 은 눌려서 게이지가 소비돼 버린다 — 누른 대가는 성패와 무관하게 치르므로. */
const capSquad = [E('a', 'Step2', 280), E('mg', 'Step2', 10), E('sr2', 'Step2', 550),
                  E('smg', 'Step2', 20), E('sg2', 'Step2', 40)];
const over = simulate({ squad: capSquad, battle: { seconds: 60, gaugeMax: 600, 표적수: 1 },
                        scaffold: { hits: [{ t: 1, id: 'sr2' }, { t: 2, id: 'sr2' }] } });
eq('만충에서 멈춘다', over.gauge.at, 600);
eq('넘친 몫은 기여도에도 안 들어간다',
   over.gauge.by.find(x => x.id === 'sr2').charged, 600);

const many = gauge([{ t: 1, id: 'rl' }, { t: 2, id: 'mg' }, { t: 3, id: 'mg' }]);
eq('기여도가 많이 번 순서로 나온다', many.gauge.by[0].id, 'rl');
eq('그 값은 실제로 들어간 양', many.gauge.by[0].charged, 280);

head('메커니즘 4 — 스킬 투사체도 채운다');

/* 가르는 기준은 평타냐 스킬이냐가 아니라 **투사체가 날아가 맞았느냐**다.
   슈팅 스타의 별사탕 40대는 40번 센다. */
const star = gauge([{ t: 1, id: 'rl', kind: HIT.SKILL, bullets: 40 }]);
eq('스킬 투사체 40대도 그만큼 찬다', star.gauge.at, 280 * 40);
const row = star.gauge.by.find(x => x.id === 'rl');
eq('스킬로 번 것으로 잡힌다', row.skill, 280 * 40);
eq('평타 몫은 0', row.bullet, 0);

const both = gauge([{ t: 1, id: 'rl' }, { t: 2, id: 'rl', kind: HIT.SKILL }]);
const r2 = both.gauge.by.find(x => x.id === 'rl');
ok('평타와 스킬을 갈라 센다', r2.bullet === 280 && r2.skill === 280,
   `평타 ${r2.bullet} · 스킬 ${r2.skill}`);
eq('합계는 둘을 더한 것', r2.charged, 560);

head('모르는 값은 지어내지 않는다');

/* 만충 수치는 신데렐라 : CW 단독 영상에서 역산했다 (메커니즘 14). 200발마다 12% 를
   채우는 그의 1스킬이 막대에 계단을 찍어 눈금 역할을 한다. */
const dflt = simulate({ squad: gsquad, scaffold: { hits: [{ t: 1, id: 'mg' }] },
                        battle: { seconds: 60 } });
/* 만충값은 아레나 도구 자료에서 확정했다 — 그쪽 `baseChargeRate` 가 CDN 값을 정확히
   200 으로 나눈 것이라(88명 중 86명 오차 0) 만충이 20,000 이다. */
eq('기본 만충값은 20,000', dflt.gauge.max, 20000);
eq('기본 표적 수는 2', new Sim({ squad: [], battle: {} }).o.표적수, 2);
/* 반응 시간은 **값을 잰 뒤에도** 잠정이다 — 게임의 상수가 아니라 한 사람의 한 판이라
   폭이 다섯 배 벌어진다 (메커니즘 16). */
ok('남은 잠정값은 반응 시간뿐',
   dflt.잠정.length === 1 && dflt.잠정[0].이름 === 'pressDelay',
   dflt.잠정.map(x => x.이름).join(' · '));

/* 일부러 비우면 안 차고 그 사실을 말한다 — 근거 없는 숫자를 몰래 끼우지 않는다. */
const noMax = simulate({ squad: gsquad, scaffold: { hits: [{ t: 1, id: 'mg' }] },
                         battle: { seconds: 60, gaugeMax: null } });
eq('만충 수치를 비우면 안 찬다', noMax.gauge.at, 0);
ok('그 사실을 말한다', noMax.warnings.some(w => w.includes('gaugeMax')));

const noEnergy = simulate({
  squad: [{ id: 'a', burst: 'Step1' }, { id: 'b', burst: 'Step2' },
          { id: 'c', burst: 'Step3', burstDuration: 10 },
          { id: 'd', burst: 'Step2' }, { id: 'e', burst: 'Step2' }],
  scaffold: { hits: Array.from({ length: 50 }, (_, k) => ({ t: k + 1, id: 'a' })) },
  battle: { seconds: 60, gaugeMax: 1000 },
});
eq('충전량을 모르면 안 찬다', noEnergy.gauge.at, 0);
/* 사격마다 한 줄씩 쌓으면 경고 목록을 아무도 안 읽는다. */
eq('같은 경고를 50번 쌓지 않는다',
   noEnergy.warnings.filter(w => w.includes('burstEnergy')).length, 1);

/* ══ 메커니즘 5 — 대미지 계산식 ═══════════════════════════ */

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const eqN = (name, got, want, eps = 1e-6) =>
  ok(name, near(got, want, eps), `${Math.round(got * 1e4) / 1e4} (기대 ${want})`);

/* 여섯 칸이 다 1 이면 결과는 기본 데미지 그대로다 — 곱하는 자리를 잘못 두면
   여기서부터 어긋난다. */
const 맨몸 = { 기본: { 공격력: 10000, 공격계수: 1 } };
eqN('아무 버프도 없으면 공격력 그대로', 대미지(맨몸).값, 10000);

head('메커니즘 5 — 방어력은 곱이 아니라 뺄셈, 버프 먹인 공격력에서 뺀다');

eqN('방어력을 뺀다',
    대미지({ 기본: { 공격력: 10000, 상대방어력: 3000 } }).값, 7000);
/* 공증이 먼저 붙고 그 뒤에 방어력을 뺀다. 순서를 바꾸면 (10000-3000)*1.5 = 10500
   이 되어 1500 이 더 나온다. */
eqN('공증을 먹인 뒤에 뺀다',
    대미지({ 기본: { 공격력: 10000, 공증: [0.5], 상대방어력: 3000 } }).값, 12000);
const 초과 = 대미지({ 기본: { 공격력: 1000, 상대방어력: 5000 } });
eqN('유효 공격력이 음수면 0 으로 자른다', 초과.값, 0);
ok('그 사실을 밖으로 알린다', 초과.방어초과 === true, `유효 공격력 ${초과.유효공격력}`);

head('메커니즘 5 — 기본 데미지 증가 계수는 한 칸 안에서 더해진다');

/* 커뮤니티 실측: 2521 -> 크리 3781(×1.5) -> 코어 5042(×2.0) -> 코어+크리 6302(×2.5)
   -> 코어+크리+풀버 7563(×3.0). 즉 1 + 0.5 + 1.0 + 0.5 다. 곱연산이면
   1.5 × 2.0 × 1.5 = 4.5 가 되어 전혀 다른 수가 나온다. */
const 실측 = 2521;
const 판정 = o => 대미지({ 기본: { 공격력: 실측 }, 기본증가: o }).값;
eqN('기본 = ×1.0', 판정({}), 2521);
eqN('크리 = ×1.5', 판정({ 크리티컬: true }), 3781.5, 0.5);
eqN('코어 = ×2.0', 판정({ 코어: 1.0 }), 5042);
eqN('코어+크리 = ×2.5', 판정({ 크리티컬: true, 코어: 1.0 }), 6302.5, 0.5);
eqN('코어+크리+풀버 = ×3.0',
    판정({ 크리티컬: true, 코어: 1.0, 풀버스트: true }), 7563, 0.5);
eqN('거리 보너스는 30%', 판정({ 거리: true }) / 2521, 1.3);
ok('그림의 기본 계수를 그대로 쓴다',
   BASE.크리티컬 === 0.5 && BASE.거리 === 0.3 && BASE.풀버스트 === 0.5 && BASE.우월코드 === 1.1);

head('메커니즘 5 — "~ 대미지 증가" 도 한 칸 안에서 더해진다');

/* 1세대는 이것들을 서로 곱했고, 커뮤니티 자료(gall gov/651114)도 `× 공격대미지 ×
   받는대미지 × 파츠대미지` 로 각각 곱한다. **물어서 합산이 맞다고 확인했다.**
   나중에 누가 "레이어니까 곱해야 하지 않나" 하고 되돌리지 않게 값으로 박아 둔다. */
const 셋 = 대미지({ 기본: { 공격력: 100 }, 버프증가: [0.3, 0.4, 0.5] }).값;
eqN('세 개가 더해져 ×2.2', 셋, 220);
ok('곱연산(×2.73)이 아니다', !near(셋, 100 * 1.3 * 1.4 * 1.5, 1),
   `합 ${셋} vs 곱 ${Math.round(100 * 1.3 * 1.4 * 1.5)}`);

/* 공증 40% + 파츠 40% 에서 두 해석의 차이가 9% 다. 자료가 갈렸던 자리이므로 그
   차이를 눈에 보이게 남긴다. */
const 합산 = 대미지({ 기본: { 공격력: 100 }, 버프증가: [0.4, 0.4] }).값;
eqN('공증 40% + 파츠 40% = ×1.8 (합산)', 합산, 180);
ok('곱산이면 ×1.96 — 9% 더 나온다', Math.abs(196 / 합산 - 1) > 0.08,
   `합산 ${합산} vs 곱산 196`);

/* "받는 대미지" 는 그 칸이 아니라 **별개 칸**이다. 그래서 버프형과는 곱해진다. */
const 별개칸 = 대미지({ 기본: { 공격력: 100 }, 버프증가: [0.4],
                       받는: { 받는증가: [0.4] } }).값;
eqN('버프형 40% × 받는 40% = ×1.96 (칸이 다르므로 곱)', 별개칸, 196);

head('메커니즘 5 — 차지 계수는 풀차지 배율과 추가 차뎀을 한 칸에서 더한다');

eqN('차지가 아니면 100%',
    대미지({ 기본: { 공격력: 100 }, 차지: { 차지: false, 풀차지배율: 2.5 } }).값, 100);
eqN('풀차지 250%',
    대미지({ 기본: { 공격력: 100 }, 차지: { 차지: true, 풀차지배율: 2.5 } }).값, 250);
eqN('350% 짜리도 있다',
    대미지({ 기본: { 공격력: 100 }, 차지: { 차지: true, 풀차지배율: 3.5 } }).값, 350);
/* 곱이 아니라 합이다 — 곱이면 250% × 1.2 = 300% 가 된다. */
eqN('추가 차뎀 20% 는 더해져 270%',
    대미지({ 기본: { 공격력: 100 },
             차지: { 차지: true, 풀차지배율: 2.5, 추가차뎀: [0.2] } }).값, 270);

head('메커니즘 5 — 우월코드 110%, 받는 대미지 칸');

eqN('우월코드면 ×1.1',
    대미지({ 기본: { 공격력: 100 }, 우월코드: { 우월코드: true } }).값, 110);
eqN('추가 우코는 더해진다',
    대미지({ 기본: { 공격력: 100 },
             우월코드: { 우월코드: true, 추가우코: [0.2] } }).값, 130);
eqN('우월코드가 아니면 ×1.0',
    대미지({ 기본: { 공격력: 100 }, 우월코드: { 우월코드: false, 추가우코: [0.2] } }).값, 100);

/* **분배 대미지 증가는 적이 받는 칸에 있다** — 공격 쪽이 아니다. */
eqN('받는 대미지 + 분배가 같은 칸에서 더해진다',
    대미지({ 기본: { 공격력: 100 }, 받는: { 받는증가: [0.3], 분배증가: [0.2] } }).값, 150);
/* 감소는 더하는 게 아니라 **뺀다**. */
eqN('받는 대미지 감소는 뺀다',
    대미지({ 기본: { 공격력: 100 }, 받는: { 받는증가: [0.5], 받는감소: [0.2] } }).값, 130);

head('메커니즘 5 — 여섯 칸이 곱해진다');

const 전부 = 대미지({
  기본: { 공격력: 10000, 공증: [0.5], 상대방어력: 3000, 공격계수: 2 },
  기본증가: { 크리티컬: true, 코어: 1.0, 풀버스트: true },
  버프증가: [0.3, 0.2],
  차지: { 차지: true, 풀차지배율: 2.5, 추가차뎀: [0.5] },
  우월코드: { 우월코드: true, 추가우코: [0.1] },
  받는: { 받는증가: [0.4], 받는감소: [0.1] },
});
const 손 = 12000 * 2 * 3.0 * 1.5 * 3.0 * 1.2 * 1.3;
eqN('손으로 곱한 값과 같다', 전부.값, 손, 1e-6);
ok('여섯 칸이 다 나온다', Object.keys(전부.칸).length === 6,
   Object.entries(전부.칸).map(([k, v]) => `${k} ${Math.round(v * 100) / 100}`).join(' · '));

/* ══ 메커니즘 7 — 크리티컬은 타격마다 난수 ════════════════ */

head('메커니즘 7 — 씨앗이 같으면 언제나 같은 수열');

const a1 = Array.from({ length: 8 }, rng(42));
const a2 = Array.from({ length: 8 }, rng(42));
const a3 = Array.from({ length: 8 }, rng(43));
ok('같은 씨앗 = 같은 수열', a1.every((v, k) => v === a2[k]));
ok('다른 씨앗 = 다른 수열', a1.some((v, k) => v !== a3[k]));
ok('전부 0 이상 1 미만', a1.every(v => v >= 0 && v < 1), a1.slice(0, 3).map(v => v.toFixed(4)).join(' '));

/* 굴림이 실제로 그 확률을 내는가. 한두 번으로는 알 수 없으니 크게 돌린다. */
const roll = rng(7);
let hitCount = 0;
for (let k = 0; k < 100000; k++) if (roll() < 0.15) hitCount++;
ok('15% 로 굴리면 15% 근처가 나온다', Math.abs(hitCount / 100000 - 0.15) < 0.005,
   `${(hitCount / 1000).toFixed(2)}%`);

head('메커니즘 7 — 엔진이 타격마다 굴린다');

const critSim = new Sim({ squad: [{ id: 'c', name: 'c', burst: 'Step1', critRate: 0.15 }],
                          battle: { seconds: 10, seed: 5 } });
let crits = 0;
for (let k = 0; k < 10000; k++) if (critSim.rollCrit(critSim.actors[0])) crits++;
ok('니케의 크리 확률대로 터진다', Math.abs(crits / 10000 - 0.15) < 0.02,
   `${(crits / 100).toFixed(1)}%`);

/* 확률을 모르면 지어내지 않는다 — 그림이 준 것은 크리 *대미지* 기본 50% 이고
   크리 *확률* 의 기본값은 아직 못 들었다. */
const noRate = new Sim({ squad: [{ id: 'n', name: 'n', burst: 'Step1' }],
                         battle: { seconds: 10 } });
ok('크리 확률을 모르면 안 터진다', noRate.rollCrit(noRate.actors[0]) === false);
noRate.rollCrit(noRate.actors[0]);
eq('그 경고는 한 번만', noRate.warnings.filter(w => w.includes('critRate')).length, 1);

/* 씨앗이 결과에 실려 나가야 나중에 재현할 수 있다. */
eq('씨앗을 결과에 실어 보낸다', go(squad5, [fill(0)], { seed: 99 }).seed, 99);

/* ══ 메커니즘 8·9 — 보너스는 타격의 성격이 정한다 ══════════ */

head('메커니즘 8 — 코어 보너스는 코어에 맞을 때, 원문이 그렇다면 스킬도');

const 상황 = { 풀버스트: false, 교전거리: '중거리', 코어명중가능: true };
ok('평타는 코어에 맞으면 받는다',
   적용({ 종류: 종류.평타, 무기: 'AR' }, 상황).코어 === true);
/* 신데렐라 : 크리스탈 웨이브 2스킬 — 원문이 "코어 명중 대미지" 라 적었으므로 스킬
   타격이어도 받는다. "스킬이면 코어 없음" 이라는 표로 가르면 이걸 놓친다. */
ok('원문이 "코어 명중" 이면 스킬 타격도 받는다',
   적용({ 종류: 종류.스킬, 무기: 'MG', 코어명중: true }, 상황).코어 === true);
ok('그렇게 안 적힌 스킬 타격은 안 받는다',
   적용({ 종류: 종류.스킬, 무기: 'MG' }, 상황).코어 === false);
/* 코어가 없는 적이거나 노출돼 있지 않으면 아무도 안 받는다 (열린 물음 I). */
ok('코어가 없는 적에게는 평타도 안 받는다',
   적용({ 종류: 종류.평타, 무기: 'AR' }, { ...상황, 코어명중가능: false }).코어 === false);

head('메커니즘 8 — 거리 보너스는 무기군 적정거리에 맞을 때, RL 은 영영 없음');

eq('AR 은 중거리', 적정거리.AR, '중거리');
eq('SMG 는 근거리', 적정거리.SMG, '근거리');
eq('SR 은 원거리', 적정거리.SR, '원거리');
eq('MG 는 중거리', 적정거리.MG, '중거리');
eq('SG 는 근거리', 적정거리.SG, '근거리');
ok('RL 은 적정거리가 없다', 적정거리.RL === null);

ok('무기군과 교전거리가 맞으면 받는다',
   적용({ 종류: 종류.평타, 무기: 'AR' }, { 교전거리: '중거리' }).거리 === true);
ok('안 맞으면 안 받는다',
   적용({ 종류: 종류.평타, 무기: 'AR' }, { 교전거리: '근거리' }).거리 === false);
/* 무기군을 보고 예외 처리하는 게 아니라 표에 null 이 들어 있어 저절로 빠진다. */
ok('RL 은 어느 거리에서도 안 받는다',
   ['근거리', '중거리', '원거리'].every(d =>
     적용({ 종류: 종류.평타, 무기: 'RL' }, { 교전거리: d }).거리 === false));
ok('거리 보너스는 평타 기반 — 스킬 타격은 안 받는다',
   적용({ 종류: 종류.스킬, 무기: 'AR' }, { 교전거리: '중거리' }).거리 === false);

head('메커니즘 10 — 풀버스트 보너스는 타격 시각 하나로 갈린다');

const 풀 = { 풀버스트: true, 교전거리: '중거리', 코어명중가능: true };
/* 종류별 표가 아니다. 풀버스트가 켜져 있던 순간에 들어갔으면 받는다 — 평타든
   지속 스킬이든 추가 대미지든. */
ok('풀버스트 중에 들어간 타격은 종류를 안 가리고 받는다',
   Object.values(종류).every(k => 적용({ 종류: k, 무기: 'MG' }, 풀).풀버스트 === true));
ok('풀버스트가 아니면 아무도 안 받는다',
   Object.values(종류).every(k =>
     적용({ 종류: k, 무기: 'MG' }, { 풀버스트: false }).풀버스트 === false));

/* "버스트 스킬 본체는 안 받는다" 는 예외 규칙이 아니라 **순서**의 결과다 — 본체가
   풀버스트보다 한 박자 먼저 때린다. 그래서 본체가 풀버스트 중에 판정되는 일은 있을
   수 없고, 있으면 엔진이 순서를 어긴 것이다. */
ok('버스트 본체가 풀버스트 중에 판정되면 순서 이상으로 짚는다',
   적용({ 종류: 종류.버스트스킬, 무기: 'MG' }, 풀).순서이상 === true);
ok('평타는 풀버스트 중이어도 정상',
   적용({ 종류: 종류.평타, 무기: 'MG' }, 풀).순서이상 === false);
ok('본체가 풀버스트 밖에서 판정되면 정상',
   적용({ 종류: 종류.버스트스킬, 무기: 'MG' }, { 풀버스트: false }).순서이상 === false);

/* 커뮤니티 실측이 남긴 세 조합을 그대로 재현한다 (arca.live 72959169).
   본체와 추가 대미지를 갈라 계산하는데, 본체는 풀버스트 **전**이라 안 받고 추가는
   **후**라 받는다. 크리는 조각마다 따로 굴러간다. */
head('메커니즘 10 — 실측 조합 셋 (본체 / 추가) 재현');

const 한대 = (종류값, 크리, 풀버스트) => {
  const 붙 = 적용({ 종류: 종류값, 무기: 'MG' }, { 풀버스트 });
  return 대미지({ 기본: { 공격력: 1000 },
                 기본증가: { 크리티컬: 크리, 풀버스트: 붙.풀버스트 } }).값;
};
/* ① 노크리 본체 / 노크리 + 풀버50 추가 */
eqN('본체 노크리 = ×1.0', 한대(종류.버스트스킬, false, false), 1000);
eqN('추가 노크리 + 풀버 = ×1.5', 한대(종류.추가, false, true), 1500);
/* ② 크리50 본체 / 노크리 + 풀버50 추가 */
eqN('본체 크리 = ×1.5', 한대(종류.버스트스킬, true, false), 1500);
/* ③ 노크리 본체 / 크리 + 풀버 = ×2.0 — "크리와 풀버스트는 단리다" */
eqN('추가 크리 + 풀버 = ×2.0 (단리)', 한대(종류.추가, true, true), 2000);
/* 곱이면 1.5 × 1.5 = ×2.25 가 된다. 두 항이 다 50% 라서 헷갈리기 쉬운 자리다. */
ok('곱연산(×2.25)이 아니다', 한대(종류.추가, true, true) !== 2250,
   `단리 ${한대(종류.추가, true, true)} vs 곱 2250`);

head('메커니즘 12 — 차지 여부는 발당 게이지 수급을 안 바꾼다');

/* 노차지와 풀차지의 발당 수급량이 같다. 그래서 끊어쳐서 더 많이 쏘는 쪽이 게이지를
   빨리 채운다 — 발당 대미지를 잃고 게이지를 얻는 맞바꿈이다. */
const 노차지 = gauge([{ t: 1, id: 'sr' }, { t: 2, id: 'sr' }, { t: 3, id: 'sr' }]);
const 풀차지 = gauge([{ t: 1, id: 'sr' }]);
eq('세 번 끊어 쏘면 세 배', 노차지.gauge.at, 550 * 3);
eq('한 번 풀차지로 쏘면 한 발분', 풀차지.gauge.at, 550);

head('메커니즘 8 — 차지는 평타의 것');

ok('차지 평타는 차지 계수를 받는다',
   적용({ 종류: 종류.평타, 무기: 'SR', 차지: true }, 풀).차지 === true);
ok('스킬 타격은 차지가 아니다',
   적용({ 종류: 종류.스킬, 무기: 'SR', 차지: true }, 풀).차지 === false);

head('메커니즘 9 — "~ 대미지 증가" 는 조건부');

/* 파츠를 때리지 않으면 파츠 증댐이 안 붙는다. 공식은 골라 넘긴 것만 더하므로,
   고르는 쪽이 조건을 지켜야 한다는 것을 값으로 못박는다. */
const 파츠증가 = 0.4;
const 파츠때림 = 대미지({ 기본: { 공격력: 100 }, 버프증가: [파츠증가] }).값;
const 파츠안때림 = 대미지({ 기본: { 공격력: 100 }, 버프증가: [] }).값;
eqN('파츠를 때리면 더해진다', 파츠때림, 140);
eqN('안 때리면 더해지지 않는다', 파츠안때림, 100);

head('기댓값은 게임 규칙이 아니라 대조용 근사다');

const 기댓 = 기댓값({ 기본: { 공격력: 1000 } }, 0.15);
eqN('크리 15% 면 1 + 0.15×0.5 = 1.075 배', 기댓.값, 1075);
eqN('확률 0 이면 크리 없는 값', 기댓값({ 기본: { 공격력: 1000 } }, 0).값, 1000);
eqN('확률 1 이면 크리 난 값', 기댓값({ 기본: { 공격력: 1000 } }, 1).값, 1500);

/* ══ 사격 — 1세대에서 옮긴 실측 기계장치 ══════════════════ */

head('사격 — MG 예열은 발수 기준 계단, 프레임이 최고 연사를 정한다');

/* 라피 : 레드 후드의 실제 제원. 화면 녹화로 잰 값들이라 여기가 어긋나면 이식이
   틀린 것이다 (MEKAMI.md). */
const MG = {
  weapon: 'MG', control: 'normal', damage: 5.57, coreDamage: 200,
  maxAmmo: 300, reload: 2.5, pellets: 1, shotCount: 1,
  rof: { start: 60, end: 4200, perShot: 100 },
  charge: { time: 0, fullDamage: 100 },
  burstEnergy: { perTargetShot: 10 },
};
const 사수 = (over = {}, shot = MG) => ({
  id: 'g', name: 'g', burst: 'Step1', burstDuration: 10, burstCooldown: 20,
  critRate: 0, stats: { atk: 10000, def: 0, hp: 1 },
  combat: { shot: { ...shot, ...(over.shot || {}) } },
  effects: { rules: [], unmodeled: [], problems: [] },
  staticBuffs: over.staticBuffs || [], staticAmmo: over.staticAmmo || {},
  ...over,
});
const 쏴 = (over, battle = {}) => simulate({
  squad: [사수(over)], enemy: { def: 0 },
  battle: { seconds: 60, gaugeMax: null, sample: 0, ...battle },
}).byActor[0];

/* 첫 발은 **초기 연사 60 RPM** 이 정한다 — 1초 뒤다. 램프가 발수 기준이라 여기서
   시작해 스스로를 가속한다. */
eq('0.99초에는 아직 한 발도 안 나간다', 쏴({}, { seconds: 0.99 }).shots, 0);
eq('1.00초에 첫 발', 쏴({}, { seconds: 1.0 }).shots, 1);

/* 탄창 300발이 7.5초에 끝난다 = **첫 발부터 6.5초.** 실측 6.52초와 맞는다.
   (녹화는 첫 탄부터 마지막 탄까지를 재므로 앞의 1초가 안 들어간다.) */
eq('300발이 7.5초에 끝난다 — 첫 발부터 6.5초', 쏴({}, { seconds: 7.5 }).shots, 300);
ok('7.45초에는 아직 못 끝낸다', 쏴({}, { seconds: 7.45 }).shots < 300,
   `${쏴({}, { seconds: 7.45 }).shots}발`);

/* **최고 연사는 프레임에 걸린다** — 한 프레임에 한 발까지다. CDN 의 4200 RPM(70발/초)은
   60fps 기기에서 안 나오고, 커뮤니티가 말하는 45발/초가 그 결과다. */
eq('7초 시점 60fps', 쏴({}, { seconds: 7, fps: 60 }).shots, 271);
eq('같은 시각 120fps 는 다 쏜다', 쏴({}, { seconds: 7, fps: 120 }).shots, 300);
ok('30fps 는 절반 남짓', 쏴({}, { seconds: 7.5, fps: 30 }).shots < 200,
   `${쏴({}, { seconds: 7.5, fps: 30 }).shots}발`);

head('사격 — 재장전은 선형, 100% 면 예열이 살아남는다');

const 느긋 = 쏴({}, { seconds: 30 }).shots;
const 빠름 = 쏴({ staticBuffs: [{ stat: 'reloadSpeed', value: 0.5, source: 't' }] },
                { seconds: 30 }).shots;
const 무한 = 쏴({ staticBuffs: [{ stat: 'reloadSpeed', value: 1, source: 't' }] },
                { seconds: 30 }).shots;
eq('맨몸 30초에 900발 (세 탄창)', 느긋, 900);
ok('재장전 속도 50% 면 조금 는다', 빠름 > 느긋, `${느긋} -> ${빠름}발`);

/* 100% 면 재장전이 **0 이 된다** — `기본 ÷ (1 + 속도)` 였다면 절반이 남아 이 규칙이
   안 나온다. 남는 것은 속도의 영향을 안 받는 모션 0.2초뿐인데, 0.2초는 냉각 곡선의
   유지 구간(0.3초) 안이라 **예열이 그대로 살아남는다.** 그래서 두 번째 탄창부터는
   램프 없이 최고 연사로 나가고, 50% 와의 차이가 배로 벌어진다.
   MG 가 무한탄창 조합을 원하는 진짜 이유가 이것이다. */
eq('재장전 100% 면 30초에 1591발', 무한, 1591);
ok('50% -> 100% 의 도약이 0% -> 50% 보다 훨씬 크다',
   (무한 - 빠름) > (빠름 - 느긋) * 10,
   `0->50%: +${빠름 - 느긋}발 · 50->100%: +${무한 - 빠름}발`);

head('사격 — 장탄은 계열마다 따로 반올림한다');

/* SR 6발에서 계열을 나누느냐가 1발을 가른다. 전부 더해 한 번에 반올림하면
   6 × 0.16 = 0.96 -> 1발, 계열을 나누면 0.48 씩이라 0 + 0 = 0발이다. */
const SR = { ...MG, weapon: 'SR', maxAmmo: 6, reload: 2, rof: { start: 60, end: 60, perShot: 0 } };
eq('SR 6발 + 계열 A·B 각 8% = 6발',
   쏴({ shot: SR, staticAmmo: { A: 0.08, B: 0.08 } }, { seconds: 1 }).ammo, 6);
eq('같은 16% 라도 한 계열이면 7발',
   쏴({ shot: SR, staticAmmo: { A: 0.16 } }, { seconds: 1 }).ammo, 7);

head('사격 — 차지 무기는 차지 시간이 간격을 정한다');

const RL = { ...MG, weapon: 'RL', control: 'charge', maxAmmo: 6, reload: 2,
             rof: { start: 120, end: 120, perShot: 0 },
             charge: { time: 1, fullDamage: 250 } };
const 차지 = 쏴({ shot: RL }, { seconds: 20 }).shots;
const 빠른차지 = 쏴({ shot: RL, staticBuffs: [{ stat: 'chargeSpeed', value: 1, source: 't' }] },
                    { seconds: 20 }).shots;
ok('차지 1초면 20초에 스무 발 안쪽', 차지 <= 20 && 차지 >= 12, `${차지}발`);
ok('차지 속도 100% 면 훨씬 많이 쏜다', 빠른차지 > 차지 * 1.4, `${차지} -> ${빠른차지}발`);

head('사격 — 게이지가 스스로 찬다 (비계 없이)');

/* 이제 밖에서 명중을 찔러 넣지 않아도 총을 쏘면 게이지가 찬다. 비계가 하는 일은
   게이지 하나만 따로 시험하는 것뿐이다. */
const 자립 = simulate({
  squad: [사수({ id: 'a', burst: 'Step1' }), 사수({ id: 'b', burst: 'Step2' }),
          사수({ id: 'c', burst: 'Step3' }), 사수({ id: 'd', burst: 'Step2' }),
          사수({ id: 'e', burst: 'Step3' })],
  enemy: { def: 0 }, battle: { seconds: 60, gaugeMax: 7500 },
});
ok('사격만으로 풀버스트가 돈다', 자립.fullBurst.count > 0,
   `${자립.fullBurst.count}회 · 체인 ${자립.chains.started}회`);
ok('잠긴 동안의 명중이 버려진 것으로 잡힌다', 자립.wastedHits > 0, `${자립.wastedHits}회`);

/* 사격만으로 게이지가 차고 체인이 도는 5인. 기여도 항등식을 보려면 실제로 사이클이
   여러 번 돌아야 한다. */
const 사격5인 = [사수({ id: 'a', burst: 'Step1' }), 사수({ id: 'b', burst: 'Step2' }),
                 사수({ id: 'c', burst: 'Step3' }), 사수({ id: 'd', burst: 'Step2' }),
                 사수({ id: 'e', burst: 'Step3' })];
/* **기여도의 단위는 게이지다.** 니케별 충전량을 만충 기준값으로 나누면 "게이지를 몇 번
   채웠나" 가 된다. 원시 수치는 만충 기준값을 모르면 읽을 수 없고, 그 값이 바뀌면 같은
   편성의 숫자가 통째로 달라진다.

   집계가 새지 않는지는 **항등식**으로 확인한다. 게이지는 체인을 시작할 때마다 만충만큼
   소비되고 나머지는 지금 차 있는 몫이므로:

     총 충전량 = 만충 × 체인 시작 횟수 + 현재 게이지

   전투가 충전 도중에 끝나면 마지막 몫이 남으므로 이 항이 필요하다 — 체인 횟수로만
   나누면 그만큼 100% 를 넘는다. */
const 기여 = simulate({ squad: 사격5인, enemy: { def: 0 },
                        battle: { seconds: 120, sample: 0 } });
const 총충전 = 기여.gauge.by.reduce((x, y) => x + y.charged, 0);
const 예상 = 기여.gauge.max * 기여.chains.started + 기여.gauge.at;
ok('총 충전량 = 만충 × 체인 횟수 + 현재 게이지',
   Math.abs(총충전 - 예상) < 1,
   `${Math.round(총충전).toLocaleString()} vs ${Math.round(예상).toLocaleString()}`);
/* 그러면 "게이지를 몇 번 채웠나" 는 총 충전량 ÷ 만충 이고, 니케별 몫을 그것으로 나눈
   값의 합은 정의상 정확히 100% 다. 화면이 그 단위로 표시한다. */
const 채운횟수 = 총충전 / 기여.gauge.max;
const 합 = 기여.gauge.by.reduce((x, y) => x + (y.charged / 기여.gauge.max) / 채운횟수, 0);
ok('사이클당 기여도의 합이 100%', Math.abs(합 - 1) < 1e-9,
   `${(합 * 100).toFixed(1)}% · 게이지 ${채운횟수.toFixed(1)}회 충전`);

head('"기본 버스트 단계가 Step1 인 아군" 에 안 들어가는 두 부류');

/* 라피 : 레드 후드의 1스킬이 이 판정으로 자기 단계를 바꾸므로, 여기가 틀리면 스쿼드가
   통째로 어긋난다.

     AllStep    그 자리에 **쓸 수는 있어도** 기본 단계가 아니다. 레드 후드를 1버스트로
                써도 라피 : 레드 후드는 여전히 전투 보조(1버스트)로 남는다.
     재진입     `[버스트 재진입 N단계]` 를 아군 전체에게 주는 니케 (아비스타 등).

   아니스 : 스타는 재진입 문구가 있어도 **들어간다** — 그의 것은 아군에게 주는 것이
   아니라 조건이 맞을 때 자기 재진입 단계를 바꾸는 상태(`모두의 별`)다. */
/* 판정에 필요한 것은 `burst` 와 스킬 원문뿐이지만, 엔진이 배우를 세울 때 무기 제원을
   보므로 최소한만 채워 둔다. */
const 총 = { weapon: 'AR', rof: { start: 600, end: 600, perShot: 0 }, maxAmmo: 60,
             reload: 1, damage: 10, burstEnergy: { perTargetShot: 40 }, shotCount: 1 };
const 스킬텍스트 = t => ({ s1: { text: { ko: t }, values: [[1]] },
                     s2: { text: { ko: '' }, values: [[1]] },
                     burst: { text: { ko: '' }, values: [[1]], cooldown: [20] } });
const 단계판정 = (동료들) => {
  const 라피 = N('rh', 'Step3', {
    combat: { burst: 'Step3', shot: 총, skills: 스킬텍스트('') },
    effects: { rules: [
      /* 손으로 쓴 규칙은 `when` 을 쓴다 — `compile` 이 표의 `if` 를 `when` 으로 옮긴다. */
      { where: '전투 보조', on: 'battleStart', when: { squadHasStep1: false }, to: 'self',
        set: { state: '전투 보조', step: 1, duration: Infinity }, apply: [] },
      { where: '해제', on: 'battleStart', when: { squadHasStep1: true }, to: 'self',
        clear: ['전투 보조'], apply: [] }] , unmodeled: [], problems: [] } });
  const r = simulate({ squad: [라피, ...동료들], battle: { seconds: 2, gaugeMax: null, sample: 0 } });
  return r.log.some(l => l.kind === 'state' && l.state === '전투 보조' && l.on);
};
const 동료들 = (id, burst, text = '') =>
  N(id, burst, { combat: { burst, shot: 총, skills: 스킬텍스트(text) } });

ok('진짜 Step1 아군이 있으면 전투 보조가 안 붙는다',
   !단계판정([동료들('a', 'Step1'), 동료들('b', 'Step2'), 동료들('c', 'Step2'), 동료들('d', 'Step2')]));
ok('AllStep 은 Step1 로 안 센다 (그 자리에 쓸 수는 있어도)',
   단계판정([동료들('a', 'AllStep'), 동료들('b', 'Step2'), 동료들('c', 'Step2'), 동료들('d', 'Step2')]));
ok('아군 전체에게 [버스트 재진입 1단계] 를 주는 니케도 안 센다',
   단계판정([동료들('a', 'Step1', '■ 아군 전체에게\n[버스트 재진입 1단계]'),
        동료들('b', 'Step2'), 동료들('c', 'Step2'), 동료들('d', 'Step2')]));
/* 아니스 : 스타의 문구는 "…로 변경" 이라 다르다. 여기서 빼 버리면 아니스 : 스타 +
   라피 : 레드 후드 조합이 통째로 뒤집힌다. */
ok('"재진입 N단계로 변경" 은 재진입 니케가 아니다 (아니스 : 스타)',
   !단계판정([동료들('a', 'Step1', '효과 2 : 자신에게\n[모두의 별 : 버스트 재진입 1단계로 변경] [지속]'),
         동료들('b', 'Step2'), 동료들('c', 'Step2'), 동료들('d', 'Step2')]));

head('메커니즘 18 — 버스트 재진입');

/* 아군 전체에게 `[버스트 재진입 1단계]` 를 주는 니케가 Ⅰ 을 쓰면 체인이 Ⅱ 로 가지 않고
   Ⅰ 로 되돌아간다. 되돌아간 자리는 **다른 니케**가 채운다 — 방금 쓴 본인은 쿨타임이
   돌고, 이번 체인에 이미 쓴 니케도 못 쓴다. */
const 재진입텍스트 = '■ 아군 전체에게\n[버스트 재진입 1단계]';
const 재N = (id, burst, text = '') =>
  N(id, burst, { combat: { burst, shot: 총, skills: 스킬텍스트(text) } });
const 재진입판 = (extra = {}) => go(
  [재N('a', 'Step1', 재진입텍스트), 재N('b', 'Step1'), 재N('c', 'Step2'),
   재N('d', 'Step3', ''), 재N('e', 'Step2')].map((x, i) =>
     i === 3 ? { ...x, burstDuration: 10 } : x),
  [fill(1)], extra);

const r재 = 재진입판();
const 체인1 = r재.log.filter(l => l.kind === 'burst' && l.index === 0);
eq('한 체인이 Ⅰ-Ⅰ-Ⅱ-Ⅲ 로 길어진다',
   체인1.map(l => l.step.replace('Step', '')).join('-'), '1-1-2-3');
eq('되돌아간 Ⅰ 은 다른 니케가 채운다', 체인1.slice(0, 2).map(l => l.actor).join('>'), 'a>b');
ok('재진입이 기록에 남는다', r재.log.some(l => l.kind === 'reentry' && l.to === 'Step1'));
eq('그래도 풀버스트는 한 번', r재.fullBurst.count > 0, true);

/* **체인 10초는 재진입한 시점부터 새로 잰다.** 그래서 길어져도 창이 모자라 무효가
   되지 않는다. */
const 재기록 = r재.log.find(l => l.kind === 'reentry');
const 시작 = r재.log.find(l => l.kind === 'chainStart');
ok('재진입 시점부터 창을 새로 잰다',
   Math.abs(재기록.deadline - (재기록.t + 10)) < 1e-9,
   `재진입 ${재기록.t} -> 마감 ${재기록.deadline} (체인 시작 ${시작.t})`);

/* 되돌아갈 자리를 채울 니케가 없으면 되돌아가지 않는다 — 창만 흘려보내기 때문이다. */
const r혼자 = go([재N('a', 'Step1', 재진입텍스트), 재N('c', 'Step2'),
                  { ...재N('d', 'Step3'), burstDuration: 10 },
                  재N('e', 'Step2'), 재N('f', 'Step2')], [fill(1)]);
eq('채울 사람이 없으면 평소대로 Ⅱ 로 간다',
   r혼자.log.filter(l => l.kind === 'burst' && l.index === 0)
       .map(l => l.step.replace('Step', '')).join('-'), '1-2-3');

head('이름 있는 상태 — 버프가 상태에 묶이고, 상태가 사라지면 같이 사라진다');

/* 원문은 상태를 `[전투 보조 : 버스트 1단계로 변경] [지속]` 처럼 적고, 그 상태가 주는
   것을 그 아래 묶는다. 해제도 같이 적힌다 — `[10초 유지]` 로 시간이 오거나
   `[전투 보조 삭제]` 로 다른 효과가 걷는다.

   그래서 상태와 버프를 따로 관리하면 안 된다. 이름표만 떼고 버프를 남기면 "삭제" 라고
   적힌 원문과 어긋나고, 그 니케는 영영 버프를 달고 다닌다. */
const 상태 = (rules, battle = {}, hits = []) => simulate({
  squad: [N('i', 'Step1', { effects: { rules, unmodeled: [], problems: [] } }),
          N('ii', 'Step2'), N('iii', 'Step3', TEN), N('x', 'Step2'), N('y', 'Step3', TEN)],
  scaffold: { hits },
  battle: { seconds: 30, gaugeMax: null, sample: 0.5, snapshot: true,
            pressDelay: 0, ...battle },
});
const 켠다 = { where: '켜기', on: 'battleStart', to: 'self',
               set: { state: '무대', duration: 10 },
               apply: [{ stat: 'atkPct', value: 0.5, duration: Infinity }] };

const r상태 = 상태([켠다]);
const 스냅 = t => r상태.snapshots.find(s => s.t >= t);
const 공증 = s => (s.actors[0].buckets.atkPct || 0);
ok('상태가 켜지면 그 버프가 붙는다', 공증(스냅(1)) === 0.5, String(공증(스냅(1))));
ok('상태가 켜져 있다', 스냅(1).actors[0].states.includes('무대'));
/* **[10초 유지] 는 상태의 지속시간이다.** 버프 자체는 [지속] 이지만 상태가 끝나면
   같이 걷힌다 — 그게 원문이 둘을 묶어 적은 뜻이다. */
ok('10초가 지나면 상태가 사라진다', !스냅(11).actors[0].states.includes('무대'),
   스냅(11).actors[0].states.join(',') || '없음');
ok('상태와 함께 버프도 사라진다 (버프는 [지속] 이었다)', 공증(스냅(11)) === 0,
   String(공증(스냅(11))));

/* 다른 효과가 이름으로 걷어도 같다. */
const 지운다 = { where: '지우기', on: 'battleStart', to: 'self', clear: ['무대'], apply: [] };
/* 게이지를 채워 체인을 돌리고, Ⅰ 을 쓰는 순간 상태를 걷는다. */
const r삭제 = 상태([{ ...켠다, set: { state: '무대', duration: Infinity } },
                    { ...지운다, on: 'burstUse' }],
                   { gaugeMax: MAX }, [fill(5)]);
const 눌린때 = r삭제.log.find(l => l.kind === 'burst');
const 뒤 = r삭제.snapshots.find(s => s.t > 눌린때.t);
ok('[삭제] 로 걷어도 버프가 같이 사라진다', (뒤.actors[0].buckets.atkPct || 0) === 0,
   String(뒤.actors[0].buckets.atkPct || 0));
ok('무엇이 몇 개 걷혔는지 기록에 남는다',
   r삭제.log.some(l => l.kind === 'state' && l.on === false && l.buffsDropped > 0));

head('메커니즘 9 — 조건이 적의 생김새인 버프는 전투 조건이 켠다');

/* 파츠·저지 부위 증댐은 **그 타격이 무슨 종류인가**가 아니라 **상대에게 그 부위가
   있는가**가 조건이다 (열린 물음 O 의 절반). 평타에는 타입을 적을 자리가 없어서,
   `hit.type` 하나로 보면 이 버프들이 영영 안 걸렸다. */
const 부위 = (버프, enemy) => simulate({
  squad: [사수({ critRate: 0, staticBuffs: [{ stat: 버프, value: 0.4, source: 't' }] })],
  enemy: { def: 0, ...enemy }, battle: { seconds: 1, gaugeMax: null },
}).total;
const 버프없이 = simulate({ squad: [사수({ critRate: 0 })], enemy: { def: 0 },
                            battle: { seconds: 1, gaugeMax: null } }).total;
eq('파츠가 없으면 파츠 증댐이 안 붙는다', 부위('partsDmg', {}), 버프없이);
eq('파츠가 있으면 40% 가 붙는다',
   +(부위('partsDmg', { 파츠있음: true }) / 버프없이).toFixed(2), 1.4);
eq('저지 부위도 마찬가지',
   +(부위('blockDmg', { 저지부위있음: true }) / 버프없이).toFixed(2), 1.4);
eq('저지 부위가 없으면 안 붙는다', 부위('blockDmg', {}), 버프없이);
/* 버프형은 한 칸에서 **더한다** — 둘 다 켜면 1.4×1.4 가 아니라 1.8 이다. */
const 둘 = simulate({
  squad: [사수({ critRate: 0, staticBuffs: [
    { stat: 'partsDmg', value: 0.4, source: 't' },
    { stat: 'blockDmg', value: 0.4, source: 't' }] })],
  enemy: { def: 0, 파츠있음: true, 저지부위있음: true },
  battle: { seconds: 1, gaugeMax: null },
}).total;
eq('둘 다 켜면 곱이 아니라 합', +(둘 / 버프없이).toFixed(2), 1.8);

head('메커니즘 16 — 컷신은 사이클에서 뺀다');

/* 영상의 **벽시계** 사이클은 여섯 조각으로 닫혔다:
     충전 1.55 · 만충→Ⅰ 0.52 · Ⅰ→Ⅱ 1.60 · Ⅱ→Ⅲ 1.43 · Ⅲ→풀버스트 1.45 ·
     풀버스트 10.00 = 16.55초 (실측 주기와 일치)
   가운데 셋 4.48초는 컷신이라 전투의 시간이 아니다. 빼고 남는 12.07초가 모형의
   사이클이다. 여기서는 게이지 충전을 비계로 대신하고 나머지를 본다.

   `go` 는 체인 논리를 보려고 지연을 눕히므로 여기서는 안 쓰고 기본값 그대로 돌린다 —
   잠그려는 것이 바로 그 기본값이다. */
const 연출 = simulate({ squad: squad5, scaffold: { hits: [fill(10)] },
                        battle: { seconds: 40, gaugeMax: MAX, sample: 0.05 } });
const 눌린 = 연출.log.filter(e => e.kind === 'burst');
const fb열림 = 연출.log.find(e => e.kind === 'fbStart');
eq('만충 뒤 사람이 누르기까지 — 사이클에 한 번만 든다', +(눌린[0].t - 10).toFixed(2), 0.52);
eq('Ⅰ 에서 Ⅱ 로 시간이 안 든다 (컷신을 뺐다)', +(눌린[1].t - 눌린[0].t).toFixed(2), 0);
eq('Ⅱ 에서 Ⅲ 도 마찬가지', +(눌린[2].t - 눌린[1].t).toFixed(2), 0);
eq('Ⅲ 을 누르면 풀버스트가 그 자리에서 열린다', +(fb열림.t - 눌린[2].t).toFixed(2), 0);

/* 실측 12.07초를 그대로 맞대 본다. 충전이 비계라 여기서는 1.55초를 손으로 놓고 잰다. */
const fb끝 = 연출.log.find(e => e.kind === 'fbEnd');
eq('반응 + 풀버스트 = 10.52초', +(fb끝.t - 10).toFixed(2), 10.52);
ok('충전 1.55초를 얹으면 실측 12.07초', Math.abs((fb끝.t - 10) + 1.55 - 12.07) < 0.01);

/* 컷신을 뺐어도 **잠금은 안 끊긴다.** Ⅲ 에서 체인을 치우고 풀버스트를 여는 사이에
   게이지가 새면 사이클이 통째로 빨라진다 (`fbPending` 이 그 틈을 막는다). */
const 샘 = 연출.series.filter(s => s.t >= 눌린[0].t && s.t < fb끝.t);
ok('Ⅰ 을 누른 뒤 풀버스트가 끝날 때까지 게이지가 안 찬다',
   샘.every(s => (s.gauge || 0) === 0), 샘.map(s => s.gauge).join(','));

head('④ 차지 칸 — 풀차지 배율과 차지 대미지가 한 칸에서 더해진다');

/* 자료의 수치 예시를 그대로 옮긴다 (유튜브 "니케 모든 대미지 알아보기"):
   "100% 풀차지 공격이 250% 데미지를 입히는 상황에서 차지 데미지 150% 버프를 받으면
   풀차지 공격만 400%가 되는 것" — 곱하면 625% 가 되므로 합이라야 맞는다. */
eq('250% + 150% = 400%',
   차지계수({ 차지: true, 풀차지배율: 2.5, 추가차뎀: [1.5] }), 4.0);
eq('차지 공격이 아니면 이 칸은 1',
   차지계수({ 차지: false, 풀차지배율: 2.5, 추가차뎀: [1.5] }), 1);
/* "차지한 만큼 버프가 적용되기 때문에 톡톡기로 공격하는 니케는 차지 데미지 옵션
   효율을 제대로 받지 못한다" — 칸을 버리는 것이 아니라 **비율을 건다.** */
eq('절반만 당기면 절반만 받는다',
   차지계수({ 차지: true, 풀차지배율: 2.5, 추가차뎀: [1.5], 비율: 0.5 }), 2.5);
eq('하나도 안 당기면 1', 차지계수({ 차지: true, 풀차지배율: 2.5, 비율: 0 }), 1);
/* 예전에는 부분 차지에서 칸을 통째로 껐다. 그러면 차지 대미지 버프가 한 톨도 안
   걸려 톡톡이 운용이 실제보다 낮게 나온다 — 되돌리지 않게 못박는다. */
ok('부분 차지에서도 차지 대미지 버프가 산다',
   차지계수({ 차지: true, 풀차지배율: 2.5, 추가차뎀: [1.5], 비율: 0.5 })
   > 차지계수({ 차지: true, 풀차지배율: 2.5, 추가차뎀: [], 비율: 0.5 }));

head('대미지 — 여섯 칸이 타격에 실제로 걸린다');

const 상황딜 = enemy => simulate({
  squad: [사수({ critRate: 0 })], enemy: { def: 0, ...enemy },
  battle: { seconds: 1, gaugeMax: null },
}).total;
const 맨몸딜 = 상황딜({});
ok('평타가 대미지를 낸다', 맨몸딜 > 0, Math.round(맨몸딜).toLocaleString());
/* 코어에 닿는 적이면 평타는 전부 코어 명중 (메커니즘 13). 코어 200% -> +1.0 이라 두 배. */
eqN('코어에 닿으면 두 배', 상황딜({ 코어명중가능: true }) / 맨몸딜, 2);
/* 거리 보너스는 무기군 적정거리가 맞을 때만. MG 는 중거리다. */
eqN('적정거리(MG=중거리)면 1.3배', 상황딜({ 교전거리: '중거리' }) / 맨몸딜, 1.3);
eqN('MG 가 원거리면 안 붙는다', 상황딜({ 교전거리: '원거리' }) / 맨몸딜, 1);
/* 방어력은 곱이 아니라 뺄셈이다. */
eqN('방어력은 뺄셈 (공격력 10000 · 방어력 5000 -> 절반)',
    상황딜({ def: 5000 }) / 맨몸딜, 0.5);

head('원장');

eq('들어온 메커니즘 19개', LEDGER.length, 19);
ok('안 들은 것은 따로 모아 둔다', OPEN.length > 0 && OPEN.every(o => o.물음 && o.지금 && o.왜),
   OPEN.map(o => o.n).join('·'));
/* 내 짐작과 "아직 아무도 모른다" 를 갈라 둔다 — 물어볼 것이 무엇인지 흐려지지 않게. */
ok('짐작·미규명·자료 충돌을 갈라 둔다',
   OPEN.every(o => ['내 짐작', '아직 미규명', '자료 충돌'].includes(o.출처)),
   OPEN.map(o => `${o.n}(${o.출처})`).join(' · '));
ok('저마다 근거가 적혀 있다', LEDGER.every(m => m.말 && m.한 && m.신뢰도),
   LEDGER.map(m => `${m.n}. ${m.name}`).join(' · '));

console.log(`\n${'═'.repeat(60)}`);
console.log(`  PASS ${pass} · FAIL ${fail}`);
process.exit(fail ? 1 : 0);
