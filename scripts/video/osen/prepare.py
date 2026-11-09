# Данные для страницы ролика: раскладка, кадры карты с временем, кадры салюта.
import json, os, re, glob, datetime as dt
D = os.path.dirname(os.path.abspath(__file__)); R = os.path.join(D, "..")
TL = json.load(open(os.path.join(D, "timeline.json")))
meta = json.load(open(os.path.join(R, "tl", "meta.json")))
MON = {"сент.": 9, "окт.": 10, "нояб.": 11}
tz = dt.timezone(dt.timedelta(hours=5))
frames = []
for m in meta:
    d = m["desc"]; ts = None
    x = re.search(r"(\d+)\s+(сент\.|окт\.|нояб\.),?\s+(\d+):(\d+)", d)
    if x: ts = dt.datetime(2026, MON[x[2]], int(x[1]), int(x[3]), int(x[4]), tzinfo=tz)
    else:
        y = re.search(r"(сегодня|вчера)\s+(\d+):(\d+)", d)
        if y: ts = dt.datetime(2026, 11, 8 if y[1] == "сегодня" else 7, int(y[2]), int(y[3]), tzinfo=tz)
    label = d.split(" · ")[0] if "Старт" not in d else d.split(" · ")[1]
    if ts is None: ts = frames[-1]["dt"] if frames else dt.datetime(2026, 9, 29, 20, 56, tzinfo=tz)
    lab = re.sub(r"сегодня.*", "8 нояб.", re.sub(r"вчера.*", "7 нояб.", label))
    frames.append({"k": m["k"], "dt": ts, "label": lab})
out = [{"k": f["k"], "ts": int(f["dt"].timestamp() * 1000), "label": f["label"]} for f in frames]
fx = sorted(glob.glob(os.path.join(R, "fw2", "f*.jpg"))); fxz = sorted(glob.glob(os.path.join(R, "fwz2", "f*.jpg")))
open(os.path.join(D, "data.js"), "w").write(
    "const TL = " + json.dumps(TL, ensure_ascii=False) + ";\nconst FRAMES = " + json.dumps(out, ensure_ascii=False) +
    ";\nconst FX = " + json.dumps({"dir": "../fw2", "n": max(1, len(fx))}) + ";\nconst FXZ = " + json.dumps({"dir": "../fwz2", "n": max(1, len(fxz))}) + ";\n")
print("кадров карты", len(out), "салюта", len(fx), out[0], out[-1])
