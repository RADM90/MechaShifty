/* 2세대 엔진 — 처음부터 다시 짓는 중. DOM 을 모른다.

   1세대는 `mekami/legacy/engine.js` 에 얼려 뒀다. 앱과 테스트는 아직 그쪽으로 도므로
   여기가 비어 있어도 아무것도 안 멈춘다. 다 자라면 import 한 줄을 바꾼다.

   메커니즘은 하나씩, 합의한 것만 들어온다. 들어온 순서와 근거는 아래 `LEDGER` 에
   적는다 — 코드를 읽으면 '무엇을' 하는지는 알 수 있지만 '왜 그렇게' 인지는 거기
   아니면 남지 않는다.

   ── 구조에 대해 미리 정한 것 하나 ───────────────────────────

   시간을 **이벤트 큐**로 굴린다 (고정 틱이 아니라). 1세대에서 이게 필요했던 이유는
   MG 최고 연사가 초당 70발이라 30Hz 격자로는 발사를 놓치기 때문이었다.

   큐가 하는 일은 하나다: **가장 이른 시각의 일을 꺼내 준다.** 같은 시각이면 넣은
   순서대로 — 버프가 붙기 전에 총알이 나가는 일이 없어야 한다. */

/* ── 최소 힙 ───────────────────────────────────────────────── */

/* 180초 5인이면 이벤트가 2만 개를 넘고, 버스트 순서를 60가지 비교하면 백만 단위가
   된다. 정렬 배열에 끼워 넣으면 O(n^2) 라 힙이 필요하다. */
export class Queue {
  constructor() { this.a = []; this.seq = 0; }

  get size() { return this.a.length; }

  push(t, ev) {
    ev.t = t; ev.seq = this.seq++;
    const a = this.a;
    a.push(ev);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.before(a[i], a[p])) { [a[i], a[p]] = [a[p], a[i]]; i = p; } else break;
    }
  }

  pop() {
    const a = this.a;
    if (!a.length) return null;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && this.before(a[l], a[m])) m = l;
        if (r < a.length && this.before(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]]; i = m;
      }
    }
    return top;
  }

  /* 같은 시각이면 넣은 순서대로. */
  before(x, y) { return x.t !== y.t ? x.t < y.t : x.seq < y.seq; }
}

/* 등기부는 `ledger.next.js` 한 곳에 모아 두고 공식 모듈과 같이 본다. */
export { LEDGER, OPEN, 잠정 } from './ledger.next.js';
import { LEDGER, OPEN, 잠정 } from './ledger.next.js';

/* 대미지는 공식 모듈이, 버프를 여섯 칸에 배치하는 것은 다리가 한다. 엔진은 시간만
   굴린다 — 그 경계를 지켜야 공식이 틀렸는지 시간축이 틀렸는지 가릴 수 있다. */
import { 대미지 } from './formula.next.js';
import { 여섯칸, 타격성격, 평타성격 } from './bridge.next.js';
import { 종류 } from './formula.next.js';
/* 효과 DSL 은 1세대 것을 그대로 쓴다 — 전투 규칙이 아니라 "손으로 쓴 해석을 읽는 법"
   이라서 2세대에서도 그대로 유효하다. 효과표 199장이 여기 매달려 있다. */
import { meets, resolveTargets, 재진입단계 } from './effects.js';
import { resolveAmmo } from './formula.js';

/* ── 버스트 단계 ───────────────────────────────────────────── */

export const STEPS = ['Step1', 'Step2', 'Step3'];

/* 어느 니케가 어느 단계를 낼 수 있는가.

   자리에 제약은 없다 — 어느 니케든 그가 가진 단계 자리에 들어간다. `AllStep` 은
   어느 단계든 낸다 (전 로스터에서 레드 후드 한 명뿐이라 특례처럼 보이지만, 필터가
   조용히 떨어뜨리면 그 니케만 통째로 계산에서 빠지므로 규칙으로 둔다). */
export function canDo(actor, step) {
  return actor.burst === step || actor.burst === 'AllStep';
}

/* 게이지를 채우는 명중의 종류. 둘 다 채우지만 갈라 두는 이유는 기여도를 볼 때
   "이 니케는 평타로 버나 스킬로 버나" 가 서로 다른 질문이기 때문이다. */
export const HIT = { BULLET: 'bullet', SKILL: 'skill' };

/* ── 난수 ──────────────────────────────────────────────────── */

/* 크리티컬은 타격마다 굴린다 (메커니즘 7). 그런데 난수를 그냥 쓰면 같은 입력이 같은
   답을 안 주고, 그러면 "이 편성이 저 편성보다 나은가" 를 물을 수가 없다 — 실행할
   때마다 순위가 뒤집힌다.

   그래서 **씨앗에서 뽑는다.** 같은 입력·같은 씨앗이면 언제나 같은 답이고, 편성 둘을
   같은 씨앗으로 돌리면 같은 크리 흐름 위에서 겨루게 되어 비교가 짝지어진다. 편차가
   궁금하면 씨앗을 바꿔 여러 번 돌린다.

   mulberry32. 짧고, 주기가 충분히 길고, 무엇보다 구현이 한눈에 들어와 다른 기계에서도
   같은 수열이 나온다. */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ── 시뮬레이션 ────────────────────────────────────────────── */

const DEFAULTS = {
  seconds: 180,
  /* 메커니즘 3 — 체인이 유지되는 시간. Ⅰ 을 누른 순간부터 잰다. */
  chainWindow: 10,
  /* 만충 수치. **아직 안 정했다** — 없으면 게이지가 영영 안 차고, 그 사실을
     경고로 남긴다. 기본값을 몰래 끼워 넣으면 사이클 길이가 통째로 그 값에 매달리는데
     아무도 그걸 고른 기억이 없게 된다.
     (1세대는 2분 협전 로그를 역산해 7500 을 썼다. 그 값은 1세대의 다른 전제들 위에서
     나온 것이라 여기 그대로 옮기지 않는다 — 이 엔진이 사격을 하게 되면 같은 로그로
     다시 역산하면 된다. `MEKAMI.md` 참고.) */
  /* 만충 기준값. **아레나 도구(nikke.top)의 자료로 확정했다** — 그쪽은 니케마다
     `baseChargeRate`(만충 대비 %)를 들고 있는데, 그 값이 CDN 의 `target_burst_energy_pershot`
     을 **정확히 200 으로 나눈 것**이다. 이름이 맞는 88명 중 86명에서 오차 0 (남은 둘은
     그쪽 오타 하나와 무기 교체 폼 하나). 나누는 수가 200 이라는 것은 곧 만충이
     **20,000** 이라는 뜻이다 — `perShot` 단위로는 10,000 이다.

     이 값은 **표적 하나당** 기준이다. 그쪽 모형의 뼈대가 `baseChargeRate × 표적 수`
     라서, 만충값과 표적 수는 반드시 짝으로 다뤄야 한다 (아래 `표적수`). */
  gaugeMax: 20000,
  /* 한 발이 동시에 닿는 표적 수. **게이지에만 곱하고 대미지에는 안 곱한다** — 이 도구의
     누적 대미지는 표적 하나에 들어간 양이다.

     이것이 자유 변수다. 만충값은 밖에서 확정됐으므로(위), 우리 영상이 재는 것은
     **만충 ÷ 표적 수 = 10,192** 쪽이다. 신데렐라 : CW 단독 영상에서 651발로 만충이
     됐고, 만충 20,000 을 넣으면 그 판의 표적 수가 **1.96** 으로 나온다. 기본값 2 는
     거기서 왔다 — 그 녹화의 표적이 한 발에 두 번 맞았다는 뜻이다.

     내용물마다 다르다. 아레나 도구가 무기군별로 이렇게 잡는다 (적 니케 5기 기준):
       AR·SMG·MG 1 · SG 10(펠릿) · SR 1~3(관통) · RL 2~9(폭발 범위)
     파츠가 여럿인 보스는 이보다 크다 — 하베스터 풀 스쿼드 영상은 3.5쯤을 가리킨다. */
  표적수: 2,
  /* 난수 씨앗. 크리티컬을 타격마다 굴리므로 이걸 고정해야 같은 입력이 같은 답을 준다. */
  seed: 1,
  /* 게이지가 차서 Ⅰ 이 켜지고, 사람이 그걸 누르기까지. **풀 스쿼드 영상 실측**이다
     (메커니즘 15). 만충은 아이콘 자리의 국소 흰 섬광으로, 누름은 화면 전체의 흰
     섬광으로 잡힌다. 10사이클에서 중앙 0.52초, 폭 0.17~0.98초.
     이 지연은 **첫 누름에만** 실린다 — Ⅱ·Ⅲ 은 연출이 끝나는 프레임에 이미 눌려
     있었다 (0.02초). 사람이 연출을 기다리는 것이지 그 반대가 아니다. */
  pressDelay: 0.52,
  /* 한 단계를 누르고 다음 단계를 누를 수 있게 되기까지 · Ⅲ 에서 풀버스트가 열리기까지.
     **둘 다 0 이다** — 그 사이를 채우는 것이 버스트 컷신인데, **컷신은 사이클에서 뺀다.**
     연출이 도는 동안은 전투가 흐르지 않으므로 시뮬레이션 시간에 넣을 것이 아니다.
     실측(메커니즘 16)으로는 벽시계 기준 Ⅰ→Ⅱ 1.60초 · Ⅱ→Ⅲ 1.43초 · Ⅲ→풀버스트
     1.45초가 들지만, 그 4.5초는 영상의 시간이지 전투의 시간이 아니다. 빼고 나면 영상의
     16.55초 사이클에서 충전 1.55 + 반응 0.52 + 풀버스트 10.00 = 12.07초가 남는다.
     설정으로 남겨 둔 이유는 값이 아니라 **자리**가 필요해서다 — 컷신 중에도 흐르는
     부분이 있다고 밝혀지면 여기에 그 몫만 넣는다 (OPEN M). */
  cutIn: 0,
  fbDelay: 0,

  /* ── 사격 (1세대에서 옮긴 실측값) ──────────────────────────

     여기 있는 숫자는 전부 **화면 녹화 실측**에서 나왔다 (`MEKAMI.md`). 규칙이 아니라
     관측이라 2세대에서 다시 유도할 이유가 없다. */

  /* 게임이 도는 프레임레이트. **한 프레임에 한 발**이 상한이라 MG 의 최고 연사를
     이게 정한다 (60fps -> 60발/초). CDN 의 4200 RPM(70발/초)은 60fps 기기에서 안
     나온다 — 탄창 300발이 6.52초, 평균 46.0발/초로 관측됐다. */
  fps: 60,
  /* 사격을 멈춘 뒤 남는 예열 비율. [멈춘 시간(초), 남는 비율] 을 이어 붙인 곡선이고
     값은 전부 실측이다. 사이는 선형으로 잇는다. */
  heatDecay: [[0, 1], [0.3, 1], [0.5, 0.39], [0.8, 0.25], [1.05, 0.13],
              [1.15, 0.03], [1.4, 0]],
  /* 재장전 앞뒤 모션. 제원의 재장전 시간에는 안 들어 있는데 그동안 총을 못 쏘고,
     예열도 그만큼 더 식는다. 재장전 **속도 증가의 영향을 안 받는** 고정 비용이다 —
     재장전을 아무리 줄여도 이 0.2초는 남는다. */
  reloadMotion: 0.2,
  control: 'auto',    // 'auto' | 'manual'
  chargeRatio: 1,     // 수동일 때 차지를 어디까지 끌지 (1 = 풀차지)
  /* 차트·스냅샷 표본 간격. 0 이면 안 뜬다. */
  sample: 0,
};

