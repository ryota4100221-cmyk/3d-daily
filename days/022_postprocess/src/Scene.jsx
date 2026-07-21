import { useRef, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import {
  EffectComposer,
  DepthOfField,
  Bloom,
  Vignette,
  Noise,
} from '@react-three/postprocessing'
import { BlendFunction } from 'postprocessing'
import * as THREE from 'three'

/* ------------------------------------------------------------------ *
 * Day 022 — Week 4 · POST-PROCESSING  "Aperture"
 * (bloom · depth-of-field · vignette · film grain)
 *
 * Week 4 turns from making the scene to FINISHING the frame. Everything
 * on screen — a scatter of porcelain pebbles and a few terracotta embers,
 * receding into fog — is ordinary lit three.js geometry. The day's new
 * technique is the COMPOSITOR:
 *
 *   NEW TECHNIQUE — AN EFFECTCOMPOSER STACK (@react-three/postprocessing).
 *   The rendered HDR frame is passed through a chain of full-screen passes
 *   before it reaches the display:
 *     • DEPTH OF FIELD — a real bokeh blur keyed off the depth buffer;
 *       only the plane at the focus distance stays sharp, everything else
 *       melts. The cursor RACKS the focus target through the depth of the
 *       field (pointer-as-focus, a fresh interaction after 21 days of
 *       pointer-as-light / pointer-as-force).
 *     • BLOOM (mipmap blur, luminance threshold) — the embers are driven
 *       past 1.0 with emissiveIntensity, so only they cross the threshold
 *       and blossom into soft HDR halos while the porcelain stays matte.
 *     • VIGNETTE — a gentle darkening of the corners frames the still life
 *       like a photograph.
 *     • FILM GRAIN — a whisper of animated noise (OVERLAY blend) breaks up
 *       the flat paper and unifies bloom + bokeh into one photographic image.
 *
 *   Order matters: DoF and Bloom run in HDR, then vignette/grain dress the
 *   result. The renderer keeps ACES tone-mapping so emissive > 1 blooms.
 *
 * monaka palette: bone-porcelain forms, a single terracotta accent burning
 * hot enough to bloom, warm paper fog dissolving the far depth. No troika
 * Text, all procedural — offline-safe, no white-screen loaders.
 * ------------------------------------------------------------------ */

// small deterministic PRNG so the constellation (and the preview) is stable
function mulberry32(a) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const NEAR_Z = 2.6 // front of the depth stack (closest to camera)
const FAR_Z = -12.0 // back of the stack, dissolving into fog

function useConstellation() {
  return useMemo(() => {
    const rnd = mulberry32(0x022a)
    const pebbles = []
    const N = 30
    for (let i = 0; i < N; i++) {
      const tPath = i / (N - 1)
      // depth drives size (far = small) and lateral fan (far = wider spread)
      const z = THREE.MathUtils.lerp(NEAR_Z, FAR_Z, tPath) + (rnd() - 0.5) * 1.4
      const spread = 1.3 + tPath * 3.4
      // bias the mass toward upper-right so the headline keeps the lower-left
      const x = (rnd() - 0.5) * 2 * spread + 0.9
      const y = (rnd() - 0.5) * 2.1 + 0.55
      const size = THREE.MathUtils.lerp(0.5, 0.16, tPath) * (0.7 + rnd() * 0.7)
      // a few become slim rings for silhouette variety; rest are faceted pebbles
      const kind = rnd() < 0.16 ? 'ring' : 'pebble'
      pebbles.push({
        pos: [x, y, z],
        size,
        kind,
        rot: [rnd() * Math.PI, rnd() * Math.PI, rnd() * Math.PI],
        spin: (rnd() - 0.5) * 0.18,
        bob: 0.06 + rnd() * 0.12,
        phase: rnd() * Math.PI * 2,
        tone: 0.86 + rnd() * 0.14, // subtle bone-white variation
      })
    }

    // embers spread across the whole depth so racking focus reveals them
    // one by one — each one sharp only when its plane is in focus.
    const embers = []
    const M = 6
    for (let i = 0; i < M; i++) {
      const tPath = (i + 0.5) / M
      const z = THREE.MathUtils.lerp(NEAR_Z - 0.4, FAR_Z + 1.5, tPath)
      const spread = 1.1 + tPath * 3.0
      const x = (rnd() - 0.5) * 2 * spread * 0.85
      const y = (rnd() - 0.5) * 1.7 + 0.1
      const r = THREE.MathUtils.lerp(0.15, 0.08, tPath)
      embers.push({
        pos: [x, y, z],
        r,
        warm: 0.0 + rnd() * 1.0, // 0 = deep terracotta, 1 = warmer amber
        base: 2.1 + rnd() * 1.3,
        breath: 0.5 + rnd() * 0.9,
        phase: rnd() * Math.PI * 2,
      })
    }
    return { pebbles, embers }
  }, [])
}

function Constellation() {
  const { pebbles, embers } = useConstellation()
  const groupRef = useRef()
  const emberRefs = useRef([])

  const porcelain = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color('#f3eee5'),
        roughness: 0.52,
        metalness: 0.0,
      }),
    [],
  )

  // geometries shared across instances
  const geoPebble = useMemo(() => new THREE.IcosahedronGeometry(1, 1), [])
  const geoRing = useMemo(() => new THREE.TorusGeometry(1, 0.26, 20, 64), [])
  const geoEmber = useMemo(() => new THREE.IcosahedronGeometry(1, 2), [])

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime
    // the whole field drifts with a slow, weightless yaw + breathe
    if (groupRef.current) {
      groupRef.current.rotation.y = Math.sin(t * 0.06) * 0.14
      groupRef.current.position.y = Math.sin(t * 0.22) * 0.06
    }
    // embers breathe past 1.0 so bloom catches them shimmering
    for (let i = 0; i < embers.length; i++) {
      const m = emberRefs.current[i]
      if (!m) continue
      const e = embers[i]
      const pulse = 0.5 + 0.5 * Math.sin(t * e.breath + e.phase)
      m.material.emissiveIntensity = e.base * (0.7 + 0.6 * pulse)
      const s = e.r * (0.96 + 0.08 * pulse)
      m.scale.setScalar(s)
    }
  })

  return (
    <group ref={groupRef}>
      {pebbles.map((p, i) => {
        const c = porcelain.clone()
        c.color = new THREE.Color('#f3eee5').multiplyScalar(p.tone)
        return (
          <mesh
            key={i}
            geometry={p.kind === 'ring' ? geoRing : geoPebble}
            material={c}
            position={p.pos}
            rotation={p.rot}
            scale={p.kind === 'ring' ? p.size * 0.9 : p.size}
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
              toneMapped
            />
          </mesh>
        )
      })}
    </group>
  )
}

