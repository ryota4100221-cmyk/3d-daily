import { Suspense, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  Environment,
  Lightformer,
  MeshReflectorMaterial,
  ContactShadows,
  Float,
} from '@react-three/drei'
import * as THREE from 'three'
import EnvBoundary from './EnvBoundary.jsx'

// Restrained studio palette — cool chrome + one warm graphite, on paper.
const PALETTE = {
  chrome: '#eef1f4',
  graphite: '#3a3b40',
  brass: '#b9a06a',
  floor: '#d8d5cf',
}

// --- Procedural studio "HDRI": a rig of Lightformer softboxes baked into an
// env map. This is the guaranteed-offline fallback for the real preset below,
// but it is also a legitimate IBL source in its own right — big soft key,
// two side fills, and a pair of rim strips that draw crisp edges on chrome.
function ProceduralStudio() {
  return (
    <Environment resolution={512}>
      {/* A *bright* studio, not a dark void: chrome should read as light silver
          on paper, so the env base is a soft high-key grey and the softboxes
          sit just above it — with darker floor/rim accents for definition. */}
      <color attach="background" args={['#c7c7cb']} />
      {/* subtle darker floor half so the sphere's lower hemisphere grounds */}
      <Lightformer
        form="rect"
        intensity={0.35}
        position={[0, -6, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[14, 14, 1]}
        color="#6d6d74"
      />
      {/* key — large overhead softbox */}
      <Lightformer
        form="rect"
        intensity={2.2}
        position={[0, 6, 1]}
        rotation={[Math.PI / 2, 0, 0]}
        scale={[10, 10, 1]}
        color="#fff6ea"
      />
      {/* side fills */}
      <Lightformer
        form="rect"
        intensity={1.4}
        position={[-7, 2, 3]}
        rotation={[0, Math.PI / 2.3, 0]}
        scale={[8, 8, 1]}
        color="#eef3fa"
      />
      <Lightformer
        form="rect"
        intensity={1.0}
        position={[7, 2, 3]}
        rotation={[0, -Math.PI / 2.3, 0]}
        scale={[8, 8, 1]}
        color="#ffffff"
      />
      {/* rim strips — thin bright bars for crisp chrome edge definition */}
      <Lightformer
        form="rect"
        intensity={4}
        position={[3.5, 3, -6]}
        scale={[0.35, 6, 1]}
        color="#ffffff"
      />
      <Lightformer
        form="rect"
        intensity={3}
        position={[-3.5, 3, -6]}
        scale={[0.35, 6, 1]}
        color="#dfe8ff"
      />
    </Environment>
  )
}

// --- Real HDRI when the network allows; procedural rig when it doesn't.
// Both the Suspense fallback (still loading) and the error fallback (failed)
// resolve to the same procedural studio, so the scene is never dark.
function StudioLighting() {
  const fallback = <ProceduralStudio />
  return (
    <EnvBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <Environment preset="studio" environmentIntensity={0.9} resolution={512} />
      </Suspense>
    </EnvBoundary>
  )
}

// --- The hero objects: a polished-metal trio on a slow turntable. The whole
// group rotates so the reflections travel across the chrome — the point of an
// IBL study is that the *environment* is what you see in the surface.
function Showcase() {
  const turntable = useRef()
  useFrame((state, delta) => {
    if (turntable.current) turntable.current.rotation.y += delta * 0.12
    void state
  })

  return (
    <group ref={turntable}>
      {/* central mirror sphere — sits exactly on the floor (y = radius) */}
      <Float speed={1.1} rotationIntensity={0} floatIntensity={0.35} floatingRange={[-0.04, 0.06]}>
        <mesh position={[0, 1.08, 0]} castShadow>
          <sphereGeometry args={[1.08, 96, 96]} />
          <meshStandardMaterial
            color={PALETTE.chrome}
            metalness={1}
            roughness={0.05}
            envMapIntensity={1.15}
          />
        </mesh>
      </Float>

      {/* left — a torus knot in warm brushed brass */}
      <Float speed={1.5} rotationIntensity={0.4} floatIntensity={0.5} floatingRange={[-0.05, 0.08]}>
        <mesh position={[-2.75, 0.95, 0.35]} rotation={[0.4, 0.2, 0]} castShadow>
          <torusKnotGeometry args={[0.5, 0.17, 220, 32]} />
          <meshStandardMaterial
            color={PALETTE.brass}
            metalness={1}
            roughness={0.28}
            envMapIntensity={1}
          />
        </mesh>
      </Float>

      {/* right — a graphite capsule monolith, semi-matte for contrast */}
      <Float speed={1.3} rotationIntensity={0.2} floatIntensity={0.45} floatingRange={[-0.05, 0.07]}>
        <mesh position={[2.75, 1.05, -0.15]} rotation={[0, 0, Math.PI / 14]} castShadow>
          <capsuleGeometry args={[0.42, 1.1, 24, 48]} />
          <meshStandardMaterial
            color={PALETTE.graphite}
            metalness={0.85}
            roughness={0.22}
            envMapIntensity={0.95}
          />
        </mesh>
      </Float>
    </group>
  )
}

export default function Scene() {
  return (
    <>
      <StudioLighting />

      {/* A soft direct key on top of the IBL for shape-defining shadows. */}
      <ambientLight intensity={0.15} />
      <directionalLight
        position={[4, 7, 4]}
        intensity={1.35}
        color="#fff4e8"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
      >
        <orthographicCamera attach="shadow-camera" args={[-8, 8, 8, -8, 0.1, 30]} />
      </directionalLight>
      <directionalLight position={[-5, 3, 3]} intensity={0.35} color="#e8eef6" />

      <Showcase />

      {/* Reflective studio floor — real-time planar mirror. Kept subtle
          (low mixStrength, some blur) so it reads as polished concrete, not
          a literal mirror, and the objects float on their own reflection. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[60, 60]} />
        <MeshReflectorMaterial
          resolution={1024}
          mirror={0.55}
          mixBlur={6}
          mixStrength={1.4}
          blur={[300, 60]}
          roughness={0.85}
          depthScale={1.1}
          minDepthThreshold={0.4}
          maxDepthThreshold={1.4}
          color={PALETTE.floor}
          metalness={0.2}
        />
      </mesh>

      {/* Extra contact darkening right under each object for weight. */}
      <ContactShadows
        position={[0, 0.01, 0]}
        scale={16}
        far={6}
        blur={2.6}
        opacity={0.42}
        color="#2a2a2e"
      />
    </>
  )
}
