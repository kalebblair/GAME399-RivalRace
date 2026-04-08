extends Node3D

signal finish_reached
signal trap_triggered(trap_type: StringName)

const FINISH_RADIUS := 1.2
const TRAP_ARM_DELAY_SEC := 1.5
const TRAP_MAX_ACTIVE := 3
const TRAP_MIN_DISTANCE := 2.0
const TRAP_SPIKE_RADIUS := 0.55
const TRAP_SLOW_RADIUS := 0.70
const TEX_GRASS_PATH := "res://assets/textures/environment/grass00.png"
const TEX_STONE_PATH := "res://assets/textures/environment/stone.png"

const LEVEL := [
	{"id": "ground", "min": Vector3(-4.0, -0.55, -4.0), "max": Vector3(4.0, 0.0, 4.0), "color": Color8(26, 39, 68)},
	{"id": "p01", "min": Vector3(6.5, 0.0, -1.35), "max": Vector3(9.7, 0.4, 1.35), "color": Color8(36, 52, 86)},
	{"id": "p02", "min": Vector3(12.2, 0.38, -1.75), "max": Vector3(15.4, 0.78, 0.95), "color": Color8(42, 63, 94)},
	{"id": "p03", "min": Vector3(17.9, 0.76, -2.15), "max": Vector3(21.1, 1.16, 0.55), "color": Color8(49, 72, 104)},
	{"id": "p04", "min": Vector3(23.6, 1.14, -2.55), "max": Vector3(26.8, 1.54, 0.15), "color": Color8(55, 90, 122)},
	{"id": "p05", "min": Vector3(29.3, 1.52, -2.95), "max": Vector3(32.5, 1.92, -0.25), "color": Color8(61, 92, 138)},
	{"id": "p06", "min": Vector3(35.0, 1.9, -3.35), "max": Vector3(38.2, 2.3, -0.65), "color": Color8(69, 104, 146)},
	{"id": "p07", "min": Vector3(40.7, 2.28, -3.75), "max": Vector3(43.9, 2.68, -1.05), "color": Color8(77, 116, 152)},
	{"id": "goal", "min": Vector3(46.4, 2.66, -5.5), "max": Vector3(51.2, 3.06, -2.0), "color": Color8(90, 127, 184)},
]

@onready var finish_area: Area3D = $FinishArea
@onready var trap_root: Node3D = $TrapRoot

var _trap_serial := 0
var _traps: Dictionary = {}
var _grass_tex: Texture2D
var _stone_tex: Texture2D

func _ready() -> void:
	_grass_tex = load(TEX_GRASS_PATH) as Texture2D
	_stone_tex = load(TEX_STONE_PATH) as Texture2D
	_build_level_geometry()
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

	var mesh_node := MeshInstance3D.new()
	if trap_type == &"spike":
		var cone := CylinderMesh.new()
		cone.top_radius = 0.0
		cone.bottom_radius = 0.5
		cone.height = 0.8
		mesh_node.mesh = cone
		mesh_node.position.y = 0.35
	else:
		var cyl := CylinderMesh.new()
		cyl.top_radius = 0.6
		cyl.bottom_radius = 0.6
		cyl.height = 0.12
		mesh_node.mesh = cyl
	mesh_node.material_override = _trap_material(trap_type)
	area.add_child(mesh_node)

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

		var mesh_node := MeshInstance3D.new()
		var mesh := BoxMesh.new()
		mesh.size = size
		mesh_node.mesh = mesh
		mesh_node.position = center
		mesh_node.material_override = _platform_material(String(box["id"]), box["color"])
		body.add_child(mesh_node)

func _platform_material(platform_id: String, fallback_color: Color) -> StandardMaterial3D:
	var mat := StandardMaterial3D.new()
	mat.roughness = 0.95
	mat.uv1_scale = Vector3(2.0, 2.0, 1.0)
	var tex := _grass_tex if platform_id == "ground" else _stone_tex
	if tex != null:
		mat.albedo_texture = tex
		mat.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
	else:
		mat.albedo_color = fallback_color
	return mat

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
