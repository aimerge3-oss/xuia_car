"""Тонировка стёкол на фото белых машин — чтобы при покраске стёкла не красились.

Берёт уже вырезанное фото img/cars/<id>.webp, находит стёкла и затемняет их (блики остаются).
Как находит: в верхней части машины (выше линии дверей) всё, что заметно темнее белого кузова,
и замкнутые области внутри тёмных рамок — это стёкла; отверстия в них (блики) заливаются.

  python tools/tint_windows.py jolion bydhan          # затонировать эти машины
  python tools/tint_windows.py jolion --preview       # только картинка-проверка img/tint_check.png

Оригиналы сохраняются в img/cars_untinted/ (в git не нужны).
"""
import os
import shutil
import sys

import numpy as np
from PIL import Image
from scipy import ndimage
from skimage import color

SRC = 'img/cars'
BACKUP = 'img/cars_untinted'


def window_mask(rgba):
    rgb = rgba[..., :3] / 255.0
    alpha = rgba[..., 3] > 200
    h, w = alpha.shape
    L = color.rgb2lab(rgb)[..., 0]
    ys, xs = np.nonzero(alpha)
    top, bottom = ys.min(), ys.max()
    left, right = xs.min(), xs.max()
    H = bottom - top
    # яркость кузова — по нижней половине машины (двери), без колёс
    lower = alpha.copy()
    lower[: top + int(H * 0.45)] = False
    lower[top + int(H * 0.72):] = False
    body_L = np.percentile(L[lower], 70)

    # полоса стёкол: от крыши до линии дверей (~0.5 высоты), без самых краёв машины
    band = np.zeros_like(alpha)
    band[top: top + int(H * 0.52)] = True
    band[:, : left + int((right - left) * 0.04)] = False
    band[:, right - int((right - left) * 0.04):] = False
    band &= ndimage.binary_erosion(alpha, iterations=3)

    dark = alpha & (L < body_L - 9)
    darker = band & dark
    # убираем мелочь (ручки, зеркала, швы)
    darker = ndimage.binary_opening(darker, iterations=2)
    lab, n = ndimage.label(darker)
    min_area = 0.0035 * (right - left) * H
    keep = np.zeros_like(alpha)
    for i, sl in enumerate(ndimage.find_objects(lab)):
        comp = lab[sl] == i + 1
        # стекло — заметная по высоте область, а не тонкая полоска молдинга
        if comp.sum() >= min_area and (sl[0].stop - sl[0].start) >= 0.07 * H:
            keep[sl] |= comp
    # светлые (прозрачные) стёкла: светлые области в тёмной рамке, не связанные с кузовом внизу
    bright = alpha & ~ndimage.binary_dilation(dark, iterations=1)
    blab, bn = ndimage.label(bright)
    body_ids = set(np.unique(blab[top + int(H * 0.55): top + int(H * 0.75)])) - {0}
    for i, sl in enumerate(ndimage.find_objects(blab)):
        if i + 1 in body_ids:
            continue
        comp = blab[sl] == i + 1
        cy = sl[0].start + (sl[0].stop - sl[0].start) / 2
        if comp.sum() >= min_area and cy < top + H * 0.45:
            keep[sl] |= comp
    # блики внутри стекла — заливаем дыры, а края чуть «доращиваем»
    keep = ndimage.binary_closing(keep, iterations=4)
    keep = ndimage.binary_fill_holes(keep)
    keep &= band
    return keep, body_L


def tint(rgba, mask):
    out = rgba.copy().astype(float)
    rgb = out[..., :3]
    lum = rgb.mean(axis=2, keepdims=True)
    # тёмное стекло: от исходной яркости остаётся немного — видны блики
    dark = 18 + (lum - lum[mask].min()) * 0.28
    tinted = np.clip(dark * np.array([0.92, 0.97, 1.05]), 0, 255)
    soft = ndimage.gaussian_filter(mask.astype(float), 1.2)[..., None]
    rgb[:] = rgb * (1 - soft) + tinted * soft
    return np.clip(out, 0, 255).astype(np.uint8)


def main():
    args = sys.argv[1:]
    preview = '--preview' in args
    ids = [a for a in args if not a.startswith('--')]
    os.makedirs(BACKUP, exist_ok=True)
    tiles = []
    for cid in ids:
        src = os.path.join(BACKUP, cid + '.webp')
        if not os.path.exists(src):
            shutil.copy(os.path.join(SRC, cid + '.webp'), src)
        rgba = np.asarray(Image.open(src).convert('RGBA'))
        mask, body_L = window_mask(rgba)
        out = tint(rgba, mask)
        tiles.append((rgba, out))
        if not preview:
            Image.fromarray(out, 'RGBA').save(os.path.join(SRC, cid + '.webp'), 'WEBP', quality=82, method=6)
        print(cid, 'кузов L', round(body_L), 'стёкла', f'{mask.sum() / max(1, (rgba[..., 3] > 200).sum()):.0%}')
    if tiles:
        W = 520
        rows = []
        for a, b in tiles:
            ims = [Image.fromarray(x, 'RGBA') for x in (a, b)]
            for im in ims:
                im.thumbnail((W, 400))
            hgt = max(im.height for im in ims)
            row = Image.new('RGB', (W * 2, hgt), '#2a2a2e')
            for i, im in enumerate(ims):
                row.paste(im, (i * W, 0), im)
            rows.append(row)
        sheet = Image.new('RGB', (W * 2, sum(r.height for r in rows)), '#2a2a2e')
        y = 0
        for r in rows:
            sheet.paste(r, (0, y)); y += r.height
        sheet.save('img/tint_check.png')


if __name__ == '__main__':
    main()
