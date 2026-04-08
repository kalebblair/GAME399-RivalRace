# Rival Race Migration Plan (React/Three/Rapier -> Godot 4.6)

This document proposes a staged migration from the current web prototype to a native Godot project while preserving gameplay behavior and improving iteration speed.

## Goals

- Keep current core loop: runner movement, watcher traps/abilities, finish timing.
- Migrate safely with frequent playable milestones.
- Avoid a long "big bang" rewrite by porting systems in vertical slices.
- Use the Godot MCP to automate repetitive editor/scene setup where practical.

## Current Feature Baseline (to preserve)

- Runner:
  - Kinematic capsule movement, jump, gravity, camera-relative WASD.
  - Third-person orbit camera while holding mouse.
- Watcher:
  - Top-down role, click-to-place traps with arm delay, max active traps.
  - Abilities: slow, invert, push with cooldowns.
- Match flow:
  - `idle` / `running` / `finished`, timer, reset, role swap.
- Audio:
  - BGM loop and SFX events via hook/context.
- Level:
  - Small stepping platforms with intentional gaps and finish island.

---

## Phase 0 - Pre-migration freeze and spec (0.5-1 day)

### Deliverables

- Freeze current behavior contract in writing:
  - Movement values (speed, gravity, jump impulse, air feel).
  - Trap radii, arm delay, max trap count, debuff durations.
  - Ability cooldowns/durations and run state transitions.
- Capture short videos/gifs for "golden behavior" references.
- Finalize asset inventory:
  - Geometry/models in use.
  - Audio files and attribution.

### MCP usage

- Use `list_projects` and `get_project_info` to ensure MCP sees the target migration workspace.

### Exit criteria

- A signed-off baseline spec exists so parity can be tested objectively later.

---

## Phase 1 - Godot project bootstrap and parity shell (1 day)

### Deliverables

- Create new Godot project folder (or dedicated subfolder) for migration.
- Base scenes:
  - `Main.tscn`
  - `WorldRoot.tscn`
  - `Runner.tscn`
  - `WatcherUI.tscn`
- Input map parity:
  - `move_forward/back/left/right`, `jump`, `switch_role`, watcher actions.
- Basic camera setup:
  - Third-person runner camera.
  - Orthographic watcher camera.

### MCP usage

- `create_scene`, `add_node`, `save_scene` to scaffold initial scene tree quickly.
- `get_godot_version` and `launch_editor` as sanity checks.

### Exit criteria

- Project opens/runs in Godot with scene switching and both camera modes available.

---

## Phase 2 - Runner controller port (2-3 days)

### Deliverables

- Implement `RunnerController.gd` using `CharacterBody3D`.
- Match behavior:
  - Camera-relative movement.
  - Jump, gravity, grounded handling.
  - Facing direction from horizontal velocity.
- Keep body origin semantics consistent with latest web fix (feet origin expectations).

### Notes

- Port constants directly first; tune only after side-by-side comparison.
- Add debug HUD values for velocity/grounded to speed tuning.

### Exit criteria

- Runner can complete a simple test track in Godot with feel close to web prototype.

---

## Phase 3 - Level and traversal parity (1-2 days)

### Deliverables

- Rebuild the current stepping-stone level in Godot.
- Collision authored with static bodies/collision shapes.
- Finish zone trigger and fail volume.
- Timer + run state management in Godot.

### MCP usage

- `create_scene`, `add_node`, `save_scene` for repetitive platform scene authoring.
- Optional `update_project_uids` after bulk scene creation if needed.

### Exit criteria

- Full solo run flow works: start -> traverse gaps -> finish or fall reset.

---

## Phase 4 - Watcher systems (2-3 days)

### Deliverables

- Role switching and watcher orthographic control.
- Click placement on level surfaces with:
  - placement constraints,
  - arm delay,
  - max active traps.
- Trap effects:
  - spike -> freeze movement then recover,
  - slow -> temporary movement penalty.
- Trap one-shot removal after trigger.

### Implementation direction

- Use `Area3D` for finish/traps and explicit state gating (armed/active/consumed).
- Keep durations and radii in a shared config resource.

### Exit criteria

- Both trap types are reliable and match intended gameplay outcomes.

---

## Phase 5 - Abilities + cooldown UI parity (1-2 days)

### Deliverables

- Watcher abilities: slow, invert, push.
- Cooldown timers and button disabled states.
- Same role-specific HUD behavior as current build.

### Exit criteria

- End-to-end runner/watcher gameplay loop is feature-complete in Godot.

---

## Phase 6 - Audio migration (1 day)

### Deliverables

- Replace Howler-based runtime with Godot `AudioStreamPlayer` nodes:
  - Music bus/player,
  - SFX player(s) or pooled players.
- Port trigger map from `docs/audio.md`.
- Preserve attributions in project docs.

### Exit criteria

- All major gameplay events fire correct audio in Godot.

---

## Phase 7 - Polish, QA, and handoff (1-2 days)

### Deliverables

- Tuning pass:
  - jump gap consistency,
  - camera feel,
  - trap readability.
- Regression checklist against Phase 0 baseline.
- Remove or archive web prototype files if desired.
- Build/export test (desktop target first).

### MCP usage

- `run_project`, `get_debug_output`, `stop_project` for quick test loops.

### Exit criteria

- Godot version is the new source of truth and is playable at parity.

---

## Recommended Repository Strategy

- Keep branch: `migration/godot` (already created).
- Suggested commit rhythm:
  - one phase per PR-sized commit set,
  - avoid mixing systems (e.g., movement + audio + UI in one commit).

Proposed commit sequence:

1. `chore(godot): scaffold project and base scenes`
2. `feat(godot): port runner controller and cameras`
3. `feat(godot): rebuild level and finish flow`
4. `feat(godot): watcher traps and role gameplay`
5. `feat(godot): abilities and cooldown ui`
6. `feat(godot): integrate audio events and buses`
7. `chore(godot): polish tuning and parity checklist`

---

## Risks and Mitigations

- Movement feel drift:
  - Mitigation: lock constants first, tune with side-by-side captures.
- Trigger reliability differences:
  - Mitigation: use `Area3D` + explicit armed/consumed states; avoid ambiguous overlap logic.
- Scope creep during migration:
  - Mitigation: "parity first, enhancements second" rule.

---

## Proposed Next Action

Start Phase 0 immediately by creating:

- `docs/migration-parity-checklist.md` (numeric gameplay constants + expected behaviors)
- a Godot project scaffold commit on `migration/godot`.

