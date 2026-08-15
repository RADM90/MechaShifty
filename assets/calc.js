/* 보정 전투력 계산기 탭.

   계산은 cp.js 가 전부 하고 여기는 결과 표만 그린다. 입력은 손으로 넣지 않고
   불러온 계정(roster.js)에서 온다.
   원본 스탯 표(data/raw/*.json)와 도메인 규칙(data/cp_rules.json)은
   이 탭을 처음 열 때만 받아온다 — syncro_stat 하나가 500KB라 첫 화면에
   같이 얹지 않는다. */

import { buildTables, compute, optionLabel, optionFullLabel, tierLabel,
  K, SLOTS } from './cp.js';
import { renderImport, OPTION_ALIAS, CHIP_AXES, badge, gradeBadge, collBadge, bondBadge,
  cubeBadge } from './roster.js';

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

/* data/cubes.json 은 이름을 세 언어로 들고 있지만 약칭·효과는 우리가 붙인 문구라
   ko/en 만 있다. 블록째가 아니라 항목 단위로 떨어뜨려 일본어는 정식 이름 + 영문
   약칭이 되게 한다 (roster.js 의 같은 이름 함수와 규칙을 맞춘다). */
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
   attraction_grade 표는 SSR 기준이라 0돌~3돌·1~7코강을 전부 담고 있지만, 실제로
   갈 수 있는 데까지는 니케 등급이 가른다 — SR 은 2돌에서 끝나고, R 은 돌파 자체가
   없으며, 코어강화는 SSR 전용이다 (data/cp_rules.json 의 limit_break).       */
const limits = rarity => (rules.limit_break || {})[rarity] || { break: 3, core: 7 };
const gradesFor = rarity => {
  const lim = limits(rarity);
  return T.grades.filter(g => g.breaks <= lim.break && g.cores <= lim.core);
};
/* 못 가는 등급이 입력에 남아 있으면(SR 로 바꿨는데 7코강) 갈 수 있는 가장 높은
   단계로 내린다 — 셀렉트에 없는 값이 남으면 칸이 통째로 비어 보이고, 계산은
   그 니케가 도달할 수 없는 전투력을 낸다. */
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

/* 밖에서 들어온 입력(저장값·목록에서 고른 니케)을 지금 규칙에 맞춘다.
   등급 한계가 생기기 전에 저장된 값에는 SR 니케에 7코강 같은 조합이 남아 있다 —
   예전 기본값이 '표의 마지막 단계' 였고 기본 니케(라피)가 SR 이라 흔하다. */
const adopt = v => {
  const r = renameOptions(v);
  r.grade = clampGrade(r.grade, ctx.byRid.get(r.rid)?.rarity);
  return r;
};

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

