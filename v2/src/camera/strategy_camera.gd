class_name StrategyCamera
extends Node3D
## Камера стратегии (шаг 1.1). Смотрит на точку земли — «фокус» — с расстояния, под наклоном, с любой стороны.
## Чем ближе к земле, тем положе взгляд; издалека — почти как на карту. Всё движение сглажено.
## Наклон свободный: от почти отвесного взгляда вниз до горизонта и неба. Когда камера уже опустилась к земле,
## дальнейший наклон поднимает сам взгляд — выше горизонта, но так, чтобы край земли оставался в кадре.
##
## Управление: перетаскивание левой кнопкой — земля едет за курсором; колесо — приближение к месту под курсором;
## правая или средняя кнопка — поворот и наклон; клавиши — см. подсказку F1.

const FOV := 35.0
const MIN_DISTANCE := 110.0
const PITCH_NEAR_DEG := 34.0  ## наклон вблизи: смотрим вдоль земли
const PITCH_FAR_DEG := 62.0  ## наклон издалека: почти сверху
const PITCH_MAX_DEG := 86.0  ## самый крутой взгляд: почти отвесно вниз
const ORBIT_MIN_DEG := 4.0  ## ниже камера к земле не опускается: дальше поднимается сам взгляд
const LOOK_UP_MAX_DEG := 12.0  ## настолько взгляд поднимается выше горизонта: небо видно, край земли остаётся в кадре
const OWN_ANGLE_FROM_DEG := 20.0  ## взгляд положе этого игрок выбрал сам: приближение его не меняет
const ZOOM_STEP := 1.16  ## один щелчок колеса
const FOLLOW_RATE := 11.0  ## скорость догона цели, 1/с
const ZOOM_RATE := 9.0
const TURN_RATE := 12.0
const GROUND_RATE := 6.0
const KEY_PAN_SPEED := 0.85  ## доля расстояния до фокуса в секунду
const KEY_TURN_SPEED := 1.5  ## радиан в секунду
const KEY_TILT_SPEED := 0.7
const KEY_ZOOM_SPEED := 1.5
const FAST_FACTOR := 2.2  ## с Shift
const DRAG_TURN := 0.0045  ## радиан на точку экрана
const DRAG_TILT := 0.003
const INERTIA_FRICTION := 5.0
const EDGE_SCROLL_MARGIN := 6.0
const CLEARANCE := 14.0  ## камера не опускается к земле ближе этого
const RAY_TOP := 340.0  ## выше этого рельефа нет
const NO_POINT := Vector3.INF

var camera: Camera3D
var input_enabled := true

var _height_map: HeightMap
var _bounds := Rect2(-1000.0, -1000.0, 2000.0, 2000.0)
var _max_distance := 6000.0

# Цель, к которой камера плавно приходит.
var _t_focus := Vector2.ZERO
var _t_distance := 1500.0
var _t_yaw := 0.0
var _t_tilt := 0.0
# Текущее положение.
var _focus := Vector2.ZERO
var _distance := 1500.0
var _yaw := 0.0
var _tilt := 0.0
var _ground := 0.0

var _dragging := false
var _drag_anchor := Vector3.ZERO
var _drag_prev_focus := Vector2.ZERO
var _drag_last_usec := 0
var _rotating := false
var _pan_velocity := Vector2.ZERO

var _zoom_anchor_active := false
var _zoom_anchor_screen := Vector2.ZERO
var _zoom_anchor_world := Vector3.ZERO

var _flight := false
var _flight_from: CameraView
var _flight_to: CameraView
var _flight_time := 1.0
var _flight_progress := 0.0
var _flight_hop := 0.0


func _ready() -> void:
	camera = Camera3D.new()
	camera.fov = FOV
	camera.far = 120000.0
	add_child(camera)
	camera.make_current()
	_apply()


# ── Настройка ────────────────────────────────────────────────────────────────

func set_height_map(height_map: HeightMap) -> void:
	_height_map = height_map


