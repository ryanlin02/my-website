/**
 * 共用鍵盤 — 運算正確性測試（40,000 組隨機算式）
 * ============================================================
 * 這支測試取代了原本的「鍵盤行為對照測試.js」。
 *
 * 【為什麼要換】
 * 原本那支的用途是：把「改版前的計算頁鍵盤」「改版前的支票頁鍵盤」
 * 與「改版後的共用模組」放進三個獨立沙箱，用 4 萬組隨機操作序列
 * 比對狀態機是否完全一致 —— 它守的是「重構沒有改變行為」。
 *
 * 2026/07 我們刻意改變了行為：共用鍵盤原本沒有運算優先順序，
 * 打 1000+2000×3 會算成 (1000+2000)×3 = 9000（正確答案是 7000）。
 * 那不會報錯，只會安靜給出錯誤金額，而這台鍵盤負責輸入的是
 * 貸款本金與支票金額。
 *
 * 既然基準線本身是錯的，「與舊版一致」就不再是我們要的性質。
 * 所以改成比對「數學上正確的答案」：同樣 4 萬組隨機算式，
 * 但期望值由測試自己獨立算出來，而不是抄舊實作。
 *
 * 這比原本的測試更強 —— 它驗證的是正確性，不只是「沒變」。
 *
 * 需要先安裝 jsdom：npm install jsdom
 * 執行：node tests/鍵盤運算正確性測試.js
 * ============================================================
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const R = path.join(__dirname, '..');

const dom = new JSDOM(
    '<div id="calculatorDisplay"></div><div id="calculatorHistory"></div><div id="historyScrollIndicator"></div>',
    { runScripts: 'outside-only' }
);
const w = dom.window;
const ev = c => w.eval(c);
ev('window.setTimeout=function(){return 0;};');
// let / const 在 indirect eval 下不會留在全域，換成 var 才能跨呼叫存取
ev(fs.readFileSync(path.join(R, 'js/common-keypad.js'), 'utf8')
    .replace(/^let /gm, 'var ')
    .replace(/^const /gm, 'var '));

let pass = 0, fail = 0;
const t = (n, c, e = '') => {
    c ? pass++ : fail++;
    console.log((c ? '  PASS  ' : '  FAIL  ') + n + (c ? '' : '   → ' + e));
};

/* ------------------------------------------------------------
 * 期望值：由測試獨立計算，不依賴被測程式
 *
 * 刻意用「兩輪掃描」而不是 eval：先收乘除再收加減。
 * 寫法與被測程式不同（它是原地 reduce，這裡是重建陣列），
 * 兩邊各自出錯的話結果會對不上。
 * ------------------------------------------------------------ */
function expected(tokens) {
    const pass1 = [];
    for (let i = 0; i < tokens.length; i++) {
        const tk = tokens[i];
        if (tk === '*' || tk === '/') {
            const rhs = tokens[++i];
            if (tk === '/' && rhs === 0) return null;
            pass1[pass1.length - 1] = tk === '*'
                ? pass1[pass1.length - 1] * rhs
                : pass1[pass1.length - 1] / rhs;
        } else {
            pass1.push(tk);
        }
    }
    let acc = pass1[0];
    for (let i = 1; i < pass1.length; i += 2) {
        acc = pass1[i] === '+' ? acc + pass1[i + 1] : acc - pass1[i + 1];
    }
    return acc;
}

/** 把 token 序列輸入鍵盤，回傳鍵盤算出的字串 */
function viaKeypad(tokens) {
    ev('calculatorClear()');
    for (const tk of tokens) {
        if (typeof tk === 'number') {
            for (const ch of String(tk)) {
                if (ch === '.') ev('calculatorDecimal()');
                else ev(`calculatorInput(${ch})`);
            }
        } else {
            ev(`calculatorOperation(${JSON.stringify(tk)})`);
        }
    }
    ev('calculatorEquals()');
    return ev('calculatorValue');
}

console.log('\n=== 1. 業務實際會遇到的算式 ===');
const realCases = [
    [[1000, '+', 2000, '*', 3], 7000, '1000+2000×3（先乘後加）'],
    [[2000, '*', 30], 60000, '每天 2000 × 30 天'],
    [[10000, '*', 3, '+', 5000], 35000, '每次一萬打三次再加五千'],
    [[300000, '/', 28.8], 10416.66666667, '每月油錢 ÷ 單價'],
    [[100, '-', 200], -100, '負數結果（支票頁舊漏洞複驗）'],
    [[28.8, '-', 0.5], 28.3, '單價減折扣'],
    [[1000000, '+', 500000], 1500000, '百萬級加法'],
    [[10, '-', 2, '*', 3], 4, '10-2×3（減法也要讓乘法先算）'],
];
for (const [tokens, exp, name] of realCases) {
    const got = parseFloat(viaKeypad(tokens));
    t(name, Math.abs(got - exp) < 1e-6, `得到 ${got}，預期 ${exp}`);
}

