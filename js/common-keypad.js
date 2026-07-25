/**
 * 重車貸款業務工具箱 - 共用數字鍵盤與彈窗邏輯 (common-keypad.js)
 * ============================================================
 * 【2026/07 新增 — 修正 B1】
 *
 * 為什麼要有這個檔案：
 *   common-modals.js 只抽出了共用的「HTML」，卻沒有抽出共用的「JS 邏輯」。
 *   結果 calc-ui.js（計算頁）與 check-engine.js（支票頁）各自維護了一份
 *   幾乎逐字相同的鍵盤、Toast、彈窗程式碼，約 200 行。
 *
 *   這正是 A4 那個 bug 的成因：計算頁後來新增了 calculatorDecimal()，
 *   支票頁沒有同步，但兩頁共用的鍵盤 HTML 已經在呼叫它了 ——
 *   在支票頁按小數點會直接丟 ReferenceError。
 *   只要重複的程式碼還在，同樣的分岔遲早會再發生一次。
 *
 * 合併原則（重要，之後維護請遵守）：
 *   兩份實作的差異全部只是「防呆寫法」而非邏輯：
 *     - calc-ui.js 直接 document.getElementById(x).value = ...
 *     - check-engine.js 會先判斷元素存在
 *   一律採用「有防呆」的那一版，對兩頁都只會更安全，不會改變行為。
 *
 *   唯一一處真正的行為差異：
 *     openCalculator() 在計算頁會重設 historyScrollIndicator 的透明度，
 *     支票頁漏了。合併後兩頁都會重設（補上支票頁原本缺的行為）。
 *
 * 這個檔案「不」包含的東西（各頁邏輯本來就不同，刻意保留在各自檔案）：
 *   - submitCalculatorValue()  各欄位的驗證規則完全不同
 *   - toggleHistoryPanel()     載入的資料來源不同
 *   - 備註編輯彈窗              兩頁的彈窗結構不同（待 B3 統一）
 *
 * 載入順序：
 *   必須排在 calc-ui.js / check-engine.js「之前」。
 *   原因是這裡用 let 宣告共用狀態，而 let 在同一個全域語彙環境中
 *   重複宣告會直接丟 SyntaxError，所以那兩個檔案裡的同名宣告已一併移除。
 * ============================================================
 */

/* ------------------------------------------------------------
 * 共用狀態（數字鍵盤）
 * ------------------------------------------------------------ */
let currentInputField = null;              // 目前正在輸入哪一個欄位
let calculatorValue = "0";                 // 顯示區當前數值
let calculatorOperator = null;             // 待執行的運算子
let calculatorFirstValue = null;           // 運算子左側的值
let calculatorWaitingForSecondValue = false;
let calculatorHistory = "";                // 顯示在上方的算式歷程

/* ------------------------------------------------------------
 * 觸覺回饋
 * ------------------------------------------------------------ */
function vibrate() {
    if (navigator.vibrate) {
        navigator.vibrate(30);
    }
}

/* ------------------------------------------------------------
 * 彈窗開關
 * ------------------------------------------------------------ */
function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.style.display = 'none';
    vibrate();
}

function showModal(title, content) {
    const titleEl = document.getElementById('modalTitle');
    if (titleEl) titleEl.textContent = title || '提示';
    const contentEl = document.getElementById('modalContent');
    if (contentEl) contentEl.innerHTML = content;
    const overlay = document.getElementById('modalOverlay');
    if (overlay) overlay.style.display = 'flex';
}

function hideModal() {
    const overlay = document.getElementById('modalOverlay');
    if (overlay) overlay.style.display = 'none';
}

/**
 * 確認彈窗
 *
 * 註：舊版計算頁用 cloneNode 換掉整顆按鈕來清除舊的監聽器，
 * 支票頁則是直接指定 onclick。兩者效果相同（每次呼叫都會取代前一個處理器），
 * 這裡採用 onclick 版本 —— 不動 DOM 結構，比較不會有副作用。
 */
function showConfirmModal(title, content, onConfirm) {
    const titleEl = document.getElementById('confirmModalTitle');
    if (titleEl) titleEl.textContent = title || '確認';

    const contentEl = document.getElementById('confirmModalContent');
    if (contentEl) contentEl.innerHTML = content;

    const okBtn = document.getElementById('confirmModalOk');
    if (okBtn) {
        okBtn.onclick = function () {
            hideConfirmModal();
            if (typeof onConfirm === 'function') onConfirm();
        };
    }

    const overlay = document.getElementById('confirmModalOverlay');
    if (overlay) overlay.style.display = 'flex';
}

function hideConfirmModal() {
    const overlay = document.getElementById('confirmModalOverlay');
    if (overlay) overlay.style.display = 'none';
}

/**
 * 浮動提示訊息
 *
 * 沿用 .toast-message / .toast-error（CSS 實際存在的類別名稱），
 * 每次建立新元素、時間到就從畫面移除，確保一定會消失。
 */
function showToast(message, isError = false, duration = 2000) {
    // 先移除仍在畫面上的舊提示，避免多則訊息互相重疊
    const existing = document.querySelector('.toast-message');
    if (existing && existing.parentNode) {
        existing.parentNode.removeChild(existing);
    }

    const toast = document.createElement('div');
    toast.className = 'toast-message';
    if (isError) toast.classList.add('toast-error');
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        // 淡出動畫結束後，把元素真正從畫面上移除
        setTimeout(() => {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 500);
    }, duration);
}

/* ------------------------------------------------------------
 * 數字鍵盤
 * ------------------------------------------------------------ */

/**
 * 喚起數字輸入器
 * @param {string} targetId 要填入的欄位 id
 * @param {string} title    彈窗標題
 */
