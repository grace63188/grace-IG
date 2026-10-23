// ICS 解析邊界測試（合成資料）：位元組折行、換行格式、跳脫、參數、時區、取消、單次修改、EXDATE、時間窗
// 執行：node --test scripts/tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLiveData, isLiveTitle } from '../update_live.mjs';
import { decodeIcsBytes, unfoldBytes, parseIcs, eventSummary, collectOccurrences } from '../lib/ics.mjs';

const NOW = new Date('2026-10-23T01:00:00Z'); // 台北 2026-10-23 09:00
const DT = 'DTSTART;TZID=Asia/Taipei:20261025T193000\r\nDTEND;TZID=Asia/Taipei:20261025T210000';
const cal = (body, head = 'X-WR-TIMEZONE:Asia/Taipei\r\n') =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${head}BEGIN:VEVENT\r\nUID:t1\r\n${body}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
const starts = (ics) => buildLiveData(ics, { now: NOW }).events.map((e) => e.start);
const TARGET = ['2026-10-25T19:30:00+08:00'];
const te = new TextEncoder();

test('折行切在中文字中間（75 位元組折行）：位元組層級還原後標題正確', () => {
  const line = te.encode('SUMMARY:IG直播'); // 「播」佔 3 位元組，從中間切開
  const folded = new Uint8Array([...line.slice(0, 12), 13, 10, 32, ...line.slice(12)]);
  const bytes = new Uint8Array([...te.encode('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:t1\r\n'), ...folded, ...te.encode(`\r\n${DT}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`)]);
  // 先解碼再還原 → 損毀（示範舊路徑的問題）
  const naive = new TextDecoder().decode(bytes);
  assert.notEqual(eventSummary(parseIcs(naive).events[0]), 'IG直播');
  assert.deepEqual(starts(naive), []);
  // 位元組層級還原 → 正確
  const text = decodeIcsBytes(bytes);
  assert.equal(eventSummary(parseIcs(text).events[0]), 'IG直播');
  assert.deepEqual(starts(text), TARGET);
});

test('位元組折行：CRLF / LF / CR 加空白或 Tab 皆可還原；非折行的換行保留；BOM 去除', () => {
  const dec = (s) => new TextDecoder().decode(unfoldBytes(te.encode(s)));
  assert.equal(dec('A:1\r\n 2\r\nB:3'), 'A:12\r\nB:3');
  assert.equal(dec('A:1\n\t2\nB:3'), 'A:12\nB:3');
  assert.equal(dec('A:1\r 2\rB:3'), 'A:12\rB:3');
  assert.equal(decodeIcsBytes(te.encode('﻿A:1')), 'A:1');
  assert.deepEqual(starts(decodeIcsBytes(te.encode(cal(`SUMMARY:IG直\r\n 播\r\n${DT}`)))), TARGET);
});

test('換行格式：LF、CR、CRLF 與文字層折行（含 Tab）皆可解析', () => {
  const ics = cal(`SUMMARY:IG直播\r\n${DT}`);
  assert.deepEqual(starts(ics.replace(/\r\n/g, '\n')), TARGET);
  assert.deepEqual(starts(ics.replace(/\r\n/g, '\r')), TARGET);
  assert.deepEqual(starts(cal(`SUMMARY:IG直\r\n\t播\r\n${DT}`)), TARGET);
  assert.deepEqual(starts(cal(`SUMMARY:IG直播\r\nDTSTART;TZID=Asia/Taipei:2026\r\n 1025T193000\r\nDTEND;TZID=Asia/Taipei:20261025T210000`)), TARGET);
  assert.deepEqual(starts('﻿' + ics), TARGET);
});

test('參數與跳脫：SUMMARY;LANGUAGE=zh-TW、小寫屬性名、跳脫字元', () => {
  assert.deepEqual(starts(cal(`SUMMARY;LANGUAGE=zh-TW:IG直播\r\n${DT}`)), TARGET);
  assert.deepEqual(starts(cal(`summary:IG直播\r\ndtstart;tzid=Asia/Taipei:20261025T193000\r\ndtend;tzid=Asia/Taipei:20261025T210000`)), TARGET);
  assert.deepEqual(starts(cal(`SUMMARY:IG直播\\,\r\n${DT}`)), []); // 跳脫逗號是標題的一部分 → 不相等
  assert.equal(eventSummary(parseIcs(cal(`SUMMARY:a\;b\\\\c\\nd\r\n${DT}`)).events[0]), 'a;b\\c\nd');
});

