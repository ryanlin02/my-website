/**
 * 全站版面守門測試 —— 頂端間距不准再靠魔術數字
 * ============================================================
 * 【這支測試存在的原因】
 *
 * 「內容與標題列的距離」這件事被改過幾十次，而且經常是改對一個頁面、
 * 弄壞另一個頁面。原因不是手誤，是結構：
 *
 * 內容的垂直位置原本由 5 個檔案裡 9 個互相牽連的數字決定 ——
 *
 *   index.html      .header-container { height: 60px }
 *   index.html      .content-container { top: 45px }          ← 與上面差 15px
 *   index.html      .content-container { height: calc(100% - 60px) }
 *   calculator.css  .fixed-rate-header { padding-top: 22px }  ← 閃避外殼標題列
 *   calculator.css  html, body { padding-top: 30px }          ← 閃避頁內固定列
 *   calculator.css  .sticky-header { top: 65px }              ← 閃避頁內固定列
 *   check.css       .time-display-wrapper { margin-top: 18px }← 閃避外殼標題列
 *   invoice.css     .top-bar { top: 16px }                    ← 閃避外殼標題列
 *   gas.css         .time-display-wrapper { padding-top: 12px }
 *
 * 每一個都是手調出來的，而且彼此有隱含依賴。改任一個，另外幾個就對不上。
 *
 * 根本原因有兩個：
 *   1. 外殼標題列的高度寫死在三個地方，其中一個還寫錯
 *   2. 頁內用 position: fixed 當頂列 —— fixed 脫離文件流、不佔空間，
 *      所以下面每個元素都得手動「讓開」，而讓開的量必須等於固定列的高度
 *
 * 現在的規則只剩兩條，這支測試就是在守這兩條：
 *   A. 外殼標題列高度只有一個來源 --shell-header-h
 *   B. 頁內頂列一律用 sticky，且 top 一律為 0；頂端間距一律用 --content-gap
 *
 * 需要先安裝 jsdom（本檔其實只讀檔案，不需要，但保持與其他測試一致的執行方式）
 * 執行：node tests/版面守門測試.js
 * ============================================================
 */

const fs = require('fs');
const path = require('path');

const R = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(R, p), 'utf8');
const stripComments = css => css.replace(/\/\*[\s\S]*?\*\//g, '');

let pass = 0, fail = 0;
const t = (n, c, e = '') => {
    c ? pass++ : fail++;
    console.log((c ? '  PASS  ' : '  FAIL  ') + n + (c ? '' : '   → ' + e));
};

const PAGE_CSS = {
    'calculator.html': ['css/keypad.css', 'css/calculator.css'],
    'check.html': ['css/keypad.css', 'css/calculator.css', 'css/check.css'],
    'invoice.html': ['css/invoice.css'],
    'gas.html': ['css/keypad.css', 'css/gas.css']
};

/* ============================================================
 * A. 外殼標題列高度只有一個來源
 * ============================================================ */
console.log('\n=== A. 外殼標題列高度：單一來源 ===');
const shell = stripComments(read('index.html'));

const shellVar = (shell.match(/--shell-header-h:\s*(\d+)px/) || [])[1];
t('index.html 有宣告 --shell-header-h', shellVar !== undefined, '找不到');

const headerRule = (shell.match(/\.header-container\s*\{([^}]*)\}/) || ['', ''])[1];
const contentRule = (shell.match(/\.content-container\s*\{([^}]*)\}/) || ['', ''])[1];

t('  .header-container 的 height 用變數，不寫死數字',
    /height:\s*var\(--shell-header-h\)/.test(headerRule),
    (headerRule.match(/height:[^;]*/) || [''])[0]);
t('  .content-container 的 top 用變數',
    /top:\s*var\(--shell-header-h\)/.test(contentRule),
    (contentRule.match(/(?<![\w-])top:[^;]*/) || [''])[0]);
t('  .content-container 的 height 用變數推導',
    /height:\s*calc\(100%\s*-\s*var\(--shell-header-h\)\)/.test(contentRule),
    (contentRule.match(/height:[^;]*/) || [''])[0]);

// 這三處若有任何一處還寫死 px，改高度時就會漏掉
const hardcoded = [];
if (/height:\s*\d+px/.test(headerRule)) hardcoded.push('.header-container height');
if (/(?<![\w-])top:\s*\d+px/.test(contentRule)) hardcoded.push('.content-container top');
if (/height:\s*calc\(100%\s*-\s*\d+px\)/.test(contentRule)) hardcoded.push('.content-container height');
t('  三處都沒有殘留寫死的 px', hardcoded.length === 0, hardcoded.join(', '));

/* ============================================================
 * B. 頁內不准用 fixed 當頂列
 * ============================================================ */
console.log('\n=== B. 頁內頂列一律 sticky，禁止 fixed ===');

/* fixed 的問題是「不佔空間」，所以下方內容必須手動讓開。
 * 彈窗遮罩、Toast 這類「本來就該浮在最上層、不參與版面」的元素可以用 fixed，
 * 所以這裡只檢查會出現在頁面頂端的那些具名頂列。 */
