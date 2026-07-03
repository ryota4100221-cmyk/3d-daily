import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { Environment, Lightformer, ContactShadows } from '@react-three/drei'

// Kinetic field of slender plaster pillars. The whole picture is ONE draw call:
// ~2,300 pillars are a single InstancedMesh whose per-instance matrix + colour
// are rewritten every frame. A radial travelling wave lifts them into a soft
// dune that breathes from the centre — the light-to-dark gradient IS the wave.
const GRID = 48 // 48 × 48 = 2,304 instances
const SPACING = 0.42
const PILLAR = 0.26 // footprint of each pillar (x/z)
const BASE_H = 0.14 // resting height so the field never fully flattens
const MAX_AMP = 2.4 // extra height at a wave crest
const SIGMA = 5.2 // gaussian: centre pillars swing hardest, edges just ripple

// A tight two-stop tonal range — deep greige troughs to warm-bone crests. Kept
// almost monochrome on purpose: the motion should read as *light sweeping over
// a surface*, not as colour. monaka-style restraint.
const LOW = new THREE.Color('#9a948a')
const HIGH = new THREE.Color('#f4efe7')

// Reusable scratch objects — allocating inside useFrame would thrash the GC at
// 2,304 iterations × 60fps. This is the real lesson of instancing: the geometry
// is free, the per-frame bookkeeping is where you win or lose.
const dummy = new THREE.Object3D()
const scratch = new THREE.Color()

function Field() {
  const ref = useRef()

  // Pre-bake the static per-instance data once: grid position and radius from
  // centre. Only the height + colour change per frame, so this never re-runs.
  const cells = useMemo(() => {
    const out = []
    const half = ((GRID - 1) * SPACING) / 2
    for (let ix = 0; ix < GRID; ix++) {
      for (let iz = 0; iz < GRID; iz++) {
        const x = ix * SPACING - half
        const z = iz * SPACING - half
        out.push({ x, z, r: Math.hypot(x, z) })
      }
    }
    return out
  }, [])

  useFrame((state) => {
    const mesh = ref.current
    if (!mesh) return
    const t = state.clock.elapsedTime

    for (let i = 0; i < cells.length; i++) {
      const { x, z, r } = cells[i]
      // Gaussian centre-weight × an outward-travelling sine ripple.
      const env = Math.exp((-r * r) / (2 * SIGMA * SIGMA))
      const wave = 0.5 + 0.5 * Math.sin(t * 1.05 - r * 0.9)
      const h = BASE_H + MAX_AMP * (0.32 + 0.68 * env) * wave

      // Pillars are unit-height boxes scaled in Y, anchored on the ground (y=0),
      // so position.y is half the height.
      dummy.position.set(x, h / 2, z)
      dummy.scale.set(1, h, 1)
      dummy.rotation.set(0, 0, 0)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)

      // Tone tracks height — crests catch the light, troughs fall into greige.
      const t01 = THREE.MathUtils.clamp((h - BASE_H) / MAX_AMP, 0, 1)
      scratch.copy(LOW).lerp(HIGH, t01)
      mesh.setColorAt(i, scratch)
    }

    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  })

  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, GRID * GRID]}
      castShadow
      receiveShadow
    >
      <boxGeometry args={[PILLAR, 1, PILLAR]} />
      {/* Matte plaster so the tonal wave — not specular glare — carries the
          motion. metalness 0, high roughness, gentle env pickup. */}
      <meshStandardMaterial roughness={0.72} metalness={0} envMapIntensity={0.5} />
    </instancedMesh>
  )
}

// Procedural, offline-safe IBL (the Day 003 lesson: never fetch an HDRI at
// runtime). A big soft overhead key plus cool/warm side fills wrap the pillars
// in gentle studio light.
function SoftStudio() {
  return (
    <Environment resolution={256}>
      <color attach="background" args={['#eceae5']} />
      <Lightformer form="rect" intensity={1.5} position={[0, 8, 3]} rotation={[Math.PI / 2, 0, 0]} scale={[16, 16, 1]} color="#fffaf2" />
      <Lightformer form="rect" intensity={0.85} position={[-9, 3, 5]} rotation={[0, Math.PI / 2.2, 0]} scale={[9, 9, 1]} color="#eef2f8" />
      <Lightformer form="rect" intensity={0.65} position={[9, 2, 4]} rotation={[0, -Math.PI / 2.2, 0]} scale={[9, 9, 1]} color="#fff2e6" />
    </Environment>
  )
}

export default function Scene() {
  return (
    <>
      <SoftStudio />
      <ambientLight intensity={0.3} />
      {/* A low raking directional to give the pillar sides some form + a soft
          cast shadow, echoing Day 004 but now across a moving field. */}
      <directionalLight position={[6, 9, 4]} intensity={0.9} castShadow>
        <orthographicCamera attach="shadow-camera" args={[-14, 14, 14, -14, 0.1, 40]} />
      </directionalLight>

      <Field />

      {/* Screen-space contact shadow grounds the whole field to the paper
          plane without paying a shadow map for 2,300 moving casters. */}
      <ContactShadows
        position={[0, 0.001, 0]}
        scale={26}
        resolution={1024}
        blur={2.4}
        far={6}
        opacity={0.42}
        color="#2b2a24"
      />
    </>
  )
}
