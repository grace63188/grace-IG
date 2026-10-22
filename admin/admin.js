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
   node 測試直接 require 本檔。 */

var LIB_EVENT_NAMES = ['enter', 'key', 'now', 'card', 'tear', 'login_start', 'login_done', 'login_fail', 'quiz_q', 'quiz_done', 'quiz_retry', 'out', 'foot', 'sound'];
var LIB_KEYS = { key: ['quiz', 'study', 'event', 'live', 'follow', 'consult'], now: ['live', 'event', 'pod'], tear: ['ability', 'career'], login_start: ['line', 'google'], login_fail: ['line', 'google'], quiz_q: ['ability', 'career'], quiz_retry: ['ability', 'career'], out: ['key', 'now', 'foot', 'card', 'result'], foot: ['line_academy', 'line_sampler', 'ig', 'yt', 'pod'], sound: ['on', 'off'] };
var LIB_KEY_LABEL = { quiz: '開始測驗', study: '前往上課', event: '查看活動', live: '收看直播', follow: '追蹤動態', consult: '預約諮詢' };
var LIB_NOW_LABEL = { live: 'IG直播', event: '活動', pod: 'PODCAST' };
var LIB_FOOT_LABEL = { line_academy: '學院官方 LINE', line_sampler: 'Sampler 官方 LINE', ig: '校長 IG', yt: 'YouTube', pod: 'PODCAST' };
var LIB_STAGES = ['探索起步', '基礎累積', '整合成形', '全面發揮'];
var LIB_ROLES = ['實踐者', '洞察者', '創作者', '引導者', '開創者', '統籌者'];
var LIB_FUNNEL = ['enter', 'key', 'tear', 'login_done', 'quiz_done', 'out'];
var LIB_FUNNEL_LABEL = ['進站', '點入口', '撕票', '登入', '完成測驗', '點外連'];
var LIB_MAX_BATCH = 50;
var LIB_TPE = 8 * 3600e3;
var LIB_REPEAT_WINDOW = 10 * 60e3;
var LIB_REPEAT_N = 5;
var LIB_SESSION_GAP = 30 * 60e3;

function libStr(v, max) { if (v === undefined || v === null) return ''; var s = String(v); return s.length > max ? s.slice(0, max) : s; }
function libIsObj(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
function libPad(n) { return (n < 10 ? '0' : '') + n; }

/* 台北時間拆解 */
function libTpe(t) {
  var d = new Date(t + LIB_TPE);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), wd: d.getUTCDay() };
}
function libDayKey(t) { var p = libTpe(t); return p.y + '.' + libPad(p.mo) + '.' + libPad(p.d); }
function libDayStart(t) { var p = libTpe(t); return Date.UTC(p.y, p.mo - 1, p.d) - LIB_TPE; }
function libFmtHM(t) { var p = libTpe(t); return libPad(p.h) + ':' + libPad(p.mi); }
function libFmtMD(t) { var p = libTpe(t); return libPad(p.mo) + '.' + libPad(p.d); }

