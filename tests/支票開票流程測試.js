/**
 * 支票開票流程 — 功能測試
 * ============================================================
 * 涵蓋這一批針對實際業務流程做的改版：
 *   - 開票清單：打勾、進度、金額欄、尾款票區隔、日期調整標記
 *   - 歷史記錄：套用資料、開立進度、打勾寫回作為工作紀錄
 *   - 換票：以尾款續開下一批
 *   - 欄位釐清：開票張數含尾款票的拆解說明
 *
 * 需要先安裝 jsdom：npm install jsdom
 * 執行：node tests/支票開票流程測試.js
 * ============================================================
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const R = path.join(__dirname, '..');

const dom = new JSDOM(fs.readFileSync(path.join(R, 'pages/check.html'), 'utf8'), {
    url: 'https://ryanlin02.github.io/my-website/pages/check.html',
    runScripts: 'outside-only',
    pretendToBeVisual: true
});
const w = dom.window;
const d = w.document;
const ev = code => w.eval(code);

ev('window.setInterval=function(){return 0;};window.setTimeout=function(f){return 0;};');
const cfg = fs.readFileSync(path.join(R, 'pages/check.html'), 'utf8').match(/window\.KEYPAD_OPTIONS\s*=\s*\{[^}]*\}/);
if (cfg) ev(cfg[0]);
d.getElementById('historyPanel').style.display = 'none';

const scripts = [...fs.readFileSync(path.join(R, 'pages/check.html'), 'utf8')
    .matchAll(/<script src="\.\.\/js\/([^"]+)"/g)].map(m => m[1]).filter(f => f !== 'frame-guard.js');
for (const f of scripts) ev(fs.readFileSync(path.join(R, 'js', f), 'utf8').replace(/^let /gm, 'var '));
ev('initCommonModals()');

let pass = 0, fail = 0;
const t = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '   → ' + extra)); };
const $ = id => d.getElementById(id);
const val = id => ($(id) ? $(id).value : '<缺元素>');
const text = id => ($(id) ? $(id).textContent.trim() : '<缺元素>');
const disp = sel => d.querySelector(sel).style.display;
const set = (field, v) => ev(`currentInputField=${JSON.stringify(field)};calculatorValue=${JSON.stringify(String(v))};submitCalculatorValue();`);
const setDate = (y, m, day) => ev(`detachFromHistory();startDate=new Date(${y},${m - 1},${day});document.getElementById('start-date').value=formatDateToROC(startDate)+' '+getChineseWeekday(startDate);generateCheckList();`);
const rows = () => [...d.querySelectorAll('.check-row')];
const cell = (r, cls) => r.querySelector('.' + cls).textContent.trim();
// 有未儲存打勾時，這三個動作會先跳確認框；測試裡一律按下確定
const confirmIfShown = () => {
    if ($('confirmModalOverlay').style.display === 'flex'
        && $('confirmModalTitle').textContent.trim() === '尚未儲存') $('confirmModalOk').click();
};
const clearAll = () => { ev('clearAllInputs()'); confirmIfShown(); };

/* 情境：總額 120 萬、月付 5 萬、客戶這次給 20 張（19 張月票 + 1 張尾款票） */
console.log('\n=== 建立一批支票 ===');
set('total-amount', 1200000);
set('payment-amount', 50000);
set('check-count', 20);
setDate(2026, 1, 5);
t('尾款金額 = 1,200,000 − 50,000×19 = 250,000', val('deposit-amount') === '250,000', val('deposit-amount'));
t('產生 20 列', rows().length === 20, String(rows().length));
t('尾款票日期欄已填', val('end-date').length > 0, val('end-date'));

console.log('\n=== 欄位釐清：開票張數含尾款票 ===');
t('顯示「19 張月票 ＋ 1 張尾款票」', text('check-count-breakdown') === '19 張月票 ＋ 1 張尾款票', text('check-count-breakdown'));
set('check-count', 1);
t('只有 1 張時顯示「僅 1 張尾款票」', text('check-count-breakdown') === '僅 1 張尾款票', text('check-count-breakdown'));
set('check-count', 20);
t('鍵盤標題標明含尾款票',
    d.getElementById('check-count').getAttribute('onclick').includes('含尾款票'),
    d.getElementById('check-count').getAttribute('onclick'));