## Границы мира: дальше них фокус не уходит, а самое дальнее отдаление показывает весь мир с запасом.
func set_world_bounds(land: Rect2) -> void:
	_bounds = land.grow(260.0)
	_max_distance = 20000.0
	_max_distance = view_for_rect(land).distance * 1.35


## Расстояние от камеры до точки, на которую она смотрит.
func current_distance() -> float:
	return _distance


## Угол взгляда вниз от горизонта, радианы: больше нуля — смотрим на землю, меньше — выше горизонта.
func view_angle() -> float:
	return _view_angle(_distance, _tilt)


func get_view() -> CameraView:
	var view := CameraView.new()
	view.focus = _focus
	view.distance = _distance
	view.yaw = _yaw
	view.tilt = _tilt
	return view


## Мгновенно поставить камеру (для кадров и замеров).
func set_view(view: CameraView) -> void:
	_stop_motion()
	_t_focus = _clamp_focus(view.focus)
	_t_distance = clampf(view.distance, MIN_DISTANCE, _max_distance)
	_t_yaw = view.yaw
	_t_tilt = _fit_tilt(view.tilt, _t_distance)
	_focus = _t_focus
	_distance = _t_distance
	_yaw = _t_yaw
	_tilt = _t_tilt
	_ground = _ground_target()
	_apply()


## Плавный перелёт. На долгом пути камера приподнимается, чтобы было видно, куда летим.
func fly_to(view: CameraView, seconds: float = -1.0) -> void:
	_stop_motion()
	_flight_from = get_view()
	_flight_to = view.copy()
	_flight_to.focus = _clamp_focus(view.focus)
	_flight_to.distance = clampf(view.distance, MIN_DISTANCE, _max_distance)
	_flight_to.tilt = _fit_tilt(view.tilt, _flight_to.distance)
	var travel := _flight_from.focus.distance_to(_flight_to.focus)
	var span := maxf(_flight_from.distance, _flight_to.distance)
	var zoom_change := absf(log(_flight_to.distance / _flight_from.distance))
	_flight_time = seconds if seconds > 0.0 else clampf(0.65 + 0.4 * log(1.0 + travel / span) + 0.3 * zoom_change, 0.65, 2.4)
	_flight_hop = clampf(travel / (span * 1.5) - 0.4, 0.0, 1.0) * 0.45
	_flight_progress = 0.0
	_flight = true


## Положение камеры, при котором область видна целиком (смотрим с юга).
func view_for_rect(area: Rect2) -> CameraView:
	var view := CameraView.new()
	view.focus = area.get_center()
	var tan_vertical := tan(deg_to_rad(FOV) * 0.5)
	var tan_horizontal := tan_vertical * _aspect()
	var half_depth := area.size.y * 0.5
	var half_width := area.size.x * 0.5
	var fit := 1000.0
	for i in 4:
		var pitch := _auto_pitch(fit)
		var by_depth := half_depth * (sin(pitch) / tan_vertical + cos(pitch))
		var by_width := half_width / tan_horizontal + half_depth * cos(pitch)
		fit = maxf(by_depth, by_width) * 1.08
	view.distance = clampf(fit, MIN_DISTANCE, _max_distance)
	return view


## Точка земли под точкой экрана. NO_POINT, если луч уходит в небо.
func ground_point(screen: Vector2) -> Vector3:
	var origin := camera.project_ray_origin(screen)
	var direction := camera.project_ray_normal(screen)
	if direction.y > -0.02:
		return NO_POINT
	if _height_map == null:
		return _plane_hit(origin, direction, 0.0)
	# Идём по лучу от верхней границы рельефа; шаг тем короче, чем ближе земля.
	var travelled := maxf((origin.y - RAY_TOP) / -direction.y, 0.0)
	var previous := travelled
	var horizontal := maxf(Vector2(direction.x, direction.z).length(), 0.001)
	for i in 96:
		var above := _height_above(origin + direction * travelled)
		if above < 0.2:
			if above < -0.5:
				# Проскочили под землю (крутой склон): уточняем делением отрезка пополам.
				var outside := previous
				var inside := travelled
				for j in 10:
					var middle := (outside + inside) * 0.5
					if _height_above(origin + direction * middle) > 0.0:
						outside = middle
					else:
						inside = middle
				travelled = outside
			return origin + direction * travelled
		previous = travelled
		travelled += minf(above * 0.5 / -direction.y, 28.0 / horizontal)
	return _plane_hit(origin, direction, 0.0)


