/* 메카미 탭의 표시 문구. `assets/app.js` 와 같은 얼개지만 표는 따로 둔다.

   app.js 의 `t()` 는 export 돼 있어도 못 쓴다 — 그 모듈이 최상위에서 `wire()`·`load()` 를 돌려 import 하는 순간 앱이 한 벌 더 뜬다.
   기계장치는 열댓 줄이고 문자열은 계산 쪽 어휘라 겹치지 않는다.
   언어는 `renderMekami(root, { lang })` 로 받는다 — 단추는 app.js 것이고, 눌리면 탭을 다시 그리면서 지금 언어를 넘긴다. */

const LANGS = ['ko', 'en', 'ja'];

const STR = {
  'app.brand': ['메카미', 'Mekami', 'メカミ'],
  'app.brandSub': ['· Mekami', '· Mekami', '· Mekami'],
  'ui.loading': ['데이터를 불러오는 중…', 'Loading…', '読み込み中…'],
  'ui.theme': ['테마 전환', 'Toggle theme', 'テーマ切替'],
  'ui.langGroup': ['표시 언어', 'Display language', '表示言語'],
  'ui.close': ['닫기', 'Close', '閉じる'],
  'ui.failed': ['데이터를 불러오지 못했습니다', 'Could not load data', 'データを読み込めませんでした'],

  'mk.metaHead': ['메카미', 'Mekami', 'メカミ'],
  /* 몇 명을 싣고 그중 몇 명이 계산되는가. 해석표가 없는 니케는 고르기 화면에서 잠기고, 그 차이가 그대로 남은 할 일이다. */
  'mk.metaCount': [
    (all, ok) => `니케 ${all}명 수록 · 효과표 ${ok}명`,
    (all, ok) => `${all} nikkes · ${ok} with an effect table`,
    (all, ok) => `ニケ${all}人収録・効果表${ok}人`,
  ],
  'mk.metaBasis': [
    fps => `실측 기준 MG 예열 / 버스트 게이지 / 프레임 상한 ${fps}fps`,
    fps => `Measured MG spin-up / burst gauge / ${fps}fps frame cap`,
    fps => `実測基準のMG予熱・バーストゲージ・フレーム上限${fps}fps`,
  ],
  'mk.squad': ['스쿼드', 'Squad', 'スクワッド'],
  'mk.cond': ['전투 조건', 'Battle setup', '戦闘条件'],
  'mk.timeline': ['타임라인', 'Timeline', 'タイムライン'],
  'mk.timelineHint': [
    '막대 = 순간 DPS · 선 = 누적 대미지 · 음영 = 풀버스트 · 위쪽 띠 = 버스트 게이지와 MG 예열',
    'Bars = DPS · line = cumulative · shaded = full burst · top band = burst gauge and MG spin-up',
    '棒＝瞬間DPS · 線＝累積 · 影＝フルバースト · 上帯＝バーストゲージとMG予熱',
  ],
  'mk.byNikke': ['니케별 기여', 'By nikke', 'ニケ別の貢献'],
  'mk.rotation': ['버스트 순서', 'Burst order', 'バースト順'],
  'mk.notes': ['스킬 원문 · 미반영', 'Skill text · not modelled', 'スキル原文・未反映'],
  'mk.empty': ['+ 니케', '+ Nikke', '+ ニケ'],
  'mk.pick': ['니케 고르기', 'Pick a nikke', 'ニケを選ぶ'],
  'mk.remove': ['빼기', 'Remove', '外す'],

  'mk.seconds': ['전투 시간', 'Duration', '戦闘時間'],
  'mk.level': ['니케 레벨', 'Nikke level', 'ニケレベル'],
  /* "버스트 입력 지연" 이라 부르지 않는다 — 게임이 늦게 받는 게 아니라 사람이 보고 누르는 시간이다.
     사이클에 한 번만 든다 (메커니즘 16) — Ⅱ·Ⅲ 은 컷신이 끝나는 프레임에 이미 눌려 있다. */
  'mk.reaction': ['버스트 반응 시간(초)', 'Burst reaction (s)', 'バースト反応時間(秒)'],
  'mk.enemyDef': ['적 방어력', 'Enemy DEF', '敵防御力'],
  /* 코어 명중률(%)이 아니라 닿느냐 마느냐다. 켜면 평타를 전부 코어 명중으로 보므로 상한값이다. */
  'mk.coreHittable': ['코어 명중 가능', 'Core reachable', 'コア命中可能'],
  /* 적의 생김새가 조건인 버프 둘. 켜면 그 부위를 계속 때린 것으로 보므로 상한값이다. */
  'mk.hasParts': ['적에게 파츠가 있음', 'Enemy has parts', '敵にパーツがある'],
  'mk.hasBlock': ['적에게 저지 부위가 있음', 'Enemy has a block part', '敵に阻止部位がある'],
  'mk.range': ['교전 거리', 'Engagement range', '交戦距離'],
  'mk.near': ['근거리', 'Close', '近距離'],
  'mk.mid': ['중거리', 'Mid', '中距離'],
  'mk.far': ['원거리', 'Far', '遠距離'],
  'mk.noRange': ['적정거리 밖', 'Out of range', '適正距離外'],
  'mk.extraDmg': ['추가 대미지', 'Extra damage', '追加ダメージ'],
  'mk.chainVoid': ['무효', 'voided', '無効'],
  /* 왼쪽 칸 우선이라 앞쪽 쿨타임이 짧으면 뒤쪽은 영영 못 쓴다 — 칸 순서를 바꾸라는 신호라 결론까지 적는다. */
  'mk.neverBurst': [
    who => `${who} 는 한 번도 버스트를 못 썼습니다 — 자동 전투는 왼쪽 칸을 먼저 쓰므로, 칸 순서를 바꾸면 결과가 달라집니다.`,
    who => `${who} never used a burst — auto battle takes the leftmost slot first, so reordering the squad changes the result.`,
    who => `${who} は一度もバーストを使えませんでした — オートは左の枠から使うため、並び替えると結果が変わります。`,
  ],
  'mk.voidCount': [
    n => `무효 체인 ${n}회`,
    n => `${n} chains voided`,
    n => `無効チェーン ${n}回`,
  ],
  'mk.wasted': [
    n => `잠긴 동안 버려진 명중 ${n.toLocaleString()}발`,
    n => `${n.toLocaleString()} hits wasted while locked`,
    n => `ロック中に捨てられた命中 ${n.toLocaleString()}発`,
  ],
  'mk.provisional': [
    n => `이 결과는 잠정값 ${n}개에 기대고 있습니다`,
    n => `This result rests on ${n} provisional values`,
    n => `この結果は暫定値 ${n}件に依っています`,
  ],
  'mk.element': ['우월코드', 'Elemental advantage', '有利コード'],
  /* 게이지에만 걸리는 값이라 이름에 그 사실을 넣는다. */
  /* 게이지에만 걸리는 값이라 이름에 그 사실을 넣는다 — "표적 수" 만 적으면 대미지도 곱해지는 줄 안다. */
  'mk.targets': [
    '한 발이 닿는 표적 수 (게이지만)',
    'Targets hit per shot (gauge only)',
    '一発が当たる標的数 (ゲージのみ)',
  ],
  'mk.targetsHint': [
    '산탄 10 · 런처 2~9 · 관통 1~3 · 그 밖 1 이 표준이고, 파츠가 여럿인 보스는 더 큽니다.',
    'Standard: shotgun 10, launcher 2–9, piercing 1–3, others 1. Multi-part bosses run higher.',
    '標準は散弾10・ランチャー2~9・貫通1~3・その他1。パーツが多いボスはさらに大きくなります。',
  ],
  'mk.fps': ['프레임', 'Frame rate', 'フレーム'],
  'mk.control': ['조작', 'Control', '操作'],
  'mk.auto': ['자동', 'Auto', 'オート'],
  'mk.manual': ['수동', 'Manual', '手動'],

  'mk.total': ['누적 대미지', 'Total damage', '累積ダメージ'],
  'mk.dps': ['초당', 'per sec', '毎秒'],
  'mk.share': ['비중', 'Share', '割合'],
  'mk.shots': ['발사', 'Shots', '発射'],
  'mk.ammo': ['장탄', 'Ammo', '装弾'],
  'mk.reloads': ['재장전', 'Reloads', 'リロード'],
  'mk.fbEff': ['버스트 사이클 효율', 'Burst cycle uptime', 'バーストサイクル効率'],
  'mk.fbCount': [
    n => `풀버스트 ${n}회`,
    n => `${n} full bursts`,
    n => `フルバースト ${n}回`,
  ],
  'mk.avgCycle': ['평균 사이클', 'Avg cycle', '平均サイクル'],
  /* 사이클을 셋으로 가른다 — 충전이 길면 게이지 서포터, 대기가 길면 Ⅰ 니케의 쿨타임, 풀버스트는 Ⅲ 니케가 정한다.
     가운데 칸은 만충되고도 못 누른 시간이다. Ⅰ 을 낼 니케가 쿨타임이라 기다린 시간도 들어가므로 "반응" 이라고만 부르면 오해를 부른다. */
  'mk.anatomy': [
    (fill, wait, fb) => `충전 ${fill} + 대기 ${wait} + 풀버스트 ${fb}`,
    (fill, wait, fb) => `fill ${fill} + wait ${wait} + full burst ${fb}`,
    (fill, wait, fb) => `充電 ${fill} + 待機 ${wait} + フルバースト ${fb}`,
  ],
  /* 모형의 시간에는 버스트 컷신이 없다 (메커니즘 16). 실제 화면과 맞대려면 얼마를 더해야 하는지 적어 준다. */
  'mk.wallClock': [
    (s, n) => `실제 화면으로는 여기에 버스트 컷신이 사이클마다 약 4.5초씩 붙어 `
      + `${s}초쯤이 됩니다 (${n}사이클). 컷신 동안은 전투가 흐르지 않아 모형에서 뺐습니다.`,
    (s, n) => `On screen this runs about ${s}s — burst cut-ins add ~4.5s per cycle `
      + `(${n} cycles). Combat does not advance during them, so the model excludes them.`,
    (s, n) => `実際の画面ではバーストカットインがサイクルごとに約4.5秒加わり、約${s}秒に `
      + `なります (${n}サイクル)。カットイン中は戦闘が進まないため模型では除いています。`,
  ],
  'mk.avgFill': ['게이지 만충까지', 'Gauge fill', 'ゲージ満タンまで'],
  'mk.gauge': ['버스트 게이지', 'Burst gauge', 'バーストゲージ'],
  /* 대미지 기여도와 별개 지표다. 게이지 충전이 병목일 때는 이쪽이 편성 판단 기준이 된다. */
  'mk.chargeBy': [
    '버스트 게이지 충전 기여도 — 누계 · 사이클당 (평타 / 스킬)',
    'Burst gauge contribution — total · per cycle (normal / skill)',
    'バーストゲージ充電の寄与度 — 累計 · サイクル毎 (通常 / スキル)',
  ],
  'mk.perCycle': ['사이클당', 'per cycle', 'サイクル毎'],
  /* 사이클당 합이 100% 근처가 아니면 어딘가 새고 있다는 뜻이라 합계를 적어 둔다. */
  'mk.chargeTotal': [
    (total, n, avg) => `합계 ${total}% · 게이지 ${n}회 충전 · 사이클당 ${avg}%`,
    (total, n, avg) => `total ${total}% · gauge filled ${n}× · ${avg}% per cycle`,
    (total, n, avg) => `合計 ${total}% · ゲージ ${n}回充電 · サイクル毎 ${avg}%`,
  ],
  /* 사이클 길이를 정하는 제약이 무엇인지. 게이지 서포터의 채용 가치를 그대로 답하는 줄이라 결론까지 적는다. */
  'mk.boundGauge': [
    '사이클의 병목은 게이지 충전입니다 — 버스트 게이지 충전 속도 증가가 사이클을 단축합니다.',
    'Gauge charging is the bottleneck — burst gauge charge speed shortens the cycle.',
    'サイクルのボトルネックはゲージ充電です — バーストゲージ充電速度の増加がサイクルを短縮します。',
  ],
  'mk.boundCooldown': [
    '사이클의 병목은 버스트 재사용 대기시간입니다 — 게이지 충전 속도를 올려도 사이클이 단축되지 않습니다.',
    'Burst cooldown is the bottleneck — raising gauge charge speed will not shorten the cycle.',
    'サイクルのボトルネックはバースト再使用時間です — ゲージ充電速度を上げてもサイクルは短縮されません。',
  ],
  'mk.normal': ['평타', 'Normal', '通常攻撃'],
  'mk.skill': ['스킬', 'Skill', 'スキル'],
  'mk.burst': ['버스트', 'Burst', 'バースト'],

  'mk.defaultSetting': ['기준 세팅', 'Assumed setup', '前提セット'],
  'mk.noAccount': [
    '계정 자료가 없어 기준 세팅으로 계산합니다.',
    'No account data — using the assumed setup.',
    'アカウント情報がないため前提セットで計算します。',
  ],
  'mk.confidence': ['신뢰도', 'Confidence', '信頼度'],
  'mk.srcDefault': ['기준 세팅', 'Assumed setup', '前提セット'],
  'mk.srcMissing': ['계정에 없음', 'Not in account', 'アカウントに無し'],
  'mk.account': ['내 계정', 'My account', 'マイアカウント'],
  'mk.accountOn': [
    n => `내 계정 ${n}명 · 이 값으로 계산합니다`,
    n => `Account loaded (${n} nikkes) — using your own stats`,
    n => `アカウント ${n}人 · この値で計算します`,
  ],
  'mk.unmodeled': ['계산에 안 들어간 효과', 'Not included in the maths', '計算に入っていない効果'],
  'mk.noRules': [
    '이 니케는 스킬 효과가 하나도 반영되지 않았습니다 — 평타만 계산됩니다.',
    'None of this nikke’s skill effects are modelled — only normal attacks are counted.',
    'このニケはスキル効果が一つも反映されていません — 通常攻撃のみ計算します。',
  ],
  'mk.stale': [
    '원문이 바뀌었습니다 — 해석을 다시 봐야 합니다',
    'Skill text changed — the interpretation needs review',
    '原文が変わりました — 解釈の見直しが必要です',
  ],
  'mk.needSteps': [
    '1·2·3 버스트가 하나씩 있어야 풀버스트가 돕니다.',
    'Full burst needs one each of Burst I, II and III.',
    'フルバーストにはⅠ・Ⅱ・Ⅲが一人ずつ必要です。',
  ],
  'mk.noStats': [
    n => `${n} — 스탯 표에 이 등급·클래스 조합이 없어 계산할 수 없습니다. 스쿼드에서 빠집니다.`,
    n => `${n} — the stat table has no row for this rarity/class, so it cannot be computed. Left out.`,
    n => `${n} — ステータス表にこの等級・クラスの行が無く計算できません。除外します。`,
  ],
  'mk.inspect': ['버프 추적', 'Buff inspector', 'バフ追跡'],
  'mk.inspectHint': [
    '그 순간 누구에게 무엇이 걸려 있는지. 결과가 이상하면 여기부터 봅니다 — 합친 값 옆에 그 값을 만든 줄이 출처와 함께 나옵니다.',
    'What is on whom, at that instant. Start here when a number looks wrong — each total is listed with the individual lines and their sources.',
    'その瞬間に誰へ何がかかっているか。数値がおかしいときはここから — 合計の横に、それを作った各行と出典が並びます。',
  ],
  'mk.at': ['시점', 'At', '時点'],
  'mk.atkSwell': ['공격력', 'ATK', '攻撃力'],
  'mk.noBuffs': ['걸린 버프 없음', 'No buffs', 'バフ無し'],
  'mk.statesLine': ['상태', 'States', '状態'],
  'mk.stacksLine': ['중첩', 'Stacks', 'スタック'],
  'mk.enemyBuffs': [
    '적에게 걸린 것 — 스쿼드가 함께 받습니다',
    'On the enemy — the whole squad benefits',
    '敵にかかっているもの — スクワッド全体が受けます',
  ],
  'mk.forever': ['지속', 'permanent', '持続'],
  'mk.lines': [n => `${n}줄`, n => `${n} lines`, n => `${n}行`],
  'mk.stunned': ['기절', 'Stunned', 'スタン'],
  'mk.infinite': ['무한탄창', 'No reload', 'リロード無し'],
  'mk.heat': ['예열', 'Spin-up', '予熱'],
};

