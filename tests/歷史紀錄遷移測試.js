/**
 * 歷史紀錄共用儲存層 —— 遷移與行為測試
 * ============================================================
 * 【這支測試存在的原因】
 *
 * 步驟 2 把三頁各自的存取邏輯換成 js/common-history.js。
 * 這件事最大的風險不是寫錯計算，是**使用者既有的歷史資料讀不回來**——
 * 而且這種錯誤不會拋例外、不會有紅字，就只是某個欄位變成 undefined，
 * 畫面上顯示成空白，等業務發現的時候已經過了好幾天。
 *
 * 所以這支測試的第一原則是：**用真實的舊格式餵進去，逐欄位比對**。
 * 下面三份樣本是從各頁改版前的程式碼裡照抄出來的，不是我編的：
 *   calc    → calc-storage.js  saveLoanData() 寫進去的形狀
 *   check   → check-engine.js  commitCheckData() 寫進去的形狀
 *   invoice → invoice-engine.js snapshot() 寫進去的形狀
 *
 * 執行：node tests/歷史紀錄遷移測試.js
 * ============================================================
 */

const path = require('path');
const H = require(path.join(__dirname, '../js/common-history.js'));

let pass = 0, fail = 0;
const t = (name, cond, extra = '') => {
    cond ? pass++ : fail++;
    console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '   → ' + extra));
};

/* ------------------------------------------------------------
   最小的 localStorage 與 showToast 替身
   ------------------------------------------------------------ */
const toasts = [];
let store = {};
global.localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
};
global.showToast = (msg, isError) => toasts.push({ msg: String(msg), isError: !!isError });

function reset() { store = {}; toasts.length = 0; }
function seed(key, arr) { store[key] = JSON.stringify(arr); }

/* ------------------------------------------------------------
   真實的舊格式樣本（照抄自改版前的程式碼）
   ------------------------------------------------------------ */
const LEGACY_CALC = {
    id: 1785300000000,
    date: '2026-07-28 14:30',
    period: '36',
    rate: '8.5',
    principal: '1000000',
    payment: '31000',
    afterTaxRate: '8.1234',
    commission: '20000',
    afterCommissionRate: '9.5678',
    totalInterest: '116000',
    timestamp: '2026-07-28T06:30:00.000Z',
    note: '客戶要求月底前回覆'
};

const LEGACY_CHECK = {
    id: 1785300001000,
    date: '2026-07-28',
    totalAmount: 1200000,
    paymentAmount: 100000,
    checkCount: 12,
    depositAmount: 100000,
    startDate: '2026-08-05T00:00:00.000Z',
    timestamp: '2026-07-28T07:00:00.000Z',
    note: '第一批',
    written: [true, true, false, false, false, false, false, false, false, false, false, false]
};

const LEGACY_INVOICE = {
    id: 1785300002000,
    type: '3',
    taxId: '12345678',
    title: '大發運輸有限公司',
    date: { y: 115, m: 7, d: 28 },
    items: [{ name: '車輛租賃', qty: 1, price: 500000 }],
    lockTotal: null,
    total: 525000
};

/* ============================================================
   一、舊資料一個欄位都不能掉
   ============================================================ */
console.log('\n舊資料遷移 —— 逐欄位比對');

function checkNoFieldLost(label, legacy, tool, metaKeys) {
    reset();
    seed('K', [legacy]);
    const s = H.createHistoryStore({ key: 'K', tool: tool });
    const rec = s.list()[0];

    t(`${label}：讀得回來`, !!rec);
    if (!rec) return;

    t(`${label}：id 不變`, rec.id === legacy.id, `${rec.id} vs ${legacy.id}`);
    t(`${label}：標記為 ${tool}`, rec.tool === tool, rec.tool);
    t(`${label}：有結構版本`, rec.v === 1, String(rec.v));

    // 除了外殼欄位以外，其餘每一個都必須原封不動出現在 data 裡
    const missing = [];
    for (const k in legacy) {
        if (metaKeys.includes(k)) continue;
        if (JSON.stringify(rec.data[k]) !== JSON.stringify(legacy[k])) {
            missing.push(`${k}（存進去 ${JSON.stringify(legacy[k])}，讀出來 ${JSON.stringify(rec.data[k])}）`);
        }
    }
    t(`${label}：data 裡每個欄位都對得上`, missing.length === 0, missing.join('；'));
}

