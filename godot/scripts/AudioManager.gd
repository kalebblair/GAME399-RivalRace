extends Node

const AUDIO_ROOT := "res://assets/audio"

@onready var music_player: AudioStreamPlayer = $MusicPlayer
@onready var sfx_jump: AudioStreamPlayer = $SfxJump
@onready var sfx_land: AudioStreamPlayer = $SfxLand
@onready var sfx_coin: AudioStreamPlayer = $SfxCoin
@onready var sfx_break: AudioStreamPlayer = $SfxBreak
@onready var sfx_fall: AudioStreamPlayer = $SfxFall

func _ready() -> void:
	_load_streams()
	music_player.autoplay = false
	music_player.stream_paused = false

func set_run_music(playing: bool) -> void:
	if playing:
		if music_player.stream != null and not music_player.playing:
			music_player.play()
	else:
		music_player.stop()

func play_jump() -> void:
	_play(sfx_jump)

func play_land() -> void:
	_play(sfx_land)

func play_coin() -> void:
	_play(sfx_coin)

func play_break() -> void:
	_play(sfx_break)

func play_fall() -> void:
	_play(sfx_fall)

func _play(player: AudioStreamPlayer) -> void:
	if player.stream == null:
		return
	player.stop()
	player.play()

func _load_streams() -> void:
	music_player.stream = _load_stream("%s/music/run-bgm.mp3" % AUDIO_ROOT)
	music_player.volume_db = linear_to_db(0.32)

	sfx_jump.stream = _load_stream("%s/sfx/jump.ogg" % AUDIO_ROOT)
	sfx_jump.volume_db = linear_to_db(0.55)

	sfx_land.stream = _load_stream("%s/sfx/land.ogg" % AUDIO_ROOT)
	sfx_land.volume_db = linear_to_db(0.45)

	sfx_coin.stream = _load_stream("%s/sfx/coin.ogg" % AUDIO_ROOT)
	sfx_coin.volume_db = linear_to_db(0.52)

	sfx_break.stream = _load_stream("%s/sfx/break.ogg" % AUDIO_ROOT)
	sfx_break.volume_db = linear_to_db(0.42)

	sfx_fall.stream = _load_stream("%s/sfx/fall.ogg" % AUDIO_ROOT)
	sfx_fall.volume_db = linear_to_db(0.5)

func _load_stream(path: String) -> AudioStream:
	if not FileAccess.file_exists(path):
		push_warning("Audio missing at %s. Import/copy files into godot/assets/audio/ to enable this sound." % path)
		return null
	var stream := load(path)
	if stream == null:
		push_warning("Audio missing at %s. Import/copy files into godot/assets/audio/ to enable this sound." % path)
	return stream
