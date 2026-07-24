/**
 * 重車貸款業務工具箱 - 通用彈窗與數字鍵盤元件模組 (common-modals.js)
 * 動態注入 DOM，提供跨頁面復用的提示彈窗、確認彈窗、數字小鍵盤與通用頁尾
 */

function initCommonModals() {
    // 注入全站通用頁尾
    renderGlobalFooter();

    // 避免重複注入
    if (document.getElementById('numberInputModal')) return;

    const modalWrapper = document.createElement('div');
    modalWrapper.id = 'commonModalsWrapper';
    modalWrapper.innerHTML = `
    <!-- 通用提示模態框 -->
    <div id="modalOverlay" class="modal-overlay">
        <div class="modal-container">
            <div class="modal-header">
                <h3 id="modalTitle">提示</h3>
                <button class="close-btn" onclick="hideModal()">×</button>
            </div>
            <div id="modalContent" class="modal-content"></div>
            <div class="modal-footer">
                <button class="modal-btn modal-btn-primary" onclick="hideModal()">確定</button>
            </div>
        </div>
    </div>

    <!-- 通用確認模態框 -->
    <div id="confirmModalOverlay" class="modal-overlay">
        <div class="modal-container">
            <div class="modal-header">
                <h3 id="confirmModalTitle">確認</h3>
                <button class="close-btn" onclick="hideConfirmModal()">×</button>
            </div>
            <div id="confirmModalContent" class="modal-content"></div>
            <div class="modal-footer">
                <button class="modal-btn modal-btn-secondary" onclick="hideConfirmModal()">取消</button>
                <button id="confirmModalOk" class="modal-btn modal-btn-primary">確定</button>
            </div>
        </div>
    </div>

    <!-- 通用數字輸入器模態框 -->
    <div id="numberInputModal" class="modal-overlay">
        <div class="number-input-modal">
            <div class="modal-header">
                <h3 id="inputModalTitle">數字輸入器</h3>
                <button class="close-btn" onclick="closeModal('numberInputModal')">×</button>
            </div>

            <div class="calculator-display-container">
                <div class="calculator-scroll-indicator" id="historyScrollIndicator"></div>
                <div class="calculator-history" id="calculatorHistory"></div>
                <div class="calculator-display" id="calculatorDisplay">0</div>
            </div>

            <div class="calculator-buttons">
                <!-- 第一行：功能鍵 -->
                <button onclick="calculatorClear()" class="clear" style="grid-column: span 2;">C 清除</button>
                <button onclick="calculatorBackspace()" class="function">⌫</button>
                <button onclick="calculatorOperation('/')" class="operator">÷</button>
                
                <!-- 第二行：數字 7 8 9 與乘號 -->
                <button onclick="calculatorInput(7)" class="number-btn">
                    <div class="arabic-number">7</div>
                    <div class="financial-char">柒</div>
                </button>
                <button onclick="calculatorInput(8)" class="number-btn">
                    <div class="arabic-number">8</div>
                    <div class="financial-char">捌</div>
                </button>
                <button onclick="calculatorInput(9)" class="number-btn">
                    <div class="arabic-number">9</div>
                    <div class="financial-char">玖</div>
                </button>
                <button onclick="calculatorOperation('*')" class="operator">×</button>
                
                <!-- 第三行：數字 4 5 6 與減號 -->
                <button onclick="calculatorInput(4)" class="number-btn">
                    <div class="arabic-number">4</div>
                    <div class="financial-char">肆</div>
                </button>
                <button onclick="calculatorInput(5)" class="number-btn">
                    <div class="arabic-number">5</div>
                    <div class="financial-char">伍</div>
                </button>
                <button onclick="calculatorInput(6)" class="number-btn">
                    <div class="arabic-number">6</div>
                    <div class="financial-char">陸</div>
                </button>
                <button onclick="calculatorOperation('-')" class="operator">−</button>
                
                <!-- 第四行：數字 1 2 3 與加號 -->
                <button onclick="calculatorInput(1)" class="number-btn">
                    <div class="arabic-number">1</div>
                    <div class="financial-char">壹</div>
                </button>
                <button onclick="calculatorInput(2)" class="number-btn">
                    <div class="arabic-number">2</div>
                    <div class="financial-char">貳</div>
                </button>
                <button onclick="calculatorInput(3)" class="number-btn">
                    <div class="arabic-number">3</div>
                    <div class="financial-char">參</div>
                </button>
                <button onclick="calculatorOperation('+')" class="operator">+</button>
                
                <!-- 第五行：零、小數點和等號 -->
                <button onclick="calculatorInput(0)" class="number-btn zero-btn">
                    <div class="arabic-number">0</div>
                    <div class="financial-char">零</div>
                </button>
                <button onclick="calculatorDecimal()" class="function">.</button>
                <button onclick="calculatorEquals()" class="equals">=</button>
            </div>

            <!-- 獨立滿版確認輸入按鈕區域 -->
            <div class="calculator-submit-container">
                <button onclick="submitCalculatorValue()" class="submit-btn-primary">確認輸入</button>
            </div>
        </div>
    </div>
    `;

    document.body.appendChild(modalWrapper);
}

/**
 * 注入全站通用頁尾 (Global Footer)
 */
function renderGlobalFooter() {
    if (document.getElementById('globalAppFooter')) return;
    const footerElement = document.createElement('footer');
    footerElement.id = 'globalAppFooter';
    footerElement.className = 'global-app-footer';
    footerElement.innerHTML = `
        <div class="footer-title">重車貸款業務工具箱 • v2.5.0</div>
        <div class="footer-copyright">© 2026 Fleet Loan Toolkit. All rights reserved.</div>
    `;
    document.body.appendChild(footerElement);
}

// 自動監聽與載入注入
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCommonModals);
} else {
    initCommonModals();
}
