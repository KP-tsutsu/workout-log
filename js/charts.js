// 自前の SVG グラフ。外部ライブラリは使わない。
//
// 方針:
//   - 1 枚のグラフにつき 1 種類の量だけ。体重と体脂肪率のように単位が違うものを
//     左右 2 軸に重ねると読み違えるので、必ずグラフを分ける。
//   - 目盛りと軸は控えめに、線は 2px、値のラベルは要所だけ。
//   - 指で触れた位置の値をツールチップで出す (数値そのものは履歴タブでも読める)。

import { el, svg } from './ui.js';
import { formatDateJa, parseDate } from './util.js';

const W = 340;
const PAD = { top: 10, right: 10, bottom: 20, left: 34 };

function niceTicks(min, max, count = 3) {
  if (min === max) {
    const pad = Math.abs(min) * 0.05 || 1;
    min -= pad;
    max += pad;
  }
  const span = max - min;
  const rawStep = span / count;
  const mag = 10 ** Math.floor(Math.log10(rawStep));
  const norm = rawStep / mag;
  const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag;
  const start = Math.floor(min / step) * step;
  const ticks = [];
  for (let v = start; v <= max + step * 0.5; v += step) ticks.push(Number(v.toFixed(10)));
  return ticks;
}

/**
 * 折れ線グラフ。
 * points: [{date, value}] を日付順で。avg があれば平均線として重ねる。
 */
export function lineChart({
  points,
  average = null,
  color = 'var(--c-weight)',
  height = 150,
  unit = '',
  decimals = 1,
  goal = null,
  legend = null,
}) {
  const H = height;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const values = points.map((p) => p.value);
  if (average) values.push(...average.map((p) => p.value));
  if (goal !== null && goal !== undefined) values.push(goal);
  const ticks = niceTicks(Math.min(...values), Math.max(...values));
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];

  const t0 = parseDate(points[0].date).getTime();
  const t1 = parseDate(points[points.length - 1].date).getTime();
  const spanT = Math.max(1, t1 - t0);

  const x = (date) => PAD.left + ((parseDate(date).getTime() - t0) / spanT) * plotW;
  const y = (v) => PAD.top + (1 - (v - yMin) / (yMax - yMin || 1)) * plotH;

  const root = svg('svg', {
    class: 'chart',
    viewBox: `0 0 ${W} ${H}`,
    height: String(H),
    role: 'img',
    'aria-label': `折れ線グラフ。${points.length} 件の記録。`,
    style: 'touch-action: pan-y',
  });

  // 目盛り
  for (const t of ticks) {
    root.appendChild(svg('line', { class: 'grid', x1: PAD.left, x2: W - PAD.right, y1: y(t), y2: y(t) }));
    root.appendChild(svg('text', { x: PAD.left - 5, y: y(t) + 3.5, 'text-anchor': 'end', text: trim(t, decimals) }));
  }

  // 目標線
  if (goal !== null && goal !== undefined && goal >= yMin && goal <= yMax) {
    root.appendChild(
      svg('line', {
        x1: PAD.left, x2: W - PAD.right, y1: y(goal), y2: y(goal),
        stroke: 'var(--good)', 'stroke-width': 1.5, 'stroke-dasharray': '4 3',
        'vector-effect': 'non-scaling-stroke',
      }),
    );
    root.appendChild(
      svg('text', { x: W - PAD.right, y: y(goal) - 4, 'text-anchor': 'end', fill: 'var(--good)', text: `目標 ${trim(goal, decimals)}` }),
    );
  }

  // 実測は点で、平均があればそちらを線にする。
  const linePoints = average && average.length > 1 ? average : points;
  if (linePoints.length > 1) {
    const d = linePoints.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
    root.appendChild(
      svg('path', {
        d, fill: 'none', stroke: color, 'stroke-width': 2,
        'stroke-linejoin': 'round', 'stroke-linecap': 'round',
        'vector-effect': 'non-scaling-stroke',
      }),
    );
  }

  const dotOpacity = average && average.length > 1 ? 0.45 : 1;
  for (const p of points) {
    root.appendChild(svg('circle', { cx: x(p.date), cy: y(p.value), r: points.length > 60 ? 1.6 : 2.6, fill: color, opacity: dotOpacity }));
  }

  // 直近の値だけ数字を添える
  const last = points[points.length - 1];
  root.appendChild(svg('circle', { cx: x(last.date), cy: y(last.value), r: 4.5, fill: color, stroke: 'var(--card)', 'stroke-width': 2 }));

  // 日付ラベル (両端)
  root.appendChild(svg('text', { x: PAD.left, y: H - 5, 'text-anchor': 'start', text: shortDate(points[0].date) }));
  if (points.length > 1) {
    root.appendChild(svg('text', { x: W - PAD.right, y: H - 5, 'text-anchor': 'end', text: shortDate(last.date) }));
  }

  // 触った位置の値を出す層
  const cursor = svg('g', { opacity: 0, 'pointer-events': 'none' });
  const cursorLine = svg('line', { y1: PAD.top, y2: PAD.top + plotH, stroke: 'var(--line-strong)', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' });
  const cursorDot = svg('circle', { r: 5, fill: color, stroke: 'var(--card)', 'stroke-width': 2 });
  const tipBg = svg('rect', { rx: 5, height: 17, fill: 'var(--text)', opacity: 0.92 });
  const tipText = svg('text', { fill: 'var(--card)', 'text-anchor': 'middle', 'font-weight': '700', y: 0 });
  cursor.appendChild(cursorLine);
  cursor.appendChild(cursorDot);
  cursor.appendChild(tipBg);
  cursor.appendChild(tipText);
  root.appendChild(cursor);

  const hit = svg('rect', { x: 0, y: 0, width: W, height: H, fill: 'transparent' });
  root.appendChild(hit);

  function showAt(clientX) {
    const box = root.getBoundingClientRect();
    if (!box.width) return;
    const svgX = ((clientX - box.left) / box.width) * W;
    let nearest = points[0];
    let best = Infinity;
    for (const p of points) {
      const d = Math.abs(x(p.date) - svgX);
      if (d < best) { best = d; nearest = p; }
    }
    const px = x(nearest.date);
    const py = y(nearest.value);
    cursorLine.setAttribute('x1', px);
    cursorLine.setAttribute('x2', px);
    cursorDot.setAttribute('cx', px);
    cursorDot.setAttribute('cy', py);
    const label = `${shortDate(nearest.date)}  ${trim(nearest.value, decimals)}${unit}`;
    tipText.textContent = label;
    const tw = Math.max(60, label.length * 6.4);
    const tx = Math.min(W - PAD.right - tw / 2, Math.max(PAD.left + tw / 2, px));
    tipText.setAttribute('x', tx);
    tipText.setAttribute('y', PAD.top + 11);
    tipBg.setAttribute('x', tx - tw / 2);
    tipBg.setAttribute('y', PAD.top - 2);
    tipBg.setAttribute('width', tw);
    cursor.setAttribute('opacity', '1');
  }
  const hide = () => cursor.setAttribute('opacity', '0');

  hit.addEventListener('pointerdown', (e) => { showAt(e.clientX); hit.setPointerCapture(e.pointerId); });
  hit.addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType === 'touch') showAt(e.clientX); });
  hit.addEventListener('pointerup', hide);
  hit.addEventListener('pointercancel', hide);
  hit.addEventListener('pointerleave', hide);
  hit.addEventListener('mousemove', (e) => showAt(e.clientX));

  if (!legend) return root;
  return el('div', { style: { display: 'grid', gap: '6px' } }, [root, legendNode(legend)]);
}

