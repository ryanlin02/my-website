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
let calculatorWaitingForSecondValue = false;
let calculatorHistory = "";                // 顯示在上方的算式歷程

/* ------------------------------------------------------------
 * 運算式（支援先乘除後加減）
 * ------------------------------------------------------------
 * 【2026/07 修正：這台計算機原本沒有運算優先順序】
 *
 * 舊版用「兩個運算元 + 一個待執行運算子」的累加器模型：
 * 每按一次運算子就先把前一段算完。所以打 1000+2000×3 會變成
 * (1000+2000)×3 = 9000，而正確答案是 1000+(2000×3) = 7000。
 *
 * 這不會報錯，只會安靜給出錯誤金額 —— 而這台鍵盤負責輸入的是
 * 貸款本金與支票金額。加油頁自己那台鍵盤反而是數學正確的
 * （它把運算式交給 new Function 求值），等於同一個 App 裡有兩台
 * 答案不同的計算機。
 *
 * 現在改成保留完整的 token 序列，按下「=」時才依優先順序求值。
 *
 * 【顯示行為的連帶變化】
 * 舊版按下運算子會立刻算出中間結果並顯示。現在若前一個運算子的
 * 優先順序較低（例如 + 之後按 ×），無法先算，所以顯示區會維持
 * 剛輸入的數字不變 —— 這與一般工程計算機一致，而且上方的算式
 * 歷程本來就會完整顯示 1000 + 2000 × ，看得出來還沒算完。
 * ------------------------------------------------------------ */
let calculatorTokens = [];                 // 例：[1000, '+', 2000, '*']

/* ------------------------------------------------------------
 * 觸覺回饋
 * ------------------------------------------------------------ */
/**
 * 觸覺回饋
 *
 * @param {number} duration 震動毫秒數。預設 30 是鍵盤按鍵的手感，
 *                          計算頁與支票頁的所有呼叫都不帶參數。
 *
 * 【為什麼要可帶參數】
 * 加油頁原本自己有一支 vibrate(duration = 10)，用 5／10／15／20 毫秒
 * 區分「輕按數字」「切換欄位」「確認」「清除」四種力道。
 * 它改用共用鍵盤後兩支同名函式會互相覆蓋（後載入的贏），
 * 而 gas-engine.js 載在後面，等於會把鍵盤的手感偷偷改成 10 毫秒。
 * 讓這支接受參數，兩邊的手感就都能保留，也不需要同名函式打架。
 */
function vibrate(duration = 30) {
    if (navigator.vibrate) {
        navigator.vibrate(duration);
    }
}

/**
 * 把使用者輸入的文字轉成可安全塞進 HTML 的字串
 *
 * 歷史記錄的備註是唯一由使用者自由輸入的內容，過去直接用樣板字串
 * 拼進 innerHTML，備註只要含有 < 或引號就會破版。
 */
function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
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
 * 多選項對話框
 *
 * 【2026/07 新增】既有的 showConfirmModal 只有「確定／取消」兩個按鈕，
 * 但「這筆資料已變更，要覆蓋原紀錄還是另存新紀錄？」需要三個選項。
 *
 * @param {string} title
 * @param {string} content              可含 HTML
 * @param {Array}  choices              [{ label, primary, onSelect }]
 *                                      primary 為 true 者套用主要按鈕樣式
 */
