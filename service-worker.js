const CACHE_NAME = 'chicken-rice-v1.03';

// 需要緩存的檔案清單
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
  );
});

// 攔截網路請求
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // 如果在緩存中找到匹配的資源，則返回緩存的版本
        if (response) {
          return response;
        }
        // 否則發起網路請求
        return fetch(event.request)
          .then((response) => {
            // 檢查是否得到了有效的回應
            if (!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }
            // 將新資源添加到緩存
            const responseToCache = response.clone();
            caches.open(CACHE_NAME)
              .then((cache) => {
                cache.put(event.request, responseToCache);
              });
            return response;
          });
      })
  );
});
