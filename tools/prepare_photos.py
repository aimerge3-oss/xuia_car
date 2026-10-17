"""Вырезает фон у фото и сохраняет их для игры.

Машины: img/cars_src/<id>.png   ->  img/cars/<id>.webp
Детали: img/parts_src/<id>.png  ->  img/parts/<id>.webp
Контейнер: img/cont_src/container.png, container_side.png  ->  img/container.webp, img/container_side.webp

  python tools/prepare_photos.py              # все машины
  python tools/prepare_photos.py supra r34    # только эти машины
  python tools/prepare_photos.py parts        # все детали
  python tools/prepare_photos.py parts turbo  # только турбина
  python tools/prepare_photos.py cont         # контейнер (спереди и сбоку)

Нужно один раз:  pip install "rembg[cpu]" pillow
"""
import os
import sys

from PIL import Image
from rembg import new_session, remove

args = sys.argv[1:]
kind = 'cars'
if args and args[0] in ('cars', 'parts', 'cont'):
    kind = args.pop(0)
SRC, DST = f'img/{kind}_src', ('img' if kind == 'cont' else f'img/{kind}')
MAX_W = 900 if kind in ('cars', 'cont') else 600
ids = args

os.makedirs(DST, exist_ok=True)
session = new_session('birefnet-general-lite')

for f in sorted(os.listdir(SRC)):
    name, ext = os.path.splitext(f)
    if ext.lower() not in ('.png', '.jpg', '.jpeg', '.webp') or (ids and name not in ids):
        continue
    im = Image.open(os.path.join(SRC, f)).convert('RGB')
    if im.width > 1600:
        im = im.resize((1600, round(im.height * 1600 / im.width)), Image.LANCZOS)
    out = remove(im, session=session, post_process_mask=True)
    # обрезаем по предмету
    out = out.crop(out.getchannel('A').point(lambda v: 255 if v > 40 else 0).getbbox())
    if out.width > MAX_W:
        out = out.resize((MAX_W, round(out.height * MAX_W / out.width)), Image.LANCZOS)
    out.save(os.path.join(DST, name + '.webp'), 'WEBP', quality=82, method=6)
    print('ok', name)
