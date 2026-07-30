/**
 * 重車貸款業務工具箱 - 共用日期選擇器 (common-datepicker.js)
 * ============================================================
 * 【2026/07 新增：把兩套月曆收成一套】
 *
 * 支票頁與發票頁各自有一套日期選擇器：
 *   支票頁 139 行 JS + 約 86 行 CSS，<table> 月曆，只能一次換一個月，
 *          沒有「今天」鍵，過去日期直接禁選
 *   發票頁  46 行 JS + 約 77 行 CSS，CSS grid 月曆，年月都能跳，有今天鍵
 *
 * 兩套的外觀與操作邏輯都不一樣，而且一套是另一套的三倍長。
 *
 * 這個檔案以發票頁那套為基礎重寫，並修掉兩個實際用起來很煩的問題：
 *
 *   1. 【面板高度固定】
 *      舊版是「這個月有幾週就畫幾列」，所以 5 列的月份切到 6 列的月份時
 *      整個面板會長高，下面的按鈕跟著往下跑 —— 連續切月時按鈕在手指
 *      底下移動。現在一律畫 6 列 42 格（不足補空白），年份與月份選單
 *      也做成同樣高度，切什麼都不會動一個像素。
 *
 *   2. 【點年份就能選年份】
 *      標題拆成「115 年」與「7 月」兩塊，各自可點：
 *      點年份跳出年份清單、點月份跳出 12 個月的格子，選完回到日曆。
 *      不必按 12 次 ›。
 *
 * 過去日期的處理是「可選但變色提醒」而不是禁選：支票補登已經開始繳的
 * 案子時確實需要選過去的日期，禁選會直接把人擋死；變色 + 下方提示
 * 既擋得住誤按，又不會擋住真的要那樣做的人。
 *
 * ------------------------------------------------------------
 * 用法
 * ------------------------------------------------------------
 *   openDatePicker({
 *       value:      { y: 115, m: 7, d: 26 } | Date | null,   // null＝今天
 *       title:      '發票日期（民國）',
 *       warnBefore: 'today' | { y, m, d } | null,   // 早於此日期會變色提醒
 *       yearRange:  [-5, 6],                        // 年份清單相對今年的範圍
 *       onOk: function (roc, date) { ... }          // 兩種格式都給
 *   });
 *
 * 民國年與西元年的轉換一律走 rocToDate() / dateToRoc()，
 * 各頁不要自己寫 +1911 / -1911 —— 那是過去兩頁分岔的起點之一。
 * ============================================================
 */

/* ------------------------------------------------------------
 * 純算式（不碰 DOM，可單獨驗證）
 * ------------------------------------------------------------ */

/** 民國 {y,m,d} → JS Date（當地時間的 00:00） */
function rocToDate(roc) {
    return new Date(roc.y + 1911, roc.m - 1, roc.d);
}

/** JS Date → 民國 {y,m,d} */
function dateToRoc(date) {
    return { y: date.getFullYear() - 1911, m: date.getMonth() + 1, d: date.getDate() };
}

/** 今天（民國） */
function rocToday() {
    return dateToRoc(new Date());
}

/** 某個民國年月有幾天 */
function daysInRocMonth(y, m) {
    return new Date(y + 1911, m, 0).getDate();
}

/**
 * 月曆格子：固定 42 格（6 列 × 7 天）
 *
 * 不足的位置補 null。這是「面板高度永遠不變」的關鍵 ——
 * 任何年月都是 42 格，畫出來的高度一模一樣。
 *
 * @return {Array<number|null>}
 */
function buildMonthCells(y, m) {
    const firstWeekday = new Date(y + 1911, m - 1, 1).getDay();   // 1 號是星期幾
    const days = daysInRocMonth(y, m);

    const cells = [];
    for (let i = 0; i < firstWeekday; i++) cells.push(null);
    for (let d = 1; d <= days; d++) cells.push(d);
    while (cells.length < 42) cells.push(null);
    return cells;
}

/**
 * 換月／換年後把「日」夾回該月存在的範圍
 *
 * 例：1 月 31 日切到 2 月，31 日不存在，夾成 28（或閏年 29）。
 * 不夾的話 new Date() 會自己溢位到 3 月，日期悄悄跳掉一個月。
 */
function clampRocDay(roc) {
    const max = daysInRocMonth(roc.y, roc.m);
    return { y: roc.y, m: roc.m, d: Math.min(Math.max(1, roc.d), max) };
}

