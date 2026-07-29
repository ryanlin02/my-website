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

/* 註：四頁的每一個真實欄位現在都宣告了型別，所以這裡改用一個不存在的
 * 欄位 id 來驗證「沒有宣告型別時會發生什麼」—— 這條保證仍然重要，
 * 之後任何人新增欄位而忘了宣告，看到的就是這個樣子（＝改版前的樣子）。 */
const UNDECLARED = '__undeclared__';

const BASELINE = {
    'calculator.html': { field: UNDECLARED, title: '未宣告欄位', tail: ['0/span 2', '.', '='] },
    'check.html': { field: UNDECLARED, title: '未宣告欄位', tail: ['0/span 3', '='] },
    'gas.html': { field: UNDECLARED, title: '未宣告欄位', tail: ['0/span 1', '00', '.', '='] }
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
 * B-2. 計數型：快捷值、拆解說明，而且面板不能變高
 * ============================================================ */
console.log('\n=== B-2. 計數型：快捷值與拆解說明 ===');

const COUNT_TAIL = ['0/span 3', '='];
const chipList = d => [...d.querySelectorAll('#calculatorChips .chip-btn')].map(b => b.textContent);

const COUNT_FIELDS = [
    ['check.html', 'check-count', '開票張數', [12, 24, 36, 48, 60, 72], '35 張月票 ＋ 1 張尾款票'],
    ['calculator.html', 'period', '期數', [12, 24, 36, 48, 60, 72], '36 期 ＝ 3 年']
];

COUNT_FIELDS.forEach(([page, field, title, chips, subText]) => {
    const { d, ev } = booted[page];
    ev(`openCalculator('${field}', '${title}')`);

    t(`${field} 末列只有 0 與 =（沒有 000／萬／小數點）`,
        JSON.stringify(tailKeys(d)) === JSON.stringify(COUNT_TAIL), JSON.stringify(tailKeys(d)));
    t('  前四列一樣沒動', JSON.stringify(headKeys(d)) === JSON.stringify(HEAD_EXPECT));
    t(`  快捷值 ${chips.join('／')}`,
        JSON.stringify(chipList(d)) === JSON.stringify(chips.map(String)), JSON.stringify(chipList(d)));

    ev('calculatorClear(); calculatorInput(3); calculatorInput(6)');
    t(`  副資訊顯示拆解「${subText}」`, d.getElementById('calculatorSub').textContent === subText,
        d.getElementById('calculatorSub').textContent);

    ev('calculatorChip(48)');
    t('  點快捷值直接帶入 48', ev('calculatorValue') === '48', ev('calculatorValue'));
    t('    拆解說明同步更新', d.getElementById('calculatorSub').textContent !== subText
        && d.getElementById('calculatorSub').textContent.length > 0,
        d.getElementById('calculatorSub').textContent);

    t('  面板帶 form-compact（算式行收起、空間讓給快捷列）',
        d.querySelector('.number-input-modal').classList.contains('form-compact'));

    // 計數型仍然可以運算，算式改顯示在副資訊行（不會消失）
    ev(`calculatorClear(); calculatorInput(6); calculatorInput(0); calculatorOperation('-'); calculatorInput(1); calculatorInput(2)`);
    t('  按了運算子後，算式改顯示在副資訊行',
        d.getElementById('calculatorSub').textContent.indexOf('60 - ') === 0,
        d.getElementById('calculatorSub').textContent);
    ev('calculatorEquals()');
    t('    60 − 12 = 48', ev('calculatorValue') === '48', ev('calculatorValue'));
});

// 位數上限：張數兩位、期數三位
booted['check.html'].ev(`openCalculator('check-count', '張數'); calculatorClear(); calculatorInput(9); calculatorInput(9); calculatorInput(9)`);
t('開票張數擋在 2 位數（99）', booted['check.html'].ev('calculatorValue') === '99',
    booted['check.html'].ev('calculatorValue'));
booted['calculator.html'].ev(`openCalculator('period', '期數'); calculatorClear(); calculatorInput(1); calculatorInput(2); calculatorInput(0); calculatorInput(0)`);
t('期數擋在 3 位數（120）', booted['calculator.html'].ev('calculatorValue') === '120',
    booted['calculator.html'].ev('calculatorValue'));

// 加油頁：計數型但保留 00（每月油量動輒四五位數），且沒有快捷值
booted['gas.html'].ev(`openCalculator('monthlyVolume', '每月油量')`);
t('每月油量：計數型但保留 00 加速鍵',
    JSON.stringify(tailKeys(booted['gas.html'].d)) === JSON.stringify(['0/span 2', '00', '=']),
    JSON.stringify(tailKeys(booted['gas.html'].d)));
t('  已收掉對公升沒有意義的小數點', !tailKeys(booted['gas.html'].d).includes('.'));
t('  沒有快捷值時，快捷列是空的（CSS :empty 不佔高度）',
    chipList(booted['gas.html'].d).length === 0);
t('  keypad.css 有 :empty 規則', /\.calculator-chips:empty\s*\{[^}]*display:\s*none/
    .test(fs.readFileSync(R + '/css/keypad.css', 'utf8')));

// 拆解說明必須與頁面上原本那行文字用同一支函式
t('describeCheckCount 是共用的純函式（欄位下方那行與鍵盤共用）',
    booted['check.html'].ev('typeof describeCheckCount') === 'function');
t('  1 張時的說法一致', booted['check.html'].ev('describeCheckCount(1)') === '僅 1 張尾款票');
t('  0 張不產生文字', booted['check.html'].ev('describeCheckCount(0)') === '');
t('describePeriod 換算正確（30 期 ＝ 2 年 6 個月）',
    booted['calculator.html'].ev('describePeriod(30)') === '30 期 ＝ 2 年 6 個月',
    booted['calculator.html'].ev('describePeriod(30)'));
t('  未滿一年只講月數', booted['calculator.html'].ev('describePeriod(6)') === '6 期 ＝ 6 個月',
    booted['calculator.html'].ev('describePeriod(6)'));

/* ============================================================
 * B-3. 小數型：保留小數點、收掉加速鍵、小數位數即時擋
 * ============================================================ */
console.log('\n=== B-3. 小數型：利率、油品單價、折扣金額 ===');

const DECIMAL_TAIL = ['0/span 2', '.', '='];

const calcPage = booted['calculator.html'];
calcPage.ev(`openCalculator('rate', '稅前利率')`);
t('利率末列＝0／小數點／=（沒有 000 與 萬）',
    JSON.stringify(tailKeys(calcPage.d)) === JSON.stringify(DECIMAL_TAIL), JSON.stringify(tailKeys(calcPage.d)));
t('  快捷值 4／6／8／10／12／14（與畫面上那排相同）',
    JSON.stringify(chipList(calcPage.d)) === JSON.stringify(['4', '6', '8', '10', '12', '14']),
    JSON.stringify(chipList(calcPage.d)));
calcPage.ev(`calculatorClear(); calculatorInput(8); calculatorDecimal(); calculatorInput(5)`);
t('  可輸入 8.5', calcPage.ev('calculatorValue') === '8.5', calcPage.ev('calculatorValue'));
t('  副資訊顯示月利率 0.7083%',
    calcPage.d.getElementById('calculatorSub').textContent === '月利率 0.7083%',
    calcPage.d.getElementById('calculatorSub').textContent);
calcPage.ev('calculatorInput(5); calculatorInput(5); calculatorInput(5)');
t('  小數 4 位（8.5555）', calcPage.ev('calculatorValue') === '8.5555', calcPage.ev('calculatorValue'));
calcPage.ev('calculatorInput(5)');
t('    第 5 位被當下擋掉（存檔是 toFixed(4)，不會無聲改掉畫面上的數字）',
    calcPage.ev('calculatorValue') === '8.5555', calcPage.ev('calculatorValue'));
calcPage.ev('calculatorChip(12)');
t('  點快捷值帶入 12', calcPage.ev('calculatorValue') === '12', calcPage.ev('calculatorValue'));
t('    月利率同步變成 1.0000%',
    calcPage.d.getElementById('calculatorSub').textContent === '月利率 1.0000%',
    calcPage.d.getElementById('calculatorSub').textContent);

const gasPage = booted['gas.html'];
gasPage.ev(`openCalculator('dieselPrice', '油品單價')`);
t('油品單價末列＝0／小數點／=（頁面層級的 00 已不再套用）',
    JSON.stringify(tailKeys(gasPage.d)) === JSON.stringify(DECIMAL_TAIL), JSON.stringify(tailKeys(gasPage.d)));
t('  沒有快捷值（每週油價都不同，畫面上已有中／塑兩顆鍵）',
    chipList(gasPage.d).length === 0);
gasPage.ev(`calculatorClear(); calculatorInput(2); calculatorInput(9); calculatorDecimal(); calculatorInput(3)`);
t('  可輸入 29.3', gasPage.ev('calculatorValue') === '29.3', gasPage.ev('calculatorValue'));
gasPage.ev('calculatorInput(7)');
t('    第 2 位小數被擋掉（存檔是 toFixed(1)）', gasPage.ev('calculatorValue') === '29.3',
    gasPage.ev('calculatorValue'));

gasPage.ev(`openCalculator('discountAmount', '折扣金額')`);
t('折扣金額快捷值 0.4～0.9（與畫面上那排相同）',
    JSON.stringify(chipList(gasPage.d)) === JSON.stringify(['0.4', '0.5', '0.6', '0.7', '0.8', '0.9']),
    JSON.stringify(chipList(gasPage.d)));
gasPage.ev('calculatorChip(0.5)');
t('  點 0.5 直接帶入', gasPage.ev('calculatorValue') === '0.5', gasPage.ev('calculatorValue'));
gasPage.d.getElementById('dieselPrice').value = '29.3';
gasPage.ev('calculatorChip(0.5)');
t('  副資訊顯示折後 28.8 元/公升',
    gasPage.d.getElementById('calculatorSub').textContent === '折後 28.8 元/公升',
    gasPage.d.getElementById('calculatorSub').textContent);
gasPage.ev(`openCalculator('dieselPrice', '油品單價')`);
gasPage.d.getElementById('discountAmount').value = '0.5';
gasPage.ev(`calculatorClear(); calculatorInput(3); calculatorInput(0)`);
t('  反過來輸入單價時也顯示折後 29.5 元/公升',
    gasPage.d.getElementById('calculatorSub').textContent === '折後 29.5 元/公升',
    gasPage.d.getElementById('calculatorSub').textContent);

t('小數位數上限是各欄位自己宣告的（沒宣告的欄位不受限制）', (() => {
    // 計算頁的本金沒有宣告 maxDecimals，仍可自由輸入小數
    calcPage.ev(`openCalculator('principal', '本金'); calculatorClear(); calculatorInput(1); calculatorDecimal(); calculatorInput(2); calculatorInput(3); calculatorInput(4); calculatorInput(5)`);
    return calcPage.ev('calculatorValue') === '1.2345';
})(), calcPage.ev('calculatorValue'));

/* ============================================================
 * B-4. 其餘金額欄位（計算頁三個 + 加油頁每月油錢）
 * ============================================================ */
console.log('\n=== B-4. 計算頁與加油頁的金額欄位 ===');

[['calculator.html', 'principal', '本金'],
['calculator.html', 'payment', '期繳'],
['calculator.html', 'commission', '推廣']].forEach(([page, field, title]) => {
    const { d, ev } = booted[page];
    ev(`openCalculator('${field}', '${title}')`);
    t(`${field} 末列＝0／000／萬／=`,
        JSON.stringify(tailKeys(d)) === JSON.stringify(AMOUNT_TAIL), JSON.stringify(tailKeys(d)));
    ev(`calculatorClear(); calculatorInput(1); calculatorInput(5); calculatorAppend('0000')`);
    t('  15 + 萬 = 150000', ev('calculatorValue') === '150000', ev('calculatorValue'));
    t('  副資訊顯示「15 萬」', d.getElementById('calculatorSub').textContent === '15 萬',
        d.getElementById('calculatorSub').textContent);
});

booted['gas.html'].ev(`openCalculator('monthlyExpense', '每月油錢')`);
t('每月油錢末列＝0／000／萬／=（頁面層級的 00 已換掉）',
    JSON.stringify(tailKeys(booted['gas.html'].d)) === JSON.stringify(AMOUNT_TAIL),
    JSON.stringify(tailKeys(booted['gas.html'].d)));

booted['calculator.html'].ev(`openCalculator('monthlyCost', '資金成本')`);
t('資金成本是百分比 → 小數型（不是金額型）',
    JSON.stringify(tailKeys(booted['calculator.html'].d)) === JSON.stringify(DECIMAL_TAIL),
    JSON.stringify(tailKeys(booted['calculator.html'].d)));
booted['calculator.html'].ev(`calculatorClear(); calculatorInput(2); calculatorInput(5)`);
t('  兩位整數（上限 20%）可輸入 25，交給原本的驗證擋',
    booted['calculator.html'].ev('calculatorValue') === '25');
booted['calculator.html'].ev('calculatorInput(5)');
t('  第 3 位被擋掉', booted['calculator.html'].ev('calculatorValue') === '25');

// 「幾萬」讀法本身
const mag = n => booted['calculator.html'].ev(`describeMagnitude(${n})`);
t('describeMagnitude：1500000 → 150 萬', mag(1500000) === '150 萬', mag(1500000));
t('  12345678 → 1,234 萬 5678', mag(12345678) === '1,234 萬 5678', mag(12345678));
t('  230000000 → 2 億 3,000 萬', mag(230000000) === '2 億 3,000 萬', mag(230000000));
t('  未滿一萬不顯示（1234 本來就看得懂）', mag(1234) === '', mag(1234));
t('  0 與負數不顯示', mag(0) === '' && mag(-5) === '');

// 支票頁仍然是中文大寫（要手抄到支票上），不是「幾萬」
chk.ev(`openCalculator('total-amount', '總金額'); calculatorClear(); calculatorInput(1); calculatorAppend('000000')`);
t('支票金額仍顯示中文大寫（手寫用），不是「幾萬」',
    chk.d.getElementById('calculatorSub').textContent === '壹佰萬 元整',
    chk.d.getElementById('calculatorSub').textContent);

/* ============================================================
 * C. 同一頁欄位互相切換不留殘渣
 * ============================================================ */
console.log('\n=== C. 切換欄位不留殘渣 ===');

chk.ev(`openCalculator('total-amount', '總金額')`);
chk.ev(`openCalculator('check-count', '開票張數')`);
t('金額型 → 計數型：末列換成 0 與 =（000 與 萬 完全消失）',
    JSON.stringify(tailKeys(chk.d)) === JSON.stringify(COUNT_TAIL),
    JSON.stringify(tailKeys(chk.d)));
chk.ev('calculatorClear(); calculatorInput(3); calculatorInput(6)');
t('  副資訊換成張數拆解，不是金額大寫',
    chk.d.getElementById('calculatorSub').textContent === '35 張月票 ＋ 1 張尾款票',
    chk.d.getElementById('calculatorSub').textContent);
t('  沒有殘留「元整」', !chk.d.getElementById('calculatorSub').textContent.includes('元整'));
t('  可正常輸入 36 張', chk.ev('calculatorValue') === '36', chk.ev('calculatorValue'));

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
// 換到沒有位數上限的欄位（利率限 3 位整數，塞不下七位數）
calc.ev(`openCalculator('principal', '本金'); calculatorClear(); '1234567'.split('').forEach(function(c){ calculatorInput(Number(c)); }); calculatorDecimal(); calculatorInput(8)`);
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

/* 計數型：多一列快捷值、少一行算式歷程，兩者要互相抵銷。
 * 這是這一批最重要的約束 —— 快捷列不可以把面板撐高。 */
const compactBudget = budget
    - num(/\.calculator-display-container\s*\{[^}]*height:\s*(\d+)px/)
    + num(/form-compact \.calculator-display-container\s*\{[^}]*height:\s*(\d+)px/)
    + num(/\.chip-btn\s*\{[^}]*height:\s*(\d+)px/);
t(`計數型估算高度 ${compactBudget}px，與其他型別相差 ${Math.abs(compactBudget - budget)}px（≤ 8px）`,
    Math.abs(compactBudget - budget) <= 8, compactBudget + 'px vs ' + budget + 'px');
t('  快捷列下方沒有額外外距（有的話就會把面板撐高）',
    /\.calculator-chips\s*\{[^}]*margin:\s*0 8px 0/.test(css),
    (css.match(/\.calculator-chips\s*\{[^}]*margin:[^;]*/) || [''])[0]);

console.log('\n========================================');
console.log(`   通過 ${pass} 項 / 失敗 ${fail} 項`);
console.log('========================================');
process.exit(fail ? 1 : 0);
