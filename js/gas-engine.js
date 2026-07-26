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

/* ===== 全域變數 ===== */
let currentInput = ''; // 當前輸入的欄位ID
let calcExpression = ''; // 計算機運算式
let lastResult = '0'; // 上次計算結果
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

/* ===== 震動回饋函數 ===== */
function vibrate(duration = 10) {
    // 檢查瀏覽器是否支援震動 API
    if ('vibrate' in navigator) {
        navigator.vibrate(duration);
    }
}

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
    // 為可編輯的輸入框添加點擊事件
    // 這四個欄位可以點擊開啟計算機介面
    const editableFields = ['dieselPrice', 'monthlyExpense', 'monthlyVolume', 'discountAmount'];
    editableFields.forEach(fieldId => {
        const field = document.getElementById(fieldId);
        field.addEventListener('click', function() {
            openCalculator(fieldId); // 開啟計算機並傳入欄位ID
        });
    });
    
    // 點擊計算機外部區域（遮罩層）關閉計算機
    document.getElementById('calculatorModal').addEventListener('click', function(e) {
        if (e.target === this) {
            closeCalculator();
        }
    });

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
        fuelPricesData = {
            updatedDateStr: '即時數據',
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
    const footnote = document.getElementById('tableFootnote');
    if (footnote && data.updatedDateStr) {
        footnote.textContent = `* 最後更新時間：${data.updatedDateStr}`;
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

        // 第二個參數是 GA4 的來源標記，用來分辨「從對照表帶入」與「按中/塑快速鍵」
        const cpcTd = cpcVal
            ? `<td class="price-val cpc" onclick="setDieselPrice(${cpcVal}, 'table_cpc_${item.key}')" title="點擊帶入 ${item.label} 中油價格 $${cpcVal.toFixed(1)}">$${cpcVal.toFixed(1)}</td>`
            : `<td>-</td>`;

        const formTd = formVal
            ? `<td class="price-val formosa" onclick="setDieselPrice(${formVal}, 'table_formosa_${item.key}')" title="點擊帶入 ${item.label} 台塑價格 $${formVal.toFixed(1)}">$${formVal.toFixed(1)}</td>`
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

    // 更新所有相關計算
    updateCalculations();

    trackGasEvent('fuel_price_selected', { price: price, source: source });
}

/* ===== 開啟計算機函數 ===== */
function openCalculator(inputId) {
    vibrate(); // 添加震動回饋
    currentInput = inputId; // 記錄當前操作的輸入框ID
    const modal = document.getElementById('calculatorModal');
    const display = document.getElementById('calcDisplay');
    
    // 取得當前輸入框的值（移除千分位符號）
    const fieldValue = document.getElementById(inputId).value;
    let currentValue = removeThousandsSeparator(fieldValue);
    
    // 如果欄位是空的或為0，設定為0
    if (!currentValue || currentValue === '0') {
        calcExpression = '0';
    } else {
        // 根據不同輸入框設定初始值
        if (inputId === 'dieselPrice' || inputId === 'discountAmount') {
            // 保留小數（超級柴油和折扣金額）
            calcExpression = parseFloat(currentValue).toString();
        } else {
            // 只取整數（每月油錢和每月油量）
            calcExpression = parseInt(currentValue).toString();
        }
    }
    
    display.textContent = calcExpression;
    modal.classList.add('active'); // 顯示計算機視窗
}

/* ===== 關閉計算機函數 ===== */
function closeCalculator() {
    vibrate(10); // 震動回饋
    const modal = document.getElementById('calculatorModal');
    modal.classList.remove('active');
    calcExpression = '';
    currentInput = '';
}

/* ===== 計算機輸入函數 ===== */
function calcInput(value) {
    vibrate(5); // 輕微震動回饋
    
    // 如果當前顯示為0且輸入不是小數點，則替換而不是追加
    if (calcExpression === '0' && value !== '.') {
        calcExpression = value;
    } else {
        // 防止連續輸入運算符
        const lastChar = calcExpression.slice(-1);
        const operators = ['+', '-', '*', '/'];
        
        // 如果連續輸入運算符，不執行任何動作
        if (operators.includes(value) && operators.includes(lastChar)) {
            return;
        }
        
        // 處理小數點輸入
        if (value === '.') {
            // 將運算式按運算符分割，取最後一部分
            const parts = calcExpression.split(/[\+\-\*\/]/);
            const currentPart = parts[parts.length - 1];
            // 如果當前部分已包含小數點，不再添加
            if (currentPart.includes('.')) {
                return;
            }
            // 如果當前部分為空或最後是運算符，自動補0
            if (currentPart === '' || operators.includes(lastChar)) {
                calcExpression += '0';
            }
        }
        
        calcExpression += value;
    }
    
    // 更新計算機顯示
    document.getElementById('calcDisplay').textContent = calcExpression;
}

/* ===== 計算機清除函數 ===== */
function calcClear() {
    vibrate(10); // 震動回饋
    calcExpression = '0';
    document.getElementById('calcDisplay').textContent = '0';
}

/* ===== 計算機退格函數 ===== */
function calcBackspace() {
    vibrate(5); // 輕微震動回饋
    if (calcExpression.length > 1) {
        calcExpression = calcExpression.slice(0, -1);
    } else {
        calcExpression = '0';
    }
    document.getElementById('calcDisplay').textContent = calcExpression;
}

/* ===== 計算機等於函數 ===== */
function calcEquals() {
    vibrate(10); // 震動回饋
    try {
        // 使用 Function 建立安全的計算環境
        const result = new Function('return ' + calcExpression)();
        lastResult = result.toString();
        calcExpression = lastResult;
        document.getElementById('calcDisplay').textContent = lastResult;
    } catch (e) {
        document.getElementById('calcDisplay').textContent = '錯誤';
        calcExpression = '0';
    }
}

/* ===== 確認計算結果函數 ===== */
function confirmCalculation() {
    vibrate(15); // 較強的震動回饋，表示確認動作
    try {
        // 如果沒有輸入任何內容，使用0
        if (!calcExpression || calcExpression === '') {
            calcExpression = '0';
        }
        
        // 計算最終結果
        let result;
        try {
            // 使用 Function 建立安全的計算環境
            result = new Function('return ' + calcExpression)();
        } catch (e) {
            // 如果計算失敗，直接使用當前顯示的值
            result = parseFloat(calcExpression) || 0;
        }
        
        // 根據不同輸入框處理結果
        const field = document.getElementById(currentInput);
        
        if (currentInput === 'dieselPrice') {
            // 超級柴油：限制為正數，保留1位小數
            result = Math.max(0, result);
            result = Math.round(result * 10) / 10;
            field.value = result.toFixed(1);
        } else if (currentInput === 'discountAmount') {
            // 折扣金額：0-5之間，保留1位小數
            result = Math.max(0, Math.min(5, result));
            result = Math.round(result * 10) / 10;
            field.value = result.toFixed(1);
        } else if (currentInput === 'monthlyExpense' || currentInput === 'monthlyVolume') {
            // 每月油錢和油量：正整數，添加千分位符號
            result = Math.max(0, Math.round(result));
            field.value = formatNumberWithCommas(result);
        }
        
        // 記錄最後修改的欄位
        lastModifiedField = currentInput;
        
        // 關閉計算機並更新所有相關計算
        closeCalculator();
        updateCalculations();
    } catch (e) {
        alert('計算錯誤，請重新輸入');
        console.error('計算錯誤:', e);
    }
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

    trackGasEvent('calculation_cleared');
}

/* ===== 移除千分位符號函數 ===== */
function removeThousandsSeparator(str) {
    // 移除所有逗號和非數字字符（保留小數點）
    return str.replace(/,/g, '').replace(/[^\d.]/g, '');
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
    
    // 觸發更新計算
    updateCalculations();
}

/* ===== 驗證並格式化每月油錢輸入 =====
 * 【目前沒有任何呼叫者】
 * 原本只被那份重複定義的 updateCalculations() 使用，
 * 階段 1-1 把重複的函式刪掉之後，這裡就變成孤兒了。
 * 沒有立刻刪除是為了讓階段 1 的改動範圍只限於 bug 修復，
 * 已登記在「修改計劃-加油頁.md」的階段 6（死碼清理）。
 * 若要新增油錢輸入驗證，請先確認是否該沿用這支而不是再寫一份。
 * ------------------------------------------------------------ */
function validateMonthlyExpense(value) {
    // 移除所有非數字字符
    let cleanValue = String(value).replace(/[^0-9]/g, '');
    
    // 轉換為數字
    let numValue = parseInt(cleanValue) || 0;
    
    // 確保為正整數（最小值為0）
    numValue = Math.max(0, Math.floor(numValue));
    
    return numValue;
}
