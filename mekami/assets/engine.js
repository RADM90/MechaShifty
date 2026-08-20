/* 시간축 시뮬레이터 — 이벤트 큐. DOM 을 모른다.

   문서 §7.1 의 계산 파이프라인에서 5·6단계(버스트 사이클 / 타격 이벤트)를 맡는데,
   **둘을 한 큐에 올린다.** 따로 계산하면 MG 딜이 체계적으로 과대평가된다는 것이
   문서 §3.5.4 의 경고다. 예열이 풀버스트 10초의 3분의 1을 먹는데, 버스트 사이클을
   따로 세면 그 잠식이 계산에 안 잡힌다.

   틱이 아니라 이벤트인 이유: MG 는 최대 초당 70발이라 문서가 제안한 30 FPS 격자로는
   발사를 놓친다. 발사·차지·재장전은 정확한 시각에 처리하고, 표본(차트용)만 일정
   간격으로 뜬다.

   MG 예열은 **시간이 아니라 발수** 기준이다 (`rate_of_fire_change_pershot`, 발당
   +100 RPM). 시간 기준 램프와 달리 발수 기준은 스스로를 가속한다 — 빨라질수록 더
   빨리 빨라진다.

   예열과 프레임 상한, 냉각은 전부 **화면 녹화 실측**으로 확정했다 (MEKAMI.md 참고).
   60fps 녹화에서 잔탄 카운터를 프레임 단위로 읽어 발사 시각을 전부 뽑았다:

     · 램프는 CDN 값 그대로였다. 관측 간격 23·13·10·8·6·5·5·4·4·3 프레임이
       모델값 22.5·13.8·10.0·7.8·6.4·5.5·4.7·4.2·3.8·3.4 와 그대로 맞는다.
     · **최고 연사는 프레임레이트에 걸린다.** 한 프레임에 한 발까지라 60fps 기기에서
       60발/초가 상한이고, CDN 의 4200 RPM(70발/초)은 그 기기에서 안 나온다.
       탄창 300발이 6.52초, 평균 46.0발/초 — 커뮤니티가 말하는 45발/초가 이것이다.
     · **냉각은 1.4초 안에 완전히 식는다.** 0.3초까지는 거의 그대로, 0.5초에 39%,
       1.0초에 13%, 1.4초에 0. 재장전(2.5초)은 이보다 길어서 **재장전마다 완전
       초기화**된다 — 재장전 뒤 램프가 처음부터 다시 시작하는 것을 영상에서 확인했다.

   ── 버스트 사이클은 고정 길이가 아니다 ──────────────────────────

   니케라는 게임의 핵심은 주어진 시간 안에 **풀버스트를 몇 번 도느냐**다. 그래서
   사이클 길이를 입력으로 받아 20초마다 한 번씩 도는 것으로 근사하면, 이 시뮬레이터가
   답해야 할 질문을 미리 답으로 깔고 시작하는 셈이 된다. 아니스 : 스타를 넣어도 결과가
   1도 안 변한다면 — 그가 기용되는 이유의 절반이 버스트 게이지 충전 속도인데 — 그
   숫자는 볼 이유가 없다.

   그래서 게이지를 실제로 굴린다:

     · 발사 한 발마다 니케별 수급량이 쌓인다 (CDN `burst_energy_pershot`).
       **스킬·버스트 타격도 같이 번다** — 아래 '슈팅 스타' 참고
     · 만충되면 Ⅰ 을 누를 수 있다. **누르는 순간 게이지는 통째로 소비**되고,
       풀버스트가 끝날 때까지 다시 차지 않는다
     · Ⅰ·Ⅱ·Ⅲ 이 셋 다 쿨타임에서 풀려 있어야 누른다 — 하나라도 안 되면 그때까지
       만충인 채로 기다린다 (실제로 사람이 그렇게 한다)

   그러면 사이클 길이가 **결과**로 나온다. 바닥이 둘이라 — 게이지와 쿨타임 —
   어느 쪽이 붙잡고 있는지가 스쿼드마다 다르고, 게이지 충전 속도 버프는 게이지가
   붙잡을 때만 값을 한다. **어느 쪽인지 말해 주는 것이 이 도구가 할 일이다**
   (`burstReport().bound`).

   아니스 : 스타를 보면 그 구조가 그대로 드러난다. 1스킬이 쿨감 7.48초와 게이지
   충전 속도 6% 를 **같이** 주는데, 쿨감만 주면 바닥이 20초에서 12.5초로 내려가면서
   병목이 게이지 쪽으로 옮겨갈 뿐이기 때문이다. 둘을 같이 줘야 사이클이 실제로 준다.

   ── 슈팅 스타 — 스킬 타격이 게이지를 번다는 것을 왜 못 봤나 ──────

   아니스 : 스타의 슈팅 스타는 Ⅰ 을 쓴 직후 켜져 **10초**를 간다. 그런데 풀버스트도
   10초라, 보통 조합에서는 **별이 꺼진 뒤에 풀버스트가 끝난다.** 게이지는 Ⅰ 을 누른
   순간부터 풀버스트가 끝날 때까지 잠겨 있으므로, 별이 번 게이지는 통째로 잠금 구간
   안에서 사라진다. 2분 협전 로그로 이 사실을 가릴 수 없었던 이유가 그것이다.

   드러나는 자리가 있다 — 이사벨은 3단계인데 **풀버스트가 5초**라, 잠금이 풀릴 때
   별사탕이 4~5초 남아 있다. 같은 스쿼드에서 이사벨(5초)과 신데렐라(10초)를 번갈아
   쓰면 바깥 조건을 하나도 안 바꾸고 그 차이만 볼 수 있다: 만충까지 2.59초 vs 4.71초.
   별을 빼면 그 배율이 1.82배에서 1.11배로 사라진다 (`mekami/test/shooting_star.js`).

   ── 만충 기준값 ────────────────────────────────────────────────

   `gaugeMax` 는 CDN 에 없다 — 발당 수급량만 준다. 그래서 **2분 협동 작전의 실제
   버스트 로그**로 역산했다 (`mekami/test/cycle.js`). 크라운/마스트 스쿼드가 9번 돈
   시각이 있고, 7500 으로 두면:

     · 사이클 13.22초 (실측 13.25초)
     · 9번 중 7번이 실측과 **같은 초**에 떨어진다. 최대 오차 1.0초 / 110초
     · 크라운이 44초·57초에 13초 간격으로 두 번 나오는 것까지 쿨타임 충돌 없이 성립

   모든 니케가 `target_burst_energy_pershot == 2 × burst_energy_pershot` 이라 둘 중
   어느 쪽을 쓰든 만충 값만 두 배가 될 뿐 **상대 비교는 바뀌지 않는다.** 밖으로
   빼 두었으니 다른 실측이 들어오면 그 값으로 바꾸면 된다. */

import { hitDamage, resolveAmmo, KIND } from './formula.js';
import { meets, resolveTargets } from './effects.js';

/* 지속시간이 없는 버프의 표식. Infinity 로 두면 만료 검사에서 저절로 빠진다. */
const FOREVER = Infinity;