/* ── 비계 ──────────────────────────────────────────────────── */

/* 밖에서 명중을 찔러 넣는 통로.

     hits   투사체 명중 `{ t, id, bullets, kind }`

   **더 이상 비계가 아니다.** 사격이 들어와서 게이지는 이제 스스로 찬다. 이건 게이지
   하나만 따로 시험하려고 남긴 주입구다 — 사격·버프·체인을 다 켜 놓고는 "명중 두 번에
   얼마가 차는가" 같은 것을 못 본다.

   메커니즘 3 이 들어오면서 `burstAt`(체인을 여는 시각) 은 걷었다. */
const SCAFFOLD = { hits: null };

class Sim {
  constructor(opts) {
    this.o = { ...DEFAULTS, ...(opts.battle || {}) };
    this.scaffold = { ...SCAFFOLD, ...(opts.scaffold || {}) };
    this.t = 0;
    this.rand = rng(this.o.seed);
    this.queue = new Queue();
    this.log = [];
    this.warnings = [];

    this.enemy = { def: 0, 코어명중가능: false, 교전거리: null, ...(opts.enemy || {}) };
    this.actors = (opts.squad || []).map(s => makeActor(s));
    this.total = 0;
    this.series = [];
    this.snapshots = [];
    this.buffId = 0;
    this.enemyBuffs = [];
    this.enemyStates = new Map();       // 이름 -> 만료 시각 (기절·타겟 지정 …)
    this.squadShots = 0;
    /* 풀버스트가 열릴 때까지 붙잡아 두는 "추가 대미지" 타격 (메커니즘 10). */
    this.pendingRiders = [];
    /* 만충되고도 못 누른 시간들. 무엇이 사이클을 붙잡는지 가리는 데 쓴다. */
    this.waits = [];
    this.armedAt = null;

    /* 지금 도는 체인. `done` 은 이번 바퀴에 나간 단계, `used` 는 이번 바퀴에 쓴
       니케다 — 한 명이 두 자리를 겸할 수 없다. */
    this.chain = null;
    this.lastChain = null;
    this.chainCount = 0;
    this.armed = false;
    this.fullBurst = false;
    /* Ⅲ 을 누른 뒤 풀버스트가 열리기 전, 컷신이 도는 사이. 게이지 잠금만 이어 준다. */
    this.fbPending = false;
    /* 풀버스트가 열린 구간. [시작, 끝] 짝으로만 남긴다 — 시작과 끝을 따로 모아
       인덱스로 맞추면 전투가 풀버스트 중에 끝났을 때 짝이 어긋난다. */
    this.windows = [];
    /* 무효화된 체인. 실패도 결과다 — 몇 번 헛돌았는지 안 보이면 편성이 왜 나쁜지
       알 수가 없다. */
    this.voided = [];

    /* 버스트 게이지. **스쿼드가 하나를 공유한다** — 니케마다 따로 두면 "아군 전체에게
       게이지 충전" 같은 효과가 다섯 배가 된다. */
    this.gauge = 0;
    /* 잠긴 동안 버려진 명중 수. 게이지가 왜 안 차는지 따질 때 이 숫자가 먼저다. */
    this.wasted = 0;
    /* 누가 얼마를 벌었나. 실제로 게이지에 들어간 양만 센다 — 만충을 넘겨 버려진
       몫까지 세면 기여도가 거짓말이 된다. 평타와 스킬 투사체를 갈라 둔다. */
    this.charged = new Map(this.actors.map(a => [a.id, { bullet: 0, skill: 0 }]));
    /* 버스트 스킬 쿨타임. 니케 id -> 다시 쓸 수 있는 시각. */
    this.readyAt = new Map(this.actors.map(a => [a.id, 0]));
  }

  /* 효과 DSL(`effects.js`)이 "이번 바퀴에 버스트를 쓴 아군" 을 물어볼 때 보는 자리.

     2세대는 Ⅲ 을 누르는 순간 체인을 치우므로(메커니즘 10) `this.chain` 이 그때 null 이
     된다. 그런데 크라운의 1스킬처럼 **풀버스트 시작 시** "직전에 버스트를 쓴 아군" 을
     묻는 규칙이 있어서, 방금 끝난 바퀴를 다음 바퀴가 열릴 때까지 들고 있어야 한다. */
  get cycle() {
    return this.chain || this.lastChain
      || { index: -1, used: new Set(), steps: new Set(), step3: null };
  }

  /* 같은 경고를 수만 번 쌓지 않는다 — 사격마다 한 줄씩이면 목록을 못 읽는다. */
  once(msg) {
    if (!this.warnings.includes(msg)) this.warnings.push(msg);
  }

  /* ── 버프 ────────────────────────────────────────────── */

  /* 계열별로 합친 배수. 만료된 버프는 여기서 걷어낸다 — 만료마다 이벤트를 잡으면
     큐가 두 배로 붐비는데, 어차피 값을 읽을 때 확인하면 된다.

     여기까지가 1세대와 같다. 갈리는 것은 **이 버킷을 어느 칸에 넣느냐** 이고, 그건
     `bridge.next.js` 가 한다. */
  buckets(actor) {
    if (actor._at === this.t && actor._ver === actor.ver) return actor._buckets;
    const out = {};
    const keep = [];
    for (const b of actor.buffs) {
      if (b.until <= this.t) {
        this.log.push({ t: this.t, kind: 'buffEnd', actor: actor.id, stat: b.stat, from: b.source });
        continue;
      }
      keep.push(b);
      /* 중첩 배수는 걸 때 이미 값에 녹여 넣었다 (addBuff). 여기서 다시 곱하면
         받는 쪽 중첩을 세게 되어 시전자 기준이 무너진다. */
      out[b.stat] = (out[b.stat] || 0) + b.value;
      /* 장탄은 계열별로 따로 모은다 — 계열마다 기본 장탄수에 걸고 따로 반올림해야
         한다. 감소 버프도 같은 계열에 들어간다. */
      if (b.stat === 'maxAmmo') {
        out.ammoSeries = out.ammoSeries || {};
        out.ammoSeries[b.series] = (out.ammoSeries[b.series] || 0) + b.value;
      }
    }
    if (keep.length !== actor.buffs.length) { actor.buffs = keep; actor.ver++; }
    /* 레드 후드: "차지 속도 100% 초과 시 초과된 값을 차지 대미지로 변환".
       차지 속도는 시간만 줄여서 100% 위로는 버려지는데, 이 스킬이 주워 담는다. */
    if (out.chargeOverflow > 0) {
      const over = Math.max(0, (out.chargeSpeed || 0) - 1);
      if (over > 0) out.chargeDmg = (out.chargeDmg || 0) + over * out.chargeOverflow;
    }
    for (const b of this.enemyBuffs) {
      if (b.until > this.t) out[b.stat] = (out[b.stat] || 0) + b.value;
    }
    actor._buckets = out; actor._at = this.t; actor._ver = actor.ver;
    return out;
  }

  finalAtk(a) {
    const b = this.buckets(a);
    return a.stats.atk * (1 + (b.atkPct || 0)) + (b.atkFlat || 0);
  }

  /* "시전자 기준" 의 바탕이 되는 공격력. 최종 공격력과 달리 **남에게서 받은 고정
     가산(`atkFlat`)을 뺀다.**

     이걸 안 빼면 서로가 서로를 먹이는 되먹임이 생긴다 — 1세대가 그래서 164초에
     공격력 63배, 누적 대미지 7배까지 갔다. 퍼센트 버프는 시전자 자신에게 붙은
     배수라 고리를 안 만들므로 그대로 반영한다. */
  casterAtk(a) {
    return a.stats.atk * (1 + (this.buckets(a).atkPct || 0));
  }

