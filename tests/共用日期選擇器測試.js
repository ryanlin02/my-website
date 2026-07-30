/**
 * 共用日期選擇器 — 元件測試
 * ============================================================
 * 這一支只測元件本身（js/common-datepicker.js），不牽涉任何頁面。
 * 分兩半：
 *
 *   A. 純算式  —— 42 格月曆、跨月夾日、年份清單、日期比較
 *                 這些不碰 DOM，錯了就是算式錯，最值得先釘住
 *   B. 互動    —— 換月、點年份選年份、過去日期提醒、取消不外洩
 *
 * 特別盯住兩件事（這是重寫的主要理由）：
 *   任何年月都是 42 格 → 面板高度不會因為切月而改變
 *   取消一定不呼叫 onOk → 呼叫端的資料不會被偷偷改掉
 *
 * 需要先安裝 jsdom：npm install jsdom
 * 執行：node tests/共用日期選擇器測試.js
 * ============================================================
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const R = path.join(__dirname, '..');

const dom = new JSDOM('<!DOCTYPE html><body></body>',
    { runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window;
const d = w.document;
const ev = code => w.eval(code);

// 元件會呼叫 vibrate()（正式頁面由 common-keypad.js 提供），這裡給個空的
ev('window.vibrate = function () {};');
ev(fs.readFileSync(path.join(R, 'js/common-datepicker.js'), 'utf8').replace(/^let /gm, 'var '));

let pass = 0, fail = 0;
const t = (name, cond, extra = '') => {
    cond ? pass++ : fail++;
    console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '   → ' + extra));
};
const $ = id => d.getElementById(id);
const click = el => el && el.dispatchEvent(new w.Event('click', { bubbles: true }));
const days = () => [...d.querySelectorAll('#dpGrid .dp-day')];
const pane = () => d.querySelector('.date-modal').dataset.pane;

const today = new Date();
const TY = today.getFullYear() - 1911, TM = today.getMonth() + 1, TD = today.getDate();

console.log('\n════════ 共用日期選擇器 ════════');

/* ============================================================
 * A. 純算式
 * ============================================================ */
console.log('\n=== 1. 民國年與西元年互轉 ===');
t('115/7/26 → 2026/7/26', ev('rocToDate({y:115,m:7,d:26}).getFullYear()') === 2026
    && ev('rocToDate({y:115,m:7,d:26}).getMonth()') === 6
    && ev('rocToDate({y:115,m:7,d:26}).getDate()') === 26);
t('2026/7/26 → 115/7/26',
    JSON.stringify(ev('dateToRoc(new Date(2026,6,26))')) === JSON.stringify({ y: 115, m: 7, d: 26 }),
    JSON.stringify(ev('dateToRoc(new Date(2026,6,26))')));
t('rocToday() 與系統日期一致',
    JSON.stringify(ev('rocToday()')) === JSON.stringify({ y: TY, m: TM, d: TD }),
    JSON.stringify(ev('rocToday()')));

console.log('\n=== 2. 每月天數（含閏年）===');
t('115 年 7 月 31 天', ev('daysInRocMonth(115,7)') === 31, String(ev('daysInRocMonth(115,7)')));
t('115 年 2 月 28 天（2026 非閏年）', ev('daysInRocMonth(115,2)') === 28, String(ev('daysInRocMonth(115,2)')));
t('113 年 2 月 29 天（2024 閏年）', ev('daysInRocMonth(113,2)') === 29, String(ev('daysInRocMonth(113,2)')));
t('189 年 2 月 28 天（2100 不是閏年）', ev('daysInRocMonth(189,2)') === 28, String(ev('daysInRocMonth(189,2)')));

console.log('\n=== 3. 月曆固定 42 格（面板高度不變的關鍵）===');
let allFortyTwo = true, sample = '';
for (let y = 113; y <= 117; y++) {
    for (let m = 1; m <= 12; m++) {
        const n = ev(`buildMonthCells(${y},${m}).length`);
        if (n !== 42) { allFortyTwo = false; sample = `${y}/${m} → ${n}`; }
    }
}
t('連續 5 年 60 個月，每個月都剛好 42 格', allFortyTwo, sample);

