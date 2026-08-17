// 日々の記録。体組成とトレーニング実績をこの 1 画面で入力する。
//
// 入力の手数を減らすことを最優先にしている:
//   - 種目はお気に入り → 最近使った の順で出す
//   - 出す入力欄はマスタの fields 定義だけで決まる
//   - 値は同じ種目の前回の記録で埋めておく
//   - 「保存して続ける」で同じ種目の次のセットをすぐ入れられる

import * as state from '../state.js';
import { CATEGORIES, FIELD_DEFS, FIELD_TO_PROP, normalizeFields } from '../db.js';
import {
  card, clear, confirmSheet, el, emptyState, list, listRow, numberField,
  openSheet, textField, toast,
} from '../ui.js';
import {
  addDays, entryVolume, fmtSigned, fmtTrim, formatDateJa, formatDateRelative, today,
} from '../util.js';
import { openExerciseEditor } from './master.js';

function currentDate(api) {
  return api.params.date || today();
}

// --- 画面 -------------------------------------------------------------------

function render(root, api) {
  const date = currentDate(api);
  root.appendChild(dateNav(date, api));
  root.appendChild(bodyCard(date));
  root.appendChild(trainingCard(date, api));
  root.appendChild(dayNoteCard(date));
}

function dateNav(date, api) {
  const picker = el('input', { type: 'date', value: date });
  picker.addEventListener('change', () => {
    if (picker.value) api.goto('log', { date: picker.value });
  });

  const label = el('button', {
    class: 'label',
    type: 'button',
    style: { border: '0', background: 'none', color: 'inherit' },
    onclick: () => {
      if (picker.showPicker) {
        try {
          picker.showPicker();
          return;
        } catch (e) {
          void e;
        }
      }
      picker.click();
    },
  }, [
    formatDateRelative(date),
    el('small', { text: formatDateJa(date, { withYear: true }) }),
  ]);

  return el('div', { class: 'datenav' }, [
    el('button', { class: 'nav', type: 'button', text: '‹', 'aria-label': '前の日', onclick: () => api.goto('log', { date: addDays(date, -1) }) }),
    label,
    picker,
    el('button', { class: 'nav', type: 'button', text: '›', 'aria-label': '次の日', onclick: () => api.goto('log', { date: addDays(date, 1) }) }),
  ]);
}

function bodyCard(date) {
  const row = state.bodyForDate(date);
  const goals = state.getState().goals;

  const prevWeight = previousValue(date, 'weight');
  const prevFat = previousValue(date, 'bodyFat');

  const weight = numberField({
    label: '体重',
    unit: 'kg',
    step: 0.1,
    decimals: 1,
    value: row ? row.weight : null,
    placeholder: prevWeight !== null ? `前回 ${fmtTrim(prevWeight)}` : '未入力',
  });
  const fat = numberField({
    label: '体脂肪率',
    unit: '%',
    step: 0.1,
    decimals: 1,
    value: row ? row.bodyFat : null,
    placeholder: prevFat !== null ? `前回 ${fmtTrim(prevFat)}` : '未入力',
  });

  const status = el('div', { class: 'field-hint', text: row ? '保存済み' : '入力すると自動で保存されます' });

  async function commit() {
    const saved = await state.saveBody(
      { date, weight: weight.get(), bodyFat: fat.get(), note: row ? row.note : '' },
      { silent: true },
    );
    status.textContent = saved ? '保存しました' : '入力すると自動で保存されます';
    clear(deltaBox);
    for (const n of deltaNodes(weight.get(), fat.get(), goals, date)) deltaBox.appendChild(n);
  }
  weight.input.addEventListener('change', commit);
  fat.input.addEventListener('change', commit);

  const deltaBox = el('div', { class: 'stat-grid' });
  for (const n of deltaNodes(row ? row.weight : null, row ? row.bodyFat : null, goals, date)) deltaBox.appendChild(n);

  // ＋−を押しやすくするため、数値の入力欄は横に並べず 1 列にしている。
  return card('体組成', [
    el('div', { style: { display: 'grid', gap: '12px' } }, [weight.root, fat.root]),
    status,
    deltaBox,
  ]);
}

