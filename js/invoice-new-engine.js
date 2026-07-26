/**
 * 發票開立小幫手 - 新版引擎（測試版）
 * ============================================================
 * 設計重點
 *  1. 單一資料來源：畫面上所有數字都由 state.items 正向算出來，
 *     不會出現「反推完之後明細和總計對不起來」的狀況。
 *  2. 擬真發票依實際三聯式／二聯式發票重畫，用 SVG 產生 ——
 *     預覽、放大、存圖三者共用同一份輸出，不可能發生
 *     「螢幕上對、存出來的圖卻是舊的」。
 *  3. 數字一律走自製鍵盤；文字關在彈窗裡，系統鍵盤彈出時
 *     由 visualViewport 重新定位彈窗，底層版面一格都不動。
 *  4. 稅別固定應稅 5%。重車租賃實務上不會遇到零稅率或免稅，
 *     多一個切換只會佔版面又多一個選錯的機會。
 * ============================================================
 */

'use strict';

/* ============================================================
   狀態
   ============================================================ */
const state = {
    type: '3',          // '3' 三聯式（開給公司）/ '2' 二聯式（開給個人）
    taxId: '',
    title: '',
    date: null,         // {y,m,d} 民國年。null 代表跟著今天走
    items: [{ name: '租賃價款', qty: 1, price: 0 }],

    /**
     * 使用者用「由含稅總額反推」指定的總計。
     *
     * 為什麼需要這個欄位：合約上寫的含稅總價是死的（例如 1,050,000），
     * 但 round(總價/1.05) 再乘回去不一定剛好回到原數 —— 實測每 21 個
     * 金額就有 1 個會差 1 元。真正的發票是「總計 − 銷售額 ＝ 稅額」，
     * 稅額本來就允許 ±1 的進位差，不是硬性等於 銷售額×5%。
     * 所以反推時把使用者指定的總計記下來，讓稅額去吸收那 1 元，
     * 業務抄上去的三個數字才會剛好相加等於合約金額。
     * 只要動到任何品項就作廢，避免明細改了總計卻沒跟著動。
     */
    lockTotal: null
};

const TAX_RATE = 0.05;
const MAX_ITEMS = 5;          // 發票紙上實際只印得下 5 行，多了業務也抄不上去
const MAX_AMOUNT = 999999999; // 9 位數，與發票大寫格位數相同

/* 常用品名。使用者自訂過的會累積進 localStorage，越用越順手 */
const DEFAULT_ITEM_NAMES = [
    '租賃價款', '分期價款', '車輛買賣價金', '手續費',
    '利息', '代辦費', '保險費', '過戶費', '違約金'
];

const LS_ITEM_NAMES = 'invNewItemNames';
const LS_CUSTOMERS  = 'invNewCustomers';
const LS_HISTORY    = 'invNewHistory';

/* ============================================================
   小工具
   ============================================================ */
function vibrate(p = 30) {
    if (navigator && navigator.vibrate) navigator.vibrate(p);
}

function $(id) { return document.getElementById(id); }

function fmt(n) { return (n || 0).toLocaleString('en-US'); }

function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function showToast(msg, isError = false, duration = 2200) {
    const old = document.querySelector('.toast-message');
    if (old && old.parentNode) old.parentNode.removeChild(old);

    const t = document.createElement('div');
    t.className = 'toast-message' + (isError ? ' toast-error' : '');
    t.textContent = msg;
    document.body.appendChild(t);

    setTimeout(() => {
        t.style.opacity = '0';
        setTimeout(() => { if (t.parentNode) t.parentNode.removeChild(t); }, 450);
    }, duration);
}

function loadJSON(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; }
    catch (e) { return fallback; }
}

/* ============================================================
   日期（民國）
   ============================================================ */
function todayROC() {
    const d = new Date();
    return { y: d.getFullYear() - 1911, m: d.getMonth() + 1, d: d.getDate() };
}

function curDate() { return state.date || todayROC(); }

function daysInMonth(rocY, m) {
    return new Date(rocY + 1911, m, 0).getDate();
}

const CN_NUM = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const CN_MONTH = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];

function rocYearCN(y) {
    return String(y).split('').map(c => CN_NUM[+c]).join('');
}

/**
 * 發票本的期別。統一發票是雙月一期（一、二月份／三、四月份…），
 * 這行字是印在發票本上的，業務不用寫，但看得到才知道自己拿對本子。
 */
function periodCN(dt) {
    const start = dt.m % 2 === 1 ? dt.m : dt.m - 1;
    return `${rocYearCN(dt.y)}年　${CN_MONTH[start]}、${CN_MONTH[start + 1]}月份`;
}

/* ============================================================
   國字大寫（格位式）
   ------------------------------------------------------------
   真實手開發票上，「億 仟 佰 拾 萬 仟 佰 拾 元」這九個單位字
   是印在發票上的，手寫只是在每個單位「前面」補一個數字，
   而且用不到的高位單位要用線劃掉。

   所以 1,416,608 的實際寫法是：
       億  仟   佰 拾 萬 仟 佰 拾 元      ← 印好的
       ──  ──   壹 肆 壹 陸 陸 零 捌      ← 前兩格劃掉，其餘每格填一個
   讀作「壹佰肆拾壹萬陸仟陸佰零拾捌元」。

   請注意「零拾」那一格也要寫零 —— 這跟一般中文大寫（會直接省略）
   不一樣。照一般寫法抄上去，格子數會對不起來。
   ============================================================ */
const UP_DIGITS = ['零', '壹', '貳', '參', '肆', '伍', '陸', '柒', '捌', '玖'];
const UP_UNITS  = ['億', '仟', '佰', '拾', '萬', '仟', '佰', '拾', '元'];

/**
 * 回傳九個格子的內容
 * @returns {Array<{unit:string, digit:string|null}>} digit 為 null 代表這格要劃掉
 */
function upperSlots(total) {
    const n = Math.max(0, Math.floor(total || 0));
    const s = String(Math.min(n, MAX_AMOUNT));
    const used = (n === 0) ? 0 : s.length;
    const off = UP_UNITS.length - used;       // 前面幾格用不到

    return UP_UNITS.map((u, i) => ({
        unit: u,
        digit: i < off ? null : UP_DIGITS[+s[i - off]]
    }));
}

/* ============================================================
   統一編號檢查碼
   ------------------------------------------------------------
   純本地運算、不需要網路，卻是最能防止「寫錯」的一道關卡：
   隨便打 8 個數字有八成以上會被擋下來。
   規則：權重 [1,2,1,2,1,2,4,1]，各乘積取「個位+十位」後加總，
   總和被 5 整除即有效；第 7 碼為 7 時，總和+1 被 5 整除也算有效。
   ============================================================ */
function validateTaxId(id) {
    if (!/^\d{8}$/.test(id)) return false;
    const w = [1, 2, 1, 2, 1, 2, 4, 1];
    let sum = 0;
    for (let i = 0; i < 8; i++) {
        const p = (+id[i]) * w[i];
        sum += Math.floor(p / 10) + (p % 10);
    }
    if (sum % 5 === 0) return true;
    return id[6] === '7' && (sum + 1) % 5 === 0;
}

