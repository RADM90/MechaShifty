/* 메카미 — 스쿼드 DPS 시뮬레이터의 화면 조립.

   계산은 전부 순수 모듈(formula·engine·effects)이 하고, 여기서는 데이터를 모아
   넘기고 결과를 그린다. 그 경계를 지키는 이유는 검증 때문이다 — 순수 쪽은 node 로
   소수점까지 재고, 화면은 브라우저로만 보면 된다.

   스탯은 지어내지 않는다. MechaShifty 의 `assets/cp.js` 를 그대로 불러 쓰므로
   전투력 계산기와 같은 공격력이 나온다. 계정을 불러와 뒀으면 그 값을, 아니면
   `defaults.js` 의 기준 세팅을 쓴다. */

import { buildTables, compute } from '../../assets/cp.js';
import { compile } from './effects.js';
/* **2세대 엔진**으로 돈다. 1세대는 `assets/engine.js` 에 그대로 있고 테스트 164개가
   아직 그쪽을 쓴다 — 대조군이라 지우지 않는다 (`mekami/legacy/README.md`). */
import { simulate } from './engine.next.js';
import { defaultInput, DEFAULT_LABEL, staticBuffs } from './defaults.js';
import { readAccount, inputFor, describe } from './account.js';
import { renderTimeline, renderShare } from './timeline.js';
import { t, L, num, statName, statValue, initLang, setLang, current, paintStatic } from './i18n.js';

const PARENT = '../data/';
const HERE = './data/';
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

/* 전투 데이터는 니케당 8~11KB 라 199명을 다 받으면 2MB 다. 고르는 화면은 색인만
   읽고, 스쿼드에 세울 때 그 니케 것만 한 장씩 받는다. */
let account = null;                 // 불러온 계정 (없으면 기준 세팅으로)
const D = { index: [], byRid: new Map(), taxonomy: {}, combat: {}, effects: {},
            cubes: null, collection: null, T: null };
const supported = () => D.index.filter(n => n.effects).map(n => pad(n.rid));
/* 사이클마다 드는 버스트 컷신 (Ⅰ→Ⅱ 1.60 + Ⅱ→Ⅲ 1.43 + Ⅲ→풀버스트 1.45, 메커니즘 16).
   **모형의 시간에는 안 들어 있다** — 컷신 동안은 전투가 안 흐르므로 뺐다. 화면과 초를
   맞대 볼 때만 다시 더한다. */
const CUTIN = 4.48;
const pad = rid => String(rid).padStart(3, '0');
const state = {
  squad: ['017', '330', '354', '016', '515'],
  favorite: { 170: true },
  /* 버스트 사이클은 입력이 아니다 — 게이지를 굴려 나오는 결과다. 예전에는 여기에
     `cycle: 20` 이 있었는데, 그러면 아니스 : 스타의 게이지 충전 속도가 결과에 1도
     안 나타난다. 답해야 할 질문을 답으로 깔고 시작하는 셈이었다. */
  /* 반응 시간은 풀 스쿼드 영상 10사이클 실측 중앙값이다 (메커니즘 16). 사이클에 한 번만
     든다 — Ⅱ·Ⅲ 은 사람이 아니라 컷신이 정한다. */
  seconds: 90, level: 400, enemyDef: 0, reaction: 0.52,
  /* 한 발이 동시에 닿는 표적 수 — 게이지가 그만큼 빨리 찬다 (대미지는 안 바뀐다).
     기본 2 는 신데렐라 : CW 단독 영상이 재는 값이다. 파츠가 여럿인 보스는 더 크다. */
  표적수: 2,
  /* 적에게 코어가 있고 닿는가. **사용자가 정한다** (메커니즘 11) — 엔진이 적의
     생김새를 아는 게 아니다. 켜면 평타는 전부 코어 명중으로 본다 (메커니즘 13),
     즉 상한값이다. */
  코어명중: true,
  /* 적의 생김새 — 파츠 증댐·저지 부위 증댐이 걸릴지를 정한다 (열린 물음 O 의 절반).
     기본은 꺼 둔다. 켜면 그 부위를 계속 때린 것으로 보므로 **상한값**이 나온다. */
  파츠있음: false, 저지부위있음: false,
  /* 무기군마다 적정거리가 다르다 (AR·MG 중거리 · SMG·SG 근거리 · SR 원거리 ·
     RL 없음). 교전거리를 정하면 그 무기군만 30% 를 받는다. */
  교전거리: '중거리',
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
  const [index, taxonomy, cubes, collection, ...raw] = await Promise.all([
    getJSON(`${HERE}index.json`),
    getJSON(`${PARENT}taxonomy.json`),
    getJSON(`${HERE}cubes_effect.json`),
    getJSON(`${HERE}collection.json`),
    ...RAW.map(k => getJSON(`${PARENT}raw/${k}.json`)),
  ]);
  D.index = index.nikkes || [];
  for (const n of D.index) D.byRid.set(pad(n.rid), n);
  D.taxonomy = taxonomy; D.cubes = cubes; D.collection = collection;
  D.T = buildTables(Object.fromEntries(RAW.map((k, i) => [k, raw[i]])));
}