## Точка под точкой экрана на горизонтальной плоскости заданной высоты.
func plane_point(screen: Vector2, level: float) -> Vector3:
	return _plane_hit(camera.project_ray_origin(screen), camera.project_ray_normal(screen), level)


# ── Кадр ─────────────────────────────────────────────────────────────────────

func _process(delta: float) -> void:
	var dt := minf(delta, 0.1)
	if input_enabled:
		_read_keys(dt)
	if _flight:
		_step_flight(dt)
	else:
		_step_follow(dt)
	_ground = lerpf(_ground, _ground_target(), 1.0 - exp(-GROUND_RATE * dt))
	_apply()
	if _zoom_anchor_active:
		_hold_zoom_anchor()


func _step_follow(dt: float) -> void:
	if _dragging:
		var velocity := (_focus - _drag_prev_focus) / maxf(dt, 0.001)
		_pan_velocity = _pan_velocity.lerp(velocity, 0.5)
		_drag_prev_focus = _focus
	elif _pan_velocity.length_squared() > 1.0:
		# Инерция после броска карты.
		var step := _pan_velocity * dt
		_t_focus = _clamp_focus(_t_focus + step)
		_focus = _clamp_focus(_focus + step)
		_pan_velocity *= exp(-INERTIA_FRICTION * dt)
	else:
		_pan_velocity = Vector2.ZERO
	_focus = _focus.lerp(_t_focus, 1.0 - exp(-FOLLOW_RATE * dt))
	_distance = exp(lerpf(log(_distance), log(_t_distance), 1.0 - exp(-ZOOM_RATE * dt)))
	var turn := 1.0 - exp(-TURN_RATE * dt)
	_yaw = lerp_angle(_yaw, _t_yaw, turn)
	_tilt = lerpf(_tilt, _t_tilt, turn)


func _step_flight(dt: float) -> void:
	_flight_progress = minf(_flight_progress + dt / _flight_time, 1.0)
	var t := _flight_progress
	var eased := t * t * t * (t * (t * 6.0 - 15.0) + 10.0)
	var view := CameraView.blend(_flight_from, _flight_to, eased)
	_focus = view.focus
	_distance = minf(view.distance * exp(_flight_hop * sin(PI * eased)), _max_distance)
	_yaw = view.yaw
	_tilt = view.tilt
	_t_focus = _focus
	_t_distance = _distance
	_t_yaw = _yaw
	_t_tilt = _tilt
	if _flight_progress >= 1.0:
		_flight = false
		_t_distance = _flight_to.distance
		_distance = _flight_to.distance


func _apply() -> void:
	if camera == null:
		return
	var orbit_min := deg_to_rad(ORBIT_MIN_DEG)
	var angle := _view_angle(_distance, _tilt)
	var pitch := maxf(angle, orbit_min)
	var target := Vector3(_focus.x, _ground, _focus.y)
	var eye := target + Vector3(sin(_yaw) * cos(pitch), sin(pitch), cos(_yaw) * cos(pitch)) * _distance
	var above := eye.y
	if _height_map != null:
		# Не даём камере уйти в склон: поднимаем её над землёй под собой.
		var floor_level := maxf(_height_map.sample(Vector2(eye.x, eye.z)), 0.0)
		eye.y = maxf(eye.y, floor_level + CLEARANCE)
		above = eye.y - floor_level
	var orientation := Basis.looking_at(target - eye, Vector3.UP)
	if angle < orbit_min:
		# Камера уже у земли: дальше поднимается только взгляд — к горизонту и небу.
		var look_up_max := deg_to_rad(LOOK_UP_MAX_DEG)
		var actual := asin(clampf((eye.y - target.y) / maxf(eye.distance_to(target), 0.001), -1.0, 1.0))
		var raise := (orbit_min - angle) / (orbit_min + look_up_max)
		orientation = orientation * Basis(Vector3.RIGHT, raise * (look_up_max + actual))
	camera.global_transform = Transform3D(orientation, eye)
	# Чем ниже камера над землёй, тем ближе передняя граница видимости: земля у нижнего края кадра не обрезается.
	camera.near = clampf(minf(_distance * 0.03, above * 0.4), 0.5, 50.0)


