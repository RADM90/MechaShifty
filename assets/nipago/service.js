/* 니파고 - 추천 한 건을 만든다 (명세 24.3, DOM 없음). worker.js 와 워커를 못 쓰는 환경의 화면 쪽 대체 경로가 같이 쓴다.
   부위 표는 첫 계산 때 data/nipago/policies.bin 을 한 번 받아 평가만 하고(tables.js), 없거나 맞지 않으면 엔진이 직접 푼다. */

import { buildData, rulesTag, cleanPieceGoals, goalsPrecomputed } from './rules.js';
import { createPlanner, progress, isDone, PREFS, LAMBDAS } from './engine.js';
import { policyHash, decodeShard, unpack, TABLE_FILE, MANIFEST_FILE, OPT_MANIFEST, optFile, optShard } from './tables.js';

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

  /* 선택 목표가 있는 묶음의 정책 - 가장 낮은 목표 단계에 맞는 파일을 필요할 때 받아 policies 에 더한다 */
  let optOk = null;
  const optLoads = new Map();
  function ensureOpt(lists) {
    const shards = new Set();
    for (const l of lists) {
      if (!l || !l.some(x => x.o) || (l.need >= l.filter(x => x.o).length && l.length <= 3) || !goalsPrecomputed(l, l.need)) continue;
      shards.add(optShard(Math.min(...l.map(x => x.m))));
    }
    if (!shards.size) return null;
    optOk ||= (async () => {
      try {
        const mb = await get(OPT_MANIFEST);
        return !!mb && JSON.parse(new TextDecoder().decode(mb)).hash === hash;
      } catch { return false; }
    })();
    return Promise.all([...shards].map(name => {
      if (!optLoads.has(name)) optLoads.set(name, (async () => {
        try {
          if (!await optOk) return;
          const bytes = await unpack(await get(optFile(name)));
          const map = bytes && decodeShard(bytes, hash);
          if (map) for (const [k, p] of map) policies.set(k, p);
        } catch {}
      })());
      return optLoads.get(name);
    }));
  }

  const P = createPlanner(D, { policyOf: k => policies.get(k) || null });

  /* 부위별 목표 - '선택한 부위만 최적화'에서 사용자가 정한 것만 유효하다. 선택 목표가 있으면 배열에 need 를 붙인다. */
  const customOf = (st, p) => {
    const raw = st.scope === 'piece' ? st.pieceGoals?.[p] : null;
    if (!Array.isArray(raw)) return null;
    const { list, need } = cleanPieceGoals(raw, st.pieceNeed?.[p], id => !!D.byId[id]);
    list.need = need;
    return list;
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
    await ensureOpt(customs);

    /* 재화 우선순위별 정책 - 모듈 절약 / 균형 / 락키 미사용 */
    const alts = {};
    /* 고른 우선순위부터 풀고, 그 안이 성립하면 나머지는 풀지 않는다 (선택 목표 표는 푸는 데 오래 걸린다) */
    for (const pref of [st.pref, ...PREFS].filter((x, i, a) => PREFS.includes(x) && a.indexOf(x) === i)) {
      if (Object.values(alts).some(x => x.ok)) { alts[pref] = { pref, ok: false }; continue; }
      const pl = prog.length ? P.plan(st, pref) : null;
      const views = st.gear.map((_, p) => P.pieceView(st, pref, p, customs[p], pl));
      if (!views.some(x => x.ok)) { alts[pref] = { pref, ok: false }; continue; }
      const live = views.map((x, p) => (x.ok && x.v > 0 ? p : -1)).filter(p => p >= 0);
      const cheapest = live.length ? live.reduce((a, p) => (views[p].v < views[a].v - 1e-9 ? p : a)) : -1;
      const sum = f => views.reduce((a, x) => a + (x.ok ? x[f] : 0), 0);
      alts[pref] = {
        pref, ok: true, lambda: LAMBDAS[pref], m: sum('m'), k: sum('k'), t: sum('t'), cheapest,
        pieces: views.map(x => ({
          S: x.S.map(r => ({ opt: r.opt, m: r.m, o: !!r.o })), ok: x.ok, v: x.v, m: x.m, k: x.k, t: x.t, first: !!x.first, custom: !!x.custom,
          act: x.act, options: x.options,
        })),
      };
    }
    const pick = st.pref in alts && alts[st.pref].ok ? st.pref : PREFS.find(p => alts[p]?.ok);
    if (!pick) return { ...base, status: 'impossible', alts };
    if (alts[pick].cheapest < 0) return { ...base, status: 'done', alts, pick };
    return { ...base, status: 'go', pick, alts, approx: true, stats: P.stats() };
  }

  /* 유지·적용 비교 (23.5). piece 를 주면 그 부위에 사용자가 정한 목표가 있을 때 그 부위만 비교한다. */
  async function compare(st, keepGear, accGear, piece = null) {
    await ensure();
    const targets = piece == null ? null : customOf(st, piece);
    await ensureOpt([targets]);
    const r = P.compare(st, keepGear, accGear, st.pref in LAMBDAS ? st.pref : 'balanced', targets ? { piece, targets } : null);
    return {
      stateNo: st.stateNo, choice: r.choice, breaks: r.breaks,
      keep: { v: r.keep.v, m: r.keep.m, k: r.keep.k, t: r.keep.t }, acc: { v: r.acc.v, m: r.acc.m, k: r.acc.k, t: r.acc.t },
      prog0: r.prog0, prog1: r.prog1,
    };
  }

  /* 선택 부위를 정책대로 3,000번 굴린 모듈 분포와 자주 거치는 상황 */
  async function simulate(st, piece) {
    await ensure();
    const pref = st.pref in LAMBDAS ? st.pref : 'balanced';
    const targets = customOf(st, piece);
    await ensureOpt([targets]);
    return { stateNo: st.stateNo, piece, pref, sim: P.pieceSim(st, pref, piece, targets) };
  }

  return { D, recommend, compare, simulate, stats: () => ({ ...P.stats(), policies: policies.size }) };
}
