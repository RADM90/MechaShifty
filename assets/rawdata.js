/* 원본 데이터 탭 — 게임 내 각종 참조 테이블 뷰어.
   data/raw/index.json 에 목록이 있고, 실제 표는 고를 때 하나씩 받아온다
   (싱크로 스탯표만 7200행이라 첫 화면에서 통째로 받게 하지 않는다).

   app.js 와의 결합은 renderRaw(root, ctx) 한 곳뿐이다. ctx 로 t/L/lang 을
   받아서 charts.js 와 같은 방식으로 순환 import 를 피한다. */

const PAGE = 200;

let ctx = null;
let index = null;                 // data/raw/index.json
const cache = new Map();          // key -> 데이터셋 payload
let base = './data/raw/';

const state = {
  key: null,
  q: '',
  sort: { col: null, dir: 1 },
  page: 0,
  facets: {},                     // 컬럼 key -> 선택된 값 ('' = 전체)
};

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const t = (k, ...a) => ctx.t(k, ...a);
const label = obj => obj?.[ctx.lang] || obj?.en || obj?.ko || '';

/* ── 값 표시 ──────────────────────────────────────────────────
   원본 값은 건드리지 않고 표시만 다듬는다. 큰 수는 자릿수 구분,
   pct 컬럼은 0.0954 -> 9.54% 로, code:* 는 taxonomy 라벨로.       */
function fmt(v, col) {
  if (v == null || v === '') return '—';
  if (col.type?.startsWith('code:')) return ctx.L(col.type.slice(5), v);
  if (typeof v !== 'number') return String(v);
  if (col.type === 'pct') return (Math.round(v * 1e6) / 1e4) + '%';
  if (Number.isInteger(v)) return v.toLocaleString();
  // 소수는 원본 자릿수를 그대로 두되 부동소수점 꼬리는 자른다
  return String(Math.round(v * 1e6) / 1e6);
}

/* 정렬·검색은 표시값이 아니라 원본 값 기준. 단 code:* 는 화면에 보이는
   라벨로 찾을 수 있어야 해서 검색 대상에 라벨도 같이 넣는다. */
const searchText = (row, cols) => cols.map((c, i) => {
  const v = row[i];
  if (v == null) return '';
  return c.type?.startsWith('code:') ? `${v} ${ctx.L(c.type.slice(5), v)}` : String(v);
}).join(' ').toLowerCase();

