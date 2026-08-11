/* 통계 탭 — 라이브러리 없이 HTML/SVG 로 직접 그린다.
 *
 * 색 규칙 (dataviz):
 *  - 분포 막대는 전부 단일 시리즈 → 한 가지 색(--series-1). 색이 구분을
 *    나르지 않으므로 CVD 문제가 생기지 않는다.
 *  - 속성만 예외로 게임 색을 쓰되, 항상 속성 이름 텍스트를 함께 찍는다.
 *    (색 단독으로 정체성을 나르지 않음 = 보조 인코딩 상시 동반)
 *  - 교차표는 단일 색상 순차 램프(파랑, 어두움=적음 → 밝음=많음).
 */

const NS = 'http://www.w3.org/2000/svg';

/* 참조 파랑 램프. 다크 표면(#0f1e35)에서는 어두운 끝이 0 에 해당한다. */
const RAMP = ['#0d366b', '#104281', '#184f95', '#1c5cab', '#256abf',
  '#2a78d6', '#3987e5', '#5598e7', '#6da7ec', '#86b6ef', '#9ec5f4'];

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
function barList(items, total, colorOf) {
  const box = el('div', 'bars');
  const max = Math.max(1, ...items.map(i => i.value));
  for (const it of items) {
    const row = el('div', 'bar-row');
    row.appendChild(el('div', 'k', it.label));

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
    bindTip(row, `${it.label} — <b>${it.value}</b> (${pct}%)`);
    box.appendChild(row);
  }
  return box;
}

