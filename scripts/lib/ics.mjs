// 輕量 ICS（iCalendar）解析與重複事件展開
// 支援：折行 unfolding、DTSTART/DTEND（TZID / UTC Z / 全天 VALUE=DATE / 浮動時間）、DURATION、
//      RRULE 的 DAILY/WEEKLY（INTERVAL、COUNT、UNTIL、BYDAY、WKST）、MONTHLY（BYMONTHDAY、BYDAY 含序數）、EXDATE、
//      RECURRENCE-ID 單次修改、STATUS:CANCELLED 排除。
// 輸出規則：全天事件略過（警告）；http:// 連結升級為 https://（警告）。

const DAY_MS = 86400000;
const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

// ---------- 基本文字處理 ----------
export function unfold(text) {
  return String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '');
}

/**
 * 位元組層級的折行還原後再解碼 UTF-8。
 * RFC 5545 以 75「位元組」折行；中文每字 3 位元組，若折行切在一個字中間，先逐行解碼再還原會把該字變成 U+FFFD。
 * 先在位元組層級移除 CRLF/LF/CR + 空白（或 Tab），再整體解碼即可避免。
 */
export function unfoldBytes(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const out = new Uint8Array(u8.length);
  let n = 0;
  for (let i = 0; i < u8.length; i++) {
    const c = u8[i];
    if (c === 13 || c === 10) {
      let j = i + 1;
      if (c === 13 && u8[j] === 10) j++;
      if (u8[j] === 32 || u8[j] === 9) { i = j; continue; } // 折行：整段丟棄
    }
    out[n++] = c;
  }
  return out.subarray(0, n);
}

/** 原始位元組 → 已還原折行的 ICS 文字 */
export function decodeIcsBytes(bytes) {
  return new TextDecoder('utf-8').decode(unfoldBytes(bytes));
}

export function unescapeText(v) {
  return String(v ?? '').replace(/\\([\\;,nN])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c));
}

/** 解析單行 "NAME;P1=a;P2="b":value" */
export function parseLine(line) {
  let i = 0;
  let inQuote = false;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuote = !inQuote;
    else if (c === ':' && !inQuote) break;
  }
  if (i >= line.length) return null;
  const head = line.slice(0, i);
  const value = line.slice(i + 1);
  const parts = head.match(/(?:[^;"]|"[^"]*")+/g) || [];
  const name = (parts.shift() || '').toUpperCase();
  const params = {};
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq < 0) continue;
    params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name, params, value };
}

// ---------- 時區換算 ----------
const dtfCache = new Map();
function tzParts(ms, tz) {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    dtfCache.set(tz, f);
  }
  const o = {};
  for (const { type, value } of f.formatToParts(new Date(ms))) o[type] = value;
  return Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour % 24, +o.minute, +o.second);
}

function validTz(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** 牆上時間（在 tz 時區）→ UTC 毫秒 */
export function wallToUtc(w, tz) {
  const asUtc = Date.UTC(w.y, w.m - 1, w.d, w.h || 0, w.mi || 0, w.s || 0);
  if (tz === 'UTC') return asUtc;
  let guess = asUtc - (tzParts(asUtc, tz) - asUtc);
  // 再修正一次以處理日光節約交界
  const off2 = tzParts(guess, tz) - guess;
  guess = asUtc - off2;
  return guess;
}

/** UTC 毫秒 → 在 tz 的牆上時間 */
function utcToWall(ms, tz) {
  const t = new Date(tz === 'UTC' ? ms : tzParts(ms, tz));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), h: t.getUTCHours(), mi: t.getUTCMinutes(), s: t.getUTCSeconds() };
}

/**
 * 解析日期值。回傳 { ms, allDay, tz, wall }
 * - 20261101           → 全天（以 defaultTz 的當日 00:00）
 * - 20261101T200000Z   → UTC
 * - 20261101T200000 + TZID → 該時區；無 TZID 視為 defaultTz（浮動時間）
 */
