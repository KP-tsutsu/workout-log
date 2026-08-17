// ダッシュボード。開いた瞬間に「今どこにいるか」と「続けられているか」が
// 分かることを目的にしている。

import * as state from '../state.js';
import { barChart, heatmap, lineChart } from '../charts.js';
import { card, el, emptyState, listRow, progressBar, segmented, selectField, stat } from '../ui.js';
import {
  addDays, daysBetween, entryVolume, estimate1RM, fmtMinutes, fmtPace, fmtSigned,
  fmtTrim, formatDateJa, monthKey, movingAverage, parseDate, startOfWeek, today, toDateStr,
} from '../util.js';

const PERIODS = [
  { value: '1m', label: '1か月', days: 31 },
  { value: '3m', label: '3か月', days: 92 },
  { value: '1y', label: '1年', days: 366 },
  { value: 'all', label: '全期間', days: null },
];

let period = '3m';

function render(root, api) {
  root.appendChild(goalCard());
  root.appendChild(bodyChartsCard(api));
  root.appendChild(trainingCard(api));
  root.appendChild(cardioCard());
  root.appendChild(exerciseProgressCard());
}

// --- 1. 目標 ----------------------------------------------------------------

function goalCard() {
  const goals = state.getState().goals;
  const weight = state.latestBody('weight');
  const fat = state.latestBody('bodyFat');

  if (!weight && !fat) {
    return card('目標', emptyState('体重・体脂肪率の記録がありません', '「記録」タブで入力すると、目標までの差がここに出ます。'));
  }

  const children = [];
  const stats = el('div', { class: 'stat-grid' });

  if (weight) {
    stats.appendChild(stat({
      label: '現在の体重',
      value: fmtTrim(weight.value),
      unit: 'kg',
      sub: formatDateJa(weight.date),
    }));
    if (goals.targetWeight !== null) {
      const diff = weight.value - goals.targetWeight;
      stats.appendChild(stat({
        label: '目標体重まで',
        value: diff <= 0 ? '達成' : fmtTrim(diff),
        unit: diff <= 0 ? '' : 'kg',
        sub: `目標 ${fmtTrim(goals.targetWeight)}kg`,
        tone: diff <= 0 ? 'good' : 'accent',
      }));
    }
  }

  if (fat) {
    stats.appendChild(stat({
      label: '現在の体脂肪率',
      value: fmtTrim(fat.value),
      unit: '%',
      sub: formatDateJa(fat.date),
    }));
    if (goals.targetBodyFat !== null) {
      const diff = fat.value - goals.targetBodyFat;
      stats.appendChild(stat({
        label: '目標体脂肪率まで',
        value: diff <= 0 ? '達成' : fmtTrim(diff),
        unit: diff <= 0 ? '' : '%',
        sub: `目標 ${fmtTrim(goals.targetBodyFat)}%`,
        tone: diff <= 0 ? 'good' : 'accent',
      }));
    }
  }
  children.push(stats);

  const startWeight = state.startValue('weight');
  if (weight && goals.targetWeight !== null && startWeight !== null) {
    const total = startWeight - goals.targetWeight;
    const done = startWeight - weight.value;
    const ratio = total === 0 ? 1 : done / total;
    children.push(progressBar({
      ratio,
      leftLabel: `開始 ${fmtTrim(startWeight)}kg`,
      rightLabel: `目標 ${fmtTrim(goals.targetWeight)}kg`,
      tone: ratio >= 1 ? 'good' : '',
    }));
    children.push(el('div', { class: 'field-hint', text: `進捗 ${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%` }));
  }

  const pace = paceText(goals, weight);
  if (pace) children.push(el('p', { class: 'note', text: pace }));

  if (goals.targetWeight === null && goals.targetBodyFat === null) {
    children.push(el('p', { class: 'note', text: '「マスタ・設定」タブで目標を設定すると、差分と進捗が出ます。' }));
  }

  return card('目標', children);
}

