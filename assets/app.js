import { renderStats } from './charts.js';

/* ── 데이터 위치 ────────────────────────────────────────────────
   기본은 MechaShifty 레포의 data/ 를 raw 로 읽는다(CORS 허용, 5분 캐시). */
const REMOTE = 'https://raw.githubusercontent.com/RADM90/MechaShifty/main/data/';
const LOCAL = './data/';
const FILES = ['nikkes', 'pickups', 'taxonomy', 'meta'];

/* ── 축 정의 ───────────────────────────────────────────────────
   order 는 표시 순서. */
export const AXES = {
  corporation: { order: ['ELYSION', 'MISSILIS', 'TETRA', 'PILGRIM', 'ABNORMAL'] },
  element: { order: ['Fire', 'Water', 'Wind', 'Electronic', 'Iron'] },
  class: { order: ['Attacker', 'Defender', 'Supporter'] },
  weapon_type: { order: ['AR', 'SMG', 'SG', 'MG', 'SR', 'RL'] },
  burst: { order: ['Step1', 'Step2', 'Step3', 'AllStep'] },
  rarity: { order: ['SSR', 'SR', 'R'] },
};
const PICKUP_AXES = {
  status: { order: ['ongoing', 'upcoming', 'ended'] },
  availability: { order: ['standard', 'limited'] },
  tag: { order: ['collab', 'summer', 'christmas', 'new_year', 'anniversary', 'half_anniversary', 'maid', 'bunny', '_none'] },
};
/* 축 이름은 UI 문구라 t() 로, 축의 값(엘리시온/작열…)은 taxonomy 라 L() 로 간다 */
export const axisLabel = axis => t('ax.' + axis);
/* ── UI 문자열 ─────────────────────────────────────────────────
   [ko, en, ja] 순서. */
