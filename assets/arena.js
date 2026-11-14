/* 아레나 탭 (Draft) - 내 니케 스펙으로 덱을 짜고 버스트 타이밍을 프레임·초 단위로 비교한다. 계산은 arena-sim.js 가 하고, 이 파일은 편성 상태와 화면만 맡는다.
   내 스펙은 계산기 탭이 불러 둔 계정 자료를 읽고, 상대 스펙은 난이도 프리셋(arena-spec.js)으로 가정하며 칸마다 덮어쓸 수 있다. */

import { currentRoster, toInput } from './roster.js';
import { buildTables, compute, adjustedLevel } from './cp.js';
import { simulateBattle, COVER_BASE, COVER_DEF } from './arena-battle.js';
import {
  FPS, RL_FRAMES, HORIZON, chargeCut, sumChargeSpeed, simulateTeam, soloGainAt,
  configFromRoster, blankConfig, hasTreasureRule,
} from './arena-sim.js';
import { PRESETS, presetEntry, applyOverrides, migrateOverride } from './arena-spec.js';

const STORE = 'arena.state';
const SLOTS = 5;
const MODES = { rookie: 1, special: 3, champion: 5 };
const NS = 'http://www.w3.org/2000/svg';

/* 전투력 계산기와 같은 스탯표 - 자칼 링크 대상을 정할 최종 공격력에 쓴다. */
const STAT_TABLES = ['syncro_stat', 'attraction_stat', 'attraction_grade', 'equip_stat',
  'equip_option', 'cube_stat', 'collection_stat', 'collection_bonus'];
/* 챔피언 아레나만 레벨이 고정이고, 나머지는 현재 레벨 그대로다. */
const MODE_LEVEL = { champion: { mode: 'fix', at: 400 } };

let ctx = null, data = null, st = null, root = null, cubeTable = null, statT = null, presets = {};
let refs = null;               // 시점을 움직일 때 다시 칠할 칸들

const t = (k, ...a) => ctx.t(k, ...a);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const svg = (tag, attrs = {}, text) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text != null) n.textContent = text;
  return n;
};
const btn = (label, onClick, cls = 'btn-reset') => {
  const b = el('button', cls, label);
  b.type = 'button';
  b.onclick = onClick;
  return b;
};
const emptyDeck = () => Array(SLOTS).fill(null);

/* ── 상태 ─────────────────────────────────────────────────── */
function defaults() {
  const decks = {};
  for (const [mode, n] of Object.entries(MODES)) {
    decks[mode] = {
      me: Array.from({ length: n }, emptyDeck),
      foe: Array.from({ length: n }, emptyDeck),
    };
  }
  return { mode: 'rookie', side: 'attack', unit: 'sec', match: 0, frame: RL_FRAMES * 3, decks, foeCfg: {},
    preset: 'basic', link: {}, tune: { damage: 100 } };
}

function restore() {
  const base = defaults();
  try {
    const s = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (!s) return base;
    const out = { ...base, ...s, decks: base.decks };
    for (const [mode, n] of Object.entries(MODES)) {
      for (const who of ['me', 'foe']) {
        const saved = s.decks?.[mode]?.[who];
        if (Array.isArray(saved)) {
          out.decks[mode][who] = base.decks[mode][who].map((deck, i) =>
            deck.map((_, p) => (data.nikkes[saved[i]?.[p]] ? saved[i][p] : null)));
        }
      }
    }
    if (!MODES[out.mode]) out.mode = 'rookie';
    if (!PRESETS.includes(out.preset)) out.preset = 'basic';
    out.tune = { damage: Number(s.tune?.damage) || 100 };
    /* 상대 칸 덮어쓰기 - 예전 형식(차지 속도·버충 큐브·애장품 표시)은 새 형식으로 바꾼다 */
    out.foeCfg = {};
    for (const [k, v] of Object.entries(s.foeCfg || {})) {
      const ov = migrateOverride(v, data);
      if (ov) out.foeCfg[k] = ov;
    }
    out.link = s.link && typeof s.link === 'object' ? s.link : {};
    return out;
  } catch { return base; }
}
const save = () => { try { localStorage.setItem(STORE, JSON.stringify(st)); } catch { /* 무시 */ } };

/* ── 내 스펙 ──────────────────────────────────────────────── */
let rosterMap = null;
function loadRoster() {
  const r = currentRoster();
  rosterMap = new Map();
  if (!r) return false;
  const byCode = new Map(ctx.nikkes.map(n => [n.name_code, n]));
  for (const e of r.nikkes) {
    const n = byCode.get(e.name_code);
    if (n && data.nikkes[n.rid]) rosterMap.set(n.rid, e);
  }
  return rosterMap.size > 0;
}
const hasRoster = () => rosterMap && rosterMap.size > 0;

function myConfig(rid) {
  const e = rosterMap?.get(rid);
  return e ? configFromRoster(data, e, data.nikkes[rid]?.weapon) : blankConfig();
}
const foeKey = (mode, match, pos) => `${mode}:${match}:${pos}`;

/* 상대 칸 항목 = 고른 난이도 프리셋 + 그 칸의 덮어쓰기. 내 로스터 항목과 같은 모양이라 같은 계산을 탄다. */
const research = () => currentRoster()?.research || { common: 0, class: {}, corporation: {} };
const myLevel = () => currentRoster()?.account?.synchro_level || 400;
const entryCache = new Map();
function presetOnly(rid) {
  const key = `${st.preset}|${rid}`;
  if (!entryCache.has(key)) {
    entryCache.set(key, presetEntry(st.preset, rid, {
      data, T: statT, presets, rosterMap,
      nikkeOf: r => ctx.byRid.get(r), weaponOf: r => data.nikkes[r]?.weapon, level: myLevel(),
    }));
  }
  return entryCache.get(key);
}
const foeOverride = (mode, match, pos) => st.foeCfg[foeKey(mode, match, pos)] || null;
const foeEntry = (mode, match, pos, rid) => applyOverrides(presetOnly(rid), foeOverride(mode, match, pos));

/* 차지 속도 덮어쓰기는 오버로드 차속 줄을 빼고(applyOverrides) 그 % 를 앞에 둔다 - 큐브 차지 속도는 그대로 */
function foeConfig(mode, match, pos, rid) {
  const e = foeEntry(mode, match, pos, rid);
  const cfg = configFromRoster(data, e, data.nikkes[rid]?.weapon);
  if (e.chargeOverride != null) cfg.chargeValues = [e.chargeOverride, ...cfg.chargeValues].filter(v => v > 0);
  return cfg;
}
/* 덮어쓰기 없이 프리셋만의 오버로드 차속 합 (입력칸 기본값) */
function presetCharge(rid) {
  const e = presetOnly(rid);
  const vals = configFromRoster(data, { ...e, arena_cube: { tid: null, level: 0 } }, data.nikkes[rid]?.weapon).chargeValues;
  return sumChargeSpeed(vals);
}

/* 아레나 [최종] 공격력 - 전투 중 받는 버프까지 포함한 값이다.
   링크는 전투 시작 시 정해지므로 그 시점에 걸린 오버로드 옵션과 자기 버프 스킬까지 넣는다.
   상대 스펙은 모르니 같은 레벨의 맨몸 값에 스킬 레벨 10 버프로 비교한다. */
function arenaLevel(mode, level) {
  const rule = MODE_LEVEL[mode];
  return rule ? adjustedLevel(rule.mode, level, rule.at) : level;
}

const statCache = new Map();

function statInput(n, base) {
  return { ...base, rarity: n.rarity, class: n.class, corporation: n.corporation,
    weapon: n.weapon_type, defWeapon: n.weapon_type };
}

const finalAtk = (mode, who, rid, match, pos) => battleStats(mode, who, rid, match, pos)?.atk ?? null;

