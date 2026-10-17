# Озвучка роликов через ElevenLabs (живые голоса).
# Ключ берётся из файла promo/.env (строка ELEVENLABS_API_KEY=...) — в git он не попадает.
#   python tts_eleven.py samples          — по одной фразе разными голосами (out/samples/*.mp3), чтобы выбрать голос
#   python tts_eleven.py <voice_id>       — озвучить все ролики этим голосом → public/voice/*.mp3 и src/voice.json
import base64, json, os, sys, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
API = 'https://api.elevenlabs.io/v1'
MODEL = 'eleven_multilingual_v2'
SETTINGS = {'stability': 0.35, 'similarity_boost': 0.8, 'style': 0.45, 'use_speaker_boost': True}


def key():
    with open(os.path.join(HERE, '.env'), encoding='utf-8-sig') as f:
        for line in f:
            if line.strip().startswith('ELEVENLABS_API_KEY='):
                return line.split('=', 1)[1].strip().strip('"')
    sys.exit('В promo/.env нет строки ELEVENLABS_API_KEY=...')


def call(path, body=None):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body else None,
                                 headers={'xi-api-key': key(), 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        sys.exit(f'ElevenLabs ответил {e.code}: {e.read().decode()[:300]}')


def say(text, voice, path):
    r = call(f'/text-to-speech/{voice}/with-timestamps?output_format=mp3_44100_128',
             {'text': text, 'model_id': MODEL, 'voice_settings': SETTINGS})
    with open(path, 'wb') as f:
        f.write(base64.b64decode(r['audio_base64']))
    a = r['alignment']
    words, cur, t0 = [], '', None
    for ch, s, e in zip(a['characters'], a['character_start_times_seconds'], a['character_end_times_seconds']):
        if ch.isspace():
            if cur: words.append({'t': t0, 'd': last - t0, 'w': cur}); cur = ''
            continue
        if not cur: t0 = s
        cur += ch; last = e
    if cur: words.append({'t': t0, 'd': last - t0, 'w': cur})
    dur = a['character_end_times_seconds'][-1] if a['character_end_times_seconds'] else 1.0
    return {'dur': round(dur + 0.1, 3), 'words': words}


if __name__ == '__main__':
    arg = sys.argv[1] if len(sys.argv) > 1 else 'samples'
    if arg == 'samples':
        os.makedirs(os.path.join(HERE, 'out', 'samples'), exist_ok=True)
        voices = call('/voices')['voices']
        male = [v for v in voices if (v.get('labels') or {}).get('gender') == 'male'][:8]
        for v in male:
            path = os.path.join(HERE, 'out', 'samples', f"{v['name'].split()[0]}_{v['voice_id']}.mp3")
            say('Сколько стоит твой номер? А этот — двадцать миллионов. И я его просто выбил!', v['voice_id'], path)
            print('пример:', os.path.basename(path), '·', (v.get('labels') or {}).get('description', ''), (v.get('labels') or {}).get('age', ''))
    else:
        scripts = json.load(open(os.path.join(HERE, 'scripts.json'), encoding='utf-8'))
        os.makedirs(os.path.join(HERE, 'public', 'voice'), exist_ok=True)
        out = {}
        for name, segs in scripts.items():
            out[name] = []
            for i, seg in enumerate(segs):
                file = f'voice/{name}-{i}.mp3'
                info = say(seg['say'], arg, os.path.join(HERE, 'public', file))
                out[name].append({'file': file, **info})
                print(name, i, info['dur'], 's')
        with open(os.path.join(HERE, 'src', 'voice.json'), 'w', encoding='utf-8') as f:
            json.dump(out, f, ensure_ascii=False, indent=1)
