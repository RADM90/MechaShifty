/* 전초기지 탭 — 캠페인 클리어 진행도 → 전초기지 레벨 → 재화 수급량.

   레벨 산식은 워크북 `재화_계산기` 시트를 바탕으로 하되, 시트에 없는
   선지급 1스테이지(BONUS_STAGES)를 실측으로 더했다. 실계정 덤프
   (`basic_info.progress_*_campaign`, `outpost_info.outpost_battle_level`)와
   레벨 내 진행도로 맞춰봤다. 아래 LEVEL_STEP / SKIP_REGIONS / BONUS_STAGES 주석 참조.

   전술 아카데미는 항상 최대 레슨(마지막 행) 기준이라 입력이 없다.

   진행도는 손으로 고를 수도 있지만, 계산기 탭이 불러다 둔 계정 자료
   (localStorage `cp.roster`)가 있으면 거기서 끌어온다 — 같은 값을 두 번 고르게
   할 이유가 없다. 계정 생성 시각은 기업 타워 카드가 쓴다 (renderTower).

   app.js 와의 결합은 renderOutpost(root, ctx) 한 곳뿐. 프로필 응답을 직접 밀어
   넣는 setProgress() 도 내보내지만, 평소 경로는 위의 끌어오기다. */

const STORE = 'outpost.input';

/* 스테이지 5개당 전초기지 레벨 1. 레벨은 1부터 시작한다. */
const LEVEL_STEP = 5;
/* 노멀 지역0~2(총 19스테이지)는 레벨에 반영되지 않는다. 하드는 전부 반영된다.
   시트의 `- sum(Stage_Data!$A$2:$C$2)` 를 지역 개수로 일반화한 것. */
const SKIP_REGIONS = 3;
/* 지역3 이 열릴 때 1스테이지분이 미리 붙는다. 워크북에는 없는 항이라 실측으로
   확인했다: 노멀 46-40(보스)·하드 46-39 클리어 = 클리어 3,378스테이지인 계정이
   게임에서 676레벨 4/5 로 뜬다. 이 항이 없으면 3/5 가 되어 한 칸 어긋난다.
   (앞서 맞춰본 606레벨 덤프는 3,026 → 나머지 1 이라 두 산식이 같은 값이었다.) */
const BONUS_STAGES = 1;
/* '다음 코어더스트 구간' 카드에 보여줄 정수 구간 개수. */
const NEXT_TARGETS = 5;

let ctx = null, D = null, base = './data/';
let input = null;
let mounted = null;               // 마운트된 root — setProgress 가 다시 그릴 때 쓴다

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const t = (k, ...a) => ctx.t(k, ...a);

const int = v => v == null ? '—' : Math.round(v).toLocaleString();
const dec = (v, d = 2) => v == null ? '—' : v.toLocaleString(undefined,
  { minimumFractionDigits: d, maximumFractionDigits: d });

function scrollBox(table) {
  const d = el('div', 'op-scroll');
  d.appendChild(table);
  return d;
}

/* ── 로드 ─────────────────────────────────────────────────── */
const NEED = ['outpost_income', 'stage_list', 'tactics_academy'];