/* ── 한 단계당 전투력 증가 ─────────────────────────────────────
   "콘솔을 1레벨 더 올리면 얼마나 오르나"를 컨텐츠 레벨(40·400)에서 보여 준다.

   콘솔은 스탯에 더해진 뒤 코강 계수와 반올림을 거치므로 선형이 아니다 —
   그래서 1레벨 올린 입력으로 다시 계산해 차이를 낸다. 돌파·코강도 같은 이유로
   (계수 자체가 바뀐다) 한 단계 올린 등급으로 다시 계산한다.
   오버로드 옵션은 (4)항의 계수에만 들어가서 정확히 선형이다:
     ΔCP = ((1)+(2)+(3)) × 계수 / 100.

   돌파와 코강은 한 줄로 이어진 단계다 (0돌…3돌 → 1코강…7코강). 어디까지 갈 수
   있는지는 니케 등급이 가르므로(limits), 지금 자리에 따라 셋 중 하나가 된다:
     올릴 수 있다        -> 다음 등급으로 다시 계산한 차이
     끝까지 올렸다        -> 0   (SSR 3돌·7코강 · SR 2돌 · R 은 처음부터)
     그 등급에 없다      -> null (SR·R 의 코강, 최대 돌파 전의 코강)      */
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
  /* 돌파·코강을 맨 위에 둔다 — 여기서 붙는 전투력이 콘솔·옵션보다 한 자리 크다.
     뒤의 두 칸은 그 줄이 왜 0 이고 왜 '—' 인지 알리는 hover 다. 이유가 등급마다
     다르므로(R 은 돌파가 아예 없고, SR 은 코강이 없다) 여기서 골라 넣는다. */
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
   표시 수치는 **퍼센트포인트 정수**로 맞춘다. 원표(`equip_option.json`)는 분수
   소수점 넷째 자리(= 퍼센트 둘째 자리)까지 있으므로, 분수를 소수점 셋째 자리에서
   반올림해 둘째 자리로 만들면 퍼센트가 정수로 떨어진다. 0.2916 -> 0.29 -> 29%.

   같은 옵션이 여러 부위에 붙으면 합치는데, 반올림 지점이 둘로 갈린다:

     같은 옵션 · 같은 단계  -> 먼저 합산하고 반올림   round(단위값 × 개수)
     같은 옵션 · 다른 단계  -> 단계별로 반올림하고 합산

   차속 Lv.10(0.0463) 세 개면 앞 규칙으로 round(0.1389)=0.14 (14%) 이고,
   먼저 반올림했다면 0.05×3 = 0.15 (15%) 라 실제로 값이 달라진다.

   전투력에 들어가는 건 이 수치가 아니라 옵션 '단계 수'다 (cp.js 참고). */
/* 옵션 단계를 인게임과 같은 색으로. 12~14 는 하늘색 글씨, 15 는 검은 칩에 하늘색
   글씨다 — 니파고 탭의 슬롯 표시(np-slot .blue/.black)와 같은 경계를 쓴다.
   종합 칩에는 단계가 하나로 정해지지 않으므로, 그 옵션에 붙은 것 중 가장 높은
   단계를 따른다 (어디까지 올려 뒀는지가 이 줄에서 알고 싶은 것이다). */
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
  /* 인게임 옵션 창처럼 한 줄에 하나씩 — 왼쪽에 [정식 명칭], 오른쪽에 합계.
     좁은 오른쪽 단에서는 한 줄, 넓어지면 두 줄로 갈라진다(auto-fit).
     어느 단계가 몇 개 붙어 나온 합인지는 hover 로 — 상시로 펼치면 다섯 줄이
     열 줄이 되어 카드가 세로로 길어진다. */
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
   니파고(옵션작) 탭은 장비 한 부위를 굴리는 시뮬레이터라 슬롯이 셋뿐이다.
   여기 니케는 네 부위를 들고 있으니 어느 부위로 이어 갈지 한 번 고르게 한다.
   오버로드가 하나뿐이면 물어볼 게 없으므로 바로 넘어간다. */
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
    /* 니파고는 계산기와 따로 불러오는 모듈이라 여기서 직접 집어넣는다.
       탭을 아직 한 번도 안 열었어도 저장값으로 받아 두므로 순서는 상관없다. */
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
  /* 인게임 옵션 창과 같은 배치 — 부위가 열, 옵션 칸이 행(오버로드는 부위마다
     최대 3개). 자리를 비워 두지 않고 '효과 없음' 을 찍어야 어디가 아직 안 뚫린
     칸인지 보인다. 칸이 좁아서 이름은 약어를 쓰고, 정식 명칭은 바로 위 종합에
     이미 펼쳐져 있다.

     그리드 자리를 손으로 지정한다 — 오버로드가 아닌 부위는 한 칸이 세 줄을
     차지해서, 순서대로 흘려 넣으면 뒤 열이 한 줄씩 밀린다. */
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
    /* 여기는 부위에 실제로 붙어 있는 값이라 원표 그대로 쓴다. 반올림은 인게임
       합산을 재현하는 2행(종합)에만 건다 — 부위별로 미리 반올림해 버리면
       차속 13단 두 개가 6%+6%=12% 로 보이는데 종합은 11% 라 산수가 어긋난다. */
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

