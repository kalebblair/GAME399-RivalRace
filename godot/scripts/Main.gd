extends Node3D

enum Role {
	RUNNER,
	WATCHER,
}

enum RunState {
	IDLE,
	RUNNING,
	FINISHED,
}

const RUNNER_CAM_OFFSET := Vector3(-4.0, 3.0, 4.2)
const RUNNER_CHEST_Y_ABOVE_FEET := 1.05
const RUNNER_CAM_LERP := 0.18
const RUNNER_CAM_MOUSE_SENS := 0.006
const RUNNER_CAM_PITCH_SENS := 0.006
const CAM_COLLISION_MARGIN := 0.2
const CAM_MIN_DISTANCE := 0.75
const WATCH_CENTER := Vector3(40.0, 0.0, -1.6)
const WATCH_CAM_HEIGHT := 26.0
const WATCH_PAN_SPEED := 18.0
const WATCH_DRAG_PAN_SCALE := 0.035
const WATCH_ZOOM_STEP := 1.5
const WATCH_MIN_SIZE := 8.0
const WATCH_MAX_SIZE := 72.0
## Ground platform top is y=0; align feet spawn with surface (avoids initial penetration / sink).
const RUNNER_SPAWN := Vector3(0.0, 0.0, 0.0)
const FAIL_Y := -6.0
const SPIKE_FREEZE_SEC := 2.4
const TRAP_SLOW_SEC := 2.5
const ABILITY_SLOW_COOLDOWN := 7.0
const ABILITY_SLOW_DURATION := 3.5
const ABILITY_INVERT_COOLDOWN := 11.0
const ABILITY_INVERT_DURATION := 2.8
const ABILITY_PUSH_COOLDOWN := 9.0
const ABILITY_PUSH_X := 6.0
const ABILITY_PUSH_Z := -6.0

var current_role: Role = Role.RUNNER
var run_state: RunState = RunState.IDLE
var camera_yaw := 0.0
var camera_pitch := 0.0
var run_start_sec := 0.0
var run_end_sec := 0.0
var selected_trap: StringName = &"spike"
var watch_center := WATCH_CENTER
var watcher_dragging := false
var slow_ready_sec := 0.0
var invert_ready_sec := 0.0
var push_ready_sec := 0.0

@onready var runner_camera: Camera3D = $CameraRig/RunnerCamera
@onready var watcher_camera: Camera3D = $CameraRig/WatcherCamera
@onready var runner: CharacterBody3D = $Runner
@onready var world_root: Node3D = $WorldRoot
@onready var audio_mgr: Node = $Audio
@onready var role_label: Label = $WatcherUI/RootUI/RoleLabel
@onready var run_label: Label = $WatcherUI/RootUI/RunLabel
@onready var trap_label: Label = $WatcherUI/RootUI/TrapLabel
@onready var ability_label: Label = $WatcherUI/RootUI/AbilityLabel

func _ready() -> void:
	_apply_role_camera()
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	if world_root.has_signal("finish_reached"):
		world_root.connect("finish_reached", _on_finish_reached)
	if world_root.has_signal("trap_triggered"):
		world_root.connect("trap_triggered", _on_trap_triggered)
	if runner.has_signal("jumped"):
		runner.connect("jumped", _on_runner_jumped)
	if runner.has_signal("landed"):
		runner.connect("landed", _on_runner_landed)
	_reset_run()
	watcher_camera.size = 30.0
	_update_cameras(1.0)

func _physics_process(_delta: float) -> void:
	# Feed camera-relative movement basis to runner each frame.
	var move_basis := runner_camera.global_transform.basis
	if runner.has_method("set_move_basis"):
		runner.call("set_move_basis", move_basis)

func _process(delta: float) -> void:
	_update_cameras(delta)
	_update_hud()
	if run_state == RunState.RUNNING and runner.global_position.y < FAIL_Y:
		if audio_mgr.has_method("play_fall"):
			audio_mgr.call("play_fall")
		_reset_run()
	if current_role == Role.WATCHER:
		_update_watcher_pan_keyboard(delta)

