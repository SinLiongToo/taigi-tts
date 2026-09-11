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
  這是教育部台羅的官方規則，不是隨便訂的。同一支檔案的 `sandhiTone(skeleton, tone)` 是
  連讀變調（本調→變調）的規則表，`sandhiTripleFirst(skeleton, tone)` 是三疊字（AAA，
  如「紅紅紅」）第一字的專屬規則——規則來源見 README「資料來源」。`app.js` 的
  `computeSandhiSyllables()` 用「遇主要標點就斷句」當變調組邊界，跨詞界連續變調（不是
  每個詞自己算一組），且優先偵測連續三個本調完全相同的音節套用三疊字規則、再處理輕聲
  （`.neutral` 標記）、最後才是「組末維持本調」的一般規則——這個優先順序不要打亂。分組
  仍然是「遇標點就斷句」的簡化版，沒有處理巢狀輕聲、超過三字的疊字這類更少見的情況，
  不要因為某句話的參考結果跟語感有落差就當成 bug 硬改，先確認是不是本來就沒涵蓋的
  特殊情況。
  **`--` 跟一般 `-` 的差異一定要透過 `Romanize.parseWord()` 才會保留**（`--` 標記後面
  那個音節是輕聲，`.neutral` 欄位）；`parse()`（單音節版本）不處理這個，只有
  `parseWord()`（整詞版本）才會切開 `--`／`-` 並標記。踩過的坑：`app.js` 的
  `segmentRomanization` 原本手動 `core.split(/-+/)` 再逐音節丟給 `Romanize.parse()`，
  跳過了 `parseWord()`，導致使用者在羅馬字欄位直接打的 `--` 永遠不會被辨識成輕聲——
  已經改成呼叫 `parseWord()`。**任何地方要把一串羅馬字文字切成音節陣列，一律呼叫
  `Romanize.parseWord()`，不要自己重新 `split('-')` 再逐一 `parse()`**，不然一樣會
  漏掉輕聲標記這個資訊。`wordToKey()` 刻意不管 `.neutral`（辭典反查用的 key 只看
  骨架＋調號，輕聲不是不同的字），但 `wordToTailoMark()` / `wordToPojMark()` /
  `wordToNumeric()` / `wordToPojNumeric()` 都透過共用的 `joinSylls()` 在輕聲音節前
  輸出 `--`——新增任何組回一整個詞字串的地方，一樣要用 `joinSylls()`，不要自己
  `.join('-')`。
  **重要：這套變調計算不只是給「變調後」參考列顯示用，`app.js` 的 `applyAudioFallback()`
  也拿它來決定播放的音檔**——詞本身若有音檔（`dict.js` 查到的本調錄音）一律優先用；
  只有詞本身沒音檔時，才用它在這句話裡的變調後讀音反查 `Dict.lookupRom()`，找剛好同音
  的別的字，借用那個字的音檔播放（`t.audioFallback` / `t.audioFallbackFrom` 標記，
  detail row 顯示為 `.audio-fallback` 樣式）。播放的仍然是某個字固定的本調錄音（沒有
  即時變調合成這種東西，教育部辭典本身也只錄本調），差別只在於**挑選哪個錄音來用**這一
  步現在會考慮變調後的讀音。改這段時記得：主／副的優先順序（詞本身音檔 > 變調借用）不要
  反過來，也不要在詞本身已經有音檔時還去查變調借用（沒必要，也會讓 `audioFallback` 標記
  失去意義）。`applyAudioFallback()` 分兩層試：先把整個詞（所有音節）合在一起查一次
  （`findAudioMatch(sandhiSylls)`），找到最準；查不到才逐音節分開各自查
  （`sandhiSylls.map(s => findAudioMatch([s]))`），而且**要求每個音節都借得到才採用**——
  不要改成「借到幾個算幾個」，播一半有聲音一半沒聲音的結果比老實顯示查無音檔更糟。逐音節
  借用時一個詞會對應好幾個音檔，所以 `t.audioUrl` 只保留「第一段」給簡單的真假值判斷用
  （`updatePlayAvailability` 之類)，實際要播放／匯出全部片段一律呼叫 `tokenAudioUrls(t)`
  拿到完整陣列——新增任何消費 `t.audioUrl` 的地方，優先檢查是不是該改用
  `tokenAudioUrls(t)`，不要只挑第一段就當作整個詞播完了。
- **`playOne()` 一定要同時監聽 `pause` 事件，不能只等 `ended`／`error`。** 踩過的坑：
  「停止」按鈕呼叫 `audio.pause()`，但 `pause()` 本身不會觸發 `ended` 或 `error`——如果
  `playOne` 的 Promise 只等這兩個事件，播放中途按停止就會讓那個 `await` 永遠不 resolve，
  整個 `playSequence` 卡住，`playState.playing` 永遠是 `true`，播放鍵和停止鍵永遠恢復
  不了（已經實測驗證過：不接 `pause` 事件時，`.pause()` 後 2 秒內 Promise 完全沒有
  resolve）。任何以後要改播放邏輯、或想用 `AbortController` 之類的東西重寫這段，都要
  確認「使用者中途打斷播放」這條路徑真的會讓正在 `await` 的 Promise 走到底，不要只測
  「播完整句」這種正常路徑。
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
- `segmentRomanization` 的 `ATTACHED_PUNCT_RE` 是踩過的坑：使用者貼文章進來時，標點常常
  緊貼在字後面沒有空白（`chok-iong.`、`kò-chō,`），`Romanize.parse` 對這種字串會整個判定
  失敗（因為結尾不是純字母），如果只靠空白切詞會讓整個詞連同標點一起變成無法轉換的文字。
  這支正規式先把頭尾黏著的標點拆成獨立 token，才把中間的「詞本體」拿去解析——改動這段
  斷詞邏輯時，記得用真實貼上的文章（不是乾淨的、詞與詞之間都有空白的範例）測一次。

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
也是 minor，這個專案還沒到需要嚴格 semver 的規模）。`.version-info` 跟頁內 changelog
的時間戳記要含「日期＋時分」（不是只有日期），用 `date "+%Y-%m-%d %H:%M %Z"`（或系統
當地時間）查詢當下實際時間再填，不要用之前 commit 的舊時間、也不要瞎編——README 的
修改日誌沿用只填日期即可（那邊是給人看版本歷史，不需要精確到分鐘）。只改內部程式碼／
文件、使用者感受不到差異的，不必特地bump版本號。
- README「架構圖」章節的兩個 Mermaid 圖，在 `docs/architecture-overview.svg` 和
  `docs/architecture-download.svg` 各有一份預先渲染好的 SVG，讓不連網、或 Markdown
  工具不支援 Mermaid 時也能直接看圖（這是使用者明確要求的，不要覺得「反正 GitHub 上看
  得到」就把 SVG 刪掉）。**改動 README 裡的 Mermaid 原始碼後，一定要重新產生這兩個
  SVG**，指令見 README「架構圖」章節開頭那段——用
  `npx @mermaid-js/mermaid-cli -i <臨時檔>.mmd -o docs/<檔名>.svg -b white`（先把
  README 裡的 mermaid 區塊內容存成暫存的 `.mmd` 檔再餵給它）。兩份 SVG 分別是
  10 萬字元級跟 2 萬字元級的檔案，不要手動編輯，永遠用工具重新產生。

## 風格

- 不寫檔案層級或函式層級的長註解；只在「為什麼」不明顯時留一行（例如調號規則、CORS 限制
  這種）。不要幫每個函式加說明「做什麼」的註解。
- 中文使用者介面文案、程式碼識別字用英文，維持現有慣例。