/* ============================================================
   金額計算
   ------------------------------------------------------------
   三聯式：單價是「未稅」，銷售額 = Σ(數量×單價)，稅額另計。
   二聯式：單價是「含稅」，Σ 出來就是總計，銷售額與稅額是倒推出來的
           （發票上不用寫，但業務核對時看得到比較安心）。
   ============================================================ */
function calc() {
    const sum = state.items.reduce((a, it) => a + (it.qty || 0) * (it.price || 0), 0);

    if (state.type === '3') {
        let tax = Math.round(sum * TAX_RATE);
        // 使用者指定過含稅總計時，讓稅額吸收四捨五入的 1 元差，
        // 這樣「銷售額 ＋ 稅額 ＝ 總計」在發票上永遠是對得起來的。
        // 超過 1 元代表明細已經被改過，指定值作廢，回到正算。
        if (state.lockTotal !== null) {
            const t = state.lockTotal - sum;
            if (t >= 0 && Math.abs(t - tax) <= 1) tax = t;
        }
        return { sales: sum, tax: tax, total: sum + tax };
    }

    const sales = Math.round(sum / (1 + TAX_RATE));
    return { sales: sales, tax: sum - sales, total: sum };
}

/* ============================================================
   畫面渲染
   ============================================================ */

/**
 * 改過明細之後要走這個，而不是直接 render()。
 * 它會作廢先前反推指定的總計 —— 否則會出現「單價改了、總計卻沒動」
 * 這種業務照著抄就一定錯的畫面。
 */
function touch() {
    state.lockTotal = null;
    render();
}

function render() {
    renderSegments();
    renderBuyer();
    renderItems();
    renderAmounts();
    renderPreview();
}

function renderSegments() {
    $('segType').querySelectorAll('button').forEach(b =>
        b.classList.toggle('active', b.dataset.v === state.type));

    const two = (state.type === '2');
    $('rowTaxId').style.display = two ? 'none' : 'flex';
    $('buyerHint').textContent = two ? '開給個人（免統編）' : '開給公司行號';
    $('itemHint').textContent = two ? '單價為含稅' : '單價為未稅';

    // 二聯式發票上只需要抄「總計」，銷售額與稅額淡化處理，減少誤抄
    $('rowSales').classList.toggle('muted', two);
    $('rowTax').classList.toggle('muted', two);
    $('rowSales').querySelector('.k').textContent = two ? '銷售額（倒推）' : '銷售額（未稅）';
    $('kTax').textContent = two ? '營業稅額（倒推）' : '營業稅額 5%';
}

function renderBuyer() {
    const t = $('fTaxId');
    if (state.taxId) {
        t.textContent = state.taxId;
        t.classList.remove('empty');
    } else {
        t.textContent = t.dataset.ph;
        t.classList.add('empty');
    }

    const st = $('taxIdState');
    if (!state.taxId) {
        st.textContent = ''; st.className = 'tax-id-state';
    } else if (state.taxId.length < 8) {
        st.textContent = '…'; st.className = 'tax-id-state';
    } else if (validateTaxId(state.taxId)) {
        st.textContent = '✓'; st.className = 'tax-id-state ok';
    } else {
        st.textContent = '✕'; st.className = 'tax-id-state bad';
    }

    const ti = $('fTitle');
    if (state.title) {
        ti.textContent = state.title;
        ti.classList.remove('empty');
    } else {
        ti.textContent = ti.dataset.ph;
        ti.classList.add('empty');
    }
}

function renderItems() {
    const wrap = $('itemList');
    wrap.innerHTML = '';

    state.items.forEach((it, i) => {
        const amt = (it.qty || 0) * (it.price || 0);
        const el = document.createElement('div');
        el.className = 'item';
        el.innerHTML = `
            <div class="item-head">
                <span class="item-no">${i + 1}</span>
                <div class="box ${it.name ? '' : 'empty'}" data-act="name" data-i="${i}">${esc(it.name || '點此輸入品名')}</div>
                <button class="item-del" data-act="del" data-i="${i}">×</button>
            </div>
            <div class="item-calc">
                <span class="mini-lbl">數量</span>
                <div class="box num qty" data-act="qty" data-i="${i}">${it.qty || 0}</div>
                <span class="op">×</span>
                <div class="box num up" data-act="price" data-i="${i}">${fmt(it.price)}</div>
                <span class="op">＝</span>
                <div class="box num amt" data-act="amt" data-i="${i}">${fmt(amt)}</div>
            </div>`;
        wrap.appendChild(el);
    });

    $('btnAddItem').style.display = state.items.length >= MAX_ITEMS ? 'none' : 'block';
}

function renderAmounts() {
    const r = calc();
    $('vSales').textContent = fmt(r.sales);
    $('vTax').textContent = fmt(r.tax);
    $('vTotal').textContent = fmt(r.total);

    // 九宮格大寫，排法與擬真圖完全一致
    $('vUpper').innerHTML = upperSlots(r.total).map(s =>
        `<span class="uslot${s.digit === null ? ' off' : ''}">` +
        `<b>${s.digit === null ? '' : s.digit}</b><i>${s.unit}</i></span>`
    ).join('');
}

/* ============================================================
   擬真發票 SVG
   ------------------------------------------------------------
   版面依實際三聯式／二聯式發票重畫，包含：
     - 左上角字軌號碼、標題下方的期別（發票本已印，業務不用寫）
     - 地址列（實務上可省略，畫線劃掉並標註）
     - 很寬的備註欄，右下是蓋章位置，附「記得蓋發票章」提醒
     - 營業稅的應稅／零稅率／免稅是三格小表格，不是一排勾選框
     - 空白品項列在金額欄畫斜線註銷
     - 大寫採格位式：印好的單位字 + 手寫數字 + 高位劃掉

   顏色約定：
     深藍 = 要動筆寫的　黑 = 發票已印好的框線與欄位名　灰 = 已印好的內容
   ============================================================ */
const INK  = '#123fc8';   // 要動筆填的內容
const PRT  = '#111111';   // 發票上已經印好的框線與欄位名
const PRE  = '#8a8a8a';   // 發票上已經印好、業務不用管的內容
const STAMP_BG = '#eaf1ff';
const STAMP_FG = '#4a7fd4';

const NAT_W_3 = 820, NAT_H_3 = 515;
const NAT_W_2 = 700, NAT_H_2 = 432;

/**
 * 依可用寬度自動縮字級
 *
 * SVG 的 <text> 不會自己換行也不會自己截斷，字太長就直接壓過隔壁欄位。
 * 客戶抬頭動輒二十幾個字（「○○股份有限公司台北分公司營業處」），
 * 品名還常常要帶車號，固定字級一定會撞到。
 * 中文字寬約等於字級，英數字約 0.55 倍，用這個比例估寬度就夠準了。
 */
function fitSize(s, maxPx, base) {
    const units = Array.from(String(s || '')).reduce(
        (a, c) => a + (/[\x00-\xff]/.test(c) ? 0.55 : 1), 0);
    if (units <= 0) return base;
    return Math.max(8, Math.min(base, maxPx / units));
}

function svgText(x, y, s, opt) {
    const o = opt || {};
    const ls = o.ls ? ` letter-spacing="${o.ls}"` : '';
    return `<text x="${x}" y="${y}" font-size="${o.size || 13}" fill="${o.fill || PRT}"` +
           ` text-anchor="${o.anchor || 'start'}" font-weight="${o.weight || 'normal'}"${ls}>${esc(s)}</text>`;
}

