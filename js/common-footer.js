/**
 * 重車貸款業務工具箱 - 全站通用頁尾 (common-footer.js)
 * ------------------------------------------------------------
 * 【2026/07 新增：把三份實作收成一份】
 *
 * 這個頁尾（工具箱名稱 + 實際運作的版本號 + 版權宣告）原本有三種寫法：
 *
 *   計算頁、支票頁 → js/common-modals.js 的 initCommonModals() 動態注入
 *   發票頁         → pages/invoice.html 寫死一段 <footer>，
 *                    並在 js/invoice-engine.js 裡自己複製一份 showAppVersion()
 *   加油頁         → 完全沒有（因為它不載入 common-modals.js）
 *
 * 也就是 showAppVersion() 有兩份逐字重複的拷貝，而加油頁看不到版本號 ——
 * 業務無法確認手機上的 PWA 有沒有更新到最新版，這在遠端排錯時很麻煩。
 *
 * 現在四個頁面都只要載入本檔案就會自動長出頁尾，不需要呼叫任何函式。
 *
 * 注意：樣式（.global-app-footer / .footer-title / .footer-copyright）
 *       需要由各頁自己的 CSS 提供。目前 calculator.css、invoice.css、
 *       gas.css 都有；新增頁面時別忘了。
 * ------------------------------------------------------------ */

/**
 * 注入頁尾 DOM。重複呼叫安全（第二次會直接返回）。
 */
function renderGlobalFooter() {
    if (document.getElementById('globalAppFooter')) return;

    const footerElement = document.createElement('footer');
    footerElement.id = 'globalAppFooter';
    footerElement.className = 'global-app-footer';
    footerElement.innerHTML = `
        <div class="footer-title">重車貸款業務工具箱 <span id="appVersionLabel"></span></div>
        <div class="footer-copyright">© 2026 Fleet Loan Toolkit. All rights reserved.</div>
    `;
    document.body.appendChild(footerElement);

    showAppVersion();
}

/**
 * 頁尾顯示實際運作中的版本號
 *
 * 直接問 Service Worker 目前用的是哪一版，業務就能自己確認手機上的
 * PWA 有沒有更新到最新版。取不到就不顯示，不影響任何功能。
 */
function showAppVersion() {
    const label = document.getElementById('appVersionLabel');
    if (!label || !('serviceWorker' in navigator)) return;

    const ask = function () {
        const controller = navigator.serviceWorker.controller;
        if (!controller) return false;
        try {
            const channel = new MessageChannel();
            channel.port1.onmessage = function (event) {
                if (event.data && event.data.type === 'VERSION_INFO' && event.data.version) {
                    label.textContent = '• v' + event.data.version;
                }
            };
            controller.postMessage({ type: 'GET_VERSION' }, [channel.port2]);
            return true;
        } catch (e) {
            return false;   // 取不到版本號不影響任何功能，安靜略過
        }
    };

    // 首次安裝當下 controller 可能還沒接管，等就緒後再問一次
    if (!ask()) {
        navigator.serviceWorker.ready
            .then(function () { setTimeout(ask, 300); })
            .catch(function () { /* 略過 */ });
    }
}

/* 自動啟動。腳本可能在 DOMContentLoaded 之前或之後才載入完成，兩種都要能長出頁尾。 */
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderGlobalFooter);
} else {
    renderGlobalFooter();
}
