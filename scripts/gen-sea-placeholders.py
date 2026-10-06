#!/usr/bin/env python3
"""Временные подложки для вахт морей: python3 scripts/gen-sea-placeholders.py
Рисует простые растровые заглушки (шум, градиенты, пиктограммы с подписью) в apps/web/public/img/sea, чтобы механики
можно было проверять до генерации настоящих картинок (scripts/gen-sea-art.mjs). Настоящие картинки перезаписывают
файлы с теми же именами; подписи на заглушках — только для проверки, в финальном арте текста нет."""
import os, random, math
from PIL import Image, ImageDraw, ImageFilter, ImageFont
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "apps", "web", "public", "img", "sea")
SEAS = ["red", "salt", "merom", "galilee", "adria"]
SEA_HUE = {"red": (180, 110, 70), "salt": (150, 170, 160), "merom": (90, 120, 80), "galilee": (70, 120, 140), "adria": (60, 80, 110)}
SPRITES = {
    "sack": ((170, 130, 80), "ellipse"), "crate": ((150, 110, 60), "rect"), "wheat": ((210, 170, 80), "ellipse"), "rope": ((190, 160, 110), "ring"),
    "boat": ((110, 80, 50), "boat"), "anchors": ((60, 60, 70), "anchor"), "anchor": ((60, 60, 70), "anchor"), "sail": ((235, 225, 200), "tri"),
    "sail-furled": ((200, 190, 170), "rect"), "gull": ((240, 240, 240), "gull"), "lantern": ((250, 220, 120), "circle"), "lantern-off": ((90, 80, 70), "circle"),
    "cloud": ((225, 225, 230), "cloud"), "barrel": ((140, 95, 55), "rect"), "net-empty": ((120, 110, 90), "net"), "net-full": ((120, 110, 90), "netfull"),
    "fish": ((120, 160, 180), "fish"), "fire": ((240, 130, 40), "tri"), "bread": ((200, 150, 90), "ellipse"), "tree": ((70, 120, 60), "tree"), "oar": ((150, 110, 70), "bar"),
    "net-drying": ((130, 120, 100), "net"), "chariot": ((160, 120, 60), "chariot"), "chariot-broken": ((120, 90, 50), "chariot"), "wheel": ((110, 80, 50), "ring"),
    "horse": ((120, 80, 50), "horse"), "wall-water": ((70, 130, 170), "rect"), "cloud-pillar": ((230, 230, 235), "pillar"), "palm": ((60, 130, 70), "palm"), "bird": ((50, 50, 60), "gull"),
    "tent": ((190, 160, 120), "tri"), "shield": ((170, 140, 80), "circle"), "salt": ((245, 245, 240), "ellipse"), "dead-tree": ((110, 90, 70), "tree"), "fruit-tree": ((60, 140, 70), "tree"),
    "stream": ((80, 150, 190), "bar"), "salt-pillar": ((235, 235, 225), "pillar"), "stone": ((130, 125, 120), "ellipse"), "fire-chariot": ((230, 120, 40), "chariot"),
    "banner-j": ((180, 50, 40), "flag"), "banner-r": ((50, 90, 170), "flag"), "banner-e": ((60, 140, 80), "flag"), "banner-d": ((220, 180, 60), "flag"), "sailor": ((230, 200, 160), "person"),
}
FIGURES = ["cloak", "helmet", "rope", "spear", "chains", "traveller", "swimmer", "crowd", "crowd2", "rowers", "fisher", "staff", "crown", "crown2", "chariot-man", "pillar", "timbrel", "priest", "runner", "tower"]

def font(size):
    for p in ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"]:
        if os.path.exists(p): return ImageFont.truetype(p, size)
    return ImageFont.load_default()

def noise(img, amount=18, seed=1):
    rnd = random.Random(seed); px = img.load(); w, h = img.size
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            n = rnd.randint(-amount, amount); r, g, b = px[x, y][:3]
            v = (max(0, min(255, r + n)), max(0, min(255, g + n)), max(0, min(255, b + n)))
            for dx in (0, 1):
                for dy in (0, 1):
                    if x + dx < w and y + dy < h: px[x + dx, y + dy] = v + (px[x, y][3:] or ())
    return img

def gradient(w, h, top, bottom):
    img = Image.new("RGB", (w, h)); d = ImageDraw.Draw(img)
    for y in range(h):
        k = y / max(1, h - 1); d.line([(0, y), (w, y)], fill=tuple(int(top[i] + (bottom[i] - top[i]) * k) for i in range(3)))
    return img

def save(img, rel, quality=82):
    path = os.path.join(OUT, rel + ".webp"); os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, "WEBP", quality=quality, method=4)

def label(img, text, size=22, fill=(40, 30, 20)):
    d = ImageDraw.Draw(img); f = font(size); w, h = img.size
    tw = d.textlength(text, font=f); d.text(((w - tw) / 2, h - size - 6), text, font=f, fill=fill)

