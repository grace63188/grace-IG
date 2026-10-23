/* v6 進入點：首頁「現在」凹槽＋六顆入口鍵＋底部卡片
   時效規則沿用 v5 timed.js：
   - 活動過 end → 「現在」移除該則；入口鍵退為霧面「目前無進行中活動」，卡片改導向校長 IG；尚未開始則倒數到 start
   - 直播只取 end 未過者；開播中顯示「直播中」並收起「加入行事曆」；全無 → 入口鍵顯示「追蹤校長 IG」
   - PODCAST 無 latest 或標題為空 → 「現在」不顯示該則，追蹤動態只顯示節目
   v7：撕票後未登入者滑出儀式卡（測驗前登入），登入後直接作答、Web Audio 音效、事件追蹤（見 gate.js／sound.js／track.js）
   v8：進站開場儀式（intro.js／intro.css） */
import { $, $$, now, ts, tpe, pad, fmtDate, fmtHM, safeUrl, reduced, esc, getJSON, fallback, setInert } from './core.js?v=20261023d';
import { initQuiz } from './quiz.js?v=20261023d';
import { initTickets } from './ticket.js?v=20261023d';
import { loadConfig } from './config.js?v=20261023d';
import { initSound, sfx } from './sound.js?v=20261023d';
import { initTracking, track } from './track.js?v=20261023d';
import { resume as resumeAuth, takeGoLogin, pendingLine } from './auth.js?v=20261023d';
import { initGate, errText } from './gate.js?v=20261023d';
import { initIntro } from './intro.js?v=20261023d';

const root = document.documentElement;
const FB = fallback();
const page = $('.page');
const layer = $('#layer');
let campaigns = [], events = [], podcastOk = false;

const md = (t) => { const p = tpe(t); return `${pad(p.mo)}.${pad(p.d)}`; };

/* ---------- 底部卡片 ---------- */
let cur = null, opener = null;
const sheetOf = (name) => $(`#s-${name}`);

/* ritual：撕票後由「開始測驗」卡換成儀式卡——舊卡 160ms ease-in 退下，儀式卡 300ms 滑入（減少動態：淡入淡出） */
function openSheet(name, from, { ritual = false } = {}) {
  const next = sheetOf(name);
  if (!next) return;
  if (cur === next) return;
  if (cur) {
    const old = cur;
    old.style.removeProperty('--drag');
    if (ritual && !layer.hidden) {
      old.classList.add('leaving');
      next.classList.add('enter');
      setTimeout(() => { old.hidden = true; old.classList.remove('leaving'); }, 180);
      setTimeout(() => next.classList.remove('enter'), 700);
    } else old.hidden = true;                                              /* 卡片間切換：直接替換，不重播整段開合 */
  } else opener = from || document.activeElement;
  cur = next;
  next.hidden = false;
  next.querySelector('.sh-body').scrollTop = 0;
  if (layer.hidden) {
    layer.hidden = false;
    root.classList.add('sheet-open');
    setInert(page, true);
    void layer.offsetWidth;
    requestAnimationFrame(() => layer.classList.add('on'));
    if (!ritual) sfx('slide', { delay: 0.04 });
  }
  if (name === 'event') paintCampaign(now());
  setTimeout(() => { const h = next.querySelector('h2'); h.tabIndex = -1; h.focus({ preventScroll: true }); }, 30);
}

function closeSheet(instant, via) {
  if (!cur) return;
  const s = cur; cur = null;
  if (via) track(`${s.id.slice(2)}.close`, 'close', { via });
  layer.classList.remove('on');
  s.style.removeProperty('--drag');
  root.classList.remove('sheet-open');
  setInert(page, false);
  const done = () => { if (!layer.classList.contains('on')) { layer.hidden = true; s.hidden = true; } };
  if (instant || reduced()) done(); else setTimeout(done, 240);
  if (!instant && opener && document.contains(opener)) opener.focus({ preventScroll: true });
}

