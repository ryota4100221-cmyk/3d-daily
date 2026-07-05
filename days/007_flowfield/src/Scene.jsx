import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { Environment, Lightformer, ContactShadows } from '@react-three/drei'
import { fbm } from './noise.js'

// ── Day 007 · Week I Reprise — Flow Field ────────────────────────────────────
// Week 1's strongest picture was Day 005's kinetic InstancedMesh. This is that
// idea, refined a full step for the weekly summary:
//   • motion source: single radial sine  →  layered value-noise (fBm) flow
//   • layout:        square grid          →  circular plate with soft edge mask
//   • per-instance:  height + colour      →  + flow-aligned yaw (the blades lean
//                                            downhill, so the field has grain)
//   • geometry:      hard boxes           →  rounded capsule blades (premium)
//   • tone:          height→greige        →  height→bone + a warm emissive crest
// Still ONE draw call for the whole field. The lesson of instancing holds:
// geometry is free, the per-frame bookkeeping is where the picture is won.

const RADIUS = 9.5 // radius of the circular plate, in world units
const STEP = 0.56 // spacing between blades on the grid before masking
const BLADE = 0.15 // footprint (x/z) of each capsule blade
const BASE_H = 0.12 // resting height so the field never fully flattens
const MAX_AMP = 1.5 // extra height at a flow crest

const NOISE_SCALE = 0.12 // world→noise frequency (lower = broader swells)
const FLOW_SPEED = 0.13 // how fast we drift through the noise field
const GRAD_EPS = 0.6 // sample offset used to estimate the flow gradient

// A tight tonal range: cool greige troughs → warm bone crests. Deliberately
// near-monochrome so the motion reads as *light travelling over a surface*.
const LOW = new THREE.Color('#d9d2c6')
const HIGH = new THREE.Color('#f9f5ee')
// Crests glow a touch warmer than pure bone — a whisper of emissive so the
// highest blades feel lit from within, an Awwwards-y depth cue without postFX.
const GLOW = new THREE.Color('#ffe9c8')

// Reusable scratch — allocating inside useFrame would thrash the GC across
// thousands of instances at 60fps.
const dummy = new THREE.Object3D()
const scratch = new THREE.Color()

function Field() {
  const meshRef = useRef()

  // Bake the static per-instance data once. We lay a square grid, then keep
  // only the cells inside the disc (with a soft radial falloff so the plate
  // dissolves at its rim rather than ending on a hard circle).
  const { cells, count } = useMemo(() => {
    const out = []
    for (let x = -RADIUS; x <= RADIUS; x += STEP) {
      for (let z = -RADIUS; z <= RADIUS; z += STEP) {
        const r = Math.hypot(x, z)
        if (r > RADIUS) continue
        // 1 in the interior, easing to 0 over the outer 22% of the radius.
        const edge = THREE.MathUtils.smoothstep(RADIUS, RADIUS * 0.78, r)
        out.push({ x, z, edge })
      }
    }
    return { cells: out, count: out.length }
  }, [])

  useFrame((state) => {
    const mesh = meshRef.current
    if (!mesh) return
    const t = state.clock.elapsedTime
    // Drift the sampling window so the whole field flows in one direction.
    const ox = t * FLOW_SPEED
    const oy = t * FLOW_SPEED * 0.6

    for (let i = 0; i < count; i++) {
      const { x, z, edge } = cells[i]
      const nx = x * NOISE_SCALE + ox
      const nz = z * NOISE_SCALE + oy

      // Height from the fBm field, shaped so mid-values sit low and only the
      // crests rise — gives the surface a dune-like, uneven skyline.
      const n = fbm(nx, nz)
      const shaped = n * n * (3 - 2 * n) // extra contrast (smoothstep on itself)
      const h = BASE_H + MAX_AMP * shaped * edge

      // Estimate the field's gradient with two extra samples, then face each
      // blade downhill — this is what gives the field visible grain/flow.
      const gx = fbm(nx + GRAD_EPS, nz) - fbm(nx - GRAD_EPS, nz)
      const gz = fbm(nx, nz + GRAD_EPS) - fbm(nx, nz - GRAD_EPS)
      const yaw = Math.atan2(gz, gx)

      dummy.position.set(x, h / 2, z)
      dummy.scale.set(1, h, 1)
      dummy.rotation.set(0, yaw, 0)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)

      // Tone tracks height; crests lerp a hair toward the warm glow colour.
      const t01 = THREE.MathUtils.clamp(shaped * edge, 0, 1)
      scratch.copy(LOW).lerp(HIGH, t01)
      if (t01 > 0.72) scratch.lerp(GLOW, (t01 - 0.72) / 0.28)
      mesh.setColorAt(i, scratch)
    }

    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  })

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, count]}
      castShadow
      receiveShadow
    >
      {/* Rounded capsule blade — a unit-height column we scale in Y. The soft
          cap catches the key light far more sweetly than a box edge. */}
      <capsuleGeometry args={[BLADE, 1, 4, 12]} />
      {/* Matte plaster. Per-instance colour (setColorAt → instanceColor) drives
          the diffuse tone, so crests read warm and troughs cool. Low metalness
          keeps it chalky, not shiny. */}
      <meshStandardMaterial
        vertexColors
        roughness={0.7}
        metalness={0}
        envMapIntensity={0.9}
        // A faint warm emissive floor so a blade that's fully self-shadowed
        // still reads as pale plaster, never a black silhouette — keeps the
        // whole field high-key on any GPU.
        emissive="#8d887c"
        emissiveIntensity={0.22}
      />
    </instancedMesh>
  )
}

