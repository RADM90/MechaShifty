/* 내 계정 — Blablalink 에서 뽑아 온 내 니케 데이터를 계산기에 붙인다.

   데이터를 가져오는 쪽은 이 저장소의 `userscript/mechashifty.user.js`(Tampermonkey)
   또는 같은 코드를 해시로 고정한 북마클릿이다. 여기서는 받은 payload 를 검증하고,
   계산기 입력 형태로 바꾸고, 계정 카드와 보유 니케 목록을 그린다.

   받는 경로는 셋인데 전부 사용자가 직접 시작한다:
     1) JSON 열기      2) 붙여넣기      3) 수집 스크립트가 연 탭에서 postMessage

   3번은 출처(origin)를 확인한다. 계정 데이터라 아무 창이나 밀어 넣을 수 있으면 안 된다.
   반대로 우리가 보내는 준비 신호도 대상 origin 을 명시해서, blablalink 가 아닌 창에는
   애초에 배달되지 않게 한다. */

import { optionLabel, gradeLabel, tierLabel } from './cp.js';

const STORE = 'cp.roster';
const SCHEMA = 'mechashifty.roster/2';
/* 수집 스크립트가 도는 곳. 여기서 온 메시지만 받는다. */
const SENDERS = ['https://www.blablalink.com', 'https://blablalink.com'];
const MAX_NIKKES = 600;

const SLOTS = ['머리', '몸', '팔', '다리'];
const GRADE = /^(?:[0-3]돌|[1-7]코강)$/;
const TIERS = ['', '9티어_기업', '오버로드'];
const OPTIONS = ['우코', '공증', '장탄', '크댐', '크확', '차속', '명중', '방어', '차댐'];
/* 옛 약어 → 지금 약어. 이 이름은 `equip_option.json` 의 열 라벨이자 수집 스크립트가
   내보내는 값이라 데이터의 키다. 이미 받아 둔 JSON·localStorage 를 버리지 않도록
   읽을 때 한 번 눕힌다 ('데미지' 표기를 '대미지' 로 통일하면서 바뀌었다). */
export const OPTION_ALIAS = { 크피: '크댐', 차뎀: '차댐' };
/* 목록에 아이콘으로 찍는 축. 여섯 개를 다 넣으면 11px 로 줄여야 해서 아무것도
   안 보인다. 속성·버스트만 남기고 나머지는 필터 칩과 상세 카드에 맡긴다. */
const AXES = ['element', 'burst'];

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/* ── 정렬 등수 ────────────────────────────────────────────────
   배지로 찍는 칸들은 화면 값이 글자('3돌'·'SR15')라 그대로는 못 센다.
   열마다 '많이 키운 쪽이 큰 수' 가 되는 등수를 따로 매긴다. */

/* 돌파와 코어강화는 한 줄로 이어진 단계다 — 코강은 3돌 다음이라
   0돌(0) … 3돌(3) … 1코강(4) … 7코강(10) 순으로 커진다. */
function gradeRank(g) {
  const core = /^([1-7])코강$/.exec(g);
  if (core) return 3 + Number(core[1]);
  const brk = /^([0-3])돌$/.exec(g);
  return brk ? Number(brk[1]) : -1;
}
/* 소장품은 종류가 먼저(R < SR < 애장품), 같은 종류 안에서 단계. */
const COLL_RANK = { R: 1, SR: 2, 애장품: 3 };
function collRank(c) {
  if (!c || c.kind === 'none') return 0;
  return (COLL_RANK[c.kind] || 0) * 100 + (parseInt(c.level, 10) || 0);
}
/* 장비는 네 부위를 합쳐 한 수로. 등급 한 칸이 강화 단계 전부보다 무겁게
   (오버로드 0강 > 9티어 만강) — 실제로 그쪽이 훨씬 세다. */
const gearRank = gear => gear.reduce(
  (s, g) => s + Math.max(0, TIERS.indexOf(g.tier)) * 20 + (g.enhance || 0), 0);
const int = (v, lo, hi, dflt) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= lo && n <= hi ? n : dflt;
};
const fmt = v => (v == null ? '—' : Math.round(v).toLocaleString());
/* 전투력 세 열은 자릿수가 여섯이라 표를 밀어낸다. 유효숫자 세 자리 + k 로 줄이고
   정확한 값은 hover 로 넘긴다 (447,440 -> 447k · 57,759 -> 57.8k). */
function kfmt(v) {
  if (v == null) return '–';
  const n = Math.round(v);
  if (n < 1000) return String(n);
  const k = n / 1000;
  return (k < 100 ? k.toFixed(1) : String(Math.round(k))) + 'k';
}

/* ── 검증 ─────────────────────────────────────────────────────
   바깥에서 들어온 JSON 이라 형태를 믿지 않는다. 모르는 값은 버리고 기본값으로
   메운다. 여기서 통과한 것만 계산기 입력으로 쓴다. */
