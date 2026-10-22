/* 事件追蹤（依 hub-admin/CONTRACT.md「事件批次 event.batch」）
   - 本機佇列 localStorage['gh.q']（try/catch；無痕或封鎖時改存記憶體），上限 300 筆，超過丟最舊
   - 每 3 秒或滿 10 筆送一次（一次最多 50 筆）；失敗 2s→4s→8s→30s 退避，連續 5 次失敗後保留佇列、下次載入再送；
     RATE_LIMIT 30 秒後重試；BAD_REQUEST 表示該批永遠不會被接受，直接丟棄避免卡住佇列
   - 離開頁面（visibilitychange→hidden、pagehide）改用 sendBeacon
   - 每筆佇列紀錄：id、t（epoch ms）、契約欄位 n／k／v／u／ref、元素代號 el、裝置 id did、訪客 token vt（有才帶）
     送出時只帶契約欄位；did／vt 放在請求外層。login_done／quiz_done 由資料中心自動補，前台只留本機紀錄（local）
   - 示範模式：只寫入本機佇列，不送出、不讀 IP，也不在主控台列印任何內容
   - 點擊自動收集：document 擷取階段監聽 [data-ev]；動態事件由各模組呼叫 track() */
import { isDemo } from './config.js';
import { post, beacon as sendBeacon, setIdentity, fetchIp } from './api.js';

export const Q_KEY = 'gh.q';
export const DID_KEY = 'gh.did';
const CAP = 300, EVERY = 3000, FULL = 10, MAX = 50, BEACON_MAX = 60000, GAP = 30 * 60e3;
const BACKOFF = [2000, 4000, 8000, 30000, 30000];

