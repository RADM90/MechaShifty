/* 특특요 탭 — 이상 개체 요격전(특특요)의 하루치 획득 확률 분포.

   워크북의 `특특요_확률분포` / `3.5주년 이전 특특요` 시트에는 이미 계산된
   분포표가 들어 있지만, 여기서는 그 표를 옮겨 담지 않고 **수급량 표 두 개**
   (`module_settings` = 3.5주년 이후, `module_settings_pre35` = 이전)만 읽어서
   분포를 그때그때 계산한다. 두 시트의 값과 소수점 9자리까지 일치하는 것을
   확인했다 — 시트 쪽 숫자가 반올림돼 있을 뿐 모형은 같다.

   모형 (시트의 §2·§3·§7 과 동일):
     · 하루 진입 3회, 풀버스트면 진입당 2게임이라 G = 3 또는 6.
     · 모듈 모드(크라켄) — 게임마다 모듈 랜덤박스가 P_box 로 뜨고, 뜨면
       1/2/3개가 p₁/p₂/p₃ 로 나온다. 하루 분포는 이 단일 게임 분포를
       G번 합성곱(convolution)한 것. 근사가 아니라 정확한 값이다.
     · 장비 모드(크라켄 제외 보스) — 게임마다 장비 랜덤박스가 P_eq 로 뜨는
       이항분포 B(G, P_eq).
     · 모듈피스는 확률이 아니라 확정 획득이라 분포에 들어가지 않는다.
       100개마다 모듈 1개가 되는 몫만 분포를 통째로 오른쪽으로 민다.

   이 탭의 목적은 값 자체보다 **3.5주년 전후 비교**라서, 모든 표가 두 시대를
   나란히 놓고 차이(Δ)를 같이 보여준다.

   app.js 와의 결합은 renderIntercept(root, ctx) 한 곳뿐. */

const STORE = 'intercept.input';
const NEED = ['module_settings_pre35', 'module_settings'];

/* 하루 진입 횟수. 풀버스트를 띄우면 진입당 게임이 2회가 된다. */
const ENTRIES = 3;
/* 모듈피스 100개 = 완성 모듈 1개. */
const PIECES_PER_MODULE = 100;
/* 장비 랜덤박스에서 나올 수 있는 종류 = 4부위 × 5기업, 전부 같은 확률. */
const EQUIP_KINDS = 20;

let ctx = null, D = null, base = './data/';
let S = null;

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const t = (k, ...a) => ctx.t(k, ...a);

/* ── 숫자 표기 ────────────────────────────────────────────────
   확률은 0.0000001% 부터 44% 까지 폭이 넓다. 소수 셋째 자리에서 끊되
   0 이 아닌데 0.000 으로 보이는 칸은 '<0.001' 로 구분한다.            */
const dec = (v, d = 3) => v.toLocaleString(undefined,
  { minimumFractionDigits: d, maximumFractionDigits: d });
/* 이미 퍼센트 단위로 들어온 값을 표기용 문자열로. */
const pct = v => (v === 0 ? '0' : v < 0.0005 ? '<0.001' : dec(v));
const signed = (v, d = 3) => (v > 0 ? '+' : v < 0 ? '−' : '±') + dec(Math.abs(v), d);

function scrollBox(table) {
  const d = el('div', 'op-scroll');
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
  const probe = async b => { await fetchJSON(b + 'raw/module_settings.json'); return b; };
  try { base = await probe('./data/'); }
  catch { base = await probe('https://raw.githubusercontent.com/RADM90/MechaShifty/main/data/'); }

  const [pre, post] = await Promise.all(NEED.map(k => fetchJSON(`${base}raw/${k}.json`)));
  D = build(pre, post);
}

/* 수급량 표(단계 9행)를 계산하기 좋은 꼴로 편다. 퍼센트는 여기서 한 번만
   소수로 바꾸고, 표시용 원본 퍼센트도 같이 들고 있는다. */
function build(pre, post) {
  const ci = Object.fromEntries(post.columns.map((c, i) => [c.key, i]));
  const era = src => src.rows.map(r => ({
    step: r[ci.step],
    pieces: r[ci.pieces],
    box: r[ci.box_rate] / 100,
    p: [r[ci.p1] / 100, r[ci.p2] / 100, r[ci.p3] / 100],
    eq: r[ci.equip_rate] / 100,
    raw: r,
  }));
  return { pre: era(pre), post: era(post), columns: post.columns, ci };
}

