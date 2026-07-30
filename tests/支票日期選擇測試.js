/**
 * 支票頁 — 日期選擇器（走完整 UI）
 * ============================================================
 * 【這一支的由來】
 * 支票頁原有的三支測試都是直接設 startDate 變數再呼叫 generateCheckList()，
 * 完全跳過日期選擇器的 UI。也就是說「按下確定」之後那一整條線
 * 從來沒有被測過：
 *
 *     按確定 → handleCalculationChanged('start-date')   清空所有打勾
 *            → startDate = 選到的日期
 *            → 欄位顯示民國年 + 星期
 *            → generateCheckList()                      重算整串開票日期
 *            → saveCheckDraft()                         寫入草稿
 *
 * 而那條線是支票頁的核心。所以先在「舊實作」上把它釘住（23 項），
 * 再把日期選擇器換成 js/common-datepicker.js —— 第 3 節之後的斷言
 * 一個字都沒有改，這就是「換掉月曆但行為等價」的證據。
 *
 * 【2026/07：兩項刻意的行為變更】
 * 舊版禁選過去日期、也沒有年份跳轉。現在：
 *   過去日期改成「可選但變色提醒」（補登已開始繳的案子需要）
 *   年、月都可以直接點標題選
 * 這兩項的斷言因此換成新行為，其餘完全不動。
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
const cell = (r, cls) => { const e = r && r.querySelector('.' + cls); return e ? e.textContent.trim() : ''; };
const dayCell = n => [...d.querySelectorAll('#dpGrid [data-day]')].find(e => e.dataset.day === String(n));

/* 走真實路徑選日期：開啟 → 選年 → 選月 → 點日 → 按確定。
   年與月都是直接點標題選，不必像舊版那樣按 12 次 ›。 */
function pickDate(rocY, m, day) {
    ev('showDatePicker()');
    click($('dpYearLabel'));
    click(d.querySelector(`#dpYears [data-year="${rocY}"]`));
    click($('dpMonthLabel'));
    click(d.querySelector(`#dpMonths [data-month="${m}"]`));
    click(dayCell(day));
    click(d.querySelector('[data-dp="ok"]'));
}

console.log('\n════════ 支票頁：日期選擇器（共用元件）════════');

/* ============================================================
 * 1. 選擇器本身
 * ============================================================ */
console.log('\n=== 1. 開啟與月曆內容 ===');

ev('clearAllInputs()');
if ($('confirmModalOverlay').style.display === 'flex') click($('confirmModalOk'));

ev('showDatePicker()');
t('點日期欄位會開啟選擇器', $('datePickerModal').style.display === 'flex',
    $('datePickerModal').style.display);
t('  標題是支票頁自己的', $('datePickerTitle').textContent === '開始日期（民國）',
    $('datePickerTitle').textContent);

const today = new Date();
const TY = today.getFullYear() - 1911, TM = today.getMonth() + 1, TD = today.getDate();
t('預設停在今天所在的年月',
    $('dpYearLabel').textContent === `${TY} 年` && $('dpMonthLabel').textContent === `${TM} 月`,
    $('dpYearLabel').textContent + $('dpMonthLabel').textContent);
t('  標題是民國年', /^\d{2,3} 年$/.test($('dpYearLabel').textContent), $('dpYearLabel').textContent);

t('月曆固定 42 格（切月不會改變面板高度）',
    d.querySelectorAll('#dpGrid .dp-day').length === 42,
    String(d.querySelectorAll('#dpGrid .dp-day').length));
const lastDate = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
t(`  其中 ${lastDate} 格是本月的日期`,
    d.querySelectorAll('#dpGrid [data-day]').length === lastDate,
    String(d.querySelectorAll('#dpGrid [data-day]').length));
t('今天有標記', d.querySelectorAll('#dpGrid .dp-day.today').length === 1,
    String(d.querySelectorAll('#dpGrid .dp-day.today').length));

/* 【2026/07 行為變更】舊版：本月已過去的日期一律 disabled、點不到。
 * 現在改成可選但變色 —— 業務要補登「已經開始繳」的案子時需要選過去的日期。 */
const pastCells = [...d.querySelectorAll('#dpGrid [data-day]')].filter(e => e.classList.contains('past'));
t(`本月已過去的 ${TD - 1} 天標成警示色`, pastCells.length === TD - 1,
    `實得 ${pastCells.length} 格`);
t('  但仍然選得到（補登的情境不能被擋死）', (() => {
    if (TD === 1) return true;                 // 今天是 1 號就沒有過去的日期可測
    click(dayCell(1));
    return dayCell(1).classList.contains('sel');
})());
t('  選到過去日期時面板下方出現提醒', TD === 1 || ($('dpHint').textContent.includes('過去的日期')
    && $('dpHint').classList.contains('warn')), $('dpHint').textContent);

