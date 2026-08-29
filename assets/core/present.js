/* 화면이 읽는 모양으로 (§12 결과 계약 -> 뷰 모델).

   코어는 §12 계약대로 낸다 — 열 지향 로그, 프레임 번호, 영어 필드. 화면은 사이클 해부·게이지 %·버프 인스펙터를 읽는다.
   그 둘을 여기서 잇는다. 코어에 넣으면 계산이 UI 표현에 의존하고, 화면에서 풀면 같은 계산이 여러 군데로 흩어진다. */

import { LEDGER, OPEN, PROVISIONAL } from './ledger.js';
import { HitFlag } from './result.js';
import { STAT_NAMES } from './codes.js';
import { STAT_MAP } from './adapt.js';

/* 화면은 효과표 어휘(`damageUp`), 코어는 명세 어휘(`atkDmgPct`) 로 말하므로 되돌린다.
   짝이 없으면 코어 이름을 그대로 낸다 — 모르는 이름이 뜨는 편이 조용히 사라지는 것보다 낫다. */
const BACK = new Map();
for (const [oldName, coreName] of Object.entries(STAT_MAP)) {
  if (coreName && !BACK.has(coreName)) BACK.set(coreName, oldName);
}
/* 시전자 기준 공격력은 걸 때 재서 박은 고정 수치다. `atkFromCaster` 로 되돌리면 화면이 퍼센트로 읽어 76,214 를 "+7,621,463%" 로 찍는다. */
BACK.set('atkFlat', 'atkFlat');

const uiStat = statCode => {
  const coreName = STAT_NAMES[statCode];
  return BACK.get(coreName) || coreName || '?';
};

/* 코어는 퍼센트 포인트, 화면은 비율로 읽는다 (게임 문구 "34%" -> 0.34). */
const SECONDS_OR_COUNT = new Set(['burstCooldownSec', 'chargeTimeFixSec',
  'ammoChargeCount', 'shotConditionCount', 'explosionRangePx', 'atkFlat']);

const uiValue = (statCode, value) =>
  SECONDS_OR_COUNT.has(STAT_NAMES[statCode]) ? value : value / 100;

/* 풀 버스트 구간을 이벤트 로그에서 되짚는다. */
function fullBurstWindows(result) {
  const fps = result.frameRate;
  const windows = [];
  let open = null;
  for (const e of result.logs.events) {
    if (e.type === 'fullBurstStart') open = e.frame / fps;
    else if (e.type === 'fullBurstEnd' && open != null) {
      windows.push({ from: open, to: e.frame / fps });
      open = null;
    }
  }
  /* 전투가 풀 버스트 중에 끝났으면 끝을 `null` 로 둔다 — 화면이 온전히 끝난 구간만 평균 내야 사이클 해부가 안 어긋난다. */
  if (open != null) windows.push({ from: open, to: null });
  return windows;
}

