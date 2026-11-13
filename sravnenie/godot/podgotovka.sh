#!/usr/bin/env bash
# Подготовка проекта Godot для сравнения движков: готовые дополнения и данные основы.
# Движок не запускает. Запуск из корня репозитория: sravnenie/godot/podgotovka.sh
#
# Дополнения (в репозиторий не кладутся, скачиваются сюда по закреплённым версиям):
#   Terrain3D 1.1.0 (MIT, TokisanGames) — земля: https://github.com/TokisanGames/Terrain3D
#   SunshineClouds2 (MIT, Bonkahe) — объёмные облака: https://github.com/Bonkahe/SunshineClouds2
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
cache="${XDG_CACHE_HOME:-$HOME/.cache}/zemli-slova/sravnenie"
mkdir -p "$cache" "$here/addons" "$here/dannye"

t3d_tag="v1.1.0-stable"
t3d_sha="51b78bc758f5759cbc8eaaab14e5cf4e8661717e265fdd760f5abf945f15b243"
clouds_commit="${CLOUDS_COMMIT:-}"

if [ ! -f "$here/addons/terrain_3d/terrain.gdextension" ]; then
	zip="$cache/Terrain3D_${t3d_tag}.zip"
	if [ ! -s "$zip" ]; then
		echo "Скачиваю Terrain3D ${t3d_tag}…" >&2
		curl -fsSL --retry 3 -o "$zip" "https://github.com/TokisanGames/Terrain3D/releases/download/${t3d_tag}/Terrain3D_${t3d_tag}.zip"
	fi
	if ! echo "$t3d_sha  $zip" | sha256sum -c --quiet - ; then
		rm -f "$zip"
		echo "Контрольная сумма Terrain3D не совпала — дополнение не установлено" >&2
		exit 1
	fi
	tmp="$(mktemp -d)"
	unzip -q "$zip" "addons/terrain_3d/*" -d "$tmp"
	# Из библиотек нужны только Linux (рабочая среда) и Windows (сборка владельцу).
	find "$tmp/addons/terrain_3d/bin" -mindepth 1 -maxdepth 1 \
		! -name "libterrain.linux.*.x86_64.so" ! -name "libterrain.windows.*.x86_64.dll" -exec rm -rf {} +
	rm -rf "$here/addons/terrain_3d"
	mv "$tmp/addons/terrain_3d" "$here/addons/terrain_3d"
	rm -rf "$tmp"
fi

if [ ! -d "$here/addons/SunshineClouds2" ]; then
	src="$cache/sunshineclouds2"
	if [ ! -d "$src/.git" ]; then
		echo "Скачиваю SunshineClouds2…" >&2
		GIT_LFS_SKIP_SMUDGE=1 git clone -q --depth 1 https://github.com/Bonkahe/SunshineClouds2 "$src"
	fi
	cp -r "$src/addons/SunshineClouds2" "$here/addons/SunshineClouds2"
	git -C "$src" rev-parse HEAD > "$here/addons/SunshineClouds2/VERSIYA.txt"
fi

# Данные основы: копии под именами, которые движок не пытается импортировать как картинки.
for name in vysoty maski porody; do
	cp "$root/sravnenie/osnova/dannye/$name.png" "$here/dannye/$name.bin"
done
cp "$root/sravnenie/osnova/dannye/opisanie.json" "$here/dannye/opisanie.json"
echo "Готово: дополнения в $here/addons, данные в $here/dannye"
