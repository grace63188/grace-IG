/* 音效：全部以 Web Audio 即時合成（不使用外部音檔）；設計原則見 hub-front/SOUND.md
   - 首次使用者互動（pointerdown／keydown）後才建立 AudioContext；開場「Enter」以 unlock() 明確解鎖
   - 預設開啟；靜音選擇存 localStorage（try/catch）
   - 同一音色家族：正弦／三角波＋柔化噪音，全部走同一條主音軌（主音量 0.22）與同一個短殘響
   - 主音軌：70Hz 高通（去除手機喇叭放不出的次低頻）→ 輕壓縮 → 9kHz 低通（去刺耳高頻）
   - 衰減一律指數曲線；一般回饋 ≤0.3s，只有開場與揭曉兩個「主角時刻」允許較長的尾音
   - 開場音效走獨立子音軌，快轉或略過時整組在約 60ms 內淡出（hushIntro）；whoosh／tick 帶聲像（StereoPanner，不支援時置中）
   - 震動：navigator.vibrate（iOS 無此 API 即略過）；與音效一起觸發，靜音不影響震動 */

export const SND_KEY = 'grace.snd.v1';
const MASTER = 0.22;
const WET = 0.06;                                   /* 預設殘響送出量：只給一點空間感，讓整組音效像在同一個房間 */

let ctx = null, master = null, verbIn = null, noiseBuf = null, unlocked = false;
let introDry = null, introWet = null;
let muted = false;
try { muted = localStorage.getItem(SND_KEY) === 'off'; } catch (e) { /* 預設開啟 */ }
const subs = new Set();
let offListen = () => {};

export const isMuted = () => muted;
export function setMuted(m) {
  muted = !!m;
  try { localStorage.setItem(SND_KEY, muted ? 'off' : 'on'); } catch (e) { /* 只在本次有效 */ }
  if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : MASTER, ctx.currentTime, 0.015);
  subs.forEach((f) => f(muted));
}
export const onMute = (f) => { subs.add(f); return () => subs.delete(f); };

/* 短殘響：雙聲道指數衰減噪音（0.9s），以一階低通讓尾音偏暖
   預烘：殘響與白噪音的取樣在待機時先算好（不需要 AudioContext），Enter 那一下只複製，避免拖慢開場第一格 */
const BAKE_RATE = 48000;
let baked = null;
function bake() {
  if (baked) return baked;
  const len = Math.floor(BAKE_RATE * 0.9), ir = [new Float32Array(len), new Float32Array(len)], nz = new Float32Array(BAKE_RATE);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir[ch];
    let y = 0;
    for (let i = 0; i < len; i++) {
      y += 0.32 * ((Math.random() * 2 - 1) - y);
      d[i] = y * Math.pow(1 - i / len, 3.4);
    }
  }
  for (let i = 0; i < nz.length; i++) nz[i] = Math.random() * 2 - 1;
  return (baked = { ir, nz });
}
function roomIR(c) {
  const b = bake(), ir = c.createBuffer(2, b.ir[0].length, c.sampleRate);
  ir.getChannelData(0).set(b.ir[0]); ir.getChannelData(1).set(b.ir[1]);
  return ir;
}

function ensure() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return ctx; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : MASTER;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 70; hp.Q.value = 0.5;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 12; comp.ratio.value = 3; comp.attack.value = 0.003; comp.release.value = 0.2;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 9000; lp.Q.value = 0.5;
    master.connect(hp); hp.connect(comp); comp.connect(lp); lp.connect(ctx.destination);
    /* 殘響送出：12ms 預延遲 → 卷積 → 回到主音軌（仍受主音量與靜音控制） */
    verbIn = ctx.createGain();
    const pre = ctx.createDelay(0.05); pre.delayTime.value = 0.012;
    const conv = ctx.createConvolver(); conv.buffer = roomIR(ctx);
    const ret = ctx.createGain(); ret.gain.value = 0.55;
    verbIn.connect(pre); pre.connect(conv); conv.connect(ret); ret.connect(master);
    const nz = bake().nz;
    noiseBuf = ctx.createBuffer(1, nz.length, ctx.sampleRate);
    noiseBuf.getChannelData(0).set(nz);
  } catch (e) { ctx = null; }
  return ctx;
}