const LANGS = ['ko', 'en', 'ja'];
/* 오버로드 슬롯은 일본 커뮤니티에서 번호가 아니라 칸 위치로 부른다 (슬롯1=上段 … 슬롯3=下段). */
const JA_SLOT = n => ['', '上段', '中段', '下段'][n] || `${n}枠目`;
const STR = {
  'app.title': ['메카시프티 · Mecha Shifty', 'Mecha Shifty', 'メカシフティ · Mecha Shifty'],
  'app.brand': ['메카시프티', 'Mecha Shifty', 'メカシフティ'],
  'app.brandSub': ['· Mecha Shifty', '', '· Mecha Shifty'],

  'tab.nikkes': ['니케 리스트', 'Nikkes', 'ニケ一覧'],
  'tab.pickups': ['픽업일정', 'Banners', 'ピックアップ'],
  'tab.stats': ['통계', 'Stats', '統計'],
  'tab.calc': ['전투력 계산기', 'CP calculator', '戦闘力計算機'],
  'tab.outpost': ['전초기지', 'Outpost', '前哨基地'],
  'tab.nipago': ['오버로드 옵션작', 'Overload rolls', 'オバロ厳選'],
  'tab.intercept': ['특특요 확률', 'Intercept drops', '異常個体'],

  /* 전투력 계산기 탭 (calc.js 에서 ctx.t 로 받아 쓴다) */
  'cp.loading': ['스탯 표를 불러오는 중…', 'Loading stat tables…', 'ステータス表を読み込み中…'],
  'cp.grade': ['돌파 / 코강', 'Break / Core', '凸・コア強化'],
  'cp.bond': ['호감도', 'Bond', '好感度'],
  'cp.cube': ['큐브', 'Cube', 'キューブ'],
  // 큐브 종류는 전투력에 안 들어가지만(레벨만 쓴다) 상태 줄에 이름을 내려면 필요하다
  'cp.collection': ['소장품', 'Collection', 'コレクション'],
  'cp.favorite': ['애장품', 'Favorite item', '宝もの'],
  /* 돌파·코강·장비 등급은 데이터 키가 한국어라('3돌'·'오버로드') 그대로 쓰면 EN/JA 화면에 한국어가 남는다. */
  'cp.break': [n => `${n}돌`, n => `Break ${n}`, n => `${n}凸`],
  'cp.core': [n => `${n}코강`, n => `Core ${n}`, n => `コア${n}`],
  'cp.tier_오버로드': ['오버로드', 'Overload', 'オーバーロード'],
  'cp.tier_9티어_기업': ['9티어 기업', 'Tier 9 (mfr.)', 'T9企業'],
  'cp.tier_9티어_일반': ['9티어 일반', 'Tier 9 (plain)', 'T9通常'],
  'cp.none': ['미착용', 'None', '未装着'],
  'cp.consoleOf': [
    n => `${n} 연구 레벨`,
    n => `${n} research level`,
    n => `${n} 研究レベル`,
  ],
  'cp.console_공용': ['공용', 'Shared', '共用'],
  'cp.console_클래스': ['클래스', 'Class', 'クラス'],
  'cp.console_기업': ['기업', 'Manufacturer', '企業'],
  'cp.slot_머리': ['머리', 'Head', '頭'],
  'cp.slot_몸': ['몸', 'Torso', '胴'],
  'cp.slot_팔': ['팔', 'Arm', '腕'],
  'cp.slot_다리': ['다리', 'Leg', '足'],
  'cp.atk': ['공격력', 'ATK', '攻撃力'],
  'cp.def': ['방어력', 'DEF', '防御力'],
  'cp.defOverride': [
    w => `방어력 ${w} 계열 적용`, w => `Uses ${w} DEF table`, w => `防御力は ${w} 系統`,
  ],
  'cp.breakdown': ['계산 분해', 'Breakdown', '計算の内訳'],
  'cp.stats': ['스탯', 'Stats', 'ステータス'],
  'cp.b1': ['(1) HP × 0.7', '(1) HP × 0.7', '(1) HP × 0.7'],
  'cp.b2': ['(2) 공격력 × 19.35', '(2) ATK × 19.35', '(2) 攻撃力 × 19.35'],
  'cp.b3': ['(3) 방어력 × 70', '(3) DEF × 70', '(3) 防御力 × 70'],
  'cp.b4': ['(4) 스킬 + 오버로드 계수', '(4) Skill + overload coef.', '(4) スキル＋OP係数'],
  'cp.b5': ['(5) 큐브 + 소장품 계수', '(5) Cube + collection coef.', '(5) キューブ＋コレクション係数'],
  'cp.b6': ['((1)+(2)+(3)) × ((4)+(5)) / 100', '((1)+(2)+(3)) × ((4)+(5)) / 100', '((1)+(2)+(3)) × ((4)+(5)) / 100'],
  'cp.breakHint': [
    (s, u, n) => `스킬계수 ${s} · 우코(우월코드 대미지) 옵션 레벨합 ${u} · 나머지 옵션 합 ${n}`,
    (s, u, n) => `Skill coef. ${s} · Increase Elemental Damage levels ${u} · other options ${n}`,
    (s, u, n) => `スキル係数 ${s} · 有利コードダメージ ${u} · その他のOP ${n}`,
  ],
  'cp.cpTipHint': [
    '클릭하면 계산식과 HP · 공격력 · 방어력을 봅니다',
    'Click for the formula and HP / ATK / DEF',
    'クリックで計算式と HP・攻撃力・防御力を表示',
  ],
  'cp.close': ['닫기', 'Close', '閉じる'],
  'cp.olTotal': ['오버로드 옵션 종합', 'Overload options — total', 'オーバーロードOP 合計'],
  'cp.olBySlot': ['장비별 오버로드 옵션', 'Overload options by slot', '装備別オーバーロードOP'],
  'cp.olExact': [
    v => `반올림 전 ${v}`,
    v => `${v} before rounding`,
    v => `四捨五入前 ${v}`,
  ],
  // 부위별 표의 빈 칸 — 오버로드인데 그 자리에 옵션이 안 붙은 경우 (인게임 표기)
  'cp.olNoEffect': ['효과 없음', 'No effect', '効果なし'],
  'cp.olNone': [
    '오버로드 장비가 없습니다.',
    'No overload gear equipped.',
    'オーバーロード装備がありません。',
  ],
  // 오버로드 옵션을 니파고(옵션작) 탭으로 넘겨 이어서 굴려 보는 버튼
  'cp.olSim': ['옵션 시뮬레이션', 'Option simulation', '厳選シミュレーション'],
  'cp.olSimHint': [
    '이 니케의 오버로드 옵션을 옵션작 탭으로 가져갑니다.',
    'Take this Nikke’s overload options over to the rolls tab.',
    'このニケのオーバーロードOPを厳選タブに引き継ぎます。',
  ],
  'cp.olSimPick': ['어느 부위로 이어서 할까요?', 'Which slot do you want to continue with?', 'どの部位で続けますか？'],
  'cp.margin': ['1단계당 전투력 증가', 'CP gain per step', '1段階あたりの戦闘力増加'],
  'cp.marginHint': [
    '돌파·코어강화는 다음 단계, 콘솔은 1레벨, 오버로드 옵션은 1단계 올렸을 때 늘어나는 전투력입니다.',
    'How much CP the next limit break / core enhance step — or one more console level, '
      + 'or one more overload option step — adds.',
    '凸・コア強化は次の段階、コンソールは1レベル、オーバーロードOPは1段階上げたときに増える戦闘力です。',
  ],
  'cp.marginWhat': ['항목', 'Item', '項目'],
  'cp.marginBreak': ['돌파 +1', 'Limit break +1', '凸 +1'],
  'cp.marginCore': ['코어강화 +1', 'Core enhance +1', 'コア強化 +1'],
  // 마지막 단계(3돌 · 7코강)에서는 더 올릴 수 없으니 빈칸이 아니라 0 이다
  'cp.marginMaxed': [
    '이미 마지막 단계라 더 올릴 수 없습니다.',
    'Already at the last step — nothing more to raise.',
    'すでに最終段階のため、これ以上は上げられません。',
  ],
  'cp.marginLocked': [
    '코어강화는 최대 돌파부터 열립니다.',
    'Core enhance opens once limit break is maxed.',
    'コア強化は最大凸から解放されます。',
  ],
  // 돌파 한계는 등급이 가른다 — SR 은 2돌까지, R 은 돌파가 없고, 코강은 SSR 전용
  'cp.marginNoBreak': [
    'R 등급 니케는 돌파가 없습니다.',
    'R Nikkes have no limit break.',
    'R等級のニケには凸がありません。',
  ],
  'cp.marginNoCore': [
    '코어강화는 SSR 등급만 가능합니다.',
    'Core enhance is SSR only.',
    'コア強化はSSR等級のみです。',
  ],
  'cp.marginElem': ['우코 옵션 +1', 'Elemental option +1', '有利コードOP +1'],
  'cp.marginOther': ['그 외 옵션 +1', 'Other option +1', 'その他OP +1'],
  'cp.lv': [n => `Lv.${n}`, n => `Lv.${n}`, n => `Lv.${n}`],
  'cp.cp': ['전투력', 'CP', '戦闘力'],
  'cp.noBase': [
    '이 조합의 기본 스탯 자료가 없습니다 (등급·클래스·레벨을 확인하세요).',
    'No base stats available for this combination — check rarity, class and level.',
    'この組み合わせの基本ステータス資料がありません（等級・クラス・レベルを確認してください）。',
  ],

  /* 내 계정 불러오기 (roster.js 에서 ctx.t 로 받아 쓴다) */
  'im.desc': [
    'Blablalink 에서 뽑아 온 내 니케 데이터를 넣으면 보유 니케의 전투력을 한 번에 볼 수 있습니다. '
      + '수집은 Tampermonkey 유저스크립트(또는 북마클릿)가 하고, 받은 자료는 이 브라우저 밖으로 나가지 않습니다.',
    'Drop in the roster exported from Blablalink to see the combat power of every Nikke you own. '
      + 'A Tampermonkey userscript (or a bookmarklet) does the collecting, and what you import never leaves this browser.',
    'Blablalink から書き出した自分のニケデータを読み込むと、所持ニケの戦闘力をまとめて確認できます。'
      + '収集は Tampermonkey ユーザースクリプト（またはブックマークレット）が行い、読み込んだ内容はこのブラウザの外に出ません。',
  ],
  /* 화살표는 문장을 펼쳐 놓을 때만 붙는다 (roster.js) — 접힌 '?' 의 툴팁에는 걸리적거린다 */
  'im.guide': ['수집 스크립트 설치 방법', 'How to install the collector', '収集スクリプトの導入手順'],
  'im.file': ['JSON 열기', 'Open JSON', 'JSONを開く'],
  'im.paste': ['붙여넣기', 'Paste', '貼り付け'],
  'im.pasteHint': ['복사한 JSON 을 붙여 넣으세요', 'Paste the copied JSON here', 'コピーしたJSONを貼り付け'],
  'im.pasteOk': ['불러오기', 'Import', '読み込む'],
  'im.clear': ['지우기', 'Clear', '消去'],
  'im.clearTitle': [
    '이 브라우저에 저장한 계정 자료를 지웁니다',
    'Delete the roster stored in this browser',
    'このブラウザに保存したアカウント資料を消します',
  ],
  'im.fromScript': ['수집 스크립트', 'the collector', '収集スクリプト'],
  'im.fromPaste': ['붙여넣기', 'paste', '貼り付け'],
  'im.received': [
    (n, from) => `${from}에서 니케 ${n}명을 불러왔습니다.`,
    (n, from) => `Imported ${n} Nikkes from ${from}.`,
    (n, from) => `${from}からニケ${n}体を読み込みました。`,
  ],
  'im.bad': [
    '읽을 수 없는 자료입니다. 수집 스크립트가 만든 JSON 이 맞는지 확인해 주세요.',
    'Could not read that. Make sure it is the JSON produced by the collector.',
    '読み込めませんでした。収集スクリプトが作成したJSONか確認してください。',
  ],
  'im.local': [
    '불러온 자료는 이 브라우저에만 저장됩니다. 서버로 보내지 않습니다.',
    'Imported data is stored in this browser only — nothing is sent to a server.',
    '読み込んだデータはこのブラウザにのみ保存され、サーバーには送信されません。',
  ],
  /* 지휘관 줄은 한 줄에 싱크로 + 콘솔 넉 칸이 들어가야 한다. */
  'im.synchro': ['싱크로', 'Synchro', 'シンクロ'],
  'im.collected': ['수집 시각', 'Collected', '収集日時'],
  'im.colBasic': ['기본', 'Basics', '基本'],
  'im.colSkills': ['스킬', 'Skills', 'スキル'],
  'im.colGear': ['장비', 'Gear', '装備'],
  'im.colCube': ['큐브', 'Cube', 'キューブ'],
  // 영어 'Collection' 은 한 단어라 줄바꿈이 안 돼 배지 한 칸짜리 열을 넓힌다
  'im.colColl': ['소장품', 'Coll.', 'コレクション'],
  'im.colBond': ['호감도', 'Bond', '好感度'],
  'im.step': ['단계', ' stage', '段階'],
  'im.filter': ['니케 검색', 'Search Nikkes', 'ニケを検索'],
  'im.shown': [
    (n, owned, all) => `${n}명 표시 · 보유 ${owned} / 전체 ${all}`,
    (n, owned, all) => `${n} shown · ${owned} owned of ${all}`,
    (n, owned, all) => `${n}体表示・所持 ${owned} / 全 ${all}`,
  ],
  'im.pick': ['클릭하면 이 니케를 계산기에 넣습니다', 'Click to load this Nikke into the form', 'クリックで計算機に読み込みます'],
  'im.noMatch': ['조건에 맞는 니케가 없습니다.', 'No Nikke matches.', '条件に合うニケがありません。'],
  'im.colNikke': ['이름', 'Name', '名前'],
  'im.colLevel': ['레벨', 'Level', 'レベル'],
  'im.colGrade': ['돌파', 'Break', '凸'],
  // 코강은 3돌 다음 단계라 돌파와 한 줄로 이어 센다
  'im.colGradeNote': [
    '정렬 순서: 0돌 → 3돌 → 1코강 → 7코강',
    'Sort order: Break 0 → Break 3 → Core 1 → Core 7',
    '並び順: 0凸 → 3凸 → コア1 → コア7',
  ],
  // 오버로드 옵션 중 우코 + 공증 종합값의 합 — 실전 성능을 한 숫자로 가늠한다
  'im.colOlAtk': ['우공합', 'OL ATK', '有利+攻撃'],
  'im.colOlAtkNote': [
    '오버로드 옵션 종합 중 우코(우월코드 대미지) + 공증(공격력) 합계',
    'Sum of the Elemental Damage and ATK overload option totals',
    'オーバーロードOP合計のうち 有利コードダメージ + 攻撃力 の合計',
  ],
  'im.unknown': [
    n => `사이트가 모르는 니케 ${n}명은 건너뛰었습니다.`,
    n => `Skipped ${n} Nikkes this site does not know yet.`,
    n => `サイトが未収録のニケ${n}体はスキップしました。`,
  ],
  'im.gearNote': [
    '장비 칸은 위가 머리·몸, 아래가 팔·다리이고 숫자는 강화 단계입니다. 분홍이 오버로드, '
      + '꽉 찬 주황이 9티어 기업, 테두리만 있는 주황이 9티어 일반입니다.',
    'In the gear cell the top row is head and body, the bottom row arm and leg; the number is the enhance step. '
      + 'Pink is overload, filled orange is tier-9 manufacturer, outlined orange is plain tier-9.',
    '装備欄は上段が頭・胴、下段が腕・足で、数字は強化段階です。ピンクがオーバーロード、'
      + '塗りつぶしのオレンジがT9企業装備、枠線だけのオレンジが通常T9です。',
  ],

  /* 전초기지 탭 (outpost.js 에서 ctx.t 로 받아 쓴다) */
  'op.loading': ['전초기지 자료를 불러오는 중…', 'Loading outpost data…', '前哨基地データを読み込み中…'],
  'op.progress': ['캠페인 진행도', 'Campaign progress', 'キャンペーン進行度'],
  'op.progressHint': [
    '프로필에 표시되는 최종 클리어 스테이지를 고르세요.',
    'Pick the last stage you cleared, as shown on your profile.',
    'プロフィールに表示される最終クリアステージを選んでください。',
  ],
  'op.normal': ['노멀', 'Normal', 'ノーマル'],
  'op.hard': ['하드', 'Hard', 'ハード'],
  'op.region': ['지역', 'Area', '地域'],
  'op.stage': ['스테이지', 'Stage', 'ステージ'],
  'op.notCleared': ['미클리어', 'Not cleared', '未クリア'],
  'op.reset': ['입력 초기화', 'Reset', '入力リセット'],
  'op.rules': ['계산 기준', 'How this is calculated', '計算の前提'],
  'op.formula': [
    (skip, step) => `전초기지 레벨 = (노멀 클리어 − 앞 ${skip}개 지역) + 하드 클리어 + 1 을 `
      + `${step}으로 나눈 몫 + 1. 노멀 지역0~2는 레벨에 반영되지 않고, 지역3이 열릴 때 `
      + `1스테이지분이 먼저 붙습니다.`,
    (skip, step) => `Outpost level = ⌊((normal clears − first ${skip} areas) + hard clears + 1) / ${step}⌋ + 1. `
      + `Normal areas 0–2 do not count, and one stage is credited up front when area 3 opens.`,
    (skip, step) => `基地防御レベル =（ノーマルクリア − 最初の${skip}地域）+ ハードクリア + 1 を`
      + `${step}で割った商 + 1。ノーマルの地域0〜2は加算されず、地域3の開放時に1ステージ分が先に加算されます。`,
  ],
  'op.academyNote': [
    l => `전술 아카데미는 항상 최대 레슨(${l}) 기준으로 계산합니다. 지휘관 경험치에는 부스트가 붙지 않습니다.`,
    l => `The Tactics Academy is always assumed maxed (${l}). Commander EXP gets no boost.`,
    l => `タクティクアカデミーは常に最大レッスン(${l})前提です。指揮官EXPにはブーストが付きません。`,
  ],
  'op.shifty': [
    '전투력 계산기 탭에서 계정 자료를 불러오면 이 진행도가 자동으로 채워집니다. 직접 고른 값은 다음 수집까지 그대로 둡니다.',
    'Import your account in the CP calculator tab and this progress fills in automatically. Stages you pick by hand stay until the next import.',
    '戦闘力計算機タブでアカウント資料を読み込むと、この進行度が自動で入ります。手動で選んだ値は次の収集まで保たれます。',
  ],
  /* 기업 타워 카드 — 계정 생성일 기준 '막힘 없이 올랐다면' 도달 가능한 최대 층 */
  'op.tower': ['기업 타워', 'Manufacturer Towers', '企業別タワー'],
  'op.created': ['계정 생성', 'Account created', 'アカウント作成'],
  'op.sinceDays': [n => `· ${n.toLocaleString()}일째`, n => `· day ${n.toLocaleString()}`, n => `· ${n.toLocaleString()}日目`],
  'op.towerHint': [
    n => `한 번도 막히지 않고 열릴 때마다 ${n}층씩 올랐다고 볼 때 도달 가능한 층입니다.`,
    n => `Ceiling if you cleared ${n} floors every time the tower opened, never blocked.`,
    n => `一度も詰まらず、開くたびに${n}階ずつ登った場合の到達可能な階です。`,
  ],
  'op.towerHintReal': [
    '층수는 게임이 알려준 클리어 층입니다. 옆의 회색 숫자는 한 번도 막히지 않고 열릴 때마다 끝까지 올랐다면 도달했을 층이고, 몰드는 클리어 층으로 셉니다.',
    'Floors are what the game reports as cleared. The grey number beside each is where you would be if you had climbed every opening without getting stuck; molds are counted from the cleared floor.',
    '階数はゲームが返したクリア階です。横の灰色の数字は、一度も詰まらず開くたびに登り切った場合の到達階で、モールドはクリア階で数えます。',
  ],
  'op.towerFloorReal': ['클리어 층 / 최대', 'Cleared / max', 'クリア階 / 最大'],
  'op.towerGap': [n => `최대보다 ${n}층 아래`, n => `${n} below the ceiling`, n => `最大より${n}階下`],
  'op.towerHaveReal': [
    (m, p) => `몰드 ${m.toLocaleString()}개 · 퍼펙트 ${p.toLocaleString()}개`,
    (m, p) => `${m.toLocaleString()} molds · ${p.toLocaleString()} perfect`,
    (m, p) => `モールド${m.toLocaleString()}個・パーフェクト${p.toLocaleString()}個`,
  ],
  'op.towerNeedReimport': [
    '실제 클리어 층이 없는 계정 자료입니다. 유저스크립트를 1.5.0 이상으로 업데이트한 뒤 다시 불러오면 타워별 클리어 층이 표시됩니다.',
    'This account data has no cleared floors. Update the userscript to 1.5.0 or later and import again to see each tower\'s cleared floor.',
    'クリア階が入っていないアカウント資料です。ユーザースクリプトを1.5.0以上に更新して読み込み直すと、タワーごとのクリア階が表示されます。',
  ],
  'op.tribeTower': ['트라이브 타워', 'Tribe Tower', 'トライブタワー'],
  'op.towerNeedAcct': [
    '전투력 계산기 탭에서 계정 자료를 불러오면 계정 생성일 기준으로 계산합니다.',
    'Import your account in the CP calculator tab to compute this from your account age.',
    '戦闘力計算機タブでアカウント資料を読み込むと、作成日を基準に計算します。',
  ],
  'op.towerPilgrim': ['필그림 / 오버스펙', 'Pilgrim / Overspec', 'ピルグリム / オーバースペック'],
  'op.towerCol': ['타워', 'Tower', 'タワー'],
  'op.towerFloor': ['최대 층', 'Max floor', '最大階'],
  'op.towerMold': ['몰드 50', 'Mold 50', 'モールド50'],
  'op.towerPerfect': ['퍼펙트 50', 'Perfect 50', 'パーフェクト50'],
  /* 타워 표 = 타워별로 다른 값(층수·쌓인 몰드), 몰드 표 = 무리별로 같은 값(회차·주) */
  'op.towerHaveCol': ['쌓인 몰드', 'Molds so far', '累計モールド'],
  'op.towerOpens': [o => `지금까지 ${o}회 열림`, o => `${o} openings so far`, o => `これまで${o}回開放`],
  'op.towerMoldTbl': ['모집 한 번(50개)까지', 'To one recruit (50)', '募集1回（50個）まで'],
  'op.towerGroupCol': ['타워 무리', 'Towers', 'タワー'],
  'op.towerGroupN': [n => `기업 ${n}사`, n => `${n} manufacturers`, n => `企業${n}社`],
  'op.floorN': [n => `${n.toLocaleString()}층`, n => `F${n.toLocaleString()}`, n => `${n.toLocaleString()}階`],
  'op.runN': [n => `${n}회`, n => `${n} runs`, n => `${n}回`],
  'op.weekN': [n => `${n}주`, n => `${n} wk`, n => `${n}週`],
  'op.towerDays': [d => `열리는 요일 ${d}`, d => `opens ${d}`, d => `開放 ${d}`],
  'op.wd0': ['일', 'Sun', '日'], 'op.wd1': ['월', 'Mon', '月'], 'op.wd2': ['화', 'Tue', '火'],
  'op.wd3': ['수', 'Wed', '水'], 'op.wd4': ['목', 'Thu', '木'], 'op.wd5': ['금', 'Fri', '金'],
  'op.wd6': ['토', 'Sat', '土'],
  'op.towerHave': [
    (o, m, p) => `지금까지 ${o}회 열림 · 몰드 ${m.toLocaleString()}개 · 퍼펙트 ${p.toLocaleString()}개`,
    (o, m, p) => `${o} openings so far · ${m.toLocaleString()} molds · ${p.toLocaleString()} perfect`,
    (o, m, p) => `これまで${o}回開放・モールド${m.toLocaleString()}個・パーフェクト${p.toLocaleString()}個`,
  ],
  'op.towerNeed': [
    (u, f) => `${u}개까지 ${f}층`,
    (u, f) => `${f} floors for ${u}`,
    (u, f) => `${u}個まで${f}階`,
  ],
  'op.towerMoldNote': [
    (s, b, p, u) => `기업 몰드는 한 층에 1개, ${s}의 배수 층에서는 ${b}개. 퍼펙트 몰드는 20층(필그림/오버스펙은 30층)마다 ${p}개입니다(2025-09-24 추가). 모집 한 번에 ${u}개가 들어가고, 아래 표의 두 칸은 그만큼 모으는 데 필요한 등반 횟수와 주 수입니다 — 값을 가르는 건 타워 이름이 아니라 주 개방 횟수와 퍼펙트 간격뿐이라 3사는 한 줄로 묶었습니다.`,
    (s, b, p, u) => `Manufacturer molds: 1 per floor, ${b} on every ${s}th. Perfect molds: ${p} every 20 floors (30 for Pilgrim/Overspec), added 2025-09-24. One recruit costs ${u} — the second table gives the runs and weeks to get there. Only the weekly openings and the perfect interval change the numbers, so the big three share one row.`,
    (s, b, p, u) => `企業モールドは1階につき1個、${s}の倍数階では${b}個。パーフェクトは20階（ピルグリム/オーバースペックは30階）ごとに${p}個（2025-09-24 追加）。1回の募集に${u}個 — 下の表は そこまでの登攀回数と週数です。値を分けるのは週の開放回数とパーフェクト間隔だけなので、3社は1行にまとめています。`,
  ],
  'op.fromAccount': [
    '불러온 계정 자료에서 채웠습니다.',
    'Filled in from your imported account data.',
    '読み込んだアカウント資料から入力しました。',
  ],
  'op.level': ['전초기지 레벨', 'Outpost level', '基地防御レベル'],
  'op.toNext': [
    (left, into, step) => `다음 레벨까지 ${left}스테이지 (${into}/${step})`,
    (left, into, step) => `${left} stages to next level (${into}/${step})`,
    (left, into, step) => `次のレベルまで${left}ステージ (${into}/${step})`,
  ],
  'op.atCap': [n => `레벨 상한 ${n} 도달`, n => `Level cap ${n} reached`, n => `レベル上限${n}に到達`],
  'op.stagesTotal': [
    n => `총 ${n.toLocaleString()}스테이지`,
    n => `${n.toLocaleString()} stages total`,
    n => `合計${n.toLocaleString()}ステージ`,
  ],
  'op.stagesSplit': [
    (a, b) => `노멀 ${a.toLocaleString()} + 하드 ${b.toLocaleString()}`,
    (a, b) => `Normal ${a.toLocaleString()} + Hard ${b.toLocaleString()}`,
    (a, b) => `ノーマル ${a.toLocaleString()} + ハード ${b.toLocaleString()}`,
  ],
  'op.academyTag': [l => `전술 아카데미 ${l}`, l => `Academy ${l}`, l => `タクティク ${l}`],
  'op.mismatch': [
    (a, b) => `프로필이 알려준 레벨(${a})과 계산값(${b})이 다릅니다. 스테이지 선택을 확인하세요.`,
    (a, b) => `The level reported by your profile (${a}) differs from the computed one (${b}).`,
    (a, b) => `プロフィールのレベル(${a})と計算値(${b})が一致しません。`,
  ],
  'op.income': ['재화 수급량', 'Resource income', '資源の収入'],
  'op.dust': ['코어 더스트', 'Core dust', 'コアダスト'],
  'op.credit': ['크레딧', 'Credits', 'クレジット'],
  'op.battle': ['배틀 데이터', 'Battle data', 'バトルデータ'],
  'op.exp': ['지휘관 경험치', 'Commander EXP', '指揮官EXP'],
  'op.res': ['재화', 'Resource', '資源'],
  'op.boost': ['부스트', 'Boost', 'ブースト'],
  'op.baseHr': ['기본/시', 'Base/hr', '基本/時'],
  'op.appliedHr': ['적용/시', 'With boost/hr', '適用/時'],
  'op.perHr': ['/시', 'per hour', '/時'],
  'op.perMinCol': ['/분', 'per min', '/分'],
  'op.perDay': ['/24시간', 'per 24 h', '/24時間'],
  'op.next': ['다음 코어더스트 구간', 'Next core dust step', '次のコアダスト区間'],
  'op.nextHint': [
    v => `현재 시간당 ${v}. 다음 정수 구간에 닿으려면:`,
    v => `Currently ${v} per hour. To reach the next whole number:`,
    v => `現在 毎時 ${v}。次の整数区間に届くには:`,
  ],
  'op.noNext': [
    '이미 자료에 있는 마지막 구간입니다.',
    'Already at the last step in the data.',
    'すでに資料上の最終区間です。',
  ],
  'op.target': ['코어더스트/시', 'Core dust/hr', 'コアダスト/時'],
  'op.needLevel': ['필요 레벨', 'Level needed', '必要レベル'],
  'op.needStages': ['추가 스테이지', 'Stages to go', '追加ステージ'],
  'op.viaNormal': ['노멀로 밀 경우', 'If pushed in Normal', 'ノーマルで進める場合'],
  'op.viaHard': ['하드로 밀 경우', 'If pushed in Hard', 'ハードで進める場合'],
  'op.viaHint': [
    '노멀·하드 어느 쪽으로 밀어도 스테이지 수는 같습니다. 각 칸은 그 난이도만으로 채웠을 때 도달하는 스테이지입니다.',
    'Either difficulty counts the same; each column shows where you would land if you pushed only that one.',
    'どちらの難易度でもステージ数は同じです。各列はその難易度だけで進めた場合の到達地点です。',
  ],
  'op.outOfRange': [
    '남은 스테이지 부족',
    'Not enough stages left',
    '残りステージ不足',
  ],
  'op.table': ['코어더스트 구간표', 'Core dust steps', 'コアダスト区間表'],
  'op.half': ['0.5 단위까지', 'Half steps too', '0.5刻みまで'],
  'op.minLevel': ['최소 레벨', 'Min level', '最小レベル'],
  'op.cumStages': ['누적 스테이지', 'Stages total', '累計ステージ'],
  'op.deltaStages': ['현재 대비', 'From here', '現在比'],
  'op.tableHint': [
    '전술 아카데미 최대 레벨 기준. 굵은 줄이 지금 노리는 구간입니다.',
    'Assumes a maxed Tactics Academy. The highlighted row is the step you are working toward.',
    'タクティクアカデミー最大前提。強調行が現在狙っている区間です。',
  ],

  /* 니파고 탭 — 오버로드 옵션작 (nipago.js 에서 ctx.t 로 받아 쓴다) */
  'np.loading': ['옵션 표를 불러오는 중…', 'Loading option tables…', 'OP表を読み込み中…'],
  'np.goals': ['목표 옵션', 'Target options', '目標OP'],
  'np.goalsHint': [
    '노리는 옵션을 고르세요. 2·3슬롯 체크는 그 옵션이 해당 슬롯에 떴을 때 잠금을 권할지입니다.',
    'Pick what you are aiming for. The slot 2 / slot 3 checkboxes decide whether a lock is recommended when that option lands there.',
    '狙うOPを選びます。中段・下段のチェックは、その枠に出たときロックを勧めるかどうかです。',
  ],
  'np.modeOpt': ['옵션 종류만', 'Option only', 'OP種類のみ'],
  'np.modeLv': ['옵션 + 최소 레벨', 'Option + min level', 'OP + 最小レベル'],
  'np.minLv': ['최소 lv', 'Min lv', '最小lv'],
  'np.slotN': [n => `슬롯 ${n}`, n => `Slot ${n}`, n => JA_SLOT(n)],
  'np.slotP': [(n, p) => `슬롯 ${n} (${p}%)`, (n, p) => `Slot ${n} (${p}%)`, (n, p) => `${JA_SLOT(n)} (${p}%)`],
  'np.appear': [p => `${p}% 등장`, p => `${p}% appear`, p => `${p}% 出現`],

  /* 칩·카운터는 커뮤니티 약어(カスモ), 설명문은 정식 명칭(カスタムモジュール) */
  'np.cost': ['예상 소모량', 'Expected cost', '想定消費量'],
  'np.module': ['🔵 모듈', '🔵 Modules', '🔵 カスモ'],
  'np.lockkey': ['🔑 락키', '🔑 Lock keys', '🔑 ロックキー'],
  'np.expected': ['기대 소모', 'Expected', '期待消費'],
  'np.spent': ['누적 소모', 'Spent', '累計消費'],
  'np.perRoll': ['이번 회차', 'This roll', '今回'],
  'np.pieces': [n => `${n}개`, n => `${n}`, n => `${n}個`],
  'np.perRollN': [n => `${n}개/회`, n => `${n} per roll`, n => `${n}個/回`],
  'np.approx': [n => `~${n}개`, n => `~${n}`, n => `~${n}個`],

  'np.goalProb': ['효과변경 1회 목표 등장 확률', 'Target chance per option change', '効果変更1回の目標出現率'],
  'np.noGoal': ['목표 옵션을 먼저 고르세요.', 'Pick a target option first.', 'まず目標OPを選んでください。'],
  'np.freeAll': ['자유 슬롯 전체', 'Any free slot', '空き枠全体'],

  'np.gear': ['개조 장비 효과', 'Overload gear', 'オバロ装備の効果'],
  'np.emptySlot': [n => `슬롯 ${n} — 효과 미획득`, n => `Slot ${n} — no effect`, n => `${JA_SLOT(n)} — 効果なし`],
  'np.option': ['옵션', 'Option', 'OP'],
  'np.level': ['레벨', 'Level', 'レベル'],
  'np.set': ['설정', 'Set', '設定'],
  'np.emptyOpt': ['— 빈 슬롯 —', '— empty —', '— 空き枠 —'],
  'np.btnChange': ['효과 변경', 'Change options', '効果変更'],
  'np.btnReset': ['수치 재설정', 'Reroll values', '数値再設定'],
  'np.clear': ['입력·누적 초기화', 'Reset everything', '入力・累計リセット'],

  'np.lockTitle': ['잠금', 'Lock', 'ロック'],
  'np.lockMod': [n => `모듈 ${n}개로 잠금`, n => `Lock with ${n} modules`, n => `カスモ${n}個でロック`],
  'np.lockKey': [n => `락키 ${n}개로 잠금`, n => `Lock with ${n} keys`, n => `ロックキー${n}個でロック`],
  'np.lockModS': ['모듈잠금', 'Module lock', 'カスモロック'],
  'np.lockKeyS': ['락키잠금', 'Key lock', 'キーロック'],
  'np.unlock': ['잠금 해제', 'Unlock', 'ロック解除'],
  'np.cancelLock': [c => `잠금 취소 (${c} 반환)`, c => `Undo lock (${c} back)`, c => `ロック取消 (${c} 返却)`],

  'np.probTable': ['슬롯별 옵션 등장 확률', 'Option chance by slot', '枠別のOP出現率'],
  'np.rec': ['추천 행동', 'What to do next', '推奨アクション'],
  'np.tag_hot': ['지금', 'Now', '今'],
  'np.tag_rec': ['권장', 'Suggested', '推奨'],
  'np.tag_ok': ['완료', 'Done', '完了'],
  'np.recLock': [
    (n, opt, lv, kind) => `슬롯 ${n} · ${opt} lv${lv} — ${kind} 권장`,
    (n, opt, lv, kind) => `Slot ${n} · ${opt} lv${lv} — ${kind} suggested`,
    (n, opt, lv, kind) => `${JA_SLOT(n)} · ${opt} lv${lv} — ${kind}推奨`,
  ],
  'np.recLv': [
    (n, opt, min) => `슬롯 ${n} · ${opt} 수치재설정 → lv${min}+`,
    (n, opt, min) => `Slot ${n} · reroll ${opt} to lv${min}+`,
    (n, opt, min) => `${JA_SLOT(n)} · ${opt}の数値再設定 → lv${min}+`,
  ],
  'np.recLvDesc': [
    (lv, cur, min, want, p, exp) => `lv${lv}(${cur}) → lv${min}+(${want}). 이번 판 달성 확률 ${p}, 기대 ${exp}모듈. 못 맞힌 판은 더 낮은 구간(1~5 › 6~10 › 11~)이 나왔을 때만 적용.`,
    (lv, cur, min, want, p, exp) => `lv${lv}(${cur}) → lv${min}+(${want}). ${p} chance this roll, ~${exp} modules. On a miss, apply only if it lands in a lower band (1–5 › 6–10 › 11+).`,
    (lv, cur, min, want, p, exp) => `lv${lv}(${cur}) → lv${min}+(${want})。今回の達成率 ${p}、期待 ${exp}カスモ。外れた回は、より低い帯(1~5 › 6~10 › 11~)が出たときだけ適用。`,
  ],
  'np.recRoll': [
    s => `효과변경 — ${s} 탐색`,
    s => `Change options — reroll ${s}`,
    s => `効果変更 — ${s} を再抽選`,
  ],
  'np.recRollDesc': [
    (p, cost, exp) => `목표 등장 확률 ${p} · 리롤당 ${cost}모듈 · 기대 ${exp}모듈. 잠금 순서는 슬롯3 → 슬롯2 → 슬롯1.`,
    (p, cost, exp) => `${p} chance · ${cost} modules per roll · ~${exp} modules total. Lock in the order slot 3 → 2 → 1.`,
    (p, cost, exp) => `目標出現率 ${p}・1回あたり${cost}カスモ・期待${exp}カスモ。ロック順は下段→中段→上段。`,
  ],
  'np.recDone': ['목표 달성!', 'Goal reached!', '目標達成！'],
  'np.recDoneDesc': [
    '모든 슬롯이 목표를 충족했습니다.',
    'Every slot meets the target.',
    'すべての枠が目標を満たしています。',
  ],
  'np.whyBlack': [
    '블랙라벨 lv15 — 슬롯1이라도 모듈잠금 권장',
    'Black label lv15 — worth a module lock even in slot 1',
    'ブラックラベル lv15 — 上段でもカスモロック推奨',
  ],
  'np.whyLoss': [
    n => `재탐색 기대손실 ~${n}개 > 잠금비용`,
    n => `expected loss ~${n} > lock cost`,
    n => `再抽選の期待損失 ~${n}個 > ロック費用`,
  ],
  'np.whySlot3': ['슬롯3 목표 달성', 'Slot 3 target met', '下段の目標達成'],

  'np.modalTitle': ['효과 변경 미리보기', 'Option change preview', '効果変更プレビュー'],
  'np.cur': ['현재 효과', 'Current', '現在の効果'],
  'np.next': ['변경 효과', 'After change', '変更後'],
  'np.none': ['효과 미획득', 'No effect', '効果なし'],
  'np.keep': ['효과 유지', 'Keep', '維持'],
  'np.apply': ['효과 변경', 'Change', '変更'],
  'np.modalTitleLv': ['수치 재설정 미리보기', 'Value reroll preview', '数値再設定プレビュー'],
  'np.keepLv': ['수치 유지', 'Keep', '維持'],
  'np.applyLv': ['수치 변경', 'Change', '変更'],

  /* 특특요 탭 (intercept.js 에서 ctx.t 로 받아 쓴다) */
  'ic.loading': ['수급량 표를 불러오는 중…', 'Loading drop-rate tables…', '排出率表を読み込み中…'],

  'ic.conditions': ['조건', 'Conditions', '条件'],
  'ic.mode': ['진입 모드', 'Boss', '進入モード'],
  'ic.modeModule': ['모듈 (크라켄)', 'Modules (Kraken)', 'カスモ (クラーケン)'],
  'ic.modeModuleFull': [
    '크라켄에 들어가면 모듈 랜덤박스가 뜬다',
    'Kraken drops the module random box',
    'クラーケンに入るとカスタムモジュールのランダムボックスが出る',
  ],
  'ic.modeEquip': ['기업장비 (그 외)', 'Gear (other bosses)', '企業装備 (その他)'],
  'ic.modeEquipFull': [
    '크라켄을 뺀 나머지 보스는 기업장비 랜덤박스가 뜬다',
    'Every boss except Kraken drops the manufacturer-gear box',
    'クラーケン以外のボスは企業装備ランダムボックスが出る',
  ],
  'ic.burst': ['풀버스트 이벤트', 'Full Burst event', 'フルバーストデイ'],
  'ic.burstOff': ['평상시', 'Normal day', '通常日'],
  'ic.burstOn': ['적용일', 'Event day', '適用日'],
  'ic.step': ['단계', 'Step', '段階'],
  'ic.gamesNote': [
    (e, g) => `하루 진입 ${e}회 · 게임 ${g}회. 풀버스트는 골라 쓰는 게 아니라 이벤트로 적용되는 날이 따로 있고, 그날은 진입당 2게임이 된다.`,
    (e, g) => `${e} entries a day → ${g} games. Full Burst is not something you switch on — it applies on event days, and those days give 2 games per entry.`,
    (e, g) => `1日${e}回進入・${g}ゲーム。フルバーストデイは自分で選ぶものではなく適用される日が決まっていて、その日は進入あたり2ゲームになる。`,
  ],

  'ic.view': ['보기', 'View', '表示'],
  'ic.axis': ['확률 종류', 'Probability', '確率の種類'],
  'ic.axisPmf': ['정확히 k개', 'Exactly k', 'ちょうどk個'],
  'ic.axisCum': ['k개 이상', 'k or more', 'k個以上'],
  'ic.withPieces': ['모듈피스 확정분 포함', 'Include guaranteed pieces', 'ピース確定分を含む'],
  'ic.withPiecesHint': [
    '모듈피스는 확률이 아니라 매 게임 확정으로 들어온다. 켜면 피스 100개마다 완성되는 모듈 수만큼 분포가 통째로 오른쪽으로 밀린다 — 하루에 실제로 늘어나는 모듈 총 개수가 된다. (남는 피스가 다음날로 이월되는 것은 반영하지 않는다)',
    'Module pieces are guaranteed, not rolled. Turning this on shifts the whole distribution right by the modules those pieces complete, giving the total modules gained in a day. Leftover pieces carrying into the next day are not modelled.',
    'カスタムモジュールピースは確率ではなく毎ゲーム確定で入る。オンにするとピース100個ごとに完成する分だけ分布が右にずれ、1日に実際に増える総数になる。余ったピースの翌日繰り越しは考慮しない。',
  ],

  'ic.about': ['이 표에 대해', 'About', 'この表について'],
  'ic.aboutModel': [
    '모듈 모드는 게임 1회 분포를 게임 수만큼 합성곱한 정확한 값이고, 장비 모드는 이항분포 B(게임 수, 장비박스 출현율)다. 근사가 아니다.',
    'Module mode is the exact distribution — one game convolved with itself once per game. Gear mode is the binomial B(games, gear-box rate). Neither is an approximation.',
    'カスモモードは1ゲーム分布をゲーム数だけ畳み込んだ厳密値、装備モードは二項分布 B(ゲーム数, 装備箱出現率)。近似ではない。',
  ],
  'ic.aboutSource': [
    '수급량 표 두 개(3.5주년 이전 / 이후)에서 그때그때 계산한다. 워크북에 들어 있는 완성 분포표와 소수점 아래 9자리까지 일치하는 것을 확인했다.',
    'Computed on the fly from the two drop-rate tables (pre / post 3.5th anniversary). Matches the pre-computed tables in the workbook to nine decimal places.',
    '2つの排出率表（3.5周年以前／以降）からその都度計算する。ワークブックの完成済み分布表と小数9桁まで一致することを確認済み。',
  ],

  'ic.pre': ['3.5주년 이전', 'Pre-3.5th', '3.5周年以前'],
  'ic.post': ['3.5주년 이후', 'Post-3.5th', '3.5周年以降'],
  'ic.delta': ['변화', 'Change', '変化'],
  'ic.deltaPp': ['차이 (%p)', 'Diff (pp)', '差 (%p)'],
  'ic.ratio': ['배율', 'Ratio', '倍率'],
  'ic.item': ['항목', 'Item', '項目'],
  'ic.shape': ['분포', 'Shape', '分布'],
  'ic.wasValue': [v => `이전 ${v}`, v => `was ${v}`, v => `以前 ${v}`],

  'ic.summary': ['3.5주년 전후 비교', 'Before vs after the 3.5th', '3.5周年の前後比較'],
  'ic.summaryModule': [
    (s, g) => `${s}단계 · 하루 ${g}게임 기준, 크라켄에서 나오는 하루치 모듈.`,
    (s, g) => `Step ${s}, ${g} games a day — modules from Kraken in one day.`,
    (s, g) => `${s}段階・1日${g}ゲーム。クラーケンから1日に出るカスタムモジュール。`,
  ],
  'ic.summaryEquip': [
    (s, g) => `${s}단계 · 하루 ${g}게임 기준, 크라켄을 뺀 보스에서 나오는 하루치 기업장비 박스.`,
    (s, g) => `Step ${s}, ${g} games a day — gear boxes from the non-Kraken bosses in one day.`,
    (s, g) => `${s}段階・1日${g}ゲーム。クラーケン以外のボスから1日に出る企業装備箱。`,
  ],
  'ic.mean': ['하루 기대값 E[X]', 'Daily mean E[X]', '1日期待値 E[X]'],
  'ic.sd': ['표준편차 σ', 'Std. dev. σ', '標準偏差 σ'],
  'ic.piecesTotal': ['하루 모듈피스', 'Pieces a day', '1日のピース'],
  'ic.totalModules': ['하루 총 완성 모듈', 'Total modules a day', '1日の完成カスモ'],
  'ic.eachKind': ['노리는 1종 기대값', 'One specific piece', '狙った1種の期待値'],
  'ic.perMonth': ['30일 누적 기대값', 'Over 30 days', '30日累計'],
  'ic.piecesNote': [
    (ad, al, bd, bl, per) => `모듈피스는 ${per}개마다 모듈 1개가 된다 — 이전 ${ad}개(+${al}피스 남음), 이후 ${bd}개(+${bl}피스 남음). 이 몫은 확률이 아니라 확정이라 아래 분포에는 들어가지 않는다.`,
    (ad, al, bd, bl, per) => `Every ${per} pieces complete one module — pre ${ad} (+${al} left over), post ${bd} (+${bl} left over). That part is guaranteed, so it is not part of the distribution below.`,
    (ad, al, bd, bl, per) => `ピースは${per}個ごとにモジュール1個になる — 以前 ${ad}個(+${al}余り)、以降 ${bd}個(+${bl}余り)。確定分なので下の分布には含まれない。`,
  ],
  'ic.eachNote': [
    n => `장비 랜덤박스에서 나오는 종류는 ${n}가지(4부위 × 5기업)이고 전부 같은 확률이다.`,
    n => `The gear box rolls one of ${n} kinds (4 slots × 5 manufacturers), all equally likely.`,
    n => `装備箱から出る種類は${n}通り（4部位×5企業）で、すべて同確率。`,
  ],

  'ic.params': [s => `${s}단계 수급량`, s => `Step ${s} drop rates`, s => `${s}段階の排出率`],
  'ic.paramsHint': [
    '아래 분포는 전부 이 값들에서 나온다.',
    'Everything below is derived from these values.',
    '以下の分布はすべてこの値から出る。',
  ],
  'ic.paramsFoot': [
    '흐린 줄은 지금 보고 있는 모드에서 쓰이지 않는 값이다.',
    'Dimmed rows are not used by the mode you are viewing.',
    '薄い行は今のモードでは使われない値。',
  ],
  'ic.pPieces': ['모듈피스 / 게임', 'Module pieces / game', 'ピース / ゲーム'],
  'ic.pBox': ['모듈박스 출현율 (%)', 'Module box rate (%)', 'カスモ箱 出現率 (%)'],
  'ic.pP1': ['박스에서 1개 (%)', '1 module from box (%)', '箱から1個 (%)'],
  'ic.pP2': ['박스에서 2개 (%)', '2 modules from box (%)', '箱から2個 (%)'],
  'ic.pP3': ['박스에서 3개 (%)', '3 modules from box (%)', '箱から3個 (%)'],
  'ic.pEquip': ['장비박스 출현율 (%)', 'Gear box rate (%)', '装備箱 出現率 (%)'],

  'ic.distPmf': ['일일 획득 확률 분포', 'Daily distribution', '1日の獲得確率分布'],
  'ic.distCum': ['일일 누적 확률 분포', 'Daily cumulative distribution', '1日の累積確率分布'],
  'ic.distPmfHint': [
    u => `하루에 ${u} 정확히 k개 얻을 확률(%).`,
    u => `Chance (%) of getting exactly k ${u} in a day.`,
    u => `1日にちょうどk個の${u}を得る確率(%)。`,
  ],
  'ic.distCumHint': [
    u => `하루에 ${u} k개 이상 얻을 확률(%). '적어도 몇 개는 나온다'를 보려면 이쪽.`,
    u => `Chance (%) of getting at least k ${u} in a day — use this to read "at least N".`,
    u => `1日にk個以上の${u}を得る確率(%)。「最低でも何個」を見るならこちら。`,
  ],
  /* 한국어는 목적격 조사까지 붙여 둔다 (모듈'을' / 장비 박스'를') */
  'ic.unitModule': ['모듈을', 'modules', 'カスモ'],
  'ic.unitEquip': ['장비 박스를', 'gear boxes', '装備箱'],
  'ic.k': ['획득 수 k', 'Count k', '獲得数 k'],
  'ic.kAtLeast': ['k개 이상', 'k or more', 'k個以上'],

  'ic.bySteps': ['단계별 기대값', 'Mean by step', '段階別の期待値'],
  'ic.byStepsHint': [
    '지금 조건 그대로 단계만 바꿔가며 본 하루 기대값. 단계 숫자를 누르면 그 단계로 옮겨간다.',
    'Daily mean at every step under the current settings. Click a step number to switch to it.',
    '今の条件のまま段階だけ変えた1日期待値。段階の数字を押すとその段階に切り替わる。',
  ],

  /* 싱크로 레벨 상한 (synccap.js 에서 ctx.t 로 받아 쓴다) */
  'sc.title': ['일자별 싱크로 레벨 상한치', 'Synchro level cap by date', '日付別シンクロレベル上限'],
  'sc.date': ['기준일', 'Date', '基準日'],
  'sc.count': ['니케 수', 'Nikkes', 'ニケ数'],
  'sc.break': ['돌파', 'Break', '凸'],
  'sc.mult': ['배수', 'Mult.', '倍率'],
  'sc.add': ['증가량', 'Added', '増加量'],
  'sc.addFull': [
    '싱크로 최대렙 증가량', 'Synchro max level added', 'シンクロ最大レベル増加量',
  ],
  'sc.subtotal': ['소계', 'Subtotal', '小計'],
  'sc.addTotal': ['증가량계', 'Total added', '増加量計'],
  'sc.base': [
    '니케가 도달 가능한 최대 레벨', 'Max level a Nikke can reach', 'ニケが到達可能な最大レベル',
  ],
  'sc.total': ['합계', 'Total', '合計'],
  /* 카드가 좁아 설명은 제목 hover 로 뺀다 */
  'sc.how': [
    (b, s) => `기준일까지 출시된 니케를 등급별로 세어 «니케 수 × (1 + 돌파 × ${s})» 를 더하고, 니케 최대 레벨 ${b} 을 얹은 값. 돌파·배수는 게임 상수라 고정이다.`,
    (b, s) => `Counts Nikkes released on or before the date, adds «count × (1 + limit break × ${s})» per rarity, plus the Nikke level cap of ${b}. Limit break and multiplier are fixed game constants.`,
    (b, s) => `基準日までに実装されたニケを等級別に数え、«ニケ数 × (1 + 凸 × ${s})» を足し、ニケ最大レベル ${b} を加えた値。限界突破と倍率はゲーム定数で固定。`,
  ],
  'sc.unknown': [
    n => `출시일이 없는 ${n}명은 세지 않았습니다.`,
    n => `${n} Nikke(s) without a release date are not counted.`,
    n => `実装日が不明な${n}体は数えていません。`,
  ],

  'ui.loading': ['데이터를 불러오는 중…', 'Loading data…', 'データを読み込み中…'],
  'ui.reset': ['필터 초기화', 'Reset filters', '絞り込みクリア'],
  /* 메카미(딜 시뮬레이터)로 가는 링크. */
  'ui.mekami': ['메카미 — 스쿼드 DPS 시뮬레이터', 'Mekami — squad DPS simulator',
                'メカミ — スクワッドDPSシミュレータ'],
  'ui.theme': ['테마 전환', 'Toggle theme', 'テーマ切替'],
  'ui.close': ['닫기', 'Close', '閉じる'],
  'ui.toLight': ['라이트 모드로 전환', 'Switch to light mode', 'ライトモードに切替'],
  'ui.toDark': ['다크 모드로 전환', 'Switch to dark mode', 'ダークモードに切替'],
  'ui.filters': ['필터', 'Filters', '絞り込み'],
  'ui.filterOpen': ['필터 열기', 'Show filters', '絞り込みを開く'],
  'ui.filterClose': ['필터 접기', 'Hide filters', '絞り込みを閉じる'],
  'ui.langGroup': ['표시 언어', 'Display language', '表示言語'],
  'ui.search': [
    '이름 · 별명 · 초성 검색 (예: ㄹㅍ, 스화, 흑염룡)',
    'Search by name, squad or Korean nickname (e.g. Rapi, Counters)',
    '名前・部隊・あだ名で検索（例: ラピ、カウンターズ）',
  ],
  'ui.meta': [
    m => `데이터 기준일 ${m.updated_at} · 니케 ${m.counts.nikkes}명 · 배너 ${m.counts.pickups}개`,
    m => `Data as of ${m.updated_at} · ${m.counts.nikkes} Nikkes · ${m.counts.pickups} banners`,
    m => `データ基準日 ${m.updated_at} · ニケ ${m.counts.nikkes}体 · ピックアップ ${m.counts.pickups}件`,
  ],

  'f.squad': ['스쿼드', 'Squad', '部隊'],
  'f.release': ['출시일', 'Released', '実装日'],
  'f.releaseFrom': ['출시일 시작', 'Released from', '実装日 開始'],
  'f.releaseTo': ['출시일 종료', 'Released to', '実装日 終了'],
  'f.rerun': ['복각', 'Rerun', '復刻'],
  'f.rerunOnly': ['복각만', 'Reruns only', '復刻のみ'],
  'f.firstOnly': ['최초 픽업만', 'First run only', '初回のみ'],
  'f.timeline': ['타임라인 보기', 'Timeline view', 'タイムライン表示'],
  'f.all': ['전체', 'All', 'すべて'],

  'ax.corporation': ['기업', 'Manufacturer', '企業'],
  'ax.element': ['속성', 'Element', '属性'],
  'ax.class': ['클래스', 'Class', 'クラス'],
  'ax.weapon_type': ['무기', 'Weapon', '武器'],
  'ax.burst': ['버스트', 'Burst', 'バースト'],
  'ax.rarity': ['등급', 'Rarity', '等級'],
  'ax.status': ['진행', 'Status', '状態'],
  'ax.availability': ['픽업', 'Pool', '排出'],
  'ax.tag': ['구분', 'Type', '区分'],
  'ax.attack_type': ['공격타입', 'Attack type', '攻撃タイプ'],

  'col.name': ['이름', 'Name', '名前'],
  'col.squad': ['스쿼드', 'Squad', '部隊'],
  'col.release': ['출시일', 'Released', '実装日'],
  'col.pickups': ['픽업', 'Banners', 'PU'],
  'col.no': ['연번', '#', '番号'],
  'col.period': ['기간', 'Period', '期間'],

  'msg.emptyNikke': ['조건에 맞는 니케가 없습니다.', 'No Nikkes match these filters.', '条件に合うニケがいません。'],
  'msg.emptyPickup': ['조건에 맞는 픽업이 없습니다.', 'No banners match these filters.', '条件に合うピックアップがありません。'],
  'msg.unlisted': ['(리스트 미등록)', '(not in list yet)', '（リスト未登録）'],
  'msg.noPickup': [
    '픽업 배너 이력이 없습니다 (런칭 유닛 또는 비가챠).',
    'No banner history (launch unit or non-gacha).',
    'ピックアップ履歴がありません（実装時ユニットまたは非ガチャ）。',
  ],
  'msg.rerunOf': [n => `#${n} 복각`, n => `Rerun of #${n}`, n => `#${n} 復刻`],
  'msg.dday': [n => `D-${n}`, n => `in ${n}d`, n => `あと${n}日`],
  /* 진행 중인 배너는 '진행중' 보다 언제 닫히는지가 쓸모 있다 (24시간 미만이면 D-0) */
  'msg.ddayEnd': [n => `마감 D-${n}`, n => `ends in ${n}d`, n => `終了まであと${n}日`],
  'msg.year': [y => `${y}년`, y => `${y}`, y => `${y}年`],

  'cnt.nikkes': [
    (n, t) => `<b>${n}</b> / ${t}명`,
    (n, t) => `<b>${n}</b> / ${t}`,
    (n, t) => `<b>${n}</b> / ${t}体`,
  ],
  'cnt.banners': [
    (n, t) => `<b>${n}</b> / ${t}개 배너`,
    (n, t) => `<b>${n}</b> / ${t} banners`,
    (n, t) => `<b>${n}</b> / ${t}件`,
  ],
  'cnt.both': [
    (a, b) => `니케 <b>${a}</b> · 배너 <b>${b}</b>`,
    (a, b) => `<b>${a}</b> Nikkes · <b>${b}</b> banners`,
    (a, b) => `ニケ <b>${a}</b> · PU <b>${b}</b>`,
  ],

  'sheet.aliases': [n => `별명 (${n})`, n => `Nicknames (${n})`, n => `あだ名 (${n})`],
  'sheet.history': [n => `픽업 이력 (${n})`, n => `Banner history (${n})`, n => `ピックアップ履歴 (${n})`],

  'err.title': ['데이터를 불러오지 못했습니다.', 'Could not load the data.', 'データを読み込めませんでした。'],
  'err.hint': [
    'data/*.json 이 레포에 올라가 있는지 확인하세요. 로컬에서 열었다면 <code>file://</code> 이 아니라 <code>python3 -m http.server</code> 로 띄워야 합니다.',
    'Check that data/*.json exists in the repo. If opened locally, serve it with <code>python3 -m http.server</code> — <code>file://</code> will not work.',
    'data/*.json がリポジトリにあるか確認してください。ローカルで開いた場合は <code>file://</code> ではなく <code>python3 -m http.server</code> で配信してください。',
  ],

  /* 통계 탭 (charts.js 에서 ctx.t 로 받아 쓴다) */
  'st.head': [
    (a, b) => `현재 필터 기준 · 니케 ${a}명 · 픽업 배너 ${b}개 — 필터를 바꾸면 아래 모든 차트가 함께 좁혀집니다.`,
    (a, b) => `Current filters · ${a} Nikkes · ${b} banners — every chart below narrows with the filters.`,
    (a, b) => `現在の絞り込み · ニケ ${a}体 · ピックアップ ${b}件 — 絞り込みを変えると下のチャートも一緒に絞られます。`,
  ],
  'st.byAxis': [
    a => `${a}별 분포`, a => `By ${a}`, a => `${a}別の分布`,
  ],
  'st.basis': [n => `${n}명 기준`, n => `of ${n} Nikkes`, n => `${n}体 基準`],
  'st.basisBanner': [n => `${n}개 배너 기준`, n => `of ${n} banners`, n => `${n}件のピックアップ基準`],
  'st.squadTop': [n => `스쿼드 TOP 12`, n => `Top 12 squads`, n => `部隊 TOP 12`],
  'st.squadTotal': [n => `총 ${n}개 스쿼드`, n => `${n} squads total`, n => `全 ${n} 部隊`],
  'st.cross': [(a, b) => `${a} × ${b}`, (a, b) => `${a} × ${b}`, (a, b) => `${a} × ${b}`],
  'st.crossHint': [
    '칸의 숫자는 해당 조합의 니케 수',
    'Each cell is the number of Nikkes in that combination',
    'マスの数字はその組み合わせのニケ数',
  ],
  'st.elementNote': [
    '막대 색은 검증된 팔레트이고, 아이콘은 게임 내 아이콘입니다. 둘 다 항상 속성 이름과 함께 표시됩니다.',
    'Bar colors come from the validated palette; icons are the in-game ones. Both always sit beside the element name.',
    'バーの色は検証済みパレット、アイコンはゲーム内のものです。どちらも常に属性名と一緒に表示されます。',
  ],
  'st.quarter': ['분기별 출시 추이', 'Releases by quarter', '四半期ごとの実装推移'],
  'st.quarterHint': [
    '가로축은 분기, 세로축은 출시된 니케 수',
    'X axis is the quarter, Y axis is Nikkes released',
    '横軸は四半期、縦軸は実装されたニケ数',
  ],
  'st.avail': ['한정 / 상시 비율', 'Limited vs standard', '限定 / 常設の比率'],
  'st.tagDist': ['픽업 구분별 분포', 'Banners by type', 'ピックアップ区分別の分布'],
  'st.gap': ['복각 주기', 'Time until rerun', '復刻までの期間'],
  'st.gapHint': [
    (n, med) => `복각 ${n}건 · 첫 픽업 이후 경과 개월 (중앙값 ${med}개월)`,
    (n, med) => `${n} reruns · months since first banner (median ${med})`,
    (n, med) => `復刻 ${n}件 · 初回からの経過月数（中央値 ${med}ヶ月）`,
  ],
  'st.gapNone': [
    '현재 조건에 복각 배너가 없습니다',
    'No reruns match the current filters',
    '現在の条件に復刻ピックアップがありません',
  ],
  'st.months': [
    (a, b) => b == null ? `${a}개월+` : `${a}~${b}개월`,
    (a, b) => b == null ? `${a}+ months` : `${a}–${b} months`,
    (a, b) => b == null ? `${a}ヶ月以上` : `${a}〜${b}ヶ月`,
  ],
  'st.noBanner': ['픽업 이력 없음', 'Never featured', 'ピックアップ履歴なし'],
  'st.noBannerHint': [
    '런칭 유닛이거나 가챠 배너를 받은 적 없는 니케',
    'Launch units, or Nikkes that never had a banner',
    '実装時ユニット、またはピックアップを持たないニケ',
  ],
  'st.hasBanner': ['픽업 있음', 'Featured', 'ピックアップあり'],
  'st.hasNoBanner': ['픽업 없음', 'Never featured', 'ピックアップなし'],
  'st.empty': ['해당 조건의 니케가 없습니다.', 'No Nikkes match.', '条件に合うニケがいません。'],
  'st.few': ['적음', 'Low', '少'],
  'st.many': ['많음', 'High', '多'],
  'st.tipCount': [
    (label, v, pct) => `${label} — <b>${v}</b> (${pct}%)`,
    (label, v, pct) => `${label} — <b>${v}</b> (${pct}%)`,
    (label, v, pct) => `${label} — <b>${v}</b> (${pct}%)`,
  ],
  'st.tipCell': [
    (r, c, v) => `${r} × ${c} — <b>${v}</b>명`,
    (r, c, v) => `${r} × ${c} — <b>${v}</b>`,
    (r, c, v) => `${r} × ${c} — <b>${v}</b>体`,
  ],
  'st.tipQuarter': [
    (label, v) => `${label} — <b>${v}</b>명`,
    (label, v) => `${label} — <b>${v}</b>`,
    (label, v) => `${label} — <b>${v}</b>体`,
  ],
  'st.yearLabel': [y => `${y}년`, y => `${y}`, y => `${y}年`],
};