export function parseDateValue(value, params = {}, defaultTz = 'Asia/Taipei') {
  const v = String(value).trim();
  let m = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m || params.VALUE === 'DATE') {
    m = m || v.match(/^(\d{4})(\d{2})(\d{2})/);
    if (!m) throw new Error(`無法解析日期：${v}`);
    const wall = { y: +m[1], m: +m[2], d: +m[3], h: 0, mi: 0, s: 0 };
    return { ms: wallToUtc(wall, defaultTz), allDay: true, tz: defaultTz, wall };
  }
  m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!m) throw new Error(`無法解析日期時間：${v}`);
  const wall = { y: +m[1], m: +m[2], d: +m[3], h: +m[4], mi: +m[5], s: +m[6] };
  if (m[7] === 'Z') return { ms: wallToUtc(wall, 'UTC'), allDay: false, tz: 'UTC', wall };
  let tz = params.TZID ? params.TZID.replace(/^\//, '') : defaultTz;
  if (!validTz(tz)) tz = defaultTz;
  return { ms: wallToUtc(wall, tz), allDay: false, tz, wall };
}

/** ISO 8601 DURATION（如 PT1H30M、P1D）→ 毫秒 */
export function parseDuration(v) {
  const m = String(v).trim().match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return null;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * ((+(m[2] || 0) * 7 + +(m[3] || 0)) * DAY_MS + (+(m[4] || 0) * 3600 + +(m[5] || 0) * 60 + +(m[6] || 0)) * 1000);
}

// ---------- 解析 VEVENT ----------
export function parseIcs(text) {
  const lines = unfold(text).split('\n');
  if (!lines.some((l) => /^BEGIN:VCALENDAR/i.test(l.trim()))) throw new Error('ICS 格式不正確（找不到 BEGIN:VCALENDAR）');
  let calTz = null;
  const events = [];
  let cur = null;
  let depth = 0; // VEVENT 內的子元件（如 VALARM）
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line) continue;
    const p = parseLine(line);
    if (!p) continue;
    if (p.name === 'X-WR-TIMEZONE' && !cur) calTz = p.value.trim();
    if (p.name === 'BEGIN') {
      if (p.value.toUpperCase() === 'VEVENT' && !cur) { cur = { props: {} }; depth = 0; }
      else if (cur) depth++;
      continue;
    }
    if (p.name === 'END') {
      if (cur && depth > 0) depth--;
      else if (cur && p.value.toUpperCase() === 'VEVENT') { events.push(cur); cur = null; }
      continue;
    }
    if (cur && depth === 0) (cur.props[p.name] ||= []).push(p);
  }
  return { calTz: calTz && validTz(calTz) ? calTz : null, events };
}

// ---------- RRULE ----------
export function parseRrule(v) {
  const r = {};
  for (const part of String(v).split(';')) {
    const [k, val] = part.split('=');
    if (k && val !== undefined) r[k.toUpperCase()] = val.toUpperCase();
  }
  return {
    freq: r.FREQ,
    interval: Math.max(1, parseInt(r.INTERVAL || '1', 10) || 1),
    count: r.COUNT ? parseInt(r.COUNT, 10) : null,
    until: r.UNTIL || null,
    byday: r.BYDAY ? r.BYDAY.split(',').map((d) => d.replace(/^[+-]?\d+/, '')).filter((d) => WEEKDAYS.includes(d)) : null,
    // MONTHLY 用：保留序數（如 4SA = 第四個週六、-1FR = 最後一個週五）
    bydayN: r.BYDAY
      ? r.BYDAY.split(',').map((d) => d.match(/^([+-]?\d+)?([A-Z]{2})$/)).filter((m) => m && WEEKDAYS.includes(m[2]))
        .map((m) => ({ n: m[1] ? parseInt(m[1], 10) : 0, wd: WEEKDAYS.indexOf(m[2]) }))
      : null,
    bymonthday: r.BYMONTHDAY ? r.BYMONTHDAY.split(',').map((x) => parseInt(x, 10)).filter((x) => x && Math.abs(x) <= 31) : null,
    wkst: WEEKDAYS.includes(r.WKST) ? r.WKST : 'MO',
  };
}

/**
 * 以牆上時間（事件時區）展開重複事件的開始時間（UTC 毫秒）。
 * 於 windowEnd 之後或達 COUNT / UNTIL 即停止。
 */
