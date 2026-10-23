/* 自我測驗：能力健檢／職涯定位
   - 全螢幕覆蓋層（role=dialog），一題一頁、進度、上一題、可中途關閉（保留作答，下次開啟接續）
   - 鍵盤：←／→ 上一題／下一題；↑／↓ 在選項間移動；1–4 直接作答；Esc 關閉
   - 結果：雷達圖／六角形生長、名稱逐字浮現；結果卡以 canvas 繪製（IG 限動 9:16）
   - 結果存 localStorage（try/catch），票券入口顯示上次結果
   - 入口：撕票 →（未登入先在儀式卡登入，gate.js）→ 直接進第一題（未完成者接續）；第一題上方顯示一行作答提醒，不需點按
   - 結果頁：LINE 登入者在頁尾附「加入 @52grace」次鍵
   - 音效：選答案＝珍珠落座、翻題＝紙頁翻動、揭曉＝香檳鐘聲；事件：每題作答進度、完成與結果 */
import { $, $$, reduced, setInert, esc } from './core.js?v=20261023g';
import { sfx } from './sound.js?v=20261023g';
import { track } from './track.js?v=20261023g';
import { submitResult, onResults, session } from './auth.js?v=20261023g';
import {
  ABILITIES, ABILITY_QUESTIONS, ABILITY_TEXT, scoreAbility,
  ROLES, ROLE_CODE, ROLE_TEXT, CAREER_QUESTIONS, scoreCareer,
} from './quizdata.js?v=20261023g';

export const STORE_KEY = 'grace.quiz.v1';
const SIGNIN = 'https://www.graceschool.com.tw/member/signin';
const NOTE = '本結果為自我探索參考，非正式心理測驗。';
export const OA_URL = 'https://line.me/R/ti/p/@52grace';
export const RITE_LINE = '接下來所有作答都沒有標準答案，請誠實作答！';

const QUIZ = {
  ability: { title: '能力健檢', meta: '14 題・約 3 分鐘', qs: ABILITY_QUESTIONS,
    lead: '七項經營能力的現況：從日常情境裡，選出最接近妳平常反應的一項。' },
  career: { title: '職涯定位', meta: '12 題・約 2 分鐘', qs: CAREER_QUESTIONS,
    lead: '六種角色裡，妳最自然的位置：每題二選一，憑第一直覺作答。' },
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
  let kind = null, idx = -1, opener = null, advT = 0, riteOnce = false;

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

  function introHtml() {
    const q = QUIZ[kind], s = S();
    const resume = s && s.answers.some((a) => a != null);
    return `<div class="q-intro">
      <h3 class="q-name">${esc(q.title)}</h3>
      <p class="q-meta">${esc(q.meta)}</p>
      <p class="q-lead">${esc(q.lead)}</p>
      <button class="start obs" type="button" data-act="start" data-ev="quiz.start" data-ev-meta='{"kind":"${kind}"}'><span>${resume ? '繼續' : '開始'}</span></button>
      <p class="q-hint">${resume ? `已作答 ${s.answers.filter((a) => a != null).length} 題，從上次停下的地方繼續` : '沒有標準答案，選最接近妳平常狀態的那一個'}</p>
    </div>`;
  }

  function questionHtml(i) {
    const q = QUIZ[kind].qs[i], s = S(), a = s.answers[i], n = QUIZ[kind].qs.length;
    const opts = q.opts.map((o, k) => `<button class="opt${a === k ? ' obs' : ''}" type="button" role="radio" aria-checked="${a === k}" tabindex="${(a == null ? k === 0 : a === k) ? 0 : -1}" data-k="${k}"><i class="pearl" aria-hidden="true"></i><span>${esc(o.t)}</span></button>`).join('');
    const rite = riteOnce && i === 0 ? `<p class="q-rite" role="note">${esc(RITE_LINE)}</p>` : '';
    riteOnce = false;
    return `<div class="q-ask">${rite}
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
        <p>想讓校長依照測驗結果安排個人進修課表，第一步是先成為 G.R.A.C.E 學姊。完成註冊、真人驗證，首次儲值 10萬開通打底層後，就可以提出申請。</p>
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

  /* 登入者：「不是你？切換帳號」（安靜的文字連結，結果動作之下）→ 登出本站並回到這個測驗的登入卡 */
  function switchHtml() {
    const ss = session();
    if (!ss) return '';
    return `<p class="r-switch"><button class="txt-link" type="button" data-act="switch" data-ev="who.switch">不是你？切換帳號</button></p>`;
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
        <div class="r-foot"><button class="cta cta-sub gl gl-clear" type="button" data-act="again" data-ev="quiz.again"><span>重新測驗</span><span class="go"><svg class="i" aria-hidden="true" focusable="false"><use href="#i-redo"/></svg></span></button>${addHtml()}${switchHtml()}
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
      <div class="r-foot"><button class="cta cta-sub gl gl-clear" type="button" data-act="again" data-ev="quiz.again"><span>重新測驗</span><span class="go"><svg class="i" aria-hidden="true" focusable="false"><use href="#i-redo"/></svg></span></button>${addHtml()}${switchHtml()}
      <p class="r-note">${NOTE}</p></div>
      </div>
    </div>`;
  }

  /* ---------- 流程 ---------- */
  function showIntro(dir = 1) {
    idx = -1; setProgress(-1);
    turn(introHtml(), dir, (el) => setTimeout(() => el.querySelector('.start').focus({ preventScroll: true }), 30));
  }
  function showQ(i, dir = 1) {
    clearTimeout(advT);
    if (stage.querySelector('.qpage:not(.out) .q-ask')) sfx('flip');
    idx = i; setProgress(i);
    turn(questionHtml(i), dir, (el) => {
      const t = el.querySelector('.opt[tabindex="0"]');
      setTimeout(() => t && t.focus({ preventScroll: true }), 30);
    });
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
  function prev() { clearTimeout(advT); if (idx > 0) showQ(idx - 1, -1); else if (idx === 0) showIntro(-1); }

  /** direct：撕票（登入後）直接進入，略過開始頁、直接到第一題（有未完成作答則接續）；從第一題開始時上方顯示作答提醒 */
  function open(k, from, { direct = false } = {}) {
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
    if (!direct) { showIntro(1); return; }
    if (!S()) state[kind] = { answers: new Array(QUIZ[kind].qs.length).fill(null) };
    const first = S().answers.findIndex((a) => a == null);
    riteOnce = first <= 0;
    showQ(first < 0 ? 0 : first, 1);
  }
  function close() {
    if (box.hidden) return;
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
    if (act === 'start') {
      if (!S()) state[kind] = { answers: new Array(QUIZ[kind].qs.length).fill(null) };
      const s = S(); const first = s.answers.findIndex((a) => a == null);
      return showQ(first < 0 ? 0 : first, 1);
    }
    if (act === 'prev') { track('quiz.prev', 'click', { kind, q: idx + 1 }); return prev(); }
    if (act === 'next') { track('quiz.next', 'click', { kind, q: idx + 1 }); return next(); }
    if (act === 'again') { state[kind] = null; box.classList.remove('done'); return showIntro(1); }
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
  return { open, close, answer, next, prev, state: () => ({ kind, idx }) };
}
