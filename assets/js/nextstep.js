/* 結果頁「下一步」：文案、銜接句、傳給官方 LINE 的訊息（純函式，node 測試直接 import）
   - 正式入學固定為主卡；一對一諮詢為更深一步；先逛逛／先體驗為輕量選項；不推薦任何課程
   - 銜接句：能力健檢依階段帶入「最需補強」，七項相同用平均版；職涯定位依主角色，一律「偏向〇〇的妳」
   - 傳給官方 LINE：line.me/R/oaMessage 預填結果摘要（測驗名稱、階段／角色、最強與最需補強或主副角色、測驗日期），
     不含姓名、帳號或其他個人資料；編碼後過長改開官方帳號頁 */
export const OA_ID = '@52grace';
export const OA_URL = `https://line.me/R/ti/p/${OA_ID}`;
export const OA_MSG = `https://line.me/R/oaMessage/${OA_ID}/?`;
export const SHARE_MAX = 1000;                                  /* 編碼後訊息長度上限（字元） */

export const NX = {
  enroll: { name: '正式入學', cond: '累積儲值 10 萬', icon: 'i-cap', lead: '想更全面地解決問題，歡迎成為學院的一份子。', btn: '開始入學' },
  share: { text: '可以把測驗結果分享給官方 LINE，校長會親自為學姐在之後的學習旅程做更深入的規劃。', btn: '把結果傳給官方 LINE' },
  consult: { name: '一對一諮詢', cond: '至尊以上', icon: 'i-chat', cue: '想處理更深層、困擾已久的問題' },
  light: [
    { id: 'browse', name: '先逛逛', cue: '免費內容頻道', icon: 'i-signal', sheet: 'follow' },
    { id: 'try', name: '先體驗', cue: 'Sampler 課程', icon: 'i-tap', sheet: 'study', tab: 'sampler' },
  ],
  lightHead: '還想多看看',
  member: { t: '已是學姐？', link: '到學員後台申請個人進修' },
  b2: '測驗結果是一份起點參考；更完整的了解，會在上課和諮詢裡慢慢展開。',
  /* 能力健檢：{X}＝最需補強；七項分數相同用 even */
  ability: {
    探索起步: { b1: '目前最需補強的是{X}。起步階段最需要的，是有人陪妳把基礎一步步打穩。', even: '七項能力分布平均。起步階段最需要的，是有人陪妳把基礎一步步打穩。' },
    基礎累積: { b1: '做法已經有了，{X}還有往上提升的空間。把強項練成習慣、把弱項補上來，長期有系統地學最有效。', even: '七項能力分布平均，做法也已經有了。把做法練成習慣，長期有系統地學最有效。' },
    整合成形: { b1: '整體已經成形，{X}是下一個能再往上的地方。比起再多試幾堂課，更需要一份針對妳的長期安排。', even: '七項能力分布平均，整體已經成形。比起再多試幾堂課，更需要一份針對妳的長期安排。' },
    全面發揮: { b1: '各項都已成熟，{X}再往上一點，就能把妳的做法帶給更多人。下一段路，適合有人陪妳一起規劃。', even: '七項能力都已成熟，接下來是把妳的做法帶給更多人。下一段路，適合有人陪妳一起規劃。' },
  },
  /* 職涯定位：{P}＝主角色 */
  career: {
    實踐者: '偏向{P}的妳，動手做的時候學得最快。有一份完整的課表，每一步都練得到、看得見。',
    洞察者: '偏向{P}的妳，習慣先弄懂再出發。長期而有系統的學習，最能幫妳把想法變成行動。',
    創作者: '偏向{P}的妳，風格是最大的本錢。有穩定的學習節奏，創作能走得更長、更遠。',
    引導者: '偏向{P}的妳，常常先照顧別人。這一次，也讓別人花點心思，為妳的成長做安排。',
    開創者: '偏向{P}的妳，點子和行動力都很充足。再加上一份長期安排，力氣集中在同一個方向，能走得更遠。',
    統籌者: '偏向{P}的妳，喜歡先看清全貌。一份完整的學習規劃，最適合妳一步步照著走。',
  },
};

/** 銜接句：回傳 { text, hi }，hi＝要以香檳金標示的詞（能力或角色名稱），無則為 '' */
export function bridge(kind, r) {
  if (kind === 'ability') {
    const s = NX.ability[r && r.stage && r.stage.name] || NX.ability['探索起步'];
    if (!r || r.allSame || !r.low) return { text: s.even, hi: '' };
    return { text: s.b1.replace('{X}', r.low), hi: r.low };
  }
  const p = r && r.primary, t = NX.career[p];
  return t ? { text: t.replace('{P}', p), hi: p } : { text: '', hi: '' };
}

/** yyyy.mm.dd（當地時間） */
export function ymd(t) {
  const d = new Date(Number(t) || Date.now());
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

/** 傳給官方 LINE 的預填訊息（只有測驗結果與日期） */
export function shareText(kind, r, at) {
  const lines = kind === 'ability'
    ? ['校長好，這是我的 G.R.A.C.E 能力健檢結果：', `階段：${r.stage.name}`, ...(r.allSame || !r.top ? ['能力分布：七項平均'] : [`最強能力：${r.top}`, `最需補強：${r.low}`])]
    : ['校長好，這是我的 G.R.A.C.E 職涯定位結果：', `主角色：${r.primary}`, `副角色：${r.secondary}`];
  lines.push(`測驗日期：${ymd(at)}`);
  return lines.join('\n');
}

/** 開啟網址：oaMessage 預填；編碼後超過上限改開官方帳號頁 */
export function shareUrl(kind, r, at) {
  let enc = '';
  try { enc = encodeURIComponent(shareText(kind, r, at)); } catch (e) { return OA_URL; }
  return enc && enc.length <= SHARE_MAX ? OA_MSG + enc : OA_URL;
}