export function t(key, ...args) {
  const row = STR[key];
  if (!row) return key;
  const v = row[LANGS.indexOf(state.lang)] ?? row[0];
  return typeof v === 'function' ? v(...args) : v;
}

const STATUS_LABEL = {
  ongoing: { ko: '진행중', en: 'Ongoing', ja: '開催中' },
  upcoming: { ko: '예정', en: 'Upcoming', ja: '予定' },
  ended: { ko: '종료', en: 'Ended', ja: '終了' },
  _none: { ko: '일반', en: 'Regular', ja: '通常' },
};
export const ELEMENT_COLOR = {
  Fire: 'var(--el-fire)', Water: 'var(--el-water)', Wind: 'var(--el-wind)',
  Electronic: 'var(--el-electronic)', Iron: 'var(--el-iron)',
};

/* ── 아이콘 ────────────────────────────────────────────────────
   assets/icons/ 아래 게임 아이콘. */
const ICON_DIR = {
  element: 'element', class: 'class', weapon_type: 'weapon',
  burst: 'burst', rarity: 'rarity',
  // 하모니 큐브만 파일명이 코드가 아니라 게임 tid 다 (assets/icons/cube/1000303.webp)
  cube: 'cube',
};

/* 테두리를 뺀 판(_wob)과 단순화한 판(_simple)이 작은 크기에서 훨씬 잘 읽힌다. */
const ICON_VARIANT = { burst: '_simple', weapon_type: '_simple' };

