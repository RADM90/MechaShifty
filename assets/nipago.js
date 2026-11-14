/* 니파고 탭 - 오버로드 옵션작 경로 추천. 니케 한 명의 네 부위를 함께 보고, 결과가 나올 때마다 다음 한 번을 다시 계산한다.
   DOM 없는 로직은 assets/nipago/ 에 있다 (rules 규칙·비용, effective 실효값, engine MDP·배분, tables 정책 파일, service 추천 조립).
   계산은 [계산] 을 눌러야 시작하고, 목표·장비를 고치면 멈춘다. 시뮬레이션 진행(실행·유지/적용·취소)은 그 계산을 이어 간다. */

import { optionLabel, optionFullLabel, olRows, SLOTS, olTotals, olPct, olLevelCls, OL_ORDER, olRank } from './cp.js';
import { rosterGearFor } from './roster.js';
import { PIECES, tryCost, fixOpt, CHARGE_RULES, EFF_OPTS, SLOT_P, FIRST_LV, MAX_LV, buildData } from './nipago/rules.js';
import { effValue, fmtEff as fmtEffRaw, explainEff as explainEffRaw } from './nipago/effective.js';
import { roll, progress, validateResult, effCfg } from './nipago/engine.js';
import { ITEM, itemIcon } from './items.js';

const STORE = 'nipago.input';
const NEED = ['equip_option', 'equip_glossary'];
const E = () => ({ opt: '', lv: 0 });

let ctx = null, D = null, RAW = null, base = './data/', mounted = null;
let S = null;                        // 저장되는 상태
let ui = { edit: null, rec: null, busy: false, cmp: null, draft: null, err: null, logOpen: false,
  lvPick: null, remoteMin: loadRemoteMin(), askProf: null, askScope: false, pgEdit: false, recMoved: false };

/* ── 작은 도우미 ─────────────────────────────────────────── */
function h(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  if (typeof attrs === 'string') n.className = attrs;
  else if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n[k] = v;
      else if (k === 'text') n.textContent = v;
      else if (k in n && typeof v !== 'string') n[k] = v;
      else n.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const k of kids.flat()) if (k != null && k !== false) n.append(k.nodeType ? k : String(k));
  return n;
}
const btn = (cls, text, onclick, extra = {}) => h('button', { type: 'button', class: cls, onclick, ...extra }, text);
const t = (k, ...a) => ctx.t(k, ...a);
/* 실효값 표시 - 장탄에는 언어별 '발' 단위를 붙인다 */
const fmtEff = (cfg, v) => fmtEffRaw(cfg, v, t('np.shot'));
const explainEff = (cfg, res) => explainEffRaw(cfg, res, t('np.shot'));
const opt = id => D.byId[id];
const short = id => optionLabel(id, ctx.lang);
const pctOf = (id, lv) => (opt(id).vals[lv - 1] * 100).toFixed(2) + '%';
const num = v => (v == null || !Number.isFinite(v) ? '-' : v >= 100 || Math.abs(v - Math.round(v)) < 0.05 ? Math.round(v).toLocaleString() : v.toFixed(1));
/* 레벨 색은 계산기 탭과 같다 (cp.js olLevelCls - 12~14 파랑, 15 검정) */
const lvCls = lv => olLevelCls(lv).trim();
/* 목표 칩·목록 순서 - 오버로드 종합과 같은 순서(cp.js OL_ORDER), 3열 그리드로 3×3 */
const GOAL_ORDER = OL_ORDER;
const goalOrder = () => [...GOAL_ORDER.filter(id => D.byId[id]), ...D.opts.map(o => o.id).filter(id => !GOAL_ORDER.includes(id))];
const nikkeOf = rid => (rid && (ctx.nikkes || []).find(n => n.rid === rid)) || null;
const nikkeName = n => (n ? n.name[ctx.lang] || n.name.en || n.name.ko : '');

/* 리모컨 접힘은 보는 사람 편의라 브라우저에만 둔다 */
/* ui 초기값이 모듈 맨 위에서 이 함수를 부르므로 아래 const 가 아니라 문자열을 그대로 쓴다 */
/* 고른 적이 없으면 좁은 화면(폰)에서는 접은 채로 시작한다 - 펼치면 화면 아래를 크게 가린다 */
function loadRemoteMin() {
  let v = null;
  try { v = localStorage.getItem('nipago.remoteMin'); } catch {}
  return v == null ? matchMedia('(max-width: 640px)').matches : v === '1';
}
const REMOTE_STORE = 'nipago.remoteMin';

