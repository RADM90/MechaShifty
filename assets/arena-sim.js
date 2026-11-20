/* 아레나 버스트 타이밍 시뮬레이터 (Draft, 화면 없음). 니케마다 프레임별 충전 이벤트를 만들어 팀 게이지가 100 에 닿는 프레임과 버스트 체인을 구한다.
   60프레임 기준이며 1RL 은 76프레임이다. 발당 충전량·탄창·재장전·차지 시간은 CDN(data/arena.json) 값이고, 공격 간격·착탄 지연·체인 간격은 영상 실측값이다. */

export const FPS = 60;
export const RL_FRAMES = 76;
export const HORIZON = 900;

/* 게이지 100 → 1버스트는 게이지 가득 섬광부터 1단계 사용까지의 최빈값(25f, 53건 중 47건이 23~26f)이다.
   다음 버스트까지는 컷신을 끈 영상의 HUD 단계 전환 간격(31~33f)이다. */
const FIRST_BURST_DELAY = 25;   // 게이지 100 → 1버스트
const NEXT_BURST_DELAY = 32;    // 다음 버스트까지

/* 무기별 실제 공격 간격 (프레임). 표기 연사 속도보다 약간 길다. */
const AUTO_INTERVAL = { 720: 6, 1440: 4, 90: 42 };
const autoInterval = rof => AUTO_INTERVAL[rof] ?? Math.ceil(FPS * 60 / rof) + 1;

/* 차지 속도 % → 단축 프레임. */
const CHARGE_CUTS = [[44, 28], [41, 26], [38, 24], [35, 22], [31, 20], [28, 18], [25, 16],
  [21, 14], [18, 12], [15, 10], [11, 8], [8, 6], [5, 4], [2, 2]];

export function chargeCut(pct) {
  const p = Math.floor(pct);
  /* 표(44%)를 넘으면 같은 기울기(약 0.64프레임/%)로 늘린다 - 레드 후드 무기 변경 100.8% 등 */
  if (p > 44) return 28 + Math.round((p - 44) * 0.64);
  const row = CHARGE_CUTS.find(([from]) => p >= from);
  return row ? row[1] : 0;
}

/* 차지 속도 ▼ 합(음수) - 차지 시간이 그 비율만큼 늘어난다 (에이다 특수 개조 300% ▼) */
const slowOf = values => values.reduce((s, v) => s + (v < 0 ? -v : 0), 0);

/* 같은 수치끼리 묶어 합한 뒤 반올림해 더한다 - 옵션 여러 줄을 게임이 합치는 방식으로 측정된 규칙. */
export function sumChargeSpeed(values) {
  const groups = new Map();
  for (const v of values) if (v > 0) groups.set(v, (groups.get(v) || 0) + v);
  let sum = 0;
  for (const g of groups.values()) sum += Math.round(g);
  return sum;
}

/* 로켓이 맞기까지의 지연 (쏘는 RL 의 자리). 공격·방어 공통으로 P1~P3 이 P4·P5 보다 2프레임 늦다. */
export function landDelay(pos) {
  return pos <= 2 ? 16 : 14;
}

/* 폭발 반경 → 로켓 1발의 타격 단위 (명중 대상 수 x 2). */
function rocketUnits(range) {
  if (range >= 750) return 6;
  if (range >= 500) return 4;
  return 2;
}

function baseUnits(n) {
  switch (n.weapon) {
    case 'RL': return n.charge ? rocketUnits(n.range) * n.muzzle : 4;
    case 'SG': return n.shots * n.muzzle;
    case 'SMG': case 'AR': case 'MG': case 'SR': return n.muzzle;
    default: return 1;
  }
}

/* { skill, values } 를 스킬 레벨로 찾는다. */
const atLevel = (lvRule, skills) =>
  lvRule ? (lvRule.values[(skills?.[lvRule.skill] ?? 10) - 1] ?? 0) : 0;

