"""
把一张纯色/近似纯色背景的宠物图抠成透明 PNG，裁边并按高度缩放。

用法：
    pip install pillow numpy
    python tools/prep-cat.py 你的图.png [输出文件名]

默认按"紫色噪声背景 + 橙白猫"调的色相区间（H≈172-245 / 0-255 刻度）。
换别的背景色，改下面的 HUE_LO / HUE_HI 就行。
"""
import sys, os
import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', '喵同学.png')
OUT_NAME = sys.argv[2] if len(sys.argv) > 2 else 'cat.png'
OUT_DIR = os.path.join(HERE, '..', 'assets', 'pet')
OUT = os.path.join(OUT_DIR, OUT_NAME)

HUE_LO, HUE_HI = 172, 245

def main():
    img = Image.open(SRC).convert('RGBA')
    rgb = img.convert('RGB')
    hsv = np.array(rgb.convert('HSV'), dtype=np.float32)
    H, S, V = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]

    # 紫色色相区间（0-255 刻度）
    purple = ((H >= HUE_LO) & (H <= HUE_HI)).astype(np.float32)

    # 饱和度越低越可能是猫（白毛），用饱和度和明度做软过渡，保住边缘抗锯齿
    sat_ramp = np.clip((S - 40.0) / 90.0, 0, 1)      # S<40 全保留，S>130 全判背景
    val_ramp = np.clip((V - 25.0) / 40.0, 0, 1)
    alpha = 1.0 - purple * sat_ramp * val_ramp

    a = (alpha * 255).astype(np.uint8)
    arr = np.array(img)
    arr[:, :, 3] = a
    out = Image.fromarray(arr, 'RGBA')

    # 去掉边缘残留的紫边：对 alpha 做一次轻微收缩 + 羽化
    alpha_img = out.getchannel('A').filter(ImageFilter.MinFilter(3))
    alpha_img = alpha_img.filter(ImageFilter.GaussianBlur(0.8))
    out.putalpha(alpha_img)

    # 裁到内容边界
    bbox = out.split()[3].point(lambda p: 255 if p > 8 else 0).getbbox()
    if bbox:
        pad = 6
        bbox = (max(0, bbox[0] - pad), max(0, bbox[1] - pad),
                min(out.width, bbox[2] + pad), min(out.height, bbox[3] + pad))
        out = out.crop(bbox)

    # 统一高度，宽度按比例
    target_h = 520
    ratio = target_h / out.height
    out = out.resize((max(1, round(out.width * ratio)), target_h), Image.LANCZOS)

    os.makedirs(OUT_DIR, exist_ok=True)
    out.save(OUT, 'PNG')
    print(f'输出 {OUT}  {out.width}x{out.height}')

if __name__ == '__main__':
    main()
