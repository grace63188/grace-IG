/* 自我測驗票券：點擊、Enter、空白鍵，或把票根往右拖過 44px，都會撕下票根（約 1.2 秒儀式）後開啟測驗。
   拖曳只是加分手勢，單擊永遠可用（WCAG 2.5.7）。減少動態時改為約 0.36 秒淡出淡入。 */
import { $$, reduced, buzz } from './core.js';

const T_TEAR = 1200, T_RM = 360, PULL = 44;

export function initTickets(quiz) {
  $$('.ticket').forEach((btn) => {
    const wrap = btn.closest('.tk-wrap');
    const stub = btn.querySelector('.tk-stub');
    let x0 = null, dx = 0, dragged = false;

    const tear = () => {
      if (btn.dataset.busy) return;
      btn.dataset.busy = '1';
      buzz(14);
      wrap.classList.remove('dragging');
      wrap.classList.add('is-tearing');
      setTimeout(() => {
        quiz.open(btn.dataset.quiz, btn);
        setTimeout(() => { wrap.classList.remove('is-tearing'); wrap.style.removeProperty('--dx'); wrap.style.removeProperty('--rot'); delete btn.dataset.busy; }, 400);
      }, reduced() ? T_RM : T_TEAR - 300);
    };

    /* 攔截原本的開啟：先播儀式，再開測驗 */
    btn.addEventListener('click', (e) => {
      e.stopImmediatePropagation();
      if (dragged) { dragged = false; return; }
      tear();
    }, { capture: true });
    /* 拖曳後若瀏覽器沒有補發 click（觸控移動常見），下一次真正的點擊不能被吞掉 */
    const clearDrag = () => setTimeout(() => { dragged = false; }, 80);

    /* 拖曳票根：橫向跟手，超過門檻即撕下；未達門檻放開則回位 */
    stub.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || btn.dataset.busy) return;
      x0 = e.clientX; dx = 0;
      stub.setPointerCapture(e.pointerId);
    });
    stub.addEventListener('pointermove', (e) => {
      if (x0 == null) return;
      dx = Math.max(0, Math.min(72, e.clientX - x0));
      if (dx > 4) { wrap.classList.add('dragging'); wrap.style.setProperty('--dx', dx + 'px'); wrap.style.setProperty('--rot', (dx / 6).toFixed(1) + 'deg'); }
    });
    const end = () => {
      if (x0 == null) return;
      x0 = null;
      if (dx >= PULL) { dragged = true; tear(); }
      else { wrap.classList.remove('dragging'); wrap.style.removeProperty('--dx'); wrap.style.removeProperty('--rot'); if (dx > 4) dragged = true; }  /* 未達門檻：回彈 */
      clearDrag();
    };
    stub.addEventListener('pointerup', end);
    stub.addEventListener('pointercancel', () => { x0 = null; dragged = false; wrap.classList.remove('dragging'); wrap.style.removeProperty('--dx'); wrap.style.removeProperty('--rot'); });
  });
}