/* 규칙 + 애장품 규칙. */
export function ruleOf(data, rid, treasure) {
  const r = data.rules[rid];
  if (!r) return {};
  return treasure && r.fav ? { ...r, ...r.fav } : r;
}

export const hasTreasureRule = (data, rid) => !!data.rules[rid]?.fav;

/* 니케 한 명의 충전 이벤트 [{ f, gain, units }].
   cfg: { chargeValues: [%...], gaugePct, ammoPct | ammoParts | ammoMax, reloadPct, skills, treasure } */

/* 최대 장탄. 게임은 같은 단계 옵션끼리 묶어 '발 수'로 반올림(.5 올림)한 뒤 더한다 (nipago/effective.js 와 같은 모델).
   소장품·큐브도 묶음 하나로 본다. 영상의 최대 장탄 25명으로 확인했다. ammoMax 는 영상에서 읽은 값을 그대로 쓴다. */
export function magazine(base, cfg) {
  if (cfg.ammoMax) return cfg.ammoMax;
  const parts = cfg.ammoParts || (cfg.ammoPct ? [cfg.ammoPct] : []);
  return Math.max(1, base + parts.reduce((s, p) => s + Math.floor((2 * base * Math.round(p * 100) + 10000) / 20000), 0));
}
/* 사격 이벤트 생성기. 결정 프레임(st.t)마다 WAIT 를 내고, 전투(arena-battle.js)는 그 프레임이 되면 이어서 뽑는다.
   live 가 있으면 사격마다 전투 중 버프(차지 속도·최대 장탄·재장전 속도·펠릿)를 읽고, st.ammo 는 탄환 충전이 바로 바꾼다.
   이벤트 phase 는 같은 프레임 안 처리 순서다 (0 사격, 1 주기 충전, 2 지속 대미지). { cover: [a, b] } 는 엄폐 구간. */