/** 明確解鎖（開場 Enter 的點擊）：建立／恢復 AudioContext */
export function unlock() {
  if (!unlocked) { unlocked = true; offListen(); }
  const c = ensure();
  if (c && c.state === 'suspended') c.resume().catch(() => {});
  return !!c;
}

/** 首次互動後啟用 */
export function initSound() {
  /* Esc 與單獨的修飾鍵不算使用者啟用（瀏覽器不允許以此建立音訊），略過以免主控台警告 */
  const go = (e) => { if (e && e.type === 'keydown' && (e.key === 'Escape' || ['Shift', 'Control', 'Alt', 'Meta'].includes(e.key))) return; unlock(); };
  offListen = () => { removeEventListener('pointerdown', go, true); removeEventListener('keydown', go, true); };
  addEventListener('pointerdown', go, true);
  addEventListener('keydown', go, true);
  const idle = window.requestIdleCallback || ((f) => setTimeout(f, 300));
  idle(() => { try { bake(); } catch (e) { /* 用到時再算 */ } });
}
export const ready = () => unlocked && !!ctx;

/* ---------- 子音軌 ---------- */
const mainBus = () => ({ dry: master, wet: verbIn });
function introBus() {
  if (!introDry) {
    introDry = ctx.createGain(); introDry.connect(master);
    introWet = ctx.createGain(); introWet.connect(verbIn);
  }
  return { dry: introDry, wet: introWet };
}
/** 開場被快轉或略過：已排程的開場音效在 60ms 內淡出 */
export function hushIntro() {
  if (!ctx || !introDry) return;
  const t = ctx.currentTime, a = introDry, b = introWet;
  [a, b].forEach((g) => { g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.setTargetAtTime(0, t, 0.02); });
  introDry = introWet = null;
  setTimeout(() => { try { a.disconnect(); b.disconnect(); } catch (e) { /* 已釋放 */ } }, 400);
}

/* ---------- 合成積木 ---------- */
const EPS = 0.0001;
function env(g, t, peak, a, d) {
  g.gain.setValueAtTime(EPS, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(EPS, t + a + d);
}
function send(g, out, wet) {
  g.connect(out.dry);
  if (wet > 0 && out.wet) { const w = ctx.createGain(); w.gain.value = wet; g.connect(w); w.connect(out.wet); }
}
function tone(t, { f, f2, type = 'sine', peak = 0.4, a = 0.004, d = 0.12, detune = 0, wet = WET, out = mainBus() }) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t); o.detune.value = detune;
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + a + d * 0.8);
  env(g, t, peak, a, d);
  o.connect(g); send(g, out, wet);
  o.start(t); o.stop(t + a + d + 0.05);
}
function noise(t, { dur, peak = 0.3, a = 0.01, type = 'bandpass', f = 1200, f2, q = 0.8, wet = WET, out = mainBus(), buf, at = Math.random() * 0.4 }) {
  const s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = buf || noiseBuf;
  fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q;
  if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
  env(g, t, peak, a, Math.max(0.01, dur - a));
  s.connect(fl); fl.connect(g); send(g, out, wet);
  s.start(t, at); s.stop(t + dur + 0.05);
}
/* 反向 swell：指數漸強到 dur（越接近結尾衝得越快），結尾 6ms 硬切（蓄力、riser 用） */
function swell(t, dur, { f, f2, type = 'sine', peak = 0.2, noise: isNoise = false, q = 0.7, detune = 0, wet = WET, out = mainBus() }) {
  const g = ctx.createGain(), end = t + dur;
  g.gain.setValueAtTime(EPS, t);
  g.gain.exponentialRampToValueAtTime(peak, end - 0.004);
  g.gain.linearRampToValueAtTime(0, end + 0.006);
  let src;
  if (isNoise) {
    src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const fl = ctx.createBiquadFilter(); fl.type = 'bandpass'; fl.Q.value = q;
    fl.frequency.setValueAtTime(f, t); fl.frequency.exponentialRampToValueAtTime(f2 || f, end);
    src.connect(fl); fl.connect(g); src.start(t, Math.random() * 0.3);
  } else {
    src = ctx.createOscillator(); src.type = type; src.detune.value = detune;
    src.frequency.setValueAtTime(f, t); if (f2) src.frequency.exponentialRampToValueAtTime(f2, end);
    src.connect(g); src.start(t);
  }
  send(g, out, wet);
  src.stop(end + 0.03);
}
/** 聲像：pan0→pan1 線性移動，回傳可交給 tone／noise 的 out（StereoPanner 不支援時直接用原音軌） */
function panner(t, dur, pan0, pan1, out) {
  if (!ctx.createStereoPanner) return out;
  const p = ctx.createStereoPanner();
  p.pan.setValueAtTime(pan0, t); p.pan.linearRampToValueAtTime(pan1, t + dur);
  p.connect(out.dry);
  return { dry: p, wet: out.wet };
}
/* 撕紙纖維：稀疏脈衝＋細噪，模擬一根根纖維斷開 */
let tearBuf = null;
function tearBuffer() {
  if (tearBuf) return tearBuf;
  const n = Math.floor(ctx.sampleRate * 0.42);
  tearBuf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = tearBuf.getChannelData(0);
  for (let i = 0; i < n; i++) {
    const p = i / n;
    const dens = 0.02 + 0.06 * Math.sin(Math.PI * Math.min(1, p * 1.4));
    d[i] = (Math.random() < dens ? (Math.random() * 2 - 1) : 0) + (Math.random() * 2 - 1) * 0.12;
  }
  return tearBuf;
}

