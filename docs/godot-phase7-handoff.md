# Phase 7 Handoff Report (Godot Migration)

This document is the Phase 7 handoff template for transitioning from migration work to ongoing game development in Godot.

## 1) Scope completed

Implemented in migration phases:

- [x] Phase 0 - parity baseline/spec docs
- [x] Phase 1 - Godot project scaffold + base scenes
- [x] Phase 2 - runner controller + camera-relative movement
- [x] Phase 3 - level rebuild + finish/fail + timer state flow
- [x] Phase 4 - watcher traps + placement constraints + one-shot effects
- [x] Phase 5 - watcher abilities + cooldown timing + HUD updates
- [x] Phase 6 - Godot-native audio manager + event wiring
- [ ] Phase 7 - final QA sign-off (in progress, run checklist below)

Checklist reference:

- `docs/godot-phase7-regression-checklist.md`

## 2) Godot project location

- Root: `godot/`
- Entry scene: `res://scenes/Main.tscn`
- Main gameplay script: `res://scripts/Main.gd`

## 3) Key runtime scripts

- `res://scripts/Main.gd`
  - role switching
  - run state/timer/reset
  - camera logic (runner + watcher)
  - watcher trap placement/ability input
  - gameplay-to-audio event dispatch
- `res://scripts/RunnerController.gd`
  - movement/jump/grounding
  - debuff handling (slow/invert/freeze)
  - debug watcher arrow-key override
  - jump/land signals
- `res://scripts/WorldRoot.gd`
  - procedural level build
  - finish trigger signal
  - trap lifecycle and trigger signal
- `res://scripts/AudioManager.gd`
  - BGM/SFX players and play API

## 4) Assets and licensing

- Audio runtime path: `godot/assets/audio/`
- Attribution copied to: `godot/assets/audio/ATTRIBUTION.txt`
- Additional reference: `docs/audio.md`

## 5) Known caveats / follow-up

- Godot must import new audio files to generate import metadata if they were recently copied.
- Export preset setup is environment-specific and should be created in editor before final release builds.
- Current watcher controls include debug accommodations (runner arrow-key control in watcher mode).

## 6) Recommended immediate next tasks

1. Run and complete `docs/godot-phase7-regression-checklist.md`.
2. Triage any blocker/major defects and patch in small focused commits.
3. Create and validate desktop export preset.
4. Once stable, treat `godot/` gameplay as source of truth and freeze web prototype except for archival.

## 7) Approval

- QA owner:
- Engineering owner:
- Date:
- Decision:
  - [ ] Approved as source-of-truth
  - [ ] Approved with exceptions
  - [ ] Not approved

