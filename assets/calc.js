/* 보정 전투력 계산기 탭.

   계산은 cp.js 가 전부 하고 여기는 결과 표만 그린다. 입력은 손으로 넣지 않고 불러온 계정(roster.js)에서 온다.
   원본 스탯표(data/raw/*.json)와 도메인 규칙(data/cp_rules.json)은 이 탭을 처음 열 때만 받아온다
   — syncro_stat 하나가 500KB라 첫 화면에 같이 얹지 않는다. */

import { buildTables, compute, optionLabel, optionFullLabel, tierLabel,
  K, SLOTS } from './cp.js';
import { renderImport, OPTION_ALIAS, CHIP_AXES, badge, gradeBadge, collBadge, bondBadge,
  cubeBadge } from './roster.js';

const NEED = ['syncro_stat', 'attraction_stat', 'attraction_grade', 'equip_stat',
  'equip_option', 'cube_stat', 'collection_stat', 'collection_bonus', 'cp_penalty'];
const STORE = 'cp.input';

/* 레벨이 고정되는 컨텐츠는 40(협동 작전)과 400(솔로 레이드·챔피언 아레나) 두 가지뿐이라 그 두 레벨의 전투력만 보여준다. */
const ADJ_LEVELS = [40, 400];

let ctx = null, T = null, rules = null, cubes = null, base = './data/';
let input = null;

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const t = (k, ...a) => ctx.t(k, ...a);
const fmt = v => v == null ? '—' : Math.round(v).toLocaleString();

/* data/cubes.json 은 이름을 세 언어로 들고 있지만 약칭·효과는 우리가 붙인 문구라 ko/en 만 있다. */
function cubeInfo(tid) {
  const c = tid != null && cubes ? cubes[String(tid)] : null;
  return c ? { ...c.ko, ...c.en, ...c[ctx.lang] } : null;
}

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

  const [r, c, ...tables] = await Promise.all([
    fetchJSON(base + 'cp_rules.json'),
    // 큐브 이름은 표시용이라, 없으면 레벨만 보여주고 계속 간다 (구 배포본 대비)
    fetchJSON(base + 'cubes.json').catch(() => null),
    ...NEED.map(k => fetchJSON(`${base}raw/${k}.json`)),
  ]);
  rules = r;
  cubes = (c && c.cubes) || {};
  T = buildTables(Object.fromEntries(NEED.map((k, i) => [k, tables[i]])));
}

/* ── 등급별 돌파 한계 ──────────────────────────────────────────
   attraction_grade 표는 SSR 기준이라 0돌~3돌·1~7코강을 전부 담고 있지만, 실제로 갈 수 있는 데까지는 니케 등급이 가른다
   — SR 은 2돌에서 끝나고, R 은 돌파 자체가 없으며, 코어강화는 SSR 전용이다 (data/cp_rules.json 의 limit_break). */
const limits = rarity => (rules.limit_break || {})[rarity] || { break: 3, core: 7 };
const gradesFor = rarity => {
  const lim = limits(rarity);
  return T.grades.filter(g => g.breaks <= lim.break && g.cores <= lim.core);
};
/* 못 가는 등급이 입력에 남아 있으면(SR 로 바꿨는데 7코강) 갈 수 있는 가장 높은 단계로 내린다 — 셀렉트에 없는 값이
   남으면 칸이 통째로 비어 보이고, 계산은 그 니케가 도달할 수 없는 전투력을 낸다. */
function clampGrade(grade, rarity) {
  const ok = gradesFor(rarity);
  if (ok.some(g => g.key === grade)) return grade;
  return ok.length ? ok.at(-1).key : T.grades[0].key;
}

