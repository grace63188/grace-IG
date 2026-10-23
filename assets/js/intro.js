/* 開場儀式：Logo 開場 → Enter → 蓄力、爆發、衝出、急速環繞、慢放、落位（入口卡成為首頁方磚）
   - 模式由 head 內嵌腳本決定（data-intro）：full＝完整開場（本裝置第一次造訪，或網址帶 ?intro=1）；
     none＝本裝置看過，直接進首頁；brief＝尚未記錄看過但從登入返回，Logo 短暫淡出
   - 看過紀錄：localStorage「grace.intro.seen」；儲存空間不可用時改記 sessionStorage，兩者都不可用就照常播放（不擋頁面）
   - 落位採 FLIP：直接動「真正的入口鍵」——先量最終位置，再以 transform 從軌道過渡到 none，結束即是可點的首頁，無替換、無跳動
   - 疊放：播放中入口卡疊在開場層（Logo）之上（intro.css），環繞與 Logo 飛往版頭時 Logo 都不會蓋住卡片文字
   - 畫面與音效共用同一個 TL：關鍵影格、衝擊、whoosh、riser、落位 tick、Logo 落定的 shimmer 都由 TL 推算
   - 只動 transform／opacity（Web Animations API）；動畫結束一律 cancel()，不留任何 inline 樣式
   - 減少動態：不旋轉，只做淡入淡出；Enter 的點擊同時解鎖音效（瀏覽器需要使用者互動才能出聲）
   - 播放中點任一處或按 Enter／Esc：快轉到結尾，開場音效子音軌快速淡出 */
import { $, $$, reduced, setInert } from './core.js?v=20261023d';
import { sfx, unlock, hushIntro, clock } from './sound.js?v=20261023d';
import { track } from './track.js?v=20261023d';

export const INTRO_KEY = 'grace.intro.seen';
const OLD_KEY = 'grace.intro.v1';                            /* 舊版（每個工作階段一次）的紀錄，僅清除 */
try { window.__introOk = true; } catch (e) { /* 非瀏覽器 */ }

/* 分鏡（毫秒，自按下 Enter 起算）——畫面與音效唯一的時間來源 */
export const TL = {
  charge: 0,                          /* 蓄力：Logo 吸氣縮到 0.94，光向中心聚攏 */
  burst: 120,                         /* 爆發：白金閃光＋衝擊環＋卡牌自中心炸開＋畫面震動 */
  blast: 230,                         /* 120→350：衝出到 1.1 倍軌道半徑（強 ease-out） */
  settle: 300,                        /* 350→650：回到軌道（微幅回彈） */
  whip: 700,                          /* 急速環繞：角速度峰值 */
  slow: 1300,                         /* 慢放：減速到近乎停格，卡片 3D 傾斜 */
  land: 1880, landDur: 400, stagger: 36,   /* 落位：每張間隔 36ms，帶極小回彈 */
  logo: 1900, logoDur: 520,           /* Logo 縮小飛到版頭 */
  rest: 2150, restDur: 300, restStagger: 50,   /* 「現在」列、頁尾、角落最後淡入 */
  shake: 180, shakeAmp: 3.5,          /* 爆發震動：3.5px 起、180ms 內衰減 */
  riser: 1240,                        /* 慢放 riser：1240ms 起，落位起點（land）硬切 */
};
/* 角速度（度／毫秒）關鍵點：爆發起步 → 700ms 峰值 → 慢放近乎停格 */
const OMEGA = [[120, 0], [240, 0.22], [420, 0.85], [700, 1.05], [1000, 0.72], [1240, 0.24], [1420, 0.05], [1880, 0.022], [4000, 0.022]];
const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
const EASE_IN = 'cubic-bezier(0.55, 0, 1, 0.45)';
/** 關鍵影格取樣時刻（自適應）：爆發前不動只取兩格；爆發＋震動 10ms；急速環繞 16ms；慢放 24ms；落位 12ms */
function sampleTimes(end) {
  const T = [0];
  for (let t = TL.burst; t < end; t += t < TL.burst + 300 ? 10 : t < TL.slow ? 16 : t < TL.land ? 24 : 12) T.push(t);
  return T;
}

