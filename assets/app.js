import { renderStats } from './charts.js';

/* ── 데이터 위치 ────────────────────────────────────────────────
   기본은 MechaShifty 레포의 data/ 를 raw 로 읽는다(CORS 허용, 5분 캐시).
   같은 레포에 data/ 를 두고 싶으면 로컬 사본이 자동으로 우선한다.       */
const REMOTE = 'https://raw.githubusercontent.com/RADM90/MechaShifty/main/data/';
const LOCAL = './data/';
const FILES = ['nikkes', 'pickups', 'taxonomy', 'meta'];

/* ── 축 정의 ───────────────────────────────────────────────────
   order 는 표시 순서. element 순서는 dataviz 검증기를 통과한 인접
   순서라서 임의로 바꾸면 인접쌍 대비가 깨진다.                        */
export const AXES = {
  corporation: { label: '기업', order: ['ELYSION', 'MISSILIS', 'TETRA', 'PILGRIM', 'ABNORMAL'] },
  element: { label: '속성', order: ['Fire', 'Water', 'Wind', 'Electronic', 'Iron'] },
  class: { label: '클래스', order: ['Attacker', 'Defender', 'Supporter'] },
  weapon_type: { label: '무기', order: ['AR', 'SMG', 'SG', 'MG', 'SR', 'RL'] },
  burst: { label: '버스트', order: ['Step1', 'Step2', 'Step3', 'AllStep'] },
  rarity: { label: '등급', order: ['SSR', 'SR', 'R'] },
};
const PICKUP_AXES = {
  status: { label: '진행', order: ['ongoing', 'upcoming', 'ended'] },
  availability: { label: '픽업', order: ['standard', 'limited'] },
  tag: { label: '구분', order: ['collab', 'summer', 'christmas', 'new_year', 'anniversary', 'half_anniversary', 'maid', 'bunny', '_none'] },
};
const STATUS_LABEL = {
  ongoing: { ko: '진행중', en: 'Ongoing', ja: '開催中' },
  upcoming: { ko: '예정', en: 'Upcoming', ja: '予定' },
  ended: { ko: '종료', en: 'Ended', ja: '終了' },
  _none: { ko: '일반', en: 'Regular', ja: '通常' },
};
export const ELEMENT_COLOR = {
  Fire: 'var(--el-fire)', Water: 'var(--el-water)', Wind: 'var(--el-wind)',
  Electronic: 'var(--el-electronic)', Iron: 'var(--el-iron)',
};

/* nikkes 에만 있는 축 — 픽업 행에 걸 때는 rid 로 니케를 찾아 판정한다 */
const NIKKE_ONLY = ['weapon_type', 'burst', 'rarity'];

const D = { nikkes: [], pickups: [], taxonomy: {}, meta: {} };
const byRid = new Map();
const pickupsByRid = new Map();

