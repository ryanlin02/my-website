/**
 * 重車貸款業務工具箱 - 通用彈窗與數字鍵盤元件模組 (common-modals.js)
 * 動態注入 DOM，提供跨頁面復用的提示彈窗、確認彈窗、數字小鍵盤與通用頁尾
 */

/* ------------------------------------------------------------
 * 鍵盤最後一列（末列）的產生器
 * ------------------------------------------------------------
 * 【2026/07 新增：末列改成可以重建】
 *
 * 鍵盤是 4 欄 × 5 列。前四列（清除／退回／運算子／1～9）四種欄位型別
 * 完全相同，永遠不會動 —— 這是肌肉記憶的基礎。真正需要因欄位而異的
 * 只有最後一列：金額欄位要 000 與 萬、小數欄位要小數點、計數欄位兩者
 * 都不要。所以把這一列抽成函式，開啟鍵盤時依欄位重建。
 *
 * 位置規則（四種型別一致，不可更動）：
 *   0 永遠在最左、= 永遠在最右，加速鍵與小數點夾在中間。
 *   0 鍵吸收剩下的格數，總和才會剛好 4 欄。
 *   沒有加速鍵時算出來的 span 等於原本寫死的值（有小數點 2 格、
 *   沒小數點 3 格），所以計算頁、加油頁、支票頁的既有排版完全不變。
 *
 * data-keypad-tail 是重建時的辨識標記：只有帶這個屬性的按鈕會被換掉，
 * 前四列碰不到。
 *
 * @param {Object} opts { decimal: boolean, accelerators: string[] }
 * @return {string} 末列的 HTML
 * ------------------------------------------------------------ */
function buildKeypadTailRow(opts) {
    const showDecimal = !opts || opts.decimal !== false;
    const accelerators = (opts && Array.isArray(opts.accelerators)) ? opts.accelerators : [];

    const tailKeys = accelerators.length + (showDecimal ? 1 : 0) + 1;   // 加速鍵 + 小數點 + 等號
    const zeroSpan = Math.max(1, 4 - tailKeys);

    const acceleratorHtml = accelerators.map(a =>
        `<button onclick="calculatorAppend('${a}')" class="function" data-keypad-tail="1">${a === '0000' ? '萬' : a}</button>`
    ).join('\n                ');

    return `<button onclick="calculatorInput(0)" class="number-btn zero-btn" data-keypad-tail="1" style="grid-column: span ${zeroSpan};">
                    <div class="arabic-number">0</div>
                    <div class="financial-char">零</div>
                </button>
                ${acceleratorHtml}
                ${showDecimal ? `<button onclick="calculatorDecimal()" class="function" data-keypad-tail="1">.</button>` : ''}
                <button onclick="calculatorEquals()" class="equals" data-keypad-tail="1">=</button>`;
}

