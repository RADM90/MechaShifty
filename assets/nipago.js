/* 니파고 탭 — 오버로드 옵션작(수치작) 시뮬레이터.

   MechaShifty 의 단일 HTML 시제품(`sample/nipago.html` + `Module_Nipago.md`)을
   이 사이트 구조로 옮긴 것이다. 계산 규칙은 그대로 두되 두 가지를 바꿨다.

   1. 옵션 수치·등장확률·레벨 확률을 코드에 박지 않고 `data/raw/equip_option.json`
      과 `equip_glossary.json` 에서 읽는다. 시제품은 크댐 12% / 크확 10% 였는데
      이 사이트는 게임 표기(크댐 10% / 크확 12%)를 정본으로 쓴다 (DEVIATIONS §3).
   2. 상태를 localStorage 에 남기고, 상태가 바뀌면 패널을 통째로 다시 그린다.

   슬롯 등장확률(100/50/30%)과 잠금 비용(모듈 2·3 / 락키 20·30)은 워크북에 없는
   공식 수치라 아래 상수로 둔다.

   app.js 와의 결합은 renderNipago(root, ctx) 한 곳뿐. */

import { optionLabel } from './cp.js';

const STORE = 'nipago.input';
const NEED = ['equip_option', 'equip_glossary'];

/* 슬롯 1·2·3 이 아예 등장할 확률. */
const SLOT_P = [1, 0.5, 0.3];
/* 잠금 비용 — [다른 잠금이 없을 때, 있을 때] */
const COST_MOD = [2, 3];
const COST_KEY = [20, 30];
/* 잠금 추천 기본값이 켜져 있는 옵션 (원본 명세의 기본 목표) */
const DEFAULT_S3 = ['우코', '공증'];

/* 옛 약어로 저장된 목표(크피·차뎀)를 지금 이름으로 눕힌다 — roster.js 와 같은 표 */
const OPTION_ALIAS = { 크피: '크댐', 차뎀: '차댐' };

let ctx = null, D = null, base = './data/', mounted = null;
let S = null;                       // 저장되는 상태
let ui = { slot: -1, lock: -1, pending: null };

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const t = (k, ...a) => ctx.t(k, ...a);
const pct = v => (Math.round(v * 1000) / 10).toFixed(1) + '%';
const val = (o, lv) => (o.vals[lv - 1] * 100).toFixed(2) + '%';

/* 옵션 표시 이름 — 한국어는 데이터의 약어, 그 외에는 그 언어의 줄임말. */
const optLabel = o => optionLabel(o.id, ctx.lang);
const optFull = o => o[ctx.lang] || o.en;

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

  const [option, glossary] = await Promise.all(
    NEED.map(k => fetchJSON(`${base}raw/${k}.json`)));

  /* equip_option 은 레벨이 행, 옵션이 열이다. 열 라벨(우코·공증…)로 용어집과 맞춘다. */
  const gi = Object.fromEntries(glossary.columns.map((c, i) => [c.key, i]));
  const byAbbr = Object.fromEntries(glossary.rows.map(r => [r[gi.abbr], r]));
  const opts = [];
  option.columns.forEach((c, i) => {
    if (!c.key.startsWith('opt')) return;
    const id = c.label.ko;
    const g = byAbbr[id];
    opts.push({
      id,
      ko: g ? g[gi.full] : id,
      en: g ? g[gi.en] : id,
      ja: g ? g[gi.ja] : id,
      pct: g ? g[gi.rate] : 0,
      vals: option.rows.map(r => r[i]),
    });
  });
  const rate = option.columns.findIndex(c => c.key === 'rate');
  D = { opts, lp: option.rows.map(r => r[rate]) };
}

const gO = id => D.opts.find(o => o.id === id);
/* 레벨 min 이상이 뜰 확률 */
const cumLP = min => D.lp.slice(min - 1).reduce((a, b) => a + b, 0);

/* ── 상태 ─────────────────────────────────────────────────── */
function makeGoal(id) {
  const def = DEFAULT_S3.includes(id);
  return { minLv: 12, s2rec: false, s2recMinLv: 11, s3rec: def, s3recMinLv: def ? 1 : 11 };
}

const defaults = () => ({
  mode: 'opt',
  slots: [0, 1, 2].map(() => ({ opt: '', lv: 11, lock: 'none' })),
  goals: {},
  totalMod: 0,
  totalKey: 0,
  history: [],                      // { slot, prevLock, type, mod, key, committed }
});

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE));
    if (saved && Array.isArray(saved.slots)) return normalize(saved);
  } catch { /* 저장값이 깨졌으면 기본값 */ }
  return defaults();
}
const save = () => localStorage.setItem(STORE, JSON.stringify(S));

