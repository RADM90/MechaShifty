/* 니파고 - 추천 한 건을 만든다 (명세 24.3).
   worker.js 와 워커를 못 쓰는 환경의 화면 쪽 대체 경로가 같이 쓴다. DOM 없음.

   부위 표는 data/nipago/policies.bin 의 미리 푼 정책을 받아 평가만 한다 (tables.js).
   첫 계산 때 한 번 받고, 없거나 맞지 않으면 엔진이 직접 푼다. */

import { buildData, rulesTag } from './rules.js';
import { createPlanner, progress, isDone, PREFS, LAMBDAS } from './engine.js';
import { policyHash, decodeShard, unpack, TABLE_FILE, MANIFEST_FILE } from './tables.js';

/* base: data/ 폴더 주소. fetchBytes 를 넘기면 그걸로 받는다 (검증 스크립트용). */
export function createService(option, glossary, { base = null, fetchBytes = null } = {}) {
  const D = buildData(option, glossary);
  const hash = policyHash(D);
  let policies = new Map();            // 표 이름 → 정책
  let loading = null;                  // 한 번만 받는다

  const get = fetchBytes || (async path => {
    if (!base) return null;
    const r = await fetch(base + path);
    return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
  });

  /* 미리 푼 정책 파일 - 해시가 맞을 때만 큰 파일을 받는다. 실패하면 직접 계산한다. */
  function ensure() {
    if (!loading) {
      loading = (async () => {
        try {
          const mb = await get(MANIFEST_FILE);
          const m = mb && JSON.parse(new TextDecoder().decode(mb));
          if (!m || m.hash !== hash) return;
          const bytes = await unpack(await get(TABLE_FILE));
          const map = bytes && decodeShard(bytes, hash);
          if (map) policies = map;
        } catch {}
      })();
    }
    return loading;
  }

  const P = createPlanner(D, { policyOf: k => policies.get(k) || null });

  /* 부위별 목표 - '선택한 부위만 최적화'에서 사용자가 정한 것만 유효하다 (3개 이하, 옵션 중복 없음) */
  const customOf = (st, p) => {
    const raw = st.scope === 'piece' ? st.pieceGoals?.[p] : null;
    if (!Array.isArray(raw)) return null;
    const seen = new Set();
    return raw.filter(x => D.byId[x.opt] && !seen.has(x.opt) && seen.add(x.opt)).slice(0, 3)
      .map(x => ({ opt: x.opt, m: Math.min(15, Math.max(1, Math.round(+x.m) || 1)) }));
  };

  /* 부위는 사용자가 고른다. 네 부위 각각의 남은 비용·최선 행동·행동별 수치를 내고, 가장 싼 부위는 표시용 번호만 준다. */
  async function recommend(st) {
    const prog = progress(D, st.gear, st.goals, st.nikke);
    const base = { stateNo: st.stateNo, goalNo: st.goalNo, rules: rulesTag(), prog };
    const customs = st.gear.map((_, p) => customOf(st, p));
    const anyCustom = customs.some(Boolean);
    if (!prog.length && !anyCustom) return { ...base, status: 'noGoal' };
    if (!anyCustom && isDone(prog)) return { ...base, status: 'done' };
    await ensure();

    /* 재화 우선순위별 정책 - 모듈 절약 / 균형 / 락키 미사용 */
    const alts = {};
    for (const pref of PREFS) {
      const pl = prog.length ? P.plan(st, pref) : null;
      const views = st.gear.map((_, p) => P.pieceView(st, pref, p, customs[p], pl));
      if (!views.some(x => x.ok)) { alts[pref] = { pref, ok: false }; continue; }
      const live = views.map((x, p) => (x.ok && x.v > 0 ? p : -1)).filter(p => p >= 0);
      const cheapest = live.length ? live.reduce((a, p) => (views[p].v < views[a].v - 1e-9 ? p : a)) : -1;
      const sum = f => views.reduce((a, x) => a + (x.ok ? x[f] : 0), 0);
      alts[pref] = {
        pref, ok: true, lambda: LAMBDAS[pref], m: sum('m'), k: sum('k'), t: sum('t'), cheapest,
        pieces: views.map(x => ({
          S: x.S.map(r => ({ opt: r.opt, m: r.m })), ok: x.ok, v: x.v, m: x.m, k: x.k, t: x.t, first: !!x.first, custom: !!x.custom,
          act: x.act, options: x.options,
        })),
      };
    }
    const pick = st.pref in alts && alts[st.pref].ok ? st.pref : PREFS.find(p => alts[p].ok);
    if (!pick) return { ...base, status: 'impossible', alts };
    if (alts[pick].cheapest < 0) return { ...base, status: 'done', alts, pick };
    return { ...base, status: 'go', pick, alts, approx: true, stats: P.stats() };
  }

  /* 유지·적용 비교 (23.5). piece 를 주면 그 부위에 사용자가 정한 목표가 있을 때 그 부위만 비교한다. */
  async function compare(st, keepGear, accGear, piece = null) {
    await ensure();
    const targets = piece == null ? null : customOf(st, piece);
    const r = P.compare(st, keepGear, accGear, st.pref in LAMBDAS ? st.pref : 'balanced', targets ? { piece, targets } : null);
    return {
      stateNo: st.stateNo, choice: r.choice, breaks: r.breaks,
      keep: { v: r.keep.v, m: r.keep.m, k: r.keep.k, t: r.keep.t }, acc: { v: r.acc.v, m: r.acc.m, k: r.acc.k, t: r.acc.t },
      prog0: r.prog0, prog1: r.prog1,
    };
  }

  return { D, recommend, compare, stats: () => ({ ...P.stats(), policies: policies.size }) };
}
