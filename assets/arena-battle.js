/* 아레나 전투 시뮬레이션 (Draft) - 양쪽을 프레임마다 함께 돌려 대미지·체력·사망이 서로의 대상 선택과 버스트 체인에 영향을 주게 한다.
   대미지 = (공격력 - 방어력) x 무기 배율 x 차지 배율 x (1 + 크리티컬 기댓값 + 풀 버스트 50%) x 코드 상성 x 버프 (오버킬 포함 기록).
   다루지 않는 것: 재사용 시간 감소, 첫 풀 버스트 이후 사이클, 전투 중에만 바뀌는 차지 속도·장탄·재장전, 명중률, 별도 자원 체계. */

import { burstChain, hitPositions, nikkeEvents, ruleOf, HORIZON } from './arena-sim.js';

/* 첫 버스트는 컷신 영상, 다음 버스트 간격은 컷신 끈 영상의 HUD 로 잰 값이다 (arena-sim.js 설명 참고). */
const FIRST_BURST_DELAY = 25;
const NEXT_BURST_DELAY = 32;
const FULL_BURST_FRAMES = 600;
const FPS = 60;
const RECOVERY = 16;
/* 챔피언 아레나(400레벨) 엄폐물. 다른 레벨은 호출하는 쪽이 stats.coverBase, stats.coverDef 로 넘긴다. */
export const COVER_BASE = 1500000;
export const COVER_DEF = 24428;

/* 코드 상성 - 키가 값을 이긴다. */
const BEATS = { Water: 'Fire', Fire: 'Wind', Wind: 'Iron', Iron: 'Electronic', Electronic: 'Water' };
const ELEMENT_BONUS = 0.1;

const lvOf = (rule, skills) => (rule ? rule.values[(skills?.[rule.skill] ?? 10) - 1] ?? 0 : 0);
const atSkill = (arr, skills, key = 'burst') => (arr ? arr[(skills?.[key] ?? 10) - 1] ?? 0 : 0);
const DOT_INTERVAL = 60;

/* 애장품 스킬 교체 (build_arena.py 의 fav). phase 1·2·3 은 애장품 0·1·2 단계에서 바뀐다.
   cfg.treasureLevel 이 없으면 최고 단계(2)로 본다. 바뀐 스킬의 procs 만 갈아끼우고, 버스트가 바뀌면 burst·mode 도 바꾼다. */
function withFavorite(base, cfg) {
  const fav = base.fav;
  if (!cfg?.treasure || !fav) return base;
  const level = cfg.treasureLevel ?? 2;
  const on = k => fav.phase?.[k] != null && fav.phase[k] <= level + 1;
  const swapped = ['s1', 's2'].filter(on);
  const d = { ...base, procs: [...(base.procs || []).filter(p => !swapped.includes(p.skill)), ...swapped.flatMap(k => fav[k] || [])] };
  if (on('burst')) {
    d.burst = fav.burst || [];
    d.mode = fav.mode ?? null;
  }
  return d;
}

function makeSide(data, input, horizon, opts) {
  const n = input.team.length;
  const slots = input.team.map((s, pos) => {
    if (!s?.rid) return null;
    const d = withFavorite(data.nikkes[s.rid], s.cfg);
    const rule = ruleOf(data, s.rid, s.cfg?.treasure);
    const cfg = { ...(s.cfg || {}), chargeValues: [...(s.cfg?.chargeValues || [])], ammoParts: [...(s.cfg?.ammoParts || [])] };
    const doll = cfg.doll || {};
    const cover = (s.stats.coverBase ?? COVER_BASE) * (opts.coverScale ?? 1) * (1 + (doll.coverHp || 0) / 100)
      + s.stats.hp * (cfg.coverCasterPct || 0) / 100;
    return {
      pos, rid: s.rid, cfg, stats: s.stats, d, rule, doll,
      hp: s.stats.hp, alive: true, deathFrame: null, dealt: 0,
      stunUntil: -1, invulnUntil: -1, tauntUntil: -1, tauntedBy: null, tauntedUntil: -1, undyingUntil: -1, immuneUntil: -1,
      stealthUntil: rule.stealth ?? -1, decoy: 0, share: null, shareUntil: -1, state: {}, critSeen: 0,
      reloadAt: null, hitsTaken: 0,
      buffs: [], hitCount: 0, spent: 0, shots: 0, rot: 0,
      castAt: null, modeUntil: -1, modeNext: null, dots: [], hots: [],
      shield: 0, shieldUntil: -1, cover, coverMax: cover,
      coverDef: s.stats.coverDef ?? COVER_DEF, hidden: new Uint8Array(horizon + 1),
      /* 소장품·큐브의 받는 대미지 감소는 니케 몸에만 들어간다. */
      reduceBase: (doll.reduce || 0) + (cfg.cubeReduce || 0),
      chainLeft: null, chainNext: 0, chainStack: 0,
      procs: (d.procs || []).map((p, i) => ({ ...p, id: i, seen: 0, fired: 0, coolUntil: -1, next: p.first ?? null })),
    };
  });
  /* 사격 타임라인(nikkeEvents)은 미리 계산하므로, 전투 시작부터 끝까지 가는 차지 속도·장탄·재장전 효과만 여기서 cfg 에 접는다.
     전투 중에 잠깐 켜지는 효과는 반영하지 않는다. */
  for (const sl of slots) {
    for (const p of sl?.procs || []) {
      if (p.on !== 'start' || p.cond) continue;
      for (const item of p.items) {
        if (!TIMELINE_KINDS.has(item.kind) || atSkill(item.dur, sl.cfg.skills, p.skill) < 60) continue;
        const value = atSkill(item.v, sl.cfg.skills, p.skill);
        for (const t of allyTargets(p, sl, slots)) {
          if (item.kind === 'chargeSpd') t.cfg.chargeValues.push(value);
          else if (item.kind === 'ammoPct') t.cfg.ammoParts.push(value);
          else if (item.kind === 'reloadSpd') t.cfg.reloadPct = (t.cfg.reloadPct || 0) + value;
        }
      }
    }
  }
  const bucket = Array.from({ length: horizon + 1 }, () => null);
  slots.forEach(sl => {
    if (!sl) return;
    const events = nikkeEvents(data, sl.rid, sl.cfg, sl.pos, input.side, horizon);
    for (const e of events) {
      (bucket[e.f] ||= []).push({ e, sl });
    }
    for (const [a, b] of events.cover || []) sl.hidden.fill(1, Math.max(0, a), Math.min(horizon, b) + 1);
  });
  let aura = 0;
  slots.forEach(sl => {
    if (sl?.rule.aura) aura += sl.d.rate * lvOf(sl.rule.aura, sl.cfg.skills) / 100;
  });
  return {
    input, slots, bucket, aura,
    gauge: new Float64Array(horizon + 1),
    cumulative: Array.from({ length: n }, () => new Float64Array(horizon + 1)),
    dealtTrace: Array.from({ length: n }, () => new Float64Array(horizon + 1)),
    hpTrace: Array.from({ length: n }, () => new Float64Array(horizon + 1)),
    sum: 0, full: null, nextStageAt: null, cast: [], bursts: [],
    fbUntil: -1, fullBurst: null, chainBroken: false, deaths: [], events: [], gainNow: new Float64Array(n),
    spentNow: 0, shared: 0, sharedUntil: -1,
  };
}

/* perState 버프는 지금 가진 상태 중첩 수를 곱한다 (골든 칩 크리티컬 대미지 등). */
const buffSum = (sl, kind, f) => sl.buffs.reduce((v, b) => v + (b.kind === kind && b.until >= f
  ? b.value * (b.perState ? (sl.state[b.perState]?.until >= f ? sl.state[b.perState].stacks : 0) / (b.perDiv || 1) : 1) : 0), 0);

/* 최대 체력 - 최대 체력 ▲ (%) 와 시전자 기준 최대 체력 ▲ (고정값) 버프를 더한다. */
const maxHpOf = (sl, f) => sl.stats.hp * (1 + buffSum(sl, 'maxHp', f) / 100) + buffSum(sl, 'maxHpFlat', f);

/* 타임라인(nikkeEvents)에 미리 접는 효과 - 전투 시작 시 [지속] 인 것만. */
const TIMELINE_KINDS = new Set(['chargeSpd', 'ammoPct', 'reloadSpd']);

/* 아군 대상 고르기. block.filter: { cls, element, weapon } (클래스·코드·무기), block.leftmost: 왼쪽부터 n 기.
   block.excludeSelf / includeSelf: '자신을 제외한' / '자신과'. */
