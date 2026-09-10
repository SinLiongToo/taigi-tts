(() => {
  const el = id => document.getElementById(id);
  const hanziInput = el('hanziInput');
  const tailoInput = el('tailoInput');
  const numericInput = el('numericInput');
  const detailRow = el('detailRow');
  const dictStatus = el('dictStatus');
  const reloadDictBtn = el('reloadDictBtn');
  const playBtn = el('playBtn');
  const stopBtn = el('stopBtn');
  const downloadBtn = el('downloadBtn');
  const downloadStatus = el('downloadStatus');
  const manualLinks = el('manualLinks');
  const manualLinksList = el('manualLinksList');
  const schemeRadios = document.querySelectorAll('input[name="scheme"]');
  const tailoLabel = el('tailoLabel');
  const customFileInput = el('customFileInput');
  const customStatus = el('customStatus');
  const clearCustomBtn = el('clearCustomBtn');
  const audioFileInput = el('audioFileInput');
  const audioStatus = el('audioStatus');
  const clearAudioBtn = el('clearAudioBtn');
  const themeToggle = el('themeToggle');
  const helpToggle = el('helpToggle');
  const helpPanel = el('helpPanel');
  const speedSelect = el('speedSelect');

  helpToggle.addEventListener('click', () => {
    helpPanel.hidden = !helpPanel.hidden;
    if (!helpPanel.hidden) helpPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  const tokenEditor = el('tokenEditor');
  const tokenEditorWarning = el('tokenEditorWarning');
  const tokenEditorHanzi = el('tokenEditorHanzi');
  const tokenEditorChoices = el('tokenEditorChoices');
  const tokenEditorTrs = el('tokenEditorTrs');
  const tokenEditorAudio = el('tokenEditorAudio');
  const tokenEditorError = el('tokenEditorError');
  const tokenEditorSave = el('tokenEditorSave');
  const tokenEditorCancel = el('tokenEditorCancel');
  const sourceIndicator = el('sourceIndicator');

  // ---------- 明亮／深色模式 ----------
  const THEME_KEY = 'taigi-tts-theme';

  function getStoredTheme() {
    try { return localStorage.getItem(THEME_KEY); } catch { return null; }
  }
  function setStoredTheme(v) {
    try { localStorage.setItem(THEME_KEY, v); } catch { /* 私密瀏覽等情境略過即可 */ }
  }
  function systemPrefersDark() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function effectiveTheme() {
    const stored = getStoredTheme();
    return stored === 'light' || stored === 'dark' ? stored : (systemPrefersDark() ? 'dark' : 'light');
  }
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    themeToggle.textContent = theme === 'dark' ? '☀️ 明亮' : '🌙 深色';
  }
  themeToggle.addEventListener('click', () => {
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    setStoredTheme(next);
    applyTheme(next);
  });
  applyTheme(effectiveTheme());

  let lastSeg = { sourceKind: 'hanzi', rawTokens: [] }; // 最近一次的斷詞結果
  let commonTokens = [];
  let debounceTimer = null;
  let playState = { playing: false, abort: false, audio: null };

  function currentScheme() {
    return document.querySelector('input[name="scheme"]:checked').value; // 'tailo' | 'poj'
  }

  // ---------- 斷詞 ----------

  // 判斷是不是漢字（含罕用字擴展區），用來分辨「辭典沒收錄的漢字」（該警示、可點擊補讀音）
  // 跟「單純的標點、數字、英文」（不必警示，原樣顯示就好）。
  function isHanChar(ch) {
    const cp = ch.codePointAt(0);
    return (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf) ||
      (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0x20000 && cp <= 0x2ffff);
  }

  // 漢字輸入：以辭典詞條做「由長到短」的貪婪比對斷詞。
  function segmentHanzi(text) {
    const chars = Array.from(text);
    const tokens = [];
    const maxLen = Math.max(1, Dict.getMaxWordLen());
    let i = 0;
    while (i < chars.length) {
      let matched = null, matchLen = 0;
      const upper = Math.min(maxLen, chars.length - i);
      for (let len = upper; len >= 1; len--) {
        const candidate = chars.slice(i, i + len).join('');
        const entries = Dict.lookupWord(candidate);
        if (entries && entries.length) { matched = { hanzi: candidate, entries }; matchLen = len; break; }
      }
      if (matched) {
        tokens.push({ type: 'word', hanzi: matched.hanzi, entries: matched.entries, choice: 0 });
        i += matchLen;
      } else if (isHanChar(chars[i])) {
        // 辭典沒收錄的漢字：當成「未解析」的詞，讓它在畫面上可以被點擊、補上讀音。
        tokens.push({ type: 'word', hanzi: chars[i], entries: [], choice: 0 });
        i += 1;
      } else {
        tokens.push({ type: 'literal', text: chars[i] });
        i += 1;
      }
    }
    return mergeLiterals(tokens);
  }

  // 羅馬字輸入（全羅或數字調皆可，Romanize.parse 會自動判斷）：以空白切詞、'-' 切音節。
  function segmentRomanization(text) {
    const parts = text.split(/(\s+)/);
    const tokens = [];
    for (const part of parts) {
      if (part === '') continue;
      if (/^\s+$/.test(part)) { tokens.push({ type: 'literal', text: part }); continue; }
      const sylls = part.split(/-+/);
      const parsed = sylls.map(s => Romanize.parse(s));
      if (parsed.length && parsed.every(Boolean)) {
        const key = Romanize.wordToKey(parsed);
        const matches = Dict.lookupRom(key);
        tokens.push({ type: 'word', parsedSylls: parsed, hanziMatches: matches, choice: 0 });
      } else {
        tokens.push({ type: 'literal', text: part });
      }
    }
    return mergeLiterals(tokens);
  }

  function mergeLiterals(tokens) {
    const out = [];
    for (const t of tokens) {
      const prev = out[out.length - 1];
      if (t.type === 'literal' && prev && prev.type === 'literal') prev.text += t.text;
      else out.push(t);
    }
    return out;
  }

  // ---------- 斷詞結果 -> 三種輸出共用的中介資料 ----------

  function toCommonTokens(rawTokens, sourceKind) {
    return rawTokens.map(token => {
      if (token.type === 'literal') return { type: 'literal', text: token.text };

      if (sourceKind === 'hanzi') {
        if (!token.entries.length) {
          return {
            type: 'word', hanzi: token.hanzi, tailoMark: '', pojMark: '', numeric: '',
            audioUrl: null, reading: '', custom: false, alternatives: [], choice: 0,
            rawToken: token, unresolved: true, hanziKnown: true
          };
        }
        const entry = token.entries[token.choice] || token.entries[0];
        const altTrs = entry.trs.split('/')[0].trim();
        const parsedSylls = Romanize.parseWord(altTrs);
        if (!parsedSylls) return { type: 'literal', text: token.hanzi };
        return {
          type: 'word',
          hanzi: token.hanzi,
          tailoMark: Romanize.wordToTailoMark(parsedSylls),
          pojMark: Romanize.wordToPojMark(parsedSylls),
          numeric: Romanize.wordToNumeric(parsedSylls),
          audioUrl: Dict.resolveAudioUrl(entry),
          reading: entry.reading,
          custom: !!entry.custom,
          alternatives: token.entries,
          choice: token.choice,
          rawToken: token
        };
      }

      // sourceKind === 'rom'
      const numeric = Romanize.wordToNumeric(token.parsedSylls);
      const tailoMark = Romanize.wordToTailoMark(token.parsedSylls);
      const pojMark = Romanize.wordToPojMark(token.parsedSylls);
      const matches = token.hanziMatches;
      if (matches && matches.length) {
        const m = matches[token.choice] || matches[0];
        return {
          type: 'word', hanzi: m.hanzi, tailoMark, pojMark, numeric,
          audioUrl: Dict.resolveAudioUrl(m), reading: m.reading, custom: !!m.custom,
          alternatives: matches, choice: token.choice, rawToken: token
        };
      }
      return {
        type: 'word', hanzi: `〔${numeric}〕`, tailoMark, pojMark, numeric,
        audioUrl: null, reading: '', custom: false, alternatives: [], choice: 0, rawToken: token,
        unresolved: true, hanziKnown: false
      };
    });
  }

  function buildOutputs(tokens) {
    const scheme = currentScheme();
    const hanziOut = tokens.map(t => t.type === 'word' ? t.hanzi : t.text).join('');
    const romKey = scheme === 'poj' ? 'pojMark' : 'tailoMark';
    const romOut = tokens
      .map(t => t.type === 'word' ? t[romKey] : t.text.trim())
      .filter(Boolean)
      .join(' ');
    const numOut = tokens
      .map(t => t.type === 'word' ? t.numeric : t.text.trim())
      .filter(Boolean)
      .join(' ');
    return { hanziOut, romOut, numOut };
  }

  // ---------- 畫面更新 ----------

  function setIfNotFocused(input, value) {
    if (document.activeElement !== input) input.value = value;
  }

  function updateSourceIndicator() {
    if (!lastSeg.rawTokens.length) { sourceIndicator.textContent = ''; return; }
    const label = lastSeg.sourceKind === 'hanzi' ? '全漢字' : '全羅／數字調';
    sourceIndicator.textContent = `目前以「${label}」欄位為準往回推算——想改成以羅馬字為主，直接編輯全羅或數字調欄位即可。`;
  }

  function render() {
    commonTokens = toCommonTokens(lastSeg.rawTokens, lastSeg.sourceKind);
    const { hanziOut, romOut, numOut } = buildOutputs(commonTokens);
    setIfNotFocused(hanziInput, hanziOut);
    setIfNotFocused(tailoInput, romOut);
    setIfNotFocused(numericInput, numOut);
    updateSourceIndicator();
    renderDetail();
    updatePlayAvailability();
  }

  function renderDetail() {
    detailRow.innerHTML = '';
    if (!commonTokens.length) return;
    commonTokens.forEach((t, idx) => {
      if (t.type === 'literal') {
        detailRow.appendChild(document.createTextNode(t.text));
        return;
      }
      const span = document.createElement('span');
      span.className = 'tok' + (t.unresolved ? ' unresolved' : '') + (t.custom ? ' custom' : '') + (t.alternatives.length > 1 ? ' multi' : '');
      span.dataset.idx = String(idx);
      span.textContent = t.hanzi;
      span.title = t.unresolved
        ? '辭典未收錄，點擊補上讀音／音檔'
        : `讀音：${t.reading || '—'}｜${t.tailoMark}｜點擊修改讀音`;
      span.addEventListener('click', () => openTokenEditor(t, idx));
      detailRow.appendChild(span);
    });
  }

  // ---------- 點擊詞條修正讀音／音檔 ----------
  // 這是「轉換錯可以修改、辭典沒收錄會警示且可以自己補」的入口：不管原本是漢字選錯讀音、
  // 羅馬字沒對應到任何漢字，或整個字辭典根本沒有，都用同一個面板處理，存起來時一律寫進
  // 自訂詞庫（疊加在官方資料上、下次還在），所以「改一次、之後都對」。

  function showEditorError(msg) {
    tokenEditorError.textContent = msg;
    tokenEditorError.hidden = false;
  }

  function renderTokenEditorChoices(t) {
    tokenEditorChoices.innerHTML = '';
    if (!t.alternatives || t.alternatives.length <= 1) { tokenEditorChoices.hidden = true; return; }
    tokenEditorChoices.hidden = false;
    t.alternatives.forEach((alt, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'choice-chip' + (i === t.choice ? ' active' : '');
      btn.textContent = `${alt.reading || '讀音'}：${alt.trs}`;
      btn.addEventListener('click', () => {
        t.rawToken.choice = i;
        closeTokenEditor();
        render();
      });
      tokenEditorChoices.appendChild(btn);
    });
  }

  function openTokenEditor(t, idx) {
    tokenEditorWarning.hidden = !t.unresolved;
    tokenEditorHanzi.value = (t.unresolved && t.hanziKnown === false) ? '' : t.hanzi;
    tokenEditorTrs.value = t.numeric || '';
    tokenEditorAudio.value = '';
    tokenEditorError.hidden = true;
    renderTokenEditorChoices(t);
    tokenEditor.hidden = false;
    tokenEditor.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function closeTokenEditor() {
    tokenEditor.hidden = true;
  }

  tokenEditorCancel.addEventListener('click', closeTokenEditor);

  tokenEditorSave.addEventListener('click', async () => {
    const hanzi = tokenEditorHanzi.value.trim();
    const trs = tokenEditorTrs.value.trim();
    tokenEditorError.hidden = true;

    if (!hanzi) return showEditorError('請填寫漢字（沒有對應漢字也可以自己取一個代表寫法）');
    if (!trs) return showEditorError('請填寫羅馬字或數字調讀音');
    if (!Romanize.parseWord(trs)) return showEditorError('這個讀音格式看不懂，請確認拼法／調號（可用教育部台羅、白話字，或數字調）');

    tokenEditorSave.disabled = true;
    try {
      let audioFilename = '';
      const file = tokenEditorAudio.files[0];
      if (file) {
        await Dict.importAudioFiles([file]);
        audioFilename = file.name;
        updateAudioStatus();
      }
      await Dict.addCustomEntry({ hanzi, trs, audio: audioFilename, note: '使用者修正' });
      updateCustomStatus();
      closeTokenEditor();
      refreshFromCurrentFields();
    } catch (err) {
      showEditorError('儲存失敗：' + err.message);
    } finally {
      tokenEditorSave.disabled = false;
    }
  });

  function updatePlayAvailability() {
    const hasAudio = commonTokens.some(t => t.type === 'word' && t.audioUrl);
    playBtn.disabled = !hasAudio || playState.playing;
    downloadBtn.disabled = !hasAudio || playState.playing;
    manualLinks.hidden = true;
    downloadStatus.textContent = '';
  }

  // ---------- 輸入事件 ----------

  function handleInput(fieldKind, text) {
    if (fieldKind === 'hanzi') {
      lastSeg = { sourceKind: 'hanzi', rawTokens: Dict.isLoaded() ? segmentHanzi(text) : [{ type: 'literal', text }] };
    } else {
      lastSeg = { sourceKind: 'rom', rawTokens: segmentRomanization(text) };
    }
    render();
  }

  function onFieldInput(fieldKind, inputEl) {
    return () => {
      clearTimeout(debounceTimer);
      const text = inputEl.value;
      debounceTimer = setTimeout(() => handleInput(fieldKind, text), 200);
    };
  }

  hanziInput.addEventListener('input', onFieldInput('hanzi', hanziInput));
  tailoInput.addEventListener('input', onFieldInput('rom', tailoInput));
  numericInput.addEventListener('input', onFieldInput('rom', numericInput));

  schemeRadios.forEach(r => r.addEventListener('change', () => {
    tailoLabel.textContent = currentScheme() === 'poj' ? '全羅（白話字 POJ）' : '全羅（教育部台羅）';
    render();
  }));

  // ---------- 語音播放（依序播放萌典真人錄音音檔） ----------
  //
  // 這些是個別錄的單字（各自獨立的引用調），串接播放時沒有連續語流會有的連讀變調，
  // 聽起來本來就不會像一句流暢的話——這點沒辦法用時間軸調整解決，是音檔來源本身
  // 的性質（辭典單字真人錄音，不是連續語音合成）。這裡能做、也做了的兩件事：
  // 1. 提早幫下一個字預先載入，去掉「載入延遲」造成的卡頓／死空白；
  // 2. 依標點給不同停頓長度（詞與詞之間幾乎不停、逗號稍停、句號停更久），
  //    讓節奏更接近正常斷句朗讀，而不是每個字等長間隔像唱名。

  const GAP_WORD_MS = 60;
  const GAP_CLAUSE_MS = 180;   // ，、
  const GAP_SENTENCE_MS = 380; // 。！？；

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // 把目前解析結果轉成播放序列：每個項目附上「播放前要停多久」，
  // 停頓長度取自它前面（上一個詞之後）出現過的標點裡最長的那個。
  function buildPlaySequence() {
    const seq = [];
    let pendingGap = 0;
    commonTokens.forEach((t, idx) => {
      if (t.type === 'literal') {
        if (/[。！？；]/.test(t.text)) pendingGap = Math.max(pendingGap, GAP_SENTENCE_MS);
        else if (/[，、,]/.test(t.text)) pendingGap = Math.max(pendingGap, GAP_CLAUSE_MS);
        return;
      }
      if (t.type === 'word' && t.audioUrl) {
        seq.push({ t, idx, gapBefore: seq.length ? (pendingGap || GAP_WORD_MS) : 0 });
        pendingGap = 0;
      }
    });
    return seq;
  }

  function makeAudio(url) {
    const audio = new Audio(url);
    audio.preload = 'auto';
    audio.playbackRate = parseFloat(speedSelect.value) || 1;
    audio.load();
    return audio;
  }

  function playOne(audio) {
    return new Promise(resolve => {
      playState.audio = audio;
      audio.addEventListener('ended', resolve, { once: true });
      audio.addEventListener('error', () => resolve(), { once: true }); // 單一音檔失敗不中斷整句
      audio.play().catch(() => resolve());
    });
  }

  async function playSequence() {
    const seq = buildPlaySequence();
    if (!seq.length) return;

    playState.playing = true;
    playState.abort = false;
    playBtn.disabled = true;
    stopBtn.disabled = false;

    // 全部預先建立、開始載入，這樣播到第 5、6 個字時它早就在背景載完了，
    // 不會因為當下才去要求載入而卡一下。
    const audios = seq.map(item => makeAudio(item.t.audioUrl));

    for (let i = 0; i < seq.length; i++) {
      if (playState.abort) break;
      const { idx, gapBefore } = seq[i];
      if (gapBefore) await sleep(gapBefore);
      if (playState.abort) break;

      const span = detailRow.querySelector(`[data-idx="${idx}"]`);
      if (span) span.classList.add('playing');
      await playOne(audios[i]);
      if (span) span.classList.remove('playing');
    }

    playState.playing = false;
    stopBtn.disabled = true;
    updatePlayAvailability();
  }

  playBtn.addEventListener('click', playSequence);
  stopBtn.addEventListener('click', () => {
    playState.abort = true;
    if (playState.audio) playState.audio.pause();
    stopBtn.disabled = true;
  });

  // ---------- 下載語音（WAV） ----------
  // 只有「使用者自己上傳的音檔」（本機 blob，同源）或剛好開放 CORS 的外部
  // 網址才能被程式讀取、合併成一個檔案；萌典官方辭典音檔沒有開放 CORS，
  // 遇到時會合併失敗，改用逐字連結讓使用者自行另存。

  function renderManualLinks(seq) {
    manualLinksList.innerHTML = '';
    seq.forEach(t => {
      const a = document.createElement('a');
      a.href = t.audioUrl;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = t.hanzi;
      manualLinksList.appendChild(a);
    });
    manualLinks.hidden = false;
  }

  downloadBtn.addEventListener('click', async () => {
    const seq = commonTokens.filter(t => t.type === 'word' && t.audioUrl);
    if (!seq.length) return;

    downloadBtn.disabled = true;
    manualLinks.hidden = true;
    downloadStatus.textContent = '準備中…（讀取並合併音檔）';

    try {
      const blob = await AudioExport.combineToWav(seq.map(t => t.audioUrl));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'taigi-speech.wav';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      downloadStatus.textContent = `已下載合併語音檔（WAV，共 ${seq.length} 個詞）`;
    } catch (err) {
      downloadStatus.textContent = '無法自動合併下載：內容包含萌典官方辭典音檔，該伺服器不開放程式讀取（不是本工具的限制）。已在下方列出個別連結，請自行開啟後用瀏覽器另存；或改用 python serve.py 開啟本頁即可直接合併下載，見右上角「❓ 說明」。';
      renderManualLinks(seq);
    } finally {
      downloadBtn.disabled = false;
    }
  });

  // ---------- 辭典載入 ----------

  async function initDict(forceRefresh) {
    reloadDictBtn.disabled = true;
    dictStatus.textContent = '辭典載入中…';
    try {
      const result = await Dict.load({
        forceRefresh,
        onProgress: p => { dictStatus.textContent = `辭典下載中… ${Math.round(p * 100)}%`; }
      });
      const customNote = result.customCount ? `，另有 ${result.customCount.toLocaleString()} 筆自訂詞` : '';
      dictStatus.textContent = (result.fromCache
        ? `辭典已就緒（快取，共 ${result.wordCount.toLocaleString()} 詞）`
        : `辭典已就緒（共 ${result.wordCount.toLocaleString()} 詞，已快取供下次使用）`) + customNote;
      updateCustomStatus();
      updateAudioStatus();
      // 辭典就緒後，若欄位已有內容但先前因辭典未就緒只能原樣顯示，重新斷詞一次。
      refreshFromCurrentFields();
    } catch (err) {
      dictStatus.textContent = '辭典載入失敗：' + err.message + '（羅馬字互轉仍可使用，但無法查漢字／播放語音）';
    } finally {
      reloadDictBtn.disabled = false;
    }
  }

  // 用 lastSeg.sourceKind（而不是「哪個欄位有字就用哪個」）決定要用哪個欄位重新斷詞，
  // 因為漢字欄位在 rom 來源、查無對應時顯示的是 〔數字調〕 佔位字串，不是真的漢字——
  // 若改用「哪個欄位有內容」判斷，補完自訂詞後重新整理會誤把那串佔位文字當漢字輸入解析。
  function refreshFromCurrentFields() {
    if (lastSeg.sourceKind === 'hanzi') {
      if (hanziInput.value.trim()) handleInput('hanzi', hanziInput.value);
    } else {
      if (numericInput.value.trim()) handleInput('rom', numericInput.value);
      else if (tailoInput.value.trim()) handleInput('rom', tailoInput.value);
    }
  }

  function updateCustomStatus() {
    const n = Dict.customCount();
    customStatus.textContent = n ? `已載入 ${n.toLocaleString()} 筆自訂詞條` : '尚未匯入自訂詞庫';
    clearCustomBtn.disabled = !n;
  }

  reloadDictBtn.addEventListener('click', () => initDict(true));

  customFileInput.addEventListener('change', async () => {
    const file = customFileInput.files[0];
    customFileInput.value = ''; // 允許重複選同一個檔案再次觸發 change
    if (!file) return;
    try {
      const text = await file.text();
      const result = await Dict.importCustom(text, file.name);
      let msg = `已匯入 ${result.added} 筆（目前共 ${result.total} 筆自訂詞條）`;
      if (result.errors.length) msg += `，${result.errors.length} 筆解析失敗：${result.errors.slice(0, 3).join('；')}${result.errors.length > 3 ? '…' : ''}`;
      customStatus.textContent = msg;
      clearCustomBtn.disabled = false;
      refreshFromCurrentFields();
    } catch (err) {
      customStatus.textContent = '匯入失敗：' + err.message;
    }
  });

  clearCustomBtn.addEventListener('click', async () => {
    await Dict.clearCustom();
    updateCustomStatus();
    refreshFromCurrentFields();
  });

  function updateAudioStatus() {
    const n = Dict.audioCount();
    audioStatus.textContent = n ? `已上傳 ${n.toLocaleString()} 個自訂音檔` : '尚未上傳自訂音檔';
    clearAudioBtn.disabled = !n;
  }

  audioFileInput.addEventListener('change', async () => {
    const files = audioFileInput.files;
    if (!files || !files.length) return;
    const result = await Dict.importAudioFiles(files);
    audioFileInput.value = '';
    updateAudioStatus();
    refreshFromCurrentFields(); // 讓已經在畫面上、剛好對應到這些檔名的詞條重新解析出音檔
  });

  clearAudioBtn.addEventListener('click', async () => {
    await Dict.clearAudio();
    updateAudioStatus();
    refreshFromCurrentFields();
  });

  stopBtn.disabled = true;
  playBtn.disabled = true;
  initDict(false);
})();
