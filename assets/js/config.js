/* 前台設定（依 hub-admin/CONTRACT.md「設定值」）
   鍵：gas（資料中心 /exec 網址）、lineChannelId、googleClientId、redirectUri（LINE 回呼，固定帶 ?auth=line）、ipEndpoint（可留空）
   來源：index.html 內嵌 #hub-config → data/hub.json（有值的欄位覆蓋內嵌值）
   gas 未設定 → 示範模式：登入以模擬帳號完成、事件只寫入本機佇列不送出（測驗照常可做） */
import { getJSON } from './core.js?v=20261031a';

const KEYS = ['gas', 'lineChannelId', 'googleClientId', 'redirectUri', 'ipEndpoint'];
const str = (v) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const https = (u) => (/^https:\/\/[^\s]+$/i.test(u) ? u : '');

export function normalize(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const gas = https(str(r.gas));
  const lineChannelId = str(r.lineChannelId);
  const googleClientId = str(r.googleClientId);
  const redirectUri = https(str(r.redirectUri));
  const ipEndpoint = https(str(r.ipEndpoint));
  return {
    gas, lineChannelId, googleClientId, redirectUri, ipEndpoint,
    providers: { line: !!(gas && lineChannelId && redirectUri), google: !!(gas && googleClientId) },
    demo: !gas,
  };
}

function merge(...srcs) {
  const o = {};
  KEYS.forEach((k) => { o[k] = ''; });
  srcs.forEach((s) => { if (s && typeof s === 'object') KEYS.forEach((k) => { if (str(s[k])) o[k] = str(s[k]); }); });
  return o;
}

function embedded() {
  try { return JSON.parse(document.getElementById('hub-config').textContent); } catch (e) { return {}; }
}

let cfg = normalize({});

/** 先以內嵌值立即可用，再讀 data/hub.json 補上 */
export async function loadConfig() {
  const emb = embedded();
  cfg = normalize(merge(emb));
  const remote = await getJSON('data/hub.json', 4000);
  cfg = normalize(merge(emb, remote));
  return cfg;
}
export const config = () => cfg;
export const isDemo = () => cfg.demo;
