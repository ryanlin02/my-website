/**
 * 加油頁存檔與歷史測試 —— 步驟 4-2
 * ============================================================
 * 【這支測試存在的原因】
 *
 * 加油頁原本完全沒有存檔功能，這一步等於在一個成熟的頁面上新增一整套
 * 東西，而不是把既有的東西對齊。風險有兩個方向：
 *
 *   一是新功能自己壞掉（存了讀不回來、套用之後數字沒重算）；
 *   二是把原本好好的計算流程弄壞 —— 這頁的雙向換算（油錢↔油量）
 *     靠 lastModifiedField 決定推算方向，套用歷史時如果沒設對，
 *     會往錯的方向算並蓋掉剛還原的值。
 *
 * 另外這頁的歷史面板樣式來自新抽出的 css/history.css，
 * 這裡也一併確認四頁真的都載得到。
 *
 * 卡片上顯示的是「每月油錢」與「折扣金額」—— 那是業務自己在意的數值；
 * 每月／每年節省是講給客戶聽的，套用回表單時會即時重算。
 *
 * 需要先安裝 jsdom：npm install jsdom
 * 執行：node tests/加油頁存檔測試.js
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
    const html = fs.readFileSync(path.join(R, 'pages/gas.html'), 'utf8');
    const dom = new JSDOM(html, {
        url: 'https://ryanlin02.github.io/my-website/pages/gas.html',
        runScripts: 'outside-only',
        pretendToBeVisual: true
    });
    const w = dom.window;
    w.eval('window.setInterval=function(){return 0;};window.setTimeout=function(){return 0;};');
    w.eval('window.scrollTo=function(){};');
    w.navigator.vibrate = () => true;
    w.fetch = () => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) });

    const cfg = html.match(/window\.KEYPAD_OPTIONS\s*=\s*\{[^}]*\}/);
    if (cfg) w.eval(cfg[0]);

    const scripts = [...html.matchAll(/<script src="\.\.\/js\/([^"]+)"/g)]
        .map(m => m[1]).filter(f => f !== 'frame-guard.js');
    for (const f of scripts) {
        w.eval(fs.readFileSync(path.join(R, 'js', f), 'utf8').replace(/^let /gm, 'var '));
    }
    w.eval('initCommonModals()');
    w.document.getElementById('historyPanel').style.display = 'none';
    return w;
}

const $ = (w, id) => w.document.getElementById(id);
const val = (w, id) => { const e = $(w, id); return e ? e.value : '<缺元素>'; };
const hist = w => JSON.parse(w.localStorage.getItem('gasHistory') || '[]');

/** 走使用者真實的輸入路徑：共用鍵盤送出 */
function setField(w, field, v) {
    w.eval(`currentInputField=${JSON.stringify(field)};calculatorValue=${JSON.stringify(String(v))};submitCalculatorValue();`);
}

function buildCase(w, price, expense, discount) {
    w.eval(`setDieselPrice(${price})`);
    setField(w, 'monthlyExpense', expense);
    setField(w, 'discountAmount', discount);
}

/* ============================================================
   存檔
   ============================================================ */
console.log('\n存檔');

{
    const w = boot();

    w.eval('saveGasData()');
    t('欄位不齊時拒絕存檔', hist(w).length === 0, `${hist(w).length} 筆`);

    buildCase(w, 28.8, 288000, 0.6);
    t('前置：每月油量算得出來', val(w, 'monthlyVolume') === '10,000', val(w, 'monthlyVolume'));
    t('前置：每月節省算得出來', val(w, 'monthlySaving') === '6,000', val(w, 'monthlySaving'));

    w.eval('saveGasData()');
    t('欄位齊全就存得進去', hist(w).length === 1, `${hist(w).length} 筆`);

    const d = hist(w)[0].data;
    t('  存了每月油錢', d.monthlyExpense === 288000, String(d.monthlyExpense));
    t('  存了折扣金額', d.discountAmount === 0.6, String(d.discountAmount));
    t('  存了油品單價', d.dieselPrice === 28.8, String(d.dieselPrice));
    t('  存了每月油量', d.monthlyVolume === 10000, String(d.monthlyVolume));
    t('  資料包在共用信封裡（tool 標記為 gas）',
        hist(w)[0].tool === 'gas' && hist(w)[0].v === 1, JSON.stringify(hist(w)[0]).slice(0, 80));
}