/* ── 로드 ─────────────────────────────────────────────────── */
async function fetchJSON(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} — ${url}`);
  return r.json();
}

async function loadIndex() {
  if (index) return index;
  try {
    index = await fetchJSON(base + 'index.json');
  } catch {
    // app.js 와 같은 폴백: 로컬에 없으면 MechaShifty 레포에서 읽는다
    base = 'https://raw.githubusercontent.com/RADM90/MechaShifty/main/data/raw/';
    index = await fetchJSON(base + 'index.json');
  }
  return index;
}

async function loadSet(key) {
  if (cache.has(key)) return cache.get(key);
  const meta = index.datasets.find(d => d.key === key);
  const data = await fetchJSON(base + meta.file);
  cache.set(key, data);
  return data;
}

/* ── 필터링 ──────────────────────────────────────────────────
   패싯은 값 종류가 적은 텍스트/코드 컬럼에만 자동으로 만든다. 레벨처럼
   수천 종인 컬럼에 드롭다운을 달면 쓸모가 없다.                    */
const FACET_MAX = 20;

function facetable(data) {
  return data.columns
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.type === 'text' || c.type?.startsWith('code:'))
    .map(({ c, i }) => {
      const vals = [...new Set(data.rows.map(r => r[i]).filter(v => v != null))];
      return vals.length > 1 && vals.length <= FACET_MAX ? { col: c, idx: i, vals } : null;
    })
    .filter(Boolean);
}

function visibleRows(data) {
  const q = state.q.trim().toLowerCase();
  let rows = data.rows;

  for (const [key, val] of Object.entries(state.facets)) {
    if (!val) continue;
    const i = data.columns.findIndex(c => c.key === key);
    if (i >= 0) rows = rows.filter(r => String(r[i]) === val);
  }
  if (q) rows = rows.filter(r => searchText(r, data.columns).includes(q));

  const { col, dir } = state.sort;
  if (col != null) {
    const i = data.columns.findIndex(c => c.key === col);
    if (i >= 0) {
      rows = rows.slice().sort((a, b) => {
        const x = a[i], y = b[i];
        if (x == null) return 1;
        if (y == null) return -1;
        return (typeof x === 'number' && typeof y === 'number'
          ? x - y : String(x).localeCompare(String(y), ctx.lang)) * dir;
      });
    }
  }
  return rows;
}

/* ── 렌더 ─────────────────────────────────────────────────── */
function renderPicker(root) {
  const nav = el('nav', 'ds-nav');
  for (const g of index.groups) {
    const sets = index.datasets.filter(d => d.group === g.key);
    if (!sets.length) continue;
    nav.appendChild(el('h3', 'ds-group', label(g.title)));
    const list = el('div', 'ds-list');
    for (const d of sets) {
      const b = el('button', 'ds-item');
      b.type = 'button';
      b.dataset.key = d.key;
      b.setAttribute('aria-current', String(d.key === state.key));
      b.appendChild(el('span', 'ds-name', label(d.title)));
      b.appendChild(el('span', 'ds-rows', t('raw.rows', d.rows)));
      b.onclick = () => select(d.key, root);
      list.appendChild(b);
    }
    nav.appendChild(list);
  }
  return nav;
}

function renderControls(data, rows, root) {
  const bar = el('div', 'ds-controls');

  const search = el('input', 'ds-search');
  search.type = 'search';
  search.placeholder = t('raw.search');
  search.value = state.q;
  search.autocomplete = 'off';
  let timer;
  search.oninput = e => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.q = e.target.value; state.page = 0; paint(root); }, 150);
  };
  bar.appendChild(search);

  for (const f of facetable(data)) {
    const wrap = el('label', 'ds-facet');
    wrap.appendChild(el('span', null, label(f.col.label)));
    const sel = el('select');
    const all = el('option', null, t('f.all'));
    all.value = '';
    sel.appendChild(all);
    for (const v of f.vals) {
      const o = el('option', null, f.col.type?.startsWith('code:')
        ? ctx.L(f.col.type.slice(5), v) : String(v));
      o.value = String(v);
      sel.appendChild(o);
    }
    sel.value = state.facets[f.col.key] || '';
    sel.onchange = () => {
      state.facets[f.col.key] = sel.value;
      state.page = 0;
      paint(root);
    };
    wrap.appendChild(sel);
    bar.appendChild(wrap);
  }

  const count = el('span', 'ds-count');
  count.innerHTML = rows.length === data.rows.length
    ? t('raw.count', data.rows.length)
    : t('raw.countFiltered', rows.length, data.rows.length);
  bar.appendChild(count);

  const dl = el('button', 'btn-reset ds-dl', t('raw.csv'));
  dl.type = 'button';
  dl.onclick = () => downloadCSV(data, rows);
  bar.appendChild(dl);

  return bar;
}

function renderTable(data, rows, root) {
  const wrap = el('div', 'tablewrap');
  const table = el('table', 'grid ds-table');

  const thead = el('thead');
  const tr = el('tr');
  for (const c of data.columns) {
    const th = el('th');
    const b = el('button', 'ds-sort');
    b.type = 'button';
    b.textContent = label(c.label);
    const on = state.sort.col === c.key;
    if (on) b.appendChild(el('span', 'ds-arrow', state.sort.dir > 0 ? ' ▲' : ' ▼'));
    th.setAttribute('aria-sort', on ? (state.sort.dir > 0 ? 'ascending' : 'descending') : 'none');
    if (c.type !== 'text' && !c.type?.startsWith('code:')) th.className = 'num';
    b.onclick = () => {
      state.sort = on ? { col: c.key, dir: -state.sort.dir } : { col: c.key, dir: 1 };
      state.page = 0;
      paint(root);
    };
    th.appendChild(b);
    tr.appendChild(th);
  }
  thead.appendChild(tr);
  table.appendChild(thead);

  const tbody = el('tbody');
  for (const r of rows.slice(state.page * PAGE, (state.page + 1) * PAGE)) {
    const row = el('tr');
    data.columns.forEach((c, i) => {
      const td = el('td', c.type !== 'text' && !c.type?.startsWith('code:') ? 'num' : null,
        fmt(r[i], c));
      row.appendChild(td);
    });
    tbody.appendChild(row);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function renderPager(rows, root) {
  const pages = Math.ceil(rows.length / PAGE);
  if (pages <= 1) return null;
  const nav = el('div', 'ds-pager');
  const mk = (text, page, disabled) => {
    const b = el('button', null, text);
    b.type = 'button';
    b.disabled = disabled;
    b.onclick = () => { state.page = page; paint(root); root.scrollIntoView({ block: 'start' }); };
    return b;
  };
  nav.appendChild(mk('‹', state.page - 1, state.page === 0));
  nav.appendChild(el('span', 'ds-pageno', t('raw.page', state.page + 1, pages)));
  nav.appendChild(mk('›', state.page + 1, state.page >= pages - 1));
  return nav;
}

function downloadCSV(data, rows) {
  const esc = v => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = [data.columns.map(c => esc(label(c.label))).join(',')]
    .concat(rows.map(r => r.map(esc).join(',')))
    .join('\n');
  // 엑셀이 UTF-8 로 열도록 BOM 을 붙인다 (한글 컬럼명이 깨지지 않게)
  const blob = new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' });
  const a = el('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${state.key}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* 현재 상태를 화면에 반영한다. 데이터는 이미 받아둔 것만 쓴다. */
function paint(root) {
  const data = cache.get(state.key);
  const main = root.querySelector('.ds-main');
  main.textContent = '';
  if (!data) {
    main.appendChild(el('p', 'notice', t('raw.loading')));
    return;
  }

  const head = el('header', 'ds-head');
  head.appendChild(el('h2', null, label(data.title)));
  head.appendChild(el('p', 'ds-note', label(data.note)));
  main.appendChild(head);

  const rows = visibleRows(data);
  main.appendChild(renderControls(data, rows, root));
  if (!rows.length) {
    main.appendChild(el('p', 'empty', t('raw.empty')));
    return;
  }
  main.appendChild(renderTable(data, rows, root));
  const pager = renderPager(rows, root);
  if (pager) main.appendChild(pager);
}

function markCurrent(root) {
  root.querySelectorAll('.ds-item').forEach(b => {
    b.setAttribute('aria-current', String(b.dataset.key === state.key));
  });
}

async function select(key, root) {
  state.key = key;
  state.q = '';
  state.page = 0;
  state.sort = { col: null, dir: 1 };
  state.facets = {};
  markCurrent(root);
  paint(root);                       // 아직 안 받았으면 로딩 문구가 먼저 뜬다
  await loadSet(key);
  if (state.key !== key) return;     // 그 사이 다른 표로 옮겨갔으면 덮어쓰지 않는다
  paint(root);
  // 좁은 화면에서는 목록이 표 위에 쌓여서, 고르고 나면 표가 화면 밖에 있다
  if (window.matchMedia('(max-width: 900px)').matches) {
    root.querySelector('.ds-main')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
}

function build(root) {
  root.textContent = '';
  root.appendChild(renderPicker(root));
  root.appendChild(el('div', 'ds-main'));
  paint(root);
}

/* app.js 가 부르는 유일한 진입점. 탭을 열 때마다 호출되고,
   언어/테마가 바뀌어도 같은 경로로 다시 그린다. */
export async function renderRaw(root, context) {
  ctx = context;
  if (!index) {
    root.textContent = '';
    root.appendChild(el('p', 'notice', t('raw.loading')));
    try {
      await loadIndex();
    } catch (err) {
      root.textContent = '';
      root.appendChild(el('p', 'notice notice-error', String(err.message || err)));
      return;
    }
    state.key ||= index.datasets[0].key;
    await loadSet(state.key);
  }
  build(root);
}
