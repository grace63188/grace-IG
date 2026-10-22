/* 測驗前關卡：撕票後滑出的儀式卡（登入）、頂部頭像 chip、靜音鈕
   - 未登入：儀式卡顯示 LINE（主）／Google（次）、App 內建瀏覽器提示（IG、Threads、Facebook、LINE 等）、登入告知（取得名稱、大頭貼、電子郵件與用途）＋隱私權政策連結
   - 登入成功（Google 當下、LINE 授權返回）：收起儀式卡，直接進第一題，不再多一個「開始作答」畫面
   - 已登入回訪：撕票後直接進第一題
   - 「加入 @52grace」移到測驗結果頁（LINE 登入者，見 quiz.js）；切換帳號在頂部頭像 chip 選單 */
import { $, $$, esc, reduced } from './core.js';
import { session, login, logout, onAuth, initial, isInApp, inAppName, openInBrowser, copyUrl } from './auth.js';
import { sfx, isMuted, setMuted, onMute } from './sound.js';
import { track } from './track.js';
import { OA_URL } from './quiz.js';

export const RITE_MAIN = '接下來所有作答都沒有標準答案，請誠實作答！';
export const RITE_SUB = '選最接近平常的那一項就好';
export const NOTICE = '登入時會取得你的 LINE／Google 名稱、大頭貼與電子郵件，只用於對應學院學員帳號與提供學習資源，不會公開或轉給第三方。';
export const PRIVACY_URL = 'privacy.html';
export { OA_URL };
const KINDS = { ability: { title: '能力健檢', n: 14, min: 3 }, career: { title: '職涯定位', n: 12, min: 2 } };
const PROV = { line: 'LINE', google: 'Google' };
const ERR = {
  denied: '已取消登入，可再試一次',
  provider_off: '此登入方式暫未開放，請改用另一種',
  state: '登入要在同一個瀏覽器完成，請在這裡再按一次 LINE 登入',
  RATE_LIMIT: '嘗試次數較多，請稍候一分鐘再試',
  NETWORK: '網路連線不穩，請再試一次',
};
/** App 內建瀏覽器（IG、Threads、Facebook、LINE、App）無法使用 Google 登入的說明 */
export const webviewText = (n) => `${n || 'App'} 內建瀏覽器無法使用 Google 登入`;
export const errText = (code) => (code === 'webview' ? webviewText(inAppName()) + '，請先在瀏覽器開啟' : ERR[code] || '登入未完成，請再試一次');

const ic = (id) => `<svg class="i" aria-hidden="true" focusable="false"><use href="#${id}"/></svg>`;
const G_LOGO = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3z"/><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z"/><path fill="#FBBC05" d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1a10 10 0 0 0 0 9.2z"/><path fill="#EA4335" d="M12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.4L6.4 10C7.2 7.7 9.4 6 12 6z"/></svg>';
const LINE_LOGO = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#i-linef"/></svg>';

