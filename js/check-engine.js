/**
 * 重車貸款業務工具箱 - 支票試算引擎與介面邏輯 (check-engine.js)
 */

let totalAmount = 0;
let paymentAmount = 0;
let checkCount = 0;
let depositAmount = 0;
let startDate = null;
let resultValue = 0;

// 日期選擇器變數
let selectedDate = null;
let currentViewMonth = new Date();

// 計算機全域變數
let currentInputField = null;
let calculatorValue = "0";
let calculatorOperator = null;
let calculatorFirstValue = null;
let calculatorWaitingForSecondValue = false;
let calculatorHistory = "";

// 震動回饋
function vibrate() {
    if (navigator.vibrate) {
        navigator.vibrate(30);
    }
}

// 關閉模態框
function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.style.display = 'none';
    vibrate();
}

// 計算機輸入與運算
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
    if (calculatorFirstValue !== null && calculatorOperator !== null) {
        calculatorEquals();
    }
    calculatorFirstValue = parseFloat(calculatorValue);
    calculatorOperator = op;
    calculatorWaitingForSecondValue = true;
    let opSymbol = op;
    switch(op) {
        case '+': opSymbol = ' + '; break;
        case '-': opSymbol = ' - '; break;
        case '*': opSymbol = ' × '; break;
        case '/': opSymbol = ' ÷ '; break;
    }
    if (calculatorHistory === "") {
        calculatorHistory = calculatorValue + opSymbol;
    } else {
        if (calculatorHistory.length > 20) {
            calculatorHistory += "\n" + calculatorValue + opSymbol;
        } else {
            calculatorHistory += calculatorValue + opSymbol;
        }
    }
    updateCalculatorHistory();
    vibrate();
}

