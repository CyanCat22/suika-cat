#!/usr/bin/env python3
"""截图客观检查 + ASCII 缩略图（用 DSH 内置 Pillow）
用法: python3 tests/visual.py [文件名...]
"""
import sys, os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, 'shots')
RAMP = ' .:-=+*#%@'

DEFAULT = ['menu.png', 'play-start.png', 'play-mid.png', 'play-merge.png',
           'play-danger.png', 'over.png', 'share-overlay.png',
           'xhs-card.png', 'xhs-cover.png']


def auto_levels(vals, lo=2, hi=98):
    s = sorted(vals)
    if not s:
        return 0.0, 1.0
    a = s[min(len(s) - 1, int(len(s) * lo / 100))]
    b = s[min(len(s) - 1, int(len(s) * hi / 100))]
    if b - a < 0.02:
        return a, a + 0.02
    return a, b


def thumb(path, cols=64):
    im = Image.open(path).convert('RGB')
    w, h = im.size
    rows = max(1, round(cols * h / w / 2.05))
    small = im.resize((cols, rows), Image.LANCZOS)
    px = small.load()
    lums = []
    for y in range(rows):
        for x in range(cols):
            r, g, b = px[x, y]
            lums.append((0.299 * r + 0.587 * g + 0.114 * b) / 255)
    a, b = auto_levels(lums)
    lines = []
    for y in range(rows):
        line = ''
        for x in range(cols):
            r, g, bb = px[x, y]
            lum = (0.299 * r + 0.587 * g + 0.114 * bb) / 255
            t = (lum - a) / (b - a)
            t = max(0.0, min(1.0, t)) ** 1.1
            line += RAMP[min(len(RAMP) - 1, int(t * (len(RAMP) - 1) + 0.5))]
        lines.append(line)
    return lines


def color_thumb(path, cols=64):
    """按颜色归类成字符：.' 背景 / o 橙 / m 薄荷 / p 粉 / k 深色 / w 白 / y 黄 / b 蓝灰"""
    im = Image.open(path).convert('RGB')
    w, h = im.size
    rows = max(1, round(cols * h / w / 2.05))
    small = im.resize((cols, rows), Image.LANCZOS)
    px = small.load()
    lines = []
    for y in range(rows):
        line = ''
        for x in range(cols):
            r, g, b = px[x, y]
            mx, mn = max(r, g, b), min(r, g, b)
            sat = (mx - mn) / 255
            lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
            if lum < 0.30:
                c = 'k'
            elif lum > 0.93 and sat < 0.10:
                c = 'w'
            elif sat < 0.09:
                c = '.' if lum > 0.78 else ','
            elif r >= g >= b and (r - b) > 40:
                if lum > 0.80:
                    c = 'o'      # 浅橙
                elif lum > 0.55:
                    c = 'O'      # 橙
                else:
                    c = 'r'      # 深红橙
            elif g > r and g > b:
                c = 'm'          # 绿/薄荷
            elif b > r and b > g:
                c = 'b'          # 蓝
            elif r > 150 and b > 120:
                c = 'p'          # 粉紫
            else:
                c = '+'
            line += c
        lines.append(line)
    return lines


def stats(path):
    im = Image.open(path).convert('RGB')
    w, h = im.size
    px = im.load()
    n = 0
    colors = {}
    lums = []
    step = max(1, w // 180)
    for y in range(0, h, step):
        for x in range(0, w, step):
            r, g, b = px[x, y]
            n += 1
            lums.append((0.299 * r + 0.587 * g + 0.114 * b) / 255)
            q = (r // 24, g // 24, b // 24)
            colors[q] = colors.get(q, 0) + 1
    top = sorted(colors.items(), key=lambda kv: -kv[1])[:5]
    top = [('#%02x%02x%02x' % (k[0] * 24 + 12, k[1] * 24 + 12, k[2] * 24 + 12), round(v * 100 / n, 1)) for k, v in top]
    return {
        'size': (w, h),
        'mean_lum': round(sum(lums) / len(lums), 3),
        'lum_std': round((sum((l - sum(lums) / len(lums)) ** 2 for l in lums) / len(lums)) ** 0.5, 3),
        'palette_top': top,
        'unique_colors': len(colors),
    }


def main():
    files = sys.argv[1:] or DEFAULT
    mode = os.environ.get('MODE', 'both')
    for name in files:
        p = os.path.join(SHOTS, name)
        if not os.path.exists(p):
            print('缺失:', name)
            continue
        s = stats(p)
        print('\n=== %s  %dx%d  mean_lum=%.3f  std=%.3f  色数=%d' % (
            name, s['size'][0], s['size'][1], s['mean_lum'], s['lum_std'], s['unique_colors']))
        print('  主色:', ', '.join('%s %s%%' % (c, v) for c, v in s['palette_top']))
        if mode in ('both', 'color'):
            print('  --- 颜色分布 ---')
            for line in color_thumb(p):
                print('  ' + line)
        if mode in ('both', 'luma'):
            print('  --- 明暗 ---')
            for line in thumb(p):
                print('  ' + line)


if __name__ == '__main__':
    main()
