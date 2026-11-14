/* 니파고 - 경로 추천 엔진 (명세 22~23절).
   DOM 을 쓰지 않는다. 화면(nipago.js)은 worker.js 를 거쳐 부르고, 검증 스크립트는 직접 import 한다.

   구성
   1) 부위 하나의 MDP - 목표 옵션 집합 T(최대 3개)를 그 부위에 갖추는 기대 비용을 가치 반복으로 푼다.
      줄 상태 = 빈칸 / 무효 / 목표 k 의 (단계 구간, 충족 여부) + 영구 잠금.
      중복 방지 재추첨은 직전 단계의 확률에만 좌우되고, 확률은 구간(1~5·6~10·11~15) 안에서 같으므로
      이렇게 묶어도 이후 행동·비용·분포·판정이 같다 (23.8).
   2) 네 부위 배분 - 목표 개수를 부위별 T 로 나누는 경우 중 기대 비용 합이 최소인 것.
   3) 유지·적용 - 두 전체 상태의 남은 기대 비용을 비교한다 (23.5).
   (예산 안 완료 확률 - 몬테카를로 - 은 보유 재화 입력과 함께 뺐다.)
   부위 표는 목표 묶음(가중치·최소 단계)과 λ 만으로 정해진다. tools/nipago_tables.mjs 가 모든 묶음의
   최선 행동(정책)을 미리 풀어 data/nipago/ 에 싣고, 여기서는 그 정책을 한 번 평가만 한다.
   파일이 없거나 규칙이 바뀌었으면 가치 반복으로 직접 푼다.

   비용 기준은 M + λK. λ 는 숨은 환율이 아니라 사용자가 고른 재화 우선순위다 (22.6~22.7).
   어떤 λ 로 풀었든 기대 모듈과 기대 락키는 따로 다시 계산해서 낸다. */

import { SLOT_P, FIRST_LV, MAX_LV, MAX_PROTECT, tryCost, EFF_OPTS } from './rules.js';
import { effValue, effProfiles } from './effective.js';

/* 재화 우선순위 → λ (락키 1개를 모듈 몇 개로 볼지) */
export const LAMBDAS = { mod: 0.01, balanced: 0.1, key: Infinity };
export const PREFS = ['mod', 'balanced', 'key'];

/* 행동 목록 순서·상태 열거를 바꾸면 올린다 - 미리 푼 정책 파일과 맞지 않게 된다 */
export const ENGINE_VERSION = 1;

const NC = 4;                        // 목표 하나당 최대 단계 묶음 수
const BIG = 1e12;
const bandOf = lv => (lv <= 5 ? 0 : lv <= 10 ? 1 : 2);

/* 최소 단계 m 에서의 단계 묶음 - (구간, 충족) 쌍. m ≤ 1 이면 하나뿐이다. */
function classesFor(m, lp) {
  const list = [], of = new Array(MAX_LV + 1).fill(-1);
  for (let lv = 1; lv <= MAX_LV; lv++) {
    const band = m <= 1 ? 0 : bandOf(lv), sat = lv >= m;
    let c = list.findIndex(x => x.band === band && x.sat === sat);
    if (c < 0) { c = list.length; list.push({ band, sat, lvs: [], p: 0, pl: lp[lv - 1] }); }
    list[c].lvs.push(lv);
    list[c].p += lp[lv - 1];
    of[lv] = c;
  }
  const single = list.length === 1;
  /* 직전 묶음 pc 에서 같은 효과가 다시 나왔을 때 - 직전 단계 하나가 빠진다 */
  const dedup = list.map((prev, pc) => list.map((x, c) => {
    if (single) return 1;
    return (x.p - (c === pc ? prev.pl : 0)) / (1 - prev.pl);
  }));
  return { list, of, fresh: list.map(x => x.p), dedup, sat: list.map(x => x.sat) };
}

/* ── 1) 부위 하나의 MDP ─────────────────────────────────── */
/* targets: [{ w, m }] - 정규화된 순서. lam: λ. */
class PieceTable {
  /* policy: 미리 푼 최선 행동 번호 (this.states 순서, 255 = 행동 없음). 주면 평가만 한다. */
  constructor(D, targets, lam, policy = null) {
    this.D = D;
    this.K = targets.length;
    this.targets = targets;
    this.lam = lam;
    this.useKey = Number.isFinite(lam);
    this.cls = targets.map(t => classesFor(t.m, D.lp));
    this.NCODE = 2 + this.K * NC * 2;
    /* 목표 k 에 대응하는 실제 옵션 자리 - 가중치만 맞으면 어느 옵션이든 같다 */
    const used = new Set();
    this.tOpt = targets.map(t => {
      const i = D.opts.findIndex((o, j) => !used.has(j) && Math.abs(o.w - t.w) < 1e-9);
      used.add(i);
      return i;
    });
    this.tupleCache = new Map();
    this.policy = policy;
    this.build();
  }