/* 버킷 이름을 사람 말로. `atkFromCaster` 같은 키를 그대로 띄우면 원문과 대조를 못 한다. 한국어는 인게임 표기를 쓴다. */
const STAT = {
  atkPct: ['공격력', 'ATK', '攻撃力'],
  atkFlat: ['시전자 기준 공격력', 'ATK from caster', '使用者基準攻撃力'],
  damageUp: ['공격 대미지', 'Damage dealt', '攻撃ダメージ'],
  receivedUp: ['받는 대미지', 'Damage taken', '被ダメージ'],
  elemDmg: ['우월 코드 대미지', 'Elemental damage', '有利コードダメージ'],
  critRate: ['크리티컬 확률', 'Crit rate', 'クリティカル確率'],
  critDmg: ['크리티컬 대미지', 'Crit damage', 'クリティカルダメージ'],
  coreDmg: ['코어 대미지', 'Core damage', 'コアダメージ'],
  defPct: ['방어력', 'DEF', '防御力'],
  chargeSpeed: ['차지 속도', 'Charge speed', 'チャージ速度'],
  chargeDmg: ['차지 대미지', 'Charge damage', 'チャージダメージ'],
  chargeTimeFix: ['차지 시간 고정', 'Charge time (fixed)', 'チャージ時間固定'],
  chargeOverflow: ['차지 초과분 변환', 'Charge overflow', 'チャージ超過変換'],
  reloadSpeed: ['재장전 속도', 'Reload speed', 'リロード速度'],
  maxAmmo: ['최대 장탄 수', 'Max ammo', '最大装弾数'],
  ammoSeries: ['장탄 계열', 'Ammo series', '装弾系列'],
  spinupRate: ['예열 속도', 'Spin-up rate', '予熱速度'],
  burstGaugeSpeed: ['버스트 게이지 충전 속도', 'Burst gauge charge', 'バーストゲージ充電速度'],
  explosionRange: ['폭발 범위', 'Explosion range', '爆発範囲'],
  normalAtkPct: ['일반 공격 대미지', 'Normal attack', '通常攻撃ダメージ'],
  explosionDmg: ['발사체 폭발 대미지', 'Projectile explosion', '発射体爆発ダメージ'],
  stickDmg: ['발사체 부착 대미지', 'Projectile stick', '発射体付着ダメージ'],
  pierceDmg: ['관통 대미지', 'Pierce damage', '貫通ダメージ'],
  partsDmg: ['파츠 대미지', 'Parts damage', 'パーツダメージ'],
  distributedDmg: ['분배 대미지', 'Distributed damage', '分配ダメージ'],
  trueDmg: ['방어력 무시 대미지', 'True damage', '防御力無視ダメージ'],
  burstSkillDmg: ['버스트 스킬 대미지', 'Burst skill damage', 'バーストスキルダメージ'],
  singleBurstDmg: ['단일 대상 버스트 대미지', 'Single-target burst', '単体バーストダメージ'],
  blockDmg: ['저지 부위 공격 대미지', 'Block part damage', '阻止部位ダメージ'],
  dotDmg: ['지속 대미지', 'Damage over time', '持続ダメージ'],
  sequentialDmg: ['순차 공격 대미지', 'Sequential damage', '順次攻撃ダメージ'],
  shieldDmg: ['보호막에 가하는 대미지', 'Damage to shields', '保護膜へのダメージ'],
  normalAsTrue: ['평타를 방어력 무시로', 'Normal as true damage', '通常攻撃を防御無視に'],
  shotCondition: ['발동 횟수 조건', 'Trigger count condition', '発動回数条件'],
};

