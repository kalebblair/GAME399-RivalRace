extends CharacterBody3D

signal jumped
signal landed

const SPEED := 6.0
const JUMP_VELOCITY := 7.5
const GRAVITY := 18.0
const HORIZONTAL_LERP := 0.22
const FROZEN_LERP := 0.35
const FACING_MIN_SPEED_SQ := 0.04

var move_basis: Basis = Basis.IDENTITY
var _jump_queued := false
var run_enabled := false
var slow_until_sec := 0.0
var invert_until_sec := 0.0
var freeze_until_sec := 0.0
var watcher_debug_control := false
var _was_grounded := false

func set_move_basis(next_basis: Basis) -> void:
	move_basis = next_basis

func set_watcher_debug_control(enabled: bool) -> void:
	watcher_debug_control = enabled

func set_run_enabled(enabled: bool) -> void:
	run_enabled = enabled
	if not run_enabled:
		velocity.x = 0.0
		velocity.z = 0.0

func hard_reset_to(position_feet: Vector3) -> void:
	global_position = position_feet
	velocity = Vector3.ZERO
	_jump_queued = false
	slow_until_sec = 0.0
	invert_until_sec = 0.0
	freeze_until_sec = 0.0
	_was_grounded = false

func apply_trap_spike_freeze(duration_sec: float) -> void:
	var now := Time.get_ticks_msec() / 1000.0
	freeze_until_sec = maxf(freeze_until_sec, now + duration_sec)

func apply_trap_slow(duration_sec: float) -> void:
	var now := Time.get_ticks_msec() / 1000.0
	slow_until_sec = maxf(slow_until_sec, now + duration_sec)

func apply_ability_slow(duration_sec: float) -> void:
	apply_trap_slow(duration_sec)

func apply_ability_invert(duration_sec: float) -> void:
	var now := Time.get_ticks_msec() / 1000.0
	invert_until_sec = maxf(invert_until_sec, now + duration_sec)

func apply_ability_push(push_x: float, push_z: float) -> void:
	velocity.x += push_x
	velocity.z += push_z

func _physics_process(delta: float) -> void:
	if not run_enabled:
		velocity.y = 0.0
		move_and_slide()
		return

	if Input.is_action_just_pressed("jump"):
		_jump_queued = true

	if not is_on_floor():
		velocity.y -= GRAVITY * delta

	var now := Time.get_ticks_msec() / 1000.0
	var frozen := now < freeze_until_sec
	var slow_factor := 0.55 if now < slow_until_sec else 1.0
	var invert := now < invert_until_sec

	var local_wish := Vector3.ZERO
	if watcher_debug_control:
		# Debug override: watcher mode controls runner with arrow keys.
		var ix := int(Input.is_key_pressed(KEY_RIGHT)) - int(Input.is_key_pressed(KEY_LEFT))
		var iz := int(Input.is_key_pressed(KEY_DOWN)) - int(Input.is_key_pressed(KEY_UP))
		local_wish = Vector3(float(ix), 0.0, float(iz))
	else:
		var input_vec := Input.get_vector("move_left", "move_right", "move_forward", "move_back")
		# In Godot, "up" actions from Input.get_vector are negative Y. Flip for forward=+1 semantic.
		local_wish = Vector3(input_vec.x, 0.0, -input_vec.y)
	if invert:
		local_wish.x *= -1.0
		local_wish.z *= -1.0
	var right := move_basis.x
	var forward := -move_basis.z
	right.y = 0.0
	forward.y = 0.0
	right = right.normalized()
	forward = forward.normalized()
	var wish := (right * local_wish.x) + (forward * local_wish.z)
	if wish.length_squared() > 0.0:
		wish = wish.normalized()

	if frozen:
		velocity.x = lerpf(velocity.x, 0.0, FROZEN_LERP)
		velocity.z = lerpf(velocity.z, 0.0, FROZEN_LERP)
	else:
		velocity.x = lerpf(velocity.x, wish.x * SPEED * slow_factor, HORIZONTAL_LERP)
		velocity.z = lerpf(velocity.z, wish.z * SPEED * slow_factor, HORIZONTAL_LERP)

	if _jump_queued and is_on_floor() and not frozen:
		velocity.y = JUMP_VELOCITY
		jumped.emit()
	_jump_queued = false

	move_and_slide()

	var grounded := is_on_floor()
	if grounded and not _was_grounded:
		landed.emit()
	_was_grounded = grounded

	var horizontal := Vector2(velocity.x, velocity.z)
	if horizontal.length_squared() > FACING_MIN_SPEED_SQ:
		# Match web behavior: face movement velocity on XZ.
		rotation.y = atan2(velocity.x, velocity.z)
