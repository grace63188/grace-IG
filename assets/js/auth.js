/* 測驗前登入（依 hub-admin/CONTRACT.md「登入」）
   - LINE（主）：導向授權頁 → 回到 redirectUri（?auth=line&code&state）→ op auth.line 換訪客 token（vt）
   - Google（次）：載入 Google Identity Services，One Tap／FedCM 取得 ID token → op auth.google；
     若瀏覽器略過提示，於卡片內改放 Google 官方按鈕完成登入
   - 自動登入：載入時有 vt → op visitor.me 續期；EXPIRED／UNAUTHORIZED 清除，視為未登入
   - 保存：localStorage gh.vt、gh.person（try/catch）；示範模式以模擬帳號完成，不連線
   - App 內建瀏覽器（Instagram、Threads、Facebook、LINE 等 WebView）：Google 會擋 WebView，改引導以外部瀏覽器開啟；LINE 登入照常可用
   - LINE 返回時先確認為正式模式（非示範）才清除 state 與網址參數；state 遺失或逾時（多半是換了瀏覽器）回 error 'state' */
import { config } from './config.js';
import { post } from './api.js';
import { devInfo, setTokenSource, inAppOf } from './track.js';

export const VT_KEY = 'gh.vt';
export const PERSON_KEY = 'gh.person';
const STATE_KEY = 'gh.state';
const PENDING_KEY = 'gh.pending';
const DEMO_NAME = '示範學員';
const YEAR = 365 * 86400e3;

const mem = {};
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return k in mem ? mem[k] : null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { mem[k] = v; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { delete mem[k]; } },
};
const rand = (n) => {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  try { const a = new Uint8Array(n); crypto.getRandomValues(a); a.forEach((b) => { s += abc[b % abc.length]; }); }
  catch (e) { for (let i = 0; i < n; i++) s += abc[Math.floor(Math.random() * abc.length)]; }
  return s;
};
const err = (code, msg) => Object.assign(new Error(msg || code), { code });

/* ---------- 工作階段 ---------- */
const subs = new Set();
export const onAuth = (f) => { subs.add(f); return () => subs.delete(f); };
const emit = () => { const s = session(); subs.forEach((f) => f(s)); };

/** 目前登入者：{ vt, name, pic, src, pid, exp, demo } 或 null */
export function session() {
  const vt = ls.get(VT_KEY);
  if (!vt) return null;
  let p = null;
  try { p = JSON.parse(ls.get(PERSON_KEY) || 'null'); } catch (e) { p = null; }
  if (!p || typeof p !== 'object') return null;
  if (Number(p.exp) && Number(p.exp) < Date.now()) { clear(); return null; }
  return { vt, name: String(p.name || '') || '學員', pic: p.pic || '', src: p.src === 'google' ? 'google' : 'line', pid: p.pid || '', exp: Number(p.exp) || 0, demo: !!p.demo };
}
function clear() { ls.del(VT_KEY); ls.del(PERSON_KEY); }
let resultsSink = null;
/** 登入回應帶回的歷史結果交給 quiz 顯示「上次結果」 */
export const onResults = (f) => { resultsSink = f; };
function save(d, src, demo = false) {
  const p = d.person || {};
  ls.set(VT_KEY, d.vt);
  ls.set(PERSON_KEY, JSON.stringify({ pid: p.pid || '', name: String(p.name || '').slice(0, 40), pic: typeof p.pic === 'string' ? p.pic : '', src: p.src || src,
    exp: Number(d.exp) || Date.now() + YEAR, demo }));
  if (d.results && resultsSink) { try { resultsSink(d.results); } catch (e) { /* 忽略 */ } }
  emit();
  flushPending();
  return session();
}
export function logout() { clear(); emit(); }
setTokenSource(() => ls.get(VT_KEY) || '');

export const initial = (name) => { const c = [...String(name || '').trim()]; return c.length ? c[0].toUpperCase() : '學'; };

