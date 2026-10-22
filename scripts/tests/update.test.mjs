// 本地單元測試（不需網路）：node --test scripts/tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, readFile as rf } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseRss, pickLatest, normalizeDuration, buildPodcastData, findEpisodeUrl, SHOW_URL } from '../update_podcast.mjs';
import { buildLiveData, DEFAULT_URL } from '../update_live.mjs';
import { collectOccurrences, unfold, parseDateValue } from '../lib/ics.mjs';
import { toTaipeiISO, writeJsonIfChanged } from '../lib/common.mjs';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const feed = await readFile(join(FIX, 'sample_feed.xml'), 'utf8');
const ics = await readFile(join(FIX, 'sample_calendar.ics'), 'utf8');

const ISO_TPE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/;

// ---------------- 共用 ----------------
test('toTaipeiISO 轉成 +08:00', () => {
  assert.equal(toTaipeiISO(new Date('2026-10-19T22:30:00Z')), '2026-10-20T06:30:00+08:00');
  assert.equal(toTaipeiISO(Date.UTC(2026, 11, 31, 16, 0, 0)), '2027-01-01T00:00:00+08:00');
});

test('writeJsonIfChanged：只有 updated 不同時不寫檔', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gia-'));
  const p = join(dir, 'data', 'x.json');
  assert.equal(await writeJsonIfChanged(p, { updated: 'a', v: 1 }), true);
  assert.equal(await writeJsonIfChanged(p, { updated: 'b', v: 1 }), false);
  assert.equal(JSON.parse(await rf(p, 'utf8')).updated, 'a');
  assert.equal(await writeJsonIfChanged(p, { updated: 'c', v: 2 }), true);
});

// ---------------- PODCAST ----------------
test('RSS 解析：節目資訊不被 <image> 區塊干擾', () => {
  const { channel, items } = parseRss(feed);
  assert.equal(channel.title, '我們下課吧');
  assert.equal(channel.image, 'https://example.com/show-cover.jpg');
  assert.equal(items.length, 3);
  assert.equal(items[0].title, 'EP10 舊的一集 & 測試'); // 實體字元解碼
});

test('依 pubDate 取最新一集（非 RSS 順序）', () => {
  const latest = pickLatest(parseRss(feed).items);
  assert.equal(latest.title, 'EP12 最新一集：校長的 QA 特輯');
  assert.equal(latest.image, 'https://example.com/ep12.jpg');
});

test('duration 正規化', () => {
  assert.equal(normalizeDuration('1800'), '30:00');
  assert.equal(normalizeDuration('01:02:03'), '1:02:03');
  assert.equal(normalizeDuration('45:07'), '45:07');
  assert.equal(normalizeDuration('3725'), '1:02:05');
  assert.equal(normalizeDuration(''), '');
});

test('RSS 格式錯誤會丟出錯誤', () => {
  assert.throws(() => parseRss('<html></html>'), /RSS 格式不正確/);
  assert.throws(() => pickLatest([]), /找不到/);
});

/** 模擬 fetch：依網址回傳 fixture */
function mockFetch(routes) {
  return async (url) => {
    for (const [prefix, handler] of routes) {
      if (url.startsWith(prefix)) {
        const r = typeof handler === 'function' ? handler(url) : handler;
        return { ok: r.status ? r.status < 400 : true, status: r.status || 200, text: async () => r.body };
      }
    }
    return { ok: false, status: 404, text: async () => '' };
  };
}

const showLookup = JSON.stringify({ resultCount: 1, results: [{ wrapperType: 'track', kind: 'podcast', collectionName: '我們下課吧', feedUrl: 'https://feed.example.com/rss', artworkUrl600: 'https://example.com/a600.jpg' }] });
const epLookup = (extra = []) => JSON.stringify({
  results: [
    { wrapperType: 'track', kind: 'podcast' },
    { wrapperType: 'podcastEpisode', trackName: 'EP11 中間的一集（無單集封面）', episodeGuid: 'guid-ep11', trackViewUrl: 'https://podcasts.apple.com/tw/podcast/x/id1659198934?i=1000000011' },
    ...extra,
  ],
});

