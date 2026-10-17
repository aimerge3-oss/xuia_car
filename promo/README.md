# Рекламные ролики DROPZONE: AUTO (TikTok)

Вертикальные 1080×1920, 30 кадров/с, мужской голос (Microsoft «Дмитрий» через edge-tts) + субтитры в такт речи.

- `scripts.json` — тексты: `say` — что говорит голос, `show` — что в субтитрах.
- `python tts.py` — озвучка → `public/voice/*.mp3` и `src/voice.json` (нужен пакет `edge-tts`).
- `src/Plates.tsx`, `src/Case.tsx`, `src/Progress.tsx` — сами ролики; общее — `src/common.tsx`.
- Картинки машин/деталей: скопировать из игры в `public/cars`, `public/parts` (в git не хранятся).
- Сборка: `npx remotion render src/index.ts plates out/dropzone_plates.mp4` (также `case`, `progress`).
- Просмотр и правки вживую: `npx remotion studio`.
