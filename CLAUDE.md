# CLAUDE.md

給日後在這個 repo 工作的 Claude 看的專案規則。專案本身介紹見 [README.md](README.md)。

## 專案性質

單一網頁工具（台語文字轉語音），純前端、無建置流程，部署在 GitHub Pages（純靜態託管，
沒有後端執行環境）。四支 `.js` 用一般 `<script>` 標籤依序載入，不是 ES module：
`romanize.js` → `dict.js` → `export.js` → `app.js`，彼此靠全域變數（`Romanize` / `Dict` /
`AudioExport`）溝通。改動載入順序或把任一支改成 `type="module"` 會壞掉 `file://` 直接開檔
的用法，不要做。

`serve.py` 只能在使用者自己電腦上跑（`python serve.py`），GitHub Pages 上沒有作用——
Pages 不能執行 Python，`/proxy-audio/` 路徑在 Pages 上就是單純的 404。為了讓部署在
Pages 上的版本也能用，另外有 `cloudflare-worker.js`（選用、使用者自行部署到自己的
Cloudflare 帳號），`export.js` 的 `EXTERNAL_PROXY_BASE` 常數填了那個 Worker 網址才會啟用
第三層 fallback。三層都失敗（或該常數留空）就照舊丟錯，呼叫端改列個別連結——這是預期
行為，不需要因為「這層退化了」而特別做什麼，README／`❓ 說明`都已經寫清楚。

## 硬性限制（不要違反）

- **不要加外部 CDN／npm 依賴到 `index.html`。** 這是刻意的設計，讓使用者能直接雙擊開檔、
  離線也部分可用。如果真的需要一個函式庫，先跟使用者確認。
- **不要假設 `fetch()` 能讀到 `r2-assets.moedict.tw` 的音檔位元組。** 那台伺服器沒開 CORS，
  `<audio>` 播放沒問題，但 `fetch()`／`decodeAudioData`／接進 `MediaRecorder` 都會被瀏覽器
  擋成靜音或直接丟錯（已經實測驗證過，見 `export.js` 開頭註解）。這不是本專案能修的東西，
  下載合併功能因此只對「使用者自己上傳的本機音檔」（`blob:`，同源）保證有效，對官方辭典
  音檔會走「個別連結另存」的備援路徑——維持這個行為，不要嘗試「修好」合併下載官方音檔。
- **音檔網址一律 `<audio>` 元素播放，絕不用 `fetch()` 播放邏輯**（除非明確只處理
  已確認同源／CORS 開放的來源，例如 `export.js` 的合併下載）。
- 繞過上面那條 CORS 限制，只有兩種合法解法，`export.js` 的 `fetchAudioBytes` 依序
  試：本機 `serve.py`（同源 `/proxy-audio/<id>.mp3`）、使用者自己部署的
  `cloudflare-worker.js`（`EXTERNAL_PROXY_BASE` 指到的網址）。兩者都失敗才 throw。
  **不要**改成串接任何「別人架的」公用 CORS proxy（corsproxy.io 之類）——這兩層都是
  使用者自己控制的基礎設施（自己電腦、自己的 Cloudflare 帳號），音檔不會經過使用者
  不認識的第三方，這是刻意的隱私／信任邊界，不是還沒做完；串進一個別人的公用 proxy
  會打破這個邊界，不要做。`serve.py` 的 `PROXY_PATH_RE` 跟 `cloudflare-worker.js` 的
  路徑判斷都只放行 `/audio/<1-6位數字>.mp3` 這個固定樣式，不要改成轉發任意網址，
  那樣會變成開放中繼站。

## 資料流／架構重點

- `romanize.js`：純函式，教育部台羅／白話字互轉＋變音標⇄數字調互轉。內部一律先正規化成
  「台羅骨架」（ASCII，`ts/tsh/oo/nn/ua/ue/ing/ik`），輸出時才轉成目標書寫系統。改動調號
  標示規則前，先看檔案開頭的優先順序註解（a > oo/o· > e > o > iu/ui > i > u > m > ng），
  這是教育部台羅的官方規則，不是隨便訂的。
