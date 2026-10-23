// 行事曆隱私測試：私人行事曆中只有「IG直播」能被取用，其他行程任何資訊都不得出現在輸出與 console
// 執行：node --test scripts/tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { buildLiveData, isLiveTitle, safeError, run, LIVE_URL, MAX_EVENTS } from '../update_live.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, '..', 'fixtures');
const ics = await readFile(join(FIX, 'private_calendar.ics'), 'utf8');
const NOW = new Date('2026-10-21T10:00:00Z'); // 台北 2026-10-21 18:00
const ICS_URL = 'https://calendar.google.com/calendar/ical/secret-token-abc%40group/private-0123456789abcdef/basic.ics';

// 這些字串來自非 IG直播 行程或 IG直播 行程的私人欄位，一律不得外流
const PRIVATE = [
  '看牙醫', '牙醫診所', '健保卡', '家庭聚餐', '家族餐廳', 'family-restaurant',
  'IG直播準備會議', '準備會議', '我的IG直播心得', '心得', '私人改期行程', '私人改期地點', '媽媽生日', '生日', '私人壞資料', 'garbage',
  '秘密描述', '不可外流', '信義區', '秘密路', 'private-link', '每週五直播的私人備註', '已過期場次', '私人主日曆',
  'secret-uid', 'dentist-uid', 'family-uid', 'prep-uid', 'notes-uid', 'birthday-uid', 'broken-uid', 'expired-uid',
  'organizer-secret', 'friend-secret', '主辦人', '朋友', 'mailto',
  'IG 直播', 'ig直播', 'DESCRIPTION', 'LOCATION', 'ATTENDEE', 'ORGANIZER', 'UID', 'SUMMARY',
  'secret-token', 'private-0123', 'calendar.google.com',
];
const leaks = (text) => PRIVATE.filter((s) => text.includes(s));

test('標題比對：去除空白、轉大寫後完全等於 IG直播（不做包含比對）', () => {
  for (const ok of ['IG直播', 'IG 直播', 'ig直播', 'Ig 直播', ' I G　直播 ', 'IG\t直播']) assert.equal(isLiveTitle(ok), true, ok);
  for (const no of ['IG直播準備會議', '我的IG直播心得', '直播', 'IG', 'IG直播2', 'FB直播', '', null, undefined]) assert.equal(isLiveTitle(no), false, String(no));
});

test('只輸出 IG直播：固定標題與網址、只有允許欄位、排除過期與下個月底之後', () => {
  const data = buildLiveData(ics, { now: NOW });
  assert.deepEqual(Object.keys(data), ['updated', 'events']);
  assert.equal(MAX_EVENTS, 40);
  // NOW = 10/21 → 時間窗到 11/30 23:59:59（台北）
  assert.deepEqual(data.events, [
    // 每週五系列（RRULE 展開）；10-30 那一次被改名為私人行程 → 從系列移除且不輸出
    { title: 'IG直播', start: '2026-10-23T20:00:00+08:00', end: '2026-10-23T21:30:00+08:00', url: LIVE_URL },
    { title: 'IG直播', start: '2026-10-25T19:30:00+08:00', end: '2026-10-25T21:00:00+08:00', url: LIVE_URL }, // 含私人欄位，只取時間
    { title: 'IG直播', start: '2026-10-28T20:00:00+08:00', end: '2026-10-28T21:00:00+08:00', url: LIVE_URL }, // 「IG 直播」
    { title: 'IG直播', start: '2026-10-30T12:00:00+08:00', end: '2026-10-30T13:00:00+08:00', url: LIVE_URL }, // 「ig直播」
    { title: 'IG直播', start: '2026-11-06T20:00:00+08:00', end: '2026-11-06T21:30:00+08:00', url: LIVE_URL },
    { title: 'IG直播', start: '2026-11-13T20:00:00+08:00', end: '2026-11-13T21:30:00+08:00', url: LIVE_URL },
    { title: 'IG直播', start: '2026-11-20T20:00:00+08:00', end: '2026-11-20T21:30:00+08:00', url: LIVE_URL },
    { title: 'IG直播', start: '2026-11-27T20:00:00+08:00', end: '2026-11-27T21:30:00+08:00', url: LIVE_URL },
  ]);
  for (const e of data.events) assert.deepEqual(Object.keys(e), ['title', 'start', 'end', 'url']);
  assert.deepEqual(leaks(JSON.stringify(data)), []);
});

test('非 IG直播 行程不會觸發任何警告（警告只可能來自 IG直播 行程）', () => {
  const warns = [];
  buildLiveData(ics, { now: NOW, warn: (m) => warns.push(m) });
  assert.equal(warns.length, 1); // 只有全天的 IG直播
  assert.deepEqual(leaks(warns.join('\n')), []);
});