export function iconSrc(axis, code) {
  if (!code) return null;
  /* 오버스펙(corporation_sub_type)은 기업 아이콘에 섞지 않고 별도 도장으로 찍는다 (overspecMark). */
  if (axis === 'corporation') return `assets/icons/company/${String(code).toLowerCase()}_wob.webp`;
  if (axis === 'corporation_sub_type') return `assets/icons/company/${String(code).toLowerCase()}_simple.webp`;
  const dir = ICON_DIR[axis];
  if (!dir) return null;
  const variant = ICON_VARIANT[axis] || '';
  const file = variant && axis === 'weapon_type'
    ? String(code).toUpperCase() : String(code).toLowerCase();
  return `assets/icons/${dir}/${file}${variant}.webp`;
}

/* 아이콘은 항상 텍스트 라벨 옆에 붙는 장식이라 alt 는 비운다. */
export function iconEl(axis, code, opts = {}) {
  const src = iconSrc(axis, code);
  if (!src) return null;
  const img = document.createElement('img');
  img.className = 'ic' + (opts.cls ? ' ' + opts.cls : '');
  img.dataset.axis = axis;   // 테마별 실루엣 보정을 CSS 에서 걸기 위한 훅
  img.src = src;
  img.alt = '';
  img.loading = 'lazy';
  img.decoding = 'async';
  img.onerror = () => img.remove();
  return img;
}