  /* 미리 풀어 둘 정책 - this.states 순서 */
  exportPolicy() {
    const out = new Uint8Array(this.states.length);
    this.states.forEach((l, n) => {
      const b = this.best[this.idx(l)];
      out[n] = b >= 0 ? b : 255;
    });
    return out;
  }

  /* 줄 코드: 0 빈칸, 1 무효, 2 + ((k·NC + c)·2 + perm) */
  code(k, c, perm) { return 2 + ((k * NC + c) * 2 + (perm ? 1 : 0)); }
  dec(code) {
    if (code < 2) return { kind: code };
    const x = code - 2;
    return { kind: 2, k: Math.floor(x / (2 * NC)), c: Math.floor(x / 2) % NC, perm: x % 2 };
  }
  idx(l) { return l[0] + this.NCODE * (l[1] + this.NCODE * l[2]); }
  lines(i) { const N = this.NCODE; return [i % N, Math.floor(i / N) % N, Math.floor(i / (N * N))]; }

  validCode(code) {
    if (code < 2) return true;
    const d = this.dec(code);
    return d.k < this.K && d.c < this.cls[d.k].list.length;
  }

  isGoal(l) {
    const got = new Array(this.K).fill(false);
    for (const code of l) {
      if (code < 2) continue;
      const d = this.dec(code);
      if (this.cls[d.k].sat[d.c]) got[d.k] = true;
    }
    return got.every(Boolean);
  }

  /* 효과 변경에서 U 줄이 받을 (빈칸 / 무효 / 목표 k) 묶음의 분포.
     X: 보호된 줄이 가진 목표(비트). 같은 판 안에서 앞 줄이 가져간 옵션은 뒤 줄에서 빠진다. */
  tuples(U, X) {
    const key = U.reduce((a, i) => a | (1 << i), 0) | (X << 3);
    let out = this.tupleCache.get(key);
    if (out) return out;
    const acc = new Map();
    const opts = this.D.opts;
    const excl0 = new Set();
    this.tOpt.forEach((oi, k) => { if (X & (1 << k)) excl0.add(oi); });
    const rec = (j, excl, res, p) => {
      if (j === U.length) {
        const k = res.join(',');
        const e = acc.get(k);
        if (e) e.p += p; else acc.set(k, { r: res.slice(), p });
        return;
      }
      const sp = SLOT_P[U[j]];
      if (sp < 1) { res.push(-2); rec(j + 1, excl, res, p * (1 - sp)); res.pop(); }
      let sum = 0;
      for (let o = 0; o < opts.length; o++) if (!excl.has(o)) sum += opts[o].w;
      for (let o = 0; o < opts.length; o++) {
        if (excl.has(o)) continue;
        const k = this.tOpt.indexOf(o);
        excl.add(o);
        res.push(k >= 0 ? k : -1);
        rec(j + 1, excl, res, p * sp * opts[o].w / sum);
        res.pop();
        excl.delete(o);
      }
    };
    rec(0, excl0, [], 1);
    out = [...acc.values()];
    this.tupleCache.set(key, out);
    return out;
  }

  /* 상태 i 에서 가능한 행동 (23.2).
     보호는 목표 줄에만 건다 - 빈칸·무효를 지킬 이유가 없다. 보호하지 않는 영구 잠금은 해제한다. */
  actionsOf(l) {
    const out = [];
    const tl = [0, 1, 2].filter(i => l[i] >= 2);
    const subsets = [[]];
    for (const i of tl) for (const s of subsets.slice()) if (s.length < MAX_PROTECT) subsets.push([...s, i]);
    for (const P of subsets) {
      const mats = [[]];
      for (const i of P) {
        const held = this.dec(l[i]).perm;
        const next = [];
        for (const m of mats) {
          if (held) next.push([...m, 'held']);
          else {
            next.push([...m, 'perm']);
            if (this.useKey) next.push([...m, 'key']);
          }
        }
        mats.splice(0, mats.length, ...next);
      }
      const U = [0, 1, 2].filter(i => !P.includes(i));
      /* 수치 재설정은 보호하지 않은 미충족 목표 줄이 있어야 의미가 있다 */
      const resetOK = U.some(i => l[i] >= 2 && !this.cls[this.dec(l[i]).k].sat[this.dec(l[i]).c]);
      for (const mat of mats) {
        const protect = P.map((line, j) => ({ line, mat: mat[j] === 'key' ? 'key' : 'perm', fresh: mat[j] !== 'held' }));
        const cost = tryCost(protect, this.lam);
        const c = cost.mod + (cost.key ? (this.useKey ? this.lam * cost.key : BIG) : 0);
        /* 유지했을 때 남는 상태 - 새 영구는 남고, 락키와 해제한 영구는 없다 */
        const keep = l.map((code, i) => {
          if (code < 2) return code;
          const d = this.dec(code);
          const pj = P.indexOf(i);
          const perm = pj >= 0 && protect[pj].mat === 'perm';
          return this.code(d.k, d.c, perm);
        });
        const base = { P, U, protect, cost, c, keep: this.idx(keep), keepLines: keep };
        out.push({ ...base, kind: 'change' });
        if (resetOK) out.push({ ...base, kind: 'reset' });
      }
    }
    return out;
  }