test('只有私人行程時輸出空陣列', () => {
  const onlyPrivate = ics.replace(/SUMMARY:IG ?直播\r?\n/gi, 'SUMMARY:私人行程\n').replace(/SUMMARY:ig直播/g, 'SUMMARY:私人行程');
  assert.deepEqual(buildLiveData(onlyPrivate, { now: NOW }).events, []);
});

test('錯誤訊息只輸出固定分類，不含網址', () => {
  assert.equal(safeError(new Error(`Failed to parse URL from ${ICS_URL}`)), '讀取或解析行事曆失敗');
  assert.equal(safeError(new Error('行事曆 回應 HTTP 404')), '行事曆回應 HTTP 404');
  assert.equal(safeError(new Error('ICS 格式不正確（找不到 BEGIN:VCALENDAR）')), '行事曆內容格式不正確');
});

// 以子程序執行，擷取真正的 stdout／stderr（等同 GitHub Actions 紀錄）
const execFileP = promisify(execFile);
async function runChild(mode) {
  const dir = await mkdtemp(join(tmpdir(), 'gia-live-'));
  const out = join(dir, 'live.json');
  const mod = pathToFileURL(join(HERE, '..', 'update_live.mjs')).href;
  const code = `
    import { run } from ${JSON.stringify(mod)};
    import { readFileSync } from 'node:fs';
    const ics = readFileSync(${JSON.stringify(join(FIX, 'private_calendar.ics'))}, 'utf8');
    const mode = ${JSON.stringify(mode)};
    const fetchImpl = async (url) => {
      if (mode === 'throw') throw new TypeError('fetch failed: getaddrinfo ENOTFOUND ' + url);
      if (mode === '404') return { ok: false, status: 404, text: async () => '' };
      if (mode === 'html') return { ok: true, status: 200, text: async () => '<html>' + url + '</html>' };
      return { ok: true, status: 200, text: async () => ics };
    };
    process.exitCode = await run({ fetchImpl, now: new Date('2026-10-21T10:00:00Z'), outPath: ${JSON.stringify(out)} });
  `;
  let stdout = '', stderr = '', exit = 0;
  try {
    ({ stdout, stderr } = await execFileP(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, LIVE_ICS_URL: ICS_URL } }));
  } catch (e) {
    ({ stdout, stderr } = e); exit = e.code;
  }
  let file = null;
  try { file = await readFile(out, 'utf8'); } catch { /* 失敗時不寫檔 */ }
  return { stdout, stderr, exit, file };
}

test('實際執行：stdout／stderr 只有 IG直播 計數與成功訊息，不含任何私人字串與網址', async () => {
  const r = await runChild('ok');
  assert.equal(r.exit, 0);
  assert.equal(r.stderr, '');
  assert.deepEqual(r.stdout.trim().split('\n'), [
    'IG直播 8 場',
    'IG直播 略過 1 筆（全天或無法解析）',
    '成功：data/live.json 已更新',
  ]);
  assert.deepEqual(leaks(r.stdout + r.stderr), []);
  assert.ok(!/https?:\/\//.test(r.stdout + r.stderr));
  const saved = JSON.parse(r.file);
  assert.equal(saved.events.length, 8);
  assert.deepEqual(leaks(r.file), []);
  for (const e of saved.events) assert.deepEqual(Object.keys(e), ['title', 'start', 'end', 'url']);
});

for (const mode of ['throw', '404', 'html']) {
  test(`實際執行失敗（${mode}）：錯誤訊息遮蔽網址、不寫檔`, async () => {
    const r = await runChild(mode);
    assert.equal(r.exit, 1);
    assert.equal(r.file, null);
    assert.match(r.stderr, /IG直播更新失敗/);
    assert.deepEqual(leaks(r.stdout + r.stderr), []);
    assert.ok(!/https?:\/\//.test(r.stdout + r.stderr));
  });
}

test('未設定 LIVE_ICS_URL：只印提示、不寫檔', async () => {
  const logs = [];
  const code = await run({ env: {}, log: (m) => logs.push(m), error: (m) => logs.push(m), outPath: '/nonexistent/should-not-write.json' });
  assert.equal(code, 0);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /尚未設定/);
});

test('repo 內 data/live.json 只含允許欄位', async () => {
  const repo = JSON.parse(await readFile(join(HERE, '..', '..', 'data', 'live.json'), 'utf8'));
  assert.deepEqual(Object.keys(repo), ['updated', 'events']);
  assert.ok(repo.events.length <= MAX_EVENTS);
  for (const e of repo.events) {
    assert.deepEqual(Object.keys(e), ['title', 'start', 'end', 'url']);
    assert.equal(e.title, 'IG直播');
    assert.equal(e.url, LIVE_URL);
    assert.match(e.start, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/);
  }
});
