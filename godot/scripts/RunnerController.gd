extends CharacterBody3D

signal jumped
signal landed

const SPEED := 6.0
const JUMP_VELOCITY := 7.5
const GRAVITY := 18.0
const HORIZONTAL_LERP := 0.22
const FROZEN_LERP := 0.35
const FACING_MIN_SPEED_SQ := 0.04
## Slight inset so the capsule stays inside the mesh silhouette (physics stability).
const COLLIDER_RADIUS_INSET := 0.96
const COLLIDER_MIN_RADIUS := 0.18
## Small lift so shoe geometry clears platform tops after physics separation (avoids “sinking” look).
const VISUAL_FEET_CLEARANCE := 0.25

@onready var visual_root: Node3D = $VisualRoot
@onready var body_collision: CollisionShape3D = $BodyCollision

var move_basis: Basis = Basis.IDENTITY
var _jump_queued := false
var run_enabled := false
var slow_until_sec := 0.0
var invert_until_sec := 0.0
var freeze_until_sec := 0.0
var watcher_debug_control := false
var _was_grounded := false

func _ready() -> void:
	# Snap to floor when landing; reduces sinking into floor geometry.
	floor_snap_length = 0.22
	# GLB instance transforms are stable after a frame or two.
	await get_tree().process_frame
	await get_tree().process_frame
	_align_visual_and_collision_to_model()

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
		var ix := int(Input.is_key_pressed(KEY_RIGHT)) - int(Input.is_key_pressed(KEY_LEFT))
		var iz := int(Input.is_key_pressed(KEY_DOWN)) - int(Input.is_key_pressed(KEY_UP))
		local_wish = Vector3(float(ix), 0.0, float(iz))
	else:
		var input_vec := Input.get_vector("move_left", "move_right", "move_forward", "move_back")
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
		rotation.y = atan2(velocity.x, velocity.z)

func _align_visual_and_collision_to_model() -> void:
	if visual_root == null or body_collision == null:
		return
	var aabb := _compute_mesh_bounds_in_body_space(visual_root)
	if aabb.size.length_squared() < 1e-10:
		push_warning("RunnerController: could not compute character mesh bounds; collision unchanged.")
		return

	# Feet at body origin (y=0), silhouette centered on XZ.
	var cx := aabb.position.x + aabb.size.x * 0.5
	var cz := aabb.position.z + aabb.size.z * 0.5
	visual_root.position = Vector3(-cx, -aabb.position.y + VISUAL_FEET_CLEARANCE, -cz)

	var capsule := body_collision.shape as CapsuleShape3D
	if capsule == null:
		return

	var footprint := minf(aabb.size.x, aabb.size.z)
	var radius := maxf(footprint * 0.5 * COLLIDER_RADIUS_INSET, COLLIDER_MIN_RADIUS)
	# Capsule total height along Y ~= cylinder mid height + 2*radius; match model height.
	var mid_h := maxf(aabb.size.y - 2.0 * radius, 0.01)
	capsule.radius = radius
	capsule.height = mid_h
	# Capsule bottom at y=0: center_y = mid_h/2 + radius
	body_collision.position = Vector3(0.0, mid_h * 0.5 + radius, 0.0)

func _compute_mesh_bounds_in_body_space(root: Node3D) -> AABB:
	var inv := global_transform.affine_inverse()
	var mn := Vector3(INF, INF, INF)
	var mx := Vector3(-INF, -INF, -INF)
	var any := false
	for mi in _collect_mesh_instances(root):
		if mi.mesh == null:
			continue
		var to_body := inv * mi.global_transform
		# Instance AABB matches skinned / imported layout better than raw mesh resource bounds.
		var maabb := mi.get_aabb()
		for i in range(8):
			var c := _aabb_corner(maabb, i)
			var p := to_body * c
			mn = mn.min(p)
			mx = mx.max(p)
			any = true
	if not any:
		return AABB()
	return AABB(mn, mx - mn)

func _collect_mesh_instances(node: Node) -> Array[MeshInstance3D]:
	var out: Array[MeshInstance3D] = []
	if node is MeshInstance3D:
		out.append(node as MeshInstance3D)
	for c in node.get_children():
		out.append_array(_collect_mesh_instances(c))
	return out

func _aabb_corner(aabb: AABB, index: int) -> Vector3:
	var p := aabb.position
	var s := aabb.size
	match index:
		0:
			return Vector3(p.x, p.y, p.z)
		1:
			return Vector3(p.x + s.x, p.y, p.z)
		2:
			return Vector3(p.x, p.y + s.y, p.z)
		3:
			return Vector3(p.x, p.y, p.z + s.z)
		4:
			return Vector3(p.x + s.x, p.y + s.y, p.z)
		5:
			return Vector3(p.x + s.x, p.y, p.z + s.z)
		6:
			return Vector3(p.x, p.y + s.y, p.z + s.z)
		_:
			return Vector3(p.x + s.x, p.y + s.y, p.z + s.z)
