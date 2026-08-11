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
  corporation: { order: ['ELYSION', 'MISSILIS', 'TETRA', 'PILGRIM', 'ABNORMAL'] },
  element: { order: ['Fire', 'Water', 'Wind', 'Electronic', 'Iron'] },
  class: { order: ['Attacker', 'Defender', 'Supporter'] },
  weapon_type: { order: ['AR', 'SMG', 'SG', 'MG', 'SR', 'RL'] },
  burst: { order: ['Step1', 'Step2', 'Step3', 'AllStep'] },
  rarity: { order: ['SSR', 'SR', 'R'] },
};
const PICKUP_AXES = {
  status: { order: ['ongoing', 'upcoming', 'ended'] },
  availability: { order: ['standard', 'limited'] },
  tag: { order: ['collab', 'summer', 'christmas', 'new_year', 'anniversary', 'half_anniversary', 'maid', 'bunny', '_none'] },
};
/* 축 이름은 UI 문구라 t() 로, 축의 값(엘리시온/작열…)은 taxonomy 라 L() 로 간다 */
export const axisLabel = axis => t('ax.' + axis);
/* ── UI 문자열 ─────────────────────────────────────────────────
   [ko, en, ja] 순서. 값이 함수면 인자를 받아 문자열을 만든다.
   데이터 쪽 라벨(기업/속성/스쿼드…)은 taxonomy.json 이 담당하고,
   여기는 순수 UI 문구만 둔다. 초성 검색은 한국어에서만 의미가 있어서
   검색 안내 예시도 언어별로 다르다.                                  */
