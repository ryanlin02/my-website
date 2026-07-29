/**
 * 發票頁 - 改用共用數字鍵盤（2026/07 第四批）
 * ============================================================
 * 本頁原本自帶一台鍵盤（openPad / padKey / #padModal）。這支測試守住
 * 遷移之後最容易掉的四件事：
 *
 *   1. 統編是「編號」不是數值 —— 前導零、8 碼、不可運算
 *   2. 金額欄位第一次有了四則運算（原本那台完全不能加減乘除）
 *   3. 大寫金額仍然用本頁的格位式寫法，與發票上的格子對得起來
 *   4. 舊鍵盤的殘骸不能留在頁面上（兩台並存最容易出鬼）
 *
 * 執行：node tests/invoice/鍵盤整合測試.js
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '../..');
let pass = 0, fail = 0;
const notes = [];

const ok = (cond, label, extra) => {
    if (cond) { pass++; console.log('  ✓ ' + label); }
    else { fail++; notes.push(label + (extra ? '　→ ' + extra : '')); console.log('  ✗ ' + label); }
};

const html = fs.readFileSync(path.join(ROOT, 'pages/invoice.html'), 'utf8')
    .replace(/<script src="\.\.\/js\/frame-guard\.js"><\/script>/, '')
    .replace(/<script async src="https:\/\/www\.googletagmanager[^<]*<\/script>/, '');

const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://ryanlin02.github.io/my-website/pages/invoice.html',
    resources: { fetch(url) { return url.protocol === 'file:' ? undefined : null; } },
    beforeParse(window) {
        window.navigator.vibrate = () => true;
        window.fetch = () => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) });
    }
});

const { window } = dom;
const doc = window.document;

/* 載入方式與 tests/invoice/統編自動帶入測試.js 相同，理由見該檔說明：
   let → var 讓鍵盤狀態跨得過 eval 邊界；去掉 'use strict' 讓頂層函式
   掛上 window（真實 <script> 本來就會）。 */
window.eval(fs.readFileSync(path.join(ROOT, 'js/common-keypad.js'), 'utf8')
    .replace(/^let /gm, 'var '));
window.eval(fs.readFileSync(path.join(ROOT, 'js/common-modals.js'), 'utf8'));
window.eval(fs.readFileSync(path.join(ROOT, 'js/taxid-lookup.js'), 'utf8'));
window.eval(fs.readFileSync(path.join(ROOT, 'js/invoice-engine.js'), 'utf8')
    .replace(/^'use strict';$/m, '')
    + '\n;window.__test = { state, calc, submitCalculatorValue, describeInvoiceUpper };');

doc.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));

const T = window.__test;
const $ = id => doc.getElementById(id);
const click = el => el && el.dispatchEvent(new window.Event('click', { bubbles: true }));
const type = s => [...String(s)].forEach(c => window.calculatorInput(Number(c)));
const tail = () => [...doc.querySelectorAll('.calculator-buttons [data-keypad-tail]')]
    .map(b => b.textContent.trim().replace(/\s+/g, ''));
const panelClass = () => doc.querySelector('.number-input-modal').className;
const shown = () => $('calculatorDisplay').textContent;
const sub = () => $('calculatorSub').textContent;

console.log('發票頁 - 共用數字鍵盤整合\n');

