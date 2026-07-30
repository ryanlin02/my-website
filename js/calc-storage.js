/**
 * 重車貸款業務工具箱 - 數據持久化與歷史紀錄模組 (calc-storage.js)
 *
 * LocalStorage 鍵名：
 * - loanCalculatorAutoSave        自動暫存（24 小時效期）
 * - loanCalculatorIframeBackup    iframe 環境的備份（48 小時）
 * - loanHistory                   歷史紀錄，改由 js/common-history.js 統一存取
 *
 * 【2026/07 步驟 2】
 * 歷史紀錄的讀寫全部改走共用 Store。本檔案不再自己碰 loanHistory，
 * id 生成、寫入失敗處理、排序、筆數上限、舊資料相容一律由 Store 負責。
 *
 * 同時移除了 loanCalculatorEmergencyBackup —— 全站只有 getItem 與
 * removeItem、沒有任何一處 setItem，也就是說註解裡寫的「三層備份」
 * 實際上只有兩層，第三層永遠是空的，讀它純粹是浪費一次 I/O。
 */

/* 歷史紀錄倉庫。key 沿用舊的 loanHistory，既有資料原地相容。 */
const loanHistoryStore = createHistoryStore({ key: 'loanHistory', tool: 'calc' });

/* ------------------------------------------------------------
 * 與歷史紀錄的連結（2026/07 步驟 4）
 *
 * loanSourceId          目前表單的資料是從哪一筆紀錄套用來的。
 * loanHasUnsavedChanges 套用之後又改了內容，尚未決定要覆蓋還是另存。
 *
 * 【為什麼要有這一層】
 * 業務在客戶面前調數字是常態：客戶問「48 期呢」，改一下再存。
 * 舊版每按一次存檔就多一筆，同一個客戶的同一個案子三個月後
 * 會在歷史裡留下四十個版本，等於沒有歷史。
 *
 * 這套模型是支票頁先長出來的（見 check-engine.js 的 sourceHistoryId），
 * 這裡把它推廣過來，兩頁的行為因此一致。
 *
 * 詢問的時機刻意放在「按下存檔」而不是「改數字的當下」——
 * 改數字時人還在客戶面前講話，跳一個視窗問存檔會打斷對話，
 * 而且那個當下也還沒有判斷依據。
 * ------------------------------------------------------------ */
let loanSourceId = null;
let loanHasUnsavedChanges = false;

/**
 * 使用者改了計算內容
 * 由 calc-ui.js 的鍵盤送出與五個快捷調整鍵呼叫
 */
function markLoanChanged() {
    if (loanSourceId !== null) loanHasUnsavedChanges = true;
    updateLoanUnsavedHint();
}

/** 完全切斷與歷史紀錄的關係（清空全部欄位這種「重新開始」的情境） */
function detachLoanFromHistory() {
    loanSourceId = null;
    loanHasUnsavedChanges = false;
    updateLoanUnsavedHint();
}

/** 更新「已修改，尚未儲存」提示（放在存檔按鈕正上方，那是要採取行動的地方） */
function updateLoanUnsavedHint() {
    const hint = document.getElementById('unsaved-hint');
    if (!hint) return;
    hint.style.display = (loanSourceId !== null && loanHasUnsavedChanges) ? 'block' : 'none';
}

/**
 * 恢復上次自動保存的數據
 */
