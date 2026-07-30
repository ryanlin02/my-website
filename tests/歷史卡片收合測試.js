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
const $ = (w, id) => w.document.getElementById(id);
const histList = w => JSON.parse(w.localStorage.getItem('checkHistory') || '[]')
    .map(r => Object.assign({ id: r.id, note: r.note }, r.data || {}));

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
   四、編輯模式與多選刪除
   ------------------------------------------------------------
   這個模式一次解決兩個問題：

     一、刪多筆的成本。一筆要點三次（展開 → 刪除 → 確定），
         清五筆就是十五次；編輯模式下是八次，筆數越多省越多。

     二、「清空歷史」原本擺在標題列、就在關閉鈕旁邊，是不可復原的
         動作卻只要誤觸一次。現在一般瀏覽時標題列上沒有破壞性按鈕。
   ============================================================ */
console.log('\n編輯模式');

{
    const w = boot();
    buildAndSave(w, 1200000, 100000, 12, 2026, 8, 5);
    w.eval('clearAllInputs()');
    if (w.document.getElementById('confirmModalOverlay').style.display === 'flex') {
        w.document.getElementById('confirmModalOk').click();
    }
    buildAndSave(w, 600000, 50000, 6, 2026, 9, 10);
    w.eval('toggleHistoryPanel()');

    const panel = $(w, 'historyPanel');
    t('前置：兩筆紀錄', items(w).length === 2, String(items(w).length));
    t('一般模式下面板沒有 edit-mode', !panel.classList.contains('edit-mode'));

    // 標題列在一般模式不該有任何破壞性按鈕
    t('標題列有「編輯」', !!w.document.querySelector('.history-edit-btn'));
    t('  標題列沒有「清空歷史」（已由全選＋刪除取代）',
        !/清空歷史/.test(w.document.querySelector('.history-header').textContent),
        w.document.querySelector('.history-header').textContent.replace(/\s+/g, ' '));

    w.eval('toggleHistoryEditMode()');
    t('按「編輯」進入編輯模式', panel.classList.contains('edit-mode'));
    t('  計數顯示已選 0 筆',
        /已選 0 筆/.test(w.document.querySelector('.history-selected-count').textContent));
    t('  一筆都沒選時刪除鈕不能按',
        w.document.querySelector('.history-delete-selected').classList.contains('is-disabled'));

    // 編輯模式下點整列是選取，不是展開
    const first = items(w)[0];
    first.querySelector('.history-item-summary').click();
    t('點整列會選取', first.classList.contains('selected'), first.className);
    t('  而且不會展開', !first.classList.contains('expanded'), first.className);
    t('  計數更新為 1 筆',
        /已選 1 筆/.test(w.document.querySelector('.history-selected-count').textContent));
    t('  刪除鈕變成可以按',
        !w.document.querySelector('.history-delete-selected').classList.contains('is-disabled'));

    first.querySelector('.history-item-summary').click();
    t('再點一次取消選取', !first.classList.contains('selected'));
    t('  刪除鈕又不能按了',
        w.document.querySelector('.history-delete-selected').classList.contains('is-disabled'));
}

{
    const w = boot();
    buildAndSave(w, 1200000, 100000, 12, 2026, 8, 5);
    w.eval('clearAllInputs()');
    if (w.document.getElementById('confirmModalOverlay').style.display === 'flex') {
        w.document.getElementById('confirmModalOk').click();
    }
    buildAndSave(w, 600000, 50000, 6, 2026, 9, 10);
    w.eval('toggleHistoryPanel()');
    w.eval('toggleHistoryEditMode()');

    // 全選 → 取消全選 是同一顆按鈕
    w.eval('toggleHistorySelectAll()');
    t('全選會把兩筆都選起來',
        items(w).every(i => i.classList.contains('selected')),
        items(w).map(i => i.className).join(' | '));
    t('  按鈕文字變成「取消全選」',
        w.document.querySelector('.history-select-all').textContent === '取消全選',
        w.document.querySelector('.history-select-all').textContent);

    w.eval('toggleHistorySelectAll()');
    t('再按一次全部取消', items(w).every(i => !i.classList.contains('selected')));
    t('  按鈕文字變回「全選」',
        w.document.querySelector('.history-select-all').textContent === '全選');
}

{
    // 多選刪除
    const w = boot();
    buildAndSave(w, 1200000, 100000, 12, 2026, 8, 5);
    w.eval('clearAllInputs()');
    if (w.document.getElementById('confirmModalOverlay').style.display === 'flex') {
        w.document.getElementById('confirmModalOk').click();
    }
    buildAndSave(w, 600000, 50000, 6, 2026, 9, 10);
    w.eval('clearAllInputs()');
    if (w.document.getElementById('confirmModalOverlay').style.display === 'flex') {
        w.document.getElementById('confirmModalOk').click();
    }
    buildAndSave(w, 300000, 25000, 3, 2026, 10, 15);

    w.eval('toggleHistoryPanel()');
    w.eval('toggleHistoryEditMode()');
    t('前置：三筆', items(w).length === 3, String(items(w).length));

    items(w)[0].querySelector('.history-item-summary').click();
    items(w)[2].querySelector('.history-item-summary').click();

    w.eval('deleteSelectedHistory()');
    t('多選刪除會先跳確認',
        $(w, 'confirmModalOverlay').style.display === 'flex');
    t('  訊息說明要刪幾筆',
        /選取的 <b>2<\/b> 筆/.test($(w, 'confirmModalContent').innerHTML),
        $(w, 'confirmModalContent').textContent);
    t('  確認之前三筆都還在', histList(w).length === 3, String(histList(w).length));

    $(w, 'confirmModalOk').click();
    t('按下確定才真的刪掉兩筆', histList(w).length === 1, String(histList(w).length));
    t('  留下來的是沒被選的那一筆',
        histList(w)[0].totalAmount === 600000, String(histList(w)[0].totalAmount));
    t('  刪完自動離開編輯模式',
        !$(w, 'historyPanel').classList.contains('edit-mode'));
}

{
    // 全選後刪除 = 舊的「清空歷史」，訊息也要換成清空的說法
    const w = boot();
    buildAndSave(w, 1200000, 100000, 12, 2026, 8, 5);
    w.eval('toggleHistoryPanel()');
    w.eval('toggleHistoryEditMode()');
    w.eval('toggleHistorySelectAll()');
    w.eval('deleteSelectedHistory()');

    t('全選後刪除，標題是「清空確認」',
        $(w, 'confirmModalTitle').textContent.trim() === '清空確認',
        $(w, 'confirmModalTitle').textContent);
    $(w, 'confirmModalOk').click();
    t('  確定後清單為空', histList(w).length === 0);
}

{
    // 關掉面板要離開編輯模式，下次打開不會停在選了一半的狀態
    const w = boot();
    buildAndSave(w, 1200000, 100000, 12, 2026, 8, 5);
    w.eval('toggleHistoryPanel()');
    w.eval('toggleHistoryEditMode()');
    items(w)[0].querySelector('.history-item-summary').click();

    w.eval('toggleHistoryPanel()');      // 關閉
    t('關閉面板會離開編輯模式',
        !$(w, 'historyPanel').classList.contains('edit-mode'));

    w.eval('toggleHistoryPanel()');      // 再打開
    t('  重新打開是一般模式', !$(w, 'historyPanel').classList.contains('edit-mode'));
    t('  而且沒有殘留的選取', items(w).every(i => !i.classList.contains('selected')));
}

