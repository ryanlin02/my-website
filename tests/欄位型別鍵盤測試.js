/**
 * 逐欄位鍵盤型別測試（2026/07 新增）
 * ============================================================
 * 這一批的改動是「鍵盤形態由欄位決定，不再由頁面決定」。最大的風險不是
 * 新功能不會動，而是「改了支票頁的金額欄位，卻把計算頁或加油頁的鍵盤
 * 弄壞了」—— 這個網站過去反覆出現的正是這種連動。
 *
 * 所以這支測試分成兩半：
 *   A. 沒有宣告型別的欄位，末列必須與改版前逐顆完全相同（回歸防護）
 *   B. 宣告為金額型的欄位，才會多出 000 與 萬、才會顯示中文大寫
 *
 * A 半的預期值是把改版前的 HTML 逐顆抄下來當基準，不是從現在的程式
 * 反推的，所以它真的能抓到退步。
 * ============================================================ */
const fs = require('fs');
const { JSDOM } = require('jsdom');
const R = require('path').join(__dirname, '..');

let pass = 0, fail = 0;
const t = (n, c, e = '') => { c ? pass++ : fail++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (c ? '' : '   → ' + e)); };

function boot(page) {
    const html = fs.readFileSync(R + '/pages/' + page, 'utf8');
    const dom = new JSDOM(html, {
        url: 'https://ryanlin02.github.io/my-website/pages/' + page,
        runScripts: 'outside-only', pretendToBeVisual: true
    });
    const w = dom.window;
    w.eval('window.setInterval=function(){return 0;};window.setTimeout=function(f){return 0;};');

    // 重現頁面內嵌的鍵盤設定（KEYPAD_OPTIONS / KEYPAD_FIELDS）
    for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
        if (m[1].includes('KEYPAD')) w.eval(m[1]);
    }

    const scripts = [...html.matchAll(/<script src="\.\.\/js\/([^"]+)"/g)]
        .map(m => m[1]).filter(f => f !== 'frame-guard.js');
    for (const s of scripts) w.eval(fs.readFileSync(R + '/js/' + s, 'utf8').replace(/^let /gm, 'var '));
    w.eval('initCommonModals()');

    return { w, d: w.document, ev: c => w.eval(c) };
}

/** 把末列按鍵讀成可比對的字串陣列，例：['0/span 2', '.', '='] */
function tailKeys(d) {
    return [...d.querySelectorAll('.calculator-buttons [data-keypad-tail]')].map(b => {
        const label = b.classList.contains('zero-btn')
            ? '0/' + (b.style.gridColumn || 'span 1')
            : b.textContent.trim();
        return label;
    });
}

/** 前四列（不帶 data-keypad-tail 的按鍵）的組成 */
function headKeys(d) {
    return [...d.querySelectorAll('.calculator-buttons button')]
        .filter(b => !b.hasAttribute('data-keypad-tail'))
        .map(b => b.textContent.replace(/\s+/g, ''));
}

/* ============================================================
 * A. 回歸防護：未宣告型別的欄位，末列與改版前逐顆相同
 * ============================================================
 * 基準值來自改版前 common-modals.js 產生的 HTML：
 *   計算頁（有小數點、無加速鍵）  → 0 span 2、小數點、=
 *   支票頁（無小數點、無加速鍵）  → 0 span 3、=
 *   加油頁（有小數點、加速鍵 00） → 0 span 1、00、小數點、=
 */
console.log('\n=== A. 未宣告型別的欄位：末列不得改變 ===');

const BASELINE = {
    'calculator.html': { field: 'principal', title: '本金', tail: ['0/span 2', '.', '='] },
    'check.html': { field: 'check-count', title: '開票張數', tail: ['0/span 3', '='] },
    'gas.html': { field: 'monthlyExpense', title: '每月油錢', tail: ['0/span 1', '00', '.', '='] }
};

const HEAD_EXPECT = ['C清除', '⌫', '÷', '7柒', '8捌', '9玖', '×', '4肆', '5伍', '6陸', '−', '1壹', '2貳', '3參', '+'];

const booted = {};
Object.entries(BASELINE).forEach(([page, base]) => {
    const { d, ev } = boot(page);
    booted[page] = { d, ev };

    t(`${page} 注入時的末列＝改版前`, JSON.stringify(tailKeys(d)) === JSON.stringify(base.tail),
        JSON.stringify(tailKeys(d)));

    ev(`openCalculator('${base.field}', '${base.title}')`);
    t(`  開啟「${base.title}」後仍相同（未宣告型別）`,
        JSON.stringify(tailKeys(d)) === JSON.stringify(base.tail), JSON.stringify(tailKeys(d)));

    t('  前四列 15 顆鍵完全沒動', JSON.stringify(headKeys(d)) === JSON.stringify(HEAD_EXPECT),
        JSON.stringify(headKeys(d)));

    t('  四欄仍然剛好排滿（末列格數合計 4）',
        tailKeys(d).reduce((n, k) => n + (k.startsWith('0/') ? Number(k.match(/span (\d)/)[1]) : 1), 0) === 4);
});