/* ── 입력 기본값 ───────────────────────────────────────────── */
function defaults() {
  const n = ctx.nikkes.find(x => x.rid === 'c010') || ctx.nikkes[0];
  return {
    rid: n.rid,
    level: 400,
    grade: clampGrade(T.grades.at(-1)?.key || '0돌', n.rarity),
    bond: T.bondMax,
    skills: { s1: 10, s2: 10, burst: 10 },
    cube: '미착용',
    cubeTid: null,          // 표시 전용 — 계수는 레벨만 본다
    collection: { kind: 'none', level: '0' },
    console: { 공용: 0, 클래스: 0, 기업: 0 },
    gear: SLOTS.map(slot => ({ slot, tier: '', enhance: 0, options: [] })),
  };
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE));
    if (saved && saved.rid && ctx.nikkes.some(n => n.rid === saved.rid)) return adopt(saved);
  } catch { /* 저장값이 깨졌으면 기본값으로 */ }
  return defaults();
}

/* 밖에서 들어온 입력(저장값·목록에서 고른 니케)을 지금 규칙에 맞춘다. */
const adopt = v => {
  const r = renameOptions(v);
  r.grade = clampGrade(r.grade, ctx.byRid.get(r.rid)?.rarity);
  return r;
};

/* 옛 약어로 저장된 폼 입력(크피·차뎀)을 지금 이름으로 눕힌다 — 그냥 두면 옵션 셀렉트가 값을 못 찾아 조용히 '없음'으로 떨어진다. */
function renameOptions(v) {
  for (const g of v.gear || []) {
    for (const o of g.options || []) if (OPTION_ALIAS[o.name]) o.name = OPTION_ALIAS[o.name];
  }
  return v;
}
const save = () => localStorage.setItem(STORE, JSON.stringify(input));

/* 선택한 니케의 고정 속성을 입력에 얹는다. */
function resolved(src = input) {
  const n = ctx.byRid.get(src.rid);
  if (!n) return null;
  return {
    ...src,
    rarity: n.rarity, class: n.class, corporation: n.corporation,
    weapon: n.weapon_type,
    defWeapon: rules.def_weapon_override?.[n.rid] || n.weapon_type,
    _nikke: n,
  };
}

/* ── 한 단계당 전투력 증가 ─────────────────────────────────────
   "콘솔을 1레벨 더 올리면 얼마나 오르나"를 컨텐츠 레벨(40·400)에서 보여 준다. */
function marginRows(n, lv) {
  const base = compute(T, n, lv);
  if (!base) return null;
  const bump = kind => {
    const alt = { ...n, console: { ...n.console, [kind]: (n.console?.[kind] || 0) + 1 } };
    const r = compute(T, alt, lv);
    return r ? r.cp - base.cp : null;
  };
  const lim = limits(n.rarity);
  const bumpGrade = kind => {
    const g = T.grades.find(x => x.key === n.grade) || T.grades[0];
    // 코강은 그 등급에 있고(SSR 만) 최대 돌파를 찍은 뒤에야 열린다
    if (kind === 'core' && (!lim.core || g.breaks < lim.break)) return null;
    if (kind === 'break' ? g.breaks >= lim.break : g.cores >= lim.core) return 0;
    const next = T.grades.find(x => (kind === 'break'
      ? x.breaks === g.breaks + 1 && x.cores === g.cores
      : x.breaks === g.breaks && x.cores === g.cores + 1));
    if (!next) return null;
    const r = compute(T, { ...n, grade: next.key }, lv);
    return r ? r.cp - base.cp : null;
  };
  const parts = base.parts.hp + base.parts.atk + base.parts.def;
  return {
    brk: bumpGrade('break'), core: bumpGrade('core'),
    공용: bump('공용'), 클래스: bump('클래스'), 기업: bump('기업'),
    elem: parts * K.ELEM_DMG / 100,
    other: parts * K.OTHER_OPT / 100,
  };
}