/* ── 확률 엔진 ────────────────────────────────────────────── */
const convolve = (a, b) => {
  const out = new Array(a.length + b.length - 1).fill(0);
  a.forEach((x, i) => { if (x) b.forEach((y, j) => { out[i + j] += x * y; }); });
  return out;
};

/* 단일 게임 분포를 G번 합성곱. G 가 3·6 뿐이라 그냥 접는다. */
function fold(single, games) {
  let d = [1];
  for (let i = 0; i < games; i++) d = convolve(d, single);
  return d;
}

/* 모듈 랜덤박스: 안 뜸 / 1개 / 2개 / 3개 */
const boxSingle = row => [1 - row.box, row.box * row.p[0], row.box * row.p[1], row.box * row.p[2]];
/* 장비 랜덤박스: 안 뜸 / 뜸 — G번 접으면 곧 B(G, P_eq) */
const equipSingle = row => [1 - row.eq, row.eq];

function moments(pmf) {
  let m = 0, m2 = 0;
  pmf.forEach((p, k) => { m += k * p; m2 += k * k * p; });
  return { mean: m, sd: Math.sqrt(Math.max(0, m2 - m * m)) };
}

const games = () => ENTRIES * (S.fb ? 2 : 1);

/* 한 시대·한 단계의 하루 분포. shift=true 면 모듈피스로 확정되는 몫만큼
   분포를 오른쪽으로 밀어 '하루에 완성되는 모듈 총 개수' 분포로 만든다. */
function derive(eraKey, step) {
  const row = D[eraKey][step - 1];
  const G = games();
  const mod = S.mode === 'module';
  let pmf = fold(mod ? boxSingle(row) : equipSingle(row), G);

  const total = row.pieces * G;
  const done = Math.floor(total / PIECES_PER_MODULE);
  const left = total % PIECES_PER_MODULE;

  const box = moments(pmf);
  if (mod && S.pieces) pmf = new Array(done).fill(0).concat(pmf);
  const m = moments(pmf);

  return {
    row, pmf, ...m, box,
    pieces: { perGame: row.pieces, total, done, left },
    each: m.mean / EQUIP_KINDS,     // 장비 모드: 노리는 1종의 기대 개수
  };
}

/* P(X ≥ k) */
function tail(pmf) {
  const out = new Array(pmf.length).fill(0);
  let acc = 0;
  for (let k = pmf.length - 1; k >= 0; k--) { acc += pmf[k]; out[k] = acc; }
  return out;
}
const series = d => (S.view === 'cum' ? tail(d.pmf) : d.pmf);

/* ── 상태 ─────────────────────────────────────────────────── */
const defaults = () => ({
  mode: 'module',      // module = 크라켄(모듈) / equip = 그 외 보스(기업장비)
  fb: false,           // 풀버스트 여부
  step: 9,
  view: 'pmf',         // pmf = P(X=k) / cum = P(X≥k)
  pieces: false,       // 모듈피스 확정분을 분포에 더할지
});

function load() {
  try {
    const v = JSON.parse(localStorage.getItem(STORE));
    if (v && typeof v === 'object') {
      const d = defaults();
      return {
        mode: v.mode === 'equip' ? 'equip' : 'module',
        fb: !!v.fb,
        step: Math.min(9, Math.max(1, Number(v.step) || d.step)),
        view: v.view === 'cum' ? 'cum' : 'pmf',
        pieces: !!v.pieces,
      };
    }
  } catch { /* 저장값이 깨졌으면 기본값 */ }
  return defaults();
}
const save = () => localStorage.setItem(STORE, JSON.stringify(S));

/* ── 폼 ───────────────────────────────────────────────────── */
function seg(options, value, onPick) {
  const box = el('div', 'ic-seg');
  for (const o of options) {
    const b = el('button', 'ic-segbtn' + (o.value === value ? ' on' : ''), o.label);
    b.type = 'button';
    if (o.title) b.title = o.title;
    b.setAttribute('aria-pressed', String(o.value === value));
    b.onclick = () => onPick(o.value);
    box.appendChild(b);
  }
  return box;
}

function group(title, ...kids) {
  const g = el('div', 'op-group');
  g.appendChild(el('h3', null, title));
  for (const k of kids) if (k) g.appendChild(k);
  return g;
}

function subfield(label, control) {
  const w = el('div', 'ic-field');
  w.appendChild(el('span', 'op-lbl', label));
  w.appendChild(control);
  return w;
}

