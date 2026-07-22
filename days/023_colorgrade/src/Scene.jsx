import { useRef, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { ContactShadows, Environment, Lightformer } from '@react-three/drei'
import { EffectComposer, Bloom, Vignette, Noise } from '@react-three/postprocessing'
import { BlendFunction } from 'postprocessing'
import * as THREE from 'three'
import { Grade, gradeAt, WORLDS } from './GradeEffect.jsx'

/* ------------------------------------------------------------------ *
 * Day 023 — Week 4 · COLOR GRADING  "Chroma"
 *
 * The scene is deliberately neutral — a small monument of porcelain forms
 * and a few terracotta embers on a soft floor, lit with plain three.js
 * lights and a procedural studio environment (offline-safe, no HDRI fetch).
 * All the day's drama lives in the GRADE: a custom color-grading Effect
 * (see GradeEffect.js) owns the tone map and the look, and the pointer
 * dissolves the whole frame between three complete worlds.
 *
 *   compositor order:  Bloom (HDR) → Grade (tone map + look) → Vignette → Grain
 *   renderer:          NoToneMapping — the Grade performs the display transform
 * ------------------------------------------------------------------ */

function mulberry32(a) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function useStillLife() {
  return useMemo(() => {
    const rnd = mulberry32(0x023c)
    // pebbles fanned to the upper / centre-right, leaving the lower-left open
    // for the headline. depth gives the grade room to read across the frame.
    const pebbles = []
    const N = 11
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1)
      const x = 0.6 + (rnd() - 0.35) * 4.2
      const y = 0.2 + (rnd() - 0.4) * 2.6
      const z = THREE.MathUtils.lerp(1.4, -4.5, t) + (rnd() - 0.5) * 1.2
      const size = THREE.MathUtils.lerp(0.62, 0.24, t) * (0.8 + rnd() * 0.5)
      const kind = rnd() < 0.22 ? 'ring' : 'pebble'
      pebbles.push({
        pos: [x, y, z],
        size,
        kind,
        rot: [rnd() * Math.PI, rnd() * Math.PI, rnd() * Math.PI],
        tone: 0.88 + rnd() * 0.12,
      })
    }
    // embers seeded so bloom + the grade's highlight tint have something hot
    const embers = []
    const M = 4
    for (let i = 0; i < M; i++) {
      const x = (rnd() - 0.4) * 4.5 + 0.4
      const y = (rnd() - 0.5) * 1.9 + 0.1
      const z = THREE.MathUtils.lerp(1.0, -3.5, (i + 0.5) / M)
      embers.push({
        pos: [x, y, z],
        r: 0.1 + rnd() * 0.06,
        warm: rnd(),
        base: 2.0 + rnd() * 1.4,
        breath: 0.5 + rnd() * 0.8,
        phase: rnd() * Math.PI * 2,
      })
    }
    return { pebbles, embers }
  }, [])
}

function StillLife() {
  const { pebbles, embers } = useStillLife()
  const groupRef = useRef()
  const emberRefs = useRef([])

  const geoPebble = useMemo(() => new THREE.IcosahedronGeometry(1, 2), [])
  const geoRing = useMemo(() => new THREE.TorusGeometry(1, 0.24, 24, 80), [])
  const geoHero = useMemo(() => new THREE.SphereGeometry(1, 96, 96), [])
  const geoEmber = useMemo(() => new THREE.IcosahedronGeometry(1, 2), [])

  // porcelain: physical clearcoat so the procedural studio reflects and the
  // grade has real speculars to push around. cloned per-pebble for tone jitter.
  const porcelain = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: new THREE.Color('#f2ece1'),
        roughness: 0.45,
        metalness: 0.0,
        clearcoat: 0.6,
        clearcoatRoughness: 0.35,
        sheen: 0.4,
        sheenColor: new THREE.Color('#ffe9d2'),
      }),
    [],
  )

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime
    if (groupRef.current) {
      groupRef.current.rotation.y = Math.sin(t * 0.05) * 0.16
      groupRef.current.position.y = Math.sin(t * 0.2) * 0.05
    }
    for (let i = 0; i < embers.length; i++) {
      const m = emberRefs.current[i]
      if (!m) continue
      const e = embers[i]
      const pulse = 0.5 + 0.5 * Math.sin(t * e.breath + e.phase)
      m.material.emissiveIntensity = e.base * (0.7 + 0.6 * pulse)
      m.scale.setScalar(e.r * (0.96 + 0.08 * pulse))
    }
  })

  return (
    <group ref={groupRef}>
      {/* hero form — a single calm porcelain sphere anchoring the composition */}
      <mesh geometry={geoHero} material={porcelain} position={[0.7, 0.35, -0.4]} scale={1.35} />

      {pebbles.map((p, i) => {
        const c = porcelain.clone()
        c.color = new THREE.Color('#f2ece1').multiplyScalar(p.tone)
        return (
          <mesh
            key={i}
            geometry={p.kind === 'ring' ? geoRing : geoPebble}
            material={c}
            position={p.pos}
            rotation={p.rot}
            scale={p.kind === 'ring' ? p.size * 0.95 : p.size}
          />
        )
      })}

      {embers.map((e, i) => {
        const col = new THREE.Color('#c8663a').lerp(new THREE.Color('#e79a54'), e.warm)
        return (
          <mesh
            key={`e${i}`}
            ref={(el) => (emberRefs.current[i] = el)}
            geometry={geoEmber}
            position={e.pos}
            scale={e.r}
          >
            <meshStandardMaterial
              color="#1a1712"
              emissive={col}
              emissiveIntensity={e.base}
              roughness={0.4}
              metalness={0.0}
            />
          </mesh>
        )
      })}
    </group>
  )
}