const LANGS = ['ko', 'en', 'ja'];
const STR = {
  'app.title': ['니케 리스트 · 픽업일정', 'NIKKE List · Banner Schedule', 'ニケリスト・ピックアップ日程'],
  'app.brand': ['니케 리스트', 'NIKKE List', 'ニケリスト'],
  'app.brandSub': ['· 픽업일정', '· Banners', '・ピックアップ'],

  'tab.nikkes': ['니케 리스트', 'Nikkes', 'ニケ一覧'],
  'tab.pickups': ['픽업일정', 'Banners', 'ピックアップ'],
  'tab.stats': ['통계', 'Stats', '統計'],

  'ui.loading': ['데이터를 불러오는 중…', 'Loading data…', 'データを読み込み中…'],
  'ui.reset': ['필터 초기화', 'Reset filters', 'フィルタ初期化'],
  'ui.theme': ['테마 전환', 'Toggle theme', 'テーマ切替'],
  'ui.close': ['닫기', 'Close', '閉じる'],
  'ui.toLight': ['라이트 모드로 전환', 'Switch to light mode', 'ライトモードに切替'],
  'ui.toDark': ['다크 모드로 전환', 'Switch to dark mode', 'ダークモードに切替'],
  'ui.filters': ['필터', 'Filters', 'フィルタ'],
  'ui.langGroup': ['표시 언어', 'Display language', '表示言語'],
  'ui.search': [
    '이름 · 별명 · 초성 검색 (예: ㄹㅍ, 스화, 흑염룡)',
    'Search by name, squad or Korean nickname (e.g. Rapi, Counters)',
    '名前・スカッド・あだ名で検索（例: ラピ、カウンターズ）',
  ],
  'ui.meta': [
    m => `데이터 기준일 ${m.updated_at} · 니케 ${m.counts.nikkes}명 · 배너 ${m.counts.pickups}개`,
    m => `Data as of ${m.updated_at} · ${m.counts.nikkes} Nikkes · ${m.counts.pickups} banners`,
    m => `データ基準日 ${m.updated_at} · ニケ ${m.counts.nikkes}体 · バナー ${m.counts.pickups}件`,
  ],

  'f.squad': ['스쿼드', 'Squad', 'スカッド'],
  'f.release': ['출시일', 'Released', '実装日'],
  'f.releaseFrom': ['출시일 시작', 'Released from', '実装日 開始'],
  'f.releaseTo': ['출시일 종료', 'Released to', '実装日 終了'],
  'f.rerun': ['복각', 'Rerun', '復刻'],
  'f.rerunOnly': ['복각만', 'Reruns only', '復刻のみ'],
  'f.firstOnly': ['최초 픽업만', 'First run only', '初回のみ'],
  'f.timeline': ['타임라인 보기', 'Timeline view', 'タイムライン表示'],
  'f.all': ['전체', 'All', 'すべて'],

  'ax.corporation': ['기업', 'Corp', '製造'],
  'ax.element': ['속성', 'Element', '属性'],
  'ax.class': ['클래스', 'Class', 'クラス'],
  'ax.weapon_type': ['무기', 'Weapon', '武器'],
  'ax.burst': ['버스트', 'Burst', 'バースト'],
  'ax.rarity': ['등급', 'Rarity', 'レア'],
  'ax.status': ['진행', 'Status', '状態'],
  'ax.availability': ['픽업', 'Pool', '排出'],
  'ax.tag': ['구분', 'Type', '区分'],
  'ax.attack_type': ['공격타입', 'Attack type', '攻撃タイプ'],

  'col.name': ['이름', 'Name', '名前'],
  'col.squad': ['스쿼드', 'Squad', 'スカッド'],
  'col.release': ['출시일', 'Released', '実装日'],
  'col.pickups': ['픽업', 'Banners', 'PU'],
  'col.no': ['연번', '#', '番号'],
  'col.period': ['기간', 'Period', '期間'],

  'msg.emptyNikke': ['조건에 맞는 니케가 없습니다.', 'No Nikkes match these filters.', '条件に合うニケがいません。'],
  'msg.emptyPickup': ['조건에 맞는 픽업이 없습니다.', 'No banners match these filters.', '条件に合うピックアップがありません。'],
  'msg.unlisted': ['(리스트 미등록)', '(not in list yet)', '（リスト未登録）'],
  'msg.noPickup': [
    '픽업 배너 이력이 없습니다 (런칭 유닛 또는 비가챠).',
    'No banner history (launch unit or non-gacha).',
    'ピックアップ履歴がありません（実装時ユニットまたは非ガチャ）。',
  ],
  'msg.rerunOf': [n => `#${n} 복각`, n => `Rerun of #${n}`, n => `#${n} 復刻`],
  'msg.dday': [n => `D-${n}`, n => `in ${n}d`, n => `あと${n}日`],
  'msg.year': [y => `${y}년`, y => `${y}`, y => `${y}年`],

  'cnt.nikkes': [
    (n, t) => `<b>${n}</b> / ${t}명`,
    (n, t) => `<b>${n}</b> / ${t}`,
    (n, t) => `<b>${n}</b> / ${t}体`,
  ],
  'cnt.banners': [
    (n, t) => `<b>${n}</b> / ${t}개 배너`,
    (n, t) => `<b>${n}</b> / ${t} banners`,
    (n, t) => `<b>${n}</b> / ${t}件`,
  ],
  'cnt.both': [
    (a, b) => `니케 <b>${a}</b> · 배너 <b>${b}</b>`,
    (a, b) => `<b>${a}</b> Nikkes · <b>${b}</b> banners`,
    (a, b) => `ニケ <b>${a}</b> · バナー <b>${b}</b>`,
  ],

  'sheet.aliases': [n => `별명 (${n})`, n => `Nicknames (${n})`, n => `あだ名 (${n})`],
  'sheet.history': [n => `픽업 이력 (${n})`, n => `Banner history (${n})`, n => `ピックアップ履歴 (${n})`],

  'err.title': ['데이터를 불러오지 못했습니다.', 'Could not load the data.', 'データを読み込めませんでした。'],
  'err.hint': [
    'data/*.json 이 레포에 올라가 있는지 확인하세요. 로컬에서 열었다면 <code>file://</code> 이 아니라 <code>python3 -m http.server</code> 로 띄워야 합니다.',
    'Check that data/*.json exists in the repo. If opened locally, serve it with <code>python3 -m http.server</code> — <code>file://</code> will not work.',
    'data/*.json がリポジトリにあるか確認してください。ローカルで開いた場合は <code>file://</code> ではなく <code>python3 -m http.server</code> で配信してください。',
  ],

  /* 통계 탭 (charts.js 에서 ctx.t 로 받아 쓴다) */
  'st.head': [
    (a, b) => `현재 필터 기준 · 니케 ${a}명 · 픽업 배너 ${b}개 — 필터를 바꾸면 아래 모든 차트가 함께 좁혀집니다.`,
    (a, b) => `Current filters · ${a} Nikkes · ${b} banners — every chart below narrows with the filters.`,
    (a, b) => `現在のフィルタ · ニケ ${a}体 · バナー ${b}件 — フィルタを変えると下のチャートも一緒に絞られます。`,
  ],
  'st.byAxis': [
    a => `${a}별 분포`, a => `By ${a}`, a => `${a}別の分布`,
  ],
  'st.basis': [n => `${n}명 기준`, n => `of ${n} Nikkes`, n => `${n}体 基準`],
  'st.basisBanner': [n => `${n}개 배너 기준`, n => `of ${n} banners`, n => `${n}件のバナー基準`],
  'st.squadTop': [n => `스쿼드 TOP 12`, n => `Top 12 squads`, n => `スカッド TOP 12`],
  'st.squadTotal': [n => `총 ${n}개 스쿼드`, n => `${n} squads total`, n => `全 ${n} スカッド`],
  'st.cross': [(a, b) => `${a} × ${b}`, (a, b) => `${a} × ${b}`, (a, b) => `${a} × ${b}`],
  'st.crossHint': [
    '칸의 숫자는 해당 조합의 니케 수',
    'Each cell is the number of Nikkes in that combination',
    'マスの数字はその組み合わせのニケ数',
  ],
  'st.elementNote': [
    '막대 색은 검증된 팔레트이고, 아이콘은 게임 내 아이콘입니다. 둘 다 항상 속성 이름과 함께 표시됩니다.',
    'Bar colors come from the validated palette; icons are the in-game ones. Both always sit beside the element name.',
    'バーの色は検証済みパレット、アイコンはゲーム内のものです。どちらも常に属性名と一緒に表示されます。',
  ],
  'st.quarter': ['분기별 출시 추이', 'Releases by quarter', '四半期ごとの実装推移'],
  'st.quarterHint': [
    '가로축은 분기, 세로축은 출시된 니케 수',
    'X axis is the quarter, Y axis is Nikkes released',
    '横軸は四半期、縦軸は実装されたニケ数',
  ],
  'st.avail': ['한정 / 상시 비율', 'Limited vs standard', '限定 / 常設の比率'],
  'st.tagDist': ['픽업 구분별 분포', 'Banners by type', '区分別の分布'],
  'st.status': ['배너 진행 상태', 'Banner status', 'バナーの状態'],
  'st.statusHint': ['브라우저 현재 시각 기준', 'Based on your current time', 'ブラウザの現在時刻基準'],
  'st.gap': ['복각 주기', 'Time until rerun', '復刻までの期間'],
  'st.gapHint': [
    (n, med) => `복각 ${n}건 · 첫 픽업 이후 경과 개월 (중앙값 ${med}개월)`,
    (n, med) => `${n} reruns · months since first banner (median ${med})`,
    (n, med) => `復刻 ${n}件 · 初回からの経過月数（中央値 ${med}ヶ月）`,
  ],
  'st.gapNone': [
    '현재 조건에 복각 배너가 없습니다',
    'No reruns match the current filters',
    '現在の条件に復刻バナーがありません',
  ],
  'st.months': [
    (a, b) => b == null ? `${a}개월+` : `${a}~${b}개월`,
    (a, b) => b == null ? `${a}+ months` : `${a}–${b} months`,
    (a, b) => b == null ? `${a}ヶ月以上` : `${a}〜${b}ヶ月`,
  ],
  'st.noBanner': ['픽업 이력 없음', 'Never featured', 'ピックアップ履歴なし'],
  'st.noBannerHint': [
    '런칭 유닛이거나 가챠 배너를 받은 적 없는 니케',
    'Launch units, or Nikkes that never had a banner',
    '実装時ユニット、またはバナーを持たないニケ',
  ],
  'st.hasBanner': ['픽업 있음', 'Featured', 'ピックアップあり'],
  'st.hasNoBanner': ['픽업 없음', 'Never featured', 'ピックアップなし'],
  'st.empty': ['해당 조건의 니케가 없습니다.', 'No Nikkes match.', '条件に合うニケがいません。'],
  'st.few': ['적음', 'Low', '少'],
  'st.many': ['많음', 'High', '多'],
  'st.tipCount': [
    (label, v, pct) => `${label} — <b>${v}</b> (${pct}%)`,
    (label, v, pct) => `${label} — <b>${v}</b> (${pct}%)`,
    (label, v, pct) => `${label} — <b>${v}</b> (${pct}%)`,
  ],
  'st.tipCell': [
    (r, c, v) => `${r} × ${c} — <b>${v}</b>명`,
    (r, c, v) => `${r} × ${c} — <b>${v}</b>`,
    (r, c, v) => `${r} × ${c} — <b>${v}</b>体`,
  ],
  'st.tipQuarter': [
    (label, v) => `${label} — <b>${v}</b>명`,
    (label, v) => `${label} — <b>${v}</b>`,
    (label, v) => `${label} — <b>${v}</b>体`,
  ],
  'st.yearLabel': [y => `${y}년`, y => `${y}`, y => `${y}年`],
};

