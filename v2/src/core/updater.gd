class_name Updater
extends Node
## Самообновление тестовой сборки (канал «тест»).
##
## Свежие сборки лежат в ветке v2-test репозитория: описание latest.json и архив с программой.
## Работающую программу Windows заменить не даёт, поэтому обновление идёт в три запуска:
##   1. старая сборка скачивает архив, проверяет его и кладёт рядом новую программу (…-new.exe), запускает её и закрывается;
##   2. новая программа копирует себя на место старой, запускает её и закрывается;
##   3. программа на своём месте убирает временный файл.
## Любой сбой не страшен: остаётся и запускается прежняя сборка.

signal progress(text: String)

const CHANNEL_URL := "https://raw.githubusercontent.com/danikoptimus-hash/Lands-of-the-Word/v2-test/"
const MANIFEST_NAME := "latest.json"
const STATE_PATH := "user://sostoyanie.cfg"
const ARCHIVE_PATH := "user://obnovlenie.zip"
const CHECK_TIMEOUT := 6.0
const DOWNLOAD_TIMEOUT := 900.0
const REPLACE_ATTEMPTS := 60  ## раз в 0,35 с: около 20 секунд ждём, пока прежняя программа закроется
const REPLACE_PAUSE := 0.35

var base_url := CHANNEL_URL
var target_path := ""  ## файл программы, который обновляем
var own_path := ""  ## файл, из которого запущена эта программа
var error := ""
var available_version := ""
var available_commit := ""

var _manifest := {}
var _download: HTTPRequest
var _cancelled := false


func _ready() -> void:
	if own_path.is_empty():
		own_path = OS.get_executable_path()
	if target_path.is_empty():
		target_path = own_path


func _process(_delta: float) -> void:
	if _download == null:
		return
	var total := float(_download.get_body_size())
	if total <= 0.0:
		total = float(int(_manifest.get("size", 0)))
	var done := float(_download.get_downloaded_bytes())
	if total > 0.0:
		progress.emit("Скачиваю новую сборку %s: %d %% (%.0f из %.0f МБ)\nEsc — пропустить и запустить прежнюю" % [
			available_version, roundi(100.0 * done / total), done / 1048576.0, total / 1048576.0])


## Самообновление есть только у собранной программы для Windows с номером сборки.
static func is_supported() -> bool:
	return OS.has_feature("template") and OS.get_name() == "Windows" and not BuildInfo.COMMIT.is_empty()


## Куда кладётся новая программа перед заменой.
func staged_path() -> String:
	return "%s-new.%s" % [target_path.get_basename(), target_path.get_extension()]


## Сопрограмма. true — в канале лежит другая сборка (или force — для проверки в конвейере).
func check(force: bool = false) -> bool:
	error = ""
	var url := "%s%s?t=%d" % [base_url, MANIFEST_NAME, int(Time.get_unix_time_from_system())]
	var body: PackedByteArray = await _fetch(url, CHECK_TIMEOUT)
	if body.is_empty():
		return false
	var parsed: Variant = JSON.parse_string(body.get_string_from_utf8())
	if typeof(parsed) != TYPE_DICTIONARY:
		error = "описание сборки не читается"
		return false
	var manifest: Dictionary = parsed
	for key: String in ["version", "commit", "file", "sha256", "exe", "exe_sha256"]:
		if typeof(manifest.get(key)) != TYPE_STRING or str(manifest[key]).is_empty():
			error = "в описании сборки нет поля «%s»" % key
			return false
	_manifest = manifest
	available_version = str(manifest["version"])
	available_commit = str(manifest["commit"])
	return force or available_commit != BuildInfo.COMMIT