function svgLine(x1, y1, x2, y2, w, color, dash) {
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color || PRT}"` +
           ` stroke-width="${w || 1}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
}

function svgRect(x, y, w, h, sw, color, fill, rx) {
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill || 'none'}"` +
           ` stroke="${color || PRT}" stroke-width="${sw || 1}"${rx ? ` rx="${rx}"` : ''}/>`;
}

/** 透明熱區，讓 SVG 內的欄位可以被點擊（目前用於日期） */
function hotspot(name, x, y, w, h, inner) {
    return `<g data-hot="${name}">` +
           `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#ffffff" fill-opacity="0"/>` +
           inner + `</g>`;
}

/** 蓋章區。真實發票右下角這一大塊是留給統一發票專用章的，不能填別的東西 */
function stampArea(cx, top, w, h) {
    let s = svgText(cx, top + 16, '營業人蓋用統一發票專用章', { anchor: 'middle', size: 10.5 });
    const bw = Math.min(w - 30, 158), bh = Math.min(h - 40, 100);
    const bx = cx - bw / 2, by = top + 28;
    s += svgRect(bx, by, bw, bh, 1.5, '#9bb8e8', STAMP_BG, 6);
    s += svgLine(bx, by, bx + bw, by, 1.5, '#9bb8e8', '5 4');
    s += svgText(cx, by + bh / 2 - 2, '記得蓋', { anchor: 'middle', size: 20, fill: STAMP_FG, weight: 'bold' });
    s += svgText(cx, by + bh / 2 + 24, '發票章', { anchor: 'middle', size: 20, fill: STAMP_FG, weight: 'bold' });
    return s;
}

/** 中文大寫格位列 */
function upperRow(x0, y0, w, h, total, slotW) {
    let s = '';
    s += svgText(x0 + 8, y0 + 16, '總計新臺幣', { size: 10 });
    s += svgText(x0 + 8, y0 + 29, '（中文大寫）', { size: 10 });

    const slots = upperSlots(total);
    const startX = x0 + w - slotW * 9 - 10;
    const baseY = y0 + h - 11;

    let offCount = 0;
    slots.forEach((sl, i) => {
        const cx = startX + i * slotW;
        if (sl.digit === null) {
            offCount++;
        } else {
            s += svgText(cx + slotW * 0.3, baseY, sl.digit,
                { anchor: 'middle', size: slotW * 0.29, fill: INK, weight: 'bold' });
        }
        s += svgText(cx + slotW * 0.72, baseY, sl.unit, { anchor: 'middle', size: slotW * 0.24 });
    });

    // 用不到的高位單位要劃掉，這是發票上實際的做法
    if (offCount > 0 && total > 0) {
        s += svgLine(startX + 2, baseY - 6, startX + offCount * slotW - 4, baseY - 6, 2, INK);
    }
    return s;
}

/** 空白品項列在金額欄畫斜線註銷，避免事後被人補填 */
function voidSlash(xL, xR, yTop, yBottom) {
    if (yTop >= yBottom - 2) return '';
    return svgLine(xR, yTop, xL, yBottom, 1.2);
}