/* 부위별 칸이 한 줄에 들어가는지는 언어와 화면 폭이 가른다 — 한국어 약어는 두
   글자라 '[공증] 9.70%' 가 그대로 들어가지만 'Crit.Rate' 는 못 들어간다.
   이름이 잘리는 칸이 하나라도 있으면 표를 통째로 두 줄(이름 위·수치 아래)로
   바꾼다. 칸마다 줄 수가 다른 게 제일 지저분하고, 잘라서 '[AT…' 로 보여 주면
   ATK 인지 Ammo 인지 구분이 안 된다. 폭이 되는 쪽은 그대로 한 줄로 둔다.

   글자를 실제로 그려 봐야 아는 값이라 붙인 뒤에 재고, 폰트가 늦게 오면 한 번 더
   잰다 (처음 재는 순간에는 대체 폰트라 폭이 다르다). */
function fitOlGrid(root) {
  for (const grid of root.querySelectorAll('.cp-olGrid')) {
    grid.classList.remove('is-stacked');
    const tight = [...grid.querySelectorAll('.cp-olName')]
      .some(n => n.scrollWidth > n.clientWidth + 1);
    grid.classList.toggle('is-stacked', tight);
  }
}

/* ── 눌러서 여는 상자 ─────────────────────────────────────────
   상세 카드에서 두 군데가 쓴다 — 전투력 숫자의 계산식, 그리고 옵션 시뮬레이션의
   부위 고르기. 둘 다 상시로 펼쳐 둘 내용이 아니라 눌렀을 때만 뜬다.

   상자를 카드 안에 넣으면 .cp-detail 의 overflow:hidden 에 잘리므로 body 에 붙이고
   좌표만 눌린 자리에서 받는다. 그래서 화면이 움직이면(스크롤·리사이즈) 자리가
   어긋나니 그때는 닫는다. 한 번에 하나만 열린다. */
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

  /* 눌린 숫자 바로 아래에 왼쪽을 맞춰 놓고, 화면 밖으로 나가면 안쪽으로 당긴다.
     아래가 모자라면 위로 뒤집는다 — 목록이 긴 화면에서는 카드가 아래쪽에 있다. */
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

/* 툴팁 속 내용 — 스탯 3종 + 계산 분해. 레벨마다 값이 다르므로 그 레벨의
   계산 결과(compute 반환값)를 그대로 받아 만든다. */
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
   돌파·소장품·호감도·큐브는 전투력을 크게 가르는 값이다. 등급·기업·속성처럼
   고정된 축을 찍는 아이콘 줄에 구분선을 긋고 이어 붙인다 — 왼쪽은 '이 니케가 무엇인가', 오른쪽은 '얼마나 키웠나'다.

   도형은 목록 표와 같은 것(roster.js)을 쓴다. 다만 목록에는 열 머리글이 있어
   배지만 봐도 뜻이 서지만 여기는 그게 없으므로, hover 에 항목 이름을 앞에 붙인다.
   레벨과 스킬은 넣지 않는다 — 레벨은 바로 아래 전투력 칸의 머리말이고,
   스킬은 전투력 툴팁의 스킬계수에 그대로 나온다. */
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
   1행 최종 전투력 3종 · 2행 오버로드 종합 · 3행 부위별 상세 ·
   4행 콘솔/옵션 1단계당 증가분.

   손으로 입력하는 창(✎)은 없앴다 — 값은 전부 불러온 계정에서 온다.  */
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
  /* 고정된 축과 키운 상태 사이에 선 하나. 둘 다 아이콘이라 선이 없으면 어디까지가
     '이 니케의 성질' 이고 어디부터가 '내가 키운 것' 인지 갈리지 않는다. */
  tags.appendChild(el('span', 'cp-tagSep'));
  for (const b of growthBadges(n)) tags.appendChild(b);
  who.appendChild(tags);
  head.appendChild(who);

  card.appendChild(head);

  /* 1행 — 최종 전투력 3종 (현재 레벨 / Lv.40 / Lv.400).
     머리말 없이 숫자 셋만. 셋 다 같은 크기로 두고 현재 레벨만 색으로 구분한다.
     숫자는 누를 수 있고, 누르면 그 레벨의 계산식과 스탯이 툴팁으로 열린다. */
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
   싱크로 레벨과 콘솔(리사이클 룸) 아홉 칸은 니케가 아니라 계정에 붙는 값이다.
   불러오기 카드 안에 있던 것을 결과 칸 맨 위로 올렸다 — 전투력에 그대로 들어가는
   수치라 결과 옆에 있어야 읽힌다. 고칠 일이 없으니 입력칸 없이 글자로만 둔다.
   두 줄: 싱크로 + 공용·클래스 셋 / 기업 다섯.
   지금 고른 니케에 실제로 적용되는 칸(그 니케의 클래스·기업)은 진하게 둔다 —
   아홉 칸 중 셋만 계산에 들어가는데 다 같은 굵기면 그게 안 보인다. */
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

  /* 스탯 3종과 계산 분해는 여기 카드로 있었지만, 늘 보고 있을 값이 아니라
     전투력 숫자를 눌렀을 때 뜨는 툴팁으로 옮겼다 (cpBreakdown). */
  out.appendChild(renderDetail(root, n, r));
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
      applyResearch: fresh => { applyResearch(fresh); save(); },
      // 계정이 갈리면 지휘관 줄(싱크로·콘솔)도 갈아 끼워야 한다
      onAccount: () => paint(root),
      onPick: picked => { input = adopt(picked); save(); paint(root); reveal(root); },
    });
  }
  return importEl;
}

