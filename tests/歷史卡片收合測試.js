/**
 * 歷史卡片收合／展開測試 —— 步驟 5（先做支票頁）
 * ============================================================
 * 【這支測試存在的原因】
 *
 * 既有的支票頁測試只檢查「六個欄位在不在 DOM 裡」，
 * 而收合之後那六個欄位**仍然在 DOM 裡**，只是被 CSS 藏起來。
 * 也就是說：就算收合功能完全沒生效、或是展開後打不開，
 * 既有測試依然全綠。這支補的正是那個缺口。
 *
 * 三件事要守住：
 *
 *   1. 結構分兩層 —— 找得到那一筆所需的資訊在 .history-item-summary，
 *      其餘全部在 .history-item-detail。分錯層就等於沒收合。
 *
 *   2. 點一下真的會展開／收合，而且點裡面的按鈕不會誤觸展開。
 *
 *   3. 展開狀態要跨重繪保留 —— 存備註、打勾、刪除都會讓面板整個重畫，
 *      狀態若只寫在 DOM 上，使用者展開的那一筆會在存完備註後自己合起來。
 *
 * 需要先安裝 jsdom：npm install jsdom
 * 執行：node tests/歷史卡片收合測試.js
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

function boot() {
    const html = fs.readFileSync(path.join(R, 'pages/check.html'), 'utf8');
    const dom = new JSDOM(html, {
        url: 'https://ryanlin02.github.io/my-website/pages/check.html',
        runScripts: 'outside-only',
        pretendToBeVisual: true
    });
    const w = dom.window;
    w.eval('window.setInterval=function(){return 0;};window.setTimeout=function(){return 0;};');
    w.eval('window.scrollTo=function(){};');
    w.navigator.vibrate = () => true;

    const cfg = html.match(/window\.KEYPAD_OPTIONS\s*=\s*\{[^}]*\}/);
    if (cfg) w.eval(cfg[0]);
    w.document.getElementById('historyPanel').style.display = 'none';

    const scripts = [...html.matchAll(/<script src="\.\.\/js\/([^"]+)"/g)]
        .map(m => m[1]).filter(f => f !== 'frame-guard.js');
    for (const f of scripts) {
        w.eval(fs.readFileSync(path.join(R, 'js', f), 'utf8').replace(/^let /gm, 'var '));
    }
    w.eval('initCommonModals()');
    return w;
}

const setF = (w, f, v) =>
    w.eval(`currentInputField=${JSON.stringify(f)};calculatorValue=${JSON.stringify(String(v))};submitCalculatorValue();`);

function buildAndSave(w, total, pay, count, y, m, d) {
    setF(w, 'total-amount', total);
    setF(w, 'payment-amount', pay);
    setF(w, 'check-count', count);
    w.eval(`handleCalculationChanged('start-date');startDate=new Date(${y},${m - 1},${d});`
        + `document.getElementById('start-date').value=formatDateToROC(startDate)+' '+getChineseWeekday(startDate);`
        + `generateCheckList();`);
    w.eval('saveCheckData()');
    // 有未儲存進度時會先跳確認
    const ok = w.document.getElementById('confirmModalOk');
    if (w.document.getElementById('confirmModalOverlay').style.display === 'flex') ok.click();
}

const items = w => [...w.document.querySelectorAll('.history-item')];

/* ============================================================
   一、結構：哪些資訊留在收合時看得到的那一層
   ============================================================ */
console.log('\n收合時的結構');

{
    const w = boot();
    buildAndSave(w, 1200000, 100000, 12, 2026, 8, 5);
    w.eval('toggleHistoryPanel()');

    const item = items(w)[0];
    t('渲染得出卡片', !!item);

    const summary = item.querySelector('.history-item-summary');
    const detail = item.querySelector('.history-item-detail');
    t('卡片分成 summary 與 detail 兩層', !!summary && !!detail);

    const sText = summary.textContent;
    t('  收合時看得到存檔時間', /今天\s+\d{2}:\d{2}/.test(sText), sText.replace(/\s+/g, ' '));
    t('  收合時看得到開立進度', /12 張 · 尚未開立/.test(sText), sText.replace(/\s+/g, ' '));
    t('  收合時看得到總金額', sText.includes('1,200,000'));
    t('  收合時看得到張數', /12 張/.test(sText));

    /* 六個欄位與三顆按鈕都必須在 detail 裡。
       放錯層的話畫面上仍然看得到，收合就等於沒做。 */
    t('六個細項全在 detail 裡',
        detail.querySelectorAll('.history-detail-item').length === 6 &&
        summary.querySelectorAll('.history-detail-item').length === 0,
        `detail ${detail.querySelectorAll('.history-detail-item').length} / summary ${summary.querySelectorAll('.history-detail-item').length}`);

    t('  套用按鈕在 detail 裡',
        !!detail.querySelector('.detail-btn') && !summary.querySelector('.detail-btn'));
    t('  刪除按鈕在 detail 裡（收合時碰不到，不會誤刪）',
        !!detail.querySelector('.delete-btn') && !summary.querySelector('.delete-btn'));
    t('  備註入口在 detail 裡',
        !!detail.querySelector('.history-note-preview') && !summary.querySelector('.history-note-preview'));

    t('預設是收合的', !item.classList.contains('expanded'), item.className);
}

