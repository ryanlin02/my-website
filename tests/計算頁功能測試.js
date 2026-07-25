const fs=require('fs');
const {JSDOM}=require('jsdom');
const R=require('path').join(__dirname,'..');
const dom=new JSDOM(fs.readFileSync(R+'/pages/calculator.html','utf8'),
  {url:'https://ryanlin02.github.io/my-website/pages/calculator.html',runScripts:'outside-only',pretendToBeVisual:true});
const w=dom.window, d=w.document, ev=c=>w.eval(c);
w.eval('window.setInterval=function(){return 0;};window.setTimeout=function(){return 0;};');
const scripts=[...fs.readFileSync(R+'/pages/calculator.html','utf8').matchAll(/<script src="\.\.\/js\/([^"]+)"/g)]
  .map(m=>m[1]).filter(f=>f!=='frame-guard.js');
for(const f of scripts) ev(fs.readFileSync(R+'/js/'+f,'utf8').replace(/^let /gm,'var '));
ev('initCommonModals()');

let pass=0,fail=0;
const t=(n,c,e='')=>{c?pass++:fail++;console.log((c?'  PASS  ':'  FAIL  ')+n+(c?'':'   → '+e));};
const v=id=>d.getElementById(id).value;
const setV=(id,val)=>{d.getElementById(id).value=val;};
// 走真實路徑：開鍵盤 → 輸入 → 確認輸入
const viaKeypad=(id,num)=>ev(`openCalculator(${JSON.stringify(id)},'t');calculatorValue=${JSON.stringify(String(num))};submitCalculatorValue();`);

console.log('\n=== 核心試算：期數/利率/本金 → 期繳 ===');
viaKeypad('period',60); viaKeypad('rate',8); viaKeypad('principal',1000000);
t('期數 60', v('period')==='60', v('period'));
t('利率 8.0000', v('rate')==='8.0000', v('rate'));
t('本金 1,000,000', v('principal')==='1,000,000', v('principal'));
t('期繳自動算出', v('payment')!=='', v('payment'));
const pmt=parseFloat(v('payment').replace(/,/g,''));
t('  期繳金額合理 (20,276)', pmt===20276, String(pmt));
t('總繳款 = 期繳×期數', v('totalPayment')==='1,216,560', v('totalPayment'));
t('總利息 = 總繳款−本金', v('totalInterest')==='216,560', v('totalInterest'));
t('稅金已算出', v('tax')!=='', v('tax'));
t('稅後利率已算出', v('afterTaxRate')!=='', v('afterTaxRate'));
t('每年利息', v('yearlyInterest')!=='', v('yearlyInterest'));
t('百萬利息', v('annualMillionInterest')!=='', v('annualMillionInterest'));

console.log('\n=== 反推：期繳 → 利率 ===');
const rateBefore=v('rate');
viaKeypad('payment',21000);
t('期繳改為 21,000', v('payment')==='21,000', v('payment'));
t('利率被反推更新', v('rate')!==rateBefore, v('rate')+' (原 '+rateBefore+')');
t('  反推利率合理 (>8%)', parseFloat(v('rate'))>8, v('rate'));

console.log('\n=== 佣金連動 ===');
viaKeypad('commission',30000);
t('佣金 30,000', v('commission')==='30,000', v('commission'));
t('佣金比例 = 3.00', v('commissionRatio')==='3.00', v('commissionRatio'));
t('佣後利率已算出', v('afterCommissionOnlyRate')!=='', v('afterCommissionOnlyRate'));
t('稅佣後利率已算出', v('afterCommissionRate')!=='', v('afterCommissionRate'));
t('Spread 已算出', v('spread')!=='', v('spread'));
t('NPV 已算出', v('fundingCost')!=='', v('fundingCost'));
t('頂部 header 同步佣後利率', v('headerAfterCommissionOnlyRate')===v('afterCommissionOnlyRate'));
t('頂部 header 同步稅佣後利率', v('headerAfterCommissionRate')===v('afterCommissionRate'));

