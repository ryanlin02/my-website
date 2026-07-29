/**
 * 安裝教學測試 —— 確認「開啟網頁不再被擋住」這件事沒有回頭路
 * ============================================================
 * 【這支測試存在的原因】
 *
 * 這個工具箱原本的設計是「強迫安裝」：一打開網頁就整片蓋住，
 * 不照著步驟裝成手機應用程式就沒辦法用，只有連點標題四下的隱藏後門能繞過。
 *
 * 2026/07 改成：開啟網頁什麼都不擋，安裝教學改放進主選單，想裝的人自己點。
 *
 * 這個改動最容易在日後被無意間改壞的地方有四個，這支測試就是在守這四件事：
 *
 *   A. 開啟網頁時絕對不能有任何東西蓋住畫面
 *   B. 主選單一定要有安裝入口（不然改成不強迫之後就永遠沒人找得到）
 *   C. 三種系統要顯示對的教學，而且 iPad 不能被當成桌機
 *      （iPad 用 Safari 會謊報自己是 Mac，這是蘋果的行為，不是我們的 bug）
 *   D. 用 LINE 內建瀏覽器開啟時要先提醒換瀏覽器
 *      （業務之間傳網址幾乎都用 LINE，而 LINE 裡面怎麼點都裝不起來）
 *
 * 需要先安裝 jsdom
 * 執行：node tests/安裝教學測試.js
 * ============================================================
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const t = (name, cond, extra = '') => {
    cond ? pass++ : fail++;
    console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '   → ' + extra));
};

/* ============================================================
 * 建立一個模擬的瀏覽器環境
 * ------------------------------------------------------------
 * @param {object} opts
 *   ua            - 要假裝成哪一種瀏覽器
 *   touchPoints   - 螢幕能同時偵測幾個手指（用來抓出偽裝成 Mac 的 iPad）
 *   standalone    - 是不是已經用安裝好的應用程式開啟
 * ============================================================ */
function buildPage(opts = {}) {
    const ua = opts.ua || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120';
    const touchPoints = opts.touchPoints || 0;
    const standalone = opts.standalone === true;

    const dom = new JSDOM(HTML, {
        url: 'https://ryanlin02.github.io/my-website/',
        runScripts: 'dangerously',
        pretendToBeVisual: true,
        resources: undefined,                   // 不去載入 iframe 與外部檔案
        userAgent: ua,
        beforeParse(window) {
            // 直接改寫瀏覽器識別字串。
            // jsdom 的 userAgent 選項在這個版本不一定吃得到，所以自己蓋上去比較保險。
            Object.defineProperty(window.navigator, 'userAgent', {
                value: ua,
                configurable: true
            });

            // jsdom 沒有 matchMedia，補一個最小可用的版本
            window.matchMedia = function (query) {
                return {
                    matches: standalone && /display-mode:\s*standalone/.test(query),
                    media: query,
                    addListener() {},
                    removeListener() {},
                    addEventListener() {},
                    removeEventListener() {}
                };
            };

            Object.defineProperty(window.navigator, 'maxTouchPoints', {
                value: touchPoints,
                configurable: true
            });

            if (standalone) {
                Object.defineProperty(window.navigator, 'standalone', {
                    value: true,
                    configurable: true
                });
            }
        }
    });

    return dom;
}

/** 等待畫面動畫用的計時器跑完 */
const tick = (dom, ms = 60) => new Promise(resolve => dom.window.setTimeout(resolve, ms));

/** 常見裝置的瀏覽器識別字串 */
const UA = {
    iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
    android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
    desktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    // iPad 用 Safari 開網頁時，回報的字串跟桌上型 Mac 一模一樣
    ipadSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15',
    macDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15',
    lineAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36 Line/14.1.0/IAB',
    lineIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1 Line/14.1.0'
};

/** 從主選單找到安裝入口那個連結 */
const installLink = doc => doc.querySelector('[data-install-guide="true"]');

/** 判斷某個元素現在是不是顯示中 */
const isShown = el => !!el && el.classList.contains('show');