/* ============================================================
   二、點一下展開，再點一下收合
   ============================================================ */
console.log('\n展開與收合');

{
    const w = boot();
    buildAndSave(w, 1200000, 100000, 12, 2026, 8, 5);
    w.eval('toggleHistoryPanel()');

    const item = items(w)[0];
    const summary = item.querySelector('.history-item-summary');

    summary.click();
    t('點 summary 會展開', item.classList.contains('expanded'), item.className);

    summary.click();
    t('再點一下會收合', !item.classList.contains('expanded'), item.className);

    // 點裡面的按鈕不可以順便展開／收合
    summary.click();
    t('前置：目前是展開的', item.classList.contains('expanded'));
    item.querySelector('.history-note-preview').click();
    t('點備註不會把卡片收起來', item.classList.contains('expanded'), item.className);

    // 備註編輯器開著會擋住後面的操作，關掉它
    const noteModal = w.document.querySelector('.note-editor-modal');
    if (noteModal) noteModal.remove();
}

{
    // 多筆各自獨立，不是手風琴 —— 展開一筆不會把另一筆關掉
    const w = boot();
    buildAndSave(w, 1200000, 100000, 12, 2026, 8, 5);
    w.eval('clearAllInputs()');
    const ok = w.document.getElementById('confirmModalOk');
    if (w.document.getElementById('confirmModalOverlay').style.display === 'flex') ok.click();
    buildAndSave(w, 600000, 50000, 6, 2026, 9, 10);

    w.eval('toggleHistoryPanel()');
    const list = items(w);
    t('有兩筆紀錄', list.length === 2, String(list.length));

    list[0].querySelector('.history-item-summary').click();
    list[1].querySelector('.history-item-summary').click();
    t('兩筆可以同時展開',
        list[0].classList.contains('expanded') && list[1].classList.contains('expanded'));
}

/* ============================================================
   三、展開狀態要跨重繪保留
   ============================================================ */
console.log('\n重繪後仍然保留展開狀態');

{
    const w = boot();
    buildAndSave(w, 1200000, 100000, 12, 2026, 8, 5);
    w.eval('toggleHistoryPanel()');

    const id = items(w)[0].dataset.historyId;
    items(w)[0].querySelector('.history-item-summary').click();
    t('前置：已展開', items(w)[0].classList.contains('expanded'));

    // 存備註會讓整個面板重畫
    w.eval(`saveCheckNote(${id}, '重繪測試')`);
    t('存完備註後仍然是展開的', items(w)[0].classList.contains('expanded'),
        items(w)[0].className);
    t('  備註也顯示在收合行上（不用展開就認得出這筆）',
        /重繪測試/.test(items(w)[0].querySelector('.history-item-summary').textContent),
        items(w)[0].querySelector('.history-item-summary').textContent.replace(/\s+/g, ' '));

    // 直接重畫一次也要保留
    w.eval('loadCheckHistory()');
    t('直接重畫後仍然是展開的', items(w)[0].classList.contains('expanded'));
}

{
    // 刪掉的紀錄要一併忘掉展開狀態，否則那個集合會無限長大
    const w = boot();
    buildAndSave(w, 1200000, 100000, 12, 2026, 8, 5);
    w.eval('toggleHistoryPanel()');
    const id = items(w)[0].dataset.historyId;
    items(w)[0].querySelector('.history-item-summary').click();

    w.eval(`deleteCheckHistoryItem(${id})`);
    w.document.getElementById('confirmModalOk').click();
    t('刪除後清單為空', items(w).length === 0);
    t('  展開狀態一併被忘掉',
        w.eval(`isHistoryExpanded(${JSON.stringify(id)})`) === false);
}

/* ============================================================
   四、樣式：收合的那一層真的會把細節藏起來
   ------------------------------------------------------------
   jsdom 不會套用外部樣式表，所以這裡直接讀 CSS 檔驗規則本身。
   少了這兩條，上面的結構測試會全綠但畫面完全沒有收合效果。
   ============================================================ */
console.log('\n樣式規則');

{
    const css = fs.readFileSync(path.join(R, 'css/history.css'), 'utf8');

    t('.history-item-detail 預設隱藏',
        /\.history-item-detail\s*\{[^}]*display:\s*none/.test(css));
    t('  展開時才顯示',
        /\.history-item\.expanded\s+\.history-item-detail\s*\{[^}]*display:\s*block/.test(css));
    t('summary 看得出可以點（cursor: pointer）',
        /\.history-item-summary\s*\{[^}]*cursor:\s*pointer/.test(css));
    t('有展開箭頭，而且展開時會轉向',
        /\.history-item-summary::after/.test(css) &&
        /\.history-item\.expanded\s+\.history-item-summary::after\s*\{[^}]*rotate/.test(css));

    // 這組樣式要在四頁共用的檔案裡，下一步推到其他三頁才不用再搬一次
    ['calculator', 'check', 'invoice', 'gas'].forEach(p => {
        const html = fs.readFileSync(path.join(R, 'pages', p + '.html'), 'utf8');
        t(`${p}.html 載入了 history.css`, html.includes('css/history.css'));
    });
}

/* ============================================================ */
console.log(`\n通過 ${pass}　失敗 ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
