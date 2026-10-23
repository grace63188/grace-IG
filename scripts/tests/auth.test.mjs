// LINE 返回（?auth=line）：設定確認為正式模式前不清除 state 與網址；state 遺失回 error 'state'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const HTML = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const store = new Map();
let embeddedText = '{}';
let url = new URL('https://grace63188.github.io/grace-IG/');
globalThis.window = globalThis;
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.sessionStorage = { getItem: () => null, setItem: () => {} };
globalThis.document = { getElementById: (id) => (id === 'hub-config' ? { textContent: embeddedText } : null) };
Object.defineProperty(globalThis, 'location', { configurable: true, get: () => ({ href: url.href, search: url.search, pathname: url.pathname, hash: url.hash, hostname: url.hostname }) });
globalThis.history = { replaceState: (_s, _t, u) => { url = new URL(u, url); } };
globalThis.fetch = async () => { throw new Error('offline'); };                 // hub.json 讀取失敗

/* 與網頁相同的版本參數匯入（模組網址不同會變成兩份模組，設定狀態不共用） */
const V = HTML.match(/assets\/js\/v6\.js(\?v=\w+)/)[1];
const { loadConfig, isDemo } = await import(`../../assets/js/config.js${V}`);
const { resume, loginUrl, takeGoLogin, markLoginUrl, externalUrl, pendingLine } = await import(`../../assets/js/auth.js${V}`);
const embedded = HTML.match(/id="hub-config">([\s\S]*?)<\/script>/)[1];

test('hub.json 讀取失敗：內嵌設定仍為正式模式', async () => {
  embeddedText = embedded;
  await loadConfig();
  assert.equal(isDemo(), false);
});

test('示範模式下 LINE 返回：不清除 state 與網址參數', async () => {
  embeddedText = '{}';
  await loadConfig();
  assert.equal(isDemo(), true);
  store.set('gh.state', JSON.stringify({ s: 'KEEP', kind: 'career', at: Date.now() }));
  url = new URL('https://grace63188.github.io/grace-IG/?auth=line&code=C1&state=KEEP');
  assert.equal(await resume(), null);
  assert.ok(store.has('gh.state'));
  assert.equal(url.search, '?auth=line&code=C1&state=KEEP');
});

test('正式模式下 LINE 返回但 state 遺失（換了瀏覽器）：回 error state 並清除網址', async () => {
  embeddedText = embedded;
  await loadConfig();
  store.delete('gh.state');
  url = new URL('https://grace63188.github.io/grace-IG/?auth=line&code=C1&state=OTHER&x=1');
  const r = await resume();
  assert.deepEqual(r, { kind: 'ability', provider: 'line', error: 'state' });
  assert.equal(url.search, '?x=1');
});

test('pendingLine：LINE 返回時同步讀出所選種類且不清除 state；示範模式或非返回回 null', async () => {
  embeddedText = embedded;
  await loadConfig();
  store.set('gh.state', JSON.stringify({ s: 'S1', kind: 'career', at: Date.now() }));
  url = new URL('https://grace63188.github.io/grace-IG/?auth=line&code=C1&state=S1');
  assert.deepEqual(pendingLine(), { kind: 'career' });
  assert.ok(store.has('gh.state'), 'pendingLine 不清除 state');
  assert.equal(url.search, '?auth=line&code=C1&state=S1', 'pendingLine 不動網址');
  store.delete('gh.state');
  assert.deepEqual(pendingLine(), { kind: 'ability' }, 'state 遺失仍先顯示登入中（之後由 resume 回 error）');
  url = new URL('https://grace63188.github.io/grace-IG/?go=login&k=career');
  assert.equal(pendingLine(), null);
  embeddedText = '{}';
  await loadConfig();
  url = new URL('https://grace63188.github.io/grace-IG/?auth=line&code=C1&state=S1');
  assert.equal(pendingLine(), null, '示範模式不顯示登入中');
  embeddedText = embedded;
  await loadConfig();
});

test('正式模式下 state 逾時：同樣回 error state', async () => {
  store.set('gh.state', JSON.stringify({ s: 'OLD', kind: 'career', at: Date.now() - 21 * 60e3 }));
  url = new URL('https://grace63188.github.io/grace-IG/?auth=line&code=C1&state=OLD');
  const r = await resume();
  assert.equal(r.error, 'state'); assert.equal(r.kind, 'career');
  assert.equal(store.has('gh.state'), false);
});

test('換到外部瀏覽器的網址：保留路徑與參數、加 go=login，並去掉登入返回參數', () => {
  url = new URL('https://grace63188.github.io/grace-IG/?utm_source=ig&auth=line&code=x&state=y#top');
  assert.equal(loginUrl('ability'), 'https://grace63188.github.io/grace-IG/?utm_source=ig&go=login');
  assert.equal(loginUrl('career'), 'https://grace63188.github.io/grace-IG/?utm_source=ig&go=login&k=career');
});

test('?go=login：回傳測驗種類並清掉 go、k、openExternalBrowser', () => {
  url = new URL('https://grace63188.github.io/grace-IG/?utm_source=ig&go=login&k=career&openExternalBrowser=1');
  assert.deepEqual(takeGoLogin(), { kind: 'career' });
  assert.equal(url.search, '?utm_source=ig');
  url = new URL('https://grace63188.github.io/grace-IG/');
  assert.equal(takeGoLogin(), null);
});

test('App 內說明顯示時：網址改為登入網址，收起時還原', () => {
  url = new URL('https://grace63188.github.io/grace-IG/?utm_source=ig#top');
  const restore = markLoginUrl('career');
  assert.equal(url.href, 'https://grace63188.github.io/grace-IG/?utm_source=ig&go=login&k=career#top');
  restore();
  assert.equal(url.href, 'https://grace63188.github.io/grace-IG/?utm_source=ig#top');
});

test('外部開啟網址：不再提供 x-safari；Android intent 附 fallback；LINE openExternalBrowser', () => {
  url = new URL('https://grace63188.github.io/grace-IG/');
  assert.equal(externalUrl('safari'), '');
  assert.equal(externalUrl('intent'), 'intent://grace63188.github.io/grace-IG/?go=login#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=https%3A%2F%2Fgrace63188.github.io%2Fgrace-IG%2F%3Fgo%3Dlogin;end');
  assert.equal(externalUrl('line'), 'https://grace63188.github.io/grace-IG/?go=login&openExternalBrowser=1');
});