export const WAIT = Symbol('wait');
export function* shotStream(data, rid, cfg, pos, side, horizon = HORIZON, live = null, st = {}, start = 0) {
  const n = data.nikkes[rid];
  if (!n) return;
  const rule = ruleOf(data, rid, cfg.treasure);
  const gaugeMult = (1 + (cfg.gaugePct || 0) / 100)
    * (1 + atLevel(rule.selfGauge, cfg.skills) / 100);
  const unit = n.rate * gaugeMult;
  let seq = 0;
  const buf = [];
  const add = (f, units, flat = 0, bullets = 0, phase = 0) => {
    if (f > horizon) return null;
    const e = { f: Math.round(f), gain: units * unit + flat, units, bullets, phase, seq: seq++ };
    buf.push(e);
    return e;
  };
  function* flush() { while (buf.length) yield buf.shift(); }
  const liveCharge = () => live?.charge?.() || [];
  const ammoMaxNow = () => rule.noReload ? Infinity
    : live ? magazine(n.ammo, { ...cfg, ammoParts: [...(cfg.ammoParts || (cfg.ammoPct ? [cfg.ammoPct] : [])), ...(live.ammoParts?.() || [])] }) + (live.ammoFlat?.() || 0)
    : magazine(n.ammo, cfg);
  /* 재장전 속도 합이 100% 를 넘으면 즉시 재장전으로 본다 (최소 1프레임) */
  const reloadNow = () => Math.max(1, Math.round(n.reload * FPS * (1 - ((cfg.reloadPct || 0) + (live?.reload?.() || 0)) / 100)));

  const p = rule.periodic;
  if (p) for (let t0 = start + p.first; t0 <= horizon; t0 += p.every) for (const o of p.offsets) add(t0 + o, p.units, 0, 0, 1);
  /* 무기 변경 '장탄 수 무한' 동안은 탄을 쓰지 않는다 */
  const spend = n0 => (live?.infinite?.() ? 0 : n0);
  yield* flush();

  if (n.weapon === 'MG') {
    /* 사격장 영상 3개로 확인한 연사 공식: 표기 시작 연사에서 발마다 빨라지고, 프레임당 1발이 상한이다.
       탄창을 비우면 재장전한 뒤 예열부터 다시 한다. */
    const mult = rule.hits || 1;
    let f = start, rpm = n.rof0, fired = 0;
    st.ammo = ammoMaxNow();
    while (f <= horizon) {
      st.t = Math.round(f);
      yield WAIT;
      add(f, mult, 0, 1);
      st.ammo -= spend(1);
      /* 탄충 큐브: 10발 사격마다 탄환 N발 충전 (N = 큐브 수치, 큐브 레벨에 따라 1·2·3발) */
      if (cfg.bastion && ++fired % BASTION_EVERY === 0) st.ammo += cfg.bastion;
      yield* flush();
      st.t = Math.round(f) + 1;
      yield WAIT;
      if (st.ammo <= 0) {
        const reloadFrames = reloadNow();
        st.ammo = ammoMaxNow();
        rpm = n.rof0;
        yield { cover: [Math.round(f) + 1, Math.round(f + reloadFrames)] };
        f += reloadFrames;
      } else {
        st.ammo = Math.min(st.ammo, ammoMaxNow());
        f += Math.max(FPS * 60 / rpm, 1);
        /* 머신건 예열 속도 ▲/▼ 는 발마다 오르는 연사 폭을 바꾼다 */
        rpm = Math.min(n.rof, rpm + n.rofStep * Math.max(0, 1 + (live?.warm?.() || 0) / 100));
      }
    }
    return;
  }

  const speeds = cfg.chargeValues || [];
  const charged = n.charge > 0 || rule.first != null;
  const baseCharge = rule.baseCharge ?? n.charge;
  const chargeFrames = extra => {
    const fix = live?.chargeFix?.();
    if (fix != null) return fix;
    if (rule.fixedCharge) return baseCharge;
    const all = [...speeds, ...extra, ...liveCharge()];
    const cut = chargeCut(sumChargeSpeed(all));
    return Math.max(1, (baseCharge - cut * (rule.chargeScale || 1)) * (1 + slowOf(all) / 100));
  };
  const recover = rule.recover ?? 16;
  const land = cfg.noLand ? 0
    : rule.land ?? (n.weapon === 'RL' && rule.first == null ? landDelay(pos, side) : 0);

  const hitsPerShot = rule.hits ?? baseUnits(n);
  const flat = atLevel(rule.flat, cfg.skills);
  const interval = charged ? 0 : (rule.interval ?? autoInterval(n.rof));
  const everyHits = rule.everyHits || [];
  const everyShots = rule.everyShots || [];
  const hitCounters = everyHits.map(() => 0);
  let t = start + (charged ? (rule.first ?? chargeFrames([])) : (rule.first ?? 0));
  st.ammo = ammoMaxNow();
  let shots = 0, fired = 0;
  let dotStart = null;
  const dot = rule.dot || rule.dotAfterHits;
  const startDot = f0 => {
    dotStart = f0;
    for (let f = dotStart + dot.every; f <= horizon; f += dot.every) add(f, dot.units, 0, 0, 2);
  };

  while (t + land <= horizon) {
    st.t = Math.floor(t);
    yield WAIT;
    shots += 1;
    /* 펠릿 개수 ▲ (샷건) - 타격 단위와 대미지가 펠릿 수에 비례한다 */
    /* 펠릿 개수 N개로 고정(도로시 : 세렌디피티)이면 늘린 펠릿 대신 그 수 */
    const fixP = n.weapon === 'SG' ? live?.pelletFix?.() : null;
    const pellets = n.weapon === 'SG' && live?.pellets ? live.pellets() * n.muzzle : 0;
    const base0 = shots === 1 && rule.firstHits != null ? rule.firstHits
      : rule.pattern ? rule.pattern[(shots - 1) % rule.pattern.length]
      : hitsPerShot;
    const units = fixP != null ? fixP * n.muzzle : base0 + pellets;
    const seq0 = rule.seq || [[0, units]];
    let lastShot = null;
    seq0.forEach(([offset, u], i) => {
      const e = add(t + land + offset, u, i === 0 ? flat : 0, i === 0 || rule.seqBullets ? 1 : 0);
      if (e && units !== base0 && n.weapon === 'SG' && !rule.seq) e.pelletMul = units / base0;
      if (e?.bullets) lastShot = e;
    });

    const landed = seq0.reduce((sum, [, u]) => sum + u, 0);
    if (shots === 1 && rule.firstExtra) add(t + land, rule.firstExtra);
    if (rule.firstShotsExtra && shots <= rule.firstShotsExtra.n) add(t + land, rule.firstShotsExtra.units);
    everyHits.forEach((rowRule, i) => {
      hitCounters[i] += landed;
      while (hitCounters[i] >= rowRule.n) {
        hitCounters[i] -= rowRule.n;
        add(t + land, rowRule.units);
      }
    });
    for (const row of everyShots) {
      if (shots % row.n === 0) add(t + land + (row.delay || 0), row.units);
    }

    /* 탄은 공격 한 번에 1발 - 일제 사격(seqBullets, 베스티 : 택티컬 업 4발)은 발마다 1발씩 쓴다 */
    const used = rule.seqBullets ? seq0.length : 1;
    st.ammo -= spend(used);
    if (cfg.bastion) {
      st.ammo += (Math.floor((fired + used) / BASTION_EVERY) - Math.floor(fired / BASTION_EVERY)) * cfg.bastion;
      fired += used;
    }
    if (st.ammo <= 0 && lastShot) lastShot.last = true;
    if (st.ammo <= 0 && rule.lastBullet) add(t + land + 12, rule.lastBullet);

    if (rule.stream && shots >= rule.stream.after) {
      const s = rule.stream;
      /* 연사 탄창은 무기가 바뀌는 순간의 최대 장탄 (라플라스 : 얼티밋 히어로 S1 '사용 무기 변경 시 최대 장탄 수 효과 갱신') */
      const count = magazine(s.count, cfg);
      for (let k = 1; k <= count; k++) {
        const e = add(t + land + k * s.every, 0, 0, 1);
        if (e) { e.gain = s.gain * gaugeMult; e.streamPct = atLevel(s.pct, cfg.skills) / 100; }
      }
    }
    if (dot && dotStart == null) {
      if (rule.dot) startDot(t + land);
      else if (shots * landed >= rule.dotAfterHits.n) startDot(t + land);
    }
    yield* flush();
    if (rule.stream && shots >= rule.stream.after) {
      /* 연사를 다 쏘면 남은 탄환이 제거되어 재장전하고, 예열(차지 속도 중첩)부터 다시 쌓는다 (라플라스 : 얼티밋 히어로 S1) */
      const end = t + land + rule.stream.every * magazine(rule.stream.count, cfg);
      const reload = reloadNow();
      yield { cover: [Math.round(end) + 1, Math.round(end + reload)] };
      t = end + reload + chargeFrames([]);
      shots = 0;
      st.ammo = ammoMaxNow();
      continue;
    }

    /* 다음 사격은 한 프레임 뒤에 정한다 - 이번 사격의 탄환 충전(스킬)이 먼저 들어가야 재장전 여부가 맞다 */
    st.t = Math.floor(t) + 1;
    yield WAIT;
    const extra = [];
    if (rule.chargeAfterFirst) extra.push(atLevel(rule.chargeAfterFirst, cfg.skills));
    if (rule.chargeRamp) extra.push(rule.chargeRamp * Math.min(shots, 4));
    if (rule.chargeStack) {
      const v = atLevel(rule.chargeStack, cfg.skills);
      for (let i = 0; i < Math.min(shots, rule.chargeStack.max); i++) extra.push(v);
    }
    /* rampGaps: 차지 속도 옵션이 없을 때 실측한 풀 차지 사이 간격(N발째 -> N+1발째). 옵션이 있으면 그 몫만큼 당긴다. */
    const measured = rule.rampGaps?.[shots - 1];
    /* 공격 속도 ▲ 는 차지 없는 무기의 공격 간격을 줄인다 */
    const fix = live?.chargeFix?.();
    const next = !charged ? Math.max(1, Math.round(interval / (1 + (live?.rof?.() || 0) / 100)))
      : fix != null ? fix + (rule.cycle != null ? rule.cycle - baseCharge : recover)
      : measured != null
        ? Math.max(1, measured - (chargeCut(sumChargeSpeed([...speeds, ...extra, ...liveCharge()])) - chargeCut(sumChargeSpeed(extra))) * (rule.chargeScale || 1))
        : (rule.cycle ?? (chargeFrames(extra) + recover));

    if (st.ammo <= 0) {
      const reload = reloadNow();
      st.ammo = ammoMaxNow();
      yield { cover: [Math.round(t) + 1, Math.round(t + reload)] };
      t += reload + (charged ? chargeFrames(extra) : 0);
    } else {
      st.ammo = Math.min(st.ammo, ammoMaxNow());
      /* 연속 차지 사격 니케(연사 속도 rof > 60)와 rule.noCover 니케는 사격 사이에 엄폐하지 않고 바로 다음 차지에 들어간다. */
      if (charged && !((n.rof ?? 60) > 60) && !rule.noCover) yield { cover: [Math.round(t) + 1, Math.round(t + Math.min(recover, next))] };
      t += next;
    }
  }
}

