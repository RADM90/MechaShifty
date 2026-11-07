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

  const sumPieces = pl => pl.pieces.map(x => ({
    S: x.S.map(r => ({ opt: r.opt, m: r.m })), v: x.v, m: x.m, k: x.k, first: !!x.first,
  }));

  async function recommend(st) {
    const prog = progress(D, st.gear, st.goals, st.nikke);
    const base = { stateNo: st.stateNo, goalNo: st.goalNo, rules: rulesTag(), prog };
    if (!prog.length) return { ...base, status: 'noGoal' };
    if (isDone(prog)) return { ...base, status: 'done' };
    await ensure();

    /* 재화 우선순위별 정책 - 모듈 절약 / 균형 / 락키 미사용 */
    const alts = {};
    for (const pref of PREFS) {
      const n = P.next(st, pref);
      if (!n.plan || !Number.isFinite(n.plan.v) || n.piece < 0) { alts[pref] = { pref, ok: false }; continue; }
      alts[pref] = {
        pref, ok: true, lambda: LAMBDAS[pref],
        piece: n.piece, act: n.act, m: n.plan.m, k: n.plan.k,
        reqs: n.plan.reqs, pieces: sumPieces(n.plan),
      };
    }
    const pick = st.pref in alts && alts[st.pref].ok ? st.pref : PREFS.find(p => alts[p].ok);
    if (!pick) return { ...base, status: 'impossible', alts };
    return { ...base, status: 'go', pick, alts, approx: true, stats: P.stats() };
  }

  /* 유지·적용 비교 (23.5) */
  async function compare(st, keepGear, accGear) {
    await ensure();
    const r = P.compare(st, keepGear, accGear, st.pref in LAMBDAS ? st.pref : 'balanced');
    return {
      stateNo: st.stateNo, choice: r.choice, breaks: r.breaks,
      keep: { v: r.keep.v, m: r.keep.m, k: r.keep.k }, acc: { v: r.acc.v, m: r.acc.m, k: r.acc.k },
      prog0: r.prog0, prog1: r.prog1,
    };
  }

  return { D, recommend, compare, stats: () => ({ ...P.stats(), policies: policies.size }) };
}