async function fetchJSON(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} — ${url}`);
  return r.json();
}

async function loadAll() {
  const probe = async b => { await fetchJSON(b + 'raw/stage_list.json'); return b; };
  try { base = await probe('./data/'); }
  catch { base = await probe('https://raw.githubusercontent.com/RADM90/MechaShifty/main/data/'); }

  const [income, stages, academy] =
    await Promise.all(NEED.map(k => fetchJSON(`${base}raw/${k}.json`)));

  D = build(income, stages, academy);
}

/* 원본 표 3개를 조회하기 쉬운 꼴로 편다. */
function build(income, stages, academy) {
  const ci = Object.fromEntries(income.columns.map((c, i) => [c.key, i]));

  // 레벨 → 수급량
  const levels = new Map();
  for (const r of income.rows) {
    levels.set(r[ci.level], {
      level: r[ci.level],
      cred: { min: r[ci.cred_min], hr: r[ci.cred_hr] },
      batt: { min: r[ci.batt_min], hr: r[ci.batt_hr] },
      comm: { min: r[ci.comm_min], hr: r[ci.comm_hr] },
      core: { min: r[ci.core_min], hr: r[ci.core_hr] },
      dustAcademy: r[ci.dust_academy],
    });
  }
  const maxLevel = Math.max(...levels.keys());

  // 스테이지를 지역 순서대로 한 줄로 편다. flat[i] 의 i+1 이 누적 순번.
  const cs = Object.fromEntries(stages.columns.map((c, i) => [c.key, i]));
  const order = [];                          // 등장 순서대로의 지역명
  const byRegion = new Map();
  for (const r of stages.rows) {
    const region = r[cs.region];
    if (!byRegion.has(region)) { byRegion.set(region, []); order.push(region); }
    byRegion.get(region).push({
      region, seq: r[cs.seq], stage: r[cs.stage], kind: r[cs.kind],
    });
  }
  const flat = [];
  for (const region of order) {
    for (const s of byRegion.get(region).sort((a, b) => a.seq - b.seq)) {
      s.idx = flat.length + 1;
      flat.push(s);
    }
  }
  // 노멀에서 빼는 스테이지 수 = 앞쪽 SKIP_REGIONS 개 지역의 스테이지 합
  const skip = order.slice(0, SKIP_REGIONS)
    .reduce((n, r) => n + byRegion.get(r).length, 0);

  // 전술 아카데미 최대 레슨 (누적 부스트가 들어 있는 마지막 행)
  const ca = Object.fromEntries(academy.columns.map((c, i) => [c.key, i]));
  const last = academy.rows.at(-1);
  const boost = {
    lesson: last[ca.lesson],
    cred: last[ca.acb] || 0,
    batt: last[ca.abd] || 0,
    core: last[ca.acd] || 0,
    comm: 0,                                 // 지휘관 경험치는 부스트 대상이 아니다
  };

  // 코어더스트/시(아카데미 적용) → 그 값에 처음 닿는 레벨. 표가 단조증가라 한 번만 훑는다.
  const dust = income.rows.map(r => ({ level: r[ci.level], hr: r[ci.dust_academy] }));

  return { levels, maxLevel, flat, order, byRegion, skip, boost, dust };
}

/* ── 진행도 → 레벨 ─────────────────────────────────────────── */
const stagesOf = region => D.byRegion.get(region) || [];

/* 지역·순번 한 쌍이 누적 몇 번째 스테이지인지. 미선택이면 0. */
function flatIndex(sel) {
  if (!sel || !sel.region) return 0;
  const list = stagesOf(sel.region);
  const hit = list.find(s => s.seq === sel.seq) || list.at(-1);
  return hit ? hit.idx : 0;
}

function derive() {
  const nIdx = flatIndex(input.normal);
  const hIdx = flatIndex(input.hard);
  const normal = Math.max(0, nIdx - D.skip);
  const hard = hIdx;
  const total = normal + hard;
  // 레벨을 세는 카운터에는 지역3 개방분 1이 얹힌다. total 은 실제 클리어 수 그대로 둔다.
  const counter = total + BONUS_STAGES;
  const raw = Math.floor(counter / LEVEL_STEP) + 1;
  const level = Math.min(D.maxLevel, raw);
  return {
    nIdx, hIdx, normal, hard, total, level,
    capped: raw > D.maxLevel,
    into: counter % LEVEL_STEP,              // 이번 레벨에서 넘긴 스테이지 수
    row: D.levels.get(level),
  };
}

/* 목표 레벨에 필요한 누적 클리어 스테이지 수 (선지급분을 뺀 실제 클리어 기준) */
const totalFor = level => Math.max(0, (level - 1) * LEVEL_STEP - BONUS_STAGES);

/* 현재 위치에서 n 스테이지 더 밀었을 때 도달하는 스테이지. 범위를 넘으면 null. */
const advance = (fromIdx, n) => D.flat[fromIdx + n - 1] || null;

const stageLabel = s => s ? (s.kind && s.kind !== 'STAGE' ? `${s.stage} ${s.kind}` : s.stage) : null;

/* 코어더스트/시가 목표값 이상이 되는 첫 레벨 */
function levelForDust(target) {
  const hit = D.dust.find(d => d.hr >= target);
  return hit ? hit.level : null;
}

/* ── 입력 ─────────────────────────────────────────────────── */
function defaults() {
  const lastRegion = D.order.at(-1);
  const lastStage = stagesOf(lastRegion).at(-1);
  return {
    normal: { region: lastRegion, seq: lastStage.seq },
    hard: { region: null, seq: null },
    half: false,
    reported: null,
    from: null,
  };
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE));
    if (saved && saved.normal) return normalize(saved);
  } catch { /* 저장값이 깨졌으면 기본값으로 */ }
  return defaults();
}
const save = () => localStorage.setItem(STORE, JSON.stringify(input));

/* ── 불러온 계정에서 진행도 가져오기 ──────────────────────────
   계산기 탭이 수집한 계정 자료(localStorage 'cp.roster')에 캠페인 진행도가 함께
   들어 있다. 여기서 끌어 쓴다 — 같은 값을 손으로 또 고르게 할 이유가 없다.

   어느 수집본에서 가져왔는지를 input.from 에 남긴다. 그래서
     · 같은 수집본이면 두 번 덮어쓰지 않는다 (사용자가 고친 값을 지키려고)
     · 새로 수집하면 덮어쓴다 (계정 쪽이 언제나 더 최신이라)
   손으로 스테이지를 바꾸면 from 이 지워져(modeRow 의 set) 다음 수집 전까지 유지된다. */
const ROSTER_STORE = 'cp.roster';

function accountData() {
  try {
    const raw = JSON.parse(localStorage.getItem(ROSTER_STORE));
    return (raw && raw.account) ? { ...raw.account, _stamp: String(raw.generated_at || '') } : null;
  } catch { return null; }
}

function accountProgress() {
  const acc = accountData();
  if (!acc || !(acc.progress_normal_campaign || acc.progress_hard_campaign)) return null;
  return { acc, stamp: acc._stamp };
}

function seedFromAccount() {
  const found = accountProgress();
  if (!found || input.from === found.stamp) return false;
  const { acc, stamp } = found;
  input = normalize({
    normal: decodeProgress(acc.progress_normal_campaign),
    hard: decodeProgress(acc.progress_hard_campaign),
    half: input ? input.half : false,
  });
  input.reported = Number(acc.outpost_battle_level) || null;
  input.from = stamp;
  save();
  return true;
}

/* 저장값·외부 입력이 현재 스테이지 표와 안 맞을 수 있으니 한 번 걸러낸다. */
function normalize(v) {
  const fix = sel => {
    if (!sel || !sel.region || !D.byRegion.has(sel.region)) return { region: null, seq: null };
    const list = stagesOf(sel.region);
    const hit = list.find(s => s.seq === sel.seq);
    return { region: sel.region, seq: hit ? hit.seq : list.at(-1).seq };
  };
  return {
    normal: fix(v.normal), hard: fix(v.hard),
    half: !!v.half,                          // 구간표 0.5 단위 토글
    reported: Number(v.reported) || null,    // 게임이 알려준 레벨 (대조용)
    from: v.from || null,                    // 이 값을 채운 수집본 (generated_at)
  };
}

/* ── Shiftypad 연동 ────────────────────────────────────────────
   blablalink `GetUserProfile` 의 진행도는 7자리 정수다.
     6044044 = 노멀 · 지역44 · 그 지역의 44번째 스테이지
     7040043 = 하드  · 지역40 · 43번째
   맨 앞 한 자리는 모드(6=노멀 / 7=하드)라 여기서는 쓰지 않는다.
   순번은 화면에 보이는 스테이지 번호가 아니라 지역 안에서의 순서다
   (44-17A-1 같은 분기 스테이지가 끼어 있어 둘이 어긋난다).           */
export function decodeProgress(code) {
  const n = Number(code) || 0;
  if (n <= 0) return { region: null, seq: null };
  return { region: `지역${Math.floor(n / 1000) % 1000}`, seq: n % 1000 };
}

/* 프로필 응답을 그대로 밀어 넣는 경로. 평소에는 쓰이지 않는다 — 수집한 계정 자료는
   localStorage 에 남아 있어서 탭에 들어올 때 seedFromAccount() 가 알아서 끌어온다.
   outpost_battle_level 을 같이 넘기면 계산값과 대조해 어긋날 때 경고를 띄운다. */
export function setProgress(p = {}) {
  if (!D) return false;
  input = normalize({
    normal: decodeProgress(p.progress_normal_campaign),
    hard: decodeProgress(p.progress_hard_campaign),
    half: input ? input.half : false,
  });
  input.reported = Number(p.outpost_battle_level) || null;
  save();
  if (mounted) paint(mounted);
  return true;
}

/* ── 폼 ───────────────────────────────────────────────────── */
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

function field(labelText, control) {
  const w = el('label', 'op-field');
  w.appendChild(el('span', 'op-lbl', labelText));
  w.appendChild(control);
  return w;
}

function modeRow(mode, root) {
  const sel = input[mode];
  /* 손으로 고르면 계정에서 온 값이 아니게 된다 — 대조용 레벨과 출처를 함께 지운다 */
  const set = fn => { fn(); input.reported = null; input.from = null; save(); paint(root); };

  const row = el('div', 'op-row');
  const regions = [{ value: '', label: t('op.notCleared') },
    ...D.order.map(r => ({ value: r, label: r }))];
  row.appendChild(field(t('op.region'), select(regions, sel.region || '', v => set(() => {
    input[mode] = v ? { region: v, seq: stagesOf(v).at(-1).seq } : { region: null, seq: null };
  }))));

  if (sel.region) {
    const opts = stagesOf(sel.region).map(s => ({ value: s.seq, label: stageLabel(s) }));
    row.appendChild(field(t('op.stage'), select(opts, sel.seq, v => set(() => {
      input[mode].seq = Number(v);
    }))));
  }
  return row;
}

function renderForm(root) {
  const form = el('div', 'op-form');

  const g = el('div', 'op-group');
  g.appendChild(el('h3', null, t('op.progress')));
  g.appendChild(el('p', 'op-note', t('op.progressHint')));
  // 값이 어디서 왔는지 보이게 — 손으로 고른 것과 계정에서 온 것을 구분한다
  if (input.from) g.appendChild(el('p', 'op-note op-fromAcct', t('op.fromAccount')));
  for (const mode of ['normal', 'hard']) {
    const box = el('div', 'op-mode');
    box.appendChild(el('div', 'op-modeLbl', t('op.' + mode)));
    box.appendChild(modeRow(mode, root));
    g.appendChild(box);
  }
  const reset = el('button', 'btn-reset', t('op.reset'));
  reset.type = 'button';
  reset.onclick = () => { input = defaults(); save(); paint(root); };
  g.appendChild(reset);
  form.appendChild(g);

  const info = el('div', 'op-group');
  info.appendChild(el('h3', null, t('op.rules')));
  info.appendChild(el('p', 'op-note', t('op.formula', D.skip, LEVEL_STEP)));
  info.appendChild(el('p', 'op-note', t('op.academyNote', D.boost.lesson)));
  info.appendChild(el('p', 'op-note', t('op.shifty')));
  form.appendChild(info);

  form.appendChild(renderTower());
  return form;
}

/* ── 기업 타워 ────────────────────────────────────────────────
   타워는 요일마다 열리는 것이 정해져 있고(아래 TOWERS), 한 번 열리면 세 층까지
   오른다. '한 번도 막히지 않고 매번 올랐다면' 계정 생성일부터 오늘까지 그 타워가
   열린 횟수 × 3 이 도달 가능한 최대 층이다. 실제 도달 층이 아니라 상한선이다.

   보상은 층수로 끊긴다.
     기업 몰드   — 한 층에 1개, 5의 배수 층에서는 5개. 즉 5층마다 4 + 5 = 9개다.
     퍼펙트 몰드 — 2025-09-24 업데이트로 추가. 3사는 20층마다, 필그림/오버스펙은
                   30층마다 5개씩이라 각각 200층·300층에 한 번 모집할 수 있다.
   모집 한 번에 50개가 필요하므로, 그만큼 모으는 데 드는 층수·등반 회차·주 수를
   같이 낸다 (기업 몰드는 30층 = 10회, 퍼펙트는 200층 = 67회 / 300층 = 100회).

   요일은 브라우저 시간 기준이다. 어차피 '막힘 없이' 라는 가정 위의 상한선이라
   서버 리셋 시각까지 맞출 필요는 없다. */
const TOWER_FLOORS = 3;        // 한 번 열릴 때 오를 수 있는 층
const MOLD_UNIT = 50;          // 모집 한 번에 드는 개수
const MOLD_BONUS_STEP = 5;     // 이 배수 층에서는 1개가 아니라
const MOLD_BONUS = 5;          //   이만큼 준다
const PERFECT_PER = 5;         // 퍼펙트 몰드를 한 번에 주는 개수

/* 0=일 … 6=토. 필그림/오버스펙은 둘이 아니라 타워 하나이고, 퍼펙트 몰드 간격도
   3사(20층)와 다르다(30층). */
const TOWERS = [
  { key: 'ELYSION', days: [0, 2, 5], perfectStep: 20 },
  { key: 'MISSILIS', days: [0, 3, 6], perfectStep: 20 },
  { key: 'TETRA', days: [0, 1, 4], perfectStep: 20 },
  { key: 'PILGRIM', days: [0, 3], perfectStep: 30, label: 'op.towerPilgrim' },
];

/* 두 날짜(자정 기준) 사이에 요일 d 가 몇 번 오는지 — 양 끝을 포함한다 */
function weekdayCount(from, to, d) {
  const span = Math.floor((to - from) / 86400000);
  if (span < 0) return 0;
  const first = (d - from.getDay() + 7) % 7;
  return first > span ? 0 : Math.floor((span - first) / 7) + 1;
}

/* f 층까지 올랐을 때 받은 몰드 개수. 5의 배수 층은 1개가 아니라 5개다. */
const moldsAt = f => f + (MOLD_BONUS - 1) * Math.floor(f / MOLD_BONUS_STEP);
const perfectAt = (f, step) => Math.floor(f / step) * PERFECT_PER;

/* 몰드 50개를 채우는 최소 층. 5층마다 9개라 층수가 딱 떨어지지 않아서
   (29층 49개 · 30층 54개) 근처까지 건너뛴 뒤 한 층씩 맞춘다. */
function floorsForMolds(n) {
  let f = Math.max(0, Math.floor(n / 9) * MOLD_BONUS_STEP - MOLD_BONUS_STEP);
  while (moldsAt(f) < n) f++;
  return f;
}

/* 층수를 등반 회차와 주 수로. 회차는 올림(반 번 오를 수 없다),
   주 수는 소수점 둘째 자리에서 올려 한 자리로 (8.24 -> 8.3). */
function moldRun(floors, perWeek) {
  const runs = Math.ceil(floors / TOWER_FLOORS);
  return { floors, runs, weeks: Math.ceil((runs / perWeek) * 10) / 10 };
}

function renderTower() {
  const g = el('div', 'op-group');
  g.appendChild(el('h3', null, t('op.tower')));

  const acc = accountData();
  const created = acc && acc.created_at ? new Date(acc.created_at * 1000) : null;
  if (!created) {
    g.appendChild(el('p', 'op-note', t('op.towerNeedAcct')));
    return g;
  }

  /* 계정 생성 — 날짜만으로는 '오늘 만든 계정'과 구분이 안 돼 시각까지 적는다 */
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${created.getFullYear()}-${pad(created.getMonth() + 1)}-${pad(created.getDate())}`
    + ` ${pad(created.getHours())}:${pad(created.getMinutes())}`;
  const from = new Date(created); from.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.max(0, Math.floor((today - from) / 86400000)) + 1;

  const head = el('p', 'op-note op-created');
  head.appendChild(el('span', 'op-createdLbl', t('op.created')));
  head.appendChild(el('span', 'op-createdVal', stamp));
  head.appendChild(el('span', 'op-createdSub', t('op.sinceDays', days)));
  g.appendChild(head);
  g.appendChild(el('p', 'op-note', t('op.towerHint', TOWER_FLOORS)));

  const tbl = el('table', 'grid op-towerTbl');
  const thead = el('thead'), hr = el('tr');
  for (const [key, cls] of [['op.towerCol', ''], ['op.towerFloor', 'num'],
    ['op.towerMold', 'num'], ['op.towerPerfect', 'num']]) {
    hr.appendChild(el('th', cls, t(key)));
  }
  thead.appendChild(hr);
  tbl.appendChild(thead);

  const tb = el('tbody');
  for (const tw of TOWERS) {
    const opens = tw.days.reduce((a, d) => a + weekdayCount(from, today, d), 0);
    const floors = opens * TOWER_FLOORS;
    const mold = moldRun(floorsForMolds(MOLD_UNIT), tw.days.length);
    const perfect = moldRun(tw.perfectStep * (MOLD_UNIT / PERFECT_PER), tw.days.length);
    const name = tw.label ? t(tw.label) : ctx.L('corporation', tw.key);

    const tr = el('tr');
    const nameTd = el('td', 'op-towerName');
    const ic = ctx.iconEl && ctx.iconEl('corporation', tw.key);
    if (ic) nameTd.appendChild(ic);
    nameTd.appendChild(el('span', null, name));
    nameTd.title = `${name} — ${t('op.towerDays', tw.days.map(d => t('op.wd' + d)).join('·'))}`;
    tr.appendChild(nameTd);

    const fl = el('td', 'num', t('op.floorN', floors));
    // 지금까지 쌓인 몰드 개수는 상시로 보여줄 만큼 중요하진 않아 hover 로
    fl.title = t('op.towerHave', opens, moldsAt(floors), perfectAt(floors, tw.perfectStep));
    tr.appendChild(fl);

    for (const m of [mold, perfect]) {
      const td = el('td', 'num');
      td.appendChild(el('span', 'op-runs', t('op.runN', m.runs)));
      td.appendChild(el('span', 'op-weeks', t('op.weekN', m.weeks.toFixed(1))));
      // 몇 층까지 올라야 하는지는 회차·주 수보다 덜 쓰여 hover 로
      td.title = t('op.towerNeed', MOLD_UNIT, m.floors);
      tr.appendChild(td);
    }
    tb.appendChild(tr);
  }
  tbl.appendChild(tb);
  g.appendChild(tbl);
  g.appendChild(el('p', 'op-note op-towerFoot',
    t('op.towerMoldNote', MOLD_BONUS_STEP, MOLD_BONUS, PERFECT_PER, MOLD_UNIT)));
  return g;
}

