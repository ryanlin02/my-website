# 架構索引（給 AI 看的地圖）

> **這份文件的目的**：這個 repo 累積了將近 500 次修改，檔案不少。與其每次都把整個
> 資料夾讀進去，先讀這份文件找到「問題在哪一頁、哪一支檔案」，再只讀那幾支檔案。
> 大部分的修改只會動到 1～3 支檔案，不需要通篇掃描。
>
> 這是合迪股份有限公司重車業務部門的貸款業務員用的手機端工具箱（PWA，純靜態網站，
> 部署在 GitHub Pages：https://ryanlin02.github.io/my-website/）。四個工具頁：貸款試算、
> 支票開票、發票轉換、油資折讓。每頁各自獨立，靠幾支 `common-*.js` 共用邏輯與樣式。

## 先讀這個：改動時怎麼決定要讀哪些檔案

| 症狀／需求 | 該讀的檔案 |
|---|---|
| 計算頁（貸款試算）某個功能壞了 | `pages/calculator.html` + `js/calc-engine.js`（計算邏輯）/ `js/calc-ui.js`（畫面互動）/ `js/calc-storage.js`（存檔與歷史）+ `css/calculator.css` |
| 支票頁壞了 | `pages/check.html` + `js/check-engine.js` + `css/calculator.css`（共用底）+ `css/check.css`（支票頁專屬） |
| 發票頁壞了 | `pages/invoice.html` + `js/invoice-engine.js` + `css/invoice.css`；統編自動帶入另看 `js/taxid-lookup.js` |
| 加油頁壞了 | `pages/gas.html` + `js/gas-engine.js` + `css/gas.css`。**注意**：加油頁是唯一還沒重構完的頁面，已知技術債列在 `修改計劃-加油頁.md`（根目錄，故意沒歸檔，因為程式碼註解與 `tests/加油頁功能測試.js` 都還在引用它） |
| 數字鍵盤 / Toast / 確認彈窗行為異常（任何頁都可能） | `js/common-keypad.js`（邏輯）+ `js/common-modals.js`（注入的 DOM）+ `css/keypad.css`。**改這裡等於同時影響計算頁與支票頁**，另外兩頁各自有一部分自己的鍵盤整合 |
| 歷史紀錄（存檔清單）行為異常，四頁通用 | `js/common-history.js`（儲存層＋展開/編輯模式邏輯）+ `css/history.css`（面板樣式）。各頁自己的 `loadXxxHistory()` 渲染函式在該頁的引擎檔裡（見下方依賴表） |
| 日曆選擇器（支票頁、發票頁的日期欄） | `js/common-datepicker.js` |
| 外殼／首頁（tab 切換、安裝引導、PWA） | `index.html`（單一大檔，含內嵌 `<style>`，這是唯一還沒拆檔的頁面） |
| 離線快取 / PWA 更新版本號 | `sw.js`（快取清單，改動任何頁面資源後要確認有登記在這裡）、`manifest.json`、`scripts/bump-version.py`（推送後由 GitHub Actions 自動跑，見 `.github/workflows/version-bump.yml`） |
| 統編查詢查不到 / 資料太舊 | `data/taxid/`（分片索引，每月由 Actions 自動更新，見 `scripts/build-taxid-index.py`）+ `js/taxid-lookup.js` |
| 油價快捷鍵數字不對 | `data/fuel-prices.json`（每週一由 Actions 自動更新，見 `scripts/fetch-fuel-prices.py`） |
| 直接用網址打開某個 `pages/*.html` 會被導回首頁 | 這是刻意設計，見 `js/frame-guard.js`（防止繞過安裝引導） |
| 版面「內容跟標題列距離跑掉」這類間距問題 | 先看 `tests/版面守門測試.js` 開頭的說明——四頁的頂端間距全部收斂到一個變數 `--content-gap` 與外殼的 `--shell-header-h`，不要手調數字 |

## 目錄結構

