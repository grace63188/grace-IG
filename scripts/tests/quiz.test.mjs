// 測驗計分與儲存（不需瀏覽器）：node --test scripts/tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ABILITIES, ABILITY_QS, ABILITY_QUESTIONS, ABILITY_TEXT, STAGES, scoreAbility,
  ROLES, ROLE_CODE, CAREER_QUESTIONS, ROLE_TEXT, scoreCareer,
} from '../../assets/js/quizdata.js';

/** 依「每題想要的分數」換成選項索引（選項顯示順序不洗牌） */
const byPts = (pts) => pts.map((p, i) => {
  const k = ABILITY_QUESTIONS[i].opts.findIndex((o) => o.s === p);
  assert.ok(k >= 0, `Q${i + 1} 沒有 ${p} 分選項`);
  return k;
});
/** 以能力分配題分：{ 表達溝通:[a,b], ... } → 14 題分數 */
const pts = (m) => {
  const out = new Array(14).fill(null);
  for (const [k, [a, b]] of Object.entries(m)) { const [qa, qb] = ABILITY_QS[k]; out[qa - 1] = a; out[qb - 1] = b; }
  assert.ok(out.every((x) => x != null));
  return out;
};

// ---------------- 題庫完整性 ----------------
test('能力健檢：14 題、每題 4 選項且分數為 0–3 各一', () => {
  assert.equal(ABILITY_QUESTIONS.length, 14);
  for (const q of ABILITY_QUESTIONS) assert.deepEqual(q.opts.map((o) => o.s).sort(), [0, 1, 2, 3]);
  const used = Object.values(ABILITY_QS).flat().sort((a, b) => a - b);
  assert.deepEqual(used, Array.from({ length: 14 }, (_, i) => i + 1));
  for (const k of ABILITIES) assert.ok(ABILITY_TEXT[k].strong && ABILITY_TEXT[k].weak);
});

test('能力健檢：選項順序與題目原文一致（不洗牌）', () => {
  assert.equal(ABILITY_QUESTIONS[0].opts[0].t, '先說好的部分，再補一句「有個地方我想再確認一下」');
  assert.deepEqual(ABILITY_QUESTIONS[0].opts.map((o) => o.s), [2, 0, 3, 1]);
  assert.deepEqual(ABILITY_QUESTIONS[13].opts.map((o) => o.s), [1, 2, 0, 3]);
});

test('職涯定位：12 題二選一、每個角色出現 4 次；內容用字', () => {
  assert.equal(CAREER_QUESTIONS.length, 12);
  const n = Object.fromEntries(ROLES.map((r) => [r, 0]));
  for (const q of CAREER_QUESTIONS) { assert.equal(q.opts.length, 2); q.opts.forEach((o) => n[o.r]++); }
  for (const r of ROLES) assert.equal(n[r], 4, r);
  const all = JSON.stringify([CAREER_QUESTIONS, ROLE_TEXT, ABILITY_QUESTIONS, ABILITY_TEXT]);
  assert.ok(!all.includes('你'), '一律用「妳」');
  assert.ok(!all.includes('學姊'), '用「學姐」');
  assert.ok(!all.includes('照顧者'), 'S 型為「引導者」');
});

/* 題目用語改寫（2026.10.24）前的計分對照：選項順序、分數、角色、能力題號、階段區間必須逐字相同 */
const SCORING_BEFORE = '{"ABILITIES":["表達溝通","思考判斷","規劃佈局","領導協作","自我管理","品牌經營","工具應用"],"ABILITY_QS":{"表達溝通":[1,9],"思考判斷":[5,14],"規劃佈局":[2,11],"領導協作":[7,12],"自我管理":[4,10],"品牌經營":[3,8],"工具應用":[6,13]},"A":[[2,0,3,1],[1,0,2,3],[3,1,0,2],[2,1,3,0],[2,0,1,3],[2,0,1,3],[1,2,0,3],[0,3,1,2],[2,1,0,3],[3,0,2,1],[1,2,0,3],[2,0,3,1],[2,3,0,1],[1,2,0,3]],"STAGES":[[0,14,"探索起步"],[15,24,"基礎累積"],[25,34,"整合成形"],[35,42,"全面發揮"]],"ROLES":["實踐者","洞察者","創作者","引導者","開創者","統籌者"],"ROLE_CODE":{"實踐者":"R","洞察者":"I","創作者":"A","引導者":"S","開創者":"E","統籌者":"C"},"C":[["開創者","實踐者"],["洞察者","創作者"],["統籌者","引導者"],["洞察者","開創者"],["實踐者","統籌者"],["創作者","開創者"],["引導者","洞察者"],["實踐者","創作者"],["開創者","引導者"],["統籌者","洞察者"],["引導者","實踐者"],["創作者","統籌者"]]}';
test('計分對照與改寫前逐字相同（選項順序、分數、角色、題號、階段）', () => {
  const now = JSON.stringify({
    ABILITIES, ABILITY_QS,
    A: ABILITY_QUESTIONS.map((q) => q.opts.map((o) => o.s)),
    STAGES: STAGES.map((s) => [s.min, s.max, s.name]),
    ROLES, ROLE_CODE,
    C: CAREER_QUESTIONS.map((q) => q.opts.map((o) => o.r)),
  });
  assert.equal(now, SCORING_BEFORE);
});

