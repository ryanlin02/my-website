/**
 * 發票頁 - 統編自動帶入抬頭（端對端）
 *
 * 驗的是整條路走得通：
 *   自製鍵盤按出 8 碼 → 檢查碼驗證 → 本地名冊 → 稅籍索引分片 → 填上抬頭
 *
 * 另外釘住一個容易回頭踩的坑：統編開頭的 0 不可以被吃掉。
 * 鍵盤原本對金額做「前導零正規化」（打 0 再打 4 會變成 4），
 * 但統編是編號不是數值，04541302（鴻海）開頭那個 0 有意義。
 *
 * 執行：node tests/invoice/統編自動帶入測試.js  （需先 npm install jsdom）
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '../..');
let pass = 0, fail = 0;
const notes = [];

function ok(cond, label, extra) {
    if (cond) { pass++; console.log('  ✓ ' + label); }
    else { fail++; notes.push(label + (extra ? '　→ ' + extra : '')); console.log('  ✗ ' + label); }
}

/* 假的稅籍索引：只有這兩段號碼有資料 */
const FAKE_SHARDS = {
    '045': { '41302': '鴻海精密工業股份有限公司' },
    '160': { '03518': '宏達國際電子股份有限公司' }
};

const fetchLog = [];

function fakeFetch(url) {
    fetchLog.push(url);
    const mkJson = body => Promise.resolve({
        ok: true, status: 200, json: () => Promise.resolve(body)
    });
    if (url.endsWith('meta.json')) return mkJson({ count: 2, prefixLen: 3 });
    const m = url.match(/(\d{3})\.json$/);
    if (m && FAKE_SHARDS[m[1]]) return mkJson(FAKE_SHARDS[m[1]]);
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) });
}

const html = fs.readFileSync(path.join(ROOT, 'pages/invoice.html'), 'utf8')
    .replace(/<script src="\.\.\/js\/frame-guard\.js"><\/script>/, '')
    .replace(/<script async src="https:\/\/www\.googletagmanager[^<]*<\/script>/, '');

const errors = [];
const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://ryanlin02.github.io/my-website/pages/invoice.html',
    resources: { fetch(url) { return url.protocol === 'file:' ? undefined : null; } },
    beforeParse(window) {
        window.addEventListener('error', e => errors.push(e.message || String(e.error)));
        window.navigator.vibrate = () => true;
        window.fetch = fakeFetch;
    }
});

const { window } = dom;
const doc = window.document;

/* jsdom 不會自己抓相對路徑的 <script src>，所以手動把檔案內容跑起來，
   順序要與 invoice.html 一致（2026/07 起本頁改用共用鍵盤，多了前兩支）。

   兩處針對「eval 與真實 <script> 的語意差異」所做的補償：

     let → var
       真實頁面上所有 <script> 共用同一個全域語彙環境，所以
       common-keypad.js 用 let 宣告的鍵盤狀態，invoice-engine.js 看得到。
       這裡是一支一支 eval，各自獨立，let 不會跨得過去。

     去掉 'use strict'
       嚴格模式下的 indirect eval 會建立自己的作用域，頂層的 function
       宣告不會掛到 window；真實 <script> 則會（嚴格與否都一樣）。
       鍵盤的 onInput/sub 掛勾正是用函式名稱去 window 找的。

   兩者都只影響測試環境的執行語意，不改變被測程式的行為。 */
window.eval(fs.readFileSync(path.join(ROOT, 'js/common-keypad.js'), 'utf8')
    .replace(/^let /gm, 'var '));
window.eval(fs.readFileSync(path.join(ROOT, 'js/common-modals.js'), 'utf8'));
window.eval(fs.readFileSync(path.join(ROOT, 'js/taxid-lookup.js'), 'utf8'));

const engine = fs.readFileSync(path.join(ROOT, 'js/invoice-engine.js'), 'utf8')
    .replace(/^'use strict';$/m, '');
window.eval(engine + '\n;window.__test = { state, validateTaxId, render, describeTaxId, submitCalculatorValue };');

const T = window.__test;

doc.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));