/* ---------- 曲線 ---------- */
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (u) => u * u * (3 - 2 * u);
const outCubic = (u) => 1 - Math.pow(1 - u, 3);
const outExpo = (u) => (u >= 1 ? 1 : 1 - Math.pow(2, -10 * u));
/* 落位：backOut（快速咬合、約 3% 的極小回彈）——俐落不飄 */
const landEase = (u) => { const s = 1.25, v = u - 1; return u >= 1 ? 1 : 1 + (s + 1) * v * v * v + s * v * v; };
/* 落位音的時間點：卡片第一次走完 98% 路程（視覺上的「咬合」） */
export const LAND_HIT = (() => { let v = 0; while (v < 1 && landEase(v) < 0.98) v += 0.005; return v; })();

export function omega(t) {
  if (t <= OMEGA[0][0]) return 0;
  for (let k = 0; k < OMEGA.length - 1; k++) {
    const [t0, w0] = OMEGA[k], [t1, w1] = OMEGA[k + 1];
    if (t <= t1) return w0 + (w1 - w0) * smooth((t - t0) / (t1 - t0));
  }
  return OMEGA[OMEGA.length - 1][1];
}
const ANG = (() => { const a = new Float64Array(4001); for (let t = 1; t <= 4000; t++) a[t] = a[t - 1] + (omega(t - 1) + omega(t)) / 2; return a; })();
/** 累積旋轉角度（度） */
export function angleAt(t) {
  if (t <= 0) return 0;
  if (t >= 4000) return ANG[4000];
  const i = Math.floor(t), f = t - i;
  return ANG[i] + (ANG[i + 1] - ANG[i]) * f;
}
/** 爆發震動（px）：兩軸不同頻率的衰減正弦 */
export function shake(t) {
  const u = t - TL.burst;
  if (u < 0 || u > TL.shake) return [0, 0];
  const d = TL.shakeAmp * Math.exp(-u / 60) * (1 - u / TL.shake);
  return [d * Math.sin((2 * Math.PI * u) / 38), 0.75 * d * Math.sin((2 * Math.PI * u) / 31 + 1.3)];
}
/** 慢放程度 0→1 */
const slowAt = (t) => smooth(clamp((t - TL.slow) / 260)) * (1 - clamp((t - TL.land) / 120));

/* ---------- 軌道 ---------- */
/** 第 i 張卡在 t 時的姿態（視窗座標中心點、相對自身尺寸的縮放、3D 角度、透明度） */
export function orbitPose(i, t, g) {
  const u = t - TL.burst;
  if (u <= 0) return { x: g.cx, y: g.cy, s: g.s * 0.22, rx: 0, ry: 0, rz: 0, o: 0, a: 0, r: 0 };
  const u1 = clamp(u / TL.blast), u2 = clamp((u - TL.blast) / TL.settle);
  const r = g.R * (u1 < 1 ? 1.1 * outExpo(u1) : 1 + 0.1 * Math.cos(Math.PI * 1.4 * u2) * Math.pow(1 - u2, 1.6));
  const th = angleAt(t), m = slowAt(t);
  const a = ((-90 + 60 * i + th) * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a);
  const grow = 0.22 + 0.78 * outExpo(clamp(u / 180));
  const [sx, sy] = shake(t);
  return {
    x: g.cx + r * c + sx, y: g.cy + r * g.k * sn + sy,
    s: g.s * grow * (0.88 + 0.14 * sn) * (1 + 0.1 * m),    /* 前（下半）大、後（上半）小；慢放時略放大 */
    rx: m * 16 * sn, ry: -c * (30 + 16 * m), rz: -c * 4,   /* 轉向切線方向；慢放時加深 3D 傾斜 */
    o: clamp(u / 50) * (0.82 + 0.09 * (sn + 1)),
    a: th, r,
  };
}
export const landStart = (i) => TL.land + i * TL.stagger;
export const landEnd = (i) => landStart(i) + TL.landDur;
export const landHit = (i) => landStart(i) + LAND_HIT * TL.landDur;
export const TOTAL = Math.max(landEnd(5), TL.logo + TL.logoDur, TL.rest + 2 * TL.restStagger + TL.restDur);

