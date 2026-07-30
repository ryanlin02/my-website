/**
 * 支票頁 — 開立進度、漏開偵測與存檔流程測試
 * ============================================================
 * 涵蓋這一批討論後實作的行為：
 *   - 改張數時保留仍然有效的打勾（客戶臨時改張數的實務情境）
 *   - 漏開偵測：往下開票不誤報，真的跳過才提示
 *   - 「前往」跳到順序上最前面一張未打勾
 *   - 只打勾即時寫回；改計算才切斷連結並顯示「已修改，尚未儲存」
 *   - 保存時詢問覆蓋原紀錄或另存新紀錄
 *   - 有未儲存進度時，三個會清掉進度的動作先攔阻
 *   - 自動暫存與 24 小時效期
 *
 * 需要先安裝 jsdom：npm install jsdom
 * 執行：node tests/支票進度與存檔測試.js
 * ============================================================
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const R = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(R, 'pages/check.html'), 'utf8');

function boot() {
    const dom = new JSDOM(html, {
        url: 'https://ryanlin02.github.io/my-website/pages/check.html',
        runScripts: 'outside-only',
        pretendToBeVisual: true
    });
    const w = dom.window;
    w.eval("window.setInterval=function(){return 0;};window.setTimeout=function(){return 0;};");
    w.eval('window.scrollTo=function(){};');
    const cfg = html.match(/window\.KEYPAD_OPTIONS\s*=\s*\{[^}]*\}/);
    if (cfg) w.eval(cfg[0]);
    w.document.getElementById('historyPanel').style.display = 'none';
    const scripts = [...html.matchAll(/<script src="\.\.\/js\/([^"]+)"/g)].map(m => m[1]).filter(f => f !== 'frame-guard.js');
    for (const f of scripts) w.eval(fs.readFileSync(path.join(R, 'js', f), 'utf8').replace(/^let /gm, 'var '));
    w.eval('initCommonModals()');
    return w;
}

let w = boot();
let d = w.document;
let ev = c => w.eval(c);

let pass = 0, fail = 0;
const t = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '   → ' + extra)); };
const $ = id => d.getElementById(id);
const val = id => ($(id) ? $(id).value : '<缺元素>');
const text = id => ($(id) ? $(id).textContent.trim() : '<缺元素>');
const set = (f, v) => ev(`currentInputField=${JSON.stringify(f)};calculatorValue=${JSON.stringify(String(v))};submitCalculatorValue();`);
const setDate = (y, m, day) => ev(`handleCalculationChanged('start-date');startDate=new Date(${y},${m - 1},${day});document.getElementById('start-date').value=formatDateToROC(startDate)+' '+getChineseWeekday(startDate);generateCheckList();saveCheckDraft();`);
const tick = i => ev(`toggleCheckWritten(${i})`);
const ticks = () => ev('writtenChecks.filter(Boolean).length');
const guardShown = () => $('confirmModalOverlay').style.display === 'flex' && $('confirmModalTitle').textContent.trim() === '尚未儲存';
const okGuard = () => $('confirmModalOk').click();

const build = (total, pay, count, y, m, day) => { set('total-amount', total); set('payment-amount', pay); set('check-count', count); setDate(y, m, day); };

/* 【2026/07 步驟 2】歷史紀錄改由 js/common-history.js 以「信封」格式存放
   （外殼有 id / note / savedAt，本頁欄位收在 rec.data 裡）。
   測試不再直接讀 localStorage 的原始字串 —— 那是實作細節，
   改從 Store 讀出來再攤平成舊的形狀，斷言的內容完全不變，
   而且以後再換一次儲存方式也不必再改這些測試。 */
const histList = () => JSON.parse(w.localStorage.getItem('checkHistory') || '[]')
    .map(r => Object.assign({ id: r.id, note: r.note }, r.data || {}));


/* ============================================================ */
console.log('\n=== 客戶臨時改張數：已打勾的月票必須保留 ===');
build(1000000, 50000, 20, 2026, 1, 5);
for (let i = 0; i < 12; i++) tick(i);
t('前置：已打勾 12 張', ticks() === 12, String(ticks()));
set('check-count', 15);
t('張數 20 → 15，保留前 14 張的打勾（12 個都在）', ticks() === 12, String(ticks()));
t('  第 15 張（新的尾款票）未打勾', ev('writtenChecks[14]') === false);
t('  清單為 15 列', d.querySelectorAll('.check-row').length === 15, String(d.querySelectorAll('.check-row').length));
t('  第 1 張日期金額未變', d.querySelectorAll('.check-row')[0].querySelector('.col-date').textContent.trim().startsWith('115/01/05'));

