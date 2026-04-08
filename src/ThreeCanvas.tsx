import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { useGameAudio, type GameAudioControls } from './audio/GameAudioContext'

type Role = 'runner' | 'watcher'
type TrapType = 'spike' | 'slow'

type Trap = {
  id: string
  type: TrapType
  position: THREE.Vector3
  placedAtMs: number
  armDelayMs: number
}

type Debuff = {
  slowUntilMs: number
  invertUntilMs: number
  /** No WASD / jump; gravity still applies. */
  freezeUntilMs: number
}

type Cooldowns = {
  slowReadyAtMs: number
  invertReadyAtMs: number
  pushReadyAtMs: number
}

type LevelBox = {
  id: string
  min: THREE.Vector3
  max: THREE.Vector3
  color: number
}

function nowMs() {
  return performance.now()
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}

function formatTime(ms: number) {
  const s = Math.max(0, ms) / 1000
  const m = Math.floor(s / 60)
  const r = s - m * 60
  return `${m}:${r.toFixed(2).padStart(5, '0')}`
}

function aabbContainsXZ(box: LevelBox, x: number, z: number) {
  return x >= box.min.x && x <= box.max.x && z >= box.min.z && z <= box.max.z
}

function topSurfaceYAt(level: LevelBox[], x: number, z: number) {
  let y = -Infinity
  for (const b of level) {
    if (aabbContainsXZ(b, x, z)) y = Math.max(y, b.max.y)
  }
  return y
}

const ASSET_BASE = '/assets/kenney-platformer'

async function loadGltf(url: string) {
  const loader = new GLTFLoader()
  return await loader.loadAsync(url)
}

function setAllMaterialsDoubleSided(obj: THREE.Object3D) {
  obj.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const m of mats) {
        if ((m as THREE.Material).side !== undefined) (m as THREE.Material).side = THREE.DoubleSide
      }
    }
  })
}

/** Must match Rapier `ColliderDesc.capsule(halfHeight, radius)` below. */
const RUNNER_CAPSULE_HALF_H = 0.45
const RUNNER_CAPSULE_RADIUS = 0.35
/**
 * Body origin = soles on the ground. Rapier’s capsule is centered on its segment; offset so capsule bottom meets y=0.
 */
const RUNNER_CAPSULE_OFFSET_Y = RUNNER_CAPSULE_HALF_H + RUNNER_CAPSULE_RADIUS
/** Camera / movement pivot above feet (world Y). */
const RUNNER_CHEST_Y_ABOVE_FEET = 1.05

/** Default third-person offset; horizontal part rotates by `cameraYaw` around the runner. */
const RUNNER_CAM_OFFSET_BASE = new THREE.Vector3(-4, 3, 4.2)
/** Radians per pixel (horizontal mouse drag while runner). */
const RUNNER_CAM_MOUSE_SENS = 0.006

/** Top-down camera: center on course, half-width in world units (must frame full level). */
const WATCH_LEVEL_CENTER = new THREE.Vector3(23, 0, -2.5)
const WATCH_HALF_WIDTH = 32

/** Sensor ball radii — must match `ColliderDesc.ball` in `placeTrapAt`. */
const TRAP_SPIKE_BALL_R = 0.55
const TRAP_SLOW_BALL_R = 0.7
const SPIKE_FREEZE_MS = 2400

/** Squared distance from point P to segment AB (for capsule-axis test). */
function distSqPointToSegment3D(
  px: number,
  py: number,
  pz: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): number {
  const abx = bx - ax
  const aby = by - ay
  const abz = bz - az
  const apx = px - ax
  const apy = py - ay
  const apz = pz - az
  const abLenSq = abx * abx + aby * aby + abz * abz
  let t = abLenSq > 1e-14 ? (apx * abx + apy * aby + apz * abz) / abLenSq : 0
  t = Math.max(0, Math.min(1, t))
  const qx = ax + abx * t
  const qy = ay + aby * t
  const qz = az + abz * t
  const dx = px - qx
  const dy = py - qy
  const dz = pz - qz
  return dx * dx + dy * dy + dz * dz
}

/**
 * Trap sensor vs runner capsule. `(rx,ry,rz)` is body translation = **feet** on the ground plane, not capsule center.
 */
function trapBallOverlapsRunnerCapsule(
  trapX: number,
  trapY: number,
  trapZ: number,
  ballRadius: number,
  feetX: number,
  feetY: number,
  feetZ: number,
): boolean {
  const h = RUNNER_CAPSULE_HALF_H
  const capR = RUNNER_CAPSULE_RADIUS
  const ax = feetX
  const ay = feetY + capR
  const az = feetZ
  const bx = feetX
  const by = feetY + capR + 2 * h
  const bz = feetZ
  const dSq = distSqPointToSegment3D(trapX, trapY, trapZ, ax, ay, az, bx, by, bz)
  const reach = ballRadius + capR + 0.2
  return dSq <= reach * reach
}