/** 目標日がある場合の、必要ペースと予測達成日。 */
function paceText(goals, weight) {
  if (!weight || goals.targetWeight === null || !goals.targetDate) return null;
  const remaining = weight.value - goals.targetWeight;
  if (remaining <= 0) return '目標体重を達成しています。';

  const daysLeft = daysBetween(today(), goals.targetDate);
  if (daysLeft <= 0) return `目標日 (${formatDateJa(goals.targetDate, { withYear: true })}) を過ぎています。あと ${fmtTrim(remaining)}kg です。`;

  const needPerWeek = (remaining / daysLeft) * 7;
  const rate = recentRatePerDay(state.bodySeries('weight'), 28); // kg/日 (減っていればマイナス)

  const lines = [`目標日まで ${daysLeft}日。あと ${fmtTrim(remaining)}kg、週あたり ${fmtTrim(needPerWeek, 2)}kg のペースが必要です。`];

  if (rate !== null && rate < -0.0005) {
    const daysToGoal = remaining / -rate;
    const eta = toDateStr(new Date(parseDate(today()).getTime() + daysToGoal * 86400000));
    const ahead = daysToGoal <= daysLeft;
    lines.push(
      `直近 4 週の実績は週 ${fmtTrim(rate * 7, 2)}kg。このペースなら ${formatDateJa(eta, { withYear: true })} 頃に到達する見込みで、目標日には${ahead ? '間に合う計算です' : '間に合いません'}。`,
    );
  } else if (rate !== null) {
    lines.push('直近 4 週は減っていません。ペースを上げるか、目標日を見直すタイミングかもしれません。');
  }
  return lines.join('\n');
}

/** 直近 days 日の最小二乗法による 1 日あたりの変化量。点が少なければ null。 */
function recentRatePerDay(series, days) {
  const from = addDays(today(), -days);
  const rows = series.filter((p) => p.date >= from);
  if (rows.length < 3) return null;
  const xs = rows.map((p) => daysBetween(rows[0].date, p.date));
  const ys = rows.map((p) => p.value);
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  if (den === 0) return null;
  return num / den;
}

// --- 2. 体組成の推移 --------------------------------------------------------

function bodyChartsCard(api) {
  const conf = PERIODS.find((p) => p.value === period) || PERIODS[1];
  const from = conf.days ? addDays(today(), -conf.days) : '0000-01-01';

  const weight = state.bodySeries('weight').filter((p) => p.date >= from);
  const fat = state.bodySeries('bodyFat').filter((p) => p.date >= from);
  const goals = state.getState().goals;

  const children = [
    segmented(PERIODS.map((p) => ({ value: p.value, label: p.label })), period, (v) => {
      period = v;
      api.rerender();
    }),
  ];

  if (!weight.length && !fat.length) {
    children.push(emptyState('この期間の記録はありません', '期間を広げるか、「記録」タブから入力してください。'));
    return card('体重・体脂肪率の推移', children);
  }

  if (weight.length) {
    children.push(el('h3', { class: 'section-title', text: `体重 (kg)  ${changeText(weight)}` }));
    children.push(
      weight.length > 1
        ? lineChart({
            points: weight,
            average: movingAverage(weight, 7),
            color: 'var(--c-weight)',
            unit: 'kg',
            decimals: 1,
            goal: goals.targetWeight,
            legend: [
              { label: '7日平均', color: 'var(--c-weight)' },
              { label: '実測', color: 'var(--c-weight)', opacity: 0.45 },
            ],
          })
        : el('p', { class: 'field-hint', text: `${formatDateJa(weight[0].date)} に ${fmtTrim(weight[0].value)}kg。2 回以上記録するとグラフになります。` }),
    );
  }

  if (fat.length) {
    children.push(el('h3', { class: 'section-title', text: `体脂肪率 (%)  ${changeText(fat)}` }));
    children.push(
      fat.length > 1
        ? lineChart({
            points: fat,
            average: movingAverage(fat, 7),
            color: 'var(--c-fat)',
            unit: '%',
            decimals: 1,
            goal: goals.targetBodyFat,
            legend: [
              { label: '7日平均', color: 'var(--c-fat)' },
              { label: '実測', color: 'var(--c-fat)', opacity: 0.45 },
            ],
          })
        : el('p', { class: 'field-hint', text: `${formatDateJa(fat[0].date)} に ${fmtTrim(fat[0].value)}%。2 回以上記録するとグラフになります。` }),
    );
  }

  return card('体重・体脂肪率の推移', children);
}

