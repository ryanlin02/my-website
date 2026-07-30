const fs=require('fs');
const {JSDOM}=require('jsdom');
const ROOT=require('path').join(__dirname,'..');

const dom=new JSDOM(fs.readFileSync(ROOT+'/pages/check.html','utf8'),
  {url:'https://ryanlin02.github.io/my-website/pages/check.html',runScripts:'outside-only',pretendToBeVisual:true});
const {window}=dom;
const document=window.document;
const ev=code=>window.eval(code);

ev('window.setInterval=function(){return 0;};window.setTimeout=function(){return 0;};');
// jsdom 不會執行 HTML 內嵌 script，手動重現 check.html 裡的 KEYPAD_OPTIONS 設定
const inlineCfg=fs.readFileSync(ROOT+'/pages/check.html','utf8').match(/window\.KEYPAD_OPTIONS\s*=\s*\{[^}]*\}/);
if(!inlineCfg) throw new Error('check.html 找不到 KEYPAD_OPTIONS 設定');
ev(inlineCfg[0]);
// jsdom 不載入外部 CSS，手動比照 calculator.css 的 .history-panel { display:none }
document.getElementById('historyPanel').style.display='none';

// 依 check.html 中 <script src> 的真實順序載入
const scripts=[...fs.readFileSync(ROOT+'/pages/check.html','utf8').matchAll(/<script src="\.\.\/js\/([^"]+)"/g)]
  .map(m=>m[1]).filter(f=>f!=='frame-guard.js');
if(scripts[0]!=='common-keypad.js') throw new Error('common-keypad.js 必須排在最前面，實得: '+scripts.join(','));
// eval 中的 let 不會建立 global binding，測試時把「頂層」let 換成 var 才能從外部讀取狀態
for(const f of scripts) ev(fs.readFileSync(ROOT+'/js/'+f,'utf8').replace(/^let /gm,'var '));
const engineSrc=fs.readFileSync(ROOT+'/js/check-engine.js','utf8');
ev('initCommonModals()');

let pass=0,fail=0;
const t=(name,cond,extra='')=>{ cond?pass++:fail++; console.log((cond?'  PASS  ':'  FAIL  ')+name+(cond?'':'   → '+extra)); };
const $=id=>document.getElementById(id);
const val=id=>{const e=$(id);return e?e.value:'<缺元素>';};
const html=id=>{const e=$(id);return e?e.innerHTML:'<缺元素>';};
const text=id=>{const e=$(id);return e?e.textContent.trim():'<缺元素>';};
const disp=sel=>document.querySelector(sel).style.display;
// let 宣告的變數不是 window 屬性，一律透過 window.eval 存取
const set=(field,v)=>ev(`currentInputField=${JSON.stringify(field)};calculatorValue=${JSON.stringify(String(v))};submitCalculatorValue();`);

/* 【2026/07 步驟 2】歷史紀錄改由 js/common-history.js 以「信封」格式存放
   （外殼有 id / note / savedAt，本頁欄位收在 rec.data 裡）。
   測試不再直接讀 localStorage 的原始字串 —— 那是實作細節，
   改從 Store 讀出來再攤平成舊的形狀，斷言的內容完全不變，
   而且以後再換一次儲存方式也不必再改這些測試。 */
const histList = () => JSON.parse(window.localStorage.getItem('checkHistory') || '[]')
    .map(r => Object.assign({ id: r.id, note: r.note }, r.data || {}));


console.log('\n=== A1 歷史記錄面板 ===');
t('初始為關閉', $('historyPanel').style.display==='none');
ev('toggleHistoryPanel()');
t('按一下會打開 (display:flex)', $('historyPanel').style.display==='flex', $('historyPanel').style.display);
t('打開時已載入內容', text('historyContent').length>0, text('historyContent'));
ev('toggleHistoryPanel()');
t('再按一下會關閉', $('historyPanel').style.display==='none');
const fnBody=engineSrc.match(/function toggleHistoryPanel\(\)[\s\S]*?\n}/)[0];
t('函式本體不再依賴 active class', !fnBody.includes("'active'"), fnBody);

