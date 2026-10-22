// 事件代號 → 資料中心事件（CONTRACT.md「事件名稱清單」）對應：node --test scripts/tests/*.test.mjs
// 資料中心遇到未知 n 或不合法 k 會整批拒收，所以每個元素代號都必須對應到白名單內
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wire, devInfo } from '../../assets/js/track.js';
import { normalize } from '../../assets/js/config.js';

/* 與 hub-admin/gas/lib.js 的 LIB_EVENT_NAMES／LIB_KEYS 相同 */
const NAMES = ['enter', 'key', 'now', 'card', 'tear', 'login_start', 'login_done', 'login_fail', 'quiz_q', 'quiz_done', 'quiz_retry', 'out', 'foot', 'sound'];
const KEYS = { key: ['quiz', 'study', 'event', 'live', 'follow', 'consult'], now: ['live', 'event', 'pod'], tear: ['ability', 'career'], login_start: ['line', 'google'], login_fail: ['line', 'google'], quiz_q: ['ability', 'career'], quiz_retry: ['ability', 'career'], out: ['key', 'now', 'foot', 'card', 'result'], foot: ['line_academy', 'line_sampler', 'ig', 'yt', 'pod'], sound: ['on', 'off'] };

const CLICKS = ['key.quiz', 'key.study', 'key.event', 'key.live', 'key.follow', 'key.consult', 'now.live', 'now.event', 'now.podcast', 'now.ig',
  'foot.line_academy', 'foot.line_sampler', 'foot.reply_time', 'study.tab.academy', 'study.tab.sampler', 'consult.enroll', 'consult.group.open.open',
  'quiz.start', 'quiz.tab.member', 'quiz.tab.guest', 'quiz.enroll', 'quiz.save', 'quiz.prev', 'quiz.next', 'quiz.close', 'quiz.open',
  'rite.open', 'rite.start', 'rite.switch', 'rite.close', 'live.close', 'who.menu', 'who.switch', 'auth.inapp.open'];
const LINKS = ['study.academy.site', 'study.sampler.course1', 'study.sampler.group', 'study.sampler.site', 'event.go', 'event.ig', 'live.calendar', 'live.ig',
  'follow.ig_principal', 'follow.ig_official', 'follow.youtube', 'follow.podcast', 'follow.podcast_latest', 'consult.book', 'quiz.backend'];

const valid = (w) => NAMES.includes(w.n) && !['login_done', 'quiz_done'].includes(w.n) && (!KEYS[w.n] || KEYS[w.n].includes(w.k));

test('每個點擊與外連代號都對應到資料中心白名單', () => {
  for (const el of CLICKS) assert.ok(valid(wire(el, 'click', {})), el + ' → ' + JSON.stringify(wire(el, 'click', {})));
  for (const el of LINKS) {
    const w = wire(el, 'link', { href: 'https://example.com/a?b=1' });
    assert.ok(valid(w), el);
    if (!el.startsWith('foot.')) assert.equal(w.n, 'out', el);
  }
  assert.equal(wire('quiz.backend', 'link', { href: 'https://x.tw/a' }).k, 'result');
});

