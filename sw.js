// アプリ本体をキャッシュして、電波が無くても開けるようにする。
//
// 記録データはこの中に入らない (IndexedDB にあり Service Worker は触らない)。
// ここで扱うのは HTML/CSS/JS と画像だけ。
//
// 更新の方針:
//   - 画面そのもの (ナビゲーション) はネットワーク優先。オンラインなら常に最新が出る
//   - CSS/JS/画像はキャッシュ優先 + 裏で取り直し。表示は速いまま、次回起動で新しくなる
//   - それでも古いままなら、設定画面の「アプリを最新にする」で全部消して取り直せる

const VERSION = 'v3';
const CACHE = `workout-log-${VERSION}`;

const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/db.js',
  'js/state.js',
  'js/ui.js',
  'js/util.js',
  'js/charts.js',
  'js/views/dashboard.js',
  'js/views/log.js',
  'js/views/history.js',
  'js/views/master.js',
  'js/views/settings.js',
  'assets/icon-180.png',
  'assets/icon-192.png',
  'assets/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // 1 つでも取れないと全部失敗するので、個別に入れて欠けは許容する。
      .then((cache) => Promise.all(
        SHELL.map((path) => cache.add(path).catch((e) => console.warn('キャッシュできず', path, e))),
      ))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 画面はネットワーク優先。オフラインのときだけキャッシュから返す。
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('index.html'))),
    );
    return;
  }

  // それ以外はキャッシュ優先 + 裏で取り直し。
  event.respondWith(
    caches.match(req).then((hit) => {
      const fetching = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => hit);
      return hit || fetching;
    }),
  );
});
