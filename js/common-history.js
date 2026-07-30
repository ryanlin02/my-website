/**
 * 重車貸款業務工具箱 — 歷史紀錄共用儲存層 (common-history.js)
 * ============================================================
 * 【這支檔案存在的原因】
 *
 * 四個工具頁各自長出了一套存檔機制，於是同樣的問題被解了三次、
 * 而且每次解法都不一樣：id 怎麼產生、寫入失敗要不要告知、怎麼排序、
 * 要不要設上限、舊資料怎麼相容 —— 三頁三種答案，其中兩頁還有 bug。
 *
 * 這裡把「資料怎麼存」收成單一來源。各頁只負責「自己有哪些欄位」，
 * 其餘一律由這支處理。之後要改儲存方式、要加跨頁查詢，都只改這裡。
 *
 * 【資料信封】
 * 每一筆紀錄都長這樣：
 *
 *   {
 *     v:        1,                       結構版本，日後遷移的依據
 *     id:       1785390565236123,        毫秒 × 1000 + 亂數，同毫秒連按不會撞
 *     tool:     'calc'|'check'|'invoice'|'gas',
 *     savedAt:  '2026-07-30T05:12:33.000Z',
 *     note:     '',                      備註（四頁共用同一套編輯器）
 *     customer: null,                    預留：未來四頁連動時用來認出同一個客戶
 *     data:     { ...各頁原本的欄位原封不動 }
 *   }
 *
 * 各頁欄位全部包在 data 裡，外殼永遠只有這幾個。未來要做跨頁連動，
 * 只需要在外殼上填 customer，不必動任何一頁的計算邏輯。
 *
 * 【舊資料相容】
 * 舊格式是裸物件（沒有 v）。讀取時會自動包成信封，而且是
 * 「扣掉已知的外殼欄位，其餘全部放進 data」—— 不列舉欄位名稱，
 * 所以就算有我沒注意到的欄位也不會掉。
 *
 * 遷移只在讀取時發生，不會主動改寫磁碟上的舊資料；
 * 等使用者下次真的存檔時才會以新格式寫回。萬一遷移有問題，
 * 舊資料還在原地。
 *
 * 【改動本檔案時一定要跑】
 *   node tests/歷史紀錄遷移測試.js
 *   node tests/存檔安全性測試.js
 * ============================================================ */

/**
 * 產生不會碰撞、而且會遞增的 id
 *
 * 舊版計算頁用 new Date().getTime()，只有毫秒精度：同一毫秒連按兩次
 * 存檔會產生兩筆相同 id，之後刪一筆會把它們一起刪掉。
 * 乘 1000 之後約 1.7e15，仍遠低於 Number.MAX_SAFE_INTEGER。
 *
 * 【為什麼末三位是流水號而不是亂數】
 * 支票頁當初的修法是加亂數，那確實解決了碰撞，但同一毫秒內產生的 id
 * 大小順序是隨機的。時間戳相同時排序只能靠 id 決勝負，於是「哪一筆比較新」
 * 變成隨機的 —— 超過筆數上限要裁掉最舊的時候，裁掉的是隨機一筆。
 * 遷移測試就是這樣抓到的（存 0~4 五筆、上限 3，留下來的是 4,1,0）。
 * 改成流水號之後 id 嚴格遞增，等於插入順序，排序才有意義。
 */
let _historyIdLastMs = 0;
let _historyIdSeq = 0;

function createHistoryId() {
    const ms = Date.now();
    if (ms === _historyIdLastMs) {
        // 同一毫秒內連續產生（實務上只會發生在程式迴圈裡，人手點不到）
        if (_historyIdSeq < 999) _historyIdSeq++;
    } else {
        _historyIdLastMs = ms;
        _historyIdSeq = 0;
    }
    return ms * 1000 + _historyIdSeq;
}

/**
 * 舊格式的 id 就是 Date.now()（毫秒），可以拿來回推存檔時間。
 * 新格式是毫秒 × 1000，數量級差三位數，用這個界線分辨。
 */
const LEGACY_ID_CEILING = 1e14;