test('時區格式：TZID 引號、/ 前綴、自訂 VTIMEZONE 名稱、浮動時間、UTC Z；X-WR-TIMEZONE 影響浮動時間', () => {
  assert.deepEqual(starts(cal(`SUMMARY:IG直播\r\nDTSTART;TZID="Asia/Taipei":20261025T193000\r\nDTEND;TZID="Asia/Taipei":20261025T210000`)), TARGET);
  assert.deepEqual(starts(cal(`SUMMARY:IG直播\r\nDTSTART;TZID=/mozilla.org/20050126_1/Asia/Taipei:20261025T193000\r\nDTEND;TZID=/mozilla.org/20050126_1/Asia/Taipei:20261025T210000`)), TARGET);
  assert.deepEqual(starts(cal(`SUMMARY:IG直播\r\nDTSTART;TZID=Custom-TPE:20261025T193000\r\nDTEND;TZID=Custom-TPE:20261025T210000`)), TARGET); // 無效 TZID → 退回行事曆時區
  assert.deepEqual(starts(cal(`SUMMARY:IG直播\r\nDTSTART:20261025T193000\r\nDTEND:20261025T210000`)), TARGET);
  assert.deepEqual(starts(cal(`SUMMARY:IG直播\r\nDTSTART:20261025T193000\r\nDTEND:20261025T210000`, '')), TARGET);
  assert.deepEqual(starts(cal(`SUMMARY:IG直播\r\nDTSTART:20261025T113000Z\r\nDTEND:20261025T130000Z`)), TARGET);
  assert.deepEqual(starts(cal(`SUMMARY:IG直播\r\n${DT}`, 'X-WR-TIMEZONE:America/Los_Angeles\r\n')), TARGET); // 明確 TZID 不受影響
});

test('VTIMEZONE 與 VALARM 子元件不影響 VEVENT 解析', () => {
  const ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-WR-TIMEZONE:Asia/Taipei\r\nBEGIN:VTIMEZONE\r\nTZID:Asia/Taipei\r\nBEGIN:STANDARD\r\nTZOFFSETFROM:+0800\r\nTZOFFSETTO:+0800\r\nDTSTART:19700101T000000\r\nSUMMARY:not-an-event\r\nEND:STANDARD\r\nEND:VTIMEZONE\r\nBEGIN:VEVENT\r\nUID:t1\r\nSUMMARY:IG直播\r\n${DT}\r\nSTATUS:CONFIRMED\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nSUMMARY:alarm\r\nTRIGGER:-P0DT0H30M0S\r\nEND:VALARM\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
  assert.equal(parseIcs(ics).events.length, 1);
  assert.deepEqual(starts(ics), TARGET);
});

test('狀態與時間窗：CANCELLED 排除、TENTATIVE 保留、DTEND 已過不顯示、無 DTEND 視為零長度', () => {
  assert.deepEqual(starts(cal(`SUMMARY:IG直播\r\n${DT}\r\nSTATUS:CANCELLED`)), []);
  assert.deepEqual(starts(cal(`SUMMARY:IG直播\r\n${DT}\r\nSTATUS:TENTATIVE`)), TARGET);
  assert.deepEqual(starts(cal(`SUMMARY:IG直播\r\nDTSTART;TZID=Asia/Taipei:20261023T070000\r\nDTEND;TZID=Asia/Taipei:20261023T083000`)), []);
  assert.deepEqual(starts(cal(`SUMMARY:IG直播\r\nDTSTART;TZID=Asia/Taipei:20261025T193000`)), TARGET);
});

test('單次修改（RECURRENCE-ID）：不論出現在主事件之前或之後，改期的那次取代原本的；EXDATE 多種格式', () => {
  const master = `UID:t1\r\nSUMMARY:IG直播\r\nDTSTART;TZID=Asia/Taipei:20261018T193000\r\nDTEND;TZID=Asia/Taipei:20261018T210000\r\nRRULE:FREQ=WEEKLY;BYDAY=SU;COUNT=3`;
  const ov = `UID:t1\r\nRECURRENCE-ID;TZID=Asia/Taipei:20261025T193000\r\nSUMMARY:IG直播\r\nDTSTART;TZID=Asia/Taipei:20261025T200000\r\nDTEND;TZID=Asia/Taipei:20261025T213000`;
  const wrap = (...evs) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${evs.map((e) => `BEGIN:VEVENT\r\n${e}\r\nEND:VEVENT\r\n`).join('')}END:VCALENDAR\r\n`;
  const want = ['2026-10-25T20:00:00+08:00', '2026-11-01T19:30:00+08:00'];
  assert.deepEqual(starts(wrap(master, ov)), want);
  assert.deepEqual(starts(wrap(ov, master)), want);
  assert.deepEqual(starts(wrap(master, ov + '\r\nSTATUS:CANCELLED')), ['2026-11-01T19:30:00+08:00']);
  assert.deepEqual(starts(wrap(master + '\r\nEXDATE;TZID=Asia/Taipei:20261101T193000')), TARGET);
  assert.deepEqual(starts(wrap(master + '\r\nEXDATE:20261101T113000Z')), TARGET);
  assert.deepEqual(starts(wrap(master + '\r\nEXDATE;TZID=Asia/Taipei:20261018T193000,20261101T193000')), TARGET);
  assert.deepEqual(starts(wrap(master.replace('COUNT=3', 'UNTIL=20261025T113000Z'))), TARGET);
  assert.deepEqual(starts(wrap(master.replace('COUNT=3', 'UNTIL=20261025'))), TARGET);
});

test('全天（VALUE=DATE）在 lib 層會被略過並警告', () => {
  const warns = [];
  const occ = collectOccurrences(cal(`SUMMARY:IG直播\r\nDTSTART;VALUE=DATE:20261025\r\nDTEND;VALUE=DATE:20261026`), { now: NOW.getTime(), days: 60, match: isLiveTitle, warn: (m) => warns.push(m) });
  assert.equal(occ.length, 0);
  assert.equal(warns.length, 1);
});
