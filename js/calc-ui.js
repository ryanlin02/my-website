/**
 * 重車貸款業務工具箱 - UI 控制與交互模組 (calc-ui.js)
 * 管理 DOM 事件綁定、動態連動計算 UI 更新、彈窗對話框與數字鍵盤輸入器
 */

/* ------------------------------------------------------------
 * 警告狀態記錄
 * 用途：讓「利率超過門檻」與「佣金比例超過門檻」的提示訊息
 *       只在剛跨過門檻時跳一次，避免連按調整鍵時被提示洗版。
 *       欄位的紅字則會持續顯示，不受這裡影響。
 * ------------------------------------------------------------ */
let rateWarnShown = false;      // 利率是否已提示過
let ratioWarnShown = false;     // 佣金比例是否已提示過

/**
 * 跨門檻才提示一次的共用邏輯
 * @param {boolean} isOver 目前是否超標
 * @param {boolean} alreadyShown 先前是否已提示過
 * @param {string} message 要顯示的提示文字
 * @returns {boolean} 更新後的「已提示過」狀態
 */
function warnOnCross(isOver, alreadyShown, message) {
    if (isOver && !alreadyShown) {
        if (typeof showToast === 'function') showToast(message, true);
        return true;
    }
    if (!isOver) return false;   // 回到門檻以下，重置，下次超標會再提示
    return alreadyShown;
}

// 利率超標提示（供各輸入路徑呼叫）
function warnRateIfOver(rate) {
    rateWarnShown = warnOnCross(
        rate > LIMITS.RATE_WARN,
        rateWarnShown,
        `警告：利率超過 ${LIMITS.RATE_WARN}%，可能不符合一般貸款條件`
    );
}