export function parseRoster(raw) {
  const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!data || data.schema !== SCHEMA) throw new Error('schema');
  if (!Array.isArray(data.nikkes) || !data.nikkes.length) throw new Error('empty');
  if (data.nikkes.length > MAX_NIKKES) throw new Error('size');

  const acc = data.account || {};
  const res = data.research || {};
  return {
    schema: SCHEMA,
    generated_at: String(data.generated_at || '').slice(0, 40),
    account: {
      synchro_level: int(acc.synchro_level, 1, 1200, null),
      // Unix 초. 니케 서비스 개시 이전이거나 미래면 버린다.
      created_at: int(acc.created_at, 1667000000, Math.floor(Date.now() / 1000) + 86400, null),
      /* 캠페인 진행도 — [모드1][지역3][순번3] 7자리 정수. 전초기지 탭이 해독한다
         (outpost.js decodeProgress). 옛 수집본에는 없어서 null 이 정상값이다. */
      progress_normal_campaign: int(acc.progress_normal_campaign, 1, 9999999, null),
      progress_hard_campaign: int(acc.progress_hard_campaign, 1, 9999999, null),
      outpost_battle_level: int(acc.outpost_battle_level, 1, 9999, null),
    },
    research: {
      common: int(res.common, 0, 999, 0),
      class: pickLevels(res.class),
      corporation: pickLevels(res.corporation),
    },
    nikkes: data.nikkes.map(cleanEntry).filter(Boolean),
  };
}

function pickLevels(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (/^[A-Za-z]{1,12}$/.test(k)) out[k] = int(v, 0, 999, 0);
  }
  return out;
}

function cleanEntry(e) {
  const code = e && int(e.name_code, 1, 999999, null);
  if (!code) return null;
  const s = e.skills || {};
  const c = e.collection || {};
  const cube = e.cube || {};
  return {
    name_code: code,
    level: int(e.level, 1, 1200, 1),
    grade: GRADE.test(e.grade) ? e.grade : '0돌',
    bond: int(e.bond, 1, 999, 1),
    skills: { s1: int(s.s1, 1, 10, 1), s2: int(s.s2, 1, 10, 1), burst: int(s.burst, 1, 10, 1) },
    cube: { tid: int(cube.tid, 1, 99999999, null), level: int(cube.level, 0, 15, 0) },
    collection: {
      kind: ['none', 'R', 'SR', '애장품'].includes(c.kind) ? c.kind : 'none',
      level: /^(\d{1,2}|[0-2]\.0)$/.test(c.level) ? c.level : '0',
    },
    gear: cleanGear(e.gear),
  };
}

function cleanGear(gear) {
  const by = new Map((Array.isArray(gear) ? gear : []).map(g => [g && g.slot, g]));
  return SLOTS.map(slot => {
    const g = by.get(slot) || {};
    const tier = TIERS.includes(g.tier) ? g.tier : '';
    return {
      slot,
      tier,
      enhance: int(g.enhance, 0, 5, 0),
      options: tier === '오버로드' ? cleanOptions(g.options) : [],
    };
  });
}

function cleanOptions(options) {
  return (Array.isArray(options) ? options : [])
    .map(o => (o && OPTION_ALIAS[o.name] ? { ...o, name: OPTION_ALIAS[o.name] } : o))
    .filter(o => o && OPTIONS.includes(o.name) && int(o.level, 1, 15, 0))
    .slice(0, 3)
    .map(o => ({ name: o.name, level: int(o.level, 1, 15, 1) }));
}

/* ── 계산기 입력으로 ──────────────────────────────────────────
   콘솔(리사이클 룸)은 계정 단위 표로 받아 두고, 니케의 클래스·기업에 맞는 줄만
   여기서 골라 넣는다. 호감도 상한은 표에서 오는 값이라 밖에서 받아 자른다. */
export function toInput(entry, nikke, research, bondMax) {
  return {
    rid: nikke.rid,
    level: entry.level,
    grade: entry.grade,
    bond: Math.min(entry.bond, bondMax || entry.bond),
    skills: { ...entry.skills },
    cube: entry.cube.level ? String(entry.cube.level) : '미착용',
    collection: { ...entry.collection },
    console: {
      공용: research.common || 0,
      클래스: research.class[nikke.class] || 0,
      기업: research.corporation[nikke.corporation] || 0,
    },
    gear: entry.gear.map(g => ({ ...g, options: g.options.map(o => ({ ...o })) })),
  };
}

/* ── 저장 ─────────────────────────────────────────────────────
   내 계정 데이터라 서버로 보내지 않는다. 이 브라우저의 localStorage 에만 둔다. */
const save = data => {
  try { localStorage.setItem(STORE, JSON.stringify(data)); } catch { /* 용량 초과 등 */ }
};
const drop = () => { try { localStorage.removeItem(STORE); } catch { /* 무시 */ } };
function restore() {
  try {
    const s = localStorage.getItem(STORE);
    return s ? parseRoster(s) : null;
  } catch { return null; }
}

