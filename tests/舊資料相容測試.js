/**
 * 舊資料相容測試 —— 既有使用者的歷史紀錄在真實頁面上還看得到嗎
 * ============================================================
 * 【這支測試存在的原因】
 *
 * tests/歷史紀錄遷移測試.js 驗的是 Store 這一層：舊格式包進信封之後
 * 欄位有沒有掉。但那是純函式測試，它證明不了「業務打開 App 之後
 * 真的看得到自己上週存的那筆」——
 *
 *   Store 讀回來了，但頁面拿錯路徑（rec.xxx 而不是 rec.data.xxx），
 *   畫面就是一排空白或 undefined。不會拋錯、不會有紅字，
 *   而且新存的資料完全正常，只有舊資料壞掉 —— 開發時很難發現，
 *   因為開發時的資料都是新存的。
 *
 * 所以這支從「使用者的手機裡本來就有舊資料」出發：
 * 把改版前的真實格式塞進 localStorage，把頁面整個跑起來，
 * 然後檢查畫面上的數字對不對、套用回表單對不對。
 *
 * 需要先安裝 jsdom：npm install jsdom
 * 執行：node tests/舊資料相容測試.js
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

/* 改版前各頁真實寫進 localStorage 的形狀（照抄自改版前的程式碼） */
const LEGACY_CALC = {
    id: 1785300000000,
    date: '2026-07-28 14:30',
    period: '36', rate: '8.5',
    principal: '1000000', payment: '31000',
    afterTaxRate: '8.1234', commission: '20000',
    afterCommissionRate: '9.5678', totalInterest: '116000',
    timestamp: '2026-07-28T06:30:00.000Z',
    note: '客戶要求月底前回覆'
};

const LEGACY_CHECK = {
    id: 1785300001000,
    date: '2026-07-28',
    totalAmount: 1200000, paymentAmount: 100000,
    checkCount: 12, depositAmount: 100000,
    startDate: new Date(2026, 7, 5).toISOString(),
    timestamp: '2026-07-28T07:00:00.000Z',
    note: '第一批',
    written: [true, true, false, false, false, false, false, false, false, false, false, false]
};

const LEGACY_INVOICE = {
    id: 1785300002000,
    type: '3', taxId: '12345678', title: '大發運輸有限公司',
    date: { y: 115, m: 7, d: 28 },
    items: [{ name: '車輛租賃', qty: 1, price: 500000 }],
    lockTotal: null, total: 525000
};

/* ------------------------------------------------------------
   計算頁與支票頁共用的啟動方式
   ------------------------------------------------------------ */
function bootPage(pageFile, seedKey, seedValue) {
    const html = fs.readFileSync(path.join(R, 'pages', pageFile), 'utf8');
    const dom = new JSDOM(html, {
        url: 'https://ryanlin02.github.io/my-website/pages/' + pageFile,
        runScripts: 'outside-only',
        pretendToBeVisual: true
    });
    const w = dom.window;
    w.eval('window.setInterval=function(){return 0;};window.setTimeout=function(){return 0;};');
    w.eval('window.scrollTo=function(){};');
    w.navigator.vibrate = () => true;

    // 先把舊資料放進去，再讓頁面跑起來 —— 模擬「業務手機裡本來就有」
    w.localStorage.setItem(seedKey, JSON.stringify(seedValue));

    const cfg = html.match(/window\.KEYPAD_OPTIONS\s*=\s*\{[^}]*\}/);
    if (cfg) w.eval(cfg[0]);
    const panel = w.document.getElementById('historyPanel');
    if (panel) panel.style.display = 'none';

    const scripts = [...html.matchAll(/<script src="\.\.\/js\/([^"]+)"/g)]
        .map(m => m[1]).filter(f => f !== 'frame-guard.js');
    for (const f of scripts) {
        w.eval(fs.readFileSync(path.join(R, 'js', f), 'utf8').replace(/^let /gm, 'var '));
    }
    w.eval('initCommonModals()');
    return w;
}

/* ============================================================
   計算頁
   ============================================================ */
console.log('\n計算頁 —— 舊資料');

