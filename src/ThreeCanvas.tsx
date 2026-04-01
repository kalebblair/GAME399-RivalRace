import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

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

export function ThreeCanvas() {
  const containerRef = useRef<HTMLDivElement | null>(null)

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
  useEffect(() => {
    runStateRef.current = runState
  }, [runState])

  const [runStartMs, setRunStartMs] = useState(0)
  const [runEndMs, setRunEndMs] = useState(0)
  const [hudNowMs, setHudNowMs] = useState(() => nowMs())

  const trapsRef = useRef<Trap[]>([])
  const debuffRef = useRef<Debuff>({ slowUntilMs: 0, invertUntilMs: 0 })
  const cdsRef = useRef<Cooldowns>({ slowReadyAtMs: 0, invertReadyAtMs: 0, pushReadyAtMs: 0 })

  const inputRef = useRef({
    forward: false,
    back: false,
    left: false,
    right: false,
    jumpQueued: false,
  })

  const runnerRef = useRef({
    position: new THREE.Vector3(0, 1.0, 0),
    velocity: new THREE.Vector3(0, 0, 0),
    grounded: false,
  })

  const finishRef = useRef({
    center: new THREE.Vector3(18, 1.0, -10),
    radius: 1.2,
  })

  const level = useMemo<LevelBox[]>(
    () => [
      { id: 'ground', min: new THREE.Vector3(-6, -0.5, -6), max: new THREE.Vector3(6, 0, 6), color: 0x1f2a44 },
      { id: 'p1', min: new THREE.Vector3(2, 0.4, 1), max: new THREE.Vector3(6, 0.8, 4), color: 0x22335a },
      { id: 'p2', min: new THREE.Vector3(6.5, 0.9, -1.5), max: new THREE.Vector3(10.5, 1.3, 1.2), color: 0x22335a },
      { id: 'p3', min: new THREE.Vector3(10.8, 1.4, -5.2), max: new THREE.Vector3(14.8, 1.8, -2.0), color: 0x22335a },
      { id: 'p4', min: new THREE.Vector3(14.5, 1.9, -9.2), max: new THREE.Vector3(19.5, 2.3, -6.2), color: 0x22335a },
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
      dir.position.set(6, 10, 6)
      dir.castShadow = true
      scene.add(dir)

      const grid = new THREE.GridHelper(80, 80, 0x3b82f6, 0x111827)
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

      const runnerMesh = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.35, 0.6, 8, 16),
        new THREE.MeshStandardMaterial({ color: 0xff3b7a, metalness: 0.15, roughness: 0.35 }),
      )
      runnerMesh.castShadow = true
      scene.add(runnerMesh)
      // Tick loop updates this; swaps to Kenney `character.glb` when loaded.
      let runnerVisual: THREE.Object3D = runnerMesh

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

        const platformForId = (id: string) => {
          if (id === 'ground') return platformLarge.scene
          if (id === 'p1') return platformLarge.scene
          if (id === 'p2') return platformMedium.scene
          if (id === 'p3') return platformMedium.scene
          return platformLarge.scene
        }

        for (const p of levelPlaceholders) {
          const model = platformForId(p.id).clone(true)
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

        // Runner character
        const charObj = character.scene
        setAllMaterialsDoubleSided(charObj)
        charObj.scale.setScalar(0.9)
        charObj.traverse((c) => {
          if ((c as THREE.Mesh).isMesh) {
            ;(c as THREE.Mesh).castShadow = true
            ;(c as THREE.Mesh).receiveShadow = false
          }
        })
        scene.add(charObj)
        scene.remove(runnerMesh)
        runnerMesh.geometry.dispose()
        ;(runnerMesh.material as THREE.Material).dispose()
        runnerVisual = charObj
        charObj.position.copy(runnerRef.current.position)

        // Finish marker
        const flagObj = flag.scene
        setAllMaterialsDoubleSided(flagObj)
        flagObj.position.copy(finishMesh.position)
        flagObj.position.y -= 0.15
        flagObj.scale.setScalar(1.2)
        scene.add(flagObj)
        finishMesh.visible = false

        // Small decoration: a few clouds
        for (let i = 0; i < 5; i++) {
          const c = cloud.scene.clone(true)
          c.position.set(-10 + i * 7, 7 + (i % 2) * 1.2, -12 + (i % 3) * 5)
          c.scale.setScalar(2.2)
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
        RAPIER.ColliderDesc.capsule(0.45, 0.35).setFriction(0.0),
        runnerBody,
      )

      const controller = world.createCharacterController(0.01)
      controller.setApplyImpulsesToDynamicBodies(false)
      controller.enableAutostep(0.35, 0.2, true)
      controller.setMaxSlopeClimbAngle((55 * Math.PI) / 180)
      controller.setMinSlopeSlideAngle((60 * Math.PI) / 180)

      const finishRB = world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(finishRef.current.center.x, finishMesh.position.y, finishRef.current.center.z),
      )
      const finishCollider = world.createCollider(RAPIER.ColliderDesc.ball(finishRef.current.radius).setSensor(true), finishRB)

      const trapColliderById = new Map<string, RAPIER.Collider>()

      const raycaster = new THREE.Raycaster()
      const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

      const clearTraps = () => {
        for (const c of trapColliderById.values()) world.removeCollider(c, true)
        trapColliderById.clear()
        while (trapGroup.children.length) trapGroup.remove(trapGroup.children[0]!)
      }

      const resetPhysics = () => {
        const t = nowMs()
        debuffRef.current = { slowUntilMs: 0, invertUntilMs: 0 }
        trapsRef.current = []
        clearTraps()

        runnerRef.current.position.set(0, 1.0, 0)
        runnerRef.current.velocity.set(0, 0, 0)
        runnerRef.current.grounded = false
        runnerBody.setTranslation(new RAPIER.Vector3(0, 1.0, 0), true)
        runnerBody.setLinvel(new RAPIER.Vector3(0, 0, 0), true)
        runnerBody.setAngvel(new RAPIER.Vector3(0, 0, 0), true)
        cdsRef.current = { slowReadyAtMs: t, invertReadyAtMs: t, pushReadyAtMs: t }
      }
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

        const rb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(trap.position.x, trap.position.y, trap.position.z))
        const col = (type === 'spike' ? RAPIER.ColliderDesc.ball(0.55) : RAPIER.ColliderDesc.ball(0.7)).setSensor(true)
        const collider = world.createCollider(col, rb)
        collider.setEnabled(false)
        trapColliderById.set(trap.id, collider)
      }

      const onPointerDown = (e: PointerEvent) => {
        if (roleRef.current !== 'watcher') return
        const rect = renderer.domElement.getBoundingClientRect()
        const x = ((e.clientX - rect.left) / rect.width) * 2 - 1
        const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1)
        raycaster.setFromCamera(new THREE.Vector2(x, y), watchCam)
        const p = new THREE.Vector3()
        if (raycaster.ray.intersectPlane(groundPlane, p)) placeTrapAt(p)
      }
      renderer.domElement.addEventListener('pointerdown', onPointerDown)

      const resize = () => {
        const { width, height } = container.getBoundingClientRect()
        renderer.setSize(width, height, false)
        runnerCam.aspect = width / Math.max(height, 1)
        runnerCam.updateProjectionMatrix()

        const w = 12
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
          const col = trapColliderById.get(trapId!)
          if (armed && col && !col.isEnabled()) col.setEnabled(true)

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

          const input = inputRef.current
          const ix = (input.right ? 1 : 0) - (input.left ? 1 : 0)
          const iz = (input.back ? 1 : 0) - (input.forward ? 1 : 0)
          const mx = invert ? -ix : ix
          const mz = invert ? -iz : iz

          const move = new THREE.Vector3(mx, 0, mz)
          if (move.lengthSq() > 0) move.normalize()

          const runner = runnerRef.current
          const speed = 6.0 * slowFactor
          runner.velocity.x = THREE.MathUtils.lerp(runner.velocity.x, move.x * speed, 0.22)
          runner.velocity.z = THREE.MathUtils.lerp(runner.velocity.z, move.z * speed, 0.22)

          runner.velocity.y -= 18 * dt
          if (runner.grounded && input.jumpQueued) runner.velocity.y = 7.5
          input.jumpQueued = false

          const desired = new RAPIER.Vector3(runner.velocity.x * dt, runner.velocity.y * dt, runner.velocity.z * dt)
          controller.computeColliderMovement(runnerCollider, desired)
          const corr = controller.computedMovement()
          const cur = runnerBody.translation()
          runnerBody.setNextKinematicTranslation(new RAPIER.Vector3(cur.x + corr.x, cur.y + corr.y, cur.z + corr.z))

          runner.grounded = controller.computedGrounded()
          if (runner.grounded && runner.velocity.y < 0) runner.velocity.y = 0
        }

        world.step()

        const tr = runnerBody.translation()
        runnerRef.current.position.set(tr.x, tr.y, tr.z)

        // Triggers
        if (runStateRef.current === 'running') {
          if (world.intersectionPair(runnerCollider, finishCollider)) {
            setRunState('finished')
            setRunEndMs(tMs)
          }

          for (const trap of trapsRef.current) {
            if (tMs - trap.placedAtMs < trap.armDelayMs) continue
            const col = trapColliderById.get(trap.id)
            if (!col || !col.isEnabled()) continue
            if (!world.intersectionPair(runnerCollider, col)) continue

            if (trap.type === 'spike') {
              setRunState('idle')
              setRunStartMs(0)
              setRunEndMs(0)
              resetPhysics()
              break
            }
            if (trap.type === 'slow') {
              debuffRef.current.slowUntilMs = Math.max(debuffRef.current.slowUntilMs, tMs + 2500)
            }
          }

          if (runnerRef.current.position.y < -6) {
            setRunState('idle')
            setRunStartMs(0)
            setRunEndMs(0)
            resetPhysics()
          }
        }

        // Cameras
        const rPos = runnerRef.current.position
        runnerVisual.position.copy(rPos)

        const camTarget = new THREE.Vector3(rPos.x, rPos.y + 0.35, rPos.z)
        const camPos = new THREE.Vector3(rPos.x - 4.0, rPos.y + 3.0, rPos.z + 4.2)
        runnerCam.position.lerp(camPos, 0.18)
        runnerCam.lookAt(camTarget)

        watchCam.position.set(7, 18, -2)
        watchCam.lookAt(new THREE.Vector3(7, 0, -2))

        renderer.render(scene, roleRef.current === 'watcher' ? watchCam : runnerCam)
        raf = window.requestAnimationFrame(tick)
      }
      tick()

      return () => {
        window.cancelAnimationFrame(raf)
        ro.disconnect()
        renderer.domElement.removeEventListener('pointerdown', onPointerDown)
        clearTraps()
        world.free()
        renderer.dispose()
        container.removeChild(renderer.domElement)
      }
    }

    let cleanup: (() => void) | undefined
    start().then((c) => {
      cleanup = c
      if (cancelled) cleanup?.()
    })

    return () => {
      cancelled = true
      cleanup?.()
    }
  }, [level])

  const startRun = () => {
    if (runState === 'running') return
    const t = nowMs()
    setRunState('running')
    setRunStartMs(t)
    setRunEndMs(0)
  }

  const resetRun = () => {
    const t = nowMs()
    setRunState('idle')
    setRunStartMs(0)
    setRunEndMs(0)
    debuffRef.current = { slowUntilMs: 0, invertUntilMs: 0 }
    trapsRef.current = []
    runnerRef.current.position.set(0, 1.0, 0)
    runnerRef.current.velocity.set(0, 0, 0)
    runnerRef.current.grounded = false
    cdsRef.current = { slowReadyAtMs: t, invertReadyAtMs: t, pushReadyAtMs: t }
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
    debuffRef.current.slowUntilMs = Math.max(debuffRef.current.slowUntilMs, nowMs() + dur)
    cdsRef.current.slowReadyAtMs = nowMs() + cd
  }

  const castInvert = () => {
    const cd = 11000
    const dur = 2800
    if (role !== 'watcher') return
    if (!can(cdsRef.current.invertReadyAtMs)) return
    debuffRef.current.invertUntilMs = Math.max(debuffRef.current.invertUntilMs, nowMs() + dur)
    cdsRef.current.invertReadyAtMs = nowMs() + cd
  }

  const castPush = () => {
    const cd = 9000
    if (role !== 'watcher') return
    if (!can(cdsRef.current.pushReadyAtMs)) return
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
        <div className="hotkeys">Runner: WASD + Space • Watcher: click to place trap (top-down), use abilities.</div>
      </header>

      {role === 'watcher' && (
        <aside className="watcherPanel">
          <div className="panelTitle">Watcher tools</div>
          <div className="panelGrid">
            <button className="button" onClick={() => setSelectedTrap('spike')} disabled={selectedTrap === 'spike'}>
              Trap: Spike (1.5s arm)
            </button>
            <button className="button" onClick={() => setSelectedTrap('slow')} disabled={selectedTrap === 'slow'}>
              Trap: Slow pad (1.5s arm)
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

