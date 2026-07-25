/**
 * 重車貸款業務工具箱 - 支票試算引擎與介面邏輯 (check-engine.js)
 */

/* ------------------------------------------------------------
 * 支票頁專用狀態
 *
 * 【2026/07 修正 B1】
 * 數字鍵盤、Toast、彈窗的共用狀態與函式已全部移到 js/common-keypad.js，
 * 本檔案只保留支票頁真正專屬的邏輯。
 * 原本這裡宣告的 currentInputField / calculatorValue 等 6 個變數，
 * 以及 vibrate、closeModal、showToast、showModal、showConfirmModal、
 * openCalculator、calculatorInput/Clear/Backspace/Operation/Equals、
 * updateCalculatorHistory 共 14 個函式，都與 calc-ui.js 逐字重複，已刪除。
 * ------------------------------------------------------------ */
let totalAmount = 0;
let paymentAmount = 0;
let checkCount = 0;
let depositAmount = 0;
let startDate = null;

// 日期選擇器變數
let selectedDate = null;
let currentViewMonth = new Date();

/**
 * 把數字輸入器的結果寫回欄位
 *
 * 這是支票頁唯一與計算頁不同的鍵盤相關邏輯（各欄位驗證規則不同），
 * 所以刻意保留在本檔案，沒有搬進 common-keypad.js。
 */
function submitCalculatorValue() {
    if (!currentInputField) return;
    let value = parseFloat(calculatorValue);
    if (isNaN(value)) value = 0;
    
    /* 【2026/07 修正 A5】
     * 舊版三個欄位都只檢查上限，沒有檢查下限。
     * 鍵盤雖然沒有 ± 鍵，但有減號 —— 輸入「100 - 200 =」就會得到 -100，
     * 這個負數會被直接寫進 totalAmount，接著讓大寫金額顯示成正數。
     * 計算頁對應的檢查是 value <= 0 一併擋掉，支票頁漏了，這裡補上。
     *
     * 另外把 Math.round() 提到驗證之前：
     * 舊版先驗證再四捨五入，輸入 0.4 會通過 value > 0 的檢查，
     * 四捨五入後才變成 0，等於繞過了下限。 */
    switch (currentInputField) {
        case 'total-amount':
            value = Math.round(value);
            if (value <= 0) {
                showToast('錯誤：總金額必須大於零', true);
                return;
            }
            if (value > 999999999) {
                showToast('錯誤：總金額不能超過9位數', true);
                return;
            }
            document.getElementById(currentInputField).value = formatNumber(value);
            totalAmount = value;
            calculateDepositAmount();
            updateChineseDisplay();
            if (startDate) generateCheckList();
            break;

        case 'payment-amount':
            value = Math.round(value);
            if (value <= 0) {
                showToast('錯誤：繳款金額必須大於零', true);
                return;
            }
            if (value > 9999999) {
                showToast('錯誤：繳款金額不能超過7位數', true);
                return;
            }
            document.getElementById(currentInputField).value = formatNumber(value);
            paymentAmount = value;
            calculateDepositAmount();
            updateChineseDisplay();
            if (startDate) generateCheckList();
            break;

        case 'check-count':
            value = Math.round(value);
            if (value < 1) {
                showToast('錯誤：開票張數至少為 1 張', true);
                return;
            }
            if (value > 99) {
                showToast('錯誤：開票張數不能超過2位數', true);
                return;
            }
            document.getElementById(currentInputField).value = formatNumber(value);
            checkCount = value;
            calculateDepositAmount();
            if (startDate) generateCheckList();
            break;
    }
    
    closeModal('numberInputModal');
    vibrate();
}

function clearField(fieldId) {
    vibrate();
    const element = document.getElementById(fieldId);
    if (element) element.value = '';
    
    if (fieldId === 'total-amount') {
        totalAmount = 0;
    } else if (fieldId === 'payment-amount') {
        paymentAmount = 0;
    } else if (fieldId === 'check-count') {
        checkCount = 0;
    }
    
    calculateDepositAmount();
    if (fieldId === 'check-count') {
        generateCheckList();
    }
}

