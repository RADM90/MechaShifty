/* 메카미 — 스쿼드 DPS 시뮬레이터의 화면 조립.

   계산은 전부 `core/` 가 한다. 여기는 데이터를 모아 넘기고 결과를 그릴 뿐이다 — 순수 쪽은 node 로, 화면은 브라우저로만 검증한다.
   스탯은 `assets/cp.js` 를 그대로 불러 쓴다. 계정이 있으면 그 값, 없으면 `defaults.js` 의 기준 세팅. */

import { buildTables, compute } from './cp.js';

/* 3세대 코어. 명세의 일곱 항과 프레임 루프를 따르고, 실측 메커니즘 19건은 `core/ledger.js` 에 있다. 앞 엔진 두 벌은 `.obsolate/mekami/`. */
import { simulateBattle, SimInputError } from './core/index.js';
import { squadFrom } from './core/nikke.js';
import { staticStatsFrom } from './core/adapt.js';
import { present } from './core/present.js';
import { defaultInput, DEFAULT_LABEL, staticBuffs } from './defaults.js';
import { readAccount, inputFor, describe } from './account.js';
import { renderTimeline, renderShare } from './timeline.js';
import { t, L, num, statName, statValue, initLang, setLang, current, paintStatic } from './i18n.js';

/* 로컬 사본만 본다. app.js 는 `./data/` 가 없으면 GitHub raw 로 넘어가지만 `nikkes_skill.json` 과 `raw/` 표는 이 리포지토리에만 있다.
   index.html 만 떼어 다른 데 올리면 이 탭만 오류로 뜬다. */
const DATA = 'data/';
/* cp.js 가 스탯을 내는 데 필요한 표. 계산기(calc.js)와 같은 목록이다. */
const RAW = ['syncro_stat', 'attraction_stat', 'attraction_grade', 'equip_stat',
  'equip_option', 'cube_stat', 'collection_stat', 'collection_bonus', 'cp_penalty'];
const STORE = 'mekami.squad';

const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const fmt = num;

let account = null;                 // 불러온 계정 (없으면 기준 세팅으로)
const D = { index: [], byRid: new Map(), taxonomy: {}, nikke: {}, loaded: false,
            cubes: null, collection: null, T: null };
const supported = () => D.index.filter(n => n.effects).map(n => pad(n.resource_id));
/* 사이클마다 드는 버스트 컷신 (Ⅰ→Ⅱ 1.60 + Ⅱ→Ⅲ 1.43 + Ⅲ→풀버스트 1.45, 메커니즘 16).
   컷신 동안 전투가 안 흐르므로 모형의 시간에는 없다. 녹화 영상과 초를 맞댈 때만 더한다. */
const CUTIN = 4.48;
const pad = rid => String(rid).padStart(3, '0');
const state = {
  squad: ['017', '330', '354', '016', '515'],
  favorite: { 170: true },
  /* 버스트 사이클은 입력이 아니라 게이지를 굴려 나오는 결과다. 입력으로 두면 게이지 충전 속도 버프가 결과에 전혀 안 나타난다. */
  /* 반응 시간은 풀 스쿼드 영상 10사이클의 실측 중앙값이다 (메커니즘 16). 사이클에 한 번만 든다 — Ⅱ·Ⅲ 은 컷신이 정한다. */
  seconds: 90, level: 400, enemyDef: 0, reaction: 0.52,
  /* 한 발이 동시에 닿는 표적 수. 게이지만 그만큼 빨리 차고 대미지는 안 바뀐다. 기본 2 는 신데렐라 : CW 단독 영상의 실측값이다. */
  targetCount: 2,
  /* 적에게 코어가 있고 닿는가 — 엔진이 적의 생김새를 모르므로 사용자가 정한다 (메커니즘 11).
     켜면 평타를 전부 코어 명중으로 보므로 상한값이다 (메커니즘 13). */
  coreHittable: true,
  /* 파츠 증댐·저지 부위 증댐이 걸릴지 (열린 물음 O 의 절반). 켜면 그 부위를 계속 때린 것으로 보므로 상한값이다. */
  hasParts: false, hasBlockPart: false,
  /* 무기군마다 적정거리가 다르다 (AR·MG 중 · SMG·SG 근 · SR 원 · RL 없음). 교전거리를 정하면 그 무기군만 30% 를 받는다. */
  engagementRange: '중거리',
  /* 버프 추적 화면이 보고 있는 시각. 계산 조건이 아니라 화면 상태라 저장하지 않는다. */
  inspectAt: null,
  isElement: true, fps: 60, control: 'auto',
};

/* ── 불러오기 ──────────────────────────────────────────────── */

const getJSON = async url => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
};

async function load() {
  const [roster, taxonomy, cubes, collection, ...raw] = await Promise.all([
    getJSON(`${DATA}nikkes.json`),
    getJSON(`${DATA}taxonomy.json`),
    getJSON(`${DATA}cubes.json`),
    getJSON(`${DATA}collection.json`),
    ...RAW.map(k => getJSON(`${DATA}raw/${k}.json`)),
  ]);
  /* 명단은 `data/nikkes.json` 하나다 — 이름·등급·클래스·무기군·버스트 단계가 전부 거기 있다.
     명단에 없는 것은 "해석표가 있는가" 뿐이고, 그건 스킬 파일을 받고 나서 채운다. */
  D.index = roster.map(n => ({
    ...n,
    weapon: n.weapon_type,
    /* 스킬 파일을 받기 전에는 다 있는 것으로 둔다. `need()` 가 실제 값으로 고친다. */
    effects: true,
    favorite: false,
  }));
  for (const n of D.index) D.byRid.set(pad(n.resource_id), n);
  D.taxonomy = taxonomy; D.cubes = cubes.cubes; D.collection = collection;
  D.T = buildTables(Object.fromEntries(RAW.map((k, i) => [k, raw[i]])));
}

/* 니케 스킬 데이터는 한 파일이다 (`data/nikkes_skill.json`, 199명 1.1MB).

   어휘 번역은 `tools/mekami_merge.mjs` 가 오프라인에서 끝냈고, 런타임에 남은 것은 레벨 고르기 하나다.
   `data/nikkes.json` 과 같은 PK(`rid`·`resource_id`)라 `rid` 로 잇는다.
   한 번 받으면 들고 있으므로 스쿼드를 바꿔도 요청이 없다. */
