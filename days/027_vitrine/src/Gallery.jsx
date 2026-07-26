import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { PLATES, PLATE_ASPECT, drawPlate } from './plates.js'
import { makePlateMaterial } from './PlateMaterial.js'

const PAPER = '#ede7da'
const N = PLATES.length

// ---------------------------------------------------------------------------
// The arc. This is the piece of the reference implementation worth stealing
// exactly: instead of laying planes on a straight line, solve for the circle
// that sags by `bend` at the edge of the viewport and ride it. Every plate's
// y, z and rotation come from one radius.
//
//   R = (halfWidth² + bend²) / (2·bend)
//
// At x = 0 the arc offset is 0 (dead centre, undistorted); at x = ±halfWidth it
// is exactly `bend`. Nothing to tune per screen size — it re-solves on resize.
// ---------------------------------------------------------------------------
function arcAt(x, halfW, bend) {
  const R = (halfW * halfW + bend * bend) / (2 * bend)
  const ex = Math.min(Math.abs(x), halfW)
  const drop = R - Math.sqrt(Math.max(0, R * R - ex * ex))
  const theta = Math.asin(Math.min(1, ex / R))
  return { drop, theta, sign: Math.sign(x) || 1 }
}

export default function Gallery({ onActive }) {
  const { viewport, gl, clock } = useThree()

  // ?drift=N multiplies the idle auto-scroll. The velocity distortion only
  // exists while the strip is moving fast, and a headless --screenshot can
  // neither drag nor flick — so ?drift=40 is how the fold and the chromatic
  // split get verified in a still (same trick as Day 023's ?grade / Day 025's ?t).
  // ?speed=-1..1 pins the velocity uniforms outright, which is the only way to
  // see the fold and the chromatic split in a still frame.
  const dbg = useMemo(() => {
    const q = new URLSearchParams(window.location.search)
    const drift = parseFloat(q.get('drift'))
    const speed = parseFloat(q.get('speed'))
    return {
      driftMul: Number.isFinite(drift) && drift > 0 ? drift : 1,
      speed: Number.isFinite(speed) ? THREE.MathUtils.clamp(speed, -1, 1) : null,
    }
  }, [])

  // --- textures: ten posters drawn once, uploaded once ----------------------
  const textures = useMemo(() => {
    return PLATES.map((_, i) => {
      const tex = new THREE.CanvasTexture(drawPlate(i))
      // raw sRGB bytes in; the shader linearises with pow(2.2) itself so the
      // <Canvas flat> pipeline stays single-conversion (project convention)
      tex.colorSpace = THREE.NoColorSpace
      tex.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy())
      tex.minFilter = THREE.LinearMipmapLinearFilter
      tex.magFilter = THREE.LinearFilter
      tex.generateMipmaps = true
      tex.needsUpdate = true
      return tex
    })
  }, [gl])

  useEffect(() => () => textures.forEach((t) => t.dispose()), [textures])

  // --- layout, re-solved whenever the viewport changes ----------------------
  const layout = useMemo(() => {
    const halfW = viewport.width / 2
    const planeW = viewport.width * 0.203
    const planeH = planeW / PLATE_ASPECT
    const gap = planeW * 0.19
    const step = planeW + gap
    return {
      halfW,
      planeW,
      planeH,
      step,
      total: step * N,
      bend: halfW * 0.28,
    }
  }, [viewport.width])

  const materials = useMemo(
    () =>
      textures.map((t) =>
        makePlateMaterial(
          t,
          [layout.planeW, layout.planeH],
          [PLATE_ASPECT, 1],
          PAPER,
        ),
      ),
    [textures], // eslint-disable-line react-hooks/exhaustive-deps
  )
  useEffect(() => () => materials.forEach((m) => m.dispose()), [materials])

  useLayoutEffect(() => {
    for (const m of materials) {
      m.uniforms.uPlaneSize.value.set(layout.planeW, layout.planeH)
    }
  }, [materials, layout])

  const meshes = useRef([])

  // --- transport ------------------------------------------------------------
  // one number (`current`) is the whole state of the gallery. Drag, wheel,
  // flick inertia and the idle auto-drift all write to `target`; `current`
  // chases it with a frame-rate independent damp, and the difference between
  // successive `current` values *is* the velocity the shaders consume.
  const t = useRef({
    current: 0,
    target: 0,
    prev: 0,
    speed: 0,
    speedSigned: 0,
    dragging: false,
    startX: 0,
    startTarget: 0,
    lastX: 0,
    fling: 0,
    idle: 0,
    born: -1,
  })
  const activeRef = useRef(-1)

  useEffect(() => {
    const el = gl.domElement
    const s = t.current

    const px2world = () => viewport.width / el.clientWidth

    const down = (e) => {
      s.dragging = true
      s.startX = e.clientX
      s.lastX = e.clientX
      s.startTarget = s.target
      s.fling = 0
      s.idle = 0
      el.setPointerCapture?.(e.pointerId)
      el.style.cursor = 'grabbing'
    }
    const move = (e) => {
      if (!s.dragging) return
      const d = (e.clientX - s.startX) * px2world() * 1.15
      s.target = s.startTarget - d
      s.fling = (e.clientX - s.lastX) * px2world()
      s.lastX = e.clientX
    }
    const up = (e) => {
      if (!s.dragging) return
      s.dragging = false
      s.target -= s.fling * 9 // inertia from the flick
      el.releasePointerCapture?.(e.pointerId)
      el.style.cursor = 'grab'
    }
    const wheel = (e) => {
      e.preventDefault()
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1
      s.target += e.deltaY * unit * px2world() * 1.1
      s.idle = 0
    }

    el.style.cursor = 'grab'
    el.style.touchAction = 'none'
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('pointerleave', up)
    el.addEventListener('wheel', wheel, { passive: false })
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.removeEventListener('pointerleave', up)
      el.removeEventListener('wheel', wheel)
    }
  }, [gl, viewport.width])

  useFrame((_, rawDelta) => {
    const s = t.current
    const dt = Math.min(rawDelta, 1 / 20)
    const time = clock.elapsedTime
    if (s.born < 0) s.born = time
    const age = time - s.born
    const { halfW, planeW, planeH, step, total, bend } = layout

    // idle auto-drift: the strip is never quite still, which is what makes an
    // infinite gallery read as infinite before you touch it
    s.idle = s.dragging ? 0 : s.idle + dt
    const warm = dbg.driftMul > 1 ? 0 : 0.9 // debug drift skips the idle wait
    if (s.idle > warm) {
      s.target +=
        step * 0.085 * dbg.driftMul * dt * Math.min(1, (s.idle - warm) * 1.5 + 0.02)
    }

    s.prev = s.current
    s.current = THREE.MathUtils.damp(s.current, s.target, 4.2, dt)

    const raw = (s.current - s.prev) / Math.max(dt, 1e-4)
    const norm = THREE.MathUtils.clamp(raw / (step * 5.0), -1, 1)
    s.speedSigned =
      dbg.speed !== null
        ? dbg.speed
        : THREE.MathUtils.damp(s.speedSigned, norm, 9, dt)
    s.speed = Math.abs(s.speedSigned)

    // which plate holds the centre
    const idx = ((Math.round(s.current / step) % N) + N) % N
    if (idx !== activeRef.current) {
      activeRef.current = idx
      onActive?.(idx)
    }

    for (let i = 0; i < N; i++) {
      const mesh = meshes.current[i]
      if (!mesh) continue

      // --- infinite wrap ---------------------------------------------------
      // Fold the raw position into [-total/2, total/2) with one modulo. The
      // strip is ~2.4× the viewport, so the teleport at ±total/2 always happens
      // far off screen — no direction bookkeeping, no drift, correct after any
      // jump (a fast flick can cross several strip lengths in one frame, which
      // is exactly where accumulate-an-offset schemes fall apart).
      const half = total / 2
      const lin = i * step - s.current
      const x = (((lin + half) % total) + total) % total - half

      const { drop, theta, sign } = arcAt(x, halfW, bend)

      const dist = THREE.MathUtils.clamp(Math.abs(x) / halfW, 0, 1)
      const reveal = THREE.MathUtils.clamp((age - dist * 0.5) / 0.85, 0, 1)
      const focus = 1 - THREE.MathUtils.clamp(Math.abs(x) / (step * 0.9), 0, 1)

      mesh.position.x = x
      mesh.position.y = -drop * 0.5
      // the held plate steps a little nearer — a depth hierarchy so the eye
      // knows where the centre of the room is even mid-drag
      mesh.position.z = -drop * 1.15 + focus * 0.3
      mesh.rotation.z = -sign * theta * 0.42
      mesh.rotation.y = sign * theta * 0.72

      const grow = (0.9 + 0.1 * reveal) * (1 + focus * 0.025)
      mesh.scale.set(planeW * grow, planeH * grow, 1)

      const u = materials[i].uniforms
      u.uTime.value = time
      u.uSpeed.value = s.speed
      u.uSpeedSigned.value = s.speedSigned
      u.uDim.value = Math.pow(dist, 1.35)
      u.uReveal.value = reveal
      u.uFocus.value = focus
    }
  })

  return (
    // lifted off dead-centre so the fan clears the headline block below
    <group position={[0, viewport.height * 0.11, 0]}>
      {PLATES.map((p, i) => (
        <mesh
          key={p.title}
          ref={(el) => (meshes.current[i] = el)}
          material={materials[i]}
          frustumCulled={false}
        >
          {/* unit plane; the mesh scale carries the real size, so the shader
              can work in normalised -0.5..0.5 coordinates */}
          <planeGeometry args={[1, 1, 40, 40]} />
        </mesh>
      ))}
    </group>
  )
}