/* 한 단으로 접히는 폭(모바일)에서는 목록과 결과가 위아래로 떨어져 있다. 줄을 눌러
   니케를 골라도 결과는 화면 밖이라, 고른 순간 결과 칸으로 데려다준다. 두 단으로
   서는 폭에서는 결과가 이미 옆에 보이므로 건드리지 않는다. */
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

/* 왼쪽에 계정 줄 -> 니케 목록, 오른쪽에 지휘관 줄 -> 고른 니케의 결과.
   목록이 열 열세 개라 왼쪽을 넓게 잡는다 (비율은 style.css). */
function paint(root) {
  /* 툴팁은 body 에 붙어 있어 root 를 비워도 남는다. 가리키던 버튼이 사라지므로
     여기서 같이 닫는다 (다른 니케를 고르거나 자료를 새로 불러올 때). */
  closeTip();
  root.textContent = '';
  const wrap = el('div', 'cp-wrap');
  const left = el('div', 'cp-left');
  left.appendChild(importPanel(root));
  wrap.appendChild(left);
  wrap.appendChild(renderResult(root));
  /* 한 단으로 접혔을 때 결과를 목록 위로 올릴지 (style.css). 자료를 아직 안 불러온
     사람에게는 불러오기 카드가 먼저여야 하므로, 계정이 있을 때만 뒤집는다. */
  wrap.classList.toggle('has-roster', !!(importApi && importApi.account()));
  root.appendChild(wrap);

  fitOlGrid(root);
  // 폰트가 늦게 오면 글자 폭이 달라진다 — 오고 나서 한 번 더 잰다
  if (document.fonts?.ready) document.fonts.ready.then(() => fitOlGrid(root));
  /* 칸 폭은 창 크기를 따라가므로 (한 단 배치로 접히면 카드가 넓어진다) 다시 잰다.
     탭을 다시 그려도 붙는 건 한 번뿐이라 mounted 를 보고 최신 root 로 잰다. */
  mounted = root;
  if (!fitBound) {
    fitBound = true;
    addEventListener('resize', () => { if (mounted) fitOlGrid(mounted); });
  }
}
let mounted = null, fitBound = false;

/* 리사이클 룸 연구(콘솔) 레벨은 계정 단위 값이라 니케 입력(cp.input)과 따로 둔다.
   값은 불러온 계정에서만 오고(applyResearch), 계산기는 고른 니케의 클래스·기업에
   해당하는 줄만 뽑아 input.console 에 얹는다. 아홉 칸 전부는 지휘관 줄이 보여준다. */
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
