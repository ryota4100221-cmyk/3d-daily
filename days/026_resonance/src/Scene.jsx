import { useRef, useMemo, useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { SPEC_N } from './audio.js'
import { makeEnv } from './env.js'
import './CoreMaterial.jsx'

const TERRA = new THREE.Color('#c8603a')
const BONE = new THREE.Color('#cfc9ba')
const INK = new THREE.Color('#2a2c34')

// A soft radial sprite texture for additive glow (fake bloom, no postprocessing).
function glowTexture() {
  const s = 128
  const cv = document.createElement('canvas')
  cv.width = cv.height = s
  const ctx = cv.getContext('2d')
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.25, 'rgba(255,240,225,0.75)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, s, s)
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

// A soft radial "contact pool" — a flat alpha-gradient plane. Predictable under
// swiftshader (drei ContactShadows renders an opaque grey field there), and truer
// to the floating-on-paper monaka aesthetic than a hard cast shadow.
function shadowTexture() {
  const s = 256
  const cv = document.createElement('canvas')
  cv.width = cv.height = s
  const ctx = cv.getContext('2d')
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
  g.addColorStop(0.0, 'rgba(38,34,30,0.42)')
  g.addColorStop(0.45, 'rgba(42,38,32,0.24)')
  g.addColorStop(0.75, 'rgba(48,44,38,0.06)')
  g.addColorStop(1.0, 'rgba(48,44,38,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, s, s)
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

// ---- spectrum ring: SPEC_N rods on a circle, 1 InstancedMesh, driven by FFT ----
function RodRing({ engine, radius = 3.5 }) {
  const meshRef = useRef()
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const color = useMemo(() => new THREE.Color(), [])
  const heights = useMemo(() => new Float32Array(SPEC_N), [])

  const angles = useMemo(
    () => Array.from({ length: SPEC_N }, (_, i) => (i / SPEC_N) * Math.PI * 2),
    [],
  )

  // rod geometry: pivot at the base (translate ONCE, not per-update)
  const rodGeo = useMemo(() => {
    const g = new THREE.BoxGeometry(0.1, 1, 0.1)
    g.translate(0, 0.5, 0)
    return g
  }, [])

  useFrame((_, dt) => {
    const m = meshRef.current
    if (!m) return
    const spec = engine.spectrum
    const beat = engine.beat
    for (let i = 0; i < SPEC_N; i++) {
      // smooth the per-rod height a touch beyond the engine's own smoothing
      const target = spec[i]
      heights[i] += (target - heights[i]) * Math.min(1, dt * 14)
      const h = 0.1 + heights[i] * 1.95 + beat * heights[i] * 0.7
      const a = angles[i]
      const x = Math.cos(a) * radius
      const z = Math.sin(a) * radius
      dummy.position.set(x, h * 0.5, z)
      dummy.rotation.set(0, -a, 0)
      dummy.scale.set(1, h, 1)
      dummy.updateMatrix()
      m.setMatrixAt(i, dummy.matrix)
      // warm the loud bins toward terracotta, quiet stays bone
      const warm = Math.min(1, heights[i] * 1.6 + beat * 0.5)
      color.copy(BONE).lerp(TERRA, warm)
      color.lerp(INK, (1 - heights[i]) * 0.25) // sink very quiet bins
      m.setColorAt(i, color)
    }
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  })

  return (
    <instancedMesh
      ref={meshRef}
      args={[rodGeo, undefined, SPEC_N]}
      frustumCulled={false}
    >
      <meshStandardMaterial
        metalness={0.15}
        roughness={0.55}
        envMapIntensity={0.9}
        vertexColors={false}
      />
    </instancedMesh>
  )
}

function Core({ engine }) {
  const matRef = useRef()
  const glowRef = useRef()
  const groundGlowRef = useRef()
  useFrame((state, dt) => {
    const t = state.clock.elapsedTime
    if (matRef.current) {
      const m = matRef.current
      m.uTime = t
      m.uBass = engine.bass
      m.uMid = engine.mid
      m.uTreble = engine.treble
      m.uBeat = engine.beat
    }
    if (glowRef.current) {
      const s = 2.6 + engine.bass * 1.8 + engine.beat * 1.5
      glowRef.current.scale.setScalar(s)
      glowRef.current.material.opacity = 0.14 + engine.beat * 0.36 + engine.bass * 0.14
    }
    if (groundGlowRef.current) {
      const s = 4 + engine.level * 4 + engine.beat * 2.4
      groundGlowRef.current.scale.setScalar(s)
      groundGlowRef.current.material.opacity = 0.07 + engine.beat * 0.2
    }
  })

  const glowTex = useMemo(glowTexture, [])

  return (
    <group>
      {/* additive glow halo behind the core (fake bloom on beats) */}
      <sprite ref={glowRef} position={[0, 1.05, 0]}>
        <spriteMaterial
          map={glowTex}
          color={TERRA}
          transparent
          opacity={0.25}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>

      {/* the resonating body */}
      <mesh position={[0, 1.05, 0]} frustumCulled={false}>
        <icosahedronGeometry args={[1.15, 48]} />
        {/* @ts-ignore custom material */}
        <coreMaterial ref={matRef} />
      </mesh>

      {/* ground glow pool */}
      <sprite ref={groundGlowRef} position={[0, 0.02, 0]} scale={5}>
        <spriteMaterial
          map={glowTex}
          color={TERRA}
          transparent
          opacity={0.12}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          rotation={0}
        />
      </sprite>
    </group>
  )
}

function GroundPool() {
  const tex = useMemo(shadowTexture, [])
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}>
      <planeGeometry args={[16, 16]} />
      <meshBasicMaterial
        map={tex}
        transparent
        depthWrite={false}
        opacity={1}
        toneMapped={false}
      />
    </mesh>
  )
}

export default function Scene({ engine }) {
  const { gl, scene } = useThree()
  const rig = useRef()

  // procedural PMREM environment for the standard-material rods (offline safe)
  useEffect(() => {
    const env = makeEnv(gl, {
      top: '#efe9dc',
      bottom: '#cfc7b6',
      key: 'rgba(255,240,222,0.95)',
      fill: 'rgba(150,170,200,0.5)',
    })
    scene.environment = env
    return () => {
      scene.environment = null
      env.dispose?.()
    }
  }, [gl, scene])

  // drive the engine every frame + a slow cinematic orbit with pointer parallax
  useFrame((state, dt) => {
    engine.update(Math.min(dt, 0.05))
    const t = state.clock.elapsedTime
    const px = state.pointer.x
    const py = state.pointer.y
    const rad = 10.8 - engine.level * 0.7
    const ang = t * 0.1 + px * 0.5
    const cam = state.camera
    cam.position.x += (Math.sin(ang) * rad - cam.position.x) * 0.04
    cam.position.z += (Math.cos(ang) * rad - cam.position.z) * 0.04
    cam.position.y += (4.3 + py * 1.3 + engine.beat * 0.3 - cam.position.y) * 0.04
    cam.lookAt(0, 1.05, 0)

    // pointer conducts the music: x -> tempo, y -> brightness
    engine.tempo = THREE.MathUtils.clamp(px * 0.5 + 0.5, 0, 1)
    engine.brightness = THREE.MathUtils.clamp(py * 0.5 + 0.5, 0.05, 1)
  })

  return (
    <>
      {/* attach to the scene (must be a direct child, not inside a group) */}
      <color attach="background" args={['#e9e3d6']} />
      <fog attach="fog" args={['#e9e3d6', 12, 30]} />

      <group ref={rig}>
      {/* soft key + fill so the standard-material rods read cleanly */}
      <hemisphereLight args={['#fff4e2', '#8a8578', 0.9]} />
      <directionalLight position={[5, 8, 4]} intensity={1.4} color="#fff1de" castShadow>
        <orthographicCamera attach="shadow-camera" args={[-8, 8, 8, -8, 0.1, 30]} />
      </directionalLight>
      <directionalLight position={[-6, 3, -4]} intensity={0.5} color="#cdd6e6" />

      <Core engine={engine} />
      <RodRing engine={engine} />
      <GroundPool />
      </group>
    </>
  )
}
