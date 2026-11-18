/* 장탄·차속 조합 탭 - 오버로드 장탄/차속 옵션 1-4줄로 도달할 수 있는 목표 수치와, 그 수치를 만드는 단계 조합을 모두 보여준다.
   장탄은 기본 장탄 수별 발 수, 차속은 정수 % 로 센다. 반올림은 옵션작 탭과 같은 effValue(같은 단계 묶음마다 반올림)를 쓴다. */

import { effValue } from './nipago/effective.js';
import { optionLabel } from './cp.js';

const STORE = 'olcombo.input';
const MAX_LV = 15;
const MAX_LINES = 4;
/* data/cubes.json 의 장탄·차속 큐브 */
const CUBE = { ammo: '1000306', charge: '1000305' };

let ctx = null, D = null, base = './data/';
let S = null;

const t = (k, ...a) => ctx.t(k, ...a);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const pct = bp => (bp / 100).toFixed(2) + '%';
const sum = a => a.reduce((s, x) => s + x, 0);

/* ── 로드 ─────────────────────────────────────────────────── */
async function fetchJSON(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} - ${url}`);
  return r.json();
}

async function loadAll() {
  const probe = async b => { await fetchJSON(b + 'weapons.json'); return b; };
  try { base = await probe('./data/'); }
  catch { base = await probe('https://raw.githubusercontent.com/RADM90/MechaShifty/main/data/'); }

  const [weapons, option, cubes] = await Promise.all(
    ['weapons.json', 'raw/equip_option.json', 'cubes.json'].map(f => fetchJSON(base + f)));
  D = build(weapons, option, cubes);
}

/* 옵션 수치는 정수 basis point 로 들고 있어 .5 경계가 이진 소수 오차로 흔들리지 않는다 (옵션작 탭과 같다). */
function build(weapons, option, cubes) {
  const col = name => option.columns.findIndex(c => c.label?.ko === name);
  const bpOf = name => { const i = col(name); return option.rows.map(r => Math.round(r[i] * 10000)); };

  /* 니케 목록 순서대로 그룹에 넣어 이름 나열이 니케 리스트와 같은 순서가 된다. */
  const groups = { ammo: new Map(), charge: new Map() };
  for (const n of ctx.nikkes) {
    const w = weapons.nikkes?.[n.rid];
    if (!w) continue;
    const add = (m, key) => {
      if (!m.has(key)) m.set(key, { key, nikkes: [], wt: {} });
      const g = m.get(key);
      g.nikkes.push(n);
      g.wt[n.weapon_type] = (g.wt[n.weapon_type] || 0) + 1;
    };
    if (w.ammo) add(groups.ammo, w.ammo);
    if (w.charge) add(groups.charge, w.charge);
  }
  const sorted = m => [...m.values()].sort((a, b) => a.key - b.key);

  return {
    bp: { ammo: bpOf('장탄'), charge: bpOf('차속') },
    groups: { ammo: sorted(groups.ammo), charge: sorted(groups.charge) },
    cube: { ammo: cubes.cubes?.[CUBE.ammo]?.values || [], charge: cubes.cubes?.[CUBE.charge]?.values || [] },
    /* 소장품의 장탄 효과는 MG 무기군에만 있다. 애장품은 SR 4단계와 같다. */
    coll: { R: weapons.collection?.R?.MG?.ammo || [], SR: weapons.collection?.SR?.MG?.ammo || [] },
    combos: allCombos(),
  };
}

/* 단계 1-15 중 1-4줄의 모든 중복 조합. 각 조합은 단계 내림차순이다. */
function allCombos() {
  const out = [];
  const rec = (start, acc) => {
    for (let lv = start; lv <= MAX_LV; lv++) {
      acc.push(lv);
      out.push(acc.slice().reverse());
      if (acc.length < MAX_LINES) rec(lv, acc);
      acc.pop();
    }
  };
  rec(1, []);
  return out;
}

/* 같은 수치가 이어지는 레벨을 한 선택지로 묶는다 (큐브 Lv 7-15 처럼). */
function tierOptions(values) {
  const out = [];
  values.forEach((v, i) => {
    const last = out[out.length - 1];
    if (last && last.v === v) last.hi = i + 1;
    else out.push({ v, lo: i + 1, hi: i + 1 });
  });
  return out.map(o => ({ v: o.v, label: `Lv ${o.lo}${o.hi > o.lo ? '-' + o.hi : ''}` }));
}

function collOptions() {
  const out = [];
  for (const rare of ['R', 'SR']) D.coll[rare].forEach((v, i) => {
    const fav = rare === 'SR' && i === D.coll.SR.length - 1;
    out.push({ v, label: t('oc.collPhase', rare, i + 1) + (fav ? ` · ${t('cp.favorite')}` : '') });
  });
  return out;
}

/* ── 모드별 규칙 ──────────────────────────────────────────── */
/* cfg 는 effValue 입력. 장탄은 기본 장탄 x % 를 발로, 차속은 % 를 정수로 반올림한다. */
const MODES = {
  ammo: {
    opt: '장탄',
    cfg: g => ({ kind: 'ammo', A: g.key }),
    base: g => g.key,
    groupLabel: g => t('oc.shots', g.key),
    show: v => String(v),
    big: v => t('oc.shots', v),
  },
  charge: {
    opt: '차속',
    cfg: () => ({ kind: 'charge', model: 'pct' }),
    base: () => 0,
    groupLabel: g => t('oc.sec', g.key.toFixed(1)),
    show: v => v + '%',
    big: v => v + '%',
  },
};

/* 옵션 줄 묶음 하나(bp)를 반올림한 기여. 큐브·소장품도 각각 한 묶음이다. */
const part = (cfg, bp) => effValue(cfg, [1], [bp]).value;

/* 현재 켜진 추가 효과 [{ label, bp }] */
function extras(mode, g) {
  const out = [];
  const c = S.cube[mode];
  const cubeOpts = tierOptions(D.cube[mode]);
  if (c.on && cubeOpts[c.lv]) out.push({ label: t('oc.cube'), bp: Math.round(cubeOpts[c.lv].v * 100) });
  if (mode === 'ammo' && S.coll.on && g.wt.MG === g.nikkes.length) {
    const o = collOptions()[S.coll.lv];
    if (o) out.push({ label: t('oc.coll'), bp: Math.round(o.v * 100) });
  }
  return out;
}

/* 목표 수치 -> 조합 목록 (단계 내림차순 사전식) */
function valueMap(mode, g) {
  const M = MODES[mode], cfg = M.cfg(g), bp = D.bp[mode];
  const add = sum(extras(mode, g).map(e => part(cfg, e.bp)));
  const m = new Map();
  for (const ls of D.combos) {
    const v = M.base(g) + add + effValue(cfg, ls, bp).value;
    if (!m.has(v)) m.set(v, []);
    m.get(v).push(ls);
  }
  for (const l of m.values()) l.sort(desc);
  return { add, map: new Map([...m].sort((a, b) => a[0] - b[0])) };
}

const desc = (a, b) => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return b[i] - a[i];
  return b.length - a.length;
};
/* 최저 수치: 줄 수, 최고 단계, 단계 합이 작은 순 */
const low = (a, b) => a.length - b.length || a[0] - b[0] || sum(a) - sum(b) || -desc(a, b);

/* ── 상태 ─────────────────────────────────────────────────── */
const defaults = () => ({
  mode: 'ammo',
  g: { ammo: 60, charge: 1 },
  v: { ammo: null, charge: null },
  cube: { ammo: { on: false, lv: null }, charge: { on: false, lv: null } },
  coll: { on: false, lv: null },
});

function load() {
  const d = defaults();
  try {
    const v = JSON.parse(localStorage.getItem(STORE));
    if (v && typeof v === 'object') {
      if (v.mode in MODES) d.mode = v.mode;
      for (const m of Object.keys(MODES)) {
        if (D.groups[m].some(g => g.key === v.g?.[m])) d.g[m] = v.g[m];
        if (Number.isFinite(v.v?.[m])) d.v[m] = v.v[m];
        if (v.cube?.[m]) d.cube[m] = { on: !!v.cube[m].on, lv: Number.isInteger(v.cube[m].lv) ? v.cube[m].lv : null };
      }
      if (v.coll) d.coll = { on: !!v.coll.on, lv: Number.isInteger(v.coll.lv) ? v.coll.lv : null };
    }
  } catch { /* 저장값이 깨졌으면 기본값 */ }
  /* 레벨을 고른 적이 없으면 가장 높은 구간 */
  for (const m of Object.keys(MODES)) if (d.cube[m].lv == null) d.cube[m].lv = tierOptions(D.cube[m]).length - 1;
  if (d.coll.lv == null) d.coll.lv = collOptions().length - 1;
  return d;
}
const save = () => { try { localStorage.setItem(STORE, JSON.stringify(S)); } catch { /* 저장 불가 환경 */ } };

/* ── 폼 ───────────────────────────────────────────────────── */
function card(title, ...kids) {
  const g = el('div', 'op-group');
  if (title) g.appendChild(el('h3', null, title));
  for (const k of kids) if (k) g.appendChild(k);
  return g;
}

function seg(options, value, onPick) {
  const box = el('div', 'ic-seg');
  for (const o of options) {
    const b = el('button', 'ic-segbtn' + (o.value === value ? ' on' : ''), o.label);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(o.value === value));
    b.onclick = () => onPick(o.value);
    box.appendChild(b);
  }
  return box;
}

/* 켬/끔 체크박스 + 레벨 선택. 끄면 선택은 남겨 두고 비활성으로만 둔다. */
function toggle(id, label, state, opts, onChange, hint) {
  const row = el('div', 'oc-toggle');
  const lab = el('label', 'oc-check');
  const cb = el('input');
  cb.type = 'checkbox'; cb.id = id; cb.checked = state.on;
  cb.onchange = () => onChange({ on: cb.checked, lv: state.lv });
  lab.append(cb, document.createTextNode(label));
  const sel = el('select');
  sel.id = id + 'Lv';
  sel.disabled = !state.on;
  sel.setAttribute('aria-label', label);
  opts.forEach((o, i) => {
    const op = el('option', null, `${o.label} : ${o.v.toFixed(2)}%`);
    op.value = String(i);
    sel.appendChild(op);
  });
  sel.value = String(state.lv);
  sel.onchange = () => onChange({ on: state.on, lv: Number(sel.value) });
  row.append(lab, sel);
  if (hint) row.appendChild(el('span', 'oc-hint', hint));
  return row;
}

function renderConditions(root, mode, g) {
  /* 추가 효과를 바꾸면 모든 값이 같은 만큼 움직이므로, 고른 목표도 같이 옮겨 같은 조합을 가리키게 한다. */
  const shift = patch => {
    const before = valueMap(mode, g).add;
    patch();
    const after = valueMap(mode, g).add;
    if (S.v[mode] != null) S.v[mode] += after - before;
    save(); paint(root);
  };

  const kind = seg(Object.keys(MODES).map(m => ({ value: m, label: optionLabel(MODES[m].opt, ctx.lang) })),
    mode, v => { if (v !== S.mode) { S.mode = v; save(); paint(root); } });

  const box = el('div', 'oc-toggles');
  box.appendChild(toggle('ocCube', t(mode === 'ammo' ? 'oc.cubeAmmo' : 'oc.cubeCharge'), S.cube[mode],
    tierOptions(D.cube[mode]), v => shift(() => { S.cube[mode] = v; })));
  if (mode === 'ammo') {
    box.appendChild(toggle('ocColl', t('oc.coll'), S.coll, collOptions(),
      v => shift(() => { S.coll = v; }), t('oc.collMG')));
  } else {
    box.appendChild(el('p', 'oc-hint', t('oc.noCollCharge')));
  }

  const c = card(null);
  c.className += ' oc-cond';
  const f1 = el('div', 'ic-field');
  f1.append(el('span', 'op-lbl', t('oc.option')), kind);
  const f2 = el('div', 'ic-field');
  f2.append(el('span', 'op-lbl', t('oc.extra')), box);
  c.append(f1, f2);
  return c;
}

/* 단계별 세부 수치 + 기본 수치 칩 + 해당 니케 */
function renderGroups(root, mode, g) {
  const M = MODES[mode], bp = D.bp[mode], cfg = M.cfg(g);
  const c = card(t(mode === 'ammo' ? 'oc.baseAmmo' : 'oc.baseCharge'));

  const tbl = el('table', 'oc-lv');
  const head = el('tr');
  head.appendChild(el('th', null, t('oc.tier')));
  for (let lv = 1; lv <= MAX_LV; lv++) head.appendChild(el('td', null, String(lv)));
  const rowPct = el('tr');
  rowPct.appendChild(el('th', null, t('oc.optPct')));
  bp.forEach(b => rowPct.appendChild(el('td', null, pct(b))));
  const rowOne = el('tr');
  rowOne.appendChild(el('th', null, t(mode === 'ammo' ? 'oc.oneLineAmmo' : 'oc.oneLineCharge')));
  bp.forEach(b => rowOne.appendChild(el('td', null, mode === 'ammo' ? `+${part(cfg, b)}` : `${part(cfg, b)}%`)));
  const thead = el('thead'); thead.appendChild(head);
  const tbody = el('tbody'); tbody.append(rowPct, rowOne);
  tbl.append(thead, tbody);
  const scroll = el('div', 'oc-scroll');
  scroll.appendChild(tbl);
  c.appendChild(scroll);

  const chips = el('div', 'oc-groups');
  chips.setAttribute('role', 'group');
  for (const x of D.groups[mode]) {
    const b = el('button', 'oc-gchip');
    b.type = 'button';
    b.setAttribute('aria-pressed', String(x === g));
    b.append(el('span', 'oc-gv', M.groupLabel(x)),
      el('span', 'oc-gs', `${t('oc.people', x.nikkes.length)} · ${Object.keys(x.wt).join('/')}`));
    b.onclick = () => {
      if (x === g) return;
      S.g[mode] = x.key;
      /* 차속 정수 % 는 기본 차지 시간과 상관없으므로 고른 목표를 유지한다 */
      if (mode === 'ammo') S.v.ammo = null;
      save(); paint(root);
    };
    chips.appendChild(b);
  }
  c.appendChild(chips);

  const wt = Object.entries(g.wt).map(([w, n]) => `${w} ${t('oc.people', n)}`).join(', ');
  c.appendChild(el('p', 'oc-who', `${wt} : ${g.nikkes.map(ctx.nameOf).join(', ')}`));
  return c;
}

function renderTargets(root, mode, vm) {
  const M = MODES[mode];
  const c = el('div', 'op-group');
  const h = el('h3', null, t(mode === 'ammo' ? 'oc.targetAmmo' : 'oc.targetCharge'));
  h.appendChild(el('span', 'oc-count', t('oc.count', vm.size)));
  c.appendChild(h);

  const chips = el('div', 'oc-chips');
  chips.setAttribute('role', 'group');
  for (const [v, list] of vm) {
    const k = Math.min(...list.map(ls => ls.length));
    const b = el('button', `oc-chip oc-k${k}`, M.show(v));
    b.type = 'button';
    b.setAttribute('aria-pressed', String(v === S.v[mode]));
    b.onclick = () => { S.v[mode] = v; save(); paint(root); };
    chips.appendChild(b);
  }
  c.appendChild(chips);

  const lg = el('div', 'oc-legend');
  lg.appendChild(el('span', null, t('oc.minLines')));
  for (let k = 1; k <= MAX_LINES; k++) {
    const it = el('span', 'oc-legItem');
    it.append(el('span', `oc-swatch oc-k${k}`), document.createTextNode(t('oc.lines', k)));
    lg.appendChild(it);
  }
  c.appendChild(lg);
  return c;
}

/* 조합 한 줄: 옵션 % 합계 - 단계 / 단계 / ... */
function comboLine(mode, ls) {
  const s = el('span', 'oc-combo');
  s.append(el('span', 'oc-sum', `${pct(sum(ls.map(lv => D.bp[mode][lv - 1])))} -`),
    el('span', 'oc-lvs', ls.join(' / ')));
  return s;
}

function renderCombo(mode, g, vm, add) {
  const M = MODES[mode], v = S.v[mode], list = vm.get(v), cfg = M.cfg(g);
  const c = el('div', 'op-group oc-result');

  const head = el('div', 'oc-head');
  head.appendChild(el('span', 'oc-big', M.big(v)));
  let meta;
  if (mode === 'ammo') {
    meta = t('oc.headAmmo', g.key, v - g.key - add, add);
  } else {
    const time = g.key * (1 - v / 100);
    meta = t('oc.headCharge', g.key.toFixed(1), time.toFixed(2), (1 / time).toFixed(2), (1 / g.key).toFixed(2));
  }
  head.appendChild(el('span', 'oc-meta', `${meta} · ${t('oc.combos', list.length)}`));
  c.appendChild(head);

  const byK = [];
  for (let k = 1; k <= MAX_LINES; k++) {
    const l = list.filter(ls => ls.length === k);
    if (l.length) byK.push(l);
  }

  const box = el('div', 'oc-low');
  const first = el('div');
  first.append(el('b', null, t('oc.lowest')), comboLine(mode, list.slice().sort(low)[0]));
  box.appendChild(first);
  if (byK.length > 1) for (const l of byK) {
    const d = el('div', 'oc-dim');
    d.append(el('span', null, t('oc.lowestK', l[0].length)), comboLine(mode, l.slice().sort(low)[0]));
    box.appendChild(d);
  }
  const ex = extras(mode, g);
  if (ex.length) {
    const unit = x => mode === 'ammo' ? t('oc.plusShots', x) : `+${x}%`;
    box.appendChild(el('div', 'oc-dim',
      `${t('oc.always')} : ${ex.map(e => `${e.label} ${pct(e.bp)} (${unit(part(cfg, e.bp))})`).join(' + ')}`));
  }
  c.appendChild(box);

  const lists = el('div', 'oc-lists');
  for (const l of byK) {
    const sec = el('div');
    sec.appendChild(el('h4', null, `${t('oc.lines', l[0].length)} · ${t('oc.count', l.length)}`));
    const ol = el('ol');
    for (const ls of l) { const li = el('li'); li.appendChild(comboLine(mode, ls)); ol.appendChild(li); }
    sec.appendChild(ol);
    lists.appendChild(sec);
  }
  c.appendChild(lists);
  return c;
}

function renderNotes(mode) {
  const ul = el('ul', 'oc-notes');
  for (const k of mode === 'ammo' ? ['oc.noteLines', 'oc.noteAmmo', 'oc.noteAmmoColl'] : ['oc.noteLines', 'oc.noteCharge', 'oc.noteChargeTime'])
    ul.appendChild(el('li', null, t(k)));
  return ul;
}

function paint(root) {
  root.textContent = '';
  const mode = S.mode;
  const groups = D.groups[mode];
  const g = groups.find(x => x.key === S.g[mode]) || groups[0];
  const { add, map } = valueMap(mode, g);
  if (!map.has(S.v[mode])) S.v[mode] = map.keys().next().value;

  const wrap = el('div', 'oc-wrap');
  wrap.appendChild(el('p', 'op-note', t(mode === 'ammo' ? 'oc.leadAmmo' : 'oc.leadCharge')));
  wrap.append(renderConditions(root, mode, g), renderGroups(root, mode, g),
    renderTargets(root, mode, map), renderCombo(mode, g, map, add), renderNotes(mode));
  root.appendChild(wrap);
}

/* app.js 가 부르는 유일한 진입점 */
export async function renderOlCombo(root, context) {
  ctx = context;
  if (!D) {
    root.textContent = '';
    root.appendChild(el('p', 'notice', t('oc.loading')));
    try {
      await loadAll();
    } catch (err) {
      root.textContent = '';
      root.appendChild(el('p', 'notice notice-error', String(err.message || err)));
      return;
    }
    S = load();
  }
  paint(root);
}
