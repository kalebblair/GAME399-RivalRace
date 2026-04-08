# Phase 7 Regression Checklist (Godot)

Use this checklist to validate parity against `docs/migration-parity-checklist.md` before declaring the Godot build as source-of-truth.

## Build information

- Date:
- Tester:
- Branch:
- Godot version:
- Platform:

## A) Boot and scene sanity

- [ ] Project opens without parser/runtime errors.
- [ ] `res://scenes/Main.tscn` loads as startup scene.
- [ ] No missing script/node path errors in debugger output.

## B) Runner controls and camera

- [ ] Runner camera follows correctly in runner mode.
- [ ] Mouse look rotates camera freely (yaw/pitch) as expected.
- [ ] Camera does not clip through world geometry (collision probe working).
- [ ] Movement feels camera-relative in runner mode.
- [ ] Jump works only when grounded.
- [ ] Facing rotates to horizontal movement direction.

## C) Watcher controls

- [ ] Tab toggles roles reliably.
- [ ] Watcher camera can pan with WASD.
- [ ] Watcher camera can pan with middle-mouse drag.
- [ ] Watcher camera zoom works with wheel.
- [ ] Watcher orientation (180 flip) matches intended direction.
- [ ] Debug runner control with arrow keys in watcher mode works.

## D) Level / run state flow

- [ ] Enter starts run (`IDLE -> RUNNING`).
- [ ] Timer increments while running.
- [ ] Finish trigger transitions to `FINISHED` and freezes run control.
- [ ] Falling below fail Y resets to `IDLE`.
- [ ] `R` reset returns runner to spawn and clears traps/debuff effects.

## E) Trap system

- [ ] Trap placement only works in watcher mode.
- [ ] Trap placement blocked within min distance of runner.
- [ ] Max active traps enforced (`3`).
- [ ] Arm delay respected before trigger.
- [ ] Spike trap freezes runner and despawns (one-shot).
- [ ] Slow trap applies slow and despawns (one-shot).
- [ ] Trap count in HUD updates correctly.

## F) Ability system

- [ ] Ability 1 (slow) applies effect and starts cooldown.
- [ ] Ability 2 (invert) applies effect and starts cooldown.
- [ ] Ability 3 (push) applies impulse and starts cooldown.
- [ ] Cooldowns prevent recast until ready.
- [ ] Cooldown HUD values count down correctly.
- [ ] Abilities only cast in watcher role while run is active.

## G) Audio

- [ ] Run music starts on run start and stops on reset/finish.
- [ ] Jump SFX plays on jump.
- [ ] Land SFX plays on landing transition.
- [ ] Trap place SFX plays on successful placement.
- [ ] Spike/ability SFX plays (`break`).
- [ ] Slow/finish SFX plays (`coin`).
- [ ] Fall SFX plays on fail reset.

If any audio fails:

- [ ] Confirm files exist under `godot/assets/audio/`.
- [ ] Open Godot editor once to complete import metadata generation.

## H) Export smoke test (desktop)

- [ ] Export preset exists (Windows desktop).
- [ ] Export builds without fatal errors.
- [ ] Exported binary launches.
- [ ] Basic run loop works in exported build (start -> movement -> reset).

## I) Sign-off

- [ ] Passed with no blocker issues.
- [ ] Passed with minor issues (documented below).
- [ ] Failed (blockers documented below).

### Notes / defects

- Severity:
- Repro:
- Expected:
- Actual:
- Screenshot/log:

