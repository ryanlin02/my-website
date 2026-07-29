/**
 * GA4 事件測試 —— 守住「統計數字必須可信」這件事
 * ============================================================
 * 【這支測試存在的原因】
 *
 * 2026/07 盤點時發現這個網站的使用統計幾乎全是壞的：
 *
 *   1. 四個功能頁在開啟工具箱時會同時載入，而每一頁都自己回報一次
 *      「有人瀏覽了頁面」，所以開一次工具箱就送出五筆瀏覽紀錄。
 *      更糟的是四頁的數字永遠一樣 —— 完全看不出哪個功能真的有人用。
 *
 *   2. 外殼裡負責回報切頁的那段程式被同名函式整個蓋掉，從沒生效過。
 *
 *   3. 外殼裡有一行去找不存在的 pageIframe，程式一出錯整段停住，
 *      後面的錯誤記錄從來沒運作過。
 *
 *   4. 計算頁把「每一顆按鈕」都回報出去，數字鍵盤也算按鈕 ——
 *      算一筆貸款就送十幾筆「按了 7」「按了 8」。
 *
 *   5. 支票頁與發票頁完全沒有任何追蹤，一筆資料都沒有。
 *
 * 這支測試守的是修好之後的狀態，四件事：
 *
 *   A. 功能頁不准自己送瀏覽紀錄
 *   B. 開啟與切頁一定要送得出來，而且來源頁要正確
 *   C. 完成型動作才回報，連續操作不准重複送（雜訊防線）
 *   D. 送出去的資料裡不准出現客戶的金額與身分（隱私防線）
 *
 * 需要先安裝 jsdom
 * 執行：node tests/GA4事件測試.js
 * ============================================================
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const t = (name, cond, extra = '') => {
    cond ? pass++ : fail++;
    console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '   → ' + extra));
};

/* ============================================================
 * A. 功能頁不准自己送瀏覽紀錄
 * ------------------------------------------------------------
 * 四頁都必須設定 send_page_view: false，瀏覽紀錄一律交給外殼統一送。
 * 少了任何一頁，那一頁的瀏覽數就會被灌水。
 * ============================================================ */
console.log('\n=== A. 功能頁不准自己送瀏覽紀錄 ===');

const PAGES = ['calculator', 'check', 'invoice', 'gas'];

for (const page of PAGES) {
    const src = read(`pages/${page}.html`);
    t(`${page}.html 已關閉自動瀏覽回報`,
        /send_page_view:\s*false/.test(src),
        '缺少 send_page_view: false，這一頁的瀏覽數會被灌水');
}

/* ============================================================
 * B. 已經清掉的雜訊不准回來
 * ============================================================ */
