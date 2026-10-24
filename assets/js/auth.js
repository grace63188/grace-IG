/* 測驗前登入（依 hub-admin/CONTRACT.md「登入」）
   - LINE（主）：導向授權頁 → 回到 redirectUri（?auth=line&code&state）→ op auth.line 換訪客 token（vt）
   - Google（次）：載入 Google Identity Services，One Tap／FedCM 取得 ID token → op auth.google；
     若瀏覽器略過提示，於卡片內改放 Google 官方按鈕完成登入
   - 自動登入：載入時有 vt → op visitor.me 續期；EXPIRED／UNAUTHORIZED 清除，視為未登入
   - 保存：localStorage gh.vt、gh.person（try/catch）；示範模式以模擬帳號完成，不連線
   - App 內建瀏覽器（Instagram、Threads、Facebook、LINE 等 WebView）：不在此登入，先換到真正的瀏覽器。
     外部開啟（帶 ?go=login，重新開啟時直接到登入卡）：LINE 內建 openExternalBrowser=1、Android intent:// 交給 Chrome，
     iOS 只能靠 App 右上角選單（x-safari-https:// 實機不一定被放行，已移除）；顯示說明時以 markLoginUrl 把目前網址改成登入網址，選單開啟的網址即直接到登入卡
   - LINE 返回時先確認為正式模式（非示範）才清除 state 與網址參數；state 遺失或逾時（多半是換了瀏覽器）回 error 'state'
   - LINE 返回的換 token（auth.line）實測要 3–10 秒（Apps Script 冷啟動）：pendingLine() 先同步讀出所選測驗種類，
     讓 gate 立刻顯示「登入中」的儀式卡，不讓訪客對著首頁等；auth.line／auth.google 逾時放寬到 25 秒 */
import { config } from './config.js?v=20261024d';
import { post } from './api.js?v=20261024d';
import { devInfo, setTokenSource, inAppOf } from './track.js?v=20261024d';

export const VT_KEY = 'gh.vt';
export const PERSON_KEY = 'gh.person';
const STATE_KEY = 'gh.state';
const PENDING_KEY = 'gh.pending';
const DEMO_NAME = '示範學員';
const YEAR = 365 * 86400e3;
const AUTH_TIMEOUT = 25000;                 /* auth.line／auth.google：資料中心含 LINE／Google 驗證，冷啟動可能逾 12 秒 */

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

const pageUrl = () => location.href.split('#')[0];

/** App 內建瀏覽器改用外部瀏覽器開啟本頁的方式：
    line＝LINE 內建瀏覽器（openExternalBrowser=1，改用預設瀏覽器）；intent＝Android（intent:// 交給 Chrome）；
    ''＝只能靠 App 右上角選單（iOS 的 IG、Threads、Facebook 等） */
export function externalMode() {
  if (typeof window.__pvIG === 'boolean') return '';                     /* 預覽：只顯示選單指引 */
  if (inAppName() === 'LINE') return 'line';
  if (platform() === 'android') return 'intent';
  return '';
}
/** 換到外部瀏覽器後要開的網址：保留目前路徑與參數，加 go=login（重新開啟時直接到登入卡；k＝測驗種類） */
export function loginUrl(kind = 'ability') {
  const u = new URL(pageUrl());
  ['go', 'k', 'openExternalBrowser', 'auth', 'code', 'state', 'error', 'error_description', 'friendship_status_changed'].forEach((k) => u.searchParams.delete(k));
  u.searchParams.set('go', 'login');
  if (kind === 'career') u.searchParams.set('k', 'career');
  return u.toString();
}
/** 顯示 App 內開啟說明時：目前網址改成登入網址（App 選單「在外部瀏覽器開啟」帶走的就是它），回傳還原函式 */
export function markLoginUrl(kind = 'ability') {
  try {
    const was = location.pathname + location.search + location.hash, u = new URL(loginUrl(kind));
    history.replaceState(history.state, '', u.pathname + u.search + location.hash);
    return () => { try { history.replaceState(history.state, '', was); } catch (e) { /* 忽略 */ } };
  } catch (e) { return () => {}; }
}
/** 對應方式的外部開啟網址 */
export function externalUrl(mode = externalMode(), kind = 'ability') {
  const url = loginUrl(kind), u = new URL(url);
  if (mode === 'line') { u.searchParams.set('openExternalBrowser', '1'); return u.toString(); }
  if (mode === 'intent') return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(url)};end`;
  return '';
}
/** 嘗試以外部瀏覽器開啟；回 { mode, os }（mode 為 '' 表示無可用方式） */
export function openInBrowser(mode = externalMode(), kind = 'ability') {
  const href = externalUrl(mode, kind);
  if (href) location.href = href;
  return { mode: href ? mode : '', os: platform() };
}
/** 載入時：網址帶 go=login → 回 { kind } 並清掉 go、k、openExternalBrowser；否則 null */
export function takeGoLogin() {
  let q;
  try { q = new URLSearchParams(location.search); } catch (e) { return null; }
  if (q.get('go') !== 'login') return null;
  const kind = q.get('k') === 'career' ? 'career' : 'ability';
  try {
    ['go', 'k', 'openExternalBrowser'].forEach((k) => q.delete(k));
    const qs = q.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
  } catch (e) { /* 忽略 */ }
  return { kind };
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
  const d = await post('auth.google', Object.assign({ credential, ip: sessionIp() }, extra()), { timeout: AUTH_TIMEOUT });
  return save(d, 'google');
}

/** 網址是否為 LINE 授權返回（?auth=line 帶 code／error／state） */
function lineReturn() {
  let q;
  try { q = new URLSearchParams(location.search); } catch (e) { return null; }
  return q.get('auth') === 'line' && (q.get('code') || q.get('error') || q.get('state')) ? q : null;
}
/** 同步版：LINE 授權返回且為正式模式 → { kind }（來自 gh.state，不清除）；其他 null。供 gate 在 resume() 等待資料中心期間先顯示「登入中」 */
export function pendingLine() {
  if (config().demo || !lineReturn()) return null;
  let pend = null;
  try { pend = JSON.parse(ls.get(STATE_KEY) || 'null'); } catch (e) { pend = null; }
  return { kind: pend && pend.kind === 'career' ? 'career' : 'ability' };
}
/** 載入時呼叫：LINE 授權返回 → { kind, provider, session } ／ { kind, provider, error }；有 vt → visitor.me 續期；其他回 null */
export async function resume() {
  const cfg = config();
  const q = lineReturn();
  if (q) {
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
      const d = await post('auth.line', Object.assign({ code, redirectUri: cfg.redirectUri, ip: sessionIp() }, extra()), { timeout: AUTH_TIMEOUT });
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
  if (flushing || (s && s.demo) || config().demo) return;          /* 未登入也送（不帶 vt，資料中心以 did 存，登入後補 pid） */
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
/** 完成測驗：立即送出（登入中帶 vt；未登入不帶 vt，以裝置存）；失敗（離線、未授權）保留，下次載入時補送。示範模式不送 */
export function submitResult(payload) {
  if (config().demo) return false;
  const list = readPending(); list.push(payload);
  ls.set(PENDING_KEY, JSON.stringify(list.slice(-10)));
  flushPending();
  return true;
}
