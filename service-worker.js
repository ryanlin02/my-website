const CACHE_NAME = 'chicken-rice-v3.55';
const filesToCache = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
  // 移除 html2canvas 的預載入，改為動態載入
];

// 安裝 Service Worker
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(filesToCache);
      })
      // 移除自動 skipWaiting，改為手動控制更新時機
      // 這樣可以避免使用者在操作時突然被更新打斷
  );
});

// 啟動時清理舊快取
self.addEventListener('activate', (event) => {
  event.waitUntil(
    // 清理舊版本的快取
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
    // 移除 self.clients.claim()，讓新的 Service Worker 等到所有頁面關閉後才接管
    // 這樣可以避免使用者在操作時被打斷
  );
});

// 處理資源請求
self.addEventListener('fetch', (event) => {
  // 排除 Google Analytics 和 Firebase 請求
  if (event.request.url.includes('google-analytics.com') || 
      event.request.url.includes('firebasejs') ||
      event.request.url.includes('googleapis.com') ||
      event.request.url.includes('gstatic.com')) {
    return;
  }
  
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // 如果快取中有，先返回快取
        if (response) {
          // 同時更新快取
          fetch(event.request).then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, networkResponse.clone());
              });
            }
          });
          return response;
        }
        
        // 如果快取中沒有，從網路取得
        return fetch(event.request)
          .then((networkResponse) => {
            // 檢查是否得到了有效的回應
            if (networkResponse && networkResponse.status === 200) {
              // 複製響應以供快取使用
              const responseToCache = networkResponse.clone();
              caches.open(CACHE_NAME)
                .then((cache) => {
                  // 只快取同源的資源
                  if (event.request.url.startsWith(self.location.origin)) {
                    cache.put(event.request, responseToCache);
                  }
                });
              return networkResponse;
            }
            return networkResponse;
          })
          .catch(() => {
            // 網路請求失敗，返回錯誤
            console.error('網路請求失敗:', event.request.url);
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

// 監聽 install 事件，可以用來追蹤 PWA 的安裝
self.addEventListener('appinstalled', (event) => {
  // 當 PWA 被安裝時，在 service worker 中記錄
  console.log('PWA 應用已被使用者安裝');
});

// ========== 新增：智慧更新機制 ==========
// 說明：只有在使用者同意或頁面閒置時才更新

// 監聽來自頁面的更新請求
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    // 當使用者同意更新時，才執行 skipWaiting
    self.skipWaiting();
  }
});

// 通知所有客戶端有新版本可用
self.addEventListener('activate', function(event) {
  event.waitUntil(
    self.clients.matchAll().then(function(clients) {
      clients.forEach(function(client) {
        // 通知頁面有新版本已準備好
        client.postMessage({
          type: 'SERVICE_WORKER_UPDATED'
        });
      });
    })
  );
});
// ========== 智慧更新機制結束 ==========