test('完整流程：以 guid 對到 Apple 單集網址', async () => {
  const fetchImpl = mockFetch([
    ['https://itunes.apple.com/lookup?id=1659198934&entity=podcast&', { body: showLookup }],
    ['https://itunes.apple.com/lookup?id=1659198934&entity=podcastEpisode', { body: epLookup([{ wrapperType: 'podcastEpisode', trackName: '不同標題', episodeGuid: 'guid-ep12', trackViewUrl: 'https://podcasts.apple.com/tw/podcast/x/id1659198934?i=1000000012' }]) }],
    ['https://feed.example.com/rss', { body: feed }],
  ]);
  const data = await buildPodcastData({ fetchImpl, now: new Date('2026-10-21T00:00:00Z'), log: () => {} });
  assert.deepEqual(Object.keys(data), ['updated', 'show', 'latest']);
  assert.deepEqual(Object.keys(data.show), ['title', 'url']);
  assert.deepEqual(Object.keys(data.latest), ['title', 'date', 'url', 'image', 'duration']);
  assert.equal(data.updated, '2026-10-21T08:00:00+08:00');
  assert.deepEqual(data.show, { title: '我們下課吧', url: SHOW_URL });
  assert.deepEqual(data.latest, {
    title: 'EP12 最新一集：校長的 QA 特輯',
    date: '2026-10-20T06:30:00+08:00',
    url: 'https://podcasts.apple.com/tw/podcast/x/id1659198934?i=1000000012',
    image: 'https://example.com/ep12.jpg',
    duration: '1:02:03',
  });
});

test('單集網址：guid 對不到時以音檔網址或標題比對', () => {
  const ep = { guid: 'nope', enclosure: 'https://cdn.example.com/ep12.mp3?source=rss', title: 'EP12' };
  assert.equal(findEpisodeUrl([{ wrapperType: 'podcastEpisode', episodeUrl: 'https://cdn.example.com/ep12.mp3?x=1', trackViewUrl: 'A' }], ep), 'A');
  assert.equal(findEpisodeUrl([{ wrapperType: 'podcastEpisode', trackName: ' ep12 ', trackViewUrl: 'B' }], ep), 'B');
});

test('單集 lookup 對不到 → 退回 RSS link；lookup 失敗也不致命', async () => {
  const fetchImpl = mockFetch([
    ['https://itunes.apple.com/lookup?id=1659198934&entity=podcast&', { body: showLookup }],
    ['https://itunes.apple.com/lookup?id=1659198934&entity=podcastEpisode', { status: 500, body: '' }],
    ['https://feed.example.com/rss', { body: feed }],
  ]);
  const data = await buildPodcastData({ fetchImpl, log: () => {} });
  assert.equal(data.latest.url, 'https://example.com/ep12');
});

test('RSS 無 link 時退回節目網址；無單集封面時用節目封面', async () => {
  const feed2 = feed.replace(/<item>[\s\S]*?<\/item>/g, '') .replace('</channel>',
    '<item><title>只有標題</title><pubDate>Tue, 20 Oct 2026 01:00:00 GMT</pubDate></item></channel>');
  const fetchImpl = mockFetch([
    ['https://itunes.apple.com/lookup?id=1659198934&entity=podcast&', { body: showLookup }],
    ['https://itunes.apple.com/lookup?id=1659198934&entity=podcastEpisode', { body: epLookup() }],
    ['https://feed.example.com/rss', { body: feed2 }],
  ]);
  const data = await buildPodcastData({ fetchImpl, log: () => {} });
  assert.equal(data.latest.url, SHOW_URL);
  assert.equal(data.latest.image, 'https://example.com/show-cover.jpg');
  assert.equal(data.latest.duration, '');
});

test('必要步驟失敗會丟出錯誤（不產生資料）', async () => {
  await assert.rejects(buildPodcastData({ fetchImpl: mockFetch([]), log: () => {} }), /HTTP 404/);
  await assert.rejects(
    buildPodcastData({ fetchImpl: mockFetch([['https://itunes.apple.com/', { body: '{"results":[]}' }]]), log: () => {} }),
    /找不到 feedUrl/,
  );
  await assert.rejects(
    buildPodcastData({
      fetchImpl: mockFetch([
        ['https://itunes.apple.com/lookup?id=1659198934&entity=podcast&', { body: showLookup }],
        ['https://feed.example.com/rss', { body: '<html>oops</html>' }],
      ]),
      log: () => {},
    }),
    /RSS 格式不正確/,
  );
});

