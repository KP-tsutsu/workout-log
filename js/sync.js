// Mac への自動バックアップ。
//
// 記録の正本は iPhone の IndexedDB だが、ブラウザのデータは接続先 URL に
// 紐づいているため、Mac の IP が変わると見えなくなる。それを事故にしないよう、
// 接続できているあいだは Mac 側にスナップショットを預けておき、
// 空の状態で開かれたときに復元を提案する。

import * as db from './db.js';
import * as state from './state.js';
import { confirmSheet, toast } from './ui.js';
import { formatStamp } from './util.js';

const DEBOUNCE_MS = 5000;

let timer = null;
let inFlight = false;
let online = null; // null = 未確認
const watchers = new Set();

export function onSyncChange(fn) {
  watchers.add(fn);
  return () => watchers.delete(fn);
}

function notify() {
  for (const fn of watchers) {
    try {
      fn(getSyncStatus());
    } catch (e) {
      console.error(e);
    }
  }
}

export function getSyncStatus() {
  return { online, lastSyncAt: state.getState().prefs.lastSyncAt, inFlight };
}

/** データが変わったら少し待ってから送る。連続入力のたびに送らないため。 */
export function initSync() {
  state.subscribe((reason) => {
    if (reason === 'restore') return; // 復元直後は送り返さない
    schedule();
  });
  push().catch(() => {});
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    push().catch((e) => console.warn('同期に失敗', e));
  }, DEBOUNCE_MS);
}

/** 今すぐ Mac へ送る。成功したら true。 */
export async function push({ quiet = true } = {}) {
  if (inFlight) return false;
  inFlight = true;
  notify();
  try {
    const snapshot = await db.dump();
    const res = await fetch('api/backup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(snapshot),
    });
    if (!res.ok) throw new Error(`サーバーが ${res.status} を返しました`);
    online = true;
    await state.savePrefsQuiet({ lastSyncAt: new Date().toISOString() });
    if (!quiet) toast('Mac にバックアップしました', 'good');
    return true;
  } catch (e) {
    online = false;
    if (!quiet) toast('Mac に接続できませんでした', 'error');
    throw e;
  } finally {
    inFlight = false;
    notify();
  }
}

/** Mac に預けてある最新スナップショットを取る。無ければ null。 */
export async function fetchLatest() {
  const res = await fetch('api/backup/latest', { cache: 'no-store' });
  if (res.status === 204) {
    online = true;
    notify();
    return null;
  }
  if (!res.ok) throw new Error(`サーバーが ${res.status} を返しました`);
  online = true;
  notify();
  return res.json();
}

/** Mac のバックアップで置き換える。 */
export async function pullAndRestore(mode = 'replace') {
  const snapshot = await fetchLatest();
  if (!snapshot) {
    toast('Mac にバックアップがありません', 'error');
    return false;
  }
  await state.restoreFrom(snapshot, mode);
  toast('Mac のバックアップから復元しました', 'good');
  return true;
}

/**
 * この端末に記録が無く、Mac 側にバックアップがある場合だけ復元を持ちかける。
 * 勝手に上書きはしない。
 */
export async function offerRestoreIfEmpty() {
  if (!(await db.isEmpty())) return false;

  let snapshot;
  try {
    snapshot = await fetchLatest();
  } catch {
    // サーバーが動いていないだけ。記録の妨げにはしない。
    online = false;
    notify();
    return false;
  }
  if (!snapshot || !snapshot.stores) return false;

  const bodyCount = (snapshot.stores.body || []).length;
  const entryCount = (snapshot.stores.entries || []).length;
  if (!bodyCount && !entryCount) return false;

  const stamp = formatStamp(snapshot.receivedAt || snapshot.exportedAt);
  const ok = await confirmSheet({
    title: 'Mac にバックアップがあります',
    message:
      `この端末には記録がありませんが、Mac に ${stamp} 時点のバックアップ` +
      `(体組成 ${bodyCount} 件・トレーニング ${entryCount} 件) があります。復元しますか?\n\n` +
      'ルーターの再起動などで接続先のアドレスが変わると、ブラウザからは別のサイト扱いになり記録が見えなくなります。その場合はここから戻せます。',
    okLabel: '復元する',
  });
  if (!ok) return false;

  await state.restoreFrom(snapshot, 'replace');
  toast('復元しました', 'good');
  return true;
}
