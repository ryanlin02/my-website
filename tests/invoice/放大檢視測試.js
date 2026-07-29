/**
 * 發票頁 - 放大檢視的縮放與位移（2026/07 改寫）
 * ============================================================
 * 舊版用 overflow: auto + flex 置中，兩者湊在一起有個經典陷阱：
 * 內容比容器大時，被置中擠到上方與左方的部分捲不到（捲動範圍不含負值），
 * 所以放大之後永遠看不到發票的左上角 —— ＋／－ 兩顆鍵因此形同虛設。
 *
 * 現在位移與縮放全部自己算。這支測試守住四件事：
 *   1. 「符合」算出來的倍率與置中位置正確
 *   2. 放大後四個角都到得了（這就是舊版做不到的事）
 *   3. 捏／滾輪縮放時，錨點在畫面上的位置不會跑掉
 *   4. 旋轉時紙張尺寸與 transform 正確
 *
 * jsdom 不做版面計算，所以可視區尺寸用 defineProperty 灌進去 ——
 * 測的是真正的程式碼路徑，不是另外抄一份算式。
 *
 * 執行：node tests/invoice/放大檢視測試.js
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '../..');
let pass = 0, fail = 0;
const notes = [];

const ok = (cond, label, extra) => {
    if (cond) { pass++; console.log('  ✓ ' + label); }
    else { fail++; notes.push(label + (extra ? '　→ ' + extra : '')); console.log('  ✗ ' + label); }
};
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;

const html = fs.readFileSync(path.join(ROOT, 'pages/invoice.html'), 'utf8')
    .replace(/<script src="\.\.\/js\/frame-guard\.js"><\/script>/, '')
    .replace(/<script async src="https:\/\/www\.googletagmanager[^<]*<\/script>/, '');

const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://ryanlin02.github.io/my-website/pages/invoice.html',
    resources: { fetch(url) { return url.protocol === 'file:' ? undefined : null; } },
    beforeParse(window) {
        window.navigator.vibrate = () => true;
        window.fetch = () => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) });
    }
});

const { window } = dom;
const doc = window.document;

// 載入方式與其他兩支發票測試相同，理由見 tests/invoice/統編自動帶入測試.js
window.eval(fs.readFileSync(path.join(ROOT, 'js/common-keypad.js'), 'utf8').replace(/^let /gm, 'var '));
window.eval(fs.readFileSync(path.join(ROOT, 'js/common-modals.js'), 'utf8'));
window.eval(fs.readFileSync(path.join(ROOT, 'js/taxid-lookup.js'), 'utf8'));
window.eval(fs.readFileSync(path.join(ROOT, 'js/invoice-engine.js'), 'utf8')
    .replace(/^'use strict';$/m, '')
    + '\n;window.__test = { zoom, natSize, zoomView, zoomPaperSize, fitZoom, zoomTo, applyZoom, openZoom, renderZoomPaper };');

doc.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));

const T = window.__test;
const $ = id => doc.getElementById(id);

/* 灌進固定的可視區尺寸（jsdom 不做版面計算，clientWidth 一律是 0） */
const VIEW = { w: 800, h: 600, bar: 56 };
const fix = (el, prop, value) => Object.defineProperty(el, prop, { value, configurable: true });
fix($('zoomStage'), 'clientWidth', VIEW.w);
fix($('zoomStage'), 'clientHeight', VIEW.h);
fix(doc.querySelector('.zoom-bar'), 'offsetHeight', VIEW.bar);
$('zoomStage').getBoundingClientRect = () => ({ left: 0, top: 0, width: VIEW.w, height: VIEW.h });