console.log('\n--- 反向：張數變多 ---');
ev('clearAllInputs()'); if (guardShown()) okGuard();
build(1000000, 50000, 10, 2026, 1, 5);
for (let i = 0; i < 10; i++) tick(i);
t('前置：10 張全打勾', ticks() === 10, String(ticks()));
set('check-count', 14);
t('張數 10 → 14，保留前 9 張', ticks() === 9, String(ticks()));
t('  原第 10 張（曾是尾款票）打勾被清掉', ev('writtenChecks[9]') === false);

console.log('\n--- 改繳款金額則全部清空（整批金額都變了）---');
ev('clearAllInputs()'); if (guardShown()) okGuard();
build(1000000, 50000, 10, 2026, 1, 5);
for (let i = 0; i < 5; i++) tick(i);
set('payment-amount', 60000);
t('改繳款金額 → 打勾全清', ticks() === 0, String(ticks()));

console.log('\n--- 改開始日期也全部清空 ---');
build(1000000, 50000, 10, 2026, 1, 5);
for (let i = 0; i < 5; i++) tick(i);
setDate(2026, 2, 10);
t('改開始日期 → 打勾全清', ticks() === 0, String(ticks()));

/* ============================================================ */
console.log('\n=== 漏開偵測 ===');
ev('clearAllInputs()'); if (guardShown()) okGuard();
build(1000000, 50000, 10, 2026, 1, 5);
t('剛開始沒有警示', $('write-gap').style.display === 'none');
for (let i = 0; i < 5; i++) tick(i);
t('照順序開 5 張，仍然沒有警示（下方未打勾是還沒開到，不是漏開）', $('write-gap').style.display === 'none');
t('  進度列沒有 has-gap', !$('write-progress').classList.contains('has-gap'));
tick(6);
t('跳過第 6 張去開第 7 張 → 出現警示', $('write-gap').style.display === 'flex');
t('  中間有 1 張未打勾', text('gap-count') === '1', text('gap-count'));
t('  進度列切換為警示色', $('write-progress').classList.contains('has-gap'));
t('  右邊仍顯示還要開 4 張（與漏開數不同）', text('progress-left') === '4', text('progress-left'));
tick(8);
t('再跳過第 8 張 → 中間有 2 張未打勾', text('gap-count') === '2', text('gap-count'));
tick(5);
t('補開第 6 張 → 剩 1 張漏開', text('gap-count') === '1', text('gap-count'));
tick(7);
t('補齊後警示消失', $('write-gap').style.display === 'none');
t('  進度列恢復', !$('write-progress').classList.contains('has-gap'));

console.log('\n--- 前往：跳到順序上最前面一張未打勾 ---');
ev('clearAllInputs()'); if (guardShown()) okGuard();
build(1000000, 50000, 10, 2026, 1, 5);
[0, 1, 3, 5, 7].forEach(tick);
t('gapInfo.firstUnwritten = 索引 2（第 3 張）', ev('getWriteGapInfo().firstUnwritten') === 2, String(ev('getWriteGapInfo().firstUnwritten')));
t('  漏開數為 3（索引 2、4、6）', ev('getWriteGapInfo().gapCount') === 3, String(ev('getWriteGapInfo().gapCount')));
ev('goToFirstUnwritten()');
t('  前往後第 3 張被高亮', d.querySelector('.check-row[data-index="2"]').classList.contains('flash'));
t('  全部打勾時 firstUnwritten 為 -1', (ev('for(let i=0;i<10;i++) if(!writtenChecks[i]) toggleCheckWritten(i);'), ev('getWriteGapInfo().firstUnwritten') === -1));

/* ============================================================ */
console.log('\n=== 只打勾 vs 改計算 ===');
w.localStorage.clear();
ev('clearAllInputs()'); if (guardShown()) okGuard();
build(1000000, 50000, 10, 2026, 1, 5);
ev('saveCheckData()');
const rec = histList()[0];
t('保存後建立連結', ev('linkedHistoryId') !== null);
t('  「已修改」提示不顯示', $('unsaved-hint').style.display === 'none');
tick(0); tick(1);
t('只打勾 → 即時寫回紀錄', histList()[0].written.filter(Boolean).length === 2);
t('  連結仍在（進度是安全的）', ev('linkedHistoryId') !== null);
t('  不算未儲存', ev('hasUnsavedProgress()') === false);
t('  「已修改」提示仍不顯示', $('unsaved-hint').style.display === 'none');

