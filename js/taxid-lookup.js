/* ============================================================
   統一編號 → 公司抬頭　離線查詢
   ------------------------------------------------------------
   【為什麼不直接呼叫政府 API】
   財政部與經濟部的統編查詢 API 都沒有回傳 CORS 標頭，
   瀏覽器一律擋掉跨網域請求。本站是純靜態的 GitHub Pages，
   沒有後端可以代打，所以 API 這條路走不通。

   【改用的做法】
   由 GitHub Actions 每月把「全國營業(稅籍)登記資料集」下載下來，
   切成 1000 個小檔放進 data/taxid/。使用者輸入統編時，
   只抓對應的那一個小檔（壓縮後約 10KB）在手機端本地比對。

   結果：查詢是本地運算，比呼叫 API 還快，而且抓過的分片
   會被 Service Worker 留著，之後同一段號碼離線也查得到。

   【設計原則】
   查不到就安靜地什麼都不做，絕不擋住使用者手動輸入抬頭。
   資料還沒建置（檔案 404）時整個功能自動休眠，頁面照常運作。
   ============================================================ */
(function (global) {
    'use strict';

    var BASE = 'taxid-data-base' in document.documentElement.dataset
        ? document.documentElement.dataset.taxidDataBase
        : '../data/taxid/';

    var PREFIX_LEN = 3;      // 與 scripts/build-taxid-index.py 的 PREFIX_LEN 必須一致
    var TIMEOUT_MS = 6000;   // 收訊差時不要無限等，超時就當作查不到

    var shards = {};   // 前3碼 -> { 後5碼: 名稱 }，本次開啟頁面內共用
    var pending = {};  // 前3碼 -> Promise，避免同一分片被重複下載
    var disabled = false;  // 索引尚未建置時整組休眠，不再發沒意義的請求

    /* 載入某一段號碼的分片。永遠 resolve，不會丟例外出去。 */
    function loadShard(prefix) {
        if (disabled) return Promise.resolve(null);
        if (shards[prefix]) return Promise.resolve(shards[prefix]);
        if (pending[prefix]) return pending[prefix];

        var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
        var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, TIMEOUT_MS);

        var p = fetch(BASE + prefix + '.json', ctrl ? { signal: ctrl.signal } : undefined)
            .then(function (res) {
                if (res.status === 404) {
                    // 這一段號碼沒有任何登記資料，屬於正常情況（不是錯誤）
                    shards[prefix] = {};
                    return shards[prefix];
                }
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json().then(function (json) {
                    shards[prefix] = json;
                    return json;
                });
            })
            .catch(function () {
                // 沒網路、超時、或索引根本還沒建置 —— 一律當作查不到
                return null;
            })
            .then(function (result) {
                clearTimeout(timer);
                delete pending[prefix];
                return result;
            });

        pending[prefix] = p;
        return p;
    }

    /* 使用者才打了前幾碼時就先把分片抓下來，
       等他打完 8 碼，資料通常已經在手機裡了，抬頭是「瞬間」跳出來的。 */
    function prefetch(partial) {
        if (typeof partial !== 'string' || partial.length < PREFIX_LEN) return;
        loadShard(partial.slice(0, PREFIX_LEN));
    }

    /* 查詢完整 8 碼統編，回傳 Promise<公司名稱 or 空字串> */
    function lookup(taxId) {
        if (typeof taxId !== 'string' || taxId.length !== 8 || !/^\d{8}$/.test(taxId)) {
            return Promise.resolve('');
        }
        return loadShard(taxId.slice(0, PREFIX_LEN)).then(function (map) {
            if (!map) return '';
            return map[taxId.slice(PREFIX_LEN)] || '';
        });
    }

    /* 索引的資料日期，給說明頁或設定頁顯示用 */
    function meta() {
        return fetch(BASE + 'meta.json')
            .then(function (r) { return r.ok ? r.json() : null; })
            .catch(function () { return null; });
    }

    /* 開頁時輕量探一次。
       只有在伺服器明確回 404（索引真的還沒建置）時才整組關掉；
       離線或連線失敗不關 —— 那種情況分片可能還在 Service Worker 快取裡，
       關掉反而害使用者連本來查得到的都查不到。 */
    function probe() {
        fetch(BASE + 'meta.json')
            .then(function (r) { if (r.status === 404) disabled = true; })
            .catch(function () { /* 離線：維持啟用，交給各分片自己去試 */ });
    }

    global.TaxIdLookup = {
        lookup: lookup,
        prefetch: prefetch,
        meta: meta,
        probe: probe,
        get disabled() { return disabled; }
    };
})(window);
