/**
 * 貸款業務工具箱 - Service Worker
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

/* ============================================================
 * 版本號
 * ------------------------------------------------------------
 * 【請勿手動修改】這一行由 GitHub Actions 自動遞增（每次 +0.01）。
 * 規則：4.24 → 4.25 → ... → 4.99 → 5.00 → 5.01
 * 版本號一變，Service Worker 就會重新安裝並抓取全新的檔案。
 * ============================================================ */
// 發票頁全面改版（擬真發票範例、品項明細、格位式大寫）。
// 版本號一定要跟著改，否則已安裝 PWA 的手機會繼續吃舊快取裡的發票頁。
const CACHE_VERSION = '4.50';
const CACHE_NAME = `xiaopenyou-tools-v${CACHE_VERSION}`;

// 核心檔案清單 - 這些檔案會被優先快取以確保離線功能
// 註：data/fuel-prices.json 刻意不列入，它需要的是最新資料而非離線備份，
//     改由下方的「網路優先」策略處理。
const CORE_ASSETS = [
    './',                        // 主頁面（相對路徑）
    './index.html',             // 主頁面（明確路徑）
    './manifest.json',          // PWA配置檔案
    './404.html',               // 404錯誤頁面

    // 功能頁面
    './pages/calculator.html',  // 計算機頁面
    './pages/check.html',       // 支票頁面
    './pages/invoice.html',     // 發票頁面
    './pages/gas.html',         // 加油頁面

    // 樣式
    './css/keypad.css',         // 數字鍵盤與彈窗元件樣式（三頁共用）
    './css/calculator.css',     // 計算機專用樣式

    // 計算頁模組
    './js/calc-engine.js',      // 計算引擎
    './js/calc-storage.js',     // 數據持久化模組
    './js/calc-ui.js',          // UI 交互控制模組

    // 支票頁與發票頁模組（原本漏掉，導致離線時這兩頁開不起來）
    './js/check-engine.js',     // 支票試算引擎
    './js/invoice-engine.js',   // 發票開立引擎
    './js/taxid-lookup.js',     // 統編離線查詢（分片索引本身不預快取，用到才抓）
    './css/check.css',          // 支票頁專用樣式（原內嵌於 check.html）
    './css/invoice.css',        // 發票頁專用樣式（發票頁不吃 calculator.css）
    './js/common-modals.js',    // 三頁共用的彈窗與數字小鍵盤（HTML 注入）
    './js/common-keypad.js',    // 計算頁與支票頁共用的鍵盤與彈窗邏輯（JS）
    './js/common-footer.js',    // 四頁共用的頁尾與版本號顯示
    './js/frame-guard.js',      // 四個功能頁共用的防護腳本

    // 加油頁模組（2026/07 階段 2 從 gas.html 內嵌拆出）
    // 漏掉這兩行的話，離線時加油頁會變成沒有樣式的裸 HTML 且完全不能計算
    './css/gas.css',            // 加油頁專用樣式（原內嵌於 gas.html）
    './js/gas-engine.js',       // 加油頁油資折讓試算引擎（原內嵌於 gas.html）

    // 工具說明頁（原本漏掉）
    './instructions/calculator_instruction.html',
    './instructions/check_instruction.html',
    './instructions/invoice_instruction.html',
    './instructions/gas_instruction.html',

    // 關於頁（原本漏掉）
    './about/privacy-policy.html',
    './about/terms-of-service.html',

    // 圖示
    './icons/icon-192.png',     // 小圖標
    './icons/icon-512.png'      // 大圖標
];

// 需要「永遠拿最新」的資料路徑（例如每週更新的油價）
const NETWORK_FIRST_PATHS = [
    '/data/'
];

// 從「網路優先」中排除的路徑。
// data/taxid/ 是統編索引分片：一個月才更新一次，而且業務在外面
// 收訊不穩，抓過的分片留著離線也能查，比每次都硬要拿最新有用得多。
// 所以它走「快取優先」，內容過期由 CACHE_VERSION 換版時整批汰換。
const NETWORK_FIRST_EXCEPTIONS = [
    '/data/taxid/'
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
    console.log('🔧 Service Worker: 開始安裝 v' + CACHE_VERSION);

    event.waitUntil(precacheCoreAssets());

    // 【刻意不呼叫 self.skipWaiting()】
    // 舊版在這裡無條件強制接管，會造成使用者正在輸入時整頁突然重整。
    // 改為等待使用者主動點擊「立即更新」，或下次完全關閉 App 後才接管。
});

/**
 * 預先快取核心檔案
 *
 * 舊版使用 cache.addAll()，只要其中一個檔案失敗就整批失敗，
 * 而且錯誤被 catch 吞掉不會顯示 —— 等於離線功能可能早就壞了卻沒人知道。
 * 改為逐一抓取：單一檔案失敗不影響其他檔案，並明確記錄是哪一個失敗。
 *
 * 另外加上 cache: 'reload'，強制繞過瀏覽器自己的 HTTP 快取。
 * GitHub Pages 會回應「10 分鐘內可直接使用舊版」，不加這個標註的話，
 * 就算版本號變了也可能拿到舊檔案。
 */