/* 저장값이 지금 데이터와 안 맞을 수 있으니(옵션 이름 변경 등) 한 번 걸러낸다. */
function normalize(v) {
  const d = defaults();
  const fix = id => OPTION_ALIAS[id] || id;
  const slots = [0, 1, 2].map(i => {
    const s = { ...(v.slots?.[i] || {}) };
    s.opt = s.opt ? fix(s.opt) : s.opt;
    const ok = s.opt && gO(s.opt);
    return {
      opt: ok ? s.opt : '',
      lv: Math.min(15, Math.max(1, +s.lv || 11)),
      lock: ok && ['mod', 'key'].includes(s.lock) ? s.lock : 'none',
    };
  });
  const goals = {};
  for (const [rawId, g] of Object.entries(v.goals || {})) {
    const id = fix(rawId);
    if (gO(id)) goals[id] = { ...makeGoal(id), ...g };
  }
  return {
    ...d, ...v, slots, goals,
    mode: v.mode === 'lv' ? 'lv' : 'opt',
    totalMod: +v.totalMod || 0,
    totalKey: +v.totalKey || 0,
    history: Array.isArray(v.history) ? v.history : [],
  };
}

/* ── 밖에서 슬롯 채우기 ───────────────────────────────────────
   계산기 탭이 보고 있던 니케의 오버로드 장비 한 부위를 그대로 넘겨 준다.
   목표(goals)와 누적 소모(totalMod·totalKey)는 이 부위만의 값이 아니라 계속
   쌓아 가는 값이라 그대로 두고, 슬롯과 잠금 이력만 갈아 끼운다 — 이력은 슬롯
   번호를 가리키고 있어서 슬롯을 바꾸면 되돌리기가 어긋난다.

   탭을 한 번도 안 열었으면 D(옵션 표)도 S 도 없다. 그때는 저장값만 고쳐 두면
   탭을 열 때 load() 가 집어 가고, 값 검증은 그쪽 normalize 가 맡는다. */
export function seedSlots(options) {
  const slots = [0, 1, 2].map(i => {
    const o = (options || [])[i];
    return o && o.name ? { opt: o.name, lv: o.level || 1, lock: 'none' }
      : { opt: '', lv: 11, lock: 'none' };
  });
  if (S) {
    S = { ...S, slots, history: [] };
    save();
    if (mounted) { ui = { slot: -1, lock: -1, pending: null }; paint(mounted); }
    return;
  }
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORE)); } catch { /* 깨졌으면 기본값 */ }
  localStorage.setItem(STORE,
    JSON.stringify({ ...defaults(), ...(saved || {}), slots, history: [] }));
}

/* ── 확률 엔진 (원본 명세 그대로) ─────────────────────────────
   제외된 옵션의 확률은 남은 옵션들에 비율대로 재분배되고,
   거기에 슬롯 등장확률을 곱한 값이 그 슬롯의 최종 확률이다.        */
function slotProbs(slotIdx, excluded) {
  const sp = SLOT_P[slotIdx];
  const avail = D.opts.filter(o => !excluded.has(o.id));
  const sum = avail.reduce((a, o) => a + o.pct, 0);
  if (sum <= 0) return {};
  const out = {};
  for (const o of avail) out[o.id] = sp * (o.pct / sum);
  return out;
}

const goalList = () => Object.entries(S.goals)
  .map(([id, g]) => ({ id, minLv: g.minLv }));

const isDone = s => {
  if (!s.opt || !S.goals[s.opt]) return false;
  return S.mode === 'opt' || s.lv >= (S.goals[s.opt].minLv || 1);
};
const isLvShort = s =>
  S.mode === 'lv' && s.opt && S.goals[s.opt] && s.lv < (S.goals[s.opt].minLv || 1);

const lockCount = (except = -1) =>
  S.slots.filter((s, j) => s.lock !== 'none' && j !== except).length;
const costMod = n => (n === 0 ? COST_MOD[0] : COST_MOD[1]);
const costKey = n => (n === 0 ? COST_KEY[0] : COST_KEY[1]);

/* 자유 슬롯 중 하나라도 목표를 뽑을 확률 */
function pFreeGoal(freeIdxs, gList) {
  const locked = new Set(S.slots.filter(s => s.lock === 'mod' && s.opt).map(s => s.opt));
  let none = 1;
  for (const i of freeIdxs) {
    const probs = slotProbs(i, locked);
    let no = 1;
    for (const g of gList) {
      const lvF = (S.mode === 'lv' && g.minLv) ? cumLP(g.minLv) : 1;
      no -= (probs[g.id] || 0) * lvF;
    }
    none *= Math.max(0, no);
  }
  return 1 - none;
}
const expEC = (freeIdxs, gList, lk) => {
  const p = pFreeGoal(freeIdxs, gList);
  return p <= 0 ? Infinity : (1 / p) * (lk + 1);
};
const expLR = (minLv, lk) => {
  const p = cumLP(minLv);
  return p <= 0 ? Infinity : (1 / p) * (lk + 1);
};

