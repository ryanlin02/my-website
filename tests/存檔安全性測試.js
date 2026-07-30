/**
 * 存檔安全性測試 —— 步驟 1 的三項防護不准再消失
 * ============================================================
 * 【這支測試存在的原因】
 *
 * 這三個問題都不是打錯字，是「少寫了防護」，所以任何一次重構都可能
 * 把它們安靜地拿掉，而且畫面上完全看不出來 ——
 *
 *   1. 發票頁刪除沒有確認：按下去就沒了，不可復原，
 *      而且 × 與「全部刪除」在畫面上相鄰，單手操作容易誤觸。
 *   2. 計算頁存檔沒有 try/catch：容量滿時丟出未捕捉的例外，
 *      函式中斷、連「已保存」提示都不會跳，業務以為只是沒反應，
 *      實際上資料根本沒進去。
 *   3. 計算頁 id 只有毫秒精度：同一毫秒連按兩次會產生兩筆相同 id，
 *      之後刪一筆會連帶刪掉兩筆。
 *
 * 存檔與歷史的共用模組（步驟 2）會把這幾支函式整個改寫，
 * 這支測試就是為了那個時候還能守住。
 *
 * 需要先安裝 jsdom：npm install jsdom
 * 執行：node tests/存檔安全性測試.js
 * ============================================================
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const R = path.join(__dirname, '..');

let pass = 0, fail = 0;
const t = (name, cond, extra = '') => {
    cond ? pass++ : fail++;
    console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '   → ' + extra));
};

/* ============================================================
   計算頁
   ============================================================ */
function bootCalc() {
    const html = fs.readFileSync(path.join(R, 'pages/calculator.html'), 'utf8');
    const dom = new JSDOM(html, {
        url: 'https://ryanlin02.github.io/my-website/pages/calculator.html',
        runScripts: 'outside-only',
        pretendToBeVisual: true
    });
    const w = dom.window;
    w.eval('window.setInterval=function(){return 0;};window.setTimeout=function(){return 0;};');
    w.eval('window.scrollTo=function(){};');
    w.navigator.vibrate = () => true;

    const scripts = [...html.matchAll(/<script src="\.\.\/js\/([^"]+)"/g)]
        .map(m => m[1]).filter(f => f !== 'frame-guard.js');
    for (const f of scripts) {
        w.eval(fs.readFileSync(path.join(R, 'js', f), 'utf8').replace(/^let /gm, 'var '));
    }
    w.eval('initCommonModals()');

    // 攔下提示訊息，才驗得到「失敗時有沒有告訴使用者」
    w.__toasts = [];
    w.showToast = function (msg, isError) { w.__toasts.push({ msg: String(msg), isError: !!isError }); };

    return w;
}

function fillCalcForm(w) {
    const set = (id, v) => { const el = w.document.getElementById(id); if (el) el.value = v; };
    set('period', '36');
    set('rate', '8.5');
    set('principal', '1,000,000');
    set('payment', '31,000');
    set('afterTaxRate', '8.1234');
    set('commission', '20,000');
    set('afterCommissionRate', '9.5678');
    set('totalInterest', '116,000');
}

function readLoanHistory(w) {
    return JSON.parse(w.localStorage.getItem('loanHistory') || '[]');
}

console.log('\n計算頁 —— 存檔');

{
    const w = bootCalc();
    fillCalcForm(w);

    // 同一次同步流程內連存三筆，等同於「同一毫秒連按三次」的最壞情況
    w.eval('saveLoanData(); saveLoanData(); saveLoanData();');
    const list = readLoanHistory(w);

    t('連續存三筆會產生三筆紀錄', list.length === 3, `實際 ${list.length} 筆`);

    const ids = list.map(r => r.id);
    t('三筆的 id 互不相同', new Set(ids).size === 3, `ids=${ids.join(',')}`);

    t('id 仍在安全整數範圍內（不會失去精度）',
        ids.every(id => Number.isSafeInteger(id)),
        `ids=${ids.join(',')}`);

    // 真正會出事的地方：刪一筆卻少了兩筆
    w.eval(`deleteLoan(${ids[0]})`);
    const okBtn = w.document.getElementById('confirmModalOk');
    t('刪除會先跳出確認彈窗',
        w.document.getElementById('confirmModalOverlay').style.display === 'flex');
    okBtn.click();

    const after = readLoanHistory(w);
    t('刪掉一筆之後剩兩筆（不會誤刪同毫秒的另一筆）',
        after.length === 2, `實際剩 ${after.length} 筆`);
    t('剩下的正是沒被刪掉的那兩筆',
        after.every(r => r.id !== ids[0]) && after.length === 2);
}