async function need() {
  if (D.loaded) return;
  const rows = await getJSON(`${DATA}nikkes_skill.json`);
  for (const row of rows) D.nikke[row.rid.replace(/^c/, '')] = row;
  /* 해석표가 있는 니케만 계산이 된다. 없는 니케도 고르기 화면에 보여 주되 잠근다 — 남은 것이 곧 할 일 목록이다. */
  for (const n of D.index) {
    const doc = D.nikke[pad(n.resource_id)];
    n.effects = !!(doc && doc.variants.base.effects.length);
    /* 애장품이 있는가 — 명단에 없고 스킬 파일에만 있다 (있는 니케만 필드를 든다). */
    n.favorite = !!(doc && doc.favorite);
  }
  D.loaded = true;
}

/* ── 스쿼드 한 명 ─────────────────────────────────────────── */

function meta(rid) { return D.byRid.get(rid) || {}; }

function actorOf(rid) {
  const doc = D.nikke[rid];
  if (!doc) return null;
  const m = meta(rid);
  /* 계정이 있으면 실제 값, 없으면 기준 세팅. 어느 쪽인지 화면에 적는다 — 숫자만으로는 무엇으로 계산했는지 알 수 없다. */
  const { input, source } = inputFor(account, m, { weapon: m.weapon });
  const cp = compute(D.T, input, state.level);
  /* 표에 없는 (등급, 클래스) 조합이면 못 세운다고 말한다 — 옆 등급으로 대신하면 그 니케만 조용히 틀린 숫자를 낸다. */
  if (!cp) return null;
  const fav = !!state.favorite[Number(rid)] && !!doc.favorite;
  const { buffs, ammo } = staticBuffs({ T: D.T, input, weapon: m.weapon,
                                        cubes: D.cubes, collection: D.collection });
  return {
    id: `c${rid}`, rid, doc, meta: m, favorite: fav,
    name: m.name[current()] || m.name.ko,
    stats: cp.stats, staticBuffs: buffs, staticAmmo: ammo,
    isElement: state.isElement,
    input, source,
    /* 스킬 레벨도 계정 값을 따른다. 안 맞으면 공격력만 맞고 스킬 대미지가 통째로 어긋난다. */
    levels: input.skills,
  };
}

/* 장비·큐브·소장품의 고정 버프. 계열별 장탄은 따로 반올림해야 해서 갈라 낸다 (§9.5). 값은 코어가 쓰는 퍼센트 포인트로 올린다. */
function staticStatsOf(a) { return staticStatsFrom(a.staticBuffs, a.staticAmmo).stats; }
function staticAmmoOf(a) { return staticStatsFrom(a.staticBuffs, a.staticAmmo).ammoPct; }

/* 버스트 순서를 스쿼드에서 뽑는다. 1·2·3 이 하나씩 있으면 풀버스트가 돈다. 40초 쿨이 흔해 같은 단계가 둘이면 번갈아 쓴다. */
function planRotation(squad) {
  const by = { Step1: [], Step2: [], Step3: [] };
  for (const a of squad) {
    const step = a.meta.burst === 'AllStep' ? 'Step1' : a.meta.burst;
    if (by[step]) by[step].push(a.id);
  }
  const rounds = Math.max(1, by.Step1.length, by.Step2.length, by.Step3.length);
  const pick = (list, i) => (list.length ? list[i % list.length] : null);
  const rotation = [];
  for (let i = 0; i < rounds; i++) {
    rotation.push({ step1: pick(by.Step1, i), step2: pick(by.Step2, i), step3: pick(by.Step3, i) });
  }
  return { rotation, by };
}

function run() {
  const picked = state.squad.filter(Boolean);
  const squad = picked.map(actorOf).filter(Boolean);
  const dropped = picked.filter(rid => !actorOf(rid))
    .map(rid => meta(rid).name[current()] || meta(rid).name.ko);
  if (!squad.length) return { squad, result: null, by: null, dropped };
  const { by } = planRotation(squad);
  /* 순서를 밖에서 주지 않는다. 코어가 게이지를 보고 스스로 열고, 같은 단계는 왼쪽 칸 우선이다 (메커니즘 6) — 칸 순서가 곧 버스트 순서다. */
  /* 스킬 파일을 명단과 이어 캐릭터 계약을 만든다. 남은 일은 레벨·애장품 고르기뿐이다.
     옮기다 걸린 것은 버리지 않고 경고로 올린다 — 스킬 하나가 소리 없이 사라지면 아무도 모른다. */
  const { characters, problems } = squadFrom(squad.map(a => ({
    doc: a.doc, roster: a.meta, levels: a.levels, favorite: a.favorite,
    baseAttack: a.stats.atk, displayName: a.name,
    staticStats: staticStatsOf(a), staticAmmoPct: staticAmmoOf(a),
  })));
  if (!characters.length) return { squad, result: null, by, dropped };

  /* 사용자가 실제로 만지는 값만 덮는다. 코어의 기본값은 명세와 등기부에 있다. */
  const options = {
    durationSec: state.seconds,
    frameRate: state.fps === 30 ? 30 : 60,
    logLevel: 'full',
    /* 표본마다 상태를 통째로 뜬다. 90초 × 0.5초면 180장이라 이 크기에서는 값이 싸고, 없으면 결과를 못 따진다. */
    sampleIntervalSec: Math.max(0.25, state.seconds / 180),
    controlMode: state.control,
    burstPressDelaySec: state.reaction,
    /* 한 발이 닿는 표적 수. 게이지에만 곱한다 (열린 물음 N) — 누적 대미지는 표적 하나 기준이다. */
    targetCount: state.targetCount,
  };

  /* 코어가 못 받는 입력이면 던진다. 안 잡으면 화면이 옛 결과를 그대로 붙들고 있어 아무도 못 알아챈다. */
  let raw;
  try {
    raw = simulateBattle({
      characters,
      target: {
        defense: state.enemyDef,
        coreAlwaysHit: state.coreHittable,
        engagementRange: state.engagementRange,
        hasParts: state.hasParts,
        hasBlockPart: state.hasBlockPart,
      },
      options,
      rngSeed: state.seed == null ? 1 : state.seed,
    });
  } catch (err) {
    if (!(err instanceof SimInputError)) throw err;
    return { squad, result: null, by, dropped, error: err.message };
  }

  const result = present(raw, squad, options);
  for (const p of problems) result.warnings.push(p);
  return { squad, result, by, dropped };
}