async function precacheCoreAssets() {
    const cache = await caches.open(CACHE_NAME);
    console.log(`💾 Service Worker: 開始預先快取 ${CORE_ASSETS.length} 個核心檔案`);

    const failed = [];

    await Promise.all(CORE_ASSETS.map(async url => {
        try {
            await cache.add(new Request(url, { cache: 'reload' }));
        } catch (error) {
            failed.push(url);
            console.warn('⚠️ Service Worker: 預快取失敗 →', url, error);
        }
    }));

    if (failed.length === 0) {
        console.log(`✅ Service Worker: ${CORE_ASSETS.length} 個核心檔案全部快取完成`);
    } else {
        console.error(`❌ Service Worker: 有 ${failed.length} 個檔案快取失敗，離線功能可能不完整：`, failed);
    }
}

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

    // 資料檔（油價）走網路優先：永遠拿最新，沒網路才用上次抓到的
    if (isNetworkFirstPath(url)) {
        event.respondWith(networkFirstStrategy(request));
        return;
    }

    event.respondWith(
        cacheFirstStrategy(request)
            .catch(() => networkFallback(request))
    );
});

/**
 * 判斷是否為需要「永遠拿最新」的路徑
 */
function isNetworkFirstPath(url) {
    if (NETWORK_FIRST_EXCEPTIONS.some(p => url.pathname.includes(p))) return false;
    return NETWORK_FIRST_PATHS.some(p => url.pathname.includes(p));
}

/**
 * 網路優先策略 (Network First)
 *
 * 用於油價這類每週更新的資料。舊版在網址後面加時間戳（?v=1753...）來防快取，
 * 但每個時間戳都是不同網址，Service Worker 會把每一次都各存一份，
 * 用久了會累積上千筆一模一樣的資料把快取撐爆。
 *
 * 改用這個策略後：永遠只有 1 筆快取，每次抓到新的就覆蓋。
 */
async function networkFirstStrategy(request) {
    const cache = await caches.open(CACHE_NAME);

    try {
        const networkResponse = await fetch(request, { cache: 'no-cache' });
        if (networkResponse.ok) {
            // 覆蓋既有的那一筆，不會新增
            cache.put(request, networkResponse.clone());
            return networkResponse;
        }
        throw new Error('HTTP ' + networkResponse.status);
    } catch (error) {
        // 沒網路時用上次抓到的資料，功能不中斷
        const cachedResponse = await cache.match(request);
        if (cachedResponse) {
            console.log('📴 Service Worker: 離線，使用上次抓到的資料:', request.url);
            return cachedResponse;
        }
        throw error;
    }
}

/**
 * Service Worker 訊息處理
 * 處理來自主頁面的訊息，如手動更新請求
 */
self.addEventListener('message', event => {
    // 防呆：訊息格式不符時直接忽略，避免整個處理器拋錯
    if (!event.data || typeof event.data !== 'object') return;

    const { type } = event.data;
    const replyPort = (event.ports && event.ports[0]) ? event.ports[0] : null;

    switch (type) {
        case 'SKIP_WAITING':
            // 立即接管並套用新版本。
            // 這是唯一會觸發強制接管的路徑，且只在使用者主動點擊
            // 畫面上的「立即更新」之後才會被呼叫。
            console.log('👉 Service Worker: 收到使用者的立即更新要求');
            self.skipWaiting();
            break;
            
        case 'GET_VERSION':
            // 回傳目前版本號（供頁尾與更新提示條顯示）
            if (replyPort) {
                replyPort.postMessage({
                    type: 'VERSION_INFO',
                    version: CACHE_VERSION
                });
            }
            break;

        case 'CLEAR_CACHE':
            // 清理所有快取
            clearAllCaches().then(() => {
                if (replyPort) replyPort.postMessage({ type: 'CACHE_CLEARED' });
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

    // ignoreSearch：讓桌面捷徑帶的 ?page=check 這類參數也能命中同一份快取，
    // 否則離線時從捷徑啟動會找不到已快取的首頁。
    const isDocument = (request.mode === 'navigate' || request.destination === 'document');
    const cachedResponse = await cache.match(request, { ignoreSearch: isDocument });

    // 針對HTML頁面使用網路優先策略，確保內容即時更新
    if (request.destination === 'document' || request.url.includes('.html')) {
        try {
            // 嘗試從網路獲取最新內容
            const networkResponse = await fetch(request, { cache: 'no-cache' });
            if (networkResponse.ok) {
                // 更新快取並返回最新內容
                cache.put(request, networkResponse.clone());
                console.log('🔄 Service Worker: 已更新HTML頁面快取:', request.url);
                return networkResponse;
            }
        } catch (error) {
            console.log('⚠️ Service Worker: 網路獲取失敗，使用快取版本:', request.url);
            // 網路失敗時使用快取版本
            if (cachedResponse) {
                return cachedResponse;
            }
        }
    }
    
    // 對於其他資源，仍使用快取優先策略
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
        // 注意：必須用相對路徑（相對於 sw.js 所在的 /my-website/），
        // 用 '/' 會指到網域根目錄，在 GitHub Pages 上永遠找不到。
        if (request.mode === 'navigate') {
            const cache = await caches.open(CACHE_NAME);
            const fallback = await cache.match('./index.html') || await cache.match('./');
            if (fallback) return fallback;
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

console.log('📦 Service Worker: 貸款業務工具箱 PWA Service Worker 已載入');
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
