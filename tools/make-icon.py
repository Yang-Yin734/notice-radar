"""生成应用图标（Android mipmap + 网页 favicon 用的 PNG）。

设计说明
--------
应用是「把高校官网通知变成信息流」，界面走的是**公告栏/教务处的纸**这一路：
暖白纸 + 墨黑字 + 朱红印章。图标沿用同一套色，不引入任何渐变、玻璃、3D —— 那些
正是"AI 味"的来源。

构图：一枚朱红底，上面贴着一张米白的通知单。
  · 左侧一道朱红竖边 —— 红头文件 / 教务处的纸
  · 右上角折角 —— "这是张纸"最省笔墨的符号，48dp 下仍然认得出
  · 三条墨线 —— 标题粗、正文细，读得出"有内容"而不是空白
  · 底色与 App 的未读点同色，所以它在桌面上是"一个红点"的记忆点

为什么用 PIL 超采样而不是直接画：斜线（折角）与圆角在小尺寸下必须抗锯齿，
4 倍超采样再 LANCZOS 缩下来，边缘比任何 drawable 都干净，且不依赖任何运行时。

用法：
    python tools/make-icon.py
"""
from PIL import Image, ImageDraw
import os
import sys

# 与 App 的令牌保持同值（Tokens.kt / dashboard.ts 里那套）
RED = (178, 58, 46, 255)        # #B23A2E 砖红
PAPER = (251, 250, 247, 255)    # #FBFAF7 纸
FOLD = (224, 214, 196, 255)     # #E0D6C4 折角的背面
INK = (23, 21, 15, 255)         # #17150F 墨

SS = 4                          # 超采样倍数
BASE = 108                      # 设计网格：与 VectorDrawable 的 viewport 一致

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES = os.path.join(ROOT, "android", "app", "src", "main", "res")
DOCS = os.path.join(ROOT, "docs")

# 各档位目录 → 边长（dp 1x = 48，Android 的 launcher icon 标准尺寸）
SIZES = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}


def draw_icon(scale_content=1.0):
    """在 108×108 网格上画一张图（超采样后返回 Image）。

    scale_content < 1 时把内容整体缩到中心 —— 给 adaptive icon 的 safe zone
    以及 maskable 用图准备（圆/方裁切都不会切掉内容）。
    """
    n = BASE * SS
    im = Image.new("RGBA", (n, n), RED)
    d = ImageDraw.Draw(im)

    def S(v):
        return v * SS

    def pts(seq):
        return [(S(x), S(y)) for x, y in seq]

    # 内容整体缩放（绕中心）
    def T(x, y):
        cx = cy = BASE / 2
        return (cx + (x - cx) * scale_content, cy + (y - cy) * scale_content)

    # ---- 纸：右上角切一个 12×12 的斜角（折角），其余三角圆角 ----
    # 占满自适应图标的安全方（66×66）：太小就只剩一块红底，看不出是张纸
    px0, py0, px1, py1 = 19, 20, 81, 86
    fold = 12
    if scale_content != 1.0:
        px0, py0 = T(px0, py0)
        px1, py1 = T(px1, py1)
        fold = fold * scale_content
    paper = [
        (px0 + 3, py0),
        (px1 - fold, py0),
        (px1, py0 + fold),
        (px1, py1 - 3),
        (px1 - 3, py1),
        (px0 + 3, py1),
        (px0, py1 - 3),
        (px0, py0 + 3),
    ]
    d.polygon(pts(paper), fill=PAPER)

    # ---- 折角：三角形填背面色 ----
    d.polygon(
        pts([(px1 - fold, py0), (px1, py0 + fold), (px1 - fold, py0 + fold)]),
        fill=FOLD,
    )

    # ---- 左侧朱红竖边（与底色同色，视觉上等于把纸"切"出一道红边）----
    bar_x1 = 25
    if scale_content != 1.0:
        bar_x1 = T(bar_x1, 0)[0]
    d.rectangle(
        [S(px0) - SS, S(py0) - SS, S(bar_x1), S(py1) + SS],
        fill=RED,
    )
    # 红边右缘与纸交界处补一条纸色细线，避免红压到圆角外的背景上看起来"缺一块"
    d.rectangle(
        [S(bar_x1) - SS, S(py0) - SS, S(bar_x1), S(py1) + SS],
        fill=PAPER,
    )

    # ---- 三条墨线：标题粗，正文细 ----
    lines = [
        (34, 36, 74, 6),
        (34, 50, 64, 5),
        (34, 61, 70, 5),
        (34, 72, 50, 5),
    ]
    for x0, y0, x1, h in lines:
        if scale_content != 1.0:
            x0, y0 = T(x0, y0)
            x1 = T(x1, 0)[0]
            h = h * scale_content
        d.rectangle([S(x0), S(y0), S(x1), S(y0 + h)], fill=INK)

    return im


