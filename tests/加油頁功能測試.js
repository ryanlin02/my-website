/**
 * 加油頁 — 功能與結構守門測試
 * ============================================================
 * 這支測試是「修改計劃-加油頁.md」階段 0 的產物。
 *
 * 【為什麼要先寫測試才動手改】
 * 加油頁是四個功能頁裡唯一沒有測試的頁面，而它累積了兩個
 * 會在客戶面前顯示錯誤數字的 bug。沒有測試就改，改完只能靠
 * 目視判斷「有沒有弄壞別的地方」，那不可靠。
 *
 * 【XFAIL 是什麼】
 * 本檔把「已知但還沒修的問題」標成 XFAIL（預期失敗），
 * 而不是單純的 FAIL。差別是：
 *   - XFAIL  → 已知問題，還沒修，符合預期，不影響 exit code
 *   - XPASS  → 該問題已被修好！請把該行的 xt 改成 t，讓它變成守門測試
 *   - FAIL   → 真的壞了，exit code 1
 * 這樣這支測試從第一天就能當 CI 關卡用，而不是永遠紅燈。
 *
 * 每個 XFAIL 都標了它屬於計劃書的哪個階段。修完那個階段後，
 * 對應的 XFAIL 應該全部轉成 XPASS —— 那就是該階段的驗收依據。
 *
 * 需要先安裝 jsdom：npm install jsdom
 * 執行：node tests/加油頁功能測試.js
 * ============================================================
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const R = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(R, 'pages/gas.html'), 'utf8');

/* ------------------------------------------------------------
 * 建立 jsdom 環境
 * ------------------------------------------------------------
 * 階段 2 拆檔後，載入方式已與 tests/計算頁功能測試.js 完全一致：
 * 依 HTML 裡 <script src> 的真實順序載入外部 js 檔。
 *
 * 這件事本身就是拆檔正確性的驗證 —— 如果 gas.html 沒有正確
 * 指向 js/gas-engine.js，下面 scripts 陣列會是空的，測試直接掛掉。
 * ------------------------------------------------------------ */

const dom = new JSDOM(html, {
    url: 'https://ryanlin02.github.io/my-website/pages/gas.html',
    runScripts: 'outside-only',
    pretendToBeVisual: true
});
const w = dom.window, d = w.document, ev = c => w.eval(c);

// 時鐘 timer 會讓 node 不結束；一律停掉
ev('window.setInterval=function(){return 0;};window.setTimeout=function(){return 0;};');
// 離線 fallback 會打 console.warn，測試輸出保持乾淨
ev('window.console.warn=function(){};');

// 依 HTML 中 <script src> 的真實順序載入（frame-guard 會導向外殼，測試環境要排除）
const scripts = [...html.matchAll(/<script src="\.\.\/js\/([^"]+)"/g)]
    .map(m => m[1]).filter(f => f !== 'frame-guard.js');

if (!scripts.includes('gas-engine.js')) {
    console.error('gas.html 沒有載入 js/gas-engine.js —— 階段 2 的拆檔可能不完整。');
    process.exit(1);
}

// mainScript 供後面的原始碼守門測試使用
let mainScript = '';
for (const f of scripts) {
    // indirect eval 下 let 不會留在全域，換成 var 才能跨 eval 呼叫
    const src = fs.readFileSync(path.join(R, 'js', f), 'utf8').replace(/^let /gm, 'var ');
    mainScript += src;
    ev(src);
}

/* 拆檔守門：HTML 裡不該再有內嵌樣式或內嵌邏輯 */
const leftoverStyle = /<style[\s>]/.test(html);
// GA4 追蹤區塊仍在 head 內嵌（那是刻意保留的，與 check/invoice 一致）
const inlineScriptCount = (html.match(/<script>/g) || []).length;

/* ------------------------------------------------------------
 * 去掉註解後的程式碼，供「某段程式碼是否已移除」的守門測試使用。
 *
 * 【為什麼需要這個】
 * 本專案的註解習慣是把「為什麼移除某段程式碼」寫在原地，
 * 所以註解裡經常含有被移除程式碼的原文，例如：
 *     // 舊版是 setInterval(updateCurrentDate, 1000)。
 * 直接搜尋原始碼會把註解也算進去，誤判成「還沒移除」。
 * ------------------------------------------------------------ */
