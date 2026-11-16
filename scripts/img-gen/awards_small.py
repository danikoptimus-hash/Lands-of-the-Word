"""Уменьшенные копии значков наград для списков и рейтингов (ревизия скорости, этап 2).

Значки лежат 512×512, а в рейтингах и сетках показываются 22–64 точки: телефон качал и держал в памяти в несколько раз
больше нужного. Копия 192×192 (64 точки при тройной плотности экрана) кладётся в img/awards/s/; крупная остаётся для
листа награды. Запуск из корня репозитория: python scripts/img-gen/awards_small.py
"""
from pathlib import Path
from PIL import Image

SRC = Path("apps/web/public/img/awards")
OUT = SRC / "s"
SIZE = 192

def main() -> None:
    OUT.mkdir(exist_ok=True)
    total_src = total_out = 0
    for f in sorted(SRC.glob("*.webp")):
        im = Image.open(f).convert("RGBA")
        small = im.resize((SIZE, SIZE), Image.LANCZOS)
        dst = OUT / f.name
        small.save(dst, "WEBP", quality=80, method=6)
        total_src += f.stat().st_size
        total_out += dst.stat().st_size
    print(f"значков: {len(list(OUT.glob('*.webp')))} · было {total_src // 1024} КБ · стало {total_out // 1024} КБ")

if __name__ == "__main__":
    main()