// ---------------- 能力健檢計分 ----------------
test('能力健檢：一般作答 → 階段、最強、最需補強', () => {
  const r = scoreAbility(byPts(pts({ 表達溝通: [3, 3], 思考判斷: [2, 2], 規劃佈局: [1, 2], 領導協作: [2, 1], 自我管理: [0, 1], 品牌經營: [2, 2], 工具應用: [0, 0] })));
  assert.equal(r.total, 21);
  assert.equal(r.stage.name, '基礎累積');
  assert.equal(r.top, '表達溝通');
  assert.equal(r.low, '工具應用');
  assert.equal(r.scores.規劃佈局, 3);
  assert.equal(r.allSame, false);
});

test('能力健檢：同分 → 比單題最高分（最強取高、補強取低）', () => {
  // 最強同為 4：思考判斷 3+1（單題 3）勝 品牌經營 2+2；補強同為 2：自我管理 1+1（單題 1）比 工具應用 2+0 更需補強
  const r = scoreAbility(byPts(pts({ 表達溝通: [2, 1], 思考判斷: [3, 1], 規劃佈局: [1, 2], 領導協作: [3, 0], 自我管理: [1, 1], 品牌經營: [2, 2], 工具應用: [2, 0] })));
  assert.equal(r.scores.思考判斷, 4); assert.equal(r.scores.品牌經營, 4);
  assert.equal(r.top, '思考判斷');
  assert.equal(r.scores.自我管理, 2); assert.equal(r.scores.工具應用, 2);
  assert.equal(r.low, '自我管理');
});

test('能力健檢：同分且單題最高分也同 → 依能力順序取前者', () => {
  const r = scoreAbility(byPts(pts({ 表達溝通: [1, 1], 思考判斷: [2, 2], 規劃佈局: [3, 2], 領導協作: [2, 3], 自我管理: [1, 1], 品牌經營: [2, 2], 工具應用: [2, 1] })));
  assert.equal(r.top, '規劃佈局');      // 規劃 5 與領導 5、單題皆 3 → 規劃在前
  assert.equal(r.low, '表達溝通');      // 表達 2 與自我 2、單題皆 1 → 表達在前
});

test('能力健檢：全部同分 → 只顯示階段（無最強／補強）', () => {
  const r = scoreAbility(byPts(new Array(14).fill(3)));
  assert.equal(r.total, 42);
  assert.equal(r.stage.name, '全面發揮');
  assert.equal(r.allSame, true);
  assert.equal(r.top, null); assert.equal(r.low, null);
  assert.equal(scoreAbility(byPts(new Array(14).fill(0))).stage.name, '探索起步');
});

test('能力健檢：階段邊界 14/15/24/25/34/35', () => {
  const at = (t) => STAGES.find((s) => t >= s.min && t <= s.max).name;
  assert.deepEqual([0, 14, 15, 24, 25, 34, 35, 42].map(at), ['探索起步', '探索起步', '基礎累積', '基礎累積', '整合成形', '整合成形', '全面發揮', '全面發揮']);
  const p = new Array(14).fill(2); p[0] = 1; p[1] = 0;  // 28 - 1 - 2 = 25
  assert.equal(scoreAbility(byPts(p)).stage.name, '整合成形');
});

