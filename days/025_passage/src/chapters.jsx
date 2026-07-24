import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

/* ------------------------------------------------------------------ *
 * Three curated "chapters" — minimal porcelain still lifes built from
 * the month's vocabulary. Each is rendered into its OWN off-screen
 * scene (see Compositor) so the transition shader can cross-blend two
 * whole worlds. Shared: a soft fake contact-shadow decal + porcelain
 * physical material lit by the procedural env.
 * ------------------------------------------------------------------ */

// one soft radial shadow texture, reused as a ground decal (cheap, robust,
// avoids per-scene shadow-map setup inside our manual render loop)
function useShadowTex() {
  return useMemo(() => {
    const s = 256
    const cv = document.createElement('canvas')
    cv.width = cv.height = s
    const ctx = cv.getContext('2d')
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
    g.addColorStop(0.0, 'rgba(20,18,15,0.42)')
    g.addColorStop(0.55, 'rgba(20,18,15,0.16)')
    g.addColorStop(1.0, 'rgba(20,18,15,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, s, s)
    const t = new THREE.CanvasTexture(cv)
    t.colorSpace = THREE.SRGBColorSpace
    return t
  }, [])
}

function Ground({ shadowTex, color = '#e7e1d5', shadow = 3.4, y = -1.02 }) {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, y, 0]}>
        <planeGeometry args={[60, 60]} />
        <meshStandardMaterial color={color} roughness={0.96} metalness={0} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, y + 0.002, 0.1]}>
        <planeGeometry args={[shadow, shadow]} />
        <meshBasicMaterial
          map={shadowTex}
          transparent
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  )
}

function porcelain(env, extra = {}) {
  return (
    <meshPhysicalMaterial
      color="#efeae0"
      roughness={0.42}
      metalness={0}
      clearcoat={0.7}
      clearcoatRoughness={0.32}
      envMap={env}
      envMapIntensity={0.85}
      sheen={0.4}
      sheenColor="#d8cfc0"
      {...extra}
    />
  )
}

/* ---- Chapter I — Origin: a single porcelain sphere + tilted ring ---- */
export function ChapterOrigin({ env }) {
  const shadowTex = useShadowTex()
  const g = useRef()
  useFrame((s) => {
    if (g.current) g.current.rotation.y = s.clock.elapsedTime * 0.12
  })
  return (
    <group>
      <hemisphereLight args={['#fbf6ec', '#b9b2a4', 0.55]} />
      <directionalLight position={[4, 6, 5]} intensity={1.5} color="#fff3e0" />
      <pointLight position={[-5, 2, 3]} intensity={0.5} color="#cfe0ea" />
      <Ground shadowTex={shadowTex} shadow={3.6} />
      <group ref={g}>
        <mesh castShadow position={[0, -0.15, 0]}>
          <sphereGeometry args={[0.92, 96, 96]} />
          {porcelain(env)}
        </mesh>
        <mesh rotation={[Math.PI * 0.32, 0.3, 0.1]} position={[0.1, 0.2, 0]}>
          <torusGeometry args={[1.42, 0.045, 32, 160]} />
          {porcelain(env, { clearcoat: 0.9, roughness: 0.3 })}
        </mesh>
        {/* a single terracotta accent bead orbiting the ring */}
        <mesh position={[1.42, 0.2, 0]}>
          <sphereGeometry args={[0.1, 32, 32]} />
          <meshStandardMaterial
            color="#c8663a"
            emissive="#c8663a"
            emissiveIntensity={0.9}
            roughness={0.5}
          />
        </mesh>
      </group>
    </group>
  )
}

