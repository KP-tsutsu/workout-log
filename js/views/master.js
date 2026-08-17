// 種目マスタ。ジムの器具・種目を登録し、記録時にどの入力項目を出すかを決める。

import * as state from '../state.js';
import { CATEGORIES, FIELD_DEFS, KINDS, defaultFields, normalizeFields } from '../db.js';
import {
  card, clear, confirmSheet, el, emptyState, list, listRow, numberField,
  openSheet, segmented, selectField, switchRow, textField, toast,
} from '../ui.js';

/** 「重さ・回数・セット数」のように、その種目で使う項目を並べた文字列。 */
export function fieldsSummary(exercise) {
  const fields = normalizeFields(exercise.kind, exercise.fields);
  const used = FIELD_DEFS.filter((d) => fields[d.key].use);
  if (!used.length) return '入力項目なし';
  return used.map((d) => (fields[d.key].required ? `${d.label}*` : d.label)).join('・');
}

let filter = 'all';

function render(root, api) {
  const all = state.getState().exercises;
  const showArchived = filter === 'archived';
  let rows = all.filter((e) => (showArchived ? e.archived : !e.archived));
  if (filter === 'favorite') rows = rows.filter((e) => e.favorite);
  else if (CATEGORIES.includes(filter)) rows = rows.filter((e) => e.category === filter);

  const chips = el('div', { class: 'chips' });
  const options = [
    { value: 'all', label: 'すべて' },
    { value: 'favorite', label: 'お気に入り' },
    ...CATEGORIES.map((c) => ({ value: c, label: c })),
    { value: 'archived', label: '非表示中' },
  ];
  for (const opt of options) {
    const b = el('button', {
      class: 'chip',
      type: 'button',
      text: opt.label,
      'aria-selected': filter === opt.value ? 'true' : 'false',
    });
    b.addEventListener('click', () => {
      filter = opt.value;
      api.rerender();
    });
    chips.appendChild(b);
  }
  root.appendChild(chips);

  root.appendChild(
    el('p', {
      class: 'note',
      text: '種目ごとに「使う入力項目」と「必須項目」を決めておくと、記録画面に必要な欄だけが出ます。項目名のあとの * は必須です。',
    }),
  );

  if (!rows.length) {
    root.appendChild(card(null, emptyState(showArchived ? '非表示の種目はありません' : '該当する種目がありません', '右上の「+ 新規」から追加できます。')));
    return;
  }

  const byCategory = new Map();
  for (const ex of rows) {
    if (!byCategory.has(ex.category)) byCategory.set(ex.category, []);
    byCategory.get(ex.category).push(ex);
  }

  for (const cat of CATEGORIES) {
    const group = byCategory.get(cat);
    if (!group || !group.length) continue;
    root.appendChild(el('h2', { class: 'section-title', text: cat }));
    root.appendChild(
      list(
        group.map((ex) =>
          listRow({
            title: ex.name,
            badge: ex.favorite ? el('span', { class: 'badge', text: '★' }) : null,
            sub: `${KINDS[ex.kind]} ・ ${fieldsSummary(ex)}${ex.equipmentNote ? ' ・ ' + ex.equipmentNote : ''}`,
            onClick: () => openExerciseEditor(ex, api.rerender),
          }),
        ),
      ),
    );
  }
}

/**
 * 種目の新規作成・編集シート。
 * exercise が null なら新規。保存・削除の後に onDone が呼ばれる。
 */
