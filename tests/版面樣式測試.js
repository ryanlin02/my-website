/**
 * 支票頁 — 版面樣式守門測試
 * ============================================================
 * 為什麼需要這支測試：
 *
 * 其他測試驗證的是「行為」（點了會怎樣、算出來對不對），
 * 但 CSS 版面問題不會有任何行為異常，函式照跑、值也對，
 * 只是畫面長得不對。這一類問題只能靠檢查樣式規則本身。
 *
 * 實際發生過的例子：
 *   calculator.css 對 html/body 設了 overflow-x: hidden。
 *   當 overflow-x 是 hidden 而 overflow-y 是 visible 時，
 *   瀏覽器會把 overflow-y 自動算成 auto，body 因此變成捲動容器。
 *   position: sticky 相對「最近的捲動祖先」定位，於是固定進度列
 *   黏在 body 的捲動框裡（等於整份文件高度），完全看不出固定效果。
 *   所有功能測試都是綠的，但畫面就是不對。
 *
 * 需要先安裝 jsdom：npm install jsdom
 * 執行：node tests/版面樣式測試.js
 * ============================================================
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const R = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(R, 'pages/check.html'), 'utf8');

// 依 HTML 中 <link> 的真實順序載入樣式表，才能反映實際的層疊結果
const sheets = [...html.matchAll(/<link rel="stylesheet" href="\.\.\/css\/([^"]+)"/g)].map(m => m[1]);

let bodyHtml = html
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<link[^>]*>/g, '');
const styleTags = sheets.map(f => `<style>${fs.readFileSync(path.join(R, 'css', f), 'utf8')}</style>`).join('\n');
bodyHtml = bodyHtml.replace('</head>', styleTags + '</head>');

const dom = new JSDOM(bodyHtml);
const w = dom.window;
const d = w.document;
const css = value => w.getComputedStyle(value);

let pass = 0, fail = 0;
const t = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '   → ' + extra)); };

console.log('\n樣式表載入順序: ' + sheets.join(' → '));

/* ------------------------------------------------------------
 * 1. 固定進度列必須真的能固定
 * ------------------------------------------------------------ */
console.log('\n=== 固定進度列 ===');

const bar = d.getElementById('write-progress');
t('進度列存在', bar !== null);
t('  position 為 sticky', css(bar).position === 'sticky', css(bar).position);
/* 外殼 index.html 的標題列高 60px，但 iframe 容器設在 top: 45px，
 * 所以 iframe 最上面 15px 被標題列蓋住。進度列必須固定在 15px，
 * 上緣才會正好接在標題列底下，文字不會被切掉。
 * 這兩個數字直接從 index.html 讀出來計算，之後外殼若調整會立刻被抓到。 */
const shell = fs.readFileSync(path.join(R, 'index.html'), 'utf8');
const headerH = parseFloat((shell.match(/\.header-container\s*\{[^}]*height:\s*(\d+)px/) || [])[1]);
const contentTop = parseFloat((shell.match(/\.content-container\s*\{[^}]*top:\s*(\d+)px/) || [])[1]);
const overlap = headerH - contentTop;
t(`  外殼標題列 ${headerH}px、iframe 起點 ${contentTop}px，重疊 ${overlap}px`,
    Number.isFinite(overlap) && overlap >= 0, `header=${headerH} content=${contentTop}`);
t('  進度列的 top 等於重疊高度（避免文字被標題列切掉）',
    parseFloat(css(bar).top) === overlap, `top=${css(bar).top} 應為 ${overlap}px`);

/**
 * 一個元素會不會建立捲動容器
 * 只有 visible 與 clip 不會；hidden / scroll / auto 都會。
 */
function isScrollContainer(element) {
    const style = css(element);
    return [style.overflowX, style.overflowY]
        .some(v => v && v !== 'visible' && v !== 'clip' && v !== '');
}

const ancestors = [];
for (let node = bar.parentElement; node; node = node.parentElement) ancestors.push(node);

const blockers = ancestors.filter(isScrollContainer);
t('祖先鏈上沒有捲動容器（否則 sticky 會失效）',
    blockers.length === 0,
    blockers.map(e => `${e.tagName.toLowerCase()}{overflow-x:${css(e).overflowX};overflow-y:${css(e).overflowY}}`).join(', '));

ancestors.forEach(node => {
    const style = css(node);
    console.log(`         ${node.tagName.toLowerCase().padEnd(6)} overflow-x=${(style.overflowX || 'visible').padEnd(8)} overflow-y=${style.overflowY || 'visible'}`);
});