function calculatorEquals() {
    if (calculatorFirstValue === null || calculatorOperator === null) return;
    const secondValue = parseFloat(calculatorValue);
    let result;
    let completeExpression = calculatorHistory + calculatorValue + " = ";
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

// 喚起數字輸入器
function openCalculator(targetId, title) {
    currentInputField = targetId;
    const titleEl = document.getElementById('inputModalTitle');
    if (titleEl) titleEl.textContent = title;
    
    const inputEl = document.getElementById(targetId);
    const currentValue = inputEl ? inputEl.value : '';
    
    if (currentValue && currentValue !== '') {
        calculatorValue = currentValue.replace(/,/g, '');
    } else {
        calculatorValue = "0";
    }
    
    const display = document.getElementById('calculatorDisplay');
    if (display) display.textContent = calculatorValue;
    
    calculatorOperator = null;
    calculatorFirstValue = null;
    calculatorWaitingForSecondValue = false;
    calculatorHistory = "";
    
    const historyEl = document.getElementById('calculatorHistory');
    if (historyEl) historyEl.textContent = "";
    
    const modal = document.getElementById('numberInputModal');
    if (modal) modal.style.display = 'flex';
    vibrate();
}

function submitCalculatorValue() {
    if (!currentInputField) return;
    let value = parseFloat(calculatorValue);
    if (isNaN(value)) value = 0;
    
    switch (currentInputField) {
        case 'total-amount':
            if (value > 999999999) {
                showToast('錯誤：總金額不能超過9位數', true);
                return;
            }
            value = Math.round(value);
            document.getElementById(currentInputField).value = formatNumber(value);
            totalAmount = value;
            calculateDepositAmount();
            updateChineseDisplay();
            if (startDate) generateCheckList();
            break;
            
        case 'payment-amount':
            if (value > 9999999) {
                showToast('錯誤：繳款金額不能超過7位數', true);
                return;
            }
            value = Math.round(value);
            document.getElementById(currentInputField).value = formatNumber(value);
            paymentAmount = value;
            calculateDepositAmount();
            updateChineseDisplay();
            if (startDate) generateCheckList();
            break;
            
        case 'check-count':
            if (value > 99) {
                showToast('錯誤：開票張數不能超過2位數', true);
                return;
            }
            value = Math.round(value);
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
    
    const paymentCn = document.getElementById('payment-amount-chinese');
    if (paymentCn) paymentCn.innerHTML = '';
    const depositCn = document.getElementById('deposit-amount-chinese');
    if (depositCn) depositCn.innerHTML = '';
    
    const card = document.querySelector('.deposit-info-card');
    if (card) card.style.display = 'none';
    
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

function calculateDepositAmount() {
    if (totalAmount && paymentAmount && checkCount) {
        depositAmount = totalAmount - (paymentAmount * checkCount) + paymentAmount;
        if (depositAmount <= 0) {
            const depEl = document.getElementById('deposit-amount');
            if (depEl) depEl.value = '';
            showToast('錯誤：押票金額必須大於零', true);
            return;
        }
        const depEl = document.getElementById('deposit-amount');
        if (depEl) depEl.value = formatNumber(depositAmount);
        updateChineseDisplay();
        
        const depDisp = document.getElementById('deposit-amount-display');
        if (depDisp) depDisp.textContent = `押票金額：${formatNumber(depositAmount)}`;
        
        const chineseAmount = arabicToChineseNumber(depositAmount, 'financial') + ' 元整';
        const depCn = document.getElementById('deposit-amount-display-chinese');
        if (depCn) depCn.innerHTML = chineseAmount;
        
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
                tipElement.style.display = 'none';
            }
        }
    } else {
        const depEl = document.getElementById('deposit-amount');
        if (depEl) depEl.value = '';
        const depDisp = document.getElementById('deposit-amount-display');
        if (depDisp) depDisp.textContent = '';
        const depCn = document.getElementById('deposit-amount-display-chinese');
        if (depCn) depCn.innerHTML = '';
        const card = document.querySelector('.deposit-info-card');
        if (card) card.style.display = 'none';
        depositAmount = 0;
        const tipElement = document.getElementById('deposit-amount-tip');
        if (tipElement) tipElement.style.display = 'none';
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

function updateChineseDisplays() {
    updateChineseDisplay();
}

function updateChineseDisplay() {
    if (paymentAmount) {
        const chinesePayment = arabicToChineseNumber(paymentAmount, 'financial') + ' 元整';
        const el = document.getElementById('payment-amount-chinese');
        if (el) el.innerHTML = chinesePayment;
    } else {
        const el = document.getElementById('payment-amount-chinese');
        if (el) el.innerHTML = '';
    }
    
    if (depositAmount) {
        const chineseDeposit = arabicToChineseNumber(depositAmount, 'financial') + ' 元整';
        const el = document.getElementById('deposit-amount-chinese');
        if (el) el.innerHTML = chineseDeposit;
    } else {
        const el = document.getElementById('deposit-amount-chinese');
        if (el) el.innerHTML = '';
    }
}

function arabicToChineseNumber(number, type = 'financial', highlight = true) {
    if (number === 0 || !number) {
        return highlight ? '<span class="chinese-digit">零</span>' : '零';
    }
    
    const digits = type === 'financial' 
        ? ['零', '壹', '貳', '參', '肆', '伍', '陸', '柒', '捌', '玖']
        : ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
    const units = type === 'financial'
        ? ['', '拾', '佰', '仟']
        : ['', '十', '百', '千'];
    const bigUnits = ['', '萬', '億', '兆'];
    
    let numStr = Math.floor(Math.abs(number)).toString();
    let result = '';

    const chunks = [];
    for (let i = numStr.length; i > 0; i -= 4) {
        chunks.push(numStr.substring(Math.max(0, i - 4), i));
    }
    
    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        let chunkResult = '';
        let chunkZero = false;
        
        for (let j = 0; j < chunk.length; j++) {
            const digit = parseInt(chunk[j]);
            const position = chunk.length - j - 1;
            
            if (digit !== 0) {
                if (chunkZero) {
                    chunkResult += highlight ? `<span class="chinese-digit">${digits[0]}</span>` : digits[0];
                    chunkZero = false;
                }
                const digitText = highlight ? `<span class="chinese-digit">${digits[digit]}</span>` : digits[digit];
                chunkResult += digitText + units[position];
            } else {
                chunkZero = true;
            }
        }
        
        if (chunkResult !== '') {
            result = chunkResult + bigUnits[i] + result;
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

function showToast(message, isError = false) {
    let toast = document.getElementById('toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast';
        toast.className = 'toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.backgroundColor = isError ? 'rgba(231, 76, 60, 0.9)' : 'rgba(46, 204, 113, 0.9)';
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, 2000);
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

function showConfirmModal(title, content, onConfirm) {
    const titleEl = document.getElementById('confirmModalTitle');
    if (titleEl) titleEl.textContent = title || '確認';
    const contentEl = document.getElementById('confirmModalContent');
    if (contentEl) contentEl.innerHTML = content;
    const okBtn = document.getElementById('confirmModalOk');
    if (okBtn) {
        okBtn.onclick = function() {
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

function toggleHistoryPanel() {
    vibrate();
    const historyPanel = document.getElementById('historyPanel');
    if (!historyPanel) return;
    if (historyPanel.classList.contains('active')) {
        historyPanel.classList.remove('active');
    } else {
        loadCheckHistory();
        historyPanel.classList.add('active');
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