test('初始狀態 latest:null 可被正確覆寫；相同內容不重寫', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gia-'));
  const p = join(dir, 'data', 'podcast.json');
  const init = { updated: null, show: { title: '芮力話｜我們下課吧', url: SHOW_URL }, latest: null };
  assert.equal(await writeJsonIfChanged(p, init), true);
  assert.equal(await writeJsonIfChanged(p, { ...init }), false);
  const fetchImpl = mockFetch([
    ['https://itunes.apple.com/lookup?id=1659198934&entity=podcast&', { body: showLookup }],
    ['https://itunes.apple.com/lookup?id=1659198934&entity=podcastEpisode', { body: epLookup() }],
    ['https://feed.example.com/rss', { body: feed }],
  ]);
  const data = await buildPodcastData({ fetchImpl, log: () => {} });
  assert.equal(await writeJsonIfChanged(p, data), true);
  const saved = JSON.parse(await rf(p, 'utf8'));
  assert.equal(saved.latest.title, 'EP12 最新一集：校長的 QA 特輯');
});

test('repo 內 data/podcast.json 為合法的初始狀態（latest:null）', async () => {
  const repoData = JSON.parse(await readFile(join(FIX, '..', '..', 'data', 'podcast.json'), 'utf8'));
  assert.deepEqual(Object.keys(repoData), ['updated', 'show', 'latest']);
  assert.ok(repoData.latest === null || (typeof repoData.latest.title === 'string' && repoData.latest.title.trim()));
  assert.ok(!JSON.stringify(repoData).includes('示意'));
});

// ---------------- 直播 ----------------
const NOW = new Date('2026-10-21T10:00:00Z'); // 台北 2026-10-21 18:00

test('ICS unfolding', () => {
  assert.equal(unfold('SUMMARY:ab\r\n cd\r\n\tef'), 'SUMMARY:abcdef');
});

test('日期解析：TZID / Z / 全天', () => {
  assert.equal(parseDateValue('20261021T200000', { TZID: 'Asia/Taipei' }).ms, Date.parse('2026-10-21T12:00:00Z'));
  assert.equal(parseDateValue('20261021T120000Z').ms, Date.parse('2026-10-21T12:00:00Z'));
  const d = parseDateValue('20261101', { VALUE: 'DATE' });
  assert.equal(d.allDay, true);
  assert.equal(d.ms, Date.parse('2026-10-31T16:00:00Z'));
  assert.equal(parseDateValue('20261030T080000', { TZID: 'America/New_York' }).ms, Date.parse('2026-10-30T12:00:00Z'));
});

test('展開全部事件（重複、EXDATE、RECURRENCE-ID 取消、STATUS:CANCELLED、60 天）', () => {
  const all = collectOccurrences(ics, { now: NOW.getTime(), days: 60, fallbackUrl: DEFAULT_URL });
  const got = all.map((e) => `${toTaipeiISO(e.startMs)} ${e.title}`);
  assert.deepEqual(got, [
    '2026-10-21T15:00:00+08:00 進行中的直播（尚未結束）',
    '2026-10-21T20:00:00+08:00 週三晚間 IG 直播',
    '2026-10-23T20:00:00+08:00 UTC 時間的單次直播（台北 20:00）',
    '2026-10-24T09:00:00+08:00 隔日晨間短直播',
    // 10-26 被 RECURRENCE-ID + CANCELLED 取消
    '2026-10-28T09:00:00+08:00 隔日晨間短直播',
    // 10-28 週三被 EXDATE 排除
    '2026-10-30T20:00:00+08:00 紐約時區的連線直播（台北 20:00）',
    // 11-01 全天事件略過
    '2026-11-02T20:00:00+08:00 雙週一四直播',
    '2026-11-04T20:00:00+08:00 週三晚間 IG 直播',
    '2026-11-05T20:00:00+08:00 雙週一四直播',
    '2026-11-11T20:00:00+08:00 週三晚間 IG 直播', // COUNT=4 的第 4 次
    '2026-11-16T20:00:00+08:00 雙週一四直播',
    '2026-11-19T20:00:00+08:00 雙週一四直播',
    '2026-11-30T20:00:00+08:00 雙週一四直播', // UNTIL（全天日期）當日含
  ]);
  assert.ok(!got.some((s) => s.includes('全天') || s.includes('已取消') || s.includes('已結束') || s.includes('超過 60 天') || s.includes('不應被')));
});

