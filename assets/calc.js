/* 보정 전투력 계산기 탭.

   계산은 cp.js 가 전부 하고 여기는 입력 폼과 결과 표만 그린다.
   원본 스탯 표(data/raw/*.json)와 도메인 규칙(data/cp_rules.json)은
   이 탭을 처음 열 때만 받아온다 — syncro_stat 하나가 500KB라 첫 화면에
   같이 얹지 않는다. */

import { buildTables, compute, SLOTS, TIERS } from './cp.js';

const NEED = ['syncro_stat', 'attraction_stat', 'attraction_grade', 'equip_stat',
  'equip_option', 'cube_stat', 'collection_stat', 'collection_bonus', 'cp_penalty'];
const STORE = 'cp.input';

/* 레벨이 고정되는 컨텐츠는 40(협동 작전)과 400(솔로 레이드·챔피언 아레나) 두 가지뿐이라
   그 두 레벨의 전투력만 보여준다. */
const ADJ_LEVELS = [40, 400];

let ctx = null, T = null, rules = null, base = './data/';
let input = null;
const compare = [];

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const t = (k, ...a) => ctx.t(k, ...a);
const fmt = v => v == null ? '—' : Math.round(v).toLocaleString();

/* 표는 좁은 화면에서 자기 상자 안에서만 가로 스크롤해야 한다 (페이지가 밀리지 않게) */
function scrollBox(table) {
  const d = el('div', 'cp-scroll');
  d.appendChild(table);
  return d;
}