/* 니케 한 명의 충전 이벤트 전부 (전투 밖 타임라인용). 순서는 사격, 주기 충전, 지속 대미지. */
export function nikkeEvents(data, rid, cfg, pos, side, horizon = HORIZON) {
  const out = [];
  out.cover = [];
  for (const e of shotStream(data, rid, cfg, pos, side, horizon)) {
    if (e === WAIT) continue;
    if (e.cover) out.cover.push(e.cover);
    else out.push(e);
  }
  const sorted = out.map((e, i) => [e, i]).sort((a, b) => a[0].phase - b[0].phase || a[1] - b[1]).map(x => x[0]);
  sorted.cover = out.cover;
  return sorted;
}

/* 체인 순서 - P1 부터 차례로 훑어 그 단계를 쓸 수 있는 첫 니케를 고른다. 전 단계 버스트(레드 후드)도 후보이고, out(pos) 가 참인 칸은 뺀다.
   재진입 니케는 순수하게 그 단계인 다른 니케가 있어야 이어진다. 필수 재진입(티아 등)이 없으면 체인이 끊기고, 아니스 : 스타는 건너뛴다. */
export function burstChain(data, team, out = () => false) {
  /* assistStep: 기본 버스트 단계가 그 단계인 다른 아군이 없으면 그 단계로 바뀐다 (라피 : 레드 후드 전투 보조) */
  const base = team.map(s => s?.rid && data.nikkes[s.rid]?.step);
  const stepOf = (rid, pos) => {
    const n = data.nikkes[rid];
    return n?.assistStep && !base.some((b, i) => i !== pos && b === n.assistStep) ? n.assistStep : n?.step;
  };
  const slots = team.map((s, pos) => (s?.rid ? { ...s, pos, step: stepOf(s.rid, pos) } : null))
    .filter(x => x && !out(x.pos));
  const used = new Set();
  const take = test => {
    const s = slots.find(x => !used.has(x.pos) && test(x));
    if (s) used.add(s.pos);
    return s || null;
  };
  const chain = [];
  for (let stage = 1; stage <= 3; stage++) {
    const s = take(x => x.step === stage || x.step === 0);
    if (!s) return null;
    chain.push(s);
    const re = ruleOf(data, s.rid, s.cfg?.treasure).reenter;
    if (!re) continue;
    const again = take(x => x.step === re.step);
    if (again) {
      chain.push(again);
      stage = re.step;
    } else if (re.mode === 'required') return null;
  }
  return chain;
}

