"""生成应用图标（Android mipmap + 网页 favicon 用的 PNG）。

设计说明
--------
深墨黑底上贴着一张米白的通知单：左侧不留竖边，右上折一个角，纸上是三行
粗细递减的墨线，右下压一枚朱红实心小印。纸的右下露出一圈侧面 —— 那点"厚度"
是它看起来像实物而不是色块的全部原因。

配色取自 App 深色模式的暖黑（#151311 / #231F1B 一族），不是冷灰蓝：
底 #1C1917、纸 #FBFAF7、印 #BE4234、折角背面 #E2D8C6。

为什么是这套：见 docs/icon-design.md。三条硬约束 ——
  · 元素之间的间隙必须够（Helena Zhang《7 Principles of Icon Design》）
  · 任何方案要在 48dp 下看，不许只看 512px 就下结论
  · 用"厚度/受光"这些结构性事实造层次，别靠往上堆细节

为什么用 PIL 超采样而不是直接画：斜线（折角）与圆角在小尺寸下必须抗锯齿，
4 倍超采样再 LANCZOS 缩下来，边缘比任何 drawable 都干净，且不依赖任何运行时。

用法：
    python tools/make-icon.py
"""
from PIL import Image, ImageDraw, ImageFilter
import os
import sys

# ---- 深色主题（与 Android 深色模式同一族暖黑）----
BG = (28, 25, 23, 255)          # #1C1917 墨黑
BG_DEEP = (18, 16, 14, 255)     # #12100E 四角
PAPER = (251, 250, 247, 255)    # #FBFAF7
FOLD = (226, 216, 198, 255)     # #E2D8C6 折角背面
FOLD_EDGE = (176, 163, 142, 255)  # #B0A38E 折线
THICK = (196, 184, 164, 255)    # #C4B8A4 纸的侧面
RED_INK = (190, 66, 52, 255)    # #BE4234 朱印
INK = (23, 21, 15, 255)         # #17150F 墨
HILIGHT = (255, 255, 255, 215)

SS = 4                          # 超采样倍数
BASE = 108                      # 设计网格：与 VectorDrawable 的 viewport 一致
CENTER = BASE / 2

# 纸的四边 / 折角 / 三行墨线（x, y, 宽, 高）
BOX = (24, 21, 84, 87)
FOLD_SIZE = 13
LINES = [(32, 44, 46, 6.0), (32, 57, 34, 4.0), (32, 67, 40, 4.0)]

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES = os.path.join(ROOT, "android", "app", "src", "main", "res")
DOCS = os.path.join(ROOT, "docs")

SIZES = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}


def _radial(n):
    """径向遮罩：中心 0、四角 255（手算，不用已弃用的 Image.radial_gradient）。"""
    s = 72
    small = Image.new("L", (s, s))
    px = small.load()
    c = (s - 1) / 2.0
    for y in range(s):
        for x in range(s):
            d = (((x - c) ** 2 + (y - c) ** 2) ** 0.5) / (c * 1.4142)
            px[x, y] = int(min(1.0, d) ** 2.6 * 255 * 0.5)
    return small.resize((n, n), Image.BILINEAR)


def background(n):
    """墨黑底 + 极淡径向暗角：中心略亮，四角沉下去。"""
    base = Image.new("RGBA", (n, n), BG)
    deep = Image.new("RGBA", (n, n), BG_DEEP)
    return Image.composite(deep, base, _radial(n))


def poly(scale=1.0, dx=0.0, dy=0.0):
    x0, y0, x1, y1 = BOX
    r = 3.0 * scale
    fold = FOLD_SIZE * scale

    def T(x, y):
        return (CENTER + (x - CENTER) * scale + dx, CENTER + (y - CENTER) * scale + dy)

    x0, y0 = T(x0, y0)
    x1, y1 = T(x1, y1)
    return [
        (x0 + r, y0), (x1 - fold, y0), (x1, y0 + fold),
        (x1, y1 - r), (x1 - r, y1), (x0 + r, y1), (x0, y1 - r), (x0, y0 + r),
    ]


