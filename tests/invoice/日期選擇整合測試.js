/**
 * 發票頁 × 共用日期選擇器
 * ============================================================
 * 發票頁原本自己有一套月曆（openDate / paintDate / navDate + #dateModal），
 * 2026/07 改用 js/common-datepicker.js。這一支盯住三件事：
 *
 *   1. 舊月曆的 DOM 與樣式不能有殘留（兩套並存最容易出鬼）
 *   2. 選了日期真的會寫回 state 並反映到欄位與擬真發票上
 *   3. 本頁特有的「選到今天就存 null」要保留 ——
 *      這樣跨日之後再開啟，日期會自動跟著今天走
 *
 * 執行：node tests/invoice/日期選擇整合測試.js
 * ============================================================
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

// 載入方式與其他發票測試相同，理由見 tests/invoice/統編自動帶入測試.js
['js/common-history.js', 'js/common-keypad.js', 'js/common-modals.js', 'js/taxid-lookup.js', 'js/common-datepicker.js']
    .forEach(f => window.eval(fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/^let /gm, 'var ')));
window.eval(fs.readFileSync(path.join(ROOT, 'js/invoice-engine.js'), 'utf8')
    .replace(/^'use strict';$/m, '')
    + '\n;window.__test = { state, curDate, todayROC };');

doc.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));

const T = window.__test;
const $ = id => doc.getElementById(id);
const click = el => el && el.dispatchEvent(new window.Event('click', { bubbles: true }));
const dayCell = n => [...doc.querySelectorAll('#dpGrid [data-day]')].find(e => e.dataset.day === String(n));
const today = T.todayROC();

console.log('發票頁 × 共用日期選擇器\n');

console.log('=== 1. 舊月曆已完全移除 ===');
ok(!$('dateModal'), '頁面上沒有舊的 #dateModal');
ok(!$('calGrid') && !$('calTitle') && !$('dateOk'), '舊月曆的格子、標題、確定鍵都不在了');
ok(typeof window.paintDate !== 'function' && typeof window.navDate !== 'function',
    'paintDate() 與 navDate() 已移除（避免兩套月曆邏輯並存）');
ok(!!$('datePickerModal'), '共用日期選擇器已注入');

const invoiceCss = fs.readFileSync(path.join(ROOT, 'css/invoice.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
ok(!/\.cal-nav\s*\{|\.cal-grid\s*\{|\.date-btns\s*\{/.test(invoiceCss),
    'invoice.css 已移除舊月曆樣式');
ok(!/\.pad-modal\s*\{|\.pad-panel\s*\{/.test(invoiceCss),
    '  連舊的彈窗外框也一起清掉了（原本只有日期彈窗還在用）');
ok(/<script src="\.\.\/js\/common-datepicker\.js"><\/script>/.test(html),
    'invoice.html 有載入共用日期選擇器');

console.log('\n=== 2. 開啟時停在目前的日期 ===');
ok(T.state.date === null, '初始 state.date 是 null（＝跟著今天走）', JSON.stringify(T.state.date));
click($('fDate'));
ok($('datePickerModal').style.display === 'flex', '點日期欄位會開啟選擇器',
    $('datePickerModal').style.display);
ok($('datePickerTitle').textContent === '發票日期（民國）', '標題是發票頁自己的',
    $('datePickerTitle').textContent);
ok($('dpYearLabel').textContent === today.y + ' 年'
    && $('dpMonthLabel').textContent === today.m + ' 月',
    '停在今天的年月', $('dpYearLabel').textContent + $('dpMonthLabel').textContent);
ok(dayCell(today.d).classList.contains('sel'), '今天那一格是選取狀態');
ok(doc.querySelectorAll('#dpGrid .dp-day').length === 42, '固定 42 格',
    String(doc.querySelectorAll('#dpGrid .dp-day').length));
ok(doc.querySelectorAll('#dpGrid .dp-day.past').length === 0,
    '發票頁不啟用過去日期提醒（補開前幾天的發票是常態）');

console.log('\n=== 3. 選日期會寫回 state、欄位與擬真發票 ===');
click(doc.querySelector('[data-dp="next"]'));
click(dayCell(5));
click(doc.querySelector('[data-dp="ok"]'));

const expect = window.eval(`shiftRocMonth({y:${today.y},m:${today.m},d:5}, 1)`);
ok(JSON.stringify(T.state.date) === JSON.stringify({ y: expect.y, m: expect.m, d: 5 }),
    `下個月 5 日寫進 state（${expect.y}/${expect.m}/5）`, JSON.stringify(T.state.date));
const pad2 = n => String(n).padStart(2, '0');
ok($('fDate').textContent === `${expect.y}/${pad2(expect.m)}/05`,
    '欄位顯示同步', $('fDate').textContent);
ok($('previewWrap').innerHTML.includes(`>${expect.m}<`)
    && $('previewWrap').innerHTML.includes('>5<'),
    '擬真發票上的日期也換了', '（SVG 內找不到月或日）');
ok($('datePickerModal').style.display === 'none', '確定後選擇器關閉');

console.log('\n=== 4. 本頁特性：選到今天就存 null ===');
click($('fDate'));
ok($('dpMonthLabel').textContent === expect.m + ' 月',
    '再開啟時停在剛才選的月份（不是跳回今天）', $('dpMonthLabel').textContent);
click(doc.querySelector('[data-dp="today"]'));
click(doc.querySelector('[data-dp="ok"]'));
ok(T.state.date === null,
    '選到今天存成 null —— 跨日之後開啟會自動跟著今天走',
    JSON.stringify(T.state.date));
ok($('fDate').textContent === `${today.y}/${pad2(today.m)}/${pad2(today.d)}`,
    '  欄位顯示今天', $('fDate').textContent);

console.log('\n=== 5. 取消不改任何東西 ===');
click($('fDate'));
click(doc.querySelector('[data-dp="prev"]'));
click(dayCell(9));
click(doc.querySelector('[data-dp="cancel"]'));
ok(T.state.date === null, '按取消後 state.date 不變', JSON.stringify(T.state.date));
ok($('datePickerModal').style.display === 'none', '  選擇器關閉');

console.log('\n=== 6. 二聯式的日期欄位（換位置後仍然可點）===');
click($('segType').querySelectorAll('button')[1]);      // 切二聯式
click($('fDate2'));
ok($('datePickerModal').style.display === 'flex', '二聯式的日期欄位也開得起來',
    $('datePickerModal').style.display);
click(dayCell(11));
click(doc.querySelector('[data-dp="ok"]'));
ok(T.state.date && T.state.date.d === 11, '  選 11 日有寫回 state',
    JSON.stringify(T.state.date));
ok($('fDate2').textContent.endsWith('/11'), '  二聯式欄位顯示同步', $('fDate2').textContent);

console.log('\n──────────────────────────────────────────────');
if (fail) {
    console.log(`❌ ${fail} 項失敗（通過 ${pass} 項）`);
    notes.forEach(n => console.log('   • ' + n));
} else {
    console.log(`✅ 全部通過（${pass} 項）`);
}
process.exit(fail ? 1 : 0);