function initSheets() {
  document.addEventListener('click', (e) => {
    const o = e.target.closest('[data-open]');
    if (o) {
      e.preventDefault();
      if (o.classList.contains('k')) sfx('key');
      openSheet(o.dataset.open, cur ? opener : o); return;
    }
    if (e.target.closest('[data-close]')) closeSheet(false, 'button');
    else if (e.target === $('#scrim')) closeSheet(false, 'scrim');
  });
  layer.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeSheet(false, 'esc'); return; }
    if (e.key !== 'Tab' || !cur) return;
    const f = $$('a[href],button:not([disabled]),summary,[tabindex="0"]', cur).filter((x) => x.offsetParent !== null);
    if (!f.length) return;
    const a = f[0], z = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === a || document.activeElement.tagName === 'H2')) { e.preventDefault(); z.focus(); }
    else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
  });

  /* 往下拖曳關閉（手機）：把手與標題列跟手；內容區捲到頂後繼續往下拉也可關閉 */
  $$('.sheet').forEach((s) => {
    const top = s.querySelector('.sh-top'), body = s.querySelector('.sh-body');
    let y0 = null, dy = 0, t0 = 0, fromBody = false;
    const start = (e, viaBody) => {
      if (matchMedia('(min-width:768px)').matches) return;
      if (e.target.closest('button,a,summary,[role="tab"]') && !viaBody) return;
      y0 = e.clientY; dy = 0; t0 = performance.now(); fromBody = viaBody;
    };
    const move = (e) => {
      if (y0 == null) return;
      const d = e.clientY - y0;
      if (fromBody && (body.scrollTop > 0 || d <= 0)) { if (dy === 0) return; }
      dy = Math.max(0, d);
      if (dy > 3) { s.classList.add('dragging'); s.style.setProperty('--drag', dy + 'px'); }
    };
    const end = () => {
      if (y0 == null) return;
      const v = dy / Math.max(1, performance.now() - t0);        /* px/ms */
      y0 = null; s.classList.remove('dragging');
      if (dy > 110 || (dy > 30 && v > 0.6)) closeSheet(false, 'drag');
      else s.style.setProperty('--drag', '0px');
    };
    top.addEventListener('pointerdown', (e) => { start(e, false); if (y0 != null) top.setPointerCapture(e.pointerId); });
    top.addEventListener('pointermove', move); top.addEventListener('pointerup', end); top.addEventListener('pointercancel', end);
    s.querySelector('.grab').addEventListener('pointerdown', (e) => { start(e, false); });
    body.addEventListener('touchstart', (e) => { if (body.scrollTop <= 0) start(e.touches[0], true); }, { passive: true });
    body.addEventListener('touchmove', (e) => move(e.touches[0]), { passive: true });
    body.addEventListener('touchend', end);
  });
}

/* ---------- 前往上課：分頁 ---------- */
function initTabs() {
  const tabs = $$('#s-study [role="tab"]');
  const sel = (t, focus) => {
    tabs.forEach((x) => { const on = x === t; x.setAttribute('aria-selected', String(on)); x.tabIndex = on ? 0 : -1; $('#' + x.getAttribute('aria-controls')).hidden = !on; });
    if (focus) t.focus();
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => sel(t));
    t.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); sel(tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length], true); }
    });
  });
  try { const t = new URLSearchParams(location.search).get('tab'); if (t === 'sampler') sel(tabs[1]); } catch (e) { /* 忽略 */ }
}

/* ---------- 諮詢項目：可展開清單 ---------- */
function paintConsult(c) {
  if (!c || !Array.isArray(c.groups)) return;
  const unit = c.unit || '30 分鐘';
  let n = 0;
  $('#acc').innerHTML = c.groups.map((g, gi) => {
    n += g.items.length;
    return `<details data-ev-toggle="consult.group.${esc(g.id || gi)}"><summary>${esc(g.key)}<span class="n">${g.items.length} 項</span><svg class="i" aria-hidden="true"><use href="#i-arrow"/></svg></summary><ul>${
      g.items.map((it) => `<li><b>${esc(it.name)}</b><span class="p en"><em>NT$</em>${esc(it.price)}<small>／${esc(it.unit || unit)}</small></span><span class="d">${esc(it.desc)}</span></li>`).join('')
    }</ul></details>`;
  }).join('');
  $('#c-count').textContent = `${n} 項`;
}

