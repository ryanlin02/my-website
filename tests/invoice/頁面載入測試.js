/**
 * 發票頁 - 載入與互動煙霧測試
 *
 * 為什麼需要這支：純函式測試（verify.js）驗的是算得對不對，
 * 但「頁面根本載不起來」這種錯誤它一個都抓不到。
 * 開發過程真的踩過一次：DEFAULT_ITEM_NAME 宣告在 state 之後，
 * const 的暫時性死區讓整頁一載入就 ReferenceError，
 * 而所有純函式測試依然全數通過。
 *
 * 這支用 jsdom 真的把 invoice.html 跑一遍，確認：
 *   1. 載入過程沒有拋出任何錯誤
 *   2. 初始畫面確實渲染出來了（不是一片空白）
 *   3. 主要互動點得下去而且不會爆
 *
 * 執行：node tests/invoice/頁面載入測試.js  （需先 npm install jsdom）
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '../..');
let pass = 0, fail = 0;

function ok(cond, label, extra) {
    if (cond) { pass++; }
    else { fail++; console.log('  FAIL ' + label + (extra ? '　' + extra : '')); }
}

// frame-guard 在非 iframe 環境會導頁，jsdom 不支援導頁會噴警告。
// 這裡把它抽掉，測的是發票頁本身而不是防護腳本。
const html = fs.readFileSync(path.join(ROOT, 'pages/invoice.html'), 'utf8')
    .replace(/<script src="\.\.\/js\/frame-guard\.js"><\/script>/, '')
    .replace(/<script async src="https:\/\/www\.googletagmanager[^<]*<\/script>/, '');

const errors = [];
const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://ryanlin02.github.io/my-website/pages/invoice.html',
    resources: {
        // 只讓本地檔案載入，外部資源一律忽略
        fetch(url) { return url.protocol === 'file:' ? undefined : null; }
    },
    beforeParse(window) {
        window.addEventListener('error', e => errors.push(e.message || String(e.error)));
        // taxid-lookup.js 開頁會探測索引；jsdom 沒有 fetch，給個永遠查不到的替身
        window.fetch = () => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) });
        // jsdom 沒有這些 API，補上最小替身避免誤判成程式的錯
        window.navigator.vibrate = () => true;
        window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {} }));
    }
});

const { window } = dom;
const doc = window.document;

// jsdom 不會自動載入相對路徑的 <script>，手動注入。
// 引擎開頭有 'use strict'，嚴格模式下 eval 會自成一個作用域，
// 裡面的 const / function 一個都不會掛到 window 上。所以在同一次 eval
// 的尾巴加一行把測試要用的東西導出來 —— 這是唯一拿得到的方式。
/* 【2026/07 補】原本這裡只載入 invoice-engine.js。
   本頁改用共用鍵盤與共用日期選擇器之後，那些函式都在別的檔案裡，
   於是「主要互動不得拋錯」那一段其實一直在對著不存在的函式點下去 ——
   jsdom 不會把事件處理器裡的例外往外丟，所以它靜靜地綠燈。
   現在四支都載，順序與 invoice.html 一致。 */
['js/common-history.js', 'js/common-keypad.js', 'js/common-modals.js', 'js/taxid-lookup.js'].forEach(f => {
    window.eval(fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/^let /gm, 'var '));
});
window.eval(fs.readFileSync(path.join(ROOT, 'js/common-datepicker.js'), 'utf8')
    .replace(/^let /gm, 'var '));

const engine = fs.readFileSync(path.join(ROOT, 'js/invoice-engine.js'), 'utf8')
    .replace(/^'use strict';$/m, '');
try {
    window.eval(engine + '\n;window.__test = { state, render, calc, itemNameChips, upperSlots };');
} catch (e) {
    fail++;
    console.log('  FAIL 引擎載入時就拋出錯誤：' + e.message);
}
const T = window.__test || {};

// 觸發 DOMContentLoaded，讓 bind() 與 render() 跑起來
try {
    doc.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));
} catch (e) {
    fail++;
    console.log('  FAIL DOMContentLoaded 期間拋出錯誤：' + e.message);
}

const $ = id => doc.getElementById(id);
const click = el => el && el.dispatchEvent(new window.Event('click', { bubbles: true }));

console.log('=== 1. 載入過程不得有錯 ===');
ok(errors.length === 0, '載入期間拋出錯誤', errors.join(' / '));

