// IG直播 標題正規化與重複規則測試（合成資料，無真實行事曆內容）
// 執行：node --test scripts/tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLiveData, isLiveTitle, normalizeTitle, titleCore, windowEndMs } from '../update_live.mjs';
import { toTaipeiISO } from '../lib/common.mjs';
import { collectOccurrences } from '../lib/ics.mjs';

const NOW = new Date('2026-10-23T01:00:00Z'); // 台北 2026-10-23 09:00（週五）
const cal = (body) =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-WR-TIMEZONE:Asia/Taipei\r\nBEGIN:VEVENT\r\nUID:t1\r\n${body}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
const timed = (title) =>
  cal(`SUMMARY:${title}\r\nDTSTART;TZID=Asia/Taipei:20261025T193000\r\nDTEND;TZID=Asia/Taipei:20261025T210000`);
const starts = (ics) => buildLiveData(ics, { now: NOW }).events.map((e) => e.start);

test('標題正規化：全形英數、零寬字元、BOM、不換行空白皆可比對', () => {
  for (const ok of ['ＩＧ直播', 'ｉｇ直播', 'IG​直播', '﻿IG直播', 'IG 直播', 'IG直播 ']) {
    assert.equal(isLiveTitle(ok), true, ok);
  }
  assert.equal(normalizeTitle('ＩＧ　直播'), 'IG直播');
});

test('頭尾表情符號、星號與一層括號會被去掉後比對', () => {
  for (const ok of ['⭐《IG直播》', '《IG直播》', '⭐IG直播', '★《ＩＧ直播》', '⭐️《IG直播》⭐️', 'IG直播 🔴', '【IG直播】', '🔴 IG直播', '「IG直播」', '✨【 IG 直播 】✨']) {
    assert.equal(isLiveTitle(ok), true, ok);
    assert.equal(titleCore(ok), 'IG直播', ok);
  }
});

test('標題仍為完全相等：加字、主題、非成對括號不會被取用', () => {
  for (const no of ['《直播預告》10月25日IG直播（線上）', 'IG直播準備會議', '校長IG直播', '校長 ＩＧ 直播', '《IG直播》｜主題', '《IG直播》主題', 'IG直播：主題', '⭐《IG直播》《第二場》', 'FB直播', '直播', '《》', '⭐']) {
    assert.equal(isLiveTitle(no), false, no);
  }
});

test('⭐《IG直播》的單次行程會被取用，網站標題固定為 IG直播', () => {
  const d = buildLiveData(timed('⭐《IG直播》'), { now: NOW });
  assert.deepEqual(d.events.map((e) => [e.title, e.start]), [['IG直播', '2026-10-25T19:30:00+08:00']]);
});

test('「校長IG直播」等非完全相等標題不會被取用', () => {
  assert.equal(buildLiveData(timed('校長IG直播'), { now: NOW }).events.length, 0);
});

test('全形標題的單次行程會被取用', () => {
  assert.deepEqual(starts(timed('ＩＧ直播')), ['2026-10-25T19:30:00+08:00']);
});

test('每週重複（WEEKLY BYDAY）從過去開始的系列，取出下一場', () => {
  const ics = cal('SUMMARY:IG直播\r\nDTSTART;TZID=Asia/Taipei:20260904T200000\r\nDTEND;TZID=Asia/Taipei:20260904T210000\r\nRRULE:FREQ=WEEKLY;BYDAY=FR');
  assert.deepEqual(starts(ics).slice(0, 2), ['2026-10-23T20:00:00+08:00', '2026-10-30T20:00:00+08:00']);
});

test('每月重複：BYMONTHDAY（時間窗到 11 月底，12/25 超出）', () => {
  const ics = cal('SUMMARY:IG直播\r\nDTSTART;TZID=Asia/Taipei:20260825T200000\r\nDTEND;TZID=Asia/Taipei:20260825T210000\r\nRRULE:FREQ=MONTHLY;BYMONTHDAY=25');
  assert.deepEqual(starts(ics), ['2026-10-25T20:00:00+08:00', '2026-11-25T20:00:00+08:00']);
});

test('每月重複：第 n 個週幾（Google「每月第四個週日」）與最後一個週五', () => {
  const ics = cal('SUMMARY:IG直播\r\nDTSTART;TZID=Asia/Taipei:20260823T193000\r\nDTEND;TZID=Asia/Taipei:20260823T210000\r\nRRULE:FREQ=MONTHLY;BYDAY=4SU');
  assert.deepEqual(starts(ics), ['2026-10-25T19:30:00+08:00', '2026-11-22T19:30:00+08:00']);
  const last = cal('SUMMARY:IG直播\r\nDTSTART;TZID=Asia/Taipei:20260925T200000\r\nDTEND;TZID=Asia/Taipei:20260925T210000\r\nRRULE:FREQ=MONTHLY;BYDAY=-1FR;COUNT=3');
  assert.deepEqual(starts(last), ['2026-10-30T20:00:00+08:00', '2026-11-27T20:00:00+08:00']);
});