/* 오버스펙 도장 — 소속을 대체하지 않고 그 위에 얹는 표시라 이름 옆에 붙인다. */
export function overspecMark(sub) {
  if (!sub) return null;
  const ic = iconEl('corporation_sub_type', sub, { cls: 'ic-ovr' });
  if (ic) ic.title = L('corporation_sub_type', sub);
  return ic;
}

/* 아이콘 + 텍스트 한 덩어리 */
function labelWith(axis, code, text, opts) {
  const s = el('span', 'iconlbl');
  const ic = iconEl(axis, code, opts);
  if (ic) s.appendChild(ic);
  s.appendChild(el('span', null, text));
  return s;
}

/* nikkes 에만 있는 축 — 픽업 행에 걸 때는 rid 로 니케를 찾아 판정한다 */
const NIKKE_ONLY = ['weapon_type', 'burst', 'rarity'];

const D = { nikkes: [], pickups: [], taxonomy: {}, meta: {} };
const byRid = new Map();
const pickupsByRid = new Map();

const state = {
  tab: 'nikkes',
  lang: localStorage.getItem('lang') || 'ko',
  q: '',
  squad: '', overspec: false, relFrom: '', relTo: '',
  rerun: 'all', timeline: false,
  sort: { key: 'release_date', dir: -1 },
  sel: Object.fromEntries([...Object.keys(AXES), ...Object.keys(PICKUP_AXES)].map(k => [k, new Set()])),
  /* 칩 필터를 펼쳐 둘지 — 탭마다 따로 기억한다. */
  filtersOpen: { nikkes: true, pickups: false, stats: false },
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/* ── 라벨 ─────────────────────────────────────────────────────
   taxonomy -> 현재 언어 -> en -> 원본 코드 순으로 폴백한다. */
export function L(axis, code) {
  if (code == null || code === '') return '—';
  const e = D.taxonomy[axis]?.[code];
  if (!e) return code;
  return e[state.lang] || e.en || code;
}
const nameOf = n => n?.name?.[state.lang] || n?.name?.en || '';
const lang = () => state.lang;

/* ── 로드 ─────────────────────────────────────────────────── */
async function loadFrom(base) {
  const res = await Promise.all(FILES.map(f => fetch(base + f + '.json', { cache: 'no-cache' })));
  const bad = res.find(r => !r.ok);
  if (bad) throw new Error(`${bad.status} ${bad.statusText} — ${bad.url}`);
  const [nikkes, pickups, taxonomy, meta] = await Promise.all(res.map(r => r.json()));
  return { nikkes, pickups, taxonomy, meta };
}

async function load() {
  let data;
  try {
    // 로컬 사본이 있으면 그쪽을 먼저 쓴다(개발 중 / 같은 레포 배치 대응)
    const probe = await fetch(LOCAL + 'meta.json', { cache: 'no-cache' });
    if (!probe.ok) throw 0;
    data = await loadFrom(LOCAL);
  } catch {
    data = await loadFrom(REMOTE);
  }
  Object.assign(D, data);

  D.nikkes.forEach(n => byRid.set(n.rid, n));
  D.pickups.forEach(p => {
    if (!p.rid) return;
    if (!pickupsByRid.has(p.rid)) pickupsByRid.set(p.rid, []);
    pickupsByRid.get(p.rid).push(p);
  });
  D.pickups.forEach(p => {
    p._start = new Date(p.start);
    p._end = new Date(p.end);
  });
}

/* ── 픽업 상태 ─────────────────────────────────────────────── */
function statusOf(p, now = Date.now()) {
  if (p._end.getTime() < now) return 'ended';
  if (p._start.getTime() > now) return 'upcoming';
  return 'ongoing';
}

/* ── 검색 (초성 지원) ──────────────────────────────────────────
   한글 음절은 U+AC00 부터 초성 하나당 588자(중성 21 × 종성 28)씩 연속으로 배치돼 있다. */
const CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const HANGUL_BASE = 0xAC00, PER_CHO = 588;

/* '라피 : 레드 후드' 처럼 구분자가 낀 이름은 '라피레드후드' 로 붙여서 비교한다. */
const compact = s => s.replace(/[\s:·・]/g, '');
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const u = n => '\\u' + n.toString(16).padStart(4, '0');

/* 매처 두 벌을 만든다. */
function buildMatcher(raw) {
  const q = compact(raw.trim());
  if (!q) return null;

  const lower = q.toLowerCase();
  const plain = s => compact(s).toLowerCase().includes(lower);

  const chars = [...q];
  if (!chars.some(c => CHO.includes(c))) return { name: plain, plain };

  const pattern = chars.map(ch => {
    const i = CHO.indexOf(ch);
    if (i < 0) return escapeRe(ch);
    const start = HANGUL_BASE + i * PER_CHO;
    // 자모 그 자체 + 그 초성으로 시작하는 완성형 음절 전체
    return `[${ch}${u(start)}-${u(start + PER_CHO - 1)}]`;
  }).join('');

  let re;
  try { re = new RegExp(pattern, 'i'); } catch { return { name: plain, plain }; }
  return { name: s => re.test(compact(s)), plain };
}

/* state.q 가 바뀔 때만 다시 만든다 (행마다 정규식을 새로 짜지 않게) */
function matcher() {
  if (state._q !== state.q) {
    state._q = state.q;
    state._match = buildMatcher(state.q);
  }
  return state._match;
}

/* 스쿼드는 내부 코드가 아니라 화면에 보이는 표시명으로 찾는다. */
const squadText = code => {
  if (!code) return [];
  const e = D.taxonomy.squad?.[code];
  return e ? [e.ko, e.en, e.ja].filter(Boolean) : [code];
};

/* 니케 하나가 현재 검색어에 걸리는지 — 이름만 초성까지, 스쿼드/별명은 부분 일치 */
function hitsNikke(m, n) {
  return [n.name.ko, n.name.en, n.name.ja].some(v => v && m.name(v))
    || squadText(n.squad).some(m.plain)
    || (n.aliases || []).some(m.plain);
}

/* 계산기 목록(roster.js)도 같은 규칙으로 찾는다 — 탭마다 다르면 'ㄹㅍ' 이 한쪽에서만 걸린다. */
export function nikkeMatcher(q) {
  const m = buildMatcher(q);
  return m ? n => hitsNikke(m, n) : null;
}

/* ── 필터 ─────────────────────────────────────────────────────
   except 로 지정한 축은 건너뛴다 — 칩에 붙는 패싯 카운트 계산용. */
function matchNikke(n, except) {
  for (const axis of Object.keys(AXES)) {
    if (axis === except) continue;
    const sel = state.sel[axis];
    if (sel.size && !sel.has(n[axis])) return false;
  }
  if (state.squad && n.squad !== state.squad) return false;
  if (except !== '_overspec' && state.overspec && n.corporation_sub_type !== 'OVERSPEC') return false;
  if (state.relFrom && (!n.release_date || n.release_date < state.relFrom)) return false;
  if (state.relTo && (!n.release_date || n.release_date > state.relTo)) return false;
  const m = matcher();
  if (m && !hitsNikke(m, n)) return false;
  return true;
}

function matchPickup(p, except) {
  const n = p.rid ? byRid.get(p.rid) : null;

  for (const axis of ['corporation', 'element', 'class']) {
    if (axis === except) continue;
    const sel = state.sel[axis];
    if (sel.size && !sel.has(p[axis])) return false;
  }
  // 니케 리스트에만 있는 축: rid 가 없는 예정 배너는 필연적으로 제외된다
  for (const axis of NIKKE_ONLY) {
    if (axis === except) continue;
    const sel = state.sel[axis];
    if (sel.size && (!n || !sel.has(n[axis]))) return false;
  }
  if (state.squad && (!n || n.squad !== state.squad)) return false;
  if (except !== '_overspec' && state.overspec && p.corporation_sub_type !== 'OVERSPEC') return false;
  if (state.relFrom && (!n || !n.release_date || n.release_date < state.relFrom)) return false;
  if (state.relTo && (!n || !n.release_date || n.release_date > state.relTo)) return false;

  if (except !== 'status' && state.sel.status.size && !state.sel.status.has(statusOf(p))) return false;
  if (except !== 'availability' && state.sel.availability.size && !state.sel.availability.has(p.availability)) return false;
  if (except !== 'tag' && state.sel.tag.size && !state.sel.tag.has(p.tag ?? '_none')) return false;
  if (state.rerun === 'first' && p.rerun_of != null) return false;
  if (state.rerun === 'rerun' && p.rerun_of == null) return false;

  // rid 가 없는 예정 배너는 니케 레코드가 없으므로 시트의 한국어 이름으로만 판정한다
  const m = matcher();
  if (m && !(m.name(p.name_ko) || (n && hitsNikke(m, n)))) return false;
  return true;
}

const filteredNikkes = (except) => D.nikkes.filter(n => matchNikke(n, except));
const filteredPickups = (except) => D.pickups.filter(p => matchPickup(p, except));

/* ── URL 해시 동기화 ───────────────────────────────────────── */
function writeHash() {
  const p = new URLSearchParams();
  if (state.tab !== 'nikkes') p.set('tab', state.tab);
  for (const [k, v] of Object.entries(state.sel)) if (v.size) p.set(k, [...v].join(','));
  if (state.q) p.set('q', state.q);
  if (state.squad) p.set('squad', state.squad);
  if (state.overspec) p.set('overspec', '1');
  if (state.relFrom) p.set('from', state.relFrom);
  if (state.relTo) p.set('to', state.relTo);
  if (state.rerun !== 'all') p.set('rerun', state.rerun);
  const s = p.toString();
  history.replaceState(null, '', s ? '#' + s : location.pathname + location.search);
}

/* 없어진 탭(#tab=raw 같은 옛 북마크)으로 들어오면 패널이 없어 렌더가 깨진다 */
const TABS = ['nikkes', 'pickups', 'stats', 'calc', 'outpost', 'nipago', 'intercept'];

function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (TABS.includes(p.get('tab'))) state.tab = p.get('tab');
  for (const k of Object.keys(state.sel)) {
    const v = p.get(k);
    if (v) state.sel[k] = new Set(v.split(','));
  }
  state.q = p.get('q') || '';
  state.squad = p.get('squad') || '';
  state.overspec = p.get('overspec') === '1';
  state.relFrom = p.get('from') || '';
  state.relTo = p.get('to') || '';
  state.rerun = p.get('rerun') || 'all';
  // 필터가 걸린 링크로 들어왔으면 접힌 칸에 숨기지 않고 펼쳐서 보여준다
  if (activeFilters()) state.filtersOpen[state.tab] = true;
}

