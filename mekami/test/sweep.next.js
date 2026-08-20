/* 2세대 전원 훑기 — `node mekami/test/sweep.next.js`.

   니케 199명을 한 명씩 예제 4인 옆에 세워 돌린다. 보는 것은 둘이다:
     ① 터지거나 매달리는 니케가 없는가
     ② 효과표 199장이 2세대 모형에서도 오류 없이 읽히는가

   효과표를 다시 쓰지 않고 **유도로** 얹었기 때문에 이 훑기가 특히 중요하다 —
   `hit.gauge === false` 를 "추가 대미지" 로, `kind` 를 타격 종류로 읽는 그 유도가
   어느 한 장에서 어긋나면 그 니케만 조용히 이상해진다. */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
import { buildTables, compute } from '../../assets/cp.js';
import { compile } from '../assets/effects.js';
import { simulate } from '../assets/engine.next.js';
import { defaultInput, staticBuffs } from '../assets/defaults.js';
const read = p => JSON.parse(readFileSync(join(ROOT, p), 'utf-8'));
const NEED=['syncro_stat','attraction_stat','attraction_grade','equip_stat','equip_option','cube_stat','collection_stat','collection_bonus','cp_penalty'];
const T=buildTables(Object.fromEntries(NEED.map(k=>[k,read(`data/raw/${k}.json`)])));
const cubes=read('mekami/data/cubes_effect.json'), collection=read('mekami/data/collection.json');
const index=read('mekami/data/index.json').nikkes;
const pad=r=>String(r).padStart(3,'0');
const cache=new Map();
function build(rid){
  if(cache.has(rid))return cache.get(rid);
  const c=read(`mekami/data/combat/c${pad(rid)}.json`), m=index.find(x=>x.rid===rid);
  const input=defaultInput({rarity:m.rarity,class:m.class,corporation:m.corporation},{weapon:c.shot.weapon});
  const cp=compute(T,input,400); if(!cp){cache.set(rid,null);return null;}
  const {buffs,ammo}=staticBuffs({T,input,weapon:c.shot.weapon,cubes,collection});
  const cd=(c.skills.burst&&c.skills.burst.cooldown)||[20];
  const a={id:`c${rid}`,name:c.name.ko,combat:c,burst:c.burst,burstDuration:c.burstDuration,
    burstCooldown:cd[cd.length-1],burstEnergy:c.shot.burstEnergy.perTargetShot,
    critRate:(c.crit&&c.crit.rate!=null?c.crit.rate/100:0.15),
    effects:compile(read(`mekami/data/effects/c${pad(rid)}.json`),c),
    stats:cp.stats,staticBuffs:buffs,staticAmmo:ammo,isElement:true};
  cache.set(rid,a); return a;
}
const CORE=[17,330,16,515];
const base=CORE.map(build);
let ran=0; const failed=[], slow=[], warned=new Map();
const t0=Date.now();
for(const m of index){
  if(CORE.includes(m.rid))continue;
  const a=build(m.rid); if(!a){continue;}
  const st=Date.now();
  try{
    const r=simulate({squad:[...base,a],enemy:{def:0,코어명중가능:true},
      battle:{seconds:60,gaugeMax:7500,sample:0}});
    ran++;
    if(!Number.isFinite(r.total)||r.total<0) failed.push(`${m.name.ko}: 누적이 이상함 (${r.total})`);
    for(const w of new Set(r.warnings)){const k=w.replace(/^[^:]+:\s*/,'').slice(0,54); warned.set(k,(warned.get(k)||0)+1);}
  }catch(e){failed.push(`${m.name.ko}: ${e.message}`);}
  const ms=Date.now()-st; if(ms>300) slow.push([m.name.ko,ms]);
}
console.log(`2세대 전원 훑기 (60초) — ${ran}명 성공 · ${failed.length}명 실패 · 총 ${((Date.now()-t0)/1000).toFixed(1)}초`);
for(const f of failed.slice(0,10)) console.log('  ! '+f);
console.log(slow.length?`  느린 니케: ${slow.slice(0,5).map(([n,ms])=>n+' '+ms+'ms').join(' · ')}`:'  전부 300ms 미만 — 매달리는 규칙 없음');
if(warned.size){console.log('  경고:'); for(const [w,c] of [...warned].sort((a,b)=>b[1]-a[1]).slice(0,5)) console.log(`    ${c}명  ${w}`);}