console.log('\n=== 快捷調整鍵 ===');
ev('setPeriod(36)');      t('setPeriod(36)', v('period')==='36', v('period'));
ev('adjustPeriod(1)');    t('adjustPeriod(+1) → 37', v('period')==='37', v('period'));
ev('setRate(6)');         t('setRate(6)', parseFloat(v('rate'))===6, v('rate'));
ev('adjustRate(0.2)');    t('adjustRate(+0.2) → 6.2', v('rate')==='6.2000', v('rate'));
ev('adjustPrincipal(100000)'); t('adjustPrincipal(+10萬)', v('principal')==='1,100,000', v('principal'));
ev('adjustPayment(100)');
const p2=parseFloat(v('payment').replace(/,/g,''));
ev('roundPayment("down",100)');
t('捨百', parseFloat(v('payment').replace(/,/g,''))%100===0, v('payment'));
ev('roundPayment("up",100)');
t('進百', parseFloat(v('payment').replace(/,/g,''))%100===0, v('payment'));
ev('setCommissionPercent(2)');
t('setCommissionPercent(2) = 本金 2%', v('commission')==='22,000', v('commission'));
ev('adjustCommission(-1000)'); t('adjustCommission(−千)', v('commission')==='21,000', v('commission'));
ev('clearCommission()');  t('清除佣金', v('commission')==='', v('commission'));

console.log('\n=== 輸入驗證（上下限）===');
viaKeypad('rate',-1);     t('利率負數被擋下', v('rate')!=='-1.0000', v('rate'));
viaKeypad('principal',0); t('本金 0 被擋下', v('principal')!=='0', v('principal'));
viaKeypad('period',60);
viaKeypad('period',1000); t('期數超上限 (>999) 被擋下', v('period')==='60', v('period'));
viaKeypad('period',999);  t('期數 999 (上限內) 可接受', v('period')==='999', v('period'));

console.log('\n=== Toast 警告仍會觸發 ===');
ev('rateWarnShown=false; warnRateIfOver(99);');
t('利率超標會跳 Toast', d.querySelector('.toast-message')!==null,
  d.querySelector('.toast-message')&&d.querySelector('.toast-message').textContent);
t('  且為錯誤樣式', d.querySelector('.toast-message').classList.contains('toast-error'));

console.log('\n=== 歷史記錄（走 showConfirmModal 共用邏輯）===');
ev('setPeriod(60);setRate(8);'); viaKeypad('principal',1000000);
ev('saveLoanData()');
t('保存 1 筆', JSON.parse(w.localStorage.getItem('loanHistory')||'[]').length===1);
ev('toggleHistoryPanel()');
t('面板可開啟', d.getElementById('historyPanel').style.display==='block');
t('  列表有內容', d.getElementById('historyContent').textContent.includes('本金'));
const id=JSON.parse(w.localStorage.getItem('loanHistory'))[0].id;
ev('loadLoanToForm('+id+')');
t('載入計算可回填本金', v('principal')==='1,000,000', v('principal'));
ev('deleteLoan('+id+')');
t('刪除會先跳確認彈窗（未直接刪）', JSON.parse(w.localStorage.getItem('loanHistory')).length===1);
d.getElementById('confirmModalOk').click();
t('  按確定後才真的刪除', JSON.parse(w.localStorage.getItem('loanHistory')).length===0);

console.log('\n=== 清空全部 ===');
viaKeypad('period',60); viaKeypad('rate',8); viaKeypad('principal',1000000);
ev('clearAllFieldsExceptMonthlyCost()');
const left=['period','rate','principal','payment','totalPayment','totalInterest','commission','spread','fundingCost'].filter(id=>v(id)!=='');
t('欄位全部清空', left.length===0, left.join(','));
t('資金成本保留預設值 2', v('monthlyCost')==='2', v('monthlyCost'));
t('自動備份已清除', w.localStorage.getItem('loanCalculatorAutoSave')===null);

console.log('\n=== 自動備份與還原 ===');
viaKeypad('period',48); viaKeypad('rate',7); viaKeypad('principal',800000);
t('操作後有寫入自動備份', w.localStorage.getItem('loanCalculatorAutoSave')!==null);
ev('clearAllFieldsExceptMonthlyCost()');
w.localStorage.setItem('loanCalculatorAutoSave',JSON.stringify({period:'48',rate:'7.0000',principal:'800,000',payment:'',commission:'',monthlyCost:'2',timestamp:new Date().toISOString()}));
ev('restoreAutoData()');
t('可還原上次資料', v('period')==='48'&&v('principal')==='800,000', v('period')+'/'+v('principal'));

console.log('\n========================================');
console.log('   通過 '+pass+' 項 / 失敗 '+fail+' 項');
console.log('========================================');
process.exit(fail?1:0);
