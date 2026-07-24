/**
 * 重車貸款業務工具箱 - 數據持久化與歷史紀錄模組 (calc-storage.js)
 * 100% 保持 LocalStorage Schema 相容性：
 * - loanCalculatorAutoSave
 * - loanCalculatorIframeBackup
 * - loanCalculatorEmergencyBackup
 * - loanHistory
 */

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
        
        if (!savedDataStr) {
            savedDataStr = localStorage.getItem('loanCalculatorEmergencyBackup');
            dataSource = 'emergency-backup';
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
                localStorage.removeItem('loanCalculatorEmergencyBackup');
            }
        }
    } catch (error) {
        console.error('恢復自動保存數據失敗:', error);
        try {
            localStorage.removeItem('loanCalculatorAutoSave');
            localStorage.removeItem('loanCalculatorIframeBackup');
            localStorage.removeItem('loanCalculatorEmergencyBackup');
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
    
    const loanDate = new Date();
    const formattedDate = `${loanDate.getFullYear()}-${String(loanDate.getMonth() + 1).padStart(2, '0')}-${String(loanDate.getDate()).padStart(2, '0')} ${String(loanDate.getHours()).padStart(2, '0')}:${String(loanDate.getMinutes()).padStart(2, '0')}`;
    
    const loanData = {
        id: new Date().getTime(),
        date: formattedDate,
        period: period,
        rate: rate,
        principal: principal,
        payment: payment,
        afterTaxRate: afterTaxRate,
        commission: commission || '0',
        afterCommissionRate: afterCommissionRate,
        totalInterest: document.getElementById('totalInterest').value.replace(/,/g, ''),
        timestamp: new Date().toISOString(),
        note: ''
    };
    
    let loanHistory = JSON.parse(localStorage.getItem('loanHistory') || '[]');
    loanHistory.push(loanData);
    localStorage.setItem('loanHistory', JSON.stringify(loanHistory));
    
    if (typeof showToast === 'function') showToast('貸款計算結果已保存！');
}

/**
 * 載入歷史記錄面板列表內容
 */
function loadHistoryData() {
    const historyContent = document.getElementById('historyContent');
    if (!historyContent) return;
    
    const loanHistory = JSON.parse(localStorage.getItem('loanHistory') || '[]');
    
    if (loanHistory.length === 0) {
        historyContent.innerHTML = '<p class="no-data">尚無貸款計算記錄</p>';
        return;
    }
    
    loanHistory.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    let html = '<div class="history-list">';
    loanHistory.forEach(loan => {
        const principalDisplay = formatNumber(loan.principal);
        const paymentDisplay = formatNumber(loan.payment);
        const commissionDisplay = formatNumber(loan.commission);
        
        html += `
            <div class="history-item" data-loan-id="${loan.id}">
                <div class="history-item-header">
                    <div class="history-date">${formatDate(loan.date)}</div>
                    <div class="history-header-rate">稅佣後利率: ${parseFloat(loan.afterCommissionRate).toFixed(4)}%</div>
                </div>
                
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
                        <div class="history-note-preview ${loan.note ? '' : 'empty-note'}" onclick="openNoteEditor(${loan.id}, '${loan.note ? loan.note.replace(/'/g, "\\'") : ''}')">
                            ${loan.note ? loan.note : '點擊添加備註'}
                        </div>
                        <div class="history-actions">
                            <button class="detail-btn" onclick="loadLoanToForm(${loan.id})">載入計算</button>
                            <button class="delete-btn" onclick="deleteLoan(${loan.id})">刪除</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    });
    html += '</div>';
    
    historyContent.innerHTML = html;
}

/**
 * 將歷史筆數載入表單
 */
function loadLoanToForm(id) {
    const loanHistory = JSON.parse(localStorage.getItem('loanHistory') || '[]');
    const loan = loanHistory.find(item => item.id === id);
    
    if (loan) {
        document.getElementById('period').value = loan.period;
        document.getElementById('rate').value = loan.rate;
        document.getElementById('principal').value = formatNumberWithCommas(Math.round(parseFloat(loan.principal)));
        document.getElementById('payment').value = formatNumberWithCommas(Math.round(parseFloat(loan.payment)));
        document.getElementById('commission').value = formatNumberWithCommas(Math.round(parseFloat(loan.commission)));
        
        if (typeof calculatePayment === 'function') calculatePayment();
        if (typeof updateAllFields === 'function') updateAllFields();
        
        const historyPanel = document.getElementById('historyPanel');
        if (historyPanel) historyPanel.style.display = 'none';
        
        if (typeof showToast === 'function') showToast('已載入貸款計算資料');
        if (typeof vibrate === 'function') vibrate();
    }
}

/**
 * 刪除單筆歷史記錄
 */
function deleteLoan(id) {
    if (typeof showConfirmModal === 'function') {
        showConfirmModal(
            '確認刪除', 
            '您確定要刪除這筆貸款記錄嗎？<br><br>此操作無法復原。', 
            function() {
                let loanHistory = JSON.parse(localStorage.getItem('loanHistory') || '[]');
                loanHistory = loanHistory.filter(loan => loan.id !== id);
                localStorage.setItem('loanHistory', JSON.stringify(loanHistory));
                loadHistoryData();
                if (typeof showToast === 'function') showToast('貸款記錄已刪除！');
                if (typeof vibrate === 'function') vibrate();
            }
        );
    }
}

/**
 * 確認刪除所有歷史記錄
 */
function confirmDeleteAll() {
    if (typeof showConfirmModal === 'function') {
        showConfirmModal('確認刪除', '確定要刪除所有貸款計算記錄嗎？此操作無法撤銷。', deleteAllLoans);
    }
}

/**
 * 刪除全體歷史記錄
 */
function deleteAllLoans() {
    localStorage.removeItem('loanHistory');
    loadHistoryData();
    if (typeof showToast === 'function') showToast('所有貸款記錄已刪除！');
    if (typeof vibrate === 'function') vibrate();
}

/**
 * 開啟備註編輯彈窗
 */
function openNoteEditor(loanId, existingNote = '') {
    const existingModal = document.getElementById('noteEditorModal');
    if (existingModal) document.body.removeChild(existingModal);
    
    const noteEditorModal = document.createElement('div');
    noteEditorModal.className = 'note-editor-modal';
    noteEditorModal.id = 'noteEditorModal';
    noteEditorModal.innerHTML = `
        <div class="note-editor-content">
            <h3>備註編輯</h3>
            <textarea id="noteEditorInput" class="note-editor-input" placeholder="請輸入備註內容...">${existingNote}</textarea>
            <div class="note-editor-buttons">
                <button onclick="closeNoteEditor(false)" class="modal-btn modal-btn-secondary">取消</button>
                <button onclick="saveNote(${loanId})" class="modal-btn modal-btn-primary">儲存</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(noteEditorModal);
    noteEditorModal.style.display = 'flex';
    
    const noteInput = document.getElementById('noteEditorInput');
    if (noteInput) noteInput.focus();
    
    noteEditorModal.addEventListener('click', function(event) {
        if (event.target === this) closeNoteEditor();
    });
    
    window.addEventListener('resize', adjustNoteEditorPosition);
    adjustNoteEditorPosition();
}

function adjustNoteEditorPosition() {
    const modal = document.getElementById('noteEditorModal');
    if (!modal) return;
    const windowHeight = window.innerHeight;
    const viewportHeight = window.visualViewport ? window.visualViewport.height : windowHeight;
    
    if (viewportHeight < windowHeight * 0.8) {
        modal.style.paddingTop = '180px';
        modal.style.justifyContent = 'center';
    } else {
        modal.style.paddingTop = '180px';
        modal.style.justifyContent = 'center';
    }
}

function closeNoteEditor() {
    const noteEditorModal = document.getElementById('noteEditorModal');
    if (noteEditorModal) {
        document.body.removeChild(noteEditorModal);
    }
    window.removeEventListener('resize', adjustNoteEditorPosition);
}

/**
 * 保存備註
 */
function saveNote(loanId) {
    const noteInput = document.getElementById('noteEditorInput');
    if (!noteInput) return;
    const newNote = noteInput.value.trim();
    
    let loanHistory = JSON.parse(localStorage.getItem('loanHistory') || '[]');
    const updatedHistory = loanHistory.map(loan => {
        if (loan.id === loanId) {
            return { ...loan, note: newNote };
        }
        return loan;
    });
    
    localStorage.setItem('loanHistory', JSON.stringify(updatedHistory));
    closeNoteEditor();
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
