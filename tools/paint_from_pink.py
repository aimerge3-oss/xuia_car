"""Покраска по «розовой» версии фото.

Владелец (или Claude в его Chrome) просит Gemini перекрасить на фото машины ТОЛЬКО кузов в глянцевый
ярко-розовый (#FF00FF) с теми же бликами и тенями и кладёт результат в img/paint_src/<id>.png.
Скрипт вырезает фон и сохраняет розовую машину в img/paint/<id>.webp. В игре при покраске
берётся ЭТА картинка, и розовый меняется на выбранный цвет — стёкла, фары, решётки, колёса
не розовые и не красятся. Без покраски показывается обычное фото img/cars/<id>.webp.

  python tools/paint_from_pink.py              # все машины, у которых есть розовая версия
  python tools/paint_from_pink.py f812 mini    # только эти
  --preview                                    # картинка-проверка img/paint_check.png

Яркость розового кузова пишется в js/paint.js (PAINT_PINK).
"""
import json
import os
import re
import sys

import numpy as np
from PIL import Image
from rembg import new_session, remove
from scipy import ndimage

PINK, DST, MAX_W = 'img/paint_src', 'img/paint', 900
META = 'js/paint.js'


def pinkness(rgb):
    """0..1 — насколько пиксель «розовый кузов» (то же считает игра)."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    v = np.maximum(r, b)
    mag = np.minimum(r, b) - g                      # розовый: красный и синий выше зелёного
    bal = 1 - np.abs(r - b) / np.maximum(v, 1e-3)   # красный и синий примерно поровну
    return np.clip(mag / np.maximum(v, 1e-3) * 8 - 0.2, 0, 1) * np.clip(bal * 2.5 - 0.6, 0, 1)


def recolor(rgba, base, target):
    """Как в игре: оттенок меняется на новый цвет, тени — по яркости, блики (белое на розовом) — белые."""
    rgb = rgba[..., :3].astype(float) / 255
    k = pinkness(rgb)[..., None]
    v = np.maximum(rgb[..., 0], rgb[..., 2])[..., None]
    hi = np.clip(rgb[..., 1:2] / np.maximum(v, 1e-3), 0, 1) * np.clip((v - 0.45) / 0.3, 0, 1)   # блик — только на светлом
    t = np.array(target, float) / 255
    col = np.clip(t * (v / base), 0, 1)
    col = col + (1 - col) * hi
    out = rgb * (1 - k) + col * k
    o = rgba.copy()
    o[..., :3] = np.clip(out * 255, 0, 255).astype(np.uint8)
    return o


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    files = sorted(f for f in os.listdir(PINK) if os.path.splitext(f)[1].lower() in ('.png', '.jpg', '.jpeg', '.webp')
                   and (not args or os.path.splitext(f)[0] in args))
    if not files:
        print('нет розовых фото в', PINK)
        return
    os.makedirs(DST, exist_ok=True)
    session = new_session('birefnet-general-lite')
    src = open(META, encoding='utf8').read()
    m = re.search(r'PAINT_PINK\s*=\s*(\{.*?\});', src, re.S)
    pink_meta = json.loads(m.group(1)) if m else {}
    previews = []
    for f in files:
        cid = os.path.splitext(f)[0]
        im = Image.open(os.path.join(PINK, f)).convert('RGB')
        if im.width > 1600:
            im = im.resize((1600, round(im.height * 1600 / im.width)), Image.LANCZOS)
        cut = remove(im, session=session, post_process_mask=True, only_mask=True)
        a = np.array(cut).astype(float)
        # дырки внутри силуэта (тёмные арки, решётки нейросеть иногда считает фоном) — заливаем обратно
        solid = ndimage.binary_fill_holes(a > 128)
        # арки открыты вниз (щель под колесом), заливкой их не поймать: фон у Gemini светлый,
        # поэтому всё тёмное рядом с машиной — это арка/шина, а не фон
        px = np.array(im).astype(float) / 255
        dark = px.max(axis=2) < 0.55
        near = ndimage.binary_closing(solid, iterations=max(6, im.width // 90))
        solid |= near & dark
        solid = ndimage.binary_fill_holes(solid)
        a = np.maximum(a, solid * 255.0)
        rgba = np.dstack([np.array(im), a.astype(np.uint8)])
        rgb = rgba[..., :3].astype(float) / 255
        # розовые блики на стёклах и прочие островки вне кузова — не кузов: обесцвечиваем,
        # чтобы игра их не перекрашивала
        k = pinkness(rgb)
        body = ndimage.binary_opening(k > 0.35, iterations=2)
        lbl, n = ndimage.label(body)
        if n:
            sizes = ndimage.sum(body, lbl, range(1, n + 1))
            body = np.isin(lbl, 1 + np.nonzero(sizes > body.size * 0.002)[0])
        region = ndimage.binary_dilation(body, iterations=6)
        # недокрашенные Gemini белые крапинки у края кузова — берём цвет ближайшего розового пикселя
        v = rgb.max(axis=2)
        sat = (v - rgb.min(axis=2)) / np.maximum(v, 1e-3)
        leftover = region & ~body & (v > 0.55) & (sat < 0.25)
        if leftover.any():
            _, (iy, ix) = ndimage.distance_transform_edt(~body, return_indices=True)
            rgb[leftover] = rgb[iy[leftover], ix[leftover]]
        # одиночные светлые точки на кузове (не блики — те большие и плавные) заменяем соседним цветом
        vv = np.maximum(rgb[..., 0], rgb[..., 2])
        hi = rgb[..., 1] / np.maximum(vv, 1e-3)
        med = ndimage.median_filter(hi, size=7)
        speck = region & (hi > med + 0.2)
        if speck.any():
            for c in range(3):
                mc = ndimage.median_filter(rgb[..., c], size=7)
                rgb[..., c] = np.where(speck, mc, rgb[..., c])
        stray = (k > 0.01) & ~region
        gray = rgb.mean(axis=2, keepdims=True)
        rgb = np.where(stray[..., None], gray, rgb)
        rgba[..., :3] = np.clip(rgb * 255, 0, 255).astype(np.uint8)
        out = Image.fromarray(rgba, 'RGBA')
        out = out.crop(out.getchannel('A').point(lambda v: 255 if v > 40 else 0).getbbox())
        if out.width > MAX_W:
            out = out.resize((MAX_W, round(out.height * MAX_W / out.width)), Image.LANCZOS)
        rgba = np.array(out)
        rgb = rgba[..., :3].astype(float) / 255
        k = pinkness(rgb) > 0.6
        base = float(np.percentile(np.maximum(rgb[..., 0], rgb[..., 2])[k], 60)) if k.any() else 0.8
        out.save(os.path.join(DST, cid + '.webp'), 'WEBP', quality=92, method=6)
        pink_meta[cid] = round(base, 3)
        previews.append((rgba, base))
        print(cid, 'кузов', f'{k.sum() / max(1, (rgba[..., 3] > 200).sum()):.0%}', 'яркость', round(base, 2))
    line = 'const PAINT_PINK = ' + json.dumps(pink_meta, sort_keys=True) + ';'
    src = re.sub(r'\n?// Розовые версии.*?\nconst PAINT_PINK = \{.*?\};', '', src, flags=re.S).rstrip('\n')
    src += '\n// Розовые версии (img/paint/<id>.webp — розовая машина, красится розовое). Создано tools/paint_from_pink.py\n' + line + '\n'
    open(META, 'w', encoding='utf8').write(src)
    if '--preview' in sys.argv and previews:
        cw, ch, per = 300, 110, 1
        sheet = Image.new('RGB', (cw * 4, ch * len(previews)), (30, 32, 36))
        for k, (rgba, base) in enumerate(previews):
            for j, col in enumerate([None, (200, 30, 40), (30, 90, 220), (245, 245, 245)]):
                im = Image.fromarray(rgba if col is None else recolor(rgba, base, col))
                im.thumbnail((cw - 8, ch - 8))
                sheet.paste(im, (j * cw + 4, k * ch + 4), im)
        sheet.save('img/paint_check.png')


if __name__ == '__main__':
    main()