/* 목표를 하나씩 순서대로 달성한다고 보고 단계별 비용을 더한다.
   한 목표를 잡을 때마다 그 슬롯을 모듈잠금(2개)하고 다음 목표로 넘어간다. */
function expectedTotal() {
  const gList = goalList();
  if (!gList.length) return 0;
  const remain = gList.filter(g => !S.slots.some(s => isDone(s) && s.opt === g.id));
  if (!remain.length) return 0;

  let locked = S.slots.filter(s => s.lock === 'mod').length;
  const lockedOpts = new Set(S.slots.filter(s => s.lock === 'mod' && s.opt).map(s => s.opt));
  let free = 3 - locked;
  let total = 0;

  for (let step = 0; step < remain.length; step++) {
    const targets = remain.slice(step);
    const freeIdxs = [];
    for (let i = 0; i < 3 && freeIdxs.length < free; i++) {
      if (S.slots[i].lock !== 'mod') freeIdxs.push(i);
    }
    let none = 1;
    for (const i of freeIdxs) {
      const probs = slotProbs(i, lockedOpts);
      let no = 1;
      for (const g of targets) {
        const lvF = (S.mode === 'lv' && g.minLv) ? cumLP(g.minLv) : 1;
        no -= (probs[g.id] || 0) * lvF;
      }
      none *= Math.max(0, no);
    }
    const p = 1 - none;
    if (p <= 0) return Infinity;
    total += (1 / p) * (locked + 1);
    if (step < remain.length - 1) {
      total += COST_MOD[0];
      locked++; free--;
      lockedOpts.add(remain[step].id);
    }
  }

  if (S.mode === 'lv') {
    for (const s of S.slots) {
      if (isLvShort(s) && s.lock === 'none') total += expLR(S.goals[s.opt].minLv || 1, lockCount());
    }
  }
  return total;
}

/* ── 잠금 추천 ─────────────────────────────────────────────── */
function lockRec(i) {
  const s = S.slots[i];
  if (s.lock !== 'none' || !s.opt || !S.goals[s.opt] || !isDone(s)) return null;
  const g = S.goals[s.opt];

  if (i === 0) {
    if (s.lv < 15) return null;
    return { type: 'mod', why: t('np.whyBlack') };
  }
  if (i === 1) {
    if (!g.s2rec || s.lv < (g.s2recMinLv || 11)) return null;
    // 보수적 기준: 이 슬롯을 다시 뽑는 기대비용의 절반이 잠금비용보다 커야 권한다
    const locked = new Set(S.slots.filter((x, j) => x.lock === 'mod' && x.opt && j !== i).map(x => x.opt));
    const probs = slotProbs(1, locked);
    const sum = goalList().reduce((a, x) => a + (probs[x.id] || 0), 0);
    if (sum <= 0) return null;
    const loss = (1 / sum) * 0.5;
    if (loss <= costMod(lockCount(i))) return null;
    return { type: s.lv >= 12 ? 'mod' : 'key', why: t('np.whyLoss', loss.toFixed(1)) };
  }
  if (!g.s3rec || s.lv < (g.s3recMinLv || 11)) return null;
  return { type: s.lv >= 12 ? 'mod' : 'key', why: t('np.whySlot3') };
}

/* ── 리롤 ─────────────────────────────────────────────────── */
function pickWeighted(avail) {
  const sum = avail.reduce((a, x) => a + x.pct, 0);
  if (sum <= 0) return null;
  let r = Math.random() * sum, cum = 0;
  for (const x of avail) { cum += x.pct; if (r < cum) return x.id; }
  return avail.at(-1).id;
}

function rollLevel() {
  let cum = 0; const r = Math.random();
  for (let lv = 1; lv <= D.lp.length; lv++) { cum += D.lp[lv - 1]; if (r < cum) return lv; }
  return D.lp.length;
}

function rollSlot(i, excluded) {
  if (Math.random() >= SLOT_P[i]) return { opt: '', lv: 11 };
  const avail = D.opts.filter(o => !excluded.has(o.id));
  if (!avail.length) return { opt: '', lv: 11 };
  return { opt: pickWeighted(avail), lv: rollLevel() };
}

/* 효과변경 1회. 모듈잠금은 그대로, 락키잠금은 값을 지키고 잠금만 풀린다. */
function simulateChange() {
  const next = S.slots.map(s => ({ ...s }));
  const decided = new Set(next.filter(s => s.lock !== 'none' && s.opt).map(s => s.opt));
  for (let i = 0; i < 3; i++) {
    if (next[i].lock === 'mod') continue;
    if (next[i].lock === 'key') { next[i].lock = 'none'; continue; }
    const r = rollSlot(i, decided);
    next[i].opt = r.opt;
    next[i].lv = r.lv;
    if (r.opt) decided.add(r.opt);
  }
  return next;
}

