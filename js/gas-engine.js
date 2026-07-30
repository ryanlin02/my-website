/**
 * 重車貸款業務工具箱 - 加油頁油資折讓試算引擎 (gas-engine.js)
 * ------------------------------------------------------------
 * 【2026/07 階段 2】
 * 原本是 576 行內嵌在 pages/gas.html 的 <script> 裡，現在拆出來。
 *
 * 【本檔案目前仍有的技術債（已登記在修改計劃-加油頁.md）】
 *   - 自有一套計算機彈窗，與 js/common-keypad.js 功能重複（階段 4）
 *   - HTML 裡有 26 處 onclick 內嵌屬性，尚未改成事件委派（階段 5）
 *   - validateMonthlyExpense() 目前沒有呼叫者（階段 6-4）
 *
 * 【改動本檔案時一定要跑】
 *   node tests/加油頁功能測試.js
 * 裡面有守門測試會檢查 updateCalculations 沒有被重複定義、
 * 以及每個輸入入口都設了 lastModifiedField —— 這兩件事都出過事。
 *
 * 注意：本檔案已登記在 sw.js 的預快取清單。
 * ------------------------------------------------------------ */

/* ===== 全域變數 =====
 * 註：currentInput / calcExpression / lastResult 三個變數已於 2026/07 移除，
 *     它們是自有計算機的狀態。改用共用鍵盤後，對應的狀態改由
 *     js/common-keypad.js 的 currentInputField / calculatorValue 管理。
 * ------------------------------------------------------------ */
let lastModifiedField = ''; // 最後修改的欄位
let hasResultsShown = false; // 結果區是否已有數字（用來判斷「完成一次試算」的時機）

/* ===== GA4 事件回報（白名單）=====
 *
 * 【2026/07 階段 3】
 * 舊版在 gas.html 用 querySelectorAll('button') 給全部 39 顆按鈕
 * 綁上 click 追蹤，其中 22 顆是計算機按鍵。業務算一筆按十幾下，
 * 就送出十幾個 button_click —— 報表被雜訊淹沒，也白耗行動網路流量。
 *
 * 改為只回報四種有商業意義的操作：
 *   fuel_price_selected  選定油品單價（快速按鈕或油價表）
 *   discount_calculated  完成一次有效試算（三個結果欄位都算出來）
 *   calculation_cleared  按下清除
 *   page_specific_load   頁面載入
 *
 * trackEvent 定義在 gas.html 的 GA4 區塊。本檔案被測試環境單獨載入時
 * 不會有那個區塊，所以一定要做存在性檢查，否則整支引擎會拋 ReferenceError。
 * ------------------------------------------------------------ */
function trackGasEvent(eventName, parameters = {}) {
    if (typeof trackEvent === 'function') {
        trackEvent(eventName, parameters);
    }
}

/* 註：震動回饋 vibrate() 已於 2026/07 移除，改用 js/common-keypad.js 那一支。
 *     兩支同名函式會互相覆蓋（後載入的贏），本檔載在後面，
 *     等於會把共用鍵盤的手感偷偷改掉。共用版已改為可帶參數
 *     vibrate(duration = 30)，本頁原本用的 5／10／15／20 毫秒全部照用。 */

/* ===== 初始化函數 =====
 *
 * 【為什麼是 DOMContentLoaded 而不是 window.onload】
 * 原本用 window.onload，那要等圖片、字型等所有資源都載完才會觸發。
 * 在手機的行動網路下，業務可能已經看到欄位了卻點不動 ——
 * 因為事件還沒綁上去，點下去完全沒反應，看起來就像當機。
 * DOMContentLoaded 只等 HTML 結構就緒，綁定會早很多。
 *
 * 另外，改用外部 js 檔之後 window.onload 更不保險：
 * 若腳本因為快取而載入得比 load 事件晚，onload 根本不會再觸發，
 * 整頁會變成完全不能操作。
 * ------------------------------------------------------------ */
function initGasPage() {
    /* 四個可編輯欄位點一下就開共用鍵盤。
     * 第二個參數是彈窗標題，讓業務在鍵盤蓋住畫面時仍知道自己在填哪一欄 ——
     * 這是共用鍵盤比舊版自有鍵盤好的地方，舊版標題是寫死的。 */
    const editableFields = {
        dieselPrice: '油品單價（元/公升）',
        monthlyExpense: '每月油錢（元）',
        monthlyVolume: '每月油量（公升）',
        discountAmount: '折扣金額（元/公升）'
    };
    Object.keys(editableFields).forEach(fieldId => {
        const field = document.getElementById(fieldId);
        if (!field) return;
        field.addEventListener('click', function () {
            openCalculator(fieldId, editableFields[fieldId]);
        });
    });

    /* 還原 24 小時內的自動暫存（2026/07 步驟 4-2）。
       在 iframe 裡不跳提示：切回這一頁看到資料還在是理所當然的事。
       單獨開啟本頁時才說一聲，那通常代表 App 曾經被系統回收。 */
    if (restoreGasDraft() && window.self === window.top) {
        showToast('已還原上次的試算');
    }

    // 初始化時間顯示
    updateCurrentDate();

    // 啟動時鐘（頁面被隱藏時會自動停止，見 startClock 的說明）
    startClock();

    // 全自動載入最新每週油價（自動更新中/塑按鈕與對照表）
    loadFuelPrices();

    trackGasEvent('page_specific_load', { feature: 'gas_calculator' });
}

// 腳本可能在 DOMContentLoaded 之前或之後才載入完成，兩種情況都要能正確啟動
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGasPage);
} else {
    initGasPage();
}