test('lib：網址取用規則（LOCATION 中的網址、URL 屬性、預設）', () => {
  const occ = collectOccurrences(ics, { now: NOW.getTime(), days: 60, fallbackUrl: DEFAULT_URL });
  assert.equal(occ[0].url, 'https://meet.example.com/abc'); // LOCATION 中的網址
  assert.equal(occ[1].url, 'https://live.example.com/grace'); // LOCATION 整段是網址
  assert.equal(occ[2].url, 'https://example.com/utc-live'); // URL 屬性
  assert.equal(occ[3].url, DEFAULT_URL); // 沒網址 → 預設
  assert.equal(toTaipeiISO(occ[3].endMs), '2026-10-24T09:30:00+08:00');
  assert.equal(DEFAULT_URL, 'https://www.instagram.com/grace.wwwwwwww'); // 預設＝校長 IG
});

test('lib：全天事件略過並輸出警告（CRLF 換行亦同）', () => {
  const crlf = ics.replace(/\n/g, '\r\n');
  const warns = [];
  const occ = collectOccurrences(crlf, { now: Date.parse('2026-10-31T00:00:00Z'), days: 60, fallbackUrl: DEFAULT_URL, warn: (m) => warns.push(m) });
  assert.ok(occ.length > 0);
  assert.ok(!occ.some((e) => e.title.startsWith('五週年慶')));
  assert.equal(warns.filter((m) => m.includes('略過全天事件') && m.includes('五週年慶全天 直播馬拉松')).length, 1);
});

test('lib：全天重複事件只警告一次', () => {
  const allDayRepeat = [
    'BEGIN:VCALENDAR', 'VERSION:2.0',
    'BEGIN:VEVENT', 'UID:ad-rep@test', 'DTSTART;VALUE=DATE:20261022', 'DTEND;VALUE=DATE:20261023',
    'RRULE:FREQ=DAILY;COUNT=5', 'SUMMARY:全天重複', 'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const warns = [];
  const occ = collectOccurrences(allDayRepeat, { now: NOW.getTime(), fallbackUrl: DEFAULT_URL, warn: (m) => warns.push(m) });
  assert.deepEqual(occ, []);
  assert.equal(warns.length, 1);
});

test('lib：http:// 連結升級為 https:// 並警告', () => {
  const httpIcs = [
    'BEGIN:VCALENDAR', 'VERSION:2.0',
    'BEGIN:VEVENT', 'UID:http1@test', 'DTSTART:20261022T120000Z', 'DTEND:20261022T130000Z',
    'SUMMARY:URL 屬性為 http', 'URL:http://example.com/live1', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:http2@test', 'DTSTART:20261023T120000Z', 'DTEND:20261023T130000Z',
    'SUMMARY:地點為 http', 'LOCATION:HTTP://live.example.com/grace', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:https@test', 'DTSTART:20261024T120000Z', 'DTEND:20261024T130000Z',
    'SUMMARY:已是 https', 'LOCATION:https://example.com/ok', 'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const warns = [];
  const occ = collectOccurrences(httpIcs, { now: NOW.getTime(), fallbackUrl: DEFAULT_URL, warn: (m) => warns.push(m) });
  assert.deepEqual(occ.map((e) => e.url), [
    'https://example.com/live1',
    'https://live.example.com/grace',
    'https://example.com/ok',
  ]);
  assert.equal(warns.filter((m) => m.includes('https://')).length, 2);
});

test('無效 ICS 丟出錯誤；沒有未來事件時輸出空陣列', () => {
  assert.throws(() => buildLiveData('<html>', { warn: () => {} }), /ICS 格式不正確/);
  const data = buildLiveData(ics, { now: new Date('2028-01-01T00:00:00Z'), warn: () => {} });
  assert.deepEqual(data.events, []);
});