{
    const w = bootPage('calculator.html', 'loanHistory', [LEGACY_CALC]);
    const d = w.document;

    w.eval('loadHistoryData()');
    const panel = d.getElementById('historyContent').textContent;

    t('舊紀錄有渲染出來（不是「尚無記錄」）',
        !panel.includes('尚無貸款計算記錄'), panel.slice(0, 60));
    t('  沒有出現 undefined', !panel.includes('undefined'), panel.replace(/\s+/g, ' ').slice(0, 160));
    t('  期數顯示 36', /36/.test(panel));
    t('  本金顯示 1,000,000', panel.includes('1,000,000'), panel.replace(/\s+/g, ' ').slice(0, 160));
    t('  期繳顯示 31,000', panel.includes('31,000'));
    t('  推廣顯示 20,000', panel.includes('20,000'));
    t('  稅佣後利率顯示 9.5678', panel.includes('9.5678'), panel.replace(/\s+/g, ' ').slice(0, 160));
    t('  備註內容顯示出來', panel.includes('客戶要求月底前回覆'));

    // 套用回表單：這是業務真正要做的事
    w.eval(`loadLoanToForm(${LEGACY_CALC.id})`);
    t('套用舊紀錄 → 期數回到欄位', d.getElementById('period').value === '36',
        d.getElementById('period').value);
    t('  本金回到欄位', d.getElementById('principal').value === '1,000,000',
        d.getElementById('principal').value);
    t('  推廣回到欄位', d.getElementById('commission').value === '20,000',
        d.getElementById('commission').value);

    /* 期繳刻意不比對存檔時的值。
     * loadLoanToForm() 還原期數／利率／本金之後會呼叫 calculatePayment()
     * 重算期繳 —— 期繳是推導出來的欄位，不是獨立資料。
     * 所以這裡只確認它算得出一個合法數字，沒有變成空白或 NaN。 */
    const pay = d.getElementById('payment').value;
    t('  期繳依還原後的條件重新算出（不是沿用存檔值）',
        /^[\d,]+$/.test(pay) && pay !== '0', pay);

    // 舊紀錄的備註要能繼續編輯
    w.eval(`openNoteEditor(${LEGACY_CALC.id})`);
    const ta = d.querySelector('.note-editor-modal textarea');
    t('  舊紀錄的備註可以繼續編輯', ta && ta.value === '客戶要求月底前回覆',
        ta ? ta.value : '<找不到備註編輯器>');
}

/* ============================================================
   支票頁
   ============================================================ */
console.log('\n支票頁 —— 舊資料');

{
    const w = bootPage('check.html', 'checkHistory', [LEGACY_CHECK]);
    const d = w.document;

    w.eval('loadCheckHistory()');
    const panel = d.getElementById('historyContent').textContent;

    t('舊紀錄有渲染出來', !panel.includes('尚無支票計算記錄'), panel.slice(0, 60));
    t('  沒有出現 undefined', !panel.includes('undefined'), panel.replace(/\s+/g, ' ').slice(0, 200));
    t('  沒有出現 NaN（日期換算失敗會長這樣）',
        !panel.includes('NaN'), panel.replace(/\s+/g, ' ').slice(0, 200));
    t('  總金額顯示 1,200,000', panel.includes('1,200,000'));
    t('  每期繳款顯示 100,000', panel.includes('100,000'));
    t('  開立進度徽章正確（開立中 2 / 12 張）',
        panel.includes('開立中 2 / 12 張'),
        (d.querySelector('.history-header-rate') || {}).textContent);
    t('  備註內容顯示出來', panel.includes('第一批'));

    // 套用回表單 —— 連打勾進度一起還原，這是這一頁最重要的資料
    w.eval(`loadCheckToForm(${LEGACY_CHECK.id})`);
    if (d.getElementById('confirmModalOverlay').style.display === 'flex') {
        d.getElementById('confirmModalOk').click();
    }
    t('套用舊紀錄 → 總金額回到欄位',
        d.getElementById('total-amount').value === '1,200,000',
        d.getElementById('total-amount').value);
    t('  張數回到欄位', d.getElementById('check-count').value === '12',
        d.getElementById('check-count').value);
    t('  票面清單重建 12 列', d.querySelectorAll('.check-row').length === 12,
        String(d.querySelectorAll('.check-row').length));
    t('  打勾進度還原為 2 張', w.eval('writtenChecks.filter(Boolean).length') === 2,
        String(w.eval('writtenChecks.filter(Boolean).length')));
    t('  重新連結到那筆舊紀錄（之後打勾會寫回去）',
        w.eval('linkedHistoryId') === LEGACY_CHECK.id, String(w.eval('linkedHistoryId')));

    // 打勾寫回舊紀錄：確認寫回去之後其他欄位沒有被弄丟
    w.eval('toggleCheckWritten(2)');
    const stored = JSON.parse(w.localStorage.getItem('checkHistory'))[0];
    const back = stored.data || stored;
    t('  打勾寫回後，總金額欄位仍在', back.totalAmount === 1200000, JSON.stringify(back).slice(0, 120));
    t('  打勾寫回後，備註仍在', (stored.note || back.note) === '第一批', JSON.stringify(stored).slice(0, 120));
    t('  打勾寫回後，進度變成 3 張',
        back.written.filter(Boolean).length === 3, String(back.written.filter(Boolean).length));
}