/* ── 화면 ──────────────────────────────────────────────────── */

function slotCard(rid, index) {
  const box = el('button', 'mk-slot');
  box.type = 'button';
  box.dataset.index = String(index);
  if (!rid) {
    box.classList.add('is-empty');
    box.appendChild(el('span', 'mk-slotAdd', t('mk.empty')));
    return box;
  }
  const m = meta(rid);
  box.appendChild(el('b', 'mk-slotName', m.name[current()] || m.name.ko));
  const tags = el('span', 'mk-slotTags');
  tags.appendChild(el('span', 'mk-tag is-burst', burstLabel(m.burst)));
  tags.appendChild(el('span', 'mk-tag', m.weapon));
  tags.appendChild(el('span', 'mk-tag', L(D.taxonomy, 'class', m.class)));
  box.appendChild(tags);
  if (m.favorite) {
    const fav = el('span', 'mk-fav' + (state.favorite[Number(rid)] ? ' is-on' : ''), '애장품');
    fav.dataset.fav = rid;
    box.appendChild(fav);
  }
  /* 칸마다 무엇으로 계산했는지 적는다 — 계정에 없는 니케만 기준 세팅으로 도는 경우가 흔하다. */
  const src = D.nikke[rid] ? sourceOf(rid) : null;
  if (src) box.appendChild(el('span', 'mk-src is-' + src.source, src.text));
  return box;
}

/* 슬롯에 적을 계산 근거 한 줄. actorOf 를 다시 부르지 않도록 가벼운 길로 낸다. */
function sourceOf(rid) {
  const m = meta(rid);
  if (!D.nikke[rid]) return null;
  const { input, source } = inputFor(account, m, { weapon: m.weapon });
  return { source, text: describe(input, source, t) };
}

const burstLabel = b => ({ Step1: 'Ⅰ', Step2: 'Ⅱ', Step3: 'Ⅲ', AllStep: 'ALL' }[b] || b);

function paintSquad() {
  const root = $('#mk-slots');
  root.textContent = '';
  for (let i = 0; i < 5; i++) root.appendChild(slotCard(state.squad[i], i));
  /* 기준 세팅 문구의 레벨만 지금 값으로 바꾼다. 언어마다 표기가 달라(400레벨 / Lv.400) 정규식으로 숫자만 집는다. */
  $('#mk-squadHint').textContent = account
    ? t('mk.accountOn', account.count)
    : `${t('mk.noAccount')} ${t('mk.defaultSetting')}: `
      + DEFAULT_LABEL[current()].replace(/400/, String(state.level));
}

function numberField(labelKey, key, opts) {
  const wrap = el('label', 'field');
  wrap.appendChild(el('span', null, t(labelKey)));
  const input = el('input');
  input.type = 'number';
  Object.assign(input, opts || {});
  input.value = String(state[key]);
  input.addEventListener('change', () => {
    const v = Number(input.value);
    if (!Number.isFinite(v)) return;
    state[key] = v;
    /* 전투 시간을 줄이면 보던 시점이 범위 밖으로 나간다 — 그대로 두면 슬라이더가 끝에 붙은 채 값이 안 맞는다. */
    if (key === 'seconds' && state.inspectAt != null && state.inspectAt > v) {
      state.inspectAt = null;
    }
    paint();
  });
  wrap.appendChild(input);
  return wrap;
}

function selectField(labelKey, key, options) {
  const wrap = el('label', 'field');
  wrap.appendChild(el('span', null, t(labelKey)));
  const sel = el('select');
  /* 화면 값은 문자열이지만 상태는 원래 타입이어야 한다. 문자열을 되짚어 고르면 ''(적정거리 밖)이 0 이 되고 `normalizeRange` 가 던진다. */
  const byText = new Map();
  for (const [value, label] of options) {
    const o = el('option', null, label);
    o.value = String(value);
    byText.set(o.value, value);
    sel.appendChild(o);
  }
  sel.value = String(state[key]);
  sel.addEventListener('change', () => {
    state[key] = byText.get(sel.value);
    paint();
  });
  wrap.appendChild(sel);
  return wrap;
}

function paintConditions() {
  const root = $('#mk-condBody');
  root.textContent = '';
  root.appendChild(numberField('mk.seconds', 'seconds', { min: 10, max: 600, step: 10 }));
  root.appendChild(numberField('mk.level', 'level', { min: 1, max: 1400, step: 1 }));
  /* 만충되고 사람이 Ⅰ 을 누르기까지. 사이클에 한 번만 든다 — Ⅱ·Ⅲ 은 컷신이 끝나는 프레임에 이미 눌려 있다 (메커니즘 16).
     기본 0.52초는 풀 스쿼드 영상 10사이클의 중앙값이고, 폭은 0.17~0.98초다. 자동 전투면 0 에 가깝다. */
  root.appendChild(numberField('mk.reaction', 'reaction', { min: 0, max: 2, step: 0.01 }));
  root.appendChild(numberField('mk.enemyDef', 'enemyDef', { min: 0, step: 1000 }));
  /* 파츠가 여럿인 보스는 한 발이 여러 표적에 닿아 게이지가 빨리 찬다. 대미지는 안 바뀐다. 확인 전이라 기본 1 이다 (열린 물음 N). */
  const targets = numberField('mk.targets', 'targetCount', { min: 1, max: 12, step: 1 });
  targets.appendChild(el('small', 'mk-fieldHint', t('mk.targetsHint')));
  root.appendChild(targets);
  root.appendChild(selectField('mk.coreHittable', 'coreHittable', [[true, 'O'], [false, 'X']]));
  /* 파츠·저지 부위는 적이 정하는 조건이라 타격 성격이 아니라 여기 있다. */
  root.appendChild(selectField('mk.hasParts', 'hasParts', [[false, 'X'], [true, 'O']]));
  root.appendChild(selectField('mk.hasBlock', 'hasBlockPart', [[false, 'X'], [true, 'O']]));
  root.appendChild(selectField('mk.range', 'engagementRange',
    [['근거리', t('mk.near')], ['중거리', t('mk.mid')], ['원거리', t('mk.far')],
     [null, t('mk.noRange')]]));
  root.appendChild(selectField('mk.element', 'isElement', [[true, 'O'], [false, 'X']]));
  /* 프레임레이트가 MG 최고 연사를 정한다 — 실측으로 확인한 지점이라 밖으로 뺐다. */
  root.appendChild(selectField('mk.fps', 'fps', [[30, '30'], [60, '60'], [120, '120']]));
  root.appendChild(selectField('mk.control', 'control',
    [['auto', t('mk.auto')], ['manual', t('mk.manual')]]));
}