/* ---- Chapter II — Assembly: a ring of pebbles around an ember ---- */
export function ChapterAssembly({ env }) {
  const shadowTex = useShadowTex()
  const inst = useRef()
  const N = 14
  const data = useMemo(() => {
    const a = []
    for (let i = 0; i < N; i++) {
      const ang = (i / N) * Math.PI * 2
      const r = 1.55
      a.push({
        pos: [Math.cos(ang) * r, -0.55 + Math.sin(i * 2.3) * 0.12, Math.sin(ang) * r],
        s: 0.34 + ((i * 7) % 5) * 0.05,
        rot: ang,
      })
    }
    return a
  }, [])
  const dummy = useMemo(() => new THREE.Object3D(), [])
  useFrame((s) => {
    const t = s.clock.elapsedTime
    if (!inst.current) return
    data.forEach((d, i) => {
      dummy.position.set(d.pos[0], d.pos[1] + Math.sin(t * 0.6 + i) * 0.04, d.pos[2])
      dummy.rotation.set(d.rot, t * 0.15 + i, d.rot * 0.5)
      dummy.scale.setScalar(d.s)
      dummy.updateMatrix()
      inst.current.setMatrixAt(i, dummy.matrix)
    })
    inst.current.instanceMatrix.needsUpdate = true
    inst.current.parent.rotation.y = t * 0.1
  })
  return (
    <group>
      <hemisphereLight args={['#fef3e6', '#a89f8f', 0.5]} />
      <directionalLight position={[5, 5, 4]} intensity={1.4} color="#ffe9cf" />
      <pointLight position={[0, 1.4, 0]} intensity={1.2} color="#c8663a" distance={6} />
      <Ground shadowTex={shadowTex} shadow={4.4} />
      <group>
        {/* central ember */}
        <mesh position={[0, -0.35, 0]}>
          <icosahedronGeometry args={[0.62, 4]} />
          <meshStandardMaterial
            color="#c8663a"
            emissive="#c8663a"
            emissiveIntensity={1.4}
            roughness={0.45}
            metalness={0}
          />
        </mesh>
        <instancedMesh ref={inst} args={[undefined, undefined, N]} castShadow>
          <dodecahedronGeometry args={[1, 0]} />
          {porcelain(env, { roughness: 0.5, clearcoat: 0.5 })}
        </instancedMesh>
      </group>
    </group>
  )
}

/* ---- Chapter III — Ascent: a cool stacked cairn ---- */
export function ChapterAscent({ env }) {
  const shadowTex = useShadowTex()
  const g = useRef()
  useFrame((s) => {
    if (g.current) g.current.rotation.y = -0.35 + Math.sin(s.clock.elapsedTime * 0.18) * 0.4
  })
  const stack = useMemo(
    () => [
      { y: -0.72, s: [1.1, 0.42, 1.1], r: 0.08 },
      { y: -0.18, s: [0.88, 0.44, 0.88], r: -0.16 },
      { y: 0.34, s: [0.66, 0.4, 0.66], r: 0.22 },
      { y: 0.8, s: [0.46, 0.36, 0.46], r: -0.1 },
    ],
    [],
  )
  return (
    <group>
      <hemisphereLight args={['#eef2f6', '#9aa1a8', 0.6]} />
      <directionalLight position={[-4, 6, 4]} intensity={1.3} color="#eaf1f8" />
      <pointLight position={[4, 1, 3]} intensity={0.6} color="#ffd9b0" />
      <Ground shadowTex={shadowTex} shadow={3.2} color="#e5e2dc" />
      <group ref={g}>
        {stack.map((b, i) => (
          <mesh key={i} position={[0, b.y, 0]} rotation={[0, b.r, 0]}>
            <boxGeometry args={[b.s[0], b.s[1], b.s[2], 2, 2, 2]} />
            {porcelain(env, {
              color: '#e9ecef',
              sheenColor: '#c3ccd4',
              clearcoat: 0.85,
              roughness: 0.36,
            })}
          </mesh>
        ))}
        {/* a thin terracotta seam threading the stack */}
        <mesh position={[0, 0.05, 0.001]}>
          <boxGeometry args={[0.05, 1.85, 0.05]} />
          <meshStandardMaterial
            color="#c8663a"
            emissive="#c8663a"
            emissiveIntensity={1.1}
            roughness={0.5}
          />
        </mesh>
      </group>
    </group>
  )
}

export const CHAPTERS = [
  { key: 'origin', name: 'Origin', Comp: ChapterOrigin, env: { top: '#efe9dd', bottom: '#cfc7b6', key: 'rgba(255,236,205,0.95)', fill: 'rgba(180,196,210,0.6)' } },
  { key: 'assembly', name: 'Assembly', Comp: ChapterAssembly, env: { top: '#f0e7d9', bottom: '#d2b79c', key: 'rgba(255,214,160,0.95)', fill: 'rgba(200,102,58,0.5)' } },
  { key: 'ascent', name: 'Ascent', Comp: ChapterAscent, env: { top: '#eef1f4', bottom: '#c3c9cf', key: 'rgba(240,246,252,0.95)', fill: 'rgba(255,214,176,0.45)' } },
]
