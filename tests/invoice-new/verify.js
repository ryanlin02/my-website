/**
 * 發票新版 - 純函式驗算
 * 直接從 invoice-new-engine.js 抽出不碰 DOM 的函式來跑，
 * 避免測試檔和實作各寫一份而漸漸不同步。
 */
const fs=require('fs'),path=require('path');
const ENGINE=path.join(__dirname,'../../js/invoice-new-engine.js');
const src=fs.readFileSync(ENGINE,'utf8');
const pick=(n)=>{const i=src.indexOf('function '+n);if(i<0)throw new Error('找不到 '+n);
  let d=0;for(let k=src.indexOf('{',i);k<src.length;k++){if(src[k]==='{')d++;if(src[k]==='}'){d--;if(d===0)return src.slice(i,k+1);}}};

const mod=new Function(`
const UP_DIGITS=['零','壹','貳','參','肆','伍','陸','柒','捌','玖'];
const UP_UNITS=['億','仟','佰','拾','萬','仟','佰','拾','元'];
const TAX_RATE=0.05, MAX_AMOUNT=999999999;
const CN_NUM=['〇','一','二','三','四','五','六','七','八','九'];
const CN_MONTH=['','一','二','三','四','五','六','七','八','九','十','十一','十二'];
let state={type:'3',items:[],lockTotal:null};
${pick('upperSlots')}
${pick('validateTaxId')}
${pick('calc')}
${pick('rocYearCN')}
${pick('periodCN')}
return {upperSlots,validateTaxId,calc,periodCN,setState:o=>Object.assign(state,o)};`)();

const {upperSlots,validateTaxId,calc,periodCN,setState}=mod;
let pass=0,fail=0;
const eq=(a,b,l)=>{ if(a===b)pass++; else {fail++;console.log('  FAIL',l,'got',JSON.stringify(a),'want',JSON.stringify(b));} };

// 把格位攤成人看得懂的字串：劃掉的格子用 － 表示
const flat=n=>upperSlots(n).map(s=>(s.digit===null?'－':s.digit)+s.unit).join(' ');
// 只取實際要寫的部分
const written=n=>upperSlots(n).filter(s=>s.digit!==null).map(s=>s.digit+s.unit).join('');

console.log('=== 1. 格位式大寫：九格永遠都在，用不到的高位劃掉 ===');
[[0,       '－億 －仟 －佰 －拾 －萬 －仟 －佰 －拾 －元'],
 [8,       '－億 －仟 －佰 －拾 －萬 －仟 －佰 －拾 捌元'],
 [20,      '－億 －仟 －佰 －拾 －萬 －仟 －佰 貳拾 零元'],
 [20000,   '－億 －仟 －佰 －拾 貳萬 零仟 零佰 零拾 零元'],
 [1416608, '－億 －仟 壹佰 肆拾 壹萬 陸仟 陸佰 零拾 捌元'],
 [1050000, '－億 －仟 壹佰 零拾 伍萬 零仟 零佰 零拾 零元'],
 [999999999,'玖億 玖仟 玖佰 玖拾 玖萬 玖仟 玖佰 玖拾 玖元']
].forEach(([n,w])=>eq(flat(n),w,n));

console.log('=== 2. 每格數量固定 9，位數對齊不能跑掉 ===');
[0,1,99,1000,1416608,999999999].forEach(n=>eq(upperSlots(n).length,9,'格數 '+n));
// 用不到的格數 = 9 - 位數
[[8,8],[20,7],[20000,4],[1416608,2],[999999999,0]].forEach(([n,off])=>
  eq(upperSlots(n).filter(s=>s.digit===null).length,off,'劃掉格數 '+n));

console.log('=== 3. 與一般大寫寫法的差異（這是最容易抄錯的地方）===');
eq(written(1416608),'壹佰肆拾壹萬陸仟陸佰零拾捌元','1416608 含「零拾」不可省略');
eq(written(20000),'貳萬零仟零佰零拾零元','20000 後面四格都要寫零');

console.log('=== 4. 統一編號檢查碼（真實統編取自經濟部商業司開放資料）===');
[['22099131',true,'台積電'],['96979933',true,'中華電信'],['04541302',true,'鴻海精密'],
 ['12345675',true,'第7碼為7的特例'],['28497389',false,'亂打'],['12345678',false,'亂打'],
 ['1234567',false,'長度不足'],['123456789',false,'長度過長'],['abcdefgh',false,'非數字']
].forEach(([id,w,l])=>eq(validateTaxId(id),w,l+' '+id));

console.log('=== 5. 三聯式：單價未稅，另計 5% ===');
setState({type:'3',lockTotal:null,items:[{qty:1,price:1000000}]});
let r=calc(); eq(r.sales,1000000,'銷售額'); eq(r.tax,50000,'稅額'); eq(r.total,1050000,'總計');
setState({items:[{qty:2,price:300000},{qty:1,price:400000}]});
r=calc(); eq(r.sales,1000000,'多品項銷售額'); eq(r.total,1050000,'多品項總計');

console.log('=== 6. 二聯式：單價含稅，銷售額與稅額為倒推 ===');
setState({type:'2',lockTotal:null,items:[{qty:1,price:1050000}]});
r=calc(); eq(r.total,1050000,'總計'); eq(r.sales,1000000,'倒推銷售額'); eq(r.tax,50000,'倒推稅額');

console.log('=== 7. 反推（lockTotal）：銷售額＋稅額 是否恆等於指定總計 ===');
/**
 * 注意取樣方式：純正算對不上的總額有固定週期（每 21 元一次，
 * 落在 total ≡ 10 (mod 21)）。第一版測試用 step=7 掃描，
 * 週期剛好整除，一個失敗案例都沒抽到、誤判為全數通過。
 * 這裡改成逐一掃描，確保週期性的破口一定被涵蓋。
 */
let bad=0,absorbed=0,checked=0;
for(let total=1;total<=300000;total++){
  const sales=Math.round(total/1.05), fwd=Math.round(sales*0.05);
  setState({type:'3',lockTotal:total,items:[{qty:1,price:sales}]});
  const x=calc(); checked++;
  if(x.sales+x.tax!==x.total||x.total!==total) bad++;
  if(x.tax!==fwd) absorbed++;
}
console.log(`  逐一掃描 ${checked} 個金額：對不上 ${bad} 個；其中 ${absorbed} 個（${(absorbed/checked*100).toFixed(1)}%）由稅額吸收 1 元進位差`);
eq(bad,0,'反推後 銷售額＋稅額＝總計 必須恆成立');
if(absorbed===0){fail++;console.log('  FAIL 取樣沒涵蓋到任何進位差案例，測試本身無效');}else pass++;

console.log('=== 8. lockTotal 失效保護：明細被改動後不得沿用舊總計 ===');
setState({type:'3',lockTotal:1050000,items:[{qty:1,price:2000000}]});
r=calc(); eq(r.total,2100000,'差距過大時回到正算'); eq(r.tax,100000,'稅額回到正算');

console.log('=== 9. 發票本期別（雙月一期，印在發票上）===');
[[{y:115,m:7,d:26},'一一五年　七、八月份'],
 [{y:115,m:8,d:1}, '一一五年　七、八月份'],
 [{y:115,m:1,d:5}, '一一五年　一、二月份'],
 [{y:115,m:12,d:31},'一一五年　十一、十二月份']
].forEach(([d,w])=>eq(periodCN(d),w,`${d.y}/${d.m}`));

console.log('');
console.log(fail===0?`✓ 全部通過（${pass} 項）`:`✗ 通過 ${pass}／失敗 ${fail}`);
process.exit(fail?1:0);