function paintWarnings(result, by, dropped, error) {
  const root = $('#mk-warn');
  root.textContent = '';
  const msgs = [];
  if (error) msgs.push(error);
  for (const name of dropped || []) msgs.push(t('mk.noStats', name));
  if (by && (!by.Step1.length || !by.Step2.length || !by.Step3.length)) msgs.push(t('mk.needSteps'));
  for (const w of new Set(result ? result.warnings : [])) msgs.push(w);
  if (!msgs.length) return;
  const box = el('div', 'card mk-warnCard');
  for (const m of msgs) box.appendChild(el('p', 'mk-warnLine', m));
  root.appendChild(box);
}

function paintRotation(result, by, squad) {
  const root = $('#mk-rotation');
  root.textContent = '';
  const name = id => (squad.find(a => a.id === id) || {}).name || id;
  if (!result) return;

  /* 실제로 누가 눌렸는지를 적는다. 코어가 스스로 고르므로(게이지가 차면 열고 같은 단계는 왼쪽 우선) 계획이 아니라 결과다. */
  const chains = [];
  for (const l of result.log) {
    if (l.kind === 'chainStart') chains.push({ index: l.index, steps: [], void: false });
    if (l.kind === 'burst') {
      const c = chains.find(x => x.index === l.index);
      if (c) c.steps.push(name(l.actor));
    }
    if (l.kind === 'chainVoid') {
      const c = chains.find(x => x.index === l.index);
      if (c) { c.void = true; c.missing = l.missing; }
    }
  }
  /* 같은 무늬가 이어지면 접는다. 같은 셋을 일곱 줄로 늘어놓으면 정작 누가 한 번도 안 나왔는지가 안 보인다. */
  const list = el('ol', 'mk-rot');
  for (let i = 0; i < chains.length;) {
    const key = c => c.steps.join('>') + (c.void ? '!' : '');
    let j = i;
    while (j + 1 < chains.length && key(chains[j + 1]) === key(chains[i])) j++;
    const c = chains[i];
    const li = el('li', c.void ? 'is-void' : null, c.steps.join(' → ') || '—');
    if (j > i) li.appendChild(el('span', 'mk-repeat', `×${j - i + 1}`));
    /* 무효가 된 체인도 보여 준다 — 쿨타임은 돌고 게이지는 날아갔으므로 실패도 결과다. */
    if (c.void) li.appendChild(el('span', 'mk-voidTag', t('mk.chainVoid')));
    list.appendChild(li);
    i = j + 1;
  }
  root.appendChild(list);

  /* 한 번도 안 나온 니케. 왼쪽 우선이라 쿨타임이 짧은 앞쪽이 계속 쓰이면 뒤쪽은 영영 못 쓴다 — 칸 순서를 바꾸라는 신호다. */
  const burstUsers = new Set(result.log.filter(l => l.kind === 'burst').map(l => l.actor));
  const neverBurst = squad.filter(a => !burstUsers.has(a.id));
  if (neverBurst.length && chains.length) {
    root.appendChild(el('p', 'mk-unused',
      t('mk.neverBurst', neverBurst.map(a => a.name).join(' · '))));
  }

  const b = result.fullBurst;
  /* 풀버스트 횟수를 가장 크게 적는다 — 시간당 딜을 정하는 것은 이 숫자이고, 사이클 길이는 그 설명이다. */
  root.appendChild(el('p', 'mk-rotFoot',
    `${t('mk.fbCount', b.count)} · ${t('mk.fbEff')} ${Math.round(b.uptime)}초 / `
    + `${result.seconds}초 = ${Math.round(b.share * 100)}%`));

  const bits = [];
  if (b.avgCycle) bits.push(`${t('mk.avgCycle')} ${b.avgCycle.toFixed(1)}초`);
  /* 사이클을 셋으로 가른다 (메커니즘 16). 영상에서 셋의 합이 주기와 맞았다.
     어느 칸이 긴지가 고칠 자리다 — 충전이면 게이지 서포터, 반응이면 조작, 풀버스트 길이는 Ⅲ 을 쓰는 니케가 정한다. */
  if (b.avgCycle && b.count) {
    /* 온전히 끝난 구간만 평균 낸다. 잘린 마지막 풀버스트를 같이 세면 길이가 짧아지고 그 차이가 충전 칸으로 밀려 들어간다. */
    const whole = b.windows.filter(w => w.to != null && w.to < result.seconds - 1e-9);
    const fb = whole.length ? whole.reduce((s, w) => s + (w.to - w.from), 0) / whole.length
                            : b.uptime / b.count;
    /* 만충되고도 못 누른 시간. 사람의 반응만이 아니라 Ⅰ 을 낼 니케가 전부 쿨타임인 기다림도 들어온다 — `bound` 가 가른다. */
    const wait = b.avgWait || 0;
    const fill = Math.max(0, b.avgCycle - wait - fb);
    bits.push(t('mk.anatomy', `${fill.toFixed(1)}초`, `${wait.toFixed(2)}초`,
                              `${fb.toFixed(1)}초`));
    /* 무엇이 사이클을 붙잡는가. 쿨타임이면 게이지를 더 채워도 안 빨라진다. */
    if (b.bound) bits.push(t(b.bound === 'cooldown' ? 'mk.boundCooldown' : 'mk.boundGauge'));
  }
  if (result.chains.voided.length) {
    bits.push(`${t('mk.voidCount', result.chains.voided.length)}`);
  }
  /* 체인·풀버스트 중에는 게이지가 안 찬다 (메커니즘 6). 그동안 몇 발이 버려졌는지가 "왜 다음 사이클이 늦나" 의 답이다. */
  if (result.wastedHits) bits.push(`${t('mk.wasted', result.wastedHits)}`);
  if (bits.length) root.appendChild(el('p', 'mk-rotFoot', bits.join(' · ')));

  /* 니케별 게이지 충전 기여도. 대미지 기여도와 별개 지표이고, 병목이 충전일 때 편성 판단 기준이 된다.

     평타분과 스킬분을 나누는 이유는 늘리는 수단이 다르기 때문이다.
       · 평타분 — 재장전 속도·최대 장탄·연사 버프로 는다
       · 스킬분 — 스킬 발동 조건에 종속돼 사격 버프로는 안 는다 (신데렐라 : CW 는 스쿼드 누적 200발당, 아니스 : 스타는 자기 버스트 연동)

     집계값은 게이지에 실제 반영된 양이다. 잠금 구간에서 버려진 명중은 `wastedHits` 로 따로 센다. */
  const rows = (result.gauge && result.gauge.by || []).filter(r => r.charged > 0);
  const gaugeMax = result.gauge && result.gauge.max;
  if (rows.length && gaugeMax > 0) {
    /* 단위는 게이지 퍼센트다. 원시 수치는 만충 기준값을 모르면 못 읽고, 만충값이 바뀌면 같은 편성의 숫자가 통째로 달라진다.
       누계 350% 는 이 니케 혼자 게이지를 세 번 반 채웠다는 뜻이다. 사이클당 평균은 다섯 명을 더하면 정확히 100% 다.
       나누는 수는 체인 횟수가 아니라 총 충전량 ÷ 만충이다 — 충전 도중에 전투가 끝나면 남은 몫 때문에 합이 100% 를 넘는다. */
    const cycles = Math.max(
      1e-9, rows.reduce((x, r) => x + r.charged, 0) / gaugeMax);
    const gaugePct = r => (r.charged / gaugeMax) * 100;
    const box = el('div', 'mk-charge');
    box.appendChild(el('p', 'mk-chargeHead', t('mk.chargeBy')));
    for (const r of rows) {
      const a = squad.find(x => x.id === r.id);
      const row = el('div', 'mk-chargeRow');
      row.appendChild(el('b', null, a ? a.name : r.id));
      const bar = el('span', 'mk-chargeBar');
      bar.style.width = `${(r.charged / rows[0].charged) * 100}%`;
      /* 평타분은 재장전·연사 버프로 늘고, 스킬분은 발동 조건에 종속돼 안 는다. */
      for (const [k, v] of [['bullet', r.bullet], ['skill', r.skill]]) {
        if (!(v > 0)) continue;
        const seg = el('span', `mk-chargeSeg is-${k}`);
        seg.style.flexGrow = String(v);
        seg.title = `${t(k === 'bullet' ? 'mk.normal' : 'mk.skill')} `
          + `${((v / gaugeMax) * 100).toFixed(0)}% (${t('mk.perCycle')} ${((v / gaugeMax) * 100 / cycles).toFixed(1)}%)`;
        bar.appendChild(seg);
      }
      row.appendChild(bar);
      row.appendChild(el('span', 'mk-chargeVal',
        `${Math.round(gaugePct(r))}%`));
      row.appendChild(el('span', 'mk-chargeCycle',
        `${(gaugePct(r) / cycles).toFixed(1)}%`));
      box.appendChild(row);
    }
    /* 합계를 적어 둔다 — 사이클당 합이 100% 근처가 아니면 어딘가 새고 있다는 뜻이다. */
    const total = rows.reduce((x, r) => x + gaugePct(r), 0);
    box.appendChild(el('p', 'mk-chargeFoot',
      t('mk.chargeTotal', Math.round(total), cycles.toFixed(1), (total / cycles).toFixed(0))));
    root.appendChild(box);
  }

  /* 무엇이 사이클을 붙잡는지. "게이지 서포터를 넣을 자리인가" 의 답이다 — 쿨타임이 병목이면 넣어도 안 변한다. */
  if (b.bound) {
    root.appendChild(el('p', 'mk-bound is-' + b.bound,
      t(b.bound === 'gauge' ? 'mk.boundGauge' : 'mk.boundCooldown')));
  }

  /* 모형의 초와 화면의 초가 다르다 (메커니즘 16). 컷신을 사이클에서 뺐으므로 녹화 영상과 맞대려면 얼마를 더해야 하는지 적어 둔다. */
  if (b.count) {
    root.appendChild(el('p', 'mk-wall',
      t('mk.wallClock', Math.round(result.seconds + b.count * CUTIN), b.count)));
  }

  /* 결과가 잠정값에 기대고 있음을 숨기지 않는다. 만충 기준값은 1세대가 협전 로그로 역산한 것이고, 그 뒤 게이지 잠금이 생겨 틀릴 것이 거의 확실하다. */
  const provisional = (result.provisional || []).filter(p => p.valueInUse != null);
  if (provisional.length) {
    const box = el('details', 'mk-prov');
    const sum = el('summary', null, t('mk.provisional', provisional.length));
    box.appendChild(sum);
    for (const p of provisional) {
      box.appendChild(el('p', 'mk-provLine', `${p.means} = ${p.valueInUse} — ${p.whyProvisional}`));
    }
    root.appendChild(box);
  }
}