export function expandRrule(start, rule, { windowEnd, defaultTz, maxIter = 5000 }) {
  const tz = start.tz;
  const base = start.wall;
  const baseDayUtc = Date.UTC(base.y, base.m - 1, base.d); // 以「日」為單位推算，避免時區影響
  let untilMs = Infinity;
  if (rule.until) {
    const u = parseDateValue(rule.until, {}, start.allDay ? start.tz : defaultTz);
    // 全天的 UNTIL 視為當日結束（含當日）
    untilMs = u.allDay ? wallToUtc({ ...u.wall, h: 23, mi: 59, s: 59 }, start.tz) : u.ms;
  }
  const out = [];
  const mk = (dayUtc) => {
    const t = new Date(dayUtc);
    return wallToUtc({ y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), h: base.h, mi: base.mi, s: base.s }, tz);
  };
  let produced = 0;
  const push = (ms) => {
    if (ms < start.ms) return true; // DTSTART 之前的不算
    if (ms > untilMs) return false;
    if (rule.count != null && produced >= rule.count) return false;
    produced++;
    out.push(ms);
    return ms <= windowEnd;
  };

  if (rule.freq === 'DAILY') {
    for (let i = 0; i < maxIter; i++) {
      const day = baseDayUtc + i * rule.interval * DAY_MS;
      const wd = WEEKDAYS[new Date(day).getUTCDay()];
      if (rule.byday && !rule.byday.includes(wd)) continue;
      if (!push(mk(day))) break;
    }
  } else if (rule.freq === 'WEEKLY') {
    const days = rule.byday && rule.byday.length ? rule.byday : [WEEKDAYS[new Date(baseDayUtc).getUTCDay()]];
    const wkst = WEEKDAYS.indexOf(rule.wkst);
    const baseWd = new Date(baseDayUtc).getUTCDay();
    const weekStart = baseDayUtc - ((baseWd - wkst + 7) % 7) * DAY_MS;
    // 依週起始日排序該週內的日子
    const offsets = days.map((d) => (WEEKDAYS.indexOf(d) - wkst + 7) % 7).sort((a, b) => a - b);
    outer: for (let w = 0; w < maxIter; w++) {
      const ws = weekStart + w * rule.interval * 7 * DAY_MS;
      for (const off of offsets) {
        if (!push(mk(ws + off * DAY_MS))) break outer;
      }
    }
  } else if (rule.freq === 'MONTHLY') {
    // 支援 BYMONTHDAY（含負數）與 BYDAY（含序數，如 4SA、-1FR；無序數則為當月每個該週日）
    const daysInMonth = (y, m0) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
    outer: for (let k = 0; k < maxIter; k++) {
      const mi = base.m - 1 + k * rule.interval;
      const y = base.y + Math.floor(mi / 12);
      const m0 = ((mi % 12) + 12) % 12;
      const dim = daysInMonth(y, m0);
      let ds = [];
      if (rule.bymonthday && rule.bymonthday.length) {
        ds = rule.bymonthday.map((d) => (d > 0 ? d : dim + 1 + d)).filter((d) => d >= 1 && d <= dim);
      } else if (rule.bydayN && rule.bydayN.length) {
        for (const { n, wd } of rule.bydayN) {
          const all = [];
          for (let d = 1; d <= dim; d++) if (new Date(Date.UTC(y, m0, d)).getUTCDay() === wd) all.push(d);
          if (n === 0) ds.push(...all);
          else { const pick = n > 0 ? all[n - 1] : all[all.length + n]; if (pick) ds.push(pick); }
        }
      } else if (base.d <= dim) {
        ds = [base.d]; // 無 BY* 時沿用 DTSTART 的日期；該月沒有這一天則跳過（RFC 5545）
      }
      ds = [...new Set(ds)].sort((a, b) => a - b);
      for (const d of ds) {
        if (!push(mk(Date.UTC(y, m0, d)))) break outer;
      }
      if (k > 0 && mk(Date.UTC(y, m0, 1)) > windowEnd) break;
    }
  } else {
    // 其他頻率（YEARLY 等）不展開，只保留第一次
    return { occurrences: [start.ms], unsupported: rule.freq || 'UNKNOWN' };
  }
  return { occurrences: out, unsupported: null };
}

