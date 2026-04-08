# Audio Import Notes (Godot)

Phase 6 uses a Godot-native `AudioManager` (`res://scripts/AudioManager.gd`) and expects files at:

- `res://assets/audio/music/run-bgm.mp3`
- `res://assets/audio/sfx/jump.ogg`
- `res://assets/audio/sfx/land.ogg`
- `res://assets/audio/sfx/coin.ogg`
- `res://assets/audio/sfx/break.ogg`
- `res://assets/audio/sfx/fall.ogg`

Current migration status:

- Audio playback system is wired.
- If files are missing, Godot logs warnings and continues without crashing.

To complete Phase 6 asset import, copy existing web assets from:

- `../public/assets/audio/music/`
- `../public/assets/audio/sfx/`

into this folder structure.

Attribution source remains:

- `../public/assets/audio/ATTRIBUTION.txt`