function restoreAutoData() {
    try {
        const isInIframe = (window.self !== window.top);
        let savedDataStr = localStorage.getItem('loanCalculatorAutoSave');
        let dataSource = 'main';

        if (!savedDataStr && isInIframe) {
            savedDataStr = localStorage.getItem('loanCalculatorIframeBackup');
            dataSource = 'iframe-backup';
        }

        if (savedDataStr) {
            const savedData = JSON.parse(savedDataStr);
            const savedTime = new Date(savedData.timestamp);
            const hoursDiff = (new Date() - savedTime) / (1000 * 60 * 60);
            const maxHours = isInIframe ? 48 : 24;
            
            if (hoursDiff < maxHours) {
                if (savedData.period) document.getElementById('period').value = savedData.period;
                if (savedData.rate) document.getElementById('rate').value = savedData.rate;
                if (savedData.principal) document.getElementById('principal').value = savedData.principal;
                if (savedData.payment) document.getElementById('payment').value = savedData.payment;

                if (savedData.commission && savedData.commission !== '0' && savedData.commission !== 0) {
                    document.getElementById('commission').value = savedData.commission;
                } else {
                    document.getElementById('commission').value = '';
                }

                if (savedData.monthlyCost && savedData.monthlyCost !== '') {
                    document.getElementById('monthlyCost').value = savedData.monthlyCost;
                } else {
                    document.getElementById('monthlyCost').value = '2';
                }
                
                // 還原資料時不跳超標提示：若上次離開時就已超過門檻，
                // 每次開啟 App 都跳一次會變成干擾。欄位紅字仍會照常顯示，
                // 之後使用者自己把數值調到門檻以下再超過時才會再提示。
                if (typeof ratioWarnShown !== 'undefined') ratioWarnShown = true;

                if (typeof updateAllFields === 'function') updateAllFields();

                if (isInIframe) {
                    console.log(`iframe環境：已靜默恢復計算數據 (來源: ${dataSource})`);
                } else {
                    if (typeof showToast === 'function') showToast('已恢復上次的計算數據');
                    console.log(`獨立環境：成功恢復計算數據 (來源: ${dataSource})`, savedData);
                }
            } else {
                localStorage.removeItem('loanCalculatorAutoSave');
                if (isInIframe) localStorage.removeItem('loanCalculatorIframeBackup');
            }
        }
    } catch (error) {
        console.error('恢復自動保存數據失敗:', error);
        try {
            localStorage.removeItem('loanCalculatorAutoSave');
            localStorage.removeItem('loanCalculatorIframeBackup');
        } catch (e) {}
    }
}

/**
 * 手動保存貸款計算結果至歷史紀錄
 */
function saveLoanData() {
    const period = document.getElementById('period').value;
    const rate = document.getElementById('rate').value;
    const principal = document.getElementById('principal').value.replace(/,/g, '');
    const payment = document.getElementById('payment').value.replace(/,/g, '');
    const afterTaxRate = document.getElementById('afterTaxRate').value;
    const commission = document.getElementById('commission').value.replace(/,/g, '');
    const afterCommissionRate = document.getElementById('afterCommissionRate').value;
    
    if (!period || !rate || !principal || !payment) {
        if (typeof showToast === 'function') showToast('請先完成必要欄位（期數、利率、本金、期繳）的計算！');
        return;
    }

    /* 【2026/07 步驟 4】資料來自某筆紀錄、而且已經被改過時，
     * 讓使用者決定要覆蓋原紀錄還是另存一筆。做法與支票頁一致。 */
    if (loanSourceId !== null && loanHasUnsavedChanges) {
        const src = loanHistoryStore.get(loanSourceId);
        if (src && typeof showChoiceModal === 'function') {
            showChoiceModal(
                '內容已變更',
                `這筆資料來自 <b>${escapeHtml(formatSavedAt(src.savedAt) || '先前的紀錄')}</b> 的紀錄，內容已經變更。<br><br>`
                + `原紀錄：${src.data.period} 期 · 本金 ${formatNumber(src.data.principal)}<br>`
                + `目前：${period} 期 · 本金 ${formatNumber(principal)}`,
                [
                    { label: '覆蓋原紀錄', primary: true, onSelect: () => commitLoanData(loanSourceId) },
                    { label: '另存為新紀錄', onSelect: () => commitLoanData(null) }
                ]
            );
            return;
        }
        // 原紀錄已被刪除，直接另存
    }

    commitLoanData(null);
}

/**
 * 實際寫入歷史紀錄
 * @param {number|null} overwriteId 有值代表覆蓋該筆，null 代表另存新紀錄
 */