// 事件座標是相對可視區左上角，上面已把 stage 的原點設在 (0,0)
function pointer(type, id, x, y) {
    const e = new window.Event(type, { bubbles: true });
    Object.assign(e, { pointerId: id, clientX: x, clientY: y });
    $('zoomStage').dispatchEvent(e);
}
function wheel(deltaY, x, y, ctrlKey = false) {
    const e = new window.Event('wheel', { bubbles: true, cancelable: true });
    Object.assign(e, { deltaY, clientX: x, clientY: y, ctrlKey });
    $('zoomStage').dispatchEvent(e);
}
// 紙張上的哪一點正落在畫面 (px,py)？縮放時這個點必須維持不變
const anchorOf = (px, py) => ({
    x: (px - T.zoom.tx) / T.zoom.scale,
    y: (py - T.zoom.ty) / T.zoom.scale
});

console.log('發票頁 - 放大檢視\n');

console.log('=== 1. 舊的 ＋／－ 已移除 ===');
ok(!$('zIn') && !$('zOut'), '＋／－ 兩顆鍵不在了（改用手勢）');
ok(!!$('zRotate') && !!$('zFit') && !!$('zClose'), '旋轉／符合／關閉三顆保留');
ok(!!$('zoomHint'), '工具列上有手勢提示（手勢看不見，要寫出來）');
ok(!!$('zoomRot'), '旋轉獨立一層（縮放時不必重畫發票）');
const css = fs.readFileSync(path.join(ROOT, 'css/invoice.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
ok(/\.zoom-stage\s*\{[^}]*overflow:\s*hidden/.test(css), '.zoom-stage 不再靠瀏覽器捲動');
ok(/\.zoom-stage\s*\{[^}]*touch-action:\s*none/.test(css), '  並且關掉瀏覽器的預設手勢（否則會搶走雙指縮放）');
ok(!/\.zoom-stage\s*\{[^}]*justify-content:\s*center/.test(css), '  也不再用 flex 置中（那正是左上角捲不到的原因）');

console.log('\n=== 2. 「符合」的倍率與置中 ===');
T.zoom.rot = 0;
T.renderZoomPaper();
T.fitZoom();
const p = T.zoomPaperSize();
const v = T.zoomView();
const expectFit = Math.min(v.w / p.w, v.h / p.h);
ok(near(T.zoom.scale, expectFit), `倍率 = 可視區 ÷ 紙張（${T.zoom.scale.toFixed(4)}）`, String(T.zoom.scale));
ok(near(T.zoom.tx, (v.w - p.w * T.zoom.scale) / 2) && near(T.zoom.ty, (v.h - p.h * T.zoom.scale) / 2),
    '放得下時置中', `tx=${T.zoom.tx.toFixed(1)} ty=${T.zoom.ty.toFixed(1)}`);
ok($('zoomPaper').style.transform.includes('translate') && $('zoomPaper').style.transform.includes('scale'),
    'transform 同時有位移與縮放', $('zoomPaper').style.transform);

console.log('\n=== 3. 放大後四個角都到得了（舊版做不到的事）===');
T.zoomTo(T.zoom.fit * 4, v.w / 2, v.h / 2);
const w4 = p.w * T.zoom.scale, h4 = p.h * T.zoom.scale;
ok(w4 > v.w && h4 > v.h, '放大 4 倍後紙張確實比可視區大', `${w4.toFixed(0)}×${h4.toFixed(0)}`);

// 往右下拖很多 → 應停在「左上角貼齊」
pointer('pointerdown', 1, 100, 100);
pointer('pointermove', 1, 5000, 5000);
pointer('pointerup', 1, 5000, 5000);
ok(near(T.zoom.tx, 0) && near(T.zoom.ty, 0), '可以拖到左上角（tx/ty 停在 0）',
    `tx=${T.zoom.tx.toFixed(1)} ty=${T.zoom.ty.toFixed(1)}`);

// 往左上拖很多 → 應停在「右下角貼齊」
pointer('pointerdown', 1, 100, 100);
pointer('pointermove', 1, -5000, -5000);
pointer('pointerup', 1, -5000, -5000);
ok(near(T.zoom.tx, v.w - w4) && near(T.zoom.ty, v.h - h4), '可以拖到右下角',
    `tx=${T.zoom.tx.toFixed(1)}（應為 ${(v.w - w4).toFixed(1)}）`);

console.log('\n=== 4. 縮放時錨點不會跑掉 ===');
T.fitZoom();
const AX = 220, AY = 160;
const before = anchorOf(AX, AY);
T.zoomTo(T.zoom.scale * 2.5, AX, AY);
const after = anchorOf(AX, AY);
ok(near(before.x, after.x, 0.5) && near(before.y, after.y, 0.5),
    '以某一點縮放後，該點仍落在畫面同一位置',
    `(${before.x.toFixed(1)},${before.y.toFixed(1)}) → (${after.x.toFixed(1)},${after.y.toFixed(1)})`);

T.fitZoom();
const wheelBefore = anchorOf(300, 200);
wheel(-300, 300, 200);
ok(T.zoom.scale > T.zoom.fit, '滾輪往上是放大', `${T.zoom.scale.toFixed(3)} > ${T.zoom.fit.toFixed(3)}`);
const wheelAfter = anchorOf(300, 200);
ok(near(wheelBefore.x, wheelAfter.x, 0.5) && near(wheelBefore.y, wheelAfter.y, 0.5),
    '  滾輪也是以游標為錨點');

console.log('\n=== 5. 縮放上下限 ===');
T.fitZoom();
T.zoomTo(999, v.w / 2, v.h / 2);
ok(near(T.zoom.scale, 8), '最大 8 倍', String(T.zoom.scale));
T.zoomTo(0.0001, v.w / 2, v.h / 2);
ok(near(T.zoom.scale, T.zoom.fit * 0.6), '最小為「符合」的 0.6 倍', String(T.zoom.scale));
ok(near(T.zoom.tx, (v.w - p.w * T.zoom.scale) / 2), '  縮到比可視區小時自動置中');

console.log('\n=== 6. 雙指縮放 ===');
T.fitZoom();
const s0 = T.zoom.scale;
pointer('pointerdown', 1, 300, 250);
pointer('pointerdown', 2, 400, 250);      // 兩指相距 100
pointer('pointermove', 1, 250, 250);
pointer('pointermove', 2, 450, 250);      // 拉開到 200
ok(T.zoom.scale > s0 * 1.5, '兩指拉開會放大（距離加倍 → 倍率約加倍）',
    `${s0.toFixed(3)} → ${T.zoom.scale.toFixed(3)}`);
const s1 = T.zoom.scale;
pointer('pointermove', 1, 325, 250);
pointer('pointermove', 2, 375, 250);      // 收合到 50
ok(T.zoom.scale < s1, '  兩指收合會縮小', `${s1.toFixed(3)} → ${T.zoom.scale.toFixed(3)}`);
pointer('pointerup', 1, 325, 250);
pointer('pointerup', 2, 375, 250);

console.log('\n=== 7. 旋轉 ===');
T.zoom.rot = 0; T.renderZoomPaper();
const flat = T.zoomPaperSize();
T.zoom.rot = 90; T.renderZoomPaper();
const turned = T.zoomPaperSize();
ok(flat.w === turned.h && flat.h === turned.w, '旋轉後紙張的寬高對調',
    `${flat.w}×${flat.h} → ${turned.w}×${turned.h}`);
ok($('zoomRot').style.transform.includes('rotate(90deg)'), '  內層帶 rotate(90deg)',
    $('zoomRot').style.transform);
ok($('zoomRot').style.transform.includes(`translate(${T.natSize().h}px`),
    '  並且往右推一個高度，轉完才落在可視範圍內', $('zoomRot').style.transform);
T.fitZoom();
ok(near(T.zoom.scale, Math.min(v.w / turned.w, v.h / turned.h)), '  旋轉後「符合」重新計算');

console.log('\n──────────────────────────────────────────────');
if (fail) {
    console.log(`❌ ${fail} 項失敗（通過 ${pass} 項）`);
    notes.forEach(n => console.log('   • ' + n));
} else {
    console.log(`✅ 全部通過（${pass} 項）`);
}
process.exit(fail ? 1 : 0);
