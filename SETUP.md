# grace-ig 上線設定說明

文件日期：2026.10.22

## 功能概要

- **網站內容**：全平台總覽簡化版——「現在」即時資訊＋六個入口（開始測驗、前往上課、查看活動、收看直播、追蹤動態、預約諮詢），點開為流程卡片
- **網站網址**：`https://grace63188.github.io/grace-ig/`
- **PODCAST 更新**：每天台北時間約 06:07 讀取 Apple Podcasts，把最新一集寫入 `data/podcast.json`
- **直播更新**：每小時第 13 分讀取 Google 日曆，只取標題為「IG直播」的行程，把未來 60 天內最多 5 場寫入 `data/live.json`
- **變更才提交**：資料沒變時不產生 commit；直播的 commit 訊息固定為「更新 IG直播 時間」
- **失敗保護**：讀取失敗時保留原本的 JSON；網站另有內嵌預設值，資料檔讀不到時照常顯示
- **保持啟用**：每週檢查一次，最後一次 commit 超過 50 天時自動推送空 commit，避免排程被 GitHub 停用

## 行事曆隱私

- **取用範圍**：只取標題為「IG直播」的行程；比對時去除空白、不分大小寫（「IG直播」「IG 直播」「ig直播」皆可）
- **完全相等**：標題需完全等於「IG直播」，例如「IG直播準備會議」不會被取用
- **其他行程**：其他行程的標題、時間、地點、說明、參加者都不會寫入 repo、網站、commit 訊息或執行紀錄
- **輸出欄位**：每場只有標題（固定「IG直播」）、開始、結束、連結（固定校長 IG）；行程內的說明、地點、連結不會帶出
- **執行紀錄**：只顯示「IG直播 n 場」與成功／失敗，不顯示行事曆網址；錯誤訊息也只顯示固定分類

## Actions 權限

- **開啟設定**：進入 `https://github.com/grace63188/grace-ig` →「Settings」→「Actions」→「General」
- **寫入權限**：「Workflow permissions」選「Read and write permissions」→「Save」
- **用途說明**：排程需要寫入權限才能把更新後的 JSON push 回 repo

## 行事曆密鑰

- **取得網址**：電腦開啟 Google 日曆 → 左側要使用的日曆右邊「⋮」→「設定和共用」→「整合日曆」→ 複製「私人網址（iCal 格式）」（結尾為 `basic.ics`）
- **新增密鑰**：repo「Settings」→「Secrets and variables」→「Actions」→「New repository secret」
- **填寫名稱**：Name 填 `LIVE_ICS_URL`（大小寫需完全一致）
- **填寫內容**：Secret 貼上剛剛複製的私人網址 →「Add secret」
- **保密原則**：私人網址等同密碼，不要貼到網站、群組或文件；外洩時在同一處按「重設」產生新網址，再更新這個 secret
- **未設定時**：直播排程顯示提示並正常結束，不修改 `data/live.json`
- **帳號限制**：看不到私人網址時，通常是 Google Workspace 管理員關閉了此功能，需請管理員開啟或改用個人 Gmail 帳號的日曆

## Pages 來源

- **開啟設定**：repo「Settings」→ 左側「Pages」
- **來源設定**：「Build and deployment」→「Source」選「Deploy from a branch」
- **分支設定**：「Branch」選 `main`、資料夾選 `/ (root)` →「Save」
- **用途說明**：排程 push 新的 JSON 後，Pages 才會自動重新部署

## 手動執行

- **進入頁面**：repo 上方「Actions」分頁
- **啟用排程**：首次進入若出現啟用提示，按「I understand my workflows, go ahead and enable them」
- **直播流程**：左側點「更新 IG直播 時間」→ 右側「Run workflow」→ 分支選 `main` →「Run workflow」
- **PODCAST 流程**：左側點「更新 PODCAST 最新一集」→ 同樣執行一次
- **查看結果**：綠色勾勾為成功；紅色叉叉點進去看錯誤分類
- **確認資料**：成功後到 `data/live.json`、`data/podcast.json` 查看內容
- **網站生效**：push 後 GitHub Pages 約 1–3 分鐘重新部署

## 新增直播

- **行程標題**：在設定為密鑰的那個日曆新增行程，標題填「IG直播」
- **設定時段**：填開始與結束時間，不要勾選「全天」；全天行程沒有開播時間，會被略過
- **重複設定**：可使用「每週」「每天」等重複，以及「結束於某日／重複 N 次」
- **取消單場**：直接刪除該場（選「這個活動」），或把該場改成其他標題，網站下次更新時移除
- **網站顯示**：網站一律顯示「IG直播」與時間，連結固定為校長 IG

## 本地測試

- **執行指令**：在 repo 根目錄執行 `node --test scripts/tests/*.test.mjs`（需 Node 20 以上，不需網路、不需安裝套件）
- **測試資料**：範例 RSS 與 ICS 位於 `scripts/fixtures/`（皆為假資料）
- **隱私測試**：`scripts/tests/live_privacy.test.mjs` 驗證私人行程不會出現在輸出與執行紀錄

## 日常維護

- **排程延遲**：GitHub 排程在尖峰時段可能延遲數分鐘到數十分鐘，偶爾略過一次，屬正常現象
- **停用提醒**：公開 repo 連續 60 天沒有 commit 時 GitHub 會停用排程；「排程保持啟用」流程會在第 50 天後自動補空 commit。若仍收到停用通知，到「Actions」點該流程按「Enable workflow」
- **失敗通知**：排程失敗時 GitHub 會寄信到帳號信箱；可在 GitHub 個人「Settings」→「Notifications」→「Actions」調整
- **活動與諮詢**：限時活動與諮詢項目在 `data/content.json`，`index.html` 底部的內嵌預設值需同步修改
