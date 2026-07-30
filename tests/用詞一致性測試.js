/**
 * 用詞一致性測試 —— 四頁講同一套話
 * ============================================================
 * 【這支測試存在的原因】
 *
 * 存檔與歷史這組功能，四頁原本各講各的：
 *   保存計算／存檔、歷史記錄／歷史、載入計算／套用資料、全刪／全部刪除
 * 都是同一個動作的不同說法。使用者在四頁之間切換時，等於每換一頁
 * 就要重新認一次按鈕。
 *
 * 用詞這種東西沒有測試就一定會再度分岔 —— 它不會壞掉、不會報錯，
 * 只會在下一次有人順手加一顆按鈕時悄悄多出第五種說法。
 *
 * 【定案的用詞】
 *   動作按鈕   存檔
 *   入口按鈕   歷史
 *   面板標題   歷史紀錄
 *   套用按鈕   套用
 *   清空按鈕   清空歷史
 *   確認彈窗   刪除確認 ／ 清空確認
 *   提示訊息   已存檔／已套用／已刪除／已清空歷史／備註已儲存
 *
 * 另外「紀錄」是名詞（一筆紀錄）、「記錄」是動詞（記錄下來）。
 * 使用者看得到的地方一律用「紀錄」。
 *
 * 執行：node tests/用詞一致性測試.js
 * ============================================================
 */

const fs = require('fs');
const path = require('path');

const R = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(R, f), 'utf8');

let pass = 0, fail = 0;
const t = (name, cond, extra = '') => {
    cond ? pass++ : fail++;
    console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '   → ' + extra));
};

/* 只看使用者真的看得到的文字，註解不算 */
function stripJsComments(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter(l => {
            const s = l.trim();
            return !s.startsWith('//') && !s.startsWith('*');
        })
        .join('\n');
}
function stripHtmlComments(src) {
    return src.replace(/<!--[\s\S]*?-->/g, '');
}

/* ============================================================
   一、退場的用詞不可以再出現在使用者看得到的地方
   ============================================================ */
console.log('\n退場用詞');

const RETIRED = ['保存計算', '載入計算', '套用資料', '歷史記錄', '全部刪除'];

const USER_FACING = [
    'pages/calculator.html', 'pages/check.html', 'pages/invoice.html', 'pages/gas.html',
    'js/calc-storage.js', 'js/check-engine.js', 'js/invoice-engine.js', 'js/gas-engine.js',
    'instructions/calculator_instruction.html', 'instructions/check_instruction.html',
    'instructions/invoice_instruction.html', 'instructions/gas_instruction.html'
];

USER_FACING.forEach(f => {
    const raw = read(f);
    const body = f.endsWith('.html') ? stripHtmlComments(raw) : stripJsComments(raw);
    const hits = RETIRED.filter(w => body.includes(w));
    t(`${f} 沒有殘留退場用詞`, hits.length === 0, hits.join('、'));
});

/* 「全刪」單獨檢查：它是「全刪確認」的一部分，不能用 includes 掃整份 */
['pages/calculator.html', 'pages/check.html'].forEach(f => {
    const body = stripHtmlComments(read(f));
    t(`${f} 的清空按鈕不是「全刪」`, !/>全刪</.test(body));
});

/* ============================================================
   二、四頁的按鈕字樣
   ============================================================ */
console.log('\n按鈕字樣');

[
    ['pages/calculator.html', 'saveLoanData()'],
    ['pages/check.html', 'saveCheckData()']
].forEach(([f, fn]) => {
    const body = stripHtmlComments(read(f));
    t(`${f} 存檔按鈕寫「存檔」`,
        new RegExp(`onclick="${fn.replace('(', '\\(').replace(')', '\\)')}">存檔<`).test(body));
    t(`${f} 入口按鈕寫「歷史」`, /onclick="toggleHistoryPanel\(\)">歷史</.test(body));
    t(`${f} 面板標題寫「歷史紀錄」`, /<h2>歷史紀錄<\/h2>/.test(body));
    t(`${f} 清空按鈕寫「清空歷史」`, />清空歷史</.test(body));
});

