import { useLayoutEffect, useMemo, useRef, Suspense } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import * as THREE from 'three'
import {
  EYE, HORIZON, K_PER_H, LAYERS, D_WORD, CHAPTERS, WORDMARK, S_WORD,
  pagePxToWorld, camXFromScroll, allMembers, ridgeRoofs,
} from './rig.js'

const INK = '#262020'
const WORD = '#d8cdcb'
const RIDGE = '#cbbdba'
const FLOOR = '#e3dad8'
const ORANGE = '#ff7b00'

function Members({ list, color }) {
  const ref = useRef()
  useLayoutEffect(() => {
    const o = new THREE.Object3D()
    const a = new THREE.Vector3(), b = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0)
    list.forEach((m, i) => {
      a.fromArray(m.a); b.fromArray(m.b)
      const len = a.distanceTo(b)
      o.position.copy(a).add(b).multiplyScalar(0.5)
      o.quaternion.setFromUnitVectors(up, b.clone().sub(a).normalize())
      o.scale.set(m.t, len + m.t, m.t)
      o.updateMatrix()
      ref.current.setMatrixAt(i, o.matrix)
    })
    ref.current.instanceMatrix.needsUpdate = true
  }, [list])
  return (
    <instancedMesh ref={ref} args={[null, null, list.length]} frustumCulled={false}>
      <boxGeometry />
      <meshLambertMaterial color={color} />
    </instancedMesh>
  )
}

function Ridge() {
  const roofs = useMemo(ridgeRoofs, [])
  const geos = useMemo(
    () =>
      roofs.map((r) => {
        const s = new THREE.Shape()
        s.moveTo(-r.w / 2, 0)
        s.lineTo(r.w / 2, 0)
        s.lineTo(r.w / 2, r.h)
        s.lineTo(0, r.h + r.roof)
        s.lineTo(-r.w / 2, r.h)
        s.closePath()
        return new THREE.ShapeGeometry(s)
      }),
    [roofs]
  )
  return roofs.map((r, i) => (
    <mesh key={i} geometry={geos[i]} position={[r.x, 0, r.z]}>
      <meshBasicMaterial color={RIDGE} />
    </mesh>
  ))
}

// Orange ticks standing on the word plane. The DOM captions hang from them.
function Ticks() {
  return CHAPTERS.map((c) => (
    <mesh key={c.no} position={[pagePxToWorld(c.px), 0.9, -D_WORD]}>
      <planeGeometry args={[0.07, 1.8]} />
      <meshBasicMaterial color={ORANGE} />
    </mesh>
  ))
}

function Wordmark() {
  const size = WORDMARK.sizePx / S_WORD
  return (
    <Text
      font={import.meta.env.BASE_URL + 'LiberationSans-Regular.ttf'}
      fontSize={size}
      letterSpacing={WORDMARK.tracking}
      anchorX="left"
      anchorY="bottom-baseline"
      position={[pagePxToWorld(WORDMARK.px), 0.02, -D_WORD]}
      color={WORD}
      depthOffset={1} // same plane as the orange ticks; let the ticks win
    >
      {WORDMARK.text}
    </Text>
  )
}

// The camera. Level, shifted, trucked by scroll — nothing else.
function Rig({ scrollRef, readout }) {
  const { camera, size } = useThree()
  const probe = useMemo(() => new THREE.Vector3(), [])
  const x0 = useRef(null)
  useFrame(() => {
    const W = size.width, H = size.height
    const s = scrollRef.current
    // Shift lens, written out: a level camera whose frustum is asymmetric so
    // the horizon lands at HORIZON·H. (setViewOffset gave the same matrix in
    // node, but R3F re-derives the projection on its own schedule; owning the
    // matrix outright is the only version that survives.)
    const n = 0.5, kH = K_PER_H * H
    camera.near = n
    camera.far = 400
    camera.position.set(camXFromScroll(s, H), EYE, 0)
    camera.rotation.set(0, 0, 0)
    camera.projectionMatrix.makePerspective(
      (-n * W) / 2 / kH, (n * W) / 2 / kH,
      (n * HORIZON * H) / kH, (-n * (1 - HORIZON) * H) / kH,
      n, 400
    )
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert()
    camera.updateMatrixWorld()

    // Measure, don't assert: project one fixed point per layer, compare its
    // on-screen travel with the page's scroll.
    const sx = (d) => {
      probe.set(0, EYE, -d).project(camera)
      return (probe.x * 0.5 + 0.5) * W
    }
    if (x0.current === null || x0.current.H !== H || x0.current.W !== W) {
      const c = camera.position.x
      camera.position.x = 0
      camera.updateMatrixWorld()
      x0.current = { W, H, v: LAYERS.map((l) => sx(l.d)) }
      camera.position.x = c
      camera.updateMatrixWorld()
    }
    if (readout.current) {
      LAYERS.forEach((l, i) => {
        const moved = x0.current.v[i] - sx(l.d)
        const el = readout.current[l.key]
        if (el) el.textContent = s > 1 ? (moved / s).toFixed(3) + '×' : '—'
      })
      if (readout.current.cam) readout.current.cam.textContent = camera.position.x.toFixed(2) + ' m'
    }
  })
  return null
}

export default function Scene({ scrollRef, readout }) {
  const { frames, accents } = useMemo(() => {
    const all = allMembers()
    return { frames: all.filter((m) => !m.accent), accents: all.filter((m) => m.accent) }
  }, [])
  return (
    <>
      <color attach="background" args={['#ede6e6']} />
      <fog attach="fog" args={['#ede6e6', 14, 110]} />
      <hemisphereLight args={['#ffffff', '#b9aca9', 1.6]} />
      <directionalLight position={[-6, 10, 8]} intensity={1.4} />
      <Rig scrollRef={scrollRef} readout={readout} />
      {/* The floor starts 1 m in front of the lens, not at it: a vertex on the
          camera plane (w = 0) broke depth and fog interpolation under swiftshader
          and the floor swallowed everything below y ≈ 0.9 m. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[80, 0, -151]}>
        <planeGeometry args={[600, 300, 60, 30]} />
        <meshBasicMaterial color={FLOOR} />
      </mesh>
      <Ridge />
      <Suspense fallback={null}>
        <Wordmark />
      </Suspense>
      <Ticks />
      <Members list={frames} color={INK} />
      <Members list={accents} color={ORANGE} />
    </>
  )
}