/** 目標との差と、前回からの増減。 */
function deltaNodes(weight, bodyFat, goals, date) {
  const nodes = [];
  const prevWeight = previousValue(date, 'weight');
  const prevFat = previousValue(date, 'bodyFat');

  if (weight !== null && weight !== undefined) {
    if (goals.targetWeight !== null) {
      const diff = weight - goals.targetWeight;
      nodes.push(
        el('div', { class: 'stat' }, [
          el('div', { class: 'stat-label', text: '目標体重まで' }),
          el('div', { class: `stat-value delta ${diff <= 0 ? 'good' : ''}` }, [
            diff <= 0 ? '達成' : fmtTrim(diff),
            diff > 0 ? el('span', { class: 'unit', text: 'kg' }) : null,
          ]),
          el('div', { class: 'stat-sub', text: `目標 ${fmtTrim(goals.targetWeight)}kg` }),
        ]),
      );
    }
    if (prevWeight !== null) {
      const d = weight - prevWeight;
      nodes.push(
        el('div', { class: 'stat' }, [
          el('div', { class: 'stat-label', text: '前回比 (体重)' }),
          el('div', { class: `stat-value delta ${d <= 0 ? 'good' : 'bad'}` }, [
            fmtSigned(d), el('span', { class: 'unit', text: 'kg' }),
          ]),
        ]),
      );
    }
  }

  if (bodyFat !== null && bodyFat !== undefined) {
    if (goals.targetBodyFat !== null) {
      const diff = bodyFat - goals.targetBodyFat;
      nodes.push(
        el('div', { class: 'stat' }, [
          el('div', { class: 'stat-label', text: '目標体脂肪率まで' }),
          el('div', { class: `stat-value delta ${diff <= 0 ? 'good' : ''}` }, [
            diff <= 0 ? '達成' : fmtTrim(diff),
            diff > 0 ? el('span', { class: 'unit', text: '%' }) : null,
          ]),
          el('div', { class: 'stat-sub', text: `目標 ${fmtTrim(goals.targetBodyFat)}%` }),
        ]),
      );
    }
    if (prevFat !== null) {
      const d = bodyFat - prevFat;
      nodes.push(
        el('div', { class: 'stat' }, [
          el('div', { class: 'stat-label', text: '前回比 (体脂肪率)' }),
          el('div', { class: `stat-value delta ${d <= 0 ? 'good' : 'bad'}` }, [
            fmtSigned(d), el('span', { class: 'unit', text: '%' }),
          ]),
        ]),
      );
    }
  }
  return nodes;
}

/** その日より前で、いちばん近い記録の値。 */
function previousValue(date, key) {
  const rows = state.getState().body.filter((b) => b.date < date && b[key] !== null && b[key] !== undefined);
  return rows.length ? rows[rows.length - 1][key] : null;
}

function trainingCard(date, api) {
  const entries = state.entriesForDate(date);
  const addBtn = el('button', {
    class: 'btn primary block',
    type: 'button',
    text: '＋ 種目を追加',
    onclick: () => openExercisePicker(date, api),
  });

  if (!entries.length) {
    return card('トレーニング', [
      emptyState('この日の記録はまだありません', 'よく使う種目はお気に入りにしておくと、上のほうに出ます。'),
      addBtn,
    ]);
  }

  const totalVolume = entries.reduce((s, e) => s + entryVolume(e), 0);
  const totalDistance = entries.reduce((s, e) => s + (e.distanceKm || 0), 0);
  const totalMinutes = entries.reduce((s, e) => s + (e.durationMin || 0), 0);

  const summary = el('div', { class: 'stat-grid' }, [
    el('div', { class: 'stat' }, [
      el('div', { class: 'stat-label', text: '種目数' }),
      el('div', { class: 'stat-value', text: String(new Set(entries.map((e) => e.exerciseId)).size) }),
    ]),
    totalVolume > 0
      ? el('div', { class: 'stat' }, [
          el('div', { class: 'stat-label', text: '総ボリューム' }),
          el('div', { class: 'stat-value' }, [fmtTrim(totalVolume, 0), el('span', { class: 'unit', text: 'kg' })]),
        ])
      : null,
    totalDistance > 0
      ? el('div', { class: 'stat' }, [
          el('div', { class: 'stat-label', text: '距離' }),
          el('div', { class: 'stat-value' }, [fmtTrim(totalDistance, 2), el('span', { class: 'unit', text: 'km' })]),
        ])
      : null,
    totalMinutes > 0
      ? el('div', { class: 'stat' }, [
          el('div', { class: 'stat-label', text: '時間' }),
          el('div', { class: 'stat-value' }, [fmtTrim(totalMinutes, 0), el('span', { class: 'unit', text: '分' })]),
        ])
      : null,
  ]);

  return card('トレーニング', [
    summary,
    list(entries.map((entry) => entryRow(entry, date, api))),
    addBtn,
  ]);
}

export function entryRow(entry, date, api) {
  const ex = state.exerciseById(entry.exerciseId);
  const vol = entryVolume(entry);
  const isPr = state.isPersonalRecord(entry);
  return listRow({
    title: ex ? ex.name : '(削除された種目)',
    badge: isPr ? el('span', { class: 'badge pr', text: '自己ベスト' }) : null,
    sub: describeEntry(entry) || '記録なし',
    trail: vol > 0 ? `${fmtTrim(vol, 0)} kg` : '',
    onClick: () => openEntryEditor({ date, exercise: ex, entry, api }),
  });
}

