/** 產生三種情境的擬真發票 SVG，用來目視比對真實發票版面 */
const fs=require('fs'),path=require('path');
const src=fs.readFileSync(path.join(__dirname,'../../js/invoice-new-engine.js'),'utf8');
const pick=(n)=>{const i=src.indexOf('function '+n);if(i<0)throw new Error('缺 '+n);
  let d=0;for(let k=src.indexOf('{',i);k<src.length;k++){if(src[k]==='{')d++;if(src[k]==='}'){d--;if(d===0)return src.slice(i,k+1);}}};
const head=`
const UP_DIGITS=['零','壹','貳','參','肆','伍','陸','柒','捌','玖'];
const UP_UNITS=['億','仟','佰','拾','萬','仟','佰','拾','元'];
const CN_NUM=['〇','一','二','三','四','五','六','七','八','九'];
const CN_MONTH=['','一','二','三','四','五','六','七','八','九','十','十一','十二'];
const TAX_RATE=0.05, MAX_ITEMS=5, MAX_AMOUNT=999999999;
const INK='#123fc8',PRT='#111111',PRE='#8a8a8a',STAMP_BG='#eaf1ff',STAMP_FG='#4a7fd4';
const NAT_W_3=820,NAT_H_3=515,NAT_W_2=700,NAT_H_2=432;
let state={type:'3',taxId:'',title:'',date:null,items:[],lockTotal:null};`;
const fns=['fmt','esc','todayROC','curDate','rocYearCN','periodCN','upperSlots','calc',
  'fitSize','svgText','svgLine','svgRect','hotspot','stampArea','upperRow','voidSlash',
  'buildSvg3','buildSvg2'].map(pick).join('\n');
const m=new Function(head+fns+`return {set:o=>Object.assign(state,o),s3:buildSvg3,s2:buildSvg2,calc};`)();

const D={y:115,m:7,d:26};
const out=(n,svg)=>fs.writeFileSync(path.join(__dirname,n),svg);

m.set({type:'3',date:D,taxId:'27868497',title:'諸羅山育樂有限公司',
  items:[{name:'車輛買賣價金',qty:55,price:24530}],lockTotal:null});
out('inv3.svg',m.s3()); console.log('三聯式單品項:',JSON.stringify(m.calc()));

m.set({type:'3',date:D,taxId:'04541302',
  title:'鴻海精密工業股份有限公司台北分公司營業處',
  items:[{name:'租賃價款(KEA-1234)第一期',qty:1,price:2000000},
         {name:'車輛買賣價金(BRR-8888)',qty:12,price:123456},
         {name:'手續費',qty:1,price:8000},
         {name:'保險費',qty:1,price:45000},
         {name:'代辦過戶規費',qty:3,price:2500}],lockTotal:null});
out('inv3max.svg',m.s3()); console.log('三聯式滿版:',JSON.stringify(m.calc()));

m.set({type:'2',date:D,taxId:'',title:'王小明',
  items:[{name:'分期價款',qty:12,price:35000}],lockTotal:null});
out('inv2.svg',m.s2()); console.log('二聯式:',JSON.stringify(m.calc()));