export function t(key, ...args) {
  const row = STR[key];
  if (!row) return key;
  const v = row[LANGS.indexOf(state.lang)] ?? row[0];
  return typeof v === 'function' ? v(...args) : v;
}

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

/* ── 아이콘 ────────────────────────────────────────────────────
   assets/icons/ 아래 게임 아이콘. 파일명은 데이터 코드를 소문자로 내린 것.
   기업은 'simple' 계열을 쓰고, 오버스펙 니케는 전용 변형이 있으면 그쪽을 쓴다. */
const ICON_DIR = {
  element: 'element', class: 'class', weapon_type: 'weapon',
  burst: 'burst', rarity: 'rarity',
};
/* overspec 변형이 존재하는 기업만. 실제 OVERSPEC 니케 4명도 이 셋 안에 있다. */
const CORP_OVERSPEC = new Set(['ELYSION', 'MISSILIS', 'TETRA']);

export function iconSrc(axis, code, overspec) {
  if (!code) return null;
  const file = String(code).toLowerCase();
  if (axis === 'corporation') {
    const ov = overspec && CORP_OVERSPEC.has(code) ? '_simple_overspec' : '_simple';
    return `assets/icons/company/${file}${ov}.png`;
  }
  const dir = ICON_DIR[axis];
  return dir ? `assets/icons/${dir}/${file}.webp` : null;
}