/* ---------- 錶盤（沿用 v5） ---------- */
function drawFace() {
  const s = $('#clock-face'), c = 100;
  let h = '';
  for (let i = 0; i < 60; i++) {
    if (i % 15 === 0) continue;
    const a = (i * 6 * Math.PI) / 180, mid = i % 5 === 0, r1 = mid ? 82 : 86, r2 = 90;
    h += `<line x1="${(c + r1 * Math.sin(a)).toFixed(2)}" y1="${(c - r1 * Math.cos(a)).toFixed(2)}" x2="${(c + r2 * Math.sin(a)).toFixed(2)}" y2="${(c - r2 * Math.cos(a)).toFixed(2)}" stroke="${mid ? '#8F8F8B' : '#B5B5B1'}" stroke-width="${mid ? 1.2 : 0.8}" stroke-linecap="round"/>`;
  }
  [[100, 8, 100, 26], [100, 174, 100, 192], [8, 100, 26, 100], [174, 100, 192, 100]].forEach(([a, b, x, y]) => {
    h += `<line x1="${a}" y1="${b}" x2="${x}" y2="${y}" stroke="#6E6E6A" stroke-width="1.4" stroke-linecap="round"/>`;
  });
  s.innerHTML = h;
}
let lastSec = -1;
function tickClock(t) {
  const p = tpe(t), sh = $('#hand-s');
  $('#hand-h').style.setProperty('--a', ((p.h % 12) + p.mi / 60) * 30 + 'deg');
  $('#hand-m').style.setProperty('--a', (p.mi + p.s / 60) * 6 + 'deg');
  if (p.s === 0 && lastSec === 59) { sh.classList.add('no-anim'); sh.style.setProperty('--a', '-6deg'); void sh.offsetWidth; sh.classList.remove('no-anim'); }
  sh.style.setProperty('--a', p.s * 6 + 'deg');
  lastSec = p.s;
}

