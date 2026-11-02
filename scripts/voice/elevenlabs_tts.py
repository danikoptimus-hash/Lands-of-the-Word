"""Озвучка ролика «Земли Слова» голосом владельца через ElevenLabs (решение владельца 02.11).

Запускается из рабочего процесса GitHub `voice.yml` (ключ — только в секрете ELEVENLABS_API_KEY).
Что делает:
  1. Если передан VOICE_ID — использует готовый голос; иначе создаёт голос мгновенным клонированием
     из записи (SAMPLE, пути через запятую) с шумоочисткой и сохраняет voice_id в out/voice.json.
  2. Озвучивает строки из scripts/voice/lines.json → out/tts/s<N>-mine.mp3 (знаки ударения «´» убираются,
     если KEEP_ACCENTS не «1»).
  3. При SFX=1 генерирует звуковые эффекты для ролика → out/sfx/*.mp3.
Переменные окружения: ELEVENLABS_API_KEY, SAMPLE, VOICE_ID, MODEL_ID (eleven_multilingual_v2), KEEP_ACCENTS, SFX, OUT.
"""
import json, os, sys, time, uuid, urllib.request, urllib.error

API = "https://api.elevenlabs.io/v1"
KEY = os.environ.get("ELEVENLABS_API_KEY", "")
if not KEY:
    print("нет ELEVENLABS_API_KEY"); sys.exit(1)
OUT = os.environ.get("OUT", "out")
MODEL = os.environ.get("MODEL_ID", "eleven_multilingual_v2")
KEEP = os.environ.get("KEEP_ACCENTS", "0") == "1"
LINES = os.environ.get("LINES", "scripts/voice/lines.json")
os.makedirs(f"{OUT}/tts", exist_ok=True)


def call(path, data=None, headers=None, raw=False, method=None):
    req = urllib.request.Request(API + path, data=data, method=method or ("POST" if data is not None else "GET"))
    req.add_header("xi-api-key", KEY)
    for k, v in (headers or {}).items(): req.add_header(k, v)
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                body = r.read()
                return body if raw else json.loads(body or b"{}")
        except urllib.error.HTTPError as e:
            msg = e.read()[:600].decode("utf-8", "replace")
            if e.code in (429, 500, 502, 503) and attempt < 3:
                print(f"  {e.code}, повтор через {5 * (attempt + 1)} с: {msg[:120]}"); time.sleep(5 * (attempt + 1)); continue
            print(f"ошибка {e.code} {path}: {msg}"); raise
    raise RuntimeError("не удалось: " + path)


def multipart(fields, files):
    b = uuid.uuid4().hex.encode()
    out = []
    for k, v in fields.items():
        out += [b"--" + b, f'Content-Disposition: form-data; name="{k}"'.encode(), b"", str(v).encode()]
    for k, path in files:
        name = os.path.basename(path)
        out += [b"--" + b, f'Content-Disposition: form-data; name="{k}"; filename="{name}"'.encode(), b"Content-Type: application/octet-stream", b"", open(path, "rb").read()]
    out += [b"--" + b + b"--", b""]
    return b"\r\n".join(out), {"Content-Type": "multipart/form-data; boundary=" + b.decode()}


# 1. Голос
voice_id = os.environ.get("VOICE_ID", "").strip()
if not voice_id:
    samples = [p.strip() for p in os.environ.get("SAMPLE", "").split(",") if p.strip()]
    missing = [p for p in samples if not os.path.exists(p)]
    if not samples or missing:
        print("нет записи голоса:", missing or "SAMPLE пуст"); sys.exit(1)
    body, hdr = multipart({"name": "Земли Слова — диктор", "description": "Голос диктора ролика", "remove_background_noise": "true"}, [("files", p) for p in samples])
    res = call("/voices/add", body, hdr)
    voice_id = res["voice_id"]
    print("голос создан:", voice_id, "проверка нужна:" if res.get("requires_verification") else "")
json.dump({"voice_id": voice_id, "model_id": MODEL}, open(f"{OUT}/voice.json", "w"))

# 2. Строки
lines = json.load(open(LINES, encoding="utf-8"))
settings = {"stability": 0.5, "similarity_boost": 0.8, "style": 0.15, "use_speaker_boost": True}
for i, line in enumerate(lines):
    text = line["text"] if KEEP else line["text"].replace("́", "")
    payload = json.dumps({"text": text, "model_id": MODEL, "voice_settings": settings}, ensure_ascii=False).encode()
    audio = call(f"/text-to-speech/{voice_id}?output_format=mp3_44100_128", payload, {"Content-Type": "application/json"}, raw=True)
    path = f"{OUT}/tts/s{i}-mine.mp3"
    open(path, "wb").write(audio)
    print(i, len(audio), "байт:", text[:60])

# 3. Звуки
if os.environ.get("SFX", "0") == "1":
    os.makedirs(f"{OUT}/sfx", exist_ok=True)
    SFX = [
        ("sea", "Calm sea waves gently lapping, soft steady wind, distant seagulls, peaceful, no music", 12),
        ("storm", "Rolling thunder with heavy rain and strong wind over the sea, storm", 7),
        ("bricks", "Stone bricks placed one by one on a wall, soft heavy thuds", 4),
        ("whoosh", "Soft cinematic whoosh transition", 2),
        ("quill", "Quill pen writing on parchment", 3),
        ("seal", "Wax seal stamp pressed firmly onto paper", 2),
    ]
    for name, prompt, dur in SFX:
        payload = json.dumps({"text": prompt, "duration_seconds": dur, "prompt_influence": 0.3}).encode()
        audio = call("/sound-generation", payload, {"Content-Type": "application/json"}, raw=True)
        open(f"{OUT}/sfx/{name}.mp3", "wb").write(audio)
        print("звук", name, len(audio), "байт")
print("готово:", OUT)