/* ── 결과 ─────────────────────────────────────────────────── */
function renderHero(d) {
  const head = el('div', 'op-hero');
  head.appendChild(el('div', 'op-heroLbl', t('op.level')));
  head.appendChild(el('div', 'op-heroNum', int(d.level)));

  const bar = el('div', 'op-bar');
  const fill = el('div', 'op-barFill');
  fill.style.width = (d.into / LEVEL_STEP * 100) + '%';
  bar.appendChild(fill);
  head.appendChild(bar);
  head.appendChild(el('div', 'op-barLbl',
    d.capped ? t('op.atCap', D.maxLevel)
      : t('op.toNext', LEVEL_STEP - d.into, d.into, LEVEL_STEP)));

  const tags = el('div', 'op-tags');
  tags.appendChild(el('span', 'op-tag', t('op.stagesTotal', d.total)));
  tags.appendChild(el('span', 'op-tag', t('op.stagesSplit', d.normal, d.hard)));
  tags.appendChild(el('span', 'op-tag', t('op.academyTag', D.boost.lesson)));
  head.appendChild(tags);

  // Shiftypad 가 알려준 레벨과 계산값이 다르면 조용히 넘기지 않는다
  if (input.reported && input.reported !== d.level) {
    head.appendChild(el('p', 'op-warn', t('op.mismatch', input.reported, d.level)));
  }
  return head;
}

