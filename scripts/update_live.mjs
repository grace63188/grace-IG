#!/usr/bin/env node
// 更新 data/live.json：讀取 Google 日曆私人 iCal 網址（secret LIVE_ICS_URL）→ 從現在到「下個月底」（台北時間）的「IG直播」
// 排程：每月 26 日台北 23:00 執行一次，載入本月剩餘＋下個月整月；手動執行同樣為本月剩餘＋下個月
// 不需額外套件（Node 20+ 內建 fetch）。
//
// 隱私規則（repo 與 Actions 紀錄皆為公開）：
// - 只採用標題為「IG直播」的行程（全形轉半形、去除空白、去掉頭尾表情符號與一層括號、轉大寫後完全相等；不做「包含」比對）
// - 其他行程在解析時間之前就被丟棄，任何內容都不會寫入檔案或印到 console
// - 輸出每筆只有 title（固定 "IG直播"）、start、end、url（固定校長 IG）
// - console 只印場次數與成功／失敗；不印 ICS 網址、其他行程的數量、標題、時間
// - 診斷模式（DIAG=1，僅限手動執行）只印總數、落在時間窗的數量、近似標題的時間與結構資訊，不印任何標題文字
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchText, toTaipeiISO, writeJsonIfChanged, isMain } from './lib/common.mjs';
import { collectOccurrences, decodeIcsBytes, summarizeEvents } from './lib/ics.mjs';

export const LIVE_TITLE = 'IG直播';
export const LIVE_URL = 'https://www.instagram.com/grace.wwwwwwww';
export const DEFAULT_URL = LIVE_URL; // 舊名稱相容
export const MAX_EVENTS = 40; // 約兩個月的場次上限；網站只顯示下一場（已結束的由前端略過）

const TPE_OFFSET_MS = 8 * 60 * 60 * 1000; // 台灣無日光節約

/** 時間窗結束：下個月最後一刻（台北時間），即「下下個月 1 日 00:00 台北」前 1 毫秒 */
export function windowEndMs(now = new Date()) {
  const t = new Date(now.getTime() + TPE_OFFSET_MS);
  return Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 2, 1) - TPE_OFFSET_MS - 1;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, '..', 'data', 'live.json');

/** 標題正規化：全形轉半形（NFKC）、去除所有空白與零寬字元、轉大寫 */
export function normalizeTitle(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .replace(/[\s​-‍⁠﻿]+/gu, '')
    .toUpperCase();
}

const LIVE_KEY = normalizeTitle(LIVE_TITLE);

