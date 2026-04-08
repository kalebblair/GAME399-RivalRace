# Audio plan — Rival Race

This document describes how sound is designed, where files live, and how events map to playback in code.

## Stack

- **[Howler.js](https://howlerjs.com/)** (`howler`) for decoding, Web Audio / HTML5 playback, volume, and looping music.
- **React hooks**: `GameAudioProvider` + `useGameAudio()` in `src/audio/GameAudioContext.tsx`.
- **Game loop**: `ThreeCanvas.tsx` keeps a stable `audioRef` pointing at the latest controls so the Rapier/`requestAnimationFrame` tick does not depend on React render timing.

## Asset layout

Public URLs (served from `public/`):

| Path | Role |
|------|------|
| `assets/audio/music/run-bgm.mp3` | Looping run BGM (long ingame track; Howler repeats full file) |
| `assets/audio/sfx/jump.ogg` | Jump |
| `assets/audio/sfx/land.ogg` | Landing |
| `assets/audio/sfx/coin.ogg` | Trap place + finish line |
| `assets/audio/sfx/break.ogg` | Spike death + watcher abilities |
| `assets/audio/sfx/fall.ogg` | Void death |

License and source notes: `public/assets/audio/ATTRIBUTION.txt`.

## Runtime behavior

### Autoplay / unlock

Browsers often start `AudioContext` suspended until a user gesture. The provider listens for `pointerdown` on `window` and calls `Howler.ctx.resume()` when needed. Music is only started when a run begins (`setRunMusic(true)`), and **`setRunMusic(false)` does not create Howl instances** (lazy bank) so idle loads stay light.

### Music

- **On** while `runState === 'running'`.
- **Off** for `idle` and `finished` (see `useEffect` in `ThreeCanvas.tsx` that calls `audio.setRunMusic(runState === 'running')`).
- BGM uses `html5: true` for smoother streaming. The file is a **full-length ingame cue** (several minutes), so `loop: true` means you hear **much longer between repeats** than the old ~short loop. The jump when the file restarts may not be perfectly seamless unless you later swap in a track edited for zero-crossing loops.

## Event → sound (implemented)

| Design intent | Sound file | Where / when |
|---------------|------------|----------------|
| Run tension / pace | `run-bgm.mp3` | `setRunMusic(true)` while running |
| Runner jump | `jump.ogg` | Jump applied in sim tick (grounded + jump input) |
| Runner land | `land.ogg` | Edge: was airborne → grounded (`prevRunnerGrounded`); reset on `resetPhysics` |
| Watcher places trap | `coin.ogg` | `placeTrapAt` after trap is accepted |
| Reach finish | `coin.ogg` | First intersection with finish sensor (`finishSoundLatchedRef` prevents repeats) |
| Spike trap hit | `break.ogg` | Trap removes from world; applies movement freeze (~`SPIKE_FREEZE_MS`) |
| Fall off world | `fall.ogg` | `resetPhysics('void')` (`y < -6`) |
| Watcher Slow / Invert / Push | `break.ogg` | `castSlow`, `castInvert`, `castPush` on successful cast |

Death / reset does not play extra SFX for the initial `resetPhysics()` at scene init (no `death` argument).

## Code map

- `src/audio/GameAudioContext.tsx` — `AUDIO_URLS`, lazy `getBank()`, context API.
- `src/App.tsx` — wraps the app with `GameAudioProvider`.
- `src/ThreeCanvas.tsx` — gameplay triggers (`audioRef` in physics tick; `audio` in UI ability handlers).

## Future ideas (not built yet)

- Separate **victory sting** from **coin** (trap place vs finish).
- **Trap arm** cue when collider enables after the arm delay.
- **Footsteps** or surface-based foley from horizontal speed.
- **UI** clicks / menu sounds.
- Music **ducking** or filter under Slow debuff.
- Replace singleton Howl bank with explicit teardown if you need clean hot-reload or multiple scenes.
