const CACHE_NAME = 'chicken-rice-v1.20';
const filesToCache = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'
];

// 安裝 Service Worker
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(filesToCache);
      })
      .then(() => {
        // 強制讓新的 service worker 立即取得控制權
        return self.skipWaiting();
      })
  );
});

// 啟動時清理舊快取
self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      // 清理舊版本的快取
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              return caches.delete(cacheName);
            }
          })
        );
      }),
      // 確保新的 service worker 立即取得控制權
      self.clients.claim()
    ])
  );
});

// 處理資源請求
self.addEventListener('fetch', (event) => {
  // 排除 Google Analytics 請求
  if (event.request.url.includes('google-analytics.com')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        // 檢查是否得到了有效的回應
        if (networkResponse && networkResponse.status === 200) {
          // 複製響應以供快取使用
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME)
            .then((cache) => {
              cache.put(event.request, responseToCache);
            });
          return networkResponse;
        }
        throw new Error('Network response was not ok');
      })
      .catch(() => {
        // 網路請求失敗時使用快取
        return caches.match(event.request)
          .then((response) => {
            if (response) {
              return response;
            }
            // 如果快取中也沒有，返回一個離線頁面或錯誤響應
            if (event.request.mode === 'navigate') {
              return caches.match('./offline.html');
            }
            return new Response('Network error occurred', {
              status: 503,
              statusText: 'Service Unavailable'
            });
          });
      })
  );
});

// 監聽推送消息，處理更新提示
self.addEventListener('message', (event) => {
  if (event.data.action === 'skipWaiting') {
    self.skipWaiting();
  }
});