const state = {
  tab: 'nikkes',
  lang: localStorage.getItem('lang') || 'ko',
  q: '',
  squad: '', overspec: false, relFrom: '', relTo: '',
  rerun: 'all', timeline: false,
  sort: { key: 'release_date', dir: -1 },
  sel: Object.fromEntries([...Object.keys(AXES), ...Object.keys(PICKUP_AXES)].map(k => [k, new Set()])),
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/* ── 라벨 ─────────────────────────────────────────────────────
   taxonomy -> 현재 언어 -> en -> 원본 코드 순으로 폴백한다.
   새 스쿼드/태그가 추가돼도 화면이 깨지지 않게 하는 안전장치.        */
export function L(axis, code) {
  if (code == null || code === '') return '—';
  const e = D.taxonomy[axis]?.[code];
  if (!e) return code;
  return e[state.lang] || e.en || code;
}
const nameOf = n => n?.name?.[state.lang] || n?.name?.en || '';
const lang = () => state.lang;

/* ── 로드 ─────────────────────────────────────────────────── */
async function loadFrom(base) {
  const res = await Promise.all(FILES.map(f => fetch(base + f + '.json', { cache: 'no-cache' })));
  const bad = res.find(r => !r.ok);
  if (bad) throw new Error(`${bad.status} ${bad.statusText} — ${bad.url}`);
  const [nikkes, pickups, taxonomy, meta] = await Promise.all(res.map(r => r.json()));
  return { nikkes, pickups, taxonomy, meta };
}

async function load() {
  let data;
  try {
    // 로컬 사본이 있으면 그쪽을 먼저 쓴다(개발 중 / 같은 레포 배치 대응)
    const probe = await fetch(LOCAL + 'meta.json', { cache: 'no-cache' });
    if (!probe.ok) throw 0;
    data = await loadFrom(LOCAL);
  } catch {
    data = await loadFrom(REMOTE);
  }
  Object.assign(D, data);

  D.nikkes.forEach(n => byRid.set(n.rid, n));
  D.pickups.forEach(p => {
    if (!p.rid) return;
    if (!pickupsByRid.has(p.rid)) pickupsByRid.set(p.rid, []);
    pickupsByRid.get(p.rid).push(p);
  });
  D.pickups.forEach(p => {
    p._start = new Date(p.start);
    p._end = new Date(p.end);
  });
}

/* ── 픽업 상태 ─────────────────────────────────────────────── */
function statusOf(p, now = Date.now()) {
  if (p._end.getTime() < now) return 'ended';
  if (p._start.getTime() > now) return 'upcoming';
  return 'ongoing';
}

/* ── 검색 (초성 지원) ──────────────────────────────────────────
   한글 음절은 U+AC00 부터 초성 하나당 588자(중성 21 × 종성 28)씩
   연속으로 배치돼 있다. 그래서 초성 자모 하나는 곧 588자짜리 범위
   하나이고, 쿼리를 문자 단위로 정규식에 옮기면 초성/완성형 혼용이
   자연스럽게 처리된다. 'ㄹㅍ' → /[ㄹ라-맇][ㅍ파-핗]/ → '라피'.       */
const CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const HANGUL_BASE = 0xAC00, PER_CHO = 588;

/* '라피 : 레드 후드' 처럼 구분자가 낀 이름을 '라피레드후드' 로 붙여서
   비교한다 — 사용자가 띄어쓰기/콜론을 그대로 칠 이유가 없다. */
const compact = s => s.replace(/[\s:·・]/g, '');
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const u = n => '\\u' + n.toString(16).padStart(4, '0');

function buildMatcher(raw) {
  const q = compact(raw.trim());
  if (!q) return null;

  const chars = [...q];
  if (!chars.some(c => CHO.includes(c))) {
    const lower = q.toLowerCase();
    return s => compact(s).toLowerCase().includes(lower);
  }

  const pattern = chars.map(ch => {
    const i = CHO.indexOf(ch);
    if (i < 0) return escapeRe(ch);
    const start = HANGUL_BASE + i * PER_CHO;
    // 자모 그 자체 + 그 초성으로 시작하는 완성형 음절 전체
    return `[${ch}${u(start)}-${u(start + PER_CHO - 1)}]`;
  }).join('');

  let re;
  try { re = new RegExp(pattern, 'i'); } catch { return () => true; }
  return s => re.test(compact(s));
}

/* state.q 가 바뀔 때만 다시 만든다 (행마다 정규식을 새로 짜지 않게) */
function matcher() {
  if (state._q !== state.q) {
    state._q = state.q;
    state._match = buildMatcher(state.q);
  }
  return state._match;
}

/* ── 필터 ─────────────────────────────────────────────────────
   except 로 지정한 축은 건너뛴다 — 칩에 붙는 패싯 카운트 계산용.     */
function matchNikke(n, except) {
  for (const axis of Object.keys(AXES)) {
    if (axis === except) continue;
    const sel = state.sel[axis];
    if (sel.size && !sel.has(n[axis])) return false;
  }
  if (state.squad && n.squad !== state.squad) return false;
  if (state.overspec && n.corporation_sub_type !== 'OVERSPEC') return false;
  if (state.relFrom && (!n.release_date || n.release_date < state.relFrom)) return false;
  if (state.relTo && (!n.release_date || n.release_date > state.relTo)) return false;
  const m = matcher();
  if (m && !nikkeText(n).some(m)) return false;
  return true;
}

const nikkeText = n => [n.name.ko, n.name.en, n.name.ja, n.squad].filter(Boolean);

function matchPickup(p, except) {
  const n = p.rid ? byRid.get(p.rid) : null;

  for (const axis of ['corporation', 'element', 'class']) {
    if (axis === except) continue;
    const sel = state.sel[axis];
    if (sel.size && !sel.has(p[axis])) return false;
  }
  // 니케 리스트에만 있는 축: rid 가 없는 예정 배너는 필연적으로 제외된다
  for (const axis of NIKKE_ONLY) {
    if (axis === except) continue;
    const sel = state.sel[axis];
    if (sel.size && (!n || !sel.has(n[axis]))) return false;
  }
  if (state.squad && (!n || n.squad !== state.squad)) return false;
  if (state.overspec && p.corporation_sub_type !== 'OVERSPEC') return false;
  if (state.relFrom && (!n || !n.release_date || n.release_date < state.relFrom)) return false;
  if (state.relTo && (!n || !n.release_date || n.release_date > state.relTo)) return false;

  if (except !== 'status' && state.sel.status.size && !state.sel.status.has(statusOf(p))) return false;
  if (except !== 'availability' && state.sel.availability.size && !state.sel.availability.has(p.availability)) return false;
  if (except !== 'tag' && state.sel.tag.size && !state.sel.tag.has(p.tag ?? '_none')) return false;
  if (state.rerun === 'first' && p.rerun_of != null) return false;
  if (state.rerun === 'rerun' && p.rerun_of == null) return false;

  const m = matcher();
  if (m && ![p.name_ko, ...(n ? nikkeText(n) : [])].some(m)) return false;
  return true;
}

const filteredNikkes = (except) => D.nikkes.filter(n => matchNikke(n, except));
const filteredPickups = (except) => D.pickups.filter(p => matchPickup(p, except));

/* ── URL 해시 동기화 ───────────────────────────────────────── */
function writeHash() {
  const p = new URLSearchParams();
  if (state.tab !== 'nikkes') p.set('tab', state.tab);
  for (const [k, v] of Object.entries(state.sel)) if (v.size) p.set(k, [...v].join(','));
  if (state.q) p.set('q', state.q);
  if (state.squad) p.set('squad', state.squad);
  if (state.overspec) p.set('overspec', '1');
  if (state.relFrom) p.set('from', state.relFrom);
  if (state.relTo) p.set('to', state.relTo);
  if (state.rerun !== 'all') p.set('rerun', state.rerun);
  const s = p.toString();
  history.replaceState(null, '', s ? '#' + s : location.pathname + location.search);
}

function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (p.get('tab')) state.tab = p.get('tab');
  for (const k of Object.keys(state.sel)) {
    const v = p.get(k);
    if (v) state.sel[k] = new Set(v.split(','));
  }
  state.q = p.get('q') || '';
  state.squad = p.get('squad') || '';
  state.overspec = p.get('overspec') === '1';
  state.relFrom = p.get('from') || '';
  state.relTo = p.get('to') || '';
  state.rerun = p.get('rerun') || 'all';
}