/* ============================================================
   歷史面板
   ============================================================ */
console.log('\n歷史面板');

{
    const w = boot();
    buildCase(w, 28.8, 288000, 0.6);
    w.eval('saveGasData()');
    w.eval('toggleHistoryPanel()');

    const panel = $(w, 'historyPanel');
    t('面板打得開', panel.style.display === 'block', panel.style.display);

    const text = $(w, 'historyContent').textContent;
    t('  用的是共用的清單結構 (.history-list)',
        w.document.querySelector('.history-list') !== null);
    t('  卡片有四個欄位', w.document.querySelectorAll('.history-detail-item').length === 4,
        String(w.document.querySelectorAll('.history-detail-item').length));
    t('  沒有出現 undefined', !text.includes('undefined'), text.replace(/\s+/g, ' ').slice(0, 150));

    t('  顯示每月油錢 288,000', text.includes('288,000'));
    t('  顯示折扣金額 0.6 元', /0\.6\s*元/.test(text), text.replace(/\s+/g, ' ').slice(0, 150));
    t('  徽章顯示單價', /單價\s*28\.8\s*元/.test(text),
        (w.document.querySelector('.history-header-rate') || {}).textContent);

    t('  有套用按鈕',
        [...w.document.querySelectorAll('.detail-btn')].some(b => b.textContent.trim() === '套用'));
    t('  有刪除按鈕',
        [...w.document.querySelectorAll('.delete-btn')].some(b => b.textContent.trim() === '刪除'));
    t('  有備註入口', w.document.querySelector('.history-note-preview') !== null);

    w.eval('toggleHistoryPanel()');
    t('再按一次會關閉', panel.style.display === 'none');
}

/* ============================================================
   套用回表單
   ============================================================ */
console.log('\n套用');

{
    const w = boot();
    buildCase(w, 28.8, 288000, 0.6);
    w.eval('saveGasData()');
    const id = hist(w)[0].id;

    w.eval('clearCalculation()');
    t('清除後每月油錢為空', val(w, 'monthlyExpense') === '', val(w, 'monthlyExpense'));

    w.eval(`loadGasToForm(${id})`);
    t('套用後每月油錢還原', val(w, 'monthlyExpense') === '288,000', val(w, 'monthlyExpense'));
    t('  折扣金額還原', val(w, 'discountAmount') === '0.6', val(w, 'discountAmount'));
    t('  油品單價還原', val(w, 'dieselPrice') === '28.8', val(w, 'dieselPrice'));

    t('  每月油量重新算對', val(w, 'monthlyVolume') === '10,000', val(w, 'monthlyVolume'));
    t('  折後油錢重算出來', val(w, 'discountedExpense') === '282,000', val(w, 'discountedExpense'));
    t('  每月節省重算出來', val(w, 'monthlySaving') === '6,000', val(w, 'monthlySaving'));
    t('  每年節省重算出來', val(w, 'yearlySaving') === '72,000', val(w, 'yearlySaving'));

    t('  面板自動關閉', $(w, 'historyPanel').style.display === 'none');
}

{
    /* 【換算方向】這是本頁最容易出事的一項。
     *
     * 油錢與油量是雙向換算的，方向由 lastModifiedField 決定。
     * 套用歷史時如果沒指定成「油錢」，引擎會拿油量去反算油錢，
     * 把剛還原的油錢蓋掉。
     *
     * 上面那組數字（28.8 × 10,000 = 288,000）剛好整除，
     * 兩個方向算出來一樣，測不出差別 —— 所以這裡刻意用除不盡的金額：
     *   290,000 ÷ 28.8 = 10,069.44 → 油量 10,069
     *   反向算回去 28.8 × 10,069 = 289,987 ≠ 290,000
     * 方向錯了，油錢就會從 290,000 變成 289,987。
     * 實務上業務打的油錢本來就很少剛好是單價的整數倍。 */
    const w = boot();
    buildCase(w, 28.8, 290000, 0.6);
    t('除不盡時油量取整為 10,069', val(w, 'monthlyVolume') === '10,069', val(w, 'monthlyVolume'));

    w.eval('saveGasData()');
    const id = hist(w)[0].id;
    w.eval('clearCalculation()');
    w.eval(`loadGasToForm(${id})`);

    t('套用後每月油錢維持存檔時的 290,000（沒有被反向換算蓋掉）',
        val(w, 'monthlyExpense') === '290,000', val(w, 'monthlyExpense'));
    t('  油量仍為 10,069', val(w, 'monthlyVolume') === '10,069', val(w, 'monthlyVolume'));
}

