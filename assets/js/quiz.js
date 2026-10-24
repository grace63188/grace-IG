/* 自我測驗：能力健檢／職涯定位
   - 全螢幕覆蓋層（role=dialog），一題一頁、進度、上一題、可中途關閉（保留作答，下次開啟接續）
   - 鍵盤：←／→ 上一題／下一題；↑／↓ 在選項間移動；1–4 直接作答；Esc 關閉
   - 結果：雷達圖／六角形生長、名稱逐字浮現；結果卡以 canvas 繪製（IG 限動 9:16）
   - 結果存 localStorage（try/catch），票券入口顯示上次結果
   - 入口：撕票 →（未登入先在儀式卡登入，gate.js）→ 開始前準備頁（入場券＋作答提醒＋「開始」）→ 3-2-1 倒數 → 第一題（未完成者接續，按鈕為「繼續」）
   - 倒數：開始鈕化成錶面、金弧掃描、收束鐘聲，總長 3160ms；點畫面／Enter／空白鍵略過，Esc 關閉；減少動態改為「準備好了」0.6s 淡入淡出
     畫面（Web Animations＋rAF）與聲音（sound.js cd*）都以按下那一刻為基準一次排程，聲音取同一個音訊時鐘讀數，不逐一漂移
   - 結果頁：LINE 登入者在頁尾附「加入 @52grace」次鍵
   - 結果揭曉：最後一題作答後先算好結果、存檔、送出（quiz.result 背景送出，不等網路），再播放揭曉層約 3 秒——
     能力健檢＝七軸金線長成雷達、落定後以 FLIP 平移成結果頁的雷達；職涯定位＝六枚角色印記繞錶圈轉動、收攏、金印落定、結果頁分段浮上
     點畫面／Enter／空白鍵略過（前 220ms 不受理）；Esc 照常關閉測驗；減少動態改為「結果出爐」0.6s 淡入淡出；規格見 mockup_v13/reveal/motion.md
   - 音效：選答案＝珍珠落座、翻題＝紙頁翻動、揭曉＝rv* 子音軌（同一個音訊時鐘讀數一次排程）；事件：每題作答進度、完成與結果、quiz.reveal／quiz.reveal_skip（view） */
import { $, $$, reduced, setInert, esc } from './core.js?v=20261024c';
import { sfx, clock, hushCd, hushRv, buzzOf, vibrate, RV_HZ, RV_SPIN_HZ, RV_LAND_HZ } from './sound.js?v=20261024c';
import { track } from './track.js?v=20261024c';
import { submitResult, onResults, session } from './auth.js?v=20261024c';
import {
  ABILITIES, ABILITY_QUESTIONS, ABILITY_TEXT, scoreAbility,
  ROLES, ROLE_CODE, ROLE_TEXT, CAREER_QUESTIONS, scoreCareer,
} from './quizdata.js?v=20261024c';

export const STORE_KEY = 'grace.quiz.v1';
const SIGNIN = 'https://www.graceschool.com.tw/member/signin';
const NOTE = '本結果為自我探索參考，非正式心理測驗。';
export const OA_URL = 'https://line.me/R/ti/p/@52grace';
export const RITE_LINE = '接下來所有作答都沒有標準答案，請誠實作答！';

/* 倒數時間軸（ms，按下「開始」＝0）；規格見 mockup_v12/ready/motion.md */
export const CD_TL = {
  press: 150,          /* 0–150 按下：鈕沉 0.96、凹槽金圈亮起 */
  morph: 300,          /* 150–450 開始鈕移到中央、放大成錶面；準備頁內容 150–300 退場 */
  beats: [450, 1210, 1970], beat: 760, numIn: 220, numOut: 140, tail: 140,
  resolve: 2730,       /* 收束：金圈閉合、衝擊環、反光、「開始」回到錶面 */
  shock: 340, sheen: 380,
  out: 2850, outDur: 140,  /* 錶面縮至 0.88 並淡出 */
  q1: 2900,            /* 第 1 題自右滑入（260ms） */
  done: 3160,          /* 焦點移到第一個選項，倒數層移除 */
  skipOut: 150, guard: 220,
};
export const CD_RM = { fade: 200, chime: 200, hold: 400, q1: 600, done: 760 };
const EASE_OUT = 'cubic-bezier(0.23,1,0.32,1)', EASE_IN = 'cubic-bezier(0.55,0,1,0.45)', EASE_MOVE = 'cubic-bezier(0.77,0,0.175,1)';

/* 結果揭曉時間軸（ms，最後一題作答完成＝0）；規格見 mockup_v13/reveal/motion.md */
export const RV_TL = {                 /* 能力健檢 */
  exit: 150,                           /* 0–150 最後一題退場 */
  bg: 150, bgIn: 180,                  /* 霧面放射底淡入 */
  dial: 150, dialIn: 300, grid: 250,   /* 錶面浮起；格線 250–450 */
  text: 250, labels: 420,              /* 測驗名稱與略過提示上浮；能力名稱繞圈浮現（錯開 40ms） */
  axis0: 720, step: 220, grow: 240, tick: 140,   /* 第 i 軸＝720＋220i；金線 240ms；+140 珍珠落定＋tick */
  lock: 2300,                          /* 落定：面積、衝擊環、反光、輕壓 */
  word: 2380,                          /* 階段名逐字浮現 */
  morph: 2700, morphDur: 300,          /* 交棒：FLIP 平移到結果頁的位置、金轉墨 */
  kindIn: 2840, rest: 2900,            /* 「能力健檢結果」淡入；說明句與分項卡上浮 */
  done: 3000, end: 3190,               /* 換成結果頁上真正的元素、揭曉層移除 */
  lines: [300, 1100, 2240],            /* 狀態句：第 2、3 句在 +140 入場（1240／2380） */
};
export const RV_TL_C = {               /* 職涯定位 */
  exit: 150, bg: 150, dial: 150, text: 250, index: 300, marks: 420,
  spin: 700, spinDur: 1250, turn: 540, /* 錶圈順時針 540°，cubic-bezier(.4,0,.35,1) */
  converge: 1980, seal: 2230, lock: 2410,
  out: 2710, outDur: 140, rest: 2760, done: 3150,
  lines: [300, 1100, 2270],            /* 第 2、3 句在 1240／2410 入場 */
};
export const RV_RM = { fade: 200, chime: 200, hold: 400, out: 600, done: 600 };
export const RV_GUARD = 220, RV_SKIP_OUT = 150;
export const RV_LINES = {
  ability: ['整理妳的選擇', '對照七項能力', '妳的結果出爐了'],
  career: ['整理妳的選擇', '對照六種角色', '妳的角色出爐了'],
};
function bez(x1, y1, x2, y2) {
  const X = (t) => 3 * x1 * t * (1 - t) ** 2 + 3 * x2 * t * t * (1 - t) + t ** 3, Y = (t) => 3 * y1 * t * (1 - t) ** 2 + 3 * y2 * t * t * (1 - t) + t ** 3;
  return (x) => { let lo = 0, hi = 1; for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (X(m) < x) lo = m; else hi = m; } return Y((lo + hi) / 2); };
}
const SPIN = bez(0.4, 0, 0.35, 1);
const clamp01 = (u) => Math.max(0, Math.min(1, u));
/** 錶圈在 t 毫秒時轉過的角度（畫面與 tick 聲同一條曲線） */
export const spinAt = (t) => RV_TL_C.turn * SPIN(clamp01((t - RV_TL_C.spin) / RV_TL_C.spinDur));
/* 每經過一格（60°）一聲 tick：以二分法反求時間；共 9 聲，最後一聲＝停定（1950） */
export const RV_TICKS_C = Array.from({ length: RV_TL_C.turn / 60 }, (_, j) => {
  let lo = RV_TL_C.spin, hi = RV_TL_C.spin + RV_TL_C.spinDur;
  for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (spinAt(m) < 60 * (j + 1) - 1e-6) lo = m; else hi = m; }
  return Math.round(hi);
});

const QUIZ = {
  ability: { title: '能力健檢', meta: '14 題・約 3 分鐘', qs: ABILITY_QUESTIONS,
    lead: '看看妳在七種能力上現在的狀態。每題選一個最像妳平常反應的就好。' },
  career: { title: '職涯定位', meta: '12 題・約 2 分鐘', qs: CAREER_QUESTIONS,
    lead: '找出六種角色裡最像妳的那一個。每題二選一，憑直覺選就好。' },
};

/* ---------- 儲存 ---------- */
export function loadStore() {
  try { const v = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; }
}
function saveStore(kind, val) {
  try { const s = loadStore(); s[kind] = val; localStorage.setItem(STORE_KEY, JSON.stringify(s)); return true; } catch (e) { return false; }
}
/* 登入回應帶回的歷史結果（資料中心 results）：比本機新才覆蓋，供「上次結果」顯示 */
export function mergeResults(results) {
  if (!results || typeof results !== 'object') return;
  const s = loadStore();
  let changed = false;
  const a = results.ability, c = results.career;
  if (a && Number(a.at) > Number((s.ability && s.ability.at) || 0) && typeof (a.stage || a.label) === 'string') {
    s.ability = { stage: a.stage || a.label, top: a.top || '', low: a.low || '', at: Number(a.at) }; changed = true;
  }
  if (c && Number(c.at) > Number((s.career && s.career.at) || 0) && ROLES.includes(c.primary || c.label)) {
    s.career = { primary: c.primary || c.label, secondary: c.secondary || '', at: Number(c.at) }; changed = true;
  }
  if (!changed) return;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) { /* 無痕模式 */ }
  paintLast();
}
onResults(mergeResults);

export function clearStore() { try { localStorage.removeItem(STORE_KEY); } catch (e) { /* 無痕模式 */ } }

export function lastLabel(kind, s = loadStore()) {
  const v = s && s[kind];
  if (!v) return '';
  if (kind === 'ability' && typeof v.stage === 'string') return v.stage;
  if (kind === 'career' && typeof v.primary === 'string' && ROLES.includes(v.primary)) return v.primary;
  return '';
}

export function paintLast() {
  const s = loadStore();
  ['ability', 'career'].forEach((k) => {
    const el = document.getElementById(`last-${k}`);
    if (!el) return;
    const l = lastLabel(k, s);
    el.hidden = !l;
    el.textContent = l ? `上次結果・${l}` : '';
    const btn = el.closest('[data-quiz]');
    if (btn) btn.setAttribute('aria-label', `${QUIZ[k].title}，${QUIZ[k].meta}${l ? `，上次結果：${l}` : ''}，撕下票根開始測驗`);
  });
}