/* ============================================================
   發票頁
   ============================================================ */
console.log('\n發票頁 —— 舊資料');

{
    const html = fs.readFileSync(path.join(R, 'pages/invoice.html'), 'utf8')
        .replace(/<script src="\.\.\/js\/frame-guard\.js"><\/script>/, '')
        .replace(/<script async src="https:\/\/www\.googletagmanager[^<]*<\/script>/, '');

    const dom = new JSDOM(html, {
        runScripts: 'dangerously',
        url: 'https://ryanlin02.github.io/my-website/pages/invoice.html',
        resources: { fetch(url) { return url.protocol === 'file:' ? undefined : null; } },
        beforeParse(window) {
            window.fetch = () => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) });
            window.navigator.vibrate = () => true;
            window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {} }));
        }
    });

    const w = dom.window;
    w.localStorage.setItem('invNewHistory', JSON.stringify([LEGACY_INVOICE]));

    ['js/common-history.js', 'js/common-keypad.js', 'js/common-modals.js',
     'js/taxid-lookup.js', 'js/common-datepicker.js']
        .forEach(f => w.eval(fs.readFileSync(path.join(R, f), 'utf8').replace(/^let /gm, 'var ')));

    const engine = fs.readFileSync(path.join(R, 'js/invoice-engine.js'), 'utf8')
        .replace(/^'use strict';$/m, '');
    w.eval(engine + '\n;window.__test = { state, calc };');
    w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));

    const d = w.document;
    d.getElementById('btnHistory').click();
    const body = d.getElementById('histBody');
    const text = body.textContent;

    t('舊紀錄有渲染出來', !text.includes('還沒有存過任何發票'), text.slice(0, 60));
    t('  沒有出現 undefined', !text.includes('undefined'), text.replace(/\s+/g, ' ').slice(0, 160));
    t('  抬頭顯示出來', text.includes('大發運輸有限公司'), text.replace(/\s+/g, ' ').slice(0, 160));
    t('  總計顯示 525,000', text.includes('525,000'), text.replace(/\s+/g, ' ').slice(0, 160));
    t('  日期顯示 115/7/28', text.includes('115/7/28'), text.replace(/\s+/g, ' ').slice(0, 160));
    t('  三聯式標記正確', text.includes('三聯式'));

    // 點整列載回來繼續編輯
    // 卡片改用共用結構後，套用要按明確的「套用」按鈕（整列點擊是展開）
    body.querySelector('[data-apply]').click();
    t('點一列 → 抬頭載回 state', w.__test.state.title === '大發運輸有限公司', w.__test.state.title);
    t('  統編載回 state', w.__test.state.taxId === '12345678', w.__test.state.taxId);
    t('  品項載回 state', w.__test.state.items[0].name === '車輛租賃',
        JSON.stringify(w.__test.state.items));
    t('  金額算得回 525,000', w.__test.calc().total === 525000, String(w.__test.calc().total));
}

/* ============================================================ */
console.log(`\n通過 ${pass}　失敗 ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
