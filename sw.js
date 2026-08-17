// アプリ本体をキャッシュして、サーバーに繋がらなくても開けるようにする。
//
// 注意: Service Worker は HTTPS か localhost でしか動かない。
// 自宅 Wi-Fi の http://192.168.x.x では登録されないため、いまの構成では
// このファイルは使われない (js/app.js が isSecureContext のときだけ登録する)。
// HTTPS 化するか公開ホスティングに移した時点で、そのまま効き始める。

const CACHE = 'workout-log-v1';

const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/db.js',
  'js/state.js',
  'js/sync.js',
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
      .then((cache) => cache.addAll(SHELL))
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
  const url = new URL(event.request.url);

  // バックアップ API はキャッシュしない。繋がらなければ素直に失敗させる。
  if (url.pathname.includes('/api/')) return;
  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((hit) => {
      if (hit) {
        // 裏で最新を取りに行き、次回の起動に反映する。
        event.waitUntil(
          fetch(event.request)
            .then((res) => (res.ok ? caches.open(CACHE).then((c) => c.put(event.request, res)) : null))
            .catch(() => {}),
        );
        return hit;
      }
      return fetch(event.request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          event.waitUntil(caches.open(CACHE).then((c) => c.put(event.request, copy)));
        }
        return res;
      });
    }),
  );
});
