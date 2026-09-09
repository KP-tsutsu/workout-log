// マスタ・設定タブ。種目マスタへの入り口、目標、データの持ち出しと復元。

import * as state from '../state.js';
import * as db from '../db.js';
import {
  card, confirmSheet, dateField, el, list, listRow, numberField, toast,
} from '../ui.js';
import { daysBetween, fmtTrim, formatDateJa, formatStamp, today, toDateStr } from '../util.js';

function render(root, api) {
  root.appendChild(masterCard(api));
  root.appendChild(goalCard(api));
  root.appendChild(backupCard());
  root.appendChild(aboutCard());
}

// --- 種目マスタへの入り口 ----------------------------------------------------

function masterCard(api) {
  const all = state.getState().exercises;
  const active = all.filter((e) => !e.archived);
  const favorites = active.filter((e) => e.favorite);
  return card(null, [
    list([
      listRow({
        title: '種目マスタ',
        sub: `${active.length} 種目 (お気に入り ${favorites.length}) ・ 非表示 ${all.length - active.length}`,
        onClick: () => api.goto('master', {}),
      }),
    ]),
    el('p', { class: 'field-hint', text: '種目ごとに必須の入力項目を決めておくと、記録画面に必要な欄だけが出ます。' }),
  ]);
}

// --- 目標 -------------------------------------------------------------------

// 目標はめったに変えないうえ、うっかり変わっても何週間も気づかない。
// 既定では読むだけにして、「編集」を押したときだけ入力欄を出す。
let goalEditing = false;

function goalCard(api) {
  const g = state.getState().goals;
  const current = state.latestBody('weight');
  const hint = current && g.targetWeight !== null
    ? `現在 ${fmtTrim(current.value)}kg → 目標まで ${fmtTrim(Math.max(0, current.value - g.targetWeight))}kg`
    : '記録を入れると、ここに目標までの差が出ます。';

  if (!goalEditing) return goalCardReadOnly(g, hint, api);
  return goalCardEditing(g, hint, api);
}

/** 読むだけの表示。入力欄が無いので、スクロール中に値が変わることがない。 */
function goalCardReadOnly(g, hint, api) {
  const rows = [
    ['目標体重', g.targetWeight === null ? '未設定' : `${fmtTrim(g.targetWeight)} kg`],
    ['目標体脂肪率', g.targetBodyFat === null ? '未設定' : `${fmtTrim(g.targetBodyFat)} %`],
    ['目標日', g.targetDate ? formatDateJa(g.targetDate, { withYear: true }) : '未設定'],
    ['身長', g.height === null ? '未設定' : `${fmtTrim(g.height)} cm`],
    ['開始体重', g.startWeight === null
      ? (state.startValue('weight') === null ? '未設定' : `${fmtTrim(state.startValue('weight'))} kg (最初の記録)`)
      : `${fmtTrim(g.startWeight)} kg`],
  ];

  const editBtn = el('button', {
    class: 'icon-btn',
    type: 'button',
    text: '編集',
    onclick: () => {
      goalEditing = true;
      api.rerender();
    },
  });

  return card('目標', [
    el('div', { class: 'kv' }, rows.map(([k, v]) => el('div', { class: 'kv-row' }, [
      el('span', { class: 'kv-key', text: k }),
      el('span', { class: 'kv-value', text: v }),
    ]))),
    el('p', { class: 'field-hint', text: hint }),
  ], editBtn);
}

