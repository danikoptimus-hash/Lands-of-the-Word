#!/usr/bin/env python3
"""Описание сборки для самообновления (канал «тест») и разбиение архива на части.

Канал «тест» — ветка v2-test этого репозитория, а файл больше 100 МБ GitHub в ветку не принимает. Пока архив
сборки меньше предела, он лежит в канале одним файлом; иначе — частями (….zip.001, ….zip.002, …), а в описании
сборки (latest.json) появляется их список «parts»: программа скачивает части по очереди, склеивает и сверяет
контрольную сумму целого архива (updater.gd, с 0.11.0; сборки старше частей не понимают — им нужен целый файл).

Запуск:  channel.py КОРЕНЬ ПАПКА_СБОРКИ [--parts-test]
В ПАПКЕ_СБОРКИ лежат ZemliSlova-v2-test-win64.zip и win/ZemliSlova-v2-test.exe; номер сборки — в переменных
BUILD_COMMIT и BUILD_STAMP. Создаёт latest.json и, если архив больше предела, части (целый архив тогда убирается):
в папке остаётся ровно то, что выкладывается в канал, — latest.json и файлы ZemliSlova-v2-test-win64.zip*.
С ключом --parts-test дополнительно создаёт папку chasti: то же описание, но архив нарочно разбит на мелкие
части, — на ней проверяется скачивание частями, даже когда в канал идёт один файл.
"""
import hashlib
import json
import os
import re
import shutil
import sys

PART_LIMIT = 95 * 1024 * 1024  # предел размера файла в ветке GitHub — 100 МиБ; с запасом
ARCHIVE = "ZemliSlova-v2-test-win64.zip"
PROGRAM = "ZemliSlova-v2-test.exe"


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as file:
        for block in iter(lambda: file.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def split(archive, folder, part_bytes):
    """Разрезать архив на части в папке folder; вернуть их имена по порядку."""
    names = []
    with open(archive, "rb") as source:
        while True:
            block = source.read(part_bytes)
            if not block:
                break
            name = "%s.%03d" % (os.path.basename(archive), len(names) + 1)
            with open(os.path.join(folder, name), "wb") as part:
                part.write(block)
            names.append(name)
    return names


def main():
    root, folder = sys.argv[1], sys.argv[2]
    parts_test = "--parts-test" in sys.argv[3:]
    archive = os.path.join(folder, ARCHIVE)
    program = os.path.join(folder, "win", PROGRAM)
    version = re.search(r'config/version="([^"]+)"', open(os.path.join(root, "v2/project.godot"), encoding="utf-8").read()).group(1)
    size = os.path.getsize(archive)
    manifest = {
        "format": 1,
        "version": version,
        "commit": os.environ["BUILD_COMMIT"],
        "build": os.environ["BUILD_STAMP"],
        "file": ARCHIVE,
        "size": size,
        "sha256": sha256(archive),
        "exe": PROGRAM,
        "exe_sha256": sha256(program),
        "notes": open(os.path.join(root, "v2/data/chto_novogo.txt"), encoding="utf-8").read().strip(),
    }
    if parts_test:
        test = os.path.join(folder, "chasti")
        shutil.rmtree(test, ignore_errors=True)
        os.makedirs(test)
        with open(os.path.join(test, "latest.json"), "w", encoding="utf-8") as file:
            json.dump(dict(manifest, parts=split(archive, test, size // 3 + 1)), file, ensure_ascii=False, indent=2)
    if size > PART_LIMIT:
        manifest["parts"] = split(archive, folder, PART_LIMIT)
        os.remove(archive)
    with open(os.path.join(folder, "latest.json"), "w", encoding="utf-8") as file:
        json.dump(manifest, file, ensure_ascii=False, indent=2)
    print("Собрано:", json.dumps({"version": version, "build": manifest["build"], "size": size, "parts": len(manifest.get("parts", [])) or 1}, ensure_ascii=False))


if __name__ == "__main__":
    main()
