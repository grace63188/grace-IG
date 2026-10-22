#!/usr/bin/env node
// 更新 data/podcast.json：Apple Podcasts lookup → RSS → 最新一集
// 不需額外套件（Node 20+ 內建 fetch）。任一必要步驟失敗即以非零結束，且不覆寫既有檔案。
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchText, toTaipeiISO, writeJsonIfChanged, isMain } from './lib/common.mjs';

export const SHOW_ID = '1659198934';
export const SHOW_URL = `https://podcasts.apple.com/tw/podcast/id${SHOW_ID}`;
const LOOKUP_SHOW = `https://itunes.apple.com/lookup?id=${SHOW_ID}&entity=podcast&country=tw`;
const LOOKUP_EPISODES = `https://itunes.apple.com/lookup?id=${SHOW_ID}&entity=podcastEpisode&country=tw&limit=200`;

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, '..', 'data', 'podcast.json');

// ---------- XML 輕量解析 ----------
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeXml(s) {
  if (s == null) return '';
  let out = String(s);
  // CDATA 內容原樣保留
  const cdata = out.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  if (cdata) return cdata[1].trim();
  out = out.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  out = out.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, ent) => {
    if (ent[0] === '#') {
      const code = ent[1].toLowerCase() === 'x' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[ent.toLowerCase()] ?? m;
  });
  return out.trim();
}

const esc = (tag) => tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 取第一個 <tag>內容</tag> */
function tagText(xml, tag) {
  const m = xml.match(new RegExp(`<${esc(tag)}(?:\\s[^>]*)?>([\\s\\S]*?)</${esc(tag)}>`, 'i'));
  return m ? decodeXml(m[1]) : '';
}

