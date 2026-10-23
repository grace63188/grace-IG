#!/usr/bin/env node
// 更新 data/live.json：讀取 Google 日曆私人 iCal 網址（secret LIVE_ICS_URL）→ 從現在到「下個月底」（台北時間）的「IG直播」
// 排程：每月最後一天台北 23:00 執行一次，載入下個月整月；手動執行則為本月剩餘＋下個月
// 不需額外套件（Node 20+ 內建 fetch）。
//
// 隱私規則（repo 與 Actions 紀錄皆為公開）：
// - 只採用標題為「IG直播」的行程（全形轉半形、去除空白、轉大寫後完全相等；不做「包含」比對）
// - 其他行程在解析時間之前就被丟棄，任何內容都不會寫入檔案或印到 console
// - 輸出每筆只有 title（固定 "IG直播"）、start、end、url（固定校長 IG）
// - console 只印場次數與成功／失敗；不印 ICS 網址、其他行程的數量、標題、時間
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchText, toTaipeiISO, writeJsonIfChanged, isMain } from './lib/common.mjs';
import { collectOccurrences } from './lib/ics.mjs';

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

/** 標題比對：正規化後完全等於「IG直播」（不做包含比對） */
export function isLiveTitle(summary) {
  return normalizeTitle(summary) === LIVE_KEY;
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

export async function run({ env = process.env, log = console.log, error = console.error, fetchImpl, now, outPath = OUT_PATH } = {}) {
  const icsUrl = String(env.LIVE_ICS_URL || '').trim();
  if (!icsUrl) {
    log('::notice title=IG直播更新略過::尚未設定 repository secret LIVE_ICS_URL，未修改 data/live.json。設定方式見 SETUP.md。');
    return 0;
  }
  try {
    const ics = await fetchText(icsUrl, { label: '行事曆', ...(fetchImpl ? { fetchImpl } : {}) });
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