/* ===== 載入全自動每週最新油價 ===== */
let fuelPricesData = null;

async function loadFuelPrices() {
    try {
        // 讀取全自動更新的 JSON 資料
        // 註：舊版在網址後加時間戳（?v=...）防快取，但每個時間戳都是不同網址，
        //     Service Worker 會把每一次都各存一份，用久了會撐爆快取。
        //     改用 no-cache 標註：網址固定，只有一筆快取被反覆覆蓋。
        const response = await fetch('../data/fuel-prices.json', { cache: 'no-cache' });
        if (!response.ok) throw new Error('HTTP status ' + response.status);
        fuelPricesData = await response.json();
    } catch (err) {
        console.warn('讀取 data/fuel-prices.json 失敗，使用預設靜態資料', err);

        // 【這裡的 updatedDateStr 一定要標明「不是最新」】
        // 舊版寫「即時數據」，業務會誤以為看到的是本週油價，
        // 拿一個寫死在程式裡的舊價格去跟客戶談。
        //
        // 補充：這條路其實很少走到。sw.js 對 data/ 用的是「網路優先 +
        // 執行時快取」，沒網路時會拿上次成功抓到的真實油價。
        // 只有「從來沒成功抓過油價 + 目前又離線」才會落到這組寫死的值。
        fuelPricesData = {
            updatedDateStr: '無法連線，以下為預設參考價（非最新）',
            isOffline: true,
            prices: {
                cpc: { name: '台灣中油', diesel: 28.8, unleaded92: 29.8, unleaded95: 31.3, unleaded98: 33.3 },
                formosa: { name: '台塑石油', diesel: 28.6, unleaded92: 29.8, unleaded95: 31.3, unleaded98: 33.3 }
            }
        };
    }

    renderFuelPricesUI(fuelPricesData);
}

function renderFuelPricesUI(data) {
    if (!data || !data.prices) return;

    const cpc = data.prices.cpc || {};
    const formosa = data.prices.formosa || {};

    // 1. 動態更新「中」、「塑」柴油快速按鈕的點擊價格與提示說明（還原按鈕顯示文字為 "中" 與 "塑"）
    const btnCpc = document.getElementById('btnCpcDiesel');
    const btnFormosa = document.getElementById('btnFormosaDiesel');

    if (btnCpc && cpc.diesel) {
        btnCpc.setAttribute('onclick', `setDieselPrice(${cpc.diesel}, 'quick_cpc')`);
        btnCpc.title = `中油超級柴油 $${cpc.diesel.toFixed(1)}`;
        btnCpc.textContent = '中';
    }

    if (btnFormosa && formosa.diesel) {
        btnFormosa.setAttribute('onclick', `setDieselPrice(${formosa.diesel}, 'quick_formosa')`);
        btnFormosa.title = `台塑超級柴油 $${formosa.diesel.toFixed(1)}`;
        btnFormosa.textContent = '塑';
    }

    // 2. 預設自動填入中油超級柴油單價 (若當前尚未有值)
    const dieselField = document.getElementById('dieselPrice');
    if (dieselField && cpc.diesel && !dieselField.value) {
        dieselField.value = cpc.diesel.toFixed(1);
        updateCalculations();
    }

    // 3. 更新表格下方最後更新時間
    //    離線時改用警示色（橘），讓業務一眼看出這不是本週油價
    const footnote = document.getElementById('tableFootnote');
    if (footnote && data.updatedDateStr) {
        if (data.isOffline) {
            footnote.textContent = `* ${data.updatedDateStr}`;
            footnote.classList.add('is-offline');
        } else {
            footnote.textContent = `* 最後更新時間：${data.updatedDateStr}`;
            footnote.classList.remove('is-offline');
        }
    }

    // 4. 動態繪製「本週油品單價對照表」
    const tableBody = document.getElementById('fuelPriceTableBody');
    if (!tableBody) return;

    const items = [
        { key: 'unleaded92', label: '92 無鉛汽油' },
        { key: 'unleaded95', label: '95 無鉛汽油 (+)' },
        { key: 'unleaded98', label: '98 無鉛汽油' },
        { key: 'diesel', label: '超級柴油' }
    ];

    let html = '';
    items.forEach(item => {
        const cpcVal = cpc[item.key];
        const formVal = formosa[item.key];

        // 【onclick 掛在 <td> 而不是 .price-chip 上】
        // 色塊視覺約 32px，整格是 39px。掛在 td 上的話，
        // 手指按到色塊外緣的空白處也算點到，容錯範圍更大 ——
        // 業務是在客戶面前站著點的，別把可點範圍縮到只有色塊。
        //
        // 第二個參數是 GA4 的來源標記，用來分辨「從對照表帶入」與「按中／塑快速鍵」
        const cpcTd = cpcVal
            ? `<td class="price-val cpc" onclick="setDieselPrice(${cpcVal}, 'table_cpc_${item.key}')" title="點擊帶入 ${item.label} 中油價格 $${cpcVal.toFixed(1)}"><span class="price-chip">$${cpcVal.toFixed(1)}</span></td>`
            : `<td>-</td>`;

        const formTd = formVal
            ? `<td class="price-val formosa" onclick="setDieselPrice(${formVal}, 'table_formosa_${item.key}')" title="點擊帶入 ${item.label} 台塑價格 $${formVal.toFixed(1)}"><span class="price-chip">$${formVal.toFixed(1)}</span></td>`
            : `<td>-</td>`;

        html += `
            <tr>
                <td style="text-align: left; padding-left: 12px; font-weight: 500;">${item.label}</td>
                ${cpcTd}
                ${formTd}
            </tr>
        `;
    });

    tableBody.innerHTML = html;
}

