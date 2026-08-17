// 履歴。月カレンダーで記録のある日を見渡し、日を選んで中身を確認・編集する。

import * as state from '../state.js';
import { card, el, emptyState, list, listRow, segmented } from '../ui.js';
import {
  addMonths, endOfMonth, entryVolume, fmtTrim, formatDateJa, monthKey, parseDate,
  startOfMonth, today,
} from '../util.js';
import { entryRow } from './log.js';

const DOW = ['月', '火', '水', '木', '金', '土', '日'];

function currentMonth(api) {
  return api.params.month || monthKey(today());
}

function render(root, api) {
  const mode = api.params.mode || 'calendar';

  root.appendChild(
    segmented(
      [{ value: 'calendar', label: 'カレンダー' }, { value: 'list', label: '一覧' }],
      mode,
      (v) => api.goto('history', { ...api.params, mode: v }),
    ),
  );

  if (mode === 'list') {
    renderList(root, api);
    return;
  }
  renderCalendar(root, api);
}

// --- カレンダー -------------------------------------------------------------

function renderCalendar(root, api) {
  const month = currentMonth(api);
  const first = startOfMonth(month + '-01');
  const last = endOfMonth(first);
  const selected = api.params.date && monthKey(api.params.date) === month ? api.params.date : null;

  const volumes = state.volumeByDate();
  const trained = state.trainingDates();
  const bodyDates = new Set(state.getState().body.map((b) => b.date));
  const maxVolume = Math.max(1, ...[...volumes.values()]);

  // 月ナビ
  const nav = el('div', { class: 'datenav' }, [
    el('button', { class: 'nav', type: 'button', text: '‹', 'aria-label': '前の月', onclick: () => api.goto('history', { ...api.params, month: monthKey(addMonths(first, -1)), date: null }) }),
    el('div', { class: 'label' }, [
      `${parseDate(first).getFullYear()}年 ${parseDate(first).getMonth() + 1}月`,
      el('small', { text: monthSummaryText(month) }),
    ]),
    el('button', { class: 'nav', type: 'button', text: '›', 'aria-label': '次の月', onclick: () => api.goto('history', { ...api.params, month: monthKey(addMonths(first, 1)), date: null }) }),
  ]);
  root.appendChild(nav);

  // 月グリッド (月曜始まり)
  const grid = el('div', { class: 'cal' });
  DOW.forEach((d, i) => {
    grid.appendChild(el('div', { class: `dow${i === 5 ? ' sat' : ''}${i === 6 ? ' sun' : ''}`, text: d }));
  });

  const firstDow = (parseDate(first).getDay() + 6) % 7;
  for (let i = 0; i < firstDow; i++) grid.appendChild(el('div', { class: 'cal-day blank' }));

  const lastDay = parseDate(last).getDate();
  for (let d = 1; d <= lastDay; d++) {
    const date = `${month}-${String(d).padStart(2, '0')}`;
    const vol = volumes.get(date) || 0;
    const dots = el('div', { class: 'dots' }, [
      trained.has(date) ? el('i', { class: 'train' }) : null,
      bodyDates.has(date) ? el('i', { class: 'body' }) : null,
    ]);
    const cell = el('button', {
      class: `cal-day${date === today() ? ' today' : ''}`,
      type: 'button',
      'aria-selected': date === selected ? 'true' : 'false',
      'aria-label': formatDateJa(date),
      onclick: () => api.goto('history', { ...api.params, date: date === selected ? null : date }),
    }, [String(d), dots]);
    // ランニングのようにボリュームが出ない日も、トレーニング日として薄く塗る。
    if (trained.has(date) && date !== selected) {
      const strength = 0.12 + 0.28 * Math.min(1, vol / maxVolume);
      cell.style.background = `color-mix(in srgb, var(--c-train) ${Math.round(strength * 100)}%, transparent)`;
    }
    grid.appendChild(cell);
  }

  root.appendChild(card(null, [
    grid,
    el('div', { class: 'chart-legend' }, [
      el('span', { class: 'key' }, [el('span', { class: 'dot', style: { background: 'var(--c-train)', width: '8px', height: '8px', borderRadius: '50%' } }), 'トレーニング']),
      el('span', { class: 'key' }, [el('span', { class: 'dot', style: { background: 'var(--c-weight)', width: '8px', height: '8px', borderRadius: '50%' } }), '体組成']),
      el('span', { class: 'key', text: '背景の濃さ = ボリューム' }),
    ]),
  ]));

  if (selected) {
    root.appendChild(dayDetail(selected, api));
  } else {
    root.appendChild(card(null, emptyState('日付を選ぶと内容が出ます', '記録の編集・削除もそこからできます。')));
  }
}

