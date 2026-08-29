/* 굳혀 둔 니케 한 줄(`data/nikkes_skill.json` 의 한 레코드)을 코어의 캐릭터 계약으로.

   런타임에 남은 일은 레벨 고르기 하나다. 어휘 번역·조건 컴파일·값 채우기는 `tools/mekami_merge.mjs` 가 오프라인에서 끝냈다.

   예전에는 브라우저가 원본과 해석표를 받아 두 번 번역했고, 두 번째 번역에서 규칙 자리(`c016 s1[2]`)가 합성 ID 에 묻혔다.
   버프 인스펙터가 "어느 스킬이 이 수치를 만들었나" 를 못 읽게 된 원인이다. 굳힌 파일은 `statCode`·`value`·`source` 를 제 이름으로 든다.
   `adapt.js` 는 남겨 둔다 — 굳히는 쪽이 그 표를 쓰고, 수기 입력 니케도 같은 길로 들어와야 한다. */

import { SimInputError } from './codes.js';
import { ELEMENT_MAP } from './adapt.js';

/* 레벨을 타는 자리만 `{ byLevel: [...10] }` 다. 전부 배열로 만들지 않은 이유는 어느 값이 레벨을 타는지가 파일에서 보여야 해서다. */
function atLevel(node, level) {
  if (node === null || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(v => atLevel(v, level));
  if (Array.isArray(node.byLevel)) {
    const row = node.byLevel;
    return row[Math.min(Math.max(level, 1), row.length) - 1];
  }
  const out = {};
  for (const key of Object.keys(node)) out[key] = atLevel(node[key], level);
  return out;
}

const SLOTS = new Set(['s1', 's2', 'burst']);

/* `doc`      `data/nikkes_skill.json` 의 한 레코드
   `roster`   `data/nikkes.json` 의 같은 `rid` 레코드 — **이게 있어야 니케가 선다**
   `levels`   `{ s1, s2, burst }` — 계정에서 온다
   `favorite` 애장품을 켰나
   나머지는 앱이 계산해 주는 것 (스탯·세팅 버프).

   두 파일을 `rid` 로 잇는 자리다. 스킬 파일은 명단이 말하는 것(이름·클래스·기업·속성·무기군·버스트 단계)을 안 들어 혼자서는 니케를 못 만든다. */
export function characterFrom(doc, {
  roster, levels = {}, favorite = false, baseAttack, displayName,
  staticStats = {}, staticAmmoPct = [],
} = {}) {
  if (!doc || !doc.variants) {
    throw new SimInputError('니케 데이터가 아닙니다', { rid: doc && doc.rid });
  }
  if (!roster) {
    throw new SimInputError('명단(nikkes.json) 레코드가 없습니다 — rid 로 이어야 합니다',
      { rid: doc.rid });
  }
  /* 애장품이 효과를 안 바꾸면 그 벌에 `effects` 가 없다 — 없는 것이 곧 "기본과 같다" 는 뜻이라 기본 벌에서 가져온다. */
  const fav = favorite ? doc.variants.favorite : null;
  const variant = fav
    ? { effects: fav.effects || doc.variants.base.effects, skills: fav.skills }
    : doc.variants.base;
  const levelOf = slot => {
    const l = SLOTS.has(slot) ? levels[slot] : 10;
    return Number.isFinite(l) ? l : 10;
  };

  const effects = variant.effects.map(e => {
    const resolved = atLevel(e, levelOf(e.slot));
    return {
      ...resolved,
      /* 화면이 출처를 푸는 고리. `c016 s1[2]` 여야 니케·스킬 이름으로 풀린다 — 합성 ID 로 덮으면 인스펙터가 못 읽는다. */
      source: e.source,
      slot: e.slot,
      note: e.note,
    };
  });

  const burstLevel = levelOf('burst');
  const burst = roster.burst || roster.burstStage;
  const weaponCode = roster.weapon_type || roster.weapon;
  if (!weaponCode) {
    throw new SimInputError('명단에 무기군이 없습니다', { rid: doc.rid });
  }
  return {
    /* 명단과 같은 PK 를 그대로 캐릭터 id 로 쓴다 — 결과 로그를 명단에 이어 붙일 때 변환할 자리가 없어야 한다. */
    id: doc.rid,
    displayName: displayName || (roster.name && roster.name.ko) || doc.rid,

    /* ── 명단에서 ──────────────────────────────────────── */
    elementCode: ELEMENT_MAP[roster.element] || null,
    burstStage: burst === 'AllStep' ? 'AllStep' : String(burst).replace('Step', ''),
    className: roster.class ?? null,
    company: roster.corporation ?? null,

    /* ── 스킬 파일에서 ──────────────────────────────────── */
    reentryStage: doc.reentryStage ?? null,
    burstDurationSec: doc.burstDurationSec,
    burstCooldownSec: atLevel(doc.burstCooldownSec, burstLevel),
    burstGaugeReadyDelaySec: 2,
    critRatePct: doc.critRatePct,
    /* 무기군은 명단이, 제원 수치는 스킬 파일이 든다. 여기서 한 덩어리로 만든다. */
    weapon: { ...doc.weapon, weaponCode },

    baseAttack,
    staticStats,
    staticAmmoPct,
    effects,
  };
}

/* 스쿼드 통째로. 옮기다 걸린 것은 버리지 않고 모아 올린다 — 화면이 "이 니케의 스킬 N개가 안 들어갔다" 를 말할 수 있어야 한다. */
export function squadFrom(entries) {
  const characters = [];
  const problems = [];
  for (const entry of entries) {
    try { characters.push(characterFrom(entry.doc, entry)); }
    catch (e) { problems.push(`${entry.displayName || entry.doc?.rid}: ${e.message}`); }
  }
  return { characters, problems };
}