function renderMargin(n) {
  const box = el('div', 'cp-detailRow');
  box.appendChild(el('h4', 'cp-rowLbl', t('cp.margin')));

  const per = ADJ_LEVELS.map(lv => marginRows(n, lv));
  const tbl = el('table', 'grid cp-marginTbl');
  const thead = el('thead'), hr = el('tr');
  hr.appendChild(el('th', null, t('cp.marginWhat')));
  for (const lv of ADJ_LEVELS) hr.appendChild(el('th', 'num', t('cp.lv', lv)));
  thead.appendChild(hr);
  tbl.appendChild(thead);

  const body = el('tbody');
  /* 돌파·코강을 맨 위에 둔다 — 여기서 붙는 전투력이 콘솔·옵션보다 한 자리 크다. */
  const lim = limits(n.rarity);
  const lines = [
    [t('cp.marginBreak'), r => r?.brk,
      lim.break ? t('cp.marginMaxed') : t('cp.marginNoBreak'), null],
    [t('cp.marginCore'), r => r?.core, t('cp.marginMaxed'),
      lim.core ? t('cp.marginLocked') : t('cp.marginNoCore')],
    [t('cp.console_공용'), r => r?.공용],
    [t('cp.console_클래스'), r => r?.클래스],
    [t('cp.console_기업'), r => r?.기업],
    [t('cp.marginElem'), r => r?.elem],
    [t('cp.marginOther'), r => r?.other],
  ];
  for (const [label, get, whyZero, whyNone] of lines) {
    const tr = el('tr');
    tr.appendChild(el('td', null, label));
    for (const r of per) {
      const v = get(r);
      /* 0 은 '못 구했다'가 아니라 '더 올릴 수 없다'는 뜻이라 '+0' 이 아닌 '0' 으로 쓴다. */
      const td = el('td', 'num', v == null ? '—' : v ? '+' + fmt(v) : '0');
      const why = v == null ? whyNone : v ? null : whyZero;
      if (why) td.title = why;
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }
  tbl.appendChild(body);
  box.appendChild(scrollBox(tbl));
  box.appendChild(el('p', 'cp-note', t('cp.marginHint')));
  return box;
}

/* ── 오버로드 옵션 집계 ───────────────────────────────────────
   표시 수치는 **퍼센트포인트 정수**로 맞춘다. */
/* 옵션 단계를 인게임과 같은 색으로. */
const olLevelCls = lv => (lv >= 15 ? ' is-lv15' : lv >= 12 ? ' is-lv12' : '');

const round2 = v => Math.round(v * 100) / 100;   // 분수 2자리 = 퍼센트 정수
const pct = v => Math.round(v * 100) + '%';
/* hover 로는 원표 값을 그대로 보여준다 — 반올림 때문에 잃는 정보가 없게. */
const pctExact = v => (v * 100).toFixed(2) + '%';

function overloadTotals(gear) {
  const byName = new Map();                       // 이름 -> Map(단계 -> 개수)
  for (const g of gear || []) {
    if (g.tier !== '오버로드') continue;
    for (const o of g.options || []) {
      if (!o.name || !o.level) continue;
      if (!byName.has(o.name)) byName.set(o.name, new Map());
      const lv = byName.get(o.name);
      lv.set(o.level, (lv.get(o.level) || 0) + 1);
    }
  }

  const out = [];
  for (const [name, levels] of byName) {
    let total = 0, steps = 0, exact = 0, top = 0, count_ = 0;
    const parts = [];
    for (const [level, count] of [...levels].sort((a, b) => b[0] - a[0])) {
      const unit = T.optionValue.get(`${name}|${level}`) || 0;
      total += round2(unit * count);              // 같은 단계는 합산 후 반올림
      exact += unit * count;                      // 반올림 전 값 (hover 용)
      steps += level * count;
      top = Math.max(top, level);                 // 칩 색을 정하는 단계
      count_ += count;
      parts.push(count > 1 ? `Lv.${level}×${count}` : `Lv.${level}`);
    }
    out.push({ name, total: round2(total), exact, steps, top, count: count_,
      parts: parts.join(' + ') });
  }
  return out.sort((a, b) => b.steps - a.steps);
}

function renderOverload(n) {
  const box = el('div', 'cp-detailRow');
  box.appendChild(el('h4', 'cp-rowLbl', t('cp.olTotal')));
  const totals = overloadTotals(n.gear);
  if (!totals.length) {
    box.appendChild(el('p', 'cp-note', t('cp.olNone')));
    return box;
  }
  /* 인게임 옵션 창처럼 한 줄에 하나씩 — 왼쪽에 [정식 명칭], 오른쪽에 합계. */
  const list = el('div', 'cp-olList');
  for (const o of totals) {
    const row = el('div', 'cp-olRow' + olLevelCls(o.top));
    row.title = `${o.parts} · ${t('cp.olExact', pctExact(o.exact))}`;
    const name = el('span', 'cp-olName', `[${optionFullLabel(o.name, ctx.lang)}]`);
    // 몇 부위에 붙어 나온 합인지 — 같은 %라도 한 부위에 몰린 것과 다르다
    if (o.count > 1) name.appendChild(el('span', 'cp-olCount', ' ×' + o.count));
    row.append(name, el('span', 'cp-olVal', pct(o.total)));
    list.appendChild(row);
  }
  box.appendChild(list);
  return box;
}

/* ── 옵션작 탭으로 넘기기 ─────────────────────────────────────
   니파고(옵션작) 탭은 장비 한 부위를 굴리는 시뮬레이터라 슬롯이 셋뿐이다. */
function simButton(n) {
  const ol = SLOTS.map(slot => (n.gear || []).find(g => g.slot === slot))
    .filter(g => g && g.tier === '오버로드' && g.options?.length);

  const btn = el('button', 'cp-simBtn', t('cp.olSim'));
  btn.type = 'button';
  btn.title = t('cp.olSimHint');
  btn.disabled = !ol.length || !ctx.goTab;
  if (btn.disabled) return btn;

  const go = g => {
    closeTip();
    /* 니파고는 계산기와 따로 불러오는 모듈이라 여기서 직접 집어넣는다. */
    import('./nipago.js')
      .then(m => m.seedSlots(g.options))
      .finally(() => ctx.goTab('nipago'));
  };

  btn.setAttribute('aria-expanded', 'false');
  btn.onclick = () => {
    if (ol.length === 1) return go(ol[0]);
    const menu = el('div', 'cp-simMenu');
    menu.appendChild(el('p', 'cp-simHint', t('cp.olSimPick')));
    for (const g of ol) {
      const item = el('button', 'cp-simItem');
      item.type = 'button';
      item.appendChild(el('span', 'cp-simSlot', t('cp.slot_' + g.slot)));
      const opts = el('span', 'cp-simOpts');
      for (const o of g.options) {
        opts.appendChild(el('span', 'cp-olCell' + olLevelCls(o.level),
          `[${optionLabel(o.name, ctx.lang)}] ${o.level}`));
      }
      item.appendChild(opts);
      item.onclick = () => go(g);
      menu.appendChild(item);
    }
    openTip(btn, t('cp.olSim'), menu);
  };
  return btn;
}

/* 부위별 상세. 어느 장비에 무엇이 붙어 있는지 그대로 편다. */
function renderOverloadBySlot(n) {
  const box = el('div', 'cp-detailRow');
  const head = el('div', 'cp-rowHead');
  head.append(el('h4', 'cp-rowLbl', t('cp.olBySlot')), simButton(n));
  box.appendChild(head);

  const ol = (n.gear || []).filter(g => g.tier === '오버로드' && g.options?.length);
  if (!ol.length) {
    box.appendChild(el('p', 'cp-note', t('cp.olNone')));
    return box;
  }
  /* 인게임 옵션 창과 같은 배치 — 부위가 열, 옵션 칸이 행(오버로드는 부위마다 최대 3개). */
  const grid = el('div', 'cp-olGrid');
  SLOTS.forEach((slot, col) => {
    const g = (n.gear || []).find(x => x.slot === slot);
    const head = el('div', 'cp-olHead', t('cp.slot_' + slot));
    head.style.gridColumn = col + 1;
    head.style.gridRow = 1;
    grid.appendChild(head);

    // 오버로드가 아니면 옵션 자리 자체가 없다 — 무엇을 끼고 있는지만 알린다
    if (!g || g.tier !== '오버로드') {
      const cell = el('div', 'cp-olCell is-off', g && g.tier ? tierLabel(g.tier, t) : t('cp.none'));
      cell.style.gridColumn = col + 1;
      cell.style.gridRow = '2 / span 3';
      grid.appendChild(cell);
      return;
    }
    /* 여기는 부위에 실제로 붙어 있는 값이라 원표 그대로 쓴다. */
    for (let i = 0; i < 3; i++) {
      const o = g.options[i];
      const cell = el('div', 'cp-olCell' + (o ? olLevelCls(o.level) : ' is-empty'));
      cell.style.gridColumn = col + 1;
      cell.style.gridRow = i + 2;
      if (o) {
        const raw = T.optionValue.get(`${o.name}|${o.level}`) || 0;
        cell.append(el('span', 'cp-olName', `[${optionLabel(o.name, ctx.lang)}]`),
          el('span', 'cp-olVal', pctExact(raw)));
        cell.title = `${optionFullLabel(o.name, ctx.lang)} Lv.${o.level}`;
      } else {
        cell.textContent = t('cp.olNoEffect');
      }
      grid.appendChild(cell);
    }
  });
  box.appendChild(grid);
  return box;
}

/* 부위별 칸이 한 줄에 들어가는지는 언어와 화면 폭이 가른다 — 한국어 약어는 두 글자라 '[공증] 9.70%' 가 그대로 들어가지만 'Crit.Rate' 는 못 들어간다. */
function fitOlGrid(root) {
  for (const grid of root.querySelectorAll('.cp-olGrid')) {
    grid.classList.remove('is-stacked');
    const tight = [...grid.querySelectorAll('.cp-olName')]
      .some(n => n.scrollWidth > n.clientWidth + 1);
    grid.classList.toggle('is-stacked', tight);
  }
}

/* ── 눌러서 여는 상자 ─────────────────────────────────────────
   상세 카드에서 두 군데가 쓴다 — 전투력 숫자의 계산식, 그리고 옵션 시뮬레이션의 부위 고르기. */
let tipState = null;

function closeTip() {
  if (!tipState) return;
  tipState.node.remove();
  tipState.anchor.setAttribute('aria-expanded', 'false');
  removeEventListener('keydown', tipState.onKey, true);
  removeEventListener('pointerdown', tipState.onOut, true);
  removeEventListener('resize', closeTip);
  removeEventListener('scroll', closeTip, true);
  tipState = null;
}

function openTip(anchor, title, body) {
  const same = tipState && tipState.anchor === anchor;
  closeTip();
  if (same) return;                       // 같은 숫자를 다시 누르면 닫힌다

  const node = el('div', 'cp-tip');
  node.setAttribute('role', 'dialog');
  const head = el('div', 'cp-tipHead');
  head.appendChild(el('span', 'cp-tipTitle', title));
  const x = el('button', 'cp-tipX', '×');
  x.type = 'button';
  x.setAttribute('aria-label', t('cp.close'));
  x.onclick = closeTip;
  head.appendChild(x);
  node.append(head, body);
  document.body.appendChild(node);

  /* 눌린 숫자 바로 아래에 왼쪽을 맞춰 놓고, 화면 밖으로 나가면 안쪽으로 당긴다. */
  const a = anchor.getBoundingClientRect();
  const b = node.getBoundingClientRect();
  const x0 = Math.max(8, Math.min(a.left, innerWidth - b.width - 8));
  const below = a.bottom + 8;
  const y0 = below + b.height > innerHeight - 8 && a.top - b.height - 8 > 8
    ? a.top - b.height - 8 : Math.min(below, Math.max(8, innerHeight - b.height - 8));
  node.style.left = x0 + 'px';
  node.style.top = y0 + 'px';

  anchor.setAttribute('aria-expanded', 'true');
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); closeTip(); anchor.focus(); } };
  const onOut = e => { if (!node.contains(e.target) && e.target !== anchor) closeTip(); };
  tipState = { node, anchor, onKey, onOut };
  addEventListener('keydown', onKey, true);
  addEventListener('pointerdown', onOut, true);
  addEventListener('resize', closeTip);
  addEventListener('scroll', closeTip, true);
}