function showChoiceModal(title, content, choices) {
    closeChoiceModal();

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'choiceModalOverlay';

    const buttons = (choices || []).map((choice, index) =>
        `<button type="button" class="modal-btn ${choice.primary ? 'modal-btn-primary' : 'modal-btn-secondary'}" data-index="${index}">${choice.label}</button>`
    ).join('');

    overlay.innerHTML = `
        <div class="modal-container">
            <div class="modal-header">
                <h3>${title || '請選擇'}</h3>
                <button class="close-btn" type="button" data-role="close">×</button>
            </div>
            <div class="modal-content">${content || ''}</div>
            <div class="modal-footer choice-modal-footer">${buttons}</div>
        </div>
    `;

    document.body.appendChild(overlay);
    overlay.style.display = 'flex';

    overlay.querySelectorAll('[data-index]').forEach(button => {
        button.addEventListener('click', function () {
            const choice = choices[Number(button.getAttribute('data-index'))];
            closeChoiceModal();
            if (choice && typeof choice.onSelect === 'function') choice.onSelect();
        });
    });

    const close = () => closeChoiceModal();
    overlay.querySelector('[data-role="close"]').addEventListener('click', close);
    overlay.addEventListener('click', function (event) {
        if (event.target === overlay) close();
    });

    vibrate();
}