  /* 결과 하나하나를 cb(p, 적용 상태) 로 넘긴다 */
  outcomes(l, a, cb) {
    const nl = a.keepLines.slice();
    if (a.kind === 'reset') {
      const parts = a.U.map(i => {
        if (l[i] < 2) return [[l[i], 1]];
        const d = this.dec(l[i]);
        const C = this.cls[d.k];
        return C.dedup[d.c].map((p, c) => [this.code(d.k, c, 0), p]).filter(x => x[1] > 0);
      });
      this.product(a.U, parts, nl, 1, cb);
      return;
    }
    let X = 0;
    for (const i of a.P) X |= 1 << this.dec(l[i]).k;
    for (const t of this.tuples(a.U, X)) {
      const parts = a.U.map((i, j) => {
        const r = t.r[j];
        if (r === -2) return [[0, 1]];
        if (r === -1) return [[1, 1]];
        const C = this.cls[r];
        const prev = l[i] >= 2 ? this.dec(l[i]) : null;
        const dist = prev && prev.k === r ? C.dedup[prev.c] : C.fresh;
        return dist.map((p, c) => [this.code(r, c, 0), p]).filter(x => x[1] > 0);
      });
      this.product(a.U, parts, nl, t.p, cb);
    }
  }

  product(U, parts, nl, p0, cb) {
    const rec = (j, p) => {
      if (j === U.length) { cb(p, this.idx(nl)); return; }
      for (const [code, p1] of parts[j]) { nl[U[j]] = code; rec(j + 1, p * p1); }
    };
    rec(0, p0);
  }

