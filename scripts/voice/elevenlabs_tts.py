"""Озвучка ролика «Земли Слова» голосом владельца через ElevenLabs (решение владельца 02.11).

Запускается из рабочего процесса GitHub `voice.yml` (ключ — только в секрете ELEVENLABS_API_KEY).
Что делает:
  1. Если передан VOICE_ID — использует готовый голос; иначе создаёт голос мгновенным клонированием
     из записи (SAMPLE, пути через запятую) с шумоочисткой и сохраняет voice_id в out/voice.json.
  2. Озвучивает строки из scripts/voice/lines.json → out/tts/s<N>-mine.mp3 (знаки ударения «´» убираются,
     KEEP_ACCENTS: 1 — с пометками ударений, 0 — без, both — оба варианта в out/tts).
  3. При SFX=1 генерирует звуковые эффекты для ролика → out/sfx/*.mp3.
Переменные окружения: ELEVENLABS_API_KEY, SAMPLE (аудио или видео), SAMPLE_RANGE (отрезки мм:сс-мм:сс через запятую), ISOLATE (чистка),
VOICE_ID или VOICE_NAME (часть имени голоса из «Моих голосов»), MODEL_ID (eleven_multilingual_v2), KEEP_ACCENTS, SFX, MUSIC, STAGES (voice,tts,sfx,music), ONLY (номера строк), TAKES (дубли), OUT.
"""
import json, os, sys, time, uuid, urllib.request, urllib.error

API = "https://api.elevenlabs.io/v1"
KEY = os.environ.get("ELEVENLABS_API_KEY", "")
if not KEY:
    print("нет ELEVENLABS_API_KEY"); sys.exit(1)
OUT = os.environ.get("OUT", "out")
MODEL = os.environ.get("MODEL_ID", "eleven_multilingual_v2")
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


def prepare_sample(src, ranges):
    """Звук из видео/аудио: нужные отрезки (мм:сс-мм:сс через запятую), моно 44,1 кГц, один файл m4a."""
    import subprocess
    os.makedirs(f"{OUT}/sample", exist_ok=True)
    def sec(t):
        parts = [float(x) for x in t.strip().split(":")]
        return sum(v * 60 ** i for i, v in enumerate(reversed(parts)))
    cuts = []
    for k, r in enumerate([x for x in ranges.split(",") if x.strip()] or [""]):
        part = f"{OUT}/sample/part{k}.wav"
        cmd = ["ffmpeg", "-v", "error", "-y"]
        if r.strip():
            a, b = r.split("-"); cmd += ["-ss", str(sec(a)), "-to", str(sec(b))]
        cmd += ["-i", src, "-vn", "-ac", "1", "-ar", "44100", part]
        subprocess.run(cmd, check=True); cuts.append(part)
    lst = f"{OUT}/sample/list.txt"
    open(lst, "w").write("".join(f"file '{os.path.abspath(c)}'\n" for c in cuts))
    out = f"{OUT}/sample/sample.m4a"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", lst, "-c:a", "aac", "-b:a", "160k", out], check=True)
    return out


def isolate(path):
    """Чистка записи от шума и музыки (Voice Isolator)."""
    body, hdr = multipart({}, [("audio", path)])
    audio = call("/audio-isolation", body, hdr, raw=True)
    out = f"{OUT}/sample/sample-clean.mp3"
    open(out, "wb").write(audio)
    print("запись очищена:", len(audio), "байт")
    return out


STAGES = [x.strip() for x in os.environ.get("STAGES", "voice,tts,sfx,music").split(",") if x.strip()]  # какие этапы выполнять

# 1. Голос
voice_id = os.environ.get("VOICE_ID", "").strip()
VOICE_NAME = os.environ.get("VOICE_NAME", "").strip()
if not voice_id and VOICE_NAME:  # голос из «Моих голосов» по части имени
    res = call("/voices?show_legacy=true")
    found = [v for v in res.get("voices", []) if VOICE_NAME.lower() in (v.get("name") or "").lower()]
    if not found:
        print("голос не найден среди ваших:", VOICE_NAME, "| есть:", [v.get("name") for v in res.get("voices", [])][:40]); sys.exit(1)
    voice_id = found[0]["voice_id"]; print("голос по имени:", found[0]["name"], voice_id)
if "voice" in STAGES and not voice_id:
    samples = [p.strip() for p in os.environ.get("SAMPLE", "").split(",") if p.strip()]
    missing = [p for p in samples if not os.path.exists(p)]
    if not samples or missing:
        print("нет записи голоса:", missing or "SAMPLE пуст"); sys.exit(1)
    ranges = os.environ.get("SAMPLE_RANGE", "").strip()
    if ranges or any(p.lower().endswith((".mp4", ".mov", ".webm", ".mkv")) for p in samples):
        samples = [prepare_sample(samples[0], ranges)]
    if os.environ.get("ISOLATE", "0") == "1":
        samples = [isolate(samples[0])]
    body, hdr = multipart({"name": "Земли Слова — диктор", "description": "Голос диктора ролика", "remove_background_noise": "true"}, [("files", p) for p in samples])
    res = call("/voices/add", body, hdr)
    voice_id = res["voice_id"]
    print("голос создан:", voice_id, "проверка нужна:" if res.get("requires_verification") else "")
