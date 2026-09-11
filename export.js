// 把目前播放序列的語音檔合併成一個 WAV 檔下載。
//
// 重要限制：萌典官方辭典音檔伺服器（r2-assets.moedict.tw）沒有開放 CORS，
// 瀏覽器允許我們用 <audio> 正常「播放」它，但基於安全機制，禁止任何網頁
// 用程式「讀取」它的音訊資料（fetch 會被擋、Web Audio 接進去也只會拿到全零的靜音）。
// 這不是本工具的限制，是對方伺服器的設定。
//
// 依序試三層，每一層失敗才試下一層：
//   1. 直接 fetch 原始網址——使用者自己上傳的音檔（blob:，同源）或剛好開放 CORS
//      的外部網址，這樣就夠了。
//   2. 同源的 /proxy-audio/<id>.mp3——只有用 serve.py 開頁面時才存在（不是單純雙擊
//      index.html、也不是純 python -m http.server）。serve.py 在「電腦」這一層先
//      幫忙把官方音檔抓下來，再用跟網頁同一個來源的身份回傳，同源請求不受 CORS 限制。
//   3. EXTERNAL_PROXY_BASE（見 cloudflare-worker.js）——部署在 Cloudflare 上、
//      一直在線上的版本，原理跟第 2 層一樣（伺服器對伺服器不受瀏覽器 CORS 限制），
//      差別是不需要使用者自己開著電腦跑 serve.py，連透過 GitHub Pages 開啟也能用。
//      沒有部署的話這個常數留空字串，這一層就直接跳過。
// 三層都不行才拋出錯誤，讓呼叫端改用「逐字另開分頁」的替代方案。
const AudioExport = (() => {
  const MOEDICT_AUDIO_RE = /^https:\/\/r2-assets\.moedict\.tw\/audio\/t\/(\d+)\.mp3$/;
  const EXTERNAL_PROXY_BASE = ''; // 部署 cloudflare-worker.js 後，把 https://xxx.workers.dev 填在這裡

  async function tryFetch(url) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.arrayBuffer();
    } catch { /* 忽略，讓呼叫端試下一層 */ }
    return null;
  }

  async function fetchAudioBytes(url) {
    const direct = await tryFetch(url);
    if (direct) return direct;

    const m = url.match(MOEDICT_AUDIO_RE);
    if (m) {
      const local = await tryFetch(`/proxy-audio/${m[1]}.mp3`);
      if (local) return local;

      if (EXTERNAL_PROXY_BASE) {
        const external = await tryFetch(`${EXTERNAL_PROXY_BASE}/audio/${m[1]}.mp3`);
        if (external) return external;
      }
    }
    throw new Error('無法讀取音檔位元組：' + url);
  }

  function audioBufferToWav(buffer) {
    const numCh = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const bytesPerSample = 2;
    const dataLength = buffer.length * numCh * bytesPerSample;
    const arrBuf = new ArrayBuffer(44 + dataLength);
    const view = new DataView(arrBuf);
    let offset = 0;
    const writeString = s => { for (let i = 0; i < s.length; i++) view.setUint8(offset++, s.charCodeAt(i)); };
    const writeU32 = v => { view.setUint32(offset, v, true); offset += 4; };
    const writeU16 = v => { view.setUint16(offset, v, true); offset += 2; };

    writeString('RIFF'); writeU32(36 + dataLength); writeString('WAVE');
    writeString('fmt '); writeU32(16); writeU16(1); writeU16(numCh);
    writeU32(sampleRate); writeU32(sampleRate * numCh * bytesPerSample);
    writeU16(numCh * bytesPerSample); writeU16(16);
    writeString('data'); writeU32(dataLength);

    const channels = [];
    for (let c = 0; c < numCh; c++) channels.push(buffer.getChannelData(c));
    for (let i = 0; i < buffer.length; i++) {
      for (let c = 0; c < numCh; c++) {
        const s = Math.max(-1, Math.min(1, channels[c][i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        offset += 2;
      }
    }
    return new Blob([arrBuf], { type: 'audio/wav' });
  }

  // urls: string[]。任一 url 若因 CORS 或網路而讀不到，會直接 throw。
  async function combineToWav(urls, { gapSeconds = 0.12, sampleRate = 44100 } = {}) {
    if (!urls.length) throw new Error('沒有可用的音檔');
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    let decoded;
    try {
      decoded = [];
      for (const url of urls) {
        const buf = await fetchAudioBytes(url);
        const audioBuf = await ctx.decodeAudioData(buf);
        decoded.push(audioBuf);
      }

      const totalSamples = decoded.reduce((s, b) => s + b.duration + gapSeconds, 0) * sampleRate;
      const offlineCtx = new OfflineAudioContext(1, Math.ceil(totalSamples), sampleRate);
      let t = 0;
      for (const buf of decoded) {
        const src = offlineCtx.createBufferSource();
        src.buffer = buf;
        src.connect(offlineCtx.destination);
        src.start(t);
        t += buf.duration + gapSeconds;
      }
      const rendered = await offlineCtx.startRendering();
      return audioBufferToWav(rendered);
    } finally {
      ctx.close();
    }
  }

  return { combineToWav };
})();