/* ---------- 三聯式 ---------- */
function buildSvg3() {
    const W = NAT_W_3, H = NAT_H_3;
    const r = calc();
    const dt = curDate();

    let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="'Microsoft JhengHei','PingFang TC','Heiti TC',sans-serif">`;
    s += `<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`;
    s += svgRect(14, 14, W - 28, H - 28, 2);

    // --- 表頭（全部是發票本已印好的，業務不用寫）---
    s += svgText(40, 48, '＿＿  ＿＿＿＿＿＿＿＿', { size: 15, fill: PRE });
    s += svgText(40, 62, '字軌號碼（已印）', { size: 9, fill: PRE });
    s += svgText(W / 2, 50, '統一發票（三聯式）', { anchor: 'middle', size: 25, weight: 'bold', ls: 6 });
    s += svgText(W / 2, 74, periodCN(dt), { anchor: 'middle', size: 14, fill: PRE });

    // --- 買受人 ---
    s += svgText(40, 104, '買 受 人：', { size: 13 });
    s += svgText(118, 104, state.title || '＿＿＿＿＿＿＿＿＿＿＿＿',
        { size: fitSize(state.title, 300, 15), fill: state.title ? INK : '#c4c4c4' });

    // --- 統一編號（8 格）+ 日期 ---
    s += svgText(40, 132, '統一編號：', { size: 13 });
    const tid = state.taxId || '';
    for (let i = 0; i < 8; i++) {
        const bx = 118 + i * 26;
        s += svgRect(bx, 115, 24, 22, 1.2);
        if (tid[i]) s += svgText(bx + 12, 132, tid[i], { anchor: 'middle', size: 16, fill: INK, weight: 'bold' });
    }

    // 日期是熱區：民國年月日在真實發票上只有「中華民國」與年份是印好的，
    // 月、日要手寫。這裡整組都做成可點，改一次三個欄位一起更新。
    let dateInner = '';
    dateInner += svgText(440, 132, '中華民國', { size: 13 });
    dateInner += svgText(510, 132, String(dt.y), { anchor: 'middle', size: 15, fill: INK, weight: 'bold' });
    dateInner += svgText(530, 132, '年', { size: 13 });
    dateInner += svgText(568, 132, String(dt.m), { anchor: 'middle', size: 15, fill: INK, weight: 'bold' });
    dateInner += svgText(584, 132, '月', { size: 13 });
    dateInner += svgText(622, 132, String(dt.d), { anchor: 'middle', size: 15, fill: INK, weight: 'bold' });
    dateInner += svgText(638, 132, '日', { size: 13 });
    dateInner += svgLine(436, 139, 656, 139, 1, '#ff9c33', '3 3');
    dateInner += svgText(662, 132, '點我改', { size: 10, fill: '#ff9c33' });
    s += hotspot('date', 430, 112, 250, 32, dateInner);

    // --- 地址列（實務上可省略，直接劃掉並標註）---
    s += svgText(40, 160, '地　　址：', { size: 13, fill: PRE });
    s += svgText(118, 160, '縣市　　鄉鎮市區　　路街　段　巷　弄　號　樓　室', { size: 12, fill: PRE });
    s += svgLine(112, 156, 700, 156, 3, '#f0b878');
    s += svgText(710, 160, '可省略', { size: 12, fill: '#e08a2e', weight: 'bold' });

    // --- 明細表 ---
    const TY = 174, HH = 24, RH = 26, ROWS = MAX_ITEMS;
    const cols = [40, 250, 320, 410, 570, 780];
    const heads = ['品　　名', '數 量', '單 價', '金 額', '備　註'];
    const bodyTop = TY + HH;
    const bodyBot = bodyTop + ROWS * RH;        // 330

    const SY1 = bodyBot;             // 銷售額合計
    const SY2 = SY1 + 26;            // 營業稅（含 3 格小表格）
    const SY3 = SY2 + 36;            // 總計
    const SEND = SY3 + 26;           // 合計區結束 = 備註欄底部
    const UY = SEND;                 // 大寫列
    const UH = 38;

    // 外框：表頭 + 品項 + 合計三段，備註欄一路貫通到底
    s += svgRect(cols[0], TY, cols[5] - cols[0], SEND - TY, 1.5);
    s += svgLine(cols[0], bodyTop, cols[5], bodyTop, 1.5);

    // 直線：品名~金額的分隔只到合計區上緣；備註欄的直線貫通到底
    for (let i = 1; i <= 3; i++) s += svgLine(cols[i], TY, cols[i], bodyBot, 1);
    s += svgLine(cols[4], TY, cols[4], SEND, 1.5);

    // 品項橫線
    for (let i = 1; i < ROWS; i++) s += svgLine(cols[0], bodyTop + RH * i, cols[4], bodyTop + RH * i, 0.6);
    // 合計區橫線（只到備註欄左緣）
    [SY1, SY2, SY3].forEach(y => s += svgLine(cols[0], y, cols[4], y, 1));

    heads.forEach((h, i) => {
        s += svgText((cols[i] + cols[i + 1]) / 2, TY + 17, h, { anchor: 'middle', size: 12.5, weight: 'bold' });
    });

    // 品項內容
    state.items.forEach((it, i) => {
        if (i >= ROWS) return;
        const y = bodyTop + RH * i + 18;
        if (it.name)  s += svgText(cols[0] + 8, y, it.name, { size: fitSize(it.name, cols[1] - cols[0] - 16, 13.5), fill: INK });
        if (it.qty)   s += svgText(cols[2] - 8, y, String(it.qty), { anchor: 'end', size: 13.5, fill: INK });
        if (it.price) s += svgText(cols[3] - 8, y, fmt(it.price), { anchor: 'end', size: 13.5, fill: INK });
        const amt = (it.qty || 0) * (it.price || 0);
        if (amt)      s += svgText(cols[4] - 8, y, fmt(amt), { anchor: 'end', size: 13.5, fill: INK });
    });
    s += voidSlash(cols[3], cols[4], bodyTop + RH * state.items.length, bodyBot);

    // 備註欄（蓋章區）
    s += stampArea((cols[4] + cols[5]) / 2, TY + HH + 6, cols[5] - cols[4], SEND - TY - HH - 6);

    // 銷售額合計
    s += svgText(cols[0] + 10, SY1 + 18, '銷 售 額 合 計', { size: 12.5, weight: 'bold' });
    s += svgText(cols[4] - 8, SY1 + 18, fmt(r.sales), { anchor: 'end', size: 15, fill: INK, weight: 'bold' });

    // 營業稅：真實發票是「應稅｜零稅率｜免稅」三格小表格，在對應格子打勾
    s += svgText(cols[0] + 10, SY2 + 24, '營 業 稅', { size: 12.5, weight: 'bold' });
    const mx = [150, 236, 322, 408], mMid = SY2 + 17;
    s += svgRect(mx[0], SY2, mx[3] - mx[0], 36, 1);
    s += svgLine(mx[0], mMid, mx[3], mMid, 1);
    for (let i = 1; i <= 2; i++) s += svgLine(mx[i], SY2, mx[i], SY2 + 36, 1);
    ['應 稅', '零稅率', '免 稅'].forEach((t, i) => {
        s += svgText((mx[i] + mx[i + 1]) / 2, SY2 + 13, t, { anchor: 'middle', size: 11 });
    });
    // 固定應稅 5%，勾在第一格
    s += `<path d="M${(mx[0] + mx[1]) / 2 - 7},${mMid + 11} L${(mx[0] + mx[1]) / 2 - 2},${mMid + 15} L${(mx[0] + mx[1]) / 2 + 8},${mMid + 5}" fill="none" stroke="${INK}" stroke-width="2.5"/>`;
    s += svgText(cols[4] - 8, SY2 + 24, fmt(r.tax), { anchor: 'end', size: 15, fill: INK, weight: 'bold' });

    // 總計
    s += svgText(cols[0] + 10, SY3 + 18, '總　　　　計', { size: 12.5, weight: 'bold' });
    s += svgText(cols[4] - 8, SY3 + 18, fmt(r.total), { anchor: 'end', size: 16, fill: INK, weight: 'bold' });

    // 大寫格位列
    s += svgRect(cols[0], UY, cols[5] - cols[0], UH, 1.5);
    s += upperRow(cols[0], UY, cols[5] - cols[0], UH, r.total, 68);

    // 底部
    s += svgText(40, UY + UH + 20, '※應稅、零稅率、免稅之銷售額應分別開立統一發票，並應於各該欄打「√」。', { size: 10, fill: '#666666' });
    s += svgText(780, UY + UH + 20, '第 一 聯　存 根 聯', { anchor: 'end', size: 11 });
    s += svgText(40, UY + UH + 40, '藍字＝需要動筆填寫　　灰字＝發票本已印好，不用寫', { size: 10.5, fill: INK });
    s += svgText(780, UY + UH + 40, '存根聯自存，扣抵聯與收執聯交給買受人', { anchor: 'end', size: 10, fill: '#666666' });

    s += '</svg>';
    return s;
}

/* ---------- 二聯式 ---------- */
function buildSvg2() {
    const W = NAT_W_2, H = NAT_H_2;
    const r = calc();
    const dt = curDate();

    let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="'Microsoft JhengHei','PingFang TC','Heiti TC',sans-serif">`;
    s += `<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`;
    s += svgRect(14, 14, W - 28, H - 28, 2);

    s += svgText(36, 48, '＿＿  ＿＿＿＿＿＿＿＿', { size: 15, fill: PRE });
    s += svgText(36, 62, '字軌號碼（已印）', { size: 9, fill: PRE });
    s += svgText(W / 2, 50, '統一發票（二聯式）', { anchor: 'middle', size: 25, weight: 'bold', ls: 6 });
    s += svgText(W / 2, 74, periodCN(dt), { anchor: 'middle', size: 14, fill: PRE });

    s += svgText(36, 106, '買 受 人：', { size: 13 });
    s += svgText(114, 106, state.title || '＿＿＿＿＿＿＿＿',
        { size: fitSize(state.title, 210, 15), fill: state.title ? INK : '#c4c4c4' });

    let dateInner = '';
    dateInner += svgText(370, 106, '中華民國', { size: 13 });
    dateInner += svgText(440, 106, String(dt.y), { anchor: 'middle', size: 15, fill: INK, weight: 'bold' });
    dateInner += svgText(460, 106, '年', { size: 13 });
    dateInner += svgText(498, 106, String(dt.m), { anchor: 'middle', size: 15, fill: INK, weight: 'bold' });
    dateInner += svgText(514, 106, '月', { size: 13 });
    dateInner += svgText(552, 106, String(dt.d), { anchor: 'middle', size: 15, fill: INK, weight: 'bold' });
    dateInner += svgText(568, 106, '日', { size: 13 });
    dateInner += svgLine(366, 113, 586, 113, 1, '#ff9c33', '3 3');
    dateInner += svgText(592, 106, '點我改', { size: 10, fill: '#ff9c33' });
    s += hotspot('date', 360, 86, 250, 32, dateInner);

    const TY = 126, HH = 24, RH = 26, ROWS = MAX_ITEMS;
    const cols = [36, 236, 300, 385, 520, 664];
    const heads = ['品　　名', '數 量', '單 價', '金 額', '備　註'];
    const bodyTop = TY + HH;
    const bodyBot = bodyTop + ROWS * RH;

    const SY1 = bodyBot;         // 總計（二聯式發票上只有這一列，單價本身就含稅）
    const SEND = SY1 + 28;
    const UY = SEND, UH = 38;

    s += svgRect(cols[0], TY, cols[5] - cols[0], SEND - TY, 1.5);
    s += svgLine(cols[0], bodyTop, cols[5], bodyTop, 1.5);
    for (let i = 1; i <= 3; i++) s += svgLine(cols[i], TY, cols[i], bodyBot, 1);
    s += svgLine(cols[4], TY, cols[4], SEND, 1.5);
    for (let i = 1; i < ROWS; i++) s += svgLine(cols[0], bodyTop + RH * i, cols[4], bodyTop + RH * i, 0.6);
    s += svgLine(cols[0], SY1, cols[4], SY1, 1);

    heads.forEach((h, i) => {
        s += svgText((cols[i] + cols[i + 1]) / 2, TY + 17, h, { anchor: 'middle', size: 12.5, weight: 'bold' });
    });

    state.items.forEach((it, i) => {
        if (i >= ROWS) return;
        const y = bodyTop + RH * i + 18;
        if (it.name)  s += svgText(cols[0] + 8, y, it.name, { size: fitSize(it.name, cols[1] - cols[0] - 16, 13.5), fill: INK });
        if (it.qty)   s += svgText(cols[2] - 8, y, String(it.qty), { anchor: 'end', size: 13.5, fill: INK });
        if (it.price) s += svgText(cols[3] - 8, y, fmt(it.price), { anchor: 'end', size: 13.5, fill: INK });
        const amt = (it.qty || 0) * (it.price || 0);
        if (amt)      s += svgText(cols[4] - 8, y, fmt(amt), { anchor: 'end', size: 13.5, fill: INK });
    });
    s += voidSlash(cols[3], cols[4], bodyTop + RH * state.items.length, bodyBot);

    s += stampArea((cols[4] + cols[5]) / 2, TY + HH + 6, cols[5] - cols[4], SEND - TY - HH - 6);

    s += svgText(cols[0] + 10, SY1 + 19, '總　　　　計', { size: 12.5, weight: 'bold' });
    s += svgText(cols[4] - 8, SY1 + 19, fmt(r.total), { anchor: 'end', size: 16, fill: INK, weight: 'bold' });

    s += svgRect(cols[0], UY, cols[5] - cols[0], UH, 1.5);
    s += upperRow(cols[0], UY, cols[5] - cols[0], UH, r.total, 57);

    s += svgText(36, UY + UH + 20, '※二聯式發票開給個人，金額為含稅價，不另列稅額。', { size: 10, fill: '#666666' });
    s += svgText(664, UY + UH + 20, '第 一 聯　存 根 聯', { anchor: 'end', size: 11 });
    s += svgText(36, UY + UH + 40, '藍字＝需要動筆填寫　　灰字＝發票本已印好，不用寫', { size: 10.5, fill: INK });

    s += '</svg>';
    return s;
}

