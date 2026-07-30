/**
 * 存檔功能對齊測試 —— 步驟 4：三頁該有的都要有
 * ============================================================
 * 【這支測試存在的原因】
 *
 * 步驟 4 補的是「某一頁本來就少了、另外兩頁早就有」的東西：
 *
 *   發票頁   沒有備註、沒有看得見的套用入口、沒有自動暫存
 *   計算頁   沒有覆蓋／另存 —— 同一個案子調三次數字就變三筆歷史
 *
 * 這類功能一旦補上就會被當成理所當然，之後改版時很容易在重寫渲染
 * 或重整流程時整段消失，而且畫面看起來完全正常 —— 只是備註鈕不見了、
 * 或是又開始每存一次多一筆。這支測試就是釘住這些行為。
 *
 * 需要先安裝 jsdom：npm install jsdom
 * 執行：node tests/存檔功能對齊測試.js
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

/* ============================================================
   發票頁
   ============================================================ */
function bootInvoice() {
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
    ['js/common-history.js', 'js/common-keypad.js', 'js/common-modals.js',
     'js/taxid-lookup.js', 'js/common-datepicker.js']
        .forEach(f => w.eval(fs.readFileSync(path.join(R, f), 'utf8').replace(/^let /gm, 'var ')));

    const engine = fs.readFileSync(path.join(R, 'js/invoice-engine.js'), 'utf8')
        .replace(/^'use strict';$/m, '');
    w.eval(engine + '\n;window.__t = { state, calc, render, saveInvoiceDraft, restoreInvoiceDraft };');
    w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
    return w;
}

const invHistory = w => JSON.parse(w.localStorage.getItem('invNewHistory') || '[]');

function fillInvoice(w, title, price) {
    w.__t.state.title = title;
    w.__t.state.taxId = '12345678';
    w.__t.state.items = [{ name: '車輛租賃', qty: 1, price: price }];
    w.__t.state.lockTotal = null;
}

console.log('\n發票頁 —— 套用按鈕與備註');

{
    const w = bootInvoice();
    const d = w.document;

    fillInvoice(w, '大發運輸', 500000);
    d.getElementById('btnSaveRec').click();
    d.getElementById('btnHistory').click();

    const row = d.querySelector('#histBody .hrec');
    t('歷史清單渲染得出一列', !!row);

    t('每列有看得見的「套用」按鈕',
        !!row.querySelector('[data-apply]') &&
        row.querySelector('[data-apply]').textContent.trim() === '套用',
        row.textContent.replace(/\s+/g, ' '));

    t('刪除鈕是文字「刪除」，不再是小小的 ×',
        !!row.querySelector('[data-del]') &&
        row.querySelector('[data-del]').textContent.trim() === '刪除',
        (row.querySelector('[data-del]') || {}).textContent);

    t('每列有備註區', !!row.querySelector('[data-note]'));
    t('  沒有備註時顯示提示文字',
        /點擊添加備註/.test(row.querySelector('[data-note]').textContent));

    // 點備註不可以順便把這筆套用回表單
    fillInvoice(w, '另一家公司', 111);
    w.__t.render();
    row.querySelector('[data-note]').click();

    const ta = d.querySelector('.note-editor-modal textarea');
    t('點備註會開啟共用備註編輯器', !!ta);
    t('  點備註不會順便套用這筆（表單沒被蓋掉）',
        w.__t.state.title === '另一家公司', w.__t.state.title);

    // 存備註
    ta.value = '這張要開三聯式';
    const btns = [...d.querySelectorAll('.note-editor-modal button')];
    (btns.find(b => /儲存|確定/.test(b.textContent)) || btns[btns.length - 1]).click();

    const stored = JSON.parse(w.localStorage.getItem('invNewHistory'))[0];
    t('備註寫得進去', stored.note === '這張要開三聯式', JSON.stringify(stored.note));

    d.getElementById('btnHistory').click();
    t('  備註會顯示在清單上',
        /這張要開三聯式/.test(d.querySelector('#histBody .hrec').textContent));

    // 套用按鈕真的會把資料帶回來
    d.querySelector('#histBody [data-apply]').click();
    t('按「套用」會把該筆帶回表單', w.__t.state.title === '大發運輸', w.__t.state.title);
    t('  金額也帶回來了', w.__t.calc().total === 525000, String(w.__t.calc().total));
}