/* ── 칩 필터 ───────────────────────────────────────────────── */
function buildChips() {
  const wrap = $('#chipfilters');
  wrap.textContent = '';
  const axes = state.tab === 'pickups'
    ? { ...PICKUP_AXES, ...AXES }
    : AXES;

  for (const [axis, def] of Object.entries(axes)) {
    const row = el('div', 'chiprow');
    row.appendChild(el('span', 'lbl', def.label));
    for (const code of def.order) {
      const b = el('button', 'chip');
      b.type = 'button';
      b.dataset.axis = axis;
      b.dataset.code = code;
      b.setAttribute('aria-pressed', state.sel[axis].has(code));
      if (axis === 'element') {
        const dot = el('span', 'dot');
        dot.style.background = ELEMENT_COLOR[code];
        b.appendChild(dot);
      }
      b.appendChild(el('span', null, chipLabel(axis, code)));
      b.appendChild(el('span', 'n'));
      row.appendChild(b);
    }
    wrap.appendChild(row);
  }
  wrap.onclick = e => {
    const b = e.target.closest('.chip');
    if (!b) return;
    const { axis, code } = b.dataset;
    state.sel[axis].has(code) ? state.sel[axis].delete(code) : state.sel[axis].add(code);
    render();
  };
}

function chipLabel(axis, code) {
  if (axis === 'status' || code === '_none') return STATUS_LABEL[code]?.[lang()] ?? code;
  return L(axis, code);
}