function renderForm(root) {
  const set = patch => { Object.assign(S, patch); save(); paint(root); };
  const form = el('div', 'op-form');

  const cond = group(t('ic.conditions'));
  cond.appendChild(subfield(t('ic.mode'), seg([
    { value: 'module', label: t('ic.modeModule'), title: t('ic.modeModuleFull') },
    { value: 'equip', label: t('ic.modeEquip'), title: t('ic.modeEquipFull') },
  ], S.mode, v => set({ mode: v }))));
  cond.appendChild(subfield(t('ic.burst'), seg([
    { value: false, label: t('ic.burstOff') },
    { value: true, label: t('ic.burstOn') },
  ], S.fb, v => set({ fb: v }))));
  cond.appendChild(subfield(t('ic.step'), seg(
    D.post.map(r => ({ value: r.step, label: String(r.step) })),
    S.step, v => set({ step: v }))));
  cond.appendChild(el('p', 'op-note', t('ic.gamesNote', ENTRIES, games())));
  form.appendChild(cond);

  const view = group(t('ic.view'));
  view.appendChild(subfield(t('ic.axis'), seg([
    { value: 'pmf', label: t('ic.axisPmf') },
    { value: 'cum', label: t('ic.axisCum') },
  ], S.view, v => set({ view: v }))));
  if (S.mode === 'module') {
    const lbl = el('label', 'check ic-check');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = S.pieces;
    cb.onchange = () => set({ pieces: cb.checked });
    lbl.append(cb, el('span', null, t('ic.withPieces')));
    view.appendChild(lbl);
    view.appendChild(el('p', 'op-note', t('ic.withPiecesHint')));
  }
  form.appendChild(view);

  form.appendChild(group(t('ic.about'),
    el('p', 'op-note', t('ic.aboutModel')),
    el('p', 'op-note', t('ic.aboutSource'))));

  return form;
}

/* ── 비교 요약 ────────────────────────────────────────────── */
/* neutral=true 는 '늘어난 게 좋은 것'이 아닌 값(표준편차)용 — 부호만 남기고
   좋음/나쁨 색은 쓰지 않는다. */
function cmpCard(label, before, after, digits, neutral) {
  const c = el('div', 'ic-cmp');
  c.appendChild(el('div', 'ic-cmpLbl', label));

  c.appendChild(el('div', 'ic-cmpNum', dec(after, digits)));

  const max = Math.max(before, after, 1e-9);
  const bars = el('div', 'ic-cmpBars');
  for (const [cls, v] of [['pre', before], ['post', after]]) {
    const track = el('div', 'ic-cmpTrack');
    const fill = el('div', 'ic-cmpFill ic-' + cls);
    fill.style.width = (v / max * 100) + '%';
    track.appendChild(fill);
    bars.appendChild(track);
  }
  c.appendChild(bars);

  const d = after - before;
  const tone = neutral ? 'ic-flat' : d > 1e-12 ? 'ic-up' : d < -1e-12 ? 'ic-dn' : 'ic-flat';
  const foot = el('div', 'ic-cmpFoot');
  foot.appendChild(el('span', 'ic-cmpPre', t('ic.wasValue', dec(before, digits))));
  foot.appendChild(el('span', 'ic-delta ' + tone,
    signed(d, digits) + (before > 0 ? ` (${signed((after / before - 1) * 100, 1)}%)` : '')));
  c.appendChild(foot);
  return c;
}

function renderSummary(a, b) {
  const card = el('div', 'card');
  card.appendChild(el('h3', null, t('ic.summary')));
  card.appendChild(el('p', 'op-note', t(
    S.mode === 'module' ? 'ic.summaryModule' : 'ic.summaryEquip', S.step, games())));

  const grid = el('div', 'ic-cmpgrid');
  grid.appendChild(cmpCard(t('ic.mean'), a.mean, b.mean, 3));
  grid.appendChild(cmpCard(t('ic.sd'), a.sd, b.sd, 3, true));
  if (S.mode === 'module') {
    grid.appendChild(cmpCard(t('ic.piecesTotal'), a.pieces.total, b.pieces.total, 0));
    /* 피스 확정분을 이미 분포에 넣었으면 기대값 카드와 같은 값이라 빼둔다 */
    if (!S.pieces) {
      grid.appendChild(cmpCard(t('ic.totalModules'),
        a.box.mean + a.pieces.done, b.box.mean + b.pieces.done, 3));
    }
  } else {
    grid.appendChild(cmpCard(t('ic.eachKind'), a.each, b.each, 4));
    grid.appendChild(cmpCard(t('ic.perMonth'), a.mean * 30, b.mean * 30, 1));
  }
  card.appendChild(grid);

  if (S.mode === 'module') {
    card.appendChild(el('p', 'op-note', t('ic.piecesNote',
      a.pieces.done, a.pieces.left, b.pieces.done, b.pieces.left, PIECES_PER_MODULE)));
  } else {
    card.appendChild(el('p', 'op-note', t('ic.eachNote', EQUIP_KINDS)));
  }
  return card;
}