/* 아이콘은 항상 텍스트 라벨 옆에 붙는 장식이라 alt 는 비운다.
   코드가 새로 생겨 파일이 없으면 조용히 사라지게 한다(화면이 깨지지 않게). */
export function iconEl(axis, code, opts = {}) {
  const src = iconSrc(axis, code, opts.overspec);
  if (!src) return null;
  const img = document.createElement('img');
  img.className = 'ic' + (opts.cls ? ' ' + opts.cls : '');
  img.dataset.axis = axis;   // 테마별 실루엣 보정을 CSS 에서 걸기 위한 훅
  img.src = src;
  img.alt = '';
  img.loading = 'lazy';
  img.decoding = 'async';
  img.onerror = () => img.remove();
  return img;
}

/* 아이콘 + 텍스트 한 덩어리 */
function labelWith(axis, code, text, opts) {
  const s = el('span', 'iconlbl');
  const ic = iconEl(axis, code, opts);
  if (ic) s.appendChild(ic);
  s.appendChild(el('span', null, text));
  return s;
}

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

/* 매처 두 벌을 만든다.
     name  — 니케 이름(한/영/일) 전용. 초성 + 완성형 혼용을 받는다.
     plain — 스쿼드·별명용. 부분 일치만 하고 초성 확장은 하지 않는다.
   초성 확장을 이름 밖으로 넓히면 검색이 금방 무의미해진다. 별명은 'ㄱ' 하나에
   개·곰·깡이 전부 걸리고, 스쿼드는 'ㄹㅍ' 하나에 리플레이스·세라핌 소속이
   통째로 딸려온다. 둘 다 통으로 쳐서 찾는 이름이라 부분 일치면 충분하다.
   별명 자체가 초성인 것들('ㄹㅊㄹ', 'ㅋㄷ')은 부분 일치로 그대로 잡힌다. */
