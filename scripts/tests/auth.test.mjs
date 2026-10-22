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

const { loadConfig, isDemo } = await import('../../assets/js/config.js');
const { resume } = await import('../../assets/js/auth.js');
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

test('正式模式下 state 逾時：同樣回 error state', async () => {
  store.set('gh.state', JSON.stringify({ s: 'OLD', kind: 'career', at: Date.now() - 21 * 60e3 }));
  url = new URL('https://grace63188.github.io/grace-IG/?auth=line&code=C1&state=OLD');
  const r = await resume();
  assert.equal(r.error, 'state'); assert.equal(r.kind, 'career');
  assert.equal(store.has('gh.state'), false);
});