// Procedural, offline-safe studio IBL (the Day 003 lesson — never fetch an HDRI
// at runtime; a failed fetch suspends the Canvas and blanks the scene). A broad
// soft overhead key plus cool/warm side fills wrap the field in gentle light.
function SoftStudio() {
  return (
    <Environment resolution={256}>
      <color attach="background" args={['#e9e6df']} />
      <Lightformer form="rect" intensity={1.5} position={[0, 9, 3]} rotation={[Math.PI / 2, 0, 0]} scale={[18, 18, 1]} color="#fffaf2" />
      <Lightformer form="rect" intensity={0.85} position={[-10, 3, 5]} rotation={[0, Math.PI / 2.2, 0]} scale={[10, 10, 1]} color="#eef2f8" />
      <Lightformer form="rect" intensity={0.65} position={[10, 2, 4]} rotation={[0, -Math.PI / 2.2, 0]} scale={[10, 10, 1]} color="#fff2e6" />
    </Environment>
  )
}

export default function Scene() {
  const rig = useRef()

  // Editorial restraint: no full spin. The whole field yaws a few degrees back
  // and forth so the light rakes across it from changing angles — the picture
  // breathes without ever becoming a turntable.
  useFrame((state) => {
    if (!rig.current) return
    const t = state.clock.elapsedTime
    rig.current.rotation.y = Math.sin(t * 0.09) * 0.22
  })

  return (
    <>
      <SoftStudio />
      {/* Hemisphere fill does the heavy lifting so the picture never depends on
          the IBL alone: bright paper "sky" lights the caps, a warm greige
          "ground" bounces into the troughs — the whole field stays airy even
          where the blades shadow each other. */}
      <hemisphereLight args={['#fffdf8', '#e0d8c9', 1.25]} />
      <ambientLight intensity={0.45} />
      {/* High raking key to light the capsule caps and drop a soft cast shadow,
          echoing Day 004's raking light across a now-moving field. */}
      <directionalLight position={[6, 13, 6]} intensity={0.85} castShadow>
        <orthographicCamera attach="shadow-camera" args={[-14, 14, 14, -14, 0.1, 45]} />
      </directionalLight>
      {/* Soft cool fill from the camera side so the near faces of the blades
          aren't pure shadow — no cast shadow, just modelling light. */}
      <directionalLight position={[-4, 5, 12]} intensity={0.4} color="#eef1f6" />

      <group ref={rig}>
        <Field />

        {/* Screen-space contact shadow grounds the whole field to the paper
            plane without paying a shadow map for thousands of moving casters. */}
        <ContactShadows
          position={[0, 0.001, 0]}
          scale={26}
          resolution={1024}
          blur={2.6}
          far={6}
          opacity={0.28}
          color="#3a382f"
        />
      </group>
    </>
  )
}