function clearAllInputs() {
    vibrate();
    ['total-amount', 'payment-amount', 'check-count', 'deposit-amount', 'start-date', 'end-date'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    
    totalAmount = 0;
    paymentAmount = 0;
    checkCount = 0;
    depositAmount = 0;
    startDate = null;

    // 大寫、底部卡片、提示文字統一交給 resetDepositDisplay() 清，
    // 避免像過去那樣「這裡清了三個、那裡漏了一個」而留下殘影
    resetDepositDisplay();

    const listContent = document.getElementById('check-list-content');
    if (listContent) listContent.innerHTML = '';

    showToast('已清除所有欄位');
}

// 格式化數字與日期
function formatNumber(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatDateToROC(date) {
    const rocYear = date.getFullYear() - 1911;
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `${rocYear}年${month}月${day}日`;
}

function getChineseWeekday(date) {
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    return `（${weekdays[date.getDay()]}）`;
}

function updateCurrentDate() {
    const now = new Date();
    const rocYear = now.getFullYear() - 1911;
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const date = String(now.getDate()).padStart(2, '0');
    const days = ['日', '一', '二', '三', '四', '五', '六'];
    const day = days[now.getDay()];
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    
    const timeString = `${rocYear}年${month}月${date}日 星期${day} ${hours}:${minutes}:${seconds}`;
    const el = document.getElementById('current-date');
    if (el) el.textContent = timeString;
}

/**
 * 把押票金額相關的所有顯示一次歸零
 *
 * 【2026/07 修正 A2 / A6】
 * 舊版在「押票金額算出負數」時只清掉了阿拉伯數字欄位就 return，
 * 既沒有把 depositAmount 歸零，也沒有清掉欄位下方的大寫、沒有收起底部卡片。
 * 結果是畫面上同時出現三個互相矛盾的數字：
 *   - 押票金額欄位：空白
 *   - 欄位下方大寫：負數被 Math.abs 吃掉負號後的「看起來很正常」的正數
 *   - 底部卡片：上一次的舊金額
 * 業務很可能直接把那個大寫抄到支票上。
 *
 * 現在只要金額不成立，就一律走這個函式，把六個顯示位置全部清乾淨。
 */
function resetDepositDisplay() {
    const depEl = document.getElementById('deposit-amount');
    if (depEl) depEl.value = '';

    const depDisp = document.getElementById('deposit-amount-display');
    if (depDisp) depDisp.textContent = '';

    const depDispCn = document.getElementById('deposit-amount-display-chinese');
    if (depDispCn) depDispCn.innerHTML = '';

    const card = document.querySelector('.deposit-info-card');
    if (card) card.style.display = 'none';

    const tipElement = document.getElementById('deposit-amount-tip');
    if (tipElement) {
        tipElement.textContent = '';
        tipElement.style.display = 'none';
    }

    // 一併清掉「押票金額」欄位正下方那一行大寫（舊版漏掉的就是這一個）
    updateChineseDisplay();
}

function calculateDepositAmount() {
    // 必要欄位沒填齊：直接歸零，不留任何殘影
    if (!totalAmount || !paymentAmount || !checkCount) {
        depositAmount = 0;
        resetDepositDisplay();
        return;
    }

    depositAmount = totalAmount - (paymentAmount * checkCount) + paymentAmount;

    if (depositAmount <= 0) {
        // 關鍵：一定要把 depositAmount 歸零。
        // 若留著負數，後續 updateChineseDisplay() 會把它當成有效金額，
        // 而 arabicToChineseNumber 早期版本會用 Math.abs 把負號吃掉。
        depositAmount = 0;
        resetDepositDisplay();
        showToast('錯誤：押票金額必須大於零，請檢查總金額、繳款金額與張數', true);
        return;
    }

    const depEl = document.getElementById('deposit-amount');
    if (depEl) depEl.value = formatNumber(depositAmount);

    updateChineseDisplay();

    const depDisp = document.getElementById('deposit-amount-display');
    if (depDisp) depDisp.textContent = `押票金額：${formatNumber(depositAmount)}`;

    renderChineseAmount('deposit-amount-display-chinese', depositAmount);

    const card = document.querySelector('.deposit-info-card');
    if (card) card.style.display = 'block';

    const tipElement = document.getElementById('deposit-amount-tip');
    if (tipElement) {
        if (depositAmount < paymentAmount) {
            tipElement.textContent = '押票金額小於繳款金額，請再次檢查金額。';
            tipElement.style.display = 'block';
        } else if (depositAmount === paymentAmount) {
            tipElement.textContent = '押票金額等於繳款金額，此為最後一張支票。';
            tipElement.style.display = 'block';
        } else {
            tipElement.textContent = '';
            tipElement.style.display = 'none';
        }
    }
}

function updateEndDateDisplay() {
    if (!checkCount || !startDate) {
        const endEl = document.getElementById('end-date');
        if (endEl) endEl.value = '';
        return;
    }
    const originalDay = startDate.getDate();
    let endDate = new Date(startDate);
    
    if (checkCount > 1) {
        endDate.setMonth(endDate.getMonth() + (checkCount - 1), 1);
        const lastDayOfMonth = new Date(endDate.getFullYear(), endDate.getMonth() + 1, 0).getDate();
        const dayToSet = Math.min(originalDay, lastDayOfMonth);
        endDate.setDate(dayToSet);
    }
    
    const formattedDate = formatDateToROC(endDate);
    const weekday = getChineseWeekday(endDate);
    const endEl = document.getElementById('end-date');
    if (endEl) endEl.value = `${formattedDate} ${weekday}`;
}

function generateCheckList() {
    const listContent = document.getElementById('check-list-content');
    if (!listContent) return;
    if (!checkCount || !startDate) {
        listContent.innerHTML = '';
        const card = document.querySelector('.deposit-info-card');
        if (card) card.style.display = 'none';
        /* 【2026/07 修正 A7】
         * updateEndDateDisplay() 原本只寫在函式最後一行，這個 early return
         * 會整個跳過它，導致清空開票張數之後：列表消失了、卡片收起來了，
         * 但「結束日期」欄位還停在舊的日期上，業務可能誤以為那個日期還有效。
         * 該函式本身在 !checkCount || !startDate 時就會清空欄位，直接呼叫即可。 */
        updateEndDateDisplay();
        return;
    }
    
    let html = '<table class="check-list-table">';
    html += '<thead><tr><th>流水號</th><th>日期</th><th>星期</th><th>剩餘張數</th></tr></thead><tbody>';
    
    const originalDay = startDate.getDate();
    let currentYear = startDate.getFullYear();
    
    for (let i = 0; i < checkCount; i++) {
        let checkDate = new Date(startDate);
        if (i > 0) {
            checkDate.setMonth(checkDate.getMonth() + i, 1);
            const lastDayOfMonth = new Date(checkDate.getFullYear(), checkDate.getMonth() + 1, 0).getDate();
            const dayToSet = Math.min(originalDay, lastDayOfMonth);
            checkDate.setDate(dayToSet);
        }
        
        const newYear = checkDate.getFullYear() !== currentYear;
        if (newYear) {
            html += `<tr class="year-change-row">
                <td colspan="4">
                    <div class="year-change-indicator">
                        <span class="year-text">${checkDate.getFullYear() - 1911}年</span>
                    </div>
                </td>
            </tr>`;
            currentYear = checkDate.getFullYear();
        }
        
        const formattedDate = formatDateToROC(checkDate);
        const weekday = getChineseWeekday(checkDate);
        const remainingChecks = checkCount - i;
        
        html += `<tr class="row-${i % 2}">
            <td>${i + 1}</td>
            <td>${formattedDate}</td>
            <td>${weekday}</td>
            <td>${remainingChecks}</td>
        </tr>`;
    }
    
    html += '</tbody></table>';
    listContent.innerHTML = html;
    updateEndDateDisplay();
}

/**
 * 把單一金額渲染成「大寫 + 元整」，金額不成立時輸出空字串
 *
 * 【2026/07 修正 A2】舊版是 arabicToChineseNumber(x) + ' 元整' 直接串接，
 * 只要函式回傳空字串就會變成孤零零的「元整」兩個字。改由這裡統一判斷。
 */
function renderChineseAmount(elementId, amount) {
    const el = document.getElementById(elementId);
    if (!el) return;
    const chinese = arabicToChineseNumber(amount, 'financial');
    el.innerHTML = chinese ? chinese + ' 元整' : '';
}

function updateChineseDisplay() {
    renderChineseAmount('payment-amount-chinese', paymentAmount);
    renderChineseAmount('deposit-amount-chinese', depositAmount);
}

/**
 * 阿拉伯數字轉中文大寫金額
 *
 * 【2026/07 重寫 A3】
 * 舊版把數字每 4 位切成一段分別轉換，但「要補零」的旗標在每一段開頭
 * 都會被重設，導致段與段之間的零整個消失。實測失效案例：
 *     1,005,000  → 壹佰萬伍仟    （正確：壹佰萬零伍仟）
 *    10,005,000  → 壹仟萬伍仟    （正確：壹仟萬零伍仟）
 * 失效條件是「高位段的尾數是 0，且低位段的千位不是 0」——
 * 這在重車業務是很常見的金額，不是罕見邊界。
 * 支票大寫漏一個「零」，銀行有權以文義不清、可被增改為由退票。
 *
 * 新版改為「整串由高位往低位掃描」：
 *   - 遇到非零數字：若前面累積過零，先補一個「零」，再寫數字與位單位
 *   - 遇到零：只是把「待補零」記起來，連續幾個零也只會補一個
 *   - 走到每個四位段的最低位時，若該段有非零數字才補上 萬／億／兆
 *   - 「待補零」刻意不在 萬／億／兆 之後重設，這正是舊版漏字的原因
 *
 * 另外新增防呆：負數、NaN、Infinity、零一律回傳空字串，
 * 絕不把不合理的金額轉成「看起來很正常」的大寫（見 A2 / A5）。
 */
function arabicToChineseNumber(number, type = 'financial', highlight = true) {
    const value = typeof number === 'number' ? number : parseFloat(number);
    if (!Number.isFinite(value) || value <= 0) return '';

    const digits = type === 'financial'
        ? ['零', '壹', '貳', '參', '肆', '伍', '陸', '柒', '捌', '玖']
        : ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
    const units = type === 'financial'
        ? ['', '拾', '佰', '仟']
        : ['', '十', '百', '千'];
    const bigUnits = ['', '萬', '億', '兆'];

    const numStr = Math.floor(value).toString();
    if (numStr.length > bigUnits.length * 4) return '';   // 超出「兆」可表達的範圍

    const wrap = ch => highlight ? `<span class="chinese-digit">${ch}</span>` : ch;

    const len = numStr.length;
    let result = '';
    let pendingZero = false;      // 前面是否出現過尚未寫出的零

    for (let idx = 0; idx < len; idx++) {
        const position = len - idx - 1;                 // 這一位由右數來的位數
        const groupIndex = Math.floor(position / 4);    // 0=個 1=萬 2=億 3=兆
        const digit = parseInt(numStr[idx], 10);

        if (digit !== 0) {
            if (pendingZero) {
                result += wrap(digits[0]);
                pendingZero = false;
            }
            result += wrap(digits[digit]) + units[position % 4];
        } else if (result !== '') {
            // result 為空代表還在前導零，不需要記錄
            pendingZero = true;
        }

        // 走到某個四位段的最低位：該段只要有非零數字就補上段位單位
        if (position % 4 === 0 && groupIndex > 0) {
            const groupStart = Math.max(0, len - (groupIndex + 1) * 4);
            const groupDigits = numStr.substring(groupStart, len - position);
            if (/[1-9]/.test(groupDigits)) {
                result += bigUnits[groupIndex];
                // 注意：這裡刻意不重設 pendingZero。
                // 例如 10,005,000 需要輸出「壹仟萬零伍仟」，
                // 那個「零」正是靠萬字之前累積下來的 pendingZero 補上的。
            }
        }
    }

    return result;
}

// 日期選擇器功能
function showDatePicker() {
    vibrate();
    selectedDate = startDate || new Date();
    currentViewMonth = new Date(selectedDate);
    updateDatePicker();
    const modal = document.getElementById('date-picker-overlay');
    if (modal) modal.style.display = 'flex';
}

function updateDatePicker() {
    const year = currentViewMonth.getFullYear() - 1911;
    const month = currentViewMonth.getMonth() + 1;
    const titleEl = document.getElementById('date-picker-title');
    if (titleEl) titleEl.textContent = `${year}年${month}月`;
    
    const datePickerBody = document.getElementById('date-picker-body');
    if (!datePickerBody) return;
    datePickerBody.innerHTML = '';
    
    const firstDay = new Date(currentViewMonth.getFullYear(), currentViewMonth.getMonth(), 1);
    const firstDayOfWeek = firstDay.getDay();
    const lastDay = new Date(currentViewMonth.getFullYear(), currentViewMonth.getMonth() + 1, 0);
    const lastDate = lastDay.getDate();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let dayCount = 1;
    let html = '<tr>';
    
    for (let i = 0; i < firstDayOfWeek; i++) {
        html += '<td></td>';
    }
    
    while (dayCount <= lastDate) {
        const currentDate = new Date(currentViewMonth.getFullYear(), currentViewMonth.getMonth(), dayCount);
        const isToday = currentDate.getTime() === today.getTime();
        const isSelected = selectedDate && currentDate.getTime() === selectedDate.getTime();
        const isPastDate = currentDate < today;
        
        let className = '';
        if (isSelected) className += ' selected';
        if (isToday) className += ' today';
        if (isPastDate) className += ' disabled';
        
        html += `<td class="${className}" data-date="${currentDate.toISOString()}"${isPastDate ? ' disabled' : ''}><div>${dayCount}</div></td>`;
        
        if ((firstDayOfWeek + dayCount) % 7 === 0) {
            html += '</tr><tr>';
        }
        dayCount++;
    }
    
    const remainingCells = 7 - ((firstDayOfWeek + lastDate) % 7);
    if (remainingCells < 7) {
        for (let i = 0; i < remainingCells; i++) {
            html += '<td></td>';
        }
    }
    
    const totalDays = firstDayOfWeek + lastDate + remainingCells;
    const usedRows = Math.ceil(totalDays / 7);
    if (usedRows < 6) {
        const extraRows = 6 - usedRows;
        for (let i = 0; i < extraRows; i++) {
            html += '</tr><tr>';
            for (let j = 0; j < 7; j++) {
                html += '<td></td>';
            }
        }
    }
    
    html += '</tr>';
    datePickerBody.innerHTML = html;
    
    const dateCells = document.querySelectorAll('#date-picker-body td[data-date]');
    dateCells.forEach(cell => {
        if (!cell.hasAttribute('disabled')) {
            const handleClick = function() {
                vibrate();
                document.querySelectorAll('#date-picker-body td.selected').forEach(sel => {
                    sel.classList.remove('selected');
                });
                cell.classList.add('selected');
                selectedDate = new Date(cell.getAttribute('data-date'));
            };
            
            cell.addEventListener('click', handleClick);
            const divElement = cell.querySelector('div');
            if (divElement) {
                divElement.addEventListener('click', function(e) {
                    e.stopPropagation();
                    handleClick();
                });
            }
        }
    });
}

function setupDatePicker() {
    const prevBtn = document.getElementById('prev-month');
    if (prevBtn) {
        prevBtn.addEventListener('click', function() {
            vibrate();
            currentViewMonth.setMonth(currentViewMonth.getMonth() - 1);
            updateDatePicker();
        });
    }
    const nextBtn = document.getElementById('next-month');
    if (nextBtn) {
        nextBtn.addEventListener('click', function() {
            vibrate();
            currentViewMonth.setMonth(currentViewMonth.getMonth() + 1);
            updateDatePicker();
        });
    }
    const confirmBtn = document.getElementById('confirm-date');
    if (confirmBtn) {
        confirmBtn.addEventListener('click', function() {
            vibrate();
            if (selectedDate) {
                startDate = selectedDate;
                const formattedDate = formatDateToROC(startDate);
                const weekday = getChineseWeekday(startDate);
                const startEl = document.getElementById('start-date');
                if (startEl) startEl.value = `${formattedDate} ${weekday}`;
                generateCheckList();
            }
            closeModal('date-picker-overlay');
        });
    }
    const cancelBtn = document.getElementById('cancel-date');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', function() {
            vibrate();
            closeModal('date-picker-overlay');
        });
    }
}

