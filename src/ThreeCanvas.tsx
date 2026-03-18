import { useEffect, useRef } from 'react'
import * as THREE from 'three'

export function ThreeCanvas() {
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    container.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0b1020)

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000)
    camera.position.set(0, 1.2, 3.2)

    const ambient = new THREE.AmbientLight(0xffffff, 0.6)
    scene.add(ambient)

    const dir = new THREE.DirectionalLight(0xffffff, 1.0)
    dir.position.set(2, 3, 4)
    scene.add(dir)

    const grid = new THREE.GridHelper(20, 20, 0x3b82f6, 0x1f2a44)
    ;(grid.material as THREE.Material).transparent = true
    ;(grid.material as THREE.Material).opacity = 0.35
    scene.add(grid)

    const cube = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0xff3b7a, metalness: 0.2, roughness: 0.4 }),
    )
    cube.position.y = 0.5
    scene.add(cube)

    const resize = () => {
      const { width, height } = container.getBoundingClientRect()
      renderer.setSize(width, height, false)
      camera.aspect = width / Math.max(height, 1)
      camera.updateProjectionMatrix()
    }

    const ro = new ResizeObserver(resize)
    ro.observe(container)
    resize()

    let raf = 0
    const clock = new THREE.Clock()
    const tick = () => {
      const t = clock.getElapsedTime()
      cube.rotation.set(t * 0.6, t * 0.9, 0)
      renderer.render(scene, camera)
      raf = window.requestAnimationFrame(tick)
    }
    tick()

    return () => {
      window.cancelAnimationFrame(raf)
      ro.disconnect()
      renderer.dispose()
      container.removeChild(renderer.domElement)
      cube.geometry.dispose()
      ;(cube.material as THREE.Material).dispose()
    }
  }, [])

  return <div className="threeContainer" ref={containerRef} />
}