/* ---------- 環境 ---------- */
/** App 內建瀏覽器名稱（IG、Threads、Facebook、LINE、App），一般瀏覽器回 '' */
export function inAppName() {
  if (typeof window.__pvIG === 'boolean') return window.__pvIG ? 'IG' : '';  /* 預覽切換用 */
  try { return inAppOf(navigator.userAgent || ''); } catch (e) { return ''; }
}
export const isInApp = () => !!inAppName();
export const platform = () => ({ iOS: 'ios', Android: 'android' }[devInfo().os] || 'other');

async function copy(text) {
  try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; } } catch (e) { /* 改用後備 */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    document.body.append(ta); ta.select(); ta.setSelectionRange(0, text.length);
    const ok = document.execCommand && document.execCommand('copy');
    ta.remove();
    return !!ok;
  } catch (e) { return false; }
}
const pageUrl = () => location.href.split('#')[0];
export const copyUrl = () => copy(pageUrl());

/** 在外部瀏覽器開啟：Android 以 intent:// 交給 Chrome；iOS 與其他改為複製網址並提示 */
export async function openInBrowser() {
  const url = pageUrl(), os = platform();
  /* LINE 內建瀏覽器支援 openExternalBrowser=1 直接改用預設瀏覽器開啟 */
  if (inAppName() === 'LINE' && typeof window.__pvIG !== 'boolean') {
    const u = new URL(url); u.searchParams.set('openExternalBrowser', '1');
    location.href = u.toString();
    return { mode: 'line', os, copied: false };
  }
  if (os === 'android' && typeof window.__pvIG !== 'boolean') {
    const u = new URL(url);
    location.href = `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(url)};end`;
    return { mode: 'intent', os, copied: false };
  }
  return { mode: 'copy', os, copied: await copy(url) };
}

/* ---------- 登入 ---------- */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const extra = () => ({ dev: devInfo(), fp: sessionFp(), sid: sessionSid() });
const sessionFp = () => { try { return sessionStorage.getItem('gh.fp') || undefined; } catch (e) { return undefined; } };
const sessionSid = () => { try { return sessionStorage.getItem('gh.sid') || undefined; } catch (e) { return undefined; } };
const sessionIp = () => { try { return sessionStorage.getItem('gh.ip') || undefined; } catch (e) { return undefined; } };

