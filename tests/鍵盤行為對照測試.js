const fs=require('fs');
const {JSDOM}=require('jsdom');
// 改版前的原版取自 tests/fixtures/（凍結的基準線，不依賴 git 歷史）
const orig=n=>fs.readFileSync(require('path').join(__dirname,'fixtures',n.replace('.js','.改版前.js')),'utf8');

// 建立三個獨立沙箱：改動前的計算頁、改動前的支票頁、改動後的共用模組
function sandbox(src){
  const dom=new JSDOM('<div id="calculatorDisplay"></div><div id="calculatorHistory"></div><div id="historyScrollIndicator"></div><body></body>',{runScripts:'outside-only'});
  const w=dom.window;
  w.eval('window.setTimeout=function(){return 0;};');
  // 只取鍵盤狀態機相關的宣告與函式
  w.eval(src.replace(/^let /gm,'var '));
  return c=>w.eval(c);
}
const pick=(src,names)=>{
  let out='var currentInputField=null,calculatorValue="0",calculatorOperator=null,calculatorFirstValue=null,calculatorWaitingForSecondValue=false,calculatorHistory="";\n';
  out+='function vibrate(){}\nfunction showToast(){}\n';
  for(const n of names){
    const m=src.match(new RegExp('^function '+n+'\\s*\\([\\s\\S]*?\\n}','m'));
    if(m && !['vibrate','showToast'].includes(n)) out+=m[0]+'\n';
  }
  return out;
};
const FNS=['calculatorInput','calculatorDecimal','calculatorClear','calculatorBackspace','calculatorOperation','calculatorEquals','updateCalculatorHistory'];
const A=sandbox(pick(orig('calc-ui.js'),FNS));                        // 改動前：計算頁
const B=sandbox(pick(orig('check-engine.js'),FNS));                   // 改動前：支票頁
const N=sandbox(pick(fs.readFileSync('js/common-keypad.js','utf8'),FNS)); // 改動後：共用模組

const snap='JSON.stringify([calculatorValue,calculatorOperator,calculatorFirstValue,calculatorWaitingForSecondValue,calculatorHistory])';
const ops=[];
for(let i=0;i<=9;i++) ops.push(`calculatorInput(${i})`);
for(const o of ['+','-','*','/']) ops.push(`calculatorOperation(${JSON.stringify(o)})`);
ops.push('calculatorEquals()','calculatorBackspace()','calculatorClear()','calculatorDecimal()');

let n=0, mismatchA=0, mismatchB=0, samples=[];
for(let seq=0; seq<40000; seq++){
  A('calculatorClear()'); B('calculatorClear()'); N('calculatorClear()');
  const trace=[];
  const len=1+Math.floor(Math.random()*14);
  for(let k=0;k<len;k++){
    const op=ops[Math.floor(Math.random()*ops.length)];
    trace.push(op);
    // 支票頁原版沒有 calculatorDecimal，該操作只比對計算頁
    const hasDec=op.startsWith('calculatorDecimal');
    A(op); N(op); if(!hasDec) B(op);
    n++;
    const sa=A(snap), sn=N(snap);
    if(sa!==sn){ mismatchA++; if(samples.length<3) samples.push('計算頁 '+trace.join(' → ')+'\n   舊 '+sa+'\n   新 '+sn); break; }
    if(!trace.some(x=>x.startsWith('calculatorDecimal'))){
      const sb=B(snap);
      if(sb!==sn){ mismatchB++; if(samples.length<3) samples.push('支票頁 '+trace.join(' → ')+'\n   舊 '+sb+'\n   新 '+sn); break; }
    }
  }
}
console.log('隨機操作序列 40,000 組，累計 '+n.toLocaleString()+' 次按鍵');
console.log('  與「改動前計算頁」狀態不一致: '+mismatchA);
console.log('  與「改動前支票頁」狀態不一致: '+mismatchB);
if(samples.length) console.log('範例:\n'+samples.join('\n'));
else console.log('\n✓ 鍵盤狀態機行為與改動前完全一致');
