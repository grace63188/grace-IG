/* 自我測驗：能力健檢／職涯定位
   - 全螢幕覆蓋層（role=dialog），一題一頁、進度、上一題、可中途關閉（保留作答，下次開啟接續）
   - 鍵盤：←／→ 上一題／下一題；↑／↓ 在選項間移動；1–4 直接作答；Esc 關閉
   - 結果：雷達圖／六角形生長、名稱逐字浮現；結果卡以 canvas 繪製（IG 限動 9:16）
   - 結果存 localStorage（try/catch），票券入口顯示上次結果
   - 入口：撕票 →（未登入先在儀式卡登入，gate.js）→ 開始前準備頁（入場券＋作答提醒＋「開始」）→ 3-2-1 倒數 → 第一題（未完成者接續，按鈕為「繼續」）
   - 倒數：開始鈕化成錶面、金弧掃描、收束鐘聲，總長 3160ms；點畫面／Enter／空白鍵略過，Esc 關閉；減少動態改為「準備好了」0.6s 淡入淡出
     畫面（Web Animations＋rAF）與聲音（sound.js cd*）都以按下那一刻為基準一次排程，聲音取同一個音訊時鐘讀數，不逐一漂移
   - 結果頁：LINE 登入者在頁尾附「加入 @52grace」次鍵
   - 音效：選答案＝珍珠落座、翻題＝紙頁翻動、揭曉＝香檳鐘聲；事件：每題作答進度、完成與結果 */
import { $, $$, reduced, setInert, esc } from './core.js?v=20261024b';
import { sfx, clock, hushCd } from './sound.js?v=20261024b';
import { track } from './track.js?v=20261024b';
import { submitResult, onResults, session } from './auth.js?v=20261024b';
import {
  ABILITIES, ABILITY_QUESTIONS, ABILITY_TEXT, scoreAbility,
  ROLES, ROLE_CODE, ROLE_TEXT, CAREER_QUESTIONS, scoreCareer,
} from './quizdata.js?v=20261024b';

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
const EASE_OUT = 'cubic-bezier(0.23,1,0.32,1)', EASE_IN = 'cubic-bezier(0.55,0,1,0.45)';

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
  let kind = null, idx = -1, opener = null, advT = 0, cd = null;
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
    cdCancel();
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
    /* 契約 quiz.result：登入中送出；資料中心會自動補 quiz_done 事件 */
    submitResult(kind === 'ability'
      ? { kind, at: saved.at, answers: s.answers.slice(), total: r.total, stage: r.stage.name, top: r.allSame ? '' : r.top, low: r.allSame ? '' : r.low, scores: r.scores }
      : { kind, at: saved.at, answers: s.answers.slice(), primary: r.primary, secondary: r.secondary, counts: r.counts });
    state[kind] = null;                                   /* 完成後清掉作答，下次從頭開始 */
    idx = QUIZ[kind].qs.length; setProgress(idx);
    box.classList.add('done');
    sfx('reveal', { delay: motionOK() ? 0.12 : 0 });
    const el = turn(resultHtml(r), 1);
    el.querySelector('.result').classList.add('grow');
    requestAnimationFrame(() => requestAnimationFrame(() => el.querySelector('.result').classList.add('go')));
    const h = el.querySelector('.r-big'); h.tabIndex = -1;
    setTimeout(() => h.focus({ preventScroll: true }), 40);
    /* 結果卡：等字型就緒再繪製 */
    const img = el.querySelector('#qz-card-img');
    const paint = () => {
      try {
        const cv = document.createElement('canvas');
        drawCard(cv, kind === 'ability' ? 'ability' : 'career', r);
        img.src = cv.toDataURL('image/png');
        img.alt = kind === 'ability' ? `能力健檢結果卡：${r.stage.name}` : `職涯定位結果卡：主角色${r.primary}，副角色${r.secondary}`;
        img.dataset.kind = kind;
        el._canvas = cv;
      } catch (e) { img.closest('.rcard').hidden = true; }
    };
    const fr = document.fonts && document.fonts.ready;
    if (fr && typeof fr.then === 'function') fr.then(paint, paint); else paint();
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
    cdCancel();
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
    cdCancel();
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
    if (cd) { if (e.key === 'Tab') { e.preventDefault(); if (cd.hit) cd.hit.focus(); } return; }   /* 倒數中焦點留在倒數層 */
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
  return { open, close, answer, next, prev, skip: cdSkip, state: () => ({ kind, idx, cd: !!cd }) };
}
