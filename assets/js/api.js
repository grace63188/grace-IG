/* 資料中心 API（依 hub-admin/CONTRACT.md「傳輸方式」）
   - 全部 POST 到 gas，Content-Type: text/plain;charset=utf-8（避免 CORS 預檢），redirect: follow，不帶 cookie
   - body：{ op, did, vt?, ts, data }；回應 {ok:true,data} ／ {ok:false,error:{code,msg}}
   - 本檔是前台唯一知道 op 與欄位名稱的地方 */
import { config } from './config.js?v=20261024d';

let ident = () => ({ did: '', vt: '' });
/** 由 track.js（did）與 auth.js（vt）提供目前身分 */
export const setIdentity = (fn) => { ident = fn; };

export function envelope(op, data, { vt } = {}) {
  const id = ident();
  const b = { op, did: id.did, ts: Date.now(), data: data || {} };
  const t = vt !== undefined ? vt : id.vt;
  if (t) b.vt = t;
  return b;
}

export class ApiError extends Error {
  constructor(code, msg) { super(msg || code); this.code = code; }
}

/** 呼叫資料中心；成功回 data，失敗丟 ApiError（code：BAD_REQUEST／RATE_LIMIT／UNAUTHORIZED／EXPIRED／PROVIDER／LOCKED／SERVER／NETWORK／NO_GAS） */
export async function post(op, data, { timeout = 12000, vt } = {}) {
  const url = config().gas;
  if (!url) throw new ApiError('NO_GAS');
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const t = ctl ? setTimeout(() => ctl.abort(), timeout) : 0;
  let r;
  try {
    r = await fetch(url, {
      method: 'POST', mode: 'cors', redirect: 'follow', credentials: 'omit',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(envelope(op, data, { vt })),
      signal: ctl ? ctl.signal : undefined,
    });
  } catch (e) { throw new ApiError('NETWORK'); } finally { clearTimeout(t); }
  let j = null;
  try { j = await r.json(); } catch (e) { throw new ApiError(r.ok ? 'SERVER' : 'NETWORK'); }
  if (j && j.ok === true) return j.data || {};
  const err = (j && j.error) || {};
  throw new ApiError(typeof err.code === 'string' ? err.code : 'SERVER', typeof err.msg === 'string' ? err.msg : '');
}

/** 離開頁面：sendBeacon（body 為同格式字串，text/plain）；排入即視為已送出 */
export function beacon(op, data) {
  const url = config().gas;
  if (!url || !navigator.sendBeacon) return false;
  try { return navigator.sendBeacon(url, new Blob([JSON.stringify(envelope(op, data))], { type: 'text/plain;charset=utf-8' })); }
  catch (e) { return false; }
}

/** IP 片段：GET ipEndpoint → {ip}；失敗回空字串 */
export async function fetchIp() {
  const url = config().ipEndpoint;
  if (!url) return '';
  try {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const t = ctl ? setTimeout(() => ctl.abort(), 4000) : 0;
    const r = await fetch(url, { credentials: 'omit', signal: ctl ? ctl.signal : undefined });
    clearTimeout(t);
    const j = await r.json();
    return j && typeof j.ip === 'string' && j.ip.length <= 45 ? j.ip : '';
  } catch (e) { return ''; }
}