# ── Ввод ─────────────────────────────────────────────────────────────────────

func _unhandled_input(event: InputEvent) -> void:
	if not input_enabled:
		return
	if event is InputEventMouseButton:
		_on_mouse_button(event as InputEventMouseButton)
	elif event is InputEventMouseMotion:
		_on_mouse_motion(event as InputEventMouseMotion)
	elif event is InputEventMagnifyGesture:
		var magnify := event as InputEventMagnifyGesture
		_zoom(1.0 / maxf(magnify.factor, 0.01), magnify.position)
	elif event is InputEventPanGesture:
		var pan := event as InputEventPanGesture
		_zoom(pow(ZOOM_STEP, pan.delta.y * 0.5), pan.position)


func _notification(what: int) -> void:
	if what == NOTIFICATION_APPLICATION_FOCUS_OUT:
		# Кнопку могли отпустить за окном: не оставляем карту «прилипшей» к курсору.
		_dragging = false
		_rotating = false


func _on_mouse_button(event: InputEventMouseButton) -> void:
	match event.button_index:
		MOUSE_BUTTON_LEFT:
			if event.pressed and event.double_click:
				_fly_to_screen_point(event.position)
			elif event.pressed:
				_begin_drag(event.position)
			else:
				_end_drag()
		MOUSE_BUTTON_RIGHT, MOUSE_BUTTON_MIDDLE:
			_rotating = event.pressed
			if event.pressed:
				_stop_motion()
		MOUSE_BUTTON_WHEEL_UP:
			if event.pressed:
				_zoom(pow(ZOOM_STEP, -_wheel_amount(event)), event.position)
		MOUSE_BUTTON_WHEEL_DOWN:
			if event.pressed:
				_zoom(pow(ZOOM_STEP, _wheel_amount(event)), event.position)


func _on_mouse_motion(event: InputEventMouseMotion) -> void:
	if _dragging:
		var now := plane_point(event.position, _drag_anchor.y)
		if now == NO_POINT:
			return
		# Точка земли, за которую взялись, остаётся под курсором. У горизонта малое движение мыши
		# соответствует большому пути по земле, поэтому один шаг ограничен.
		var shift := Vector2(_drag_anchor.x - now.x, _drag_anchor.z - now.z).limit_length(_distance * 0.6)
		_focus = _clamp_focus(_focus + shift)
		_t_focus = _focus
		_drag_last_usec = Time.get_ticks_usec()
		_apply()
	elif _rotating:
		_t_yaw -= event.relative.x * DRAG_TURN
		_t_tilt = _fit_tilt(_t_tilt + event.relative.y * DRAG_TILT, _t_distance)


func _begin_drag(screen: Vector2) -> void:
	var point := ground_point(screen)
	if point == NO_POINT:
		return
	_stop_motion()
	_dragging = true
	_drag_anchor = point
	_drag_prev_focus = _focus
	_drag_last_usec = Time.get_ticks_usec()
	_t_focus = _focus


func _end_drag() -> void:
	if not _dragging:
		return
	_dragging = false
	# Если рука остановилась перед отпусканием, броска нет.
	if Time.get_ticks_usec() - _drag_last_usec > 90000:
		_pan_velocity = Vector2.ZERO
	_pan_velocity = _pan_velocity.limit_length(_distance * 4.0)


func _fly_to_screen_point(screen: Vector2) -> void:
	var point := ground_point(screen)
	if point == NO_POINT:
		return
	var view := get_view()
	view.focus = Vector2(point.x, point.z)
	view.distance = maxf(_t_distance * 0.55, MIN_DISTANCE)
	view.tilt = _carry_tilt(view.tilt, _distance, view.distance)
	fly_to(view)


