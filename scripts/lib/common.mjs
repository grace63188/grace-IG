// 共用工具：台北時間格式化、HTTP 取得、僅在內容變更時寫檔
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const TPE_OFFSET_MS = 8 * 60 * 60 * 1000;
const pad = (n, w = 2) => String(n).padStart(w, '0');

/** Date -> "YYYY-MM-DDTHH:mm:ss+08:00"（台灣無日光節約，固定 +08:00） */
export function toTaipeiISO(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) throw new Error(`無效的日期：${date}`);
  const t = new Date(d.getTime() + TPE_OFFSET_MS);
  return (
    `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}` +
    `T${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}+08:00`
  );
}

/** 取得文字內容；非 2xx 或逾時即丟出錯誤 */
export async function fetchText(url, { fetchImpl = globalThis.fetch, timeoutMs = 20000, label = url } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      signal: ctrl.signal,
      headers: { 'user-agent': 'grace-ig-auto/1.0 (+GitHub Actions)' },
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`${label} 回應 HTTP ${res.status}`);
    return await res.text();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`${label} 逾時（${timeoutMs}ms）`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 只有在「updated 以外的內容」有變時才寫檔，避免每次排程都產生 commit。
 * 回傳 true 表示已寫入。
 */
export async function writeJsonIfChanged(path, data) {
  let prev = null;
  try {
    prev = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    prev = null; // 檔案不存在或無法解析，視為需要寫入
  }
  const strip = (o) => {
    if (!o || typeof o !== 'object') return o;
    const { updated, ...rest } = o;
    return JSON.stringify(rest);
  };
  if (prev && strip(prev) === strip(data)) return false;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2) + '\n', 'utf8');
  return true;
}

/** 判斷模組是否被直接執行（而非被測試 import） */
export function isMain(importMetaUrl) {
  if (!process.argv[1]) return false;
  return importMetaUrl === pathToFileURL(resolve(process.argv[1])).href;
}