const DEFAULTS = {
  seconds: 180,
  /* 'gauge' = 게이지를 실제로 굴려 사이클이 결과로 나온다 (기본).
     'fixed' = 예전 방식. `cycle` 초마다 한 번씩 무조건 돈다 — 회귀 대조용으로만 남긴다. */
  burstMode: 'gauge',
  gaugeMax: 7500,     // 만충 기준값 — 2분 협전 실측으로 맞췄다  [관측]
  cycle: 20,          // 'fixed' 일 때의 한 바퀴
  /* **사람이 버스트 버튼을 누르는 데 걸리는 시간.** 버튼이 켜지는 것을 보고 누르기까지,
     그리고 Ⅰ->Ⅱ->Ⅲ 를 연달아 누르기까지 매번 든다. 한 사이클에 세 번이라 0.2초여도
     0.6초가 붙는데, 13초짜리 사이클에서 5% 다 — 무시할 크기가 아니다.
     2분 협전 실측 로그와 맞춰 보면 0.23초다 (`mekami/test/cycle.js`). */
  reaction: 0.20,
  sample: 0.5,        // 차트 표본 간격
  control: 'auto',    // 'auto' | 'manual'
  chargeRatio: 1,     // 수동일 때 차지를 어디까지 끌지 (1 = 풀차지)
  /* 게임이 도는 프레임레이트. **한 프레임에 한 발**이 상한이라 MG 의 최고 연사를
     이게 정한다 (60fps -> 60발/초). 문서가 "MG DPS 는 기기 프레임에 크게 좌우된다"고
     한 것이 이 뜻이고, 실측으로 확인했다. 120fps 기기라면 CDN 의 70발/초가 다 나온다. */
  fps: 60,
  /* 사격을 멈춘 뒤 남는 예열 비율. [멈춘 시간(초), 남는 비율] 을 이어 붙인 곡선이고
     값은 전부 실측이다. 사이는 선형으로 잇는다. */
  heatDecay: [[0, 1], [0.3, 1], [0.5, 0.39], [0.8, 0.25], [1.05, 0.13],
              [1.15, 0.03], [1.4, 0]],
  /* 재장전 앞뒤 모션. 제원의 재장전 시간에는 안 들어 있는데 그동안 총을 못 쏘고,
     예열도 그만큼 더 식는다. 재장전 **속도 증가의 영향을 받지 않는** 고정 비용이라
     따로 둔다 — 재장전을 아무리 줄여도 이 0.2초는 남는다.
     실측 뒷받침: v2 의 재장전 구간이 2.65초였는데 제원은 2.50초다. */
  reloadMotion: 0.2,
  uptime: 1,          // 실전 보정. 기본 1 — 재장전·예열은 이미 시뮬레이션한다
  /* 발사·재장전 시각을 전부 남긴다. 수만 줄이 되므로 기본은 끔 — 왜 이 니케가
     이만큼밖에 못 쐈는지 따질 때와 타임라인을 그릴 때만 켠다. */
  trace: false,
  /* 표본 시각마다 **그 순간 누구에게 무엇이 걸려 있는지**를 통째로 찍는다.
     `log` 의 buff/buffEnd 로도 복원할 수는 있지만, 만료는 값을 읽을 때 게으르게
     걷어내므로 로그만으로는 "지금 붙어 있는 것" 이 정확하지 않다. 스냅샷은 그
     순간의 실제 상태라 어긋날 여지가 없다.

     대미지가 이상할 때 가장 먼저 봐야 하는 것이 이것이다 — 누적 숫자 하나만 보면
     어느 버프가 두 번 걸렸는지, 끝나야 할 것이 안 끝났는지 알 방법이 없다. */
  snapshot: false,
};

/* ── 최소 힙 ───────────────────────────────────────────────── */

/* 180초 5인이면 이벤트가 2만 개를 넘고, 버스트 순서를 60가지 비교하면 백만 단위가
   된다. 정렬 배열에 끼워 넣으면 O(n^2) 라 힙이 필요하다. */
class Queue {
  constructor() { this.a = []; this.seq = 0; }

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

  /* 같은 시각이면 넣은 순서대로. 버프가 붙기 전에 총알이 나가는 일이 없어야 한다. */
  before(x, y) { return x.t !== y.t ? x.t < y.t : x.seq < y.seq; }
}

/* ── 시뮬레이션 ────────────────────────────────────────────── */

class Sim {
  constructor(opts) {
    this.o = { ...DEFAULTS, ...(opts.battle || {}) };
    this.enemy = { def: 0, coreHitRate: 1, ...(opts.enemy || {}) };
    this.rotation = opts.rotation || [];
    this.t = 0;
    this.queue = new Queue();
    this.fullBurst = false;
    this.cycle = { index: -1, used: new Set(), steps: new Set(), step3: null };
    /* 버스트 게이지. `armed` 는 "만충돼서 Ⅰ 을 누르기로 했다" 는 뜻이고, 그때부터
       풀버스트가 끝날 때까지 게이지는 다시 차지 않는다. */
    this.gauge = 0;
    this.armed = false;
    this.cycleIndex = -1;
    this.cycles = [];
    this.squadShots = 0;
    this.enemyBuffs = [];
    this.enemyStates = new Map();       // 이름 -> 만료 시각 (기절·타겟 지정 …)
    this.log = [];
    this.trace = [];
    this.warnings = [];
    this.series = [];
    this.snapshots = [];
    this.total = 0;
    this.buffId = 0;

    this.actors = (opts.squad || []).map(s => makeActor(s));
  }

  /* ── 버프 ─────────────────────────────────────────────── */

