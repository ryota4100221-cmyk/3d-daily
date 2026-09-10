import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Line } from '@react-three/drei'
import * as THREE from 'three'

import {
  N,
  MD,
  RIBBON_P,
  RIBBON_S,
  SPOKE_R,
  WELL,
  pathAt,
  createRig,
  WARM_DEFAULT,
} from './rig.js'

// ── palette ──────────────────────────────────────────────────────────────────
// Taken off the reference site: charcoal ground, one vermilion, everything else
// achromatic. On sstr.tech the accent is 3.4% of the page and lives only on the
// call-to-action. Here it lives only where the rod is turning faster than the
// thing driving it, which is the same discipline pointed at a different fact.
export const INK = {
  bg: '#16181C',
  pipe: '#333A46',
  rail: '#343A44',
  hair: '#4A515C',
  stopped: '#3D444F',
  nominal: '#98A0AC',
  hot: '#FE5B2A',
  dim: '#525A66',
}

const C_STOP = new THREE.Color(INK.stopped)
const C_NOM = new THREE.Color(INK.nominal)
const C_HOT = new THREE.Color(INK.hot)

const DIAL_TOP = [620, -760]
const DIAL_BIT = [1060, -760]
const DIAL_R = 145

function circle(cx, cy, r, n = 72) {
  const p = []
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2
    p.push([cx + r * Math.cos(a), cy + r * Math.sin(a), 0])
  }
  return p
}