function changeText(series) {
  if (series.length < 2) return '';
  const d = series[series.length - 1].value - series[0].value;
  return `期間で ${fmtSigned(d)}`;
}

// --- 3. トレーニングの継続 --------------------------------------------------

function trainingCard(api) {
  const { entries } = state.getState();
  if (!entries.length) {
    return card('トレーニングの継続', emptyState('まだトレーニングの記録がありません', '「記録」タブで種目を追加すると、日数と継続がここに出ます。'));
  }

  const thisMonth = monthKey(today());
  const monthDays = new Set(entries.filter((e) => monthKey(e.date) === thisMonth).map((e) => e.date));
  const trained = state.trainingDates();

  const stats = el('div', { class: 'stat-grid' }, [
    stat({ label: '今月の日数', value: monthDays.size, unit: '日', tone: 'accent' }),
    stat({ label: '連続週', value: weekStreak(trained), unit: '週', sub: '週 1 回以上' }),
    stat({ label: '直近 30 日', value: countDays(trained, 30), unit: '日' }),
    stat({ label: '通算', value: trained.size, unit: '日' }),
  ]);

  // 直近 12 週 (84 日) のヒートマップ。週の頭に揃えて縦 7 マスにする。
  const end = today();
  const start = startOfWeek(addDays(end, -83));
  const dates = [];
  for (let d = start; d <= end; d = addDays(d, 1)) dates.push(d);

  const volumes = state.volumeByDate();
  const maxVolume = Math.max(1, ...[...volumes.values()]);
  const level = (date) => {
    if (!trained.has(date)) return 0;
    const v = volumes.get(date) || 0;
    if (v <= 0) return 1;
    const r = v / maxVolume;
    return r > 0.66 ? 4 : r > 0.33 ? 3 : 2;
  };

  return card('トレーニングの継続', [
    stats,
    el('h3', { class: 'section-title', text: '直近 12 週' }),
    heatmap({ dates, level }),
    el('div', { class: 'heat-scale' }, [
      '少ない',
      el('i', { dataset: { level: '1' }, style: { background: 'color-mix(in srgb, var(--c-train) 30%, var(--card-2))' } }),
      el('i', { dataset: { level: '2' }, style: { background: 'color-mix(in srgb, var(--c-train) 55%, var(--card-2))' } }),
      el('i', { dataset: { level: '3' }, style: { background: 'color-mix(in srgb, var(--c-train) 78%, var(--card-2))' } }),
      el('i', { dataset: { level: '4' }, style: { background: 'var(--c-train)' } }),
      '多い',
    ]),
    listRow({
      title: '履歴をカレンダーで見る',
      sub: '日を選ぶと内容の確認・編集ができます',
      onClick: () => api.goto('history', { mode: 'calendar', month: thisMonth }),
    }),
  ]);
}

function countDays(trained, days) {
  const from = addDays(today(), -(days - 1));
  let n = 0;
  for (const d of trained) if (d >= from) n++;
  return n;
}

/** 週 1 回以上の記録が続いている週数。今週が未消化でも先週まで続いていれば数える。 */
function weekStreak(trained) {
  const weeks = new Set([...trained].map((d) => startOfWeek(d)));
  let cursor = startOfWeek(today());
  let streak = 0;
  if (!weeks.has(cursor)) cursor = addDays(cursor, -7); // 今週まだなら先週から数える
  while (weeks.has(cursor)) {
    streak++;
    cursor = addDays(cursor, -7);
  }
  return streak;
}

// --- 4. 有酸素 --------------------------------------------------------------