{
    // 容量滿：setItem 丟例外時，必須明確告知失敗，而不是靜靜地什麼都沒發生
    const w = bootCalc();
    fillCalcForm(w);

    /* jsdom 的 Storage 是包過 Proxy 的（為了支援 storage.foo = 'x' 這種寫法），
       在實例上 defineProperty 會被當成寫入一個儲存項目，蓋不掉方法本身。
       要模擬容量已滿只能改原型上的 setItem。 */
    const proto = Object.getPrototypeOf(w.localStorage);
    const origSetItem = proto.setItem;
    proto.setItem = function () { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; };

    let threw = false;
    try { w.eval('saveLoanData()'); } catch (e) { threw = true; }

    proto.setItem = origSetItem;

    t('容量滿時不會把例外往外丟', !threw);

    const errToasts = w.__toasts.filter(x => x.isError);
    t('容量滿時有跳出錯誤提示', errToasts.length === 1,
        `toasts=${JSON.stringify(w.__toasts)}`);
    t('容量滿時不會謊報成功',
        !w.__toasts.some(x => !x.isError && /保存|存檔/.test(x.msg)),
        `toasts=${JSON.stringify(w.__toasts)}`);
}

/* ============================================================
   發票頁
   ============================================================ */
function bootInvoice() {
    const html = fs.readFileSync(path.join(R, 'pages/invoice.html'), 'utf8')
        .replace(/<script src="\.\.\/js\/frame-guard\.js"><\/script>/, '')
        .replace(/<script async src="https:\/\/www\.googletagmanager[^<]*<\/script>/, '');

    const dom = new JSDOM(html, {
        runScripts: 'dangerously',
        url: 'https://ryanlin02.github.io/my-website/pages/invoice.html',
        resources: { fetch(url) { return url.protocol === 'file:' ? undefined : null; } },
        beforeParse(window) {
            window.fetch = () => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) });
            window.navigator.vibrate = () => true;
            window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {} }));
        }
    });

    const w = dom.window;
    ['js/common-history.js', 'js/common-keypad.js', 'js/common-modals.js', 'js/taxid-lookup.js', 'js/common-datepicker.js']
        .forEach(f => w.eval(fs.readFileSync(path.join(R, f), 'utf8').replace(/^let /gm, 'var ')));

    const engine = fs.readFileSync(path.join(R, 'js/invoice-engine.js'), 'utf8')
        .replace(/^'use strict';$/m, '');
    // 嚴格模式的 eval 自成作用域，測試要用的東西只能在同一次 eval 的尾巴導出來
    w.eval(engine + '\n;window.__test = { state, calc, render, LS_HISTORY };');
    w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));

    return w;
}

function invHistory(w) {
    return JSON.parse(w.localStorage.getItem(w.__test.LS_HISTORY) || '[]');
}

function makeRecords(w, n) {
    for (let i = 0; i < n; i++) {
        w.__test.state.title = '測試客戶' + (i + 1);
        w.__test.state.items = [{ name: '車輛', qty: 1, price: 100000 * (i + 1) }];
        w.__test.state.lockTotal = null;
        w.document.getElementById('btnSaveRec').click();
    }
}

console.log('\n發票頁 —— 刪除確認');

{
    const w = bootInvoice();
    makeRecords(w, 2);
    t('前置：已建立兩筆歷史紀錄', invHistory(w).length === 2, `實際 ${invHistory(w).length} 筆`);

    w.document.getElementById('btnHistory').click();
    const delBtn = w.document.querySelector('#histBody [data-del]');
    t('歷史清單渲染得出刪除鈕', !!delBtn);

    delBtn.click();
    const overlay = w.document.getElementById('confirmModalOverlay');
    t('點刪除會先跳出確認彈窗', overlay && overlay.style.display === 'flex');
    t('確認之前資料還在（不是先刪再問）', invHistory(w).length === 2,
        `實際 ${invHistory(w).length} 筆`);

    w.document.getElementById('confirmModalOk').click();
    t('按下確定之後才真的刪掉', invHistory(w).length === 1,
        `實際 ${invHistory(w).length} 筆`);
}

{
    const w = bootInvoice();
    makeRecords(w, 3);

    w.document.getElementById('btnHistory').click();
    w.document.getElementById('histClear').click();

    const overlay = w.document.getElementById('confirmModalOverlay');
    t('「全部刪除」會先跳出確認彈窗', overlay && overlay.style.display === 'flex');
    t('確認之前三筆都還在', invHistory(w).length === 3, `實際 ${invHistory(w).length} 筆`);
    t('確認訊息會告知要刪掉幾筆',
        /3/.test(w.document.getElementById('confirmModalContent').textContent),
        w.document.getElementById('confirmModalContent').textContent);

    w.document.getElementById('confirmModalOk').click();
    t('按下確定之後才真的清空', invHistory(w).length === 0,
        `實際 ${invHistory(w).length} 筆`);
}

