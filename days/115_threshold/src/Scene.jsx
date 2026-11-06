// Day 115 — 数字の間に立つ扉。正面の望遠で組んだ夜の邸宅の外壁。
// z=0 の外壁の面で 1 px = 0.01 m。P(px, py) で ref.png の画面座標から置く。
import * as THREE from 'three'
import { useMemo, useRef, useLayoutEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { RoundedBox } from '@react-three/drei'
import * as T from './textures.js'

export const CAM = { y: 3.45, z: 16.8, fov: 30 }
const px = (x) => (x - 720) * 0.01
const py = (y) => (795 - y) * 0.01

function useMats() {
  return useMemo(() => {
    const plasterMap = T.plaster()
    plasterMap.repeat.set(1 / 3, 1 / 3)
    const stoneMap = T.stone(3)
    const stoneMap2 = T.stone(9, '#b2a689')
    const slateMap = T.slate()
    slateMap.wrapS = slateMap.wrapT = THREE.RepeatWrapping
    const doorMap = T.paintedWood('#1f2c1d', 4)
    const shutMap = T.paintedWood('#8b8279', 6)
    return {
      wall: new THREE.MeshStandardMaterial({ map: plasterMap, roughness: 0.95, color: '#ffffff' }),
      stone: new THREE.MeshStandardMaterial({ map: stoneMap, roughness: 0.9, color: '#cdc6b4' }),
      stone2: new THREE.MeshStandardMaterial({ map: stoneMap2, roughness: 0.92, color: '#c8c1ae' }),
      plinth: new THREE.MeshStandardMaterial({ map: stoneMap2, roughness: 0.95, color: '#8a8272' }),
      slate: new THREE.MeshStandardMaterial({ map: slateMap, roughness: 0.75, color: '#d9cdb6', emissive: '#211d14' }),
      door: new THREE.MeshStandardMaterial({ map: doorMap, roughness: 0.55, color: '#ffffff' }),
      shutter: new THREE.MeshStandardMaterial({ map: shutMap, roughness: 0.8 }),
      dark: new THREE.MeshStandardMaterial({ color: '#0b0b07', roughness: 1 }),
      gutter: new THREE.MeshStandardMaterial({ color: '#6b5640', roughness: 0.35, metalness: 0.2 }),
      cornice: new THREE.MeshStandardMaterial({ map: stoneMap, roughness: 0.9, color: '#d8d0bc' }),
      brass: new THREE.MeshStandardMaterial({ color: '#b07a2e', roughness: 0.3, metalness: 0.9 }),
      sky: new THREE.MeshBasicMaterial({ map: T.sky(), toneMapped: false }),
      interior: new THREE.MeshBasicMaterial({ color: '#f0c27a', toneMapped: false }),
    }
  }, [])
}

function Box({ x0, x1, y0, y1, z0 = 0, z1 = 0.1, mat, cast = true, receive = true, bevel = 0 }) {
  if (bevel > 0)
    return (
      <RoundedBox args={[x1 - x0, y1 - y0, z1 - z0]} radius={bevel} smoothness={2} position={[(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]} material={mat} castShadow={cast} receiveShadow={receive} />
    )
  return (
    <mesh position={[(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]} material={mat} castShadow={cast} receiveShadow={receive}>
      <boxGeometry args={[x1 - x0, y1 - y0, z1 - z0]} />
    </mesh>
  )
}

// 外壁：アーチの穴を抜いた板。厚さが開口の見込みになる
function Wall({ m }) {
  const geo = useMemo(() => {
    const s = new THREE.Shape()
    s.moveTo(-10, -0.8)
    s.lineTo(10, -0.8)
    s.lineTo(10, 5.0)
    s.lineTo(-10, 5.0)
    s.lineTo(-10, -0.8)
    const h = new THREE.Path()
    const R = 1.1, cy = 3.0
    h.moveTo(-R, 0)
    h.lineTo(-R, cy)
    h.absarc(0, cy, R, Math.PI, 0, true)
    h.lineTo(R, 0)
    h.lineTo(-R, 0)
    s.holes.push(h)
    return new THREE.ExtrudeGeometry(s, { depth: 0.4, bevelEnabled: false, curveSegments: 48 })
  }, [])
  return <mesh geometry={geo} material={m.wall} position={[0, 0, -0.4]} receiveShadow castShadow />
}

// 付け柱：横目地で切った切石を積む
function Pilaster({ side, m }) {
  const x0 = side < 0 ? -1.92 : 1.1, x1 = side < 0 ? -1.1 : 1.92
  const blocks = []
  const top = 2.86
  const n = 9
  for (let i = 0; i < n; i++) {
    const y0 = (top / n) * i + 0.0045, y1 = (top / n) * (i + 1) - 0.0045
    blocks.push(<Box key={i} x0={x0} x1={x1} y0={y0} y1={y1} z0={-0.02} z1={0.05} mat={m.stone} bevel={0.012} />)
  }
  // 礎石と柱頭の繰形
  blocks.push(<Box key="base" x0={x0 - 0.05} x1={x1 + 0.05} y0={0} y1={0.32} z0={-0.02} z1={0.1} mat={m.stone} />)
  blocks.push(<Box key="cap" x0={x0 - 0.03} x1={x1 + 0.03} y0={2.72} y1={2.80} z0={-0.02} z1={0.09} mat={m.cornice} />)
  // 迫り元の蛇腹
  blocks.push(<Box key="imp" x0={x0 - 0.06} x1={x1 + 0.06} y0={2.86} y1={3.06} z0={-0.02} z1={0.15} mat={m.cornice} bevel={0.02} />)
  blocks.push(<Box key="imp2" x0={x0 - 0.02} x1={x1 + 0.02} y0={2.83} y1={2.87} z0={-0.02} z1={0.11} mat={m.cornice} />)
  return <group>{blocks}</group>
}

// アーチの迫石：扇に並べた楔
function Voussoirs({ m }) {
  const geos = useMemo(() => {
    const R0 = 1.1, R1 = 1.58, cy = 3.06
    const n = 11
    const out = []
    const gap = 0.016
    for (let i = 0; i < n; i++) {
      const a0 = Math.PI - (Math.PI / n) * i - gap / R1 * 0.5
      const a1 = Math.PI - (Math.PI / n) * (i + 1) + gap / R1 * 0.5
      if (i === (n - 1) / 2) continue // 要石の位置
      const s = new THREE.Shape()
      const N = 8
      s.moveTo(Math.cos(a0) * R0, cy + Math.sin(a0) * R0)
      for (let j = 0; j <= N; j++) { const a = a0 + (a1 - a0) * (j / N); s.lineTo(Math.cos(a) * R1, cy + Math.sin(a) * R1) }
      for (let j = N; j >= 0; j--) { const a = a0 + (a1 - a0) * (j / N); s.lineTo(Math.cos(a) * R0, cy + Math.sin(a) * R0) }
      out.push(new THREE.ExtrudeGeometry(s, { depth: 0.09, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 1, curveSegments: 6 }))
    }
    // 内側の繰形の輪（一段明るく手前へ）
    {
      const r0 = R0 - 0.0, r1 = R0 + 0.1
      const s = new THREE.Shape()
      s.absarc(0, cy, r1, Math.PI, 0, true)
      s.lineTo(r0, cy)
      s.absarc(0, cy, r0, 0, Math.PI, false)
      s.lineTo(-r1, cy)
      out.unshift(new THREE.ExtrudeGeometry(s, { depth: 0.13, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 2, curveSegments: 40 }))
    }
    // 要石：上が広い台形、上へ突き出す
    const k = new THREE.Shape()
    k.moveTo(-0.19, cy + R0 - 0.05)
    k.lineTo(0.19, cy + R0 - 0.05)
    k.lineTo(0.28, 4.95)
    k.lineTo(-0.28, 4.95)
    k.lineTo(-0.19, cy + R0 - 0.05)
    out.push(new THREE.ExtrudeGeometry(k, { depth: 0.3, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 1 }))
    return out
  }, [])
  const uvScale = useMemo(() => {
    for (const g of geos) {
      const uv = g.attributes.uv
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.6, uv.getY(i) * 0.6)
    }
    return true
  }, [geos])
  const grout = useMemo(() => {
    const s = new THREE.Shape()
    s.absarc(0, 3.06, 1.57, Math.PI, 0, true)
    s.lineTo(1.1, 3.06)
    s.absarc(0, 3.06, 1.1, 0, Math.PI, false)
    return new THREE.ShapeGeometry(s, 40)
  }, [])
  return (
    <group position={[0, 0, -0.03]}>
      <mesh geometry={grout} position={[0, 0, 0.032]}>
        <meshStandardMaterial color="#3a3326" roughness={1} />
      </mesh>
      {uvScale && geos.map((g, i) => (
        <mesh key={i} geometry={g} material={m.stone} castShadow receiveShadow />
      ))}
    </group>
  )
}

// 両開きの鏡板扉。open で内へ開く
function Door({ m, openRef }) {
  const L = useRef(), Rr = useRef()
  const leaf = useMemo(() => {
    const R = 1.1, cy = 3.0
    const s = new THREE.Shape()
    s.moveTo(0, 0)
    s.lineTo(-R, 0)
    s.lineTo(-R, cy)
    s.absarc(0, cy, R, Math.PI, Math.PI / 2, true)
    s.lineTo(0, 0)
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.07, bevelEnabled: false, curveSegments: 32 })
    g.translate(R, 0, 0) // 蝶番（外側の縁）を原点へ
    const uv = g.attributes.uv
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.9, uv.getY(i) * 0.25)
    return g
  }, [])
  const panels = (sgn) => {
    const xs = sgn < 0 ? [0.14, 0.94] : [-0.94, -0.14]
    const items = [
      [0.22, 1.2],
      [1.5, 2.85],
    ]
    return items.map(([y0, y1], i) => (
      <group key={i}>
        <Box x0={xs[0]} x1={xs[1]} y0={y0} y1={y1} z0={0.07} z1={0.1} mat={m.door} />
        <Box x0={xs[0] + 0.07} x1={xs[1] - 0.07} y0={y0 + 0.07} y1={y1 - 0.07} z0={0.1} z1={0.12} mat={m.door} />
      </group>
    ))
  }
  useFrame(() => {
    const a = openRef.current * 1.25
    if (L.current) L.current.rotation.y = a
    if (Rr.current) Rr.current.rotation.y = -a
  })
  return (
    <group position={[0, 0, -0.32]}>
      <group ref={L} position={[-1.1, 0, 0]}>
        <mesh geometry={leaf} material={m.door} castShadow receiveShadow />
        <group position={[1.1, 0, 0]}>
          {panels(1)}
          <mesh position={[-0.13, 1.38, 0.13]} material={m.brass} castShadow>
            <sphereGeometry args={[0.035, 16, 12]} />
          </mesh>
          <Box x0={-0.012} x1={0} y0={0} y1={4.1} z0={0.07} z1={0.09} mat={m.dark} />
        </group>
      </group>
      <group ref={Rr} position={[1.1, 0, 0]} scale={[-1, 1, 1]}>
        <mesh geometry={leaf} material={m.door} castShadow receiveShadow />
        <group position={[1.1, 0, 0]}>
          {panels(1)}
          <mesh position={[-0.13, 1.38, 0.13]} material={m.brass} castShadow>
            <sphereGeometry args={[0.035, 16, 12]} />
          </mesh>
        </group>
      </group>
      {/* 奥：開くとこぼれる灯り */}
      <mesh position={[0, 2.2, -1.5]} material={m.interior}>
        <planeGeometry args={[3, 5]} />
      </mesh>
    </group>
  )
}