/* 툴팁 속 내용 — 스탯 3종 + 계산 분해. */
function cpBreakdown(r) {
  const box = el('div', 'cp-tipBody');

  const stats = el('div', 'cp-stats');
  for (const [k, lab] of [['hp', 'HP'], ['atk', t('cp.atk')], ['def', t('cp.def')]]) {
    const c = el('div', 'cp-stat');
    c.appendChild(el('span', 'cp-statLbl', lab));
    c.appendChild(el('span', 'cp-statNum', fmt(r.stats[k])));
    stats.appendChild(c);
  }
  box.appendChild(stats);

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
  box.appendChild(scrollBox(tb));
  box.appendChild(el('p', 'cp-note', t('cp.breakHint', r.skillCoef.toFixed(2), r.elemDmg, r.other)));
  return box;
}

/* ── 키운 상태 배지 ──────────────────────────────────────────
   돌파·소장품·호감도·큐브는 전투력을 크게 가르는 값이다. */
function growthBadges(n) {
  const out = [];
  const named = (node, label) => {
    if (!node) return;
    node.title = `${label} — ${node.title}`;
    out.push(node);
  };
  named(gradeBadge(n.grade, t), t('cp.grade'));

  const c = n.collection || { kind: 'none' };
  const coll = collBadge(c, t);
  // 미착용은 감추지 않고 회색 자리로 남긴다 — 없는 것과 안 보여 준 것은 다르다
  named(coll || badge('is-round is-none', '–', t('cp.none')), t('cp.collection'));

  named(bondBadge(n.bond, t), t('cp.bond'));

  const cube = cubeBadge({ tid: n.cubeTid, level: n.cube === '미착용' ? 0 : n.cube },
    cubeInfo(n.cubeTid), ctx.iconEl);
  if (cube) {
    named(cube, t('cp.cube'));
  } else {
    const off = el('span', 'cp-cubeBadge is-off', '–');
    off.title = `${t('cp.cube')} — ${t('cp.none')}`;
    out.push(off);
  }
  return out;
}

