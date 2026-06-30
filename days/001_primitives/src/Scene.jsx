import { useRef } from 'react'

// A refined, restrained palette — warm paper + graphite, one quiet accent.
const PALETTE = {
  graphite: '#2b2a28',
  stone: '#d9d4cc',
  bone: '#efece6',
  accent: '#c4592f', // single terracotta accent, used sparingly
}

// Four primitives, evenly spaced along X, sitting on a common ground line.
function Primitives() {
  return (
    <group position={[0, 0, 0]}>
      {/* Box */}
      <mesh castShadow receiveShadow position={[-3.0, 0.7, 0]}>
        <boxGeometry args={[1.25, 1.25, 1.25]} />
        <meshStandardMaterial color={PALETTE.graphite} roughness={0.55} metalness={0.1} />
      </mesh>

      {/* Sphere — the accent piece */}
      <mesh castShadow receiveShadow position={[-1.0, 0.78, 0]}>
        <sphereGeometry args={[0.78, 64, 64]} />
        <meshStandardMaterial color={PALETTE.accent} roughness={0.35} metalness={0.05} />
      </mesh>

      {/* Torus */}
      <mesh castShadow receiveShadow position={[1.0, 0.82, 0]} rotation={[Math.PI / 2.3, 0, 0]}>
        <torusGeometry args={[0.62, 0.24, 32, 96]} />
        <meshStandardMaterial color={PALETTE.stone} roughness={0.4} metalness={0.35} />
      </mesh>

      {/* Icosahedron */}
      <mesh castShadow receiveShadow position={[3.0, 0.74, 0]} rotation={[0.3, 0.6, 0]}>
        <icosahedronGeometry args={[0.85, 0]} />
        <meshStandardMaterial color={PALETTE.bone} roughness={0.5} metalness={0.15} flatShading />
      </mesh>
    </group>
  )
}

// Three-point lighting: key (warm, casts shadow), fill (soft, opposite),
// rim/back (cool, separates forms from the paper background).
function ThreePointLight() {
  const key = useRef()
  return (
    <>
      <ambientLight intensity={0.35} />

      {/* Key */}
      <directionalLight
        ref={key}
        position={[5, 7, 5]}
        intensity={2.1}
        color="#fff6ec"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
      >
        <orthographicCamera attach="shadow-camera" args={[-8, 8, 8, -8, 0.1, 30]} />
      </directionalLight>

      {/* Fill */}
      <directionalLight position={[-6, 3, 4]} intensity={0.6} color="#e8edf2" />

      {/* Rim / back */}
      <directionalLight position={[0, 4, -8]} intensity={0.9} color="#d6dfe8" />
    </>
  )
}

export default function Scene() {
  return (
    <>
      <ThreePointLight />
      <Primitives />

      {/* Ground — receives shadow only, keeps the airy paper look */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[60, 60]} />
        <shadowMaterial transparent opacity={0.16} />
      </mesh>
    </>
  )
}
