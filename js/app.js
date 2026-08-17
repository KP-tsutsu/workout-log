// 起動処理とタブの切り替え。

import * as state from './state.js';
import { clear, toast } from './ui.js';
import { initSync, offerRestoreIfEmpty } from './sync.js';
import dashboard from './views/dashboard.js';
import log from './views/log.js';
import history from './views/history.js';
import settings from './views/settings.js';
import master from './views/master.js';

// master はタブを持たないが「マスタ・設定」タブの下の画面として扱う。
const VIEWS = { dashboard, log, history, settings, master };

const appEl = document.getElementById('app');
const bootEl = document.getElementById('boot');
const bootMsg = document.getElementById('boot-message');
const viewEl = document.getElementById('view');
const titleEl = document.getElementById('appbar-title');
const actionsEl = document.getElementById('appbar-actions');
const leadEl = document.getElementById('appbar-lead');

let currentTab = 'dashboard';
let params = {};
let rendering = false;

/** 各ビューに渡す操作口。 */
const api = {
  goto(tab, nextParams = {}) {
    currentTab = tab;
    params = nextParams;
    syncTabButtons();
    render();
    viewEl.scrollIntoView({ block: 'start' });
    window.scrollTo(0, 0);
  },
  get params() {
    return params;
  },
  setParams(patch) {
    params = { ...params, ...patch };
  },
  rerender: () => render(),
  toast,
};

function syncTabButtons() {
  const active = (VIEWS[currentTab] && VIEWS[currentTab].tab) || currentTab;
  for (const btn of document.querySelectorAll('.tab')) {
    btn.setAttribute('aria-selected', btn.dataset.tab === active ? 'true' : 'false');
  }
}

function render() {
  const view = VIEWS[currentTab];
  if (!view) return;
  rendering = true;
  try {
    titleEl.textContent = typeof view.title === 'function' ? view.title(api) : view.title;

    clear(leadEl);
    if (view.back) {
      const back = document.createElement('button');
      back.className = 'icon-btn';
      back.type = 'button';
      back.textContent = '‹ 戻る';
      back.addEventListener('click', () => api.goto(view.back, {}));
      leadEl.appendChild(back);
    }

    clear(actionsEl);
    if (view.actions) {
      const nodes = view.actions(api);
      for (const n of Array.isArray(nodes) ? nodes : [nodes]) if (n) actionsEl.appendChild(n);
    }
    clear(viewEl);
    view.render(viewEl, api);
  } catch (e) {
    console.error('描画に失敗しました', e);
    clear(viewEl);
    const p = document.createElement('p');
    p.className = 'note warn';
    p.textContent = '画面の描画でエラーが発生しました: ' + e.message;
    viewEl.appendChild(p);
  } finally {
    rendering = false;
  }
}

for (const btn of document.querySelectorAll('.tab')) {
  btn.addEventListener('click', () => api.goto(btn.dataset.tab, {}));
}

// データが変わったら今の画面を描き直す。
// '-quiet' は入力中の自動保存。画面を作り直すと入力欄のフォーカスが飛ぶので触らない
// (同期は別途この通知を受け取っている)。
state.subscribe((reason) => {
  if (rendering) return;
  if (typeof reason === 'string' && reason.endsWith('-quiet')) return;
  render();
});

async function boot() {
  try {
    await state.load();
  } catch (e) {
    console.error(e);
    bootMsg.textContent =
      'データの読み込みに失敗しました。プライベートブラウズを使っていると保存できないことがあります。\n' + e.message;
    return;
  }

  bootEl.hidden = true;
  appEl.hidden = false;
  syncTabButtons();
  render();

  // 同期は画面が出てから。失敗しても記録の妨げにはしない。
  initSync();
  offerRestoreIfEmpty().catch((e) => console.warn('復元の確認に失敗', e));

  // データを消されにくくするための申告。断られても動作は変わらない。
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persisted().then((p) => {
      if (!p) navigator.storage.persist().catch(() => {});
    });
  }

  // Service Worker は HTTPS か localhost でしか動かない。
  // 自宅 Wi-Fi の http:// では登録しても失敗するだけなので、その時だけ登録する。
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW 登録失敗', e));
  }
}

boot();
