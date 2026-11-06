/* 니파고 탭 — 오버로드 옵션작 경로 추천.
   니케 한 명의 네 부위를 함께 보고, 결과가 나올 때마다 다음 한 번을 다시 계산한다.

   로직은 assets/nipago/ 에 있다 (DOM 없음 — tools/nipago_check.mjs 가 그대로 검증한다).
     rules.js      게임 규칙·비용·버전, 니케별 차속 분류
     effective.js  차속·장탄 동일 단계 묶음 반올림
     engine.js     부위 MDP · 네 부위 배분 · 유지/적용 · 추첨
     tables.js     미리 푼 부위 정책 파일 (data/nipago/, tools/nipago_tables.mjs 가 만든다)
     service.js    추천 한 건 조립 — worker.js 가 돌린다

   계산은 [계산] 을 눌러야 시작한다. 목표·장비를 고치면 다시 누를 때까지 멈추고,
   시뮬레이션 진행(실행·유지/적용·취소)은 그 계산을 이어 간다.

   흐름 (명세 23.4): 확정 상태 → 다음 설정 → 실행(이때 재화 차감) → 새 결과(미확정)
                    → 유지/적용 비교 → 실제 선택 → 다음 행동 재계산 */

import { optionLabel, olRows, SLOTS } from './cp.js';
import { PIECES, tryCost, fixOpt, CHARGE_RULES, EFF_OPTS, SLOT_P, FIRST_LV, MAX_LV, buildData } from './nipago/rules.js';
import { effValue, fmtEff, explainEff } from './nipago/effective.js';
import { roll, progress, isDone, validateResult, effCfg } from './nipago/engine.js';

const STORE = 'nipago.input';
const NEED = ['equip_option', 'equip_glossary'];
const E = () => ({ opt: '', lv: 0 });

let ctx = null, D = null, RAW = null, base = './data/', mounted = null;
let S = null;                        // 저장되는 상태
let ui = { edit: null, rec: null, busy: false, cmp: null, draft: null, manual: false, err: null, detail: false, logOpen: false };

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
const opt = id => D.byId[id];
const short = id => optionLabel(id, ctx.lang);
const full = id => opt(id)?.[ctx.lang] || opt(id)?.en || id;
const pctOf = (id, lv) => (opt(id).vals[lv - 1] * 100).toFixed(2) + '%';
const num = v => (v == null || !Number.isFinite(v) ? '—' : v >= 100 || Math.abs(v - Math.round(v)) < 0.05 ? Math.round(v).toLocaleString() : v.toFixed(1));
const tierCls = lv => (lv >= 15 ? 'black' : lv >= 12 ? 'blue' : '');
const lvBand = lv => (lv <= 5 ? 1 : lv <= 10 ? 2 : lv <= 12 ? 3 : lv <= 14 ? 4 : 5);

