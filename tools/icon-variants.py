"""图标方案试验台：一次出大图 + 真实尺寸（144/96/72/48）预览。

⎯⎯ 为什么要重做 ⎯⎯
上一版被否"简陋"，我加了七样东西（暗角、双层投影、折角明暗、红头两线、
四条墨线、小方印、纸描边）—— 按 Helena Zhang 的七条准则，这是走反了：
"可读性"要求小尺寸下别堆细节，"简洁性"要求每一笔都在说同一件事。
七样东西在 512px 里各自成立，缩到 48px 全糊成一片灰红。

⎯⎯ 这一轮的四条依据 ⎯⎯
1. 明确性 / 可读性 / 校准（Helena Zhang《7 Principles of Icon Design》）
   —— 减元素、加大对比、用眼睛而不是数字校准重心。
2. Closure（暗示形状）：减少视觉重量而保留结构 —— 墨线只给"节奏"，
   不给完整段落；小尺寸下大脑会补全。
3. Android 自适应图标：108 画布 / 66 安全区，前景可以"探出"安全区（bleed），
   被启动器裁掉一部分反而更有张力。
4. 实测：任何方案都要在 48px 下看，不许只看 512px 就下结论。

    python tools/icon-variants.py
"""
from PIL import Image, ImageDraw, ImageFont, ImageOps, ImageFilter
import os
import sys

RED = (178, 58, 46, 255)          # #B23A2E
DEEP = (146, 42, 32, 255)         # 四角
RED_INK = (160, 46, 36, 255)      # 纸上的红（比底深，压得住白纸）
PAPER = (251, 250, 247, 255)
FOLD = (228, 218, 200, 255)
FOLD_EDGE = (198, 181, 156, 255)
THICK = (208, 194, 172, 255)      # 纸的厚度/侧面
INK = (23, 21, 15, 255)
HILIGHT = (255, 255, 255, 235)

SS = 4
BASE = 108
C = BASE / 2

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PREVIEW = os.path.join(ROOT, "preview")
HEI = r"C:\Windows\Fonts\msyh.ttc"

# 每个方案：纸的四边、折角、墨线（x0,y0,宽,高）
PLANS = {
    "A": dict(box=(24, 21, 84, 87), fold=13,
              lines=[(32, 43, 44, 5.0), (32, 54, 38, 3.4), (32, 63, 46, 3.4), (32, 72, 24, 3.4)],
              seal="small"),
    "H": dict(box=(24, 21, 84, 87), fold=13,
              lines=[(32, 44, 46, 6.0), (32, 57, 34, 4.0), (32, 67, 40, 4.0)],
              seal="solid", thick=True),
    "E": dict(box=(20, 16, 88, 92), fold=17,
              lines=[(32, 38, 48, 7.0), (32, 53, 40, 5.0), (32, 65, 44, 5.0), (32, 77, 26, 5.0)],
              seal=None),
}