  finalDef(a) {
    return a.stats.def * (1 + (this.buckets(a).defPct || 0));
  }

  /* `state` 는 이 버프를 준 **이름 있는 상태**다 (`[전투 보조 : …]`·`[나만의 별 : …]`).
     상태가 지워지면 그 상태가 준 버프도 같이 지워야 한다 — 이름만 지우고 버프를 남기면
     "삭제" 라고 적힌 원문과 어긋난다. */
  addBuff(target, spec, source, caster, state) {
    let stat = spec.stat, value = spec.value;
    /* "15.03% X 취기 중첩 수" 의 중첩은 **시전자** 것이다. 받는 쪽에서 세면 마스트
       말고는 취기가 0 이라 버프가 통째로 사라진다. */
    if (spec.perStack) value *= (caster || target).stackCount(spec.perStack);
    if (stat === 'atkFromCaster') {
      stat = 'atkFlat';
      value = this.casterAtk(caster || target) * value;
    }
    const until = !isFinite(spec.duration) ? Infinity : this.t + spec.duration;
    /* 지속시간은 **갱신**이지 중첩이 아니다. 같은 출처의 같은 스탯이 이미 붙어
       있으면 시간만 다시 채운다. 명시된 스택형만 따로 센다. */
    const same = target.buffs.find(b => b.source === source && b.stat === stat);
    if (same) { same.until = until; same.value = value; same.state = state; target.ver++; return; }
    target.buffs.push({ id: ++this.buffId, stat, value, until, source,
                        series: spec.series, state });
    target.ver++;
    this.log.push({ t: this.t, kind: 'buff', actor: target.id, stat, value, from: source });
  }

  /* ── 무기 ────────────────────────────────────────────── */

  /* 지금 이 니케가 쥐고 있는 무기. "사용 무기 변경" 이 걸려 있으면 그쪽이다.
     Step3 딜러의 상당수가 이 장치를 쓴다 — 무기가 바뀌면 배율·차지·장탄이 통째로
     달라지므로 제원을 읽는 자리를 전부 여기로 모은다. */
  shotOf(actor) {
    const w = actor.swap;
    if (!w) return actor.combat.shot;
    if (w.until <= this.t) {
      actor.swap = null;
      actor.ammo = Math.min(actor.ammo, this.ammoOf(actor));
      this.log.push({ t: this.t, kind: 'weapon', actor: actor.id, to: null });
      return actor.combat.shot;
    }
    return w.shot;
  }

  /* 예열 계단 수는 무기가 정한다 — 저격 모드로 바뀌면 램프가 통째로 사라진다. */
  heatMaxOf(actor) {
    const r = this.shotOf(actor).rof || {};
    return r.perShot ? Math.max(0, Math.ceil(((r.end || 0) - (r.start || 0)) / r.perShot)) : 0;
  }

  swapWeapon(actor, spec) {
    const base = actor.combat.shot;
    const shot = {
      ...base,
      charge: { ...base.charge },
      rof: { ...base.rof },
      ...(spec.damage != null ? { damage: spec.damage } : {}),
      ...(spec.maxAmmo != null ? { maxAmmo: spec.maxAmmo } : {}),
      ...(spec.reload != null ? { reload: spec.reload } : {}),
      ...(spec.coreDamage != null ? { coreDamage: spec.coreDamage } : {}),
    };
    if (spec.chargeTime != null) {
      shot.charge.time = spec.chargeTime;
      shot.control = spec.chargeTime > 0 ? 'charge' : 'normal';
    }
    if (spec.fullDamage != null) shot.charge.fullDamage = spec.fullDamage;
    if (spec.type) shot.types = [].concat(spec.type);
    actor.swap = { until: isFinite(spec.duration) ? this.t + spec.duration : Infinity, shot };
    /* 무기가 바뀌면 탄창은 새 무기 기준으로 채우고 예열은 처음부터다. */
    actor.ammo = this.ammoOf(actor);
    actor.heat = 0;
    this.log.push({ t: this.t, kind: 'weapon', actor: actor.id,
                    to: spec.label || '변경', until: actor.swap.until });
  }

  /* ── 게이지 ──────────────────────────────────────────── */

  /* **투사체가 적에게 명중할 때** 그 니케의 충전량이 들어온다. 발사가 아니라 명중이다.

     평타의 탄환이든 스킬의 투사체(슈팅 스타의 별사탕, 오토 파이어)든 똑같이 센다.
     세지 않는 것은 **이미 나간 총알에 얹히는 판정**이다 ("추가 대미지") — 그건 날아간
     투사체가 아니라서, 세면 그 한 발이 두 번 세어진다.

     `bullets` 는 그 명중이 투사체 몇 개인가 — 산탄은 한 번 방아쇠에 여러 발이 맞는다.
     지금은 부르는 쪽이 세어서 넘긴다 (사격 메커니즘이 아직 없다). */
  charge(actor, bullets = 1, kind = HIT.BULLET) {
    const per = this.gainOf(actor);
    if (!(per > 0)) {
      this.once(`${actor.name || actor.id}: 버스트 충전량을 모릅니다 (burstEnergy).`);
      return 0;
    }
    return this.chargeBy(actor, per * bullets, kind);
  }

  /* 이 니케가 투사체 하나로 버는 양. 충전 속도 버프는 **쏘는 사람** 것을 본다 —
     아니스 : 스타가 아군 전체에게 걸면 다섯 명의 사격이 전부 빨라진다.

     `perTargetShot` 을 쓴다. 199명 전원에서 `perShot` 의 정확히 두 배라 어느 쪽을
     쓰든 만충 기준값만 두 배가 될 뿐인데, 지금 쓰는 잠정 만충값(7500)이 이쪽 기준으로
     역산된 것이라 맞춰 둔다. */
  gainOf(actor, shot) {
    const be = (shot || (actor.combat && actor.combat.shot) || actor).burstEnergy || actor;
    const per = be.perTargetShot != null ? be.perTargetShot
      : (be.perShot != null ? be.perShot * 2 : actor.burstEnergy);
    if (!(per > 0)) return 0;
    /* **표적 수를 곱한다** (OPEN N). CDN 의 이름이 `target_burst_energy_pershot` 이라
       "표적마다" 로 읽히고, 파츠가 여럿인 보스에서는 한 발이 여러 표적에 닿는다.
       기본값 1 이면 지금까지와 똑같이 돈다 — 켜야만 달라진다.
       **대미지에는 안 곱한다.** 이 도구의 누적 대미지는 표적 하나에 들어간 양이다. */
    const 표적 = this.o.표적수 > 0 ? this.o.표적수 : 1;
    return per * 표적 * (1 + (this.buckets(actor).burstGaugeSpeed || 0));
  }

  /* 게이지에 실제로 얼마가 들어갔나. 잠금·만충을 여기서 한 번에 본다. */
  chargeBy(actor, amount, kind = HIT.BULLET) {
    /* **체인이나 풀버스트가 도는 동안에는 안 찬다** (메커니즘 6). 그동안의 명중은
       통째로 버려진다 — 무효가 된 체인이 쿨타임뿐 아니라 창 10초어치의 충전까지
       날리는 것이 이 때문이다. */
    if (this.chain || this.fullBurst || this.fbPending) {
      this.wasted += 1;
      return 0;
    }
    if (!(amount > 0)) return 0;
    const max = this.o.gaugeMax;
    if (!(max > 0)) {
      this.once('만충 수치(gaugeMax)를 안 정해 게이지가 차지 않습니다.');
      return 0;
    }
    const before = this.gauge;
    this.gauge = Math.min(max, this.gauge + amount);
    const got = this.gauge - before;
    const row = this.charged.get(actor.id);
    if (row) row[kind === HIT.SKILL ? 'skill' : 'bullet'] += got;
    if (got > 0) {
      this.log.push({ t: this.t, kind: 'charge', actor: actor.id, by: got,
                      from: kind, at: this.gauge });
      /* 만충되는 순간이 곧 Ⅰ 버튼이 켜지는 순간이다. */
      if (this.full) this.armButton();
    }
    return got;
  }

  get full() { return this.o.gaugeMax > 0 && this.gauge >= this.o.gaugeMax; }

  /* ── 크리티컬 ────────────────────────────────────────── */

  /* **타격 한 대마다 굴린다** (메커니즘 7). 기댓값으로 미리 섞지 않는다.

     확률을 모르면 지어내지 않는다 — 그림이 준 것은 크리 *대미지* 기본 50% 이고
     크리 *확률* 의 기본값은 아직 못 들었다. */
  rollCrit(actor) {
    const rate = actor.critRate;
    if (rate == null) {
      this.once(`${actor.name || actor.id}: 크리티컬 확률을 모릅니다 (critRate).`);
      return false;
    }
    return this.rand() < rate;
  }

  /* ── 버튼 ────────────────────────────────────────────── */

  /* 게이지가 찼다. 사람이 누르기까지 `pressDelay` 만큼 걸린다. */
  armButton() {
    /* 체인이 돌거나 풀버스트 중이면 버튼이 안 켜진다. 게이지가 그동안 잠겨 있으므로
       (메커니즘 6) 사실상 켜질 일도 없지만, 가드를 남겨 둔다. */
    if (this.chain || this.armed || this.fullBurst || this.fbPending) return;
    this.armed = true;
    this.armedAt = this.t;
    this.log.push({ t: this.t, kind: 'armed', at: this.gauge });
    this.queue.push(this.t + this.o.pressDelay, { kind: 'press', step: 'Step1' });
  }

