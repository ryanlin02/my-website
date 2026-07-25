/**
 * 中文大寫金額轉換 — 迴歸測試
 * ============================================================
 * 針對 js/check-engine.js 的 arabicToChineseNumber()
 *
 * 為什麼需要這支測試：
 *   舊版把數字每 4 位切成一段分別轉換，「要補零」的旗標在每一段開頭
 *   都被重設，導致段與段之間的零整個消失：
 *       1,005,000  → 壹佰萬伍仟    （正確：壹佰萬零伍仟）
 *      10,005,000  → 壹仟萬伍仟    （正確：壹仟萬零伍仟）
 *   支票大寫漏一個「零」，銀行有權以文義不清、可被增改為由退票。
 *   這種錯誤不會有任何報錯，只能靠測試擋住，所以之後每次改動
 *   arabicToChineseNumber 都請先跑一次這支測試。
 *
 * 執行方式（不需要安裝任何套件）：
 *     node tests/大寫金額測試.js
 * ============================================================
 */

const fs = require('fs');
const path = require('path');

// 直接從 check-engine.js 抽出函式本體，確保測的是正在上線的那一份
const engineSource = fs.readFileSync(
    path.join(__dirname, '..', 'js', 'check-engine.js'),
    'utf8'
);
const match = engineSource.match(/function arabicToChineseNumber[\s\S]*?\n}/);
if (!match) {
    console.error('✗ 在 js/check-engine.js 找不到 arabicToChineseNumber，測試中止');
    process.exit(1);
}
eval(match[0]);   // eslint-disable-line no-eval

const toChinese = n => arabicToChineseNumber(n, 'financial', false);

let passed = 0;
let failed = 0;

function expect(input, want) {
    const got = toChinese(input);
    if (got === want) {
        passed++;
    } else {
        failed++;
        console.log(`  ✗ ${String(input).padStart(13)}  得到「${got}」  應為「${want}」`);
    }
}

/* ------------------------------------------------------------
 * 1. 基本位數
 * ------------------------------------------------------------ */
console.log('\n【1】基本位數');
expect(1, '壹');
expect(10, '壹拾');
expect(11, '壹拾壹');
expect(100, '壹佰');
expect(1000, '壹仟');
expect(10000, '壹萬');
expect(100000, '壹拾萬');
expect(1000000, '壹佰萬');
expect(10000000, '壹仟萬');
expect(100000000, '壹億');

/* ------------------------------------------------------------
 * 2. 段內補零
 * ------------------------------------------------------------ */
console.log('【2】段內補零');
expect(105, '壹佰零伍');
expect(1001, '壹仟零壹');
expect(1010, '壹仟零壹拾');
expect(10101, '壹萬零壹佰零壹');

/* ------------------------------------------------------------
 * 3. 跨萬位補零 — 這是舊版失效的地方
 * ------------------------------------------------------------ */
console.log('【3】跨萬位補零（舊版失效案例）');
expect(1005000, '壹佰萬零伍仟');      // 舊版：壹佰萬伍仟
expect(10005000, '壹仟萬零伍仟');     // 舊版：壹仟萬伍仟
expect(705000, '柒拾萬零伍仟');       // 舊版：柒拾萬伍仟
expect(20005000, '貳仟萬零伍仟');     // 舊版：貳仟萬伍仟
expect(1000500, '壹佰萬零伍佰');
expect(1200300, '壹佰貳拾萬零參佰');
expect(20005, '貳萬零伍');
expect(20000001, '貳仟萬零壹');
expect(10000100, '壹仟萬零壹佰');
expect(100000005, '壹億零伍');
expect(100010000, '壹億零壹萬');

/* ------------------------------------------------------------
 * 4. 業務常見金額
 * ------------------------------------------------------------ */