console.log('\n發票頁 —— 24 小時自動暫存');

{
    const w = bootInvoice();
    fillInvoice(w, '暫存測試公司', 300000);
    w.__t.render();

    const raw = w.localStorage.getItem('invoiceDraft');
    t('編輯過就會寫入暫存', !!raw, String(raw));

    const draft = JSON.parse(raw || '{}');
    t('  暫存含抬頭', draft.title === '暫存測試公司', draft.title);
    t('  暫存含統編', draft.taxId === '12345678', draft.taxId);
    t('  暫存含品項', draft.items && draft.items[0].price === 300000, JSON.stringify(draft.items));
    t('  暫存有時間戳（判斷 24 小時效期用）', !!draft.savedAt, String(draft.savedAt));

    // 重開頁面應該還原
    const w2 = bootInvoice();
    w2.localStorage.setItem('invoiceDraft', raw);
    t('重開頁面會還原暫存', w2.__t.restoreInvoiceDraft() === true);
    t('  抬頭還原', w2.__t.state.title === '暫存測試公司', w2.__t.state.title);
    t('  金額還原', w2.__t.calc().total === 315000, String(w2.__t.calc().total));

    // 超過 24 小時就不還原
    const old = JSON.parse(raw);
    old.savedAt = new Date(Date.now() - 25 * 3600000).toISOString();
    const w3 = bootInvoice();
    w3.localStorage.setItem('invoiceDraft', JSON.stringify(old));
    t('超過 24 小時的暫存不會還原', w3.__t.restoreInvoiceDraft() === false);
    t('  而且會被清掉', w3.localStorage.getItem('invoiceDraft') === null);
}

/* ============================================================
   計算頁 —— 覆蓋／另存
   ============================================================ */
function bootCalc() {
    const html = fs.readFileSync(path.join(R, 'pages/calculator.html'), 'utf8');
    const dom = new JSDOM(html, {
        url: 'https://ryanlin02.github.io/my-website/pages/calculator.html',
        runScripts: 'outside-only',
        pretendToBeVisual: true
    });
    const w = dom.window;
    w.eval('window.setInterval=function(){return 0;};window.setTimeout=function(){return 0;};');
    w.eval('window.scrollTo=function(){};');
    w.navigator.vibrate = () => true;

    const scripts = [...html.matchAll(/<script src="\.\.\/js\/([^"]+)"/g)]
        .map(m => m[1]).filter(f => f !== 'frame-guard.js');
    for (const f of scripts) {
        w.eval(fs.readFileSync(path.join(R, 'js', f), 'utf8').replace(/^let /gm, 'var '));
    }
    w.eval('initCommonModals()');
    return w;
}

/* 透過共用鍵盤送出，走的是使用者真實的輸入路徑 */
const setField = (w, field, v) =>
    w.eval(`currentInputField=${JSON.stringify(field)};calculatorValue=${JSON.stringify(String(v))};submitCalculatorValue();`);

const loanList = w => JSON.parse(w.localStorage.getItem('loanHistory') || '[]');

console.log('\n計算頁 —— 覆蓋或另存');