/* ── 수급량 파라미터 비교 ─────────────────────────────────── */
/* [컬럼 key, 라벨 키, 소수 자릿수, 모듈 모드에만 해당하는지] */
const PARAMS = [
  ['pieces', 'ic.pPieces', 0, true],
  ['box_rate', 'ic.pBox', 2, true],
  ['p1', 'ic.pP1', 4, true],
  ['p2', 'ic.pP2', 4, true],
  ['p3', 'ic.pP3', 4, true],
  ['equip_rate', 'ic.pEquip', 2, false],
];

function renderParams(a, b) {
  const card = el('div', 'card');
  card.appendChild(el('h3', null, t('ic.params', S.step)));
  card.appendChild(el('p', 'op-note', t('ic.paramsHint')));

  const tbl = el('table', 'grid');
  const thead = el('thead'), hr = el('tr');
  hr.appendChild(el('th', null, t('ic.item')));
  hr.appendChild(el('th', 'num', t('ic.pre')));
  hr.appendChild(el('th', 'num', t('ic.post')));
  hr.appendChild(el('th', 'num', t('ic.delta')));
  thead.appendChild(hr); tbl.appendChild(thead);

  const body = el('tbody');
  for (const [key, lab, digits, isMod] of PARAMS) {
    const i = D.ci[key];
    const before = a.row.raw[i], after = b.row.raw[i];
    /* 지금 보고 있는 모드에 안 쓰이는 값은 흐리게 — 표에서 빼지는 않는다.
       (모듈 모드에서도 장비박스 출현율이 같이 올랐다는 게 정보다) */
    const tr = el('tr', (S.mode === 'module') === isMod ? null : 'ic-off');
    tr.appendChild(el('td', null, t(lab)));
    tr.appendChild(el('td', 'num', dec(before, digits)));
    tr.appendChild(el('td', 'num ic-em', dec(after, digits)));
    const d = after - before;
    tr.appendChild(el('td', 'num ' + (d > 0 ? 'ic-up' : d < 0 ? 'ic-dn' : 'ic-flat'),
      signed(d, digits)));
    body.appendChild(tr);
  }
  tbl.appendChild(body);
  card.appendChild(scrollBox(tbl));
  card.appendChild(el('p', 'op-note', t('ic.paramsFoot')));
  return card;
}

/* ── 분포 비교 ────────────────────────────────────────────── */
function legend() {
  const box = el('div', 'ic-legend');
  for (const [cls, key] of [['pre', 'ic.pre'], ['post', 'ic.post']]) {
    const item = el('span', 'ic-legItem');
    item.appendChild(el('span', 'ic-swatch ic-' + cls));
    item.appendChild(el('span', null, t(key)));
    box.appendChild(item);
  }
  return box;
}

function barCell(before, after, max) {
  const td = el('td', 'ic-barcell');
  const box = el('div', 'ic-bars');
  for (const [cls, v] of [['pre', before], ['post', after]]) {
    const track = el('div', 'ic-track');
    const fill = el('div', 'ic-fill ic-' + cls);
    fill.style.width = (max > 0 ? v / max * 100 : 0) + '%';
    track.appendChild(fill);
    box.appendChild(track);
  }
  td.appendChild(box);
  return td;
}