/* ── 칩 필터 ───────────────────────────────────────────────── */
function buildChips() {
  const wrap = $('#chipfilters');
  wrap.textContent = '';
  const axes = state.tab === 'pickups'
    ? { ...PICKUP_AXES, ...AXES }
    : AXES;

  for (const [axis, def] of Object.entries(axes)) {
    const row = el('div', 'chiprow');
    row.appendChild(el('span', 'lbl', axisLabel(axis)));
    for (const code of def.order) {
      const b = el('button', 'chip');
      b.type = 'button';
      b.dataset.axis = axis;
      b.dataset.code = code;
      b.setAttribute('aria-pressed', state.sel[axis].has(code));
      const ic = iconEl(axis, code);
      if (ic) b.appendChild(ic);
      b.appendChild(el('span', null, chipLabel(axis, code)));
      b.appendChild(el('span', 'n'));
      row.appendChild(b);
    }
    // 오버스펙은 기업을 대체하지 않는 부가 속성이라 기업 행에 붙인다
    if (axis === 'corporation') {
      const b = el('button', 'chip chip-ovr');
      b.type = 'button';
      b.dataset.axis = '_overspec';
      b.dataset.code = 'OVERSPEC';
      b.setAttribute('aria-pressed', state.overspec);
      const ic = iconEl('corporation_sub_type', 'OVERSPEC');
      if (ic) b.appendChild(ic);
      b.appendChild(el('span', null, L('corporation_sub_type', 'OVERSPEC')));
      b.appendChild(el('span', 'n'));
      row.appendChild(b);
    }
    wrap.appendChild(row);
  }
  wrap.onclick = e => {
    const b = e.target.closest('.chip');
    if (!b) return;
    const { axis, code } = b.dataset;
    if (axis === '_overspec') state.overspec = !state.overspec;
    else state.sel[axis].has(code) ? state.sel[axis].delete(code) : state.sel[axis].add(code);
    render();
  };
}