/* 캐시는 칠할 때마다 비운다 (paint) - 상대는 칸마다 덮어쓰기가 달라 자리까지 키에 넣는다. */
function battleStats(mode, who, rid, match, pos) {
  const key = who === 'me' ? `${mode}|me|${rid}` : `${mode}|foe|${match}|${pos}|${rid}`;
  if (!statCache.has(key)) statCache.set(key, computeStats(mode, who, rid, match, pos));
  return statCache.get(key);
}

function computeStats(mode, who, rid, match, pos) {
  const n = ctx.byRid.get(rid);
  if (!statT || !n) return null;
  const e = who === 'me' ? rosterMap?.get(rid) : foeEntry(mode, match, pos, rid);
  return entryStats(mode, n, e || blankEntry());
}

/* 로스터 모양 항목 하나의 아레나 스탯. 내 니케·상대 프리셋이 같은 길을 탄다.
   공증·우코·크확·크댐·차댐은 전투 중 % 로 들어가고(전투력 스탯에는 없다), 큐브는 아레나 큐브 레벨로 계산한다. */
function entryStats(mode, n, e) {
  const input = statInput(n, toInput(e, n, research(), statT.bondMax));
  input.cube = e.arena_cube?.level ? String(e.arena_cube.level) : '미착용';
  const level = arenaLevel(mode, e.level || myLevel());
  const res = compute(statT, input, level);
  if (!res) return null;
  const opt = name => (e.gear || []).flatMap(g => g.options || []).filter(o => o.name === name)
    .reduce((sum, o) => sum + (statT.optionValue.get(`${name}|${o.level}`) || 0), 0);
  return {
    atk: withStartBuff(n.rid, res.stats, opt('공증'), e.skills),
    hp: res.stats.hp,
    def: res.stats.def,
    critRate: 0.15 + opt('크확'),
    critDamage: 0.5 + opt('크댐'),
    elementBonus: opt('우코'),
    chargeBonus: opt('차댐'),
    ...coverAt(n, level),
  };
}

const blankInput = n => statInput(n, { grade: '0돌', bond: 1, console: {}, gear: [], cube: '미착용',
  collection: { kind: 'none', level: '0' }, skills: {} });
const blankEntry = () => presetEntry('basic', null, { level: myLevel() });

/* 엄폐물 값(COVER_BASE, COVER_DEF)은 400레벨 실측값이다. 다른 레벨은 맨몸 니케 체력·방어력의 400레벨 대비 배율로 추정한다. */
function coverAt(n, level) {
  if (level === 400) return {};
  const at = compute(statT, blankInput(n), level)?.stats;
  const ref = compute(statT, blankInput(n), 400)?.stats;
  if (!at || !ref) return {};
  return { coverBase: COVER_BASE * at.hp / ref.hp, coverDef: COVER_DEF * at.def / ref.def };
}

function withStartBuff(rid, stats, optionPct, skills) {
  const b = data.startAtk?.[rid];
  const value = b ? (b.values[(skills?.[b.skill] ?? 10) - 1] || 0) / 100 : 0;
  const pct = 1 + optionPct + (b?.kind === 'pct' ? value : 0);
  return Math.round(stats.atk * pct + (b?.kind === 'hp' ? stats.hp * value : 0));
}

const linkKey = (mode, who, match) => `${mode}:${who}:${match}`;
const linkSizeOf = (rid, skills) => {
  const l = data.rules[rid]?.link;
  return l ? l.values[(skills?.[l.skill] ?? 10) - 1] : 0;
};

function linkSlots(mode, who, match) {
  const deck = st.decks[mode][who][match];
  const caster = deck.findIndex(rid => rid && data.rules[rid]?.link);
  if (caster < 0) return null;
  const skills = who === 'me' ? myConfig(deck[caster])?.skills : foeEntry(mode, match, caster, deck[caster]).skills;
  const size = linkSizeOf(deck[caster], skills);
  const others = deck.flatMap((rid, pos) => (rid && pos !== caster ? [pos] : []));
  const saved = st.link[linkKey(mode, who, match)];
  const picked = Array.isArray(saved) ? saved.filter(p => others.includes(p)).slice(0, size) : null;
  const auto = () => others.map(pos => ({ pos, atk: finalAtk(mode, who, deck[pos], match, pos) ?? -1 }))
    .sort((a, b) => b.atk - a.atk || a.pos - b.pos)
    .slice(0, size)
    .map(row => row.pos);
  return { caster, size, slots: picked || auto(), manual: !!picked };
}

function teamOf(mode, who, match) {
  const link = linkSlots(mode, who, match);
  return st.decks[mode][who][match].map((rid, pos) => {
    if (!rid) return null;
    const cfg = who === 'me' ? myConfig(rid) : foeConfig(mode, match, pos, rid);
    if (link && pos === link.caster) cfg.linkSlots = link.slots;
    /* 스탯표를 못 받으면 전투는 못 돌린다 - 그래도 게이지는 돌도록 체력을 크게 둔다. */
    const stats = battleStats(mode, who, rid, match, pos)
      || { atk: 1, hp: 1e12, def: 0, critRate: 0.15, critDamage: 0.5, elementBonus: 0, chargeBonus: 0 };
    return { rid, cfg, stats };
  });
}
const otherSide = side => (side === 'attack' ? 'defense' : 'attack');

function simulateMatch(mode, match) {
  const r = simulateBattle(data,
    { team: teamOf(mode, 'me', match), side: st.side },
    { team: teamOf(mode, 'foe', match), side: otherSide(st.side) },
    { damageScale: st.tune.damage / 100 });
  return { me: r.a, foe: r.b };
}

/* ── 표시 형식 ────────────────────────────────────────────── */
const secText = f => t('ar.sec', (f / FPS).toFixed(2));
const frameText = f => t('ar.frame', f);
const timeText = f => (f == null ? '-' : st.unit === 'sec' ? secText(f) : frameText(f));
const diffText = d => {
  const sign = d > 0 ? '+' : d < 0 ? '−' : '';
  const a = Math.abs(d);
  return sign + (st.unit === 'sec' ? secText(a) : frameText(a));
};
const nikkeName = rid => ctx.nameOf(ctx.byRid.get(rid)) || rid;
const cutText = pct => { const c = chargeCut(pct); return c ? `−${c}f` : '0f'; };

function verdict(me, foe) {
  const a = me.fullBurst, b = foe.fullBurst;
  if (a == null && b == null) return { key: 'ar.vNone', diff: null };
  if (a == null) return { key: 'ar.vFoe', diff: null };
  if (b == null) return { key: 'ar.vMe', diff: null };
  if (a === b) return { key: 'ar.vTie', diff: 0 };
  return { key: a < b ? 'ar.vMe' : 'ar.vFoe', diff: a - b };
}

/* ── 자동 편성 ────────────────────────────────────────────────
   점수는 버스트 속도뿐이다 - 대미지와 생존은 보지 않는다.
   투자한 니케(오버로드 장비나 아레나 큐브)를 먼저 쓰고, 모자라면 나머지에서 고른다. */
function invested(rid) {
  const e = rosterMap.get(rid);
  return !!e && (e.gear.some(g => g.tier === '오버로드') || !!e.arena_cube?.tid);
}

function bestDeck(pool, used) {
  const free = pool.filter(r => !used.has(r.rid));
  const byStep = step => free.filter(r => data.nikkes[r.rid].step === step || data.nikkes[r.rid].step === 0)
    .slice(0, 6);
  const fastest = (a, b) => (a.score < b.score ? a : b);
  let best = null;
  for (const a of byStep(1)) for (const b of byStep(2)) for (const c of byStep(3)) {
    const ids = [...new Set([a.rid, b.rid, c.rid])];
    if (ids.length < 3) continue;
    const fill = free.filter(r => !ids.includes(r.rid)).slice(0, SLOTS - ids.length).map(r => r.rid);
    const deck = [...ids, ...fill];
    while (deck.length < SLOTS) deck.push(null);
    const sim = simulateTeam(data, deck.map(rid => (rid ? { rid, cfg: myConfig(rid) } : null)), st.side);
    if (sim.fullBurst == null) continue;
    const row = { deck, score: sim.fullBurst - sim.gauge[RL_FRAMES * 3] / 1000 };
    best = best ? fastest(best, row) : row;
  }
  return best?.deck || null;
}

