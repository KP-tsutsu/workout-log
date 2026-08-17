// マスタ・設定タブ。種目マスタへの入り口、目標、データの持ち出しと復元。

import * as state from '../state.js';
import * as db from '../db.js';
import { fetchLatest, getSyncStatus, onSyncChange, pullAndRestore, push } from '../sync.js';
import {
  card, confirmSheet, dateField, el, list, listRow, numberField, toast,
} from '../ui.js';
import { fmtTrim, formatStamp, today } from '../util.js';

function render(root, api) {
  root.appendChild(masterCard(api));
  root.appendChild(goalCard());
  root.appendChild(syncCard());
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

function goalCard() {
  const g = state.getState().goals;

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

  const current = state.latestBody('weight');
  const hint = current && g.targetWeight !== null
    ? `現在 ${fmtTrim(current.value)}kg → 目標まで ${fmtTrim(Math.max(0, current.value - g.targetWeight))}kg`
    : '記録を入れると、ここに目標までの差が出ます。';

  return card('目標', [
    targetWeight.root,
    targetFat.root,
    targetDate.root,
    height.root,
    startWeight.root,
    el('p', { class: 'field-hint', text: hint }),
  ]);
}

// --- Mac との同期 -----------------------------------------------------------

// 画面は作り直されるので、前回の購読を捨ててから貼り直す。
let unsubscribeSync = null;

function syncCard() {
  const status = getSyncStatus();
  const dot = el('span', { class: 'sync-dot' });
  const statusText = el('span', { class: 'sub' });

  function paint(s) {
    dot.className = `sync-dot ${s.online === true ? 'ok' : s.online === false ? 'off' : ''}`.trim();
    statusText.textContent = s.inFlight
      ? '送信中…'
      : s.online === true
        ? `接続中 ・ 最終バックアップ ${formatStamp(s.lastSyncAt)}`
        : s.online === false
          ? `Mac に接続できていません ・ 最終バックアップ ${formatStamp(s.lastSyncAt)}`
          : '確認中…';
  }
  paint(status);
  if (unsubscribeSync) unsubscribeSync();
  unsubscribeSync = onSyncChange(paint);

  const sendBtn = el('button', {
    class: 'btn',
    type: 'button',
    text: 'Mac へ今すぐ送信',
    onclick: async () => {
      try {
        await push({ quiet: false });
      } catch {
        // push 側でトーストを出している
      }
    },
  });

  const restoreBtn = el('button', {
    class: 'btn',
    type: 'button',
    text: 'Mac から復元',
    onclick: async () => {
      let snapshot;
      try {
        snapshot = await fetchLatest();
      } catch {
        toast('Mac に接続できませんでした', 'error');
        return;
      }
      if (!snapshot) {
        toast('Mac にバックアップがありません', 'error');
        return;
      }
      const bodyCount = (snapshot.stores.body || []).length;
      const entryCount = (snapshot.stores.entries || []).length;
      const ok = await confirmSheet({
        title: 'Mac から復元',
        message:
          `${formatStamp(snapshot.receivedAt || snapshot.exportedAt)} 時点のバックアップ` +
          `(体組成 ${bodyCount} 件・トレーニング ${entryCount} 件) で、この端末の記録を置き換えます。`,
        okLabel: '置き換える',
        danger: true,
      });
      if (!ok) return;
      await pullAndRestore('replace');
    },
  });

  return card('Mac との同期', [
    el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--dim)' } }, [dot, statusText]),
    el('div', { class: 'btn-row' }, [sendBtn, restoreBtn]),
    el('p', {
      class: 'field-hint',
      text: '記録は自動で Mac に預けられます。ルーターの再起動などで接続先のアドレスが変わり記録が見えなくなった場合は、ここから戻せます。',
    }),
    el('p', { class: 'field-hint', text: `接続先: ${location.origin}` }),
  ]);
}

// --- バックアップファイル ----------------------------------------------------

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

  const prefs = state.getState().prefs;

  return card('バックアップファイル', [
    el('div', { class: 'btn-row' }, [exportBtn, importBtn]),
    fileInput,
    el('p', { class: 'field-hint', text: `最後の書き出し: ${formatStamp(prefs.lastExportAt)}` }),
    el('p', {
      class: 'note',
      text: '書き出したファイルは「ファイル」アプリに保存されます。機種変更のときや、Mac ごと入れ替えるときはこれで持ち運べます。',
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
    el('p', {
      class: 'note',
      text:
        '記録はこの iPhone の中と、自宅の Mac のバックアップにだけ保存されます。インターネットには公開していないので、外出先やジムでは開けません。\n' +
        'Mac でサーバーを起動していないときも、すでに開いている画面からの入力はできますが、新しく開くことはできません。',
    }),
  ]);
}

export default {
  title: 'マスタ・設定',
  render,
};
