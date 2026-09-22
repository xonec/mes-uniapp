#!/usr/bin/env python3
# 生成底部导航 tab 图标（4 图标 × 普通/选中双态 = 8 张 81×81 PNG）
# 依赖 Pillow；输出到 static/tabbar/。占位图，可直接覆盖同名文件替换。

import os
from PIL import Image, ImageDraw

SIZE = 81
LW = 5
GRAY = (119, 130, 125)    # #77827D 未选中
GREEN = (0, 133, 119)     # #008577 选中（主题色）

def new_canvas():
    img = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    return img, ImageDraw.Draw(img)

def draw_calc(d, c):
    d.rounded_rectangle([16, 20, 65, 74], radius=7, outline=c, width=LW)
    d.rectangle([22, 27, 59, 39], outline=c, width=LW)
    for r in range(3):
        for col in range(3):
            x, y = 26 + col * 14, 47 + r * 9
            d.ellipse([x, y, x + 4, y + 4], fill=c)

def draw_history(d, c):
    d.ellipse([12, 18, 69, 75], outline=c, width=LW)
    cx, cy = 40.5, 46.5
    d.line([cx, cy, cx, cy - 14], fill=c, width=LW)
    d.line([cx, cy, cx + 13, cy + 8], fill=c, width=LW)
    d.rectangle([36, 10, 45, 18], outline=c, width=LW)

def draw_archive(d, c):
    pts = [(14, 24), (24, 24), (28, 32), (67, 32), (67, 72), (14, 72)]
    d.line(pts + [pts[0]], fill=c, width=LW, joint='curve')

def draw_me(d, c):
    d.ellipse([28, 12, 53, 37], outline=c, width=LW)
    d.arc([18, 40, 63, 88], 180, 360, fill=c, width=LW)

ICONS = {'calc': draw_calc, 'history': draw_history, 'archive': draw_archive, 'me': draw_me}

def main():
    outdir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'static', 'tabbar')
    os.makedirs(outdir, exist_ok=True)
    for name, fn in ICONS.items():
        for suffix, color in [('', GRAY), ('-active', GREEN)]:
            img, d = new_canvas()
            fn(d, color)
            path = os.path.join(outdir, name + suffix + '.png')
            img.save(path)
            print('saved', path)

if __name__ == '__main__':
    main()