  /* 이 단계를 낼 수 있는 니케. 이번 체인에 이미 쓴 사람은 뺀다.

     **순서가 곧 우선순위다** — 자동 전투에서는 왼쪽 칸이 먼저 쓰인다 (메커니즘 6).
     `filter` 가 스쿼드 순서를 지키고 아래 `find` 가 첫 번째를 집으므로, 스쿼드 배열의
     순서가 그대로 왼쪽부터의 자리 순서다. */
  candidates(step) {
    const used = this.chain ? this.chain.used : new Set();
    return this.actors.filter(a => this.canDoNow(a, step) && !used.has(a.id));
  }

  /* 단계는 고정값이 아니다 — 상태가 바꾼다 (아니스의 모두의 별이 자신을 1단계로,
     라피 : 레드 후드의 전투 보조도 마찬가지). 상태가 붙어 있는 동안만 유효하므로
     매번 지금 기준으로 본다. */
  stepOf(actor) {
    for (const name of actor.states) {
      const over = actor.stepStates.get(name);
      if (over) return over;
    }
    return actor.burst;
  }

  canDoNow(actor, step) {
    const now = this.stepOf(actor);
    return now === step || now === 'AllStep';
  }

  ready(actor) { return (this.readyAt.get(actor.id) || 0) <= this.t + 1e-9; }

  /* 이 니케가 아군 전체에게 주는 재진입 단계 (1·2·3). 없으면 null. */
  reentryOf(actor) {
    if (actor.reentryStep === undefined) actor.reentryStep = 재진입단계(actor.combat);
    return actor.reentryStep;
  }

  /* ── 체인 ────────────────────────────────────────────── */

  onPress(ev) {
    const step = ev.step;
    /* Ⅰ 누름에는 두 가지가 있다 — **체인을 여는 것**과 재진입으로 **체인 안에서 다시
       Ⅰ 로 돌아온 것**이다 (메커니즘 17). 앞엣것만 게이지를 쓰고 체인을 만든다.
       가르지 않으면 재진입한 Ⅰ 이 "이미 체인이 도는 중" 이라는 가드에 걸려 사라진다. */
    const 체인시작 = step === 'Step1' && !ev.inChain;
    if (체인시작) {
      if (this.chain || !this.full) return;      // 이미 도는 중이거나 게이지가 빠졌다
    } else if (!this.chain || this.chain.done.has(step)) {
      return;
    }

    const pool = this.candidates(step);
    const who = pool.find(a => this.ready(a));
    if (!who) {
      /* 누를 사람이 없다 — 전원 쿨타임이거나 애초에 그 단계가 없다. 쿨타임이
         풀리는 가장 이른 시각에 다시 본다. Ⅱ·Ⅲ 은 체인 창 안에서만 기다린다. */
      const next = Math.min(...pool.map(a => this.readyAt.get(a.id) || 0), Infinity);
      if (isFinite(next) && next > this.t
          && (체인시작 || next < this.chain.deadline)) {
        if (!체인시작) ev = { ...ev };
        this.queue.push(next, { kind: 'press', step, inChain: ev.inChain });
      }
      return;
    }

    if (체인시작) {
      /* **게이지는 여기서 소비된다.** 체인이 무효화돼도 0 부터 다시라는 것이
         그 뜻이다 — 누른 대가는 성패와 무관하게 치른다. */
      /* 만충되고도 못 누른 시간. 이게 길면 **쿨타임**이 사이클을 붙잡고 있다는 뜻이고,
         짧으면 **게이지**가 붙잡는다. 그 판정이 곧 "게이지 충전 서포터를 넣을 자리인가"
         라서 따로 센다. */
      if (this.armedAt != null) this.waits.push(this.t - this.armedAt);
      this.armedAt = null;
      this.gauge = 0;
      this.armed = false;
      this.chain = { index: this.chainCount++, done: new Set(), used: new Set(),
                     steps: new Set(), step3: null,
                     deadline: this.t + this.o.chainWindow, completed: false };
      /* 같은 객체를 들고 있는다 — Ⅲ 에서 `chain` 을 치워도 `lastChain` 으로 남아
         "직전에 버스트를 쓴 아군" 판정이 계속 선다. */
      this.lastChain = this.chain;
      this.log.push({ t: this.t, kind: 'chainStart', index: this.chain.index,
                      deadline: this.chain.deadline });
      this.queue.push(this.chain.deadline, { kind: 'chainEnd', index: this.chain.index });
    }

    /* **쿨타임은 쓰는 즉시 시작한다.** 체인이 무효화돼도 돌아간다. */
    const cd = who.burstCooldown;
    if (!(cd > 0)) this.once(`${who.name || who.id}: 버스트 쿨타임을 모릅니다 (burstCooldown).`);
    this.readyAt.set(who.id, this.t + (cd > 0 ? cd : 0));

    this.chain.done.add(step);
    this.chain.steps.add(step);
    this.chain.used.add(who.id);
    if (step === 'Step3') this.chain.step3 = who;
    this.log.push({ t: this.t, kind: 'burst', actor: who.id, step,
                    index: this.chain.index, readyAt: this.readyAt.get(who.id) });

    /* AllStep 니케는 어느 단계로 쓰였는지에 따라 버스트가 갈린다 (레드 후드). 효과의
       `if: { usedStep: 'Step3' }` 가 이 값을 본다. */
    who.usedStep = step;
    /* 버스트 스킬 본체가 여기서 터진다 — **풀버스트가 열리기 전이다.** 그래서 본체는
       +50% 를 못 받고 "추가 대미지" 만 받는다 (메커니즘 10). */
    this.fire('burstUse', who);
    /* 단계 진입은 쓴 사람이 아니라 스쿼드 전체에게 알린다 — 마스트의 취기가 "버스트
       1단계 진입 시" 쌓이는데 1단계를 쓴 건 아니스이기 때문이다. */
    const enter = `burstStep${step.slice(-1)}Enter`;
    for (const a of this.actors) this.fire(enter, a);

    /* **버스트 재진입** (메커니즘 17). 아군 전체에게 `[버스트 재진입 N단계]` 를 주는
       니케가 버스트를 쓰면, 체인이 다음 단계로 가는 대신 **N 단계로 되돌아간다.**
       조건만 맞으면 계속 되풀이되므로 한 체인이 Ⅰ-Ⅰ-Ⅱ-Ⅲ 처럼 길어질 수 있다.

       되돌아갈 자리를 **채울 사람이 있어야** 한다. 방금 쓴 본인은 쿨타임이 돌아 못
       쓰고 이번 체인에 이미 쓴 사람도 못 쓴다. 아무도 없으면 되돌아가 봐야 창만
       흘려보내므로 평소대로 다음 단계로 간다. */
    const 재진입 = this.reentryOf(who);
    let 되돌아갈 = null;
    if (재진입 != null) {
      const 자리 = 'Step' + 재진입;
      if (this.candidates(자리).some(a => this.ready(a))) 되돌아갈 = 자리;
    }

    if (되돌아갈) {
      /* 그 단계를 다시 누를 수 있게 열어 준다. */
      this.chain.done.delete(되돌아갈);
      /* **체인 10초는 재진입 버스트를 쓴 시점부터 새로 시작한다.** */
      this.chain.deadline = this.t + this.o.chainWindow;
      this.chain.reentries = (this.chain.reentries || 0) + 1;
      this.queue.push(this.chain.deadline,
                      { kind: 'chainEnd', index: this.chain.index });
      this.log.push({ t: this.t, kind: 'reentry', actor: who.id, to: 되돌아갈,
                      deadline: this.chain.deadline });
      this.queue.push(this.t + this.o.cutIn,
                      { kind: 'press', step: 되돌아갈, inChain: true });
    } else if (step === 'Step3') this.enterFullBurst(who);
    else {
      /* 다음 단계는 **컷신이 끝나야** 누를 수 있다 (메커니즘 15). 사람의 반응은 여기
         안 실린다 — 실측에서 Ⅱ·Ⅲ 은 연출이 끝나는 프레임에 이미 눌려 있었다. */
      this.queue.push(this.t + this.o.cutIn,
                      { kind: 'press', step: STEPS[STEPS.indexOf(step) + 1] });
    }
  }

  enterFullBurst(actor) {
    /* 길이는 **Ⅲ 을 쓴 니케**가 정한다 (5 / 10 / 15초). 데이터에 없으면 지어내지
       않고 경고한다 — 기본값 10초를 몰래 끼워 넣으면 15초짜리 니케의 결과가
       조용히 틀린다. */
    const dur = actor.burstDuration;
    if (!(dur > 0)) {
      this.once(`${actor.name || actor.id}: 풀버스트 길이를 모릅니다 (burstDuration).`);
      return;
    }
    /* 체인은 여기서 **끝난다.** 창 10초는 "그 안에 못 채우면 무효" 를 재는 자
       였지, 완성한 뒤에도 10초를 붙잡아 두는 것이 아니다 (열린 물음 A).
       그래서 `chainEnd` 가 나중에 와도 아무 일도 안 하도록 표시만 남긴다. */
    this.chain.completed = true;
    this.chain = null;
    /* Ⅲ 을 눌렀다고 풀버스트가 그 자리에서 열리지는 않는다 — 컷신이 `fbDelay` 만큼
       끼어든다 (메커니즘 15). 그동안 체인은 이미 치웠고 풀버스트는 아직 안 열렸으므로
       **게이지가 새는 구멍이 생긴다.** 영상에서는 그 1.45초 동안에도 BURST 막대가
       돌아오지 않았으니, 잠금을 이어 주는 표시를 따로 든다. */
    this.fbPending = true;
    const at = this.t + this.o.fbDelay;
    this.queue.push(at, { kind: 'fbStart', by: actor, dur });
    this.queue.push(at + dur, { kind: 'fbEnd' });
  }

