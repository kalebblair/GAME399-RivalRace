extends Node3D

signal finish_reached
signal trap_triggered(trap_type: StringName)

const FINISH_RADIUS := 1.2
const TRAP_ARM_DELAY_SEC := 1.5
const TRAP_MAX_ACTIVE := 3
const TRAP_MIN_DISTANCE := 2.0
const TRAP_SPIKE_RADIUS := 0.55
const TRAP_SLOW_RADIUS := 0.70
const PLATFORM_LARGE_MODEL_PATH := "res://assets/kenney-platformer/platform-large.glb"
const PLATFORM_MEDIUM_MODEL_PATH := "res://assets/kenney-platformer/platform-medium.glb"
const FLAG_MODEL_PATH := "res://assets/kenney-platformer/flag.glb"
const COIN_MODEL_PATH := "res://assets/kenney-platformer/coin.glb"
const BRICK_MODEL_PATH := "res://assets/kenney-platformer/brick.glb"
const PLATFORM_ALIGN_TOLERANCE := 0.08

const LEVEL := [
	{"id": "ground", "min": Vector3(-4.0, -0.55, -4.0), "max": Vector3(4.0, 0.0, 4.0), "color": Color8(26, 39, 68)},
	{"id": "p01", "min": Vector3(6.4, 0.0, -1.2), "max": Vector3(9.5, 0.38, 1.2), "color": Color8(36, 52, 86)},
	{"id": "p02", "min": Vector3(12.1, 0.34, -2.1), "max": Vector3(15.0, 0.74, 0.3), "color": Color8(42, 63, 94)},
	{"id": "p03", "min": Vector3(17.9, 0.68, -0.5), "max": Vector3(21.0, 1.08, 2.2), "color": Color8(49, 72, 104)},
	{"id": "p04", "min": Vector3(24.0, 1.02, -3.0), "max": Vector3(27.3, 1.44, -0.5), "color": Color8(55, 90, 122)},
	{"id": "p05", "min": Vector3(30.1, 1.36, -1.6), "max": Vector3(32.3, 1.82, 1.2), "color": Color8(61, 92, 138)},
	{"id": "p06", "min": Vector3(35.0, 1.72, -3.8), "max": Vector3(39.0, 2.08, -1.4), "color": Color8(69, 104, 146)},
	{"id": "p07", "min": Vector3(41.8, 2.06, -2.1), "max": Vector3(45.2, 2.42, 0.2), "color": Color8(77, 116, 152)},
	{"id": "p08", "min": Vector3(47.8, 2.34, -4.4), "max": Vector3(50.0, 2.82, -1.7), "color": Color8(84, 123, 161)},
	{"id": "p09", "min": Vector3(52.9, 2.72, -1.1), "max": Vector3(56.8, 3.12, 1.6), "color": Color8(93, 134, 170)},
	{"id": "p10", "min": Vector3(59.7, 3.00, -3.9), "max": Vector3(62.3, 3.42, -1.2), "color": Color8(101, 144, 178)},
	{"id": "p11", "min": Vector3(65.2, 3.32, -0.8), "max": Vector3(69.0, 3.72, 1.8), "color": Color8(108, 152, 186)},
	{"id": "p12", "min": Vector3(71.8, 3.62, -3.0), "max": Vector3(75.0, 4.02, -0.3), "color": Color8(114, 158, 194)},
	{"id": "goal", "min": Vector3(77.7, 3.96, -4.6), "max": Vector3(83.2, 4.38, -0.6), "color": Color8(120, 168, 204)},
]

@onready var finish_area: Area3D = $FinishArea
@onready var trap_root: Node3D = $TrapRoot

var _trap_serial := 0
var _traps: Dictionary = {}
var _platform_large_scene: PackedScene
var _platform_medium_scene: PackedScene
var _flag_scene: PackedScene
var _coin_scene: PackedScene
var _brick_scene: PackedScene