{
    const w = bootCalc();
    const d = w.document;

    setField(w, 'period', 36);
    setField(w, 'rate', 8.5);
    setField(w, 'principal', 1000000);

    w.eval('saveLoanData()');
    t('全新試算直接存檔，不會問', d.getElementById('choiceModalOverlay') === null);
    t('  歷史有 1 筆', loanList(w).length === 1, String(loanList(w).length));

    t('存檔後「已修改」提示不顯示',
        d.getElementById('unsaved-hint').style.display === 'none',
        d.getElementById('unsaved-hint').style.display);

    // 改期數 → 應該出現「已修改，尚未儲存」
    setField(w, 'period', 48);
    t('改內容後出現「已修改，尚未儲存」提示',
        d.getElementById('unsaved-hint').style.display === 'block',
        d.getElementById('unsaved-hint').style.display);

    w.eval('saveLoanData()');
    const overlay = d.getElementById('choiceModalOverlay');
    t('再次存檔會跳出覆蓋／另存的選擇', overlay !== null);
    if (overlay) {
        const labels = [...overlay.querySelectorAll('[data-index]')].map(b => b.textContent.trim());
        t('  兩個選項，覆蓋在前',
            labels[0] === '覆蓋原紀錄' && labels[1] === '另存為新紀錄', labels.join('|'));
        t('  說明含原本的 36 期', overlay.textContent.includes('36 期'), overlay.textContent);
        t('  說明含現在的 48 期', overlay.textContent.includes('48 期'));

        overlay.querySelector('[data-index="0"]').click();     // 覆蓋
    }

    t('選覆蓋 → 仍然只有 1 筆', loanList(w).length === 1, String(loanList(w).length));
    t('  內容已更新為 48 期', loanList(w)[0].data.period === '48', loanList(w)[0].data.period);
    t('  提示消失', d.getElementById('unsaved-hint').style.display === 'none');

    // 再改一次，這次選另存
    setField(w, 'period', 60);
    w.eval('saveLoanData()');
    const o2 = d.getElementById('choiceModalOverlay');
    t('再次跳出選擇', o2 !== null);
    if (o2) o2.querySelector('[data-index="1"]').click();       // 另存

    t('選另存 → 變成 2 筆', loanList(w).length === 2, String(loanList(w).length));
    const periods = loanList(w).map(r => r.data.period).sort();
    t('  一筆 48 一筆 60', periods.join(',') === '48,60', periods.join(','));
}

{
    // 清空全部欄位 = 重新開始，不該再問覆蓋
    const w = bootCalc();
    setField(w, 'period', 36);
    setField(w, 'rate', 8.5);
    setField(w, 'principal', 1000000);
    w.eval('saveLoanData()');

    w.eval('clearAllFieldsExceptMonthlyCost()');
    setField(w, 'period', 24);
    setField(w, 'rate', 7);
    setField(w, 'principal', 800000);
    w.eval('saveLoanData()');

    t('清空後重算再存檔，不會問覆蓋',
        w.document.getElementById('choiceModalOverlay') === null);
    t('  直接新增為第 2 筆', loanList(w).length === 2, String(loanList(w).length));
}

{
    // 從歷史套用回來的那筆，改了之後也要問
    const w = bootCalc();
    setField(w, 'period', 36);
    setField(w, 'rate', 8.5);
    setField(w, 'principal', 1000000);
    w.eval('saveLoanData()');
    const id = loanList(w)[0].id;

    w.eval('clearAllFieldsExceptMonthlyCost()');
    w.eval(`loadLoanToForm(${id})`);
    t('套用歷史後不算「已修改」',
        w.document.getElementById('unsaved-hint').style.display === 'none',
        w.document.getElementById('unsaved-hint').style.display);

    setField(w, 'period', 48);
    w.eval('saveLoanData()');
    t('套用後改內容再存檔，會問覆蓋或另存',
        w.document.getElementById('choiceModalOverlay') !== null);

    const o = w.document.getElementById('choiceModalOverlay');
    if (o) o.querySelector('[data-index="0"]').click();
    t('  覆蓋回原本那一筆（id 不變）',
        loanList(w).length === 1 && loanList(w)[0].id === id,
        `${loanList(w).length} 筆`);
}

/* ============================================================
   發票頁 —— 覆蓋或另存（2026/07 第一批補上）
   ------------------------------------------------------------
   本頁的判定是「改任何一項都算」：發票沒有「一次試算」這種明確的
   完成點，也沒有哪一項比較不重要 —— 改品名、改數量、改日期都會讓
   這張發票變成不同的一張。
   ============================================================ */
console.log('\n發票頁 —— 覆蓋或另存');