/* [키, 라벨, 소수 자릿수 {분, 시, 일}]. 코어더스트만 소수가 의미 있는데,
   자릿수를 통일하면 하루치가 2,619.3960 처럼 쓸데없이 길어진다. */
const RES = [
  ['core', 'op.dust', { min: 4, hr: 4, day: 1 }],
  ['cred', 'op.credit', { min: 0, hr: 0, day: 0 }],
  ['batt', 'op.battle', { min: 0, hr: 0, day: 0 }],
  ['comm', 'op.exp', { min: 0, hr: 0, day: 0 }],
];
const num = (v, d) => (d ? dec(v, d) : int(v));

/* 부스트 적용값. 코어더스트는 원본에 아카데미 적용 열이 따로 있어 그걸 쓴다. */
function applied(row, key) {
  if (!row) return null;
  if (key === 'core') return { hr: row.dustAcademy, min: row.dustAcademy / 60 };
  const b = 1 + D.boost[key];
  return { hr: row[key].hr * b, min: row[key].min * b };
}

function renderIncome(d) {
  const card = el('div', 'card');
  card.appendChild(el('h3', null, t('op.income')));

  const cards = el('div', 'op-stats');
  for (const [key, lab, dg] of RES) {
    const a = applied(d.row, key);
    const c = el('div', 'op-stat');
    c.appendChild(el('span', 'op-statLbl', t(lab)));
    c.appendChild(el('span', 'op-statNum', num(a?.hr, dg.hr)));
    c.appendChild(el('span', 'op-statSub', t('op.perHr')));
    cards.appendChild(c);
  }
  card.appendChild(cards);

  const tbl = el('table', 'grid');
  const thead = el('thead'), hr = el('tr');
  for (const k of ['op.res', 'op.boost', 'op.baseHr', 'op.appliedHr', 'op.perMinCol', 'op.perDay']) {
    hr.appendChild(el('th', k === 'op.res' ? null : 'num', t(k)));
  }
  thead.appendChild(hr); tbl.appendChild(thead);

  const body = el('tbody');
  for (const [key, lab, dg] of RES) {
    const a = applied(d.row, key);
    const raw = d.row ? d.row[key] : null;
    const tr = el('tr');
    tr.appendChild(el('td', null, t(lab)));
    tr.appendChild(el('td', 'num', D.boost[key] ? '+' + Math.round(D.boost[key] * 100) + '%' : '—'));
    tr.appendChild(el('td', 'num', num(raw?.hr, dg.hr)));
    tr.appendChild(el('td', 'num op-em', num(a?.hr, dg.hr)));
    tr.appendChild(el('td', 'num', num(a?.min, dg.min)));
    tr.appendChild(el('td', 'num', num(a?.hr == null ? null : a.hr * 24, dg.day)));
    body.appendChild(tr);
  }
  tbl.appendChild(body);
  card.appendChild(scrollBox(tbl));
  return card;
}