/* ============================================================
   覆蓋或另存
   ============================================================ */
console.log('\n覆蓋或另存');

{
    const w = boot();
    buildCase(w, 28.8, 288000, 0.6);
    w.eval('saveGasData()');

    t('全新試算直接存檔，不會問', $(w, 'choiceModalOverlay') === null);
    t('  存檔後「已修改」提示不顯示', $(w, 'unsaved-hint').style.display === 'none');

    setField(w, 'discountAmount', 0.9);
    t('改折扣後出現「已修改，尚未儲存」',
        $(w, 'unsaved-hint').style.display === 'block', $(w, 'unsaved-hint').style.display);

    w.eval('saveGasData()');
    const o = $(w, 'choiceModalOverlay');
    t('再次存檔會問覆蓋或另存', o !== null);
    if (o) {
        const labels = [...o.querySelectorAll('[data-index]')].map(b => b.textContent.trim());
        t('  兩個選項，覆蓋在前',
            labels[0] === '覆蓋原紀錄' && labels[1] === '另存為新紀錄', labels.join('|'));
        t('  說明含原本的折扣 0.6', o.textContent.includes('0.6'), o.textContent);
        o.querySelector('[data-index="0"]').click();
    }

    t('選覆蓋 → 仍然只有 1 筆', hist(w).length === 1, String(hist(w).length));
    t('  折扣已更新為 0.9', hist(w)[0].data.discountAmount === 0.9, String(hist(w)[0].data.discountAmount));
    t('  提示消失', $(w, 'unsaved-hint').style.display === 'none');

    setField(w, 'discountAmount', 0.5);
    w.eval('saveGasData()');
    const o2 = $(w, 'choiceModalOverlay');
    if (o2) o2.querySelector('[data-index="1"]').click();
    t('選另存 → 變成 2 筆', hist(w).length === 2, String(hist(w).length));
}

{
    const w = boot();
    buildCase(w, 28.8, 288000, 0.6);
    w.eval('saveGasData()');
    w.eval('clearCalculation()');
    buildCase(w, 28.6, 100000, 0.5);
    w.eval('saveGasData()');

    t('清除後重算再存檔，不會問覆蓋', $(w, 'choiceModalOverlay') === null);
    t('  直接新增為第 2 筆', hist(w).length === 2, String(hist(w).length));
}

/* ============================================================
   刪除與備註
   ============================================================ */
console.log('\n刪除與備註');

{
    const w = boot();
    buildCase(w, 28.8, 288000, 0.6);
    w.eval('saveGasData()');
    const id = hist(w)[0].id;

    w.eval('toggleHistoryPanel()');
    w.eval(`deleteGasHistoryItem(${id})`);
    t('刪除會先跳確認彈窗', $(w, 'confirmModalOverlay').style.display === 'flex');
    t('  確認訊息帶出摘要',
        $(w, 'confirmModalContent').textContent.includes('288,000'),
        $(w, 'confirmModalContent').textContent);
    t('  確認之前資料還在', hist(w).length === 1);
    $(w, 'confirmModalOk').click();
    t('  按下確定才真的刪掉', hist(w).length === 0, String(hist(w).length));
}