/** 「60kg × 10回 × 3セット」のような 1 行の要約。 */
export function describeEntry(entry) {
  const parts = [];
  if (isSet(entry.weight)) parts.push(`${fmtTrim(entry.weight)}kg`);
  if (isSet(entry.reps)) parts.push(`${fmtTrim(entry.reps, 0)}回`);
  if (isSet(entry.sets)) parts.push(`${fmtTrim(entry.sets, 0)}セット`);
  if (isSet(entry.distanceKm)) parts.push(`${fmtTrim(entry.distanceKm, 2)}km`);
  if (isSet(entry.durationMin)) parts.push(`${fmtTrim(entry.durationMin, 0)}分`);
  const head = parts.join(' × ');
  return entry.memo ? `${head}${head ? ' ・ ' : ''}${entry.memo}` : head;
}

function isSet(v) {
  return v !== null && v !== undefined && v !== '';
}

function dayNoteCard(date) {
  const day = state.dayForDate(date);
  const note = textField({
    label: 'この日のメモ',
    value: day ? day.note : '',
    multiline: true,
    placeholder: '体調、気づいたことなど',
  });
  note.input.addEventListener('change', () => {
    state.saveDay(date, note.get());
  });
  return card(null, [note.root]);
}

// --- 種目選択 ---------------------------------------------------------------

export function openExercisePicker(date, api) {
  const handle = openSheet({
    title: '種目を選ぶ',
    body: (h) => {
      const search = el('input', { class: 'input', type: 'search', placeholder: '種目名で検索', 'aria-label': '種目名で検索' });
      const results = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } });

      const draw = () => {
        clear(results);
        const q = search.value.trim();
        const active = state.activeExercises();

        if (q) {
          const hits = active.filter((e) => e.name.includes(q) || (e.equipmentNote || '').includes(q));
          results.appendChild(
            hits.length
              ? list(hits.map((ex) => exerciseRow(ex, h)))
              : emptyState('見つかりませんでした', '下のボタンから新しい種目として登録できます。'),
          );
          return;
        }

        const favorites = active.filter((e) => e.favorite);
        if (favorites.length) {
          results.appendChild(el('h2', { class: 'section-title', text: 'お気に入り' }));
          results.appendChild(list(favorites.map((ex) => exerciseRow(ex, h))));
        }

        const recentIds = state.recentExerciseIds(6).filter((id) => {
          const ex = state.exerciseById(id);
          return ex && !ex.archived && !ex.favorite;
        });
        if (recentIds.length) {
          results.appendChild(el('h2', { class: 'section-title', text: '最近使った' }));
          results.appendChild(list(recentIds.map((id) => exerciseRow(state.exerciseById(id), h))));
        }

        for (const cat of CATEGORIES) {
          const group = active.filter((e) => e.category === cat);
          if (!group.length) continue;
          results.appendChild(el('h2', { class: 'section-title', text: cat }));
          results.appendChild(list(group.map((ex) => exerciseRow(ex, h))));
        }
      };

      search.addEventListener('input', draw);
      draw();
      return [search, results];
    },
    footer: [
      el('button', {
        class: 'btn block',
        type: 'button',
        text: '＋ 新しい種目を登録',
        onclick: () => {
          handle.close();
          openExerciseEditor(null, () => api.rerender());
        },
      }),
    ],
  });

  function exerciseRow(ex, h) {
    const last = state.lastEntryForExercise(ex.id, date);
    return listRow({
      title: ex.name,
      badge: ex.favorite ? el('span', { class: 'badge', text: '★' }) : null,
      sub: last ? `前回 ${formatDateJa(last.date)} ・ ${describeEntry(last)}` : ex.equipmentNote || '記録なし',
      onClick: () => {
        h.close();
        openEntryEditor({ date, exercise: ex, entry: null, api });
      },
    });
  }

  return handle;
}

// --- 実績の入力 -------------------------------------------------------------

/**
 * マスタの fields 定義から入力欄を組み立てる。
 * 値は 編集中の行 → 同じ種目の前回の記録 → マスタの既定値 の順で埋める。
 */
