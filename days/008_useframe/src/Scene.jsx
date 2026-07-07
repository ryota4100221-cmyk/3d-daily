import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { Environment, Lightformer, ContactShadows } from '@react-three/drei'

// ── Day 008 · Week II — Motion & Interaction — "Breathe" ─────────────────────
// The Week-2 curriculum opens on the fundamentals of useFrame: rotation,
// floating, breathing. Rather than pile them onto one object, this piece
// *decomposes* motion into three independent, separately-tunable channels and
// lets you see each one clearly:
//
//   1. ROTATE  — each object spins on its own axis. Crucially the angle is
//                accumulated from `delta` (spin += delta·speed), NOT read from
//                elapsedTime, so the speed is identical whether the tab runs at
//                60, 90 or 120 Hz. This is the single most important useFrame
//                habit and Day 007 didn't use it — everything there came from
//                elapsedTime. That's the "one new technique" for today.
//   2. FLOAT   — a vertical bob on an offset sine.
//   3. BREATHE — a gentle scale pulse on a slower offset sine.
//
// The phase of every channel is offset by the object's position in the row, so
// float and breath sweep across the suite as a *travelling wave* instead of all
// pulsing in unison. The whole assembly eases in on load and sways a few
// degrees — both driven frame-rate-independently with THREE.MathUtils.damp.

// A restrained, monaka-ish palette: mostly bone & greige, one soft chrome, a
// single muted-terracotta accent, one graphite for weight. Motion is the
// subject, so the colour stays quiet.
const PIECES = [
  {
    geom: <icosahedronGeometry args={[0.62, 0]} />,
    mat: { color: '#e7e1d6', roughness: 0.62, metalness: 0.0, clearcoat: 0 },
    baseY: 0.42,
    scale: 1.0,
    floatAmp: 0.16, floatSpeed: 0.9,
    breatheAmp: 0.05, breatheSpeed: 0.7,
    spinSpeed: 0.5, tilt: 0.35,
  },
  {
    geom: <torusGeometry args={[0.42, 0.16, 24, 64]} />,
    mat: { color: '#cfc9bd', roughness: 0.14, metalness: 1.0, clearcoat: 0 },
    baseY: 0.30,
    scale: 1.05,
    floatAmp: 0.2, floatSpeed: 0.9,
    breatheAmp: 0.04, breatheSpeed: 0.7,
    spinSpeed: 0.75, tilt: 1.15,
  },
  {
    geom: <sphereGeometry args={[0.55, 48, 48]} />,
    mat: { color: '#c06a4a', roughness: 0.35, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.25 },
    baseY: 0.5,
    scale: 1.0,
    floatAmp: 0.17, floatSpeed: 0.9,
    breatheAmp: 0.07, breatheSpeed: 0.7,
    spinSpeed: 0.28, tilt: 0.0,
  },
  {
    geom: <capsuleGeometry args={[0.28, 0.6, 8, 24]} />,
    mat: { color: '#efeae1', roughness: 0.55, metalness: 0.0, clearcoat: 0 },
    baseY: 0.34,
    scale: 1.0,
    floatAmp: 0.19, floatSpeed: 0.9,
    breatheAmp: 0.05, breatheSpeed: 0.7,
    spinSpeed: 0.6, tilt: 0.5,
  },
  {
    geom: <octahedronGeometry args={[0.6, 0]} />,
    mat: { color: '#2c2a27', roughness: 0.42, metalness: 0.2, clearcoat: 0 },
    baseY: 0.46,
    scale: 0.95,
    floatAmp: 0.16, floatSpeed: 0.9,
    breatheAmp: 0.06, breatheSpeed: 0.7,
    spinSpeed: 0.9, tilt: 0.6,
  },
  {
    geom: <boxGeometry args={[0.8, 0.8, 0.8]} />,
    mat: { color: '#d7cfc0', roughness: 0.3, metalness: 0.7, clearcoat: 0 },
    baseY: 0.32,
    scale: 0.92,
    floatAmp: 0.21, floatSpeed: 0.9,
    breatheAmp: 0.05, breatheSpeed: 0.7,
    spinSpeed: 0.45, tilt: 0.9,
  },
]

const SPACING = 1.62 // horizontal gap between objects in the row
// One shared phase step per object so float + breath ripple along the line.
const PHASE_STEP = (Math.PI * 2) / PIECES.length