/** 月份加減（可跨年），並夾住日 */
function shiftRocMonth(roc, delta) {
    const total = roc.y * 12 + (roc.m - 1) + delta;
    return clampRocDay({ y: Math.floor(total / 12), m: (total % 12) + 1, d: roc.d });
}

/** 年份清單。範圍相對「今年」而不是相對目前選取的年，捲動位置才穩定 */
function rocYearList(range) {
    const base = rocToday().y;
    const from = base + (range && range[0] !== undefined ? range[0] : -5);
    const to = base + (range && range[1] !== undefined ? range[1] : 6);

    const list = [];
    for (let y = Math.min(from, to); y <= Math.max(from, to); y++) list.push(y);
    return list;
}

/** 比較兩個民國日期：a < b 回 -1，相等 0，a > b 回 1 */
function compareRoc(a, b) {
    const ka = a.y * 10000 + a.m * 100 + a.d;
    const kb = b.y * 10000 + b.m * 100 + b.d;
    return ka === kb ? 0 : (ka < kb ? -1 : 1);
}

/* ------------------------------------------------------------
 * DOM
 * ------------------------------------------------------------ */

const DP_WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

/* 目前這次開啟的狀態。draft 是「還沒按確定」的選擇，
   按取消就整個丟掉，不會動到呼叫端的任何資料。 */
let dpState = { draft: null, warnBefore: null, yearRange: null, onOk: null };

function initDatePicker() {
    if (document.getElementById('datePickerModal')) return;

    const wrap = document.createElement('div');
    wrap.innerHTML = `
    <div class="modal-overlay" id="datePickerModal">
        <div class="date-modal" data-pane="day">
            <div class="modal-header">
                <h3 id="datePickerTitle">選擇日期</h3>
                <button class="close-btn" type="button" data-dp="cancel">×</button>
            </div>

            <!-- 年、月分別是可點的，點下去換成對應的選單（見 data-pane） -->
            <div class="dp-nav">
                <button type="button" data-dp="prev" aria-label="上一個月">‹</button>
                <button type="button" class="dp-label" data-dp="pane-year" id="dpYearLabel">115 年</button>
                <button type="button" class="dp-label" data-dp="pane-month" id="dpMonthLabel">7 月</button>
                <button type="button" data-dp="next" aria-label="下一個月">›</button>
            </div>

            <div class="dp-week">${DP_WEEKDAYS.map(w => `<span>${w}</span>`).join('')}</div>

            <!-- 三個選單疊在同一個固定高度的框裡，切換時面板高度完全不變 -->
            <div class="dp-body">
                <div class="dp-grid" id="dpGrid"></div>
                <div class="dp-years" id="dpYears"></div>
                <div class="dp-months" id="dpMonths"></div>
            </div>

            <!-- 提示行：即使沒有內容也保留高度，面板才不會忽高忽低 -->
            <div class="dp-hint" id="dpHint"></div>

            <div class="dp-btns">
                <button type="button" data-dp="today">今天</button>
                <button type="button" data-dp="cancel">取消</button>
                <button type="button" class="ok" data-dp="ok">確定</button>
            </div>
        </div>
    </div>`;
    document.body.appendChild(wrap.firstElementChild);

    const modal = document.getElementById('datePickerModal');

    // 一個委派處理全部按鍵：新增按鍵只要加 data-dp，不必再綁一次
    modal.addEventListener('click', event => {
        if (event.target === modal) { closeDatePicker(); return; }

        const btn = event.target.closest('[data-dp]');
        if (btn) { dpAction(btn.dataset.dp); return; }

        const day = event.target.closest('#dpGrid [data-day]');
        if (day) { dpPickDay(+day.dataset.day); return; }

        const year = event.target.closest('#dpYears [data-year]');
        if (year) { dpPickYear(+year.dataset.year); return; }

        const month = event.target.closest('#dpMonths [data-month]');
        if (month) { dpPickMonth(+month.dataset.month); return; }
    });
}

function dpPanel() { return document.querySelector('#datePickerModal .date-modal'); }
function dpPane(name) { const p = dpPanel(); if (p) p.dataset.pane = name; }

function dpAction(action) {
    switch (action) {
        case 'prev': dpState.draft = shiftRocMonth(dpState.draft, -1); dpRender(); vibrate(20); break;
        case 'next': dpState.draft = shiftRocMonth(dpState.draft, 1); dpRender(); vibrate(20); break;
        case 'pane-year': dpPane('year'); dpRender(); vibrate(20); break;
        case 'pane-month': dpPane('month'); dpRender(); vibrate(20); break;
        case 'today': dpState.draft = rocToday(); dpPane('day'); dpRender(); vibrate(20); break;
        case 'cancel': closeDatePicker(); break;
        case 'ok': dpConfirm(); break;
    }
}