// 鎧戸：枠＋傾けた羽根（インスタンス）×2枚、窓台
function Shutter({ x0, x1, m }) {
  const y0 = py(708), y1 = py(358)
  const ref = useRef()
  const leafW = (x1 - x0) / 2
  const pitch = 0.085
  const rows = []
  for (const li of [0, 1]) {
    const lx0 = x0 + li * leafW + 0.07, lx1 = x0 + (li + 1) * leafW - 0.07
    const mid = (y0 + y1) / 2
    for (let y = y0 + 0.1; y < y1 - 0.1; y += pitch) {
      if (Math.abs(y - mid) < 0.05) continue
      rows.push([(lx0 + lx1) / 2, y, lx1 - lx0])
    }
  }
  useLayoutEffect(() => {
    const o = new THREE.Object3D()
    rows.forEach(([x, y, w], i) => {
      o.position.set(x, y, 0.04)
      o.rotation.set(-0.28, 0, 0)
      o.scale.set(w, 1, 1)
      o.updateMatrix()
      ref.current.setMatrixAt(i, o.matrix)
    })
    ref.current.instanceMatrix.needsUpdate = true
  }, [])
  const st = 0.07
  return (
    <group>
      {/* 奥の暗い窓 */}
      <Box x0={x0 + 0.02} x1={x1 - 0.02} y0={y0} y1={y1} z0={-0.02} z1={0.0} mat={m.dark} cast={false} />
      <instancedMesh ref={ref} args={[null, null, rows.length]} material={m.shutter} castShadow receiveShadow>
        <boxGeometry args={[1, 0.074, 0.012]} />
      </instancedMesh>
      {[0, 1].map((li) => {
        const a = x0 + li * leafW, b = a + leafW
        return (
          <group key={li}>
            <Box x0={a} x1={a + st} y0={y0} y1={y1} z0={0} z1={0.07} mat={m.shutter} />
            <Box x0={b - st} x1={b} y0={y0} y1={y1} z0={0} z1={0.07} mat={m.shutter} />
            <Box x0={a} x1={b} y0={y0} y1={y0 + 0.08} z0={0} z1={0.07} mat={m.shutter} />
            <Box x0={a} x1={b} y0={y1 - 0.08} y1={y1} z0={0} z1={0.07} mat={m.shutter} />
            <Box x0={a} x1={b} y0={(y0 + y1) / 2 - 0.05} y1={(y0 + y1) / 2 + 0.05} z0={0} z1={0.07} mat={m.shutter} />
          </group>
        )
      })}
      {/* 窓台 */}
      <Box x0={x0 - 0.08} x1={x1 + 0.08} y0={y0 - 0.13} y1={y0 - 0.02} z0={0} z1={0.24} mat={m.cornice} />
    </group>
  )
}