/** 卡片在 t 時的位置與姿態（含落位混合） */
function cardAt(i, t, g, fin) {
  const p = orbitPose(i, t, g), w = landEase(clamp((t - landStart(i)) / TL.landDur)), q = 1 - w;
  return { x: p.x + (fin.x - p.x) * w, y: p.y + (fin.y - p.y) * w, s: p.s + (1 - p.s) * w, rx: p.rx * q, ry: p.ry * q, rz: p.rz * q, o: p.o + (1 - p.o) * clamp(w), w };
}
/** 速度拉伸（動態模糊感）：沿行進方向 scaleX 拉長，速度越快拉越長；方向角連續展開，避免影格間翻轉 */
function streak(i, t, g, fin, prev) {
  const a = cardAt(i, t, g, fin), b = cardAt(i, t - 8, g, fin);
  const vx = (a.x - b.x) / 8, vy = (a.y - b.y) / 8, v = Math.hypot(vx, vy);
  let phi = prev.phi;
  if (v > 0.05) { phi = (Math.atan2(vy, vx) * 180) / Math.PI; while (phi - prev.phi > 180) phi -= 360; while (phi - prev.phi < -180) phi += 360; }
  prev.phi = phi;
  return { ...a, v, phi, st: Math.min(0.32, v * 0.075) };
}
const tf = (p, fin) => `perspective(900px) translate3d(${(p.x - fin.x).toFixed(2)}px,${(p.y - fin.y).toFixed(2)}px,0) rotate(${p.phi.toFixed(2)}deg) scale(${(1 + p.st).toFixed(4)},${(1 - p.st * 0.28).toFixed(4)}) rotate(${(-p.phi).toFixed(2)}deg) rotateX(${p.rx.toFixed(2)}deg) rotateY(${p.ry.toFixed(2)}deg) rotateZ(${p.rz.toFixed(2)}deg) scale(${p.s.toFixed(4)})`;