console.log('=== 1. 舊鍵盤已完全移除 ===');
ok(!$('padModal'), '頁面上沒有舊的 #padModal');
ok(!$('padGrid') && !$('padDisp'), '舊鍵盤的顯示區與按鍵容器都不在了');
ok(typeof window.padKey !== 'function', 'padKey() 已移除（避免兩套按鍵邏輯並存）');
ok(!!$('numberInputModal'), '共用鍵盤已注入');
ok(!/\.pad-grid\s*\{|\.key\s*\{/.test(fs.readFileSync(path.join(ROOT, 'css/invoice.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')), 'invoice.css 已移除舊鍵盤樣式');
ok(/\.pad-panel\s*\{/.test(fs.readFileSync(path.join(ROOT, 'css/invoice.css'), 'utf8')),
    '  但保留 .pad-panel —— 日期選擇彈窗還在用同一組外框');
ok(/<link rel="stylesheet" href="\.\.\/css\/keypad\.css">[\s\S]*<link rel="stylesheet" href="\.\.\/css\/invoice\.css">/.test(html),
    'keypad.css 排在 invoice.css 之前（本頁才蓋得掉共用樣式）');

console.log('\n=== 2. 統一編號：編號型 ===');
click($('fTaxId'));
ok(panelClass().includes('form-code'), '面板套上 form-code（收掉運算子欄，變三欄）', panelClass());
ok(!tail().includes('='), '末列沒有等號（統編不能做運算）', tail().join(' '));
ok(tail().length === 1 && tail()[0].startsWith('0'), '末列只有一顆跨三格的 0', tail().join(' '));
ok(shown() === '', '一開始是空的，不是 0（統編第一碼就可能是 0）', JSON.stringify(shown()));

type('045');
ok(shown() === '045', '前導零保留（045…）', shown());
ok(sub().includes('還要 5 碼'), '副資訊提示還差幾碼', sub());

type('41302');
ok(shown() === '04541302', '八碼完整，開頭的 0 沒有被吃掉', shown());
ok(shown().indexOf(',') === -1, '不加千分位（04,595,257 不是統編）', shown());
ok(sub().indexOf('✓') === 0, '檢查碼正確時副資訊顯示 ✓', sub());

window.calculatorInput(9);
ok(shown() === '04541302', '第 9 碼被擋掉', shown());

T.submitCalculatorValue();
ok(T.state.taxId === '04541302', '確認輸入後存進狀態的統編保留前導零', T.state.taxId);

click($('fTaxId'));
window.calculatorClear();          // 上一組號碼還在，先清掉才輸入得進去
type('12345678');
ok(sub().indexOf('✕') === 0, '檢查碼不符時副資訊顯示 ✕', sub());
window.closePad();

console.log('\n=== 3. 金額欄位：金額型（並且第一次有四則運算）===');
click(doc.querySelector('.item .cell[data-act="price"]') || $('itemList').querySelector('[data-act="price"]'));
ok(tail().join(' ').includes('000') && tail().join(' ').includes('萬'),
    '末列有 000 與 萬', tail().join(' '));
ok(!panelClass().includes('form-code'), '不是編號型（運算子欄還在）', panelClass());

window.calculatorClear();
type('1500000');
ok(shown() === '1,500,000', '大字帶千分位', shown());
ok(T.describeInvoiceUpper(1500000) === sub(), '副資訊是本頁的格位式大寫', sub());
/* 這串看起來很怪，但它是刻意的：本頁的大寫是「格位式」，
   對應發票上印好的 億仟佰拾萬仟佰拾元 九個格子，每一格都要填一個字，
   用不到的高位才劃掉。與舊鍵盤的副資訊逐字相同。 */
ok(sub() === '壹佰伍拾零萬零仟零佰零拾零元', '  格位式大寫與舊鍵盤逐字相同', sub());

window.calculatorOperation('-');
type('300000');
window.calculatorEquals();
ok(window.calculatorValue === '1200000', '可以做減法：1500000 − 300000 = 1200000', window.calculatorValue);
T.submitCalculatorValue();
ok(T.state.items[0].price === 1200000, '算出來的結果有寫回品項單價', String(T.state.items[0].price));

console.log('\n=== 4. 數量：計數型 ===');
click(doc.querySelector('[data-act="qty"]'));
ok(!tail().join(' ').includes('000') && !tail().join(' ').includes('萬'),
    '沒有 000 與 萬（數量按不到那麼大）', tail().join(' '));
window.calculatorClear();
type('12345');
ok(window.calculatorValue === '1234', '最多 4 位數', window.calculatorValue);
T.submitCalculatorValue();
ok(T.state.items[0].qty === 1234, '數量寫回品項', String(T.state.items[0].qty));

console.log('\n=== 5. 由含稅總額反推 ===');
click($('rowTotal'));
window.calculatorClear();
type('420000');
T.submitCalculatorValue();
ok(T.calc().total === 420000, '反推後含稅總計回到 420,000', String(T.calc().total));

console.log('\n──────────────────────────────────────────────');
if (fail) {
    console.log(`❌ ${fail} 項失敗（通過 ${pass} 項）`);
    notes.forEach(n => console.log('   • ' + n));
} else {
    console.log(`✅ 全部通過（${pass} 項）`);
}
process.exit(fail ? 1 : 0);