  /* 계열별로 합친 배수. 만료된 버프는 여기서 걷어낸다 — 만료마다 이벤트를 잡으면
     큐가 두 배로 붐비는데, 어차피 값을 읽을 때 확인하면 된다. */
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
         한다 (문서 §3.3). 감소 버프도 같은 계열에 들어간다. */
      if (b.stat === 'maxAmmo') {
        out.ammoSeries = out.ammoSeries || {};
        out.ammoSeries[b.series] = (out.ammoSeries[b.series] || 0) + b.value;
      }
    }
    if (keep.length !== actor.buffs.length) { actor.buffs = keep; actor.ver++; }
    /* 레드 후드: "차지 속도 100% 초과 시 초과된 값을 차지 대미지로 변환".
       차지 속도 130% 면 초과분 30 에 변환 배수(240%)를 곱해 차지 대미지 +72%.
       차지 속도는 시간만 줄여서 100% 위로는 버려지는데, 이 스킬이 주워 담는다.
       버킷을 만들 때 섞어 두면 차지 레이어가 저절로 받는다. */
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

     이걸 안 빼면 서로가 서로를 먹이는 되먹임이 생긴다. 크라운이 자기 최종 공격력의
     N% 를 아군에게 주는데 그 최종 공격력에 아니스가 준 가산이 이미 들어 있고, 다음
     사이클에는 아니스가 그렇게 부푼 크라운의 몫까지 얹어 다시 준다. 예제 5인에서
     이 고리가 **사이클마다 배로 불어나 164초에 공격력이 63배**가 됐다.

     퍼센트 버프(`atkPct`)는 그대로 반영한다 — 그건 시전자 자신에게 붙은 배수라
     고리를 만들지 않고, 참조 계산기들이 크라운을 클래스별 비율(화력형 43% /
     지원형 53.75% / 방어형 64%)로 미리 환산해 둔 것과도 같은 크기가 된다. */
  casterAtk(a) {
    return a.stats.atk * (1 + (this.buckets(a).atkPct || 0));
  }

  finalDef(a) {
    return a.stats.def * (1 + (this.buckets(a).defPct || 0));
  }

  addBuff(target, spec, source, caster) {
    let stat = spec.stat, value = spec.value;
    /* "15.03% X 취기 중첩 수" 의 중첩은 **시전자** 것이다. 받는 쪽에서 세면 마스트
       말고는 취기가 0 이라 버프가 통째로 사라진다. 그리고 거는 순간의 중첩으로
       고정한다 — 지속시간이 정해진 버프라 중간에 중첩이 변해도 따라가지 않는다. */
    if (spec.perStack) value *= (caster || target).stackCount(spec.perStack);
    /* "시전자 기준 공격력 N% ▲" 는 받는 쪽이 아니라 **시전자의 공격력**에 비례한다.
       거는 순간의 시전자 공격력을 재서 고정 수치로 박아 둔다. */
    if (stat === 'atkFromCaster') {
      stat = 'atkFlat';
      value = this.casterAtk(caster || target) * value;
    }
    const until = spec.duration === FOREVER || !isFinite(spec.duration)
      ? FOREVER : this.t + spec.duration;

    /* 지속시간은 **갱신**이지 중첩이 아니다 (문서 §2.3). 같은 출처의 같은 스탯이
       이미 붙어 있으면 시간만 다시 채운다. 명시된 스택형만 따로 센다. */
    const same = target.buffs.find(b => b.source === source && b.stat === stat);
    if (same) { same.until = until; same.value = value; target.ver++; return; }

    target.buffs.push({ id: ++this.buffId, stat, value, until, source,
                        series: spec.series });
    target.ver++;
    this.log.push({ t: this.t, kind: 'buff', actor: target.id, stat, value, from: source });
  }

  /* ── 무기 ─────────────────────────────────────────────── */

  /* 지금 이 니케가 쥐고 있는 무기. "사용 무기 변경" 이 걸려 있으면 그쪽이다.

     Step3 딜러의 상당수가 이 장치를 쓴다 (라플라스·맥스웰·네온 : 블루 오션·
     신데렐라 : 크리스탈 웨이브·은화 : 택티컬 업·레드 후드…). 무기가 바뀌면
     배율·차지·장탄이 통째로 달라지므로, 제원을 읽는 자리를 전부 여기로 모은다.
     예전처럼 `actor.combat.shot` 을 직접 읽으면 바뀐 무기가 반쯤만 반영된다. */
  shotOf(actor) {
    const w = actor.swap;
    if (!w) return actor.combat.shot;
    if (w.until <= this.t) {
      actor.swap = null;
      /* 원래 무기로 돌아오면 탄창도 그 무기 기준으로 다시 잡는다. */
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
      /* 안 적힌 항목은 원래 무기를 그대로 쓴다. 원문이 바꾸는 것만 적는다. */
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
    /* 바뀐 무기의 평타가 다른 종류가 되는 경우 (은화 : 택티컬 업의 방어력 무시). */
    if (spec.type) shot.types = [].concat(spec.type);
    actor.swap = { until: isFinite(spec.duration) ? this.t + spec.duration : FOREVER, shot };
    /* 무기가 바뀌면 탄창은 새 무기 기준으로 채우고 예열은 처음부터다. */
    actor.ammo = this.ammoOf(actor);
    actor.heat = 0;
    this.log.push({ t: this.t, kind: 'weapon', actor: actor.id, to: spec.label || '변경',
                    until: actor.swap.until });
  }

  /* ── 트리거 ───────────────────────────────────────────── */

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
      this.applyRule(rule, actor, extra);
    }
  }

  /* "일반 공격 N회 공격 시". N 자체를 깎는 버프가 있다 (라피 : 레드 후드 버스트의
     "스킬2 발동 횟수 조건 60회 ▼"). 그래서 발동 시점을 미리 정해 둘 수 없고 매
     발마다 지금 기준으로 따진다. */
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

  applyRule(rule, actor, extra) {
    if (rule.set) {
      const ok = rule.set.when ? meets(rule.set.when, actor, this) : true;
      if (ok && rule.to === 'enemy') {
        /* 적에게 거는 상태는 한 곳에 모은다. 적이 하나라는 전제라 대상별로 나눌
           필요가 없고, 지속시간이 있으므로 만료 시각으로 들고 있는다. */
        const until = isFinite(rule.set.duration) ? this.t + rule.set.duration : Infinity;
        this.enemyStates.set(rule.set.state, until);
        this.log.push({ t: this.t, kind: 'enemyState', state: rule.set.state, until });
      } else if (ok) {
        actor.states.add(rule.set.state);
        /* "버스트 1단계로 변경" 처럼 상태가 단계를 바꾸는 경우. 상태가 붙어 있는
           동안만 유효하므로 상태 이름에 매달아 둔다. */
        if (rule.set.step) actor.stepStates.set(rule.set.state, 'Step' + rule.set.step);
        this.log.push({ t: this.t, kind: 'state', actor: actor.id, state: rule.set.state, on: true });
      }
    }
    for (const name of rule.clear || []) {
      if (actor.states.delete(name)) {
        this.log.push({ t: this.t, kind: 'state', actor: actor.id, state: name, on: false });
      }
    }
    if (rule.stack) {
      const st = actor.stacks.get(rule.stack.name)
        || { count: 0, max: rule.stack.max };
      st.max = rule.stack.max;
      st.count = rule.stack.clear ? 0 : Math.min(st.max, st.count + rule.stack.add);
      actor.stacks.set(rule.stack.name, st);
      actor.ver++;                              // 중첩에 비례하는 버프가 다시 계산돼야 한다
      this.log.push({ t: this.t, kind: 'stack', actor: actor.id,
                      name: rule.stack.name, count: st.count });
    }

    const targets = rule.to === 'enemy' ? null : resolveTargets(rule.to, actor, this);
    for (const spec of rule.apply) {
      if (spec.instant) { this.instant(spec, actor, targets); continue; }
      if (targets === null) {
        this.enemyBuffs.push({ stat: spec.stat, value: spec.value,
                               until: spec.duration === FOREVER ? FOREVER : this.t + spec.duration,
                               source: rule.where });
        continue;
      }
      for (const target of targets) this.addBuff(target, spec, rule.where, actor);
    }

    if (rule.weapon) this.swapWeapon(actor, rule.weapon);
    if (rule.hit) {
      const kind = rule.hit.kind === 'burst' ? KIND.BURST : KIND.SKILL;
      const label = rule.hit.label || rule.where;
      for (let i = 0; i < rule.hit.times; i++) {
        /* 간격이 있으면 그 시각에 때린다. 한꺼번에 때리면 풀버스트 +50% 를 받는
           구간이 어긋나고, 지속 중에 붙는 버프도 못 받는다. */
        if (rule.hit.every > 0 && i > 0) {
          this.queue.push(this.t + rule.hit.every * i,
                          { kind: 'tick', actor, hit: rule.hit, kindOf: kind, label });
        } else {
          this.strike(actor, rule.hit.ratio, kind, label, rule.hit.type,
                      rule.hit.gauge !== false);
        }
      }
    }
    if (extra.onRule) extra.onRule(rule);
  }

  /* 즉발 효과. 쿨타임 감소는 버프가 아니라 그 순간 남은 시간을 깎는 행위라, 버프로
     다루면 지속시간이 끝날 때 쿨타임이 되돌아가 버린다. */
  instant(spec, actor, targets) {
    /* "[버스트 게이지 충전 12%]" — 만충의 12% 다. 게이지는 스쿼드가 하나를 쓰므로
       "아군 전체에게" 라고 적혀 있어도 **한 번만** 찬다. 대상마다 걸면 5배가 된다.
       퍼센트로 적혀 있는 덕에 만충 기준값이 추정이어도 이 값 자체는 정확하다. */
    if (spec.stat === 'burstGauge') {
      actor.gaugeMade += this.addGauge(this.o.gaugeMax * spec.value / 100, actor.id);
      return;
    }
    for (const target of targets || []) {
      if (spec.stat === 'burstCooldown') {
        target.burstReadyAt = Math.max(this.t, target.burstReadyAt + spec.value);
        this.log.push({ t: this.t, kind: 'cooldown', actor: target.id, by: spec.value });
      }
    }
    /* 회복량 자체는 안 세지만 회복이 *일어났다*는 사실은 트리거가 된다
       (크라운 2스킬 — 회복 효과 적용 시 아군 전체 공격 대미지 ▲). */
    if (spec.stat === 'heal') {
      this.log.push({ t: this.t, kind: 'heal', actor: actor.id });
      for (const a of this.actors) this.fire('healApplied', a);
    }
    /* 기절은 버프가 아니라 사격 자체를 멈춘다. 마스트 : 로망틱 메이드의 숙취가
       풀버스트 종료마다 10초를 통째로 날리므로 딜에 그대로 반영돼야 한다. */
    if (spec.stat === 'stun') {
      for (const target of targets || [actor]) {
        target.stunUntil = Math.max(target.stunUntil || 0, this.t + spec.value);
        this.log.push({ t: this.t, kind: 'stun', actor: target.id, until: target.stunUntil });
      }
    }
  }

  /* ── 타격 ─────────────────────────────────────────────── */

  strike(actor, ratio, kind, source, type, gauge = true) {
    const buff = this.buckets(actor);
    const shot = this.shotOf(actor);
    /* 대미지 종류 전용 배수. "분배 대미지 ▲" 는 분배 공격에만, "발사체 부착
       대미지 ▲" 는 그 유탄에만 걸린다. 범용 버킷에 넣으면 스쿼드의 모든 타격이
       함께 올라가 버려 실제보다 크게 나온다. */
    const types = Array.isArray(type) ? type : type ? [type] : [];
    for (const t of types) ratio *= 1 + (buff[t] || 0);
    /* 방어력 무시는 배수만 받는 게 아니라 **뺄셈 방어력 자체를 건너뛴다.**
       고방어 적에서 판을 뒤집는 자리라 배수와 같이 다뤄야 한다. */
    const ignoreDef = types.includes('trueDmg');
    const r = hitDamage({
      atk: actor.stats.atk,
      ratio,
      kind,
      buff,
      ctx: {
        enemyDef: ignoreDef ? 0 : this.enemy.def,
        isElement: actor.isElement,
        fullBurst: this.fullBurst,
        inRange: actor.inRange,
        coreHitRate: this.enemy.coreHitRate,
        coreDamage: shot.coreDamage,
      },
    });
    if (r.underDefended && !actor.warnedDef) {
      actor.warnedDef = true;
      this.warnings.push(`${actor.name}: 유효 공격력이 0 이하입니다 (적 방어력 ${this.enemy.def}). `
                         + '결과가 의미 없습니다.');
    }
    /* **스킬·버스트 타격도 게이지를 번다.** 평타는 onShot 에서 이미 세므로 여기서는
       그 밖의 타격만 센다.

       이걸 로그로 확인할 수 없었던 이유가 있다. 아니스 : 스타의 슈팅 스타는 Ⅰ 을 쓴
       직후에 켜져 10초를 가는데, 풀버스트도 10초라 **별이 꺼진 뒤에 풀버스트가
       끝난다.** 게이지는 Ⅰ 을 누른 순간부터 풀버스트가 끝날 때까지 잠겨 있으므로,
       별이 번 게이지는 통째로 잠금 구간 안에서 사라진다.

       드러나는 조합이 있다 — 이사벨처럼 **풀버스트가 5초**인 3버를 쓰면 별사탕이
       4~5초 남은 채로 잠금이 풀려서, 게이지가 순식간에 찬다.

       한 타격이 버는 양은 그 니케의 발당 수급량으로 본다. 산탄 조각 수는 곱하지
       않는다 — 스킬 타격은 산탄이 아니다.

       다만 **"추가 대미지" 는 세지 않는다** (`hit.gauge: false`). 그건 날아가는
       발사체가 아니라 이미 나간 총알 한 발에 얹히는 판정이고, 세면 그 발이 평타와
       스킬로 두 번 세어진다. 원문이 `추가 대미지` 와 그냥 `대미지` 로 갈라 놓았다.
       `[미검증]` — MEKAMI.md 참고. */
    if (kind !== KIND.NORMAL && gauge) {
      const be = shot.burstEnergy || {};
      const per = be.perTargetShot != null ? be.perTargetShot : (be.perShot || 0) * 2;
      actor.gaugeMade += this.addGauge(per * (1 + (buff.burstGaugeSpeed || 0)));
    }

    actor.damage += r.value;
    actor.byKind[kind] = (actor.byKind[kind] || 0) + r.value;
    if (source) actor.bySource[source] = (actor.bySource[source] || 0) + r.value;
    this.total += r.value;
    return r;
  }

  /* ── 사격 ─────────────────────────────────────────────── */

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
    /* 소수로 남긴다. 내림하면 한 계단 미만이 통째로 사라져 1.15~1.4초 구간이
       "완전 초기화" 와 구별되지 않는데, 실측은 1.13초에서 열 1.4 를 봤다. 연사
       계산은 소수 열을 그대로 받아 처리한다. */
    actor.heat = Math.max(0, actor.heat * keep);
  }

  scheduleShot(actor) {
    if (actor.done || actor.state === 'reloading') return;
    /* 기절 중에는 총을 못 쏜다. 풀린 뒤에 다시 잡는다 — 그동안 열은 유예를 넘겨
       식으므로 예열도 처음부터다. */
    if (actor.stunUntil > this.t) {
      this.queue.push(actor.stunUntil, { kind: 'wake', actor });
      return;
    }
    const shot = actor.combat.shot;
    /* 냉각은 **다음 발을 잡을 때** 따져야 한다. 쏘는 순간에 따지면 그 발까지의
       간격을 이미 식기 전의 열로 계산한 뒤라, 재장전 직후 첫 발이 최고 연사로
       나가 버린다 (탄창당 1초씩 공짜로 벌어 실효 연사가 9% 부풀었다). */
    this.reheat(actor);
    const b = this.buckets(actor);
    if (shot.control === 'charge') {
      const fix = b.chargeTimeFix;
      const base = fix != null ? fix : (shot.charge.time || 0);
      const ratio = this.o.control === 'manual' ? this.o.chargeRatio : 1;
      const wait = (base * ratio) / (1 + (b.chargeSpeed || 0));
      this.queue.push(this.t + wait, { kind: 'shot', actor, chargeRatio: ratio });
    } else {
      /* 한 프레임에 한 발이 상한이다. MG 는 최고 4200 RPM(70발/초)까지 오르지만
         60fps 기기에서는 60발/초를 못 넘는다 — 실측으로 확인한 지점이다. */
      const floorGap = this.o.fps > 0 ? 1 / this.o.fps : 0;
      this.queue.push(this.t + Math.max(60 / this.rof(actor), floorGap),
                      { kind: 'shot', actor });
    }
  }

  onShot(ev) {
    const actor = ev.actor;
    if (actor.done) return;
    const shot = this.shotOf(actor);

    /* 한 번 방아쇠를 당길 때 나가는 것 — 총구가 몇이고 그게 몇 조각으로 갈라지는가.

       CDN 의 `damage` 는 **총구당** 배율이다. 총구가 둘인 니케(K·퀀시·노아…)는 값이
       정확히 절반으로 적혀 있고, 츠바이(SG)가 그 둘을 한 번에 보여 준다 — 총구 2 ×
       분열 5 = 발사체 10 으로 다른 SG 와 같고, 배율 100.75 × 2 = 201.5 로 역시 같다.

       반면 **분열(`shot_count`)은 대미지를 늘리지 않는다.** SG 배율에 10 을 곱하면
       초당 2572% 가 되어 다른 무기군(139~183%)의 14배가 된다. 산탄 전체의 배율이
       이미 그 값이라는 뜻이다.

       게이지는 다르다 — **발사체 하나하나가 센다.** 곱하지 않으면 SG 가 초당 49 로
       다른 무기군(329~448)의 7분의 1이 되는데, 곱하면 493 으로 제자리에 들어온다. */
    const muzzles = shot.pellets || 1;
    const bullets = muzzles * (shot.shotCount || 1);

    /* 풀차지 배율은 그 발의 계수라 ratio 에 곱한다. '차지 대미지 증가' 옵션은
       별도 레이어(formula.chargeLayer)라 여기 섞지 않는다. 수동으로 차지를 끊는
       경우의 대미지는 선형 보간으로 둔다 [추정] — 실제 곡선은 미검증이다. */
    let ratio = (shot.damage / 100) * muzzles;
    if (shot.control === 'charge') {
      const full = (shot.charge.fullDamage || 100) / 100;
      ratio *= 1 + (full - 1) * (ev.chargeRatio == null ? 1 : ev.chargeRatio);
    }
    /* 평타는 언제나 '일반 공격 대미지 배율'(SG·SMG 소장품)을 받고, 폭발 무기(RL)는
       평타 자체가 폭발이라 '발사체 폭발 대미지 ▲' 도 같이 받는다.
       "일반 공격을 방어력 무시 대미지로 적용"(은화 : 택티컬 업)이 걸려 있으면 평타의
       타입이 바뀌어 방어력 무시 배수를 받고 뺄셈 방어력도 건너뛴다. */
    const types = ['normalAtkPct', ...(shot.types || [])];
    if (shot.explosionRange > 0) types.push('explosionDmg');
    if (this.buckets(actor).normalAsTrue > 0) types.push('trueDmg');
    this.strike(actor, ratio, KIND.NORMAL, '평타', types);
    if (this.o.trace) {
      this.trace.push({ t: this.t, kind: 'shot', actor: actor.id,
                        heat: actor.heatMax ? actor.heat / actor.heatMax : 1,
                        fullBurst: this.fullBurst });
    }

    actor.lastShotAt = this.t;
    actor.heat = Math.min(actor.heat + 1 * (1 + (this.buckets(actor).spinupRate || 0)),
                          this.heatMaxOf(actor));
    actor.counters.shots++;
    actor.counters.coreHits += this.enemy.coreHitRate;
    actor.ammo--;
    this.squadShots++;

    /* 버스트 게이지. 수급량은 무기가 아니라 **니케마다** 다르다 (CDN 실값 — RL 이
       발당 280, MG 가 10). 충전 속도 버프는 쏘는 사람 것을 본다: 아니스 : 스타가
       아군 전체에게 걸면 다섯 명의 사격이 전부 빨라진다.

       `perTargetShot` 을 쓴다 — 우리 적은 정지한 표적 하나이고 모든 사격이 그에게
       맞는다는 전제다. `perShot` 은 199명 전원에서 정확히 절반이라, 그쪽을 쓰는 것은
       만충 기준값을 반으로 줄이는 것과 완전히 같다. */
    const be = shot.burstEnergy || {};
    const gain = be.perTargetShot != null ? be.perTargetShot : (be.perShot || 0) * 2;
    actor.gaugeMade += this.addGauge(
      gain * bullets * (1 + (this.buckets(actor).burstGaugeSpeed || 0)));

    if (actor.charge && actor.counters.shots % actor.charge.per === 0) {
      actor.ammo = Math.min(actor.ammoMax, actor.ammo + actor.charge.amount);
    }

    this.fire('shots', actor);
    /* "아군이 소비한 탄의 총합이 N발이 될 때 마다" — 스쿼드가 공유하는 카운터라
       쏜 사람이 아니라 그 규칙을 가진 니케에게 물어야 한다 (신데렐라 : 크리스탈
       웨이브·리틀 머메이드. 둘 다 그 대가로 버스트 게이지를 채운다). */
    for (const a of this.squadShotWatchers) this.fire('squadShots', a);
    if (shot.control === 'charge' && (ev.chargeRatio == null || ev.chargeRatio >= 1)) {
      this.fire('fullChargeHit', actor);
    }

    /* "마지막 탄환 명중 시" — 탄창을 비우는 그 한 발. 재장전을 걸기 전에 쏜다. */
    if (actor.ammo <= 0) this.fire('lastBullet', actor);

    if (actor.ammo <= 0) {
      actor.state = 'reloading';
      const b = this.buckets(actor);
      /* 재장전 시간은 **선형으로** 깎인다: 기본 × (1 − 재장전 속도).
         그래서 재장전 속도 100% 면 재장전이 0 이 되어 아예 안 한다 — 인게임에서
         검증된 사실이고, 유저들이 "무한탄창" 이라 부르는 게 이 지점이다.
         `기본 ÷ (1 + 속도)` 로 두면 100% 에서도 절반이 남아 그 규칙이 안 나온다.

         모션(앞뒤 0.1초씩)은 재장전 속도의 영향을 안 받는 고정 비용이라 따로 더한다.
         무한탄창이 돼도 이 0.2초는 남는데, 0.2초는 냉각 곡선의 유지 구간(0.3초)
         안이라 **예열이 그대로 살아남는다.** MG 가 이 조합을 원하는 진짜 이유다. */
      const reload = Math.max(0, (shot.reload || 0) * (1 - (b.reloadSpeed || 0)));
      const wait = this.o.reloadMotion + reload;
      this.queue.push(this.t + wait, { kind: 'reload', actor });
      actor.counters.reloads++;
      if (this.o.trace) {
        this.trace.push({ t: this.t, kind: 'reload', actor: actor.id, wait,
                          speed: b.reloadSpeed || 0, ammo: actor.ammoMax,
                          fullBurst: this.fullBurst });
      }
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

  /* 장탄수는 계열마다 따로 기본 장탄수에 걸고 따로 반올림한다 (문서 §3.3).
     전부 더해 한 번에 반올림하면 1발이 어긋나는데, SR 6발·RL 5발에서는 그 1발이
     DPS 를 10% 넘게 흔든다. */
  ammoOf(actor) {
    const series = { ...(actor.staticAmmo || {}) };
    const dyn = this.buckets(actor).ammoSeries || {};
    for (const k of Object.keys(dyn)) series[k] = (series[k] || 0) + dyn[k];
    actor.ammoMax = resolveAmmo(this.shotOf(actor).maxAmmo, series);
    return actor.ammoMax;
  }

  /* ── 버스트 게이지 ────────────────────────────────────── */

  /* 순서는 **되풀이되는 무늬**다. 3버가 둘이면 보통 두 사이클짜리 무늬를 적고
     그게 계속 돈다. 마지막 항목에 고정하면 40초 쿨인 니케를 매 사이클 부르게 돼
     절반이 쿨타임 경고로 날아간다. */
  planFor(index) {
    return this.rotation.length ? this.rotation[index % this.rotation.length] : null;
  }

  /* 게이지는 스쿼드가 **하나**를 공유한다. 화면 아래 바가 한 줄인 그것이라, 아군
     전체에게 거는 충전 효과도 5인분이 아니라 한 번만 찬다. */
  addGauge(amount, why) {
    if (this.o.burstMode !== 'gauge' || this.armed || !(amount > 0)) return 0;
    /* 실제로 들어간 양만 돌려준다. 잠겨 있거나 이미 만충이면 벌어도 버려지는데,
       그걸 기여도로 세면 "게이지를 가장 많이 번 니케" 가 거짓말이 된다 — 풀버스트
       안에서만 때리는 니케가 1등으로 올라온다. */
    const before = this.gauge;
    this.gauge = Math.min(this.o.gaugeMax, this.gauge + amount);
    if (why) this.log.push({ t: this.t, kind: 'gauge', by: why, at: this.gauge });
    if (this.gauge >= this.o.gaugeMax) this.arm();
    return this.gauge - before;
  }

  /* 만충. Ⅰ·Ⅱ·Ⅲ 이 **셋 다** 쿨타임에서 풀리는 시각까지 기다렸다가 누른다.
     Ⅰ 만 보고 눌러 버리면 Ⅱ 가 쿨일 때 게이지를 헛되이 태우게 되는데, 실제로
     사람은 그러지 않는다 — 만충인 채로 들고 있는다. */
  arm() {
    if (this.armed) return;
    const index = this.cycleIndex + 1;
    const plan = this.planFor(index);
    const gap = this.o.reaction;
    /* Ⅰ 을 누를 수 있게 되는 시각 = 게이지 만충과 셋의 쿨타임 중 가장 늦은 것.
       Ⅱ·Ⅲ 는 한 박자씩 뒤에 눌리므로 그만큼 일찍 풀려도 된다. 거기에 사람이
       반응하는 시간이 한 번 더 붙는다. */
    let at = this.t;
    if (plan) {
      ['step1', 'step2', 'step3'].forEach((step, i) => {
        const a = plan[step] && this.actors.find(x => x.id === plan[step]);
        if (a) at = Math.max(at, a.burstReadyAt - gap * i);
      });
    }
    at += gap;
    this.armed = true;
    this.cycles.push({ index, fullAt: this.t, startAt: null, fbStart: null, fbEnd: null });
    this.queue.push(at, { kind: 'cycle', index });
  }

  /* 풀버스트가 끝났거나 아예 열리지 못했다. 게이지가 0 에서 다시 찬다. */
  disarm() {
    this.armed = false;
  }

  onCycle(ev) {
    const plan = this.planFor(ev.index);
    this.cycleIndex = ev.index;
    this.cycle = { index: ev.index, used: new Set(), steps: new Set(), step3: null };
    const gauged = this.o.burstMode === 'gauge';
    if (gauged) {
      this.gauge = 0;                       // Ⅰ 을 누르는 순간 통째로 소비된다
      const row = this.cycles[this.cycles.length - 1];
      if (row && row.index === ev.index) row.startAt = this.t;
    } else {
      this.cycles.push({ index: ev.index, fullAt: null, startAt: this.t,
                         fbStart: null, fbEnd: null });
    }
    if (!plan) { if (gauged) this.disarm(); return; }

    const gap = this.o.reaction;
    ['step1', 'step2', 'step3'].forEach((step, i) => {
      const id = plan[step];
      if (!id) return;
      this.queue.push(this.t + gap * i, { kind: 'burst', id, step });
    });
    if (gauged) {
      /* 풀버스트가 못 열린 경우의 안전장치. Ⅲ 이 나갈 시각을 넉넉히 지나도 안
         열렸으면 게이지를 풀어 준다 — 안 그러면 한 번 실패한 뒤로 영영 안 찬다.
         1초 여유는 버스트 적용 지연(`burstApplyDelay`)보다 크게 잡은 것이다. */
      this.queue.push(this.t + gap * 2 + 1, { kind: 'cycleFail', index: ev.index });
    } else {
      this.queue.push(this.t + this.o.cycle, { kind: 'cycle', index: ev.index + 1 });
    }
  }

  /* 지금 이 니케가 낼 수 있는 버스트 단계.

     자리에 제약은 없다 — 어느 니케든 어느 슬롯에 들어간다. 제약은 **1·2·3단계가
     하나씩 갖춰져야 풀버스트가 돈다**는 것뿐이다. 그래서 3단계가 대부분 40초 쿨인
     탓에 3버를 둘씩 넣는다.

     단계를 바꾸는 스킬이 있어서 고정값이 아니다 (아니스의 모두의 별, 라피 : 레드
     후드의 전투 보조가 자신을 1단계로 내린다). `AllStep` 은 어느 단계든 된다. */
  stepOf(actor) {
    for (const name of actor.states) {
      const over = actor.stepStates.get(name);
      if (over) return over;
    }
    return actor.combat.burst;
  }

  onBurst(ev) {
    const actor = this.actors.find(a => a.id === ev.id);
    if (!actor) return;
    const step = this.stepOf(actor);
    const want = 'Step' + ev.step.slice(-1);
    if (step !== want && step !== 'AllStep') {
      this.warnings.push(`${actor.name}: ${want} 자리에 넣었지만 실제 단계는 ${step} 입니다.`);
      return;
    }
    if (this.t + 1e-9 < actor.burstReadyAt) {
      this.warnings.push(`${actor.name}: ${this.cycle.index + 1}번째 사이클에서 버스트가 `
                         + `쿨타임 중입니다 (${actor.burstReadyAt.toFixed(1)}초에 준비).`);
      return;
    }
    /* 쿨타임은 지속시간이 끝난 뒤가 아니라 **쓰는 즉시** 시작한다 (문서 §5.3). */
    actor.burstReadyAt = this.t + actor.burstCooldown;
    this.cycle.used.add(actor.id);
    this.fire('burstUse', actor);
    this.log.push({ t: this.t, kind: 'burst', actor: actor.id, step: ev.step });

    /* 단계 진입은 쓴 사람이 아니라 스쿼드 전체에게 알린다 — 마스트의 취기가
       "버스트 1단계 진입 시" 쌓이는데, 1단계를 쓴 건 아니스이기 때문이다. */
    const enter = `burstStep${ev.step.slice(-1)}Enter`;
    for (const a of this.actors) this.fire(enter, a);

    this.cycle.steps.add(ev.step);
    if (ev.step === 'step3') {
      /* 풀버스트는 1·2·3 이 **하나씩 다 나가야** 열린다. 순차 발동이 강제라
         Ⅰ 없이 Ⅱ 로 갈 수 없고, 하나라도 빠지면 그 사이클은 통째로 날아간다.
         3버가 대부분 40초 쿨이라 두 명씩 넣는 이유가 이것이다. */
      const missing = ['step1', 'step2'].filter(s => !this.cycle.steps.has(s));
      if (missing.length) {
        this.warnings.push(`${this.cycle.index + 1}번째 사이클: `
          + `${missing.join('·')} 이 안 나가 풀버스트가 열리지 않았습니다.`);
        return;
      }
      this.cycle.step3 = actor;
      /* 풀버스트 길이는 Ⅲ 를 쓴 니케가 정한다 (5 / 10 / 15초). */
      const at = this.t + (actor.combat.burstApplyDelay || 0);
      this.queue.push(at, { kind: 'fbStart' });
      this.queue.push(at + (actor.combat.burstDuration || 10), { kind: 'fbEnd' });
    }
  }

  onFullBurst(on) {
    this.fullBurst = on;
    this.log.push({ t: this.t, kind: on ? 'fbStart' : 'fbEnd' });
    const row = this.cycles[this.cycles.length - 1];
    if (row) { if (on) row.fbStart = this.t; else row.fbEnd = this.t; }
    /* 게이지는 풀버스트가 **끝나야** 다시 찬다. 버프를 걸기 전에 풀어 주면 이번
       풀버스트 마지막 순간의 사격이 다음 게이지에 들어가는데, 순서만 다를 뿐
       실제로도 그때부터 찬다. */
    if (!on) this.disarm();
    for (const a of this.actors) this.fire(on ? 'fullBurstStart' : 'fullBurstEnd', a);
  }

  /* 사이클 성적표. 이 도구가 답해야 할 질문이 "주어진 시간에 풀버스트를 몇 번
     도느냐" 라서, 누적 대미지만큼이나 큰 글씨로 나가야 하는 값이다.

     `bound` 는 무엇이 사이클을 붙잡고 있는지다. 게이지가 만충된 뒤 Ⅰ 을 누르기까지
     기다린 시간이 길면 **쿨타임**이 바닥이고 (그러면 충전 속도 버프는 헛돈다),
     기다림이 없으면 **게이지**가 바닥이다 (그러면 아니스 : 스타가 값을 한다). */
  burstReport(end) {
    const done = this.cycles.filter(c => c.startAt != null);
    const full = this.cycles.filter(c => c.fbStart != null);
    let uptime = 0;
    for (const c of full) uptime += (c.fbEnd == null ? end : c.fbEnd) - c.fbStart;
    /* 만충까지 걸린 시간 — 게이지가 바닥인지 보는 값. 첫 사이클은 전투 시작부터,
       그 뒤는 직전 사이클이 게이지를 놓아 준 시각(풀버스트 종료)부터 잰다. */
    const fills = [];
    let from = 0;
    for (const c of this.cycles) {
      if (c.fullAt != null && c.startAt != null) fills.push({ c, took: c.fullAt - from });
      from = c.fbEnd ?? c.startAt ?? from;
    }
    const waited = fills.reduce((s, f) => s + (f.c.startAt - f.c.fullAt), 0);
    const starts = full.map(c => c.fbStart);
    const gaps = starts.slice(1).map((t, i) => t - starts[i]);
    return {
      mode: this.o.burstMode,
      cycles: this.cycles,
      count: full.length,                       // 풀버스트 횟수
      attempts: done.length,                    // 버스트를 시작한 횟수
      uptime,                                   // 풀버스트에 머문 시간
      share: end ? uptime / end : 0,
      avgCycle: gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null,
      avgFill: fills.length
        ? fills.reduce((s, f) => s + f.took, 0) / fills.length : null,
      avgWait: fills.length ? waited / fills.length : null,
      /* 만충하고도 기다린 시간이 **반응 시간보다 길면** 쿨타임이 붙잡은 것이다.
         반응 시간은 어느 쪽이든 반드시 드는 값이라 빼고 봐야 한다. */
      bound: !fills.length ? null
        : waited / fills.length - this.o.reaction > 0.05 ? 'cooldown' : 'gauge',
      gaugeMax: this.o.gaugeMax,
    };
  }

  /* ── 들여다보기 ───────────────────────────────────────── */

  /* 그 순간의 상태를 통째로 뜬다. 버프 하나하나를 **출처와 함께** 남기는 것이
     핵심이다 — "공격력 +180%" 만 보면 그게 한 줄인지 세 줄이 겹친 것인지, 어느
     스킬이 범인인지 알 수가 없다.

     `atk` 은 버프까지 먹인 최종 공격력이고 `atkBase` 는 세팅만 먹인 값이다.
     둘의 비가 곧 "이 니케가 지금 몇 배로 부풀어 있는가" 다. */
  snapOf() {
    return {
      t: this.t,
      fullBurst: this.fullBurst,
      gauge: this.o.gaugeMax ? this.gauge / this.o.gaugeMax : 0,
      armed: this.armed,
      /* 적에게 걸린 것은 스쿼드가 함께 받으므로 따로 뜬다. 니케마다 복사해 두면
         "받는 대미지 ▲" 가 다섯 번 걸린 것처럼 보인다. */
      enemy: {
        buffs: this.enemyBuffs.filter(b => b.until > this.t).map(b => ({
          stat: b.stat, value: b.value, source: b.source,
          until: isFinite(b.until) ? b.until : null,
        })),
        states: [...this.enemyStates].filter(([, u]) => u > this.t).map(([n]) => n),
      },
      actors: this.actors.map(a => {
        const b = this.buckets(a);
        return {
          id: a.id, name: a.name,
          atkBase: a.stats.atk,
          atk: this.finalAtk(a),
          /* 자기 버프만. 적 디버프는 buckets 에 섞여 들어오지만 위에 따로 있다. */
          buffs: a.buffs.filter(x => x.until > this.t).map(x => ({
            stat: x.stat, value: x.value, source: x.source,
            series: x.series,
            until: isFinite(x.until) ? x.until : null,
          })),
          buckets: { ...b },
          states: [...a.states],
          stacks: Object.fromEntries([...a.stacks].map(([k, v]) => [k, v.count])),
          ammo: a.ammo, ammoMax: a.ammoMax,
          heat: this.heatMaxOf(a) ? a.heat / this.heatMaxOf(a) : null,
          stunned: (a.stunUntil || 0) > this.t,
          weapon: this.shotOf(a).weapon + (a.swap ? ' (변경)' : ''),
          damage: a.damage,
        };
      }),
    };
  }

  /* ── 실행 ─────────────────────────────────────────────── */

  run() {
    const end = this.o.seconds;

    for (const a of this.actors) {
      a.ammo = this.ammoOf(a);
      a.burstCooldown = (a.combat.skills.burst && a.combat.skills.burst.cooldown
        && a.combat.skills.burst.cooldown[(a.levels.burst || 10) - 1]) || 20;
    }
    /* 전투 시작 효과는 전원 먼저 걸고 나서 총을 쏜다. 아니스·라피의 단계 판정이
       서로를 보므로 순서가 섞이면 결과가 달라진다. */
    for (const a of this.actors) this.fire('battleStart', a);
    for (const a of this.actors) {
      for (const rule of a.effects.rules) {
        if (rule.on.includes('interval') && rule.every > 0) {
          this.queue.push(rule.every, { kind: 'interval', actor: a, rule });
        }
      }
      this.scheduleShot(a);
    }
    /* `squadShots` 를 보는 니케만 추려 둔다. 한 발마다 스쿼드 전원의 규칙을 훑으면
       5인 1만 발에서 그냥 다섯 배 낭비다. */
    this.squadShotWatchers = this.actors.filter(a =>
      a.effects.rules.some(r => r.on.includes('squadShots')));
    /* 게이지 방식이면 **전투 시작 시점의 게이지는 0** 이다. 첫 풀버스트는 게이지를
       채운 뒤에나 열린다 — 예전처럼 0초에 터뜨리면 첫 사이클을 공짜로 얻는다. */
    if (this.o.burstMode !== 'gauge') this.queue.push(0, { kind: 'cycle', index: 0 });
    for (let s = this.o.sample; s <= end; s += this.o.sample) {
      this.queue.push(s, { kind: 'sample' });
    }

    let last = { t: 0, cum: 0 };
    for (;;) {
      const ev = this.queue.pop();
      if (!ev || ev.t > end) break;
      this.t = ev.t;
      switch (ev.kind) {
        case 'shot': this.onShot(ev); break;
        case 'wake': this.scheduleShot(ev.actor); break;
        case 'tick':
          this.strike(ev.actor, ev.hit.ratio, ev.kindOf, ev.label, ev.hit.type,
                      ev.hit.gauge !== false);
          break;
        case 'reload': this.onReload(ev); break;
        case 'cycle': this.onCycle(ev); break;
        case 'cycleFail':
          if (this.cycle.index === ev.index && !this.cycle.step3) this.disarm();
          break;
        case 'burst': this.onBurst(ev); break;
        case 'fbStart': this.onFullBurst(true); break;
        case 'fbEnd': this.onFullBurst(false); break;
        case 'interval':
          if (meets(ev.rule.when, ev.actor, this)) this.applyRule(ev.rule, ev.actor, {});
          this.queue.push(this.t + ev.rule.every, ev);
          break;
        case 'sample': {
          const dt = this.t - last.t || 1;
          this.series.push({
            t: this.t,
            cum: this.total,
            dps: (this.total - last.cum) / dt,
            fullBurst: this.fullBurst,
            /* 만충인 채로 기다리는 동안(armed)에도 1 로 그린다 — 바가 꽉 차 있는데
               쿨타임 때문에 못 누르는 상태가 타임라인에서 보여야 한다. */
            gauge: this.armed ? 1 : (this.o.gaugeMax ? this.gauge / this.o.gaugeMax : 0),
            heat: this.actors.map(a => {
              const max = this.heatMaxOf(a);
              return max ? a.heat / max : 0;
            }),
          });
          if (this.o.snapshot) this.snapshots.push(this.snapOf());
          last = { t: this.t, cum: this.total };
          break;
        }
        default: break;
      }
    }

    /* 8단계 실전 보정. 기본 1.00 이다 — 재장전·예열·차지는 이미 시뮬레이션했으므로
       무기군 업타임 계수를 여기 또 곱하면 두 번 깎인다 (문서 §6.2). 엄폐 AI·타겟
       전환처럼 우리가 모델링하지 않는 손실만 사용자가 손으로 넣는다. */
    const k = this.o.uptime;
    const total = this.total * k;
    const total0 = this.actors.reduce((s2, a) => s2 + a.gaugeMade, 0);
    return {
      total,
      seconds: end,
      dps: total / end,
      byActor: this.actors.map(a => ({
        id: a.id, name: a.name, damage: a.damage * k,
        share: this.total ? a.damage / this.total : 0,
        byKind: mapValues(a.byKind, v => v * k),
        bySource: mapValues(a.bySource, v => v * k),
        shots: a.counters.shots, reloads: a.counters.reloads,
        ammo: a.ammoMax,
        /* 이 니케가 번 게이지. "누가 사이클을 돌리고 있는가" 는 대미지 비중과
           다른 질문이고, 서포터를 고를 때는 이쪽이 답이다. */
        gauge: a.gaugeMade, gaugeShare: total0 ? a.gaugeMade / total0 : 0,
      })),
      series: this.series.map(s => ({ ...s, cum: s.cum * k, dps: s.dps * k })),
      log: this.log,
      trace: this.trace,
      snapshots: this.snapshots,
      burst: this.burstReport(end),
      warnings: this.warnings.concat(this.actors.flatMap(a => a.effects.problems || [])),
      unmodeled: this.actors.flatMap(a =>
        (a.effects.unmodeled || []).map(text => ({ actor: a.name, text }))),
      stale: this.actors.filter(a => a.effects.stale).map(a => a.name),
      uptime: k,
    };
  }
}

function mapValues(o, f) {
  const out = {};
  for (const k of Object.keys(o)) out[k] = f(o[k]);
  return out;
}

function makeActor(s) {
  const shot = s.combat.shot;
  /* 계단 수는 올림이다. 4200 = 60 + 100×41.4 이라 41계단에서 멈추면 4160 에
     주저앉아 최고 연사에 영원히 못 닿는다. 42계단째에 4260 을 넘어 4200 으로
     잘리는 게 맞다 — 그래서 43발째에 최고 연사다. */
  const heatMax = shot.rof && shot.rof.perShot
    ? Math.max(0, Math.ceil(((shot.rof.end || 0) - (shot.rof.start || 0)) / shot.rof.perShot))
    : 0;
  const a = {
    id: s.id, name: s.name || (s.combat.name && s.combat.name.ko) || String(s.id),
    combat: s.combat, effects: s.effects || { rules: [], unmodeled: [], problems: [] },
    levels: s.levels || { s1: 10, s2: 10, burst: 10 },
    stats: s.stats,
    isElement: !!s.isElement,
    inRange: s.inRange !== false && !!(s.combat.range && s.combat.range[1] > 0),
    staticAmmo: s.staticAmmo || {},
    charge: s.ammoCharge || null,
    buffs: [], states: new Set(), stacks: new Map(), stepStates: new Map(),
    counters: { shots: 0, coreHits: 0, reloads: 0 },
    shotMark: new Map(), squadMark: new Map(), used: new Map(), fired: new Map(),
    heat: 0, heatMax, lastShotAt: -1, state: 'firing', ammo: 0, ammoMax: shot.maxAmmo,
    burstReadyAt: 0, burstCooldown: 20, stunUntil: 0,
    damage: 0, byKind: {}, bySource: {}, gaugeMade: 0,
    ver: 0, _ver: -1, _at: -1, _buckets: {},
    /* 중첩이 없으면 0 이다. 1 을 주면 "중첩 수에 비례" 하는 버프가 중첩 없이도
       한 겹 붙어 버린다. */
    stackCount(key) { const st = this.stacks.get(key); return st ? st.count : 0; },
  };
  /* 전투 시작 시점부터 붙어 있는 것들 — 오버로드 옵션·큐브·소장품·전초기지.
     스킬이 아니라 세팅이라 효과표가 아니라 호출하는 쪽이 계산해 넘긴다. */
  for (const b of s.staticBuffs || []) {
    a.buffs.push({ id: 0, stat: b.stat, value: b.value, until: FOREVER,
                   source: b.source || '세팅', series: b.series || 'B' });
  }
  return a;
}

export function simulate(opts) {
  return new Sim(opts).run();
}
