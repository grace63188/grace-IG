// 結果頁「下一步」：文案、銜接句、傳給官方 LINE 的網址（不需瀏覽器）：node --test scripts/tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NX, OA_URL, OA_MSG, SHARE_MAX, bridge, ymd, shareText, shareUrl } from '../../assets/js/nextstep.js';
import { ABILITIES, STAGES, ROLES } from '../../assets/js/quizdata.js';

const AT = new Date(2026, 9, 24, 21, 5).getTime();               /* 當地時間 2026.10.24 */
const ab = (stage, top, low, allSame = false) => ({ stage: STAGES.find((s) => s.name === stage), top, low, allSame });
const allCopy = () => [NX.enroll.name, NX.enroll.cond, NX.enroll.lead, NX.enroll.btn, NX.share.text, NX.share.btn, NX.consult.name, NX.consult.cond, NX.consult.cue,
  NX.lightHead, NX.member.t, NX.member.link, NX.b2, ...NX.light.flatMap((o) => [o.name, o.cue]),
  ...Object.values(NX.ability).flatMap((v) => [v.b1, v.even]), ...Object.values(NX.career)];

test('定稿文案：正式入學主卡、傳給官方 LINE、一對一諮詢、定位說明', () => {
  assert.deepEqual([NX.enroll.name, NX.enroll.cond, NX.enroll.lead, NX.enroll.btn], ['正式入學', '累積儲值 10 萬', '想更全面地解決問題，歡迎成為學院的一份子。', '開始入學']);
  assert.equal(NX.share.text, '可以把測驗結果分享給官方 LINE，校長會親自為學姐在之後的學習旅程做更深入的規劃。');
  assert.equal(NX.share.btn, '把結果傳給官方 LINE');
  assert.deepEqual([NX.consult.name, NX.consult.cond, NX.consult.cue], ['一對一諮詢', '至尊以上', '想處理更深層、困擾已久的問題']);
  assert.equal(NX.b2, '測驗結果是一份起點參考；更完整的了解，會在上課和諮詢裡慢慢展開。');
  assert.deepEqual(NX.light.map((o) => [o.name, o.sheet, o.tab || '']), [['先逛逛', 'follow', ''], ['先體驗', 'study', 'sampler']]);
});

test('用字：不推薦課程、不寫資料蒐集、不用「穩不穩」的說法、稱呼用妳／學姐', () => {
  const t = allCopy().join('\n');
  assert.doesNotMatch(t, /季度深談日|決策底層邏輯|從執行者到佈局者|推薦.*課|建議.*課程/);
  assert.doesNotMatch(t, /資料|蒐集|收集|個資|紀錄/);
  assert.doesNotMatch(t, /還可以更穩|不夠穩|不太穩|只差|缺的是|不必只靠|校長親自帶領|首次儲值|100,000/);
  assert.doesNotMatch(t, /你|您/);
  assert.match(NX.ability['基礎累積'].b1, /還有往上提升的空間/);
});

test('銜接句：能力健檢四個階段帶入最需補強；七項平均用平均版', () => {
  for (const s of STAGES) {
    for (const low of ABILITIES) {
      const b = bridge('ability', ab(s.name, ABILITIES.find((x) => x !== low), low));
      assert.equal(b.hi, low); assert.ok(b.text.includes(low), `${s.name}/${low}`);
      assert.equal(b.text, NX.ability[s.name].b1.replace('{X}', low));
      assert.doesNotMatch(b.text, /\{|\}/);
    }
    const e = bridge('ability', ab(s.name, null, null, true));
    assert.deepEqual(e, { text: NX.ability[s.name].even, hi: '' });
    assert.match(e.text, /^七項能力/);
  }
  assert.equal(bridge('ability', ab('基礎累積', '表達溝通', '規劃佈局')).text, '做法已經有了，規劃佈局還有往上提升的空間。把強項練成習慣、把弱項補上來，長期有系統地學最有效。');
});

