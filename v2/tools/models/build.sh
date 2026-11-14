#!/usr/bin/env bash
# Сборка модели дерева из Blender от исходников до файла игры (решение владельца 13.11: модели — в Blender).
#
# Запуск из корня репозитория:  v2/tools/models/build.sh oliva [ПАПКА_ПОКАЗА]
# Исходник вида — v2/models_src/<вид>/vetki_foto.png: фотография веток на зелёном фоне (её делает генератор
# картинок, промт — в v2/assets/ASSETS.md). Шаги: вырезка веток с фона → ветви из них в Blender и съёмка в клетки
# → атлас листвы → кора (фотоскан) → дерево: три варианта, три уровня подробности → v2/assets/models/flora/<вид>.glb
# и v2/models_src/<вид>/<вид>.blend (его можно открыть в Blender). Промежуточные файлы в репозиторий не попадают.
# После сборки — перезапечь дальние изображения: v2/tools/godot-local.sh shots ПАПКА --bake-impostors.
# С ПАПКОЙ_ПОКАЗА — ещё и рендеры трёх вариантов для листа на приёмку.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
kind="${1:?Укажите вид: oliva}"
show="${2:-}"
python="${MODELS_PYTHON:-python3}"
source="$root/v2/models_src/$kind"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

case "$kind" in
	oliva)
		bark=(bark_willow_02 512 0.7 0.9,0.88,0.86)
		grade=(--sat 0.72 --gain 1.12 --tint 0.97,1.0,1.02)
		cells=(vetv_1:0.9:1.0 vetv_2:0.9:1.0 vetv_3:0.9:1.0 vetv_4:0.9:1.0 ohapka_1:1.9:1.35 ohapka_2:1.9:1.35)
		;;
	*)
		echo "Неизвестный вид: $kind" >&2
		exit 1
		;;
esac

"$python" "$root/v2/tools/models/key.py" "$source/vetki_foto.png" "$source/vetka"
"$root/v2/tools/blender-local.sh" run "$root/v2/tools/blender/${kind}_atlas.py" "$work/cells" > "$work/atlas.log" 2>&1 || { tail -20 "$work/atlas.log"; exit 1; }
"$python" "$root/v2/tools/models/atlas.py" "$work/cells" "$source/listva" 1024 "${grade[@]}" "${cells[@]}"
"$python" "$root/v2/tools/models/bark.py" "${bark[0]}" "$source" "${bark[1]}" "${bark[2]}" "${bark[3]}"
"$root/v2/tools/blender-local.sh" run "$root/v2/tools/blender/$kind.py" "$work/show" --export > "$work/export.log" 2>&1 || { tail -20 "$work/export.log"; exit 1; }
grep -a "треугольников" "$work/export.log" || true
if [ -n "$show" ]; then
	"$root/v2/tools/blender-local.sh" run "$root/v2/tools/blender/$kind.py" "$show" 1 2 3 > "$work/show.log" 2>&1 || { tail -20 "$work/show.log"; exit 1; }
fi
ls -la "$root/v2/assets/models/flora/$kind.glb" "$source/$kind.blend"
