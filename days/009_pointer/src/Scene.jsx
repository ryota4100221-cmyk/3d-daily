import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { Environment, Lightformer } from '@react-three/drei'

// ── Day 009 · Week II — Motion & Interaction — "Attend" ──────────────────────
// The curriculum's pointer-follow day. Rather than tilt one hero object toward
// the mouse, the whole scene *attends* to it: a field of ~1,560 slender rods,
// drawn in a single InstancedMesh, each leans toward the cursor's position on
// the ground like iron filings to a magnet — standing taller and warming to
// terracotta as the pointer nears, settling back to a quiet bone field as it
// leaves. This extends the instancing of Day 005/007 into a *responsive* field,
// exactly the "1D phase-wave → 2D surface" step Day 008's notes proposed.
//
// The three new techniques for today (all pointer-driven):
//   1. RAYCAST-TO-GROUND — the pointer is NDC (−1..1); each frame we cast a ray
//      from the camera through it and intersect a y=0 plane to get a real
//      *world* point the rods can orient toward. (state.pointer alone can't do
//      this — it has no depth.)
//   2. DAMPED FOLLOW — that world point is chased with THREE.MathUtils.damp so
//      the field trails the cursor with weight instead of snapping, and the
//      motion is identical at any refresh rate (the Day-008 habit, now applied
//      to input rather than a clock).
//   3. PER-INSTANCE ORIENT + LIVE COLOUR — every frame each rod computes its
//      own lean axis (⊥ to the cursor direction) and a Gaussian proximity
//      influence, then writes both a matrix AND a colour into the instance
//      buffers. One draw call, 1,560 independently-aimed elements.

// Field layout. It deliberately over-fills the frame and bleeds off the edges,
// dissolving into fog at the back — an "endless field" that feels immersive
// rather than a boxed diagram.
const COLS = 46
const ROWS = 34
const COUNT = COLS * ROWS
const GAP = 0.44
const FIELD_W = (COLS - 1) * GAP
const FIELD_D = (ROWS - 1) * GAP

const SIGMA = 2.6 // world-space radius of the cursor's influence
const MAX_LEAN = 1.2 // radians a rod tips when the cursor is right on it
const LIFT = 1.9 // how much taller a rod grows at full influence

// Cheap deterministic hash for organic jitter / phase (no Math.random needed).
const hash = (n) => {
  const s = Math.sin(n * 127.1) * 43758.5453123
  return s - Math.floor(s)
}

function Field({ follow }) {
  const mesh = useRef()
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const dir = useMemo(() => new THREE.Vector3(), [])
  const axis = useMemo(() => new THREE.Vector3(), [])
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), [])
  const colBone = useMemo(() => new THREE.Color('#d8d2c5'), [])
  const colWarm = useMemo(() => new THREE.Color('#c1673f'), [])
  const tmpCol = useMemo(() => new THREE.Color(), [])

  // Thin capsule, geometry translated so its pivot sits at the BASE — leaning
  // then tips the rod about the ground, not about its own centre (which would
  // sink half of it below the floor).
  const geo = useMemo(() => {
    const g = new THREE.CapsuleGeometry(0.045, 0.82, 5, 10)
    g.translate(0, 0.82 / 2 + 0.045, 0)
    return g
  }, [])

  // Static per-rod data: jittered position, a sway phase, and a base height.
  const rods = useMemo(() => {
    const arr = new Array(COUNT)
    let i = 0
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const jx = (hash(i * 1.7 + 3.1) - 0.5) * GAP * 0.4
        const jz = (hash(i * 2.3 + 8.9) - 0.5) * GAP * 0.4
        arr[i] = {
          x: c * GAP - FIELD_W / 2 + jx,
          z: r * GAP - FIELD_D / 2 + jz,
          phase: hash(i * 5.7 + 1.3) * Math.PI * 2,
          h: 0.8 + hash(i * 3.9 + 4.4) * 0.4,
        }
        i++
      }
    }
    return arr
  }, [])

  useFrame((state) => {
    const t = state.clock.elapsedTime
    const fx = follow.current.x
    const fz = follow.current.z
    const inv2s2 = 1 / (2 * SIGMA * SIGMA)

    for (let i = 0; i < COUNT; i++) {
      const rod = rods[i]
      dir.set(fx - rod.x, 0, fz - rod.z)
      const dist = dir.length()
      const infl = Math.exp(-(dist * dist) * inv2s2) // Gaussian falloff, 0..1

      // Lean axis is horizontal and ⊥ to the cursor direction, so tipping about
      // it tilts the rod's tip straight toward the cursor.
      if (dist > 1e-4) {
        dir.multiplyScalar(1 / dist)
        axis.copy(up).cross(dir) // (dir.z, 0, -dir.x)
      } else {
        axis.set(1, 0, 0)
      }
      // A faint idle sway keeps the far field alive when nothing is near it.
      const sway = Math.sin(t * 0.5 + rod.phase) * 0.06
      dummy.quaternion.setFromAxisAngle(axis, infl * MAX_LEAN + sway * (1 - infl))

      dummy.position.set(rod.x, 0, rod.z)
      dummy.scale.set(1, rod.h * (1 + infl * LIFT), 1)
      dummy.updateMatrix()
      mesh.current.setMatrixAt(i, dummy.matrix)

      // Warm the rod toward terracotta with a slight curve so only the true
      // neighbourhood of the cursor lights up.
      tmpCol.copy(colBone).lerp(colWarm, Math.pow(infl, 0.6))
      mesh.current.setColorAt(i, tmpCol)
    }
    mesh.current.instanceMatrix.needsUpdate = true
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true
  })

  return (
    <instancedMesh
      ref={mesh}
      args={[geo, undefined, COUNT]}
      castShadow
      receiveShadow
    >
      {/* white base colour so per-instance colours read true (instanceColor
          multiplies material.color). */}
      <meshStandardMaterial color="#ffffff" roughness={0.58} metalness={0.12} />
    </instancedMesh>
  )
}