/* ---------- 活動 ---------- */
function paintCampaign(t) {
  const list = campaigns.filter((c) => Number.isFinite(ts(c.end)) && ts(c.end) > t).sort((a, b) => ts(a.end) - ts(b.end));
  const key = $('#k-event');
  const has = list.length > 0;
  $('#now-event').hidden = !has;
  $('#ev-on').hidden = !has; $('#ev-off').hidden = has;
  key.classList.toggle('k-off', !has);
  if (!has) { $('#k-event-s').textContent = '目前無進行中活動'; return; }
  const c = list[0], start = ts(c.start), end = ts(c.end);
  const before = Number.isFinite(start) && t < start;
  const target = before ? start : end;
  let r = Math.max(0, Math.floor((target - t) / 1000));
  const d = Math.floor(r / 86400); r -= d * 86400;
  const hh = Math.floor(r / 3600); r -= hh * 3600;
  const mm = Math.floor(r / 60), ss = r - mm * 60;
  const title = c.title || '限時活動';
  /* 入口鍵與「現在」：剩 X 天（不足 1 天顯示時:分） */
  const left = d >= 1 ? `剩 <b class="en">${d}</b> 天` : `剩 <b class="en">${pad(hh)}:${pad(mm)}</b>`;
  const html = before ? `<span class="gold">${esc(title)}</span> <b class="en">${d}</b> 天後開始` : `<span class="gold">${esc(title)}</span> ${left}`;
  const ks = $('#k-event-s'); if (ks.innerHTML !== html) ks.innerHTML = html;
  $('#now-event-n').textContent = title;
  const nb = $('#now-event-l');
  const nh = before ? `<b class="en">${d}</b> 天後開始` : left;
  if (nb.innerHTML !== nh) nb.innerHTML = nh;
  if (cur && cur.id === 's-event') {
    tickClock(t);
    $('#ev-name').textContent = title;
    $('#cp-d').textContent = String(d);
    $('#cp-verb').textContent = before ? '天後開始' : '天後截止';
    $('#cp-t').textContent = `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
    if (Number.isFinite(start)) $('#cp-start').textContent = `${fmtDate(start)} ${fmtHM(start)}`;
    $('#cp-end').textContent = `${fmtDate(end)} ${fmtHM(end)}`;
    const u = safeUrl(c.url); if (u) $('#cp-go').href = u;
    if (typeof c.cta === 'string' && c.cta.trim()) $('#cp-go .lbl').textContent = c.cta;
  }
}

/* ---------- 直播 ---------- */
/* 加入行事曆（Google 日曆範本）：標題固定「校長IG直播」、說明固定兩行、地點為校長 IG；時間照 live.json
   畫面上的「IG直播」字樣不受影響 */
export const GCAL_TITLE = '校長IG直播';
export const GCAL_IG = 'https://www.instagram.com/grace.wwwwwwww';
export const GCAL_DETAILS = `不見不散，校長在等你🤍\n${GCAL_IG}`;
export function gcalUrl(e) {
  const f = (t) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const q = ['action=TEMPLATE', `text=${encodeURIComponent(GCAL_TITLE)}`, `dates=${f(ts(e.start))}/${f(ts(e.end))}`,
    `details=${encodeURIComponent(GCAL_DETAILS)}`, `location=${encodeURIComponent(GCAL_IG)}`].join('&');
  return `https://calendar.google.com/calendar/render?${q}`;
}

let liveKey = '';
function paintLive(t) {
  const up = events.filter((e) => Number.isFinite(ts(e.start)) && Number.isFinite(ts(e.end)) && ts(e.end) > t).sort((a, b) => ts(a.start) - ts(b.start));
  const e = up[0], on = !!e && t >= ts(e.start);
  const k = e ? `${e.start}|${e.end}|${e.title}|${on}` : 'none';
  if (k === liveKey) return;
  liveKey = k;
  const now_ = $('.now');
  now_.classList.toggle('is-live', on);
  $('#k-live').classList.toggle('k-live-on', on);
  if (!e) {
    $('#now-live').hidden = true;
    $('#k-live-s').textContent = '追蹤校長 IG';
    $('#lv-box').hidden = true; $('#lv-empty').hidden = false; $('#lv-cal-li').hidden = true;
    $('#lv-flow').style.setProperty('--n', '1');
    return;
  }
  const s = ts(e.start), name = (typeof e.title === 'string' && e.title.trim()) || 'IG直播';
  $('#now-live').hidden = false;
  $('#now-live-t').textContent = on ? '直播中' : `${md(s)} ${fmtHM(s)}`;
  $('#now-live-n').textContent = name;
  $('#k-live-s').innerHTML = on ? '<i class="dot" aria-hidden="true"></i>直播中・前往收看' : `下一場 <b class="en">${md(s)} ${fmtHM(s)}</b>`;
  $('#lv-box').hidden = false; $('#lv-empty').hidden = true;
  $('#lv-box').classList.toggle('on', on);
  $('#lv-state').textContent = on ? '直播中' : '下一場';
  $('#lv-name').textContent = name;
  const w = $('#lv-when'); w.textContent = on ? 'LIVE' : fmtDate(s);
  const sp = document.createElement('span'); sp.textContent = on ? `至 ${fmtHM(ts(e.end))}` : fmtHM(s); w.append(sp);
  const cal = $('#live-cal'); cal.href = gcalUrl(e); cal.setAttribute('aria-label', `加入行事曆：${GCAL_TITLE} ${fmtDate(s)} ${fmtHM(s)}`);
  $('#lv-cal-li').hidden = on;
  $('#lv-flow').style.setProperty('--n', on ? '1' : '2');
  const more = up.slice(1, 3);
  $('#lv-more').hidden = !more.length;
  $('#lv-more').textContent = more.length ? `之後：${more.map((x) => `${fmtDate(ts(x.start))} ${fmtHM(ts(x.start))}`).join('、')}` : '';
}

/* ---------- PODCAST ---------- */
function applyPodcast(p) {
  const L = p && p.latest;
  const title = L && typeof L.title === 'string' ? L.title.trim() : '';
  podcastOk = !!(title && safeUrl(L.url));
  $('#now-pod').hidden = !podcastOk;
  $('#pc-latest').hidden = !podcastOk;
  if (p && p.show && p.show.title) $('#pc-show').textContent = String(p.show.title).split('｜').pop();
  const all = p && p.show && safeUrl(p.show.url); if (all) $('#pc-all').href = all;
  if (!podcastOk) return;
  $('#pc-title').textContent = title;
  $('#now-pod-t').textContent = `新一集・${title.length > 12 ? title.slice(0, 12) + '…' : title}`;
  const d = ts(L.date);
  $('#pc-meta').textContent = [Number.isFinite(d) ? fmtDate(d) : '', L.duration || ''].filter(Boolean).join('・');
  $('#pc-latest').href = safeUrl(L.url);
  const img = safeUrl(L.image); if (img) $('#pc-img').src = img;
}

/* 「現在」全空時：改放一則校長 IG 公告入口，凹槽不留白 */
function paintNone() {
  const any = ['#now-live', '#now-event', '#now-pod'].some((x) => !$(x).hidden);
  $('#now-none').hidden = any;
}

/* ---------- 啟動 ---------- */
let ticking = false;
function initTimed(data) {
  campaigns = Array.isArray(data.campaigns) ? data.campaigns : [];
  events = data.live && Array.isArray(data.live.events) ? data.live.events : [];
  liveKey = '';
  const step = () => { const t = now(); paintCampaign(t); paintLive(t); paintNone(); };
  step();
  if (ticking) return;
  ticking = true;
  drawFace();
  setTimeout(() => { step(); setInterval(step, 1000); }, 1000 - (now() % 1000));
  if (reduced()) $('#hand-s').classList.add('no-anim');
}

async function start() {
  root.classList.add('ready', 'booted');
  const cfgP = loadConfig();
  initSound();
  /* 開場儀式（intro.js）：重播前先收起卡片與測驗 */
  initIntro({ prepare: () => { closeSheet(true); const q = $('#quiz'); if (q && !q.hidden) $('#qz-close').click(); } });
  initSheets();
  initTabs();
  const quiz = initQuiz({ onEnroll: () => openSheet('study', $('[data-open="study"].k')) });
  /* 撕票 →（未登入：儀式卡登入）→ 直接進第一題；測驗關閉時焦點回到「開始測驗」鍵 */
  const gate = initGate({
    openSheet, closeSheet,
    startQuiz: (k) => quiz.open(k, $('[data-open="quiz"].k'), { direct: true }),
  });
  initTickets({ open: (k) => gate.open(k) });
  const go = takeGoLogin();                                             /* ?go=login：讀取後即清掉網址參數 */
  cfgP.then(async () => {
    initTracking();
    let ref = ''; try { ref = document.referrer ? new URL(document.referrer).host : ''; } catch (e) { /* 忽略 */ }
    track('page.enter', 'view', { ref });
    /* 從 LINE 授權頁返回：資料中心換 token 要數秒，先顯示「登入中」的儀式卡（所選種類），成功直接進第一題；失敗回到儀式卡並顯示原因
       從 App 內建瀏覽器換到瀏覽器（?go=login）：不等 visitor.me 續期，立刻到登入卡（已登入者直接進第一題） */
    const pl = pendingLine();
    if (pl) gate.hold(pl.kind);
    else if (go) gate.open(go.kind);
    const r = await resumeAuth();
    if (r && r.kind) {
      if (r.session) { track('auth.success', 'auth', { provider: r.provider, kind: r.kind }); gate.go(r.kind, { fresh: true }); }
      else { track('auth.fail', 'auth', { provider: r.provider || 'line', kind: r.kind, code: r.error }); gate.open(r.kind, { msg: errText(r.error) }); }
    }
  });
  paintConsult(FB.consult);
  initTimed({ campaigns: FB.campaigns, live: FB.live });
  applyPodcast(FB.podcast || null);

  const [content, podcast, live] = await Promise.all([getJSON('data/content.json'), getJSON('data/podcast.json'), getJSON('data/live.json')]);
  if (content && content.consult) paintConsult(content.consult);
  const cps = content && content.events && Array.isArray(content.events.campaigns) ? content.events.campaigns : null;
  const liveOk = live && Array.isArray(live.events);
  if (cps || liveOk) initTimed({ campaigns: cps || FB.campaigns, live: liveOk ? live : FB.live });
  applyPodcast(podcast || FB.podcast || null);
  paintNone();
}

start();
