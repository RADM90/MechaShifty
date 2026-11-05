/* 통계 탭 — 라이브러리 없이 HTML/SVG 로 직접 그린다.
 *
 * 색 규칙 (dataviz):
 *  - 분포 막대는 단일 시리즈라 한 가지 색(--series-1)만 쓴다.
 *  - 속성만 게임 색을 쓰고, 색만으로 구분되지 않게 속성 이름을 항상 같이 찍는다.
 *  - 교차표는 파랑 순차 램프 (어두움=적음 → 밝음=많음).
 */

const NS = 'http://www.w3.org/2000/svg';

/* 아이콘 팩토리와 번역기는 renderStats 의 ctx 로 넘겨받는다 (app.js 와 순환 import 회피) */
let makeIcon = null;
let t = k => k;

/* 순차 램프는 CSS 토큰(--ramp-0 … --ramp-10)에서 읽는다. */
const RAMP_STEPS = 11;

const toRgb = h => {
  const s = h.trim().replace('#', '');
  const f = s.length === 3 ? [...s].map(c => c + c) : s.match(/\w\w/g);
  return f.map(x => parseInt(x, 16));
};
const relLum = h => toRgb(h)
  .map(c => (c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  .reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a, b) => {
  const [x, y] = [relLum(a), relLum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/* 램프 각 스텝마다 두 잉크 중 대비가 높은 쪽을 고른다. */
function readRamp() {
  const cs = getComputedStyle(document.documentElement);
  const inkA = cs.getPropertyValue('--ink').trim();
  const inkB = cs.getPropertyValue('--hm-ink-strong').trim();
  return Array.from({ length: RAMP_STEPS }, (_, i) => {
    const bg = cs.getPropertyValue(`--ramp-${i}`).trim();
    return { bg, ink: contrast(inkA, bg) >= contrast(inkB, bg) ? inkA : inkB };
  });
}

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
const svgEl = (t, attrs = {}) => {
  const n = document.createElementNS(NS, t);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

/* ── 툴팁 ─────────────────────────────────────────────────── */
const tip = () => document.getElementById('tip');
function bindTip(node, html) {
  node.addEventListener('pointerenter', () => {
    const t = tip();
    t.innerHTML = html;
    t.hidden = false;
  });
  node.addEventListener('pointermove', e => {
    const t = tip();
    const pad = 12;
    let x = e.clientX + pad, y = e.clientY + pad;
    const r = t.getBoundingClientRect();
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - pad;
    if (y + r.height > innerHeight - 8) y = e.clientY - r.height - pad;
    t.style.left = x + 'px';
    t.style.top = y + 'px';
  });
  node.addEventListener('pointerleave', () => { tip().hidden = true; });
}

/* ── 카드 ─────────────────────────────────────────────────── */
function card(title, hint, wide) {
  const c = el('div', 'card' + (wide ? ' wide' : ''));
  c.appendChild(el('h3', null, title));
  if (hint) c.appendChild(el('p', 'hint', hint));
  return c;
}

/* ── 가로 막대 (직접 라벨) ─────────────────────────────────── */
function barList(items, total, colorOf, iconAxis) {
  const box = el('div', 'bars');
  const max = Math.max(1, ...items.map(i => i.value));
  for (const it of items) {
    const row = el('div', 'bar-row');
    const k = el('div', 'k');
    const ic = iconAxis && makeIcon ? makeIcon(iconAxis, it.key) : null;
    if (ic) k.appendChild(ic);
    k.appendChild(el('span', null, it.label));
    row.appendChild(k);

    const track = el('div', 'bar-track');
    const fill = el('div', 'bar-fill');
    fill.style.width = (it.value / max * 100).toFixed(1) + '%';
    if (colorOf) fill.style.background = colorOf(it);
    track.appendChild(fill);
    row.appendChild(track);

    const v = el('div', 'v');
    v.appendChild(el('span', null, String(it.value)));
    row.appendChild(v);

    const pct = total ? (it.value / total * 100).toFixed(1) : '0.0';
    bindTip(row, t('st.tipCount', it.label, it.value, pct));
    box.appendChild(row);
  }
  return box;
}

/* 축 머리칸: 아이콘 + 텍스트 (아이콘이 없는 축이면 텍스트만) */
function axisHead(tag, axis, code, text, cls) {
  const th = el(tag, cls);
  const ic = axis && makeIcon ? makeIcon(axis, code) : null;
  if (ic) {
    const w = el('span', 'iconlbl');
    w.append(ic, el('span', null, text));
    th.appendChild(w);
  } else th.textContent = text;
  return th;
}

/* ── 교차 히트맵 ──────────────────────────────────────────── */
/* 합계는 칸으로 만들지 않는다 — 줄 끝·열 아래에 색 없는 숫자만 붙이고, 램프 최댓값에도 넣지 않는다. */
function heatmap(rowKeys, colKeys, cellOf, labelRow, labelCol, rowAxis, colAxis) {
  const grid = rowKeys.map(r => colKeys.map(c => cellOf(r, c)));
  const max = Math.max(1, ...grid.flat());
  const ramp = readRamp();
  const rowSum = grid.map(row => row.reduce((a, v) => a + v, 0));
  const colSum = colKeys.map((_, j) => grid.reduce((a, row) => a + row[j], 0));
  const total = rowSum.reduce((a, v) => a + v, 0);
  const sumCell = (v, tipHtml) => {
    const td = el('td', 'sum', String(v));
    bindTip(td, tipHtml);
    return td;
  };

  const table = el('table', 'hm');
  const thead = el('thead');
  const htr = el('tr');
  htr.appendChild(el('th'));
  for (const c of colKeys) htr.appendChild(axisHead('th', colAxis, c, labelCol(c)));
  htr.appendChild(el('th'));
  thead.appendChild(htr);
  table.appendChild(thead);

  const tb = el('tbody');
  rowKeys.forEach((r, i) => {
    const tr = el('tr');
    tr.appendChild(axisHead('th', rowAxis, r, labelRow(r), 'rowh'));
    colKeys.forEach((c, j) => {
      const v = grid[i][j];
      const td = el('td', v ? null : 'zero', String(v));
      if (v) {
        const step = ramp[Math.round((v / max) * (RAMP_STEPS - 1))];
        td.style.background = step.bg;
        td.style.color = step.ink;
      }
      bindTip(td, t('st.tipCell', labelRow(r), labelCol(c), v));
      tr.appendChild(td);
    });
    tr.appendChild(sumCell(rowSum[i], t('st.tipSum', labelRow(r), rowSum[i])));
    tb.appendChild(tr);
  });
  table.appendChild(tb);

  const tf = el('tfoot');
  const ftr = el('tr');
  ftr.appendChild(el('th'));
  colKeys.forEach((c, j) => ftr.appendChild(sumCell(colSum[j], t('st.tipSum', labelCol(c), colSum[j]))));
  ftr.appendChild(sumCell(total, t('st.tipTotal', total)));
  tf.appendChild(ftr);
  table.appendChild(tf);

  const wrap = el('div');
  wrap.style.overflowX = 'auto';
  wrap.appendChild(table);

  const lg = el('div', 'legend');
  const s = el('span');
  s.appendChild(el('span', null, t('st.few')));
  for (const step of [ramp[1], ramp[4], ramp[7], ramp[10]]) {
    const i = document.createElement('i');
    i.style.background = step.bg;
    s.appendChild(i);
  }
  s.appendChild(el('span', null, t('st.many')));
  lg.appendChild(s);
  wrap.appendChild(lg);
  return wrap;
}

/* ── 세로 컬럼 차트 (출시 추이) ──────────────────────────────
 * 픽셀 좌표로 그린다. 폭은 상자 안쪽 폭을 따라가다가, 한 칸이 MIN_SLOT 보다 좁아질 만큼
 * 점이 많으면(월 단위 등) 그 폭에서 멈추고 상자가 가로로 굴러간다.
 * viewBox 를 늘려 맞추지 않는 건 그러면 칸 수에 따라 글자 크기까지 같이 변하기 때문. */
const MIN_SLOT = 24;
function columnChart(points, fmtTip, avail) {
  const H = 230, padL = 34, padR = 8, padT = 12, padB = 42;
  const n = Math.max(1, points.length);
  const W = Math.max(Math.floor(avail), padL + padR + n * MIN_SLOT);
  const iw = W - padL - padR, ih = H - padT - padB;
  const slot = iw / n;
  const bw = Math.max(4, Math.min(48, slot - 4));

  // 눈금은 정수 간격 4칸 — 최댓값이 작을 때 0,1,1,2,2 처럼 겹치지 않게 간격부터 정한다.
  const rawMax = Math.max(1, ...points.map(p => p.value));
  const stepV = Math.ceil(rawMax / 4);
  const top = stepV * 4;

  const svg = svgEl('svg', {
    class: 'chart chart-px', width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img',
    style: `width:${W}px;height:${H}px`,  // svg.chart 의 width:100%/height:auto 를 이긴다
  });

  for (let v = 0; v <= top; v += stepV) {
    const y = padT + ih - (v / top) * ih;
    svg.appendChild(svgEl('line', { class: 'gridline', x1: padL, x2: W - padR, y1: y, y2: y }));
    const tx = svgEl('text', { x: padL - 6, y: y + 4, 'text-anchor': 'end' });
    tx.textContent = v;
    svg.appendChild(tx);
  }
  svg.appendChild(svgEl('line', { class: 'axis', x1: padL, x2: W - padR, y1: padT + ih, y2: padT + ih }));

  points.forEach((p, i) => {
    const x0 = padL + i * slot;
    const x = x0 + (slot - bw) / 2;
    const h = (p.value / top) * ih;
    const g = svgEl('g');
    g.appendChild(svgEl('rect', {
      class: 'mark', x, y: padT + ih - h, width: bw, height: Math.max(p.value ? 2 : 0, h),
    }));
    // 히트 영역은 마크보다 크게
    g.appendChild(svgEl('rect', { class: 'hit', x: x0, y: padT, width: slot, height: ih }));
    bindTip(g, fmtTip(p));
    svg.appendChild(g);

    if (p.tick) {
      const tx = svgEl('text', { x: x0 + slot / 2, y: H - 24, 'text-anchor': 'middle' });
      tx.textContent = p.tick;
      svg.appendChild(tx);
    }
    // 연도 줄은 그해 첫 칸의 왼쪽 끝에서 시작한다 (월 단위에서 가운데 맞추면 옆 칸과 겹친다).
    if (p.tick2) {
      const tx = svgEl('text', { class: 'tick2', x: x0 + 2, y: H - 6, 'text-anchor': 'start' });
      tx.textContent = p.tick2;
      svg.appendChild(tx);
      if (i) svg.appendChild(svgEl('line', { class: 'axis', x1: x0, x2: x0, y1: padT + ih, y2: H - 18 }));
    }
  });

  return svg;
}

/* 출시 추이 기간 단위 — 보는 사람별 편의 설정이라 브라우저에만 둔다. */
const TREND_STORE = 'stats.trendPeriod';
const PERIODS = { month: 1, quarter: 3, half: 6, year: 12 };
let trendPeriod = (() => {
  try { const v = localStorage.getItem(TREND_STORE); if (v in PERIODS) return v; } catch { /* 무시 */ }
  return 'quarter';
})();

/* 서비스 시작일에 같이 풀린 니케 — 출시 추이에 넣으면 첫 칸 하나가 나머지를 눌러 버린다. */
const LAUNCH_DATE = '2022-11-04';

function trendPoints(dated, period) {
  const span = PERIODS[period];
  const per = 12 / span;
  const bucketOf = d => Math.floor(((+d.slice(0, 4)) * 12 + (+d.slice(5, 7) - 1)) / span);
  const counts = new Map();
  for (const n of dated) {
    const b = bucketOf(n.release_date);
    counts.set(b, (counts.get(b) || 0) + 1);
  }
  const keys = [...counts.keys()];
  const b0 = Math.min(...keys), b1 = Math.max(...keys);
  const pts = [];
  for (let b = b0; b <= b1; b++) {
    const y = Math.floor(b / per), sub = b % per;
    const isFirst = b === b0;
    let tick, tick2 = null;
    if (period === 'year') tick = String(y);
    else {
      tick = t('st.tick.' + period, sub + 1);
      // 첫 칸은 그해 끝자락이면 다음 해 라벨과 겹치므로 두 칸 이상 남을 때만 연도를 찍는다.
      if (sub === 0 || (isFirst && per - sub >= 2)) tick2 = String(y);
    }
    pts.push({ label: t('st.plabel.' + period, y, sub + 1), value: counts.get(b) || 0, tick, tick2 });
  }
  return pts;
}

/* renderStats 가 다시 불릴 때 앞선 차트의 관찰자를 끊는다 */
let observers = [];

/* ── 통계 렌더 ────────────────────────────────────────────── */
export function renderStats(root, nikkes, pickups, ctx) {
  const { L, AXES, ELEMENT_COLOR, axisLabel } = ctx;
  makeIcon = ctx.iconEl || null;
  t = ctx.t;
  for (const o of observers) o.disconnect();
  observers = [];
  root.textContent = '';

  root.appendChild(el('p', 'stats-head', t('st.head', nikkes.length, pickups.length)));

  const cards = el('div', 'cards');
  root.appendChild(cards);

  const countBy = (arr, key) => {
    const m = new Map();
    for (const x of arr) {
      const k = typeof key === 'function' ? key(x) : x[key];
      if (k == null || k === '') continue;
      m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
  };

  /* 1. 니케 축별 분포 */
  const dist = ['corporation', 'element', 'class', 'weapon_type', 'burst', 'rarity'];
  for (const axis of dist) {
    const title = t('st.byAxis', axisLabel(axis));
    const m = countBy(nikkes, axis);
    const order = AXES[axis]?.order || [...m.keys()];
    const items = order.filter(k => m.has(k)).map(k => ({ key: k, label: L(axis, k), value: m.get(k) }));
    const c = card(title, t('st.basis', nikkes.length));
    c.appendChild(barList(items, nikkes.length,
      axis === 'element' ? (it => ELEMENT_COLOR[it.key]) : null, axis));
    if (axis === 'element') {
      c.appendChild(Object.assign(el('p', 'hint'), {
        textContent: t('st.elementNote'),
        style: 'margin:10px 0 0',
      }));
    }
    cards.appendChild(c);
  }

  /* 스쿼드 TOP */
  {
    const m = countBy(nikkes, 'squad');
    const items = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
      .map(([k, v]) => ({ key: k, label: L('squad', k), value: v }));
    const c = card(t('st.squadTop'), t('st.squadTotal', m.size));
    c.appendChild(barList(items, nikkes.length));
    cards.appendChild(c);
  }

  /* 2. 교차표 — 스쿼드 TOP 바로 뒤에 같은 폭으로 세운다. 다섯 축의 모든 짝(10개). */
  {
    const crossAxes = ['corporation', 'element', 'class', 'weapon_type', 'burst'];
    for (let i = 0; i < crossAxes.length; i++) {
      for (let j = i + 1; j < crossAxes.length; j++) {
        const ra = crossAxes[i], ca = crossAxes[j];
        const c = card(t('st.cross', axisLabel(ra), axisLabel(ca)), t('st.crossHint'));
        c.classList.add('card-cross');
        c.appendChild(heatmap(
          AXES[ra].order, AXES[ca].order,
          (r, col) => nikkes.filter(n => n[ra] === r && n[ca] === col).length,
          r => L(ra, r), col => L(ca, col), ra, ca,
        ));
        cards.appendChild(c);
      }
    }
  }

  /* 3. 출시 추이 */
  {
    const launch = nikkes.filter(n => n.release_date === LAUNCH_DATE).length;
    const dated = nikkes.filter(n => n.release_date && n.release_date !== LAUNCH_DATE);
    const c = card(t('st.trend'), t('st.trendHint', dated.length, LAUNCH_DATE, launch), true);
    if (dated.length) {
      const seg = el('div', 'ic-seg st-seg');
      const box = el('div', 'chart-scroll');
      let lastW = 0;
      const draw = (force) => {
        const w = box.clientWidth;
        if (!w || (!force && w === lastW)) return;
        lastW = w;
        const pts = trendPoints(dated, trendPeriod);
        box.replaceChildren(columnChart(pts, p => t('st.tipPeriod', p.label, p.value), w));
      };
      const paintSeg = () => {
        seg.replaceChildren();
        for (const k of Object.keys(PERIODS)) {
          const b = el('button', 'ic-segbtn' + (k === trendPeriod ? ' on' : ''), t('st.per.' + k));
          b.type = 'button';
          b.setAttribute('aria-pressed', String(k === trendPeriod));
          b.onclick = () => {
            if (k === trendPeriod) return;
            trendPeriod = k;
            try { localStorage.setItem(TREND_STORE, k); } catch { /* 무시 */ }
            paintSeg();
            draw(true);
            box.scrollLeft = 0;
          };
          seg.appendChild(b);
        }
      };
      paintSeg();
      c.append(seg, box);
      // 탭이 숨어 있으면 폭이 0 이라 그리지 못한다 — 보이는 순간 관찰자가 다시 부른다.
      const ro = new ResizeObserver(() => draw(false));
      ro.observe(box);
      observers.push(ro);
    } else c.appendChild(el('p', 'hint', t('st.empty')));
    cards.appendChild(c);
  }

  /* 4. 픽업 통계 */
  {
    const m = countBy(pickups, 'availability');
    const items = ['standard', 'limited'].filter(k => m.has(k))
      .map(k => ({ key: k, label: L('availability', k), value: m.get(k) }));
    const c = card(t('st.avail'), t('st.basisBanner', pickups.length));
    c.appendChild(barList(items, pickups.length,
      it => it.key === 'limited' ? 'var(--series-2)' : 'var(--series-1)'));
    cards.appendChild(c);
  }
  {
    const m = countBy(pickups, p => p.tag ?? '_none');
    const items = [...m.entries()].sort((a, b) => b[1] - a[1])
      .map(([k, v]) => ({ key: k, label: k === '_none' ? ctx.statusLabel('_none') : L('tag', k), value: v }));
    const c = card(t('st.tagDist'), t('st.basisBanner', pickups.length));
    c.appendChild(barList(items, pickups.length));
    cards.appendChild(c);
  }
  /* 진행 상태 카드는 두지 않는다 — 배너 대부분이 종료라 '종료 ≈ 100%' 만 보여 준다. */

  /* 5. 복각 주기 — 같은 니케의 바로 앞 픽업(최초든 복각이든) 시작일부터 잰다.
   앞 픽업은 필터와 무관하게 전체 배너에서 찾는다 (예: '복각만' 필터에서도 간격이 나와야 한다). */
  {
    const MONTH = 86400000 * 30.44;
    const gaps = [];
    let first = Infinity;
    for (const hist of ctx.pickupsByRid.values()) for (const q of hist) first = Math.min(first, +q._start);
    for (const p of pickups) {
      if (p.rerun_of == null) continue;
      let prev = null;
      for (const q of ctx.pickupsByRid.get(p.rid) || []) {
        if (q._start < p._start && (!prev || q._start > prev._start)) prev = q;
      }
      if (prev) gaps.push(Math.round((p._start - prev._start) / MONTH));
    }
    // 3개월 단위로 서비스 기간 전체를 덮는다 — 서비스가 길어지면 칸이 저절로 늘어난다.
    const cap = Math.max(3, Math.ceil((Date.now() - first) / MONTH / 3) * 3);
    const nb = cap / 3;
    const binOf = g => Math.min(nb - 1, Math.floor(g / 3));
    const items = Array.from({ length: nb }, (_, i) => ({
      key: String(i * 3),
      label: t('st.months', i * 3, i * 3 + 3),
      value: gaps.filter(g => binOf(g) === i).length,
    }));
    const c = card(t('st.gap'), gaps.length
      ? t('st.gapHint', gaps.length, median(gaps))
      : t('st.gapNone'));
    if (gaps.length) c.appendChild(barList(items, gaps.length));
    cards.appendChild(c);
  }

  /* 6. 픽업 없는 니케 */
  {
    const none = nikkes.filter(n => !pickups.some(p => p.rid === n.rid));
    const c = card(t('st.noBanner'), t('st.noBannerHint'));
    c.appendChild(barList([
      { key: 'has', label: t('st.hasBanner'), value: nikkes.length - none.length },
      { key: 'none', label: t('st.hasNoBanner'), value: none.length },
    ], nikkes.length));
    cards.appendChild(c);
  }
}

function median(a) {
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}
