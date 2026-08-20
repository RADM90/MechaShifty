/* 통계 탭 — 라이브러리 없이 HTML/SVG 로 직접 그린다.
 *
 * 색 규칙 (dataviz):
 *  - 분포 막대는 전부 단일 시리즈 → 한 가지 색(--series-1). 색이 구분을 나르지 않으므로 CVD 문제가 생기지 않는다.
 *  - 속성만 예외로 게임 색을 쓰되, 항상 속성 이름 텍스트를 함께 찍는다. (색 단독으로 정체성을 나르지 않음 = 보조 인코딩 상시 동반)
 *  - 교차표는 단일 색상 순차 램프(파랑, 어두움=적음 → 밝음=많음).
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
function heatmap(rowKeys, colKeys, cellOf, labelRow, labelCol, rowAxis, colAxis) {
  const values = [];
  for (const r of rowKeys) for (const c of colKeys) values.push(cellOf(r, c));
  const max = Math.max(1, ...values);
  const ramp = readRamp();

  const table = el('table', 'hm');
  const thead = el('thead');
  const htr = el('tr');
  htr.appendChild(el('th'));
  for (const c of colKeys) htr.appendChild(axisHead('th', colAxis, c, labelCol(c)));
  thead.appendChild(htr);
  table.appendChild(thead);

  const tb = el('tbody');
  for (const r of rowKeys) {
    const tr = el('tr');
    tr.appendChild(axisHead('th', rowAxis, r, labelRow(r), 'rowh'));
    for (const c of colKeys) {
      const v = cellOf(r, c);
      const td = el('td', v ? null : 'zero', String(v));
      if (v) {
        const step = ramp[Math.round((v / max) * (RAMP_STEPS - 1))];
        td.style.background = step.bg;
        td.style.color = step.ink;
      }
      bindTip(td, t('st.tipCell', labelRow(r), labelCol(c), v));
      tr.appendChild(td);
    }
    tb.appendChild(tr);
  }
  table.appendChild(tb);

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

/* ── 세로 컬럼 차트 (분기별 추이) ──────────────────────────── */
function columnChart(points, fmtTip) {
  const W = 720, H = 190, padL = 26, padR = 6, padT = 10, padB = 26;
  const n = Math.max(1, points.length);
  const max = Math.max(1, ...points.map(p => p.value));
  const iw = W - padL - padR, ih = H - padT - padB;
  const bw = Math.max(3, iw / n - 3);

  const svg = svgEl('svg', {
    class: 'chart', viewBox: `0 0 ${W} ${H}`,
    preserveAspectRatio: 'xMidYMid meet', role: 'img',
  });

  // 눈금선 + y축 라벨
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const v = Math.round(max * i / ticks);
    const y = padT + ih - (v / max) * ih;
    svg.appendChild(svgEl('line', { class: 'gridline', x1: padL, x2: W - padR, y1: y, y2: y }));
    const tx = svgEl('text', { x: padL - 5, y: y + 3, 'text-anchor': 'end' });
    tx.textContent = v;
    svg.appendChild(tx);
  }
  svg.appendChild(svgEl('line', { class: 'axis', x1: padL, x2: W - padR, y1: padT + ih, y2: padT + ih }));

  points.forEach((p, i) => {
    const x = padL + i * (iw / n) + (iw / n - bw) / 2;
    const h = (p.value / max) * ih;
    const g = svgEl('g');
    g.appendChild(svgEl('rect', {
      class: 'mark', x, y: padT + ih - h, width: bw, height: Math.max(p.value ? 2 : 0, h),
    }));
    // 히트 영역은 마크보다 크게
    g.appendChild(svgEl('rect', { class: 'hit', x: padL + i * (iw / n), y: padT, width: iw / n, height: ih }));
    bindTip(g, fmtTip(p));
    svg.appendChild(g);

    if (p.tick) {
      const tx = svgEl('text', { x: x + bw / 2, y: H - 8, 'text-anchor': 'middle' });
      tx.textContent = p.tick;
      svg.appendChild(tx);
    }
  });

  return svg;
}

/* ── 통계 렌더 ────────────────────────────────────────────── */
export function renderStats(root, nikkes, pickups, ctx) {
  const { L, AXES, ELEMENT_COLOR, axisLabel } = ctx;
  makeIcon = ctx.iconEl || null;
  t = ctx.t;
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

  /* 2. 교차표 — 스쿼드 TOP 바로 뒤에 같은 폭으로 세운다. */
  {
    const c = card(t('st.cross', axisLabel('element'), axisLabel('class')), t('st.crossHint'));
    c.classList.add('card-cross');
    c.appendChild(heatmap(
      AXES.element.order, AXES.class.order,
      (r, col) => nikkes.filter(n => n.element === r && n.class === col).length,
      r => L('element', r), col => L('class', col), 'element', 'class',
    ));
    cards.appendChild(c);
  }
  {
    const c = card(t('st.cross', axisLabel('corporation'), axisLabel('weapon_type')), t('st.crossHint'));
    c.classList.add('card-cross');
    c.appendChild(heatmap(
      AXES.corporation.order, AXES.weapon_type.order,
      (r, col) => nikkes.filter(n => n.corporation === r && n.weapon_type === col).length,
      r => L('corporation', r), col => L('weapon_type', col), 'corporation', 'weapon_type',
    ));
    cards.appendChild(c);
  }

  /* 3. 출시 추이 */
  {
    const dated = nikkes.filter(n => n.release_date);
    const pts = [];
    if (dated.length) {
      const years = dated.map(n => +n.release_date.slice(0, 4));
      const y0 = Math.min(...years), y1 = Math.max(...years);
      for (let y = y0; y <= y1; y++) {
        for (let q = 0; q < 4; q++) {
          const value = dated.filter(n => {
            const yy = +n.release_date.slice(0, 4);
            const mm = +n.release_date.slice(5, 7);
            return yy === y && Math.floor((mm - 1) / 3) === q;
          }).length;
          pts.push({ label: `${y} Q${q + 1}`, value, tick: q === 0 ? String(y) : null });
        }
      }
    }
    const c = card(t('st.quarter'), t('st.quarterHint'), true);
    if (pts.length) {
      c.appendChild(columnChart(pts, p => t('st.tipQuarter', p.label, p.value)));
      const byYear = new Map();
      for (const n of dated) {
        const y = n.release_date.slice(0, 4);
        byYear.set(y, (byYear.get(y) || 0) + 1);
      }
      c.appendChild(barList(
        [...byYear.entries()].sort().map(([k, v]) => ({ key: k, label: t('st.yearLabel', k), value: v })),
        dated.length,
      ));
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
  /* '배너 진행 상태' 카드는 없앴다 — 배너 수백 개 중 진행중이 한둘, 예정이 0~1 개고 나머지가 전부 종료라, 시간이
     갈수록 '종료가 거의 100%' 라는 말만 하는 칸이었다. */

  /* 5. 복각 주기 */
  {
    const byNo = new Map(pickups.map(p => [p.no, p]));
    const gaps = [];
    for (const p of pickups) {
      if (p.rerun_of == null) continue;
      const src = byNo.get(p.rerun_of);
      if (!src) continue;
      gaps.push(Math.round((p._start - src._start) / (86400000 * 30.44)));
    }
    const bins = [[0, 6], [6, 12], [12, 18], [18, 24], [24, 36], [36, 999]];
    const items = bins.map(([a, b]) => ({
      key: `${a}`,
      label: t('st.months', a, b === 999 ? null : b),
      value: gaps.filter(g => g >= a && g < b).length,
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
