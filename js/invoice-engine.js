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
   常數
   ------------------------------------------------------------
   必須宣告在 state 之前：const 有暫時性死區，
   state 的初始值用到 DEFAULT_ITEM_NAME，寫在後面會直接 ReferenceError。
   ============================================================ */
const TAX_RATE = 0.05;
const MAX_ITEMS = 5;          // 發票紙上實際只印得下 5 行，多了業務也抄不上去
const MAX_AMOUNT = 999999999; // 9 位數，與發票大寫格位數相同

/**
 * 品名的預設文字。
 * 刻意用「品項名稱」這種一看就知道要換掉的字，而不是猜一個真實品名 ——
 * 猜錯的話業務可能整張抄下去都沒發現。
 */
const DEFAULT_ITEM_NAME = '品項名稱';

/**
 * 常用品名快選清單。
 * 不預設任何內容：預先塞的字對這裡的業務不一定適用，反而會被誤選。
 * 這個清單只累積使用者自己打過的品名，用久了自然變成他自己的常用詞。
 */
const DEFAULT_ITEM_NAMES = [];

const LS_ITEM_NAMES = 'invNewItemNames';
const LS_CUSTOMERS  = 'invNewCustomers';
const LS_HISTORY    = 'invNewHistory';

/* ============================================================
   狀態
   ============================================================ */
const state = {
    type: '3',          // '3' 三聯式（開給公司）/ '2' 二聯式（開給個人）
    taxId: '',
    title: '',
    date: null,         // {y,m,d} 民國年。null 代表跟著今天走
    items: [{ name: DEFAULT_ITEM_NAME, qty: 1, price: 0 }],

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

/* ============================================================
   小工具
   ============================================================ */
/* vibrate() 與 showToast() 已改用 js/common-keypad.js 的共用版本
   （行為相同）。本頁原本各有一份，兩份同名函式會互相覆蓋，
   哪一份生效取決於載入順序 —— 這種隱性依賴留著遲早會咬人。 */

/* ------------------------------------------------------------
 * 使用情況回報
 * ------------------------------------------------------------
 * 【2026/07 新增】
 *
 * 發票頁在此之前完全沒有任何追蹤 —— 網站上線到現在，
 * 沒有任何一筆資料能回答「這一頁到底有沒有人在用」。
 *
 * 加上的四個事件都綁在「完成型動作」上，不綁按鍵、不綁輸入：
 *   invoice_saved         存檔進歷史
 *   invoice_image_saved   存成圖片（或直接分享出去）
 *   invoice_shared        分享連結給同事
 *   taxid_lookup          查統編（記查到或查不到，看得出離線索引夠不夠用）
 *
 * 一律不送金額、抬頭、統一編號本身 —— 那是客戶的資料。
 * 只送「幾聯式」「有沒有查到」這種不指向特定客戶的資訊。
 *
 * trackEvent 定義在 invoice.html 的 GA4 區塊。本檔案被測試環境單獨載入時
 * 不會有那個區塊，所以一定要做存在性檢查，否則整支引擎會拋 ReferenceError。
 * ------------------------------------------------------------ */
function trackInvoiceEvent(eventName, parameters = {}) {
    if (typeof trackEvent === 'function') {
        trackEvent(eventName, parameters);
    }
}

/** 三聯式 / 二聯式，統計時用得到 */
function invoiceTypeLabel() {
    return state.type === '3' ? 'triplicate' : 'duplicate';
}

function $(id) { return document.getElementById(id); }

function fmt(n) { return (n || 0).toLocaleString('en-US'); }

function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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
    // 二聯式沒有統編，那一列整列隱藏，日期改用備援列顯示，版面不會空一塊
    $('rowTaxId').style.display = two ? 'none' : 'flex';
    $('rowDateOnly').style.display = two ? 'flex' : 'none';
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

    const dt = curDate();
    const dtxt = `${dt.y}/${String(dt.m).padStart(2, '0')}/${String(dt.d).padStart(2, '0')}`;
    $('fDate').textContent = dtxt;
    $('fDate2').textContent = dtxt;

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
                <div class="box ${(!it.name || it.name === DEFAULT_ITEM_NAME) ? 'empty' : ''}" data-act="name" data-i="${i}">${esc(it.name || '點此輸入品名')}</div>
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

const NAT_W_3 = 820, NAT_H_3 = 518;
const NAT_W_2 = 700, NAT_H_2 = 408;

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

/**
 * 分散對齊：把每個字平均攤在 x0～x1 之間
 *
 * 真實發票的欄位名稱是「品　　　　　　名」「金　　　額」「銷　售　額　合　計」
 * 這種撐滿整格的排法，不是置中。少了這個，整張圖看起來就不像發票。
 * ratio 控制左右內縮比例，值越大字距越窄。
 */
function svgSpread(x0, x1, y, s, opt) {
    const chars = Array.from(String(s || ''));
    const o = opt || {};
    if (chars.length === 0) return '';
    if (chars.length === 1) return svgText((x0 + x1) / 2, y, s, Object.assign({}, o, { anchor: 'middle' }));

    const pad = (x1 - x0) * (o.ratio == null ? 0.12 : o.ratio);
    const L = x0 + pad, R = x1 - pad;
    const step = (R - L) / (chars.length - 1);
    return chars.map((c, i) =>
        svgText(L + i * step, y, c, Object.assign({}, o, { anchor: 'middle' }))
    ).join('');
}

function svgLine(x1, y1, x2, y2, w, color, dash) {
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color || PRT}"` +
           ` stroke-width="${w || 1}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
}

function svgRect(x, y, w, h, sw, color, fill, rx) {
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill || 'none'}"` +
           ` stroke="${color || PRT}" stroke-width="${sw || 1}"${rx ? ` rx="${rx}"` : ''}/>`;
}