/* ── 로드 ─────────────────────────────────────────────────── */
async function fetchJSON(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} — ${url}`);
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

/* ── 계산 — 워커, 안 되면 같은 코드를 화면 쪽에서 ───────────── */
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
  return type === 'compare' ? inline.compare(payload.st, payload.keep, payload.acc) : inline.recommend(payload.st);
}
/* 워커 안에서는 상대 주소가 워커 파일 기준이 된다 — 절대 주소로 넘긴다 */
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
  source: 'sim',
  spent: { mod: 0, key: 0 },
  log: [],
  pending: null,
  plan: null,                       // 직접 설정 { piece, kind, prot: { [line]: 'perm' | 'key' } }
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
  return { ...d, ...rest, gear, goals: { mode: ['opt', 'lv', 'tier'].includes(v.goals?.mode) ? v.goals.mode : 'opt', items },
    spent: { ...d.spent, ...(v.spent || {}) }, armed: !!v.armed,
    log: Array.isArray(v.log) ? v.log : [], nikke: { ...d.nikke, ...(v.nikke || {}) } };
}
const clampLv = v => Math.min(MAX_LV, Math.max(1, Math.round(+v) || 1));
/* 목표 단계 — 줄 수만큼. 모자라면 마지막 값(없으면 최소 단계)으로 채운다 */
const fitLvs = (lvs, n, fill) => Array.from({ length: n }, (_, i) =>
  clampLv(Array.isArray(lvs) && lvs.length ? lvs[Math.min(i, lvs.length - 1)] : fill));
/* v2 — 장비 한 부위였다. 첫 부위에 넣고 나머지는 미개조로 둔다. */
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
   run: 시뮬레이션 진행 — [계산] 을 누른 상태면 이어서 다시 계산한다.
   그 밖의 입력 변경은 계산을 멈추고 [계산] 을 다시 누르길 기다린다. */
function commit(fn, { goal = false, run = false } = {}) {
  fn();
  S.stateNo++;
  if (goal) S.goalNo++;
  if (!run) S.armed = false;
  save();
  paint();
  if (run && S.armed) requestRec();
}
function calc() {
  if (!Object.keys(S.goals.items).length) return;
  S.armed = true;
  save();
  requestRec();
  paint();
}
/* 첫 실행 뒤부터는 자물쇠가 이번 실행의 잠금이다 (비용이 붙는다). 그 전에는 원래 잠겨 있던 줄 표시. */
const started = () => S.log.length > 0 || !!S.pending;
const repaint = fn => { if (fn) fn(); paint(); };

/* ── 계산기 탭에서 네 부위 채우기 ─────────────────────────── */
/* 계산기 자료에는 영구 잠금 정보가 없다 — 모두 풀린 것으로 두고, 사용자가 자물쇠로 표시한다. */
export function seedGear({ rid, gear }) {
  const apply = st => {
    st.gear = PIECES.map((slot, p) => {
      const g = (gear || []).find(x => x.slot === SLOTS[p]);
      if (!g || g.tier !== '오버로드' || !g.options?.length) return emptyPiece(slot);
      const rows = olRows(g.options);
      const lines = rows.map(o => (o && o.name ? cleanLineRaw(o.name, o.level) : E()));
      return { slot, overloaded: true, lines, perm: [false, false, false] };
    });
    if (rid) st.nikke = { rid, baseAmmo: null, chargeTime: null };
    st.pending = null; st.plan = null; st.armed = false;
    st.stateNo++;
  };
  if (S) {
    apply(S); save();
    if (mounted) { ui.cmp = null; ui.draft = null; ui.manual = false; ui.rec = null; loadNikkeStats(); paint(); }
    return;
  }
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORE)); } catch {}
  const st = saved && saved.ver === 3 ? saved : defaults();
  apply(st);
  localStorage.setItem(STORE, JSON.stringify(st));
}
/* 데이터를 아직 못 읽었을 때도 쓸 수 있게 — 옵션 확인은 normalize 가 한다 */
const cleanLineRaw = (name, level) => ({ opt: fixOpt(name), lv: Math.min(15, Math.max(1, +level || FIRST_LV)) });

/* 기본 장탄수·기준 차지 시간 — data/weapons.json (update_data.py 가 전투 원본에서 뽑는다).
   비어 있는 값만 채우고, 사용자가 고친 값은 건드리지 않는다. */
let weapons = null;
async function loadNikkeStats() {
  const rid = S.nikke.rid;
  if (!rid || (S.nikke.baseAmmo != null && S.nikke.chargeTime != null)) return;
  try {
    if (!weapons) weapons = (await fetchJSON(`${base}weapons.json`)).nikkes || {};
    const w = weapons[rid];
    if (!w || S.nikke.rid !== rid) return;
    commit(() => {
      if (S.nikke.baseAmmo == null) S.nikke.baseAmmo = w.ammo ?? null;
      if (S.nikke.chargeTime == null) S.nikke.chargeTime = w.charge || null;
    });
  } catch {}
}

/* ── 엔진에 넘길 상태 ─────────────────────────────────────── */
const engineGear = gear => gear.map(g => ({ ...g, perm: g.perm.map(x => x === true) }));
const engineState = () => ({
  gear: engineGear(S.gear),
  goals: S.goals,
  nikke: { baseAmmo: S.nikke.baseAmmo || 0, chargeTime: S.nikke.chargeTime || 1 },
  pref: S.pref, keep: S.keep, stateNo: S.stateNo, goalNo: S.goalNo,
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
      if (out.stateNo !== S.stateNo) return;      // 그 사이 상태가 바뀌었다 — 버린다
      ui.rec = out; ui.err = null;
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
    const out = await compute('compare', { st: engineState(), keep, acc });
    if (S.pending?.tryId !== tryId) return;
    ui.cmp = { ...out, tryId };
  } catch (err) { ui.cmp = { err: String(err.message || err), tryId }; }
  paint();
}

/* ── 실행 · 선택 (명세 23.3~23.4, 24.5) ───────────────────── */
/* 지금 실행할 행동 — 직접 설정이 우선, 아니면 추천 */
function currentAction() {
  if (ui.manual && S.plan) {
    const g = S.gear[S.plan.piece];
    if (!g.overloaded) return { piece: S.plan.piece, kind: 'first', protect: [], unlock: [], cost: { mod: 1, key: 0 }, manual: true };
    const protect = Object.entries(S.plan.prot || {})
      .filter(([i]) => g.lines[+i].opt)
      .map(([i, mat]) => ({ line: +i, mat, fresh: !(mat === 'perm' && g.perm[+i] === true) }));
    const unlock = [0, 1, 2].filter(i => g.perm[i] === true && !protect.some(p => p.line === i));
    return { piece: S.plan.piece, kind: S.plan.kind, protect, unlock, cost: tryCost(protect, 0.1), manual: true };
  }
  const r = ui.rec;
  if (!r || r.stateNo !== S.stateNo || !r.alts) return null;
  const a = r.alts[r.pick];
  return a && a.ok ? { piece: a.piece, kind: a.act.kind, protect: a.act.protect, unlock: a.act.unlock, cost: a.act.cost } : null;
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
  if (S.pending) return;                           // 버튼 두 번 — 한 번만
  const a = currentAction();
  if (!a || !S.armed || actionProblems(a).length) return;
  commit(() => {
    const g = S.gear[a.piece];
    const tryId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    S.spent.mod += a.cost.mod; S.spent.key += a.cost.key;
    const before = g.lines.map(l => ({ ...l }));
    const prevPerm = g.perm.slice();
    /* 새 영구 잠금은 지금 확정된다 — 결과를 유지해도 남는다. 락키·해제한 줄은 잠금이 없다. */
    g.perm = [0, 1, 2].map(i => a.protect.some(p => p.line === i && p.mat === 'perm'));
    const protectLines = a.protect.map(p => p.line);
    let result = null;
    if (S.source === 'sim') {
      result = roll(D, { ...g, lines: before }, a.kind, protectLines, Math.random);
    }
    S.pending = { tryId, piece: a.piece, kind: a.kind, protect: a.protect, unlock: a.unlock, cost: a.cost,
      before, prevPerm, result, followed: !a.manual };
    S.log.push({ tryId, at: Date.now(), piece: a.piece, kind: a.kind, protect: a.protect, cost: a.cost,
      before, prevPerm, result: null, choice: null, followed: !a.manual, src: S.source });
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

/* 실전 기록 — 입력한 결과를 확정해 비교로 넘긴다 */
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
    /* 직접 설정은 이어진다 — 빈칸이 된 줄의 잠금만 뺀다 */
    if (ui.manual && S.plan) S.plan.prot = Object.fromEntries(Object.entries(S.plan.prot || {}).filter(([i]) => S.gear[S.plan.piece].lines[+i].opt));
  }, { run: true });
  ui.cmp = null; ui.draft = null;
}

/* 실행 취소 — 오입력 등으로 이번 시도를 없던 일로 한다. 비용·이번에 건 잠금도 되돌린다. (Esc) */
function cancelPending() {
  const pd = S.pending;
  if (!pd) return;
  commit(() => {
    const at = S.log.findIndex(x => x.tryId === pd.tryId);
    if (at >= 0) S.log.splice(at, 1);
    S.spent.mod = Math.max(0, S.spent.mod - pd.cost.mod);
    S.spent.key = Math.max(0, S.spent.key - pd.cost.key);
    S.gear[pd.piece].perm = pd.prevPerm.slice();
    S.pending = null;
  }, { run: true });
  ui.cmp = null; ui.draft = null;
}

/* 기록 정정 — 서비스 안의 기록만 되돌린다. 게임 안 재화·장비는 돌아오지 않는다 (명세 24.5). */
function undoLast() {
  const last = S.log.at(-1);
  if (!last) return;
  commit(() => {
    S.log.pop();
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

/* ── 렌더: 상단 바 ────────────────────────────────────────── */
function seg(items, cur, onPick, cls = '') {
  return h('div', { class: 'np-seg ' + cls, role: 'group' },
    items.map(([v, label, title]) => btn('np-segb' + (v === cur ? ' on' : ''), label, () => onPick(v), { 'aria-pressed': String(v === cur), title })));
}
function numInput(value, set, { min = 0, max = 99999, step = 1, ph = '', cls = '' } = {}) {
  const n = h('input', { class: 'np-num ' + cls, type: 'number', inputmode: 'decimal', min, max, step, placeholder: ph });
  n.value = value == null ? '' : value;
  n.onchange = () => {
    const raw = n.value.trim();
    set(raw === '' ? null : Math.min(max, Math.max(min, +raw)));
  };
  return n;
}
/* − [숫자] + — 가운데 칸에 바로 입력할 수도 있다 (Enter·포커스 이동 때 반영) */
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

function renderBar() {
  const bar = h('section', 'np-card np-bar');

  /* 니케 */
  const nk = h('div', 'np-field np-nikke');
  nk.appendChild(h('label', { class: 'np-flbl', for: 'np-nikke' }, t('np.nikke')));
  const list = h('datalist', { id: 'np-nikkes' },
    (ctx.nikkes || []).map(n => h('option', { value: n.name[ctx.lang] || n.name.en })));
  const cur = (ctx.nikkes || []).find(n => n.rid === S.nikke.rid);
  const inp = h('input', { id: 'np-nikke', class: 'np-text', list: 'np-nikkes', placeholder: t('np.nikkePh'), autocomplete: 'off' });
  inp.value = cur ? cur.name[ctx.lang] || cur.name.en : '';
  inp.onchange = () => {
    const q = inp.value.trim();
    const n = (ctx.nikkes || []).find(x => [x.name.ko, x.name.en, x.name.ja].includes(q));
    commit(() => { S.nikke = { rid: n ? n.rid : null, baseAmmo: null, chargeTime: null }; });
    loadNikkeStats();
  };
  nk.append(inp, list);
  const cr = CHARGE_RULES[S.nikke.rid];
  const facts = h('div', 'np-facts',
    h('label', 'np-fact', t('np.baseAmmo'), numInput(S.nikke.baseAmmo, v => commit(() => { S.nikke.baseAmmo = v; }), { min: 1, max: 999, ph: '—' })),
    h('label', 'np-fact', t('np.chargeTime'), numInput(S.nikke.chargeTime, v => commit(() => { S.nikke.chargeTime = v; }), { min: 0, max: 9, step: 0.01, ph: '—' })),
    cur ? h('span', { class: 'np-cls np-cls-' + (cr ? cr.cls : 'unk'), title: cr ? t('np.clsSrc', cr.src) : t('np.clsUnkHint') }, t('np.cls_' + (cr ? cr.cls : 'unk'))) : null);
  nk.appendChild(facts);
  bar.appendChild(nk);

  /* 결과 입력 방식 · 재화 우선순위 */
  const modes = h('div', 'np-field');
  modes.append(h('span', 'np-flbl', t('np.source')),
    seg([['sim', t('np.srcSim'), t('np.srcSimHint')], ['real', t('np.srcReal'), t('np.srcRealHint')]], S.source,
      v => { if (!S.pending) commit(() => { S.source = v; }, { run: true }); }),
    h('span', 'np-flbl', t('np.pref')),
    seg([['mod', t('np.pref_mod'), t('np.prefHint_mod')], ['balanced', t('np.pref_balanced'), t('np.prefHint_balanced')], ['key', t('np.pref_key'), t('np.prefHint_key')]],
      S.pref, v => commit(() => { S.pref = v; }, { run: true })));
  bar.appendChild(modes);

  /* 누적 */
  bar.appendChild(h('div', 'np-field np-spent',
    h('span', 'np-flbl', t('np.spent')),
    h('div', 'np-spentv', h('b', 'np-m', '🔵 ' + S.spent.mod), h('b', 'np-k', '🔑 ' + S.spent.key)),
    h('span', 'np-note', t('np.tries', S.log.length))));
  return bar;
}

/* ── 렌더: 목표 ───────────────────────────────────────────── */
function renderGoals(prog) {
  const card = h('section', 'np-card np-goals');
  card.appendChild(h('div', 'np-cardhead', h('h3', null, t('np.goals')),
    seg([['opt', t('np.modeOpt'), t('np.modeOptHint')], ['lv', t('np.modeLv'), t('np.modeLvHint')], ['tier', t('np.modeTier'), t('np.modeTierHint')]],
      S.goals.mode, v => commit(() => { S.goals.mode = v; }, { goal: true }), 'np-seg-s')));
  card.appendChild(h('p', 'np-note', t('np.goalsHint')));

  const chips = h('div', 'np-chips');
  for (const o of D.opts) {
    const on = !!S.goals.items[o.id];
    const warn = o.id === '차속' && CHARGE_RULES[S.nikke.rid]?.cls === 'none';
    chips.appendChild(btn('np-chip' + (on ? ' on' : '') + (warn ? ' warn' : ''),
      [h('span', 'np-chipk', on ? '✓' : '+'), h('span', 'np-chipn', short(o.id))],
      () => commit(() => {
        if (on) delete S.goals.items[o.id];
        else S.goals.items[o.id] = { count: 1, minLv: 12, lvs: [12], eff: null };
      }, { goal: true }),
      { title: full(o.id) + (warn ? ' — ' + t('np.chargeNone') : ''), 'aria-pressed': String(on) }));
  }
  card.appendChild(chips);

  const ids = D.opts.map(o => o.id).filter(id => S.goals.items[id]);
  if (!ids.length) { card.appendChild(h('p', 'np-empty', t('np.noGoal'))); return card; }

  const list = h('div', 'np-glist');
  for (const id of ids) {
    const g = S.goals.items[id];
    const pr = prog.find(p => p.opt === id);
    const row = h('div', 'np-grow' + (pr?.ok ? ' ok' : ''));
    const head = h('div', 'np-ghead',
      h('span', 'np-gname', short(id)), h('span', 'np-gfull', full(id)),
      pr ? h('span', 'np-gprog' + (pr.ok ? ' ok' : ''), pr.eff ? `${fmtEff(pr.cfg, pr.have)} / ${fmtEff(pr.cfg, pr.need)}` : `${pr.have}/${pr.need}`) : null,
      btn('np-gx', '✕', () => commit(() => { delete S.goals.items[id]; }, { goal: true }), { 'aria-label': t('np.remove') }));
    row.appendChild(head);

    const ctl = h('div', 'np-gctl');
    if (EFF_OPTS[id]) {
      ctl.appendChild(seg([['n', t('np.byLines')], ['eff', t('np.byEff')]], g.eff ? 'eff' : 'n',
        v => commit(() => { g.eff = v === 'eff' ? { min: defaultEff(id), model: 'pct' } : null; }, { goal: true }), 'np-seg-s'));
    }
    if (!g.eff) {
      ctl.appendChild(h('span', 'np-gfield', t('np.lines'),
        stepper(g.count, v => commit(() => { g.count = v; g.lvs = fitLvs(g.lvs, v, g.minLv); }, { goal: true }), { min: 1, max: 4, label: t('np.lines') })));
      if (S.goals.mode === 'lv') {
        ctl.appendChild(h('span', 'np-gfield', t('np.minLv'),
          stepper(g.minLv, v => commit(() => { g.minLv = v; }, { goal: true }), { min: 1, max: MAX_LV, label: t('np.minLv') }),
          h('span', 'np-gval lvb-' + lvBand(g.minLv), pctOf(id, g.minLv))));
      } else if (S.goals.mode === 'tier') {
        /* 줄마다 목표 단계 — 순서는 상관없다 (어느 줄이 어느 단계를 채워도 된다) */
        const lvs = fitLvs(g.lvs, g.count, g.minLv);
        ctl.appendChild(h('div', 'np-tiers', lvs.map((lv, k) => h('span', 'np-tier',
          h('span', 'np-tiern', t('np.tierN', k + 1)),
          stepper(lv, v => commit(() => { const next = fitLvs(g.lvs, g.count, g.minLv); next[k] = v; g.lvs = next; }, { goal: true }),
            { min: 1, max: MAX_LV, label: t('np.tierN', k + 1) }),
          h('span', 'np-gval lvb-' + lvBand(lv), pctOf(id, lv))))));
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
    row.appendChild(ctl);
    list.appendChild(row);
  }
  card.appendChild(list);

  /* 보존 조건 */
  if (ids.some(id => S.goals.items[id].eff)) {
    const cb = h('input', { type: 'checkbox', checked: !S.keep.allowDrop });
    cb.onchange = () => commit(() => { S.keep.allowDrop = !cb.checked; });
    card.appendChild(h('label', 'np-keep', cb, h('span', null, t('np.keepFloor'))));
  }
  card.appendChild(calcRow());
  return card;
}

/* [계산] — 누르기 전에는 아무것도 계산하지 않는다 */
function calcRow() {
  const fresh = S.armed && ui.rec && ui.rec.stateNo === S.stateNo;
  return h('div', 'np-calcrow',
    btn('np-calc' + (S.armed ? ' done' : ''), S.armed ? (fresh || ui.busy ? '✓ ' + t('np.calcDone') : t('np.calc')) : t('np.calc'), calc,
      { disabled: S.armed || !Object.keys(S.goals.items).length }),
    h('span', 'np-note', S.armed ? t('np.calcArmed') : t('np.calcHint')));
}
const defaultEff = id => (EFF_OPTS[id] === 'ammo' ? Math.max(1, Math.round((S.nikke.baseAmmo || 6) * 1.5)) : 10);

/* ── 렌더: 다음 한 번 ─────────────────────────────────────── */
function actionText(a) {
  const piece = t('np.piece_' + a.piece);
  if (a.kind === 'first') return t('np.doFirst', piece);
  const prot = a.protect.map(p => t('np.protOne', p.line + 1, t(p.mat === 'key' ? 'np.matKey' : p.fresh ? 'np.matPermNew' : 'np.matPerm')));
  return t(a.kind === 'reset' ? 'np.doReset' : 'np.doChange', piece, prot.length ? prot.join(', ') : t('np.noProtect'));
}
function costText(c) {
  const parts = [t('np.costMod', c.mod)];
  if (c.key) parts.push(t('np.costKey', c.key));
  return parts.join(' + ');
}

function renderRec(prog) {
  const card = h('section', 'np-card np-rec');
  const r = ui.rec && ui.rec.stateNo === S.stateNo ? ui.rec : null;
  card.appendChild(h('div', 'np-cardhead', h('h3', null, t('np.next')),
    h('span', 'np-meta', ui.busy ? t('np.computing') : r ? `#${r.stateNo} · ${r.rules}` : '')));

  if (!Object.keys(S.goals.items).length) { card.appendChild(h('p', 'np-empty', t('np.noGoal'))); return card; }
  if (!S.armed) {
    card.appendChild(banner('check', t(ui.rec ? 'np.st_stale' : 'np.st_ready'), t(ui.rec ? 'np.st_staleDesc' : 'np.st_readyDesc')));
    card.appendChild(calcRow());
    return card;
  }
  if (ui.err) card.appendChild(banner('check', t('np.st_err'), ui.err));
  if (!r) {
    card.appendChild(h('div', 'np-skel', h('span', 'np-spin'), t('np.computingLong')));
    return card;
  }

  if (r.status === 'done') {
    card.appendChild(banner('done', t('np.st_done'), t('np.st_doneDesc')));
    return card;
  }
  if (r.status === 'impossible') {
    card.appendChild(banner('check', t('np.st_impossible'), t('np.st_impossibleDesc')));
    return card;
  }

  const a = r.alts[r.pick];
  const act = { piece: a.piece, kind: a.act.kind, protect: a.act.protect, unlock: a.act.unlock, cost: a.act.cost };
  const main = h('div', 'np-do' + (ui.manual ? ' dim' : ''));
  main.appendChild(h('div', 'np-dotitle', actionText(act)));
  if (act.unlock.length) main.appendChild(h('div', 'np-dosub', t('np.unlockLines', act.unlock.map(i => i + 1).join(', '))));

  const facts = h('dl', 'np-dl');
  const fact = (k, v, cls) => facts.append(h('dt', null, k), h('dd', cls, v));
  const lockPart = tryCost(act.protect.map(p => ({ ...p, fresh: false })));
  const fresh = { mod: act.cost.mod - lockPart.mod, key: act.cost.key };
  fact(t('np.thisCost'), [costText(act.cost),
    fresh.mod || fresh.key ? h('small', null, ` (${t('np.costSplit', lockPart.mod, fresh.mod, fresh.key)})`) : null,
    act.cost.estimated ? h('small', 'np-est', ' · ' + t('np.estimated')) : null]);
  const pc = a.pieces[a.piece];
  fact(t('np.why'), t('np.whyText', t('np.piece_' + a.piece), pc.S.map(x => short(x.opt) + (x.m > 1 ? ` T${x.m}+` : '')).join('·') || '—', num(pc.m),
    a.pieces.filter(x => x.v > 0).length));
  const kept = prog.filter(p => p.eff && p.ok);
  if (kept.length) fact(t('np.guard'), kept.map(p => `${short(p.opt)} ${fmtEff(p.cfg, p.have)}`).join(', '));
  fact(t('np.outlookMean'), t('np.meanText', num(a.m), num(a.k)));
  main.appendChild(facts);

  const probs = actionProblems(act);
  const go = btn('np-go', S.source === 'sim' ? t('np.goSim') : t('np.goReal'), execute,
    { disabled: !!S.pending || ui.manual || probs.length > 0 });
  main.appendChild(h('div', 'np-goRow', go,
    probs.map(x => h('span', 'np-prob', t('np.prob_' + x)))));
  card.appendChild(main);

  /* 대안 — 모듈 절약 / 균형 / 락키 미사용 (다른 것만) */
  const others = ['mod', 'balanced', 'key'].filter(p => p !== r.pick && r.alts[p]?.ok);
  const sig = x => JSON.stringify([x.piece, x.act]);
  const distinct = others.filter(p => sig(r.alts[p]) !== sig(a) || Math.abs(r.alts[p].k - a.k) > 0.5 || Math.abs(r.alts[p].m - a.m) > 0.5);
  const alts = h('div', 'np-alts');
  alts.appendChild(h('div', 'np-altttl', t('np.alts')));
  for (const p of distinct) {
    const x = r.alts[p];
    alts.appendChild(h('div', 'np-alt',
      h('span', 'np-altk', t('np.pref_' + p)),
      h('span', 'np-altd', actionText({ piece: x.piece, kind: x.act.kind, protect: x.act.protect }) + ' · ' + t('np.meanText', num(x.m), num(x.k))),
      btn('np-altb', t('np.useThis'), () => commit(() => { S.pref = p; }, { run: true }))));
  }
  alts.appendChild(h('div', 'np-alt',
    h('span', 'np-altk', t('np.altStop')),
    h('span', 'np-altd', t('np.altStopDesc', prog.filter(x => !x.ok).map(x => `${short(x.opt)} ${x.eff ? fmtEff(x.cfg, x.have) + '/' + fmtEff(x.cfg, x.need) : x.have + '/' + x.need}`).join(', ')))));
  card.appendChild(alts);

  /* 근거 범위 · 자세히 */
  const det = h('details', { class: 'np-detail', open: ui.detail || null });
  det.ontoggle = () => { ui.detail = det.open; };
  det.appendChild(h('summary', null, t('np.scope')));
  det.appendChild(h('p', 'np-note', t('np.scopeText', t('np.pref_' + r.pick), Number.isFinite(a.lambda) ? a.lambda : '∞')));
  det.appendChild(h('ul', 'np-plan', a.pieces.map((x, p) => h('li', null,
    h('b', null, t('np.piece_' + p)), ' ',
    x.S.length ? x.S.map(s => short(s.opt) + (s.m > 1 ? ` T${s.m}+` : '')).join('·') : t('np.nothingHere'),
    x.v > 0 ? ` — ${t('np.meanText', num(x.m), num(x.k))}${x.first ? ' · ' + t('np.firstIncl') : ''}` : ` — ${t('np.pieceOk')}`))));
  if (r.stats) det.appendChild(h('p', 'np-note', t('np.tableStats', r.stats.loaded, r.stats.built)));
  card.appendChild(det);
  return card;
}

