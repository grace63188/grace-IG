window.HubCrypto=(function(){/* 後台與書籤共用的金鑰推導與加密（WebCrypto；node 18+ 亦可用 globalThis.crypto）
   - pwKey：PBKDF2-SHA256(password, PW_SALT, 200000) → 64 碼 hex，登入時送出（GAS 再以 pepper 做 HMAC 存雜湊）
   - bmKey：PBKDF2-SHA256(password, PW_SALT + '|bm', 200000) → base64（32 bytes），只在設定／改密碼時送 GAS 保存
   - bmEncrypt：HMAC-SHA256 計數器模式串流加密＋HMAC 標籤（encrypt-then-MAC），GAS 端以 Utilities HMAC 解密 */
const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const b64 = (u8) => { let s = ''; u8.forEach((b) => { s += String.fromCharCode(b); }); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');

async function pbkdf2(password, salt, bits) {
  const km = await subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 200000 }, km, bits));
}
async function deriveKeys(password, pwSalt) {
  const [pw, bm] = await Promise.all([pbkdf2(password, pwSalt, 256), pbkdf2(password, pwSalt + '|bm', 256)]);
  return { pwKey: hex(pw), bmKey: b64(bm) };
}
async function hmac(keyBytes, data) {
  const k = await subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await subtle.sign('HMAC', k, data));
}
async function bmEncrypt(bmKeyB64, text) {
  const K = unb64(bmKeyB64);
  const kEnc = await hmac(K, enc.encode('enc')), kMac = await hmac(K, enc.encode('mac'));
  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const pt = enc.encode(text), ct = new Uint8Array(pt.length);
  for (let blk = 0, i = 0; i < pt.length; blk++) {
    const ctr = new Uint8Array(20); ctr.set(nonce); ctr.set([(blk >>> 24) & 255, (blk >>> 16) & 255, (blk >>> 8) & 255, blk & 255], 16);
    const ks = await hmac(kEnc, ctr);
    for (let j = 0; j < ks.length && i < pt.length; j++, i++) ct[i] = pt[i] ^ ks[j];
  }
  const macIn = new Uint8Array(16 + ct.length); macIn.set(nonce); macIn.set(ct, 16);
  return { nonce: b64(nonce), ct: b64(ct), tag: b64(await hmac(kMac, macIn)) };
}

return {deriveKeys,bmEncrypt};})();
/* G.R.A.C.E 全平台總覽｜資料中心純函式（GAS 與 node 共用）
   這個檔案不呼叫任何 GAS 服務；build.mjs 會把它與 main.gs.js 合併成 Code.gs，
   node 測試直接 require 本檔；後台預覽（admin/src/mock.js）也直接呼叫這裡的 libOp* 產生相同形狀的回應。 */

var LIB_EVENT_NAMES = ['enter', 'key', 'now', 'card', 'tear', 'login_start', 'login_done', 'login_fail', 'quiz_q', 'quiz_nav', 'quiz_done', 'quiz_retry', 'out', 'foot', 'sound', 'view'];
var LIB_KEYS = { key: ['quiz', 'study', 'event', 'live', 'follow', 'consult'], now: ['live', 'event', 'pod', 'ig'], tear: ['ability', 'career'], login_start: ['line', 'google'], login_fail: ['line', 'google'], quiz_q: ['ability', 'career'], quiz_nav: ['ability', 'career', ''], quiz_retry: ['ability', 'career'], foot: ['line_academy', 'line_sampler', 'ig', 'yt', 'pod', 'reply_time'], sound: ['on', 'off'] };
var LIB_CODE_KEYS = ['out', 'view'];                                       /* k＝元素代號（小寫英數 . _ -，≤24） */
var LIB_CLICK_N = ['key', 'now', 'foot', 'card', 'tear', 'out'];            /* 算「點擊」與重複點擊的事件；view／quiz_q／quiz_nav 不算 */
var LIB_HEAT_N = ['key', 'now', 'card', 'tear', 'login_start', 'login_fail', 'quiz_q', 'quiz_retry', 'out', 'foot', 'sound'];
var LIB_KEY_LABEL = { quiz: '開始測驗', study: '前往上課', event: '查看活動', live: '收看直播', follow: '追蹤動態', consult: '預約諮詢' };
var LIB_NOW_LABEL = { live: 'IG直播', event: '活動', pod: 'PODCAST', ig: 'IG 公告' };
var LIB_FOOT_LABEL = { line_academy: '學院官方 LINE', line_sampler: 'Sampler 官方 LINE', ig: '校長 IG', yt: 'YouTube', pod: 'PODCAST', reply_time: '學院 LINE（回覆時間）' };
var LIB_KIND_LABEL = { ability: '能力健檢', career: '職涯定位' };
/* 外連元素代號 → [中文名稱, 去向]；去向用於「外連去向」彙整 */
var LIB_OUT = {
  'study.academy.site': ['學院官網', '官網'], 'quiz.backend': ['學員後台', '官網'],
  'study.sampler.site': ['Sampler 網站', 'Sampler'], 'study.sampler.course1': ['Sampler 課程・季度深談日', 'Sampler'], 'study.sampler.course2': ['Sampler 課程・決策底層邏輯', 'Sampler'], 'study.sampler.course3': ['Sampler 課程・從執行者到佈局者', 'Sampler'], 'study.sampler.group': ['Sampler 學員 LINE 群組', 'Sampler'],
  'consult.book': ['預約諮詢', '預約諮詢'],
  'follow.ig_principal': ['校長 IG', '校長 IG'], 'event.ig': ['校長 IG（活動）', '校長 IG'], 'live.ig': ['校長 IG（直播）', '校長 IG'],
  'follow.ig_official': ['官方 IG', '官方 IG'], 'follow.youtube': ['YouTube', 'YouTube'],
  'follow.podcast': ['Podcast 節目', 'Podcast'], 'follow.podcast_latest': ['Podcast 最新一集', 'Podcast'],
  'event.go': ['五週年活動網站', '活動網站'], 'live.calendar': ['加入直播行事曆', '行事曆'],
  'rite.line_add': ['加入學院官方 LINE', '官方 LINE'], 'rite.privacy': ['隱私權政策', '隱私權政策']
};
var LIB_OUT_DESTS = ['官網', 'Sampler', '預約諮詢', '校長 IG', '官方 IG', 'YouTube', 'Podcast', '官方 LINE', '活動網站', '行事曆', '隱私權政策', '其他'];
var LIB_OUT_HOST = [[/^(www\.)?graceschool\.com\.tw\/member/, '官網'], [/^(www\.)?graceschool\.com\.tw/, '官網'], [/gracesampler\.com/, 'Sampler'], [/instagram\.com\/grace\.w/, '校長 IG'], [/instagram\.com\/g\.r\.a\.c\.e_official/, '官方 IG'], [/youtube\.com|youtu\.be/, 'YouTube'], [/podcasts\.apple\.com|spotify\.com|soundon/, 'Podcast'], [/^(line\.me|lin\.ee)/, '官方 LINE'], [/pages\.dev/, '活動網站'], [/calendar\.google\.com/, '行事曆']];
var LIB_CARD_LABEL = { 'quiz.start': '開始作答', 'quiz.save': '存成圖片', 'quiz.enroll': '開始入學', 'quiz.tab.member': '結果頁・我是學員', 'quiz.tab.guest': '結果頁・我還沒入學', 'study.tab.academy': '上課・正式入學', 'study.tab.sampler': '上課・先體驗', 'consult.enroll': '諮詢・先完成正式入學', 'who.menu': '登入者選單', 'who.switch': '切換帳號', 'auth.inapp.open': '改用瀏覽器開啟', 'intro.skip': '略過開場', 'intro.enter': '進入首頁' };
var LIB_SHEET_LABEL = { quiz: '開始測驗', rite: '登入卡', study: '前往上課', event: '查看活動', live: '收看直播', follow: '追蹤動態', consult: '預約諮詢' };
var LIB_VIEW_LABEL = { 'rite.open': '登入卡出現', 'rite.pending': '登入中畫面', 'rite.start': '登入後進入測驗', 'quiz.open': '測驗開啟', 'quiz.close': '測驗關閉' };
var LIB_VIEW_OLD = /^(rite\.(open|pending|start)|quiz\.(open|close)|[a-z]+\.close|sheet\.[a-z]+\.close|consult\.group\..+\.(open|close))$/;
var LIB_STAGES = ['探索起步', '基礎累積', '整合成形', '全面發揮'];
var LIB_ROLES = ['實踐者', '洞察者', '創作者', '引導者', '開創者', '統籌者'];
var LIB_ABILITIES = ['表達溝通', '思考判斷', '規劃佈局', '領導協作', '自我管理', '品牌經營', '工具應用'];
/* 題目計分（與前台 quizdata.js 相同；只有後台顯示作答明細時用） */
var LIB_ABILITY_SCORE = [[2, 0, 3, 1], [1, 0, 2, 3], [3, 1, 0, 2], [2, 1, 3, 0], [2, 0, 1, 3], [2, 0, 1, 3], [1, 2, 0, 3], [0, 3, 1, 2], [2, 1, 0, 3], [3, 0, 2, 1], [1, 2, 0, 3], [2, 0, 3, 1], [2, 3, 0, 1], [1, 2, 0, 3]];
var LIB_ABILITY_OF_Q = ['表達溝通', '規劃佈局', '品牌經營', '自我管理', '思考判斷', '工具應用', '領導協作', '品牌經營', '表達溝通', '自我管理', '規劃佈局', '領導協作', '工具應用', '思考判斷'];
var LIB_CAREER_ROLE = [['開創者', '實踐者'], ['洞察者', '創作者'], ['統籌者', '引導者'], ['洞察者', '開創者'], ['實踐者', '統籌者'], ['創作者', '開創者'], ['引導者', '洞察者'], ['實踐者', '創作者'], ['開創者', '引導者'], ['統籌者', '洞察者'], ['引導者', '實踐者'], ['創作者', '統籌者']];
var LIB_FUNNEL = ['enter', 'key', 'tear', 'login_done', 'quiz_done', 'out'];
var LIB_FUNNEL_LABEL = ['進站', '點入口', '撕票', '登入', '完成測驗', '點外連'];
var LIB_MAX_BATCH = 50;
var LIB_TPE = 8 * 3600e3;
var LIB_REPEAT_WINDOW = 10 * 60e3;
var LIB_REPEAT_N = 5;
var LIB_SESSION_GAP = 30 * 60e3;
var LIB_QUIZ_PAST = 30 * 86400e3, LIB_QUIZ_FUTURE = 10 * 60e3;
var LIB_PAGE_SIZE = 50, LIB_PAGE_MAX = 200;
var LIB_EXPORT_BYTES = 5 * 1024 * 1024, LIB_EXPORT_ROWS = 20000;

function libStr(v, max) { if (v === undefined || v === null) return ''; var s = String(v); return s.length > max ? s.slice(0, max) : s; }
function libIsObj(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
function libPad(n) { return (n < 10 ? '0' : '') + n; }
function libCode(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9_.-]/g, '').slice(0, 24).replace(/\.+$/, ''); }

/* 台北時間拆解 */
function libTpe(t) {
  var d = new Date(t + LIB_TPE);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), wd: d.getUTCDay() };
}
function libDayKey(t) { var p = libTpe(t); return p.y + '.' + libPad(p.mo) + '.' + libPad(p.d); }
function libDayStart(t) { var p = libTpe(t); return Date.UTC(p.y, p.mo - 1, p.d) - LIB_TPE; }
function libFmtHM(t) { var p = libTpe(t); return libPad(p.h) + ':' + libPad(p.mi); }
function libFmtMD(t) { var p = libTpe(t); return libPad(p.mo) + '.' + libPad(p.d); }
function libParseDay(s) { var m = /^(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})$/.exec(String(s || '').trim()); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) - LIB_TPE : NaN; }

/* 範圍：today／7d／30d（台北日界） */
function libRange(range, now) {
  var end = now, s0 = libDayStart(now);
  if (range === '7d') return { start: s0 - 6 * 86400e3, end: end, days: 7, prevStart: s0 - 13 * 86400e3, prevEnd: s0 - 6 * 86400e3 };
  if (range === '30d') return { start: s0 - 29 * 86400e3, end: end, days: 30, prevStart: s0 - 59 * 86400e3, prevEnd: s0 - 29 * 86400e3 };
  return { start: s0, end: end, days: 1, prevStart: s0 - 86400e3, prevEnd: s0 };
}
/* 查詢用範圍：day（單日）＞ from/to ＞ range（today／7d／30d／90d／all）；回 {range, start, end} */
function libTimeArg(x, isEnd) {
  if (x === undefined || x === null || x === '') return NaN;
  if (typeof x === 'number' || /^\d{10,14}$/.test(String(x))) return Number(x);
  var s = libParseDay(x); return isFinite(s) ? (isEnd ? s + 86400e3 - 1 : s) : NaN;
}
function libResolveRange(d, now, dflt) {
  d = d || {};
  if (d.day) { var s = libParseDay(d.day); if (isFinite(s)) return { range: 'day', start: s, end: s + 86400e3 - 1 }; }
  var f = libTimeArg(d.from, false), t = libTimeArg(d.to, true);
  if (isFinite(f) || isFinite(t)) { if (!isFinite(f)) f = 0; if (!isFinite(t)) t = now; if (t < f) { var x = f; f = t; t = x; } return { range: 'custom', start: f, end: t }; }
  var R = ['today', '7d', '30d', '90d', 'all'].indexOf(d.range) >= 0 ? d.range : (dflt || '30d');
  if (R === 'all') return { range: 'all', start: 0, end: now };
  if (R === '90d') return { range: '90d', start: libDayStart(now) - 89 * 86400e3, end: now };
  var r = libRange(R, now); return { range: R, start: r.start, end: r.end };
}
/* 分頁：page 0 起；size 預設 50、上限 200 */
function libPage(arr, d) {
  var size = Math.min(LIB_PAGE_MAX, Math.max(1, Math.floor(Number(d && d.size) || LIB_PAGE_SIZE))), pages = Math.max(1, Math.ceil(arr.length / size));
  var page = Math.min(pages - 1, Math.max(0, Math.floor(Number(d && d.page) || 0)));
  return { page: page, size: size, pages: pages, matched: arr.length, rows: arr.slice(page * size, page * size + size) };
}

/* IP 遮蔽：IPv4 → 1.2.*.*；IPv6 → 前兩段 */
function libMaskIp(ip) {
  var s = libStr(ip, 64).trim();
  if (!s) return '';
  var m4 = s.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (m4) return m4[1] + '.' + m4[2] + '.*.*';
  if (s.indexOf(':') >= 0) { var p = s.split(':'); return p[0] + ':' + (p[1] || '') + ':*'; }
  return '';
}
function libValidIp(ip) { var s = libStr(ip, 64).trim(); return /^(\d{1,3}\.){3}\d{1,3}$/.test(s) || /^[0-9a-f:]{3,39}$/i.test(s) ? s : ''; }

/* 裝置描述正規化 */
function libDev(dev) {
  if (!libIsObj(dev)) return { os: '其他', br: '其他' };
  var OS = ['iOS', 'Android', 'Mac', 'Windows', '其他'], BR = ['IG 內建', 'Safari', 'Chrome', 'Edge', 'LINE 內建', '其他'];
  return { os: OS.indexOf(dev.os) >= 0 ? dev.os : '其他', br: BR.indexOf(dev.br) >= 0 ? dev.br : '其他' };
}

/* 事件批次驗證：回 {ok, events, err}
   - out／view 的 k 是元素代號：只留小寫英數 . _ -、最長 24（不合就清洗，清洗後為空才拒收）
   - quiz_q 的 v 只收「題號」或「題號:選項」（數字），其他一律清空（不收自由文字）；quiz_nav 的 v 只收 next／prev */