/* ── 버프 추적 ─────────────────────────────────────────────── */

/* 그 순간 누구에게 무엇이 걸려 있나.

   합친 값만 보이면 "공격력 +180%" 가 한 줄인지 다섯 줄이 겹친 것인지 안 보인다. 스탯별 합계 아래에 그 합계를 만든 줄을 출처와 함께 편다.
   시전자 기준 공격력이 서로를 먹여 164초에 63배가 돼 있던 것을 이 화면에서 찾았다. */
function snapAt(result, seconds) {
  const snaps = (result && result.snapshots) || [];
  if (!snaps.length) return null;
  const want = state.inspectAt == null ? snaps[snaps.length - 1].t : state.inspectAt;
  return snaps.reduce((best, s) =>
    (Math.abs(s.t - want) < Math.abs(best.t - want) ? s : best), snaps[0]);
}

/* 엔진은 버프 출처를 `c017 s1[4]` 같은 규칙 자리로 남긴다. 니케·스킬 이름으로 풀고 해석 메모를 툴팁으로 붙인다.
   세팅·큐브처럼 규칙이 아닌 출처는 그대로 둔다. */
function sourceLabel(src, note) {
  const m = /^c(\d+)\s+(s1|s2|burst)\[(\d+)\]$/.exec(src || '');
  if (!m) return { text: src, note: note || null };
  const [, rid, slot] = m;
  const doc = D.nikke[rid];
  if (!doc) return { text: src, note: note || null };
  const who = (() => { const m = D.byRid.get(rid); return m ? (m.name[current()] || m.name.ko) : rid; })();
  const fav = !!state.favorite[Number(rid)] && !!doc.favorite;
  const variant = (fav && doc.variants.favorite) || doc.variants.base;
  const skill = (variant.skills || {})[slot];
  const SLOT = { s1: '1스킬', s2: '2스킬', burst: '버스트' };
  const label = skill ? (skill.name[current()] || skill.name.ko) : (SLOT[slot] || slot);
  return { text: `${who} · ${label}`, note: note || null };
}