function banner(kind, title, desc) {
  return h('div', 'np-banner np-b-' + kind, h('b', null, title), desc ? h('span', null, desc) : null);
}

/* ── 렌더: 네 부위 ───────────────────────────────────────── */
function renderGear() {
  const card = h('section', 'np-card np-gearcard');
  const manualBtn = btn('np-manualb' + (ui.manual ? ' on' : ''), ui.manual ? t('np.manualOn') : t('np.manualOff'),
    () => repaint(() => {
      ui.manual = !ui.manual;
      if (ui.manual) { const a = currentAction(); S.plan = planFromAction(a, a ? a.piece : 0); }
      save();
    }), { 'aria-pressed': String(ui.manual), disabled: !!S.pending || !started() && !ui.manual });
  card.appendChild(h('div', 'np-cardhead', h('h3', null, t('np.gear')), manualBtn));

  const act = currentAction();
  const grid = h('div', 'np-pieces');
  S.gear.forEach((g, p) => grid.appendChild(pieceCard(g, p, act)));
  card.appendChild(grid);

  if (ui.manual && S.plan) card.appendChild(manualBar());
  card.appendChild(h('p', 'np-note', started() ? t('np.gearHintRun') : t('np.gearHint')));
  return card;
}

/* 직접 설정의 시작점 — 같은 부위면 지금 행동을, 아니면 그 부위의 기존 영구 잠금을 그대로 */
function planFromAction(a, piece) {
  if (a && a.piece === piece && a.kind !== 'first') {
    return { piece, kind: a.kind, prot: Object.fromEntries(a.protect.map(x => [x.line, x.mat])) };
  }
  const g = S.gear[piece];
  return { piece, kind: 'change', prot: Object.fromEntries([0, 1, 2].filter(i => g.perm[i] === true).map(i => [i, 'perm'])) };
}

