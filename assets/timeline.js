/* 타임라인 차트 — 인라인 SVG. 통계 탭의 `assets/charts.js` 와 같은 관용구를 쓴다.

   한 그림에 다섯 가지를 겹친다:
     음영   풀버스트 구간
     막대   순간 DPS
     선     누적 대미지 (오른쪽 축)
     띠     버스트 게이지 · MG 예열 게이지

   예열을 같이 그리는 게 핵심이다. 풀버스트가 열렸는데 예열이 바닥이면 +50% 구간을 램프업이 잡아먹고 있다는 뜻인데 숫자로는 안 보인다.
   게이지도 같은 띠에 올린다 — 톱니가 가파르면 게이지가 금방 차서 쿨타임 대기(꼭대기에서 평평), 완만하면 게이지가 사이클을 붙잡는 것이다.
   SVG 안쪽 글자는 10px 로 둔다 — viewBox 사용자 단위라 스타일시트의 1.25× 스케일 대상이 아니다. */

const NS = 'http://www.w3.org/2000/svg';

const el = (tag, attrs = {}, text) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text != null) n.textContent = text;
  return n;
};

import { num as fmt } from './i18n.js';

const W = 900, H = 260;
/* 위쪽에 예열 띠가 들어가므로 t 를 넉넉히 잡는다. */
const PAD = { l: 46, r: 46, t: 12, b: 24, heat: 44 };

/* 예열 곡선은 MG 처럼 램프가 있는 니케만 의미가 있다. 상수 연사인 무기는 늘 1 이라 선이 천장에 붙어 읽을 게 없다. */
export function heatIndex(squad) {
  return squad.findIndex(a => {
    const r = a.combat && a.combat.shot && a.combat.shot.rof;
    return r && r.perShot > 0 && r.end > r.start;
  });
}

export function renderTimeline(root, result, squad, t) {
  root.textContent = '';
  const series = result.series || [];
  if (!series.length) return;

  const seconds = result.seconds || series[series.length - 1].t || 1;
  const maxDps = Math.max(1, ...series.map(s => s.dps));
  const maxCum = Math.max(1, result.total);
  const hi = heatIndex(squad);
  const hasGauge = series.some(s => s.gauge != null);

  /* 위쪽 띠(게이지·예열)가 있으면 그만큼 아래에서 시작한다. */
  const top = (hi >= 0 || hasGauge) ? PAD.t + PAD.heat : PAD.t;
  const x = s => PAD.l + (s / seconds) * (W - PAD.l - PAD.r);
  const yDps = v => H - PAD.b - (v / maxDps) * (H - top - PAD.b);
  const yCum = v => H - PAD.b - (v / maxCum) * (H - top - PAD.b);

  const svg = el('svg', {
    class: 'chart mk-chartSvg', viewBox: `0 0 ${W} ${H}`,
    preserveAspectRatio: 'none', role: 'img',
  });

  /* 풀버스트 음영을 먼저 깔아 막대·선이 그 위에 오게 한다. */
  let from = null;
  series.forEach((s, i) => {
    if (s.fullBurst && from == null) from = s.t;
    const last = i === series.length - 1;
    if ((!s.fullBurst || last) && from != null) {
      svg.appendChild(el('rect', {
        class: 'mk-fb', x: x(from), y: top,
        width: Math.max(1, x(s.t) - x(from)), height: H - top - PAD.b,
      }));
      from = null;
    }
  });

  const bw = Math.max(1, (W - PAD.l - PAD.r) / series.length - 0.5);
  for (const s of series) {
    const h = Math.max(0, H - PAD.b - yDps(s.dps));
    if (h > 0.2) {
      svg.appendChild(el('rect', { class: 'mk-bar', x: x(s.t) - bw / 2, y: yDps(s.dps),
                                   width: bw, height: h }));
    }
  }

  svg.appendChild(el('polyline', {
    class: 'mk-cum', points: series.map(s => `${x(s.t)},${yCum(s.cum)}`).join(' '),
  }));

  /* 예열은 위쪽에 얇은 띠로 뺀다. 같은 축에 겹치면 재장전마다 바닥까지 떨어지는 세로선이 DPS 막대를 가려 둘 다 못 읽는다. */
  if (hi >= 0 || hasGauge) {
    const band = { top: PAD.t, h: 34 };
    const yBand = v => band.top + band.h - v * band.h;
    svg.appendChild(el('line', { class: 'mk-heatBase', x1: PAD.l, y1: band.top + band.h,
                                 x2: W - PAD.r, y2: band.top + band.h }));
    const line = (cls, pick) => svg.appendChild(el('polyline', {
      class: cls, points: series.map(s => `${x(s.t)},${yBand(pick(s))}`).join(' '),
    }));
    if (hasGauge) line('mk-gauge', s => s.gauge || 0);
    if (hi >= 0) line('mk-heat', s => s.heat[hi] || 0);
    svg.appendChild(el('text', { class: 'mk-tick', x: W - PAD.r + 6, y: band.top + 8 }, '100%'));
  }

  /* 축. 왼쪽은 순간 DPS, 오른쪽은 누적이라 눈금을 양쪽에 단다. */
  svg.appendChild(el('line', { class: 'mk-axis', x1: PAD.l, y1: H - PAD.b, x2: W - PAD.r, y2: H - PAD.b }));
  for (let i = 0; i <= 4; i++) {
    const s = (seconds * i) / 4;
    svg.appendChild(el('text', { class: 'mk-tick', x: x(s), y: H - PAD.b + 14,
                                 'text-anchor': 'middle' }, `${Math.round(s)}s`));
  }
  svg.appendChild(el('text', { class: 'mk-tick', x: PAD.l - 6, y: top + 9,
                               'text-anchor': 'end' }, fmt(maxDps)));
  svg.appendChild(el('text', { class: 'mk-tick', x: W - PAD.r + 6, y: top + 9 }, fmt(maxCum)));

  root.appendChild(svg);

  const legend = document.createElement('p');
  legend.className = 'mk-legend';
  const bit = (cls, label) => {
    const s = document.createElement('span');
    s.className = 'mk-key ' + cls;
    s.textContent = label;
    return s;
  };
  legend.appendChild(bit('is-bar', t('mk.dps')));
  legend.appendChild(bit('is-cum', t('mk.total')));
  legend.appendChild(bit('is-fb', t('mk.burst')));
  if (hasGauge) legend.appendChild(bit('is-gauge', t('mk.gauge')));
  if (hi >= 0) legend.appendChild(bit('is-heat', `${t('mk.heat')} · ${squad[hi].name}`));
  root.appendChild(legend);
}