function buildMatcher(raw) {
  const q = compact(raw.trim());
  if (!q) return null;

  const lower = q.toLowerCase();
  const plain = s => compact(s).toLowerCase().includes(lower);

  const chars = [...q];
  if (!chars.some(c => CHO.includes(c))) return { name: plain, plain };

  const pattern = chars.map(ch => {
    const i = CHO.indexOf(ch);
    if (i < 0) return escapeRe(ch);
    const start = HANGUL_BASE + i * PER_CHO;
    // 자모 그 자체 + 그 초성으로 시작하는 완성형 음절 전체
    return `[${ch}${u(start)}-${u(start + PER_CHO - 1)}]`;
  }).join('');

  let re;
  try { re = new RegExp(pattern, 'i'); } catch { return { name: plain, plain }; }
  return { name: s => re.test(compact(s)), plain };
}

/* state.q 가 바뀔 때만 다시 만든다 (행마다 정규식을 새로 짜지 않게) */
function matcher() {
  if (state._q !== state.q) {
    state._q = state.q;
    state._match = buildMatcher(state.q);
  }
  return state._match;
}

/* 스쿼드는 내부 코드가 아니라 화면에 보이는 표시명으로 찾는다.
   코드로 매칭하면 콜라보 스쿼드(ce_01, ce002_01, CE006_01)에 들어 있는
   숫자 때문에 '1' 같은 검색어에 엉뚱한 니케가 걸리고, 반대로 '카운터스'
   처럼 실제로 보이는 이름으로는 못 찾는다. 라벨이 없는 새 코드만 코드로 폴백. */
const squadText = code => {
  if (!code) return [];
  const e = D.taxonomy.squad?.[code];
  return e ? [e.ko, e.en, e.ja].filter(Boolean) : [code];
};

/* 니케 하나가 현재 검색어에 걸리는지 — 이름만 초성까지, 스쿼드/별명은 부분 일치 */
function hitsNikke(m, n) {
  return [n.name.ko, n.name.en, n.name.ja].some(v => v && m.name(v))
    || squadText(n.squad).some(m.plain)
    || (n.aliases || []).some(m.plain);
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
  if (except !== '_overspec' && state.overspec && n.corporation_sub_type !== 'OVERSPEC') return false;
  if (state.relFrom && (!n.release_date || n.release_date < state.relFrom)) return false;
  if (state.relTo && (!n.release_date || n.release_date > state.relTo)) return false;
  const m = matcher();
  if (m && !hitsNikke(m, n)) return false;
  return true;
}

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
  if (except !== '_overspec' && state.overspec && p.corporation_sub_type !== 'OVERSPEC') return false;
  if (state.relFrom && (!n || !n.release_date || n.release_date < state.relFrom)) return false;
  if (state.relTo && (!n || !n.release_date || n.release_date > state.relTo)) return false;

  if (except !== 'status' && state.sel.status.size && !state.sel.status.has(statusOf(p))) return false;
  if (except !== 'availability' && state.sel.availability.size && !state.sel.availability.has(p.availability)) return false;
  if (except !== 'tag' && state.sel.tag.size && !state.sel.tag.has(p.tag ?? '_none')) return false;
  if (state.rerun === 'first' && p.rerun_of != null) return false;
  if (state.rerun === 'rerun' && p.rerun_of == null) return false;

  // rid 가 없는 예정 배너는 니케 레코드가 없으므로 시트의 한국어 이름으로만 판정한다
  const m = matcher();
  if (m && !(m.name(p.name_ko) || (n && hitsNikke(m, n)))) return false;
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
    row.appendChild(el('span', 'lbl', axisLabel(axis)));
    for (const code of def.order) {
      const b = el('button', 'chip');
      b.type = 'button';
      b.dataset.axis = axis;
      b.dataset.code = code;
      b.setAttribute('aria-pressed', state.sel[axis].has(code));
      const ic = iconEl(axis, code);
      if (ic) b.appendChild(ic);
      b.appendChild(el('span', null, chipLabel(axis, code)));
      b.appendChild(el('span', 'n'));
      row.appendChild(b);
    }
    // 오버스펙은 기업을 대체하지 않는 부가 속성이라 기업 행에 붙인다
    if (axis === 'corporation') {
      const b = el('button', 'chip chip-ovr');
      b.type = 'button';
      b.dataset.axis = '_overspec';
      b.dataset.code = 'OVERSPEC';
      b.setAttribute('aria-pressed', state.overspec);
      const ic = iconEl('corporation', 'ELYSION', { overspec: true });
      if (ic) b.appendChild(ic);
      b.appendChild(el('span', null, L('corporation_sub_type', 'OVERSPEC')));
      b.appendChild(el('span', 'n'));
      row.appendChild(b);
    }
    wrap.appendChild(row);
  }
  wrap.onclick = e => {
    const b = e.target.closest('.chip');
    if (!b) return;
    const { axis, code } = b.dataset;
    if (axis === '_overspec') state.overspec = !state.overspec;
    else state.sel[axis].has(code) ? state.sel[axis].delete(code) : state.sel[axis].add(code);
    render();
  };
}