function buildSvg() {
    return state.type === '3' ? buildSvg3() : buildSvg2();
}

function natSize() {
    return state.type === '3'
        ? { w: NAT_W_3, h: NAT_H_3 }
        : { w: NAT_W_2, h: NAT_H_2 };
}

function renderPreview() {
    $('previewWrap').innerHTML = buildSvg();
}

/* ============================================================
   全螢幕放大
   ------------------------------------------------------------
   發票本身是橫的。判斷依據刻意用「可用區域的長寬比」而不是
   「是不是手機」：桌機、平板、手機轉向全部自動正確，
   也不會因為裝置判斷失準而轉錯方向。
   ============================================================ */
const zoom = { rot: 0, scale: 1 };

function openZoom() {
    $('zoomOverlay').classList.add('show');
    const stage = $('zoomStage');
    // 可用區域是直的（手機直握）才轉 90 度，把螢幕長邊讓給發票寬邊
    zoom.rot = stage.clientWidth >= stage.clientHeight ? 0 : 90;
    fitZoom();
    vibrate(30);
}

function closeZoom() { $('zoomOverlay').classList.remove('show'); }

function applyZoom() {
    const n = natSize();
    const s = zoom.scale;
    const paper = $('zoomPaper');
    const svg = buildSvg();

    if (zoom.rot === 90) {
        // 以左上角為原點旋轉後再平移回可視範圍，
        // 這樣外框的寬高剛好等於旋轉後的實際佔位，捲動才會正確。
        paper.style.width = (n.h * s) + 'px';
        paper.style.height = (n.w * s) + 'px';
        paper.innerHTML = `<div style="width:${n.w}px;height:${n.h}px;transform-origin:0 0;transform:translate(${n.h * s}px,0) rotate(90deg) scale(${s});">${svg}</div>`;
    } else {
        paper.style.width = (n.w * s) + 'px';
        paper.style.height = (n.h * s) + 'px';
        paper.innerHTML = `<div style="width:${n.w}px;height:${n.h}px;transform-origin:0 0;transform:scale(${s});">${svg}</div>`;
    }
}

function fitZoom() {
    const stage = $('zoomStage');
    const n = natSize();
    const availW = stage.clientWidth - 8;
    const availH = stage.clientHeight - 64;   // 扣掉底部工具列
    const w = zoom.rot === 90 ? n.h : n.w;
    const h = zoom.rot === 90 ? n.w : n.h;
    zoom.scale = Math.min(availW / w, availH / h);
    applyZoom();
}

/* ============================================================
   自製數字鍵盤
   ------------------------------------------------------------
   金額 / 數量 / 統編全部走這裡，永遠不會叫出系統鍵盤。
   數字鍵同時標阿拉伯數字與國字大寫，按的當下就順便對照怎麼寫。
   ============================================================ */
const pad = { buf: '', max: 9, onOk: null, mode: 'amount' };

function openPad(opts) {
    pad.buf = opts.value ? String(opts.value) : '';
    pad.max = opts.max || 9;
    pad.mode = opts.mode || 'amount';
    pad.onOk = opts.onOk;

    $('padTitle').textContent = opts.title || '輸入';
    buildPadKeys();
    updatePad();
    $('padModal').classList.add('show');
    vibrate(30);
}

function closePad() {
    $('padModal').classList.remove('show');
    pad.onOk = null;
}

function buildPadKeys() {
    const key = d => `<button class="key" data-k="${d}"><span class="an">${d}</span><span class="fc">${UP_DIGITS[d]}</span></button>`;
    let h = '';
    h += `<div class="pad-line">${key(7)}${key(8)}${key(9)}</div>`;
    h += `<div class="pad-line">${key(4)}${key(5)}${key(6)}</div>`;
    h += `<div class="pad-line">${key(1)}${key(2)}${key(3)}</div>`;
    h += `<div class="pad-line"><button class="key fn" data-k="C">清除</button>${key(0)}<button class="key fn" data-k="B">退回</button></div>`;

    // 金額欄位補上「000」「萬」快捷 —— 這行業的金額幾乎都是整萬整千
    if (pad.mode === 'amount') {
        h += `<div class="pad-line">
                <button class="key op" data-k="000">000</button>
                <button class="key op" data-k="0000">萬</button>
                <button class="key ok" data-k="OK">確定</button>
              </div>`;
    } else {
        h += `<div class="pad-line"><button class="key ok" data-k="OK">確定</button></div>`;
    }
    $('padGrid').innerHTML = h;
}