/**
 * 備註欄內容
 *
 * 真實發票的備註欄裡有兩條橫線，把它切成三塊（對齊品項列的格線）：
 *   上塊空白 → 中間那條窄帶寫「營業人蓋用統一發票專用章」 → 下方一大塊才是蓋章位置
 * 少了這兩條線，看起來就像整欄都是蓋章區，位置會蓋錯。
 *
 * @param xL,xR  備註欄左右界
 * @param yTop   欄位頂端（表頭底線）
 * @param yBot   欄位底端
 * @param band   [文字帶上緣, 文字帶下緣]，由呼叫端對齊品項列格線
 */
function noteColumn(xL, xR, yTop, yBot, band) {
    const cx = (xL + xR) / 2;
    let s = '';

    s += svgLine(xL, band[0], xR, band[0], 1);
    s += svgLine(xL, band[1], xR, band[1], 1);
    s += svgText(cx, (band[0] + band[1]) / 2 + 4, '營業人蓋用統一發票專用章', { anchor: 'middle', size: 11 });

    // 蓋章提醒放在第二條線以下的大區塊，也就是章實際要蓋的位置
    const bw = Math.min(xR - xL - 34, 160);
    const bh = Math.min(yBot - band[1] - 26, 104);
    const bx = cx - bw / 2, by = band[1] + 14;
    s += svgRect(bx, by, bw, bh, 1.5, '#9bb8e8', STAMP_BG, 6);
    s += svgText(cx, by + bh / 2 - 2, '記得蓋', { anchor: 'middle', size: 20, fill: STAMP_FG, weight: 'bold' });
    s += svgText(cx, by + bh / 2 + 24, '發票章', { anchor: 'middle', size: 20, fill: STAMP_FG, weight: 'bold' });
    return s;
}

/**
 * 中文大寫格位列
 *
 * 這一列只到備註欄左緣為止（真實發票的結構），寬度被壓縮得很緊，
 * 所以格寬由剩餘空間反推，而不是寫死 —— 寫死的話三聯式與二聯式
 * 其中一種一定會撞到左邊的標籤。
 */