checkNoFieldLost('計算頁', LEGACY_CALC, 'calc', ['id', 'timestamp', 'note']);
checkNoFieldLost('支票頁', LEGACY_CHECK, 'check', ['id', 'timestamp', 'note']);
checkNoFieldLost('發票頁', LEGACY_INVOICE, 'invoice', ['id']);

{
    reset();
    seed('K', [LEGACY_CALC]);
    const rec = H.createHistoryStore({ key: 'K', tool: 'calc' }).list()[0];
    t('計算頁：備註搬到外殼且內容不變', rec.note === LEGACY_CALC.note, rec.note);
    t('計算頁：timestamp 變成 savedAt', rec.savedAt === LEGACY_CALC.timestamp, rec.savedAt);
}

{
    reset();
    seed('K', [LEGACY_CHECK]);
    const rec = H.createHistoryStore({ key: 'K', tool: 'check' }).list()[0];
    t('支票頁：打勾進度陣列完整保留',
        JSON.stringify(rec.data.written) === JSON.stringify(LEGACY_CHECK.written));
}

{
    // 發票頁舊格式沒有 timestamp，只能從 id 回推
    reset();
    seed('K', [LEGACY_INVOICE]);
    const rec = H.createHistoryStore({ key: 'K', tool: 'invoice' }).list()[0];
    t('發票頁：沒有 timestamp 時由 id 回推存檔時間',
        rec.savedAt === new Date(LEGACY_INVOICE.id).toISOString(), rec.savedAt);
    t('發票頁：沒有備註欄位時給空字串（不是 undefined）', rec.note === '', JSON.stringify(rec.note));
    t('發票頁：抬頭與統編順手填進外殼的 customer',
        rec.customer && rec.customer.taxId === '12345678' && rec.customer.title === '大發運輸有限公司',
        JSON.stringify(rec.customer));
}

{
    // 我沒想到的欄位也不能掉 —— 這是「不列舉欄位名稱」這個設計的重點
    reset();
    seed('K', [Object.assign({}, LEGACY_CALC, { 某個我沒想到的欄位: '重要資料', extra: [1, 2, 3] })]);
    const rec = H.createHistoryStore({ key: 'K', tool: 'calc' }).list()[0];
    t('未知欄位也會被保留下來',
        rec.data['某個我沒想到的欄位'] === '重要資料' &&
        JSON.stringify(rec.data.extra) === '[1,2,3]',
        JSON.stringify(rec.data));
}

{
    // 遷移必須是唯讀的：光是讀取不可以改寫磁碟上的舊資料
    reset();
    seed('K', [LEGACY_CALC]);
    const before = store['K'];
    H.createHistoryStore({ key: 'K', tool: 'calc' }).list();
    t('只是讀取不會改寫磁碟上的舊資料', store['K'] === before);
}

{
    // 新舊混在一起也要能用
    reset();
    const s0 = H.createHistoryStore({ key: 'K', tool: 'calc' });
    seed('K', [LEGACY_CALC]);
    s0.save({ period: '48' });
    const list = H.createHistoryStore({ key: 'K', tool: 'calc' }).list();
    t('新舊格式混在同一份清單也讀得出來', list.length === 2, `實際 ${list.length} 筆`);
    t('混合清單裡舊資料的欄位仍然完整',
        list.some(r => r.data.period === '36' && r.data.principal === '1000000'));
}

{
    // 已經是信封的不可以再包一層
    reset();
    const s = H.createHistoryStore({ key: 'K', tool: 'calc' });
    s.save({ period: '36' });
    const once = s.list()[0];
    const twice = H.createHistoryStore({ key: 'K', tool: 'calc' }).list()[0];
    t('重複讀取不會把信封再包一層',
        twice.data.period === '36' && twice.data.data === undefined,
        JSON.stringify(twice.data));
    t('重複讀取 id 穩定不變', once.id === twice.id);
}