/* `options` 는 실제로 쓰인 값이다. 잠정값 줄이 기본값이 아니라 이번 판에 들어간 숫자를 적어야 나중에 되짚을 수 있다. */
export function present(result, squad = [], options = {}) {
  const fps = result.frameRate;
  /* 표본이 있으면 마지막 표본의 최대 장탄을 쓴다 — 전투 중 늘어난 값이 찍혀야 "왜 재장전이 적나" 가 읽힌다. */
  const lastSnap = result.logs.snapshots[result.logs.snapshots.length - 1];
  const maxAmmoOf = id => {
    const row = lastSnap && lastSnap.characters.find(c => c.characterId === id);
    return row ? row.maxAmmo : null;
  };
  const seconds = result.effectiveDurationSec;
  const nameOf = id => (squad.find(a => a.id === id) || {}).name || id;

  const events = result.logs.events;
  const windows = fullBurstWindows(result);
  const closed = windows.filter(w => w.to != null);
  const uptime = closed.reduce((s, w) => s + (w.to - w.from), 0)
    + windows.filter(w => w.to == null).reduce((s, w) => s + (seconds - w.from), 0);

  /* 만충되고도 못 누른 시간. 누르기까지는 어차피 반응 지연이 드니 그만큼 빼고 본다. */
  const waits = [];
  {
    let fullAt = null;
    for (const e of events) {
      if (e.type === 'gaugeFull') fullAt = e.frame / fps;
      else if (e.type === 'chainStart' && fullAt != null) {
        waits.push(e.frame / fps - fullAt); fullAt = null;
      }
    }
  }
  const avgWait = waits.length ? waits.reduce((a, b) => a + b, 0) / waits.length : null;

  /* 화면의 로테이션 표가 읽는 모양 — `chainStart` 로 열고 `burst` 로 채운다. */
  const log = [];
  let chainIndex = -1;
  for (const e of events) {
    switch (e.type) {
      case 'chainStart':
        chainIndex++;
        log.push({ t: e.sec, kind: 'chainStart', index: chainIndex });
        break;
      case 'burstUse':
        log.push({ t: e.sec, kind: 'burst', index: chainIndex,
                   actor: e.characterId, step: 'Step' + e.stage });
        break;
      case 'chainVoid':
        log.push({ t: e.sec, kind: 'chainVoid', index: chainIndex });
        break;
      case 'reentry':
        log.push({ t: e.sec, kind: 'reentry', index: chainIndex,
                   actor: e.characterId, to: 'Step' + e.toStage });
        break;
      case 'fullBurstStart': log.push({ t: e.sec, kind: 'fbStart' }); break;
      case 'fullBurstEnd': log.push({ t: e.sec, kind: 'fbEnd' }); break;
      case 'stateOn':
        log.push({ t: e.sec, kind: 'state', actor: e.characterId, state: e.state, on: true });
        break;
      case 'stateOff':
        log.push({ t: e.sec, kind: 'state', actor: e.characterId, state: e.state,
                   on: false, buffsDropped: e.buffsDropped });
        break;
      default: break;
    }
  }
  const voided = events.filter(e => e.type === 'chainVoid').map(e => e.sec);

  /* 표본을 화면 모양으로. 버프 인스펙터가 이 위에서 돈다 — 시전자 기준 공격력이 164초에 63배가 된 것을 찾아낸 화면이다. */
  const snapshots = result.logs.snapshots.map(s => ({
    t: s.sec,
    gauge: s.gauge,
    gaugePct: s.gaugePct,
    fullBurst: s.inFullBurst,
    enemy: { buffs: [] },
    actors: s.characters.map(c => ({
      id: c.characterId,
      name: nameOf(c.characterId),
      atkBase: (squad.find(a => a.id === c.characterId) || {}).stats?.atk ?? c.attack,
      atk: c.attack,
      /* 스탯 이름과 실효 수치를 제 이름으로. 화면이 스탯별로 묶어 합계를 내고 겹친 줄을 규칙 자리와 함께 편다. */
      buffs: c.buffs.map(b => ({
        stat: uiStat(b.statCode),
        value: uiValue(b.statCode, b.value),
        source: b.source,
        note: b.note,
        series: null,
        until: b.endFrame === Infinity ? null : b.endFrame / fps,
      })).filter(b => b.stat !== '?'),
      states: c.states || [],
      stacks: c.stacks || {},
      ammo: c.ammo, ammoMax: c.maxAmmo,
      heat: c.heat, stunned: !!c.stunned,
      weapon: (squad.find(a => a.id === c.characterId) || {}).doc?.weapon?.weaponCode || '',
      damage: c.damage,
    })),
  }));

  /* 타임라인 차트가 읽는 시계열. 표본이 없으면 차트도 없다.
     `dps` 는 구간 DPS 다 (직전 표본과의 차이 ÷ 간격) — 누적 평균을 쓰면 초반에 치솟았다 평평해져 어느 구간이 센지가 안 보인다. */
  const series = [];
  {
    let prevSec = 0, prevCum = 0;
    for (const s of result.logs.snapshots) {
      const cum = s.characters.reduce((x, c) => x + c.damage, 0);
      const dt = s.sec - prevSec;
      series.push({
        t: s.sec,
        cum,
        dps: dt > 0 ? (cum - prevCum) / dt : 0,
        gauge: s.gaugePct / 100,
        fullBurst: s.inFullBurst,
        heat: s.characters.map(c => (c.heat == null ? 0 : c.heat)),
      });
      prevSec = s.sec; prevCum = cum;
    }
  }

  return {
    seconds,
    series,
    /* 요청한 시간과 실제 적용된 시간을 **둘 다** 남긴다 (§5). */
    requestedSeconds: result.requestedDurationSec,
    fps,
    frames: result.framesProcessed,
    total: result.totalDamage,
    dps: result.squadDps,
    byActor: result.characters.map(c => ({
      id: c.characterId,
      name: c.displayName,
      damage: c.damage,
      share: result.totalDamage ? c.damage / result.totalDamage : 0,
      /* 원문이 그 타격을 뭐라고 부르는가로 가른다 (메커니즘 8) — 평타 · 버스트 스킬 본체 · "추가 대미지" · 그 밖의 스킬. */
      byKind: { ...c.damageByKind },
      bySource: c.damageBySource,
      shots: c.shotCount, reloads: c.reloadCount,
      ammo: maxAmmoOf(c.characterId),
      hits: c.hitCount, crits: c.critHitCount,
      critRate: c.hitCount ? c.critHitCount / c.hitCount : 0,
      cores: c.coreHitCount,
    })),
    snapshots,
    log,
    warnings: result.warnings,
    fullBurst: {
      windows,
      count: windows.length,
      uptime,
      share: seconds ? uptime / seconds : 0,
      /* 풀 버스트 시작 사이의 평균 — 이게 사이클 길이다. */
      avgCycle: windows.length > 1
        ? (windows[windows.length - 1].from - windows[0].from) / (windows.length - 1)
        : null,
      avgWait,
      /* 무엇이 사이클을 붙잡는가 — 쿨타임이면 게이지를 더 채워도 안 빨라진다.
         만충되고도 못 누른 시간에서 반응 지연을 뺀다. 남으면 Ⅰ 을 낼 니케가 쿨타임이라 기다린 시간이다. */
      bound: avgWait == null ? null
        : (avgWait - (options.burstPressDelaySec ?? 0.52) > 0.05 ? 'cooldown' : 'gauge'),
    },
    chains: {
      started: result.burst.cycleCount,
      completed: result.burst.cycleCount - voided.length,
      voided,
    },
    gauge: {
      max: result.burst.gaugeMax,
      at: result.burst.finalGauge,
      /* 누가 사이클을 돌렸나. 대미지 비중과 다른 질문이고 서포터를 고를 때는 이쪽이 답이다. 평타분과 스킬분도 갈라 둔다.
         집계값은 게이지에 실제 반영된 양이다 — 잠금 구간에서 버려진 몫은 `wastedHits` 로 따로 센다. */
      by: result.characters.map(c => ({
        id: c.characterId,
        bullet: c.gaugeChargedByNormal,
        skill: c.gaugeChargedBySkill,
        charged: c.gaugeChargedTotal,
      })).filter(r => r.charged > 0).sort((a, b) => b.charged - a.charged),
    },
    /* 잠긴 동안 버려진 명중 수. 게이지가 안 차는 이유를 따질 때 먼저 본다. 버려진 게이지 양은 단위가 달라 따로 싣는다. */
    wastedHits: result.burst.wastedHits,
    wastedGauge: Math.round(result.burst.wastedGauge),
    seed: result.rngSeed,
    rngMode: result.rngMode,
    targetCount: result.burst.targetCount,
    mechanisms: LEDGER.map(m => m.name),
    open: OPEN,
    provisional: PROVISIONAL.map(p => ({
      ...p,
      valueInUse: (p.keys || [p.name])
        .map(k => (options[k] == null ? p.value : options[k]))
        .filter(v => v != null).join(' · ') || null,
    })),
  };
}

export { HitFlag };