function matches(sl, flt) {
  if (!flt) return true;
  if (flt.cls && sl.d.cls !== flt.cls) return false;
  if (flt.element && sl.d.element !== flt.element) return false;
  if (flt.weapon && sl.d.weapon !== flt.weapon) return false;
  if (flt.squad && sl.d.squad !== flt.squad) return false;
  if (flt.cast != null && (sl.castAt != null) !== flt.cast) return false;
  return true;
}
function allyTargets(block, caster, slots, f = 0) {
  const alive = slots.filter(x => x?.alive !== false && x);
  const n = Math.max(1, Math.round(atSkill(block.n, caster.cfg.skills, block.skill) || 1));
  /* filter.squad === 'own' 은 시전자와 같은 스쿼드 */
  const flt = block.filter?.squad === 'own' ? { ...block.filter, squad: caster.d.squad } : block.filter;
  let pool = alive.filter(x => matches(x, flt) && !(block.excludeSelf && x === caster));
  switch (block.to) {
    case 'self': return [caster];
    case 'allyAll': case 'allyFilter': break;
    case 'allyLeftmost': pool = [...pool].sort((a, b) => a.pos - b.pos).slice(0, n); break;
    case 'allyLowestHp':
      pool = [...pool].sort((a, b) => (block.ratio ? a.hp / maxHpOf(a, f) - b.hp / maxHpOf(b, f) : a.hp - b.hp) || a.pos - b.pos).slice(0, n);
      break;
    case 'allyHighestAtk':
      pool = [...pool].sort((a, b) => effectiveAtk(b, f) - effectiveAtk(a, f) || a.pos - b.pos).slice(0, n);
      break;
    case 'allyLowestCover': pool = [...pool].sort((a, b) => a.cover - b.cover || a.pos - b.pos).slice(0, n); break;
    case 'coverBroken': pool = pool.filter(x => x.cover <= 0).slice(0, n); break;
    case 'neighbors': pool = alive.filter(x => Math.abs(x.pos - caster.pos) === 1); break;
    case 'selfAndLowerDef': pool = alive.filter(x => x === caster || x.stats.def < caster.stats.def); break;
    default: return [];
  }
  if (block.includeSelf && !pool.includes(caster) && caster.alive !== false) pool = [caster, ...pool];
  return pool;
}
const ALLY_TO = new Set(['self', 'allyAll', 'allyFilter', 'allyLeftmost', 'allyLowestHp', 'allyHighestAtk', 'allyLowestCover',
  'coverBroken', 'neighbors', 'selfAndLowerDef']);

/* ── 스킬 발동 기록 (화면의 타임라인용) ─────────────────────
   { f, pos, skill: 's1'|'s2'|'burst', src: 같은 발동끼리 묶는 키, fx: [효과 갈래], until: 지속 끝 프레임 | null } */
const FX = {
  damage: 'damage', dot: 'damage',
  heal: 'heal', hot: 'heal', lifesteal: 'heal',
  shield: 'shield', sharedShield: 'shield',
  stun: 'control', taunt: 'control', invuln: 'control', undying: 'control', stealth: 'control',
  decoy: 'shield', coverRevive: 'shield', coverHeal: 'shield', coverHot: 'shield', coverMaxUp: 'shield',
  vuln: 'debuff', atkDown: 'debuff', defDown: 'debuff', defCasterDown: 'debuff', dispel: 'debuff',
  gauge: 'gauge',
};
const fxOf = kind => FX[kind] || 'buff';

function logSkill(side, sl, f, skill, src, items = [], extra = {}) {
  if (!side.events) return;
  const skills = sl.cfg.skills;
  const key = String(skill || '').replace(/^fav\./, '');
  let dur = 0;
  const fx = new Set(extra.fx || []);
  for (const item of items) {
    fx.add(fxOf(item.kind));
    if (item.kind !== 'damage' && item.kind !== 'heal') dur = Math.max(dur, atSkill(item.dur, skills, skill) * FPS);
  }
  const until = extra.until ?? (dur > 0 ? f + Math.round(dur) : null);
  side.events.push({ f, pos: sl.pos, skill: key, src, fx: [...fx], until });
}

function effectiveAtk(sl, f) {
  return Math.max(1, sl.stats.atk * (1 + buffSum(sl, 'atk', f) / 100) + buffSum(sl, 'atkFlat', f));
}

const critRateOf = (att, f, how = {}) => Math.min(1, (att.stats.critRate ?? 0.15) + buffSum(att, 'critRate', f) / 100
  + (how.normal ? buffSum(att, 'critRateNormal', f) / 100 : 0));

function dealMultiplier(att, tgt, f, side, opts, how) {
  const s = att.stats;
  const rate = critRateOf(att, f, how);
  const hurt = (s.critDamage ?? 0.5) + buffSum(att, 'critDmg', f) / 100;
  /* 크리티컬은 일반 공격, 버스트 스킬 대미지, 발동형 스킬 대미지, 지속 대미지 모두에 적용한다. */
  const crit = rate * hurt;
  const fb = side.fbUntil >= f ? 0.5 : 0;
  const core = how.core ? 1 + buffSum(att, 'coreUp', f) / 100 : 0;
  /* 엄폐물은 코드가 없고, 니케에게 걸린 받는 대미지 증감도 받지 않는다. */
  const beats = !how.cover && BEATS[att.d.element] === tgt.d.element;
  const code = beats ? 1 + ELEMENT_BONUS + (s.elementBonus || 0) : 1;
  /* 공격 대미지 ▲ 묶음: 우월 코드·관통·폭발·버스트(광역/단일) 대미지 ▲ 는 해당 공격에만 더한다. */
  const given = 1 + (buffSum(att, 'dmgUp', f)
    + (how.ignoreDef ? buffSum(att, 'ignoreUp', f) : 0)
    + (how.dot ? buffSum(att, 'dotUp', f) : 0)
    + (beats ? buffSum(att, 'beatsUp', f) : 0)
    + (how.normal && att.d.pierce ? buffSum(att, 'pierceUp', f) : 0)
    + (how.normal && att.d.splash ? buffSum(att, 'splashUp', f) : 0)
    + (how.burstAoe ? buffSum(att, 'burstAoeUp', f) : 0)
    + (how.burstSingle ? buffSum(att, 'burstSingleUp', f) : 0)) / 100;
  const taken = how.cover ? 1
    : Math.max(0, 1 + (buffSum(tgt, 'vuln', f) - buffSum(tgt, 'reduce', f) - tgt.reduceBase) / 100);
  return (1 + crit + fb + core) * code * given * taken * (opts.damageScale ?? 1);
}

const restore = (t, amount, f = 0) => {
  if (t.alive) t.hp = Math.min(maxHpOf(t, f), t.hp + amount * (1 + buffSum(t, 'healUp', f) / 100));
};

/* 공격 한 번(사격 한 발, 버스트 대미지 한 줄)의 번호. null 이면 공격마다 따로 센다.
   공용 보호막은 피사체 하나라, 같은 공격이 여러 니케를 맞혀도 보호막에는 한 번만 들어가고 나머지 니케는 막힌다. */
let attackId = null, attackSeq = 0;
const newAttack = () => (attackId = ++attackSeq);
const sharedOn = (side, f) => !!side && side.sharedUntil >= f && side.shared > 0;

/* 받는 대미지 분배 - 묶인 아군이 살아 있으면 똑같이 나눠 받는다 (자칼·아니스 S2). */
function takeDamage(tgt, dmg, f, tgtSide) {
  const group = tgt.share && tgt.shareUntil >= f ? tgt.share.filter(x => x.alive) : null;
  if (group && group.length > 1 && group.includes(tgt)) {
    /* 나눠 받는 조각은 한 대미지라 공용 보호막에서 차례로 빠진다 */
    const id = attackId;
    if (id != null && tgtSide?.sharedHitId === id) return;
    if (id != null && sharedOn(tgtSide, f)) tgtSide.sharedHitId = id;
    attackId = null;
    for (const m of group) absorb(m, dmg / group.length, f, tgtSide);
    attackId = id;
    return;
  }
  absorb(tgt, dmg, f, tgtSide);
}

/* 분신(디코이), 보호막 순으로 먼저 받고 넘친 만큼 체력이 깎인다. 공용 보호막은 팀이 함께 쓴다.
   불굴이면 체력이 1 아래로 내려가지 않는다. */
function absorb(tgt, dmg, f, tgtSide) {
  let left = dmg;
  if (tgt.decoy > 0) {
    const used = Math.min(tgt.decoy, left);
    tgt.decoy -= used;
    left -= used;
  }
  if (tgt.shieldUntil >= f && tgt.shield > 0) {
    const used = Math.min(tgt.shield, left);
    tgt.shield -= used;
    left -= used;
  }
  if (attackId != null && tgtSide?.sharedHitId === attackId) return;   // 이 공격은 이미 공용 보호막을 맞혔다
  if (left > 0 && sharedOn(tgtSide, f)) {
    if (attackId != null) tgtSide.sharedHitId = attackId;
    const used = Math.min(tgtSide.shared, left);
    tgtSide.shared -= used;
    left -= used;
  }
  tgt.hp -= left;
  if (tgt.undyingUntil >= f && tgt.hp < 1) tgt.hp = 1;
}

