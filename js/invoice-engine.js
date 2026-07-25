/**
 * 貸款業務工具箱 - 發票計算引擎 (Invoice Engine)
 * 負責發票金額拆解 (5% 營業稅)、雙模式鍵盤切換、歷史記錄與國字大寫轉換
 */

// 全域變數
let calculatorExpression = '0';
let lastResult = null;

// 震動反饋輔助
function vibrate(pattern = 50) {
    if (window.navigator && window.navigator.vibrate) {
        window.navigator.vibrate(pattern);
    }
}

// 初始化與時間更新
document.addEventListener('DOMContentLoaded', function() {
    initInvoiceEngine();
});

function initInvoiceEngine() {
    updateTime();
    setInterval(updateTime, 1000);
    updateResults();
    initKeyboardSwitch();
    preventSystemKeyboard();
}

function updateTime() {
    const el = document.getElementById('currentTime') || document.getElementById('current-date');
    if (!el) return;
    
    const now = new Date();
    const rocYear = now.getFullYear() - 1911;
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const date = String(now.getDate()).padStart(2, '0');
    const days = ['日', '一', '二', '三', '四', '五', '六'];
    const day = days[now.getDay()];
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    
    el.textContent = `${rocYear}年${month}月${date}日 星期${day} ${hours}:${minutes}:${seconds}`;
}

// 阻止系統軟體鍵盤彈出
function preventSystemKeyboard() {
    const inputField = document.getElementById('arabicNumber');
    if (!inputField) return;
    
    ['click', 'focus', 'touchstart'].forEach(eventType => {
        inputField.addEventListener(eventType, function(e) {
            e.preventDefault();
            this.blur();
            vibrate(30);
        });
    });
}

// 鍵盤模式切換 (直接輸入 vs 計算機)
function initKeyboardSwitch() {
    const directInputBtn = document.getElementById('direct-input-btn');
    const calculatorBtn = document.getElementById('calculator-btn');
    const directInputKeyboard = document.getElementById('direct-input-keyboard');
    const calculatorKeyboard = document.getElementById('calculator-keyboard');
    
    if (directInputBtn && calculatorBtn) {
        directInputBtn.addEventListener('click', function() {
            directInputBtn.classList.add('active');
            calculatorBtn.classList.remove('active');
            if (directInputKeyboard) directInputKeyboard.style.display = 'block';
            if (calculatorKeyboard) calculatorKeyboard.style.display = 'none';
            vibrate(30);
        });
        
        calculatorBtn.addEventListener('click', function() {
            calculatorBtn.classList.add('active');
            directInputBtn.classList.remove('active');
            if (calculatorKeyboard) calculatorKeyboard.style.display = 'block';
            if (directInputKeyboard) directInputKeyboard.style.display = 'none';
            vibrate(30);
        });
    }
}

// 發票金額計算 (5% 營業稅拆解)
function updateResults() {
    const inputEl = document.getElementById('arabicNumber');
    if (!inputEl) return;
    
    const arabicNumber = inputEl.value.trim();
    const tradEl = document.getElementById('traditionalResult');
    const finEl = document.getElementById('financialResult');
    const preTaxEl = document.getElementById('preTaxAmount');
    const taxEl = document.getElementById('taxAmount');
    
    if (!arabicNumber) {
        if (tradEl) tradEl.textContent = '';
        if (finEl) finEl.textContent = '';
        if (preTaxEl) preTaxEl.textContent = '';
        if (taxEl) taxEl.textContent = '';
        return;
    }
    
    try {
        if (!/^\d+$/.test(arabicNumber)) {
            if (tradEl) tradEl.textContent = '請輸入正整數';
            if (finEl) finEl.textContent = '請輸入正整數';
            if (preTaxEl) preTaxEl.textContent = '';
            if (taxEl) taxEl.textContent = '';
            return;
        }

        if (arabicNumber.length > 9) {
            if (tradEl) tradEl.textContent = '數值過大';
            if (finEl) finEl.textContent = '發票金額不能超過9位數';
            if (preTaxEl) preTaxEl.textContent = '';
            if (taxEl) taxEl.textContent = '';
            return;
        }
        
        const totalAmount = parseInt(arabicNumber, 10);
        const preTaxAmount = Math.round(totalAmount / 1.05);
        const taxAmount = totalAmount - preTaxAmount;
        
        if (preTaxEl) preTaxEl.textContent = preTaxAmount.toLocaleString();
        if (taxEl) taxEl.textContent = taxAmount.toLocaleString();
        
        const traditionalResult = arabicToChineseNumber(arabicNumber, 'traditional') + ' 元整';
        if (tradEl) tradEl.textContent = traditionalResult;
        
        const financialResult = arabicToChineseNumber(arabicNumber, 'financial') + ' 元整';
        if (finEl) finEl.innerHTML = financialResult;
        
        vibrate(30);
    } catch (error) {
        if (tradEl) tradEl.textContent = '轉換錯誤: ' + error.message;
        if (finEl) finEl.textContent = '轉換錯誤: ' + error.message;
        if (preTaxEl) preTaxEl.textContent = '';
        if (taxEl) taxEl.textContent = '';
    }
}

