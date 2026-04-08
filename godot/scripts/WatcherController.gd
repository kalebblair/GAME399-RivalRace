extends Node

signal trap_place_requested(world_position: Vector3)

func request_place_trap(world_position: Vector3) -> void:
	trap_place_requested.emit(world_position)