/* ── 탭 간 수신 ───────────────────────────────────────────────
   수집 스크립트가 이 페이지를 열면, 우리가 준비됐다고 알린 뒤 답신을 받는다.
   준비 신호에는 아무 내용도 담기지 않고, 대상 origin 을 하나씩 지정해서 보낸다. */
let listening = false;
function listen(onData) {
  if (listening) return;
  listening = true;
  window.addEventListener('message', e => {
    if (!SENDERS.includes(e.origin)) return;
    const d = e.data;
    if (!d || d.type !== 'MECHASHIFTY_ROSTER') return;
    try { onData(parseRoster(d.payload)); } catch { onData(null); }
  });

  const opener = window.opener;
  if (!opener) return;
  const ping = () => {
    for (const origin of SENDERS) {
      try { opener.postMessage({ type: 'MECHASHIFTY_READY' }, origin); } catch { /* 닫힌 창 */ }
    }
  };
  ping();
  setTimeout(ping, 1500);
}

/* ── 화면 ─────────────────────────────────────────────────── */
/* 아이콘 칩으로 거를 축. 순서는 app.js 의 AXES 와 맞춘다. */
const CHIP_AXES = {
  class: ['Attacker', 'Defender', 'Supporter'],
  element: ['Fire', 'Water', 'Wind', 'Electronic', 'Iron'],
  burst: ['Step1', 'Step2', 'Step3', 'AllStep'],
  corporation: ['ELYSION', 'MISSILIS', 'TETRA', 'PILGRIM', 'ABNORMAL'],
};