console.log('\n=== B. 已清掉的雜訊不准回來 ===');
{
    const calc = read('pages/calculator.html');

    // 註解裡會提到這些名字（說明為什麼拿掉），所以先把註解剝掉再檢查
    const calcCode = calc
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');

    t('計算頁不再對所有按鈕綁追蹤（數字鍵盤也是按鈕）',
        !/querySelectorAll\(\s*['"]button['"]\s*\)/.test(calcCode));
    t('計算頁不再對每個輸入框綁 focus 追蹤',
        !/input_interaction/.test(calcCode));
    t('計算頁不再綁在不存在的 calculateBtn 上',
        !/calculateBtn|calculate-btn/.test(calcCode));

    const shell = read('index.html')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');

    t('外殼不再引用不存在的 pageIframe',
        !/pageIframe/.test(shell),
        '這一行會讓整段追蹤程式中斷');
    t('外殼不再每 30 秒回報停留時間（GA4 內建就有）',
        !/user_engagement/.test(shell));
    t('外殼不再自行回報切換 App（GA4 內建就有）',
        !/page_visibility/.test(shell));
    t('外殼不再用「把 switchPage 包起來」的寫法（會被同名函式蓋掉）',
        !/originalSwitchPage/.test(shell));
    t('外殼仍保留錯誤記錄',
        /javascript_error/.test(shell),
        '錯誤記錄是最有價值的一項，不能一起被清掉');
}

/* ============================================================
 * C. 外殼：開啟與切頁一定要送得出來
 * ============================================================ */
console.log('\n=== C. 開啟與切頁 ===');

function bootShell() {
    const events = [];
    const dom = new JSDOM(read('index.html'), {
        url: 'https://ryanlin02.github.io/my-website/',
        runScripts: 'dangerously',
        pretendToBeVisual: true,
        beforeParse(w) {
            w.matchMedia = q => ({
                matches: false, media: q,
                addListener() {}, removeListener() {},
                addEventListener() {}, removeEventListener() {}
            });
            Object.defineProperty(w.navigator, 'maxTouchPoints', { value: 5, configurable: true });

            // 攔下所有送往 GA4 的資料。gtag 實際上就是往 dataLayer 塞東西。
            w.dataLayer = [];
            const realPush = Array.prototype.push;
            w.dataLayer.push = function (args) {
                if (args && args[0] === 'event') {
                    events.push({ name: args[1], params: args[2] || {} });
                }
                return realPush.apply(this, arguments);
            };
        }
    });
    return { dom, events };
}

const boot = bootShell();

// 等內嵌程式跑完
const wait = ms => new Promise(r => setTimeout(r, ms));

async function run() {
    await wait(300);

    const { dom, events } = boot;
    const doc = dom.window.document;
    const names = events.map(e => e.name);

    t('開啟工具箱會送出 app_open', names.includes('app_open'),
        '實際送出：' + (names.join('、') || '（什麼都沒送）'));

    const appOpen = events.find(e => e.name === 'app_open');
    t('  app_open 有記錄是用應用程式還是瀏覽器開的',
        !!appOpen && ['app', 'browser'].includes(appOpen.params.display_mode),
        appOpen ? String(appOpen.params.display_mode) : '(沒有這筆)');
    t('  app_open 有記錄是不是從 LINE 之類的 App 點進來的',
        !!appOpen && ['in_app', 'normal'].includes(appOpen.params.browser_kind),
        appOpen ? String(appOpen.params.browser_kind) : '(沒有這筆)');

    t('開啟工具箱會送出第一頁的 tool_view', names.includes('tool_view'));

    const firstView = events.find(e => e.name === 'tool_view');
    t('  第一筆 tool_view 的來源標示為 app_open',
        !!firstView && firstView.params.from_tool === 'app_open',
        firstView ? String(firstView.params.from_tool) : '(沒有這筆)');

    t('每一筆 tool_view 都伴隨一筆瀏覽紀錄',
        names.filter(n => n === 'page_view').length === names.filter(n => n === 'tool_view').length,
        `tool_view ${names.filter(n => n === 'tool_view').length} 筆 / page_view ${names.filter(n => n === 'page_view').length} 筆`);

    t('不再送出舊的 navigation_click（已由 tool_view 取代）',
        !names.includes('navigation_click'));

    // 切到支票頁
    events.length = 0;
    const checkBtn = doc.querySelector('.nav-btn[data-page="check"]');
    t('找得到「支票」導覽鍵', !!checkBtn);
    if (checkBtn) {
        checkBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
        await wait(60);

        const view = events.find(e => e.name === 'tool_view');
        t('切到支票頁會送出 tool_view', !!view);
        t('  記錄切到哪一頁', !!view && view.params.tool === 'check',
            view ? String(view.params.tool) : '(沒有這筆)');
        t('  記錄從哪一頁來的', !!view && view.params.from_tool === 'calculator',
            view ? String(view.params.from_tool) : '(沒有這筆)');
    }

    dom.window.close();

    /* ============================================================
     * D. 計算頁：完成型動作才回報
     * ============================================================ */
    console.log('\n=== D. 計算頁 ===');
    const calcEvents = runCalculatorPage();

    /* ============================================================
     * E. 支票頁：連續操作不准重複送
     * ============================================================ */
    console.log('\n=== E. 支票頁 ===');
    const checkEvents = runCheckPage();

    /* ============================================================
     * F. 隱私防線
     * ============================================================ */
    console.log('\n=== F. 隱私：不准把客戶資料送出去 ===');

    const allEvents = events.concat(calcEvents, checkEvents);

    // 這些名字一旦出現在送出的參數裡，就代表客戶的金額或身分被送進 GA 了
    const FORBIDDEN = [
        'principal', 'payment', 'amount', 'total', 'deposit',
        'commission', 'tax_id', 'taxid', 'title', 'customer', 'plate'
    ];

    // page_view 是 GA4 的標準事件，page_title 指的是「計算機」「支票」這種頁面名稱，
    // 不是客戶抬頭，不在檢查範圍內
    const SAFE_KEYS = ['page_title', 'page_location', 'page_path'];

    const offenders = [];
    for (const e of allEvents) {
        for (const key of Object.keys(e.params || {})) {
            const low = key.toLowerCase();
            if (SAFE_KEYS.includes(low)) continue;
            // check_count（張數）、history_count（筆數）、item_count（品項數）是數量不是金額
            if (/_count$/.test(low)) continue;
            if (FORBIDDEN.some(bad => low.includes(bad))) {
                offenders.push(`${e.name}.${key}`);
            }
        }
    }

    t('送出的資料裡沒有任何客戶金額或身分欄位',
        offenders.length === 0,
        '發現：' + offenders.join('、'));

    console.log('\n============================================');
    console.log(`通過 ${pass} 項，失敗 ${fail} 項`);
    console.log('============================================\n');
    process.exit(fail === 0 ? 0 : 1);
}

/* ============================================================
 * 計算頁：用真實的操作路徑跑一次，看送出什麼
 * ============================================================ */
function runCalculatorPage() {
    const html = read('pages/calculator.html');
    const dom = new JSDOM(html, {
        url: 'https://ryanlin02.github.io/my-website/pages/calculator.html',
        runScripts: 'outside-only',
        pretendToBeVisual: true
    });
    const w = dom.window;
    const ev = code => w.eval(code);

    ev('window.setInterval=function(){return 0;};window.setTimeout=function(){return 0;};');

    const events = [];
    w.__events = events;
    ev('window.trackEvent=function(n,p){ window.__events.push({name:n, params:p||{}}); };');

    const scripts = [...html.matchAll(/<script src="\.\.\/js\/([^"]+)"/g)]
        .map(m => m[1]).filter(f => f !== 'frame-guard.js');
    for (const f of scripts) ev(read('js/' + f).replace(/^let /gm, 'var '));
    ev('initCommonModals()');

    const viaKeypad = (id, num) =>
        ev(`openCalculator(${JSON.stringify(id)},'t');calculatorValue=${JSON.stringify(String(num))};submitCalculatorValue();`);

    // 填三個欄位 → 應該算出期繳，並回報一次
    events.length = 0;
    viaKeypad('period', 60);
    viaKeypad('rate', 8);
    viaKeypad('principal', 1000000);

    const calcs = events.filter(e => e.name === 'loan_calculate');
    t('完成試算會送出 loan_calculate', calcs.length >= 1,
        '一筆都沒送');
    t('  記錄了期數', calcs.length > 0 && calcs[calcs.length - 1].params.period === 60,
        calcs.length ? String(calcs[calcs.length - 1].params.period) : '(沒有)');
    t('  記錄了利率', calcs.length > 0 && calcs[calcs.length - 1].params.rate === 8,
        calcs.length ? String(calcs[calcs.length - 1].params.rate) : '(沒有)');
    t('  沒有把本金送出去',
        calcs.every(e => !('principal' in e.params)));

    // 按數字鍵盤不該產生任何事件
    events.length = 0;
    ev("openCalculator('principal','t')");
    ev("calculatorInput('7');calculatorInput('8');calculatorInput('9')");
    t('按數字鍵不會送出任何事件（雜訊已清乾淨）',
        events.length === 0,
        '按三下就送了 ' + events.length + ' 筆：' + events.map(e => e.name).join('、'));
    ev('closeModal("calculatorModal")');

    // 存進歷史
    events.length = 0;
    ev('saveLoanData()');
    t('存進歷史會送出 loan_saved',
        events.some(e => e.name === 'loan_saved'),
        '實際送出：' + (events.map(e => e.name).join('、') || '（沒送）'));

    const saved = events.find(e => e.name === 'loan_saved');
    t('  沒有把金額送出去',
        !saved || (!('principal' in saved.params) && !('payment' in saved.params)));

    const collected = events.slice();
    dom.window.close();
    return collected.concat(calcs);
}

/* ============================================================
 * 支票頁：確認「連續操作不重複送」的防線有效
 * ============================================================ */
function runCheckPage() {
    const html = read('pages/check.html');
    const dom = new JSDOM(html, {
        url: 'https://ryanlin02.github.io/my-website/pages/check.html',
        runScripts: 'outside-only',
        pretendToBeVisual: true
    });
    const w = dom.window, d = w.document;
    const ev = code => w.eval(code);

    ev('window.setInterval=function(){return 0;};window.setTimeout=function(){return 0;};');

    const cfg = html.match(/window\.KEYPAD_OPTIONS\s*=\s*\{[^}]*\}/);
    if (cfg) ev(cfg[0]);
    if (d.getElementById('historyPanel')) d.getElementById('historyPanel').style.display = 'none';

    const events = [];
    w.__events = events;
    ev('window.trackEvent=function(n,p){ window.__events.push({name:n, params:p||{}}); };');

    const scripts = [...html.matchAll(/<script src="\.\.\/js\/([^"]+)"/g)]
        .map(m => m[1]).filter(f => f !== 'frame-guard.js');
    for (const f of scripts) ev(read('js/' + f).replace(/^let /gm, 'var '));
    ev('initCommonModals()');

    // 填出一組成立的金額組合
    events.length = 0;
    ev('totalAmount=1200000; paymentAmount=100000; checkCount=12; calculateDepositAmount();');

    const first = events.filter(e => e.name === 'check_calculated');
    t('算出尾款會送出 check_calculated', first.length === 1,
        '送了 ' + first.length + ' 筆');
    t('  記錄了張數', first.length === 1 && first[0].params.check_count === 12,
        first.length ? String(first[0].params.check_count) : '(沒有)');

    // 再算幾次（模擬業務微調欄位）—— 不該重複送
    events.length = 0;
    ev('calculateDepositAmount(); calculateDepositAmount(); calculateDepositAmount();');
    t('重複計算不會重複送（避免每改一個欄位就送一筆）',
        events.filter(e => e.name === 'check_calculated').length === 0,
        '重複送了 ' + events.filter(e => e.name === 'check_calculated').length + ' 筆');

    // 全部打勾 → 只在最後一張打完時送一次
    // updateWriteProgress 需要開始日期才會顯示進度條，沒有就直接跳出
    events.length = 0;
    ev('startDate = new Date(2026, 0, 10); writtenChecks = new Array(12).fill(false); barWasAllWritten = false;');
    for (let i = 0; i < 12; i++) {
        ev(`writtenChecks[${i}] = true; updateWriteProgress();`);
    }
    const done = events.filter(e => e.name === 'check_all_written');
    t('整批開完會送出 check_all_written，而且只送一次', done.length === 1,
        '送了 ' + done.length + ' 筆');

    // 沒有金額欄位
    t('支票頁送出的資料裡沒有金額',
        events.concat(first).every(e =>
            !('total_amount' in e.params) &&
            !('deposit_amount' in e.params) &&
            !('payment_amount' in e.params)));

    const collected = events.concat(first);
    dom.window.close();
    return collected;
}

run().catch(err => {
    console.error('測試本身出錯了：', err);
    process.exit(1);
});