/* ============================================================
   五、樣式：收合的那一層真的會把細節藏起來
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
    /* 展開後的欄位：標籤與數值同一橫列，而且數值要比標籤大。
       舊版是標籤在上數值在下、且標籤 16px 大於數值 14px ——
       視覺重量剛好反過來，六個欄位也吃掉六行高度。 */
    t('細項的標籤與數值在同一橫列（不是上下堆疊）',
        !/\.history-detail-item\s*\{[^}]*flex-direction:\s*column/.test(css));
    {
        const label = (css.match(/\.detail-label\s*\{[^}]*\}/) || [''])[0];
        const value = (css.match(/\.detail-value\s*\{[^}]*\}/) || [''])[0];
        const size = b => Number((b.match(/font-size:\s*(\d+)px/) || [0, 0])[1]);
        t('  數值的字級大於標籤（數值才是資訊）',
            size(value) > size(label), `標籤 ${size(label)}px / 數值 ${size(value)}px`);
        t('  數值用等寬數字，上下列位數才對得齊',
            /tabular-nums/.test(value));
    }

    /* 【框中框】卡片本身已經有底色與外框；裡面的排版容器不該再各自畫一個框。
       原本 .history-item-header 有自己的底色與內距，而且左右各多 5px margin，
       導致那一行的邊緣比下面窄一截 —— 實機上就是「上面的框跟下面不一樣寬」。 */
    const block = sel => (css.match(new RegExp('\\' + sel + '\\s*\\{[^}]*\\}')) || [''])[0];
    ['.history-item-header', '.history-details', '.history-note-container'].forEach(sel => {
        const b = block(sel);
        t(`${sel} 不再自己畫一個框`,
            !/background(-color)?:/.test(b) && !/border:/.test(b), b.replace(/\s+/g, ' '));
    });
    t('  時間與徽章沒有額外的左右邊距（邊緣才對得齊下面那行）',
        !/margin-left/.test(block('.history-date')) && !/margin:/.test(block('.history-header-rate')));

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

    /* 【中文不用斜體】
     * 中文字體沒有真正的斜體字形，瀏覽器只能自己把字傾斜出來（合成斜體）。
     * 傾斜之後最後一個字的右上角會超出容器，遇到 overflow: hidden 就被切掉
     * —— 實機上「台積電」的「電」字缺了一角就是這樣來的。
     * 需要弱化一律改用顏色與字級。 */
    ['history.css', 'invoice.css', 'calculator.css', 'check.css', 'gas.css', 'keypad.css']
        .forEach(f => {
            const body = fs.readFileSync(path.join(R, 'css', f), 'utf8')
                .replace(/\/\*[\s\S]*?\*\//g, '');
            t(`${f} 沒有使用 font-style: italic`,
                !/font-style:\s*italic/.test(body),
                (body.match(/[^\n]*font-style:\s*italic[^\n]*/) || [''])[0].trim());
        });
}

/* ============================================================
   六、四頁都改用同一套結構（步驟 5-2）
   ------------------------------------------------------------
   靜態檢查即可：四支渲染函式都必須輸出 .history-item-summary /
   .history-item-detail 兩層、掛上 data-history-id、
   並且呼叫 setupHistoryPanel() 註冊面板。少了任何一項，
   那一頁的收合或編輯模式就是壞的。
   ============================================================ */
console.log('\n四頁的一致性');

{
    const engines = {
        '計算頁': 'js/calc-storage.js',
        '支票頁': 'js/check-engine.js',
        '加油頁': 'js/gas-engine.js',
        '發票頁': 'js/invoice-engine.js'
    };

    Object.entries(engines).forEach(([name, f]) => {
        const src = fs.readFileSync(path.join(R, f), 'utf8');
        t(`${name} 卡片分成 summary 與 detail 兩層`,
            src.includes('history-item-summary') && src.includes('history-item-detail'));
        t(`  ${name} 有勾選框與展開狀態的 class`,
            src.includes('historyCheckboxHtml()') && src.includes('historyItemClass('));
        t(`  ${name} 有 data-history-id（委派靠它認出是哪一筆）`,
            src.includes('data-history-id='));
        t(`  ${name} 有註冊面板`, src.includes('setupHistoryPanel({'));
        t(`  ${name} 不再自己處理清空`, !src.includes('function confirmDeleteAll'));
    });

    // 四頁的標題列都要是雙態的
    ['calculator', 'check', 'gas', 'invoice'].forEach(p => {
        const html = fs.readFileSync(path.join(R, 'pages', p + '.html'), 'utf8');
        t(`${p}.html 標題列是雙態的`,
            html.includes('history-edit-btn') && html.includes('history-select-all') &&
            html.includes('history-delete-selected') && html.includes('history-done'));
    });

    // 發票頁原本那套橫向一列的樣式應該連同結構一起退場，不留死碼
    const invCss = fs.readFileSync(path.join(R, 'css/invoice.css'), 'utf8');
    t('發票頁不再殘留舊的 .hrec 樣式（避免又被層疊順序喚醒）',
        !/^\.hrec/m.test(invCss.replace(/\/\*[\s\S]*?\*\//g, '')));
}

/* ============================================================ */
console.log(`\n通過 ${pass}　失敗 ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