  build() {
    const N = this.NCODE;
    const states = [];
    for (let a = 2; a < N; a++) {   // 1번 줄은 늘 있다 - 빈칸은 1(무효)부터
      if (!this.validCode(a)) continue;
      for (let b = 0; b < N; b++) {
        if (!this.validCode(b)) continue;
        for (let c = 0; c < N; c++) {
          if (!this.validCode(c)) continue;
          const l = [a, b, c];
          const ks = l.filter(x => x >= 2).map(x => this.dec(x).k);
          if (new Set(ks).size !== ks.length) continue;
          states.push(l);
        }
      }
    }
    /* 1번 줄 무효 상태도 넣는다 */
    for (let b = 0; b < N; b++) for (let c = 0; c < N; c++) {
      if (!this.validCode(b) || !this.validCode(c)) continue;
      const l = [1, b, c];
      const ks = l.filter(x => x >= 2).map(x => this.dec(x).k);
      if (new Set(ks).size !== ks.length) continue;
      states.push(l);
    }

    this.states = states;
    const pol = this.policy;
    if (pol && pol.length !== states.length) throw new Error('policy size');

    const size = N * N * N;
    const V = new Float64Array(size).fill(BIG);
    const goal = new Uint8Array(size);
    const acts = new Array(size);
    const best = new Int32Array(size).fill(-1);
    states.forEach((l, n) => {
      const i = this.idx(l);
      if (this.isGoal(l)) { goal[i] = 1; V[i] = 0; return; }
      acts[i] = this.actionsOf(l);
      if (pol) {
        if (pol[n] !== 255 && pol[n] >= acts[i].length) throw new Error('policy index');
        best[i] = pol[n] === 255 ? -1 : pol[n];
      }
    });
    /* 충족 줄이 많은 상태부터 - 가우스-자이델이 빨리 닫힌다 */
    const score = l => l.reduce((a, x) => a + (x >= 2 ? (this.cls[this.dec(x).k].sat[this.dec(x).c] ? 2 : 1) : 0), 0);
    const order = states.filter(l => !goal[this.idx(l)]).sort((x, y) => score(y) - score(x));

    /* 행동 하나의 결과 분포를 한 번 펼쳐 같은 상태끼리 합친다 - 정책을 평가할 때는 상태당 한 번이면 된다 */
    const compiled = new Array(size);
    const compile = (l, i, a) => {
      if (compiled[i]) return compiled[i];
      const acc = new Map();
      this.outcomes(l, a, (p, j) => acc.set(j, (acc.get(j) || 0) + p));
      return (compiled[i] = { ps: Float64Array.from(acc.values()), vs: Int32Array.from(acc.keys()) });
    };
    let ps = [], vs = [];
    const raw = { ps: [], vs: [] };
    const q = (l, i, a, c = null) => {
      if (c) ({ ps, vs } = c);
      else {
        ps = raw.ps; vs = raw.vs; ps.length = 0; vs.length = 0;
        this.outcomes(l, a, (p, j) => { ps.push(p); vs.push(j); });
      }
      if (a.keep !== i) {
        const vk = V[a.keep];
        let s = a.c;
        for (let n = 0; n < ps.length; n++) s += ps[n] * Math.min(vk, V[vs[n]]);
        return s;
      }
      /* 유지하면 제자리 - 자기 고리를 풀어서 계산한다 */
      let t = V[i], r = Infinity;
      for (let it = 0; it < 4; it++) {
        let acc = a.c, stay = 0;
        for (let n = 0; n < ps.length; n++) {
          const v = vs[n] === i ? Infinity : V[vs[n]];
          if (v < t) acc += ps[n] * v; else stay += ps[n];
        }
        const nr = stay >= 1 - 1e-15 ? Infinity : acc / (1 - stay);
        if (nr >= r - 1e-12) break;
        r = nr; t = Math.min(t, r);
      }
      return r;
    };

    for (let sweep = 0; sweep < 400; sweep++) {
      let diff = 0;
      for (const l of order) {
        const i = this.idx(l);
        let bv = Infinity, ba = -1;
        if (pol) {
          /* 정해진 정책 - 그 행동 하나만 평가한다 */
          ba = best[i];
          if (ba >= 0) bv = q(l, i, acts[i][ba], compile(l, i, acts[i][ba]));
        } else {
          acts[i].forEach((a, n) => {
            const v = q(l, i, a);
            if (v < bv - 1e-12) { bv = v; ba = n; }
          });
        }
        if (bv < V[i]) {
          diff = Math.max(diff, (V[i] - bv) / Math.max(1, bv));
          V[i] = bv;
        }
        best[i] = ba;
      }
      if (diff < 1e-9) break;
    }

    /* 정한 정책으로 기대 모듈·락키를 따로 (23.9) */
    const EM = new Float64Array(size), EK = new Float64Array(size), ET = new Float64Array(size);
    for (let sweep = 0; sweep < 2000; sweep++) {
      let diff = 0;
      for (const l of order) {
        const i = this.idx(l);
        if (V[i] >= BIG / 2 || best[i] < 0) continue;
        const a = acts[i][best[i]];
        let m = a.cost.mod, k = a.cost.key, n1 = 1, self = 0;
        const vk = a.keep === i ? V[i] : V[a.keep];
        const c = compile(l, i, a);
        for (let n = 0; n < c.ps.length; n++) {
          const j = c.vs[n], p = c.ps[n];
          const to = V[j] < vk - 1e-12 ? j : a.keep;
          if (to === i) { self += p; continue; }
          m += p * EM[to]; k += p * EK[to]; n1 += p * ET[to];
        }
        const nm = m / (1 - self), nk = k / (1 - self), nt = n1 / (1 - self);
        diff = Math.max(diff, Math.abs(nm - EM[i]) / Math.max(1, nm), Math.abs(nk - EK[i]) / Math.max(1, nk), Math.abs(nt - ET[i]) / Math.max(1, nt));
        EM[i] = nm; EK[i] = nk; ET[i] = nt;
      }
      if (diff < 1e-9) break;
    }
    Object.assign(this, { V, EM, EK, ET, acts, best, goal });

    /* 최초 개조 - 모듈 1개, 붙는 옵션은 T11 고정, 결과는 고를 수 없다 */
    let fv = 1, fm = 1, fk = 0, ft = 1;
    for (const t of this.tuples([0, 1, 2], 0)) {
      const l = t.r.map(r => (r === -2 ? 0 : r === -1 ? 1 : this.code(r, this.cls[r].of[FIRST_LV], 0)));
      const j = this.idx(l);
      fv += t.p * V[j]; fm += t.p * EM[j]; fk += t.p * EK[j]; ft += t.p * ET[j];
    }
    this.first = { v: fv, m: fm, k: fk, t: ft };
  }

