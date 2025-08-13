/**
 * 小朋友工具 - Service Worker
 * 提供離線支援、快取管理和自動更新功能
 * 
 * 功能特色：
 * - 離線使用支援
 * - 自動更新機制
 * - 智能快取策略
 * - 版本管理
 */

// ============================================
// Service Worker 配置和版本管理
// ============================================

// 版本號和快取名稱 - 更新版本號時會自動清理舊快取
const CACHE_VERSION = 'v1.0.0';
const CACHE_NAME = `xiaopenyou-tools-${CACHE_VERSION}`;

// 核心檔案清單 - 這些檔案會被優先快取以確保離線功能
const CORE_ASSETS = [
    '/',                          // 主頁面
    '/index.html',               // 主頁面（明確路徑）
    '/manifest.json',            // PWA配置檔案
    '/pages/calculator.html',    // 計算機頁面
    '/pages/check.html',         // 支票頁面
    '/pages/invoice.html',       // 發票頁面
    '/pages/gas.html',           // 加油頁面
    '/icons/icon-192.png',       // 小圖標
    '/icons/icon-512.png'        // 大圖標
];

// 可選快取檔案 - 這些檔案會在有機會時被快取
const OPTIONAL_ASSETS = [
    // 可以在這裡添加其他資源檔案
];

// 不需要快取的URL模式 - 這些請求會直接從網路獲取
const EXCLUDE_PATTERNS = [
    /^https?:\/\/(?![\w.-]*github\.io)/,  // 排除外部網站
    /\.map$/,                             // 排除source map檔案
    /^chrome-extension:\/\//,             // 排除瀏覽器擴展
    /\/_\//                              // 排除特殊路徑
];

// ============================================
// Service Worker 事件處理
// ============================================

/**
 * Service Worker 安裝事件
 * 預先快取核心檔案確保離線功能
 */
self.addEventListener('install', event => {
    console.log('🔧 Service Worker: 開始安裝', CACHE_VERSION);
    
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('💾 Service Worker: 開始預先快取核心檔案');
                return cache.addAll(CORE_ASSETS);
            })
            .then(() => {
                console.log('✅ Service Worker: 核心檔案快取完成');
                // 強制啟用新的Service Worker
                return self.skipWaiting();
            })
            .catch(error => {
                console.error('❌ Service Worker: 快取核心檔案時發生錯誤:', error);
            })
    );
});

/**
 * Service Worker 啟用事件
 * 清理舊版本快取並接管所有客戶端
 */
self.addEventListener('activate', event => {
    console.log('🚀 Service Worker: 開始啟用', CACHE_VERSION);
    
    event.waitUntil(
        Promise.all([
            // 清理舊版本快取
            cleanupOldCaches(),
            // 立即接管所有客戶端
            self.clients.claim()
        ]).then(() => {
            console.log('✅ Service Worker: 啟用完成，已接管所有頁面');
        })
    );
});

/**
 * 網路請求攔截事件
 * 實現智能快取策略：優先使用快取，同時在背景更新
 */
self.addEventListener('fetch', event => {
    const request = event.request;
    const url = new URL(request.url);
    
    // 跳過不需要快取的請求
    if (shouldExcludeFromCache(request)) {
        return;
    }
    
    // 只處理GET請求
    if (request.method !== 'GET') {
        return;
    }
    
    event.respondWith(
        cacheFirstStrategy(request)
            .catch(() => networkFallback(request))
    );
});

/**
 * Service Worker 訊息處理
 * 處理來自主頁面的訊息，如手動更新請求
 */
self.addEventListener('message', event => {
    const { type, data } = event.data;
    
    switch (type) {
        case 'SKIP_WAITING':
            // 強制更新Service Worker
            self.skipWaiting();
            break;
            
        case 'GET_VERSION':
            // 回傳目前版本號
            event.ports[0].postMessage({
                type: 'VERSION_INFO',
                version: CACHE_VERSION
            });
            break;
            
        case 'CLEAR_CACHE':
            // 清理所有快取
            clearAllCaches().then(() => {
                event.ports[0].postMessage({
                    type: 'CACHE_CLEARED'
                });
            });
            break;
            
        default:
            console.log('📨 Service Worker: 收到未知訊息類型:', type);
    }
});

