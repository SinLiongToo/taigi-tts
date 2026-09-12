(() => {
  const el = id => document.getElementById(id);
  const hanziInput = el('hanziInput');
  const tailoInput = el('tailoInput');
  const numericInput = el('numericInput');
  const detailRow = el('detailRow');
  const sandhiRow = el('sandhiRow');
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
  const numericLabel = el('numericLabel');
  const customFileInput = el('customFileInput');
  const customStatus = el('customStatus');
  const viewCustomBtn = el('viewCustomBtn');
  const clearCustomBtn = el('clearCustomBtn');
  const customViewer = el('customViewer');
  const customViewerList = el('customViewerList');
  const exportCustomBtn = el('exportCustomBtn');
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
  const tokenEditorAudioHint = el('tokenEditorAudioHint');
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

  // 貼上來的文章常常標點直接黏在字後面（沒有空白），例如 "kò-chō,"、"chok-iong."。
  // Romanize.parse 要求整個音節都是合法字母，黏著的標點會讓整個詞解析失敗、
  // 整串原封不動當成文字——所以要先把頭尾黏著的標點拆成獨立的文字 token，
  // 剩下的「詞本體」才拿去解析。
  const ATTACHED_PUNCT_RE = /^([，。！？；：、,.!?;:'"()\[\]{}]*)([\s\S]*?)([，。！？；：、,.!?;:'"()\[\]{}]*)$/;

  // 羅馬字輸入（全羅或數字調皆可，Romanize.parse 會自動判斷）：以空白切詞、'-' 切音節。
  function segmentRomanization(text) {
    const parts = text.split(/(\s+)/);
    const tokens = [];
    for (const part of parts) {
      if (part === '') continue;
      if (/^\s+$/.test(part)) { tokens.push({ type: 'literal', text: part }); continue; }

      const [, lead, core, trail] = part.match(ATTACHED_PUNCT_RE);
      if (lead) tokens.push({ type: 'literal', text: lead });

      if (core) {
        // 用 Romanize.parseWord（不是自己土砲切 - 再逐個丟給 parse）才會保留
        // 「--」輕聲標記；早期這裡手動 split(/-+/) 再逐音節 parse，會把 -- 跟
        // 一般 - 混在一起處理掉，使用者自己打的輕聲標記就再也讀不回來了。
        const parsed = Romanize.parseWord(core);
        if (parsed) {
          const key = Romanize.wordToKey(parsed);
          const matches = Dict.lookupRom(key);
          tokens.push({ type: 'word', parsedSylls: parsed, hanziMatches: matches, choice: 0 });
        } else {
          tokens.push({ type: 'literal', text: core });
        }
      }

      if (trail) tokens.push({ type: 'literal', text: trail });
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
            type: 'word', hanzi: token.hanzi, tailoMark: '', pojMark: '', numericTailo: '', numericPoj: '',
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
          numericTailo: Romanize.wordToNumeric(parsedSylls),
          numericPoj: Romanize.wordToPojNumeric(parsedSylls),
          parsedSylls,
          audioUrl: Dict.resolveAudioUrl(entry),
          reading: entry.reading,
          custom: !!entry.custom,
          alternatives: token.entries,
          choice: token.choice,
          rawToken: token
        };
      }

      // sourceKind === 'rom'
      const numericTailo = Romanize.wordToNumeric(token.parsedSylls);
      const numericPoj = Romanize.wordToPojNumeric(token.parsedSylls);
      const tailoMark = Romanize.wordToTailoMark(token.parsedSylls);
      const pojMark = Romanize.wordToPojMark(token.parsedSylls);
      const matches = token.hanziMatches;
      if (matches && matches.length) {
        const m = matches[token.choice] || matches[0];
        return {
          type: 'word', hanzi: m.hanzi, tailoMark, pojMark, numericTailo, numericPoj,
          parsedSylls: token.parsedSylls,
          audioUrl: Dict.resolveAudioUrl(m), reading: m.reading, custom: !!m.custom,
          alternatives: matches, choice: token.choice, rawToken: token
        };
      }
      return {
        type: 'word', hanzi: `〔${numericTailo}〕`, tailoMark, pojMark, numericTailo, numericPoj,
        parsedSylls: token.parsedSylls,
        audioUrl: null, reading: '', custom: false, alternatives: [], choice: 0, rawToken: token,
        unresolved: true, hanziKnown: false
      };
    });
  }

  function buildOutputs(tokens) {
    const scheme = currentScheme();
    const hanziOut = tokens.map(t => t.type === 'word' ? t.hanzi : t.text).join('');
    const romKey = scheme === 'poj' ? 'pojMark' : 'tailoMark';
    const numKey = scheme === 'poj' ? 'numericPoj' : 'numericTailo';
    const romOut = tokens
      .map(t => t.type === 'word' ? t[romKey] : t.text.trim())
      .filter(Boolean)
      .join(' ');
    const numOut = tokens
      .map(t => t.type === 'word' ? t[numKey] : t.text.trim())
      .filter(Boolean)
      .join(' ');
    return { hanziOut, romOut, numOut };
  }

  // ---------- 連讀變調（僅供參考顯示，不影響播放／其他欄位） ----------
  //
  // 變調組＝整句話裡被主要標點（，。！？；、,.!?;）隔開的一段；組內每個音節都變調，
  // 只有整組最後一個音節維持本調——這個判斷跨詞界，不是每個詞自己算一組（符合真實連讀
  // 變調的行為）。未解析的詞（顯示 〔數字調〕 占位）一樣有 parsedSylls，所以照樣能參與
  // 變調計算；辭典完全查無讀音的漢字（沒有 parsedSylls）則略過，不勉強猜。
  //
  // 兩個特殊規則優先於上面的一般規則：
  // 1. 輕聲（--）：本身是輕聲、或後面緊接輕聲字的音節，維持本調不變調
  //    （輕聲字本身也維持本調顯示，只是連接符號用 -- 標示，不是真的算出一個新調值）。
  // 2. 三疊字（AAA，如「紅紅紅」）：連續三個本調完全相同、都不是輕聲的音節，
  //    優先套用疊字專屬規則（見 romanize.js 的 sandhiTripleFirst），不管它們落在
  //    變調組的哪個位置，這條規則都蓋過「組末維持本調」的一般規則。

  function computeSandhiSyllables(tokens) {
    const groups = [];
    let current = [];
    tokens.forEach((t, tokenIdx) => {
      if (t.type === 'word' && t.parsedSylls) {
        t.parsedSylls.forEach((p, sylIdx) => current.push({
          tokenIdx, sylIdx, skeleton: p.skeleton, tone: p.tone, neutral: !!p.neutral,
          wordFinal: sylIdx === t.parsedSylls.length - 1
        }));
      } else if (t.type === 'literal' && /[，。！？；、,.!?;]/.test(t.text)) {
        if (current.length) { groups.push(current); current = []; }
      }
    });
    if (current.length) groups.push(current);

    const result = new Map(); // "tokenIdx-sylIdx" -> { skeleton, tone }
    const setResult = (syl, out) => result.set(`${syl.tokenIdx}-${syl.sylIdx}`, out);

    groups.forEach(group => {
      let i = 0;
      while (i < group.length) {
        if (i + 2 < group.length &&
            !group[i].neutral && !group[i + 1].neutral && !group[i + 2].neutral &&
            group[i].skeleton === group[i + 1].skeleton && group[i].tone === group[i + 1].tone &&
            group[i].skeleton === group[i + 2].skeleton && group[i].tone === group[i + 2].tone) {
          setResult(group[i], Romanize.sandhiTripleFirst(group[i].skeleton, group[i].tone));
          setResult(group[i + 1], Romanize.sandhiTone(group[i + 1].skeleton, group[i + 1].tone));
          setResult(group[i + 2], { skeleton: group[i + 2].skeleton, tone: group[i + 2].tone });
          i += 3;
          continue;
        }

        const syl = group[i];
        const nextIsNeutral = (i + 1 < group.length) && group[i + 1].neutral && group[i + 1].tokenIdx === syl.tokenIdx;
        const keepBase = syl.wordFinal || syl.neutral || nextIsNeutral;
        setResult(syl, keepBase ? { skeleton: syl.skeleton, tone: syl.tone } : Romanize.sandhiTone(syl.skeleton, syl.tone));
        i += 1;
      }
    });
    return result;
  }

  function buildSandhiOutput(tokens, sandhiMap) {
    const scheme = currentScheme();
    const parts = [];
    tokens.forEach((t, tokenIdx) => {
      if (t.type === 'literal') {
        const trimmed = t.text.trim();
        if (trimmed) parts.push(trimmed);
        return;
      }
      if (!t.parsedSylls) return; // 完全查無讀音，跳過不猜
      // 用數字調（不是變音標）顯示，方便直接跟上面「羅馬字加音調數字」欄位逐字比對哪個調變了；
      // 輕聲音節前用 -- 連接（跟主欄位的呈現方式一致），不是普通的 -。
      const sandhiSylls = t.parsedSylls.map((p, sylIdx) => {
        const s = sandhiMap.get(`${tokenIdx}-${sylIdx}`) || p;
        return { skeleton: s.skeleton, tone: s.tone, neutral: p.neutral };
      });
      const form = scheme === 'poj'
        ? Romanize.joinSylls(sandhiSylls, p => Romanize.toPojNumeric(p.skeleton, p.tone))
        : Romanize.joinSylls(sandhiSylls, p => Romanize.toNumeric(p.skeleton, p.tone));
      parts.push(form);
    });
    return parts.join(' ');
  }

  // 詞本身若已有音檔，優先用它（主）；沒有的話，用它在這句話裡「變調後」實際會讀的音，
  // 反查辭典有沒有別的詞剛好本調就是這個讀音——找到的話借用那個詞的錄音當替代（副），
  // 因為變調後的音，物理上就是那個聲音，跟是哪個詞沒有關係。查無讀音、只有〔數字調〕
  // 占位的詞也適用，正是這個機制在解決的情境（辭典沒收錄、但變調後音接得上別的錄音）。
  //
  // 先試整個詞（所有音節合在一起）查，找到最準；多音節複合詞常常整個詞對不到，
  // 這時改成一個音節一個音節分開查、各自借用同音字錄音接起來播（要全部音節都借得到
  // 才用，不要播一半借到、一半沒聲音的破碎結果——那樣還不如老實顯示查無音檔）。
  function findAudioMatch(sylls) {
    const matches = Dict.lookupRom(Romanize.wordToKey(sylls));
    const hit = matches && matches.find(m => Dict.resolveAudioUrl(m));
    return hit ? { url: Dict.resolveAudioUrl(hit), hanzi: hit.hanzi } : null;
  }

  // 跟 findAudioMatch 差在回傳「所有」候選（不是只挑第一個）——自動合成音檔時要用，
  // 因為辭典資料裡列了 id 不代表教育部真的錄過那個字（「單字不成詞者不單獨錄音」，
  // 見 README「資料來源」），第一個候選的位元組可能根本抓不到，這時要能換下一個
  // 同音候選字繼續試，不是直接放棄整個詞。畫面即時播放（applyAudioFallback）維持
  // 用 findAudioMatch 只挑第一個，因為那條路徑是同步的，沒辦法先逐一實際抓抓看
  // 位元組才決定要不要用（那牽涉真的發 fetch，跟整個 render 鏈同步的設計衝突）。
  function findAudioCandidates(sylls) {
    const matches = Dict.lookupRom(Romanize.wordToKey(sylls));
    if (!matches) return [];
    return matches
      .map(m => ({ url: Dict.resolveAudioUrl(m), hanzi: m.hanzi }))
      .filter(c => c.url);
  }

  // 依序試 candidates，回傳第一個「位元組真的抓得到」的候選；每一個都抓不到才回傳 null。
  async function findWorkingAudioUrl(candidates) {
    for (const c of candidates) {
      try {
        await AudioExport.fetchAudioBytes(c.url);
        return c;
      } catch {
        // 這個候選字的音檔實際上不存在（辭典資料有 id 但教育部沒錄），試下一個
      }
    }
    return null;
  }

  function applyAudioFallback(tokens, sandhiMap) {
    tokens.forEach((t, tokenIdx) => {
      if (t.type !== 'word' || t.audioUrl || !t.parsedSylls) return;
      const sandhiSylls = t.parsedSylls.map((p, sylIdx) => sandhiMap.get(`${tokenIdx}-${sylIdx}`) || p);

      const whole = findAudioMatch(sandhiSylls);
      if (whole) {
        t.audioUrl = whole.url;
        t.audioUrls = [whole.url];
        t.audioFallback = true;
        t.audioFallbackMode = 'whole';
        t.audioFallbackFrom = whole.hanzi;
        return;
      }

      const perSyllable = sandhiSylls.map(s => findAudioMatch([s]));
      if (perSyllable.every(Boolean)) {
        t.audioUrls = perSyllable.map(p => p.url);
        t.audioUrl = t.audioUrls[0];
        t.audioFallback = true;
        t.audioFallbackMode = 'syllable';
        t.audioFallbackFrom = perSyllable.map(p => p.hanzi).join('、');
      }
    });
  }

  // 統一取得一個詞要播放／匯出的音檔清單：多音節借用時是好幾個 URL，其餘情況就是
  // 自己那一個 URL 包成單一元素陣列；沒有音檔就是空陣列。
  function tokenAudioUrls(t) {
    if (t.audioUrls) return t.audioUrls;
    return t.audioUrl ? [t.audioUrl] : [];
  }

  // 使用者補登自訂詞條時若沒有自己上傳音檔，嘗試用「下載語音」合併下載同一套機制
  // （AudioExport.combineToWav + 逐音節借用變調後同音字錄音）自動兜出一個音檔存
  // 起來，讓這個詞不用真的錄音也有得播。跟畫面播放時的 audio-fallback 差別在於：
  // 這裡是「存檔當下」就先合併成一個固定的 WAV 存進 audioBlobs，之後每次播放都是
  // 直接用這個檔案，不用每次重算變調＋重新逐字借用；同時這個詞就算脫離目前這句
  // 上下文（不同句子、不同前後字）也一樣有音檔可用。
  // 找不到可借用的錄音，或合併時讀不到位元組（沒有 serve.py／Cloudflare Worker，
  // 官方音檔的 CORS 限制擋下來）就回傳空字串，維持「留空、使用者可以之後自己補」
  // 的原本行為，不當成阻擋存檔的錯誤。
  async function autoSynthesizeAudio(parsed) {
    const sandhiMap = computeSandhiSyllables([{ type: 'word', parsedSylls: parsed }]);
    const sandhiSylls = parsed.map((p, i) => sandhiMap.get(`0-${i}`) || p);

    try {
      // combineToWav／fetchAudioBytes 內部的 fetch 沒有逾時機制（瀏覽器預設不會自己
      // 斷線），網路狀況不好或代理伺服器沒回應時可能一直卡著——存檔這個動作不能被這個
      // 「錦上添花」的自動合成卡死，逾時就放棄，改成沒有音檔，使用者可以之後自己補。
      // 逾時後底下的 fetch 可能還在跑，就讓它自己跑完丟掉結果，不用特地取消。這個
      // timeout 是「整個自動合成流程」共用的總預算（找候選＋合併都算在內），不是
      // 每一步各自 10 秒。
      const TIMEOUT_MS = 10000;
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS));

      const found = await Promise.race([(async () => {
        // 先試整個詞當一組候選（同音的其他詞可能不只一個），找到一個位元組真的抓得到
        // 的就用；每個候選字的音檔存不存在，只有實際試抓過才知道（辭典資料裡列了 id
        // 不代表教育部真的錄過那個字），所以要逐一試，不是找到第一個「有 id」的就當作
        // 可用。整詞都試過還是不行，才拆開逐音節各自試；逐音節一樣是每個音節各自把
        // 同音候選字試過一輪，全部都抓不到那個音節才整個詞放棄（不要播一半借到、一半
        // 沒聲音的破碎結果，跟 applyAudioFallback 的原則一致）。
        //
        // 每一步（整詞／逐音節）都先試「變調後」的讀音，找不到候選才退而求其次試
        // 「本調（原本的調）」讀音——原因：變調後的調值常常根本不是任何字的「本調」
        // （例如「看」khàn 本調第3聲，變調後是第2聲，但教育部辭典裡沒有任何字本調
        // 剛好是 khan2，因為 khan2 本來就不是一個會被單獨錄音的本調），這種情況下
        // 逐音節找變調候選會直接找不到任何候選（不是「有候選但抓不到」，是根本沒有
        // 候選字可試），若只試變調後讀音就整個詞放棄，會讓很多合法複合詞（各自的字
        // 都有本調錄音，只是教育部沒收錄這個詞本身）也無法自動合成。退而求其次用本調
        // 錄音接起來，雖然聽感上不是真正的連續變調，但比完全沒有音檔好，且這正是
        // 教育部辭典本身「只錄本調」這個既有限制下能做到的最佳結果。
        const whole = (await findWorkingAudioUrl(findAudioCandidates(sandhiSylls)))
          || (await findWorkingAudioUrl(findAudioCandidates(parsed)));
        if (whole) return { urls: [whole.url] };

        const perSyll = [];
        for (let i = 0; i < sandhiSylls.length; i++) {
          const hit = (await findWorkingAudioUrl(findAudioCandidates([sandhiSylls[i]])))
            || (await findWorkingAudioUrl(findAudioCandidates([parsed[i]])));
          if (!hit) return null;
          perSyll.push(hit);
        }
        return { urls: perSyll.map(p => p.url) };
      })(), timeout]);

      if (!found) return { ok: false, reason: 'notfound' };

      const blob = await Promise.race([AudioExport.combineToWav(found.urls), timeout]);
      const filename = `auto-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}.wav`;
      const file = new File([blob], filename, { type: 'audio/wav' });
      await Dict.importAudioFiles([file]);
      return { ok: true, filename };
    } catch (err) {
      return { ok: false, reason: 'fetch', message: err.message };
    }
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
    const sandhiMap = computeSandhiSyllables(commonTokens);
    applyAudioFallback(commonTokens, sandhiMap); // 詞本身若沒音檔，借用變調後同音字的錄音
    const { hanziOut, romOut, numOut } = buildOutputs(commonTokens);
    setIfNotFocused(hanziInput, hanziOut);
    setIfNotFocused(tailoInput, romOut);
    setIfNotFocused(numericInput, numOut);
    updateSourceIndicator();
    sandhiRow.textContent = buildSandhiOutput(commonTokens, sandhiMap);
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
      span.className = 'tok' + (t.unresolved ? ' unresolved' : '') + (t.custom ? ' custom' : '') +
        (t.alternatives.length > 1 ? ' multi' : '') + (t.audioFallback ? ' audio-fallback' : '');
      span.dataset.idx = String(idx);
      span.textContent = t.hanzi;
      span.title = t.unresolved
        ? '辭典未收錄，點擊補上讀音／音檔'
        : `讀音：${t.reading || '—'}｜${t.tailoMark}｜點擊修改讀音`;
      if (t.audioFallback) {
        span.title += t.audioFallbackMode === 'syllable'
          ? `\n🔊 這個詞本身沒有音檔，逐音節借用變調後同音字「${t.audioFallbackFrom}」的錄音接起來播放`
          : `\n🔊 這個詞本身沒有音檔，播放的是變調後同音詞「${t.audioFallbackFrom}」的錄音`;
      }
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
      // alt.hanzi 只有「羅馬字反查到多個同音但不同字」的情況才有值（來源見
      // toCommonTokens 的 rom 分支，token.hanziMatches 每筆都帶 hanzi）；同一個漢字
      // 底下的破音字（entries）沒有這個欄位，因為漢字欄位本身已經顯示，不用重複。
      // 有 alt.hanzi 時一定要顯示出來，不然使用者沒辦法分辨「共 3 個同音候選」哪個
      // 對應哪個字——只看聲調類型＋羅馬字（例如都寫「讀音：ting2」）會看起來像重複
      // 選項，但其實是完全不同的字。
      btn.textContent = alt.hanzi
        ? `${alt.hanzi}　${alt.reading || '讀音'}：${alt.trs}`
        : `${alt.reading || '讀音'}：${alt.trs}`;
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
    tokenEditorTrs.value = (currentScheme() === 'poj' ? t.numericPoj : t.numericTailo) || '';
    tokenEditorAudio.value = '';
    tokenEditorAudioHint.hidden = true;
    tokenEditorAudioHint.className = 'token-editor-hint';
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
    tokenEditorAudioHint.hidden = true;

    if (!hanzi) return showEditorError('請填寫漢字（沒有對應漢字也可以自己取一個代表寫法）');
    if (!trs) return showEditorError('請填寫羅馬字或數字調讀音');
    const parsed = Romanize.parseWord(trs);
    if (!parsed) return showEditorError('這個讀音格式看不懂，請確認拼法／調號（可用教育部台羅、白話字，或數字調）');

    tokenEditorSave.disabled = true;
    let synthOutcomeMsg = '';
    try {
      let audioFilename = '';
      const file = tokenEditorAudio.files[0];
      if (file) {
        await Dict.importAudioFiles([file]);
        audioFilename = file.name;
        updateAudioStatus();
      } else {
        // 檔案選取欄位每次打開編輯面板都會是空的，「這次沒選檔案」不代表「這個詞
        // 從來沒有音檔」——先看看同一個詞是不是早就補過音檔，有的話直接沿用，
        // 不要因為這次忘記重新選檔案，就把已經存在的真人錄音換成自動合成的替代品。
        const existingAudio = await Dict.findCustomAudio(hanzi, trs);
        if (existingAudio) {
          audioFilename = existingAudio;
        } else {
          tokenEditorAudioHint.hidden = false;
          tokenEditorAudioHint.className = 'token-editor-hint';
          tokenEditorAudioHint.textContent = '沒有選擇音檔，嘗試自動合成中…';
          const synth = await autoSynthesizeAudio(parsed);
          if (synth.ok) {
            audioFilename = synth.filename;
            updateAudioStatus();
            synthOutcomeMsg = `已存檔「${hanzi}」（已借用同音字錄音自動合成音檔）`;
          } else if (synth.reason === 'fetch') {
            synthOutcomeMsg = `已存檔「${hanzi}」（找到可借用的錄音，但目前環境無法直接讀取音檔位元組，需要本機 serve.py 或已設定的 Cloudflare Worker，可之後再上傳）`;
          } else {
            synthOutcomeMsg = `已存檔「${hanzi}」（找不到可自動合成的音檔，可之後再上傳）`;
          }
        }
      }
      await Dict.addCustomEntry({ hanzi, trs, audio: audioFilename, note: '使用者修正' });
      updateCustomStatus();
      closeTokenEditor();
      refreshFromCurrentFields();
      if (!customViewer.hidden) renderCustomViewer();
      if (synthOutcomeMsg) showTransientCustomStatus(synthOutcomeMsg);
    } catch (err) {
      showEditorError('儲存失敗：' + err.message);
    } finally {
      tokenEditorSave.disabled = false;
    }
  });

  // 存檔後想順便交代「有沒有自動合成到音檔」，但 customStatus 平常顯示的是筆數統計，
  // 暫時蓋過去幾秒再還原，不用另外開一塊固定佔位的提示區塊。
  let transientStatusTimer = null;
  function showTransientCustomStatus(msg) {
    clearTimeout(transientStatusTimer);
    customStatus.textContent = msg;
    transientStatusTimer = setTimeout(updateCustomStatus, 5000);
  }

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
    const isPoj = currentScheme() === 'poj';
    tailoLabel.textContent = isPoj ? '全羅（白話字 POJ）' : '全羅（教育部台羅）';
    numericLabel.textContent = isPoj ? '羅馬字加音調數字（白話字）' : '羅馬字加音調數字（教育部台羅）';
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
      if (t.type === 'word') {
        const urls = tokenAudioUrls(t);
        if (!urls.length) return;
        seq.push({ t, idx, urls, gapBefore: seq.length ? (pendingGap || GAP_WORD_MS) : 0 });
        pendingGap = 0;
      }
    });
    return seq;
  }

  function makeAudio(url) {
    const audio = new Audio(url);
    audio.preload = 'auto';
    audio.load();
    // load() 一定要在設定 playbackRate 之前呼叫——瀏覽器的 load() 會把 playbackRate
    // 重設回 1，先設再 load() 等於白設，導致語速選單其實從來沒真的生效過（實測
    // 用 Playwright 直接檢查過：先設後 load，load 完 playbackRate 變回 1）。
    audio.playbackRate = parseFloat(speedSelect.value) || 1;
    return audio;
  }

  function playOne(audio) {
    return new Promise(resolve => {
      playState.audio = audio;
      audio.addEventListener('ended', resolve, { once: true });
      audio.addEventListener('error', () => resolve(), { once: true }); // 單一音檔失敗不中斷整句
      // 按「停止」是呼叫 audio.pause()，但 pause 本身不會觸發 ended／error——
      // 不接這個事件的話，播放中途按停止，這個 Promise 會永遠卡住，導致整個
      // playSequence 卡在 await、播放鍵/停止鍵永遠恢復不了。
      audio.addEventListener('pause', resolve, { once: true });
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
    // 不會因為當下才去要求載入而卡一下。一個詞可能是好幾段（分音節借用的情況），
    // 所以每個項目對應一組 Audio，不是單一一個。
    const audioGroups = seq.map(item => item.urls.map(makeAudio));

    for (let i = 0; i < seq.length; i++) {
      if (playState.abort) break;
      const { idx, gapBefore } = seq[i];
      if (gapBefore) await sleep(gapBefore);
      if (playState.abort) break;

      const span = detailRow.querySelector(`[data-idx="${idx}"]`);
      if (span) span.classList.add('playing');
      for (const audio of audioGroups[i]) {
        if (playState.abort) break;
        await playOne(audio);
      }
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
      const urls = tokenAudioUrls(t);
      urls.forEach((url, i) => {
        const a = document.createElement('a');
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = urls.length > 1 ? `${t.hanzi}(${i + 1}/${urls.length})` : t.hanzi;
        manualLinksList.appendChild(a);
      });
    });
    manualLinks.hidden = false;
  }

  downloadBtn.addEventListener('click', async () => {
    const seq = commonTokens.filter(t => t.type === 'word' && tokenAudioUrls(t).length);
    if (!seq.length) return;

    downloadBtn.disabled = true;
    manualLinks.hidden = true;
    downloadStatus.textContent = '準備中…（讀取並合併音檔）';

    try {
      const blob = await AudioExport.combineToWav(seq.flatMap(tokenAudioUrls));
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
      downloadStatus.textContent = '無法自動合併下載：內容包含萌典官方辭典音檔，該伺服器不開放程式讀取（不是本工具的限制）。已在下方列出個別連結，請自行開啟後用瀏覽器另存；或改用 python serve.py 開啟本頁，或部署 cloudflare-worker.js，即可直接合併下載，見右上角「❓ 說明」。';
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
    viewCustomBtn.disabled = !n;
    if (!n) customViewer.hidden = true;
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
      viewCustomBtn.disabled = false;
      refreshFromCurrentFields();
      if (!customViewer.hidden) renderCustomViewer();
    } catch (err) {
      customStatus.textContent = '匯入失敗：' + err.message;
    }
  });

  clearCustomBtn.addEventListener('click', async () => {
    await Dict.clearCustom();
    updateCustomStatus();
    refreshFromCurrentFields();
  });

  // ---------- 查看／管理自訂詞庫 ----------

  async function renderCustomViewer() {
    const rows = await Dict.getCustomEntries();
    customViewerList.innerHTML = '';
    if (!rows.length) {
      const empty = document.createElement('p');
      empty.className = 'custom-viewer-empty';
      empty.textContent = '目前沒有自訂詞條。';
      customViewerList.appendChild(empty);
      return;
    }
    rows.forEach((row, idx) => {
      const item = document.createElement('div');
      item.className = 'custom-viewer-row';

      const hanziEl = document.createElement('span');
      hanziEl.className = 'cv-hanzi';
      hanziEl.textContent = row.hanzi;

      const trsEl = document.createElement('span');
      trsEl.className = 'cv-trs';
      trsEl.textContent = row.trs;

      const audioEl = document.createElement('span');
      audioEl.className = 'cv-audio';
      const audioSrc = row.audio ? Dict.resolveAudioUrl({ audioUrl: row.audio }) : null;
      if (audioSrc) {
        const audio = document.createElement('audio');
        audio.controls = true;
        audio.src = audioSrc;
        audioEl.appendChild(audio);
      } else {
        const span = document.createElement('span');
        span.className = 'cv-noaudio';
        span.textContent = row.audio ? '（找不到對應音檔）' : '（無音檔）';
        audioEl.appendChild(span);
      }

      const delBtn = document.createElement('button');
      delBtn.className = 'cv-delete';
      delBtn.type = 'button';
      delBtn.textContent = '刪除';
      delBtn.addEventListener('click', async () => {
        if (!confirm(`確定要刪除「${row.hanzi}」（${row.trs}）這筆自訂詞條？`)) return;
        await Dict.removeCustomEntry(idx);
        updateCustomStatus();
        refreshFromCurrentFields();
        renderCustomViewer();
      });

      item.append(hanziEl, trsEl, audioEl, delBtn);
      customViewerList.appendChild(item);
    });
  }

  viewCustomBtn.addEventListener('click', () => {
    customViewer.hidden = !customViewer.hidden;
    if (!customViewer.hidden) renderCustomViewer();
  });

  exportCustomBtn.addEventListener('click', async () => {
    exportCustomBtn.disabled = true;
    const originalText = exportCustomBtn.textContent;
    exportCustomBtn.textContent = '匯出中…';
    try {
      const rows = await Dict.exportCustomWithAudio();
      const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'custom-dictionary-export.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      exportCustomBtn.disabled = false;
      exportCustomBtn.textContent = originalText;
    }
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
    if (!customViewer.hidden) renderCustomViewer(); // 剛好補上某個自訂詞條缺的音檔時，畫面也要跟著更新
  });

  clearAudioBtn.addEventListener('click', async () => {
    await Dict.clearAudio();
    updateAudioStatus();
    refreshFromCurrentFields();
    if (!customViewer.hidden) renderCustomViewer();
  });

  stopBtn.disabled = true;
  playBtn.disabled = true;
  initDict(false);
})();
