// Logo＝回到首頁：版頭、測驗標題列、隱私權頁的 Logo 都是連到首頁的連結（行為由 hub-front/work/home_check.py 在瀏覽器驗證）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const html = read('index.html');
const v6 = read('assets/js/v6.js');

test('版頭 Logo 包在回到首頁連結內（./、aria-label、data-home），h1 仍保留品牌名', () => {
  assert.match(html, /<h1 class="mast-h"><a class="home-link" id="home-logo" href="\.\/" aria-label="回到首頁" data-home="mast"><img class="logo" [^>]*alt=""><\/a><span class="sr-only">G\.R\.A\.C\.E Academy<\/span><\/h1>/);
});

test('測驗標題列（作答、結果）有 Logo 回到首頁連結', () => {
  assert.match(html, /<div class="qz-head"><a class="home-link qz-home" href="\.\/" aria-label="回到首頁" data-home="quiz"><img src="assets\/img\/logo-academy-mark\.webp"/);
});

test('隱私權頁 Logo 連到 ./', () => {
  assert.match(read('privacy.html'), /<a class="pp-home" href="\.\/" aria-label="回到首頁"><img class="pp-logo" /);
});

test('goHome：收起卡片與測驗、網址回到路徑本身、回到頂端、不重播開場、不另增追蹤事件', () => {
  const fn = v6.slice(v6.indexOf('function goHome('), v6.indexOf('function initHome('));
  assert.ok(fn.length > 0);
  assert.match(fn, /closeSheet\(true, 'logo'\)/);
  assert.match(fn, /quizApi\.close\(\)/);
  assert.match(fn, /history\.replaceState\(null, '', homePath\(\)\)/);
  assert.match(fn, /window\.scrollTo\(\{ top: 0/);
  assert.doesNotMatch(fn, /replay|initIntro|track\(/);
  assert.match(v6, /if \(overLogo\(e\)\) goHome\(e\); else closeSheet\(false, 'scrim'\);/);
});

test('點擊區 ≥44px、按下回饋只用 transform／opacity（無版面位移）', () => {
  const css = read('assets/css/v7.css');
  assert.match(css, /\.home-link\{[^}]*min-width:44px;min-height:44px/);
  assert.match(css, /\.home-link:active img\{transform:scale\(\.97\);opacity:\.82\}/);
});