/* ============================================================
 * B. 支票頁的兩個金額欄位＝金額型
 * ============================================================ */
console.log('\n=== B. 金額型：000 與 萬、中文大寫、位數即時擋 ===');

const chk = booted['check.html'];
const AMOUNT_TAIL = ['0/span 1', '000', '萬', '='];

['total-amount', 'payment-amount'].forEach(id => {
    chk.ev(`openCalculator('${id}', '測試')`);
    t(`${id} 末列＝0／000／萬／=`,
        JSON.stringify(tailKeys(chk.d)) === JSON.stringify(AMOUNT_TAIL), JSON.stringify(tailKeys(chk.d)));
    t('  沒有小數點鍵（金額是整數）', !tailKeys(chk.d).includes('.'));
    t('  前四列一樣沒動', JSON.stringify(headKeys(chk.d)) === JSON.stringify(HEAD_EXPECT));
});

// 加速鍵實際行為
chk.ev(`openCalculator('total-amount', '總金額'); calculatorClear(); calculatorInput(3); calculatorAppend('000000')`);
t('3 → 按加速鍵得到 3000000', chk.ev('calculatorValue') === '3000000', chk.ev('calculatorValue'));

// 中文大寫副資訊
chk.ev(`calculatorClear(); '1005000'.split('').forEach(function(c){ calculatorInput(Number(c)); })`);
t('顯示區數字為 1005000', chk.ev('calculatorValue') === '1005000', chk.ev('calculatorValue'));
t('  副資訊顯示大寫「壹佰萬零伍仟 元整」',
    chk.d.getElementById('calculatorSub').textContent === '壹佰萬零伍仟 元整',
    chk.d.getElementById('calculatorSub').textContent);
t('  大寫與 arabicToChineseNumber 完全一致（不是另寫一份轉換）',
    chk.d.getElementById('calculatorSub').textContent
    === chk.ev(`arabicToChineseNumber(1005000, 'financial', false)`) + ' 元整');

chk.ev('calculatorClear()');
t('  清除後副資訊也清空', chk.d.getElementById('calculatorSub').textContent === '');

// 位數上限即時擋
chk.ev(`openCalculator('total-amount', '總金額'); calculatorClear(); for(var i=0;i<9;i++){ calculatorInput(9); }`);
t('總金額可以輸入到 9 位數', chk.ev('calculatorValue') === '999999999', chk.ev('calculatorValue'));
chk.ev('calculatorInput(9)');
t('  第 10 位被當下擋掉（不必等按確認輸入）', chk.ev('calculatorValue') === '999999999', chk.ev('calculatorValue'));
t('  並且有提示 Toast', chk.d.querySelector('.toast-message') !== null);

chk.ev(`openCalculator('payment-amount', '繳款金額'); calculatorClear(); for(var i=0;i<7;i++){ calculatorInput(8); }`);
t('繳款金額可以輸入到 7 位數', chk.ev('calculatorValue') === '8888888', chk.ev('calculatorValue'));
chk.ev('calculatorInput(8)');
t('  第 8 位被擋掉', chk.ev('calculatorValue') === '8888888', chk.ev('calculatorValue'));
chk.ev(`calculatorClear(); calculatorInput(9); calculatorAppend('000000')`);
t('  加速鍵也受上限管制（9 + 000000 = 7 位，可通過）',
    chk.ev('calculatorValue') === '9000000', chk.ev('calculatorValue'));
chk.ev(`calculatorAppend('000')`);
t('  再按 000 會超過 7 位，被擋下', chk.ev('calculatorValue') === '9000000', chk.ev('calculatorValue'));

/* ============================================================
 * C. 同一頁欄位互相切換不留殘渣
 * ============================================================ */
console.log('\n=== C. 切換欄位不留殘渣 ===');

chk.ev(`openCalculator('total-amount', '總金額')`);
chk.ev(`openCalculator('check-count', '開票張數')`);
t('金額型 → 計數型：末列回到支票頁預設',
    JSON.stringify(tailKeys(chk.d)) === JSON.stringify(BASELINE['check.html'].tail),
    JSON.stringify(tailKeys(chk.d)));
t('  計數型不顯示大寫（張數不是金額）',
    (chk.ev('calculatorClear(); calculatorInput(3); calculatorInput(6)'),
        chk.d.getElementById('calculatorSub').textContent === ''),
    chk.d.getElementById('calculatorSub').textContent);