export function ThreeCanvas() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const audio = useGameAudio()
  const audioRef = useRef<GameAudioControls>(audio)
  audioRef.current = audio
  const finishSoundLatchedRef = useRef(false)
  /** Set inside scene init; used by HUD Reset to clear Rapier traps / runner pose. */
  const resetPhysicsFromHudRef = useRef<(death?: 'void') => void>(() => {})

  const [role, setRole] = useState<Role>('runner')
  const roleRef = useRef<Role>('runner')
  useEffect(() => {
    roleRef.current = role
  }, [role])

  const [selectedTrap, setSelectedTrap] = useState<TrapType>('spike')
  const selectedTrapRef = useRef<TrapType>('spike')
  useEffect(() => {
    selectedTrapRef.current = selectedTrap
  }, [selectedTrap])

  const [runState, setRunState] = useState<'idle' | 'running' | 'finished'>('idle')
  const runStateRef = useRef<'idle' | 'running' | 'finished'>('idle')
  const setRunStateSyncedRef = useRef<(s: 'idle' | 'running' | 'finished') => void>((s) => {
    runStateRef.current = s
  })
  setRunStateSyncedRef.current = (s) => {
    runStateRef.current = s
    setRunState(s)
  }

  const [runStartMs, setRunStartMs] = useState(0)
  const [runEndMs, setRunEndMs] = useState(0)
  const [hudNowMs, setHudNowMs] = useState(() => nowMs())

  const trapsRef = useRef<Trap[]>([])
  const debuffRef = useRef<Debuff>({ slowUntilMs: 0, invertUntilMs: 0, freezeUntilMs: 0 })
  const cdsRef = useRef<Cooldowns>({ slowReadyAtMs: 0, invertReadyAtMs: 0, pushReadyAtMs: 0 })

  const inputRef = useRef({
    forward: false,
    back: false,
    left: false,
    right: false,
    jumpQueued: false,
  })

  const runnerRef = useRef({
    position: new THREE.Vector3(0, 0.02, 0),
    velocity: new THREE.Vector3(0, 0, 0),
    grounded: false,
  })

  const finishRef = useRef({
    center: new THREE.Vector3(48, 0, -4),
    radius: 1.2,
  })

  /**
   * Small platforms (~3.2 m) with ~2.5 m edge gaps — jumps required between each step.
   * Heights rise slowly; goal pad is slightly wider.
   */
  const level = useMemo<LevelBox[]>(
    () => [
      {
        id: 'ground',
        min: new THREE.Vector3(-4, -0.55, -4),
        max: new THREE.Vector3(4, 0, 4),
        color: 0x1a2744,
      },
      { id: 'p01', min: new THREE.Vector3(6.5, 0, -1.35), max: new THREE.Vector3(9.7, 0.4, 1.35), color: 0x243456 },
      { id: 'p02', min: new THREE.Vector3(12.2, 0.38, -1.75), max: new THREE.Vector3(15.4, 0.78, 0.95), color: 0x2a3f5e },
      { id: 'p03', min: new THREE.Vector3(17.9, 0.76, -2.15), max: new THREE.Vector3(21.1, 1.16, 0.55), color: 0x314868 },
      { id: 'p04', min: new THREE.Vector3(23.6, 1.14, -2.55), max: new THREE.Vector3(26.8, 1.54, 0.15), color: 0x375a7a },
      { id: 'p05', min: new THREE.Vector3(29.3, 1.52, -2.95), max: new THREE.Vector3(32.5, 1.92, -0.25), color: 0x3d5c8a },
      { id: 'p06', min: new THREE.Vector3(35, 1.9, -3.35), max: new THREE.Vector3(38.2, 2.3, -0.65), color: 0x456892 },
      { id: 'p07', min: new THREE.Vector3(40.7, 2.28, -3.75), max: new THREE.Vector3(43.9, 2.68, -1.05), color: 0x4d7498 },
      { id: 'goal', min: new THREE.Vector3(46.4, 2.66, -5.5), max: new THREE.Vector3(51.2, 3.06, -2), color: 0x5a7fb8 },
    ],
    [],
  )

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'KeyW') inputRef.current.forward = true
      if (e.code === 'KeyS') inputRef.current.back = true
      if (e.code === 'KeyA') inputRef.current.left = true
      if (e.code === 'KeyD') inputRef.current.right = true
      if (e.code === 'Space') inputRef.current.jumpQueued = true
      if (e.code === 'Tab') {
        e.preventDefault()
        setRole((r) => (r === 'runner' ? 'watcher' : 'runner'))
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'KeyW') inputRef.current.forward = false
      if (e.code === 'KeyS') inputRef.current.back = false
      if (e.code === 'KeyA') inputRef.current.left = false
      if (e.code === 'KeyD') inputRef.current.right = false
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  useEffect(() => {
    audio.setRunMusic(runState === 'running')
  }, [audio, runState])

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return

    let cancelled = false
    let raf = 0

    const start = async () => {
      await RAPIER.init()
      if (cancelled) return

      const renderer = new THREE.WebGLRenderer({ antialias: true })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      renderer.shadowMap.enabled = true
      container.appendChild(renderer.domElement)

      const scene = new THREE.Scene()
      scene.background = new THREE.Color(0x05070f)

      const runnerCam = new THREE.PerspectiveCamera(65, 1, 0.1, 200)
      const watchCam = new THREE.OrthographicCamera(-12, 12, 8, -8, 0.1, 200)

      scene.add(new THREE.AmbientLight(0xffffff, 0.55))
      const dir = new THREE.DirectionalLight(0xffffff, 1.0)
      dir.position.set(WATCH_LEVEL_CENTER.x + 10, 20, WATCH_LEVEL_CENTER.z + 12)
      dir.castShadow = true
      scene.add(dir)

      const grid = new THREE.GridHelper(100, 50, 0x3b82f6, 0x111827)
      ;(grid.material as THREE.Material).transparent = true
      ;(grid.material as THREE.Material).opacity = 0.25
      scene.add(grid)

      const levelGroup = new THREE.Group()
      scene.add(levelGroup)
      // Visuals: start with boxes, then replace with Kenney glTF models.
      const levelPlaceholders: { id: string; mesh: THREE.Mesh; size: THREE.Vector3; center: THREE.Vector3 }[] = []
      for (const b of level) {
        const size = new THREE.Vector3().subVectors(b.max, b.min)
        const center = new THREE.Vector3().addVectors(b.min, b.max).multiplyScalar(0.5)
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(size.x, size.y, size.z),
          new THREE.MeshStandardMaterial({ color: b.color, metalness: 0.05, roughness: 0.9 }),
        )
        mesh.position.copy(center)
        mesh.receiveShadow = true
        levelGroup.add(mesh)
        levelPlaceholders.push({ id: b.id, mesh, size, center })
      }

      // Single transform driven by physics each frame — avoids skinned / nested GLTF root issues.
      const runnerRoot = new THREE.Group()
      scene.add(runnerRoot)

      const runnerMesh = new THREE.Mesh(
        new THREE.CapsuleGeometry(RUNNER_CAPSULE_RADIUS, RUNNER_CAPSULE_HALF_H * 2, 8, 16),
        new THREE.MeshStandardMaterial({ color: 0xff3b7a, metalness: 0.15, roughness: 0.35 }),
      )
      runnerMesh.castShadow = true
      runnerMesh.position.y = RUNNER_CAPSULE_OFFSET_Y
      runnerRoot.add(runnerMesh)

      const finishMesh = new THREE.Mesh(
        new THREE.TorusGeometry(finishRef.current.radius, 0.12, 12, 48),
        new THREE.MeshStandardMaterial({ color: 0x34d399, emissive: 0x0b3a2b }),
      )
      finishMesh.rotation.x = Math.PI / 2
      finishMesh.position.copy(finishRef.current.center)
      finishMesh.position.y = topSurfaceYAt(level, finishMesh.position.x, finishMesh.position.z) + 0.25
      scene.add(finishMesh)

      const trapGroup = new THREE.Group()
      scene.add(trapGroup)

      // Attempt to load Kenney models (non-blocking). If loading fails, placeholders remain.
      try {
        const [platformLarge, platformMedium, character, flag, coin, cloud] = await Promise.all([
          loadGltf(`${ASSET_BASE}/platform-large.glb`),
          loadGltf(`${ASSET_BASE}/platform-medium.glb`),
          loadGltf(`${ASSET_BASE}/character.glb`),
          loadGltf(`${ASSET_BASE}/flag.glb`),
          loadGltf(`${ASSET_BASE}/coin.glb`),
          loadGltf(`${ASSET_BASE}/cloud.glb`),
        ])

        const platformForFootprint = (size: THREE.Vector3) =>
          Math.max(size.x, size.z) >= 4.4 ? platformLarge.scene : platformMedium.scene

        for (const p of levelPlaceholders) {
          const model = platformForFootprint(p.size).clone(true)
          setAllMaterialsDoubleSided(model)
          model.position.copy(p.center)
          // Scale to roughly match collider footprint; Kenney platforms are authored at a consistent size.
          const scaleX = p.size.x / 4
          const scaleY = p.size.y / 0.4
          const scaleZ = p.size.z / 4
          const s = new THREE.Vector3(scaleX, scaleY, scaleZ)
          model.scale.copy(s)
          model.traverse((c) => {
            if ((c as THREE.Mesh).isMesh) {
              ;(c as THREE.Mesh).castShadow = false
              ;(c as THREE.Mesh).receiveShadow = true
            }
          })
          levelGroup.add(model)
          levelGroup.remove(p.mesh)
          p.mesh.geometry.dispose()
          ;(p.mesh.material as THREE.Material).dispose()
        }

        // Runner character: child of runnerRoot so physics only moves the group.
        const charObj = character.scene.clone(true)
        setAllMaterialsDoubleSided(charObj)
        charObj.scale.setScalar(0.9)
        charObj.traverse((c) => {
          if ((c as THREE.Mesh).isMesh) {
            ;(c as THREE.Mesh).castShadow = true
            ;(c as THREE.Mesh).receiveShadow = false
          }
        })
        // Body origin = soles; move mesh so lowest point is at y=0 in runnerRoot space.
        charObj.position.set(0, 0, 0)
        const charBounds = new THREE.Box3().setFromObject(charObj)
        charObj.position.y = -charBounds.min.y
        runnerRoot.remove(runnerMesh)
        runnerMesh.geometry.dispose()
        ;(runnerMesh.material as THREE.Material).dispose()
        runnerRoot.add(charObj)

        // Finish marker
        const flagObj = flag.scene
        setAllMaterialsDoubleSided(flagObj)
        flagObj.position.copy(finishMesh.position)
        flagObj.position.y -= 0.15
        flagObj.scale.setScalar(1.2)
        scene.add(flagObj)
        finishMesh.visible = false

        for (let i = 0; i < 7; i++) {
          const c = cloud.scene.clone(true)
          c.position.set(-5 + i * 9, 8 + (i % 2) * 1.4, -10 + (i % 3) * 4)
          c.scale.setScalar(2.0)
          scene.add(c)
        }

        // Store for trap visuals
        ;(trapGroup.userData as { coin?: THREE.Object3D }).coin = coin.scene
        ;(trapGroup.userData as { char?: THREE.Object3D }).char = charObj
      } catch {
        // Keep primitives as fallback
      }

      // --- Rapier ---
      const world = new RAPIER.World(new RAPIER.Vector3(0, -18, 0))
      for (const b of level) {
        const size = new THREE.Vector3().subVectors(b.max, b.min)
        const center = new THREE.Vector3().addVectors(b.min, b.max).multiplyScalar(0.5)
        const rb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z))
        world.createCollider(RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2), rb)
      }

      const runnerStart = runnerRef.current.position
      const runnerBody = world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(runnerStart.x, runnerStart.y, runnerStart.z),
      )
      const runnerCollider = world.createCollider(
        RAPIER.ColliderDesc.capsule(RUNNER_CAPSULE_HALF_H, RUNNER_CAPSULE_RADIUS)
          .setTranslation(0, RUNNER_CAPSULE_OFFSET_Y, 0)
          .setFriction(0.0),
        runnerBody,
      )
      // DEFAULT only tests dynamic bodies against others; runner is kinematic — need fixed/sensor too (traps, finish).
      runnerCollider.setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.ALL)

      const controller = world.createCharacterController(0.01)
      controller.setApplyImpulsesToDynamicBodies(false)
      controller.enableAutostep(0.35, 0.2, true)
      controller.setMaxSlopeClimbAngle((55 * Math.PI) / 180)
      controller.setMinSlopeSlideAngle((60 * Math.PI) / 180)

      /** Y-axis orbit angle for the runner camera (starts aligned with RUNNER_CAM_OFFSET_BASE). */
      let cameraYaw = 0
      /** Active pointer for runner orbit drag (pointer capture). */
      let orbitDragPointerId: number | null = null
      let orbitLastClientX = 0
      /** Land SFX edge detect; must exist before `resetPhysics` (called on init). */
      let prevRunnerGrounded = true

      const raycaster = new THREE.Raycaster()
      const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

      const clearTraps = () => {
        while (trapGroup.children.length) trapGroup.remove(trapGroup.children[0]!)
      }

      const removeTrapById = (trapId: string) => {
        trapsRef.current = trapsRef.current.filter((t) => t.id !== trapId)
        for (let i = trapGroup.children.length - 1; i >= 0; i--) {
          const ch = trapGroup.children[i]!
          if ((ch.userData as { trapId?: string }).trapId === trapId) trapGroup.remove(ch)
        }
      }

      const resetPhysics = (death?: 'void') => {
        if (death === 'void') audioRef.current.playFall()
        const t = nowMs()
        debuffRef.current = { slowUntilMs: 0, invertUntilMs: 0, freezeUntilMs: 0 }
        trapsRef.current = []
        clearTraps()

        const spawnY = 0.02
        runnerRef.current.position.set(0, spawnY, 0)
        runnerRef.current.velocity.set(0, 0, 0)
        runnerRef.current.grounded = false
        runnerBody.setTranslation(new RAPIER.Vector3(0, spawnY, 0), true)
        runnerBody.setLinvel(new RAPIER.Vector3(0, 0, 0), true)
        runnerBody.setAngvel(new RAPIER.Vector3(0, 0, 0), true)
        cdsRef.current = { slowReadyAtMs: t, invertReadyAtMs: t, pushReadyAtMs: t }
        runnerRoot.position.set(0, spawnY, 0)
        runnerRoot.updateMatrixWorld(true)
        cameraYaw = 0
        {
          const off = RUNNER_CAM_OFFSET_BASE.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), cameraYaw)
          const lookY = spawnY + RUNNER_CHEST_Y_ABOVE_FEET
          runnerCam.position.set(off.x, spawnY + off.y, off.z)
          runnerCam.lookAt(0, lookY, 0)
        }
        if (orbitDragPointerId !== null) {
          try {
            renderer.domElement.releasePointerCapture(orbitDragPointerId)
          } catch {
            /* ignore */
          }
          orbitDragPointerId = null
        }
        prevRunnerGrounded = true
        finishSoundLatchedRef.current = false
      }
      resetPhysicsFromHudRef.current = resetPhysics
      resetPhysics()

      const placeTrapAt = (worldPos: THREE.Vector3) => {
        const runner = runnerRef.current.position
        const minDist = 2.0
        if (worldPos.distanceTo(new THREE.Vector3(runner.x, worldPos.y, runner.z)) < minDist) return

        const activeCount = trapsRef.current.length
        if (activeCount >= 3) return

        const surfaceY = topSurfaceYAt(level, worldPos.x, worldPos.z)
        if (!Number.isFinite(surfaceY)) return

        const type = selectedTrapRef.current
        const trap: Trap = {
          id: crypto.randomUUID(),
          type,
          position: new THREE.Vector3(worldPos.x, surfaceY + 0.05, worldPos.z),
          placedAtMs: nowMs(),
          armDelayMs: 1500,
        }
        trapsRef.current = [...trapsRef.current, trap]
        audioRef.current.playCoin()

        const coinProto = (trapGroup.userData as { coin?: THREE.Object3D }).coin
        if (coinProto) {
          const obj = coinProto.clone(true)
          setAllMaterialsDoubleSided(obj)
          obj.position.copy(trap.position)
          obj.position.y += 0.35
          obj.scale.setScalar(type === 'spike' ? 1.1 : 1.0)
          ;(obj.userData as { trapId?: string }).trapId = trap.id
          trapGroup.add(obj)
        } else {
          const mesh =
            type === 'spike'
              ? new THREE.Mesh(
                  new THREE.ConeGeometry(0.5, 0.8, 6),
                  new THREE.MeshStandardMaterial({ color: 0xf97316, emissive: 0x3a1a06 }),
                )
              : new THREE.Mesh(
                  new THREE.CylinderGeometry(0.6, 0.6, 0.12, 24),
                  new THREE.MeshStandardMaterial({ color: 0x60a5fa, emissive: 0x0b1d3a }),
                )
          mesh.position.copy(trap.position)
          if (type === 'spike') mesh.position.y += 0.35
          ;(mesh.userData as { trapId?: string }).trapId = trap.id
          trapGroup.add(mesh)
        }

        // No Rapier colliders for traps: sensors were treated as movement obstacles by the
        // character controller, so the runner never entered the trigger volume. Hits use
        // `trapBallOverlapsRunnerCapsule` only.
      }

      const canvasEl = renderer.domElement
      canvasEl.style.touchAction = 'none'

      const onPointerDown = (e: PointerEvent) => {
        if (roleRef.current === 'watcher') {
          if (e.button !== 0) return
          watchCam.updateProjectionMatrix()
          watchCam.updateMatrixWorld(true)
          const rect = canvasEl.getBoundingClientRect()
          const x = ((e.clientX - rect.left) / rect.width) * 2 - 1
          const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1)
          raycaster.setFromCamera(new THREE.Vector2(x, y), watchCam)
          const p = new THREE.Vector3()
          if (raycaster.ray.intersectPlane(groundPlane, p)) placeTrapAt(p)
          return
        }
        if (roleRef.current === 'runner' && e.button === 0) {
          orbitDragPointerId = e.pointerId
          orbitLastClientX = e.clientX
          canvasEl.setPointerCapture(e.pointerId)
        }
      }

      const onPointerMove = (e: PointerEvent) => {
        if (orbitDragPointerId === null || e.pointerId !== orbitDragPointerId) return
        const dx = e.clientX - orbitLastClientX
        orbitLastClientX = e.clientX
        cameraYaw -= dx * RUNNER_CAM_MOUSE_SENS
      }

      const endOrbitDrag = (e: PointerEvent) => {
        if (orbitDragPointerId === null || e.pointerId !== orbitDragPointerId) return
        orbitDragPointerId = null
        try {
          canvasEl.releasePointerCapture(e.pointerId)
        } catch {
          /* already released */
        }
      }

      canvasEl.addEventListener('pointerdown', onPointerDown)
      canvasEl.addEventListener('pointermove', onPointerMove)
      canvasEl.addEventListener('pointerup', endOrbitDrag)
      canvasEl.addEventListener('pointercancel', endOrbitDrag)

      const resize = () => {
        const { width, height } = container.getBoundingClientRect()
        renderer.setSize(width, height, false)
        runnerCam.aspect = width / Math.max(height, 1)
        runnerCam.updateProjectionMatrix()

        const w = WATCH_HALF_WIDTH
        const h = (w * height) / Math.max(width, 1)
        watchCam.left = -w
        watchCam.right = w
        watchCam.top = h
        watchCam.bottom = -h
        watchCam.updateProjectionMatrix()
      }
      const ro = new ResizeObserver(resize)
      ro.observe(container)
      resize()

      let lastMs = nowMs()
      const tick = () => {
        const tMs = nowMs()
        const dt = Math.min(0.033, (tMs - lastMs) / 1000)
        lastMs = tMs
        setHudNowMs(tMs)

        // Arm trap colliders + visuals
        for (const child of trapGroup.children) {
          const trapId = (child.userData as { trapId?: string }).trapId
          const trap = trapsRef.current.find((x) => x.id === trapId)
          if (!trap) continue
          const armed = tMs - trap.placedAtMs >= trap.armDelayMs

          child.scale.setScalar(armed ? 1 : 0.75)
          if ((child as THREE.Mesh).isMesh) {
            const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial
            mat.opacity = armed ? 1 : 0.55
            mat.transparent = !armed
          }
        }

        if (runStateRef.current === 'running') {
          const debuff = debuffRef.current
          const slowFactor = tMs < debuff.slowUntilMs ? 0.55 : 1.0
          const invert = tMs < debuff.invertUntilMs
          const frozen = tMs < debuff.freezeUntilMs

          const input = inputRef.current
          const ix = (input.right ? 1 : 0) - (input.left ? 1 : 0)
          const iz = (input.back ? 1 : 0) - (input.forward ? 1 : 0)
          const mx = invert ? -ix : ix
          const mz = invert ? -iz : iz

          // Camera-relative WASD: forward = view toward runner on XZ, strafe = right.
          const rPre = runnerRef.current.position
          const camTargetForMove = new THREE.Vector3(
            rPre.x,
            rPre.y + RUNNER_CHEST_Y_ABOVE_FEET,
            rPre.z,
          )
          const camOff = RUNNER_CAM_OFFSET_BASE.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), cameraYaw)
          const camDesired = new THREE.Vector3(rPre.x + camOff.x, rPre.y + camOff.y, rPre.z + camOff.z)
          const forward = camTargetForMove.clone().sub(camDesired)
          forward.y = 0
          if (forward.lengthSq() < 1e-8) forward.set(0, 0, -1)
          else forward.normalize()
          const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize()

          const move = forward.clone().multiplyScalar(-mz).add(right.clone().multiplyScalar(mx))
          if (move.lengthSq() > 0) move.normalize()

          const runner = runnerRef.current
          if (frozen) {
            runner.velocity.x = THREE.MathUtils.lerp(runner.velocity.x, 0, 0.35)
            runner.velocity.z = THREE.MathUtils.lerp(runner.velocity.z, 0, 0.35)
          } else {
            const speed = 6.0 * slowFactor
            runner.velocity.x = THREE.MathUtils.lerp(runner.velocity.x, move.x * speed, 0.22)
            runner.velocity.z = THREE.MathUtils.lerp(runner.velocity.z, move.z * speed, 0.22)
          }

          runner.velocity.y -= 18 * dt
          if (!frozen && runner.grounded && input.jumpQueued) {
            audioRef.current.playJump()
            runner.velocity.y = 7.5
          }
          input.jumpQueued = false

          const desired = new RAPIER.Vector3(runner.velocity.x * dt, runner.velocity.y * dt, runner.velocity.z * dt)
          controller.computeColliderMovement(
            runnerCollider,
            desired,
            RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
          )
          const corr = controller.computedMovement()
          const cur = runnerBody.translation()
          runnerBody.setNextKinematicTranslation(new RAPIER.Vector3(cur.x + corr.x, cur.y + corr.y, cur.z + corr.z))

          runner.grounded = controller.computedGrounded()
          if (runner.grounded && runner.velocity.y < 0) runner.velocity.y = 0

          if (!prevRunnerGrounded && runner.grounded) audioRef.current.playLand()
          prevRunnerGrounded = runner.grounded
        } else {
          prevRunnerGrounded = runnerRef.current.grounded
        }

        world.step()

        const tr = runnerBody.translation()
        runnerRef.current.position.set(tr.x, tr.y, tr.z)

        // Triggers
        if (runStateRef.current === 'running') {
          if (
            !finishSoundLatchedRef.current &&
            trapBallOverlapsRunnerCapsule(
              finishRef.current.center.x,
              finishMesh.position.y,
              finishRef.current.center.z,
              finishRef.current.radius,
              tr.x,
              tr.y,
              tr.z,
            )
          ) {
            finishSoundLatchedRef.current = true
            audioRef.current.playCoin()
            setRunStateSyncedRef.current('finished')
            setRunEndMs(tMs)
          }

          const trapsHit: Trap[] = []
          for (const trap of trapsRef.current) {
            if (tMs - trap.placedAtMs < trap.armDelayMs) continue
            const ballR = trap.type === 'spike' ? TRAP_SPIKE_BALL_R : TRAP_SLOW_BALL_R
            if (
              !trapBallOverlapsRunnerCapsule(trap.position.x, trap.position.y, trap.position.z, ballR, tr.x, tr.y, tr.z)
            )
              continue
            trapsHit.push(trap)
          }
          for (const trap of trapsHit) {
            removeTrapById(trap.id)
            if (trap.type === 'spike') {
              audioRef.current.playBreak()
              debuffRef.current.freezeUntilMs = Math.max(debuffRef.current.freezeUntilMs, tMs + SPIKE_FREEZE_MS)
            } else {
              debuffRef.current.slowUntilMs = Math.max(debuffRef.current.slowUntilMs, tMs + 2500)
            }
          }

          if (runnerRef.current.position.y < -6) {
            setRunStateSyncedRef.current('idle')
            setRunStartMs(0)
            setRunEndMs(0)
            resetPhysics('void')
          }
        }

        // Runner visual = physics body center (children handle model pivot vs. capsule).
        const rPos = runnerRef.current.position
        runnerRoot.position.copy(rPos)
        const hv = runnerRef.current.velocity
        if (hv.x * hv.x + hv.z * hv.z > 0.04) {
          runnerRoot.rotation.y = Math.atan2(hv.x, hv.z)
        }
        runnerRoot.updateMatrixWorld(true)

        if (roleRef.current === 'runner') {
          canvasEl.style.cursor = orbitDragPointerId !== null ? 'grabbing' : 'grab'
          const camTarget = new THREE.Vector3(rPos.x, rPos.y + RUNNER_CHEST_Y_ABOVE_FEET, rPos.z)
          const off = RUNNER_CAM_OFFSET_BASE.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), cameraYaw)
          const camPos = new THREE.Vector3(rPos.x + off.x, rPos.y + off.y, rPos.z + off.z)
          runnerCam.position.lerp(camPos, 0.18)
          runnerCam.lookAt(camTarget)
        } else {
          canvasEl.style.cursor = 'default'
        }

        watchCam.position.set(WATCH_LEVEL_CENTER.x, 20, WATCH_LEVEL_CENTER.z - 2)
        watchCam.lookAt(WATCH_LEVEL_CENTER.x, 0, WATCH_LEVEL_CENTER.z)

        renderer.render(scene, roleRef.current === 'watcher' ? watchCam : runnerCam)
        raf = window.requestAnimationFrame(tick)
      }
      tick()

      return () => {
        resetPhysicsFromHudRef.current = () => {}
        window.cancelAnimationFrame(raf)
        ro.disconnect()
        canvasEl.removeEventListener('pointerdown', onPointerDown)
        canvasEl.removeEventListener('pointermove', onPointerMove)
        canvasEl.removeEventListener('pointerup', endOrbitDrag)
        canvasEl.removeEventListener('pointercancel', endOrbitDrag)
        clearTraps()
        world.free()
        renderer.dispose()
        container.removeChild(renderer.domElement)
      }
    }

    let cleanup: (() => void) | undefined
    start()
      .then((c) => {
        cleanup = c
        if (cancelled) cleanup?.()
      })
      .catch((err) => {
        console.error('[ThreeCanvas] Failed to initialize scene / physics', err)
      })

    return () => {
      cancelled = true
      cleanup?.()
    }
  }, [level])

  const startRun = () => {
    if (runState === 'running') return
    finishSoundLatchedRef.current = false
    const t = nowMs()
    setRunStateSyncedRef.current('running')
    setRunStartMs(t)
    setRunEndMs(0)
  }

  const resetRun = () => {
    const t = nowMs()
    setRunStateSyncedRef.current('idle')
    setRunStartMs(0)
    setRunEndMs(0)
    debuffRef.current = { slowUntilMs: 0, invertUntilMs: 0, freezeUntilMs: 0 }
    cdsRef.current = { slowReadyAtMs: t, invertReadyAtMs: t, pushReadyAtMs: t }
    resetPhysicsFromHudRef.current()
  }

  const elapsedMs =
    runState === 'running'
      ? hudNowMs - runStartMs
      : runState === 'finished'
        ? runEndMs - runStartMs
        : 0

  const can = (readyAt: number) => hudNowMs >= readyAt

  const castSlow = () => {
    const cd = 7000
    const dur = 3500
    if (role !== 'watcher') return
    if (!can(cdsRef.current.slowReadyAtMs)) return
    audio.playBreak()
    debuffRef.current.slowUntilMs = Math.max(debuffRef.current.slowUntilMs, nowMs() + dur)
    cdsRef.current.slowReadyAtMs = nowMs() + cd
  }

  const castInvert = () => {
    const cd = 11000
    const dur = 2800
    if (role !== 'watcher') return
    if (!can(cdsRef.current.invertReadyAtMs)) return
    audio.playBreak()
    debuffRef.current.invertUntilMs = Math.max(debuffRef.current.invertUntilMs, nowMs() + dur)
    cdsRef.current.invertReadyAtMs = nowMs() + cd
  }

  const castPush = () => {
    const cd = 9000
    if (role !== 'watcher') return
    if (!can(cdsRef.current.pushReadyAtMs)) return
    audio.playBreak()
    runnerRef.current.velocity.x += 6
    runnerRef.current.velocity.z -= 6
    cdsRef.current.pushReadyAtMs = nowMs() + cd
  }

  return (
    <>
      <div className="threeContainer" ref={containerRef} />

      <header className="hud">
        <div className="title">Rival Race</div>
        <div className="subtitle">
          Role: <b>{role.toUpperCase()}</b> • Run: <b>{runState.toUpperCase()}</b>
        </div>
        <div className="hudRow">
          <span className="pill">Time: {formatTime(elapsedMs)}</span>
          <button className="button" onClick={startRun} disabled={runState === 'running'}>
            Start run
          </button>
          <button className="button" onClick={resetRun}>
            Reset
          </button>
          <span className="pill">Press TAB to swap roles</span>
        </div>
        <div className="hotkeys">
          Course: small pads with gaps (~2.5 m) — jump pad to pad toward the flag (+X). Runner: WASD + Space, drag to
          orbit • Watcher: traps / abilities.
        </div>
      </header>

      {role === 'watcher' && (
        <aside className="watcherPanel">
          <div className="panelTitle">Watcher tools</div>
          <div className="panelGrid">
            <button className="button" onClick={() => setSelectedTrap('spike')} disabled={selectedTrap === 'spike'}>
              Trap: Spike → freeze (1.5s arm)
            </button>
            <button className="button" onClick={() => setSelectedTrap('slow')} disabled={selectedTrap === 'slow'}>
              Trap: Slow pad (1.5s arm, one-shot)
            </button>
            <button className="button" onClick={castSlow} disabled={!can(cdsRef.current.slowReadyAtMs)}>
              Slow ({Math.ceil(clamp((cdsRef.current.slowReadyAtMs - hudNowMs) / 1000, 0, 99))}s)
            </button>
            <button className="button" onClick={castInvert} disabled={!can(cdsRef.current.invertReadyAtMs)}>
              Invert ({Math.ceil(clamp((cdsRef.current.invertReadyAtMs - hudNowMs) / 1000, 0, 99))}s)
            </button>
            <button className="button" onClick={castPush} disabled={!can(cdsRef.current.pushReadyAtMs)}>
              Push ({Math.ceil(clamp((cdsRef.current.pushReadyAtMs - hudNowMs) / 1000, 0, 99))}s)
            </button>
            <span className="pill">Traps active: {trapsRef.current.length}/3</span>
          </div>
          <div className="panelHint">Click anywhere on the level to place a trap. You can’t place within ~2m of the runner.</div>
        </aside>
      )}
    </>
  )
}

