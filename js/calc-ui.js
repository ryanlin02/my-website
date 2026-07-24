/**
 * 重車貸款業務工具箱 - UI 控制與交互模組 (calc-ui.js)
 * 管理 DOM 事件綁定、動態連動計算 UI 更新、彈窗對話框與數字鍵盤輸入器
 */

// 全域狀態變數 (鍵盤輸入器)
let currentInputField = null;
let calculatorValue = "0";
let calculatorOperator = null;
let calculatorFirstValue = null;
let calculatorWaitingForSecondValue = false;
let calculatorHistory = "";

/**
 * 觸覺震動回饋 helper
 */
function vibrate() {
    if (navigator.vibrate) {
        navigator.vibrate(30);
    }
}

/**
 * 時鐘即時更新
 */
function updateTime() {
    const timeDisplay = document.getElementById('currentTime');
    if (!timeDisplay) return;
    const now = new Date();
    const rocYear = now.getFullYear() - 1911;
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const date = String(now.getDate()).padStart(2, '0');
    const days = ['日', '一', '二', '三', '四', '五', '六'];
    const day = days[now.getDay()];
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    
    timeDisplay.textContent = `${rocYear}年${month}月${date}日 星期${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * 數值變化過渡動畫
 */
function animateValueChange(elementId) {
    const element = document.getElementById(elementId);
    if (!element) return;
    element.classList.remove('value-changed');
    void element.offsetWidth; // 觸發重繪
    element.classList.add('value-changed');
}

/**
 * 主推算連動：依據 Period/Rate/Principal 計算 Payment
 */
function calculatePayment() {
    const period = parseFloat(document.getElementById('period').value);
    const rate = parseFloat(document.getElementById('rate').value);
    const principal = parseFloat(document.getElementById('principal').value.replace(/,/g, ''));
    
    const filledFields = countFilledFields();
    const shouldWarn = filledFields >= 3;
    
    if (shouldWarn) {
        if (isNaN(period) || period <= 0) {
            showToast('請輸入有效的期數', true);
            return;
        }
        if (isNaN(rate) || rate <= 0) {
            showToast('請輸入有效的利率', true);
            return;
        }
        if (isNaN(principal) || principal <= 0) {
            showToast('請輸入有效的本金', true);
            return;
        }
    } else {
        if (isNaN(period) || isNaN(rate) || isNaN(principal) || 
            period <= 0 || rate <= 0 || principal <= 0) {
            return;
        }
    }
    
    try {
        const safeRate = Math.min(Math.max(rate, 0.0001), 50);
        const safePeriod = Math.min(Math.max(period, 1), 999);
        const payment = PMT(safeRate, safePeriod, principal);
        
        if (isNaN(payment) || !isFinite(payment) || payment <= 0) {
            if (shouldWarn) showToast('計算結果無效，請檢查輸入值', true);
            return;
        }
        
        document.getElementById('payment').value = formatNumberWithCommas(Math.round(payment));
        updateAllFields();
    } catch (error) {
        console.error('期繳金額計算錯誤:', error);
        if (shouldWarn) showToast('計算期繳金額時出錯', true);
    }
}

/**
 * 反推連動：依據 Payment/Period/Principal 計算 Rate
 */
function calculateRate() {
    const period = parseFloat(document.getElementById('period').value);
    const principal = parseFloat(document.getElementById('principal').value.replace(/,/g, ''));
    const payment = parseFloat(document.getElementById('payment').value.replace(/,/g, ''));
    
    const filledFields = countFilledFields();
    const shouldWarn = filledFields >= 3;
    
    if (shouldWarn) {
        if (isNaN(period) || period <= 0) {
            showToast('請輸入有效的期數', true);
            return;
        }
        if (isNaN(principal) || principal <= 0) {
            showToast('請輸入有效的本金', true);
            return;
        }
        if (isNaN(payment) || payment <= 0) {
            showToast('請輸入有效的期繳金額', true);
            return;
        }
        if (payment * period <= principal) {
            showToast('期繳總額必須大於本金才能計算有效利率', true);
            return;
        }
    } else {
        if (isNaN(period) || isNaN(principal) || isNaN(payment) || 
            period <= 0 || principal <= 0 || payment <= 0 ||
            payment * period <= principal) {
            return;
        }
    }
    
    try {
        const rate = RATE(period, payment, principal);
        if (isNaN(rate) || !isFinite(rate) || rate < 0) {
            if (shouldWarn) showToast('利率計算結果無效，請檢查輸入值', true);
            return;
        }
        
        if (rate > 20) {
            showToast('警告：計算結果顯示利率超過20%，可能不符合一般貸款條件', true);
        }
        
        document.getElementById('rate').value = rate.toFixed(4);
        updateAllFields();
    } catch (error) {
        console.error('利率計算錯誤:', error);
        if (shouldWarn) showToast('計算利率時出錯', true);
    }
}

/**
 * 全動態衍生指標即時更新
 */
function updateAllFields() {
    const period = parseFloat(document.getElementById('period').value);
    const rate = parseFloat(document.getElementById('rate').value);
    const principal = parseFloat(document.getElementById('principal').value.replace(/,/g, '')) || 0;
    const payment = parseFloat(document.getElementById('payment').value.replace(/,/g, '')) || 0;
    const monthlyCostValue = document.getElementById('monthlyCost').value;
    const monthlyCost = monthlyCostValue && monthlyCostValue.trim() !== '' ? parseFloat(monthlyCostValue) : 0;

    const periodInput = document.getElementById('period');
    if (period <= 12) {
        periodInput.classList.add('warning-text');
    } else {
        periodInput.classList.remove('warning-text');
    }

    const hasAllRequiredValues = period && rate && principal && payment && 
                                !isNaN(period) && !isNaN(rate) && !isNaN(principal) && !isNaN(payment);

    // 總繳款
    const totalPaymentField = document.getElementById('totalPayment');
    if (hasAllRequiredValues) {
        totalPaymentField.value = formatNumberWithCommas(Math.round(payment * period));
    } else {
        totalPaymentField.value = '';
    }

    // 總利息
    const totalInterestField = document.getElementById('totalInterest');
    if (hasAllRequiredValues) {
        const totalInterest = (payment * period) - principal;
        totalInterestField.value = formatNumberWithCommas(Math.round(totalInterest));
    } else {
        totalInterestField.value = '';
    }

    // 每年/每月利息
    const yearlyInterestField = document.getElementById('yearlyInterest');
    const monthlyInterestField = document.getElementById('monthlyInterest');
    if (hasAllRequiredValues) {
        const totalInterest = (payment * period) - principal;
        const yearlyInterest = (totalInterest / period) * 12;
        yearlyInterestField.value = formatNumberWithCommas(Math.round(yearlyInterest));
        monthlyInterestField.value = formatNumberWithCommas(Math.round(yearlyInterest / 12));
    } else {
        yearlyInterestField.value = '';
        monthlyInterestField.value = '';
    }

    // 稅金 (5%)
    const taxField = document.getElementById('tax');
    if (hasAllRequiredValues) {
        const totalInterest = (payment * period) - principal;
        const tax = totalInterest / 21;
        taxField.value = formatNumberWithCommas(tax.toFixed(2));
    } else {
        taxField.value = '';
    }

    // 稅後利率
    const afterTaxRateInput = document.getElementById('afterTaxRate');
    if (hasAllRequiredValues) {
        const totalInterest = (payment * period) - principal;
        const tax = totalInterest / 21;
        const afterTaxRate = RATE(period, payment, principal + tax);
        afterTaxRateInput.value = afterTaxRate.toFixed(4);
        
        if (afterTaxRate > 20 || afterTaxRate <= 2.5) {
            afterTaxRateInput.classList.add('warning-text');
        } else {
            afterTaxRateInput.classList.remove('warning-text');
        }
    } else {
        afterTaxRateInput.value = '';
        afterTaxRateInput.classList.remove('warning-text');
    }

    // 佣金格式化與警示
    const commissionField = document.getElementById('commission');
    const commissionValue = commissionField.value.replace(/,/g, '');
    if (commissionValue && commissionValue.trim() !== '') {
        const commission = parseFloat(commissionValue) || 0;
        commissionField.value = formatNumberWithCommas(Math.round(commission));
    }
    const commission = parseFloat(commissionField.value.replace(/,/g, '')) || 0;
    
    if (hasAllRequiredValues) {
        const totalInterest = (payment * period) - principal;
        if (commission >= totalInterest * 0.45) {
            commissionField.classList.add('warning-text');
        } else {
            commissionField.classList.remove('warning-text');
        }
    } else {
        commissionField.classList.remove('warning-text');
    }

    // 佣金比例
    const commissionRatioInput = document.getElementById('commissionRatio');
    if (principal > 0 && commission > 0) {
        const commissionRatio = commission / principal * 100;
        commissionRatioInput.value = commissionRatio.toFixed(2);
        if (commissionRatio > 5) {
            commissionRatioInput.classList.add('warning-text');
        } else {
            commissionRatioInput.classList.remove('warning-text');
        }
    } else {
        commissionRatioInput.value = '';
        commissionRatioInput.classList.remove('warning-text');
    }

    // 佣後利率
    const afterCommissionOnlyRateInput = document.getElementById('afterCommissionOnlyRate');
    if (hasAllRequiredValues) {
        try {
            const afterCommissionOnlyRate = RATE(period, payment, principal + commission);
            if (isNaN(afterCommissionOnlyRate) || !isFinite(afterCommissionOnlyRate)) {
                afterCommissionOnlyRateInput.value = "計算錯誤";
                afterCommissionOnlyRateInput.classList.add('warning-text');
            } else {
                afterCommissionOnlyRateInput.value = afterCommissionOnlyRate.toFixed(4);
                if (afterCommissionOnlyRate <= 2.5) {
                    afterCommissionOnlyRateInput.classList.add('warning-text');
                } else {
                    afterCommissionOnlyRateInput.classList.remove('warning-text');
                }
            }
        } catch (e) {
            afterCommissionOnlyRateInput.value = "計算錯誤";
            afterCommissionOnlyRateInput.classList.add('warning-text');
        }
    } else {
        afterCommissionOnlyRateInput.value = '';
        afterCommissionOnlyRateInput.classList.remove('warning-text');
    }

    // 稅佣後利率 & Spread
    const afterCommissionRateInput = document.getElementById('afterCommissionRate');
    const spreadInput = document.getElementById('spread');
    if (hasAllRequiredValues) {
        try {
            const totalInterest = (payment * period) - principal;
            const tax = totalInterest / 21;
            const totalCost = principal + tax + commission;
            
            if (totalCost >= payment * period) {
                afterCommissionRateInput.value = "N/A";
                afterCommissionRateInput.classList.add('warning-text');
                spreadInput.value = "N/A";
                spreadInput.classList.add('warning-text');
            } else {
                const afterCommissionRate = RATE(period, payment, principal + tax + commission);
                if (isNaN(afterCommissionRate) || !isFinite(afterCommissionRate)) {
                    afterCommissionRateInput.value = "計算錯誤";
                    afterCommissionRateInput.classList.add('warning-text');
                } else {
                    afterCommissionRateInput.value = afterCommissionRate.toFixed(4);
                    if (afterCommissionRate <= 2.5) {
                        afterCommissionRateInput.classList.add('warning-text');
                    } else {
                        afterCommissionRateInput.classList.remove('warning-text');
                    }
                    
                    const spread = afterCommissionRate - monthlyCost;
                    spreadInput.value = spread.toFixed(4);
                    if (spread <= 0) {
                        spreadInput.classList.add('warning-text');
                    } else {
                        spreadInput.classList.remove('warning-text');
                    }
                }
            }
        } catch (e) {
            afterCommissionRateInput.value = "計算錯誤";
            afterCommissionRateInput.classList.add('warning-text');
            spreadInput.value = '';
            spreadInput.classList.remove('warning-text');
        }
    } else {
        afterCommissionRateInput.value = '';
        afterCommissionRateInput.classList.remove('warning-text');
        spreadInput.value = '';
        spreadInput.classList.remove('warning-text');
    }
    
    // 百萬與一萬利息
    if (rate > 0) {
        const millionPayment = PMT(rate, 12, 1000000);
        const annualMillionInterest = (millionPayment * 12) - 1000000;
        document.getElementById('annualMillionInterest').value = formatNumberWithCommas(Math.round(annualMillionInterest));
        document.getElementById('monthlyMillionInterest').value = formatNumberWithCommas(Math.round(annualMillionInterest / 12));
        
        const tenThousandPayment = PMT(rate, 12, 10000);
        const annualTenThousandInterest = (tenThousandPayment * 12) - 10000;
        document.getElementById('annualTenThousandInterest').value = formatNumberWithCommas(Math.round(annualTenThousandInterest));
        document.getElementById('monthlyTenThousandInterest').value = formatNumberWithCommas(Math.round(annualTenThousandInterest / 12));
    } else {
        document.getElementById('annualMillionInterest').value = '';
        document.getElementById('monthlyMillionInterest').value = '';
        document.getElementById('annualTenThousandInterest').value = '';
        document.getElementById('monthlyTenThousandInterest').value = '';
    }
    
    // NPV 獲利指標估算
    const npvValue = calculateNPV(payment, period, principal, monthlyCost);
    const fundingCostInput = document.getElementById('fundingCost');
    if (hasAllRequiredValues) {
        fundingCostInput.value = formatNumberWithCommas(npvValue);
        if (npvValue < 0) {
            fundingCostInput.classList.add('warning-text');
        } else {
            fundingCostInput.classList.remove('warning-text');
        }
    } else {
        fundingCostInput.value = '';
        fundingCostInput.classList.remove('warning-text');
    }

    // 同步更新固定頂部 Header
    const headerAfterCommissionOnlyRate = document.getElementById('headerAfterCommissionOnlyRate');
    const headerAfterCommissionRate = document.getElementById('headerAfterCommissionRate');

    if (headerAfterCommissionOnlyRate) {
        headerAfterCommissionOnlyRate.value = document.getElementById('afterCommissionOnlyRate').value;
        if (document.getElementById('afterCommissionOnlyRate').classList.contains('warning-text')) {
            headerAfterCommissionOnlyRate.classList.add('warning-text');
        } else {
            headerAfterCommissionOnlyRate.classList.remove('warning-text');
        }
    }

    if (headerAfterCommissionRate) {
        headerAfterCommissionRate.value = document.getElementById('afterCommissionRate').value;
        if (document.getElementById('afterCommissionRate').classList.contains('warning-text')) {
            headerAfterCommissionRate.classList.add('warning-text');
        } else {
            headerAfterCommissionRate.classList.remove('warning-text');
        }
    }

    // 自動備份現狀
    try {
        const autoSaveData = {
            period: document.getElementById('period').value,
            rate: document.getElementById('rate').value,
            principal: document.getElementById('principal').value,
            payment: document.getElementById('payment').value,
            commission: document.getElementById('commission').value,
            monthlyCost: document.getElementById('monthlyCost').value,
            timestamp: new Date().toISOString(),
            version: 'v2',
            environment: (window.self !== window.top) ? 'iframe' : 'standalone'
        };
        
        if (autoSaveData.period || autoSaveData.rate || autoSaveData.principal || autoSaveData.payment) {
            localStorage.setItem('loanCalculatorAutoSave', JSON.stringify(autoSaveData));
            if (autoSaveData.environment === 'iframe') {
                localStorage.setItem('loanCalculatorIframeBackup', JSON.stringify(autoSaveData));
            }
        }
    } catch (e) {}
}

/* 欄位微調與快捷按鈕處理 */
function clearField(fieldId) {
    vibrate();
    const elem = document.getElementById(fieldId);
    if (elem) elem.value = '';
}

function clearCommission() {
    vibrate();
    const elem = document.getElementById('commission');
    if (elem) elem.value = '';
    updateAllFields();
}

function adjustPeriod(delta) {
    vibrate();
    const periodField = document.getElementById('period');
    const currentValue = parseFloat(periodField.value) || 0;
    periodField.value = Math.max(0, currentValue + delta);
    calculatePayment();
}

function setPeriod(value) {
    vibrate();
    document.getElementById('period').value = value;
    const rate = parseFloat(document.getElementById('rate').value);
    const principal = parseFloat(document.getElementById('principal').value.replace(/,/g, ''));
    if (!isNaN(rate) && !isNaN(principal) && rate > 0 && principal > 0) {
        calculatePayment();
    }
}

function adjustRate(delta) {
    vibrate();
    const rateField = document.getElementById('rate');
    const currentValue = parseFloat(rateField.value) || 0;
    const newRate = currentValue + delta;
    if (newRate > 20) showToast('警告：利率超過20%，可能不符合一般貸款條件', true);
    rateField.value = newRate.toFixed(4);
    calculatePayment();
}

function setRate(value) {
    vibrate();
    if (value > 20) showToast('警告：利率超過20%，可能不符合一般貸款條件', true);
    document.getElementById('rate').value = value;
    calculatePayment();
}

function adjustCommission(delta) {
    vibrate();
    const commissionField = document.getElementById('commission');
    let currentValue = 0;
    if (commissionField.value && commissionField.value.trim() !== '') {
        currentValue = parseFloat(commissionField.value.replace(/,/g, '')) || 0;
    }
    const newValue = Math.max(0, currentValue + delta);
    if (newValue === 0 && (!commissionField.value || commissionField.value.trim() === '')) {
        commissionField.value = '';
    } else {
        commissionField.value = formatNumberWithCommas(Math.floor(newValue));
    }
    updateAllFields();
}

function setCommissionPercent(percent) {
    vibrate();
    const principal = parseFloat(document.getElementById('principal').value.replace(/,/g, '')) || 0;
    if (principal <= 0) {
        showToast('請先輸入有效的本金金額', true);
        return;
    }
    const commissionAmount = Math.floor(principal * (percent / 100));
    document.getElementById('commission').value = formatNumberWithCommas(commissionAmount);
    updateAllFields();
}

function adjustPrincipal(delta) {
    vibrate();
    const principalField = document.getElementById('principal');
    const currentValue = parseFloat(principalField.value.replace(/,/g, '')) || 0;
    const newValue = Math.max(1, Math.floor(currentValue + delta));
    principalField.value = formatNumberWithCommas(newValue);
    calculatePayment();
    updateAllFields();
}

function roundPayment(direction, base) {
    vibrate();
    const paymentField = document.getElementById('payment');
    let value = parseFloat(paymentField.value.replace(/,/g, '')) || 0;
    if (direction === 'down') {
        value = Math.floor(value / base) * base;
    } else {
        value = Math.ceil(value / base) * base;
    }
    value = Math.max(1, Math.round(value));
    paymentField.value = formatNumberWithCommas(value);
    calculateRate();
}

function adjustPayment(delta) {
    vibrate();
    const paymentField = document.getElementById('payment');
    const currentValue = parseFloat(paymentField.value.replace(/,/g, '')) || 0;
    const newValue = Math.max(1, Math.round(currentValue + delta));
    paymentField.value = formatNumberWithCommas(newValue);
    calculateRate();
}

function clearAllFieldsExceptMonthlyCost() {
    vibrate();
    const fieldsToReset = [
        'period', 'rate', 'principal', 'payment', 
        'totalPayment', 'totalInterest', 'tax', 'afterTaxRate', 
        'commission', 'commissionRatio', 'afterCommissionRate',
        'afterCommissionOnlyRate', 'annualMillionInterest', 'monthlyMillionInterest',
        'annualTenThousandInterest', 'monthlyTenThousandInterest',
        'spread', 'fundingCost', 'monthlyInterest', 'yearlyInterest',
    ];
    
    fieldsToReset.forEach(fieldId => {
        const element = document.getElementById(fieldId);
        if (element) {
            element.value = '';
            element.classList.remove('warning-text');
        }
    });

    const monthlyCostElement = document.getElementById('monthlyCost');
    if (monthlyCostElement) monthlyCostElement.value = '2';
    
    const headerAfterCommissionOnlyRate = document.getElementById('headerAfterCommissionOnlyRate');
    const headerAfterCommissionRate = document.getElementById('headerAfterCommissionRate');
    if (headerAfterCommissionOnlyRate) {
        headerAfterCommissionOnlyRate.value = '';
        headerAfterCommissionOnlyRate.classList.remove('warning-text');
    }
    if (headerAfterCommissionRate) {
        headerAfterCommissionRate.value = '';
        headerAfterCommissionRate.classList.remove('warning-text');
    }

    localStorage.removeItem('loanCalculatorAutoSave');
    showToast('已清空所有欄位');
}

function resetMonthlyCost() {
    vibrate();
    document.getElementById('monthlyCost').value = '2';
    updateAllFields();
    showToast('已設定資金成本為預設值 2%');
}

/* 模態框與 Toast 視窗介面處理 */
function toggleHistoryPanel() {
    const panel = document.getElementById('historyPanel');
    if (!panel) return;
    if (panel.style.display === 'block') {
        panel.style.display = 'none';
    } else {
        panel.style.display = 'block';
        if (typeof loadHistoryData === 'function') loadHistoryData();
    }
}

function showModal(title, content) {
    document.getElementById('modalTitle').textContent = title || '提示';
    document.getElementById('modalContent').innerHTML = content;
    document.getElementById('modalOverlay').style.display = 'flex';
}

function hideModal() {
    document.getElementById('modalOverlay').style.display = 'none';
}

function showConfirmModal(title, content, confirmCallback) {
    document.getElementById('confirmModalTitle').textContent = title || '確認';
    document.getElementById('confirmModalContent').innerHTML = content;
    document.getElementById('confirmModalOverlay').style.display = 'flex';
    
    const confirmButton = document.getElementById('confirmModalOk');
    const newConfirmButton = confirmButton.cloneNode(true);
    confirmButton.parentNode.replaceChild(newConfirmButton, confirmButton);
    
    newConfirmButton.addEventListener('click', function() {
        hideConfirmModal();
        if (typeof confirmCallback === 'function') confirmCallback();
    });
}

function hideConfirmModal() {
    document.getElementById('confirmModalOverlay').style.display = 'none';
}

function showToast(message, isError = false, duration = 2000) {
    const existingToast = document.querySelector('.toast-message');
    if (existingToast && existingToast.parentNode) {
        existingToast.parentNode.removeChild(existingToast);
    }
    
    const toast = document.createElement('div');
    toast.className = 'toast-message';
    if (isError) toast.classList.add('toast-error');
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => {
            if (document.body.contains(toast)) document.body.removeChild(toast);
        }, 500);
    }, duration);
}

/* 數字輸入器 (Calculator Pad Modal) 邏輯 */
function openCalculator(inputId, title) {
    currentInputField = inputId;
    document.getElementById('inputModalTitle').textContent = title;
    
    const currentValue = document.getElementById(inputId).value;
    if (currentValue && currentValue !== '') {
        calculatorValue = currentValue.replace(/,/g, '');
    } else {
        calculatorValue = "0";
    }
    
    document.getElementById('calculatorDisplay').textContent = calculatorValue;
    calculatorOperator = null;
    calculatorFirstValue = null;
    calculatorWaitingForSecondValue = false;
    calculatorHistory = "";
    document.getElementById('calculatorHistory').textContent = "";
    document.getElementById('historyScrollIndicator').style.opacity = '0';
    document.getElementById('numberInputModal').style.display = 'flex';
    vibrate();
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.style.display = 'none';
    vibrate();
}

function calculatorInput(num) {
    if (calculatorWaitingForSecondValue) {
        calculatorValue = num.toString();
        calculatorWaitingForSecondValue = false;
    } else {
        calculatorValue = calculatorValue === '0' ? num.toString() : calculatorValue + num.toString();
    }
    document.getElementById('calculatorDisplay').textContent = calculatorValue;
    vibrate();
}

function calculatorDecimal() {
    if (calculatorWaitingForSecondValue) {
        calculatorValue = '0';
        calculatorWaitingForSecondValue = false;
    }
    if (!calculatorValue.includes('.')) {
        calculatorValue += '.';
    }
    document.getElementById('calculatorDisplay').textContent = calculatorValue;
    vibrate();
}

function calculatorClear() {
    calculatorValue = '0';
    calculatorOperator = null;
    calculatorFirstValue = null;
    calculatorWaitingForSecondValue = false;
    calculatorHistory = "";
    document.getElementById('calculatorDisplay').textContent = calculatorValue;
    document.getElementById('calculatorHistory').textContent = "";
    document.getElementById('historyScrollIndicator').style.opacity = '0';
    vibrate();
}

function calculatorBackspace() {
    if (calculatorValue.length > 1) {
        calculatorValue = calculatorValue.slice(0, -1);
    } else {
        calculatorValue = '0';
    }
    document.getElementById('calculatorDisplay').textContent = calculatorValue;
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
        calculatorHistory += (calculatorHistory.length > 20 ? "\n" : "") + calculatorValue + opSymbol;
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
    
    document.getElementById('calculatorDisplay').textContent = calculatorValue;
    calculatorHistory = completeExpression.length > 30 ? calculatorValue : completeExpression;
    updateCalculatorHistory();
    
    calculatorOperator = null;
    calculatorFirstValue = parseFloat(calculatorValue);
    calculatorWaitingForSecondValue = true;
    vibrate();
}

function submitCalculatorValue() {
    if (!currentInputField) return;
    
    let value = parseFloat(calculatorValue);
    if (isNaN(value)) value = 0;
    
    switch (currentInputField) {
        case 'period':
            value = Math.floor(value);
            if (value < 0 || value > 999) {
                showToast('錯誤：請輸入有效期數 (0-999)', true);
                return;
            }
            document.getElementById(currentInputField).value = value;
            break;
            
        case 'rate':
            if (value < 0) {
                showToast('錯誤：利率不能為負數', true);
                return;
            }
            if (value > 20) showToast('警告：利率超過20%，可能不符合一般貸款條件', true);
            document.getElementById(currentInputField).value = value.toFixed(4);
            break;
            
        case 'principal':
            value = Math.floor(value);
            if (value <= 0 || value > 999999999) {
                showToast('錯誤：請輸入有效本金金額', true);
                return;
            }
            document.getElementById(currentInputField).value = formatNumberWithCommas(value);
            break;
            
        case 'payment':
            value = Math.max(1, Math.round(value));
            if (value > 999999) {
                showToast('錯誤：期繳金額過大', true);
                return;
            }
            document.getElementById(currentInputField).value = formatNumberWithCommas(value);
            break;
            
        case 'commission':
            value = Math.floor(value);
            if (value < 0 || value > 999999) {
                showToast('錯誤：請輸入有效推廣費用', true);
                return;
            }
            document.getElementById(currentInputField).value = formatNumberWithCommas(value);
            break;

        case 'monthlyCost':
            if (value < 0 || value > 20) {
                showToast('錯誤：資金成本應介於 0 與 20%', true);
                return;
            }
            value = Math.max(0, Math.min(20, value));
            document.getElementById(currentInputField).value = value.toFixed(4);
            break;
    }
    
    closeModal('numberInputModal');
    
    if (currentInputField === 'period' || currentInputField === 'rate' || currentInputField === 'principal') {
        calculatePayment();
    } else if (currentInputField === 'payment') {
        calculateRate();
    } else {
        updateAllFields();
    }
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

/* 頁面加載初始化與事件綁定 */
window.onload = function() {
    const afterCommissionOnlyRateRow = document.getElementById('afterCommissionOnlyRate')?.closest('.row');
    const afterCommissionRateRow = document.getElementById('afterCommissionRate')?.closest('.row');
    if (afterCommissionOnlyRateRow) afterCommissionOnlyRateRow.style.display = 'none';
    if (afterCommissionRateRow) afterCommissionRateRow.style.display = 'none';

    localStorage.removeItem('selectedTheme');
    updateTime();
    setInterval(updateTime, 1000);

    if (typeof restoreAutoData === 'function') {
        restoreAutoData();
    }
};

document.addEventListener('DOMContentLoaded', function() {
    document.body.classList.add('loaded');

    // 點擊輸入框彈出數字鍵盤
    const inputFieldsConfig = [
        { id: 'period', title: '請輸入【期數】' },
        { id: 'rate', title: '請輸入【稅前利率】' },
        { id: 'principal', title: '請輸入【本金】' },
        { id: 'payment', title: '請輸入【期繳】' },
        { id: 'commission', title: '請輸入【推廣】' },
        { id: 'monthlyCost', title: '請輸入【資金成本】' }
    ];

    inputFieldsConfig.forEach(cfg => {
        const elem = document.getElementById(cfg.id);
        if (elem) {
            elem.addEventListener('click', function() {
                openCalculator(cfg.id, cfg.title);
            });
            elem.addEventListener('input', updateAllFields);
            elem.addEventListener('change', updateAllFields);
        }
    });

    // 點擊 Modal 遮罩關閉
    ['numberInputModal', 'modalOverlay', 'confirmModalOverlay', 'historyPanel'].forEach(id => {
        const modalElem = document.getElementById(id);
        if (modalElem) {
            modalElem.addEventListener('click', function(event) {
                if (event.target === this) {
                    if (id === 'historyPanel') {
                        this.style.display = 'none';
                    } else {
                        closeModal(id);
                    }
                }
            });
        }
    });

    // 鍵盤計算歷史觸控/滑鼠拖曳滾動
    const historyElement = document.getElementById('calculatorHistory');
    if (historyElement) {
        let isScrolling = false;
        let startX, scrollLeft;

        historyElement.addEventListener('mousedown', (e) => {
            isScrolling = true;
            startX = e.pageX - historyElement.offsetLeft;
            scrollLeft = historyElement.scrollLeft;
        });
        historyElement.addEventListener('mouseleave', () => { isScrolling = false; });
        historyElement.addEventListener('mouseup', () => { isScrolling = false; });
        historyElement.addEventListener('mousemove', (e) => {
            if (!isScrolling) return;
            e.preventDefault();
            const x = e.pageX - historyElement.offsetLeft;
            historyElement.scrollLeft = scrollLeft - (x - startX) * 2;
        });

        historyElement.addEventListener('touchstart', (e) => {
            isScrolling = true;
            startX = e.touches[0].pageX - historyElement.offsetLeft;
            scrollLeft = historyElement.scrollLeft;
        });
        historyElement.addEventListener('touchend', () => { isScrolling = false; });
        historyElement.addEventListener('touchmove', (e) => {
            if (!isScrolling) return;
            const x = e.touches[0].pageX - historyElement.offsetLeft;
            historyElement.scrollLeft = scrollLeft - (x - startX) * 2;
        });
    }
});
