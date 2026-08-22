#!/usr/bin/env python3
"""ローカル確認用の静的サーバー。

本番は GitHub Pages なので、これは手元で変更を見るためだけのもの。
localhost は Service Worker が動く扱いになるため、オフライン挙動もここで確かめられる。

    python3 server.py [--port 8765]
"""

import argparse
import os
import re
import sys
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(SimpleHTTPRequestHandler):
    server_version = "WorkoutLog/1.0"
    # ES modules と PWA まわりは MIME が違うと読み込まれないので明示する。
    extensions_map = dict(SimpleHTTPRequestHandler.extensions_map)
    extensions_map.update({
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".json": "application/json",
        ".webmanifest": "application/manifest+json",
        ".css": "text/css",
        ".svg": "image/svg+xml",
    })

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, fmt, *args):
        msg = fmt % args
        # 静的ファイルの成功は騒がしいので、失敗だけ出す。
        if re.search(r'" [45]\d\d ', msg):
            sys.stderr.write("%s  %s\n" % (datetime.now().strftime("%H:%M:%S"), msg))

    def end_headers(self):
        # 編集した内容がすぐ反映されるように、確認用サーバーではキャッシュさせない。
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    parser = argparse.ArgumentParser(description="ローカル確認用の静的サーバー")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()

    try:
        httpd = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    except OSError as e:
        print("ポート %d を開けませんでした: %s" % (args.port, e))
        print("すでに起動している可能性があります。--port で別の番号を指定してください。")
        return 1

    print()
    print("  http://localhost:%d/  を開いてください" % args.port)
    print("  終了するには Control-C")
    print()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  終了しました。")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