/* ===== 快速設定油品單價函數 =====
 * @param {number} price  要帶入的單價
 * @param {string} source GA4 來源標記（quick_cpc / table_cpc_diesel …）
 *                        不傳的話代表是 HTML 裡的靜態預設按鈕
 * ------------------------------------------------------------ */
function setDieselPrice(price, source = 'quick_default') {
    // 震動回饋
    vibrate(10);

    // 設定油品單價欄位的值
    const dieselPriceField = document.getElementById('dieselPrice');
    dieselPriceField.value = price.toFixed(1); // 保留一位小數

    // 記錄最後修改的欄位
    lastModifiedField = 'dieselPrice';
    // 使用者改了內容：若這筆是從歷史套用來的，存檔時要問覆蓋或另存
    if (typeof markGasChanged === 'function') markGasChanged();

    // 更新所有相關計算
    updateCalculations();

    trackGasEvent('fuel_price_selected', { price: price, source: source });
}

/* ===== 鍵盤輸入回寫 =====
 *
 * 【2026/07 階段 4：加油頁改用共用鍵盤】
 * 這裡原本有一整套自有計算機：openCalculator / closeCalculator /
 * calcInput / calcClear / calcBackspace / calcEquals / confirmCalculation
 * 共 7 個函式 147 行，外加 gas.html 的 43 行鍵盤 HTML 與 gas.css 的 18 條樣式。
 *
 * 那套鍵盤把運算式交給 new Function 求值，所以它有運算優先順序；
 * 而共用鍵盤當時沒有 —— 同一個 App 裡有兩台答案不同的計算機
 * （1000+2000×3 在加油頁得 7000、在計算頁得 9000）。
 * 先讓共用鍵盤取得優先順序（見 js/common-keypad.js），
 * 再把這頁遷移過來，兩件事就一起解決了。
 *
 * 現在鍵盤的開啟、按鍵、運算、關閉全部由共用模組負責，
 * 本頁只需要實作這一支「把結果寫回欄位」—— 與計算頁的
 * calc-ui.js 和支票頁的 check-engine.js 是同一個模式。
 *
 * 共用鍵盤把使用者算完的值放在全域 calculatorValue，
 * 要寫入哪個欄位放在 currentInputField（都宣告在 common-keypad.js）。
 * ------------------------------------------------------------ */
function submitCalculatorValue() {
    if (!currentInputField) return;

    let value = parseFloat(calculatorValue);
    if (isNaN(value)) value = 0;

    const field = document.getElementById(currentInputField);
    if (!field) return;

    switch (currentInputField) {
        case 'dieselPrice':
            // 油品單價：不可為負，保留 1 位小數
            // （欄位 id 沿用 dieselPrice，但現在可帶入 92/95/98 汽油價，不限柴油）
            value = Math.max(0, Math.round(value * 10) / 10);
            field.value = value.toFixed(1);
            break;

        case 'discountAmount':
            // 折扣金額：夾在 0～5 元，保留 1 位小數
            // 上限 5 是業務常識 —— 每公升折超過 5 元不可能，
            // 出現那種數字幾乎都是手誤多按一位。
            if (value > 5) showToast('折扣金額上限為 5.0 元/公升', true);
            value = Math.max(0, Math.min(5, Math.round(value * 10) / 10));
            field.value = value.toFixed(1);
            break;

        case 'monthlyExpense':
        case 'monthlyVolume':
            // 每月油錢與油量：正整數 + 千分位
            value = Math.max(0, Math.round(value));
            field.value = formatNumberWithCommas(value);
            break;

        default:
            return;
    }

    // 記錄最後修改的欄位，updateCalculations() 靠它決定推算方向
    lastModifiedField = currentInputField;
    // 使用者改了內容：若這筆是從歷史套用來的，存檔時要問覆蓋或另存
    if (typeof markGasChanged === 'function') markGasChanged();

    closeModal('numberInputModal');
    updateCalculations();
    vibrate(15);
}

/* ===== 更新所有計算函數 =====
 *
 * 【這個函式曾經被定義兩次】
 * 歷史上這支檔案有兩份 updateCalculations()，後定義的那份覆蓋了前一份，
 * 造成兩個沒有任何報錯、但會讓業務拿錯數字的問題：
 *
 *   1. 「每月油量」欄位實質失效。被覆蓋掉的邏輯才有雙向推算，
 *      存活的那份只做「油錢 ÷ 單價 = 油量」單向，
 *      所以業務輸入油量後會被靜默蓋回舊值，或者根本不算。
 *
 *   2. 折扣金額歸 0 時，下方三個結果欄位不會清空，
 *      會停在上一次的數字 —— 在客戶面前很危險。
 *
 *   3. 存活那份還有 `if (monthlyExpense === 0) 欄位 = '0'`，
 *      頁面一載入就把空白的油錢欄位填成 0，placeholder 永遠看不到。
 *
 * 現在只保留這一份。**修改本檔時請不要再新增第二個同名函式**，
 * tests/加油頁功能測試.js 有一項守門測試會檢查定義次數。
 * ------------------------------------------------------------ */