/* 어느 자리를 맞히는가 - 번호는 0(P1)~4(P5). 비어 있으면 그쪽에서 가장 가까운 니케가 맞는다. */
export function hitPositions(data, rid, cfg) {
  const n = data.nikkes[rid];
  const rule = ruleOf(data, rid, cfg?.treasure);
  if (rule.targets) return rule.targets;
  if (n.weapon === 'SR') return [4];
  if (n.weapon === 'RL') return n.range >= 750 ? [0, 1, 2] : n.range >= 500 ? [0, 1] : [0];
  return [0];
}

function resolveSlot(pos, occupied) {
  if (occupied.includes(pos)) return pos;
  if (!occupied.length) return null;
  return pos >= 3 ? occupied.at(-1) : occupied[0];
}

/* 상대 공격이 내 슬롯별로 몇 타씩 들어오는지 프레임별로 센다. */
function incomingHits(data, team, opp, horizon) {
  const hits = team.map(() => new Float64Array(horizon + 1));
  const occupied = team.flatMap((s, i) => (s?.rid ? [i] : []));
  if (!opp?.team || !occupied.length) return hits;
  opp.team.forEach((s, pos) => {
    if (!s?.rid) return;
    const isRocket = data.nikkes[s.rid].weapon === 'RL';
    const targets = [...new Set(hitPositions(data, s.rid, s.cfg)
      .map(t => resolveSlot(t, occupied)))];
    for (const e of nikkeEvents(data, s.rid, s.cfg || {}, pos, opp.side, horizon)) {
      const count = isRocket ? (e.bullets ? 1 : 0) : e.units;
      if (!count) continue;
      for (const t of targets) hits[t][e.f] += count;
    }
  });
  return hits;
}