function cardioCard() {
  const { entries } = state.getState();
  const cardio = entries.filter((e) => {
    const ex = state.exerciseById(e.exerciseId);
    return ex && ex.kind === 'cardio';
  });

  if (!cardio.length) {
    return card('ランニング・有酸素', emptyState('有酸素の記録がありません', 'トレッドミルや屋外ランニングを記録すると、距離と時間がここに集計されます。'));
  }

  const thisMonth = monthKey(today());
  const inMonth = cardio.filter((e) => monthKey(e.date) === thisMonth);
  const monthDistance = inMonth.reduce((s, e) => s + (e.distanceKm || 0), 0);
  const monthMinutes = inMonth.reduce((s, e) => s + (e.durationMin || 0), 0);
  const totalDistance = cardio.reduce((s, e) => s + (e.distanceKm || 0), 0);

  // ペースは距離と時間の両方がある行だけで計算する。
  const paceRows = inMonth.filter((e) => e.distanceKm > 0 && e.durationMin > 0);
  const paceDistance = paceRows.reduce((s, e) => s + e.distanceKm, 0);
  const paceMinutes = paceRows.reduce((s, e) => s + e.durationMin, 0);
  const avgPace = paceDistance > 0 ? paceMinutes / paceDistance : null;

  const stats = el('div', { class: 'stat-grid' }, [
    stat({ label: '今月の距離', value: fmtTrim(monthDistance, 1), unit: 'km', tone: 'accent' }),
    stat({ label: '今月の時間', value: fmtMinutes(monthMinutes), sub: `${inMonth.length} 回` }),
    stat({ label: '平均ペース', value: avgPace ? fmtPace(avgPace) : '—', sub: avgPace ? '/km' : '距離と時間の両方が必要' }),
    stat({ label: '通算距離', value: fmtTrim(totalDistance, 1), unit: 'km' }),
  ]);

  // 直近 12 か月の月別距離
  const months = [];
  const base = today();
  for (let i = 11; i >= 0; i--) {
    const d = parseDate(base);
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const bars = months.map((m) => ({
    label: String(Number(m.slice(5))),
    value: cardio.filter((e) => monthKey(e.date) === m).reduce((s, e) => s + (e.distanceKm || 0), 0),
    dim: m !== thisMonth,
  }));

  const children = [stats];
  if (bars.some((b) => b.value > 0)) {
    children.push(el('h3', { class: 'section-title', text: '月別の距離 (km)' }));
    children.push(barChart({ bars, color: 'var(--c-run)', unit: 'km', decimals: 1 }));
  }
  return card('ランニング・有酸素', children);
}

// --- 5. 種目別の伸び --------------------------------------------------------

function exerciseProgressCard() {
  const { entries, prefs } = state.getState();
  const counts = new Map();
  for (const e of entries) {
    if (!state.exerciseById(e.exerciseId)) continue;
    counts.set(e.exerciseId, (counts.get(e.exerciseId) || 0) + 1);
  }
  // 記録の多い種目から並べる。既定で選ばれるのがいちばん見たい種目になるように。
  const usedIds = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a));

  if (!usedIds.length) {
    return card('種目別の伸び', emptyState('種目ごとの記録がまだありません', '同じ種目を数回記録すると、重量とボリュームの推移が出ます。'));
  }

  const selectedId = usedIds.includes(prefs.dashboardExerciseId) ? prefs.dashboardExerciseId : usedIds[0];
  const exercise = state.exerciseById(selectedId);

  const picker = selectField({
    label: null,
    options: usedIds.map((id) => ({ value: id, label: state.exerciseName(id) })),
    value: selectedId,
  });
  picker.select.addEventListener('change', () => {
    state.savePrefs({ dashboardExerciseId: picker.get() });
  });

  const rows = state.entriesForExercise(selectedId).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  const children = [picker.root];

  const pb = state.personalBests(selectedId);
  if (pb) {
    children.push(el('div', { class: 'stat-grid' }, [
      pb.max1RM ? stat({ label: '推定1RM ベスト', value: fmtTrim(pb.max1RM.value), unit: 'kg', sub: formatDateJa(pb.max1RM.date), tone: 'good' }) : null,
      pb.maxWeight ? stat({ label: '最大重量', value: fmtTrim(pb.maxWeight.value), unit: 'kg', sub: formatDateJa(pb.maxWeight.date) }) : null,
      pb.maxVolume ? stat({ label: '最大ボリューム', value: fmtTrim(pb.maxVolume.value, 0), unit: 'kg', sub: formatDateJa(pb.maxVolume.date) }) : null,
      pb.maxDistance ? stat({ label: '最長距離', value: fmtTrim(pb.maxDistance.value, 2), unit: 'km', sub: formatDateJa(pb.maxDistance.date) }) : null,
    ].filter(Boolean)));
  }

  // 有酸素は重量ではなく距離とペースの推移を見る。
  if (exercise.kind === 'cardio') {
    const distByDate = new Map();
    const paceByDate = new Map();
    for (const e of rows) {
      if (e.distanceKm) distByDate.set(e.date, (distByDate.get(e.date) || 0) + e.distanceKm);
      if (e.distanceKm && e.durationMin) paceByDate.set(e.date, e.durationMin / e.distanceKm);
    }
    const distPoints = [...distByDate.entries()].map(([date, value]) => ({ date, value }));
    const pacePoints = [...paceByDate.entries()].map(([date, value]) => ({ date, value }));

    if (distPoints.length > 1) {
      children.push(el('h3', { class: 'section-title', text: '1 回あたりの距離 (km)' }));
      children.push(lineChart({ points: distPoints, color: 'var(--c-run)', unit: 'km', decimals: 2 }));
    }
    if (pacePoints.length > 1) {
      children.push(el('h3', { class: 'section-title', text: 'ペース (分/km ・ 下がるほど速い)' }));
      children.push(lineChart({ points: pacePoints, color: 'var(--c-run)', unit: '分/km', decimals: 2 }));
    }
    if (distPoints.length <= 1 && pacePoints.length <= 1) {
      children.push(el('p', { class: 'field-hint', text: `${exercise.name} は推移を出せる記録がまだ足りません。` }));
    }
    return card('種目別の伸び', children);
  }

  // 推定 1RM は日ごとの最大値を採る。
  const rmByDate = new Map();
  for (const e of rows) {
    const rm = estimate1RM(e.weight, e.reps);
    if (rm === null) continue;
    rmByDate.set(e.date, Math.max(rmByDate.get(e.date) || 0, rm));
  }
  const rmPoints = [...rmByDate.entries()].map(([date, value]) => ({ date, value }));

  if (rmPoints.length > 1) {
    children.push(el('h3', { class: 'section-title', text: '推定 1RM (kg)' }));
    children.push(lineChart({ points: rmPoints, color: 'var(--c-weight)', unit: 'kg', decimals: 1 }));
    children.push(el('div', { class: 'field-hint', text: '推定 1RM = 重さ × (1 + 回数 ÷ 30)。同じ重さでも回数が伸びれば上がります。' }));
  }

  // 週ごとの総ボリューム (直近 12 週)
  const weekly = new Map();
  for (const e of rows) {
    const vol = entryVolume(e);
    if (vol <= 0) continue;
    const wk = startOfWeek(e.date);
    weekly.set(wk, (weekly.get(wk) || 0) + vol);
  }
  if (weekly.size) {
    const weeks = [];
    let cursor = startOfWeek(addDays(today(), -77));
    for (let i = 0; i < 12; i++) {
      weeks.push(cursor);
      cursor = addDays(cursor, 7);
    }
    const bars = weeks.map((w) => ({
      label: `${parseDate(w).getMonth() + 1}/${parseDate(w).getDate()}`,
      value: weekly.get(w) || 0,
    }));
    if (bars.some((b) => b.value > 0)) {
      children.push(el('h3', { class: 'section-title', text: '週ごとの総ボリューム (kg)' }));
      children.push(barChart({ bars, color: 'var(--c-train)', unit: '', decimals: 0 }));
    }
  }

  if (rmPoints.length <= 1 && !weekly.size) {
    children.push(el('p', { class: 'field-hint', text: `${exercise.name} は数値の推移を出せる記録がまだ足りません。` }));
  }

  return card('種目別の伸び', children);
}

export default {
  title: 'ホーム',
  render,
};
