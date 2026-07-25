/**
 * 重車貸款業務工具箱 - 計算引擎與工具庫 (calc-engine.js)
 * 包含 PMT、RATE、NPV 等財務核心算法與數據格式化工具
 */

/* ============================================================
 * 【設定區】全站數值上限與警告門檻
 * ------------------------------------------------------------
 * 要調整任何限制或警告標準，只需要改這一區的數字，
 * 不需要去下面的程式碼裡面找。改完記得把 sw.js 的
 * CACHE_VERSION 版本號往上加一號，手機才會拿到新版。
 * ============================================================ */
var LIMITS = {
    MAX_AMOUNT: 99999999,     // 本金／期繳／推廣費 共用金額上限（元）
    MAX_PERIOD: 999,          // 期數上限（月）
    MAX_RATE: 100,            // 利率硬上限（%）— 超過就擋下來
    RATE_WARN: 20,            // 利率警告門檻（%）— 超過會提醒但仍可計算
    RATIO_WARN: 5,            // 佣金比例警告門檻（%）— 超過會提醒但仍可計算
    MAX_FUNDING_COST: 20      // 資金成本上限（%）
};

// 利率超出可計算範圍時，欄位顯示的文字
var RATE_OUT_OF_RANGE_TEXT = '＞' + LIMITS.MAX_RATE + '%';

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
 *
 * 【2026/07 修正】舊版採用「初始猜測 10%、步長每次減半」的逼近法，
 * 其數學上的搜尋範圍恰好只有 0%~20%，任何高於 20% 的真實利率都會被
 * 靜默壓成 20.0000% 且不報錯。改為標準二分法，搜尋區間 0%~MAX_RATE，
 * 超出範圍時回傳 NaN 由呼叫端顯示提示，不再給出錯誤數字。
 *
 * 註：20% 以下的計算結果與舊版完全相同（已逐筆回歸驗證）。
 *
 * @param {number} nper 總期數
 * @param {number} pmt 每期應繳
 * @param {number} pv 本金現值
 * @returns {number} 年利率 %；超出可計算範圍時回傳 NaN
 */
function RATE(nper, pmt, pv) {
    if (!nper || nper <= 0 || !pmt || pmt <= 0 || !pv || pv <= 0) {
        return 0;
    }

    // 期繳總額不大於本金 → 利率為零或負值，無意義
    if (pmt * nper <= pv) {
        if (typeof showToast === 'function') showToast('錯誤：期繳總額必須大於本金才能計算利率', true);
        return 0;
    }

    try {
        // 依指定年利率推算每期應繳（等額本息）
        const paymentAt = function (annualRate) {
            const monthlyRate = annualRate / 100 / 12;
            if (Math.abs(monthlyRate) < 1e-12) return pv / nper;
            const growth = Math.pow(1 + monthlyRate, nper);
            return pv * monthlyRate * growth / (growth - 1);
        };

        let low = 0;                  // 期繳最小值（利率 0%）
        let high = LIMITS.MAX_RATE;   // 期繳最大值（利率上限）

        // 期繳大於上限利率所能產生的金額 → 超出可計算範圍
        if (paymentAt(high) < pmt) {
            return NaN;
        }

        // 標準二分法：期繳金額隨利率單調遞增，必定收斂
        for (let i = 0; i < 200; i++) {
            const mid = (low + high) / 2;
            if (paymentAt(mid) < pmt) {
                low = mid;
            } else {
                high = mid;
            }
        }

        const result = (low + high) / 2;
        return isFinite(result) ? Math.max(0, result) : NaN;
    } catch (error) {
        console.error('RATE 計算錯誤:', error);
        return NaN;
    }
}

/**
 * 判斷 RATE() 的回傳值是否為可用的數字
 * @param {number} rate RATE() 的回傳值
 * @returns {boolean} true 表示可正常顯示
 */
function isValidRate(rate) {
    return typeof rate === 'number' && !isNaN(rate) && isFinite(rate) && rate >= 0;
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