function strike(att, tgt, pct, f, side, foe, opts, how = {}) {
  if (!tgt.alive || tgt.invulnUntil >= f) return;
  /* hpAtk: '최종 최대 체력의 N% 를 공격력으로 합산한' 대미지 */
  const atk = effectiveAtk(att, f) + (how.hpAtk ? maxHpOf(att, f) * atSkill(how.hpAtk, att.cfg.skills) / 100 : 0);
  /* 잃은 체력 1% 당 방어력 N% ▲ (목단 S1) */
  const lost = Math.max(0, 1 - tgt.hp / maxHpOf(tgt, f)) * 100;
  const defPct = (tgt.doll.def || 0) + buffSum(tgt, 'def', f) + buffSum(tgt, 'defPerLost', f) * lost;
  const def = Math.max(0, tgt.stats.def * (1 + defPct / 100) + buffSum(tgt, 'defFlat', f));
  const base = how.ignoreDef ? atk : Math.max(1, atk - def);
  const dmg = base * pct * dealMultiplier(att, tgt, f, side, opts, how);
  takeDamage(tgt, dmg, f, foe);
  /* 사망 원인 기록: 마지막으로 때린 니케와 공격 종류 */
  tgt.lastHit = { rid: att.rid, src: how.src || (how.dot ? 'dot' : 'skill'), f };
  att.dealt += dmg;
  const steal = buffSum(att, 'lifesteal', f);
  if (steal) restore(att, (dmg * steal) / 100, f);
  opts.onHit?.({ f, att, tgt, dmg, how });
  if (!how.dot) onHitTaken(tgt, att, f, foe, side, opts);
}

/* 피격 시 발동: every(N회 피격), chance(확률 - 기댓값으로 쌓아 1 이 되면 발동), limit(전투 중 횟수), cool(재발동 대기 프레임). */
let hitDepth = 0;
function onHitTaken(tgt, att, f, side, foe, opts) {
  tgt.hitsTaken += 1;
  /* 반격 대미지가 다시 반격을 부르지 않게 한 단계만 */
  if (hitDepth > 0) return;
  hitDepth += 1;
  const outer = attackId;
  attackId = null;
  try { hitProcs(tgt, att, f, side, foe, opts); } finally { hitDepth -= 1; attackId = outer; }
}
function hitProcs(tgt, att, f, side, foe, opts) {
  for (const p of tgt.procs) {
    if (p.on !== 'hitTaken') continue;
    if (p.every) {
      p.seen += 1;
      const every = Math.max(1, Math.round(atSkill(p.every, tgt.cfg.skills, p.skill)));
      if (p.seen < every) continue;
      p.seen = 0;
    } else if (p.chance) {
      p.seen += atSkill(p.chance, tgt.cfg.skills, p.skill) / 100;
      if (p.seen < 1) continue;
      p.seen -= 1;
    }
    fireProc(tgt, p, side, foe, f, opts, [att]);
  }
}

/* 타겟팅 규칙의 출처는 분석 프로젝트 Arena-Lab 의 docs/ARENA_TARGETING.md 에 정리했다 (레포 밖). */
const wantedOf = (att, foe) => (att.wanted ??= hitPositions(foe.data, att.rid, att.cfg));
/* P5 부터 쏘는 무기(SR)는 P5 > P4 > ... 순서, 나머지는 P1 > P2 > ... */
const fromRight = (att, foe) => wantedOf(att, foe)[0] >= 3;

/* 도발·주목 중 누구를 쏘나 (없으면 null). 마지막에 받은 것이 이긴다.
   주목이 둘 이상 켜져 있으면 켜진 순서와 상관없이 평타 기본 순서 - P5 부터 쏘는 무기는 오른쪽, 나머지는 왼쪽. */
function tauntTarget(att, foe, f) {
  const own = att.tauntedBy?.alive && att.tauntedUntil >= f ? att.tauntedBy : null;
  const focus = foe.slots.filter(x => x?.alive && x.tauntUntil >= f);
  const glob = focus.length ? (fromRight(att, foe) ? focus.at(-1) : focus[0]) : null;
  if (own && glob) return att.tauntedAt >= Math.max(...focus.map(x => x.tauntFrom ?? -1)) ? own : glob;
  return own || glob;
}

/* 폭발·넓은 폭 무기가 primary 를 맞힐 때 함께 맞는 니케 (primary 가 맨 앞).
   RL 은 primary 를 가운데로 반경 (기본 맞는 칸 수 - 1) - P1 을 쏘면 P1·P2, 도발로 P2 를 쏘면 P1·P2·P3 (NIKKE DECK).
   그 밖의 여러 칸 무기(홍련 : 신살 넓은 폭)는 기본 칸 모양을 primary 에서부터 그대로 옮긴다. */
function spreadFrom(att, foe, primary) {
  const wanted = wantedOf(att, foe);
  if (wanted.length < 2) return [primary];
  const alive = foe.slots.filter(x => x?.alive);
  const near = att.d.weapon === 'RL'
    ? alive.filter(x => Math.abs(x.pos - primary.pos) <= wanted.length - 1)
    : wanted.map(p => foe.slots[primary.pos + p - wanted[0]]).filter(x => x?.alive);
  return [primary, ...near.filter(x => x !== primary).sort((a, b) => Math.abs(a.pos - primary.pos) - Math.abs(b.pos - primary.pos))];
}

/* 평타 조준. 대상이 엄폐하거나 죽으면, 또는 쏘는 쪽이 재장전하거나 도발이 끝나면 기본 순서에서 엄폐하지 않은 첫 니케를 다시 고른다.
   쏠 때만 불리므로 지난번 뒤로 대상이 엄폐했던 순간을 거슬러 따라가고, 모두 숨어 있으면 지금 대상을 그대로 쏜다. */
function aimOf(att, foe, f) {
  const order = (fromRight(att, foe) ? [4, 3, 2, 1, 0] : [0, 1, 2, 3, 4]).map(p => foe.slots[p]);
  const visibleAt = (g, skip) => order.find(x => x?.alive && x !== skip && x.stealthUntil < g && !isHidden(x, g));
  if (!att.aim?.alive || att.aimReset || att.aim.stealthUntil >= f) {
    att.aim = visibleAt(f) || order.find(x => x?.alive && x.stealthUntil < f) || order.find(x => x?.alive);
    att.aimReset = false;
  } else {
    for (let g = (att.aimAt ?? f) + 1; g <= f; g++) {
      if (!isHidden(att.aim, g)) continue;
      const next = visibleAt(g, att.aim);
      if (next) att.aim = next;
    }
  }
  att.aimAt = f;
  return att.aim;
}

/* 평타 대상 (맨 앞이 조준 대상). 도발·주목을 먼저 따르고, 폭발·넓은 폭 무기는 조준 대상 주변까지 맞힌다. */
function resolveTargets(att, foe, f) {
  const alive = foe.slots.filter(x => x?.alive);
  if (!alive.length) return [];
  if (att.d.weapon === 'RL' && buffSum(att, 'rangeUp', f) > 0) return alive;
  const taunter = tauntTarget(att, foe, f);
  if (taunter) {
    att.aimReset = true;   // 도발이 끝나면 처음부터 다시 고른다
    return spreadFrom(att, foe, taunter);
  }
  /* 무기 교체(버스트로 무기가 바뀔 때·돌아올 때)와 자신의 기절이 풀린 뒤에도 처음부터 다시 고른다 (아카라이브 65307271) */
  const mode = inMode(att, f);
  if (att.aimMode !== undefined && att.aimMode !== mode) att.aimReset = true;
  att.aimMode = mode;
  if (att.stunUntil >= (att.aimAt ?? Infinity)) att.aimReset = true;
  return spreadFrom(att, foe, aimOf(att, foe, f));
}

const inMode = (sl, f) => sl.modeUntil >= f;

function shotPercent(att, f) {
  const d = att.d;
  const up = buffSum(att, 'chargeUp', f) / 100 + (att.stats.chargeBonus || 0);
  /* RL·SR 소장품은 기본 차지 배율에 곱한다 (nikke.gg 대미지 공식). 엄폐물 BLOCK 숫자로 확인했다. */
  const mul = 1 + (att.doll.chargeMul || 0) / 100;
  if (inMode(att, f)) {
    const m = d.mode;
    const charge = m.fullCharge > 100 ? (m.fullCharge / 100) * mul + up : 1;
    return (atSkill(m.pct, att.cfg.skills) / 100) * charge;
  }
  /* CDN 의 샷건 대미지는 펠릿 합계라 펠릿 수를 곱하지 않는다. 연장 무기만 총구 수를 곱한다.
     SG·SMG 소장품의 일반 공격 배율은 무기 변경 중에는 안 들어간다. */
  const charge = d.charge > 0 ? (d.fullCharge / 100) * mul + up : 1;
  return (d.damage / 100) * (1 + ((att.doll.normalMul || 0) + buffSum(att, 'normalMul', f)) / 100) * d.muzzle * charge;
}