{
    const body = stripHtmlComments(read('pages/invoice.html'));
    t('pages/invoice.html 存檔按鈕寫「存檔」', /id="btnSaveRec">存檔</.test(body));
    t('pages/invoice.html 入口按鈕寫「歷史」', /id="btnHistory">歷史</.test(body));
    t('pages/invoice.html 面板標題寫「歷史紀錄」', /class="t">歷史紀錄</.test(body));
    t('pages/invoice.html 清空按鈕寫「清空歷史」', /id="histClear">清空歷史</.test(body));
}

/* 清單裡的套用按鈕（字樣寫在 JS 的樣板字串裡） */
[['js/calc-storage.js', 'loadLoanToForm'], ['js/check-engine.js', 'loadCheckToForm']]
    .forEach(([f, fn]) => {
        const body = stripJsComments(read(f));
        t(`${f} 的套用按鈕寫「套用」`,
            new RegExp(`${fn}\\(\\$\\{rec\\.id\\}\\)">套用<`).test(body),
            (body.match(new RegExp(`${fn}[^<]*<\\/?[^>]*>[^<]*`)) || [''])[0]);
    });

/* ============================================================
   三、確認彈窗的標題
   ============================================================ */
console.log('\n確認彈窗');

const ENGINES = ['js/calc-storage.js', 'js/check-engine.js', 'js/invoice-engine.js'];
ENGINES.forEach(f => {
    const body = stripJsComments(read(f));
    t(`${f} 單筆刪除用「刪除確認」`, body.includes("'刪除確認'"));
    t(`${f} 清空用「清空確認」`, body.includes("'清空確認'"));
    t(`${f} 沒有舊的「確認刪除」「全刪確認」`,
        !body.includes("'確認刪除'") && !body.includes("'全刪確認'"));
});

/* ============================================================
   四、提示訊息
   ============================================================ */
console.log('\n提示訊息');

/* 計算頁與支票頁的存檔提示是條件式的（覆蓋原紀錄時講的是另一句話），
   所以只比對字串本身，不比對整行呼叫。 */
const TOASTS = {
    'js/calc-storage.js': ["'已存檔'", "showToast('已套用')",
                           "showToast('已刪除')", "showToast('已清空歷史')"],
    'js/check-engine.js': ["'已存檔'", "showToast('已套用')",
                           "showToast('已刪除')", "showToast('已清空歷史')"],
    'js/invoice-engine.js': ["showToast('已存檔')", "showToast('已套用')",
                             "showToast('已刪除')", "showToast('已清空歷史')"]
};
Object.entries(TOASTS).forEach(([f, needles]) => {
    const body = stripJsComments(read(f));
    const missing = needles.filter(n => !body.includes(n));
    t(`${f} 四個提示都用共同說法`, missing.length === 0, missing.join('、'));
});

/* 備註的提示：兩頁都要是「備註已儲存」 */
['js/calc-storage.js', 'js/check-engine.js'].forEach(f => {
    const body = stripJsComments(read(f));
    t(`${f} 備註提示寫「備註已儲存」`,
        body.includes("showToast('備註已儲存')") && !body.includes("備註已更新"));
});

/* ============================================================
   五、名詞一律用「紀錄」
   ============================================================ */
console.log('\n紀錄 vs 記錄');

USER_FACING.forEach(f => {
    const raw = read(f);
    const body = f.endsWith('.html') ? stripHtmlComments(raw) : stripJsComments(raw);
    // 「記錄」當名詞用的常見組合
    const bad = ['歷史記錄', '計算記錄', '筆記錄', '這筆記錄', '所有記錄']
        .filter(w => body.includes(w));
    t(`${f} 名詞沒有寫成「記錄」`, bad.length === 0, bad.join('、'));
});

/* ============================================================ */
console.log(`\n通過 ${pass}　失敗 ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
