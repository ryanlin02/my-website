const fs=require('fs');
const {JSDOM}=require('jsdom');
const R=require('path').join(__dirname,'..');
let pass=0,fail=0;
const t=(n,c,e='')=>{c?pass++:fail++;console.log((c?'  PASS  ':'  FAIL  ')+n+(c?'':'   → '+e));};

function boot(page, scripts){
  const dom=new JSDOM(fs.readFileSync(R+'/pages/'+page,'utf8'),
    {url:'https://ryanlin02.github.io/my-website/pages/'+page,runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window;
  w.eval('window.setInterval=function(){return 0;};window.setTimeout=function(f){return 0;};');
  /* jsdom 不執行 HTML 內嵌 script，手動重現頁面裡的鍵盤設定。
   * 改為整段 <script> eval：KEYPAD_FIELDS 是巢狀物件，
   * 原本用 \{[^}]*\} 抓單一宣告會在第一個 } 就截斷。 */
  for(const m of fs.readFileSync(R+'/pages/'+page,'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)){
    if(m[1].includes('KEYPAD')) w.eval(m[1]);
  }
  // 依照 HTML 中 <script src> 的真實順序載入，頂層 let 轉 var 以便從外部讀取狀態
  for(const s of scripts) w.eval(fs.readFileSync(R+'/js/'+s,'utf8').replace(/^let /gm,'var '));
  w.eval('initCommonModals()');
  return {dom,w,d:w.document,ev:c=>w.eval(c)};
}

// 從 HTML 讀出實際的 script 載入順序，確保測的順序跟線上一致
const order=page=>[...fs.readFileSync(R+'/pages/'+page,'utf8').matchAll(/<script src="\.\.\/js\/([^"]+)"/g)]
  .map(m=>m[1]).filter(f=>f!=='frame-guard.js');

for(const page of ['calculator.html','check.html']){
  const scripts=order(page);
  console.log('\n════════ '+page+' ════════');
  console.log('  載入順序: '+scripts.join(' → '));
  const {w,d,ev}=boot(page,scripts);

  // 1) 所有 onclick 屬性指向的函式都必須存在
  const handlers=[...d.querySelectorAll('[onclick]')].map(e=>e.getAttribute('onclick'));
  const fns=[...new Set(handlers.map(h=>h.trim().replace(/\(.*/s,'')).filter(Boolean))];
  const missing=fns.filter(f=>ev('typeof '+f)!=='function');
  t('所有 onclick 函式皆已定義 ('+fns.length+' 個)', missing.length===0, '缺少: '+missing.join(', '));

  // 2) 共用鍵盤函式必須從 common-keypad.js 取得
  const shared=['vibrate','closeModal','showToast','showModal','hideModal','showConfirmModal','hideConfirmModal',
    'openCalculator','calculatorInput','calculatorDecimal','calculatorClear','calculatorBackspace',
    'calculatorOperation','calculatorEquals','updateCalculatorHistory'];
  const lost=shared.filter(f=>ev('typeof '+f)!=='function');
  t('15 個共用函式全部可用', lost.length===0, '缺少: '+lost.join(', '));

  // 3) 頁面專屬函式仍在
  const own = page==='calculator.html'
    ? ['submitCalculatorValue','calculatePayment','calculateRate','updateAllFields','toggleHistoryPanel',
       'saveLoanData','loadHistoryData','loadLoanToForm','deleteLoan','openNoteEditor','saveLoanNote',
       /* confirmDeleteAll 已於 2026/07 步驟 5 移除（四頁皆同）：
          功能由編輯模式的「全選 → 刪除」取代。 */
       'toggleHistoryEditMode','exitHistoryEditMode','toggleHistorySelectAll','deleteSelectedHistory',
       'adjustPeriod','setPeriod','adjustRate','setRate','adjustCommission','setCommissionPercent',
       'adjustPrincipal','roundPayment','adjustPayment','clearAllFieldsExceptMonthlyCost','resetMonthlyCost',
       'clearField','clearCommission','restoreAutoData','PMT','RATE','formatNumberWithCommas']
    : ['submitCalculatorValue','calculateDepositAmount','generateCheckList','updateEndDateDisplay',
       'arabicToChineseNumber','renderChineseAmount','updateChineseDisplay','resetDepositDisplay',
       'toggleHistoryPanel','saveCheckData','loadCheckHistory','deleteCheckHistoryItem',
       /* confirmDeleteAll 已於 2026/07 步驟 5 移除：功能由編輯模式的
          「全選 → 刪除」取代（deleteSelectedHistory），而且更安全。
          計算頁與加油頁尚未改用編輯模式，那兩頁仍然有這支函式。 */
       'toggleHistoryEditMode','exitHistoryEditMode','toggleHistorySelectAll','deleteSelectedHistory',
       'openNoteEditor','saveCheckNote','showDatePicker','clearAllInputs',
       'formatNumber','formatDateToROC','updateCurrentDate'];
  const lostOwn=own.filter(f=>ev('typeof '+f)!=='function');
  t('頁面專屬函式全部健在 ('+own.length+' 個)', lostOwn.length===0, '缺少: '+lostOwn.join(', '));

  // 4) 鍵盤實際運算（共用邏輯是否真的被正確共用）
  ev('calculatorClear()');
  ev('calculatorInput(1);calculatorInput(2);calculatorInput(3);');
  t('連續輸入 123', ev('calculatorValue')==='123', ev('calculatorValue'));
  ev('calculatorBackspace()');
  t('退格 → 12', ev('calculatorValue')==='12', ev('calculatorValue'));
  ev('calculatorOperation("*");calculatorInput(5);calculatorEquals();');
  t('12 × 5 = 60', ev('calculatorValue')==='60', ev('calculatorValue'));
  ev('calculatorClear();calculatorInput(1);calculatorInput(0);calculatorOperation("/");calculatorInput(4);calculatorEquals();');
  t('10 ÷ 4 = 2.5', ev('calculatorValue')==='2.5', ev('calculatorValue'));
  ev('calculatorClear();calculatorInput(1);calculatorOperation("/");calculatorInput(0);calculatorEquals();');
  t('除以零會被擋下並歸零', ev('calculatorValue')==='0', ev('calculatorValue'));
  ev('calculatorClear();calculatorInput(1);calculatorOperation("+");calculatorInput(2);calculatorOperation("+");');
  t('連續運算子自動結算 (1+2+ → 3)', ev('calculatorValue')==='3', ev('calculatorValue'));
  t('算式歷程有記錄', ev('calculatorHistory').length>0, ev('calculatorHistory'));
  /* 顯示區會加千分位（2026/07），狀態一律保持沒有逗號的原字串 ——
   * 各頁的 submitCalculatorValue() 都直接 parseFloat 這個狀態。 */
  t('顯示區與狀態同步（顯示帶千分位、狀態不帶）',
    d.getElementById('calculatorDisplay').textContent===ev('groupThousands(calculatorValue)')
    && !ev('calculatorValue').includes(','),
    d.getElementById('calculatorDisplay').textContent+' vs '+ev('calculatorValue'));

  // 5) 小數點：計算頁應可用，支票頁應已隱藏
  const hasDecimalKey=handlers.some(h=>h.includes('calculatorDecimal'));
  if(page==='calculator.html'){
    t('計算頁保有小數點鍵', hasDecimalKey);
    ev('calculatorClear();calculatorInput(3);calculatorDecimal();calculatorInput(5);');
    t('  小數點可正常輸入 3.5', ev('calculatorValue')==='3.5', ev('calculatorValue'));
  } else {
    t('支票頁已隱藏小數點鍵', !hasDecimalKey);
    t('  但函式仍存在，不會再有 ReferenceError', ev('typeof calculatorDecimal')==='function');
  }

  // 6) 彈窗
  ev('showToast("測試訊息")');
  t('Toast 可建立且套用正確樣式', d.querySelector('.toast-message')!==null);
  ev('showToast("錯誤訊息", true)');
  t('  錯誤 Toast 帶 toast-error', d.querySelector('.toast-message').classList.contains('toast-error'));
  ev('showModal("標題","內容")');
  t('提示彈窗可開啟', d.getElementById('modalOverlay').style.display==='flex');
  ev('hideModal()');
  t('  可關閉', d.getElementById('modalOverlay').style.display==='none');
  ev('window.__confirmed=false; showConfirmModal("確認","要嗎？",function(){window.__confirmed=true;});');
  t('確認彈窗可開啟', d.getElementById('confirmModalOverlay').style.display==='flex');
  d.getElementById('confirmModalOk').click();
  t('  按確定會執行 callback', w.__confirmed===true);
  t('  按確定後自動關閉', d.getElementById('confirmModalOverlay').style.display==='none');
  ev('window.__c2=0; showConfirmModal("A","1",function(){window.__c2++;}); showConfirmModal("B","2",function(){window.__c2+=10;});');
  d.getElementById('confirmModalOk').click();
  t('  重複開啟不會累積舊 callback (應為 10)', w.__c2===10, String(w.__c2));

  // 6b) 共用備註對話框（B3）
  t('共用備註對話框函式可用', ev('typeof showNoteEditor')==='function' && ev('typeof closeNoteEditorDialog')==='function');
  ev('window.__savedNote=null; showNoteEditor({title:"備註編輯", note:"原本的備註 <b> 與 \'引號\'", onSave:function(x){window.__savedNote=x;}});');
  const noteModal=d.getElementById('noteEditorModal');
  t('  對話框已建立', noteModal!==null);
  t('  用的是不會被鍵盤遮擋的 note-editor-modal', noteModal.className==='note-editor-modal', noteModal.className);
  t('  對齊方式為靠上（非垂直置中）', noteModal.style.alignItems==='flex-start', noteModal.style.alignItems);
  t('  含有 < 與引號的備註不會破版', d.getElementById('noteEditorInput').value==='原本的備註 <b> 與 \'引號\'', d.getElementById('noteEditorInput').value);
  d.getElementById('noteEditorInput').value='改過的備註  ';
  noteModal.querySelector('[data-role="save"]').click();
  t('  儲存會回傳修剪過的文字', w.__savedNote==='改過的備註', JSON.stringify(w.__savedNote));
  t('  儲存後對話框移除', d.getElementById('noteEditorModal')===null);
  ev('showNoteEditor({note:"x", onSave:function(){}});');
  d.getElementById('noteEditorModal').querySelector('[data-role="cancel"]').click();
  t('  取消會關閉且不觸發儲存', d.getElementById('noteEditorModal')===null);
  ev('showNoteEditor({note:"a",onSave:function(){}}); showNoteEditor({note:"b",onSave:function(){}});');
  t('  重複開啟不會殘留兩個對話框', d.querySelectorAll('#noteEditorModal, .note-editor-modal').length===1,
    String(d.querySelectorAll('.note-editor-modal').length));
  ev('closeNoteEditorDialog()');

  // 7) openCalculator 帶入現值 + 重設捲動提示
  const field = page==='calculator.html' ? 'principal' : 'total-amount';
  d.getElementById(field).value='1,234,567';
  d.getElementById('historyScrollIndicator').style.opacity='1';
  ev(`openCalculator(${JSON.stringify(field)},'測試')`);
  t('openCalculator 帶入欄位現值並去逗號', ev('calculatorValue')==='1234567', ev('calculatorValue'));
  t('  重設算式捲動提示 (支票頁舊版漏此行)', d.getElementById('historyScrollIndicator').style.opacity==='0');
  t('  彈窗開啟', d.getElementById('numberInputModal').style.display==='flex');
  t('  標題正確', d.getElementById('inputModalTitle').textContent==='測試');
  ev('closeModal("numberInputModal")');
  t('  可關閉', d.getElementById('numberInputModal').style.display==='none');
  d.getElementById(field).value='';
}
console.log('\n========================================');
console.log('   通過 '+pass+' 項 / 失敗 '+fail+' 項');
console.log('========================================');
process.exit(fail?1:0);
