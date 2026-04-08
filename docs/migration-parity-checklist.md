# Godot Migration - Phase 0 Parity Checklist

Purpose: lock the current web prototype behavior so the Godot port can be verified against objective values.

Status legend:

- `[ ]` not verified in baseline capture
- `[x]` verified / accepted for migration target

## 1) Core Gameplay Contract

### Roles and states

- [x] Roles: `runner`, `watcher`
- [x] Run states: `idle`, `running`, `finished`
- [x] Runner can swap role with `Tab`
- [x] Finish triggers `finished` and stops run timer
- [x] Void fall (`y < -6`) resets run to `idle`

### Runner movement

- [x] Input: WASD + Space
- [x] Camera-relative horizontal movement
- [x] Orbit camera while dragging mouse in runner mode
- [x] Gravity, grounded jump, slope handling
- [x] Body origin semantics: runner physics body translation represents feet/soles

### Watcher interactions

- [x] Left click places trap (watcher mode only)
- [x] Max active traps: `3`
- [x] Trap placement blocked within ~`2.0m` of runner feet
- [x] Trap arm delay: `1500ms`
- [x] Trap types:
  - [x] Spike -> freeze movement, one-shot then removed
  - [x] Slow -> apply slow debuff, one-shot then removed

### Watcher abilities

- [x] Slow ability with cooldown
- [x] Invert ability with cooldown
- [x] Push ability with cooldown
- [x] Cooldowns reflected in HUD and disabled states

---

## 2) Numerical Baseline (source-of-truth values)

All values below are extracted from `src/ThreeCanvas.tsx` and should be mirrored first in Godot before tuning.

## Runner physics and camera

- Capsule half-height: `0.45`
- Capsule radius: `0.35`
- Capsule offset above feet origin: `0.80` (`halfHeight + radius`)
- Camera chest pivot above feet: `1.05`
- Runner camera base offset: `(-4, 3, 4.2)`
- Orbit sensitivity: `0.006` radians/pixel
- Horizontal base speed: `6.0`
- Horizontal lerp factor (normal): `0.22`
- Horizontal lerp factor (frozen damping): `0.35`
- Gravity acceleration: `18`
- Jump vertical velocity: `7.5`
- Character controller:
  - autostep max height: `0.35`
  - autostep min width: `0.2`
  - autostep dynamic bodies: `true`
  - max slope climb angle: `55 deg`
  - min slope slide angle: `60 deg`

## Trap/finish collision proxies

- Spike trap overlap sphere radius: `0.55`
- Slow trap overlap sphere radius: `0.70`
- Extra overlap margin in capsule test: `+0.2`
- Finish radius: `1.2`

## Debuffs

- Spike freeze duration: `2400ms`
- Trap slow duration: `2500ms`
- Ability slow duration: `3500ms`
- Ability invert duration: `2800ms`

## Ability cooldowns

- Slow cooldown: `7000ms`
- Invert cooldown: `11000ms`
- Push cooldown: `9000ms`

## Run flow values

- Void fail Y threshold: `< -6`
- Run start sets state to `running`, timer begins at `now`
- Finish sets state to `finished`, stores end timestamp

---

## 3) Level Baseline (current playable route)

- Start platform: `id=ground`, from `(-4, -0.55, -4)` to `(4, 0, 4)`
- Stepping platforms: `p01`..`p07` (~3.2m wide) with ~2.5m gaps
- Goal platform: `id=goal`, from `(46.4, 2.66, -5.5)` to `(51.2, 3.06, -2)`
- Finish center: `(48, 0, -4)` with projected top-surface Y at runtime
- Watch camera center: `(23, 0, -2.5)`, ortho half-width `32`

Acceptance target:

- [ ] Runner can complete course by sequential gap jumps
- [ ] Watcher can view full course and place traps on all valid platforms

---

## 4) Audio Contract

Reference: `docs/audio.md`

- [x] BGM only while `runState === running`
- [x] Jump SFX on jump impulse
- [x] Land SFX on airborne -> grounded transition
- [x] Trap place SFX
- [x] Finish SFX (latched once)
- [x] Spike hit SFX
- [x] Void fall SFX
- [x] Ability cast SFX

---

## 5) Asset Inventory (migration scope)

## Geometry / art

- Kenney starter-kit assets currently referenced under `public/assets/kenney-platformer/`
- Source references in:
  - `public/assets/kenney-platformer/LICENSE-Kenney-StarterKit.md`
  - `asset-sources/kenney/starter-kit-3d-platformer/...`

## Audio

- Runtime files in `public/assets/audio/`
- Attribution in `public/assets/audio/ATTRIBUTION.txt`

Migration rule:

- [ ] Keep attribution/license texts with copied assets in Godot project.

---

## 6) Baseline Validation Script (manual)

Run this sequence on the web prototype and record pass/fail:

1. Start run -> verify timer increments and BGM starts.
2. Complete first two jumps -> verify grounded jump feel and camera orbit.
3. Swap to watcher -> place spike and slow traps on valid pads.
4. Trigger spike -> verify freeze (not run reset), trap disappears.
5. Trigger slow -> verify speed penalty, trap disappears.
6. Cast slow/invert/push -> verify cooldowns and effects.
7. Reach finish -> verify state `finished`, timer stops.
8. Reset -> verify clean state (no traps/debuff leftovers).

Checklist:

- [ ] Steps 1-8 captured and archived (video/gif + notes)

---

## 7) Godot MCP Phase-0 usage

Use these tools for environment sanity before Phase 1 scene work:

- `get_godot_version` -> ensure MCP/Godot executable path valid
- `list_projects` -> verify migration workspace is discoverable
- `get_project_info` -> verify selected Godot project metadata

Current known state:

- [x] `get_godot_version` returns `4.6.2.stable.official.71f334935`

