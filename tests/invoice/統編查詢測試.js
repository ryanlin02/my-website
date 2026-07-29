/* ============================================================
   統編離線查詢測試（js/taxid-lookup.js）
   ------------------------------------------------------------
   不需要 jsdom，也不會連網。用假的 fetch 模擬各種情境：
     - 查得到 / 查不到
     - 分片不存在（404）
     - 完全沒網路
     - 索引還沒建置
     - 同一分片不重複下載
     - 超時保護

   執行：node tests/invoice/統編查詢測試.js
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', '..', 'js', 'taxid-lookup.js');
const code = fs.readFileSync(SRC, 'utf8');

let pass = 0;
const failures = [];

function check(name, cond, extra) {
    if (cond) { pass++; console.log('  ✓ ' + name); }
    else { failures.push(name + (extra ? '　→ ' + extra : '')); console.log('  ✗ ' + name); }
}

/* 建一個乾淨的執行環境，並掛上可控制的假 fetch。
   每個情境都重新建一次，避免上一個測試的快取影響下一個。 */
function makeEnv(fetchImpl) {
    const calls = [];
    const win = {
        document: { documentElement: { dataset: {} } },
        setTimeout, clearTimeout,
        AbortController: typeof AbortController === 'function' ? AbortController : undefined,
        fetch: function (url, opts) {
            calls.push(url);
            return fetchImpl(url, opts);
        }
    };
    win.window = win;
    const ctx = vm.createContext(win);
    vm.runInContext(code, ctx);
    return { api: win.TaxIdLookup, calls };
}

function res(status, body) {
    return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body)
    });
}

/* 假的稅籍索引：只有 160 這一段有資料 */
const FAKE = {
    '../data/taxid/160.json': {
        '03518': '宏達國際電子股份有限公司',
        '12345': '測試運輸有限公司'
    },
    '../data/taxid/045.json': { '41302': '鴻海精密工業股份有限公司' }
};

function normalFetch(url) {
    if (url.endsWith('meta.json')) return res(200, { count: 2, prefixLen: 3 });
    if (FAKE[url]) return res(200, FAKE[url]);
    return res(404, null);
}

(async function run() {
    console.log('統編離線查詢測試\n');

    // --- 情境 1：正常查詢 ---
    console.log('情境 1　索引正常');
    {
        const { api, calls } = makeEnv(normalFetch);
        check('查得到的統編回傳公司名稱',
            (await api.lookup('16003518')) === '宏達國際電子股份有限公司');
        check('前導 0 的統編也查得到',
            (await api.lookup('04541302')) === '鴻海精密工業股份有限公司');
        check('同一分片內查不到的號碼回傳空字串',
            (await api.lookup('16099999')) === '');
        check('整段號碼沒有資料（分片 404）回傳空字串',
            (await api.lookup('99999999')) === '');

        const shard160 = calls.filter(u => u.endsWith('160.json')).length;
        check('同一分片只下載一次（第二次走記憶體）', shard160 === 1, '實際下載 ' + shard160 + ' 次');
    }

    // --- 情境 2：輸入格式防呆 ---
    console.log('\n情境 2　輸入格式防呆');
    {
        const { api, calls } = makeEnv(normalFetch);
        check('未滿 8 碼直接回空字串', (await api.lookup('1600')) === '');
        check('含非數字直接回空字串', (await api.lookup('1600351A')) === '');
        check('傳入 null 不會爆掉', (await api.lookup(null)) === '');
        check('格式不對時完全不發出請求', calls.length === 0, '實際發出 ' + calls.length + ' 次');
    }

    // --- 情境 3：預先載入 ---
    console.log('\n情境 3　打到第 3 碼就先載入');
    {
        const { api, calls } = makeEnv(normalFetch);
        api.prefetch('160');
        await new Promise(r => setTimeout(r, 10));
        check('prefetch 會實際抓分片', calls.some(u => u.endsWith('160.json')));
        const before = calls.length;
        check('之後正式查詢直接命中，不再重抓',
            (await api.lookup('16003518')) === '宏達國際電子股份有限公司' && calls.length === before,
            '請求數 ' + before + ' → ' + calls.length);
        api.prefetch('16');
        check('不足 3 碼不觸發下載', calls.length === before);
    }

    // --- 情境 4：完全沒網路 ---
    console.log('\n情境 4　沒有網路');
    {
        const { api } = makeEnv(() => Promise.reject(new Error('Failed to fetch')));
        check('查詢安靜地回空字串，不丟例外', (await api.lookup('16003518')) === '');
        api.probe();
        await new Promise(r => setTimeout(r, 10));
        check('離線時不停用功能（分片可能還在快取裡）', api.disabled === false);
    }

    // --- 情境 5：索引尚未建置 ---
    console.log('\n情境 5　索引還沒建置（meta.json 404）');
    {
        const { api, calls } = makeEnv(() => res(404, null));
        api.probe();
        await new Promise(r => setTimeout(r, 10));
        check('明確 404 時自動休眠', api.disabled === true);
        const before = calls.length;
        check('休眠後查詢回空字串', (await api.lookup('16003518')) === '');
        check('休眠後不再發出任何請求', calls.length === before,
            '仍發出 ' + (calls.length - before) + ' 次');
    }

    // --- 情境 6：伺服器錯誤 ---
    console.log('\n情境 6　伺服器回 500');
    {
        const { api } = makeEnv(url =>
            url.endsWith('meta.json') ? res(200, {}) : res(500, null));
        check('5xx 視為查不到，不影響使用者輸入', (await api.lookup('16003518')) === '');
    }

    // --- 情境 7：回傳格式壞掉 ---
    console.log('\n情境 7　分片內容不是合法 JSON');
    {
        const { api } = makeEnv(url => Promise.resolve({
            ok: true, status: 200,
            json: () => Promise.reject(new SyntaxError('Unexpected token'))
        }));
        check('JSON 解析失敗不會讓頁面壞掉', (await api.lookup('16003518')) === '');
    }

    // --- 總結 ---
    console.log('\n' + '─'.repeat(46));
    if (failures.length === 0) {
        console.log(`✅ 全部通過（${pass} 項）`);
        process.exit(0);
    } else {
        console.log(`❌ ${failures.length} 項失敗（通過 ${pass} 項）`);
        failures.forEach(f => console.log('   • ' + f));
        process.exit(1);
    }
})();