function pieceCard(g, p, act) {
  const target = act && act.piece === p;
  const box = h('div', 'np-piece' + (target ? ' target' : '') + (g.overloaded ? '' : ' off'));
  const head = h('div', 'np-phead', h('span', 'np-pname', t('np.piece_' + p)));
  const olcb = h('input', { type: 'checkbox', checked: g.overloaded, disabled: !!S.pending });
  olcb.onchange = () => commit(() => {
    g.overloaded = olcb.checked;
    if (!g.overloaded) { g.lines = [E(), E(), E()]; g.perm = [false, false, false]; }
  });
  head.appendChild(h('label', 'np-olt', olcb, h('span', null, t('np.overloaded'))));
  if (ui.manual && S.plan) {
    head.appendChild(btn('np-pick' + (S.plan.piece === p ? ' on' : ''), S.plan.piece === p ? t('np.picked') : t('np.pick'),
      () => repaint(() => { S.plan = planFromAction(null, p); save(); })));
  }
  box.appendChild(head);

  if (!g.overloaded) {
    box.appendChild(h('p', 'np-poff', t('np.notOverloaded')));
    return box;
  }
  g.lines.forEach((l, i) => box.appendChild(lineRow(g, p, i, act)));
  return box;
}

/* 자물쇠 상태 — 시작 전: 원래 잠겨 있던 줄. 시작 후: 이번 실행에서 보호할 줄 (대상 부위), 나머지는 기존 영구 잠금. */
function lockState(g, p, i, act) {
  if (started() && act && act.piece === p && act.kind !== 'first') {
    const pr = act.protect.find(x => x.line === i);
    return pr ? (pr.mat === 'key' ? 'key' : pr.fresh ? 'new' : 'held') : 'none';
  }
  return g.perm[i] === true ? 'held' : 'none';
}