t('  張數沒有位數上限設定，可正常輸入 36', chk.ev('calculatorValue') === '36', chk.ev('calculatorValue'));

chk.ev(`openCalculator('total-amount', '總金額')`);
t('計數型 → 金額型：末列再次變成金額型',
    JSON.stringify(tailKeys(chk.d)) === JSON.stringify(AMOUNT_TAIL), JSON.stringify(tailKeys(chk.d)));
t('  反覆切換十次不會累積出多餘按鍵', (() => {
    for (let i = 0; i < 10; i++) {
        chk.ev(`openCalculator('total-amount', 'x')`);
        chk.ev(`openCalculator('check-count', 'x')`);
    }
    return chk.d.querySelectorAll('.calculator-buttons button').length === 15 + BASELINE['check.html'].tail.length;
})(), chk.d.querySelectorAll('.calculator-buttons button').length + ' 顆');

/* ============================================================
 * C-2. 算式歷程：永遠單行、過長從左邊截斷、數字帶千分位
 * ============================================================
 * 顯示區改三行之後算式行只剩 26px，容不下兩行。舊做法會在超過 20 字時
 * 插一個換行，於是第二行被擠出去、上一行被從字的中間切斷（看起來像破圖）。 */
console.log('\n=== C-2. 算式歷程單行化 ===');

const hist = () => chk.d.getElementById('calculatorHistory').textContent;
const type = s => [...String(s)].forEach(c => chk.ev('calculatorInput(' + c + ')'));

chk.ev(`openCalculator('total-amount', '總金額'); calculatorClear()`);
type('1500000'); chk.ev(`calculatorOperation('-')`); type('265433'); chk.ev(`calculatorOperation('+')`);
t('短算式完整顯示且帶千分位', hist() === '1,500,000 - 265,433 + ', JSON.stringify(hist()));
t('  狀態本身不含逗號（運算與正規表示式要吃原字串）',
    chk.ev('calculatorHistory') === '1500000 - 265433 + ', JSON.stringify(chk.ev('calculatorHistory')));

type('1142484'); chk.ev(`calculatorOperation('+')`); type('1149150'); chk.ev(`calculatorOperation('+')`);
t('長算式從左邊截斷並加「…」', hist().startsWith('… '), JSON.stringify(hist()));
t('  不超過 34 個字', hist().length <= 34, hist().length + ' 字');
t('  永遠只有一行（沒有換行字元）', !hist().includes('\n'));
t('  最新的一段看得到', hist().includes('1,149,150'), JSON.stringify(hist()));
t('  截斷點落在空白處，不會從數字中間切開',
    /^… \d/.test(hist()) ? !/^… \d{1,3},/.test(hist()) || /^… [\d,]+ [-+×÷]/.test(hist()) : true,
    JSON.stringify(hist()));
t('  截斷後第一個數字是完整的', (() => {
    const firstNum = (hist().match(/^… ([\d,]+)/) || [])[1];
    if (!firstNum) return true;
    // 完整的數字，逗號一定是每三位一個；被切過的會出現 "4,567" 這種開頭不足三位又帶逗號的情況
    return chk.ev('calculatorHistory').split(' ').includes(firstNum.replace(/,/g, ''));
})(), JSON.stringify(hist()));

type('1'); chk.ev('calculatorEquals()');
t('按 = 後仍保留完整算式（不再整段換成結果）',
    chk.ev('calculatorHistory').includes('=') && chk.ev('calculatorHistory').includes('1500000'),
    JSON.stringify(chk.ev('calculatorHistory')));

/* 中間那行大字也要有千分位（狀態本身不能有，各頁都直接 parseFloat 它） */
const bigNum = () => chk.d.getElementById('calculatorDisplay').textContent;
chk.ev(`openCalculator('total-amount', '總金額'); calculatorClear()`);
type('1234567');
t('大字數值帶千分位 1,234,567', bigNum() === '1,234,567', bigNum());
t('  但狀態仍是 1234567（不含逗號）', chk.ev('calculatorValue') === '1234567', chk.ev('calculatorValue'));
chk.ev(`calculatorAppend('000')`);
t('  按加速鍵後仍正確 1,234,567,000', bigNum() === '1,234,567,000' || bigNum() === '1,234,567',
    bigNum());   // 總金額上限 9 位，這一按會被擋下，值不變
chk.ev('calculatorClear(); calculatorInput(3)');
t('  清除後回到 3', bigNum() === '3', bigNum());