def draw_icon(scale_content=1.0):
    """在 108×108 网格上画一张图（超采样后返回 Image）。

    scale_content < 1 时把内容整体缩到中心 —— 给 adaptive icon 的 safe zone
    以及 maskable 用图准备（圆/方裁切都不会切掉内容）。
    """
    n = BASE * SS
    im = background(n)
    d = ImageDraw.Draw(im)
    s = scale_content

    def S(v):
        return v * SS

    def P(seq):
        return [(S(x), S(y)) for x, y in seq]

    def T(x, y):
        return (CENTER + (x - CENTER) * s, CENTER + (y - CENTER) * s)

    def rect(x, y, w, h, fill):
        a, b = T(x, y), T(x + w, y + h)
        d.rectangle([S(a[0]), S(a[1]), S(b[0]), S(b[1])], fill=fill)

    # ---- 投影：模糊才有"贴上去"的意思，硬投影看着像第二张纸 ----
    shadow = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).polygon(P(poly(s, 0.8, 4.4 * s)), fill=(0, 0, 0, 165))
    im.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(2.4 * SS)))

    # ---- 纸的厚度：右下露一圈侧面，一个几何事实交代"这是实物" ----
    d.polygon(P(poly(s, 2.6 * s, 2.6 * s)), fill=THICK)

    body = poly(s)
    d.polygon(P(body), fill=PAPER)

    # 顶部受光边：最省笔墨的材质感
    x0, y0, x1, y1 = BOX
    a, b = T(x0 + 3, y0), T(x1 - FOLD_SIZE, y0)
    d.line([(S(a[0]), S(a[1])), (S(b[0]), S(b[1]))],
           fill=HILIGHT, width=max(1, int(1.1 * SS * s)))

    # ---- 折角 ----
    fold = FOLD_SIZE * s
    fx, fy = T(x1 - FOLD_SIZE, y0)
    ex, ey = T(x1, y0 + FOLD_SIZE)
    bx, by = T(x1 - FOLD_SIZE, y0 + FOLD_SIZE)
    d.polygon([(S(fx), S(fy)), (S(ex), S(ey)), (S(bx), S(by))], fill=FOLD)
    d.line([(S(fx), S(fy)), (S(ex), S(ey))],
           fill=FOLD_EDGE, width=max(1, int(0.9 * SS * s)))

    # ---- 三行墨线：粗细与长短递减，只给"这里有字"的节奏 ----
    for lx, ly, w, h in LINES:
        rect(lx, ly, w, h, INK)

    # ---- 朱红实心小印：小尺寸下唯一清楚的重音 ----
    sx0, sy0 = T(64, 70)
    sx1, sy1 = T(78, 84)
    d.rounded_rectangle([S(sx0), S(sy0), S(sx1), S(sy1)],
                        radius=int(2 * SS * s), fill=RED_INK)
    for ly in (74.5, 79.0):
        a, b = T(67.5, ly), T(74.5, ly + 1.6)
        d.rectangle([S(a[0]), S(a[1]), S(b[0]), S(b[1])], fill=PAPER)

    return im


def save_square(im, size, path, round_ratio=0.0):
    """缩放保存。round_ratio>0 时把四角削圆。"""
    out = im.resize((size, size), Image.LANCZOS)
    if round_ratio > 0:
        mask = Image.new("L", (size * 4, size * 4), 0)
        ImageDraw.Draw(mask).rounded_rectangle(
            [0, 0, size * 4 - 1, size * 4 - 1], radius=int(size * 4 * round_ratio), fill=255,
        )
        mask = mask.resize((size, size), Image.LANCZOS)
        out.putalpha(mask)
    out.save(path, "PNG", optimize=True)
    return out


def main():
    full = draw_icon(1.0)          # 满幅
    safe = draw_icon(0.72)         # 缩进安全区（maskable 用）

    for folder, size in SIZES.items():
        d = os.path.join(RES, folder)
        os.makedirs(d, exist_ok=True)
        save_square(full, size, os.path.join(d, "ic_launcher.png"))
        save_square(safe, size, os.path.join(d, "ic_maskable.png"))
        print(f"  {folder}/ic_launcher.png  {size}x{size}")

    os.makedirs(DOCS, exist_ok=True)
    save_square(full, 512, os.path.join(DOCS, "icon-512.png"))
    save_square(full, 192, os.path.join(DOCS, "icon-192.png"))
    save_square(safe, 512, os.path.join(DOCS, "icon-maskable-512.png"))
    save_square(full, 180, os.path.join(DOCS, "apple-touch-icon.png"))
    save_square(full, 32, os.path.join(DOCS, "favicon-32.png"))
    print("  docs/icon-512.png / icon-192.png / icon-maskable-512.png / apple-touch-icon.png / favicon-32.png")

    full.resize((64, 64), Image.LANCZOS).save(
        os.path.join(DOCS, "favicon.ico"), sizes=[(16, 16), (32, 32), (48, 48), (64, 64)],
    )
    print("  docs/favicon.ico")

    # ---- 自检：底色是墨黑系、纸在、印是朱红 ----
    px = full.load()
    corner = px[2 * SS, 2 * SS]
    paper = px[40 * SS, 40 * SS]
    seal = px[71 * SS, 77 * SS]
    print(f"check corner={corner} paper={paper} seal={seal}")
    lo = (BG_DEEP[0], BG_DEEP[1], BG_DEEP[2])
    hi = (BG[0], BG[1], BG[2])
    assert all(lo[i] <= corner[i] <= hi[i] for i in range(3)), f"corner not ink-black: {corner[:3]}"
    assert paper[:3] == PAPER[:3], f"paper not #FBFAF7: {paper[:3]}"
    assert seal[:3] == RED_INK[:3], f"seal not #BE4234: {seal[:3]}"

    # ---- 48dp 可读性：沿纸内一列数暗块，三段墨线必须都在 ----
    for size in (48, 96):
        small = full.resize((size, size), Image.LANCZOS).convert("RGB")
        p = small.load()
        x = int(round(42 * size / BASE))
        runs, cur = [], 0
        for y in range(int(round(34 * size / BASE)), int(round(86 * size / BASE))):
            r, g, b = p[x, y]
            if r < 110 and g < 110 and b < 110:
                cur += 1
            elif cur:
                runs.append(cur)
                cur = 0
        if cur:
            runs.append(cur)
        print(f"  {size}px lines={len(runs)} runs={runs}")
        assert len(runs) == 3, f"at {size}px only {len(runs)} line(s) left"
    print("OK: icon generated")


if __name__ == "__main__":
    sys.exit(main())