function commitLoanData(overwriteId) {
    const period = document.getElementById('period').value;
    const rate = document.getElementById('rate').value;
    const principal = document.getElementById('principal').value.replace(/,/g, '');
    const payment = document.getElementById('payment').value.replace(/,/g, '');
    const afterTaxRate = document.getElementById('afterTaxRate').value;
    const commission = document.getElementById('commission').value.replace(/,/g, '');
    const afterCommissionRate = document.getElementById('afterCommissionRate').value;

    /* 【2026/07 步驟 2】id、timestamp、note 已改由 Store 的信封負責，
     * 這裡只提供這一頁自己的欄位。寫入失敗（容量滿、無痕模式）也由
     * Store 統一攔下並提示，這裡只需要看 ok 決定要不要繼續。
     * 覆蓋目標已被刪除時，Store 會自動改為新增。 */
    /* 不再自己存 date 字串：信封上的 savedAt 是完整到秒的時間戳，
       顯示交給共用的 formatSavedAt()。存一份格式化過的日期在旁邊，
       就是同一件事的第二個真相來源（舊紀錄裡的 date 留著不影響）。 */
    const result = loanHistoryStore.save({
        period: period,
        rate: rate,
        principal: principal,
        payment: payment,
        afterTaxRate: afterTaxRate,
        commission: commission || '0',
        afterCommissionRate: afterCommissionRate,
        totalInterest: document.getElementById('totalInterest').value.replace(/,/g, '')
    }, { overwriteId: overwriteId });

    if (!result.ok) return;

    // 存進歷史代表這筆試算對業務是有意義的，是比「算了一次」更強的訊號。
    // 只送期數與筆數，金額一律不送。
    if (typeof trackCalcEvent === 'function') {
        trackCalcEvent('loan_saved', {
            period: parseFloat(period) || 0,
            is_overwrite: result.overwritten,
            history_count: loanHistoryStore.count()
        });
    }

    // 存檔後重新建立連結：之後再改再存，會問要不要覆蓋這一筆
    loanSourceId = result.id;
    loanHasUnsavedChanges = false;
    updateLoanUnsavedHint();

    /* 用 Store 回報的實際結果，而不是呼叫端的意圖 ——
     * 想覆蓋但原紀錄已被刪掉時，Store 會改成新增，這時說「已覆蓋」是騙人的 */
    if (typeof showToast === 'function') {
        showToast(result.overwritten ? '已覆蓋原紀錄' : '已存檔');
    }
}

/**
 * 載入歷史記錄面板列表內容
 */
