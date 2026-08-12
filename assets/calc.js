/* 보정 전투력 계산기 탭.

   계산은 cp.js 가 전부 하고 여기는 입력 폼과 결과 표만 그린다.
   원본 스탯 표(data/raw/*.json)와 도메인 규칙(data/cp_rules.json)은
   이 탭을 처음 열 때만 받아온다 — syncro_stat 하나가 500KB라 첫 화면에
   같이 얹지 않는다. */

import { buildTables, compute, optionLabel, gradeLabel, tierLabel, K, SLOTS, TIERS } from './cp.js';
import { renderImport, OPTION_ALIAS } from './roster.js';

const NEED = ['syncro_stat', 'attraction_stat', 'attraction_grade', 'equip_stat',
  'equip_option', 'cube_stat', 'collection_stat', 'collection_bonus', 'cp_penalty'];
const STORE = 'cp.input';

/* 레벨이 고정되는 컨텐츠는 40(협동 작전)과 400(솔로 레이드·챔피언 아레나) 두 가지뿐이라
   그 두 레벨의 전투력만 보여준다. */
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
    if (saved && saved.rid && ctx.nikkes.some(n => n.rid === saved.rid)) return renameOptions(saved);
  } catch { /* 저장값이 깨졌으면 기본값으로 */ }
  return defaults();
}

/* 옛 약어로 저장된 폼 입력(크피·차뎀)을 지금 이름으로 눕힌다 — 그냥 두면 옵션
   셀렉트가 값을 못 찾아 조용히 '없음' 으로 떨어진다. roster.js 와 같은 표. */
function renameOptions(v) {
  for (const g of v.gear || []) {
    for (const o of g.options || []) if (OPTION_ALIAS[o.name]) o.name = OPTION_ALIAS[o.name];
  }
  return v;
}
const save = () => localStorage.setItem(STORE, JSON.stringify(input));