/* ============================================================
   二、壞掉的資料不可以讓整頁爆掉
   ============================================================ */
console.log('\n資料損毀的防禦');

{
    reset(); store['K'] = '{壞掉的 JSON';
    t('JSON 壞掉時回空陣列而不是拋例外',
        H.createHistoryStore({ key: 'K', tool: 'calc' }).list().length === 0);
}
{
    reset(); store['K'] = '{"不是":"陣列"}';
    t('存的不是陣列時回空陣列',
        H.createHistoryStore({ key: 'K', tool: 'calc' }).list().length === 0);
}
{
    reset(); seed('K', [null, LEGACY_CALC, '字串', 42]);
    const list = H.createHistoryStore({ key: 'K', tool: 'calc' }).list();
    t('陣列裡混了垃圾時只留下有效的那筆', list.length === 1, `實際 ${list.length} 筆`);
}
{
    reset(); store['K'] = undefined; delete store['K'];
    t('完全沒有資料時回空陣列',
        H.createHistoryStore({ key: 'K', tool: 'calc' }).list().length === 0);
}

/* ============================================================
   三、Store 的基本行為
   ============================================================ */
console.log('\nStore 行為');

{
    reset();
    const s = H.createHistoryStore({ key: 'K', tool: 'calc' });
    const ids = [];
    for (let i = 0; i < 50; i++) ids.push(s.save({ n: i }).id);
    t('同步連存 50 筆，id 全部不重複', new Set(ids).size === 50);
    t('id 都在安全整數範圍內', ids.every(Number.isSafeInteger));
    t('存了 50 筆就是 50 筆', s.count() === 50, String(s.count()));
}

{
    reset();
    const s = H.createHistoryStore({ key: 'K', tool: 'calc' });
    const a = s.save({ n: 1 }).id;
    s.save({ n: 2 });
    s.remove(a);
    t('刪一筆只會少一筆', s.count() === 1, String(s.count()));
    t('刪掉的正是指定那筆', s.get(a) === null);
}

{
    reset();
    const s = H.createHistoryStore({ key: 'K', tool: 'calc' });
    const id = s.save({ n: 1 }, { note: '原始備註' }).id;
    const r = s.save({ n: 999 }, { overwriteId: id });
    t('覆蓋不會新增一筆', s.count() === 1, String(s.count()));
    t('覆蓋會回報 overwritten', r.overwritten === true);
    t('覆蓋後資料是新的', s.get(id).data.n === 999);
    t('覆蓋不會洗掉使用者寫的備註', s.get(id).note === '原始備註', s.get(id).note);
}

{
    reset();
    const s = H.createHistoryStore({ key: 'K', tool: 'calc' });
    const r = s.save({ n: 1 }, { overwriteId: 999999 });
    t('要覆蓋的那筆已不存在時改為新增', s.count() === 1 && r.overwritten === false);
}

{
    reset();
    const s = H.createHistoryStore({ key: 'K', tool: 'check' });
    const id = s.save({ checkCount: 12, written: [true, false] }).id;
    s.patchData(id, { written: [true, true] });
    const rec = s.get(id);
    t('patchData 只改指定欄位', JSON.stringify(rec.data.written) === '[true,true]');
    t('patchData 不會動到其他欄位', rec.data.checkCount === 12);
    t('patchData 對不存在的 id 回 false', s.patchData(999999, { x: 1 }) === false);
}

{
    reset();
    const s = H.createHistoryStore({ key: 'K', tool: 'calc' });
    const id = s.save({ n: 1 }).id;
    s.setNote(id, '之後補的備註');
    t('setNote 寫得進去', s.get(id).note === '之後補的備註');
    t('setNote 對不存在的 id 回 false', s.setNote(999999, 'x') === false);
}

{
    reset();
    const s = H.createHistoryStore({ key: 'K', tool: 'calc' });
    s.save({ n: 1 }); s.save({ n: 2 });
    s.clear();
    t('clear 之後一筆不剩', s.count() === 0);
}