def background(n):
    base = Image.new("RGBA", (n, n), RED)
    deep = Image.new("RGBA", (n, n), DEEP)
    g = Image.radial_gradient("L").resize((n, n), Image.BILINEAR)
    if g.getpixel((n // 2, n // 2)) > 128:
        g = ImageOps.invert(g)
    g = g.point(lambda v: int((v / 255.0) ** 2.6 * 255 * 0.42))
    return Image.composite(deep, base, g)


def poly_of(box, fold, scale, dx=0.0, dy=0.0):
    x0, y0, x1, y1 = box
    r = 3.0 * scale
    fold = fold * scale

    def T(x, y):
        return (C + (x - C) * scale + dx, C + (y - C) * scale + dy)

    x0, y0 = T(x0, y0)
    x1, y1 = T(x1, y1)
    return [
        (x0 + r, y0), (x1 - fold, y0), (x1, y0 + fold),
        (x1, y1 - r), (x1 - r, y1), (x0 + r, y1), (x0, y1 - r), (x0, y0 + r),
    ]


def draw(scale=1.0, variant="A"):
    p = PLANS[variant]
    n = BASE * SS
    im = background(n)
    d = ImageDraw.Draw(im)

    S = lambda v: v * SS
    P = lambda seq: [(S(x), S(y)) for x, y in seq]
    T = lambda x, y: (C + (x - C) * scale, C + (y - C) * scale)

    def rect(x0, y0, w, h, fill):
        a = T(x0, y0)
        b = T(x0 + w, y0 + h)
        d.rectangle([S(a[0]), S(a[1]), S(b[0]), S(b[1])], fill=fill)

    box, fold = p["box"], p["fold"]

    # 投影：模糊才是"贴上去"，硬投影看起来像第二张纸
    shadow = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).polygon(P(poly_of(box, fold, scale, 0.8, 4.4)), fill=(84, 20, 14, 120))
    shadow = shadow.filter(ImageFilter.GaussianBlur(2.4 * SS))
    im.alpha_composite(shadow)

    # H：纸有厚度 —— 右下露一圈纸的侧面，比投影更能说明"这是实物"
    if p.get("thick"):
        d.polygon(P(poly_of(box, fold, scale, 2.6, 2.6)), fill=THICK)

    body = poly_of(box, fold, scale)
    d.polygon(P(body), fill=PAPER)

    # 顶部受光边：一道细白，最省笔墨的"材质感"
    x0, y0, x1, y1 = box
    hl = [T(x0 + 3, y0), T(x1 - fold, y0)]
    d.line([(S(hl[0][0]), S(hl[0][1])), (S(hl[1][0]), S(hl[1][1]))],
           fill=HILIGHT, width=max(1, int(1.1 * SS * scale)))

    # 折角
    fx, fy = T(x1 - fold, y0)
    ex, ey = T(x1, y0 + fold)
    bx, by = T(x1 - fold, y0 + fold)
    d.polygon([(S(fx), S(fy)), (S(ex), S(ey)), (S(bx), S(by))], fill=FOLD)
    d.line([(S(fx), S(fy)), (S(ex), S(ey))], fill=FOLD_EDGE, width=max(1, int(0.9 * SS * scale)))

    # 墨线：粗细与长短递减 —— 只给"这里有字"的节奏，不画满
    for lx, ly, w, h in p["lines"]:
        rect(lx, ly, w, h, INK)

    # 印章
    if p["seal"] == "solid":
        sx0, sy0 = T(64, 70)
        sx1, sy1 = T(78, 84)
        d.rounded_rectangle([S(sx0), S(sy0), S(sx1), S(sy1)],
                            radius=int(2 * SS * scale), fill=RED_INK)
        for ly in (74.5, 79.0):
            a = T(67.5, ly)
            b = T(74.5, ly + 1.6)
            d.rectangle([S(a[0]), S(a[1]), S(b[0]), S(b[1])], fill=PAPER)
    elif p["seal"] == "small":
        sx0, sy0 = T(60, 70)
        sx1, sy1 = T(76, 86)
        d.rounded_rectangle([S(sx0), S(sy0), S(sx1), S(sy1)],
                            radius=int(1.5 * SS * scale),
                            outline=RED_INK, width=max(2, int(1.6 * SS * scale)))
        rect(64, 74, 8, 8, RED_INK)
    return im


def card(label, im, size=340):
    pad = 14
    cv = Image.new("RGBA", (size + pad * 2, size + pad * 2 + 30), (242, 237, 229, 255))
    cv.alpha_composite(im.resize((size, size), Image.LANCZOS), (pad, pad))
    ImageDraw.Draw(cv).text((cv.width / 2, size + pad + 10), label,
                            font=ImageFont.truetype(HEI, 18), fill=(58, 54, 48, 255), anchor="mm")
    return cv


def main():
    os.makedirs(PREVIEW, exist_ok=True)
    order = ["A", "H", "E"]
    label = {"A": "A 现在这版", "H": "H 厚纸 + 实心印", "E": "E 大张纸"}

    cards = [card(label[v], draw(1.0, v)) for v in order]
    gap = 18
    small_h = 150
    top = 22
    W = sum(c.width for c in cards) + gap * (len(cards) - 1) + 44
    Hh = top + cards[0].height + 26 + small_h + 26
    out = Image.new("RGB", (W, Hh), (242, 237, 229))
    dr = ImageDraw.Draw(out)

    x = 22
    for c in cards:
        out.paste(c, (x, top))
        x += c.width + gap

    # 真实尺寸：启动器上就是这么小，糊了就认不出来
    f = ImageFont.truetype(HEI, 15)
    for i, v in enumerate(order):
        im = draw(1.0, v)
        cx = 22 + i * (cards[0].width + gap) + cards[0].width // 2
        y = top + cards[0].height + 40
        xx = cx - (144 + 96 + 72 + 48 + 3 * 12) // 2
        for s in (144, 96, 72, 48):
            out.paste(im.resize((s, s), Image.LANCZOS).convert("RGB"), (xx, y + (small_h - 40 - s) // 2))
            dr.text((xx + s / 2, y + small_h - 26), str(s), font=f, fill=(120, 114, 104, 255), anchor="mm")
            xx += s + 12

    path = os.path.join(PREVIEW, "icon-plans.png")
    out.save(path, "PNG", optimize=True)
    for v in order:
        draw(1.0, v).resize((512, 512), Image.LANCZOS).save(
            os.path.join(PREVIEW, f"icon-{v}.png"), "PNG", optimize=True)
    print(f"OK: {path} ({out.width}x{out.height})")


if __name__ == "__main__":
    sys.exit(main())