function buildEntryForm(exercise, entry, date) {
  const fields = normalizeFields(exercise.kind, exercise.fields);
  const last = entry ? null : state.lastEntryForExercise(exercise.id, date);
  const controls = [];

  for (const def of FIELD_DEFS) {
    const conf = fields[def.key];
    if (!conf.use) continue;
    const prop = FIELD_TO_PROP[def.key];
    let value = null;
    if (entry && entry[prop] !== null && entry[prop] !== undefined) value = entry[prop];
    else if (last && last[prop] !== null && last[prop] !== undefined) value = last[prop];
    else if (conf.default !== null && conf.default !== undefined) value = conf.default;

    const control = numberField({
      label: def.label,
      unit: def.unit,
      step: conf.step,
      decimals: def.decimals,
      value,
      required: conf.required,
      placeholder: '未入力',
    });
    controls.push({ def, conf, prop, control });
  }

  return { fields, controls, last };
}

export function openEntryEditor({ date, exercise, entry, api }) {
  if (!exercise) {
    toast('この記録の種目はマスタから削除されています', 'error');
    return null;
  }
  const isNew = !entry;
  const form = buildEntryForm(exercise, entry, date);

  const memo = textField({
    label: 'メモ',
    value: entry ? entry.memo : '',
    placeholder: '例: フォーム意識、最後の 1 回補助あり',
  });

  const pb = state.personalBests(exercise.id);
  const hints = [];
  if (form.last) {
    hints.push(`前回 (${formatDateJa(form.last.date)}) : ${describeEntry(form.last)}`);
  }
  if (pb && pb.max1RM) {
    hints.push(`自己ベスト 推定1RM ${fmtTrim(pb.max1RM.value)}kg`);
  } else if (pb && pb.maxDistance) {
    hints.push(`自己ベスト 距離 ${fmtTrim(pb.maxDistance.value, 2)}km`);
  }
  if (exercise.equipmentNote) hints.push(exercise.equipmentNote);

  const gridStyle = { display: 'grid', gap: '12px' };

  const handle = openSheet({
    title: exercise.name,
    right: '保存',
    onRight: () => submit(false),
    body: [
      hints.length ? el('p', { class: 'note', text: hints.join('\n') }) : null,
      card(null, [
        el('div', { style: gridStyle }, form.controls.map((c) => c.control.root)),
        memo.root,
      ]),
      isNew
        ? null
        : el('button', {
            class: 'btn danger block',
            type: 'button',
            text: 'この記録を削除',
            onclick: remove,
          }),
    ],
    footer: isNew
      ? [
          el('button', { class: 'btn', type: 'button', text: '保存して続ける', onclick: () => submit(true) }),
          el('button', { class: 'btn primary', type: 'button', text: '保存', onclick: () => submit(false) }),
        ]
      : [el('button', { class: 'btn primary block', type: 'button', text: '保存', onclick: () => submit(false) })],
  });

  function collect() {
    const values = { weight: null, reps: null, sets: null, distanceKm: null, durationMin: null };
    let ok = true;
    let anyValue = false;
    for (const { def, conf, prop, control } of form.controls) {
      const v = control.get();
      control.clearError();
      if (v === null && conf.required) {
        control.showError(`${def.label}は必須です`);
        ok = false;
        continue;
      }
      if (v !== null && v < 0) {
        control.showError('0 以上で入力してください');
        ok = false;
        continue;
      }
      values[prop] = v;
      if (v !== null) anyValue = true;
    }
    if (ok && !anyValue) {
      toast('どれか 1 つは入力してください', 'error');
      ok = false;
    }
    return ok ? values : null;
  }

  async function submit(keepOpen) {
    const values = collect();
    if (!values) return;
    await state.saveEntry({
      id: entry ? entry.id : null,
      date,
      exerciseId: exercise.id,
      order: entry ? entry.order : undefined,
      createdAt: entry ? entry.createdAt : undefined,
      ...values,
      memo: memo.get(),
    });

    if (keepOpen) {
      toast('保存しました。続けて入力できます', 'good');
      memo.set('');
      // 同じ重量で次のセットを入れることが多いので、値はそのまま残す。
      const first = form.controls[0];
      if (first) first.control.focus();
      return;
    }
    handle.close();
    toast(isNew ? '記録しました' : '保存しました', 'good');
    if (api) api.rerender();
  }

  async function remove() {
    const ok = await confirmSheet({
      title: '記録を削除',
      message: `${exercise.name} の「${describeEntry(entry)}」を削除します。`,
      okLabel: '削除する',
      danger: true,
    });
    if (!ok) return;
    await state.deleteEntry(entry.id);
    handle.close();
    toast('削除しました', 'good');
    if (api) api.rerender();
  }

  return handle;
}

export default {
  title: '記録',
  actions: (api) => {
    const date = currentDate(api);
    if (date === today()) return null;
    return el('button', {
      class: 'icon-btn',
      type: 'button',
      text: '今日へ',
      onclick: () => api.goto('log', { date: today() }),
    });
  },
  render,
};