test('銜接句：職涯定位六個主角色，一律「偏向〇〇的妳」', () => {
  for (const p of ROLES) {
    const b = bridge('career', { primary: p, secondary: ROLES.find((x) => x !== p) });
    assert.equal(b.hi, p); assert.ok(b.text.startsWith(`偏向${p}的妳，`), b.text);
    assert.doesNotMatch(b.text, /妳是/);
  }
  assert.deepEqual(bridge('career', { primary: '不存在' }), { text: '', hi: '' });
});

test('日期格式 yyyy.mm.dd', () => {
  assert.equal(ymd(AT), '2026.10.24');
  assert.equal(ymd(new Date(2027, 0, 5).getTime()), '2027.01.05');
  assert.match(ymd(), /^\d{4}\.\d{2}\.\d{2}$/);
});

test('傳給官方 LINE：訊息只含測驗名稱、結果與日期', () => {
  assert.equal(shareText('ability', ab('整合成形', '品牌經營', '自我管理'), AT),
    '校長好，這是我的 G.R.A.C.E 能力健檢結果：\n階段：整合成形\n最強能力：品牌經營\n最需補強：自我管理\n測驗日期：2026.10.24');
  assert.equal(shareText('ability', ab('基礎累積', null, null, true), AT),
    '校長好，這是我的 G.R.A.C.E 能力健檢結果：\n階段：基礎累積\n能力分布：七項平均\n測驗日期：2026.10.24');
  assert.equal(shareText('career', { primary: '實踐者', secondary: '引導者' }, AT),
    '校長好，這是我的 G.R.A.C.E 職涯定位結果：\n主角色：實踐者\n副角色：引導者\n測驗日期：2026.10.24');
});

test('傳給官方 LINE：網址為 oaMessage/@52grace/?<編碼訊息>；過長改開官方帳號頁', () => {
  assert.equal(OA_MSG, 'https://line.me/R/oaMessage/@52grace/?');
  assert.equal(OA_URL, 'https://line.me/R/ti/p/@52grace');
  for (const [kind, r] of [['ability', ab('全面發揮', '表達溝通', '品牌經營')], ['career', { primary: '洞察者', secondary: '實踐者' }]]) {
    const u = shareUrl(kind, r, AT);
    assert.ok(u.startsWith(OA_MSG), u);
    const q = u.slice(OA_MSG.length);
    assert.match(q, /^[A-Za-z0-9%\-_.!~*'()]+$/, '整段 encodeURIComponent');
    assert.equal(decodeURIComponent(q), shareText(kind, r, AT));
    assert.ok(q.length <= SHARE_MAX);
    assert.doesNotThrow(() => new URL(u));
  }
  assert.equal(shareUrl('career', { primary: '洞察者'.repeat(200), secondary: '實踐者' }, AT), OA_URL);
  assert.equal(shareUrl('career', { primary: '\uD800', secondary: '實踐者' }, AT), OA_URL);   /* 無法編碼 */
});

test('quiz.js：下一步去向與按鈕代號；舊的身分分頁已移除', async () => {
  const Q = await import('../../assets/js/quiz.js');
  assert.deepEqual(Q.NEXT_DEST, { enroll: ['study', 'academy'], consult: ['consult', ''], browse: ['follow', ''], try: ['study', 'sampler'] });
  assert.equal(Q.OA_URL, OA_URL);
  const js = readFileSync(new URL('../../assets/js/quiz.js', import.meta.url), 'utf8');
  for (const ev of ['quiz.enroll', 'quiz.share_line', 'quiz.go.consult', 'quiz.backend']) assert.ok(js.includes(`data-ev="${ev}"`), ev);
  assert.ok(js.includes('data-ev="quiz.go.${o.id}"'));
  assert.doesNotMatch(js, /qz-tab-|qz-pane-|我還沒入學|onEnroll/);
  const v6 = readFileSync(new URL('../../assets/js/v6.js', import.meta.url), 'utf8');
  assert.match(v6, /initQuiz\(\{ onOpen,/);
});