  /* 체인 창이 끝났다. 셋을 못 채웠으면 통째로 무효다. */
  onChainEnd(ev) {
    const c = this.chain;
    /* 완성된 체인은 Ⅲ 에서 이미 치웠다. 여기 남아 있다는 것은 못 채웠다는 뜻이다. */
    if (!c || c.index !== ev.index) return;
    if (!c.completed) {
      const missing = STEPS.filter(s => !c.done.has(s));
      this.voided.push({ index: c.index, at: this.t, done: [...c.done], missing });
      this.log.push({ t: this.t, kind: 'chainVoid', index: c.index, missing });
      this.warnings.push(`${c.index + 1}번째 체인: ${missing.join('·')} 을 `
        + `${this.o.chainWindow}초 안에 못 눌러 무효가 됐습니다 `
        + `(${[...c.done].join('·') || '아무것도'} 만 나갔고 쿨타임은 돕니다).`);
    }
    this.chain = null;
    /* 풀버스트가 안 열렸으니 미뤄 둔 리더는 보너스 없이 그냥 때린다 — 스킬을 쓴
       것은 사실이라 타격 자체가 사라지지는 않는다. */
    this.flushRiders();
    /* 게이지는 이미 Ⅰ 에서 0 이 됐다. 그새 다시 찼으면 곧바로 버튼이 켜진다. */
    if (this.full) this.armButton();
  }

  onFullBurst(on, ev) {
    this.fullBurst = on;
    if (on) this.fbPending = false;      // 컷신이 끝나 잠금이 풀버스트로 넘어간다

    if (on) this.windows.push({ from: this.t, to: null, by: ev.by.id, dur: ev.dur });
    else {
      const w = this.windows[this.windows.length - 1];
      if (w && w.to == null) w.to = this.t;
    }
    this.log.push({ t: this.t, kind: on ? 'fbStart' : 'fbEnd' });
    for (const a of this.actors) this.fire(on ? 'fullBurstStart' : 'fullBurstEnd', a);
    /* 풀버스트가 열렸으니 미뤄 둔 "추가 대미지" 를 지금 때린다. 진입 버프가 먼저
       걸리고 그 위에서 때리는 순서다. */
    if (on) this.flushRiders();
    /* **풀버스트가 끝나는 즉시 게이지는 0 부터 다시 시작한다** (메커니즘 6).
       그 전까지는 잠겨 있었으므로 실제로는 이미 0 이지만, 규칙을 코드에 그대로
       적어 두는 편이 나중에 읽을 때 헷갈리지 않는다. */
    if (!on) {
      this.gauge = 0;
      this.log.push({ t: this.t, kind: 'gaugeReset' });
    }
  }

  /* ── 트리거 ──────────────────────────────────────────── */

  fire(trigger, actor, extra = {}) {
    /* 이 트리거가 이 니케에게 몇 번째로 걸리는지. "[시작 횟수 별 효과]" 처럼 발동
       횟수에 따라 커지는 효과가 이 수를 본다 (리타·2B·도라…). */
    const nth = (actor.fired.get(trigger) || 0) + 1;
    actor.fired.set(trigger, nth);
    for (const rule of actor.effects.rules) {
      if (!rule.on.includes(trigger)) continue;
      if (rule.nth > nth) continue;
      if (trigger === 'shots' && !this.shotHit(actor, rule)) continue;
      if (trigger === 'squadShots' && !this.squadShotHit(actor, rule)) continue;
      if (!meets(rule.when, actor, this)) continue;
      /* 전투 중 N회 제한. 조건을 통과한 뒤에 센다 — 조건이 안 맞아 안 터진 것을
         썼다고 치면 실제보다 일찍 소진된다. */
      if (rule.limit > 0) {
        const used = actor.used.get(rule) || 0;
        if (used >= rule.limit) continue;
        actor.used.set(rule, used + 1);
      }
      this.applyRule(rule, actor, { ...extra, trigger });
    }
  }

  /* "일반 공격 N회 공격 시". N 자체를 깎는 버프가 있어 발동 시점을 미리 정해 둘 수
     없고 매 발마다 지금 기준으로 따진다. */
  shotHit(actor, rule) {
    const need = Math.max(1, Math.round(rule.count + (this.buckets(actor).shotCondition || 0)));
    const done = actor.shotMark.get(rule) || 0;
    if (actor.counters.shots - done < need) return false;
    actor.shotMark.set(rule, actor.counters.shots);
    return true;
  }

  /* 스쿼드가 함께 세는 탄. 세는 대상만 다르고 짜임새는 위와 같다. */
  squadShotHit(actor, rule) {
    const need = Math.max(1, Math.round(rule.count));
    const done = actor.squadMark.get(rule) || 0;
    if (this.squadShots - done < need) return false;
    actor.squadMark.set(rule, this.squadShots);
    return true;
  }

  /* 상태 하나를 걷는다. **그 상태가 준 버프도 같이 지운다** — 원문의 "[나만의 별 삭제]"
     나 "[10초 유지]" 만료는 이름표만 떼라는 말이 아니라 그 상태로 받은 것을 되돌리라는
     말이다. 상태는 아군 전체에 걸릴 수 있으므로 전원에서 걷는다. */
  dropState(actor, name) {
    if (!actor.states.delete(name)) return 0;
    actor.stepStates.delete(name);
    actor.stateUntil.delete(name);
    let 지운수 = 0;
    for (const a of this.actors) {
      const before = a.buffs.length;
      a.buffs = a.buffs.filter(b => b.state !== name);
      if (a.buffs.length !== before) { a.ver++; 지운수 += before - a.buffs.length; }
    }
    this.log.push({ t: this.t, kind: 'state', actor: actor.id, state: name,
                    on: false, buffsDropped: 지운수 });
    return 지운수;
  }

  /* 지속시간이 끝났다. 그 사이에 다시 걸렸으면(시각이 갱신됐으면) 아무 일도 안 한다. */
  onStateEnd(ev) {
    if (ev.actor.stateUntil.get(ev.state) !== ev.until) return;
    this.dropState(ev.actor, ev.state);
  }

  applyRule(rule, actor, extra) {
    if (rule.set) {
      const okSet = rule.set.when ? meets(rule.set.when, actor, this) : true;
      if (okSet && rule.to === 'enemy') {
        const until = isFinite(rule.set.duration) ? this.t + rule.set.duration : Infinity;
        this.enemyStates.set(rule.set.state, until);
        this.log.push({ t: this.t, kind: 'enemyState', state: rule.set.state, until });
      } else if (okSet) {
        const name = rule.set.state;
        actor.states.add(name);
        if (rule.set.step) actor.stepStates.set(name, 'Step' + rule.set.step);
        /* **상태에도 지속시간이 붙는다** — 원문이 `[주목 : 적 전체 도발] [10초 유지]`
           처럼 적는다. `[지속]` 이면 Infinity 라 만료 이벤트를 안 건다.
           다시 걸리면 시각만 갱신하고, 만료 이벤트는 그때의 시각과 맞는 것만 실제로
           지운다 — 갱신 전에 걸어 둔 옛 이벤트가 새 상태를 지우면 안 된다. */
        const until = isFinite(rule.set.duration) ? this.t + rule.set.duration : Infinity;
        actor.stateUntil.set(name, until);
        if (isFinite(until)) {
          this.queue.push(until, { kind: 'stateEnd', actor, state: name, until });
        }
        this.log.push({ t: this.t, kind: 'state', actor: actor.id, state: name,
                        on: true, until });
      }
    }
    for (const name of rule.clear || []) this.dropState(actor, name);
    if (rule.stack) {
      const st = actor.stacks.get(rule.stack.name) || { count: 0, max: rule.stack.max };
      st.max = rule.stack.max;
      st.count = rule.stack.clear ? 0 : Math.min(st.max, st.count + rule.stack.add);
      actor.stacks.set(rule.stack.name, st);
      actor.ver++;                              // 중첩에 비례하는 버프가 다시 계산돼야 한다
      this.log.push({ t: this.t, kind: 'stack', actor: actor.id,
                      name: rule.stack.name, count: st.count });
    }

    const targets = rule.to === 'enemy' ? null : resolveTargets(rule.to, actor, this);
    /* 상태만 세우거나 걷는 규칙은 `apply` 가 없을 수 있다. `compile` 은 언제나 빈
       배열을 넣지만 손으로 쓴 규칙까지 그렇지는 않다. */
    for (const spec of rule.apply || []) {
      if (spec.instant) { this.instant(spec, actor, targets); continue; }
      if (targets === null) {
        this.enemyBuffs.push({ stat: spec.stat, value: spec.value,
                               until: isFinite(spec.duration) ? this.t + spec.duration : Infinity,
                               source: rule.where });
        continue;
      }
      /* 이 규칙이 상태를 세우면서 준 버프면 그 상태에 묶는다. */
      const 상태 = rule.set && rule.set.state ? rule.set.state : undefined;
      for (const target of targets) this.addBuff(target, spec, rule.where, actor, 상태);
    }

    if (rule.weapon) this.swapWeapon(actor, rule.weapon);
    if (rule.hit) {
      const 성격 = 타격성격(rule.hit);
      const label = rule.hit.label || rule.where;

      /* **"추가 대미지" 는 풀버스트가 열린 뒤에 때린다** (메커니즘 10).

         실측이 순서를 그대로 적어 뒀다 (arca 72959169):
           `3버스트 스킬 사용 → 기본 스킬 데미지 발동 → 풀 버스트 타임 시작
            → 조건부 추가 데미지 발동`

         그런데 효과표 26건 중 **12건이 `burstUse` 에 달려 있다.** 그대로 두면 풀버스트가
         열리기 전에 때려서 +50% 를 통째로 놓친다. 효과표를 고치는 대신 **엔진이 미룬다** —
         고쳐야 할 것은 규칙이 언제 발동하는가(버스트 사용 시)가 아니라 그 타격이 언제
         착탄하는가이기 때문이다. 같은 규칙의 버프는 지금 걸리고 타격만 미뤄진다. */
      if (성격.종류 === 종류.추가 && extra.trigger === 'burstUse') {
        this.pendingRiders.push({ actor, ratio: rule.hit.ratio, 성격, label,
                                  times: rule.hit.times, every: rule.hit.every });
        this.log.push({ t: this.t, kind: 'riderHeld', actor: actor.id, from: label });
        return;
      }

      for (let i = 0; i < rule.hit.times; i++) {
        /* 간격이 있으면 그 시각에 때린다. 한꺼번에 때리면 풀버스트 구간이 어긋나고,
           지속 중에 붙는 버프도 못 받는다. 슈팅 스타처럼 풀버스트를 가로지르는
           스킬은 **이 펴는 동작이 있어야** 메커니즘 10 이 제대로 걸린다. */
        if (rule.hit.every > 0 && i > 0) {
          this.queue.push(this.t + rule.hit.every * i,
                          { kind: 'tick', actor, ratio: rule.hit.ratio, 성격, label });
        } else {
          this.strike(actor, rule.hit.ratio, 성격, label);
        }
      }
    }
    if (extra.onRule) extra.onRule(rule);
  }