test('流程事件：進站、撕票、登入、作答、靜音', () => {
  assert.deepEqual(wire('page.enter', 'view', { ref: 'instagram.com' }), { n: 'enter', ref: 'instagram.com' });
  assert.deepEqual(wire('tear.career', 'tear', { via: 'drag' }), { n: 'tear', k: 'career', v: 'drag' });
  assert.equal(wire('auth.line.start', 'auth_start', { provider: 'line' }).n, 'login_start');
  assert.deepEqual(wire('auth.fail', 'auth', { provider: 'google', code: 'RATE_LIMIT' }), { n: 'login_fail', k: 'google', v: 'RATE_LIMIT' });
  assert.deepEqual(wire('auth.google.blocked', 'view', {}), { n: 'login_fail', k: 'google', v: 'webview' });
  assert.deepEqual(wire('quiz.answer', 'answer', { kind: 'career', q: 7 }), { n: 'quiz_q', k: 'career', v: '7' });
  assert.deepEqual(wire('quiz.again', 'click', { kind: 'ability' }), { n: 'quiz_retry', k: 'ability' });
  assert.deepEqual(wire('snd.toggle', 'click', { on: false, at: 'home' }), { n: 'sound', k: 'off', v: 'home' });
  assert.equal(wire('auth.success', 'auth', {}).local, true);           // 由資料中心補 login_done
  assert.equal(wire('quiz.complete', 'complete', {}).local, true);      // 由 quiz.result 補 quiz_done
  // 開場儀式：沿用 card 事件（LIB_KEYS 不限制 card 的 k），k＝intro
  assert.deepEqual(wire('intro.enter', 'click', { via: 'button' }), { n: 'card', k: 'intro', v: 'intro.enter' });
  assert.deepEqual(wire('intro.skip', 'click', { via: 'esc' }), { n: 'card', k: 'intro', v: 'intro.skip' });
  assert.ok(valid(wire('intro.enter', 'click', {})) && valid(wire('intro.skip', 'click', {})));
});

test('裝置描述與設定值', () => {
  assert.deepEqual(devInfo('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0'), { os: 'iOS', br: 'IG 內建' });
  assert.deepEqual(devInfo('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36'), { os: 'Android', br: 'Chrome' });
  assert.deepEqual(devInfo('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'), { os: 'iOS', br: 'Safari' });
  assert.equal(normalize({}).demo, true);
  const c = normalize({ gas: 'https://script.google.com/macros/s/x/exec', lineChannelId: '2001234567', redirectUri: 'https://grace63188.github.io/grace-ig/?auth=line' });
  assert.equal(c.demo, false); assert.equal(c.providers.line, true); assert.equal(c.providers.google, false);
  assert.equal(normalize({ gas: 'http://insecure/exec' }).demo, true);
});

test('App 內建瀏覽器判斷：IG、Threads、Facebook、LINE 等視為內建（Google 停用），一般瀏覽器不是', async () => {
  const { inAppOf } = await import('../../assets/js/track.js');
  const iOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
  const cases = {
    IG: [`${iOS} Instagram 330.0.0.25.88 (iPhone15,2; iOS 17_5)`, 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36 Instagram 330.0.0.25.88 Android'],
    Threads: [`${iOS} Barcelona 289.0.0.77.109 (iPhone15,2; iOS 17_5)`],
    Facebook: [`${iOS} [FBAN/FBIOS;FBAV/470.0.0.37.97;FBBV/600000000]`, 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/470.0.0.37.97;]'],
    LINE: [`${iOS} Safari Line/14.16.0`, 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36 Line/14.16.0/IAB'],
    App: [`${iOS} MicroMessenger/8.0.50`, 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36'],
  };
  for (const [name, list] of Object.entries(cases)) for (const ua of list) assert.equal(inAppOf(ua), name, ua);
  for (const ua of [
    `${iOS.replace('Mobile/15E148', 'Version/17.5 Mobile/15E148')} Safari/604.1`,
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
    `${iOS} CriOS/129.0 Mobile/15E148 Safari/604.1`, '',
  ]) assert.equal(inAppOf(ua), '', ua);
});

test('內嵌設定 #hub-config 與 data/hub.json 相同，且為正式模式', async () => {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const m = html.match(/<script type="application\/json" id="hub-config">([\s\S]*?)<\/script>/);
  assert.ok(m, '#hub-config 存在');
  const emb = JSON.parse(m[1]);
  const hub = JSON.parse(readFileSync(new URL('../../data/hub.json', import.meta.url), 'utf8'));
  assert.deepEqual(emb, hub);
  const c = normalize(emb);
  assert.equal(c.demo, false);
  assert.deepEqual(c.providers, { line: true, google: true });
});