console.log('\n=== A4 小數點鍵 ===');
const keys=[...document.querySelectorAll('.calculator-buttons button')].map(b=>b.getAttribute('onclick'));
t('支票頁沒有 calculatorDecimal 按鈕', !keys.some(k=>k&&k.includes('calculatorDecimal')), keys.join(' | '));
t('0 鍵改為 span 3 補滿空格', document.querySelector('.zero-btn').style.gridColumn==='span 3', document.querySelector('.zero-btn').style.gridColumn);
t('等號鍵仍在', keys.some(k=>k&&k.includes('calculatorEquals')));
t('鍵盤共 17 顆鍵（計算頁 18 顆，少一顆小數點）', keys.length===17, '總鍵數 '+keys.length);
t('沒有任何 onclick 指向未定義的函式',
  keys.every(k=>ev('typeof '+k.replace(/\(.*/,'')) === 'function'),
  keys.filter(k=>ev('typeof '+k.replace(/\(.*/,''))!=='function').join(','));

console.log('\n=== A5 負數與下限 ===');
set('total-amount',-100);
t('總金額 -100 被擋下', val('total-amount')==='', val('total-amount'));
t('  totalAmount 未被污染', ev('totalAmount')===0, String(ev('totalAmount')));
set('total-amount',0);       t('總金額 0 被擋下', val('total-amount')==='' && ev('totalAmount')===0);
set('payment-amount',-5000); t('繳款金額 -5000 被擋下', val('payment-amount')==='' && ev('paymentAmount')===0);
set('check-count',0);        t('開票張數 0 被擋下', val('check-count')==='' && ev('checkCount')===0);
set('check-count',0.4);      t('開票張數 0.4 被擋下 (先四捨五入再驗證)', val('check-count')==='', val('check-count'));
set('total-amount',1000000); t('總金額 1,000,000 正常寫入', val('total-amount')==='1,000,000', val('total-amount'));
t('  舊版漏洞複驗：100-200= 會產生 -100', ev('(function(){calculatorClear();calculatorValue="100";calculatorOperation("-");calculatorValue="200";calculatorEquals();return calculatorValue;})()')==='-100');
// 2026/07：共用鍵盤原本沒有運算優先順序，打 1000+2000×3 會算成 (1000+2000)×3 = 9000。
// 支票金額算錯不會報錯，只會讓客戶少付或多付。完整涵蓋見 tests/鍵盤運算正確性測試.js
t('  運算優先順序：1000+2000×3 = 7000（不是 9000）',
  ev('(function(){calculatorClear();for(const c of "1000")calculatorInput(+c);calculatorOperation("+");for(const c of "2000")calculatorInput(+c);calculatorOperation("*");calculatorInput(3);calculatorEquals();return calculatorValue;})()')==='7000');

console.log('\n=== A2 押票金額為負 ===');
set('payment-amount',200000); set('check-count',10);
t('押票 = 1,000,000-200,000×9 = -800,000 → 欄位清空', val('deposit-amount')==='', val('deposit-amount'));
t('  欄位下方大寫為空 (舊版顯示「捌拾萬 元整」)', html('deposit-amount-chinese')==='', html('deposit-amount-chinese'));
t('  底部卡片收起', disp('.deposit-info-card')==='none', disp('.deposit-info-card'));
t('  卡片內大寫為空', html('deposit-amount-display-chinese')==='');
t('  卡片內金額為空', text('deposit-amount-display')==='');
t('  depositAmount 已歸零', ev('depositAmount')===0, String(ev('depositAmount')));

console.log('\n=== 正常路徑（迴歸） ===');
set('check-count',4);
t('押票 = 1,000,000-200,000×3 = 400,000', val('deposit-amount')==='400,000', val('deposit-amount'));
t('  繳款大寫 = 貳拾萬 元整', text('payment-amount-chinese')==='貳拾萬 元整', text('payment-amount-chinese'));
t('  押票大寫 = 肆拾萬 元整', text('deposit-amount-chinese')==='肆拾萬 元整', text('deposit-amount-chinese'));
t('  底部卡片顯示', disp('.deposit-info-card')==='block');
t('  卡片標題正確', text('deposit-amount-display')==='尾款金額：400,000', text('deposit-amount-display'));

console.log('\n=== A3 跨萬位補零（實際欄位驗證） ===');
set('total-amount',3015000); set('payment-amount',1005000); set('check-count',2);
t('繳款 1,005,000 → 壹佰萬零伍仟 元整（舊版：壹佰萬伍仟）',
  text('payment-amount-chinese')==='壹佰萬零伍仟 元整', text('payment-amount-chinese'));
t('押票 2,010,000 → 貳佰零壹萬 元整',
  text('deposit-amount-chinese')==='貳佰零壹萬 元整', text('deposit-amount-chinese'));
t('  大寫數字有套上 chinese-digit 高亮', $('payment-amount-chinese').querySelectorAll('.chinese-digit').length>0);

console.log('\n=== A6 押票大寫殘留 ===');
set('total-amount',1000000); set('payment-amount',200000); set('check-count',4);
t('前置：押票大寫有值', text('deposit-amount-chinese')==='肆拾萬 元整', text('deposit-amount-chinese'));
ev('checkCount=0;calculateDepositAmount();');
t('必要欄位不齊 → 押票欄位清空', val('deposit-amount')==='');
t('  欄位下方大寫一起清掉 (舊版殘留「肆拾萬 元整」)', html('deposit-amount-chinese')==='', html('deposit-amount-chinese'));
t('  提示文字清掉', $('deposit-amount-tip').style.display==='none');

console.log('\n=== A7 結束日期殘留 ===');
ev('checkCount=6;startDate=new Date(2026,6,10);generateCheckList();');
const before=val('end-date');
t('前置：結束日期有值', before.length>0, before);
ev('checkCount=0;generateCheckList();');
t('張數歸零 → 結束日期清空 (舊版殘留「'+before+'」)', val('end-date')==='', val('end-date'));
t('  開票列表清空', html('check-list-content')==='');

console.log('\n=== 迴歸：清除全部輸入 ===');
set('total-amount',1000000); set('payment-amount',200000); set('check-count',4);
ev('startDate=new Date(2026,6,10);generateCheckList();');
ev('clearAllInputs()');
const left=['total-amount','payment-amount','check-count','deposit-amount','start-date','end-date'].filter(id=>val(id)!=='');
t('六個欄位全空', left.length===0, left.join(','));
t('兩個大寫全空', html('payment-amount-chinese')===''&&html('deposit-amount-chinese')==='');
t('卡片收起', disp('.deposit-info-card')==='none');
t('列表清空', html('check-list-content')==='');
t('全域變數歸零', ev('[totalAmount,paymentAmount,checkCount,depositAmount,startDate].every(v=>!v)'));

console.log('\n=== 迴歸：開票日期列表 ===');
set('total-amount',1000000); set('payment-amount',200000); set('check-count',13);
ev('startDate=new Date(2026,10,30);generateCheckList();');
const rows=[...document.querySelectorAll('.check-row')];
const cell=(r,cls)=>r.querySelector('.'+cls).textContent.trim();
t('13 張票產生 13 列', rows.length===13, String(rows.length));
t('  第 1 列 = 115/11/30', cell(rows[0],'col-date').startsWith('115/11/30'), cell(rows[0],'col-date'));
t('  第 4 列 2 月遇月底自動縮到 28 日', cell(rows[3],'col-date').startsWith('116/02/28'), cell(rows[3],'col-date'));
t('  跨年分隔列出現 1 次', document.querySelectorAll('.year-change-row').length===1);
t('  尾款票日期 = 116年11月30日', val('end-date').startsWith('116年11月30日'), val('end-date'));

console.log('\n=== 迴歸：歷史記錄存讀 ===');
// 目前狀態：總額 1,000,000 / 繳款 200,000 / 13 張 → 押票 -1,400,000，屬不成立
ev('saveCheckData()');
t('押票金額不成立時拒絕保存', histList().length===0,
  window.localStorage.getItem('checkHistory'));
set('check-count',4);   // 押票 = 400,000，成立
ev('saveCheckData()');
const hist=histList();
t('金額成立時正常寫入 1 筆', hist.length===1, String(hist.length));
t('  押票金額正確 (400,000)', hist[0]&&hist[0].depositAmount===400000, String(hist[0]&&hist[0].depositAmount));
if($('historyPanel').style.display==='flex') ev('toggleHistoryPanel()');
ev('toggleHistoryPanel()');
t('面板可開啟且看得到該筆', text('historyContent').includes('尾款金額'), text('historyContent').slice(0,80));

console.log('\n=== 全站迴歸：計算頁鍵盤未受影響 ===');
const dom2=new JSDOM(fs.readFileSync(ROOT+'/pages/calculator.html','utf8'),{url:'https://ryanlin02.github.io/my-website/pages/calculator.html',runScripts:'outside-only'});
dom2.window.eval(fs.readFileSync(ROOT+'/js/common-modals.js','utf8'));
dom2.window.eval('initCommonModals()');
const keys2=[...dom2.window.document.querySelectorAll('.calculator-buttons button')].map(b=>b.getAttribute('onclick'));
t('計算頁仍有小數點鍵', keys2.some(k=>k&&k.includes('calculatorDecimal')));
/* 2026/07：最後一列的格位改由 common-modals.js 依「小數點 + 加速鍵」的數量計算，
 * 一律內嵌 grid-column。這裡改為驗證「算出來的 span 仍是 2」——
 * 也就是支票頁的 decimal:false 與加油頁的 00 加速鍵都沒有影響到計算頁。 */
t('計算頁 0 鍵維持 span 2', dom2.window.document.querySelector('.zero-btn').style.gridColumn==='span 2', dom2.window.document.querySelector('.zero-btn').style.gridColumn);
/* 最後一列的格位總和必須正好是 4，否則鍵盤會破格 */
{
  const btns2=[...dom2.window.document.querySelectorAll('.calculator-buttons button')];
  const zi=btns2.findIndex(b=>b.className.includes('zero-btn'));
  const sum=btns2.slice(zi).reduce((a,b)=>{const m=(b.getAttribute('style')||'').match(/span (\d+)/);return a+(m?+m[1]:1);},0);
  t('  計算頁最後一列格位總和 = 4', sum===4, String(sum));
}
t('計算頁鍵數不變 (18)', keys2.length===18, String(keys2.length));

console.log('\n========================================');
console.log('   通過 '+pass+' 項 / 失敗 '+fail+' 項');
console.log('========================================');
process.exit(fail?1:0);
