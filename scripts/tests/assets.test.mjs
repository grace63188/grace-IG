// 快取：所有 CSS、JS 入口與每個 ES 模組匯入路徑都帶同一個版本參數，新舊檔案不會混用
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const html = read('index.html');
const V = (html.match(/assets\/js\/v6\.js\?v=(\w+)"/) || [])[1];

test('index.html 入口帶版本參數', () => assert.ok(V, 'v6.js?v='));

test('index.html、privacy.html 的 CSS／JS 都帶同一版本', () => {
  for (const f of ['index.html', 'privacy.html']) {
    const refs = [...read(f).matchAll(/(?:href|src)="(assets\/(?:css|js)\/[^"]+)"/g)].map((m) => m[1]);
    assert.ok(refs.length > 0, f);
    for (const r of refs) assert.match(r, new RegExp(`\\?v=${V}$`), `${f}: ${r}`);
  }
});

test('每個 ES 模組匯入路徑都帶同一版本', () => {
  for (const f of readdirSync(new URL('assets/js/', root)).filter((n) => n.endsWith('.js'))) {
    const src = read(`assets/js/${f}`);
    const specs = [...src.matchAll(/(?:from\s+|import\()\s*['"](\.[^'"]+)['"]/g)].map((m) => m[1]);
    for (const s of specs) assert.equal(s.endsWith(`.js?v=${V}`), true, `${f}: ${s}`);
  }
});

test('加入行事曆：標題「【校長IG直播】」、說明兩行、地點為校長 IG', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../../assets/js/v6.js', import.meta.url), 'utf8');
  assert.match(src, /export const GCAL_TITLE = '【校長IG直播】';/);
  assert.match(src, /export const GCAL_IG = 'https:\/\/www\.instagram\.com\/grace\.wwwwwwww';/);
  assert.match(src, /GCAL_DETAILS = `傳送門：\$\{GCAL_IG\}\\n不見不散，校長在等妳💗`/);
});

test('首頁沒有頭像 chip；切換帳號改在測驗結果頁', async () => {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /id="who-wrap"|id="who-menu"|data-ev="who\.menu"/);
  const quiz = readFileSync(new URL('../../assets/js/quiz.js', import.meta.url), 'utf8');
  assert.match(quiz, /data-act="switch" data-ev="who\.switch">不是妳？切換帳號</);
});