  /* 실제 부위 → 줄 코드. tgt: [{ opt, m }] (this.targets 와 같은 순서) */
  encode(piece, tgt) {
    return [0, 1, 2].map(i => {
      const ln = piece.lines[i];
      if (!ln || !ln.opt) return i === 0 ? 1 : 0;   // 1번 줄은 늘 있다 - 비어 들어오면 무효로 본다
      const k = tgt.findIndex(t => t.opt === ln.opt);
      if (k < 0) return 1;
      return this.code(k, this.cls[k].of[ln.lv], piece.perm[i] === true);
    });
  }

  at(piece, tgt) {
    if (!piece.overloaded) return { v: this.first.v, m: this.first.m, k: this.first.k, t: this.first.t, first: true };
    const l = this.encode(piece, tgt);
    const i = this.idx(l);
    if (this.goal[i]) return { v: 0, m: 0, k: 0, t: 0 };
    const a = this.best[i] >= 0 ? this.acts[i][this.best[i]] : null;
    return { v: this.V[i], m: this.EM[i], k: this.EK[i], t: this.ET[i], action: a, lines: l, i };
  }

  /* 지금 상태에서 고를 수 있는 행동마다 - 이번 한 번만 이 행동을 하고 그 뒤는 정책대로 갈 때의 값.
     pGoal: 이번에 부위 목표가 완성될 확률, pBetter: 결과가 지금보다 나을 확률. 최선 행동의 v 는 V 와 같다. */
  options(piece, tgt) {
    if (!piece.overloaded) return [];
    const l = this.encode(piece, tgt);
    const i = this.idx(l);
    if (this.goal[i] || !this.acts[i]) return [];
    const { V, EM, EK, ET, goal } = this;
    return this.acts[i].map((a, n) => {
      const vk = V[a.keep];
      let v = a.c, m = a.cost.mod, k = a.cost.key, t = 1, pGoal = 0, pBetter = 0;
      this.outcomes(l, a, (p, j) => {
        const better = V[j] < vk - 1e-12;
        const to = better ? j : a.keep;
        v += p * V[to]; m += p * EM[to]; k += p * EK[to]; t += p * ET[to];
        if (goal[j]) pGoal += p;
        if (better) pBetter += p;
      });
      return { kind: a.kind, P: a.P, protect: a.protect, cost: a.cost, v, m, k, t, pGoal, pBetter, best: n === this.best[i] };
    });
  }
}

/* ── 실제 추첨 (시뮬레이션 모드·몬테카를로 공용) ──────────── */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rollLevel(D, r, prev = 0) {
  for (;;) {
    let cum = 0, lv = D.lp.length;
    const x = r();
    for (let k = 1; k <= D.lp.length; k++) { cum += D.lp[k - 1]; if (x < cum) { lv = k; break; } }
    if (lv !== prev) return lv;
  }
}

function pickOpt(D, r, excl) {
  const avail = D.opts.filter(o => !excl.has(o.id));
  const sum = avail.reduce((a, o) => a + o.w, 0);
  let x = r() * sum;
  for (const o of avail) { x -= o.w; if (x < 0) return o.id; }
  return avail.at(-1).id;
}

/* kind: 'change' | 'reset' | 'first'. protectLines: 보호하는 줄 번호.
   같은 줄에 직전과 같은 효과가 나오면 수치는 직전을 피한다. 빈칸은 다시 빈칸일 수 있다. */
export function roll(D, piece, kind, protectLines, r) {
  const lines = piece.lines.map(l => ({ ...l }));
  if (kind === 'reset') {
    lines.forEach((l, i) => { if (!protectLines.includes(i) && l.opt) l.lv = rollLevel(D, r, l.lv); });
    return lines;
  }
  const excl = new Set(lines.filter((l, i) => protectLines.includes(i) && l.opt).map(l => l.opt));
  for (let i = 0; i < 3; i++) {
    if (protectLines.includes(i)) continue;
    if (r() >= SLOT_P[i]) { lines[i] = { opt: '', lv: 0 }; continue; }
    const opt = pickOpt(D, r, excl);
    excl.add(opt);
    const lv = kind === 'first' ? FIRST_LV : rollLevel(D, r, piece.lines[i]?.opt === opt ? piece.lines[i].lv : 0);
    lines[i] = { opt, lv };
  }
  return lines;
}

/* ── 목표 ──────────────────────────────────────────────── */
/* goals: { mode: 'opt' | 'lv' | 'tier', items: { [opt]: { count, minLv, lvs?, eff?: { min, model } } } }
   opt  종류만 - 단계 무관
   lv   최소 단계 - count 줄 모두 minLv 이상
   tier 목표 단계 - 줄마다 단계를 따로 (lvs, 길이 count)
   nikke: { baseAmmo, chargeTime } */