{
    // 排序：新的在前
    reset();
    seed('K', [
        { id: 1, timestamp: '2026-01-01T00:00:00.000Z', a: '舊' },
        { id: 2, timestamp: '2026-07-01T00:00:00.000Z', a: '新' },
        { id: 3, timestamp: '2026-03-01T00:00:00.000Z', a: '中' }
    ]);
    const list = H.createHistoryStore({ key: 'K', tool: 'calc' }).list();
    t('清單依存檔時間新到舊排序',
        list.map(r => r.data.a).join(',') === '新,中,舊',
        list.map(r => r.data.a).join(','));
}

/* ============================================================
   四、容量與上限
   ============================================================ */
console.log('\n容量與上限');

{
    reset();
    const s = H.createHistoryStore({ key: 'K', tool: 'calc', max: 3 });
    for (let i = 0; i < 5; i++) s.save({ n: i });
    t('超過上限會裁掉最舊的', s.count() === 3, String(s.count()));
    t('留下來的是最新的三筆',
        s.list().map(r => r.data.n).join(',') === '4,3,2',
        s.list().map(r => r.data.n).join(','));
    t('裁掉紀錄時會明確告知，不是靜默丟棄',
        toasts.some(x => /上限/.test(x.msg)),
        JSON.stringify(toasts));
}

{
    // 容量滿：必須告知失敗，而且不可以把例外往外丟
    reset();
    const s = H.createHistoryStore({ key: 'K', tool: 'calc' });
    const origSet = global.localStorage.setItem;
    global.localStorage.setItem = () => { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; };

    let threw = false, result;
    try { result = s.save({ n: 1 }); } catch (e) { threw = true; }
    global.localStorage.setItem = origSet;

    t('容量滿時不把例外往外丟', !threw);
    t('容量滿時回報 ok:false', result && result.ok === false, JSON.stringify(result));
    t('容量滿時有跳出錯誤提示',
        toasts.some(x => x.isError && /儲存失敗/.test(x.msg)),
        JSON.stringify(toasts));
}

/* ============================================================
   五、存檔時間的顯示格式
   ------------------------------------------------------------
   業務回頭找舊紀錄時記得的是「那是禮拜二下午談的」，
   所以時分是有效的回想線索。「今天／昨天」比完整日期短，
   而且直接回答「這筆是今天早上還是下午」。
   ============================================================ */
console.log('\n存檔時間的顯示');

{
    const F = H.formatSavedAt;
    const at = (daysAgo, h, m) => {
        const d = new Date();
        d.setDate(d.getDate() - daysAgo);
        d.setHours(h, m, 30, 0);
        return d.toISOString();
    };

    t('今天顯示「今天 HH:MM」', F(at(0, 14, 30)) === '今天 14:30', F(at(0, 14, 30)));
    t('昨天顯示「昨天 HH:MM」', F(at(1, 9, 5)) === '昨天 09:05', F(at(1, 9, 5)));

    t('不含秒數', !/:\d{2}:\d{2}/.test(F(at(0, 14, 30))), F(at(0, 14, 30)));

    const older = at(30, 8, 0);
    const od = new Date(older);
    const expect = od.getFullYear() === new Date().getFullYear()
        ? `${String(od.getMonth() + 1).padStart(2, '0')}/${String(od.getDate()).padStart(2, '0')} 08:00`
        : `${od.getFullYear()}/${String(od.getMonth() + 1).padStart(2, '0')}/${String(od.getDate()).padStart(2, '0')} 08:00`;
    t('更早的顯示日期＋時間', F(older) === expect, `${F(older)} vs ${expect}`);

    t('往年會帶出年份', /^\d{4}\//.test(F('2020-03-05T08:00:00')), F('2020-03-05T08:00:00'));
    t('時間不成立時回空字串（呼叫端自行留白）', F('壞掉的時間') === '' && F(undefined) === '');
}

/* ============================================================ */
console.log(`\n通過 ${pass}　失敗 ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