function openCalculator(targetId, title) {
    currentInputField = targetId;

    const titleEl = document.getElementById('inputModalTitle');
    if (titleEl) titleEl.textContent = title;

    // 帶入欄位現值當作起始值（去掉千分位逗號）
    const inputEl = document.getElementById(targetId);
    const currentValue = inputEl ? inputEl.value : '';
    calculatorValue = (currentValue && currentValue !== '') ? currentValue.replace(/,/g, '') : "0";

    const display = document.getElementById('calculatorDisplay');
    if (display) display.textContent = calculatorValue;

    calculatorOperator = null;
    calculatorFirstValue = null;
    calculatorWaitingForSecondValue = false;
    calculatorHistory = "";

    const historyEl = document.getElementById('calculatorHistory');
    if (historyEl) historyEl.textContent = "";

    // 支票頁舊版漏了這一行，導致上一次的算式捲動提示會殘留
    const indicator = document.getElementById('historyScrollIndicator');
    if (indicator) indicator.style.opacity = '0';

    const modal = document.getElementById('numberInputModal');
    if (modal) modal.style.display = 'flex';

    vibrate();
}

function calculatorInput(num) {
    if (calculatorWaitingForSecondValue) {
        calculatorValue = num.toString();
        calculatorWaitingForSecondValue = false;
    } else {
        calculatorValue = calculatorValue === '0' ? num.toString() : calculatorValue + num.toString();
    }
    const display = document.getElementById('calculatorDisplay');
    if (display) display.textContent = calculatorValue;
    vibrate();
}

/**
 * 小數點
 *
 * 註：支票頁三個欄位都是整數，已透過 window.KEYPAD_OPTIONS = { decimal: false }
 * 把這顆鍵隱藏起來（見 common-modals.js）。函式本身仍然保留在共用模組裡，
 * 這樣就不會再出現「HTML 呼叫得到、JS 卻沒定義」的情況。
 */
function calculatorDecimal() {
    if (calculatorWaitingForSecondValue) {
        calculatorValue = '0';
        calculatorWaitingForSecondValue = false;
    }
    if (!calculatorValue.includes('.')) {
        calculatorValue += '.';
    }
    const display = document.getElementById('calculatorDisplay');
    if (display) display.textContent = calculatorValue;
    vibrate();
}

function calculatorClear() {
    calculatorValue = '0';
    calculatorOperator = null;
    calculatorFirstValue = null;
    calculatorWaitingForSecondValue = false;
    calculatorHistory = "";

    const display = document.getElementById('calculatorDisplay');
    if (display) display.textContent = calculatorValue;
    const history = document.getElementById('calculatorHistory');
    if (history) history.textContent = "";
    const indicator = document.getElementById('historyScrollIndicator');
    if (indicator) indicator.style.opacity = '0';

    vibrate();
}

function calculatorBackspace() {
    if (calculatorValue.length > 1) {
        calculatorValue = calculatorValue.slice(0, -1);
    } else {
        calculatorValue = '0';
    }
    const display = document.getElementById('calculatorDisplay');
    if (display) display.textContent = calculatorValue;
    vibrate();
}

function calculatorOperation(op) {
    // 連續輸入運算子時，先把前一段算完
    if (calculatorFirstValue !== null && calculatorOperator !== null) {
        calculatorEquals();
    }

    calculatorFirstValue = parseFloat(calculatorValue);
    calculatorOperator = op;
    calculatorWaitingForSecondValue = true;

    let opSymbol = op;
    switch (op) {
        case '+': opSymbol = ' + '; break;
        case '-': opSymbol = ' - '; break;
        case '*': opSymbol = ' × '; break;
        case '/': opSymbol = ' ÷ '; break;
    }

    if (calculatorHistory === "") {
        calculatorHistory = calculatorValue + opSymbol;
    } else {
        // 算式太長就換行，避免橫向撐破顯示區
        calculatorHistory += (calculatorHistory.length > 20 ? "\n" : "") + calculatorValue + opSymbol;
    }

    updateCalculatorHistory();
    vibrate();
}

function calculatorEquals() {
    if (calculatorFirstValue === null || calculatorOperator === null) return;

    const secondValue = parseFloat(calculatorValue);
    const completeExpression = calculatorHistory + calculatorValue + " = ";
    let result;

    switch (calculatorOperator) {
        case '+': result = calculatorFirstValue + secondValue; break;
        case '-': result = calculatorFirstValue - secondValue; break;
        case '*': result = calculatorFirstValue * secondValue; break;
        case '/':
            if (secondValue === 0) {
                showToast('錯誤：不能除以零', true);
                calculatorClear();
                return;
            }
            result = calculatorFirstValue / secondValue;
            break;
        default: return;
    }

    calculatorValue = result.toString();
    if (calculatorValue.includes('.')) {
        // 去掉浮點運算的尾數雜訊（例如 0.1+0.2 = 0.30000000000000004）
        calculatorValue = parseFloat(result.toFixed(8)).toString();
    }

    const display = document.getElementById('calculatorDisplay');
    if (display) display.textContent = calculatorValue;

    calculatorHistory = completeExpression.length > 30 ? calculatorValue : completeExpression;
    updateCalculatorHistory();

    calculatorOperator = null;
    calculatorFirstValue = parseFloat(calculatorValue);
    calculatorWaitingForSecondValue = true;
    vibrate();
}

function updateCalculatorHistory() {
    const historyElement = document.getElementById('calculatorHistory');
    if (!historyElement) return;

    historyElement.textContent = calculatorHistory;

    const isOverflowing = historyElement.scrollWidth > historyElement.clientWidth ||
                        historyElement.scrollHeight > historyElement.clientHeight;
    if (isOverflowing) {
        historyElement.classList.add('has-overflow');
    } else {
        historyElement.classList.remove('has-overflow');
    }
}