/* 자물쇠 누름
   시작 전 — 원래 잠겨 있던 줄로 표시/해제 (비용 없음, 입력 변경)
   시작 후 — 이번 실행의 잠금을 직접 정한다: 없음 → 영구 → 락키 → 없음. 새로 거는 잠금은 이번 비용에 들어간다. */
function toggleLock(g, p, i) {
  if (S.pending || !g.lines[i].opt) return;
  if (!started()) {
    commit(() => { g.perm[i] = g.perm[i] !== true; });
    return;
  }
  repaint(() => {
    if (!ui.manual || !S.plan || S.plan.piece !== p) {
      S.plan = planFromAction(ui.manual ? null : currentAction(), p);
      ui.manual = true;
    }
    const cur = S.plan.prot[i];
    const next = !cur ? 'perm' : cur === 'perm' ? 'key' : null;
    if (next && !cur && Object.keys(S.plan.prot).length >= 2) return;    // 보호는 2줄까지
    if (next) S.plan.prot[i] = next; else delete S.plan.prot[i];
    save();
  });
}

const LOCK_ICON = { none: '🔓', held: '🔒', new: '🔒', key: '🗝' };

function lineRow(g, p, i, act) {
  const l = g.lines[i];
  const goal = l.opt && S.goals.items[l.opt];
  const lvs = goal && !goal.eff ? goalLevelsUI(goal) : null;
  const meets = goal && (goal.eff || !lvs || l.lv >= Math.min(...lvs));
  const isTarget = act && act.piece === p;
  const prot = isTarget ? act.protect.find(x => x.line === i) : null;
  const willUnlock = isTarget && act.unlock?.includes(i);
  const editing = ui.edit && ui.edit.p === p && ui.edit.i === i;
  const cls = ['np-line', l.opt ? tierCls(l.lv) : 'empty', goal ? (meets ? 'goal' : 'short') : l.opt ? 'junk' : '',
    prot ? 'prot-' + prot.mat : '', editing ? 'editing' : ''].join(' ');
  const row = h('div', 'np-lrow');
  const main = btn(cls, [
    h('span', 'np-lno', String(i + 1)),
    l.opt ? h('span', 'np-lopt', short(l.opt)) : h('span', 'np-lempty', t('np.empty')),
    l.opt ? h('span', 'np-lval', pctOf(l.opt, l.lv)) : h('span', 'np-lsp', Math.round(SLOT_P[i] * 100) + '%'),
    l.opt ? h('span', 'np-lvb lvb-' + lvBand(l.lv), 'T' + l.lv) : null,
    prot && !started() ? h('span', 'np-ptag np-ptag-' + prot.mat, prot.mat === 'key' ? '🗝 ' + t('np.matKeyS') : '🔒 ' + (prot.fresh ? t('np.matPermNewS') : t('np.matPermS'))) : null,
    willUnlock ? h('span', 'np-ptag np-ptag-off', t('np.unlockS')) : null,
  ], () => repaint(() => { ui.edit = editing ? null : { p, i }; }),
  { 'aria-expanded': String(!!editing), disabled: !!S.pending });
  row.appendChild(main);

  if (l.opt) {
    const st = lockState(g, p, i, act);
    const title = !started() ? t(st === 'held' ? 'np.lockOwnedOn' : 'np.lockOwnedOff')
      : t('np.lockRun_' + st);
    row.appendChild(btn('np-lockb np-lockb-' + st + (started() && isTarget && !ui.manual ? ' sug' : ''), LOCK_ICON[st],
      () => toggleLock(g, p, i), { title, 'aria-label': title, disabled: !!S.pending }));
  }
  if (editing) row.appendChild(lineEditor(g, p, i));
  return row;
}
const goalLevelsUI = g => (S.goals.mode === 'tier' ? fitLvs(g.lvs, g.count, g.minLv) : S.goals.mode === 'lv' ? [g.minLv] : [1]);

