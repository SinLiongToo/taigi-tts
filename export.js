// 把目前播放序列的語音檔合併成一個 WAV 檔下載。
//
// 重要限制：萌典官方辭典音檔伺服器（r2-assets.moedict.tw）沒有開放 CORS，
// 瀏覽器允許我們用 <audio> 正常「播放」它，但基於安全機制，禁止任何網頁
// 用程式「讀取」它的音訊資料（fetch 會被擋、Web Audio 接進去也只會拿到全零的靜音）。
// 這不是本工具的限制，是對方伺服器的設定。
//
// 如果是用 serve.py 開的本機伺服器（不是單純雙擊 index.html、也不是純 python -m
// http.server），會多一個同源的 /proxy-audio/<id>.mp3 路徑：由 serve.py 這支腳本
// 在「電腦」這一層先幫忙把官方音檔抓下來，再用「跟網頁同一個來源」的身份回傳給瀏覽器
// ——同源請求從來就不受 CORS 限制，所以這樣繞得過去。fetchAudioBytes 會先試直接抓，
// 失敗了才試這個 proxy 路徑；如果兩者都不行（純開檔、或用一般 http.server），就維持
// 拋出錯誤，讓呼叫端改用「逐字另開分頁」的替代方案。
const AudioExport = (() => {
  const MOEDICT_AUDIO_RE = /^https:\/\/r2-assets\.moedict\.tw\/audio\/t\/(\d+)\.mp3$/;

  async function fetchAudioBytes(url) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.arrayBuffer();
    } catch { /* 直接抓失敗（通常就是 CORS），往下試 proxy */ }

    const m = url.match(MOEDICT_AUDIO_RE);
    if (m) {
      try {
        const res2 = await fetch(`/proxy-audio/${m[1]}.mp3`);
        if (res2.ok) return await res2.arrayBuffer();
      } catch { /* 沒有 serve.py 在跑，忽略即可 */ }
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
