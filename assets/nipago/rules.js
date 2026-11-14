/* 니파고 - 게임 규칙과 버전 (DOM 없음). 근거는 NIPAGO_REROLL.md.
   옵션 가중치·단계별 수치·단계 확률은 data/raw/equip_option·equip_glossary 에서 읽고, 데이터에 없는 공식 수치만 여기 둔다. */

/* 규칙 계층별 버전 (명세 25.1) - 계산 결과와 기록에 붙는다. */
export const RULES_VERSION = {
  action: '2026-09-17',     // 잠금·실행·결과 선택 시점 (공식 9/17 공지)
  cost: '2026-09-17',       // 잠금 수별 비용 - 영구·락키 혼합은 미확정
  draw: '2026-09-17',       // 줄 등장·종류 가중치·중복 배제·동일 결과 재추첨
  effective: '2026-11-06',  // 차속·장탄 동일 단계 묶음 반올림 (공개 계산 모델)
  nikke: '2026-11-06',      // 니케별 차속 분류
};
export const rulesTag = () => `rules ${RULES_VERSION.draw} · eff ${RULES_VERSION.effective}`;

/* 효과 변경 때 1·2·3번 줄이 생길 확률 */
export const SLOT_P = [1, 0.5, 0.3];
/* 새 잠금 비용 - [보호 중인 줄 없음, 1줄 있음] */
export const LOCK_MOD = [2, 3];
export const LOCK_KEY = [20, 30];
/* 최초 개조로 붙는 옵션의 단계 */
export const FIRST_LV = 11;
export const MAX_LV = 15;
/* 한 번에 보호할 수 있는 줄 수 - 셋 다 잠그면 바꿀 줄이 없다 */
export const MAX_PROTECT = 2;

export const PIECES = ['머리', '몸', '팔', '다리'];

/* 옛 약어 → 지금 이름 (roster.js 와 같은 표) */
export const OPTION_ALIAS = { 크피: '크댐', 차뎀: '차댐' };
export const fixOpt = id => OPTION_ALIAS[id] || id;

/* 실효값을 따로 계산하는 옵션 */
export const EFF_OPTS = { 차속: 'charge', 장탄: 'ammo' };

/* 1회 실행 비용. protect: [{ mat: 'perm' | 'key', fresh: bool }], fresh 는 이번에 새로 거는 잠금이다.
   잠금 비용은 보호 줄 수에 따라 첫 줄 / 둘째 줄로 갈리고, 이미 지불한 영구 잠금은 다시 세지 않는다.
   새 영구와 락키를 함께 걸면 어느 쪽이 첫 줄 값인지 공지에 없어 싼 쪽으로 계산하고 estimated 를 켠다. */
export function tryCost(protect, lambda = 0.1) {
  const held = protect.filter(p => !p.fresh).length;
  const fresh = protect.filter(p => p.fresh);
  let mod = 1 + protect.length, key = 0;
  const kinds = new Set(fresh.map(p => p.mat));
  const order = kinds.size > 1
    ? (lambda < 0.1 ? ['perm', 'key'] : ['key', 'perm'])
    : [...kinds];
  let n = held;
  for (const mat of order) {
    for (const p of fresh) {
      if (p.mat !== mat) continue;
      const step = Math.min(n, 1);
      if (mat === 'perm') mod += LOCK_MOD[step]; else key += LOCK_KEY[step];
      n++;
    }
  }
  return { mod, key, estimated: kinds.size > 1 || (held > 0 && fresh.some(p => p.mat === 'key')) };
}

/* ── 데이터 ──────────────────────────────────────────────── */
/* equip_option 은 레벨이 행, 옵션이 열이다.
   수치는 정수 basis point(1/100 %)로도 들고 있어 반올림 경계가 이진 소수 오차로 흔들리지 않는다. */
export function buildData(option, glossary) {
  const gi = Object.fromEntries(glossary.columns.map((c, i) => [c.key, i]));
  const byAbbr = Object.fromEntries(glossary.rows.map(r => [r[gi.abbr], r]));
  const opts = [];
  option.columns.forEach((c, i) => {
    if (!c.key.startsWith('opt')) return;
    const id = c.label.ko;
    const g = byAbbr[id];
    const vals = option.rows.map(r => r[i]);
    opts.push({
      id,
      ko: g ? g[gi.full] : id,
      en: g ? g[gi.en] : id,
      ja: g ? g[gi.ja] : id,
      w: g ? g[gi.rate] : 0,
      vals,
      bp: vals.map(v => Math.round(v * 10000)),
    });
  });
  const rate = option.columns.findIndex(c => c.key === 'rate');
  const lp = option.rows.map(r => r[rate]);
  return { opts, lp, byId: Object.fromEntries(opts.map(o => [o.id, o])) };
}

/* ── 니케별 차속 분류 (명세 6.6~6.7, 확인일 2026-11-06) ─────
   전체 니케 목록이 아니라 판단을 먼저 확인할 대표 사례다. 표에 없으면 '미확인'.
   cls: core 핵심 화력 · threshold 임계치 · conditional 조건부 · support 유지 가능한 보조 · none 비적용 */
export const CHARGE_RULES = {
  c018: { cls: 'core', src: 'S11' },          // 네온 : 비전 아이
  c191: { cls: 'threshold', src: 'S12' },     // 앨리스
  c225: { cls: 'threshold', src: 'S13' },     // 홍련 : 흑영
  c262: { cls: 'conditional', src: 'S14' },   // 리버렐리오 - 보스 모드만
  c404: { cls: 'core', src: 'S15·S16' },      // 길티 : 마이티 바니 - 평상시
  c405: { cls: 'conditional', src: 'S17' },   // 신 : 스위프트 바니 - 버스트 0.5초 고정
  c352: { cls: 'conditional', src: 'S18' },   // 헬름 (애장품) - 수급·PvP
  c470: { cls: 'core', src: 'S19' },          // 레드 후드 - 100% 초과분은 차댐 전환
  c391: { cls: 'support', src: 'S20' },       // 아인
  c520: { cls: 'support', src: 'S21' },       // 브래디
  c412: { cls: 'conditional', src: 'S22' },   // 트리나 - PvP 수급
  c471: { cls: 'none', src: 'S23' },          // 스노우 화이트 : 헤비 암즈 - 1.2·3.2초 고정
  c515: { cls: 'none', src: 'S24' },          // 신데렐라 : 크리스탈 웨이브 - 1초 고정 SR 모드
};
