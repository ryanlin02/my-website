// 與 service-worker.js 保持一致的版本號
const APP_VERSION = 'v1.10';

// 用於存儲上次檢查時間
const VERSION_CHECK_KEY = 'last-version-check';

// 檢查版本更新
async function checkVersion() {
    // 避免過於頻繁檢查，設定最小間隔為 5 分鐘
    const lastCheck = localStorage.getItem(VERSION_CHECK_KEY);
    if (lastCheck && (Date.now() - parseInt(lastCheck)) < 300000) {
        return;
    }

    try {
        // 添加時間戳以避免快取
        const response = await fetch(`/version.json?t=${Date.now()}`);
        if (!response.ok) {
            throw new Error('Version check failed');
        }

        const data = await response.json();
        
        // 更新最後檢查時間
        localStorage.setItem(VERSION_CHECK_KEY, Date.now().toString());

        // 如果版本不一致，提示更新
        if (data.version !== APP_VERSION) {
            showUpdateNotification();
        }
    } catch (error) {
        console.warn('版本檢查失敗:', error);
    }
}

// 顯示更新提示
function showUpdateNotification() {
    // 建立一個固定在頂部的通知條
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        background-color: #ff9c33;
        color: white;
        text-align: center;
        padding: 10px;
        z-index: 10000;
        animation: slideDown 0.5s ease-out;
    `;
    
    notification.innerHTML = `
        <div style="display: flex; justify-content: center; align-items: center; gap: 10px;">
            <span>🍚 發現新版本！要立即更新嗎？</span>
            <button onclick="updateNow()" style="
                background: white;
                color: #ff9c33;
                border: none;
                padding: 5px 15px;
                border-radius: 4px;
                cursor: pointer;
                margin-right: 10px;
            ">更新</button>
            <button onclick="closeUpdateNotification(this.parentElement.parentElement)" style="
                background: transparent;
                color: white;
                border: 1px solid white;
                padding: 5px 15px;
                border-radius: 4px;
                cursor: pointer;
            ">稍後</button>
        </div>
    `;

    document.body.appendChild(notification);
}

// 執行更新
function updateNow() {
    // 如果有 Service Worker
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ action: 'skipWaiting' });
    }
    
    // 清除所有相關的本地存儲
    localStorage.removeItem(VERSION_CHECK_KEY);
    
    // 重新載入頁面
    window.location.reload(true);
}

// 關閉更新通知
function closeUpdateNotification(element) {
    element.style.animation = 'slideUp 0.5s ease-out';
    setTimeout(() => element.remove(), 500);
}

// 添加必要的 CSS 動畫
const style = document.createElement('style');
style.textContent = `
    @keyframes slideDown {
        from { transform: translateY(-100%); }
        to { transform: translateY(0); }
    }
    @keyframes slideUp {
        from { transform: translateY(0); }
        to { transform: translateY(-100%); }
    }
`;
document.head.appendChild(style);

// 初始檢查和定期檢查
document.addEventListener('DOMContentLoaded', () => {
    checkVersion();
    // 每 5 分鐘檢查一次更新
    setInterval(checkVersion, 300000);
});