console.log('\n=== 清單內容 ===');
t('第 1 列日期 115/01/05', cell(rows()[0], 'col-date').startsWith('115/01/05'), cell(rows()[0], 'col-date'));
t('第 1 列金額 = 每期繳款 50,000', cell(rows()[0], 'col-amount') === '50,000', cell(rows()[0], 'col-amount'));
t('第 1 列剩餘 20', cell(rows()[0], 'col-left') === '20', cell(rows()[0], 'col-left'));
t('最後一列金額 = 尾款 250,000', cell(rows()[19], 'col-amount') === '250,000', cell(rows()[19], 'col-amount'));
t('最後一列標為尾款票', rows()[19].classList.contains('final-check-row') && cell(rows()[19], 'col-date').includes('尾款票'), cell(rows()[19], 'col-date'));
t('  只有一列是尾款票', d.querySelectorAll('.final-check-row').length === 1);
t('尾款票日期 = 第 20 期 = 116/08/05', cell(rows()[19], 'col-date').startsWith('116/08/05'), cell(rows()[19], 'col-date'));
t('跨年分隔列出現 1 次', d.querySelectorAll('.year-change-row').length === 1);
t('每列都可點擊打勾', rows().every(r => (r.getAttribute('onclick') || '').startsWith('toggleCheckWritten')));

console.log('\n=== 日期被調整的標記（客戶每月 31 號）===');
set('check-count', 8);
setDate(2026, 1, 31);
const adjusted = rows().map((r, i) => ({ i, date: cell(r, 'col-date'), marked: !!r.querySelector('.date-adjusted') }));
t('2 月縮到 28 日並標記', adjusted[1].date.startsWith('115/02/28') && adjusted[1].marked, JSON.stringify(adjusted[1]));
t('3 月回到 31 日、不標記（沒有滾雪球）', adjusted[2].date.startsWith('115/03/31') && !adjusted[2].marked, JSON.stringify(adjusted[2]));
t('4 月縮到 30 日並標記', adjusted[3].date.startsWith('115/04/30') && adjusted[3].marked, JSON.stringify(adjusted[3]));
t('標記文字為「原 31 日」', rows()[1].querySelector('.date-adjusted').textContent.trim() === '原 31 日', rows()[1].querySelector('.date-adjusted').textContent);
t('每月 5 號則完全沒有標記', (setDate(2026, 1, 5), d.querySelectorAll('.date-adjusted').length === 0));

console.log('\n=== 逐張打勾與進度 ===');
set('check-count', 20);
setDate(2026, 1, 5);
t('進度列顯示', disp('#write-progress') === 'flex');
t('  初始 0 / 20', text('progress-done') === '0' && text('progress-total') === '20');
t('  還要開 20 張', text('progress-left') === '20');
t('  合計卡片初始隱藏', disp('#write-summary') === 'none');
ev('toggleCheckWritten(0)');
t('打勾第 1 張 → 已開 1', text('progress-done') === '1' && text('progress-left') === '19');
t('  該列加上 written 樣式', rows()[0].classList.contains('written'));
t('  勾選符號出現', rows()[0].querySelector('.tick-box').textContent === '✔');
t('  合計卡片出現且金額 = 50,000', disp('#write-summary') === 'flex' && text('written-sum') === '50,000', text('written-sum'));
t('  提示還有 19 張未開立', text('written-sum-note') === '還有 19 張未開立', text('written-sum-note'));
ev('toggleCheckWritten(0)');
t('再點一次可取消打勾', text('progress-done') === '0' && !rows()[0].classList.contains('written'));
t('  合計卡片收回', disp('#write-summary') === 'none');

