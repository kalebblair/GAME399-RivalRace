# Watcher AI Plan (Godot)

## Goal

Create an AI controller for the watcher role that can:
- Place traps intelligently.
- Cast abilities (slow, invert, push) at good moments.
- Adapt to runner state and level position.
- Stay fair and configurable (difficulty levels, cooldown discipline, reaction delay).

This document is planning only. No AI gameplay logic is implemented yet.

## Current Integration Points

From the existing Godot architecture:
- `Main.gd` owns role flow, run state, watcher inputs, and ability/trap dispatch.
- `WorldRoot.gd` exposes trap placement and trap count constraints.
- `RunnerController.gd` contains runner status effects and movement state.

The AI should hook into watcher actions through `Main.gd` so human watcher and AI watcher share one dispatch path.

## Proposed Architecture

### 1) WatcherBrain (new script)

Add a new script/class, e.g. `scripts/WatcherAI.gd`, responsible for decision-making only.

Responsibilities:
- Observe world snapshot each tick.
- Score candidate actions.
- Return an action request (or no-op).

Non-responsibilities:
- Directly mutating world state.
- Bypassing `Main.gd` cooldown/placement rules.

### 2) Action Gateway in Main

Refactor watcher actions in `Main.gd` into callable methods used by both:
- Human input path.
- AI path.

Methods to unify:
- `try_place_trap_at(world_point, trap_type)`
- `try_cast_slow()`
- `try_cast_invert()`
- `try_cast_push()`

### 3) Snapshot Model

Create a lightweight snapshot struct/dictionary sent from `Main.gd` to AI:
- `run_state`
- `runner_position`, `runner_velocity`, `runner_grounded`
- `selected_trap`/available trap types
- trap counts and cooldown remaining
- nearest upcoming platform info (optional in phase 1)
- time since run start

## AI Behavior Plan (Phased)

## Phase A - Deterministic Heuristic Bot (MVP)

Objective: build a reliable baseline AI with no ML.

Behavior:
- Place trap slightly ahead of runner on projected path.
- Prefer spike when runner is in stable lane; prefer slow before long jump sections.
- Cast slow on approach to gaps.
- Cast invert only when runner has meaningful horizontal input.
- Cast push as disruption near edges (with fairness clamp).

Fairness controls:
- Reaction delay (e.g. 250-450 ms).
- Randomized action jitter within bounds.
- Cooldown compliance via existing systems.
- Max actions per second cap.

Exit criteria:
- AI places valid traps without errors for full runs.
- Cooldowns never violated.
- Win/loss rate sits in a target band against average human runner.

## Phase B - Difficulty Profiles

Add presets:
- `Easy`: slower reactions, less optimal placement, fewer combos.
- `Normal`: balanced.
- `Hard`: tighter timing, better predictive placement.

Expose as constants or settings file.

## Phase C - Tactical Awareness Upgrades

Improve context handling:
- Segment-level behavior (straight, zig-zag, staircase, narrow path).
- Runner pattern detection (jump-heavy, strafing, conservative).
- Combo planning (trap + ability sequencing).

## Phase D - Optional Learning Layer (Future)

If needed later:
- Collect telemetry from matches.
- Offline tune heuristic weights.
- Optional behavior-tree utility weighting from data.

No online training required for initial ship.

## Technical Tasks Breakdown

1. **Refactor action pathways**
- Centralize watcher actions in reusable methods in `Main.gd`.

2. **Add AI module**
- New `WatcherAI.gd` with `update(delta, snapshot) -> action`.

3. **Add control mode**
- `WatcherControlMode = HUMAN | AI` in `Main.gd`.
- Toggle via debug key and/or exported variable.

4. **Action scheduler**
- Ensure reaction delay + jitter + rate limiting.

5. **Safety and validity checks**
- Keep all placement/cooldown checks in one place (`Main.gd` + `WorldRoot.gd`).

6. **Debug visualization/logging**
- Optional: draw predicted trap point and chosen action text for tuning.

## Testing Plan

## Functional
- AI can complete 20+ runs without runtime errors.
- No invalid trap placements spam.
- Ability cooldowns respected 100%.
- Works across role swaps and run resets.

## Gameplay
- AI behaves differently per difficulty setting.
- AI can pressure runner but not make runs impossible.
- Trap/ability usage appears intentional, not random spam.

## Regression
- Human watcher controls remain unchanged when AI disabled.
- Existing trap/ability behavior parity remains intact.

## Risks and Mitigations

- **Risk:** AI overuses perfect edge pushes.
  - **Mitigation:** fairness clamps and uncertainty offset.
- **Risk:** brittle behavior on new level layouts.
  - **Mitigation:** platform-aware heuristics and fallback behavior.
- **Risk:** duplicated logic between human and AI paths.
  - **Mitigation:** single action gateway in `Main.gd`.

## Suggested Implementation Order

1. Refactor action gateway in `Main.gd`.
2. Build MVP heuristic bot (`WatcherAI.gd`).
3. Add difficulty profiles.
4. Add tactical upgrades and debug tools.
5. Balance pass with telemetry counters.

## Definition of Done (Initial AI Ship)

- AI watcher can play a full match loop end-to-end.
- No crashes, no cooldown violations, no invalid action spam.
- Difficulty presets feel distinct.
- Human watcher path still works exactly as before.