/* 範圍：today／7d／30d（台北日界） */
function libRange(range, now) {
  var end = now, s0 = libDayStart(now);
  if (range === '7d') return { start: s0 - 6 * 86400e3, end: end, days: 7, prevStart: s0 - 13 * 86400e3, prevEnd: s0 - 6 * 86400e3 };
  if (range === '30d') return { start: s0 - 29 * 86400e3, end: end, days: 30, prevStart: s0 - 59 * 86400e3, prevEnd: s0 - 29 * 86400e3 };
  return { start: s0, end: end, days: 1, prevStart: s0 - 86400e3, prevEnd: s0 };
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

/* 事件批次驗證：回 {ok, events, err} */
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
    if (LIB_KEYS[n] && LIB_KEYS[n].indexOf(k) < 0) return { ok: false, err: n + ' 的 k 不合法' };
    if (u) { u = u.replace(/^https?:\/\//, '').split(/[?#]/)[0]; }
    out.push({ id: id, t: Math.round(t), n: n, k: k, v: v, u: u, ref: ref.replace(/^https?:\/\//, '').split('/')[0] });
  }
  return { ok: true, events: out, sid: libStr(data.sid, 40), fp: /^[0-9a-f]{0,16}$/i.test(libStr(data.fp, 16)) ? libStr(data.fp, 16).toLowerCase() : '', dev: libDev(data.dev), ip: libValidIp(data.ip) };
}

/* 測驗結果驗證 */
function libValidateQuiz(d) {
  if (!libIsObj(d)) return { ok: false, err: 'data 不是物件' };
  var kind = d.kind, at = Number(d.at), ans = d.answers;
  if (kind !== 'ability' && kind !== 'career') return { ok: false, err: 'kind' };
  if (!isFinite(at)) return { ok: false, err: 'at' };
  var len = kind === 'ability' ? 14 : 12, maxOpt = kind === 'ability' ? 3 : 1;
  if (!Array.isArray(ans) || ans.length !== len) return { ok: false, err: 'answers 長度須為 ' + len };
  for (var i = 0; i < len; i++) { var a = ans[i]; if (typeof a !== 'number' || a !== Math.floor(a) || a < 0 || a > maxOpt) return { ok: false, err: '第 ' + (i + 1) + ' 題作答無效' }; }
  var sum = {};
  if (kind === 'ability') {
    if (LIB_STAGES.indexOf(d.stage) < 0) return { ok: false, err: 'stage' };
    sum = { stage: d.stage, top: libStr(d.top, 8), low: libStr(d.low, 8), total: Number(d.total) || 0, scores: libIsObj(d.scores) ? d.scores : {} };
  } else {
    if (LIB_ROLES.indexOf(d.primary) < 0) return { ok: false, err: 'primary' };
    sum = { primary: d.primary, secondary: LIB_ROLES.indexOf(d.secondary) >= 0 ? d.secondary : '', counts: libIsObj(d.counts) ? d.counts : {} };
  }
  return { ok: true, kind: kind, at: Math.round(at), answers: ans, summary: sum, label: kind === 'ability' ? sum.stage : sum.primary };
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

/* 到訪切分：同 did 的事件依 30 分鐘間隔分成 visits */
function libVisits(events) {
  var byDid = {};
  events.slice().sort(function (a, b) { return a.t - b.t; }).forEach(function (e) {
    var arr = byDid[e.did] || (byDid[e.did] = []);
    var last = arr[arr.length - 1];
    if (!last || e.t - last.end > LIB_SESSION_GAP) arr.push({ did: e.did, pid: e.pid, start: e.t, end: e.t, events: [e], os: e.os, br: e.br, ipMask: e.ipMask });
    else { last.end = e.t; last.events.push(e); if (e.pid) last.pid = e.pid; }
  });
  var out = [];
  Object.keys(byDid).forEach(function (k) { out = out.concat(byDid[k]); });
  return out.sort(function (a, b) { return b.start - a.start; });
}

/* 人的辨識鍵：有 pid 用 pid；沒有 pid 的事件若同一裝置曾登入，歸到那個 pid；否則 did */
function libWho(e) { return e.who || e.pid || ('d:' + e.did); }
function libAttachWho(events) {
  var didPid = {};
  events.forEach(function (e) { if (e.pid) didPid[e.did] = e.pid; });
  events.forEach(function (e) { e.who = e.pid || didPid[e.did] || ('d:' + e.did); });
  return events;
}

/* 漏斗（獨立訪客、逐步縮小：每一步只算有做完前一步的人） */
function libFunnel(events) {
  libAttachWho(events);
  var sets = LIB_FUNNEL.map(function () { return {}; });
  events.forEach(function (e) { var i = LIB_FUNNEL.indexOf(e.n); if (i >= 0) sets[i][libWho(e)] = 1; });
  var alive = null, counts = [];
  sets.forEach(function (s, i) {
    var keep = {};
    Object.keys(s).forEach(function (w) { if (i === 0 || alive[w]) keep[w] = 1; });
    alive = keep; counts.push(Object.keys(keep).length);
  });
  return LIB_FUNNEL.map(function (n, i) { return { n: n, label: LIB_FUNNEL_LABEL[i], v: counts[i], rate: i ? (counts[i - 1] ? Math.round(counts[i] / counts[i - 1] * 100) : 0) : 100 }; });
}

/* 點擊排行 */
function libClickRank(events) {
  var g = { key: {}, now: {}, foot: {} }, tot = 0;
  events.forEach(function (e) {
    if (e.n === 'key') { g.key[e.k] = (g.key[e.k] || 0) + 1; tot++; }
    else if (e.n === 'now') { var l = (LIB_NOW_LABEL[e.k] || e.k) + (e.v ? ' ' + e.v : ''); g.now[l] = (g.now[l] || 0) + 1; tot++; }
    else if (e.n === 'foot') { g.foot[e.k] = (g.foot[e.k] || 0) + 1; tot++; }
  });
  var toRows = function (obj, lab) { return Object.keys(obj).map(function (k) { return { k: k, label: lab ? (lab[k] || k) : k, v: obj[k] }; }).sort(function (a, b) { return b.v - a.v; }); };
  return { total: tot, groups: [{ name: '入口鍵', rows: toRows(g.key, LIB_KEY_LABEL) }, { name: '現在列', rows: toRows(g.now) }, { name: '頁尾', rows: toRows(g.foot, LIB_FOOT_LABEL) }] };
}

/* 分時熱度：days×24 */
function libHeat(events, r) {
  var days = [], idx = {};
  for (var i = 0; i < r.days; i++) { var t = r.start + i * 86400e3; idx[libDayKey(t)] = i; days.push({ key: libFmtMD(t), full: libDayKey(t), wd: '日一二三四五六'[libTpe(t).wd] }); }
  var grid = days.map(function () { var a = []; for (var h = 0; h < 24; h++) a.push(0); return a; });
  var hours = []; for (var h = 0; h < 24; h++) hours.push(0);
  var peak = { v: 0, d: 0, h: 0 };
  events.forEach(function (e) {
    if (e.n === 'enter' || e.n === 'login_done' || e.n === 'quiz_done') return;
    var p = libTpe(e.t), di = idx[libDayKey(e.t)]; if (di === undefined) return;
    grid[di][p.h]++; hours[p.h]++;
    if (grid[di][p.h] > peak.v) peak = { v: grid[di][p.h], d: di, h: p.h };
  });
  var tot = hours.reduce(function (a, b) { return a + b; }, 0) || 1;
  var band = function (a, b) { var s = 0; for (var h = a; h <= b; h++) s += hours[h]; return Math.round(s / tot * 100); };
  return { days: days, grid: grid, peak: peak.v ? { day: days[peak.d].key, wd: days[peak.d].wd, hour: peak.h, v: peak.v } : null, bands: [{ l: '晚間 20–23 時', v: band(20, 23) }, { l: '午間 12–13 時', v: band(12, 13) }, { l: '凌晨 0–6 時', v: band(0, 6) }] };
}

/* 趨勢：每日完成份數 */
function libTrend(results, r) {
  var days = [], idx = {};
  for (var i = 0; i < r.days; i++) { var t = r.start + i * 86400e3; idx[libDayKey(t)] = i; days.push(libFmtMD(t)); }
  var ab = days.map(function () { return 0; }), cr = days.map(function () { return 0; });
  results.forEach(function (q) { var di = idx[libDayKey(q.at)]; if (di === undefined) return; (q.kind === 'ability' ? ab : cr)[di]++; });
  return { days: days, ability: ab, career: cr };
}

/* 結果分布 */
function libDist(results) {
  var st = {}, ro = {};
  LIB_STAGES.forEach(function (s) { st[s] = 0; }); LIB_ROLES.forEach(function (s) { ro[s] = 0; });
  results.forEach(function (q) { if (q.kind === 'ability' && st[q.label] !== undefined) st[q.label]++; if (q.kind === 'career' && ro[q.label] !== undefined) ro[q.label]++; });
  return { stages: LIB_STAGES.map(function (s) { return { label: s, v: st[s] }; }), roles: LIB_ROLES.map(function (s) { return { label: s, v: ro[s] }; }).sort(function (a, b) { return b.v - a.v; }) };
}

/* 重複點擊偵測：同一人 10 分鐘內同一 n+k ≥5 */
function libRepeatFlags(events) {
  libAttachWho(events);
  var by = {};
  events.forEach(function (e) { if (['key', 'now', 'foot', 'card', 'tear', 'out'].indexOf(e.n) < 0) return; var k = libWho(e) + '|' + e.n + '|' + e.k; (by[k] || (by[k] = [])).push(e.t); });
  var flags = {};
  Object.keys(by).forEach(function (k) {
    var ts = by[k].sort(function (a, b) { return a - b; }), best = 0;
    for (var i = 0, j = 0; i < ts.length; i++) { while (ts[i] - ts[j] > LIB_REPEAT_WINDOW) j++; best = Math.max(best, i - j + 1); }
    if (best >= LIB_REPEAT_N) { var p = k.split('|'); flags[p[0]] = flags[p[0]] || []; flags[p[0]].push({ n: p[1], k: p[2], max: best }); }
  });
  return flags;
}

/* 總覽彙整 */
function libOverview(all, results, range, now, persons) {
  libAttachWho(all);
  var r = libRange(range, now);
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
  /* 今日重點：撕票→登入流失與 IG 內建 Google 失敗 */
  var tearSet = {}, loginSet = {}; inR.forEach(function (e) { if (e.n === 'tear') tearSet[libWho(e)] = 1; if (e.n === 'login_done') loginSet[libWho(e)] = 1; });
  var lost = Object.keys(tearSet).filter(function (w) { return !loginSet[w]; }), lostIg = 0;
  var devOf = {}; inR.forEach(function (e) { devOf[libWho(e)] = e.br; });
  lost.forEach(function (w) { if (devOf[w] === 'IG 內建') lostIg++; });
  var finding = null;
  if (Object.keys(tearSet).length && lost.length) finding = { lost: lost.length, pct: Math.round(lost.length / Object.keys(tearSet).length * 100), ig: lostIg, text: '撕票到登入流失 ' + lost.length + ' 人（' + Math.round(lost.length / Object.keys(tearSet).length * 100) + '%）' + (lostIg ? '，其中 ' + lostIg + ' 人用 IG 內建瀏覽器。' : '。') };
  else if (!inR.length) finding = { lost: 0, pct: 0, ig: 0, text: '這段期間還沒有資料。' };
  else finding = { lost: 0, pct: 0, ig: 0, text: '撕票的人都完成了登入。' };
  var delta = function (a, b) { return a - b; };
  return {
    range: range, start: r.start, end: r.end, finding: finding,
    kpi: [
      { l: '進站人次', v: visits, d: delta(visits, pvisits) },
      { l: '獨立訪客', v: uv, u: '人', d: delta(uv, puv) },
      { l: '登入人數', v: Object.keys(logins).length, u: '人', note: '其中自動登入 ' + auto },
      { l: '測驗完成', v: qr.length, u: '份', note: '能力健檢 ' + ab + '・職涯定位 ' + cr, done: true }
    ],
    funnel: fun, trend: libTrend(results, range === 'today' ? libRange('7d', now) : r), dist: libDist(qr), clicks: libClickRank(inR), heat: libHeat(inR, r)
  };
}

/* 名單：以人為單位彙整 */
function libPeople(all, results, persons, students, flags) {
  libAttachWho(all);
  var byWho = {};
  all.forEach(function (e) {
    var w = libWho(e), p = byWho[w] || (byWho[w] = { who: w, pid: e.pid || '', dids: {}, ips: {}, clicks: 0, first: e.t, last: e.t, visits: 0 });
    if (e.pid && !p.pid) p.pid = e.pid;
    p.dids[e.did] = 1; if (e.ipMask) p.ips[e.ipMask] = 1;
    if (['key', 'now', 'foot', 'card', 'tear', 'out'].indexOf(e.n) >= 0) p.clicks++;
    if (e.n === 'enter') p.visits++;
    if (e.t < p.first) p.first = e.t; if (e.t > p.last) p.last = e.t;
  });
  var resBy = {}; results.forEach(function (q) { var w = q.pid; var o = resBy[w] || (resBy[w] = {}); if (!o[q.kind] || o[q.kind].at < q.at) o[q.kind] = q; });
  var stuBy = libStudentIndex(students);
  return Object.keys(byWho).map(function (w) {
    var p = byWho[w], per = p.pid ? (persons[p.pid] || null) : null, res = resBy[p.pid] || {};
    var stu = per ? libMatchStudent(per, stuBy) : null;
    return {
      who: w, pid: p.pid, name: per ? per.name : '未登入訪客', pic: per ? per.pic : '', src: per ? per.src : '', email: per ? per.email : '', ig: per ? per.ig : '',
      student: stu ? { account: stu.account, name: stu.name, ig: stu.ig, lineId: stu.lineId, level: stu.level, status: stu.status, regDate: stu.regDate, by: stu.by } : null,
      ability: res.ability ? res.ability.label : '', career: res.career ? res.career.label : '',
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

/* 名單篩選與搜尋 */
function libFilterPeople(people, f) {
  f = f || {};
  var q = libNormIg(f.q || '');
  return people.filter(function (p) {
    if (f.filter === 'student' && !p.student) return false;
    if (f.filter === 'guest' && p.student) return false;
    if (f.level && (!p.student || p.student.level !== f.level)) return false;
    if (f.status && (!p.student || p.student.status !== f.status)) return false;
    if (q) { var hay = [p.name, p.email, p.ig, p.student && p.student.account, p.student && p.student.name, p.student && p.student.ig, p.student && p.student.lineId].join(' ').toLowerCase(); if (hay.indexOf(q) < 0) return false; }
    return true;
  });
}

/* 重複點擊三角度 */
function libRepeat(events, people, by) {
  libAttachWho(events);
  var byName = {}; people.forEach(function (p) { byName[p.who] = p; });
  var groups = {};
  events.forEach(function (e) {
    if (['key', 'now', 'foot', 'card', 'tear', 'out'].indexOf(e.n) < 0) return;
    var k, sub;
    if (by === 'ip') { if (!e.ipHash) return; k = e.ipHash; sub = e.ipMask; }
    else if (by === 'device') { k = e.did; sub = e.os + '・' + e.br; }
    else { var p = byName[libWho(e)]; k = libWho(e); sub = p ? (p.ig || p.name) : '未登入訪客'; }
    var g = groups[k] || (groups[k] = { key: k, label: sub, tot: 0, btn: {}, who: {}, dids: {}, first: e.t, last: e.t });
    g.tot++; var b = e.n + ':' + e.k; g.btn[b] = (g.btn[b] || 0) + 1; g.who[libWho(e)] = 1; g.dids[e.did] = 1;
    if (e.t < g.first) g.first = e.t; if (e.t > g.last) g.last = e.t;
  });
  var flags = libRepeatFlags(events);
  return Object.keys(groups).map(function (k) {
    var g = groups[k], whos = Object.keys(g.who), names = whos.map(function (w) { var p = byName[w]; return p ? p.name : '未登入訪客'; });
    var top = Object.keys(g.btn).sort(function (a, b) { return g.btn[b] - g.btn[a]; })[0];
    var flagged = whos.some(function (w) { return flags[w]; });
    var why = flagged ? (function () { var f = flags[whos.filter(function (w) { return flags[w]; })[0]][0]; return { text: '「' + libBtnLabel(f.n, f.k) + '」' + f.max + ' 次・10 分鐘內', bad: true }; })() : { text: whos.length > 1 ? names.slice(0, 2).join('、') + (names.length > 2 ? ' 等' : '') : '正常', bad: false };
    var label = by === 'ig' ? (g.label || names[0]) : g.label;
    var sub = by === 'ip' ? whos.length + ' 人・' + Object.keys(g.dids).length + ' 裝置' : by === 'device' ? names[0] : (names[0] !== g.label ? names[0] : '');
    return { key: k, label: label, sub: sub, tot: g.tot, top: libBtnLabel.apply(null, top.split(':')), topN: g.btn[top], why: why, people: whos.length, devices: Object.keys(g.dids).length, last: g.last };
  }).sort(function (a, b) { return b.tot - a.tot; });
}
function libBtnLabel(n, k) {
  if (n === 'key') return LIB_KEY_LABEL[k] || k;
  if (n === 'now') return LIB_NOW_LABEL[k] || k;
  if (n === 'foot') return LIB_FOOT_LABEL[k] || k;
  if (n === 'tear') return k === 'ability' ? '撕票・能力健檢' : '撕票・職涯定位';
  if (n === 'out') return '外連';
  return n + (k ? '・' + k : '');
}

/* 個人頁時間軸（輸出 HTML 片段：所有來自前台的字串都先跳脫） */
function libEsc(s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function libEventText(e0) {
  var e = { n: e0.n, k: libEsc(e0.k), v: libEsc(e0.v), ref: libEsc(e0.ref) };
  switch (e.n) {
    case 'enter': return { d: 'out', x: '進站' + (e.ref ? '<em>' + e.ref + '</em>' : '') };
    case 'key': return { d: 'btn', x: '點「' + (LIB_KEY_LABEL[e.k] || e.k) + '」' };
    case 'now': return { d: 'btn', x: '點現在列「' + (LIB_NOW_LABEL[e.k] || e.k) + (e.v ? ' ' + e.v : '') + '」' };
    case 'card': return { d: 'btn', x: '點「' + e.v + '」' };
    case 'tear': return { d: 'btn', x: '撕票・' + (e.k === 'ability' ? '能力健檢' : '職涯定位') };
    case 'login_start': return { d: 'btn', x: (e.k === 'line' ? 'LINE' : 'Google') + ' 登入' };
    case 'login_done': return { d: 'ok', x: (e.k === 'line' ? 'LINE' : 'Google') + ' 登入完成' + (e.v === 'auto' ? '<em>自動</em>' : '') };
    case 'login_fail': return { d: 'btn', x: (e.k === 'line' ? 'LINE' : 'Google') + ' 登入失敗<em>' + (e.v === 'webview' ? 'IG 內建瀏覽器' : e.v) + '</em>' };
    case 'quiz_q': return { d: 'btn', x: (e.k === 'ability' ? '能力健檢' : '職涯定位') + ' 作答到第 ' + e.v + ' 題' };
    case 'quiz_done': return { d: 'ok', x: '完成' + (e.k === 'ability' ? '能力健檢' : '職涯定位') + '・<b>' + e.v + '</b>' };
    case 'quiz_retry': return { d: 'btn', x: '重做' + (e.k === 'ability' ? '能力健檢' : '職涯定位') };
    case 'out': return { d: 'btn', x: '點「' + e.v + '」<em>外連</em>' };
    case 'foot': return { d: 'btn', x: '點頁尾「' + (LIB_FOOT_LABEL[e.k] || e.k) + '」' };
    case 'sound': return { d: 'btn', x: '音效' + (e.k === 'on' ? '開' : '關') };
  }
  return { d: 'btn', x: e.n };
}
function libPersonTimeline(events) {
  var visits = libVisits(events), days = {}, order = [];
  visits.forEach(function (v) {
    var dk = libDayKey(v.start);
    if (!days[dk]) { days[dk] = { day: dk, wd: '日一二三四五六'[libTpe(v.start).wd], visits: [] }; order.push(dk); }
    days[dk].visits.push({ os: v.os, br: v.br, from: libFmtHM(v.start), to: libFmtHM(v.end), ipMask: v.ipMask, ev: v.events.map(function (e) { var tx = libEventText(e); return { t: libFmtHM(e.t), d: tx.d, x: tx.x }; }) });
  });
  return { visits: visits.length, days: order.map(function (k) { return days[k]; }) };
}


window.HUB_BM_SRC="(function(){\nconst subtle = globalThis.crypto.subtle;\nconst enc = new TextEncoder();\nconst b64 = (u8) => { let s = ''; u8.forEach((b) => { s += String.fromCharCode(b); }); return btoa(s); };\nconst unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));\nconst hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');\nasync function pbkdf2(password, salt, bits) {\n  const km = await subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);\n  return new Uint8Array(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 200000 }, km, bits));\n}\nasync function deriveKeys(password, pwSalt) {\n  const [pw, bm] = await Promise.all([pbkdf2(password, pwSalt, 256), pbkdf2(password, pwSalt + '|bm', 256)]);\n  return { pwKey: hex(pw), bmKey: b64(bm) };\n}\nasync function hmac(keyBytes, data) {\n  const k = await subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);\n  return new Uint8Array(await subtle.sign('HMAC', k, data));\n}\nasync function bmEncrypt(bmKeyB64, text) {\n  const K = unb64(bmKeyB64);\n  const kEnc = await hmac(K, enc.encode('enc')), kMac = await hmac(K, enc.encode('mac'));\n  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(16));\n  const pt = enc.encode(text), ct = new Uint8Array(pt.length);\n  for (let blk = 0, i = 0; i < pt.length; blk++) {\n    const ctr = new Uint8Array(20); ctr.set(nonce); ctr.set([(blk >>> 24) & 255, (blk >>> 16) & 255, (blk >>> 8) & 255, blk & 255], 16);\n    const ks = await hmac(kEnc, ctr);\n    for (let j = 0; j < ks.length && i < pt.length; j++, i++) ct[i] = pt[i] ^ ks[j];\n  }\n  const macIn = new Uint8Array(16 + ct.length); macIn.set(nonce); macIn.set(ct, 16);\n  return { nonce: b64(nonce), ct: b64(ct), tag: b64(await hmac(kMac, macIn)) };\n}\nvar SYNC_OVERHEAD = 1200;   /* {op,data:{nonce,ct,tag}} 外層＋封包欄位（ts、syncId、chunk、chunks、source）的保守估計 */\nvar SYNC_ROW_GLUE = 2;      /* 每筆在 rows 陣列裡的逗號與括號 */\nfunction utf8Len(s) {\n  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s).length;\n  var n = 0; for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); n += c < 0x80 ? 1 : c < 0x800 ? 2 : (c >= 0xD800 && c < 0xDC00) ? (i++, 4) : 3; }\n  return n;\n}\nfunction estimateBody(plainBytes) { return Math.ceil(plainBytes * 4 / 3) + 4 + SYNC_OVERHEAD; }\nfunction packRows(rows, target) {\n  var out = [], cur = [], curBytes = 0;\n  for (var i = 0; i < rows.length; i++) {\n    var b = utf8Len(JSON.stringify(rows[i])) + SYNC_ROW_GLUE;\n    if (cur.length && estimateBody(curBytes + b) > target) { out.push(cur); cur = []; curBytes = 0; }\n    cur.push(rows[i]); curBytes += b;\n  }\n  if (cur.length || !out.length) out.push(cur);\n  return out;\n}\n(function (GAS) {\n  'use strict';\n  if (window.__graceSyncRunning) return; window.__graceSyncRunning = true;\n  var BODY_TARGET = 150 * 1024, BODY_MAX = 900 * 1024, KEY_LS = 'grace.hub.bmKey.v1';\n  var lsGet = function () { try { return localStorage.getItem(KEY_LS) || ''; } catch (e) { return ''; } };\n  var lsSet = function (v) { try { localStorage.setItem(KEY_LS, v); } catch (e) { } };\n  var lsDel = function () { try { localStorage.removeItem(KEY_LS); } catch (e) { } };\n  var box = document.createElement('div');\n  box.setAttribute('style', 'position:fixed;z-index:2147483647;right:16px;bottom:16px;width:min(360px,calc(100vw - 32px));padding:16px 18px;border-radius:20px;background:#E4E4E2;color:#1C1C1B;font:13.5px/1.6 -apple-system,\"Noto Sans TC\",\"PingFang TC\",\"Microsoft JhengHei\",sans-serif;box-shadow:10px 10px 24px rgba(120,120,116,.5),-8px -8px 20px rgba(255,255,255,.9),0 0 0 1px rgba(0,0,0,.04)');\n  box.innerHTML = '<div style=\"display:flex;align-items:center;gap:10px;margin-bottom:8px\"><span style=\"width:26px;height:26px;border-radius:50%;background:radial-gradient(circle at 40% 30%,#F7E9C8,#D7BC84 60%,#A9874A)\"></span><b style=\"font-weight:500;letter-spacing:.1em\">學員同步</b><button id=\"gsx\" style=\"margin-left:auto;border:0;background:none;font:inherit;color:#545452;cursor:pointer;min-width:44px;min-height:44px\">關閉</button></div>' +\n    '<ol id=\"gsl\" style=\"margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:4px\"></ol>' +\n    '<div style=\"height:6px;border-radius:3px;background:rgba(163,163,160,.35);overflow:hidden;margin:10px 0 6px\"><i id=\"gsb\" style=\"display:block;height:100%;width:0;background:linear-gradient(90deg,#D9BF85,#B8975A);transition:width .3s\"></i></div>' +\n    '<div id=\"gsm\" style=\"color:#545452;font-size:12.5px\"></div><div id=\"gsf\"></div><div id=\"gsk\" style=\"font-size:12px;color:#8A8A86;margin-top:6px\"></div>';\n  document.body.appendChild(box);\n  var $ = function (id) { return box.querySelector('#' + id); };\n  $('gsx').onclick = function () { box.remove(); window.__graceSyncRunning = false; };\n  var steps = ['掃描學員列表', '輸入後台密碼', '加密上傳', '完成'], cur = -1;\n  function step(i, note) { cur = i; $('gsl').innerHTML = steps.map(function (s, k) { return '<li style=\"display:flex;gap:8px;align-items:center;color:' + (k < i ? '#6F5426' : k === i ? '#1C1C1B' : '#8A8A86') + '\"><span style=\"width:18px;height:18px;border-radius:50%;display:inline-grid;place-items:center;font-size:11px;' + (k < i ? 'background:#B8975A;color:#fff' : k === i ? 'box-shadow:inset 0 0 0 1.5px #1C1C1B' : 'box-shadow:inset 0 0 0 1.5px #B5B5B1') + '\">' + (k < i ? '✓' : k + 1) + '</span>' + s + (k === i && note ? '<small style=\"color:#545452;margin-left:auto\">' + note + '</small>' : '') + '</li>'; }).join(''); }\n  function msg(t, bad) { $('gsm').textContent = t; $('gsm').style.color = bad ? '#A3302B' : '#545452'; }\n  function bar(p) { $('gsb').style.width = Math.max(0, Math.min(100, p)) + '%'; }\n  function keyNote() {\n    if (!lsGet()) { $('gsk').innerHTML = ''; return; }\n    $('gsk').innerHTML = '已記住此電腦（不用再輸入密碼）　<a href=\"#\" id=\"gsfg\" style=\"color:#6F5426\">忘記此裝置</a>';\n    $('gsfg').onclick = function (e) { e.preventDefault(); lsDel(); keyNote(); msg('已忘記此裝置，下次同步會再問一次密碼。'); };\n  }\n  var PER = 500, CONC = 6;\n  var LEVELS = { 1: '入學生', 2: '打底層', 3: '鑽石', 4: '至尊', 5: '皇家至尊' }, STATUS = { W: '未啟用', Y: '啟用', D: '停用', N: '停權' };\n  function levelNames() { /* 在會員資料查詢頁時，以頁面上的級別選單為準（後台新增級別時自動跟上） */\n    var m = {}, sel = document.querySelector('table tbody tr td:nth-child(4) select');\n    if (sel) Array.prototype.forEach.call(sel.options, function (o) { if (o.value) m[o.value] = o.text.trim(); });\n    return Object.keys(m).length ? m : LEVELS;\n  }\n  async function getJSON(path, q) {\n    var u = new URL(path, location.origin); Object.keys(q || {}).forEach(function (k) { u.searchParams.set(k, q[k]); });\n    var r = await fetch(u.href, { credentials: 'include', headers: { Accept: 'application/json' } });\n    if (r.status === 401 || r.status === 403 || /\\/admin\\/?(login)?$/.test(new URL(r.url).pathname)) throw new Error('學院後台登入已逾時，請重新登入後再點書籤。');\n    if (!r.ok) throw new Error('學院後台回應 ' + r.status);\n    return r.json();\n  }\n  function toRow(m, lv) {\n    var uid = String(m.uid || '').trim(), reg = String(m.registered_at || '').match(/^(\\d{4})-(\\d{2})-(\\d{2})/);\n    return { id: m.id, account: uid, name: String(m.name || '').trim(), email: /@/.test(uid) ? uid.toLowerCase() : '', ig: '', lineId: '', level: lv[m.level] || String(m.level || ''), status: STATUS[m.status] || String(m.status || ''), regDate: reg ? reg[1] + '.' + reg[2] + '.' + reg[3] : '' };\n  }\n  async function scan(onProgress) {\n    var prog = onProgress || function () {};\n    if (!/(^|\\.)graceschool\\.com\\.tw$/.test(location.hostname)) throw new Error('請在學院官網後台（www.graceschool.com.tw/admin/）的頁面上點這個書籤。');\n    var lv = levelNames(), list = [], page = 1, maxPage = 1, total = 0;\n    do {\n      prog('名單第 ' + page + ' 頁', 0);\n      var j = await getJSON('/api/admin/members', { curPage: page, maxPerPage: PER });\n      if (!j || !Array.isArray(j.data)) throw new Error('學院後台的會員資料格式不同，無法讀取。');\n      list = list.concat(j.data); maxPage = Number(j.page && j.page.maxPage) || 1; total = Number(j.page && j.page.counts) || list.length; page++;\n    } while (page <= maxPage && page <= 50);\n    var seen = {}, rows = [];\n    list.forEach(function (m) { var r = toRow(m, lv); if (r.account && !seen[r.account]) { seen[r.account] = 1; rows.push(r); } });\n    var done = 0, fail = 0, k = 0;\n    async function worker() {\n      while (k < rows.length) {\n        var r = rows[k++];\n        try { var d = (await getJSON('/api/admin/members/' + encodeURIComponent(r.id))).data || {}; r.ig = String(d.ig_id || '').trim().replace(/^@/, ''); r.lineId = String(d.line_id || '').trim(); }\n        catch (e) { if (/逾時/.test(e.message)) throw e; fail++; }\n        done++; if (done % 20 === 0 || done === rows.length) prog('IG／LINE ' + done + ' / ' + rows.length, done / rows.length);\n      }\n    }\n    var ws = []; for (var w = 0; w < CONC; w++) ws.push(worker()); await Promise.all(ws);\n    rows.forEach(function (r) { delete r.id; });\n    return { rows: rows, total: total, pages: maxPage, detailFail: fail };\n  }\n  function askPassword(info, note) {\n    step(1); bar(60);\n    return new Promise(function (res, rej) {\n      $('gsf').innerHTML = '<div style=\"margin-top:8px\"><div style=\"display:flex;gap:8px\"><input id=\"gsp\" type=\"password\" autocomplete=\"current-password\" placeholder=\"後台密碼\" style=\"flex:1;min-width:0;min-height:44px;padding:0 14px;border:0;border-radius:14px;background:#E4E4E2;box-shadow:inset 3px 3px 6px rgba(163,163,160,.6),inset -3px -3px 6px rgba(255,255,255,.9);font:inherit;outline:none\"><button id=\"gsg\" style=\"min-height:44px;padding:0 16px;border:0;border-radius:999px;background:linear-gradient(180deg,#2B2D35,#08090C);color:#F4F2EC;font:inherit;font-weight:500;cursor:pointer\">上傳</button></div><div style=\"font-size:12px;color:#545452;margin-top:6px\">密碼只用來在這台電腦推導加密金鑰，不會被送出；上傳成功後會記住推導出的金鑰，之後不用再輸入。</div></div>';\n      msg((note || '') + '已掃描 ' + info.rows.length + ' 筆（後台共 ' + info.total + ' 筆）' + (info.detailFail ? '，其中 ' + info.detailFail + ' 筆讀不到 IG／LINE' : '') + '。');\n      var go = function () { var v = $('gsp').value; if (v.length < 8) { msg('密碼至少 8 碼', true); return; } $('gsf').innerHTML = ''; res(v); };\n      $('gsg').onclick = go; $('gsp').onkeydown = function (e) { if (e.key === 'Enter') go(); }; $('gsp').focus();\n    });\n  }\n  function ApiErr(code, m) { this.code = code; this.message = m || code; }\n  async function post(body) {\n    var r = await fetch(GAS, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });\n    var j; try { j = await r.json(); } catch (e) { throw new ApiErr('NET', '資料中心回應格式錯誤'); }\n    if (!j.ok) throw new ApiErr(j.error && j.error.code || 'SERVER', j.error && j.error.msg || j.error && j.error.code || '資料中心錯誤'); return j.data;\n  }\n  async function postRetry(body) {\n    for (var a = 0; ; a++) {\n      try { return await post(body); }\n      catch (e) { var net = !(e instanceof ApiErr) || e.code === 'NET'; if (!net || a >= 2) throw net ? new ApiErr('NET', '連不上資料中心，請確認網路後再點一次書籤') : e; msg('連線不穩，' + (2 << a) + ' 秒後重送…'); await new Promise(function (r) { setTimeout(r, (2 << a) * 1000); }); }\n    }\n  }\n  var sid = function () { var a = new Uint8Array(12); crypto.getRandomValues(a); return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); };\n  async function upload(rows, bmKey) {\n    step(2); msg('分批加密中…');\n    var batches = packRows(rows, BODY_TARGET), syncId = sid(), last = null, sent = 0;\n    for (var c = 0; c < batches.length; c++) {\n      step(2, (c + 1) + ' / ' + batches.length); bar(60 + 40 * (c + 1) / batches.length);\n      msg('上傳第 ' + (c + 1) + ' 批（' + (sent + batches[c].length) + ' / ' + rows.length + ' 筆）');\n      var pkt = await bmEncrypt(bmKey, JSON.stringify({ ts: Date.now(), syncId: syncId, chunk: c, chunks: batches.length, n: rows.length, source: location.hostname + location.pathname, rows: batches[c] }));\n      var body = { op: 'student.sync', data: pkt };\n      if (JSON.stringify(body).length > BODY_MAX) throw new Error('單批資料過大（' + Math.round(JSON.stringify(body).length / 1024) + ' KB），請回報。');\n      last = await postRetry(body); sent += batches[c].length;\n    }\n    return last;\n  }\n  async function run(info) {\n    var st = await post({ op: 'admin.status', data: {} });\n    if (!st.setup) throw new Error('後台尚未設定密碼，請先在總覽後台完成首次設定。');\n    var saved = lsGet(), note = '';\n    if (saved) {\n      step(1, '已記住此電腦'); bar(60);\n      try { return await upload(info.rows, saved); }\n      catch (e) { if (!(e instanceof ApiErr) || e.code !== 'UNAUTHORIZED') throw e; lsDel(); keyNote(); note = '後台密碼已變更，請重新輸入一次。　'; }\n    }\n    var pw = await askPassword(info, note);\n    msg('推導金鑰中…');\n    var keys = await deriveKeys(pw, st.pwSalt);\n    var r = await upload(info.rows, keys.bmKey);\n    lsSet(keys.bmKey); keyNote();\n    return r;\n  }\n  (async function () {\n    try {\n      keyNote(); step(0); var info = await scan(function (t, p) { step(0, t); bar(50 * p); }); bar(50);\n      if (window.__graceSyncDry) { window.__graceSyncDryResult = info; step(4); msg('試掃完成（未上傳）：' + info.rows.length + ' 筆。'); window.__graceSyncRunning = false; return; }\n      if (!info.rows.length) throw new Error('列表裡沒有讀到任何學員。');\n      var r = await run(info);\n      step(4); bar(100); msg('同步完成：' + r.n + ' 筆（新增 ' + r.added + '・更新 ' + r.updated + '）。可以關閉這個面板。');\n    } catch (e) { msg(String(e && e.message || e), true); if (cur < 0) step(0); }\n    window.__graceSyncRunning = false;\n  })();\n})('__GAS__');\n})();";
/* G.R.A.C.E 總覽後台｜單頁應用（無框架）
   路由：#/login、#/overview、#/list、#/person/<who>、#/repeat、#/tools
   資料：window.HUB_CFG = { gas, mock }；mock 時改走 window.HubMock（預覽）
   安全：後台 token 存 localStorage['gh.at']（勾「記住此裝置」）或 sessionStorage；密碼在瀏覽器以 PBKDF2 推導後才送出 */
(function () {
  'use strict';
  var CFG = window.HUB_CFG || {};
  var MOCK = !!CFG.mock;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var ic = function (id, cls) { return '<svg class="' + (cls || 'i') + '" aria-hidden="true" focusable="false"><use href="#' + id + '"/></svg>'; };
  var fmt = function (n) { return Number(n || 0).toLocaleString('en-US'); };
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  var tpe = function (t) { var d = new Date(Number(t) + 8 * 3600e3); return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), wd: d.getUTCDay() }; };
  var fDate = function (t) { var p = tpe(t); return p.y + '.' + pad(p.mo) + '.' + pad(p.d); };
  var fMD = function (t) { var p = tpe(t); return pad(p.mo) + '.' + pad(p.d); };
  var fHM = function (t) { var p = tpe(t); return pad(p.h) + ':' + pad(p.mi); };
  var fMDHM = function (t) { return t ? fMD(t) + ' ' + fHM(t) : '—'; };
  var WD = '日一二三四五六';
  var M = function () { return window.innerWidth < 900; };
  var GSVG = '<svg viewBox="0 0 24 24"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3z"/><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z"/><path fill="#FBBC05" d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1a10 10 0 0 0 0 9.2z"/><path fill="#EA4335" d="M12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.4L6.4 10C7.2 7.7 9.4 6 12 6z"/></svg>';
  var SRC = function (s) { return s === 'line' ? '<span class="srcI l" title="LINE 登入"><svg viewBox="0 0 24 24"><use href="#i-linef"/></svg></span>' : s === 'google' ? '<span class="srcI g" title="Google 登入">' + GSVG + '</span>' : ''; };
  var STCLS = function (s) { return /啟用中|^啟用$|正常|active/i.test(s) && !/未啟用/.test(s) ? 'on' : /停權|封鎖|ban/i.test(s) ? 'ban' : /停用|未啟用|inactive/i.test(s) ? 'off' : ''; };
  var LVCLS = function (l) { return /至尊/.test(l) ? ' top' : ''; };

  /* ---------- 儲存 ---------- */
  var store = {
    get: function (k) { try { return localStorage.getItem(k) || sessionStorage.getItem(k) || ''; } catch (e) { return mem[k] || ''; } },
    set: function (k, v, persist) { try { (persist ? localStorage : sessionStorage).setItem(k, v); (persist ? sessionStorage : localStorage).removeItem(k); } catch (e) { mem[k] = v; } },
    del: function (k) { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch (e) { } delete mem[k]; }
  };
  var mem = {};
  var AT = store.get('gh.at');

  /* ---------- API ---------- */
  var ApiError = function (code, msg) { this.code = code; this.msg = msg || code; };
  /* 只有會改狀態的 op 不自動重送；其餘讀取類的 op 遇到網路層失敗（fetch TypeError／JSON 解析失敗）會隔 1 秒再試一次 */
  var NO_RETRY = { 'admin.setup': 1, 'admin.login': 1, 'admin.changePassword': 1, 'admin.removeSession': 1, 'admin.logoutAll': 1, 'admin.setIg': 1 };
  var NET_MSG = '連不上資料中心（網路或 Google 暫時沒有回應），請再試一次';
  var sleep = function (ms) { return new Promise(function (res) { setTimeout(res, ms); }); };
  var POST_TIMEOUT = 25000;   /* 資料中心一次呼叫通常 1–3 秒；冷啟動可能較久，超過 25 秒視為網路層失敗（會自動重試一次） */
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
      if (!CFG.gas) throw new ApiError('CONFIG', '尚未設定資料中心網址（hub.json 的 gas）');
      try { j = await post(body); }
      catch (e1) {
        var net = e1 instanceof ApiError ? e1 : new ApiError('NET', NET_MSG);
        if (NO_RETRY[op]) throw net;
        await sleep(1000);
        try { j = await post(body); } catch (e2) { throw e2 instanceof ApiError ? e2 : net; }
      }
    }
    if (!j.ok) throw new ApiError(j.error && j.error.code || 'SERVER', j.error && j.error.msg);
    return j.data;
  }
  function deviceLabel() {
    var ua = navigator.userAgent, os = /iPhone|iPad/.test(ua) ? (/iPad/.test(ua) ? 'iPad' : 'iPhone') : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : '裝置';
    var br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox/.test(ua) ? 'Firefox' : '瀏覽器';
    return os + '・' + br;
  }

  /* ---------- 提示 ---------- */
  function toast(text, bad) {
    var box = $('.toasts') || (function () { var d = document.createElement('div'); d.className = 'toasts'; d.setAttribute('aria-live', 'polite'); document.body.appendChild(d); return d; })();
    var t = document.createElement('div'); t.className = 'toast' + (bad ? ' bad' : ''); t.textContent = text; box.appendChild(t);
    setTimeout(function () { t.classList.add('out'); setTimeout(function () { t.remove(); }, 220); }, 2800);
  }

  /* ---------- 路由 ---------- */
  var app = $('#app'), state = { ov: { range: 'today' }, rp: { range: '7d', by: 'ig' }, ls: { filter: 'all', q: '', level: '', status: '', page: 0 }, me: null, status: null };
  function route() { var h = location.hash.replace(/^#\/?/, ''), p = h.split('/'); return { v: p[0] || 'overview', arg: decodeURIComponent(p.slice(1).join('/') || '') }; }
  function go(h) { location.hash = '#/' + h; }
  window.addEventListener('hashchange', render);

  async function boot() {
    if (MOCK && window.HubCrypto && window.HubMock) { try { var k = await window.HubCrypto.deriveKeys('demo2026', 'bW9jay1zYWx0'); window.HubMock.demoKey = k.pwKey; } catch (e) { } }
    if (AT) {
      /* 已有 token：先把外框與骨架畫出來（否則等資料中心回應前整頁是空的灰底），再驗 token */
      var r0 = route(), v0 = { overview: overview, list: list, person: person, repeat: repeat, tools: tools }[r0.v] || overview;
      app.innerHTML = shell(r0.v === 'person' ? 'list' : (v0 === overview ? 'overview' : r0.v));
      $('.main').innerHTML = '<div class="page">' + v0.skeleton() + '</div>';
      try { state.me = await api('admin.me'); } catch (e) { if (e.code === 'UNAUTHORIZED') { AT = ''; store.del('gh.at'); } else { shellError(e); return; } }
      var ls = state.me && state.me.lastSync, sf = $('.side-foot [data-sync]'); if (sf) sf.innerHTML = syncFoot(ls);
    }
    render();
  }
  function shellError(e) { app.innerHTML = '<main class="login"><div class="lg-card"><img class="logo" src="' + IMG.logo + '" alt="G.R.A.C.E Academy"><h1>總覽後台</h1><p class="msg bad">連不上資料中心：' + esc(e.msg || e.message || e) + '</p><button class="cta cta-main gl gl-ink" type="button" onclick="location.reload()"><span>重新整理</span><span class="go">' + ic('i-redo') + '</span></button></div></main>'; }

  async function render() {
    var r = route();
    if (!AT) { await loginPage(); return; }
    if (r.v === 'login') { go('overview'); return; }
    var view = { overview: overview, list: list, person: person, repeat: repeat, tools: tools }[r.v] || overview;
    var cur = r.v === 'person' ? 'list' : (view === overview ? 'overview' : r.v);
    if (!$('.shell')) app.innerHTML = shell(cur); else setNav(cur);
    var main = $('.main');
    main.innerHTML = '<div class="page">' + view.skeleton() + '</div>';
    window.scrollTo(0, 0);
    try { var html = await view(r.arg); if (route().v !== r.v || route().arg !== r.arg) return; main.innerHTML = '<div class="page">' + html + '</div>'; view.after && view.after(main, r.arg); }
    catch (e) { if (e.code === 'UNAUTHORIZED') { AT = ''; store.del('gh.at'); toast('登入已失效，請重新登入', true); render(); return; } main.innerHTML = '<div class="page"><div class="pn"><div class="empty"><b>讀取失敗</b>' + esc(e.msg || e.message || e) + '</div></div></div>'; }
  }
  var FRONT = 'https://grace63188.github.io/grace-IG/';
  function frontLink(cls) { return '<a class="front btn-s gl gl-clear ' + cls + '" href="' + FRONT + '" target="_blank" rel="noopener" aria-label="查看前台（另開新分頁）">' + ic('i-ext') + '<span>查看前台</span></a>'; }
  var NAV = [['overview', '總覽', 'i-home'], ['list', '名單', 'i-people'], ['repeat', '重複點擊', 'i-repeat'], ['tools', '工具設定', 'i-gear']];
  function shell(cur) {
    var ls = state.me && state.me.lastSync;
    return '<div class="shell"><aside class="side"><div class="brandmark"><img src="' + IMG.mark + '" alt=""><span><b>總覽後台</b><small>G.R.A.C.E 全平台</small></span></div>' +
      '<nav class="nav-ad" aria-label="後台">' + NAV.map(function (n) { return '<a href="#/' + n[0] + '" data-nav="' + n[0] + '" ' + (n[0] === cur ? 'aria-current="page"' : '') + '>' + ic(n[2]) + n[1] + '</a>'; }).join('') + '</nav>' +
      frontLink('front-side') + '<div class="side-foot"><span><i class="dotok"></i>資料中心' + (MOCK ? '（預覽假資料）' : '連線正常') + '</span><span data-sync>' + syncFoot(ls) + '</span><a class="back" href="#" data-act="logout" style="color:var(--ink-3)">登出這台裝置</a></div></aside>' +
      '<header class="mbar"><img src="' + IMG.mark + '" alt=""><b>總覽後台</b><span class="sp"></span>' + frontLink('front-m') + '<span class="fresh" style="width:auto"><i class="dotok"></i>' + fHM(Date.now()) + '</span></header>' +
      '<main class="main" id="main"></main>' +
      '<nav class="tabbar" aria-label="後台">' + NAV.map(function (n) { return '<a href="#/' + n[0] + '" data-nav="' + n[0] + '" ' + (n[0] === cur ? 'aria-current="page"' : '') + '>' + ic(n[2]) + n[1] + '</a>'; }).join('') + '</nav></div>';
  }
  function syncFoot(ls) { return '學員同步 <b class="en">' + (ls ? fMDHM(ls.at) : '尚未') + '</b>' + (ls ? '・<span class="en">' + fmt(ls.n) + '</span> 筆' : ''); }
  function setNav(cur) { document.querySelectorAll('[data-nav]').forEach(function (a) { if (a.dataset.nav === cur) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }); }
  document.addEventListener('click', function (e) {
    var a = e.target.closest('[data-act="logout"]'); if (!a) return; e.preventDefault();
    AT = ''; store.del('gh.at'); state.me = null; toast('已登出這台裝置'); render();
  });

  /* ---------- 登入／首次設定 ---------- */
  async function loginPage() {
    var st = state.status;
    if (!st) { try { st = state.status = await api('admin.status'); } catch (e) { shellError(e); return; } }
    var setup = !st.setup;
    var eye = '<button class="eye" type="button" data-eye aria-label="顯示密碼">' + ic('i-eye') + '</button>';
    app.innerHTML = '<main class="login"><form class="lg-card" id="lf" novalidate><img class="logo" src="' + IMG.logo + '" alt="G.R.A.C.E Academy"><h1>總覽後台</h1><p class="cap2">G.R.A.C.E 全平台總覽</p>' +
      (setup ? (st.setupOpen
        ? '<p class="intro"><b>首次設定</b>　這個資料中心還沒有後台密碼。請設定一組至少 8 碼的密碼；密碼只存雜湊在 Google Apps Script，程式碼與試算表裡都不會出現。</p>' +
          '<div class="fld"><label for="pw">設定後台密碼</label><div class="inp"><input id="pw" type="password" autocomplete="new-password" placeholder="至少 8 碼" required>' + eye + '</div><div class="strength" aria-hidden="true"><i></i><i></i><i></i><i></i></div></div>' +
          '<div class="fld"><label for="pw2">再輸入一次</label><div class="inp"><input id="pw2" type="password" autocomplete="new-password" placeholder="再輸入一次" required>' + eye + '</div></div>'
        : '<p class="msg bad">首次設定的時間已過（部署後 30 分鐘內）。請到 Apps Script 的專案設定 → 指令碼屬性，新增 <b>SETUP_OPEN</b>＝<b>1</b>，再重新整理這一頁。</p>')
        : '<div class="fld"><label for="pw">後台密碼</label><div class="inp"><input id="pw" type="password" autocomplete="current-password" placeholder="輸入後台密碼" required autofocus>' + eye + '</div></div>') +
      (setup && !st.setupOpen ? '' : '<label class="chk"><input type="checkbox" id="rm" checked><span class="bx">' + ic('i-check') + '</span><span>記住此裝置<small>（一年）</small></span></label>' +
      '<div id="lmsg" hidden></div>' +
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
        toast(setup ? '密碼已設定，歡迎進入後台' : '歡迎回來'); go('overview'); render();
      } catch (err) {
        var text = err.msg || err.message || '失敗';
        if (err.code === 'NET' && setup) {
          /* 網路層失敗時資料中心可能已經把密碼建好只是回應沒送回來：重查狀態，已建好就切到登入 */
          try { var st2 = await api('admin.status'); if (st2.setup && !st2.setupOpen) { state.status = st2; toast('密碼已建立，請用剛才輸入的密碼登入'); loginPage(); return; } } catch (e2) { }
          text = NET_MSG + '；若再出現，請重新整理後再設定一次';
        }
        showMsg(m, text, true); busy = false; btn.disabled = false; btn.removeAttribute('aria-busy'); btn.querySelector('.go').innerHTML = ic('i-arrow');
      }
    });
  }
  function showMsg(el, t, bad) { el.hidden = false; el.className = 'msg' + (bad ? ' bad' : ''); el.textContent = t; }

  /* ---------- 共用片段 ---------- */
  var titleRow = function (h, sub, extra) { return '<div class="trow"><h1>' + h + '</h1><span class="sub">' + sub + '</span><span class="sp"></span>' + (extra || '') + '</div>'; };
  var rangeSeg = function (sel, name) { return '<div class="seg rng" role="tablist" aria-label="時間範圍" data-seg="' + name + '">' + [['today', '今日'], ['7d', '7 天'], ['30d', '30 天']].map(function (t) { return '<button role="tab" aria-selected="' + (t[0] === sel) + '" data-v="' + t[0] + '" type="button">' + t[1] + '</button>'; }).join('') + '</div>'; };
  var scrollWrap = function (inner, minw) { return M() ? '<div class="hscroll" data-scroll><div style="min-width:' + minw + 'px">' + inner + '</div></div><p class="hint">' + ic('i-swipe') + '左右滑動看完整</p>' : inner; };
  var skelPn = function (h) { return '<div class="pn skel-pn"><div class="skel" style="width:30%;height:16px"></div><div class="skel" style="height:' + (h || 120) + 'px"></div></div>'; };
  var who2href = function (w) { return '#/person/' + encodeURIComponent(w); };
  var avatar = function (p, cls) { return '<span class="av ' + (cls || '') + '">' + (p.pic ? '<img src="' + esc(p.pic) + '" alt="" referrerpolicy="no-referrer">' : (p.pid ? esc((p.name || '訪')[0]) : '<svg class="i" style="width:16px;height:16px;opacity:.8" aria-hidden="true"><use href="#i-people"/></svg>')) + '</span>'; };

  /* ---------- 圖表 ---------- */
  function lineChart(tr, w, h) {
    w = w || 640; h = h || 220;
    var n = tr.days.length, L = n - 1, pt = 14, pb = 26, max = Math.max(10, Math.ceil(Math.max.apply(null, tr.ability.concat(tr.career)) / 10) * 10);
    /* 左右留白依標籤長度計算（數字 6.6px／字、中文 11px／字），6 位數也不會被切掉 */
    var digW = function (v) { return String(fmt(v)).length * 6.6; };
    var pl = Math.max(30, Math.ceil(digW(max) + 12)), pr = Math.ceil(10 + 44 + 4 + Math.max(digW(tr.ability[L]), digW(tr.career[L])) + 4);
    var X = function (i) { return pl + (n > 1 ? i * (w - pl - pr) / (n - 1) : (w - pl - pr) / 2); }, Y = function (v) { return pt + (1 - v / max) * (h - pt - pb); };
    var ticks = [0, max / 2, max];
    var grid = ticks.map(function (v) { return '<line x1="' + pl + '" x2="' + (w - pr + 8) + '" y1="' + Y(v) + '" y2="' + Y(v) + '" stroke="var(--grid)"/><text x="' + (pl - 8) + '" y="' + (Y(v) + 4) + '" text-anchor="end">' + fmt(v) + '</text>'; }).join('');
    /* x 軸標籤從最後一天往回等距取，最後兩個標籤不會擠在一起 */
    var step = n > 10 ? Math.ceil(n / 8) : 1;
    var xl = tr.days.map(function (d, i) { return (L - i) % step === 0 ? '<text x="' + X(i) + '" y="' + (h - 6) + '" text-anchor="middle">' + d + '</text>' : ''; }).join('');
    var path = function (vals) { return vals.map(function (v, i) { return (i ? 'L' : 'M') + X(i) + ',' + Y(v); }).join(''); };
    /* 末端標籤：兩條線數值接近時上下推開，至少相隔 15px */
    var ya = Y(tr.ability[L]) + 4, yc = Y(tr.career[L]) + 4, gap = 15;
    if (Math.abs(ya - yc) < gap) { var mid = (ya + yc) / 2, aUp = tr.ability[L] >= tr.career[L]; ya = mid + (aUp ? -gap / 2 : gap / 2); yc = mid + (aUp ? gap / 2 : -gap / 2); }
    var lo = pt + 10, hi = h - pb - 2; if (Math.max(ya, yc) > hi) { var sh = Math.max(ya, yc) - hi; ya -= sh; yc -= sh; } if (Math.min(ya, yc) < lo) { var sh2 = lo - Math.min(ya, yc); ya += sh2; yc += sh2; }
    var ly = { ability: ya, career: yc };
    var s = [['ability', 'var(--ab)', '能力健檢', ''], ['career', 'var(--cr)', '職涯定位', 'stroke-dasharray="5 4"']].map(function (c) {
      var v = tr[c[0]];
      return '<path d="' + path(v) + '" fill="none" stroke="' + c[1] + '" stroke-width="2" ' + c[3] + ' stroke-linejoin="round" stroke-linecap="round"/><circle cx="' + X(L) + '" cy="' + Y(v[L]) + '" r="4.5" fill="' + c[1] + '" stroke="var(--clay)" stroke-width="2"/><text class="cj ink" x="' + (X(L) + 10) + '" y="' + ly[c[0]] + '">' + c[2] + ' ' + fmt(v[L]) + '</text>';
    }).join('');
    var hits = tr.days.map(function (d, i) { var x0 = i ? (X(i - 1) + X(i)) / 2 : pl, x1 = i < n - 1 ? (X(i) + X(i + 1)) / 2 : w - pr + 8; return '<rect class="hit" data-i="' + i + '" x="' + x0 + '" y="' + pt + '" width="' + (x1 - x0) + '" height="' + (h - pt - pb) + '"/>'; }).join('');
    var cross = '<g class="cross" style="opacity:0;transition:opacity 160ms"><line y1="' + pt + '" y2="' + (h - pb) + '" stroke="var(--ink-3)"/><circle r="5" fill="var(--ab)" stroke="var(--clay)" stroke-width="2"/><circle r="5" fill="var(--cr)" stroke="var(--clay)" stroke-width="2"/></g>';
    return '<div class="rel" data-chart="line"><svg class="vz" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="每日測驗完成數">' + grid + xl + s + cross + hits + '</svg><div class="tip"></div></div>';
  }
  /* 提示框：限制在可見範圍內（視窗、可橫滑容器），上方放不下就改放到格子下方 */
  function clampTip(tip, box, cell) {
    var vw = document.documentElement.clientWidth, m = 8, L = m, T = m, Rr = vw - m;
    for (var n = box.parentElement; n && n !== document.body; n = n.parentElement) { var cs = getComputedStyle(n); if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') { var c = n.getBoundingClientRect(); L = Math.max(L, c.left + 4); Rr = Math.min(Rr, c.right - 4); T = Math.max(T, c.top); } }
    var r = tip.getBoundingClientRect(), dx = 0;
    if (r.left < L) dx = L - r.left; else if (r.right > Rr) dx = Math.max(L - r.left, Rr - r.right);
    if (dx) tip.style.left = (parseFloat(tip.style.left) + dx) + 'px';
    if (cell && r.top < T) tip.style.transform = 'translate(-50%,' + (cell.height + 8) + 'px)';   // 上方放不下：改放格子下方
  }
  function bindLine(root, tr) {
    root.querySelectorAll('[data-chart="line"]').forEach(function (box) {
      var svg = box.querySelector('svg'), tip = box.querySelector('.tip'), cross = svg.querySelector('.cross'), circles = cross.querySelectorAll('circle'), line = cross.querySelector('line');
      var vb = svg.viewBox.baseVal;
      var show = function (i) {
        var r = svg.querySelector('.hit[data-i="' + i + '"]'); if (!r) return;
        var x = r.x.baseVal.value + r.width.baseVal.value / 2, pts = svg.querySelectorAll('path');
        var yA = pointY(pts[0], i, tr.days.length), yC = pointY(pts[1], i, tr.days.length);
        line.setAttribute('x1', x); line.setAttribute('x2', x); circles[0].setAttribute('cx', x); circles[0].setAttribute('cy', yA); circles[1].setAttribute('cx', x); circles[1].setAttribute('cy', yC); cross.style.opacity = 1;
        tip.innerHTML = '<span class="en">' + tr.days[i] + '</span><br><i style="background:var(--ab)"></i>能力健檢 <b>' + tr.ability[i] + '</b><br><i style="background:var(--cr)"></i>職涯定位 <b>' + tr.career[i] + '</b>';
        var pct = x / vb.width, left = pct > .7; tip.style.left = (pct * box.clientWidth) + 'px'; tip.style.top = '0'; tip.style.transform = left ? 'translate(-108%,4px)' : 'translate(12px,4px)'; tip.classList.add('on'); clampTip(tip, box);
      };
      var hide = function () { cross.style.opacity = 0; tip.classList.remove('on'); };
      svg.addEventListener('pointermove', function (e) { var t = e.target.closest('.hit'); if (t) show(Number(t.dataset.i)); });
      svg.addEventListener('pointerleave', hide);
      svg.addEventListener('click', function (e) { var t = e.target.closest('.hit'); if (t) show(Number(t.dataset.i)); });
    });
    function pointY(path, i, n) { var d = path.getAttribute('d').split(/[ML]/).filter(Boolean); var p = d[i].split(','); return Number(p[1]); }
  }
  function stageBlock(st) {
    var tot = st.reduce(function (a, b) { return a + b.v; }, 0), C = ['var(--r1)', 'var(--r2)', 'var(--r3)', 'var(--r4)'];
    return '<div class="subh"><span>能力健檢・4 階段</span><span class="en">' + fmt(tot) + ' 份</span></div>' +
      (tot ? '<div class="stack">' + st.map(function (s, i) { return '<span style="flex:' + s.v + ';background:' + C[i] + '" title="' + esc(s.label) + ' ' + s.v + '"></span>'; }).join('') + '</div>' : '<div class="stack"><span style="flex:1;background:var(--r0)"></span></div>') +
      '<div class="stk-l">' + st.map(function (s, i) { return '<div><i style="background:' + C[i] + '"></i>' + esc(s.label) + '<b class="en">' + s.v + '<span style="color:var(--ink-3);font-weight:400;font-size:12px"> ・' + (tot ? Math.round(s.v / tot * 100) : 0) + '%</span></b></div>'; }).join('') + '</div>';
  }
  function roleBlock(ro) {
    var tot = ro.reduce(function (a, b) { return a + b.v; }, 0), mx = Math.max(1, ro[0] ? ro[0].v : 1), G = ['var(--g1)', 'var(--g2)', 'var(--g3)', 'var(--g4)', 'var(--g5)', 'var(--g6)'];
    return '<div class="subh" style="margin-top:20px"><span>職涯定位・6 角色（主角色）</span><span class="en">' + fmt(tot) + ' 份</span></div>' +
      ro.map(function (r, i) { return '<div class="hb' + (i === 0 && r.v ? ' top' : '') + '"><span class="n">' + esc(r.label) + '</span><span class="t" style="--c:' + G[i] + ';width:' + (r.v / mx * 100) + '%"></span><span class="v">' + r.v + '</span></div>'; }).join('');
  }
  function clickBlock(ck, compact) {
    var mx = 1; ck.groups.forEach(function (g) { g.rows.forEach(function (r) { mx = Math.max(mx, r.v); }); });
    if (!ck.total) return '<div class="empty">這段期間還沒有點擊。</div>';
    return ck.groups.map(function (g) { return g.rows.length ? '<p class="grp">' + esc(g.name) + '</p>' + g.rows.map(function (r) { return '<div class="hb" style="grid-template-columns:' + (compact ? '6.6em' : '8.2em') + ' minmax(0,1fr) 3em"><span class="n">' + esc(r.label) + '</span><span class="t" style="--c:' + (g.name === '入口鍵' ? 'var(--ab)' : 'var(--r1)') + ';width:' + (r.v / mx * 100) + '%"></span><span class="v">' + r.v + '</span></div>'; }).join('') : ''; }).join('');
  }
  function heat(hm) {
    var col = function (v) { return v === 0 ? 'var(--r0)' : v < 4 ? 'var(--r1)' : v < 8 ? 'var(--r2)' : v < 12 ? 'var(--r3)' : 'var(--r4)'; };
    var rows = hm.days.length > 7 ? hm.days.slice(-7) : hm.days, off = hm.days.length - rows.length;
    var h = '<div class="hm" role="img" aria-label="分時點擊熱度">';
    rows.forEach(function (d, i) { h += '<span class="rl">' + d.key + '</span>' + hm.grid[off + i].map(function (v, k) { return '<span class="cl" style="background:' + col(v) + '" data-t="' + d.key + '（' + d.wd + '）' + k + ':00・' + v + ' 次"></span>'; }).join(''); });
    h += '<span></span>' + Array.from({ length: 24 }, function (_, k) { return '<span class="xl">' + (k % 3 === 0 ? k : '') + '</span>'; }).join('') + '</div>';
    h += '<div class="hm-lg">少<i style="background:var(--r0)"></i><i style="background:var(--r1)"></i><i style="background:var(--r2)"></i><i style="background:var(--r3)"></i><i style="background:var(--r4)"></i>多<span style="margin-left:auto">尖峰　<b style="color:var(--ink);font-weight:500">' + (hm.peak ? hm.peak.day + '（' + hm.peak.wd + '）' + hm.peak.hour + ':00–' + (hm.peak.hour + 1) + ':00・' + hm.peak.v + ' 次' : '—') + '</b></span></div>';
    return '<div class="rel" data-chart="heat">' + h + '<div class="tip"></div></div>';
  }
  function bindHeat(root) {
    root.querySelectorAll('[data-chart="heat"]').forEach(function (box) {
      var tip = box.querySelector('.tip');
      box.addEventListener('pointerover', function (e) { var c = e.target.closest('.cl'); if (!c) return; tip.textContent = c.dataset.t; var r = c.getBoundingClientRect(), b = box.getBoundingClientRect(); tip.style.left = (r.left - b.left + r.width / 2) + 'px'; tip.style.top = (r.top - b.top) + 'px'; tip.style.transform = 'translate(-50%,calc(-100% - 8px))'; tip.classList.add('on'); clampTip(tip, box, r); });
      box.addEventListener('pointerout', function (e) { if (e.target.closest('.cl')) tip.classList.remove('on'); });
    });
  }
  function funnel(fn) {
    var mx = Math.max(1, fn[0].v);
    var worst = -1, wr = 101; fn.forEach(function (c, i) { if (i && c.rate < wr && fn[i - 1].v) { wr = c.rate; worst = i; } });
    if (M()) return fn.map(function (c, i) { return '<div class="hb' + (i === 4 ? ' top' : '') + '" style="grid-template-columns:4.6em minmax(0,1fr) 5.6em;min-height:34px"><span class="n">' + c.label + '</span><span class="t" style="--c:' + (i === 4 ? '#B8975A' : 'var(--r3)') + ';height:16px;width:' + (c.v / mx * 100) + '%"></span><span class="v">' + c.v + '<span style="color:' + (i === worst ? 'var(--neg)' : 'var(--ink-3)') + ';font-size:11.5px">' + (i ? ' ・' + c.rate + '%' : '') + '</span></span></div>'; }).join('');
    var C = ['var(--r1)', 'var(--r1)', 'var(--r2)', 'var(--r2)', '', 'var(--r3)'];
    return '<div class="fun-top">' + fn.map(function (c, i) { return '<div class="fs' + (i === 4 ? ' done' : '') + '"><div class="bar" style="--h:' + Math.round(c.v / mx * 168) + 'px;' + (C[i] ? '--c:' + C[i] : '') + '"></div></div>'; }).join('') + '</div>' +
      '<div class="fun-bot">' + fn.map(function (c, i) { return '<div class="fs' + (i === 4 ? ' done' : '') + '"><span class="nm">' + c.label + '</span><span class="ct">' + c.v + '</span><span class="rt">' + (i ? '上一步的 <b class="' + (i === worst ? 'ng' : '') + '">' + c.rate + '%</b>' : '獨立訪客') + '</span></div>'; }).join('') + '</div>';
  }

  /* ---------- 總覽 ---------- */
  async function overview() {
    var o = await api('admin.overview', { range: state.ov.range });
    state.ovData = o;
    var now = Date.now(), p = tpe(now);
    var head = titleRow('總覽', fDate(now) + '（' + WD[p.wd] + '）', rangeSeg(state.ov.range, 'ov') + '<span class="fresh"><i class="dotok"></i>資料更新 ' + fHM(now) + '</span>');
    var find = '<div class="find"><span class="k">' + ({ today: '今日重點', '7d': '7 天重點', '30d': '30 天重點' }[state.ov.range]) + '</span><p>' + esc(o.finding.text).replace(/(\d+)/g, '<b class="en">$1</b>') + '</p>' + (o.finding.lost ? '<a class="cta gl gl-ink" href="#/list" data-filter="guest"><span>查看未登入名單</span><span class="go">' + ic('i-arrow') + '</span></a>' : '') + '</div>';
    var kpis = '<div class="pn kpis" style="padding-left:4px;padding-right:4px">' + o.kpi.map(function (k) { return '<div class="kpi' + (k.done ? ' done' : '') + '"><p class="l">' + k.l + '</p><p class="v">' + fmt(k.v) + (k.u ? '<small>' + k.u + '</small>' : '') + '</p><p class="d">' + (k.d !== undefined ? '較前一期 <b class="' + (k.d < 0 ? 'ng' : '') + '">' + (k.d >= 0 ? '+' : '') + fmt(k.d) + '</b>' : esc(k.note || '')) + '</p></div>'; }).join('') + '</div>';
    var rangeName = { today: '今日', '7d': '近 7 天', '30d': '近 30 天' }[state.ov.range];
    var fun = '<div class="pn"><div class="pn-h"><h2>' + rangeName + '動線</h2><span class="s">進站 → 點入口 → 撕票 → 登入 → 完成測驗 → 點外連</span><span class="r">以獨立訪客計</span></div>' + funnel(o.funnel) + '</div>';
    var trend = '<div class="pn"><div class="pn-h"><h2>測驗完成趨勢</h2><span class="s">' + (state.ov.range === 'today' ? '近 7 天' : rangeName) + '・每日完成份數</span><span class="r lg"><span><i style="background:var(--ab)"></i>能力健檢</span><span><i class="dash"></i>職涯定位</span></span></div>' + scrollWrap(lineChart(o.trend, 640, M() ? 220 : 280), 560) + '</div>';
    var dist = '<div class="pn"><div class="pn-h"><h2>結果分布</h2><span class="s">' + rangeName + '</span></div>' + stageBlock(o.dist.stages) + roleBlock(o.dist.roles) + '</div>';
    var clicks = '<div class="pn"><div class="pn-h"><h2>點擊排行</h2><span class="s">' + rangeName + '・共 ' + fmt(o.clicks.total) + ' 次</span></div>' + clickBlock(o.clicks) + '</div>';
    var hm = '<div class="pn"><div class="pn-h"><h2>分時熱度</h2><span class="s">' + (o.heat.days.length > 7 ? '最近 7 天' : rangeName) + '・每小時點擊</span></div>' + scrollWrap(heat(o.heat), 620) + '<div class="hm-sum">' + o.heat.bands.map(function (b) { return '<div><p class="l">' + b.l + '</p><p class="v">' + b.v + '%<small>' + (b.v <= 1 ? '幾乎無人' : '全期點擊') + '</small></p></div>'; }).join('') + '</div></div>';
    if (M()) return head + find + kpis + fun + trend + dist + clicks + hm;
    return head + find + kpis + fun + '<div class="grid12"><div class="c7">' + trend + '</div><div class="c5">' + dist + '</div><div class="c5">' + clicks + '</div><div class="c7">' + hm + '</div></div>';
  }
  overview.skeleton = function () { return titleRow('總覽', '') + skelPn(60) + skelPn(180) + skelPn(200); };
  overview.after = function (main) {
    bindLine(main, state.ovData.trend); bindHeat(main);
    main.querySelector('[data-seg="ov"]').addEventListener('click', function (e) { var b = e.target.closest('[role=tab]'); if (!b) return; state.ov.range = b.dataset.v; render(); });
    var cta = main.querySelector('[data-filter]'); if (cta) cta.addEventListener('click', function () { state.ls.filter = 'guest'; });
  };
  /* ---------- 名單 ---------- */
  /* 篩選籤：原生 select 疊在上方（手機會叫出系統選單）；手機版選了值時右側多一顆 × 清除鍵 */
  function chipF(id, k, aria, val, opts, clr) {
    var on = !!val && clr;
    return '<span class="chipf-w' + (on ? ' on' : '') + '"><label class="chipf' + (val ? ' sel' : '') + '"><span class="cv"><span class="ck">' + k + '・</span>' + esc(val || '全部') + '</span>' + (on ? '' : ic('i-dn')) +
      '<select id="' + id + '" aria-label="' + aria + '"><option value="">全部</option>' + opts.map(function (l) { return '<option' + (l === val ? ' selected' : '') + '>' + esc(l) + '</option>'; }).join('') + '</select></label>' +
      (on ? '<button class="chipx" type="button" data-clr="' + id + '" aria-label="清除' + aria + '篩選">' + ic('i-x') + '</button>' : '') + '</span>';
  }
  async function list() {
    var L = state.ls, d = await api('admin.list', { filter: L.filter, q: L.q, level: L.level, status: L.status, page: L.page });
    state.lsData = d;
    var head = titleRow('名單', '共 ' + fmt(d.total) + ' 人・依最後到訪排序');
    var flt = '<div class="fl-row"><div class="seg flt" role="tablist" aria-label="篩選" data-seg="ls">' + [['all', '全部', d.total], ['student', '已是學員', d.students], ['guest', '未入學', d.total - d.students]].map(function (t) { return '<button role="tab" aria-selected="' + (L.filter === t[0]) + '" data-v="' + t[0] + '" type="button">' + t[1] + '<span class="en">' + fmt(t[2]) + '</span></button>'; }).join('') + '</div>' +
      '<label class="srch">' + ic('i-search') + '<input id="lq" type="search" placeholder="名稱、email、IG、LINE ID" value="' + esc(L.q) + '" aria-label="搜尋"></label>' +
      (M() ? '<div class="fl-sub">' + chipF('llv', '級別', '級別', L.level, d.levels, true) + chipF('lst', '狀態', '帳號狀態', L.status, d.statuses, true) + '</div>'
        : chipF('llv', '級別', '級別', L.level, d.levels) + chipF('lst', '狀態', '帳號狀態', L.status, d.statuses)) + '</div>';
    var rows = d.rows;
    var stu = function (p) { return p.student ? '<span class="acct">' + esc(p.student.account) + '</span>' : '<span class="acct none">未對應</span>'; };
    var lvl = function (p) { return p.student ? '<span class="lvl' + LVCLS(p.student.level) + '">' + esc(p.student.level || '—') + '</span>' : '<span class="lvl none">' + (p.pid ? '訪客' : '未登入') + '</span>'; };
    var stt = function (p) { return p.student ? '<span class="st ' + STCLS(p.student.status) + '"><i></i>' + esc(p.student.status || '—') + '</span>' : '<span class="st out"><i></i>未入學</span>'; };
    var q = function (p) { return (p.ability || p.career) ? (p.ability ? '<span class="qr" style="display:block"><i style="background:var(--ab)"></i>' + esc(p.ability) + '</span>' : '') + (p.career ? '<span class="qr" style="display:block"><i style="background:var(--cr)"></i>' + esc(p.career) + '</span>' : '') : '<span class="qr"><span class="none">尚未完成</span></span>'; };
    var clicks = function (p) { return p.flag ? '<span class="warnc" title="重複點擊：' + esc(p.flag.map(function (f) { return f.n + ' ' + f.max + ' 次'; }).join('、')) + '">' + p.clicks + '</span>' : p.clicks; };
    var foot = '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 10px 0;font-size:12.5px;color:var(--ink-3);flex-wrap:wrap;gap:8px"><span>顯示 ' + fmt(Math.min(d.matched, (d.page + 1) * 50)) + ' / ' + fmt(d.matched) + '・<span style="color:var(--neg)">紅字</span>＝重複點擊標記</span>' + (d.matched > (d.page + 1) * 50 ? '<button class="more" type="button" data-more>再載入 50 人</button>' : '') + '</div>';
    if (!rows.length) return head + flt + '<div class="pn"><div class="empty"><b>沒有符合的人</b>換個篩選或搜尋字再試。</div></div>';
    if (M()) return head + flt + '<div class="pn" style="padding:6px 16px">' + rows.map(function (p) {
      return '<a class="mrow" href="' + who2href(p.who) + '"><span class="ppl">' + avatar(p) + '<span style="min-width:0"><b><span class="nm">' + esc(p.name) + '</span>' + SRC(p.src) + '</b><small>' + esc(p.ig ? '@' + p.ig : p.email || '—') + '</small></span></span>' +
        '<span class="num" style="text-align:right;font-family:var(--geo);font-size:15px;font-weight:500">' + clicks(p) + '<small style="display:block;font-size:11px;color:var(--ink-3);font-weight:400;font-family:var(--cjk)">次點擊</small></span>' +
        '<span class="meta2">' + lvl(p) + stt(p) + (p.ability ? '<span class="qr"><i style="background:var(--ab)"></i>' + esc(p.ability) + '</span>' : '') + (p.career ? '<span class="qr"><i style="background:var(--cr)"></i>' + esc(p.career) + '</span>' : '') + '<span class="en">' + fMDHM(p.last) + '</span></span></a>';
    }).join('') + '</div>' + foot;
    return head + flt + '<div class="pn" style="padding:18px 14px 8px"><div class="tbx" data-scroll><table class="tb"><thead><tr><th>登入身分</th><th>IG 帳號</th><th>學院帳號</th><th>級別</th><th>帳號狀態</th><th>測驗結果</th><th class="num">點擊</th><th>最後到訪</th><th class="num">裝置</th><th class="num">IP</th></tr></thead><tbody>' +
      rows.map(function (p) { return '<tr class="row" data-who="' + esc(p.who) + '" tabindex="0"><td><span class="ppl">' + avatar(p) + '<span><b><span class="nm">' + esc(p.name) + '</span>' + SRC(p.src) + '</b><small>' + esc(p.email || (p.pid ? '' : '未登入')) + '</small></span></span></td><td class="en ig" style="font-size:13px">' + (p.ig ? '@' + esc(p.ig) : '<span style="color:var(--ink-3)">—</span>') + '</td><td>' + stu(p) + '</td><td>' + lvl(p) + '</td><td>' + stt(p) + '</td><td>' + q(p) + '</td><td class="num">' + clicks(p) + '</td><td class="en" style="font-size:13px;white-space:nowrap">' + fMDHM(p.last) + '</td><td class="num">' + p.devices + '</td><td class="num">' + p.ips + '</td></tr>'; }).join('') +
      '</tbody></table></div>' + foot + '</div>';
  }
  list.skeleton = function () { return titleRow('名單', '') + skelPn(300); };
  list.after = function (main) {
    main.querySelector('[data-seg="ls"]').addEventListener('click', function (e) { var b = e.target.closest('[role=tab]'); if (!b) return; state.ls.filter = b.dataset.v; state.ls.page = 0; render(); });
    var q = main.querySelector('#lq'), tm; q.addEventListener('input', function () { clearTimeout(tm); tm = setTimeout(function () { state.ls.q = q.value.trim(); state.ls.page = 0; render(); }, 350); });
    var lv = main.querySelector('#llv'); if (lv) lv.addEventListener('change', function () { state.ls.level = lv.value; state.ls.page = 0; render(); });
    var st = main.querySelector('#lst'); if (st) st.addEventListener('change', function () { state.ls.status = st.value; state.ls.page = 0; render(); });
    main.querySelectorAll('[data-clr]').forEach(function (b) { b.addEventListener('click', function () { state.ls[b.dataset.clr === 'llv' ? 'level' : 'status'] = ''; state.ls.page = 0; render(); }); });
    main.querySelectorAll('tr.row').forEach(function (tr) { var open = function () { go('person/' + encodeURIComponent(tr.dataset.who)); }; tr.addEventListener('click', open); tr.addEventListener('keydown', function (e) { if (e.key === 'Enter') open(); }); });
    var tbx = main.querySelector('.tbx'); if (tbx && tbx.scrollWidth > tbx.clientWidth + 1) tbx.insertAdjacentHTML('beforebegin', '<p class="hint tbx-hint">' + ic('i-swipe') + '表格較寬，可左右捲動看完整欄位</p>');
    var more = main.querySelector('[data-more]'); if (more) more.addEventListener('click', function () { state.ls.page++; render(); });
  };

  /* ---------- 個人頁 ---------- */
  async function person(who) {
    var d = await api('admin.person', { who: who }), p = d.person;
    state.personData = d;
    var top = '<a class="back" href="#/list">' + ic('i-arrow') + '名單</a><div class="pf">' + avatar(p, 'xl') + '<div><h1>' + esc(p.name) + '</h1><div class="meta">' + (p.src ? '<span>' + SRC(p.src) + (p.src === 'line' ? 'LINE' : 'Google') + ' 登入</span>' : '<span>未登入訪客</span>') + (p.email ? '<span class="en">' + esc(p.email) + '</span>' : '') + (p.ig ? '<span>IG <span class="en">@' + esc(p.ig) + '</span></span>' : '') + '<span>首次到訪 <span class="en">' + fDate(p.first) + '</span></span></div></div></div>';
    var tl = '<div class="pn"><div class="pn-h"><h2>到訪時間軸</h2><span class="s">' + d.timeline.visits + ' 次到訪・' + p.clicks + ' 次點擊</span></div><div class="tl">' +
      d.timeline.days.map(function (day) { return '<p class="tl-day"><b>' + day.day + '</b>週' + day.wd + (day.visits.length > 1 ? '<span style="margin-left:auto">' + day.visits.length + ' 次到訪</span>' : '') + '</p>' + day.visits.map(function (v) { return '<div class="tl-visit"><div class="hd">' + ic(/iOS|Android/.test(v.os) ? 'i-phone' : 'i-laptop') + esc(v.os + '・' + v.br) + (v.ipMask ? '<span style="color:var(--ink-3)" class="en">' + esc(v.ipMask) + '</span>' : '') + '<span class="en">' + v.from + (v.to !== v.from ? '–' + v.to : '') + '</span></div><div class="ev-list">' + v.ev.map(function (e) { return '<div class="ev"><span class="t">' + e.t + '</span><span class="d ' + e.d + '"></span><span class="x">' + e.x + '</span></div>'; }).join('') + '</div></div>'; }).join(''); }).join('') + '</div></div>';
    var parse = function (s) { try { return typeof s === 'string' ? JSON.parse(s) : (s || {}); } catch (e) { return {}; } };
    var ab = d.results.ability, cr = d.results.career, abS = ab ? parse(ab.summary) : null, crS = cr ? parse(cr.summary) : null;
    var radar = function (scores) { var keys = ['表達溝通', '思考判斷', '規劃佈局', '領導協作', '自我管理', '品牌經營', '工具應用'], v = keys.map(function (k) { return Math.max(.1, Math.min(1, (Number(scores && scores[k]) || 0) / 6)); }), cx = 60, cy = 58, R = 48, pt = function (i, r) { var a = -Math.PI / 2 + i * 2 * Math.PI / 7; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; }; return '<svg viewBox="0 0 120 116" style="width:120px" aria-hidden="true"><polygon points="' + v.map(function (_, i) { return pt(i, R).join(','); }).join(' ') + '" fill="none" stroke="var(--grid)"/><polygon points="' + v.map(function (_, i) { return pt(i, R * .5).join(','); }).join(' ') + '" fill="none" stroke="var(--grid)"/><polygon points="' + v.map(function (x, i) { return pt(i, R * x).join(','); }).join(' ') + '" fill="rgba(79,91,153,.12)" stroke="var(--ab)" stroke-width="2" stroke-linejoin="round"/></svg>'; };
    var bars = function (counts) { var keys = ['實踐者', '洞察者', '創作者', '引導者', '開創者', '統籌者'], mx = Math.max(1, Math.max.apply(null, keys.map(function (k) { return Number(counts && counts[k]) || 0; }))); return '<div style="display:flex;gap:2px;align-items:flex-end;height:60px;padding:0 6px" aria-hidden="true">' + keys.map(function (k) { var v = Number(counts && counts[k]) || 0; return '<span style="flex:1;height:' + Math.max(4, v / mx * 58) + 'px;border-radius:3px 3px 0 0;background:' + (crS && k === crS.primary ? 'var(--cr)' : 'var(--g5)') + '"></span>'; }).join('') + '</div>'; };
    var res = '<div class="pn"><div class="pn-h"><h2>測驗結果</h2></div>' +
      (ab ? '<div class="mini-res">' + radar(abS.scores) + '<div><p class="k">能力健檢・<span class="en">' + fMD(ab.at) + '</span></p><p class="big">' + esc(ab.label) + '</p><p>最強 <b>' + esc(abS.top || '—') + '</b>・最需補強 <b>' + esc(abS.low || '—') + '</b></p></div></div>' : '') +
      (cr ? '<div class="mini-res">' + bars(crS.counts) + '<div><p class="k">職涯定位・<span class="en">' + fMD(cr.at) + '</span></p><p class="big">' + esc(cr.label) + '</p><p>副角色 <b>' + esc(crS.secondary || '—') + '</b></p></div></div>' : '') +
      (!ab && !cr ? '<div class="empty">尚未完成任何測驗。</div>' : '') + '</div>';
    var s = p.student;
    var acad = '<div class="pn"><div class="pn-h"><h2>學院資料</h2>' + (s && state.me && state.me.lastSync ? '<span class="r">同步於 <span class="en">' + fMDHM(state.me.lastSync.at) + '</span></span>' : '') + '</div>' +
      (s ? '<dl class="spec ad"><div><dt>學院帳號</dt><dd class="en">' + esc(s.account) + '</dd></div><div><dt>級別</dt><dd' + (/至尊/.test(s.level) ? ' style="color:var(--champagne-ink)"' : '') + '>' + esc(s.level || '—') + '</dd></div><div><dt>帳號狀態</dt><dd><span class="st ' + STCLS(s.status) + '"><i></i>' + esc(s.status || '—') + '</span></dd></div><div><dt>註冊日</dt><dd class="en">' + esc(s.regDate || '—') + '</dd></div><div><dt>學院 IG</dt><dd class="en">' + esc(s.ig || '—') + '</dd></div><div><dt>LINE ID</dt><dd class="en">' + esc(s.lineId || '—') + '</dd></div><div><dt>對應方式</dt><dd>' + (s.by === 'email' ? 'email 相符' : 'IG 帳號相符') + '</dd></div></dl>'
        : '<div class="empty"><b>' + (p.pid ? '未對應到學員' : '未登入，無法對應') + '</b>' + (p.pid ? '以 email、IG 都找不到。可在下方填入這個人的 IG 帳號再比對。' : '只有登入過的人才能對應學院帳號。') + '</div>') +
      (p.pid ? '<div class="igedit"><input id="igv" type="text" placeholder="IG 帳號（不含 @）" value="' + esc(p.ig) + '" aria-label="IG 帳號" autocomplete="off"><button class="btn-s gl gl-clear" type="button" id="igsave">儲存</button></div><p class="rule-n" style="margin-top:6px">IG 帳號只能來自學員資料或本人自填，不做任何 Instagram 抓取。</p>' : '') + '</div>';
    var allIps = {}; d.devices.forEach(function (x) { x.ips.forEach(function (i) { allIps[i] = 1; }); });
    var dev = '<div class="pn"><div class="pn-h"><h2>裝置與 IP</h2><span class="s">' + d.devices.length + ' 台裝置・' + Object.keys(allIps).length + ' 個 IP</span><span class="r">IP 為輔・只存片段</span></div>' +
      d.devices.map(function (x) { return '<div class="dev">' + ic(/iOS|Android/.test(x.os) ? 'i-phone' : 'i-laptop') + '<b>' + esc(x.os + '・' + x.br) + '</b><span class="c">' + x.visits + ' 次到訪</span><small>' + (x.ips.length ? x.ips.map(esc).join('　') : '—') + '</small></div>'; }).join('') +
      (d.sameIp.length ? '<div class="same">' + ic('i-warn') + '<span><b>同 IP 另有 ' + d.sameIp.length + ' 人</b>：' + d.sameIp.slice(0, 3).map(function (x) { return '<span class="en">' + esc(x.ipMask) + '</span> 也用於 <a href="' + who2href(x.who) + '">' + esc(x.name) + '</a>（' + fMD(x.last) + '）'; }).join('、') + (d.sameIp.length > 3 ? ' 等' : '') + '，可能是同一處 Wi-Fi。</span></div>' : '') + '</div>';
    if (M()) return top + res + acad + tl + dev;
    return top + '<div class="grid12"><div class="c7">' + tl + '</div><div class="c5">' + res + acad + dev + '</div></div>';
  }
  person.skeleton = function () { return '<a class="back" href="#/list">' + ic('i-arrow') + '名單</a>' + skelPn(80) + skelPn(240); };
  person.after = function (main) {
    var b = main.querySelector('#igsave'); if (!b) return;
    b.addEventListener('click', async function () { var v = main.querySelector('#igv').value.trim().replace(/^@/, ''); if (v && !/^[A-Za-z0-9._]{1,30}$/.test(v)) return toast('IG 帳號格式不對', true); try { await api('admin.setIg', { pid: state.personData.person.pid, ig: v }); toast(v ? '已儲存 IG 帳號，重新比對學員' : '已清除 IG 帳號'); render(); } catch (e) { toast(e.msg || '儲存失敗', true); } });
  };

  /* ---------- 重複點擊 ---------- */
  async function repeat() {
    var d = await api('admin.repeat', { range: state.rp.range });
    var row = function (r, i, by) {
      var mx = Math.max(1, (d[by][0] || {}).tot), main = r.topN / r.tot;
      return '<div class="rp-row" role="link" tabindex="0" data-who="' + (by === 'ig' ? esc(r.key) : '') + '"><span class="rk">' + (i + 1) + '</span><span class="id">' + esc(r.label || '未登入訪客') + (r.sub ? '<small>' + esc(r.sub) + '</small>' : '') + '</span><span class="tot">' + r.tot + '<small>次</small></span>' +
        '<span class="br" style="width:' + (r.tot / mx * 100) + '%"><span style="flex:' + r.topN + ';background:var(--ab)"></span><span style="flex:' + (r.tot - r.topN) + ';background:var(--r1)"></span></span><span class="why">' + (r.why.bad ? '<b>' + esc(r.why.text) + '</b>' : esc(r.why.text)) + (!r.why.bad ? '・最多「' + esc(r.top) + '」' + r.topN + ' 次' : '') + '</span></div>';
    };
    var pane = function (h, s, by) { return '<div class="pn"><div class="pn-h"><h2>' + h + '</h2><span class="s">' + s + '</span></div><div class="rp">' + (d[by].length ? d[by].map(function (r, i) { return row(r, i, by); }).join('') : '<div class="empty">這段期間沒有點擊。</div>') + '</div></div>'; };
    var head = titleRow('重複點擊', { today: '今日', '7d': '近 7 天', '30d': '近 30 天' }[state.rp.range] + '・依總點擊排序', rangeSeg(state.rp.range, 'rp'));
    var note = '<p class="rule-n">標記規則：同一人 10 分鐘內同一按鈕點 5 次以上，以紅字標記；長條分段：深＝該人最常點的那一顆，淺＝其他。IP 只存加鹽雜湊與前兩段，並由前台回報，僅供參考。</p>';
    if (M()) return head + '<div class="seg flt" role="tablist" aria-label="角度" data-seg="rp-by" style="grid-template-columns:repeat(3,1fr)">' + [['ig', 'IG 帳號'], ['device', '裝置'], ['ip', 'IP']].map(function (t) { return '<button role="tab" aria-selected="' + (state.rp.by === t[0]) + '" data-v="' + t[0] + '" type="button">' + t[1] + '</button>'; }).join('') + '</div>' + pane({ ig: '依 IG 帳號', device: '依裝置', ip: '依 IP' }[state.rp.by], { ig: '沒有 IG 時以登入名稱計', device: '系統與瀏覽器＋本機識別碼', ip: '同 IP 多人時列出人數' }[state.rp.by], state.rp.by) + note;
    return head + note + '<div class="grid12"><div class="c4">' + pane('依 IG 帳號', '沒有 IG 時以登入名稱計', 'ig') + '</div><div class="c4">' + pane('依裝置', '系統與瀏覽器＋本機識別碼', 'device') + '</div><div class="c4">' + pane('依 IP', '同 IP 多人時列出人數', 'ip') + '</div></div>';
  }
  repeat.skeleton = function () { return titleRow('重複點擊', '') + skelPn(260); };
  repeat.after = function (main) {
    main.querySelector('[data-seg="rp"]').addEventListener('click', function (e) { var b = e.target.closest('[role=tab]'); if (!b) return; state.rp.range = b.dataset.v; render(); });
    var by = main.querySelector('[data-seg="rp-by"]'); if (by) by.addEventListener('click', function (e) { var b = e.target.closest('[role=tab]'); if (!b) return; state.rp.by = b.dataset.v; render(); });
    main.querySelectorAll('.rp-row[data-who]').forEach(function (r) { if (!r.dataset.who) { r.removeAttribute('role'); r.removeAttribute('tabindex'); r.style.cursor = 'default'; return; } var open = function () { go('person/' + encodeURIComponent(r.dataset.who)); }; r.addEventListener('click', open); r.addEventListener('keydown', function (e) { if (e.key === 'Enter') open(); }); });
  };

  /* ---------- 工具設定 ---------- */
  async function tools() {
    var both = await Promise.all([api('admin.tools'), api('admin.sessions')]), d = both[0], ss = both[1];
    state.toolsData = { d: d, ss: ss };
    var href = MOCK ? '#' : 'javascript:' + encodeURIComponent((window.HUB_BM_SRC || '').replace('__GAS__', CFG.gas || ''));
    var bm = '<div class="pn"><div class="pn-h"><h2>學員同步書籤</h2><span class="s">從學院官網後台一鍵帶入學員資料</span></div>' +
      '<div class="bm-zone"><a class="bm gl gl-ink" href="' + href + '" draggable="true" id="bmlink" title="學員同步">' + ic('i-grip', 'i grip') + '<span class="bk">' + ic('i-book') + '</span>學員同步</a>' +
      '<p class="bm-t">' + (M() ? '書籤需在<b>電腦瀏覽器</b>設定：在電腦開啟這一頁，把這顆按鈕<b>拖曳到書籤列</b>。<br>' : '把「學員同步」這顆按鈕<b>拖曳到瀏覽器的書籤列</b>（不要點它）。<br>') + '之後登入學院官網後台，開啟「學員列表」頁，點一下書籤：會掃描列表、問一次後台密碼（之後記住此電腦，不用再輸入），再分批加密上傳到資料中心。</p></div>' +
      '<ol class="flow" style="--n:3;margin-top:22px"><li><span class="st"><i class="sw" aria-hidden="true">' + ic('i-book') + '</i><span class="sl">拖到書籤列</span></span></li><li><span class="st"><i class="sw" aria-hidden="true">' + ic('i-login') + '</i><span class="sl">開啟學院後台學員列表</span></span></li><li><span class="st"><i class="sw" aria-hidden="true">' + ic('i-check') + '</i><span class="sl">點書籤完成同步</span></span></li></ol>' +
      (MOCK ? '<div class="bmp" style="margin-top:18px" id="bmdemo"><div style="display:flex;align-items:center;gap:8px"><b style="font-weight:500">書籤進度面板（示意）</b><button class="btn-s gl gl-clear" type="button" id="bmplay" style="margin-left:auto">播放示範</button></div><div class="bar"><i></i></div><div class="t" style="color:var(--ink-3)">在學院後台點書籤後，右下角會出現這個面板：掃描列表 → 輸入後台密碼 → 加密上傳 → 完成。</div></div>' : '') + '</div>';
    var ls = d.lastSync;
    var sync = '<div class="pn"><div class="pn-h"><h2>上次同步</h2><span class="r"><i class="dotok' + (ls ? '' : ' wait') + '"></i>' + (ls ? '成功' : '尚未同步') + '</span></div><div class="sync-w"><div class="kpis sync" style="padding:0">' +
      [['同步時間', ls ? fMDHM(ls.at) : '—'], ['學員筆數', ls ? fmt(ls.n) : '—'], ['新增', ls ? fmt(ls.added) : '—'], ['更新', ls ? fmt(ls.updated) : '—']].map(function (k, i) { return '<div class="kpi" style="' + (i === 0 ? 'padding-left:0' : '') + '"><p class="l">' + k[0] + '</p><p class="v">' + k[1] + '</p></div>'; }).join('') + '</div></div>' +
      '<p class="rule-n" style="margin-top:12px">對應方式：先比對 email，再比對 IG 帳號；對不到的人顯示「未對應」，可在個人頁填入 IG 帳號再比對。名單整份只存在雲端硬碟試算表，前台與外部都讀不到。</p></div>';
    var arch = '<div class="pn"><div class="pn-h"><h2>資料中心</h2><span class="s">沿用五週年慶網站做法・免費</span><span class="r"><i class="dotok"></i>' + (MOCK ? '預覽假資料' : '連線正常') + '</span></div>' +
      '<div class="arch"><div class="node"><b>全平台總覽</b><small>進站・點擊・測驗</small></div>' + ic('i-arrow', 'i arr') + '<div class="node"><b>Google Apps Script</b><small>收資料・驗密碼・驗登入</small></div>' + ic('i-arrow', 'i arr') + '<div class="node"><b>雲端硬碟試算表</b><small>grace-hub-data</small></div></div>' +
      '<div class="arch" style="margin-top:12px"><div class="node"><b>學院官網後台</b><small>學員列表</small></div>' + ic('i-arrow', 'i arr') + '<div class="node"><b>學員同步書籤</b><small>加密上傳</small></div>' + ic('i-arrow', 'i arr') + '<div class="node"><b>同一份試算表</b><small>students 分頁</small></div></div>' +
      '<div class="row-end" style="justify-content:flex-start;gap:16px;font-size:12.5px;color:var(--ink-3)"><span><i class="dotok' + (d.line ? '' : ' off') + '"></i>LINE Login ' + (d.line ? '已設定' : '未設定') + '</span><span><i class="dotok' + (d.google ? '' : ' off') + '"></i>Google 登入 ' + (d.google ? '已設定' : '未設定') + '</span></div></div>';
    var devs = '<div class="pn"><div class="pn-h"><h2>已登入的裝置</h2><span class="s">登入時勾選「記住此裝置」，一年內免再輸入密碼</span></div>' +
      ss.sessions.map(function (s) { return '<div class="ses" data-sid="' + esc(s.id) + '">' + ic(/iPhone|iPad|Android/.test(s.label) ? 'i-phone' : 'i-laptop') + '<b>' + esc(s.label || '裝置') + (s.me ? '<span class="me">這台</span>' : '') + '</b><span class="c"><button class="btn-s gl gl-clear" type="button" data-rm="' + esc(s.id) + '">移除</button></span><small>最近使用 ' + fMDHM(s.last) + '・到期 ' + fDate(s.exp) + '</small></div>'; }).join('') +
      '<div class="row-end"><button class="btn-s gl gl-clear" type="button" id="chpw">變更後台密碼</button><button class="btn-s gl gl-clear danger" type="button" id="outall">登出所有裝置</button></div><div id="pwform" hidden style="margin-top:14px"></div></div>';
    var head = titleRow('工具設定', '資料中心與學員同步');
    if (M()) return head + bm + sync + arch + devs;
    return head + '<div class="grid12"><div class="c7">' + bm + arch + '</div><div class="c5">' + sync + devs + '</div></div>';
  }
  tools.skeleton = function () { return titleRow('工具設定', '') + skelPn(160) + skelPn(120); };
  tools.after = function (main) {
    var link = main.querySelector('#bmlink');
    link.addEventListener('click', function (e) { e.preventDefault(); toast(MOCK ? '預覽模式：正式版會是可拖曳的書籤' : '請把這顆按鈕拖曳到書籤列，不要直接點。'); });
    main.querySelectorAll('[data-rm]').forEach(function (b) { b.addEventListener('click', async function () { try { await api('admin.removeSession', { id: b.dataset.rm }); var me = state.toolsData.ss.sessions.find(function (s) { return s.id === b.dataset.rm; }); if (me && me.me) { AT = ''; store.del('gh.at'); toast('已登出這台裝置'); } else toast('已移除裝置'); render(); } catch (e) { toast(e.msg || '失敗', true); } }); });
    main.querySelector('#outall').addEventListener('click', async function () { try { await api('admin.logoutAll'); AT = ''; store.del('gh.at'); state.me = null; toast('已登出所有裝置'); render(); } catch (e) { toast(e.msg || '失敗', true); } });
    var pf = main.querySelector('#pwform');
    main.querySelector('#chpw').addEventListener('click', function () {
      pf.hidden = !pf.hidden; if (!pf.hidden && !pf.innerHTML) pf.innerHTML = '<div class="fld"><label for="opw">目前密碼</label><div class="inp" style="font-size:16px;letter-spacing:.2em"><input id="opw" type="password" autocomplete="current-password"></div></div><div class="fld" style="margin-top:10px"><label for="npw">新密碼（至少 8 碼）</label><div class="inp" style="font-size:16px;letter-spacing:.2em"><input id="npw" type="password" autocomplete="new-password"></div></div><p class="rule-n" style="margin-top:8px">變更後其他裝置會登出，書籤下次同步要用新密碼。</p><div class="row-end"><button class="btn-s gl gl-ink" type="button" id="pwgo">確認變更</button></div>';
      var g = pf.querySelector('#pwgo'); if (g && !g.dataset.b) { g.dataset.b = 1; g.addEventListener('click', async function () { var o = pf.querySelector('#opw').value, n = pf.querySelector('#npw').value; if (n.length < 8) return toast('新密碼至少 8 碼', true); try { var st = await api('admin.status'), k1 = await window.HubCrypto.deriveKeys(o, st.pwSalt), k2 = await window.HubCrypto.deriveKeys(n, st.pwSalt); await api('admin.changePassword', { oldKey: k1.pwKey, pwKey: k2.pwKey, bmKey: k2.bmKey }); toast('密碼已變更'); pf.hidden = true; render(); } catch (e) { toast(e.msg || '失敗', true); } }); }
    });
    var play = main.querySelector('#bmplay'); if (play) play.addEventListener('click', function () { var bar = main.querySelector('#bmdemo .bar i'), t = main.querySelector('#bmdemo .t'), steps = [[15, '掃描學員列表…第 3 頁・612 筆'], [45, '輸入後台密碼（只用來推導金鑰，不會送出）'], [80, '加密上傳 2 / 3 批（600 / 612 筆）'], [100, '同步完成：612 筆（新增 4・更新 17）']], i = 0; play.disabled = true; var tick = function () { if (i >= steps.length) { play.disabled = false; return; } bar.style.setProperty('--p', steps[i][0] + '%'); t.textContent = steps[i][1]; i++; setTimeout(tick, 900); }; tick(); });
  };

  /* ---------- 圖片（由 build 內嵌） ---------- */
  var IMG = window.HUB_IMG || { logo: 'img/logo-engraved.webp', mark: 'img/logo-academy-mark.webp' };
  boot();
})();