function autoCompose() {
  if (!hasRoster()) return;
  const n = MODES[st.mode];
  const horizon = RL_FRAMES * 4;
  const rows = [...rosterMap.keys()].map(rid => ({
    rid,
    gain: soloGainAt(data, rid, myConfig(rid), horizon),
    invested: invested(rid),
  }));
  const rank = list => list.sort((a, b) => b.gain - a.gain);
  const used = new Set();
  const decks = [];
  for (let i = 0; i < n; i++) {
    const deck = bestDeck(rank(rows.filter(r => r.invested)), used)
      || bestDeck(rank(rows.slice()), used)
      || emptyDeck();
    deck.forEach(rid => rid && used.add(rid));
    decks.push(deck);
  }
  st.decks[st.mode].me = decks;
  commit();
}

function copyToFoe() {
  const d = st.decks[st.mode];
  d.foe = d.me.map(deck => deck.slice());
  commit();
}

function commit() { save(); paint(); }

/* ── 화면 ─────────────────────────────────────────────────── */
function segmented(options, value, onPick, label) {
  const g = el('div', 'ar-seg');
  g.setAttribute('role', 'group');
  if (label) g.setAttribute('aria-label', label);
  for (const [v, text] of options) {
    const b = el('button', null, text);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(v === value));
    b.onclick = () => onPick(v);
    g.appendChild(b);
  }
  return g;
}

function controls() {
  const wrap = el('section', 'op-group ar-controls');
  const head = el('div', 'ar-head');
  const title = el('h3', null, t('ar.title'));
  title.appendChild(el('span', 'ar-draft', 'Draft'));
  head.appendChild(title);
  wrap.appendChild(head);
  wrap.appendChild(el('p', 'op-note', t('ar.lead')));

  const row = el('div', 'ar-ctlrow');
  row.appendChild(segmented(Object.keys(MODES).map(m => [m, t('ar.mode.' + m)]), st.mode, m => {
    st.mode = m; st.match = 0; commit();
  }, t('ar.modeLabel')));
  row.appendChild(segmented([['attack', t('ar.attack')], ['defense', t('ar.defense')]], st.side, s => {
    st.side = s; commit();
  }, t('ar.sideLabel')));
  row.appendChild(segmented([['sec', t('ar.unitSec')], ['frame', t('ar.unitFrame')]], st.unit, u => {
    st.unit = u; commit();
  }, t('ar.unitLabel')));
  const auto = btn(t('ar.auto'), autoCompose);
  auto.disabled = !hasRoster();
  auto.title = t('ar.autoHint');
  row.appendChild(auto);
  row.appendChild(btn(t('ar.copyFoe'), copyToFoe));
  row.appendChild(btn(t('ar.resetDecks'), () => {
    st.decks[st.mode] = defaults().decks[st.mode];
    commit();
  }));
  wrap.appendChild(row);

  /* 상대 난이도 - 상대 스펙은 알 수 없어 고른 프리셋으로 가정한다 (arena-spec.js). */
  const presetRow = el('div', 'ar-ctlrow');
  presetRow.appendChild(segmented(PRESETS.map(p => [p, t('ar.preset.' + p)]), st.preset, p => {
    st.preset = p; commit();
  }, t('ar.presetLabel')));
  wrap.appendChild(presetRow);
  wrap.appendChild(el('p', 'op-note ar-presetNote', t('ar.presetNote.' + st.preset)));
  if (st.preset !== 'basic' && st.preset !== 'mirror') wrap.appendChild(el('p', 'op-note ar-presetNote', t('ar.presetOptions')));

  /* 전체 대미지 보정 - 대미지 모델이 실제와 어긋날 때 직접 맞춰 볼 수 있게 한다. */
  const tuneRow = el('div', 'ar-ctlrow ar-tuneRow');
  for (const [key, label] of [['damage', 'ar.tuneDamage']]) {
    const lab = el('label', 'ar-tuneItem', t(label));
    const input = el('input', 'ar-num');
    input.type = 'number';
    input.min = 1; input.max = 1000; input.step = 5;
    input.value = st.tune[key];
    input.onchange = () => {
      st.tune[key] = Math.max(1, Math.min(1000, Number(input.value) || 100));
      commit();
    };
    lab.append(input, document.createTextNode('%'));
    tuneRow.appendChild(lab);
  }
  wrap.appendChild(tuneRow);

  if (!hasRoster()) {
    const n = el('p', 'ar-warn');
    n.appendChild(document.createTextNode(t('ar.noRoster') + ' '));
    n.appendChild(btn(t('ar.toCalc'), () => ctx.goTab('calc')));
    wrap.appendChild(n);
  }
  return wrap;
}

function deckLabel(mode, who, match) {
  const names = st.decks[mode][who][match].filter(Boolean).map(nikkeName);
  return names.length ? names.join(' · ') : t('ar.emptyDeck');
}

function summary() {
  const wrap = el('section', 'op-group');
  wrap.appendChild(el('h3', null, t('ar.summary')));
  const scroll = el('div', 'op-scroll');
  const table = el('table', 'grid ar-table');
  const thead = el('thead');
  const hr = el('tr');
  for (const k of ['ar.colDeck', 'ar.colMyDeck', 'ar.colMe', 'ar.colFoeDeck', 'ar.colFoe', 'ar.colDiff', 'ar.colVerdict']) {
    hr.appendChild(el('th', null, t(k)));
  }
  thead.appendChild(hr);
  table.appendChild(thead);
  const tb = el('tbody');
  for (let i = 0; i < MODES[st.mode]; i++) {
    const sim = simulateMatch(st.mode, i);
    const v = verdict(sim.me, sim.foe);
    const tr = el('tr', 'is-click' + (i === st.match ? ' is-on' : ''));
    tr.onclick = () => { st.match = i; commit(); };
    tr.appendChild(el('td', 'num', String(i + 1)));
    tr.appendChild(el('td', 'ar-names', deckLabel(st.mode, 'me', i)));
    tr.appendChild(el('td', 'num', burstCell(sim.me)));
    tr.appendChild(el('td', 'ar-names', deckLabel(st.mode, 'foe', i)));
    tr.appendChild(el('td', 'num', burstCell(sim.foe)));
    tr.appendChild(el('td', 'num', v.diff == null ? '-' : diffText(v.diff)));
    tr.appendChild(el('td', null, t(v.key)));
    tb.appendChild(tr);
  }
  table.appendChild(tb);
  scroll.appendChild(table);
  wrap.appendChild(scroll);
  return wrap;
}

function burstCell(sim) {
  if (sim.gauge.at(-1) === 0) return '-';      // 빈 덱
  if (sim.fullBurst != null) return timeText(sim.fullBurst);
  if (sim.full != null) return t('ar.noChain');
  return t('ar.notFull');
}

/* 다른 칸에 들어간 니케는 고를 수 없다 - 게임도 한쪽에서 한 니케를 한 번만 쓴다. */
function nikkeSelect(who, match, pos) {
  const deckSet = st.decks[st.mode][who];
  const cur = deckSet[match][pos];
  const taken = new Set(deckSet.flat().filter(Boolean));
  const s = el('select', 'ar-pick');
  s.setAttribute('aria-label', `${who === 'me' ? t('ar.me') : t('ar.foe')} P${pos + 1}`);
  s.appendChild(new Option(t('ar.emptySlot'), ''));
  const pool = who === 'me' && hasRoster()
    ? ctx.nikkes.filter(n => rosterMap.has(n.rid))
    : ctx.nikkes.filter(n => data.nikkes[n.rid]);
  for (const step of [1, 2, 3, 0]) {
    const og = document.createElement('optgroup');
    og.label = step ? t('ar.step', step) : t('ar.stepAll');
    const rows = pool.filter(n => data.nikkes[n.rid].step === step)
      .sort((a, b) => ctx.nameOf(a).localeCompare(ctx.nameOf(b), ctx.lang));
    for (const n of rows) {
      const o = new Option(ctx.nameOf(n), n.rid);
      if (taken.has(n.rid) && n.rid !== cur) o.disabled = true;
      og.appendChild(o);
    }
    if (rows.length) s.appendChild(og);
  }
  s.value = cur || '';
  s.onchange = () => {
    deckSet[match][pos] = s.value || null;
    /* 니케를 바꾸면 그 칸의 상대 덮어쓰기는 앞 니케 것이라 지운다 */
    if (who === 'foe') delete st.foeCfg[foeKey(st.mode, match, pos)];
    commit();
  };
  return s;
}