/* ── 로드 ─────────────────────────────────────────────────── */
async function fetchJSON(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} - ${url}`);
  return r.json();
}
async function loadAll() {
  const probe = async b => { await fetchJSON(b + 'raw/equip_glossary.json'); return b; };
  try { base = await probe('./data/'); }
  catch { base = await probe('https://raw.githubusercontent.com/RADM90/MechaShifty/main/data/'); }
  const [option, glossary] = await Promise.all(NEED.map(k => fetchJSON(`${base}raw/${k}.json`)));
  RAW = { option, glossary };
  D = buildData(option, glossary);
}

/* ── 계산 - 워커, 안 되면 같은 코드를 화면 쪽에서 ───────────── */
let worker = null, wid = 0, inline = null;
const waiting = new Map();
async function compute(type, payload) {
  if (worker === null) {
    try {
      worker = new Worker(new URL('./nipago/worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = e => {
        const w = waiting.get(e.data.id);
        if (!w) return;
        waiting.delete(e.data.id);
        e.data.ok ? w.res(e.data.out) : w.rej(new Error(e.data.err));
      };
      worker.onerror = () => { worker = false; for (const w of waiting.values()) w.rej(new Error('worker')); waiting.clear(); };
      await post('init', { ...RAW, base: absBase() });
    } catch { worker = false; }
  }
  if (worker) {
    try { return await post(type, payload); } catch { worker = false; }
  }
  if (!inline) inline = (await import('./nipago/service.js')).createService(RAW.option, RAW.glossary, { base: absBase() });
  return type === 'compare' ? inline.compare(payload.st, payload.keep, payload.acc, payload.piece) : inline.recommend(payload.st);
}
/* 워커 안에서는 상대 주소가 워커 파일 기준이 된다 - 절대 주소로 넘긴다 */
const absBase = () => new URL(base, location.href).href;
function post(type, payload) {
  return new Promise((res, rej) => {
    const id = ++wid;
    waiting.set(id, { res, rej });
    worker.postMessage({ id, type, payload });
  });
}

/* ── 상태 ─────────────────────────────────────────────────── */
const emptyPiece = slot => ({ slot, overloaded: false, lines: [E(), E(), E()], perm: [false, false, false] });
const defaults = () => ({
  ver: 3,
  nikke: { rid: null, baseAmmo: null, chargeTime: null },
  gear: PIECES.map(emptyPiece),
  goals: { mode: 'opt', items: {} },
  keep: { allowDrop: false },
  pref: 'balanced',
  armed: false,                     // [계산] 을 누른 뒤 입력을 고치지 않았다
  source: 'real',                   // 탐색 모드 - 기본은 실전 기록
  base: null,                       // 첫 실행 직전 장비 - 계정 자료가 없을 때 '현재 OL 종합' 기준
  spent: { mod: 0, key: 0 },
  log: [],
  pending: null,
  scope: 'all',                     // 'all' 전체 부위 최적화 | 'piece' 선택한 부위만 최적화
  scopeAsked: false,                // 범위를 한 번 물었다
  focus: null,                      // 사용자가 고른 부위 번호
  pieceGoals: {},                   // 선택한 부위만 최적화 - 부위별 목표 { [p]: [{ opt, m }] }
  plan: null,                       // 선택 부위의 실행 설정 { piece, kind, prot: { [line]: 'perm' | 'key' }, auto, sig }
  stateNo: 1,
  goalNo: 1,
});

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE));
    if (saved && saved.ver === 3) return normalize(saved);
    if (saved && Array.isArray(saved.slots)) return fromV2(saved);
  } catch {}
  return defaults();
}
const save = () => { try { localStorage.setItem(STORE, JSON.stringify(S)); } catch {} };

const cleanLine = l => {
  const id = l && l.opt ? fixOpt(l.opt) : '';
  return id && opt(id) ? { opt: id, lv: Math.min(15, Math.max(1, +l.lv || FIRST_LV)) } : E();
};
function normalize(v) {
  const d = defaults();
  const gear = PIECES.map((slot, p) => {
    const g = v.gear?.[p] || {};
    const lines = [0, 1, 2].map(i => cleanLine(g.lines?.[i]));
    const perm = [0, 1, 2].map(i => !!lines[i].opt && g.perm?.[i] === true);
    return { slot, overloaded: !!g.overloaded, lines, perm };
  });
  const items = {};
  for (const [raw, g] of Object.entries(v.goals?.items || {})) {
    const id = fixOpt(raw);
    if (!opt(id)) continue;
    const count = Math.min(4, Math.max(1, +g.count || 1));
    const minLv = clampLv(g.minLv || 12);
    items[id] = { count, minLv, lvs: fitLvs(g.lvs, count, minLv),
      eff: EFF_OPTS[id] && g.eff ? { min: +g.eff.min || 0, model: g.eff.model === 'time' ? 'time' : 'pct' } : null };
  }
  const { budget, ...rest } = v;      // 보유 재화 입력은 없앴다
  const base = Array.isArray(v.base) && v.base.length === PIECES.length
    ? v.base.map((g, p) => ({ slot: PIECES[p], overloaded: !!g?.overloaded, lines: [0, 1, 2].map(i => cleanLine(g?.lines?.[i])),
      perm: [0, 1, 2].map(i => g?.perm?.[i] === true) }))
    : null;
  const focus = Number.isInteger(v.focus) && v.focus >= 0 && v.focus < PIECES.length ? v.focus : null;
  const pieceGoals = {};
  for (const [p, list] of Object.entries(v.pieceGoals || {})) {
    if (!Array.isArray(list) || !PIECES[+p]) continue;
    const seen = new Set();
    pieceGoals[p] = list.map(x => ({ opt: fixOpt(x?.opt), m: clampLv(x?.m) }))
      .filter(x => opt(x.opt) && !seen.has(x.opt) && seen.add(x.opt)).slice(0, 3);
  }
  const plan = v.plan && v.plan.piece === focus && 'auto' in v.plan ? v.plan : null;
  return { ...d, ...rest, gear, base, focus, pieceGoals, plan, scope: v.scope === 'piece' ? 'piece' : 'all', scopeAsked: !!v.scopeAsked,
    goals: { mode: ['opt', 'lv', 'tier'].includes(v.goals?.mode) ? v.goals.mode : 'opt', items },
    spent: { ...d.spent, ...(v.spent || {}) }, armed: !!v.armed,
    log: Array.isArray(v.log) ? v.log : [], nikke: { ...d.nikke, ...(v.nikke || {}) } };
}
const clampLv = v => Math.min(MAX_LV, Math.max(1, Math.round(+v) || 1));
/* 목표 단계 - 줄 수만큼. 모자라면 마지막 값(없으면 최소 단계)으로 채운다 */
const fitLvs = (lvs, n, fill) => Array.from({ length: n }, (_, i) =>
  clampLv(Array.isArray(lvs) && lvs.length ? lvs[Math.min(i, lvs.length - 1)] : fill));
/* v2 - 장비 한 부위였다. 첫 부위에 넣고 나머지는 미개조로 둔다. */
function fromV2(v) {
  const d = defaults();
  const lines = [0, 1, 2].map(i => cleanLine(v.slots[i]));
  d.gear[0] = { slot: PIECES[0], overloaded: lines.some(l => l.opt), lines,
    perm: [0, 1, 2].map(i => lines[i].opt && v.slots[i]?.lock === 'mod') };
  for (const [raw, g] of Object.entries(v.goals || {})) {
    const id = fixOpt(raw);
    if (opt(id)) { const minLv = clampLv(g.minLv || 12); d.goals.items[id] = { count: 1, minLv, lvs: [minLv], eff: null }; }
  }
  d.goals.mode = v.mode === 'lv' ? 'lv' : 'opt';
  d.spent = { mod: +v.totalMod || 0, key: +v.totalKey || 0 };
  return d;
}

/* 상태를 바꾸면 번호가 오른다.
   run: 시뮬레이션 진행 - [계산] 을 누른 상태면 이어서 다시 계산한다.
   그 밖의 입력 변경은 계산을 멈추고 [계산] 을 다시 누르길 기다린다. */
function commit(fn, { goal = false, run = false } = {}) {
  fn();
  S.stateNo++;
  if (goal) { S.goalNo++; S.pieceGoals = {}; }   // 전체 목표가 바뀌면 부위별 목표는 새 배분에서 다시 잡는다
  if (!run) S.armed = false;
  save();
  paint();
  if (run && S.armed) requestRec();
}
function calc() {
  if (!Object.keys(S.goals.items).length) return;
  if (!S.scopeAsked) { ui.askScope = true; paint(); return; }
  S.armed = true;
  save();
  requestRec();
  paint();
}
const repaint = fn => { if (fn) fn(); paint(); };

/* ── 계산기 탭에서 네 부위 채우기 ─────────────────────────── */
/* 계산기 자료(부위마다 {slot, tier, options}) → 니파고 네 부위.
   계산기 자료에는 영구 잠금 정보가 없다 - 모두 풀린 것으로 두고, 사용자가 자물쇠로 표시한다. */
function piecesFrom(gear) {
  return PIECES.map((slot, p) => {
    const g = (gear || []).find(x => x.slot === SLOTS[p]);
    if (!g || g.tier !== '오버로드' || !g.options?.length) return emptyPiece(slot);
    const lines = olRows(g.options).map(o => (o && o.name ? cleanLineRaw(o.name, o.level) : E()));
    return { slot, overloaded: true, lines, perm: [false, false, false] };
  });
}
function applyGear(st, gear) {
  st.gear = piecesFrom(gear);
  st.pending = null; st.plan = null; st.focus = null; st.pieceGoals = {}; st.armed = false; st.base = null;
}
export function seedGear({ rid, gear }) {
  const apply = st => {
    applyGear(st, gear);
    if (rid) st.nikke = { rid, baseAmmo: null, chargeTime: null };
    st.stateNo++;
  };
  ui.askProf = rid || null;          // 이 니케의 추천 옵션을 목표로 둘지 묻는다
  ui.askFocus = !!rid;
  if (S) {
    apply(S); save();
    if (mounted) { ui.cmp = null; ui.draft = null; ui.rec = null; loadNikkeStats(); paint(); }
    return;
  }
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORE)); } catch {}
  const st = saved && saved.ver === 3 ? saved : defaults();
  apply(st);
  localStorage.setItem(STORE, JSON.stringify(st));
}

/* 검색에서 니케를 고른다 - 계산기에 불러온 계정에 그 니케가 있으면 네 부위도 그 장비로 채운다 */
function pickNikke(n) {
  if ((n ? n.rid : null) === S.nikke.rid || S.pending) return;
  const gear = n ? rosterGearFor(n) : null;
  commit(() => {
    S.nikke = { rid: n ? n.rid : null, baseAmmo: null, chargeTime: null };
    if (gear) { applyGear(S, gear); ui.cmp = null; ui.draft = null; ui.rec = null; ui.edit = null; }
    S.base = null;
  });
  if (n) { ui.askProf = n.rid; ui.askFocus = true; loadProfiles(); }
  loadNikkeStats();
}

/* '현재 OL 종합' 의 기준 - 계정 자료가 있으면 그 장비, 없으면 첫 실행 직전 장비, 실행 전이면 지금 장비 */
function baseline() {
  const acct = rosterGearFor(nikkeOf(S.nikke.rid));
  if (acct) return { src: 'acct', gear: piecesFrom(acct) };
  if (S.base) return { src: 'start', gear: S.base };
  return { src: null, gear: S.gear };
}
const gearCopy = gear => gear.map(g => ({ slot: g.slot, overloaded: g.overloaded, lines: g.lines.map(l => ({ ...l })),
  perm: [0, 1, 2].map(i => g.perm?.[i] === true) }));

/* ── 초기화 ───────────────────────────────────────────────── */
/* 처음 상태 - 첫 실행 직전 장비, 없으면 계정 자료의 장비 */
function initialGear() {
  if (S.base) return S.base;
  const acct = rosterGearFor(nikkeOf(S.nikke.rid));
  return acct ? piecesFrom(acct) : null;
}
const sameGear = (a, b) => JSON.stringify(gearCopy(a)) === JSON.stringify(gearCopy(b));
const dropUi = () => { ui.cmp = null; ui.draft = null; ui.edit = null; ui.pgEdit = false; ui.recMoved = false; };
const zeroRun = () => { S.spent = { mod: 0, key: 0 }; S.log = []; };
/* 재화 소모량과 시도 기록을 한 번에 0으로. 장비는 그대로 둔다. */
function resetRun() {
  if (S.pending) return;
  repaint(() => { zeroRun(); save(); });
}
/* 네 부위 - to: 처음 상태(initialGear) 또는 null(모두 비움). 이 장비로 쌓은 소모량·기록도 함께 지운다. */
function resetGear(to) {
  if (S.pending) return;
  commit(() => {
    S.gear = to ? gearCopy(to) : PIECES.map(emptyPiece);
    S.base = null; S.plan = null; zeroRun();
  }, { run: true });
  dropUi();
}
/* 한 부위 - 그 부위에서 한 시도의 소모량·기록만 뺀다 */
function resetPiece(p, to) {
  if (S.pending) return;
  commit(() => {
    S.gear[p] = to ? gearCopy([to])[0] : emptyPiece(PIECES[p]);
    for (const x of S.log.filter(y => y.piece === p)) {
      S.spent.mod = Math.max(0, S.spent.mod - x.cost.mod); S.spent.key = Math.max(0, S.spent.key - x.cost.key);
    }
    S.log = S.log.filter(y => y.piece !== p);
    S.plan = null;
  }, { run: true });
  dropUi();
}
function resetAll() {
  if (!confirm(t('np.clearConfirm'))) return;
  S = defaults();
  dropUi(); ui.rec = null; ui.askProf = null; ui.askScope = false;
  save(); paint();
}
const chip = (label, fn, extra = {}) => btn('np-rreset', label, fn, extra);
/* 네 부위 → 종합 (계산기와 같은 규칙: 차속·장탄만 단계 묶음 반올림) */
const olLines = gear => gear.filter(g => g.overloaded)
  .flatMap(g => g.lines.filter(l => l.opt && opt(l.opt)).map(l => ({ name: l.opt, level: l.lv })));
const olOf = gear => olTotals(olLines(gear), (id, lv) => opt(id)?.vals[lv - 1]);
/* 데이터를 아직 못 읽었을 때도 쓸 수 있게 - 옵션 확인은 normalize 가 한다 */
const cleanLineRaw = (name, level) => ({ opt: fixOpt(name), lv: Math.min(15, Math.max(1, +level || FIRST_LV)) });

/* 기본 장탄수·기준 차지 시간은 data/weapons.json 값을 쓰고, 니케가 바뀌면 언제나 자료 값으로 맞춘다.
   차지 무기가 아니면 차지 시간은 null 이다. */
let weapons = null;
async function loadNikkeStats() {
  const rid = S.nikke.rid;
  if (!rid) return;
  try {
    if (!weapons) weapons = (await fetchJSON(`${base}weapons.json`)).nikkes || {};
    if (S.nikke.rid !== rid) return;
    const w = weapons[rid];
    const ammo = w ? w.ammo ?? null : null, charge = w ? w.charge || null : null;
    if (S.nikke.baseAmmo === ammo && S.nikke.chargeTime === charge) return;
    commit(() => { S.nikke.baseAmmo = ammo; S.nikke.chargeTime = charge; });
  } catch {}
}

/* ── 니케별 권장·종결 옵션 (data/nipago/profiles.json) ────────
   안(案)마다 줄 수가 정해진 옵션(goals, 범위면 아래쪽 값), 실효 장탄(eff), 고르는 칸 메모(notes)가 있다.
   적용하면 목표를 그 안으로 바꾼다. 줄 수만 넣고, 크리·합 N·잔여처럼 고르는 칸은 사람이 정한다. */
let PROF = null, profLoading = null;
function loadProfiles() {
  if (!profLoading) {
    profLoading = fetchJSON(`${base}nipago/profiles.json`)
      .then(j => { PROF = j && j.nikkes ? j : { nikkes: {} }; })
      .catch(() => { PROF = { nikkes: {} }; })
      .then(() => { if (mounted?.isConnected) paint(); });
  }
  return profLoading;
}
const profOf = rid => (rid && PROF?.nikkes?.[rid]) || null;
const applicable = p => (p ? p.sets.filter(x => x.apply) : []);

async function applySet(set) {
  ui.askProf = null;
  if (S.pending) { paint(); return; }
  await loadNikkeStats();            // 실효 장탄은 기본 장탄수가 있어야 목표로 바꿀 수 있다
  commit(() => {
    const items = {};
    for (const [id, n] of Object.entries(set.goals)) {
      if (!D.byId[id]) continue;
      const count = Math.min(4, n);
      items[id] = { count, minLv: PROF_LV, lvs: presetLvs(id, count), eff: null };
    }
    const e = set.eff;
    if (e && D.byId[e.opt]) {
      const a = S.nikke.baseAmmo;
      const it = items[e.opt] || { count: 1, minLv: PROF_LV, lvs: presetLvs(e.opt, 1), eff: null };
      if (a && e.shots > a && EFF_OPTS[e.opt] === 'ammo') it.eff = { min: e.shots - a, model: 'pct' };
      items[e.opt] = it;
    }
    S.goals = { ...S.goals, mode: 'tier', items };
  }, { goal: true });
}
/* 추천 옵션의 기준 단계. 장비에 이미 더 높은 줄이 있으면 그 단계를 줄마다 목표로 올린다 (예: 2줄, 장비 14·11 → 14·12). */
const PROF_LV = 12;
const presetLvs = (id, count) => {
  const have = S.gear.flatMap(g => (g.overloaded ? g.lines : [])).filter(l => l.opt === id).map(l => l.lv).sort((a, b) => b - a);
  return Array.from({ length: count }, (_, i) => Math.max(PROF_LV, have[i] || 0));
};

/* 안 이름 - 한국어는 문서 말 그대로, 그 밖에는 역할만 */
const setLabel = x => !x.label ? null : ctx.lang === 'ko' ? x.label
  : /수급|부족|밀리|막히|장전/.test(x.label) ? t('np.role_gauge')
  : /지원|탱킹|방어|회복|생존/.test(x.label) ? t('np.role_support')
  : /딜|버스트/.test(x.label) ? t('np.role_dps') : t('np.role_cond');

function setChips(x) {
  const range = Object.fromEntries(x.notes.filter(n => n.k === 'range').map(n => [n.opt, n.n]));
  const span = (a, b) => (a === b ? String(a) : `${a}~${b}`);
  const names = opts => opts.map(short).join('·');
  const out = [];
  if (x.hold) out.push(h('span', { class: 'np-pchip hold', title: t('np.profHoldHint') }, t('np.profHold')));
  for (const [id, lo] of Object.entries(x.goals)) out.push(h('span', 'np-pchip', `${short(id)} ${span(lo, range[id] ? range[id][1] : lo)}`));
  if (x.eff) out.push(h('span', { class: 'np-pchip', title: t('np.profShotsHint') }, t('np.profShots', short(x.eff.opt), x.eff.shots)));
  for (const n of x.notes) {
    if (n.k === 'range' && !(n.opt in x.goals)) out.push(h('span', { class: 'np-pchip opt', title: t('np.profPickHint') }, `${short(n.opt)} ${span(n.n[0], n.n[1])}`));
    else if (n.k === 'pick') out.push(h('span', { class: 'np-pchip opt', title: t('np.profPickHint') }, `${n.opts.length ? names(n.opts) : t('np.profAux')} ${span(n.n[0], n.n[1])}`));
    else if (n.k === 'rest') out.push(h('span', { class: 'np-pchip opt', title: t('np.profPickHint') }, t('np.profRest', n.opts.length ? names(n.opts) : t('np.profFree'))));
    else if (n.k === 'cap') out.push(h('span', { class: 'np-pchip cap', title: t('np.profCapHint') }, `${short(n.opt)} 0`));
  }
  return out;
}

/* 목표 카드 맨 위 - 이 니케의 권장·종결을 한 번에 */
function profCard() {
  if (!S.nikke.rid || !PROF) return null;
  const p = profOf(S.nikke.rid);
  const box = h('div', 'np-prof');
  box.appendChild(h('div', 'np-profhead', h('span', 'np-profttl', t('np.prof')),
    PROF.date ? h('span', 'np-meta', t('np.profSrc', PROF.date)) : null));
  if (!p) { box.appendChild(h('p', 'np-note', t('np.profNone'))); return box; }
  for (const tier of ['rec', 'end']) {
    const sets = p.sets.filter(x => x.tier === tier);
    const list = h('div', 'np-profsets');
    if (!sets.length) list.appendChild(h('span', 'np-note', t(p.status === 'tbd' ? 'np.profTbd' : 'np.profEmpty')));
    for (const x of sets) {
      const lab = setLabel(x);
      list.appendChild(h('div', 'np-profset' + (x.hold ? ' hold' : ''),
        lab ? h('span', 'np-proflab', lab) : null,
        h('span', 'np-profchips', setChips(x)),
        x.apply ? btn('np-profapply', t('np.profApply'), () => applySet(x), { disabled: !!S.pending, title: t('np.profApplyHint') }) : null));
    }
    box.appendChild(h('div', 'np-proftier', h('span', 'np-proftag np-proftag-' + tier, t('np.prof_' + tier)), list));
  }
  if (ctx.lang === 'ko' && p.cond) box.appendChild(h('p', 'np-note np-profcond', p.cond));
  if (p.src) box.appendChild(h('a', { class: 'np-proflink', href: p.src, target: '_blank', rel: 'noopener' }, t('np.profLink')));
  return box;
}

/* 니케를 고르거나 계산기에서 넘어왔을 때 - 추천 옵션을 목표로 둘지 묻는다 */
function renderAskProf(p) {
  const close = () => { ui.askProf = null; paint(); };
  const bg = h('div', 'np-modalbg');
  bg.onclick = e => { if (e.target === bg) close(); };
  const box = h('div', { class: 'np-modal np-ask', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('np.profAsk') });
  box.appendChild(h('div', 'np-modalhead',
    h('span', null, t('np.profAskTitle', nikkeName(nikkeOf(S.nikke.rid)))),
    PROF.date ? h('span', 'np-meta', t('np.profSrc', PROF.date)) : null));
  const body = h('div', 'np-askbody');
  body.appendChild(h('p', 'np-note', t(Object.keys(S.goals.items).length ? 'np.profAskReplace' : 'np.profAskDesc')));
  for (const tier of ['rec', 'end']) {
    for (const x of applicable(p).filter(y => y.tier === tier)) {
      const lab = setLabel(x);
      body.appendChild(btn('np-askopt',
        [h('span', 'np-proftag np-proftag-' + tier, t('np.prof_' + tier)), lab ? h('span', 'np-proflab', lab) : null,
          h('span', 'np-profchips', setChips(x))], () => applySet(x)));
    }
  }
  box.appendChild(body);
  box.appendChild(h('div', 'np-modalbtns', btn('np-mb np-mb-cancel', [t('np.profKeep'), h('small', null, 'Esc')], close)));
  bg.appendChild(box);
  return bg;
}

/* ── 엔진에 넘길 상태 ─────────────────────────────────────── */
const engineGear = gear => gear.map(g => ({ ...g, perm: g.perm.map(x => x === true) }));
const engineState = () => ({
  gear: engineGear(S.gear),
  goals: S.goals,
  nikke: { baseAmmo: S.nikke.baseAmmo || 0, chargeTime: S.nikke.chargeTime || 1 },
  pref: S.pref, keep: S.keep, stateNo: S.stateNo, goalNo: S.goalNo, scope: S.scope, pieceGoals: S.pieceGoals,
});

let recTimer = 0;
function requestRec() {
  clearTimeout(recTimer);
  if (!S.armed || !Object.keys(S.goals.items).length) { ui.busy = false; paint(); return; }
  ui.busy = true;
  recTimer = setTimeout(async () => {
    const want = S.stateNo;
    try {
      const out = await compute('rec', { st: engineState() });
      if (out.stateNo !== S.stateNo) return;      // 그 사이 상태가 바뀌었다 - 버린다
      ui.rec = out; ui.err = null;
      adoptRec(); save();
    } catch (err) {
      if (want === S.stateNo) ui.err = String(err.message || err);
    }
    if (want === S.stateNo) { ui.busy = false; paint(); }
  }, 120);
}

async function requestCompare() {
  const pd = S.pending;
  if (!pd || !pd.result || pd.kind === 'first') return;
  const tryId = pd.tryId;
  ui.cmp = { busy: true, tryId };
  paint();
  const keep = engineGear(S.gear);
  const acc = keep.map((g, i) => (i === pd.piece ? { ...g, lines: pd.result.map(l => ({ ...l })) } : g));
  try {
    const out = await compute('compare', { st: engineState(), keep, acc, piece: pd.piece });
    if (S.pending?.tryId !== tryId) return;
    ui.cmp = { ...out, tryId };
  } catch (err) { ui.cmp = { err: String(err.message || err), tryId }; }
  paint();
}

/* ── 실행 · 선택 (명세 23.3~23.4, 24.5) ───────────────────── */
/* 지금 유효한 계산 결과 - 재화 우선순위에 맞는 안 하나와 그 안의 부위 p */
const recView = () => { const r = ui.rec; return r && r.stateNo === S.stateNo && r.alts && r.pick ? r.alts[r.pick] : null; };
const pieceRec = p => { const v = recView(); return v && p != null && v.pieces[p]?.ok ? v.pieces[p] : null; };
/* 부위 p 의 목표 - 선택한 부위만 최적화면 사용자가 정한 것, 아니면 전체 배분에서 맡은 몫 */
const targetsOf = p => (S.scope === 'piece' && S.pieceGoals[p]) || pieceRec(p)?.S || null;
const protMap = protect => Object.fromEntries(protect.map(x => [x.line, x.mat]));
const protKey = protect => protect.map(x => x.line + x.mat).sort().join(',');
const heldProt = g => Object.fromEntries([0, 1, 2].filter(i => g.perm[i] === true && g.lines[i].opt).map(i => [i, 'perm']));
/* 선택 부위의 실행 설정. auto: 잠금이 추천을 따라간다 (자물쇠를 직접 누르면 꺼진다) */
const newPlan = p => ({ piece: p, kind: null, prot: heldProt(S.gear[p]), auto: true, sig: null });

/* 계산 결과를 선택 부위 설정에 반영한다. 추천이 직전과 달라지면 종류 선택을 비워 다시 고르게 한다. */
function adoptRec() {
  const p = S.focus;
  if (p == null) { S.plan = null; return; }
  if (!S.plan || S.plan.piece !== p || !('auto' in S.plan)) S.plan = newPlan(p);
  const pr = pieceRec(p);
  if (!pr) return;
  if (S.scope === 'piece' && !S.pieceGoals[p] && !S.pending) { S.pieceGoals[p] = pr.S.map(x => ({ opt: x.opt, m: x.m })); save(); }
  const a = pr.act;
  if (!a || !S.plan.auto) return;
  /* 이미 걸린 모듈 잠금은 추천이 해제를 권해도 자동으로 풀지 않는다 - 사용자가 자물쇠를 눌러야 풀린다 */
  const prot = a.kind === 'first' ? {} : { ...heldProt(S.gear[p]), ...protMap(a.protect) };
  const sig = a.kind + JSON.stringify(prot);
  if (S.plan.sig && S.plan.sig !== sig && S.plan.kind) { S.plan.kind = null; ui.recMoved = true; }
  S.plan.prot = prot; S.plan.sig = sig;
}

function selectPiece(p) {
  if (S.pending || S.focus === p) return;
  repaint(() => { S.focus = p; S.plan = newPlan(p); ui.edit = null; ui.pgEdit = false; ui.recMoved = false; save(); });
}

/* 선택 부위에서 kind 를 지금 잠금 설정으로 실행할 때의 행동. opt: 엔진이 평가한 같은 행동(없으면 null) */
function actionFor(kind) {
  const p = S.focus;
  if (p == null || !S.plan || !kind) return null;
  const g = S.gear[p];
  if (!g.overloaded) return kind === 'first' ? { piece: p, kind, protect: [], unlock: [], cost: { mod: 1, key: 0 }, opt: null, best: true } : null;
  if (kind === 'first') return null;
  const protect = Object.entries(S.plan.prot || {})
    .filter(([i]) => g.lines[+i].opt)
    .map(([i, mat]) => ({ line: +i, mat, fresh: !(mat === 'perm' && g.perm[+i] === true) }))
    .sort((a, b) => a.line - b.line);
  const unlock = [0, 1, 2].filter(i => g.perm[i] === true && !protect.some(x => x.line === i));
  const o = pieceRec(p)?.options.find(x => x.kind === kind && protKey(x.protect) === protKey(protect)) || null;
  return { piece: p, kind, protect, unlock, cost: o ? o.cost : tryCost(protect, 0.1), opt: o, best: !!o?.best };
}
const currentAction = () => actionFor(S.plan?.kind);
/* 지금 설정이 추천과 같은가 */
function matchesRec(a, rec) {
  return !!a && !!rec && a.kind === rec.kind && protKey(a.protect) === protKey(rec.protect);
}
function followRec() {
  const rec = pieceRec(S.focus)?.act;
  if (!rec || S.pending) return;
  repaint(() => { S.plan = newPlan(S.focus); adoptRec(); S.plan.kind = rec.kind; ui.recMoved = false; save(); });
}

function actionProblems(a) {
  if (!a) return [];
  const g = S.gear[a.piece];
  const out = [];
  if (a.kind !== 'first' && !g.lines[0].opt) out.push('line1');
  if (a.protect.length > 2) out.push('tooMany');
  if (a.kind === 'reset' && !g.lines.some((l, i) => l.opt && !a.protect.some(p => p.line === i))) out.push('nothing');
  return out;
}

function execute() {
  if (S.pending) return;                           // 버튼 두 번 - 한 번만
  const a = currentAction();
  if (!a || !S.armed || actionProblems(a).length) return;
  commit(() => {
    const g = S.gear[a.piece];
    const tryId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    if (!S.base) S.base = gearCopy(S.gear);
    S.spent.mod += a.cost.mod; S.spent.key += a.cost.key;
    const before = g.lines.map(l => ({ ...l }));
    const prevPerm = g.perm.slice();
    /* 새 영구 잠금은 지금 확정된다 - 결과를 유지해도 남는다. 락키·해제한 줄은 잠금이 없다. */
    g.perm = [0, 1, 2].map(i => a.protect.some(p => p.line === i && p.mat === 'perm'));
    const protectLines = a.protect.map(p => p.line);
    let result = null;
    if (S.source === 'sim') {
      result = roll(D, { ...g, lines: before }, a.kind, protectLines, Math.random);
    }
    S.pending = { tryId, piece: a.piece, kind: a.kind, protect: a.protect, unlock: a.unlock, cost: a.cost,
      before, prevPerm, result, followed: a.best };
    S.log.push({ tryId, at: Date.now(), piece: a.piece, kind: a.kind, protect: a.protect, cost: a.cost,
      before, prevPerm, result: null, choice: null, followed: a.best, src: S.source });
    if (S.log.length > 300) S.log.splice(0, S.log.length - 300);
  }, { run: true });
  ui.cmp = null;
  ui.draft = S.pending.result ? null : draftFrom(S.pending);
  if (S.pending.result) requestCompare();
}

function draftFrom(pd) {
  if (pd.kind === 'first') return [E(), E(), E()];
  return pd.before.map(l => ({ ...l }));
}

/* 실전 기록 - 입력한 결과를 확정해 비교로 넘긴다 */
function submitDraft() {
  const pd = S.pending;
  const errs = validateResult({ lines: pd.before }, pd.kind, pd.protect.map(p => p.line), ui.draft);
  if (errs.length) return;
  repaint(() => { pd.result = ui.draft.map(l => (l.opt ? { opt: l.opt, lv: pd.kind === 'first' ? FIRST_LV : l.lv } : E())); save(); });
  requestCompare();
}

function choose(choice) {
  const pd = S.pending;
  if (!pd || !pd.result) return;
  commit(() => {
    const g = S.gear[pd.piece];
    if (choice === 'accept' || pd.kind === 'first') {
      g.lines = pd.result.map(l => ({ ...l }));
      g.overloaded = true;
      g.perm = g.perm.map((x, i) => (g.lines[i].opt ? x : false));
    }
    const rec = S.log.find(x => x.tryId === pd.tryId);
    if (rec) { rec.result = pd.result; rec.choice = pd.kind === 'first' ? 'accept' : choice; rec.advice = ui.cmp?.choice || null; }
    S.pending = null;
    /* 실행 설정은 이어진다 - 빈칸이 된 줄의 잠금만 뺀다 */
    if (S.plan) S.plan.prot = Object.fromEntries(Object.entries(S.plan.prot || {}).filter(([i]) => S.gear[S.plan.piece].lines[+i].opt));
  }, { run: true });
  ui.cmp = null; ui.draft = null;
}

/* 실행 취소 - 오입력 등으로 이번 시도를 없던 일로 한다. 비용·이번에 건 잠금도 되돌린다. (Esc) */
function cancelPending() {
  const pd = S.pending;
  if (!pd) return;
  commit(() => {
    const at = S.log.findIndex(x => x.tryId === pd.tryId);
    if (at >= 0) S.log.splice(at, 1);
    if (!S.log.length) S.base = null;
    S.spent.mod = Math.max(0, S.spent.mod - pd.cost.mod);
    S.spent.key = Math.max(0, S.spent.key - pd.cost.key);
    S.gear[pd.piece].perm = pd.prevPerm.slice();
    S.pending = null;
  }, { run: true });
  ui.cmp = null; ui.draft = null;
}

/* 기록 정정 - 서비스 안의 기록만 되돌린다. 게임 안 재화·장비는 돌아오지 않는다 (명세 24.5). */
function undoLast() {
  const last = S.log.at(-1);
  if (!last) return;
  commit(() => {
    S.log.pop();
    if (!S.log.length) S.base = null;
    S.spent.mod = Math.max(0, S.spent.mod - last.cost.mod);
    S.spent.key = Math.max(0, S.spent.key - last.cost.key);
    const g = S.gear[last.piece];
    g.lines = last.before.map(l => ({ ...l }));
    g.perm = last.prevPerm.slice();
    if (last.kind === 'first') g.overloaded = false;
    if (S.pending?.tryId === last.tryId) S.pending = null;
  }, { run: true });
  ui.cmp = null; ui.draft = null;
}

/* ── 렌더: 공통 입력 ──────────────────────────────────────── */
function seg(items, cur, onPick, cls = '') {
  return h('div', { class: 'np-seg ' + cls, role: 'group' },
    items.map(([v, label, title]) => btn('np-segb' + (v === cur ? ' on' : ''), label, () => onPick(v), { 'aria-pressed': String(v === cur), title })));
}
/* − [숫자] + - 가운데 칸에 바로 입력할 수도 있다 (Enter·포커스 이동 때 반영) */
function stepper(value, set, { min = 1, max = 15, label } = {}) {
  const inp = h('input', { class: 'np-stepi', type: 'number', inputmode: 'numeric', min, max, step: 1, 'aria-label': label });
  inp.value = value;
  inp.onfocus = () => inp.select();
  inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } };
  inp.onchange = () => {
    const v = Math.round(+inp.value);
    if (inp.value.trim() === '' || !Number.isFinite(v)) { inp.value = value; return; }
    const c = Math.min(max, Math.max(min, v));
    inp.value = c;
    if (c !== value) set(c);
  };
  return h('span', 'np-step',
    btn('np-stepb', '−', () => set(Math.max(min, value - 1)), { 'aria-label': label + ' −', disabled: value <= min, tabindex: '-1' }),
    inp,
    btn('np-stepb', '+', () => set(Math.min(max, value + 1)), { 'aria-label': label + ' +', disabled: value >= max, tabindex: '-1' }));
}

/* ── 렌더: 니케 검색 ──────────────────────────────────────────
   계산기 목록과 같은 검색 규칙(이름 초성·띄어쓰기 무시, 별명·스쿼드 부분 일치)에 아이콘 칩을 더한다.
   입력하는 동안 포커스·캐럿을 잃지 않게 한 번 만들어 두고 paint 마다 다시 붙인다 (언어가 바뀌면 renderNipago 가 새로 만든다). */
const SEARCH_AXES = ['corporation', 'burst', 'element', 'class', 'weapon_type'];
const SEARCH_MAX = 30;
let search = null;

function searchRow() {
  if (search) {
    if (document.activeElement !== search.inp) search.inp.value = nikkeName(nikkeOf(S.nikke.rid));
    return search.box;
  }
  const sel = Object.fromEntries(SEARCH_AXES.map(a => [a, new Set()]));
  const box = h('section', 'np-card np-search');
  const inp = h('input', { id: 'np-nikke', class: 'np-text np-sq', type: 'search', placeholder: t('im.filter'),
    title: t('ui.search'), autocomplete: 'off', spellcheck: 'false', role: 'combobox',
    'aria-label': t('np.nikke'), 'aria-expanded': 'false', 'aria-controls': 'np-slist' });
  inp.value = nikkeName(nikkeOf(S.nikke.rid));
  const list = h('div', { id: 'np-slist', class: 'np-slist', role: 'listbox', hidden: true });
  const st = { box, inp, list, hits: [], hi: 0 };
  search = st;

  const icon = (axis, code) => {
    const ic = code && ctx.iconEl && ctx.iconEl(axis, code);
    if (ic) ic.title = ctx.L(axis, code);
    return ic || null;
  };
  const anyChip = () => SEARCH_AXES.some(a => sel[a].size);
  const close = () => { list.hidden = true; inp.setAttribute('aria-expanded', 'false'); };
  const choose = n => { close(); st.hi = 0; inp.value = nikkeName(n || nikkeOf(S.nikke.rid)); pickNikke(n); };
  const draw = () => {
    const q = inp.value.trim();
    if (!q && !anyChip()) { close(); return; }
    const m = q && ctx.nikkeMatcher ? ctx.nikkeMatcher(q) : null;
    const all = (ctx.nikkes || [])
      .filter(n => (!m || m(n)) && SEARCH_AXES.every(a => !sel[a].size || sel[a].has(n[a])))
      .sort((a, b) => nikkeName(a).localeCompare(nikkeName(b), ctx.lang));
    st.hits = all.slice(0, SEARCH_MAX);
    st.hi = Math.min(st.hi, Math.max(0, st.hits.length - 1));
    list.textContent = '';
    if (!all.length) list.appendChild(h('div', 'np-snone', t('np.searchNone')));
    st.hits.forEach((n, i) => {
      const row = h('button', { type: 'button', role: 'option', 'aria-selected': String(i === st.hi),
        class: 'np-sitem' + (i === st.hi ? ' on' : '') + (n.rid === S.nikke.rid ? ' cur' : '') },
      h('span', 'np-sname', nikkeName(n)),
      h('span', 'np-sicons', SEARCH_AXES.map(a => icon(a, n[a]))));
      row.onmousedown = e => e.preventDefault();          // 검색창 포커스를 지킨다
      row.onclick = () => choose(n);
      list.appendChild(row);
    });
    if (all.length > SEARCH_MAX) list.appendChild(h('div', 'np-snone', t('np.searchMore', all.length - SEARCH_MAX)));
    list.hidden = false;
    inp.setAttribute('aria-expanded', 'true');
    list.querySelector('.np-sitem.on')?.scrollIntoView({ block: 'nearest' });
  };
  st.close = () => { close(); if (document.activeElement !== inp) inp.value = nikkeName(nikkeOf(S.nikke.rid)); };

  inp.oninput = () => { st.hi = 0; draw(); };
  inp.onkeydown = e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (list.hidden) { draw(); return; }
      const n = st.hits.length;
      if (n) { st.hi = (st.hi + (e.key === 'ArrowDown' ? 1 : -1) + n) % n; draw(); }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!list.hidden && st.hits[st.hi]) choose(st.hits[st.hi]);
      else if (!inp.value.trim()) choose(null);            // 비우고 Enter - 니케 선택 해제
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      inp.value = nikkeName(nikkeOf(S.nikke.rid));
    }
  };

  /* 아이콘 칩 - 니케 리스트 탭과 같은 축 순서. 누르는 동안 검색창 포커스를 지킨다. */
  const bar = h('div', 'cp-chipBar np-schips');
  for (const axis of SEARCH_AXES) {
    const group = h('div', { class: 'cp-chipGroup', role: 'group', 'aria-label': t('ax.' + axis) });
    for (const code of ctx.AXES?.[axis]?.order || []) {
      const label = ctx.L(axis, code);
      const b = btn('chip chip-ic', icon(axis, code) || h('span', null, label), null,
        { title: label, 'aria-label': label, 'aria-pressed': 'false' });
      b.onmousedown = e => e.preventDefault();
      b.onclick = () => {
        sel[axis].has(code) ? sel[axis].delete(code) : sel[axis].add(code);
        b.setAttribute('aria-pressed', String(sel[axis].has(code)));
        st.hi = 0;
        draw();
      };
      group.appendChild(b);
    }
    bar.appendChild(group);
  }
  box.appendChild(h('div', 'np-sline', h('div', 'np-sbox', inp, list), bar,
    chip(t('np.clear'), resetAll, { title: t('np.clearHint'), class: 'np-rreset np-resetall' })));
  return box;
}

/* ── 렌더: 데이터 ─────────────────────────────────────────────
   기본 - 니케 자료(장탄·차지 시간)와 차속 분류. 옵션 - 지금 네 부위를 붙였을 때의 실효값. 손으로 고치는 칸은 없다. */
function chargeRole() {
  if (!S.nikke.rid) return { text: '-' };
  if (!S.nikke.chargeTime) return { text: '-' };                // 차지 무기가 아니다
  const cr = CHARGE_RULES[S.nikke.rid];
  if (!cr) return { text: t('np.clsS_unk'), title: t('np.clsUnkHint'), cls: 'unk' };
  if (cr.cls === 'none') return { text: '-', title: `${t('np.chargeNone')} · ${t('np.clsSrc', cr.src)}` };
  return { text: t('np.clsS_' + cr.cls), title: t('np.clsSrc', cr.src), cls: cr.cls };
}

function renderData() {
  const card = h('section', 'np-card np-data');
  card.appendChild(h('div', 'np-cardhead', h('h3', null, t('np.data'))));
  const A = S.nikke.baseAmmo || 0, C = S.nikke.chargeTime || 0;
  const lines = olLines(S.gear);
  const lvsOf = id => lines.filter(l => l.name === id).map(l => l.level);
  /* 기본 | 옵션 두 열을 세로로 늘어놓는다. 장탄·차지 시간은 두 열이 같은 행에 오게 행 번호를 못박는다. */
  const grid = h('div', 'np-dtable');
  const put = (col, row, node) => { node.style.gridColumn = String(col); node.style.gridRow = String(row); grid.appendChild(node); };
  const cell = (k, v, sub, title) => h('div', { class: 'np-dcell', title },
    h('span', 'np-dk', k), h('span', 'np-dv', v, sub ? h('small', null, sub) : null));

  const role = chargeRole();
  const roleEl = role.cls ? h('span', 'np-cls np-cls-' + role.cls, role.text) : role.text;
  put(1, 1, h('span', 'np-dttl', t('np.dataBase')));
  put(1, 2, cell(t('np.dAmmo'), A ? A + t('np.shot') : '-'));
  put(1, 3, cell(t('np.dCharge'), C ? C.toFixed(2) + 's' : '-'));
  put(1, 4, cell(t('np.dChargeCls'), roleEl, null, role.title));

  let ammo = '-', ammoSub = null;
  if (A) {
    const v = effValue({ kind: 'ammo', A }, lvsOf('장탄'), opt('장탄').bp).value;
    ammo = (A + v) + t('np.shot');
    if (v) ammoSub = `(+${v})`;
  }
  let chg = '-', chgSub = null;
  if (C) {
    const r = effValue({ kind: 'charge', model: 'time', C }, lvsOf('차속'), opt('차속').bp).value;
    chg = Math.max(0, C - r / 100).toFixed(2) + 's';
    if (r) chgSub = `(−${(r / 100).toFixed(2)}s)`;
  }
  const tot = olOf(S.gear);
  const sumOf = id => ((tot.find(o => o.name === id)?.total || 0) * 100).toFixed(2) + '%';
  put(2, 1, h('span', 'np-dttl', t('np.dataOpt')));
  put(2, 2, cell(t('np.dAmmo'), ammo, ammoSub));
  put(2, 3, cell(t('np.dCharge'), chg, chgSub));
  put(2, 4, cell(t('np.dElem'), sumOf('우코')));
  put(2, 5, cell(t('np.dAtk'), sumOf('공증')));
  card.appendChild(grid);
  return card;
}

/* ── 렌더: 오버로드 옵션 종합 ─────────────────────────────────
   계산기 탭의 종합과 같은 마크업·규칙. ref 를 주면 그 기준과 달라진 만큼을 옆에 적는다. */
const fmtDelta = (o, d) => (d > 0 ? '+' : '−')
  + (o.rounded ? Math.round(Math.abs(d) * 100) : (Math.abs(d) * 100).toFixed(2)) + '%p';

function olCard(title, gear, { src = null, ref = null } = {}) {
  const card = h('section', 'np-card np-olsum');
  const totals = olOf(gear);
  const rows = totals.map(o => ({ o, d: ref ? o.total - (ref.get(o.name)?.total || 0) : 0 }));
  /* 기준에는 있었는데 지금은 없는 옵션 - 0 으로 남겨 빠진 것을 보인다 */
  if (ref) {
    for (const [name, r] of ref) {
      if (!totals.some(o => o.name === name)) rows.push({ o: { ...r, total: 0, exact: 0, count: 0, top: 0 }, d: -r.total, gone: true });
    }
    rows.sort((a, b) => olRank(a.o.name) - olRank(b.o.name));
  }
  const same = ref && rows.length && rows.every(x => Math.abs(x.d) < 1e-9);
  const meta = same ? t('np.olSame') : src;
  card.appendChild(h('div', 'np-cardhead', h('h3', null, title), meta ? h('span', 'np-meta', meta) : null));
  if (!rows.length) { card.appendChild(h('p', 'np-empty', t('cp.olNone'))); return card; }
  const list = h('div', 'cp-olList');
  for (const { o, d, gone } of rows) {
    const row = h('div', { class: 'cp-olRow' + olLevelCls(o.top) + (gone ? ' np-gone' : ''),
      title: gone ? null : `${o.parts} · ${t('cp.olExact', (o.exact * 100).toFixed(2) + '%')}` });
    const name = h('span', 'cp-olName', `[${optionFullLabel(o.name, ctx.lang)}]`);
    if (o.count > 1) name.appendChild(h('span', 'cp-olCount', ' ×' + o.count));
    const val = h('span', 'cp-olVal', olPct(o));
    if (Math.abs(d) >= 1e-9) val.prepend(h('small', 'np-delta ' + (d > 0 ? 'up' : 'down'), fmtDelta(o, d)));
    row.append(name, val);
    list.appendChild(row);
  }
  card.appendChild(list);
  return card;
}

/* ── 렌더: 플로팅 리모컨 ──────────────────────────────────────
   탐색 모드 · 재화 우선순위 · 재화 소모량. 화면을 내려도 따라온다. */
function renderRemote() {
  const min = ui.remoteMin;
  const box = h('aside', { class: 'np-remote' + (min ? ' min' : ''), 'aria-label': t('np.remote') });
  box.style.setProperty('--np-top', (document.querySelector('.topbar')?.offsetHeight || 0) + 'px');
  const toggle = btn('np-rtoggle', min ? '▾' : '▴', () => repaint(() => {
    ui.remoteMin = !min;
    try { localStorage.setItem(REMOTE_STORE, ui.remoteMin ? '1' : '0'); } catch {}
  }), { title: t(min ? 'np.remoteMax' : 'np.remoteMin'), 'aria-label': t(min ? 'np.remoteMax' : 'np.remoteMin'), 'aria-expanded': String(!min) });
  const field = (label, ...kids) => h('div', 'np-rfield', h('span', 'np-flbl', label), ...kids);
  /* 소모량 초기화는 계산 입력이 아니다 - commit 으로 계산을 멈추지 않는다 */
  const spent = field(t('np.spent'),
    h('div', 'np-rrow',
      h('span', { class: 'np-rpair', title: t('np.mod') }, h('span', 'np-rk', icMod()), h('b', 'np-m', String(S.spent.mod))),
      h('span', { class: 'np-rpair', title: t('np.key') }, h('span', 'np-rk', icKey()), h('b', 'np-k', String(S.spent.key))),
      h('span', 'np-rpair np-rtries', t('np.tries', S.log.length)),
      chip(t('np.reset'), resetRun, { title: t('np.resetRunHint'), disabled: !!S.pending || !(S.spent.mod || S.spent.key || S.log.length) })));
  if (!min) {
    box.appendChild(field(t('np.source'),
      seg([['real', t('np.srcReal'), t('np.srcRealHint')], ['sim', t('np.srcSim'), t('np.srcSimHint')]], S.source,
        v => { if (!S.pending) commit(() => { S.source = v; }, { run: true }); }, 'np-seg-s')));
    box.appendChild(field(t('np.pref'),
      seg([['mod', t('np.pref_mod'), t('np.prefHint_mod')], ['balanced', t('np.pref_balanced'), t('np.prefHint_balanced')], ['key', t('np.pref_key'), t('np.prefHint_key')]],
        S.pref, v => commit(() => { S.pref = v; }, { run: true }), 'np-seg-s')));
  }
  box.append(spent, toggle);
  return box;
}

/* ── 렌더: 목표 ───────────────────────────────────────────── */
function renderGoals(prog) {
  const card = h('section', 'np-card np-goals');
  card.appendChild(h('div', 'np-cardhead', h('h3', null, t('np.goals')),
    seg([['opt', t('np.modeOpt'), t('np.modeOptHint')], ['lv', t('np.modeLv'), t('np.modeLvHint')], ['tier', t('np.modeTier'), t('np.modeTierHint')]],
      S.goals.mode, v => commit(() => { S.goals.mode = v; }, { goal: true }), 'np-seg-s'),
    chip(t('np.clearCard'), () => commit(() => { S.goals.items = {}; }, { goal: true }),
      { title: t('np.clearGoalsHint'), disabled: !!S.pending || !Object.keys(S.goals.items).length })));
  card.appendChild(h('p', 'np-note', t('np.goalsHint')));
  const pc = profCard();
  if (pc) card.appendChild(pc);

  const order = goalOrder();
  const chips = h('div', 'np-chips');
  for (const id of order) {
    const on = !!S.goals.items[id];
    const warn = id === '차속' && CHARGE_RULES[S.nikke.rid]?.cls === 'none';
    chips.appendChild(btn('np-chip' + (on ? ' on' : '') + (warn ? ' warn' : ''),
      [h('span', 'np-chipk', on ? '✓' : '+'), h('span', 'np-chipn', short(id))],
      () => commit(() => {
        if (on) delete S.goals.items[id];
        else S.goals.items[id] = { count: 1, minLv: 12, lvs: [12], eff: null };
      }, { goal: true }),
      { title: warn ? t('np.chargeNone') : null, 'aria-pressed': String(on) }));
  }
  card.appendChild(chips);

  const ids = order.filter(id => S.goals.items[id]);
  if (!ids.length) { card.appendChild(h('p', 'np-empty', t('np.noGoal'))); return card; }

  const list = h('div', 'np-glist');
  for (const id of ids) {
    const g = S.goals.items[id];
    const pr = prog.find(p => p.opt === id);
    const row = h('div', 'np-grow' + (pr?.ok ? ' ok' : ''));
    /* 머리 줄 - 이름 · 줄 수 · (목표 단계면) 단계 배지 · 빼기 */
    const head = h('div', 'np-ghead', h('span', 'np-gname', short(id)));
    if (!g.eff) {
      const st = stepper(g.count, v => commit(() => { g.count = v; g.lvs = fitLvs(g.lvs, v, g.minLv); }, { goal: true }), { min: 1, max: 4, label: t('np.lines') });
      st.title = t('np.lines');
      head.appendChild(st);
      if (S.goals.mode === 'tier') head.appendChild(lvBadges(id, g));
    }
    head.append(h('span', 'np-gsp'),
      btn('np-gx', '✕', () => commit(() => { delete S.goals.items[id]; }, { goal: true }), { 'aria-label': t('np.remove'), title: t('np.remove') }));
    row.appendChild(head);

    const ctl = h('div', 'np-gctl');
    if (EFF_OPTS[id]) {
      ctl.appendChild(seg([['n', t('np.byLines')], ['eff', t('np.byEff')]], g.eff ? 'eff' : 'n',
        v => commit(() => { g.eff = v === 'eff' ? { min: defaultEff(id), model: 'pct' } : null; }, { goal: true }), 'np-seg-s'));
    }
    if (!g.eff) {
      if (S.goals.mode === 'lv') {
        ctl.appendChild(h('span', 'np-gfield', t('np.minLv'),
          stepper(g.minLv, v => commit(() => { g.minLv = v; }, { goal: true }), { min: 1, max: MAX_LV, label: t('np.minLv') }),
          h('span', 'np-gval' + olLevelCls(g.minLv), `(${pctOf(id, g.minLv)})`)));
      }
    } else {
      const cfg = effCfg(id, g, { baseAmmo: S.nikke.baseAmmo || 0, chargeTime: S.nikke.chargeTime || 1 });
      if (EFF_OPTS[id] === 'charge') {
        ctl.appendChild(seg([['pct', t('np.effPct')], ['time', t('np.effTime')]], g.eff.model,
          v => commit(() => { g.eff.model = v; g.eff.min = v === 'time' ? 6 : 10; }, { goal: true }), 'np-seg-s'));
      }
      const unit = EFF_OPTS[id] === 'ammo' ? t('np.unitShots') : g.eff.model === 'time' ? t('np.unitCs') : '%';
      ctl.appendChild(h('span', 'np-gfield', t('np.effMin'),
        stepper(g.eff.min, v => commit(() => { g.eff.min = v; }, { goal: true }), { min: 1, max: 999, label: t('np.effMin') }),
        h('small', 'np-unit', unit)));
      const need = EFF_OPTS[id] === 'ammo' ? !S.nikke.baseAmmo : g.eff.model === 'time' && !S.nikke.chargeTime;
      if (need) ctl.appendChild(h('p', 'np-warn', t(EFF_OPTS[id] === 'ammo' ? 'np.needAmmo' : 'np.needCharge')));
      if (pr?.eff) {
        ctl.appendChild(h('p', 'np-explain',
          pr.res.groups.length ? explainEff(cfg, pr.res) + ` = ${fmtEff(cfg, pr.have)}` : t('np.effNone'),
          h('small', null, ' · ' + t('np.effShown', (pr.res.shown / 100).toFixed(2) + '%'))));
      }
    }
    if (ctl.childNodes.length) row.appendChild(ctl);
    list.appendChild(row);
  }
  card.appendChild(list);

  /* 보존 조건 */
  if (ids.some(id => S.goals.items[id].eff)) {
    const cb = h('input', { type: 'checkbox', checked: !S.keep.allowDrop });
    cb.onchange = () => commit(() => { S.keep.allowDrop = !cb.checked; });
    card.appendChild(h('label', 'np-keep', cb, h('span', null, t('np.keepFloor'))));
  }
  return card;
}

/* 목표 단계 - 줄마다 단계 배지. 누르면 1~15 고르는 칸이 바로 아래에 뜬다 (순서는 상관없다 - 어느 줄이 어느 단계를 채워도 된다) */
function lvBadges(id, g) {
  const lvs = fitLvs(g.lvs, g.count, g.minLv);
  const wrap = h('span', 'np-lvbadges');
  lvs.forEach((lv, k) => {
    const open = ui.lvPick && ui.lvPick.id === id && ui.lvPick.k === k;
    wrap.appendChild(btn('np-lvbadge' + olLevelCls(lv) + (open ? ' open' : ''), String(lv),
      () => repaint(() => { ui.lvPick = open ? null : { id, k }; }),
      { title: `${t('np.tierN', k + 1)} · Lv.${lv} (${pctOf(id, lv)})`, 'aria-label': t('np.pickLv', k + 1), 'aria-expanded': String(open) }));
  });
  const k = ui.lvPick && ui.lvPick.id === id ? ui.lvPick.k : -1;
  if (k >= 0 && k < lvs.length) {
    const pick = h('div', { class: 'np-lvpick', role: 'group', 'aria-label': t('np.pickLv', k + 1) });
    for (let v = 1; v <= MAX_LV; v++) {
      pick.appendChild(btn('np-lvopt' + olLevelCls(v) + (v === lvs[k] ? ' on' : ''), String(v),
        () => {
          ui.lvPick = null;
          commit(() => { const next = fitLvs(g.lvs, g.count, g.minLv); next[k] = v; g.lvs = next; }, { goal: true });
        }, { title: `Lv.${v} (${pctOf(id, v)})`, 'aria-pressed': String(v === lvs[k]) }));
    }
    wrap.appendChild(pick);
  }
  return wrap;
}

/* [계산] - 누르기 전에는 아무것도 계산하지 않는다 */
function calcRow(step) {
  const fresh = S.armed && ui.rec && ui.rec.stateNo === S.stateNo;
  return h('div', 'np-calcrow',
    btn('np-calc' + (S.armed ? ' done' : '') + (step === 'calc' ? ' np-next' : ''),
      S.armed ? (fresh || ui.busy ? '✓ ' + t('np.calcDone') : t('np.calc')) : t('np.calc'), calc,
      { disabled: S.armed || !Object.keys(S.goals.items).length }),
    h('span', 'np-note', S.armed ? t('np.calcArmed') : t('np.calcHint')));
}
const defaultEff = id => (EFF_OPTS[id] === 'ammo' ? Math.max(1, Math.round((S.nikke.baseAmmo || 6) * 1.5)) : 10);

/* ── 다음에 볼 곳 ─────────────────────────────────────────── */
/* 흐름상 지금 확인하거나 눌러야 하는 곳 하나 - 그 요소에 np-next (붉은 네온) 를 붙인다 */
function nextStep() {
  const pd = S.pending;
  if (pd) {
    if (!pd.result) return 'form';
    return pd.kind === 'first' || (ui.cmp && ui.cmp.tryId === pd.tryId && !ui.cmp.busy) ? 'choose' : null;
  }
  if (ui.askProf || ui.askScope) return null;
  if (!Object.keys(S.goals.items).length) return 'goals';
  if (!S.armed) return 'calc';
  const v = recView();
  if (!v || ui.rec.status !== 'go') return null;
  if (S.focus == null) return 'tiles';
  const pr = v.pieces[S.focus];
  if (!pr.ok || !(pr.v > 0)) return 'tiles';
  return S.plan?.kind ? 'go' : 'kinds';
}

/* ── 렌더: 실행 문구·재화 ─────────────────────────────────── */
function actionText(a) {
  const piece = t('np.piece_' + a.piece);
  if (a.kind === 'first') return t('np.doFirst', piece);
  const prot = a.protect.map(p => t('np.protOne', p.line + 1, t(p.mat === 'key' ? 'np.matKey' : p.fresh ? 'np.matPermNew' : 'np.matPerm')));
  return t(a.kind === 'reset' ? 'np.doReset' : 'np.doChange', piece, prot.length ? prot.join(', ') : t('np.noProtect'));
}
const kindLabel = kind => t(kind === 'first' ? 'np.kindFirst' : kind === 'reset' ? 'np.kindReset' : 'np.kindChange');
const lockText = protect => (protect.length
  ? protect.map(p => t('np.protOne', p.line + 1, t(p.mat === 'key' ? 'np.lockS_key' : 'np.lockS_new'))).join(', ') : t('np.lockS_none'));
/* 모듈·락키 수 - 재화 이름 대신 아이콘 */
const icMod = () => itemIcon(ITEM.module, t('np.mod'));
const icKey = () => itemIcon(ITEM.lockKey, t('np.key'));
const costNode = c => h('span', 'np-cost', icMod(), String(c.mod), c.key ? [' + ', icKey(), String(c.key)] : null);
const meanNode = (m, k) => h('span', 'np-cost', icMod(), num(m), ' · ', icKey(), num(k));
const pct = x => (x >= 0.99995 ? '100%' : x < 0.00005 ? '0%' : (x * 100).toFixed(x < 0.1 ? 2 : 1) + '%');
const goalChip = x => h('span', 'np-pchip', short(x.opt) + (x.m > 1 ? ` ${x.m}+` : ''));

function banner(kind, title, desc) {
  return h('div', 'np-banner np-b-' + kind, h('b', null, title), desc ? h('span', null, desc) : null);
}

/* ── 렌더: 네 부위 ───────────────────────────────────────── */
function scopeSeg() {
  return seg([['all', t('np.scopeAll'), t('np.scopeAllHint')], ['piece', t('np.scopePiece'), t('np.scopePieceHint')]], S.scope,
    v => { if (!S.pending && v !== S.scope) commit(() => { S.scope = v; S.scopeAsked = true; }, { run: true }); }, 'np-seg-s');
}

function renderGear(step) {
  const card = h('section', 'np-card np-gearcard');
  const init = initialGear();
  card.appendChild(h('div', 'np-cardhead', h('h3', null, t('np.gear')),
    h('span', 'np-headchips',
      chip(t('np.restore'), () => resetGear(init), { title: t('np.restoreHint'), disabled: !!S.pending || !init || sameGear(init, S.gear) && !S.log.length }),
      chip(t('np.clearCard'), () => resetGear(null), { title: t('np.clearGearHint'), disabled: !!S.pending || !S.gear.some(g => g.overloaded) })),
    scopeSeg()));
  const v = recView();
  const live = v && ui.rec.status === 'go';
  const grid = h('div', 'np-pieces' + (step === 'tiles' ? ' np-next' : ''));
  S.gear.forEach((g, p) => grid.appendChild(pieceTile(g, p, v, live)));
  card.appendChild(grid);

  const r = ui.rec && ui.rec.stateNo === S.stateNo ? ui.rec : null;
  if (!Object.keys(S.goals.items).length) { card.appendChild(h('p', 'np-empty', t('np.noGoal'))); return card; }
  if (!S.armed) {
    card.appendChild(banner('check', t(ui.rec ? 'np.st_stale' : 'np.st_ready'), t(ui.rec ? 'np.st_staleDesc' : 'np.st_readyDesc')));
    card.appendChild(calcRow(step));
    return card;
  }
  if (ui.err) card.appendChild(banner('check', t('np.st_err'), ui.err));
  if (!r) { card.appendChild(h('div', 'np-skel', h('span', 'np-spin'), t('np.computingLong'))); return card; }
  if (r.status === 'done') card.appendChild(banner('done', t('np.st_done'), t('np.st_doneDesc')));
  else if (r.status === 'impossible') card.appendChild(banner('check', t('np.st_impossible'), t('np.st_impossibleDesc')));
  else if (v && S.scope === 'all') {
    card.appendChild(h('p', 'np-note np-total', t('np.totalMean'), ' ', meanNode(v.m, v.k), ' · ', t('np.triesAvg', num(v.t)),
      S.focus == null ? [' · ', h('b', null, t('np.tileHint'))] : null));
  }
  card.appendChild(calcRow(step));
  return card;
}

/* 줄의 잠금 상태 - 선택 부위는 이번 실행의 잠금 설정, 그 밖의 부위는 이미 걸린 모듈 잠금 */
function lockStateOf(g, p, i) {
  const mat = S.focus === p && S.plan?.piece === p ? S.plan.prot?.[i] || null : g.perm[i] === true ? 'perm' : null;
  return !mat ? 'none' : mat === 'key' ? 'key' : g.perm[i] === true ? 'held' : 'new';
}
const lockChip = (g, p, i) => {
  const st = lockStateOf(g, p, i);
  return h('span', { class: 'np-tlock np-tlock-' + st, title: t('np.lockS_' + st), 'aria-label': t('np.lockS_' + st) }, LOCK_ICON[st]);
};

/* 부위 타일 - 누르면 그 부위를 고른다. 남은 기대 비용은 네 부위 모두에 보이고, 가장 싼 부위는 표시만 한다. */
function pieceTile(g, p, v, live) {
  const pr = v?.pieces[p];
  const on = S.focus === p;
  const done = !!pr && pr.ok && !(pr.v > 0);
  const tg = targetsOf(p);
  const head = h('span', 'np-phead', h('span', 'np-pname', t('np.piece_' + p)),
    on ? h('span', 'np-tbadge sel', t('np.picked')) : null,
    live && v.cheapest === p ? h('span', 'np-tbadge cheap', t('np.badgeCheapest')) : null,
    done ? h('span', 'np-tbadge ok', t('np.pieceOk')) : null);
  const lines = g.overloaded
    ? g.lines.map((l, i) => {
      const goal = l.opt && tg?.find(x => x.opt === l.opt);
      return h('span', 'np-tline ' + (l.opt ? lvCls(l.lv) : 'empty') + (goal ? (l.lv >= goal.m ? ' goal' : ' short') : ''),
        l.opt ? [h('span', 'np-lopt', short(l.opt)), h('span', 'np-lvb' + olLevelCls(l.lv), String(l.lv)), lockChip(g, p, i)] : t('np.empty'));
    })
    : [h('span', 'np-tline empty', t('np.notOlS'))];
  const foot = h('span', 'np-tfoot');
  if (tg && tg.length) foot.appendChild(h('span', 'np-tgoals', tg.map(goalChip)));
  if (pr && pr.ok && pr.v > 0) foot.appendChild(h('span', 'np-tcost', meanNode(pr.m, pr.k), ' · ', t('np.triesAvg', num(pr.t))));
  else if (pr && !pr.ok) foot.appendChild(h('span', 'np-tcost', t('np.st_impossible')));
  return btn('np-piece' + (on ? ' on' : '') + (g.overloaded ? '' : ' off') + (done ? ' done' : ''), [head, ...lines, foot],
    () => selectPiece(p), { 'aria-pressed': String(on), disabled: !!S.pending });
}

/* ── 렌더: 선택 부위 (개조 장비 효과) ─────────────────────── */
const LOCK_ICON = { none: '🔓', held: '🔒', new: '🔒', key: '🗝' };

/* 자물쇠 - 이번 실행의 잠금: 없음 → 모듈 잠금 → 락키 잠금 → 없음. 새로 거는 잠금은 이번 비용에 들어간다. */
function toggleLock(i) {
  const g = S.gear[S.focus];
  if (S.pending || !S.plan || !g.lines[i].opt) return;
  repaint(() => {
    const cur = S.plan.prot[i];
    const next = !cur ? 'perm' : cur === 'perm' ? 'key' : null;
    if (next && !cur && Object.keys(S.plan.prot).length >= 2) return;    // 보호는 2줄까지
    if (next) S.plan.prot[i] = next; else delete S.plan.prot[i];
    S.plan.auto = false;
    save();
  });
}

function renderPanel(step) {
  const p = S.focus;
  const card = h('section', 'np-card np-panel');
  if (p == null) {
    card.appendChild(h('div', 'np-cardhead', h('h3', null, t('np.panel'))));
    card.appendChild(h('p', 'np-empty', t('np.panelNone')));
    return card;
  }
  const g = S.gear[p], pr = pieceRec(p), rec = pr?.act || null, init = initialGear();
  const mine = S.log.filter(x => x.piece === p);
  const last = mine.at(-1);
  const olcb = h('input', { type: 'checkbox', checked: g.overloaded, disabled: !!S.pending });
  olcb.onchange = () => commit(() => {
    g.overloaded = olcb.checked;
    if (!g.overloaded) { g.lines = [E(), E(), E()]; g.perm = [false, false, false]; }
    S.plan = null;
  });
  card.appendChild(h('div', 'np-cardhead',
    h('h3', null, `${t('np.piece_' + p)} · ${t('np.panel')}`),
    mine.length ? h('span', 'np-meta', t('np.roundInfo', mine.length, last.choice ? t('np.choice_' + last.choice) : t('np.pendingS'))) : null,
    h('span', 'np-headchips',
      chip(t('np.restore'), () => resetPiece(p, init[p]), { title: t('np.restorePieceHint'),
        disabled: !!S.pending || !init || sameGear([init[p]], [g]) && !mine.length }),
      chip(t('np.clearCard'), () => resetPiece(p, null), { title: t('np.clearPieceHint'), disabled: !!S.pending || !g.overloaded })),
    h('label', 'np-olt', olcb, h('span', null, t('np.overloaded')))));
  card.appendChild(targetRow(p, pr));

  const box = h('div', 'np-fx');
  if (!g.overloaded) box.appendChild(h('p', 'np-poff', t('np.notOverloaded')));
  else g.lines.forEach((l, i) => box.appendChild(lineRow(g, p, i, rec)));
  card.appendChild(box);

  const done = !!pr && !(pr.v > 0);
  if (done) { card.appendChild(banner('done', t('np.pieceDone'), t('np.pieceDoneDesc'))); return card; }

  /* 효과 변경 / 수치 재설정 */
  if (ui.recMoved) card.appendChild(h('p', 'np-warn np-moved', t('np.recMoved')));
  const kindBtn = kind => {
    const a = actionFor(kind);
    const probs = a ? actionProblems(a) : [];
    return btn(`np-kind np-kind-${kind}` + (S.plan.kind === kind ? ' on' : ''), [
      h('span', 'np-kindttl', kindLabel(kind)),
      a ? h('span', 'np-kindcost', costNode(a.cost)) : null,
      rec && rec.kind === kind ? h('span', 'np-recb', t('np.recommended')) : null,
      probs.length ? h('span', 'np-prob', t('np.prob_' + probs[0])) : null,
    ], () => repaint(() => { S.plan.kind = kind; ui.recMoved = false; save(); }),
    { disabled: !!S.pending || !S.armed || !pr || probs.length > 0, 'aria-pressed': String(S.plan.kind === kind) });
  };
  card.appendChild(h('div', 'np-kinds' + (step === 'kinds' ? ' np-next' : ''),
    g.overloaded ? [kindBtn('change'), kindBtn('reset')] : kindBtn('first')));
  if (!S.armed) card.appendChild(h('p', 'np-prob', t('np.prob_calc')));

  /* 이번 소모와 실행 */
  const a = currentAction();
  if (a) {
    const lockPart = tryCost(a.protect.map(x => ({ ...x, fresh: false })));
    const fresh = { mod: a.cost.mod - lockPart.mod, key: a.cost.key };
    const probs = actionProblems(a);
    card.appendChild(h('div', 'np-confirm',
      h('div', 'np-confirmcost', h('span', 'np-flbl', t('np.thisCost')), costNode(a.cost),
        fresh.mod || fresh.key ? h('small', null, `(${t('np.costSplit', lockPart.mod, fresh.mod, fresh.key)})`) : null,
        a.cost.estimated ? h('small', 'np-est', t('np.estimated')) : null),
      a.unlock.length ? h('div', 'np-dosub', t('np.unlockLines', a.unlock.map(i => i + 1).join(', '))) : null,
      h('div', 'np-goRow',
        btn('np-go' + (step === 'go' ? ' np-next' : ''), `${kindLabel(a.kind)} · ${S.source === 'sim' ? t('np.goSim') : t('np.goReal')}`, execute,
          { disabled: !!S.pending || !S.armed || probs.length > 0 }),
        rec && !matchesRec(a, rec) ? btn('np-follow', t('np.followRec'), followRec, { disabled: !!S.pending }) : null,
        probs.map(x => h('span', 'np-prob', t('np.prob_' + x))))));
  }
  if (pr) card.appendChild(basisTable(g, pr, rec));
  return card;
}

/* 이 부위의 목표 - 선택한 부위만 최적화에서는 직접 고친다 */
function targetRow(p, pr) {
  const tg = targetsOf(p);
  const custom = S.scope === 'piece' && !!S.pieceGoals[p];
  const row = h('div', 'np-tgrow', h('span', 'np-flbl', t('np.pieceGoal')),
    h('span', 'np-tgchips', tg ? (tg.length ? tg.map(goalChip) : t('np.nothingHere')) : '-'),
    h('span', 'np-meta', t(custom ? 'np.pieceGoalCustom' : 'np.pieceGoalAuto')));
  if (!custom) return row;
  row.appendChild(btn('np-pgb' + (ui.pgEdit ? ' on' : ''), t(ui.pgEdit ? 'np.pgDone' : 'np.pgEdit'),
    () => repaint(() => { ui.pgEdit = !ui.pgEdit; }), { disabled: !!S.pending, 'aria-expanded': String(!!ui.pgEdit) }));
  if (!ui.pgEdit) return row;
  const list = S.pieceGoals[p];
  const change = fn => commit(() => { fn(S.pieceGoals[p]); }, { run: true });
  const ed = h('div', 'np-pged');
  list.forEach((x, n) => {
    const sel = h('select', { class: 'np-sel', 'aria-label': t('np.option') },
      D.opts.map(o => h('option', { value: o.id, disabled: list.some((y, j) => j !== n && y.opt === o.id), selected: x.opt === o.id }, short(o.id))));
    sel.onchange = () => change(l => { l[n].opt = sel.value; });
    ed.appendChild(h('div', 'np-erow', sel,
      h('span', 'np-gfield', t('np.minLv'), stepper(x.m, v => change(l => { l[n].m = v; }), { min: 1, max: MAX_LV, label: t('np.minLv') }),
        h('span', 'np-gval' + olLevelCls(x.m), `(${pctOf(x.opt, x.m)})`)),
      btn('np-gx', '✕', () => change(l => { l.splice(n, 1); }), { 'aria-label': t('np.remove'), title: t('np.remove') })));
  });
  const free = goalOrder().find(id => !list.some(y => y.opt === id));
  ed.appendChild(h('div', 'np-ebtns',
    btn('np-cancel', t('np.pgAdd'), () => change(l => { l.push({ opt: free, m: 12 }); }), { disabled: list.length >= 3 || !free }),
    btn('np-cancel', t('np.pgReset'), () => commit(() => { delete S.pieceGoals[p]; }, { run: true }))));
  row.appendChild(ed);
  return row;
}

function lineRow(g, p, i, rec) {
  const l = g.lines[i];
  const goal = l.opt && targetsOf(p)?.find(x => x.opt === l.opt);
  const mat = S.plan?.prot?.[i] || null;
  const st = lockStateOf(g, p, i);
  const recMat = rec && rec.kind !== 'first' ? (rec.protect.find(x => x.line === i)?.mat || null) : undefined;
  const editing = ui.edit && ui.edit.p === p && ui.edit.i === i;
  const cls = ['np-line', l.opt ? lvCls(l.lv) : 'empty', goal ? (l.lv >= goal.m ? 'goal' : 'short') : l.opt ? 'junk' : '',
    mat ? 'prot-' + mat : '', editing ? 'editing' : ''].join(' ');
  const row = h('div', 'np-lrow');
  row.appendChild(h('div', cls,
    h('span', 'np-lno', String(i + 1)),
    l.opt ? h('span', 'np-lopt', short(l.opt)) : h('span', 'np-lempty', t('np.empty')),
    l.opt ? h('span', 'np-lvb' + olLevelCls(l.lv), String(l.lv)) : null,
    l.opt ? h('span', 'np-lval', `(${pctOf(l.opt, l.lv)})`) : h('span', 'np-lsp', Math.round(SLOT_P[i] * 100) + '%'),
    l.opt && recMat !== undefined && recMat !== mat
      ? h('span', 'np-ptag np-ptag-rec', t(recMat === 'key' ? 'np.recKey' : recMat ? 'np.recLock' : 'np.recOpen')) : null));
  if (l.opt) {
    const title = t('np.lockRun_' + st);
    row.appendChild(btn('np-lockb np-lockb-' + st, [LOCK_ICON[st], h('small', null, t('np.lockS_' + st))],
      () => toggleLock(i), { title, 'aria-label': title, disabled: !!S.pending }));
  }
  row.appendChild(btn('np-editb' + (editing ? ' on' : ''), '✎', () => repaint(() => { ui.edit = editing ? null : { p, i }; }),
    { title: t('np.editLine'), 'aria-label': t('np.editLine'), 'aria-expanded': String(!!editing), disabled: !!S.pending }));
  if (editing) row.appendChild(lineEditor(g, p, i));
  return row;
}

function lineEditor(g, p, i) {
  const l = g.lines[i];
  const box = h('div', 'np-editor');
  const others = new Set(g.lines.filter((x, j) => j !== i && x.opt).map(x => x.opt));
  const sel = h('select', { class: 'np-sel', 'aria-label': t('np.option') },
    h('option', { value: '' }, i === 0 ? t('np.pickOpt') : t('np.emptyOpt')),
    D.opts.map(o => h('option', { value: o.id, disabled: others.has(o.id), selected: l.opt === o.id }, short(o.id))));
  let lv = l.opt ? l.lv : FIRST_LV;
  const pctText = (id, v) => (id ? `(${pctOf(id, v)})` : '');
  const val = h('span', 'np-gval', pctText(l.opt, lv));
  const lvBox = h('span');
  const paintLv = () => {
    lvBox.textContent = '';
    lvBox.appendChild(stepper(lv, v => { lv = v; val.textContent = pctText(sel.value, lv); paintLv(); }, { label: t('np.level') }));
  };
  paintLv();
  sel.onchange = () => { val.textContent = pctText(sel.value, lv); };
  const held = h('input', { type: 'checkbox', checked: g.perm[i] === true });
  const save1 = () => commit(() => {
    const id = sel.value;
    g.lines[i] = id ? { opt: id, lv } : E();
    g.perm[i] = !!id && held.checked;
    S.plan = null;                    // 잠금 설정은 새 장비 값에서 다시 잡는다
    ui.edit = null;
  });
  box.append(
    h('div', 'np-erow', h('span', 'np-elbl', t('np.option')), sel),
    h('div', 'np-erow', h('span', 'np-elbl', t('np.level')), lvBox, val),
    h('label', 'np-erow np-held', held, h('span', null, t('np.heldAlready'))),
    h('div', 'np-ebtns',
      btn('np-ok', t('np.set'), () => { document.activeElement?.blur?.(); save1(); }),
      btn('np-cancel', t('np.cancel'), () => repaint(() => { ui.edit = null; }))));
  return box;
}

/* 판단 근거 - 지금 잠금에서의 효과 변경·수치 재설정과 추천 행동을 같은 기준으로 나란히 */
function basisTable(g, pr, rec) {
  const wrap = h('div', 'np-basis');
  wrap.appendChild(h('div', 'np-basisttl', t('np.basis')));
  const best = pr.options.find(o => o.best) || null;
  const rows = [];
  if (!g.overloaded) rows.push({ label: kindLabel('first'), cost: { mod: 1, key: 0 }, o: { m: pr.m, k: pr.k, t: pr.t }, rec: true, sel: S.plan?.kind === 'first' });
  else {
    for (const kind of ['change', 'reset']) {
      const a = actionFor(kind);
      if (!a) continue;
      const skip = actionProblems(a).includes('nothing');
      /* 엔진은 목표 줄만 잠그고, 수치 재설정은 풀린 목표 줄 가운데 미달인 줄이 있을 때만 평가한다 */
      const onGoal = a.protect.every(x => pr.S.some(y => y.opt === g.lines[x.line].opt));
      rows.push({ label: kindLabel(kind), sub: lockText(a.protect), cost: a.cost, o: skip ? null : a.opt,
        na: skip ? 'np.prob_nothing' : kind === 'reset' && onGoal ? 'np.naReset' : 'np.notEvaluated',
        rec: matchesRec(a, rec), sel: S.plan?.kind === kind });
    }
    if (rec && best && !rows.some(x => x.rec)) rows.push({ label: kindLabel(rec.kind), sub: lockText(rec.protect), cost: rec.cost, o: best, rec: true, sel: false });
  }
  const tb = h('table', 'np-btable');
  tb.appendChild(h('thead', null, h('tr', null,
    ['np.colAct', 'np.colCost', 'np.colGoal', 'np.colBetter', 'np.colRemain', 'np.colTries'].map(k => h('th', null, t(k))))));
  const body = h('tbody');
  for (const x of rows) {
    const o = x.o;
    const tr = h('tr', (x.rec ? 'rec' : '') + (x.sel ? ' sel' : ''));
    tr.appendChild(h('th', null, h('b', null, x.label), x.rec ? h('span', 'np-recb', t('np.recommended')) : null,
      x.sub ? h('small', null, x.sub) : null));
    tr.appendChild(h('td', null, costNode(x.cost)));
    if (!o) tr.appendChild(h('td', { class: 'na', colspan: '4' }, t(x.na)));
    else {
      const dm = best && o.v != null ? o.m - best.m : 0, dk = best && o.v != null ? o.k - best.k : 0;
      const worse = best && o.v != null && o.v > best.v + 1e-6;
      const sign = d => (d > 0 ? '+' : '') + num(d);
      tr.append(
        h('td', null, o.pGoal == null ? '-' : pct(o.pGoal)),
        h('td', null, o.pBetter == null ? '-' : pct(o.pBetter)),
        h('td', null, meanNode(o.m, o.k),
          worse ? h('small', 'np-worse', '(', icMod(), sign(dm), Math.abs(dk) >= 0.05 ? [' · ', icKey(), sign(dk)] : null, ')') : null),
        h('td', null, t('np.timesN', num(o.t))));
    }
    body.appendChild(tr);
  }
  tb.appendChild(body);
  wrap.appendChild(h('div', 'np-btwrap', tb));
  wrap.appendChild(h('div', 'np-basisfoot',
    h('span', 'np-note', t('np.basisNote')),
    seg([['mod', t('np.pref_mod'), t('np.prefHint_mod')], ['balanced', t('np.pref_balanced'), t('np.prefHint_balanced')], ['key', t('np.pref_key'), t('np.prefHint_key')]],
      S.pref, v => { if (!S.pending) commit(() => { S.pref = v; }, { run: true }); }, 'np-seg-s')));
  return wrap;
}

/* ── 렌더: 결과 창 ────────────────────────────────────────── */
/* 게임 화면처럼 위에 현재 효과, 아래에 변경 효과를 두고 효과 유지 / 효과 변경을 고른다 */
function renderModal(prog, step) {
  const pd = S.pending;
  const bg = h('div', 'np-modalbg');
  const box = h('div', { class: 'np-modal np-result', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('np.resultTitle') });
  box.appendChild(h('div', 'np-modalhead',
    h('span', null, `${t('np.piece_' + pd.piece)} · ${kindLabel(pd.kind)}`),
    h('span', 'np-meta', costNode(pd.cost), ' ', t('np.paid'))));

  const frame = (title, lines, cls, isNew) => h('div', 'np-frame ' + cls, h('div', 'np-framettl', title),
    lines.map((l, i) => {
      const prot = pd.protect.some(x => x.line === i);
      const moved = isNew && (l.opt !== pd.before[i].opt || l.lv !== pd.before[i].lv);
      return h('div', 'np-ovslot ' + (l.opt ? lvCls(l.lv) : 'empty') + (moved ? ' moved' : ''),
        h('span', 'np-lno', String(i + 1)),
        h('span', null, l.opt ? short(l.opt) : t('np.none')),
        l.opt ? h('span', 'np-ovval', `${l.lv} (${pctOf(l.opt, l.lv)})`) : null,
        prot ? h('span', 'np-lock', '🔒') : null);
    }));
  const body = h('div', 'np-rbody');
  if (pd.kind !== 'first') body.append(frame(t('np.cur'), pd.before, 'cur', false), h('div', 'np-rarrow', '▼'));
  if (pd.result) body.appendChild(frame(t('np.new'), pd.result, 'new', pd.kind !== 'first'));
  else {
    const form = resultForm(pd);
    if (step === 'form') form.classList.add('np-next');
    body.appendChild(form);
  }
  box.appendChild(body);

  const c = pd.result && ui.cmp && ui.cmp.tryId === pd.tryId ? ui.cmp : null;
  if (pd.result) {
    const cmp = h('div', 'np-cmp');
    if (pd.kind === 'first') cmp.appendChild(h('p', 'np-note', t('np.firstNoKeep')));
    else if (!c || c.busy) cmp.appendChild(h('p', 'np-note', h('span', 'np-spin'), t('np.comparing')));
    else if (c.err) cmp.appendChild(h('p', 'np-warn', c.err));
    else {
      if (c.breaks.length) cmp.appendChild(h('p', 'np-warn', t('np.breaks', c.breaks.map(short).join(', '))));
      const d = c.prog1.filter((x, i) => JSON.stringify(x.have) !== JSON.stringify(c.prog0[i].have));
      if (d.length) cmp.appendChild(h('p', 'np-note', t('np.delta') + ' ' + d.map(x => {
        const y = c.prog0.find(z => z.opt === x.opt);
        return `${short(x.opt)} ${x.eff ? fmtEff(x.cfg, y.have) : y.have} → ${x.eff ? fmtEff(x.cfg, x.have) : x.have}`;
      }).join(', ')));
    }
    if (cmp.childNodes.length) box.appendChild(cmp);
  }

  const ready = c && !c.busy && !c.err;
  const best = ready ? c.choice : null;
  const pick = (cls, label, side, choice) => btn(`np-mb ${cls}` + (best === choice ? ' rec' : ''), [
    h('span', null, label),
    ready ? h('small', 'np-mbcost', t('np.remainAfter'), ' ', meanNode(side.m, side.k)) : null,
    best === choice ? h('small', 'np-recb', t('np.recommended')) : null], () => choose(choice));
  const btns = h('div', 'np-modalbtns');
  btns.appendChild(btn('np-mb np-mb-cancel', [t('np.cancelTry'), h('small', null, 'Esc')], cancelPending, { title: t('np.cancelTryHint') }));
  const picks = h('div', 'np-picks' + (step === 'choose' ? ' np-next' : ''));
  if (pd.result && pd.kind === 'first') picks.appendChild(btn('np-mb np-mb-apply', '✓ ' + t('np.firstOk'), () => choose('accept')));
  else if (pd.result) picks.append(pick('np-mb-keep', t('np.keep'), c?.keep, 'keep'), pick('np-mb-apply', t('np.apply'), c?.acc, 'accept'));
  btns.appendChild(picks);
  box.appendChild(btns);
  box.appendChild(h('p', 'np-note np-modalfoot', t('np.paidNote'), ' ', t('np.cancelTryHint')));
  bg.appendChild(box);
  return bg;
}

/* 처음 계산할 때 한 번 - 전체 부위를 함께 볼지, 고른 부위만 볼지 */
function renderAskScope() {
  const close = () => { ui.askScope = false; paint(); };
  const bg = h('div', 'np-modalbg');
  bg.onclick = e => { if (e.target === bg) close(); };
  const box = h('div', { class: 'np-modal np-ask', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('np.askScopeTitle') });
  box.appendChild(h('div', 'np-modalhead', h('span', null, t('np.askScopeTitle'))));
  const body = h('div', 'np-askbody');
  body.appendChild(h('p', 'np-note', t('np.askScopeDesc')));
  for (const v of ['all', 'piece']) {
    body.appendChild(btn('np-askopt np-askscope', [h('b', null, t(v === 'all' ? 'np.scopeAll' : 'np.scopePiece')),
      h('span', null, t(v === 'all' ? 'np.scopeAllHint' : 'np.scopePieceHint'))], () => {
      ui.askScope = false;
      S.scope = v; S.scopeAsked = true; S.stateNo++;
      calc();
    }));
  }
  box.appendChild(body);
  box.appendChild(h('div', 'np-modalbtns', btn('np-mb np-mb-cancel', [t('np.cancel'), h('small', null, 'Esc')], close)));
  bg.appendChild(box);
  return bg;
}

/* 실전 기록 - 게임에서 나온 세 줄을 입력한다 */
function resultForm(pd) {
  const wrap = h('div', 'np-side new np-form');
  wrap.appendChild(h('div', 'np-sidettl', t('np.enterResult')));
  const prot = pd.protect.map(x => x.line);
  if (!ui.draft) ui.draft = draftFrom(pd);
  ui.draft.forEach((l, i) => {
    const locked = prot.includes(i);
    const typeFixed = pd.kind === 'reset';
    const row = h('div', 'np-frow');
    row.appendChild(h('span', 'np-lno', String(i + 1)));
    const sel = h('select', { class: 'np-sel', disabled: locked || typeFixed, 'aria-label': t('np.lineN', i + 1) },
      h('option', { value: '' }, t('np.none')),
      D.opts.map(o => h('option', { value: o.id, selected: l.opt === o.id }, short(o.id))));
    sel.onchange = () => repaint(() => { ui.draft[i] = sel.value ? { opt: sel.value, lv: ui.draft[i].lv || (pd.kind === 'first' ? FIRST_LV : 1) } : E(); });
    row.appendChild(sel);
    if (l.opt && pd.kind !== 'first') {
      row.appendChild(locked ? h('span', 'np-gval', String(l.lv)) :
        stepper(l.lv || 1, v => repaint(() => { ui.draft[i] = { ...ui.draft[i], lv: v }; }), { label: t('np.level') }));
    } else if (l.opt) row.appendChild(h('span', 'np-gval', String(FIRST_LV)));
    if (locked) row.appendChild(h('span', 'np-lock', '🔒'));
    wrap.appendChild(row);
  });
  const errs = validateResult({ lines: pd.before }, pd.kind, prot, ui.draft);
  if (errs.length) wrap.appendChild(h('p', 'np-warn', errs.map(e => t('np.err_' + e)).join(' · ')));
  wrap.appendChild(btn('np-ok', t('np.confirmResult'), submitDraft, { disabled: errs.length > 0 }));
  return wrap;
}

/* ── 렌더: 기록 ───────────────────────────────────────────── */
function renderLog() {
  const det = h('details', { class: 'np-card np-log', open: ui.logOpen || null });
  det.ontoggle = () => { ui.logOpen = det.open; };
  det.appendChild(h('summary', null, h('h3', null, t('np.log')), h('span', 'np-meta', t('np.tries', S.log.length))));
  if (!S.log.length) { det.appendChild(h('p', 'np-note', t('np.logEmpty'))); }
  else {
    const ol = h('ol', { class: 'np-loglist', reversed: true });
    for (const x of S.log.slice(-40).reverse()) {
      ol.appendChild(h('li', null,
        h('span', 'np-logk', actionText(x)),
        h('span', 'np-logc', costNode(x.cost)),
        h('span', 'np-logr', x.choice ? t('np.choice_' + x.choice) + (x.advice && x.advice !== x.choice && x.kind !== 'first' ? ' · ' + t('np.againstAdvice') : '') : t('np.pendingS')),
        x.followed === false ? h('span', 'np-logm', t('np.manualS')) : null,
        x.src === 'sim' ? h('span', 'np-logm', t('np.srcSim')) : null));
    }
    det.appendChild(ol);
    det.appendChild(h('div', 'np-logbtns',
      btn('btn-reset', t('np.undo'), () => { if (confirm(t('np.undoConfirm'))) undoLast(); }),
      h('span', 'np-note', t('np.undoNote'))));
  }
  return det;
}

/* ── 페인트 ───────────────────────────────────────────────── */
function paint() {
  const root = mounted;
  if (!root) return;
  const focusId = document.activeElement?.id;
  /* 다시 그리는 동안 문서가 잠깐 짧아져 스크롤이 위로 밀린다 - 그리기 전 위치로 되돌린다 */
  const scrollAt = window.scrollY;
  const onTile = !!document.activeElement?.classList?.contains('np-piece');
  root.textContent = '';
  adoptRec();
  const step = nextStep();
  const prog = progress(D, engineGear(S.gear), S.goals, { baseAmmo: S.nikke.baseAmmo || 0, chargeTime: S.nikke.chargeTime || 1 });

  root.appendChild(searchRow());
  root.appendChild(renderRemote());
  /* 데이터 | 현재 OL 종합 | 변경된 OL 종합 */
  const base = baseline();
  const ref = new Map(olOf(base.gear).map(o => [o.name, o]));
  root.appendChild(h('div', 'np-datarow',
    renderData(),
    olCard(t('np.olNow'), base.gear, { src: base.src ? t(base.src === 'acct' ? 'np.olFromAcct' : 'np.olFromStart') : null }),
    olCard(t('np.olChanged'), S.gear, { ref })));
  const main = h('div', 'np-main');
  const goals = renderGoals(prog);
  if (step === 'goals') goals.classList.add('np-next');
  main.appendChild(goals);
  /* 메인 프레임 - 네 부위(부위 선택·계산) → 선택 부위(잠금·실행·판단 근거) → 기록 */
  const right = h('div', 'np-col');
  right.appendChild(renderGear(step));
  right.appendChild(renderPanel(step));
  right.appendChild(renderLog());
  main.appendChild(right);
  root.appendChild(main);
  if (S.pending) root.appendChild(renderModal(prog, step));
  else if (ui.askScope) root.appendChild(renderAskScope());
  else if (ui.askProf && PROF) {
    const p = ui.askProf === S.nikke.rid ? profOf(ui.askProf) : null;
    if (applicable(p).length) {
      root.appendChild(renderAskProf(p));
      if (ui.askFocus) { ui.askFocus = false; requestAnimationFrame(() => root.querySelector('.np-askopt')?.focus()); }
    } else ui.askProf = null;        // 미확정·효과작 보류 - 자동 목표 없음 (문서 「목표를 경로 계산에 넘길 때」)
  }
  if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
  else if (onTile) root.querySelector('.np-piece.on')?.focus({ preventScroll: true });
  if (window.scrollY !== scrollAt) window.scrollTo(0, scrollAt);
}

/* 바깥을 누르면 줄 편집을 닫는다. */
let wired = false;
function wireOutside() {
  if (wired) return;
  wired = true;
  document.addEventListener('click', e => {
    if (!mounted || !mounted.isConnected) return;
    /* 클릭 처리 중에 자기 칸을 다시 그리면(단계 스테퍼 등) e.target 이 문서에서 떨어져 closest() 로는 바깥으로 보인다.
       경로는 디스패치 때 정해지므로 composedPath() 로 판단한다. */
    const path = e.composedPath();
    const inside = sel => path.some(n => n instanceof Element && n.matches(sel));
    if (search && !search.list.hidden && !inside('.np-search')) search.close();
    let dirty = false;
    if (ui.edit && !inside('.np-lrow')) { ui.edit = null; dirty = true; }
    if (ui.lvPick && !inside('.np-lvbadges')) { ui.lvPick = null; dirty = true; }
    if (dirty) paint();
  });
  /* Esc - 결과 창이 떠 있으면 이번 시도 취소, 아니면 열려 있는 창·편집 칸을 닫는다 */
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !mounted?.isConnected) return;
    if (S.pending) { e.preventDefault(); cancelPending(); return; }
    if (ui.askProf) { ui.askProf = null; paint(); return; }
    if (ui.lvPick) { ui.lvPick = null; paint(); return; }
    if (ui.askScope) { ui.askScope = false; paint(); return; }
    if (ui.edit) { ui.edit = null; paint(); return; }
    if (ui.pgEdit) { ui.pgEdit = false; paint(); }
  });
}

export async function renderNipago(root, context) {
  ctx = context;
  mounted = root;
  search = null;                     // 언어가 바뀌었을 수 있다 - 검색 줄은 새로 만든다
  if (!D) {
    root.textContent = '';
    root.appendChild(h('p', 'notice', t('np.loading')));
    try { await loadAll(); }
    catch (err) {
      root.textContent = '';
      root.appendChild(h('p', 'notice notice-error', String(err.message || err)));
      return;
    }
    S = load();
    save();
  }
  wireOutside();
  paint();
  loadProfiles();
  loadNikkeStats();
  if (S.pending && S.pending.result && !ui.cmp) requestCompare();
  if (S.armed && (!ui.rec || ui.rec.stateNo !== S.stateNo)) requestRec();
}