{
    const w = bootInvoice();
    const d = w.document;

    fillInvoice(w, '大發運輸', 500000);
    d.getElementById('btnSaveRec').click();
    t('全新的一張直接存檔，不會問', d.getElementById('choiceModalOverlay') === null);
    t('  歷史有 1 筆', invHistory(w).length === 1, String(invHistory(w).length));
    t('  存檔後「已修改」提示不顯示',
        d.getElementById('unsaved-hint').style.display === 'none',
        d.getElementById('unsaved-hint').style.display);

    // 改金額（走 touch()）
    w.__t.state.items = [{ name: '車輛租賃', qty: 1, price: 600000 }];
    w.eval('touch()');
    t('改金額後出現「已修改，尚未儲存」',
        d.getElementById('unsaved-hint').style.display === 'block',
        d.getElementById('unsaved-hint').style.display);

    d.getElementById('btnSaveRec').click();
    const o = d.getElementById('choiceModalOverlay');
    t('再次存檔會問覆蓋或另存', o !== null);
    if (o) {
        const labels = [...o.querySelectorAll('[data-index]')].map(b => b.textContent.trim());
        t('  兩個選項，覆蓋在前（本頁最常見的是改同一張）',
            labels[0] === '覆蓋原紀錄' && labels[1] === '另存為新紀錄', labels.join('|'));
        t('  說明含抬頭', o.textContent.includes('大發運輸'), o.textContent);
        o.querySelector('[data-index="0"]').click();
    }

    t('選覆蓋 → 仍然只有 1 筆', invHistory(w).length === 1, String(invHistory(w).length));
    t('  金額已更新', invHistory(w)[0].data.total === 630000,
        String(invHistory(w)[0].data.total));
    t('  提示消失', d.getElementById('unsaved-hint').style.display === 'none');

    w.__t.state.items = [{ name: '車輛租賃', qty: 1, price: 700000 }];
    w.eval('touch()');
    d.getElementById('btnSaveRec').click();
    const o2 = d.getElementById('choiceModalOverlay');
    if (o2) o2.querySelector('[data-index="1"]').click();
    t('選另存 → 變成 2 筆', invHistory(w).length === 2, String(invHistory(w).length));
}

{
    // 清除 = 重新開始，不該再問覆蓋
    const w = bootInvoice();
    fillInvoice(w, '甲公司', 100000);
    w.document.getElementById('btnSaveRec').click();

    w.document.getElementById('btnReset').click();
    fillInvoice(w, '乙公司', 200000);
    w.eval('touch()');
    w.document.getElementById('btnSaveRec').click();

    t('清除後重建再存檔，不會問覆蓋',
        w.document.getElementById('choiceModalOverlay') === null);
    t('  直接新增為第 2 筆', invHistory(w).length === 2, String(invHistory(w).length));
}

{
    // 統編自動帶出抬頭是程式改的，不能算「已修改」
    const w = bootInvoice();
    fillInvoice(w, '大發運輸', 500000);
    w.document.getElementById('btnSaveRec').click();
    w.document.getElementById('btnHistory').click();
    w.document.querySelector('#histBody [data-apply]').click();

    t('套用歷史後不算「已修改」',
        w.document.getElementById('unsaved-hint').style.display === 'none',
        w.document.getElementById('unsaved-hint').style.display);

    // 模擬非同步查詢回填抬頭（走 render()，不走 touch()）
    w.__t.state.title = '自動帶出來的公司';
    w.__t.render();
    t('  自動帶出抬頭不會被誤判為使用者修改',
        w.document.getElementById('unsaved-hint').style.display === 'none',
        w.document.getElementById('unsaved-hint').style.display);
}