function initCommonModals() {
    // 避免重複注入
    if (document.getElementById('numberInputModal')) return;

    /* ------------------------------------------------------------
     * 鍵盤選項
     * 【2026/07 修正 A4】
     * 這個檔案注入的共用鍵盤上有一顆小數點鍵，onclick 寫死呼叫
     * calculatorDecimal()。但這個函式只有 calc-ui.js（計算頁）有定義，
     * check-engine.js（支票頁）沒有 —— 在支票頁按小數點會直接丟出
     * ReferenceError，按鈕沒反應、沒震動、沒提示，
     * 使用者會以為是螢幕沒感應到而重複按。
     *
     * 支票頁的三個欄位（總金額／繳款金額／開票張數）本來就都是整數，
     * 根本不需要小數點。與其複製一份 calculatorDecimal 過去，
     * 不如讓各頁自行決定要不要顯示這顆鍵。
     *
     * 用法：在載入本檔案之前設定
     *     window.KEYPAD_OPTIONS = { decimal: false };
     * 未設定時預設維持顯示，計算頁行為完全不變。
     *
     * ------------------------------------------------------------
     * 【2026/07 新增：整數加速鍵 accelerators】
     *
     * 這行業的金額幾乎都是整萬整千：貸款本金 100 萬、支票金額、
     * 加油頁的每月油錢動輒數十萬。一位一位按 0 很慢也容易多按少按。
     * 發票頁自己那套鍵盤早就有 000 與「萬」兩顆加速鍵，實務上很有用，
     * 這裡把同樣的能力做成設定。
     *
     * 用法（同樣要在載入本檔案之前設定）：
     *     window.KEYPAD_OPTIONS = { accelerators: ['00'] };
     *     window.KEYPAD_OPTIONS = { accelerators: ['000', '0000'] };
     * 按鍵文字自動產生：'0000' 會顯示成「萬」，其餘直接顯示位數。
     * ------------------------------------------------------------ */
    const keypadOptions = window.KEYPAD_OPTIONS || {};
    const showDecimal = keypadOptions.decimal !== false;
    const accelerators = Array.isArray(keypadOptions.accelerators) ? keypadOptions.accelerators : [];

    /* 這一頁的預設末列組成。開啟鍵盤時若該欄位沒有指定型別，
     * 就用這一組重建 —— 也就是維持這一頁原本的樣子。 */
    window.KEYPAD_TAIL_DEFAULT = { decimal: showDecimal, accelerators: accelerators };

    const lastRowHtml = buildKeypadTailRow(window.KEYPAD_TAIL_DEFAULT);

    const modalWrapper = document.createElement('div');
    modalWrapper.id = 'commonModalsWrapper';
    modalWrapper.innerHTML = `
    <!-- 通用提示模態框 -->
    <div id="modalOverlay" class="modal-overlay">
        <div class="modal-container">
            <div class="modal-header">
                <h3 id="modalTitle">提示</h3>
                <button class="close-btn" onclick="hideModal()">×</button>
            </div>
            <div id="modalContent" class="modal-content"></div>
            <div class="modal-footer">
                <button class="modal-btn modal-btn-primary" onclick="hideModal()">確定</button>
            </div>
        </div>
    </div>

    <!-- 通用確認模態框 -->
    <div id="confirmModalOverlay" class="modal-overlay">
        <div class="modal-container">
            <div class="modal-header">
                <h3 id="confirmModalTitle">確認</h3>
                <button class="close-btn" onclick="hideConfirmModal()">×</button>
            </div>
            <div id="confirmModalContent" class="modal-content"></div>
            <div class="modal-footer">
                <button class="modal-btn modal-btn-secondary" onclick="hideConfirmModal()">取消</button>
                <button id="confirmModalOk" class="modal-btn modal-btn-primary">確定</button>
            </div>
        </div>
    </div>

    <!-- 通用數字輸入器模態框 -->
    <div id="numberInputModal" class="modal-overlay">
        <div class="number-input-modal">
            <div class="modal-header">
                <h3 id="inputModalTitle">數字輸入器</h3>
                <button class="close-btn" onclick="closeModal('numberInputModal')">×</button>
            </div>

            <!-- 顯示區三行：算式歷程（上）／數字（中）／副資訊（下）
                 副資訊即使沒有內容也保留高度，面板高度才不會因欄位而忽高忽低。
                 目前用途：金額欄位顯示中文大寫（支票要手寫大寫金額）。 -->
            <div class="calculator-display-container">
                <div class="calculator-scroll-indicator" id="historyScrollIndicator"></div>
                <div class="calculator-history" id="calculatorHistory"></div>
                <div class="calculator-display" id="calculatorDisplay">0</div>
                <div class="calculator-sub" id="calculatorSub"></div>
            </div>

            <div class="calculator-buttons">
                <!-- 第一行：功能鍵 -->
                <button onclick="calculatorClear()" class="clear" style="grid-column: span 2;">C 清除</button>
                <button onclick="calculatorBackspace()" class="function">⌫</button>
                <button onclick="calculatorOperation('/')" class="operator">÷</button>
                
                <!-- 第二行：數字 7 8 9 與乘號 -->
                <button onclick="calculatorInput(7)" class="number-btn">
                    <div class="arabic-number">7</div>
                    <div class="financial-char">柒</div>
                </button>
                <button onclick="calculatorInput(8)" class="number-btn">
                    <div class="arabic-number">8</div>
                    <div class="financial-char">捌</div>
                </button>
                <button onclick="calculatorInput(9)" class="number-btn">
                    <div class="arabic-number">9</div>
                    <div class="financial-char">玖</div>
                </button>
                <button onclick="calculatorOperation('*')" class="operator">×</button>
                
                <!-- 第三行：數字 4 5 6 與減號 -->
                <button onclick="calculatorInput(4)" class="number-btn">
                    <div class="arabic-number">4</div>
                    <div class="financial-char">肆</div>
                </button>
                <button onclick="calculatorInput(5)" class="number-btn">
                    <div class="arabic-number">5</div>
                    <div class="financial-char">伍</div>
                </button>
                <button onclick="calculatorInput(6)" class="number-btn">
                    <div class="arabic-number">6</div>
                    <div class="financial-char">陸</div>
                </button>
                <button onclick="calculatorOperation('-')" class="operator">−</button>
                
                <!-- 第四行：數字 1 2 3 與加號 -->
                <button onclick="calculatorInput(1)" class="number-btn">
                    <div class="arabic-number">1</div>
                    <div class="financial-char">壹</div>
                </button>
                <button onclick="calculatorInput(2)" class="number-btn">
                    <div class="arabic-number">2</div>
                    <div class="financial-char">貳</div>
                </button>
                <button onclick="calculatorInput(3)" class="number-btn">
                    <div class="arabic-number">3</div>
                    <div class="financial-char">參</div>
                </button>
                <button onclick="calculatorOperation('+')" class="operator">+</button>
                
                <!-- 第五行：零、小數點（可關閉）和等號 -->
                ${lastRowHtml}
            </div>

            <!-- 獨立滿版確認輸入按鈕區域 -->
            <div class="calculator-submit-container">
                <button onclick="submitCalculatorValue()" class="submit-btn-primary">確認輸入</button>
            </div>
        </div>
    </div>
    `;

    document.body.appendChild(modalWrapper);
}

/* 註：renderGlobalFooter() 與 showAppVersion() 已於 2026/07 移到
 *     js/common-footer.js。
 *
 *     原因：頁尾綁在本檔案裡，而本檔案同時會注入一整組計算機彈窗。
 *     加油頁有自己的鍵盤、不載入本檔案，結果就完全沒有頁尾與版本號 ——
 *     業務無法自己確認手機上的 PWA 有沒有更新到最新版。
 *     發票頁則是為了避開那組彈窗，在 HTML 裡寫死一份頁尾，
 *     還在 invoice-engine.js 複製了一份 showAppVersion()。
 *
 *     拆開之後四個頁面各自載入 common-footer.js 即可，不需呼叫任何函式。 */

// 自動監聽與載入注入
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCommonModals);
} else {
    initCommonModals();
}
