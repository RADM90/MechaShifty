// ==UserScript==
// @name         MechaShifty — 내 니케 데이터 내보내기
// @name:en      MechaShifty — Export my Nikke roster
// @namespace    https://radm90.github.io/MechaShifty/
// @version      1.1.0
// @description  Blablalink 로그인 상태에서 내 계정의 니케 데이터를 읽어 MechaShifty 전투력 계산기로 넘깁니다. 외부 코드를 일절 불러오지 않습니다.
// @description:en Reads your own Nikke roster from Blablalink and hands it to the MechaShifty CP calculator. Loads no external code.
// @author       MechaShifty (RADM90)
// @license      MIT
// @homepageURL  https://github.com/RADM90/MechaShifty
// @supportURL   https://github.com/RADM90/MechaShifty/issues
// @match        https://www.blablalink.com/*
// @run-at       document-idle
// @noframes
// @grant        GM_registerMenuCommand
// ==/UserScript==

/* 이 스크립트가 하는 일과 하지 않는 일 — 설치 전에 직접 확인하세요.
 *
 *  하는 일
 *   - blablalink.com 에 로그인된 상태에서 *내* 계정의 니케 목록/상세/전초기지 정보를
 *     game API 로 읽는다 (아래 API_* 상수가 호출하는 주소의 전부다).
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
 */

(function () {
  'use strict';

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
    '09': '차뎀', '10': '차속', '11': '크확', '12': '크피', '13': '방어',
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

  async function createdAt(openId, area) {
    try {
      const j = await post(API_BASIC,
        { intl_open_id: openId, nikke_area_id: area, target_open_id: openId });
      return findCreatedAt(j);
    } catch { return null; }
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
      throw new Error('내보낼 데이터에 계정 식별자가 남아 있어 중단했습니다.');
    }
    return payload;
  }

  // ── 수집 ───────────────────────────────────────────────────
  async function collect(say) {
    say('로그인 계정을 확인하는 중…');
    const openId = await myOpenId();
    if (!openId) throw new Error('로그인 상태가 아니거나 계정 정보를 읽지 못했습니다.');

    say('게임 서버를 찾는 중…');
    const found = await findArea(openId);
    if (!found) throw new Error('게임 서버를 찾지 못했습니다. 계정 공개 설정을 확인해 주세요.');
    const { area, list } = found;

    const levels = {};
    const codes = [];
    for (const c of list) {
      const code = num(c.name_code);
      if (!code) continue;
      codes.push(code);
      levels[code] = num(c.lv) || 1;
    }
    say(`보유 니케 ${codes.length}명 · ${AREAS[area]} 서버`);

    const outpost = await post(API_OUTPOST, { intl_open_id: openId, nikke_area_id: area })
      .then(j => (j.data || {}).outpost_info || null).catch(() => null);

    const nikkes = [];
    for (let i = 0; i < codes.length; i += CHUNK) {
      const chunk = codes.slice(i, i + CHUNK);
      say(`상세 정보 ${Math.min(i + CHUNK, codes.length)} / ${codes.length}…`);
      const j = await post(API_DETAILS,
        { intl_open_id: openId, nikke_area_id: area, name_codes: chunk });
      for (const d of (j.data || {}).character_details || []) nikkes.push(entryOf(d, levels));
      await sleep(120);           // 연속 호출 간격 (서버 부담 줄이기)
    }

    say('계정 정보를 확인하는 중…');
    return scrub({
      schema: SCHEMA,
      generated_at: new Date().toISOString(),
      account: {
        synchro_level: num(outpost && outpost.synchro_level) || null,
        created_at: await createdAt(openId, area),      // Unix 초
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
    h.textContent = 'MechaShifty 내보내기';
    const sub = document.createElement('p');
    sub.className = 'ms-sub';
    sub.textContent = '내 계정의 니케 데이터를 읽습니다. 닉네임·서버 외의 계정 식별자는 담지 않습니다.';
    const status = document.createElement('p');
    status.className = 'ms-status';
    const actions = document.createElement('div');
    const close = document.createElement('button');
    close.className = 'ms-x';
    close.textContent = '닫기';
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
    if (!win) { say('팝업이 차단됐습니다. 허용하거나 파일로 저장해 주세요.', true); return; }

    let sent = false;
    const onMessage = e => {
      if (e.origin !== SITE_ORIGIN) return;
      if (!e.data || e.data.type !== 'MECHASHIFTY_READY') return;
      win.postMessage({ type: 'MECHASHIFTY_ROSTER', payload }, SITE_ORIGIN);
      sent = true;
      say('MechaShifty 로 보냈습니다. 열린 탭에서 확인하세요.');
      window.removeEventListener('message', onMessage);
    };
    window.addEventListener('message', onMessage);
    say('MechaShifty 탭이 준비되기를 기다리는 중…');

    setTimeout(() => {
      if (sent) return;
      window.removeEventListener('message', onMessage);
      say('응답이 없습니다. 파일로 저장한 뒤 계산기에서 불러와 주세요.', true);
    }, 20000);
  }

  async function run() {
    const ui = panel();
    let payload;
    try {
      payload = await collect(ui.say);
    } catch (e) {
      ui.say('실패: ' + e.message, true);
      return;
    }

    const n = payload.nikkes.length;
    const syn = payload.account.synchro_level;
    ui.say(`니케 ${n}명${syn ? ` · 싱크로 Lv.${syn}` : ''} 을(를) 읽었습니다.\n내보낼 방법을 고르세요.`);
    ui.clear();
    ui.button('MechaShifty 계산기로 보내기', 'ms-go', () => handoff(payload, ui.say));
    ui.button('JSON 파일로 저장', 'ms-alt', () => {
      download(payload);
      ui.say('저장했습니다. 계산기의 "내 계정 불러오기"에서 이 파일을 여세요.');
    });
    ui.button('클립보드로 복사', 'ms-alt', async () => {
      try {
        await navigator.clipboard.writeText(JSON.stringify(payload));
        ui.say('복사했습니다. 계산기의 붙여넣기 칸에 붙여 넣으세요.');
      } catch { ui.say('복사에 실패했습니다. 파일 저장을 써 주세요.', true); }
    });
    ui.note('담기는 값: 니케별 레벨·돌파·스킬·장비·큐브·소장품·호감도, 전초기지 연구 레벨, '
      + '싱크로 레벨, 계정 생성 시각. 계산기가 쓰지 않는 값(닉네임·서버·계정 식별자)은 '
      + '담기지 않습니다.');
  }

  /* 유저스크립트로 설치했으면 Tampermonkey 메뉴에 걸고, 북마클릿으로 실행했으면
     (메뉴 API 가 없으므로) 바로 연다. 같은 파일을 두 방식이 함께 쓴다. */
  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('내 니케 데이터 내보내기', run);
  } else {
    run();
  }
})();