/* 調性：整組音效共用 E 大調（登入 E5→G#5、揭曉 E–G#–B、開場蓄力 E2→E3、riser E3→E5、Logo shimmer E6），落位六聲取 E 大調五聲音階上行（高八度） */
export const LAND_HZ = [329.63, 369.99, 415.30, 493.88, 554.37, 659.25];

/* ---------- 音效表（依分鏡） ---------- */
const FX = {
  /* 按入口鍵：黑曜石輕叩 0.08s・180Hz 短敲＋360Hz 泛音（手機喇叭放不出 180Hz，靠泛音讓耳朵補出低音） */
  key(t) {
    tone(t, { f: 180, f2: 128, peak: 0.5, a: 0.003, d: 0.075, wet: 0.03 });
    tone(t, { f: 360, f2: 256, peak: 0.08, a: 0.003, d: 0.05, wet: 0 });
    tone(t, { f: 540, f2: 420, peak: 0.05, a: 0.002, d: 0.03, wet: 0 });
    noise(t, { dur: 0.025, peak: 0.05, type: 'lowpass', f: 1400, q: 0.3, wet: 0 });
  },
  /* 卡片滑出：絲絨滑出 0.30s・低通氣流聲，隨卡片減速淡出 */
  slide(t) {
    noise(t, { dur: 0.3, peak: 0.2, a: 0.07, type: 'lowpass', f: 380, f2: 1100, q: 0.6 });
    noise(t + 0.02, { dur: 0.24, peak: 0.05, a: 0.06, type: 'bandpass', f: 900, f2: 520, q: 0.9 });
  },
  /* 撕票：紙張撕裂 0.40s・低頻柔和纖維聲 */
  tear(t) {
    noise(t, { dur: 0.4, peak: 0.32, a: 0.05, type: 'bandpass', f: 1500, f2: 2400, q: 0.7, buf: tearBuffer(), wet: 0.04 });
    noise(t, { dur: 0.36, peak: 0.08, a: 0.04, type: 'lowpass', f: 600, q: 0.4 });
  },
  /* 蓋章：印章落下 0.12s 悶響 */
  stamp(t) {
    tone(t, { f: 118, f2: 72, peak: 0.6, a: 0.003, d: 0.11, wet: 0.08 });
    tone(t, { f: 236, f2: 150, peak: 0.07, a: 0.003, d: 0.05, wet: 0 });
    noise(t, { dur: 0.06, peak: 0.12, a: 0.002, type: 'lowpass', f: 420, q: 0.5 });
  },
  /* 儀式卡出現：水晶輕敲・2.1kHz 單音；尾音交給共用殘響，本體縮短、音量降低（2–5kHz 是最易刺耳的頻段） */
  crystal(t) {
    tone(t, { f: 2100, peak: 0.12, a: 0.004, d: 0.48, wet: 0.22 });
    tone(t, { f: 2100 * 2.76, peak: 0.018, a: 0.003, d: 0.14, wet: 0 });
    tone(t + 0.004, { f: 2103, peak: 0.04, a: 0.005, d: 0.4, detune: 6, wet: 0.22 });
  },
  /* 登入完成：香檳雙音 0.35s・上行大三度 E5→G#5 */
  login(t) {
    tone(t, { f: 659.25, type: 'triangle', peak: 0.2, a: 0.006, d: 0.26, wet: 0.14 });
    tone(t, { f: 1318.5, peak: 0.025, a: 0.004, d: 0.14 });
    tone(t + 0.09, { f: 830.61, type: 'triangle', peak: 0.22, a: 0.006, d: 0.3, wet: 0.14 });
    tone(t + 0.09, { f: 1661.2, peak: 0.025, a: 0.004, d: 0.16 });
  },
  /* 選答案：珍珠落座 0.06s・軟木質點擊（高頻顆粒由 2.4kHz 降至 1.9kHz，連點時較不扎耳） */
  pick(t) {
    tone(t, { f: 620, f2: 380, peak: 0.26, a: 0.002, d: 0.05, wet: 0.03 });
    noise(t, { dur: 0.03, peak: 0.045, a: 0.002, type: 'bandpass', f: 1900, q: 1.2, wet: 0 });
  },
  /* 翻題：紙頁翻動 0.18s・輕柔紙頁 whoosh */
  flip(t) {
    noise(t, { dur: 0.18, peak: 0.1, a: 0.05, type: 'bandpass', f: 2600, f2: 1300, q: 0.8 });
  },
  /* 揭曉結果：香檳鐘聲 1.2s・三音琶音＋長殘響，與圖形生長同步 */
  reveal(t) {
    [[659.25, 0], [830.61, 0.12], [987.77, 0.24]].forEach(([f, dt]) => {
      tone(t + dt, { f, peak: 0.16, a: 0.006, d: 0.95 - dt, wet: 0.2 });
      tone(t + dt, { f: f * 2, peak: 0.028, a: 0.004, d: 0.4 });
      tone(t + dt, { f: f * 3.01, peak: 0.01, a: 0.003, d: 0.22, wet: 0 });
    });
  },
  /* 開啟音效時的確認：由單一 880Hz 改為 E5＋B5 輕柔五度，與整組調性一致 */
  on(t) {
    tone(t, { f: 659.25, peak: 0.08, a: 0.005, d: 0.14, wet: 0.12 });
    tone(t + 0.03, { f: 987.77, peak: 0.05, a: 0.005, d: 0.14, wet: 0.12 });
  },

  /* ===== 開場（走開場子音軌） ===== */
  /* 減少動態路徑的 Enter：深沉觸發 0.35s・98→66Hz 下滑正弦＋196／294Hz 泛音（小喇叭聽得到）＋毛氈輕叩 */
  introEnter(t, o) {
    tone(t, { f: 98, f2: 66, peak: 0.6, a: 0.004, d: 0.34, wet: 0.12, out: o });
    tone(t, { f: 196, f2: 140, peak: 0.15, a: 0.003, d: 0.16, wet: 0.06, out: o });
    tone(t, { f: 294, f2: 220, peak: 0.05, a: 0.003, d: 0.09, wet: 0, out: o });
    noise(t, { dur: 0.03, peak: 0.07, a: 0.002, type: 'lowpass', f: 1600, q: 0.3, wet: 0, out: o, at: 0.1 });
  },
  /* ----- 完整開場：每個動作節拍一個聲音，時間全部由 intro.js 的 TL 推算 ----- */
  /* 蓄力 0→120ms：反向 swell——E2→E3 上滑正弦＋B3 泛音＋低通噪音由暗轉亮「吸氣」，在爆發前一刻硬切 */
  introCharge(t, o, { dur = 0.12 } = {}) {
    swell(t, dur, { f: 82.41, f2: 164.81, peak: 0.34, out: o, wet: 0.05 });
    swell(t, dur, { f: 246.94, f2: 329.63, peak: 0.07, out: o, wet: 0.05 });
    swell(t, dur, { noise: true, f: 260, f2: 2600, q: 0.6, peak: 0.16, out: o, wet: 0.08 });
  },
  /* 爆發 120ms：sub-boom（98→41Hz 下墜，196→82Hz 泛音讓手機聽得到）＋明亮瞬態（高通噪音＋E7 晶體點）＋空氣碎屑尾 */
  introImpact(t, o) {
    tone(t, { f: 98, f2: 41.2, peak: 0.85, a: 0.002, d: 0.6, wet: 0.14, out: o });
    tone(t, { f: 196, f2: 82.41, peak: 0.3, a: 0.002, d: 0.32, wet: 0.1, out: o });
    tone(t, { f: 123.47, type: 'triangle', peak: 0.12, a: 0.002, d: 0.18, wet: 0.08, out: o });
    noise(t, { dur: 0.05, peak: 0.42, a: 0.001, type: 'highpass', f: 3600, q: 0.5, wet: 0.12, out: o, at: 0.05 });
    noise(t, { dur: 0.1, peak: 0.24, a: 0.001, type: 'bandpass', f: 1300, f2: 600, q: 0.7, wet: 0.1, out: o, at: 0.25 });
    tone(t, { f: 2637.0, peak: 0.05, a: 0.001, d: 0.05, wet: 0.3, out: o });
    noise(t + 0.02, { dur: 0.62, peak: 0.1, a: 0.012, type: 'lowpass', f: 2400, f2: 260, q: 0.4, wet: 0.3, out: o, at: 0.55 });
  },
  /* 卡片每次掠過正前方：一聲 whoosh。帶通噪音掃頻、聲像跟著卡片 x 位置左右移動；一次比一次高（f 由 intro.js 依序遞增） */
  introWhoosh(t, o, { dur = 0.18, f = 600, gain = 1, pan0 = 0, pan1 = 0 } = {}) {
    const pn = panner(t, dur, pan0, pan1, o);
    noise(t, { dur, peak: 0.1 * gain, a: dur * 0.55, type: 'bandpass', f: f * 0.6, f2: f * 1.5, q: 1.3, wet: 0.08, out: pn });
    noise(t, { dur: dur * 0.9, peak: 0.045 * gain, a: dur * 0.5, type: 'lowpass', f: f * 0.5, f2: f * 0.9, q: 0.5, wet: 0, out: pn });
  },
  /* 慢放 riser：E3→E5 上滑（正弦＋五度三角波）＋噪音掃頻漸強，在停格（落位起點）硬切 */
  introRiser(t, o, { dur = 0.64 } = {}) {
    swell(t, dur, { f: 164.81, f2: 659.25, peak: 0.075, out: o, wet: 0.2 });
    swell(t, dur, { f: 246.94, f2: 987.77, type: 'triangle', peak: 0.03, out: o, wet: 0.2, detune: 6 });
    swell(t, dur, { noise: true, f: 500, f2: 6000, q: 0.9, peak: 0.12, out: o, wet: 0.15 });
  },
  /* 落位 tick：每張卡咬合那一刻一聲（E 大調五聲音階上行、高八度），清脆高頻點＋木質短體，聲像依卡片最終 x 位置 */
  introTick(t, o, { i = 0, pan = 0 } = {}) {
    const f = LAND_HZ[Math.max(0, Math.min(5, i | 0))] * 2, pn = panner(t, 0.1, pan, pan, o);
    noise(t, { dur: 0.018, peak: 0.2, a: 0.0008, type: 'highpass', f: 5200, q: 0.4, wet: 0.05, out: pn, at: 0.1 + i * 0.04 });
    tone(t, { f, type: 'triangle', peak: 0.075, a: 0.001, d: 0.07, wet: 0.16, out: pn });
    tone(t, { f: f * 2, peak: 0.014, a: 0.001, d: 0.03, wet: 0, out: pn });
    tone(t, { f: 1400, f2: 900, peak: 0.05, a: 0.001, d: 0.016, wet: 0, out: pn });
  },
  /* Logo 落定版頭：金屬 shimmer——E6 的非諧和泛音（×1、×2.76、×5.4）＋±7 cents 拍頻副聲部＋高頻閃粒，底下一層輕柔 E 大和弦收尾 */
  introShimmer(t, o) {
    [[1, 0.05, 0.95], [1.5, 0.03, 0.8], [2.76, 0.016, 0.5], [5.4, 0.006, 0.28]].forEach(([r, p, d]) => {
      tone(t, { f: 1318.5 * r, peak: p, a: 0.003, d, wet: 0.4, out: o });
      tone(t + 0.006, { f: 1318.5 * r, peak: p * 0.6, a: 0.004, d: d * 0.9, detune: r === 1 ? 7 : -7, wet: 0.4, out: o });
    });
    noise(t, { dur: 0.38, peak: 0.05, a: 0.004, type: 'highpass', f: 7000, f2: 4200, q: 0.5, wet: 0.35, out: o, at: 0.7 });
    [[164.81, 0.05], [246.94, 0.04], [415.30, 0.03]].forEach(([f, p], i) =>
      tone(t + 0.01 * i, { f, peak: p, a: 0.02, d: 1.1 - i * 0.12, wet: 0.3, out: o }));
  },
  /* 減少動態路徑的收尾：溫暖 E 大和弦 1.5s・E3 B3 E4 G#4 B4 輕撥（14ms 錯開）、柔起長收，每聲加 ±5 cents 微失諧的副聲部 */
  introChord(t, o) {
    [[164.81, 0.085], [246.94, 0.075], [329.63, 0.07], [415.30, 0.055], [493.88, 0.04]].forEach(([f, p], i) => {
      const s = t + i * 0.014;
      tone(s, { f, peak: p, a: 0.03, d: 1.45 - i * 0.08, wet: 0.3, out: o });
      tone(s, { f, type: 'triangle', peak: p * 0.35, a: 0.04, d: 1.1 - i * 0.06, detune: i % 2 ? 5 : -5, wet: 0.3, out: o });
    });
    tone(t + 0.07, { f: 1318.5, peak: 0.012, a: 0.01, d: 0.5, wet: 0.4, out: o });
  },
};