function upperRow(x0, y0, w, h, total, labelW) {
    let s = '';
    s += svgText(x0 + 6, y0 + 16, '總計新臺幣', { size: 9.5 });
    s += svgText(x0 + 6, y0 + 28, '（中文大寫）', { size: 9.5 });

    const slotW = (w - labelW - 10) / 9;
    const slots = upperSlots(total);
    const startX = x0 + labelW;
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

    // 日期。真實發票上「中華民國」與年份是印好的，月、日才要手寫。
    // 修改入口已經移到上面的「買受人」卡片，這裡純顯示，不再是熱區。
    s += svgText(440, 132, '中華民國', { size: 13 });
    s += svgText(510, 132, String(dt.y), { anchor: 'middle', size: 15, fill: INK, weight: 'bold' });
    s += svgText(530, 132, '年', { size: 13 });
    s += svgText(568, 132, String(dt.m), { anchor: 'middle', size: 15, fill: INK, weight: 'bold' });
    s += svgText(584, 132, '月', { size: 13 });
    s += svgText(622, 132, String(dt.d), { anchor: 'middle', size: 15, fill: INK, weight: 'bold' });
    s += svgText(638, 132, '日', { size: 13 });

    // --- 地址列 ---
    // 真實發票的印刷字是平均攤在整行的，而且「鄉鎮市區」是上下兩行的小字。
    // 實務上這一列可省略，所以整條劃掉並標註。
    s += svgText(40, 162, '地　　址：', { size: 13, fill: PRE });
    const addrSlots = ['縣市', '', '路街', '段', '巷', '弄', '號', '樓', '室'];
    // 右邊要留給「可省略」標註，位置算到 690 為止，否則會蓋掉最後一個「室」
    const aL = 130, aR = 690, aStep = (aR - aL) / (addrSlots.length - 1);
    addrSlots.forEach((t, i) => {
        if (!t) return;
        s += svgText(aL + i * aStep, 162, t, { anchor: 'middle', size: 12, fill: PRE });
    });
    // 鄉鎮市區：兩行直排，與真實發票一致
    s += svgText(aL + aStep, 156, '鄉鎮', { anchor: 'middle', size: 9, fill: PRE });
    s += svgText(aL + aStep, 166, '市區', { anchor: 'middle', size: 9, fill: PRE });
    s += svgLine(118, 158, 706, 158, 3, '#f0b878');
    s += svgText(716, 162, '可省略', { size: 11, fill: '#e08a2e', weight: 'bold' });

    // --- 明細表 ---
    const TY = 176, HH = 24, RH = 26, ROWS = MAX_ITEMS;
    const cols = [40, 250, 320, 410, 570, 780];
    const heads = ['品名', '數量', '單價', '金額', '備註'];
    const bodyTop = TY + HH;
    const bodyBot = bodyTop + ROWS * RH;

    const SY1 = bodyBot;             // 銷售額合計
    const SY2 = SY1 + 26;            // 營業稅（含 3 格小表格）
    const SY3 = SY2 + 36;            // 總計
    const UY  = SY3 + 26;            // 大寫列
    const UH  = 38;
    const TEND = UY + UH;            // 表格底部＝備註欄底部

    // 備註欄從表頭一路貫通到最底（含大寫列），這是真實發票的結構：
    // 大寫列只到備註欄左緣為止，不是橫跨整張。蓋章區就是備註欄的下半部，
    // 不是另外一個欄位。
    s += svgRect(cols[0], TY, cols[5] - cols[0], TEND - TY, 1.5);
    s += svgLine(cols[0], bodyTop, cols[5], bodyTop, 1.5);

    // 直線：品名~金額的分隔只到品項區底部；備註欄的直線貫通到底
    for (let i = 1; i <= 3; i++) s += svgLine(cols[i], TY, cols[i], bodyBot, 1);
    s += svgLine(cols[4], TY, cols[4], TEND, 1.5);

    // 品項橫線
    for (let i = 1; i < ROWS; i++) s += svgLine(cols[0], bodyTop + RH * i, cols[4], bodyTop + RH * i, 0.6);
    // 合計區與大寫列的橫線，一律只到備註欄左緣
    [SY1, SY2, SY3, UY].forEach(y => s += svgLine(cols[0], y, cols[4], y, 1));

    // 欄位名稱用分散對齊，撐滿整格
    heads.forEach((h, i) => {
        s += svgSpread(cols[i], cols[i + 1], TY + 17, h,
            { size: 12.5, weight: 'bold', ratio: i === 0 ? 0.22 : 0.28 });
    });

    // 品項內容
    state.items.forEach((it, i) => {
        if (i >= ROWS) return;
        const y = bodyTop + RH * i + 18;
        // 還沒改過的預設佔位字用淡色，讓業務一眼看出這格還要填
        if (it.name)  s += svgText(cols[0] + 8, y, it.name, { size: fitSize(it.name, cols[1] - cols[0] - 16, 13.5), fill: it.name === DEFAULT_ITEM_NAME ? '#9db4e8' : INK });
        if (it.qty)   s += svgText(cols[2] - 8, y, String(it.qty), { anchor: 'end', size: 13.5, fill: INK });
        if (it.price) s += svgText(cols[3] - 8, y, fmt(it.price), { anchor: 'end', size: 13.5, fill: INK });
        const amt = (it.qty || 0) * (it.price || 0);
        if (amt)      s += svgText(cols[4] - 8, y, fmt(amt), { anchor: 'end', size: 13.5, fill: INK });
    });
    s += voidSlash(cols[3], cols[4], bodyTop + RH * state.items.length, bodyBot);

    // 備註欄：兩條橫線對齊第 2、3 列的格線，與真實發票一致
    s += noteColumn(cols[4], cols[5], bodyTop, TEND,
        [bodyTop + RH * 2, bodyTop + RH * 3]);

    // 銷售額合計：標籤在真實發票上是撐到金額欄左緣的，不是縮在最左邊一小塊
    s += svgSpread(cols[0] + 6, cols[3] - 10, SY1 + 18, '銷售額合計', { size: 12.5, weight: 'bold', ratio: 0.06 });
    s += svgText(cols[4] - 8, SY1 + 18, fmt(r.sales), { anchor: 'end', size: 15, fill: INK, weight: 'bold' });

    // 營業稅：真實發票是「應稅｜零稅率｜免稅」三格小表格，右緣剛好接上金額欄
    s += svgSpread(cols[0] + 6, 180, SY2 + 24, '營業稅', { size: 12.5, weight: 'bold', ratio: 0.06 });
    const mW = (cols[3] - 186) / 3;
    const mx = [186, 186 + mW, 186 + mW * 2, cols[3]], mMid = SY2 + 17;
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
    s += svgSpread(cols[0] + 6, cols[3] - 10, SY3 + 18, '總計', { size: 12.5, weight: 'bold', ratio: 0.06 });
    s += svgText(cols[4] - 8, SY3 + 18, fmt(r.total), { anchor: 'end', size: 16, fill: INK, weight: 'bold' });

    // 大寫格位列（只到備註欄左緣）
    s += upperRow(cols[0], UY, cols[4] - cols[0], UH, r.total, 92);

    // 底部
    s += svgText(40, TEND + 20, '※應稅、零稅率、免稅之銷售額應分別開立統一發票，並應於各該欄打「√」。', { size: 10, fill: '#666666' });
    s += svgSpread(640, 780, TEND + 20, '第一聯存根聯', { size: 11, ratio: 0.04 });
    s += svgText(40, TEND + 40, '藍字＝需要動筆填寫　　灰字＝發票本已印好，不用寫', { size: 10.5, fill: INK });
    s += svgText(780, TEND + 40, '存根聯自存，扣抵聯與收執聯交給買受人', { anchor: 'end', size: 10, fill: '#666666' });

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

    s += svgText(370, 106, '中華民國', { size: 13 });
    s += svgText(440, 106, String(dt.y), { anchor: 'middle', size: 15, fill: INK, weight: 'bold' });
    s += svgText(460, 106, '年', { size: 13 });
    s += svgText(498, 106, String(dt.m), { anchor: 'middle', size: 15, fill: INK, weight: 'bold' });
    s += svgText(514, 106, '月', { size: 13 });
    s += svgText(552, 106, String(dt.d), { anchor: 'middle', size: 15, fill: INK, weight: 'bold' });
    s += svgText(568, 106, '日', { size: 13 });

    const TY = 126, HH = 24, RH = 26, ROWS = MAX_ITEMS;
    const cols = [36, 236, 300, 385, 520, 664];
    const heads = ['品名', '數量', '單價', '金額', '備註'];
    const bodyTop = TY + HH;
    const bodyBot = bodyTop + ROWS * RH;

    const SY1 = bodyBot;         // 總計（二聯式發票上只有這一列，單價本身就含稅）
    const UY = SY1 + 28, UH = 38;
    const TEND = UY + UH;        // 備註欄與大寫列一樣貫通到底

    s += svgRect(cols[0], TY, cols[5] - cols[0], TEND - TY, 1.5);
    s += svgLine(cols[0], bodyTop, cols[5], bodyTop, 1.5);
    for (let i = 1; i <= 3; i++) s += svgLine(cols[i], TY, cols[i], bodyBot, 1);
    s += svgLine(cols[4], TY, cols[4], TEND, 1.5);
    for (let i = 1; i < ROWS; i++) s += svgLine(cols[0], bodyTop + RH * i, cols[4], bodyTop + RH * i, 0.6);
    [SY1, UY].forEach(y => s += svgLine(cols[0], y, cols[4], y, 1));

    heads.forEach((h, i) => {
        s += svgSpread(cols[i], cols[i + 1], TY + 17, h,
            { size: 12.5, weight: 'bold', ratio: i === 0 ? 0.22 : 0.28 });
    });

    state.items.forEach((it, i) => {
        if (i >= ROWS) return;
        const y = bodyTop + RH * i + 18;
        // 還沒改過的預設佔位字用淡色，讓業務一眼看出這格還要填
        if (it.name)  s += svgText(cols[0] + 8, y, it.name, { size: fitSize(it.name, cols[1] - cols[0] - 16, 13.5), fill: it.name === DEFAULT_ITEM_NAME ? '#9db4e8' : INK });
        if (it.qty)   s += svgText(cols[2] - 8, y, String(it.qty), { anchor: 'end', size: 13.5, fill: INK });
        if (it.price) s += svgText(cols[3] - 8, y, fmt(it.price), { anchor: 'end', size: 13.5, fill: INK });
        const amt = (it.qty || 0) * (it.price || 0);
        if (amt)      s += svgText(cols[4] - 8, y, fmt(amt), { anchor: 'end', size: 13.5, fill: INK });
    });
    s += voidSlash(cols[3], cols[4], bodyTop + RH * state.items.length, bodyBot);

    s += noteColumn(cols[4], cols[5], bodyTop, TEND,
        [bodyTop + RH * 2, bodyTop + RH * 3]);

    s += svgSpread(cols[0] + 6, cols[3] - 10, SY1 + 19, '總計', { size: 12.5, weight: 'bold', ratio: 0.06 });
    s += svgText(cols[4] - 8, SY1 + 19, fmt(r.total), { anchor: 'end', size: 16, fill: INK, weight: 'bold' });

    s += upperRow(cols[0], UY, cols[4] - cols[0], UH, r.total, 88);

    s += svgText(36, TEND + 20, '※二聯式發票開給個人，金額為含稅價，不另列稅額。', { size: 10, fill: '#666666' });
    s += svgSpread(540, 664, TEND + 20, '第一聯存根聯', { size: 11, ratio: 0.04 });
    s += svgText(36, TEND + 40, '藍字＝需要動筆填寫　　灰字＝發票本已印好，不用寫', { size: 10.5, fill: INK });

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
   數字鍵盤（2026/07 起改用四頁共用的那台）
   ------------------------------------------------------------
   本頁原本自帶一台鍵盤（openPad / padKey / #padModal），約 90 行。
   它與其他三頁那台各自演化：這台有 000 與 萬、有大寫金額預覽、
   會保留統編的前導零；那台有四則運算與算式歷程。
   兩台都不完整，而且外觀與手感不一樣。

   現在統一走 js/common-keypad.js：
     - 金額欄位第一次有了四則運算（本頁原本完全不能加減乘除）
     - 000／萬、大寫預覽、統編前導零全部保留，改由欄位型別宣告
       （設定見 pages/invoice.html 的 KEYPAD_FIELDS）

   共用鍵盤按「確認輸入」時會呼叫各頁自己的 submitCalculatorValue()，
   本頁在那裡把值交還給原本的回呼 —— 呼叫端（品項、統編、反推）
   的寫法完全不用改。
   ============================================================ */

/* 目前這次輸入完成後要把值交給誰。共用鍵盤只認欄位 id，
   本頁的數字存在 state 裡而不是輸入框，所以用回呼接回來。 */
let padTarget = null;

/**
 * 開啟數字鍵盤
 *
 * @param {Object} opts { field, title, value, onOk }
 *        field: KEYPAD_FIELDS 裡的欄位 id（inv-taxid / inv-qty / inv-price / inv-total）
 *        onOk : (數值, 原字串) => void
 */
function openPad(opts) {
    padTarget = opts.onOk || null;
    openCalculator(opts.field, opts.title || '輸入',
        opts.value === undefined || opts.value === null ? '' : String(opts.value));
}

function closePad() {
    padTarget = null;
    closeModal('numberInputModal');
}

/**
 * 共用鍵盤按下「確認輸入」時會呼叫這裡（四頁各自實作）
 *
 * 其他三頁在這裡做欄位驗證並回寫輸入框；本頁的驗證留在各個回呼裡
 * （例如統編要驗檢查碼、反推要重算品項），這裡只負責把值交回去。
 */
function submitCalculatorValue() {
    const raw = String(calculatorValue || '');
    const value = raw === '' ? 0 : parseInt(raw, 10);
    const done = padTarget;

    closePad();
    if (done) done(isFinite(value) ? value : 0, raw);
    vibrate([40, 60]);
}

/* ------------------------------------------------------------
   鍵盤副資訊（顯示區第三行）
   ------------------------------------------------------------ */

/**
 * 金額欄位：大寫金額
 *
 * 沿用本頁原本的格位式寫法（upperSlots），與發票上「億仟佰拾萬仟佰拾元」
 * 那排格子完全對得起來 —— 支票頁用的是另一套（arabicToChineseNumber），
 * 兩者的用途不同，刻意不共用。
 */
function describeInvoiceUpper(amount) {
    const n = Math.floor(Number(amount));
    if (!isFinite(n) || n <= 0) return '';
    return upperSlots(n).filter(s => s.digit !== null).map(s => s.digit + s.unit).join('');
}

/**
 * 統一編號：檢查碼與查到的公司名
 *
 * 第二個參數是沒有經過處理的原字串，前導零與長度都完整
 * （04595257 是 8 碼，parseFloat 之後會變成 4595257）。
 */
function describeTaxId(_num, raw) {
    const digits = String(raw || '');
    if (digits.length === 0) return '';
    if (digits.length < 8) return `已輸入 ${digits.length} 碼，還要 ${8 - digits.length} 碼`;
    return validateTaxId(digits) ? '✓ 檢查碼正確' : '✕ 檢查碼不符，請再確認';
}

/**
 * 統編輸入過程中的兩件事（共用鍵盤每次數值變動都會呼叫）
 *
 *   打到第 3 碼 → 先把稅籍索引分片抓下來，按完第 8 碼時抬頭幾乎同時出現
 *   打滿 8 碼   → 查到公司名就直接寫進副資訊行，按確認之前就看得到抄對了沒
 *
 * 查詢是非同步的，回來時使用者可能已經改了號碼或關掉鍵盤，
 * 所以寫回去之前會再確認一次「畫面上還是同一組號碼」。
 */
function prefetchTaxId(_num, raw) {
    const digits = String(raw || '');
    if (!window.TaxIdLookup) return;

    if (digits.length === 3) {
        window.TaxIdLookup.prefetch(digits);
        return;
    }

    if (digits.length === 8 && validateTaxId(digits)) {
        window.TaxIdLookup.lookup(digits).then(name => {
            if (!name) return;
            const sub = document.getElementById('calculatorSub');
            // 慢回來的查詢不可以蓋掉使用者現在正在看的東西
            if (sub && String(calculatorValue) === digits) sub.textContent = '✓ ' + name;
        }).catch(() => { /* 查不到就維持檢查碼那句，不打擾使用者 */ });
    }
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

    // 鍵盤彈出／收起時外層視窗會改變高度，跟著重算位置
    const vv = outerViewport();
    if (vv) {
        vv.addEventListener('resize', positionText);
        vv.addEventListener('scroll', positionText);
    }
    window.addEventListener('resize', positionText);

    setTimeout(() => { $('txtInput').focus(); positionText(); }, 60);
    vibrate(30);
}

/**
 * 取得「看得到鍵盤高度」的那個 visualViewport
 *
 * 關鍵：這頁平常是嵌在 index.html 的 iframe 裡，而 iframe 自己的
 * visualViewport 不會隨鍵盤縮小 —— 鍵盤是蓋在最外層文件上的。
 * 但兩邊同源（都在 ryanlin02.github.io），所以可以直接讀外層那一個，
 * 它的 height 在鍵盤彈出時會確實變小。這是在 iframe 裡唯一
 * 能精確得知鍵盤佔掉多少空間的方法，不必靠猜。
 *
 * 跨來源或單獨開啟這頁時會取不到，退回自己的 visualViewport。
 */
function outerViewport() {
    try {
        if (window.parent !== window && window.parent.visualViewport) {
            return window.parent.visualViewport;
        }
    } catch (e) {
        // 跨來源存取會拋錯，安靜退回
    }
    return window.visualViewport || null;
}

/** 彈窗距 iframe 頂端至少要留的空間。
 *  外殼標題列高 60px，但 iframe 從 45px 開始 ——
 *  iframe 最上面 15px 永遠被壓住，20px 才安全。 */
const MODAL_MIN_TOP = 20;

/**
 * 算出彈窗該距 iframe 頂端多遠（純運算，與 DOM 無關，方便測試）
 *
 * @param vvHeight    外層可見高度（鍵盤彈出時會變小）
 * @param frameTop    iframe 在外層畫面上的起始 y
 * @param panelHeight 彈窗高度
 * @returns 距 iframe 頂端的距離
 *
 * 目標是放在「外殼標題列以下、鍵盤以上」那塊區域的正中間。
 * 空間真的不夠時優先保證頂端看得見（標題與輸入框在上半部），
 * 底部溢出的部分由彈窗自己捲動。
 */
function computeModalTop(vvHeight, frameTop, panelHeight, minTop) {
    if (!vvHeight) return minTop;
    const visible = vvHeight - frameTop;
    return Math.max(minTop, Math.min((visible - panelHeight) / 2, visible - panelHeight - 12));
}

function positionText() {
    const modal = $('txtModal');
    const panel = $('txtPanel');
    if (!modal || !panel || !modal.classList.contains('show')) return;

    const vv = outerViewport();
    if (!vv || !vv.height) { modal.style.paddingTop = MODAL_MIN_TOP + 'px'; return; }

    // iframe 在外層畫面上的起始位置，用來把外層座標換算成 iframe 內座標
    let frameTop = 0;
    try {
        if (window.frameElement) frameTop = window.frameElement.getBoundingClientRect().top;
    } catch (e) { /* 跨來源時取不到，當作 0 */ }

    modal.style.paddingTop =
        computeModalTop(vv.height, frameTop, panel.offsetHeight || 240, MODAL_MIN_TOP) + 'px';
}

function closeText() {
    $('txtModal').classList.remove('show');
    $('txtInput').blur();

    const vv = outerViewport();
    if (vv) {
        vv.removeEventListener('resize', positionText);
        vv.removeEventListener('scroll', positionText);
    }
    window.removeEventListener('resize', positionText);

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
    const { y, m, d } = dateDraft;
    $('calTitle').textContent = `${y} 年 ${m} 月`;

    const first = new Date(y + 1911, m - 1, 1).getDay();   // 當月 1 號是星期幾
    const days = daysInMonth(y, m);
    const t = todayROC();

    let h = '';
    for (let i = 0; i < first; i++) h += '<span class="d blank"></span>';
    for (let n = 1; n <= days; n++) {
        const cls = ['d'];
        if (n === d) cls.push('sel');
        if (y === t.y && m === t.m && n === t.d) cls.push('today');
        h += `<span class="${cls.join(' ')}" data-d="${n}">${n}</span>`;
    }
    $('calGrid').innerHTML = h;
}

/** 月曆換月／換年。跨月後若選中的日不存在（例如 1/31 到 2 月），夾回當月最後一天 */
function navDate(field, delta) {
    if (field === 'y') dateDraft.y = Math.min(200, Math.max(90, dateDraft.y + delta));
    else {
        const total = (dateDraft.y * 12 + (dateDraft.m - 1)) + delta;
        dateDraft.y = Math.floor(total / 12);
        dateDraft.m = (total % 12) + 1;
    }
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
    // 預設佔位字不該被記成常用詞，否則清單第一筆永遠是「品項名稱」
    if (!name || name === DEFAULT_ITEM_NAME || DEFAULT_ITEM_NAMES.includes(name)) return;
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

/* 名冊查不到時，再去查財政部稅籍索引（data/taxid/ 的離線分片）。
   查到就自動填抬頭。整段是非同步的，但不會卡住畫面：
   使用者可以照常繼續打字，名字跳出來只是「順手幫你填好」。 */
function autoFillTitleFromIndex(taxId) {
    if (!global_TaxIdLookup() || state.title) return;
    const asked = taxId;                       // 記住當下這一組，避免慢回應蓋掉新輸入
    window.TaxIdLookup.lookup(taxId).then(name => {
        // 只記「查到了沒」，不送統編本身。
        // 查不到的比例如果偏高，代表離線索引該補資料了。
        trackInvoiceEvent('taxid_lookup', { found: !!name });

        if (!name) return;
        if (state.taxId !== asked || state.title) return;   // 使用者已經改了，就別動他
        state.title = name;
        rememberCustomer();                    // 下次同一組統編改走本地名冊，完全離線
        showToast('已帶出公司抬頭：' + name);
        render();
    });
}

function global_TaxIdLookup() {
    return typeof window !== 'undefined' && window.TaxIdLookup && !window.TaxIdLookup.disabled;
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

    // 存檔代表這張發票對業務是有意義的。不送金額與抬頭。
    trackInvoiceEvent('invoice_saved', {
        invoice_type: invoiceTypeLabel(),
        item_count: (state.items || []).length,
        history_count: Math.min(list.length, 100)
    });

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
    })) : [{ name: DEFAULT_ITEM_NAME, qty: 1, price: 0 }];
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

    trackInvoiceEvent('invoice_shared', {
        invoice_type: invoiceTypeLabel(),
        share_method: navigator.share ? 'system_share' : (navigator.clipboard ? 'clipboard' : 'url_hash')
    });

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

            // 存成圖片通常是要傳給客戶看，是這一頁最終的產出動作
            trackInvoiceEvent('invoice_image_saved', {
                invoice_type: invoiceTypeLabel()
            });

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
            title: '統一編號（8 碼）', field: 'inv-taxid', value: state.taxId,
            onOk: (v, raw) => {
                state.taxId = raw || '';
                if (state.taxId.length === 8) {
                    if (!validateTaxId(state.taxId)) {
                        showToast('統編檢查碼不符，請再確認一次', true, 2800);
                    } else if (!state.title) {
                        // 先查本地名冊：回頭客最多、而且是同步的，抬頭馬上就出來
                        const t = lookupByTaxId(state.taxId);
                        if (t) {
                            state.title = t;
                            showToast('已帶出上次的抬頭：' + t);
                        } else {
                            // 名冊沒有才去翻稅籍索引（非同步，不擋畫面）
                            autoFillTitleFromIndex(state.taxId);
                        }
                    }
                }
                render();
            }
        });
    });

    // --- 日期（三個入口：欄位、二聯式備援欄位、發票圖上的熱區）---
    $('fDate').addEventListener('click', openDate);
    $('fDate2').addEventListener('click', openDate);

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
                    title: `第 ${i + 1} 項　數量`, field: 'inv-qty', value: it.qty,
                    onOk: v => { it.qty = v; touch(); }
                });
                break;

            case 'price':
                openPad({
                    title: `第 ${i + 1} 項　單價（${state.type === '3' ? '未稅' : '含稅'}）`,
                    field: 'inv-price', value: it.price,
                    onOk: v => { it.price = v; touch(); }
                });
                break;

            // 金額直接輸入：業務手上常常只有總額，這時數量固定 1 最省事
            case 'amt':
                openPad({
                    title: `第 ${i + 1} 項　金額（數量將設為 1）`,
                    field: 'inv-price', value: (it.qty || 0) * (it.price || 0),
                    onOk: v => { it.qty = 1; it.price = v; touch(); }
                });
                break;

            case 'del':
                if (state.items.length === 1) state.items[0] = { name: DEFAULT_ITEM_NAME, qty: 1, price: 0 };
                else state.items.splice(i, 1);
                touch();
                vibrate([40, 40]);
                break;
        }
    });

    $('btnAddItem').addEventListener('click', () => {
        if (state.items.length >= MAX_ITEMS) return;
        state.items.push({ name: DEFAULT_ITEM_NAME, qty: 1, price: 0 });
        touch();
        vibrate(30);
    });

    // --- 由含稅總額反推 ---
    $('rowTotal').addEventListener('click', () => {
        openPad({
            title: '由含稅總額反推', field: 'inv-total', value: calc().total,
            onOk: v => {
                if (v <= 0) return;
                const keep = (state.items[0] && state.items[0].name) || DEFAULT_ITEM_NAME;
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

    // --- 預覽：點任何地方都是放大（日期改到買受人卡片去了）---
    $('previewWrap').addEventListener('click', openZoom);

    // --- 放大 ---
    $('btnZoom').addEventListener('click', openZoom);
    $('zClose').addEventListener('click', closeZoom);
    $('zFit').addEventListener('click', fitZoom);
    $('zRotate').addEventListener('click', () => { zoom.rot = zoom.rot === 90 ? 0 : 90; fitZoom(); });
    $('zIn').addEventListener('click', () => { zoom.scale = Math.min(zoom.scale * 1.25, 6); applyZoom(); });
    $('zOut').addEventListener('click', () => { zoom.scale = Math.max(zoom.scale / 1.25, 0.2); applyZoom(); });

    // --- 動作列 ---
    $('btnShare').addEventListener('click', shareLink);
    $('btnSave').addEventListener('click', saveImage);
    $('btnReset').addEventListener('click', () => {
        state.taxId = '';
        state.title = '';
        state.date = null;
        state.items = [{ name: DEFAULT_ITEM_NAME, qty: 1, price: 0 }];
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
    $('dateModal').querySelectorAll('[data-nav]').forEach(b => {
        const v = b.dataset.nav;                     // 例如 "m-1"、"y1"
        b.addEventListener('click', () => navDate(v[0], parseInt(v.slice(1), 10)));
    });
    $('calGrid').addEventListener('click', e => {
        const c = e.target.closest('[data-d]');
        if (!c) return;
        dateDraft.d = +c.dataset.d;
        paintDate();
        vibrate(20);
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
    /* 共用鍵盤的按鍵、關閉鈕、點遮罩關閉都由 js/common-modals.js 注入的
       DOM 自己處理（onclick），這裡只補上「點遮罩關閉」—— 其他三頁是在
       各自的頁面腳本裡綁的，本頁沿用同樣做法。 */
    const numModal = document.getElementById('numberInputModal');
    if (numModal) {
        numModal.addEventListener('click', e => { if (e.target === numModal) closePad(); });
    }

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

/* 註：頁尾的版本號顯示已於 2026/07 移到 js/common-footer.js，
 *     原本這裡有一份與 common-modals.js 逐字重複的 showAppVersion()。 */


/* ============================================================
   啟動
   ============================================================ */
document.addEventListener('DOMContentLoaded', function () {
    bind();

    // 探一次統編索引是否存在。還沒建置就自動休眠，頁面其他功能完全不受影響。
    if (window.TaxIdLookup) window.TaxIdLookup.probe();

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
