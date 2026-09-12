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
  `computeSandhiSyllables()` 的變調範圍是**逐詞判斷**，不是整句／整個子句一起判斷：
  每個辭典詞、或用 `-`／`--` 接起來的羅馬字組，只有該詞自己最後一個音節維持本調
  （`wordFinal`），不管後面接了什麼字——這是刻意的設計決定（v1.11.0 修的 bug 就是
  之前誤用「遇標點斷句、整個子句一起變調」的舊邏輯，導致像「學校」這種二字詞後面
  接別的字時，自己的尾字「校」被誤判成非組末而跟著變調），對照使用者的參考變調工具
  明訂的「N 音節逐詞規則：詞內除最後一字都變調，最後一字維持本調」「一字組完全不
  變調」。連帶結果：由多個「各自查得到的一字詞」組成的句子（例如「我食飯」三個字
  都各自是辭典裡的一字詞）現在會整句都維持本調不變調——這不是 bug，是套用「一字組
  不變調」規則後的正確結果，使用者已經確認過這個行為要保留，不要因為跟語感（一般
  連續變調的整句感覺）有落差就改回整句判斷。三疊字偵測（連續三個本調完全相同的
  音節）是唯一允許跨詞界的例外，因為使用者實測過「分開打三個單音節詞」也要能觸發
  三疊字規則。判斷優先順序：先偵測三疊字、再處理輕聲（`.neutral` 標記），最後才是
  「詞內逐字判斷 wordFinal」的一般規則——這個優先順序不要打亂。分組仍然是「遇標點
  就斷句」的簡化版（只影響三疊字偵測要不要跨越標點），沒有處理巢狀輕聲、超過三字
  的疊字這類更少見的情況，不要因為某句話的參考結果跟語感有落差就當成 bug 硬改，
  先確認是不是本來就沒涵蓋的特殊情況。
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
- **`makeAudio()` 裡 `audio.playbackRate` 一定要在 `audio.load()` 之後設定，不能在之前。**
  踩過的坑：瀏覽器的 `HTMLMediaElement.load()` 會把 `playbackRate` 重設回 1——原本的寫法是
  先設定 `playbackRate` 再呼叫 `load()`，等於白設，導致語速選單從第一版到 v1.13.0 都其實
  沒有真的生效過（不管選哪個速度，實際播放永遠是 1×），只是沒人用 Playwright 直接檢查過
  真正在播放的 `<audio>` 元素本身的 `playbackRate` 屬性，光看畫面（速度數字有變、UI 有反應）
  看不出來。已經實測驗證過：`load()` 前設定會在 `load()` 完後被重設回 1，`load()` 後設定
  則會在整個載入過程（`loadedmetadata`、`canplay`）中正確保留。以後任何要改這段音檔建立
  邏輯的地方，都要留意這個順序，不要因為「反正看起來能動」就假設語速真的有作用，要實際
  攔截 `.play()` 呼叫當下的 `playbackRate` 值來確認。
- **`style.css` 開頭有一條 `[hidden] { display: none !important; }`，不要拿掉。** 踩過的坑：
  `.token-editor` 自己設了 `display: flex`（沒有 `!important`），跟瀏覽器內建的
  `[hidden] { display: none }` UA 樣式比，author 樣式規則永遠贏過 UA 樣式規則（同樣是一般
  優先度時，origin 排序在 specificity 之前，不是比誰的選擇器更精確），導致 `#tokenEditor`
  設了 `hidden` 屬性、JS 也確實有設，但整塊編輯區塊從頁面一載入就 `display:flex`、實際
  佔位顯示出來（已經用 Playwright 量過 `getComputedStyle().display` 跟 `offsetHeight`
  實測驗證過）。任何以後新增的元件，只要會用 `display` 之類的 CSS 屬性去 style 一個會被
  JS 切換 `hidden` 屬性／`.hidden = true/false` 的元素，都要注意這個陷阱——現在已經用
  全站 `[hidden]` 規則統一擋掉，不要再對個別元素加 `display: none` 的例外處理，也不要因為
  「這條規則好像沒用到」就刪掉它。
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
  就會失效。**`removeCustomEntry(index)`（「查看自訂詞庫」列表的單筆刪除）用的是同一套
  「重讀官方快取、再把剩下的 rows 重新套一次 `applyCustomEntries`」模式，不要改成直接從
  `state.wordIndex`/`state.romIndex` 挖掉那一筆**——`unshift` 進去的 entry 沒有保留是哪個
  row 加的，直接挖容易挖錯、或漏掉同一漢字的其他 heteronym，「重讀再套一次」雖然多做一點
  事，但保證跟 `clearCustom()` 一樣正確。「查看自訂詞庫」的匯出（`exportCustomWithAudio`）
  刻意把本機音檔轉成 base64 `data:` URL 直接內嵌進匯出的 JSON，不是額外包一個 zip 或另外
  匯出音檔案——這是因為 `resolveAudioUrl`／`applyCustomEntries` 本來就把 `audio` 欄位開頭是
  `data:` 的字串當成可直接播放的網址處理，所以「匯出→（換瀏覽器／裝置）→匯入」這個備份
  流程完全不需要新的匯入程式碼，直接用既有的「匯入自訂詞庫」就會把讀音跟音檔一起讀回來。
  不要因為「檔案變大（base64 多佔 1/3）」就想著改成分開匯出音檔案，這個工具的自訂詞庫規模
  （幾十到幾百筆）不會因為這樣有感的變慢，換來的是單一檔案就是完整備份，不用額外管理一堆
  音檔案，這是刻意的取捨。
- `app.js` 的 `toCommonTokens` / `render` 是同步的（設計選擇：早期版本考慮過把音檔解析
  做成 async，後來為了不讓整個渲染鏈變 async 而改成同步查 `audioMap`）；`Dict.resolveAudioUrl`
  因此也必須維持同步。