function closeChoiceModal() {
    const existing = document.getElementById('choiceModalOverlay');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
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

    calculatorTokens = [];
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
 * 整數加速鍵（00 / 000 / 萬）
 *
 * 由 window.KEYPAD_OPTIONS.accelerators 決定要顯示哪幾顆（見 common-modals.js）。
 *
 * 【為什麼不直接用 calculatorInput('00')】
 * calculatorInput 對 '0' 的處理是「取代」而不是「附加」，
 * 傳入多位數會得到 '00' 這種值。而且值還是 0 的時候按 00 沒有意義 ——
 * 業務要的是「在已經打好的數字後面補零」，不是產生一串零。
 *
 * @param {string} digits 要附加的零，例如 '00'、'000'、'0000'
 */
function calculatorAppend(digits) {
    if (calculatorWaitingForSecondValue) {
        calculatorValue = '0';
        calculatorWaitingForSecondValue = false;
    }

    // 目前還是 0 就不動作：按 00 得到 000 只會讓人以為壞了
    if (calculatorValue !== '0') {
        calculatorValue += digits;
        const display = document.getElementById('calculatorDisplay');
        if (display) display.textContent = calculatorValue;
    }

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
    calculatorTokens = [];
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

/**
 * 依優先順序求值：先做完所有乘除，再做加減。
 *
 * 刻意不使用 eval 或 new Function —— 那會把使用者輸入當程式碼執行。
 * 這裡的 token 全部來自鍵盤按鍵，本來就受控，但用純資料的方式求值
 * 就完全不需要依賴這件事，也不會被 CSP 擋。
 *
 * @param  {Array} tokens 數字與運算子交錯的序列，例：[1000, '+', 2000, '*', 3]
 * @return {number|null}  求值結果；遇到除以零回傳 null
 */
function evaluateTokens(tokens) {
    if (!tokens.length) return null;

    // 第一輪：把乘除收掉
    const reduced = [tokens[0]];
    for (let i = 1; i < tokens.length; i += 2) {
        const op = tokens[i];
        const rhs = tokens[i + 1];
        if (rhs === undefined) break;

        if (op === '*') {
            reduced[reduced.length - 1] = reduced[reduced.length - 1] * rhs;
        } else if (op === '/') {
            if (rhs === 0) return null;
            reduced[reduced.length - 1] = reduced[reduced.length - 1] / rhs;
        } else {
            reduced.push(op, rhs);
        }
    }

    // 第二輪：剩下的加減從左到右
    let result = reduced[0];
    for (let i = 1; i < reduced.length; i += 2) {
        const op = reduced[i];
        const rhs = reduced[i + 1];
        if (rhs === undefined) break;
        result = op === '+' ? result + rhs : result - rhs;
    }
    return result;
}

/** 把浮點運算的尾數雜訊修掉（例如 0.1+0.2 = 0.30000000000000004） */
function trimFloatNoise(num) {
    const s = num.toString();
    return s.includes('.') ? parseFloat(num.toFixed(8)).toString() : s;
}

const OP_SYMBOL = { '+': ' + ', '-': ' - ', '*': ' × ', '/': ' ÷ ' };

function calculatorOperation(op) {
    // 連按運算子時只換掉最後那一個，不把上一段提前算掉
    if (calculatorWaitingForSecondValue && calculatorTokens.length) {
        calculatorTokens[calculatorTokens.length - 1] = op;
        calculatorHistory = calculatorHistory.replace(/ [+\-×÷] $/, OP_SYMBOL[op]);
        updateCalculatorHistory();
        vibrate();
        return;
    }

    calculatorTokens.push(parseFloat(calculatorValue));

    /* ------------------------------------------------------------
     * 顯示區要盡量顯示中間結果，但只能算「這個運算子允許先算」的部分。
     *
     *   按下 + 或 −（優先順序最低）→ 前面整串都可以先算完
     *       1 + 2 +   顯示 3
     *
     *   按下 × 或 ÷ → 只能把結尾那一段連續的乘除收掉
     *       2 × 3 ×   顯示 6      （可以先算）
     *       1 + 2 ×   顯示 2      （不能先算，否則就變成 (1+2)×）
     *
     * 這與一般工程計算機的行為一致，也讓 token 串維持很短。
     * ------------------------------------------------------------ */
    if (op === '+' || op === '-') {
        const whole = evaluateTokens(calculatorTokens);
        if (whole === null || !isFinite(whole)) {
            showToast('錯誤：不能除以零', true);
            calculatorClear();
            return;
        }
        calculatorTokens = [whole];
        calculatorValue = trimFloatNoise(whole);
    } else {
        // 找出最後一個加減，它之後就是一段純乘除，可以安全收掉
        let cut = -1;
        for (let i = calculatorTokens.length - 2; i >= 1; i -= 2) {
            if (calculatorTokens[i] === '+' || calculatorTokens[i] === '-') { cut = i; break; }
        }
        const tail = evaluateTokens(calculatorTokens.slice(cut + 1));
        if (tail === null || !isFinite(tail)) {
            showToast('錯誤：不能除以零', true);
            calculatorClear();
            return;
        }
        calculatorTokens = calculatorTokens.slice(0, cut + 1).concat(tail);
        calculatorValue = trimFloatNoise(tail);
    }

    const display = document.getElementById('calculatorDisplay');
    if (display) display.textContent = calculatorValue;

    calculatorTokens.push(op);
    calculatorWaitingForSecondValue = true;

    const opSymbol = OP_SYMBOL[op] || op;
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
    // 還沒輸入任何運算子時，「=」不做事（與舊版一致）
    if (!calculatorTokens.length) return;

    const completeExpression = calculatorHistory + calculatorValue + " = ";
    const result = evaluateTokens(calculatorTokens.concat(parseFloat(calculatorValue)));

    if (result === null || !isFinite(result)) {
        showToast('錯誤：不能除以零', true);
        calculatorClear();
        return;
    }

    calculatorValue = trimFloatNoise(result);

    const display = document.getElementById('calculatorDisplay');
    if (display) display.textContent = calculatorValue;

    calculatorHistory = completeExpression.length > 30 ? calculatorValue : completeExpression;
    updateCalculatorHistory();

    // 算完後可以接著按運算子繼續算，此時以結果為新的起點
    calculatorTokens = [];
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

/* ------------------------------------------------------------
 * 備註編輯對話框（共用）
 *
 * 【2026/07 新增 — 修正 B3】
 * 這是全站唯一一個會叫出手機鍵盤的元件，也是唯一一個有機會
 * 違反「禁止手機呼叫鍵盤導致畫面排版大幅度移動或者是遮擋」的地方。
 *
 * 原本兩頁各有一套：
 *   - 計算頁用 .note-editor-modal，align-items: flex-start + padding-top，
 *     另外還有 adjustNoteEditorPosition() 監聽 visualViewport 動態調整
 *   - 支票頁用 .modal-overlay，align-items: center（垂直置中）
 *
 * 支票頁那一套在手機上鍵盤一彈出，視窗會被推到螢幕外或被鍵盤蓋住，
 * 看不到自己在打什麼、也點不到「儲存」。
 * 過去因為歷史面板根本打不開（A1），這個問題碰不到；
 * A1 修好之後它就變成天天會遇到的問題了。
 *
 * 現在兩頁共用這一套，並且用 visualViewport 把對話框固定在
 * 「鍵盤上緣以上」的可視區域正中央，鍵盤收合後再還原。
 * ------------------------------------------------------------ */

// 目前開啟中的備註對話框狀態（同時只會有一個）
let noteDialogState = null;

/**
 * 開啟備註編輯對話框
 * @param {Object}   options
 * @param {string}   options.title    對話框標題
 * @param {string}   options.note     既有備註內容
 * @param {Function} options.onSave   按下儲存時呼叫，參數為修剪過的備註文字
 */
function showNoteEditor(options) {
    const config = options || {};
    closeNoteEditorDialog();

    const modal = document.createElement('div');
    modal.className = 'note-editor-modal';
    modal.id = 'noteEditorModal';
    modal.innerHTML = `
        <div class="note-editor-content">
            <h3>${config.title || '備註編輯'}</h3>
            <textarea id="noteEditorInput" class="note-editor-input" placeholder="請輸入備註內容..."></textarea>
            <div class="note-editor-buttons">
                <button type="button" class="modal-btn modal-btn-secondary" data-role="cancel">取消</button>
                <button type="button" class="modal-btn modal-btn-primary" data-role="save">儲存</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    // 用 value 指定而非寫進 HTML，避免備註內容中的 < 或引號破壞版面
    const input = modal.querySelector('#noteEditorInput');
    input.value = config.note || '';

    modal.style.display = 'flex';

    modal.querySelector('[data-role="cancel"]').addEventListener('click', closeNoteEditorDialog);
    modal.querySelector('[data-role="save"]').addEventListener('click', function () {
        const text = input.value.trim();
        closeNoteEditorDialog();
        if (typeof config.onSave === 'function') config.onSave(text);
    });

    // 點遮罩關閉
    modal.addEventListener('click', function (event) {
        if (event.target === modal) closeNoteEditorDialog();
    });

    const reposition = () => positionNoteEditor(modal);
    noteDialogState = { modal, reposition };

    window.addEventListener('resize', reposition);
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', reposition);
        window.visualViewport.addEventListener('scroll', reposition);
    }

    reposition();
    input.focus();
}

/**
 * 依照「扣掉鍵盤之後的實際可視高度」把對話框放到正中央
 *
 * visualViewport.height 在鍵盤彈出時會縮小，這是唯一可靠的方式
 * 得知鍵盤佔掉多少空間。不支援的瀏覽器就退回固定上緣間距。
 */
function positionNoteEditor(modal) {
    const content = modal.querySelector('.note-editor-content');
    if (!content) return;

    const viewport = window.visualViewport;
    if (!viewport) {
        modal.style.paddingTop = '90px';
        modal.style.alignItems = 'flex-start';
        return;
    }

    const visibleHeight = viewport.height;
    const contentHeight = content.offsetHeight || 260;
    // 至少留 12px 上緣間距，內容太高時優先保證頂部（標題與輸入框）看得到
    const top = Math.max(12, viewport.offsetTop + (visibleHeight - contentHeight) / 2);

    modal.style.alignItems = 'flex-start';
    modal.style.paddingTop = top + 'px';
}

function closeNoteEditorDialog() {
    if (!noteDialogState) {
        // 也清掉可能殘留的舊節點（例如頁面重新載入前開著）
        const stray = document.getElementById('noteEditorModal');
        if (stray && stray.parentNode) stray.parentNode.removeChild(stray);
        return;
    }

    const { modal, reposition } = noteDialogState;
    window.removeEventListener('resize', reposition);
    if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', reposition);
        window.visualViewport.removeEventListener('scroll', reposition);
    }
    if (modal && modal.parentNode) modal.parentNode.removeChild(modal);
    noteDialogState = null;
}