def sprite(name, color, shape):
    S = 256; img = Image.new("RGBA", (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    c = color + (255,); dark = tuple(max(0, v - 50) for v in color) + (255,)
    cx, cy = S / 2, S / 2 - 10
    if shape == "ellipse": d.ellipse([cx - 90, cy - 60, cx + 90, cy + 60], fill=c, outline=dark, width=4)
    elif shape == "rect": d.rounded_rectangle([cx - 80, cy - 65, cx + 80, cy + 65], 14, fill=c, outline=dark, width=4)
    elif shape == "ring": d.ellipse([cx - 80, cy - 80, cx + 80, cy + 80], outline=c, width=26)
    elif shape == "circle": d.ellipse([cx - 60, cy - 60, cx + 60, cy + 60], fill=c, outline=dark, width=4)
    elif shape == "tri": d.polygon([(cx, cy - 90), (cx + 90, cy + 70), (cx - 90, cy + 70)], fill=c, outline=dark)
    elif shape == "bar": d.rounded_rectangle([cx - 100, cy - 16, cx + 100, cy + 16], 8, fill=c, outline=dark, width=3)
    elif shape == "boat": d.polygon([(cx - 100, cy - 20), (cx + 100, cy - 20), (cx + 70, cy + 50), (cx - 70, cy + 50)], fill=c, outline=dark)
    elif shape == "anchor": d.line([(cx, cy - 80), (cx, cy + 60)], fill=c, width=16); d.arc([cx - 70, cy - 20, cx + 70, cy + 90], 20, 160, fill=c, width=16); d.line([(cx - 50, cy - 50), (cx + 50, cy - 50)], fill=c, width=14)
    elif shape == "gull": d.arc([cx - 90, cy - 30, cx, cy + 30], 200, 340, fill=c, width=10); d.arc([cx, cy - 30, cx + 90, cy + 30], 200, 340, fill=c, width=10)
    elif shape == "cloud":
        for ox, oy, r in [(-50, 10, 45), (0, -20, 60), (55, 10, 45)]: d.ellipse([cx + ox - r, cy + oy - r, cx + ox + r, cy + oy + r], fill=c)
    elif shape in ("net", "netfull"):
        for i in range(-80, 81, 20): d.line([(cx + i, cy - 70), (cx + i, cy + 70)], fill=c, width=3); d.line([(cx - 80, cy + i * 0.8), (cx + 80, cy + i * 0.8)], fill=c, width=3)
        if shape == "netfull":
            for i in range(8): d.ellipse([cx - 60 + i * 15, cy - 20 + (i % 3) * 18, cx - 40 + i * 15, cy - 8 + (i % 3) * 18], fill=(120, 160, 180, 255))
    elif shape == "fish": d.ellipse([cx - 80, cy - 40, cx + 50, cy + 40], fill=c, outline=dark, width=3); d.polygon([(cx + 40, cy), (cx + 95, cy - 45), (cx + 95, cy + 45)], fill=c, outline=dark)
    elif shape == "tree": d.rectangle([cx - 12, cy + 10, cx + 12, cy + 90], fill=(100, 70, 40, 255)); d.ellipse([cx - 70, cy - 90, cx + 70, cy + 30], fill=c, outline=dark, width=3)
    elif shape == "chariot": d.rounded_rectangle([cx - 80, cy - 40, cx + 50, cy + 20], 10, fill=c, outline=dark, width=3); d.ellipse([cx - 70, cy, cx - 10, cy + 60], outline=dark, width=10); d.ellipse([cx + 10, cy, cx + 70, cy + 60], outline=dark, width=10)
    elif shape == "horse": d.ellipse([cx - 80, cy - 20, cx + 40, cy + 50], fill=c, outline=dark, width=3); d.rounded_rectangle([cx + 20, cy - 80, cx + 60, cy], 12, fill=c, outline=dark, width=3); [d.rectangle([cx - 70 + i * 30, cy + 40, cx - 58 + i * 30, cy + 95], fill=dark) for i in range(4)]
    elif shape == "pillar": d.rounded_rectangle([cx - 35, cy - 100, cx + 35, cy + 90], 30, fill=c, outline=dark, width=3)
    elif shape == "palm": d.rectangle([cx - 10, cy - 20, cx + 10, cy + 95], fill=(120, 90, 50, 255)); [d.ellipse([cx - 90 + i * 30, cy - 90, cx - 30 + i * 30, cy - 30], fill=c) for i in range(4)]
    elif shape == "flag": d.rectangle([cx - 60, cy - 90, cx - 50, cy + 95], fill=(90, 70, 40, 255)); d.polygon([(cx - 50, cy - 90), (cx + 80, cy - 60), (cx - 50, cy - 30)], fill=c, outline=dark)
    elif shape == "person": d.ellipse([cx - 28, cy - 95, cx + 28, cy - 40], fill=c, outline=dark, width=3); d.rounded_rectangle([cx - 45, cy - 35, cx + 45, cy + 90], 20, fill=(60, 90, 140, 255), outline=dark, width=3)
    label(img, name, 20, (30, 20, 10) if sum(color) > 300 else (240, 240, 240))
    return img

def main():
    os.makedirs(OUT, exist_ok=True)
    # Общие
    night = gradient(1024, 768, (8, 18, 36), (20, 40, 60)); d = ImageDraw.Draw(night)
    rnd = random.Random(3)
    for _ in range(140): x, y = rnd.randint(0, 1023), rnd.randint(0, 300); d.point((x, y), fill=(220, 225, 240))
    d.polygon([(0, 560), (300, 470), (420, 500), (1024, 600), (1024, 768), (0, 768)], fill=(16, 22, 28))
    d.rectangle([180, 300, 240, 500], fill=(230, 220, 200)); d.polygon([(165, 300), (255, 300), (210, 255)], fill=(140, 50, 40)); d.ellipse([195, 272, 225, 302], fill=(255, 240, 170))
    label(night, "lighthouse (placeholder)", 20, (200, 210, 220)); save(noise(night, 10, 7), "common/lighthouse")
    land = Image.new("RGB", (1024, 768), (232, 217, 181)); save(noise(land, 14, 11), "common/land")
    page = Image.new("RGB", (720, 1000), (239, 228, 200)); save(noise(page, 10, 13), "common/page")
    brass = gradient(1024, 512, (150, 110, 50), (110, 80, 35)); label(brass, "brass panel (placeholder)", 22, (60, 40, 20)); save(noise(brass, 12, 17), "common/panel")
    disc = Image.new("RGBA", (512, 512), (0, 0, 0, 0)); dd = ImageDraw.Draw(disc); dd.ellipse([4, 4, 508, 508], fill=(150, 110, 60, 255), outline=(60, 40, 20, 255), width=6); dd.ellipse([120, 120, 392, 392], fill=(120, 90, 50, 255)); save(disc, "common/disc")
    rose = Image.new("RGBA", (512, 512), (0, 0, 0, 0)); rd = ImageDraw.Draw(rose); rd.ellipse([20, 20, 492, 492], fill=(243, 234, 216, 255), outline=(90, 70, 48, 255), width=6)
    for i in range(32):
        a = math.radians(i * 11.25 - 90); L = 230 if i % 8 == 0 else 200 if i % 4 == 0 else 180 if i % 2 == 0 else 165
        rd.line([(256 + 150 * math.cos(a), 256 + 150 * math.sin(a)), (256 + L * math.cos(a), 256 + L * math.sin(a))], fill=(60, 45, 30, 255), width=4 if i % 8 == 0 else 2)
    f = font(34)
    for txt, (x, y) in {"N": (246, 30), "E": (456, 236), "S": (246, 440), "W": (36, 236)}.items(): rd.text((x, y), txt, font=f, fill=(60, 45, 30, 255))
    for i in range(0, 360, 30):
        a = math.radians(i - 90); rd.text((256 + 118 * math.cos(a) - 12, 256 + 118 * math.sin(a) - 10), str(i), font=font(18), fill=(90, 70, 48, 255))
    save(rose, "common/rose")
    for code in SEAS:
        hue = SEA_HUE[code]
        header = gradient(1536, 512, tuple(min(255, v + 60) for v in hue), hue); label(header, f"{code} header (placeholder)", 26, (255, 255, 255)); save(noise(header, 12, 19), f"{code}/header")
        chart = Image.new("RGB", (1024, 768), (122, 170, 192) if code != "salt" else (160, 195, 200)); save(noise(chart, 16, 23), f"{code}/chart")
        scene = gradient(1024, 768, (150, 185, 205), (190, 170, 130)); dd = ImageDraw.Draw(scene); dd.rectangle([0, 420, 1024, 768], fill=(200, 180, 140) if code != "adria" else (90, 130, 160)); label(scene, f"{code} scene (placeholder)", 24, (60, 50, 40)); save(noise(scene, 10, 29), f"{code}/scene")
        deck = Image.new("RGB", (1024, 920), (120, 85, 50)); dd = ImageDraw.Draw(deck)
        for y in range(0, 920, 46): dd.line([(0, y), (1024, y)], fill=(95, 65, 38), width=4)
        save(noise(deck, 10, 31), f"{code}/deck")
    for name, (color, shape) in SPRITES.items(): save(sprite(name, color, shape), f"sprites/{name}", 90)
    for name in FIGURES:
        img = gradient(300, 400, (90, 70, 50), (50, 40, 30)).convert("RGBA"); dd = ImageDraw.Draw(img)
        dd.ellipse([110, 60, 190, 140], fill=(20, 15, 10, 255)); dd.rounded_rectangle([80, 150, 220, 360], 30, fill=(20, 15, 10, 255))
        label(img, name, 22, (220, 210, 190)); save(img, f"figures/{name}", 85)
    print("ok:", OUT)

if __name__ == "__main__": main()