{
    // 不按確定就關掉，資料必須原封不動
    const w = bootInvoice();
    makeRecords(w, 2);
    w.document.getElementById('btnHistory').click();
    w.document.querySelector('#histBody [data-del]').click();
    w.eval('hideConfirmModal()');
    t('取消刪除之後資料原封不動', invHistory(w).length === 2,
        `實際 ${invHistory(w).length} 筆`);
}

/* ============================================================
   疊層順序
   ------------------------------------------------------------
   確認彈窗必須蓋得住每一頁的歷史面板。發票頁的 .sheet 是 4500，
   共用彈窗原本是 2000 —— 彈窗確實開了，卻整個被面板蓋住，
   使用者看到的是「點了完全沒反應」。
   ============================================================ */
console.log('\n疊層順序');

/* 【2026/07 步驟 2】疊層改用 css/keypad.css :root 裡的共用變數，
   所以這裡要先把 var(--z-xxx) 解析成實際數字再比較。 */
const keypadCss = fs.readFileSync(path.join(R, 'css/keypad.css'), 'utf8');
const zTokens = {};
for (const m of keypadCss.matchAll(/(--z-[a-z-]+):\s*(\d+)/g)) zTokens[m[1]] = Number(m[2]);

function zIndexOf(file, selector) {
    const css = fs.readFileSync(path.join(R, 'css', file), 'utf8');
    const re = new RegExp('^\\' + selector + '\\s*\\{[\\s\\S]*?^\\}', 'm');
    const block = css.match(re);
    if (!block) return null;
    const z = block[0].match(/z-index:\s*([^;]+);/);
    if (!z) return null;
    const raw = z[1].trim();
    if (/^\d+$/.test(raw)) return Number(raw);
    const v = raw.match(/var\((--z-[a-z-]+)\)/);
    return (v && zTokens[v[1]] !== undefined) ? zTokens[v[1]] : null;
}

const zModal = zIndexOf('keypad.css', '.modal-overlay');
const zNote  = zIndexOf('keypad.css', '.note-editor-modal');
const zSheet = zIndexOf('invoice.css', '.sheet');
const zPanel = zIndexOf('calculator.css', '.history-panel');
const zToast = zIndexOf('keypad.css', '.toast-message');

t('疊層變數集中定義在 keypad.css', Object.keys(zTokens).length >= 4, JSON.stringify(zTokens));
t('讀得到共用彈窗的 z-index', zModal !== null, String(zModal));
t('共用彈窗蓋得住發票頁歷史面板', zModal > zSheet, `彈窗 ${zModal} vs 面板 ${zSheet}`);
t('共用彈窗蓋得住計算頁／支票頁歷史面板', zModal > zPanel, `彈窗 ${zModal} vs 面板 ${zPanel}`);
t('備註編輯器蓋得住兩種歷史面板',
    zNote !== null && zNote > zSheet && zNote > zPanel, `備註 ${zNote}`);
t('提示訊息在所有彈窗之上', zToast > zModal, `提示 ${zToast} vs 彈窗 ${zModal}`);
t('四頁的歷史面板同一層', zSheet === zPanel, `發票 ${zSheet} vs 計算 ${zPanel}`);

/* 共用元件的樣式必須放在四頁都載入的 keypad.css 裡。
   備註編輯器原本只寫在 calculator.css —— 而發票頁與加油頁不載入那份，
   步驟 4 要加備註時會拿到一個完全沒有樣式的對話框。 */
const calcCss = fs.readFileSync(path.join(R, 'css/calculator.css'), 'utf8');
t('備註編輯器樣式在四頁共用的 keypad.css 裡', /\.note-editor-modal\s*\{/.test(keypadCss));
t('  沒有留在只有兩頁載入的 calculator.css', !/\.note-editor-modal\s*\{/.test(calcCss));

for (const page of ['calculator', 'check', 'invoice', 'gas']) {
    const html = fs.readFileSync(path.join(R, 'pages', page + '.html'), 'utf8');
    t(`${page}.html 有載入 keypad.css（備註編輯器才有樣式）`, html.includes('css/keypad.css'));
}

/* ============================================================ */
console.log(`\n通過 ${pass}　失敗 ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