test('每月重複：無 BY* 時沿用 DTSTART 日期，31 日在小月跳過', () => {
  const occ = collectOccurrences(
    cal('SUMMARY:IG直播\r\nDTSTART;TZID=Asia/Taipei:20260831T200000\r\nDTEND;TZID=Asia/Taipei:20260831T210000\r\nRRULE:FREQ=MONTHLY'),
    { now: NOW.getTime(), days: 60, match: isLiveTitle },
  );
  assert.equal(occ.length, 1); // lib 以 days=60 呼叫：10/31；11 月沒有 31 日；12/31 超出
});

test('時區邊界：UTC Z 與台北時間換算一致；當天稍早已結束的不顯示、進行中的顯示', () => {
  assert.deepEqual(starts(cal('SUMMARY:IG直播\r\nDTSTART:20261025T113000Z\r\nDTEND:20261025T130000Z')), ['2026-10-25T19:30:00+08:00']);
  assert.deepEqual(starts(cal('SUMMARY:IG直播\r\nDTSTART;TZID=Asia/Taipei:20261023T070000\r\nDTEND;TZID=Asia/Taipei:20261023T083000')), []);
  assert.deepEqual(starts(cal('SUMMARY:IG直播\r\nDTSTART;TZID=Asia/Taipei:20261023T083000\r\nDTEND;TZID=Asia/Taipei:20261023T100000')), ['2026-10-23T08:30:00+08:00']);
});

test('全天行程仍略過（沒有開播時段）', () => {
  let w = 0;
  const d = buildLiveData(cal('SUMMARY:IG直播\r\nDTSTART;VALUE=DATE:20261025\r\nDTEND;VALUE=DATE:20261026'), { now: NOW, warn: () => w++ });
  assert.equal(d.events.length, 0);
  assert.equal(w, 1);
});

test('時間窗：結束於下個月最後一刻（台北時間），跨年與閏年', () => {
  const end = (iso) => toTaipeiISO(windowEndMs(new Date(iso)) + 1);
  assert.equal(end('2026-10-31T15:00:00Z'), '2026-12-01T00:00:00+08:00'); // 10/31 23:00 台北 → 到 11 月底
  assert.equal(end('2026-10-31T16:30:00Z'), '2027-01-01T00:00:00+08:00'); // 排程延遲到 11/1 00:30 台北 → 到 12 月底
  assert.equal(end('2026-11-30T15:00:00Z'), '2027-01-01T00:00:00+08:00'); // 跨年
  assert.equal(end('2028-01-31T15:00:00Z'), '2028-03-01T00:00:00+08:00'); // 閏年 2 月整月
  assert.equal(end('2026-10-15T02:00:00Z'), '2026-12-01T00:00:00+08:00'); // 月中手動：本月剩餘＋下個月
});

test('月底執行：下個月整月都載入，下下個月 1 號起不載入', () => {
  const monthEnd = new Date('2026-10-31T15:00:00Z'); // 台北 10/31 23:00
  const ics = cal('SUMMARY:IG直播\r\nDTSTART;TZID=Asia/Taipei:20261002T200000\r\nDTEND;TZID=Asia/Taipei:20261002T210000\r\nRRULE:FREQ=DAILY;INTERVAL=1');
  const got = buildLiveData(ics, { now: monthEnd }).events.map((e) => e.start);
  assert.equal(got.length, 30);
  assert.equal(got[0], '2026-11-01T20:00:00+08:00');
  assert.equal(got.at(-1), '2026-11-30T20:00:00+08:00');
  const edge = cal('SUMMARY:IG直播\r\nDTSTART;TZID=Asia/Taipei:20261130T233000\r\nDTEND;TZID=Asia/Taipei:20261201T003000');
  assert.equal(buildLiveData(edge, { now: monthEnd }).events.length, 1); // 11/30 深夜開播仍在窗內
  const next = cal('SUMMARY:IG直播\r\nDTSTART;TZID=Asia/Taipei:20261201T000000\r\nDTEND;TZID=Asia/Taipei:20261201T010000');
  assert.equal(buildLiveData(next, { now: monthEnd }).events.length, 0);
});
