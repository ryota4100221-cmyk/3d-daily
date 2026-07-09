import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { Environment, Lightformer, useScroll } from '@react-three/drei'

// ── Day 010 · Week II — Motion & Interaction — "Ascend" ──────────────────────
// The curriculum's ScrollControls day: a one-page experience that *unfolds* as
// you scroll. Rather than tie one property to scroll, the whole scene is a
// timeline the scrollbar scrubs. A helix "spire" of ~1,100 radial bars is
// wound from the ground up: a glowing terracotta ACTIVATION WAVEFRONT rides up
// the tower as you scroll, settling the bars beneath it into a quiet bone
// spiral and leaving the bars above it dormant (scaled to nothing). The camera
// spirals upward through the structure in lock-step, and four typographic
// chapters (<Scroll html>) scroll past as captions. Scroll up and the spire
// un-builds, perfectly reversible — the scrollbar is a transport, not a trigger.
//
// The three new techniques for today (all scroll-driven), building on the
// instanced fields of Day 005/007/009 and the damped input of Day 009:
//   1. useScroll().offset AS A TIMELINE — a single 0..1 value scrubs a keyframed
//      camera flythrough (orbit angle + rise + dolly), interpolated every frame.
//      The scroll position, not a clock or a pointer, is now the clock.
//   2. SCROLL-FRONT REVEAL — each bar owns a normalised height u∈[0,1]; a moving
//      "front" = f(offset) sweeps up it. Below the front → smoothstep-settled;
//      at the front → a Gaussian warm bloom; above → dormant. One InstancedMesh,
//      per-instance matrix AND colour rewritten each frame against the front.
//   3. <Scroll html> — DOM chapters live *inside* the R3F scroll, so typography
//      and 3D scroll as a single page (drei portals + transforms the overlay).

const N = 1120 // bars in the spire
const TURNS = 7.2 // helical revolutions base→top
const H = 26 // world height of the spire
const R = 3.5 // base radius (tapers toward the top into a spire)

const hash = (n) => {
  const s = Math.sin(n * 127.1) * 43758.5453123
  return s - Math.floor(s)
}
const smooth = (a, b, x) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

// The single source of truth mapping scroll offset → the reveal wavefront's
// normalised height. Rig and Spire both read this so the camera always frames
// the glowing front: at offset 0 the base is already built and visible; by
// offset 1 the whole spire is wound. u∈[0,1] is a bar's height along the spire.
const frontOf = (offset) => 0.1 + offset * 0.95

// The spire: a single InstancedMesh of radial bars wound in a helix. Its look
// per frame is governed entirely by the scroll `front`.
function Spire() {
  const mesh = useRef()
  const scroll = useScroll()
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const colBone = useMemo(() => new THREE.Color('#d7d1c4'), [])
  const colWarm = useMemo(() => new THREE.Color('#c1673f'), [])
  const tmp = useMemo(() => new THREE.Color(), [])

  // A slim radial bar — long on local +X so it reads as a "step" pointing
  // outward from the axis; translated so it grows from its inner (axis) end.
  const geo = useMemo(() => {
    const g = new THREE.BoxGeometry(0.92, 0.11, 0.13, 1, 1, 1)
    g.translate(0.46, 0, 0)
    return g
  }, [])

  // Static per-bar layout along the helix (position, angle, taper, phase).
  const bars = useMemo(() => {
    const arr = new Array(N)
    for (let i = 0; i < N; i++) {
      const u = i / (N - 1)
      const ang = u * TURNS * Math.PI * 2 + hash(i * 1.3) * 0.05
      const radius = R * (1 - 0.42 * u) // narrows into a spire
      arr[i] = {
        u,
        ang,
        radius,
        x: Math.cos(ang) * radius,
        z: Math.sin(ang) * radius,
        y: 0.35 + u * H,
        len: 0.7 + hash(i * 3.7 + 2.1) * 0.5,
        phase: hash(i * 5.9 + 4.4) * Math.PI * 2,
      }
    }
    return arr
  }, [])

  useFrame((state) => {
    const t = state.clock.elapsedTime
    // The wavefront rises with scroll; below it settles, at it blooms warm,
    // above it stays dormant. Scroll back and it un-builds, exactly.
    const front = frontOf(scroll.offset)

    for (let i = 0; i < N; i++) {
      const b = bars[i]
      const below = front - b.u
      const settle = smooth(-0.02, 0.11, below) // 0 dormant → 1 settled
      const warm = Math.exp(-((b.u - front) * (b.u - front)) / (2 * 0.05 * 0.05))

      // Gentle life so a settled spire still breathes (Day 008 habit, tiny).
      const bob = Math.sin(t * 0.8 + b.phase) * 0.03 * settle

      dummy.position.set(b.x, b.y + bob, b.z)
      // Point the bar's long axis radially outward: local +X → (cosang, 0, sinang)
      // requires rotationY = −ang. A faint upward cant follows the helix rise.
      dummy.rotation.set(0, -b.ang, 0.06 + warm * 0.05)
      const s = settle * (1 + warm * 0.4)
      dummy.scale.set(b.len * (0.55 + 0.45 * s), s, s)
      dummy.updateMatrix()
      mesh.current.setMatrixAt(i, dummy.matrix)

      tmp.copy(colBone).lerp(colWarm, Math.min(1, warm))
      mesh.current.setColorAt(i, tmp)
    }
    mesh.current.instanceMatrix.needsUpdate = true
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true
  })

  return (
    <instancedMesh ref={mesh} args={[geo, undefined, N]} castShadow receiveShadow>
      <meshStandardMaterial color="#ffffff" roughness={0.52} metalness={0.14} />
    </instancedMesh>
  )
}

