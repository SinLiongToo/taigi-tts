---
name: run-taigi-tts
description: Launch and drive the 台語文字轉語音 (Taiwanese Hokkien text-to-speech) static web app in this repo — a plain HTML/CSS/JS page with no build step. Use this whenever asked to run, test, screenshot, or verify a change to index.html/app.js/dict.js/romanize.js/export.js/style.css in this project.
---

# Running 台語文字轉語音

This is a single static page (`index.html` + `romanize.js`/`dict.js`/`export.js`/`app.js`/`style.css`),
no build step, no `package.json`, not a git repo. "Running" it means serving the folder and driving
it with a headless browser — plain `<script>` tags loaded in this exact order matter
(`romanize.js` → `dict.js` → `export.js` → `app.js`), so opening the file directly and clicking
around isn't enough to catch load-order or global-scope bugs; use the Playwright pattern below.

## Serve

```bash
cd "<project dir>"
python -m http.server 8791 &   # or: py -m http.server 8791 on some Windows setups
# poll instead of sleeping blindly:
curl -sf http://localhost:8791/index.html -o /dev/null && echo up
```

To test the download-button "merge official moedict audio" path specifically, use
`python serve.py 8791` instead of `python -m http.server` — it's the same static file
server plus a `/proxy-audio/<id>.mp3` route that routes around moedict's missing CORS
headers (see `export.js` and `CLAUDE.md` for why that route exists and why it must stay
narrowly scoped). Sanity-check the proxy itself before trusting a browser test against it:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8791/proxy-audio/05588.mp3  # expect 200
```

Stop when done (Windows — killing by port, since `kill %1` doesn't reliably work across
Git Bash/python.exe on this platform):

```powershell
$procId = (Get-NetTCPConnection -LocalPort 8791 -ErrorAction SilentlyContinue).OwningProcess | Select-Object -Unique
if ($procId) { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue }
```

Run that via the PowerShell tool directly, not by shelling out to `powershell.exe` from Bash —
Bash interpolates `$_`/`$procId`-style tokens itself before PowerShell ever sees them and silently
corrupts the command.

## Drive it: Playwright, not chromium-cli

`chromium-cli` (the tool the generic `run` skill points to first) is not available in this
Windows environment. Use Playwright directly instead:

```bash
cd <scratch dir>            # NOT the project dir — keep test deps out of the repo
npm init -y
npm install playwright@1.63.0
npx playwright install chromium   # first time only; may already be cached
```

Write a throwaway `.js` file in the scratch dir (avoid `node -e "..."` with Chinese text or
backslash-heavy Windows paths inline — quoting through Git Bash mangles both; a real file is
reliable) and run it with plain `node`. Minimal shape:

```js
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://localhost:8791/index.html');
  // dictionary download (~8MB from GitHub raw) + IndexedDB build takes a few seconds:
  await page.waitForFunction(
    () => /已就緒|失敗/.test(document.getElementById('dictStatus').textContent),
    { timeout: 60000 }
  );
  await page.fill('#hanziInput', '食飯');
  await page.waitForTimeout(500); // app debounces input ~200ms before re-segmenting
  console.log(await page.inputValue('#tailoInput'));   // expect: tsia̍h pn̄g
  console.log(await page.inputValue('#numericInput')); // expect: tsiah8 png7
  console.log('errors:', errors);
  await browser.close();
})();
```

`page.waitForFunction(fn, arg, options)` — if you need a custom timeout and `fn` takes no
argument, you must still pass `undefined` as the second parameter, e.g.
`waitForFunction(fn, undefined, { timeout: 90000 })`. Passing `{ timeout: 90000 }` as the second
argument silently becomes `arg` instead of `options` and you get the default 30s timeout — this
has bitten every long-running-playback test in this project.

## Known-good assertions (use these as smoke checks)

- `#dictStatus` reaches `/已就緒|失敗/` — dictionary loaded (14,489 words as of the
  g0v/moedict-data-twblg snapshot used).
- `食飯` → 全羅 `tsia̍h pn̄g`, 數字調 `tsiah8 png7` (two known dictionary words, not a compound,
  so they render space-separated).
- `你食飽未` → segments as `你 / 食飽 / 未` (tests greedy longest-match word segmentation against
  a real multi-character dictionary entry, `食飽`).
- Custom dictionary import: `page.setInputFiles('#customFileInput', <path to
  custom-dictionary-example.json>)`, then `#customStatus` should read
  `已匯入 3 筆（目前共 3 筆自訂詞條）`.
- Local audio upload: `page.setInputFiles('#audioFileInput', <path to an mp3>)` after importing a
  custom entry that references that exact filename in its 音檔 field — `#playBtn` disabled
  attribute should flip from present to `null` once matched.
- Download button under plain `http.server` (no proxy): for text using only official moedict
  audio, expect `#manualLinksList` to get populated with fallback links (CORS blocks the merge —
  this is expected and correct, not a bug, see `export.js`'s header comment and CLAUDE.md). For
  text using only custom-uploaded local audio, expect an actual `download` event with a
  non-trivial `.wav` file size regardless of which server is running.
- Download button under `serve.py`: official moedict audio should now *also* produce a real
  `download` event (no fallback links) — confirms the `/proxy-audio/` route is being hit. If it
  still falls back under `serve.py`, check the proxy responded 200 first before assuming an app
  bug (see the `curl` sanity check above).
- Clicking any token in `#detailRow` opens `#tokenEditor` (it does not cycle readings directly
  anymore — that was the old behavior before the per-token correction editor existed). Existing
  dictionary alternatives show up as `.choice-chip` buttons inside the editor; click one of those
  to actually change the reading. `.tok.unresolved` (辭典未收錄字/romanization with no hanzi match)
  opens the same editor with `#tokenEditorWarning` visible and fields pre-filled for a fresh entry.

## Gotchas specific to this project

- **The dictionary source is fetched live from `raw.githubusercontent.com`** on first load of a
  fresh browser profile/IndexedDB — tests need real network access and the ~60s timeout above, not
  a shorter one.
- **Never assert on `r2-assets.moedict.tw` audio bytes.** `fetch()` to it throws (`Failed to
  fetch`), and even routing an `<audio>` element through Web Audio API produces silence
  (`MediaElementAudioSource outputs zeroes due to CORS access restrictions` in the console) — this
  was verified empirically, not assumed. Only assert on it via `<audio>` playback (network
  `response` events, or `ended` firing), never via decoded sample data.
- **UTF-8 URLs through `curl` from Git Bash mangle silently** — use `curl -G --data-urlencode` or
  percent-encode by hand when hitting `moedict.tw`'s API directly outside the app.
- Windows path interpolation for Node scripts: build paths with `path.join(projectDir, ...)`
  using a JS string constant for the project dir, rather than trying to inline a
  Chinese-character Windows path through several layers of shell quoting.