{
    // 歷史卡片要看得到存檔時間
    const w = bootInvoice();
    fillInvoice(w, '大發運輸', 500000);
    w.document.getElementById('btnSaveRec').click();
    w.document.getElementById('btnHistory').click();

    const row = w.document.querySelector('#histBody .hrec');
    t('卡片顯示存檔時間', /今天\s+\d{2}:\d{2}/.test(row.textContent),
        row.textContent.replace(/\s+/g, ' ').slice(0, 100));
    t('  發票開立日期仍然看得到（兩者是不同的東西）',
        !!row.querySelector('.hy') && row.querySelector('.hy').textContent.trim().length > 0,
        (row.querySelector('.hy') || {}).textContent);
}

/* ============================================================
   共用元件的樣式要在四頁都拿得到
   ============================================================ */
console.log('\n共用元件樣式的歸屬');

{
    const keypad = fs.readFileSync(path.join(R, 'css/keypad.css'), 'utf8');
    const check = fs.readFileSync(path.join(R, 'css/check.css'), 'utf8');

    t('「已修改，尚未儲存」的樣式在四頁共用的 keypad.css',
        /\.unsaved-hint\s*\{/.test(keypad));
    t('  沒有留在只有支票頁載入的 check.css', !/^\.unsaved-hint\s*\{/m.test(check));

    t('多選項對話框的窄螢幕樣式在 keypad.css',
        /\.choice-modal-footer\s*\{/.test(keypad));
    t('  沒有留在 check.css', !/^\.choice-modal-footer\s*\{/m.test(check));

    // 計算頁現在也用得到這兩者，它不載入 check.css
    const calcHtml = fs.readFileSync(path.join(R, 'pages/calculator.html'), 'utf8');
    t('計算頁有「已修改，尚未儲存」的容器', /id="unsaved-hint"/.test(calcHtml));
    t('  而計算頁確實沒有載入 check.css', !/css\/check\.css/.test(calcHtml));
}

/* ============================================================
   存檔／歷史按鈕列：不可以有第二條同分的規則
   ------------------------------------------------------------
   【這一段是踩過才加的】
   把 .function-buttons button 從 calculator.css 搬進 history.css 之後，
   計算頁的「清除全部輸入」與支票頁的「存檔／歷史」從橘框白字
   變成了灰框灰字 —— 而且沒有任何錯誤訊息。

   原因是 calculator.css 裡還留著一組 .bottom-buttons button，
   優先級與 .function-buttons button 完全相同（0,1,1）。
   同分時由後載入的勝出：搬家之前 .function-buttons button 寫在
   同一份檔案的更後面，所以一直是它贏，那組規則從來沒生效過；
   搬到 history.css（排在 calculator.css 之前）以後就反過來了。

   抽出共用樣式時，搬動的不只是規則本身，還有它在層疊順序裡的位置。
   這裡守的就是「別再出現第二條同分的規則」。
   ============================================================ */
console.log('\n按鈕列的層疊順序');

{
    const files = ['keypad.css', 'history.css', 'calculator.css', 'check.css', 'gas.css', 'invoice.css'];
    const owners = [];

    files.forEach(f => {
        const css = fs.readFileSync(path.join(R, 'css', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
        // 任何「單一 class + button」形式、會命中存檔／歷史那排按鈕的選擇器
        const re = /^\s*\.(function-buttons|top-buttons|bottom-buttons)\s+button\s*[,{]/gm;
        if (re.test(css)) owners.push(f);
    });

    t('只有 history.css 定義存檔／歷史按鈕的外觀',
        owners.length === 1 && owners[0] === 'history.css', owners.join('、'));

    const historyCss = fs.readFileSync(path.join(R, 'css/history.css'), 'utf8');
    t('  而且它確實是橘框（與加油頁一致）',
        /\.function-buttons button\s*\{[^}]*border:\s*1px solid var\(--button-orange\)/.test(historyCss));

    // 四頁的存檔／歷史按鈕都必須包在 .function-buttons 裡，才吃得到那條規則
    ['calculator', 'check', 'gas'].forEach(p => {
        const html = fs.readFileSync(path.join(R, 'pages', p + '.html'), 'utf8');
        t(`${p}.html 的按鈕列用 .function-buttons`, /class="function-buttons/.test(html));
    });
}

/* ============================================================ */
console.log(`\n通過 ${pass}　失敗 ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