const statusLabel = code => STATUS_LABEL[code]?.[lang()] ?? code;

function chipLabel(axis, code) {
  if (axis === 'status' || code === '_none') return statusLabel(code);
  return L(axis, code);
}

function updateChipCounts() {
  for (const b of $$('#chipfilters .chip')) {
    const { axis, code } = b.dataset;
    let n;
    if (axis === '_overspec') {
      n = state.tab === 'pickups'
        ? filteredPickups('_overspec').filter(p => p.corporation_sub_type).length
        : filteredNikkes('_overspec').filter(x => x.corporation_sub_type).length;
      b.querySelector('.n').textContent = n;
      b.setAttribute('aria-pressed', state.overspec);
      b.disabled = n === 0 && !state.overspec;
      b.style.opacity = b.disabled ? .4 : '';
      continue;
    }
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
  { key: 'name', str: 'col.name', cls: 'name' },
  { key: 'rarity', axis: 'rarity' },
  { key: 'corporation', axis: 'corporation' },
  { key: 'element', axis: 'element' },
  { key: 'class', axis: 'class' },
  { key: 'weapon_type', axis: 'weapon_type' },
  { key: 'burst', axis: 'burst' },
  { key: 'squad', str: 'col.squad' },
  { key: 'release_date', str: 'col.release', cls: 'num' },
  { key: 'pickups', str: 'col.pickups', cls: 'num' },
];
const colLabel = c => c.axis ? axisLabel(c.axis) : t(c.str);

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
    const th = el('th', c.cls === 'num' ? 'num' : null, colLabel(c));
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
    tr.appendChild(tdName);

    tr.appendChild(iconCell('rarity', n.rarity));
    tr.appendChild(iconCell('corporation', n.corporation,
      { overspec: n.corporation_sub_type === 'OVERSPEC' }));
    tr.appendChild(iconCell('element', n.element));
    tr.appendChild(iconCell('class', n.class));
    tr.appendChild(iconCell('weapon_type', n.weapon_type));
    tr.appendChild(iconCell('burst', n.burst));
    tr.appendChild(el('td', null, L('squad', n.squad)));
    tr.appendChild(el('td', 'num', n.release_date || '—'));
    tr.appendChild(el('td', 'num', String(pickupsByRid.get(n.rid)?.length || 0)));
    frag.appendChild(tr);
  }
  body.appendChild(frag);

  $('#nikkeEmpty').hidden = rows.length > 0;
  $('#count').innerHTML = t('cnt.nikkes', rows.length, D.nikkes.length);
}

function iconCell(axis, code, opts) {
  const td = el('td');
  if (!code) { td.textContent = '—'; return td; }
  td.appendChild(labelWith(axis, code, L(axis, code), opts));
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
  const text = s === 'upcoming'
    ? `${statusLabel('upcoming')} ${t('msg.dday', dday(p))}`
    : statusLabel(s);
  return el('span', 'tag ' + (s === 'ongoing' ? 'on' : s === 'upcoming' ? 'soon' : 'off'), text);
}

const PICKUP_COLS = [
  { str: 'col.no', cls: 'num' }, { str: 'col.period' }, { axis: 'status' },
  { str: 'col.name' }, { axis: 'corporation' }, { axis: 'element' }, { axis: 'class' },
  { axis: 'availability' }, { axis: 'tag' }, { str: 'f.rerun' },
];

