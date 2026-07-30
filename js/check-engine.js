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

/* ------------------------------------------------------------
 * 使用情況回報
 * ------------------------------------------------------------
 * 【2026/07 新增】
 *
 * 支票頁在此之前完全沒有任何追蹤 —— 網站上線到現在，
 * 沒有任何一筆資料能回答「這一頁到底有沒有人在用」。
 *
 * 加上的四個事件都綁在「完成型動作」上，不綁按鍵：
 *   check_calculated       算出尾款金額（只在從無到有的那一刻回報一次）
 *   check_saved            保存計算進歷史
 *   check_history_loaded   從歷史叫回舊紀錄
 *   check_all_written      整批票全部開完打勾
 *
 * 一律不送總金額、繳款金額、尾款金額 —— 那是客戶的金額。
 * 只送張數，因為張數看得出業務常談的方案長度，且不指向特定客戶。
 *
 * trackEvent 定義在 check.html 的 GA4 區塊。本檔案被測試環境單獨載入時
 * 不會有那個區塊，所以一定要做存在性檢查，否則整支引擎會拋 ReferenceError。
 * ------------------------------------------------------------ */
function trackCheckEvent(eventName, parameters = {}) {
    if (typeof trackEvent === 'function') {
        trackEvent(eventName, parameters);
    }
}

// 尾款金額目前是不是已經算出來了。
// 用來判斷「從沒有結果變成有結果」的那一刻，避免每改一個欄位就送一筆。
let hasDepositResult = false;

// 這一批票上一次檢查時是不是已經全部開完。
// 同樣是為了只在「剛好開完」的那一刻回報一次，不是每打一個勾都送。
let barWasAllWritten = false;

// 日期選擇器變數
/* selectedDate 與 currentViewMonth 已於 2026/07 移除：
   「還沒按確定的選擇」現在由共用日期選擇器自己保管（見 common-datepicker.js
   的 dpState.draft），按取消就整個丟掉，不會有殘留在本頁的半成品狀態。 */

/* ------------------------------------------------------------
 * 開立進度與歷史記錄連結
 *
 * writtenChecks      每一張票是否已經開立（打勾），索引對應流水號 -1
 *
 * linkedHistoryId    「表單內容與這筆紀錄完全一致」時才有值。
 *                    有值代表打勾會即時寫回該筆紀錄（工作紀錄），
 *                    也代表目前的進度是安全的、不會遺失。
 *
 * sourceHistoryId    資料最初是從哪一筆紀錄套用來的。
 *                    即使之後改了張數導致連結中斷，這個值仍然保留，
 *                    用來在保存時提供「覆蓋原紀錄」的選項。
 *
 * hasUnsavedChanges  套用紀錄後又改了計算內容，尚未決定要覆蓋或另存。
 * ------------------------------------------------------------ */
let writtenChecks = [];
let linkedHistoryId = null;
let sourceHistoryId = null;
let hasUnsavedChanges = false;

/* 自動暫存：防止 App 被系統回收時遺失開立進度。
 * 定位是「意外遺失的防護網」而非正式紀錄 —— 真正要留的請按「保存計算」。
 * 因此比照計算頁設 24 小時效期，隔天打開不會跳出前一天的資料。 */
const CHECK_DRAFT_KEY = 'checkCalculatorDraft';
const CHECK_DRAFT_MAX_HOURS = 24;

/**
 * 推算第 index 張支票的日期（index 從 0 起算）
 *
 * 每一張都以「開始日期的號數」為基準往後推月份，而不是拿上一張的
 * 日期去加一個月 —— 否則遇到 2 月會滾雪球：1/31 → 2/28 → 3/28。
 * 正確結果應該是 1/31 → 2/28 → 3/31。
 * 當月沒有那個號數時（例如 2 月沒有 31 日）就取當月最後一天。
 */
function getCheckDate(start, index) {
    if (!start || index < 0) return start;

    const originalDay = start.getDate();
    const date = new Date(start);
    if (index > 0) {
        date.setMonth(date.getMonth() + index, 1);
        const lastDayOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
        date.setDate(Math.min(originalDay, lastDayOfMonth));
    }
    return date;
}

/**
 * 這張票的日期有沒有因為當月天數不足而被往前調整
 *
 * 客戶若是每月 31 號，2 月會變 28、4 月會變 30。
 * 業務照習慣順手寫 31 就錯了，所以清單上必須標出來。
 */
function isDateAdjusted(start, date) {
    return !!(start && date && date.getDate() !== start.getDate());
}

/**
 * 精簡日期格式 115/04/30
 * 手機只有 400px 寬，「115年4月30日」太吃寬度，排不下金額欄
 */