// 軒：樋・鼻隠し・歯飾り・蛇腹
function Cornice({ m }) {
  const ref = useRef()
  const n = 140
  useLayoutEffect(() => {
    const o = new THREE.Object3D()
    for (let i = 0; i < n; i++) {
      o.position.set(-9.8 + i * 0.14, py(283), 0.245)
      o.updateMatrix()
      ref.current.setMatrixAt(i, o.matrix)
    }
    ref.current.instanceMatrix.needsUpdate = true
  }, [])
  return (
    <group>
      <Box x0={-10} x1={10} y0={py(300)} y1={py(292)} z0={0} z1={0.12} mat={m.cornice} />
      <Box x0={-10} x1={10} y0={py(292)} y1={py(274)} z0={0} z1={0.22} mat={m.cornice} />
      <instancedMesh ref={ref} args={[null, null, n]} material={m.cornice} castShadow receiveShadow>
        <boxGeometry args={[0.05, 0.08, 0.05]} />
      </instancedMesh>
      <Box x0={-10} x1={10} y0={py(274)} y1={py(262)} z0={0} z1={0.3} mat={m.cornice} />
      <mesh position={[0, py(254), 0.52]} rotation={[0, 0, Math.PI / 2]} material={m.gutter} castShadow receiveShadow>
        <cylinderGeometry args={[0.075, 0.075, 20, 16]} />
      </mesh>
    </group>
  )
}

