"""Post-process the six generated stills into one graded set.

同一晚、同一盏灯：把六张生成图统一调到同一色温、把暗部压向 --room 的近黑酒红、
铺同一份 35mm 颗粒，再按展示尺寸导出为正式资产。

Usage: uv run --with pillow --with numpy grade.py
"""
import numpy as np
from PIL import Image

SRC = "output/imagegen"
DST = "assets/img"

ROOM = np.array([0.078, 0.035, 0.051], dtype=np.float32)  # #14090D
LUMA = np.array([0.299, 0.587, 0.114], dtype=np.float32)


def grade(src, dst, size, sat, warmth, grain, jpg_quality=None, expo=1.0):
    im = Image.open(f"{SRC}/{src}").convert("RGB")
    if size:
        im = im.resize(size, Image.LANCZOS)
    x = np.asarray(im).astype(np.float32) / 255.0

    x = np.clip(x * expo, 0, 1)  # 曝光配平：三张缩略图不排成左暗右亮的坡

    gray = x @ LUMA
    x = gray[..., None] + (x - gray[..., None]) * sat

    x[..., 0] = np.clip(x[..., 0] * warmth, 0, 1)
    x[..., 2] = np.clip(x[..., 2] * (2 - warmth), 0, 1)

    # 暗部融进房间的底色：黑不再是照片自己的黑，而是这间房的黑
    lum = x @ LUMA
    shadow = np.clip(1.0 - lum[..., None] / 0.35, 0, 1) ** 1.6
    x = x * (1 - shadow * 0.5) + ROOM * shadow * 0.5

    # 轻微 S 曲线收 contrast，不推亮部
    x = np.clip(x, 0, 1)
    x = x * x * (3 - 2 * x) * 0.22 + x * 0.78

    rng = np.random.default_rng(42)
    g = rng.normal(0, grain / 255.0, x.shape[:2])[..., None]
    x = np.clip(x + g, 0, 1)

    out = Image.fromarray((x * 255).astype(np.uint8))
    if dst.endswith(".jpg"):
        out.save(f"{DST}/{dst}", quality=jpg_quality, optimize=True, progressive=True)
    else:
        out.save(f"{DST}/{dst}", optimize=True)
    print(f"{src} -> {dst}")


# hero：设置屏（床头柜上的两杯酒）与首页（床上的手机）两张不同场景
grade("hero-settings-raw.png", "hotel.jpg", (1024, 1536), sat=0.92, warmth=1.05, grain=8.0, jpg_quality=84)
grade("hero-home-raw.png", "hotel-home.jpg", (1024, 1536), sat=0.92, warmth=1.05, grain=8.0, jpg_quality=84)

# 缩略图：同一套参数，棋盘多压一档饱和把蓝黄收进色板
grade("thumb-tod-raw.png", "game-tod.jpg", (768, 768), sat=0.90, warmth=1.05, grain=8.0, jpg_quality=84)
grade("thumb-dice-raw.png", "game-dice.jpg", (768, 768), sat=0.90, warmth=1.05, grain=8.0, jpg_quality=84, expo=1.06)
grade("thumb-wheel-raw.png", "game-wheel.jpg", (768, 768), sat=0.85, warmth=1.05, grain=8.0, jpg_quality=84, expo=0.96)
grade("thumb-board-raw.png", "game-board.jpg", (768, 768), sat=0.60, warmth=1.10, grain=8.0, jpg_quality=84, expo=0.78)