/* ── 상세정보 카드 ────────────────────────────────────────────
   1행 최종 전투력 3종 · 2행 오버로드 종합 · 3행 부위별 상세 · 4행 콘솔/옵션 1단계당 증가분. */
function renderDetail(root, n, r) {
  const card = el('div', 'cp-detail');

  const head = el('div', 'cp-detailHead');
  const who = el('div', 'cp-detailWho');
  const nm = ctx.nameOf(n._nikke);
  const nameEl = el('span', 'cp-detailName', nm);
  const mark = ctx.overspecMark && ctx.overspecMark(n._nikke.corporation_sub_type);
  if (mark) nameEl.appendChild(mark);
  who.appendChild(nameEl);
  /* 목록에서는 속성·버스트만 아이콘으로 찍으므로, 나머지 축은 여기서 다 보여준다. */
  const tags = el('div', 'cp-tags');
  const src = n._nikke;
  const axes = [['rarity', n.rarity], ['corporation', n.corporation], ['element', src.element],
    ['class', n.class], ['weapon_type', n.weapon], ['burst', src.burst]];
  for (const [axis, code] of axes) {
    if (!code) continue;
    const ic = ctx.iconEl(axis, code);
    if (ic) { ic.title = ctx.L(axis, code); tags.appendChild(ic); }
    else tags.appendChild(el('span', 'cp-tag', ctx.L(axis, code)));
  }
  if (n.defWeapon !== n.weapon) {
    tags.appendChild(el('span', 'cp-tag cp-tag-warn', t('cp.defOverride', n.defWeapon)));
  }
  /* 고정된 축과 키운 상태 사이에 선 하나. */
  tags.appendChild(el('span', 'cp-tagSep'));
  for (const b of growthBadges(n)) tags.appendChild(b);
  who.appendChild(tags);
  head.appendChild(who);

  card.appendChild(head);

  /* 1행 — 최종 전투력 3종 (현재 레벨 / Lv.40 / Lv.400). */
  const row1 = el('div', 'cp-detailRow');
  const cps = el('div', 'cp-cpRow');
  const cell = (label, res, big) => {
    const c = el('div', 'cp-cpCell' + (big ? ' is-now' : ''));
    c.appendChild(el('span', 'cp-cpLbl', label));
    const btn = el('button', 'cp-cpNum', fmt(res ? res.cp : null));
    btn.type = 'button';
    if (res) {
      btn.title = t('cp.cpTipHint');
      btn.setAttribute('aria-expanded', 'false');
      btn.onclick = () => openTip(btn, `${label} · ${t('cp.cp')}`, cpBreakdown(res));
    } else {
      btn.disabled = true;
    }
    c.appendChild(btn);
    return c;
  };
  cps.appendChild(cell(t('cp.lv', r.level), r, true));
  for (const lv of ADJ_LEVELS) {
    if (lv === r.level) continue;      // 현재 레벨이 40·400 이면 같은 값이 두 번 나온다
    cps.appendChild(cell(t('cp.lv', lv), compute(T, n, lv)));
  }
  row1.appendChild(cps);
  card.appendChild(row1);

  card.appendChild(renderOverload(n));       // 2행
  card.appendChild(renderOverloadBySlot(n)); // 3행
  card.appendChild(renderMargin(n));         // 4행
  return card;
}