test('能力健檢：作答數不足或無效選項丟出錯誤', () => {
  assert.throws(() => scoreAbility([0, 1]), /14/);
  assert.throws(() => scoreAbility(new Array(14).fill(4)), /無效/);
});

// ---------------- 職涯定位計分 ----------------
test('職涯定位：一般作答 → 開創者主、統籌者副', () => {
  // Q1 A 開創 Q2 A 洞察 Q3 A 統籌 Q4 B 開創 Q5 B 統籌 Q6 B 開創 Q7 B 洞察 Q8 A 實踐 Q9 A 開創 Q10 A 統籌 Q11 A 引導 Q12 A 創作
  const r = scoreCareer([0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0]);
  assert.equal(r.counts.開創者, 4);
  assert.equal(r.counts.統籌者, 3);
  assert.equal(r.primary, '開創者');
  assert.equal(r.secondary, '統籌者');
});

test('職涯定位：同分 → 比 Q7–Q12 得分', () => {
  // 全選 A：六角色各 2 分；Q7–Q12 中 引導者 2、洞察者 0、其餘 1
  const r = scoreCareer(new Array(12).fill(0));
  assert.ok(ROLES.every((x) => r.counts[x] === 2));
  assert.equal(r.primary, '引導者');
  assert.equal(r.secondary, '實踐者');   // 實踐／創作／開創／統籌同為 1 → R 最前
});

test('職涯定位：同分且後半也同 → 依 R I A S E C 順序', () => {
  // 全選 B：各 2 分；Q7–Q12 中 洞察 2（Q7、Q10），實踐／創作／引導／統籌各 1，開創 0
  const r = scoreCareer(new Array(12).fill(1));
  assert.equal(r.primary, '洞察者');
  assert.equal(r.secondary, '實踐者');   // 實踐／創作／引導／統籌皆 1 → R 在前
  assert.deepEqual(r.rank, ['洞察者', '實踐者', '創作者', '引導者', '統籌者', '開創者']);
  // 主角色本身同分且後半同分：Q1 B 實踐、Q2 A 洞察、Q3 A 統籌、Q4 A 洞察、Q5 A 實踐、Q6 A 創作、
  // Q7 B 洞察、Q8 A 實踐、Q9 A 開創、Q10 B 洞察、Q11 B 實踐、Q12 B 統籌
  // → 實踐 4（後半 2）、洞察 4（後半 2）→ 依順序 R 先於 I
  const t = scoreCareer([1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1]);
  assert.equal(t.counts.實踐者, 4); assert.equal(t.counts.洞察者, 4);
  assert.equal(t.late.實踐者, 2); assert.equal(t.late.洞察者, 2);
  assert.equal(t.primary, '實踐者');
  assert.equal(t.secondary, '洞察者');
});

test('職涯定位：作答數不足或無效選項丟出錯誤', () => {
  assert.throws(() => scoreCareer([0]), /12/);
  assert.throws(() => scoreCareer(new Array(12).fill(2)), /無效/);
});

// ---------------- 儲存：localStorage 例外不壞 ----------------
test('localStorage 丟例外或內容損毀時，讀取回傳空、不中斷', async () => {
  const { loadStore, lastLabel, clearStore, STORE_KEY } = await import('../../assets/js/quiz.js');
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
    assert.deepEqual(loadStore(), {});
    assert.equal(lastLabel('career'), '');
    assert.doesNotThrow(() => clearStore());
    const mem = { [STORE_KEY]: '{壞掉的 JSON' };
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; }, removeItem: (k) => { delete mem[k]; } } });
    assert.deepEqual(loadStore(), {});
    mem[STORE_KEY] = JSON.stringify({ career: { primary: '不存在的角色' }, ability: { stage: '整合成形' } });
    assert.equal(lastLabel('career'), '');
    assert.equal(lastLabel('ability'), '整合成形');
  } finally {
    if (desc) Object.defineProperty(globalThis, 'localStorage', desc); else delete globalThis.localStorage;
  }
});