// 歷史記錄保存與備註編輯
function saveCheckData() {
    vibrate();
    if (!totalAmount || !paymentAmount || !checkCount || !startDate) {
        showToast('請先完成所有必要欄位的填寫', true);
        return;
    }

    /* 【2026/07 修正 A2 延伸】
     * 舊版只檢查四個輸入欄位，沒有檢查押票金額本身是否成立。
     * 當金額組合不合理（押票金額 ≤ 0）時，畫面上押票欄位是空的，
     * 卻仍然可以按下「保存計算」，把一筆押票金額為 0（舊版是負數）的
     * 紀錄存進歷史，日後載出來會是一筆看不出哪裡有問題的錯誤資料。 */
    if (!depositAmount || depositAmount <= 0) {
        showToast('押票金額不成立，請先檢查總金額、繳款金額與張數', true);
        return;
    }
    
    const checkDate = new Date();
    const formattedDate = `${checkDate.getFullYear()}-${(checkDate.getMonth() + 1).toString().padStart(2, '0')}-${checkDate.getDate().toString().padStart(2, '0')}`;
    
    const checkData = {
        id: new Date().getTime(),
        date: formattedDate,
        totalAmount: totalAmount,
        paymentAmount: paymentAmount,
        checkCount: checkCount,
        depositAmount: depositAmount,
        startDate: startDate.toISOString(),
        timestamp: new Date().toISOString(),
        note: ''
    };
    
    let checkHistory = JSON.parse(localStorage.getItem('checkHistory') || '[]');
    checkHistory.push(checkData);
    localStorage.setItem('checkHistory', JSON.stringify(checkHistory));
    showToast('支票計算結果已保存！');
}