/* ── 지휘관 정보 ──────────────────────────────────────────────
   싱크로 레벨과 콘솔(리사이클 룸) 아홉 칸은 니케가 아니라 계정에 붙는 값이다. */
function renderCommander(n) {
  const box = el('section', 'cp-cmdr');
  const acc = importApi && importApi.account();

  const cell = (name, axis, code, value, on) => {
    const c = el('span', 'cp-cmdrCell' + (on ? ' is-on' : ''));
    c.title = t('cp.consoleOf', name);
    const ic = axis && ctx.iconEl(axis, code);
    c.appendChild(ic || el('span', 'cp-cmdrName', name));
    c.appendChild(el('b', null, String(value || 0)));
    return c;
  };
  const line = axis => {
    const row = el('div', 'cp-cmdrRow');
    for (const code of CHIP_AXES[axis]) {
      row.appendChild(cell(ctx.L(axis, code), axis, code, research[axis][code], n && n[axis] === code));
    }
    return row;
  };

  const row1 = line('class');
  const sync = el('span', 'cp-fact');
  sync.appendChild(el('span', 'cp-factLbl', t('im.synchro')));
  sync.appendChild(el('span', 'cp-factVal',
    acc && acc.synchro_level ? String(acc.synchro_level) : '—'));
  row1.prepend(sync, el('span', 'cp-tagSep'),
    cell(t('cp.console_공용'), null, null, research.common, true));
  box.appendChild(row1);
  box.appendChild(line('corporation'));
  return box;
}