test('結果揭曉時間軸：能力健檢 3000ms 交棒、職涯定位 3150ms；狀態句預設字句', async () => {
  const Q = await import('../../assets/js/quiz.js');
  assert.equal(Q.RV_TL.done, 3000); assert.equal(Q.RV_TL.end, 3190); assert.equal(Q.RV_TL.lock, 2300); assert.equal(Q.RV_TL.morph + Q.RV_TL.morphDur, Q.RV_TL.done);
  assert.equal(Q.RV_TL.axis0 + 6 * Q.RV_TL.step + Q.RV_TL.tick, 2180);                 /* 最後一聲 tick */
  assert.equal(Q.RV_TL_C.done, 3150); assert.equal(Q.RV_TL_C.lock, 2410); assert.equal(Q.RV_TL_C.spin + Q.RV_TL_C.spinDur, 1950);
  assert.deepEqual([Q.RV_RM.out, Q.RV_GUARD, Q.RV_SKIP_OUT], [600, 220, 150]);
  assert.deepEqual(Q.RV_LINES.ability, ['整理妳的選擇', '對照七項能力', '妳的結果出爐了']);
  assert.deepEqual(Q.RV_LINES.career, ['整理妳的選擇', '對照六種角色', '妳的角色出爐了']);
  for (const l of [...Q.RV_LINES.ability, ...Q.RV_LINES.career]) { assert.ok([...l].length <= 8, l); assert.doesNotMatch(l, /分析|運算|AI/); }
});

test('職涯定位錶圈：9 聲 tick＝轉動每經過 60°，與規格 952…1950 相差 ≤2ms，先密後疏', async () => {
  const Q = await import('../../assets/js/quiz.js');
  const T = Q.RV_TICKS_C, spec = [952, 1042, 1112, 1176, 1242, 1317, 1411, 1545, 1950];
  assert.equal(T.length, 9);
  T.forEach((t, i) => assert.ok(Math.abs(t - spec[i]) <= 2, `${t} vs ${spec[i]}`));
  T.forEach((t, i) => assert.ok(Math.abs(Q.spinAt(t) - 60 * (i + 1)) < 0.5, `${i}`));
  const gaps = T.slice(1).map((t, i) => t - T[i]);
  assert.ok(gaps.slice(3).every((g, i) => g >= gaps[i + 2]), String(gaps));           /* 中段之後間隔遞增（減速） */
  assert.ok(Q.spinAt(0) < 1e-9); assert.equal(Math.round(Q.spinAt(5000)), 540);
});

test('結果揭曉類名與 keyframes 都以 qrv- 開頭、不含 "ad"', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../../assets/css/v7.css', import.meta.url), 'utf8');
  const js = readFileSync(new URL('../../assets/js/quiz.js', import.meta.url), 'utf8');
  const names = new Set([...css.matchAll(/\.(qrv[\w-]*)/g), ...js.matchAll(/\b(qrv[\w-]*)/g)].map((m) => m[1]));
  assert.ok(names.size >= 30, String(names.size));
  for (const n of names) assert.doesNotMatch(n, /ad/, n);
  assert.doesNotMatch(css.slice(css.indexOf('結果揭曉儀式')), /@keyframes/);            /* 揭曉不用 CSS keyframes（Web Animations 排程） */
});

// ---------------- 準備頁測驗切換（mockup_v15/switch） ----------------
test('測驗切換：switchPlan 換成目標測驗並給方向；同一個或不明測驗不切換', async () => {
  const Q = await import('../../assets/js/quiz.js');
  assert.deepEqual(Q.switchPlan('ability', 'career'), { kind: 'career', from: 'ability', dir: 1 });
  assert.deepEqual(Q.switchPlan('career', 'ability'), { kind: 'ability', from: 'career', dir: -1 });
  assert.equal(Q.switchPlan('career', 'career'), null);
  assert.equal(Q.switchPlan('ability', 'other'), null);
  assert.equal(Q.switchPlan('ability', undefined), null);
});

test('測驗切換時間軸：每段 ≤300ms、總長 460ms、狀態列 2260ms 收起、連點門檻 250ms', async () => {
  const { SW_TL: T } = await import('../../assets/js/quiz.js');
  for (const d of [T.outDur, T.inDur, T.stampDur, T.stInDur, T.rmDur]) assert.ok(d <= 300, String(d));
  assert.equal(T.inAt + T.inDur, 400); assert.equal(T.stampAt + T.stampDur, 460); assert.equal(T.stIn, 460);
  assert.equal(T.stEnd, 2260); assert.equal(T.rapid, 250);
});