function pushBuff(t, kind, value, until, key, stack) {
  if (key == null) {
    t.buffs.push({ kind, value, until });
    return;
  }
  const had = t.buffs.find(b => b.key === key);
  if (!had) {
    t.buffs.push({ kind, value, until, key, stacks: 1 });
    return;
  }
  had.until = until;
  if (stack > 1) {
    had.stacks = Math.min(stack, had.stacks + 1);
    had.value = value * had.stacks;
  }
}

/* 효과 목록을 대상들에게 적용한다. key 가 있으면 같은 효과는 중첩 규칙대로 갱신한다. */
/* 적에게 거는 해로운 효과 - 해로운 효과 면역이면 막힌다. */
const HARMFUL = new Set(['vuln', 'stun', 'taunt', 'atkDown', 'defDown', 'defCasterDown', 'dispel']);

function applyItems(caster, targets, items, f, side, foe, opts, skillKey, keyBase, spread = false, extraHow = {}) {
  const outer = attackId;
  try { applyItemsInner(caster, targets, items, f, side, foe, opts, skillKey, keyBase, spread, extraHow); } finally { attackId = outer; }
}
function applyItemsInner(caster, targets, items, f, side, foe, opts, skillKey, keyBase, spread, extraHow) {
  const skills = caster.cfg.skills;
  items.forEach((item, i) => {
    attackId = null;
    const value = atSkill(item.v, skills, skillKey);
    const until = f + Math.round(atSkill(item.dur, skills, skillKey) * FPS);
    const key = keyBase ? `${keyBase}:${i}` : null;
    if (item.when && !condOk(caster, item.when, f, side)) return;
    if (item.kind === 'damage' && (item.count || item.countState)) {
      /* 순차 공격 - 무작위 대상은 살아 있는 적을 돌아가며 맞힌다. countState 는 그 상태 중첩 수만큼 (메이든 MP). */
      const n = item.countState ? (caster.state[item.countState]?.stacks || 0) : Math.round(atSkill(item.count, skills, skillKey));
      for (let k = 0; k < n; k++) {
        /* 대상 지정 공격(명중한 적 등)은 그 적만 맞히고, 무작위 대상만 돌아가며 맞힌다. */
        const pool = spread && foe ? foe.slots.filter(x => x?.alive) : targets;
        if (!pool.length) return;
        const t = pool[caster.rot++ % pool.length];
        const scale = item.perState ? (caster.state[item.perState]?.stacks || 0) : 1;
        strike(caster, t, value * scale / 100, f, side, foe, opts, { ...item, ...extraHow, src: keyBase || 'burst' });
      }
      return;
    }
    if (item.kind === 'gauge') {
      /* 버스트 게이지 직접 충전 (팀 게이지) */
      side.gainNow[caster.pos] += value;
      return;
    }
    if (item.kind === 'fbExtend') {
      /* 풀 버스트 타임 지속 시간 ▲ (초) - 이미 시작했으면 늘리고, 아니면 다음 풀 버스트에 더한다. */
      if (side.fullBurst != null && side.fbUntil >= f) side.fbUntil += Math.round(value * FPS);
      else side.fbBonus = (side.fbBonus || 0) + Math.round(value * FPS);
      return;
    }
    if (item.kind === 'share') {
      const group = targets.filter(t => t.alive);
      for (const t of group) { t.share = group; t.shareUntil = Math.max(t.shareUntil, until); }
      return;
    }
    if (item.kind === 'damage') newAttack();
    for (const t of targets) {
      const enemy = foe && foe.slots.includes(t);
      if (enemy && HARMFUL.has(item.kind) && t.immuneUntil >= f) continue;
      switch (item.kind) {
        case 'damage': {
          const mult = item.modeMult && inMode(caster, f) ? item.modeMult : 1;
          const scale = item.perState ? Math.floor((caster.state[item.perState]?.stacks || 0) / (item.perDiv || 1)) : 1;
          strike(caster, t, (value * mult * scale) / 100, f, side, foe, opts, { ...item, ...extraHow, src: keyBase || 'burst' });
          break;
        }
        case 'undying': t.undyingUntil = Math.max(t.undyingUntil, until); break;
        case 'immune': t.immuneUntil = Math.max(t.immuneUntil, until); break;
        case 'stealth': t.stealthUntil = Math.max(t.stealthUntil, until); break;
        case 'decoy': t.decoy = Math.max(t.decoy, (maxHpOf(caster, f) * value) / 100); break;
        case 'maxHp': {
          /* 최대 체력이 늘면 늘어난 만큼 현재 체력도 는다. */
          const before = maxHpOf(t, f);
          pushBuff(t, 'maxHp', value, until, key && `${caster.rid}:${key}`, atSkill(item.stack, skills, skillKey));
          t.hp += Math.max(0, maxHpOf(t, f) - before);
          break;
        }
        case 'maxHpCaster': {
          const before = maxHpOf(t, f);
          pushBuff(t, 'maxHpFlat', (caster.stats.hp * value) / 100, until, key && `${caster.rid}:${key}`, 1);
          t.hp += Math.max(0, maxHpOf(t, f) - before);
          break;
        }
        case 'atkFromHp':
          pushBuff(t, 'atkFlat', (maxHpOf(caster, f) * value) / 100, until, key && `${caster.rid}:${key}`, 1);
          break;
        case 'defCaster':
          pushBuff(t, 'defFlat', (caster.stats.def * value) / 100, until, key && `${caster.rid}:${key}`, 1);
          break;
        case 'defCasterDown':
          pushBuff(t, 'defFlat', -(caster.stats.def * value) / 100, until, key && `${caster.rid}:${key}`, atSkill(item.stack, skills, skillKey));
          break;
        case 'atkDown': pushBuff(t, 'atk', -value, until, key && `${caster.rid}:${key}`, atSkill(item.stack, skills, skillKey)); break;
        case 'defDown': pushBuff(t, 'def', -value, until, key && `${caster.rid}:${key}`, atSkill(item.stack, skills, skillKey)); break;
        case 'dispel': {
          /* 이로운 효과 해제 n개 - 시간이 정해진 증가 효과를 최근 것부터 지운다. */
          let left = Math.round(value || 1);
          for (let k = t.buffs.length - 1; k >= 0 && left > 0; k--) {
            const b = t.buffs[k];
            if (b.until >= f && b.value > 0 && b.until < f + 600 * FPS) { t.buffs.splice(k, 1); left -= 1; }
          }
          break;
        }
        case 'coverRevive': if (t.cover <= 0) t.cover = (t.coverMax * value) / 100; break;
        case 'coverHeal': if (t.cover > 0) t.cover = Math.min(t.coverMax, t.cover + (t.coverMax * value) / 100); break;
        case 'coverHot': t.hots.push({ cover: (t.coverMax * value) / 100, next: f + DOT_INTERVAL, until }); break;
        case 'coverMaxUp': {
          const add = (maxHpOf(caster, f) * value) / 100;
          t.coverMax += add;
          if (t.cover > 0) t.cover += add;
          break;
        }
        case 'state': {
          /* 이름 붙은 상태와 중첩 (화력 게이지, 머슬 업 등). set 이면 값을 정하고 아니면 add 만큼 더한다. */
          const st = t.state[item.name] || { stacks: 0, until: -1 };
          st.stacks = item.set != null ? item.set : Math.max(0, Math.min(item.max ?? Infinity, st.stacks + (item.add ?? 1)));
          st.until = item.dur ? until : Infinity;
          t.state[item.name] = st;
          break;
        }
        case 'stateClear': delete t.state[item.name]; break;
        case 'chainStack':
          /* 미하라 사슬 감기 중첩 ▲ (최대 20) */
          if (t.chainStack > 0) t.chainStack = Math.min(20, t.chainStack + value);
          break;
        case 'chainAdd':
          /* 포획 사슬 충전 (최대 10) - 남은 사슬은 chainStrike 가 바로 이어서 쏜다 */
          t.chainLeft = Math.min(10, (t.chainLeft ?? 0) + value);
          if (t.chainNext < f) t.chainNext = f;
          break;
        case 'cdReduce':
          /* 액티브 스킬 재사용 시간 N% ▼ - 남은 시간을 전체 재사용 시간의 N% 만큼 당긴다 */
          for (const q of t.procs) {
            if (!q.active || q.skill !== item.target || q.next == null) continue;
            const full = Math.round(atSkill(q.every, t.cfg.skills, q.skill) * FPS);
            q.next = Math.max(f + 1, q.next - Math.round(full * value / 100));
          }
          break;
        case 'chargeSpd': case 'ammoPct': case 'reloadSpd': case 'accuracy': break;
        case 'dot':
          t.dots.push({ att: caster, side, foe, pct: value / 100, next: f + DOT_INTERVAL, until });
          break;
        case 'heal': restore(t, (maxHpOf(caster, f) * value) / 100, f); break;
        case 'hot':
          t.hots.push({ amount: (caster.stats.hp * value) / 100, next: f + DOT_INTERVAL, until });
          break;
        case 'shield':
          t.shield = Math.max(t.shield, (caster.stats.hp * value) / 100);
          t.shieldUntil = Math.max(t.shieldUntil, until);
          break;
        case 'sharedShield': {
          const own = side.slots.includes(t) ? side : foe;
          own.shared = Math.max(own.shared, (caster.stats.hp * value) / 100);
          own.sharedUntil = Math.max(own.sharedUntil, until);
          break;
        }
        case 'stun': t.stunUntil = Math.max(t.stunUntil, until); break;
        case 'invuln': t.invulnUntil = Math.max(t.invulnUntil, until); break;
        case 'taunt':
          /* 적에게 건 도발은 그 적만 시전자를 쏜다 (노아 S2 '명중 대상에게 도발').
             자신·아군에게 건 도발('주목 : 적 전체 도발')은 상대 전체가 시전자를 쏜다. */
          /* 받은 시점(tauntedAt·tauntFrom)은 '마지막에 받은 도발·주목이 이긴다' 판정에 쓴다. */
          if (foe.slots.includes(t)) {
            t.tauntedBy = caster;
            t.tauntedUntil = until;
            t.tauntedAt = f;
          } else {
            caster.tauntUntil = Math.max(caster.tauntUntil, until);
            caster.tauntFrom = f;
          }
          break;
        case 'atkCaster': {
          /* 시전자 기준 공격력 - 중첩 상태 수만큼 곱할 수 있다 (perState) */
          const scale = item.perState ? (caster.state[item.perState]?.stacks || 0) : 1;
          pushBuff(t, 'atkFlat', caster.stats.atk * value * scale / 100, until, key && `${caster.rid}:${key}`, 1);
          break;
        }
        default:
          pushBuff(t, item.kind, value, until, key && `${caster.rid}:${key}`, atSkill(item.stack, skills, skillKey));
          if (item.perState && item.kind !== 'atkCaster') {
            const b = t.buffs.find(x => x.key === (key && `${caster.rid}:${key}`)) || t.buffs.at(-1);
            b.perState = item.perState;
            b.perDiv = item.perDiv;
          }
      }
    }
  });
}

