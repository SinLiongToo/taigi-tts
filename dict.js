// 教育部臺灣台語常用詞辭典資料（經 g0v/moedict-data-twblg 整理），
// 用來做「漢字 <-> 羅馬字」的辭典查詢，以及語音音檔（真人錄音，非語音合成）。
// 另外支援使用者匯入自訂詞庫（CSV／JSON），疊加在官方資料之上。
const Dict = (() => {
  const SOURCE_URL = 'https://raw.githubusercontent.com/g0v/moedict-data-twblg/master/dict-twblg.json';
  const DB_NAME = 'taigi-tts-dict';
  const STORE = 'cache';
  const CUSTOM_STORE = 'custom';
  const AUDIO_STORE = 'audioBlobs';
  const CACHE_KEY = 'dict-twblg-v1';
  const CUSTOM_KEY = 'rows';

  let state = { wordIndex: new Map(), romIndex: new Map(), maxWordLen: 1, loaded: false };
  let customCountMemo = 0;
  let audioMap = new Map();      // 檔名（原樣） -> object URL
  let audioMapLower = new Map(); // 檔名（小寫） -> object URL，供不分大小寫比對

  function openDB() {
    return new Promise(resolve => {
      if (!window.indexedDB) return resolve(null);
      try {
        const req = indexedDB.open(DB_NAME, 3);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
          if (!db.objectStoreNames.contains(CUSTOM_STORE)) db.createObjectStore(CUSTOM_STORE);
          if (!db.objectStoreNames.contains(AUDIO_STORE)) db.createObjectStore(AUDIO_STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch { resolve(null); }
    });
  }

  async function dbGet(storeName, key) {
    const db = await openDB();
    if (!db) return null;
    return new Promise(resolve => {
      try {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch { resolve(null); }
    });
  }

  async function dbPut(storeName, key, value) {
    const db = await openDB();
    if (!db) return;
    return new Promise(resolve => {
      try {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch { resolve(); }
    });
  }

  async function dbGetAllEntries(storeName) {
    const db = await openDB();
    if (!db) return [];
    return new Promise(resolve => {
      try {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const keysReq = store.getAllKeys();
        const valsReq = store.getAll();
        tx.oncomplete = () => resolve(keysReq.result.map((k, i) => [k, valsReq.result[i]]));
        tx.onerror = () => resolve([]);
      } catch { resolve([]); }
    });
  }

  async function dbClear(storeName) {
    const db = await openDB();
    if (!db) return;
    return new Promise(resolve => {
      try {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch { resolve(); }
    });
  }

  const readCache = () => dbGet(STORE, CACHE_KEY);
  const writeCache = data => dbPut(STORE, CACHE_KEY, data);
  const loadCustomRaw = async () => (await dbGet(CUSTOM_STORE, CUSTOM_KEY)) || [];
  const saveCustomRaw = rows => dbPut(CUSTOM_STORE, CUSTOM_KEY, rows);

  // ---------- 官方辭典：下載、索引、快取 ----------

  function buildIndex(rawArray) {
    const wordIndex = new Map();
    const romIndex = new Map();
    let maxWordLen = 1;

    for (const entry of rawArray) {
      const title = entry.title;
      if (!title) continue;
      maxWordLen = Math.max(maxWordLen, Array.from(title).length);

      const heteronyms = (entry.heteronyms || [])
        .map(h => ({ trs: (h.trs || '').trim(), reading: h.reading || '', id: h.id || '', audioUrl: null, custom: false }))
        .filter(h => h.trs);
      if (!heteronyms.length) continue;

      if (!wordIndex.has(title)) wordIndex.set(title, []);
      wordIndex.get(title).push(...heteronyms);

      for (const h of heteronyms) {
        const alts = h.trs.split('/').map(s => s.trim()).filter(Boolean);
        for (const alt of alts) {
          const parsed = Romanize.parseWord(alt);
          if (!parsed) continue;
          const key = Romanize.wordToKey(parsed);
          if (!romIndex.has(key)) romIndex.set(key, []);
          romIndex.get(key).push({ hanzi: title, trs: alt, reading: h.reading, id: h.id, audioUrl: null, custom: false });
        }
      }
    }
    return { wordIndex, romIndex, maxWordLen };
  }

  function serialize({ wordIndex, romIndex, maxWordLen }) {
    return {
      maxWordLen,
      wordIndexArr: Array.from(wordIndex.entries()),
      romIndexArr: Array.from(romIndex.entries())
    };
  }

  function deserialize(data) {
    return {
      wordIndex: new Map(data.wordIndexArr),
      romIndex: new Map(data.romIndexArr),
      maxWordLen: data.maxWordLen
    };
  }

  async function fetchRaw(onProgress) {
    const res = await fetch(SOURCE_URL);
    if (!res.ok) throw new Error('下載辭典失敗（HTTP ' + res.status + '）');
    const total = parseInt(res.headers.get('content-length') || '0', 10);
    if (!res.body || !total) {
      const text = await res.text();
      return JSON.parse(text);
    }
    const reader = res.body.getReader();
    let received = 0;
    const chunks = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (onProgress) onProgress(received / total);
    }
    const text = await new Blob(chunks).text();
    return JSON.parse(text);
  }

  // ---------- 自訂詞庫：CSV／JSON 解析與套用 ----------

  const HEADER_ALIASES = {
    hanzi: ['漢字', '漢語', '詞', 'word', 'hanzi'],
    trs: ['羅馬字', '台羅', '白話字', '讀音', 'trs', 'romanization', 'pronunciation'],
    audio: ['音檔', '音檔網址', '語音', 'audio', 'audiourl', 'sound'],
    note: ['備註', '說明', '讀音類型', 'note', 'reading', 'remark']
  };

  function normalizeHeader(h) {
    const key = (h || '').trim().toLowerCase();
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.some(a => a.toLowerCase() === key)) return field;
    }
    return null;
  }

  // 極簡 CSV 解析：支援雙引號欄位與跳脫（""）。
  function parseCSV(text) {
    const rows = [];
    let row = [], field = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += c;
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field); field = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        rows.push(row); row = [];
      } else {
        field += c;
      }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => r.some(c => c.trim() !== ''));
  }

  function rowsFromCSV(text) {
    const table = parseCSV(text);
    if (!table.length) return [];
    const headerMap = table[0].map(normalizeHeader);
    const out = [];
    for (let i = 1; i < table.length; i++) {
      const r = table[i];
      const obj = {};
      headerMap.forEach((field, idx) => { if (field) obj[field] = (r[idx] || '').trim(); });
      if (obj.hanzi && obj.trs) out.push(obj);
    }
    return out;
  }

  function rowsFromJSON(text) {
    const data = JSON.parse(text);
    const arr = Array.isArray(data) ? data : (data.words || data.entries || []);
    return arr
      .map(o => ({
        hanzi: (o.hanzi || o['漢字'] || '').trim(),
        trs: (o.trs || o['羅馬字'] || o.romanization || '').trim(),
        audio: (o.audio || o['音檔'] || o.audioUrl || '').trim(),
        note: (o.note || o['備註'] || o.reading || '').trim()
      }))
      .filter(o => o.hanzi && o.trs);
  }

  // 把已解析出的 rows 套進目前記憶體中的索引（不影響官方快取本身），
  // 用 unshift 插到最前面，讓自訂讀音成為預設、但官方讀音仍可點擊切換看到。
  function applyCustomEntries(rows) {
    const errors = [];
    for (const row of rows) {
      const hanzi = row.hanzi;
      const altTrsList = row.trs.split('/').map(s => s.trim()).filter(Boolean);
      let any = false;
      for (const altTrs of altTrsList) {
        const parsed = Romanize.parseWord(altTrs);
        if (!parsed) continue;
        any = true;
        const entry = { trs: altTrs, reading: row.note || '自訂', id: null, audioUrl: row.audio || null, custom: true };

        if (!state.wordIndex.has(hanzi)) state.wordIndex.set(hanzi, []);
        state.wordIndex.get(hanzi).unshift(entry);

        const key = Romanize.wordToKey(parsed);
        if (!state.romIndex.has(key)) state.romIndex.set(key, []);
        state.romIndex.get(key).unshift({ hanzi, trs: altTrs, reading: row.note || '自訂', id: null, audioUrl: row.audio || null, custom: true });

        state.maxWordLen = Math.max(state.maxWordLen, Array.from(hanzi).length);
      }
      if (!any) errors.push(`「${hanzi}」的羅馬字「${row.trs}」格式無法解析，已略過`);
    }
    return errors;
  }

  async function importCustom(text, filename) {
    const looksJSON = /\.json$/i.test(filename || '') || /^\s*[\[{]/.test(text);
    let rows;
    try {
      rows = looksJSON ? rowsFromJSON(text) : rowsFromCSV(text);
    } catch (e) {
      throw new Error('格式解析失敗：' + e.message);
    }
    if (!rows.length) throw new Error('沒有解析到有效的詞條，請確認欄位包含「漢字」與「羅馬字」');

    const errors = applyCustomEntries(rows);
    const existing = await loadCustomRaw();
    const merged = existing.concat(rows);
    await saveCustomRaw(merged);
    customCountMemo = merged.length;
    return { added: rows.length, total: merged.length, errors };
  }

  // 單一詞條的即時修正／新增（畫面上點擊某個詞直接改讀音時用），
  // 邏輯與 importCustom 相同，只是入口是一筆 row 而不是整份檔案。
  async function addCustomEntry(row) {
    const errors = applyCustomEntries([row]);
    if (errors.length) throw new Error(errors[0]);
    const existing = await loadCustomRaw();
    const merged = existing.concat([row]);
    await saveCustomRaw(merged);
    customCountMemo = merged.length;
  }

  async function clearCustom() {
    await saveCustomRaw([]);
    const cached = await readCache();
    if (cached) state = { ...deserialize(cached), loaded: true };
    customCountMemo = 0;
  }

  // ---------- 自訂音檔：使用者上傳的本機錄音／音檔 ----------
  // 「音檔」欄位若是 http(s)/data 開頭當成網址；否則當成檔名，
  // 到這裡（使用者透過「上傳自訂音檔」選的檔案）比對是否有對應的檔案。

  function registerAudioBlob(filename, blob) {
    const old = audioMap.get(filename);
    if (old) URL.revokeObjectURL(old);
    const url = URL.createObjectURL(blob);
    audioMap.set(filename, url);
    audioMapLower.set(filename.toLowerCase(), url);
  }

  async function loadStoredAudioBlobs() {
    const entries = await dbGetAllEntries(AUDIO_STORE);
    for (const [filename, blob] of entries) {
      if (blob) registerAudioBlob(filename, blob);
    }
    return entries.length;
  }

  async function importAudioFiles(fileList) {
    const files = Array.from(fileList || []);
    let count = 0;
    for (const file of files) {
      await dbPut(AUDIO_STORE, file.name, file);
      registerAudioBlob(file.name, file);
      count++;
    }
    return { added: count, total: audioMap.size };
  }

  async function clearAudio() {
    await dbClear(AUDIO_STORE);
    for (const url of audioMap.values()) URL.revokeObjectURL(url);
    audioMap = new Map();
    audioMapLower = new Map();
  }

  function audioCount() { return audioMap.size; }

  function lookupLocalAudio(filename) {
    if (!filename) return null;
    return audioMap.get(filename) || audioMapLower.get(filename.toLowerCase()) || null;
  }

  // ---------- 對外 API ----------

  async function load({ onProgress, forceRefresh } = {}) {
    let fromCache = true;
    if (forceRefresh) {
      fromCache = false;
      const raw = await fetchRaw(onProgress);
      const idx = buildIndex(raw);
      state = { ...idx, loaded: true };
      writeCache(serialize(idx));
    } else {
      const cached = await readCache();
      if (cached) {
        state = { ...deserialize(cached), loaded: true };
      } else {
        fromCache = false;
        const raw = await fetchRaw(onProgress);
        const idx = buildIndex(raw);
        state = { ...idx, loaded: true };
        writeCache(serialize(idx));
      }
    }

    const customRows = await loadCustomRaw();
    customCountMemo = customRows.length;
    if (customRows.length) applyCustomEntries(customRows);

    const audioLoaded = await loadStoredAudioBlobs();

    return { fromCache, wordCount: state.wordIndex.size, customCount: customRows.length, audioCount: audioLoaded };
  }

  function lookupWord(hanzi) { return state.wordIndex.get(hanzi) || null; }
  function lookupRom(key) { return state.romIndex.get(key) || null; }
  function getMaxWordLen() { return state.maxWordLen; }
  function isLoaded() { return state.loaded; }
  function customCount() { return customCountMemo; }

  function audioUrl(id) {
    if (!id) return null;
    const s = String(id);
    const padded = s.length <= 4 ? s.padStart(5, '0') : s;
    return `https://r2-assets.moedict.tw/audio/t/${padded}.mp3`;
  }

  function resolveAudioUrl(entry) {
    if (!entry) return null;
    if (entry.audioUrl) {
      if (/^(https?:|data:|blob:)/i.test(entry.audioUrl)) return entry.audioUrl;
      // 不是網址：當成使用者上傳的本機檔名來查
      return lookupLocalAudio(entry.audioUrl);
    }
    return audioUrl(entry.id);
  }

  return {
    load, lookupWord, lookupRom, getMaxWordLen, isLoaded, audioUrl, resolveAudioUrl,
    importCustom, clearCustom, customCount, addCustomEntry,
    importAudioFiles, clearAudio, audioCount
  };
})();