/* 다음 정수 코어더스트/시까지 — 이 탭의 핵심 */
function renderNext(d) {
  const card = el('div', 'card op-card-next');
  card.appendChild(el('h3', null, t('op.next')));

  const cur = d.row ? d.row.dustAcademy : 0;
  card.appendChild(el('p', 'op-note', t('op.nextHint', dec(cur, 4))));

  /* 한 레벨에서 정수 여러 칸을 한꺼번에 넘기는 구간이 있다 (예: 532→533 이
     93.4 → 102.2 라 94~102 가 모두 533). 필요 레벨이 같으면 줄을 나눠봐야
     같은 말이므로 그중 가장 높은 값 하나만 남긴다. */
  const targets = [];
  for (let v = Math.floor(cur) + 1; ; v++) {
    const lv = levelForDust(v);
    if (lv == null) break;
    const prev = targets.at(-1);
    if (prev && prev.level === lv) { prev.value = v; continue; }
    if (targets.length === NEXT_TARGETS) break;
    targets.push({ value: v, level: lv });
  }
  if (!targets.length) {
    card.appendChild(el('p', 'op-note', t('op.noNext')));
    return card;
  }

  const tbl = el('table', 'grid');
  const thead = el('thead'), hr = el('tr');
  hr.appendChild(el('th', 'num', t('op.target')));
  hr.appendChild(el('th', 'num', t('op.needLevel')));
  hr.appendChild(el('th', 'num', t('op.needStages')));
  hr.appendChild(el('th', null, t('op.viaNormal')));
  hr.appendChild(el('th', null, t('op.viaHard')));
  thead.appendChild(hr); tbl.appendChild(thead);

  const body = el('tbody');
  targets.forEach((x, i) => {
    const need = Math.max(0, totalFor(x.level) - d.total);
    const n = advance(d.nIdx, need);
    const h = advance(d.hIdx, need);
    const tr = el('tr', i === 0 ? 'op-first' : null);
    tr.appendChild(el('td', 'num op-em', dec(x.value, 0)));
    tr.appendChild(el('td', 'num', int(x.level)));
    tr.appendChild(el('td', 'num', '+' + int(need)));
    tr.appendChild(el('td', null, stageLabel(n) || t('op.outOfRange')));
    tr.appendChild(el('td', null, stageLabel(h) || t('op.outOfRange')));
    body.appendChild(tr);
  });
  tbl.appendChild(body);
  card.appendChild(scrollBox(tbl));
  card.appendChild(el('p', 'op-note', t('op.viaHint')));
  return card;
}