// 寄棟の屋根の前の面（台形）
function Roof({ m }) {
  const geo = useMemo(() => {
    const yE = py(250), zE = 0.62, yR = 6.48, zR = -0.42
    const xE = 10.5, xR = 5.72
    const g = new THREE.BufferGeometry()
    const p = [
      -xE, yE, zE, xE, yE, zE, xR, yR, zR,
      -xE, yE, zE, xR, yR, zR, -xR, yR, zR,
    ]
    const slope = Math.hypot(yR - yE, zR - zE)
    const v = (s) => (s / slope) * 0.75
    const U = 3.6
    const uv = [-xE / U, 0, xE / U, 0, xR / U, v(slope), -xE / U, 0, xR / U, v(slope), -xR / U, v(slope)]
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    g.computeVertexNormals()
    return g
  }, [])
  // 寄棟の側面（左右）
  const side = useMemo(() => {
    const yE = py(250), zE = 0.62, yR = 6.48, zR = -0.42
    const g = new THREE.BufferGeometry()
    const p = [
      -10.5, yE, zE, -5.72, yR, zR, -10.5, yE, -6,
      10.5, yE, zE, 10.5, yE, -6, 5.72, yR, zR,
    ]
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0.5, 0.8, 1, 0, 0, 0, 1, 0, 0.5, 0.8], 2))
    g.computeVertexNormals()
    return g
  }, [])
  return (
    <group>
      <mesh geometry={geo} material={m.slate} receiveShadow castShadow />
    </group>
  )
}

// 三日月の灯り
function Crescents() {
  const geo = useMemo(() => {
    const s = new THREE.Shape()
    const w = 0.5
    s.moveTo(-w, 0)
    s.quadraticCurveTo(0, -0.34, w, 0)
    s.quadraticCurveTo(0, -0.06, -w, 0)
    return new THREE.ShapeGeometry(s, 24)
  }, [])
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#8c8566', transparent: true, opacity: 0.1, toneMapped: false }), [])
  return (
    <group>
      {[520, 720, 900].map((x, i) => (
        <mesh key={i} geometry={geo} material={mat} position={[px(x), py(96), -0.3]} />
      ))}
    </group>
  )
}