const TOP_BARS = {
    'css/calculator.css': ['.fixed-rate-header', '.sticky-header'],
    'css/check.css': ['.write-progress'],
    'css/invoice.css': ['.top-bar'],
    'css/gas.css': ['.sticky-header']
};

Object.entries(TOP_BARS).forEach(([file, sels]) => {
    const css = stripComments(read(file));
    sels.forEach(sel => {
        const m = css.match(new RegExp('(?:^|\\})\\s*' + sel.replace('.', '\\.') + '\\s*\\{([^}]*)\\}', 'm'));
        if (!m) return;                       // 該檔沒有這條規則就跳過
        const body = m[1];
        t(`${file} 的 ${sel} 不是 position: fixed`,
            !/position:\s*fixed/.test(body),
            'fixed 會脫離文件流，下方內容必須手動讓開');
        const top = (body.match(/(?<![\w-])top:\s*(-?\d+)px/) || [])[1];
        t(`  ${sel} 的 sticky top = 0`,
            top === undefined || Number(top) === 0,
            `top: ${top}px —— 這種偏移一定是在閃避別的元素`);
    });
});

/* ============================================================
 * C. 頂端間距一律用 --content-gap，四頁同值
 * ============================================================ */
console.log('\n=== C. 頂端間距：四頁同一個值 ===');

const gaps = {};
['css/calculator.css', 'css/invoice.css', 'css/gas.css'].forEach(f => {
    const m = stripComments(read(f)).match(/--content-gap:\s*([^;]+);/);
    gaps[f] = m ? m[1].trim() : null;
});
Object.entries(gaps).forEach(([f, v]) => t(`${f} 有宣告 --content-gap`, v !== null, '未宣告'));
const gapValues = [...new Set(Object.values(gaps).filter(Boolean))];
t('  四頁的 --content-gap 值一致', gapValues.length === 1, gapValues.join(' / '));

// check.css 不自己宣告，它載入在 calculator.css 之後，沿用同一個值
t('  check.html 的載入順序讓 check.css 拿得到 --content-gap',
    PAGE_CSS['check.html'].indexOf('css/calculator.css') < PAGE_CSS['check.html'].indexOf('css/check.css'));

/* ============================================================
 * D. 不准再出現「閃避用」的補償值
 * ============================================================ */
console.log('\n=== D. 沒有殘留的閃避補償 ===');

['css/calculator.css', 'css/check.css', 'css/invoice.css', 'css/gas.css'].forEach(f => {
    const css = stripComments(read(f));
    const m = css.match(/html\s*,?\s*body\s*\{([^}]*)\}/);
    const pad = m ? (m[1].match(/padding-top:\s*(\d+)px/) || [])[1] : undefined;
    t(`${f} 的 html/body 沒有 padding-top`,
        pad === undefined || Number(pad) === 0,
        `padding-top: ${pad}px —— 這通常是在讓開某個 fixed 元素`);
});

// 頂端元素的間距必須用變數，不能又寫回數字
const GAP_USERS = [
    ['css/calculator.css', '.time-display-wrapper'],
    ['css/check.css', '.time-display-wrapper'],
    ['css/gas.css', '.time-display-wrapper'],
    ['css/invoice.css', '.top-bar']
];
GAP_USERS.forEach(([f, sel]) => {
    const css = stripComments(read(f));
    const m = css.match(new RegExp('(?:^|\\})\\s*' + sel.replace('.', '\\.') + '\\s*\\{([^}]*)\\}', 'm'));
    if (!m) return;
    t(`${f} 的 ${sel} 用 --content-gap 控制頂端間距`,
        /margin:\s*var\(--content-gap\)/.test(m[1]) || /margin-top:\s*var\(--content-gap\)/.test(m[1]),
        (m[1].match(/margin[^;]*/) || [''])[0].trim());
});

/* ============================================================
 * E. 每一頁載入的 CSS 裡，被引用的變數都要有人宣告
 * ============================================================
 * CSS 遇到未宣告的變數會讓整條宣告靜默失效，不會報錯。
 * 這裡依各頁真實的載入組合檢查，跨檔案的依賴也涵蓋得到。 */
console.log('\n=== E. 各頁沒有失效的 CSS 變數 ===');
Object.entries(PAGE_CSS).forEach(([page, sheets]) => {
    let declared = new Set(), referenced = new Set();
    sheets.forEach(s => {
        const c = stripComments(read(s));
        [...c.matchAll(/(--[\w-]+)\s*:/g)].forEach(m => declared.add(m[1]));
        [...c.matchAll(/var\(\s*(--[\w-]+)/g)].forEach(m => referenced.add(m[1]));
    });
    const bad = [...referenced].filter(v => !declared.has(v));
    t(`${page} 沒有引用未宣告的變數`, bad.length === 0, bad.join(', '));
});

console.log('\n========================================');
console.log(`   通過 ${pass} 項 / 失敗 ${fail} 項`);
console.log('========================================');
process.exit(fail ? 1 : 0);