// Drives the DoF focus target along the depth of the field from the pointer,
// eases the camera into a shallow parallax, and reports the focus band up.
function FocusRig({ dofRef, onFocus }) {
  const { camera, pointer } = useThree()
  const state = useRef({ t: 0.5, camX: 0, camY: 0.55, label: '' })
  const target = useMemo(() => new THREE.Vector3(0, 0, 0), [])

  useFrame((_, delta) => {
    const s = state.current
    // pointer.y up → focus far, down → focus near (photographic rack focus)
    const want = THREE.MathUtils.clamp(pointer.y * 0.5 + 0.5, 0, 1)
    s.t = THREE.MathUtils.damp(s.t, want, 3.2, delta)
    const focusZ = THREE.MathUtils.lerp(NEAR_Z, FAR_Z, s.t)
    target.set(pointer.x * 1.2, 0, focusZ)
    if (dofRef.current && dofRef.current.target) {
      dofRef.current.target.copy(target)
    }

    // shallow camera parallax so the bokeh has real depth to reveal
    s.camX = THREE.MathUtils.damp(s.camX, pointer.x * 0.7, 2.6, delta)
    s.camY = THREE.MathUtils.damp(s.camY, 0.55 + pointer.y * 0.3, 2.6, delta)
    camera.position.x = s.camX
    camera.position.y = s.camY
    camera.lookAt(0, 0.1, -2.2)

    const label = s.t < 0.34 ? 'near' : s.t < 0.67 ? 'mid' : 'far'
    if (label !== s.label) {
      s.label = label
      onFocus(label)
    }
  })

  return null
}

export default function Scene({ onFocus }) {
  const dofRef = useRef()

  return (
    <>
      <hemisphereLight args={['#fff6ea', '#d8ccb6', 1.05]} />
      <directionalLight position={[4.5, 6, 4]} intensity={2.7} color="#ffe0bc" />
      <directionalLight position={[-5, 2, -3]} intensity={0.6} color="#d2e2ff" />
      <directionalLight position={[0, -1.5, 6]} intensity={0.5} color="#fff1e0" />

      <Constellation />
      <FocusRig dofRef={dofRef} onFocus={onFocus} />

      <EffectComposer multisampling={0} disableNormalPass>
        <DepthOfField
          ref={dofRef}
          target={[0, 0, -1]}
          focalLength={0.026}
          bokehScale={4.2}
        />
        <Bloom
          mipmapBlur
          luminanceThreshold={0.92}
          luminanceSmoothing={0.32}
          intensity={0.85}
          radius={0.72}
        />
        <Vignette eskil={false} offset={0.3} darkness={0.5} />
        <Noise premultiply blendFunction={BlendFunction.OVERLAY} opacity={0.28} />
      </EffectComposer>
    </>
  )
}
