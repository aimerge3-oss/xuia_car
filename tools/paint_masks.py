"""Маски кузова для перекраски машин.

Для каждого фото img/cars/<id>.webp находит пиксели кузова (цвет как у дверей; без стёкол, шин,
фар и хрома) и сохраняет маску img/paint/<id>.webp + яркость кузова в js/paint.js.
В игре перекраска меняет цвет только под маской и сохраняет блики и тени.

  python tools/paint_masks.py             # все машины
  python tools/paint_masks.py supra r34   # только эти
  python tools/paint_masks.py --preview   # плюс картинка-проверка img/paint_check.png (в git не нужна)

Нужно: pip install numpy scipy scikit-image pillow
"""
import json
import os
import re
import sys

import numpy as np
from PIL import Image
from scipy import ndimage
from skimage import color

SRC, DST = 'img/cars', 'img/paint'


def body_mask(rgba):
    rgb = rgba[..., :3] / 255.0
    alpha = rgba[..., 3] > 200
    h, w = alpha.shape
    lab = color.rgb2lab(rgb)
    L, a, b = lab[..., 0], lab[..., 1], lab[..., 2]
    C = np.hypot(a, b)
    H = np.degrees(np.arctan2(b, a)) % 360

    # образец цвета — «двери»: середина машины по высоте и ширине
    ys, xs = np.mgrid[0:h, 0:w]
    sample = alpha & (ys > h * 0.40) & (ys < h * 0.72) & (xs > w * 0.22) & (xs < w * 0.78)
    sc = C[sample]
    chromatic = np.median(sc) > 16

    if chromatic:
        # цветная машина: кузов — пиксели с похожим оттенком
        hs = H[sample & (C > 14)]
        ref = np.degrees(np.angle(np.mean(np.exp(1j * np.radians(hs))))) % 360
        dh = np.abs((H - ref + 180) % 360 - 180)
        mask = alpha & (C > 11) & (dh < 24)
    else:
        # белая/серая/металлик/чёрная машина: близость по цвету в Lab, яркость сильно варьируется из-за бликов
        ref_l = float(np.median(L[sample]))
        ref_a = float(np.median(a[sample]))
        ref_b = float(np.median(b[sample]))
        dark = ref_l < 40
        kl = 1.6 if dark else 2.6           # насколько терпимы к перепадам яркости
        d = np.sqrt(((L - ref_l) / kl) ** 2 + (a - ref_a) ** 2 + (b - ref_b) ** 2)
        mask = alpha & (d < (13 if dark else 15))


    # чистка: убрать мелкие пятна, закрыть мелкие дырки (стёкла остаются дырами — они большие)
    mask = ndimage.binary_opening(mask, iterations=2)
    lbl, n = ndimage.label(mask)
    if n:
        sizes = ndimage.sum(mask, lbl, range(1, n + 1))
        keep = np.isin(lbl, 1 + np.nonzero(sizes > mask.size * 0.004)[0])
        mask = keep
    mask = ndimage.binary_closing(mask, iterations=2) & alpha
    # кузов — один большой цельный кусок; диски окружены чёрной шиной и стоят отдельными пятнами — их убираем
    lbl, n = ndimage.label(mask)
    if n > 1:
        sizes = ndimage.sum(mask, lbl, range(1, n + 1))
        mask = np.isin(lbl, 1 + np.nonzero(sizes >= sizes.max() * 0.15)[0])
    filled = ndimage.binary_fill_holes(mask)
    holes, nh = ndimage.label(filled & ~mask)
    if nh:
        hs = ndimage.sum(np.ones_like(mask), holes, range(1, nh + 1))
        small = np.isin(holes, 1 + np.nonzero(hs < mask.size * 0.003)[0])
        mask |= small

    # средняя яркость кузова — для сохранения теней при перекраске
    lum = (0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2])
    base = float(np.median(lum[mask])) if mask.any() else 0.5
    soft = ndimage.gaussian_filter(mask.astype(float), 0.8)
    return soft, base, chromatic


def recolor(rgba, soft, base, target):
    """То же, что делает игра: новый цвет × затенение, блики уходят в белый."""
    rgb = rgba[..., :3].astype(float) / 255.0
    lum = 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]
    s = lum / max(base, 0.05)
    t = np.array(target, float) / 255.0
    dark = t[None, None, :] * np.clip(s, 0, 1)[..., None]
    hi = np.clip((s - 1) / max(1 / max(base, 0.05) - 1, 1e-3), 0, 1)[..., None]
    out = np.where((s > 1)[..., None], t + (1 - t) * hi, dark)
    m = soft[..., None]
    res = rgb * (1 - m) + out * m
    o = rgba.copy()
    o[..., :3] = np.clip(res * 255, 0, 255).astype(np.uint8)
    return o


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    os.makedirs(DST, exist_ok=True)
    meta_path = 'js/paint.js'
    meta = {}
    if os.path.exists(meta_path):
        m = re.search(r'=\s*(\{.*\});', open(meta_path, encoding='utf8').read(), re.S)
        if m:
            meta = json.loads(m.group(1))
    files = sorted(f for f in os.listdir(SRC) if f.endswith('.webp') and (not args or f[:-5] in args))
    previews = []
    for f in files:
        cid = f[:-5]
        rgba = np.array(Image.open(os.path.join(SRC, f)).convert('RGBA'))
        soft, base, chromatic = body_mask(rgba)
        Image.fromarray((soft * 255).astype(np.uint8), 'L').save(os.path.join(DST, cid + '.webp'), 'WEBP', quality=70, method=6)
        meta[cid] = round(base, 3)
        previews.append((cid, rgba, soft, base))
        print(cid, 'цветная' if chromatic else 'без цвета', 'база', round(base, 2), 'кузов', f'{soft.mean() / (rgba[..., 3] > 200).mean() * 100:.0f}%')
    with open(meta_path, 'w', encoding='utf8') as fh:
        fh.write('// Яркость кузова на фото (для перекраски). Создано tools/paint_masks.py\n')
        fh.write('const PAINT_BASE = ' + json.dumps(meta, sort_keys=True) + ';\n')
    if '--preview' in sys.argv:
        # каждая машина: оригинал и красная, по 3 пары в ряд
        cw, ch, per = 190, 82, 3
        rows = (len(previews) + per - 1) // per
        sheet = Image.new('RGB', (cw * 2 * per, ch * rows), (30, 32, 36))
        for k, (cid, rgba, soft, base) in enumerate(previews):
            for j, im in enumerate([rgba, recolor(rgba, soft, base, (200, 30, 40))]):
                im = Image.fromarray(im)
                im.thumbnail((cw - 8, ch - 8))
                sheet.paste(im, (((k % per) * 2 + j) * cw + 4, (k // per) * ch + 4), im)
        sheet.save('img/paint_check.png')


if __name__ == '__main__':
    main()