/* 震動樣式（Android；iOS 無 API 略過） */
const BUZZ = { key: 8, tear: [12, 330, 18], login: [10, 40, 10], pick: 6, reveal: [20, 60, 20, 60, 40], introEnter: 10, introCharge: 6, introImpact: 22 };
export function vibrate(p) { try { if (p && navigator.vibrate) navigator.vibrate(p); } catch (e) { /* 不支援 */ } }

/** 音訊時鐘（秒）：開場以同一個基準排程整組音效，避免逐一呼叫時 currentTime 跨過 render quantum 造成數毫秒漂移 */
export function clock() { const c = ready() ? ensure() : null; return c ? c.currentTime + 0.005 : null; }

/** 播放：name 為音效名稱；delay 秒（或 at：clock() 基準上的絕對時間）；arg 傳給音效（例：落位第幾張、whoosh 的長度／音高／聲像） */
export function sfx(name, { delay = 0, at = null, haptic = true, arg } = {}) {
  const c0 = ctx && at != null ? ctx.currentTime : 0, wait = at != null ? Math.max(0, at - c0) : delay;
  if (haptic && BUZZ[name] != null) { if (wait > 0.01) setTimeout(() => vibrate(BUZZ[name]), wait * 1000); else vibrate(BUZZ[name]); }   /* 震動與音效同一時刻 */
  if (muted || !unlocked || !FX[name]) return false;
  const c = ensure();
  if (!c) return false;
  try {
    const out = name.startsWith('intro') ? introBus() : mainBus();
    FX[name](at != null ? Math.max(at, c.currentTime) : c.currentTime + 0.005 + delay, out, arg);
    return true;
  } catch (e) { return false; }
}
