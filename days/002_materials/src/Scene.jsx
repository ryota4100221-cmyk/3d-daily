import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  Environment,
  Lightformer,
  ContactShadows,
  Float,
} from '@react-three/drei'
import * as THREE from 'three'
import SafeText from './SafeText.jsx'

// Real .ttf asset served from /public — troika loads it reliably (data-URI fonts
// failed to load in-worker and blanked the whole scene). BASE_URL keeps it valid
// under the GitHub Pages sub-path.
const fontUrl = `${import.meta.env.BASE_URL}liberationSans.ttf`

// Restrained palette — warm paper + graphite, one terracotta accent.
const PALETTE = {
  graphite: '#2b2a28',
  stone: '#cfc8bd',
  bone: '#ece8e1',
  accent: '#c4592f',
}

// --- A toon gradient ramp: a tiny 1-D step texture, nearest-filtered, so the
// toon material quantises light into hard bands instead of a smooth falloff.
function useGradientMap(steps = 4) {
  return useMemo(() => {
    const data = new Uint8Array(steps)
    for (let i = 0; i < steps; i++) data[i] = Math.round((i / (steps - 1)) * 255)
    const tex = new THREE.DataTexture(data, steps, 1, THREE.RedFormat)
    tex.magFilter = THREE.NearestFilter
    tex.minFilter = THREE.NearestFilter
    tex.needsUpdate = true
    return tex
  }, [steps])
}

// --- The study: a 5x5 grid. Roughness sweeps across X, metalness up Y.
// The single clearest way to *read* a PBR surface model at a glance.
function MetalRoughGrid({ position }) {
  const N = 5
  const gap = 1.18
  const span = (N - 1) * gap
  const cells = useMemo(() => {
    const out = []
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        out.push({
          key: `${r}-${c}`,
          x: c * gap - span / 2,
          y: r * gap - span / 2,
          roughness: c / (N - 1),
          metalness: r / (N - 1),
        })
      }
    }
    return out
  }, [])

  return (
    <group position={position}>
      {cells.map((cell) => (
        <mesh key={cell.key} position={[cell.x, cell.y, 0]} castShadow>
          <sphereGeometry args={[0.46, 48, 48]} />
          <meshStandardMaterial
            color={PALETTE.bone}
            roughness={cell.roughness}
            metalness={cell.metalness}
            envMapIntensity={1.1}
          />
        </mesh>
      ))}

      {/* Axis labels — English typographic captions, monaka-minimal. */}
      <SafeText
        font={fontUrl}
        position={[0, -span / 2 - 1.0, 0]}
        fontSize={0.26}
        letterSpacing={0.18}
        color={PALETTE.graphite}
        anchorX="center"
      >
        ROUGHNESS  →
      </SafeText>
      <SafeText
        font={fontUrl}
        position={[-span / 2 - 1.0, 0, 0]}
        rotation={[0, 0, Math.PI / 2]}
        fontSize={0.26}
        letterSpacing={0.18}
        color={PALETTE.graphite}
        anchorX="center"
      >
        METALNESS  →
      </SafeText>
    </group>
  )
}

// --- The trio: the same form rendered with three different material models,
// so the lighting model itself becomes the subject.
function MaterialHero({ kind, color, gradientMap }) {
  const ref = useRef()
  useFrame((state) => {
    if (ref.current) ref.current.rotation.y = state.clock.elapsedTime * 0.18
  })

  let material
  if (kind === 'standard') {
    material = <meshStandardMaterial color={color} roughness={0.32} metalness={0.0} envMapIntensity={1} />
  } else if (kind === 'physical') {
    material = (
      <meshPhysicalMaterial
        color={color}
        roughness={0.34}
        metalness={0}
        clearcoat={1}
        clearcoatRoughness={0.12}
        sheen={0.5}
        sheenColor={'#ffffff'}
        envMapIntensity={1.1}
      />
    )
  } else {
    material = <meshToonMaterial color={color} gradientMap={gradientMap} />
  }

  return (
    <mesh ref={ref} castShadow>
      <sphereGeometry args={[0.62, 64, 64]} />
      {material}
    </mesh>
  )
}

function HeroColumn({ position, gradientMap }) {
  const rows = [
    { kind: 'standard', label: 'STANDARD', color: PALETTE.stone },
    { kind: 'physical', label: 'PHYSICAL', color: PALETTE.accent },
    { kind: 'toon', label: 'TOON', color: '#857c70' },
  ]
  const step = 1.7
  return (
    <group position={position}>
      {rows.map((row, i) => {
        const y = (rows.length - 1 - i) * step - step // top -> bottom
        return (
          <group key={row.kind} position={[0, y, 0]}>
            <Float speed={1.4} rotationIntensity={0} floatIntensity={0.5} floatingRange={[-0.06, 0.06]}>
              <MaterialHero kind={row.kind} color={row.color} gradientMap={gradientMap} />
            </Float>
            <SafeText
              font={fontUrl}
              position={[1.05, 0, 0]}
              fontSize={0.2}
              letterSpacing={0.22}
              color={PALETTE.graphite}
              anchorX="left"
              anchorY="middle"
            >
              {row.label}
            </SafeText>
          </group>
        )
      })}
    </group>
  )
}

// --- Procedural studio environment built from light panels (no external HDRI
// fetch). Gives the standard/physical surfaces something to reflect.
function StudioEnvironment() {
  return (
    <Environment resolution={256}>
      <color attach="background" args={['#15140f']} />
      <Lightformer
        form="rect"
        intensity={3}
        position={[0, 5, -6]}
        scale={[14, 6, 1]}
        color="#fff4e6"
      />
      <Lightformer
        form="rect"
        intensity={1.4}
        position={[-7, 2, 2]}
        rotation={[0, Math.PI / 2.4, 0]}
        scale={[8, 8, 1]}
        color="#dfe6ee"
      />
      <Lightformer
        form="rect"
        intensity={1.1}
        position={[7, 2, 2]}
        rotation={[0, -Math.PI / 2.4, 0]}
        scale={[8, 8, 1]}
        color="#ffffff"
      />
      <Lightformer
        form="circle"
        intensity={2}
        position={[0, 6, 4]}
        scale={4}
        color="#fff"
      />
    </Environment>
  )
}

export default function Scene() {
  const gradientMap = useGradientMap(4)

  return (
    <>
      <StudioEnvironment />

      {/* Direct key + fill on top of the IBL, for crisp shadows. */}
      <ambientLight intensity={0.25} />
      <directionalLight
        position={[5, 8, 5]}
        intensity={1.6}
        color="#fff6ec"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
      >
        <orthographicCamera attach="shadow-camera" args={[-12, 12, 12, -12, 0.1, 40]} />
      </directionalLight>
      <directionalLight position={[-6, 3, 4]} intensity={0.4} color="#e8edf2" />

      <HeroColumn position={[-4.6, 1.4, 0]} gradientMap={gradientMap} />
      <MetalRoughGrid position={[2.9, 1.4, 0]} />

      <ContactShadows
        position={[0, -1.35, 0]}
        scale={26}
        far={9}
        blur={2.8}
        opacity={0.32}
        color="#3a352c"
      />
    </>
  )
}