function lineEditor(g, p, i) {
  const l = g.lines[i];
  const box = h('div', 'np-editor');
  const others = new Set(g.lines.filter((x, j) => j !== i && x.opt).map(x => x.opt));
  const sel = h('select', { class: 'np-sel', 'aria-label': t('np.option') },
    h('option', { value: '' }, i === 0 ? t('np.pickOpt') : t('np.emptyOpt')),
    D.opts.map(o => h('option', { value: o.id, disabled: others.has(o.id), selected: l.opt === o.id }, `${short(o.id)} — ${full(o.id)}`)));
  let lv = l.opt ? l.lv : FIRST_LV;
  const val = h('span', 'np-gval', l.opt ? pctOf(l.opt, lv) : '');
  const lvBox = h('span');
  const paintLv = () => {
    lvBox.textContent = '';
    lvBox.appendChild(stepper(lv, v => { lv = v; val.textContent = sel.value ? pctOf(sel.value, lv) : ''; paintLv(); }, { label: t('np.level') }));
  };
  paintLv();
  sel.onchange = () => { val.textContent = sel.value ? pctOf(sel.value, lv) : ''; };
  const save1 = () => commit(() => {
    const id = sel.value;
    const same = id && id === l.opt;
    g.lines[i] = id ? { opt: id, lv } : E();
    if (!same) g.perm[i] = false;     // 옵션이 바뀌면 잠금도 새로
    ui.edit = null;
  });
  box.append(
    h('div', 'np-erow', h('span', 'np-elbl', t('np.option')), sel),
    h('div', 'np-erow', h('span', 'np-elbl', t('np.level')), lvBox, val),
    h('div', 'np-ebtns',
      btn('np-ok', t('np.set'), () => { document.activeElement?.blur?.(); save1(); }),
      btn('np-cancel', t('np.cancel'), () => repaint(() => { ui.edit = null; }))));
  return box;
}