function libValidateBatch(data, now) {
  if (!libIsObj(data)) return { ok: false, err: 'data 不是物件' };
  var ev = data.ev;
  if (!Array.isArray(ev) || !ev.length) return { ok: false, err: 'ev 為空' };
  if (ev.length > LIB_MAX_BATCH) return { ok: false, err: '一次最多 ' + LIB_MAX_BATCH + ' 筆' };
  var out = [], seen = {};
  for (var i = 0; i < ev.length; i++) {
    var e = ev[i];
    if (!libIsObj(e)) return { ok: false, err: '第 ' + (i + 1) + ' 筆不是物件' };
    var id = libStr(e.id, 48), n = libStr(e.n, 16), t = Number(e.t);
    if (!/^e_[A-Za-z0-9_-]{4,40}$/.test(id)) return { ok: false, err: 'id 格式' };
    if (LIB_EVENT_NAMES.indexOf(n) < 0) return { ok: false, err: '未知事件 ' + n };
    if (n === 'login_done' || n === 'quiz_done') continue;             /* 只能由資料中心補 */
    if (!isFinite(t) || t < now - 30 * 86400e3 || t > now + 10 * 60e3) return { ok: false, err: '時間不合理' };
    if (seen[id]) continue; seen[id] = 1;
    var k = libStr(e.k, 24), v = libStr(e.v, 80), u = libStr(e.u, 200), ref = libStr(e.ref, 80);
    if (LIB_CODE_KEYS.indexOf(n) >= 0) { k = libCode(e.k); if (!k) return { ok: false, err: n + ' 的 k 不合法' }; }
    else if (LIB_KEYS[n] && LIB_KEYS[n].indexOf(k) < 0) return { ok: false, err: n + ' 的 k 不合法' };
    if (n === 'quiz_q') v = /^\d{1,2}(:\d{1,2})?$/.test(v) ? v : '';
    if (n === 'quiz_nav') v = v === 'next' || v === 'prev' ? v : '';
    if (n === 'view') v = libStr(v, 40);
    if (u) { u = u.replace(/^https?:\/\//, '').split(/[?#]/)[0]; }
    out.push({ id: id, t: Math.round(t), n: n, k: k, v: v, u: u, ref: ref.replace(/^https?:\/\//, '').split('/')[0] });
  }
  return { ok: true, events: out, sid: libStr(data.sid, 40), fp: /^[0-9a-f]{0,16}$/i.test(libStr(data.fp, 16)) ? libStr(data.fp, 16).toLowerCase() : '', dev: libDev(data.dev), ip: libValidIp(data.ip) };
}

/* 舊版前台送來的事件（2026.10.23 前）就地改成新格式：畫面顯示→view、翻頁→quiz_nav、now.ig、頁尾回覆時間、外連代號 */
function libNormEvent(e) {
  var c = String(e.v || '');
  if (e.n === 'card') {
    if (c === 'now.ig') { e.n = 'now'; e.k = 'ig'; e.v = ''; }
    else if (c === 'quiz.prev' || c === 'quiz.next') { e.n = 'quiz_nav'; e.k = ''; e.v = c.slice(5); }
    else if (LIB_VIEW_OLD.test(c)) { e.n = 'view'; e.k = libCode(c); e.v = ''; }
  } else if (e.n === 'foot' && e.k === 'line_academy' && c === 'reply_time') { e.k = 'reply_time'; e.v = ''; }
  else if (e.n === 'out' && ['key', 'now', 'foot', 'card', 'result'].indexOf(e.k) >= 0 && /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/.test(c)) { e.k = c.slice(0, 24); e.v = ''; }
  return e;
}
function libIsClick(e) { return LIB_CLICK_N.indexOf(e.n) >= 0; }
/* 「同一顆按鈕」的鍵：card 以元素代號（v）區分，其他以 n+k */
function libBtnKey(e) { return e.n + ':' + e.k + (e.n === 'card' ? ':' + e.v : ''); }

/* 外連：元素代號 → {label, dest}；舊資料或未登錄代號以網址判斷去向 */
function libOutInfo(e) {
  var o = LIB_OUT[e.k];
  if (o) return { label: o[0], dest: o[1] };
  var u = String(e.u || '').toLowerCase(), dest = '其他';
  for (var i = 0; i < LIB_OUT_HOST.length; i++) if (LIB_OUT_HOST[i][0].test(u)) { dest = LIB_OUT_HOST[i][1]; break; }
  return { label: e.v || (u ? u.split('/')[0] : '外連'), dest: dest };
}
function libViewLabel(k, v) {
  if (LIB_VIEW_LABEL[k]) return LIB_VIEW_LABEL[k];
  var m = /^(?:sheet\.)?([a-z]+)\.close$/.exec(k); if (m) return (LIB_SHEET_LABEL[m[1]] || m[1]) + ' 面板關閉';
  if (/^consult\.group/.test(k)) return '諮詢項目' + (v === 'close' || /\.close$/.test(k) ? '收合' : '展開');
  return k;
}
/* 事件中文：{ev 事件名稱, target 按鈕／對象, dest 外連去向} */
function libEventLabel(e) {
  var K = LIB_KIND_LABEL[e.k] || '', P = e.k === 'google' ? 'Google' : 'LINE';
  switch (e.n) {
    case 'enter': return { ev: '進站', target: e.ref || '直接開啟', dest: '' };
    case 'view': return { ev: '畫面', target: libViewLabel(e.k, e.v), dest: '' };
    case 'key': return { ev: '入口鍵', target: LIB_KEY_LABEL[e.k] || e.k, dest: '' };
    case 'now': return { ev: '現在列', target: (LIB_NOW_LABEL[e.k] || e.k) + (e.v ? ' ' + e.v : ''), dest: '' };
    case 'card': return { ev: '按鈕', target: LIB_CARD_LABEL[e.v] || e.v || e.k, dest: '' };
    case 'tear': return { ev: '撕票', target: K || e.k, dest: '' };
    case 'login_start': return { ev: '開始登入', target: P, dest: '' };
    case 'login_done': return { ev: '登入完成', target: P + (e.v === 'auto' ? '（自動）' : ''), dest: '' };
    case 'login_fail': return { ev: '登入失敗', target: P + (e.v ? '・' + (e.v === 'webview' ? 'App 內建瀏覽器' : e.v) : ''), dest: '' };
    case 'quiz_q': { var p = String(e.v || '').split(':'); return { ev: '作答', target: (K || '測驗') + (p[0] ? ' 第 ' + p[0] + ' 題' : '') + (p[1] !== undefined && p[1] !== '' ? '・選項 ' + (Number(p[1]) + 1) : ''), dest: '' }; }
    case 'quiz_nav': return { ev: '測驗翻頁', target: (K ? K + '・' : '') + (e.v === 'prev' ? '上一題' : '下一題'), dest: '' };
    case 'quiz_done': return { ev: '完成測驗', target: (K || '測驗') + (e.v ? '・' + e.v : ''), dest: '' };
    case 'quiz_retry': return { ev: '重做測驗', target: K || e.k, dest: '' };
    case 'out': { var o = libOutInfo(e); return { ev: '外連', target: o.label, dest: o.dest }; }
    case 'foot': return { ev: '頁尾', target: LIB_FOOT_LABEL[e.k] || e.k, dest: '' };
    case 'sound': return { ev: '音效', target: e.k === 'on' ? '開' : '關', dest: '' };
  }
  return { ev: e.n, target: e.k, dest: '' };
}

/* 測驗結果驗證（at 必須在 現在−30 天 ～ 現在＋10 分鐘；scores／counts 只留已知鍵的數字） */
function libValidateQuiz(d, now) {
  if (!libIsObj(d)) return { ok: false, err: 'data 不是物件' };
  var kind = d.kind, at = Number(d.at), ans = d.answers;
  if (kind !== 'ability' && kind !== 'career') return { ok: false, err: 'kind' };
  if (!isFinite(at)) return { ok: false, err: 'at' };
  if (now !== undefined && (at < now - LIB_QUIZ_PAST || at > now + LIB_QUIZ_FUTURE)) return { ok: false, err: 'at 超出範圍' };
  var len = kind === 'ability' ? 14 : 12, maxOpt = kind === 'ability' ? 3 : 1;
  if (!Array.isArray(ans) || ans.length !== len) return { ok: false, err: 'answers 長度須為 ' + len };
  for (var i = 0; i < len; i++) { var a = ans[i]; if (typeof a !== 'number' || a !== Math.floor(a) || a < 0 || a > maxOpt) return { ok: false, err: '第 ' + (i + 1) + ' 題作答無效' }; }
  var pick = function (o, keys) { var r = {}; if (libIsObj(o)) keys.forEach(function (k) { var x = Number(o[k]); if (isFinite(x)) r[k] = Math.round(x); }); return r; };
  var sum = {};
  if (kind === 'ability') {
    if (LIB_STAGES.indexOf(d.stage) < 0) return { ok: false, err: 'stage' };
    sum = { stage: d.stage, top: LIB_ABILITIES.indexOf(d.top) >= 0 ? d.top : '', low: LIB_ABILITIES.indexOf(d.low) >= 0 ? d.low : '', total: Math.round(Number(d.total)) || 0, scores: pick(d.scores, LIB_ABILITIES) };
  } else {
    if (LIB_ROLES.indexOf(d.primary) < 0) return { ok: false, err: 'primary' };
    sum = { primary: d.primary, secondary: LIB_ROLES.indexOf(d.secondary) >= 0 ? d.secondary : '', counts: pick(d.counts, LIB_ROLES) };
  }
  return { ok: true, kind: kind, at: Math.round(at), answers: ans.slice(), summary: sum, label: kind === 'ability' ? sum.stage : sum.primary };
}
/* 作答明細：[{q 題號(1 起), opt 選項(0 起), score｜role, ability}] */
function libAnswerDetail(kind, answers) {
  if (!Array.isArray(answers)) return [];
  return answers.map(function (a, i) {
    var o = { q: i + 1, opt: typeof a === 'number' ? a : null };
    if (kind === 'ability') { o.score = LIB_ABILITY_SCORE[i] && o.opt !== null ? LIB_ABILITY_SCORE[i][o.opt] : null; o.ability = LIB_ABILITY_OF_Q[i] || ''; }
    else { o.role = LIB_CAREER_ROLE[i] && o.opt !== null ? LIB_CAREER_ROLE[i][o.opt] || '' : ''; }
    return o;
  });
}

/* 訪客 token：hmac(str) → base64url 字串，由呼叫端提供 */
function libB64u(s) { return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function libSignToken(payload, hmacB64) {
  var body = libB64u(hmacB64.b64(JSON.stringify(payload)));
  return 'v1.' + body + '.' + libB64u(hmacB64.hmac(body));
}
function libVerifyToken(tok, hmacB64, now) {
  if (typeof tok !== 'string') return null;
  var p = tok.split('.');
  if (p.length !== 3 || p[0] !== 'v1') return null;
  if (libB64u(hmacB64.hmac(p[1])) !== p[2]) return null;
  var pl; try { pl = JSON.parse(hmacB64.unb64(p[1])); } catch (e) { return null; }
  if (!libIsObj(pl) || !pl.pid || !pl.exp || pl.exp < now) return null;
  return pl;
}

/* 到訪切分（舊）：同 did 的事件依 30 分鐘間隔分成 visits */
function libVisits(events) { return libVisitsBySid(events.map(function (e) { return Object.assign({}, e, { sid: '' }); })); }
/* 到訪切分：同 did＋同 sid 為一次到訪；沒有 sid 的事件（舊資料、資料中心補的 login_done／quiz_done）
   併入同裝置 30 分鐘內最近一次到訪，否則自成一次 */
function libVisitsBySid(events) {
  var out = [], bySid = {}, lastByDid = {};
  events.slice().sort(function (a, b) { return a.t - b.t; }).forEach(function (e) {
    var v = null, last = lastByDid[e.did];
    if (e.sid) { v = bySid[e.did + '|' + e.sid] || null; if (v && e.t - v.end > 12 * 3600e3) v = null; }
    else if (last && e.t - last.end <= LIB_SESSION_GAP) v = last;
    if (!v) {
      v = { sid: e.sid || '', did: e.did, pid: e.pid || '', start: e.t, end: e.t, events: [], os: e.os, br: e.br, ipMask: e.ipMask || '' };
      out.push(v); if (e.sid) bySid[e.did + '|' + e.sid] = v;
    }
    v.end = Math.max(v.end, e.t); v.events.push(e); if (e.pid) v.pid = e.pid; if (!v.ipMask && e.ipMask) v.ipMask = e.ipMask;
    lastByDid[e.did] = v;
  });
  return out.sort(function (a, b) { return b.start - a.start; });
}

/* 人的辨識鍵：有 pid 用 pid；沒有 pid 的事件若同一裝置曾登入（事件或 devices 分頁），歸到那個 pid；否則 d:did
   devPid 省略且事件都已有 who 時沿用（libCtx 已算好，不覆蓋） */
function libWho(e) { return e.who || e.pid || ('d:' + e.did); }
function libAttachWho(events, devPid) {
  if (!devPid && events.length && events.every(function (e) { return e.who; })) return events;
  var didPid = {};
  if (devPid) Object.keys(devPid).forEach(function (d) { didPid[d] = devPid[d]; });
  events.forEach(function (e) { if (e.pid) didPid[e.did] = e.pid; });
  events.forEach(function (e) { e.who = e.pid || didPid[e.did] || ('d:' + e.did); });
  return events;
}

/* 每人漏斗進度：回 {who: 最遠連續完成的步驟索引（-1＝沒進站）} */
function libFunnelSteps(events) {
  libAttachWho(events);
  var done = {};
  events.forEach(function (e) { var i = LIB_FUNNEL.indexOf(e.n); if (i >= 0) { var w = libWho(e); (done[w] || (done[w] = {}))[i] = 1; } });
  var step = {};
  Object.keys(done).forEach(function (w) { var s = -1; while (done[w][s + 1]) s++; step[w] = s; });
  return step;
}
/* 漏斗（獨立訪客、逐步縮小：每一步只算有做完前一步的人） */
function libFunnel(events) {
  var steps = libFunnelSteps(events), counts = LIB_FUNNEL.map(function () { return 0; });
  Object.keys(steps).forEach(function (w) { for (var i = 0; i <= steps[w]; i++) counts[i]++; });
  return LIB_FUNNEL.map(function (n, i) { return { n: n, label: LIB_FUNNEL_LABEL[i], v: counts[i], rate: i ? (counts[i - 1] ? Math.round(counts[i] / counts[i - 1] * 100) : 0) : 100 }; });
}
function libFunnelIndex(x) { if (x === undefined || x === null || x === '') return -1; var i = LIB_FUNNEL.indexOf(String(x)); if (i >= 0) return i; i = Number(x); return isFinite(i) && i >= 0 && i < LIB_FUNNEL.length ? Math.floor(i) : -1; }

/* 點擊排行（入口鍵、現在列、頁尾；外連去向另列一組） */
function libClickRank(events, q) {
  var g = { key: {}, now: {}, foot: {}, out: {} }, tot = 0, outTot = 0;
  events.forEach(function (e) {
    if (e.n === 'key') { g.key[e.k] = (g.key[e.k] || 0) + 1; tot++; }
    else if (e.n === 'now') { var l = (LIB_NOW_LABEL[e.k] || e.k) + (e.v ? ' ' + e.v : ''); var o = g.now[l] || (g.now[l] = { v: 0, k: e.k, val: e.v }); o.v++; tot++; }
    else if (e.n === 'foot') { g.foot[e.k] = (g.foot[e.k] || 0) + 1; tot++; }
    else if (e.n === 'out') { var oi = libOutInfo(e), ok = LIB_OUT[e.k] ? e.k : e.k + '|' + oi.label; var oo = g.out[ok] || (g.out[ok] = { v: 0, k: e.k, label: oi.label, dest: oi.dest, val: LIB_OUT[e.k] ? '' : e.v }); oo.v++; outTot++; }
  });
  var Q = function (o) { return q ? Object.assign({ op: 'admin.events' }, q, o) : undefined; };
  var byV = function (a, b) { return b.v - a.v; };
  var simple = function (obj, lab, n) { return Object.keys(obj).map(function (k) { return { k: k, label: lab[k] || k, v: obj[k], q: Q({ n: n, k: k }) }; }).sort(byV); };
  var nowRows = Object.keys(g.now).map(function (l) { var o = g.now[l], qq = { n: 'now', k: o.k }; if (o.val) qq.v = o.val; return { k: l, label: l, v: o.v, q: Q(qq) }; }).sort(byV);
  var outRows = Object.keys(g.out).map(function (x) { var o = g.out[x], qq = { n: 'out', k: o.k }; if (o.val) qq.v = o.val; return { k: o.k, label: o.label, dest: o.dest, v: o.v, q: Q(qq) }; }).sort(byV);
  var dests = {}; outRows.forEach(function (r) { dests[r.dest] = (dests[r.dest] || 0) + r.v; });
  return {
    total: tot, outTotal: outTot,
    groups: [{ name: '入口鍵', rows: simple(g.key, LIB_KEY_LABEL, 'key') }, { name: '現在列', rows: nowRows }, { name: '頁尾', rows: simple(g.foot, LIB_FOOT_LABEL, 'foot') }, { name: '外連去向', rows: outRows }],
    dests: LIB_OUT_DESTS.filter(function (d) { return dests[d]; }).map(function (d) { return { dest: d, v: dests[d] }; }).sort(byV)
  };
}

/* 分時熱度：days×24（只算互動：不含進站、畫面顯示、翻頁與資料中心補的事件） */
function libHeat(events, r, q) {
  var days = [], idx = {};
  for (var i = 0; i < r.days; i++) { var t = r.start + i * 86400e3; idx[libDayKey(t)] = i; days.push({ key: libFmtMD(t), full: libDayKey(t), wd: '日一二三四五六'[libTpe(t).wd] }); }
  var grid = days.map(function () { var a = []; for (var h = 0; h < 24; h++) a.push(0); return a; });
  var hours = []; for (var h = 0; h < 24; h++) hours.push(0);
  var peak = { v: 0, d: 0, h: 0 };
  events.forEach(function (e) {
    if (LIB_HEAT_N.indexOf(e.n) < 0) return;
    var p = libTpe(e.t), di = idx[libDayKey(e.t)]; if (di === undefined) return;
    grid[di][p.h]++; hours[p.h]++;
    if (grid[di][p.h] > peak.v) peak = { v: grid[di][p.h], d: di, h: p.h };
  });
  var tot = hours.reduce(function (a, b) { return a + b; }, 0) || 1;
  var band = function (a, b) { var s = 0; for (var h = a; h <= b; h++) s += hours[h]; return Math.round(s / tot * 100); };
  var o = { days: days, grid: grid, peak: peak.v ? { day: days[peak.d].key, wd: days[peak.d].wd, hour: peak.h, v: peak.v } : null, bands: [{ l: '晚間 20–23 時', v: band(20, 23) }, { l: '午間 12–13 時', v: band(12, 13) }, { l: '凌晨 0–6 時', v: band(0, 6) }] };
  if (q) {
    var N = LIB_HEAT_N.join(',');
    days.forEach(function (dy) { dy.q = { op: 'admin.events', day: dy.full, n: N }; });
    o.cells = []; grid.forEach(function (row, di) { row.forEach(function (v, h) { if (v) o.cells.push({ d: di, h: h, v: v, q: { op: 'admin.events', day: days[di].full, hour: h, n: N } }); }); });
    if (o.peak) o.peak.q = { op: 'admin.events', day: days[peak.d].full, hour: peak.h, n: N };
  }
  return o;
}

/* 趨勢：每日完成份數 */
function libTrend(results, r) {
  var days = [], idx = {}, full = [];
  for (var i = 0; i < r.days; i++) { var t = r.start + i * 86400e3; idx[libDayKey(t)] = i; days.push(libFmtMD(t)); full.push(libDayKey(t)); }
  var ab = days.map(function () { return 0; }), cr = days.map(function () { return 0; });
  results.forEach(function (q) { var di = idx[libDayKey(q.at)]; if (di === undefined) return; (q.kind === 'ability' ? ab : cr)[di]++; });
  return { days: days, ability: ab, career: cr, points: full.map(function (f, i) { return { day: f, ability: ab[i], career: cr[i], q: { op: 'admin.results', day: f }, qAbility: { op: 'admin.results', day: f, kind: 'ability' }, qCareer: { op: 'admin.results', day: f, kind: 'career' } }; }) };
}

/* 結果分布 */
function libDist(results, q) {
  var st = {}, ro = {};
  LIB_STAGES.forEach(function (s) { st[s] = 0; }); LIB_ROLES.forEach(function (s) { ro[s] = 0; });
  results.forEach(function (x) { if (x.kind === 'ability' && st[x.label] !== undefined) st[x.label]++; if (x.kind === 'career' && ro[x.label] !== undefined) ro[x.label]++; });
  var Q = function (kind, label) { return q ? Object.assign({ op: 'admin.results' }, q, { kind: kind, label: label }) : undefined; };
  return { stages: LIB_STAGES.map(function (s) { return { label: s, v: st[s], q: Q('ability', s) }; }), roles: LIB_ROLES.map(function (s) { return { label: s, v: ro[s], q: Q('career', s) }; }).sort(function (a, b) { return b.v - a.v; }) };
}

/* 重複點擊偵測：同一人、同一顆按鈕、10 分鐘內 ≥5 次（只看點擊事件） */
function libRepeatFlags(events) {
  libAttachWho(events);
  var by = {};
  events.forEach(function (e) { if (!libIsClick(e)) return; var k = libWho(e) + '|' + libBtnKey(e); (by[k] || (by[k] = [])).push(e.t); });
  var flags = {};
  Object.keys(by).forEach(function (k) {
    var ts = by[k].sort(function (a, b) { return a - b; }), best = 0;
    for (var i = 0, j = 0; i < ts.length; i++) { while (ts[i] - ts[j] > LIB_REPEAT_WINDOW) j++; best = Math.max(best, i - j + 1); }
    if (best >= LIB_REPEAT_N) { var p = k.split('|'), b = p[1].split(':'); flags[p[0]] = flags[p[0]] || []; flags[p[0]].push({ n: b[0], k: b[1], v: b[2] || '', max: best, label: libBtnLabel(b[0], b[1], b[2]) }); }
  });
  return flags;
}

/* 總覽彙整（每個 KPI／漏斗步驟／趨勢點／排行列／熱度格都附 q＝後台可直接帶去查詢的參數） */
function libOverview(all, results, range, now, persons) {
  libAttachWho(all);
  var r = libRange(range, now), RQ = { range: range };
  var inR = all.filter(function (e) { return e.t >= r.start && e.t <= r.end; });
  var prev = all.filter(function (e) { return e.t >= r.prevStart && e.t < r.prevEnd; });
  var qr = results.filter(function (q) { return q.at >= r.start && q.at <= r.end; });
  var uniq = function (evs, n) { var s = {}; evs.forEach(function (e) { if (!n || e.n === n) s[libWho(e)] = 1; }); return Object.keys(s).length; };
  var cnt = function (evs, n) { var c = 0; evs.forEach(function (e) { if (e.n === n) c++; }); return c; };
  var visits = cnt(inR, 'enter'), pvisits = cnt(prev, 'enter');
  var uv = uniq(inR), puv = uniq(prev);
  var logins = {}, auto = 0; inR.forEach(function (e) { if (e.n === 'login_done') { logins[e.pid] = 1; if (e.v === 'auto') auto++; } });
  var ab = qr.filter(function (q) { return q.kind === 'ability'; }).length, cr = qr.length - ab;
  var fun = libFunnel(inR);
  fun.forEach(function (f, i) { f.q = { op: 'admin.people', range: range, funnelStep: f.n }; if (i) f.qDrop = { op: 'admin.people', range: range, funnelDrop: f.n }; });
  /* 今日重點：撕票→登入流失與 IG 內建 Google 失敗 */
  var tearSet = {}, loginSet = {}; inR.forEach(function (e) { if (e.n === 'tear') tearSet[libWho(e)] = 1; if (e.n === 'login_done') loginSet[libWho(e)] = 1; });
  var lost = Object.keys(tearSet).filter(function (w) { return !loginSet[w]; }), lostIg = 0;
  var devOf = {}; inR.forEach(function (e) { devOf[libWho(e)] = e.br; });
  lost.forEach(function (w) { if (devOf[w] === 'IG 內建') lostIg++; });
  var finding = null;
  if (Object.keys(tearSet).length && lost.length) finding = { lost: lost.length, pct: Math.round(lost.length / Object.keys(tearSet).length * 100), ig: lostIg, text: '撕票到登入流失 ' + lost.length + ' 人（' + Math.round(lost.length / Object.keys(tearSet).length * 100) + '%）' + (lostIg ? '，其中 ' + lostIg + ' 人用 IG 內建瀏覽器。' : '。'), q: { op: 'admin.people', range: range, funnelDrop: 'login_done' } };
  else if (!inR.length) finding = { lost: 0, pct: 0, ig: 0, text: '這段期間還沒有資料。' };
  else finding = { lost: 0, pct: 0, ig: 0, text: '撕票的人都完成了登入。' };
  var delta = function (a, b) { return a - b; };
  return {
    range: range, start: r.start, end: r.end, finding: finding,
    kpi: [
      { l: '進站人次', v: visits, d: delta(visits, pvisits), q: { op: 'admin.events', range: range, n: 'enter' } },
      { l: '獨立訪客', v: uv, u: '人', d: delta(uv, puv), q: { op: 'admin.people', range: range } },
      { l: '登入人數', v: Object.keys(logins).length, u: '人', note: '其中自動登入 ' + auto, q: { op: 'admin.events', range: range, n: 'login_done' } },
      { l: '測驗完成', v: qr.length, u: '份', note: '能力健檢 ' + ab + '・職涯定位 ' + cr, done: true, q: { op: 'admin.results', range: range } }
    ],
    funnel: fun, trend: libTrend(results, range === 'today' ? libRange('7d', now) : r), dist: libDist(qr, RQ), clicks: libClickRank(inR, RQ), heat: libHeat(inR, r, true)
  };
}

/* 名單：以人為單位彙整（results 以 who 對應；沒有 who 的舊資料退回 pid） */
function libPeople(all, results, persons, students, flags) {
  libAttachWho(all);
  var byWho = {};
  all.forEach(function (e) {
    var w = libWho(e), p = byWho[w] || (byWho[w] = { who: w, pid: e.pid || '', dids: {}, ips: {}, clicks: 0, first: e.t, last: e.t, visits: 0 });
    if (e.pid && !p.pid) p.pid = e.pid;
    p.dids[e.did] = 1; if (e.ipMask) p.ips[e.ipMask] = 1;
    if (libIsClick(e)) p.clicks++;
    if (e.n === 'enter') p.visits++;
    if (e.t < p.first) p.first = e.t; if (e.t > p.last) p.last = e.t;
  });
  var resBy = {}, nBy = {}; results.forEach(function (q) { var w = q.who || q.pid; var o = resBy[w] || (resBy[w] = {}); nBy[w] = (nBy[w] || 0) + 1; if (!o[q.kind] || o[q.kind].at < q.at) o[q.kind] = q; });
  var stuBy = libStudentIndex(students);
  return Object.keys(byWho).map(function (w) {
    var p = byWho[w], pid = p.pid || (w.indexOf('d:') === 0 ? '' : w), per = pid ? (persons[pid] || null) : null, res = resBy[w] || {};
    var stu = per ? libMatchStudent(per, stuBy) : null;
    return {
      who: w, pid: pid, name: per ? per.name : '未登入訪客', pic: per ? per.pic : '', src: per ? per.src : '', email: per ? per.email : '', ig: per ? per.ig : '', loggedIn: !!pid,
      student: stu ? { account: stu.account, name: stu.name, ig: stu.ig, lineId: stu.lineId, level: stu.level, status: stu.status, regDate: stu.regDate, by: stu.by } : null,
      ability: res.ability ? res.ability.label : '', career: res.career ? res.career.label : '', attempts: nBy[w] || 0,
      clicks: p.clicks, visits: p.visits, first: p.first, last: p.last, devices: Object.keys(p.dids).length, ips: Object.keys(p.ips).length,
      flag: flags && flags[w] ? flags[w] : null
    };
  }).sort(function (a, b) { return b.last - a.last; });
}

/* 學員對應：先 email，再 IG */
function libStudentIndex(students) {
  var byEmail = {}, byIg = {};
  (students || []).forEach(function (s) { if (s.email) byEmail[String(s.email).toLowerCase()] = s; if (s.ig) byIg[libNormIg(s.ig)] = s; });
  return { byEmail: byEmail, byIg: byIg };
}
function libNormIg(ig) { return String(ig || '').trim().toLowerCase().replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/\/.*$/, ''); }
function libMatchStudent(person, idx) {
  if (!person) return null;
  if (person.email && idx.byEmail[String(person.email).toLowerCase()]) { var s = idx.byEmail[String(person.email).toLowerCase()]; return Object.assign({ by: 'email' }, s); }
  if (person.ig && idx.byIg[libNormIg(person.ig)]) { var s2 = idx.byIg[libNormIg(person.ig)]; return Object.assign({ by: 'ig' }, s2); }
  return null;
}

/* 名單篩選與搜尋：filter＝all｜loggedin｜anon｜student｜nonstudent（guest＝nonstudent，舊名） */
function libFilterPeople(people, f) {
  f = f || {};
  var q = libNormIg(f.q || '');
  return people.filter(function (p) {
    if (f.filter === 'student' && !p.student) return false;
    if ((f.filter === 'guest' || f.filter === 'nonstudent') && p.student) return false;
    if (f.filter === 'loggedin' && !p.pid) return false;
    if (f.filter === 'anon' && p.pid) return false;
    if (f.level && (!p.student || p.student.level !== f.level)) return false;
    if (f.status && (!p.student || p.student.status !== f.status)) return false;
    if (q) { var hay = [p.name, p.email, p.ig, p.student && p.student.account, p.student && p.student.name, p.student && p.student.ig, p.student && p.student.lineId].join(' ').toLowerCase(); if (hay.indexOf(q) < 0) return false; }
    return true;
  });
}

/* 重複點擊三角度（ig＝以人、device＝以裝置、ip＝以 IP）；每列附 list（涉及的人，可點）與 q（查詢參數） */
function libRepeat(events, people, by, range) {
  libAttachWho(events);
  var byName = {}; people.forEach(function (p) { byName[p.who] = p; });
  var groups = {};
  events.forEach(function (e) {
    if (!libIsClick(e)) return;
    var k, sub;
    if (by === 'ip') { if (!e.ipHash) return; k = e.ipHash; sub = e.ipMask; }
    else if (by === 'device') { k = e.did; sub = e.os + '・' + e.br; }
    else { var p = byName[libWho(e)]; k = libWho(e); sub = p ? (p.ig || p.name) : '未登入訪客'; }
    var g = groups[k] || (groups[k] = { key: k, label: sub, tot: 0, btn: {}, who: {}, dids: {}, first: e.t, last: e.t });
    g.tot++; var b = libBtnKey(e); g.btn[b] = (g.btn[b] || 0) + 1; g.who[libWho(e)] = (g.who[libWho(e)] || 0) + 1; g.dids[e.did] = 1;
    if (e.t < g.first) g.first = e.t; if (e.t > g.last) g.last = e.t;
  });
  var flags = libRepeatFlags(events);
  return Object.keys(groups).map(function (k) {
    var g = groups[k], whos = Object.keys(g.who).sort(function (a, b) { return g.who[b] - g.who[a]; }), names = whos.map(function (w) { var p = byName[w]; return p ? p.name : '未登入訪客'; });
    var top = Object.keys(g.btn).sort(function (a, b) { return g.btn[b] - g.btn[a]; })[0];
    var flagged = whos.some(function (w) { return flags[w]; });
    var why = flagged ? (function () { var f = flags[whos.filter(function (w) { return flags[w]; })[0]][0]; return { text: '「' + f.label + '」' + f.max + ' 次・10 分鐘內', bad: true }; })() : { text: whos.length > 1 ? names.slice(0, 2).join('、') + (names.length > 2 ? ' 等' : '') : '正常', bad: false };
    var label = by === 'ig' ? (g.label || names[0]) : g.label;
    var sub = by === 'ip' ? whos.length + ' 人・' + Object.keys(g.dids).length + ' 裝置' : by === 'device' ? names[0] : (names[0] !== g.label ? names[0] : '');
    var tp = top.split(':'), q = { op: 'admin.events', n: 'click' };
    if (range) q.range = range;
    if (by === 'ip') q.ipHash = k; else if (by === 'device') q.did = k; else q.who = k;
    return {
      key: k, label: label, sub: sub, tot: g.tot, top: libBtnLabel(tp[0], tp[1], tp[2]), topN: g.btn[top], why: why, people: whos.length, devices: Object.keys(g.dids).length, last: g.last, flagged: flagged,
      list: whos.slice(0, 20).map(function (w) { var p = byName[w]; return { who: w, name: p ? p.name : '未登入訪客', ig: p ? p.ig : '', src: p ? p.src : '', student: p && p.student ? { account: p.student.account, level: p.student.level, status: p.student.status } : null, clicks: g.who[w], flagged: !!flags[w], q: { op: 'admin.person', who: w } }; }),
      q: q
    };
  }).sort(function (a, b) { return (b.flagged - a.flagged) || (b.tot - a.tot); });
}
function libBtnLabel(n, k, v) {
  if (n === 'key') return LIB_KEY_LABEL[k] || k;
  if (n === 'now') return LIB_NOW_LABEL[k] || k;
  if (n === 'foot') return LIB_FOOT_LABEL[k] || k;
  if (n === 'tear') return k === 'ability' ? '撕票・能力健檢' : '撕票・職涯定位';
  if (n === 'out') return libOutInfo({ n: n, k: k, v: '', u: '' }).label;
  if (n === 'card') return LIB_CARD_LABEL[v] || v || k;
  return n + (k ? '・' + k : '');
}

/* 個人頁時間軸（輸出 HTML 片段：所有來自前台的字串都先跳脫） */
function libEsc(s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function libEventText(e0) {
  var e = { n: e0.n, k: libEsc(e0.k), v: libEsc(e0.v), ref: libEsc(e0.ref) };
  switch (e.n) {
    case 'enter': return { d: 'out', x: '進站' + (e.ref ? '<em>' + e.ref + '</em>' : '') };
    case 'view': return { d: 'view', x: '畫面・' + libEsc(libViewLabel(e0.k, e0.v)) };
    case 'key': return { d: 'btn', x: '點「' + (LIB_KEY_LABEL[e.k] || e.k) + '」' };
    case 'now': return { d: 'btn', x: '點現在列「' + (LIB_NOW_LABEL[e.k] || e.k) + (e.v ? ' ' + e.v : '') + '」' };
    case 'card': return { d: 'btn', x: '點「' + libEsc(LIB_CARD_LABEL[e0.v] || e0.v) + '」' };
    case 'tear': return { d: 'btn', x: '撕票・' + (e.k === 'ability' ? '能力健檢' : '職涯定位') };
    case 'login_start': return { d: 'btn', x: (e.k === 'line' ? 'LINE' : 'Google') + ' 登入' };
    case 'login_done': return { d: 'ok', x: (e.k === 'line' ? 'LINE' : 'Google') + ' 登入完成' + (e.v === 'auto' ? '<em>自動</em>' : '') };
    case 'login_fail': return { d: 'btn', x: (e.k === 'line' ? 'LINE' : 'Google') + ' 登入失敗<em>' + (e.v === 'webview' ? 'IG 內建瀏覽器' : e.v) + '</em>' };
    case 'quiz_q': return { d: 'btn', x: libEsc(libEventLabel(e0).target) };
    case 'quiz_nav': return { d: 'view', x: libEsc(libEventLabel(e0).target) };
    case 'quiz_done': return { d: 'ok', x: '完成' + (e.k === 'ability' ? '能力健檢' : '職涯定位') + '・<b>' + e.v + '</b>' };
    case 'quiz_retry': return { d: 'btn', x: '重做' + (e.k === 'ability' ? '能力健檢' : '職涯定位') };
    case 'out': { var o = libOutInfo(e0); return { d: 'btn', x: '點「' + libEsc(o.label) + '」<em>外連・' + libEsc(o.dest) + '</em>' }; }
    case 'foot': return { d: 'btn', x: '點頁尾「' + (LIB_FOOT_LABEL[e.k] || e.k) + '」' };
    case 'sound': return { d: 'btn', x: '音效' + (e.k === 'on' ? '開' : '關') };
  }
  return { d: 'btn', x: libEsc(e.n) };
}
function libPersonTimeline(events) {
  var visits = libVisitsBySid(events), days = {}, order = [];
  visits.forEach(function (v) {
    var dk = libDayKey(v.start);
    if (!days[dk]) { days[dk] = { day: dk, wd: '日一二三四五六'[libTpe(v.start).wd], visits: [] }; order.push(dk); }
    days[dk].visits.push({ sid: v.sid, os: v.os, br: v.br, from: libFmtHM(v.start), to: libFmtHM(v.end), ipMask: v.ipMask, ev: v.events.map(function (e) { var tx = libEventText(e); return { t: libFmtHM(e.t), d: tx.d, x: tx.x }; }) });
  });
  return { visits: visits.length, days: order.map(function (k) { return days[k]; }) };
}

/* =====================================================================
   後台查詢 op（admin.events／results／person／people／overview／repeat／export）
   全部是純函式：GAS 與預覽假資料都先用 libCtx 整理資料，再呼叫 libOp*。
   ===================================================================== */

/* src：{events, results, persons（物件或陣列）, students, devices}；events 會就地正規化（舊格式 → 新格式）並補 who */
function libCtx(src, now) {
  var persons = {};
  if (Array.isArray(src.persons)) src.persons.forEach(function (p) { if (p.pid) persons[p.pid] = p; }); else if (src.persons) persons = src.persons;
  var devPid = {}, devices = src.devices || [];
  devices.forEach(function (d) { if (d.pid) devPid[d.did] = d.pid; });
  var events = (src.events || []).map(function (e) { e.t = Number(e.t); e.who = ''; return libNormEvent(e); });
  libAttachWho(events, devPid);
  var didPid = {}; Object.keys(devPid).forEach(function (d) { didPid[d] = devPid[d]; }); events.forEach(function (e) { if (e.pid) didPid[e.did] = e.pid; });
  var results = (src.results || []).map(function (q, i) {
    var o = Object.assign({}, q); o.at = Number(o.at); o.n = Number(o.n) || 1; o.id = o.id || 'r' + (i + 2);
    o.who = o.pid || didPid[o.did] || ('d:' + o.did);
    if (typeof o.answers === 'string') { try { o.answers = JSON.parse(o.answers); } catch (e) { o.answers = []; } }
    if (typeof o.summary === 'string') { try { o.summary = JSON.parse(o.summary); } catch (e) { o.summary = {}; } }
    return o;
  });
  var ctx = { now: now, events: events, results: results, persons: persons, students: src.students || [], devices: devices, devPid: devPid, didPid: didPid, stuIdx: libStudentIndex(src.students || []), _info: {} };
  return ctx;
}
/* 人的對應資料（名單列以外，查詢列與匯出共用） */
function libInfo(ctx, who) {
  if (ctx._info[who]) return ctx._info[who];
  var pid = who && who.indexOf('d:') !== 0 ? who : '', per = pid ? ctx.persons[pid] || null : null, stu = per ? libMatchStudent(per, ctx.stuIdx) : null;
  var o = { who: who, pid: pid, name: per ? per.name || '（未命名）' : '未登入訪客', src: per ? per.src : '', ig: per ? per.ig || '' : '', pic: per ? per.pic || '' : '', email: per ? per.email || '' : '', loggedIn: !!pid,
    student: stu ? { account: stu.account, name: stu.name, level: stu.level, status: stu.status, regDate: stu.regDate, lineId: stu.lineId, by: stu.by } : null };
  ctx._info[who] = o; return o;
}
function libPeopleOf(ctx, events) {
  if (events === ctx.events && ctx._people) return ctx._people;
  var p = libPeople(events, ctx.results, ctx.persons, ctx.students, libRepeatFlags(events));
  if (events === ctx.events) ctx._people = p;
  return p;
}
function libStu(s) { return s ? { account: s.account, level: s.level, status: s.status } : null; }

/* 事件列 */
function libEventRow(ctx, e) {
  var L = libEventLabel(e), I = libInfo(ctx, libWho(e));
  return { id: e.id, t: e.t, day: libDayKey(e.t), hm: libFmtHM(e.t), who: I.who, name: I.name, src: I.src, ig: I.ig, loggedIn: I.loggedIn, login: e.pid ? { pid: e.pid, src: I.src } : null,
    student: libStu(I.student), n: e.n, k: e.k, v: e.v, u: e.u, ref: e.ref || '', ev: L.ev, target: L.target, dest: L.dest, click: libIsClick(e), view: e.n === 'view',
    os: e.os, br: e.br, did: e.did, sid: e.sid || '', ipMask: e.ipMask || '', ipHash: e.ipHash || '' };
}
/* n 參數：字串（可逗號分隔）或陣列；click＝LIB_CLICK_N、view＝畫面 */
function libNSet(n) {
  if (n === undefined || n === null || n === '') return null;
  var arr = Array.isArray(n) ? n : String(n).split(','), s = {};
  arr.forEach(function (x) { x = String(x).trim(); if (x === 'click') LIB_CLICK_N.forEach(function (c) { s[c] = 1; }); else if (x) s[x] = 1; });
  return s;
}
function libEventFilters(d) {
  var ns = libNSet(d.n), hour = d.hour === undefined || d.hour === null || d.hour === '' ? -1 : Number(d.hour), u = String(d.u || '').toLowerCase();
  var base = function (e) {
    if (d.who && libWho(e) !== d.who) return false;
    if (d.did && e.did !== d.did) return false;
    if (d.ipHash && e.ipHash !== d.ipHash) return false;
    if (d.sid && e.sid !== d.sid) return false;
    if (hour >= 0 && libTpe(e.t).h !== hour) return false;
    return true;
  };
  var nkvu = function (e) {
    if (ns && !ns[e.n]) return false;
    if (d.k !== undefined && d.k !== null && d.k !== '' && e.k !== String(d.k)) return false;
    if (d.v !== undefined && d.v !== null && d.v !== '' && e.v !== String(d.v)) return false;
    if (u && String(e.u || '').toLowerCase().indexOf(u) < 0) return false;
    return true;
  };
  return { base: base, nkvu: nkvu };
}
function libOpEvents(ctx, d, now) {
  d = d || {};
  var r = libResolveRange(d, now, '7d'), F = libEventFilters(d), RQ = libRangeQ(d, r);
  var base = ctx.events.filter(function (e) { return e.t >= r.start && e.t <= r.end && F.base(e); });
  var rows = base.filter(F.nkvu).sort(function (a, b) { return b.t - a.t; });
  var fn = {}, fk = {};
  base.forEach(function (e) {
    fn[e.n] = (fn[e.n] || 0) + 1;
    var kk = e.n + '|' + e.k; if (!fk[kk]) { var L = libEventLabel(e); fk[kk] = { n: e.n, k: e.k, label: !e.k ? L.ev : L.ev + '・' + (e.n === 'now' ? (LIB_NOW_LABEL[e.k] || e.k) : e.n === 'card' ? e.k : e.n === 'quiz_q' || e.n === 'quiz_done' || e.n === 'quiz_nav' ? (LIB_KIND_LABEL[e.k] || e.k) : L.target), v: 0 }; } fk[kk].v++;
  });
  var who = {}, dids = {}, clicks = 0, views = 0;
  rows.forEach(function (e) { who[libWho(e)] = 1; dids[e.did] = 1; if (libIsClick(e)) clicks++; if (e.n === 'view') views++; });
  var pg = libPage(rows, d);
  return {
    range: r.range, start: r.start, end: r.end, page: pg.page, size: pg.size, pages: pg.pages,
    totals: { events: rows.length, people: Object.keys(who).length, devices: Object.keys(dids).length, clicks: clicks, views: views },
    facets: {
      n: Object.keys(fn).map(function (n) { return { n: n, label: libEventLabel({ n: n, k: '', v: '' }).ev, v: fn[n], q: Object.assign({ op: 'admin.events' }, RQ, { n: n }) }; }).sort(function (a, b) { return b.v - a.v; }),
      k: Object.keys(fk).map(function (x) { var o = fk[x]; o.q = Object.assign({ op: 'admin.events' }, RQ, { n: o.n, k: o.k }); return o; }).sort(function (a, b) { return b.v - a.v; }).slice(0, 60)
    },
    rows: pg.rows.map(function (e) { return libEventRow(ctx, e); })
  };
}
function libRangeQ(d, r) { if (d.day) return { day: d.day }; if (r.range === 'custom') return { from: r.start, to: r.end }; return { range: r.range }; }

/* 測驗作答列 */
function libAttemptRow(ctx, q) {
  var I = libInfo(ctx, q.who);
  return { id: q.id, who: q.who, pid: I.pid, did: q.did, name: I.name, src: I.src, ig: I.ig, loggedIn: I.loggedIn, anon: !!Number(q.anon) || !q.pid, student: libStu(I.student),
    at: q.at, day: libDayKey(q.at), hm: libFmtHM(q.at), kind: q.kind, kindLabel: LIB_KIND_LABEL[q.kind] || q.kind, label: q.label, n: q.n, summary: q.summary || {}, answers: libAnswerDetail(q.kind, q.answers) };
}
function libOpResults(ctx, d, now) {
  d = d || {};
  var r = libResolveRange(d, now, '30d');
  var base = ctx.results.filter(function (q) { return q.at >= r.start && q.at <= r.end && (!d.kind || q.kind === d.kind) && (!d.who || q.who === d.who); });
  var rows = base.filter(function (q) { return !d.label || q.label === d.label; }).sort(function (a, b) { return b.at - a.at; });
  var dist = libDist(base, libRangeQ(d, r));
  var questions = null;
  if (d.kind === 'ability' || d.kind === 'career') {
    var len = d.kind === 'ability' ? 14 : 12, opts = d.kind === 'ability' ? 4 : 2;
    questions = []; for (var i = 0; i < len; i++) { var c = []; for (var j = 0; j < opts; j++) c.push(0); questions.push({ q: i + 1, opts: c, ability: d.kind === 'ability' ? LIB_ABILITY_OF_Q[i] : undefined, roles: d.kind === 'career' ? LIB_CAREER_ROLE[i] : undefined }); }
    rows.forEach(function (q) { (q.answers || []).forEach(function (a, i) { if (questions[i] && typeof a === 'number' && a >= 0 && a < opts) questions[i].opts[a]++; }); });
  }
  var anon = 0, ppl = {}; rows.forEach(function (q) { if (!q.pid) anon++; ppl[q.who] = 1; });
  var pg = libPage(rows, d);
  return { range: r.range, start: r.start, end: r.end, page: pg.page, size: pg.size, pages: pg.pages,
    totals: { attempts: rows.length, people: Object.keys(ppl).length, anon: anon, ability: rows.filter(function (q) { return q.kind === 'ability'; }).length, career: rows.filter(function (q) { return q.kind === 'career'; }).length },
    dist: { stages: dist.stages, roles: dist.roles, questions: questions },
    rows: pg.rows.map(function (q) { return libAttemptRow(ctx, q); }) };
}

/* 個人頁 */
function libOpPerson(ctx, d, now) {
  var who = String((d || {}).who || '');
  if (!who) return null;
  var people = libPeopleOf(ctx, ctx.events), p = null;
  people.forEach(function (x) { if (x.who === who) p = x; });
  var att = ctx.results.filter(function (q) { return q.who === who; }).sort(function (a, b) { return b.at - a.at; });
  if (!p && !att.length && !ctx.persons[who]) return null;
  if (!p) { var I = libInfo(ctx, who); p = Object.assign({}, I, { ability: '', career: '', attempts: att.length, clicks: 0, visits: 0, first: 0, last: 0, devices: 0, ips: 0, flag: null }); }
  var evs = ctx.events.filter(function (e) { return libWho(e) === who; }), st = libFunnelSteps(evs)[who];
  p = Object.assign({}, p, { step: st === undefined ? -1 : st, stepLabel: st >= 0 ? LIB_FUNNEL_LABEL[st] : '' });
  var visits = libVisitsBySid(evs);
  var dids = {};
  visits.forEach(function (v) { var o = dids[v.did] || (dids[v.did] = { did: v.did, os: v.os, br: v.br, visits: 0, ips: {}, first: v.start, last: v.end }); o.visits++; if (v.start < o.first) o.first = v.start; if (v.end > o.last) o.last = v.end; v.events.forEach(function (e) { if (e.ipMask) o.ips[e.ipMask] = 1; }); o.os = v.os; o.br = v.br; });
  var myIps = {}; evs.forEach(function (e) { if (e.ipHash) myIps[e.ipHash] = e.ipMask; });
  var sameIp = {}; ctx.events.forEach(function (e) { if (e.ipHash && myIps[e.ipHash] && libWho(e) !== who) { var w = libWho(e); var q = sameIp[w] || (sameIp[w] = { who: w, name: libInfo(ctx, w).name, ipMask: e.ipMask, last: e.t }); if (e.t > q.last) q.last = e.t; } });
  var latest = {}; att.forEach(function (q) { if (!latest[q.kind]) latest[q.kind] = { pid: q.pid, did: q.did, kind: q.kind, at: q.at, label: q.label, answers: JSON.stringify(q.answers || []), summary: JSON.stringify(q.summary || {}), n: q.n }; });
  var stu = p.pid ? libMatchStudent(ctx.persons[p.pid], ctx.stuIdx) : null;
  return {
    person: p,
    student: stu ? { account: stu.account, name: stu.name, email: stu.email, ig: stu.ig, lineId: stu.lineId, level: stu.level, status: stu.status, regDate: stu.regDate, syncedAt: Number(stu.syncedAt) || 0, by: stu.by } : null,
    attempts: att.map(function (q) { return libAttemptRow(ctx, q); }),
    results: latest,
    visits: visits.map(function (v) { var c = 0, w = 0; v.events.forEach(function (e) { if (libIsClick(e)) c++; if (e.n === 'view') w++; }); return { sid: v.sid, did: v.did, start: v.start, end: v.end, day: libDayKey(v.start), from: libFmtHM(v.start), to: libFmtHM(v.end), os: v.os, br: v.br, ipMask: v.ipMask, events: v.events.length, clicks: c, views: w, loggedIn: !!v.pid, q: { op: 'admin.events', who: who, from: v.start, to: v.end } }; }),
    timeline: libPersonTimeline(evs),
    devices: Object.keys(dids).map(function (k) { var o = dids[k]; return { did: o.did, os: o.os, br: o.br, visits: o.visits, ips: Object.keys(o.ips), first: o.first, last: o.last, q: { op: 'admin.events', did: o.did, range: 'all' } }; }).sort(function (a, b) { return b.last - a.last; }),
    sameIp: Object.keys(sameIp).map(function (k) { return sameIp[k]; }).sort(function (a, b) { return b.last - a.last; }).slice(0, 10)
  };
}

/* 名單（取代 admin.list；range 內有活動的人，統計也只算 range 內） */
function libOpPeople(ctx, d, now) {
  d = d || {};
  var r = libResolveRange(d, now, 'all');
  var evs = r.range === 'all' ? ctx.events : ctx.events.filter(function (e) { return e.t >= r.start && e.t <= r.end; });
  var people = libPeopleOf(ctx, evs), steps = libFunnelSteps(evs);
  people.forEach(function (p) { p.step = steps[p.who] === undefined ? -1 : steps[p.who]; p.stepLabel = p.step >= 0 ? LIB_FUNNEL_LABEL[p.step] : ''; });
  var fs = libFunnelIndex(d.funnelStep), fd = libFunnelIndex(d.funnelDrop);
  var pre = libFilterPeople(people, { q: d.q, level: d.level, status: d.status }).filter(function (p) {
    if (fs >= 0 && p.step < fs) return false;
    if (fd >= 1 && p.step !== fd - 1) return false;
    return true;
  });
  var counts = { all: pre.length, loggedin: 0, anon: 0, student: 0, nonstudent: 0 };
  pre.forEach(function (p) { if (p.pid) counts.loggedin++; else counts.anon++; if (p.student) counts.student++; else counts.nonstudent++; });
  var rows = libFilterPeople(pre, { filter: d.filter });
  var S = { last: 'last', first: 'first', clicks: 'clicks', visits: 'visits' }[d.sort] || 'last';
  rows = rows.slice().sort(function (a, b) { return (b[S] - a[S]) || (b.last - a.last); });
  var pg = libPage(rows, d);
  return { range: r.range, start: r.start, end: r.end, total: people.length, students: people.filter(function (p) { return p.student; }).length, matched: rows.length, page: pg.page, size: pg.size, pages: pg.pages, counts: counts,
    rows: pg.rows.map(function (p) { return Object.assign({}, p, { q: { op: 'admin.person', who: p.who } }); }),
    levels: libUniq(ctx.students, 'level'), statuses: libUniq(ctx.students, 'status') };
}
function libUniq(arr, k) { var s = {}; (arr || []).forEach(function (x) { if (x[k]) s[x[k]] = 1; }); return Object.keys(s); }

function libOpOverview(ctx, d, now) { return libOverview(ctx.events, ctx.results, ['today', '7d', '30d'].indexOf((d || {}).range) >= 0 ? d.range : 'today', now, ctx.persons); }
function libOpRepeat(ctx, d, now) {
  d = d || {};
  var r = libResolveRange(d, now, '7d'), evs = ctx.events.filter(function (e) { return e.t >= r.start && e.t <= r.end; }), people = libPeopleOf(ctx, ctx.events), RQ = libRangeQ(d, r);
  var rq = RQ.range || undefined;
  var fix = function (rows) { rows.forEach(function (x) { Object.assign(x.q, RQ); }); return rows.slice(0, 20); };
  return { range: r.range, rule: { window: LIB_REPEAT_WINDOW, n: LIB_REPEAT_N, text: '同一人、同一顆按鈕、10 分鐘內 5 次以上' }, ig: fix(libRepeat(evs, people, 'ig', rq)), device: fix(libRepeat(evs, people, 'device', rq)), ip: fix(libRepeat(evs, people, 'ip', rq)) };
}

/* 匯出 CSV：UTF-8 BOM、全部欄位加引號、= + - @ 開頭補 ' 防公式；超過 5 MB 或 20,000 列分段（offset／next） */
function libCsvCell(x) { var s = x === undefined || x === null ? '' : String(x); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; }
function libUtf8Len(s) { var n = 0; for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); n += c < 0x80 ? 1 : c < 0x800 ? 2 : (c >= 0xd800 && c <= 0xdbff) ? (i++, 4) : 3; } return n; }
function libFmtDT(t) { return t ? libDayKey(t) + ' ' + libFmtHM(t) : ''; }
function libOpExport(ctx, d, now) {
  d = d || {};
  var type = d.type, head, all;
  var big = Object.assign({}, d, { page: 0, size: 1e9 });
  var pageAll = function (fn) { var save = LIB_PAGE_MAX; LIB_PAGE_MAX = 1e9; try { return fn(); } finally { LIB_PAGE_MAX = save; } };
  if (type === 'people') {
    head = ['who', '姓名', '登入方式', 'IG', 'email', '學院帳號', '級別', '狀態', '能力健檢', '職涯定位', '測驗次數', '到訪', '點擊', '漏斗進度', '首次', '最近', '裝置數', 'IP 數', '重複點擊'];
    all = pageAll(function () { return libOpPeople(ctx, big, now).rows; }).map(function (p) { return [p.who, p.name, p.src === 'line' ? 'LINE' : p.src === 'google' ? 'Google' : '未登入', p.ig, p.email, p.student ? p.student.account : '', p.student ? p.student.level : '', p.student ? p.student.status : '', p.ability, p.career, p.attempts, p.visits, p.clicks, p.stepLabel, libFmtDT(p.first), libFmtDT(p.last), p.devices, p.ips, p.flag ? p.flag.map(function (f) { return f.label + ' ' + f.max + ' 次'; }).join('、') : '']; });
  } else if (type === 'events') {
    head = ['時間', '姓名', 'who', '登入方式', '事件', '對象', '外連去向', 'n', 'k', 'v', '網址', '系統', '瀏覽器', 'IP 片段', '學院帳號', '級別', '狀態', 'sid'];
    all = pageAll(function () { return libOpEvents(ctx, big, now).rows; }).map(function (e) { return [libFmtDT(e.t), e.name, e.who, e.src === 'line' ? 'LINE' : e.src === 'google' ? 'Google' : '未登入', e.ev, e.target, e.dest, e.n, e.k, e.v, e.u, e.os, e.br, e.ipMask, e.student ? e.student.account : '', e.student ? e.student.level : '', e.student ? e.student.status : '', e.sid]; });
  } else if (type === 'results') {
    head = ['時間', '姓名', 'who', '登入', '測驗', '結果', '第幾次', '摘要', '作答（題號:選項，皆 1 起）'];
    all = pageAll(function () { return libOpResults(ctx, big, now).rows; }).map(function (q) { var s = q.summary || {}; return [libFmtDT(q.at), q.name, q.who, q.anon ? '未登入' : '已登入', q.kindLabel, q.label, q.n, q.kind === 'ability' ? '總分 ' + (s.total || 0) + '・最強 ' + (s.top || '—') + '・待補強 ' + (s.low || '—') : '副角色 ' + (s.secondary || '—'), q.answers.map(function (a) { return a.q + ':' + (a.opt === null ? '' : a.opt + 1); }).join(' ')]; });
  } else return null;
  var off = Math.max(0, Math.floor(Number(d.offset) || 0)), lines = [head.map(libCsvCell).join(',')], bytes = 3 + libUtf8Len(lines[0]) + 2, i = off;
  for (; i < all.length && i - off < LIB_EXPORT_ROWS; i++) {
    var ln = all[i].map(libCsvCell).join(','), b = libUtf8Len(ln) + 2;
    if (bytes + b > LIB_EXPORT_BYTES && i > off) break;
    lines.push(ln); bytes += b;
  }
  var stamp = libDayKey(now).replace(/\./g, '');
  return { type: type, total: all.length, from: off, to: i, next: i < all.length ? i : null, bytes: bytes, filename: 'grace-hub-' + type + '-' + stamp + (off || i < all.length ? '-' + (off + 1) + '-' + i : '') + '.csv', csv: '﻿' + lines.join('\r\n') + '\r\n' };
}


window.HUB_BM_SRC="(function(){\nconst subtle = globalThis.crypto.subtle;\nconst enc = new TextEncoder();\nconst b64 = (u8) => { let s = ''; u8.forEach((b) => { s += String.fromCharCode(b); }); return btoa(s); };\nconst unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));\nconst hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');\nasync function pbkdf2(password, salt, bits) {\n  const km = await subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);\n  return new Uint8Array(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 200000 }, km, bits));\n}\nasync function deriveKeys(password, pwSalt) {\n  const [pw, bm] = await Promise.all([pbkdf2(password, pwSalt, 256), pbkdf2(password, pwSalt + '|bm', 256)]);\n  return { pwKey: hex(pw), bmKey: b64(bm) };\n}\nasync function hmac(keyBytes, data) {\n  const k = await subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);\n  return new Uint8Array(await subtle.sign('HMAC', k, data));\n}\nasync function bmEncrypt(bmKeyB64, text) {\n  const K = unb64(bmKeyB64);\n  const kEnc = await hmac(K, enc.encode('enc')), kMac = await hmac(K, enc.encode('mac'));\n  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(16));\n  const pt = enc.encode(text), ct = new Uint8Array(pt.length);\n  for (let blk = 0, i = 0; i < pt.length; blk++) {\n    const ctr = new Uint8Array(20); ctr.set(nonce); ctr.set([(blk >>> 24) & 255, (blk >>> 16) & 255, (blk >>> 8) & 255, blk & 255], 16);\n    const ks = await hmac(kEnc, ctr);\n    for (let j = 0; j < ks.length && i < pt.length; j++, i++) ct[i] = pt[i] ^ ks[j];\n  }\n  const macIn = new Uint8Array(16 + ct.length); macIn.set(nonce); macIn.set(ct, 16);\n  return { nonce: b64(nonce), ct: b64(ct), tag: b64(await hmac(kMac, macIn)) };\n}\nvar SYNC_OVERHEAD = 1200;   /* {op,data:{nonce,ct,tag}} 外層＋封包欄位（ts、syncId、chunk、chunks、source）的保守估計 */\nvar SYNC_ROW_GLUE = 2;      /* 每筆在 rows 陣列裡的逗號與括號 */\nfunction utf8Len(s) {\n  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s).length;\n  var n = 0; for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); n += c < 0x80 ? 1 : c < 0x800 ? 2 : (c >= 0xD800 && c < 0xDC00) ? (i++, 4) : 3; }\n  return n;\n}\nfunction estimateBody(plainBytes) { return Math.ceil(plainBytes * 4 / 3) + 4 + SYNC_OVERHEAD; }\nfunction packRows(rows, target) {\n  var out = [], cur = [], curBytes = 0;\n  for (var i = 0; i < rows.length; i++) {\n    var b = utf8Len(JSON.stringify(rows[i])) + SYNC_ROW_GLUE;\n    if (cur.length && estimateBody(curBytes + b) > target) { out.push(cur); cur = []; curBytes = 0; }\n    cur.push(rows[i]); curBytes += b;\n  }\n  if (cur.length || !out.length) out.push(cur);\n  return out;\n}\n(function (GAS) {\n  'use strict';\n  if (window.__graceSyncRunning) return; window.__graceSyncRunning = true;\n  var BODY_TARGET = 150 * 1024, BODY_MAX = 900 * 1024, KEY_LS = 'grace.hub.bmKey.v1';\n  var lsGet = function () { try { return localStorage.getItem(KEY_LS) || ''; } catch (e) { return ''; } };\n  var lsSet = function (v) { try { localStorage.setItem(KEY_LS, v); } catch (e) { } };\n  var lsDel = function () { try { localStorage.removeItem(KEY_LS); } catch (e) { } };\n  var box = document.createElement('div');\n  box.setAttribute('style', 'position:fixed;z-index:2147483647;right:16px;bottom:16px;width:min(360px,calc(100vw - 32px));padding:16px 18px;border-radius:20px;background:#E4E4E2;color:#1C1C1B;font:13.5px/1.6 -apple-system,\"Noto Sans TC\",\"PingFang TC\",\"Microsoft JhengHei\",sans-serif;box-shadow:10px 10px 24px rgba(120,120,116,.5),-8px -8px 20px rgba(255,255,255,.9),0 0 0 1px rgba(0,0,0,.04)');\n  box.innerHTML = '<div style=\"display:flex;align-items:center;gap:10px;margin-bottom:8px\"><span style=\"width:26px;height:26px;border-radius:50%;background:radial-gradient(circle at 40% 30%,#F7E9C8,#D7BC84 60%,#A9874A)\"></span><b style=\"font-weight:500;letter-spacing:.1em\">學員同步</b><button id=\"gsx\" style=\"margin-left:auto;border:0;background:none;font:inherit;color:#545452;cursor:pointer;min-width:44px;min-height:44px\">關閉</button></div>' +\n    '<ol id=\"gsl\" style=\"margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:4px\"></ol>' +\n    '<div style=\"height:6px;border-radius:3px;background:rgba(163,163,160,.35);overflow:hidden;margin:10px 0 6px\"><i id=\"gsb\" style=\"display:block;height:100%;width:0;background:linear-gradient(90deg,#D9BF85,#B8975A);transition:width .3s\"></i></div>' +\n    '<div id=\"gsm\" style=\"color:#545452;font-size:12.5px\"></div><div id=\"gsf\"></div><div id=\"gsk\" style=\"font-size:12px;color:#8A8A86;margin-top:6px\"></div>';\n  document.body.appendChild(box);\n  var $ = function (id) { return box.querySelector('#' + id); };\n  $('gsx').onclick = function () { box.remove(); window.__graceSyncRunning = false; };\n  var steps = ['掃描學員列表', '輸入後台密碼', '加密上傳', '完成'], cur = -1;\n  function step(i, note) { cur = i; $('gsl').innerHTML = steps.map(function (s, k) { return '<li style=\"display:flex;gap:8px;align-items:center;color:' + (k < i ? '#6F5426' : k === i ? '#1C1C1B' : '#8A8A86') + '\"><span style=\"width:18px;height:18px;border-radius:50%;display:inline-grid;place-items:center;font-size:11px;' + (k < i ? 'background:#B8975A;color:#fff' : k === i ? 'box-shadow:inset 0 0 0 1.5px #1C1C1B' : 'box-shadow:inset 0 0 0 1.5px #B5B5B1') + '\">' + (k < i ? '✓' : k + 1) + '</span>' + s + (k === i && note ? '<small style=\"color:#545452;margin-left:auto\">' + note + '</small>' : '') + '</li>'; }).join(''); }\n  function msg(t, bad) { $('gsm').textContent = t; $('gsm').style.color = bad ? '#A3302B' : '#545452'; }\n  function bar(p) { $('gsb').style.width = Math.max(0, Math.min(100, p)) + '%'; }\n  function keyNote() {\n    if (!lsGet()) { $('gsk').innerHTML = ''; return; }\n    $('gsk').innerHTML = '已記住此電腦（不用再輸入密碼）　<a href=\"#\" id=\"gsfg\" style=\"color:#6F5426\">忘記此裝置</a>';\n    $('gsfg').onclick = function (e) { e.preventDefault(); lsDel(); keyNote(); msg('已忘記此裝置，下次同步會再問一次密碼。'); };\n  }\n  var PER = 500, CONC = 6;\n  var LEVELS = { 1: '入學生', 2: '打底層', 3: '鑽石', 4: '至尊', 5: '皇家至尊' }, STATUS = { W: '未啟用', Y: '啟用', D: '停用', N: '停權' };\n  function levelNames() { /* 在會員資料查詢頁時，以頁面上的級別選單為準（後台新增級別時自動跟上） */\n    var m = {}, sel = document.querySelector('table tbody tr td:nth-child(4) select');\n    if (sel) Array.prototype.forEach.call(sel.options, function (o) { if (o.value) m[o.value] = o.text.trim(); });\n    return Object.keys(m).length ? m : LEVELS;\n  }\n  async function getJSON(path, q) {\n    var u = new URL(path, location.origin); Object.keys(q || {}).forEach(function (k) { u.searchParams.set(k, q[k]); });\n    var r = await fetch(u.href, { credentials: 'include', headers: { Accept: 'application/json' } });\n    if (r.status === 401 || r.status === 403 || /\\/admin\\/?(login)?$/.test(new URL(r.url).pathname)) throw new Error('學院後台登入已逾時，請重新登入後再點書籤。');\n    if (!r.ok) throw new Error('學院後台回應 ' + r.status);\n    return r.json();\n  }\n  function toRow(m, lv) {\n    var uid = String(m.uid || '').trim(), reg = String(m.registered_at || '').match(/^(\\d{4})-(\\d{2})-(\\d{2})/);\n    return { id: m.id, account: uid, name: String(m.name || '').trim(), email: /@/.test(uid) ? uid.toLowerCase() : '', ig: '', lineId: '', level: lv[m.level] || String(m.level || ''), status: STATUS[m.status] || String(m.status || ''), regDate: reg ? reg[1] + '.' + reg[2] + '.' + reg[3] : '' };\n  }\n  async function scan(onProgress) {\n    var prog = onProgress || function () {};\n    if (!/(^|\\.)graceschool\\.com\\.tw$/.test(location.hostname)) throw new Error('請在學院官網後台（www.graceschool.com.tw/admin/）的頁面上點這個書籤。');\n    var lv = levelNames(), list = [], page = 1, maxPage = 1, total = 0;\n    do {\n      prog('名單第 ' + page + ' 頁', 0);\n      var j = await getJSON('/api/admin/members', { curPage: page, maxPerPage: PER });\n      if (!j || !Array.isArray(j.data)) throw new Error('學院後台的會員資料格式不同，無法讀取。');\n      list = list.concat(j.data); maxPage = Number(j.page && j.page.maxPage) || 1; total = Number(j.page && j.page.counts) || list.length; page++;\n    } while (page <= maxPage && page <= 50);\n    var seen = {}, rows = [];\n    list.forEach(function (m) { var r = toRow(m, lv); if (r.account && !seen[r.account]) { seen[r.account] = 1; rows.push(r); } });\n    var done = 0, fail = 0, k = 0;\n    async function worker() {\n      while (k < rows.length) {\n        var r = rows[k++];\n        try { var d = (await getJSON('/api/admin/members/' + encodeURIComponent(r.id))).data || {}; r.ig = String(d.ig_id || '').trim().replace(/^@/, ''); r.lineId = String(d.line_id || '').trim(); }\n        catch (e) { if (/逾時/.test(e.message)) throw e; fail++; }\n        done++; if (done % 20 === 0 || done === rows.length) prog('IG／LINE ' + done + ' / ' + rows.length, done / rows.length);\n      }\n    }\n    var ws = []; for (var w = 0; w < CONC; w++) ws.push(worker()); await Promise.all(ws);\n    rows.forEach(function (r) { delete r.id; });\n    return { rows: rows, total: total, pages: maxPage, detailFail: fail };\n  }\n  function askPassword(info, note) {\n    step(1); bar(60);\n    return new Promise(function (res, rej) {\n      $('gsf').innerHTML = '<div style=\"margin-top:8px\"><div style=\"display:flex;gap:8px\"><input id=\"gsp\" type=\"password\" autocomplete=\"current-password\" placeholder=\"後台密碼\" style=\"flex:1;min-width:0;min-height:44px;padding:0 14px;border:0;border-radius:14px;background:#E4E4E2;box-shadow:inset 3px 3px 6px rgba(163,163,160,.6),inset -3px -3px 6px rgba(255,255,255,.9);font:inherit;outline:none\"><button id=\"gsg\" style=\"min-height:44px;padding:0 16px;border:0;border-radius:999px;background:linear-gradient(180deg,#2B2D35,#08090C);color:#F4F2EC;font:inherit;font-weight:500;cursor:pointer\">上傳</button></div><div style=\"font-size:12px;color:#545452;margin-top:6px\">密碼只用來在這台電腦推導加密金鑰，不會被送出；上傳成功後會記住推導出的金鑰，之後不用再輸入。</div></div>';\n      msg((note || '') + '已掃描 ' + info.rows.length + ' 筆（後台共 ' + info.total + ' 筆）' + (info.detailFail ? '，其中 ' + info.detailFail + ' 筆讀不到 IG／LINE' : '') + '。');\n      var go = function () { var v = $('gsp').value; if (v.length < 8) { msg('密碼至少 8 碼', true); return; } $('gsf').innerHTML = ''; res(v); };\n      $('gsg').onclick = go; $('gsp').onkeydown = function (e) { if (e.key === 'Enter') go(); }; $('gsp').focus();\n    });\n  }\n  function ApiErr(code, m) { this.code = code; this.message = m || code; }\n  async function post(body) {\n    var r = await fetch(GAS, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });\n    var j; try { j = await r.json(); } catch (e) { throw new ApiErr('NET', '資料中心回應格式錯誤'); }\n    if (!j.ok) throw new ApiErr(j.error && j.error.code || 'SERVER', j.error && j.error.msg || j.error && j.error.code || '資料中心錯誤'); return j.data;\n  }\n  async function postRetry(body) {\n    for (var a = 0; ; a++) {\n      try { return await post(body); }\n      catch (e) { var net = !(e instanceof ApiErr) || e.code === 'NET'; if (!net || a >= 2) throw net ? new ApiErr('NET', '連不上資料中心，請確認網路後再點一次書籤') : e; msg('連線不穩，' + (2 << a) + ' 秒後重送…'); await new Promise(function (r) { setTimeout(r, (2 << a) * 1000); }); }\n    }\n  }\n  var sid = function () { var a = new Uint8Array(12); crypto.getRandomValues(a); return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); };\n  async function upload(rows, bmKey) {\n    step(2); msg('分批加密中…');\n    var batches = packRows(rows, BODY_TARGET), syncId = sid(), last = null, sent = 0;\n    for (var c = 0; c < batches.length; c++) {\n      step(2, (c + 1) + ' / ' + batches.length); bar(60 + 40 * (c + 1) / batches.length);\n      msg('上傳第 ' + (c + 1) + ' 批（' + (sent + batches[c].length) + ' / ' + rows.length + ' 筆）');\n      var pkt = await bmEncrypt(bmKey, JSON.stringify({ ts: Date.now(), syncId: syncId, chunk: c, chunks: batches.length, n: rows.length, source: location.hostname + location.pathname, rows: batches[c] }));\n      var body = { op: 'student.sync', data: pkt };\n      if (JSON.stringify(body).length > BODY_MAX) throw new Error('單批資料過大（' + Math.round(JSON.stringify(body).length / 1024) + ' KB），請回報。');\n      last = await postRetry(body); sent += batches[c].length;\n    }\n    return last;\n  }\n  async function run(info) {\n    var st = await post({ op: 'admin.status', data: {} });\n    if (!st.setup) throw new Error('後台尚未設定密碼，請先在總覽後台完成首次設定。');\n    var saved = lsGet(), note = '';\n    if (saved) {\n      step(1, '已記住此電腦'); bar(60);\n      try { return await upload(info.rows, saved); }\n      catch (e) { if (!(e instanceof ApiErr) || e.code !== 'UNAUTHORIZED') throw e; lsDel(); keyNote(); note = '後台密碼已變更，請重新輸入一次。　'; }\n    }\n    var pw = await askPassword(info, note);\n    msg('推導金鑰中…');\n    var keys = await deriveKeys(pw, st.pwSalt);\n    var r = await upload(info.rows, keys.bmKey);\n    lsSet(keys.bmKey); keyNote();\n    return r;\n  }\n  (async function () {\n    try {\n      keyNote(); step(0); var info = await scan(function (t, p) { step(0, t); bar(50 * p); }); bar(50);\n      if (window.__graceSyncDry) { window.__graceSyncDryResult = info; step(4); msg('試掃完成（未上傳）：' + info.rows.length + ' 筆。'); window.__graceSyncRunning = false; return; }\n      if (!info.rows.length) throw new Error('列表裡沒有讀到任何學員。');\n      var r = await run(info);\n      step(4); bar(100); msg('同步完成：' + r.n + ' 筆（新增 ' + r.added + '・更新 ' + r.updated + '）。可以關閉這個面板。');\n    } catch (e) { msg(String(e && e.message || e), true); if (cur < 0) step(0); }\n    window.__graceSyncRunning = false;\n  })();\n})('__GAS__');\n})();";
(function () {
'use strict';
/* G.R.A.C.E 總覽後台｜單頁應用（無框架）— 核心：工具、API、路由、外殼
   路由：#/<頁>[/<參數>]?<篩選>，例 #/events?n=key&k=quiz&range=7d&page=2；所有篩選、期間、分頁、頁籤都在網址裡，畫面由網址推導
   上一頁／下一頁：history.state 帶 {k 唯一鍵, d 深度, trail 麵包屑, prev 上一頁名稱}；捲動位置依 k 存在 sessionStorage
   資料：window.HUB_CFG = { gas, mock }；mock 時改走 window.HubMock（預覽）
   安全：後台 token 存 localStorage['gh.at']（勾「記住此裝置」）或 sessionStorage；密碼在瀏覽器以 PBKDF2 推導後才送出 */
var CFG = window.HUB_CFG || {};
var MOCK = !!CFG.mock;
var IMG = window.HUB_IMG || { logo: 'img/logo-engraved.webp', mark: 'img/logo-academy-mark.webp' };
var FRONT = 'https://grace63188.github.io/grace-IG/';
var $ = function (s, r) { return (r || document).querySelector(s); };
var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
var esc = function (s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
var ic = function (id, cls) { return '<svg class="i' + (cls ? ' ' + cls : '') + '" aria-hidden="true" focusable="false"><use href="#' + id + '"/></svg>'; };
var fmt = function (n) { return Number(n || 0).toLocaleString('en-US'); };
var pad = function (n) { return (n < 10 ? '0' : '') + n; };
var tpe = function (t) { var d = new Date(Number(t) + 8 * 3600e3); return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), wd: d.getUTCDay() }; };
var fDate = function (t) { var p = tpe(t); return p.y + '.' + pad(p.mo) + '.' + pad(p.d); };
var fMD = function (t) { var p = tpe(t); return pad(p.mo) + '.' + pad(p.d); };
var fHM = function (t) { var p = tpe(t); return pad(p.h) + ':' + pad(p.mi); };
var fDT = function (t) { return t ? fDate(t) + ' ' + fHM(t) : '—'; };
var fMDHM = function (t) { return t ? fMD(t) + ' ' + fHM(t) : '—'; };
var WD = '日一二三四五六';
var wdOf = function (t) { return WD[tpe(t).wd]; };
var pct = function (a, b, d) { return b ? (a / b * 100).toFixed(d === undefined ? 0 : d) + '%' : '0%'; };
var isPhone = function () { return window.innerWidth < 900; };
var sleep = function (ms) { return new Promise(function (res) { setTimeout(res, ms); }); };
var KIND = { ability: '能力健檢', career: '職涯定位' };
var STAGES = ['探索起步', '基礎累積', '整合成形', '全面發揮'];
var ROLES = ['實踐者', '洞察者', '創作者', '引導者', '開創者', '統籌者'];
var ABIL = ['表達溝通', '思考判斷', '規劃佈局', '領導協作', '自我管理', '品牌經營', '工具應用'];
/* 有序色階（藍單一色相，四階段由淺到深） */
var STAGE_C = { '探索起步': '#B9BFDA', '基礎累積': '#8890BF', '整合成形': '#5F6AA6', '全面發揮': '#2C3364' };
var RANGE_L = { today: '今日', '7d': '近 7 天', '30d': '近 30 天', '90d': '近 90 天', all: '全部期間', day: '單日', custom: '自訂期間' };
var state = { me: null, status: null, dataAt: null, und: null };

/* ---------- 儲存 ---------- */
var mem = {};
var store = {
  get: function (k) { try { return localStorage.getItem(k) || sessionStorage.getItem(k) || ''; } catch (e) { return mem[k] || ''; } },
  set: function (k, v, persist) { try { (persist ? localStorage : sessionStorage).setItem(k, v); (persist ? sessionStorage : localStorage).removeItem(k); } catch (e) { mem[k] = v; } },
  del: function (k) { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch (e) { } delete mem[k]; }
};
var AT = store.get('gh.at');

/* ---------- API ---------- */
var ApiError = function (code, msg) { this.code = code; this.msg = msg || code; };
/* 只有會改狀態的 op 不自動重送；其餘讀取類的 op 遇到網路層失敗會隔 1 秒再試一次 */
var NO_RETRY = { 'admin.setup': 1, 'admin.login': 1, 'admin.changePassword': 1, 'admin.removeSession': 1, 'admin.logoutAll': 1, 'admin.setIg': 1 };
var NET_MSG = '連不上資料中心（網路或 Google 暫時沒有回應），請再試一次';
var POST_TIMEOUT = 25000;
async function post(body) {
  var ac = typeof AbortController !== 'undefined' ? new AbortController() : null, tm = ac && setTimeout(function () { ac.abort(); }, POST_TIMEOUT), r, txt;
  try {
    r = await fetch(CFG.gas, { method: 'POST', mode: 'cors', credentials: 'omit', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), signal: ac ? ac.signal : undefined });
    txt = await r.text();
  } catch (e) { throw new ApiError('NET', e && e.name === 'AbortError' ? '資料中心回應逾時，請再試一次' : NET_MSG); }
  finally { if (tm) clearTimeout(tm); }
  try { return JSON.parse(txt); } catch (e) { throw new ApiError('NET', r.status === 200 ? '資料中心回應格式錯誤（可能是 Apps Script 權限或部署問題）' : '資料中心回應 ' + r.status); }
}
async function api(op, data) {
  var body = { op: op, did: 'admin', at: AT, ts: Date.now(), data: data || {} };
  var j;
  if (MOCK) j = await window.HubMock.call(op, body);
  else {
    if (!CFG.gas) throw new ApiError('CONFIG', '尚未設定資料中心網址（config.js 的 gas）');
    try { j = await post(body); }
    catch (e1) {
      var net = e1 instanceof ApiError ? e1 : new ApiError('NET', NET_MSG);
      if (NO_RETRY[op]) throw net;
      await sleep(1000);
      try { j = await post(body); } catch (e2) { throw e2 instanceof ApiError ? e2 : net; }
    }
  }
  if (!j || !j.ok) throw new ApiError(j && j.error && j.error.code || 'SERVER', j && j.error && j.error.msg);
  return j.data;
}
/* 讀取快取（與資料中心同為 60 秒）：返回上一頁時立即畫出、捲動位置可精準還原；「重新整理」清空 */
var CACHE = {};
function keyOf(op, data) { var o = {}; Object.keys(data || {}).sort().forEach(function (k) { o[k] = data[k]; }); return op + ' ' + JSON.stringify(o); }
function apiC(op, data) {
  var k = keyOf(op, data), c = CACHE[k];
  if (c && Date.now() - c.t < 60e3) return c.p;
  var p = api(op, data); CACHE[k] = { t: Date.now(), p: p };
  p.catch(function () { if (CACHE[k] && CACHE[k].p === p) delete CACHE[k]; });
  return p;
}
function flushCache() { CACHE = {}; }
/* 依頁碼載入：第 0…page 頁平行取回、依序合併（與「再載入」的請求同參數，可共用快取） */
async function apiPages(op, data, page, size) {
  size = size || 50; var n = Math.max(0, Math.min(Number(page) || 0, 40)), ps = [];
  for (var i = 0; i <= n; i++) ps.push(apiC(op, Object.assign({}, data, { page: i, size: size })));
  var all = await Promise.all(ps), first = all[0], rows = [];
  var last = Math.min(n, (first.pages || 1) - 1);
  for (var j = 0; j <= last; j++) rows = rows.concat(all[j].rows || []);
  return { first: first, rows: rows, page: last, size: size, more: last < (first.pages || 1) - 1 };
}
function deviceLabel() {
  var ua = navigator.userAgent, os = /iPhone|iPad/.test(ua) ? (/iPad/.test(ua) ? 'iPad' : 'iPhone') : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '電腦';
  var br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox/.test(ua) ? 'Firefox' : '瀏覽器';
  return os + '・' + br;
}

/* ---------- 提示 ---------- */
function toast(text, bad) {
  var box = $('.toasts') || (function () { var d = document.createElement('div'); d.className = 'toasts'; d.setAttribute('role', 'status'); d.setAttribute('aria-live', 'polite'); document.body.appendChild(d); return d; })();
  var t = document.createElement('div'); t.className = 'toast' + (bad ? ' bad' : ''); t.textContent = text; box.appendChild(t);
  setTimeout(function () { t.classList.add('out'); setTimeout(function () { t.remove(); }, 220); }, 2800);
}
function announce(t) { var el = $('#sr-live'); if (el) { el.textContent = ''; setTimeout(function () { el.textContent = t; }, 30); } }

/* ---------- 網址 ---------- */
function qs(params) {
  var out = [];
  Object.keys(params || {}).forEach(function (k) { var v = params[k]; if (v === undefined || v === null || v === '' || v === false) return; if (Array.isArray(v)) v = v.join(','); out.push(encodeURIComponent(k) + '=' + encodeURIComponent(v).replace(/%2C/g, ',')); });
  return out.join('&');
}
function href(v, arg, params) { var s = qs(params); return '#/' + v + (arg ? '/' + encodeURIComponent(arg) : '') + (s ? '?' + s : ''); }
function route() {
  var h = location.hash.replace(/^#\/?/, ''), i = h.indexOf('?'), path = i >= 0 ? h.slice(0, i) : h, q = i >= 0 ? h.slice(i + 1) : '', p = {};
  q.split('&').forEach(function (kv) { if (!kv) return; var j = kv.indexOf('='), k = decodeURIComponent(j >= 0 ? kv.slice(0, j) : kv), v = j >= 0 ? kv.slice(j + 1) : ''; try { p[k] = decodeURIComponent(v.replace(/\+/g, ' ')); } catch (e) { p[k] = v; } });
  var parts = path.split('/');
  var v = parts[0] || 'overview', arg = ''; try { arg = decodeURIComponent(parts.slice(1).join('/')); } catch (e) { arg = parts.slice(1).join('/'); }
  return { v: v, arg: arg, p: p, hash: '#/' + path + (q ? '?' + q : '') };
}
/* 回應裡的下鑽參數 q（{op, …}）→ 後台網址 */
var OP_VIEW = { 'admin.events': 'events', 'admin.people': 'people', 'admin.results': 'results' };
function qHref(q, extra) {
  if (!q) return '';
  var p = Object.assign({}, q, extra || {}), op = p.op; delete p.op;
  if (op === 'admin.person') return href('person', p.who);
  var v = OP_VIEW[op]; if (!v) return '';
  if (v === 'results' && !p.tab) p = Object.assign({ tab: 'list' }, p);
  return href(v, '', p);
}
/* 同一頁換參數：保留其他參數 */
function withP(r, patch, drop) {
  var p = Object.assign({}, r.p, patch || {});
  (drop || []).forEach(function (k) { delete p[k]; });
  if (!('page' in (patch || {}))) delete p.page;
  return href(r.v, r.arg, p);
}

/* ---------- 歷程與捲動 ---------- */
var NAV_KEYS = 0;
var newKey = function () { return Date.now().toString(36) + (++NAV_KEYS).toString(36); };
var SCROLL = {}; try { SCROLL = JSON.parse(sessionStorage.getItem('gh.sc') || '{}') || {}; } catch (e) { }
var curKey = '', lastY = 0, PAGE = { label: '總覽', section: 'overview' };
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
function hst() { return history.state && history.state.k ? history.state : null; }
function ensureState() { if (!hst()) history.replaceState({ k: newKey(), d: 0, trail: [], prev: '' }, '', location.href); curKey = history.state.k; }
function saveScroll() { if (!curKey) return; SCROLL[curKey] = lastY; var ks = Object.keys(SCROLL); if (ks.length > 80) delete SCROLL[ks[0]]; try { sessionStorage.setItem('gh.sc', JSON.stringify(SCROLL)); } catch (e) { } }
window.addEventListener('scroll', function () { lastY = window.scrollY; }, { passive: true });
window.addEventListener('pagehide', saveScroll);
/* 導覽：push 新歷程（root＝主選單，清空麵包屑；同一頁換參數＝保留麵包屑與捲動位置） */
function go(h, o) {
  o = o || {}; saveScroll();
  var st = hst() || { d: 0, trail: [] }, cur = route(), tgt = h.replace(/^#\/?/, '').split('?')[0];
  var same = !o.root && tgt === cur.hash.replace(/^#\/?/, '').split('?')[0];
  var trail = o.root ? [] : same ? (st.trail || []) : (st.trail || []).concat([{ label: PAGE.label, href: cur.hash, d: st.d || 0 }]).slice(-3);
  var ns = { k: newKey(), d: o.replace ? (st.d || 0) : (st.d || 0) + 1, trail: trail, prev: o.replace ? st.prev : PAGE.label };
  if (o.replace) history.replaceState(ns, '', h); else history.pushState(ns, '', h);
  curKey = ns.k;
  render({ keep: same && !o.top });
}
/* 只改網址不重畫（分頁「再載入」、展開項目） */
function setUrl(h) { history.replaceState(history.state, '', h); }
function goBack() {
  var st = hst();
  if (st && st.d > 0) { history.back(); return; }
  go(parentHref(), { replace: true, root: true });
}
function parentHref() { var r = route(); return r.v === 'person' ? '#/people' : r.v === 'overview' ? '#/overview' : '#/' + r.v; }
window.addEventListener('popstate', function () {
  saveScroll();
  if (!hst()) { history.replaceState({ k: newKey(), d: 0, trail: [], prev: '' }, '', location.href); curKey = history.state.k; render({}); return; }
  curKey = history.state.k; render({ restore: true });
});
document.addEventListener('click', function (e) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  var a = e.target.closest('a[href]'); if (!a) return;
  var h = a.getAttribute('href'); if (!h || h.indexOf('#/') !== 0 || a.target === '_blank') return;
  e.preventDefault();
  closeSheet(true);
  if (a.hasAttribute('data-root') && route().hash === h) { window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); return; }
  go(h, { root: a.hasAttribute('data-root'), top: a.hasAttribute('data-top') });
});
/* 可點整列（表格列）：點在列內其他連結上時交給連結 */
document.addEventListener('click', function (e) {
  var tr = e.target.closest('[data-href]'); if (!tr || e.target.closest('a,button,input,select,summary,label')) return;
  go(tr.getAttribute('data-href'));
});
document.addEventListener('keydown', function (e) {
  var tr = e.target.closest && e.target.closest('[data-href]');
  if (tr && e.target === tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); go(tr.getAttribute('data-href')); return; }
  /* 分段切換：左右鍵在同一組內移動焦點 */
  var t = e.target.closest && e.target.closest('[role="tab"]');
  if (t && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
    var all = $$('[role="tab"]', t.parentElement), i = all.indexOf(t), n = all[(i + (e.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length];
    if (n) { e.preventDefault(); n.focus(); }
  }
  if (e.key === 'Escape') { closeSheet(); hideTip(); }
});

/* ---------- 共用片段 ---------- */
var chev = ic('i-chev', 'chev');
/* 可下鑽的數字：虛線底線＋右側箭頭 */
function dd(inner, h, cls, label) { if (!h) return '<span class="ddn ' + (cls || '') + '">' + inner + '</span>'; return '<a class="dd ' + (cls || '') + '" href="' + esc(h) + '"' + (label ? ' aria-label="' + esc(label) + '"' : '') + '>' + inner + chev + '</a>'; }
function avatar(p, cls) { var pid = p.pid || (p.who && p.who.indexOf('d:') !== 0 ? p.who : ''); return '<span class="av ' + (cls || '') + (pid ? '' : ' anon') + '" aria-hidden="true">' + (p.pic && /^https:\/\//i.test(p.pic) ? '<img src="' + esc(p.pic) + '" alt="" referrerpolicy="no-referrer">' : pid ? esc(String(p.name || '訪').charAt(0)) : '?') + '</span>'; }
function srcLabel(s) { return s === 'line' ? '<span class="src"><span class="srcI l">' + ic('i-linef') + '</span>LINE</span>' : s === 'google' ? '<span class="src"><span class="srcI g">' + ic('i-g') + '</span>Google</span>' : '<span class="src none">未登入</span>'; }
function idTag(p) { return p.student ? '<span class="tag gold">已是學員</span>' : (p.loggedIn || p.pid) ? '<span class="tag">未入學</span>' : '<span class="tag">未登入</span>'; }
function resChip(label, kind) { return label ? '<span class="rchip"><i style="background:' + (kind === 'career' ? 'var(--cr)' : (STAGE_C[label] || 'var(--ab)')) + '"></i>' + esc(label) + '</span>' : ''; }
function whoName(r) { return r.loggedIn || (r.who && r.who.indexOf('d:') !== 0) ? esc(r.name) : '<span class="en">' + esc((r.who || '').replace(/^d:/, '').slice(0, 10)) + '</span>'; }
var STCLS = function (s) { return /啟用中|^啟用$|正常|active/i.test(s) && !/未啟用/.test(s) ? 'on' : /停權|封鎖|ban/i.test(s) ? 'ban' : /停用|未啟用|inactive/i.test(s) ? 'off' : ''; };
function stDot(s) { return '<span class="st ' + STCLS(s) + '"><i></i>' + esc(s || '—') + '</span>'; }
/* 標題列：h1 可聚焦（換頁時焦點移到這裡） */
function titleRow(h, sub, right) { return '<div class="trow"><h1 tabindex="-1">' + esc(h) + '</h1>' + (sub ? '<span class="sub">' + sub + '</span>' : '') + '<span class="sp"></span>' + (right || '') + '</div>'; }
function tabs(items, cur, label, cls) {
  return '<div class="seg tabs ' + (cls || '') + '" role="tablist" aria-label="' + esc(label) + '">' + items.map(function (t) {
    return '<a role="tab" href="' + esc(t.href) + '" aria-selected="' + (t.v === cur) + '"' + (t.v === cur ? '' : ' tabindex="-1"') + '>' + t.label + (t.n !== undefined && t.n !== null ? (t.badge ? (t.n ? '<span class="cnt" aria-label="' + t.n + ' 份">' + fmt(t.n) + '</span>' : '') : '<span class="en">' + fmt(t.n) + '</span>') : '') + '</a>';
  }).join('') + '</div>';
}
function rangeTabs(r, cur, opts) {
  opts = opts || [['today', '今日'], ['7d', '7 天'], ['30d', '30 天']];
  return '<div class="seg rng" role="tablist" aria-label="時間範圍" style="grid-template-columns:repeat(' + opts.length + ',auto)">' + opts.map(function (o) { return '<a role="tab" href="' + esc(withP(r, { range: o[0] }, ['day', 'from', 'to'])) + '" aria-selected="' + (o[0] === cur) + '"' + (o[0] === cur ? '' : ' tabindex="-1"') + '>' + o[1] + '</a>'; }).join('') + '</div>';
}
/* 篩選籌碼：每顆可移除；最後是「新增篩選」與「清除全部」 */
function chipRow(items, addHtml, clearHref, note) {
  if (!items.length && !addHtml) return '';
  return '<div class="chips" aria-label="已套用的篩選">' + items.map(function (c) { return '<a class="fchip" href="' + esc(c.href) + '" aria-label="移除篩選：' + esc(c.k + ' ' + c.v) + '"><span class="k">' + esc(c.k) + '</span><span class="cv">' + esc(c.v) + '</span><span class="x" aria-hidden="true">' + ic('i-x') + '</span></a>'; }).join('') +
    (addHtml || '') + (items.length > 1 && clearHref ? '<a class="clear" href="' + esc(clearHref) + '">清除全部</a>' : '') + (note ? '<span class="keep">' + ic('i-pin') + esc(note) + '</span>' : '') + '</div>';
}
/* 新增篩選：原生 <details> 展開一組下拉；選了就換網址 */
function addFilter(fields) {
  if (!fields.length) return '';
  return '<details class="addf"><summary class="fchip add">' + ic('i-plus') + '新增篩選</summary><div class="addf-p">' + fields.map(function (f) {
    return '<label class="addf-f"><span>' + esc(f.label) + '</span><span class="selw"><select data-go>' + '<option value="">' + esc(f.none || '全部') + '</option>' + f.opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[2] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>' + ic('i-dn') + '</span></label>';
  }).join('') + '</div></details>';
}
document.addEventListener('change', function (e) {
  var s = e.target.closest('select[data-go]'); if (!s) return;
  var o = s.options[s.selectedIndex]; var h = o && o.value; if (h && h.indexOf('#/') === 0) go(h);
});
document.addEventListener('click', function (e) {   /* 點在外面就收起「新增篩選」 */
  $$('details.addf[open]').forEach(function (d) { if (!d.contains(e.target)) d.removeAttribute('open'); });
});
function backRow() {
  var st = hst() || {}, tr = st.trail || [], r = route();
  if (!tr.length && r.v !== 'person') return '';
  var crumbs = tr.length ? tr : [{ label: '名單', href: '#/people' }];
  var prev = st.d > 0 && st.prev ? st.prev : crumbs[crumbs.length - 1].label;
  return '<div class="backrow"><button class="btn-back" type="button" data-back><span class="bk">' + ic('i-arrow') + '</span><span class="bl">返回「' + esc(prev) + '」</span></button>' +
    '<nav class="crumbs" aria-label="位置">' + crumbs.map(function (c) { return '<a href="' + esc(c.href) + '">' + esc(c.label) + '</a>' + ic('i-chev'); }).join('') + '<span aria-current="page">' + esc(PAGE.label) + '</span></nav></div>';
}
document.addEventListener('click', function (e) { if (e.target.closest('[data-back]')) { e.preventDefault(); goBack(); } });
function emptyBlock(t, sub) { return '<div class="empty"><b>' + esc(t) + '</b>' + (sub ? esc(sub) : '') + '</div>'; }
function pager(shown, total, unit, more) {
  return '<div class="pager"><span>' + (total ? '第 <span class="en">1–' + fmt(shown) + '</span> 筆，共 <span class="en">' + fmt(total) + '</span> ' + unit : '') + '</span>' + (more ? '<button class="btn-s gl gl-clear" type="button" data-more>' + ic('i-plus') + '再載入 ' + Math.min(50, total - shown) + ' ' + unit + '</button>' : '') + '</div>';
}
function rangeText(d) { if (!d) return ''; if (d.range === 'all') return '全部期間'; if (d.range === 'today' || d.range === 'day') return fDate(d.start) + '（' + wdOf(d.start) + '）'; return fDate(d.start) + '–' + fMD(d.end); }
function rangeChipV(r, d) { if (r.p.day) return r.p.day; if (r.p.from || r.p.to) return rangeText(d); return RANGE_L[d && d.range] || RANGE_L[r.p.range] || ''; }

/* ---------- 浮動提示（全頁一個，固定定位，夾在視窗內） ---------- */
var TIP;
function showTip(el, html) {
  if (!TIP) { TIP = document.createElement('div'); TIP.className = 'tip'; TIP.setAttribute('role', 'tooltip'); TIP.id = 'tipx'; document.body.appendChild(TIP); }
  TIP.innerHTML = html; TIP.classList.add('on');
  var r = el.getBoundingClientRect(), vw = document.documentElement.clientWidth, tw = TIP.offsetWidth, th = TIP.offsetHeight, m = 8;
  var x = Math.max(m, Math.min(vw - tw - m, r.left + r.width / 2 - tw / 2)), y = r.top - th - 10;
  var top = isPhone() ? 64 : 0; if (y < m + top) y = Math.min(innerHeight - th - m, r.bottom + 10);
  TIP.style.left = x + 'px'; TIP.style.top = y + 'px';
}
function hideTip() { if (TIP) TIP.classList.remove('on'); }
document.addEventListener('pointerover', function (e) { var t = e.target.closest && e.target.closest('[data-tip]'); if (t) showTip(t, t.getAttribute('data-tip')); });
document.addEventListener('pointerout', function (e) { var t = e.target.closest && e.target.closest('[data-tip]'); if (t && !t.contains(e.relatedTarget)) hideTip(); });
document.addEventListener('focusin', function (e) { var t = e.target.closest && e.target.closest('[data-tip]'); if (t) showTip(t, t.getAttribute('data-tip')); else hideTip(); });
window.addEventListener('scroll', hideTip, { passive: true });

/* ---------- 下載 ---------- */
function saveFile(name, text) {
  var b = new Blob([text], { type: 'text/csv;charset=utf-8' }), u = URL.createObjectURL(b), a = document.createElement('a');
  a.href = u; a.download = name; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
}
/* 匯出：依 next 分段取回，每段存成一個檔 */
async function exportCsv(type, params, btn) {
  if (btn) { if (btn.getAttribute('aria-busy') === 'true') return; btn.setAttribute('aria-busy', 'true'); }
  var lbl = btn && btn.querySelector('.bl'), old = lbl && lbl.textContent, files = 0, rows = 0;
  try {
    var off = 0;
    for (var i = 0; i < 50; i++) {
      if (lbl) lbl.textContent = '匯出中' + (files ? '（第 ' + (files + 1) + ' 段）' : '…');
      var d = Object.assign({}, params, { type: type, offset: off }); delete d.page; delete d.size; delete d.tab;
      var r = await api('admin.export', d);
      saveFile(r.filename, r.csv); files++; rows += (r.to - r.from);
      if (r.next === null || r.next === undefined) break; off = r.next;
    }
    toast('已匯出 ' + fmt(rows) + ' 筆' + (files > 1 ? '（' + files + ' 個檔案）' : ''));
  } catch (e) { toast('匯出失敗：' + (e.msg || e.message || e), true); }
  finally { if (btn) btn.removeAttribute('aria-busy'); if (lbl) lbl.textContent = old; }
}

/* 題目文字（唯讀副本）：由 tools/gen-quiztext.mjs 自前台 assets/js/quizdata.js 產生，請勿手改；改前台題目後重新建置 */
var QUIZ_TEXT = {"ability":[{"q":"開會時主管問妳對新方案的看法，妳其實有疑慮。","opts":["先說好的部分，再補一句「有個地方想再確認」","看大家都點頭，先不說，會後再想想","先問這方案最想解決什麼，再講我卡住的點","直接說「我覺得這個不太行」"],"s":[2,0,3,1]},{"q":"下個月想推一檔新服務，妳會怎麼開始？","opts":["先把想到的內容做出來，邊做邊調","等這陣子比較空，再好好坐下來想","把要做的事列出來，排進行事曆","先訂好要賣幾份，再倒推每週要完成什麼"],"s":[1,0,2,3]},{"q":"IG 發了一篇很用心的貼文，互動卻很冷。","opts":["回頭看是不是只講了我想講的，沒講到她們想看的","去看同行最近什麼紅，跟著做一篇","有點受傷，先刪掉換一篇","打開數據，跟之前互動好的那篇比一比"],"s":[3,1,0,2]},{"q":"連續幾天事情爆量，妳最常的狀態是？","opts":["列待辦一件件劃掉，但常常做到很晚","全部做完，之後再一次大休息","先砍掉不急的事，把睡眠時間留住","壓力一大就先滑手機放空"],"s":[2,1,3,0]},{"q":"有人找妳合作，條件看起來很好，但要妳這週就決定。","opts":["請對方給完整條件，比較過再回覆","機會難得，先答應再說","問問身邊有經驗的朋友怎麼看","先想最壞會怎樣，承受得起才接"],"s":[2,0,1,3]},{"q":"要從 30 頁的會議資料整理出重點。","opts":["丟給 AI 摘要，直接貼上用","拜託比較熟這塊的同事幫我看","自己從頭讀，邊讀邊畫重點","先請 AI 抓重點，再回原文核對關鍵段落"],"s":[2,0,1,3]},{"q":"夥伴交來的東西跟妳想的落差很大。","opts":["自己默默改完，比較快","把要改的地方標出來，請她照著修","直接說「這不是我要的」，請她重做","一起對照原本的需求，看哪裡沒講清楚"],"s":[1,2,0,3]},{"q":"新朋友問妳：「妳是做什麼的？」","opts":["講我的職稱或公司名字","講我幫哪一種人解決什麼問題","看場合，每次講的都不太一樣","講我在做的事，順便給她看一兩個作品"],"s":[0,3,1,2]},{"q":"要在群組公告一個大家可能不太開心的調整。","opts":["先私訊幾個人探探口風，再發公告","寫一篇長文，把來龍去脈全部交代清楚","輕輕一句帶過，不想引起討論","先講結論和影響，再補原因和配合方式"],"s":[2,1,0,3]},{"q":"立下的目標，做了兩週就停了。","opts":["回頭看是卡在哪個時段、哪種情況，再調整做法","先放著，等有動力再開始","把目標縮小，從每天十分鐘重新來","怪自己不夠自律，下次逼自己更緊"],"s":[3,0,2,1]},{"q":"手上同時有工作、家庭和自己的進修。","opts":["每樣都想顧好，所以全部排滿","固定時段分給不同的事，偶爾互相讓一下","哪邊比較急就先顧哪邊","先決定這半年最重要的是哪一個，其他配合它排"],"s":[1,2,0,3]},{"q":"新夥伴第一週，常常問同樣的問題。","opts":["安排一位資深夥伴帶她","有點煩，請她自己多記筆記","把常見問題整理成一份，順便問她卡在哪","每次都耐心回答，多問幾次就會了"],"s":[2,0,3,1]},{"q":"每週都要做一樣的報表或排程。","opts":["做一份範本，每次套用","花點時間研究，找工具讓它自動跑","每次手動做，熟了其實也很快","找助理或家人幫忙處理"],"s":[2,3,0,1]},{"q":"業績連續兩個月下滑。","opts":["先加碼廣告或做促銷，把數字拉回來","問幾位老客人最近為什麼比較少買","可能是大環境不好，先觀察看看","拆開來看，是流量、轉換還是回購出了問題"],"s":[1,2,0,3]}],"abilityOfQ":["表達溝通","規劃佈局","品牌經營","自我管理","思考判斷","工具應用","領導協作","品牌經營","表達溝通","自我管理","規劃佈局","領導協作","工具應用","思考判斷"],"career":[{"q":"週末突然多出一整天，妳比較想？","opts":["約人聊一個新點子，看能不能做成生意","把一直想整理的空間或作品動手弄好"],"r":["開創者","實踐者"]},{"q":"看到一支爆紅的影片，妳的第一個念頭是？","opts":["它到底為什麼會紅？","我也想拍一支自己風格的"],"r":["洞察者","創作者"]},{"q":"團隊要辦一場活動，妳想負責哪一塊？","opts":["流程表、預算、報名名單","現場接待，照顧好每一位來賓"],"r":["統籌者","引導者"]},{"q":"開會的時候，妳比較常是哪一個？","opts":["問「這個數字是怎麼來的？」的人","說「好，那我們就這樣做！」的人"],"r":["洞察者","開創者"]},{"q":"到新環境的第一天，哪一種比較讓妳安心？","opts":["直接讓我上手做做看","先拿到完整的 SOP 和分工表"],"r":["實踐者","統籌者"]},{"q":"如果可以自己挑，妳想做哪一個？","opts":["設計一套讓人一眼就記住的品牌視覺","談下一個重量級的合作"],"r":["創作者","開創者"]},{"q":"朋友來找妳訴苦，說工作卡關了，妳會？","opts":["先陪她把心裡話說完","幫她把問題拆開，看到底卡在哪"],"r":["引導者","洞察者"]},{"q":"學一樣新東西，妳比較喜歡？","opts":["跟著步驟，做出一個完整的成品","自由發揮，做出只屬於我的版本"],"r":["實踐者","創作者"]},{"q":"哪一刻最讓妳有成就感？","opts":["帶著團隊一起衝破目標","有人跟妳說「謝謝妳，我真的改變了」"],"r":["開創者","引導者"]},{"q":"收到一份很雜亂的資料，妳會先？","opts":["分類、建表，全部排整齊","找找看裡面藏著什麼規律"],"r":["統籌者","洞察者"]},{"q":"有新學姊加入，妳比較想？","opts":["主動帶她認識大家","直接示範一次給她看怎麼做"],"r":["引導者","實踐者"]},{"q":"妳的筆記本通常長什麼樣子？","opts":["有圖有顏色，想到什麼就寫什麼","有編號有日期，一頁一個主題"],"r":["創作者","統籌者"]}]};

/* ---------- 圖表（量測實際寬度後以 SVG 繪製；視窗改變大小時重畫） ----------
   規則（dataviz）：一個 y 軸、3–4 條淡格線、2px 線、最後一點實心點、直接標籤＋圖例、十字準線＋提示；
   資料色：能力健檢 --ab #4F5B99、職涯定位 --cr #A85B3C（驗色通過：CVD ΔE 16.2、常態 ΔE 20.0）；職涯另以虛線區分 */
var CHARTS = {}, CID = 0;
function chartSlot(kind, cfg, cls, style) { var id = 'c' + (++CID); CHARTS[id] = cfg; return '<div class="chart ' + (cls || '') + '" data-chart="' + kind + '" data-cid="' + id + '"' + (style ? ' style="' + style + '"' : '') + '></div>'; }
function drawCharts(root) { $$('[data-chart]', root).forEach(function (el) { if (!el.getClientRects().length) return; var cfg = CHARTS[el.dataset.cid]; if (cfg && CH[el.dataset.chart]) CH[el.dataset.chart](el, cfg); }); }
var CH = {};
function niceMax(v) { if (v <= 5) return 5; var p = Math.pow(10, Math.floor(Math.log10(v))), m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p; }
var textW = function (s) { s = String(s); var w = 0; for (var i = 0; i < s.length; i++) w += /[　-鿿＀-￯]/.test(s[i]) ? 11.5 : 6.8; return w; };

/* 雙序列折線：每天一欄（可點，帶到當天作答）；系列點另可點（帶到當天該測驗） */
CH.line = function (el, o) {
  var w = Math.max(240, el.clientWidth), h = o.h || 214, n = o.labels.length, all = [];
  o.series.forEach(function (s) { all = all.concat(s.vals); });
  var max = niceMax(Math.max.apply(null, all.concat([1]))), ticks = max % 2 ? [0, max] : [0, max / 2, max];
  if (max >= 6 && max % 3 === 0 && max % 2) ticks = [0, max / 3, max * 2 / 3, max];
  var L = Math.ceil(Math.max.apply(null, ticks.map(function (t) { return textW(fmt(t)); }))) + 12, endLbl = w >= 520, R = endLbl ? Math.ceil(10 + Math.max.apply(null, o.series.map(function (s) { return textW(s.name + ' ' + fmt(s.vals[n - 1])); })) + 6) : 14, T = 12, B = 26;
  var x = function (i) { return L + 8 + (n > 1 ? i * (w - L - R - 16) / (n - 1) : (w - L - R - 16) / 2); }, y = function (v) { return T + (1 - v / max) * (h - T - B); };
  var s = '';
  ticks.forEach(function (t) { s += '<line x1="' + L + '" x2="' + (w - R + 8) + '" y1="' + y(t) + '" y2="' + y(t) + '" stroke="' + (t === 0 ? 'rgba(80,80,76,.55)' : 'var(--grid)') + '"/><text x="' + (L - 8) + '" y="' + (y(t) + 4) + '" text-anchor="end">' + fmt(t) + '</text>'; });
  var every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((w - L - R) / 56))));
  o.labels.forEach(function (lb, i) { if ((n - 1 - i) % every) return; s += '<text x="' + x(i) + '" y="' + (h - 6) + '" text-anchor="middle">' + esc(lb) + '</text>'; });
  /* 末端標籤：兩條線數值接近時上下推開 */
  var ly = o.series.map(function (se) { return y(se.vals[n - 1]) + 4; });
  if (ly.length === 2 && Math.abs(ly[0] - ly[1]) < 15) { var mid = (ly[0] + ly[1]) / 2, up = o.series[0].vals[n - 1] >= o.series[1].vals[n - 1]; ly[0] = mid + (up ? -7.5 : 7.5); ly[1] = mid + (up ? 7.5 : -7.5); }
  var lo = T + 8, hi = h - B - 2, mn = Math.min.apply(null, ly), mxl = Math.max.apply(null, ly), sh = mxl > hi ? hi - mxl : mn < lo ? lo - mn : 0;   // 整組平移，保持間距
  ly = ly.map(function (v) { return Math.max(lo, Math.min(hi, v + sh)); });
  o.series.forEach(function (se, k) {
    var d = se.vals.map(function (v, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1); }).join('');
    s += '<path d="' + d + '" fill="none" stroke="' + se.color + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"' + (se.dash ? ' stroke-dasharray="6 4"' : '') + '/>';
    s += '<circle cx="' + x(n - 1) + '" cy="' + y(se.vals[n - 1]) + '" r="4" fill="' + se.color + '" stroke="var(--clay)" stroke-width="2"/>';
    if (endLbl) s += '<text class="cj ink" x="' + (x(n - 1) + 10) + '" y="' + ly[k] + '">' + esc(se.name) + ' ' + fmt(se.vals[n - 1]) + '</text>';
  });
  s += '<g class="cross" style="opacity:0"><line y1="' + T + '" y2="' + (h - B) + '" stroke="var(--ink)" stroke-dasharray="3 3"/>' + o.series.map(function (se) { return '<circle r="5" fill="' + se.color + '" stroke="var(--clay)" stroke-width="2"/>'; }).join('') + '</g>';
  var cw = n > 1 ? (x(1) - x(0)) : (w - L - R);
  for (var i = 0; i < n; i++) s += '<a href="' + esc(o.hrefs[i]) + '" class="hit-a" data-i="' + i + '" aria-label="' + esc(o.aria[i]) + '"><rect class="hit" x="' + (x(i) - cw / 2) + '" y="' + T + '" width="' + cw + '" height="' + (h - T - B) + '"/></a>';
  /* 系列點：滑到點上可直接帶到該測驗當天的作答 */
  o.series.forEach(function (se) { for (var i = 0; i < n; i++) if (se.hrefs && se.vals[i]) s += '<a href="' + esc(se.hrefs[i]) + '" class="pt-a" data-i="' + i + '" tabindex="-1" aria-hidden="true"><circle class="hit" cx="' + x(i) + '" cy="' + y(se.vals[i]) + '" r="9"/></a>'; });
  el.innerHTML = '<svg class="vz" viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" role="group" aria-label="' + esc(o.label) + '">' + s + '</svg>';
  var svg = el.firstChild, cross = svg.querySelector('.cross'), cl = cross.querySelector('line'), cc = cross.querySelectorAll('circle');
  var show = function (i, target) {
    cl.setAttribute('x1', x(i)); cl.setAttribute('x2', x(i));
    o.series.forEach(function (se, k) { cc[k].setAttribute('cx', x(i)); cc[k].setAttribute('cy', y(se.vals[i])); });
    cross.style.opacity = 1; showTip(target, o.tips[i]);
  };
  svg.addEventListener('pointermove', function (e) { var a = e.target.closest('[data-i]'); if (a) show(Number(a.dataset.i), svg.querySelector('.hit-a[data-i="' + a.dataset.i + '"]')); });
  svg.addEventListener('pointerleave', function () { cross.style.opacity = 0; hideTip(); });
  svg.addEventListener('focusin', function (e) { var a = e.target.closest('.hit-a'); if (a) { e.stopPropagation(); show(Number(a.dataset.i), a); } });
  svg.addEventListener('focusout', function () { cross.style.opacity = 0; });
};
/* 雷達：7 軸、3 圈、單一色相填 16%；寬度留給軸標籤 */
CH.radar = function (el, o) {
  var side = 46, avail = (el.parentElement && el.parentElement.clientWidth) || 999, S = Math.max(120, Math.min(o.size || 200, avail - side * 2)), W = S + side * 2, c = S / 2, cx = W / 2, r = c - 26, n = o.axes.length, s = '';
  var pt = function (i, v) { var a = -Math.PI / 2 + i * 2 * Math.PI / n; return [cx + Math.cos(a) * r * v / o.max, c + Math.sin(a) * r * v / o.max]; };
  [1 / 3, 2 / 3, 1].forEach(function (f) { s += '<polygon points="' + o.axes.map(function (_, i) { return pt(i, o.max * f).join(','); }).join(' ') + '" fill="none" stroke="var(--grid)"/>'; });
  o.axes.forEach(function (a, i) {
    var p = pt(i, o.max), q = pt(i, o.max * 1.17); s += '<line x1="' + cx + '" y1="' + c + '" x2="' + p[0] + '" y2="' + p[1] + '" stroke="var(--grid)"/>';
    var anc = Math.abs(q[0] - cx) < 6 ? 'middle' : q[0] > cx ? 'start' : 'end', dy = q[1] < c - r * .9 ? -2 : q[1] > c + r * .5 ? 10 : 4;
    s += '<text class="cj' + (o.hi === i ? ' ink' : '') + '" x="' + q[0].toFixed(1) + '" y="' + (q[1] + dy).toFixed(1) + '" text-anchor="' + anc + '">' + esc(a) + '</text>';
  });
  s += '<polygon points="' + o.vals.map(function (v, i) { return pt(i, Math.max(0, Math.min(o.max, v))).join(','); }).join(' ') + '" fill="' + o.color + '" fill-opacity=".16" stroke="' + o.color + '" stroke-width="2" stroke-linejoin="round"/>';
  o.vals.forEach(function (v, i) { var p = pt(i, Math.max(0, Math.min(o.max, v))); s += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="3.5" fill="' + o.color + '" stroke="var(--clay)" stroke-width="1.5"/>'; });
  el.style.width = W + 'px'; el.style.height = (S + 8) + 'px';
  el.innerHTML = '<svg class="vz" viewBox="0 0 ' + W + ' ' + (S + 8) + '" width="' + W + '" height="' + (S + 8) + '" role="img" aria-label="' + esc(o.label) + '">' + s + '</svg>';
};
/* 熱度色：依本期最大值分 5 級（藍單一色相），0 為描邊空格 */
function heatLevel(v, max) { if (!v) return 0; var f = v / Math.max(1, max); return f <= .2 ? 1 : f <= .4 ? 2 : f <= .6 ? 3 : f <= .8 ? 4 : 5; }
var HEAT_C = ['', '#C3C8DD', '#98A0C6', '#7882B6', '#4F5B99', '#2C3364'];

/* ---------- 外殼：側欄（桌機）／頂列＋底部分頁（手機）／更多 ---------- */
var NAV = [
  ['overview', '總覽', 'i-home'], ['people', '名單', 'i-people'], ['results', '測驗結果', 'i-quiz'], ['events', '點擊紀錄', 'i-cursor'],
  ['sync', '同步學員', 'i-sync'], ['export', '匯出資料', 'i-download'], ['settings', '設定', 'i-gear']
];
var SECTION_L = { overview: '總覽', people: '名單', results: '測驗結果', events: '點擊紀錄', sync: '同步學員', export: '匯出資料', settings: '設定' };
var VIEWS = {};
function shellHtml() {
  var side = '<aside class="side"><a class="brandmark" href="#/overview" data-root aria-label="回到總覽"><img src="' + IMG.mark + '" alt=""><span><b>總覽後台</b><small>G.R.A.C.E 全平台</small></span></a>' +
    '<nav class="sidenav" aria-label="後台選單">' + NAV.map(function (n, i) {
      return (i === 4 ? '<div class="grp-l" aria-hidden="true">工具</div>' : '') + '<a href="#/' + n[0] + '" data-root data-nav="' + n[0] + '">' + ic(n[2]) + '<span>' + n[1] + '</span>' + (n[0] === 'results' ? '<span class="cnt" data-und hidden></span>' : '') + '</a>';
    }).join('') + '</nav>' +
    '<div class="side-foot"><button class="fresh-b" type="button" data-refresh aria-label="重新整理資料">' + ic('i-redo') + '<span>資料時間 <b class="en" data-fresh>—</b></span></button>' +
    '<span data-syncfoot>' + syncFoot() + '</span>' +
    '<div class="who"><span class="av" aria-hidden="true">校</span><span><b>校長</b><small data-melabel>這台裝置</small></span></div>' +
    '<div class="side-acts"><a class="logout" href="' + FRONT + '" target="_blank" rel="noopener">' + ic('i-ext') + '查看前台</a><button class="logout" type="button" data-act="logout">' + ic('i-logout') + '登出這台裝置</button></div></div></aside>';
  var tabbar = '<nav class="tabbar t5" aria-label="主要分頁">' + NAV.slice(0, 4).map(function (n) { return '<a href="#/' + n[0] + '" data-root data-nav="' + n[0] + '">' + ic(n[2]) + '<span>' + n[1] + '</span>' + (n[0] === 'results' ? '<span class="cnt" data-und hidden></span>' : '') + '</a>'; }).join('') +
    '<button type="button" data-more-sheet data-nav="more" aria-haspopup="dialog" aria-expanded="false">' + ic('i-more') + '<span>更多</span></button></nav>';
  return '<div class="shell"><header class="mbar" id="mbar"></header>' + side + '<main class="main" id="main" tabindex="-1"></main>' + tabbar + '</div>';
}
function syncFoot() { var ls = state.me && state.me.lastSync; return '學員同步 <b class="en">' + (ls ? fMDHM(ls.at) : '尚未') + '</b>' + (ls ? '・<span class="en">' + fmt(ls.n) + '</span> 筆' : ''); }
function ensureShell() { if (!$('.shell')) { $('#app').innerHTML = shellHtml(); paintFresh(); paintUnd(); paintMe(); } }
function setNav(sec) {
  var more = ['sync', 'export', 'settings'].indexOf(sec) >= 0;
  $$('[data-nav]').forEach(function (a) { var on = a.dataset.nav === sec || (more && a.dataset.nav === 'more'); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
}
function freshText() { return state.dataAt ? fMDHM(state.dataAt) : '—'; }
function paintFresh() { $$('[data-fresh]').forEach(function (e) { e.textContent = freshText(); }); }
function paintMe() { var l = $('[data-melabel]'); if (l && state.me) l.textContent = '這台裝置・' + (state.me.label || '—'); var s = $('[data-syncfoot]'); if (s) s.innerHTML = syncFoot(); }
function paintUnd() { var n = state.und ? state.und.rows.length : 0; $$('[data-und]').forEach(function (e) { e.hidden = !n; e.textContent = n; e.setAttribute('aria-label', '未送達 ' + n + ' 份'); }); }
function setMbar(r, detail) {
  var mb = $('#mbar'); if (!mb) return;
  var title = detail ? PAGE.label : SECTION_L[PAGE.section] || '總覽後台';
  mb.innerHTML = (detail ? '<button class="ibtn bk" type="button" data-back aria-label="返回">' + ic('i-arrow') + '</button><span class="ttl">' + esc(title) + '</span>'
    : '<a class="mbrand" href="#/overview" data-root aria-label="回到總覽"><img src="' + IMG.mark + '" alt=""><b>' + esc(title) + '</b></a>') +
    '<span class="sp"></span><button class="fresh-b m" type="button" data-refresh aria-label="重新整理資料（資料時間 ' + esc(freshText()) + '）">' + ic('i-redo') + '<span class="en" data-fresh>' + esc(freshText()) + '</span></button>';
}
/* 資料時間＝資料中心最新一筆事件的時間（不是本機時鐘） */
async function loadDataAt() {
  try {
    var d = await apiC('admin.events', { range: '7d', size: 1 });
    if (!(d.rows && d.rows[0])) d = await apiC('admin.events', { range: 'all', size: 1 });
    state.dataAt = d.rows && d.rows[0] ? d.rows[0].t : null;
  } catch (e) { }
  paintFresh();
}
document.addEventListener('click', async function (e) {
  var b = e.target.closest('[data-refresh]'); if (!b) return;
  if (b.getAttribute('aria-busy') === 'true') return;
  b.setAttribute('aria-busy', 'true');
  flushCache(); state.und = null;
  try { await loadDataAt(); await render({ keep: true }); loadUnd(); toast('資料已更新・資料時間 ' + freshText()); } finally { b.removeAttribute('aria-busy'); }
});
/* 登出這台裝置：先到資料中心撤銷這一組 token（連不上就只清本機），再清掉本機 token */
var loggingOut = false;
document.addEventListener('click', async function (e) {
  var a = e.target.closest('[data-act="logout"]'); if (!a || loggingOut) return; e.preventDefault(); closeSheet(true);
  loggingOut = true; a.setAttribute('aria-busy', 'true');
  try { var ss = await api('admin.sessions'); var me = (ss.sessions || []).filter(function (s) { return s.me; })[0]; if (me) await api('admin.removeSession', { id: me.id }); } catch (err) { }
  loggingOut = false;
  AT = ''; store.del('gh.at'); state.me = null; flushCache(); toast('已登出這台裝置'); history.replaceState({ k: newKey(), d: 0, trail: [] }, '', '#/overview'); render({});
});

/* 手機「更多」：底部面板（對話框），Esc／點遮罩關閉，焦點回到觸發鍵 */
function openSheet() {
  if ($('.sheet')) return;
  var ls = state.me && state.me.lastSync, btn = $('[data-more-sheet]');
  var it = function (h, icn, t, s, extra) { return '<a class="it" href="' + h + '"' + (extra || ' data-root') + '><span class="ic">' + ic(icn) + '</span><span>' + t + '<small>' + s + '</small></span>' + ic('i-chev') + '</a>'; };
  var wrap = document.createElement('div'); wrap.className = 'sheet-w';
  wrap.innerHTML = '<div class="scrim" data-close></div><div class="sheet" role="dialog" aria-modal="true" aria-label="更多"><div class="grab" aria-hidden="true"></div><h2>更多</h2>' +
    it('#/sync', 'i-sync', '同步學員', ls ? '上次 ' + fMDHM(ls.at) + '・' + fmt(ls.n) + ' 筆' : '尚未同步') +
    it('#/export', 'i-download', '匯出資料', '名單・事件・作答') +
    it('#/settings', 'i-gear', '設定', '登入裝置・後台密碼・判定規則・連線狀態') +
    it(FRONT, 'i-ext', '查看前台', '另開新分頁', ' target="_blank" rel="noopener"') +
    '<button class="it danger" type="button" data-act="logout"><span class="ic">' + ic('i-logout') + '</span><span>登出這台裝置<small>只登出這台裝置</small></span>' + ic('i-chev') + '</button></div>';
  document.body.appendChild(wrap); document.body.classList.add('sheet-open');
  if (btn) btn.setAttribute('aria-expanded', 'true');
  var first = wrap.querySelector('.it'); if (first) first.focus();
  wrap.addEventListener('click', function (e) { if (e.target.closest('[data-close]')) closeSheet(); });
  wrap.addEventListener('keydown', function (e) { if (e.key !== 'Tab') return; var f = $$('a,button', wrap.querySelector('.sheet')), i = f.indexOf(document.activeElement); if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); } });
}
function closeSheet(silent) {
  var w = $('.sheet-w'); if (!w) return; w.remove(); document.body.classList.remove('sheet-open');
  var btn = $('[data-more-sheet]'); if (btn) { btn.setAttribute('aria-expanded', 'false'); if (!silent) btn.focus(); }
}
document.addEventListener('click', function (e) { if (e.target.closest('[data-more-sheet]')) openSheet(); });

/* ---------- 未送達結果：答到最後一題、卻沒有對應的完成測驗（資料中心沒收到 quiz.result） ----------
   規格沒有直接的 op；以 admin.events（n=quiz_q,quiz_done，近 30 天）在後台端比對，最多讀 25 頁 × 200 筆 */
var UND_RANGE = '30d', UND_PAGES = 25;
var undP = null;
function loadUnd() {
  if (undP) return undP;
  undP = (async function () {
    var q = { range: UND_RANGE, n: 'quiz_q,quiz_done', size: 200 }, rows = [], pages = 1, truncated = false;
    for (var p = 0; p < pages && p < UND_PAGES; p++) { var d = await apiC('admin.events', Object.assign({}, q, { page: p })); pages = d.pages || 1; rows = rows.concat(d.rows || []); }
    if (pages > UND_PAGES) truncated = true;
    var by = {};
    rows.slice().reverse().forEach(function (e) { var k = e.who + '|' + e.k; (by[k] || (by[k] = [])).push(e); });
    var out = [];
    Object.keys(by).forEach(function (k) {
      var evs = by[k], dones = evs.filter(function (e) { return e.n === 'quiz_done'; }), run = {};
      evs.forEach(function (e, i) {
        if (e.n !== 'quiz_q') return;
        var qn = Number(String(e.v).split(':')[0]); run[qn] = 1;
        var last = e.k === 'ability' ? 14 : 12;
        if (qn !== last) return;
        var ok = dones.some(function (x) { return x.t >= e.t - 5 * 60e3 && x.t <= e.t + 30 * 60e3; });
        if (!ok) out.push({ who: e.who, name: e.name, src: e.src, loggedIn: e.loggedIn, student: e.student, kind: e.k, t: e.t, did: e.did, sid: e.sid, os: e.os, br: e.br, answered: Object.keys(run).length });
        run = {};
      });
    });
    out.sort(function (a, b) { return b.t - a.t; });
    state.und = { rows: out, scanned: rows.length, truncated: truncated, at: Date.now() };
    paintUnd();
    return state.und;
  })();
  undP.catch(function () { undP = null; });
  return undP;
}

/* ---------- 畫面 ---------- */
var SEQ = 0;
function pageWrap(html, still) { return '<div class="page' + (still ? ' still' : '') + '">' + html + '</div>'; }
async function render(opts) {
  opts = opts || {}; var my = ++SEQ; hideTip();
  if (!AT) { await loginPage(); return; }
  var r = route();
  if (r.v === 'login' || !VIEWS[r.v]) { history.replaceState(hst(), '', '#/overview'); r = route(); }
  var V = VIEWS[r.v];
  ensureShell(); setNav(V.section || r.v);
  if (!undP) loadUnd();
  var main = $('#main'), keepY = opts.keep ? window.scrollY : null, done = false, data, err;
  var p = Promise.resolve().then(function () { return V.load(r); }).then(function (d) { data = d; done = true; }, function (e) { err = e; done = true; });
  await Promise.race([p, sleep(0)]);
  PAGE = { label: V.label(null, r), section: V.section || r.v };
  var detail = !!((hst() || {}).trail || []).length || r.v === 'person';
  if (!done) {
    main.innerHTML = pageWrap((detail ? backRow() : '') + V.skeleton(r), opts.keep); setMbar(r, detail);
    if (!opts.keep && !opts.restore) window.scrollTo({ top: 0, behavior: 'instant' });
    await p;
  }
  if (my !== SEQ) return;
  if (err) {
    if (err.code === 'UNAUTHORIZED') { AT = ''; store.del('gh.at'); toast('登入已失效，請重新登入', true); render({}); return; }
    main.innerHTML = pageWrap((detail ? backRow() : '') + titleRow(SECTION_L[PAGE.section] || '') + '<section class="pn"><div class="errb">' + ic('i-warn') + '<span><b>這一頁讀取失敗</b>' + esc(err.msg || err.message || err) + (state.dataAt ? '・資料時間 ' + esc(freshText()) : '') + '</span><button class="btn-s gl gl-clear" type="button" data-refresh>重試</button></div></section>');
    setMbar(r, detail); return;
  }
  PAGE = { label: V.label(data, r), section: V.section || r.v };
  main.innerHTML = pageWrap((detail ? backRow() : '') + V.html(data, r), opts.keep || opts.restore);
  setMbar(r, detail);
  document.title = PAGE.label + '｜G.R.A.C.E 總覽後台';
  if (V.after) V.after(main, data, r);
  drawCharts(main);
  var to = function (y) { window.scrollTo({ top: y, left: 0, behavior: 'instant' }); };
  if (opts.restore) to(SCROLL[curKey] || 0);
  else if (keepY !== null) to(keepY);
  else to(0);
  lastY = window.scrollY;
  if (!opts.keep && !opts.restore) { var h1 = main.querySelector('h1'); var ae = document.activeElement; if (h1 && ae && ae !== document.body && !ae.closest('.main')) h1.focus({ preventScroll: true }); }
  announce(PAGE.label);
}
var rsT; window.addEventListener('resize', function () { clearTimeout(rsT); rsT = setTimeout(function () { var m = $('#main'); if (m) drawCharts(m); }, 120); });

/* ---------- 登入／首次設定 ---------- */
async function loginPage() {
  var st = state.status;
  if (!st) { try { st = state.status = await api('admin.status'); } catch (e) { shellError(e); return; } }
  var setup = !st.setup;
  var eye = '<button class="eye" type="button" data-eye aria-label="顯示密碼">' + ic('i-eye') + '</button>';
  document.title = '登入｜G.R.A.C.E 總覽後台';
  $('#app').innerHTML = '<main class="login"><form class="lg-card" id="lf" novalidate><img class="logo" src="' + IMG.logo + '" alt="G.R.A.C.E Academy"><h1>總覽後台</h1><p class="cap2">G.R.A.C.E 全平台總覽</p>' +
    (setup ? (st.setupOpen
      ? '<p class="intro"><b>首次設定</b>　這個資料中心還沒有後台密碼。請設定一組至少 8 碼的密碼；密碼只存雜湊在 Google Apps Script，程式碼與試算表裡都不會出現。</p>' +
        '<div class="fld"><label for="pw">設定後台密碼</label><div class="inp"><input id="pw" type="password" autocomplete="new-password" placeholder="至少 8 碼" required>' + eye + '</div><div class="strength" aria-hidden="true"><i></i><i></i><i></i><i></i></div></div>' +
        '<div class="fld"><label for="pw2">再輸入一次</label><div class="inp"><input id="pw2" type="password" autocomplete="new-password" placeholder="再輸入一次" required>' + eye + '</div></div>'
      : '<p class="msg bad">首次設定的時間已過（部署後 30 分鐘內）。請到 Apps Script 的專案設定 → 指令碼屬性，新增 <b>SETUP_OPEN</b>＝<b>1</b>，再重新整理這一頁。</p>')
      : '<div class="fld"><label for="pw">後台密碼</label><div class="inp"><input id="pw" type="password" autocomplete="current-password" placeholder="輸入後台密碼" required autofocus>' + eye + '</div></div>') +
    (setup && !st.setupOpen ? '' : '<label class="chk"><input type="checkbox" id="rm" checked><span class="bx">' + ic('i-check') + '</span><span>記住此裝置<small>（一年）</small></span></label>' +
      '<div id="lmsg" role="alert" hidden></div>' +
      '<button class="cta cta-main gl gl-ink" type="submit" id="lgo"><span>' + (setup ? '設定並進入後台' : '進入後台') + '</span><span class="go">' + ic('i-arrow') + '</span></button>') +
    '<p class="lg-foot">資料存放於學院 Google 雲端硬碟<br>共用電腦請取消勾選「記住此裝置」' + (MOCK ? '<br><span style="color:var(--champagne-ink)">預覽模式：' + (setup ? '可設定任意密碼，或' : '') + '登入密碼 demo2026</span>' : '') + '</p></form></main>';
  var f = $('#lf');
  f.querySelectorAll('[data-eye]').forEach(function (b) { b.addEventListener('click', function () { var i = b.parentNode.querySelector('input'); i.type = i.type === 'password' ? 'text' : 'password'; b.setAttribute('aria-label', i.type === 'password' ? '顯示密碼' : '隱藏密碼'); }); });
  var pw = $('#pw'); if (pw && setup) pw.addEventListener('input', function () { var v = pw.value, s = (v.length >= 8) + (v.length >= 12) + (/[A-Z]/.test(v) && /[a-z]/.test(v)) + (/\d/.test(v) && /[^A-Za-z0-9]/.test(v)); f.querySelectorAll('.strength i').forEach(function (i, k) { i.classList.toggle('on', k < s); }); });
  var busy = false;
  f.addEventListener('submit', async function (e) {
    e.preventDefault(); var m = $('#lmsg'), btn = $('#lgo'); if (!pw || busy) return;
    var v = pw.value;
    if (v.length < 8) return showMsg(m, '密碼至少 8 碼', true);
    if (setup && v !== $('#pw2').value) return showMsg(m, '兩次輸入的密碼不一樣', true);
    busy = true; btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.querySelector('.go').innerHTML = '<span class="spin"></span>'; showMsg(m, setup ? '正在推導金鑰並建立密碼…' : '正在驗證…');
    try {
      var keys = await window.HubCrypto.deriveKeys(v, st.pwSalt);
      var res = await api(setup ? 'admin.setup' : 'admin.login', { pwKey: keys.pwKey, bmKey: keys.bmKey, label: deviceLabel() });
      AT = res.at; store.set('gh.at', AT, $('#rm').checked); state.status = null; state.me = await api('admin.me');
      toast(setup ? '密碼已設定，歡迎進入後台' : '歡迎回來');
      if (route().v === 'login') history.replaceState(hst(), '', '#/overview');
      loadDataAt(); render({});
    } catch (err) {
      var text = err.msg || err.message || '失敗';
      if (err.code === 'NET' && setup) {
        try { var st2 = await api('admin.status'); if (st2.setup && !st2.setupOpen) { state.status = st2; toast('密碼已建立，請用剛才輸入的密碼登入'); loginPage(); return; } } catch (e2) { }
        text = NET_MSG + '；若再出現，請重新整理後再設定一次';
      }
      showMsg(m, text, true); busy = false; btn.disabled = false; btn.removeAttribute('aria-busy'); btn.querySelector('.go').innerHTML = ic('i-arrow');
    }
  });
}
function showMsg(el, t, bad) { el.hidden = false; el.className = 'msg' + (bad ? ' bad' : ''); el.textContent = t; }
function shellError(e) { $('#app').innerHTML = '<main class="login"><div class="lg-card"><img class="logo" src="' + IMG.logo + '" alt="G.R.A.C.E Academy"><h1>總覽後台</h1><p class="msg bad" role="alert">連不上資料中心：' + esc(e.msg || e.message || e) + '</p><button class="cta cta-main gl gl-ink" type="button" onclick="location.reload()"><span>重新整理</span><span class="go">' + ic('i-redo') + '</span></button></div></main>'; }

async function boot() {
  ensureState();
  if (MOCK && window.HubCrypto && window.HubMock) { try { var k = await window.HubCrypto.deriveKeys('demo2026', 'bW9jay1zYWx0'); window.HubMock.demoKey = k.pwKey; } catch (e) { } }
  if (AT) {
    try { state.me = await api('admin.me'); } catch (e) { if (e.code === 'UNAUTHORIZED') { AT = ''; store.del('gh.at'); } else { shellError(e); return; } }
    if (AT) { ensureShell(); paintMe(); loadDataAt(); }
  }
  render({ restore: true });
}

/* ---------- 總覽：期間指標・動線漏斗・完成趨勢・結果分布・點擊排行〔入口鍵・現在列・外連去向・頁尾〕・分時熱度 ---------- */
VIEWS.overview = {
  section: 'overview',
  label: function () { return '總覽'; },
  load: function (r) { return apiC('admin.overview', { range: ovRange(r) }); },
  skeleton: function (r) { return titleRow('總覽', '', rangeTabs(r, ovRange(r))) + skelPn(64) + skelPn(110) + skelPn(260) + '<div class="grid12"><div class="c7">' + skelPn(280) + '</div><div class="c5">' + skelPn(280) + '</div></div>'; },
  html: function (o, r) {
    var R = ovRange(r), rl = RANGE_L[R], prevL = { today: '昨日', '7d': '前 7 天', '30d': '前 30 天' }[R];
    var head = titleRow('總覽', '<span class="en">' + rangeText(o) + '</span>', rangeTabs(r, R) + freshStamp());
    /* 本期重點 */
    var f = o.finding || {};
    var find = '<div class="find"><span class="k">' + ({ today: '今日重點', '7d': '本期重點', '30d': '本期重點' }[R]) + '</span><p>' + esc(f.text || '').replace(/(\d+)\s*(人|%)/g, '<b>$1 $2</b>').replace(/<b>(\d+) %<\/b>/g, '<b>$1%</b>') + '</p>' +
      (f.q ? '<a class="gl gl-ink cta" href="' + esc(qHref(f.q)) + '"><span>看流失名單</span><span class="go">' + ic('i-arrow') + '</span></a>' : '') + '</div>';
    /* 期間指標 */
    var kpis = '<section class="pn kpis v11" aria-label="期間指標">' + o.kpi.map(function (k) {
      var unit = k.u || '次', d = k.d;
      var delta = d !== undefined ? '<span class="' + (d > 0 ? 'up' : d < 0 ? 'ng' : '') + '">' + (d ? ic(d > 0 ? 'i-tri-up' : 'i-tri-dn') : '') + (d > 0 ? '+' : d < 0 ? '−' : '±') + fmt(Math.abs(d)) + '</span><span>較' + prevL + '</span>' : '<span>' + esc(k.note || '') + '</span>';
      return '<div class="kpi' + (k.done ? ' done' : '') + '"><div class="l">' + esc(k.l) + '</div><div class="v">' + dd('<span class="en">' + fmt(k.v) + '</span><small>' + unit + '</small>', qHref(k.q), 'big', k.l + ' ' + fmt(k.v) + ' ' + unit + '，查看明細') + '</div><div class="d">' + delta + '</div>' + (d !== undefined && k.note ? '<div class="d">' + esc(k.note) + '</div>' : '') + '</div>';
    }).join('') + '</section>';
    /* 漏斗 */
    var F = o.funnel, mx = Math.max(1, F[0].v), worst = 0;
    F.forEach(function (s, i) { if (i && (F[i - 1].v - s.v) > 0 && (!worst || F[i - 1].v - s.v > F[worst - 1].v - F[worst].v)) worst = i; });
    var fn = '<div class="fn">' + F.map(function (s, i) {
      var hgt = Math.max(s.v ? 4 : 0, s.v / mx * 150), g = i ? F[i - 1].v / mx * 150 : 0, lost = i ? F[i - 1].v - s.v : 0, done = s.n === 'quiz_done';
      return '<div class="col' + (done ? ' done' : '') + '"><a class="plot" href="' + esc(qHref(s.q)) + '" tabindex="-1" aria-hidden="true" data-tip="' + esc(s.label + '・' + fmt(s.v) + ' 人<div class=go>看這 ' + fmt(s.v) + ' 人的名單</div>') + '">' + (i ? '<span class="ghost" style="--g:' + g + 'px;--h:' + hgt + 'px"></span>' : '') + '<span class="bar" style="--h:' + hgt + 'px"></span></a>' +
        '<div class="nm">' + esc(s.label) + '</div><div class="ct">' + dd('<span class="en">' + fmt(s.v) + '</span><small>人</small>', qHref(s.q), '', s.label + ' ' + fmt(s.v) + ' 人，查看名單') + '</div>' +
        '<div class="rt">' + (i ? '上一步的 <b>' + s.rate + '%</b>' : '本期獨立訪客') + '</div>' +
        (i ? '<a class="drop' + (i === worst ? ' worst' : '') + '" href="' + esc(qHref(s.qDrop)) + '" aria-label="' + esc(F[i - 1].label + ' 到 ' + s.label + ' 流失 ' + lost + ' 人，查看名單') + '">流失 −' + fmt(lost) + ic('i-chev') + '</a>' : '<span class="drop-sp"></span>') + '</div>';
    }).join('') + '</div>';
    var fnm = '<div class="fnm">' + F.map(function (s, i) {
      var lost = i ? F[i - 1].v - s.v : 0, done = s.n === 'quiz_done';
      return '<div class="r' + (done ? ' done' : '') + '"><span class="nm">' + esc(s.label) + '</span><span class="trk" aria-hidden="true">' + (i ? '<span class="g" style="width:' + (F[i - 1].v / mx * 100) + '%"></span>' : '') + '<span class="b" style="width:' + (s.v / mx * 100) + '%"></span></span><span class="ct">' + dd('<span class="en">' + fmt(s.v) + '</span>', qHref(s.q), '', s.label + ' ' + fmt(s.v) + ' 人，查看名單') + '</span>' +
        '<span class="sub"><span>' + (i ? '上一步的 <b>' + s.rate + '%</b>' : '本期獨立訪客') + '</span>' + (i ? '<a class="drop' + (i === worst ? ' worst' : '') + '" href="' + esc(qHref(s.qDrop)) + '" aria-label="' + esc(s.label + ' 流失 ' + lost + ' 人，查看名單') + '">流失 −' + fmt(lost) + ic('i-chev') + '</a>' : '') + '</span></div>';
    }).join('') + '</div>';
    var funnel = '<section class="pn"><div class="pn-h"><h2>動線漏斗</h2><span class="s">以獨立訪客計・每一階段與流失都可點開名單</span><span class="r fn-lg"><span><i style="background:var(--r3)"></i>到達</span><span><i class="lost"></i>上一步流失</span><span><i class="gold"></i>完成</span></span></div>' + fn + fnm + '</section>';
    /* 完成趨勢 */
    var tr = o.trend, pts = tr.points || tr.days.map(function (d, i) { return { day: d, ability: tr.ability[i], career: tr.career[i] }; });
    var sA = tr.ability.reduce(function (a, b) { return a + b; }, 0), sC = tr.career.reduce(function (a, b) { return a + b; }, 0);
    var trendRange = R === 'today' ? '7d' : R;
    var tcfg = {
      labels: tr.days, label: '每日測驗完成份數',
      series: [{ name: '能力健檢', vals: tr.ability, color: '#4F5B99', hrefs: pts.map(function (p) { return qHref(p.qAbility); }) }, { name: '職涯定位', vals: tr.career, color: '#A85B3C', dash: true, hrefs: pts.map(function (p) { return qHref(p.qCareer); }) }],
      hrefs: pts.map(function (p) { return qHref(p.q); }),
      aria: pts.map(function (p, i) { return (p.day || tr.days[i]) + ' 能力健檢 ' + tr.ability[i] + ' 份、職涯定位 ' + tr.career[i] + ' 份，查看當天作答'; }),
      tips: pts.map(function (p, i) { var t = tr.ability[i] + tr.career[i]; return '<span class="en">' + esc(p.day || tr.days[i]) + '</span><span class="tl"><i style="background:#4F5B99"></i>能力健檢 <b>' + tr.ability[i] + '</b></span><span class="tl"><i style="background:#A85B3C"></i>職涯定位 <b>' + tr.career[i] + '</b></span><div class="go">看當天 ' + t + ' 份作答 →</div>'; })
    };
    var trend = '<section class="pn"><div class="pn-h"><h2>完成趨勢</h2><span class="s">' + (R === 'today' ? '近 7 天・' : '') + '每日完成份數</span><span class="r lg"><span><i style="background:#4F5B99"></i>能力健檢</span><span><i class="dash"></i>職涯定位</span></span></div>' +
      chartSlot('line', Object.assign({ h: isPhone() ? 190 : 214 }, tcfg), '', 'height:' + (isPhone() ? 190 : 214) + 'px') +
      '<div class="rk-tot"><span>能力健檢 ' + dd('<b>' + fmt(sA) + '</b> 份', href('results', '', { tab: 'list', range: trendRange, kind: 'ability' })) + '</span><span>職涯定位 ' + dd('<b>' + fmt(sC) + '</b> 份', href('results', '', { tab: 'list', range: trendRange, kind: 'career' })) + '</span><span>合計 ' + dd('<b>' + fmt(sA + sC) + '</b> 份', href('results', '', { tab: 'list', range: trendRange })) + '</span></div></section>';
    /* 結果分布 */
    var und = state.und ? state.und.rows.length : 0;
    var dist = '<section class="pn"><div class="pn-h"><h2>結果分布</h2><span class="s">' + rl + '</span>' + (und ? '<span class="r">' + dd('未送達 <b class="ngc">' + und + '</b> 份', href('results', '', { tab: 'undelivered' })) + '</span>' : '') + '</div>' + distBlocks(o.dist, { range: R }) + '</section>';
    /* 點擊排行（入口鍵・現在列・頁尾） */
    var G = o.clicks.groups, gk = { key: G[0], now: G[1], foot: G[2] }, rk = ['key', 'now', 'foot'].indexOf(r.p.rk) >= 0 ? r.p.rk : 'key';
    var gsum = function (g) { return g ? g.rows.reduce(function (a, b) { return a + b.v; }, 0) : 0; };
    var cur = gk[rk] || { rows: [] };
    var rank = '<section class="pn"><div class="pn-h"><h2>點擊排行</h2><span class="s">' + rl + '</span></div>' +
      tabs([{ v: 'key', label: '入口鍵', n: gsum(G[0]), href: withP(r, { rk: 'key' }) }, { v: 'now', label: '現在列', n: gsum(G[1]), href: withP(r, { rk: 'now' }) }, { v: 'foot', label: '頁尾', n: gsum(G[2]), href: withP(r, { rk: 'foot' }) }], rk, '點擊排行分類', 'sm rk-tabs') +
      (cur.rows.length ? rankRows(cur.rows, '次') + '<div class="rk-tot"><span>' + esc(cur.name) + '合計 <b>' + fmt(gsum(cur)) + '</b> 次</span>' + (rk === 'key' && F[1].v ? '<span>每位點入口訪客平均 <b>' + (gsum(cur) / F[1].v).toFixed(1) + '</b> 次</span>' : '') + '</div>' : emptyBlock('這段期間還沒有點擊'))
      + '</section>';
    /* 外連去向 */
    var og = G[3] || { rows: [] }, outRows = og.rows || [], showAll = r.p.out === 'all', top = outRows.slice(0, showAll ? outRows.length : 8), dests = o.clicks.dests || [];
    var outs = '<section class="pn"><div class="pn-h"><h2>外連去向</h2><span class="s">離站點擊</span><span class="r">' + dd('<b class="en">' + fmt(o.clicks.outTotal || 0) + '</b> 次', href('events', '', { range: R, n: 'out' })) + '</span></div>' +
      (outRows.length ? rankRows(top, '次', true) + (outRows.length > 8 ? '<a class="more" href="' + esc(withP(r, { out: showAll ? '' : 'all' })) + '">' + (showAll ? '只看前 8 項' : '顯示全部 ' + outRows.length + ' 項') + ic(showAll ? 'i-chev' : 'i-dn') + '</a>' : '') +
        '<div class="rk-tot"><span>最多 <b>' + esc(dests[0] ? dests[0].dest : '—') + '</b> ' + (dests[0] ? pct(dests[0].v, o.clicks.outTotal, 1) : '') + '</span><span>' + dests.length + ' 個去向</span></div>' : emptyBlock('這段期間還沒有外連'))
      + '</section>';
    /* 分時熱度 */
    var hm = o.heat, rows = hm.days.length > 7 ? 7 : hm.days.length, off = hm.days.length - rows, cellQ = {}, hmax = 1;
    (hm.cells || []).forEach(function (c) { cellQ[c.d + '_' + c.h] = c.q; });
    for (var di = off; di < hm.days.length; di++) hm.grid[di].forEach(function (v) { hmax = Math.max(hmax, v); });
    var hg = '<div class="hm7" role="group" aria-label="分時熱度：每小時互動次數">';
    for (var d2 = off; d2 < hm.days.length; d2++) {
      var day = hm.days[d2];
      hg += '<a class="rl" href="' + esc(qHref(day.q)) + '" aria-label="' + esc(day.full + ' 全天互動') + '"><b>' + esc(day.key) + '</b>' + esc(day.wd) + '</a>';
      hm.grid[d2].forEach(function (v, hh) {
        var lv = heatLevel(v, hmax), t = esc(day.key + '（' + day.wd + '）' + hh + ':00–' + (hh + 1) + ':00・' + fmt(v) + ' 次');
        hg += v && cellQ[d2 + '_' + hh] ? '<a class="cl" href="' + esc(qHref(cellQ[d2 + '_' + hh])) + '" style="background:' + HEAT_C[lv] + '" aria-label="' + t + '，查看事件" data-tip="' + t + '<div class=go>看這小時的 ' + fmt(v) + ' 筆事件 →</div>"></a>' : '<span class="cl z" aria-hidden="true"></span>';
      });
    }
    hg += '<span></span>'; for (var hx = 0; hx < 24; hx++) hg += '<span class="xl" aria-hidden="true">' + (hx % 3 ? '' : hx) + '</span>';
    hg += '</div>';
    var pk = hm.peak;
    var heat = '<section class="pn"><div class="pn-h"><h2>分時熱度</h2><span class="s">' + (hm.days.length > 7 ? '最近 7 天・' : '') + '每小時互動次數</span><span class="r hm-lg" aria-hidden="true"><span>0</span><i class="z"></i>' + HEAT_C.slice(1).map(function (c) { return '<i style="background:' + c + '"></i>'; }).join('') + '<span class="en">' + fmt(hmax) + '</span></span></div>' + hg +
      '<div class="hm-sum"><div><div class="l">尖峰時段</div><div class="v">' + (pk ? dd('<span class="en">' + pk.hour + ':00</span>', qHref(pk.q), '', '尖峰 ' + pk.day + ' ' + pk.hour + ':00，查看事件') + '<small>' + esc(pk.day + '（' + pk.wd + '）・' + fmt(pk.v) + ' 次') + '</small>' : '—') + '</div></div>' +
      hm.bands.map(function (b) { return '<div><div class="l">' + esc(b.l) + '</div><div class="v"><span class="en">' + b.v + '%</span><small>' + (b.v <= 1 ? '幾乎無人' : '佔本期互動') + '</small></div></div>'; }).join('') + '</div></section>';
    return head + find + kpis + funnel + '<div class="grid12"><div class="c7">' + trend + '</div><div class="c5">' + dist + '</div></div>' + '<div class="grid12"><div class="c7">' + rank + '</div><div class="c5">' + outs + '</div></div>' + heat;
  }
};
function ovRange(r) { return ['today', '7d', '30d'].indexOf(r.p.range) >= 0 ? r.p.range : 'today'; }
function freshStamp() { return '<button class="fresh-b ph-hide" type="button" data-refresh>' + ic('i-redo') + '<span>資料時間 <b class="en" data-fresh>' + esc(freshText()) + '</b></span></button>'; }
function skelPn(h) { return '<div class="pn skel-pn" aria-hidden="true"><div class="skel" style="width:30%;height:16px"></div><div class="skel" style="height:' + (h || 120) + 'px"></div></div>'; }
/* 排行列：整列是連結（帶到事件清單） */
function rankRows(rows, unit, showDest) {
  var m = Math.max(1, rows[0] ? rows[0].v : 1);
  return '<div class="rks' + (showDest ? ' wide' : '') + '">' + rows.map(function (x, i) {
    return '<a class="rk' + (i ? '' : ' top') + '" href="' + esc(qHref(x.q)) + '" aria-label="' + esc(x.label + (showDest && x.dest ? '（' + x.dest + '）' : '') + ' ' + fmt(x.v) + ' ' + unit + '，查看事件') + '"><span class="n">' + esc(x.label) + (showDest && x.dest && x.dest !== x.label ? '<small>' + esc(x.dest) + '</small>' : '') + '</span><span class="t" style="width:' + (x.v / m * 100) + '%"></span><span class="v"><span class="en">' + fmt(x.v) + '</span><small class="u">' + unit + '</small>' + ic('i-chev') + '</span></a>';
  }).join('') + '</div>';
}
/* 結果分布（總覽與測驗結果共用）：能力健檢 4 階段堆疊條＋職涯定位 6 角色長條，數字可下鑽 */
function distBlocks(dist, base) {
  var st = dist.stages || [], ro = (dist.roles || []).slice(), sA = st.reduce(function (a, b) { return a + b.v; }, 0), sC = ro.reduce(function (a, b) { return a + b.v; }, 0);
  var rq = function (x) { return qHref(x.q); };
  var rmx = Math.max(1, Math.max.apply(null, ro.map(function (x) { return x.v; }).concat([1])));
  return '<div class="subh"><span>能力健檢・4 階段</span>' + dd('<span class="en">' + fmt(sA) + '</span> 份', href('results', '', Object.assign({ tab: 'list', kind: 'ability' }, base))) + '</div>' +
    '<div class="stack" role="img" aria-label="' + esc(st.map(function (s) { return s.label + ' ' + s.v; }).join('、')) + '">' + (sA ? st.map(function (s) { return s.v ? '<span style="flex:' + s.v + ';background:' + STAGE_C[s.label] + '" data-tip="' + esc(s.label + '・' + fmt(s.v) + ' 份（' + pct(s.v, sA) + '）') + '"></span>' : ''; }).join('') : '<span style="flex:1;background:var(--r0)"></span>') + '</div>' +
    '<div class="stk-l">' + st.map(function (s) { return '<div><i style="background:' + STAGE_C[s.label] + '"></i>' + esc(s.label) + '<b>' + dd('<span class="en">' + fmt(s.v) + '</span>', rq(s), '', s.label + ' ' + s.v + ' 份，查看作答') + ' <span class="pc">' + pct(s.v, sA) + '</span></b></div>'; }).join('') + '</div>' +
    '<div class="subh" style="margin-top:18px"><span>職涯定位・6 角色（主角色）</span>' + dd('<span class="en">' + fmt(sC) + '</span> 份', href('results', '', Object.assign({ tab: 'list', kind: 'career' }, base))) + '</div>' +
    ro.map(function (x, i) { return '<div class="hb' + (i || !x.v ? '' : ' top') + '"><span class="n">' + esc(x.label) + '</span><span class="t" style="--c:var(--cr);width:' + (x.v / rmx * 100) + '%"></span><span class="v">' + dd('<span class="en">' + fmt(x.v) + '</span>', rq(x), '', x.label + ' ' + x.v + ' 份，查看作答') + '</span></div>'; }).join('');
}

/* ---------- 名單：訪客名單〔全部・已登入・未登入・已是學員・未入學〕 ---------- */
var PEOPLE_F = [['all', '全部'], ['loggedin', '已登入'], ['anon', '未登入'], ['student', '已是學員'], ['nonstudent', '未入學']];
var FUNNEL_L = { enter: '進站', key: '點入口', tear: '撕票', login_done: '登入', quiz_done: '完成測驗', out: '點外連' };
var SORT_L = { last: '最近到訪', first: '首次到訪', clicks: '點擊數', visits: '到訪數' };
var SEARCH_FOCUS = false;
function peopleQ(r) {
  var p = r.p, q = { range: p.range || (p.day || p.from || p.to ? '' : 'all') };
  ['filter', 'q', 'level', 'status', 'funnelStep', 'funnelDrop', 'day', 'from', 'to', 'sort'].forEach(function (k) { if (p[k]) q[k] = p[k]; });
  if (q.filter === 'guest') q.filter = 'nonstudent';
  if (!q.range) delete q.range;
  return q;
}
VIEWS.people = {
  section: 'people',
  label: function (d, r) { return r.p.funnelDrop ? '流失名單' : r.p.funnelStep ? '漏斗名單' : '名單'; },
  load: function (r) { return apiPages('admin.people', peopleQ(r), r.p.page); },
  skeleton: function () { return titleRow('名單', '訪客名單') + skelPn(60) + skelPn(380); },
  html: function (D, r) {
    var d = D.first, p = r.p, q = peopleQ(r), C = d.counts || {}, filter = q.filter || 'all';
    var head = titleRow('名單', '訪客名單', freshStamp());
    /* 訪客組成（點色塊直接篩選） */
    var nonstu = Math.max(0, (C.loggedin || 0) - (C.student || 0)), tot = C.all || 0;
    var seg = function (n, f, c, l) { return n ? '<a href="' + esc(withP(r, { filter: f })) + '" style="flex:' + n + ';background:' + c + '"' + (filter === f ? ' class="on"' : '') + ' aria-label="' + esc(l + ' ' + n + ' 人，篩選') + '" data-tip="' + esc(l + '・' + fmt(n) + ' 人（' + pct(n, tot) + '）') + '"></a>' : ''; };
    var mix = '<section class="pn"><div class="pn-h"><h2>訪客組成</h2><span class="s">' + esc(RANGE_L[d.range] || rangeText(d)) + '・符合 <span class="en">' + fmt(tot) + '</span> 人</span><span class="r ph-hide">點色塊直接篩選</span></div>' +
      '<div class="mix">' + (tot ? seg(C.anon, 'anon', '#B5B5B1', '未登入') + seg(nonstu, 'nonstudent', 'var(--r3)', '已登入・未入學') + seg(C.student, 'student', '#B8975A', '已登入・已是學員') : '<span style="flex:1;background:var(--r0)"></span>') + '</div>' +
      '<div class="mix-l"><span><i style="background:#B5B5B1"></i>未登入' + dd('<b class="en">' + fmt(C.anon) + '</b>', withP(r, { filter: 'anon' })) + '</span><span><i style="background:var(--r3)"></i>已登入・未入學' + dd('<b class="en">' + fmt(nonstu) + '</b>', withP(r, { filter: 'nonstudent' })) + '</span><span><i style="background:#B8975A"></i>已登入・已是學員' + dd('<b class="en">' + fmt(C.student) + '</b>', withP(r, { filter: 'student' })) + '</span><span>登入率 <b class="en">' + pct(C.loggedin, tot, 1) + '</b></span></div></section>';
    var segs = tabs(PEOPLE_F.map(function (f) { return { v: f[0], label: f[1], n: C[f[0]] || 0, href: withP(r, { filter: f[0] === 'all' ? '' : f[0] }) }; }), filter, '訪客身分', 'flt5');
    var srch = '<form class="srch" role="search" data-search><label class="sr-only" for="pq">搜尋名單</label>' + ic('i-search') + '<input id="pq" type="search" placeholder="搜尋姓名、email、IG、學院帳號" value="' + esc(p.q || '') + '" autocomplete="off" enterkeyhint="search"></form>';
    /* 篩選籌碼 */
    var chips = [];
    if (filter !== 'all') chips.push({ k: '身分', v: (PEOPLE_F.filter(function (f) { return f[0] === filter; })[0] || [0, filter])[1], href: withP(r, {}, ['filter']) });
    if (p.q) chips.push({ k: '搜尋', v: p.q, href: withP(r, {}, ['q']) });
    if (p.funnelStep) chips.push({ k: '漏斗', v: '做到「' + (FUNNEL_L[p.funnelStep] || p.funnelStep) + '」以上', href: withP(r, {}, ['funnelStep']) });
    if (p.funnelDrop) { var fi = Object.keys(FUNNEL_L).indexOf(p.funnelDrop); chips.push({ k: '流失', v: (fi > 0 ? FUNNEL_L[Object.keys(FUNNEL_L)[fi - 1]] + ' → ' : '') + (FUNNEL_L[p.funnelDrop] || p.funnelDrop), href: withP(r, {}, ['funnelDrop']) }); }
    if (p.level) chips.push({ k: '級別', v: p.level, href: withP(r, {}, ['level']) });
    if (p.status) chips.push({ k: '狀態', v: p.status, href: withP(r, {}, ['status']) });
    if (q.range && q.range !== 'all' || p.day || p.from || p.to) chips.push({ k: '期間', v: rangeChipV(r, d), href: withP(r, {}, ['range', 'day', 'from', 'to']) });
    var add = addFilter([
      { label: '級別', opts: (d.levels || []).map(function (l) { return [withP(r, { level: l }), l, l === p.level]; }) },
      { label: '帳號狀態', opts: (d.statuses || []).map(function (l) { return [withP(r, { status: l }), l, l === p.status]; }) },
      { label: '期間', none: '全部期間', opts: [['today', '今日'], ['7d', '近 7 天'], ['30d', '近 30 天'], ['90d', '近 90 天']].map(function (o) { return [withP(r, { range: o[0] }, ['day', 'from', 'to']), o[1], o[0] === q.range]; }) },
      { label: '漏斗進度', none: '不限', opts: Object.keys(FUNNEL_L).map(function (k) { return [withP(r, { funnelStep: k }, ['funnelDrop']), '做到「' + FUNNEL_L[k] + '」以上', k === p.funnelStep]; }) }
    ]);
    var chipHtml = chipRow(chips, add, href('people', '', {}), chips.length ? '篩選存在網址裡，返回時仍套用' : '');
    /* 名單 */
    var sort = '<label class="sort"><span class="sr-only">排序</span><select data-go>' + Object.keys(SORT_L).map(function (k) { return '<option value="' + esc(withP(r, { sort: k === 'last' ? '' : k })) + '"' + ((p.sort || 'last') === k ? ' selected' : '') + '>' + SORT_L[k] + '</option>'; }).join('') + '</select>' + ic('i-dn') + '</label>';
    var exp = '<button class="btn-m gl gl-clear" type="button" data-export="people">' + ic('i-download') + '<span class="bl">匯出這 ' + fmt(d.matched) + ' 人</span></button>';
    var list = '<section class="pn"><div class="tbh"><h2>訪客名單</h2><span class="s">符合 <b class="en">' + fmt(d.matched) + '</b> 人</span><span class="sp"></span>' + sort + (d.matched ? exp : '') + '</div>' +
      (D.rows.length ? '<div class="tbx"><table class="tb v11 ptb"><thead><tr><th>訪客</th><th>登入方式</th><th>身分</th><th>測驗結果</th><th class="num">到訪</th><th class="num">點擊</th><th>最近到訪</th><th>漏斗</th><th class="num">裝置</th><th><span class="sr-only">開啟</span></th></tr></thead><tbody data-rows>' + peopleRows(D.rows) + '</tbody></table></div>' +
        '<div class="plist" data-mrows>' + peopleMRows(D.rows) + '</div>' + pager(D.rows.length, d.matched, '人', D.more)
        : emptyBlock('沒有符合的人', '換個篩選或搜尋字再試。')) + '</section>';
    return head + mix + '<div class="fl-row">' + segs + srch + '</div>' + chipHtml + list;
  },
  after: function (main, D, r) {
    var f = main.querySelector('[data-search]'), inp = f.querySelector('input'), tm;
    /* 邊打邊搜：重畫後焦點留在搜尋框（游標在最後）；同一次搜尋的逐字修改只換掉目前這筆歷程，返回時不會逐字倒帶 */
    var apply = function () { var v = inp.value.trim(); if (v === (r.p.q || '')) return; SEARCH_FOCUS = document.activeElement === inp; go(withP(r, { q: v }), { replace: !!r.p.q && !!v }); };
    f.addEventListener('submit', function (e) { e.preventDefault(); clearTimeout(tm); apply(); });
    inp.addEventListener('input', function () { clearTimeout(tm); tm = setTimeout(apply, 500); });
    if (SEARCH_FOCUS) { SEARCH_FOCUS = false; var L = inp.value.length; inp.focus({ preventScroll: true }); try { inp.setSelectionRange(L, L); } catch (e) { } }
    var ex = main.querySelector('[data-export]'); if (ex) ex.addEventListener('click', function () { exportCsv('people', peopleQ(r), ex); });
    bindMore(main, r, D, function (rows) { main.querySelector('[data-rows]').insertAdjacentHTML('beforeend', peopleRows(rows)); main.querySelector('[data-mrows]').insertAdjacentHTML('beforeend', peopleMRows(rows)); }, function (pg) { return apiC('admin.people', Object.assign({}, peopleQ(r), { page: pg, size: 50 })); }, D.first.matched, '人');
  }
};
function personHref(w) { return href('person', w); }
function peopleRows(rows) {
  return rows.map(function (x) {
    var h = personHref(x.who), ev = function (n) { return href('events', '', { who: x.who, n: n, range: 'all' }); };
    return '<tr class="row" data-href="' + esc(h) + '"><td><div class="ppl">' + avatar(x) + '<span><b><a class="nm" href="' + esc(h) + '">' + esc(x.name) + '</a></b><small>' + esc(x.ig ? '@' + x.ig : x.email || (x.pid ? '—' : x.who.replace(/^d:/, '裝置 '))) + '</small></span></div></td>' +
      '<td>' + srcLabel(x.src) + '</td><td>' + idTag(x) + (x.student ? '<small class="acct">' + esc(x.student.account) + '</small>' : '') + '</td>' +
      '<td class="res">' + (x.ability || x.career ? resChip(x.ability, 'ability') + resChip(x.career, 'career') : '<span class="none">尚未完成</span>') + '</td>' +
      '<td class="num">' + dd(fmt(x.visits), ev('enter'), '', x.name + ' 到訪 ' + x.visits + ' 次') + '</td>' +
      '<td class="num">' + dd(fmt(x.clicks), ev('click'), x.flag ? 'ngc' : '', x.name + ' 點擊 ' + x.clicks + ' 次' + (x.flag ? '（重複點擊）' : '')) + (x.flag ? '<small class="flag">重複點擊</small>' : '') + '</td>' +
      '<td class="en tm">' + fDT(x.last) + '</td><td class="stp">' + esc(x.stepLabel || '—') + '</td><td class="num en">' + fmt(x.devices) + '</td><td class="go">' + ic('i-chev') + '</td></tr>';
  }).join('');
}
function peopleMRows(rows) {
  return rows.map(function (x) {
    return '<a class="prow" href="' + esc(personHref(x.who)) + '">' + avatar(x) + '<b><span class="nm">' + esc(x.name) + '</span>' + (x.pid ? idTag(x) : '') + '</b>' + (resChip(x.ability, 'ability') || resChip(x.career, 'career') || '<span></span>') + ic('i-chev') +
      '<span class="m2"><span class="en">' + fMDHM(x.last) + '</span><span>到訪 <span class="en">' + fmt(x.visits) + '</span></span><span' + (x.flag ? ' class="ngc"' : '') + '>點擊 <span class="en">' + fmt(x.clicks) + '</span></span><span>' + esc(x.stepLabel || '—') + '</span>' + (x.ig ? '<span class="en">@' + esc(x.ig) + '</span>' : '') + '</span></a>';
  }).join('');
}
/* 「再載入」：取下一頁、接在後面、只改網址的 page（不重畫、不跳回頂端） */
function bindMore(main, r, D, append, fetchPage, total, unit) {
  var btn = main.querySelector('[data-more]'); if (!btn) return;
  var page = D.page, shown = D.rows.length;
  btn.addEventListener('click', async function () {
    if (btn.getAttribute('aria-busy') === 'true') return; btn.setAttribute('aria-busy', 'true');
    try {
      var d = await fetchPage(page + 1); page = d.page; shown += d.rows.length; append(d.rows, d);
      setUrl(withP(r, { page: page }));
      var pg = btn.closest('.pager'), more = page < (d.pages || 1) - 1;
      pg.outerHTML = pager(shown, total, unit, more);
      bindMore(main, Object.assign({}, r, { p: Object.assign({}, r.p, { page: page }) }), { page: page, rows: { length: shown } }, append, fetchPage, total, unit);
      announce('已載入 ' + shown + ' ' + unit);
    } catch (e) { toast(e.msg || '載入失敗', true); btn.removeAttribute('aria-busy'); }
  });
}

/* ---------- 個人檔案〔基本身分・學院資料・到訪紀錄・測驗紀錄・裝置紀錄〕 ---------- */
VIEWS.person = {
  section: 'people',
  label: function (d, r) { return d ? d.person.name : '個人檔案'; },
  load: function (r) { return apiC('admin.person', { who: r.arg }); },
  skeleton: function () { return '<div class="pfh"><span class="av xl"></span><div><div class="skel" style="width:160px;height:26px"></div></div></div>' + skelPn(70) + '<div class="grid12"><div class="c8">' + skelPn(300) + '</div><div class="c4">' + skelPn(300) + '</div></div>'; },
  html: function (d, r) {
    var p = d.person, s = d.student, who = p.who, logged = !!p.pid;
    var ev = function (n) { return href('events', '', { who: who, n: n, range: 'all' }); };
    var head = '<div class="pfh">' + avatar(p, 'xl') + '<div><h1 tabindex="-1">' + esc(p.name) + '</h1><div class="meta">' + srcLabel(p.src) + idTag(p) + (p.email ? '<span class="en">' + esc(p.email) + '</span>' : '') + (p.ig ? '<span>IG <span class="en">@' + esc(p.ig) + '</span></span>' : '') + '</div></div>' +
      '<div class="acts"><button class="btn-m gl gl-clear" type="button" data-export="events">' + ic('i-download') + '<span class="bl">匯出此人事件</span></button></div></div>';
    var lastDev = d.devices[0];
    var kinds = {}; d.attempts.forEach(function (a) { kinds[a.kindLabel] = 1; });
    var minis = '<section class="pn kpis minis" aria-label="此人摘要">' +
      '<div class="kpi"><div class="l">到訪</div><div class="v">' + dd('<span class="en">' + fmt(p.visits) + '</span><small>次</small>', ev('enter'), 'big', '到訪 ' + p.visits + ' 次，查看事件') + '</div><div class="d">首次 <span class="en">' + (p.first ? fDate(p.first) : '—') + '</span></div></div>' +
      '<div class="kpi"><div class="l">點擊</div><div class="v">' + dd('<span class="en">' + fmt(p.clicks) + '</span><small>次</small>', ev('click'), 'big' + (p.flag ? ' ngc' : ''), '點擊 ' + p.clicks + ' 次，查看事件') + '</div><div class="d">' + (p.flag ? '<span class="ngc">重複點擊「' + esc(p.flag[0].label) + '」' + p.flag[0].max + ' 次</span>' : '漏斗：' + esc(p.stepLabel || '—')) + '</div></div>' +
      '<div class="kpi done"><div class="l">測驗完成</div><div class="v">' + dd('<span class="en">' + fmt(d.attempts.length) + '</span><small>份</small>', href('results', '', { tab: 'list', who: who, range: 'all' }), 'big', '測驗 ' + d.attempts.length + ' 份，查看作答') + '</div><div class="d">' + (esc(Object.keys(kinds).join('・')) || '尚未完成') + '</div></div>' +
      '<div class="kpi"><div class="l">裝置</div><div class="v">' + dd('<span class="en">' + fmt(d.devices.length) + '</span><small>台</small>', '#devs', 'big', '裝置 ' + d.devices.length + ' 台') + '</div><div class="d">' + (lastDev ? '最近 ' + esc(lastDev.os + '・' + lastDev.br) : '—') + '</div></div></section>';
    /* 測驗紀錄：每一次作答，含逐題答案 */
    var quiz = '<section class="pn"><div class="pn-h"><h2>測驗紀錄</h2><span class="s">' + d.attempts.length + ' 份・最新在前</span>' + (state.und && state.und.rows.some(function (u) { return u.who === who; }) ? '<span class="r">' + dd('<b class="ngc">未送達</b>', href('results', '', { tab: 'undelivered' })) + '</span>' : '') + '</div>' +
      (d.attempts.length ? d.attempts.map(function (a) { return attemptCard(a, true); }).join('') : emptyBlock('尚未完成任何測驗', logged ? '' : '未登入訪客完成的測驗也會出現在這裡。')) + '</section>';
    /* 到訪紀錄：依 sid 分次 */
    var vq = {}; d.visits.forEach(function (v) { vq[v.sid + '|' + v.from] = v; });
    var all = r.p.vis === 'all', shownV = 0, totalV = d.timeline.visits;
    var vt = d.timeline.days.map(function (day) {
      return day.visits.map(function (v) {
        if (!all && shownV >= 3) return ''; shownV++;
        var meta = vq[v.sid + '|' + v.from] || {}, mins = meta.end ? Math.max(1, Math.round((meta.end - meta.start) / 60e3)) : 0;
        return '<div class="vt-v"><div class="hd"><b class="en">' + esc(day.day) + '（' + esc(day.wd) + '）' + esc(v.from) + '</b>' + ic(/iOS|Android/.test(v.os) ? 'i-phone' : 'i-laptop') + '<span>' + esc(v.os + '・' + v.br) + '</span>' + (v.ipMask ? '<span class="en">IP ' + esc(v.ipMask) + '</span>' : '') +
          '<span class="r">' + (meta.q ? dd(fmt(meta.events) + ' 筆事件', qHref(meta.q), '', day.day + ' ' + v.from + ' 這次到訪的事件') + '・' : '') + '停留 ' + (mins ? mins + ' 分' : '不到 1 分') + '</span></div><div class="evs">' + evRows(v.ev) + '</div></div>';
      }).join('');
    }).join('');
    var visits = '<section class="pn"><div class="pn-h"><h2>到訪紀錄</h2><span class="s">' + totalV + ' 次到訪・由新到舊</span></div>' +
      (totalV ? '<div class="lgd" aria-hidden="true">' + [['enter', '進站'], ['btn', '點擊與作答'], ['ok', '完成'], ['view', '畫面']].map(function (l) { return '<span><span class="ic ' + EVI[l[0]][1] + '">' + ic(EVI[l[0]][0]) + '</span>' + l[1] + '</span>'; }).join('') + '</div><div class="vt">' + vt + '</div>' +
        (totalV > 3 ? '<a class="more" href="' + esc(withP(r, { vis: all ? '' : 'all' })) + '">' + (all ? '只看最近 3 次' : '顯示較早的 ' + (totalV - 3) + ' 次到訪') + ic(all ? 'i-chev' : 'i-dn') + '</a>' : '') : emptyBlock('沒有到訪紀錄')) + '</section>';
    /* 基本身分 */
    var basic = '<section class="pn"><div class="pn-h"><h2>基本身分</h2></div><dl class="kv"><dt>登入方式</dt><dd>' + (p.src ? (p.src === 'line' ? 'LINE' : 'Google') : '未登入') + '</dd><dt>顯示名稱</dt><dd>' + esc(p.name) + '</dd><dt>Email</dt><dd class="en">' + esc(p.email || '—') + '</dd><dt>IG</dt><dd class="en">' + (p.ig ? '@' + esc(p.ig) : '—') + '</dd>' +
      '<dt>首次到訪</dt><dd class="en">' + fDT(p.first) + '</dd><dt>最近到訪</dt><dd class="en">' + fDT(p.last) + '</dd><dt>漏斗進度</dt><dd>' + esc(p.stepLabel || '—') + '</dd><dt>訪客編號</dt><dd class="en">' + esc(who) + '</dd></dl>' +
      (logged ? '<form class="igedit" data-ig><label for="igv" class="sr-only">IG 帳號</label><input id="igv" type="text" placeholder="IG 帳號（不含 @）" value="' + esc(p.ig) + '" autocomplete="off" spellcheck="false"><button class="btn-s gl gl-clear" type="submit">儲存 IG</button></form><p class="rule-n">IG 帳號只能來自學員資料或本人自填，不做任何 Instagram 抓取；儲存後重新比對學員。</p>' : '') + '</section>';
    /* 學院資料 */
    var acad = '<section class="pn"><div class="pn-h"><h2>學院資料</h2>' + (s && s.syncedAt ? '<span class="r">同步 <span class="en">' + fMDHM(s.syncedAt) + '</span></span>' : '') + '</div>' +
      (s ? '<dl class="kv"><dt>學院帳號</dt><dd class="en">' + esc(s.account) + '</dd><dt>學員姓名</dt><dd>' + esc(s.name || '—') + '</dd><dt>級別</dt><dd' + (/至尊/.test(s.level) ? ' class="gold"' : '') + '>' + esc(s.level || '—') + '</dd><dt>帳號狀態</dt><dd>' + stDot(s.status) + '</dd><dt>入學日</dt><dd class="en">' + esc(s.regDate || '—') + '</dd><dt>學院 IG</dt><dd class="en">' + (s.ig ? '@' + esc(s.ig) : '—') + '</dd><dt>LINE ID</dt><dd class="en">' + esc(s.lineId || '—') + '</dd></dl>' +
        '<div class="match">' + ic('i-check') + '<span>以 <b>' + (s.by === 'ig' ? 'IG 帳號' : 'Email') + '</b> 與學院名單比對相符。</span></div>'
        : emptyBlock(logged ? '未對應到學員' : '未登入，無法對應', logged ? '以 email、IG 都找不到。可在基本身分填入 IG 帳號再比對。' : '只有登入過的人才能對應學院帳號。')) + '</section>';
    /* 裝置紀錄 */
    var devs = '<section class="pn" id="devs" tabindex="-1"><div class="pn-h"><h2>裝置紀錄</h2><span class="s">' + d.devices.length + ' 台</span></div>' +
      (d.devices.length ? d.devices.map(function (x) { return '<div class="dev2">' + ic(/iOS|Android/.test(x.os) ? 'i-phone' : 'i-laptop') + '<b>' + esc(x.os + '・' + x.br) + '</b><span class="c">' + dd(fmt(x.visits) + ' 次', qHref(x.q), '', x.os + x.br + ' 到訪 ' + x.visits + ' 次，查看事件') + '<br>最近 <span class="en">' + fMD(x.last) + '</span></span><small>' + (x.ips.length ? 'IP ' + x.ips.map(esc).join('、') + '・' : '') + esc(String(x.did).slice(0, 12)) + '</small></div>'; }).join('') : emptyBlock('沒有裝置紀錄')) +
      (d.sameIp.length ? '<div class="match">' + ic('i-globe') + '<span>同一 IP 另有 <b>' + d.sameIp.length + '</b> 位訪客；IP 為輔，可能是同一處 Wi-Fi。<span class="sameip">' + d.sameIp.slice(0, 6).map(function (x) { return '<a class="pchip" href="' + esc(personHref(x.who)) + '">' + esc(x.name === '未登入訪客' ? '未登入 ' + x.who.slice(2, 8) : x.name) + '<span class="en">' + esc(x.ipMask) + '</span></a>'; }).join('') + '</span></span></div>' : '') + '</section>';
    return head + minis + '<div class="grid12"><div class="c8">' + quiz + visits + '</div><div class="c4">' + basic + acad + devs + '</div></div>';
  },
  after: function (main, d, r) {
    var ex = main.querySelector('[data-export]'); if (ex) ex.addEventListener('click', function () { exportCsv('events', { who: d.person.who, range: 'all' }, ex); });
    var f = main.querySelector('[data-ig]'); if (f) f.addEventListener('submit', async function (e) {
      e.preventDefault(); var v = f.querySelector('input').value.trim().replace(/^@/, '');
      if (v && !/^[A-Za-z0-9._]{1,30}$/.test(v)) { toast('IG 帳號格式不對（英數、點、底線，最多 30 碼）', true); return; }
      var b = f.querySelector('button'); b.disabled = true;
      try { await api('admin.setIg', { pid: d.person.pid, ig: v }); flushCache(); toast(v ? '已儲存 IG 帳號，重新比對學員' : '已清除 IG 帳號'); render({ keep: true }); } catch (err) { toast(err.msg || '儲存失敗', true); b.disabled = false; }
    });
    var dv = main.querySelector('a[href="#devs"]'); if (dv) dv.addEventListener('click', function (e) { e.preventDefault(); var t = main.querySelector('#devs'); t.scrollIntoView({ block: 'start' }); t.focus({ preventScroll: true }); });
  }
};
var EVI = { out: ['i-enter', ''], enter: ['i-enter', ''], btn: ['i-tap', 'ink'], ok: ['i-star', 'gold'], view: ['i-eye', 'out'] };
/* 時間軸事件：連續的「作答」併成一列 */
function evRows(evs) {
  var out = [], i = 0;
  while (i < evs.length) {
    var e = evs[i], m = /第 (\d+) 題/.exec(e.x);
    if (m && e.d === 'btn') {
      var j = i; while (j + 1 < evs.length && /第 \d+ 題/.test(evs[j + 1].x) && evs[j + 1].d === 'btn') j++;
      if (j > i) { var kind = /職涯定位/.test(e.x) ? '職涯定位' : '能力健檢'; out.push({ t: e.t, d: 'btn', x: '作答 ' + kind + '<em>' + (j - i + 1) + ' 題・' + e.t + '–' + evs[j].t + '</em>' }); i = j + 1; continue; }
    }
    out.push(e); i++;
  }
  return out.map(function (e) { var k = EVI[e.d] || EVI.btn; return '<div class="ev2"><span class="t en">' + esc(e.t) + '</span><span class="ic ' + k[1] + '">' + ic(k[0]) + '</span><span class="x' + (e.d === 'ok' ? ' ok' : '') + '">' + e.x + '</span></div>'; }).join('');
}
/* 一次作答：雷達（能力）或角色長條（職涯）＋摘要＋逐題答案（可展開） */
function attemptCard(a, withLink) {
  var S = a.summary || {}, isA = a.kind === 'ability';
  var vis, desc;
  if (isA) {
    var vals = ABIL.map(function (k) { return Number(S.scores && S.scores[k]) || 0; }), hi = vals.indexOf(Math.max.apply(null, vals));
    vis = '<div class="rd">' + chartSlot('radar', { axes: ABIL, vals: vals, max: 6, color: '#4F5B99', size: 170, hi: S.scores ? hi : -1, label: '七項能力分數：' + ABIL.map(function (k, i) { return k + ' ' + vals[i]; }).join('、') }, '', 'width:262px;height:178px') + '</div>';
    var si = STAGES.indexOf(a.label);
    desc = '<div class="steps4" aria-hidden="true">' + STAGES.map(function (x, i) { return '<span' + (i <= si ? ' class="on"' : '') + '></span>'; }).join('') + '</div><div class="steps4-l">' + STAGES.map(function (x, i) { return '<span' + (i === si ? ' class="on"' : '') + '>' + x + '</span>'; }).join('') + '</div>' +
      '<p>最強 <b>' + esc(S.top || '—') + '</b>・最需補強 <b>' + esc(S.low || '—') + '</b>・總分 <b class="en">' + fmt(S.total || 0) + '</b> / 42</p>';
  } else {
    var counts = ROLES.map(function (k) { return [k, Number(S.counts && S.counts[k]) || 0]; }).sort(function (x, y) { return y[1] - x[1]; }), cm = Math.max(1, counts[0][1]);
    vis = '<div class="rd rbars" role="img" aria-label="' + esc('各角色選題數：' + counts.map(function (c) { return c[0] + ' ' + c[1]; }).join('、')) + '">' + counts.map(function (c, i) { return '<div class="rbar' + (c[0] === a.label ? ' top' : '') + '"><span class="n">' + c[0] + '</span><span class="t' + (c[0] === a.label || c[0] === S.secondary ? '' : ' lt') + '" style="width:' + (c[1] / cm * 100) + '%"></span><span class="v en">' + fmt(c[1]) + '</span></div>'; }).join('') + '</div>';
    desc = '<p>副角色 <b>' + esc(S.secondary || '—') + '</b>' + (S.counts && S.counts[a.label] !== undefined ? '・12 題中選了 <b class="en">' + S.counts[a.label] + '</b> 題' + esc(a.label) : '') + '</p>';
  }
  var n = a.answers ? a.answers.length : 0;
  return '<div class="qcard"><div class="qv">' + vis + '</div><div class="qd"><div class="k">' + esc(a.kindLabel) + '・<span class="en">' + fDT(a.at) + '</span>・第 <span class="en">' + a.n + '</span> 次' + (a.anon ? '・作答時未登入' : '') + '</div><div class="big">' + esc(a.label) + '</div>' + desc +
    (n ? '<details class="ans"><summary class="more">看 ' + n + ' 題逐題答案' + ic('i-dn') + '</summary>' + answersHtml(a) + '</details>' : '') +
    (withLink ? '<a class="more" href="' + esc(href('results', '', { tab: 'list', who: a.who, range: 'all', kind: a.kind, sel: a.id })) + '">在作答紀錄開啟' + ic('i-arrow') + '</a>' : '') + '</div></div>';
}
/* 題目文字（quiztext.gen.js，建置時由前台 quizdata.js 產生）：{q 題目, opts 選項文字, s 各選項分數｜r 各選項角色} */
function qText(kind, q) { var t = typeof QUIZ_TEXT !== 'undefined' && QUIZ_TEXT[kind]; return (t && t[q - 1]) || null; }
var OPT_L = { ability: ['A', 'B', 'C', 'D'], career: ['A', 'B'] };
/* 逐題答案：題目、所選選項文字、選項晶片（本人所選為實心）；能力健檢另列能力與該題分數，職涯定位列對應角色 */
function answersHtml(a) {
  var isA = a.kind === 'ability';
  return '<div class="qas">' + (a.answers || []).map(function (x) {
    var opts = OPT_L[isA ? 'ability' : 'career'], T = qText(a.kind, x.q), sel = typeof x.opt === 'number' && opts[x.opt] ? x.opt : null, letter = sel === null ? '' : opts[sel];
    var roles = isA ? null : (T ? T.r : []), pickTxt = T && sel !== null ? T.opts[sel] : '';
    var meta = isA ? esc(x.ability || '') + (sel === null ? '・未作答' : '・得 ' + esc(x.score) + ' 分') : (sel === null ? '未作答' : '對應 ' + esc(x.role || (roles && roles[sel]) || ''));
    return '<div class="qa"><span class="no en">Q' + x.q + '</span><span class="q">' + (T ? esc(T.q) : (isA ? esc(x.ability || '') : '職涯定位')) +
      (sel === null ? '' : '<small class="pick"><span class="pl' + (isA ? '' : ' cr') + '" aria-hidden="true">' + letter + '</span>' + (pickTxt ? esc(pickTxt) : '選 ' + letter) + '</small>') +
      '<small>' + meta + '</small></span>' +
      '<span class="opts-w"><span class="opts" aria-label="' + esc('所選 ' + (sel === null ? '未作答' : letter + (pickTxt ? ' ' + pickTxt : ''))) + '">' + opts.map(function (o, i) { var tt = T ? T.opts[i] + (roles ? '（' + roles[i] + '）' : '') : (roles && roles[i]) || ''; return '<span class="opt' + (i === sel ? ' on' + (isA ? '' : ' cr') : '') + '"' + (tt ? ' title="' + esc(tt) + '"' : '') + '>' + o + '</span>'; }).join('') + '</span>' + (isA ? '<span class="sc en">' + (typeof x.score === 'number' ? '+' + x.score : '') + '</span>' : '') + '</span></div>';
  }).join('') + '</div>';
}

/* ---------- 測驗結果〔結果分布・作答紀錄・未送達結果〕 ---------- */
function resultsQ(r) {
  var p = r.p, q = {};
  ['kind', 'label', 'who', 'day', 'from', 'to', 'range'].forEach(function (k) { if (p[k]) q[k] = p[k]; });
  if (!q.day && !q.from && !q.to && !q.range) q.range = '30d';
  return q;
}
VIEWS.results = {
  section: 'results',
  label: function (d, r) { var t = r.p.tab; return t === 'dist' ? '結果分布' : t === 'undelivered' ? '未送達結果' : '作答紀錄'; },
  load: async function (r) {
    var tab = r.p.tab || 'list';
    if (tab === 'undelivered') { var u = await loadUnd(); return { und: u, head: await apiC('admin.results', { range: '30d', size: 1 }) }; }
    if (tab === 'dist') return { dist: await apiC('admin.results', Object.assign({}, resultsQ(r), { size: 1 })) };
    var D = await apiPages('admin.results', resultsQ(r), r.p.page);
    var sel = r.p.sel && !D.rows.some(function (x) { return x.id === r.p.sel; }) ? null : r.p.sel;
    return { list: D, sel: sel };
  },
  skeleton: function (r) { return titleRow('測驗結果', '') + '<div class="grid12"><div class="c5">' + skelPn(420) + '</div><div class="c7">' + skelPn(420) + '</div></div>'; },
  html: function (d, r) {
    var tab = r.p.tab || 'list', q = resultsQ(r), info = d.list ? d.list.first : d.dist || d.head;
    var und = state.und ? state.und.rows.length : (d.und ? d.und.rows.length : null);
    var tb = tabs([{ v: 'dist', label: '結果分布', href: withP(r, { tab: 'dist' }, ['sel']) }, { v: 'list', label: '作答紀錄', n: tab === 'list' ? info.totals.attempts : null, href: withP(r, { tab: 'list' }) }, { v: 'undelivered', label: '未送達結果', n: und, badge: true, href: href('results', '', { tab: 'undelivered' }) }], tab, '測驗結果分頁', 'rs-tabs');
    var head = titleRow('測驗結果', tab === 'undelivered' ? '近 30 天' : '<span class="en">' + rangeText(info) + '</span>', tb);
    if (tab === 'undelivered') return head + undeliveredHtml(d.und);
    /* 篩選籌碼 */
    var p = r.p, chips = [], whoName0 = d.list && d.list.rows[0] && p.who ? d.list.rows[0].name : '';
    if (p.kind) chips.push({ k: '測驗', v: KIND[p.kind] || p.kind, href: withP(r, {}, ['kind', 'label', 'sel']) });
    if (p.label) chips.push({ k: '結果', v: p.label, href: withP(r, {}, ['label', 'sel']) });
    if (p.who) chips.push({ k: '人', v: whoName0 || p.who.replace(/^d:/, '裝置 '), href: withP(r, {}, ['who', 'sel']) });
    if (p.day || p.from || p.to || (p.range && p.range !== '30d')) chips.push({ k: '期間', v: rangeChipV(r, info), href: withP(r, {}, ['range', 'day', 'from', 'to', 'sel']) });
    var add = addFilter([
      { label: '測驗', none: '兩種測驗', opts: [['ability', '能力健檢'], ['career', '職涯定位']].map(function (o) { return [withP(r, { kind: o[0] }, ['label', 'sel']), o[1], o[0] === p.kind]; }) },
      { label: '期間', none: '近 30 天', opts: [['today', '今日'], ['7d', '近 7 天'], ['90d', '近 90 天'], ['all', '全部期間']].map(function (o) { return [withP(r, { range: o[0] }, ['day', 'from', 'to', 'sel']), o[1], o[0] === p.range]; }) }
    ]);
    var chipHtml = chipRow(chips, add, href('results', '', { tab: tab }), chips.length ? '篩選存在網址裡，返回時仍套用' : '');
    if (tab === 'dist') return head + chipHtml + distTab(d.dist, r, q);
    /* 作答紀錄 */
    var L = d.list, rows = L.rows, info2 = L.first, sel = d.sel || (rows[0] && !isPhone() ? rows[0].id : '');
    var st = info2.dist.stages, ro = info2.dist.roles, showSt = p.kind !== 'career', sA = st.reduce(function (a, b) { return a + b.v; }, 0);
    var mini = showSt && sA ? '<div class="lstx"><div class="stack" aria-hidden="true">' + st.map(function (x) { return x.v ? '<span style="flex:' + x.v + ';background:' + STAGE_C[x.label] + '"></span>' : ''; }).join('') + '</div><div class="mix-l">' + st.map(function (x) { return '<span' + (p.label === x.label ? ' class="on"' : '') + '><i style="background:' + STAGE_C[x.label] + '"></i>' + esc(x.label) + dd('<b class="en">' + fmt(x.v) + '</b>', qHref(x.q, { tab: 'list' }), '', x.label + ' ' + x.v + ' 份，篩選') + '</span>'; }).join('') + '</div></div>'
      : (!showSt ? '<div class="lstx"><div class="mix-l">' + ro.map(function (x) { return '<span' + (p.label === x.label ? ' class="on"' : '') + '><i style="background:var(--cr)"></i>' + esc(x.label) + dd('<b class="en">' + fmt(x.v) + '</b>', qHref(x.q, { tab: 'list' }), '', x.label + ' ' + x.v + ' 份，篩選') + '</span>'; }).join('') + '</div></div>' : '');
    var selRow = rows.filter(function (x) { return x.id === sel; })[0];
    var list = '<section class="pn"><div class="pn-h"><h2>作答紀錄</h2><span class="s">' + (p.kind ? esc(KIND[p.kind]) + ' ' : '') + '<span class="en">' + fmt(info2.totals.attempts) + '</span> 份・<span class="en">' + fmt(info2.totals.people) + '</span> 人</span><span class="r"><button class="btn-s gl gl-clear" type="button" data-export="results">' + ic('i-download') + '<span class="bl">匯出</span></button></span></div>' + mini +
      (rows.length ? '<div class="atts" data-rows>' + attRows(rows, sel, r) + '</div>' + pager(rows.length, info2.totals.attempts, '份', L.more) : emptyBlock('沒有符合的作答', '換個篩選或期間再試。')) + '</section>';
    var det = '<section class="pn det ph-hide" aria-live="polite">' + (selRow ? attemptDetail(selRow) : emptyBlock('選一筆作答看詳情')) + '</section>';
    return head + chipHtml + '<div class="grid12 rs"><div class="c5">' + list + '</div><div class="c7">' + det + '</div></div>';
  },
  after: function (main, d, r) {
    var ex = main.querySelector('[data-export]'); if (ex) ex.addEventListener('click', function () { exportCsv('results', resultsQ(r), ex); });
    if (!d.list) return;
    var all = d.list.rows.slice();
    /* 選一筆：只改網址（sel）、換右側詳情；手機在列下方展開 */
    main.addEventListener('click', function (e) {
      var b = e.target.closest('button.att'); if (!b) return;
      var id = b.dataset.id, row = all.filter(function (x) { return x.id === id; })[0]; if (!row) return;
      var open = b.getAttribute('aria-expanded') === 'true' && isPhone();
      $$('button.att', main).forEach(function (x) { x.setAttribute('aria-expanded', 'false'); x.classList.remove('sel'); });
      $$('.acc', main).forEach(function (x) { x.remove(); });
      var cur = route(); setUrl(withP(cur, { sel: open ? '' : id, page: cur.p.page || '' }));
      if (open) return;
      b.setAttribute('aria-expanded', 'true'); b.classList.add('sel');
      if (isPhone()) { b.insertAdjacentHTML('afterend', '<div class="acc">' + attemptDetail(row, true) + '</div>'); drawCharts(b.nextElementSibling); }
      else { var det = main.querySelector('.det'); det.innerHTML = attemptDetail(row); drawCharts(det); }
    });
    if (isPhone() && d.sel) { var b0 = main.querySelector('button.att[data-id="' + d.sel + '"]'); if (b0) { b0.insertAdjacentHTML('afterend', '<div class="acc">' + attemptDetail(all.filter(function (x) { return x.id === d.sel; })[0], true) + '</div>'); } }
    bindMore(main, r, d.list, function (rows) { all = all.concat(rows); main.querySelector('[data-rows]').insertAdjacentHTML('beforeend', attRows(rows, '', r)); }, function (pg) { return apiC('admin.results', Object.assign({}, resultsQ(r), { page: pg, size: 50 })); }, d.list.first.totals.attempts, '份');
  }
};
function attRows(rows, sel, r) {
  return rows.map(function (a) {
    return '<button class="att' + (a.id === sel ? ' sel' : '') + '" type="button" data-id="' + esc(a.id) + '" aria-expanded="' + (a.id === sel) + '">' + avatar(a) + '<b><span class="nm">' + whoName(a) + '</span>' + idTag(a) + '</b><small><span class="en">' + fDT(a.at) + '</span>・' + esc(a.kindLabel) + '・第 <span class="en">' + a.n + '</span> 次' + (a.anon ? '・未登入作答' : '') + '</small>' + resChip(a.label, a.kind).replace('rchip', 'rchip rs') + ic('i-chev', 'go') + '</button>';
  }).join('');
}
/* 一筆作答的詳情：人、雷達＋七項分數（能力）或角色長條（職涯）、逐題答案 */
function attemptDetail(a, compact) {
  var S = a.summary || {}, isA = a.kind === 'ability';
  var who = '<div class="dt-who">' + avatar(a) + '<span><b>' + dd(whoName(a), personHref(a.who), '', '開啟 ' + a.name + ' 的個人檔案') + '</b><small><span class="en">' + fDT(a.at) + '</span>・第 ' + a.n + ' 次' + (a.anon ? '・作答時未登入' : '') + '</small></span>' + idTag(a) + (compact ? '' : '<a class="more" href="' + esc(personHref(a.who)) + '">開啟個人檔案' + ic('i-arrow') + '</a>') + '</div>';
  var top;
  if (isA) {
    var vals = ABIL.map(function (k) { return Number(S.scores && S.scores[k]) || 0; }), mxv = Math.max.apply(null, vals), mnv = Math.min.apply(null, vals), si = STAGES.indexOf(a.label);
    top = '<div class="dt-top' + (S.scores ? '' : ' nosc') + '">' + (!S.scores ? '' : chartSlot('radar', { axes: ABIL, vals: vals, max: 6, color: '#4F5B99', size: 200, hi: S.scores ? vals.indexOf(mxv) : -1, label: '七項能力分數：' + ABIL.map(function (k, i) { return k + ' ' + vals[i]; }).join('、') }, 'rdw', 'width:292px;height:208px')) +
      '<div class="dt-r"><div class="kk">能力健檢結果</div><div class="res-hd"><span class="stage">' + esc(a.label) + '</span><span class="sm">總分 <b class="en">' + fmt(S.total || 0) + '</b> / 42</span></div>' +
      '<div class="steps4" aria-hidden="true">' + STAGES.map(function (x, i) { return '<span' + (i <= si ? ' class="on"' : '') + '></span>'; }).join('') + '</div><div class="steps4-l">' + STAGES.map(function (x, i) { return '<span' + (i === si ? ' class="on"' : '') + '>' + x + '</span>'; }).join('') + '</div>' +
      (S.scores ? '<div class="sc7s">' + ABIL.map(function (k, i) { return '<div class="sc7' + (vals[i] === mxv ? ' hi' : '') + (vals[i] === mnv && mnv !== mxv ? ' lo' : '') + '"><span class="n">' + k + '</span><span class="t" style="width:' + (Math.min(6, vals[i]) / 6 * 100) + '%"></span><span class="v en">' + fmt(vals[i]) + '/6</span></div>'; }).join('') + '</div>' : '<p class="rule-n">這筆沒有分項分數（作答時未登入或舊資料）。</p>') + '</div></div>';
  } else {
    var counts = ROLES.map(function (k) { return [k, Number(S.counts && S.counts[k]) || 0]; }).sort(function (x, y) { return y[1] - x[1]; }), cm = Math.max(1, counts[0][1]);
    top = '<div class="dt-top cr"><div class="rbars wide" role="img" aria-label="' + esc('各角色選題數：' + counts.map(function (c) { return c[0] + ' ' + c[1]; }).join('、')) + '">' + counts.map(function (c) { return '<div class="rbar' + (c[0] === a.label ? ' top' : '') + '"><span class="n">' + c[0] + '</span><span class="t' + (c[0] === a.label || c[0] === S.secondary ? '' : ' lt') + '" style="width:' + (c[1] / cm * 100) + '%"></span><span class="v en">' + fmt(c[1]) + '</span></div>'; }).join('') + '</div>' +
      '<div class="dt-r"><div class="kk">職涯定位結果</div><div class="res-hd"><span class="stage">' + esc(a.label) + '</span><span class="sm">副角色 <b>' + esc(S.secondary || '—') + '</b></span></div></div></div>';
  }
  var n = (a.answers || []).length;
  var ans = n ? '<div class="subh2"><b>逐題答案</b><span class="opt-lg"><span class="opt on' + (isA ? '' : ' cr') + '">' + (isA ? 'D' : 'B') + '</span>本人所選' + (isA ? '・A–D 依題計 0–3 分' : '・兩個選項各對應一個角色') + '</span></div>' + answersHtml(a) : '<p class="rule-n">這筆沒有逐題答案。</p>';
  return (compact ? '' : '<div class="pn-h"><nav class="crumbs" aria-label="位置"><span>作答紀錄</span>' + ic('i-chev') + '<span aria-current="true">' + esc(a.name) + '・<span class="en">' + fMDHM(a.at) + '</span></span></nav></div>') + who + top + ans;
}
/* 結果分布：兩種測驗的分布；指定測驗時另列逐題選項分布 */
function distTab(d, r, q) {
  var base = {}; ['range', 'day', 'from', 'to', 'who'].forEach(function (k) { if (q[k]) base[k] = q[k]; });
  var blocks = '<section class="pn"><div class="pn-h"><h2>結果分布</h2><span class="s"><span class="en">' + fmt(d.totals.attempts) + '</span> 份・<span class="en">' + fmt(d.totals.people) + '</span> 人' + (d.totals.anon ? '・未登入作答 <span class="en">' + fmt(d.totals.anon) + '</span> 份' : '') + '</span></div>' + distBlocks(d.dist, base) + '</section>';
  var qs2 = d.dist.questions;
  var qpn = '<section class="pn"><div class="pn-h"><h2>逐題選項分布</h2>' + (r.p.kind ? '<span class="s">' + esc(KIND[r.p.kind]) + (r.p.label ? '・' + esc(r.p.label) : '') + '</span>' : '') + '</div>' +
    (qs2 ? qDist(qs2, r.p.kind) : '<p class="rule-n">選一種測驗，看每一題各選項被選的次數。</p><div class="row-end" style="justify-content:flex-start">' + [['ability', '能力健檢'], ['career', '職涯定位']].map(function (o) { return '<a class="btn-s gl gl-clear" href="' + esc(withP(r, { kind: o[0] })) + '">' + o[1] + ic('i-arrow') + '</a>'; }).join('') + '</div>') + '</section>';
  return '<div class="grid12"><div class="c5">' + blocks + '</div><div class="c7">' + qpn + '</div></div>';
}
/* 每題一列：選項依序（有序，藍單一色相由淺到深；職涯兩選項用銅色深淺） */
function qDist(qs2, kind) {
  var isA = kind === 'ability', C = isA ? ['#C3C8DD', '#98A0C6', '#5F6AA6', '#2C3364'] : ['#C99A85', '#A85B3C'], L = isA ? ['A', 'B', 'C', 'D'] : ['A', 'B'];
  return '<div class="lgd qlg" aria-hidden="true">' + L.map(function (l, i) { return '<span><i style="background:' + C[i] + '"></i>選項 ' + l + '</span>'; }).join('') + '</div>' + qs2.map(function (x) {
    var tot = x.opts.reduce(function (a, b) { return a + b; }, 0), T = qText(kind, x.q);
    var optT = function (i) { return L[i] + (T && T.opts[i] ? '「' + T.opts[i] + '」' : '') + (isA ? '' : '（' + ((x.roles || [])[i] || '') + '）'); };
    return '<div class="qrow"><span class="no en">Q' + x.q + '</span><span class="qn">' + esc(isA ? x.ability : (x.roles || []).join(' / ')) + '</span><span class="stack sm" role="img" aria-label="' + esc('Q' + x.q + (T ? ' ' + T.q : '') + '：' + x.opts.map(function (v, i) { return optT(i) + ' ' + v; }).join('、')) + '">' + (tot ? x.opts.map(function (v, i) { return v ? '<span style="flex:' + v + ';background:' + C[i] + '" data-tip="' + esc('Q' + x.q + ' 選項 ' + optT(i) + '・' + v + ' 次（' + pct(v, tot) + '）') + '"></span>' : ''; }).join('') : '<span style="flex:1;background:var(--r0)"></span>') + '</span><span class="v en">' + fmt(tot) + '</span>' + (T ? '<span class="qt">' + esc(T.q) + '</span>' : '') + '</div>';
  }).join('');
}
/* 未送達結果：答到最後一題、資料中心卻沒收到 quiz.result */
function undeliveredHtml(u) {
  var rows = u.rows;
  return '<section class="pn"><div class="pn-h"><h2>未送達結果</h2><span class="s"><span class="en">' + rows.length + '</span> 份・近 30 天</span><span class="r">比對 <span class="en">' + fmt(u.scanned) + '</span> 筆作答事件' + (u.truncated ? '（只讀最近 ' + fmt(UND_PAGES * 200) + ' 筆）' : '') + '</span></div>' +
    '<p class="rule-n">判定：同一人答到最後一題（能力健檢第 14 題、職涯定位第 12 題），之後 30 分鐘內沒有「完成測驗」紀錄，代表結果沒有送到資料中心（網路中斷、關掉分頁或送出失敗）。</p>' +
    (rows.length ? '<div class="unds">' + rows.map(function (x) {
      return '<div class="undr">' + avatar(x) + '<b>' + dd(whoName(x), personHref(x.who), '', '開啟 ' + x.name + ' 的個人檔案') + idTag(x) + '</b><span class="rchip"><i style="background:' + (x.kind === 'career' ? 'var(--cr)' : 'var(--ab)') + '"></i>' + esc(KIND[x.kind]) + '</span>' +
        '<small><span class="en">' + fDT(x.t) + '</span>・' + esc(x.os + '・' + x.br) + '・答了 <span class="en">' + x.answered + '</span> 題</small>' +
        '<span class="go2">' + dd('看這次到訪', href('events', '', x.sid ? { sid: x.sid, range: 'all' } : { who: x.who, day: fDate(x.t) }), '', '查看這次到訪的事件') + '</span></div>';
    }).join('') + '</div>' : emptyBlock('近 30 天沒有未送達的結果', '答完最後一題的作答都有送到資料中心。')) + '</section>';
}

/* ---------- 點擊紀錄〔事件清單・重複點擊〔依人・依裝置・依 IP〕〕 ---------- */
var EV_FILTERS = ['n', 'k', 'v', 'u', 'who', 'did', 'ipHash', 'sid', 'hour', 'day', 'from', 'to', 'range'];
var N_L = { click: '點擊（六種）', view: '畫面', enter: '進站', key: '入口鍵', now: '現在列', card: '按鈕', tear: '撕票', login_start: '開始登入', login_done: '登入完成', login_fail: '登入失敗', quiz_q: '作答', quiz_nav: '測驗翻頁', quiz_done: '完成測驗', quiz_retry: '重做測驗', out: '外連', foot: '頁尾', sound: '音效' };
var HEAT_N = 'key,now,card,tear,login_start,login_fail,quiz_q,quiz_retry,out,foot,sound';
var EV_ICON = { enter: 'i-enter', view: 'i-eye', key: 'i-tap', now: 'i-tap', card: 'i-tap', tear: 'i-ticket', login_start: 'i-user', login_done: 'i-user', login_fail: 'i-warn', quiz_q: 'i-quiz', quiz_nav: 'i-quiz', quiz_done: 'i-star', quiz_retry: 'i-redo', out: 'i-ext', foot: 'i-tap', sound: 'i-tap' };
function eventsQ(r) { var q = {}; EV_FILTERS.forEach(function (k) { if (r.p[k] !== undefined && r.p[k] !== '') q[k] = r.p[k]; }); if (!q.day && !q.from && !q.to && !q.range) q.range = '7d'; return q; }
function periodQ(q) { var o = {}; ['day', 'from', 'to', 'range'].forEach(function (k) { if (q[k]) o[k] = q[k]; }); return o; }
function nLabel(n) { if (n === HEAT_N) return '互動（熱度事件）'; return String(n).split(',').map(function (x) { return N_L[x] || x; }).join('、'); }
VIEWS.events = {
  section: 'events',
  label: function (d, r) {
    if (r.p.tab === 'repeat') return '重複點擊';
    var q = r.p, t = '';
    if (d && d.list) { var f = d.list.first.facets.k.filter(function (x) { return x.n === q.n && x.k === q.k; })[0]; if (f && q.k) t = f.label.replace(/^[^・]*・/, ''); }
    if (!t && q.n && !q.k) t = nLabel(q.n);
    if (!t && q.k) t = q.k;
    if (!t && q.who && d && d.list && d.list.rows[0]) t = d.list.rows[0].name + ' 的事件';
    return t ? t + (d && d.list ? ' ' + fmt(d.list.first.totals.events) + ' 筆' : '') : '點擊紀錄';
  },
  load: async function (r) {
    var q = eventsQ(r);
    if (r.p.tab === 'repeat') return { rep: await apiC('admin.repeat', periodQ(q)) };
    var list = apiPages('admin.events', q, r.p.page);
    /* 樣貌摘要：取最近 600 筆（3 頁 × 200）在後台端統計 24 小時、每日、登入身分 */
    var sample = Promise.all([0, 1, 2].map(function (i) { return apiC('admin.events', Object.assign({}, q, { page: i, size: 200 })); }));
    var rep = apiC('admin.repeat', periodQ(q)).catch(function () { return null; });
    var all = await Promise.all([list, sample, rep]), s = all[1], rows = [], seen = {};
    s.forEach(function (x, i) { if (i < (x.pages || 1) && !seen[x.page]) { seen[x.page] = 1; rows = rows.concat(x.rows); } });
    return { list: all[0], sample: { rows: rows, total: s[0].totals.events }, rep: all[2] };
  },
  skeleton: function () { return titleRow('點擊紀錄', '') + '<div class="grid12"><div class="c8">' + skelPn(300) + '</div><div class="c4">' + skelPn(300) + '</div></div>' + skelPn(360); },
  html: function (d, r) {
    var q = eventsQ(r), tab = r.p.tab === 'repeat' ? 'repeat' : 'list';
    var flagged = d.rep ? ['ig', 'device', 'ip'].reduce(function (a, k) { return a + d.rep[k].filter(function (x) { return x.flagged; }).length; }, 0) : null;
    var tb = tabs([{ v: 'list', label: '事件清單', n: d.list ? d.list.first.totals.events : null, href: withP(r, { tab: '' }, ['by']) }, { v: 'repeat', label: '重複點擊', n: d.rep ? d.rep.ig.filter(function (x) { return x.flagged; }).length : null, badge: true, href: withP(r, { tab: 'repeat' }) }], tab, '點擊紀錄分頁');
    var info = d.list ? d.list.first : d.rep;
    var head = titleRow('點擊紀錄', '<span class="en">' + rangeText(d.list ? d.list.first : null) + '</span>', tb);
    if (tab === 'repeat') return head + repeatChips(r, q) + repeatPane(d.rep, r, false);
    var L = d.list, f = L.first, p = r.p, chips = [];
    /* 篩選籌碼：一顆一個條件，可逐一移除 */
    var kf = f.facets.k.filter(function (x) { return x.n === p.n && x.k === p.k; })[0], r0 = L.rows[0] || {};
    if (p.n) chips.push({ k: '事件', v: nLabel(p.n), href: withP(r, {}, ['n', 'k', 'v']) });
    if (p.k) chips.push({ k: '按鈕', v: kf ? kf.label.replace(/^[^・]*・/, '') : p.k, href: withP(r, {}, ['k', 'v']) });
    if (p.v) chips.push({ k: '內容', v: p.v, href: withP(r, {}, ['v']) });
    if (p.u) chips.push({ k: '網址', v: p.u, href: withP(r, {}, ['u']) });
    if (p.who) chips.push({ k: '人', v: r0.who === p.who ? r0.name : p.who.replace(/^d:/, '裝置 '), href: withP(r, {}, ['who']) });
    if (p.did) chips.push({ k: '裝置', v: r0.did === p.did ? r0.os + '・' + r0.br : p.did, href: withP(r, {}, ['did']) });
    if (p.ipHash) chips.push({ k: 'IP', v: r0.ipHash === p.ipHash ? r0.ipMask : 'IP 雜湊', href: withP(r, {}, ['ipHash']) });
    if (p.sid) chips.push({ k: '到訪', v: r0.sid === p.sid ? fMDHM(L.rows[L.rows.length - 1].t) + ' 那次' : p.sid, href: withP(r, {}, ['sid']) });
    if (p.hour !== undefined && p.hour !== '') chips.push({ k: '時段', v: p.hour + ':00–' + (Number(p.hour) + 1) + ':00', href: withP(r, {}, ['hour']) });
    if (p.day || p.from || p.to || (p.range && p.range !== '7d')) chips.push({ k: '期間', v: rangeChipV(r, f), href: withP(r, {}, ['range', 'day', 'from', 'to']) });
    var add = addFilter([
      { label: '事件', none: '全部事件', opts: [['click', '點擊（六種）'], ['view', '畫面']].concat(f.facets.n.map(function (x) { return [x.n, x.label + '（' + fmt(x.v) + '）']; })).map(function (o) { return [withP(r, { n: o[0] }, ['k', 'v']), o[1], o[0] === p.n]; }) },
      { label: '期間', none: '近 7 天', opts: [['today', '今日'], ['30d', '近 30 天'], ['90d', '近 90 天'], ['all', '全部期間']].map(function (o) { return [withP(r, { range: o[0] }, ['day', 'from', 'to']), o[1], o[0] === p.range]; }) }
    ]);
    var chipHtml = chipRow(chips, add, href('events', '', {}), chips.length ? (((hst() || {}).trail || []).length ? '從上一頁帶入的篩選，可逐一移除' : '篩選存在網址裡，返回時仍套用') : '');
    var sum = eventsSummary(d, r, q), rp = d.rep ? repeatPane(d.rep, r, true) : '';
    var exp = '<button class="btn-m gl gl-clear" type="button" data-export="events">' + ic('i-download') + '<span class="bl">匯出這 ' + fmt(f.totals.events) + ' 筆</span></button>';
    var list = '<section class="pn"><div class="tbh"><h2>事件清單</h2><span class="s">共 <b class="en">' + fmt(f.totals.events) + '</b> 筆・最新在前</span><span class="sp"></span>' + (f.totals.events ? exp : '') + '</div>' +
      (L.rows.length ? '<div class="tbx"><table class="tb v11 evt"><thead><tr><th>時間</th><th>人</th><th>事件</th><th>對象</th><th>去向</th><th>裝置</th><th>身分</th><th>學院帳號</th><th><span class="sr-only">開啟</span></th></tr></thead><tbody data-rows>' + evRowsT(L.rows, { day: '' }, r) + '</tbody></table></div>' +
        '<div class="elist" data-mrows>' + evRowsM(L.rows, { day: '' }, r) + '</div>' + pager(L.rows.length, f.totals.events, '筆', L.more) : emptyBlock('沒有符合的事件', '移除一個篩選或換期間再試。')) + '</section>';
    return head + chipHtml + '<div class="grid12"><div class="c8">' + sum + '</div><div class="c4">' + rp + '</div></div>' + list;
  },
  after: function (main, d, r) {
    var ex = main.querySelector('[data-export]'); if (ex) ex.addEventListener('click', function () { exportCsv('events', eventsQ(r), ex); });
    if (!d.list) return;
    var stT = { day: d.list.rows.length ? d.list.rows[d.list.rows.length - 1].day : '' }, stM = { day: stT.day };
    bindMore(main, r, d.list, function (rows) { main.querySelector('[data-rows]').insertAdjacentHTML('beforeend', evRowsT(rows, stT, r)); main.querySelector('[data-mrows]').insertAdjacentHTML('beforeend', evRowsM(rows, stM, r)); }, function (pg) { return apiC('admin.events', Object.assign({}, eventsQ(r), { page: pg, size: 50 })); }, d.list.first.totals.events, '筆');
  }
};
function evWho(e) { var h = personHref(e.who); return '<a class="who' + (e.loggedIn ? '' : ' anon') + '" href="' + esc(h) + '">' + avatar(e) + '<span>' + whoName(e) + '</span></a>'; }
function evKind(e) { return '<span class="ekind' + (e.click ? ' ink' : '') + '"><i aria-hidden="true">' + ic(EV_ICON[e.n] || 'i-tap') + '</i>' + esc(e.ev) + '</span>'; }
function evRowsT(rows, st, r) {
  return rows.map(function (e) {
    var dh = '';
    if (e.day !== st.day) { st.day = e.day; dh = '<tr class="day"><td colspan="9"><b class="en">' + esc(e.day) + '（' + wdOf(e.t) + '）</b>' + (r.p.day === e.day ? '' : dd('只看這天', withP(r, { day: e.day }, ['range', 'from', 'to']))) + '</td></tr>'; }
    return dh + '<tr class="row" data-href="' + esc(personHref(e.who)) + '"><td class="tm en">' + esc(e.hm) + '</td><td>' + evWho(e) + '</td><td>' + evKind(e) + '</td><td class="tg"><b>' + esc(e.target) + '</b>' + (e.v && e.n === 'out' && e.v !== e.target ? '<small>' + esc(e.v) + '</small>' : '') + '</td><td class="dest">' + (e.dest ? dd(esc(e.dest), withP(r, { n: 'out', k: e.k }, ['v'])) : '<span class="none">—</span>') + '</td>' +
      '<td class="dv">' + esc(e.os + '・' + e.br) + '</td><td>' + idTag(e) + '</td><td>' + (e.student ? '<span class="en">' + esc(e.student.account) + '</span>' : '<span class="none">—</span>') + '</td><td class="go">' + ic('i-chev') + '</td></tr>';
  }).join('');
}
function evRowsM(rows, st, r) {
  return rows.map(function (e) {
    var dh = '';
    if (e.day !== st.day) { st.day = e.day; dh = '<div class="eday"><b class="en">' + esc(e.day) + '（' + wdOf(e.t) + '）</b>' + (r.p.day === e.day ? '' : dd('只看這天', withP(r, { day: e.day }, ['range', 'from', 'to']))) + '</div>'; }
    return dh + '<a class="er" href="' + esc(personHref(e.who)) + '"><span class="tm en">' + esc(e.hm) + '</span><b class="' + (e.loggedIn ? '' : 'anon') + '">' + whoName(e) + '</b>' + idTag(e) + '<span class="m2"><span>' + esc(e.ev + '・' + e.target) + '</span>' + (e.dest ? '<span>' + esc(e.dest) + '</span>' : '') + '<span>' + esc(e.os + '・' + e.br) + '</span>' + (e.student ? '<span class="en">' + esc(e.student.account) + '</span>' : '') + '</span></a>';
  }).join('');
}
/* 這個篩選的樣貌：總數＋每日、登入身分、按鈕分布（資料中心 facets）、24 小時分布（每一格都能再往下篩） */
function eventsSummary(d, r, q) {
  var f = d.list.first, S = d.sample.rows, part = S.length < f.totals.events;
  var byDay = {}, hours = [], idc = { stu: 0, non: 0, anon: 0 };
  for (var h = 0; h < 24; h++) hours.push(0);
  S.forEach(function (e) { byDay[e.day] = (byDay[e.day] || 0) + 1; hours[tpe(e.t).h]++; if (e.student) idc.stu++; else if (e.loggedIn) idc.non++; else idc.anon++; });
  var days = Object.keys(byDay).sort().slice(-7), dmx = Math.max(1, Math.max.apply(null, days.map(function (k) { return byDay[k]; }).concat([1]))), hmx = Math.max(1, Math.max.apply(null, hours)), hpk = hours.indexOf(Math.max.apply(null, hours));
  var note = part ? '<p class="rule-n">每日、身分與時段依最近 <span class="en">' + fmt(S.length) + '</span> 筆計算。</p>' : '';
  var col1 = '<div><div class="l">事件</div><div class="big en">' + fmt(f.totals.events) + '<small>筆</small></div><div class="note"><b class="en">' + fmt(f.totals.people) + '</b> 人・<b class="en">' + fmt(f.totals.devices) + '</b> 台裝置・點擊 <b class="en">' + fmt(f.totals.clicks) + '</b></div>' +
    (days.length > 1 ? '<div class="cols7" style="grid-template-columns:repeat(' + days.length + ',minmax(0,1fr))">' + days.map(function (k, i) { var t = k + '・' + byDay[k] + ' 筆'; return '<a href="' + esc(withP(r, { day: k }, ['range', 'from', 'to'])) + '" class="' + (i === days.length - 1 ? 'cur' : '') + '" aria-label="' + esc(t + '，只看這天') + '" data-tip="' + esc(t + '<div class=go>只看這天 →</div>') + '"><i style="height:' + Math.max(4, byDay[k] / dmx * 100) + '%"></i></a>'; }).join('') + '</div><div class="cols7-x" style="grid-template-columns:repeat(' + days.length + ',minmax(0,1fr))" aria-hidden="true">' + days.map(function (k) { return '<span>' + k.slice(8) + '</span>'; }).join('') + '</div>' : '') + '</div>';
  var tot = idc.stu + idc.non + idc.anon, WC = [['已是學員', idc.stu, '#B8975A'], ['未入學', idc.non, 'var(--r3)'], ['未登入', idc.anon, '#B5B5B1']];
  var col2 = '<div><div class="l">登入身分</div><div class="stack" style="height:16px;margin-top:12px" role="img" aria-label="' + esc(WC.map(function (w) { return w[0] + ' ' + w[1]; }).join('、')) + '">' + (tot ? WC.map(function (w) { return w[1] ? '<span style="flex:' + w[1] + ';background:' + w[2] + '"></span>' : ''; }).join('') : '<span style="flex:1;background:var(--r0)"></span>') + '</div>' +
    WC.map(function (w) { return '<div class="hbx id"><span class="n"><i style="background:' + w[2] + '"></i>' + w[0] + '</span><span class="v en">' + fmt(w[1]) + '</span><span class="pc en">' + pct(w[1], tot) + '</span></div>'; }).join('') + '</div>';
  var ks = f.facets.k.filter(function (x) { return !q.n || String(q.n).split(',').indexOf(x.n) >= 0 || (q.n === 'click' && /^(key|now|foot|card|tear|out)$/.test(x.n)); }).slice(0, 6), kmx = Math.max(1, ks[0] ? ks[0].v : 1);
  var col3 = '<div><div class="l">按鈕與事件</div><div class="hbxs">' + (ks.length ? ks.map(function (x) { return '<a class="hbx" href="' + esc(qHref(x.q)) + '" aria-label="' + esc(x.label + ' ' + x.v + ' 筆，篩選') + '"><span class="n">' + esc(x.label) + '</span><span class="t" style="width:' + (x.v / kmx * 100) + '%"></span><span class="v en">' + fmt(x.v) + ic('i-chev') + '</span></a>'; }).join('') : '<p class="rule-n">—</p>') + '</div></div>';
  var hrs = '<div class="hrs"><div class="subh"><span>一天中的時段（每小時筆數）</span>' + (S.length ? dd('尖峰 <span class="en">' + hpk + ':00–' + (hpk + 1) + ':00・' + hours[hpk] + '</span> 筆', withP(r, { hour: hpk })) : '') + '</div>' +
    '<div class="h24">' + hours.map(function (v, hh) { var t = hh + ':00–' + (hh + 1) + ':00・' + v + ' 筆'; return v ? '<a href="' + esc(withP(r, { hour: hh })) + '" class="' + (hh === hpk ? 'pk' : '') + (String(r.p.hour) === String(hh) ? ' on' : '') + '" aria-label="' + esc(t + '，只看這小時') + '" data-tip="' + esc(t + '<div class=go>只看這小時 →</div>') + '"><i style="height:' + Math.max(3, v / hmx * 100) + '%"></i></a>' : '<span aria-hidden="true"></span>'; }).join('') + '</div>' +
    '<div class="h24x" aria-hidden="true">' + hours.map(function (v, hh) { return '<span>' + (hh % 3 ? '' : hh) + '</span>'; }).join('') + '</div></div>';
  return '<section class="pn"><div class="pn-h"><h2>這個篩選的樣貌</h2><span class="s">每個數字都能再往下篩</span></div><div class="sumx">' + col1 + col2 + col3 + '</div>' + hrs + note + '</section>';
}
function repeatChips(r, q) {
  var p = r.p, chips = [];
  if (p.day || p.from || p.to || (p.range && p.range !== '7d')) chips.push({ k: '期間', v: rangeChipV(r, null), href: withP(r, {}, ['range', 'day', 'from', 'to']) });
  return '<div class="fl-row">' + rangeTabs(r, p.day || p.from ? '' : (p.range || '7d'), [['today', '今日'], ['7d', '7 天'], ['30d', '30 天']]) + '</div>' + chipRow(chips, '', '', '');
}
/* 重複點擊：依人／依裝置／依 IP；標記的排前面；每列帶到該列的點擊事件，列內的人帶到個人頁 */
function repeatPane(rp, r, preview) {
  var by = preview ? 'device' : (['ig', 'device', 'ip'].indexOf(r.p.by) >= 0 ? r.p.by : 'ig'), rows = rp[by] || [], show = preview ? rows.slice(0, 3) : rows;
  var BY = [['ig', '依人'], ['device', '依裝置'], ['ip', '依 IP']];
  var seg = preview ? '' : tabs(BY.map(function (b) { return { v: b[0], label: b[1], n: rp[b[0]].filter(function (x) { return x.flagged; }).length || null, badge: true, href: withP(r, { by: b[0] === 'ig' ? '' : b[0] }) }; }), by, '重複點擊角度', 'sm');
  var mx = Math.max(1, rows[0] ? Math.max.apply(null, rows.map(function (x) { return x.tot; })) : 1);
  var list = show.length ? show.map(function (x) {
    var h = qHref(x.q);
    return '<div class="rpt' + (x.flagged ? ' bad' : '') + '"><a class="rpt-a" href="' + esc(h) + '" aria-label="' + esc((x.label || '') + ' ' + x.tot + ' 次點擊，查看事件') + '"><b>' + esc(x.label || '未登入訪客') + (x.sub ? '<small>' + esc(x.sub) + '</small>' : '') + '</b><span class="tot en">' + fmt(x.tot) + '<small>次</small></span>' + ic('i-chev', 'go') + '</a>' +
      '<span class="br" aria-hidden="true" style="width:' + (x.tot / mx * 100) + '%"><span style="flex:' + x.topN + ';background:var(--ab)"></span><span style="flex:' + Math.max(0, x.tot - x.topN) + ';background:var(--r1)"></span></span>' +
      '<span class="why">' + (x.why.bad ? '<b>' + esc(x.why.text) + '</b>' : '最多「' + esc(x.top) + '」<span class="en">' + fmt(x.topN) + '</span> 次') + '・最近 <span class="en">' + fMDHM(x.last) + '</span></span>' +
      (preview ? '' : '<span class="ppl2">' + x.list.slice(0, 6).map(function (w) { return '<a class="pchip' + (w.flagged ? ' bad' : '') + '" href="' + esc(personHref(w.who)) + '">' + esc(w.name === '未登入訪客' ? '未登入 ' + w.who.slice(2, 8) : w.name) + '<span class="en">' + fmt(w.clicks) + '</span></a>'; }).join('') + (x.list.length > 6 ? '<span class="rule-n">等 ' + x.list.length + ' 人</span>' : '') + '</span>') + '</div>';
  }).join('') : emptyBlock('這段期間沒有點擊');
  return '<section class="pn"><div class="pn-h"><h2>重複點擊</h2><span class="s">' + (preview ? '依裝置・' : '') + '10 分鐘內 ≥ 5 次</span></div>' + seg +
    (preview ? '' : '<p class="rule-n">標記規則：' + esc(rp.rule.text) + '（同一顆按鈕＝同一事件與按鈕代號）。長條分段：深＝最常點的那一顆，淺＝其他。IP 只存遮蔽片段與雜湊，僅供參考。</p>') +
    '<div class="rpts">' + list + '</div>' + (preview && rows.length ? '<a class="more" href="' + esc(withP(r, { tab: 'repeat' })) + '">看全部 ' + rows.length + ' 組' + ic('i-arrow') + '</a>' : '') + '</section>';
}

/* ---------- 同步學員〔安裝書籤・執行同步・同步紀錄〕 ---------- */
VIEWS.sync = {
  section: 'sync',
  label: function () { return '同步學員'; },
  load: function () { return apiC('admin.tools', {}); },
  skeleton: function () { return titleRow('同步學員', '') + skelPn(200) + skelPn(140); },
  html: function (d) {
    var ls = d.lastSync;
    var hrefBm = MOCK ? '#' : 'javascript:' + encodeURIComponent((window.HUB_BM_SRC || '').replace('__GAS__', CFG.gas || ''));
    var install = '<section class="pn"><div class="pn-h"><h2>安裝書籤</h2><span class="s">從學院官網後台一鍵帶入學員資料</span></div>' +
      '<div class="bm-zone"><a class="bm gl gl-ink" href="' + esc(hrefBm) + '" draggable="true" id="bmlink" title="學員同步">' + ic('i-grip', 'grip') + '<span class="bk">' + ic('i-book') + '</span>學員同步</a>' +
      '<p class="bm-t">' + (isPhone() ? '書籤需在<b>電腦瀏覽器</b>設定：在電腦開啟這一頁，把這顆按鈕<b>拖曳到書籤列</b>。' : '把「學員同步」這顆按鈕<b>拖曳到瀏覽器的書籤列</b>（不要點它）。') + '</p></div></section>';
    var run = '<section class="pn"><div class="pn-h"><h2>執行同步</h2><span class="s">在學院官網後台操作</span></div>' +
      '<ol class="steps3"><li><span class="sw">' + ic('i-login') + '</span><span><b>登入學院後台</b>開啟「學員列表」頁</span></li><li><span class="sw">' + ic('i-book') + '</span><span><b>點一下書籤</b>自動掃描整份學員列表</span></li><li><span class="sw">' + ic('i-check') + '</span><span><b>輸入一次後台密碼</b>之後記住此電腦，不用再輸入；密碼只用來推導金鑰，不會送出</span></li></ol>' +
      '<p class="rule-n">名單會分批加密上傳；全部收齊才一次換掉正式名單，中途失敗會維持原樣。後台密碼變更後，書籤會自動忘記舊金鑰並重新詢問。</p>' +
      (MOCK ? '<div class="bmp" id="bmdemo"><div class="bmp-h"><b>書籤進度面板（示意）</b><button class="btn-s gl gl-clear" type="button" id="bmplay">播放示範</button></div><div class="bar"><i></i></div><div class="t">在學院後台點書籤後，右下角會出現這個面板：掃描列表 → 輸入後台密碼 → 加密上傳 → 完成。</div></div>' : '') + '</section>';
    var hist = '<section class="pn"><div class="pn-h"><h2>同步紀錄</h2><span class="r"><i class="dotok' + (ls ? '' : ' wait') + '"></i>' + (ls ? '上次同步成功' : '尚未同步') + '</span></div>' +
      (ls ? '<div class="kpis sync">' + [['同步時間', fMDHM(ls.at)], ['學員筆數', fmt(ls.n)], ['新增', fmt(ls.added)], ['更新', fmt(ls.updated)]].map(function (k) { return '<div class="kpi"><div class="l">' + k[0] + '</div><div class="v en">' + k[1] + '</div></div>'; }).join('') + '</div>' +
        '<div class="tbx"><table class="tb v11 hist"><thead><tr><th>時間</th><th class="num">學員</th><th class="num">新增</th><th class="num">更新</th><th>結果</th></tr></thead><tbody><tr><td class="en">' + fDT(ls.at) + '</td><td class="num">' + fmt(ls.n) + '</td><td class="num">' + fmt(ls.added) + '</td><td class="num">' + fmt(ls.updated) + '</td><td><span class="st on"><i></i>成功</span></td></tr></tbody></table></div>'
        : emptyBlock('還沒有同步過', '依上方步驟在學院後台點一次書籤。')) +
      '<p class="rule-n">對應方式：先比對 email，再比對 IG 帳號；對不到的人顯示「未入學」，可在個人檔案填入 IG 帳號再比對。名單只存在雲端硬碟試算表，前台與外部都讀不到。</p></section>';
    return titleRow('同步學員', '學院官網 → 資料中心') + '<div class="grid12"><div class="c7">' + install + run + '</div><div class="c5">' + hist + '</div></div>';
  },
  after: function (main) {
    var link = main.querySelector('#bmlink');
    link.addEventListener('click', function (e) { e.preventDefault(); toast(MOCK ? '預覽模式：正式版會是可拖曳的書籤' : '請把這顆按鈕拖曳到書籤列，不要直接點。'); });
    var play = main.querySelector('#bmplay'); if (play) play.addEventListener('click', function () {
      var bar = main.querySelector('#bmdemo .bar i'), t = main.querySelector('#bmdemo .t'), steps = [[15, '掃描學員列表…第 3 頁・612 筆'], [45, '輸入後台密碼（只用來推導金鑰，不會送出）'], [80, '加密上傳 2 / 3 批（600 / 612 筆）'], [100, '同步完成：612 筆（新增 4・更新 17）']], i = 0;
      play.disabled = true; var tick = function () { if (i >= steps.length) { play.disabled = false; return; } bar.style.transform = 'scaleX(' + steps[i][0] / 100 + ')'; t.textContent = steps[i][1]; i++; setTimeout(tick, 900); }; tick();
    });
  }
};

/* ---------- 匯出資料〔匯出名單・匯出事件・匯出作答〕 ---------- */
var EXP = {
  people: { label: '匯出名單', unit: '人', desc: '每人一列：登入身分、IG、email、學院帳號與級別、測驗結果、到訪、點擊、漏斗進度、裝置數、重複點擊。' },
  events: { label: '匯出事件', unit: '筆', desc: '每個事件一列：時間、人、事件、對象、外連去向、網址、系統與瀏覽器、IP 片段、學院帳號、到訪 sid。' },
  results: { label: '匯出作答', unit: '份', desc: '每次作答一列：時間、人、測驗、結果、第幾次、摘要、逐題作答（題號:選項）。' }
};
VIEWS.export = {
  section: 'export',
  label: function (d, r) { return (EXP[expType(r)] || EXP.people).label; },
  load: function (r) {
    var t = expType(r), q = expQ(r);
    if (t === 'people') return apiC('admin.people', Object.assign({}, q, { size: 1 })).then(function (x) { return { n: x.matched }; });
    if (t === 'events') return apiC('admin.events', Object.assign({}, q, { size: 1 })).then(function (x) { return { n: x.totals.events }; });
    return apiC('admin.results', Object.assign({}, q, { size: 1 })).then(function (x) { return { n: x.totals.attempts }; });
  },
  skeleton: function () { return titleRow('匯出資料', '') + skelPn(240); },
  html: function (d, r) {
    var t = expType(r), q = expQ(r), E = EXP[t];
    var tb = tabs(Object.keys(EXP).map(function (k) { return { v: k, label: EXP[k].label, href: href('export', '', { type: k }) }; }), t, '匯出類型');
    var sel = function (label, key, opts) { return '<label class="addf-f"><span>' + label + '</span><span class="selw"><select data-go>' + opts.map(function (o) { return '<option value="' + esc(withP(r, (function () { var x = {}; x[key] = o[0]; return x; })())) + '"' + ((q[key] || '') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' + ic('i-dn') + '</span></label>'; };
    var fields = '';
    if (t === 'people') fields = sel('身分', 'filter', [['', '全部'], ['loggedin', '已登入'], ['anon', '未登入'], ['student', '已是學員'], ['nonstudent', '未入學']]) + sel('期間', 'range', [['all', '全部期間'], ['today', '今日'], ['7d', '近 7 天'], ['30d', '近 30 天'], ['90d', '近 90 天']]);
    if (t === 'events') fields = sel('事件', 'n', [['', '全部事件'], ['click', '點擊（六種）'], ['view', '畫面'], ['enter', '進站'], ['out', '外連'], ['quiz_q', '作答']]) + sel('期間', 'range', [['7d', '近 7 天'], ['today', '今日'], ['30d', '近 30 天'], ['90d', '近 90 天'], ['all', '全部期間']]);
    if (t === 'results') fields = sel('測驗', 'kind', [['', '兩種測驗'], ['ability', '能力健檢'], ['career', '職涯定位']]) + sel('期間', 'range', [['30d', '近 30 天'], ['today', '今日'], ['7d', '近 7 天'], ['90d', '近 90 天'], ['all', '全部期間']]);
    var form = '<section class="pn exp"><div class="pn-h"><h2>' + E.label + '</h2><span class="s">CSV・UTF-8，Excel 與 Google 試算表可直接開啟</span></div><p class="exp-d">' + E.desc + '</p><div class="exp-f">' + fields + '</div>' +
      '<div class="exp-go"><div class="exp-n"><span class="l">符合條件</span><span class="v en">' + fmt(d.n) + '</span><small>' + E.unit + '</small></div><button class="btn-m gl gl-ink" type="button" data-export ' + (d.n ? '' : 'disabled') + '>' + ic('i-download') + '<span class="bl">下載 CSV</span></button></div>' +
      '<p class="rule-n">每個檔案最多約 2 萬列或 5 MB，超過時會自動分成多個檔案依序下載。開頭是 = + - @ 的儲存格會補上 \'，避免被試算表當成公式。</p></section>';
    var other = '<section class="pn"><div class="pn-h"><h2>從篩選匯出</h2></div><p class="rule-n">名單、點擊紀錄、測驗結果頁的「匯出」鍵會帶著當下的全部篩選（身分、漏斗、事件、按鈕、時段、測驗、結果…）匯出。</p><div class="row-end" style="justify-content:flex-start">' +
      [['people', '名單'], ['events', '點擊紀錄'], ['results', '測驗結果']].map(function (o) { return '<a class="btn-s gl gl-clear" href="#/' + o[0] + '" data-root>' + o[1] + ic('i-arrow') + '</a>'; }).join('') + '</div></section>';
    return titleRow('匯出資料', '', tb) + '<div class="grid12"><div class="c7">' + form + '</div><div class="c5">' + other + '</div></div>';
  },
  after: function (main, d, r) { var b = main.querySelector('[data-export]'); if (b) b.addEventListener('click', function () { exportCsv(expType(r), expQ(r), b); }); }
};
function expType(r) { return EXP[r.p.type] ? r.p.type : 'people'; }
function expQ(r) {
  var t = expType(r), q = {};
  ['filter', 'range', 'n', 'kind'].forEach(function (k) { if (r.p[k]) q[k] = r.p[k]; });
  if (!q.range) q.range = t === 'people' ? 'all' : t === 'events' ? '7d' : '30d';
  if (t !== 'people') delete q.filter; if (t !== 'events') delete q.n; if (t !== 'results') delete q.kind;
  return q;
}

/* ---------- 設定〔登入裝置・後台密碼・判定規則・連線狀態〕 ---------- */
VIEWS.settings = {
  section: 'settings',
  label: function () { return '設定'; },
  load: function () { return Promise.all([api('admin.tools', {}), api('admin.sessions', {})]).then(function (x) { return { tools: x[0], ss: x[1] }; }); },
  skeleton: function () { return titleRow('設定', '') + skelPn(160) + skelPn(160); },
  html: function (d) {
    var T = d.tools, ss = d.ss.sessions || [];
    var devs = '<section class="pn" id="s-dev"><div class="pn-h"><h2>登入裝置</h2><span class="s">' + ss.length + ' 台・勾選「記住此裝置」一年內免再輸入密碼</span></div>' +
      ss.map(function (s) { return '<div class="ses">' + ic(/iPhone|iPad|Android/.test(s.label) ? 'i-phone' : 'i-laptop') + '<b>' + esc(s.label || '裝置') + (s.me ? '<span class="me">這台</span>' : '') + '</b><span class="c"><button class="btn-s gl gl-clear" type="button" data-rm="' + esc(s.id) + '" aria-label="移除 ' + esc(s.label || '裝置') + '">' + (s.me ? '登出' : '移除') + '</button></span><small>最近使用 <span class="en">' + fMDHM(s.last) + '</span>・到期 <span class="en">' + fDate(s.exp) + '</span></small></div>'; }).join('') +
      '<div class="row-end"><button class="btn-s gl gl-clear danger" type="button" id="outall">登出所有裝置</button></div></section>';
    var pw = '<section class="pn" id="s-pw"><div class="pn-h"><h2>後台密碼</h2></div><form class="pwf" id="pwform" novalidate>' +
      '<div class="fld"><label for="opw">目前密碼</label><div class="inp sm"><input id="opw" type="password" autocomplete="current-password" required></div></div>' +
      '<div class="fld"><label for="npw">新密碼（至少 8 碼）</label><div class="inp sm"><input id="npw" type="password" autocomplete="new-password" required></div></div>' +
      '<div class="fld"><label for="npw2">再輸入一次新密碼</label><div class="inp sm"><input id="npw2" type="password" autocomplete="new-password" required></div></div>' +
      '<div id="pwmsg" role="alert" hidden></div><p class="rule-n">變更後其他裝置會登出；學員同步書籤下次使用時會重新詢問密碼。</p><div class="row-end"><button class="btn-s gl gl-ink" type="submit" id="pwgo">變更密碼</button></div></form></section>';
    var rules = '<section class="pn" id="s-rule"><div class="pn-h"><h2>判定規則</h2><span class="s">資料中心固定規則・唯讀</span></div><dl class="kv rules2">' +
      '<dt>重複點擊</dt><dd>同一人、同一顆按鈕，<b>10 分鐘內 5 次以上</b>即標記（只看入口鍵、現在列、頁尾、卡片按鈕、撕票、外連這六種點擊）</dd>' +
      '<dt>到訪切分</dt><dd>同一裝置每次進站為一次到訪；<b>30 分鐘</b>沒有任何事件，下一個事件算新的一次</dd>' +
      '<dt>學員對應</dt><dd>先以 <b>email</b> 比對學院名單，對不到再以 <b>IG 帳號</b>比對</dd>' +
      '<dt>未送達結果</dt><dd>答到最後一題後 30 分鐘內沒有「完成測驗」紀錄（近 30 天）</dd>' +
      '<dt>時間與日界</dt><dd>一律台北時間（UTC+8）；查詢結果在資料中心快取 60 秒</dd></dl></section>';
    var ls = T.lastSync;
    var conn = '<section class="pn" id="s-conn"><div class="pn-h"><h2>連線狀態</h2></div><dl class="kv">' +
      '<dt>資料中心</dt><dd><span class="st on"><i></i>' + (MOCK ? '預覽假資料' : '連線正常') + '</span>' + (!MOCK && CFG.gas ? '<small class="en u">' + esc(String(CFG.gas).replace(/^https?:\/\//, '').slice(0, 42)) + '…</small>' : '') + '</dd>' +
      '<dt>資料時間</dt><dd><span class="en" data-fresh>' + esc(freshText()) + '</span><small>最新一筆事件</small></dd>' +
      '<dt>LINE 登入</dt><dd>' + stDot(T.line ? '啟用' : '未設定') + '</dd><dt>Google 登入</dt><dd>' + stDot(T.google ? '啟用' : '未設定') + '</dd>' +
      '<dt>學員同步</dt><dd>' + (ls ? '<span class="en">' + fDT(ls.at) + '</span>・<span class="en">' + fmt(ls.n) + '</span> 筆' : '尚未同步') + '</dd>' +
      '<dt>這台裝置</dt><dd>' + esc((state.me && state.me.label) || deviceLabel()) + (state.me && state.me.exp ? '<small>登入到期 <span class="en">' + fDate(state.me.exp) + '</span></small>' : '') + '</dd></dl>' +
      '<div class="row-end" style="justify-content:flex-start"><button class="btn-s gl gl-clear" type="button" data-refresh>' + ic('i-redo') + '重新整理資料</button></div></section>';
    return titleRow('設定', '') + '<div class="grid12"><div class="c7">' + devs + pw + '</div><div class="c5">' + rules + conn + '</div></div>';
  },
  after: function (main, d) {
    var ss = d.ss.sessions || [];
    main.querySelectorAll('[data-rm]').forEach(function (b) { b.addEventListener('click', async function () { try { await api('admin.removeSession', { id: b.dataset.rm }); var me = ss.filter(function (s) { return s.id === b.dataset.rm; })[0]; if (me && me.me) { AT = ''; store.del('gh.at'); toast('已登出這台裝置'); render({}); } else { toast('已移除裝置'); render({ keep: true }); } } catch (e) { toast(e.msg || '失敗', true); } }); });
    main.querySelector('#outall').addEventListener('click', async function () { if (!window.confirm('確定登出所有裝置？包含這一台。')) return; try { await api('admin.logoutAll'); AT = ''; store.del('gh.at'); state.me = null; toast('已登出所有裝置'); render({}); } catch (e) { toast(e.msg || '失敗', true); } });
    var f = main.querySelector('#pwform'), m = main.querySelector('#pwmsg');
    f.addEventListener('submit', async function (e) {
      e.preventDefault(); var o = f.querySelector('#opw').value, n = f.querySelector('#npw').value, n2 = f.querySelector('#npw2').value, b = f.querySelector('#pwgo');
      if (!o) return showMsg(m, '請輸入目前密碼', true);
      if (n.length < 8) return showMsg(m, '新密碼至少 8 碼', true);
      if (n !== n2) return showMsg(m, '兩次輸入的新密碼不一樣', true);
      b.disabled = true; showMsg(m, '正在推導金鑰並變更…');
      try { var st = await api('admin.status'), k1 = await window.HubCrypto.deriveKeys(o, st.pwSalt), k2 = await window.HubCrypto.deriveKeys(n, st.pwSalt); await api('admin.changePassword', { oldKey: k1.pwKey, pwKey: k2.pwKey, bmKey: k2.bmKey }); toast('密碼已變更，其他裝置已登出'); render({ keep: true }); }
      catch (err) { showMsg(m, err.msg || '變更失敗', true); b.disabled = false; }
    });
  }
};

boot();
})();