const cells115_7 = ev('JSON.stringify(buildMonthCells(115,7))');
const arr = JSON.parse(cells115_7);
t('115 年 7 月：1 號是星期三，所以前 3 格空白',
    arr[0] === null && arr[1] === null && arr[2] === null && arr[3] === 1,
    arr.slice(0, 5).join(','));
t('  最後一天是 31，之後全是空白',
    arr[33] === 31 && arr.slice(34).every(v => v === null),
    arr.slice(30).join(','));
t('  非空白格的數量等於當月天數',
    arr.filter(v => v !== null).length === 31,
    String(arr.filter(v => v !== null).length));

console.log('\n=== 4. 跨月時把「日」夾回存在的範圍 ===');
t('115/1/31 往後一個月 → 115/2/28（不會溢位到 3 月）',
    JSON.stringify(ev('shiftRocMonth({y:115,m:1,d:31},1)')) === JSON.stringify({ y: 115, m: 2, d: 28 }),
    JSON.stringify(ev('shiftRocMonth({y:115,m:1,d:31},1)')));
t('113/1/31 往後一個月 → 113/2/29（閏年）',
    JSON.stringify(ev('shiftRocMonth({y:113,m:1,d:31},1)')) === JSON.stringify({ y: 113, m: 2, d: 29 }),
    JSON.stringify(ev('shiftRocMonth({y:113,m:1,d:31},1)')));
t('115/1/15 往前一個月 → 114/12/15（跨年往前）',
    JSON.stringify(ev('shiftRocMonth({y:115,m:1,d:15},-1)')) === JSON.stringify({ y: 114, m: 12, d: 15 }),
    JSON.stringify(ev('shiftRocMonth({y:115,m:1,d:15},-1)')));
t('115/12/15 往後一個月 → 116/1/15（跨年往後）',
    JSON.stringify(ev('shiftRocMonth({y:115,m:12,d:15},1)')) === JSON.stringify({ y: 116, m: 1, d: 15 }),
    JSON.stringify(ev('shiftRocMonth({y:115,m:12,d:15},1)')));
t('一次跳 12 個月剛好一年',
    JSON.stringify(ev('shiftRocMonth({y:115,m:7,d:1},12)')) === JSON.stringify({ y: 116, m: 7, d: 1 }));
t('clampRocDay 會把 0 日夾成 1 日',
    ev('clampRocDay({y:115,m:7,d:0}).d') === 1, String(ev('clampRocDay({y:115,m:7,d:0}).d')));

console.log('\n=== 5. 年份清單與日期比較 ===');
t('預設 12 個年份（今年 −5 ～ +6）', ev('rocYearList().length') === 12, String(ev('rocYearList().length')));
t('  含今年', ev(`rocYearList().indexOf(${TY})`) >= 0, JSON.stringify(ev('rocYearList()')));
t('  範圍可調（[-1,1] → 3 個）', ev('rocYearList([-1,1]).length') === 3, String(ev('rocYearList([-1,1]).length')));
t('  由小到大排序', ev('JSON.stringify(rocYearList()) === JSON.stringify(rocYearList().slice().sort(function(a,b){return a-b;}))'));
t('compareRoc：早的 < 晚的', ev('compareRoc({y:115,m:7,d:1},{y:115,m:7,d:2})') === -1);
t('  相同回 0', ev('compareRoc({y:115,m:7,d:1},{y:115,m:7,d:1})') === 0);
t('  跨年也正確', ev('compareRoc({y:116,m:1,d:1},{y:115,m:12,d:31})') === 1);

/* ============================================================
 * B. 互動
 * ============================================================ */
console.log('\n=== 6. 開啟與 DOM 結構 ===');
ev(`window.__got = null;
    openDatePicker({
        title: '測試日期',
        value: { y: 115, m: 7, d: 26 },
        onOk: function (roc, date) { window.__got = { roc: roc, date: date.toISOString() }; }
    });`);
t('彈窗開啟', $('datePickerModal').style.display === 'flex', $('datePickerModal').style.display);
t('標題吃得到參數', $('datePickerTitle').textContent === '測試日期', $('datePickerTitle').textContent);
t('年、月分別是可點的按鍵',
    $('dpYearLabel').tagName === 'BUTTON' && $('dpMonthLabel').tagName === 'BUTTON');
