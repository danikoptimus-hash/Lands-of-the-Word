# Раскладка ролика «Осень»: время каждой фразы и сцены по длительностям озвучки.
import json, os
D = os.path.dirname(os.path.abspath(__file__))
dur = {}
for line in open(os.path.join(D, "..", "audio", "lines", "durations.txt")):
    k, v = line.split(); dur[k] = float(v)
# (фраза, пауза перед ней, сцена)
plan = [
    ("s0", 0.8, "title"), ("s1", 1.2, "start"), ("s2", 0.7, "deeds"), ("s3", 0.7, "sea"), ("s4", 0.7, "cities"),
    ("s5", 2.2, "war"), ("s6", 0.8, "chronicle"), ("s7", 0.8, "repel"),
    ("s8", 2.4, "capital"), ("s9", 0.9, "wall"), ("s10", 2.2, "fall"),
    ("s11", 7.0, "ruins"), ("s12", 1.2, "totals"), ("s13", 0.9, "standing"), ("s14", 1.4, "outro"),
]
t = 0.0; lines = []; scenes = []
for sid, gap, scene in plan:
    t += gap
    lines.append({"id": sid, "start": round(t, 3), "dur": dur[sid], "scene": scene})
    t += dur[sid]
end = t + 3.5
# Сцена начинается за полпаузы до своей фразы (переход в паузе), кончается там, где начинается следующая.
for i, l in enumerate(lines):
    gap = plan[i][1]
    s = 0.0 if i == 0 else round(l["start"] - min(gap * 0.5, 0.6), 3)
    scenes.append({"id": l["scene"], "start": s, "line": l["id"], "lineStart": l["start"], "lineDur": l["dur"]})
for i, sc in enumerate(scenes):
    sc["end"] = scenes[i + 1]["start"] if i + 1 < len(scenes) else round(end, 3)
# Огни салюта в сцене падения: после фразы s10 ещё 6,5 с без слов.
json.dump({"end": round(end, 3), "fps": 30, "lines": lines, "scenes": scenes}, open(os.path.join(D, "timeline.json"), "w"), ensure_ascii=False, indent=1)
for sc in scenes: print(f'{sc["id"]:10s} {sc["start"]:7.2f} → {sc["end"]:7.2f}  фраза {sc["line"]} с {sc["lineStart"]:.2f} ({sc["lineDur"]:.1f} с)')
print("всего", round(end, 1), "с")