function updatePad() {
    const v = pad.buf === '' ? 0 : parseInt(pad.buf, 10);
    $('padDisp').textContent = pad.mode === 'taxid' ? (pad.buf || '　') : fmt(v);
    $('padSub').textContent = (pad.mode === 'amount' && v > 0)
        ? upperSlots(v).filter(s => s.digit !== null).map(s => s.digit + s.unit).join('')
        : '';
}

function padKey(k) {
    if (k === 'C') { pad.buf = ''; vibrate([40, 40]); }
    else if (k === 'B') { pad.buf = pad.buf.slice(0, -1); vibrate(40); }
    else if (k === 'OK') {
        const v = pad.buf === '' ? 0 : parseInt(pad.buf, 10);
        const cb = pad.onOk;
        const raw = pad.buf;
        closePad();
        if (cb) cb(v, raw);
        vibrate([40, 60]);
        return;
    } else {
        if (pad.buf === '' && k.startsWith('0') && k.length > 1) return;  // 開頭不給補零
        if ((pad.buf + k).length > pad.max) {
            showToast(`最多 ${pad.max} 位數`, true);
            vibrate([50, 30, 50]);
            return;
        }
        pad.buf = (pad.buf === '0' ? '' : pad.buf) + k;
        vibrate(30);
    }
    updatePad();
}

/* ============================================================
   文字輸入彈窗
   ------------------------------------------------------------
   這是整頁唯一會叫出系統鍵盤的地方。做法：
     - 底層被 position:fixed 的全屏遮罩蓋住 → 主畫面完全不會被推動
     - 彈窗位置由 visualViewport.height 動態計算 → 鍵盤多高都不會被蓋住
     - 上方常用詞一點即填即關 → 大多數情況根本不會叫到鍵盤
     - input 的 font-size 固定 16px → 避免 iOS 自動放大整頁
   ============================================================ */
let txtState = null;

function openText(opts) {
    txtState = { onOk: opts.onOk };

    $('txtTitle').textContent = opts.title || '輸入';
    $('txtInput').value = opts.value || '';

    const chips = opts.chips || [];
    $('chipsLabel').style.display = chips.length ? 'block' : 'none';
    $('txtChips').innerHTML = chips.map(c => `<span class="chip">${esc(c)}</span>`).join('');

    $('txtModal').classList.add('show');
    positionText();

    window.addEventListener('resize', positionText);
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', positionText);
        window.visualViewport.addEventListener('scroll', positionText);
    }

    setTimeout(() => $('txtInput').focus(), 50);
    vibrate(30);
}

function positionText() {
    const modal = $('txtModal');
    const panel = $('txtPanel');
    if (!modal.classList.contains('show')) return;

    const vv = window.visualViewport;
    if (!vv) { modal.style.paddingTop = '60px'; return; }

    // vv.height 在鍵盤彈出時會縮小，這是唯一可靠地得知鍵盤高度的方法
    const ph = panel.offsetHeight || 240;
    modal.style.paddingTop = Math.max(10, vv.offsetTop + (vv.height - ph) / 2) + 'px';
}

function closeText() {
    $('txtModal').classList.remove('show');
    $('txtInput').blur();
    window.removeEventListener('resize', positionText);
    if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', positionText);
        window.visualViewport.removeEventListener('scroll', positionText);
    }
    txtState = null;
}

function commitText(val) {
    const cb = txtState && txtState.onOk;
    closeText();
    if (cb) cb((val || '').trim());
}

/* ============================================================
   日期選擇
   ============================================================ */
let dateDraft = null;

function openDate() {
    dateDraft = Object.assign({}, curDate());
    paintDate();
    $('dateModal').classList.add('show');
    vibrate(30);
}

function paintDate() {
    $('dY').textContent = dateDraft.y;
    $('dM').textContent = dateDraft.m;
    $('dD').textContent = dateDraft.d;
}

function stepDate(field, delta) {
    if (field === 'y') dateDraft.y = Math.min(200, Math.max(90, dateDraft.y + delta));
    if (field === 'm') dateDraft.m = ((dateDraft.m - 1 + delta + 12) % 12) + 1;
    if (field === 'd') {
        const max = daysInMonth(dateDraft.y, dateDraft.m);
        dateDraft.d = ((dateDraft.d - 1 + delta + max) % max) + 1;
    }
    // 換月之後日可能超出（例如 1/31 改到 2 月），夾回當月最後一天
    const max = daysInMonth(dateDraft.y, dateDraft.m);
    if (dateDraft.d > max) dateDraft.d = max;
    paintDate();
    vibrate(20);
}

/* ============================================================
   記憶：常用品名 / 客戶名冊
   ------------------------------------------------------------
   統編查詢要連外部 API，收訊差就失效。這裡改用「用過就記住」：
   重車業務回頭客比例高，第二次輸入同一組統編就會自動帶出抬頭，
   完全離線、零失敗。
   ============================================================ */
function itemNameChips() {
    return Array.from(new Set(loadJSON(LS_ITEM_NAMES, []).concat(DEFAULT_ITEM_NAMES))).slice(0, 14);
}

function rememberItemName(name) {
    if (!name || DEFAULT_ITEM_NAMES.includes(name)) return;
    const list = loadJSON(LS_ITEM_NAMES, []).filter(n => n !== name);
    list.unshift(name);
    localStorage.setItem(LS_ITEM_NAMES, JSON.stringify(list.slice(0, 8)));
}

function customerChips() {
    return loadJSON(LS_CUSTOMERS, []).map(c => c.title).slice(0, 8);
}

function rememberCustomer() {
    if (!state.title) return;
    const list = loadJSON(LS_CUSTOMERS, []).filter(c => c.title !== state.title);
    list.unshift({ taxId: state.taxId, title: state.title });
    localStorage.setItem(LS_CUSTOMERS, JSON.stringify(list.slice(0, 20)));
}

function lookupByTaxId(taxId) {
    const hit = loadJSON(LS_CUSTOMERS, []).find(c => c.taxId === taxId);
    return hit ? hit.title : '';
}

function lookupByTitle(title) {
    const hit = loadJSON(LS_CUSTOMERS, []).find(c => c.title === title);
    return hit ? hit.taxId : '';
}

/* ============================================================
   歷史記錄
   ------------------------------------------------------------
   一行一筆：日期、抬頭、總計。點一下整張載回來繼續編輯或再分享一次。
   ============================================================ */
function snapshot() {
    const dt = curDate();
    return {
        id: Date.now(),
        type: state.type,
        taxId: state.taxId,
        title: state.title,
        date: { y: dt.y, m: dt.m, d: dt.d },
        items: state.items.map(it => ({ name: it.name, qty: it.qty, price: it.price })),
        lockTotal: state.lockTotal,
        total: calc().total
    };
}

function saveRecord() {
    const r = calc();
    if (r.total <= 0) { showToast('金額還是 0，沒東西可以存', true); return; }

    const list = loadJSON(LS_HISTORY, []);
    list.unshift(snapshot());
    localStorage.setItem(LS_HISTORY, JSON.stringify(list.slice(0, 100)));
    rememberCustomer();
    showToast('已存檔');
    vibrate([40, 60]);
}

function openHistory() {
    renderHistory();
    $('histSheet').classList.add('show');
    vibrate(30);
}