function blockTargets(block, caster, side, foe, shotTargets, f = 0) {
  if (ALLY_TO.has(block.to)) return allyTargets(block, caster, side.slots.filter(x => x?.alive), f);
  const picked = pickEnemies(block, caster, side, foe, shotTargets, f);
  /* 대상을 고르는 스킬(공격력이 가장 높은 적 등)도 도발을 따라 도발한 니케를 맨 앞에 둔다. 무작위·적 전체·명중 대상은 그대로다. */
  if (['enemyHighestAtk', 'enemyHighestHp', 'enemyLowestHp', 'enemyN'].includes(block.to) && !block.random) {
    const taunter = tauntTarget(caster, foe, f);
    if (taunter && !picked.includes(taunter)) return [taunter, ...picked].slice(0, Math.max(1, picked.length));
    if (taunter) return [taunter, ...picked.filter(x => x !== taunter)];
  }
  return picked;
}

function pickEnemies(block, caster, side, foe, shotTargets, f) {
  const alive = foe.slots.filter(x => x?.alive);
  const n = Math.max(1, Math.round(atSkill(block.n, caster.cfg.skills, block.skill) || 1));
  switch (block.to) {
    case 'enemyAll': return alive;
    case 'hit': return block.primary ? (shotTargets || alive).slice(0, 1) : (shotTargets || alive);
    case 'enemyHighestAtk': return [...alive].sort((a, b) => effectiveAtk(b, f) - effectiveAtk(a, f) || a.pos - b.pos).slice(0, n);
    case 'enemyHighestHp': return [...alive].sort((a, b) => maxHpOf(b, f) - maxHpOf(a, f) || a.pos - b.pos).slice(0, n);
    case 'enemyLowestHp': return [...alive].sort((a, b) => a.hp - b.hp || a.pos - b.pos).slice(0, n);
    default: {
      const count = Math.max(1, Math.round(atSkill(block.n, caster.cfg.skills, block.skill)));
      /* '무작위 적 N기' - 시드 난수로 뽑는다 (같은 시드면 같은 결과, 채점 표본마다 시드가 다르다) */
      if (block.random && side.rand) {
        const pool = [...alive];
        for (let i = pool.length - 1; i > 0; i--) {
          const j = Math.floor(side.rand() * (i + 1));
          [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        return pool.slice(0, count);
      }
      const sorted = block.prefer
        ? [...alive].sort((a, b) => Number(b.d.cls === block.prefer) - Number(a.d.cls === block.prefer) || a.pos - b.pos)
        : alive;
      return sorted.slice(0, count);
    }
  }
}

/* 발동 조건 (build_arena.py 의 cond / 효과별 when).
   selfHpBelow / selfHpAbove (%), fb (풀 버스트 타임 중), noFb, state: [이름, 최소 중첩], notState: 이름.
   alive (시전자 생존), enemiesAtMost / enemiesAtLeast (살아 있는 적 수). */
function condOk(sl, c, f, side) {
  if (!c) return true;
  const ratio = sl.hp / maxHpOf(sl, f) * 100;
  const v = x => atSkill(x, sl.cfg.skills, c.skill);
  if (c.selfHpBelow != null && !(ratio <= v(c.selfHpBelow))) return false;
  if (c.selfHpAbove != null && !(ratio >= v(c.selfHpAbove))) return false;
  if (c.fb && !(side.fbUntil >= f && side.fullBurst != null)) return false;
  if (c.noFb && side.fbUntil >= f && side.fullBurst != null) return false;
  if (c.alive && !sl.alive) return false;
  if (c.mode && !inMode(sl, f)) return false;
  if (c.stealth && !(sl.stealthUntil >= f)) return false;
  if (c.shield && !(sl.shieldUntil >= f && sl.shield > 0)) return false;
  if (c.decoy && !(sl.decoy > 0)) return false;
  if (c.coverBroken && !(sl.cover <= 0)) return false;
  if (c.teamHas && !side.slots.some(x => x?.alive && x.rid === c.teamHas)) return false;
  if (c.teamLacks && side.slots.some(x => x?.alive && x.rid === c.teamLacks)) return false;
  if (c.burstWithin != null && !(sl.castAt != null && f - sl.castAt <= c.burstWithin)) return false;
  if (c.otherStep != null) {
    /* 자신을 제외한 기본 버스트 단계가 Step N 인 아군이 있는지 (아니스 : 스타 스쿼드 구성) */
    const has = side.slots.some(x => x && x !== sl && x.d.step === c.otherStep);
    if (has !== !!c.otherStepHas) return false;
  }
  if (c.stateExact) {
    const st = sl.state[c.stateExact[0]];
    if ((st && st.until >= f ? st.stacks : 0) !== c.stateExact[1]) return false;
  }
  if (c.state) {
    const st = sl.state[c.state[0]];
    if (!st || st.until < f || st.stacks < (c.state[1] ?? 1)) return false;
  }
  if (c.notState) {
    const st = sl.state[c.notState];
    if (st && st.until >= f && st.stacks > 0) return false;
  }
  const foes = side.foe?.slots.filter(x => x?.alive).length;
  if (c.enemiesAtMost != null && foes > c.enemiesAtMost) return false;
  if (c.enemiesAtLeast != null && foes < c.enemiesAtLeast) return false;
  return true;
}

function fireProc(sl, p, side, foe, f, opts, shotTargets) {
  if (p.afterBurst && sl.castAt == null) return;
  if (p.limit != null && p.fired >= atSkill(p.limit, sl.cfg.skills, p.skill)) return;
  if (p.coolUntil >= f) return;
  if (!condOk(sl, p.cond, f, side)) return;
  let targets = blockTargets(p, sl, side, foe, shotTargets, f);
  /* 대상 상태 조건: targetIf { stunned, state: 이름, notState: 이름 } */
  if (p.targetIf) {
    const ti = p.targetIf;
    targets = targets.filter(t => (!ti.stunned || t.stunUntil >= f) && (!ti.chained || t.chainStack > 0)
      && (!ti.state || (t.state[ti.state]?.until >= f && t.state[ti.state].stacks > 0))
      && (!ti.notState || !(t.state[ti.notState]?.until >= f && t.state[ti.notState].stacks > 0)));
    if (!targets.length) return;
  }
  if (p.hitIf && !(shotTargets || []).some(t => t.state[p.hitIf]?.until >= f && t.state[p.hitIf].stacks > 0)) return;
  /* '체력 N% 이하라면 대상에게' - 조건에 맞는 대상만 */
  if (p.targetHpBelow) {
    const thr = atSkill(p.targetHpBelow, sl.cfg.skills, p.skill);
    targets = targets.filter(t => t.hp / maxHpOf(t, f) * 100 <= thr);
    if (!targets.length) return;
  }
  if (!targets.length && p.needTarget) return;
  p.fired += 1;
  if (p.cool) p.coolUntil = f + Math.round(atSkill(p.cool, sl.cfg.skills, p.skill) * FPS) - 1;
  applyItems(sl, targets, p.items, f, side, foe, opts, p.skill, `p${p.id}`, p.to === 'enemyN');
  logSkill(side, sl, f, p.skill, `p${p.id}`, p.items);
  /* 액티브 스킬(재사용 시간마다 자동 발동)이 터지면 '스킬 N 발동 시' 를 부른다 */
  if (p.active) {
    for (const q of sl.procs) if (q.on === 'skillCast' && q.castSkill === p.skill) fireProc(sl, q, side, foe, f, opts);
  }
}

const isHidden = (t, f) => t.hidden[f] === 1 || t.stunUntil >= f;

function hitCover(sl, t, pct, f, side, opts) {
  const base = Math.max(1, effectiveAtk(sl, f) - t.coverDef);
  const dmg = base * pct * dealMultiplier(sl, t, f, side, opts, { cover: true });
  t.cover = Math.max(0, t.cover - dmg);
  /* 영상 기록과 맞추면 엄폐물에 막힌 평타도 그 니케의 대미지 기록에는 들어간다. */
  if (opts.coverCounts ?? true) sl.dealt += dmg;
}

/* 평타가 엄폐물에 막혔으면 true. 숨어 있을 때 일반 탄은 엄폐물만, 관통은 엄폐물과 몸을 함께 맞힌다.
   로켓 폭발은 숨었는지와 상관없이 엄폐물과 몸을 각각 맞힌다 (nikke.gg 아레나 메커니즘). */
function coverTakes(sl, t, pct, f, side, opts) {
  if (t.invulnUntil >= f || t.cover <= 0) return false;
  if (sl.d.splash) {
    hitCover(sl, t, pct, f, side, opts);
    return false;
  }
  if (!isHidden(t, f)) return false;
  hitCover(sl, t, pct, f, side, opts);
  /* 관통 특화 (무기 자체 또는 스킬 버프) */
  return !(sl.d.pierce || buffSum(sl, 'pierce', f) > 0);
}

function fireShot(sl, e, side, foe, f, opts) {
  const targets = resolveTargets(sl, foe, f);
  const pct = e?.streamPct ?? shotPercent(sl, f);
  const count = sl.d.weapon === 'RL' || !e ? 1 : e.units;
  /* 게이지는 맞은 수만큼 차지만 대미지 칸 수는 따로 정할 수 있다 (홍련 : 신살은 맞힌 엄폐물까지 게이지에 든다). */
  newAttack();
  const reach = sl.rule.damageTargets ? (inMode(sl, f) ? sl.rule.damageTargets[1] : sl.rule.damageTargets[0]) : targets.length;
  /* RL 게이지는 폭발에 실제로 맞은 니케 수만큼 찬다 (맞은 대상 x 2 단위). 실측 단위(hits)를 둔 니케는 그 값을 쓴다. */
  if (e && sl.d.weapon === 'RL' && e.units > 0 && !e.streamPct && !inMode(sl, f)
      && sl.rule.hits == null && !sl.rule.pattern && !sl.rule.seq) {
    /* 공용 보호막이 켜져 있으면 폭발이 여럿을 덮어도 피사체 하나다. 디코이는 따로 맞는 오브젝트라 하나 더 센다. */
    const subjects = sharedOn(foe, f) ? Math.min(1, targets.length) : targets.length + targets.filter(t => t.decoy > 0).length;
    const ratio = subjects / wantedOf(sl, foe).length;
    if (ratio !== 1) side.gainNow[sl.pos] += (e.gain + side.aura * e.units) * (ratio - 1);
  }
  targets.forEach((t, i) => {
    if (i >= reach) {
      t.hitCount += count;
      t.hitNow = (t.hitNow || 0) + count;
      return;
    }
    t.hitCount += count;
    t.hitNow = (t.hitNow || 0) + count;
    if (coverTakes(sl, t, pct, f, side, opts)) return;
    /* 일반 공격을 방어력 무시 대미지로 적용 (은화 : 택티컬 업 카모플라쥬) */
    strike(sl, t, pct, f, side, foe, opts, { normal: true, src: 'shot', ignoreDef: buffSum(sl, 'ignoreDefNormal', f) > 0 });
  });
  attackId = null;
  sl.shots += 1;
  const mode = inMode(sl, f);
  const full = e?.streamPct ? false : mode ? sl.d.mode.fullCharge > 100 : sl.d.charge > 0;
  /* 최대 장탄을 다 쓰면 재장전이 끝나는 시점에 '재장전 완료 시' 가 터진다. */
  if (e?.last) {
    sl.reloadAt = f + Math.round(sl.d.reload * FPS * (1 - (sl.cfg.reloadPct || 0) / 100));
    sl.aimReset = true;   // 재장전하면 다음 사격 때 대상을 처음부터 다시 고른다
  }
  for (const p of sl.procs) {
    let go = false;
    switch (p.on) {
      case 'fullHit': case 'fullShot': go = full; break;
      case 'modeShot': go = mode; break;
      case 'everyShot': go = true; break;
      case 'last': go = !!e?.last; break;
      case 'critHits': {
        /* 크리티컬 N회 명중 - 크리티컬 확률 기댓값으로 센다. */
        p.seen += targets.length * critRateOf(sl, f, { normal: true });
        const every = Math.max(1, atSkill(p.every, sl.cfg.skills, p.skill));
        if (p.seen >= every) { p.seen -= every; go = true; }
        break;
      }
      case 'fullEvery': case 'everyShots': {
        if (p.on === 'fullEvery' && !full) break;
        if (p.streamOnly && !e?.streamPct) break;
        if (p.afterBurst && sl.castAt == null) break;
        p.seen += 1;
        const every = Math.max(1, Math.round(atSkill(p.every, sl.cfg.skills, p.skill)));
        if (p.seen >= every) {
          p.seen = 0;
          go = true;
        }
        break;
      }
      default:
    }
    if (go) fireProc(sl, p, side, foe, f, opts, targets);
  }
}

/* 사슬: 전투 시작 후 정해진 간격으로 한 개씩 쏘아 맞은 적에 지속 대미지가 쌓인다. */
function chainStrike(sl, side, foe, f, opts) {
  const c = sl.d.chain;
  const skills = sl.cfg.skills;
  if (sl.chainLeft == null) {
    sl.chainLeft = Math.round(atSkill(c.count, skills, 's1'));
    sl.chainNext = c.first;
  }
  if (sl.chainLeft > 0 && f >= sl.chainNext) {
    const alive = foe.slots.filter(x => x?.alive);
    if (alive.length) {
      const t = alive[sl.rot++ % alive.length];
      strike(sl, t, atSkill(c.hit, skills, 's1') / 100, f, side, foe, opts, { src: 'chain' });
      logSkill(side, sl, f, 's1', 'chain', [], { fx: ['damage', 'debuff'] });
      t.chainStack = Math.min(20, t.chainStack + 1);
      t.chainBy = sl;
      t.chainTick ??= f + DOT_INTERVAL;
    }
    sl.chainLeft -= 1;
    sl.chainNext += c.every;
  }
}

function pullChains(sl, side, foe, f) {
  const skills = sl.cfg.skills;
  for (const t of foe.slots) {
    if (!t?.alive || !t.chainStack) continue;
    t.dots.push({ att: sl, side, foe, pct: (atSkill(sl.d.chain.pull, skills) / 100) * t.chainStack,
      next: f + DOT_INTERVAL, until: f + 600 });
    t.chainStack = 0;
  }
}

function runTicks(side, f, opts) {
  for (const t of side.slots) {
    if (!t?.alive) continue;
    if (t.chainStack && t.chainTick <= f) {
      t.chainTick = f + DOT_INTERVAL;
      const by = t.chainBy;
      const pct = atSkill(by.d.chain.dot, by.cfg.skills, 's1') / 100;
      strike(by, t, pct * t.chainStack, f, side.foe, side, opts, { dot: true, src: 'dot' });
    }
    for (const hot of t.hots) {
      if (hot.next <= f && f <= hot.until) {
        hot.next += DOT_INTERVAL;
        if (hot.cover != null) {
          if (t.cover > 0) t.cover = Math.min(t.coverMax, t.cover + hot.cover);
        } else restore(t, hot.amount, f);
      }
    }
    for (const dot of t.dots) {
      if (dot.next <= f && f <= dot.until) {
        dot.next += DOT_INTERVAL;
        strike(dot.att, t, dot.pct, f, dot.side, dot.foe, opts, { dot: true, src: 'dot' });
      }
    }
  }
}

function runTimers(side, foe, f, opts) {
  if (side.full != null && f === side.full + 1) fireStage(side, foe, 1, f, opts);
  for (const sl of side.slots) {
    if (!sl?.alive || sl.stunUntil >= f) continue;
    if (sl.d.chain) chainStrike(sl, side, foe, f, opts);
    if (inMode(sl, f) && sl.d.mode.chargeFrames && sl.modeNext != null && f >= sl.modeNext) {
      fireShot(sl, null, side, foe, f, opts);
      sl.modeNext = f + sl.d.mode.chargeFrames + RECOVERY;
    }
    for (const p of sl.procs) {
      if (p.on === 'start' && f === 0) fireProc(sl, p, side, foe, f, opts);
      else if (p.on === 'fbStart' && side.fullBurst === f) fireProc(sl, p, side, foe, f, opts);
      else if (p.on === 'fbEnd' && side.fullBurst != null && side.fbUntil === f) fireProc(sl, p, side, foe, f, opts);
      else if (p.on === 'reloadDone' && sl.reloadAt === f) fireProc(sl, p, side, foe, f, opts);
      else if (p.on === 'hpBelow') {
        /* 지켜보는 아군(watch: self | 대상 고르기 규칙) 중 체력 비율이 기준 이하인 첫 니케에게 */
        const thr = atSkill(p.below, sl.cfg.skills, p.skill);
        const pool = p.watch === 'self' ? [sl]
          : allyTargets({ to: p.watch === 'neighbors' ? 'neighbors' : 'allyFilter', filter: p.watchFilter, excludeSelf: p.watchExcludeSelf },
            sl, side.slots.filter(x => x?.alive), f);
        const hit = pool.find(t => t.alive && t.hp / maxHpOf(t, f) * 100 <= thr);
        if (hit && !(p.onceEach && hit.state[`hp:${sl.rid}:${p.id}`])) {
          const before = p.fired;
          fireProc(sl, p, side, foe, f, opts, [hit]);
          if (p.fired > before && p.onceEach) hit.state[`hp:${sl.rid}:${p.id}`] = { stacks: 1, until: Infinity };
        }
      }
      else if (p.on === 'periodicFrames' && f >= p.next) {
        fireProc(sl, p, side, foe, f, opts);
        p.next = f + (sl.castAt != null && p.afterBurstEvery ? p.afterBurstEvery : p.every);
      } else if (p.on === 'periodic' || p.on === 'periodicFb') {
        if (p.on === 'periodicFb' && side.fbUntil < f) continue;
        const gap = Math.max(1, Math.round(atSkill(p.every, sl.cfg.skills, p.skill) * FPS));
        /* first0: 전투 시작에 한 번 터지고 그 뒤 주기마다 (엠마 환경 조성). 그 밖(액티브 스킬 포함)은 한 주기 뒤 첫 발동. */
        p.next ??= p.first0 ? f : f + gap;
        if (f >= p.next) {
          p.next += gap;
          fireProc(sl, p, side, foe, f, opts);
        }
      }
    }
  }
}

function applyBurst(caster, side, foe, f, opts, stage) {
  const blocks = caster.d.burstStage
    ? (caster.d.burstStage[Math.min(stage, 3) - 1] || []).map(i => caster.d.burst[i]).filter(Boolean)
    : caster.d.burst || [];
  caster.castAt = f;
  const m = caster.d.mode;
  let modeUntil = null;
  if (m && (!caster.d.modeStage || caster.d.modeStage === stage)) {
    caster.modeUntil = f + Math.round(atSkill(m.dur, caster.cfg.skills) * FPS);
    caster.modeNext = m.chargeFrames ? f + m.chargeFrames : null;
    modeUntil = caster.modeUntil;
  }
  /* 블록 조건(cond)은 버스트를 쓰는 순간에 본다 - 네온 초화력(화력 게이지 100)처럼 앞 블록이 상태를 바꾸므로 먼저 모두 판정한다. */
  const live = blocks.filter(b => condOk(caster, b.cond && { ...b.cond, skill: 'burst' }, f, side));
  for (const block of live) {
    const targets = blockTargets({ ...block, skill: 'burst' }, caster, side, foe, null, f);
    const n = block.to === 'enemyN' ? Math.round(atSkill(block.n, caster.cfg.skills)) : null;
    const how = { burstAoe: block.to === 'enemyAll', burstSingle: n === 1 || block.to === 'enemyHighestAtk' && n === 1 };
    /* block.skill: 다른 스킬의 효과를 버스트 단계에 붙인 블록 (레드 후드 S2) - 그 스킬 레벨로 값을 찾는다 */
    applyItems(caster, targets, block.items, f, side, foe, opts, block.skill || 'burst', null, false, how);
  }
  const items = live.flatMap(b => b.items || []);
  let dur = 0;
  for (const it of items) if (it.kind !== 'damage' && it.kind !== 'heal') dur = Math.max(dur, atSkill(it.dur, caster.cfg.skills) * FPS);
  logSkill(side, caster, f, 'burst', 'burst', items, {
    fx: [...(modeUntil != null ? ['mode'] : []), ...(caster.d.chain ? ['damage'] : [])],
    until: Math.max(modeUntil ?? 0, dur ? f + Math.round(dur) : 0) || null,
  });
  if (caster.d.chain) pullChains(caster, side, foe, f);
  for (const p of caster.procs) {
    if (p.on === 'onBurst') fireProc(caster, p, side, foe, f, opts);
  }
}

function fireStage(side, foe, stage, f, opts) {
  for (const sl of side.slots) {
    if (!sl?.alive) continue;
    for (const p of sl.procs) if (p.on === 'stage' && p.stage === stage) fireProc(sl, p, side, foe, f, opts);
  }
}

function stepBursts(side, foe, f, opts, data) {
  if (side.nextStageAt !== f) return;
  const castPos = new Set(side.cast.map(s => s.pos));
  const chain = burstChain(data, side.input.team,
    pos => !side.slots[pos]?.alive && !castPos.has(pos));
  let next = chain?.[side.cast.length];
  if (!next) {
    side.chainBroken = true;
    side.nextStageAt = null;
    return;
  }
  /* 차례인 니케가 기절 중이면 같은 단계의 다른 니케가 쓴다. 쓸 수 있는 니케가 없으면 기절이 풀릴 때까지 기다린다. */
  if (side.slots[next.pos].stunUntil >= f) {
    const stunned = pos => !castPos.has(pos) && side.slots[pos]?.stunUntil >= f;
    const alt = burstChain(data, side.input.team,
      pos => (!side.slots[pos]?.alive && !castPos.has(pos)) || stunned(pos))?.[side.cast.length];
    if (!alt) {
      side.nextStageAt = f + 1;
      return;
    }
    next = alt;
  }
  const caster = side.slots[next.pos];
  side.cast.push({ pos: next.pos });
  side.bursts.push({ f, rid: next.rid, pos: next.pos, stage: side.cast.length });
  applyBurst(caster, side, foe, f, opts, caster.d.step === 0 ? Math.min(side.cast.length, 3) : caster.d.step);
  /* 버스트 N단계 진입 시: 1단계는 게이지가 가득 찬 순간(runTimers), 2단계는 B1 직후.
     3단계 진입은 풀 버스트 시작과 같아 fbStart 로 읽는다. */
  if (side.cast.length === 1) fireStage(side, foe, 2, f, opts);
  if (side.cast.length === chain.length) {
    side.fullBurst = f;
    side.fbUntil = f + FULL_BURST_FRAMES + (side.fbBonus || 0);
    side.fbBonus = 0;
    side.nextStageAt = null;
  } else {
    side.nextStageAt = f + NEXT_BURST_DELAY;
  }
}

function runShots(side, foe, f, opts) {
  const list = side.bucket[f];
  if (!list) return;
  for (const { e, sl } of list) {
    if (!sl.alive || sl.stunUntil >= f) continue;
    const gain = e.gain + side.aura * e.units;
    side.gainNow[sl.pos] += gain;
    side.spentNow += e.bullets || 0;
    if (!e.bullets) continue;
    if (inMode(sl, f) && sl.d.mode.chargeFrames) continue;
    fireShot(sl, e, side, foe, f, opts);
  }
}

/* 맞은 횟수로 차는 반격과, 소비 탄으로 차는 충전. */
function runReactions(side, f) {
  const unit = sl => sl.d.rate * (1 + (sl.cfg.gaugePct || 0) / 100) + side.aura;
  for (const sl of side.slots) {
    if (!sl?.alive) continue;
    const c = sl.rule.counter;
    if (c) {
      const every = lvOf(c.every, sl.cfg.skills);
      const chance = lvOf(c.chance, sl.cfg.skills) / 100;
      /* 확률 반격은 기댓값으로 매 피격에 나눠 넣으므로 타임라인에는 찍지 않는다. */
      if (chance && sl.hitNow) side.gainNow[sl.pos] += sl.hitNow * chance * unit(sl) * c.units;
      else if (every) {
        let count = sl.counterCount || 0;
        count += sl.hitNow || 0;
        for (const p of sl.cfg.linkSlots || []) count += side.slots[p]?.hitNow || 0;
        while (count >= every) {
          count -= every;
          side.gainNow[sl.pos] += unit(sl) * c.units;
          logSkill(side, sl, f, c.every.skill, 'counter', [], { fx: ['gauge'] });
        }
        sl.counterCount = count;
      }
    }
    /* 아군이 소비한 탄 N발마다 */
    for (const p of sl.procs) {
      if (p.on !== 'teamAmmo') continue;
      p.seen += side.spentNow;
      const every = Math.max(1, atSkill(p.every, sl.cfg.skills, p.skill));
      while (p.seen >= every) {
        p.seen -= every;
        fireProc(sl, p, side, side.foe, f, side.opts || {});
      }
    }
    const a = sl.rule.ammoBurst;
    if (a) {
      const every = lvOf(a.n, sl.cfg.skills);
      const pct = lvOf(a.gain, sl.cfg.skills);
      sl.spent += side.spentNow;
      while (every && sl.spent >= every) {
        sl.spent -= every;
        side.gainNow[sl.pos] += pct;
        logSkill(side, sl, f, a.n.skill, 'ammo', [], { fx: ['gauge'] });
      }
    }
  }
}

/* opts.deaths: 'all' 바로 죽는다 | 'afterFull' 자기 팀 풀 버스트 전에는 체력 0 이어도 버틴다 (DEATH_HOLD_CAP 까지) | 'hold' (기본) | 'none'.
   'hold' 는 afterFull 과 같되 체력 0 이 된 순간 '전투불능 시' 효과(로산나 S2, 미하라 사슬)는 바로 발동한다.
   상대 스펙을 몰라 사망 시점 예측이 빗나가므로, 이른 사망이 버스트 체인을 무너뜨리지 않게 쓰러짐을 미룬다. */
const DEATH_HOLD_CAP = 600;
const holds = mode => mode === 'afterFull' || mode === 'hold';
const canDie = (side, f, mode) => mode === 'all' || (holds(mode) && (side.fullBurst != null || f >= DEATH_HOLD_CAP));

function runDeaths(sides, f, mode = 'all', forced = null) {
  const died = [];
  /* 진단용 forced: [{pos: frame}, {pos: frame}] - 영상의 사망 시점에 쓰러뜨리고, 그 밖엔 체력 0 이 되어도 버틴다. */
  if (forced) {
    sides.forEach((side, k) => {
      for (const sl of side.slots) {
        if (!sl?.alive) continue;
        const at = forced[k]?.[sl.pos];
        if (at != null && f >= at) sl.hp = 0;
        else if (sl.hp <= 0) sl.hp = 1;
      }
    });
    mode = 'all';
  }
  for (const side of sides) {
    const can = canDie(side, f, mode);
    for (const sl of side.slots) {
      if (!sl?.alive || sl.hp > 0) continue;
      const trigger = !sl.downCounted && (can || mode === 'hold');
      if (can) {
        sl.alive = false;
        sl.hp = 0;
        sl.deathFrame = f;
        side.deaths.push({ f, pos: sl.pos, rid: sl.rid, by: sl.lastHit });
      }
      if (trigger) {
        sl.downCounted = true;
        died.push(sl);
        /* 미하라 : 본딩 체인 S2 - 전투 불능 시 사슬 감기 상태인 적 전부 중첩 20 */
        if (sl.d.chain) {
          for (const t of side.foe.slots) {
            if (t?.alive && t.chainStack) t.chainStack = 20;
          }
        }
      }
    }
  }
  if (!died.length) return;
  /* 전투불능 시 발동: anyDeath(니케 누군가), enemyDeath(적), allyDeath(아군), selfDeath(자신 - 쓰러져도 발동) */
  for (const side of sides) {
    for (const sl of side.slots) {
      if (!sl) continue;
      for (const p of sl.procs) {
        for (const d of died) {
          const mine = side.slots.includes(d);
          const go = (p.on === 'anyDeath' && sl.alive) || (p.on === 'enemyDeath' && sl.alive && !mine)
            || (p.on === 'allyDeath' && sl.alive && mine && d !== sl) || (p.on === 'selfDeath' && d === sl);
          if (go && p.deadChained && !d.chainStack) continue;
          if (go) fireProc(sl, p, side, side.foe, f, side.opts || {});
        }
      }
    }
  }
  for (const side of sides) {
    for (const sl of side.slots) {
      const r = sl?.alive && sl.rule.onDeath;
      if (!r) continue;
      side.gainNow[sl.pos] += lvOf(r.gauge, sl.cfg.skills) * died.length;
      for (let i = 0; i < died.length; i++) {
        sl.buffs.push({ kind: 'atk', value: lvOf(r.atk, sl.cfg.skills), until: f + 30 * FPS });
      }
      logSkill(side, sl, f, r.gauge?.skill, 'death', [], { fx: ['gauge', ...(r.atk ? ['buff'] : [])], until: r.atk ? f + 30 * FPS : null });
    }
  }
}

function settle(side, f, horizon) {
  const n = side.slots.length;
  let total = 0;
  for (let i = 0; i < n; i++) {
    total += side.gainNow[i];
    side.cumulative[i][f] = (f ? side.cumulative[i][f - 1] : 0) + side.gainNow[i];
    side.gainNow[i] = 0;
    const sl = side.slots[i];
    if (sl) {
      side.dealtTrace[i][f] = sl.dealt;
      /* 최대 체력 ▲ 가 끝나면 넘친 체력을 깎는다. */
      const cap = maxHpOf(sl, f);
      if (sl.hp > cap) sl.hp = cap;
      side.hpTrace[i][f] = Math.max(0, sl.hp) / sl.stats.hp;
      sl.hitNow = 0;
    }
  }
  side.spentNow = 0;
  if (side.full == null) {
    side.sum = Math.round((side.sum + total) * 1000) / 1000;
    if (side.sum >= 100) {
      side.full = f;
      side.nextStageAt = f + FIRST_BURST_DELAY;
    }
  }
  side.gauge[f] = Math.min(100, side.sum);
  return horizon;
}

/* a, b: { team: [{ rid, cfg, stats } | null], side }  opts: { damageScale } */
export function simulateBattle(data, a, b, opts = {}, horizon = HORIZON) {
  const A = makeSide(data, a, horizon, opts);
  const B = makeSide(data, b, horizon, opts);
  A.data = data; B.data = data;
  A.foe = B; B.foe = A;
  A.opts = opts; B.opts = opts;
  /* 무작위 대상용 난수 (mulberry32). opts.seed 가 없으면 1 - 화면 결과는 항상 같다. */
  let seed = (opts.seed ?? 1) >>> 0;
  A.rand = B.rand = () => {
    seed = (seed + 0x6D2B79F5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
  for (let f = 0; f <= horizon; f++) {
    stepBursts(A, B, f, opts, data);
    stepBursts(B, A, f, opts, data);
    runTimers(A, B, f, opts);
    runTimers(B, A, f, opts);
    runTicks(A, f, opts);
    runTicks(B, f, opts);
    runShots(A, B, f, opts);
    runShots(B, A, f, opts);
    runReactions(A, f);
    runReactions(B, f);
    runDeaths([A, B], f, opts.deaths ?? 'hold', opts.forcedDeaths);
    settle(A, f, horizon);
    settle(B, f, horizon);
  }
  const out = side => ({
    gauge: side.gauge,
    full: side.full,
    bursts: side.bursts,
    fullBurst: side.fullBurst,
    chainBroken: side.chainBroken,
    deaths: side.deaths,
    cumulative: side.cumulative,
    hpTrace: side.hpTrace,
    dealt: side.slots.map(x => x?.dealt || 0),
    dealtTrace: side.dealtTrace,
    events: side.events,
    wiped: side.slots.some(Boolean) && side.slots.every(x => !x || !x.alive),
  });
  return { a: out(A), b: out(B) };
}