## Сопрограмма. Скачивает архив, сверяет контрольные суммы и кладёт новую программу рядом с прежней.
func download_and_stage() -> bool:
	error = ""
	_cancelled = false
	var archive := ProjectSettings.globalize_path(ARCHIVE_PATH)
	if FileAccess.file_exists(archive):
		DirAccess.remove_absolute(archive)

	_download = HTTPRequest.new()
	_download.timeout = DOWNLOAD_TIMEOUT
	_download.use_threads = true
	_download.download_file = archive
	add_child(_download)
	var url := "%s%s?t=%s" % [base_url, str(_manifest["file"]), available_commit]
	if _download.request(url) != OK:
		_download.queue_free()
		_download = null
		error = "не удалось начать скачивание"
		return false
	var result: Array = await _download.request_completed
	_download.queue_free()
	_download = null
	if _cancelled:
		error = "обновление пропущено"
		return false
	if int(result[0]) != HTTPRequest.RESULT_SUCCESS or int(result[1]) != 200:
		error = "скачивание прервалось (код %d, ответ %d)" % [int(result[0]), int(result[1])]
		return false

	progress.emit("Проверяю и распаковываю новую сборку %s…" % available_version)
	await get_tree().process_frame
	await get_tree().process_frame
	if FileAccess.get_sha256(archive) != str(_manifest["sha256"]):
		error = "скачанный архив повреждён"
		return false
	var zip := ZIPReader.new()
	if zip.open(archive) != OK:
		error = "архив не открывается"
		return false
	var exe_name := str(_manifest["exe"])
	if not zip.file_exists(exe_name):
		zip.close()
		error = "в архиве нет программы"
		return false
	var bytes := zip.read_file(exe_name)
	zip.close()

	var staged := staged_path()
	var file := FileAccess.open(staged, FileAccess.WRITE)
	if file == null:
		error = "нет права записи в папку программы (%s)" % staged.get_base_dir()
		return false
	file.store_buffer(bytes)
	file.close()
	if FileAccess.get_sha256(staged) != str(_manifest["exe_sha256"]):
		DirAccess.remove_absolute(staged)
		error = "новая программа записалась с ошибкой"
		return false
	DirAccess.remove_absolute(archive)
	return true


## Прервать скачивание (клавиша Esc).
func cancel() -> void:
	if _download == null:
		return
	_cancelled = true
	_download.cancel_request()
	_download.request_completed.emit(HTTPRequest.RESULT_REQUEST_FAILED, 0, PackedStringArray(), PackedByteArray())


## Запустить новую программу, чтобы она встала на место прежней. После этого прежняя должна закрыться.
func launch_staged() -> bool:
	if OS.create_process(staged_path(), ["--", "--finish-update=" + target_path]) <= 0:
		error = "не удалось запустить новую сборку"
		return false
	return true


## Сопрограмма для второго запуска: копируем себя на место прежней программы, как только она закроется.
func finish_update() -> bool:
	error = ""
	var own_hash := FileAccess.get_sha256(own_path)
	for attempt in REPLACE_ATTEMPTS:
		if DirAccess.copy_absolute(own_path, target_path) == OK and FileAccess.get_sha256(target_path) == own_hash:
			return true
		await get_tree().create_timer(REPLACE_PAUSE).timeout
	error = "файл программы занят или папка закрыта для записи"
	return false


## Запустить программу с её постоянного места после замены.
func relaunch_target() -> bool:
	if OS.create_process(target_path, ["--", "--updated"]) <= 0:
		error = "не удалось запустить обновлённую программу"
		return false
	return true


## Убрать временную программу, оставшуюся от обновления. true — её нет.
func cleanup() -> bool:
	var staged := staged_path()
	if staged == own_path or not FileAccess.file_exists(staged):
		return true
	return DirAccess.remove_absolute(staged) == OK


# ── Память между запусками ───────────────────────────────────────────────────

## Сборка, на которую уже пробовали обновиться: если не вышло, второй раз само не запускается.
static func last_attempt() -> String:
	return str(_state().get_value("update", "attempt", ""))


static func remember_attempt(commit: String) -> void:
	var state := _state()
	state.set_value("update", "attempt", commit)
	state.save(STATE_PATH)


## Сборка, о которой уже показана записка «что нового».
static func seen_build() -> String:
	return str(_state().get_value("build", "seen", ""))


static func mark_seen(commit: String) -> void:
	var state := _state()
	state.set_value("build", "seen", commit)
	state.save(STATE_PATH)


static func _state() -> ConfigFile:
	var state := ConfigFile.new()
	state.load(STATE_PATH)
	return state


func _fetch(url: String, timeout: float) -> PackedByteArray:
	var http := HTTPRequest.new()
	http.timeout = timeout
	add_child(http)
	if http.request(url) != OK:
		http.queue_free()
		error = "не удалось начать запрос"
		return PackedByteArray()
	var result: Array = await http.request_completed
	http.queue_free()
	if int(result[0]) != HTTPRequest.RESULT_SUCCESS or int(result[1]) != 200:
		error = "нет связи с каналом обновлений (код %d, ответ %d)" % [int(result[0]), int(result[1])]
		return PackedByteArray()
	var body: PackedByteArray = result[3]
	if body.is_empty():
		error = "пустой ответ канала обновлений"
	return body