export function openExerciseEditor(exercise, onDone) {
  const isNew = !exercise;
  const draft = exercise
    ? { ...exercise, fields: normalizeFields(exercise.kind, exercise.fields) }
    : {
        id: null,
        name: '',
        category: '胸',
        kind: 'strength',
        fields: defaultFields('strength'),
        equipmentNote: '',
        favorite: false,
        archived: false,
      };

  const nameField = textField({ label: '種目名', value: draft.name, required: true, placeholder: '例: ベンチプレス' });
  const categoryField = selectField({
    label: 'カテゴリ',
    options: CATEGORIES.map((c) => ({ value: c, label: c })),
    value: draft.category,
  });
  const equipField = textField({
    label: '器具メモ',
    value: draft.equipmentNote,
    placeholder: '例: 2 階の 3 番マシン',
    hint: 'ジムの器具名やマシン番号など。記録画面にも表示されます。',
  });
  const favSwitch = switchRow({
    title: 'お気に入り',
    sub: '記録画面の種目選択で最初に出ます',
    checked: draft.favorite,
    onChange: (v) => { draft.favorite = v; },
  });

  const fieldsBox = el('div', { class: 'card' });

  const kindSeg = segmented(
    Object.entries(KINDS).map(([value, label]) => ({ value, label })),
    draft.kind,
    (kind) => {
      draft.kind = kind;
      draft.fields = defaultFields(kind);
      renderFieldsEditor();
      toast(`${KINDS[kind]}の標準的な入力項目に切り替えました`);
    },
  );

  function renderFieldsEditor() {
    clear(fieldsBox);
    fieldsBox.appendChild(el('h2', { class: 'card-title', text: '入力項目' }));
    fieldsBox.appendChild(
      el('div', { class: 'field-hint', text: '記録画面に出す欄と、空欄のままでは保存できない必須欄を決めます。' }),
    );

    for (const def of FIELD_DEFS) {
      const f = draft.fields[def.key];
      const detail = el('div', { style: { display: f.use ? 'grid' : 'none', gap: '10px', paddingLeft: '2px' } });

      const useRow = switchRow({
        title: `${def.label} (${def.unit})`,
        sub: f.use ? '記録画面に表示' : '記録画面に出さない',
        checked: f.use,
        onChange: (v) => {
          f.use = v;
          if (!v) f.required = false;
          renderFieldsEditor();
        },
      });

      if (f.use) {
        const reqRow = switchRow({
          title: '必須にする',
          sub: '空欄のままでは保存できなくなります',
          checked: f.required,
          onChange: (v) => { f.required = v; },
        });
        const stepInput = numberField({
          label: '＋−の刻み',
          unit: def.unit,
          step: def.key === 'weight' ? 0.5 : 1,
          decimals: def.decimals,
          value: f.step,
          min: 0,
        });
        stepInput.input.addEventListener('change', () => {
          const v = stepInput.get();
          if (v && v > 0) f.step = v;
        });
        stepInput.input.addEventListener('input', () => {
          const v = stepInput.get();
          if (v && v > 0) f.step = v;
        });
        const defaultInput = numberField({
          label: '既定値',
          unit: def.unit,
          step: f.step,
          decimals: def.decimals,
          value: f.default,
          placeholder: '空欄可',
          hint: '前回の記録が無いときの初期値',
        });
        const syncDefault = () => { f.default = defaultInput.get(); };
        defaultInput.input.addEventListener('change', syncDefault);
        defaultInput.input.addEventListener('input', syncDefault);

        detail.appendChild(reqRow.root);
        detail.appendChild(stepInput.root);
        detail.appendChild(defaultInput.root);
      }

      fieldsBox.appendChild(
        el('div', { style: { borderBottom: '1px solid var(--line)', paddingBottom: '8px' } }, [useRow.root, detail]),
      );
    }
  }

  renderFieldsEditor();

  const handle = openSheet({
    title: isNew ? '種目を追加' : '種目を編集',
    right: '保存',
    onRight: save,
    body: [
      card(null, [
        nameField.root,
        categoryField.root,
        el('div', { class: 'field' }, [
          el('div', { class: 'field-label', text: '種別' }),
          kindSeg,
          el('div', { class: 'field-hint', text: '切り替えると入力項目がその種別の標準に戻ります。' }),
        ]),
        equipField.root,
        favSwitch.root,
      ]),
      fieldsBox,
      isNew
        ? null
        : el('button', {
            class: 'btn danger block',
            type: 'button',
            text: 'この種目を削除',
            onclick: remove,
          }),
      isNew || !draft.archived
        ? null
        : el('button', {
            class: 'btn block',
            type: 'button',
            text: '非表示を解除して使えるようにする',
            onclick: async () => {
              await state.saveExercise({ ...draft, archived: false, name: nameField.get() || draft.name });
              handle.close();
              toast('また使えるようになりました', 'good');
              if (onDone) onDone();
            },
          }),
    ],
  });

  async function save() {
    const name = nameField.get();
    if (!name) {
      nameField.showError('種目名を入力してください');
      nameField.focus();
      return;
    }
    const used = FIELD_DEFS.some((d) => draft.fields[d.key].use);
    if (!used) {
      toast('入力項目を 1 つ以上「使う」にしてください', 'error');
      return;
    }
    await state.saveExercise({
      ...draft,
      name,
      category: categoryField.get(),
      equipmentNote: equipField.get(),
      favorite: favSwitch.get(),
    });
    handle.close();
    toast(isNew ? '種目を追加しました' : '保存しました', 'good');
    if (onDone) onDone();
  }

  async function remove() {
    const ok = await confirmSheet({
      title: '種目を削除',
      message: `「${draft.name}」を削除します。すでに実績がある場合は、記録を残すため削除ではなく非表示にします。`,
      okLabel: '削除する',
      danger: true,
    });
    if (!ok) return;
    const result = await state.deleteExercise(draft.id);
    handle.close();
    toast(result === 'archived' ? '実績があるため非表示にしました' : '削除しました', 'good');
    if (onDone) onDone();
  }

  return handle;
}

export default {
  title: '種目マスタ',
  tab: 'settings',
  back: 'settings',
  actions: (api) => [
    el('button', {
      class: 'icon-btn',
      type: 'button',
      text: '＋ 新規',
      onclick: () => openExerciseEditor(null, api.rerender),
    }),
  ],
  render,
};