function iconsFor(rid) {
  const n = ctx.byRid.get(rid);
  const box = el('span', 'ar-icons');
  if (!n) return box;
  for (const [axis, code] of [['burst', n.burst], ['weapon_type', n.weapon_type]]) {
    const ic = ctx.iconEl(axis, code);
    if (ic) { ic.title = ctx.L(axis, code); box.appendChild(ic); }
  }
  return box;
}

const cubeName = tid => cubeTable?.[tid]?.[ctx.lang]?.short || `#${tid}`;
const skillText = sk => ['s1', 's2', 'burst'].map(k => sk?.[k] ?? 10).join('/');
function collText(c) {
  if (!c || c.kind === 'none') return t('ar.collNone');
  if (c.kind === '애장품') return `${t('ar.treasure')} ${parseInt(c.level, 10) || 0}`;
  return `${c.kind} ${c.level}`;
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const options = (sel, rows, value) => {
  for (const [v, label] of rows) sel.appendChild(new Option(label, String(v)));
  sel.value = String(value);
  return sel;
};

/* 칸 스펙: 차지 속도 · 스킬 · 큐브 · 소장품. 내 니케는 로스터 값을, 상대는 고른 난이도의 값을 보여 준다.
   상대 값을 바꾸면 그 칸의 덮어쓰기로 저장한다 (st.foeCfg, arena-spec.js applyOverrides). */
function specCells(who, match, pos, rid, tr) {
  const charge = el('td', 'num ar-spec');
  const skill = el('td', 'ar-skill');
  const cube = el('td', 'ar-cube');
  const coll = el('td', 'ar-coll');
  tr.append(charge, skill, cube, coll);
  if (!rid) return;
  const base = data.nikkes[rid].charge;
  if (who === 'me') {
    const cfg = myConfig(rid);
    const sum = sumChargeSpeed(cfg.chargeValues);
    charge.textContent = base ? `${sum}% · ${cutText(sum)}` : '-';
    const e = rosterMap?.get(rid);
    skill.textContent = e ? skillText(e.skills) : '-';
    const tid = e?.arena_cube?.tid;
    cube.textContent = tid ? `${cubeName(tid)} ${e.arena_cube.level}` : t('ar.noCube');
    coll.textContent = e ? collText(e.collection) : '-';
    return;
  }
  const key = foeKey(st.mode, match, pos);
  const ov = st.foeCfg[key] || {};
  const e = foeEntry(st.mode, match, pos, rid);
  const set = patch => { st.foeCfg[key] = { ...(st.foeCfg[key] || {}), ...patch }; commit(); };

  if (base) {
    const input = el('input', 'ar-num');
    input.type = 'number';
    input.min = 0; input.max = 60; input.step = 0.1;
    input.value = ov.charge ?? presetCharge(rid);
    input.setAttribute('aria-label', t('ar.colCharge'));
    input.onchange = () => set({ charge: clamp(Number(input.value) || 0, 0, 60) });
    const total = sumChargeSpeed(foeConfig(st.mode, match, pos, rid).chargeValues);
    charge.append(input, document.createTextNode(` · ${cutText(total)}`));
  } else charge.textContent = '-';

  for (const k of ['s1', 's2', 'burst']) {
    const input = el('input', 'ar-num ar-lv');
    input.type = 'number';
    input.min = 1; input.max = 10; input.step = 1;
    input.value = e.skills?.[k] ?? 10;
    input.setAttribute('aria-label', t('ar.skill.' + k));
    input.title = t('ar.skill.' + k);
    input.onchange = () => set({ skills: { ...(ov.skills || {}), [k]: clamp(Math.round(Number(input.value) || 10), 1, 10) } });
    skill.appendChild(input);
  }

  const tid = e.arena_cube?.tid || '';
  const typeSel = options(el('select', 'ar-pickS'), [['', t('ar.noCube')],
    ...Object.keys(cubeTable || {}).map(id => [id, cubeName(id)]).sort((a, b) => a[1].localeCompare(b[1], ctx.lang))], tid);
  typeSel.setAttribute('aria-label', t('ar.colCube'));
  const lvSel = options(el('select', 'ar-pickS'),
    Array.from({ length: 15 }, (_, i) => [i + 1, t('ar.cubeLv', i + 1)]), e.arena_cube?.level || 15);
  lvSel.setAttribute('aria-label', t('ar.colCube'));
  lvSel.disabled = !tid;
  const setCube = () => set({ cube: { tid: Number(typeSel.value) || null, level: Number(lvSel.value) || 15 } });
  typeSel.onchange = setCube;
  lvSel.onchange = setCube;
  cube.append(typeSel, lvSel);

  const kinds = [['none', t('ar.collNone')], ['R', 'R'], ['SR', 'SR'],
    /* 애장품이 있는 니케 (스킬 교체 데이터 fav 또는 애장품 게이지 규칙) */
    ...(data.nikkes[rid]?.fav || hasTreasureRule(data, rid) ? [['애장품', t('ar.treasure')]] : [])];
  const c = e.collection || { kind: 'none', level: '0' };
  const kindSel = options(el('select', 'ar-pickS'), kinds, kinds.some(([k]) => k === c.kind) ? c.kind : 'none');
  kindSel.setAttribute('aria-label', t('ar.colColl'));
  const levels = c.kind === '애장품' ? [0, 1, 2].map(v => [`${v}.0`, String(v)])
    : Array.from({ length: 16 }, (_, i) => [String(i), String(i)]);
  const lvColl = options(el('select', 'ar-pickS'), levels, c.kind === '애장품' ? `${parseInt(c.level, 10) || 0}.0` : String(c.level ?? 15));
  lvColl.setAttribute('aria-label', t('ar.colColl'));
  lvColl.disabled = c.kind === 'none';
  kindSel.onchange = () => {
    const kind = kindSel.value;
    set({ collection: { kind, level: kind === '애장품' ? '2.0' : kind === 'none' ? '0' : '15' } });
  };
  lvColl.onchange = () => set({ collection: { kind: c.kind, level: lvColl.value } });
  coll.append(kindSel, lvColl);
}

/* 자칼 링크 대상 고르기. 자칼 칸에는 표시하지 않고, 정원이 차면 나머지는 잠근다. */
function linkToggle(who, match, pos) {
  const link = linkSlots(st.mode, who, match);
  if (!link || pos === link.caster) return null;
  const lab = el('label', 'ar-check');
  const box = el('input');
  box.type = 'checkbox';
  box.checked = link.slots.includes(pos);
  box.disabled = !box.checked && link.slots.length >= link.size;
  box.onchange = () => {
    st.link[linkKey(st.mode, who, match)] = box.checked
      ? [...link.slots, pos] : link.slots.filter(p => p !== pos);
    commit();
  };
  lab.title = t('ar.linkHint');
  lab.append(box, document.createTextNode(' ' + t('ar.link')));
  const atk = finalAtk(st.mode, who, st.decks[st.mode][who][match][pos], match, pos);
  if (atk != null) lab.appendChild(el('span', 'ar-linkAtk', t('ar.atk', atk.toLocaleString())));
  return lab;
}

/* 규칙 출처 - 계산을 얼마나 믿어도 되는지 칸마다 보여준다. */
function sourceText(rid) {
  const r = data.rules[rid]?.r;
  return t(r === 'm' ? 'ar.srcMeasured' : r === 's' ? 'ar.srcSite' : r === 'e' ? 'ar.srcEstimate' : 'ar.srcBase');
}

function deckTable(who, match, sim) {
  const box = el('div', 'ar-deck');
  const head = el('h4', 'ar-deckHead');
  const dot = el('span', 'ar-dot ' + (who === 'me' ? 'is-me' : 'is-foe'));
  head.append(dot, document.createTextNode(`${who === 'me' ? t('ar.me') : t('ar.foe')} · ${t(st.side === (who === 'me' ? 'attack' : 'defense') ? 'ar.attack' : 'ar.defense')}`));
  const link = linkSlots(st.mode, who, match);
  if (link?.manual) {
    head.appendChild(btn(t('ar.linkAuto'), () => {
      delete st.link[linkKey(st.mode, who, match)];
      commit();
    }, 'btn-reset ar-linkReset'));
  }
  box.appendChild(head);
  const scroll = el('div', 'op-scroll');
  const table = el('table', 'grid ar-table ar-slots');
  const thead = el('thead');
  const hr = el('tr');
  ['ar.colSlot', 'ar.colNikke', 'ar.colCharge', 'ar.colSkill', 'ar.colCube', 'ar.colColl', 'ar.colGain', 'ar.colHp', 'ar.colSource'].forEach(k =>
    hr.appendChild(el('th', null, t(k))));
  thead.appendChild(hr);
  table.appendChild(thead);
  const tb = el('tbody');
  refs.gain[who] = [];
  refs.hp[who] = [];
  st.decks[st.mode][who][match].forEach((rid, pos) => {
    const tr = el('tr');
    tr.appendChild(el('td', 'num', `P${pos + 1}`));
    const name = el('td', 'ar-nameCell');
    if (rid) name.appendChild(iconsFor(rid));
    name.appendChild(nikkeSelect(who, match, pos));
    const toggle = rid && linkToggle(who, match, pos);
    if (toggle) name.appendChild(toggle);
    /* 이 칸에서 바꾼 값이 있으면 난이도 값으로 되돌리는 버튼 */
    if (who === 'foe' && rid && st.foeCfg[foeKey(st.mode, match, pos)]) {
      const reset = btn(t('ar.ovReset'), () => { delete st.foeCfg[foeKey(st.mode, match, pos)]; commit(); }, 'btn-reset ar-ovReset');
      reset.title = t('ar.ovResetHint');
      name.appendChild(reset);
    }
    tr.appendChild(name);
    specCells(who, match, pos, rid, tr);
    const gain = el('td', 'num');
    refs.gain[who][pos] = gain;
    tr.appendChild(gain);
    const hp = el('td', 'num');
    refs.hp[who][pos] = hp;
    tr.appendChild(hp);
    tr.appendChild(el('td', 'ar-src', rid ? sourceText(rid) : ''));
    tb.appendChild(tr);
  });
  table.appendChild(tb);
  scroll.appendChild(table);
  box.appendChild(scroll);
  return box;
}

/* ── 게이지 차트 ──────────────────────────────────────────── */
const C = { w: 1000, h: 396, l: 52, r: 18, t: 84, b: 42 };

function chartDomain(sim) {
  const last = Math.max(sim.me.fullBurst ?? 0, sim.foe.fullBurst ?? 0, sim.me.full ?? 0, sim.foe.full ?? 0,
    ...sim.me.deaths.map(d => d.f), ...sim.foe.deaths.map(d => d.f));
  return Math.min(HORIZON, Math.max(RL_FRAMES * 3, Math.ceil((last + 30) / RL_FRAMES) * RL_FRAMES));
}

function gaugePath(gauge, xOf, yOf, maxF) {
  let d = `M${xOf(0)} ${yOf(gauge[0])}`;
  let prev = gauge[0];
  for (let f = 1; f <= maxF; f++) {
    if (gauge[f] !== prev) {
      d += `H${xOf(f).toFixed(1)}V${yOf(gauge[f]).toFixed(1)}`;
      prev = gauge[f];
    }
  }
  return d + `H${xOf(maxF).toFixed(1)}`;
}

function gaugeChart(sim) {
  const maxF = chartDomain(sim);
  const plotW = C.w - C.l - C.r, plotH = C.h - C.t - C.b;
  const xOf = f => C.l + (f / maxF) * plotW;
  const yOf = v => C.t + (1 - v / 100) * plotH;
  const box = el('div', 'ar-chart');
  const s = svg('svg', { viewBox: `0 0 ${C.w} ${C.h}`, role: 'img', 'aria-label': t('ar.chartLabel') });

  for (const v of [0, 25, 50, 75, 100]) {
    s.appendChild(svg('line', { x1: C.l, x2: C.w - C.r, y1: yOf(v), y2: yOf(v), class: 'ar-grid' }));
    s.appendChild(svg('text', { x: C.l - 8, y: yOf(v) + 5, class: 'ar-axis', 'text-anchor': 'end' }, String(v)));
  }
  const step = maxF > RL_FRAMES * 9 ? 2 : 1;
  for (let k = 0; k * RL_FRAMES <= maxF; k += step) {
    const f = k * RL_FRAMES;
    s.appendChild(svg('line', { x1: xOf(f), x2: xOf(f), y1: C.t, y2: C.t + plotH, class: 'ar-grid' }));
    const label = st.unit === 'sec' ? (f / FPS).toFixed(1) : String(f);
    s.appendChild(svg('text', { x: xOf(f), y: C.h - 22, class: 'ar-axis', 'text-anchor': 'middle' }, label));
    if (k) s.appendChild(svg('text', { x: xOf(f), y: C.h - 4, class: 'ar-axis ar-axisRl', 'text-anchor': 'middle' }, `${k}RL`));
  }

  s.appendChild(svg('path', { d: gaugePath(sim.foe.gauge, xOf, yOf, maxF), class: 'ar-line is-foe' }));
  s.appendChild(svg('path', { d: gaugePath(sim.me.gauge, xOf, yOf, maxF), class: 'ar-line is-me' }));

  /* 버스트 표시는 곡선과 겹치지 않게 위쪽에 팀별 한 줄씩 둔다. */
  [['me', 26], ['foe', 62]].forEach(([who, y]) => {
    s.appendChild(svg('text', { x: C.l - 8, y: y + 5, class: 'ar-axis', 'text-anchor': 'end' },
      who === 'me' ? t('ar.meShort') : t('ar.foeShort')));
    const r = sim[who];
    if (r.full != null && r.full <= maxF) {
      s.appendChild(svg('circle', { cx: xOf(r.full), cy: yOf(100), r: 5, class: 'ar-mark is-' + who }));
    }
    r.deaths.forEach(d => {
      if (d.f > maxF) return;
      const g = svg('g');
      g.appendChild(svg('title', {}, `${t('ar.deathOf', nikkeName(d.rid))} · ${frameText(d.f)} · ${secText(d.f)}`));
      g.appendChild(svg('path', {
        d: `M${xOf(d.f) - 4} ${C.t + 8 - 4}l8 8m0 -8l-8 8`, class: 'ar-death is-' + who,
      }));
      s.appendChild(g);
    });
    r.bursts.forEach((b, i) => {
      if (b.f > maxF) return;
      const last = b.f === r.fullBurst;
      const g = svg('g');
      g.appendChild(svg('title', {}, `${t('ar.burstN', b.stage)} · ${nikkeName(b.rid)} · ${frameText(b.f)} · ${secText(b.f)}`));
      g.appendChild(svg('line', { x1: xOf(b.f), x2: xOf(b.f), y1: y + 8, y2: C.t, class: 'ar-tick is-' + who }));
      g.appendChild(svg('circle', { cx: xOf(b.f), cy: y, r: last ? 8 : 6, class: 'ar-mark is-' + who }));
      g.appendChild(svg('text', { x: xOf(b.f) + (last ? 12 : 0), y: y - (last ? -5 : 11), class: 'ar-mlabel', 'text-anchor': last ? 'start' : 'middle' },
        last ? t('ar.fullBurst') : `B${b.stage}`));
      s.appendChild(g);
    });
  });

  const cursor = svg('line', { x1: xOf(st.frame), x2: xOf(st.frame), y1: C.t, y2: C.t + plotH, class: 'ar-cursor' });
  s.appendChild(cursor);
  const hit = svg('rect', { x: C.l, y: C.t, width: plotW, height: plotH, fill: 'transparent' });
  s.appendChild(hit);
  box.appendChild(s);

  const tip = el('div', 'ar-tip');
  tip.hidden = true;
  box.appendChild(tip);

  const frameAt = e => {
    const rect = s.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * C.w;
    return Math.max(0, Math.min(maxF, Math.round(((x - C.l) / plotW) * maxF)));
  };
  hit.addEventListener('pointermove', e => {
    const f = frameAt(e);
    const a = sim.me.gauge[f], b = sim.foe.gauge[f];
    tip.replaceChildren();
    tip.appendChild(el('b', null, `${secText(f)} · ${frameText(f)}`));
    const row = (cls, label, v) => {
      const d = el('div', 'ar-tipRow');
      d.append(el('span', 'ar-dot ' + cls), document.createTextNode(`${label} ${v.toFixed(2)}`));
      return d;
    };
    tip.append(row('is-me', t('ar.me'), a), row('is-foe', t('ar.foe'), b));
    tip.hidden = false;
    const rect = box.getBoundingClientRect();
    const px = e.clientX - rect.left;
    tip.style.left = `${Math.min(px + 14, rect.width - 190)}px`;
    tip.style.top = `${Math.max(8, e.clientY - rect.top - 30)}px`;
    cursor.setAttribute('x1', xOf(f)); cursor.setAttribute('x2', xOf(f));
  });
  hit.addEventListener('pointerleave', () => {
    tip.hidden = true;
    cursor.setAttribute('x1', xOf(st.frame)); cursor.setAttribute('x2', xOf(st.frame));
  });
  hit.addEventListener('click', e => setFrame(frameAt(e)));
  refs.cursors.push({ el: cursor, xOf });
  refs.maxF = maxF;
  return box;
}

/* ── 스킬 발동 타임라인 ────────────────────────────────────
   게이지 차트와 같은 가로 치수(C)라 시간축이 위아래로 맞는다. 니케마다 한 줄:
   스킬 1 원, 스킬 2 네모, 버스트 마름모, 지속 효과는 아래 옅은 막대, 짧은 간격으로 반복되면 선으로 잇는다. */
/* 이름은 자기 선 바로 위에 붙이고 다음 줄과는 넉넉히 띄운다 - 선이 어느 니케 것인지 헷갈리지 않게. */
const TL = { row: 34, name: 10, line: 20, gap: 16, top: 6, bottom: 4, runGap: 24 };

function skillShape(skill, x, y, who, big = false) {
  const cls = `ar-tlMark is-${who} is-${skill}`;
  if (skill === 'burst') {
    const r = big ? 7 : 6;
    return svg('path', { d: `M${x} ${y - r}L${x + r} ${y}L${x} ${y + r}L${x - r} ${y}Z`, class: cls });
  }
  if (skill === 's2') return svg('rect', { x: x - 3.5, y: y - 3.5, width: 7, height: 7, class: cls });
  return svg('circle', { cx: x, cy: y, r: 3.8, class: cls });
}

function timelineLegend() {
  const row = el('div', 'ar-legend');
  const icon = draw => {
    const s = svg('svg', { viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': 'true' });
    s.appendChild(draw());
    return s;
  };
  [['s1', 'ar.skill.s1'], ['s2', 'ar.skill.s2'], ['burst', 'ar.skill.burst']].forEach(([k, label]) => {
    const item = el('span', 'ar-legItem');
    item.append(icon(() => skillShape(k, 8, 8, 'me')), document.createTextNode(t(label)));
    row.appendChild(item);
  });
  const dur = el('span', 'ar-legItem');
  dur.append(icon(() => svg('rect', { x: 1, y: 6, width: 14, height: 4, class: 'ar-tlDur is-me' })),
    document.createTextNode(t('ar.lgDuration')));
  row.appendChild(dur);
  return row;
}

const skillLabel = e => t('ar.skill.' + (['s1', 's2', 'burst'].includes(e.skill) ? e.skill : 's1'));
const fxLabel = e => e.fx.map(k => t('ar.fx.' + k)).join(', ');

function skillTimeline(sim, maxF) {
  const plotW = C.w - C.l - C.r;
  const xOf = f => C.l + (Math.min(f, maxF) / maxF) * plotW;
  const groups = ['me', 'foe'].map(who => ({
    who,
    rows: st.decks[st.mode][who][st.match].map((rid, pos) => ({ rid, pos })).filter(r => r.rid),
  }));
  const rowsTotal = groups.reduce((s, g) => s + g.rows.length, 0);
  const H = TL.top + rowsTotal * TL.row + TL.gap + TL.bottom;
  const box = el('div', 'ar-chart ar-timeline');
  const s = svg('svg', { viewBox: `0 0 ${C.w} ${H}`, role: 'img', 'aria-label': t('ar.timelineLabel') });
  const tip = el('div', 'ar-tip');
  tip.hidden = true;

  const frameAt = e => {
    const rect = s.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * C.w;
    return Math.max(0, Math.min(maxF, Math.round(((x - C.l) / plotW) * maxF)));
  };
  const near = (maxF / plotW) * 6;     // 6px 안의 발동을 '이 시점'으로 본다

  let y = TL.top;
  groups.forEach((g, gi) => {
    if (gi) y += TL.gap;
    const r = sim[g.who];
    if (g.rows.length) {
      s.appendChild(svg('text', { x: C.l - 8, y: y + TL.line + 4, class: 'ar-axis', 'text-anchor': 'end' },
        g.who === 'me' ? t('ar.meShort') : t('ar.foeShort')));
    }
    for (const { rid, pos } of g.rows) {
      const y0 = y;
      const lineY = y0 + TL.line;
      const events = r.events.filter(e => e.pos === pos && e.f <= maxF);
      const death = r.deaths.find(d => d.pos === pos);
      s.appendChild(svg('line', { x1: C.l, x2: C.w - C.r, y1: lineY, y2: lineY, class: 'ar-grid' }));
      s.appendChild(svg('text', { x: C.l + 2, y: y0 + TL.name, class: 'ar-tlName' }, nikkeName(rid)));

      for (const e of events) {
        if (e.until == null || e.until <= e.f) continue;
        s.appendChild(svg('rect', { x: xOf(e.f), y: lineY + 4, width: Math.max(1, xOf(e.until) - xOf(e.f)), height: 4,
          class: `ar-tlDur is-${g.who}${e.fx.includes('mode') ? ' is-mode' : ''}` }));
      }
      /* 같은 발동(src)이 짧은 간격으로 이어지면 한 덩어리 - 선으로 잇고 첫 발동만 모양을 찍는다. */
      const bySrc = new Map();
      for (const e of events) {
        if (!bySrc.has(e.src)) bySrc.set(e.src, []);
        bySrc.get(e.src).push(e);
      }
      for (const list of bySrc.values()) {
        let run = [list[0]];
        const flush = () => {
          const a = run[0], b = run[run.length - 1];
          if (run.length > 1) {
            s.appendChild(svg('line', { x1: xOf(a.f), x2: xOf(b.f), y1: lineY, y2: lineY, class: `ar-tlRun is-${g.who}` }));
          }
          const stage = a.skill === 'burst' ? r.bursts.find(x => x.f === a.f && x.pos === pos) : null;
          const mark = skillShape(a.skill, xOf(a.f), lineY, g.who, stage && stage.f === r.fullBurst);
          s.appendChild(mark);
          if (stage) {
            s.appendChild(svg('text', { x: xOf(a.f) + 9, y: lineY - 5, class: 'ar-mlabel' },
              stage.f === r.fullBurst ? `B${stage.stage} · ${t('ar.fullBurst')}` : `B${stage.stage}`));
          }
        };
        for (const e of list.slice(1)) {
          if (e.f - run[run.length - 1].f <= TL.runGap) run.push(e);
          else { flush(); run = [e]; }
        }
        flush();
      }
      if (death && death.f <= maxF) {
        s.appendChild(svg('rect', { x: xOf(death.f), y: lineY - 8, width: Math.max(0, C.w - C.r - xOf(death.f)), height: 16, class: 'ar-tlDead' }));
        s.appendChild(svg('path', { d: `M${xOf(death.f) - 4} ${lineY - 4}l8 8m0 -8l-8 8`, class: 'ar-death is-' + g.who }));
      }

      const hit = svg('rect', { x: C.l, y: y0, width: plotW, height: TL.row, fill: 'transparent' });
      hit.addEventListener('pointermove', ev => {
        const f = frameAt(ev);
        const fired = events.filter(e => Math.abs(e.f - f) <= near);
        const active = events.filter(e => e.until != null && e.f <= f && f <= e.until && !fired.includes(e));
        tip.replaceChildren(el('b', null, `${nikkeName(rid)} · ${secText(f)} · ${frameText(f)}`));
        const line = text => tip.appendChild(el('div', 'ar-tipRow', text));
        if (!fired.length && !active.length) line(t('ar.tlNone'));
        const group = (title, list, withUntil) => {
          if (!list.length) return;
          tip.appendChild(el('div', 'ar-tipHead', title));
          const seen = new Map();
          for (const e of list) {
            const key = `${e.skill}|${e.src}`;
            const had = seen.get(key);
            if (had) { had.n += 1; had.e = e; } else seen.set(key, { e, n: 1 });
          }
          for (const { e, n } of seen.values()) {
            const extra = !withUntil || e.until == null ? ''
              : ` · ${e.until >= HORIZON ? t('ar.tlForever') : t('ar.tlUntil', secText(e.until))}`;
            line(`${skillLabel(e)} · ${fxLabel(e)}${n > 1 ? ` · ${t('ar.tlTimes', n)}` : ''}${extra}`);
          }
        };
        group(t('ar.tlNear'), fired, false);
        group(t('ar.tlActive'), active, true);
        tip.hidden = false;
        const rect = box.getBoundingClientRect();
        tip.style.left = `${Math.min(ev.clientX - rect.left + 14, rect.width - 240)}px`;
        tip.style.top = `${Math.max(4, ev.clientY - rect.top + 14)}px`;
        cursor.setAttribute('x1', xOf(f)); cursor.setAttribute('x2', xOf(f));
      });
      hit.addEventListener('pointerleave', () => {
        tip.hidden = true;
        cursor.setAttribute('x1', xOf(st.frame)); cursor.setAttribute('x2', xOf(st.frame));
      });
      hit.addEventListener('click', ev => setFrame(frameAt(ev)));
      s.appendChild(hit);
      y += TL.row;
    }
  });

  const cursor = svg('line', { x1: xOf(st.frame), x2: xOf(st.frame), y1: TL.top, y2: H - TL.bottom, class: 'ar-cursor' });
  /* 커서는 맨 위가 아니라 표시 바로 위에 두되, 마우스는 아래 투명 칸이 받도록 pointer-events 를 끈다. */
  cursor.style.pointerEvents = 'none';
  s.appendChild(cursor);
  box.append(s, tip);
  refs.cursors.push({ el: cursor, xOf });
  return box;
}

function legend() {
  const row = el('div', 'ar-legend');
  [['is-me', t('ar.me')], ['is-foe', t('ar.foe')]].forEach(([cls, label]) => {
    const item = el('span', 'ar-legItem');
    item.append(el('span', 'ar-dot ' + cls), document.createTextNode(label));
    row.appendChild(item);
  });
  row.appendChild(el('span', 'ar-legNote', t('ar.legendNote')));
  return row;
}

/* ── 시점 표시 ────────────────────────────────────────────── */
function setFrame(f) {
  st.frame = f;
  save();
  paintFrame();
}

function paintFrame() {
  if (!refs?.sim) return;
  const f = Math.min(st.frame, refs.maxF);
  const { sim } = refs;
  refs.slider.value = f;
  refs.readout.textContent = `${secText(f)} · ${frameText(f)}`;
  const a = sim.me.gauge[f], b = sim.foe.gauge[f];
  refs.gaugeMe.textContent = a.toFixed(2);
  refs.gaugeFoe.textContent = b.toFixed(2);
  refs.gaugeDiff.textContent = (a - b >= 0 ? '+' : '−') + Math.abs(a - b).toFixed(2);
  for (const { el: cur, xOf } of refs.cursors) {
    cur.setAttribute('x1', xOf(f)); cur.setAttribute('x2', xOf(f));
  }
  for (const who of ['me', 'foe']) {
    const total = sim[who].cumulative.reduce((s, c) => s + c[f], 0);
    refs.gain[who].forEach((td, pos) => {
      const v = sim[who].cumulative[pos][f];
      td.textContent = st.decks[st.mode][who][st.match][pos]
        ? `${v.toFixed(2)} (${total ? Math.round(v / total * 100) : 0}%)` : '';
    });
    refs.hp[who].forEach((td, pos) => {
      if (!st.decks[st.mode][who][st.match][pos]) { td.textContent = ''; return; }
      const v = sim[who].hpTrace[pos][f];
      td.textContent = v > 0 ? `${(v * 100).toFixed(0)}%` : t('ar.dead');
    });
  }
}

function headline(sim) {
  const row = el('div', 'ar-tiles');
  const v = verdict(sim.me, sim.foe);
  const tile = (label, value, sub) => {
    const b = el('div', 'ar-tile');
    b.append(el('span', 'ar-tileLbl', label), el('b', 'ar-tileVal', value));
    if (sub) b.appendChild(el('span', 'ar-tileSub', sub));
    return b;
  };
  const both = r => {
    if (r.fullBurst != null) return [secText(r.fullBurst), frameText(r.fullBurst)];
    return [burstCell(r), r.full != null ? `${t('ar.gaugeFull')} ${frameText(r.full)}` : ''];
  };
  const [ma, mb] = both(sim.me), [fa, fb] = both(sim.foe);
  row.append(
    tile(t('ar.tileMe'), ma, mb),
    tile(t('ar.tileFoe'), fa, fb),
    tile(t('ar.tileDiff'), v.diff == null ? '-' : `${Math.abs(v.diff)}f`,
      v.diff == null ? '' : secText(Math.abs(v.diff))),
    tile(t('ar.tileVerdict'), t(v.key), ''),
  );
  return row;
}

function burstTable(sim) {
  const wrap = el('div', 'op-scroll');
  const table = el('table', 'grid ar-table');
  const thead = el('thead');
  const hr = el('tr');
  ['ar.colStage', 'ar.me', 'ar.colFrame', 'ar.foe', 'ar.colFrame', 'ar.colDiff'].forEach(k =>
    hr.appendChild(el('th', null, t(k))));
  thead.appendChild(hr);
  table.appendChild(thead);
  const tb = el('tbody');
  const rows = Math.max(sim.me.bursts.length, sim.foe.bursts.length);
  const fullRow = el('tr');
  fullRow.appendChild(el('td', null, t('ar.gaugeFull')));
  fullRow.appendChild(el('td', null, ''));
  fullRow.appendChild(el('td', 'num', timeText(sim.me.full)));
  fullRow.appendChild(el('td', null, ''));
  fullRow.appendChild(el('td', 'num', timeText(sim.foe.full)));
  fullRow.appendChild(el('td', 'num', sim.me.full != null && sim.foe.full != null ? diffText(sim.me.full - sim.foe.full) : '-'));
  tb.appendChild(fullRow);
  for (let i = 0; i < rows; i++) {
    const a = sim.me.bursts[i], b = sim.foe.bursts[i];
    const tr = el('tr');
    tr.appendChild(el('td', null, t('ar.burstN', i + 1)));
    tr.appendChild(el('td', null, a ? nikkeName(a.rid) : '-'));
    tr.appendChild(el('td', 'num', a ? timeText(a.f) : '-'));
    tr.appendChild(el('td', null, b ? nikkeName(b.rid) : '-'));
    tr.appendChild(el('td', 'num', b ? timeText(b.f) : '-'));
    tr.appendChild(el('td', 'num', a && b ? diffText(a.f - b.f) : '-'));
    tb.appendChild(tr);
  }
  table.appendChild(tb);
  wrap.appendChild(table);
  return wrap;
}

function checkpointTable(sim) {
  const wrap = el('div', 'op-scroll');
  const table = el('table', 'grid ar-table');
  const thead = el('thead');
  const hr = el('tr');
  ['ar.colPoint', 'ar.unitSec', 'ar.unitFrame', 'ar.me', 'ar.foe', 'ar.colGap'].forEach(k =>
    hr.appendChild(el('th', null, t(k))));
  thead.appendChild(hr);
  table.appendChild(thead);
  const tb = el('tbody');
  for (let k = 0.5; k <= 4; k += 0.5) {
    const f = k * RL_FRAMES;
    const a = sim.me.gauge[f], b = sim.foe.gauge[f];
    const tr = el('tr', 'is-click');
    tr.onclick = () => setFrame(f);
    tr.append(el('td', null, `${k}RL`), el('td', 'num', (f / FPS).toFixed(2)), el('td', 'num', String(f)),
      el('td', 'num', a.toFixed(2)), el('td', 'num', b.toFixed(2)),
      el('td', 'num', (a - b >= 0 ? '+' : '−') + Math.abs(a - b).toFixed(2)));
    tb.appendChild(tr);
  }
  table.appendChild(tb);
  wrap.appendChild(table);
  return wrap;
}

function deathTable(sim) {
  const wrap = el('div', 'op-scroll');
  const rows = [...sim.me.deaths.map(d => ({ ...d, who: 'me' })), ...sim.foe.deaths.map(d => ({ ...d, who: 'foe' }))]
    .sort((a, b) => a.f - b.f);
  if (!rows.length) {
    wrap.appendChild(el('p', 'op-note', t('ar.noDeath')));
    return wrap;
  }
  const table = el('table', 'grid ar-table');
  const thead = el('thead');
  const hr = el('tr');
  ['ar.colFrame', 'ar.colTeam', 'ar.colNikke'].forEach(k => hr.appendChild(el('th', null, t(k))));
  thead.appendChild(hr);
  table.appendChild(thead);
  const tb = el('tbody');
  for (const d of rows) {
    const tr = el('tr', 'is-click');
    tr.onclick = () => setFrame(d.f);
    const team = el('td', 'ar-teamCell');
    team.append(el('span', 'ar-dot is-' + d.who), document.createTextNode(t(d.who === 'me' ? 'ar.me' : 'ar.foe')));
    tr.append(el('td', 'num', timeText(d.f)), team, el('td', null, nikkeName(d.rid)));
    tb.appendChild(tr);
  }
  table.appendChild(tb);
  wrap.appendChild(table);
  return wrap;
}

function matchSection() {
  const m = Math.min(st.match, MODES[st.mode] - 1);
  st.match = m;
  const sim = simulateMatch(st.mode, m);
  refs = { sim, gain: {}, hp: {}, cursors: [] };
  const wrap = el('section', 'op-group ar-match');
  wrap.appendChild(el('h3', null, t('ar.matchTitle', m + 1)));

  const decks = el('div', 'ar-decks');
  decks.append(deckTable('me', m, sim), deckTable('foe', m, sim));
  wrap.appendChild(decks);

  wrap.appendChild(headline(sim));
  wrap.appendChild(legend());
  wrap.appendChild(gaugeChart(sim));
  const tl = el('div', 'ar-tlBox');
  tl.append(el('h4', 'ar-sub', t('ar.timeline')), timelineLegend(), skillTimeline(sim, refs.maxF),
    el('p', 'op-note', t('ar.timelineNote')));
  wrap.appendChild(tl);

  const bar = el('div', 'ar-frameBar');
  const lab = el('label', 'ar-sliderLbl', t('ar.pickFrame'));
  const slider = el('input', 'ar-slider');
  slider.type = 'range';
  slider.min = 0; slider.max = refs.maxF; slider.step = 1;
  slider.setAttribute('aria-label', t('ar.pickFrame'));
  slider.oninput = () => setFrame(Number(slider.value));
  lab.appendChild(slider);
  const readout = el('span', 'ar-readout');
  const gm = el('b'), gf = el('b'), gd = el('b');
  const stat = el('span', 'ar-readStat');
  stat.append(document.createTextNode(`${t('ar.me')} `), gm,
    document.createTextNode(` · ${t('ar.foe')} `), gf,
    document.createTextNode(` · ${t('ar.colGap')} `), gd);
  bar.append(lab, readout, stat);
  wrap.appendChild(bar);
  Object.assign(refs, { slider, readout, gaugeMe: gm, gaugeFoe: gf, gaugeDiff: gd });

  const tables = el('div', 'ar-tables');
  const left = el('div');
  left.append(el('h4', 'ar-sub', t('ar.burstOrder')), burstTable(sim));
  const right = el('div');
  right.append(el('h4', 'ar-sub', t('ar.checkpoints')), checkpointTable(sim));
  tables.append(left, right);
  wrap.appendChild(tables);
  const deaths = el('div', 'ar-deathBox');
  deaths.append(el('h4', 'ar-sub', t('ar.deaths')), deathTable(sim));
  wrap.appendChild(deaths);
  return wrap;
}

function notes() {
  const wrap = el('section', 'op-group');
  wrap.appendChild(el('h3', null, t('ar.notes')));
  const ul = el('ul', 'ar-notes');
  for (const k of ['ar.note1', 'ar.note2', 'ar.note3', 'ar.note4', 'ar.note6', 'ar.note5']) ul.appendChild(el('li', null, t(k)));
  wrap.appendChild(ul);
  return wrap;
}

function paint() {
  statCache.clear();
  entryCache.clear();
  loadRoster();
  root.replaceChildren(controls(), summary(), matchSection(), notes());
  paintFrame();
}

async function load() {
  const get = async name => {
    const r = await fetch(`./data/${name}.json`, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText} - ${name}.json`);
    return r.json();
  };
  const [arena, cubes, weapons, presetTable, ...stats] = await Promise.all([get('arena'), get('cubes'),
    get('weapons').catch(() => ({})),
    /* 상대 난이도 프리셋의 니케 분류 (1군·차속 핵심·크리 핵심·장탄 금지) - 없으면 전원 '나머지'·기본 배치 */
    get('arena_presets').catch(() => ({})),
    /* 스탯표가 없어도 탭은 돈다 - 링크 대상만 자리 순이 된다. */
    ...STAT_TABLES.map(k => get(`raw/${k}`).catch(() => null))]);
  cubeTable = cubes.cubes;
  presets = presetTable || {};
  if (stats.every(Boolean)) {
    statT = buildTables(Object.fromEntries(STAT_TABLES.map((k, i) => [k, stats[i]])));
  }
  /* 큐브 효과 수치는 cubes.json, 무기군 소장품 효과는 weapons.json 에 있다 (다른 탭과 같이 쓴다). */
  return { ...arena, cubes: cubes.cubes, collection: weapons.collection || {} };
}

export async function renderArena(el_, context) {
  ctx = context;
  root = el_;
  if (!data) {
    root.replaceChildren(el('p', 'notice', t('ar.loading')));
    try { data = await load(); }
    catch (e) {
      root.replaceChildren(el('p', 'notice notice-error', String(e.message || e)));
      return;
    }
    st = restore();
  }
  paint();
}