t('  年份標題顯示 115 年', $('dpYearLabel').textContent === '115 年', $('dpYearLabel').textContent);
t('  月份標題顯示 7 月', $('dpMonthLabel').textContent === '7 月', $('dpMonthLabel').textContent);
t('日曆畫出 42 格', days().length === 42, String(days().length));
t('  其中 31 格是可點的日期',
    days().filter(e => e.hasAttribute('data-day')).length === 31,
    String(days().filter(e => e.hasAttribute('data-day')).length));
t('  26 日是選取狀態',
    days().find(e => e.dataset.day === '26').classList.contains('sel'));
t('提示行顯示完整日期與星期',
    /^115 年 7 月 26 日（[日一二三四五六]）$/.test($('dpHint').textContent), $('dpHint').textContent);

console.log('\n=== 7. 換月：格數永遠 42，按鍵位置不會跑 ===');
click(d.querySelector('[data-dp="next"]'));
t('下一月 → 115 年 8 月', $('dpMonthLabel').textContent === '8 月', $('dpMonthLabel').textContent);
t('  仍然是 42 格', days().length === 42, String(days().length));
for (let i = 0; i < 5; i++) click(d.querySelector('[data-dp="next"]'));
t('連按 5 次到 116 年 1 月（會跨年）',
    $('dpYearLabel').textContent === '116 年' && $('dpMonthLabel').textContent === '1 月',
    $('dpYearLabel').textContent + $('dpMonthLabel').textContent);
t('  格數還是 42', days().length === 42, String(days().length));
click(d.querySelector('[data-dp="prev"]'));
t('上一月回到 115 年 12 月',
    $('dpYearLabel').textContent === '115 年' && $('dpMonthLabel').textContent === '12 月',
    $('dpYearLabel').textContent + $('dpMonthLabel').textContent);

console.log('\n=== 8. 點年份選年份、點月份選月份 ===');
t('一開始顯示日曆', pane() === 'day', pane());
click($('dpYearLabel'));
t('點「年」切到年份選單', pane() === 'year', pane());
t('  年份選單有 12 格', d.querySelectorAll('#dpYears [data-year]').length === 12,
    String(d.querySelectorAll('#dpYears [data-year]').length));
const targetYear = TY + 3;
click(d.querySelector(`#dpYears [data-year="${targetYear}"]`));
t(`選 ${targetYear} 年後自動回到日曆`, pane() === 'day', pane());
t('  年份已更新', $('dpYearLabel').textContent === targetYear + ' 年', $('dpYearLabel').textContent);

click($('dpMonthLabel'));
t('點「月」切到月份選單', pane() === 'month', pane());
t('  月份選單有 12 格', d.querySelectorAll('#dpMonths [data-month]').length === 12);
click(d.querySelector('#dpMonths [data-month="2"]'));
t('選 2 月後回到日曆，且月份已更新',
    pane() === 'day' && $('dpMonthLabel').textContent === '2 月',
    pane() + ' / ' + $('dpMonthLabel').textContent);

console.log('\n=== 9. 選到不存在的日期會被夾住 ===');
ev('openDatePicker({ value: { y: 115, m: 1, d: 31 }, onOk: function(){} });');
click($('dpMonthLabel'));
click(d.querySelector('#dpMonths [data-month="2"]'));
t('1/31 切到 2 月 → 選取變成 28 日',
    days().find(e => e.classList.contains('sel')).dataset.day === '28',
    days().find(e => e.classList.contains('sel')).dataset.day);

console.log('\n=== 10. 今天 ===');
click(d.querySelector('[data-dp="today"]'));
t('按「今天」跳回今天',
    $('dpYearLabel').textContent === TY + ' 年' && $('dpMonthLabel').textContent === TM + ' 月',
    $('dpYearLabel').textContent + $('dpMonthLabel').textContent);
t('  今天那一格同時有 today 與 sel',
    days().find(e => e.dataset.day === String(TD)).classList.contains('today')
    && days().find(e => e.dataset.day === String(TD)).classList.contains('sel'));