function renderHistory() {
    const list = loadJSON(LS_HISTORY, []);
    const body = $('histBody');

    if (!list.length) {
        body.innerHTML = '<div class="sheet-empty">還沒有存過任何發票<br>算好之後按右上角「存檔」</div>';
        return;
    }

    body.innerHTML = list.map(rec => {
        const d = rec.date || {};
        return `<div class="hrec" data-id="${rec.id}">
            <div class="hd"><span class="hy">${d.y || ''}/${d.m || ''}/${d.d || ''}</span>${rec.type === '3' ? '三聯式' : '二聯式'}</div>
            <div class="hn">${rec.title ? esc(rec.title) : '<span class="tag">未填抬頭</span>'}</div>
            <div class="ht">${fmt(rec.total)}</div>
            <div class="hx" data-del="${rec.id}">×</div>
        </div>`;
    }).join('');
}

function loadRecord(id) {
    const rec = loadJSON(LS_HISTORY, []).find(r => String(r.id) === String(id));
    if (!rec) return;

    state.type = rec.type === '2' ? '2' : '3';
    state.taxId = rec.taxId || '';
    state.title = rec.title || '';
    state.date = rec.date ? { y: rec.date.y, m: rec.date.m, d: rec.date.d } : null;
    state.items = (rec.items && rec.items.length) ? rec.items.map(it => ({
        name: it.name || '', qty: it.qty || 0, price: it.price || 0
    })) : [{ name: '', qty: 1, price: 0 }];
    state.lockTotal = (typeof rec.lockTotal === 'number') ? rec.lockTotal : null;

    $('histSheet').classList.remove('show');
    render();
    showToast('已載入');
}

function deleteRecord(id) {
    const list = loadJSON(LS_HISTORY, []).filter(r => String(r.id) !== String(id));
    localStorage.setItem(LS_HISTORY, JSON.stringify(list));
    renderHistory();
    vibrate(40);
}

/* ============================================================
   分享網址
   ------------------------------------------------------------
   把整張發票塞進網址的 hash。不需要後端、永久有效，
   同事點開看到的就是同一張範例，離線也開得起來。
   ============================================================ */
function b64encode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    bytes.forEach(b => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64decode(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bytes = Uint8Array.from(atob(s), c => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
}

function encodeState() {
    const dt = curDate();
    // 用短鍵名壓縮長度，網址越短越好傳
    return b64encode(JSON.stringify({
        y: state.type,
        n: state.taxId,
        t: state.title,
        d: [dt.y, dt.m, dt.d],
        i: state.items.map(it => [it.name, it.qty, it.price]),
        k: state.lockTotal          // 一起帶走，同事開起來的稅額才會跟業務看到的完全一樣
    }));
}

function decodeState(code) {
    const o = JSON.parse(b64decode(code));
    state.type = (o.y === '2') ? '2' : '3';
    state.taxId = typeof o.n === 'string' ? o.n.slice(0, 8) : '';
    state.title = typeof o.t === 'string' ? o.t.slice(0, 40) : '';

    if (Array.isArray(o.d) && o.d.length === 3) {
        state.date = { y: +o.d[0] || todayROC().y, m: +o.d[1] || 1, d: +o.d[2] || 1 };
    }
    if (Array.isArray(o.i) && o.i.length) {
        state.items = o.i.slice(0, MAX_ITEMS).map(a => ({
            name: String(a[0] || '').slice(0, 30),
            qty: Math.max(0, Math.min(9999, parseInt(a[1], 10) || 0)),
            price: Math.max(0, Math.min(MAX_AMOUNT, parseInt(a[2], 10) || 0))
        }));
    }
    const k = parseInt(o.k, 10);
    state.lockTotal = (Number.isFinite(k) && k > 0 && k <= MAX_AMOUNT) ? k : null;
}

function shareLink() {
    const url = location.origin + location.pathname + '#inv=' + encodeState();
    const text = `發票開立範例（${state.type === '3' ? '三聯式' : '二聯式'}）總計 ${fmt(calc().total)} 元`;

    if (navigator.share) {
        navigator.share({ title: '發票開立範例', text: text, url: url }).catch(() => {});
        return;
    }
    if (navigator.clipboard) {
        navigator.clipboard.writeText(url)
            .then(() => showToast('連結已複製，可直接貼給同事'))
            .catch(() => showToast('複製失敗，請手動複製網址', true));
        return;
    }
    location.hash = 'inv=' + encodeState();
    showToast('已寫入網址，請從網址列複製');
}

/* ============================================================
   存成圖片
   ------------------------------------------------------------
   把 SVG 畫進 canvas 再輸出 PNG，不依賴任何外部函式庫，
   離線（PWA）也能用。手機上優先走系統分享（可直接送進 LINE 或相簿）。
   ============================================================ */
function saveImage() {
    const n = natSize();
    const scale = 2;                        // 2 倍解析度，同事放大看仍清楚
    const blob = new Blob([buildSvg()], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();

    img.onload = function () {
        const c = document.createElement('canvas');
        c.width = n.w * scale;
        c.height = n.h * scale;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);

        const name = `發票範例_${state.type === '3' ? '三聯式' : '二聯式'}_${calc().total}.png`;

        c.toBlob(function (png) {
            if (!png) { showToast('產生圖片失敗', true); return; }

            const file = new File([png], name, { type: 'image/png' });
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                navigator.share({ files: [file], title: '發票開立範例' }).catch(() => {});
                return;
            }
            const a = document.createElement('a');
            a.href = URL.createObjectURL(png);
            a.download = name;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(a.href), 4000);
            showToast('圖片已下載');
        }, 'image/png');
    };

    img.onerror = function () {
        URL.revokeObjectURL(url);
        showToast('產生圖片失敗', true);
    };

    img.src = url;
}

/* ============================================================
   事件綁定
   ============================================================ */
