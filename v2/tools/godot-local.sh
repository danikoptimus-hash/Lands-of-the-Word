#!/usr/bin/env bash
# Движок Godot в рабочей среде разработчика: запуск игры версии 2, кадры и проверки — без машин GitHub.
# Разрешение дал владелец 11.11 (.claude/settings.json): разработчик запускает движок только через этот файл.
#
# Движок — официальная сборка Godot для Linux той же версии, что в конвейере: версия и контрольная сумма SHA512
# берутся из .github/workflows/v2.yml, скачанный архив сверяется по ней. Видеокарты в среде нет: картинку считает
# процессор (программный Vulkan «lavapipe») в виртуальном экране Xvfb — так же, как на машинах GitHub.
#
# Запуск из корня репозитория:
#   v2/tools/godot-local.sh version                  — скачать движок (один раз) и показать его версию
#   v2/tools/godot-local.sh check [ПАПКА]            — импорт проекта и проверка всех скриптов, как в конвейере
#   v2/tools/godot-local.sh shots ПАПКА [ключи игры] — кадры и проверки; ключи — как у игры (см. src/main.gd),
#                                                      например --quick или --stops=17,21 для быстрой проверки
# Журналы складываются в ПАПКУ (для check без папки — во временную).
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
workflow="$root/.github/workflows/v2.yml"
version="$(sed -n 's/^  GODOT_VERSION: "\(.*\)"$/\1/p' "$workflow")"
checksum="$(sed -n 's/^  GODOT_SHA512: "\(.*\)"$/\1/p' "$workflow")"
if [ -z "$version" ] || [ -z "$checksum" ]; then
	echo "Не нашёл версию движка или контрольную сумму в $workflow" >&2
	exit 1
fi
cache="${XDG_CACHE_HOME:-$HOME/.cache}/zemli-slova/godot-$version"
godot="$cache/godot"

# Движок: скачать один раз, сверить контрольную сумму, положить в кэш.
engine() {
	if [ -x "$godot" ]; then
		return
	fi
	echo "Скачиваю Godot $version…" >&2
	mkdir -p "$cache"
	local tmp
	tmp="$(mktemp -d)"
	curl -fsSL --retry 3 -o "$tmp/editor.zip" \
		"https://github.com/godotengine/godot/releases/download/${version}-stable/Godot_v${version}-stable_linux.x86_64.zip"
	if ! echo "$checksum  $tmp/editor.zip" | sha512sum -c --quiet - ; then
		rm -rf "$tmp"
		echo "Контрольная сумма архива движка не совпала — движок не установлен" >&2
		exit 1
	fi
	(cd "$tmp" && unzip -q editor.zip)
	mv "$tmp/Godot_v${version}-stable_linux.x86_64" "$godot"
	chmod +x "$godot"
	rm -rf "$tmp"
}

# Программный Vulkan, виртуальный экран и библиотеки окна — тот же набор, что в конвейере.
drivers() {
	if compgen -G "/usr/share/vulkan/icd.d/lvp_icd*.json" > /dev/null && command -v xvfb-run > /dev/null; then
		return
	fi
	echo "Ставлю программную видеокарту и виртуальный экран…" >&2
	local sudo=""
	if [ "$(id -u)" -ne 0 ]; then
		sudo="sudo"
	fi
	$sudo apt-get update -qq
	DEBIAN_FRONTEND=noninteractive $sudo apt-get install -y -qq xvfb mesa-vulkan-drivers libvulkan1 \
		libxcursor1 libxinerama1 libxrandr2 libxi6 libgl1 libfontconfig1 > /dev/null
}

# Импорт проекта: нужен при первом запуске и после изменения ресурсов (шрифты, данные).
import_project() {
	"$godot" --headless --path "$root/v2" --import > "$1/import.log" 2>&1 || true
}

check() {
	local folder="${1:-$(mktemp -d)}"
	mkdir -p "$folder"
	engine
	import_project "$folder"
	: > "$folder/check.log"
	local file
	while read -r file; do
		echo "== $file" >> "$folder/check.log"
		"$godot" --headless --path "$root/v2" --check-only --script "res://$file" >> "$folder/check.log" 2>&1 || true
	done < <(cd "$root/v2" && find src -name "*.gd" | sort)
	if grep -nE "SCRIPT ERROR|Parse Error|Compile Error|Failed to load script" "$folder/import.log" "$folder/check.log"; then
		echo "Ошибки в скриптах — журналы в $folder" >&2
		return 1
	fi
	echo "Скрипты в порядке (журналы в $folder)"
}

shots() {
	if [ $# -lt 1 ]; then
		echo "Укажите папку для кадров" >&2
		exit 1
	fi
	local folder="$1"
	shift
	mkdir -p "$folder"
	folder="$(cd "$folder" && pwd)"
	engine
	drivers
	import_project "$folder"
	local code=0
	xvfb-run -a -s "-screen 0 1600x900x24" timeout 1500 \
		"$godot" --path "$root/v2" --rendering-driver vulkan --audio-driver Dummy --resolution 1600x900 \
		-- "--shots=$folder" "$@" > "$folder/shots.log" 2>&1 || code=$?
	grep -E "ПРОВЕРКА|ИТОГ|МИР|СБОЙ" "$folder/shots.log" || true
	if grep -nE "SCRIPT ERROR|SHADER ERROR|Shader compilation failed|Parse Error" "$folder/shots.log"; then
		echo "Ошибки скриптов или шейдеров — журнал $folder/shots.log" >&2
		return 1
	fi
	if [ "$code" -ne 0 ]; then
		echo "Запуск завершился с кодом $code — журнал $folder/shots.log" >&2
	fi
	return "$code"
}

command="${1:-}"
shift || true
case "$command" in
	version)
		engine
		"$godot" --headless --version
		;;
	check)
		check "$@"
		;;
	shots)
		shots "$@"
		;;
	*)
		sed -n '2,15p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
		exit 1
		;;
esac