/* opp: { team, side } - 상대 편성. 없으면 피격 충전은 0 이다. */
export function simulateTeam(data, team, side, opp = null, horizon = HORIZON) {
  const perSlot = team.map((s, pos) =>
    (s?.rid ? nikkeEvents(data, s.rid, s.cfg || {}, pos, side, horizon) : []));

  /* 아니스 : 스타 같은 아군 전체 가산은 타격 단위마다 붙는다. */
  let aura = 0;
  team.forEach(s => {
    if (!s?.rid) return;
    const r = ruleOf(data, s.rid, s.cfg?.treasure);
    if (r.aura) aura += data.nikkes[s.rid].rate * atLevel(r.aura, s.cfg?.skills) / 100;
  });

  const gainByFrame = new Float64Array(horizon + 1);
  const slotByFrame = perSlot.map(() => new Float64Array(horizon + 1));
  perSlot.forEach((events, i) => {
    for (const e of events) {
      const g = e.gain + aura * e.units;
      gainByFrame[e.f] += g;
      slotByFrame[i][e.f] += g;
    }
  });

  /* 피격 반격 - 자칼은 N회마다, 홍련은 확률 기댓값으로 충전한다. */
  const taken = incomingHits(data, team, opp, horizon);
  team.forEach((s, i) => {
    if (!s?.rid) return;
    const rule = ruleOf(data, s.rid, s.cfg?.treasure);
    if (!rule.counter) return;
    const c = rule.counter;
    const unit = (data.nikkes[s.rid].rate * (1 + (s.cfg?.gaugePct || 0) / 100) + aura) * c.units;
    const every = atLevel(c.every, s.cfg?.skills);
    const chance = atLevel(c.chance, s.cfg?.skills) / 100;
    let count = 0;
    for (let f = 0; f <= horizon; f++) {
      if (chance) {
        if (!taken[i][f]) continue;
        const g = taken[i][f] * chance * unit;
        gainByFrame[f] += g;
        slotByFrame[i][f] += g;
      } else if (every) {
        count += taken[i][f];
        /* 링크로 묶인 아군이 맞은 타격도 함께 센다. */
        for (const p of s.cfg?.linkSlots || []) if (p !== i) count += taken[p]?.[f] || 0;
        while (count >= every) {
          count -= every;
          gainByFrame[f] += unit;
          slotByFrame[i][f] += unit;
        }
      }
    }
  });

  /* 아군이 소비한 탄 합계로 충전하는 효과 - 편성 전체의 탄을 세어 시전자 칸에 더한다. */
  const bulletsByFrame = new Int32Array(horizon + 1);
  perSlot.forEach(events => { for (const e of events) bulletsByFrame[e.f] += e.bullets || 0; });
  team.forEach((s, i) => {
    if (!s?.rid) return;
    const rule = ruleOf(data, s.rid, s.cfg?.treasure);
    if (!rule.ammoBurst) return;
    const every = atLevel(rule.ammoBurst.n, s.cfg?.skills);
    const pct = atLevel(rule.ammoBurst.gain, s.cfg?.skills);
    if (!every || !pct) return;
    let spent = 0;
    for (let f = 0; f <= horizon; f++) {
      spent += bulletsByFrame[f];
      while (spent >= every) {
        spent -= every;
        gainByFrame[f] += pct;
        slotByFrame[i][f] += pct;
      }
    }
  });

  const gauge = new Float64Array(horizon + 1);
  let sum = 0;
  let full = null;
  for (let f = 0; f <= horizon; f++) {
    sum = Math.round((sum + gainByFrame[f]) * 1000) / 1000;
    if (sum >= 100 && full == null) full = f;
    gauge[f] = Math.min(100, sum);
  }

  const chain = burstChain(data, team);
  const bursts = [];
  if (chain && full != null) {
    chain.forEach((s, i) => bursts.push({
      f: full + FIRST_BURST_DELAY + i * NEXT_BURST_DELAY,
      rid: s.rid,
      pos: s.pos,
      stage: i + 1,
    }));
  }
  /* 슬롯별 누적 충전 - 표에서 고른 시점의 기여도로 쓴다. */
  const cumulative = slotByFrame.map(row => {
    const c = new Float64Array(horizon + 1);
    let s = 0;
    for (let f = 0; f <= horizon; f++) { s += row[f]; c[f] = s; }
    return c;
  });

  return {
    gauge,
    full,
    chain,
    bursts,
    fullBurst: bursts.length ? bursts.at(-1).f : null,
    cumulative,
  };
}

