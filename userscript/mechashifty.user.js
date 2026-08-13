// ==UserScript==
// @name         MechaShifty — 내 니케 데이터 내보내기
// @name:en      MechaShifty — Export my Nikke roster
// @name:ja      MechaShifty — 所持ニケデータの書き出し
// @namespace    https://radm90.github.io/MechaShifty/
// @version      1.3.0
// @description  Blablalink 로그인 상태에서 내 계정의 니케 데이터를 읽어 MechaShifty 전투력 계산기로 넘깁니다. 외부 코드를 일절 불러오지 않습니다.
// @description:en Reads your own Nikke roster from Blablalink and hands it to the MechaShifty CP calculator. Loads no external code.
// @description:ja Blablalink にログインした状態で自分のニケデータを読み取り、MechaShifty 戦闘力計算機に渡します。外部コードは一切読み込みません。
// @author       MechaShifty (RADM90)
// @license      MIT
// @homepageURL  https://github.com/RADM90/MechaShifty
// @supportURL   https://github.com/RADM90/MechaShifty/issues
// @match        https://www.blablalink.com/*
// @run-at       document-idle
// @noframes
// @grant        GM_registerMenuCommand
// ==/UserScript==

/* ─────────────────────────────────────────────────────────────────────────────
 * 한국어 — 이 스크립트가 하는 일과 하지 않는 일. 설치 전에 직접 확인하세요.
 *
 *  하는 일
 *   - blablalink.com 에 로그인된 상태에서 *내* 계정의 니케 목록/상세/전초기지 정보와
 *     프로필 기본 정보(계정 생성 시각·캠페인 진행도)를 game API 로 읽는다
 *     (아래 API_* 상수가 호출하는 주소의 전부다).
 *   - 읽은 값을 MechaShifty 계산기가 쓰는 형태로 바꿔서, 파일 저장 · 클립보드 복사 ·
 *     탭 간 postMessage 중 사용자가 누른 방법으로만 내보낸다.
 *
 *  하지 않는 일
 *   - 외부 스크립트/라이브러리를 받아서 실행하지 않는다. eval, new Function,
 *     <script src>, import() 가 이 파일에 없다. 그래서 이 파일을 한 번 읽어 두면
 *     나중에 원격에서 동작이 바뀌는 일이 없다 ("잠수함 패치" 차단).
 *   - 쿠키·세션·openid 를 결과물에 담지 않는다. openid 는 API 호출 인자로만 쓰고
 *     payload 에 넣지 않는다 (scrub 참고).
 *   - 아무 데도 자동으로 전송하지 않는다. 서버로 올리는 코드 자체가 없다.
 *
 *  참고: 원본 아이디어는 트로니사랑해 님의 북마클릿(NIKKE Data Downloader)이다.
 *  원본과 달리 (1) 원격 코드 주입을 없앴고 (2) 전투력 계산을 스크립트가 하지 않는다.
 *  계산은 MechaShifty 쪽에서 워크북 검증을 거친 공식으로 한다.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * English — what this script does and does not do. Please read before installing.
 *
 *  What it does
 *   - While you are logged in to blablalink.com, reads *your own* account's Nikke
 *     list / details / outpost info and profile basics (account creation time,
 *     campaign progress) through the game API. The API_* constants below are the
 *     complete list of addresses it ever contacts.
 *   - Reshapes what it read into the form the MechaShifty calculator expects, and
 *     exports it only by the route you click: save a file, copy to clipboard, or
 *     postMessage to the calculator tab.
 *
 *  What it does not do
 *   - It never fetches and runs external code. There is no eval, no new Function,
 *     no <script src>, no import() in this file. Read it once and its behaviour
 *     cannot be changed remotely afterwards.
 *   - It never puts cookies, sessions or your openid into the output. The openid
 *     is used only as an API argument and is stripped before export (see scrub).
 *   - It never uploads anything on its own. There is no code here that posts to a
 *     server.
 *
 *  Credit: the original idea is the NIKKE Data Downloader bookmarklet by
 *  트로니사랑해. Unlike the original, this one (1) removes remote code injection
 *  and (2) does not compute combat power itself — MechaShifty does that with a
 *  formula verified against the reference workbook.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 日本語 — このスクリプトがすること・しないこと。導入前にご自身で確認してください。
 *
 *  すること
 *   - blablalink.com にログインした状態で、*自分の* アカウントのニケ一覧・詳細・
 *     前哨基地情報と、プロフィールの基本情報（アカウント作成時刻・キャンペーン
 *     進行度）を game API から読み取る。下の API_* 定数が、接続先アドレスのすべて。
 *   - 読み取った値を MechaShifty 計算機が使う形に変換し、ファイル保存・クリップ
 *     ボードコピー・タブ間 postMessage のうち、利用者が押した方法だけで書き出す。
 *
 *  しないこと
 *   - 外部スクリプト／ライブラリを取得して実行しない。eval・new Function・
 *     <script src>・import() はこのファイルに存在しない。一度読んでおけば、後から
 *     遠隔で挙動が変わることはない。
 *   - Cookie・セッション・openid を成果物に含めない。openid は API 呼び出しの引数
 *     としてのみ使い、payload には入れない（scrub を参照）。
 *   - どこにも自動送信しない。サーバーへアップロードするコード自体が無い。
 *
 *  出典: 元のアイデアは 트로니사랑해 氏のブックマークレット（NIKKE Data
 *  Downloader）。本スクリプトは (1) 遠隔コード注入を廃し、(2) 戦闘力計算を
 *  スクリプト側で行わない点が異なる。計算はワークブックで検証済みの式を用いて
 *  MechaShifty 側が行う。
 * ───────────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  /* ── 화면 문구 (ko / en / ja) ────────────────────────────────
     이 창을 보는 사람은 blablalink 를 쓰는 한·영·일 유저다. 브라우저가 말하는
     언어를 그대로 따르고, 모르는 언어면 영어로 떨어뜨린다. 값이 함수면 인자를
     받아 문장을 만든다. 코드 쪽 주석은 유지보수용이라 한국어로 둔다. */
  const LANG = (() => {
    const want = navigator.languages && navigator.languages.length
      ? navigator.languages : [navigator.language || 'en'];
    for (const raw of want) {
      const w = String(raw).toLowerCase();
      if (w.startsWith('ko')) return 'ko';
      if (w.startsWith('ja')) return 'ja';
      if (w.startsWith('en')) return 'en';
    }
    return 'en';
  })();

  const STR = {
    menu: ['내 니케 데이터 내보내기', 'Export my Nikke roster', '所持ニケデータを書き出す'],
    title: ['MechaShifty 내보내기', 'MechaShifty export', 'MechaShifty 書き出し'],
    /* 예전 문구는 '닉네임·서버 외의 식별자는 담지 않는다' 였는데, 실제로는 닉네임도
       서버도 결과물에 넣지 않는다 (entryOf/account 참고). 문구를 코드에 맞췄다. */
    sub: [
      '내 계정의 니케 데이터만 읽습니다. 닉네임·서버·계정 식별자는 담지 않습니다.',
      'Reads only your own roster. Nickname, server and account identifiers are not included.',
      '自分のアカウントのニケデータだけを読み取ります。ニックネーム・サーバー・アカウント識別子は含みません。',
    ],
    close: ['닫기', 'Close', '閉じる'],

    stepLogin: ['로그인 계정을 확인하는 중…', 'Checking your login…', 'ログイン中のアカウントを確認しています…'],
    stepArea: ['게임 서버를 찾는 중…', 'Looking for your game server…', 'ゲームサーバーを探しています…'],
    stepFound: [
      (n, area) => `보유 니케 ${n}명 · ${area} 서버`,
      (n, area) => `${n} Nikkes · ${area} server`,
      (n, area) => `所持ニケ ${n}体・${area} サーバー`,
    ],
    stepDetails: [
      (done, all) => `상세 정보 ${done} / ${all}…`,
      (done, all) => `Details ${done} / ${all}…`,
      (done, all) => `詳細情報 ${done} / ${all}…`,
    ],
    stepAccount: ['계정 정보를 확인하는 중…', 'Checking account info…', 'アカウント情報を確認しています…'],

    errLogin: [
      '로그인 상태가 아니거나 계정 정보를 읽지 못했습니다.',
      'You are not logged in, or the account info could not be read.',
      'ログインしていないか、アカウント情報を読み取れませんでした。',
    ],
    errArea: [
      '게임 서버를 찾지 못했습니다. 계정 공개 설정을 확인해 주세요.',
      'Could not find your game server — check that your account is set to public.',
      'ゲームサーバーが見つかりません。アカウントの公開設定を確認してください。',
    ],
    errScrub: [
      '내보낼 데이터에 계정 식별자가 남아 있어 중단했습니다.',
      'Stopped: an account identifier was still present in the data to export.',
      '書き出すデータにアカウント識別子が残っていたため中止しました。',
    ],
    failed: [e => `실패: ${e}`, e => `Failed: ${e}`, e => `失敗: ${e}`],

    done: [
      (n, syn) => `니케 ${n}명${syn ? ` · 싱크로 Lv.${syn}` : ''} 을(를) 읽었습니다.\n내보낼 방법을 고르세요.`,
      (n, syn) => `Read ${n} Nikkes${syn ? ` · synchro Lv.${syn}` : ''}.\nPick how to export.`,
      (n, syn) => `ニケ ${n}体${syn ? `・シンクロ Lv.${syn}` : ''} を読み取りました。\n書き出し方法を選んでください。`,
    ],
    btnSend: ['MechaShifty 계산기로 보내기', 'Send to the MechaShifty calculator', 'MechaShifty 計算機に送る'],
    btnFile: ['JSON 파일로 저장', 'Save as a JSON file', 'JSONファイルとして保存'],
    btnCopy: ['클립보드로 복사', 'Copy to clipboard', 'クリップボードにコピー'],
    okFile: [
      '저장했습니다. 계산기의 "내 계정 불러오기"에서 이 파일을 여세요.',
      'Saved. Open it from "Import my account" in the calculator.',
      '保存しました。計算機の「アカウント読み込み」からこのファイルを開いてください。',
    ],
    okCopy: [
      '복사했습니다. 계산기의 붙여넣기 칸에 붙여 넣으세요.',
      'Copied. Paste it into the paste box in the calculator.',
      'コピーしました。計算機の貼り付け欄に貼り付けてください。',
    ],
    errCopy: [
      '복사에 실패했습니다. 파일 저장을 써 주세요.',
      'Copy failed — use the file option instead.',
      'コピーに失敗しました。ファイル保存をご利用ください。',
    ],

    errPopup: [
      '팝업이 차단됐습니다. 허용하거나 파일로 저장해 주세요.',
      'The popup was blocked. Allow popups, or save a file instead.',
      'ポップアップがブロックされました。許可するか、ファイル保存をご利用ください。',
    ],
    waiting: [
      'MechaShifty 탭이 준비되기를 기다리는 중…',
      'Waiting for the MechaShifty tab to be ready…',
      'MechaShifty タブの準備を待っています…',
    ],
    sent: [
      'MechaShifty 로 보냈습니다. 열린 탭에서 확인하세요.',
      'Sent to MechaShifty — check the tab that just opened.',
      'MechaShifty へ送りました。開いたタブで確認してください。',
    ],
    noReply: [
      '응답이 없습니다. 파일로 저장한 뒤 계산기에서 불러와 주세요.',
      'No reply. Save a file and import it in the calculator instead.',
      '応答がありません。ファイルとして保存し、計算機から読み込んでください。',
    ],

    note: [
      '담기는 값: 니케별 레벨·돌파·스킬·장비·큐브·소장품·호감도, 전초기지 연구 레벨, '
        + '싱크로 레벨, 계정 생성 시각. 계산기가 쓰지 않는 값(닉네임·서버·계정 식별자)은 담기지 않습니다.',
      'Included: per-Nikke level, limit break, skills, gear, cube, collection and bond; '
        + 'outpost research levels; synchro level; account creation time. Anything the calculator '
        + 'does not use — nickname, server, account identifiers — is not included.',
      '含まれる値: ニケごとのレベル・凸・スキル・装備・キューブ・コレクション・好感度、'
        + '前哨基地の研究レベル、シンクロレベル、アカウント作成時刻。計算機が使わない値'
        + '（ニックネーム・サーバー・アカウント識別子）は含まれません。',
    ],
  };

  const LANGS = ['ko', 'en', 'ja'];
  const S = (key, ...args) => {
    const row = STR[key];
    const v = row[LANGS.indexOf(LANG)] ?? row[1];
    return typeof v === 'function' ? v(...args) : v;
  };

  /* 전투력 계산기 탭으로 바로 열어야 한다 — 받는 쪽 코드가 그 탭에서 뜬다. */
  const SITE = 'https://radm90.github.io/MechaShifty/#tab=calc';
  const SITE_ORIGIN = 'https://radm90.github.io';
  const SCHEMA = 'mechashifty.roster/2';

  const API_USER = 'https://api.blablalink.com/api/ugc/proxy/standalonesite/User/GetUserInfoNew';
  const API_CHARS = 'https://api.blablalink.com/api/game/proxy/Game/GetUserCharacters';
  const API_DETAILS = 'https://api.blablalink.com/api/game/proxy/Game/GetUserCharacterDetails';
  const API_OUTPOST = 'https://api.blablalink.com/api/game/proxy/Game/GetUserProfileOutpostInfo';
  const API_BASIC = 'https://api.blablalink.com/api/game/proxy/Game/GetUserProfileBasicInfo';

  /* 게임 서버. 어느 서버 계정인지 미리 알 수 없어서 순서대로 찔러 본다. */
  const AREAS = { 81: 'JP', 82: 'NA', 83: 'KR', 84: 'Global', 85: 'SEA', 86: 'TW' };
  const CHUNK = 50;                       // 상세 조회 1회당 캐릭터 수

  /* 전초기지 리사이클 룸 연구. tid -> 계산기의 콘솔 입력 항목. */
  const RESEARCH = {
    1001: ['common', null],
    1101: ['class', 'Attacker'], 1102: ['class', 'Defender'], 1103: ['class', 'Supporter'],
    1201: ['corporation', 'ELYSION'], 1202: ['corporation', 'MISSILIS'],
    1203: ['corporation', 'TETRA'], 1204: ['corporation', 'PILGRIM'],
    1205: ['corporation', 'ABNORMAL'],
  };

  /* 오버로드 옵션 id 는 7자리다: [앞 3자리][종류 2자리][레벨 2자리].
     종류 코드는 MechaShifty 의 옵션 약어로 옮긴다 (data/raw/equip_option.json 기준). */
  const OPTION = {
    '05': '우코', '06': '명중', '07': '장탄', '08': '공증',
    '09': '차댐', '10': '차속', '11': '크확', '12': '크댐', '13': '방어',
  };

  /* 게임 API 의 부위 이름 -> 계산기의 슬롯 이름 */
  const SLOTS = [['head', '머리'], ['torso', '몸'], ['arm', '팔'], ['leg', '다리']];

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ── API ────────────────────────────────────────────────────
  /* 전부 blablalink 자기 API 다. credentials 는 브라우저가 알아서 붙이는 로그인
     쿠키이고, 스크립트가 쿠키를 읽거나 다른 곳으로 보내지 않는다. */
  async function post(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json;charset=UTF-8' },
      body: JSON.stringify(body),
      credentials: 'include',
    });
    return res.json();
  }

  async function myOpenId() {
    const j = await post(API_USER, { game_id: 29080, game_channelid: 131 });
    const raw = j && j.data && j.data.info && j.data.info.intl_openid;
    const m = String(raw || '').match(/(\d{15,})/);
    return m ? m[1] : null;
  }

  /* 서버 탐색. 캐릭터 목록 호출을 그대로 재활용한다 — 어차피 다음 단계에서 쓸
     응답이고, 특정 니케 번호를 상수로 박아 두지 않아도 된다. */
  async function findArea(openId) {
    for (const area of Object.keys(AREAS)) {
      try {
        const j = await post(API_CHARS, { intl_open_id: openId, nikke_area_id: Number(area) });
        if (j.code === 0 && j.data && j.data.characters) return { area: Number(area), list: j.data.characters };
      } catch { /* 다음 서버 */ }
    }
    return null;
  }

  /* 계정 생성 시각. 어느 필드에 들어 있는지 확실하지 않아 응답을 훑어서
     이름이 create/regist 계열인 값 중 니케 서비스 개시(2022-11) 이후의
     Unix 시각처럼 보이는 것을 찾는다. 초·밀리초 둘 다 받는다. */
  const LAUNCH = 1667000000;                         // 2022-10-29
  function findCreatedAt(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 4) return null;
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v === 'object') {
        const hit = findCreatedAt(v, depth + 1);
        if (hit) return hit;
        continue;
      }
      if (!/creat|regist|first_?login|join/i.test(k)) continue;
      let n = Number(v);
      if (!isFinite(n) || n <= 0) continue;
      if (n > 1e12) n = Math.floor(n / 1000);        // 밀리초로 온 경우
      if (n >= LAUNCH && n <= Date.now() / 1000 + 86400) return n;
    }
    return null;
  }

  /* 캠페인 진행도. 7자리 정수 하나로 [모드][지역3][순번3] 이 들어 있다
     (6044044 = 노멀·지역44·44번째). 응답 어디에 실리는지가 판마다 조금씩
     달라서 이름으로 훑는다 — 전초기지 탭이 이 값으로 레벨을 낸다. */
  function findByKey(obj, re, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 4) return null;
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v === 'object') {
        const hit = findByKey(v, re, depth + 1);
        if (hit != null) return hit;
        continue;
      }
      if (re.test(k) && num(v)) return num(v);
    }
    return null;
  }

  /* 계정 생성 시각과 캠페인 진행도는 같은 응답에서 온다 — 한 번만 부른다. */
  async function basicInfo(openId, area) {
    try {
      const j = await post(API_BASIC,
        { intl_open_id: openId, nikke_area_id: area, target_open_id: openId });
      return {
        created_at: findCreatedAt(j),
        progress_normal_campaign: findByKey(j, /^progress_normal_campaign$/i),
        progress_hard_campaign: findByKey(j, /^progress_hard_campaign$/i),
      };
    } catch { return {}; }
  }

  // ── 변환 ───────────────────────────────────────────────────
  const num = v => (typeof v === 'number' && isFinite(v) ? v : 0);

  /* 돌파/코강은 계산기에서 한 칸으로 고른다 (0돌~3돌, 1코강~7코강). */
  function gradeKey(d) {
    const core = num(d.core);
    return core > 0 ? `${core}코강` : `${Math.min(3, num(d.grade))}돌`;
  }

  /* 소장품(R/SR)과 애장품은 tid 앞자리로 갈린다.
       2xxxxxx      -> 애장품, 단계 0~2
       100x1xxxx…   -> 소장품 R, 100x2… -> SR (6번째 자리가 등급) */
  function collectionOf(d) {
    const tid = String(num(d.favorite_item_tid) || '');
    const lv = num(d.favorite_item_lv);
    if (!tid || tid === '0') return { kind: 'none', level: '0' };
    if (tid.startsWith('2')) return { kind: '애장품', level: `${Math.min(2, lv)}.0` };
    if (tid.startsWith('100')) {
      return { kind: tid.charAt(5) === '1' ? 'R' : 'SR', level: String(Math.min(15, lv)) };
    }
    return { kind: 'none', level: '0' };
  }

  /* 장비 4부위. 오버로드인지 9티어 기업인지는 게임 응답에 따로 표시가 없어서
     "오버로드 옵션이 붙어 있으면 오버로드"로 본다. 옵션이 하나도 없는 오버로드
     장비(막 만든 것)는 9티어로 잡히므로, 계산기 화면에서 고칠 수 있게 둔다. */
  function gearOf(d) {
    return SLOTS.map(([api, slot]) => {
      const tid = num(d[`${api}_equip_tid`]);
      const options = [];
      for (let i = 1; i <= 3; i++) {
        const id = String(num(d[`${api}_equip_option${i}_id`]) || '');
        if (id.length !== 7) continue;
        const name = OPTION[id.slice(3, 5)];
        const level = parseInt(id.slice(5, 7), 10);
        if (name && level >= 1 && level <= 15) options.push({ name, level });
      }
      if (!tid) return { slot, tier: '', enhance: 0, options: [] };
      return {
        slot,
        tier: options.length ? '오버로드' : '9티어_기업',
        // 계산기의 강화 단계는 0~5 다.
        enhance: Math.max(0, Math.min(5, num(d[`${api}_equip_lv`]))),
        options,
      };
    });
  }

  /* 계산기가 그리는 데 필요한 값만 남긴다. 화면에 안 나오고 계산에도 안 쓰는
     값은 여기서 버려서 아예 내보내지 않는다. */
  function entryOf(d, levels) {
    const code = num(d.name_code);
    const lv = num(d.harmony_cube_lv);
    return {
      name_code: code,
      level: levels[code] || 1,
      grade: gradeKey(d),
      bond: num(d.attractive_lv) || num(d.attractive_level)
        || num(d.attractive_stat_lv) || num(d.likability_lv) || 1,
      skills: {
        s1: num(d.skill1_lv) || 1,
        s2: num(d.skill2_lv) || 1,
        burst: num(d.ulti_skill_lv) || 1,
      },
      // tid 는 어떤 큐브인지 표시하는 용도. 전투력에는 레벨만 쓰인다.
      cube: { tid: num(d.harmony_cube_tid) || null, level: lv > 0 ? Math.min(15, lv) : 0 },
      // 화면에는 안 나오지만 전투력에 들어가므로 남긴다.
      collection: collectionOf(d),
      gear: gearOf(d),
    };
  }

  /* 리사이클 룸 연구 레벨. 클래스·기업별로 달라서 니케마다 고르는 건
     MechaShifty 쪽에 맡기고, 여기서는 표를 통째로 넘긴다. */
  function researchOf(outpost) {
    const out = { common: 0, class: {}, corporation: {} };
    for (const r of (outpost && outpost.recycle_room_researches) || []) {
      const hit = RESEARCH[num(r.tid)];
      if (!hit) continue;
      const [kind, key] = hit;
      if (kind === 'common') out.common = num(r.lv);
      else out[kind][key] = num(r.lv);
    }
    return out;
  }

  /* 결과물에 계정 식별자가 섞이지 않게 하는 마지막 관문.
     openid 는 API 인자로만 쓰고 여기서 걸러진다. */
  function scrub(payload) {
    const json = JSON.stringify(payload);
    if (/intl_open_?id|open_?id|cookie|session|token/i.test(json)) {
      throw new Error(S('errScrub'));
    }
    return payload;
  }

  // ── 수집 ───────────────────────────────────────────────────
  async function collect(say) {
    say(S('stepLogin'));
    const openId = await myOpenId();
    if (!openId) throw new Error(S('errLogin'));

    say(S('stepArea'));
    const found = await findArea(openId);
    if (!found) throw new Error(S('errArea'));
    const { area, list } = found;

    const levels = {};
    const codes = [];
    for (const c of list) {
      const code = num(c.name_code);
      if (!code) continue;
      codes.push(code);
      levels[code] = num(c.lv) || 1;
    }
    say(S('stepFound', codes.length, AREAS[area]));

    const outpost = await post(API_OUTPOST, { intl_open_id: openId, nikke_area_id: area })
      .then(j => (j.data || {}).outpost_info || null).catch(() => null);

    const nikkes = [];
    for (let i = 0; i < codes.length; i += CHUNK) {
      const chunk = codes.slice(i, i + CHUNK);
      say(S('stepDetails', Math.min(i + CHUNK, codes.length), codes.length));
      const j = await post(API_DETAILS,
        { intl_open_id: openId, nikke_area_id: area, name_codes: chunk });
      for (const d of (j.data || {}).character_details || []) nikkes.push(entryOf(d, levels));
      await sleep(120);           // 연속 호출 간격 (서버 부담 줄이기)
    }

    say(S('stepAccount'));
    const basic = await basicInfo(openId, area);
    return scrub({
      schema: SCHEMA,
      generated_at: new Date().toISOString(),
      account: {
        synchro_level: num(outpost && outpost.synchro_level) || null,
        created_at: basic.created_at || null,           // Unix 초
        /* 전초기지 탭용. 진행도 두 개로 레벨을 계산하고, 게임이 알려준
           outpost_battle_level 과 대조해 어긋나면 경고를 띄운다. */
        progress_normal_campaign: basic.progress_normal_campaign || null,
        progress_hard_campaign: basic.progress_hard_campaign || null,
        outpost_battle_level: num(outpost && outpost.outpost_battle_level) || null,
      },
      research: researchOf(outpost),
      nikkes,
    });
  }

  // ── UI ─────────────────────────────────────────────────────
  const css = `
    #ms-export{position:fixed;inset:0;z-index:2147483647;display:flex;
      align-items:center;justify-content:center;background:rgba(0,0,0,.72);
      font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    #ms-export .ms-box{background:#fff;color:#1b1b1f;border-radius:12px;padding:22px;
      width:min(92vw,420px);box-shadow:0 18px 48px rgba(0,0,0,.45)}
    #ms-export h2{margin:0 0 4px;font-size:16px}
    #ms-export .ms-sub{margin:0 0 16px;font-size:12px;color:#6b7280}
    #ms-export .ms-status{margin:0 0 16px;font-weight:600;min-height:42px;white-space:pre-line}
    #ms-export .ms-note{margin:14px 0 0;font-size:11.5px;color:#6b7280}
    #ms-export button{display:block;width:100%;margin:8px 0 0;padding:11px;border:0;
      border-radius:6px;font-size:14px;font-weight:600;cursor:pointer}
    #ms-export .ms-go{background:#0f766e;color:#fff}
    #ms-export .ms-alt{background:#eef0f4;color:#1b1b1f}
    #ms-export .ms-x{background:transparent;color:#6b7280;font-weight:400}
    #ms-export .ms-err{color:#b91c1c}
  `;

  function panel() {
    const old = document.getElementById('ms-export');
    if (old) old.remove();

    const root = document.createElement('div');
    root.id = 'ms-export';
    const style = document.createElement('style');
    style.textContent = css;
    const box = document.createElement('div');
    box.className = 'ms-box';
    root.append(style, box);

    const h = document.createElement('h2');
    h.textContent = S('title');
    const sub = document.createElement('p');
    sub.className = 'ms-sub';
    sub.textContent = S('sub');
    const status = document.createElement('p');
    status.className = 'ms-status';
    const actions = document.createElement('div');
    const close = document.createElement('button');
    close.className = 'ms-x';
    close.textContent = S('close');
    close.onclick = () => root.remove();
    box.append(h, sub, status, actions, close);

    document.body.appendChild(root);
    return {
      say: (text, bad) => { status.textContent = text; status.className = 'ms-status' + (bad ? ' ms-err' : ''); },
      button: (label, cls, fn) => {
        const b = document.createElement('button');
        b.className = cls;
        b.textContent = label;
        b.onclick = fn;
        actions.appendChild(b);
        return b;
      },
      note: text => {
        const p = document.createElement('p');
        p.className = 'ms-note';
        p.textContent = text;
        box.insertBefore(p, close);
      },
      clear: () => { actions.textContent = ''; },
    };
  }

  function download(payload) {
    const blob = new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const day = payload.generated_at.slice(0, 10);
    a.href = url;
    a.download = `mechashifty_roster_${day}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  /* 탭 간 전달. 여는 쪽이 먼저 말을 걸지 않고, MechaShifty 가 보낸 준비 신호를
     받은 다음 그 출처(origin)로만 보낸다. 대상 origin 을 '*' 로 두면 아무 사이트나
     받아 갈 수 있어서 그렇게 하지 않는다. */
  function handoff(payload, say) {
    const win = window.open(SITE, '_blank');
    if (!win) { say(S('errPopup'), true); return; }

    let sent = false;
    const onMessage = e => {
      if (e.origin !== SITE_ORIGIN) return;
      if (!e.data || e.data.type !== 'MECHASHIFTY_READY') return;
      win.postMessage({ type: 'MECHASHIFTY_ROSTER', payload }, SITE_ORIGIN);
      sent = true;
      say(S('sent'));
      window.removeEventListener('message', onMessage);
    };
    window.addEventListener('message', onMessage);
    say(S('waiting'));

    setTimeout(() => {
      if (sent) return;
      window.removeEventListener('message', onMessage);
      say(S('noReply'), true);
    }, 20000);
  }

  async function run() {
    const ui = panel();
    let payload;
    try {
      payload = await collect(ui.say);
    } catch (e) {
      ui.say(S('failed', e.message), true);
      return;
    }

    const n = payload.nikkes.length;
    const syn = payload.account.synchro_level;
    ui.say(S('done', n, syn));
    ui.clear();
    ui.button(S('btnSend'), 'ms-go', () => handoff(payload, ui.say));
    ui.button(S('btnFile'), 'ms-alt', () => {
      download(payload);
      ui.say(S('okFile'));
    });
    ui.button(S('btnCopy'), 'ms-alt', async () => {
      try {
        await navigator.clipboard.writeText(JSON.stringify(payload));
        ui.say(S('okCopy'));
      } catch { ui.say(S('errCopy'), true); }
    });
    ui.note(S('note'));
  }

  /* 유저스크립트로 설치했으면 Tampermonkey 메뉴에 걸고, 북마클릿으로 실행했으면
     (메뉴 API 가 없으므로) 바로 연다. 같은 파일을 두 방식이 함께 쓴다. */
  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand(S('menu'), run);
  } else {
    run();
  }
})();