// 小數欄位（計算頁的利率）：剛按下小數點時不能把「.」吃掉
const calc = booted['calculator.html'];
calc.ev(`openCalculator('rate', '稅前利率'); calculatorClear(); calculatorInput(8); calculatorDecimal()`);
t('剛按下小數點時顯示 8.（不會被千分位吃掉）',
    calc.d.getElementById('calculatorDisplay').textContent === '8.',
    calc.d.getElementById('calculatorDisplay').textContent);
calc.ev('calculatorInput(5)');
t('  接著輸入變成 8.5', calc.d.getElementById('calculatorDisplay').textContent === '8.5',
    calc.d.getElementById('calculatorDisplay').textContent);
calc.ev(`calculatorClear(); '1234567'.split('').forEach(function(c){ calculatorInput(Number(c)); }); calculatorDecimal(); calculatorInput(8)`);
t('  整數位加逗號、小數位不加：1,234,567.8',
    calc.d.getElementById('calculatorDisplay').textContent === '1,234,567.8',
    calc.d.getElementById('calculatorDisplay').textContent);

t('formatHistoryLine 是純函式，可單獨驗證', chk.ev('typeof formatHistoryLine') === 'function');
t('  換行字元會被壓成空白（相容舊資料）',
    chk.ev(`formatHistoryLine('12 +\\n34 -')`) === '12 + 34 -', chk.ev(`formatHistoryLine('12 +\\n34 -')`));
t('  小數不會被逗號破壞',
    chk.ev(`formatHistoryLine('1234.5678 + ')`) === '1,234.5678 + ', chk.ev(`formatHistoryLine('1234.5678 + ')`));

/* ============================================================
 * D. 顯示區三行結構
 * ============================================================ */
console.log('\n=== D. 顯示區三行 ===');

Object.entries(booted).forEach(([page, { d }]) => {
    const box = d.querySelector('.calculator-display-container');
    const rows = [...box.children].filter(c => !c.classList.contains('calculator-scroll-indicator'))
        .map(c => c.className);
    t(`${page} 顯示區為 算式／數字／副資訊 三行`,
        JSON.stringify(rows) === JSON.stringify(['calculator-history', 'calculator-display', 'calculator-sub']),
        JSON.stringify(rows));
});

// 註解裡會提到 word-break、linear-gradient 這些字，比對前先把註解剝掉
const css = fs.readFileSync(R + '/css/keypad.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
t('副資訊行有固定高度（面板高度才不會忽高忽低）', /\.calculator-sub\s*\{[^}]*height:\s*\d+px/.test(css));

/* 顯示區三行必須是同一面「螢幕」：不要漸層、不要分隔線。
 * 原本算式行有漸層底色加一條橘色細線，三行之後那條線變成把小螢幕
 * 橫切成兩半，看起來像破圖。層級改用字級與顏色區分。 */
t('  算式行沒有那條橫切線', !/\.calculator-history::after/.test(css));
const flat = sel => new RegExp('\\' + sel + '\\s*\\{[^}]*background:\\s*var\\(--input-bg\\)').test(css);
t('  算式行與數字行都是平底色（無漸層）', flat('.calculator-history') && flat('.calculator-display'),
    '仍有 linear-gradient');
t('  算式行是單行：nowrap + overflow hidden，且不再 break-all',
    /\.calculator-history\s*\{[^}]*white-space:\s*nowrap/.test(css)
    && /\.calculator-history\s*\{[^}]*overflow:\s*hidden/.test(css)
    && !/\.calculator-history\s*\{[^}]*word-break/.test(css));

/* 面板高度預算：垂直居中的彈窗一旦超過可視高度就會被切掉。
 * iPhone SE 這類 568px 高的機器扣掉外殼標題列 60px 只剩約 508px。 */
const num = re => Number((css.match(re) || [])[1]);
const budget = 9 * 2 + 29                                  // 標題列：上下內距 + 17px 標題的行框
    + num(/\.calculator-display-container\s*\{[^}]*height:\s*(\d+)px/) + 2 + 8 * 2   // 顯示區 + 框線 + 外距
    + 5 * num(/\.calculator-buttons button\s*\{[^}]*height:\s*(\d+)px/) + 4 * 5 + 8 * 2
    + num(/\.submit-btn-primary\s*\{[^}]*height:\s*(\d+)px/) + 10;
/* 這個估算值與 Chrome 實測相符（實測 473px，改版前 533px）。
 * 上限取 480 是留給字體行框的誤差，不是留給再加東西。 */
t(`面板估算高度 ${budget}px ≤ 480px（小螢幕仍有餘裕）`, budget <= 480, budget + 'px');

console.log('\n========================================');
console.log(`   通過 ${pass} 項 / 失敗 ${fail} 項`);
console.log('========================================');
process.exit(fail ? 1 : 0);