export function effCfg(opt, g, nikke) {
  const kind = EFF_OPTS[opt];
  if (!kind || !g.eff) return null;
  return kind === 'ammo'
    ? { kind, A: nikke.baseAmmo || 0 }
    : { kind, model: g.eff.model === 'time' ? 'time' : 'pct', C: nikke.chargeTime || 1 };
}

/* 목표 한 줄 한 줄의 최소 단계 (내림차순) */
export function goalLevels(goals, g) {
  const n = Math.max(1, g.count || 1);
  if (goals.mode === 'tier') {
    const lvs = Array.from({ length: n }, (_, i) => Math.min(MAX_LV, Math.max(1, +(g.lvs?.[i] ?? g.lvs?.at?.(-1) ?? g.minLv ?? 1) || 1)));
    return lvs.sort((a, b) => b - a);
  }
  return new Array(n).fill(goals.mode === 'lv' ? g.minLv || 1 : 1);
}

/* 있는 단계들로 채울 수 있는 목표 줄 수 - 낮은 것부터 맞춰 가는 탐욕법이 최대다 */
function matched(have, need) {
  const hv = have.slice().sort((a, b) => a - b), nd = need.slice().sort((a, b) => a - b);
  let j = 0;
  for (const x of hv) if (j < nd.length && x >= nd[j]) j++;
  return j;
}

const allLines = (gear, opt) => gear.flatMap(p => (p.overloaded ? p.lines : []))
  .filter(l => l && l.opt === opt);

/* 지금 상태의 목표별 진행 - 화면 요약과 완료 판정이 같이 쓴다 */
export function progress(D, gear, goals, nikke) {
  const out = [];
  for (const [opt, g] of Object.entries(goals.items)) {
    const cfg = effCfg(opt, g, nikke);
    const ls = allLines(gear, opt);
    if (cfg) {
      const res = effValue(cfg, ls.map(l => l.lv), D.byId[opt].bp);
      out.push({ opt, eff: true, cfg, have: res.value, need: g.eff.min, res, ok: res.value >= g.eff.min });
    } else {
      const lvs = goalLevels(goals, g);
      const have = matched(ls.map(l => l.lv), lvs);
      out.push({ opt, eff: false, have, need: lvs.length, m: lvs.at(-1), lvs, tier: goals.mode === 'tier', ok: have >= lvs.length });
    }
  }
  return out;
}
export const isDone = prog => prog.length > 0 && prog.every(p => p.ok);

const profMemo = new Map();
function profilesOf(D, opt, cfg, min) {
  const key = [opt, cfg.kind, cfg.model, cfg.C, cfg.A, min].join('|');
  if (!profMemo.has(key)) profMemo.set(key, effProfiles(cfg, min, D.byId[opt].bp));
  return profMemo.get(key);
}

/* 경로 계산용 요구 목록. 실효값 목표는 (줄 수, 최소 단계) 후보 여러 개로 펼친다. */
function reqVariants(D, gear, goals, nikke) {
  const base = [], alts = [];
  for (const [opt, g] of Object.entries(goals.items)) {
    const cfg = effCfg(opt, g, nikke);
    if (!cfg) {
      /* 같은 단계끼리 한 묶음 - 목표 단계 모드면 단계마다 따로 */
      const byLv = new Map();
      for (const m of goalLevels(goals, g)) byLv.set(m, (byLv.get(m) || 0) + 1);
      for (const [m, count] of byLv) base.push({ opt, count, m });
      continue;
    }
    const ls = allLines(gear, opt);
    const cur = effValue(cfg, ls.map(l => l.lv), D.byId[opt].bp);
    const cands = [];
    /* 이미 넘었으면 지금 줄들을 지킨다 - 단계 조합이 바뀌면 다시 판정 */
    if (cur.value >= g.eff.min && ls.length) cands.push({ opt, count: ls.length, m: Math.min(...ls.map(l => l.lv)) });
    for (const p of profilesOf(D, opt, cfg, g.eff.min)) cands.push({ opt, count: p.k, m: p.m });
    if (g.eff.min <= 0) cands.push({ opt, count: 0, m: 1 });
    alts.push(cands.length ? cands : [{ opt, count: 5, m: 1 }]);   // 5 = 불가능
  }
  let out = [base];
  for (const cands of alts) out = out.flatMap(b => cands.map(c => [...b, c]));
  return out.map(rs => rs.filter(r => r.count > 0));
}