set('check-count', 8);
t('改張數 → 連結中斷', ev('linkedHistoryId') === null);
t('  來源仍記得（供覆蓋用）', ev('sourceHistoryId') === rec.id);
t('  「已修改，尚未儲存」顯示出來', $('unsaved-hint').style.display === 'block');
t('  打勾保留', ticks() === 2, String(ticks()));
t('  算是未儲存進度', ev('hasUnsavedProgress()') === true);
tick(2);
t('  此時打勾不會寫回舊紀錄', histList()[0].written.filter(Boolean).length === 2);

/* ============================================================ */
console.log('\n=== 保存時詢問覆蓋或另存 ===');
ev('saveCheckData()');
t('跳出多選項對話框', $('choiceModalOverlay') !== null);
t('  說明含原紀錄張數 10', $('choiceModalOverlay').textContent.includes('10 張'), $('choiceModalOverlay').textContent);
t('  說明含目前張數 8', $('choiceModalOverlay').textContent.includes('8 張'));
const btns = [...$('choiceModalOverlay').querySelectorAll('[data-index]')].map(b => b.textContent.trim());
t('  兩個選項，覆蓋在前', btns[0] === '覆蓋原紀錄' && btns[1] === '另存為新紀錄', btns.join('|'));
$('choiceModalOverlay').querySelector('[data-index="0"]').click();
let hist = histList();
t('選覆蓋 → 仍然只有 1 筆', hist.length === 1, String(hist.length));
t('  張數已更新為 8', hist[0].checkCount === 8, String(hist[0].checkCount));
t('  id 不變', hist[0].id === rec.id);
t('  打勾一併存入 3 張', hist[0].written.filter(Boolean).length === 3, String(hist[0].written.filter(Boolean).length));
t('  提示消失', $('unsaved-hint').style.display === 'none');
t('  連結重新建立', ev('linkedHistoryId') === rec.id);

console.log('\n--- 選另存 ---');
set('check-count', 6);
ev('saveCheckData()');
$('choiceModalOverlay').querySelector('[data-index="1"]').click();
hist = histList();
t('選另存 → 變成 2 筆', hist.length === 2, String(hist.length));
t('  舊紀錄張數維持 8', hist.find(x => x.id === rec.id).checkCount === 8);
t('  新紀錄張數為 6', hist.find(x => x.id !== rec.id).checkCount === 6);
t('  連結指向新紀錄', ev('linkedHistoryId') === hist.find(x => x.id !== rec.id).id);

console.log('\n--- 全新試算不會問，直接存 ---');
ev('clearAllInputs()'); if (guardShown()) okGuard();
build(500000, 25000, 5, 2026, 3, 10);
ev('saveCheckData()');
t('沒有跳選項框', $('choiceModalOverlay') === null);
t('  直接新增為第 3 筆', histList().length === 3);

/* ============================================================ */
console.log('\n=== 有未儲存進度時的攔阻 ===');
w.localStorage.clear();
ev('clearAllInputs()'); if (guardShown()) okGuard();
build(1000000, 50000, 10, 2026, 1, 5);
t('沒打勾時，清除全部不會攔阻', (ev('clearAllInputs()'), !guardShown()));

build(1000000, 50000, 10, 2026, 1, 5);
for (let i = 0; i < 4; i++) tick(i);
t('打勾但未儲存 → 判定為有未儲存進度', ev('hasUnsavedProgress()') === true);
ev('clearAllInputs()');
t('清除全部會先攔阻', guardShown(), $('confirmModalTitle').textContent);
t('  訊息含已打勾張數', $('confirmModalContent').textContent.includes('4'), $('confirmModalContent').textContent);
ev('hideConfirmModal()');
t('  取消後打勾還在', ticks() === 4, String(ticks()));

ev('saveCheckData()');
t('保存後不再攔阻（進度已安全）', ev('hasUnsavedProgress()') === false);
ev('clearAllInputs()');
t('  清除全部直接執行', !guardShown() && val('total-amount') === '');