/* 코어더스트 구간표 — 값 하나하나에 필요한 최소 레벨 */
function renderTable(d, root) {
  const card = el('div', 'card');
  const head = el('div', 'op-cardhead');
  head.appendChild(el('h3', null, t('op.table')));
  const lbl = el('label', 'check');
  const cb = el('input');
  cb.type = 'checkbox';
  cb.checked = !!input.half;
  cb.onchange = () => { input.half = cb.checked; save(); paint(root); };
  lbl.appendChild(cb);
  lbl.appendChild(el('span', null, t('op.half')));
  head.appendChild(lbl);
  card.appendChild(head);

  const step = input.half ? 0.5 : 1;
  const lo = Math.ceil(D.dust[0].hr / step) * step;
  const hi = Math.floor(D.dust.at(-1).hr / step) * step;
  const cur = d.row ? d.row.dustAcademy : 0;

  const tbl = el('table', 'grid');
  const thead = el('thead'), hr = el('tr');
  hr.appendChild(el('th', 'num', t('op.target')));
  hr.appendChild(el('th', 'num', t('op.minLevel')));
  hr.appendChild(el('th', 'num', t('op.cumStages')));
  hr.appendChild(el('th', 'num', t('op.deltaStages')));
  thead.appendChild(hr); tbl.appendChild(thead);

  const body = el('tbody');
  let marked = false;
  // 부동소수점으로 0.5 를 누적하지 않도록 정수 단계로 센다
  const steps = Math.round((hi - lo) / step);
  for (let i = 0; i <= steps; i++) {
    const v = Math.round((lo + i * step) * 2) / 2;
    const lv = levelForDust(v);
    if (lv == null) continue;
    const need = totalFor(lv) - d.total;
    const tr = el('tr');
    // 현재 수급량이 속한 구간 = 아직 넘지 못한 첫 줄의 바로 위
    if (!marked && v > cur) { tr.classList.add('op-first'); marked = true; }
    if (v <= cur) tr.classList.add('op-done');
    tr.appendChild(el('td', 'num', input.half ? dec(v, 1) : dec(v, 0)));
    tr.appendChild(el('td', 'num', int(lv)));
    tr.appendChild(el('td', 'num', int(totalFor(lv))));
    tr.appendChild(el('td', 'num', need > 0 ? '+' + int(need) : '—'));
    body.appendChild(tr);
  }
  tbl.appendChild(body);
  card.appendChild(el('p', 'op-note', t('op.tableHint')));
  const box = scrollBox(tbl);
  card.appendChild(box);

  /* 97~195행짜리 표라 지금 노리는 구간이 한참 아래에 있다. 붙자마자 그 줄로 내린다.
     scrollIntoView 는 페이지 전체를 움직이므로 상자 안에서만 계산한다. */
  const hit = body.querySelector('.op-first');
  if (hit) {
    queueMicrotask(() => {
      box.scrollTop = Math.max(0, hit.offsetTop - box.clientHeight / 2);
    });
  }
  return card;
}

function renderResult(root) {
  const out = el('div', 'op-out');
  const d = derive();
  out.appendChild(renderHero(d));
  out.appendChild(renderIncome(d));
  out.appendChild(renderNext(d));
  out.appendChild(renderTable(d, root));
  return out;
}

function paint(root) {
  root.textContent = '';
  const wrap = el('div', 'op-wrap');
  wrap.appendChild(renderForm(root));
  wrap.appendChild(renderResult(root));
  root.appendChild(wrap);
}

/* app.js 가 부르는 유일한 진입점 */
export async function renderOutpost(root, context) {
  ctx = context;
  mounted = root;
  if (!D) {
    root.textContent = '';
    root.appendChild(el('p', 'notice', t('op.loading')));
    try {
      await loadAll();
    } catch (err) {
      root.textContent = '';
      root.appendChild(el('p', 'notice notice-error', String(err.message || err)));
      return;
    }
    input = load();
  }
  seedFromAccount();          // 새로 수집한 계정 자료가 있으면 진행도를 끌어온다
  paint(root);
}