function bind() {
    // --- 發票種類 ---
    $('segType').addEventListener('click', e => {
        const b = e.target.closest('button');
        if (!b) return;
        state.type = b.dataset.v;
        touch();   // 三聯式的單價是未稅、二聯式是含稅，切換後反推值不再成立
        vibrate(30);
    });

    // --- 統一編號 ---
    $('fTaxId').addEventListener('click', () => {
        openPad({
            title: '統一編號（8 碼）', mode: 'taxid', max: 8, value: state.taxId,
            onOk: (v, raw) => {
                state.taxId = raw || '';
                if (state.taxId.length === 8) {
                    if (!validateTaxId(state.taxId)) {
                        showToast('統編檢查碼不符，請再確認一次', true, 2800);
                    } else if (!state.title) {
                        // 名冊裡有的話直接帶出抬頭，省掉重打
                        const t = lookupByTaxId(state.taxId);
                        if (t) { state.title = t; showToast('已帶出上次的抬頭：' + t); }
                    }
                }
                render();
            }
        });
    });

    // --- 抬頭 ---
    $('fTitle').addEventListener('click', () => {
        openText({
            title: '買受人抬頭', value: state.title, chips: customerChips(),
            onOk: v => {
                state.title = v;
                if (v && !state.taxId) {
                    const id = lookupByTitle(v);
                    if (id) { state.taxId = id; showToast('已帶出上次的統編：' + id); }
                }
                rememberCustomer();
                render();
            }
        });
    });

    // --- 品項 ---
    $('itemList').addEventListener('click', e => {
        const el = e.target.closest('[data-act]');
        if (!el) return;
        const i = +el.dataset.i;
        const it = state.items[i];
        if (!it) return;

        switch (el.dataset.act) {
            // 品名不影響金額，所以用 render() 而非 touch()，
            // 不必因為改個名字就把反推指定的總計作廢
            case 'name':
                openText({
                    title: `第 ${i + 1} 項　品名`, value: it.name, chips: itemNameChips(),
                    onOk: v => { it.name = v; rememberItemName(v); render(); }
                });
                break;

            case 'qty':
                openPad({
                    title: `第 ${i + 1} 項　數量`, mode: 'qty', max: 4, value: it.qty,
                    onOk: v => { it.qty = v; touch(); }
                });
                break;

            case 'price':
                openPad({
                    title: `第 ${i + 1} 項　單價（${state.type === '3' ? '未稅' : '含稅'}）`,
                    mode: 'amount', max: 9, value: it.price,
                    onOk: v => { it.price = v; touch(); }
                });
                break;

            // 金額直接輸入：業務手上常常只有總額，這時數量固定 1 最省事
            case 'amt':
                openPad({
                    title: `第 ${i + 1} 項　金額（數量將設為 1）`,
                    mode: 'amount', max: 9, value: (it.qty || 0) * (it.price || 0),
                    onOk: v => { it.qty = 1; it.price = v; touch(); }
                });
                break;

            case 'del':
                if (state.items.length === 1) state.items[0] = { name: '', qty: 1, price: 0 };
                else state.items.splice(i, 1);
                touch();
                vibrate([40, 40]);
                break;
        }
    });

    $('btnAddItem').addEventListener('click', () => {
        if (state.items.length >= MAX_ITEMS) return;
        state.items.push({ name: '', qty: 1, price: 0 });
        touch();
        vibrate(30);
    });

    // --- 由含稅總額反推 ---
    $('rowTotal').addEventListener('click', () => {
        openPad({
            title: '由含稅總額反推', mode: 'amount', max: 9, value: calc().total,
            onOk: v => {
                if (v <= 0) return;
                const keep = (state.items[0] && state.items[0].name) || '租賃價款';
                const multi = state.items.length > 1;

                // 三聯式的單價欄要填未稅；二聯式單價本身就含稅，直接填
                const price = state.type === '3' ? Math.round(v / (1 + TAX_RATE)) : v;
                state.items = [{ name: keep, qty: 1, price: price }];
                state.lockTotal = v;      // 讓稅額吸收進位差，總計必定等於使用者輸入的數字
                render();

                const got = calc().total;
                if (got !== v) showToast(`總計為 ${fmt(got)}（與輸入差 ${Math.abs(got - v)} 元）`, true, 3200);
                else if (multi) showToast('已合併為單一品項');
            }
        });
    });

    // --- 預覽：點日期改日期，點其他地方放大 ---
    $('previewWrap').addEventListener('click', e => {
        if (e.target.closest('[data-hot="date"]')) openDate();
        else openZoom();
    });

    // --- 放大 ---
    $('btnZoom').addEventListener('click', openZoom);
    $('zClose').addEventListener('click', closeZoom);
    $('zFit').addEventListener('click', fitZoom);
    $('zRotate').addEventListener('click', () => { zoom.rot = zoom.rot === 90 ? 0 : 90; fitZoom(); });
    $('zIn').addEventListener('click', () => { zoom.scale = Math.min(zoom.scale * 1.25, 6); applyZoom(); });
    $('zOut').addEventListener('click', () => { zoom.scale = Math.max(zoom.scale / 1.25, 0.2); applyZoom(); });
    $('zoomPaper').addEventListener('click', e => {
        if (e.target.closest('[data-hot="date"]')) openDate();
    });

    // --- 動作列 ---
    $('btnShare').addEventListener('click', shareLink);
    $('btnSave').addEventListener('click', saveImage);
    $('btnReset').addEventListener('click', () => {
        state.taxId = '';
        state.title = '';
        state.date = null;
        state.items = [{ name: '租賃價款', qty: 1, price: 0 }];
        if (location.hash) history.replaceState(null, '', location.pathname);
        touch();
        showToast('已清除');
    });

    // --- 存檔與歷史 ---
    $('btnSaveRec').addEventListener('click', saveRecord);
    $('btnHistory').addEventListener('click', openHistory);
    $('histClose').addEventListener('click', () => $('histSheet').classList.remove('show'));
    $('histClear').addEventListener('click', () => {
        if (!loadJSON(LS_HISTORY, []).length) return;
        localStorage.removeItem(LS_HISTORY);
        renderHistory();
        showToast('已全部刪除');
    });
    $('histBody').addEventListener('click', e => {
        const del = e.target.closest('[data-del]');
        if (del) { deleteRecord(del.dataset.del); return; }
        const rec = e.target.closest('.hrec');
        if (rec) loadRecord(rec.dataset.id);
    });

    // --- 日期 ---
    $('dateClose').addEventListener('click', () => $('dateModal').classList.remove('show'));
    $('dateModal').addEventListener('click', e => {
        if (e.target === $('dateModal')) $('dateModal').classList.remove('show');
    });
    $('dateModal').querySelectorAll('.dstep').forEach(b => {
        b.addEventListener('click', () => stepDate(b.dataset.f, +b.dataset.d));
    });
    $('dateToday').addEventListener('click', () => { dateDraft = todayROC(); paintDate(); });
    $('dateOk').addEventListener('click', () => {
        const t = todayROC();
        // 剛好選到今天就存 null，之後跨日開啟會自動跟著更新
        state.date = (dateDraft.y === t.y && dateDraft.m === t.m && dateDraft.d === t.d)
            ? null : Object.assign({}, dateDraft);
        $('dateModal').classList.remove('show');
        render();
    });

    // --- 數字鍵盤 ---
    $('padGrid').addEventListener('click', e => {
        const b = e.target.closest('button[data-k]');
        if (b) padKey(b.dataset.k);
    });
    $('padClose').addEventListener('click', closePad);
    $('padModal').addEventListener('click', e => { if (e.target === $('padModal')) closePad(); });

    // --- 文字彈窗 ---
    $('txtChips').addEventListener('click', e => {
        const c = e.target.closest('.chip');
        if (c) commitText(c.textContent);      // 點一下就填好關閉，全程不叫鍵盤
    });
    $('txtOk').addEventListener('click', () => commitText($('txtInput').value));
    $('txtCancel').addEventListener('click', closeText);
    $('txtModal').addEventListener('click', e => { if (e.target === $('txtModal')) closeText(); });
    $('txtInput').addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); commitText($('txtInput').value); }
    });
}

/* ============================================================
   啟動
   ============================================================ */
document.addEventListener('DOMContentLoaded', function () {
    bind();

    // 從分享連結進來的話，直接還原成同一張發票
    const m = location.hash.match(/inv=([A-Za-z0-9_-]+)/);
    if (m) {
        try { decodeState(m[1]); showToast('已載入分享的發票範例'); }
        catch (err) { showToast('分享連結格式有誤', true); }
    }

    render();

    window.addEventListener('resize', () => {
        if ($('zoomOverlay').classList.contains('show')) fitZoom();
    });
});

/* 測試掛載點：讓自動化測試能直接驗算，不必透過 DOM */
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { upperSlots, validateTaxId, calc, state };
}
