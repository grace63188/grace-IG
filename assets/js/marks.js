/* 測驗徽記（24×24 網格，外圈半徑 9.4–9.6；主線 1.5、細刻線 1.0）；規格見 mockup_v15/switch/
   - 能力健檢＝七面切割（寶石俯視切工：外框七邊、桌面七邊錯開半格、冠部刻面），章色墨藍灰 #45526B
   - 職涯定位＝角色羅盤（刻度＋指針），章色銅 #A85B3C
   - 一律 currentColor（顏色由 CSS 的 --acc 決定）；fill＝桌面／指針填淡色（.fill） */
const C = 12, f2 = (n) => n.toFixed(2);
const pt = (r, i, n = 7, rot = -90) => { const a = (rot + i * 360 / n) * Math.PI / 180; return [C + r * Math.cos(a), C + r * Math.sin(a)]; };
const poly = (r, n = 7, rot = -90) => [...Array(n)].map((_, i) => pt(r, i, n, rot).map(f2).join(',')).join(' ');
const svg = (body) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;

function gem(fill) {
  const facets = [...Array(7)].map((_, i) => {
    const [ox, oy] = pt(9.4, i), [ax, ay] = pt(4.4, i, 7, -90 - 360 / 14), [bx, by] = pt(4.4, i, 7, -90 + 360 / 14);
    return `<path d="M${f2(ax)} ${f2(ay)}L${f2(ox)} ${f2(oy)}L${f2(bx)} ${f2(by)}" stroke-width="1" stroke-opacity=".55"/>`;
  }).join('');
  return svg(`<polygon points="${poly(9.4)}"/>${facets}<polygon class="${fill ? 'fill' : ''}" points="${poly(4.4, 7, -90 + 360 / 14)}"/>`);
}
function dial(fill) {
  const ticks = [0, 45, 90, 135, 180, 225, 270, 315].map((d) => {
    const a = d * Math.PI / 180, r1 = d % 90 ? 8.2 : 7.4, r2 = 9.6;
    return `<path d="M${f2(C + r1 * Math.cos(a))} ${f2(C + r1 * Math.sin(a))}L${f2(C + r2 * Math.cos(a))} ${f2(C + r2 * Math.sin(a))}"${d % 90 ? ' stroke-opacity=".45"' : ''}/>`;
  }).join('');
  return svg(`<circle cx="12" cy="12" r="9.6" stroke-opacity=".5"/>${ticks}<path class="${fill ? 'fill' : ''}" d="M12 12L16.6 6.4 13.3 13.4Z"/><path d="M12 12L7.4 17.6" stroke-opacity=".55"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/>`);
}

/** 徽記 SVG 字串：k＝ability｜career；fill＝填淡色的版本（入場券、首頁票券用） */
export const mark = (k, fill = false) => (k === 'career' ? dial(fill) : gem(fill));
/** 章色（與後台圖表同色） */
export const ACC = { ability: '#45526B', career: '#A85B3C' };
/** 入場券說明句 */
export const SUB = { ability: '看見七項能力的分布', career: '找到妳的角色傾向' };