/* ── 액션 ─────────────────────────────────────────────────── */
const commit = () => S.history.forEach(h => { h.committed = true; });

function apply(fn) {
  fn();
  save();
  paint(mounted);
}

function doLock(i, type) {
  const other = lockCount(i);
  const prev = S.slots[i].lock;
  if (type === 'mod' && prev === 'none') {
    const c = costMod(other);
    S.totalMod += c;
    S.history.push({ slot: i, prevLock: prev, type: 'mod', mod: c, key: 0, committed: false });
  } else if (type === 'key' && prev === 'none') {
    const c = costKey(other);
    S.totalKey += c;
    S.history.push({ slot: i, prevLock: prev, type: 'key', mod: 0, key: c, committed: false });
  } else if (type === 'none') {
    S.history = S.history.filter(h => h.slot !== i);
  }
  S.slots[i].lock = type;
  ui.lock = -1;
}

function cancelLock(i) {
  const idx = S.history.map(h => h.slot).lastIndexOf(i);
  if (idx === -1 || S.history[idx].committed) return;
  const h = S.history[idx];
  S.totalMod -= h.mod;
  S.totalKey -= h.key;
  S.slots[i].lock = h.prevLock;
  S.history.splice(idx, 1);
  ui.lock = -1;
}

function applyChange() {
  if (!ui.pending) return;
  commit();
  S.totalMod += lockCount() + 1;
  S.slots = ui.pending.map(s => ({ ...s }));
  ui.pending = null;
}

/* 수치재설정은 미리보기 없이 바로 실행된다 (원본과 동일). */
function applyLevelReset() {
  commit();
  S.totalMod += lockCount() + 1;
  for (const s of S.slots) {
    if (s.lock === 'key') { s.lock = 'none'; continue; }
    if (s.lock === 'mod' || !s.opt) continue;
    s.lv = rollLevel();
  }
}

/* ── 렌더: 목표 옵션 ───────────────────────────────────────── */
function renderGoals() {
  const card = el('section', 'np-card');
  card.appendChild(el('h3', null, t('np.goals')));
  card.appendChild(el('p', 'np-note', t('np.goalsHint')));

  const modes = el('div', 'np-modes');
  for (const [m, key] of [['opt', 'np.modeOpt'], ['lv', 'np.modeLv']]) {
    const b = el('button', 'np-mode' + (S.mode === m ? ' on' : ''), t(key));
    b.type = 'button';
    b.onclick = () => apply(() => { S.mode = m; });
    modes.appendChild(b);
  }
  card.appendChild(modes);

  const list = el('div', 'np-goallist');
  for (const o of D.opts) {
    const g = S.goals[o.id];
    const row = el('div', 'np-goal' + (g ? ' on' : ''));

    const head = el('button', 'np-goalhead');
    head.type = 'button';
    head.appendChild(el('span', 'np-chk', g ? '✓' : ''));
    head.appendChild(el('span', 'np-gname', optLabel(o)));
    head.appendChild(el('span', 'np-gfull', optFull(o)));
    head.appendChild(el('span', 'np-grate', pct(o.pct)));
    head.onclick = () => apply(() => {
      if (S.goals[o.id]) delete S.goals[o.id];
      else S.goals[o.id] = makeGoal(o.id);
    });
    row.appendChild(head);

    if (g) {
      const rules = el('div', 'np-rules');
      if (S.mode === 'lv') rules.appendChild(lvField(t('np.minLv'), g.minLv, v => {
        S.goals[o.id].minLv = v;
      }));
      rules.appendChild(recRule(t('np.slotN', 2), g.s2rec, g.s2recMinLv, 's2'));
      rules.appendChild(recRule(t('np.slotN', 3), g.s3rec, g.s3recMinLv, 's3'));
      row.appendChild(rules);

      function recRule(label, on, lv, key) {
        const box = el('label', 'np-rule');
        const cb = el('input');
        cb.type = 'checkbox';
        cb.checked = !!on;
        cb.onchange = () => apply(() => { S.goals[o.id][key + 'rec'] = cb.checked; });
        box.appendChild(cb);
        box.appendChild(el('span', null, label));
        const num = lvInput(lv, v => { S.goals[o.id][key + 'recMinLv'] = v; });
        num.disabled = !on;
        box.appendChild(num);
        return box;
      }
    }
    list.appendChild(row);
  }
  card.appendChild(list);
  return card;
}

function lvInput(value, set) {
  const n = el('input', 'np-lv');
  n.type = 'number';
  n.min = 1; n.max = 15; n.value = value;
  n.onchange = () => apply(() => set(Math.min(15, Math.max(1, +n.value || 1))));
  n.onclick = e => e.stopPropagation();
  return n;
}
function lvField(label, value, set) {
  const box = el('label', 'np-rule');
  box.appendChild(el('span', null, label));
  box.appendChild(lvInput(value, set));
  return box;
}