/* 스쿼드에 세운 니케만 실제 데이터를 받는다. 한 번 받으면 들고 있는다. */
async function need(rids) {
  const missing = rids.filter(r => r && !D.combat[r]);
  if (!missing.length) return;
  await Promise.all(missing.map(async rid => {
    const [combat, effects] = await Promise.all([
      getJSON(`${HERE}combat/c${rid}.json`),
      getJSON(`${HERE}effects/c${rid}.json`),
    ]);
    D.combat[rid] = combat; D.effects[rid] = effects;
  }));
}

/* ── 스쿼드 한 명 ─────────────────────────────────────────── */

function meta(rid) { return D.byRid.get(rid) || {}; }

function actorOf(rid) {
  const combat = D.combat[rid];
  const m = meta(rid);
  /* 계정을 불러와 뒀으면 그 사람의 실제 값으로, 아니면 기준 세팅으로. 어느 쪽인지
     화면에 그대로 적어 둔다 — 숫자만 보면 무엇으로 계산했는지 알 수가 없다. */
  const { input, source } = inputFor(account, m, { weapon: combat.shot.weapon });
  const cp = compute(D.T, input, state.level);
  /* 표에 없는 (등급, 클래스) 조합이면 스탯이 안 나온다. 없는 값을 지어내느니
     못 세운다고 말하는 게 낫다 — 대충 옆 등급으로 대신하면 그 니케만 조용히
     틀린 숫자를 내놓는다. R 등급은 표에 들어와서 이제 여기 안 걸린다. */
  if (!cp) return null;
  const fav = !!state.favorite[Number(rid)] && !!combat.favorite;
  const { buffs, ammo } = staticBuffs({ T: D.T, input, weapon: combat.shot.weapon,
                                        cubes: D.cubes, collection: D.collection });
  const cd = (combat.skills.burst && combat.skills.burst.cooldown) || [20];
  return {
    id: `c${rid}`, rid, combat, meta: m, favorite: fav,
    name: combat.name[current()] || combat.name.ko,
    /* 2세대 엔진이 배우에게서 직접 읽는 것들. 1세대는 `combat` 안을 뒤졌는데,
       그러면 수기 입력 니케(아직 `combat` 이 없는)를 못 세운다. */
    burst: combat.burst,
    burstDuration: combat.burstDuration,
    burstCooldown: cd[Math.min(input.skills.burst || 10, cd.length) - 1],
    burstEnergy: combat.shot.burstEnergy.perTargetShot,
    critRate: combat.crit && combat.crit.rate != null ? combat.crit.rate / 100 : 0.15,
    effects: compile(D.effects[rid], combat,
                     { favorite: fav, levels: input.skills }),
    stats: cp.stats, staticBuffs: buffs, staticAmmo: ammo,
    isElement: state.isElement,
    input, source,
    /* 스킬 레벨도 계정 값을 따라간다 — 배율이 레벨별로 다르므로 이게 안 맞으면
       공격력만 맞고 스킬 대미지가 통째로 어긋난다. */
    levels: input.skills,
  };
}

/* 버스트 순서를 스쿼드에서 뽑는다. 자리에 제약은 없고 **1·2·3 이 하나씩** 있으면
   풀버스트가 돈다. 40초 쿨이 흔해 같은 단계가 둘이면 번갈아 쓰는 무늬를 만든다. */
