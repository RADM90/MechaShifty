/* 니파고 — 추천 한 건을 만든다 (명세 24.3).
   worker.js 와 워커를 못 쓰는 환경의 화면 쪽 대체 경로가 같이 쓴다. DOM 없음. */

import { buildData, rulesTag } from './rules.js';
import { createPlanner, progress, isDone, PREFS, LAMBDAS } from './engine.js';

export function createService(option, glossary) {
  const D = buildData(option, glossary);
  const P = createPlanner(D);

  const usable = b => ({
    mod: Math.max(0, (b.mod ?? 0) - (b.reserveMod || 0)),
    key: Math.max(0, (b.key ?? 0) - (b.reserveKey || 0)),
  });

  const sumPieces = pl => pl.pieces.map(x => ({
    S: x.S.map(r => ({ opt: r.opt, m: r.m })), v: x.v, m: x.m, k: x.k, first: !!x.first,
  }));

  function recommend(st) {
    const prog = progress(D, st.gear, st.goals, st.nikke);
    const base = { stateNo: st.stateNo, goalNo: st.goalNo, rules: rulesTag(), prog };
    if (!prog.length) return { ...base, status: 'noGoal' };
    if (isDone(prog)) return { ...base, status: 'done' };

    /* 재화 우선순위별 정책 — 모듈 절약 / 균형 / 락키 미사용 */
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
    let pick = st.pref in alts && alts[st.pref].ok ? st.pref : PREFS.find(p => alts[p].ok);
    if (!pick) return { ...base, status: 'impossible', alts };

    const budgetMode = st.budget && st.budget.mod != null;
    let status = 'go';
    if (budgetMode) {
      const b = usable(st.budget);
      const seed = (st.stateNo * 2654435761) >>> 0 || 1;
      /* 같은 행동·같은 기대 소모의 정책은 한 번만 굴린다 */
      const seen = new Map();
      for (const pref of PREFS) {
        const a = alts[pref];
        if (!a.ok) continue;
        if (a.k > 0 && b.key <= 0) { a.noKey = true; continue; }     // 락키가 없으면 락키 안은 뺀다
        const sig = JSON.stringify([a.piece, a.act, a.m.toFixed(3), a.k.toFixed(3)]);
        if (!seen.has(sig)) seen.set(sig, P.budgetRun(st, pref, b, 400, seed));
        a.budget = seen.get(sig);
        a.afford = a.act.cost.mod <= b.mod && a.act.cost.key <= b.key;
      }
      const cands = PREFS.map(p => alts[p]).filter(a => a.ok && a.budget && a.afford);
      if (!cands.length) {
        status = 'budget';
      } else {
        /* 완료 확률이 가장 높은 안 — 오차 안에서 비슷하면 사용자가 고른 우선순위, 그다음 기대 모듈 */
        const top = Math.max(...cands.map(a => a.budget.p));
        const near = cands.filter(a => top - a.budget.p <= Math.max(a.budget.err, 1e-9));
        const mine = near.find(a => a.pref === st.pref);
        pick = (mine || near.sort((x, y) => x.m - y.m)[0]).pref;
        if (top <= 0) status = 'stop';
      }
      base.usable = b;
    }
    return { ...base, status, pick, alts, budgetMode, approx: true };
  }

  /* 유지·적용 비교 (23.5) */
  function compare(st, keepGear, accGear) {
    const r = P.compare(st, keepGear, accGear, st.pref in LAMBDAS ? st.pref : 'balanced');
    return {
      stateNo: st.stateNo, choice: r.choice, breaks: r.breaks,
      keep: { v: r.keep.v, m: r.keep.m, k: r.keep.k }, acc: { v: r.acc.v, m: r.acc.m, k: r.acc.k },
      prog0: r.prog0, prog1: r.prog1,
    };
  }

  return { D, recommend, compare };
}