console.log('\n=== 2. 顯示區的中間結果 ===');
// 按下運算子時，只能顯示「該運算子允許先算」的部分
const midCases = [
    [[1, '+', 2, '+'], '3', '1+2+ 立刻顯示 3'],
    [[2, '*', 3, '*'], '6', '2×3× 立刻顯示 6'],
    [[1, '+', 2, '*'], '2', '1+2× 維持 2（不可先算，否則變成 (1+2)×）'],
    [[1, '+', 2, '*', 3, '+'], '7', '1+2×3+ 顯示 7'],
    [[9, '/', 3, '-'], '3', '9÷3− 顯示 3'],
];
for (const [tokens, exp, name] of midCases) {
    ev('calculatorClear()');
    for (const tk of tokens) {
        if (typeof tk === 'number') ev(`calculatorInput(${tk})`);
        else ev(`calculatorOperation(${JSON.stringify(tk)})`);
    }
    t(name, ev('calculatorValue') === exp, ev('calculatorValue'));
}

console.log('\n=== 3. 邊界與防呆 ===');
ev('calculatorClear(); calculatorInput(1); calculatorOperation("/"); calculatorInput(0); calculatorEquals();');
t('除以零會被擋下並歸零', ev('calculatorValue') === '0', ev('calculatorValue'));
ev('calculatorClear(); calculatorInput(5); calculatorEquals();');
t('沒有運算子時按 = 不動作', ev('calculatorValue') === '5', ev('calculatorValue'));
ev('calculatorClear(); calculatorInput(1); calculatorOperation("+"); calculatorOperation("*"); calculatorInput(2); calculatorEquals();');
t('連按運算子只換掉最後一個（1+×2 = 2）', ev('calculatorValue') === '2', ev('calculatorValue'));
ev('calculatorClear(); calculatorInput(2); calculatorOperation("+"); calculatorInput(3); calculatorEquals(); calculatorOperation("*"); calculatorInput(4); calculatorEquals();');
t('算完可接著運算（(2+3)×4 = 20）', ev('calculatorValue') === '20', ev('calculatorValue'));
ev('calculatorClear(); calculatorInput(1); calculatorDecimal(); calculatorInput(5); calculatorOperation("*"); calculatorInput(2); calculatorEquals();');
t('小數參與運算（1.5×2 = 3）', ev('calculatorValue') === '3', ev('calculatorValue'));
ev('calculatorClear(); calculatorInput(0); calculatorDecimal(); calculatorInput(1); calculatorOperation("+"); calculatorInput(0); calculatorDecimal(); calculatorInput(2); calculatorEquals();');
t('浮點尾數已修整（0.1+0.2 = 0.3 而非 0.30000000000000004）',
    ev('calculatorValue') === '0.3', ev('calculatorValue'));
ev('calculatorClear(); calculatorInput(1); calculatorOperation("+"); calculatorInput(2);');
t('算式歷程有記錄', ev('calculatorHistory').length > 0, ev('calculatorHistory'));

console.log('\n=== 4. 隨機算式 40,000 組 ===');
const OPS = ['+', '-', '*', '/'];
let mismatch = 0, checked = 0;
const samples = [];

for (let seq = 0; seq < 40000; seq++) {
    // 1～5 個運算元，值域刻意含小數與 0（0 用來觸發除以零）
    const n = 1 + Math.floor(Math.random() * 5);
    const tokens = [];
    for (let k = 0; k < n; k++) {
        if (k > 0) tokens.push(OPS[Math.floor(Math.random() * OPS.length)]);
        const r = Math.random();
        tokens.push(r < 0.1 ? 0
            : r < 0.3 ? Math.floor(Math.random() * 10)
                : Math.floor(Math.random() * 100000));
    }

    const exp = expected(tokens);
    if (exp === null) continue;                       // 除以零另有測試涵蓋
    if (!isFinite(exp) || Math.abs(exp) > 1e12) continue;

    const got = parseFloat(viaKeypad(tokens));
    checked++;

    // 允許浮點誤差；被測程式會做 toFixed(8) 修整
    const tol = Math.max(1e-6, Math.abs(exp) * 1e-9);
    if (!(Math.abs(got - exp) <= tol)) {
        mismatch++;
        if (samples.length < 3) {
            samples.push('   ' + tokens.join(' ') + '\n     鍵盤 ' + got + '\n     正確 ' + exp);
        }
    }
}

console.log(`  實際比對 ${checked.toLocaleString()} 組算式`);
t(`隨機算式全部與正確答案一致`, mismatch === 0, `${mismatch} 組不一致\n` + samples.join('\n'));

console.log('\n========================================');
console.log(`   通過 ${pass} 項 / 失敗 ${fail} 項`);
console.log('========================================');
process.exit(fail ? 1 : 0);
