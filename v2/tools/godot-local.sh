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
#   v2/tools/godot-local.sh build ПАПКА              — сборка для Windows, как в конвейере: архив, описание для
#                                                      самообновления (latest.json) и проверка самообновления;
#                                                      в ПАПКЕ — ровно то, что выкладывается в канал «тест»
# Журналы складываются в ПАПКУ (для check без папки — во временную).
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# Папка v2/out (кадры, журналы, сборки) лежит внутри проекта: без пометки .gdignore движок импортирует снятые
# кадры как ресурсы игры и кладёт их в сборку (так архив 0.10.0 вышел вдвое тяжелее — 185 МБ вместо 90).
mkdir -p "$root/v2/out"
: > "$root/v2/out/.gdignore"
workflow="$root/.github/workflows/v2.yml"
version="$(sed -n 's/^  GODOT_VERSION: "\(.*\)"$/\1/p' "$workflow")"
checksum="$(sed -n 's/^  GODOT_SHA512: "\(.*\)"$/\1/p' "$workflow")"
templates_checksum="$(sed -n 's/^  TEMPLATES_SHA512: "\(.*\)"$/\1/p' "$workflow")"
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

# Шаблон сборки для Windows той же версии: скачать архив шаблонов один раз, сверить SHA512, оставить только
# шаблон Windows (остальное — около гигабайта — не нужно).
templates() {
	local target="${XDG_DATA_HOME:-$HOME/.local/share}/godot/export_templates/${version}.stable"
	if [ -s "$target/windows_release_x86_64.exe" ]; then
		return
	fi
	if [ -z "$templates_checksum" ]; then
		echo "Не нашёл контрольную сумму шаблонов в $workflow" >&2
		exit 1
	fi
	echo "Скачиваю шаблоны сборки Godot $version…" >&2
	local tmp
	tmp="$(mktemp -d)"
	curl -fsSL --retry 3 -o "$tmp/templates.tpz" \
		"https://github.com/godotengine/godot/releases/download/${version}-stable/Godot_v${version}-stable_export_templates.tpz"
	if ! echo "$templates_checksum  $tmp/templates.tpz" | sha512sum -c --quiet - ; then
		rm -rf "$tmp"
		echo "Контрольная сумма шаблонов не совпала — шаблоны не установлены" >&2
		exit 1
	fi
	mkdir -p "$target"
	unzip -q -j "$tmp/templates.tpz" "templates/windows_release_x86_64.exe" "templates/version.txt" -d "$target"
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
	# Материалы земли (шаг 1.3) на программной видеокарте считаются долго: полный прогон пяти карт — около часа.
	xvfb-run -a -s "-screen 0 1600x900x24" timeout 5400 \
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

# Сборка для Windows, как в конвейере (.github/workflows/v2.yml): номер сборки в программе, архив с программой
# и памяткой, описание для самообновления и проверка самообновления на месте. Рабочие файлы не меняются: номер
# сборки вписывается на время сборки и возвращается обратно.
build() {
	if [ $# -lt 1 ]; then
		echo "Укажите папку для сборки" >&2
		exit 1
	fi
	local folder="$1"
	mkdir -p "$folder"
	folder="$(cd "$folder" && pwd)"
	rm -rf "$folder/win" "$folder/updtest" "$folder"/*.zip "$folder/latest.json"
	engine
	templates
	local info="$root/v2/src/core/build_info.gd"
	local commit stamp
	commit="$(git -C "$root" rev-parse --short HEAD)"
	stamp="${commit} от $(date -u +%d.%m.%Y)"
	cp "$info" "$folder/build_info.gd.orig"
	trap 'cp "$folder/build_info.gd.orig" "$info"' EXIT
	sed -i "s/^const BUILD := \".*\"/const BUILD := \"${stamp}\"/" "$info"
	sed -i "s/^const COMMIT := \"[^\"]*\"/const COMMIT := \"${commit}\"/" "$info"
	import_project "$folder"
	mkdir -p "$folder/win"
	"$godot" --headless --path "$root/v2" --export-release "Windows Desktop" "$folder/win/ZemliSlova-v2-test.exe" > "$folder/export.log" 2>&1 || true
	cp "$folder/build_info.gd.orig" "$info"
	trap - EXIT
	if [ ! -s "$folder/win/ZemliSlova-v2-test.exe" ]; then
		echo "Сборка для Windows не получилась — журнал $folder/export.log" >&2
		return 1
	fi
	cp "$root/v2/tools/KAK-ZAPUSTIT.txt" "$folder/win/"
	(cd "$folder/win" && zip -q -9 ../ZemliSlova-v2-test-win64.zip ./*)
	# Описание сборки и, если архив больше предела GitHub, его части (v2/tools/channel.py); папка chasti —
	# тот же архив мелкими частями, для проверки скачивания частями.
	BUILD_COMMIT="$commit" BUILD_STAMP="$stamp" python3 "$root/v2/tools/channel.py" "$root" "$folder" --parts-test
	rm -rf "$folder/win"
	# Проверка самообновления: программа берёт описание и архив с местного адреса и ставит их, как у владельца, —
	# дважды: так, как сборка ляжет в канал, и частями.
	local served log
	for served in "$folder" "$folder/chasti"; do
		log="$folder/update.log"
		if [ "$served" != "$folder" ]; then
			log="$folder/update-chasti.log"
		fi
		python3 -m http.server 8765 --bind 127.0.0.1 --directory "$served" > "$folder/http.log" 2>&1 &
		local server=$!
		sleep 1
		local code=0
		timeout 300 "$godot" --headless --path "$root/v2" -- "--update-test=http://127.0.0.1:8765/" \
			"--update-target=$folder/updtest/ZemliSlova-v2-test.exe" > "$log" 2>&1 || code=$?
		kill "$server" 2> /dev/null || true
		wait "$server" 2> /dev/null || true
		rm -rf "$folder/updtest"
		grep -E "ПРОВЕРКА|ИТОГ" "$log" || true
		if grep -nE "SCRIPT ERROR|Parse Error|НЕ ПРОЙДЕНА" "$log" || [ "$code" -ne 0 ]; then
			echo "Самообновление не прошло проверку — журнал $log" >&2
			return 1
		fi
	done
	rm -rf "$folder/chasti"
	echo "Сборка готова: $folder (latest.json и файлы ZemliSlova-v2-test-win64.zip* — то, что выкладывается в канал «тест»)"
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
	build)
		build "$@"
		;;
	*)
		sed -n '2,18p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
		exit 1
		;;
esac