func _input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		var role_key := event as InputEventKey
		if role_key.keycode == KEY_TAB:
			current_role = Role.WATCHER if current_role == Role.RUNNER else Role.RUNNER
			_apply_role_camera()
			return

	if event is InputEventKey and event.pressed and not event.echo:
		var ek := event as InputEventKey
		if ek.keycode == KEY_ENTER and run_state != RunState.RUNNING:
			_start_run()
			return
		if ek.keycode == KEY_R:
			_reset_run()
			return
		if ek.keycode == KEY_Q:
			selected_trap = &"spike"
			return
		if ek.keycode == KEY_E:
			selected_trap = &"slow"
			return
		if ek.keycode == KEY_1:
			_try_cast_ability_slow()
			return
		if ek.keycode == KEY_2:
			_try_cast_ability_invert()
			return
		if ek.keycode == KEY_3:
			_try_cast_ability_push()
			return
	if current_role == Role.WATCHER and event is InputEventMouseButton:
		var wb := event as InputEventMouseButton
		if wb.button_index == MOUSE_BUTTON_MIDDLE:
			watcher_dragging = wb.pressed
			return
		if wb.pressed and wb.button_index == MOUSE_BUTTON_WHEEL_UP:
			watcher_camera.size = clampf(watcher_camera.size - WATCH_ZOOM_STEP, WATCH_MIN_SIZE, WATCH_MAX_SIZE)
			return
		if wb.pressed and wb.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			watcher_camera.size = clampf(watcher_camera.size + WATCH_ZOOM_STEP, WATCH_MIN_SIZE, WATCH_MAX_SIZE)
			return
	if current_role == Role.WATCHER and event is InputEventMouseMotion and watcher_dragging:
		var wm := event as InputEventMouseMotion
		# Screen drag right should move world left from top-down perspective.
		watch_center.x -= wm.relative.x * WATCH_DRAG_PAN_SCALE
		watch_center.z += wm.relative.y * WATCH_DRAG_PAN_SCALE
		return

	# Optional release/re-capture behavior for editor comfort.
	if event is InputEventKey and event.pressed and event.keycode == KEY_ESCAPE:
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
		return
	if event is InputEventMouseButton:
		var mb := event as InputEventMouseButton
		if current_role == Role.WATCHER and mb.pressed and mb.button_index == MOUSE_BUTTON_LEFT:
			_place_watcher_trap(mb.position)
			return
		if current_role == Role.RUNNER and mb.pressed and Input.mouse_mode != Input.MOUSE_MODE_CAPTURED:
			Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
			return

	if current_role != Role.RUNNER:
		return

	if event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		var mm := event as InputEventMouseMotion
		camera_yaw -= mm.relative.x * RUNNER_CAM_MOUSE_SENS
		camera_pitch -= mm.relative.y * RUNNER_CAM_PITCH_SENS

func _apply_role_camera() -> void:
	runner_camera.current = current_role == Role.RUNNER
	watcher_camera.current = current_role == Role.WATCHER
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED if current_role == Role.RUNNER else Input.MOUSE_MODE_VISIBLE
	if runner.has_method("set_watcher_debug_control"):
		runner.call("set_watcher_debug_control", current_role == Role.WATCHER)
	_update_hud()

