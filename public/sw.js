const CACHE = 'mint-v1';
const PRECACHE = ['/', '/app'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Network-first: API는 항상 네트워크, 나머지는 캐시 fallback.
// 외부 도메인(카카오 CDN·Supabase 등)은 건드리지 않는다 — 브라우저가 직접 처리하게 둔다.
// 네트워크도 캐시도 없으면 undefined가 아니라 Response.error()를 돌려준다
// (undefined를 respondWith에 넘기면 "Failed to convert value to 'Response'"로 요청 자체가 깨진다).
self.addEventListener('fetch', (e) => {
  if (e.request.url.includes('/api/')) return;
  if (new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request).catch(() =>
      caches.match(e.request).then((cached) => cached ?? Response.error())
    )
  );
});