// 國字大寫與一般中文數字轉換
function arabicToChineseNumber(num, format) {
    const parts = num.split('.');
    const integerPart = parts[0];
    const decimalPart = parts.length > 1 ? parts[1] : '';
    
    let digits, units;
    if (format === 'traditional') {
        digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
        units = ['', '十', '百', '千', '萬', '十', '百', '千', '億', '十', '百', '千', '兆'];
    } else {
        digits = ['零', '壹', '貳', '參', '肆', '伍', '陸', '柒', '捌', '玖'];
        units = ['', '拾', '佰', '仟', '萬', '拾', '佰', '仟', '億', '拾', '佰', '仟', '兆'];
    }
    
    let intResult = '';
    if (integerPart === '0') {
        intResult = format === 'financial' ? '<span class="financial-digit">零</span>' : digits[0];
    } else {
        const len = integerPart.length;
        if (format !== 'financial' && len === 2 && integerPart.charAt(0) === '1') {
            intResult = units[1];
            if (integerPart.charAt(1) !== '0') {
                intResult += digits[parseInt(integerPart.charAt(1), 10)];
            }
        } else {
            let lastWasZero = false;
            
            for (let i = 0; i < len; i++) {
                const digit = parseInt(integerPart.charAt(i), 10);
                const pos = len - i - 1;
                
                if (digit !== 0) {
                    lastWasZero = false;
                    if (format === 'financial') {
                        intResult += `<span class="financial-digit">${digits[digit]}</span>${units[pos]}`;
                    } else {
                        intResult += digits[digit] + units[pos];
                    }
                } else {
                    if (pos === 4 || pos === 8) {
                        if (intResult.length > 0) {
                            if (!intResult.endsWith(units[4]) && !intResult.endsWith(units[8])) {
                                intResult += units[pos];
                            }
                        }
                    } else if (i < len - 1 && integerPart.charAt(i + 1) !== '0' && !lastWasZero) {
                        if (format === 'financial') {
                            intResult += `<span class="financial-digit">${digits[0]}</span>`;
                        } else {
                            intResult += digits[0];
                        }
                        lastWasZero = true;
                    }
                }
            }
        }
    }
    
    let decResult = '';
    if (decimalPart) {
        decResult = '點';
        for (let i = 0; i < decimalPart.length; i++) {
            const digitVal = parseInt(decimalPart.charAt(i), 10);
            if (format === 'financial') {
                decResult += `<span class="financial-digit">${digits[digitVal]}</span>`;
            } else {
                decResult += digits[digitVal];
            }
        }
    }
    
    return intResult + decResult;
}

// 直接輸入鍵盤按鍵事件
function appendNumber(num) {
    const inputField = document.getElementById('arabicNumber');
    if (!inputField) return;
    
    if (inputField.value.length >= 9) {
        showLimitNotification();
        vibrate([50, 30, 50]);
        return;
    }
    
    if (!isNaN(num)) {
        inputField.value += num;
        updateResults();
        vibrate(30);
    }
}

function clearInput() {
    const inputField = document.getElementById('arabicNumber');
    if (inputField) inputField.value = '';
    updateResults();
    vibrate([40, 40]);
}

function backspace() {
    const inputField = document.getElementById('arabicNumber');
    if (inputField) {
        inputField.value = inputField.value.slice(0, -1);
        updateResults();
        vibrate(40);
    }
}

// 計算機模式功能
function updateCalculatorDisplay() {
    const el = document.getElementById('calculator-expression');
    if (el) el.textContent = calculatorExpression;
}