function dpPickDay(d) {
    dpState.draft = clampRocDay({ y: dpState.draft.y, m: dpState.draft.m, d: d });
    dpRender();
    vibrate(20);
}

function dpPickYear(y) {
    dpState.draft = clampRocDay({ y: y, m: dpState.draft.m, d: dpState.draft.d });
    dpPane('day');
    dpRender();
    vibrate(20);
}

function dpPickMonth(m) {
    dpState.draft = clampRocDay({ y: dpState.draft.y, m: m, d: dpState.draft.d });
    dpPane('day');
    dpRender();
    vibrate(20);
}

/** 這個日期是否早於警示門檻 */
function dpIsBeforeWarn(roc) {
    if (!dpState.warnBefore) return false;
    return compareRoc(roc, dpState.warnBefore) < 0;
}

function dpRender() {
    const draft = dpState.draft;
    const today = rocToday();

    document.getElementById('dpYearLabel').textContent = draft.y + ' 年';
    document.getElementById('dpMonthLabel').textContent = draft.m + ' 月';

    // 日曆：固定 42 格
    document.getElementById('dpGrid').innerHTML = buildMonthCells(draft.y, draft.m).map(d => {
        if (d === null) return '<span class="dp-day blank"></span>';
        const cell = { y: draft.y, m: draft.m, d: d };
        const cls = ['dp-day'];
        if (d === draft.d) cls.push('sel');
        if (compareRoc(cell, today) === 0) cls.push('today');
        if (dpIsBeforeWarn(cell)) cls.push('past');
        return `<span class="${cls.join(' ')}" data-day="${d}">${d}</span>`;
    }).join('');

    // 年份清單
    document.getElementById('dpYears').innerHTML = rocYearList(dpState.yearRange).map(y =>
        `<button type="button" class="dp-cell${y === draft.y ? ' sel' : ''}${y === today.y ? ' today' : ''}" data-year="${y}">${y}</button>`
    ).join('');

    // 月份
    let months = '';
    for (let m = 1; m <= 12; m++) {
        const isNow = draft.y === today.y && m === today.m;
        months += `<button type="button" class="dp-cell${m === draft.m ? ' sel' : ''}${isNow ? ' today' : ''}" data-month="${m}">${m} 月</button>`;
    }
    document.getElementById('dpMonths').innerHTML = months;

    // 提示行
    const hint = document.getElementById('dpHint');
    if (dpIsBeforeWarn(draft)) {
        hint.textContent = '這是過去的日期，確認是要補登嗎？';
        hint.classList.add('warn');
    } else {
        hint.textContent = `${draft.y} 年 ${draft.m} 月 ${draft.d} 日（${DP_WEEKDAYS[rocToDate(draft).getDay()]}）`;
        hint.classList.remove('warn');
    }
}

/**
 * 開啟日期選擇器
 * @param {Object} opts 見檔頭說明
 */
function openDatePicker(opts) {
    initDatePicker();
    const o = opts || {};

    let draft;
    if (o.value instanceof Date) draft = dateToRoc(o.value);
    else if (o.value && typeof o.value === 'object' && o.value.y) draft = clampRocDay(o.value);
    else draft = rocToday();

    dpState = {
        draft: draft,
        warnBefore: o.warnBefore === 'today' ? rocToday() : (o.warnBefore || null),
        yearRange: o.yearRange || null,
        onOk: typeof o.onOk === 'function' ? o.onOk : null
    };

    document.getElementById('datePickerTitle').textContent = o.title || '選擇日期';
    dpPane('day');
    dpRender();
    document.getElementById('datePickerModal').style.display = 'flex';
    vibrate(30);
}

function closeDatePicker() {
    const modal = document.getElementById('datePickerModal');
    if (modal) modal.style.display = 'none';
    dpState.onOk = null;          // 關掉之後不可能再回呼，避免殘留
    vibrate();
}

function dpConfirm() {
    const roc = dpState.draft;
    const cb = dpState.onOk;
    closeDatePicker();
    // 同時給民國物件與 Date：支票頁內部用 Date、發票頁用民國，兩邊都不必自己換算
    if (cb) cb({ y: roc.y, m: roc.m, d: roc.d }, rocToDate(roc));
}

/* 與 common-modals.js 相同的作法：載入即注入，各頁不必呼叫任何初始化 */
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDatePicker);
} else {
    initDatePicker();
}