func _ready() -> void:
	_platform_large_scene = load(PLATFORM_LARGE_MODEL_PATH) as PackedScene
	_platform_medium_scene = load(PLATFORM_MEDIUM_MODEL_PATH) as PackedScene
	_flag_scene = load(FLAG_MODEL_PATH) as PackedScene
	_coin_scene = load(COIN_MODEL_PATH) as PackedScene
	_brick_scene = load(BRICK_MODEL_PATH) as PackedScene
	_build_level_geometry()
	_position_finish_area()
	_build_finish_visual()
	finish_area.body_entered.connect(_on_finish_body_entered)

func get_trap_count() -> int:
	return _traps.size()

func clear_traps() -> void:
	for id in _traps.keys():
		var trap: Dictionary = _traps[id]
		var area: Area3D = trap["area"]
		if is_instance_valid(area):
			area.queue_free()
	_traps.clear()

func place_trap(world_pos: Vector3, trap_type: StringName, runner_pos: Vector3) -> bool:
	if _traps.size() >= TRAP_MAX_ACTIVE:
		return false
	var target := Vector3(world_pos.x, runner_pos.y, world_pos.z)
	if target.distance_to(runner_pos) < TRAP_MIN_DISTANCE:
		return false

	var top_y := _top_surface_y_at(world_pos.x, world_pos.z)
	if not is_finite(top_y):
		return false

	var trap_id := _next_trap_id()
	var trap_center := Vector3(world_pos.x, top_y + 0.05, world_pos.z)
	var radius := TRAP_SPIKE_RADIUS if trap_type == &"spike" else TRAP_SLOW_RADIUS

	var area := Area3D.new()
	area.name = trap_id
	area.monitoring = true
	area.monitorable = true
	area.position = trap_center
	trap_root.add_child(area)

	var col := CollisionShape3D.new()
	var sphere := SphereShape3D.new()
	sphere.radius = radius
	col.shape = sphere
	area.add_child(col)

	var trap_visual := _build_trap_visual(trap_type)
	area.add_child(trap_visual)

	var trap_data := {
		"id": trap_id,
		"type": trap_type,
		"radius": radius,
		"armed_at": (Time.get_ticks_msec() / 1000.0) + TRAP_ARM_DELAY_SEC,
		"area": area,
		"triggered": false,
	}
	_traps[trap_id] = trap_data
	area.body_entered.connect(_on_trap_body_entered.bind(trap_id))
	return true

func _build_level_geometry() -> void:
	for child in $Platforms.get_children():
		child.queue_free()

	for box in LEVEL:
		var min_v: Vector3 = box["min"]
		var max_v: Vector3 = box["max"]
		var size := max_v - min_v
		var center := (min_v + max_v) * 0.5

		var body := StaticBody3D.new()
		body.name = "Platform_%s" % box["id"]
		$Platforms.add_child(body)

		var col := CollisionShape3D.new()
		var shape := BoxShape3D.new()
		shape.size = size
		col.shape = shape
		col.position = center
		body.add_child(col)

		var visual := _build_platform_visual(size, center, String(box["id"]))
		body.add_child(visual)

func _build_platform_visual(size: Vector3, center: Vector3, platform_id: String) -> Node3D:
	var use_large := maxf(size.x, size.z) >= 4.4
	var model := _instantiate_model(_platform_large_scene if use_large else _platform_medium_scene)
	if model != null:
		_fit_model_to_platform_box(model, size, center)
		_verify_platform_alignment(platform_id, model, size, center)
		return model
	var fallback := MeshInstance3D.new()
	var mesh := BoxMesh.new()
	mesh.size = size
	fallback.mesh = mesh
	fallback.position = center
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color8(65, 93, 133)
	mat.roughness = 0.95
	fallback.material_override = mat
	return fallback

func _build_finish_visual() -> void:
	for child in finish_area.get_children():
		if child.name == "FinishVisual":
			child.queue_free()
	var visual := _instantiate_model(_flag_scene)
	if visual == null:
		var fallback := MeshInstance3D.new()
		fallback.name = "FinishVisual"
		var mesh := CylinderMesh.new()
		mesh.height = 2.0
		mesh.bottom_radius = 0.08
		mesh.top_radius = 0.08
		fallback.mesh = mesh
		fallback.position = Vector3(0.0, 0.9, 0.0)
		finish_area.add_child(fallback)
		return
	visual.name = "FinishVisual"
	visual.position = Vector3(0.0, 0.05, 0.0)
	visual.scale = Vector3(1.4, 1.4, 1.4)
	finish_area.add_child(visual)