/* 선택한 니케의 고정 속성을 입력에 얹는다. 방어력 계열이 무기와 다른
   예외 니케(하란)는 cp_rules.json 의 override 를 쓴다. */
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
      v => set(() => {
        input.rid = v;
        // 니케가 바뀌면 적용되는 클래스·기업 연구 줄도 바뀐다
        applyResearch();
        importApi?.syncConsole();
      }))));
  row1.appendChild(field(t('cp.level'),
    number(input.level, T.levels[0], T.levels.at(-1), v => set(() => { input.level = v; })),
    t('cp.levelHint', T.levels.at(-1))));
  row1.appendChild(field(t('cp.grade'),
    select(T.grades.map(g => ({ value: g.key, label: gradeLabel(g.key, t) })), input.grade,
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

  /* 콘솔(리사이클 룸)은 니케마다 다시 고를 값이 아니라 계정 단위 값이라
     맨 위 계정 카드로 옮겼다 (roster.js). */

  // 장비 4부위
  const g5 = el('div', 'cp-group');
  g5.appendChild(el('h3', null, t('cp.gear')));
  // 기업 소속이 아닌 일반 T9 장비는 원본에 스탯 표가 없다 (DEVIATIONS.md)
  g5.appendChild(el('p', 'cp-note cp-warn', t('cp.gearLimit')));
  for (const g of input.gear) {
    const box = el('div', 'cp-gear');
    const head = el('div', 'cp-row');
    head.appendChild(field(t('cp.slot'), select(
      [{ value: '', label: t('cp.none') }, ...TIERS.map(x => ({ value: x, label: tierLabel(x, t) }))],
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

/* ── 한 단계당 전투력 증가 ─────────────────────────────────────
   "콘솔을 1레벨 더 올리면 얼마나 오르나"를 컨텐츠 레벨(40·400)에서 보여 준다.

   콘솔은 스탯에 더해진 뒤 코강 계수와 반올림을 거치므로 선형이 아니다 —
   그래서 1레벨 올린 입력으로 다시 계산해 차이를 낸다.
   오버로드 옵션은 (4)항의 계수에만 들어가서 정확히 선형이다:
     ΔCP = ((1)+(2)+(3)) × 계수 / 100.                            */
function marginRows(n, lv) {
  const base = compute(T, n, lv);
  if (!base) return null;
  const bump = kind => {
    const alt = { ...n, console: { ...n.console, [kind]: (n.console?.[kind] || 0) + 1 } };
    const r = compute(T, alt, lv);
    return r ? r.cp - base.cp : null;
  };
  const parts = base.parts.hp + base.parts.atk + base.parts.def;
  return {
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
  const lines = [
    [t('cp.console_공용'), r => r?.공용],
    [t('cp.console_클래스'), r => r?.클래스],
    [t('cp.console_기업'), r => r?.기업],
    [t('cp.marginElem'), r => r?.elem],
    [t('cp.marginOther'), r => r?.other],
  ];
  for (const [label, get] of lines) {
    const tr = el('tr');
    tr.appendChild(el('td', null, label));
    for (const r of per) {
      const v = get(r);
      tr.appendChild(el('td', 'num', v == null ? '—' : '+' + fmt(v)));
    }
    body.appendChild(tr);
  }
  tbl.appendChild(body);
  box.appendChild(scrollBox(tbl));
  box.appendChild(el('p', 'cp-note', t('cp.marginHint')));
  return box;
}

/* ── 오버로드 옵션 집계 ───────────────────────────────────────
   표시 수치는 **퍼센트포인트 정수**로 맞춘다. 원표(`equip_option.json`)는 분수
   소수점 넷째 자리(= 퍼센트 둘째 자리)까지 있으므로, 분수를 소수점 셋째 자리에서
   반올림해 둘째 자리로 만들면 퍼센트가 정수로 떨어진다. 0.2916 -> 0.29 -> 29%.

   같은 옵션이 여러 부위에 붙으면 합치는데, 반올림 지점이 둘로 갈린다:

     같은 옵션 · 같은 단계  -> 먼저 합산하고 반올림   round(단위값 × 개수)
     같은 옵션 · 다른 단계  -> 단계별로 반올림하고 합산

   차속 Lv.10(0.0463) 세 개면 앞 규칙으로 round(0.1389)=0.14 (14%) 이고,
   먼저 반올림했다면 0.05×3 = 0.15 (15%) 라 실제로 값이 달라진다.

   전투력에 들어가는 건 이 수치가 아니라 옵션 '단계 수'다 (cp.js 참고). */
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
    let total = 0, steps = 0, exact = 0;
    const parts = [];
    for (const [level, count] of [...levels].sort((a, b) => b[0] - a[0])) {
      const unit = T.optionValue.get(`${name}|${level}`) || 0;
      total += round2(unit * count);              // 같은 단계는 합산 후 반올림
      exact += unit * count;                      // 반올림 전 값 (hover 용)
      steps += level * count;
      parts.push(count > 1 ? `Lv.${level}×${count}` : `Lv.${level}`);
    }
    out.push({ name, total: round2(total), exact, steps, parts: parts.join(' + ') });
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
  /* 3행(부위별)과 같은 칩 모양으로 맞춘다. 어느 단계가 몇 개 붙어 나온 합인지는
     hover 로 — 상시로 펼치면 다섯 줄이 되어 카드가 세로로 길어진다. */
  const chips = el('div', 'cp-olChips');
  for (const o of totals) {
    const chip = el('span', 'cp-olChip is-total');
    chip.title = `${o.parts} · ${t('cp.olExact', pctExact(o.exact))}`;
    chip.appendChild(el('span', 'cp-olName', optionLabel(o.name, ctx.lang)));
    chip.appendChild(el('span', 'cp-olVal', pct(o.total)));
    chips.appendChild(chip);
  }
  box.appendChild(chips);
  return box;
}

/* 부위별 상세. 어느 장비에 무엇이 붙어 있는지 그대로 편다. */
function renderOverloadBySlot(n) {
  const box = el('div', 'cp-detailRow');
  box.appendChild(el('h4', 'cp-rowLbl', t('cp.olBySlot')));

  const ol = (n.gear || []).filter(g => g.tier === '오버로드' && g.options?.length);
  if (!ol.length) {
    box.appendChild(el('p', 'cp-note', t('cp.olNone')));
    return box;
  }
  /* 표로 짜면 칸 너비가 고정돼 좁은 오른쪽 단에서 가로로 넘친다.
     부위별 한 줄 + 옵션 칩이 줄바꿈하는 형태라야 어느 폭에서도 들어간다. */
  for (const slot of SLOTS) {
    const g = (n.gear || []).find(x => x.slot === slot);
    if (!g || g.tier !== '오버로드' || !g.options.length) continue;
    const line = el('div', 'cp-olSlotRow');
    line.appendChild(el('span', 'cp-olSlot', t('cp.slot_' + slot)));
    const chips = el('span', 'cp-olChips');
    /* 여기는 부위에 실제로 붙어 있는 값이라 원표 그대로 쓴다. 반올림은 인게임
       합산을 재현하는 2행(종합)에만 건다 — 부위별로 미리 반올림해 버리면
       차속 13단 두 개가 6%+6%=12% 로 보이는데 종합은 11% 라 산수가 어긋난다. */
    for (const o of g.options) {
      const raw = T.optionValue.get(`${o.name}|${o.level}`) || 0;
      const chip = el('span', 'cp-olChip');
      chip.appendChild(el('span', 'cp-olName', optionLabel(o.name, ctx.lang)));
      chip.appendChild(el('span', 'cp-olVal', pctExact(raw)));
      chip.title = `${optionLabel(o.name, ctx.lang)} Lv.${o.level}`;
      chips.appendChild(chip);
    }
    line.appendChild(chips);
    box.appendChild(line);
  }
  return box;
}

/* ── 상세정보 카드 ────────────────────────────────────────────
   1행 최종 전투력 3종(+편집) · 2행 오버로드 종합 · 3행 부위별 상세 ·
   4행 콘솔/옵션 1단계당 증가분.                                  */
function renderDetail(root, n, r) {
  const card = el('div', 'cp-detail');

  const head = el('div', 'cp-detailHead');
  const who = el('div', 'cp-detailWho');
  const nm = ctx.nameOf(n._nikke);
  const nameEl = el('span', 'cp-detailName', nm);
  const mark = ctx.overspecMark && ctx.overspecMark(n._nikke.corporation_sub_type);
  if (mark) nameEl.appendChild(mark);
  who.appendChild(nameEl);
  /* 목록에서는 속성·버스트만 아이콘으로 찍으므로, 나머지 축은 여기서 다 보여준다.
     글자 칩(화력형·SG·SSR…)은 EN/JA 에서 길어져 좁은 오른쪽 단을 밀어낸다. */
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
  who.appendChild(tags);
  head.appendChild(who);

  const edit = el('button', 'cp-editBtn', '✎');
  edit.type = 'button';
  edit.title = t('cp.edit');
  edit.setAttribute('aria-label', t('cp.edit'));
  edit.onclick = () => { modalOpen = true; paint(root); };
  head.appendChild(edit);
  card.appendChild(head);

  /* 1행 — 최종 전투력 3종 (현재 레벨 / Lv.40 / Lv.400).
     머리말 없이 숫자 셋만. 셋 다 같은 크기로 두고 현재 레벨만 색으로 구분한다. */
  const row1 = el('div', 'cp-detailRow');
  const cps = el('div', 'cp-cpRow');
  const cell = (label, value, big) => {
    const c = el('div', 'cp-cpCell' + (big ? ' is-now' : ''));
    c.appendChild(el('span', 'cp-cpLbl', label));
    c.appendChild(el('span', 'cp-cpNum', value));
    return c;
  };
  cps.appendChild(cell(t('cp.lv', r.level), fmt(r.cp), true));
  for (const lv of ADJ_LEVELS) {
    if (lv === r.level) continue;      // 현재 레벨이 40·400 이면 같은 값이 두 번 나온다
    const a = compute(T, n, lv);
    cps.appendChild(cell(t('cp.lv', lv), fmt(a ? a.cp : null)));
  }
  row1.appendChild(cps);
  card.appendChild(row1);

  card.appendChild(renderOverload(n));       // 2행
  card.appendChild(renderOverloadBySlot(n)); // 3행
  card.appendChild(renderMargin(n));         // 4행
  return card;
}

/* ── 입력 폼 팝업 ─────────────────────────────────────────────
   폼은 값이 바뀔 때마다 통째로 다시 그려지므로, 열려 있는 동안에는 paint 가
   모달까지 같이 다시 만든다. 열림 여부만 밖에 들고 있으면 된다. */
let modalOpen = false;

function renderModal(root) {
  const back = el('div', 'cp-modal');
  back.onclick = e => { if (e.target === back) close(); };
  back.onkeydown = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };

  const box = el('div', 'cp-modalBox');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.tabIndex = -1;
  queueMicrotask(() => box.focus());        // ESC 를 받으려면 안쪽에 초점이 있어야 한다

  const head = el('div', 'cp-modalHead');
  head.appendChild(el('h3', null, t('cp.editTitle')));
  const x = el('button', 'sheet-x', '×');
  x.type = 'button';
  x.setAttribute('aria-label', t('cp.done'));
  x.onclick = close;
  head.appendChild(x);
  box.appendChild(head);

  const body = el('div', 'cp-modalBody');
  body.appendChild(renderForm(root));
  box.appendChild(body);

  const foot = el('div', 'cp-modalFoot');
  const done = el('button', 'btn-reset', t('cp.done'));
  done.type = 'button';
  done.onclick = close;
  foot.appendChild(done);
  box.appendChild(foot);

  back.appendChild(box);
  return back;

  function close() { modalOpen = false; paint(root); }
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

  out.appendChild(renderDetail(root, n, r));

  // 스탯 3종 — 카드 하나 안에 세 칸 (라벨 위 / 숫자 아래)
  const stats = el('div', 'card cp-stats');
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

  return out;
}

/* 니케 하나 분의 입력을 받아 전투력을 계산한다 (roster.js 가 목록을 그릴 때 쓴다).
   폼과 같은 경로를 타야 결과가 어긋나지 않으므로 resolved() 를 그대로 태운다. */
const cpOf = (src, lv) => {
  const n = resolved(src);
  return n && compute(T, n, lv);
};

/* 불러오기 패널은 폼과 달리 입력할 때마다 다시 그리지 않는다. 다시 그리면 검색어가
   날아가고 보유 니케 전체 전투력을 매번 다시 계산하게 된다. 탭에 들어올 때(언어가
   바뀔 때 포함) 한 번 만들고, 이후 paint 는 같은 노드를 도로 붙이기만 한다. */
let importEl = null, importApi = null;
function importPanel(root) {
  if (!importEl) {
    importEl = el('div', 'cp-importWrap');
    importApi = renderImport(importEl, {
      t, L: ctx.L, lang: ctx.lang, nameOf: ctx.nameOf,
      iconEl: ctx.iconEl, overspecMark: ctx.overspecMark, nikkeMatcher: ctx.nikkeMatcher,
      nikkes: ctx.nikkes, byCode: byCode(),
      bondMax: T.bondMax, levels: ADJ_LEVELS, cpOf, cubes, olTotals: overloadTotals,
      research: () => research,
      setResearch: (kind, code, v) => { setResearch(kind, code, v); save(); paint(root); },
      applyResearch: fresh => { applyResearch(fresh); save(); },
      onPick: picked => { input = picked; save(); paint(root); },
    });
  }
  return importEl;
}

/* 왼쪽에 계정 카드 -> 니케 목록 -> 입력 폼을 쌓고, 오른쪽은 고른 니케의 결과만.
   목록이 열 열세 개라 왼쪽을 넓게 잡는다 (비율은 style.css). */
function paint(root) {
  root.textContent = '';
  const wrap = el('div', 'cp-wrap');
  const left = el('div', 'cp-left');
  left.appendChild(importPanel(root));
  wrap.appendChild(left);
  wrap.appendChild(renderResult(root));
  root.appendChild(wrap);
  if (modalOpen) root.appendChild(renderModal(root));
}

/* 불러온 계정의 리사이클 룸 연구 레벨을, 지금 고른 니케의 클래스·기업에 맞춰
   콘솔 입력에 얹는다. 니케를 바꿀 때마다 해당하는 연구 줄이 달라진다. */
/* 리사이클 룸 연구 레벨은 계정 단위 값이라 니케 입력(cp.input)과 따로 둔다.
   계정 카드의 아홉 칸이 이걸 직접 고치고, 계산기는 고른 니케의 클래스·기업에
   해당하는 줄만 뽑아 input.console 에 얹는다. */
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

function setResearch(kind, code, v) {
  if (kind === 'common') research.common = v;
  else research[kind][code] = v;
  saveResearch();
  applyResearch();
}

/* 게임 API 는 니케를 name_code 로 부른다. data/nikkes.json 의 같은 이름 필드가
   유일한 연결 고리다 (없는 니케는 roster.js 가 건너뛴다). */
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
  modalOpen = false;
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