export function renderImport(root, ctx) {
  const t = ctx.t;
  let data = restore();
  let filter = '';
  let cubePick = '';          // '' 전체 · '0' 미착용 · 그 외 tid
  let status = null;          // {text, bad}
  let redrawRows = null;      // 목록 본문만 다시 그리는 함수
  let sort = { key: 'cp', dir: -1 };   // 처음 모습은 전투력 내림차순
  const sel = Object.fromEntries(Object.keys(CHIP_AXES).map(a => [a, new Set()]));

  const paint = () => {
    root.textContent = '';
    root.appendChild(account());
    root.appendChild(table());
  };

  const accept = (fresh, from) => {
    if (!fresh) { status = { text: t('im.bad'), bad: true }; paint(); return; }
    data = fresh;
    save(fresh);
    status = { text: t('im.received', fresh.nikkes.length, from), bad: false };
    /* 콘솔은 계정 값이라, 불러오자마자 지금 고른 니케 기준으로 채워 준다.
       그러지 않으면 카드가 0/0/0 으로 남아 불러온 게 반영 안 된 것처럼 보인다. */
    ctx.applyResearch(fresh.research);
    paint();
  };

  listen(fresh => accept(fresh, t('im.fromScript')));
  if (data) ctx.applyResearch(data.research);

  /* ── 계정 줄 ────────────────────────────────────────────────
     두 줄이면 충분하다 — 계정 요약 + 불러오기 버튼 한 줄, 콘솔 아홉 칸 한 줄.
     콘솔은 공용 1 · 클래스 3 · 기업 5 를 통째로 두고, 어느 줄이 적용되는지는
     고른 니케에 따라 계산기가 알아서 고른다. */
  function account() {
    const box = el('section', 'cp-account');

    const top = el('div', 'cp-acctLine');
    const facts = el('div', 'cp-acctFacts');
    const add = (label, value) => {
      const f = el('span', 'cp-fact');
      f.appendChild(el('span', 'cp-factLbl', label));
      f.appendChild(el('span', 'cp-factVal', value));
      facts.appendChild(f);
    };
    if (data) {
      /* 계정 생성 시각은 여기서 뺐다 — 이 탭에서는 아무 계산에도 안 쓰이고,
         전초기지 탭의 타워 카드가 그 값으로 등반 가능 층을 낸다. */
      add(t('im.synchro'), data.account.synchro_level || '—');
      add(t('im.collected'), data.generated_at ? data.generated_at.slice(0, 10) : '—');
    } else {
      facts.appendChild(el('span', 'cp-acctEmpty', t('im.desc')));
    }
    top.appendChild(facts);
    top.appendChild(buttons());
    box.appendChild(top);

    box.appendChild(consoleRow());
    if (status) {
      box.appendChild(el('p', 'cp-importStatus' + (status.bad ? ' cp-warn' : ''), status.text));
    }
    return box;
  }


  /* 콘솔(리사이클 룸) 아홉 칸. 값은 계산기가 계정 단위로 들고 있고 여기서는
     읽고 쓰기만 한다. 테두리 없는 입력이라 눈으로는 숫자 줄로 보인다. */
  function consoleRow() {
    const wrap = el('div', 'cp-consoleRow');
    wrap.title = `${t('cp.console')} — ${t('cp.consoleHint')}`;
    /* 클래스·기업은 아이콘으로 찍는다. 글자로 쓰면(엘리시온·미실리스…) 아홉 칸이
       한 줄에 안 들어가고, EN/JA 는 더 길어진다. 이름은 hover 로. */
    const group = (label, cells) => {
      const g = el('span', 'cp-consoleGroup');
      if (label) g.appendChild(el('span', 'cp-consoleLbl', label));
      for (const [key, axis, code, get, set] of cells) {
        const name = axis ? ctx.L(axis, code) : t('cp.console_공용');
        const f = el('label', 'cp-consoleField');
        f.title = t('cp.consoleOf', name);
        const ic = axis && ctx.iconEl(axis, code);
        f.appendChild(ic || el('span', 'cp-consoleName', name));
        const i = el('input');
        i.type = 'number';
        i.min = 0; i.max = 999;
        i.value = get() || 0;
        i.dataset.key = key;
        i.setAttribute('aria-label', name);
        i.onchange = () => {
          const v = Math.max(0, Math.min(999, Number(i.value) || 0));
          i.value = v;
          set(v);
        };
        f.appendChild(i);
        g.appendChild(f);
      }
      return g;
    };
    /* '콘솔' 이라는 머리말은 달지 않는다 — 첫 칸이 이미 '공용' 이라 줄의 뜻이
       읽히고, 머리말이 있으면 아홉 칸이 오른쪽으로 밀려 숫자 줄이 어긋난다. */
    wrap.appendChild(group(null, [
      ['common', null, null,
        () => ctx.research().common, v => ctx.setResearch('common', null, v)],
    ]));
    for (const axis of ['class', 'corporation']) {
      wrap.appendChild(group(null, CHIP_AXES[axis].map(code =>
        [`${axis}.${code}`, axis, code,
          () => ctx.research()[axis][code], v => ctx.setResearch(axis, code, v)])));
    }
    return wrap;
  }

  /* 계정 데이터를 새로 받으면 콘솔 칸 값만 갈아 준다 (표를 다시 그리지 않고). */
  const syncConsole = () => {
    const R = ctx.research();
    for (const i of root.querySelectorAll('.cp-consoleField input')) {
      const [kind, code] = i.dataset.key.split('.');
      i.value = (kind === 'common' ? R.common : R[kind][code]) || 0;
    }
  };

  function buttons() {
    const btns = el('div', 'cp-importBtns');

    const file = el('input');
    file.type = 'file';
    file.accept = 'application/json,.json';
    file.hidden = true;
    file.onchange = () => {
      const f = file.files && file.files[0];
      if (!f) return;
      f.text().then(text => accept(parseRoster(text), f.name)).catch(() => accept(null));
      file.value = '';
    };
    const open = el('button', 'btn-reset', t('im.file'));
    open.type = 'button';
    open.onclick = () => file.click();
    btns.append(open, file);

    const paste = el('button', 'btn-reset', t('im.paste'));
    paste.type = 'button';
    paste.onclick = () => {
      if (root.querySelector('.cp-importPaste')) return;
      const wrap = el('div', 'cp-importPaste');
      const ta = el('textarea');
      ta.rows = 3;
      ta.placeholder = t('im.pasteHint');
      const ok = el('button', 'btn-reset', t('im.pasteOk'));
      ok.type = 'button';
      ok.onclick = () => {
        try { accept(parseRoster(ta.value.trim()), t('im.fromPaste')); } catch { accept(null); }
      };
      wrap.append(ta, ok);
      btns.closest('.cp-account').appendChild(wrap);
      ta.focus();
    };
    btns.appendChild(paste);

    /* 자료를 한 번이라도 불러온 사람은 이미 설치를 끝낸 사람이다. 그 뒤로 설치
       안내를 문장으로 계속 세워 두면 자리만 차지하니 물음표 한 칸으로 접는다.
       아직 자료가 없을 때 — 즉 그 안내가 정말 필요한 때 — 만 펼쳐 둔다. */
    const guide = el('a', data ? 'cp-importHelp' : 'cp-importLink',
      data ? '?' : `${t('im.guide')} →`);
    /* 안내서는 언어별로 파일이 갈려 있다 (한국어가 USER_GUIDE.md, 나머지는 접미사). */
    const guideFile = ctx.lang === 'ko' ? 'USER_GUIDE.md' : `USER_GUIDE.${ctx.lang}.md`;
    guide.href = `https://github.com/RADM90/MechaShifty/blob/main/userscript/${guideFile}`;
    guide.target = '_blank';
    guide.rel = 'noopener noreferrer';
    guide.title = data ? `${t('im.guide')}\n${t('im.local')}` : t('im.local');
    guide.setAttribute('aria-label', t('im.guide'));
    btns.appendChild(guide);

    if (data) {
      const clear = el('button', 'btn-reset', t('im.clear'));
      clear.type = 'button';
      clear.title = t('im.clearTitle');
      clear.onclick = () => { drop(); data = null; status = null; paint(); };
      btns.appendChild(clear);
    }
    return btns;
  }

  /* ── 니케 목록 ────────────────────────────────────────────── */

  /* 전체 니케를 한 줄씩. 보유한 것은 전투력을 계산하고, 미보유는 CP 자리를 비운다.
     정렬은 그리는 쪽(redrawRows)이 맡고 여기서는 이름순으로만 놓는다 — 정렬이
     안정적이라, 값이 같은 줄끼리는 이 순서가 그대로 남는다.
     사이트가 모르는 name_code(갓 나온 니케)는 계산할 근거가 없어 세어서 알린다. */
  function rows() {
    const owned = new Map();
    let unknown = 0;
    for (const e of data ? data.nikkes : []) {
      const n = ctx.byCode.get(e.name_code);
      if (n) owned.set(n.rid, e); else unknown++;
    }

    const out = [];
    for (const n of ctx.nikkes) {
      const e = owned.get(n.rid);
      const row = { nikke: n, entry: e || null, name: ctx.nameOf(n), cp: null, adj: [], ol: null };
      if (e) {
        row.input = toInput(e, n, data.research, ctx.bondMax);
        /* 우공합은 칸에도 정렬에도 쓰인다. 비교할 때마다 다시 뽑으면 낭비라
           여기서 한 번만 모아 둔다. */
        row.ol = (ctx.olTotals ? ctx.olTotals(e.gear) : []).filter(o => OL_ATK.includes(o.name));
        const cur = ctx.cpOf(row.input);
        if (cur) {
          row.cp = cur.cp;
          row.adj = ctx.levels.map(lv => ctx.cpOf(row.input, lv));
        }
      }
      out.push(row);
    }
    out.sort((a, b) => a.name.localeCompare(b.name, ctx.lang));
    return { out, owned: owned.size, unknown };
  }

  /* 검색은 니케 리스트 탭과 같은 함수를 쓴다 — 이름은 초성('ㄹㅍ')·띄어쓰기 무시,
     별명·스쿼드는 부분 일치. 검색어가 바뀔 때만 매처를 새로 만든다. */
  let hits = null, hitsFor = null;
  function matcher() {
    if (hitsFor !== filter) {
      hitsFor = filter;
      const q = filter.trim().toLowerCase();
      hits = !q ? null
        : (ctx.nikkeMatcher && ctx.nikkeMatcher(filter))
          || (n => [n.name.ko, n.name.en, n.name.ja].some(v => v && v.toLowerCase().includes(q)));
    }
    return hits;
  }

  /* 검색어 + 아이콘 칩. 같은 축 안은 OR, 축끼리는 AND — 니케 리스트 탭과 같은 규칙. */
  function keep(r) {
    const m = matcher();
    if (m && !m(r.nikke)) return false;
    for (const [axis, picked] of Object.entries(sel)) {
      if (picked.size && !picked.has(r.nikke[axis])) return false;
    }
    if (cubePick) {
      const cube = r.entry && r.entry.cube;
      const tid = cube && cube.level ? String(cube.tid || 0) : '0';
      if (tid !== cubePick) return false;
    }
    return true;
  }

  /* 니케 리스트 탭의 칩을 그대로 쓰되 라벨을 빼고 아이콘만 남긴다. */
  function chips() {
    const bar = el('div', 'cp-chipBar');
    for (const [axis, codes] of Object.entries(CHIP_AXES)) {
      const group = el('div', 'cp-chipGroup');
      for (const code of codes) {
        const b = el('button', 'chip chip-ic');
        b.type = 'button';
        b.setAttribute('aria-pressed', sel[axis].has(code));
        b.title = ctx.L(axis, code);
        b.setAttribute('aria-label', ctx.L(axis, code));
        const ic = ctx.iconEl(axis, code);
        if (ic) b.appendChild(ic); else b.appendChild(el('span', null, code));
        b.onclick = () => {
          sel[axis].has(code) ? sel[axis].delete(code) : sel[axis].add(code);
          b.setAttribute('aria-pressed', sel[axis].has(code));
          redrawRows();
        };
        group.appendChild(b);
      }
      bar.appendChild(group);
    }
    return bar;
  }

  /* data/cubes.json 은 이름을 세 언어로 들고 있지만 약칭·효과는 우리가 붙인
     문구라 ko/en 만 있다. 그래서 블록째가 아니라 항목 단위로 떨어뜨린다 —
     일본어는 정식 이름 + 영문 약칭·효과가 된다. */
  function cubeInfo(tid) {
    const c = tid && ctx.cubes ? ctx.cubes[tid] : null;
    return c ? { ...c.ko, ...c.en, ...c[ctx.lang] } : null;
  }

  /* 큐브는 아이콘이 없어서 셀렉트. 실제로 장착된 것만 추린다. */
  function cubeSelect() {
    const seen = new Map();
    let none = false;
    for (const e of data ? data.nikkes : []) {
      if (!e.cube.level) { none = true; continue; }
      const tid = String(e.cube.tid || 0);
      if (!seen.has(tid)) seen.set(tid, cubeInfo(tid)?.short || '#' + tid);
    }
    const s = el('select', 'cp-cubeSel');
    const opt = (value, label) => {
      const o = el('option', null, label);
      o.value = value;
      s.appendChild(o);
    };
    opt('', t('im.colCube') + ' · ' + t('f.all'));
    if (none) opt('0', t('cp.none'));
    for (const [tid, name] of [...seen].sort((a, b) => a[1].localeCompare(b[1], ctx.lang))) {
      opt(tid, name);
    }
    s.value = cubePick;
    s.onchange = () => { cubePick = s.value; redrawRows(); };
    return s;
  }

  /* 등급·기업·속성·클래스·무기·버스트를 아이콘만으로. 이름은 왼쪽 열에 이미 있다. */
  function icons(n) {
    const box = el('div', 'cp-rIcons');
    for (const axis of AXES) {
      const ic = ctx.iconEl(axis, n[axis]);
      if (ic) box.appendChild(ic);
    }
    return box;
  }

  /* 장비 4부위를 2×2 로. 위가 머리·몸, 아래가 팔·다리 (구분자 없이 자리로 구분).
     칸 색이 등급이다 — 분홍 오버로드 · 주황 9티어 기업 (게임 시그니처 색). */
  const TIER_CLS = { 오버로드: ' is-ol', '9티어_기업': ' is-t9' };
  function gearGrid(gear) {
    const box = el('div', 'cp-gearGrid');
    for (const slot of SLOTS) {
      const g = gear.find(x => x.slot === slot) || {};
      const cell = el('span', 'cp-gearCell' + (TIER_CLS[g.tier] || ''),
        g.tier ? String(g.enhance) : '·');
      // 부위·옵션 이름은 데이터 키가 한국어라, 보여줄 때는 화면 언어로 옮긴다
      cell.title = `${t('cp.slot_' + slot)} — ${g.tier ? tierLabel(g.tier, t) : t('cp.none')}`
        + (g.options && g.options.length
          ? ' · ' + g.options.map(o => `${optionLabel(o.name, ctx.lang)} Lv.${o.level}`).join(', ') : '');
      box.appendChild(cell);
    }
    return box;
  }

  /* ── 한 칸짜리 배지 ──────────────────────────────────────────
     모양·색으로 종류를, 가운데 숫자로 단계를 나타낸다. 색만으로 뜻을 나르지
     않도록 hover 에 원래 표기(3돌·5코강·SR15…)를 그대로 붙인다. */
  function badge(cls, text, title) {
    const b = el('span', 'cp-badge ' + cls);
    // 두 자리(소장품 15 · 호감도 20…)는 도형 폭을 넘겨서 한 단계 작게 쓴다
    b.appendChild(el('b', text.length > 1 ? 'is-2' : null, text));
    b.title = title;
    return b;
  }

  /* 돌파와 코어강화는 동시에 성립하지 않는다 (코강은 3돌 이후 단계라
     attraction_grade 의 코강 줄은 전부 돌파 3이다) → 배지 하나로 충분하다.
       회색 별 0 · 금색 별 1~3 · 보라 별 코강 1~7                            */
  function gradeCell(grade) {
    const td = el('td', 'cp-rBadge');
    const core = /^([1-7])코강$/.exec(grade);
    const brk = /^([0-3])돌$/.exec(grade);
    const label = gradeLabel(grade, t);      // 데이터 키('3돌')를 화면 언어로
    if (core) td.appendChild(badge('is-star is-core', core[1], label));
    else if (brk) td.appendChild(badge('is-star ' + (brk[1] === '0' ? 'is-none' : 'is-break'), brk[1], label));
    else td.textContent = grade;
    return td;
  }

  /* 소장품. R 파랑 · SR 보라 · 애장품 주황. 애장품은 레벨이 '2.0' 꼴이라 정수만. */
  const COLL_CLS = { R: 'is-r', SR: 'is-sr', 애장품: 'is-fav' };
  function collCell(c) {
    const td = el('td', 'cp-rBadge');
    if (!c || c.kind === 'none') { td.textContent = '–'; return td; }
    const lv = parseInt(c.level, 10) || 0;
    const title = c.kind === '애장품'
      ? `${t('cp.favorite')} ${lv}${t('im.step')}` : `${c.kind}${lv}`;
    td.appendChild(badge('is-round ' + COLL_CLS[c.kind], String(lv), title));
    return td;
  }

  /* 호감도는 종류가 없으니 빨간 하트 하나에 단계만. */
  function bondCell(bond) {
    const td = el('td', 'cp-rBadge');
    td.appendChild(badge('is-heart is-bond', String(bond), t('cp.bond') + ' ' + bond));
    return td;
  }

  /* 우공합 — 오버로드 옵션 종합 중 우코(우월코드 대미지) + 공증(공격력).
     이 둘이 실전 화력을 가르는 옵션이라 목록에서 한 숫자로 보고 싶다. 종합값은
     계산기 상세 카드와 같은 규칙으로 뽑아야 하므로(같은 단계는 합산 후 반올림)
     집계 함수를 calc.js 에서 그대로 받아 쓴다 — 여기서 다시 짜면 두 화면이 어긋난다. */
  const OL_ATK = ['우코', '공증'];
  const pc = o => Math.round(o.total * 100);
  const olSum = ol => (ol && ol.length ? ol.reduce((a, o) => a + pc(o), 0) : null);
  function olAtkCell(ol) {
    const td = el('td', 'num cp-rOlAtk');
    const v = olSum(ol);
    if (v == null) { td.textContent = '–'; return td; }
    td.textContent = v + '%';
    td.title = ol.map(o => `${optionLabel(o.name, ctx.lang)} ${pc(o)}%`).join(' + ');
    return td;
  }

  const cpCell = (v, cls) => {
    const td = el('td', cls, kfmt(v));
    if (v != null) td.title = fmt(v);          // 줄인 표기라 정확한 값은 hover 로
    return td;
  };

  /* 하모니 큐브. 아이콘(assets/icons/cube/<tid>.webp) + 레벨. 종류 이름과 효과는
     data/cubes.json 에서 가져와 hover 로 넘긴다 — 이름을 글자로 쓰면 이 열 하나가
     표 전체를 밀어낸다. 전투력에는 레벨만 들어가서 종류는 표시 전용이다. */
  function cubeCell(cube) {
    const info = cubeInfo(cube.tid);
    if (!cube.level) return el('td', 'cp-rCube', '–');
    const td = el('td', 'cp-rCube');
    const ic = cube.tid && ctx.iconEl('cube', cube.tid);
    if (ic) td.appendChild(ic);
    else if (info) td.appendChild(el('span', 'cp-cubeName', info.short));
    td.appendChild(el('span', 'cp-cubeLv', String(cube.level)));
    td.title = info ? `${info.short} · ${info.name} — ${info.effect}`
      : (cube.tid ? '#' + cube.tid : '');
    return td;
  }

  function table() {
    const box = el('div', 'cp-roster');
    const { out, owned, unknown } = rows();

    const bar = el('div', 'cp-rosterBar');
    const q = el('input');
    q.type = 'search';
    q.placeholder = t('im.filter');
    q.title = t('ui.search');        // 칸이 좁아 초성·별명이 된다는 안내는 hover 로
    q.value = filter;
    q.oninput = () => { filter = q.value; redrawRows(); };
    bar.append(q, chips(), cubeSelect());
    box.appendChild(bar);

    /* 왼쪽은 '무엇을 얼마나 키웠나'(돌파·소장품·호감도·스킬·장비·큐브·우공합),
       오른쪽은 '그래서 전투력이 얼마인가'(레벨·현재·Lv.40·Lv.400). 키운 것들을
       훑다가 오른쪽 끝에서 결과를 읽는 순서다.

       val(r) 은 그 열로 정렬할 때 비교할 수. 미보유 줄은 null 을 돌려주는데,
       어차피 미보유는 열·방향과 무관하게 아래에 고정된다(redrawRows).
       dir0 는 그 열을 처음 눌렀을 때의 방향 — 키운 정도는 큰 쪽부터,
       이름은 가나다순부터 보는 게 자연스럽다. */
    const rank = (axis, v) => CHIP_AXES[axis].indexOf(v);
    const cols = [
      { key: 'name', label: t('im.colNikke'), dir0: 1, val: r => r.name },
      { key: 'basic', label: t('im.colBasic'), dir0: 1,
        val: r => rank('element', r.nikke.element) * 10 + rank('burst', r.nikke.burst) },
      { key: 'grade', label: t('im.colGrade'), title: t('im.colGradeNote'),
        val: r => r.entry && gradeRank(r.entry.grade) },
      { key: 'coll', label: t('im.colColl'), title: t('cp.collection'),
        val: r => r.entry && collRank(r.entry.collection) },
      { key: 'bond', label: t('im.colBond'), val: r => r.entry && r.entry.bond },
      { key: 'skills', label: t('im.colSkills'),
        val: r => r.entry && (r.entry.skills.s1 + r.entry.skills.s2 + r.entry.skills.burst) },
      // 2×2 장비 칸 읽는 법은 상시 노출할 내용이 아니라 열 머리 hover 로만
      { key: 'gear', label: t('im.colGear'), title: t('im.gearNote'),
        val: r => r.entry && gearRank(r.entry.gear) },
      { key: 'cube', label: t('im.colCube'), cls: 'num',
        val: r => r.entry && r.entry.cube.level },
      /* 우코·공증이 하나도 없으면 칸은 '–' 지만 정렬로는 0 이다 — 가장 약한
         쪽이라 오름차순 맨 앞이 맞다. 값을 못 구한 것(전투력)과는 다르다. */
      { key: 'olatk', label: t('im.colOlAtk'), cls: 'num', title: t('im.colOlAtkNote'),
        val: r => r.entry && (olSum(r.ol) || 0) },
      { key: 'level', label: t('im.colLevel'), cls: 'num', val: r => r.entry && r.entry.level },
      { key: 'cp', label: t('cp.cp'), cls: 'num', val: r => r.cp },
      ...ctx.levels.map((lv, i) => ({
        key: 'adj' + lv, label: t('cp.lv', lv), cls: 'num',
        val: r => (r.adj[i] ? r.adj[i].cp : null),
      })),
    ];
    const tbl = el('table', 'grid cp-rosterTable');
    const thead = el('thead'), hr = el('tr');
    thead.appendChild(hr);
    tbl.appendChild(thead);

    /* 머리글은 정렬 화살표를 달고 있어 정렬이 바뀌면 다시 그린다. */
    const drawHead = () => {
      hr.textContent = '';
      for (const c of cols) {
        const th = el('th', c.cls, c.label);
        if (c.title) th.title = c.title;
        const on = sort.key === c.key;
        th.setAttribute('aria-sort', on ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none');
        if (on) th.appendChild(el('span', 'arrow', sort.dir > 0 ? ' ▲' : ' ▼'));
        th.onclick = () => {
          sort = on ? { key: c.key, dir: -sort.dir } : { key: c.key, dir: c.dir0 || -1 };
          drawHead();
          redrawRows();
        };
        hr.appendChild(th);
      }
    };
    drawHead();
    const tb = el('tbody');
    tbl.appendChild(tb);

    const foot = el('p', 'cp-rosterFoot');
    redrawRows = () => {
      tb.textContent = '';
      const col = cols.find(c => c.key === sort.key) || cols[0];
      /* 미보유는 어느 열로 정렬하든 맨 아래에 둔다 — 값이 하나도 없는 줄이
         위로 올라오면 목록을 읽을 수 없다. 값이 빈 칸(null)도 같은 이유로
         방향과 무관하게 뒤로. 같은 값끼리는 정렬이 안정적이라 out 의
         이름순이 그대로 남는다. */
      const shown = out.filter(keep).sort((a, b) => {
        if (!a.entry !== !b.entry) return a.entry ? -1 : 1;
        const x = col.val(a), y = col.val(b);
        if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
        const c = typeof x === 'number' ? x - y : String(x).localeCompare(String(y), ctx.lang);
        return c * sort.dir;
      });
      for (const r of shown) {
        const has = !!r.entry;
        const tr = el('tr', 'cp-rosterRow' + (has ? '' : ' is-unowned'));
        if (has) {
          tr.tabIndex = 0;
          tr.title = t('im.pick');
          const pick = () => {
            ctx.onPick(JSON.parse(JSON.stringify(r.input)));
            syncConsole();        // 고른 니케에 맞는 연구 줄로 콘솔 갱신
          };
          tr.onclick = pick;
          tr.onkeydown = e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
          };
        }

        /* 이름은 열 폭에 맞춰 잘리지만(hover 로 전체), 오버스펙 도장은 그 바깥에
           두어 이름이 길어도 잘려 나가지 않게 한다. */
        const name = el('td', 'cp-rName');
        name.title = r.name;
        const nameBox = el('span', 'cp-rNameBox');
        nameBox.appendChild(el('span', 'cp-rNameTxt', r.name));
        const mark = ctx.overspecMark && ctx.overspecMark(r.nikke.corporation_sub_type);
        if (mark) nameBox.appendChild(mark);
        name.appendChild(nameBox);
        tr.appendChild(name);
        tr.appendChild(el('td')).appendChild(icons(r.nikke));

        if (!has) {
          // 미보유 — 계정에서 온 값이 하나도 없으므로 자리만 비워 둔다
          for (let i = 2; i < cols.length; i++) tr.appendChild(el('td', 'num', '–'));
          tb.appendChild(tr);
          continue;
        }
        const sk = r.entry.skills;
        tr.appendChild(gradeCell(r.entry.grade));
        tr.appendChild(collCell(r.entry.collection));
        tr.appendChild(bondCell(r.entry.bond));
        tr.appendChild(el('td', 'cp-rSkill', `${sk.s1}/${sk.s2}/${sk.burst}`));
        tr.appendChild(el('td')).appendChild(gearGrid(r.entry.gear));
        tr.appendChild(cubeCell(r.entry.cube));
        tr.appendChild(olAtkCell(r.ol));
        tr.appendChild(el('td', 'num', String(r.entry.level)));
        tr.appendChild(cpCell(r.cp, 'num cp-rCp'));
        for (const a of r.adj) tr.appendChild(cpCell(a ? a.cp : null, 'num'));
        tb.appendChild(tr);
      }
      if (!shown.length) {
        const tr = el('tr');
        const td = el('td', 'empty', t('im.noMatch'));
        td.colSpan = cols.length;
        tr.appendChild(td);
        tb.appendChild(tr);
      }
      foot.textContent = t('im.shown', shown.length, owned, out.length)
        + (unknown ? ' · ' + t('im.unknown', unknown) : '');
    };
    redrawRows();

    const scroll = el('div', 'cp-scroll');
    scroll.appendChild(tbl);
    box.appendChild(scroll);
    box.appendChild(foot);
    return box;
  }

  paint();
  /* 계산기가 니케를 바꿨을 때 카드의 콘솔 칸을 맞추라고 부를 수 있게. */
  return { syncConsole };
}