function Piece({ index, spec }) {
  // Two nested groups keep the channels cleanly separated:
  //   outer  → FLOAT (position.y) + BREATHE (uniform scale)
  //   inner  → ROTATE (spin), so a spinning object still floats/breathes as a
  //            rigid whole rather than smearing its own bob.
  const outer = useRef()
  const inner = useRef()
  const spin = useRef(0) // accumulated rotation angle, advanced by delta

  const x = useMemo(
    () => (index - (PIECES.length - 1) / 2) * SPACING,
    [index],
  )
  const phase = index * PHASE_STEP

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime

    // 2 · FLOAT — vertical bob, phase-offset down the row.
    const bob = Math.sin(t * spec.floatSpeed + phase) * spec.floatAmp
    outer.current.position.y = spec.baseY + bob

    // 3 · BREATHE — slow scale pulse, same travelling phase.
    const breath = 1 + Math.sin(t * spec.breatheSpeed + phase) * spec.breatheAmp
    outer.current.scale.setScalar(spec.scale * breath)

    // 1 · ROTATE — accumulate from delta, so angular speed is identical at any
    // refresh rate (the whole point of using delta over elapsedTime).
    spin.current += delta * spec.spinSpeed
    inner.current.rotation.set(spec.tilt, spin.current, spin.current * 0.35)
  })

  return (
    <group ref={outer} position={[x, spec.baseY, 0]}>
      <mesh ref={inner} castShadow receiveShadow>
        {spec.geom}
        {/* meshPhysical everywhere so the terracotta sphere can wear a clearcoat
            while the plaster pieces stay matte — one material, tuned per object. */}
        <meshPhysicalMaterial
          color={spec.mat.color}
          roughness={spec.mat.roughness}
          metalness={spec.mat.metalness}
          clearcoat={spec.mat.clearcoat}
          clearcoatRoughness={spec.mat.clearcoatRoughness ?? 0.3}
          envMapIntensity={1.0}
        />
      </mesh>
    </group>
  )
}

function Suite() {
  const rig = useRef()
  // Eases 0→1 on load; used to rise + scale the whole suite into place with
  // frame-rate-independent damping (a second useFrame fundamental for today).
  const settle = useRef(0)

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime
    // Critically-damped approach to 1 — smooth on any GPU, no hard-coded steps.
    settle.current = THREE.MathUtils.damp(settle.current, 1, 2.4, delta)

    // Editorial sway: the row yaws a few degrees so the light rakes across the
    // objects from changing angles — never a full turntable.
    rig.current.rotation.y = Math.sin(t * 0.12) * 0.16
    rig.current.scale.setScalar(0.92 + 0.08 * settle.current)
    rig.current.position.y = -0.35 * (1 - settle.current)
  })

  return (
    <group ref={rig}>
      {PIECES.map((spec, i) => (
        <Piece key={i} index={i} spec={spec} />
      ))}
    </group>
  )
}

// Procedural, offline-safe studio IBL — the Day 003/007 lesson: never fetch an
// HDRI at runtime (a failed fetch suspends the Canvas and blanks the scene).
function SoftStudio() {
  return (
    <Environment resolution={256}>
      <color attach="background" args={['#e9e6df']} />
      <Lightformer form="rect" intensity={1.6} position={[0, 8, 4]} rotation={[Math.PI / 2, 0, 0]} scale={[16, 16, 1]} color="#fffaf2" />
      <Lightformer form="rect" intensity={0.9} position={[-9, 3, 6]} rotation={[0, Math.PI / 2.2, 0]} scale={[10, 10, 1]} color="#eef2f8" />
      <Lightformer form="rect" intensity={0.7} position={[9, 2, 5]} rotation={[0, -Math.PI / 2.2, 0]} scale={[10, 10, 1]} color="#fff2e6" />
    </Environment>
  )
}

export default function Scene() {
  return (
    <>
      <SoftStudio />
      {/* Hemisphere fill carries the base illumination so the picture never
          hinges on the IBL alone — bright paper "sky", warm greige "ground". */}
      <hemisphereLight args={['#fffdf8', '#e0d8c9', 1.1]} />
      <ambientLight intensity={0.35} />
      {/* High raking key: models the forms and drops a soft cast shadow. */}
      <directionalLight position={[5, 10, 6]} intensity={0.95} castShadow>
        <orthographicCamera attach="shadow-camera" args={[-8, 8, 8, -8, 0.1, 30]} />
      </directionalLight>
      {/* Cool fill from the camera side so near faces aren't pure shadow. */}
      <directionalLight position={[-4, 3, 9]} intensity={0.35} color="#eef1f6" />

      <Suite />

      {/* Soft contact shadow grounds the floating row to the paper plane. */}
      <ContactShadows
        position={[0, -0.9, 0]}
        scale={16}
        resolution={1024}
        blur={2.8}
        far={5}
        opacity={0.26}
        color="#3a382f"
      />
    </>
  )
}
