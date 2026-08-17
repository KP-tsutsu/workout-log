#!/usr/bin/env python3
"""ワークアウト記録アプリのローカルサーバー。

自宅 Wi-Fi 内の iPhone から使うことを想定した、依存パッケージなしの静的配信サーバー。
静的ファイルの配信に加えて、iPhone 側 IndexedDB のスナップショットを Mac に
預かるためのバックアップ API を持つ。IP アドレスが変わってブラウザのデータが
見えなくなっても、ここに残ったスナップショットから復元できる。

    python3 server.py [--port 8765]
"""

import argparse
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(ROOT, "data")
SNAPSHOT_DIR = os.path.join(DATA_DIR, "snapshots")
LATEST_PATH = os.path.join(DATA_DIR, "latest.json")

# 保持するスナップショットの数。1 日に何度も同期されるので多めに持つ。
MAX_SNAPSHOTS = 30
# 受け付けるリクエストボディの上限 (16MB)。数年分の記録でも遠く及ばない。
MAX_BODY_BYTES = 16 * 1024 * 1024

_write_lock = threading.Lock()


def lan_ip():
    """この Mac の LAN 側 IP を返す。取得できなければ None。"""
    for iface in ("en0", "en1"):
        try:
            out = subprocess.run(
                ["ipconfig", "getifaddr", iface],
                capture_output=True, text=True, timeout=2,
            )
            if out.returncode == 0 and out.stdout.strip():
                return out.stdout.strip()
        except (OSError, subprocess.SubprocessError):
            pass
    # ipconfig が無い環境向けのフォールバック。実際には送信しない。
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("192.0.2.1", 80))
            return s.getsockname()[0]
        finally:
            s.close()
    except OSError:
        return None


def prune_snapshots():
    """古いスナップショットを MAX_SNAPSHOTS 件まで間引く。"""
    try:
        names = sorted(n for n in os.listdir(SNAPSHOT_DIR) if n.endswith(".json"))
    except FileNotFoundError:
        return
    for name in names[:-MAX_SNAPSHOTS]:
        try:
            os.remove(os.path.join(SNAPSHOT_DIR, name))
        except OSError:
            pass


def save_snapshot(payload):
    """スナップショットを保存し、保存先のファイル名を返す。"""
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    name = "%s.json" % stamp
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))

    with _write_lock:
        os.makedirs(SNAPSHOT_DIR, exist_ok=True)
        snapshot_path = os.path.join(SNAPSHOT_DIR, name)
        # 書き込み途中で落ちても latest.json が壊れないよう、一時ファイル経由で置く。
        tmp_path = LATEST_PATH + ".tmp"
        with open(tmp_path, "w", encoding="utf-8") as f:
            f.write(body)
            f.flush()
            os.fsync(f.fileno())
        shutil.copyfile(tmp_path, snapshot_path)
        os.replace(tmp_path, LATEST_PATH)
        prune_snapshots()
    return name


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

    # --- ロギング: 静的ファイルの GET は静かに、API と失敗だけ出す -------------
    def log_message(self, fmt, *args):
        msg = fmt % args
        if self.path.startswith("/api/") or re.search(r'" [45]\d\d ', msg):
            sys.stderr.write("%s  %s\n" % (datetime.now().strftime("%H:%M:%S"), msg))

    def end_headers(self):
        # 開発中の取り違えを避けるため、アプリのファイルはキャッシュさせない。
        # オフライン動作は Service Worker 側の役目 (HTTPS 化した場合のみ有効)。
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    # --- ヘルパ ---------------------------------------------------------------
    def _send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self):
        """リクエストボディを JSON として読む。問題があれば (None, エラー文) を返す。"""
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return None, "Content-Length が不正です"
        if length <= 0:
            return None, "ボディが空です"
        if length > MAX_BODY_BYTES:
            return None, "ボディが大きすぎます"
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8")), None
        except (UnicodeDecodeError, json.JSONDecodeError) as e:
            return None, "JSON として解釈できません: %s" % e

    # --- ルーティング ---------------------------------------------------------
    def do_GET(self):
        if self.path == "/api/ping":
            self._send_json(200, {"ok": True, "time": datetime.now().isoformat(timespec="seconds")})
            return
        if self.path == "/api/backup/latest":
            self._serve_latest()
            return
        if self.path.startswith("/api/"):
            self._send_json(404, {"error": "not found"})
            return
        super().do_GET()

    def do_POST(self):
        if self.path != "/api/backup":
            self._send_json(404, {"error": "not found"})
            return

        payload, err = self._read_json_body()
        if err:
            self._send_json(400, {"error": err})
            return
        if not isinstance(payload, dict) or "stores" not in payload:
            self._send_json(400, {"error": "想定した形式のスナップショットではありません"})
            return

        payload["receivedAt"] = datetime.now().isoformat(timespec="seconds")
        try:
            name = save_snapshot(payload)
        except OSError as e:
            self._send_json(500, {"error": "保存に失敗しました: %s" % e})
            return
        self._send_json(200, {"ok": True, "snapshot": name, "receivedAt": payload["receivedAt"]})

    def _serve_latest(self):
        if not os.path.exists(LATEST_PATH):
            self.send_response(204)
            self.end_headers()
            return
        try:
            with open(LATEST_PATH, "rb") as f:
                body = f.read()
        except OSError as e:
            self._send_json(500, {"error": "読み込みに失敗しました: %s" % e})
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    parser = argparse.ArgumentParser(description="ワークアウト記録アプリのローカルサーバー")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--host", default="0.0.0.0")
    args = parser.parse_args()

    os.makedirs(SNAPSHOT_DIR, exist_ok=True)

    try:
        httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    except OSError as e:
        print("ポート %d を開けませんでした: %s" % (args.port, e))
        print("すでにサーバーが動いている可能性があります。--port で別の番号を指定してください。")
        return 1

    ip = lan_ip()
    print()
    print("  ワークアウト記録アプリのサーバーを起動しました")
    print()
    if ip:
        print("  iPhone から:  http://%s:%d/" % (ip, args.port))
    else:
        print("  iPhone から:  LAN の IP アドレスを取得できませんでした")
    print("  この Mac から: http://localhost:%d/" % args.port)
    print()
    if os.path.exists(LATEST_PATH):
        stamp = datetime.fromtimestamp(os.path.getmtime(LATEST_PATH))
        print("  最終バックアップ: %s" % stamp.strftime("%Y-%m-%d %H:%M"))
        print()
    print("  終了するには Control-C")
    print()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  サーバーを終了しました。")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