function updateChipCounts() {
  for (const b of $$('#chipfilters .chip')) {
    const { axis, code } = b.dataset;
    let n;
    if (state.tab === 'pickups') {
      const pool = filteredPickups(axis);
      n = axis in PICKUP_AXES
        ? pool.filter(p => (axis === 'status' ? statusOf(p) : (p[axis] ?? '_none')) === code).length
        : (NIKKE_ONLY.includes(axis)
          ? pool.filter(p => byRid.get(p.rid)?.[axis] === code).length
          : pool.filter(p => p[axis] === code).length);
    } else {
      n = filteredNikkes(axis).filter(x => x[axis] === code).length;
    }
    b.querySelector('.n').textContent = n;
    b.setAttribute('aria-pressed', state.sel[axis].has(code));
    b.disabled = n === 0 && !state.sel[axis].has(code);
    b.style.opacity = b.disabled ? .4 : '';
  }
}

/* ── 니케 표 ───────────────────────────────────────────────── */
const NIKKE_COLS = [
  { key: 'name', label: '이름', cls: 'name' },
  { key: 'rarity', label: '등급' },
  { key: 'corporation', label: '기업' },
  { key: 'element', label: '속성' },
  { key: 'class', label: '클래스' },
  { key: 'weapon_type', label: '무기' },
  { key: 'attack_type', label: '공격' },
  { key: 'burst', label: '버스트' },
  { key: 'squad', label: '스쿼드' },
  { key: 'release_date', label: '출시일', cls: 'num' },
  { key: 'pickups', label: '픽업', cls: 'num' },
];

function sortValue(n, key) {
  if (key === 'name') return nameOf(n);
  if (key === 'pickups') return pickupsByRid.get(n.rid)?.length || 0;
  if (key === 'rarity') return ['R', 'SR', 'SSR'].indexOf(n.rarity);
  const order = AXES[key]?.order;
  if (order) return order.indexOf(n[key]);
  return n[key] ?? '';
}

function renderNikkes() {
  const rows = filteredNikkes().sort((a, b) => {
    const x = sortValue(a, state.sort.key), y = sortValue(b, state.sort.key);
    const c = typeof x === 'number' && typeof y === 'number'
      ? x - y : String(x).localeCompare(String(y), 'ko');
    return c * state.sort.dir || String(nameOf(a)).localeCompare(String(nameOf(b)), 'ko');
  });

  const head = $('#nikkeHead');
  head.textContent = '';
  for (const c of NIKKE_COLS) {
    const th = el('th', c.cls === 'num' ? 'num' : null, c.label);
    if (state.sort.key === c.key) th.appendChild(el('span', 'arrow', state.sort.dir > 0 ? ' ▲' : ' ▼'));
    th.onclick = () => {
      state.sort = state.sort.key === c.key
        ? { key: c.key, dir: -state.sort.dir } : { key: c.key, dir: 1 };
      render();
    };
    head.appendChild(th);
  }

  const body = $('#nikkeBody');
  body.textContent = '';
  const frag = document.createDocumentFragment();
  for (const n of rows) {
    const tr = el('tr');
    tr.onclick = () => openSheet(n);

    const tdName = el('td', 'name');
    tdName.appendChild(el('span', null, nameOf(n)));
    if (n.corporation_sub_type) tdName.appendChild(el('span', 'tag ovr', L('corporation_sub_type', n.corporation_sub_type)));
    if (lang() !== 'ko' && n.name.ko) tdName.appendChild(el('div', 'sub', n.name.ko));
    tr.appendChild(tdName);

    tr.appendChild(el('td', null, L('rarity', n.rarity)));
    tr.appendChild(el('td', null, L('corporation', n.corporation)));
    tr.appendChild(elementCell(n.element));
    tr.appendChild(el('td', null, L('class', n.class)));
    tr.appendChild(el('td', null, L('weapon_type', n.weapon_type)));
    tr.appendChild(el('td', null, L('attack_type', n.attack_type)));
    tr.appendChild(el('td', null, L('burst', n.burst)));
    tr.appendChild(el('td', null, L('squad', n.squad)));
    tr.appendChild(el('td', 'num', n.release_date || '—'));
    tr.appendChild(el('td', 'num', String(pickupsByRid.get(n.rid)?.length || 0)));
    frag.appendChild(tr);
  }
  body.appendChild(frag);

  $('#nikkeEmpty').hidden = rows.length > 0;
  $('#count').innerHTML = `<b>${rows.length}</b> / ${D.nikkes.length}명`;
}