console.log('【4】業務常見金額');
expect(50000, '伍萬');
expect(1500000, '壹佰伍拾萬');
expect(2010000, '貳佰零壹萬');
expect(11000000, '壹仟壹佰萬');
expect(123456789, '壹億貳仟參佰肆拾伍萬陸仟柒佰捌拾玖');
expect(999999999, '玖億玖仟玖佰玖拾玖萬玖仟玖佰玖拾玖');   // 總金額上限

/* ------------------------------------------------------------
 * 5. 防呆 — 不合理的輸入一律回傳空字串
 *    絕對不可以把負數轉成「看起來很正常」的正數大寫
 * ------------------------------------------------------------ */
console.log('【5】防呆（不合理輸入必須回傳空字串）');
[-1, -50000, 0, NaN, Infinity, -Infinity, null, undefined, '', 'abc', 0.5, 1e20].forEach(v => {
    const got = toChinese(v);
    if (got === '') {
        passed++;
    } else {
        failed++;
        console.log(`  ✗ ${JSON.stringify(v)}  得到「${got}」  應為空字串`);
    }
});

/* ------------------------------------------------------------
 * 6. 大量往返驗證
 *    用一支「把中文大寫讀回數字」的獨立解析器（邏輯與產生器完全不同）
 *    對近百萬筆數字做往返比對，抓出任何人工案例想不到的組合
 * ------------------------------------------------------------ */
console.log('【6】大量往返驗證');

const DIGIT = { 零: 0, 壹: 1, 貳: 2, 參: 3, 肆: 4, 伍: 5, 陸: 6, 柒: 7, 捌: 8, 玖: 9 };
const UNIT = { 拾: 10, 佰: 100, 仟: 1000 };
const BIG = { 萬: 1e4, 億: 1e8, 兆: 1e12 };

function parseChinese(text) {
    let total = 0, section = 0, current = 0;
    for (const ch of text) {
        if (ch in DIGIT) current = DIGIT[ch];
        else if (ch in UNIT) { section += (current || 0) * UNIT[ch]; current = 0; }
        else if (ch in BIG) { section += current; current = 0; total += section * BIG[ch]; section = 0; }
        else return NaN;
    }
    return total + section + current;
}

let roundTripChecked = 0;
let roundTripFailed = 0;

function roundTrip(value) {
    roundTripChecked++;
    if (parseChinese(toChinese(value)) !== value) {
        roundTripFailed++;
        if (roundTripFailed <= 10) {
            console.log(`  ✗ ${value} → 「${toChinese(value)}」→ 讀回 ${parseChinese(toChinese(value))}`);
        }
    }
}

// 6-1 低位數全掃
for (let v = 1; v <= 200000; v++) roundTrip(v);

// 6-2 各長度隨機取樣
for (let digits = 6; digits <= 8; digits++) {
    for (let i = 0; i < 150000; i++) {
        const v = Math.floor(Math.random() * Math.pow(10, digits + 1));
        if (v > 0) roundTrip(v);
    }
}

// 6-3 刻意製造大量含零的樣式（補零規則最容易出錯的地方）
for (let i = 0; i < 200000; i++) {
    let s = '';
    const len = 1 + Math.floor(Math.random() * 9);
    for (let k = 0; k < len; k++) {
        s += (Math.random() < 0.55 ? '0' : String(1 + Math.floor(Math.random() * 9)));
    }
    const v = parseInt(s, 10);
    if (v > 0) roundTrip(v);
}

if (roundTripFailed === 0) {
    passed++;
    console.log(`  ✓ ${roundTripChecked.toLocaleString()} 筆往返比對全部一致`);
} else {
    failed++;
    console.log(`  ✗ ${roundTripChecked.toLocaleString()} 筆中有 ${roundTripFailed} 筆不一致`);
}

/* ------------------------------------------------------------ */
console.log('\n============================================');
console.log(`   通過 ${passed} 項 / 失敗 ${failed} 項`);
console.log('============================================\n');
process.exit(failed ? 1 : 0);