function updateCalculations() {
    // 取得所有輸入值（移除千分位符號）
    const dieselPrice = parseFloat(removeThousandsSeparator(document.getElementById('dieselPrice').value)) || 0;
    let monthlyExpense = parseInt(removeThousandsSeparator(document.getElementById('monthlyExpense').value)) || 0;
    let monthlyVolume = parseInt(removeThousandsSeparator(document.getElementById('monthlyVolume').value)) || 0;
    const discountAmount = parseFloat(removeThousandsSeparator(document.getElementById('discountAmount').value)) || 0;

    // 根據最後修改的欄位決定推算方向（雙向換算的關鍵）
    // 註：lastModifiedField 由各個輸入入口負責設定，
    //     漏設就會往錯的方向算並蓋掉使用者剛輸入的值。
    if (dieselPrice > 0) {
        if (lastModifiedField === 'monthlyVolume' && monthlyVolume > 0) {
            // 剛改的是每月油量 → 反算每月油錢
            // 公式：每月油錢 = 油品單價 × 每月油量
            monthlyExpense = Math.round(dieselPrice * monthlyVolume);
            document.getElementById('monthlyExpense').value = formatNumberWithCommas(monthlyExpense);
        } else if ((lastModifiedField === 'monthlyExpense' || lastModifiedField === 'dieselPrice') && monthlyExpense > 0) {
            // 剛改的是每月油錢或油品單價 → 算每月油量
            // 公式：每月油量 = 每月油錢 ÷ 油品單價
            monthlyVolume = Math.round(monthlyExpense / dieselPrice);
            document.getElementById('monthlyVolume').value = formatNumberWithCommas(monthlyVolume);
        }
    }

    // 計算折後油錢 - 只在折扣金額大於0時才計算
    if (dieselPrice > 0 && monthlyVolume > 0 && discountAmount > 0) {
        // 計算折扣後的油價
        const discountedPrice = Math.max(0, dieselPrice - discountAmount);
        // 計算折後的每月油錢
        const discountedExpense = Math.round(discountedPrice * monthlyVolume);
        document.getElementById('discountedExpense').value = formatNumberWithCommas(discountedExpense);

        // 節省金額一律以「單價 × 油量」為基準重算，不直接讀油錢欄位。
        // 因為業務可能手動輸入一個與單價×油量不一致的油錢
        // （例如把 28,800 手動改成 29,000），
        // 若拿那個值去減折後油錢，節省金額會憑空多出 200 元。
        const currentMonthlyExpense = Math.round(dieselPrice * monthlyVolume);

        // 計算每月節省金額
        const monthlySaving = Math.max(0, currentMonthlyExpense - discountedExpense);
        document.getElementById('monthlySaving').value = formatNumberWithCommas(monthlySaving);

        // 計算每年節省金額（每月節省 × 12個月）
        const yearlySaving = monthlySaving * 12;
        document.getElementById('yearlySaving').value = formatNumberWithCommas(yearlySaving);

        // GA4：只在「從沒有結果變成有結果」的那一刻回報一次。
        // updateCalculations() 幾乎每個操作都會呼叫，
        // 不做這個狀態轉換判斷的話，調一次折扣就送一個事件，又變成雜訊。
        if (!hasResultsShown) {
            hasResultsShown = true;
            trackGasEvent('discount_calculated', {
                diesel_price: dieselPrice,
                discount_amount: discountAmount,
                monthly_volume: monthlyVolume,
                yearly_saving: yearlySaving
            });
        }
    } else {
        // 資料不足或折扣為 0 時必須清空，否則會殘留上一次的計算結果
        document.getElementById('discountedExpense').value = '';
        document.getElementById('monthlySaving').value = '';
        document.getElementById('yearlySaving').value = '';
        hasResultsShown = false;
    }
}

/* ===== 清除計算函數 ===== */
function clearCalculation() {
    vibrate(20); // 較強的震動回饋，表示清除動作
    
    // 定義需要清除的欄位陣列
    const fieldsToClear = ['monthlyExpense', 'monthlyVolume', 'discountAmount', 'discountedExpense', 'monthlySaving', 'yearlySaving'];
    
    // 遍歷並清空每個欄位
    fieldsToClear.forEach(fieldId => {
        const field = document.getElementById(fieldId);
        field.value = '';
    });
    
    // 重置最後修改的欄位記錄
    lastModifiedField = '';

    // 結果區已清空，下次算出結果時要能再回報一次
    hasResultsShown = false;

    // 清除等於重新開始，與原紀錄的關係一併切斷
    if (typeof detachGasFromHistory === 'function') detachGasFromHistory();

    trackGasEvent('calculation_cleared');
}

/* ===== 移除千分位符號函數 ===== */
function removeThousandsSeparator(str) {
    // 移除所有逗號和非數字字符（保留小數點）
    return str.replace(/,/g, '').replace(/[^\d.]/g, '');
}

/* ------------------------------------------------------------
 * 鍵盤副資訊：折後單價（2026/07 新增）
 * ------------------------------------------------------------
 * 單價與折扣是這頁唯二要輸入的小數，而業務真正在意的是兩者相減之後的
 * 「折後單價」。原本要按下確認輸入、回到頁面才看得到，
 * 現在邊按邊顯示在鍵盤上。
 *
 * 兩支都會去讀「另一個欄位」目前的值，讀不到就回傳空字串 ——
 * 副資訊行的高度本來就固定保留，沒有內容也不會讓版面跳動。
 * ------------------------------------------------------------ */

/** 讀取某個欄位目前的數值，取不到回傳 0 */
function readFieldNumber(fieldId) {
    const field = document.getElementById(fieldId);
    if (!field) return 0;
    const value = parseFloat(removeThousandsSeparator(field.value));
    return Number.isFinite(value) ? value : 0;
}

/** 正在輸入油品單價時：顯示扣掉目前折扣後的單價 */
function describeFuelPrice(price) {
    const value = Number(price);
    const discount = readFieldNumber('discountAmount');
    if (!Number.isFinite(value) || value <= 0 || discount <= 0) return '';
    return `折後 ${Math.max(0, value - discount).toFixed(1)} 元/公升`;
}