function manualBar() {
  const a = currentAction();
  const bar = h('div', 'np-manual');
  const g = S.gear[S.plan.piece];
  if (g.overloaded) {
    bar.appendChild(seg([['change', t('np.kindChange')], ['reset', t('np.kindReset')]], S.plan.kind,
      v => repaint(() => { S.plan.kind = v; save(); })));
  }
  bar.appendChild(h('span', 'np-mdesc', a ? `${actionText(a)} — ${costText(a.cost)}${a.cost.estimated ? ' · ' + t('np.estimated') : ''}` : ''));
  const probs = actionProblems(a);
  if (!S.armed) probs.push('calc');
  bar.appendChild(h('div', 'np-goRow',
    btn('np-go', S.source === 'sim' ? t('np.goSim') : t('np.goReal'), execute, { disabled: !!S.pending || !a || probs.length > 0 }),
    probs.map(x => h('span', 'np-prob', t('np.prob_' + x)))));
  bar.appendChild(h('p', 'np-note', t('np.manualHint')));
  return bar;
}

/* ── 렌더: 결과 창 ────────────────────────────────────────── */
function renderModal(prog) {
  const pd = S.pending;
  const g = S.gear[pd.piece];
  const bg = h('div', 'np-modalbg');
  const box = h('div', { class: 'np-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('np.resultTitle') });
  box.appendChild(h('div', 'np-modalhead',
    h('span', null, t('np.resultTitle'), ' · ', actionText({ ...pd })),
    h('span', 'np-meta', t('np.paid', costText(pd.cost)))));

  const body = h('div', 'np-modalbody');
  const side = (title, lines, cls, mark) => h('div', 'np-side ' + cls, h('div', 'np-sidettl', title),
    lines.map((l, i) => {
      const goal = l.opt && S.goals.items[l.opt];
      const prot = pd.protect.some(x => x.line === i);
      return h('div', 'np-ovslot ' + (l.opt ? tierCls(l.lv) : 'empty') + (mark && goal ? ' good' : ''),
        h('span', 'np-lno', String(i + 1)),
        h('span', null, l.opt ? short(l.opt) : t('np.none')),
        l.opt ? h('span', 'np-ovval', `${pctOf(l.opt, l.lv)} T${l.lv}`) : null,
        prot ? h('span', 'np-lock', '🔒') : null);
    }));

  if (pd.kind !== 'first') body.appendChild(side(t('np.cur'), pd.before, 'cur', false));
  if (pd.result) body.appendChild(side(t('np.new'), pd.result, 'new', true));
  else body.appendChild(resultForm(pd));
  box.appendChild(body);

  /* 비교 */
  if (pd.result) {
    const c = ui.cmp && ui.cmp.tryId === pd.tryId ? ui.cmp : null;
    const cmp = h('div', 'np-cmp');
    if (pd.kind === 'first') cmp.appendChild(h('p', 'np-note', t('np.firstNoKeep')));
    else if (!c || c.busy) cmp.appendChild(h('p', 'np-note', h('span', 'np-spin'), t('np.comparing')));
    else if (c.err) cmp.appendChild(h('p', 'np-warn', c.err));
    else {
      cmp.appendChild(h('div', 'np-cmprow',
        h('div', 'np-cmpcell' + (c.choice === 'keep' ? ' best' : ''), h('small', null, t('np.ifKeep')), h('b', null, t('np.meanText', num(c.keep.m), num(c.keep.k)))),
        h('div', 'np-cmpcell' + (c.choice === 'accept' ? ' best' : ''), h('small', null, t('np.ifAccept')), h('b', null, t('np.meanText', num(c.acc.m), num(c.acc.k))))));
      if (c.breaks.length) cmp.appendChild(h('p', 'np-warn', t('np.breaks', c.breaks.map(short).join(', '))));
      const d = c.prog1.filter((x, i) => JSON.stringify(x.have) !== JSON.stringify(c.prog0[i].have));
      if (d.length) cmp.appendChild(h('p', 'np-note', t('np.delta') + ' ' + d.map(x => {
        const y = c.prog0.find(z => z.opt === x.opt);
        return `${short(x.opt)} ${x.eff ? fmtEff(x.cfg, y.have) : y.have} → ${x.eff ? fmtEff(x.cfg, x.have) : x.have}`;
      }).join(', ')));
    }
    box.appendChild(cmp);
  }

  const btns = h('div', 'np-modalbtns');
  const best = ui.cmp && ui.cmp.tryId === pd.tryId ? ui.cmp.choice : null;
  btns.appendChild(btn('np-mb np-mb-cancel', [t('np.cancelTry'), h('small', null, 'Esc')], cancelPending, { title: t('np.cancelTryHint') }));
  if (pd.result && pd.kind === 'first') {
    btns.appendChild(btn('np-mb np-mb-apply', '✓ ' + t('np.firstOk'), () => choose('accept')));
  } else if (pd.result) {
    btns.append(
      btn('np-mb np-mb-keep' + (best === 'keep' ? ' rec' : ''), [t('np.keep'), best === 'keep' ? h('small', null, t('np.recommended')) : null], () => choose('keep')),
      btn('np-mb np-mb-apply' + (best === 'accept' ? ' rec' : ''), [t('np.apply'), best === 'accept' ? h('small', null, t('np.recommended')) : null], () => choose('accept')));
  }
  box.appendChild(btns);
  box.appendChild(h('p', 'np-note np-modalfoot', t('np.paidNote'), ' ', t('np.cancelTryHint')));
  bg.appendChild(box);
  return bg;
}

/* 실전 기록 — 게임에서 나온 세 줄을 입력한다 */
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
      row.appendChild(locked ? h('span', 'np-gval', `T${l.lv}`) :
        stepper(l.lv || 1, v => repaint(() => { ui.draft[i] = { ...ui.draft[i], lv: v }; }), { label: t('np.level') }));
    } else if (l.opt) row.appendChild(h('span', 'np-gval', 'T' + FIRST_LV));
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
        h('span', 'np-logc', costText(x.cost)),
        h('span', 'np-logr', x.choice ? t('np.choice_' + x.choice) + (x.advice && x.advice !== x.choice && x.kind !== 'first' ? ' · ' + t('np.againstAdvice') : '') : t('np.pendingS')),
        x.followed === false ? h('span', 'np-logm', t('np.manualS')) : null,
        x.src === 'sim' ? h('span', 'np-logm', t('np.srcSim')) : null));
    }
    det.appendChild(ol);
    det.appendChild(h('div', 'np-logbtns',
      btn('btn-reset', t('np.undo'), () => { if (confirm(t('np.undoConfirm'))) undoLast(); }),
      h('span', 'np-note', t('np.undoNote'))));
  }
  det.appendChild(h('div', 'np-logbtns',
    btn('btn-reset', t('np.clear'), () => { if (confirm(t('np.clearConfirm'))) { S = defaults(); ui.cmp = null; ui.draft = null; ui.edit = null; ui.rec = null; ui.manual = false; save(); paint(); } })));
  return det;
}