test('測驗徽記：七面切割（七邊）／角色羅盤，只用 currentColor；章色與說明句', async () => {
  const M = await import('../../assets/js/marks.js');
  const gem = M.mark('ability', true), dial = M.mark('career', true);
  assert.equal(gem.match(/<polygon points="([^"]+)"/)[1].split(' ').length, 7);
  assert.match(gem, /class="fill"/); assert.doesNotMatch(M.mark('ability'), /class="fill"/);
  assert.match(dial, /r="9.6"/); assert.match(dial, /M12 12L16.6 6.4 13.3 13.4Z/);
  for (const s of [gem, dial]) { assert.doesNotMatch(s, /(fill|stroke)="#/); assert.match(s, /aria-hidden="true"/); }
  assert.deepEqual(M.ACC, { ability: '#45526B', career: '#A85B3C' });
  assert.deepEqual(M.SUB, { ability: '看見七項能力的分布', career: '找到妳的角色傾向' });
});

test('前台任何檔案都不出現「另一個測驗」；準備頁不再有舊連結', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const root = new URL('../../', import.meta.url);
  const files = ['index.html', 'privacy.html', ...readdirSync(new URL('assets/js/', root)).map((f) => 'assets/js/' + f), ...readdirSync(new URL('assets/css/', root)).map((f) => 'assets/css/' + f)];
  for (const f of files) {
    const t = readFileSync(new URL(f, root), 'utf8');
    assert.doesNotMatch(t, /另一個測驗/, f);
    assert.doesNotMatch(t, /qr-switch|data-act="other"|quiz\.other/, f);
  }
});

test('測驗切換與徽記的類名不含 "ad"；首頁票券用同一組徽記與章色', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../../assets/css/v7.css', import.meta.url), 'utf8');
  const sw = css.slice(css.indexOf('測驗切換（準備頁兩段式選擇）'), css.indexOf('小螢幕（矮、窄）'));
  const names = new Set([...sw.matchAll(/\.([a-z][\w-]*)/g)].map((m) => m[1]));
  assert.ok(names.has('qs-opt') && names.has('pass-mark') && names.has('tk-mark'));
  for (const n of names) assert.doesNotMatch(n, /ad/, n);
  assert.match(sw, /\[data-k="ability"\],\.tk-wrap\[data-kind="ability"\]\{--acc:#45526B/);
  assert.match(sw, /\[data-k="career"\],\.tk-wrap\[data-kind="career"\]\{--acc:#A85B3C/);
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const M = await import('../../assets/js/marks.js');
  for (const k of ['ability', 'career']) {
    const blk = html.slice(html.indexOf(`<div class="tk-wrap" data-kind="${k}">`), html.indexOf('</div>', html.indexOf(`<div class="tk-wrap" data-kind="${k}">`)));
    assert.ok(blk.includes(`<span class="tk-mark mk" aria-hidden="true">${M.mark(k, true)}</span>`), k + '：票券徽記與 marks.js 一致');
  }
});

test('小螢幕版面：只在寬 <768 且矮的視窗收緊；字級與觸控高度不低於下限；不新增含 "ad" 的類名', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../../assets/css/v7.css', import.meta.url), 'utf8');
  const blk = css.slice(css.indexOf('小螢幕（矮、窄）'));
  const qs = [...blk.matchAll(/@media ([^{]+)\{/g)].map((m) => m[1].trim());
  assert.deepEqual(qs, ['(max-width:767.98px) and (max-height:740px)', '(max-width:767.98px) and (max-height:600px)']);
  for (const m of blk.matchAll(/\.q-text\{[^}]*font-size:(?:clamp\((\d+(?:\.\d+)?)px[^)]*\)|(\d+(?:\.\d+)?)px)/g)) assert.ok(+(m[1] || m[2]) >= 16, 'q-text ' + m[0]);
  for (const m of blk.matchAll(/\.opt\{[^}]*font-size:(\d+(?:\.\d+)?)px/g)) assert.ok(+m[1] >= 14, 'opt ' + m[0]);
  for (const m of blk.matchAll(/(\.opt|\.opts\.two \.opt|\.nav|\.qs-opt)\{[^}]*min-height:(\d+)px/g)) assert.ok(+m[2] >= 44, m[0]);
  const names = new Set([...blk.matchAll(/\.([a-z][\w-]*)/g)].map((m) => m[1]));
  for (const n of names) if (/ad/.test(n)) assert.equal(n, 'q-ready', '只沿用既有的 q-ready');
});