/** 正在輸入折扣金額時：顯示套用之後的單價 */
function describeDiscount(discount) {
    const value = Number(discount);
    const price = readFieldNumber('dieselPrice');
    if (!Number.isFinite(value) || value <= 0 || price <= 0) return '';
    return `折後 ${Math.max(0, price - value).toFixed(1)} 元/公升`;
}

/* ===== 時間顯示相關函數 - 從支票試算工具複製 ===== */
// 初始化當前時間（民國年）
function updateCurrentDate() {
    const now = new Date();
    const rocYear = now.getFullYear() - 1911;    // 轉換為民國年
    const month = String(now.getMonth() + 1).padStart(2, '0');             // 月份，補零
    const date = String(now.getDate()).padStart(2, '0');                   // 日期，補零
    const days = ['日', '一', '二', '三', '四', '五', '六'];  // 星期陣列
    const day = days[now.getDay()];               // 取得星期
    const hours = String(now.getHours()).padStart(2, '0');     // 小時，補零
    const minutes = String(now.getMinutes()).padStart(2, '0'); // 分鐘，補零
    const seconds = String(now.getSeconds()).padStart(2, '0'); // 秒數，補零
    
    // 組合時間字串
    const timeString = `${rocYear}年${month}月${date}日 星期${day} ${hours}:${minutes}:${seconds}`;
    document.getElementById('current-date').textContent = timeString;
}

/* ===== 時鐘：頁面看不到的時候自動停 =====
 *
 * 【問題】
 * 舊版是 setInterval(updateCurrentDate, 1000)。index.html 切換頁面用的是
 * display:none / block，iframe 並不會被卸載 —— 所以四個頁面的時鐘會同時
 * 在背景空轉，每秒各做一次 Date 運算與 DOM 寫入。業務整天開著這個 App，
 * 那是白燒電池。
 *
 * 【為什麼不用 document.hidden】
 * 那個只反映「整個瀏覽器分頁」是否在前景。iframe 被父頁面 display:none
 * 藏起來時，裡面的 document.hidden 在 Chrome 仍然是 false，判斷不出來。
 *
 * 【改用 requestAnimationFrame 的理由】
 * rAF 的回呼只在瀏覽器「真的要繪製這個文件」時才執行。
 * display:none 的 iframe 不會被繪製，回呼自然完全停止 —— 不需要任何
 * 來自父頁面的通知，也不必改 index.html（那會連帶影響其他三頁）。
 * 分頁被切到背景時 rAF 同樣會停，順便把那個情況也一起解決了。
 *
 * rAF 大約每秒 60 次，但我們只需要每秒更新一次，
 * 所以先比對秒數有沒有變，只有變了才寫 DOM。
 * 一秒 60 次的「讀時間 + 比大小」成本遠低於 1 次 DOM 寫入，
 * 而頁面看不到的時候是 0 次。
 * ------------------------------------------------------------ */
