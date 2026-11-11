class_name CameraView
extends RefCounted
## Положение камеры: куда смотрит, с какого расстояния, с какой стороны и под каким наклоном.

var focus := Vector2.ZERO  ## точка земли (x, z), на которую смотрит камера
var distance := 1500.0  ## метров от камеры до этой точки
var yaw := 0.0  ## с какой стороны смотрим, радианы: 0 — с юга на север
var tilt := 0.0  ## добавка к наклону, радианы: меньше нуля — ближе к горизонту


static func make(focus_point: Vector2, view_distance: float, yaw_degrees: float = 0.0, tilt_degrees: float = 0.0) -> CameraView:
	var view := CameraView.new()
	view.focus = focus_point
	view.distance = view_distance
	view.yaw = deg_to_rad(yaw_degrees)
	view.tilt = deg_to_rad(tilt_degrees)
	return view


func copy() -> CameraView:
	var view := CameraView.new()
	view.focus = focus
	view.distance = distance
	view.yaw = yaw
	view.tilt = tilt
	return view


## Промежуточное положение между двумя: расстояние меняется в масштабе (в логарифме), поворот — по короткой дуге.
static func blend(from: CameraView, to: CameraView, weight: float) -> CameraView:
	var view := CameraView.new()
	view.focus = from.focus.lerp(to.focus, weight)
	view.distance = exp(lerpf(log(from.distance), log(to.distance), weight))
	view.yaw = lerp_angle(from.yaw, to.yaw, weight)
	view.tilt = lerpf(from.tilt, to.tilt, weight)
	return view


## Короткая запись места: её можно прислать разработчику, и он увидит тот же кадр.
func to_code() -> String:
	return "%d,%d,%d,%d,%d" % [roundi(focus.x), roundi(focus.y), roundi(distance), roundi(rad_to_deg(yaw)), roundi(rad_to_deg(tilt))]


static func from_code(code: String) -> CameraView:
	var parts := code.strip_edges().split(",")
	if parts.size() != 5:
		return null
	for part in parts:
		if not part.strip_edges().is_valid_int():
			return null
	return make(Vector2(float(parts[0].to_int()), float(parts[1].to_int())), float(parts[2].to_int()), float(parts[3].to_int()), float(parts[4].to_int()))