function renderDist(a, b) {
  const card = el('div', 'card');
  const head = el('div', 'op-cardhead');
  head.appendChild(el('h3', null, t(S.view === 'cum' ? 'ic.distCum' : 'ic.distPmf')));
  head.appendChild(legend());
  card.appendChild(head);
  card.appendChild(el('p', 'op-note', t(S.view === 'cum' ? 'ic.distCumHint' : 'ic.distPmfHint',
    t(S.mode === 'module' ? 'ic.unitModule' : 'ic.unitEquip'))));

  const A = series(a), B = series(b);
  const n = Math.max(A.length, B.length);
  const at = (arr, k) => (k < arr.length ? arr[k] * 100 : 0);
  let max = 0;
  for (let k = 0; k < n; k++) max = Math.max(max, at(A, k), at(B, k));

  const tbl = el('table', 'grid ic-dist');
  const thead = el('thead'), hr = el('tr');
  hr.appendChild(el('th', 'num', t(S.view === 'cum' ? 'ic.kAtLeast' : 'ic.k')));
  hr.appendChild(el('th', null, t('ic.shape')));
  hr.appendChild(el('th', 'num', t('ic.pre')));
  hr.appendChild(el('th', 'num', t('ic.post')));
  hr.appendChild(el('th', 'num', t('ic.deltaPp')));
  thead.appendChild(hr); tbl.appendChild(thead);

  const body = el('tbody');
  /* 꼬리 쪽은 양쪽 다 0 인 칸이 이어진다. 시트와 같은 범위를 보여주되
     완전히 0 인 줄만 잘라낸다. */
  let last = 0;
  for (let k = 0; k < n; k++) if (at(A, k) > 0 || at(B, k) > 0) last = k;

  for (let k = 0; k <= last; k++) {
    const before = at(A, k), after = at(B, k), d = after - before;
    const tr = el('tr');
    tr.appendChild(el('td', 'num ic-em', String(k)));
    tr.appendChild(barCell(before, after, max));
    tr.appendChild(el('td', 'num', pct(before)));
    tr.appendChild(el('td', 'num ic-em', pct(after)));
    /* 여기서는 초록/빨강을 쓰지 않는다 — k=0 의 확률이 줄어든 것은 상향인데
       빨강으로 칠하면 정반대로 읽힌다. 대신 '어느 쪽이 큰가'를 범례와 같은
       계열색으로 말한다. */
    tr.appendChild(el('td', 'num ' + (d > 1e-9 ? 'ic-more' : d < -1e-9 ? 'ic-less' : 'ic-flat'),
      Math.abs(d) < 0.0005 ? '±0' : signed(d)));
    body.appendChild(tr);
  }
  tbl.appendChild(body);
  card.appendChild(scrollBox(tbl));
  return card;
}

/* ── 단계별 기대값 ────────────────────────────────────────── */
function renderSteps(root) {
  const card = el('div', 'card');
  const head = el('div', 'op-cardhead');
  head.appendChild(el('h3', null, t('ic.bySteps')));
  head.appendChild(legend());
  card.appendChild(head);
  card.appendChild(el('p', 'op-note', t('ic.byStepsHint')));

  const rows = D.post.map((r, i) => {
    const a = derive('pre', r.step), b = derive('post', r.step);
    return { step: r.step, a, b, i };
  });
  const max = Math.max(...rows.map(r => Math.max(r.a.mean, r.b.mean)));

  const tbl = el('table', 'grid');
  const thead = el('thead'), hr = el('tr');
  hr.appendChild(el('th', 'num', t('ic.step')));
  hr.appendChild(el('th', null, t('ic.shape')));
  hr.appendChild(el('th', 'num', t('ic.pre')));
  hr.appendChild(el('th', 'num', t('ic.post')));
  hr.appendChild(el('th', 'num', t('ic.delta')));
  hr.appendChild(el('th', 'num', t('ic.ratio')));
  thead.appendChild(hr); tbl.appendChild(thead);

  const body = el('tbody');
  for (const r of rows) {
    const before = r.a.mean, after = r.b.mean, d = after - before;
    const tr = el('tr', r.step === S.step ? 'ic-cur' : null);
    const td = el('td', 'num ic-em ic-steplink', String(r.step));
    td.onclick = () => { S.step = r.step; save(); paint(root); };
    tr.appendChild(td);
    tr.appendChild(barCell(before, after, max));
    tr.appendChild(el('td', 'num', dec(before)));
    tr.appendChild(el('td', 'num ic-em', dec(after)));
    tr.appendChild(el('td', 'num ' + (d > 1e-9 ? 'ic-up' : d < -1e-9 ? 'ic-dn' : 'ic-flat'),
      signed(d)));
    tr.appendChild(el('td', 'num', before > 0 ? '×' + dec(after / before, 2) : '—'));
    body.appendChild(tr);
  }
  tbl.appendChild(body);
  card.appendChild(scrollBox(tbl));
  return card;
}

/* ── 조립 ─────────────────────────────────────────────────── */
function paint(root) {
  root.textContent = '';
  const a = derive('pre', S.step), b = derive('post', S.step);

  const wrap = el('div', 'op-wrap');
  wrap.appendChild(renderForm(root));

  const out = el('div', 'op-out');
  out.appendChild(renderSummary(a, b));
  out.appendChild(renderParams(a, b));
  out.appendChild(renderDist(a, b));
  out.appendChild(renderSteps(root));
  wrap.appendChild(out);

  root.appendChild(wrap);
}

/* app.js 가 부르는 유일한 진입점 */
export async function renderIntercept(root, context) {
  ctx = context;
  if (!D) {
    root.textContent = '';
    root.appendChild(el('p', 'notice', t('ic.loading')));
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