  /* 즉발 효과. 쿨타임 감소는 버프가 아니라 그 순간 남은 시간을 깎는 행위라, 버프로
     다루면 지속시간이 끝날 때 쿨타임이 되돌아가 버린다. */
  instant(spec, actor, targets) {
    /* "[버스트 게이지 충전 12%]" — 만충의 12% 다. 게이지는 스쿼드가 하나를 쓰므로
       "아군 전체에게" 라고 적혀 있어도 **한 번만** 찬다. */
    if (spec.stat === 'burstGauge') {
      this.chargeBy(actor, (this.o.gaugeMax || 0) * spec.value / 100, HIT.SKILL);
      return;
    }
    for (const target of targets || []) {
      if (spec.stat === 'burstCooldown') {
        const was = this.readyAt.get(target.id) || 0;
        this.readyAt.set(target.id, Math.max(this.t, was + spec.value));
        this.log.push({ t: this.t, kind: 'cooldown', actor: target.id, by: spec.value });
      }
    }
    /* 회복량 자체는 안 세지만 회복이 *일어났다*는 사실은 트리거가 된다. */
    if (spec.stat === 'heal') {
      this.log.push({ t: this.t, kind: 'heal', actor: actor.id });
      for (const a of this.actors) this.fire('healApplied', a);
    }
    /* 기절은 버프가 아니라 사격 자체를 멈춘다. */
    if (spec.stat === 'stun') {
      for (const target of targets || [actor]) {
        target.stunUntil = Math.max(target.stunUntil || 0, this.t + spec.value);
        this.log.push({ t: this.t, kind: 'stun', actor: target.id, until: target.stunUntil });
      }
    }
  }

  /* 미뤄 둔 "추가 대미지" 를 지금 때린다. 풀버스트가 열린 직후, 그리고 체인이
     무효가 됐을 때(그때는 풀버스트 없이) 부른다 — 스킬을 쓴 것은 사실이므로 타격
     자체가 사라지지는 않는다. */
  flushRiders() {
    const list = this.pendingRiders;
    this.pendingRiders = [];
    for (const r of list) {
      for (let i = 0; i < (r.times || 1); i++) {
        if (r.every > 0 && i > 0) {
          this.queue.push(this.t + r.every * i,
                          { kind: 'tick', actor: r.actor, ratio: r.ratio,
                            성격: r.성격, label: r.label });
        } else {
          this.strike(r.actor, r.ratio, r.성격, r.label);
        }
      }
    }
  }

  /* ── 타격 ────────────────────────────────────────────── */

  /* 한 대. 여섯 칸은 공식 모듈이, 버프 배치는 다리가 한다.

     크리는 **여기서 굴린다** (메커니즘 7). 타격마다 따로 굴러야 하므로 위에서 미리
     정해 넘기지 않는다. */
  strike(actor, 계수, 성격, source) {
    const buff = this.buckets(actor);
    const shot = this.shotOf(actor);
    const 크리 = this.rollCrit(actor);
    const 입력 = 여섯칸({
      buff, 성격, shot, 크리, 계수,
      공격력: actor.stats.atk,
      상황: {
        /* 적의 생김새 — 파츠 증댐·저지 부위 증댐이 걸릴지를 정한다. 때리는 쪽이
           아니라 상대가 정하는 조건이라 전투 조건으로 받는다. */
        파츠있음: !!this.enemy.파츠있음,
        저지부위있음: !!this.enemy.저지부위있음,
        풀버스트: this.fullBurst,
        적방어력: this.enemy.def,
        우월코드: !!actor.isElement,
        교전거리: this.enemy.교전거리,
        /* 코어에 닿는 적이면 평타는 전부 코어 명중이다 (메커니즘 13). 빈도를 따로
           두지 않으므로 이건 상한값이다. */
        코어명중가능: !!this.enemy.코어명중가능,
      },
    });
    /* 있을 수 없는 조합 — 버스트 본체가 풀버스트 중에 판정됐다. 순서를 어기면
       조용히 1.5배가 붙으므로 짚는다 (메커니즘 10). */
    if (입력.순서이상) {
      this.once(`${actor.name || actor.id}: 버스트 스킬 본체가 풀버스트 중에 판정됐습니다 `
        + '— 순서가 어긋났습니다.');
    }
    const r = 대미지(입력);
    if (r.방어초과 && !actor.warnedDef) {
      actor.warnedDef = true;
      this.warnings.push(`${actor.name || actor.id}: 유효 공격력이 0 이하입니다 `
        + `(적 방어력 ${this.enemy.def}). 결과가 의미 없습니다.`);
    }
    actor.damage += r.값;
    actor.byKind[성격.종류] = (actor.byKind[성격.종류] || 0) + r.값;
    if (source) actor.bySource[source] = (actor.bySource[source] || 0) + r.값;
    if (크리) actor.crits++;
    actor.hits++;
    this.total += r.값;
    return r;
  }

  /* ── 사격 (1세대에서 옮긴 실측 기계장치) ───────────────── */

  /* 연사속도. 예열은 **시간이 아니라 발수** 기준이다 — 한 발 쏠 때마다 +100 RPM.
     시간 기준 램프와 달리 발수 기준은 스스로를 가속한다. */
  rof(actor) {
    const r = this.shotOf(actor).rof;
    return Math.min(r.start + r.perShot * actor.heat, r.end || r.start);
  }

  /* 냉각. 사격을 멈추는 순간 0 이 되지도, 계속 남아 있지도 않는다 — 실측한 곡선을
     그대로 쓴다 (0.3초까지 유지, 0.5초 39%, 1.0초 13%, 1.4초 0).

     남는 양을 **비율**로 다루는 이유: 실측은 전부 최고 열에서 잰 것이라 부분적으로
     달아오른 상태에서 어떻게 식는지는 모른다. 비율이면 어느 높이에서 멈추든 같은
     모양으로 식어서, 아는 것만큼만 말하는 셈이 된다. */
  reheat(actor) {
    if (actor.lastShotAt < 0 || !actor.heat) return;
    if (!this.heatMaxOf(actor)) { actor.heat = 0; return; }
    const gap = this.t - actor.lastShotAt;
    const curve = this.o.heatDecay;
    if (!curve || !curve.length) return;
    let keep = curve[curve.length - 1][1];
    for (let i = 1; i < curve.length; i++) {
      const [t0, k0] = curve[i - 1], [t1, k1] = curve[i];
      if (gap <= t1) {
        keep = t1 === t0 ? k1 : k0 + (k1 - k0) * (gap - t0) / (t1 - t0);
        break;
      }
    }
    /* 소수로 남긴다. 내림하면 1.15~1.4초 구간이 "완전 초기화" 와 구별되지 않는데,
       실측은 1.13초에서 열 1.4 를 봤다. */
    actor.heat = Math.max(0, actor.heat * keep);
  }

  scheduleShot(actor) {
    if (actor.state === 'reloading') return;
    /* 기절 중에는 총을 못 쏜다. 풀린 뒤에 다시 잡는다 — 그동안 열은 유예를 넘겨
       식으므로 예열도 처음부터다. */
    if (actor.stunUntil > this.t) {
      this.queue.push(actor.stunUntil, { kind: 'wake', actor });
      return;
    }
    const shot = this.shotOf(actor);
    /* 냉각은 **다음 발을 잡을 때** 따져야 한다. 쏘는 순간에 따지면 그 발까지의
       간격을 이미 식기 전의 열로 계산한 뒤라, 재장전 직후 첫 발이 최고 연사로
       나가 버린다 (1세대에서 실효 연사가 9% 부풀었던 자리다). */
    this.reheat(actor);
    const b = this.buckets(actor);
    if (shot.control === 'charge') {
      const fix = b.chargeTimeFix;
      const base = fix != null ? fix : (shot.charge.time || 0);
      const ratio = this.o.control === 'manual' ? this.o.chargeRatio : 1;
      const wait = (base * ratio) / (1 + (b.chargeSpeed || 0));
      this.queue.push(this.t + wait, { kind: 'shot', actor, chargeRatio: ratio });
    } else {
      /* 한 프레임에 한 발이 상한이다. MG 는 4200 RPM(70발/초)까지 오르지만 60fps
         기기에서는 60발/초를 못 넘는다 — 실측으로 확인한 지점이다. */
      const floorGap = this.o.fps > 0 ? 1 / this.o.fps : 0;
      this.queue.push(this.t + Math.max(60 / this.rof(actor), floorGap),
                      { kind: 'shot', actor });
    }
  }