function sourceSpan(cls, src, srcNote) {
  const { text, note } = sourceLabel(src, srcNote);
  const node = el('span', cls, text);
  /* 해석 메모를 툴팁으로 — "왜 이 버프가 여기 붙었나" 가 그 한 줄에 있다. */
  if (note) node.title = note;
  return node;
}

function buffLines(list) {
  const box = el('div', 'mk-buffs');
  /* 같은 스탯끼리 묶고 값이 큰 것부터 놓는다 — 이상한 값은 대개 맨 위에 있다. */
  const by = new Map();
  for (const b of list) {
    if (!by.has(b.stat)) by.set(b.stat, []);
    by.get(b.stat).push(b);
  }
  const total = l => l.reduce((s, b) => s + b.value, 0);
  for (const [stat, lines] of [...by].sort((x, y) => Math.abs(total(y[1])) - Math.abs(total(x[1])))) {
    const row = el('div', 'mk-buffRow');
    const head = el('div', 'mk-buffHead');
    head.appendChild(el('span', 'mk-buffName', statName(stat)));
    head.appendChild(el('b', 'mk-buffVal', statValue(stat, total(lines))));
    if (lines.length > 1) head.appendChild(el('span', 'mk-buffCount', t('mk.lines', lines.length)));
    row.appendChild(head);
    /* 한 줄짜리 세팅값까지 펴면 화면이 세팅으로 도배된다. 겹친 것만 편다. */
    if (lines.length > 1) {
      const ul = el('ul', 'mk-buffSrc');
      for (const b of lines) {
        const li = el('li');
        li.appendChild(el('span', 'mk-buffVal', statValue(stat, b.value)));
        li.appendChild(sourceSpan('mk-buffFrom', b.source, b.note));
        li.appendChild(el('span', 'mk-buffUntil',
                          b.until != null ? `${b.until.toFixed(1)}s` : t('mk.forever')));
        ul.appendChild(li);
      }
      row.appendChild(ul);
    } else {
      const one = lines[0];
      const p = el('p', 'mk-buffOne');
      p.appendChild(sourceSpan('mk-buffFrom', one.source, one.note));
      p.appendChild(el('span', 'mk-buffUntil',
                       one.until != null ? `${one.until.toFixed(1)}s` : t('mk.forever')));
      row.appendChild(p);
    }
    box.appendChild(row);
  }
  return box;
}

