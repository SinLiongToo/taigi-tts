#!/usr/bin/env python3
"""
台語文字轉語音：本機伺服器（選用）。

跟直接雙擊 index.html 或用 `python -m http.server` 的差別：這支腳本多開了一個
/proxy-audio/<id>.mp3 路徑，讓「下載語音（WAV）」也能合併教育部辭典的官方音檔。

背景：萌典官方辭典音檔伺服器（r2-assets.moedict.tw）沒有開放 CORS，瀏覽器允許
網頁用 <audio> 正常播放它，但基於安全機制不准網頁用程式讀取它的音訊資料，所以
沒辦法在瀏覽器裡把好幾個官方音檔合併成一個檔案下載（這不是本工具的限制，是對方
伺服器的設定）。但「同一台電腦上的 Python 腳本」去抓那個網址不受瀏覽器 CORS
限制——所以這支腳本先幫忙把音檔抓下來，再用「跟網頁同一個來源」的身份回傳給
瀏覽器，瀏覽器端的合併下載功能就能正常運作了。

用法：
    python serve.py [port]

預設 port 是 8791，啟動後開瀏覽器到 http://localhost:8791/index.html。
不想用這個功能、只是想開頁面的話，直接雙擊 index.html 也完全沒問題，只是
「下載語音」遇到官方音檔時會維持列出個別連結讓你手動另存的替代方案。
"""
import re
import sys
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

UPSTREAM = 'https://r2-assets.moedict.tw/audio/t/{id}.mp3'
PROXY_PATH_RE = re.compile(r'^/proxy-audio/(\d{1,6})\.mp3$')


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        m = PROXY_PATH_RE.match(self.path)
        if m:
            self.proxy_audio(m.group(1))
            return
        super().do_GET()

    def proxy_audio(self, audio_id):
        url = UPSTREAM.format(id=audio_id.zfill(5))
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = resp.read()
        except urllib.error.URLError as e:
            self.send_error(502, f'upstream fetch failed: {e}')
            return
        self.send_response(200)
        self.send_header('Content-Type', 'audio/mpeg')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'public, max-age=31536000')
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format, *args):
        pass  # 安靜一點，不要每個請求都洗畫面


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8791
    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    print(f'台語文字轉語音：本機伺服器已啟動 -> http://localhost:{port}/index.html')
    print('（含官方音檔合併下載用的 proxy；按 Ctrl+C 結束）')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