/* ── 페인트 ───────────────────────────────────────────────── */
function paint() {
  const root = mounted;
  if (!root) return;
  const focusId = document.activeElement?.id;
  root.textContent = '';
  const prog = progress(D, engineGear(S.gear), S.goals, { baseAmmo: S.nikke.baseAmmo || 0, chargeTime: S.nikke.chargeTime || 1 });

  root.appendChild(renderBar());
  if (prog.length) {
    root.appendChild(h('div', { class: 'np-progress', role: 'status' },
      prog.map(x => h('span', 'np-pill' + (x.ok ? ' ok' : ''),
        h('b', null, short(x.opt)), ' ',
        x.eff ? `${fmtEff(x.cfg, x.have)} / ${fmtEff(x.cfg, x.need)}` : `${x.have}/${x.need}${lvsText(x)}`)),
      isDone(prog) ? h('span', 'np-pill ok all', t('np.st_done')) : null));
  }
  const main = h('div', 'np-main');
  main.appendChild(renderGoals(prog));
  const right = h('div', 'np-col');
  right.appendChild(renderRec(prog));
  right.appendChild(renderGear());
  right.appendChild(renderLog());
  main.appendChild(right);
  root.appendChild(main);
  if (S.pending) root.appendChild(renderModal(prog));
  if (focusId) document.getElementById(focusId)?.focus();
}

const lvsText = x => (x.tier ? ' · ' + x.lvs.map(v => 'T' + v).join('·') : x.m > 1 ? ` · T${x.m}+` : '');

/* 바깥을 누르면 줄 편집을 닫는다. */
let wired = false;
function wireOutside() {
  if (wired) return;
  wired = true;
  document.addEventListener('click', e => {
    if (!mounted || !mounted.isConnected || !ui.edit) return;
    if (e.target.closest('.np-lrow')) return;
    ui.edit = null;
    paint();
  });
  /* Esc — 결과 창이 떠 있으면 이번 시도 취소, 아니면 줄 편집·직접 설정을 닫는다 */
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !mounted?.isConnected) return;
    if (S.pending) { e.preventDefault(); cancelPending(); return; }
    if (ui.edit) { ui.edit = null; paint(); return; }
    if (ui.manual) { ui.manual = false; paint(); }
  });
}

export async function renderNipago(root, context) {
  ctx = context;
  mounted = root;
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
  loadNikkeStats();
  if (S.pending && S.pending.result && !ui.cmp) requestCompare();
  if (S.armed && (!ui.rec || ui.rec.stateNo !== S.stateNo)) requestRec();
}
