/**
 * 支票頁 — 日期選擇器（走完整 UI）
 * ============================================================
 * 【為什麼要有這一支】
 * 支票頁原有的三支測試都是直接設 startDate 變數再呼叫 generateCheckList()，
 * 完全跳過日期選擇器的 UI。也就是說「按下確認」之後那一整條線
 * 從來沒有被測過：
 *
 *     按確認 → handleCalculationChanged('start-date')   清空所有打勾
 *            → startDate = selectedDate
 *            → 欄位顯示民國年 + 星期
 *            → generateCheckList()                      重算整串開票日期
 *            → saveCheckDraft()                         寫入草稿
 *
 * 而那條線是支票頁的核心。這一支先在「現有程式碼」上把它釘住，
 * 之後日期選擇器換成共用元件時，才有東西可以比對是否等價。
 *
 * 需要先安裝 jsdom：npm install jsdom
 * 執行：node tests/支票日期選擇測試.js
 * ============================================================
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const R = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(R, 'pages/check.html'), 'utf8');

const dom = new JSDOM(html, {
    url: 'https://ryanlin02.github.io/my-website/pages/check.html',
    runScripts: 'outside-only',
    pretendToBeVisual: true
});
const w = dom.window;
const d = w.document;
const ev = code => w.eval(code);

ev('window.setInterval=function(){return 0;};window.setTimeout=function(f){return 0;};');
for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    if (m[1].includes('KEYPAD')) ev(m[1]);
}
d.getElementById('historyPanel').style.display = 'none';

const scripts = [...html.matchAll(/<script src="\.\.\/js\/([^"]+)"/g)]
    .map(m => m[1]).filter(f => f !== 'frame-guard.js');
for (const f of scripts) ev(fs.readFileSync(path.join(R, 'js', f), 'utf8').replace(/^let /gm, 'var '));
ev('initCommonModals()');
d.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));

let pass = 0, fail = 0;
const t = (name, cond, extra = '') => {
    cond ? pass++ : fail++;
    console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '   → ' + extra));
};
const $ = id => d.getElementById(id);
const val = id => ($(id) ? $(id).value : '<缺元素>');
const click = el => el && el.dispatchEvent(new w.Event('click', { bubbles: true }));
const set = (field, v) => ev(`currentInputField=${JSON.stringify(field)};calculatorValue=${JSON.stringify(String(v))};submitCalculatorValue();`);
const rows = () => [...d.querySelectorAll('.check-row')];
const cell = (r, cls) => { const e = r.querySelector('.' + cls); return e ? e.textContent.trim() : ''; };

/* 走真實路徑選日期：開啟選擇器 → 點某一天 → 按確認 */
function pickDate(y, m, day) {
    ev('showDatePicker()');
    // 月曆停在目前選取的月份，先切到目標月份（一次一個月，這正是舊版的限制）
    for (let i = 0; i < 36; i++) {
        const title = $('date-picker-title').textContent;
        if (title === `${y - 1911}年${m}月`) break;
        click($(title < `${y - 1911}年${m}月` ? 'next-month' : 'prev-month'));
    }
    const target = [...d.querySelectorAll('#date-picker-body td[data-date]')]
        .find(td => new Date(td.getAttribute('data-date')).getDate() === day
            && !td.hasAttribute('disabled'));
    click(target);
    click($('confirm-date'));
    return target;
}

console.log('\n════════ 支票頁：日期選擇器（現有實作）════════');

/* ============================================================
 * 1. 選擇器本身
 * ============================================================ */
console.log('\n=== 1. 開啟與月曆內容 ===');

ev('clearAllInputs()');
if ($('confirmModalOverlay').style.display === 'flex') click($('confirmModalOk'));

ev('showDatePicker()');
t('點日期欄位會開啟選擇器', $('date-picker-overlay').style.display === 'flex',
    $('date-picker-overlay').style.display);

const today = new Date();
const rocToday = `${today.getFullYear() - 1911}年${today.getMonth() + 1}月`;
t('預設停在今天所在的月份', $('date-picker-title').textContent === rocToday,
    $('date-picker-title').textContent);
t('  標題是民國年', /^\d{2,3}年\d{1,2}月$/.test($('date-picker-title').textContent),
    $('date-picker-title').textContent);

const cells = [...d.querySelectorAll('#date-picker-body td[data-date]')];
const lastDate = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
t(`本月天數正確（${lastDate} 天）`, cells.length === lastDate, String(cells.length));
t('今天有標記', d.querySelectorAll('#date-picker-body td.today').length === 1,
    String(d.querySelectorAll('#date-picker-body td.today').length));

/* 這是目前刻意的規則：支票是未來到期日，過去的日期不給選。
 * 這一項記錄「現況」—— 之後改成「可選但變色」時，這裡會跟著改，
 * 屆時是刻意的行為變更，不是不小心弄壞。 */
const pastCells = cells.filter(td => td.hasAttribute('disabled'));
const pastExpected = today.getDate() - 1;
t(`目前的規則：本月已過去的 ${pastExpected} 天不可選`, pastCells.length === pastExpected,
    `實得 ${pastCells.length} 格`);