/** 取第一個 <tag ... attr="值"> 的屬性 */
function tagAttr(xml, tag, attr) {
  const m = xml.match(new RegExp(`<${esc(tag)}\\s[^>]*?\\b${esc(attr)}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
  return m ? decodeXml(m[2] ?? m[3] ?? '') : '';
}

/** itunes:duration 可能是秒數或 hh:mm:ss，統一成 H:MM:SS 或 M:SS */
export function normalizeDuration(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  let total;
  if (/^\d+$/.test(s)) total = parseInt(s, 10);
  else if (/^\d+(:\d{1,2}){1,2}$/.test(s)) total = s.split(':').reduce((acc, p) => acc * 60 + parseInt(p, 10), 0);
  else return s; // 無法辨識的格式原樣保留
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const p2 = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p2(m)}:${p2(sec)}` : `${m}:${p2(sec)}`;
}

/** 解析 RSS，回傳節目資訊與所有集數（含解析後的日期） */
export function parseRss(xml) {
  if (!/<rss[\s>]/i.test(xml) || !/<channel[\s>]/i.test(xml)) throw new Error('RSS 格式不正確（找不到 <rss>/<channel>）');
  const firstItem = xml.search(/<item[\s>]/i);
  const channelHead = firstItem >= 0 ? xml.slice(0, firstItem) : xml;
  // <image> 區塊內也有 <title>/<link>，先移除避免誤抓
  const headNoImage = channelHead.replace(/<image[\s>][\s\S]*?<\/image>/gi, '');
  const channel = {
    title: tagText(headNoImage, 'title'),
    link: tagText(headNoImage, 'link'),
    image:
      tagAttr(channelHead, 'itunes:image', 'href') ||
      tagText(channelHead.match(/<image[\s>][\s\S]*?<\/image>/i)?.[0] ?? '', 'url'),
  };
  const items = [];
  const re = /<item[\s>]([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const body = m[1];
    const pub = tagText(body, 'pubDate');
    const date = pub ? new Date(pub) : null;
    items.push({
      title: tagText(body, 'title'),
      link: tagText(body, 'link'),
      guid: tagText(body, 'guid'),
      enclosure: tagAttr(body, 'enclosure', 'url'),
      image: tagAttr(body, 'itunes:image', 'href'),
      duration: normalizeDuration(tagText(body, 'itunes:duration')),
      date: date && !Number.isNaN(date.getTime()) ? date : null,
    });
  }
  return { channel, items };
}

export function pickLatest(items) {
  const dated = items.filter((i) => i.date);
  if (!dated.length) throw new Error('RSS 中找不到任何具有效 pubDate 的集數');
  return dated.reduce((a, b) => (b.date > a.date ? b : a));
}

const normTitle = (s) => String(s ?? '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();

/** 從 iTunes podcastEpisode 結果中找對應的單集網址 */
export function findEpisodeUrl(results, ep) {
  const eps = (results || []).filter((r) => r.wrapperType === 'podcastEpisode' && r.trackViewUrl);
  const hit =
    (ep.guid && eps.find((r) => r.episodeGuid && r.episodeGuid === ep.guid)) ||
    (ep.enclosure && eps.find((r) => r.episodeUrl && r.episodeUrl.split('?')[0] === ep.enclosure.split('?')[0])) ||
    eps.find((r) => normTitle(r.trackName) === normTitle(ep.title));
  return hit ? hit.trackViewUrl : '';
}

/** 主流程（fetchImpl 可注入，供測試使用） */
export async function buildPodcastData({ fetchImpl = globalThis.fetch, now = new Date(), log = console.log } = {}) {
  // 1) 節目 lookup → feedUrl
  const showRaw = await fetchText(LOOKUP_SHOW, { fetchImpl, label: 'iTunes 節目 lookup' });
  let show;
  try {
    show = JSON.parse(showRaw);
  } catch {
    throw new Error('iTunes 節目 lookup 回傳非 JSON');
  }
  const showInfo = (show.results || []).find((r) => r.feedUrl) || null;
  if (!showInfo) throw new Error('iTunes 節目 lookup 找不到 feedUrl');
  log(`feedUrl: ${showInfo.feedUrl}`);

  // 2) RSS → 最新一集
  const rss = await fetchText(showInfo.feedUrl, { fetchImpl, label: 'RSS feed' });
  const { channel, items } = parseRss(rss);
  const latest = pickLatest(items);
  log(`最新一集：${latest.title}（${latest.date.toISOString()}）`);

  // 3) 單集 Apple 網址（失敗不致命，依序退回 RSS link → 節目網址）
  let episodeUrl = '';
  try {
    const epRaw = await fetchText(LOOKUP_EPISODES, { fetchImpl, label: 'iTunes 單集 lookup' });
    episodeUrl = findEpisodeUrl(JSON.parse(epRaw).results, latest);
    if (!episodeUrl) log('單集 lookup 中找不到對應集數，改用備援網址');
  } catch (err) {
    log(`單集 lookup 失敗（改用備援網址）：${err.message}`);
  }

  const showTitle = channel.title || showInfo.collectionName || '';
  const showImage = channel.image || showInfo.artworkUrl600 || showInfo.artworkUrl100 || '';
  if (!latest.title) throw new Error('最新一集缺少標題');

  return {
    updated: toTaipeiISO(now),
    show: { title: showTitle, url: SHOW_URL },
    latest: {
      title: latest.title,
      date: toTaipeiISO(latest.date),
      url: episodeUrl || latest.link || SHOW_URL,
      image: latest.image || showImage,
      duration: latest.duration,
    },
  };
}

async function main() {
  try {
    const data = await buildPodcastData();
    const written = await writeJsonIfChanged(OUT_PATH, data);
    console.log(written ? `已更新 ${OUT_PATH}` : '內容無變化，不寫檔');
  } catch (err) {
    console.error(`::error title=PODCAST 更新失敗::${err.message}`);
    console.error('既有的 data/podcast.json 未被修改。');
    process.exit(1);
  }
}

if (isMain(import.meta.url)) main();