/* 한 명의 시점별 충전량 - 자동 편성 점수와 표 대조에 쓴다. */
export function soloGainAt(data, rid, cfg, frame, pos = 0, side = 'attack') {
  const events = nikkeEvents(data, rid, cfg, pos, side, frame);
  const r = ruleOf(data, rid, cfg.treasure);
  const aura = r.aura ? data.nikkes[rid].rate * atLevel(r.aura, cfg.skills) / 100 : 0;
  return events.reduce((sum, e) => sum + e.gain + aura * e.units, 0);
}

/* 탄충 큐브의 사격 수 조건 (원문 '10발 사격 시') */
const BASTION_EVERY = 10;

/* 시뮬레이터가 쓰는 큐브 효과. 수치는 data.cubes[tid].values (data/cubes.json, 큐브 레벨 1~15).
   명중(엔진은 모든 탄이 명중)·파츠(아레나에 파츠 없음) 큐브는 전투 효과가 없고 스탯만 전투력 계산에 들어간다. */
const CUBE_EFFECT = { 1000302: 'chargeDmg', 1000303: 'reload', 1000304: 'bastion', 1000305: 'charge', 1000306: 'ammo', 1000307: 'gauge',
  1000308: 'hpPct', 1000309: 'defPct', 1000310: 'healGiven', 1000311: 'reduce', 1000312: 'lowHp', 1000314: 'pierce', 1000315: 'ignore',
  1000316: 'coverHp', 1000317: 'split', 1000318: 'maxOnly' };