function stripJsComments(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')          // 區塊註解
        .split('\n')
        .filter(l => !l.trim().startsWith('//'))   // 整行註解
        .join('\n');
}

/* ------------------------------------------------------------
 * 假的 fetch：讓油價載入走得通，也能模擬離線
 * ------------------------------------------------------------ */
const fuelJson = fs.readFileSync(path.join(R, 'data/fuel-prices.json'), 'utf8');
ev(`
    window.__fuelJson = ${fuelJson};
    window.__fetchMode = 'ok';
    window.fetch = function(){
        if (window.__fetchMode === 'fail') return Promise.reject(new Error('offline'));
        return Promise.resolve({ ok: true, json: function(){ return Promise.resolve(window.__fuelJson); } });
    };
`);

/* ------------------------------------------------------------
 * 測試工具
 * ------------------------------------------------------------ */
let pass = 0, fail = 0, xfail = 0, xpass = 0;

const t = (n, c, e = '') => {
    c ? pass++ : fail++;
    console.log((c ? '  PASS  ' : '  FAIL  ') + n + (c ? '' : '   → 實際：' + e));
};

// 已知問題：預期會失敗。stage = 計劃書的階段編號
const xt = (n, c, stage, e = '') => {
    if (c) {
        xpass++;
        console.log('  XPASS  ' + n + '   → 已修復！請把這行的 xt 改成 t');
    } else {
        xfail++;
        console.log('  XFAIL  ' + n + '   → 已知問題（待' + stage + '）實際：' + e);
    }
};

const v = id => d.getElementById(id).value;
// 走真實路徑：開鍵盤 → 填運算式 → 按確認
const viaKeypad = (id, val) =>
    ev(`openCalculator(${JSON.stringify(id)});calcExpression=${JSON.stringify(String(val))};confirmCalculation();`);
// 回到乾淨狀態：清空六欄，並把單價設回 28.8
const reset = () => { ev('clearCalculation();'); ev('setDieselPrice(28.8);'); };

/* ============================================================
 * 開始測試
 * ============================================================ */