function monthSummaryText(month) {
  const { entries, body } = state.getState();
  const days = new Set(entries.filter((e) => monthKey(e.date) === month).map((e) => e.date));
  const bodyCount = body.filter((b) => monthKey(b.date) === month).length;
  return `トレーニング ${days.size}日 ・ 体組成 ${bodyCount}日`;
}

function dayDetail(date, api) {
  const entries = state.entriesForDate(date);
  const body = state.bodyForDate(date);
  const day = state.dayForDate(date);
  const children = [];

  if (body) {
    children.push(
      el('div', { class: 'stat-grid' }, [
        body.weight !== null
          ? el('div', { class: 'stat' }, [
              el('div', { class: 'stat-label', text: '体重' }),
              el('div', { class: 'stat-value' }, [fmtTrim(body.weight), el('span', { class: 'unit', text: 'kg' })]),
            ])
          : null,
        body.bodyFat !== null
          ? el('div', { class: 'stat' }, [
              el('div', { class: 'stat-label', text: '体脂肪率' }),
              el('div', { class: 'stat-value' }, [fmtTrim(body.bodyFat), el('span', { class: 'unit', text: '%' })]),
            ])
          : null,
      ]),
    );
  }

  if (entries.length) {
    children.push(list(entries.map((entry) => entryRow(entry, date, api))));
  } else {
    children.push(emptyState('トレーニングの記録はありません'));
  }

  if (day && day.note) children.push(el('p', { class: 'note', text: day.note }));

  children.push(
    el('button', {
      class: 'btn block',
      type: 'button',
      text: 'この日の記録画面を開く',
      onclick: () => api.goto('log', { date }),
    }),
  );

  return card(formatDateJa(date, { withYear: true }), children);
}

// --- 一覧 -------------------------------------------------------------------

function renderList(root, api) {
  const { entries, body } = state.getState();
  const dates = [...new Set([...entries.map((e) => e.date), ...body.map((b) => b.date)])].sort().reverse();

  if (!dates.length) {
    root.appendChild(card(null, emptyState('まだ記録がありません', '「記録」タブから入力すると、ここに並びます。')));
    return;
  }

  let currentMonthKey = null;
  let container = null;
  for (const date of dates.slice(0, 200)) {
    const mk = monthKey(date);
    if (mk !== currentMonthKey) {
      currentMonthKey = mk;
      root.appendChild(el('h2', { class: 'section-title', text: `${mk.slice(0, 4)}年 ${Number(mk.slice(5))}月` }));
      container = list([]);
      root.appendChild(container);
    }
    container.appendChild(summaryRow(date, api));
  }

  if (dates.length > 200) {
    root.appendChild(el('p', { class: 'field-hint', text: `直近 200 日分を表示しています (全 ${dates.length} 日)` }));
  }
}

function summaryRow(date, api) {
  const entries = state.entriesForDate(date);
  const body = state.bodyForDate(date);
  const vol = entries.reduce((s, e) => s + entryVolume(e), 0);
  const dist = entries.reduce((s, e) => s + (e.distanceKm || 0), 0);

  const parts = [];
  if (entries.length) {
    const names = [...new Set(entries.map((e) => state.exerciseName(e.exerciseId)))];
    parts.push(names.slice(0, 3).join('・') + (names.length > 3 ? ` ほか${names.length - 3}種目` : ''));
  }
  if (body && body.weight !== null) parts.push(`${fmtTrim(body.weight)}kg`);
  if (body && body.bodyFat !== null) parts.push(`${fmtTrim(body.bodyFat)}%`);

  const trail = [];
  if (vol > 0) trail.push(`${fmtTrim(vol, 0)}kg`);
  if (dist > 0) trail.push(`${fmtTrim(dist, 2)}km`);

  return listRow({
    title: formatDateJa(date, { withYear: parseDate(date).getFullYear() !== new Date().getFullYear() }),
    sub: parts.join(' ・ ') || '記録なし',
    trail: trail.join(' / '),
    onClick: () => api.goto('history', { ...api.params, mode: 'calendar', month: monthKey(date), date }),
  });
}

export default {
  title: '履歴',
  render,
};