export function initGate({ openSheet, closeSheet, startQuiz }) {
  const sheet = $('#s-rite'), body = $('#rite-body');
  let kind = 'ability', busy = false;

  /* ---------- 儀式卡 ---------- */
  const pLink = () => `<a class="priv-a" href="${PRIVACY_URL}" target="_blank" rel="noopener" data-ev="rite.privacy">隱私權政策</a>`;
  const notice = () => `<p class="priv priv-note" id="auth-notice">${ic('i-lock')}<span>${NOTICE}${pLink()}</span></p>`;
  const head = () => `<h2 class="rite-h" id="rite-h">${RITE_MAIN.replace('，', '，<wbr>')}</h2>
      <p class="rite-p">${RITE_SUB}</p>`;

  function authHtml(msg = '') {
    const inapp = isInApp();
    return `<div class="auth" id="auth">
        <button class="cta cta-main gl gl-ink cta-line" type="button" data-provider="line"><span class="lbl-l"><span class="lead-ic">${LINE_LOGO}</span><span class="lbl">LINE 登入</span></span><span class="go">${ic('i-arrow')}</span></button>
        <button class="cta cta-sub gl gl-clear cta-g" type="button" data-provider="google"${inapp ? ' aria-disabled="true" aria-describedby="inapp-note"' : ''}><span class="lbl-l"><span class="lead-ic">${G_LOGO}</span><span class="lbl">Google 登入</span></span><span class="go">${ic('i-arrow')}</span></button>
        ${inapp ? `<div class="inapp"><small id="inapp-note">${webviewText(inAppName())}</small><button class="pill-s" type="button" data-act="ext">${ic('i-ext')}<span>在瀏覽器開啟</span></button></div>
        <p class="inapp-tip" id="inapp-tip" role="status" aria-live="polite" hidden></p>` : ''}
        <div class="gsi-slot" id="gsi-slot" hidden><p class="gsi-hint">請點下方 Google 按鈕完成登入</p><div class="gsi-btn" id="gsi-btn"></div></div>
        <p class="auth-msg" id="auth-msg" role="status" aria-live="polite"${msg ? '' : ' hidden'}>${esc(msg)}</p>
      </div>`;
  }
  let webviewSent = false;
  function render(msg) {
    const k = KINDS[kind];
    $('#rite-kind').textContent = k.title;
    $('#rite-meta').innerHTML = `<span class="en">${k.n}</span> 題・約 <span class="en">${k.min}</span> 分鐘`;
    sheet.dataset.state = 'login';
    body.innerHTML = `${head()}<i class="perf-line" aria-hidden="true"></i><div class="rite-slot" id="rite-slot">${authHtml(msg)}${notice()}</div>`;
    /* 契約：IG 內建瀏覽器偵測到時送一筆 login_fail（google／webview），每次載入一筆 */
    if (isInApp() && !webviewSent) { webviewSent = true; track('auth.google.blocked', 'view', { kind }); }
  }

  /** 已登入（含剛登入、LINE 返回）：收起儀式卡，直接進第一題 */
  function go(k, { fresh = false } = {}) {
    kind = KINDS[k] ? k : kind;
    busy = false;
    track('rite.start', 'click', { kind, auto: true, fresh });
    closeSheet(true);
    startQuiz(kind);
  }

  /** 撕票後呼叫：已登入直接進第一題；未登入換成儀式卡（登入） */
  function open(k, { msg } = {}) {
    kind = KINDS[k] ? k : 'ability';
    busy = false;
    if (session() && !msg) { go(kind); return; }
    render(msg);
    openSheet('rite', $('[data-open="quiz"].k'), { ritual: true });
    sfx('crystal');
    track('rite.open', 'view', { kind, state: sheet.dataset.state, inapp: isInApp() });
  }

  /* 登入完成：左上 chip 出現，同時收起儀式卡、直接進第一題 */
  function toDone() {
    sfx('login');
    paintWho(true);
    go(kind, { fresh: true });
  }

  function setMsg(text) {
    const m = $('#auth-msg'); if (!m) return;
    m.hidden = !text; m.textContent = text || '';
  }
  async function doLogin(btn) {
    const provider = btn.dataset.provider;
    if (busy) return;
    if (btn.getAttribute('aria-disabled') === 'true') {
      setMsg(errText('webview'));
      const ext = $('[data-act="ext"]', body); if (ext) ext.focus();
      return;
    }
    busy = true;
    track(`auth.${provider}.start`, 'auth_start', { kind, provider });
    setMsg('');
    $$('[data-provider]', body).forEach((b) => { b.disabled = b !== btn; });
    btn.setAttribute('aria-busy', 'true'); btn.classList.add('pending');
    const lbl = btn.querySelector('.lbl'), was = lbl.textContent; lbl.textContent = '連線中…';
    try {
      const s = await login(provider, {
        kind,
        /* Google 提示被略過：改放官方按鈕，使用者點它即完成同一個登入流程 */
        fallback: (renderBtn) => {
          const slot = $('#gsi-slot');
          if (!slot) return;
          slot.hidden = false;
          btn.hidden = true;
          renderBtn($('#gsi-btn'));
          $$('[data-provider]', body).forEach((b) => { b.disabled = false; });
          busy = false;
        },
      });
      track('auth.success', 'auth', { provider, kind, demo: !!s.demo });
      busy = false;
      toDone();
    } catch (e) {
      busy = false;
      const code = (e && e.code) || 'error';
      track('auth.fail', 'auth', { provider, kind, code });
      $$('[data-provider]', body).forEach((b) => { b.disabled = false; b.hidden = false; });
      const gs = $('#gsi-slot'); if (gs) gs.hidden = true;
      btn.removeAttribute('aria-busy'); btn.classList.remove('pending'); lbl.textContent = was;
      setMsg(errText(code));
    }
  }

  async function ext(btn) {
    const tip = $('#inapp-tip');
    const show = (t) => { if (tip) { tip.hidden = false; tip.textContent = t; } };
    const r = await openInBrowser();
    track('auth.inapp.open', 'click', { kind, os: r.os, mode: r.mode, copied: !!r.copied });
    if (r.mode === 'line') return;                                      /* LINE 自行改用外部瀏覽器開啟 */
    if (r.mode === 'intent') {
      /* intent 未能切換（頁面仍在前景）→ 改為複製網址並提示 */
      setTimeout(async () => {
        if (document.visibilityState !== 'visible') return;
        const c = await copyUrl();
        show(c ? '若沒有自動開啟，網址已複製，請貼到 Chrome 開啟' : '若沒有自動開啟，請點右上角「⋮」選「在 Chrome 中開啟」');
      }, 1600);
      return;
    }
    if (r.os === 'ios') show(r.copied ? '網址已複製。點右上角「⋯」選「在外部瀏覽器開啟」，或貼到 Safari 開啟' : '點右上角「⋯」選「在外部瀏覽器開啟」，即可用 Safari 登入');
    else show(r.copied ? '網址已複製，請貼到瀏覽器開啟' : '請點右上角選單，選擇以瀏覽器開啟');
    btn.blur();
  }

  body.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.provider) return doLogin(b);
    const act = b.dataset.act;
    if (act === 'ext') return ext(b);
  });

  /* ---------- 頂部頭像 chip ---------- */
  const wrap = $('#who-wrap'), who = $('#who'), menu = $('#who-menu');
  function paintWho(animate) {
    const s = session();
    const had = !wrap.hidden;
    wrap.hidden = !s;
    $('#qz-who').hidden = !s;
    if (!s) { menuOpen(false); return; }
    const ch = initial(s.name);
    $('#who-av').textContent = ch; $('#who-n').textContent = s.name;
    $('#who-src').dataset.p = s.src;
    $('#who-m-n').textContent = s.name;
    $('#who-m-s').textContent = `${PROV[s.src] || ''} 登入`;
    who.setAttribute('aria-label', `歡迎回來，${s.name}（${PROV[s.src] || ''} 登入），開啟帳號選單`);
    $('#qz-who-av').textContent = ch; $('#qz-who-n').textContent = s.name;
    if (animate && !had && !reduced()) { wrap.classList.remove('pop'); void wrap.offsetWidth; wrap.classList.add('pop'); }
  }
  function menuOpen(on) {
    menu.hidden = !on;
    who.setAttribute('aria-expanded', String(on));
    if (on) setTimeout(() => $('#who-switch').focus({ preventScroll: true }), 20);
  }
  who.addEventListener('click', () => menuOpen(menu.hidden));
  $('#who-switch').addEventListener('click', () => {
    logout();
    menuOpen(false);
    const live = $('#who-live'); if (live) live.textContent = '已登出，下次測驗時可用其他帳號登入';
    $('[data-open="quiz"].k').focus({ preventScroll: true });
  });
  document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !wrap.contains(e.target)) menuOpen(false); });
  wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { e.preventDefault(); menuOpen(false); who.focus(); } });
  onAuth(() => paintWho(false));
  paintWho(false);

  /* ---------- 靜音鈕（首頁右上角＋測驗標題列，兩顆同步） ---------- */
  const sndBtns = $$('[data-snd]');
  const paintSnd = (m) => sndBtns.forEach((b) => {
    b.classList.toggle('off', m);
    b.setAttribute('aria-pressed', String(m));
    b.setAttribute('aria-label', m ? '已靜音，點一下開啟音效' : '音效開啟，點一下靜音');
  });
  sndBtns.forEach((b) => b.addEventListener('click', () => {
    const m = !isMuted();
    setMuted(m);
    track('snd.toggle', 'click', { on: !m, at: b.dataset.snd });
    if (!m) sfx('on', { haptic: false });
  }));
  onMute(paintSnd);
  paintSnd(isMuted());

  return { open, go, render, paintWho };
}