console.log('\n=== 2. 換月與換年 ===');
const monthBefore = $('dpMonthLabel').textContent;
click(d.querySelector('[data-dp="next"]'));
t('下一月會換標題', $('dpMonthLabel').textContent !== monthBefore, $('dpMonthLabel').textContent);
t('  格數仍然是 42', d.querySelectorAll('#dpGrid .dp-day').length === 42,
    String(d.querySelectorAll('#dpGrid .dp-day').length));
click(d.querySelector('[data-dp="prev"]'));
t('  上一月回到原本的月份', $('dpMonthLabel').textContent === monthBefore,
    $('dpMonthLabel').textContent);

/* 【2026/07 行為變更】舊版只有上下月，要選一年後的日期得按 12 次。 */
click($('dpYearLabel'));
t('點年份可以直接選年份（舊版沒有這個）',
    d.querySelector('.date-modal').dataset.pane === 'year'
    && d.querySelectorAll('#dpYears [data-year]').length === 12,
    d.querySelector('.date-modal').dataset.pane);
click(d.querySelector(`#dpYears [data-year="${TY + 1}"]`));
t(`  選 ${TY + 1} 年後回到日曆`, $('dpYearLabel').textContent === `${TY + 1} 年`
    && d.querySelector('.date-modal').dataset.pane === 'day',
    $('dpYearLabel').textContent);
click($('dpMonthLabel'));
t('點月份可以直接選月份',
    d.querySelector('.date-modal').dataset.pane === 'month'
    && d.querySelectorAll('#dpMonths [data-month]').length === 12);
click(d.querySelector('[data-dp="cancel"]'));

/* ============================================================
 * 2. 按下確定之後的那一條線
 *    以下的斷言與「舊實作版」逐字相同 —— 換掉月曆但行為等價
 * ============================================================ */
console.log('\n=== 3. 按確定 → 欄位、列表、尾款日期 ===');

ev('clearAllInputs()');
if ($('confirmModalOverlay').style.display === 'flex') click($('confirmModalOk'));

set('total-amount', 660000);
set('payment-amount', 55000);
set('check-count', 12);

// 選一個未來的日期（下個月 15 日）
const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 15);
const NY = nextMonth.getFullYear() - 1911, NM = nextMonth.getMonth() + 1;
pickDate(NY, NM, 15);

t('確定後選擇器關閉', $('datePickerModal').style.display === 'none',
    $('datePickerModal').style.display);
t('開始日期欄位帶入民國年', val('start-date').startsWith(`${NY}年${NM}月15日`), val('start-date'));
t('  並且附上星期', /（[日一二三四五六]）$/.test(val('start-date')), val('start-date'));
t('全域 startDate 同步', ev('startDate instanceof Date && startDate.getDate()') === 15,
    ev('String(startDate)'));

t('開票列表已重算（12 列）', rows().length === 12, String(rows().length));
t('  第 1 列就是選的日期', cell(rows()[0], 'col-date').includes('15'),
    cell(rows()[0], 'col-date'));

// 12 張票 = 11 張月票 + 1 張尾款票，尾款票日期是第 12 個月
const endExpect = new Date(NY + 1911, NM - 1 + 11, 15);
t('尾款票日期 = 開始日期 + 11 個月',
    val('end-date').startsWith(`${endExpect.getFullYear() - 1911}年${endExpect.getMonth() + 1}月15日`),
    val('end-date') + '（預期 ' + (endExpect.getFullYear() - 1911) + '年' + (endExpect.getMonth() + 1) + '月15日）');

console.log('\n=== 4. 換日期會清空打勾（避免拿舊進度對新日期）===');
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
const startBefore = ev('startDate.getTime()');
ev('showDatePicker()');
click(dayCell(9));
click(d.querySelector('[data-dp="cancel"]'));
t('按取消後日期欄位不變', val('start-date') === beforeCancel, val('start-date'));
t('  全域 startDate 也沒被動到', ev('startDate.getTime()') === startBefore);
t('  選擇器關閉', $('datePickerModal').style.display === 'none',
    $('datePickerModal').style.display);

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

console.log('\n=== 7. 補登：過去的日期真的送得出去 ===');
const pastDay = new Date(today.getFullYear(), today.getMonth() - 2, 10);
pickDate(pastDay.getFullYear() - 1911, pastDay.getMonth() + 1, 10);
t('兩個月前的日期可以選並確定',
    ev('startDate.getMonth()') === pastDay.getMonth() && ev('startDate.getDate()') === 10,
    ev('String(startDate)'));
t('  列表照樣算得出來', rows().length === 12, String(rows().length));

console.log('\n========================================');
console.log(`   通過 ${pass} 項 / 失敗 ${fail} 項`);
console.log('========================================');
process.exit(fail ? 1 : 0);