func _position_finish_area() -> void:
	var goal := _goal_box()
	if goal.is_empty():
		return
	var min_v: Vector3 = goal["min"]
	var max_v: Vector3 = goal["max"]
	finish_area.position = Vector3(
		(min_v.x + max_v.x) * 0.5,
		max_v.y + 0.25,
		(min_v.z + max_v.z) * 0.5
	)

func _build_trap_visual(trap_type: StringName) -> Node3D:
	var scene := _brick_scene if trap_type == &"spike" else _coin_scene
	var visual := _instantiate_model(scene)
	if visual != null:
		visual.position = Vector3(0.0, 0.3 if trap_type == &"spike" else 0.45, 0.0)
		visual.scale = Vector3.ONE * (0.7 if trap_type == &"spike" else 0.6)
		return visual
	var fallback := MeshInstance3D.new()
	if trap_type == &"spike":
		var cone := CylinderMesh.new()
		cone.top_radius = 0.0
		cone.bottom_radius = 0.5
		cone.height = 0.8
		fallback.mesh = cone
		fallback.position.y = 0.35
	else:
		var cyl := CylinderMesh.new()
		cyl.top_radius = 0.6
		cyl.bottom_radius = 0.6
		cyl.height = 0.12
		fallback.mesh = cyl
	fallback.material_override = _trap_material(trap_type)
	return fallback

func _instantiate_model(scene: PackedScene) -> Node3D:
	if scene == null:
		return null
	var node := scene.instantiate()
	return node as Node3D

func _fit_model_to_platform_box(model: Node3D, size: Vector3, center: Vector3) -> void:
	var info := _model_local_aabb(model)
	if not bool(info["valid"]):
		model.position = center
		model.scale = Vector3.ONE
		return
	var aabb: AABB = info["aabb"]
	if aabb.size.x <= 0.0001 or aabb.size.y <= 0.0001 or aabb.size.z <= 0.0001:
		model.position = center
		model.scale = Vector3.ONE
		return
	var scale_x := size.x / aabb.size.x
	var scale_y := size.y / aabb.size.y
	var scale_z := size.z / aabb.size.z
	model.scale = Vector3(scale_x, scale_y, scale_z)

	var scaled_min := Vector3(aabb.position.x * scale_x, aabb.position.y * scale_y, aabb.position.z * scale_z)
	var scaled_size := Vector3(aabb.size.x * scale_x, aabb.size.y * scale_y, aabb.size.z * scale_z)
	var box_min := center - (size * 0.5)
	model.position = Vector3(
		center.x - (scaled_min.x + (scaled_size.x * 0.5)),
		box_min.y - scaled_min.y,
		center.z - (scaled_min.z + (scaled_size.z * 0.5))
	)

func _verify_platform_alignment(platform_id: String, model: Node3D, size: Vector3, center: Vector3) -> void:
	var info := _model_local_aabb(model)
	if not bool(info["valid"]):
		push_warning("Platform %s: unable to verify model bounds." % platform_id)
		return
	var aabb: AABB = info["aabb"]
	var scaled_min := Vector3(
		aabb.position.x * model.scale.x,
		aabb.position.y * model.scale.y,
		aabb.position.z * model.scale.z
	)
	var scaled_max := Vector3(
		(aabb.position.x + aabb.size.x) * model.scale.x,
		(aabb.position.y + aabb.size.y) * model.scale.y,
		(aabb.position.z + aabb.size.z) * model.scale.z
	)
	var visual_min := model.position + scaled_min
	var visual_max := model.position + scaled_max
	var box_min := center - (size * 0.5)
	var box_max := center + (size * 0.5)
	var dx := maxf(absf(visual_min.x - box_min.x), absf(visual_max.x - box_max.x))
	var dy := maxf(absf(visual_min.y - box_min.y), absf(visual_max.y - box_max.y))
	var dz := maxf(absf(visual_min.z - box_min.z), absf(visual_max.z - box_max.z))
	if dx > PLATFORM_ALIGN_TOLERANCE or dy > PLATFORM_ALIGN_TOLERANCE or dz > PLATFORM_ALIGN_TOLERANCE:
		push_warning(
			"Platform %s misalignment exceeds tolerance (dx=%.3f, dy=%.3f, dz=%.3f)." %
			[platform_id, dx, dy, dz]
		)

