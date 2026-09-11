// 選用：Cloudflare Worker，讓部署在 GitHub Pages（純靜態，沒有後端）上的網站，
// 也能合併下載萌典官方辭典音檔——原理跟 serve.py 一樣（伺服器對伺服器的請求不受
// 瀏覽器 CORS 限制），差別只在於這個是「一直在線上」的版本，不需要使用者自己開著
// 電腦跑 serve.py。只轉發固定格式的萌典音檔編號，不是任意網址的開放轉發站。
//
// 部署方式（不需要裝任何工具）：
//   1. 登入 https://dash.cloudflare.com （沒有帳號就免費註冊一個）
//   2. 左側選單 Workers & Pages -> Create -> Create Worker
//   3. 取個名字（例如 taigi-tts-proxy），Deploy
//   4. 進去這個 Worker -> Edit code，把這支檔案的內容整個貼進去覆蓋預設範例，按 Deploy
//   5. 部署完成後會有一個網址，長得像 https://taigi-tts-proxy.<你的帳號>.workers.dev
//      把這個網址填進 export.js 最上面的 EXTERNAL_PROXY_BASE 常數即可。

export default {
  async fetch(request) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const m = url.pathname.match(/^\/audio\/(\d{1,6})\.mp3$/);
    if (!m) {
      return new Response('not found', { status: 404, headers: corsHeaders });
    }

    const id = m[1].padStart(5, '0');
    const upstream = `https://r2-assets.moedict.tw/audio/t/${id}.mp3`;

    let res;
    try {
      // cf.cacheTtl / cacheEverything：讓 Cloudflare 邊緣節點快取結果，
      // 同一個字之後的請求不用每次都重新跟萌典要。
      res = await fetch(upstream, { cf: { cacheTtl: 604800, cacheEverything: true } });
    } catch {
      return new Response('upstream fetch failed', { status: 502, headers: corsHeaders });
    }
    if (!res.ok) {
      return new Response('upstream error: ' + res.status, { status: 502, headers: corsHeaders });
    }

    const headers = new Headers(res.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Cache-Control', 'public, max-age=604800, immutable');
    return new Response(res.body, { status: 200, headers });
  },
};