// Owns the single source of truth for the cursor's world position and drives a
// gentle camera parallax. Mounted first so `follow` is fresh before the field
// and the reticle read it in the same frame.
function Rig({ follow }) {
  const { camera } = useThree()
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), [])
  const hit = useMemo(() => new THREE.Vector3(), [])
  const target = useMemo(() => new THREE.Vector3(), [])
  const look = useMemo(() => new THREE.Vector3(), [])
  const base = useMemo(() => new THREE.Vector3(2.4, 7.4, 10.6), [])

  useFrame((state, delta) => {
    const { pointer, raycaster } = state
    raycaster.setFromCamera(pointer, camera)
    if (raycaster.ray.intersectPlane(plane, hit)) target.copy(hit)

    // Damped chase — the field trails the pointer with a little inertia.
    follow.current.x = THREE.MathUtils.damp(follow.current.x, target.x, 6, delta)
    follow.current.z = THREE.MathUtils.damp(follow.current.z, target.z, 6, delta)

    // Parallax: the camera drifts opposite-ish to the pointer around its base,
    // and keeps looking a touch toward the cursor for depth.
    camera.position.x = THREE.MathUtils.damp(camera.position.x, base.x + pointer.x * 2.4, 3, delta)
    camera.position.y = THREE.MathUtils.damp(camera.position.y, base.y - pointer.y * 0.9, 3, delta)
    camera.position.z = base.z
    look.set(follow.current.x * 0.14, 0.35, follow.current.z * 0.1)
    camera.lookAt(look)
  })
  return null
}

// A quiet reticle hovering over the point the field is attending to — the one
// spot of pure accent colour, monaka-style.
function Reticle({ follow }) {
  const g = useRef()
  useFrame((state) => {
    const t = state.clock.elapsedTime
    g.current.position.set(follow.current.x, 0.95 + Math.sin(t * 1.6) * 0.07, follow.current.z)
    g.current.rotation.y = t * 0.6
    g.current.rotation.x = Math.PI / 2
  })
  return (
    <group ref={g}>
      <mesh>
        <torusGeometry args={[0.32, 0.014, 12, 72]} />
        <meshStandardMaterial color="#c1673f" emissive="#c1673f" emissiveIntensity={0.6} roughness={0.4} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <sphereGeometry args={[0.05, 24, 24]} />
        <meshStandardMaterial color="#e9866a" emissive="#c1673f" emissiveIntensity={0.9} roughness={0.3} />
      </mesh>
    </group>
  )
}

// Procedural, offline-safe studio IBL — the Day 003/007/008 lesson: never fetch
// an HDRI at runtime (a failed fetch suspends the Canvas and blanks the scene).
function SoftStudio() {
  return (
    <Environment resolution={256}>
      <color attach="background" args={['#e9e6df']} />
      <Lightformer form="rect" intensity={1.5} position={[0, 9, 4]} rotation={[Math.PI / 2, 0, 0]} scale={[18, 18, 1]} color="#fffaf2" />
      <Lightformer form="rect" intensity={0.85} position={[-10, 3, 7]} rotation={[0, Math.PI / 2.2, 0]} scale={[12, 12, 1]} color="#eef2f8" />
      <Lightformer form="rect" intensity={0.7} position={[10, 2, 6]} rotation={[0, -Math.PI / 2.2, 0]} scale={[12, 12, 1]} color="#fff2e6" />
    </Environment>
  )
}

export default function Scene() {
  // Shared, mutable world-space cursor point — written by Rig, read by all.
  const follow = useRef(new THREE.Vector3(0, 0, 0))

  return (
    <>
      <SoftStudio />
      <hemisphereLight args={['#fffdf8', '#e0d8c9', 1.05]} />
      <ambientLight intensity={0.32} />
      <directionalLight position={[5, 11, 6]} intensity={0.95} castShadow>
        <orthographicCamera attach="shadow-camera" args={[-16, 16, 16, -16, 0.1, 40]} />
      </directionalLight>
      <directionalLight position={[-5, 4, 10]} intensity={0.32} color="#eef1f6" />

      <Rig follow={follow} />

      {/* Matte paper floor the rods stand on and cast onto. Sits a hair below
          y=0 to avoid z-fighting with the capsule base caps. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[80, 80]} />
        <meshStandardMaterial color="#e7e3db" roughness={0.95} metalness={0} />
      </mesh>

      <Field follow={follow} />
      <Reticle follow={follow} />
    </>
  )
}
