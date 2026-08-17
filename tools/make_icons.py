#!/usr/bin/env python3
"""ホーム画面用のアイコン PNG を作る。

Pillow が入っていない環境なので、zlib と struct だけで PNG を書き出している。
アイコンを描き直したいときだけ実行すればよい (生成物はリポジトリに入っている)。

    python3 tools/make_icons.py
"""

import os
import struct
import zlib

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets")

BG = (13, 18, 28)         # 濃紺。iOS 側で角丸にマスクされる前提で全面に敷く
BAR = (91, 141, 255)      # シャフト
PLATE = (233, 237, 245)   # プレート


def rounded_rect(px, py, x0, y0, x1, y1, r):
    """角丸長方形の内側かどうか。角の中心へ寄せてから円で判定する。"""
    if not (x0 <= px <= x1 and y0 <= py <= y1):
        return False
    r = min(r, (x1 - x0) / 2, (y1 - y0) / 2)
    if r <= 0:
        return True
    cx = min(max(px, x0 + r), x1 - r)
    cy = min(max(py, y0 + r), y1 - r)
    return (px - cx) ** 2 + (py - cy) ** 2 <= r * r


def draw(size):
    """ダンベルを描いて、行ごとの RGB バイト列を返す。"""
    s = float(size)

    # 相対座標 (0-1) でダンベルの各パーツを定義する
    shapes = [
        # シャフト
        (0.24, 0.460, 0.76, 0.540, 0.040, BAR),
        # 内側プレート
        (0.185, 0.310, 0.305, 0.690, 0.030, PLATE),
        (0.695, 0.310, 0.815, 0.690, 0.030, PLATE),
        # 外側プレート
        (0.105, 0.385, 0.180, 0.615, 0.022, PLATE),
        (0.820, 0.385, 0.895, 0.615, 0.022, PLATE),
    ]
    boxes = [(x0 * s, y0 * s, x1 * s, y1 * s, r * s, c) for x0, y0, x1, y1, r, c in shapes]

    rows = []
    for y in range(size):
        py = y + 0.5
        row = bytearray()
        for x in range(size):
            px = x + 0.5
            color = BG
            for x0, y0, x1, y1, r, c in boxes:
                if rounded_rect(px, py, x0, y0, x1, y1, r):
                    color = c
                    break
            row += bytes(color)
        rows.append(bytes(row))
    return rows


def write_png(path, size, rows):
    raw = b"".join(b"\x00" + row for row in rows)  # フィルタなし
    compressed = zlib.compress(raw, 9)

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))  # 8bit truecolor
    png += chunk(b"IDAT", compressed)
    png += chunk(b"IEND", b"")

    with open(path, "wb") as f:
        f.write(png)
    print("%s (%d×%d, %.1f KB)" % (os.path.basename(path), size, size, len(png) / 1024))


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for size in (180, 192, 512):
        write_png(os.path.join(OUT_DIR, "icon-%d.png" % size), size, draw(size))


if __name__ == "__main__":
    main()
