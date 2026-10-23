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