/* ── 로드 ─────────────────────────────────────────────────── */
async function fetchJSON(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} — ${url}`);
  return r.json();
}

async function loadAll() {
  const probe = async b => { await fetchJSON(b + 'cp_rules.json'); return b; };
  try { base = await probe('./data/'); }
  catch { base = await probe('https://raw.githubusercontent.com/RADM90/MechaShifty/main/data/'); }

  const [r, ...tables] = await Promise.all([
    fetchJSON(base + 'cp_rules.json'),
    ...NEED.map(k => fetchJSON(`${base}raw/${k}.json`)),
  ]);
  rules = r;
  T = buildTables(Object.fromEntries(NEED.map((k, i) => [k, tables[i]])));
}

/* ── 입력 기본값 ───────────────────────────────────────────── */
function defaults() {
  const n = ctx.nikkes.find(x => x.rid === 'c010') || ctx.nikkes[0];
  return {
    rid: n.rid,
    level: 400,
    grade: T.grades.at(-1)?.key || '0돌',
    bond: T.bondMax,
    skills: { s1: 10, s2: 10, burst: 10 },
    cube: '미착용',
    collection: { kind: 'none', level: '0' },
    console: { 공용: 0, 클래스: 0, 기업: 0 },
    gear: SLOTS.map(slot => ({ slot, tier: '', enhance: 0, options: [] })),
  };
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE));
    if (saved && saved.rid && ctx.nikkes.some(n => n.rid === saved.rid)) return saved;
  } catch { /* 저장값이 깨졌으면 기본값으로 */ }
  return defaults();
}
const save = () => localStorage.setItem(STORE, JSON.stringify(input));

/* 선택한 니케의 고정 속성을 입력에 얹는다. 방어력 계열이 무기와 다른
   예외 니케(하란)는 cp_rules.json 의 override 를 쓴다. */
function resolved() {
  const n = ctx.byRid.get(input.rid);
  if (!n) return null;
  return {
    ...input,
    rarity: n.rarity, class: n.class, corporation: n.corporation,
    weapon: n.weapon_type,
    defWeapon: rules.def_weapon_override?.[n.rid] || n.weapon_type,
    _nikke: n,
  };
}

/* ── 폼 조각 ──────────────────────────────────────────────── */
function field(labelText, control, hint) {
  const w = el('label', 'cp-field');
  w.appendChild(el('span', 'cp-lbl', labelText));
  w.appendChild(control);
  if (hint) w.appendChild(el('span', 'cp-hint', hint));
  return w;
}

function select(options, value, onChange) {
  const s = el('select');
  for (const o of options) {
    const opt = el('option', null, o.label);
    opt.value = String(o.value);
    s.appendChild(opt);
  }
  s.value = String(value);
  s.onchange = () => onChange(s.value);
  return s;
}

function number(value, min, max, onChange) {
  const i = el('input');
  i.type = 'number';
  i.min = min; i.max = max; i.value = value;
  i.onchange = () => {
    const v = Math.max(min, Math.min(max, Number(i.value) || min));
    i.value = v;
    onChange(v);
  };
  return i;
}

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => ({ value: a + i, label: String(a + i) }));

/* ── 폼 ───────────────────────────────────────────────────── */
function renderForm(root) {
  const form = el('div', 'cp-form');
  const set = (fn) => { fn(); save(); paint(root); };

  // 니케
  const g1 = el('div', 'cp-group');
  g1.appendChild(el('h3', null, t('cp.nikke')));
  const row1 = el('div', 'cp-row');
  const nikkes = ctx.nikkes.slice().sort((a, b) =>
    ctx.nameOf(a).localeCompare(ctx.nameOf(b), ctx.lang));
  row1.appendChild(field(t('cp.pick'),
    select(nikkes.map(n => ({ value: n.rid, label: ctx.nameOf(n) })), input.rid,
      v => set(() => { input.rid = v; }))));
  row1.appendChild(field(t('cp.level'),
    number(input.level, T.levels[0], T.levels.at(-1), v => set(() => { input.level = v; })),
    t('cp.levelHint', T.levels.at(-1))));
  row1.appendChild(field(t('cp.grade'),
    select(T.grades.map(g => ({ value: g.key, label: g.key })), input.grade,
      v => set(() => { input.grade = v; }))));
  row1.appendChild(field(t('cp.bond'),
    number(input.bond, 1, T.bondMax, v => set(() => { input.bond = v; }))));
  g1.appendChild(row1);
  form.appendChild(g1);

  // 스킬
  const g2 = el('div', 'cp-group');
  g2.appendChild(el('h3', null, t('cp.skills')));
  const row2 = el('div', 'cp-row');
  for (const [key, lab] of [['s1', t('cp.skill1')], ['s2', t('cp.skill2')], ['burst', t('cp.burst')]]) {
    row2.appendChild(field(lab, select(range(1, 10), input.skills[key],
      v => set(() => { input.skills[key] = Number(v); }))));
  }
  g2.appendChild(row2);
  form.appendChild(g2);

  // 장착품
  const g3 = el('div', 'cp-group');
  g3.appendChild(el('h3', null, t('cp.items')));
  const row3 = el('div', 'cp-row');
  row3.appendChild(field(t('cp.cube'),
    select(T.cubeLevels.map(l => ({ value: l, label: l === '미착용' ? t('cp.none') : 'Lv.' + l })),
      input.cube, v => set(() => { input.cube = v; }))));

  const kinds = [{ value: 'none', label: t('cp.none') }, { value: 'R', label: 'R' },
    { value: 'SR', label: 'SR' }, { value: '애장품', label: t('cp.favorite') }];
  row3.appendChild(field(t('cp.collection'),
    select(kinds, input.collection.kind, v => set(() => {
      input.collection.kind = v;
      input.collection.level = v === '애장품' ? T.favoriteLevels[0] : '0';
    }))));
  if (input.collection.kind !== 'none') {
    const lvs = input.collection.kind === '애장품'
      ? T.favoriteLevels.map(l => ({ value: l, label: 'Lv.' + l }))
      : range(0, 15).map(n => ({ value: String(n), label: input.collection.kind + n }));
    row3.appendChild(field(t('cp.collectionLv'),
      select(lvs, input.collection.level, v => set(() => { input.collection.level = v; }))));
  }
  g3.appendChild(row3);
  form.appendChild(g3);

  // 콘솔 (리사이클 룸)
  const g4 = el('div', 'cp-group');
  g4.appendChild(el('h3', null, t('cp.console')));
  g4.appendChild(el('p', 'cp-note', t('cp.consoleHint')));
  const row4 = el('div', 'cp-row');
  for (const kind of ['공용', '클래스', '기업']) {
    row4.appendChild(field(t('cp.console_' + kind),
      number(input.console[kind], 0, 999, v => set(() => { input.console[kind] = v; }))));
  }
  g4.appendChild(row4);
  form.appendChild(g4);

  // 장비 4부위
  const g5 = el('div', 'cp-group');
  g5.appendChild(el('h3', null, t('cp.gear')));
  // 기업 소속이 아닌 일반 T9 장비는 원본에 스탯 표가 없다 (DEVIATIONS.md)
  g5.appendChild(el('p', 'cp-note cp-warn', t('cp.gearLimit')));
  for (const g of input.gear) {
    const box = el('div', 'cp-gear');
    const head = el('div', 'cp-row');
    head.appendChild(field(t('cp.slot'), select(
      [{ value: '', label: t('cp.none') }, ...TIERS.map(x => ({ value: x, label: x }))],
      g.tier, v => set(() => { g.tier = v; if (!v) g.options = []; })),
      t('cp.slot_' + g.slot)));
    if (g.tier) {
      head.appendChild(field(t('cp.enhance'),
        select(range(0, 5), g.enhance, v => set(() => { g.enhance = Number(v); }))));
    }
    box.appendChild(head);

    if (g.tier === '오버로드') {
      const opts = el('div', 'cp-opts');
      for (let i = 0; i < 3; i++) {
        const o = g.options[i] || { name: '', level: 0 };
        const pair = el('div', 'cp-optpair');
        pair.appendChild(select(
          [{ value: '', label: t('cp.noOption') }, ...T.optionNames.map(n => ({ value: n, label: n }))],
          o.name, v => set(() => {
            g.options[i] = { name: v, level: v ? (o.level || 1) : 0 };
          })));
        if (o.name) {
          pair.appendChild(select(T.optionLevels.map(l => ({ value: l, label: 'Lv.' + l })),
            o.level || 1, v => set(() => { g.options[i] = { name: o.name, level: Number(v) }; })));
          const val = T.optionValue.get(`${o.name}|${o.level || 1}`);
          if (val != null) pair.appendChild(el('span', 'cp-optval',
            (Math.round(val * 1e6) / 1e4) + '%'));
        }
        opts.appendChild(pair);
      }
      box.appendChild(opts);
    }
    g5.appendChild(box);
  }
  form.appendChild(g5);

  const reset = el('button', 'btn-reset', t('cp.reset'));
  reset.type = 'button';
  reset.onclick = () => { input = defaults(); save(); paint(root); };
  form.appendChild(reset);

  return form;
}

/* ── 결과 ─────────────────────────────────────────────────── */
function renderResult(root) {
  const out = el('div', 'cp-out');
  const n = resolved();
  const r = n && compute(T, n);
  if (!r) {
    out.appendChild(el('p', 'notice notice-error', t('cp.noBase')));
    return out;
  }

  const head = el('div', 'cp-hero');
  head.appendChild(el('div', 'cp-heroLbl', t('cp.current', r.level)));
  head.appendChild(el('div', 'cp-heroNum', fmt(r.cp)));
  const tags = el('div', 'cp-tags');
  for (const [axis, code] of [['class', n.class], ['weapon_type', n.weapon], ['rarity', n.rarity]]) {
    tags.appendChild(el('span', 'cp-tag', ctx.L(axis, code)));
  }
  if (n.defWeapon !== n.weapon) {
    tags.appendChild(el('span', 'cp-tag cp-tag-warn', t('cp.defOverride', n.defWeapon)));
  }
  head.appendChild(tags);

  // 보정 전투력 — 레벨 40 / 400 두 가지만
  const adj = el('div', 'cp-adj');
  adj.appendChild(el('div', 'cp-adjLbl', t('cp.adjusted')));
  const adjRow = el('div', 'cp-adjRow');
  for (const lv of ADJ_LEVELS) {
    const a = compute(T, n, lv);
    const c = el('div', 'cp-adjItem');
    c.appendChild(el('span', 'cp-adjLv', t('cp.lv', lv)));
    c.appendChild(el('span', 'cp-adjNum', fmt(a ? a.cp : null)));
    adjRow.appendChild(c);
  }
  adj.appendChild(adjRow);
  head.appendChild(adj);
  out.appendChild(head);

  // 스탯 3종
  const stats = el('div', 'cp-stats');
  for (const [k, lab] of [['hp', 'HP'], ['atk', t('cp.atk')], ['def', t('cp.def')]]) {
    const c = el('div', 'cp-stat');
    c.appendChild(el('span', 'cp-statLbl', lab));
    c.appendChild(el('span', 'cp-statNum', fmt(r.stats[k])));
    stats.appendChild(c);
  }
  out.appendChild(stats);

  // 분해
  const br = el('div', 'card cp-card-break');
  br.appendChild(el('h3', null, t('cp.breakdown')));
  const tb = el('table', 'grid cp-break');
  const body = el('tbody');
  const rows = [
    [t('cp.b1'), fmt(r.parts.hp)],
    [t('cp.b2'), fmt(r.parts.atk)],
    [t('cp.b3'), fmt(r.parts.def)],
    [t('cp.b4'), r.c4.toFixed(4)],
    [t('cp.b5'), r.c5.toFixed(4)],
    [t('cp.b6'), fmt(r.cp)],
  ];
  rows.forEach(([k, v], i) => {
    const tr = el('tr', i === rows.length - 1 ? 'cp-total' : null);
    tr.appendChild(el('td', null, k));
    tr.appendChild(el('td', 'num', v));
    body.appendChild(tr);
  });
  tb.appendChild(body);
  br.appendChild(scrollBox(tb));
  br.appendChild(el('p', 'cp-note', t('cp.breakHint', r.skillCoef.toFixed(2), r.elemDmg, r.other)));
  out.appendChild(br);

  // 비교
  const cmp = el('div', 'card cp-card-compare');
  const ch = el('div', 'cp-cmphead');
  ch.appendChild(el('h3', null, t('cp.compare')));
  const addBtn = el('button', 'btn-reset', t('cp.addCompare'));
  addBtn.type = 'button';
  addBtn.onclick = () => {
    compare.push({ name: ctx.nameOf(n._nikke), input: JSON.parse(JSON.stringify(input)) });
    paint(root);
  };
  ch.appendChild(addBtn);
  cmp.appendChild(ch);

  if (!compare.length) {
    cmp.appendChild(el('p', 'cp-note', t('cp.compareHint')));
  } else {
    const tbl = el('table', 'grid');
    const h2 = el('thead'), hr = el('tr');
    hr.appendChild(el('th', null, t('cp.nikke')));
    hr.appendChild(el('th', 'num', t('cp.cp')));
    for (const lv of ADJ_LEVELS) hr.appendChild(el('th', 'num', t('cp.lv', lv)));
    hr.appendChild(el('th'));
    h2.appendChild(hr); tbl.appendChild(h2);
    const b2 = el('tbody');
    compare.forEach((entry, i) => {
      const saved = input;
      input = entry.input;
      const en = resolved();
      const cells = en
        ? [compute(T, en), ...ADJ_LEVELS.map(lv => compute(T, en, lv))]
        : [];
      input = saved;
      const tr = el('tr');
      tr.appendChild(el('td', null, entry.name));
      for (const c of cells) tr.appendChild(el('td', 'num', fmt(c ? c.cp : null)));
      const x = el('td');
      const del = el('button', 'cp-x', '×');
      del.type = 'button';
      del.onclick = () => { compare.splice(i, 1); paint(root); };
      x.appendChild(del);
      tr.appendChild(x);
      b2.appendChild(tr);
    });
    tbl.appendChild(b2);
    cmp.appendChild(scrollBox(tbl));
  }
  out.appendChild(cmp);

  return out;
}

function paint(root) {
  root.textContent = '';
  const wrap = el('div', 'cp-wrap');
  wrap.appendChild(renderForm(root));
  wrap.appendChild(renderResult(root));
  root.appendChild(wrap);
}

/* app.js 가 부르는 유일한 진입점 */
export async function renderCalc(root, context) {
  ctx = context;
  if (!T) {
    root.textContent = '';
    root.appendChild(el('p', 'notice', t('cp.loading')));
    try {
      await loadAll();
    } catch (err) {
      root.textContent = '';
      root.appendChild(el('p', 'notice notice-error', String(err.message || err)));
      return;
    }
    input = load();
  }
  paint(root);
}