function calcAddNumber(num) {
    if (calculatorExpression === '0' || lastResult !== null) {
        calculatorExpression = num.toString();
        lastResult = null;
    } else {
        calculatorExpression += num.toString();
    }
    updateCalculatorDisplay();
    vibrate(30);
}

function calcAddOperator(operator) {
    if (lastResult !== null) {
        calculatorExpression = lastResult + operator;
        lastResult = null;
    } else {
        const lastChar = calculatorExpression[calculatorExpression.length - 1];
        if (['+', '-', '*', '/'].includes(lastChar)) {
            calculatorExpression = calculatorExpression.slice(0, -1) + operator;
        } else {
            calculatorExpression += operator;
        }
    }
    updateCalculatorDisplay();
    vibrate(50);
}

function calcTaxAddition() {
    try {
        if (lastResult !== null) {
            const value = parseFloat(lastResult);
            const result = value * 1.05;
            calculatorExpression = (Math.round(result * 100) / 100).toString();
        } else {
            const sanitized = calculatorExpression.replace(/[^0-9+\-*/().]/g, '');
            if (sanitized) {
                const value = eval(sanitized);
                const result = value * 1.05;
                calculatorExpression = (Math.round(result * 100) / 100).toString();
            } else {
                calculatorExpression = "0";
            }
        }
        
        lastResult = null;
        updateCalculatorDisplay();
        
        const inputField = document.getElementById('arabicNumber');
        const calculatedValue = parseFloat(calculatorExpression);
        const integerResult = Math.floor(calculatedValue);
        if (inputField) {
            inputField.value = integerResult.toString();
            updateResults();
        }
        vibrate(50);
    } catch (error) {
        calculatorExpression = '錯誤';
        updateCalculatorDisplay();
        setTimeout(() => {
            calculatorExpression = '0';
            updateCalculatorDisplay();
        }, 1000);
    }
}

function calcClear() {
    calculatorExpression = '0';
    lastResult = null;
    updateCalculatorDisplay();
    vibrate([40, 40]);
}

function calcBackspace() {
    if (lastResult !== null) {
        calculatorExpression = '0';
        lastResult = null;
    } else if (calculatorExpression.length <= 1) {
        calculatorExpression = '0';
    } else {
        calculatorExpression = calculatorExpression.slice(0, -1);
    }
    updateCalculatorDisplay();
    vibrate(40);
}

function calcEvaluate() {
    try {
        const sanitized = calculatorExpression.replace(/[^0-9+\-*/().]/g, '');
        const result = eval(sanitized);
        const roundedResult = Math.round(result * 100) / 100;
        
        calculatorExpression = roundedResult.toString();
        lastResult = calculatorExpression;
        updateCalculatorDisplay();
        
        const inputField = document.getElementById('arabicNumber');
        const integerResult = Math.floor(roundedResult);
        
        if (inputField) {
            if (integerResult.toString().length > 9) {
                showLimitNotification();
                inputField.value = "999999999";
            } else {
                inputField.value = integerResult.toString();
            }
            updateResults();
        }
        vibrate([40, 80]);
    } catch (error) {
        calculatorExpression = '錯誤';
        lastResult = null;
        updateCalculatorDisplay();
        setTimeout(() => {
            calculatorExpression = '0';
            updateCalculatorDisplay();
        }, 1000);
    }
}

// 發票歷史記錄功能
function saveInvoiceData() {
    const inputEl = document.getElementById('arabicNumber');
    if (!inputEl) return;
    
    const totalAmount = inputEl.value.trim();
    if (!totalAmount) {
        showToast('請先輸入金額!');
        return;
    }
    
    const invoiceDate = new Date();
    const year = invoiceDate.getFullYear();
    const month = String(invoiceDate.getMonth() + 1).padStart(2, '0');
    const date = String(invoiceDate.getDate()).padStart(2, '0');
    const formattedDate = `${year}-${month}-${date}`;
    
    const preTaxEl = document.getElementById('preTaxAmount');
    const taxEl = document.getElementById('taxAmount');
    const tradEl = document.getElementById('traditionalResult');
    const finEl = document.getElementById('financialResult');
    
    const invoiceData = {
        id: new Date().getTime(),
        date: formattedDate,
        totalAmount: totalAmount,
        preTaxAmount: preTaxEl ? preTaxEl.textContent : '',
        taxAmount: taxEl ? taxEl.textContent : '',
        traditionalAmount: tradEl ? tradEl.textContent : '',
        financialAmount: finEl ? finEl.textContent : '',
        timestamp: new Date().toISOString()
    };
    
    let invoiceHistory = JSON.parse(localStorage.getItem('invoiceHistory') || '[]');
    invoiceHistory.push(invoiceData);
    localStorage.setItem('invoiceHistory', JSON.stringify(invoiceHistory));
    
    showToast('發票資訊已保存!');
}

