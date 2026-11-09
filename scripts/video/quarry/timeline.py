"""Таймлайн ролика о Каменоломне: сцены по фразам диктора, кадры, наезды камеры, нажатия → data.js.
R — рабочая папка: R/audio/lines/durations.txt (длительности фраз), R/cap/shots.json (точки нажатий)."""
import json, os, sys
R = os.environ.get("R") or sys.exit("Нужна R — рабочая папка ролика")
dur = {int(k[1:]): float(v) for k, v in (l.split() for l in open(f"{R}/audio/lines/durations.txt"))}
taps = json.load(open(f"{R}/cap/shots.json"))["shots"]
A, C, S, M = "Администратор", "Капитан команды «Ковчег»", "Капитан команды «Странники»", "Участник команды «Ковчег»"
F = [960, 540, 1920]
# (кадр, длительность или None — остаток сцены, камера от [cx, cy, ширина], камера до, нажатие в конце, плашка)
SCENES = [
 [("t3_map", None, F, [1110, 700, 1150], False, C)],
 [("a1_map", 3.6, F, [1020, 640, 1500], True, A), ("a2_sheet", None, [960, 540, 1880], [960, 420, 1500], False, A)],
 [("a2_sheet", 1.5, [960, 420, 1500], [1150, 440, 1300], True, A), ("a3_form", 5.6, [960, 520, 1800], [960, 640, 1600], True, A), ("a4_list", 1.9, F, [960, 500, 1800], False, A), ("a5_setmenu", None, [960, 600, 1800], [880, 760, 1350], False, A)],
 [("t1_map", 3.4, F, [700, 420, 1700], True, C), ("t2_attention", None, [960, 420, 1800], [960, 330, 1350], False, C)],
 [("t3_map", 4.4, [1110, 700, 1150], [1140, 790, 900], True, C), ("t4_sheet", None, [960, 540, 1880], [960, 420, 1450], False, C)],
 [("t5_map", 2.4, [1110, 700, 1300], [1140, 790, 1000], True, S), ("t5_sheet", None, [960, 520, 1800], [940, 330, 1250], False, S)],
 [("t6_list", -1.3, [960, 540, 1880], [1000, 760, 1450], True, C), ("t7_form", None, [960, 700, 1700], [900, 820, 1350], False, C)],
 [("t8_present", 2.6, [900, 640, 1350], [1100, 620, 1250], True, C), ("t9_beforelink", 2.3, [960, 700, 1500], [700, 740, 1300], True, C), ("t10_ready", 2.6, [960, 700, 1500], [760, 800, 1300], True, C), ("t11_pending", None, [960, 540, 1800], [960, 760, 1400], False, C)],
 [("a6_map", 2.1, F, [700, 520, 1600], True, A), ("a7_review", 4.4, [960, 540, 1800], [960, 520, 1300], True, A), ("a8_return", None, [960, 540, 1500], [900, 760, 1250], False, A)],
 [("a9_review", 2.5, [960, 540, 1500], [1100, 560, 1250], True, A), ("a10_accepted", 1.9, [960, 540, 1800], [960, 700, 1500], False, A), ("t12_service", None, [960, 540, 1800], [900, 520, 1300], False, M)],
 [("t13_stones", 3.4, [960, 540, 1880], [1100, 300, 1150], False, C), ("t14_map", None, F, [880, 570, 900], True, C)],
 [("t15_deed", 4.3, [960, 520, 1600], [1060, 500, 1100], True, C), ("t16_confirm", 3.0, [960, 540, 1500], [960, 620, 1150], True, C), ("t17_paved", None, [880, 580, 1100], [860, 600, 950], False, C)],
 [("t18_map", 2.0, [880, 570, 900], [920, 520, 800], True, C), ("t18_returned", None, [960, 520, 1300], [1060, 560, 1050], False, C)],
 [("t19_ship", 1.9, [1140, 630, 1500], [1140, 630, 1000], True, C), ("t20_wreck", 2.6, [960, 450, 1500], [960, 560, 1250], False, C), ("t21_works", None, [960, 700, 1500], [960, 880, 1200], False, C)],
 [("t3_map", None, [1140, 790, 900], F, False, None)],
]
out, t = [], 0.0
for i, sc in enumerate(SCENES):
    pre, post = (1.4 if i == 0 else 0.35), (3.2 if i == len(SCENES) - 1 else 0.45)
    total = pre + dur[i] + post
    # отрицательная длительность — «вся сцена, кроме стольких секунд в конце»
    lens = [(total + d if d is not None and d < 0 else d) for _, d, *_ in sc]
    rest = total - sum(x for x in lens if x)
    shots, st = [], t
    for (name, _, fr, to, tap, badge), d in zip(sc, lens):
        dd = d if d else rest
        shots.append({"img": name, "t0": round(st, 3), "t1": round(st + dd, 3), "from": fr, "to": to, "tap": taps.get(name, {}).get("tap") if tap else None, "badge": badge})
        st += dd
    out.append({"i": i, "t0": round(t, 3), "voice": round(t + pre, 3), "t1": round(t + total, 3), "shots": shots})
    t += total
tl = {"scenes": out, "total": round(t, 3)}
open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "data.js"), "w").write("window.TL=" + json.dumps(tl, ensure_ascii=False) + ";\nwindow.CAP=" + json.dumps("file://" + os.path.abspath(R) + "/cap/") + ";")
json.dump(tl, open(f"{R}/timeline.json", "w"), ensure_ascii=False, indent=1)
print("всего", tl["total"], "с")