function paintInspect(result) {
  const root = $('#mk-inspectBody');
  root.textContent = '';
  const snap = snapAt(result);
  if (!snap) return;

  const bar = el('div', 'mk-inspectBar');
  const label = el('span', 'mk-inspectAt',
    `${t('mk.at')} ${snap.t.toFixed(1)}s`);
  const slider = el('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = String(state.seconds);
  slider.step = String(Math.max(0.25, state.seconds / 180));
  slider.value = String(snap.t);
  slider.className = 'mk-inspectSlider';
  /* `input` 으로 즉시 따라가되 시뮬레이션은 다시 안 돌리고 이 칸만 그린다 — 안 그러면 슬라이더가 끌리지 않는다. */
  slider.addEventListener('input', () => {
    state.inspectAt = Number(slider.value);
    paintInspect(result);
  });
  bar.appendChild(label);
  bar.appendChild(slider);
  if (snap.fullBurst) bar.appendChild(el('span', 'mk-inspectFb', t('mk.burst')));
  bar.appendChild(el('span', 'mk-inspectGauge',
    `${t('mk.gauge')} ${Math.round(snap.gauge * 100)}%`));
  root.appendChild(bar);

  if (snap.enemy.buffs.length) {
    const box = el('div', 'mk-enemyBuffs');
    box.appendChild(el('p', 'mk-buffHeadline', t('mk.enemyBuffs')));
    box.appendChild(buffLines(snap.enemy.buffs));
    root.appendChild(box);
  }

  const grid = el('div', 'mk-inspectGrid');
  for (const a of snap.actors) {
    const card = el('div', 'mk-inspectCard');
    const head = el('div', 'mk-inspectName');
    head.appendChild(el('b', null, a.name));
    /* 기본 공격력·지금 공격력·배율. 배율 하나가 "얼마나 부풀었나" 를 한눈에 준다 — 이상하면 여기가 먼저 이상해진다. */
    head.appendChild(el('span', 'mk-inspectAtk',
      `${t('mk.atkSwell')} ${fmt(a.atkBase)} → ${fmt(a.atk)} (×${(a.atk / a.atkBase).toFixed(2)})`));
    card.appendChild(head);

    const tags = el('div', 'mk-inspectTags');
    tags.appendChild(el('span', 'mk-tag', `${a.weapon} ${a.ammo}/${a.ammoMax}`));
    if (a.heat != null) tags.appendChild(el('span', 'mk-tag', `${t('mk.heat')} ${Math.round(a.heat * 100)}%`));
    if (a.stunned) tags.appendChild(el('span', 'mk-tag is-warn', t('mk.stunned')));
    for (const s of a.states) tags.appendChild(el('span', 'mk-tag is-state', s));
    for (const [k, c] of Object.entries(a.stacks)) {
      if (c > 0) tags.appendChild(el('span', 'mk-tag is-stack', `${k} ${c}`));
    }
    card.appendChild(tags);

    if (a.buffs.length) card.appendChild(buffLines(a.buffs));
    else card.appendChild(el('p', 'mk-buffOne', t('mk.noBuffs')));
    grid.appendChild(card);
  }
  root.appendChild(grid);
}

function paintNotes(squad) {
  const root = $('#mk-notes');
  root.textContent = '';
  for (const a of squad) {
    const box = el('details', 'mk-note');
    const sum = el('summary');
    sum.appendChild(el('b', null, a.name));
    sum.appendChild(el('span', 'mk-conf is-' + (a.doc.confidence || '추정'),
                       `${t('mk.confidence')} ${a.doc.confidence}`));
    if (a.doc.stale) sum.appendChild(el('span', 'mk-stale', t('mk.stale')));
    box.appendChild(sum);

    /* 규칙이 하나도 없으면 평타만 때린다. 미반영 목록은 "일부가 빠졌다" 로 읽히므로 통째로 안 들어갔다는 것은 따로 말한다. */
    const variant = (a.favorite && a.doc.variants.favorite) || a.doc.variants.base;
    if (!variant.effects.length) box.appendChild(el('p', 'mk-noRules', t('mk.noRules')));

    for (const key of ['s1', 's2', 'burst']) {
      const src = (variant.skills || {})[key];
      if (!src) continue;
      box.appendChild(el('p', 'mk-skillName',
                         `[${key}] ${src.name[current()] || src.name.ko}`));
      box.appendChild(el('pre', 'mk-skillText', withValues(src, a.levels[key])));
    }
    if (a.doc.unmodeled.length) {
      box.appendChild(el('p', 'mk-unmodHead', t('mk.unmodeled')));
      const ul = el('ul', 'mk-unmod');
      for (const u of a.doc.unmodeled) ul.appendChild(el('li', null, u));
      box.appendChild(ul);
    }
    root.appendChild(box);
  }
}

/* 원문의 `{n}` 자리를 배율표로 채운다. 그 사람의 스킬 레벨로 채워야 화면의 숫자와 계산에 들어간 숫자가 같아진다. */
function withValues(skill, level) {
  const text = skill.text[current()] || skill.text.ko || '';
  const lv = Number.isFinite(level) ? level : 10;
  return text.replace(/\{(\d+)\}/g, (m, n) => {
    const row = skill.values && skill.values[Number(n) - 1];
    if (!row) return m;
    const v = row[Math.min(Math.max(lv, 1), row.length) - 1];
    return v == null ? m : String(v);
  });
}

async function paint() {
  await need();
  const { squad, result, by, dropped, error } = run();
  paintSquad();
  paintConditions();
  paintWarnings(result, by, dropped, error);
  if (result) {
    renderTimeline($('#mk-timeline'), result, squad, t);
    renderShare($('#mk-byNikke'), result, t);
    const head = $('#mk-chartHead');
    head.textContent = `${t('mk.timeline')} — ${t('mk.total')} ${fmt(result.total)} `
      + `(${t('mk.dps')} ${fmt(result.dps)})`;
  } else {
    $('#mk-timeline').textContent = '';
    $('#mk-byNikke').textContent = '';
  }
  paintRotation(result, by, squad);
  paintInspect(result);
  paintNotes(squad);
  save();
}

/* ── 니케 고르기 ──────────────────────────────────────────── */

let picking = -1;

function openPicker(index) {
  picking = index;
  const body = $('#mk-sheetBody');
  body.textContent = '';
  body.appendChild(el('h3', null, t('mk.pick')));
  const list = el('div', 'mk-pickList');
  /* 명단에는 199명이 다 있지만 해석표가 있어야 계산이 된다. 없는 니케는 보여 주되 잠근다. */
  const rows = [...D.index].sort((a, b) =>
    (b.effects - a.effects) || a.burst.localeCompare(b.burst)
    || (a.name[current()] || a.name.ko).localeCompare(b.name[current()] || b.name.ko));
  for (const n of rows) {
    const rid = pad(n.resource_id);
    const b = el('button', 'mk-pick');
    b.type = 'button';
    b.dataset.rid = rid;
    if (!n.effects) { b.disabled = true; b.classList.add('is-todo'); }
    else if (state.squad.includes(rid) && state.squad[index] !== rid) b.disabled = true;
    b.appendChild(el('b', null, n.name[current()] || n.name.ko));
    b.appendChild(el('span', 'mk-tag is-burst', burstLabel(n.burst)));
    b.appendChild(el('span', 'mk-tag', n.weapon));
    if (n.favorite) b.appendChild(el('span', 'mk-tag', '애장품'));
    if (!n.effects) b.appendChild(el('span', 'mk-tag is-todo', '효과표 없음'));
    list.appendChild(b);
  }
  body.appendChild(list);
  if (state.squad[index]) {
    const rm = el('button', 'btn-reset mk-rm', t('mk.remove'));
    rm.type = 'button';
    rm.dataset.remove = '1';
    body.appendChild(rm);
  }
  $('#mk-sheet').hidden = false;
}

const closePicker = () => { $('#mk-sheet').hidden = true; picking = -1; };

/* ── 저장 ─────────────────────────────────────────────────── */

function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify({
      squad: state.squad, favorite: state.favorite, seconds: state.seconds,
      level: state.level, enemyDef: state.enemyDef, reaction: state.reaction,
      targetCount: state.targetCount, hasParts: state.hasParts, hasBlockPart: state.hasBlockPart,
      coreHittable: state.coreHittable, engagementRange: state.engagementRange,
      isElement: state.isElement, fps: state.fps, control: state.control,
    }));
  } catch { /* 저장 못 해도 계산은 된다 */ }
}

