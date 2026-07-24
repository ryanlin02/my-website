/**
 * 重車貸款業務工具箱 - 計算引擎與工具庫 (calc-engine.js)
 * 包含 PMT、RATE、NPV 等財務核心算法與數據格式化工具
 */

/**
 * 計算等額本息每期繳款金額 (PMT)
 * @param {number} rate 年利率 % (如 6.5)
 * @param {number} nper 總期數 (月)
 * @param {number} pv 本金現值
 * @returns {number} 每期繳款金額
 */
function PMT(rate, nper, pv) {
    if (!nper || nper <= 0) {
        if (typeof showToast === 'function') showToast('錯誤：期數必須為正數', true);
        return 0;
    }
    
    if (!pv || pv <= 0) {
        if (typeof showToast === 'function') showToast('錯誤：本金必須為正數', true);
        return 0;
    }
    
    // 轉換年利率為月利率
    const monthlyRate = rate / 100 / 12;
    
    try {
        if (Math.abs(monthlyRate) < 1e-10) {
            return pv / nper;
        }
        return (pv * monthlyRate * Math.pow(1 + monthlyRate, nper)) / (Math.pow(1 + monthlyRate, nper) - 1);
    } catch (error) {
        console.error('PMT 計算錯誤:', error);
        if (typeof showToast === 'function') showToast('期繳金額計算出錯，請檢查輸入值', true);
        return 0;
    }
}

/**
 * 根據期數、期繳與本金反推年利率 (RATE)
 * 使用二分法牛頓逼近迭代計算
 * @param {number} nper 總期數
 * @param {number} pmt 每期應繳
 * @param {number} pv 本金現值
 * @returns {number} 年利率 %
 */
function RATE(nper, pmt, pv) {
    if (!nper || nper <= 0 || !pmt || pmt <= 0 || !pv || pv <= 0) {
        return 0;
    }
    
    if (pmt * nper <= pv) {
        if (typeof showToast === 'function') showToast('錯誤：期繳總額必須大於本金才能計算利率', true);
        return 0;
    }
    
    let rate = 0.1; // 初始猜測 10%
    let step = 0.05;
    let tolerance = 0.0001;
    let maxIterations = 100;
    let iteration = 0;
    
    try {
        while (iteration < maxIterations) {
            let monthlyRate = rate / 12;
            let denominator = Math.pow(1 + monthlyRate, nper) - 1;
            
            if (Math.abs(denominator) < 1e-10) {
                rate += step;
                step *= 0.5;
                iteration++;
                continue;
            }
            
            let calculated = pv * monthlyRate * Math.pow(1 + monthlyRate, nper) / denominator;
            
            if (Math.abs(calculated - pmt) < tolerance) {
                return Math.max(0, rate * 100);
            }
            
            if (calculated > pmt) {
                rate -= step;
            } else {
                rate += step;
            }
            
            rate = Math.max(0.0001, rate);
            step *= 0.5;
            iteration++;
        }
        
        console.warn('RATE 計算未完全收斂，返回最佳估算值');
        return Math.max(0, rate * 100);
    } catch (error) {
        console.error('RATE 計算錯誤:', error);
        return 0;
    }
}

/**
 * 計算 NPV (淨現值獲利指標)
 * NPV = PV(貸款現值) - 稅金 - 推廣費 - 本金
 */
function calculateNPV(payment, period, principal, monthlyCost) {
    try {
        if (!payment || !period || !principal || !monthlyCost || 
            isNaN(payment) || isNaN(period) || isNaN(principal) || isNaN(monthlyCost)) {
            return 0;
        }
        
        if (period > 1200) period = 1200;
        
        const monthlyRate = monthlyCost / 100 / 12;
        
        if (Math.abs(monthlyRate) < 1e-10) {
            return payment * period - principal;
        }
        
        const presentValue = payment * (1 - Math.pow(1 + monthlyRate, -period)) / monthlyRate;
        
        const taxElement = document.getElementById('tax');
        const commissionElement = document.getElementById('commission');
        
        let tax = taxElement && taxElement.value ? parseFloat(taxElement.value.replace(/,/g, '')) || 0 : 0;
        let commission = commissionElement && commissionElement.value ? parseFloat(commissionElement.value.replace(/,/g, '')) || 0 : 0;
        
        const npv = presentValue - tax - commission - principal;
        return isFinite(npv) && !isNaN(npv) ? Math.round(npv) : 0;
    } catch (error) {
        console.error('NPV 計算錯誤:', error);
        return 0;
    }
}

/**
 * 千分位格式化數字
 */
function formatNumberWithCommas(num) {
    if (num === null || num === undefined || num === '') return '';
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * 格式化數字 (用於歷史紀錄等顯示)
 */
function formatNumber(num) {
    if (!num) return '0';
    if (typeof num === 'string') num = num.replace(/,/g, '');
    return parseFloat(num).toLocaleString();
}

/**
 * 格式化日期時間字符串
 */
function formatDate(dateString) {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}/${month}/${day} ${hours}:${minutes}`;
}

/**
 * 統計核心輸入欄位已填寫數
 */
function countFilledFields() {
    const period = document.getElementById('period') ? document.getElementById('period').value : '';
    const rate = document.getElementById('rate') ? document.getElementById('rate').value : '';
    const principal = document.getElementById('principal') ? document.getElementById('principal').value : '';
    const payment = document.getElementById('payment') ? document.getElementById('payment').value : '';
    
    let count = 0;
    if (period && period !== '0') count++;
    if (rate && rate !== '0') count++;
    if (principal && principal !== '0') count++;
    if (payment && payment !== '0') count++;
    
    return count;
}