console.log('=== 2. 初始畫面必須渲染出來 ===');
ok(!!$('previewWrap') && $('previewWrap').innerHTML.includes('<svg'), '擬真發票沒有畫出來');
ok($('vUpper').querySelectorAll('.uslot').length === 9, '大寫格位不是 9 格');
ok($('itemList').querySelectorAll('.item').length === 1, '沒有預設的第一列品項');
ok($('fTaxId').textContent.trim() !== '', '統編欄位是空的');
ok(/\d+\/\d+\/\d+/.test($('fDate').textContent), '日期欄位格式不對', $('fDate').textContent);
ok($('itemList').textContent.includes('品項名稱'), '預設品名不是「品項名稱」');

console.log('=== 3. 常用品名清單必須是空的（預設值已全部移除）===');
ok(typeof T.itemNameChips === 'function' && T.itemNameChips().length === 0,
    '常用品名不該有預設內容');

console.log('=== 4. 主要互動不得拋錯 ===');
const actions = [
    ['切換二聯式', () => click($('segType').querySelectorAll('button')[1])],
    ['切回三聯式', () => click($('segType').querySelectorAll('button')[0])],
    ['開啟統編鍵盤', () => click($('fTaxId'))],
    ['關閉鍵盤', () => click(doc.querySelector('#numberInputModal .close-btn'))],
    ['開啟抬頭彈窗', () => click($('fTitle'))],
    ['關閉抬頭彈窗', () => click($('txtCancel'))],
    ['開啟日期月曆', () => click($('fDate'))],
    ['月曆換月', () => click(doc.querySelector('[data-dp="next"]'))],
    ['月曆點年份', () => click($('dpYearLabel'))],
    ['年份選單選一年', () => click(doc.querySelector('#dpYears [data-year]'))],
    ['月曆選日', () => click(doc.querySelector('#dpGrid [data-day]'))],
    ['確定日期', () => click(doc.querySelector('[data-dp="ok"]'))],
    ['新增品項', () => click($('btnAddItem'))],
    ['刪除品項', () => click($('itemList').querySelector('[data-act="del"]'))],
    ['點總計反推', () => click($('rowTotal'))],
    ['關閉反推鍵盤', () => click(doc.querySelector('#numberInputModal .close-btn'))],
    ['開啟歷史', () => click($('btnHistory'))],
    ['關閉歷史', () => click($('histClose'))],
    ['清除', () => click($('btnReset'))]
];
actions.forEach(([label, fn]) => {
    try { fn(); ok(true, label); }
    catch (e) { ok(false, label + ' 拋出錯誤', e.message); }
});

console.log('=== 5. 二聯式切換時統編列要收起、日期不能跟著消失 ===');
click($('segType').querySelectorAll('button')[1]);
ok($('rowTaxId').style.display === 'none', '二聯式沒有隱藏統編列');
ok($('rowDateOnly').style.display === 'flex', '二聯式沒有顯示備援日期列');
click($('segType').querySelectorAll('button')[0]);
ok($('rowTaxId').style.display === 'flex', '切回三聯式後統編列沒有回來');
ok($('rowDateOnly').style.display === 'none', '切回三聯式後備援日期列沒有收起');

console.log('=== 6. 金額連動 ===');
try {
    T.state.items = [{ name: '測試', qty: 1, price: 1000000 }];
    T.state.lockTotal = null;
    T.render();
    ok($('vSales').textContent === '1,000,000', '銷售額顯示錯誤', $('vSales').textContent);
    ok($('vTax').textContent === '50,000', '稅額顯示錯誤', $('vTax').textContent);
    ok($('vTotal').textContent === '1,050,000', '總計顯示錯誤', $('vTotal').textContent);
    const slots = Array.from($('vUpper').querySelectorAll('.uslot'))
        .map(s => (s.classList.contains('off') ? '－' : s.querySelector('b').textContent) + s.querySelector('i').textContent)
        .join(' ');
    ok(slots === '－億 －仟 壹佰 零拾 伍萬 零仟 零佰 零拾 零元', '大寫格位錯誤', slots);
} catch (e) {
    ok(false, '金額連動拋出錯誤', e.message);
}

console.log('');
console.log(fail === 0 ? `✓ 全部通過（${pass} 項）` : `✗ 通過 ${pass}／失敗 ${fail}`);
process.exit(fail ? 1 : 0);