func _zoom(factor: float, screen: Vector2) -> void:
	var target := clampf(_t_distance * factor, MIN_DISTANCE, _max_distance)
	if is_equal_approx(target, _t_distance):
		return
	_flight = false
	_pan_velocity = Vector2.ZERO
	_set_target_distance(target)
	# Приближаемся к месту под курсором: оно остаётся на месте, пока идёт приближение.
	var keep := _zoom_anchor_active and screen.distance_to(_zoom_anchor_screen) < 4.0
	if not keep:
		var point := ground_point(screen)
		_zoom_anchor_active = point != NO_POINT
		_zoom_anchor_screen = screen
		_zoom_anchor_world = point


func _hold_zoom_anchor() -> void:
	var now := plane_point(_zoom_anchor_screen, _zoom_anchor_world.y)
	if now == NO_POINT:
		_zoom_anchor_active = false
		return
	_focus = _clamp_focus(_focus + Vector2(_zoom_anchor_world.x - now.x, _zoom_anchor_world.z - now.z))
	_t_focus = _focus
	_apply()
	if absf(log(_distance / _t_distance)) < 0.002:
		_zoom_anchor_active = false


func _read_keys(dt: float) -> void:
	var fast := FAST_FACTOR if Input.is_physical_key_pressed(KEY_SHIFT) else 1.0
	var move := Vector2.ZERO
	if _key(KEY_W) or _key(KEY_UP):
		move.y += 1.0
	if _key(KEY_S) or _key(KEY_DOWN):
		move.y -= 1.0
	if _key(KEY_D) or _key(KEY_RIGHT):
		move.x += 1.0
	if _key(KEY_A) or _key(KEY_LEFT):
		move.x -= 1.0
	move += _edge_scroll()
	if move != Vector2.ZERO:
		_stop_motion()
		move = move.limit_length(1.0)
		var forward := Vector2(-sin(_yaw), -cos(_yaw))
		var right := Vector2(cos(_yaw), -sin(_yaw))
		_t_focus = _clamp_focus(_t_focus + (right * move.x + forward * move.y) * _t_distance * KEY_PAN_SPEED * fast * dt)

	var turn := 0.0
	if _key(KEY_Q):
		turn += 1.0
	if _key(KEY_E):
		turn -= 1.0
	if turn != 0.0:
		_cancel_flight()
		_t_yaw += turn * KEY_TURN_SPEED * dt

	var tilt := 0.0
	if _key(KEY_R):
		tilt -= 1.0
	if _key(KEY_F):
		tilt += 1.0
	if tilt != 0.0:
		_cancel_flight()
		_t_tilt = _fit_tilt(_t_tilt + tilt * KEY_TILT_SPEED * dt, _t_distance)

	var zoom := 0.0
	if _key(KEY_EQUAL) or _key(KEY_KP_ADD) or _key(KEY_PAGEUP):
		zoom -= 1.0
	if _key(KEY_MINUS) or _key(KEY_KP_SUBTRACT) or _key(KEY_PAGEDOWN):
		zoom += 1.0
	if zoom != 0.0:
		_cancel_flight()
		_zoom_anchor_active = false
		_set_target_distance(clampf(_t_distance * exp(zoom * KEY_ZOOM_SPEED * fast * dt), MIN_DISTANCE, _max_distance))


## Движение карты от курсора у края экрана — только в полноэкранном режиме.
func _edge_scroll() -> Vector2:
	var mode := DisplayServer.window_get_mode()
	if mode != DisplayServer.WINDOW_MODE_FULLSCREEN and mode != DisplayServer.WINDOW_MODE_EXCLUSIVE_FULLSCREEN:
		return Vector2.ZERO
	if not DisplayServer.window_is_focused() or _dragging or _rotating:
		return Vector2.ZERO
	var size := get_viewport().get_visible_rect().size
	var mouse := get_viewport().get_mouse_position()
	if mouse.x < 0.0 or mouse.y < 0.0 or mouse.x > size.x or mouse.y > size.y:
		return Vector2.ZERO
	var move := Vector2.ZERO
	if mouse.x <= EDGE_SCROLL_MARGIN:
		move.x -= 1.0
	elif mouse.x >= size.x - EDGE_SCROLL_MARGIN:
		move.x += 1.0
	if mouse.y <= EDGE_SCROLL_MARGIN:
		move.y += 1.0
	elif mouse.y >= size.y - EDGE_SCROLL_MARGIN:
		move.y -= 1.0
	return move