/* ── 결과 ─────────────────────────────────────────────────── */
function renderResult(root) {
  const out = el('div', 'cp-out');
  const n = resolved();
  out.appendChild(renderCommander(n));
  const r = n && compute(T, n);
  if (!r) {
    out.appendChild(el('p', 'notice notice-error', t('cp.noBase')));
    return out;
  }

  /* 스탯 3종과 계산 분해는 여기 카드로 있었지만, 늘 보고 있을 값이 아니라 전투력 숫자를 눌렀을 때 뜨는 툴팁으로 옮겼다 (cpBreakdown). */
  out.appendChild(renderDetail(root, n, r));
  return out;
}

/* 니케 하나 분의 입력을 받아 전투력을 계산한다 (roster.js 가 목록을 그릴 때 쓴다). */
const cpOf = (src, lv) => {
  const n = resolved(src);
  return n && compute(T, n, lv);
};

/* 불러오기 패널은 폼과 달리 입력할 때마다 다시 그리지 않는다. */
let importEl = null, importApi = null;
function importPanel(root) {
  if (!importEl) {
    importEl = el('div', 'cp-importWrap');
    importApi = renderImport(importEl, {
      t, L: ctx.L, lang: ctx.lang, nameOf: ctx.nameOf,
      iconEl: ctx.iconEl, overspecMark: ctx.overspecMark, nikkeMatcher: ctx.nikkeMatcher,
      nikkes: ctx.nikkes, byCode: byCode(),
      bondMax: T.bondMax, levels: ADJ_LEVELS, cpOf, cubes, olTotals: overloadTotals,
      applyResearch: fresh => { applyResearch(fresh); save(); },
      // 계정이 갈리면 지휘관 줄(싱크로·콘솔)도 갈아 끼워야 한다
      onAccount: () => paint(root),
      onPick: picked => { input = adopt(picked); save(); paint(root); reveal(root); },
    });
  }
  return importEl;
}