```
my-website/
├── index.html              外殼頁：頂部標題列、四個工具頁的 tab 切換、
│                            iframe 容器、PWA 安裝引導。唯一還沒拆檔的頁面（2000+ 行含內嵌 CSS/JS）。
├── 404.html                 GitHub Pages 找不到頁面時的導向頁
├── manifest.json             PWA 設定（圖示、名稱、版本號）
├── sw.js                     Service Worker：離線快取清單 + 版本號
├── .htaccess                 （多半用不到，GitHub Pages 不吃 .htaccess，historic 殘留）
│
├── pages/                   四個工具頁（各自可獨立打開，但正常應在 index.html 的 iframe 裡使用）
│   ├── calculator.html       貸款試算
│   ├── check.html            支票開票
│   ├── invoice.html          發票金額轉換
│   └── gas.html               油資折讓試算
│
├── js/
│   ├── calc-engine.js         計算頁：核心試算公式
│   ├── calc-ui.js             計算頁：畫面互動、鍵盤輸入回填、初始化
│   ├── calc-storage.js        計算頁：存檔、歷史紀錄渲染
│   ├── check-engine.js        支票頁：全部邏輯（尚未像計算頁拆三支）
│   ├── invoice-engine.js      發票頁：全部邏輯（含格位大寫、統編串接）
│   ├── gas-engine.js          加油頁：全部邏輯（尚未重構，見上表加油頁那列）
│   ├── common-keypad.js       四頁共用：數字鍵盤/Toast/彈窗「邏輯」
│   ├── common-modals.js       四頁共用：數字鍵盤/彈窗/頁尾「DOM 注入」
│   ├── common-history.js      四頁共用：歷史紀錄儲存層 + 展開/編輯模式
│   ├── common-datepicker.js   支票頁、發票頁共用：日曆選擇器
│   ├── common-footer.js       四頁共用：頁尾（版本號顯示）
│   ├── taxid-lookup.js        發票頁專用：統編離線查詢
│   └── frame-guard.js         四頁共用：偵測是否被直接開啟（見上表）
│
├── css/
│   ├── calculator.css        全站共用的 :root 設計 token 都宣告在這裡（歷史因素，名字沒改）
│   │                          + 計算頁專屬樣式。**支票頁也載入這份**當作底。
│   ├── check.css              支票頁專屬樣式，疊在 calculator.css 之上
│   ├── invoice.css            發票頁專屬樣式（獨立一份 :root，不吃 calculator.css）
│   ├── gas.css                 加油頁專屬樣式（獨立一份 :root，不吃 calculator.css）
│   ├── keypad.css              四頁共用：數字鍵盤與彈窗樣式
│   └── history.css             四頁共用：歷史紀錄面板樣式
│
├── instructions/             各頁「使用說明」的 iframe 內容（給業務員看的教學頁，非程式邏輯）
├── about/                    隱私權政策、服務條款（法務頁面）
├── icons/                    PWA 圖示
│
├── data/
│   ├── fuel-prices.json      中油/台塑油價（GitHub Actions 每週一自動更新）
│   └── taxid/                 統編查詢分片索引，1000+ 個小檔（GitHub Actions 每月自動更新，勿手動編輯）
│
├── scripts/                  三支 Python 腳本，全部由 .github/workflows 排程自動執行，平常不需要手動跑
│   ├── build-taxid-index.py   建置 data/taxid/
│   ├── fetch-fuel-prices.py   更新 data/fuel-prices.json
│   └── bump-version.py        推送後自動遞增 sw.js / manifest.json 的版本號
│
├── .github/workflows/        三個排程：油價週更、統編月更、版本號 push 後自動遞增
│
├── tests/                    純 Node 測試（不會部署，只在本機跑，見 tests/README.md）
│   └── invoice/               發票頁專屬測試（另有 tests/invoice/README.md）
│
└── docs/archive/             【2026/07 新增】已完成工作的歷史規劃/成果/健檢文件，
                               程式碼沒有引用它們。要查某次改版的設計理由再進來翻，
                               平常可以整個資料夾跳過不讀。
```

## 各工具頁的依賴關係（實際載入順序）

| 頁面 | 載入的 JS（依序） | 載入的 CSS（依序） |
|---|---|---|
| `pages/calculator.html` | frame-guard → calc-engine → common-keypad → common-history → calc-storage → calc-ui → common-modals → common-footer | keypad.css → history.css → calculator.css |
| `pages/check.html` | frame-guard → common-keypad → common-modals → common-datepicker → common-footer → common-history → check-engine | keypad.css → history.css → calculator.css → check.css |
| `pages/invoice.html` | frame-guard → common-keypad → common-modals → common-datepicker → common-footer → taxid-lookup → common-history → invoice-engine | keypad.css → history.css → invoice.css |
| `pages/gas.html` | frame-guard → common-keypad → common-modals → common-history → gas-engine → common-footer | keypad.css → history.css → gas.css |

（另外每頁都會載入 Google Analytics 的 gtag.js；計算頁多載入 html2canvas，用於歷史卡片/分享功能的截圖。）

## 根目錄殘留的 .md 文件說明

- `README.md` —— 給人看的專案介紹（功能列表、技術特色），不是給 AI 的索引，內容比較舊，之後有大改版再一併更新。
- `GA4後台設定清單.md` —— GA4 後台事件設定的操作清單，跟程式碼無關，設定 GA4 時才需要看。
- `修改計劃-加油頁.md` —— **唯一還在使用中**的規劃文件，加油頁重構的階段清單，`js/gas-engine.js` 開頭註解與 `tests/加油頁功能測試.js` 都還在引用它。加油頁重構完成前不要移動或刪除。
- `docs/archive/` —— 其餘 11 份「修改計劃 / 修改成果 / 健檢報告」md，都是已完成工作的歷史記錄，程式碼裡沒有任何引用，2026/07/30 從根目錄搬進來歸檔。

## 給 AI 助理的具體建議

1. **不要一開始就整包讀資料夾。** 先看使用者描述的症狀屬於哪一頁，用上面「先讀這個」
   那張表鎖定 2～4 支檔案，讀那些就夠了。
2. **`docs/archive/` 預設跳過**，除非使用者明確要問「當初為什麼這樣設計」或「這個功能
   的修改歷史」。
3. **四頁共用的 `common-*.js` / `keypad.css` / `history.css` 一旦要改，記得同時考慮
   四頁**，改完務必跑 `tests/` 對應的測試（`tests/README.md` 裡有「什麼時候一定要跑
   哪支測試」的對照表，非常值得先看一眼）。
4. **`data/` 與 `scripts/` 是自動化產物**，正常不需要手動改，除非使用者要調整抓取
   邏輯或分片規則本身。
5. 專案的註解習慣是把「為什麼」寫在程式碼原地（包含「為什麼移除某段舊寫法」），
   所以很多時候答案已經在檔案的註解裡，不需要另外找文件。

---
最後更新：2026-07-30。若之後又有大規模重構（尤其是加油頁重構完成、或 index.html
拆檔），麻煩回來更新這份文件的目錄結構與依賴表。