func _update_cameras(delta: float) -> void:
	var rp := runner.global_position
	if current_role == Role.RUNNER:
		var look_target := rp + Vector3(0.0, RUNNER_CHEST_Y_ABOVE_FEET, 0.0)
		var desired_offset := RUNNER_CAM_OFFSET.rotated(Vector3.RIGHT, camera_pitch).rotated(Vector3.UP, camera_yaw)
		var desired := rp + desired_offset
		var space_state := get_world_3d().direct_space_state
		var ray := PhysicsRayQueryParameters3D.create(look_target, desired)
		ray.exclude = [runner.get_rid()]
		ray.collide_with_areas = false
		ray.collide_with_bodies = true
		var hit := space_state.intersect_ray(ray)
		if not hit.is_empty():
			var back_dir := (desired - look_target).normalized()
			desired = hit.position - back_dir * CAM_COLLISION_MARGIN
			if desired.distance_to(look_target) < CAM_MIN_DISTANCE:
				desired = look_target + back_dir * CAM_MIN_DISTANCE
		runner_camera.global_position = runner_camera.global_position.lerp(desired, clamp(delta * 60.0 * RUNNER_CAM_LERP, 0.0, 1.0))
		runner_camera.look_at(look_target, Vector3.UP)
	else:
		# 180-degree horizontal flip from previous orientation.
		watcher_camera.global_position = Vector3(watch_center.x, WATCH_CAM_HEIGHT, watch_center.z + 2.0)
		watcher_camera.look_at(watch_center, Vector3.UP)

func _start_run() -> void:
	run_state = RunState.RUNNING
	run_start_sec = Time.get_ticks_msec() / 1000.0
	run_end_sec = 0.0
	if runner.has_method("set_run_enabled"):
		runner.call("set_run_enabled", true)
	_set_run_music()

func _reset_run() -> void:
	run_state = RunState.IDLE
	run_start_sec = 0.0
	run_end_sec = 0.0
	var now := Time.get_ticks_msec() / 1000.0
	slow_ready_sec = now
	invert_ready_sec = now
	push_ready_sec = now
	if runner.has_method("hard_reset_to"):
		runner.call("hard_reset_to", RUNNER_SPAWN)
	if runner.has_method("set_run_enabled"):
		runner.call("set_run_enabled", false)
	if world_root.has_method("clear_traps"):
		world_root.call("clear_traps")
	_set_run_music()

func _on_finish_reached() -> void:
	if run_state != RunState.RUNNING:
		return
	run_state = RunState.FINISHED
	run_end_sec = Time.get_ticks_msec() / 1000.0
	if runner.has_method("set_run_enabled"):
		runner.call("set_run_enabled", false)
	if audio_mgr.has_method("play_coin"):
		audio_mgr.call("play_coin")
	_set_run_music()

func _on_trap_triggered(trap_type: StringName) -> void:
	if trap_type == &"spike":
		if runner.has_method("apply_trap_spike_freeze"):
			runner.call("apply_trap_spike_freeze", SPIKE_FREEZE_SEC)
		if audio_mgr.has_method("play_break"):
			audio_mgr.call("play_break")
	elif trap_type == &"slow":
		if runner.has_method("apply_trap_slow"):
			runner.call("apply_trap_slow", TRAP_SLOW_SEC)
		if audio_mgr.has_method("play_coin"):
			audio_mgr.call("play_coin")

func _update_hud() -> void:
	var role_text := "RUNNER" if current_role == Role.RUNNER else "WATCHER"
	role_label.text = "Role: %s (Tab to swap)" % role_text

	var state_text := "IDLE"
	if run_state == RunState.RUNNING:
		state_text = "RUNNING"
	elif run_state == RunState.FINISHED:
		state_text = "FINISHED"
	var elapsed := 0.0
	if run_state == RunState.RUNNING:
		elapsed = (Time.get_ticks_msec() / 1000.0) - run_start_sec
	elif run_state == RunState.FINISHED:
		elapsed = run_end_sec - run_start_sec
	run_label.text = "Run: %s  Time: %s (Enter=start, R=reset)" % [state_text, _format_time(elapsed)]
	var trap_count := int(world_root.call("get_trap_count")) if world_root.has_method("get_trap_count") else 0
	trap_label.text = "Trap: %s  Active: %d/3 (Q spike, E slow, LMB place)  Runner dbg: arrows in watcher mode" % [String(selected_trap).to_upper(), trap_count]
	var now := Time.get_ticks_msec() / 1000.0
	var slow_left := maxf(0.0, slow_ready_sec - now)
	var invert_left := maxf(0.0, invert_ready_sec - now)
	var push_left := maxf(0.0, push_ready_sec - now)
	ability_label.text = "Abilities: [1] Slow %.1fs  [2] Invert %.1fs  [3] Push %.1fs" % [slow_left, invert_left, push_left]