const $ = id => doc.getElementById(id);
const click = el => el && el.dispatchEvent(new window.Event('click', { bubbles: true }));
const wait = ms => new Promise(r => setTimeout(r, ms));

/* 模擬使用者在共用鍵盤上一碼一碼按完統編 */
function typeDigits(digits) {
    for (const d of String(digits)) window.calculatorInput(Number(d));
}

function typeTaxId(digits) {
    click($('fTaxId'));                       // 開鍵盤
    typeDigits(digits);
    const typed = $('calculatorDisplay').textContent.trim();
    T.submitCalculatorValue();                // 確認輸入
    return typed;
}

function reset() {
    T.state.taxId = '';
    T.state.title = '';
    window.localStorage.clear();
    T.render();
}

(async function run() {
    console.log('發票頁 - 統編自動帶入抬頭\n');

    console.log('=== 1. 載入過程不得有錯 ===');
    ok(errors.length === 0, '載入期間沒有拋出錯誤', errors.join(' / '));
    ok(!!window.TaxIdLookup, 'taxid-lookup.js 有正確掛上 window.TaxIdLookup');

    console.log('\n=== 2. 統編開頭的 0 不可以被吃掉 ===');
    reset();
    const shown = typeTaxId('04541302');
    ok(shown === '04541302', '鍵盤顯示保留前導零', '實得 ' + JSON.stringify(shown));
    ok(T.state.taxId === '04541302', '存入狀態的統編保留前導零', '實得 ' + T.state.taxId);
    ok(T.validateTaxId('04541302') === true, '04541302 的檢查碼驗證要通過');

    console.log('\n=== 3. 稅籍索引查到後自動填上抬頭 ===');
    await wait(30);
    ok(T.state.title === '鴻海精密工業股份有限公司',
        '抬頭自動帶入', '實得 ' + JSON.stringify(T.state.title));
    ok($('fTitle').textContent.includes('鴻海精密'), '畫面上的抬頭欄位同步更新');

    console.log('\n=== 4. 帶入後會寫進本地名冊，下次離線也查得到 ===');
    const book = JSON.parse(window.localStorage.getItem('invNewCustomers') || '[]');
    ok(book.some(c => c.taxId === '04541302'), '已寫入客戶名冊',
        window.localStorage.getItem('invNewCustomers'));

    console.log('\n=== 5. 打到第 3 碼就預先載入分片 ===');
    fetchLog.length = 0;
    reset();
    click($('fTaxId'));
    typeDigits('160');
    await wait(20);
    ok(fetchLog.some(u => u.endsWith('160.json')), '第 3 碼觸發預先載入',
        JSON.stringify(fetchLog));
    typeDigits('03518');
    T.submitCalculatorValue();
    await wait(30);
    ok(T.state.title === '宏達國際電子股份有限公司', '按完 8 碼抬頭已經在了');

    console.log('\n=== 6. 使用者已經自己填了抬頭，就不要覆蓋他 ===');
    reset();
    T.state.title = '我自己打的抬頭';
    typeTaxId('16003518');
    await wait(30);
    ok(T.state.title === '我自己打的抬頭', '不覆蓋使用者輸入的抬頭',
        '實得 ' + T.state.title);

    console.log('\n=== 7. 索引查不到時安靜略過，不擋使用者 ===');
    reset();
    typeTaxId('99999999');
    await wait(30);
    ok(T.state.taxId === '99999999', '統編照樣存得進去');
    ok(T.state.title === '', '查不到就維持空白，讓使用者自己填');

    console.log('\n=== 8. 檢查碼不對時不查索引 ===');
    reset();
    fetchLog.length = 0;
    typeTaxId('16003519');   // 故意改掉最後一碼
    await wait(30);
    ok(T.validateTaxId('16003519') === false, '這組檢查碼確實不合法');
    ok(T.state.title === '', '檢查碼不對就不自動帶抬頭');

    console.log('\n' + '─'.repeat(46));
    if (fail === 0) {
        console.log(`✅ 全部通過（${pass} 項）`);
        process.exit(0);
    } else {
        console.log(`❌ ${fail} 項失敗（通過 ${pass} 項）`);
        notes.forEach(n => console.log('   • ' + n));
        process.exit(1);
    }
})();