console.log('\n=== 全部開完的驗證 ===');
ev('for(let i=0;i<20;i++) toggleCheckWritten(i);');
t('已開 20 / 20', text('progress-done') === '20' && text('progress-left') === '0');
t('  進度列切換為完成樣式', $('write-progress').classList.contains('all-written'));
t('  合計 = 19×50,000 + 250,000 = 1,200,000', text('written-sum') === '1,200,000', text('written-sum'));
t('  合計等於總金額', text('written-sum') === text('written-sum-total'), text('written-sum') + ' vs ' + text('written-sum-total'));
t('  提示改為完成', text('written-sum-note').includes('相符'), text('written-sum-note'));
t('  合計卡片標為相符', $('write-summary').classList.contains('matched'));

console.log('\n=== 漏開一張會被合計抓出來 ===');
ev('toggleCheckWritten(7)');
t('取消第 8 張 → 合計少 50,000', text('written-sum') === '1,150,000', text('written-sum'));
t('  不再標為相符', !$('write-summary').classList.contains('matched'));
t('  提示還有 1 張未開立', text('written-sum-note') === '還有 1 張未開立', text('written-sum-note'));
ev('toggleCheckWritten(7)');

console.log('\n=== 保存與歷史記錄 ===');
w.localStorage.clear();
ev('saveCheckData()');
let hist = JSON.parse(w.localStorage.getItem('checkHistory') || '[]');
t('保存 1 筆', hist.length === 1, String(hist.length));
t('  打勾狀態一併存入（20 張全開）', hist[0].written.filter(Boolean).length === 20, JSON.stringify(hist[0].written && hist[0].written.length));
const savedId = hist[0].id;
ev('toggleHistoryPanel()');
t('歷史面板可開啟', $('historyPanel').style.display === 'block');
t('  用的是正確的 CSS 結構 (.history-list)', d.querySelector('.history-list') !== null);
t('  項目結構正確 (.history-detail-item)', d.querySelectorAll('.history-detail-item').length === 6, String(d.querySelectorAll('.history-detail-item').length));
t('  顯示開立進度徽章', text('historyContent').includes('已開立完成 20 張'), d.querySelector('.history-header-rate').textContent);
t('  有套用資料按鈕', [...d.querySelectorAll('.detail-btn')].some(b => b.textContent.trim() === '套用資料'));
t('  沒有殘留不存在的 class', d.querySelectorAll('.no-history, .note-btn, .history-note-display').length === 0);

console.log('\n=== 打勾寫回歷史記錄（工作紀錄）===');
ev('toggleCheckWritten(3)');
hist = JSON.parse(w.localStorage.getItem('checkHistory'));
t('取消第 4 張後，紀錄同步更新為 19 張', hist[0].written.filter(Boolean).length === 19, String(hist[0].written.filter(Boolean).length));
ev('loadCheckHistory()');
t('  歷史徽章改為「開立中 19 / 20 張」', d.querySelector('.history-header-rate').textContent.trim() === '開立中 19 / 20 張', d.querySelector('.history-header-rate').textContent);

console.log('\n=== 套用資料 ===');
clearAll();
t('清空後欄位為空', val('total-amount') === '' && val('check-count') === '');
t('  進度列隱藏', disp('#write-progress') === 'none');
t('  張數拆解清空', text('check-count-breakdown') === '');
ev('loadCheckToForm(' + savedId + ')'); confirmIfShown();
t('套用後總金額還原', val('total-amount') === '1,200,000', val('total-amount'));
t('  繳款金額還原', val('payment-amount') === '50,000', val('payment-amount'));
t('  張數還原', val('check-count') === '20', val('check-count'));
t('  尾款金額重算正確', val('deposit-amount') === '250,000', val('deposit-amount'));
t('  開始日期還原', val('start-date').startsWith('115年1月5日'), val('start-date'));
t('  清單重建 20 列', rows().length === 20, String(rows().length));
t('  打勾進度一併還原 (19/20)', text('progress-done') === '19', text('progress-done'));
t('  第 4 張仍為未打勾', !rows()[3].classList.contains('written'));
t('  面板自動關閉', $('historyPanel').style.display === 'none');

