/* 共用：時間（台北）、資料讀取、小工具 */

const TPE = 8 * 3600e3;

/* 測試用：?now=2026-11-13T00:00:00+08:00 可模擬時間（僅限本機 localhost／127.0.0.1） */
let offset = 0;
try {
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
    const q = new URLSearchParams(location.search).get('now');
    if (q && !Number.isNaN(Date.parse(q))) offset = Date.parse(q) - Date.now();
  }
} catch (e) { /* 忽略 */ }

export const now = () => Date.now() + offset;
export const ts = (iso) => { const t = Date.parse(iso); return Number.isNaN(t) ? NaN : t; };

/* 以台北時間拆解任一時間點 */
export function tpe(t) {
  const d = new Date(t + TPE);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() };
}
export const pad = (n) => String(n).padStart(2, '0');
export const fmtDate = (t) => { const p = tpe(t); return `${p.y}.${pad(p.mo)}.${pad(p.d)}`; };
export const fmtHM = (t) => { const p = tpe(t); return `${pad(p.h)}:${pad(p.mi)}`; };

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
export const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };
export const buzz = (p) => { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* 不支援 */ } };

/* 讀取 JSON：逾時或失敗回傳 null，由呼叫端改用內嵌預設值
   ?v= 以 10 分鐘為單位變動，避開 CDN／瀏覽器的舊快取 */
export async function getJSON(url, ms = 8000) {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), ms) : 0;
  const v = Math.floor(Date.now() / 600000);
  try {
    const r = await fetch(`${url}${url.includes('?') ? '&' : '?'}v=${v}`, { cache: 'no-cache', signal: ctl ? ctl.signal : undefined });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function fallback() {
  try { return JSON.parse(document.getElementById('fallback').textContent); } catch (e) { return {}; }
}

/* 依路徑取值：'academy.links.primary.url'、'consult.rules.0' */
export function pick(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export function safeUrl(u) {
  if (typeof u !== 'string') return null;
  if (/^https:\/\//i.test(u)) return u;
  if (/^(assets|data)\//.test(u)) return u;
  return null;
}

/* HTML 跳脫：所有以 innerHTML 插入的字串與屬性值都必須經過 esc() */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* inert 後備：不支援 inert 的瀏覽器（iOS 15.4 以前等）改以 aria-hidden＋tabindex=-1 排除 */
const INERT_OK = typeof HTMLElement !== 'undefined' && 'inert' in HTMLElement.prototype;
const FOCUSABLE = 'a[href],button,input,select,textarea,[tabindex],[contenteditable="true"]';
export function setInert(el, on) {
  if (!el) return;
  el.toggleAttribute('inert', on);
  if (on) el.setAttribute('aria-hidden', 'true'); else el.removeAttribute('aria-hidden');
  if (INERT_OK) return;
  el.querySelectorAll(FOCUSABLE).forEach((n) => {
    if (on) {
      if (!n.hasAttribute('data-inert-tab')) n.setAttribute('data-inert-tab', n.getAttribute('tabindex') ?? '');
      n.setAttribute('tabindex', '-1');
    } else if (n.hasAttribute('data-inert-tab')) {
      const prev = n.getAttribute('data-inert-tab');
      if (prev === '') n.removeAttribute('tabindex'); else n.setAttribute('tabindex', prev);
      n.removeAttribute('data-inert-tab');
    }
  });
}

/* 標記「JS 已填入」：在此之前 [data-fill] 以 visibility:hidden 保留版位，避免示意值閃現 */
export const filled = (el) => { if (el) el.classList.add('filled'); };
