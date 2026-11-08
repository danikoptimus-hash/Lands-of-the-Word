# Сведение звука ролика «Осень»: голос по раскладке, музыка с приглушением под голосом, звуки в ключевые моменты.
import json, os, subprocess, sys
D = os.path.dirname(os.path.abspath(__file__)); A = os.path.join(D, "..", "audio")
TL = json.load(open(os.path.join(D, "timeline.json")))
SC = {s["id"]: s for s in TL["scenes"]}
W = lambda sc, w: SC[sc]["lineStart"] + w
END = TL["end"]
FALL_START = W("fall", 1.4) - 0.5          # первый удар трека — на «16:32»
music = [  # файл, начало, конец, вход, выход, громкость
    ("osen-main", 0.0, SC["war"]["start"] + 0.4, 0.3, 1.6, 0.55),
    ("osen-war", SC["war"]["start"] - 0.6, SC["war"]["start"] - 0.6 + 55.0, 0.8, 2.5, 0.5),
    ("osen-fall", FALL_START, FALL_START + 39.5, 0.01, 3.0, 0.62),
    ("osen-outro", SC["totals"]["start"] - 1.0, END, 3.0, 2.5, 0.55),
]
sfx = []
for sc in ["deeds", "sea", "cities", "chronicle", "repel", "ruins", "totals", "standing"]: sfx.append(("whoosh", SC[sc]["start"] - 0.3, 0.22))
sfx += [("impact", W("war", 1.0), 0.55), ("bricks", W("war", 5.9), 0.3), ("coin", W("deeds", 5.3), 0.25),
        ("bricks", W("wall", 1.6), 0.45), ("stamp", W("wall", 10.33), 0.85), ("crumble", W("wall", 11.0), 0.6),
        ("impact", W("fall", 1.3), 0.85), ("fireworks", W("fall", 8.0), 0.75), ("fireworks", W("fall", 8.0) + 9.0, 0.55),
        ("coin", W("repel", 7.5), 0.35), ("coin", W("repel", 7.7), 0.3)]
for w in [1.6, 3.2, 8.5, 10.6, 11.9, 12.1, 12.3, 12.5]: sfx.append(("coin", W("totals", w), 0.22))
for w in [1.4, 4.2]: sfx.append(("coin", W("standing", w), 0.25))
war_end = SC["war"]["start"] - 0.6 + 55.0
t = war_end; k = 0
while t < FALL_START - 0.3:  # часы тикают между концом военной темы и падением
    sfx.append(("tick", t, min(0.25 + 0.05 * k, 0.6))); t += 1.0; k += 1

inputs, filt, vlabels, mlabels, slabels = [], [], [], [], []
def add(path): inputs.extend(["-i", path]); return len(inputs) // 2 - 1
for l in TL["lines"]:
    i = add(os.path.join(A, "lines", l["id"] + ".wav")); ms = int(l["start"] * 1000)
    filt.append(f"[{i}:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay={ms}|{ms}[v{i}]"); vlabels.append(f"[v{i}]")
for name, s, e, fi, fo, vol in music:
    i = add(os.path.join(A, "music", name + ".mp3")); ms = int(s * 1000); d = e - s
    filt.append(f"[{i}:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=0:{d:.3f},afade=t=in:d={fi},afade=t=out:st={max(0, d - fo):.3f}:d={fo},volume={vol},adelay={ms}|{ms}[m{i}]"); mlabels.append(f"[m{i}]")
for name, s, vol in sfx:
    i = add(os.path.join(A, "sfx", name + ".mp3")); ms = int(max(0, s) * 1000)
    filt.append(f"[{i}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume={vol},adelay={ms}|{ms}[s{i}]"); slabels.append(f"[s{i}]")
filt.append(f"{''.join(vlabels)}amix=inputs={len(vlabels)}:normalize=0,apad=whole_dur={END}[voice]")
filt.append("[voice]asplit=2[vo][vsc]")
filt.append(f"{''.join(mlabels)}amix=inputs={len(mlabels)}:normalize=0,apad=whole_dur={END}[mus]")
filt.append("[mus][vsc]sidechaincompress=threshold=0.04:ratio=5:attack=30:release=500:makeup=1[duck]")
filt.append(f"{''.join(slabels)}amix=inputs={len(slabels)}:normalize=0,apad=whole_dur={END}[fx]")
filt.append(f"[vo][duck][fx]amix=inputs=3:normalize=0,atrim=0:{END},afade=t=out:st={END - 2.5}:d=2.5,loudnorm=I=-15:TP=-1.5:LRA=11[out]")
out = os.path.join(D, "..", "mix.wav")
cmd = ["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", ";".join(filt), "-map", "[out]", "-ar", "48000", out]
subprocess.run(cmd, check=True)
print("микс:", out, "звуков", len(sfx), "конец военной темы", round(war_end, 2), "удар", round(FALL_START + 0.5, 2))