function goalCardEditing(g, hint, api) {
  const targetWeight = numberField({ label: '目標体重', unit: 'kg', step: 0.5, decimals: 1, value: g.targetWeight, placeholder: '未設定' });
  const targetFat = numberField({ label: '目標体脂肪率', unit: '%', step: 0.5, decimals: 1, value: g.targetBodyFat, placeholder: '未設定' });
  const targetDate = dateField({ label: '目標日 (任意)', value: g.targetDate, hint: '設定すると必要ペースと予測達成日が出ます' });
  const height = numberField({ label: '身長', unit: 'cm', step: 0.5, decimals: 1, value: g.height, placeholder: '未設定' });
  const startWeight = numberField({ label: '開始体重', unit: 'kg', step: 0.5, decimals: 1, value: g.startWeight, placeholder: '最初の記録から自動', hint: '進捗バーの起点' });

  // 入力欄の作り直しでフォーカスが飛ばないよう、静かに保存する。
  // ダッシュボードはタブを開き直したときに読み直される。
  const commit = () => {
    state.saveGoals({
      targetWeight: targetWeight.get(),
      targetBodyFat: targetFat.get(),
      targetDate: targetDate.get(),
      height: height.get(),
      startWeight: startWeight.get(),
    }, { silent: true });
  };
  for (const f of [targetWeight, targetFat, height, startWeight]) f.input.addEventListener('change', commit);
  targetDate.input.addEventListener('change', commit);

  const doneBtn = el('button', {
    class: 'icon-btn',
    type: 'button',
    text: '完了',
    onclick: () => {
      commit();
      goalEditing = false;
      api.rerender();
      toast('目標を保存しました', 'good');
    },
  });

  return card('目標', [
    targetWeight.root,
    targetFat.root,
    targetDate.root,
    height.root,
    startWeight.root,
    el('p', { class: 'field-hint', text: hint }),
    el('button', {
      class: 'btn block',
      type: 'button',
      text: '完了',
      onclick: () => doneBtn.click(),
    }),
  ], doneBtn);
}

// --- バックアップファイル ----------------------------------------------------

/** 最後の書き出しからの経過日数。一度も書き出していなければ null。 */
function daysSinceExport(prefs) {
  if (!prefs.lastExportAt) return null;
  const d = new Date(prefs.lastExportAt);
  if (Number.isNaN(d.getTime())) return null;
  return daysBetween(toDateStr(d), today());
}

function backupCard() {
  const exportBtn = el('button', {
    class: 'btn',
    type: 'button',
    text: 'JSON で書き出す',
    onclick: async () => {
      const snapshot = await db.dump();
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = el('a', { href: url, download: `workout-log-${today()}.json` });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      await state.savePrefs({ lastExportAt: new Date().toISOString() });
      toast('書き出しました', 'good');
    },
  });

  const fileInput = el('input', { type: 'file', accept: 'application/json,.json', style: { display: 'none' } });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    let snapshot;
    try {
      snapshot = JSON.parse(await file.text());
    } catch {
      toast('JSON として読めませんでした', 'error');
      return;
    }
    if (!snapshot || !snapshot.stores) {
      toast('このアプリのバックアップではないようです', 'error');
      return;
    }
    const bodyCount = (snapshot.stores.body || []).length;
    const entryCount = (snapshot.stores.entries || []).length;
    const ok = await confirmSheet({
      title: 'バックアップを読み込む',
      message:
        `体組成 ${bodyCount} 件・トレーニング ${entryCount} 件を読み込み、` +
        'この端末の記録を置き換えます。今の記録は失われます。',
      okLabel: '置き換える',
      danger: true,
    });
    if (!ok) return;
    await state.restoreFrom(snapshot, 'replace');
    toast('読み込みました', 'good');
  });

  const importBtn = el('button', {
    class: 'btn',
    type: 'button',
    text: 'JSON から読み込む',
    onclick: () => fileInput.click(),
  });

  const { prefs, body, entries } = state.getState();
  const elapsed = daysSinceExport(prefs);
  const hasData = body.length + entries.length > 0;

  // 記録の控えはこのファイルしか無いので、間が空いていたら目立たせる。
  const stale = hasData && (elapsed === null || elapsed >= 30);
  const status = elapsed === null
    ? 'まだ一度も書き出していません'
    : `最後の書き出し: ${formatStamp(prefs.lastExportAt)} (${elapsed}日前)`;

  return card('バックアップ', [
    stale
      ? el('p', { class: 'note warn', text: `${status}。記録はこの端末の中にしかありません。ときどき書き出しておいてください。` })
      : el('p', { class: 'field-hint', text: status }),
    el('div', { class: 'btn-row' }, [exportBtn, importBtn]),
    fileInput,
    el('p', {
      class: 'note',
      text:
        '書き出したファイルは iPhone の「ファイル」アプリに保存されます。iCloud Drive の中に入れておけば、機種変更のときもそのまま読み込めます。\n' +
        '記録はこの端末のブラウザの中だけにあり、どこにも送信されません。裏を返すと、端末を初期化したりブラウザのデータを消したりすると戻せません。',
    }),
  ]);
}