async function run() {

    /* ============================================================
     * A. 開啟網頁時，畫面不能被任何東西擋住
     * ============================================================ */
    console.log('\n=== A. 開啟網頁不被擋住 ===');
    {
        const dom = buildPage({ ua: UA.iphone });
        await tick(dom);
        const doc = dom.window.document;

        t('舊的強制安裝遮罩已經完全移除',
            doc.querySelectorAll('.install-prompt-overlay').length === 0,
            '還找得到 .install-prompt-overlay');

        const overlay = doc.getElementById('installGuideOverlay');
        t('安裝教學彈窗存在', !!overlay);
        t('安裝教學彈窗預設不顯示', !isShown(overlay),
            '一開啟就跳出來了');

        t('載入保護記號已經解除',
            !doc.documentElement.classList.contains('booting'),
            'html 還留著 booting，畫面會一直是空白的');

        dom.window.close();
    }

    /* ============================================================
     * B. 主選單一定要有安裝入口
     * ============================================================ */
    console.log('\n=== B. 主選單的安裝入口 ===');
    {
        const dom = buildPage({ ua: UA.android });
        await tick(dom);
        const doc = dom.window.document;

        const link = installLink(doc);
        t('主選單有安裝入口', !!link);
        t('入口文字是「安裝手機應用程式」',
            !!link && link.textContent.trim() === '安裝手機應用程式',
            link ? link.textContent.trim() : '(找不到)');

        const section = doc.getElementById('installMenuSection');
        t('用瀏覽器開啟時入口看得到',
            !!section && section.style.display !== 'none');

        dom.window.close();
    }

    /* ============================================================
     * C. 點入口會開啟教學，關閉鍵會關掉
     * ============================================================ */
    console.log('\n=== C. 開啟與關閉 ===');
    {
        const dom = buildPage({ ua: UA.android });
        await tick(dom);
        const doc = dom.window.document;
        const overlay = doc.getElementById('installGuideOverlay');

        installLink(doc).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
        await tick(dom);
        t('點入口後教學會出現', isShown(overlay));

        doc.getElementById('installGuideClose')
            .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
        await tick(dom, 300);
        t('按關閉鍵後教學會收起來', !isShown(overlay));

        dom.window.close();
    }

    /* ============================================================
     * D. 三種系統顯示對的教學
     * ============================================================ */
    console.log('\n=== D. 系統偵測 ===');

    const platformCases = [
        { name: 'iPhone 顯示 iPhone 的步驟', ua: UA.iphone, touchPoints: 5, expect: 'iosSection' },
        { name: 'Android 顯示 Android 的步驟', ua: UA.android, touchPoints: 5, expect: 'androidSection' },
        { name: '電腦顯示電腦版的步驟', ua: UA.desktop, touchPoints: 0, expect: 'desktopSection' },
        // 這一項是重點：iPad 自稱 Mac，只能靠「螢幕支援多點觸控」認出來
        { name: 'iPad 偽裝成 Mac 時仍顯示 iPhone/iPad 的步驟', ua: UA.ipadSafari, touchPoints: 5, expect: 'iosSection' },
        { name: '真正的 Mac 顯示電腦版的步驟', ua: UA.macDesktop, touchPoints: 0, expect: 'desktopSection' }
    ];

    for (const c of platformCases) {
        const dom = buildPage({ ua: c.ua, touchPoints: c.touchPoints });
        await tick(dom);
        const doc = dom.window.document;

        installLink(doc).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
        await tick(dom);

        const shown = ['iosSection', 'androidSection', 'desktopSection']
            .filter(id => doc.getElementById(id).style.display === 'block');

        t(c.name,
            shown.length === 1 && shown[0] === c.expect,
            '實際顯示：' + (shown.join('、') || '（一段都沒顯示）'));

        dom.window.close();
    }

    /* ============================================================
     * E. LINE 內建瀏覽器的提醒
     * ============================================================ */
    console.log('\n=== E. LINE 內建瀏覽器提醒 ===');

    const lineCases = [
        { name: 'Android 版 LINE 開啟時會提醒換瀏覽器', ua: UA.lineAndroid, expect: true },
        { name: 'iPhone 版 LINE 開啟時會提醒換瀏覽器', ua: UA.lineIphone, expect: true },
        { name: '一般 Chrome 開啟時不會出現這個提醒', ua: UA.android, expect: false },
        { name: '一般 Safari 開啟時不會出現這個提醒', ua: UA.iphone, expect: false }
    ];

    for (const c of lineCases) {
        const dom = buildPage({ ua: c.ua, touchPoints: 5 });
        await tick(dom);
        const doc = dom.window.document;

        installLink(doc).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
        await tick(dom);

        t(c.name,
            isShown(doc.getElementById('installNoticeInApp')) === c.expect);

        dom.window.close();
    }

    /* ============================================================
     * F. 一鍵安裝按鈕：拿得到資格才出現
     * ============================================================ */
    console.log('\n=== F. 一鍵安裝按鈕 ===');
    {
        const dom = buildPage({ ua: UA.iphone, touchPoints: 5 });
        await tick(dom);
        const doc = dom.window.document;

        installLink(doc).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
        await tick(dom);

        t('iPhone 上不會出現一鍵安裝（蘋果不開放，出現了就是騙人）',
            !isShown(doc.getElementById('installGuideAction')));

        dom.window.close();
    }
    {
        const dom = buildPage({ ua: UA.android, touchPoints: 5 });
        await tick(dom);
        const doc = dom.window.document;

        // 還沒拿到安裝資格
        installLink(doc).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
        await tick(dom);
        t('沒有安裝資格時按鈕不出現',
            !isShown(doc.getElementById('installGuideAction')));

        // 模擬瀏覽器丟出安裝機會
        let promptCalled = false;
        const evt = new dom.window.Event('beforeinstallprompt', { cancelable: true });
        evt.prompt = () => { promptCalled = true; };
        evt.userChoice = Promise.resolve({ outcome: 'accepted' });
        dom.window.dispatchEvent(evt);
        await tick(dom);

        t('拿到安裝資格後按鈕會出現',
            isShown(doc.getElementById('installGuideAction')));

        doc.getElementById('installGuideAction')
            .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
        await tick(dom);

        t('按下去會叫出系統的安裝視窗', promptCalled);
        t('安裝機會用過一次就作廢，按鈕收起來',
            !isShown(doc.getElementById('installGuideAction')));

        dom.window.close();
    }

    /* ============================================================
     * G. 已經在用應用程式的人，不該再看到安裝入口
     * ============================================================ */
    console.log('\n=== G. 已安裝的情況 ===');
    {
        const dom = buildPage({ ua: UA.android, touchPoints: 5, standalone: true });
        await tick(dom);
        const doc = dom.window.document;

        const section = doc.getElementById('installMenuSection');
        t('以應用程式模式開啟時，主選單不出現安裝入口',
            !!section && section.style.display === 'none',
            '入口還在，已安裝的人會困惑');

        dom.window.close();
    }

    /* ============================================================
     * 結果
     * ============================================================ */
    console.log('\n============================================');
    console.log(`通過 ${pass} 項，失敗 ${fail} 項`);
    console.log('============================================\n');
    process.exit(fail === 0 ? 0 : 1);
}

run().catch(err => {
    console.error('測試本身出錯了：', err);
    process.exit(1);
});