if voice_id: json.dump({"voice_id": voice_id, "model_id": MODEL}, open(f"{OUT}/voice.json", "w"))

# 2. Строки
lines = json.load(open(LINES, encoding="utf-8")) if "tts" in STAGES and voice_id else []
settings = {"stability": 0.5, "similarity_boost": 0.8, "style": 0.15, "use_speaker_boost": True}
MODE = os.environ.get("KEEP_ACCENTS", "both")  # 1 — с пометками ударений, 0 — без, both — оба варианта
variants = [("mine", True), ("mine-plain", False)] if MODE == "both" else [("mine", MODE == "1")]
ONLY = [int(x) for x in os.environ.get("ONLY", "").split(",") if x.strip().isdigit()]  # только эти строки (номера с 0)
TAKES = max(1, int(os.environ.get("TAKES", "1") or 1))  # несколько дублей каждой строки: s<N>-take<K>-...
for i, line in enumerate(lines):
    if ONLY and i not in ONLY: continue
    for suffix, keep in variants:
        text = line["text"] if keep else line["text"].replace("\u0301", "")
        payload = json.dumps({"text": text, "model_id": MODEL, "voice_settings": settings}, ensure_ascii=False).encode()
        for k in range(TAKES):
            audio = call(f"/text-to-speech/{voice_id}?output_format=mp3_44100_128", payload, {"Content-Type": "application/json"}, raw=True)
            path = f"{OUT}/tts/s{i}-{suffix}.mp3" if TAKES == 1 else f"{OUT}/tts/s{i}-take{k + 1}-{suffix}.mp3"
            open(path, "wb").write(audio)
            print(i, suffix, f"дубль {k + 1}," if TAKES > 1 else "", len(audio), "байт:", text[:60])

# 3. Звуки
if os.environ.get("SFX", "0") == "1" and "sfx" in STAGES:
    os.makedirs(f"{OUT}/sfx", exist_ok=True)
    SFX = [
        ("sea", "Calm sea waves gently lapping, soft steady wind, distant seagulls, peaceful, no music", 12),
        ("storm", "Rolling thunder with heavy rain and strong wind over the sea, storm", 7),
        ("bricks", "Stone bricks placed one by one on a wall, soft heavy thuds", 4),
        ("whoosh", "Soft cinematic whoosh transition", 2),
        ("quill", "Quill pen writing on parchment", 3),
        ("seal", "Wax seal stamp pressed firmly onto paper", 2),
        ("impact", "Deep cinematic impact hit with a short low boom and subtle debris", 2),
        ("swoosh", "Fast whoosh fly-in with a soft thump landing", 1.5),
        ("stamp", "Heavy rubber stamp slam on a wooden desk", 1.5),
        ("flip", "Quick card flip, crisp paper snap", 1),
        ("coin", "Small bright chime, medal awarded", 1.5),
        ("pop", "Soft pop, bubble", 1),
    ]
    for name, prompt, dur in SFX:
        payload = json.dumps({"text": prompt, "duration_seconds": dur, "prompt_influence": 0.3}).encode()
        try:
            audio = call("/sound-generation", payload, {"Content-Type": "application/json"}, raw=True)
            open(f"{OUT}/sfx/{name}.mp3", "wb").write(audio)
            print("звук", name, len(audio), "байт")
        except Exception as e:
            print("звук не сгенерирован:", name, str(e)[:200])
            if "401" in str(e): break  # нет права у ключа — дальше бессмысленно
# 4. Музыка (Eleven Music): фон под ролик, без слов
if os.environ.get("MUSIC", "0") == "1" and "music" in STAGES:
    os.makedirs(f"{OUT}/music", exist_ok=True)
    TRACKS = [
        ("bed", "Majestic symphonic orchestral soundtrack in the style of a grand strategy game main theme: full orchestra, soaring strings, "
                "noble French horns and brass fanfares, timpani, subtle choir pads, epic and uplifting, builds slowly from a quiet solemn opening "
                "to a triumphant climax near the end, instrumental only, no vocals, no lyrics", 150000),
        ("bed-soft", "Majestic but restrained symphonic underscore for narration: warm strings, soft horns, gentle timpani, slow and noble, "
                     "grand strategy game atmosphere, instrumental only, no vocals, no lyrics, steady dynamics without sudden peaks", 150000),
        ("storm", "Short dramatic orchestral swell with thunder-like low drums and rising strings, tense, no vocals", 15000),
    ]
    for name, prompt, ms in TRACKS:
        payload = json.dumps({"prompt": prompt, "music_length_ms": ms}).encode()
        try:
            audio = call("/music?output_format=mp3_44100_128", payload, {"Content-Type": "application/json"}, raw=True)
            open(f"{OUT}/music/{name}.mp3", "wb").write(audio)
            print("музыка", name, len(audio), "байт")
        except Exception as e:
            print("музыка не сгенерирована:", name, str(e)[:200])
            if "401" in str(e): break
print("готово:", OUT)
