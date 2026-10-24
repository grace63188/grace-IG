// 事件代號 → 資料中心事件（CONTRACT.md「事件名稱清單」）對應：node --test scripts/tests/*.test.mjs
// 資料中心遇到未知 n 或不合法 k 會整批拒收，所以每個元素代號都必須對應到白名單內
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wire, devInfo } from '../../assets/js/track.js';
import { normalize } from '../../assets/js/config.js';

/* 與 hub-admin/gas/lib.js 的 LIB_EVENT_NAMES／LIB_KEYS 相同 */
const NAMES = ['enter', 'key', 'now', 'card', 'tear', 'login_start', 'login_done', 'login_fail', 'quiz_q', 'quiz_nav', 'quiz_done', 'quiz_retry', 'out', 'foot', 'sound', 'view'];
const KEYS = { key: ['quiz', 'study', 'event', 'live', 'follow', 'consult'], now: ['live', 'event', 'pod', 'ig'], tear: ['ability', 'career'], login_start: ['line', 'google'], login_fail: ['line', 'google'], quiz_q: ['ability', 'career'], quiz_nav: ['ability', 'career', ''], quiz_retry: ['ability', 'career'], foot: ['line_academy', 'line_sampler', 'ig', 'yt', 'pod', 'reply_time'], sound: ['on', 'off'] };
const CODE = /^[a-z0-9_.-]{1,24}$/;                                   /* out／view 的 k＝元素代號 */

const CLICKS = ['key.quiz', 'key.study', 'key.event', 'key.live', 'key.follow', 'key.consult', 'now.live', 'now.event', 'now.podcast', 'now.ig',
  'foot.line_academy', 'foot.line_sampler', 'foot.reply_time', 'study.tab.academy', 'study.tab.sampler', 'consult.enroll', 'consult.group.open.open',
  'quiz.start', 'quiz.switch', 'quiz.tab.member', 'quiz.tab.guest', 'quiz.enroll', 'quiz.share_line', 'quiz.go.consult', 'quiz.go.browse', 'quiz.go.try', 'quiz.save', 'quiz.prev', 'quiz.next', 'quiz.close', 'quiz.open',
  'rite.open', 'rite.start', 'rite.switch', 'rite.close', 'live.close', 'who.menu', 'who.switch', 'auth.inapp.open'];
const LINKS = ['study.academy.site', 'study.sampler.course1', 'study.sampler.group', 'study.sampler.site', 'event.go', 'event.ig', 'live.calendar', 'live.ig',
  'follow.ig_principal', 'follow.ig_official', 'follow.youtube', 'follow.podcast', 'follow.podcast_latest', 'consult.book', 'quiz.backend'];

const valid = (w) => NAMES.includes(w.n) && !['login_done', 'quiz_done'].includes(w.n) && (['out', 'view'].includes(w.n) ? CODE.test(w.k) : (!KEYS[w.n] || KEYS[w.n].includes(w.k)));

test('每個點擊與外連代號都對應到資料中心白名單', () => {
  for (const el of CLICKS) assert.ok(valid(wire(el, 'click', {})), el + ' → ' + JSON.stringify(wire(el, 'click', {})));
  for (const el of LINKS) {
    const w = wire(el, 'link', { href: 'https://example.com/a?b=1' });
    assert.ok(valid(w), el);
    if (!el.startsWith('foot.')) { assert.equal(w.n, 'out', el); assert.equal(w.k, el, el + '：k＝元素代號'); assert.equal(w.u, 'example.com/a'); }
  }
  assert.deepEqual(wire('study.academy.site', 'link', { href: 'https://www.graceschool.com.tw/?x=1', text: '前往學院官網' }), { n: 'out', k: 'study.academy.site', v: '前往學院官網', u: 'www.graceschool.com.tw/' });
  assert.deepEqual(wire('quiz.share_line', 'click', {}), { n: 'card', k: 'quiz', v: 'quiz.share_line' });
  assert.deepEqual(wire('quiz.go.try', 'click', {}), { n: 'card', k: 'quiz', v: 'quiz.go.try' });
  assert.deepEqual(wire('quiz.switch', 'click', { kind: 'career', from: 'ability', via: 'click' }), { n: 'card', k: 'quiz', v: 'quiz.switch.career' });   /* 準備頁測驗切換：v＝切換後 */
  assert.deepEqual(wire('quiz.switch', 'click', { kind: 'ability', from: 'career', via: 'key' }), { n: 'card', k: 'quiz', v: 'quiz.switch.ability' });
  assert.deepEqual(wire('now.ig', 'click', { label: '最新消息公告於校長 IG' }), { n: 'now', k: 'ig', v: '最新消息公告於校長 IG' });
  assert.deepEqual(wire('foot.reply_time', 'link', { href: 'https://line.me/R/ti/p/@52grace' }), { n: 'foot', k: 'reply_time' });
});