const statusLabel = code => STATUS_LABEL[code]?.[lang()] ?? code;

function chipLabel(axis, code) {
  if (axis === 'status' || code === '_none') return statusLabel(code);
  return L(axis, code);
}

function updateChipCounts() {
  for (const b of $$('#chipfilters .chip')) {
    const { axis, code } = b.dataset;
    let n;
    if (axis === '_overspec') {
      n = state.tab === 'pickups'
        ? filteredPickups('_overspec').filter(p => p.corporation_sub_type).length
        : filteredNikkes('_overspec').filter(x => x.corporation_sub_type).length;
      b.querySelector('.n').textContent = n;
      b.setAttribute('aria-pressed', state.overspec);
      b.disabled = n === 0 && !state.overspec;
      b.style.opacity = b.disabled ? .4 : '';
      continue;
    }
    if (state.tab === 'pickups') {
      const pool = filteredPickups(axis);
      n = axis in PICKUP_AXES
        ? pool.filter(p => (axis === 'status' ? statusOf(p) : (p[axis] ?? '_none')) === code).length
        : (NIKKE_ONLY.includes(axis)
          ? pool.filter(p => byRid.get(p.rid)?.[axis] === code).length
          : pool.filter(p => p[axis] === code).length);
    } else {
      n = filteredNikkes(axis).filter(x => x[axis] === code).length;
    }
    b.querySelector('.n').textContent = n;
    b.setAttribute('aria-pressed', state.sel[axis].has(code));
    b.disabled = n === 0 && !state.sel[axis].has(code);
    b.style.opacity = b.disabled ? .4 : '';
  }
}

/* ── 니케 표 ───────────────────────────────────────────────── */
const NIKKE_COLS = [
  { key: 'name', str: 'col.name', cls: 'name' },
  { key: 'rarity', axis: 'rarity' },
  { key: 'corporation', axis: 'corporation' },
  { key: 'element', axis: 'element' },
  { key: 'class', axis: 'class' },
  { key: 'weapon_type', axis: 'weapon_type' },
  { key: 'burst', axis: 'burst' },
  { key: 'squad', str: 'col.squad' },
  { key: 'release_date', str: 'col.release', cls: 'num' },
  { key: 'pickups', str: 'col.pickups', cls: 'num' },
];
const colLabel = c => c.axis ? axisLabel(c.axis) : t(c.str);

function sortValue(n, key) {
  if (key === 'name') return nameOf(n);
  if (key === 'pickups') return pickupsByRid.get(n.rid)?.length || 0;
  if (key === 'rarity') return ['R', 'SR', 'SSR'].indexOf(n.rarity);
  const order = AXES[key]?.order;
  if (order) return order.indexOf(n[key]);
  return n[key] ?? '';
}

function renderNikkes() {
  const rows = filteredNikkes().sort((a, b) => {
    const x = sortValue(a, state.sort.key), y = sortValue(b, state.sort.key);
    const c = typeof x === 'number' && typeof y === 'number'
      ? x - y : String(x).localeCompare(String(y), 'ko');
    return c * state.sort.dir || String(nameOf(a)).localeCompare(String(nameOf(b)), 'ko');
  });

  const head = $('#nikkeHead');
  head.textContent = '';
  for (const c of NIKKE_COLS) {
    const th = el('th', c.cls === 'num' ? 'num' : null, colLabel(c));
    if (state.sort.key === c.key) th.appendChild(el('span', 'arrow', state.sort.dir > 0 ? ' ▲' : ' ▼'));
    th.onclick = () => {
      state.sort = state.sort.key === c.key
        ? { key: c.key, dir: -state.sort.dir } : { key: c.key, dir: 1 };
      render();
    };
    head.appendChild(th);
  }

  const body = $('#nikkeBody');
  body.textContent = '';
  const frag = document.createDocumentFragment();
  for (const n of rows) {
    const tr = el('tr');
    tr.onclick = () => openSheet(n);

    const tdName = el('td', 'name');
    tdName.appendChild(el('span', null, nameOf(n)));
    const mark = overspecMark(n.corporation_sub_type);
    if (mark) tdName.appendChild(mark);
    tr.appendChild(tdName);

    tr.appendChild(iconCell('rarity', n.rarity));
    tr.appendChild(iconCell('corporation', n.corporation));
    tr.appendChild(iconCell('element', n.element));
    tr.appendChild(iconCell('class', n.class));
    tr.appendChild(iconCell('weapon_type', n.weapon_type));
    tr.appendChild(iconCell('burst', n.burst));
    tr.appendChild(el('td', null, L('squad', n.squad)));
    tr.appendChild(el('td', 'num', n.release_date || '—'));
    tr.appendChild(el('td', 'num', String(pickupsByRid.get(n.rid)?.length || 0)));
    frag.appendChild(tr);
  }
  body.appendChild(frag);

  $('#nikkeEmpty').hidden = rows.length > 0;
  $('#count').innerHTML = t('cnt.nikkes', rows.length, D.nikkes.length);
}

function iconCell(axis, code, opts) {
  const td = el('td');
  if (!code) { td.textContent = '—'; return td; }
  td.appendChild(labelWith(axis, code, L(axis, code), opts));
  return td;
}

/* ── 픽업 표 / 타임라인 ────────────────────────────────────── */
/* start/end 는 이미 KST 오프셋이 붙은 ISO 문자열이다. */
const fmtDate = iso => iso.slice(0, 10);
const fmtRange = p => `${fmtDate(p.start)} ~ ${fmtDate(p.end)}`;
const dday = p => Math.ceil((p._start.getTime() - Date.now()) / 86400000);
/* 남은 날은 내림이다 — 23시간 남았으면 D-0. */
const ddayEnd = p => Math.max(0, Math.floor((p._end.getTime() - Date.now()) / 86400000));

function statusTag(p) {
  const s = statusOf(p);
  /* 진행 중이면 '진행중' 대신 마감까지 남은 날. */
  const text = s === 'upcoming' ? `${statusLabel('upcoming')} ${t('msg.dday', dday(p))}`
    : s === 'ongoing' ? t('msg.ddayEnd', ddayEnd(p))
      : statusLabel(s);
  const tag = el('span', 'tag ' + (s === 'ongoing' ? 'on' : s === 'upcoming' ? 'soon' : 'off'), text);
  if (s === 'ongoing') tag.title = `${statusLabel('ongoing')} · ~ ${fmtDate(p.end)}`;
  return tag;
}

const PICKUP_COLS = [
  { str: 'col.no', cls: 'num' }, { str: 'col.period' }, { axis: 'status' },
  { str: 'col.name' }, { axis: 'corporation' }, { axis: 'element' }, { axis: 'class' },
  { axis: 'availability' }, { axis: 'tag' }, { str: 'f.rerun' },
];

function renderPickups() {
  const rows = filteredPickups().sort((a, b) => b._start - a._start);

  const head = $('#pickupHead');
  head.textContent = '';
  PICKUP_COLS.forEach(c => head.appendChild(el('th', c.cls || null, colLabel(c))));

  const body = $('#pickupBody');
  body.textContent = '';
  const frag = document.createDocumentFragment();
  for (const p of rows) {
    const n = p.rid ? byRid.get(p.rid) : null;
    const tr = el('tr');
    if (n) tr.onclick = () => openSheet(n);
    else tr.style.cursor = 'default';

    tr.appendChild(el('td', 'num', String(p.no)));
    tr.appendChild(el('td', null, fmtRange(p)));
    const tdS = el('td'); tdS.appendChild(statusTag(p)); tr.appendChild(tdS);

    const tdName = el('td', 'name');
    tdName.appendChild(el('span', null, n ? nameOf(n) : p.name_ko));
    if (!n) tdName.appendChild(el('span', 'sub', ' ' + t('msg.unlisted')));
    const pMark = overspecMark(p.corporation_sub_type);
    if (pMark) tdName.appendChild(pMark);
    tr.appendChild(tdName);

    tr.appendChild(iconCell('corporation', p.corporation));
    tr.appendChild(iconCell('element', p.element));
    tr.appendChild(iconCell('class', p.class));

    const tdA = el('td');
    if (p.availability) {
      tdA.appendChild(el('span', 'tag' + (p.availability === 'limited' ? ' lim' : ''),
        L('availability', p.availability)));
    } else tdA.textContent = '—';
    tr.appendChild(tdA);

    tr.appendChild(el('td', null, p.tag ? L('tag', p.tag) : '—'));
    tr.appendChild(el('td', null, p.rerun_of != null ? t('msg.rerunOf', p.rerun_of) : '—'));
    frag.appendChild(tr);
  }
  body.appendChild(frag);

  renderTimeline(rows);
  $('#pickupTableWrap').hidden = state.timeline;
  $('#timeline').hidden = !state.timeline;
  $('#pickupEmpty').hidden = rows.length > 0;
  $('#count').innerHTML = t('cnt.banners', rows.length, D.pickups.length);
}