def save_square(im, size, path, round_ratio=0.0):
    """缩放保存。round_ratio>0 时把四角削圆（旧系统 launcher 用）。"""
    out = im.resize((size, size), Image.LANCZOS)
    if round_ratio > 0:
        mask = Image.new("L", (size * 4, size * 4), 0)
        ImageDraw.Draw(mask).rounded_rectangle(
            [0, 0, size * 4 - 1, size * 4 - 1], radius=int(size * 4 * round_ratio),
            fill=255,
        )
        mask = mask.resize((size, size), Image.LANCZOS)
        out.putalpha(mask)
    out.save(path, "PNG", optimize=True)
    return out


def main():
    full = draw_icon(1.0)          # 满幅（自适应图标前景/背景合成后的样子）
    safe = draw_icon(0.72)         # 缩进安全区（maskable 用）

    # --- Android mipmap ---
    for folder, size in SIZES.items():
        d = os.path.join(RES, folder)
        os.makedirs(d, exist_ok=True)
        # ic_launcher.png：方块（旧系统直接用，不削角 —— 各家 launcher 自己裁）
        save_square(full, size, os.path.join(d, "ic_launcher.png"))
        # ic_maskable.png：内容缩进安全区，四周留底色
        save_square(safe, size, os.path.join(d, "ic_maskable.png"))
        print(f"  {folder}/ic_launcher.png  {size}x{size}")

    # --- 网页 / README 用的大图 ---
    os.makedirs(DOCS, exist_ok=True)
    save_square(full, 512, os.path.join(DOCS, "icon-512.png"))
    save_square(full, 192, os.path.join(DOCS, "icon-192.png"))
    # maskable：PWA 的 Android 启动器会把它裁成圆形，内容必须缩进安全区
    save_square(safe, 512, os.path.join(DOCS, "icon-maskable-512.png"))
    save_square(full, 180, os.path.join(DOCS, "apple-touch-icon.png"))
    save_square(full, 32, os.path.join(DOCS, "favicon-32.png"))
    print("  docs/icon-512.png / icon-192.png / apple-touch-icon.png / favicon-32.png")

    # --- favicon.ico（多尺寸塞进一个文件）---
    full.resize((64, 64), Image.LANCZOS).save(
        os.path.join(DOCS, "favicon.ico"),
        sizes=[(16, 16), (32, 32), (48, 48), (64, 64)],
    )
    print("  docs/favicon.ico")

    # --- 自检：底色真的是砖红、纸真的在 ---
    # 直接在超采样原图上取样（缩放后 LANCZOS 会混入邻近像素，取到的不是纯色）
    px = full.load()
    corner = px[2 * SS, 2 * SS]          # 左上角：纯底色
    paper = px[70 * SS, 45 * SS]         # 纸面、两条墨线之间的空白
    fold = px[73 * SS, 29 * SS]          # 折角三角内部（斜线左下方）
    ink = px[50 * SS, 38 * SS]           # 第一条墨线
    print(f"自检 角落={corner} 纸面={paper} 折角={fold} 墨线={ink}")
    for name, got, want in (
        ("角落", corner, RED),
        ("纸面", paper, PAPER),
        ("折角", fold, FOLD),
        ("墨线", ink, INK),
    ):
        assert got[:3] == want[:3], f"{name}不是 {want[:3]}，实际 {got[:3]}"
    print("OK: icon generated")


if __name__ == "__main__":
    sys.exit(main())
