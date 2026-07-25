/**
 * frame-guard.js — 功能頁防護
 * ============================================================
 * 用途：
 *   pages/ 底下的四個功能頁原本是設計成放在 index.html 外殼的 iframe 裡使用。
 *   但因為它們也是獨立的網址，任何人只要直接輸入
 *   例如 .../my-website/pages/invoice.html
 *   就能整個繞過首頁的「安裝成應用程式」引導畫面。
 *
 * 做法：
 *   偵測目前是不是被包在外殼的 iframe 裡。
 *   若不是（代表被直接開啟），立刻導回外殼並帶上對應的頁面參數，
 *   使用者會看到正常的安裝引導，而且會停在他原本想開的那一頁。
 *
 * 使用方式：
 *   放在每個功能頁 <head> 的最前面（越早越好，避免畫面先閃一下）：
 *   <script src="../js/frame-guard.js"></script>
 * ============================================================
 */

(function () {
    'use strict';

    // ------------------------------------------------------------
    // 1. 判斷是否位於 iframe 之中
    //    被外殼包起來時 window.self !== window.top，這是正常情況，直接放行
    // ------------------------------------------------------------
    var isInsideShell;

    try {
        isInsideShell = (window.self !== window.top);
    } catch (error) {
        // 跨網域存取 window.top 會丟出例外，代表確實被別的網站嵌著
        // 這種情況一樣視為在 iframe 內，不做導向（避免被外站利用做無限跳轉）
        isInsideShell = true;
    }

    if (isInsideShell) {
        return;                                  // 正常使用情境，什麼都不用做
    }

    // ------------------------------------------------------------
    // 2. 從網址推出目前是哪一個功能頁
    //    例如 /my-website/pages/invoice.html → invoice
    // ------------------------------------------------------------
    var VALID_PAGES = ['calculator', 'check', 'invoice', 'gas'];

    var fileName = window.location.pathname
        .split('/')
        .pop()
        .replace('.html', '');

    // 認不出來的話一律回計算頁
    var targetPage = (VALID_PAGES.indexOf(fileName) !== -1) ? fileName : 'calculator';

    // ------------------------------------------------------------
    // 3. 導回外殼
    //    用 replace 而非 assign，讓使用者按上一頁不會又跳回這裡形成迴圈
    // ------------------------------------------------------------
    window.location.replace('../?page=' + targetPage);
})();