function historyIdToTime(id) {
    const n = Number(id);
    if (!isFinite(n) || n <= 0) return null;
    const ms = n < LEGACY_ID_CEILING ? n : Math.floor(n / 1000);
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * 把任意一筆紀錄整理成信封格式（已經是信封的原樣返回）
 *
 * 關鍵在於「不列舉 data 的欄位」：把外殼欄位挑掉，剩下的全部進 data。
 * 這樣就算舊資料有這裡沒想到的欄位，也一個都不會掉。
 */
function toHistoryEnvelope(record, tool) {
    if (!record || typeof record !== 'object') return null;

    if (record.v) {
        // 已經是信封，只補上可能缺的欄位
        return {
            v: record.v,
            id: record.id,
            tool: record.tool || tool,
            savedAt: record.savedAt || historyIdToTime(record.id) || new Date().toISOString(),
            note: typeof record.note === 'string' ? record.note : '',
            customer: record.customer || null,
            data: (record.data && typeof record.data === 'object') ? record.data : {}
        };
    }

    const data = {};
    for (const k in record) {
        if (!Object.prototype.hasOwnProperty.call(record, k)) continue;
        if (k === 'id' || k === 'note' || k === 'timestamp' || k === 'v' ||
            k === 'tool' || k === 'savedAt' || k === 'customer') continue;
        data[k] = record[k];
    }

    return {
        v: 1,
        id: (typeof record.id === 'number') ? record.id : createHistoryId(),
        tool: tool,
        savedAt: record.timestamp || historyIdToTime(record.id) || new Date().toISOString(),
        note: typeof record.note === 'string' ? record.note : '',
        // 發票頁的舊紀錄本來就帶著抬頭與統編，順手填進外殼；
        // 其他頁沒有客戶資訊，留 null 等未來連動時再填
        customer: (tool === 'invoice' && (record.taxId || record.title))
            ? { taxId: record.taxId || '', title: record.title || '' }
            : null,
        data: data
    };
}

/**
 * 把存檔時間格式化成給人看的字串
 *
 * 【為什麼要有時間，不只是日期】
 * 業務回頭找舊紀錄時，記得的往往是「那是禮拜二下午談的」而不是日期。
 * 時分是有效的回想線索，可以看出同一天談的兩個客戶誰先誰後。
 *
 * 【為什麼不到秒】
 * 沒有人記得自己是 14:30:45 跟客戶談的，秒數對回想沒有幫助，
 * 卻要多佔 3 個字元 —— 而這一行右邊緊接著徽章，400px 寬本來就在搶空間。
 *
 * 【為什麼用「今天／昨天」】
 * 「今天 14:30」比「2026/07/28 14:30」短，而且直接回答了
 * 「這筆是今天早上還是下午」。年份只在跨年度時才需要出現。
 *
 *   今天 14:30
 *   昨天 09:05
 *   07/26 14:30        今年
 *   2025/11/03 14:30   更早
 *
 * @param {string} iso 信封上的 savedAt
 * @return {string} 時間不成立時回傳空字串（呼叫端自行決定要不要留白）
 */
function formatSavedAt(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';

    const pad = n => String(n).padStart(2, '0');
    const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;

    const now = new Date();
    const sameDay = (a, b) =>
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate();

    if (sameDay(d, now)) return `今天 ${hm}`;

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (sameDay(d, yesterday)) return `昨天 ${hm}`;

    const md = `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
    if (d.getFullYear() === now.getFullYear()) return `${md} ${hm}`;
    return `${d.getFullYear()}/${md} ${hm}`;
}

/**
 * 建立一個歷史紀錄倉庫
 *
 * @param {Object} cfg
 * @param {string} cfg.key   localStorage 的鍵名（沿用各頁原本的，不改名）
 * @param {string} cfg.tool  'calc' | 'check' | 'invoice' | 'gas'
 * @param {number} cfg.max   筆數上限，超過時丟棄最舊的並明確告知
 */
function createHistoryStore(cfg) {
    const key = cfg.key;
    const tool = cfg.tool;
    const max = cfg.max || 200;

    function toast(msg, isError) {
        if (typeof showToast === 'function') showToast(msg, !!isError);
    }

    /** 讀出全部紀錄並整理成信封；資料損毀時回空陣列而不是讓整頁爆掉 */
    function readAll() {
        let raw;
        try {
            raw = JSON.parse(localStorage.getItem(key) || '[]');
        } catch (e) {
            return [];
        }
        if (!Array.isArray(raw)) return [];

        const out = [];
        for (let i = 0; i < raw.length; i++) {
            const env = toHistoryEnvelope(raw[i], tool);
            if (env) out.push(env);
        }
        return out;
    }

    /**
     * 寫回全部紀錄
     * @returns {boolean} 是否成功（無痕模式或容量已滿時會失敗）
     */
    function writeAll(list) {
        try {
            localStorage.setItem(key, JSON.stringify(list));
            return true;
        } catch (e) {
            toast('儲存失敗，裝置儲存空間可能已滿', true);
            return false;
        }
    }

    /** 依存檔時間新到舊 */
    function sortNewestFirst(list) {
        return list.sort(function (a, b) {
            const ta = new Date(a.savedAt).getTime() || 0;
            const tb = new Date(b.savedAt).getTime() || 0;
            if (tb !== ta) return tb - ta;
            return (b.id || 0) - (a.id || 0);
        });
    }

    /**
     * 超過上限時丟掉最舊的
     *
     * 舊版發票頁是靜默 slice(0, 100) —— 使用者的紀錄不見了卻毫無說明。
     * 這裡一律先告知再丟。
     */
    function trim(list) {
        if (list.length <= max) return list;
        const dropped = list.length - max;
        toast(`歷史已達 ${max} 筆上限，最舊的 ${dropped} 筆已移除`, true);
        return list.slice(0, max);
    }

    return {
        /** 全部紀錄，已排序（新→舊） */
        list: function () {
            return sortNewestFirst(readAll());
        },

        /** 單筆；找不到回 null。id 以寬鬆比對，容得下字串型別的 id */
        get: function (id) {
            const all = readAll();
            for (let i = 0; i < all.length; i++) {
                if (String(all[i].id) === String(id)) return all[i];
            }
            return null;
        },

        count: function () {
            return readAll().length;
        },

        /**
         * 存檔
         *
         * @param {Object} data                 這一頁自己的欄位
         * @param {Object} [opts]
         * @param {number} [opts.overwriteId]   有值代表覆蓋該筆；那筆已不存在時自動改為新增
         * @param {string} [opts.note]          新增時的初始備註（覆蓋時保留原備註）
         * @param {Object} [opts.customer]      預留欄位
         * @returns {{ok: boolean, id: (number|null), overwritten: boolean}}
         */
        save: function (data, opts) {
            opts = opts || {};
            const all = readAll();
            const now = new Date().toISOString();

            let index = -1;
            if (opts.overwriteId !== undefined && opts.overwriteId !== null) {
                for (let i = 0; i < all.length; i++) {
                    if (String(all[i].id) === String(opts.overwriteId)) { index = i; break; }
                }
            }

            let id;
            let overwritten = false;

            if (index >= 0) {
                // 覆蓋：備註是使用者另外寫的，不該被一次存檔洗掉
                id = all[index].id;
                overwritten = true;
                all[index] = {
                    v: 1,
                    id: id,
                    tool: tool,
                    savedAt: now,
                    note: (opts.note !== undefined) ? opts.note : all[index].note,
                    customer: (opts.customer !== undefined) ? opts.customer : all[index].customer,
                    data: data
                };
            } else {
                id = createHistoryId();
                all.push({
                    v: 1,
                    id: id,
                    tool: tool,
                    savedAt: now,
                    note: opts.note || '',
                    customer: opts.customer || null,
                    data: data
                });
            }

            const next = trim(sortNewestFirst(all));
            if (!writeAll(next)) return { ok: false, id: null, overwritten: false };
            return { ok: true, id: id, overwritten: overwritten };
        },

        /**
         * 只更新 data 裡的部分欄位（例如支票頁的打勾進度即時寫回）
         * 找不到該筆時回 false，呼叫端據此切斷連結
         */
        patchData: function (id, partial) {
            const all = readAll();
            let index = -1;
            for (let i = 0; i < all.length; i++) {
                if (String(all[i].id) === String(id)) { index = i; break; }
            }
            if (index === -1) return false;

            const merged = {};
            const src = all[index].data || {};
            for (const k in src) {
                if (Object.prototype.hasOwnProperty.call(src, k)) merged[k] = src[k];
            }
            for (const k in partial) {
                if (Object.prototype.hasOwnProperty.call(partial, k)) merged[k] = partial[k];
            }
            all[index].data = merged;

            return writeAll(all);
        },

        setNote: function (id, note) {
            const all = readAll();
            let found = false;
            for (let i = 0; i < all.length; i++) {
                if (String(all[i].id) === String(id)) { all[i].note = note; found = true; break; }
            }
            if (!found) return false;
            return writeAll(all);
        },

        remove: function (id) {
            const all = readAll();
            const next = [];
            for (let i = 0; i < all.length; i++) {
                if (String(all[i].id) !== String(id)) next.push(all[i]);
            }
            return writeAll(next);
        },

        clear: function () {
            try {
                localStorage.removeItem(key);
                return true;
            } catch (e) {
                // 移除失敗不影響畫面，呼叫端會照常重繪
                return false;
            }
        }
    };
}

/* ============================================================
   卡片的展開／收合（四頁共用）
   ------------------------------------------------------------
   【為什麼要收合】
   舊版一筆紀錄整張攤開，一個畫面只看得到四五筆。但業務打開歷史時
   要做的第一件事是「找到那一筆」，不是讀完每一筆的每個欄位 ——
   找的時候只需要日期、進度、一兩個關鍵數字。

   收合之後一筆兩行，一個畫面看得到八到十筆，找起來快得多；
   真的要看細節或要動作時再點開。

   順帶降低誤刪：刪除鈕收在展開後才出現，不會在捲動時被誤觸。

   【展開狀態要跨重繪保留】
   存備註、打勾、刪除都會讓面板整個重畫。如果狀態只寫在 DOM 上，
   使用者展開的那一筆會在存完備註後自己合起來 —— 所以記在這裡。
   ============================================================ */
const expandedHistoryIds = new Set();

function isHistoryExpanded(id) {
    return expandedHistoryIds.has(String(id));
}

/** 紀錄被刪掉時一併忘掉它的展開狀態，避免這個集合無限長大 */
function forgetHistoryExpanded(id) {
    expandedHistoryIds.delete(String(id));
}

function clearHistoryExpanded() {
    expandedHistoryIds.clear();
}

/* ============================================================
   編輯模式與多選刪除（四頁共用）
   ------------------------------------------------------------
   【為什麼要有這個模式】
   兩個問題用同一個東西解決：

   一、刪多筆的成本太高。一筆要點三次（展開 → 刪除 → 確定），
       清掉五筆就是十五次。編輯模式下是「進入 1 ＋ 選 5 ＋ 刪除 1
       ＋ 確定 1」＝ 八次，而且筆數越多省越多。

   二、「清空歷史」原本擺在標題列、就在關閉鈕旁邊，是個不可復原的
       動作卻只要誤觸一次。改成編輯模式之後，一般瀏覽時標題列上
       沒有任何破壞性按鈕；要刪東西得先明確進入編輯模式。
       「全選 → 刪除」也順勢取代了原本那顆「清空歷史」，
       不必再為同一件事保留兩個入口。

   【為什麼不用常駐的勾選框】
   收合行本來就緊（時間、進度、金額、張數、備註），再塞一個平常
   用不到的勾選框會把備註擠掉。備註是找紀錄時的辨識線索，
   比一年用兩次的多選重要。
   ============================================================ */
let historyEditMode = false;
const selectedHistoryIds = new Set();

/* 面板的設定（每頁一個面板，由該頁在初始化時註冊一次） */
let historyPanelCtx = null;

/**
 * 註冊歷史面板，並綁定展開／選取的事件委派
 *
 * @param {Object} cfg
 * @param {string} cfg.panelId      面板最外層元素的 id（編輯模式的 class 掛在這裡）
 * @param {string} cfg.containerId  清單容器的 id
 * @param {Object} cfg.store        該頁的 createHistoryStore(...)
 * @param {Function} cfg.onChange   資料變動後重新渲染清單的函式
 */
function setupHistoryPanel(cfg) {
    historyPanelCtx = cfg;

    const box = document.getElementById(cfg.containerId);
    if (!box || box.dataset.historyBound === '1') return;
    box.dataset.historyBound = '1';

    /* 用事件委派而不是每張卡片各綁一個：面板每次重畫都會換掉所有 DOM，
       逐張綁定會在每次重畫時累積成一堆殘留的監聽器。 */
    box.addEventListener('click', function (e) {
        const summary = e.target.closest('.history-item-summary');
        if (!summary) return;

        const item = summary.closest('.history-item');
        if (!item) return;

        const id = String(item.dataset.historyId || '');

        if (historyEditMode) {
            // 編輯模式下，點整列是「選取」而不是「展開」
            if (item.classList.toggle('selected')) selectedHistoryIds.add(id);
            else selectedHistoryIds.delete(id);
            updateHistoryEditUI();
        } else {
            if (item.classList.toggle('expanded')) expandedHistoryIds.add(id);
            else expandedHistoryIds.delete(id);
        }

        if (typeof vibrate === 'function') vibrate(15);
    });
}

/** 相容舊呼叫名稱（支票頁改版時用過） */
function setupHistoryExpand(containerId) {
    setupHistoryPanel({ containerId: containerId });
}

/** 渲染時直接串進 class 屬性：一次帶出展開與選取兩種狀態 */
function historyItemClass(id) {
    let cls = '';
    if (isHistoryExpanded(id)) cls += ' expanded';
    if (selectedHistoryIds.has(String(id))) cls += ' selected';
    return cls;
}

/** 勾選框：只有編輯模式看得到（由 CSS 控制），四頁共用同一段 HTML */
function historyCheckboxHtml() {
    return '<span class="history-check" aria-hidden="true"></span>';
}

function isHistoryEditMode() {
    return historyEditMode;
}

function enterHistoryEditMode() {
    historyEditMode = true;
    selectedHistoryIds.clear();
    updateHistoryEditUI();
    if (typeof vibrate === 'function') vibrate(20);
}

function exitHistoryEditMode() {
    historyEditMode = false;
    selectedHistoryIds.clear();
    if (historyPanelCtx && typeof historyPanelCtx.onChange === 'function') {
        historyPanelCtx.onChange();     // 重畫以清掉每一列的選取樣式
    }
    updateHistoryEditUI();
}

function toggleHistoryEditMode() {
    if (historyEditMode) exitHistoryEditMode();
    else enterHistoryEditMode();
}

/** 全選／取消全選（同一顆按鈕，依目前狀態切換） */
function toggleHistorySelectAll() {
    if (!historyPanelCtx || !historyPanelCtx.store) return;

    const all = historyPanelCtx.store.list().map(r => String(r.id));
    const allSelected = all.length > 0 && all.every(id => selectedHistoryIds.has(id));

    selectedHistoryIds.clear();
    if (!allSelected) all.forEach(id => selectedHistoryIds.add(id));

    if (typeof historyPanelCtx.onChange === 'function') historyPanelCtx.onChange();
    updateHistoryEditUI();
    if (typeof vibrate === 'function') vibrate(15);
}

/** 刪除所有已選取的紀錄 */
function deleteSelectedHistory() {
    if (!historyPanelCtx || !historyPanelCtx.store) return;

    const ids = [...selectedHistoryIds];
    if (ids.length === 0) return;

    const total = historyPanelCtx.store.count();
    const isAll = ids.length >= total;

    const doDelete = function () {
        ids.forEach(id => {
            historyPanelCtx.store.remove(id);
            forgetHistoryExpanded(id);
        });
        if (typeof historyPanelCtx.onDeleted === 'function') historyPanelCtx.onDeleted(ids);

        historyEditMode = false;
        selectedHistoryIds.clear();
        if (typeof historyPanelCtx.onChange === 'function') historyPanelCtx.onChange();
        updateHistoryEditUI();

        if (typeof showToast === 'function') {
            showToast(isAll ? '已清空歷史' : `已刪除 ${ids.length} 筆`);
        }
    };

    if (typeof showConfirmModal === 'function') {
        showConfirmModal(
            isAll ? '清空確認' : '刪除確認',
            isAll
                ? `確定要刪除全部 <b>${ids.length}</b> 筆歷史紀錄嗎？<br><br>此操作無法復原。`
                : `確定要刪除選取的 <b>${ids.length}</b> 筆紀錄嗎？<br><br>此操作無法復原。`,
            doDelete
        );
    } else {
        doDelete();
    }
}

/**
 * 更新標題列：筆數、按鈕文字、可否按、以及面板的編輯模式 class
 *
 * 標題列的兩套按鈕都寫在各頁的 HTML 裡，靠 class 切換顯示 ——
 * 這樣共用程式不需要組 DOM，各頁也保有調整版面的自由。
 */
function updateHistoryEditUI() {
    if (!historyPanelCtx) return;

    const panel = document.getElementById(historyPanelCtx.panelId);
    if (panel) panel.classList.toggle('edit-mode', historyEditMode);

    const count = selectedHistoryIds.size;

    const countEl = document.querySelector('.history-selected-count');
    if (countEl) countEl.textContent = `已選 ${count} 筆`;

    const delBtn = document.querySelector('.history-delete-selected');
    if (delBtn) {
        delBtn.disabled = (count === 0);
        delBtn.classList.toggle('is-disabled', count === 0);
    }

    const allBtn = document.querySelector('.history-select-all');
    if (allBtn && historyPanelCtx.store) {
        const total = historyPanelCtx.store.count();
        allBtn.textContent = (total > 0 && count >= total) ? '取消全選' : '全選';
    }
}

/* Node 測試環境用；瀏覽器不會有 module */
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        createHistoryStore, createHistoryId, toHistoryEnvelope, historyIdToTime, formatSavedAt,
        isHistoryExpanded, historyItemClass, forgetHistoryExpanded, clearHistoryExpanded,
        isHistoryEditMode, historyCheckboxHtml
    };
}