// ============================================
// 快取策略實作
// ============================================

/**
 * 快取優先策略 (Cache First)
 * 優先從快取回應，適用於靜態資源
 */
async function cacheFirstStrategy(request) {
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
        // 在背景中更新快取
        updateCacheInBackground(request, cache);
        return cachedResponse;
    }
    
    // 快取中沒有，從網路獲取並快取
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
        cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
}

/**
 * 網路回退策略
 * 當主要策略失敗時的備案
 */
async function networkFallback(request) {
    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, response.clone());
        }
        return response;
    } catch (error) {
        // 網路完全不可用，回傳離線頁面或錯誤
        console.log('🔌 Service Worker: 網路不可用，使用離線模式');
        
        // 如果是頁面請求，回傳主頁面
        if (request.mode === 'navigate') {
            const cache = await caches.open(CACHE_NAME);
            return cache.match('/') || cache.match('/index.html');
        }
        
        throw error;
    }
}

/**
 * 背景更新快取
 * 不影響使用者體驗的情況下更新快取內容
 */
async function updateCacheInBackground(request, cache) {
    try {
        const response = await fetch(request);
        if (response.ok) {
            cache.put(request, response.clone());
            console.log('🔄 Service Worker: 背景更新快取:', request.url);
        }
    } catch (error) {
        // 背景更新失敗不影響用戶體驗
        console.log('⚠️  Service Worker: 背景更新失敗:', request.url);
    }
}

// ============================================
// 工具函數
// ============================================

/**
 * 清理舊版本快取
 * 保持快取空間整潔，移除不再使用的版本
 */
async function cleanupOldCaches() {
    const cacheNames = await caches.keys();
    const oldCaches = cacheNames.filter(cacheName => 
        cacheName.startsWith('xiaopenyou-tools-') && cacheName !== CACHE_NAME
    );
    
    console.log(`🧹 Service Worker: 準備清理 ${oldCaches.length} 個舊快取`);
    
    return Promise.all(
        oldCaches.map(cacheName => {
            console.log(`🗑️  Service Worker: 刪除舊快取 ${cacheName}`);
            return caches.delete(cacheName);
        })
    );
}

/**
 * 清理所有快取
 * 用於重置應用狀態
 */
async function clearAllCaches() {
    const cacheNames = await caches.keys();
    return Promise.all(
        cacheNames.map(cacheName => caches.delete(cacheName))
    );
}

/**
 * 檢查請求是否應該排除在快取之外
 */
function shouldExcludeFromCache(request) {
    const url = request.url;
    
    return EXCLUDE_PATTERNS.some(pattern => {
        if (typeof pattern === 'string') {
            return url.includes(pattern);
        }
        return pattern.test(url);
    });
}

/**
 * 獲取快取統計資訊
 */
async function getCacheStats() {
    try {
        const cache = await caches.open(CACHE_NAME);
        const keys = await cache.keys();
        return {
            name: CACHE_NAME,
            version: CACHE_VERSION,
            size: keys.length,
            assets: keys.map(request => request.url)
        };
    } catch (error) {
        console.error('Service Worker: 無法獲取快取統計:', error);
        return null;
    }
}

// ============================================
// Service Worker 生命週期日誌
// ============================================

console.log('📦 Service Worker: 小朋友工具 PWA Service Worker 已載入');
console.log(`🏷️  Service Worker: 版本 ${CACHE_VERSION}`);
console.log(`📁 Service Worker: 快取名稱 ${CACHE_NAME}`);
console.log(`📋 Service Worker: 核心資源數量 ${CORE_ASSETS.length}`);

// 定期輸出快取統計（僅在開發階段）
if (self.location.hostname === 'localhost' || self.location.hostname.includes('github.io')) {
    setTimeout(async () => {
        const stats = await getCacheStats();
        if (stats) {
            console.log('📊 Service Worker: 快取統計', stats);
        }
    }, 5000);
}