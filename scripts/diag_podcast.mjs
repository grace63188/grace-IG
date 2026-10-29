const enc = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '').replace(/\n/g, '%0A');
const note = (t, s) => console.log(`::notice title=${t}::${enc(s)}`);
const H = { 'user-agent': 'grace-ig-auto/1.0 (+GitHub Actions)' };
const tag = (x, t) => { const m = x.match(new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)</${t}>`, 'i')); return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : ''; };
const show = await (await fetch('https://itunes.apple.com/lookup?id=1659198934&entity=podcast&country=tw', { headers: H })).json();
const s = show.results.find((r) => r.feedUrl);
note('show', JSON.stringify({ feedUrl: s.feedUrl, releaseDate: s.releaseDate, trackCount: s.trackCount, name: s.collectionName }));
for (const url of [s.feedUrl, 'https://media.rss.com/graceschool/feed.xml', s.feedUrl + (s.feedUrl.includes('?') ? '&' : '?') + 'cb=' + Date.now()]) {
  try {
    const r = await fetch(url, { headers: H, redirect: 'follow' });
    const x = await r.text();
    const hd = ['age', 'cache-control', 'last-modified', 'etag', 'cf-cache-status', 'x-cache', 'date'].map((k) => `${k}=${r.headers.get(k)}`).join(' | ');
    const head = x.slice(0, Math.max(0, x.search(/<item[\s>]/i)));
    const items = [...x.matchAll(/<item[\s>]([\s\S]*?)<\/item>/gi)].map((m) => m[1]);
    const rows = items.slice(0, 12).map((b, i) => `${i}. ${tag(b, 'title')} | pub=${tag(b, 'pubDate')} | ep=${tag(b, 'itunes:episode')} | type=${tag(b, 'itunes:episodeType')} | season=${tag(b, 'itunes:season')} | guid=${tag(b, 'guid')}`);
    note('feed ' + url.slice(0, 60), `status=${r.status} final=${r.url}\n${hd}\nlastBuildDate=${tag(head, 'lastBuildDate')} pubDate=${tag(head, 'pubDate')} items=${items.length} newFeed=${(head.match(/<itunes:new-feed-url>([^<]*)/) || [])[1] || ''}\n${rows.join('\n')}`);
  } catch (e) { note('feed err', url + ' ' + e.message); }
}
const eps = await (await fetch('https://itunes.apple.com/lookup?id=1659198934&entity=podcastEpisode&country=tw&limit=200', { headers: H })).json();
const list = eps.results.filter((r) => r.wrapperType === 'podcastEpisode').sort((a, b) => b.releaseDate.localeCompare(a.releaseDate)).slice(0, 8);
note('apple episodes', `count=${eps.resultCount}\n` + list.map((r) => `${r.trackName} | ${r.releaseDate} | ep=${r.episodeNumber ?? ''} | guid=${r.episodeGuid} | ${r.trackViewUrl}`).join('\n'));
