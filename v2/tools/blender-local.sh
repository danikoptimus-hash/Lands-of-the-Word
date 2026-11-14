#!/usr/bin/env bash
# Blender в рабочей среде разработчика: модели версии 2 строятся скриптами, без окна (согласие владельца 13.11:
# «в облаке у Claude»). Официальная сборка Blender LTS скачивается один раз в кэш и сверяется по контрольной сумме.
#
# Запуск из корня репозитория:
#   v2/tools/blender-local.sh version                      — скачать Blender (один раз) и показать версию
#   v2/tools/blender-local.sh run СКРИПТ.py [ключи скрипта] — выполнить скрипт без окна (ключи доходят до скрипта после «--»)
#   v2/tools/blender-local.sh open ФАЙЛ.blend СКРИПТ.py [ключи] — то же, открыв сначала файл .blend
# Скрипты моделей — v2/tools/blender/ (общая часть — treelib.py), исходники и файлы .blend — v2/models_src/.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
version="4.5.9"
checksum="dcdc3eca6c9825bb35a8033b689c053f3cb5a9b0cd2a61b2eac2a49436b4ad3d"  # SHA256 архива для Linux x64 с download.blender.org
cache="${XDG_CACHE_HOME:-$HOME/.cache}/zemli-slova/blender-$version"
blender="$cache/blender"

engine() {
	if [ -x "$blender" ]; then
		return
	fi
	echo "Скачиваю Blender $version…" >&2
	mkdir -p "$cache"
	local tmp
	tmp="$(mktemp -d)"
	curl -fsSL --retry 3 -o "$tmp/blender.tar.xz" "https://download.blender.org/release/Blender${version%.*}/blender-${version}-linux-x64.tar.xz"
	if ! echo "$checksum  $tmp/blender.tar.xz" | sha256sum -c --quiet - ; then
		rm -rf "$tmp"
		echo "Контрольная сумма архива Blender не совпала — Blender не установлен" >&2
		exit 1
	fi
	tar -xJf "$tmp/blender.tar.xz" -C "$cache" --strip-components=1
	rm -rf "$tmp"
}

command="${1:-}"
shift || true
case "$command" in
	version)
		engine
		"$blender" --version | head -1
		;;
	run)
		engine
		script="$1"
		shift
		"$blender" --background --factory-startup --python-exit-code 1 --python "$script" -- "$@"
		;;
	open)
		engine
		file="$1"
		script="$2"
		shift 2
		"$blender" --background --factory-startup --python-exit-code 1 "$file" --python "$script" -- "$@"
		;;
	*)
		sed -n '2,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
		exit 1
		;;
esac