function loadHistoryData() {
    const historyContent = document.getElementById('historyContent');
    if (!historyContent) return;
    
    /* 【2026/07 步驟 2】改讀共用 Store。排序由 Store 負責（新→舊），
     * 這裡不再自己 sort。各頁欄位都在 rec.data 裡，備註在信封上。 */
    const loanHistory = loanHistoryStore.list();

    if (loanHistory.length === 0) {
        historyContent.innerHTML = '<p class="no-data">尚無貸款試算紀錄</p>';
        return;
    }

    let html = '<div class="history-list">';
    loanHistory.forEach(rec => {
        const loan = rec.data;
        const principalDisplay = formatNumber(loan.principal);
        const paymentDisplay = formatNumber(loan.payment);
        const commissionDisplay = formatNumber(loan.commission);

        html += `
            <div class="history-item${historyItemClass(rec.id)}" data-loan-id="${rec.id}" data-history-id="${rec.id}">
                <div class="history-item-summary">
                    ${historyCheckboxHtml()}
                    <div class="history-item-header">
                        <div class="history-date">${escapeHtml(formatSavedAt(rec.savedAt))}</div>
                        <div class="history-header-rate">稅佣後 ${parseFloat(loan.afterCommissionRate).toFixed(4)}%</div>
                    </div>
                    <div class="history-summary-line">
                        <span class="summary-main">${principalDisplay}</span>
                        <span class="summary-sub">${loan.period} 期</span>
                        ${rec.note ? `<span class="summary-note">${escapeHtml(rec.note)}</span>` : ''}
                    </div>
                </div>

                <div class="history-item-detail">
                    <div class="history-details">
                        <div class="history-detail-item">
                            <span class="detail-label">期數</span>
                            <span class="detail-value">${loan.period}</span>
                        </div>
                        <div class="history-detail-item">
                            <span class="detail-label">推廣</span>
                            <span class="detail-value">${commissionDisplay}</span>
                        </div>
                        <div class="history-detail-item">
                            <span class="detail-label">本金</span>
                            <span class="detail-value">${principalDisplay}</span>
                        </div>
                        <div class="history-detail-item">
                            <span class="detail-label">期繳</span>
                            <span class="detail-value">${paymentDisplay}</span>
                        </div>
                    </div>

                    <div class="history-note-container">
                        <div class="history-item-footer">
                            <div class="history-note-preview ${rec.note ? '' : 'empty-note'}" onclick="openNoteEditor(${rec.id})">
                                ${rec.note ? escapeHtml(rec.note) : '點擊添加備註'}
                            </div>
                            <div class="history-actions">
                                <button class="detail-btn" onclick="loadLoanToForm(${rec.id})">套用</button>
                                <button class="delete-btn" onclick="deleteLoan(${rec.id})">刪除</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    });
    html += '</div>';

    historyContent.innerHTML = html;

    // 展開／收合與編輯模式的多選都由共用程式處理（同一容器只綁一次）
    setupHistoryPanel({
        panelId: 'historyPanel',
        containerId: 'historyContent',
        store: loanHistoryStore,
        onChange: loadHistoryData,
        onDeleted: function (ids) {
            ids.forEach(id => {
                if (String(loanSourceId) === String(id)) detachLoanFromHistory();
            });
        }
    });
}

/**
 * 將歷史筆數載入表單
 */
function loadLoanToForm(id) {
    const rec = loanHistoryStore.get(id);
    const loan = rec ? rec.data : null;

    if (loan) {
        // 舊紀錄可能存有超出現行上限的數值，載入時一併夾在合法範圍內，
        // 避免歷史資料把欄位帶到計算不出來的狀態。
        const clampAmount = v => Math.max(0, Math.min(Math.round(parseFloat(v) || 0), LIMITS.MAX_AMOUNT));

        document.getElementById('period').value =
            Math.max(0, Math.min(parseFloat(loan.period) || 0, LIMITS.MAX_PERIOD));
        document.getElementById('rate').value =
            Math.max(0, Math.min(parseFloat(loan.rate) || 0, LIMITS.MAX_RATE));
        document.getElementById('principal').value = formatNumberWithCommas(clampAmount(loan.principal));
        document.getElementById('payment').value = formatNumberWithCommas(clampAmount(loan.payment));
        document.getElementById('commission').value = formatNumberWithCommas(clampAmount(loan.commission));

        if (typeof calculatePayment === 'function') calculatePayment();
        if (typeof updateAllFields === 'function') updateAllFields();

        /* 記住資料來源。之後改了內容再按存檔，就會問要覆蓋還是另存。
         * 注意順序：必須在上面兩個重算之後才設定 —— 重算會經過
         * markLoanChanged()，先設定的話會立刻被標成「已修改」。 */
        loanSourceId = id;
        loanHasUnsavedChanges = false;
        updateLoanUnsavedHint();

        const historyPanel = document.getElementById('historyPanel');
        if (historyPanel) historyPanel.style.display = 'none';
        
        // 從歷史叫回舊案件。這個數字高代表業務會回頭找舊案，
        // 也就代表歷史紀錄這個功能值得再加強。
        if (typeof trackCalcEvent === 'function') {
            trackCalcEvent('loan_history_loaded');
        }

        if (typeof showToast === 'function') showToast('已套用');
        if (typeof vibrate === 'function') vibrate();
    }
}

/**
 * 刪除單筆歷史記錄
 */
function deleteLoan(id) {
    if (typeof showConfirmModal === 'function') {
        /* 【2026/07 步驟 3】確認訊息帶出這一筆的摘要，與另外兩頁一致。
         * 只寫「確定要刪除嗎」的話，使用者按下去之前無從確認自己點對了列。 */
        const rec = loanHistoryStore.get(id);
        const summary = rec
            ? `${rec.data.period} 期 · 本金 ${formatNumber(rec.data.principal)}<br><br>`
            : '';

        showConfirmModal(
            '刪除確認',
            `確定要刪除這筆紀錄嗎？<br><br>${summary}此操作無法復原。`,
            function() {
                if (!loanHistoryStore.remove(id)) return;
                forgetHistoryExpanded(id);
                loadHistoryData();
                if (typeof showToast === 'function') showToast('已刪除');
                if (typeof vibrate === 'function') vibrate();
            }
        );
    }
}

/* confirmDeleteAll() 與 deleteAllLoans() 已於 2026/07 步驟 5 移除。
 * 功能由編輯模式的「全選 → 刪除」取代，而且更安全：
 * 舊版那顆「清空歷史」就擺在關閉鈕旁邊，是不可復原的動作卻只要誤觸一次。 */

/**
 * 開啟備註編輯彈窗
 */
/**
 * 開啟備註編輯視窗
 *
 * 【2026/07 修正 B3】
 * 改用 common-keypad.js 的共用對話框，與支票頁共用同一套。
 *
 * 舊版的 adjustNoteEditorPosition() 其實有 bug：if 與 else 兩個分支
 * 設定的值完全一樣（都是 paddingTop 180px），等於偵測鍵盤的判斷式
 * 從來沒有起過作用。共用版本改用 visualViewport.height 實際計算
 * 「扣掉鍵盤後的可視高度」再置中，這才是真的會隨鍵盤調整。
 *
 * 另外舊版把備註內容直接寫進 HTML 字串，內容含 < 或引號就會破版；
 * 共用版本改用 textarea.value 指定，不會有這個問題。
 */
function openNoteEditor(loanId) {
    // 【B3】備註內容改為在這裡自行查出，不再透過 onclick 屬性傳字串。
    // 舊版是 onclick="openNoteEditor(id, '備註內容')"，只跳脫了單引號，
    // 備註若含有雙引號或換行就會把 HTML 屬性整個切斷。
    const rec = loanHistoryStore.get(loanId);
    if (!rec) return;

    showNoteEditor({
        title: '備註編輯',
        note: rec.note || '',
        onSave: function (newNote) {
            saveLoanNote(loanId, newNote);
        }
    });
}

function saveLoanNote(loanId, newNote) {
    // 寫入失敗（容量滿、無痕模式）由 Store 統一提示
    if (!loanHistoryStore.setNote(loanId, newNote)) return;
    loadHistoryData();
    if (typeof showToast === 'function') showToast('備註已儲存');
}

/* 頁面可見性變化與離頁自動保存監聽 */
document.addEventListener('visibilitychange', function() {
    const isInIframe = (window.self !== window.top);
    if (document.hidden) {
        if (typeof updateAllFields === 'function') {
            try { updateAllFields(); } catch (e) {}
        }
        localStorage.setItem('pageHiddenTime', new Date().toISOString());
    } else {
        const hiddenTime = localStorage.getItem('pageHiddenTime');
        if (hiddenTime && !isInIframe) {
            const minutesHidden = Math.floor((new Date() - new Date(hiddenTime)) / 60000);
            if (minutesHidden >= 5 && localStorage.getItem('loanCalculatorAutoSave')) {
                if (typeof showToast === 'function') showToast('歡迎回來！您的計算資料已保存');
            }
        }
        localStorage.removeItem('pageHiddenTime');
    }
});

window.addEventListener('beforeunload', function(event) {
    if (typeof updateAllFields === 'function') {
        try { updateAllFields(); } catch (e) {}
    }
    const isInIframe = (window.self !== window.top);
    if (isInIframe) return;
    
    const hasUnsavedData = document.getElementById('period')?.value || 
                           document.getElementById('rate')?.value || 
                           document.getElementById('principal')?.value || 
                           document.getElementById('payment')?.value;
    if (hasUnsavedData) {
        event.preventDefault();
        event.returnValue = '';
    }
});
