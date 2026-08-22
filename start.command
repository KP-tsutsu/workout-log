#!/bin/bash
# ローカルで動作確認するときだけ使う。本番は GitHub Pages。
cd "$(dirname "$0")" || exit 1
exec /usr/bin/env python3 server.py "$@"
