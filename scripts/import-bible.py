#!/usr/bin/env python3
"""Собирает content/bible/<код книги>.json из текстовой выгрузки Синодального перевода.

Формат источника: одна строка = один стих (или его часть): «Книга глава:стих текст».
Части одного стиха (несколько строк с одной ссылкой) склеиваются. Существующие поля
«genealogies» в json сохраняются.

Запуск: python3 scripts/import-bible.py content/bible/bible_synodal.txt
"""
import json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "content" / "bible"

# Русские названия книг → коды (как в packages/domain/src/books.ts).
NAMES = {
    "Бытие": "gen", "Исход": "exo", "Левит": "lev", "Числа": "num", "Второзаконие": "deu", "Иисус Навин": "jos", "Судьи": "jdg", "Руфь": "rut",
    "1 Царств": "1sa", "2 Царств": "2sa", "3 Царств": "1ki", "4 Царств": "2ki", "1 Паралипоменон": "1ch", "2 Паралипоменон": "2ch",
    "Ездра": "ezr", "Неемия": "neh", "Есфирь": "est", "Иов": "job", "Псалтирь": "psa", "Притчи": "pro", "Екклесиаст": "ecc", "Песнь песней": "sng",
    "Исаия": "isa", "Иеремия": "jer", "Плач Иеремии": "lam", "Иезекииль": "ezk", "Даниил": "dan", "Осия": "hos", "Иоиль": "jol", "Амос": "amo",
    "Авдий": "oba", "Иона": "jon", "Михей": "mic", "Наум": "nam", "Аввакум": "hab", "Софония": "zep", "Аггей": "hag", "Захария": "zec", "Малахия": "mal",
    "Матфея": "mat", "Марка": "mrk", "Луки": "luk", "Иоанна": "jhn", "Деяния": "act", "Иакова": "jas", "1 Петра": "1pe", "2 Петра": "2pe",
    "1 Иоанна": "1jn", "2 Иоанна": "2jn", "3 Иоанна": "3jn", "Иуды": "jud", "Римлянам": "rom", "1 Коринфянам": "1co", "2 Коринфянам": "2co",
    "Галатам": "gal", "Ефесянам": "eph", "Филиппийцам": "php", "Колоссянам": "col", "1 Фессалоникийцам": "1th", "2 Фессалоникийцам": "2th",
    "1 Тимофею": "1ti", "2 Тимофею": "2ti", "Титу": "tit", "Филимону": "phm", "Евреям": "heb", "Откровение": "rev",
}

def main(src: str) -> None:
    books: dict[str, dict[int, dict[int, str]]] = {}
    order: list[str] = []
    line_re = re.compile(r"^(.+?) (\d+):(\d+) (.*)$")
    with open(src, encoding="utf-8") as f:
        for raw in f:
            line = raw.rstrip("\n").strip()
            if not line:
                continue
            m = line_re.match(line)
            if not m:
                raise SystemExit(f"Не разобрана строка: {line[:80]}")
            name, ch, v, text = m.group(1), int(m.group(2)), int(m.group(3)), m.group(4).strip()
            if name not in NAMES:
                raise SystemExit(f"Неизвестная книга: {name}")
            book = books.setdefault(name, {})
            if name not in order:
                order.append(name)
            chapter = book.setdefault(ch, {})
            chapter[v] = (chapter[v] + " " + text).strip() if v in chapter else text
    OUT.mkdir(parents=True, exist_ok=True)
    total = 0
    for name in order:
        code = NAMES[name]
        book = books[name]
        chapters_n = max(book)
        chapters: list[list[str]] = []
        for ch in range(1, chapters_n + 1):
            verses = book.get(ch)
            if not verses:
                raise SystemExit(f"{name}: нет главы {ch}")
            n = max(verses)
            missing = [v for v in range(1, n + 1) if v not in verses]
            if missing:
                raise SystemExit(f"{name} {ch}: пропущены стихи {missing[:10]}")
            chapters.append([verses[v] for v in range(1, n + 1)])
        path = OUT / f"{code}.json"
        prev = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        data = {
            "code": code,
            "name": name,
            "translation": "Синодальный перевод",
            "verseCounts": [len(c) for c in chapters],
            "chapters": chapters,
            "genealogies": prev.get("genealogies", []),
        }
        if prev.get("verseCounts") and prev["verseCounts"] != data["verseCounts"]:
            print(f"ВНИМАНИЕ {name}: число стихов по главам изменилось: было {prev['verseCounts']}, стало {data['verseCounts']}")
        path.write_text(json.dumps(data, ensure_ascii=False, indent=0), encoding="utf-8")
        total += sum(data["verseCounts"])
    print(f"Книг: {len(order)}, стихов: {total}, файлы в {OUT}")
    if len(order) != 66:
        print("ВНИМАНИЕ: ожидалось 66 книг")

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else str(ROOT / "content" / "bible" / "bible_synodal.txt"))