/* ---------- 圖表（SVG） ---------- */
function polar(cx, cy, r, i, n) {
  const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}
export function chartSvg(keys, vals, max, label) {
  const n = keys.length, cx = 180, cy = 170, R = 104;
  const ring = (k) => keys.map((_, i) => polar(cx, cy, (R * k) / 4, i, n).map((v) => v.toFixed(1)).join(',')).join(' ');
  const pts = keys.map((k, i) => polar(cx, cy, R * Math.max(0.08, vals[k] / max), i, n));
  const labels = keys.map((k, i) => {
    const [x, y] = polar(cx, cy, R + 22, i, n);
    const anchor = Math.abs(x - cx) < 6 ? 'middle' : x > cx ? 'start' : 'end';
    return `<text x="${x.toFixed(1)}" y="${(y + 5).toFixed(1)}" text-anchor="${anchor}">${esc(k)}</text>`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 360 340" role="img" aria-label="${esc(label)}">
    <g class="grid">${[1, 2, 3, 4].map((k) => `<polygon points="${ring(k)}"/>`).join('')}${keys.map((_, i) => { const [x, y] = polar(cx, cy, R, i, n); return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`; }).join('')}</g>
    <g class="shape" style="transform-origin:${cx}px ${cy}px"><polygon points="${pts.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ')}"/>${pts.map((p, i) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="4" style="--i:${i}"/>`).join('')}</g>
    <g class="labels">${labels}</g>
  </svg>`;
}

/* ---------- 結果卡（canvas，1080×1920，比稿方案 B：霧面卡＋黑曜石名牌） ---------- */
const CW = 1080, CH = 1920;
const CF = '"Noto Sans TC","Noto Sans TC Fallback","PingFang TC","Microsoft JhengHei",sans-serif';
function obsidianFill(c, x, y, w, h) {
  const g = c.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, '#2B2D35'); g.addColorStop(0.46, '#14151B'); g.addColorStop(1, '#08090C');
  c.fillStyle = g; c.fillRect(x, y, w, h);
  const r = c.createRadialGradient(x + w * 0.86, y + h * 1.05, 0, x + w * 0.86, y + h * 1.05, w * 0.9);
  r.addColorStop(0, 'rgba(96,108,168,.32)'); r.addColorStop(1, 'rgba(96,108,168,0)');
  c.fillStyle = r; c.fillRect(x, y, w, h);
  c.save(); c.globalAlpha = 0.07; c.strokeStyle = '#B8C2F0'; c.lineWidth = 2;
  for (let i = 0; i < 6; i++) { c.beginPath(); c.moveTo(x - 40, y + h * (0.12 + i * 0.16)); c.bezierCurveTo(x + w * 0.3, y + h * (0.02 + i * 0.16), x + w * 0.62, y + h * (0.26 + i * 0.16), x + w + 40, y + h * (0.1 + i * 0.16)); c.stroke(); }
  c.restore();
  const hi = c.createLinearGradient(0, y, 0, y + h * 0.45);
  hi.addColorStop(0, 'rgba(255,255,255,.18)'); hi.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = hi; c.fillRect(x + w * 0.05, y + 3, w * 0.9, h * 0.45);
}
function rr(c, x, y, w, h, r) {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
function txt(c, s, x, y, size, weight, color, align = 'center', track = 0) {
  c.font = `${weight} ${size}px ${CF}`; c.fillStyle = color; c.textAlign = align; c.textBaseline = 'alphabetic';
  if (track && 'letterSpacing' in c) c.letterSpacing = `${track}px`;
  c.fillText(s, x, y);
  if ('letterSpacing' in c) c.letterSpacing = '0px';
}
function fitSize(c, s, max, weight, width) {
  let size = max;
  c.font = `${weight} ${size}px ${CF}`;
  while (c.measureText(s).width > width && size > 40) { size -= 4; c.font = `${weight} ${size}px ${CF}`; }
  return size;
}
function cardChart(c, keys, vals, max, cx, cy, R) {
  const n = keys.length;
  c.save(); c.lineJoin = 'round';
  c.strokeStyle = 'rgba(120,120,116,.3)'; c.lineWidth = 2;
  for (let k = 1; k <= 4; k++) { c.beginPath(); keys.forEach((_, i) => { const [x, y] = polar(cx, cy, (R * k) / 4, i, n); c[i ? 'lineTo' : 'moveTo'](x, y); }); c.closePath(); c.stroke(); }
  c.beginPath(); keys.forEach((k, i) => { const [x, y] = polar(cx, cy, R * Math.max(0.08, vals[k] / max), i, n); c[i ? 'lineTo' : 'moveTo'](x, y); }); c.closePath();
  c.fillStyle = 'rgba(20,21,27,.1)'; c.fill(); c.strokeStyle = '#14151B'; c.lineWidth = 5; c.stroke();
  keys.forEach((k, i) => { const [x, y] = polar(cx, cy, R * Math.max(0.08, vals[k] / max), i, n); c.beginPath(); c.arc(x, y, 8, 0, Math.PI * 2); c.fillStyle = '#14151B'; c.fill(); });
  c.font = `500 30px ${CF}`; c.fillStyle = '#3A3A38'; c.textBaseline = 'middle';
  keys.forEach((k, i) => { const [x, y] = polar(cx, cy, R + 58, i, n); c.textAlign = Math.abs(x - cx) < 8 ? 'center' : x > cx ? 'left' : 'right'; c.fillText(k, x + (Math.abs(x - cx) < 8 ? 0 : x > cx ? -24 : 24), y); });
  c.restore();
}
export function drawCard(canvas, kind, r) {
  const c = canvas.getContext('2d');
  canvas.width = CW; canvas.height = CH;
  c.fillStyle = '#E4E4E2'; c.fillRect(0, 0, CW, CH);
  const logo = document.querySelector('.mast .logo');
  if (logo && logo.complete && logo.naturalWidth) { try { c.drawImage(logo, 405, 110, 270, 156); } catch (e) { /* 圖片尚未可用 */ } }
  const isA = kind === 'ability';
  const keys = isA ? ABILITIES : ROLES;
  const vals = isA ? r.scores : r.counts;
  const max = isA ? 6 : Math.max(3, ...Object.values(r.counts));
  cardChart(c, keys, vals, max, 540, 690, 250);
  /* 黑曜石名牌 */
  const y = 1110, x = 100, w = 880, h = 420;
  c.save(); c.shadowColor = 'rgba(12,12,18,.45)'; c.shadowBlur = 50; c.shadowOffsetY = 24; rr(c, x, y, w, h, 64); c.fillStyle = '#0B0C10'; c.fill(); c.restore();
  c.save(); rr(c, x, y, w, h, 64); c.clip(); obsidianFill(c, x, y, w, h); c.restore();
  txt(c, isA ? '能力健檢' : '職涯定位', 540, y + 92, 32, 500, '#B9B8C2', 'center', 10);
  const big = isA ? r.stage.name : r.primary;
  txt(c, big, 540, y + 268, fitSize(c, big, 150, 500, w - 120), 500, '#F4F2EC', 'center', 6);
  const sub = isA ? (r.allSame ? '七項能力發展平均' : `最強・${r.top}　補強・${r.low}`) : `副角色・${r.secondary}`;
  txt(c, sub, 540, y + 358, 38, 400, '#E2CB9A', 'center', 2);
  /* 重點 */
  const lines = isA
    ? (r.allSame ? [r.stage.desc.split('。')[0] + '。'] : [`最強能力・${r.top}`, `最需補強・${r.low}`])
    : ROLE_TEXT[r.primary].pros.map((p) => `優勢・${p.k}`);
  lines.forEach((l, i) => txt(c, l, 540, 1630 + i * 62, fitSize(c, l, 38, 400, 860), 400, '#2A2A28'));
  txt(c, NOTE.replace('。', ''), 540, 1850, 26, 400, '#5A5A58');
}

/* ---------- 主體 ---------- */
export function initQuiz({ onEnroll, onSwitch } = {}) {
  const box = $('#quiz');
  if (!box) return null;
  const page = $('.page');
  const title = $('#qz-title'), count = $('#qz-count'), bar = $('#qz-bar'), stage = $('#qz-stage'), closeBtn = $('#qz-close');
  const progress = $('#qz-progress');
  const state = { ability: null, career: null };   /* 作答中（未完成）保留於記憶體 */
  let kind = null, idx = -1, opener = null, advT = 0, cd = null, rv = null;
  const shell = $('.qz-shell', box);

  const motionOK = () => !reduced();
  const S = () => state[kind];

  function setProgress(i) {
    const n = QUIZ[kind].qs.length;
    const shown = i < 0 ? 0 : Math.min(n, i + 1);
    progress.hidden = i < 0 || i >= n;
    count.textContent = `${String(shown).padStart(2, '0')} / ${n}`;
    bar.style.setProperty('--p', String(i < 0 ? 0 : (i + 1) / n));
    progress.setAttribute('aria-valuenow', String(shown));
    progress.setAttribute('aria-valuemax', String(n));
    progress.setAttribute('aria-valuetext', `第 ${shown} 題，共 ${n} 題`);
  }

  /* 翻頁：舊頁往行進方向退出（ease-in，短），新頁從另一側進入（ease-out） */
  function turn(html, dir, after) {
    const old = stage.querySelector('.qpage:not(.out)');
    const el = document.createElement('div');
    el.className = 'qpage';
    el.innerHTML = html;
    if (old) {
      old.classList.add('out', dir < 0 ? 'to-r' : 'to-l');
      old.setAttribute('aria-hidden', 'true');
      setInert(old, true);
      setTimeout(() => old.remove(), motionOK() ? 170 : 160);
    }
    el.classList.add('in', dir < 0 ? 'from-l' : 'from-r');
    stage.append(el);
    stage.scrollTop = 0; box.scrollTop = 0;
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('in', 'from-l', 'from-r')));
    if (after) after(el);
    return el;
  }

  /* 開始前準備頁：撕下票根後的入場券（驗票章已蓋上）、作答提醒、「開始」、換另一個測驗 */
  function readyHtml() {
    const q = QUIZ[kind], s = S(), other = kind === 'ability' ? 'career' : 'ability';
    const resume = !!(s && s.answers.some((a) => a != null));
    return `<div class="q-ready">
      <div class="pass">
        <div class="pass-body"><span class="tk-issuer en">G.R.A.C.E</span><h3 class="pass-name" id="qz-name">${esc(q.title)}</h3></div>
        <span class="pass-tear" aria-hidden="true"></span>
        <span class="tk-stamp" aria-hidden="true"><svg class="i" focusable="false"><use href="#i-check"/></svg></span>
      </div>
      <p class="qr-note" id="qz-note">${esc(RITE_LINE)}</p>
      <div class="socket"><button class="start obs" type="button" data-act="start" aria-describedby="qz-note" data-ev="quiz.start" data-ev-meta='{"kind":"${kind}"}'><span>${resume ? '繼續' : '開始'}</span></button></div>
      <button class="txt-link qr-switch" type="button" data-act="other" data-ev="quiz.other" data-ev-meta='{"kind":"${other}"}'>換另一個測驗</button>
    </div>`;
  }

  function questionHtml(i) {
    const q = QUIZ[kind].qs[i], s = S(), a = s.answers[i], n = QUIZ[kind].qs.length;
    const opts = q.opts.map((o, k) => `<button class="opt${a === k ? ' obs' : ''}" type="button" role="radio" aria-checked="${a === k}" tabindex="${(a == null ? k === 0 : a === k) ? 0 : -1}" data-k="${k}"><i class="pearl" aria-hidden="true"></i><span>${esc(o.t)}</span></button>`).join('');
    return `<div class="q-ask">
      <p class="q-no" aria-hidden="true">第 ${i + 1} 題</p>
      <h3 class="q-text" id="qz-q">${esc(q.q)}</h3>
      <div class="opts${q.opts.length === 2 ? ' two' : ''}" role="radiogroup" aria-labelledby="qz-q">${opts}</div>
      <div class="q-nav">
        <button class="nav gl gl-clear" type="button" data-act="prev"${i === 0 ? ' disabled' : ''}><svg class="i" aria-hidden="true" focusable="false"><use href="#i-arrow"/></svg><span>上一題</span></button>
        <button class="nav gl gl-clear" type="button" data-act="next"${a == null ? ' disabled' : ''}><span>${i === n - 1 ? '看結果' : '下一題'}</span><svg class="i" aria-hidden="true" focusable="false"><use href="#i-arrow"/></svg></button>
      </div>
    </div>`;
  }

  const listHtml = (arr) => `<ul class="named">${arr.map((p) => `<li><b>${esc(p.k)}</b><span>${esc(p.v)}</span></li>`).join('')}</ul>`;

  function endingHtml() {
    return `<section class="ending" aria-labelledby="qz-end">
      <h4 id="qz-end">下一步</h4>
      <div class="toggle seg is-left" role="tablist" aria-label="選擇妳的身分">
        <i class="lever" aria-hidden="true"></i>
        <button type="button" role="tab" id="qz-tab-0" aria-controls="qz-pane-0" aria-selected="true" tabindex="0" data-ev="quiz.tab.member">我是學員</button>
        <button type="button" role="tab" id="qz-tab-1" aria-controls="qz-pane-1" aria-selected="false" tabindex="-1" data-ev="quiz.tab.guest">我還沒入學</button>
      </div>
      <div class="pane" role="tabpanel" id="qz-pane-0" aria-labelledby="qz-tab-0">
        <p>測驗結果只是起點，最適合妳的進修路徑，就交給校長親自為妳安排。現在到學員後台，進入「闖關挑戰」→「個人進修」提出申請。</p>
        <a class="cta cta-main gl gl-ink" href="${SIGNIN}" target="_blank" rel="noopener" data-ev="quiz.backend"><span>前往學員後台</span><span class="go"><svg class="i" aria-hidden="true" focusable="false"><use href="#i-arrow"/></svg></span></a>
      </div>
      <div class="pane" role="tabpanel" id="qz-pane-1" aria-labelledby="qz-tab-1" hidden>
        <p>想讓校長依照測驗結果安排個人進修課表，第一步是先成為 G.R.A.C.E 學姐。完成註冊和真人驗證，首次儲值 100,000 元開通「打底層」學員資格後，就可以提出申請。</p>
        <button class="cta cta-main gl gl-ink" type="button" data-act="enroll" data-ev="quiz.enroll"><span>開始入學</span><span class="go"><svg class="i" aria-hidden="true" focusable="false"><use href="#i-arrow"/></svg></span></button>
      </div>
    </section>`;
  }

  function cardHtml() {
    return `<section class="rcard" aria-labelledby="qz-card">
      <h4 id="qz-card">結果卡</h4>
      <div class="rcard-img"><img id="qz-card-img" alt="" width="1080" height="1920"></div>
      <button class="cta cta-sub gl gl-clear" type="button" data-act="save" data-ev="quiz.save"><span>存成圖片</span><span class="go"><svg class="i" aria-hidden="true" focusable="false"><use href="#i-down"/></svg></span></button>
      <p class="sr-only" id="qz-save-live" aria-live="polite"></p>
    </section>`;
  }

  /* LINE 登入者：加入學院官方 LINE（新分頁，次鍵，放在結果動作之下） */
  function addHtml() {
    const ss = session();
    if (!ss || ss.src !== 'line') return '';
    return `<a class="cta cta-sub gl gl-clear cta-add" href="${OA_URL}" target="_blank" rel="noopener" data-ev="rite.line_add"><span class="lbl-l"><span class="lead-ic"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#i-linef"/></svg></span><span class="lbl">加入 <span class="en">@52grace</span></span></span><span class="go"><svg class="i" aria-hidden="true" focusable="false"><use href="#i-ext"/></svg></span></a>`;
  }

  /* 登入者：「不是妳？切換帳號」（安靜的文字連結，結果動作之下）→ 登出本站並回到這個測驗的登入卡 */
  function switchHtml() {
    const ss = session();
    if (!ss) return '';
    return `<p class="r-switch"><button class="txt-link" type="button" data-act="switch" data-ev="who.switch">不是妳？切換帳號</button></p>`;
  }

  const nameHtml = (s) => [...s].map((ch, i) => `<span style="--i:${i}">${esc(ch)}</span>`).join('');

  function resultHtml(r) {
    if (kind === 'ability') {
      const label = r.allSame ? '七項能力分布圖：各項能力發展平均' : `七項能力分布圖：最強是${r.top}，最需補強是${r.low}`;
      return `<div class="result">
        <div class="reveal">
          <p class="r-kind">能力健檢結果</p>
          <div class="chart-wrap">${chartSvg(ABILITIES, r.scores, 6, label)}</div>
          <h3 class="r-big" aria-label="${esc(r.stage.name)}">${nameHtml(r.stage.name)}</h3>
          <p class="r-lead">${esc(r.stage.desc)}</p>
        </div>
        <div class="r-rest">
        ${r.allSame ? '' : `<section class="r-sec"><h4><i class="tag up" aria-hidden="true"></i>最強能力・${esc(r.top)}</h4><p>${esc(ABILITY_TEXT[r.top].strong)}</p></section>
        <section class="r-sec"><h4><i class="tag" aria-hidden="true"></i>最需補強・${esc(r.low)}</h4><p>${esc(ABILITY_TEXT[r.low].weak)}</p></section>`}
        ${cardHtml()}${endingHtml()}
        <div class="r-foot"><button class="cta cta-sub gl gl-clear" type="button" data-act="again" data-ev="quiz.again" data-ev-meta='{"kind":"${kind}"}'><span>重新測驗</span><span class="go"><svg class="i" aria-hidden="true" focusable="false"><use href="#i-redo"/></svg></span></button>${addHtml()}${switchHtml()}
        <p class="r-note">${NOTE}</p></div>
        </div>
      </div>`;
    }
    const P = ROLE_TEXT[r.primary], S2 = ROLE_TEXT[r.secondary];
    return `<div class="result">
      <div class="reveal">
        <p class="r-kind">職涯定位結果</p>
        <div class="chart-wrap">${chartSvg(ROLES, r.counts, Math.max(3, ...Object.values(r.counts)), `六種角色分布圖：主角色${r.primary}，副角色${r.secondary}`)}</div>
        <h3 class="r-big" aria-label="${esc(r.primary)}">${nameHtml(r.primary)}</h3>
        <p class="r-sub">副角色・<b>${esc(r.secondary)}</b><span class="code en" aria-hidden="true">${ROLE_CODE[r.primary]}${ROLE_CODE[r.secondary]}</span></p>
        <p class="r-lead">${esc(P.desc)}</p>
      </div>
      <div class="r-rest">
      <section class="r-sec"><h4><i class="tag up" aria-hidden="true"></i>優勢</h4>${listHtml(P.pros)}</section>
      <section class="r-sec"><h4><i class="tag" aria-hidden="true"></i>卡點</h4>${listHtml(P.cons)}</section>
      <section class="r-sec"><h4><i class="tag up" aria-hidden="true"></i>適合方向</h4>${listHtml(P.paths)}</section>
      <section class="r-sec r-second"><h4>副角色・${esc(r.secondary)}</h4><p>${esc(S2.desc)}</p></section>
      ${cardHtml()}${endingHtml()}
      <div class="r-foot"><button class="cta cta-sub gl gl-clear" type="button" data-act="again" data-ev="quiz.again" data-ev-meta='{"kind":"${kind}"}'><span>重新測驗</span><span class="go"><svg class="i" aria-hidden="true" focusable="false"><use href="#i-redo"/></svg></span></button>${addHtml()}${switchHtml()}
      <p class="r-note">${NOTE}</p></div>
      </div>
    </div>`;
  }

  /* ---------- 流程 ---------- */
  /** 開始前準備頁（登入完成、已登入撕票、重新測驗、換另一個測驗）；via 記錄從哪裡進來 */
  function showReady(dir = 1, via = '') {
    cdCancel(); rvCancel();
    clearTimeout(advT);
    idx = -1; setProgress(-1);
    turn(readyHtml(), dir, (el) => setTimeout(() => { const b = el.querySelector('.start'); if (b) b.focus({ preventScroll: true }); }, 30));
    track('quiz.ready', 'view', { kind, via });
  }
  const focusOpt = () => { const t = stage.querySelector('.qpage:not(.out) .opt[tabindex="0"]'); if (t) t.focus({ preventScroll: true }); };
  function showQ(i, dir = 1, { focus = true } = {}) {
    clearTimeout(advT);
    if (stage.querySelector('.qpage:not(.out) .q-ask')) sfx('flip');
    idx = i; setProgress(i);
    turn(questionHtml(i), dir, () => { if (focus) setTimeout(focusOpt, 30); });
  }

  /* ---------- 3-2-1 倒數 ---------- */
  const firstOpen = () => { const f = S().answers.findIndex((a) => a == null); return f < 0 ? 0 : f; };
  const anim = (c, el, kf, o) => { if (!el) return null; const a = el.animate(kf, Object.assign({ fill: 'both' }, o)); c.anims.push(a); return a; };
  const later = (c, ms, f) => { c.timers.push(setTimeout(f, Math.max(0, ms - (performance.now() - c.t0)))); };

  function cdHtml(rm) {
    const t = esc(QUIZ[kind].title);
    if (rm) return `<span class="qcd-bg" aria-hidden="true"></span><button class="qcd-hit" type="button" aria-label="略過，直接開始"><span class="qcd-ready" aria-hidden="true">準備好了</span></button><span class="sr-only" role="status"></span>`;
    const nums = ['3', '2', '1'].map((n) => `<span class="qcd-num" aria-hidden="true">${n}</span>`).join('');
    return `<span class="qcd-bg" aria-hidden="true"></span>
      <button class="qcd-hit" type="button" aria-label="略過倒數，直接開始"><span class="qcd-fit"><span class="qcd-stack">
        <span class="qcd-kind" aria-hidden="true">${t}</span>
        <span class="qcd-well" aria-hidden="true">
          <svg class="qcd-arc" viewBox="0 0 292 292" focusable="false"><circle class="trk" cx="146" cy="146" r="135"/><circle class="sweep" cx="146" cy="146" r="135" stroke-dasharray="0 900"/></svg>
          <span class="qcd-orbit"><i class="qcd-head"></i></span>
          <span class="qcd-dial"><span class="qcd-word">開始</span>${nums}<span class="qcd-sheen"></span></span>
          <i class="qcd-shock"></i>
        </span>
        <span class="qcd-skip" aria-hidden="true">輕點畫面，就能直接開始</span>
      </span></span></button>
      <span class="sr-only" role="status"></span>`;
  }

  /** 按下「開始」：一次排程整段倒數（畫面與聲音同一基準），結束時第 1 題自右滑入 */
  function begin(btn) {
    if (cd || idx >= 0 || !kind) return;
    if (!S()) state[kind] = { answers: new Array(QUIZ[kind].qs.length).fill(null) };
    const first = firstOpen();
    const ready = btn.closest('.q-ready');
    const rm = !motionOK() || typeof btn.animate !== 'function';
    const a0 = clock();                                   /* 唯一一次音訊時鐘讀數：之後所有聲音＝a0＋毫秒 */
    const c = cd = { t0: performance.now(), rm, first, anims: [], timers: [], raf: 0, q1: false, done: false, el: null, hit: null };
    const at = (name, ms, arg) => sfx(name, { at: a0 != null ? a0 + ms / 1000 : null, delay: ms / 1000, arg });
    const L = CD_TL;
    /* 聲音：按下的輕叩立即發聲（回饋不等排程）；倒數各聲在取得時鐘後立刻以 a0 一次排好，之後的 DOM 工作再久也不會漂移 */
    sfx('key');
    if (rm) at('cdReady', CD_RM.chime);
    else { at('cdSlide', L.press); L.beats.forEach((t, i) => at('cdTick', t, { i })); at('cdResolve', L.resolve); at('cdWhoosh', L.q1); }

    const el = c.el = document.createElement('div');
    el.className = `qcd${rm ? ' rm' : ''}`;
    el.innerHTML = cdHtml(rm);
    box.append(el);
    c.hit = el.querySelector('.qcd-hit');
    c.hit.addEventListener('click', () => cdSkip());
    c.hit.addEventListener('keydown', (e) => { if (e.repeat && (e.key === 'Enter' || e.key === ' ')) e.preventDefault(); });
    setInert(shell, true);
    c.hit.focus({ preventScroll: true });
    const status = el.querySelector('[role="status"]');
    later(c, 60, () => { status.textContent = rm ? `${QUIZ[kind].title}，準備好了，即將開始第 ${first + 1} 題` : `${QUIZ[kind].title}，3 秒後開始第 ${first + 1} 題`; });
    ready.classList.add('is-press');

    const bg = el.querySelector('.qcd-bg');
    if (rm) {
      /* 減少動態：準備頁淡出、霧面底上「準備好了」淡入 → 停留 → 淡出 → 第 1 題淡入 */
      const word = el.querySelector('.qcd-ready');
      if (typeof ready.animate === 'function') {
        anim(c, ready, [{ opacity: 1 }, { opacity: 0 }], { duration: CD_RM.fade, easing: 'ease-out', fill: 'forwards' });
        [bg, word].forEach((x) => {
          anim(c, x, [{ opacity: 0 }, { opacity: 1 }], { duration: CD_RM.fade, easing: 'ease-out', fill: 'backwards' });
          anim(c, x, [{ opacity: 1 }, { opacity: 0 }], { delay: CD_RM.hold, duration: CD_RM.q1 - CD_RM.hold, easing: 'ease-in', fill: 'forwards' });
        });
      }
      later(c, CD_RM.q1, () => { c.q1 = true; showQ(first, 1, { focus: false }); });
      later(c, CD_RM.done, () => cdEnd(c));
      return;
    }

    /* 0–150 按下（CSS .is-press）；150–300 準備頁其他內容退場 */
    $$('.pass, .qr-note, .qr-switch', ready).forEach((x) => anim(c, x,
      [{ opacity: 1, filter: 'blur(0px)', transform: 'translateY(0px)' }, { opacity: 0, filter: 'blur(4px)', transform: 'translateY(-12px)' }],
      { delay: L.press, duration: 150, easing: EASE_IN, fill: 'forwards' }));
    /* 150–330 霧面底淡入；錶盤以外的文字 250–450 浮現 */
    anim(c, bg, [{ opacity: 0 }, { opacity: 1 }], { delay: L.press, duration: 180, easing: EASE_OUT, fill: 'backwards' });
    $$('.qcd-kind, .qcd-skip', el).forEach((x) => anim(c, x, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0px)' }],
      { delay: L.press + 100, duration: 200, easing: EASE_OUT, fill: 'backwards' }));
    /* 150–450 開始鈕化成錶面：錶圈從凹槽的位置與大小（FLIP）移到中央 */
    const well = el.querySelector('.qcd-well'), sock = ready.querySelector('.socket');
    const wr = well.getBoundingClientRect(), sr = sock.getBoundingClientRect();
    const ps = wr.width / (well.offsetWidth || 1) || 1;  /* 矮螢幕時外層有縮放：位移要換回錶圈自己的座標 */
    const k = sr.width / (wr.width || 1), dx = (sr.left + sr.width / 2 - (wr.left + wr.width / 2)) / ps, dy = (sr.top + sr.height / 2 - (wr.top + wr.height / 2)) / ps;
    anim(c, well, [{ opacity: 0 }, { opacity: 1 }], { delay: L.press, duration: 1, fill: 'backwards' });
    anim(c, well, [{ transform: `translate(${dx.toFixed(1)}px,${dy.toFixed(1)}px) scale(${k.toFixed(4)})` }, { transform: 'translate(0px,0px) scale(1)' }],
      { delay: L.press, duration: L.morph, easing: EASE_OUT, fill: 'backwards', composite: 'replace' });
    const dial = el.querySelector('.qcd-dial');
    anim(c, dial, [{ transform: 'scale(0.96)' }, { transform: 'scale(1)' }], { delay: L.press, duration: L.morph, easing: EASE_OUT, fill: 'backwards' });
    later(c, L.press, () => sock.classList.add('handoff'));
    /* 「開始」150 淡出＋blur，2730 回到錶面 */
    const W = L.resolve + 220 - L.press;
    anim(c, el.querySelector('.qcd-word'), [
      { offset: 0, opacity: 1, filter: 'blur(0px)', transform: 'scale(1)', easing: EASE_IN },
      { offset: 240 / W, opacity: 0, filter: 'blur(4px)', transform: 'scale(0.96)' },
      { offset: (L.resolve - L.press) / W, opacity: 0, filter: 'blur(6px)', transform: 'scale(1.08)', easing: EASE_OUT },
      { offset: 1, opacity: 1, filter: 'blur(0px)', transform: 'scale(1)' },
    ], { delay: L.press, duration: W });
    /* 3／2／1：每拍 760ms——220ms 入場（1.16→1、blur 8→0），最後 140ms 退場（→0.92、blur 4） */
    $$('.qcd-num', el).forEach((n, i) => {
      anim(c, n, [
        { offset: 0, opacity: 0, filter: 'blur(8px)', transform: 'translateY(-3px) scale(1.16)', easing: EASE_OUT },
        { offset: L.numIn / L.beat, opacity: 1, filter: 'blur(0px)', transform: 'translateY(-3px) scale(1)' },
        { offset: (L.beat - L.numOut) / L.beat, opacity: 1, filter: 'blur(0px)', transform: 'translateY(-3px) scale(1)', easing: EASE_IN },
        { offset: 1, opacity: 0, filter: 'blur(4px)', transform: 'translateY(-3px) scale(0.92)' },
      ], { delay: L.beats[i], duration: L.beat });
    });
    /* 2730 收束：衝擊環外擴、反光掠過；2850 錶面縮小淡出、霧面底淡出 */
    anim(c, el.querySelector('.qcd-shock'), [{ opacity: 0.9, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(1.45)' }], { delay: L.resolve, duration: L.shock, easing: EASE_OUT, fill: 'forwards' });
    anim(c, el.querySelector('.qcd-sheen'), [{ transform: 'translateX(-140%) skewX(-18deg)' }, { transform: 'translateX(330%) skewX(-18deg)' }], { delay: L.resolve, duration: L.sheen, easing: 'cubic-bezier(.3,0,.2,1)', fill: 'forwards' });
    anim(c, el.querySelector('.qcd-stack'), [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.88)' }], { delay: L.out, duration: L.outDur, easing: EASE_IN, fill: 'forwards' });
    anim(c, bg, [{ opacity: 1 }, { opacity: 0 }], { delay: L.out, duration: L.outDur, easing: EASE_IN, fill: 'forwards' });
    later(c, L.q1, () => { c.q1 = true; showQ(first, 1, { focus: false }); });
    later(c, L.done, () => cdEnd(c));
    /* 金弧：進度指示，線性掃一圈；每拍最後 140ms 由尾端收回（最後一拍不收、直接閉合） */
    const sweep = el.querySelector('.sweep'), orbit = el.querySelector('.qcd-orbit'), C = 2 * Math.PI * 135;
    const draw = () => {
      if (cd !== c) return;
      const e = performance.now() - c.t0;
      let h = 0, tl = 0;
      if (e >= L.resolve) h = 1;
      else if (e >= L.beats[0]) {
        const i = Math.min(2, Math.floor((e - L.beats[0]) / L.beat)), b = L.beats[i];
        h = Math.min(1, (e - b) / L.beat);
        const r = i < 2 ? Math.max(0, Math.min(1, (e - (b + L.beat - L.tail)) / L.tail)) : 0;
        tl = r * r * r;                                   /* ease-in：收回越來越快 */
        h = Math.max(h, tl);
      }
      sweep.setAttribute('stroke-dasharray', `${((h - tl) * C).toFixed(2)} ${C.toFixed(2)}`);
      sweep.setAttribute('stroke-dashoffset', (-tl * C).toFixed(2));
      orbit.style.transform = `rotate(${(h * 360).toFixed(2)}deg)`;
      orbit.style.opacity = h > 0 && h < 1 ? '1' : '0';
      if (e < L.out + L.outDur) c.raf = requestAnimationFrame(draw);
    };
    c.raf = requestAnimationFrame(draw);
  }

  /** 倒數結束：移除倒數層、恢復可操作，焦點到第一個選項 */
  function cdEnd(c) {
    if (cd !== c) return;
    cd = null;
    c.timers.forEach(clearTimeout); cancelAnimationFrame(c.raf);
    c.el.remove();
    setInert(shell, false);
    focusOpt();
  }
  /** 略過：倒數子音軌立即淡出（不播收束鐘聲），倒數層 150ms 淡出，第 1 題立即滑入 */
  function cdSkip() {
    const c = cd;
    if (!c || c.skipped) return;
    const e = performance.now() - c.t0;
    if (e < CD_TL.guard) return;                          /* 連點「開始」的第二下不算略過 */
    c.skipped = true;
    c.timers.forEach(clearTimeout); c.timers = [];
    cancelAnimationFrame(c.raf);
    hushCd();
    track('quiz.skip', 'view', { kind });
    c.el.style.pointerEvents = 'none';
    if (typeof c.el.animate === 'function') c.el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: CD_TL.skipOut, easing: EASE_IN, fill: 'forwards' });
    if (!c.q1) { c.q1 = true; sfx('cdWhoosh'); showQ(c.first, 1, { focus: false }); }
    later(c, e + CD_TL.skipOut, () => cdEnd(c));
  }
  /** 關閉測驗或重畫準備頁：直接拆掉倒數（不留聲音） */
  function cdCancel() {
    const c = cd;
    if (!c) return;
    cd = null;
    c.timers.forEach(clearTimeout); cancelAnimationFrame(c.raf);
    hushCd();
    c.el.remove();
    setInert(shell, false);
  }
  function finish() {
    clearTimeout(advT);
    const s = S();
    const r = kind === 'ability' ? scoreAbility(s.answers) : scoreCareer(s.answers);
    s.result = r;
    const saved = kind === 'ability'
      ? { stage: r.stage.name, top: r.top, low: r.low, at: Date.now() }
      : { primary: r.primary, secondary: r.secondary, at: Date.now() };
    saveStore(kind, saved);
    paintLast();
    track('quiz.complete', 'complete', kind === 'ability'
      ? { kind, result: r.stage.name, top: r.allSame ? '' : r.top, low: r.allSame ? '' : r.low, total: r.total }
      : { kind, result: r.primary, secondary: r.secondary });
    /* 契約 quiz.result：登入中送出（背景，不等回應）；資料中心會自動補 quiz_done 事件 */
    submitResult(kind === 'ability'
      ? { kind, at: saved.at, answers: s.answers.slice(), total: r.total, stage: r.stage.name, top: r.allSame ? '' : r.top, low: r.allSame ? '' : r.low, scores: r.scores }
      : { kind, at: saved.at, answers: s.answers.slice(), primary: r.primary, secondary: r.secondary, counts: r.counts });
    state[kind] = null;                                   /* 完成後清掉作答，下次從頭開始 */
    idx = QUIZ[kind].qs.length; setProgress(idx);
    box.classList.add('done');
    const k = kind;
    /* 結果卡：揭曉結束後（等字型就緒）再繪製，不在揭曉動畫中占用主執行緒 */
    const paint = (el) => {
      const img = el.querySelector('#qz-card-img');
      if (!img) return;
      const go = () => {
        try {
          const cv = document.createElement('canvas');
          drawCard(cv, k, r);
          img.src = cv.toDataURL('image/png');
          img.alt = k === 'ability' ? `能力健檢結果卡：${r.stage.name}` : `職涯定位結果卡：主角色${r.primary}，副角色${r.secondary}`;
          img.dataset.kind = k;
          el._canvas = cv;
        } catch (e) { img.closest('.rcard').hidden = true; }
      };
      const fr = document.fonts && document.fonts.ready;
      if (fr && typeof fr.then === 'function') fr.then(go, go); else go();
    };
    if (typeof stage.animate === 'function') { rvStart(r, paint); return; }
    /* 後備（不支援 Web Animations）：原本的生長版本 */
    sfx('reveal', { delay: motionOK() ? 0.12 : 0 });
    const el = turn(resultHtml(r), 1);
    el.querySelector('.result').classList.add('grow');
    requestAnimationFrame(() => requestAnimationFrame(() => el.querySelector('.result').classList.add('go')));
    const h = el.querySelector('.r-big'); h.tabIndex = -1;
    setTimeout(() => h.focus({ preventScroll: true }), 40);
    paint(el);
  }

  /* ---------- 結果揭曉 ---------- */
  const f1 = (v) => v.toFixed(1);
  /** 一個元素一條軌道：steps＝[[毫秒, 樣式, 該段 easing], …]，fill both（開始前停在第一格、結束後停在最後一格） */
  const frames = (steps) => { const t0 = steps[0][0], d = Math.max(1, steps[steps.length - 1][0] - t0); return steps.map(([ms, p, e]) => Object.assign({ offset: (ms - t0) / d, easing: e || 'linear' }, p)); };
  function tl(c, el, steps) {
    if (!el) return null;
    const t0 = steps[0][0], d = Math.max(1, steps[steps.length - 1][0] - t0);
    const a = el.animate(frames(steps), { delay: t0, duration: d, fill: 'both' });
    c.anims.push(a);
    return a;
  }
  const riseIn = (c, el, a, dur, dy = 10) => tl(c, el, [[a, { opacity: 0, transform: `translateY(${dy}px)` }, EASE_OUT], [a + dur, { opacity: 1, transform: 'translateY(0px)' }]]);
  const fadeOut = (c, el, a, b) => tl(c, el, [[a, { opacity: 1 }, EASE_IN], [b, { opacity: 0 }]]);

  function abilityStageHtml(r) {
    const K = ABILITIES, n = K.length, cx = 180, cy = 170, R = 104;
    const ring = (k) => K.map((_, i) => polar(cx, cy, (R * k) / 4, i, n).map(f1).join(',')).join(' ');
    const tips = K.map((k, i) => polar(cx, cy, R * Math.max(0.08, r.scores[k] / 6), i, n));
    const labels = K.map((k, i) => { const [x, y] = polar(cx, cy, R + 22, i, n); const an = Math.abs(x - cx) < 6 ? 'middle' : x > cx ? 'start' : 'end'; return `<text class="qrv-label" x="${f1(x)}" y="${f1(y + 5)}" text-anchor="${an}">${esc(k)}</text>`; }).join('');
    return `<span class="qrv-stage">
        <span class="qrv-dial"><span class="qrv-sheen"></span></span>
        <i class="qrv-shock"></i>
        <svg class="qrv-svg" viewBox="0 0 360 340" focusable="false">
          <defs><radialGradient id="qrv-pearl" cx="40%" cy="30%" r="70%"><stop offset="0" stop-color="#F7E9C8"/><stop offset=".6" stop-color="#D7BC84"/><stop offset="1" stop-color="#A9874A"/></radialGradient></defs>
          <g class="qrv-grid">${[1, 2, 3, 4].map((k) => `<polygon points="${ring(k)}"/>`).join('')}${K.map((_, i) => { const [x, y] = polar(cx, cy, R, i, n); return `<line x1="${cx}" y1="${cy}" x2="${f1(x)}" y2="${f1(y)}"/>`; }).join('')}</g>
          <polygon class="qrv-fill" points="${tips.map((p) => p.map(f1).join(',')).join(' ')}"/>
          <g class="qrv-glow">
            ${tips.map((p) => `<line class="qrv-spoke" pathLength="1" x1="${cx}" y1="${cy}" x2="${f1(p[0])}" y2="${f1(p[1])}"/>`).join('')}
            ${tips.map((p, i) => { const q = tips[(i + n - 1) % n]; return `<line class="qrv-edge" pathLength="1" x1="${f1(q[0])}" y1="${f1(q[1])}" x2="${f1(p[0])}" y2="${f1(p[1])}"/>`; }).join('')}
          </g>
          ${tips.map((p) => `<circle class="qrv-tip" cx="${f1(p[0])}" cy="${f1(p[1])}" r="4.5"/>`).join('')}
          ${tips.map((p) => `<circle class="qrv-dot" cx="${f1(p[0])}" cy="${f1(p[1])}" r="4"/>`).join('')}
          ${labels}
        </svg>
      </span>
      <span class="qrv-word">${[...r.stage.name].map((ch) => `<span>${esc(ch)}</span>`).join('')}</span>`;
  }
  function careerStageHtml(r) {
    const marks = ROLES.map((x) => `<span class="qrv-mark">${ROLE_CODE[x]}</span>`).join('');
    return `<span class="qrv-well">
        <span class="qrv-dial"><img class="qrv-emblem" src="assets/img/logo-academy-mark.webp" width="122" height="136" alt="">
          <span class="qrv-seal"><span class="qrv-seal-code">${ROLE_CODE[r.primary]}${ROLE_CODE[r.secondary]}</span><span class="qrv-seal-name">${esc(r.primary)}</span><span class="qrv-seal-sub">副・${esc(r.secondary)}</span></span>
          <span class="qrv-sheen"></span></span>
        <i class="qrv-shock"></i>
        <span class="qrv-marks">${marks}</span>
        <i class="qrv-index"></i>
      </span>`;
  }
  function rvHtml(k, r, rm) {
    if (rm) return `<span class="qrv-bg" aria-hidden="true"></span><button class="qrv-hit" type="button" aria-label="略過，直接看結果"><span class="qrv-rm-word" aria-hidden="true">結果出爐</span></button><span class="sr-only" role="status"></span>`;
    return `<span class="qrv-bg" aria-hidden="true"></span>
      <button class="qrv-hit" type="button" aria-label="略過，直接看結果"><span class="qrv-stack" aria-hidden="true">
        <span class="qrv-kind">${esc(QUIZ[k].title)}</span>
        ${k === 'ability' ? abilityStageHtml(r) : careerStageHtml(r)}
        <span class="qrv-line">${RV_LINES[k].map((l) => `<span>${esc(l)}</span>`).join('')}</span>
        <span class="qrv-skip">輕點畫面，直接看結果</span>
      </span></button>
      <span class="sr-only" role="status"></span>`;
  }

  /** 揭曉開始：結果頁已在底下排好（隱藏），揭曉層蓋在上面；畫面與聲音以同一刻為基準一次排程 */
  function rvStart(r, paint) {
    const k = kind, isA = k === 'ability', rm = !motionOK();
    const a0 = clock();                                   /* 唯一一次音訊時鐘讀數：之後所有聲音＝a0＋毫秒 */
    const c = rv = { t0: performance.now(), kind: k, rm, anims: [], timers: [], raf: 0, el: null, hit: null, res: null, old: null, skipped: false, paint, pose: null };
    /* 聲音一次排好；震動由本層計時器觸發（略過時一起取消） */
    const at = (name, ms, arg) => {
      sfx(name, { at: a0 != null ? a0 + ms / 1000 : null, delay: ms / 1000, arg, haptic: false });
      const p = name === 'rvTick' && !isA ? 4 : buzzOf(name);
      if (p != null) later(c, ms, () => vibrate(p));
    };
    const L = RV_TL, C = RV_TL_C;
    if (rm) at('rvChime', RV_RM.chime);
    else if (isA) {
      at('rvPad', L.bg, { dur: (L.lock - 10 - L.bg) / 1000 });
      ABILITIES.forEach((_, i) => at('rvTick', L.axis0 + i * L.step + L.tick, { f: RV_HZ[i], i }));
      at('rvLock', L.lock);
      at('rvRise', L.morph);
    } else {
      at('rvPad', C.bg, { dur: (C.lock - 10 - C.bg) / 1000 });
      const T = RV_TICKS_C, last = T.length - 1, gaps = T.map((t, i) => t - (i ? T[i - 1] : C.spin)), g0 = Math.min(...gaps.slice(0, last));
      T.forEach((t, i) => at('rvTick', t, i === last ? { f: RV_LAND_HZ, gain: 1, i } : { f: RV_SPIN_HZ[i % 3], gain: 0.55 + 0.45 * (g0 / gaps[i]), i }));
      at('rvLock', C.lock, { stamp: true });
      at('rvRise', C.out);
    }

    /* 結果頁排在底下；最後一題退場 */
    const old = c.old = stage.querySelector('.qpage:not(.out)');
    const res = c.res = document.createElement('div');
    res.className = 'qpage';
    res.innerHTML = resultHtml(r);
    if (old) { old.classList.add('out'); old.setAttribute('aria-hidden', 'true'); setInert(old, true); }
    stage.append(res);
    stage.scrollTop = 0; box.scrollTop = 0;
    const big = res.querySelector('.r-big'); big.tabIndex = -1;

    const el = c.el = document.createElement('div');
    el.className = `qrv${rm ? ' rm' : ''}`;
    el.innerHTML = rvHtml(k, r, rm);
    box.append(el);
    c.hit = el.querySelector('.qrv-hit');
    c.hit.addEventListener('click', () => rvSkip());
    c.hit.addEventListener('keydown', (e) => { if (e.repeat && (e.key === 'Enter' || e.key === ' ')) e.preventDefault(); });
    const still = (e) => e.preventDefault();             /* 揭曉中不捲動底下的結果頁（交棒位置以結果頁為準） */
    el.addEventListener('wheel', still, { passive: false });
    el.addEventListener('touchmove', still, { passive: false });
    setInert(shell, true);
    c.hit.focus({ preventScroll: true });
    const status = el.querySelector('[role="status"]');
    later(c, 60, () => { status.textContent = isA ? `能力健檢結果出爐：${r.stage.name}` : `職涯定位結果出爐：主角色${r.primary}，副角色${r.secondary}`; });
    track('quiz.reveal', 'view', { kind: k });
    const bg = el.querySelector('.qrv-bg');

    if (rm) {
      /* 減少動態：0–200 最後一題淡出、「結果出爐」淡入；200–400 停留；400–600 淡出、結果頁同步淡入 */
      tl(c, old, [[0, { opacity: 1 }, 'ease-out'], [RV_RM.fade, { opacity: 0 }]]);
      [bg, el.querySelector('.qrv-rm-word')].forEach((x) => tl(c, x, [[0, { opacity: 0 }, 'ease-out'], [RV_RM.fade, { opacity: 1 }], [RV_RM.hold, { opacity: 1 }, 'ease-in'], [RV_RM.out, { opacity: 0 }]]));
      tl(c, res, [[RV_RM.hold, { opacity: 0 }, 'ease-out'], [RV_RM.out, { opacity: 1 }]]);
      later(c, RV_RM.done, () => rvEnd(c));
      return;
    }
    /* 0–150 最後一題退場（同倒數時準備頁的退場） */
    tl(c, old, [[0, { opacity: 1, filter: 'blur(0px)', transform: 'translateY(0px)' }, EASE_IN], [L.exit, { opacity: 0, filter: 'blur(4px)', transform: 'translateY(-12px)' }]]);
    later(c, L.exit + 20, () => { if (old) old.remove(); });
    /* 狀態句：三句疊在同一格依序替換（入 200 ease-out、出 140 ease-in、上下 6px） */
    const sw = isA ? L.lines : C.lines, ln = $$('.qrv-line span', el);
    tl(c, ln[0], [[sw[0], { opacity: 0, transform: 'translateY(6px)' }, EASE_OUT], [sw[0] + 200, { opacity: 1, transform: 'translateY(0px)' }], [sw[1], { opacity: 1, transform: 'translateY(0px)' }, EASE_IN], [sw[1] + 140, { opacity: 0, transform: 'translateY(-6px)' }]]);
    tl(c, ln[1], [[sw[1] + 140, { opacity: 0, transform: 'translateY(6px)' }, EASE_OUT], [sw[1] + 340, { opacity: 1, transform: 'translateY(0px)' }], [sw[2], { opacity: 1, transform: 'translateY(0px)' }, EASE_IN], [sw[2] + 140, { opacity: 0, transform: 'translateY(-6px)' }]]);
    tl(c, ln[2], [[sw[2] + 140, { opacity: 0, transform: 'translateY(6px)' }, EASE_OUT], [sw[2] + 340, { opacity: 1, transform: 'translateY(0px)' }]]);
    /* 測驗名稱與略過提示：250–450 上浮 6px（能力健檢在交棒時 140ms 淡出；職涯定位隨整組縮小淡出） */
    const tx = isA ? L.text : C.text;
    $$('.qrv-kind, .qrv-skip', el).forEach((x) => tl(c, x, isA
      ? [[tx, { opacity: 0, transform: 'translateY(6px)' }, EASE_OUT], [tx + 200, { opacity: 1, transform: 'translateY(0px)' }], [L.morph, { opacity: 1, transform: 'translateY(0px)' }, EASE_IN], [L.morph + 140, { opacity: 0, transform: 'translateY(0px)' }]]
      : [[tx, { opacity: 0, transform: 'translateY(6px)' }, EASE_OUT], [tx + 200, { opacity: 1, transform: 'translateY(0px)' }]]));
    if (isA) rvAbility(c, r, el, res, bg); else rvCareer(c, r, el, res, bg);
  }

  function rvAbility(c, r, el, res, bg) {
    const L = RV_TL, n = ABILITIES.length;
    const st = el.querySelector('.qrv-stage'), dial = el.querySelector('.qrv-dial'), word = el.querySelector('.qrv-word');
    const spokes = $$('.qrv-spoke', el), edges = $$('.qrv-edge', el), tips = $$('.qrv-tip', el), dots = $$('.qrv-dot', el), labels = $$('.qrv-label', el);
    const chart = res.querySelector('.chart'), big = res.querySelector('.r-big');
    const M = L.morph, ME = L.morph + L.morphDur;
    tl(c, bg, [[L.bg, { opacity: 0 }, EASE_OUT], [L.bg + L.bgIn, { opacity: 1 }], [M + 60, { opacity: 1 }, 'ease-in-out'], [M + 260, { opacity: 0 }]]);
    /* 150–450 錶面浮起；2700 起 120ms 內縮至 0.94 淡出 */
    tl(c, dial, [[L.dial, { opacity: 0, transform: 'scale(0.92)' }, EASE_OUT], [L.dial + L.dialIn, { opacity: 1, transform: 'scale(1)' }], [M, { opacity: 1, transform: 'scale(1)' }, EASE_IN], [M + 120, { opacity: 0, transform: 'scale(0.94)' }]]);
    tl(c, el.querySelector('.qrv-grid'), [[L.grid, { opacity: 0 }, EASE_OUT], [L.grid + 200, { opacity: 1 }]]);
    $$('.qrv-grid polygon, .qrv-grid line', el).forEach((g) => tl(c, g, [[M, { stroke: 'rgba(226,203,154,.2)' }, EASE_OUT], [M + 200, { stroke: 'rgba(120,120,116,.32)' }]]));
    /* 能力名稱：420 起繞圈浮現（墨色第三階）→ 該軸點亮時轉香檳金字 → 落定回到墨色第二階（＝結果頁標籤色） */
    labels.forEach((x, i) => {
      const a = L.labels + i * 40, lit = L.axis0 + i * L.step + L.tick;
      tl(c, x, [[a, { opacity: 0, fill: '#545452' }, EASE_OUT], [a + 200, { opacity: 1, fill: '#545452' }], [lit, { opacity: 1, fill: '#545452' }, EASE_OUT], [lit + 120, { opacity: 1, fill: '#6F5426' }], [L.lock, { opacity: 1, fill: '#6F5426' }, EASE_OUT], [L.lock + 240, { opacity: 1, fill: '#3A3A38' }]]);
    });
    /* 第 i 軸：金線由圓心長到分數；+100–300 與前一軸連線；+120–280 珍珠落定；交棒時珍珠換成墨點、連線轉墨 */
    spokes.forEach((sp, i) => {
      const a = L.axis0 + i * L.step;
      tl(c, sp, [[a, { strokeDashoffset: 1, opacity: 0.9 }, EASE_OUT], [a + L.grow, { strokeDashoffset: 0, opacity: 0.9 }], [L.lock, { strokeDashoffset: 0, opacity: 0.9 }, EASE_OUT], [L.lock + 300, { strokeDashoffset: 0, opacity: 0.35 }], [M, { strokeDashoffset: 0, opacity: 0.35 }, EASE_IN], [M + 140, { strokeDashoffset: 0, opacity: 0 }]]);
      tl(c, tips[i], [[a + 120, { opacity: 0, transform: 'scale(0.4)' }, EASE_OUT], [a + 280, { opacity: 1, transform: 'scale(1)' }], [M, { opacity: 1, transform: 'scale(1)' }, EASE_OUT], [M + 240, { opacity: 0, transform: 'scale(0.89)' }]]);
      tl(c, dots[i], [[M, { opacity: 0 }, EASE_OUT], [M + 240, { opacity: 1 }]]);
      const e0 = i ? a + 100 : L.axis0 + (n - 1) * L.step + 100;   /* 第 1 條連線（第 7 軸→第 1 軸）在最後一軸時畫回，雷達閉合 */
      tl(c, edges[i], [[e0, { strokeDashoffset: 1, stroke: '#E2CB9A' }, EASE_OUT], [e0 + 200, { strokeDashoffset: 0, stroke: '#E2CB9A' }], [M, { strokeDashoffset: 0, stroke: '#E2CB9A' }, EASE_OUT], [M + 240, { strokeDashoffset: 0, stroke: '#14151B' }]]);
    });
    tl(c, el.querySelector('.qrv-glow'), [[M, { filter: 'drop-shadow(0 0 3px rgba(226,203,154,.75))' }, EASE_OUT], [M + 200, { filter: 'drop-shadow(0 0 0px rgba(226,203,154,0))' }]]);
    /* 2300 落定 */
    tl(c, el.querySelector('.qrv-fill'), [[L.lock, { opacity: 0, fill: 'rgba(226,203,154,.2)' }, EASE_OUT], [L.lock + 300, { opacity: 1, fill: 'rgba(226,203,154,.2)' }], [M, { opacity: 1, fill: 'rgba(226,203,154,.2)' }, EASE_OUT], [M + 240, { opacity: 1, fill: 'rgba(20,21,27,.09)' }]]);
    /* 香檳金圈：隨錶面浮起成為錶緣，落定時外擴成衝擊環 */
    tl(c, el.querySelector('.qrv-shock'), [[L.dial, { opacity: 0, transform: 'scale(1)' }, EASE_OUT], [L.dial + L.dialIn, { opacity: 0.9, transform: 'scale(1)' }], [L.lock, { opacity: 0.9, transform: 'scale(1)' }, EASE_OUT], [L.lock + 340, { opacity: 0, transform: 'scale(1.45)' }]]);
    tl(c, el.querySelector('.qrv-sheen'), [[L.lock, { transform: 'translateX(-140%) skewX(-18deg)' }, 'cubic-bezier(.3,0,.2,1)'], [L.lock + 380, { transform: 'translateX(330%) skewX(-18deg)' }]]);
    /* 2380 起階段名逐字浮現（每字錯開 50ms，同 .r-big） */
    $$('.qrv-word span', el).forEach((x, i) => riseIn(c, x, L.word + i * 50, 300, 14));
    /* 交棒（FLIP）：揭曉層的雷達／階段名平移到結果頁的雷達／.r-big；幾何與 chartSvg 相同，通常只有平移（矮螢幕外層縮放時才補縮放） */
    const measure = () => {
      const a = st.getBoundingClientRect(), b = chart.getBoundingClientRect(), wa = word.getBoundingClientRect(), wb = big.getBoundingClientRect();
      const ps = a.width / (st.offsetWidth || 1) || 1;
      return { dx: (b.left + b.width / 2 - (a.left + a.width / 2)) / ps, dy: (b.top + b.height / 2 - (a.top + a.height / 2)) / ps, k: b.width / (a.width || 1),
        wdx: (wb.left + wb.width / 2 - (wa.left + wa.width / 2)) / ps, wdy: (wb.top + wb.height / 2 - (wa.top + wa.height / 2)) / ps, wk: wb.height / (wa.height || 1) };
    };
    const stSteps = (g) => [[L.lock - 40, { transform: 'translate(0px,0px) scale(1)' }, EASE_IN], [L.lock, { transform: 'translate(0px,0px) scale(1.03)' }, 'cubic-bezier(0.2,0,0,1)'], [L.lock + 220, { transform: 'translate(0px,0px) scale(1)' }], [M, { transform: 'translate(0px,0px) scale(1)' }, EASE_MOVE], [ME, { transform: `translate(${f1(g.dx)}px,${f1(g.dy)}px) scale(${g.k.toFixed(4)})` }]];
    const wSteps = (g) => [[M, { transform: 'translate(0px,0px) scale(1)' }, EASE_MOVE], [ME, { transform: `translate(${f1(g.wdx)}px,${f1(g.wdy)}px) scale(${g.wk.toFixed(4)})` }]];
    let g = measure();
    const stA = tl(c, st, stSteps(g)), wA = tl(c, word, wSteps(g));
    c.flip = g;
    /* 交棒前再量一次（字型載入、視窗大小改變都以當下為準） */
    later(c, M - 30, () => { g = measure(); c.flip = g; try { stA.effect.setKeyframes(frames(stSteps(g))); wA.effect.setKeyframes(frames(wSteps(g))); } catch (e) { /* 舊瀏覽器 */ } });
    fadeOut(c, el.querySelector('.qrv-line'), M, M + 140);
    /* 3000：揭曉層的雷達與階段名換成結果頁上真正的元素（同幾何，畫面不跳） */
    [chart, big].forEach((x) => tl(c, x, [[L.done - 1, { opacity: 0 }], [L.done, { opacity: 1 }]]));
    [st, word].forEach((x) => tl(c, x, [[L.done - 1, { opacity: 1 }], [L.done, { opacity: 0 }]]));
    tl(c, res.querySelector('.r-kind'), [[L.kindIn, { opacity: 0 }, EASE_OUT], [L.done, { opacity: 1 }]]);
    riseIn(c, res.querySelector('.r-lead'), L.rest, 260);
    riseIn(c, res.querySelector('.r-rest'), L.rest + 30, 260);
    later(c, L.done, () => rvEnd(c));
  }

  function rvCareer(c, r, el, res, bg) {
    const C = RV_TL_C;
    const well = el.querySelector('.qrv-well'), dial = el.querySelector('.qrv-dial'), marks = $$('.qrv-mark', el);
    const pi = ROLES.indexOf(r.primary), si = ROLES.indexOf(r.secondary);
    tl(c, bg, [[C.bg, { opacity: 0 }, EASE_OUT], [C.bg + 180, { opacity: 1 }], [C.out, { opacity: 1 }, EASE_IN], [C.out + C.outDur + 40, { opacity: 0 }]]);
    tl(c, well, [[C.dial, { opacity: 0, transform: 'scale(0.92)' }, EASE_OUT], [C.dial + 300, { opacity: 1, transform: 'scale(1)' }]]);
    tl(c, dial, [[C.dial + 40, { opacity: 0 }, EASE_OUT], [C.dial + 300, { opacity: 1 }]]);
    tl(c, el.querySelector('.qrv-emblem'), [[260, { opacity: 0 }, EASE_OUT], [500, { opacity: 0.3 }], [C.converge + 100, { opacity: 0.3 }, EASE_IN], [C.seal, { opacity: 0 }]]);
    tl(c, el.querySelector('.qrv-index'), [[C.index, { opacity: 0, transform: 'translateY(-4px)' }, EASE_OUT], [C.index + 200, { opacity: 1, transform: 'translateY(0px)' }]]);
    /* 2230–2410 金印落下（ease-in，越蓋越快）、2410–2490 回彈 */
    tl(c, el.querySelector('.qrv-seal'), [[C.seal, { opacity: 0, transform: 'rotate(-14deg) scale(1.45)', filter: 'blur(6px)' }, EASE_IN], [C.lock, { opacity: 1, transform: 'rotate(-14deg) scale(0.97)', filter: 'blur(0px)' }, EASE_OUT], [C.lock + 80, { opacity: 1, transform: 'rotate(-14deg) scale(1)', filter: 'blur(0px)' }]]);
    tl(c, el.querySelector('.qrv-shock'), [[C.dial + 40, { opacity: 0, transform: 'scale(1)' }, EASE_OUT], [C.dial + 300, { opacity: 0.9, transform: 'scale(1)' }], [C.lock, { opacity: 0.9, transform: 'scale(1)' }, EASE_OUT], [C.lock + 340, { opacity: 0, transform: 'scale(1.45)' }]]);
    tl(c, el.querySelector('.qrv-sheen'), [[C.lock, { transform: 'translateX(-140%) skewX(-18deg)' }, 'cubic-bezier(.3,0,.2,1)'], [C.lock + 380, { transform: 'translateX(330%) skewX(-18deg)' }]]);
    /* 2710–2850 整組縮至 0.88 淡出（用 scale 屬性，與矮螢幕的 0.86 外層縮放相乘） */
    tl(c, el.querySelector('.qrv-stack'), [[C.out, { opacity: 1, scale: '1' }, EASE_IN], [C.out + C.outDur, { opacity: 0, scale: '0.88' }]]);
    /* 結果頁由下分段浮上（錯開 30ms） */
    $$('.r-kind, .chart-wrap, .r-big, .r-sub, .r-lead, .r-rest', res).forEach((x, i) => riseIn(c, x, C.rest + i * 30, 240, 24));
    /* 印記：起始排列讓主角色在轉滿 540° 時正好停在 12 點（tick 數與總長固定），副角色不在旁邊時沿凹槽滑到 2 點鐘 */
    const off = (j) => (j - pi) * 60 + 180;
    const d2 = (((si - pi) * 60) % 360 + 360) % 360;
    const slide = d2 === 60 || d2 === 300 ? 0 : 60 - d2;
    const eo3 = (u) => 1 - (1 - u) ** 3, ei3 = (u) => u ** 3;
    const pose = c.pose = (t) => {
      const th = spinAt(t);
      marks.forEach((m, j) => {
        const ea = eo3(clamp01((t - (C.marks + j * 40)) / 200));
        let ang = off(j) + th, rr = 131, op = ea, sc = 0.6 + 0.4 * ea, lit = 0;
        const nrm = ((ang % 360) + 360) % 360, dist = Math.min(nrm, 360 - nrm);
        if (t < C.converge) lit = Math.max(0, 1 - dist / 16);
        if (j === pi) {
          if (t >= C.spin + C.spinDur - 60) lit = 1;
          const u = ei3(clamp01((t - (C.converge + 100)) / 250));
          rr = 131 * (1 - u); sc = 1 + 0.5 * u; op = 1 - clamp01((t - (C.seal + 80)) / 100);
        } else if (j === si) {
          const u = eo3(clamp01((t - C.converge) / 250));
          ang += slide * u; op = ea * (1 - 0.58 * u); sc = 1 - 0.1 * u;
        } else {
          const u = ei3(clamp01((t - C.converge) / 260));
          rr = 131 - 91 * u; op = ea * (1 - u); sc = (0.6 + 0.4 * ea) * (1 - 0.4 * u);
        }
        const rad = (ang * Math.PI) / 180;
        m.style.transform = `translate(${(rr * Math.sin(rad)).toFixed(2)}px,${(-rr * Math.cos(rad)).toFixed(2)}px) scale(${sc.toFixed(3)})`;
        m.style.opacity = op.toFixed(3);
        m.style.setProperty('--lit', lit.toFixed(3));
      });
    };
    el._pose = pose;
    pose(0);
    const loop = () => { if (rv !== c || c.skipped) return; const e = performance.now() - c.t0; pose(e); if (e < C.out + C.outDur) c.raf = requestAnimationFrame(loop); };
    c.raf = requestAnimationFrame(loop);
    later(c, C.done, () => rvEnd(c));
  }

  /** 結果頁上的揭曉動畫跑完後拆掉（回到自然樣式，不留 fill） */
  function rvRelease(c) {
    c.anims.forEach((a) => { const t = a.effect && a.effect.target; if (t && c.res && c.res.contains(t)) a.finished.then(() => a.cancel(), () => {}); });
  }
  /** 揭曉結束：移除揭曉層、恢復可操作、焦點到 .r-big、繪製結果卡 */
  function rvEnd(c) {
    if (rv !== c) return;
    rv = null;
    c.timers.forEach(clearTimeout); cancelAnimationFrame(c.raf);
    c.el.remove();
    if (c.old) c.old.remove();
    rvRelease(c);
    setInert(shell, false);
    const h = c.res.querySelector('.r-big');
    if (h) h.focus({ preventScroll: true });
    if (c.paint) c.paint(c.res);
  }
  /** 略過：揭曉子音軌淡出、揭曉層 150ms 淡出，結果頁以快速版本出現（說明與分項卡 200ms 淡入） */
  function rvSkip() {
    const c = rv;
    if (!c || c.skipped) return;
    const e = performance.now() - c.t0;
    if (e < RV_GUARD) return;                             /* 作答那一下的連點不算略過 */
    c.skipped = true;
    c.timers.forEach(clearTimeout); c.timers = [];
    cancelAnimationFrame(c.raf);
    hushRv();
    track('quiz.reveal_skip', 'view', { kind: c.kind });
    c.el.style.pointerEvents = 'none';
    c.el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: RV_SKIP_OUT, easing: EASE_IN, fill: 'forwards' });
    if (c.old) c.old.remove();
    c.anims.forEach((a) => { const t = a.effect && a.effect.target; if (t && c.res.contains(t)) a.cancel(); });
    c.anims = c.anims.filter((a) => { const t = a.effect && a.effect.target; return !(t && c.res.contains(t)); });
    $$('.r-sub, .r-lead, .r-rest', c.res).forEach((x) => c.anims.push(x.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out', fill: 'backwards' })));
    later(c, e + RV_SKIP_OUT, () => rvEnd(c));
  }
  /** 關閉測驗或重畫準備頁：直接拆掉揭曉層（不留聲音） */
  function rvCancel() {
    const c = rv;
    if (!c) return;
    rv = null;
    c.timers.forEach(clearTimeout); cancelAnimationFrame(c.raf);
    hushRv();
    c.el.remove();
    if (c.old) c.old.remove();
    c.anims.forEach((a) => { try { a.cancel(); } catch (e) { /* 已結束 */ } });
    setInert(shell, false);
  }

  function answer(k) {
    const s = S();
    if (!s || idx < 0) return;
    s.answers[idx] = k;
    const el = stage.querySelector('.qpage:not(.out)');
    $$('.opt', el).forEach((b, j) => {
      const on = j === k;
      b.classList.toggle('obs', on);
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    const nx = el.querySelector('[data-act="next"]'); if (nx) nx.disabled = false;
    sfx('pick');
    const n = QUIZ[kind].qs.length;
    track('quiz.answer', 'answer', { kind, q: idx + 1, n, k: k + 1, done: s.answers.filter((a) => a != null).length });
    clearTimeout(advT);
    const at = idx;
    /* 讓「選中填滿」被看見後再翻頁（分鏡：選定 300ms 後自動翻頁） */
    advT = setTimeout(() => { if (idx === at) next(); }, motionOK() ? 300 : 200);
  }
  function next() {
    const s = S(); if (!s || idx < 0) return;
    if (s.answers[idx] == null) return;
    if (idx >= QUIZ[kind].qs.length - 1) { if (s.answers.every((a) => a != null)) finish(); else showQ(s.answers.findIndex((a) => a == null)); return; }
    showQ(idx + 1, 1);
  }
  function prev() { clearTimeout(advT); if (idx > 0) showQ(idx - 1, -1); }

  /** 開啟測驗：一律先到開始前準備頁（direct＝登入完成或已登入撕票，記錄用）；有未完成作答時按鈕為「繼續」 */
  function open(k, from, { direct = false } = {}) {
    cdCancel(); rvCancel();
    kind = k; opener = from || document.activeElement;
    title.textContent = QUIZ[k].title;
    box.classList.remove('done');
    box.dataset.kind = k;
    stage.innerHTML = '';
    box.hidden = false;
    document.documentElement.classList.add('quiz-open');
    setInert(page, true);
    requestAnimationFrame(() => box.classList.add('on'));
    const resume = !!(S() && S().answers.some((a) => a != null));
    track('quiz.open', 'view', { kind, direct, resume });
    showReady(1, direct ? 'direct' : 'open');
  }
  /** 準備頁「換另一個測驗」：同一個覆蓋層換成另一種測驗的準備頁 */
  function switchKind() {
    const k = kind === 'ability' ? 'career' : 'ability';
    kind = k;
    title.textContent = QUIZ[k].title;
    box.dataset.kind = k;
    track('quiz.open', 'view', { kind, direct: false, resume: !!(S() && S().answers.some((a) => a != null)), via: 'switch' });
    showReady(1, 'switch');
  }
  function close() {
    if (box.hidden) return;
    cdCancel(); rvCancel();
    clearTimeout(advT);
    const s = S(), n = kind ? QUIZ[kind].qs.length : 0;
    track('quiz.close', 'close', { kind, at: idx < 0 ? 0 : Math.min(idx + 1, n), n, answered: s ? s.answers.filter((a) => a != null).length : (box.classList.contains('done') ? n : 0) });
    box.classList.remove('on');
    document.documentElement.classList.remove('quiz-open');
    setInert(page, false);
    setTimeout(() => { if (!box.classList.contains('on')) { box.hidden = true; stage.innerHTML = ''; } }, motionOK() ? 160 : 0);
    if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
  }

  function save(btn) {
    const el = stage.querySelector('.qpage:not(.out)'), cv = el && el._canvas, live = $('#qz-save-live', el);
    if (!cv) return;
    const name = `GRACE-${kind === 'ability' ? '能力健檢' : '職涯定位'}.png`;
    const done = (msg) => { if (live) live.textContent = msg; };
    try {
      cv.toBlob((blob) => {
        if (!blob) { done('無法產生圖片，請長按結果卡儲存'); return; }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = name; a.rel = 'noopener';
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        done('已存成圖片');
        btn.classList.add('saved');
      }, 'image/png');
    } catch (e) { done('無法產生圖片，請長按結果卡儲存'); }
  }

  /* ---------- 事件 ---------- */
  stage.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.closest('.out')) return;
    if (b.classList.contains('opt')) return answer(Number(b.dataset.k));
    if (b.getAttribute('role') === 'tab') return selectTab(b);
    const act = b.dataset.act;
    if (act === 'start') return begin(b);
    if (act === 'other') return switchKind();
    if (act === 'prev') { track('quiz.prev', 'click', { kind, q: idx + 1 }); return prev(); }
    if (act === 'next') { track('quiz.next', 'click', { kind, q: idx + 1 }); return next(); }
    if (act === 'again') { state[kind] = null; box.classList.remove('done'); return showReady(1, 'again'); }
    if (act === 'save') return save(b);
    if (act === 'enroll') { close(); if (onEnroll) setTimeout(onEnroll, 60); }
    if (act === 'switch') { const k = kind; close(); if (onSwitch) setTimeout(() => onSwitch(k), 60); }
  });

  function selectTab(t) {
    const list = t.closest('[role="tablist"]'), tabs = $$('[role="tab"]', list);
    tabs.forEach((x, i) => {
      const on = x === t;
      x.setAttribute('aria-selected', String(on)); x.tabIndex = on ? 0 : -1;
      document.getElementById(x.getAttribute('aria-controls')).hidden = !on;
      if (on) list.classList.toggle('is-left', i === 0);
    });
  }

  box.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (cd || rv) { if (e.key === 'Tab') { e.preventDefault(); const h = (cd || rv).hit; if (h) h.focus(); } return; }   /* 倒數／揭曉中焦點留在該層 */
    if (e.key === 'Tab') {                            /* 焦點留在覆蓋層內 */
      const f = $$('button:not([disabled]),a[href],[tabindex="0"],[tabindex="-1"].r-big', box).filter((x) => x.offsetParent !== null && !x.closest('.out') && !x.closest('[hidden]') && x.tabIndex >= 0);
      if (!f.length) return;
      const a = f[0], z = f[f.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
      return;
    }
    const t = e.target;
    if (t.getAttribute && t.getAttribute('role') === 'tab' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      const tabs = $$('[role="tab"]', t.closest('[role="tablist"]'));
      const n = tabs[(tabs.indexOf(t) + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      n.focus(); selectTab(n); return;
    }
    if (idx < 0 || !kind || idx >= QUIZ[kind].qs.length) return;
    const opts = $$('.qpage:not(.out) .opt', stage);
    if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
    else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && opts.length) {
      e.preventDefault();
      const at = opts.indexOf(document.activeElement);
      const n = opts[((at < 0 ? 0 : at) + (e.key === 'ArrowDown' ? 1 : opts.length - 1)) % opts.length];
      opts.forEach((o) => { o.tabIndex = o === n ? 0 : -1; }); n.focus();
    } else if (/^[1-4]$/.test(e.key) && opts[Number(e.key) - 1]) { e.preventDefault(); answer(Number(e.key) - 1); }
  });
  closeBtn.addEventListener('click', close);

  $$('[data-quiz]').forEach((b) => b.addEventListener('click', () => open(b.dataset.quiz, b)));
  paintLast();
  return { open, close, answer, next, prev, skip: cdSkip, skipReveal: rvSkip, state: () => ({ kind, idx, cd: !!cd, rv: !!rv }) };
}