// Reads the pointer, damps a position along the 0..(N-1) world axis, and
// writes the resolved grade into the custom Effect every frame. Also eases a
// shallow camera parallax and reports the active world up to the HUD.
function GradeRig({ gradeRef, onGrade }) {
  const { camera, pointer } = useThree()
  const s = useRef({ p: 1.0, camX: 0, camY: 0.6, idx: -1 })
  const last = useRef(0)
  // optional deep-link: ?grade=0..2 pins the world (0=Bone, 1=Amber, 2=Nocturne)
  const pinned = useMemo(() => {
    const q = new URLSearchParams(window.location.search).get('grade')
    if (q === null) return null
    const v = parseFloat(q)
    return Number.isFinite(v) ? THREE.MathUtils.clamp(v, 0, WORLDS.length - 1) : null
  }, [])

  useFrame((state, delta) => {
    const st = s.current
    // pointer.x ∈ [-1,1] → axis position across the three worlds [0..N-1]
    const span = WORLDS.length - 1
    const want =
      pinned !== null
        ? pinned
        : THREE.MathUtils.clamp((pointer.x * 0.5 + 0.5) * span, 0, span)
    st.p = THREE.MathUtils.damp(st.p, want, 3.4, delta)

    if (gradeRef.current) gradeRef.current.applyGrade(gradeAt(st.p))

    // shallow parallax keeps the still life breathing without stealing focus
    st.camX = THREE.MathUtils.damp(st.camX, pointer.x * 0.6, 2.4, delta)
    st.camY = THREE.MathUtils.damp(st.camY, 0.6 + pointer.y * 0.28, 2.4, delta)
    camera.position.x = st.camX
    camera.position.y = st.camY
    camera.lookAt(0.3, 0.15, -0.6)

    // throttle HUD updates (idx + continuous position) to ~10/s
    const idx = Math.round(st.p)
    const now = state.clock.elapsedTime
    if (idx !== st.idx || now - last.current > 0.1) {
      st.idx = idx
      last.current = now
      onGrade({ p: st.p, idx })
    }
  })

  return null
}

export default function Scene({ onGrade }) {
  const gradeRef = useRef()

  return (
    <>
      <hemisphereLight args={['#fff6ea', '#cdbfa6', 0.9]} />
      <directionalLight position={[4.5, 6, 4]} intensity={2.4} color="#ffe6c6" />
      <directionalLight position={[-5, 2.5, -2]} intensity={0.7} color="#cfe0ff" />
      <directionalLight position={[0, -1.5, 6]} intensity={0.4} color="#fff1e0" />

      {/* procedural studio — soft key + rim panels, baked once, no HDRI fetch */}
      <Environment resolution={256} frames={1}>
        <color attach="background" args={['#2a2723']} />
        <Lightformer intensity={2.2} position={[3, 3, 2]} scale={[6, 6, 1]} color="#fff3e0" />
        <Lightformer intensity={0.9} position={[-4, 1, -2]} scale={[5, 5, 1]} color="#bcd0ff" />
        <Lightformer intensity={1.1} position={[0, -3, 3]} scale={[8, 3, 1]} color="#ffe9cf" />
      </Environment>

      <StillLife />

      <ContactShadows
        position={[0, -1.6, 0]}
        opacity={0.42}
        scale={16}
        blur={2.6}
        far={5}
        color="#2a2015"
      />

      <GradeRig gradeRef={gradeRef} onGrade={onGrade} />

      {/* Bloom runs in HDR (embers cross the threshold), then our custom Grade
          performs the tone map + the look, then vignette + grain finish. */}
      <EffectComposer multisampling={4} disableNormalPass>
        <Bloom
          mipmapBlur
          luminanceThreshold={0.9}
          luminanceSmoothing={0.3}
          intensity={0.8}
          radius={0.7}
        />
        <Grade ref={gradeRef} />
        <Vignette eskil={false} offset={0.28} darkness={0.52} />
        <Noise premultiply blendFunction={BlendFunction.OVERLAY} opacity={0.24} />
      </EffectComposer>
    </>
  )
}