console.log('\n=== 11. 確定與取消 ===');
ev(`window.__got = null;
    openDatePicker({ value: { y: 115, m: 7, d: 26 },
        onOk: function (roc, date) { window.__got = { roc: roc, iso: date.toISOString() }; } });`);
click(days().find(e => e.dataset.day === '9'));
click(d.querySelector('[data-dp="ok"]'));
t('按確定會回呼，且日期是剛選的 115/7/9',
    JSON.stringify(ev('window.__got && window.__got.roc')) === JSON.stringify({ y: 115, m: 7, d: 9 }),
    JSON.stringify(ev('window.__got')));
t('  同時給 Date 物件（西元 2026/7/9）',
    new Date(ev('window.__got.iso')).getFullYear() === 2026
    && new Date(ev('window.__got.iso')).getDate() === 9,
    ev('window.__got.iso'));
t('  確定後彈窗關閉', $('datePickerModal').style.display === 'none');

ev(`window.__got = null;
    openDatePicker({ value: { y: 115, m: 7, d: 26 }, onOk: function () { window.__got = 'ㄟ被呼叫了'; } });`);
click(days().find(e => e.dataset.day === '9'));
click(d.querySelector('[data-dp="cancel"]'));
t('按取消完全不回呼（呼叫端的資料不會被偷偷改掉）',
    ev('window.__got') === null, JSON.stringify(ev('window.__got')));
t('  取消後彈窗關閉', $('datePickerModal').style.display === 'none');

ev('openDatePicker({ onOk: function () { window.__got = "ㄟ被呼叫了"; } });');
click($('datePickerModal'));      // 點遮罩
t('點遮罩等於取消', ev('window.__got') === null && $('datePickerModal').style.display === 'none');

console.log('\n=== 12. 過去日期：可選，但變色並提示 ===');
ev(`openDatePicker({ value: { y: 115, m: 7, d: 26 }, warnBefore: 'today',
        onOk: function (roc) { window.__got = roc; } });`);
// 切到上個月，整個月都在今天之前
click(d.querySelector('[data-dp="prev"]'));
const pastDays = days().filter(e => e.classList.contains('past'));
t('上個月的日期全部標成 past',
    pastDays.length === days().filter(e => e.hasAttribute('data-day')).length,
    `${pastDays.length} / ${days().filter(e => e.hasAttribute('data-day')).length}`);
click(days().find(e => e.dataset.day === '10'));
t('  仍然選得到（沒有被禁用）',
    days().find(e => e.dataset.day === '10').classList.contains('sel'));
t('  提示行變成警示文字', $('dpHint').textContent.includes('過去的日期')
    && $('dpHint').classList.contains('warn'), $('dpHint').textContent);
ev('window.__got = null;');
click(d.querySelector('[data-dp="ok"]'));
t('  按確定照樣送出（補登的情境不能被擋死）',
    ev('window.__got && window.__got.d') === 10, JSON.stringify(ev('window.__got')));

ev(`openDatePicker({ value: { y: 115, m: 7, d: 26 }, onOk: function () {} });`);
t('沒有指定 warnBefore 時，不會有任何 past 標記',
    days().filter(e => e.classList.contains('past')).length === 0);

console.log('\n=== 13. CSS：高度固定的那幾條規則 ===');
const css = fs.readFileSync(path.join(R, 'css/keypad.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
t('.dp-body 有固定高度', /\.dp-body\s*\{[^}]*height:\s*\d+px/.test(css));
t('  三個選單都是絕對定位疊在一起（切換不影響高度）',
    /\.dp-grid,\s*\n?\s*\.dp-years,\s*\n?\s*\.dp-months\s*\{[^}]*position:\s*absolute/.test(css));
t('.dp-hint 有固定高度（沒提示時也不會塌）', /\.dp-hint\s*\{[^}]*height:\s*\d+px/.test(css));
t('日期格子有固定高度', /\.dp-day\s*\{[^}]*height:\s*\d+px/.test(css));

console.log('\n========================================');
console.log(`   通過 ${pass} 項 / 失敗 ${fail} 項`);
console.log('========================================');
process.exit(fail ? 1 : 0);