const mem = {};
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return k in mem ? mem[k] : null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { mem[k] = v; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { delete mem[k]; } },
};
const ss = {
  get(k) { try { return sessionStorage.getItem(k); } catch (e) { return mem['ss.' + k] ?? null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { mem['ss.' + k] = v; } },
};
const hex4 = () => { try { const a = new Uint8Array(2); crypto.getRandomValues(a); return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(''); } catch (e) { return Math.random().toString(16).slice(2, 6).padEnd(4, '0'); } };

/* ---------- 裝置 id、指紋片段、裝置描述、session ---------- */
export function deviceId() {
  let d = ls.get(DID_KEY);
  if (!d || !/^[A-Za-z0-9_-]{6,48}$/.test(d)) {
    try { d = crypto.randomUUID(); } catch (e) { d = ''; }
    if (!d) d = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    ls.set(DID_KEY, d);
  }
  return d;
}
/** App 內建瀏覽器（WebView）判斷：回傳 App 名稱，一般瀏覽器回 ''
    Google 會擋 WebView 登入；LINE 登入在這些環境仍可用 */
const INAPP = [
  ['Threads', /\bBarcelona\b|\bThreads\//i],
  ['IG', /Instagram/i],
  ['Facebook', /FBAN|FBAV|FB_IAB|FBIOS|FB4A|\[FB/],
  ['LINE', /\bLine\//],
  ['App', /MicroMessenger|KAKAOTALK|TikTok|musical_ly|BytedanceWebview|Twitter|Snapchat|; wv\)/i],
];
export function inAppOf(ua = (typeof navigator !== 'undefined' ? navigator.userAgent : '') || '') {
  const hit = INAPP.find(([, re]) => re.test(ua));
  return hit ? hit[0] : '';
}
export function devInfo(ua = (typeof navigator !== 'undefined' ? navigator.userAgent : '') || '') {
  const touchMac = typeof navigator !== 'undefined' && /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  const os = /iPhone|iPad|iPod/i.test(ua) || touchMac ? 'iOS' : /Android/i.test(ua) ? 'Android' : /Macintosh|Mac OS X/i.test(ua) ? 'Mac' : /Windows/i.test(ua) ? 'Windows' : '其他';
  const br = /Instagram/i.test(ua) ? 'IG 內建' : /\bLine\//i.test(ua) ? 'LINE 內建' : /Edg(e|A|iOS)?\//.test(ua) ? 'Edge'
    : /(Chrome|CriOS)\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) && /Version\//.test(ua) ? 'Safari' : '其他';
  return { os, br };
}
async function fingerprint() {
  const c = ss.get('gh.fp');
  if (c) return c;
  try {
    let tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { /* 忽略 */ }
    const src = `${navigator.userAgent}|${screen.width}x${screen.height}|${tz}|${navigator.language}`;
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(src)));
    const fp = Array.from(h, (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
    ss.set('gh.fp', fp);
    return fp;
  } catch (e) { return ''; }
}
function sid(now) {
  let s = ss.get('gh.sid'), last = Number(ss.get('gh.sidt')) || 0;
  if (!s || now - last > GAP) s = 's_' + now;
  ss.set('gh.sid', s); ss.set('gh.sidt', String(now));
  return s;
}
const ctx = { fp: '', ip: '', dev: null };

let tokenOf = () => '';
export const setTokenSource = (fn) => { tokenOf = typeof fn === 'function' ? fn : () => ''; };
setIdentity(() => ({ did: deviceId(), vt: tokenOf() }));

/* ---------- 元素代號 → 契約事件 ---------- */
const NOW = { live: 'live', event: 'event', podcast: 'pod' };
const KEYS = ['quiz', 'study', 'event', 'live', 'follow', 'consult'];
const FOOT = ['line_academy', 'line_sampler', 'ig', 'yt', 'pod'];
const urlPart = (u) => { try { const x = new URL(u, location.href); return (x.host + x.pathname).slice(0, 200); } catch (e) { return ''; } };

/** 回傳 { n, k, v, u, ref } 或 { local: true }（只留本機、不送出） */
export function wire(el, act, meta = {}) {
  const [a, b] = el.split('.');
  const kind = meta.kind === 'career' ? 'career' : 'ability';
  if (el === 'page.enter') return { n: 'enter', ref: meta.ref || '' };
  if (a === 'key' && KEYS.includes(b)) return { n: 'key', k: b };
  if (a === 'now') return NOW[b] ? { n: 'now', k: NOW[b], v: meta.label || '' } : { n: 'card', k: 'now', v: el };
  if (a === 'foot') return FOOT.includes(b) ? { n: 'foot', k: b } : { n: 'foot', k: 'line_academy', v: b };
  if (a === 'tear' && (b === 'ability' || b === 'career')) return { n: 'tear', k: b, v: meta.via || '' };
  if (a === 'snd') return { n: 'sound', k: meta.on ? 'on' : 'off', v: meta.at || '' };
  if (a === 'auth') {
    const p = meta.provider === 'google' || b === 'google' ? 'google' : 'line';
    if (/\.start$/.test(el)) return { n: 'login_start', k: p };
    if (el === 'auth.fail') return { n: 'login_fail', k: p, v: String(meta.code || '') };
    if (el === 'auth.google.blocked') return { n: 'login_fail', k: 'google', v: 'webview' };
    if (el === 'auth.success') return { local: true };                 /* 資料中心自動補 login_done */
  }
  if (a === 'quiz') {
    if (el === 'quiz.answer') return { n: 'quiz_q', k: kind, v: String(meta.q || '') };
    if (el === 'quiz.again') return { n: 'quiz_retry', k: kind };
    if (el === 'quiz.complete') return { local: true };                /* quiz.result 會自動補 quiz_done */
  }
  if (act === 'link' && meta.href) return { n: 'out', k: a === 'quiz' ? 'result' : 'card', v: el, u: urlPart(meta.href) };
  const sheetKey = { rite: 'quiz', quiz: 'quiz', auth: 'quiz', study: 'study', event: 'event', live: 'live', follow: 'follow', consult: 'consult' }[a] || a;
  return { n: 'card', k: String(sheetKey).slice(0, 24), v: el };
}

/* ---------- 佇列 ---------- */
export function readQueue() {
  try { const v = JSON.parse(ls.get(Q_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}
function writeQueue(q) { ls.set(Q_KEY, JSON.stringify(q.slice(-CAP))); }
export function clearQueue() { ls.del(Q_KEY); }

/** 記錄一筆事件：el＝元素代號；act＝click／link／view／answer…；meta 用於對應契約欄位 */
export function track(el, act = 'click', meta = {}) {
  if (typeof el !== 'string' || !el) return null;
  const t = Date.now();
  sid(t);
  const w = wire(el, act, meta || {});
  const rec = { id: `e_${t}_${hex4()}`, t, el: el.slice(0, 64), did: deviceId() };
  if (w.local) rec.local = true;
  else ['n', 'k', 'v', 'u', 'ref'].forEach((f) => { if (w[f] != null && w[f] !== '') rec[f] = String(w[f]).slice(0, f === 'u' ? 200 : 80); });
  if (!rec.local && !rec.n) return null;
  const vt = tokenOf();
  if (vt) rec.vt = vt;
  const q = readQueue(); q.push(rec); writeQueue(q);
  if (!isDemo() && !rec.local) schedule(q.filter((e) => !e.local).length >= FULL ? 0 : EVERY);
  return rec;
}

/* ---------- 送出 ---------- */
let timer = 0, inflight = false, fails = 0, halted = false;
function schedule(ms) {
  if (halted) return;
  if (timer && ms > 0) return;
  clearTimeout(timer);
  timer = setTimeout(() => { timer = 0; flush(); }, ms);
}
const pick = (e) => { const o = { id: e.id, t: e.t, n: e.n }; ['k', 'v', 'u', 'ref'].forEach((f) => { if (e[f]) o[f] = e[f]; }); return o; };
function batchData(evs) {
  const d = { sid: ss.get('gh.sid') || sid(Date.now()), dev: ctx.dev || devInfo(), ev: evs.map(pick) };
  if (ctx.fp) d.fp = ctx.fp;
  if (ctx.ip) d.ip = ctx.ip;
  return d;
}
function drop(ids) { const s = new Set(ids); writeQueue(readQueue().filter((e) => !s.has(e.id))); }

export async function flush() {
  if (inflight || isDemo() || halted) return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  const q = readQueue();
  if (!q.length) return true;
  const part = q.slice(0, MAX);
  const send = part.filter((e) => !e.local && e.n);
  if (!send.length) { drop(part.map((e) => e.id)); return true; }
  inflight = true;
  try {
    await post('event.batch', batchData(send));
    drop(part.map((e) => e.id));
    fails = 0;
    if (readQueue().some((e) => !e.local)) schedule(300);
    return true;
  } catch (e) {
    if (e.code === 'BAD_REQUEST') { drop(part.map((x) => x.id)); fails = 0; schedule(300); return false; }
    if (e.code === 'RATE_LIMIT') { schedule(30000); return false; }
    fails++;
    if (fails >= 5) { halted = true; return false; }                /* 保留佇列，下次載入再送 */
    schedule(BACKOFF[fails - 1]);
    return false;
  } finally { inflight = false; }
}

/** 離開頁面：sendBeacon 送出剩餘事件（每批 ≤50 筆、≤60KB） */
export function beacon() {
  if (isDemo()) return false;
  let q = readQueue(), any = false;
  while (q.length) {
    let n = Math.min(q.length, MAX);
    while (n > 1 && JSON.stringify(batchData(q.slice(0, n).filter((e) => !e.local))).length > BEACON_MAX) n = Math.floor(n / 2);
    const part = q.slice(0, n), send = part.filter((e) => !e.local && e.n);
    if (send.length && !sendBeacon('event.batch', batchData(send))) break;
    any = true;
    drop(part.map((e) => e.id));
    q = readQueue();
  }
  return any;
}

/* ---------- 點擊自動收集 ---------- */
let wired = false;
export function initTracking() {
  if (wired) return;
  wired = true;
  ctx.dev = devInfo();
  if (!isDemo()) {
    fingerprint().then((fp) => { ctx.fp = fp; });
    const ip = ss.get('gh.ip');
    if (ip !== null) ctx.ip = ip;
    else fetchIp().then((x) => { ctx.ip = x; ss.set('gh.ip', x); });
  }
  document.addEventListener('click', (e) => {
    const t = e.target.closest && e.target.closest('[data-ev]');
    if (!t || t.closest('[inert]') || t.disabled || t.getAttribute('aria-disabled') === 'true') return;
    const meta = {};
    if (t.dataset.evMeta) { try { Object.assign(meta, JSON.parse(t.dataset.evMeta)); } catch (x) { /* 忽略 */ } }
    if (t.dataset.ev.startsWith('now.')) meta.label = t.textContent.replace(/\s+/g, ' ').trim().slice(0, 80);
    const link = t.tagName === 'A' && t.href;
    if (link) meta.href = t.href;
    track(t.dataset.ev, link ? 'link' : 'click', meta);
  }, true);
  /* <details data-ev-toggle> 展開／收合 */
  document.addEventListener('toggle', (e) => {
    const d = e.target;
    if (d && d.tagName === 'DETAILS' && d.dataset.evToggle) track(d.dataset.evToggle + (d.open ? '.open' : '.close'), 'toggle');
  }, true);
  const out = () => beacon();
  addEventListener('pagehide', out);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') out(); });
  addEventListener('online', () => { halted = false; fails = 0; schedule(0); });
  if (!isDemo() && readQueue().some((e) => !e.local)) schedule(1500);
}