- **點擊詞條修正（`openTokenEditor` / `Dict.addCustomEntry`）是「破音字切換」「辭典未收錄警示」
  「使用者修正讀音」三件事共用的同一個入口**，不是三個獨立功能。`segmentHanzi` 對辭典查不到
  的真漢字（`isHanChar` 判斷，排除標點數字）會產生 `entries:[]` 的 word token 而不是 literal
  token，讓它在畫面上可點擊；`toCommonTokens` 對這種情況跟 rom 來源查無漢字的情況都會標
  `unresolved:true`。改動這段時，維持「一律存進 `custom` store、一律用 `addCustomEntry`」，
  不要另外做一條「僅這次生效、不存檔」的路徑，使用者是為了「改一次以後都對」才用這個功能的。
  **`addCustomEntry` 會先用 `wordKeyOf`（骨架＋調號，不看表面拼法）比對「同一個漢字＋同一個
  實際讀音」是否已經存在，存在就直接取代那一筆，不是單純 concat 新增。** 踩過的坑：使用者
  點一個「已經存進自訂詞庫、但漏了音檔」的詞，重新打開編輯面板補上音檔存檔，原本行為是
  多存一筆（舊的沒音檔那筆繼續留著），「查看自訂詞庫」列表因此會看到同一個詞重複兩筆，
  一筆永遠沒音檔——不要改回單純 `concat`。判斷「同一個讀音」不能只比對 `trs` 字串是否相等：
  同一個實際讀音可能因為使用者這次用了不同的拼寫系統（白話字 `soan1` vs 教育部台羅
  `suan1`，骨架調號相同）而字串不同，一定要透過 `Romanize.parseWord` + `wordToKey` 正規化
  後再比對。取代時記得整個重讀官方快取再套一次完整的 merged rows（跟 `removeCustomEntry`
  同一套模式）——單純把新的 row `unshift` 進 state 不會把舊的那筆從 `wordIndex`/`romIndex`
  裡拿掉。真正不同讀音（`wordKeyOf` 比對不同，例如破音字）要維持新增成獨立一筆，不能跟著
  被取代，不然會壞掉「一個漢字可以有多個讀音、用 chips 切換」的功能。
- **`tokenEditorSave` 存檔時若沒有選音檔案，會呼叫 `app.js` 的 `autoSynthesizeAudio(parsed)`
  自動嘗試合成一個音檔，不是單純留空。** 作法：把這個詞當成獨立一個 word token 丟進
  `computeSandhiSyllables` 算出它自己的變調（word-internal，跟畫面上單獨打這個詞會顯示的
  「變調後」列一樣），再用 `findAudioCandidates` 找同音候選（先整詞查、查不到才逐音節查），
  找到就丟給 `AudioExport.combineToWav`（跟「下載語音」合併下載同一支函式，內部一樣會經過
  `fetchAudioBytes` 的三層 CORS 繞過機制）合併成一個 WAV，再用 `Dict.importAudioFiles`
  存成使用者自訂音檔（檔名 `auto-<timestamp>-<random>.wav`）。任何一步找不到或讀不到位元組
  （沒有 serve.py／Cloudflare Worker）都要吞掉、回傳「沒有音檔」，不能讓存檔這個動作本身
  失敗——讀音有沒有存到跟音檔合不合成得出來是兩件事，不要耦合在一起。
  **重要：`findAudioCandidates` 回傳的是「所有」同音候選，不是只有第一個，因為辭典資料裡
  列了音檔 id 不代表教育部真的錄過那個字的單字音——「單字不成詞者不單獨錄音」是教育部
  錄音時的既定原則（見 README「資料來源」），實測過真實案例：「台」變調後 tāi7 跟「代」
  同音，辭典資料裡「代」確實有 id，但那個 id 對應的檔案在 `r2-assets.moedict.tw` 上直接
  404，不是代理伺服器的問題（直接打 Cloudflare Worker 跟官方來源都驗證過，Worker 本身
  正常，只是上游真的沒有這個檔案）。所以只挑第一個候選、假設「有 id 就等於有錄音」是錯的，
  一定要用 `findWorkingAudioUrl` 依序實際 `fetchAudioBytes` 試抓過，抓不到就換下一個候選字，
  全部候選都抓不到那個音節才算失敗。這個「試抓、失敗換下一個」的邏輯只用在自動合成這條
  路徑（本來就是非同步、本來就會真的發 fetch）——`applyAudioFallback`（畫面即時播放）維持
  用只挑第一個候選的 `findAudioMatch`，不要比照套用，因為那條路徑是同步的架構，沒辦法在
  決定要不要用某個候選之前先真的發 fetch 確認位元組抓不抓得到，這是已知、刻意接受的限制，
  不是還沒修的 bug。**存檔前一定要先呼叫
  `Dict.findCustomAudio(hanzi, trs)` 檢查這個詞是不是已經有音檔（自己上傳或先前自動合成
  的都算）**，有的話直接沿用那個值，不要再嘗試合成或留空——`tokenEditorAudio` 這個
  `<input type="file">` 出於瀏覽器安全限制，每次重新打開編輯面板一定是空的（沒辦法用 JS
  預填某個檔案），所以「這次沒選檔案」絕對不能直接當成「這個詞沒有音檔」，不然使用者只是
  想順手修正漢字拼法、重新存檔一次，就會把原本好好的真人錄音换成借來的替代品，甚至直接
  清空——這是這個功能唯一容易踩到的坑，改這段時務必連著測「已經有音檔的詞，不選檔案、
  改別的欄位重新存檔」這個情境，不能只測「全新的詞、沒有音檔」那一種。
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