/** 卡片關鍵影格：t=0…landEnd(i)，每 12ms 取樣；最後一格為 none（＝真正的首頁位置） */
export function cardFrames(i, g, fin) {
  const end = landEnd(i), frames = [], prev = { phi: 0 };
  for (const t of sampleTimes(end)) {
    const p = streak(i, t, g, fin, prev);
    frames.push({ offset: t / end, transform: tf(p, fin), opacity: +p.o.toFixed(3) });
  }
  frames.push({ offset: 1, transform: 'none', opacity: 1 });
  return frames;
}
/** 殘影：同一條路徑落後 lag 毫秒，只在高速時浮現（速度越快越明顯），落位前淡盡 */
export const GHOSTS = [[34, 0.24], [68, 0.1]];
const GHOST_END = TL.land + 160;
function ghostFrames(i, g, fin, lag, op) {
  const frames = [], prev = { phi: 0 };
  for (const t of [...sampleTimes(GHOST_END), GHOST_END]) {
    const p = streak(i, t - lag, g, fin, prev);
    const o = t - lag <= TL.burst ? 0 : op * clamp((p.v - 0.25) / 1.4) * (1 - clamp((t - TL.land + 60) / 200));
    frames.push({ offset: t / GHOST_END, transform: tf(p, fin), opacity: +o.toFixed(3) });
  }
  frames[frames.length - 1] = { offset: 1, transform: frames[frames.length - 1].transform, opacity: 0 };
  return frames;
}
/** 光軌：一枚圓環以 scale(1, k) 壓成與軌道相同的橢圓，跟著卡片同角速度旋轉；尾跡亮度隨角速度（急速環繞最亮、慢放淡去） */
const RING_END = TL.land + 5 * TL.stagger + 200;
function ringFrames(g) {
  const frames = [];
  for (const t of [...sampleTimes(RING_END), RING_END]) {
    const p = orbitPose(0, t, g), r = Math.max(1, p.r || 1);
    const o = clamp((t - TL.burst - 60) / 160) * (0.35 + 0.65 * clamp(omega(t) / 0.6)) * (1 - clamp((t - TL.land + 80) / 300));
    frames.push({
      offset: t / RING_END,
      transform: `translate(${(g.cx - g.R).toFixed(2)}px,${(g.cy - g.R).toFixed(2)}px) scale(${(r / g.R).toFixed(4)},${((r * g.k) / g.R).toFixed(4)}) rotate(${p.a.toFixed(2)}deg)`,
      opacity: +(0.95 * o).toFixed(3),
    });
  }
  frames[frames.length - 1].offset = 1;
  return frames;
}
/** Logo：吸氣（0.94）→ 爆發瞬間彈到 1.06 → 回到 1；同時吃下爆發震動 */
const MARK_END = 520;
function markFrames() {
  const frames = [];
  for (let t = 0; t <= MARK_END; t += 10) {
    let s;
    if (t <= TL.burst) s = 1 - 0.06 * outCubic(t / TL.burst);
    else if (t <= TL.burst + 50) s = 0.94 + 0.12 * outCubic((t - TL.burst) / 50);
    else s = 1.06 - 0.06 * outCubic(clamp((t - TL.burst - 50) / 300));
    const [x, y] = shake(t);
    frames.push({ offset: t / MARK_END, transform: `translate(${x.toFixed(2)}px,${y.toFixed(2)}px) scale(${s.toFixed(4)})` });
  }
  return frames;
}
/** 卡片經過正前方（軌道最下方、最靠近觀眾）的時刻：每一次經過配一聲 whoosh */
export function passes(g) {
  const out = [];
  for (let i = 0; i < 6; i++) {
    let last = Math.floor((-90 + 60 * i - 90) / 360);
    for (let t = TL.burst + 120; t < TL.land; t += 2) {
      const n = Math.floor((-90 + 60 * i + angleAt(t) - 90) / 360);
      if (n !== last && omega(t) >= 0.2) out.push({ i, t });
      last = n;
    }
  }
  return out.sort((a, b) => a.t - b.t);
}
/** 軌道尺寸：依視窗寬度；爆出時 1.1 倍外衝（含速度拉伸）不超出畫面 */
export function geometry(vw, mark) {
  const mob = vw < 768;
  const cardW = mob ? Math.min(vw * 0.2, 84) : 116;
  let R = mob ? vw * 0.39 : Math.min(vw * 0.27, 360);
  R = Math.min(R, (vw / 2 - 10 - cardW * 0.62) / 1.1);
  return { cx: mark.left + mark.width / 2, cy: mark.top + mark.height / 2, R, k: mob ? 0.62 : 0.5, cardW };
}

/* ---------- 狀態 ---------- */
const root = document.documentElement;
/* 看過紀錄：先寫 localStorage；被擋（無痕模式、IG 內建瀏覽器）改寫 sessionStorage；都不行就算了，下次照常播放 */
export function markSeen() {
  try { localStorage.setItem(INTRO_KEY, '1'); return; } catch (e) { /* 改用 sessionStorage */ }
  try { sessionStorage.setItem(INTRO_KEY, '1'); } catch (e) { /* 無法記錄 */ }
}
try { sessionStorage.removeItem(OLD_KEY); } catch (e) { /* 無法存取 */ }
let state = 'off', anims = [], opts = {}, inerted = false, pre = null, preTimer = 0;
const el = {};
const canAnimate = () => typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';

function noScroll(e) { if (state === 'idle' || state === 'play') e.preventDefault(); }

/* ---------- 預先建立（待機時） ----------
   入口卡、殘影、光軌的關鍵影格多（每個元素上百格），在 Enter 那一下才產生與解析，手機上會讓第一格延遲上百毫秒、吃掉 120ms 的蓄力。
   待機時（首頁被遮住、卡片本來就看不見）先量好位置並建立「暫停在 0」的動畫；Enter 時只要 play()。
   版面簽章（視窗尺寸、各卡 offset、Logo 位置）不同就作廢重建；視窗改變尺寸時重新預建。 */
