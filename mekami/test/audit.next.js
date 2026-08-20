/* 효과표 199장을 2세대 기준으로 훑는다 — `node mekami/test/audit.next.js`.

   효과표는 1세대를 위해 쓰였고, 2세대가 새로 요구하는 것 몇 가지가 있다 (메커니즘
   8·9·10). 대부분은 기존 데이터에서 **유도되지만**(`hit.gauge === false` -> "추가",
   `hit.kind === 'burst'` -> 버스트 스킬 본체) 유도가 안 서는 자리가 남는다.

   이 파일은 **테스트가 아니라 감사**다. 무엇이 틀렸다고 단정하지 않고, 사람이 봐야 할
   자리를 종류별로 모아 낸다. 199장을 눈으로 다시 읽을 수는 없고, 그렇다고 "유도로
   얹었다" 고만 적어 두면 어디를 안 봤는지가 영영 안 남는다.

   깨뜨리는 것이 하나 있다 — **원문 해시가 바뀐 표**. 그건 해석이 낡았다는 뜻이라
   감사 결과가 아니라 실패로 끝난다. */

import { compile } from '../assets/effects.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = p => JSON.parse(readFileSync(join(ROOT, p), 'utf-8'));
const pad = rid => String(rid).padStart(3, '0');
const head = t => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 56 - t.length))}`);

const index = read('mekami/data/index.json').nikkes;

/* 종류별로 모은다. `왜` 는 사람이 보러 갈 때 무엇을 확인해야 하는지다. */
const 자리 = {
  코어누락: { 왜: '원문이 "코어 명중" 이라 적었는데 타격에 `코어명중` 이 없다. '
              + '메커니즘 8 대로면 스킬 타격이어도 코어 보너스를 받아야 한다.', 목록: [] },
  /* **과대가 아니라 과소다.** 공식은 타격이 그 타입을 선언했을 때만 더한다
     (`bridge.next.js` 의 `타입.has(t)`). 그런데 선언하는 자리가 `hit.type` 뿐이라,
     평타에는 영영 안 붙는다 — 폭발이 본업인 RL 도, 파츠를 때리는 어떤 평타도. */
  죽은버프: { 왜: '이 버프가 걸릴 타격이 이 니케에게 하나도 없다. 공식은 타격이 그 '
              + '타입을 선언해야 더하는데, 선언하는 자리가 `hit.type` 뿐이라 **평타에는 '
              + '영영 안 붙는다.** 버프를 적어 두고도 안 쓰는 셈이다 — 과소 계산.', 목록: [] },
  본체가늦다: { 왜: '`kind: "burst"` 인 타격이 `burstUse` 가 아닌 트리거에 달렸다. '
              + '메커니즘 10 대로면 본체는 풀버스트가 열리기 **전에** 때려야 한다.', 목록: [] },
  추가가이르다: { 왜: '"추가 대미지"(`gauge: false`) 가 `burstUse` 에 달렸다. 엔진이 '
              + '풀버스트까지 미뤄 주지만(리더 유예), 원래 트리거를 고치는 편이 낫다.', 목록: [] },
  /* 원문이 빈 줄로 갈린 스킬은 **서로 배타적인 갈래**다 — 레드 후드 계열이 어느 단계
     자리로 쓰였는지, 라피 : 레드 후드가 전투 보조인지에 따라 버스트가 통째로 바뀐다.
     조건을 안 걸면 모든 갈래가 한꺼번에 적용되어 조용히 과대 계산이 된다. */
  갈래에조건없음: { 왜: '원문이 빈 줄로 여러 갈래로 나뉘는데 규칙에 `if` 조건이 하나도 '
              + '없다. 배타적인 갈래가 동시에 적용되고 있을 수 있다.', 목록: [] },
  모르는조건: { 왜: '`compile` 이 모르는 조건 이름을 발견했다. `meets()` 는 모르는 키를 '
              + '참으로 넘기므로 **조건이 통째로 사라져 규칙이 언제나 걸린다.**', 목록: [] },
  /* 원문이 `[이름]` 만 쓰고 내용이 다음 줄에 오는 꼴 — `[부착형 유탄]`·`[슈팅 스타]`
     처럼 이름 붙은 장치다. 분기 표시(`[시작 횟수 별 효과]` 등)와는 다르다. */
  이름만있는장치: { 왜: '원문에 `[이름]` 만 있고 내용이 다음 줄에 오는 장치인데 상태로 '
              + '안 잡혔다. 조건이나 삭제로 이 이름을 참조하는 효과가 있으면 어긋난다.', 목록: [] },
  규칙없음: { 왜: '규칙이 한 줄도 없다. 이 니케는 평타만 계산된다.', 목록: [] },
  미반영많음: { 왜: '안 넣은 효과가 많은데 신뢰도가 높게 적혀 있다. 둘 중 하나가 틀렸다.', 목록: [] },
};

const 해시깨짐 = [];
const 살아 = new Map(), 죽어 = new Map();
let 규칙수 = 0, 타격수 = 0;

for (const n of index) {
  const rid = pad(n.rid);
  let eff, combat;
  try { eff = read(`mekami/data/effects/c${rid}.json`); } catch { continue; }
  combat = read(`mekami/data/combat/c${rid}.json`);
  const 이름 = combat.name.ko;

  /* 원문이 바뀌었으면 해석이 낡았다. 이건 감사가 아니라 실패다. */
  if (eff.textHash && combat.textHash && eff.textHash !== combat.textHash) {
    해시깨짐.push(`${이름} (${rid})`);
  }

  /* `[이름]` 만 있고 아래 줄에 `키 : 값` 이 이어지는 장치. 분기 표시는 뺀다. */
  const 분기표시 = /횟수\s*별\s*효과|해당되는\s*효과만|하위\s*효과\s*중복|스쿼드\s*구성\s*별|면역/;
  for (const k of ['s1', 's2', 'burst']) {
    const 줄 = (((combat.skills[k] || {}).text || {}).ko || '').split('\n');
    const 세운상태 = new Set((eff[k] || []).map(r => (r.set || {}).state).filter(Boolean));
    줄.forEach((line, i) => {
      for (const m of line.matchAll(/\[([^\[\]:]{2,14})\]/g)) {
        const nm = m[1].trim();
        if (분기표시.test(nm) || /[0-9%▲▼]|지속|유지|중첩|해제|삭제/.test(nm)) continue;
        const 뒤 = 줄.slice(i + 1, i + 5);
        if (!뒤.some(l => /^\s*[^\[\]]{2,20}\s*:\s*\S/.test(l))) continue;
        if (세운상태.has(nm)) continue;
        자리.이름만있는장치.목록.push(`${이름} (${rid}) ${k} — [${nm}]`);
      }
    });
  }

  /* 원문이 빈 줄로 갈리는데 조건이 없는 절을 짚는다. */
  for (const k of ['s1', 's2', 'burst']) {
    const 원문 = ((combat.skills[k] || {}).text || {}).ko || '';
    const 덩어리 = 원문.split(/\n\s*\n/).filter(b => b.includes('■'));
    const rs = eff[k] || [];
    if (덩어리.length >= 2 && rs.length && !rs.some(r => r.if)) {
      자리.갈래에조건없음.목록.push(`${이름} (${rid}) ${k} — 갈래 ${덩어리.length}개 · 규칙 ${rs.length}건`);
    }
  }

  const 절 = ['s1', 's2', 'burst'];
  const 규칙 = 절.flatMap(k => (eff[k] || []).map(r => ({ ...r, 절: k })));
  규칙수 += 규칙.length;
  if (!규칙.length) 자리.규칙없음.목록.push(`${이름} (${rid})`);

  /* 원문에 "코어 명중" 이 있으면 그 절의 타격 중 하나는 코어를 달아야 한다. */
  for (const k of 절) {
    const 원문 = ((combat.skills[k] || {}).text || {}).ko || '';
    /* "코어 명중 **대미지**" 만 본다. "코어 명중 **시**" 는 버프의 방아쇠지 타격이
       아니다 — 리버렐리오가 그 경우라 예전 검사가 헛짚었다. */
    if (!/코어\s*명중\s*대미지/.test(원문)) continue;
    const hits = (eff[k] || []).filter(r => r.hit);
    if (hits.length && !hits.some(r => r.hit['코어명중'] === true)) {
      자리.코어누락.목록.push(`${이름} (${rid}) ${k}`);
    }
  }

  for (const r of 규칙) {
    if (r.hit) {
      타격수 += 1;
      const 추가 = r.hit.gauge === false;
      if (r.hit.kind === 'burst' && r.on !== 'burstUse') {
        자리.본체가늦다.목록.push(`${이름} (${rid}) ${r.절} on=${r.on}`);
      }
      if (추가 && r.on === 'burstUse') {
        자리.추가가이르다.목록.push(`${이름} (${rid}) ${r.절}`);
      }
    }
    /* 버프형 "~ 대미지 증가" 는 조건부다 (메커니즘 9). 조건을 거는 자리가 `hit.type`
       인데, 그 니케가 그 종류의 타격을 아예 안 내면 조건이 영영 안 선다. */
    for (const a of r.apply || []) {
      if (!조건부(a.stat)) continue;
      /* 이 니케가 내는 타격들이 선언한 타입을 모은다. 그중에 이 버프의 종류가
         있어야 언젠가 걸린다.
         **평타도 같이 봐야 한다** — `bridge.next.js` 의 `평타성격` 이 무기 제원에서
         타입을 유도한다. RL 은 폭발 범위가 있어 평타가 발사체 폭발로 잡히고,
         `normalAsTrue` 버프가 걸리면 평타가 방어력 무시가 된다. 이걸 빼고 세면
         멀쩡히 걸리는 버프를 죽었다고 잘못 짚는다. */
      const 타입 = new Set(규칙.flatMap(x => x.hit ? [].concat(x.hit.type || []) : []));
      타입.add('normalAtkPct');
      /* 파츠·저지 부위는 **적의 생김새**가 조건이라 전투 조건으로 켠다 — 타격이
         선언할 것이 아니다. 죽은 것이 아니므로 여기서 뺀다. */
      타입.add('partsDmg'); 타입.add('blockDmg');
      if (((combat.shot || {}).explosionRange || 0) > 0) 타입.add('explosionDmg');
      if (규칙.some(x => (x.apply || []).some(y => y.stat === 'normalAsTrue'))) 타입.add('trueDmg');
      if (타입.has(a.stat)) { 살아.set(a.stat, (살아.get(a.stat) || 0) + 1); continue; }
      죽어.set(a.stat, (죽어.get(a.stat) || 0) + 1);
      자리.죽은버프.목록.push(`${이름} (${rid}) ${r.절} ${a.stat}`);
    }
  }

  /* 컴파일해서 조건 이름 오타 같은 것을 걷어 낸다. */
  try {
    for (const pr of compile(eff, combat).problems || []) {
      if (/모르는 조건/.test(pr)) 자리.모르는조건.목록.push(`${이름} (${rid}) ${pr}`);
    }
  } catch { /* 컴파일이 통째로 실패하는 것은 다른 검사가 잡는다 */ }

  const 미반영 = (eff.unmodeled || []).length;
  if (미반영 >= 4 && eff.confidence === '확정') {
    자리.미반영많음.목록.push(`${이름} (${rid}) 미반영 ${미반영}건`);
  }
}

/* 조건부로 도는 "~ 대미지 증가" 목록. `bridge.next.js` 의 배치표와 같은 것을 봐야
   하는데, 거기 것은 코드라 여기서 이름만 다시 적는다. 어긋나면 감사가 헛돈다. */
function 조건부(stat) {
  return ['pierceDmg', 'dotDmg', 'trueDmg', 'partsDmg', 'blockDmg', 'explosionDmg',
          'stickDmg', 'burstSkillDmg', 'singleBurstDmg'].includes(stat);
}

console.log(`효과표 ${index.length}장 · 규칙 ${규칙수}건 · 그중 타격 ${타격수}건`);

let 총건 = 0;
for (const [이름, v] of Object.entries(자리)) {
  총건 += v.목록.length;
  head(`${이름} — ${v.목록.length}건`);
  console.log(`  ${v.왜}`);
  if (!v.목록.length) { console.log('  해당 없음'); continue; }
  const 보임 = v.목록.slice(0, 12);
  for (const x of 보임) console.log(`    · ${x}`);
  if (v.목록.length > 보임.length) console.log(`    … 그 밖에 ${v.목록.length - 보임.length}건`);
}

/* 이름을 줄줄이 늘어놓는 것보다 **종류별 숫자**가 무엇을 고칠지 정해 준다.
   `partsDmg`·`blockDmg` 는 적의 생김새가 조건이라 전투 조건으로 빼야 하고,
   `pierceDmg`·`explosionDmg` 는 그 니케의 평타가 원래 그 종류라 선언할 자리가 필요하다.
   고치는 방향이 서로 다르므로 갈라서 센다. */
head('죽은 버프 — 종류별');
console.log(`  ${'스탯'.padEnd(18)}${'걸림'.padStart(6)}${'죽음'.padStart(6)}`);
const 종류 = [...new Set([...살아.keys(), ...죽어.keys()])]
  .sort((a, b) => ((죽어.get(b) || 0) + (살아.get(b) || 0)) - ((죽어.get(a) || 0) + (살아.get(a) || 0)));
for (const k of 종류) {
  console.log(`  ${k.padEnd(18)}${String(살아.get(k) || 0).padStart(6)}${String(죽어.get(k) || 0).padStart(6)}`);
}
const 산 = [...살아.values()].reduce((a, b) => a + b, 0);
const 죽 = [...죽어.values()].reduce((a, b) => a + b, 0);
console.log(`  ${'합계'.padEnd(18)}${String(산).padStart(6)}${String(죽).padStart(6)}`
  + `   -> ${죽}/${산 + 죽} 이 한 번도 안 걸린다`);

head('원문이 바뀐 표 — 해석을 다시 봐야 한다');
if (해시깨짐.length) {
  for (const x of 해시깨짐) console.log(`    · ${x}`);
} else {
  console.log('  없음');
}

console.log(`\n${'═'.repeat(60)}`);
console.log(`  봐야 할 자리 ${총건}건 · 원문이 바뀐 표 ${해시깨짐.length}장`);
/* 감사는 건수가 많다고 실패하지 않는다. **해석이 낡은 것만** 실패다. */
process.exit(해시깨짐.length ? 1 : 0);
