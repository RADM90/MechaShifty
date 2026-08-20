/* 전원 훑기 — `node mekami/test/sweep.js [초]`.

   니케 199명을 한 명씩 스쿼드에 세워 돌린다. 보는 것은 둘이다:
     ① 터지거나 매달리는 니케가 없는가
     ② 어느 니케가 유독 오래 걸리는가 — 이벤트가 무한히 늘어나는 규칙의 신호다

   효과표 199장이 자동 초안이라, 한 장이 잘못 나가면 그 니케만 조용히 이상해진다.
   전원을 한 번 돌려 보는 것이 그걸 잡는 가장 싼 방법이다. */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildTables, compute } from '../../assets/cp.js';
import { compile } from '../assets/effects.js';
import { simulate } from '../assets/engine.js';
import { defaultInput, staticBuffs } from '../assets/defaults.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const read = p => JSON.parse(readFileSync(join(ROOT, p), 'utf-8'));

const SECONDS = Number(process.argv[2] || 60);
/* 한 명이 이만큼 넘게 걸리면 뭔가 잘못된 것이다. 정상은 수십 ms 다. */
const SLOW_MS = 300;

const NEED = ['syncro_stat', 'attraction_stat', 'attraction_grade', 'equip_stat',
  'equip_option', 'cube_stat', 'collection_stat', 'collection_bonus', 'cp_penalty'];
const T = buildTables(Object.fromEntries(NEED.map(k => [k, read(`data/raw/${k}.json`)])));
const cubes = read('mekami/data/cubes_effect.json');
const collection = read('mekami/data/collection.json');
const index = read('mekami/data/index.json').nikkes;

const pad = rid => String(rid).padStart(3, '0');
const cache = new Map();

function build(rid) {
  if (cache.has(rid)) return cache.get(rid);
  const combat = read(`mekami/data/combat/c${pad(rid)}.json`);
  const m = index.find(x => x.rid === rid);
  const input = defaultInput({ rarity: m.rarity, class: m.class, corporation: m.corporation },
                             { weapon: combat.shot.weapon });
  const cp = compute(T, input, 400);
  /* 표에 없는 조합이면 스탯이 안 나온다. 옆 등급으로 대신하면 그 니케만 조용히
     틀린 숫자를 내므로 못 세운다고 본다. 지금은 전원이 표에 있어 0명이어야 한다. */
  if (!cp) { cache.set(rid, null); return null; }
  const { buffs, ammo } = staticBuffs({ T, input, weapon: combat.shot.weapon, cubes, collection });
  const actor = {
    id: `c${rid}`, combat,
    effects: compile(read(`mekami/data/effects/c${pad(rid)}.json`), combat),
    stats: cp.stats, staticBuffs: buffs, staticAmmo: ammo, isElement: true,
  };
  cache.set(rid, actor);
  return actor;
}

const CORE = [17, 330, 16, 515];
const base = CORE.map(build);
const rotation = [{ step1: 'c17', step2: 'c330', step3: 'c16' }];

let ran = 0, skipped = 0;
const failed = [], slow = [], warned = new Map();
const t0 = Date.now();

for (const m of index) {
  if (CORE.includes(m.rid)) continue;
  const actor = build(m.rid);
  if (!actor) { skipped++; continue; }
  const started = Date.now();
  try {
    const r = simulate({
      squad: [...base, actor], rotation,
      enemy: { def: 0, coreHitRate: 0.5 },
      battle: { seconds: SECONDS, sample: SECONDS },
    });
    ran++;
    if (!Number.isFinite(r.total) || r.total < 0) {
      failed.push(`${m.name.ko}: 누적이 이상함 (${r.total})`);
    }
    for (const w of new Set(r.warnings)) {
      const key = w.replace(/^[^:]+:\s*/, '').slice(0, 54);
      warned.set(key, (warned.get(key) || 0) + 1);
    }
  } catch (err) {
    failed.push(`${m.name.ko}: ${err.message}`);
  }
  const ms = Date.now() - started;
  if (ms > SLOW_MS) slow.push([m.name.ko, ms]);
}

const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`전원 훑기 (${SECONDS}초 전투) — ${ran}명 성공 · ${failed.length}명 실패 · `
  + `${skipped}명 스탯 없음 · 총 ${secs}초`);
for (const f of failed.slice(0, 10)) console.log(`  ! ${f}`);

slow.sort((a, b) => b[1] - a[1]);
console.log(slow.length
  ? `  느린 니케 (${SLOW_MS}ms 초과): ` + slow.slice(0, 8).map(([n, ms]) => `${n} ${ms}ms`).join(' · ')
  : `  전부 ${SLOW_MS}ms 미만 — 매달리는 규칙 없음`);

if (warned.size) {
  console.log('  경고:');
  for (const [w, c] of [...warned].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
    console.log(`    ${c}명  ${w}`);
  }
}
process.exit(failed.length ? 1 : 0);