function measure() {
  const keys = $$('.keys .k'), logo = $('.mast .logo');
  const m = el.mark.getBoundingClientRect(), L = logo.getBoundingClientRect(), vw = window.innerWidth;
  const sig = [vw, window.innerHeight, Math.round(m.left * 10), Math.round(m.top * 10), Math.round(L.left * 10), Math.round(L.top * 10), Math.round(L.width * 10),
    ...keys.map((k) => `${k.offsetLeft},${k.offsetTop},${k.offsetWidth},${k.offsetHeight}`)].join('|');
  return { keys, logo, m, L, vw, sig };
}
function buildHeavy(M) {
  const g = geometry(M.vw, M.m), out = [];
  const fins = M.keys.map((k) => { const r = k.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; });
  const A = (node, kf, o) => { const x = node.animate(kf, o); x.pause(); x.currentTime = 0; out.push(x); return x; };
  M.keys.forEach((k, i) => A(k, cardFrames(i, { ...g, s: g.cardW / fins[i].w }, fins[i]), { duration: landEnd(i), fill: 'both', easing: 'linear' }));
  /* 殘影：每張卡兩層，落後 34／68ms，只在高速時浮現 */
  el.trails.textContent = '';
  M.keys.forEach((k, i) => GHOSTS.forEach(([lag, op]) => {
    const n = document.createElement('i'), f = fins[i];
    n.className = 'intro-ghost';
    n.style.cssText = `left:${(f.x - f.w / 2).toFixed(2)}px;top:${(f.y - f.h / 2).toFixed(2)}px;width:${f.w.toFixed(2)}px;height:${f.h.toFixed(2)}px`;
    el.trails.appendChild(n);
    A(n, ghostFrames(i, { ...g, s: g.cardW / f.w }, f, lag, op), { duration: GHOST_END, fill: 'both', easing: 'linear' });
  }));
  el.ring.style.width = el.ring.style.height = `${(g.R * 2).toFixed(2)}px`;
  A(el.ring, ringFrames(g), { duration: RING_END, fill: 'both', easing: 'linear' });
  return { sig: M.sig, g, fins, anims: out };
}
function dropPre() {
  clearTimeout(preTimer);
  if (!pre) return;
  pre.anims.forEach((a) => { try { a.cancel(); } catch (e) { /* 已結束 */ } });
  pre = null;
  if (el.trails) el.trails.textContent = '';
}
function schedulePre(wait = 700) {
  clearTimeout(preTimer);
  if (reduced() || !canAnimate()) return;
  preTimer = setTimeout(() => {
    if (state !== 'idle') return;
    const go = () => { if (state !== 'idle') return; dropPre(); try { pre = buildHeavy(measure()); } catch (e) { pre = null; } };
    if (window.requestIdleCallback) requestIdleCallback(go, { timeout: 600 }); else go();
  }, wait);
}

function cleanup() {
  dropPre();
  anims.forEach((a) => { try { a.cancel(); } catch (e) { /* 已結束 */ } });
  anims = [];
  if (el.box && el.box.contains(document.activeElement)) document.activeElement.blur();
  if (el.mark) el.mark.style.visibility = '';
  if (el.bg) el.bg.style.visibility = '';
  if (el.ring) { el.ring.style.width = el.ring.style.height = ''; }
  if (el.shock) { el.shock.style.width = el.shock.style.height = ''; }
  if (el.trails) el.trails.textContent = '';
  root.style.removeProperty('--ig-t'); root.style.removeProperty('--ig-st');
  root.classList.remove('intro-full', 'intro-brief', 'intro-hold', 'intro-play', 'intro-landed');
  if (inerted) { setInert(el.page, false); inerted = false; }
  el.box && el.box.removeAttribute('aria-hidden');
  state = 'done';
  markSeen();                                                /* 開場播完（含快轉、減少動態、短淡出）即記錄看過 */
  root.dispatchEvent(new CustomEvent('intro:done'));
}

/* 退場淡出（略過、減少動態、從登入返回）：遮罩淡出、首頁短淡入 */
function fadeAway({ hold = 0, out = 220, inDur = 320, ease = EASE_IN } = {}) {
  if (!canAnimate()) { cleanup(); return; }
  root.classList.remove('intro-hold');
  const a = el.box.animate([{ opacity: 1 }, { opacity: 0 }], { duration: out, delay: hold, easing: ease, fill: 'forwards' });
  const b = el.page.animate([{ opacity: 0 }, { opacity: 1 }], { duration: inDur, delay: hold + 40, easing: EASE_OUT, fill: 'backwards' });
  anims = [a, b];
  Promise.all([a.finished, b.finished]).then(cleanup, () => {});
}