func _format_time(seconds: float) -> String:
	var s: float = seconds if seconds > 0.0 else 0.0
	var minutes: int = int(s / 60.0)
	var rem: float = s - (float(minutes) * 60.0)
	return "%d:%05.2f" % [minutes, rem]

func _place_watcher_trap(screen_pos: Vector2) -> void:
	if not world_root.has_method("place_trap"):
		return
	var from := watcher_camera.project_ray_origin(screen_pos)
	var to := from + watcher_camera.project_ray_normal(screen_pos) * 500.0
	var ray := PhysicsRayQueryParameters3D.create(from, to)
	ray.collide_with_areas = false
	ray.collide_with_bodies = true
	var hit := get_world_3d().direct_space_state.intersect_ray(ray)
	if hit.is_empty():
		return
	var point: Vector3 = hit["position"]
	var ok := bool(world_root.call("place_trap", point, selected_trap, runner.global_position))
	if ok and audio_mgr.has_method("play_coin"):
		audio_mgr.call("play_coin")

func _update_watcher_pan_keyboard(delta: float) -> void:
	var pan := Input.get_vector("move_left", "move_right", "move_forward", "move_back")
	if pan.length_squared() <= 0.0:
		return
	watch_center.x += pan.x * WATCH_PAN_SPEED * delta
	# keep forward (W) moving toward negative Z like the prototype top-down view
	watch_center.z += pan.y * WATCH_PAN_SPEED * delta

func _can_cast_ability(ready_sec: float) -> bool:
	if current_role != Role.WATCHER:
		return false
	if run_state != RunState.RUNNING:
		return false
	var now := Time.get_ticks_msec() / 1000.0
	return now >= ready_sec

func _try_cast_ability_slow() -> void:
	if not _can_cast_ability(slow_ready_sec):
		return
	var now := Time.get_ticks_msec() / 1000.0
	slow_ready_sec = now + ABILITY_SLOW_COOLDOWN
	if runner.has_method("apply_ability_slow"):
		runner.call("apply_ability_slow", ABILITY_SLOW_DURATION)
	if audio_mgr.has_method("play_break"):
		audio_mgr.call("play_break")

func _try_cast_ability_invert() -> void:
	if not _can_cast_ability(invert_ready_sec):
		return
	var now := Time.get_ticks_msec() / 1000.0
	invert_ready_sec = now + ABILITY_INVERT_COOLDOWN
	if runner.has_method("apply_ability_invert"):
		runner.call("apply_ability_invert", ABILITY_INVERT_DURATION)
	if audio_mgr.has_method("play_break"):
		audio_mgr.call("play_break")

func _try_cast_ability_push() -> void:
	if not _can_cast_ability(push_ready_sec):
		return
	var now := Time.get_ticks_msec() / 1000.0
	push_ready_sec = now + ABILITY_PUSH_COOLDOWN
	if runner.has_method("apply_ability_push"):
		runner.call("apply_ability_push", ABILITY_PUSH_X, ABILITY_PUSH_Z)
	if audio_mgr.has_method("play_break"):
		audio_mgr.call("play_break")

func _set_run_music() -> void:
	if audio_mgr.has_method("set_run_music"):
		audio_mgr.call("set_run_music", run_state == RunState.RUNNING)

func _on_runner_jumped() -> void:
	if audio_mgr.has_method("play_jump"):
		audio_mgr.call("play_jump")

func _on_runner_landed() -> void:
	if audio_mgr.has_method("play_land"):
		audio_mgr.call("play_land")
