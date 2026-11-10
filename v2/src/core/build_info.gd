class_name BuildInfo
extends RefCounted
## Номер версии и сборки. Строку BUILD при сборке подставляет конвейер (.github/workflows/v2.yml).

const BUILD := "местная"
const STEP := "Шаги 1.1 и 1.2: камера и форма земли"


static func version() -> String:
	return str(ProjectSettings.get_setting("application/config/version", "0"))


static func label() -> String:
	return "версия 2 · тест %s · сборка %s" % [version(), BUILD]