test('流程事件：進站、撕票、登入、作答、靜音', () => {
  assert.deepEqual(wire('page.enter', 'view', { ref: 'instagram.com' }), { n: 'enter', ref: 'instagram.com' });
  assert.deepEqual(wire('tear.career', 'tear', { via: 'drag' }), { n: 'tear', k: 'career', v: 'drag' });
  assert.equal(wire('auth.line.start', 'auth_start', { provider: 'line' }).n, 'login_start');
  assert.deepEqual(wire('auth.fail', 'auth', { provider: 'google', code: 'RATE_LIMIT' }), { n: 'login_fail', k: 'google', v: 'RATE_LIMIT' });
  assert.deepEqual(wire('auth.google.blocked', 'view', {}), { n: 'login_fail', k: 'google', v: 'webview' });
  assert.deepEqual(wire('quiz.answer', 'answer', { kind: 'career', q: 7, n: 12, k: 2, done: 7 }), { n: 'quiz_q', k: 'career', v: '7:1' });
  assert.deepEqual(wire('quiz.answer', 'answer', { kind: 'ability', q: 14, k: 4 }), { n: 'quiz_q', k: 'ability', v: '14:3' });
  assert.deepEqual(wire('quiz.next', 'click', { kind: 'ability', q: 3 }), { n: 'quiz_nav', k: 'ability', v: 'next' });
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

test('畫面顯示送 view（不算點擊）：卡片／測驗開關、登入中、自動進入、諮詢展開', () => {
  assert.deepEqual(wire('rite.open', 'view', { kind: 'ability', state: 'login', inapp: false }), { n: 'view', k: 'rite.open', v: 'ability' });
  assert.deepEqual(wire('rite.pending', 'view', { kind: 'career', provider: 'line' }), { n: 'view', k: 'rite.pending', v: 'career' });
  assert.deepEqual(wire('rite.start', 'click', { kind: 'ability', auto: true, fresh: true }), { n: 'view', k: 'rite.start', v: 'ability' });
  assert.deepEqual(wire('quiz.open', 'view', { kind: 'career', direct: true }), { n: 'view', k: 'quiz.open', v: 'career' });
  assert.deepEqual(wire('quiz.close', 'close', { kind: 'ability', at: 3, n: 14 }), { n: 'view', k: 'quiz.close', v: 'ability' });
  assert.deepEqual(wire('sheet.live.close', 'close', { via: 'esc' }), { n: 'view', k: 'sheet.live.close', v: 'esc' });
  assert.deepEqual(wire('consult.group.very_long_group_identifier.open', 'toggle'), { n: 'view', k: 'consult.group', v: 'open' });
  assert.deepEqual(wire('consult.group.x.close', 'toggle'), { n: 'view', k: 'consult.group', v: 'close' });
  assert.deepEqual(wire('auth.google.blocked', 'view', {}), { n: 'login_fail', k: 'google', v: 'webview' });   /* 仍是 login_fail */
  assert.deepEqual(wire('quiz.reveal', 'view', { kind: 'career' }), { n: 'view', k: 'quiz.reveal', v: 'career' });   /* 結果揭曉 */
  assert.deepEqual(wire('quiz.reveal_skip', 'view', { kind: 'ability' }), { n: 'view', k: 'quiz.reveal_skip', v: 'ability' });   /* 略過揭曉 */
  for (const w of [wire('quiz.reveal', 'view', { kind: 'ability' }), wire('quiz.reveal_skip', 'view', { kind: 'career' })]) assert.ok(valid(w), JSON.stringify(w));
  for (const w of [wire('rite.open', 'view', {}), wire('quiz.close', 'close', {}), wire('consult.group.a.open', 'toggle')]) assert.ok(valid(w), JSON.stringify(w));
});