# ── Внутреннее ───────────────────────────────────────────────────────────────

func _key(code: Key) -> bool:
	return Input.is_physical_key_pressed(code)


func _wheel_amount(event: InputEventMouseButton) -> float:
	return event.factor if event.factor > 0.0 else 1.0


func _stop_motion() -> void:
	_flight = false
	_zoom_anchor_active = false
	_pan_velocity = Vector2.ZERO


func _cancel_flight() -> void:
	_flight = false


func _clamp_focus(point: Vector2) -> Vector2:
	return Vector2(clampf(point.x, _bounds.position.x, _bounds.end.x), clampf(point.y, _bounds.position.y, _bounds.end.y))


func _aspect() -> float:
	if not is_inside_tree():
		return 16.0 / 9.0
	var size := get_viewport().get_visible_rect().size
	return size.x / maxf(size.y, 1.0)


## Наклон, который камера выбирает сама: вблизи положе, издалека круче.
func _auto_pitch(distance: float) -> float:
	var t := clampf(inverse_lerp(log(MIN_DISTANCE), log(_max_distance), log(distance)), 0.0, 1.0)
	return lerpf(deg_to_rad(PITCH_NEAR_DEG), deg_to_rad(PITCH_FAR_DEG), smoothstep(0.0, 1.0, t))


## Угол взгляда вниз от горизонта: собственный наклон камеры плюс добавка игрока, в допустимых пределах.
func _view_angle(distance: float, tilt: float) -> float:
	return clampf(_auto_pitch(distance) + tilt, -deg_to_rad(LOOK_UP_MAX_DEG), deg_to_rad(PITCH_MAX_DEG))


## Добавка игрока, обрезанная по пределам взгляда на данном расстоянии.
func _fit_tilt(tilt: float, distance: float) -> float:
	return _view_angle(distance, tilt) - _auto_pitch(distance)


## Добавка игрока при смене расстояния. Пока взгляд близок к собственному наклону камеры, он меняется
## с расстоянием, как и раньше. Если же игрок сам опустил взгляд к горизонту, угол при приближении сохраняется.
func _carry_tilt(tilt: float, from_distance: float, to_distance: float) -> float:
	var before := _auto_pitch(from_distance)
	var after := _auto_pitch(to_distance)
	var own := 1.0 - smoothstep(deg_to_rad(OWN_ANGLE_FROM_DEG), deg_to_rad(PITCH_NEAR_DEG), before + tilt)
	return _fit_tilt(tilt + (before - after) * own, to_distance)


func _set_target_distance(value: float) -> void:
	_t_tilt = _carry_tilt(_t_tilt, _t_distance, value)
	_t_distance = value


## Высота, на которую смотрит камера: вблизи — высота земли под фокусом, издалека — уровень моря.
func _ground_target() -> float:
	if _height_map == null:
		return 0.0
	var near := 1.0 - smoothstep(900.0, 2600.0, _distance)
	return maxf(_height_map.sample(_focus), 0.0) * near


## Высота точки над землёй (над водой — над уровнем моря).
func _height_above(point: Vector3) -> float:
	return point.y - maxf(_height_map.sample(Vector2(point.x, point.z)), 0.0)


func _plane_hit(origin: Vector3, direction: Vector3, level: float) -> Vector3:
	if direction.y > -0.02:
		return NO_POINT
	var travelled := (level - origin.y) / direction.y
	if travelled < 0.0 or travelled > 60000.0:
		return NO_POINT
	return origin + direction * travelled