/* ── 2) 네 부위 배분 ─────────────────────────────────────── */
/* 한 부위가 맡을 수 있는 묶음 조합 - 3개 이하, 같은 옵션은 하나 */
function pieceMasks(reqs) {
  const out = [];
  for (let mask = 0; mask < 1 << reqs.length; mask++) {
    const opts = [];
    for (let g = 0; g < reqs.length; g++) if (mask & (1 << g)) opts.push(reqs[g].opt);
    if (opts.length <= 3 && new Set(opts).size === opts.length) out.push(mask);
  }
  return out;
}

/* 부위 표의 이름 - 목표의 (가중치, 최소 단계) 를 정렬한 것 + λ */
const sortTargets = (D, S) => S.map(r => ({ opt: r.opt, m: r.m, w: D.byId[r.opt].w }))
  .sort((a, b) => a.w - b.w || a.m - b.m || (a.opt < b.opt ? -1 : 1));
export const tableKey = (tgt, lam) => tgt.map(t => `${t.w}:${t.m}`).join('|') + '@' + lam;

/* policyOf(key) → 미리 푼 정책 | null */
export function createPlanner(D, { policyOf = () => null } = {}) {
  const tables = new Map();
  let built = 0, loaded = 0;

  function table(tgt, lam) {
    const key = tableKey(tgt, lam);
    let tb = tables.get(key);
    if (!tb) {
      const targets = tgt.map(t => ({ w: t.w, m: t.m }));
      const pol = policyOf(key);
      if (pol) {
        try { tb = new PieceTable(D, targets, lam, pol); loaded++; } catch { tb = null; }
      }
      if (!tb) { tb = new PieceTable(D, targets, lam); built++; }
      tables.set(key, tb);
    }
    return tb;
  }

  /* 부위 p 가 목표 묶음 S 를 갖추는 비용 */
  function pieceCost(piece, S, lam) {
    if (!S.length) return { v: 0, m: 0, k: 0, t: 0 };
    const tgt = sortTargets(D, S);
    const tb = table(tgt, lam);
    return { ...tb.at(piece, tgt), tgt, tb };
  }

  /* reqs 를 네 부위에 나눈다 - 남은 개수 벡터 위의 DP */
  function assign(gear, reqs, lam) {
    const fail = { v: Infinity, pieces: gear.map(() => ({ S: [], v: Infinity })) };
    const perOpt = new Map();
    for (const r of reqs) perOpt.set(r.opt, (perOpt.get(r.opt) || 0) + r.count);
    if ([...perOpt.values()].some(n => n > 4)) return fail;     // 한 부위에 같은 옵션은 하나 - 네 부위면 4줄까지
    const G = reqs.length;
    const subsets = pieceMasks(reqs);
    const cache = gear.map(() => new Map());
    const cost = (p, mask) => {
      let c = cache[p].get(mask);
      if (!c) {
        c = pieceCost(gear[p], reqs.filter((_, g) => mask & (1 << g)), lam);
        cache[p].set(mask, c);
      }
      return c;
    };
    const memo = new Map();
    const f = (p, rem) => {
      if (p === gear.length) return rem.every(x => x <= 0) ? { v: 0, pick: [] } : { v: Infinity, pick: [] };
      const key = p + ':' + rem.join(',');
      if (memo.has(key)) return memo.get(key);
      let best = { v: Infinity, pick: [] };
      /* 남은 부위로 채울 수 없으면 버린다 */
      const left = gear.length - p;
      if (rem.some(x => x > left)) { memo.set(key, best); return best; }
      for (const mask of subsets) {
        let useful = true;
        for (let g = 0; g < G; g++) if ((mask & (1 << g)) && rem[g] <= 0) { useful = false; break; }
        if (!useful) continue;
        const c = cost(p, mask);
        if (!Number.isFinite(c.v)) continue;
        const nr = rem.map((x, g) => (mask & (1 << g) ? x - 1 : x));
        const sub = f(p + 1, nr);
        const v = c.v + sub.v;
        if (v < best.v - 1e-9) best = { v, pick: [mask, ...sub.pick] };
      }
      memo.set(key, best);
      return best;
    };
    const r = f(0, reqs.map(x => x.count));
    if (!Number.isFinite(r.v)) return fail;
    const pieces = r.pick.map((mask, p) => {
      const c = cost(p, mask);
      return { S: reqs.filter((_, g) => mask & (1 << g)), ...c };
    });
    const sum = f => pieces.reduce((a, x) => a + x[f], 0);
    return { v: r.v, m: sum('m'), k: sum('k'), t: sum('t'), pieces };
  }

  /* 전체 계획 - 실효값 후보 중 가장 싼 것 */
  function plan(st, pref) {
    const lam = LAMBDAS[pref];
    let best = null;
    for (const reqs of reqVariants(D, st.gear, st.goals, st.nikke)) {
      const a = assign(st.gear, reqs, lam);
      if (!best || a.v < best.v - 1e-9) best = { ...a, reqs };
    }
    return best;
  }

  /* 부위 p 하나 - targets([{ opt, m }])를 주면 그 목표로, 없으면 전체 배분에서 이 부위가 맡은 몫으로 본다.
     부위는 사용자가 고른다. 여기서는 그 부위의 최선 행동과 고를 수 있는 행동별 수치만 낸다. */
  function pieceView(st, pref, p, targets = null, pl = null) {
    const lam = LAMBDAS[pref];
    const piece = st.gear[p];
    let pc;
    if (targets) pc = { S: targets.map(x => ({ opt: x.opt, m: x.m, count: 1 })), ...pieceCost(piece, targets, lam) };
    else {
      const all = pl || plan(st, pref);
      if (!all || !Number.isFinite(all.v)) return { S: [], v: Infinity, ok: false, options: [], act: null };
      pc = all.pieces[p];
    }
    if (!Number.isFinite(pc.v) || pc.v >= BIG / 2) return { S: pc.S, v: Infinity, ok: false, options: [], act: null };
    const options = pc.tb && pc.v > 0 ? pc.tb.options(piece, pc.tgt).map(o => ({
      kind: o.kind, protect: o.protect.map(x => ({ ...x })), cost: o.cost,
      unlock: [0, 1, 2].filter(i => piece.perm[i] === true && !o.P.includes(i)),
      v: o.v, m: o.m, k: o.k, t: o.t, pGoal: o.pGoal, pBetter: o.pBetter, best: o.best,
    })) : [];
    return { S: pc.S, v: pc.v, m: pc.m, k: pc.k, t: pc.t, first: !!pc.first, ok: true, custom: !!targets,
      act: pc.v > 0 ? concrete(piece, pc) : null, options };
  }

  /* 표의 행동 → 화면에 보일 행동 */
  function concrete(piece, pc) {
    if (pc.first) return { kind: 'first', protect: [], unlock: [], cost: { mod: 1, key: 0, estimated: false } };
    const a = pc.action;
    if (!a) return null;
    const unlock = [0, 1, 2].filter(i => piece.perm[i] === true && !a.P.includes(i));
    return { kind: a.kind, protect: a.protect.map(x => ({ ...x })), unlock, cost: a.cost };
  }

  /* 3) 유지·적용 비교 - 둘 다 이번 비용은 이미 낸 상태 */
  /* only: { piece, targets } 를 주면 그 부위의 그 목표만 본다 (선택한 부위만 최적화) */
  function compare(st, keepGear, acceptGear, pref, only = null) {
    const one = gear => pieceCost(gear[only.piece], only.targets, LAMBDAS[pref]);
    const keep = only ? one(keepGear) : plan({ ...st, gear: keepGear }, pref);
    const acc = only ? one(acceptGear) : plan({ ...st, gear: acceptGear }, pref);
    const prog0 = progress(D, keepGear, st.goals, st.nikke);
    const prog1 = progress(D, acceptGear, st.goals, st.nikke);
    /* 보존 조건 - 이미 넘은 실효값 목표를 깨는 결과는 후보에서 뺀다 */
    const breaks = st.keep?.allowDrop ? [] : prog0.filter((p, i) => p.eff && p.ok && !prog1[i].ok).map(p => p.opt);
    let choice = 'keep';
    if (!breaks.length && acc.v < keep.v - 1e-9) choice = 'accept';
    return { keep, acc, choice, breaks, prog0, prog1 };
  }

  return { plan, pieceView, compare, concrete, stats: () => ({ tables: tables.size, built, loaded }) };
}

/* 입력 검증 (26.2) - 결과로 들어온 세 줄이 이번 행동으로 나올 수 있는가 */
export function validateResult(before, kind, protectLines, after) {
  const errs = [];
  const opts = after.filter(l => l.opt).map(l => l.opt);
  if (new Set(opts).size !== opts.length) errs.push('dup');
  if (!after[0]?.opt) errs.push('line1');
  for (const i of protectLines) {
    const a = before.lines[i], b = after[i];
    if ((a.opt || '') !== (b.opt || '') || (a.opt && a.lv !== b.lv)) errs.push('locked');
  }
  if (kind === 'reset') {
    for (let i = 0; i < 3; i++) {
      if ((before.lines[i].opt || '') !== (after[i].opt || '')) { errs.push('resetType'); break; }
    }
  }
  if (kind === 'first') {
    if (after.some(l => l.opt && l.lv !== FIRST_LV)) errs.push('firstLv');
  }
  return [...new Set(errs)];
}

export { PieceTable };