/* showToast / showModal / hideModal / showConfirmModal / hideConfirmModal
 * 已移至 js/common-keypad.js（見 B1 修正說明） */

/**
 * 開關歷史記錄面板
 *
 * 【2026/07 修正 A1】
 * 舊版用 classList.add('active') 來開啟面板，但全站 CSS 從來沒有定義過
 * .history-panel.active 這條規則（.history-panel 本身是 display: none），
 * 所以加上這個 class 完全不會讓面板顯示出來。
 *
 * 實際後果：按「保存計算」會跳出「已保存」，資料也真的寫進 localStorage，
 * 但按「歷史記錄」畫面毫無反應 —— 整套歷史功能（查詢、備註、刪除、全刪，
 * 約 120 行程式碼）等於完全是死的，存進去的資料永遠看不到。
 *
 * 改為與計算頁一致的 style.display 寫法（calc-ui.js 的 toggleHistoryPanel）。
 */
function toggleHistoryPanel() {
    vibrate();
    const historyPanel = document.getElementById('historyPanel');
    if (!historyPanel) return;

    const isOpen = historyPanel.style.display === 'block';
    if (isOpen) {
        historyPanel.style.display = 'none';
    } else {
        loadCheckHistory();
        historyPanel.style.display = 'block';
    }
}