// The scrollbar as a camera transport: offset scrubs a keyframed flythrough —
// the camera spirals upward and dollies a touch closer as the spire narrows.
function Rig() {
  const scroll = useScroll()
  const { camera } = useThree()
  const look = useMemo(() => new THREE.Vector3(), [])

  useFrame((state) => {
    const o = scroll.offset
    const t = state.clock.elapsedTime

    // Track the wavefront's world height so the camera always frames the glow.
    const fu = THREE.MathUtils.clamp(frontOf(o), 0, 1)
    const wy = 0.35 + fu * H // wavefront world height

    // Spiral orbit — a little over one full revolution across the journey, with
    // a slow idle drift so a paused scene still turns.
    const ang = 0.6 + o * Math.PI * 2 * 1.25 + t * 0.02
    const camR = 8.2 - fu * 2.0 // ease inward as the spire narrows

    // Perch just above the wavefront and gaze down onto the winding built spire
    // below it — an ascent that keeps the fresh growth centred.
    camera.position.set(Math.cos(ang) * camR, wy + 2.6, Math.sin(ang) * camR)
    look.set(0, wy - 1.0, 0)
    camera.lookAt(look)
  })
  return null
}

// Reflects scroll into the fixed DOM furniture (progress rail + fading cue).
// Cheap to touch the DOM here since it's two style writes per frame.
function Hud() {
  const scroll = useScroll()
  useFrame(() => {
    const fill = document.getElementById('progress-fill')
    if (fill) fill.style.width = (scroll.offset * 100).toFixed(2) + '%'
    const cue = document.getElementById('scroll-cue')
    if (cue) cue.style.opacity = String(Math.max(0, 1 - scroll.offset * 6))
  })
  return null
}

// Procedural, offline-safe studio IBL — never fetch an HDRI at runtime (a failed
// fetch suspends the Canvas and blanks the scene; the Day 003/007/008 lesson).
function SoftStudio() {
  return (
    <Environment resolution={256}>
      <color attach="background" args={['#e9e6df']} />
      <Lightformer form="rect" intensity={1.5} position={[0, 12, 6]} rotation={[Math.PI / 2, 0, 0]} scale={[24, 24, 1]} color="#fffaf2" />
      <Lightformer form="rect" intensity={0.85} position={[-12, 6, 8]} rotation={[0, Math.PI / 2.2, 0]} scale={[16, 24, 1]} color="#eef2f8" />
      <Lightformer form="rect" intensity={0.7} position={[12, 5, 8]} rotation={[0, -Math.PI / 2.2, 0]} scale={[16, 24, 1]} color="#fff2e6" />
    </Environment>
  )
}

export default function Scene() {
  return (
    <>
      <SoftStudio />
      <hemisphereLight args={['#fffdf8', '#e0d8c9', 1.0]} />
      <ambientLight intensity={0.34} />
      <directionalLight position={[6, 16, 8]} intensity={0.9} castShadow>
        <orthographicCamera attach="shadow-camera" args={[-12, 12, 30, -4, 0.1, 60]} />
      </directionalLight>
      <directionalLight position={[-6, 6, 10]} intensity={0.3} color="#eef1f6" />

      {/* faint central spine — gives the wound bars an axis to read against */}
      <mesh position={[0, H / 2, 0]}>
        <cylinderGeometry args={[0.03, 0.05, H + 1, 12]} />
        <meshStandardMaterial color="#cfc9bd" roughness={0.9} metalness={0} />
      </mesh>

      {/* matte paper base the spire rises from, grounding chapter one */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <planeGeometry args={[120, 120]} />
        <meshStandardMaterial color="#e7e3db" roughness={0.95} metalness={0} />
      </mesh>

      <Spire />
      <Rig />
      <Hud />
    </>
  )
}
