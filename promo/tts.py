# Озвучка роликов: каждая фраза из scripts.json → public/voice/<ролик>-<n>.mp3
# и src/voice.json (длительность фраз и время каждого слова — для субтитров в такт речи).
# Запуск: python tts.py   (нужен пакет edge-tts)
import asyncio, json, os
import edge_tts

VOICE = 'ru-RU-DmitryNeural'
RATE = '+18%'    # быстрее — дерзкая подача
PITCH = '-4Hz'   # чуть ниже — увереннее

HERE = os.path.dirname(os.path.abspath(__file__))


async def say(text, path):
    words = []
    com = edge_tts.Communicate(text, VOICE, rate=RATE, pitch=PITCH, boundary='WordBoundary')
    with open(path, 'wb') as f:
        async for ch in com.stream():
            if ch['type'] == 'audio':
                f.write(ch['data'])
            elif ch['type'] == 'WordBoundary':
                words.append({'t': ch['offset'] / 1e7, 'd': ch['duration'] / 1e7, 'w': ch['text']})
    dur = (words[-1]['t'] + words[-1]['d']) if words else 1.0
    return {'dur': round(dur + 0.12, 3), 'words': words}


async def main():
    scripts = json.load(open(os.path.join(HERE, 'scripts.json'), encoding='utf-8'))
    os.makedirs(os.path.join(HERE, 'public', 'voice'), exist_ok=True)
    out = {}
    for name, segs in scripts.items():
        out[name] = []
        for i, seg in enumerate(segs):
            file = f'voice/{name}-{i}.mp3'
            info = await say(seg['say'], os.path.join(HERE, 'public', file))
            out[name].append({'file': file, **info})
            print(name, i, info['dur'], 's')
    with open(os.path.join(HERE, 'src', 'voice.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)


asyncio.run(main())