async function main() {

    console.log('\n=== 1. 頁面初始化與油價載入 ===');
    // 拆檔後初始化改由 DOMContentLoaded 觸發；
    // jsdom 的 load 事件在建構時就過了，所以直接呼叫初始化函式
    ev('initGasPage();');
    await new Promise(r => setImmediate(r));   // 等 loadFuelPrices 的 promise 走完

    t('自動帶入中油柴油單價 28.8', v('dieselPrice') === '28.8', v('dieselPrice'));
    t('「中」按鈕的 onclick 已動態更新（含 GA4 來源標記）',
        d.getElementById('btnCpcDiesel').getAttribute('onclick') === "setDieselPrice(28.8, 'quick_cpc')",
        d.getElementById('btnCpcDiesel').getAttribute('onclick'));
    t('「塑」按鈕的 onclick 已動態更新（含 GA4 來源標記）',
        d.getElementById('btnFormosaDiesel').getAttribute('onclick') === "setDieselPrice(28.6, 'quick_formosa')",
        d.getElementById('btnFormosaDiesel').getAttribute('onclick'));
    t('表格下方顯示最後更新時間',
        d.getElementById('tableFootnote').textContent.includes('2026/07/24'),
        d.getElementById('tableFootnote').textContent);
    t('時間顯示已填入', d.getElementById('current-date').textContent !== '',
        d.getElementById('current-date').textContent);

    // 階段 1-1 修復：舊版存活的 updateCalculations 有
    // `if (monthlyExpense === 0) 欄位 = '0'`，載入時就把空欄位填成 0。
    t('載入後「每月油錢」維持空白（顯示 placeholder）',
        v('monthlyExpense') === '', JSON.stringify(v('monthlyExpense')));

    console.log('\n=== 2. 快速單價按鈕 ===');
    ev('setDieselPrice(28.6)');
    t('setDieselPrice(28.6) → 28.6', v('dieselPrice') === '28.6', v('dieselPrice'));
    ev('setDieselPrice(28.8)');
    t('setDieselPrice(28.8) → 28.8', v('dieselPrice') === '28.8', v('dieselPrice'));

    console.log('\n=== 3. 油錢 → 油量（正向計算）===');
    reset();
    viaKeypad('monthlyExpense', 28800);
    t('每月油錢 28,800', v('monthlyExpense') === '28,800', v('monthlyExpense'));
    t('自動算出每月油量 1,000 公升', v('monthlyVolume') === '1,000', v('monthlyVolume'));

    console.log('\n=== 4. 油量 → 油錢（反向計算，階段 1-1 修復）===');
    // 這是階段 1-1 修掉的 bug：updateCalculations 曾被重複定義，
    // 存活的那份只做單向計算，導致「每月油量」欄位實質不能用。
    reset();
    viaKeypad('monthlyVolume', 1000);
    t('油錢空白時，輸入油量 1,000 反算出油錢 28,800',
        v('monthlyExpense') === '28,800', JSON.stringify(v('monthlyExpense')));

    reset();
    viaKeypad('monthlyExpense', 28800);          // 先讓油量 = 1,000
    viaKeypad('monthlyVolume', 2000);            // 再改油量為 2,000
    t('油錢已有值時，改油量 2,000 不會被蓋回 1,000',
        v('monthlyVolume') === '2,000', v('monthlyVolume'));
    t('  且油錢跟著變成 57,600',
        v('monthlyExpense') === '57,600', v('monthlyExpense'));

    // 雙向推算最容易壞的地方：連續切換輸入方向
    reset();
    viaKeypad('monthlyVolume', 500);
    t('連續切換方向 ①：油量 500 → 油錢 14,400',
        v('monthlyExpense') === '14,400', v('monthlyExpense'));
    viaKeypad('monthlyExpense', 28800);
    t('連續切換方向 ②：改回油錢 28,800 → 油量 1,000',
        v('monthlyVolume') === '1,000', v('monthlyVolume'));
    viaKeypad('monthlyVolume', 300);
    t('連續切換方向 ③：再改油量 300 → 油錢 8,640',
        v('monthlyExpense') === '8,640', v('monthlyExpense'));

    console.log('\n=== 5. 折扣計算 ===');
    reset();
    viaKeypad('monthlyExpense', 28800);
    ev('setDiscountAmount(0.5)');
    t('折扣金額 0.5', v('discountAmount') === '0.5', v('discountAmount'));
    t('折後油錢 28,300  (28.3×1000)', v('discountedExpense') === '28,300', v('discountedExpense'));
    t('每月節省 500', v('monthlySaving') === '500', v('monthlySaving'));
    t('每年節省 6,000  (500×12)', v('yearlySaving') === '6,000', v('yearlySaving'));

    console.log('\n=== 6. 折扣歸零 → 結果區必須清空（階段 1-1 修復）===');
    // 這是階段 1-1 修掉的另一個 bug：存活的 updateCalculations 少了 else 分支。
    // 業務按「-1」把折扣壓到 0.0 後，下面三格還停在舊數字。
    ev('adjustDiscountAmount(-0.5)');
    t('折扣已歸零', v('discountAmount') === '0.0', v('discountAmount'));
    t('折後油錢已清空', v('discountedExpense') === '', v('discountedExpense'));
    t('每月節省已清空', v('monthlySaving') === '', v('monthlySaving'));
    t('每年節省已清空', v('yearlySaving') === '', v('yearlySaving'));

    // 清除鍵之後也不該殘留
    reset();
    viaKeypad('monthlyExpense', 28800);
    ev('setDiscountAmount(0.5)');
    ev('clearCalculation()');
    ev('setDieselPrice(28.8)');
    t('清除後再設單價，結果區仍為空',
        v('discountedExpense') === '' && v('monthlySaving') === '' && v('yearlySaving') === '',
        `${v('discountedExpense')}/${v('monthlySaving')}/${v('yearlySaving')}`);

    console.log('\n=== 7. 千分位格式 ===');
    reset();
    viaKeypad('monthlyExpense', 1000000);
    t('油錢 1,000,000', v('monthlyExpense') === '1,000,000', v('monthlyExpense'));
    t('油量 34,722  (1000000÷28.8)', v('monthlyVolume') === '34,722', v('monthlyVolume'));

    console.log('\n=== 8. 折扣金額上下限（0.0 ～ 5.0）===');
    reset();
    ev('setDiscountAmount(9)');
    t('setDiscountAmount(9) 夾到 5.0', v('discountAmount') === '5.0', v('discountAmount'));
    ev('adjustDiscountAmount(-99)');
    t('adjustDiscountAmount(-99) 夾到 0.0', v('discountAmount') === '0.0', v('discountAmount'));
    viaKeypad('discountAmount', 8);
    t('鍵盤輸入 8 也會夾到 5.0', v('discountAmount') === '5.0', v('discountAmount'));
    ev('setDiscountAmount(0.7)');
    t('setDiscountAmount(0.7) → 0.7', v('discountAmount') === '0.7', v('discountAmount'));

    console.log('\n=== 9. 油品單價保留 1 位小數 ===');
    viaKeypad('dieselPrice', 29);
    t('輸入 29 → 顯示 29.0', v('dieselPrice') === '29.0', v('dieselPrice'));
    viaKeypad('dieselPrice', 28.75);
    t('輸入 28.75 → 四捨五入 28.8', v('dieselPrice') === '28.8', v('dieselPrice'));
    viaKeypad('dieselPrice', -5);
    t('負數被夾到 0.0', v('dieselPrice') === '0.0', v('dieselPrice'));
    ev('setDieselPrice(28.8)');

    console.log('\n=== 10. 清除鍵 ===');
    reset();
    viaKeypad('monthlyExpense', 28800);
    ev('setDiscountAmount(0.5)');
    ev('clearCalculation()');
    const notCleared = ['monthlyExpense', 'monthlyVolume', 'discountAmount',
        'discountedExpense', 'monthlySaving', 'yearlySaving'].filter(id => v(id) !== '');
    t('六個欄位全部清空', notCleared.length === 0, notCleared.join(','));
    t('油品單價保留不清（28.8）', v('dieselPrice') === '28.8', v('dieselPrice'));

    console.log('\n=== 11. 油價對照表 ===');
    const rows = d.querySelectorAll('#fuelPriceTableBody tr');
    t('表格繪出 4 列油品', rows.length === 4, String(rows.length));
    t('第 1 列為 92 無鉛汽油', rows[0] && rows[0].textContent.includes('92'), rows[0] && rows[0].textContent.trim());
    t('第 4 列為超級柴油', rows[3] && rows[3].textContent.includes('超級柴油'), rows[3] && rows[3].textContent.trim());
    const cpc92 = rows[0] && rows[0].querySelector('td.price-val.cpc');
    t('92 中油價格顯示 $29.8', cpc92 && cpc92.textContent === '$29.8', cpc92 && cpc92.textContent);
    t('  且可點擊帶入（onclick 含價格與 GA4 來源標記）',
        cpc92 && cpc92.getAttribute('onclick') === "setDieselPrice(29.8, 'table_cpc_unleaded92')",
        cpc92 && cpc92.getAttribute('onclick'));
    // jsdom 的 runScripts:'outside-only' 不會執行 inline onclick，改直接呼叫驗證帶入邏輯
    ev('setDieselPrice(29.8)');
    t('點擊帶入後單價 = 29.8', v('dieselPrice') === '29.8', v('dieselPrice'));
    ev('setDieselPrice(28.8)');

    console.log('\n=== 12. 離線 fallback ===');
    ev("window.__fetchMode='fail'; window.fuelPricesData=null;");
    ev('loadFuelPrices();');
    await new Promise(r => setImmediate(r));
    t('讀取失敗時仍有資料（走 fallback）', ev('fuelPricesData !== null'));
    t('fallback 中油柴油 = 28.8', ev('fuelPricesData.prices.cpc.diesel') === 28.8,
        String(ev('fuelPricesData.prices.cpc.diesel')));
    t('fallback 台塑柴油 = 28.6', ev('fuelPricesData.prices.formosa.diesel') === 28.6,
        String(ev('fuelPricesData.prices.formosa.diesel')));
    t('表格仍能繪出', d.querySelectorAll('#fuelPriceTableBody tr').length === 4);
    // 階段 5-1：目前 fallback 的 updatedDateStr 是「即時數據」，
    // 業務會誤以為看到的是最新油價。應改為明確標示非最新。
    xt('離線註記應標明「非最新」而不是「即時數據」',
        !d.getElementById('tableFootnote').textContent.includes('即時數據'),
        '階段 5-1', d.getElementById('tableFootnote').textContent);
    ev("window.__fetchMode='ok';");

    console.log('\n=== 13. DOM 結構不變式（階段 1-2 移除多餘 </div> 前後都必須成立）===');
    t('#timeDisplay 的父層是 .time-display-wrapper',
        d.getElementById('timeDisplay').parentNode.className === 'time-display-wrapper',
        d.getElementById('timeDisplay').parentNode.className);
    t('.container 是 body 的直接子元素',
        d.querySelector('.container').parentNode === d.body,
        d.querySelector('.container').parentNode.nodeName);
    t('.price-checker-container 是 body 的直接子元素',
        d.querySelector('.price-checker-container').parentNode === d.body,
        d.querySelector('.price-checker-container').parentNode.nodeName);
    t('#calculatorModal 是 body 的直接子元素',
        d.getElementById('calculatorModal').parentNode === d.body,
        d.getElementById('calculatorModal').parentNode.nodeName);
    t('四個可輸入欄位都在 .container 內',
        ['dieselPrice', 'monthlyExpense', 'monthlyVolume', 'discountAmount']
            .every(id => d.querySelector('.container').contains(d.getElementById(id))));

    console.log('\n=== 14. 原始碼守門（防止階段 1 的問題再度出現）===');
    const bodySrc = html.slice(html.indexOf('<body>'), html.indexOf('</body>'));
    const opens = (bodySrc.match(/<div/g) || []).length;
    const closes = (bodySrc.match(/<\/div>/g) || []).length;
    t(`body 內 <div> 與 </div> 數量相等（各 ${opens} 個）`,
        opens === closes, `開 ${opens} / 閉 ${closes}`);

    const dupCalc = (mainScript.match(/function updateCalculations/g) || []).length;
    t('updateCalculations 只定義 1 次', dupCalc === 1, `定義了 ${dupCalc} 次`);

    const dupFmt = (mainScript.match(/function addThousandsSeparator/g) || []).length;
    t('重複的 addThousandsSeparator 已移除', dupFmt === 0, `還有 ${dupFmt} 個定義`);

    // 沒設 lastModifiedField 會讓雙向推算的方向判斷失準
    const adjBody = mainScript.slice(
        mainScript.indexOf('function adjustMonthlyExpense'),
        mainScript.indexOf('function formatNumberWithCommas'));
    t('adjustMonthlyExpense 有設定 lastModifiedField',
        adjBody.includes('lastModifiedField'), '未設定');

    // 每一個會改動輸入欄位的入口都必須設 lastModifiedField，否則方向會判斷錯
    ['setDieselPrice', 'confirmCalculation', 'adjustMonthlyExpense',
        'adjustDiscountAmount', 'setDiscountAmount'].forEach(fn => {
            const start = mainScript.indexOf('function ' + fn);
            const next = mainScript.indexOf('\nfunction ', start + 1);
            const body = mainScript.slice(start, next === -1 ? undefined : next);
            t(`  ${fn}() 有設定 lastModifiedField`, body.includes('lastModifiedField'));
        });

    console.log('\n=== 15. 快速調整按鈕 ===');
    reset();
    viaKeypad('monthlyExpense', 500000);
    ev('adjustMonthlyExpense(100000)');
    t('油錢 +10萬 → 600,000', v('monthlyExpense') === '600,000', v('monthlyExpense'));
    ev('adjustMonthlyExpense(-1000000)');
    t('油錢 -100萬 不會變負數（夾到 0）', v('monthlyExpense') === '0', v('monthlyExpense'));
    reset();
    viaKeypad('monthlyExpense', 288000);
    const volBefore = v('monthlyVolume');
    ev('adjustMonthlyExpense(100000)');
    t('按調整鍵後油量跟著更新', v('monthlyVolume') !== volBefore,
        `${volBefore} → ${v('monthlyVolume')}`);

    // ── 階段 1-4 真正要防的情境 ──
    // 上一步先輸入「油量」（lastModifiedField='monthlyVolume'），
    // 接著按油錢調整鍵。若 adjustMonthlyExpense 沒設 lastModifiedField，
    // updateCalculations 會往「油量 → 油錢」方向算，
    // 把剛剛 +10 萬的結果直接蓋掉，畫面上完全看不出異常。
    reset();
    viaKeypad('monthlyVolume', 1000);            // 油量 1,000 → 油錢 28,800
    ev('adjustMonthlyExpense(100000)');          // 油錢 +10 萬 → 128,800
    t('先輸入油量、再按油錢調整鍵，調整不會被反算蓋掉',
        v('monthlyExpense') === '128,800', v('monthlyExpense'));
    t('  且油量跟著重算為 4,472  (128800÷28.8)',
        v('monthlyVolume') === '4,472', v('monthlyVolume'));

    console.log('\n=== 16. 拆檔守門（階段 2）===');
    t('gas.html 已無內嵌 <style> 區塊', !leftoverStyle, '仍有 <style>');
    t('gas.html 內嵌 <script> 只剩 GA4 那一個',
        inlineScriptCount === 1, `有 ${inlineScriptCount} 個`);
    t('gas.html 有載入 css/gas.css',
        /<link rel="stylesheet" href="\.\.\/css\/gas\.css">/.test(html));
    t('gas.html 有載入 js/gas-engine.js', scripts.includes('gas-engine.js'));
    t('css/gas.css 檔案存在且非空',
        fs.existsSync(path.join(R, 'css/gas.css')) &&
        fs.statSync(path.join(R, 'css/gas.css')).size > 1000);
    t('gas.html 已瘦身到 500 行以下（與其他三頁同級）',
        html.split('\n').length < 500, `${html.split('\n').length} 行`);

    // 這是階段 2 最容易漏、後果最嚴重的一步：
    // sw.js 沒登記的話，離線時加油頁會變成沒樣式的裸 HTML 且完全不能計算
    const sw = fs.readFileSync(path.join(R, 'sw.js'), 'utf8');
    t('sw.js 已預快取 css/gas.css', sw.includes("'./css/gas.css'"));
    t('sw.js 已預快取 js/gas-engine.js', sw.includes("'./js/gas-engine.js'"));
    // 順帶檢查其他頁面的資源也都還在清單裡，避免改 sw.js 時手滑刪掉
    ['./pages/gas.html', './css/calculator.css', './js/common-keypad.js',
        './js/check-engine.js', './js/invoice-engine.js'].forEach(f => {
            t(`  sw.js 仍保有 ${f}`, sw.includes(`'${f}'`));
        });

    // 初始化時機：改用外部檔後若還靠 window.onload，
    // 腳本載入比 load 事件晚時整頁會完全不能操作
    t('初始化改用 DOMContentLoaded 而非 window.onload',
        mainScript.includes('DOMContentLoaded') && !/window\.onload\s*=/.test(mainScript),
        /window\.onload\s*=/.test(mainScript) ? '仍在用 window.onload' : '缺 DOMContentLoaded');
    t('  且有處理腳本晚於 DOMContentLoaded 載入的情況',
        mainScript.includes('readyState'));

    console.log('\n=== 17. GA4 瘦身與時鐘守門（階段 3）===');

    // ── 已移除的有害追蹤 ──
    // 註：一定要先去掉 HTML 註解才能檢查。gas.html 裡有一大段註解在說明
    //     「這些追蹤為什麼被移除」，那段文字本身就含有這些關鍵字，
    //     不去註解的話會誤判成「還沒移除」。
    const htmlCode = html.replace(/<!--[\s\S]*?-->/g, '');

    // 全按鈕追蹤是最大的雜訊源：計算機 22 顆鍵每按一下就送一個事件
    t('已移除 querySelectorAll(\'button\') 全按鈕追蹤',
        !/querySelectorAll\(['"]button['"]\)/.test(htmlCode));
    t('已移除未 throttle 的滾動深度追蹤',
        !htmlCode.includes('scroll_depth') && !/addEventListener\(['"]scroll['"]/.test(htmlCode));
    t('已移除長按偵測（加油頁沒有長按功能）',
        !htmlCode.includes('long_press') && !/addEventListener\(['"]touchstart['"]/.test(htmlCode));
    t('已移除 beforeunload（iframe 不卸載，數據無意義）',
        !htmlCode.includes('beforeunload'));
    t('已移除 form_submit（加油頁沒有任何 <form>）',
        !htmlCode.includes('form_submit') && !htmlCode.includes('<form'));
    t('已移除 iframe_loaded postMessage（index.html 沒有監聽者）',
        !htmlCode.includes('iframe_loaded'));

    // ── GA4 區塊應與 check / invoice 同構 ──
    const gaBlock = (html.match(/<script>([\s\S]*?)<\/script>/) || ['', ''])[1];
    t('GA4 區塊已精簡到 30 行以內（原本 151 行）',
        gaBlock.trim().split('\n').length < 30, `${gaBlock.trim().split('\n').length} 行`);
    t('  仍保有 gtag 初始化', gaBlock.includes("gtag('config'"));
    t('  仍保有 trackEvent 函式', gaBlock.includes('function trackEvent'));
    t('  已移除 console.log 事件輸出（與 check/invoice 一致）',
        !gaBlock.includes('console.log'));

    // ── 白名單事件 ──
    const whitelist = ['fuel_price_selected', 'discount_calculated',
        'calculation_cleared', 'page_specific_load'];
    whitelist.forEach(e => {
        t(`白名單事件 ${e} 有被回報`, mainScript.includes(`'${e}'`));
    });
    t('trackGasEvent 有做存在性檢查（測試環境無 GA4 時不能拋錯）',
        /typeof trackEvent === ['"]function['"]/.test(mainScript));

    // 實際驗證：安裝假的 trackEvent，確認事件真的送得出來而且沒有雜訊
    ev(`
        window.__events = [];
        window.trackEvent = function(name, params){ window.__events.push({name:name, params:params||{}}); };
    `);
    reset();
    ev("window.__events = [];");
    ev("setDieselPrice(28.8, 'quick_cpc')");
    let evs = ev('JSON.stringify(window.__events)');
    t('選定單價會送出 fuel_price_selected',
        JSON.parse(evs).some(e => e.name === 'fuel_price_selected'), evs);
    t('  且帶上來源標記',
        JSON.parse(evs).some(e => e.params.source === 'quick_cpc'), evs);

    ev("window.__events = [];");
    viaKeypad('monthlyExpense', 28800);
    ev('setDiscountAmount(0.5)');
    evs = ev('JSON.stringify(window.__events)');
    t('完成試算會送出 discount_calculated',
        JSON.parse(evs).filter(e => e.name === 'discount_calculated').length === 1, evs);

    // 這是白名單設計的重點：調整折扣不該每次都送事件
    ev("window.__events = [];");
    ev('setDiscountAmount(0.6)');
    ev('setDiscountAmount(0.7)');
    ev('adjustDiscountAmount(0.1)');
    evs = ev('JSON.stringify(window.__events)');
    t('連續調整折扣三次，不會重複送 discount_calculated（避免雜訊）',
        JSON.parse(evs).filter(e => e.name === 'discount_calculated').length === 0, evs);

    ev("window.__events = [];");
    ev('clearCalculation()');
    evs = ev('JSON.stringify(window.__events)');
    t('清除會送出 calculation_cleared',
        JSON.parse(evs).some(e => e.name === 'calculation_cleared'), evs);

    // 清除後重新算一次，應該要能再送一次（狀態有正確重置）
    ev("window.__events = [];");
    ev('setDieselPrice(28.8)');
    viaKeypad('monthlyExpense', 28800);
    ev('setDiscountAmount(0.5)');
    evs = ev('JSON.stringify(window.__events)');
    t('清除後重新試算，能再送一次 discount_calculated',
        JSON.parse(evs).filter(e => e.name === 'discount_calculated').length === 1, evs);

    // 計算機按鍵絕對不能產生任何事件（這是階段 3 的核心目的）
    ev("window.__events = [];");
    ev("openCalculator('monthlyExpense');");
    ['1', '2', '3', '0', '00'].forEach(k => ev(`calcInput('${k}')`));
    ev('calcBackspace(); calcClear(); closeCalculator();');
    evs = ev('JSON.stringify(window.__events)');
    t('按 8 下計算機按鍵不產生任何 GA4 事件',
        JSON.parse(evs).length === 0, `送出了 ${JSON.parse(evs).length} 個事件：${evs}`);

    // ── 時鐘 ──
    t('時鐘改用 requestAnimationFrame（頁面隱藏時自動停止）',
        mainScript.includes('requestAnimationFrame'));
    // setInterval 只准出現在「不支援 rAF」的退路裡，且只有那一處
    const intervalCalls = (stripJsComments(mainScript).match(/setInterval\(/g) || []).length;
    t('  setInterval 只剩 1 處（rAF 的退路）',
        intervalCalls === 1, `出現 ${intervalCalls} 次`);
    t('  有為不支援 rAF 的環境保留 setInterval 退路',
        mainScript.includes('typeof requestAnimationFrame'));
    t('  只在秒數變化時才寫 DOM', mainScript.includes('lastSecond'));

    // 實際驗證 rAF 停止時時鐘就不動（模擬 iframe 被 display:none 藏起來）
    ev(`
        window.__rafCalls = 0;
        window.__rafPaused = true;
        window.requestAnimationFrame = function(cb){
            window.__rafCalls++;
            if (!window.__rafPaused && window.__rafCalls < 5) cb();
            return window.__rafCalls;
        };
    `);
    ev('startClock();');
    t('頁面被隱藏（rAF 不回呼）時，時鐘不會持續運算',
        ev('window.__rafCalls') === 1, `rAF 被呼叫 ${ev('window.__rafCalls')} 次`);

    console.log('\n=== 18. 設計理念底線：欄位不可喚起系統鍵盤 ===');
    ['dieselPrice', 'monthlyExpense', 'monthlyVolume', 'discountAmount'].forEach(id => {
        t(`${id} 為 readonly（不會跳系統鍵盤）`, d.getElementById(id).hasAttribute('readonly'));
    });
    ['discountedExpense', 'monthlySaving', 'yearlySaving'].forEach(id => {
        t(`${id} 為 disabled（純顯示）`, d.getElementById(id).hasAttribute('disabled'));
    });

    /* ============================================================ */
    console.log('\n========================================');
    console.log(`   通過 ${pass} 項 / 失敗 ${fail} 項`);
    console.log(`   已知未修 ${xfail} 項 / 已修復待轉正 ${xpass} 項`);
    console.log('========================================');
    if (xpass > 0) {
        console.log('提醒：有 XPASS 項目，代表對應階段已修好，');
        console.log('      請把那幾行的 xt 改成 t，讓它們變成正式守門測試。\n');
    }
    process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });

/* ------------------------------------------------------------
 * 這支測試目前守住的東西（依測試群組）
 *
 *   1     油價自動載入、按鈕動態更新、載入後不亂填 0
 *   2     快速單價按鈕
 *   3-4   油錢 ⇄ 油量 雙向推算（含連續切換方向）
 *   5-6   折扣計算，以及折扣歸零時必須清空結果
 *   7-9   千分位、上下限、小數位數
 *   10    清除鍵
 *   11    油價對照表
 *   12    離線 fallback
 *   13    DOM 結構不變式
 *   14    原始碼守門：重複函式、div 平衡、lastModifiedField
 *   15    快速調整按鈕（含方向被反算蓋掉的情境）
 *   16    拆檔守門：外部檔存在、sw.js 已登記、初始化時機
 *   17    欄位 readonly / disabled（不可喚起系統鍵盤）
 *
 * 尚未涵蓋（需要真實瀏覽器才驗得出來，只能實機確認）：
 *   - 鍵盤彈出時畫面不位移、不遮擋
 *   - 固定標題列在滾動時維持固定
 *   - 震動回饋
 * ------------------------------------------------------------ */
