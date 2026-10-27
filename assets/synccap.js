/* 일자별 싱크로 레벨 상한치 — 니케 리스트 탭 필터 오른쪽 카드.

     상한 = 니케 최대 레벨 + Σ등급  N(등급, 날짜) × (1 + 돌파(등급) × 배수)

   · N(등급, 날짜) = 그 날짜까지 출시된 해당 등급 니케 수.
   · 입력이 날짜 하나뿐이라 카드를 좁게 두고 검색 카드가 폭을 쓰게 한다.

   app.js 와의 결합은 renderSyncCap(root, ctx) 한 곳뿐. */

/* 게임 상수 — 돌파 1단계가 상한에 더해 주는 값. */
const STEP = 1.334;
/* 니케 하나가 도달할 수 있는 최대 레벨 = 상한의 바닥값. */
const BASE = 200;
/* [등급, 최대 돌파 단계] — 고정값이다. */
const RARITIES = [['SSR', 3], ['SR', 2], ['R', 0]];
const STORE = 'synccap.date';

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/* 시트와 같은 자릿수 — 840.336 처럼 3자리까지, 뒤의 0 은 떼고. */
const dec = v => v.toLocaleString(undefined, { maximumFractionDigits: 3 });

const today = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
};

/* 날짜까지 출시된 등급별 니케 수. */
function counts(nikkes, date) {
  const c = Object.fromEntries(RARITIES.map(([r]) => [r, 0]));
  let unknown = 0;
  for (const n of nikkes) {
    const rel = (n.release_date || '').slice(0, 10);
    if (!rel) { unknown++; continue; }
    if (rel <= date && c[n.rarity] != null) c[n.rarity]++;
  }
  return { c, unknown };
}

export function renderSyncCap(root, ctx) {
  const { t, nikkes } = ctx;
  let date = localStorage.getItem(STORE) || today();

  const paint = () => {
    root.textContent = '';
    const { c, unknown } = counts(nikkes, date);
    const rows = RARITIES.map(([r, br]) => ({ r, br, n: c[r], add: c[r] * (1 + br * STEP) }));
    const total = BASE + rows.reduce((s, x) => s + x.add, 0);

    root.appendChild(el('h3', 'sc-title', t('sc.title')));

    const dateRow = el('label', 'field sc-date');
    dateRow.appendChild(el('span', null, t('sc.date')));
    const di = el('input');
    di.type = 'date';
    di.value = date;
    di.onchange = () => {
      date = di.value || today();
      localStorage.setItem(STORE, date);
      paint();
    };
    dateRow.appendChild(di);
    root.appendChild(dateRow);

    /* 등급 3행 + 소계 + 최대 레벨 + 합계. */
    const tbl = el('table', 'sc-tbl');
    const thead = el('thead'), hr = el('tr');
    hr.appendChild(el('th'));
    [['sc.count'], ['sc.break'], ['sc.mult'], ['sc.add', 'sc.addFull']].forEach(([k, full]) => {
      const th = el('th', null, t(k));
      if (full) th.title = t(full);      // 칸이 좁아 머리글을 줄였다
      hr.appendChild(th);
    });
    thead.appendChild(hr); tbl.appendChild(thead);

    const body = el('tbody');
    rows.forEach(x => {
      const tr = el('tr');
      tr.appendChild(el('th', null, x.r));
      tr.appendChild(el('td', null, String(x.n)));
      tr.appendChild(el('td', 'dim', String(x.br)));
      tr.appendChild(el('td', 'dim', String(STEP)));
      tr.appendChild(el('td', null, dec(x.add)));
      body.appendChild(tr);
    });
    tbl.appendChild(body);

    const tfoot = el('tfoot');
    const sub = el('tr', 'sc-sub');
    sub.appendChild(el('th', null, t('sc.subtotal')));
    sub.appendChild(el('td', null, String(rows.reduce((s, x) => s + x.n, 0))));
    const addLbl = el('td', 'dim', t('sc.addTotal'));
    addLbl.colSpan = 2;
    sub.appendChild(addLbl);
    sub.appendChild(el('td', null, dec(total - BASE)));
    tfoot.appendChild(sub);

    const baseRow = el('tr');
    const baseLbl = el('th', null, t('sc.base'));
    baseLbl.colSpan = 4;
    baseRow.appendChild(baseLbl);
    baseRow.appendChild(el('td', null, String(BASE)));
    tfoot.appendChild(baseRow);

    const sum = el('tr', 'sc-total');
    const sumLbl = el('th', null, t('sc.total'));
    sumLbl.colSpan = 4;
    sum.appendChild(sumLbl);
    sum.appendChild(el('td', null, dec(total)));
    tfoot.appendChild(sum);

    tbl.appendChild(tfoot);
    root.appendChild(tbl);

    /* 검색 카드와 높이를 맞추면 아래가 남는다. */
    const note = el('p', 'sc-note', t('sc.how', BASE, STEP));
    if (unknown) note.textContent += ' ' + t('sc.unknown', unknown);
    root.appendChild(note);
  };

  paint();
}