function renderPickups() {
  const rows = filteredPickups().sort((a, b) => b._start - a._start);

  const head = $('#pickupHead');
  head.textContent = '';
  PICKUP_COLS.forEach(c => head.appendChild(el('th', c.cls || null, colLabel(c))));

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
    if (!n) tdName.appendChild(el('span', 'sub', ' ' + t('msg.unlisted')));
    tr.appendChild(tdName);

    tr.appendChild(iconCell('corporation', p.corporation,
      { overspec: p.corporation_sub_type === 'OVERSPEC' }));
    tr.appendChild(iconCell('element', p.element));
    tr.appendChild(iconCell('class', p.class));

    const tdA = el('td');
    if (p.availability) {
      tdA.appendChild(el('span', 'tag' + (p.availability === 'limited' ? ' lim' : ''),
        L('availability', p.availability)));
    } else tdA.textContent = '—';
    tr.appendChild(tdA);

    tr.appendChild(el('td', null, p.tag ? L('tag', p.tag) : '—'));
    tr.appendChild(el('td', null, p.rerun_of != null ? t('msg.rerunOf', p.rerun_of) : '—'));
    frag.appendChild(tr);
  }
  body.appendChild(frag);

  renderTimeline(rows);
  $('#pickupTableWrap').hidden = state.timeline;
  $('#timeline').hidden = !state.timeline;
  $('#pickupEmpty').hidden = rows.length > 0;
  $('#count').innerHTML = t('cnt.banners', rows.length, D.pickups.length);
}