function toggleHistoryPanel() {
    const panel = document.getElementById('historyPanel');
    if (!panel) return;
    if (panel.style.display === 'block') {
        panel.style.display = 'none';
    } else {
        panel.style.display = 'block';
        loadHistoryData();
    }
}

function loadHistoryData() {
    const historyContent = document.getElementById('historyContent');
    if (!historyContent) return;
    
    const invoiceHistory = JSON.parse(localStorage.getItem('invoiceHistory') || '[]');
    
    if (invoiceHistory.length === 0) {
        historyContent.innerHTML = '<p class="no-data" style="text-align:center; color:#aaa; padding:20px;">尚無發票記錄</p>';
        return;
    }
    
    invoiceHistory.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    let html = '<div class="history-list">';
    invoiceHistory.forEach(invoice => {
        html += `
            <div class="history-item">
                <div class="history-date" style="color:var(--button-orange); font-weight:bold;">${formatDate(invoice.date)}</div>
                <div class="history-amount">總金額: ${invoice.totalAmount}</div>
                <div class="history-details" style="font-size:13px; color:#ccc;">
                    <div>未稅: ${invoice.preTaxAmount} | 稅金: ${invoice.taxAmount}</div>
                </div>
                <div class="history-financial" style="font-size:13px; color:#aaa;">大寫: ${invoice.financialAmount}</div>
                <div class="history-actions" style="margin-top:6px; display:flex; gap:6px;">
                    <button class="detail-btn" onclick="loadInvoiceToForm(${invoice.id})" style="padding:3px 8px;">載入</button>
                    <button class="delete-btn" onclick="deleteInvoice(${invoice.id})" style="padding:3px 8px; color:#ff6666;">刪除</button>
                </div>
            </div>
        `;
    });
    html += '</div>';
    
    historyContent.innerHTML = html;
}

function formatDate(dateString) {
    const date = new Date(dateString);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}/${month}/${day}`;
}

function loadInvoiceToForm(id) {
    const invoiceHistory = JSON.parse(localStorage.getItem('invoiceHistory') || '[]');
    const invoice = invoiceHistory.find(item => item.id === id);
    
    if (invoice) {
        const inputField = document.getElementById('arabicNumber');
        if (inputField) inputField.value = invoice.totalAmount;
        updateResults();
        
        const panel = document.getElementById('historyPanel');
        if (panel) panel.style.display = 'none';
        showToast('已載入發票資料');
    }
}

function deleteInvoice(id) {
    let invoiceHistory = JSON.parse(localStorage.getItem('invoiceHistory') || '[]');
    invoiceHistory = invoiceHistory.filter(invoice => invoice.id !== id);
    localStorage.setItem('invoiceHistory', JSON.stringify(invoiceHistory));
    loadHistoryData();
    showToast('發票記錄已刪除!');
}

function confirmDeleteAll() {
    if (typeof showConfirmModal === 'function') {
        showConfirmModal('確認刪除', '確定要刪除所有發票記錄嗎？此操作無法撤銷。', deleteAllInvoices);
    } else {
        if (confirm('確定要刪除所有發票記錄嗎？')) {
            deleteAllInvoices();
        }
    }
}

function deleteAllInvoices() {
    localStorage.removeItem('invoiceHistory');
    loadHistoryData();
    showToast('所有發票記錄已刪除!');
}

function showLimitNotification() {
    let notification = document.querySelector('.limit-notification');
    if (!notification) {
        notification = document.createElement('div');
        notification.className = 'limit-notification';
        notification.innerHTML = `
            <span class="icon" style="font-size:36px;">⚠️</span>
            <div class="message" style="font-weight:bold; margin-top:6px;">發票金額不能超過9位數！</div>
        `;
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => {
                if (notification.parentNode) {
                    document.body.removeChild(notification);
                }
            }, 300);
        }, 2000);
    }
    
    setTimeout(() => {
        notification.classList.add('show');
    }, 10);
}