/* ── 렌더: 소모량 · 확률 ───────────────────────────────────── */
function renderCost() {
  const card = el('section', 'np-card');
  card.appendChild(el('h3', null, t('np.cost')));

  const gList = goalList();
  const lk = lockCount();
  const total = gList.length ? expectedTotal() : null;

  const grid = el('div', 'np-costgrid');
  const box = (title, cls, rows) => {
    const b = el('div', 'np-costbox');
    b.appendChild(el('div', 'np-costttl', title));
    for (const [label, value] of rows) {
      const r = el('div', 'np-costrow');
      r.appendChild(el('span', 'np-costlbl', label));
      r.appendChild(el('span', `np-costval ${cls}`, value));
      b.appendChild(r);
    }
    return b;
  };
  grid.appendChild(box(t('np.module'), 'np-m', [
    [t('np.expected'), total == null ? '—'
      : total === Infinity ? '∞' : t('np.approx', Math.round(total))],
    [t('np.spent'), t('np.pieces', S.totalMod)],
    [t('np.perRoll'), t('np.perRollN', lk + 1)],
  ]));
  grid.appendChild(box(t('np.lockkey'), 'np-k', [
    [t('np.expected'), '—'],
    [t('np.spent'), t('np.pieces', S.totalKey)],
    [t('np.perRoll'), '—'],
  ]));
  card.appendChild(grid);
  return card;
}

function renderProbBars() {
  const card = el('section', 'np-card');
  card.appendChild(el('h3', null, t('np.goalProb')));
  const gList = goalList();
  if (!gList.length) {
    card.appendChild(el('p', 'np-note', t('np.noGoal')));
    return card;
  }

  const locked = new Set(S.slots.filter(s => s.lock !== 'none' && s.opt).map(s => s.opt));
  const perSlot = i => {
    const probs = slotProbs(i, locked);
    return gList.reduce((a, g) => a + (probs[g.id] || 0)
      * (S.mode === 'lv' ? cumLP(g.minLv || 1) : 1), 0);
  };
  const free = [0, 1, 2].filter(i => S.slots[i].lock === 'none');
  const rows = [[t('np.freeAll'), pFreeGoal(free, gList)]]
    .concat([0, 1, 2].map(i => [t('np.slotP', i + 1, Math.round(SLOT_P[i] * 100)), perSlot(i)]));

  for (const [label, p] of rows) {
    const row = el('div', 'np-bar');
    const head = el('div', 'np-barhead');
    head.appendChild(el('span', null, label));
    head.appendChild(el('span', 'np-barval', pct(p)));
    row.appendChild(head);
    const track = el('div', 'np-track');
    const fill = el('div', 'np-fill ' + tone(p * 100));
    fill.style.width = Math.min(100, p * 100).toFixed(0) + '%';
    track.appendChild(fill);
    row.appendChild(track);
    card.appendChild(row);
  }
  return card;
}
const tone = v => (v >= 30 ? 'np-hi' : v >= 10 ? 'np-md' : 'np-lo');

/* ── 렌더: 장비 슬롯 ───────────────────────────────────────── */
function renderGear() {
  const card = el('section', 'np-card np-gearcard');
  card.appendChild(el('h3', null, t('np.gear')));

  S.slots.forEach((s, i) => card.appendChild(slotRow(s, i)));

  const acts = el('div', 'np-acts');
  const change = el('button', 'np-act np-act-ec', '↺ ' + t('np.btnChange'));
  change.type = 'button';
  change.onclick = () => { ui.pending = simulateChange(); paint(mounted); };
  const reset = el('button', 'np-act np-act-lr', '% ' + t('np.btnReset'));
  reset.type = 'button';
  reset.onclick = () => apply(applyLevelReset);
  acts.append(change, reset);
  card.appendChild(acts);

  const clear = el('button', 'btn-reset np-clear', t('np.clear'));
  clear.type = 'button';
  clear.onclick = () => apply(() => { S = defaults(); });
  card.appendChild(clear);
  return card;
}