// 頭尾裝飾：表情符號（Extended_Pictographic）、星號類符號、變體選擇字元、常見裝飾符號
const DECOR_RE = /^(?:[\p{Extended_Pictographic}\p{Variation_Selector}\u20E3\u2605\u2606\u2729\u272A\u2730\u2B50\u2B51\u2B52\u00B7\u2022\u25CF\u25CB\u25C6\u25C7\u2500\u2501\u3000\s~〜～\-–—_*#|｜]+)|(?:[\p{Extended_Pictographic}\p{Variation_Selector}\u20E3\u2605\u2606\u2729\u272A\u2730\u2B50\u2B51\u2B52\u00B7\u2022\u25CF\u25CB\u25C6\u25C7\u2500\u2501\u3000\s~〜～\-–—_*#|｜]+)$/gu;
// 一層括號：《》〈〉「」『』【】〔〕［］（）[]()
const BRACKETS = [['《', '》'], ['〈', '〉'], ['「', '」'], ['『', '』'], ['【', '】'], ['〔', '〕'], ['[', ']'], ['(', ')'], ['［', '］'], ['（', '）'], ['<', '>'], ['{', '}']];

/**
 * 標題核心：正規化後去掉頭尾裝飾（表情符號、星號等），再去掉一層括號，再去一次裝飾。
 * 「⭐《IG直播》」「《IG直播》」「⭐IG直播」「★《ＩＧ直播》」→ IG直播
 * 「《IG直播》｜主題」「IG直播準備會議」「校長IG直播」→ 原樣（不相等）
 */
export function titleCore(summary) {
  let t = normalizeTitle(summary);
  const strip = (x) => x.replace(DECOR_RE, '');
  t = strip(t);
  for (const [l, r] of BRACKETS) {
    if (t.length > 2 && t.startsWith(l) && t.endsWith(r)) { t = strip(t.slice(l.length, t.length - r.length)); break; }
  }
  return t;
}

/** 標題比對：去除裝飾與括號後完全等於「IG直播」（不做包含比對） */
export function isLiveTitle(summary) {
  return titleCore(summary) === LIVE_KEY;
}

/** 近似標題（診斷用）：正規化後同時含有 IG 與 直播 */
export function isNearTitle(summary) {
  const t = normalizeTitle(summary);
  return t.includes('IG') && t.includes('直播');
}

/** 由 ICS 文字產生輸出物件（純函式，供測試）。warn 只會收到 IG直播 行程的訊息。 */
export function buildLiveData(icsText, { now = new Date(), warn = () => {} } = {}) {
  const occ = collectOccurrences(icsText, {
    now: now.getTime(),
    days: (windowEndMs(now) - now.getTime()) / 86400000,
    defaultTz: 'Asia/Taipei',
    fallbackUrl: LIVE_URL,
    warn,
    match: isLiveTitle,
  });
  return {
    updated: toTaipeiISO(now),
    events: occ.slice(0, MAX_EVENTS).map((e) => ({
      title: LIVE_TITLE,
      start: toTaipeiISO(e.startMs),
      end: toTaipeiISO(e.endMs),
      url: LIVE_URL,
    })),
  };
}

/** 錯誤訊息只輸出固定分類，避免任何網址或行程內容出現在公開紀錄 */
export function safeError(err) {
  const msg = String(err && err.message ? err.message : err);
  const http = msg.match(/HTTP (\d{3})/);
  if (http) return `行事曆回應 HTTP ${http[1]}`;
  if (/逾時/.test(msg)) return '讀取行事曆逾時';
  if (/ICS 格式不正確/.test(msg)) return '行事曆內容格式不正確';
  return '讀取或解析行事曆失敗';
}

const yn = (b) => (b ? 'yes' : 'no');

/**
 * 隱私安全診斷：只回傳數量、布林值與近似標題的時間／結構資訊，不含任何標題文字、網址、日曆識別碼。
 * 純函式，供測試。
 */
export function diagnoseLive(icsText, icsUrl, { now = new Date() } = {}) {
  const lines = [];
  // 網址結構（只輸出布林值）
  let calId = '';
  let isPrivate = false;
  try {
    const path = new URL(icsUrl).pathname;
    const m = path.match(/\/ical\/([^/]+)\//);
    if (m) { try { calId = decodeURIComponent(m[1]); } catch { calId = m[1]; } }
    isPrivate = /\/private-[^/]+\//.test(path);
  } catch { /* 網址無法解析：全部 no */ }
  lines.push(`診斷 網址：日曆ID=grace63188@gmail.com ${yn(calId === 'grace63188@gmail.com')}；日曆ID=b0970111728@gmail.com ${yn(calId === 'b0970111728@gmail.com')}；次要日曆(group) ${yn(calId.endsWith('@group.calendar.google.com'))}；私人網址 ${yn(isPrivate)}；公開網址 ${yn(!isPrivate)}`);

  const nowMs = now.getTime();
  const { calName, calTz, rows } = summarizeEvents(icsText, { now: nowMs, windowEnd: windowEndMs(now), defaultTz: 'Asia/Taipei' });
  lines.push(`診斷 行事曆：名稱長度>0 ${yn(calName.length > 0)}；名稱=grace63188@gmail.com ${yn(calName === 'grace63188@gmail.com')}；X-WR-TIMEZONE 有效 ${yn(!!calTz)}`);
  const years = rows.map((r) => r.year).filter((y) => y != null);
  lines.push(`診斷 事件：VEVENT 總數 ${rows.length}；落在時間窗 ${rows.filter((r) => r.inWindow).length}；已取消 ${rows.filter((r) => r.cancelled).length}；無法解析 ${rows.filter((r) => !r.parsed).length}；最早年份 ${years.length ? Math.min(...years) : '-'}；最晚年份 ${years.length ? Math.max(...years) : '-'}`);
  lines.push(`診斷 時間窗：${toTaipeiISO(nowMs)} → ${toTaipeiISO(windowEndMs(now))}`);
  const near = rows.filter((r) => isNearTitle(r.summary));
  lines.push(`診斷 近似標題（同時含 IG 與 直播）：${near.length} 筆；其中完全相等 ${near.filter((r) => isLiveTitle(r.summary)).length} 筆`);
  for (const r of near) {
    lines.push(`診斷 候選：開始 ${r.startMs != null ? toTaipeiISO(r.startMs) : '-'}；全天 ${yn(r.allDay)}；重複 ${yn(r.recurring)}；單次修改 ${yn(r.override)}；已取消 ${yn(r.cancelled)}；落在時間窗 ${yn(r.inWindow)}；完全相等 ${yn(isLiveTitle(r.summary))}；正規化長度 ${normalizeTitle(r.summary).length}`);
  }
  return lines;
}

export async function run({ env = process.env, log = console.log, error = console.error, fetchImpl, now, outPath = OUT_PATH } = {}) {
  const icsUrl = String(env.LIVE_ICS_URL || '').trim();
  if (!icsUrl) {
    log('::notice title=IG直播更新略過::尚未設定 repository secret LIVE_ICS_URL，未修改 data/live.json。設定方式見 SETUP.md。');
    return 0;
  }
  try {
    const body = await fetchText(icsUrl, { label: '行事曆', raw: true, ...(fetchImpl ? { fetchImpl } : {}) });
    // 位元組層級還原折行後再解碼，避免折行切在中文字中間造成標題損毀
    const ics = typeof body === 'string' ? body : decodeIcsBytes(body);
    if (String(env.DIAG || '').trim() === '1') {
      try { for (const l of diagnoseLive(ics, icsUrl, { now: now || new Date() })) log(l); } catch { log('診斷 無法產生（解析失敗）'); }
    }
    let skipped = 0;
    const data = buildLiveData(ics, { now: now || new Date(), warn: () => { skipped++; } });
    log(`IG直播 ${data.events.length} 場`);
    if (skipped) log(`IG直播 略過 ${skipped} 筆（全天或無法解析）`);
    const written = await writeJsonIfChanged(outPath, data);
    log(written ? '成功：data/live.json 已更新' : '成功：data/live.json 無變化');
    return 0;
  } catch (err) {
    error(`::error title=IG直播更新失敗::${safeError(err)}`);
    error('失敗：既有的 data/live.json 未被修改。');
    return 1;
  }
}

if (isMain(import.meta.url)) {
  run().then((code) => { process.exitCode = code; }, () => {
    console.error('::error title=IG直播更新失敗::讀取或解析行事曆失敗');
    process.exitCode = 1;
  });
}