function elementCell(code) {
  const td = el('td');
  if (!code) { td.textContent = '—'; return td; }
  const s = el('span', 'badge');
  const dot = el('span', 'dot');
  dot.style.background = ELEMENT_COLOR[code];
  s.appendChild(dot);
  s.appendChild(el('span', null, L('element', code)));
  td.appendChild(s);
  return td;
}

/* ── 픽업 표 / 타임라인 ────────────────────────────────────── */
/* start/end 는 이미 KST 오프셋이 붙은 ISO 문자열이다. Date 로 돌려서
   toISOString 하면 UTC 로 넘어가 하루가 밀리므로 문자열을 그대로 자른다. */
const fmtDate = iso => iso.slice(0, 10);
const fmtRange = p => `${fmtDate(p.start)} ~ ${fmtDate(p.end)}`;
const dday = p => Math.ceil((p._start.getTime() - Date.now()) / 86400000);

function statusTag(p) {
  const s = statusOf(p);
  const t = el('span', 'tag ' + (s === 'ongoing' ? 'on' : s === 'upcoming' ? 'soon' : 'off'),
    s === 'upcoming' ? `${STATUS_LABEL.upcoming[lang()]} D-${dday(p)}` : STATUS_LABEL[s][lang()]);
  return t;
}

const PICKUP_COLS = ['연번', '기간', '상태', '이름', '기업', '속성', '클래스', '픽업', '구분', '복각'];

function renderPickups() {
  const rows = filteredPickups().sort((a, b) => b._start - a._start);

  const head = $('#pickupHead');
  head.textContent = '';
  PICKUP_COLS.forEach((c, i) => head.appendChild(el('th', i === 0 ? 'num' : null, c)));

  const body = $('#pickupBody');
  body.textContent = '';
  const frag = document.createDocumentFragment();
  for (const p of rows) {
    const n = p.rid ? byRid.get(p.rid) : null;
    const tr = el('tr');
    if (n) tr.onclick = () => openSheet(n);
    else tr.style.cursor = 'default';

    tr.appendChild(el('td', 'num', String(p.no)));
    tr.appendChild(el('td', null, fmtRange(p)));
    const tdS = el('td'); tdS.appendChild(statusTag(p)); tr.appendChild(tdS);

    const tdName = el('td', 'name');
    tdName.appendChild(el('span', null, n ? nameOf(n) : p.name_ko));
    if (!n) tdName.appendChild(el('span', 'sub', ' (리스트 미등록)'));
    tr.appendChild(tdName);

    tr.appendChild(el('td', null, L('corporation', p.corporation)));
    tr.appendChild(elementCell(p.element));
    tr.appendChild(el('td', null, L('class', p.class)));

    const tdA = el('td');
    if (p.availability) {
      tdA.appendChild(el('span', 'tag' + (p.availability === 'limited' ? ' lim' : ''),
        L('availability', p.availability)));
    } else tdA.textContent = '—';
    tr.appendChild(tdA);

    tr.appendChild(el('td', null, p.tag ? L('tag', p.tag) : '—'));
    tr.appendChild(el('td', null, p.rerun_of != null ? `#${p.rerun_of} 복각` : '—'));
    frag.appendChild(tr);
  }
  body.appendChild(frag);

  renderTimeline(rows);
  $('#pickupTableWrap').hidden = state.timeline;
  $('#timeline').hidden = !state.timeline;
  $('#pickupEmpty').hidden = rows.length > 0;
  $('#count').innerHTML = `<b>${rows.length}</b> / ${D.pickups.length}개 배너`;
}