function slotRow(s, i) {
  const o = s.opt ? gO(s.opt) : null;
  const row = el('div', 'np-slotrow');

  let cls = 'np-slot';
  if (!o) cls += ' empty';
  else {
    if (s.lv >= 15) cls += ' black';
    else if (s.lv >= 12) cls += ' blue';
    if (isDone(s)) cls += ' done';
    else if (isLvShort(s)) cls += ' short';
    else if (!S.goals[s.opt]) cls += ' off';
  }

  const bar = el('button', cls);
  bar.type = 'button';
  if (o) {
    bar.appendChild(el('span', 'np-sopt', optLabel(o)));
    bar.appendChild(el('span', 'np-sval', val(o, s.lv)));
    bar.appendChild(el('span', `np-lvb lvb-${s.lv <= 5 ? 1 : s.lv <= 10 ? 2 : s.lv <= 12 ? 3 : s.lv <= 14 ? 4 : 5}`,
      'lv' + s.lv));
    const rec = lockRec(i);
    if (rec) {
      const badge = el('span', `np-recbadge ${rec.type === 'mod' ? 'np-b-mod' : 'np-b-key'}`,
        (rec.type === 'mod' ? '🔒 ' : '🗝 ') + t(rec.type === 'mod' ? 'np.lockModS' : 'np.lockKeyS'));
      badge.title = rec.why;
      badge.onclick = e => { e.stopPropagation(); apply(() => doLock(i, rec.type)); };
      bar.appendChild(badge);
    }
    bar.appendChild(el('span', 'np-sp', Math.round(SLOT_P[i] * 100) + '%'));
  } else {
    bar.appendChild(el('span', 'np-sempty', t('np.emptySlot', i + 1)));
  }
  bar.onclick = () => { ui.slot = ui.slot === i ? -1 : i; ui.lock = -1; paint(mounted); };
  row.appendChild(bar);

  if (ui.slot === i) row.appendChild(slotPanel(s, i));

  const lockBtn = el('button', 'np-lockbtn' + (s.lock === 'mod' ? ' lmod' : s.lock === 'key' ? ' lkey' : ''),
    s.lock === 'mod' ? '🔒' : s.lock === 'key' ? '🗝' : '🔓');
  lockBtn.type = 'button';
  lockBtn.disabled = !s.opt;
  lockBtn.title = t('np.lockTitle');
  lockBtn.onclick = () => { ui.lock = ui.lock === i ? -1 : i; ui.slot = -1; paint(mounted); };
  row.appendChild(lockBtn);

  if (ui.lock === i) row.appendChild(lockMenu(s, i));
  return row;
}

function slotPanel(s, i) {
  const panel = el('div', 'np-panel');
  // 슬롯1 과 모듈잠금 슬롯의 옵션은 다른 슬롯에서 다시 고를 수 없다
  const used = new Set(S.slots
    .filter((x, j) => j !== i && x.opt && (j === 0 || x.lock === 'mod'))
    .map(x => x.opt));

  const sel = el('select', 'np-sel');
  const none = el('option', null, t('np.emptyOpt'));
  none.value = '';
  sel.appendChild(none);
  for (const o of D.opts) {
    const op = el('option', null,
      `${optLabel(o)} · ${(o.vals[10] * 100).toFixed(2)}~${(o.vals[14] * 100).toFixed(2)}% · ${pct(o.pct)}`);
    op.value = o.id;
    op.disabled = used.has(o.id);
    op.selected = s.opt === o.id;
    sel.appendChild(op);
  }

  const num = el('input', 'np-lv');
  num.type = 'number';
  num.min = 1; num.max = 15; num.value = s.lv;
  num.disabled = !s.opt;

  const preview = el('span', 'np-preview', s.opt ? val(gO(s.opt), s.lv) : '');
  const sync = () => {
    const o = sel.value ? gO(sel.value) : null;
    num.disabled = !o;
    preview.textContent = o ? val(o, Math.min(15, Math.max(1, +num.value || 1))) : '';
  };
  sel.onchange = sync;
  num.oninput = sync;

  const r1 = el('div', 'np-prow');
  r1.appendChild(el('span', 'np-plbl', t('np.option')));
  r1.appendChild(sel);
  const r2 = el('div', 'np-prow');
  r2.appendChild(el('span', 'np-plbl', t('np.level')));
  r2.appendChild(num);
  r2.appendChild(preview);

  const ok = el('button', 'np-apply', '✓ ' + t('np.set'));
  ok.type = 'button';
  ok.onclick = () => apply(() => {
    const opt = sel.value;
    if (opt !== S.slots[i].opt && S.slots[i].lock !== 'none') S.slots[i].lock = 'none';
    S.slots[i].opt = opt;
    S.slots[i].lv = Math.min(15, Math.max(1, +num.value || 11));
    ui.slot = -1;
  });

  panel.append(r1, r2, ok);
  return panel;
}

function lockMenu(s, i) {
  const menu = el('div', 'np-lockmenu');
  const item = (cls, text, fn) => {
    const b = el('button', 'np-lockitem ' + cls, text);
    b.type = 'button';
    b.onclick = () => apply(fn);
    menu.appendChild(b);
  };
  const other = lockCount(i);
  item('np-i-mod', '🔒 ' + t('np.lockMod', costMod(other)), () => doLock(i, 'mod'));
  item('np-i-key', '🗝 ' + t('np.lockKey', costKey(other)), () => doLock(i, 'key'));
  if (s.lock !== 'none') item('np-i-off', '🔓 ' + t('np.unlock'), () => doLock(i, 'none'));

  const h = [...S.history].reverse().find(x => x.slot === i);
  if (h && !h.committed) {
    item('np-i-cancel', '✕ ' + t('np.cancelLock',
      h.type === 'mod' ? t('np.pieces', h.mod) : t('np.pieces', h.key)), () => cancelLock(i));
  }
  return menu;
}

