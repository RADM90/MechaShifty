/* 니파고 — 차속·장탄 실효값 (명세 5.4~5.9, 23.7).
   화면 표시·목표 판정·결과 비교·경로 계산이 모두 이 함수 하나를 부른다.

   같은 옵션·같은 단계끼리 먼저 더하고, 단계 묶음마다 반올림한 뒤 더한다.
   계산은 정수(basis point = 1/100 %)로만 해서 .5 경계가 이진 소수 오차로 바뀌지 않는다.

     차속 %     Σ R[n·p]            정수 % — 기준 1초 시간 모델과 같다
     차속 시간  Σ R2[C·n·p]         0.01초 단위, C = 기준 차지 시간
     장탄       Σ R[A·n·p]          발 단위, A = 기본 장탄수

   OL 기여만 비교하는 모델이다. 스킬·큐브·외부 버프는 합치지 않는다. */

import { MAX_LV } from './rules.js';

/* 단계 → 개수 (오름차순) */
export function groupTiers(levels) {
  const m = new Map();
  for (const lv of levels) m.set(lv, (m.get(lv) || 0) + 1);
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([lv, n]) => ({ lv, n }));
}

/* 양수 정수 나눗셈의 일반 반올림 — floor(x/d + 0.5) */
const roundDiv = (x, d) => Math.floor((2 * x + d) / (2 * d));

/* cfg: { kind: 'charge' | 'ammo', model: 'pct' | 'time', C: 초, A: 발 }
   value 단위 — 차속 %: 정수 %, 차속 시간: 0.01초, 장탄: 발 */
export function effValue(cfg, levels, bpByLv) {
  const groups = groupTiers(levels).map(({ lv, n }) => {
    const raw = n * bpByLv[lv - 1];                      // bp
    let r;
    if (cfg.kind === 'ammo') r = roundDiv(cfg.A * raw, 10000);
    else if (cfg.model === 'time') r = roundDiv(Math.round(cfg.C * 1000) * raw, 100000);
    else r = roundDiv(raw, 100);
    return { lv, n, raw, r };
  });
  const shown = groups.reduce((a, g) => a + g.raw, 0);   // 표시 합계 (bp)
  return { value: groups.reduce((a, g) => a + g.r, 0), groups, shown };
}

export const effUnit = cfg => cfg.kind === 'ammo' ? 'shots' : cfg.model === 'time' ? 'cs' : 'pct';

/* 화면용 — 값 하나. shot 은 장탄 단위 (언어별 '발' — 이 모듈은 문자열표를 모른다) */
export function fmtEff(cfg, v, shot = '') {
  if (v == null) return '—';
  if (cfg.kind === 'ammo') return `+${v}${shot}`;
  if (cfg.model === 'time') return (v / 100).toFixed(2) + 's';
  return v + '%';
}

/* 계산 과정 — "12×2 → 9발" 처럼 묶음별로 */
export function explainEff(cfg, res, shot = '') {
  return res.groups.map(g => `${g.lv}${g.n > 1 ? '×' + g.n : ''}→${fmtEff(cfg, g.r, shot).replace('+', '')}`).join(' + ');
}

/* 줄 수 k 와 최소 단계 m 으로 목표를 바꾼다 (경로 계산용).
   k 줄이 m 이상이면 단계를 어떻게 섞어도 목표를 넘는 m 의 최솟값.
   묶음 반올림 때문에 단계가 오르면 실효값이 떨어질 수 있어(5.8) 전부 검사한다. */
export function effProfiles(cfg, min, bpByLv, maxLines = 4) {
  const out = [];
  for (let k = 1; k <= maxLines; k++) {
    let found = 0;
    for (let m = 1; m <= MAX_LV && !found; m++) {
      if (allMultisets(k, m).every(ls => effValue(cfg, ls, bpByLv).value >= min)) found = m;
    }
    if (found) out.push({ k, m: found });
  }
  return out;
}

function allMultisets(k, lo) {
  const out = [];
  const rec = (start, acc) => {
    if (acc.length === k) { out.push(acc.slice()); return; }
    for (let lv = start; lv <= MAX_LV; lv++) { acc.push(lv); rec(lv, acc); acc.pop(); }
  };
  rec(lo, []);
  return out;
}