function Bush({ side, seed, pos, size }) {
  const map = useMemo(() => T.bush(side, seed), [side, seed])
  return (
    <mesh position={pos}>
      <planeGeometry args={size} />
      <meshBasicMaterial map={map} transparent depthWrite={false} toneMapped={false} />
    </mesh>
  )
}

function Willow({ side, seed, pos, size }) {
  const map = useMemo(() => T.willow(side, seed), [side, seed])
  return (
    <mesh position={pos}>
      <planeGeometry args={size} />
      <meshBasicMaterial map={map} transparent depthWrite={false} toneMapped={false} color="#ffffff" />
    </mesh>
  )
}

const SKIP = (new URLSearchParams(location.search).get('skip') || '').split(',')
const on = (k) => !SKIP.includes(k)

export default function Scene({ progress, pointer }) {
  const m = useMats()
  const { camera } = useThree()
  const openRef = useRef(0)
  const spot = useRef()
  const glow = useRef()
  const pool = useRef()
  useLayoutEffect(() => {
    spot.current.target.position.set(0.2, 3.6, 0)
    spot.current.target.updateMatrixWorld()
    pool.current.target.position.set(0.15, 2.0, -0.3)
    pool.current.target.updateMatrixWorld()
  }, [])
  useFrame((st, dt) => {
    const p = progress.current
    const k = 1 - Math.pow(0.002, dt)
    const tx = pointer.current[0] * 0.12, ty = pointer.current[1] * 0.06
    const z = CAM.z - p * 12.5
    const y = CAM.y - p * 1.75
    camera.position.x += (tx - camera.position.x) * k
    camera.position.y += (y + ty - camera.position.y) * k
    camera.position.z += (z - camera.position.z) * k
    camera.lookAt(camera.position.x, camera.position.y, camera.position.z - 10)
    const o = Math.min(1, Math.max(0, (p - 0.25) / 0.6))
    openRef.current += (o * o * (3 - 2 * o) - openRef.current) * k
    if (glow.current) glow.current.intensity = openRef.current * 6
  })
  return (
    <>
      <color attach="background" args={['#0a0905']} />
      <ambientLight intensity={0.26} color="#b8a888" />
      <hemisphereLight args={['#6d6550', '#1a170f', 0.26]} />
      <spotLight
        ref={spot}
        position={[-4.5, 13, 9]}
        angle={0.62}
        penumbra={1}
        decay={0}
        intensity={2.5}
        color="#f2e6cf"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-camera-near={4}
        shadow-camera-far={40}
      />
      <spotLight ref={pool} position={[0.4, 2.2, 9]} angle={0.1} penumbra={1} decay={0} intensity={0.9} color="#9fc79a" />
      <pointLight ref={glow} position={[0, 2.2, -1.2]} decay={1.5} intensity={0} distance={8} color="#ffc070" />

      <mesh position={[0, 8, -6]} material={m.sky}>
        <planeGeometry args={[40, 12]} />
      </mesh>
      {on('roof') && <Roof m={m} />}
      {on('cornice') && <Cornice m={m} />}
      {on('wall') && <Wall m={m} />}
      <Box x0={-10} x1={10} y0={-0.8} y1={py(775)} z0={0} z1={0.025} mat={m.plinth} />
      {on('pil') && <Pilaster side={-1} m={m} />}
      {on('pil') && <Pilaster side={1} m={m} />}
      {on('vou') && <Voussoirs m={m} />}
      {on('door') && <Door m={m} openRef={openRef} />}
      {/* 段 */}
      <Box x0={-2.0} x1={2.0} y0={-0.2} y1={0} z0={-0.4} z1={0.45} mat={m.dark} />
      <Box x0={-10} x1={10} y0={-3} y1={-0.34} z0={-0.4} z1={4} mat={m.dark} />
      {on('shut') && <Shutter x0={px(110)} x1={px(328)} m={m} />}
      {on('shut') && <Shutter x0={px(1125)} x1={px(1335)} m={m} />}
      {on('cres') && <Crescents />}
      {on('wil') && <Bush side={-1} seed={71} pos={[-2.4, 3.45, 9]} size={[2.6, 4.3]} />}
      {on('wil') && <Bush side={1} seed={83} pos={[2.4, 3.45, 9]} size={[2.6, 4.3]} />}
      {on('wil') && <Willow side={-1} seed={31} pos={[-3.0, 4.2, 8]} size={[3.2, 5.6]} />}
      {on('wil') && <Willow side={1} seed={57} pos={[3.0, 4.2, 8]} size={[3.2, 5.6]} />}
    </>
  )
}