/* ------------------------------------------------------------
 * 【2026/07 修正 B1】
 * 鍵盤共用狀態（currentInputField、calculatorValue 等 6 個變數）
 * 與 vibrate() 已移至 js/common-keypad.js，與支票頁共用同一份實作。
 * 該檔案必須排在本檔案之前載入（calculator.html 已調整）。
 * ------------------------------------------------------------ */

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
        // 上限與 RATE() 的搜尋範圍一致，避免「欄位顯示 60% 卻用 50% 計算」的落差
        const safeRate = Math.min(Math.max(rate, 0.0001), LIMITS.MAX_RATE);
        const safePeriod = Math.min(Math.max(period, 1), LIMITS.MAX_PERIOD);
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
        if (!isValidRate(rate)) {
            // 反推結果超出可計算範圍（高於 MAX_RATE）
            if (shouldWarn) showToast(`利率超出可計算範圍（高於 ${LIMITS.MAX_RATE}%），請檢查期繳與本金`, true);
            return;
        }

        // 超過警告門檻時提醒，但仍然完成計算
        warnRateIfOver(rate);

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

        // 防呆：超出可計算範圍時顯示提示文字，不可讓 NaN 直接印在欄位上
        if (!isValidRate(afterTaxRate)) {
            afterTaxRateInput.value = RATE_OUT_OF_RANGE_TEXT;
            afterTaxRateInput.classList.add('warning-text');
        } else {
            afterTaxRateInput.value = afterTaxRate.toFixed(4);

            if (afterTaxRate > LIMITS.RATE_WARN || afterTaxRate <= 2.5) {
                afterTaxRateInput.classList.add('warning-text');
            } else {
                afterTaxRateInput.classList.remove('warning-text');
            }
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

        const ratioOver = commissionRatio > LIMITS.RATIO_WARN;

        // 紅字：只要超標就持續顯示
        if (ratioOver) {
            commissionRatioInput.classList.add('warning-text');
        } else {
            commissionRatioInput.classList.remove('warning-text');
        }

        // 提示訊息：只在剛跨過門檻時跳一次，連按調整鍵不會重複跳
        ratioWarnShown = warnOnCross(
            ratioOver,
            ratioWarnShown,
            `警告：佣金比例超過 ${LIMITS.RATIO_WARN}%，已超出內部規範標準`
        );
    } else {
        commissionRatioInput.value = '';
        commissionRatioInput.classList.remove('warning-text');
        ratioWarnShown = false;   // 清空後重置，下次超標會再提示
    }

    // 佣後利率
    const afterCommissionOnlyRateInput = document.getElementById('afterCommissionOnlyRate');
    if (hasAllRequiredValues) {
        try {
            const afterCommissionOnlyRate = RATE(period, payment, principal + commission);
            if (!isValidRate(afterCommissionOnlyRate)) {
                afterCommissionOnlyRateInput.value = RATE_OUT_OF_RANGE_TEXT;
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
                if (!isValidRate(afterCommissionRate)) {
                    afterCommissionRateInput.value = RATE_OUT_OF_RANGE_TEXT;
                    afterCommissionRateInput.classList.add('warning-text');
                    spreadInput.value = RATE_OUT_OF_RANGE_TEXT;
                    spreadInput.classList.add('warning-text');
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
    // 夾在 0 ~ 硬上限之間，確保欄位顯示值與實際計算值一致
    const newRate = Math.max(0, Math.min(currentValue + delta, LIMITS.MAX_RATE));
    warnRateIfOver(newRate);
    rateField.value = newRate.toFixed(4);
    calculatePayment();
}

function setRate(value) {
    vibrate();
    const newRate = Math.max(0, Math.min(value, LIMITS.MAX_RATE));
    warnRateIfOver(newRate);
    document.getElementById('rate').value = newRate;
    calculatePayment();
}

function adjustCommission(delta) {
    vibrate();
    const commissionField = document.getElementById('commission');
    let currentValue = 0;
    if (commissionField.value && commissionField.value.trim() !== '') {
        currentValue = parseFloat(commissionField.value.replace(/,/g, '')) || 0;
    }
    // 與數字鍵盤輸入套用同一組上限
    const newValue = Math.max(0, Math.min(currentValue + delta, LIMITS.MAX_AMOUNT));
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
    const commissionAmount = Math.min(Math.floor(principal * (percent / 100)), LIMITS.MAX_AMOUNT);
    document.getElementById('commission').value = formatNumberWithCommas(commissionAmount);
    updateAllFields();
}

function adjustPrincipal(delta) {
    vibrate();
    const principalField = document.getElementById('principal');
    const currentValue = parseFloat(principalField.value.replace(/,/g, '')) || 0;
    const newValue = Math.max(1, Math.min(Math.floor(currentValue + delta), LIMITS.MAX_AMOUNT));
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
    value = Math.max(1, Math.min(Math.round(value), LIMITS.MAX_AMOUNT));
    paymentField.value = formatNumberWithCommas(value);
    calculateRate();
}

function adjustPayment(delta) {
    vibrate();
    const paymentField = document.getElementById('payment');
    const currentValue = parseFloat(paymentField.value.replace(/,/g, '')) || 0;
    const newValue = Math.max(1, Math.min(Math.round(currentValue + delta), LIMITS.MAX_AMOUNT));
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

    // 重置警告狀態，清空後再次超標時會重新提示
    rateWarnShown = false;
    ratioWarnShown = false;

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

/* showModal / hideModal / showConfirmModal / hideConfirmModal / showToast
 * openCalculator / closeModal / calculatorInput / calculatorDecimal /
 * calculatorClear / calculatorBackspace / calculatorOperation / calculatorEquals
 * 已移至 js/common-keypad.js（見 B1 修正說明），與支票頁共用同一份實作 */

/**
 * 把數字輸入器的結果寫回欄位
 *
 * 這是計算頁唯一與支票頁不同的鍵盤相關邏輯（各欄位驗證規則不同），
 * 所以刻意保留在本檔案，沒有搬進 common-keypad.js。
 */
function submitCalculatorValue() {
    if (!currentInputField) return;
    
    let value = parseFloat(calculatorValue);
    if (isNaN(value)) value = 0;
    
    switch (currentInputField) {
        case 'period':
            value = Math.floor(value);
            if (value < 0 || value > LIMITS.MAX_PERIOD) {
                showToast(`錯誤：請輸入有效期數 (0-${LIMITS.MAX_PERIOD})`, true);
                return;
            }
            document.getElementById(currentInputField).value = value;
            break;

        case 'rate':
            if (value < 0) {
                showToast('錯誤：利率不能為負數', true);
                return;
            }
            // 硬上限：超過就擋下來，避免欄位顯示值與實際計算值不一致
            if (value > LIMITS.MAX_RATE) {
                showToast(`錯誤：利率不可超過 ${LIMITS.MAX_RATE}%`, true);
                return;
            }
            // 警告門檻：提醒但仍允許計算
            warnRateIfOver(value);
            document.getElementById(currentInputField).value = value.toFixed(4);
            break;

        case 'principal':
            value = Math.floor(value);
            if (value <= 0 || value > LIMITS.MAX_AMOUNT) {
                showToast(`錯誤：本金應介於 1 與 ${formatNumberWithCommas(LIMITS.MAX_AMOUNT)} 之間`, true);
                return;
            }
            document.getElementById(currentInputField).value = formatNumberWithCommas(value);
            break;

        case 'payment':
            value = Math.max(1, Math.round(value));
            if (value > LIMITS.MAX_AMOUNT) {
                showToast(`錯誤：期繳金額不可超過 ${formatNumberWithCommas(LIMITS.MAX_AMOUNT)}`, true);
                return;
            }
            document.getElementById(currentInputField).value = formatNumberWithCommas(value);
            break;

        case 'commission':
            value = Math.floor(value);
            if (value < 0 || value > LIMITS.MAX_AMOUNT) {
                showToast(`錯誤：推廣費用不可超過 ${formatNumberWithCommas(LIMITS.MAX_AMOUNT)}`, true);
                return;
            }
            document.getElementById(currentInputField).value = formatNumberWithCommas(value);
            break;

        case 'monthlyCost':
            if (value < 0 || value > LIMITS.MAX_FUNDING_COST) {
                showToast(`錯誤：資金成本應介於 0 與 ${LIMITS.MAX_FUNDING_COST}%`, true);
                return;
            }
            value = Math.max(0, Math.min(LIMITS.MAX_FUNDING_COST, value));
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

/* updateCalculatorHistory() 已移至 js/common-keypad.js（見 B1 修正說明） */

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