function loadCheckHistory() {
    const historyContent = document.getElementById('historyContent');
    if (!historyContent) return;
    const checkHistory = JSON.parse(localStorage.getItem('checkHistory') || '[]');
    
    if (checkHistory.length === 0) {
        historyContent.innerHTML = '<div class="no-history">暫無歷史記錄</div>';
        return;
    }
    
    let html = '';
    checkHistory.reverse().forEach(item => {
        const itemStartDate = new Date(item.startDate);
        const formattedStartDate = formatDateToROC(itemStartDate);
        
        html += `
        <div class="history-item">
            <div class="history-item-header">
                <span class="history-date">${item.date}</span>
                <div class="history-actions">
                    <button onclick="openNoteEditor(${item.id})" class="note-btn">備註</button>
                    <button onclick="deleteCheckHistoryItem(${item.id})" class="delete-btn">刪除</button>
                </div>
            </div>
            <div class="history-details">
                <div><span>總金額：</span>${formatNumber(item.totalAmount)} 元</div>
                <div><span>每期繳款：</span>${formatNumber(item.paymentAmount)} 元</div>
                <div><span>開票張數：</span>${item.checkCount} 張</div>
                <div><span>押票金額：</span>${formatNumber(item.depositAmount)} 元</div>
                <div><span>開始日期：</span>${formattedStartDate}</div>
            </div>
            ${item.note ? `<div class="history-note-display"><strong>備註：</strong>${item.note}</div>` : ''}
        </div>`;
    });
    
    historyContent.innerHTML = html;
}