function planRotation(squad) {
  const by = { Step1: [], Step2: [], Step3: [] };
  for (const a of squad) {
    const step = a.combat.burst === 'AllStep' ? 'Step1' : a.combat.burst;
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
  /* **순서를 밖에서 적어 주지 않는다.** 2세대는 게이지가 차면 스스로 열고, 같은
     단계가 둘이면 왼쪽 칸을 먼저 쓴다 (메커니즘 6). 그래서 스쿼드 칸 순서가 곧
     버스트 순서고, 칸을 바꾸면 결과가 바뀐다. */
  const result = simulate({
    squad,
    enemy: { def: state.enemyDef, 코어명중가능: state.코어명중, 교전거리: state.교전거리,
             파츠있음: state.파츠있음, 저지부위있음: state.저지부위있음 },
    /* 표본마다 상태를 통째로 뜬다. 90초 × 0.5초 간격이면 180장인데 한 장이 다섯
       명치라, 이 크기에서는 값이 싸고 없으면 결과를 못 따진다. */
    battle: { seconds: state.seconds, sample: Math.max(0.25, state.seconds / 180),
              fps: state.fps, control: state.control, pressDelay: state.reaction,
              /* 한 발이 동시에 닿는 표적 수. **게이지에만** 곱한다 (열린 물음 N).
                 기본 1 이면 지금까지와 같다. 누적 대미지는 표적 하나 기준 그대로다. */
              표적수: state.표적수,
              snapshot: true },
  });
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
  /* 무엇으로 계산했는지 칸마다 적는다. 계정에 없는 니케만 기준 세팅으로 도는
     경우가 흔한데, 그걸 모르면 결과를 잘못 읽는다. */
  const src = D.combat[rid] ? sourceOf(rid) : null;
  if (src) box.appendChild(el('span', 'mk-src is-' + src.source, src.text));
  return box;
}

/* 슬롯에 적을 계산 근거 한 줄. actorOf 를 다시 부르지 않도록 가벼운 길로 낸다. */
function sourceOf(rid) {
  const m = meta(rid);
  const combat = D.combat[rid];
  if (!combat) return null;
  const { input, source } = inputFor(account, m, { weapon: combat.shot.weapon });
  return { source, text: describe(input, source, t) };
}

const burstLabel = b => ({ Step1: 'Ⅰ', Step2: 'Ⅱ', Step3: 'Ⅲ', AllStep: 'ALL' }[b] || b);

function paintSquad() {
  const root = $('#mk-slots');
  root.textContent = '';
  for (let i = 0; i < 5; i++) root.appendChild(slotCard(state.squad[i], i));
  /* 기준 세팅 문구의 레벨만 지금 값으로 갈아 끼운다. 언어마다 표기가 달라
     (400레벨 / Lv.400) 정규식으로 숫자만 집는다. */
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
    /* 전투 시간을 줄이면 보던 시점이 범위 밖으로 나간다. 그대로 두면 슬라이더가
       끝에 붙은 채 값이 안 맞는다. */
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
  for (const [value, label] of options) {
    const o = el('option', null, label);
    o.value = String(value);
    sel.appendChild(o);
  }
  sel.value = String(state[key]);
  sel.addEventListener('change', () => {
    const raw = sel.value;
    state[key] = raw === 'true' ? true : raw === 'false' ? false
      : Number.isFinite(Number(raw)) && raw !== 'auto' && raw !== 'manual' ? Number(raw) : raw;
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
  /* 만충되고 사람이 Ⅰ 을 누르기까지. **사이클에 한 번만 든다** — Ⅱ·Ⅲ 은 컷신이
     끝나는 프레임에 이미 눌려 있었으므로 사람이 정하는 값이 아니다 (메커니즘 16).
     기본값 0.52초는 풀 스쿼드 영상 10사이클 중앙값이고, 폭이 0.17~0.98초라 사람마다
     다르다. 자동 전투라면 0 에 가깝다. */
  root.appendChild(numberField('mk.reaction', 'reaction', { min: 0, max: 2, step: 0.01 }));
  root.appendChild(numberField('mk.enemyDef', 'enemyDef', { min: 0, step: 1000 }));
  /* 파츠가 여럿인 보스에서는 한 발이 여러 표적에 닿아 게이지가 그만큼 빨리 찬다 —
     **대미지는 안 바뀐다.** 확인이 안 끝난 자리라 기본값 1 로 둔다 (열린 물음 N). */
  const 표적 = numberField('mk.targets', '표적수', { min: 1, max: 12, step: 1 });
  표적.appendChild(el('small', 'mk-fieldHint', t('mk.targetsHint')));
  root.appendChild(표적);
  root.appendChild(selectField('mk.coreHittable', '코어명중', [[true, 'O'], [false, 'X']]));
  /* 파츠·저지 부위는 **적이 정하는 조건**이다 — 타격의 성격이 아니라서 여기 있다. */
  root.appendChild(selectField('mk.hasParts', '파츠있음', [[false, 'X'], [true, 'O']]));
  root.appendChild(selectField('mk.hasBlock', '저지부위있음', [[false, 'X'], [true, 'O']]));
  root.appendChild(selectField('mk.range', '교전거리',
    [['근거리', t('mk.near')], ['중거리', t('mk.mid')], ['원거리', t('mk.far')],
     ['', t('mk.noRange')]]));
  root.appendChild(selectField('mk.element', 'isElement', [[true, 'O'], [false, 'X']]));
  /* 프레임레이트가 MG 최고 연사를 정한다 — 실측으로 확인한 지점이라 밖으로 뺐다. */
  root.appendChild(selectField('mk.fps', 'fps', [[30, '30'], [60, '60'], [120, '120']]));
  root.appendChild(selectField('mk.control', 'control',
    [['auto', t('mk.auto')], ['manual', t('mk.manual')]]));
}

function paintWarnings(result, by, dropped) {
  const root = $('#mk-warn');
  root.textContent = '';
  const msgs = [];
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

  /* **실제로 누가 눌렸는지**를 적는다. 2세대는 순서를 밖에서 받지 않고 스스로 고르므로
     (게이지가 차면 열고, 같은 단계는 왼쪽 칸 우선) 계획이 아니라 결과가 나온다. */
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
  /* 같은 무늬가 이어지면 접는다. 자동 전투는 왼쪽 칸을 먼저 쓰므로 쿨타임이 짧으면
     같은 셋이 계속 나오는데, 그걸 일곱 줄로 늘어놓으면 정작 **누가 한 번도 안 나왔나**
     가 안 보인다. 접어 놓으면 그게 바로 읽힌다. */
  const list = el('ol', 'mk-rot');
  for (let i = 0; i < chains.length;) {
    const key = c => c.steps.join('>') + (c.void ? '!' : '');
    let j = i;
    while (j + 1 < chains.length && key(chains[j + 1]) === key(chains[i])) j++;
    const c = chains[i];
    const li = el('li', c.void ? 'is-void' : null, c.steps.join(' → ') || '—');
    if (j > i) li.appendChild(el('span', 'mk-repeat', `×${j - i + 1}`));
    /* 무효가 된 체인도 보여 준다. 쿨타임은 돌고 게이지는 날아갔으므로 실패도 결과다. */
    if (c.void) li.appendChild(el('span', 'mk-voidTag', t('mk.chainVoid')));
    list.appendChild(li);
    i = j + 1;
  }
  root.appendChild(list);

  /* **한 번도 안 나온 니케.** 왼쪽 칸 우선이라 쿨타임이 짧은 앞쪽이 계속 쓰이면
     뒤쪽은 버스트를 영영 못 쓴다 — 칸 순서를 바꾸라는 신호다. */
  const 쓴사람 = new Set(result.log.filter(l => l.kind === 'burst').map(l => l.actor));
  const 안쓴 = squad.filter(a => !쓴사람.has(a.id));
  if (안쓴.length && chains.length) {
    root.appendChild(el('p', 'mk-unused',
      t('mk.neverBurst', 안쓴.map(a => a.name).join(' · '))));
  }

  const b = result.fullBurst;
  /* 풀버스트 횟수를 가장 크게 적는다. 니케에서 시간당 딜을 정하는 것은 결국 이
     숫자이고, 사이클 길이는 그것이 왜 그렇게 나왔는지의 설명이다. */
  root.appendChild(el('p', 'mk-rotFoot',
    `${t('mk.fbCount', b.count)} · ${t('mk.fbEff')} ${Math.round(b.uptime)}초 / `
    + `${result.seconds}초 = ${Math.round(b.share * 100)}%`));

  const bits = [];
  if (b.avgCycle) bits.push(`${t('mk.avgCycle')} ${b.avgCycle.toFixed(1)}초`);
  /* **사이클을 셋으로 갈라 보인다** (메커니즘 16). 영상에서 이 셋의 합이 그대로
     주기와 맞았고, 어느 칸이 긴지가 곧 무엇을 고쳐야 하는지다 — 충전이면 게이지
     서포터, 반응이면 조작, 풀버스트 길이는 Ⅲ 을 쓰는 니케가 정한다. */
  if (b.avgCycle && b.count) {
    /* **온전히 끝난 구간만 평균 낸다.** 전투 종료에 걸려 잘린 마지막 풀버스트를 같이
       세면 길이가 짧게 나오고, 그 차이가 고스란히 충전 칸으로 밀려 들어간다. */
    const 온전 = b.windows.filter(w => w.to != null && w.to < result.seconds - 1e-9);
    const fb = 온전.length ? 온전.reduce((s, w) => s + (w.to - w.from), 0) / 온전.length
                           : b.uptime / b.count;
    const react = b.avgWait || 0;
    const fill = Math.max(0, b.avgCycle - react - fb);
    bits.push(t('mk.anatomy', `${fill.toFixed(1)}초`, `${react.toFixed(2)}초`,
                              `${fb.toFixed(1)}초`));
  }
  if (result.chains.voided.length) {
    bits.push(`${t('mk.voidCount', result.chains.voided.length)}`);
  }
  /* 체인·풀버스트 중에는 게이지가 안 찬다 (메커니즘 6). 그동안의 명중이 몇 발
     버려졌는지는 "왜 다음 사이클이 늦나" 의 답이다. */
  if (result.wastedHits) bits.push(`${t('mk.wasted', result.wastedHits)}`);
  if (bits.length) root.appendChild(el('p', 'mk-rotFoot', bits.join(' · ')));

  /* 니케별 버스트 게이지 충전 기여도. 대미지 기여도와는 별개 지표이며, 사이클의
     병목이 게이지 충전일 때 편성 판단 기준이 된다.

     평타분과 스킬분을 나누는 이유는 **증가시키는 수단이 다르기 때문**이다.
       · 평타분 — 재장전 속도·최대 장탄·연사 버프로 증가한다
       · 스킬분 — 스킬 발동 조건에 종속되므로 사격 관련 버프로는 증가하지 않는다
                  (신데렐라 : CW 는 스쿼드 누적 발사 200발당, 아니스 : 스타는 자신의
                  버스트 발동에 연동)
     집계값은 **게이지에 실제 반영된 양**이다 — 잠금 구간에서 버려진 명중은 여기
     들어가지 않고 `wastedHits` 로 따로 집계된다. */
  const 기여 = (result.gauge && result.gauge.by || []).filter(r => r.charged > 0);
  const 만충 = result.gauge && result.gauge.max;
  if (기여.length && 만충 > 0) {
    /* **단위는 게이지다.** 원시 수치(122,304 같은 값)는 만충 기준값을 모르면 읽을 수
       없고, 만충값이 바뀌면 같은 편성의 숫자가 통째로 달라진다. 한 사이클이 언제나
       0 -> 100% 이므로 그 비율로 환산하면 단위가 사라진다.

       누계는 전투 전체에서 채운 양을 게이지 하나 기준으로 환산한 값이다 — 350% 면
       이 니케 혼자 게이지를 세 번 반 채웠다는 뜻이다. 사이클당 평균은 그것을 게이지가
       찬 횟수로 나눈 것이라, 다섯 명의 값을 더하면 정확히 100% 가 된다.

       나누는 수는 체인 횟수가 아니라 **총 충전량 ÷ 만충** 이다. 전투가 충전 도중에
       끝나면 마지막 몫이 남아, 체인 횟수로 나누면 합이 100% 를 넘는다. */
    const 사이클 = Math.max(
      1e-9, 기여.reduce((x, r) => x + r.charged, 0) / 만충);
    const 게이지분 = r => (r.charged / 만충) * 100;
    const box = el('div', 'mk-charge');
    box.appendChild(el('p', 'mk-chargeHead', t('mk.chargeBy')));
    for (const r of 기여) {
      const a = squad.find(x => x.id === r.id);
      const row = el('div', 'mk-chargeRow');
      row.appendChild(el('b', null, a ? a.name : r.id));
      const bar = el('span', 'mk-chargeBar');
      bar.style.width = `${(r.charged / 기여[0].charged) * 100}%`;
      /* 평타분과 스킬분은 늘리는 수단이 다르다 — 평타분은 재장전·연사 버프로 늘고,
         스킬분은 스킬 발동 조건에 종속되어 안 는다. */
      for (const [k, v] of [['bullet', r.bullet], ['skill', r.skill]]) {
        if (!(v > 0)) continue;
        const seg = el('span', `mk-chargeSeg is-${k}`);
        seg.style.flexGrow = String(v);
        seg.title = `${t(k === 'bullet' ? 'mk.normal' : 'mk.skill')} `
          + `${((v / 만충) * 100).toFixed(0)}% (${t('mk.perCycle')} ${((v / 만충) * 100 / 사이클).toFixed(1)}%)`;
        bar.appendChild(seg);
      }
      row.appendChild(bar);
      row.appendChild(el('span', 'mk-chargeVal',
        `${Math.round(게이지분(r))}%`));
      row.appendChild(el('span', 'mk-chargeCycle',
        `${(게이지분(r) / 사이클).toFixed(1)}%`));
      box.appendChild(row);
    }
    /* 합계를 적어 둔다 — 사이클당 합이 100% 근처가 아니면 어딘가 새고 있다는 뜻이다. */
    const 합 = 기여.reduce((x, r) => x + 게이지분(r), 0);
    box.appendChild(el('p', 'mk-chargeFoot',
      t('mk.chargeTotal', Math.round(합), 사이클.toFixed(1), (합 / 사이클).toFixed(0))));
    root.appendChild(box);
  }

  /* 무엇이 사이클을 붙잡고 있는지. 이 한 줄이 "게이지 충전 속도 서포터를 넣을
     자리인가" 를 그대로 답한다 — 쿨타임이 바닥이면 넣어 봐야 안 변한다. */
  if (b.bound) {
    root.appendChild(el('p', 'mk-bound is-' + b.bound,
      t(b.bound === 'gauge' ? 'mk.boundGauge' : 'mk.boundCooldown')));
  }

  /* **모형의 초와 화면의 초가 다르다** (메커니즘 16). 버스트 컷신 동안은 전투가 흐르지
     않아 사이클에서 뺐는데, 그러면 녹화 영상과 초를 맞대 볼 때 모형이 훨씬 빨리 도는
     것처럼 보인다. 얼마를 더해야 맞대지는지를 적어 둔다. */
  if (b.count) {
    root.appendChild(el('p', 'mk-wall',
      t('mk.wallClock', Math.round(result.seconds + b.count * CUTIN), b.count)));
  }

  /* **결과가 잠정값에 기대고 있다는 사실을 숨기지 않는다.** 만충 기준값은 1세대가
     협전 로그로 역산한 것이고, 2세대는 게이지 잠금이 생겨 그 값이 틀릴 것이 거의
     확실하다. 이 줄이 없으면 사이클 숫자를 그대로 믿게 된다. */
  const 잠정 = (result.잠정 || []).filter(p => p.쓰는값 != null);
  if (잠정.length) {
    const box = el('details', 'mk-prov');
    const sum = el('summary', null, t('mk.provisional', 잠정.length));
    box.appendChild(sum);
    for (const p of 잠정) {
      box.appendChild(el('p', 'mk-provLine', `${p.뜻} = ${p.쓰는값} — ${p.왜잠정}`));
    }
    root.appendChild(box);
  }
}

/* ── 버프 추적 ─────────────────────────────────────────────── */

/* 그 순간 누구에게 무엇이 걸려 있나.

   합친 값만 보여 주면 쓸모가 절반이다 — "공격력 +180%" 가 한 줄인지 다섯 줄이
   겹친 것인지, 어느 스킬이 범인인지가 안 보인다. 그래서 스탯별 합계 아래에 **그
   합계를 만든 줄을 출처와 함께** 편다.

   이 화면이 실제로 값을 했다: 시전자 기준 공격력이 서로를 먹여 164초에 공격력이
   63배가 돼 있던 것을 여기서 찾았다. */
function snapAt(result, seconds) {
  const snaps = (result && result.snapshots) || [];
  if (!snaps.length) return null;
  const want = state.inspectAt == null ? snaps[snaps.length - 1].t : state.inspectAt;
  return snaps.reduce((best, s) =>
    (Math.abs(s.t - want) < Math.abs(best.t - want) ? s : best), snaps[0]);
}

/* 엔진은 버프의 출처를 `c017 s1[4]` 처럼 규칙 자리로 남긴다. 계산에는 그게 맞지만
   화면에서는 못 읽는다 — 니케 이름과 스킬 이름으로 풀고, 그 규칙에 적어 둔 해석
   메모를 툴팁으로 붙인다. 세팅·큐브처럼 규칙이 아닌 출처는 그대로 둔다. */
function sourceLabel(src) {
  const m = /^c(\d+)\s+(s1|s2|burst)\[(\d+)\]$/.exec(src || '');
  if (!m) return { text: src, note: null };
  const [, rid, slot, i] = m;
  const combat = D.combat[rid];
  if (!combat) return { text: src, note: null };
  const who = combat.name[current()] || combat.name.ko;
  const skill = (combat.skills || {})[slot];
  const SLOT = { s1: '1스킬', s2: '2스킬', burst: '버스트' };
  const label = skill ? (skill.name[current()] || skill.name.ko) : (SLOT[slot] || slot);
  const doc = D.effects[rid];
  const rule = doc && doc[slot] && doc[slot][Number(i)];
  return { text: `${who} · ${label}`, note: rule && rule.note ? rule.note : null };
}

function sourceSpan(cls, src) {
  const { text, note } = sourceLabel(src);
  const node = el('span', cls, text);
  /* 해석 메모를 툴팁으로. "왜 이 버프가 여기 붙었나" 가 그 한 줄에 적혀 있다. */
  if (note) node.title = note;
  return node;
}

function buffLines(list) {
  const box = el('div', 'mk-buffs');
  /* 같은 스탯끼리 묶는다. 값이 큰 것부터 — 이상한 값은 대개 맨 위에 있다. */
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
        li.appendChild(sourceSpan('mk-buffFrom', b.source));
        li.appendChild(el('span', 'mk-buffUntil',
                          b.until != null ? `${b.until.toFixed(1)}s` : t('mk.forever')));
        ul.appendChild(li);
      }
      row.appendChild(ul);
    } else {
      const one = lines[0];
      const p = el('p', 'mk-buffOne');
      p.appendChild(sourceSpan('mk-buffFrom', one.source));
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
  /* `input` 으로 즉시 따라가되 전체를 다시 계산하지는 않는다 — 시뮬레이션은 그대로
     두고 이 칸만 다시 그린다. 안 그러면 슬라이더가 끌리지 않는다. */
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
    /* 기본 공격력과 지금 공격력, 그리고 그 배율. 배율 하나가 "지금 얼마나 부풀어
       있는가" 를 한눈에 준다 — 이상하면 여기가 먼저 이상해진다. */
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
    sum.appendChild(el('span', 'mk-conf is-' + (a.effects.confidence || '추정'),
                       `${t('mk.confidence')} ${a.effects.confidence}`));
    if (a.effects.stale) sum.appendChild(el('span', 'mk-stale', t('mk.stale')));
    box.appendChild(sum);

    /* 규칙이 하나도 없으면 이 니케는 평타만 때린다. 미반영 목록은 아래에 뜨지만
       그건 "일부가 빠졌다"로 읽히기 쉽다 — 스킬이 통째로 안 들어갔다는 것은
       따로 말해 줘야 한다. 안 그러면 그냥 약한 니케로 보인다. */
    if (!a.effects.rules.length) box.appendChild(el('p', 'mk-noRules', t('mk.noRules')));

    for (const key of ['s1', 's2', 'burst']) {
      const src = (a.favorite && a.combat.favorite && a.combat.favorite.replaces
                   && a.combat.favorite.replaces[key]) || a.combat.skills[key];
      if (!src) continue;
      const h = el('p', 'mk-skillName', `[${key}] ${src.name[current()] || src.name.ko}`);
      box.appendChild(h);
      const pre = el('pre', 'mk-skillText', withValues(src, a.combat, key));
      box.appendChild(pre);
    }
    if (a.effects.unmodeled.length) {
      box.appendChild(el('p', 'mk-unmodHead', t('mk.unmodeled')));
      const ul = el('ul', 'mk-unmod');
      for (const u of a.effects.unmodeled) ul.appendChild(el('li', null, u));
      box.appendChild(ul);
    }
    root.appendChild(box);
  }
}

/* 원문의 `{1}` 자리에 그 스킬 레벨의 실제 값을 끼워 넣는다. 원문 그대로 두면
   해석이 맞는지 대조할 수가 없고, 값만 두면 무슨 효과인지 알 수가 없다. */
function withValues(skill, combat, key) {
  const text = skill.text[current()] || skill.text.ko || '';
  return text.replace(/\{(\d+)\}/g, (m, n) => {
    const row = skill.values[Number(n) - 1];
    const v = row && row[row.length - 1];
    return v == null ? m : String(v);
  });
}

async function paint() {
  await need(state.squad.filter(Boolean));
  const { squad, result, by, dropped } = run();
  paintSquad();
  paintConditions();
  paintWarnings(result, by, dropped);
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
  /* 색인에는 199명이 다 있지만, 효과표(의미 해석)가 있어야 계산이 된다.
     없는 니케도 보여 주되 잠가서 — 무엇이 남았는지가 그대로 할 일 목록이 된다. */
  const rows = [...D.index].sort((a, b) =>
    (b.effects - a.effects) || a.burst.localeCompare(b.burst)
    || (a.name[current()] || a.name.ko).localeCompare(b.name[current()] || b.name.ko));
  for (const n of rows) {
    const rid = pad(n.rid);
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
      표적수: state.표적수, 파츠있음: state.파츠있음, 저지부위있음: state.저지부위있음,
      코어명중: state.코어명중, 교전거리: state.교전거리,
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
    for (const k of ['seconds', 'level', 'enemyDef', 'fps', 'reaction', '표적수']) {
      if (Number.isFinite(raw[k])) state[k] = raw[k];
    }
    if (typeof raw.isElement === 'boolean') state.isElement = raw.isElement;
    if (typeof raw.코어명중 === 'boolean') state.코어명중 = raw.코어명중;
    if (typeof raw.교전거리 === 'string') state.교전거리 = raw.교전거리;
    if (raw.control === 'auto' || raw.control === 'manual') state.control = raw.control;
    if (raw.favorite && typeof raw.favorite === 'object') state.favorite = raw.favorite;
  } catch { /* 깨진 값이면 기본으로 */ }
}

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

  for (const b of document.querySelectorAll('[data-lang]')) {
    b.addEventListener('click', () => {
      setLang(b.dataset.lang);
      for (const x of document.querySelectorAll('[data-lang]')) {
        x.classList.toggle('on', x.dataset.lang === current());
      }
      paintStatic();
      paint();
    });
  }

  $('#theme').addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    document.documentElement.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('theme', dark ? 'light' : 'dark'); } catch { /* 무시 */ }
    $('#themeIcon').textContent = dark ? '☾' : '☀';
  });
}

/* ── 시작 ─────────────────────────────────────────────────── */

(async function start() {
  initLang();
  for (const b of document.querySelectorAll('[data-lang]')) {
    b.classList.toggle('on', b.dataset.lang === current());
  }
  paintStatic();
  try {
    await load();
  } catch (err) {
    $('#loading').hidden = true;
    const box = $('#error');
    box.hidden = false;
    box.textContent = `${t('ui.failed')}: ${err.message}`;
    return;
  }
  account = readAccount();
  restore();
  wire();
  $('#loading').hidden = true;
  $('#app').hidden = false;
  paint();
  $('#mk-meta').textContent = `Mekami · 니케 ${D.index.length}명 수록 · `
    + `효과표 ${supported().length}명 · 실측 기준 MG 예열 / 버스트 게이지 / `
    + `프레임 상한 ${state.fps}fps`;
}());