/* 무기군 소장품 효과 { chargeMul, def, reduce, coverHp, ... } (%). data.collection 은 data/weapons.json 의 collection.
   애장품은 SR 15 와 같다. kind: 'R' | 'SR' | '애장품' | 'none', level: 0~15 */
export function collectionEffects(data, weapon, kind, level) {
  const rare = kind === '애장품' ? 'SR' : kind;
  const row = data.collection?.[rare]?.[weapon];
  if (!row) return {};
  const lv = kind === '애장품' ? 15 : Math.max(0, Math.min(15, parseInt(level, 10) || 0));
  const phase = row.phase[lv] || 1;
  const out = {};
  for (const [k, v] of Object.entries(row)) if (k !== 'phase') out[k] = v[phase - 1] || 0;
  return out;
}

/* 내 니케 스펙 → 시뮬레이터 입력. 아레나 탭이므로 아레나 큐브를 본다. */
export function configFromRoster(data, entry, weapon) {
  const opts = { charge: [], ammo: new Map() };
  for (const g of entry.gear || []) {
    for (const o of g.options || []) {
      if (o.name === '차속') opts.charge.push(data.options.charge[o.level - 1]);
      if (o.name === '장탄') opts.ammo.set(o.level, (opts.ammo.get(o.level) || 0) + data.options.ammo[o.level - 1]);
    }
  }
  const cfg = {
    chargeValues: opts.charge,
    ammoParts: [...opts.ammo.values()],
    gaugePct: 0,
    reloadPct: 0,
    skills: entry.skills,
    treasure: entry.collection?.kind === '애장품',
    /* 애장품 단계 0~2 - 스킬 교체(arena-battle.js withFavorite)에 쓴다 */
    treasureLevel: entry.collection?.kind === '애장품' ? Math.max(0, Math.min(2, parseInt(entry.collection.level, 10) || 0)) : null,
    cubeTid: entry.arena_cube?.tid || null,
    cubeLevel: entry.arena_cube?.level || 0,
  };
  const effect = CUBE_EFFECT[cfg.cubeTid];
  const values = cfg.cubeTid && data.cubes?.[String(cfg.cubeTid)]?.values;
  if (effect && values && cfg.cubeLevel) {
    const value = values[cfg.cubeLevel - 1] || 0;
    if (effect === 'gauge') cfg.gaugePct = value;
    if (effect === 'charge') cfg.chargeValues = [...cfg.chargeValues, value];
    if (effect === 'ammo') cfg.ammoParts.push(value);
    if (effect === 'reload') cfg.reloadPct = value;
    if (effect === 'reduce') cfg.cubeReduce = value;
    if (effect === 'coverHp') cfg.coverCasterPct = value;
    if (effect === 'chargeDmg') cfg.cubeChargeDmg = value;
    if (effect === 'bastion') cfg.bastion = Math.round(value);
    if (effect === 'hpPct') cfg.cubeHpPct = value;
    if (effect === 'defPct') cfg.cubeDefPct = value;
    if (effect === 'healGiven') cfg.cubeHealGiven = value;
    if (effect === 'pierce') cfg.cubePierce = value;
    if (effect === 'ignore') cfg.cubeIgnore = value;
    if (effect === 'lowHp') cfg.cubeLowHp = value;
    if (effect === 'split') cfg.cubeSplit = value;
    if (effect === 'maxOnly') cfg.cubeMaxOnly = value;
  }
  cfg.doll = weapon ? collectionEffects(data, weapon, entry.collection?.kind, entry.collection?.level) : {};
  if (cfg.doll.ammo) cfg.ammoParts.push(cfg.doll.ammo);
  return cfg;
}

/* 스펙을 모르는 니케(상대 기본값). */
export const blankConfig = () => ({ chargeValues: [], ammoPct: 0, gaugePct: 0, reloadPct: 0, treasure: false, doll: {} });