console.log('\n--- 套用其他紀錄前也會攔阻 ---');
build(1000000, 50000, 10, 2026, 1, 5);
ev('saveCheckData()');
const otherId = histList()[0].id;
ev('clearAllInputs()');
build(800000, 40000, 8, 2026, 5, 20);
tick(0); tick(1);
ev('loadCheckToForm(' + otherId + ')');
t('套用其他紀錄會先攔阻', guardShown());
ev('hideConfirmModal()');
t('  取消後維持原狀', val('total-amount') === '800,000', val('total-amount'));
ev('loadCheckToForm(' + otherId + ')'); okGuard();
t('  確定後才套用', val('total-amount') === '1,000,000', val('total-amount'));

console.log('\n--- 以尾款續開前也會攔阻 ---');
ev('clearAllInputs()'); if (guardShown()) okGuard();
build(1000000, 50000, 10, 2026, 1, 5);
tick(0);
ev('continueFromDeposit()');
t('續開會先攔阻', guardShown());
ev('hideConfirmModal()');
t('  取消後總金額不變', val('total-amount') === '1,000,000', val('total-amount'));

/* ============================================================ */
console.log('\n=== 自動暫存 ===');
ev('clearAllInputs()'); if (guardShown()) okGuard();
build(1200000, 60000, 12, 2026, 4, 15);
for (let i = 0; i < 5; i++) tick(i);
const draft = JSON.parse(w.localStorage.getItem('checkCalculatorDraft'));
t('打勾後有寫入暫存', draft !== null);
t('  含金額與張數', draft.totalAmount === 1200000 && draft.checkCount === 12);
t('  含打勾狀態 5 張', draft.written.filter(Boolean).length === 5, String(draft.written.filter(Boolean).length));

const savedDraft = w.localStorage.getItem('checkCalculatorDraft');
const savedHist = w.localStorage.getItem('checkHistory') || '[]';

console.log('\n--- 重新載入頁面應還原 ---');
w = boot(); d = w.document; ev = c => w.eval(c);
w.localStorage.setItem('checkCalculatorDraft', savedDraft);
w.localStorage.setItem('checkHistory', savedHist);
ev('restoreCheckDraft()');
t('總金額還原', val('total-amount') === '1,200,000', val('total-amount'));
t('  張數還原', val('check-count') === '12', val('check-count'));
t('  開始日期還原', val('start-date').startsWith('115年4月15日'), val('start-date'));
t('  清單重建 12 列', d.querySelectorAll('.check-row').length === 12);
t('  打勾進度還原 5 張', text('progress-done') === '5', text('progress-done'));

console.log('\n--- 超過 24 小時的暫存要丟棄 ---');
w = boot(); d = w.document; ev = c => w.eval(c);
const old = JSON.parse(savedDraft);
old.timestamp = new Date(Date.now() - 25 * 3600000).toISOString();
w.localStorage.setItem('checkCalculatorDraft', JSON.stringify(old));
ev('restoreCheckDraft()');
t('過期不還原', val('total-amount') === '', val('total-amount'));
t('  過期暫存已清除', w.localStorage.getItem('checkCalculatorDraft') === null);

console.log('\n--- 23 小時內仍然還原 ---');
w = boot(); d = w.document; ev = c => w.eval(c);
const fresh = JSON.parse(savedDraft);
fresh.timestamp = new Date(Date.now() - 23 * 3600000).toISOString();
w.localStorage.setItem('checkCalculatorDraft', JSON.stringify(fresh));
ev('restoreCheckDraft()');
t('23 小時內會還原', val('total-amount') === '1,200,000', val('total-amount'));

console.log('\n--- 清除全部輸入會一併清掉暫存 ---');
ev('clearAllInputs()'); if (guardShown()) okGuard();
t('暫存已清除', w.localStorage.getItem('checkCalculatorDraft') === null);

/* ============================================================ */
console.log('\n=== 版面：空值時大寫與張數說明要收起 ===');
t('清空後大寫為空字串（CSS :empty 會隱藏）', $('payment-amount-chinese').innerHTML === '' && $('check-count-breakdown').textContent === '');
t('  金額群組外框存在', d.querySelectorAll('.amount-group').length === 3, String(d.querySelectorAll('.amount-group').length));
t('  大寫已不再套用 .row（不需要 !important）', d.querySelectorAll('.chinese-row.row').length === 0);

console.log('\n========================================');
console.log('   通過 ' + pass + ' 項 / 失敗 ' + fail + ' 項');
console.log('========================================');
process.exit(fail ? 1 : 0);