  onShot(ev) {
    const actor = ev.actor;
    const shot = this.shotOf(actor);

    /* 한 번 방아쇠를 당길 때 나가는 것 — 총구가 몇이고 그게 몇 조각으로 갈라지는가.

       CDN 의 `damage` 는 **총구당** 배율이다 (총구 둘인 니케는 값이 정확히 절반).
       반면 **분열(`shot_count`)은 대미지를 안 늘린다** — SG 배율에 10 을 곱하면 다른
       무기군의 14배가 된다. 게이지는 반대로 **발사체 하나하나가 센다.** */
    const muzzles = shot.pellets || 1;
    const bullets = muzzles * (shot.shotCount || 1);

    let ratio = (shot.damage / 100) * muzzles;
    /* 풀차지 배율은 **차지 칸**으로 갔다 (메커니즘 5). 여기서는 수동으로 끊었을 때의
       비율만 다룬다 — 자동이면 언제나 1 이라 차지 칸이 그대로 걸린다. */
    const chargeRatio = ev.chargeRatio == null ? 1 : ev.chargeRatio;

    const 성격 = 평타성격(shot, this.buckets(actor));
    /* 수동으로 끊으면 덜 당긴 만큼만 차지 칸을 받는다 — **칸을 버리는 것이 아니라
       비율을 건다** (메커니즘 5 의 차지 대조). 예전에는 `차지 = false` 로 칸을 통째로
       끄고 기본 대미지 쪽에 선형 보정을 넣었는데, 그러면 "차지 대미지 증가" 버프가
       한 톨도 안 걸려 톡톡이 운용의 값이 실제보다 낮게 나왔다. */
    if (shot.control === 'charge') 성격.차지비율 = chargeRatio;
    this.strike(actor, ratio, 성격, '평타');

    actor.lastShotAt = this.t;
    actor.heat = Math.min(actor.heat + 1 * (1 + (this.buckets(actor).spinupRate || 0)),
                          this.heatMaxOf(actor));
    actor.counters.shots++;
    actor.ammo--;
    this.squadShots++;

    /* **차지 여부는 발당 수급을 안 바꾼다** (메커니즘 12) — 끊어 쏘면 그만큼 빨리 찬다. */
    this.chargeBy(actor, this.gainOf(actor, shot) * bullets, HIT.BULLET);

    if (actor.charge && actor.counters.shots % actor.charge.per === 0) {
      actor.ammo = Math.min(actor.ammoMax, actor.ammo + actor.charge.amount);
    }

    this.fire('shots', actor);
    for (const a of this.squadShotWatchers) this.fire('squadShots', a);
    if (shot.control === 'charge' && chargeRatio >= 1) this.fire('fullChargeHit', actor);

    /* "마지막 탄환 명중 시" — 탄창을 비우는 그 한 발. 재장전을 걸기 전에 쏜다. */
    if (actor.ammo <= 0) this.fire('lastBullet', actor);

    if (actor.ammo <= 0) {
      actor.state = 'reloading';
      const b = this.buckets(actor);
      /* 재장전 시간은 **선형으로** 깎인다: 기본 × (1 − 재장전 속도). 그래서 재장전
         속도 100% 면 재장전이 0 이 되어 아예 안 한다 — 유저들이 "무한탄창" 이라
         부르는 지점이다. `기본 ÷ (1 + 속도)` 로 두면 100% 에서도 절반이 남는다.

         모션 0.2초는 재장전 속도의 영향을 안 받는 고정 비용이다. 그런데 0.2초는
         냉각 곡선의 유지 구간(0.3초) 안이라 **예열이 그대로 살아남는다** — MG 가
         무한탄창 조합을 원하는 진짜 이유다. */
      const reload = Math.max(0, (shot.reload || 0) * (1 - (b.reloadSpeed || 0)));
      this.queue.push(this.t + this.o.reloadMotion + reload, { kind: 'reload', actor });
      actor.counters.reloads++;
    } else {
      this.scheduleShot(actor);
    }
  }

  onReload(ev) {
    const actor = ev.actor;
    actor.state = 'firing';
    actor.ammo = this.ammoOf(actor);
    this.fire('reloadDone', actor);
    this.scheduleShot(actor);
  }

  /* 장탄수는 계열마다 따로 기본 장탄수에 걸고 따로 반올림한다. 전부 더해 한 번에
     반올림하면 1발이 어긋나는데, SR 6발·RL 5발에서는 그 1발이 DPS 를 10% 넘게 흔든다. */
  ammoOf(actor) {
    const series = { ...(actor.staticAmmo || {}) };
    const dyn = this.buckets(actor).ammoSeries || {};
    for (const k of Object.keys(dyn)) series[k] = (series[k] || 0) + dyn[k];
    actor.ammoMax = resolveAmmo(this.shotOf(actor).maxAmmo, series);
    return actor.ammoMax;
  }

  handle(ev) {
    switch (ev.kind) {
      case 'press': this.onPress(ev); break;
      case 'chainEnd': this.onChainEnd(ev); break;
      case 'stateEnd': this.onStateEnd(ev); break;
      case 'fbStart': this.onFullBurst(true, ev); break;
      case 'fbEnd': this.onFullBurst(false, ev); break;
      case 'shot': this.onShot(ev); break;
      case 'reload': this.onReload(ev); break;
      case 'wake': this.scheduleShot(ev.actor); break;
      /* 간격을 두고 펴 놓은 지속 타격 (슈팅 스타의 별사탕 40대 등). */
      case 'tick': this.strike(ev.actor, ev.ratio, ev.성격, ev.label); break;
      case 'interval':
        if (meets(ev.rule.when, ev.actor, this)) this.applyRule(ev.rule, ev.actor, {});
        this.queue.push(this.t + ev.rule.every, ev);
        break;
      case 'sample': this.sample(); break;
      case 'hit': {
        const actor = this.actors.find(a => a.id === ev.id);
        if (actor) this.charge(actor, ev.bullets, ev.hitKind);
        else this.once(`스쿼드에 없는 니케 '${ev.id}' 의 명중입니다.`);
        break;
      }
      default:
        this.warnings.push(`모르는 이벤트 '${ev.kind}' — 아직 안 만든 메커니즘입니다.`);
    }
  }

  /* 스쿼드가 애초에 Ⅰ·Ⅱ·Ⅲ 을 갖췄는가. 쿨타임과 무관한 편성 문제라 전투 시작에
     한 번만 본다 — 매 체인마다 말하면 같은 소리가 열 번 쌓인다. */
  coverage() {
    const have = new Set(this.actors.flatMap(a => STEPS.filter(s => canDo(a, s))));
    const missing = STEPS.filter(s => !have.has(s));
    if (missing.length) {
      this.warnings.push(`스쿼드에 ${missing.join('·')} 이 없어 풀버스트가 열리지 않습니다.`);
    }
    return !missing.length;
  }

  /* ── 표본 ────────────────────────────────────────────── */

  /* 차트와 버프 추적이 읽는 자료. 만료를 게으르게 걷어내는 구조라 로그만으로는
     "지금 붙어 있는 것" 이 정확하지 않다 — 스냅샷은 그 순간의 실제 상태다. */
  sample() {
    const dt = this.t - this.lastSample.t || 1;
    this.series.push({
      t: this.t,
      cum: this.total,
      dps: (this.total - this.lastSample.cum) / dt,
      fullBurst: this.fullBurst,
      gauge: this.o.gaugeMax ? this.gauge / this.o.gaugeMax : 0,
      armed: this.armed,
      heat: this.actors.map(a => {
        const max = this.heatMaxOf(a);
        return max ? a.heat / max : 0;
      }),
    });
    this.lastSample = { t: this.t, cum: this.total };
    if (this.o.snapshot) this.snapshots.push(this.snapOf());
  }

  /* 그 순간 누구에게 무엇이 걸려 있나. 버프를 **출처와 함께** 남기는 것이 핵심이다 —
     "공격력 +180%" 만 보면 한 줄인지 다섯 줄이 겹친 것인지 알 수가 없다. */
  snapOf() {
    return {
      t: this.t,
      fullBurst: this.fullBurst,
      gauge: this.o.gaugeMax ? this.gauge / this.o.gaugeMax : 0,
      armed: this.armed,
      enemy: {
        buffs: this.enemyBuffs.filter(b => b.until > this.t).map(b => ({
          stat: b.stat, value: b.value, source: b.source,
          until: isFinite(b.until) ? b.until : null,
        })),
        states: [...this.enemyStates].filter(([, u]) => u > this.t).map(([n]) => n),
      },
      actors: this.actors.map(a => ({
        id: a.id, name: a.name,
        atkBase: a.stats.atk,
        atk: this.finalAtk(a),
        buffs: a.buffs.filter(x => x.until > this.t).map(x => ({
          stat: x.stat, value: x.value, source: x.source, series: x.series,
          until: isFinite(x.until) ? x.until : null,
        })),
        buckets: { ...this.buckets(a) },
        states: [...a.states],
        stacks: Object.fromEntries([...a.stacks].map(([k, v]) => [k, v.count])),
        ammo: a.ammo, ammoMax: a.ammoMax,
        heat: this.heatMaxOf(a) ? a.heat / this.heatMaxOf(a) : null,
        stunned: (a.stunUntil || 0) > this.t,
        weapon: this.shotOf(a).weapon + (a.swap ? ' (변경)' : ''),
        damage: a.damage,
      })),
    };
  }