/* 퍼센트가 아닌 자리. 초·배수로 적힌 것을 %로 내보내면 읽는 사람이 속는다. */
const NOT_PCT = new Set(['chargeTimeFix']);

let lang = 'ko';

export function setLang(next) {
  if (!LANGS.includes(next)) return lang;
  lang = next;
  try { localStorage.setItem('lang', lang); } catch { /* 사파리 사생활 보호 모드 */ }
  document.documentElement.lang = lang;
  return lang;
}

export function initLang() {
  let saved = null;
  try { saved = localStorage.getItem('lang'); } catch { /* 무시 */ }
  return setLang(LANGS.includes(saved) ? saved : 'ko');
}

export const current = () => lang;

export function t(key, ...args) {
  const row = STR[key];
  if (!row) return key;
  const v = row[LANGS.indexOf(lang)] ?? row[0];
  return typeof v === 'function' ? v(...args) : v;
}

/* 큰 수. 누적 대미지가 수십억까지 가므로 자리를 다 적으면 못 읽는다.
   한국어·일본어는 만/억, 영어는 천 단위 축약을 쓴다 — 한글 단위를 영어 화면에 내보내면 크기를 가늠하지 못한다. */
const UNITS = {
  ko: [[1e8, '억'], [1e4, '만']],
  ja: [[1e8, '億'], [1e4, '万']],
  en: [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']],
};

export function num(v) {
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  for (const [unit, label] of UNITS[lang] || UNITS.ko) {
    if (abs >= unit) {
      const n = v / unit;
      return `${n >= 100 ? Math.round(n) : n.toFixed(n >= 10 ? 1 : 2)}${label}`;
    }
  }
  return Math.round(v).toLocaleString(lang);
}

/* 버킷 키 -> 사람 말. 모르는 키는 그대로 낸다 — 숨기면 새 스탯이 생겼을 때 화면에서 통째로 사라진다. */
export function statName(key) {
  const row = STAT[key];
  return row ? (row[LANGS.indexOf(lang)] || row[0]) : key;
}

/* 버프 한 줄의 값. 대부분 퍼센트인데 몇 개는 아니다. */
export function statValue(key, v) {
  if (key === 'atkFlat') return `${v >= 0 ? '+' : '−'}${num(Math.abs(v))}`;
  if (NOT_PCT.has(key)) return `${v.toFixed(2)}s`;
  return `${v >= 0 ? '+' : '−'}${(Math.abs(v) * 100).toFixed(2)}%`;
}

/* taxonomy 의 축 값(기업·속성·클래스…)은 데이터가 세 언어를 들고 있다. */
export function L(taxonomy, axis, code) {
  const row = taxonomy && taxonomy[axis] && taxonomy[axis][code];
  return (row && (row[lang] || row.en)) || code || '';
}

/* data-i18n 이 붙은 자리를 한 번에 갈아 끼운다. */
export function paintStatic(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  for (const el of root.querySelectorAll('[data-i18n-aria]')) {
    el.setAttribute('aria-label', t(el.dataset.i18nAria));
  }
}