function deleteCheckHistoryItem(id) {
    vibrate();
    showConfirmModal('刪除確認', '確定要刪除這筆歷史紀錄嗎？', function() {
        let checkHistory = JSON.parse(localStorage.getItem('checkHistory') || '[]');
        checkHistory = checkHistory.filter(item => item.id !== id);
        localStorage.setItem('checkHistory', JSON.stringify(checkHistory));
        loadCheckHistory();
        showToast('歷史紀錄已刪除');
    });
}

function confirmDeleteAll() {
    vibrate();
    showConfirmModal('全刪確認', '確定要刪除所有歷史紀錄嗎？此操作無法恢復。', function() {
        localStorage.removeItem('checkHistory');
        loadCheckHistory();
        showToast('所有歷史紀錄已刪除');
    });
}

function openNoteEditor(checkId) {
    vibrate();
    const checkHistory = JSON.parse(localStorage.getItem('checkHistory') || '[]');
    const checkItem = checkHistory.find(item => item.id === checkId);
    
    if (!checkItem) return;
    
    let noteEditorModal = document.getElementById('noteEditorModal');
    if (!noteEditorModal) {
        noteEditorModal = document.createElement('div');
        noteEditorModal.id = 'noteEditorModal';
        noteEditorModal.className = 'modal-overlay';
        document.body.appendChild(noteEditorModal);
    }
    
    noteEditorModal.innerHTML = `
        <div class="modal-container">
            <div class="modal-header">
                <h3>編輯備註</h3>
                <button onclick="closeNoteEditor()" class="close-btn">×</button>
            </div>
            <div class="modal-content">
                <textarea id="noteInput" class="note-editor-input" placeholder="請輸入備註內容...">${checkItem.note || ''}</textarea>
            </div>
            <div class="modal-footer">
                <button onclick="closeNoteEditor()" class="modal-btn modal-btn-secondary">取消</button>
                <button onclick="saveNote(${checkId})" class="modal-btn modal-btn-primary">儲存</button>
            </div>
        </div>
    `;
    
    noteEditorModal.style.display = 'flex';
}

function closeNoteEditor() {
    vibrate();
    const noteEditorModal = document.getElementById('noteEditorModal');
    if (noteEditorModal) {
        noteEditorModal.style.display = 'none';
    }
}

function saveNote(checkId) {
    vibrate();
    const noteInput = document.getElementById('noteInput');
    if (!noteInput) return;
    
    const noteText = noteInput.value.trim();
    let checkHistory = JSON.parse(localStorage.getItem('checkHistory') || '[]');
    const checkIndex = checkHistory.findIndex(item => item.id === checkId);
    
    if (checkIndex !== -1) {
        checkHistory[checkIndex].note = noteText;
        localStorage.setItem('checkHistory', JSON.stringify(checkHistory));
        closeNoteEditor();
        loadCheckHistory();
        showToast('備註已更新');
    }
}

// 初始化頁面事件與定時器
document.addEventListener('DOMContentLoaded', function() {
    updateCurrentDate();
    setInterval(updateCurrentDate, 1000);
    setupDatePicker();
});
