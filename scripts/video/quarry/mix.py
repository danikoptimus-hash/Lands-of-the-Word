"""Сведение звука ролика о Каменоломне: фразы диктора по таймлайну и музыка quarry-main тихо под голосом (приглушается на фразах)."""
import json, os, subprocess, sys
R = os.environ.get("R") or sys.exit("Нужна R — рабочая папка ролика")
D = os.path.dirname(os.path.abspath(__file__))
tl = json.loads(open(f"{R}/timeline.json").read()); T = tl["total"]; n = len(tl["scenes"])
args = ["ffmpeg", "-v", "error", "-y"] + sum((["-i", f"{R}/audio/lines/s{sc['i']}.wav"] for sc in tl["scenes"]), []) + ["-i", f"{R}/audio/vt/music/quarry-main.mp3"]
parts = [f"[{k}:a]aresample=48000,aformat=channel_layouts=stereo,adelay={int(round(sc['voice'] * 1000))}|{int(round(sc['voice'] * 1000))}[v{k}]" for k, sc in enumerate(tl["scenes"])]
parts += ["".join(f"[v{k}]" for k in range(n)) + f"amix=inputs={n}:normalize=0:duration=longest,apad=whole_dur={T}[voice]", "[voice]asplit=2[vmix][vkey]",
          f"[{n}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:{T},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=1.5,afade=t=out:st={T - 3.5:.2f}:d=3.5,volume=0.32[mus]",
          "[mus][vkey]sidechaincompress=threshold=0.04:ratio=5:attack=30:release=500[duck]",
          f"[vmix][duck]amix=inputs=2:normalize=0:duration=first,atrim=0:{T},loudnorm=I=-16:TP=-1.5:LRA=11[out]"]
subprocess.run(args + ["-filter_complex", ";".join(parts), "-map", "[out]", "-ar", "48000", "-ac", "2", f"{R}/mix.wav"], check=True)
print("готово:", f"{R}/mix.wav")