export function skip(via = 'button') {
  if (state !== 'idle') return;
  state = 'leaving';
  dropPre();
  markSeen();
  track('intro.skip', 'click', { via });
  fadeAway();
}

/* ---------- 完整開場 ---------- */
export function enter(via = 'button') {
  if (state !== 'idle') return;
  markSeen();
  unlock();                                                  /* 這一下點擊同時解鎖音效 */
  track('intro.enter', 'click', { via });
  if (reduced() || !canAnimate()) {
    state = 'leaving';
    dropPre();
    sfx('introEnter');
    sfx('introChord', { delay: 0.22 });
    fadeAway({ out: 300, inDur: 300, ease: 'ease-out' });
    return;
  }
  state = 'play';

  /* 1. 量最終位置（版面已就緒，只是被遮住） */
  const ss0 = root.style.scrollBehavior; root.style.scrollBehavior = 'auto'; window.scrollTo(0, 0); root.style.scrollBehavior = ss0;
  const M = measure(), { keys, m, L, vw } = M;
  clearTimeout(preTimer);
  if (!pre || pre.sig !== M.sig) { dropPre(); pre = buildHeavy(M); }   /* 待機預建失效（或還沒建好）：當場建立 */
  const { g, fins } = pre;

  /* 2. 啟動動畫（全部從現在起算，fill:both 讓尚未開始的元素先隱身）：預建的卡片／殘影／光軌直接 play() */
  anims = pre.anims; pre = null;
  anims.forEach((x) => x.play());
  const A = (node, kf, o) => { const x = node.animate(kf, o); anims.push(x); return x; };
  /* Enter 與 SKIP 退下 */
  A(el.act, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.96)' }], { duration: 140, easing: EASE_IN, fill: 'forwards' });
  A(el.skip, [{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: EASE_IN, fill: 'forwards' });
  /* 霧面底：閃光蓋住的那一刻淡去，淡完即移出繪製（全畫面漸層留在合成樹上，每格都要混色，手機吃效能） */
  A(el.bg, [{ opacity: 1 }, { opacity: 0 }], { duration: 260, delay: TL.burst, easing: EASE_OUT, fill: 'forwards' }).finished.then(() => { if (state === 'play') el.bg.style.visibility = 'hidden'; }, () => {});
  if (el.halo.getAnimations) { el.halo.getAnimations().forEach((x) => x.cancel()); el.sheen.getAnimations({ subtree: true }).forEach((x) => x.cancel()); }
  A(el.sheen, [{ opacity: 1 }, { opacity: 0 }], { duration: 100, fill: 'forwards' });
  /* 蓄力：光暈向中心收攏 → 爆發：撐開後散去 */
  const b = TL.burst, H = (s) => `translate(-50%,-50%) scale(${s})`;
  A(el.halo, [
    { offset: 0, opacity: 0.85, transform: H(1), easing: 'cubic-bezier(0.5, 0, 0.75, 0)' },
    { offset: b / 700, opacity: 1, transform: H(0.62), easing: EASE_OUT },
    { offset: (b + 40) / 700, opacity: 1, transform: H(1.25), easing: EASE_OUT },
    { offset: 1, opacity: 0, transform: H(1.7) },
  ], { duration: 700, fill: 'forwards' });
  A(el.mark, markFrames(), { duration: MARK_END, easing: 'linear' });
  /* 白金閃光（全畫面純色，只動 opacity）＋中心光團＋衝擊環（蓄力時向內收，爆發時向外擴散） */
  A(el.flash, [
    { offset: 0, opacity: 0 }, { offset: (b - 4) / 420, opacity: 0, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
    { offset: (b + 16) / 420, opacity: 0.72, easing: 'cubic-bezier(0.25, 0.6, 0.3, 1)' }, { offset: 1, opacity: 0 },
  ], { duration: 420, fill: 'both' });
  A(el.bloom, [
    { offset: 0, opacity: 0, transform: H(0.58) }, { offset: (b - 30) / 520, opacity: 0.35, transform: H(0.5), easing: 'cubic-bezier(0.5, 0, 1, 1)' },
    { offset: b / 520, opacity: 0.9, transform: H(0.75), easing: EASE_OUT }, { offset: (b + 30) / 520, opacity: 1, transform: H(1.65), easing: EASE_OUT },
    { offset: 1, opacity: 0, transform: H(2.8) },
  ], { duration: 520, fill: 'both' });
  el.shock.style.width = el.shock.style.height = `${(g.R * 2).toFixed(2)}px`;
  const S = (s) => `translate(-50%,-50%) scale(${s},${(s * g.k).toFixed(4)})`;
  A(el.shock, [
    { offset: 0, opacity: 0, transform: S(1.1), easing: 'cubic-bezier(0.55, 0, 1, 0.45)' },
    { offset: (b - 10) / 700, opacity: 0.55, transform: S(0.22), easing: 'linear' },
    { offset: b / 700, opacity: 0.2, transform: S(0.12), easing: 'linear' },
    { offset: (b + 14) / 700, opacity: 1, transform: S(0.2), easing: 'cubic-bezier(0.1, 0.7, 0.2, 1)' },
    { offset: 1, opacity: 0, transform: S(1.55) },
  ], { duration: 700, fill: 'both' });
  /* 落位那一刻每張卡掠過一道反光（CSS ::after，時間由 TL 推算） */
  root.style.setProperty('--ig-t', `${Math.round(landHit(0) - 60)}ms`);   /* 最後一張的反光在 TOTAL 前掃完（380ms） */
  root.style.setProperty('--ig-st', `${TL.stagger}ms`);
  /* Logo 飛到版頭 */
  const dx = L.left + L.width / 2 - (m.left + m.width / 2), dy = L.top + L.height / 2 - (m.top + m.height / 2), sc = L.width / m.width;
  const fly = A(el.mark, [{ transform: 'none' }, { transform: `translate(${dx.toFixed(2)}px,${dy.toFixed(2)}px) scale(${sc.toFixed(4)})` }], { duration: TL.logoDur, delay: TL.logo, easing: 'cubic-bezier(0.7, 0, 0.15, 1)', fill: 'forwards' });
  fly.finished.then(() => { if (state !== 'play') return; root.classList.add('intro-landed'); el.mark.style.visibility = 'hidden'; }, () => {});
  /* 「現在」列、頁尾、角落最後淡入 */
  [$('.now'), $('.foot'), $('#corner')].filter(Boolean).forEach((n, j) =>
    A(n, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: TL.restDur, delay: TL.rest + j * TL.restStagger, easing: EASE_OUT, fill: 'backwards' }));

  /* 3. 切換狀態：動畫已接手每個元素的初始值，這一刻移除遮蔽不會閃 */
  root.classList.remove('intro-full', 'intro-hold');
  root.classList.add('intro-play');

  /* 4. 音效：與分鏡同一條 TL；全部以同一個音訊時鐘基準 T0 排程（不漂移） */
  const T0 = clock(), sec = (ms) => ms / 1000, at = (ms) => (T0 == null ? null : T0 + ms / 1000), pan = (x) => +clamp((x - vw / 2) / (vw / 2), -1, 1).toFixed(3);
  sfx('introCharge', { at: at(TL.charge), arg: { dur: sec(TL.burst - TL.charge) } });
  sfx('introImpact', { at: at(TL.burst), delay: sec(TL.burst) });
  /* 後面的節拍分兩批建立音訊節點（時間仍以 T0 為準，不影響同步），讓按下 Enter 的那一格不被拖慢 */
  const later = (ms, f) => setTimeout(() => { if (state === 'play') f(); }, ms);
  later(40, () => passes(g).forEach((p, k, ps) => {
    const w = omega(p.t), dur = clamp(70 / w, 120, 280), t0 = p.t - dur * 0.55, N = Math.max(1, ps.length - 1);
    const P = (t) => orbitPose(p.i, t, g).x;
    sfx('introWhoosh', { at: at(t0), delay: sec(t0), haptic: false, arg: { dur: sec(dur), f: 460 * Math.pow(2, (1.7 * k) / N), gain: 0.55 + 0.45 * clamp(w / 1.05), pan0: pan(P(t0)) * 0.85, pan1: pan(P(t0 + dur)) * 0.85 } });
  }));
  later(Math.min(900, TL.riser - 300), () => {
    sfx('introRiser', { at: at(TL.riser), delay: sec(TL.riser), arg: { dur: sec(TL.land - TL.riser) } });
    keys.forEach((_, i) => sfx('introTick', { at: at(landHit(i)), delay: sec(landHit(i)), haptic: false, arg: { i, pan: pan(fins[i].x) * 0.6 } }));
    sfx('introShimmer', { at: at(TL.logo + TL.logoDur), delay: sec(TL.logo + TL.logoDur) });
  });

  Promise.all(anims.map((x) => x.finished)).then(() => { if (state === 'play') cleanup(); }, () => {});
}

/** 播放中：點一下或按鍵＝快轉到結尾 */
function fastForward() {
  if (state !== 'play') return;
  hushIntro();
  anims.slice().forEach((x) => { try { x.finish(); } catch (e) { /* 已結束 */ } });
}

/* ---------- 從登入返回（尚未記錄看過）：Logo 短暫淡出 ---------- */
function brief() {
  state = 'leaving';
  el.box.setAttribute('aria-hidden', 'true');
  fadeAway({ hold: 140, out: 340, inDur: 320, ease: 'cubic-bezier(0.45, 0, 0.55, 1)' });
}

/** 預覽「重播開場」 */
export function replay() {
  if (!el.box || state === 'play' || state === 'idle' || state === 'leaving') return false;
  if (opts.prepare) opts.prepare();
  const s0 = root.style.scrollBehavior; root.style.scrollBehavior = 'auto'; window.scrollTo(0, 0); root.style.scrollBehavior = s0;
  root.setAttribute('data-intro', 'full');
  root.classList.add('intro-full', 'intro-hold');
  setInert(el.page, true); inerted = true;
  state = 'idle';
  schedulePre();
  return true;
}
export const introState = () => state;

export function initIntro(o = {}) {
  opts = o;
  el.box = $('#intro'); el.page = $('.page');
  if (!el.box || !el.page) return;
  el.bg = $('.intro-bg', el.box); el.mark = $('#intro-mark'); el.halo = $('.intro-halo', el.box); el.sheen = $('.intro-sheen', el.box);
  el.flash = $('.intro-flash', el.box); el.bloom = $('.intro-bloom', el.box); el.shock = $('#intro-shock'); el.trails = $('#intro-trails');
  el.act = $('#intro-act'); el.skip = $('#intro-skip'); el.ring = $('#intro-ring');
  /* 光澤只落在 Logo 筆畫上：以 Logo 本身作遮罩 */
  const img = $('#intro-logo');
  if (img && el.sheen) { const u = `url("${img.currentSrc || img.src}")`; el.sheen.style.webkitMaskImage = u; el.sheen.style.maskImage = u; }

  $('#intro-enter').addEventListener('click', () => enter('button'));
  el.skip.addEventListener('click', () => skip('button'));
  el.box.addEventListener('pointerdown', (e) => { if (state === 'play') { e.preventDefault(); fastForward(); } });
  el.box.addEventListener('wheel', noScroll, { passive: false });
  el.box.addEventListener('touchmove', noScroll, { passive: false });
  document.addEventListener('keydown', (e) => {
    if (state === 'play' && (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); fastForward(); return; }
    if (state !== 'idle') return;
    if (e.key === 'Escape') { e.preventDefault(); skip('esc'); return; }
    const onBtn = e.target && e.target.closest && e.target.closest('button,a');
    if (!onBtn && e.key === 'Enter') { e.preventDefault(); enter('key'); return; }
    if (!onBtn && [' ', 'PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'End', 'Home'].includes(e.key)) e.preventDefault();
  }, true);

  const mode = root.getAttribute('data-intro');
  const on = root.classList.contains('intro-full') || root.classList.contains('intro-brief');
  if (!on) { state = 'done'; return; }                       /* 看過（none），或 head 後備計時已放行（腳本過慢）：不再播 */
  if (mode === 'brief') { brief(); return; }
  setInert(el.page, true); inerted = true;
  state = 'idle';
  schedulePre();
  addEventListener('resize', () => { if (state === 'idle') { dropPre(); schedulePre(250); } });
}
