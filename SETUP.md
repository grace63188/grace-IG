# grace-ig 上線設定說明

文件日期：2026.10.22

## 功能概要

- **網站內容**：資源平台簡化版——「現在」即時資訊＋六個入口（開始測驗、前往上課、查看活動、收看直播、追蹤動態、預約諮詢），點開為流程卡片
- **網站網址**：`https://grace63188.github.io/grace-IG/`
- **PODCAST 更新**：每天台北時間約 06:07 讀取 Apple Podcasts，把最新一集寫入 `data/podcast.json`
- **直播更新**：每月最後一天台北 23:00 讀取 Google 日曆一次，只取標題為「IG直播」的行程，把下個月整月的場次寫入 `data/live.json`（最多 40 場）
- **月中異動**：月中新增或改動行程時，到「Actions」手動執行一次；手動執行會載入本月剩餘＋下個月
- **變更才提交**：資料沒變時不產生 commit；直播的 commit 訊息固定為「更新 IG直播 時間」
- **失敗保護**：讀取失敗時保留原本的 JSON；網站另有內嵌預設值，資料檔讀不到時照常顯示
- **保持啟用**：每週檢查一次，最後一次 commit 超過 50 天時自動推送空 commit，避免排程被 GitHub 停用

## 行事曆隱私

- **取用範圍**：只取標題為「IG直播」的行程；比對時全形轉半形、去除空白、不分大小寫（「IG直播」「IG 直播」「ig直播」「ＩＧ直播」皆可）
- **裝飾符號**：頭尾的表情符號、星號與一層括號會先去掉再比對（「⭐《IG直播》」「《IG直播》」「【IG直播】」「IG直播 🔴」皆可）
- **完全相等**：去掉裝飾後需完全相等，例如「校長IG直播」「IG直播準備會議」「《IG直播》｜主題」不會被取用
- **診斷模式**：手動執行時可把 diag 設為 1，執行紀錄會多印總筆數、落在時間窗的筆數、近似標題的時間與結構資訊（全天、重複、是否完全相等），以及網址是否為主要／次要日曆、私人／公開網址的是／否；不會印出任何標題文字、網址或日曆識別碼
- **重複行程**：支援每日、每週、每月（每月幾號、每月第 n 個週幾）；全天行程不會被取用
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
- **重複設定**：可使用「每天」「每週」「每月」等重複，以及「結束於某日／重複 N 次」
- **取消單場**：直接刪除該場（選「這個活動」），或把該場改成其他標題；月底前要讓網站立即移除，請手動執行一次
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

## 測驗前登入與事件

- **設定檔案**：`data/hub.json`（欄位依資料中心 CONTRACT.md）：`gas`、`lineChannelId`、`googleClientId`、`redirectUri`、`ipEndpoint`；`index.html` 的 `#hub-config` 為內嵌預設值，`data/hub.json` 有值的欄位會覆蓋它
- **示範模式**：`gas` 留空時自動啟用——登入以模擬帳號「示範學員」完成、事件只存本機佇列不送出，測驗照常可做
- **LINE 回呼**：`redirectUri` 必須與 LINE Developers 的 Callback URL 完全相同（含 `?auth=line`），路徑大小寫也要與網站網址一致
- **Google 登入**：Google Cloud「已授權的 JavaScript 來源」填 `https://grace63188.github.io`；按下 Google 登入時才載入 Google 登入元件
- **登入告知**：登入鍵下方說明取得 LINE／Google 名稱、大頭貼與電子郵件及用途，並連到 `privacy.html`（隱私權政策；LINE 電子郵件權限申請可附此頁與登入畫面截圖）
- **加入官方 LINE**：學院官方帳號 @52grace 與 LINE Login channel 分屬不同 provider，`bot_prompt` 無法帶出加好友；LINE 登入後改顯示「加入 @52grace」次鍵（新分頁）
- **本機資料**：裝置 id `gh.did`、訪客 token `gh.vt`、登入者 `gh.person`、事件佇列 `gh.q`、靜音選擇 `grace.snd.v1`
- **音效**：全部以 Web Audio 即時合成，無外部音檔；首次點擊後才會發聲，右上角可靜音並記住選擇
- **測試**：`node --test scripts/tests/*.test.mjs` 另含 `track.test.mjs`，檢查每個元素代號都對應到資料中心事件白名單