func _model_local_aabb(root: Node3D) -> Dictionary:
	var state := {
		"valid": false,
		"min": Vector3.ZERO,
		"max": Vector3.ZERO,
	}
	for child in root.get_children():
		_accumulate_mesh_bounds(child, Transform3D.IDENTITY, state)
	if not bool(state["valid"]):
		return {"valid": false}
	var min_v: Vector3 = state["min"]
	var max_v: Vector3 = state["max"]
	var aabb := AABB(min_v, max_v - min_v)
	return {"valid": true, "aabb": aabb}

func _accumulate_mesh_bounds(node: Node, parent_xform: Transform3D, state: Dictionary) -> void:
	var local_xform := parent_xform
	if node is Node3D:
		local_xform = parent_xform * (node as Node3D).transform
	if node is MeshInstance3D:
		var mi := node as MeshInstance3D
		if mi.mesh != null:
			var mesh_aabb := mi.mesh.get_aabb()
			for corner in _aabb_corners(mesh_aabb):
				var p := local_xform * corner
				if not bool(state["valid"]):
					state["valid"] = true
					state["min"] = p
					state["max"] = p
				else:
					state["min"] = (state["min"] as Vector3).min(p)
					state["max"] = (state["max"] as Vector3).max(p)
	for child in node.get_children():
		_accumulate_mesh_bounds(child, local_xform, state)

func _aabb_corners(aabb: AABB) -> Array[Vector3]:
	var p := aabb.position
	var s := aabb.size
	return [
		Vector3(p.x, p.y, p.z),
		Vector3(p.x + s.x, p.y, p.z),
		Vector3(p.x, p.y + s.y, p.z),
		Vector3(p.x, p.y, p.z + s.z),
		Vector3(p.x + s.x, p.y + s.y, p.z),
		Vector3(p.x + s.x, p.y, p.z + s.z),
		Vector3(p.x, p.y + s.y, p.z + s.z),
		Vector3(p.x + s.x, p.y + s.y, p.z + s.z),
	]

func _top_surface_y_at(x: float, z: float) -> float:
	var y := -INF
	for box in LEVEL:
		var min_v: Vector3 = box["min"]
		var max_v: Vector3 = box["max"]
		if x >= min_v.x and x <= max_v.x and z >= min_v.z and z <= max_v.z:
			y = maxf(y, max_v.y)
	return y

func _next_trap_id() -> String:
	_trap_serial += 1
	return "trap_%d" % _trap_serial

func _goal_box() -> Dictionary:
	for box in LEVEL:
		if String(box["id"]) == "goal":
			return box
	return {}

func _trap_material(trap_type: StringName) -> StandardMaterial3D:
	var mat := StandardMaterial3D.new()
	if trap_type == &"spike":
		mat.albedo_color = Color(0.98, 0.45, 0.08)
		mat.emission_enabled = true
		mat.emission = Color(0.22, 0.10, 0.04)
	else:
		mat.albedo_color = Color(0.38, 0.65, 0.98)
		mat.emission_enabled = true
		mat.emission = Color(0.03, 0.11, 0.23)
	return mat

func _on_finish_body_entered(body: Node) -> void:
	if body is CharacterBody3D and body.name == "Runner":
		finish_reached.emit()

func _on_trap_body_entered(body: Node, trap_id: String) -> void:
	if not (body is CharacterBody3D and body.name == "Runner"):
		return
	if not _traps.has(trap_id):
		return
	var trap: Dictionary = _traps[trap_id]
	if trap["triggered"]:
		return
	var now := Time.get_ticks_msec() / 1000.0
	if now < float(trap["armed_at"]):
		return
	trap["triggered"] = true
	_traps[trap_id] = trap
	trap_triggered.emit(trap["type"])
	var area: Area3D = trap["area"]
	if is_instance_valid(area):
		area.queue_free()
	_traps.erase(trap_id)