{
    const w = boot();
    buildCase(w, 28.8, 288000, 0.6);
    w.eval('saveGasData()');
    const id = hist(w)[0].id;

    w.eval(`openNoteEditor(${id})`);
    const ta = w.document.querySelector('.note-editor-modal textarea');
    t('備註編輯器打得開', !!ta);
    if (ta) {
        ta.value = '這家車隊八台曳引車';
        const btns = [...w.document.querySelectorAll('.note-editor-modal button')];
        (btns.find(b => /儲存|確定/.test(b.textContent)) || btns[btns.length - 1]).click();
        t('  備註寫得進去', hist(w)[0].note === '這家車隊八台曳引車', String(hist(w)[0].note));
    }

    w.eval('toggleHistoryPanel()');
    t('  備註顯示在卡片上',
        $(w, 'historyContent').textContent.includes('這家車隊八台曳引車'));
}

{
    const w = boot();
    buildCase(w, 28.8, 288000, 0.6);
    w.eval('saveGasData()');
    w.eval('clearCalculation()');
    buildCase(w, 28.6, 100000, 0.5);
    w.eval('saveGasData()');

    w.eval('toggleHistoryPanel()');
    w.eval('confirmDeleteAll()');
    t('清空會先跳確認彈窗', $(w, 'confirmModalOverlay').style.display === 'flex');
    t('  訊息帶出筆數 2', $(w, 'confirmModalContent').textContent.includes('2'),
        $(w, 'confirmModalContent').textContent);
    t('  確認之前兩筆都還在', hist(w).length === 2);
    $(w, 'confirmModalOk').click();
    t('  按下確定才真的清空', hist(w).length === 0, String(hist(w).length));
}

/* ============================================================
   自動暫存
   ============================================================ */
console.log('\n24 小時自動暫存');

{
    const w = boot();
    buildCase(w, 28.8, 288000, 0.6);
    w.eval('saveGasDraft()');

    const raw = w.localStorage.getItem('gasCalculatorDraft');
    t('寫得進暫存', !!raw);

    const d = JSON.parse(raw || '{}');
    t('  含每月油錢', d.monthlyExpense === 288000, String(d.monthlyExpense));
    t('  含折扣金額', d.discountAmount === 0.6, String(d.discountAmount));
    t('  有時間戳', !!d.savedAt);

    const w2 = boot();
    w2.localStorage.setItem('gasCalculatorDraft', raw);
    t('重開頁面會還原', w2.eval('restoreGasDraft()') === true);
    t('  每月油錢還原', val(w2, 'monthlyExpense') === '288,000', val(w2, 'monthlyExpense'));
    t('  每月油量重算正確', val(w2, 'monthlyVolume') === '10,000', val(w2, 'monthlyVolume'));

    const old = JSON.parse(raw);
    old.savedAt = new Date(Date.now() - 25 * 3600000).toISOString();
    const w3 = boot();
    w3.localStorage.setItem('gasCalculatorDraft', JSON.stringify(old));
    t('超過 24 小時不還原', w3.eval('restoreGasDraft()') === false);
    t('  而且會被清掉', w3.localStorage.getItem('gasCalculatorDraft') === null);
}

/* ============================================================
   歷史面板的樣式四頁都拿得到
   ============================================================ */
console.log('\n共用樣式');

{
    const historyCss = fs.readFileSync(path.join(R, 'css/history.css'), 'utf8');
    const calcCss = fs.readFileSync(path.join(R, 'css/calculator.css'), 'utf8');

    ['.history-panel', '.history-item', '.detail-btn', '.delete-btn',
     '.no-data', '.history-note-preview', '.function-buttons'].forEach(sel => {
        t(`${sel} 在四頁共用的 history.css`,
            new RegExp('\\' + sel + '\\s*[,{]').test(historyCss));
    });

    t('沒有留在只有兩頁載入的 calculator.css',
        !/^\.history-panel\s*\{/m.test(calcCss) && !/^\.function-buttons\s*\{/m.test(calcCss));

    ['calculator', 'check', 'invoice', 'gas'].forEach(p => {
        const html = fs.readFileSync(path.join(R, 'pages', p + '.html'), 'utf8');
        t(`${p}.html 有載入 history.css`, html.includes('css/history.css'));
    });
}

/* ============================================================ */
console.log(`\n通過 ${pass}　失敗 ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
