#!/usr/bin/env python3
"""Генерация картинки через OpenAI Images API (ключ подставляет прокси облачной среды — см. CLAUDE.md).

  python3 scripts/img-gen/gen_img.py "<промт>" out.png [--size 1024x1024|1536x1024|1024x1536] [--quality low|medium|high]
                                     [--bg green|transparent|none] [--model gpt-image-2]

--bg green        дописывает к промту ровный зелёный фон (хромакей) — потом scripts/img-gen/key.py вырезает спрайт;
--bg transparent  просит прозрачный фон у самой модели (png с альфой);
--bg none         фон не трогаем (текстуры, пейзажи).
Потоковый режим (stream: true) обязателен: прокси обрывает запросы дольше ~30 с. Рядом с out.png пишется out.png.req.json.
"""
import base64, json, subprocess, sys

args = sys.argv[1:]
if len(args) < 2: print(__doc__); sys.exit(2)
prompt, out = args[0], args[1]
opt = {"--size": "1024x1024", "--quality": "medium", "--bg": "none", "--model": "gpt-image-2"}
for i in range(2, len(args) - 1, 2): opt[args[i]] = args[i + 1]
if opt["--bg"] == "green": prompt += " Фон — ровный однотонный ярко-зелёный (хромакей, #00FF00), без градиентов, без теней и бликов на фоне."
body = {"model": opt["--model"], "prompt": prompt, "size": opt["--size"], "quality": opt["--quality"], "n": 1, "stream": True, "output_format": "png"}
if opt["--bg"] == "transparent": body["background"] = "transparent"
req = out + ".req.json"; open(req, "w", encoding="utf-8").write(json.dumps(body, ensure_ascii=False))
r = subprocess.run(["curl", "-sS", "--max-time", "900", "-N", "https://api.openai.com/v1/images/generations", "-H", "content-type: application/json", "-H", "authorization: Bearer proxy-injects-the-key", "--data-binary", "@" + req], capture_output=True, text=True)
b64 = None; err = None
for line in r.stdout.splitlines():
    if not line.startswith("data:"): continue
    try: ev = json.loads(line[5:].strip())
    except Exception: continue
    if ev.get("type") == "image_generation.completed": b64 = ev.get("b64_json")
    elif ev.get("type") == "error": err = ev
    elif "b64_json" in ev: b64 = ev["b64_json"]
if not b64:
    try: j = json.loads(r.stdout); b64 = j["data"][0]["b64_json"]
    except Exception: print("FAIL", (err or r.stdout[:400] or r.stderr[:400])); sys.exit(1)
open(out, "wb").write(base64.b64decode(b64)); print("ok", out)