function restore() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (!raw) return;
    if (Array.isArray(raw.squad)) {
      state.squad = raw.squad.slice(0, 5).map(r => (supported().includes(r) ? r : null));
    }
    for (const k of ['seconds', 'level', 'enemyDef', 'fps', 'reaction', 'targetCount']) {
      if (Number.isFinite(raw[k])) state[k] = raw[k];
    }
    for (const k of ['isElement', 'coreHittable', 'hasParts', 'hasBlockPart']) {
      if (typeof raw[k] === 'boolean') state[k] = raw[k];
    }
    if (typeof raw.engagementRange === 'string' || raw.engagementRange === null) {
      state.engagementRange = raw.engagementRange;
    }
    if (raw.control === 'auto' || raw.control === 'manual') state.control = raw.control;
    if (raw.favorite && typeof raw.favorite === 'object') state.favorite = raw.favorite;
  } catch { /* 깨진 값이면 기본으로 */ }
}

/* ── 화면 뼈대 ─────────────────────────────────────────────

   껍데기(상단바·테마·언어)는 `index.html` 것을 그대로 쓰고 여기서는 탭 안쪽만 만든다. */
const MARKUP = `
  <section class="card mk-squad" aria-labelledby="mk-squadHead">
    <h3 id="mk-squadHead" data-i18n="mk.squad">스쿼드</h3>
    <p class="hint" id="mk-squadHint"></p>
    <div id="mk-slots" class="mk-slots"></div>
  </section>

  <section class="card mk-cond" aria-labelledby="mk-condHead">
    <h3 id="mk-condHead" data-i18n="mk.cond">전투 조건</h3>
    <div id="mk-condBody" class="mk-fields"></div>
  </section>

  <div id="mk-warn"></div>

  <section class="card wide mk-chart" aria-labelledby="mk-chartHead">
    <h3 id="mk-chartHead" data-i18n="mk.timeline">타임라인</h3>
    <p class="hint" data-i18n="mk.timelineHint"></p>
    <div id="mk-timeline"></div>
  </section>

  <div class="cards">
    <section class="card" aria-labelledby="mk-byHead">
      <h3 id="mk-byHead" data-i18n="mk.byNikke">니케별 기여</h3>
      <div id="mk-byNikke"></div>
    </section>
    <section class="card" aria-labelledby="mk-rotHead">
      <h3 id="mk-rotHead" data-i18n="mk.rotation">버스트 순서</h3>
      <div id="mk-rotation"></div>
    </section>
  </div>

  <section class="card wide" aria-labelledby="mk-inspectHead">
    <h3 id="mk-inspectHead" data-i18n="mk.inspect">버프 추적</h3>
    <p class="hint" data-i18n="mk.inspectHint"></p>
    <div id="mk-inspectBody"></div>
  </section>

  <section class="card wide mk-notes" aria-labelledby="mk-noteHead">
    <h3 id="mk-noteHead" data-i18n="mk.notes">스킬 원문 · 미반영</h3>
    <div id="mk-notes"></div>
  </section>

  <p class="mk-meta" id="mk-meta"></p>

  <div id="mk-sheet" class="sheet" hidden>
    <div class="sheet-back" data-close></div>
    <aside class="sheet-body" role="dialog" aria-modal="true">
      <button type="button" class="sheet-x" data-close data-i18n-aria="ui.close">×</button>
      <div id="mk-sheetBody"></div>
    </aside>
  </div>`;

/* ── 엮기 ─────────────────────────────────────────────────── */

function wire() {
  $('#mk-slots').addEventListener('click', e => {
    const fav = e.target.closest('[data-fav]');
    if (fav) {
      e.stopPropagation();
      const rid = Number(fav.dataset.fav);
      state.favorite[rid] = !state.favorite[rid];
      paint();
      return;
    }
    const slot = e.target.closest('.mk-slot');
    if (slot) openPicker(Number(slot.dataset.index));
  });

  $('#mk-sheet').addEventListener('click', e => {
    if (e.target.closest('[data-close]')) return closePicker();
    if (e.target.closest('[data-remove]')) {
      state.squad[picking] = null; closePicker(); paint(); return;
    }
    const pick = e.target.closest('[data-rid]');
    if (pick && !pick.disabled) {
      state.squad[picking] = pick.dataset.rid;
      closePicker(); paint();
    }
  });

  document.addEventListener('keydown', e => { if (e.key === 'Escape') closePicker(); });
}

/* ── 탭으로 들어오는 자리 ─────────────────────────────────

   상단바·언어·테마 단추는 app.js 것이다. 여기서는 넘겨받은 언어에 맞춰 탭 안쪽만 그린다.
   문구 표를 따로 드는 이유는 app.js 를 import 하면 그 모듈이 최상위에서 도는 탓에 앱이 한 벌 더 뜨기 때문이다.
   데이터도 이 모듈이 따로 받는다 — 큐브·소장품과 `raw/` 표 아홉 장까지 필요하다. 겹치는 명단·분류는 브라우저 캐시에 걸린다.
   탭을 누를 때마다 불리고, 뼈대와 적재는 처음 한 번만 한다. */
let booted = false;
let bootError = null;

export async function renderMekami(root, ctx = {}) {
  if (ctx.lang && ctx.lang !== current()) setLang(ctx.lang);
  if (bootError) { root.textContent = bootError; return; }

  if (!booted) {
    root.innerHTML = `<p class="notice" data-i18n="ui.loading">…</p>`;
    paintStatic(root);
    try {
      initLang();
      if (ctx.lang) setLang(ctx.lang);
      await load();
    } catch (err) {
      bootError = `${t('ui.failed')}: ${err.message}`;
      root.textContent = bootError;
      return;
    }
    account = readAccount();
    restore();
    root.innerHTML = MARKUP;
    wire();
    booted = true;
  }
  /* 탭 안쪽만 다시 칠한다. 문서 전체에 걸면 app.js 표를 보는 `data-i18n` 까지 덮어 상단바 이름이 "메카미" 로 바뀐다. */
  paintStatic(root);
  await paint();
  $('#mk-meta').textContent = `${t('mk.metaHead')} · `
    + t('mk.metaCount', D.index.length, supported().length)
    + ` · ${t('mk.metaBasis', state.fps)}`;
}