- `dict.js`：官方辭典下載一次後存進 IndexedDB（db `taigi-tts-dict`，目前版本 3，三個
  object store：`cache` 官方索引、`custom` 使用者匯入的詞庫原始 rows、`audioBlobs` 使用者
  上傳的本機音檔）。**改資料庫結構要 bump 版本號並在 `onupgradeneeded` 用
  `objectStoreNames.contains` 檢查後再建立**，維持對舊使用者既有資料非破壞性升級的寫法。
  資料實際上是 g0v/moedict-data-twblg 的兩個檔案合併：`dict-twblg.json`（常用詞，約
  7.7MB）+ `dict-twblg-ext.json`（補充詞，約 2.8MB），`fetchRaw()` 依序下載兩個再
  `.concat()` 起來一起丟給 `buildIndex()`——這兩個檔案是同一個資料來源專案裡本來就存在
  的兩份資料，不是額外找的第三方資料集，如果以後真的要再加別的資料源，要先確認格式
  是否相容、有沒有清楚的授權，不要假設隨便一個 JSON 都能直接 concat 進來。**改動下載的
  檔案組合（加減任何一份資料）要 bump `CACHE_KEY`**（目前 `dict-twblg-v2`），道理跟資料庫
  結構升級一樣：不 bump 的話，已經快取過 v1 的舊使用者會永遠讀到舊的、缺資料的快取，
  不會自動撿到新增的詞。
- 自訂詞庫用 `unshift` 插到辭典陣列最前面，讓自訂讀音變預設、但官方讀音還在陣列後面可以
  點擊切換——不要改成覆蓋／刪除官方資料，那樣 `clearCustom()`（靠重讀 `cache` store 復原）
  就會失效。
- `app.js` 的 `toCommonTokens` / `render` 是同步的（設計選擇：早期版本考慮過把音檔解析
  做成 async，後來為了不讓整個渲染鏈變 async 而改成同步查 `audioMap`）；`Dict.resolveAudioUrl`
  因此也必須維持同步。
- **點擊詞條修正（`openTokenEditor` / `Dict.addCustomEntry`）是「破音字切換」「辭典未收錄警示」
  「使用者修正讀音」三件事共用的同一個入口**，不是三個獨立功能。`segmentHanzi` 對辭典查不到
  的真漢字（`isHanChar` 判斷，排除標點數字）會產生 `entries:[]` 的 word token 而不是 literal
  token，讓它在畫面上可點擊；`toCommonTokens` 對這種情況跟 rom 來源查無漢字的情況都會標
  `unresolved:true`。改動這段時，維持「一律存進 `custom` store、一律用 `addCustomEntry`」，
  不要另外做一條「僅這次生效、不存檔」的路徑，使用者是為了「改一次以後都對」才用這個功能的。

## 測試方式

沒有測試框架，也不要加一個。這個 repo 也沒有 `package.json`（除非使用者要求）。
驗證改動的方式是：本機起一個靜態伺服器（例如 `python -m http.server`），用
Playwright（透過 `npx playwright`，裝在系統暫存目錄而非專案裡）跑無頭瀏覽器操作腳本，
斷言欄位內容、DOM class、network request、下載事件等。這個模式在開發過程中已經反覆用過、
好用，維持下去；不要把 Playwright 或任何測試依賴寫進專案目錄本身。

## 版本號與修改日誌

`index.html` 的 `.version-info`（頁面最上方）、`#changelogList`（❓ 說明面板裡）、
`README.md` 的「修改日誌」這三個地方要手動同步——沒有建置流程幫忙產生。每次做完一批
使用者看得到的改動，三個地方都要一起更新：版號用簡單遞增（新功能加 minor、修 bug 通常
也是 minor，這個專案還沒到需要嚴格 semver 的規模），日期用當天日期。只改內部程式碼／
文件、使用者感受不到差異的，不必特地bump版本號。

## 風格

- 不寫檔案層級或函式層級的長註解；只在「為什麼」不明顯時留一行（例如調號規則、CORS 限制
  這種）。不要幫每個函式加說明「做什麼」的註解。
- 中文使用者介面文案、程式碼識別字用英文，維持現有慣例。