console.log('\n=== 改動輸入會切斷歷史連結（避免污染舊紀錄）===');
set('check-count', 10);
t('改張數後 linkedHistoryId 已清除', ev('linkedHistoryId') === null, String(ev('linkedHistoryId')));
t('  保留前 9 張的打勾（第 4 張原本就沒打勾，故為 8）', text('progress-done') === '8', text('progress-done'));
ev('toggleCheckWritten(0)');
hist = JSON.parse(w.localStorage.getItem('checkHistory'));
t('  此時打勾不會寫回舊紀錄', hist[0].written.filter(Boolean).length === 19, String(hist[0].written.filter(Boolean).length));

console.log('\n=== 以尾款續開下一批（換票）===');
clearAll();
set('total-amount', 1200000);
set('payment-amount', 50000);
set('check-count', 20);
setDate(2026, 1, 5);
ev('continueFromDeposit()'); confirmIfShown();
t('會先跳確認視窗說明帶入內容', $('confirmModalOverlay').style.display === 'flex');
t('  說明含新總金額 250,000', $('confirmModalContent').innerHTML.includes('250,000'));
t('  說明含新開始日期 116年8月5日', $('confirmModalContent').innerHTML.includes('116年8月5日'), $('confirmModalContent').textContent);
$('confirmModalOk').click();
t('總金額 ← 上一批尾款 250,000', val('total-amount') === '250,000', val('total-amount'));
t('  開始日期 ← 上一批尾款票日期 116/08/05', val('start-date').startsWith('116年8月5日'), val('start-date'));
t('  繳款金額不變', val('payment-amount') === '50,000', val('payment-amount'));
t('  張數清空待輸入', val('check-count') === '', val('check-count'));
t('  清單清空', $('check-list-content').innerHTML === '');
set('check-count', 5);
t('輸入 5 張後尾款 = 250,000 − 50,000×4 = 50,000', val('deposit-amount') === '50,000', val('deposit-amount'));
t('  提示這是最後一張票', text('deposit-amount-tip').includes('最後一張'), text('deposit-amount-tip'));
ev('continueFromDeposit()'); confirmIfShown();
t('尾款已等於一期繳款時，拒絕再續開', d.querySelector('.toast-message').textContent.includes('不需要再續開'),
    d.querySelector('.toast-message').textContent);

console.log('\n=== 續開的金額串接不會漏錢 ===');
clearAll();
set('total-amount', 1200000); set('payment-amount', 50000); set('check-count', 20); setDate(2026, 1, 5);
const batch1 = 50000 * 19;
const dep1 = Number(val('deposit-amount').replace(/,/g, ''));
ev('continueFromDeposit()'); confirmIfShown(); $('confirmModalOk').click();
set('check-count', 6);
const batch2 = 50000 * 5;
const dep2 = Number(val('deposit-amount').replace(/,/g, ''));
t('第一批月票 + 第二批月票 + 第二批尾款 = 原始總金額',
    batch1 + batch2 + dep2 === 1200000, `${batch1} + ${batch2} + ${dep2} = ${batch1 + batch2 + dep2}`);
t('  第一批尾款 = 第二批月票 + 第二批尾款', dep1 === batch2 + dep2, `${dep1} vs ${batch2 + dep2}`);

console.log('\n=== 螢幕不休眠 ===');
t('尚有未開立時要求保持喚醒', ev('wakeLockWanted') === true, String(ev('wakeLockWanted')));
ev('for(let i=0;i<checkCount;i++) if(!writtenChecks[i]) toggleCheckWritten(i);');
t('  全部開完後釋放', ev('wakeLockWanted') === false, String(ev('wakeLockWanted')));
clearAll();
t('  清空後釋放', ev('wakeLockWanted') === false);

console.log('\n========================================');
console.log('   通過 ' + pass + ' 項 / 失敗 ' + fail + ' 項');
console.log('========================================');
process.exit(fail ? 1 : 0);