t('body 用 clip 而非 hidden（hidden 會讓 overflow-y 變成 auto）',
    css(d.body).overflowX === 'clip', css(d.body).overflowX);

/* ------------------------------------------------------------
 * 2. 現在時間改為一般捲動，把固定位置讓給進度列
 * ------------------------------------------------------------ */
console.log('\n=== 現在時間不再固定 ===');
const clock = d.querySelector('.time-display-wrapper .sticky-header');
t('現在時間存在', clock !== null);
t('  position 為 static（畫面上方只有一個固定位置，讓給進度列）',
    css(clock).position === 'static', css(clock).position);

/* ------------------------------------------------------------
 * 3. 金額群組外框：讓大寫與張數說明有明確歸屬
 * ------------------------------------------------------------ */
console.log('\n=== 金額群組外框 ===');
const groups = [...d.querySelectorAll('.amount-group')];
t('共有 3 個金額群組（繳款、張數、尾款）', groups.length === 3, String(groups.length));
groups.forEach((g, i) => {
    const style = css(g);
    t(`  第 ${i + 1} 組有外框與底色`,
        style.border && style.border !== '' && style.backgroundColor !== '',
        `border=${style.border} bg=${style.backgroundColor}`);
});
t('大寫列不再套用 .row（因此不需要 !important 覆寫）',
    d.querySelectorAll('.chinese-row.row').length === 0);

const checkCss = fs.readFileSync(path.join(R, 'css/check.css'), 'utf8');
const declarations = checkCss.replace(/\/\*[\s\S]*?\*\//g, '');
/* check.css 只允許一處 !important：覆寫 calculator.css 裡同樣帶 !important 的
 * .sticky-header（帶 !important 的宣告贏過任何選擇器權重，只能以 !important 回擊）。
 * 多出任何一處都代表又開始用 !important 硬壓樣式衝突了。 */
const importants = declarations.match(/[^;{}]*!important[^;}]*/g) || [];
t('check.css 的 !important 只有一處', importants.length === 1, importants.join(' | '));
t('  且是為了覆寫 calculator.css 同樣帶 !important 的 .sticky-header',
    importants.length === 1 && /position:\s*static/.test(importants[0]), importants.join(' | '));
t('  calculator.css 那條確實帶 !important（否則這裡就不需要了）',
    /\.sticky-header\s*\{[^}]*position:\s*sticky\s*!important/.test(
        fs.readFileSync(path.join(R, 'css/calculator.css'), 'utf8')));

/* ------------------------------------------------------------
 * 4. 空值時附屬說明要能完全收起，外框底部才不會留空縫
 * ------------------------------------------------------------ */
console.log('\n=== 空值收起 ===');
t('CSS 有 .chinese-display:empty 的隱藏規則', /\.chinese-display:empty/.test(checkCss));
t('CSS 有 .count-breakdown:empty 的隱藏規則', /\.count-breakdown:empty/.test(checkCss));
const emptyRule = checkCss.match(/\.chinese-display:empty[\s\S]{0,120}?\}/);
t('  規則內容為 display: none', emptyRule && /display:\s*none/.test(emptyRule[0]), emptyRule && emptyRule[0]);

/* ------------------------------------------------------------
 * 5. 開票清單欄寬固定，50 列也不會因內容長短而跳動
 * ------------------------------------------------------------ */
console.log('\n=== 開票清單 ===');
t('CSS 指定 table-layout: fixed', /\.check-list-table[\s\S]{0,200}?table-layout:\s*fixed/.test(checkCss));
['col-tick', 'col-seq', 'col-date', 'col-week', 'col-amount', 'col-left'].forEach(c => {
    t(`  .${c} 有指定寬度`, new RegExp('\\.' + c + '\\s*\\{[^}]*width'). test(checkCss));
});

/* ------------------------------------------------------------
 * 6. 漏開警示與未儲存提示預設隱藏
 * ------------------------------------------------------------ */
console.log('\n=== 預設隱藏的提示 ===');
t('進度列預設隱藏', css(bar).display === 'none', css(bar).display);
t('漏開警示預設隱藏', css(d.getElementById('write-gap')).display === 'none');
t('已開立合計預設隱藏', css(d.getElementById('write-summary')).display === 'none');
t('「已修改，尚未儲存」預設隱藏', css(d.getElementById('unsaved-hint')).display === 'none');

console.log('\n========================================');
console.log('   通過 ' + pass + ' 項 / 失敗 ' + fail + ' 項');
console.log('========================================');
process.exit(fail ? 1 : 0);