function renderTimeline(rows) {
  const tl = $('#timeline');
  tl.textContent = '';
  let year = null;
  for (const p of rows) {
    const y = p._start.getFullYear();
    if (y !== year) { year = y; tl.appendChild(el('div', 'tl-year', t('msg.year', y))); }

    const n = p.rid ? byRid.get(p.rid) : null;
    const row = el('div', 'tl-row' + (statusOf(p) === 'ongoing' ? ' is-on' : ''));
    if (n) row.onclick = () => openSheet(n);

    row.appendChild(el('div', 'when', `${p.start.slice(5, 10)} ~ ${p.end.slice(5, 10)}`));
    const who = el('div', 'who');
    for (const [axis, code] of [['corporation', p.corporation], ['element', p.element], ['class', p.class]]) {
      const ic = iconEl(axis, code, { overspec: p.corporation_sub_type === 'OVERSPEC' });
      if (ic) who.appendChild(ic);
    }
    who.appendChild(el('span', null, n ? nameOf(n) : p.name_ko));
    if (p.availability === 'limited') who.appendChild(el('span', 'tag lim', L('availability', 'limited')));
    if (p.tag) who.appendChild(el('span', 'tag', L('tag', p.tag)));
    if (p.rerun_of != null) who.appendChild(el('span', 'tag', t('msg.rerunOf', p.rerun_of)));
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

  const ov = n.corporation_sub_type === 'OVERSPEC';
  const dl = el('dl', 'kv');
  const put = (k, v) => {
    dl.appendChild(el('dt', null, k));
    const dd = el('dd');
    dd.append(typeof v === 'string' ? v : v);
    dl.appendChild(dd);
  };
  const putIcon = (k, axis, code, extra) => {
    dl.appendChild(el('dt', null, k));
    const dd = el('dd');
    if (!code) dd.textContent = '—';
    else {
      dd.appendChild(labelWith(axis, code, L(axis, code) + (extra || ''), { overspec: ov, cls: 'ic-lg' }));
    }
    dl.appendChild(dd);
  };
  putIcon(axisLabel('rarity'), 'rarity', n.rarity);
  putIcon(axisLabel('corporation'), 'corporation', n.corporation,
    ov ? ` (${L('corporation_sub_type', 'OVERSPEC')})` : '');
  put(t('col.squad'), L('squad', n.squad));
  putIcon(axisLabel('element'), 'element', n.element);
  putIcon(axisLabel('class'), 'class', n.class);
  putIcon(axisLabel('weapon_type'), 'weapon_type', n.weapon_type);
  putIcon(axisLabel('burst'), 'burst', n.burst);
  put(t('col.release'), n.release_date || '—');
  c.appendChild(dl);

  if (n.aliases?.length) {
    c.appendChild(el('h4', null, t('sheet.aliases', n.aliases.length)));
    const box = el('div', 'aliases');
    for (const a of n.aliases) box.appendChild(el('span', 'alias', a));
    c.appendChild(box);
  }

  const hist = (pickupsByRid.get(n.rid) || []).slice().sort((a, b) => a._start - b._start);
  c.appendChild(el('h4', null, t('sheet.history', hist.length)));
  if (!hist.length) {
    c.appendChild(el('p', 'sub', t('msg.noPickup')));
  } else {
    const box = el('div', 'hist');
    for (const p of hist) {
      const it = el('div', 'hist-item');
      const left = el('div');
      left.appendChild(el('span', 'when', fmtRange(p)));
      const right = el('div');
      if (p.rerun_of != null) right.appendChild(el('span', 'tag', t('msg.rerunOf', p.rerun_of)));
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
    $('#count').innerHTML = t('cnt.both', ns.length, ps.length);
    renderStats($('#stats'), ns, ps,
      { L, t, axisLabel, statusLabel, lang: lang(), statusOf, AXES, ELEMENT_COLOR, byRid, iconEl });
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

  let fillSquads;   // 스쿼드 옵션 재생성 (아래에서 채워짐)

  /* index.html 의 data-i18n* 속성을 현재 언어로 채운다.
     텍스트는 data-i18n, 속성은 data-i18n-{placeholder,title,aria}. */
  const paintStatic = () => {
    $$('[data-i18n]').forEach(n => { n.textContent = t(n.dataset.i18n); });
    $$('[data-i18n-placeholder]').forEach(n => { n.placeholder = t(n.dataset.i18nPlaceholder); });
    $$('[data-i18n-title]').forEach(n => { n.title = t(n.dataset.i18nTitle); });
    $$('[data-i18n-aria]').forEach(n => { n.setAttribute('aria-label', t(n.dataset.i18nAria)); });
  };

  const paintLang = () => {
    $$('.langswitch button').forEach(x => x.classList.toggle('on', x.dataset.lang === state.lang));
    document.documentElement.lang = state.lang;
    document.title = t('app.title');
    paintStatic();
    $('#metaline').textContent = t('ui.meta', D.meta);
    paintTheme();
    fillSquads?.();
  };
  $$('.langswitch button').forEach(b => b.onclick = () => {
    state.lang = b.dataset.lang;
    localStorage.setItem('lang', state.lang);
    paintLang();
    buildChips();
    render();
  });
  paintLang();

  /* 테마 — 기본 라이트. <head> 인라인 스크립트가 이미 stamp 해 둔 값을 이어받는다. */
  function paintTheme() {
    const dark = document.documentElement.dataset.theme === 'dark';
    $('#themeIcon').textContent = dark ? '☀' : '☾';
    $('#theme').setAttribute('aria-pressed', dark);
    $('#theme').setAttribute('aria-label', t(dark ? 'ui.toLight' : 'ui.toDark'));
  }
  $('#theme').onclick = () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('theme', next);
    paintTheme();
    // 차트는 토큰을 JS 로 읽어 그리므로 테마가 바뀌면 다시 그려야 한다
    if (state.tab === 'stats') render();
  };
  paintTheme();

  let qTimer;
  $('#q').oninput = e => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => { state.q = e.target.value.trim(); render(); }, 150);
  };
  $('#q').value = state.q;

  const sq = $('#squad');
  const squadCodes = [...new Set(D.nikkes.map(n => n.squad).filter(Boolean))];
  fillSquads = () => {
    [...sq.querySelectorAll('option[value]:not([value=""])')].forEach(o => o.remove());
    squadCodes
      .slice()
      .sort((a, b) => L('squad', a).localeCompare(L('squad', b), state.lang))
      .forEach(code => {
        const o = el('option', null, L('squad', code));
        o.value = code;
        sq.appendChild(o);
      });
    sq.value = state.squad;
  };
  fillSquads();
  sq.onchange = () => { state.squad = sq.value; render(); };

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
    $('#q').value = ''; sq.value = '';
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
    box.innerHTML = `<strong>${t('err.title')}</strong><br>`
      + `<code>${String(err.message || err)}</code><br><br>${t('err.hint')}`;
    return;
  }
  $('#loading').hidden = true;
  $('#app').hidden = false;
  wire();
  buildChips();
  render();
})();