/* Google Identity Services：只在按下 Google 登入時載入 */
let gsiP = null;
function loadGsi() {
  if (window.google && window.google.accounts && window.google.accounts.id) return Promise.resolve(window.google.accounts.id);
  if (gsiP) return gsiP;
  gsiP = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = () => (window.google && window.google.accounts ? res(window.google.accounts.id) : rej(err('PROVIDER')));
    s.onerror = () => { gsiP = null; rej(err('NETWORK')); };
    document.head.append(s);
  });
  return gsiP;
}
async function googleCredential(fallback) {
  const id = await loadGsi();
  return new Promise((resolve, reject) => {
    id.initialize({ client_id: config().googleClientId, callback: (r) => (r && r.credential ? resolve(r.credential) : reject(err('PROVIDER'))),
      ux_mode: 'popup', use_fedcm_for_prompt: true, itp_support: true, cancel_on_tap_outside: true, context: 'signin' });
    id.prompt((n) => {
      /* 提示被略過（冷卻期、第三方 Cookie 受限等）→ 放 Google 官方按鈕讓使用者直接點 */
      if (n && ((n.isSkippedMoment && n.isSkippedMoment()) || (n.isNotDisplayed && n.isNotDisplayed()))) {
        if (fallback) fallback((el) => id.renderButton(el, { theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', locale: 'zh-TW', width: Math.min(400, Math.max(200, el.clientWidth)) }));
        else reject(err('SKIPPED'));
      }
    });
  });
}

/** 開始登入。示範模式回傳 session；LINE 正式模式導向授權頁（回傳的 Promise 不會完成）
    fallback(render)：Google 提示被略過時呼叫，render(el) 會在 el 內放官方按鈕 */
export async function login(provider, { kind = '', fallback } = {}) {
  const cfg = config();
  if (provider !== 'line' && provider !== 'google') throw err('provider');
  if (cfg.demo) {
    await wait(700);
    return save({ vt: 'demo.' + rand(16), exp: Date.now() + YEAR, person: { name: DEMO_NAME, src: provider } }, provider, true);
  }
  if (!cfg.providers[provider]) throw err('provider_off');
  if (provider === 'google' && isInApp()) throw err('webview');
  if (provider === 'line') {
    const state = rand(24);
    ls.set(STATE_KEY, JSON.stringify({ s: state, kind, at: Date.now() }));
    location.assign(`https://access.line.me/oauth2/v2.1/authorize?response_type=code&client_id=${encodeURIComponent(cfg.lineChannelId)}&redirect_uri=${encodeURIComponent(cfg.redirectUri)}&state=${state}&scope=profile%20openid%20email&bot_prompt=normal`);
    return new Promise(() => {});
  }
  const credential = await googleCredential(fallback);
  const d = await post('auth.google', Object.assign({ credential, ip: sessionIp() }, extra()));
  return save(d, 'google');
}

/** 載入時呼叫：LINE 授權返回 → { kind, provider, session } ／ { kind, provider, error }；有 vt → visitor.me 續期；其他回 null */
export async function resume() {
  const cfg = config();
  let q;
  try { q = new URLSearchParams(location.search); } catch (e) { return null; }
  if (q.get('auth') === 'line' && (q.get('code') || q.get('error') || q.get('state'))) {
    /* 設定尚未確認為正式模式：不動 state 與網址，留待正式設定載入後處理 */
    if (cfg.demo) return null;
    const code = q.get('code'), state = q.get('state'), e = q.get('error');
    try {
      ['auth', 'code', 'state', 'error', 'error_description', 'friendship_status_changed'].forEach((k) => q.delete(k));
      const qs = q.toString();
      history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
    } catch (x) { /* 忽略 */ }
    let pend = null;
    try { pend = JSON.parse(ls.get(STATE_KEY) || 'null'); } catch (x) { pend = null; }
    ls.del(STATE_KEY);
    const kind = (pend && pend.kind) || 'ability';
    if (!pend || pend.s !== state || Date.now() - pend.at > 20 * 60e3) return { kind, provider: 'line', error: 'state' };
    if (e || !code) return { kind, provider: 'line', error: e === 'access_denied' ? 'denied' : 'PROVIDER' };
    try {
      const d = await post('auth.line', Object.assign({ code, redirectUri: cfg.redirectUri, ip: sessionIp() }, extra()));
      return { kind, provider: 'line', session: save(d, 'line') };
    } catch (x) { return { kind, provider: 'line', error: x.code || 'SERVER' }; }
  }
  /* 回訪：續期 vt（示範帳號不連線） */
  const s = session();
  if (s && !s.demo && !cfg.demo) {
    try { save(await post('visitor.me', { fp: sessionFp() }), s.src); }
    catch (x) { if (x.code === 'EXPIRED' || x.code === 'UNAUTHORIZED') logout(); }
  } else if (s && s.demo && !cfg.demo) logout();                         /* 正式上線後清掉示範帳號 */
  else flushPending();
  return null;
}

/* ---------- 測驗結果 quiz.result ---------- */
function readPending() { try { const v = JSON.parse(ls.get(PENDING_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
let flushing = false;
async function flushPending() {
  const s = session();
  if (flushing || !s || s.demo || config().demo) return;
  const list = readPending();
  if (!list.length) return;
  flushing = true;
  const left = [];
  for (const item of list) {
    try { await post('quiz.result', item); }
    catch (e) { if (e.code !== 'BAD_REQUEST') left.push(item); }
  }
  ls.set(PENDING_KEY, JSON.stringify(left.slice(-10)));
  flushing = false;
}
/** 完成測驗：登入中送出；失敗（離線、未授權）保留，下次登入或載入時補送。示範模式不送 */
export function submitResult(payload) {
  if (config().demo) return false;
  const list = readPending(); list.push(payload);
  ls.set(PENDING_KEY, JSON.stringify(list.slice(-10)));
  flushPending();
  return true;
}