/* ── 교차 히트맵 ──────────────────────────────────────────── */
function heatmap(rowKeys, colKeys, cellOf, labelRow, labelCol) {
  const values = [];
  for (const r of rowKeys) for (const c of colKeys) values.push(cellOf(r, c));
  const max = Math.max(1, ...values);

  const table = el('table', 'hm');
  const thead = el('thead');
  const htr = el('tr');
  htr.appendChild(el('th'));
  for (const c of colKeys) htr.appendChild(el('th', null, labelCol(c)));
  thead.appendChild(htr);
  table.appendChild(thead);

  const tb = el('tbody');
  for (const r of rowKeys) {
    const tr = el('tr');
    tr.appendChild(el('th', 'rowh', labelRow(r)));
    for (const c of colKeys) {
      const v = cellOf(r, c);
      const td = el('td', v ? null : 'zero', String(v));
      if (v) {
        const t = v / max;
        const step = RAMP[Math.min(RAMP.length - 1, Math.round(t * (RAMP.length - 1)))];
        td.style.background = step;
        if (t > 0.62) td.style.color = '#06121f';
      } else {
        td.style.background = 'rgba(255,255,255,.03)';
      }
      bindTip(td, `${labelRow(r)} × ${labelCol(c)} — <b>${v}</b>명`);
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
  s.appendChild(el('span', null, '적음'));
  for (const step of [RAMP[1], RAMP[4], RAMP[7], RAMP[10]]) {
    const i = document.createElement('i');
    i.style.background = step;
    s.appendChild(i);
  }
  s.appendChild(el('span', null, '많음'));
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
  const { L, AXES, ELEMENT_COLOR, statusOf, byRid } = ctx;
  root.textContent = '';

  root.appendChild(Object.assign(el('p', 'stats-head'), {
    textContent: `현재 필터 기준 · 니케 ${nikkes.length}명 · 픽업 배너 ${pickups.length}개`
      + ` — 필터를 바꾸면 아래 모든 차트가 함께 좁혀집니다.`,
  }));

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
  const dist = [
    ['corporation', '기업별 분포'],
    ['element', '속성별 분포'],
    ['class', '클래스별 분포'],
    ['weapon_type', '무기별 분포'],
    ['burst', '버스트별 분포'],
    ['rarity', '등급별 분포'],
  ];
  for (const [axis, title] of dist) {
    const m = countBy(nikkes, axis);
    const order = AXES[axis]?.order || [...m.keys()];
    const items = order.filter(k => m.has(k)).map(k => ({ key: k, label: L(axis, k), value: m.get(k) }));
    const c = card(title, `${nikkes.length}명 기준`);
    c.appendChild(barList(items, nikkes.length,
      axis === 'element' ? (it => ELEMENT_COLOR[it.key]) : null));
    if (axis === 'element') {
      c.appendChild(Object.assign(el('p', 'hint'), {
        textContent: '색은 게임 내 속성색이며, 항상 속성 이름과 함께 표시됩니다.',
        style: 'margin:10px 0 0',
      }));
    }
    cards.appendChild(c);
  }

  /* 공격타입 + 스쿼드 TOP */
  {
    const m = countBy(nikkes, 'attack_type');
    const items = ['Metal', 'Energy', 'Bio'].filter(k => m.has(k))
      .map(k => ({ key: k, label: L('attack_type', k), value: m.get(k) }));
    const c = card('공격타입별 분포', `${nikkes.length}명 기준`);
    c.appendChild(barList(items, nikkes.length));
    cards.appendChild(c);
  }
  {
    const m = countBy(nikkes, 'squad');
    const items = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
      .map(([k, v]) => ({ key: k, label: L('squad', k), value: v }));
    const c = card('스쿼드 TOP 12', `총 ${m.size}개 스쿼드`);
    c.appendChild(barList(items, nikkes.length));
    cards.appendChild(c);
  }

  /* 2. 교차표 */
  {
    const c = card('속성 × 클래스', '칸의 숫자는 해당 조합의 니케 수', true);
    c.appendChild(heatmap(
      AXES.element.order, AXES.class.order,
      (r, col) => nikkes.filter(n => n.element === r && n.class === col).length,
      r => L('element', r), col => L('class', col),
    ));
    cards.appendChild(c);
  }
  {
    const c = card('기업 × 무기', '칸의 숫자는 해당 조합의 니케 수', true);
    c.appendChild(heatmap(
      AXES.corporation.order, AXES.weapon_type.order,
      (r, col) => nikkes.filter(n => n.corporation === r && n.weapon_type === col).length,
      r => L('corporation', r), col => L('weapon_type', col),
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
    const c = card('분기별 출시 추이', '가로축은 분기, 세로축은 출시된 니케 수', true);
    if (pts.length) {
      c.appendChild(columnChart(pts, p => `${p.label} — <b>${p.value}</b>명`));
      const byYear = new Map();
      for (const n of dated) {
        const y = n.release_date.slice(0, 4);
        byYear.set(y, (byYear.get(y) || 0) + 1);
      }
      c.appendChild(barList(
        [...byYear.entries()].sort().map(([k, v]) => ({ key: k, label: k + '년', value: v })),
        dated.length,
      ));
    } else c.appendChild(el('p', 'hint', '해당 조건의 니케가 없습니다.'));
    cards.appendChild(c);
  }

  /* 4. 픽업 통계 */
  {
    const m = countBy(pickups, 'availability');
    const items = ['standard', 'limited'].filter(k => m.has(k))
      .map(k => ({ key: k, label: L('availability', k), value: m.get(k) }));
    const c = card('한정 / 상시 비율', `${pickups.length}개 배너 기준`);
    c.appendChild(barList(items, pickups.length,
      it => it.key === 'limited' ? 'var(--series-2)' : 'var(--series-1)'));
    cards.appendChild(c);
  }
  {
    const m = countBy(pickups, p => p.tag ?? '_none');
    const items = [...m.entries()].sort((a, b) => b[1] - a[1])
      .map(([k, v]) => ({ key: k, label: k === '_none' ? '일반' : L('tag', k), value: v }));
    const c = card('픽업 구분별 분포', `${pickups.length}개 배너 기준`);
    c.appendChild(barList(items, pickups.length));
    cards.appendChild(c);
  }
  {
    const m = countBy(pickups, p => statusOf(p));
    const items = ['ongoing', 'upcoming', 'ended'].filter(k => m.has(k)).map(k => ({
      key: k,
      label: { ongoing: '진행중', upcoming: '예정', ended: '종료' }[k],
      value: m.get(k),
    }));
    const c = card('배너 진행 상태', '브라우저 현재 시각 기준');
    c.appendChild(barList(items, pickups.length,
      it => it.key === 'ongoing' ? 'var(--st-good)'
        : it.key === 'upcoming' ? 'var(--st-warn)' : 'var(--ink-muted)'));
    cards.appendChild(c);
  }

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
      label: b === 999 ? `${a}개월+` : `${a}~${b}개월`,
      value: gaps.filter(g => g >= a && g < b).length,
    }));
    const c = card('복각 주기', gaps.length
      ? `복각 ${gaps.length}건 · 첫 픽업 이후 경과 개월 (중앙값 ${median(gaps)}개월)`
      : '현재 조건에 복각 배너가 없습니다');
    if (gaps.length) c.appendChild(barList(items, gaps.length));
    cards.appendChild(c);
  }

  /* 6. 픽업 없는 니케 */
  {
    const none = nikkes.filter(n => !pickups.some(p => p.rid === n.rid));
    const c = card('픽업 이력 없음', '런칭 유닛이거나 가챠 배너를 받은 적 없는 니케');
    c.appendChild(barList([
      { key: 'has', label: '픽업 있음', value: nikkes.length - none.length },
      { key: 'none', label: '픽업 없음', value: none.length },
    ], nikkes.length));
    cards.appendChild(c);
  }
}

function median(a) {
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}
