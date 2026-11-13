class_name BuildInfo
extends RefCounted
## Номер версии и сборки. Строки BUILD и COMMIT при сборке подставляет конвейер (.github/workflows/v2.yml).

const BUILD := "местная"
const COMMIT := ""  ## короткий номер коммита; пусто — сборка сделана не конвейером, самообновления нет
const NOTES_PATH := "res://data/chto_novogo.txt"
const STEP := "Новые модели деревьев: дуб, олива, кипарис, сосна"


static func version() -> String:
	return str(ProjectSettings.get_setting("application/config/version", "0"))


static func label() -> String:
	return "версия 2 · тест %s · сборка %s" % [version(), BUILD]


## Записка «что нового в этой сборке».
static func notes() -> String:
	return FileAccess.get_file_as_string(NOTES_PATH).strip_edges()