export default function Scene({ onFrame, frs }) {
  const rig = useMemo(() => {
    const q = new URLSearchParams(window.location.search).get('warm')
    return createRig(120, q ? Number(q) : WARM_DEFAULT)
  }, [])

  // ── everything that never moves ────────────────────────────────────────────
  const statics = useMemo(() => {
    const axis = []
    const railA = []
    const railB = []
    for (let i = 0; i < N; i++) {
      const p = RIBBON_P[i]
      axis.push([p.x, p.y, 0])
      railA.push([p.x + SPOKE_R * p.nx, p.y + SPOKE_R * p.ny, 0])
      railB.push([p.x - SPOKE_R * p.nx, p.y - SPOKE_R * p.ny, 0])
    }
    const curve = new THREE.CatmullRomCurve3(axis.map((a) => new THREE.Vector3(...a)))
    const tube = new THREE.TubeGeometry(curve, N * 2, 15, 8, false)

    // ground line at the wellhead, with a few hatches
    const ground = [
      [-186, 0, 0],
      [1040, 0, 0],
    ]
    const hatch = []
    for (let x = -140; x <= 1000; x += 76) {
      hatch.push(x, 0, 0, x - 42, -46, 0)
    }

    const dials = [...circle(DIAL_TOP[0], DIAL_TOP[1], DIAL_R), ...[]]
    const dialB = circle(DIAL_BIT[0], DIAL_BIT[1], DIAL_R)

    // 12 o'clock reference ticks and the leader lines back to the rod
    const marks = []
    for (const [cx, cy] of [DIAL_TOP, DIAL_BIT]) {
      marks.push(cx, cy + DIAL_R, 0, cx, cy + DIAL_R * 0.78, 0)
      marks.push(cx - DIAL_R, cy, 0, cx - DIAL_R * 0.9, cy, 0)
      marks.push(cx + DIAL_R, cy, 0, cx + DIAL_R * 0.9, cy, 0)
      marks.push(cx, cy - DIAL_R, 0, cx, cy - DIAL_R * 0.9, 0)
    }

    const bitP = RIBBON_P[N - 1]
    // one straight leader each, from the place the reading is taken
    const leadTop = [
      [0, -110, 0],
      [DIAL_TOP[0] - DIAL_R * 0.72, DIAL_TOP[1] + DIAL_R * 0.72, 0],
    ]
    const leadBit = [
      [bitP.x, bitP.y, 0],
      [DIAL_BIT[0] + DIAL_R * 0.72, DIAL_BIT[1] - DIAL_R * 0.72, 0],
    ]

    // depth ticks every 500 m, on the concave side of the well
    const ticks = []
    for (let s = 0; s <= MD; s += 500) {
      const p = pathAt(Math.min(s, MD - 0.001))
      const o = SPOKE_R + 34
      ticks.push(
        p.x + o * p.nx,
        p.y + o * p.ny,
        0,
        p.x + (o + 34) * p.nx,
        p.y + (o + 34) * p.ny,
        0
      )
    }

    return { axis, railA, railB, tube, ground, hatch, dials, dialB, marks, leadTop, leadBit, ticks }
  }, [])

  // ── everything that does ───────────────────────────────────────────────────
  const ribbonRef = useRef()
  const combRef = useRef()
  const needleTop = useRef()
  const needleBit = useRef()
  const bitDot = useRef()

  const buf = useMemo(
    () => ({
      pos: new Float32Array(N * 3),
      col: new Float32Array(N * 3),
      combPos: new Float32Array(N * 2 * 3),
      combCol: new Float32Array(N * 2 * 3),
      c: new THREE.Color(),
      trace: new Float64Array(180),
    }),
    []
  )

  const combGeom = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(buf.combPos, 3))
    g.setAttribute('color', new THREE.BufferAttribute(buf.combCol, 3))
    return g
  }, [buf])

  const OMEGA0 = (120 * 2 * Math.PI) / 60

  useFrame((_, delta) => {
    rig.setFrs(frs)
    rig.step(delta)

    const { theta, omega } = rig
    for (let i = 0; i < N; i++) {
      const p = RIBBON_P[i]
      const th = theta[i]
      const ct = Math.cos(th)
      const st = Math.sin(th)
      const x = p.x + SPOKE_R * ct * p.nx
      const y = p.y + SPOKE_R * ct * p.ny
      const z = SPOKE_R * st

      buf.pos[i * 3] = x
      buf.pos[i * 3 + 1] = y
      buf.pos[i * 3 + 2] = z

      // colour is the local turning rate, nothing else
      const u = omega[i] / OMEGA0
      if (u < 1) buf.c.copy(C_STOP).lerp(C_NOM, Math.max(0, u))
      else buf.c.copy(C_NOM).lerp(C_HOT, Math.min(1, (u - 1) / 1.8))
      buf.col[i * 3] = buf.c.r
      buf.col[i * 3 + 1] = buf.c.g
      buf.col[i * 3 + 2] = buf.c.b

      const k = i * 6
      buf.combPos[k] = p.x
      buf.combPos[k + 1] = p.y
      buf.combPos[k + 2] = 0
      buf.combPos[k + 3] = x
      buf.combPos[k + 4] = y
      buf.combPos[k + 5] = z
      for (let j = 0; j < 2; j++) {
        buf.combCol[k + j * 3] = buf.c.r * (j ? 1 : 0.35)
        buf.combCol[k + j * 3 + 1] = buf.c.g * (j ? 1 : 0.35)
        buf.combCol[k + j * 3 + 2] = buf.c.b * (j ? 1 : 0.35)
      }
    }

    if (ribbonRef.current) {
      ribbonRef.current.geometry.setPositions(buf.pos)
      ribbonRef.current.geometry.setColors(buf.col)
    }
    combGeom.attributes.position.needsUpdate = true
    combGeom.attributes.color.needsUpdate = true

    const r = rig.readout()

    if (needleTop.current) {
      const a = r.thetaTop
      needleTop.current.geometry.setPositions([
        DIAL_TOP[0],
        DIAL_TOP[1],
        1,
        DIAL_TOP[0] + DIAL_R * 0.84 * Math.sin(a),
        DIAL_TOP[1] + DIAL_R * 0.84 * Math.cos(a),
        1,
      ])
    }
    if (needleBit.current) {
      const a = r.thetaBit
      needleBit.current.geometry.setPositions([
        DIAL_BIT[0],
        DIAL_BIT[1],
        1,
        DIAL_BIT[0] + DIAL_R * 0.84 * Math.sin(a),
        DIAL_BIT[1] + DIAL_R * 0.84 * Math.cos(a),
        1,
      ])
    }
    if (bitDot.current) {
      const u = Math.min(1, Math.max(0, r.bitRpm / 240))
      bitDot.current.material.color.copy(C_STOP).lerp(C_HOT, Math.sqrt(u))
      bitDot.current.material.emissive.copy(C_HOT).multiplyScalar(0.15 + 0.85 * u)
    }

    onFrame(r, rig.trace(buf.trace, 20))
  })

  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight position={[-2000, 2400, 5200]} intensity={1.5} />
      <directionalLight position={[3200, -1800, 2600]} intensity={0.4} color="#7E8798" />

      {/* the hole */}
      <mesh geometry={statics.tube}>
        <meshStandardMaterial color={INK.pipe} roughness={0.72} metalness={0.35} />
      </mesh>

      {/* the two rails the painted stripe can never leave */}
      <Line points={statics.railA} color={INK.rail} lineWidth={1} transparent opacity={0.85} />
      <Line points={statics.railB} color={INK.rail} lineWidth={1} transparent opacity={0.85} />

      {/* ground */}
      <Line points={statics.ground} color={INK.dim} lineWidth={1.2} />
      <lineSegments>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[new Float32Array(statics.hatch), 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={INK.dim} transparent opacity={0.55} />
      </lineSegments>

      {/* depth ticks */}
      <lineSegments>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[new Float32Array(statics.ticks), 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={INK.dim} />
      </lineSegments>

      {/* the comb: one hair per node, from the axis out to the stripe */}
      <lineSegments geometry={combGeom} frustumCulled={false}>
        <lineBasicMaterial vertexColors transparent opacity={0.62} />
      </lineSegments>

      {/* the stripe */}
      <Line
        ref={ribbonRef}
        points={statics.axis}
        vertexColors={statics.axis.map(() => [1, 1, 1])}
        lineWidth={3}
      />

      {/* bit */}
      <mesh ref={bitDot} position={[RIBBON_P[N - 1].x, RIBBON_P[N - 1].y, 0]}>
        <sphereGeometry args={[21, 20, 16]} />
        <meshStandardMaterial color={INK.hot} emissive={INK.hot} emissiveIntensity={0.6} />
      </mesh>

      {/* two faces of one shaft */}
      <Line points={statics.dials} color={INK.dim} lineWidth={1.3} />
      <Line points={statics.dialB} color={INK.dim} lineWidth={1.3} />
      <lineSegments>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[new Float32Array(statics.marks), 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={INK.dim} />
      </lineSegments>
      <Line points={statics.leadTop} color={INK.rail} lineWidth={1} dashed dashScale={0.06} transparent opacity={0.7} />
      <Line points={statics.leadBit} color={INK.rail} lineWidth={1} dashed dashScale={0.06} transparent opacity={0.7} />
      <Line
        ref={needleTop}
        points={[
          [DIAL_TOP[0], DIAL_TOP[1], 1],
          [DIAL_TOP[0], DIAL_TOP[1] + DIAL_R * 0.84, 1],
        ]}
        color={INK.nominal}
        lineWidth={2.6}
      />
      <Line
        ref={needleBit}
        points={[
          [DIAL_BIT[0], DIAL_BIT[1], 1],
          [DIAL_BIT[0], DIAL_BIT[1] + DIAL_R * 0.84, 1],
        ]}
        color={INK.hot}
        lineWidth={2.6}
      />
    </>
  )
}

export { DIAL_TOP, DIAL_BIT, DIAL_R, WELL, RIBBON_S }