/* 한 단으로 접히는 폭(모바일)에서는 목록과 결과가 위아래로 떨어져 있다. */
const NARROW = '(max-width: 1125px)';
function reveal(root) {
  if (!matchMedia(NARROW).matches) return;
  const card = root.querySelector('.cp-out');
  if (!card) return;
  card.scrollIntoView({
    block: 'start',
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
  });
}

/* 왼쪽에 계정 줄 -> 니케 목록, 오른쪽에 지휘관 줄 -> 고른 니케의 결과. */
function paint(root) {
  /* 툴팁은 body 에 붙어 있어 root 를 비워도 남는다. */
  closeTip();
  /* 목록을 떼었다 붙이면 스크롤이 맨 위로 튄다 (니케를 고를 때마다 목록이 처음으로 돌아간다).
     이미 붙어 있으면 그대로 두고 결과 칸만 갈아 끼운다. */
  let wrap = root.querySelector('.cp-wrap');
  if (wrap && importEl && wrap.contains(importEl)) {
    wrap.querySelector('.cp-out').replaceWith(renderResult(root));
  } else {
    root.textContent = '';
    wrap = el('div', 'cp-wrap');
    const left = el('div', 'cp-left');
    left.appendChild(importPanel(root));
    wrap.appendChild(left);
    wrap.appendChild(renderResult(root));
    root.appendChild(wrap);
  }
  /* 한 단으로 접혔을 때 결과를 목록 위로 올릴지 (style.css). */
  wrap.classList.toggle('has-roster', !!(importApi && importApi.account()));

  fitOlGrid(root);
  // 폰트가 늦게 오면 글자 폭이 달라진다 — 오고 나서 한 번 더 잰다
  if (document.fonts?.ready) document.fonts.ready.then(() => fitOlGrid(root));
  /* 칸 폭은 창 크기를 따라가므로 (한 단 배치로 접히면 카드가 넓어진다) 다시 잰다. */
  mounted = root;
  if (!fitBound) {
    fitBound = true;
    addEventListener('resize', () => { if (mounted) fitOlGrid(mounted); });
  }
}
let mounted = null, fitBound = false;

/* 리사이클 룸 연구(콘솔) 레벨은 계정 단위 값이라 니케 입력(cp.input)과 따로 둔다. */
const RESEARCH_STORE = 'cp.research';
let research = loadResearch();

function loadResearch() {
  try {
    const s = JSON.parse(localStorage.getItem(RESEARCH_STORE));
    if (s && s.class && s.corporation) return s;
  } catch { /* 깨졌으면 빈 값으로 */ }
  return { common: 0, class: {}, corporation: {} };
}
const saveResearch = () => {
  try { localStorage.setItem(RESEARCH_STORE, JSON.stringify(research)); } catch { /* 무시 */ }
};

function applyResearch(fresh) {
  if (fresh) { research = fresh; saveResearch(); }
  const n = ctx.byRid.get(input.rid);
  if (!n) return;
  input.console = {
    공용: research.common || 0,
    클래스: research.class[n.class] || 0,
    기업: research.corporation[n.corporation] || 0,
  };
}

/* 게임 API 는 니케를 name_code 로 부른다. */
let codeMap = null;
function byCode() {
  if (!codeMap) {
    codeMap = new Map();
    for (const n of ctx.nikkes) if (n.name_code) codeMap.set(n.name_code, n);
  }
  return codeMap;
}

/* app.js 가 부르는 유일한 진입점 */
export async function renderCalc(root, context) {
  ctx = context;
  importEl = null;          // 언어가 바뀌면 라벨을 다시 만들어야 한다
  importApi = null;
  codeMap = null;
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