console.log('\n=== 2. 換月 ===');
const titleBefore = $('date-picker-title').textContent;
click($('next-month'));
t('下一月會換標題', $('date-picker-title').textContent !== titleBefore,
    $('date-picker-title').textContent);
click($('prev-month'));
t('  上一月會回到原本的月份', $('date-picker-title').textContent === titleBefore,
    $('date-picker-title').textContent);

/* 舊版的限制，一併記錄下來：只有「上一月／下一月」，沒有年份跳轉。
 * 要選一年後的日期得按 12 次。 */
t('目前沒有年份跳轉按鈕（只有上下月）',
    !$('date-picker-overlay').querySelector('[id*="year"]'));

/* ============================================================
 * 2. 按下確認之後的那一條線（這次的重點）
 * ============================================================ */
console.log('\n=== 3. 按確認 → 欄位、列表、尾款日期 ===');

ev('clearAllInputs()');
if ($('confirmModalOverlay').style.display === 'flex') click($('confirmModalOk'));

set('total-amount', 660000);
set('payment-amount', 55000);
set('check-count', 12);

// 選一個未來的日期（下個月 15 日，一定不會被「過去日期」規則擋掉）
const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 15);
const NY = nextMonth.getFullYear(), NM = nextMonth.getMonth() + 1;
pickDate(NY, NM, 15);

t('確認後選擇器關閉', $('date-picker-overlay').style.display === 'none',
    $('date-picker-overlay').style.display);
t('開始日期欄位帶入民國年', val('start-date').startsWith(`${NY - 1911}年${NM}月15日`),
    val('start-date'));
t('  並且附上星期', /（[日一二三四五六]）$/.test(val('start-date')), val('start-date'));
t('全域 startDate 同步', ev('startDate instanceof Date && startDate.getDate()') === 15,
    ev('String(startDate)'));

t('開票列表已重算（12 列）', rows().length === 12, String(rows().length));
t('  第 1 列就是選的日期', cell(rows()[0], 'col-date').includes('15'),
    cell(rows()[0], 'col-date'));

// 12 張票 = 11 張月票 + 1 張尾款票，尾款票日期是第 12 個月
const endExpect = new Date(NY, NM - 1 + 11, 15);
t('尾款票日期 = 開始日期 + 11 個月',
    val('end-date').startsWith(`${endExpect.getFullYear() - 1911}年${endExpect.getMonth() + 1}月15日`),
    val('end-date') + '（預期 ' + (endExpect.getFullYear() - 1911) + '年' + (endExpect.getMonth() + 1) + '月15日）');

console.log('\n=== 4. 換日期會清空打勾（避免拿舊進度對新日期）===');
// 走真實路徑打兩個勾（點列＝toggleCheckWritten）
ev('toggleCheckWritten(0); toggleCheckWritten(1);');
t('先造出兩個已打勾', ev('writtenChecks.filter(Boolean).length') === 2,
    JSON.stringify(ev('writtenChecks')));

pickDate(NY, NM, 20);
t('換日期之後打勾被清空', ev('writtenChecks.filter(Boolean).length') === 0,
    JSON.stringify(ev('writtenChecks')));
t('  列表跟著換成新日期', cell(rows()[0], 'col-date').includes('20'),
    cell(rows()[0], 'col-date'));

console.log('\n=== 5. 取消不應該改到任何東西 ===');
const beforeCancel = val('start-date');
ev('showDatePicker()');
const anyCell = [...d.querySelectorAll('#date-picker-body td[data-date]')]
    .find(td => !td.hasAttribute('disabled'));
click(anyCell);
click($('cancel-date'));
t('按取消後日期欄位不變', val('start-date') === beforeCancel, val('start-date'));
t('  選擇器關閉', $('date-picker-overlay').style.display === 'none',
    $('date-picker-overlay').style.display);

console.log('\n=== 6. 草稿有被寫入 ===');
pickDate(NY, NM, 25);
/* 草稿的 key 從原始碼讀出來，不要在測試裡另外寫死一份。
   （不能用 ev('CHECK_DRAFT_KEY')：它是 const，在 eval 裡宣告的
     const 不會留在全域，離開那次 eval 就消失了。） */
const draftKey = (fs.readFileSync(path.join(R, 'js/check-engine.js'), 'utf8')
    .match(/CHECK_DRAFT_KEY\s*=\s*'([^']+)'/) || [])[1];
const draft = w.localStorage.getItem(draftKey) || '';
t('選完日期會寫入草稿', !!draft, `key=${draftKey}　${draft ? '' : '（找不到草稿）'}`);
t('  草稿裡的開始日期就是剛選的那天',
    draft ? new Date(JSON.parse(draft).startDate).getDate() === 25 : false,
    draft ? JSON.parse(draft).startDate : '');

console.log('\n========================================');
console.log(`   通過 ${pass} 項 / 失敗 ${fail} 項`);
console.log('========================================');
process.exit(fail ? 1 : 0);