// ---------- 事件展開與篩選 ----------
const first = (ev, name) => ev.props[name]?.[0];
const URL_RE = /https?:\/\/[^\s<>"'\\,;]+/i;

function eventUrl(ev, fallback) {
  const u = first(ev, 'URL');
  if (u && /^https?:\/\//i.test(u.value.trim())) return u.value.trim();
  const loc = first(ev, 'LOCATION');
  const m = loc && unescapeText(loc.value).match(URL_RE);
  return m ? m[0] : fallback;
}

function isCancelled(ev) {
  return (first(ev, 'STATUS')?.value || '').trim().toUpperCase() === 'CANCELLED';
}

/** 事件標題（SUMMARY）解跳脫後的原文 */
export function eventSummary(ev) {
  return unescapeText(first(ev, 'SUMMARY')?.value || '');
}

/**
 * 取得時間窗內的事件。
 * match：選用的標題篩選函式（收到 SUMMARY 原文，回傳 true 才採用）。
 *   有提供時，不符合的事件在解析時間、展開重複、產生警告之前就被丟棄，
 *   其任何內容都不會進入結果或警告訊息。
 * @returns {Array<{title,startMs,endMs,allDay,url}>}
 */
export function collectOccurrences(icsText, { now = Date.now(), days = 60, defaultTz = 'Asia/Taipei', fallbackUrl, warn = () => {}, match = null } = {}) {
  const parsed = parseIcs(icsText);
  const { calTz } = parsed;
  const tz = calTz || defaultTz;
  const windowEnd = now + days * DAY_MS;

  // 標題篩選：符合者的 UID 用來辨識「同一系列中被改名的單次修改」
  let events = parsed.events;
  const keptUids = new Set();
  const renamedOverrides = []; // 同 UID 但標題已改成其他名稱的單次修改：只用來排除系列中的那一次
  if (typeof match === 'function') {
    const ok = events.filter((ev) => match(eventSummary(ev)));
    for (const ev of ok) keptUids.add(first(ev, 'UID')?.value || '');
    for (const ev of events) {
      if (ok.includes(ev)) continue;
      const uid = first(ev, 'UID')?.value || '';
      if (first(ev, 'RECURRENCE-ID') && uid && keptUids.has(uid)) renamedOverrides.push(ev);
    }
    events = ok;
  }

  // RECURRENCE-ID 單次修改：依 UID 分組
  const overrides = new Map(); // uid -> Set(原始開始 ms)
  const addOverride = (ev) => {
    const rid = first(ev, 'RECURRENCE-ID');
    const uid = first(ev, 'UID')?.value || '';
    const r = parseDateValue(rid.value, rid.params, tz);
    if (!overrides.has(uid)) overrides.set(uid, new Set());
    overrides.get(uid).add(r.ms);
  };
  for (const ev of renamedOverrides) {
    try { addOverride(ev); } catch { /* 非目標事件：靜默略過，不輸出任何內容 */ }
  }
  const masters = [];
  const singles = [];
  for (const ev of events) {
    if (first(ev, 'RECURRENCE-ID')) {
      addOverride(ev);
      singles.push(ev); // 修改後的那一次自己獨立成一筆（取消者稍後排除）
    } else if (first(ev, 'RRULE')) masters.push(ev);
    else singles.push(ev);
  }

  const results = [];
  const warned = new Set(); // 同一事件（含重複）只警告一次
  const warnOnce = (key, msg) => { if (!warned.has(key)) { warned.add(key); warn(msg); } };
  const addOcc = (ev, startMs, durMs, allDay) => {
    const endMs = startMs + durMs;
    if (endMs <= now || startMs > windowEnd) return;
    const title = unescapeText(first(ev, 'SUMMARY')?.value || '').trim();
    const uid = first(ev, 'UID')?.value || title;
    // 全天事件沒有開播時段，網站無法顯示正確時間 → 略過
    if (allDay) {
      warnOnce(`allday|${uid}`, `略過全天事件（直播請設定開始與結束時段）：${title || '（無標題）'}`);
      return;
    }
    let url = eventUrl(ev, fallbackUrl);
    if (/^http:\/\//i.test(url)) {
      url = url.replace(/^http:\/\//i, 'https://');
      warnOnce(`http|${uid}`, `直播連結使用 http://，已自動改為 https://：${title || '（無標題）'}`);
    }
    results.push({ title, startMs, endMs, allDay, url });
  };

  const timing = (ev) => {
    const ds = first(ev, 'DTSTART');
    if (!ds) return null;
    const start = parseDateValue(ds.value, ds.params, tz);
    let dur;
    const de = first(ev, 'DTEND');
    const du = first(ev, 'DURATION');
    if (de) dur = parseDateValue(de.value, de.params, tz).ms - start.ms;
    else if (du) dur = parseDuration(du.value);
    if (dur == null || Number.isNaN(dur) || dur < 0) dur = start.allDay ? DAY_MS : 0;
    return { start, dur };
  };

  for (const ev of singles) {
    if (isCancelled(ev)) continue;
    try {
      const t = timing(ev);
      if (t) addOcc(ev, t.start.ms, t.dur, t.start.allDay);
    } catch (e) {
      warn(`略過無法解析的事件：${e.message}`);
    }
  }

  for (const ev of masters) {
    if (isCancelled(ev)) continue;
    try {
      const t = timing(ev);
      if (!t) continue;
      const rule = parseRrule(first(ev, 'RRULE').value);
      const { occurrences, unsupported } = expandRrule(t.start, rule, { windowEnd, defaultTz: tz });
      if (unsupported) warn(`不支援的重複規則 FREQ=${unsupported}，僅保留第一次：${first(ev, 'SUMMARY')?.value || ''}`);
      const ex = new Set();
      for (const exd of ev.props.EXDATE || []) {
        for (const v of exd.value.split(',')) {
          if (v.trim()) ex.add(parseDateValue(v.trim(), exd.params, t.start.allDay ? t.start.tz : tz).ms);
        }
      }
      const ov = overrides.get(first(ev, 'UID')?.value || '') || new Set();
      for (const ms of occurrences) {
        if (ex.has(ms) || ov.has(ms)) continue;
        addOcc(ev, ms, t.dur, t.start.allDay);
      }
    } catch (e) {
      warn(`略過無法解析的重複事件：${e.message}`);
    }
  }

  results.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  return results;
}

/**
 * 診斷用：逐一整理每個 VEVENT 的結構資訊（不展開、不篩選）。
 * 回傳的 summary 僅供呼叫端在記憶體內比對，呼叫端不得印出。
 * inWindow：單次事件以 DTSTART/DTEND 判斷；重複事件以展開後是否有任何一次落在窗內判斷。
 */
export function summarizeEvents(icsText, { now = Date.now(), windowEnd = now + 60 * DAY_MS, defaultTz = 'Asia/Taipei' } = {}) {
  const parsed = parseIcs(icsText);
  const tz = parsed.calTz || defaultTz;
  const calName = (() => {
    for (const raw of unfold(icsText).split('\n')) {
      const p = parseLine(raw.trimEnd());
      if (p && p.name === 'X-WR-CALNAME') return unescapeText(p.value).trim();
      if (p && p.name === 'BEGIN' && p.value.toUpperCase() === 'VEVENT') break;
    }
    return '';
  })();
  const rows = [];
  for (const ev of parsed.events) {
    const row = { summary: eventSummary(ev), recurring: !!first(ev, 'RRULE'), override: !!first(ev, 'RECURRENCE-ID'), cancelled: isCancelled(ev), parsed: false, allDay: null, startMs: null, year: null, inWindow: false };
    try {
      const ds = first(ev, 'DTSTART');
      if (!ds) { rows.push(row); continue; }
      const start = parseDateValue(ds.value, ds.params, tz);
      let dur;
      const de = first(ev, 'DTEND');
      const du = first(ev, 'DURATION');
      if (de) dur = parseDateValue(de.value, de.params, tz).ms - start.ms;
      else if (du) dur = parseDuration(du.value);
      if (dur == null || Number.isNaN(dur) || dur < 0) dur = start.allDay ? DAY_MS : 0;
      row.parsed = true;
      row.allDay = start.allDay;
      row.startMs = start.ms;
      row.year = start.wall.y;
      if (row.recurring) {
        const { occurrences } = expandRrule(start, parseRrule(first(ev, 'RRULE').value), { windowEnd, defaultTz: tz });
        row.inWindow = occurrences.some((ms) => ms + dur > now && ms <= windowEnd);
      } else {
        row.inWindow = start.ms + dur > now && start.ms <= windowEnd;
      }
    } catch { /* parsed 維持 false */ }
    rows.push(row);
  }
  return { calName, calTz: parsed.calTz, rows };
}

export { utcToWall };