/* 니케별 기여 막대. 대미지 종류별로 색을 나눠, 평타로 버는지 스킬로 버는지 보이게. */
export function renderShare(root, result, t) {
  root.textContent = '';
  const rows = [...result.byActor].sort((a, b) => b.damage - a.damage);
  const top = Math.max(1, ...rows.map(r => r.damage));
  /* 코어는 타격을 원문이 부르는 이름으로 나눈다 (메커니즘 8) — 평타 / 버스트 스킬 본체 / "추가 대미지" / 그 밖의 스킬.
     앞의 셋이 서로 다른 보너스를 받으므로 합쳐 놓으면 왜 그 숫자가 나왔는지 못 읽는다. */
  const KIND = [['평타', 'mk.normal'], ['버스트스킬', 'mk.burst'],
                ['추가', 'mk.extraDmg'], ['스킬', 'mk.skill']];

  for (const r of rows) {
    const line = document.createElement('div');
    line.className = 'mk-shareRow';

    const head = document.createElement('div');
    head.className = 'mk-shareHead';
    const nm = document.createElement('b');
    nm.textContent = r.name;
    const val = document.createElement('span');
    val.textContent = `${fmt(r.damage)} · ${(r.share * 100).toFixed(1)}%`;
    head.append(nm, val);

    const bar = document.createElement('div');
    bar.className = 'mk-shareBar';
    bar.style.width = `${(r.damage / top) * 100}%`;
    for (const [k, key] of KIND) {
      const part = r.byKind[k] || 0;
      if (part <= 0) continue;
      const seg = document.createElement('span');
      seg.className = `mk-seg is-${k}`;
      seg.style.flexGrow = String(part);
      seg.title = `${t(key)} ${fmt(part)} (${(part / r.damage * 100).toFixed(0)}%)`;
      bar.appendChild(seg);
    }

    const foot = document.createElement('div');
    foot.className = 'mk-shareFoot';
    foot.textContent = `${t('mk.shots')} ${r.shots.toLocaleString()} · `
      + `${t('mk.ammo')} ${r.ammo} · ${t('mk.reloads')} ${r.reloads}`;

    line.append(head, bar, foot);
    root.appendChild(line);
  }
}