function renderTimeline(rows) {
  const tl = $('#timeline');
  tl.textContent = '';
  let year = null;
  for (const p of rows) {
    const y = p._start.getFullYear();
    if (y !== year) { year = y; tl.appendChild(el('div', 'tl-year', t('msg.year', y))); }

    const n = p.rid ? byRid.get(p.rid) : null;
    const row = el('div', 'tl-row' + (statusOf(p) === 'ongoing' ? ' is-on' : ''));
    if (n) row.onclick = () => openSheet(n);

    row.appendChild(el('div', 'when', `${p.start.slice(5, 10)} ~ ${p.end.slice(5, 10)}`));
    const who = el('div', 'who');
    for (const [axis, code] of [['corporation', p.corporation], ['element', p.element], ['class', p.class]]) {
      const ic = iconEl(axis, code);
      if (ic) who.appendChild(ic);
    }
    who.appendChild(el('span', null, n ? nameOf(n) : p.name_ko));
    const tlMark = overspecMark(p.corporation_sub_type);
    if (tlMark) who.appendChild(tlMark);
    if (p.availability === 'limited') who.appendChild(el('span', 'tag lim', L('availability', 'limited')));
    if (p.tag) who.appendChild(el('span', 'tag', L('tag', p.tag)));
    if (p.rerun_of != null) who.appendChild(el('span', 'tag', t('msg.rerunOf', p.rerun_of)));
    who.appendChild(statusTag(p));
    row.appendChild(who);
    tl.appendChild(row);
  }
}

/* ── 상세 시트 ─────────────────────────────────────────────── */
function openSheet(n) {
  const c = $('#sheetContent');
  c.textContent = '';
  const h2 = el('h2', null, nameOf(n));
  const mark = overspecMark(n.corporation_sub_type);
  if (mark) { mark.classList.add('ic-lg'); h2.appendChild(mark); }
  c.appendChild(h2);
  c.appendChild(el('p', 'aka', [n.name.ko, n.name.en, n.name.ja].filter(Boolean).join(' · ')));

  const dl = el('dl', 'kv');
  const put = (k, v) => {
    dl.appendChild(el('dt', null, k));
    const dd = el('dd');
    dd.append(typeof v === 'string' ? v : v);
    dl.appendChild(dd);
  };
  const putIcon = (k, axis, code) => {
    dl.appendChild(el('dt', null, k));
    const dd = el('dd');
    if (!code) dd.textContent = '—';
    else dd.appendChild(labelWith(axis, code, L(axis, code), { cls: 'ic-lg' }));
    dl.appendChild(dd);
  };
  putIcon(axisLabel('rarity'), 'rarity', n.rarity);
  /* 기업 줄에 '(오버스펙)' 을 덧붙이지 않는다 — 이름 옆 도장이 그 자리다 */
  putIcon(axisLabel('corporation'), 'corporation', n.corporation);
  put(t('col.squad'), L('squad', n.squad));
  putIcon(axisLabel('element'), 'element', n.element);
  putIcon(axisLabel('class'), 'class', n.class);
  putIcon(axisLabel('weapon_type'), 'weapon_type', n.weapon_type);
  putIcon(axisLabel('burst'), 'burst', n.burst);
  put(t('col.release'), n.release_date || '—');
  c.appendChild(dl);

  if (n.aliases?.length) {
    c.appendChild(el('h4', null, t('sheet.aliases', n.aliases.length)));
    const box = el('div', 'aliases');
    for (const a of n.aliases) box.appendChild(el('span', 'alias', a));
    c.appendChild(box);
  }

  const hist = (pickupsByRid.get(n.rid) || []).slice().sort((a, b) => a._start - b._start);
  c.appendChild(el('h4', null, t('sheet.history', hist.length)));
  if (!hist.length) {
    c.appendChild(el('p', 'sub', t('msg.noPickup')));
  } else {
    const box = el('div', 'hist');
    for (const p of hist) {
      const it = el('div', 'hist-item');
      const left = el('div');
      left.appendChild(el('span', 'when', fmtRange(p)));
      const right = el('div');
      if (p.rerun_of != null) right.appendChild(el('span', 'tag', t('msg.rerunOf', p.rerun_of)));
      if (p.tag) right.appendChild(el('span', 'tag', L('tag', p.tag)));
      right.appendChild(statusTag(p));
      it.append(left, right);
      box.appendChild(it);
    }
    c.appendChild(box);
  }

  $('#sheet').hidden = false;
}
const closeSheet = () => { $('#sheet').hidden = true; };

/* 필터 오른쪽 칸(싱크로 상한). */
function syncCap(on) {
  const side = $('#synccap');
  side.hidden = !on;
  $('.filters').classList.toggle('split', on);
  if (!on) return;
  import('./synccap.js').then(m => m.renderSyncCap(side, { t, lang: lang(), nikkes: D.nikkes }));
}

/* 접힌 채로도 무엇이 걸려 있는지는 알아야 하므로 단추에 개수를 붙인다. */
function activeFilters() {
  let n = Object.values(state.sel).reduce((s, v) => s + v.size, 0);
  if (state.overspec) n++;
  if (state.squad) n++;
  if (state.relFrom) n++;
  if (state.relTo) n++;
  if (state.rerun !== 'all') n++;
  return n;
}

function paintFold() {
  const open = state.filtersOpen[state.tab] !== false;
  const n = activeFilters();
  $('#filterBody').hidden = !open;
  $('.filters-main').classList.toggle('is-folded', !open);
  const btn = $('#filterToggle');
  btn.setAttribute('aria-expanded', String(open));
  btn.textContent = open ? t('ui.filterClose')
    : n ? `${t('ui.filterOpen')} (${n})` : t('ui.filterOpen');
}

/* ── 렌더 ─────────────────────────────────────────────────── */
function render() {
  $$('.tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === state.tab));
  $('#panel-nikkes').hidden = state.tab !== 'nikkes';
  $('#panel-pickups').hidden = state.tab !== 'pickups';
  $('#panel-stats').hidden = state.tab !== 'stats';
  $('#panel-calc').hidden = state.tab !== 'calc';
  $('#panel-outpost').hidden = state.tab !== 'outpost';
  $('#panel-nipago').hidden = state.tab !== 'nipago';
  $('#panel-intercept').hidden = state.tab !== 'intercept';
  $('#pickupfilters').hidden = state.tab !== 'pickups';
  $('#tlwrap').hidden = state.tab !== 'pickups';
  /* 도구 탭들은 니케/픽업과 별개라서 위쪽 필터가 걸리지 않는다 */
  $('.filters').hidden = ['calc', 'outpost', 'nipago', 'intercept'].includes(state.tab);
  paintFold();
  /* 싱크로 상한 계산기는 니케 리스트 탭에서만. */
  syncCap(state.tab === 'nikkes');

  if (state.tab === 'nipago') {
    writeHash();
    import('./nipago.js').then(m => m.renderNipago($('#nipago'), { t, L, lang: lang() }));
    return;
  }
  if (state.tab === 'intercept') {
    writeHash();
    import('./intercept.js').then(m => m.renderIntercept($('#intercept'), { t, L, lang: lang() }));
    return;
  }
  if (state.tab === 'outpost') {
    writeHash();
    import('./outpost.js').then(m => m.renderOutpost($('#outpost'), { t, L, lang: lang(), iconEl }));
    return;
  }
  if (state.tab === 'calc') {
    writeHash();
    import('./calc.js').then(m => m.renderCalc($('#calc'),
      { t, L, lang: lang(), nikkes: D.nikkes, byRid, nameOf, iconEl, overspecMark, nikkeMatcher,
        // 계산기에서 오버로드 옵션을 니파고 탭으로 넘길 때 탭을 갈아 준다
        goTab }));
    return;
  }

  updateChipCounts();

  if (state.tab === 'nikkes') renderNikkes();
  else if (state.tab === 'pickups') renderPickups();
  else {
    const ns = filteredNikkes(), ps = filteredPickups();
    $('#count').innerHTML = t('cnt.both', ns.length, ps.length);
    renderStats($('#stats'), ns, ps,
      { L, t, axisLabel, statusLabel, lang: lang(), statusOf, AXES, ELEMENT_COLOR, byRid, iconEl });
  }
  writeHash();
}

/* 탭 갈아 끼우기 — 탭 단추와, 탭끼리 자료를 넘기는 쪽(계산기 -> 니파고)이 같이 쓴다. */
function goTab(tab) {
  if (!TABS.includes(tab)) return;
  state.tab = tab;
  buildChips();
  render();
}

/* ── 초기화 ───────────────────────────────────────────────── */
function wire() {
  $$('.tabs button').forEach(b => b.onclick = () => goTab(b.dataset.tab));

  let fillSquads;   // 스쿼드 옵션 재생성 (아래에서 채워짐)

  /* index.html 의 data-i18n* 속성을 현재 언어로 채운다. */
  const paintStatic = () => {
    $$('[data-i18n]').forEach(n => { n.textContent = t(n.dataset.i18n); });
    $$('[data-i18n-placeholder]').forEach(n => { n.placeholder = t(n.dataset.i18nPlaceholder); });
    $$('[data-i18n-title]').forEach(n => { n.title = t(n.dataset.i18nTitle); });
    $$('[data-i18n-aria]').forEach(n => { n.setAttribute('aria-label', t(n.dataset.i18nAria)); });
  };

  const paintLang = () => {
    $$('.langswitch button').forEach(x => x.classList.toggle('on', x.dataset.lang === state.lang));
    document.documentElement.lang = state.lang;
    document.title = t('app.title');
    paintStatic();
    $('#metaline').textContent = t('ui.meta', D.meta);
    paintTheme();
    fillSquads?.();
  };
  $$('.langswitch button').forEach(b => b.onclick = () => {
    state.lang = b.dataset.lang;
    localStorage.setItem('lang', state.lang);
    paintLang();
    buildChips();
    render();
  });
  paintLang();

  /* 테마 — 기본 라이트. */
  function paintTheme() {
    const dark = document.documentElement.dataset.theme === 'dark';
    $('#themeIcon').textContent = dark ? '☀' : '☾';
    $('#theme').setAttribute('aria-pressed', dark);
    $('#theme').setAttribute('aria-label', t(dark ? 'ui.toLight' : 'ui.toDark'));
  }
  $('#theme').onclick = () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('theme', next);
    paintTheme();
    // 차트는 토큰을 JS 로 읽어 그리므로 테마가 바뀌면 다시 그려야 한다
    if (state.tab === 'stats') render();
  };
  paintTheme();

  let qTimer;
  $('#q').oninput = e => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => { state.q = e.target.value.trim(); render(); }, 150);
  };
  $('#q').value = state.q;

  const sq = $('#squad');
  const squadCodes = [...new Set(D.nikkes.map(n => n.squad).filter(Boolean))];
  fillSquads = () => {
    [...sq.querySelectorAll('option[value]:not([value=""])')].forEach(o => o.remove());
    squadCodes
      .slice()
      .sort((a, b) => L('squad', a).localeCompare(L('squad', b), state.lang))
      .forEach(code => {
        const o = el('option', null, L('squad', code));
        o.value = code;
        sq.appendChild(o);
      });
    sq.value = state.squad;
  };
  fillSquads();
  sq.onchange = () => { state.squad = sq.value; render(); };

  $('#relFrom').value = state.relFrom;
  $('#relFrom').onchange = e => { state.relFrom = e.target.value; render(); };
  $('#relTo').value = state.relTo;
  $('#relTo').onchange = e => { state.relTo = e.target.value; render(); };
  $('#rerun').value = state.rerun;
  $('#rerun').onchange = e => { state.rerun = e.target.value; render(); };
  $('#tlview').onchange = e => { state.timeline = e.target.checked; render(); };

  $('#filterToggle').onclick = () => {
    state.filtersOpen[state.tab] = state.filtersOpen[state.tab] === false;
    paintFold();
  };

  $('#reset').onclick = () => {
    Object.keys(state.sel).forEach(k => state.sel[k].clear());
    Object.assign(state, { q: '', squad: '', overspec: false, relFrom: '', relTo: '', rerun: 'all' });
    $('#q').value = ''; sq.value = '';
    $('#relFrom').value = ''; $('#relTo').value = ''; $('#rerun').value = 'all';
    render();
  };

  $$('[data-close]').forEach(n => n.onclick = closeSheet);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
}

(async function main() {
  try {
    readHash();
    await load();
  } catch (err) {
    $('#loading').hidden = true;
    const box = $('#error');
    box.hidden = false;
    box.innerHTML = `<strong>${t('err.title')}</strong><br>`
      + `<code>${String(err.message || err)}</code><br><br>${t('err.hint')}`;
    return;
  }
  $('#loading').hidden = true;
  $('#app').hidden = false;
  wire();
  buildChips();
  render();
})();
