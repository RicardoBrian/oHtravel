// 앱 셸(같은 출처의 정적 파일)만 캐싱 — Firestore/외부 API 요청은 손대지 않음.
// stale-while-revalidate: 캐시 있으면 즉시 응답 + 백그라운드로 최신본 받아서 캐시 갱신.
// 네트워크가 불안정한 순간(홈화면 웹앱 재실행 등)에도 앱 자체는 항상 뜨게 하는 게 목적.
const CACHE_NAME = 'ohtravel-shell-v1';
const SHELL_FILES = ['./', './index.html', './app.js', './styles.css', './icon.svg', './apple-touch-icon.png'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(names =>
      Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;

  event.respondWith(
    caches.match(req).then(cached => {
      const networkFetch = fetch(req).then(res => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
        }
        return res;
      }).catch(() => cached);
      return cached || networkFetch;
    })
  );
});