// --- 説明 -------------------------------------------------------------------

function aboutCard() {
  const { entries, body, exercises } = state.getState();
  return card('このアプリについて', [
    el('div', { class: 'stat-grid' }, [
      el('div', { class: 'stat' }, [
        el('div', { class: 'stat-label', text: 'トレーニング記録' }),
        el('div', { class: 'stat-value', text: String(entries.length) }),
      ]),
      el('div', { class: 'stat' }, [
        el('div', { class: 'stat-label', text: '体組成記録' }),
        el('div', { class: 'stat-value', text: String(body.length) }),
      ]),
      el('div', { class: 'stat' }, [
        el('div', { class: 'stat-label', text: '登録種目' }),
        el('div', { class: 'stat-value', text: String(exercises.length) }),
      ]),
    ]),
    offlineStatus(),
    el('p', {
      class: 'note',
      text:
        'アプリの本体はインターネット上にありますが、記録はこの端末の中にだけ保存され、どこにも送信されません。\n' +
        '一度開いたあとは電波が無くても動くので、ジムでもそのまま記録できます。',
    }),
    updateButton(),
  ]);
}

/** オフラインで開ける状態になっているか (Service Worker が有効かどうか)。 */
function offlineStatus() {
  const dot = el('span', { class: 'sync-dot' });
  const text = el('span', { text: '確認中…' });
  const row = el('div', {
    style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--dim)' },
  }, [dot, text]);

  if (!('serviceWorker' in navigator) || !window.isSecureContext) {
    dot.className = 'sync-dot off';
    text.textContent = 'オフライン対応は無効です (HTTPS で開くと有効になります)';
    return row;
  }

  navigator.serviceWorker.getRegistration().then((reg) => {
    if (reg && reg.active) {
      dot.className = 'sync-dot ok';
      text.textContent = 'オフラインでも開けます';
    } else {
      dot.className = 'sync-dot off';
      text.textContent = 'オフライン用の準備中です。もう一度開き直すと有効になります';
    }
  }).catch(() => {
    dot.className = 'sync-dot off';
    text.textContent = 'オフライン対応の状態を確認できませんでした';
  });

  return row;
}

/**
 * アプリ本体を最新にする。
 * オフライン用のキャッシュがあるぶん、更新を公開しても端末側が古いままのことが
 * あるので、明示的に取り直せる口を用意しておく。記録には触らない。
 */
function updateButton() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return null;
  return el('div', { style: { display: 'grid', gap: '6px' } }, [
    el('button', {
      class: 'btn block',
      type: 'button',
      text: 'アプリを最新にする',
      onclick: async () => {
        toast('最新版を取得しています…');
        try {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
          const reg = await navigator.serviceWorker.getRegistration();
          if (reg) await reg.update();
        } catch (e) {
          console.warn('更新に失敗', e);
        }
        location.reload();
      },
    }),
    el('p', { class: 'field-hint', text: '記録は消えません。アプリの画面や機能を更新したときに使います。' }),
  ]);
}

export default {
  title: 'マスタ・設定',
  render,
};