  run() {
    const end = this.o.seconds;
    this.lastSample = { t: 0, cum: 0 };
    if (this.actors.length !== 5) {
      /* 5인이 아니어도 돌리기는 한다 — 테스트에서 둘·셋만 세워 보는 일이 잦다.
         다만 게임의 편성은 5인이므로 그 사실을 알린다. */
      this.warnings.push(`스쿼드가 ${this.actors.length}명입니다 (게임 편성은 5명).`);
    }
    this.coverage();

    /* `squadShots` 를 보는 니케만 추려 둔다. 한 발마다 스쿼드 전원의 규칙을 훑으면
       5인 1만 발에서 그냥 다섯 배 낭비다. */
    this.squadShotWatchers = this.actors.filter(a =>
      a.effects.rules.some(r => r.on.includes('squadShots')));

    /* 전투 시작 효과는 **전원 먼저 걸고 나서** 총을 쏜다. 아니스·라피의 단계 판정이
       서로를 보므로 순서가 섞이면 결과가 달라진다. */
    for (const a of this.actors) this.fire('battleStart', a);
    for (const a of this.actors) {
      a.ammo = this.ammoOf(a);
      for (const rule of a.effects.rules) {
        if (rule.on.includes('interval') && rule.every > 0) {
          this.queue.push(rule.every, { kind: 'interval', actor: a, rule });
        }
      }
      /* 무기 제원이 있는 니케만 총을 쏜다 — 체인만 시험하는 테스트는 제원 없이 세운다. */
      if (this.shotOf(a).damage != null) this.scheduleShot(a);
    }

    if (this.o.sample > 0) {
      for (let x = this.o.sample; x <= end; x += this.o.sample) {
        this.queue.push(x, { kind: 'sample' });
      }
    }

    for (const h of this.scaffold.hits || []) {
      this.queue.push(h.t, { kind: 'hit', id: h.id, hitKind: h.kind || HIT.BULLET,
                             bullets: h.bullets == null ? 1 : h.bullets });
    }

    for (;;) {
      const ev = this.queue.pop();
      if (!ev || ev.t > end) break;
      this.t = ev.t;
      this.handle(ev);
    }
    /* 전투가 풀버스트 중에 끝났으면 그 구간은 전투 끝에서 잘린다. */
    const open = this.windows[this.windows.length - 1];
    if (open && open.to == null) open.to = end;

    const uptime = this.windows.reduce((s, w) => s + (w.to - w.from), 0);
    return {
      seconds: end,
      total: this.total,
      dps: end ? this.total / end : 0,
      byActor: this.actors.map(a => ({
        id: a.id, name: a.name,
        damage: a.damage,
        share: this.total ? a.damage / this.total : 0,
        byKind: { ...a.byKind },
        bySource: { ...a.bySource },
        shots: a.counters.shots, reloads: a.counters.reloads, ammo: a.ammoMax,
        /* 실제로 몇 대 중 몇 대가 크리였나. 씨앗을 바꿔 돌릴 때 편차가 어디서
           오는지 보려면 이 수가 있어야 한다. */
        hits: a.hits, crits: a.crits,
        critRate: a.hits ? a.crits / a.hits : 0,
      })),
      series: this.series,
      snapshots: this.snapshots,
      log: this.log,
      warnings: this.warnings,
      fullBurst: {
        windows: this.windows,
        count: this.windows.length,
        uptime,
        share: end ? uptime / end : 0,
        /* 풀버스트 시작 사이의 평균 — 이게 사이클 길이다. */
        avgCycle: this.windows.length > 1
          ? (this.windows[this.windows.length - 1].from - this.windows[0].from)
            / (this.windows.length - 1) : null,
        /* 만충되고도 못 누른 평균 시간. 누르기까지는 어차피 `pressDelay` 가 드니까
           그만큼 빼고 본다. */
        avgWait: this.waits.length
          ? this.waits.reduce((x, y) => x + y, 0) / this.waits.length : null,
        /* 무엇이 사이클을 붙잡는가. 쿨타임이면 게이지를 더 채워도 안 빨라진다. */
        bound: !this.waits.length ? null
          : (this.waits.reduce((x, y) => x + y, 0) / this.waits.length)
            - this.o.pressDelay > 0.05 ? 'cooldown' : 'gauge',
      },
      chains: {
        started: this.chainCount,
        completed: this.chainCount - this.voided.length,
        voided: this.voided,
      },
      gauge: {
        max: this.o.gaugeMax,
        at: this.gauge,
        /* 누가 사이클을 돌렸나. 대미지 비중과 다른 질문이고, 서포터를 고를 때는
           이쪽이 답이다. 평타로 버는지 스킬 투사체로 버는지도 갈라 둔다. */
        by: [...this.charged].map(([id, v]) => ({ id, ...v, charged: v.bullet + v.skill }))
          .sort((x, y) => y.charged - x.charged),
      },
      cooldown: [...this.readyAt].map(([id, t]) => ({ id, readyAt: t })),
      /* 잠긴 동안 버려진 명중. 게이지가 안 차는 이유를 따질 때 먼저 보는 숫자다. */
      wastedHits: this.wasted,
      /* 같은 씨앗이면 같은 답이 나온다. 결과에 실어 두면 나중에 재현할 수 있다. */
      seed: this.o.seed,
      mechanisms: LEDGER.map(m => m.name),
      /* 지시받지 않고 내가 고른 자리. 결과와 함께 나가야 읽는 사람이 어디까지
         믿을지 정할 수 있다. */
      open: OPEN,
      /* 근거가 모자란 채로 지금 계산에 쓰이고 있는 숫자. 화면이 "잠정" 을 달아 띄울
         수 있어야, 이 숫자에 기대어 내린 결론을 나중에 되짚을 수 있다. */
      /* `이름` 은 사람이 읽는 이름이고 실제로 붙잡은 설정은 `키` 다 — 하나의 잠정값이
         설정 여럿을 덮을 때가 있어 (컷신 길이가 `cutIn`·`fbDelay` 둘을 정한다) 이름을
         그대로 키로 쓰면 조회가 빗나간다. */
      잠정: 잠정.map(p => ({ ...p, 쓰는값: (p.키 || [p.이름]).map(k => this.o[k]).join(' · ') })),
    };
  }
}

/* ── 니케 한 명의 전투 상태 ────────────────────────────────── */

/* 스쿼드로 들어온 것은 **설정**이고, 전투 중에 변하는 것은 여기 붙인다. 원본을 안
   건드리는 이유는 같은 스쿼드로 여러 번 돌려 비교하기 때문이다 — 씨앗만 바꿔 돌린
   두 판이 서로의 상태를 물려받으면 비교가 성립하지 않는다. */
function makeActor(s) {
  const shot = (s.combat && s.combat.shot) || {};
  const a = {
    ...s,
    id: s.id,
    name: s.name || (s.combat && s.combat.name && s.combat.name.ko) || String(s.id),
    combat: s.combat || { shot: {} },
    effects: s.effects || { rules: [], unmodeled: [], problems: [] },
    stats: s.stats || { atk: 0, def: 0, hp: 0 },
    staticAmmo: s.staticAmmo || {},
    charge: s.ammoCharge || null,
    isElement: !!s.isElement,

    buffs: [], states: new Set(), stacks: new Map(), stepStates: new Map(),
    /* 상태마다 언제까지인지. `[지속]` 이면 Infinity. */
    stateUntil: new Map(),
    counters: { shots: 0, reloads: 0 },
    shotMark: new Map(), squadMark: new Map(), used: new Map(), fired: new Map(),
    /* 예열 계단 수는 올림이다. 4200 = 60 + 100×41.4 이라 41계단에서 멈추면 4160 에
       주저앉아 최고 연사에 영영 못 닿는다. 42계단째에 4260 을 넘어 4200 으로 잘리는
       게 맞고, 그래서 43발째에 최고 연사다. */
    heat: 0, lastShotAt: -1, state: 'firing', ammo: 0,
    ammoMax: shot.maxAmmo || 0, stunUntil: 0, swap: null,
    damage: 0, byKind: {}, bySource: {}, hits: 0, crits: 0,
    ver: 0, _ver: -1, _at: -1, _buckets: {},
    /* 중첩이 없으면 0 이다. 1 을 주면 "중첩 수에 비례" 하는 버프가 중첩 없이도
       한 겹 붙어 버린다. */
    stackCount(key) { const st = this.stacks.get(key); return st ? st.count : 0; },
  };
  /* 전투 시작부터 붙어 있는 것 — 오버로드 옵션·큐브·소장품. 스킬이 아니라 세팅이라
     효과표가 아니라 부르는 쪽이 계산해 넘긴다. */
  for (const b of s.staticBuffs || []) {
    a.buffs.push({ id: 0, stat: b.stat, value: b.value, until: Infinity,
                   source: b.source || '세팅', series: b.series || 'B' });
  }
  return a;
}

export function simulate(opts) {
  return new Sim(opts).run();
}

/* 테스트가 엔진을 직접 몰 수 있게 열어 둔다. 자라는 중인 엔진이라 결과 봉투만으로는
   중간 상태를 못 본다. */
export { Sim };