function renderTimeline(rows) {
  const tl = $('#timeline');
  tl.textContent = '';
  let year = null;
  for (const p of rows) {
    const y = p._start.getFullYear();
    if (y !== year) { year = y; tl.appendChild(el('div', 'tl-year', `${y}년`)); }

    const n = p.rid ? byRid.get(p.rid) : null;
    const row = el('div', 'tl-row' + (statusOf(p) === 'ongoing' ? ' is-on' : ''));
    if (n) row.onclick = () => openSheet(n);

    row.appendChild(el('div', 'when', `${p.start.slice(5, 10)} ~ ${p.end.slice(5, 10)}`));
    const who = el('div', 'who');
    if (p.element) {
      const dot = el('span', 'dot');
      dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${ELEMENT_COLOR[p.element]}`;
      who.appendChild(dot);
    }
    who.appendChild(el('span', null, n ? nameOf(n) : p.name_ko));
    if (p.availability === 'limited') who.appendChild(el('span', 'tag lim', L('availability', 'limited')));
    if (p.tag) who.appendChild(el('span', 'tag', L('tag', p.tag)));
    if (p.rerun_of != null) who.appendChild(el('span', 'tag', `#${p.rerun_of} 복각`));
    who.appendChild(statusTag(p));
    row.appendChild(who);
    tl.appendChild(row);
  }
}

/* ── 상세 시트 ─────────────────────────────────────────────── */
function openSheet(n) {
  const c = $('#sheetContent');
  c.textContent = '';
  c.appendChild(el('h2', null, nameOf(n)));
  c.appendChild(el('p', 'aka', [n.name.ko, n.name.en, n.name.ja].filter(Boolean).join(' · ')));

  const dl = el('dl', 'kv');
  const put = (k, v) => { dl.appendChild(el('dt', null, k)); dl.appendChild(el('dd', null, v)); };
  put('등급', L('rarity', n.rarity));
  put('기업', L('corporation', n.corporation) + (n.corporation_sub_type ? ` (${L('corporation_sub_type', n.corporation_sub_type)})` : ''));
  put('스쿼드', L('squad', n.squad));
  put('속성', L('element', n.element));
  put('클래스', L('class', n.class));
  put('무기', L('weapon_type', n.weapon_type));
  put('공격타입', L('attack_type', n.attack_type));
  put('버스트', L('burst', n.burst));
  put('출시일', n.release_date || '—');
  put('ID', `${n.rid} · ${n.id} · res ${n.resource_id}`);
  c.appendChild(dl);

  const hist = (pickupsByRid.get(n.rid) || []).slice().sort((a, b) => a._start - b._start);
  c.appendChild(el('h4', null, `픽업 이력 (${hist.length})`));
  if (!hist.length) {
    c.appendChild(el('p', 'sub', '픽업 배너 이력이 없습니다 (런칭 유닛 또는 비가챠).'));
  } else {
    const box = el('div', 'hist');
    for (const p of hist) {
      const it = el('div', 'hist-item');
      const left = el('div');
      left.appendChild(el('span', 'when', fmtRange(p)));
      const right = el('div');
      if (p.rerun_of != null) right.appendChild(el('span', 'tag', `#${p.rerun_of} 복각`));
      if (p.tag) right.appendChild(el('span', 'tag', L('tag', p.tag)));
      right.appendChild(statusTag(p));
      it.append(left, right);
      box.appendChild(it);
    }
    c.appendChild(box);
  }

  $('#sheet').hidden = false;
}
const closeSheet = () => { $('#sheet').hidden = true; };

/* ── 렌더 ─────────────────────────────────────────────────── */
function render() {
  $$('.tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === state.tab));
  $('#panel-nikkes').hidden = state.tab !== 'nikkes';
  $('#panel-pickups').hidden = state.tab !== 'pickups';
  $('#panel-stats').hidden = state.tab !== 'stats';
  $('#pickupfilters').hidden = state.tab !== 'pickups';

  updateChipCounts();

  if (state.tab === 'nikkes') renderNikkes();
  else if (state.tab === 'pickups') renderPickups();
  else {
    const ns = filteredNikkes(), ps = filteredPickups();
    $('#count').innerHTML = `니케 <b>${ns.length}</b> · 배너 <b>${ps.length}</b>`;
    renderStats($('#stats'), ns, ps, { L, lang: lang(), statusOf, AXES, ELEMENT_COLOR, byRid });
  }
  writeHash();
}

/* ── 초기화 ───────────────────────────────────────────────── */
function wire() {
  $$('.tabs button').forEach(b => b.onclick = () => {
    state.tab = b.dataset.tab;
    buildChips();
    render();
  });

  $$('.langswitch button').forEach(b => b.onclick = () => {
    state.lang = b.dataset.lang;
    localStorage.setItem('lang', state.lang);
    $$('.langswitch button').forEach(x => x.classList.toggle('on', x === b));
    document.documentElement.lang = state.lang;
    buildChips();
    render();
  });
  $$('.langswitch button').forEach(b => b.classList.toggle('on', b.dataset.lang === state.lang));
  document.documentElement.lang = state.lang;

  let t;
  $('#q').oninput = e => {
    clearTimeout(t);
    t = setTimeout(() => { state.q = e.target.value.trim(); render(); }, 150);
  };
  $('#q').value = state.q;

  const squads = [...new Set(D.nikkes.map(n => n.squad).filter(Boolean))]
    .sort((a, b) => L('squad', a).localeCompare(L('squad', b), 'ko'));
  const sq = $('#squad');
  squads.forEach(s => {
    const o = el('option', null, L('squad', s));
    o.value = s;
    sq.appendChild(o);
  });
  sq.value = state.squad;
  sq.onchange = () => { state.squad = sq.value; render(); };

  $('#overspec').checked = state.overspec;
  $('#overspec').onchange = e => { state.overspec = e.target.checked; render(); };
  $('#relFrom').value = state.relFrom;
  $('#relFrom').onchange = e => { state.relFrom = e.target.value; render(); };
  $('#relTo').value = state.relTo;
  $('#relTo').onchange = e => { state.relTo = e.target.value; render(); };
  $('#rerun').value = state.rerun;
  $('#rerun').onchange = e => { state.rerun = e.target.value; render(); };
  $('#tlview').onchange = e => { state.timeline = e.target.checked; render(); };

  $('#reset').onclick = () => {
    Object.keys(state.sel).forEach(k => state.sel[k].clear());
    Object.assign(state, { q: '', squad: '', overspec: false, relFrom: '', relTo: '', rerun: 'all' });
    $('#q').value = ''; sq.value = ''; $('#overspec').checked = false;
    $('#relFrom').value = ''; $('#relTo').value = ''; $('#rerun').value = 'all';
    render();
  };

  $$('[data-close]').forEach(n => n.onclick = closeSheet);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
}

(async function main() {
  try {
    readHash();
    await load();
  } catch (err) {
    $('#loading').hidden = true;
    const box = $('#error');
    box.hidden = false;
    box.innerHTML = `<strong>데이터를 불러오지 못했습니다.</strong><br>`
      + `<code>${String(err.message || err)}</code><br><br>`
      + `data/*.json 이 <a href="https://github.com/RADM90/MechaShifty/tree/main/data" target="_blank" rel="noopener">RADM90/MechaShifty</a> 에 올라가 있는지 확인하세요. `
      + `로컬에서 열었다면 <code>file://</code> 이 아니라 <code>python3 -m http.server</code> 로 띄워야 합니다.`;
    return;
  }
  $('#loading').hidden = true;
  $('#app').hidden = false;
  $('#metaline').textContent =
    `데이터 기준일 ${D.meta.updated_at} · 니케 ${D.meta.counts.nikkes}명 · 배너 ${D.meta.counts.pickups}개`;
  wire();
  buildChips();
  render();
})();