function startClock() {
    // 測試環境或極舊瀏覽器沒有 rAF 時，退回 setInterval
    if (typeof requestAnimationFrame !== 'function') {
        setInterval(updateCurrentDate, 1000);
        return;
    }

    let lastSecond = -1;

    function tick() {
        const second = Math.floor(Date.now() / 1000);
        if (second !== lastSecond) {
            lastSecond = second;
            updateCurrentDate();
        }
        requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
}

/* ===== 每月油錢快速調整功能 =====
 * @param {number} delta - 要調整的金額。按鈕標示的是「萬元」，
 *                         例如 +10 傳進來的是 100000。
 * ------------------------------------------------------------ */
function adjustMonthlyExpense(delta) {
    // 震動反饋
    vibrate(10);
    
    // 取得當前每月油錢欄位
    const expenseField = document.getElementById('monthlyExpense');
    
    // 解析當前值（移除千位分隔符）
    let currentValue = 0;
    if (expenseField.value && expenseField.value.trim() !== '') {
        // 移除所有非數字字符，只保留數字
        const cleanValue = expenseField.value.replace(/[^0-9]/g, '');
        currentValue = parseInt(cleanValue) || 0;
    }
    
    // 計算新值
    // 確保結果為正整數（不能為負數）
    let newValue = currentValue + delta;
    
    // 限制最小值為0
    if (newValue < 0) {
        newValue = 0;
    }
    
    // 確保是整數（移除任何小數部分）
    newValue = Math.floor(newValue);
    
    // 更新欄位值（加入千位分隔符）
    if (newValue === 0) {
        expenseField.value = '0';
    } else {
        expenseField.value = formatNumberWithCommas(newValue);
    }

    // 記錄最後修改的欄位
    // 【這行不能省】updateCalculations() 靠 lastModifiedField 決定推算方向。
    // 漏了它的話，若使用者上一步是輸入「每月油量」，
    // 這裡按下調整鍵後會往「油量 → 油錢」的方向算，
    // 把剛剛調整好的油錢直接蓋掉，畫面上看不出任何異常。
    lastModifiedField = 'monthlyExpense';
    // 使用者改了內容：若這筆是從歷史套用來的，存檔時要問覆蓋或另存
    if (typeof markGasChanged === 'function') markGasChanged();

    // 觸發更新計算
    updateCalculations();
}

/* ===== 格式化數字加入千位分隔符 ===== */
function formatNumberWithCommas(num) {
    // 將數字轉換為帶有千位分隔符的字串
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/* ===== 折扣金額快速調整功能 ===== */
/**
 * 調整折扣金額數值（增加或減少指定金額）
 * @param {number} delta - 要調整的金額（正數為增加，負數為減少）
 */
function adjustDiscountAmount(delta) {
    // 震動回饋
    vibrate(10);
    
    // 取得當前折扣金額欄位
    const discountField = document.getElementById('discountAmount');
    
    // 解析當前值（移除所有非數字字符，保留小數點）
    let currentValue = 0;
    if (discountField.value && discountField.value.trim() !== '') {
        // 移除所有非數字和小數點的字符
        const cleanValue = discountField.value.replace(/[^0-9.]/g, '');
        currentValue = parseFloat(cleanValue) || 0;
    }
    
    // 計算新值
    let newValue = currentValue + delta;
    
    // 限制最小值為0，最大值為5（一般折扣不會超過5元）
    if (newValue < 0) {
        newValue = 0;
    } else if (newValue > 5) {
        newValue = 5;
    }
    
    // 四捨五入到小數點後一位
    newValue = Math.round(newValue * 10) / 10;
    
    // 更新欄位值（保留一位小數）
    discountField.value = newValue.toFixed(1);
    
    // 記錄最後修改的欄位
    lastModifiedField = 'discountAmount';
    // 使用者改了內容：若這筆是從歷史套用來的，存檔時要問覆蓋或另存
    if (typeof markGasChanged === 'function') markGasChanged();
    
    // 觸發更新計算
    updateCalculations();
}

/**
 * 直接設定折扣金額為指定數值
 * @param {number} amount - 要設定的折扣金額
 */
function setDiscountAmount(amount) {
    // 震動回饋
    vibrate(10);
    
    // 取得折扣金額欄位
    const discountField = document.getElementById('discountAmount');
    
    // 確保金額在合理範圍內（0-5元）
    let validAmount = Math.max(0, Math.min(5, amount));
    
    // 四捨五入到小數點後一位
    validAmount = Math.round(validAmount * 10) / 10;
    
    // 設定欄位值（保留一位小數）
    discountField.value = validAmount.toFixed(1);
    
    // 記錄最後修改的欄位
    lastModifiedField = 'discountAmount';
    // 使用者改了內容：若這筆是從歷史套用來的，存檔時要問覆蓋或另存
    if (typeof markGasChanged === 'function') markGasChanged();
    
    // 觸發更新計算
    updateCalculations();
}

/* 註：這裡原本有一支 validateMonthlyExpense()，只被那份重複定義的
 *     updateCalculations() 使用。階段 1-1 刪掉重複函式後它就沒有呼叫者了，
 *     階段 6 一併移除。
 *     現在油錢的驗證由 updateCalculations() 裡的
 *     parseInt(removeThousandsSeparator(...)) || 0 負責，行為等價。 */

/* ============================================================
   存檔與歷史紀錄（2026/07 步驟 4-2 新增）
   ------------------------------------------------------------
   本頁原本完全沒有這一層，是四頁裡唯一沒有的。

   【為什麼加油頁需要歷史】
   油品優惠是公司的獨立產品：有客戶只辦油品不辦貸款，
   也常被拿來當作「利息高」的反制條件。一筆油品試算對業務
   跟一筆貸款試算一樣是有意義的工作紀錄。

   【卡片上顯示什麼】
   每月油錢與折扣金額 —— 這兩項才是業務自己在意、也是他下次
   要回頭調整的數值。每月／每年節省是講給客戶聽的數字，
   套用回表單時會即時重算，不需要佔用卡片版面。
   徽章放油品單價，因為折扣金額脫離單價就看不出划算與否。

   Store、id 生成、寫入失敗提示、排序、筆數上限一律由
   js/common-history.js 負責，與另外三頁同一套。
   ============================================================ */
const gasHistoryStore = createHistoryStore({ key: 'gasHistory', tool: 'gas' });

/* 與歷史紀錄的連結，語意與計算頁、支票頁相同 */
let gasSourceId = null;
let gasHasUnsavedChanges = false;

function markGasChanged() {
    if (gasSourceId !== null) gasHasUnsavedChanges = true;
    updateGasUnsavedHint();
}

function detachGasFromHistory() {
    gasSourceId = null;
    gasHasUnsavedChanges = false;
    updateGasUnsavedHint();
}

function updateGasUnsavedHint() {
    const hint = document.getElementById('unsaved-hint');
    if (!hint) return;
    hint.style.display = (gasSourceId !== null && gasHasUnsavedChanges) ? 'block' : 'none';
}

/**
 * 讀出這一頁真正的「輸入值」
 *
 * 【為什麼只有三個】
 * 這頁畫面上有七個數字，但其中四個是推導出來的：
 *   每月油量   = 每月油錢 ÷ 單價
 *   折後油錢   = （單價 - 折扣）× 油量
 *   每月／每年節省 = 折扣前後的差
 *
 * 一筆紀錄如果同時存輸入值與推導值，等於讓同一件事有兩個真相來源。
 * 兩者一旦對不起來，程式就得決定要相信哪一個 —— 而這頁的油錢與油量
 * 是雙向換算的，方向由 lastModifiedField 決定，設錯就會拿油量去
 * 覆蓋剛還原的油錢，數字被改掉了畫面上還看不出來。
 *
 * 只存輸入值就沒有第二個真相可以打架。真要出錯，也會是
 * 「下面幾格算不出來、整片空白」這種一眼看得見的壞法，
 * 而不是 290,000 悄悄變成 289,987。
 */
function readGasFields() {
    const num = id => {
        const el = document.getElementById(id);
        return el ? parseFloat(removeThousandsSeparator(el.value)) || 0 : 0;
    };
    return {
        dieselPrice: num('dieselPrice'),
        monthlyExpense: num('monthlyExpense'),
        discountAmount: num('discountAmount')
    };
}

/** 推導值：只在需要當下畫面數字時才讀（例如草稿還原後的比對） */
function readGasDerived() {
    const num = id => {
        const el = document.getElementById(id);
        return el ? parseFloat(removeThousandsSeparator(el.value)) || 0 : 0;
    };
    return {
        monthlyVolume: num('monthlyVolume'),
        discountedExpense: num('discountedExpense'),
        monthlySaving: num('monthlySaving'),
        yearlySaving: num('yearlySaving')
    };
}

function saveGasData() {
    vibrate();

    const f = readGasFields();

    /* 存檔前先確認這筆試算是成立的。
       只檢查三個輸入值：折後油錢與節省金額都是推導出來的，
       它們沒算出來一定是上面三個其中之一不成立。 */
    if (!f.dieselPrice || !f.monthlyExpense || !f.discountAmount) {
        showToast('請先完成油品單價、每月油錢與折扣金額', true);
        return;
    }

    if (gasSourceId !== null && gasHasUnsavedChanges) {
        const src = gasHistoryStore.get(gasSourceId);
        if (src) {
            showChoiceModal(
                '內容已變更',
                `這筆資料來自 <b>${escapeHtml(formatSavedAt(src.savedAt) || '先前的紀錄')}</b> 的紀錄，內容已經變更。<br><br>`
                + `原紀錄：每月油錢 ${formatNumberWithCommas(src.data.monthlyExpense)} · 折扣 ${src.data.discountAmount} 元<br>`
                + `目前：每月油錢 ${formatNumberWithCommas(f.monthlyExpense)} · 折扣 ${f.discountAmount} 元`,
                [
                    { label: '覆蓋原紀錄', primary: true, onSelect: () => commitGasData(gasSourceId) },
                    { label: '另存為新紀錄', onSelect: () => commitGasData(null) }
                ]
            );
            return;
        }
        // 原紀錄已被刪除，直接另存
    }

    commitGasData(null);
}

function commitGasData(overwriteId) {
    /* 不自己存日期字串：信封上的 savedAt 已經是完整到秒的時間戳，
       顯示交給共用的 formatSavedAt()。自己再存一份格式化過的日期，
       就是同一件事的第二個真相來源。 */
    const result = gasHistoryStore.save(readGasFields(), { overwriteId: overwriteId });
    if (!result.ok) return;

    trackGasEvent('gas_saved', {
        is_overwrite: result.overwritten,
        history_count: gasHistoryStore.count()
    });

    gasSourceId = result.id;
    gasHasUnsavedChanges = false;
    updateGasUnsavedHint();

    showToast(result.overwritten ? '已覆蓋原紀錄' : '已存檔');
}

function toggleHistoryPanel() {
    vibrate();
    const panel = document.getElementById('historyPanel');
    if (!panel) return;

    if (panel.style.display === 'flex') {
        panel.style.display = 'none';
        // 關掉面板就離開編輯模式，下次打開不會停在選了一半的狀態
        if (typeof isHistoryEditMode === 'function' && isHistoryEditMode()) exitHistoryEditMode();
    } else {
        loadGasHistory();
        panel.style.display = 'flex';
    }
}

function loadGasHistory() {
    const content = document.getElementById('historyContent');
    if (!content) return;

    const list = gasHistoryStore.list();

    if (list.length === 0) {
        content.innerHTML = '<p class="no-data">尚無油資折讓紀錄</p>';
        return;
    }

    let html = '<div class="history-list">';

    list.forEach(rec => {
        const g = rec.data;
        html += `
            <div class="history-item${historyItemClass(rec.id)}" data-gas-id="${rec.id}" data-history-id="${rec.id}">
                <div class="history-item-summary">
                    ${historyCheckboxHtml()}
                    <div class="history-item-header">
                        <div class="history-date">${escapeHtml(formatSavedAt(rec.savedAt))}</div>
                        <div class="history-header-rate">單價 ${g.dieselPrice} 元</div>
                    </div>
                    <div class="history-summary-line">
                        <span class="summary-main">${formatNumberWithCommas(g.monthlyExpense)}</span>
                        <span class="summary-sub">折扣 ${g.discountAmount} 元</span>
                        ${rec.note ? `<span class="summary-note">${escapeHtml(rec.note)}</span>` : ''}
                    </div>
                </div>

                <div class="history-item-detail">
                    <!-- 只放這兩個數字：折扣金額是業務真正在意的，
                         每月油錢是在還沒寫備註時用來認出「這是哪個客戶」。
                         油量與折後金額都是推導值，套用回表單就會即時算出來。 -->
                    <div class="history-details">
                        <div class="history-detail-item">
                            <span class="detail-label">每月油錢</span>
                            <span class="detail-value">${formatNumberWithCommas(g.monthlyExpense)}</span>
                        </div>
                        <div class="history-detail-item">
                            <span class="detail-label">折扣金額</span>
                            <span class="detail-value">${g.discountAmount} 元</span>
                        </div>
                    </div>

                    <div class="history-note-container">
                        <div class="history-item-footer">
                            <div class="history-note-preview ${rec.note ? '' : 'empty-note'}" onclick="openNoteEditor(${rec.id})">
                                ${rec.note ? escapeHtml(rec.note) : '點擊添加備註'}
                            </div>
                            <div class="history-actions">
                                <button class="detail-btn" onclick="loadGasToForm(${rec.id})">套用</button>
                                <button class="delete-btn" onclick="deleteGasHistoryItem(${rec.id})">刪除</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>`;
    });

    html += '</div>';
    content.innerHTML = html;

    // 展開／收合與編輯模式的多選都由共用程式處理（同一容器只綁一次）
    setupHistoryPanel({
        panelId: 'historyPanel',
        containerId: 'historyContent',
        store: gasHistoryStore,
        onChange: loadGasHistory,
        onDeleted: function (ids) {
            ids.forEach(id => {
                if (String(gasSourceId) === String(id)) detachGasFromHistory();
            });
        }
    });
}

function loadGasToForm(id) {
    vibrate();

    const rec = gasHistoryStore.get(id);
    if (!rec) {
        showToast('找不到這筆紀錄', true);
        return;
    }
    const g = rec.data;

    const set = (fieldId, v) => {
        const el = document.getElementById(fieldId);
        if (el) el.value = v;
    };

    set('dieselPrice', Number(g.dieselPrice).toFixed(1));
    set('monthlyExpense', formatNumberWithCommas(g.monthlyExpense));
    set('discountAmount', Number(g.discountAmount).toFixed(1));
    // 油量不還原：它是推導值，下面 updateCalculations() 會從油錢與單價算出來
    set('monthlyVolume', '');

    /* 讓引擎自己把折後油錢與節省金額重算一次，不直接塞存檔時的值 ——
       油價是每週更新的，重算才會反映使用者現在看到的條件。
       lastModifiedField 指定為每月油錢，推算方向才會是「油錢 → 油量」。 */
    lastModifiedField = 'monthlyExpense';
    updateCalculations();

    // 順序：重算會經過 markGasChanged()，所以連結要在重算之後才建立
    gasSourceId = id;
    gasHasUnsavedChanges = false;
    updateGasUnsavedHint();

    const panel = document.getElementById('historyPanel');
    if (panel) panel.style.display = 'none';

    trackGasEvent('gas_history_loaded');
    showToast('已套用');
}

function deleteGasHistoryItem(id) {
    vibrate();

    const rec = gasHistoryStore.get(id);
    const summary = rec
        ? `每月油錢 ${formatNumberWithCommas(rec.data.monthlyExpense)} · 折扣 ${rec.data.discountAmount} 元<br><br>`
        : '';

    showConfirmModal('刪除確認', `確定要刪除這筆紀錄嗎？<br><br>${summary}此操作無法復原。`, function () {
        if (!gasHistoryStore.remove(id)) return;
        forgetHistoryExpanded(id);
        if (gasSourceId === id) detachGasFromHistory();
        loadGasHistory();
        showToast('已刪除');
    });
}

/* confirmDeleteAll() 已於 2026/07 步驟 5 移除：
 * 功能由編輯模式的「全選 → 刪除」取代，而且更安全。 */

function openNoteEditor(id) {
    vibrate();
    const rec = gasHistoryStore.get(id);
    if (!rec) return;

    showNoteEditor({
        title: '備註編輯',
        note: rec.note || '',
        onSave: function (text) {
            if (!gasHistoryStore.setNote(id, text)) return;
            loadGasHistory();
            showToast('備註已儲存');
        }
    });
}

/* ------------------------------------------------------------
   自動暫存（24 小時），與另外三頁同一個定位：
   這是「意外遺失的防護網」，真正要留的請按存檔。
   ------------------------------------------------------------ */
const GAS_DRAFT_KEY = 'gasCalculatorDraft';
const GAS_DRAFT_MAX_HOURS = 24;

function saveGasDraft() {
    try {
        const f = readGasFields();
        if (!f.dieselPrice && !f.monthlyExpense && !f.discountAmount) {
            localStorage.removeItem(GAS_DRAFT_KEY);
            return;
        }
        f.savedAt = new Date().toISOString();
        f.gasSourceId = gasSourceId;
        f.gasHasUnsavedChanges = gasHasUnsavedChanges;
        localStorage.setItem(GAS_DRAFT_KEY, JSON.stringify(f));
    } catch (e) { /* 暫存失敗不影響任何功能，安靜略過 */ }
}

function restoreGasDraft() {
    let d;
    try {
        const raw = localStorage.getItem(GAS_DRAFT_KEY);
        if (!raw) return false;
        d = JSON.parse(raw);
    } catch (e) {
        try { localStorage.removeItem(GAS_DRAFT_KEY); } catch (e2) {}
        return false;
    }

    const hours = (new Date() - new Date(d.savedAt)) / 3600000;
    if (!isFinite(hours) || hours >= GAS_DRAFT_MAX_HOURS) {
        try { localStorage.removeItem(GAS_DRAFT_KEY); } catch (e) {}
        return false;
    }

    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    if (d.dieselPrice) set('dieselPrice', Number(d.dieselPrice).toFixed(1));
    if (d.monthlyExpense) set('monthlyExpense', formatNumberWithCommas(d.monthlyExpense));
    if (d.monthlyVolume) set('monthlyVolume', formatNumberWithCommas(d.monthlyVolume));
    if (d.discountAmount) set('discountAmount', Number(d.discountAmount).toFixed(1));

    lastModifiedField = 'monthlyExpense';
    updateCalculations();

    gasSourceId = (d.gasSourceId === undefined) ? null : d.gasSourceId;
    gasHasUnsavedChanges = d.gasHasUnsavedChanges === true;
    updateGasUnsavedHint();
    return true;
}

/* 切到背景前把現況寫進暫存 —— 這是最容易被系統回收的時機 */
document.addEventListener('visibilitychange', function () {
    if (document.hidden) saveGasDraft();
});