/* ── 렌더: 슬롯별 확률 표 ──────────────────────────────────── */
function renderProbTable() {
  const card = el('section', 'np-card');
  card.appendChild(el('h3', null, t('np.probTable')));

  const table = el('table', 'grid np-table');
  const thead = el('thead');
  const hr = el('tr');
  hr.appendChild(el('th', null, ''));
  for (const o of D.opts) {
    const th = el('th', 'num' + (S.goals[o.id] ? ' np-goalh' : ''), optLabel(o));
    th.title = optFull(o);
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = el('tbody');
  [0, 1, 2].forEach(i => {
    const s = S.slots[i];
    const locked = new Set(S.slots
      .filter((x, j) => x.lock !== 'none' && x.opt && j !== i).map(x => x.opt));
    const probs = slotProbs(i, locked);
    const tr = el('tr', s.lock === 'mod' ? 'np-rowmod' : s.lock === 'key' ? 'np-rowkey' : null);

    const lbl = el('td', 'np-rowlbl');
    lbl.appendChild(el('span', null,
      (s.lock === 'mod' ? '🔒 ' : s.lock === 'key' ? '🗝 ' : '') + t('np.slotN', i + 1)));
    lbl.appendChild(el('span', 'np-rowsp', t('np.appear', Math.round(SLOT_P[i] * 100))));
    tr.appendChild(lbl);

    for (const o of D.opts) {
      const mine = s.lock === 'mod' && s.opt === o.id;
      const p = (probs[o.id] || 0) * 100;
      if ((s.lock === 'mod' && !mine) || locked.has(o.id) || p <= 0) {
        tr.appendChild(el('td', 'num np-none', '—'));
        continue;
      }
      const goal = !!S.goals[o.id];
      const cls = goal ? (p >= 5 ? 'np-c-hi' : p >= 2 ? 'np-c-md' : 'np-c-lo') : 'np-c-off';
      tr.appendChild(el('td', 'num ' + cls, p.toFixed(1) + '%'));
    }
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  const wrap = el('div', 'np-scroll');
  wrap.appendChild(table);
  card.appendChild(wrap);
  return card;
}

/* ── 렌더: 추천 행동 ───────────────────────────────────────── */
function renderRec() {
  const gList = goalList();
  if (!gList.length) return null;

  const card = el('section', 'np-card');
  card.appendChild(el('h3', null, t('np.rec')));

  const lk = lockCount();
  const free = [0, 1, 2].filter(i => S.slots[i].lock === 'none');
  const needRoll = free.filter(i => !S.slots[i].opt
    || (!isDone(S.slots[i]) && !isLvShort(S.slots[i])));
  const recs = [];

  S.slots.forEach((s, i) => {
    const rec = lockRec(i);
    if (!rec) return;
    recs.push({
      ico: '🔒', pri: 'rec',
      title: t('np.recLock', i + 1, optLabel(gO(s.opt)), s.lv,
        t(rec.type === 'mod' ? 'np.lockModS' : 'np.lockKeyS')),
      desc: `${val(gO(s.opt), s.lv)} · ${rec.why}`,
    });
  });

  if (S.mode === 'lv') {
    S.slots.forEach((s, i) => {
      if (!isLvShort(s) || s.lock !== 'none') return;
      const min = S.goals[s.opt].minLv || 1;
      const p = cumLP(min);
      recs.push({
        ico: '📈', pri: 'hot',
        title: t('np.recLv', i + 1, optLabel(gO(s.opt)), min),
        desc: t('np.recLvDesc', s.lv, val(gO(s.opt), s.lv), min, val(gO(s.opt), min),
          pct(p), Math.round(expLR(min, lk))),
        p: p * 100,
      });
    });
  }

  if (needRoll.length) {
    const p = pFreeGoal(free, gList);
    const exp = expEC(free, gList, lk);
    recs.push({
      ico: '🎲', pri: recs.length ? 'rec' : 'hot',
      title: t('np.recRoll', needRoll.map(x => t('np.slotN', x + 1)).join(', ')),
      desc: t('np.recRollDesc', pct(p), lk + 1, exp === Infinity ? '∞' : Math.round(exp)),
      p: p * 100,
    });
  }

  if (!recs.some(r => r.ico === '🎲' || r.ico === '📈') && S.slots.some(s => isDone(s))) {
    recs.unshift({ ico: '🎉', pri: 'ok', title: t('np.recDone'), desc: t('np.recDoneDesc') });
  }

  const order = { hot: 0, rec: 1, ok: 2 };
  recs.sort((a, b) => (order[a.pri] ?? 1) - (order[b.pri] ?? 1));

  for (const r of recs) {
    const row = el('div', 'np-recrow');
    row.appendChild(el('div', 'np-recico', r.ico));
    const body = el('div', 'np-recbody');
    const title = el('div', 'np-rectitle');
    title.appendChild(el('span', null, r.title));
    title.appendChild(el('span', `np-tag np-tag-${r.pri}`, t('np.tag_' + r.pri)));
    body.appendChild(title);
    body.appendChild(el('div', 'np-recdesc', r.desc));
    if (r.p != null) {
      const track = el('div', 'np-track');
      const fill = el('div', 'np-fill ' + (r.p >= 50 ? 'np-hi' : r.p >= 20 ? 'np-md' : 'np-lo'));
      fill.style.width = Math.min(100, r.p).toFixed(0) + '%';
      track.appendChild(fill);
      body.appendChild(track);
    }
    row.appendChild(body);
    card.appendChild(row);
  }
  return card;
}

/* ── 렌더: 효과변경 미리보기 ───────────────────────────────── */
function renderModal() {
  const bg = el('div', 'np-modalbg');
  const box = el('div', 'np-modal');

  const head = el('div', 'np-modalhead');
  head.appendChild(el('span', null, t('np.modalTitle')));
  const x = el('button', 'np-modalx', '✕');
  x.type = 'button';
  x.onclick = () => { ui.pending = null; paint(mounted); };
  head.appendChild(x);
  box.appendChild(head);

  const body = el('div', 'np-modalbody');
  const side = (title, arr, isNew) => {
    const s = el('div', 'np-side');
    s.appendChild(el('div', 'np-sidettl', title));
    arr.forEach(slot => {
      const o = slot.opt ? gO(slot.opt) : null;
      let cls = 'np-ovslot';
      if (!o) cls += ' empty';
      else if (isNew && isDone(slot)) cls += ' good';
      else if (isNew) cls += ' new';
      const line = el('div', cls);
      line.appendChild(el('span', null, o ? optLabel(o) : t('np.none')));
      if (o) line.appendChild(el('span', 'np-ovval', `${val(o, slot.lv)} lv${slot.lv}`));
      s.appendChild(line);
    });
    return s;
  };
  body.appendChild(side(t('np.cur'), S.slots, false));
  body.appendChild(side(t('np.next'), ui.pending, true));
  box.appendChild(body);

  const btns = el('div', 'np-modalbtns');
  const keep = el('button', 'np-mb np-mb-keep', '↺ ' + t('np.keep'));
  keep.type = 'button';
  keep.onclick = () => apply(() => {
    // 유지해도 락키 잠금은 이번 회차로 풀린다
    S.slots.forEach(s => { if (s.lock === 'key') s.lock = 'none'; });
    ui.pending = null;
  });
  const go = el('button', 'np-mb np-mb-apply', '✓ ' + t('np.apply'));
  go.type = 'button';
  go.onclick = () => apply(applyChange);
  btns.append(keep, go);
  box.appendChild(btns);

  bg.appendChild(box);
  bg.onclick = e => { if (e.target === bg) { ui.pending = null; paint(mounted); } };
  return bg;
}

/* ── 페인트 ───────────────────────────────────────────────── */
function paint(root) {
  root.textContent = '';

  const top = el('div', 'np-top');
  top.appendChild(renderGoals());
  const right = el('div', 'np-col');
  right.appendChild(renderCost());
  right.appendChild(renderProbBars());
  top.appendChild(right);
  root.appendChild(top);

  const mid = el('div', 'np-mid');
  mid.appendChild(renderGear());
  mid.appendChild(renderProbTable());
  root.appendChild(mid);

  const rec = renderRec();
  if (rec) root.appendChild(rec);

  if (ui.pending) root.appendChild(renderModal());
}

/* 슬롯 패널·자물쇠 메뉴는 바깥을 누르면 닫힌다. 리스너는 한 번만 건다. */
let wired = false;
function wireOutside() {
  if (wired) return;
  wired = true;
  document.addEventListener('click', e => {
    if (!mounted || !mounted.isConnected) return;
    if (ui.slot === -1 && ui.lock === -1) return;
    if (e.target.closest('.np-slotrow')) return;
    ui.slot = -1; ui.lock = -1;
    paint(mounted);
  });
}

/* app.js 가 부르는 유일한 진입점. 탭을 열 때마다, 언어·테마가 바뀌어도 호출된다. */
export async function renderNipago(root, context) {
  ctx = context;
  mounted = root;
  if (!D) {
    root.textContent = '';
    root.appendChild(el('p', 'notice', t('np.loading')));
    try {
      await loadAll();
    } catch (err) {
      root.textContent = '';
      root.appendChild(el('p', 'notice notice-error', String(err.message || err)));
      return;
    }
    S = load();
  }
  wireOutside();
  paint(root);
}