function formatDateCompact(date) {
    if (!date || isNaN(date.getTime())) return '—';
    const rocYear = date.getFullYear() - 1911;
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${rocYear}/${month}/${day}`;
}

/**
 * 第 index 張支票的金額
 * 前 n-1 張都是每期繳款金額，最後一張是尾款票
 */
function getCheckAmount(index) {
    return (index === checkCount - 1) ? depositAmount : paymentAmount;
}

/**
 * 把打勾狀態整理成長度正確的布林陣列
 * 舊紀錄沒有這個欄位，張數改變時也要跟著調整長度
 */
function normalizeWrittenChecks(source, count) {
    const total = Number(count) || 0;
    const input = Array.isArray(source) ? source : [];
    const result = [];
    for (let i = 0; i < total; i++) {
        result.push(input[i] === true);
    }
    return result;
}

function countWrittenChecks(item) {
    if (!item || !Array.isArray(item.written)) return 0;
    return item.written.filter(Boolean).length;
}

/**
 * 以尾款續開下一批
 *
 * 換票流程：業務帶著尾款票回到客戶端，客戶收回尾款票、重新開下一批。
 * 新的一批就是：
 *   總金額   ← 這次的尾款金額（那就是剩下還沒開票的全部餘額）
 *   開始日期 ← 這次的尾款票日期（那一期還沒繳，所以從那天接續）
 *   繳款金額 ← 不變
 *   開票張數 ← 清空，等業務問客戶「這次可以用幾張」再填
 */
function continueFromDeposit() {
    vibrate();

    if (!depositAmount || !paymentAmount || !checkCount || !startDate) {
        showToast('請先完成這一批的計算，才能接續下一批', true);
        return;
    }

    if (depositAmount <= paymentAmount) {
        showToast('尾款金額已不大於一期繳款，這是最後一張票，不需要再續開', true);
        return;
    }

    const nextStart = getCheckDate(startDate, checkCount - 1);   // 這次的尾款票日期
    const nextTotal = depositAmount;

    confirmDiscardProgress('開始新的一批', function () { askContinueFromDeposit(nextStart, nextTotal); });
}

function askContinueFromDeposit(nextStart, nextTotal) {
    showConfirmModal(
        '以尾款續開下一批',
        `將以這一批的尾款作為下一批的總金額：<br><br>`
        + `總金額：<b>${formatNumber(nextTotal)}</b><br>`
        + `開始日期：<b>${formatDateToROC(nextStart)}</b><br>`
        + `繳款金額：<b>${formatNumber(paymentAmount)}</b>（不變）<br><br>`
        + `開票張數會清空，請重新輸入這次客戶願意提供的張數。`,
        function () {
            detachFromHistory();

            totalAmount = nextTotal;
            startDate = nextStart;
            checkCount = 0;
            depositAmount = 0;

            const totalEl = document.getElementById('total-amount');
            if (totalEl) totalEl.value = formatNumber(totalAmount);
            const countEl = document.getElementById('check-count');
            if (countEl) countEl.value = '';
            const startEl = document.getElementById('start-date');
            if (startEl) startEl.value = `${formatDateToROC(startDate)} ${getChineseWeekday(startDate)}`;

            calculateDepositAmount();
            generateCheckList();
            updateCountBreakdown();
            saveCheckDraft();

            showToast('已帶入尾款，請輸入這次的開票張數');
        }
    );
}

/**
 * 顯示「n 張月票 + 1 張尾款票」的拆解
 * 讓「開票張數含不含尾款票」這件事在畫面上不需要猜
 */
/**
 * 開票張數的拆解說明（純函式）
 *
 * 【2026/07 抽成函式】原本這段文字寫死在 updateCountBreakdown() 裡面，
 * 現在數字鍵盤的副資訊行也要顯示同一句話（見 js/common-keypad.js 的
 * KEYPAD_FIELDS 設定）。兩邊各寫一份遲早會分岔 —— 例如哪天改成
 * 「不含尾款票」，只改了一邊，業務會看到兩個互相矛盾的說明。
 *
 * @param  {number} count 含尾款票的總張數
 * @return {string} 說明文字；張數不成立時回傳空字串
 */
function describeCheckCount(count) {
    const n = Math.floor(Number(count));
    if (!Number.isFinite(n) || n < 1) return '';
    if (n === 1) return '僅 1 張尾款票';
    return `${n - 1} 張月票 ＋ 1 張尾款票`;
}

function updateCountBreakdown() {
    const el = document.getElementById('check-count-breakdown');
    if (!el) return;

    el.textContent = checkCount ? describeCheckCount(checkCount) : '';
}

/**
 * 計算內容被更動時的處理
 *
 * 【2026/07 修正】舊版只要改任何欄位就把打勾全部清空。這在實務上會出事：
 * 業務已經開好並打勾 12 張，客戶臨時說「這次只給 15 張」，
 * 一改張數 12 個勾全沒了 —— 但前 14 張的日期與金額其實一個字都沒變。
 *
 * 張數從 N 改成 M 時真正變動的只有兩個地方：
 *   尾款票從第 N 張移到第 M 張，而且它的金額跟著變。
 * 所以：
 *   - 保留前 min(N, M) − 1 張的打勾（這些月票完全沒變）
 *   - 清掉第 min(N, M) 張（身分從月票變尾款票或反過來，金額不同）
 *   - 多出來的張數是新的，維持未打勾
 *
 * 其他欄位（繳款金額、開始日期、總金額）會讓整批的金額或日期改變，
 * 打勾一律清空。這些欄位在開票中途幾乎不會被動到。
 *
 * @param {string} field 被更動的欄位 id；'check-count' 以外一律清空打勾
 * @param {number} newCount 新的張數（僅 field 為 'check-count' 時有意義）
 */
function handleCalculationChanged(field, newCount) {
    if (field === 'check-count') {
        const keepCount = Math.max(0, Math.min(checkCount, Number(newCount) || 0) - 1);
        writtenChecks = normalizeWrittenChecks(writtenChecks.slice(0, keepCount), newCount);
    } else {
        writtenChecks = [];
    }

    // 內容一改就跟原紀錄不同了，打勾不再即時寫回，改由保存時決定去向
    if (sourceHistoryId !== null) hasUnsavedChanges = true;
    linkedHistoryId = null;

    updateUnsavedHint();
}

/**
 * 完全切斷與歷史記錄的關係（換票、清空等「重新開始」的情境）
 */
function detachFromHistory() {
    writtenChecks = [];
    linkedHistoryId = null;
    sourceHistoryId = null;
    hasUnsavedChanges = false;
    updateUnsavedHint();
}

/**
 * 目前是否有「還沒被安全保存」的開立進度
 *
 * linkedHistoryId 有值時，每次打勾都會即時寫回歷史紀錄，進度是安全的。
 * 沒有連結卻已經打了勾，就代表這些進度只存在畫面上。
 */
function hasUnsavedProgress() {
    return linkedHistoryId === null && writtenChecks.some(Boolean);
}

/**
 * 在會丟失開立進度的動作前先攔一下
 * 沒有打勾就直接執行，避免變成每次都要多按一下的噪音
 */
function confirmDiscardProgress(actionLabel, onProceed) {
    if (!hasUnsavedProgress()) {
        onProceed();
        return;
    }

    const done = writtenChecks.filter(Boolean).length;
    showConfirmModal(
        '尚未儲存',
        `目前已打勾 <b>${done}</b> 張的開立進度尚未儲存，${actionLabel}後就會消失。<br><br>確定要繼續嗎？`,
        onProceed
    );
}

/**
 * 更新「已修改，尚未儲存」提示
 * 放在「保存計算」按鈕正上方 —— 那是要採取行動的地方
 */
function updateUnsavedHint() {
    const hint = document.getElementById('unsaved-hint');
    if (!hint) return;
    hint.style.display = (sourceHistoryId !== null && hasUnsavedChanges) ? 'block' : 'none';
}

/* ------------------------------------------------------------
 * 自動暫存
 * ------------------------------------------------------------ */
function saveCheckDraft() {
    try {
        if (!totalAmount && !paymentAmount && !checkCount && !startDate) {
            localStorage.removeItem(CHECK_DRAFT_KEY);
            return;
        }
        localStorage.setItem(CHECK_DRAFT_KEY, JSON.stringify({
            totalAmount, paymentAmount, checkCount,
            startDate: startDate ? startDate.toISOString() : null,
            written: normalizeWrittenChecks(writtenChecks, checkCount),
            linkedHistoryId, sourceHistoryId, hasUnsavedChanges,
            timestamp: new Date().toISOString()
        }));
    } catch (e) { /* 暫存失敗不影響任何功能，安靜略過 */ }
}

function clearCheckDraft() {
    try {
        localStorage.removeItem(CHECK_DRAFT_KEY);
    } catch (e) { /* 略過 */ }
}

function restoreCheckDraft() {
    let draft;
    try {
        const raw = localStorage.getItem(CHECK_DRAFT_KEY);
        if (!raw) return;
        draft = JSON.parse(raw);
    } catch (e) {
        clearCheckDraft();
        return;
    }

    const hours = (new Date() - new Date(draft.timestamp)) / 3600000;
    if (!isFinite(hours) || hours >= CHECK_DRAFT_MAX_HOURS) {
        clearCheckDraft();
        return;
    }

    totalAmount = Number(draft.totalAmount) || 0;
    paymentAmount = Number(draft.paymentAmount) || 0;
    checkCount = Number(draft.checkCount) || 0;
    startDate = draft.startDate ? new Date(draft.startDate) : null;
    writtenChecks = normalizeWrittenChecks(draft.written, checkCount);
    linkedHistoryId = (draft.linkedHistoryId === undefined) ? null : draft.linkedHistoryId;
    sourceHistoryId = (draft.sourceHistoryId === undefined) ? null : draft.sourceHistoryId;
    hasUnsavedChanges = draft.hasUnsavedChanges === true;

    const totalEl = document.getElementById('total-amount');
    if (totalEl) totalEl.value = totalAmount ? formatNumber(totalAmount) : '';
    const payEl = document.getElementById('payment-amount');
    if (payEl) payEl.value = paymentAmount ? formatNumber(paymentAmount) : '';
    const countEl = document.getElementById('check-count');
    if (countEl) countEl.value = checkCount ? formatNumber(checkCount) : '';
    if (startDate) {
        const startEl = document.getElementById('start-date');
        if (startEl) startEl.value = `${formatDateToROC(startDate)} ${getChineseWeekday(startDate)}`;
    }

    updateCountBreakdown();
    calculateDepositAmount();
    generateCheckList();
    updateUnsavedHint();
}

/* ------------------------------------------------------------
 * 開票期間維持螢幕不休眠
 *
 * 手寫 50 張支票要好幾分鐘，中間還會跟客戶聊天。螢幕一直暗掉再解鎖
 * 本身就是個分心來源，也容易在重新看畫面時看錯行。
 * 只在「還有未開立的票」時啟用，全部開完就自動釋放。
 * Wake Lock 不支援的瀏覽器（例如舊版 iOS Safari）會安靜略過。
 * ------------------------------------------------------------ */
let screenWakeLock = null;
let wakeLockWanted = false;

function updateScreenWakeLock(shouldKeepAwake) {
    wakeLockWanted = !!shouldKeepAwake;

    if (!('wakeLock' in navigator)) return;

    if (wakeLockWanted) {
        if (screenWakeLock) return;
        navigator.wakeLock.request('screen').then(lock => {
            screenWakeLock = lock;
            lock.addEventListener('release', () => { screenWakeLock = null; });
        }).catch(() => { /* 使用者拒絕或分頁不在前景，忽略即可 */ });
    } else if (screenWakeLock) {
        screenWakeLock.release().catch(() => {});
        screenWakeLock = null;
    }
}

// 切換到其他 App 再切回來時，系統會自動釋放 Wake Lock，需要重新取得
document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && wakeLockWanted) {
        updateScreenWakeLock(true);
    }
});

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
            handleCalculationChanged('total-amount');
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
            handleCalculationChanged('payment-amount');
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
            handleCalculationChanged('check-count', value);
            document.getElementById(currentInputField).value = formatNumber(value);
            checkCount = value;
            updateCountBreakdown();
            calculateDepositAmount();
            if (startDate) generateCheckList();
            break;
    }
    
    saveCheckDraft();
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
    confirmDiscardProgress('清除全部輸入', doClearAllInputs);
}

function doClearAllInputs() {
    ['total-amount', 'payment-amount', 'check-count', 'deposit-amount', 'start-date', 'end-date'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    
    totalAmount = 0;
    paymentAmount = 0;
    checkCount = 0;
    depositAmount = 0;
    startDate = null;

    // 開立進度、歷史連結與暫存一併重置
    detachFromHistory();
    clearCheckDraft();

    // 大寫、底部卡片、提示文字統一交給 resetDepositDisplay() 清，
    // 避免像過去那樣「這裡清了三個、那裡漏了一個」而留下殘影
    resetDepositDisplay();

    updateCountBreakdown();

    const listContent = document.getElementById('check-list-content');
    if (listContent) listContent.innerHTML = '';

    const bar = document.getElementById('write-progress');
    if (bar) bar.style.display = 'none';
    const sumCard = document.getElementById('write-summary');
    if (sumCard) sumCard.style.display = 'none';
    updateScreenWakeLock(false);

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
        hasDepositResult = false;                 // 回到沒有結果的狀態，下次算出來要再回報一次
        resetDepositDisplay();
        return;
    }

    depositAmount = totalAmount - (paymentAmount * checkCount) + paymentAmount;

    if (depositAmount <= 0) {
        hasDepositResult = false;                 // 金額不成立不算有結果
        // 關鍵：一定要把 depositAmount 歸零。
        // 若留著負數，後續 updateChineseDisplay() 會把它當成有效金額，
        // 而 arabicToChineseNumber 早期版本會用 Math.abs 把負號吃掉。
        depositAmount = 0;
        resetDepositDisplay();
        showToast('錯誤：尾款金額必須大於零，請檢查總金額、繳款金額與張數', true);
        return;
    }

    // 只在「從沒有結果變成有結果」的那一刻回報一次。
    // 這個函式幾乎每改一個欄位就會被呼叫，不做狀態判斷就會變成雜訊。
    if (!hasDepositResult) {
        hasDepositResult = true;
        trackCheckEvent('check_calculated', {
            check_count: checkCount
        });
    }

    const depEl = document.getElementById('deposit-amount');
    if (depEl) depEl.value = formatNumber(depositAmount);

    updateChineseDisplay();

    const depDisp = document.getElementById('deposit-amount-display');
    if (depDisp) depDisp.textContent = `尾款金額：${formatNumber(depositAmount)}`;

    renderChineseAmount('deposit-amount-display-chinese', depositAmount);

    const card = document.querySelector('.deposit-info-card');
    if (card) card.style.display = 'block';

    const tipElement = document.getElementById('deposit-amount-tip');
    if (tipElement) {
        if (depositAmount < paymentAmount) {
            tipElement.textContent = '尾款金額小於一期繳款，請再次檢查金額與張數。';
            tipElement.style.display = 'block';
        } else if (depositAmount === paymentAmount) {
            tipElement.textContent = '尾款金額等於一期繳款，這是這筆貸款的最後一張票。';
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
        const bar = document.getElementById('write-progress');
        if (bar) bar.style.display = 'none';
        const sumCard = document.getElementById('write-summary');
        if (sumCard) sumCard.style.display = 'none';
        updateScreenWakeLock(false);
        /* 【2026/07 修正 A7】
         * updateEndDateDisplay() 原本只寫在函式最後一行，這個 early return
         * 會整個跳過它，導致清空開票張數之後：列表消失了、卡片收起來了，
         * 但「結束日期」欄位還停在舊的日期上，業務可能誤以為那個日期還有效。
         * 該函式本身在 !checkCount || !startDate 時就會清空欄位，直接呼叫即可。 */
        updateEndDateDisplay();
        return;
    }
    
    // 張數變動時保留既有打勾狀態，只調整長度
    writtenChecks = normalizeWrittenChecks(writtenChecks, checkCount);

    let html = '<table class="check-list-table">';
    html += '<thead><tr>'
        + '<th class="col-tick"></th>'
        + '<th class="col-seq">序</th>'
        + '<th class="col-date">日期</th>'
        + '<th class="col-week">週</th>'
        + '<th class="col-amount">金額</th>'
        + '<th class="col-left">剩餘</th>'
        + '</tr></thead><tbody>';

    let currentYear = startDate.getFullYear();

    for (let i = 0; i < checkCount; i++) {
        const checkDate = getCheckDate(startDate, i);
        const isFinal = (i === checkCount - 1);
        const isWritten = writtenChecks[i] === true;

        // 跨年分隔列：民國年在 1 月 1 日換，寫錯年份是支票的典型錯誤
        if (checkDate.getFullYear() !== currentYear) {
            html += `<tr class="year-change-row">
                <td colspan="6">
                    <div class="year-change-indicator">
                        <span class="year-text">${checkDate.getFullYear() - 1911}年</span>
                    </div>
                </td>
            </tr>`;
            currentYear = checkDate.getFullYear();
        }

        const rowClasses = ['check-row', `row-${i % 2}`];
        if (isFinal) rowClasses.push('final-check-row');
        if (isWritten) rowClasses.push('written');

        // 當月天數不足而被往前調整的日期要標出來，
        // 否則業務照客戶「每月 31 號」的習慣順手寫 31 就錯了
        const adjustedNote = isDateAdjusted(startDate, checkDate)
            ? `<div class="date-adjusted">原 ${startDate.getDate()} 日</div>`
            : '';

        const finalNote = isFinal ? '<div class="final-check-tag">尾款票</div>' : '';

        html += `<tr class="${rowClasses.join(' ')}" data-index="${i}" onclick="toggleCheckWritten(${i})">
            <td class="col-tick"><span class="tick-box">${isWritten ? '✔' : ''}</span></td>
            <td class="col-seq">${i + 1}</td>
            <td class="col-date">${formatDateCompact(checkDate)}${adjustedNote}${finalNote}</td>
            <td class="col-week">${getChineseWeekday(checkDate)}</td>
            <td class="col-amount">${formatNumber(getCheckAmount(i))}</td>
            <td class="col-left">${checkCount - i}</td>
        </tr>`;
    }

    html += '</tbody></table>';
    listContent.innerHTML = html;

    updateEndDateDisplay();
    updateWriteProgress();
}

/**
 * 切換某一張票的「已開立」狀態
 *
 * 一邊跟客戶聊天一邊開 50 張票，最容易出事的不是算錯，而是「看丟行」——
 * 講到一半被打斷，回頭時多寫一張或跳過一張。
 * 靜態的「剩餘張數」欄要先知道自己在哪一列才有用，
 * 打勾則是把「我現在開到哪」變成畫面上的既成事實，被打斷也不怕。
 */
function toggleCheckWritten(index) {
    if (index < 0 || index >= checkCount) return;
    vibrate();

    writtenChecks = normalizeWrittenChecks(writtenChecks, checkCount);
    writtenChecks[index] = !writtenChecks[index];

    const row = document.querySelector(`.check-row[data-index="${index}"]`);
    if (row) {
        row.classList.toggle('written', writtenChecks[index]);
        const tick = row.querySelector('.tick-box');
        if (tick) tick.textContent = writtenChecks[index] ? '✔' : '';
    }

    updateWriteProgress();
    persistWrittenChecks();
}

/**
 * 更新頂部開立進度與底部合計
 *
 * 底部合計刻意用「已打勾的張數 × 該張金額」累加，而不是驗算
 * 繳款 ×(n-1) + 尾款 = 總金額 —— 後者依公式恆等成立，
 * 不管填什麼都會顯示相符，看起來像檢查其實什麼都檢查不到。
 * 現在這個數字驗證的是「有沒有漏開、漏打勾」，那才是真的會出錯的地方。
 */
function updateWriteProgress() {
    const bar = document.getElementById('write-progress');
    if (!bar) return;

    if (!checkCount || !startDate) {
        bar.style.display = 'none';
        return;
    }

    writtenChecks = normalizeWrittenChecks(writtenChecks, checkCount);
    const done = writtenChecks.filter(Boolean).length;
    const remaining = checkCount - done;

    bar.style.display = 'flex';

    const doneEl = document.getElementById('progress-done');
    if (doneEl) doneEl.textContent = done;
    const totalEl = document.getElementById('progress-total');
    if (totalEl) totalEl.textContent = checkCount;
    const leftEl = document.getElementById('progress-left');
    if (leftEl) leftEl.textContent = remaining;

    bar.classList.toggle('all-written', remaining === 0);

    /* 整批票全部開完的那一刻回報一次。
     * 這是支票頁最有價值的一個數字 —— 它代表業務真的把這一頁用完了整個流程，
     * 而不是只算了一下就關掉。用 all-written 這個 class 當作前後狀態的判斷，
     * 所以連續打勾不會重複送，取消再打勾才會再送一次。 */
    if (remaining === 0 && done > 0 && !barWasAllWritten) {
        trackCheckEvent('check_all_written', {
            check_count: checkCount
        });
    }
    barWasAllWritten = (remaining === 0 && done > 0);

    /* 漏開偵測
     * 往下開票的過程中，下方本來就全是未打勾 —— 那不是漏開，是還沒開到。
     * 真正的漏開是「已打勾的列之中夾著未打勾的列」，
     * 也就是位置在「最後一個打勾」之上、卻還沒打勾的那些。
     * 這樣正常往下開的時候完全不會誤報。 */
    const gap = getWriteGapInfo();
    const gapRow = document.getElementById('write-gap');
    if (gapRow) {
        if (gap.gapCount > 0) {
            gapRow.style.display = 'flex';
            const gapCountEl = document.getElementById('gap-count');
            if (gapCountEl) gapCountEl.textContent = gap.gapCount;
            bar.classList.add('has-gap');
        } else {
            gapRow.style.display = 'none';
            bar.classList.remove('has-gap');
        }
    }

    // 已開立金額合計
    let writtenSum = 0;
    for (let i = 0; i < checkCount; i++) {
        if (writtenChecks[i]) writtenSum += getCheckAmount(i);
    }

    const sumCard = document.getElementById('write-summary');
    if (sumCard) {
        sumCard.style.display = done > 0 ? 'flex' : 'none';
        sumCard.classList.toggle('matched', remaining === 0);
    }
    const sumEl = document.getElementById('written-sum');
    if (sumEl) sumEl.textContent = formatNumber(writtenSum);
    const sumTotalEl = document.getElementById('written-sum-total');
    if (sumTotalEl) sumTotalEl.textContent = formatNumber(totalAmount);
    const sumNote = document.getElementById('written-sum-note');
    if (sumNote) {
        sumNote.textContent = remaining === 0
            ? '全部開立完成，金額與總金額相符'
            : `還有 ${remaining} 張未開立`;
    }

    updateScreenWakeLock(remaining > 0);
}

/**
 * 計算漏開資訊
 * @returns {{gapCount:number, firstUnwritten:number}}
 *   gapCount      「最後一個打勾」之上、卻還沒打勾的張數（真正跳過的）
 *   firstUnwritten 順序上最前面一張未打勾的索引，供「前往」使用
 */
function getWriteGapInfo() {
    let lastWritten = -1;
    let firstUnwritten = -1;

    for (let i = 0; i < checkCount; i++) {
        if (writtenChecks[i]) lastWritten = i;
        else if (firstUnwritten === -1) firstUnwritten = i;
    }

    let gapCount = 0;
    for (let i = 0; i < lastWritten; i++) {
        if (!writtenChecks[i]) gapCount++;
    }

    return { gapCount, firstUnwritten };
}

/**
 * 捲動到第一張未打勾的支票
 *
 * 直接捲到畫面最頂端的話，目標列會被固定的進度列蓋住，
 * 所以往下偏移進度列的高度，讓它剛好落在進度列正下方。
 */
function goToFirstUnwritten() {
    vibrate();

    const { firstUnwritten } = getWriteGapInfo();
    if (firstUnwritten === -1) return;

    const row = document.querySelector(`.check-row[data-index="${firstUnwritten}"]`);
    if (!row) return;

    /* 目標列要落在固定進度列的正下方。
     * 偏移量 = 進度列的固定位置(top) + 它自己的高度 + 一點餘白。
     * top 直接從樣式讀取，之後若調整 CSS 這裡會自動跟著對。 */
    const bar = document.getElementById('write-progress');
    let offset = 8;
    if (bar) {
        const stickyTop = parseFloat(getComputedStyle(bar).top) || 0;
        offset += stickyTop + bar.offsetHeight;
    }
    const top = row.getBoundingClientRect().top + window.pageYOffset - offset;

    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });

    // 短暫高亮，讓使用者知道跳到哪一列了
    row.classList.add('flash');
    setTimeout(() => row.classList.remove('flash'), 1600);
}

/**
 * 把打勾狀態寫回來源的歷史記錄，成為實際的開立工作紀錄
 * 沒有來源（尚未保存的新試算）時就不寫，等按下「保存計算」再一起存
 */
function persistWrittenChecks() {
    // 不論有沒有連結歷史紀錄，都先寫進暫存，避免 App 被系統回收時遺失
    saveCheckDraft();

    if (linkedHistoryId === null) return;

    const checkHistory = readCheckHistory();
    const index = checkHistory.findIndex(item => item.id === linkedHistoryId);
    if (index === -1) {
        linkedHistoryId = null;
        return;
    }

    checkHistory[index].written = normalizeWrittenChecks(writtenChecks, checkCount);
    writeCheckHistory(checkHistory);
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

/* ============================================================
   日期選擇器（2026/07 起改用四頁共用的元件）
   ------------------------------------------------------------
   本頁原本自己有一套月曆：showDatePicker / updateDatePicker /
   setupDatePicker 共 139 行，加上 <table> 版的 DOM 與約 86 行 CSS。
   發票頁另外有一套 46 行的，兩套的外觀與操作邏輯都不一樣。

   現在統一走 js/common-datepicker.js，本頁因此多出三項能力：
     - 面板高度固定，切月時按鍵不會在手指底下移動
     - 點年份可以直接選年份、點月份可以直接選月份
       （舊版只有上下月，要選一年後的日期得按 12 次）
     - 過去日期從「禁選」改成「可選但變色提醒」

   【為什麼過去日期不再禁選】
   支票確實是未來到期日，但業務要補登「已經開始繳」的案子時
   （客戶三個月前就開始繳，現在才輸入），禁選會直接把人擋死。
   變色加上面板下方的提示既擋得住誤按，也不會擋住真的要那樣做的人。

   【按下確定之後的那一條線】
   下面 onOk 裡的每一步與舊版逐字相同，順序也一樣，因為那是本頁的核心：
   清空打勾 → 寫入 startDate → 更新欄位顯示 → 重算整串開票日期 → 寫入草稿。
   tests/支票日期選擇測試.js 就是在守這條線。
   ============================================================ */
function showDatePicker() {
    openDatePicker({
        title: '開始日期（民國）',
        value: startDate || new Date(),
        warnBefore: 'today',            // 早於今天只變色提醒，不禁選
        onOk: function (roc, date) {
            // 換了開始日期代表整批日期都變了，打勾一律清空
            handleCalculationChanged('start-date');

            startDate = date;
            const startEl = document.getElementById('start-date');
            if (startEl) {
                startEl.value = `${formatDateToROC(startDate)} ${getChineseWeekday(startDate)}`;
            }

            generateCheckList();
            saveCheckDraft();
        }
    });
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
        showToast('尾款金額不成立，請先檢查總金額、繳款金額與張數', true);
        return;
    }
    
    
    /* 資料來自某筆歷史紀錄、而且內容已經被改過（例如客戶臨時改張數）時，
     * 讓使用者決定要覆蓋原紀錄還是另存新的一筆。
     *
     * 這個詢問刻意放在「保存計算」而不是「改張數的當下」——
     * 業務改張數時人還在客戶面前、票也還沒開完，那時候問存檔沒有判斷依據，
     * 而且模態視窗會打斷正在進行的手寫動作。 */
    if (sourceHistoryId !== null && hasUnsavedChanges) {
        const source = readCheckHistory().find(item => item.id === sourceHistoryId);
        if (source) {
            showChoiceModal(
                '內容已變更',
                `這筆資料來自 <b>${escapeHtml(source.date || '先前的紀錄')}</b> 的紀錄，內容已經變更。<br><br>`
                + `原紀錄：${source.checkCount} 張 · 尾款 ${formatNumber(source.depositAmount)}<br>`
                + `目前：${checkCount} 張 · 尾款 ${formatNumber(depositAmount)}`,
                [
                    { label: '覆蓋原紀錄', primary: true, onSelect: () => commitCheckData(sourceHistoryId) },
                    { label: '另存為新紀錄', onSelect: () => commitCheckData(null) }
                ]
            );
            return;
        }
        // 原紀錄已被刪除，直接另存
    }

    commitCheckData(null);
}

/**
 * 實際寫入歷史記錄
 * @param {number|null} overwriteId 有值代表覆蓋該筆，null 代表另存新紀錄
 */
function commitCheckData(overwriteId) {
    const now = new Date();
    const formattedDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    const checkHistory = readCheckHistory();
    const written = normalizeWrittenChecks(writtenChecks, checkCount);
    let targetId = overwriteId;

    if (overwriteId !== null) {
        const index = checkHistory.findIndex(item => item.id === overwriteId);
        if (index === -1) {
            targetId = null;                      // 原紀錄不見了就改成另存
        } else {
            Object.assign(checkHistory[index], {
                date: formattedDate,
                totalAmount, paymentAmount, checkCount, depositAmount,
                startDate: startDate.toISOString(),
                timestamp: now.toISOString(),
                written
            });
        }
    }

    if (targetId === null) {
        // 同一毫秒內連按兩次會產生相同 id，刪除時會一次刪掉兩筆，故加上亂數
        targetId = Date.now() * 1000 + Math.floor(Math.random() * 1000);
        checkHistory.push({
            id: targetId,
            date: formattedDate,
            totalAmount, paymentAmount, checkCount, depositAmount,
            startDate: startDate.toISOString(),
            timestamp: now.toISOString(),
            note: '',
            written
        });
    }

    if (!writeCheckHistory(checkHistory)) return;

    // 保存進歷史代表這筆試算對業務是有意義的，比「算了一次」更強的訊號
    trackCheckEvent('check_saved', {
        check_count: checkCount,
        is_overwrite: overwriteId ? true : false,
        history_count: checkHistory.length
    });

    // 存檔後重新建立連結，之後打勾就會直接寫回這一筆
    linkedHistoryId = targetId;
    sourceHistoryId = targetId;
    hasUnsavedChanges = false;
    updateUnsavedHint();
    saveCheckDraft();

    showToast(overwriteId !== null ? '已覆蓋原紀錄' : '支票計算結果已保存！');
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

/**
 * 載入歷史記錄面板
 *
 * 【2026/07 改版】舊版用了四個全站 CSS 根本沒有定義的 class：
 *   .no-history（實際是 .no-data）、.note-btn（實際是 .detail-btn）、
 *   .history-note-display（實際是 .history-note-preview），
 *   以及沒有 .history-list 外層容器、details 沒有用
 *   .history-detail-item / .detail-label / .detail-value 結構。
 * 結果是整個面板幾乎沒有樣式、五個項目擠在兩欄 grid 裡排版錯亂。
 * 這裡改為與計算頁（calc-storage.js 的 loadHistoryData）完全相同的結構。
 *
 * 同時新增「套用資料」按鈕 —— 這是業務到客戶端開票時的主要入口：
 * 開啟頁面 → 歷史記錄 → 套用先前算好的那一筆 → 照著清單開票。
 */
function loadCheckHistory() {
    const historyContent = document.getElementById('historyContent');
    if (!historyContent) return;

    const checkHistory = readCheckHistory();

    if (checkHistory.length === 0) {
        historyContent.innerHTML = '<p class="no-data">尚無支票計算記錄</p>';
        return;
    }

    // 依儲存時間新到舊排序（舊版只是把陣列 reverse，遇到舊資料順序會亂）
    checkHistory.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));

    let html = '<div class="history-list">';

    checkHistory.forEach(item => {
        const start = new Date(item.startDate);
        const total = Number(item.checkCount) || 0;
        const done = countWrittenChecks(item);

        // 開立進度徽章：沿用計算頁 .history-header-rate 的樣式位置
        let progressText;
        if (total > 0 && done >= total) {
            progressText = `已開立完成 ${total} 張`;
        } else if (done > 0) {
            progressText = `開立中 ${done} / ${total} 張`;
        } else {
            progressText = `${total} 張 · 尚未開立`;
        }

        html += `
            <div class="history-item" data-check-id="${item.id}">
                <div class="history-item-header">
                    <div class="history-date">${escapeHtml(item.date || '')}</div>
                    <div class="history-header-rate">${progressText}</div>
                </div>

                <div class="history-details">
                    <div class="history-detail-item">
                        <span class="detail-label">總金額</span>
                        <span class="detail-value">${formatNumber(item.totalAmount)}</span>
                    </div>
                    <div class="history-detail-item">
                        <span class="detail-label">每期繳款</span>
                        <span class="detail-value">${formatNumber(item.paymentAmount)}</span>
                    </div>
                    <div class="history-detail-item">
                        <span class="detail-label">開票張數</span>
                        <span class="detail-value">${total} 張</span>
                    </div>
                    <div class="history-detail-item">
                        <span class="detail-label">尾款金額</span>
                        <span class="detail-value">${formatNumber(item.depositAmount)}</span>
                    </div>
                    <div class="history-detail-item">
                        <span class="detail-label">首張日期</span>
                        <span class="detail-value">${formatDateCompact(start)}</span>
                    </div>
                    <div class="history-detail-item">
                        <span class="detail-label">尾款票日期</span>
                        <span class="detail-value">${formatDateCompact(getCheckDate(start, total - 1))}</span>
                    </div>
                </div>

                <div class="history-note-container">
                    <div class="history-item-footer">
                        <div class="history-note-preview ${item.note ? '' : 'empty-note'}" onclick="openNoteEditor(${item.id})">
                            ${item.note ? escapeHtml(item.note) : '點擊添加備註'}
                        </div>
                        <div class="history-actions">
                            <button class="detail-btn" onclick="loadCheckToForm(${item.id})">套用資料</button>
                            <button class="delete-btn" onclick="deleteCheckHistoryItem(${item.id})">刪除</button>
                        </div>
                    </div>
                </div>
            </div>`;
    });

    html += '</div>';
    historyContent.innerHTML = html;
}

/**
 * 把歷史記錄套用回表單
 *
 * 這是業務實際到客戶端開票的入口：把先前算好的那一筆完整還原，
 * 包含已經打勾的開立進度，接著就能照著清單一張一張開。
 */
function loadCheckToForm(id) {
    vibrate();

    const item = readCheckHistory().find(entry => entry.id === id);
    if (!item) {
        showToast('找不到這筆記錄', true);
        return;
    }

    // 有未儲存的打勾進度時先確認，避免業務辛苦點的 12 個勾被靜默丟掉
    confirmDiscardProgress('套用其他紀錄', function () { applyCheckRecord(item); });
}

function applyCheckRecord(item) {
    const id = item.id;

    totalAmount = Number(item.totalAmount) || 0;
    paymentAmount = Number(item.paymentAmount) || 0;
    checkCount = Number(item.checkCount) || 0;
    startDate = item.startDate ? new Date(item.startDate) : null;

    // 記住資料來源，之後打勾會直接寫回這筆紀錄，成為實際的開立工作紀錄
    linkedHistoryId = id;
    sourceHistoryId = id;
    hasUnsavedChanges = false;
    writtenChecks = normalizeWrittenChecks(item.written, checkCount);

    const totalEl = document.getElementById('total-amount');
    if (totalEl) totalEl.value = totalAmount ? formatNumber(totalAmount) : '';
    const payEl = document.getElementById('payment-amount');
    if (payEl) payEl.value = paymentAmount ? formatNumber(paymentAmount) : '';
    const countEl = document.getElementById('check-count');
    if (countEl) countEl.value = checkCount ? formatNumber(checkCount) : '';

    if (startDate) {
        const startEl = document.getElementById('start-date');
        if (startEl) startEl.value = `${formatDateToROC(startDate)} ${getChineseWeekday(startDate)}`;
    }

    updateCountBreakdown();
    calculateDepositAmount();
    generateCheckList();

    // 套用歷史是業務到客戶端開票的主要入口，這個數字看得出這條路徑有多常用
    trackCheckEvent('check_history_loaded', {
        check_count: checkCount
    });

    const historyPanel = document.getElementById('historyPanel');
    if (historyPanel) historyPanel.style.display = 'none';

    showToast('已套用歷史資料');
}

/**
 * 讀取歷史記錄（統一入口，順便擋掉資料損毀的情況）
 */
function readCheckHistory() {
    try {
        const raw = JSON.parse(localStorage.getItem('checkHistory') || '[]');
        return Array.isArray(raw) ? raw : [];
    } catch (e) {
        return [];
    }
}

/**
 * 寫入歷史記錄
 * @returns {boolean} 是否成功（無痕模式或容量已滿時會失敗）
 */
function writeCheckHistory(history) {
    try {
        localStorage.setItem('checkHistory', JSON.stringify(history));
        return true;
    } catch (e) {
        showToast('儲存失敗，裝置儲存空間可能已滿', true);
        return false;
    }
}

function deleteCheckHistoryItem(id) {
    vibrate();
    showConfirmModal('刪除確認', '確定要刪除這筆歷史紀錄嗎？', function() {
        const checkHistory = readCheckHistory().filter(item => item.id !== id);
        if (!writeCheckHistory(checkHistory)) return;
        // 刪掉的若正是目前套用中的那筆，就切斷連結，避免打勾寫回不存在的紀錄
        if (linkedHistoryId === id) linkedHistoryId = null;
        if (sourceHistoryId === id) { sourceHistoryId = null; hasUnsavedChanges = false; }
        updateUnsavedHint();
        loadCheckHistory();
        showToast('歷史紀錄已刪除');
    });
}

function confirmDeleteAll() {
    vibrate();
    showConfirmModal('全刪確認', '確定要刪除所有歷史紀錄嗎？此操作無法恢復。', function() {
        try {
            localStorage.removeItem('checkHistory');
        } catch (e) { /* 移除失敗不影響畫面，繼續往下重繪 */ }
        linkedHistoryId = null;
        sourceHistoryId = null;
        hasUnsavedChanges = false;
        updateUnsavedHint();
        loadCheckHistory();
        showToast('所有歷史紀錄已刪除');
    });
}

/**
 * 開啟備註編輯視窗
 *
 * 【2026/07 修正 B3】
 * 舊版自己 new 了一個 .modal-overlay（垂直置中）來裝 <textarea>，
 * 手機鍵盤一彈出就會把視窗推走或蓋住，看不到輸入框也點不到儲存。
 * 現在改用 common-keypad.js 的共用對話框，它會依 visualViewport
 * 把視窗固定在鍵盤上緣以上的可視區域。
 */
function openNoteEditor(checkId) {
    vibrate();
    const checkItem = readCheckHistory().find(item => item.id === checkId);
    if (!checkItem) return;

    showNoteEditor({
        title: '編輯備註',
        note: checkItem.note || '',
        onSave: function (noteText) {
            saveCheckNote(checkId, noteText);
        }
    });
}

function saveCheckNote(checkId, noteText) {
    vibrate();
    const checkHistory = readCheckHistory();
    const index = checkHistory.findIndex(item => item.id === checkId);
    if (index === -1) return;

    checkHistory[index].note = noteText;
    if (!writeCheckHistory(checkHistory)) return;
    loadCheckHistory();
    showToast('備註已更新');
}

// 初始化頁面事件與定時器
document.addEventListener('DOMContentLoaded', function() {
    updateCurrentDate();
    setInterval(updateCurrentDate, 1000);
    /* setupDatePicker() 已移除：日期選擇器的按鍵由共用元件自己處理 */

    // 還原自動暫存（24 小時內），避免 App 被系統回收時遺失開立進度
    restoreCheckDraft();
    updateUnsavedHint();
});

// 切到背景前把現況寫進暫存，這是最容易被系統回收的時機
document.addEventListener('visibilitychange', function () {
    if (document.hidden) saveCheckDraft();
});