/**
 * 棒グラフ。bars: [{label, value, sub}]。
 */
export function barChart({ bars, color = 'var(--c-train)', height = 140, unit = '', decimals = 0 }) {
  const H = height;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const max = Math.max(...bars.map((b) => b.value), 0);
  const ticks = niceTicks(0, max || 1, 2);
  const yMax = ticks[ticks.length - 1] || 1;
  const y = (v) => PAD.top + (1 - v / yMax) * plotH;

  const slot = plotW / bars.length;
  const barW = Math.max(4, Math.min(26, slot - 3)); // 棒の間に 3px 以上の隙間を残す

  const root = svg('svg', {
    class: 'chart',
    viewBox: `0 0 ${W} ${H}`,
    height: String(H),
    role: 'img',
    'aria-label': `棒グラフ。${bars.length} 件。`,
  });

  for (const t of ticks) {
    root.appendChild(svg('line', { class: 'grid', x1: PAD.left, x2: W - PAD.right, y1: y(t), y2: y(t) }));
    root.appendChild(svg('text', { x: PAD.left - 5, y: y(t) + 3.5, 'text-anchor': 'end', text: trim(t, decimals) }));
  }

  const maxIndex = bars.reduce((bi, b, i) => (b.value > bars[bi].value ? i : bi), 0);

  bars.forEach((b, i) => {
    const cx = PAD.left + slot * (i + 0.5);
    const h = b.value > 0 ? Math.max(2, plotH - (y(b.value) - PAD.top)) : 0;
    if (h > 0) {
      root.appendChild(
        svg('rect', {
          x: cx - barW / 2, y: PAD.top + plotH - h, width: barW, height: h,
          rx: Math.min(4, barW / 2), fill: color,
          opacity: b.dim ? 0.45 : 1,
        }),
      );
    }
    // ラベルは詰まるので間引く。直近と最大だけ数値を出す。
    const showLabel = bars.length <= 8 || i === bars.length - 1 || i % Math.ceil(bars.length / 6) === 0;
    if (showLabel) {
      root.appendChild(svg('text', { x: cx, y: H - 5, 'text-anchor': 'middle', text: b.label }));
    }
    if ((i === bars.length - 1 || i === maxIndex) && b.value > 0) {
      root.appendChild(
        svg('text', {
          x: cx, y: PAD.top + plotH - h - 4, 'text-anchor': 'middle',
          fill: 'var(--dim)', 'font-weight': '700',
          text: `${trim(b.value, decimals)}${unit}`,
        }),
      );
    }
  });

  return root;
}

/** 直近 weeks 週のヒートマップ (CSS グリッド)。days は Map<date, 強さ 0-1>。 */
export function heatmap({ dates, level }) {
  const grid = el('div', { class: 'heat' });
  for (const date of dates) {
    grid.appendChild(el('i', {
      dataset: { level: String(level(date)) },
      title: `${formatDateJa(date)}`,
    }));
  }
  return grid;
}

function legendNode(items) {
  return el('div', { class: 'chart-legend' }, items.map((it) =>
    el('span', { class: 'key' }, [
      el('span', { class: 'dot', style: { background: it.color, opacity: it.opacity || 1 } }),
      it.label,
    ]),
  ));
}

function trim(v, decimals) {
  const r = Number(v.toFixed(decimals));
  return Number.isInteger(r) ? String(r) : r.toFixed(decimals);
}

function shortDate(dateStr) {
  const d = parseDate(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
