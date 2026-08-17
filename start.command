#!/bin/bash
# ダブルクリックでワークアウト記録アプリのサーバーを起動する。
cd "$(dirname "$0")" || exit 1
exec /usr/bin/env python3 server.py "$@"
