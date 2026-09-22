// Scene.jsx — Day 083「二十ヤードの穴」
//
// 再現元（アトレチコ鈴鹿クラブ）の面は、白／コバルト青 #004898／緑 #009840 の
// タイルを敷き詰めて作られている。色を「物に塗る」のではなく、色そのものが面。
// その面をこちらでは**目盛り**にする：列 i のタイルのうち色を持つ割合が、
// その飛距離までに済んでいる曲がりの割合そのものになるように敷く。
//
// だから壁のあたりの床はほとんど白いままで、いちばん奥だけが色で埋まる。
// 絵の側に「ここで 25% です」と書いた文字は一つも無い。床が数えている。

import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { WALL, BALL, bendRadius, kick, path, zAtX, inkColumn } from './rig.js'

// ── 面の割り付け ──────────────────────────────────────────────────────
const NX = 46
const NZ = 14
const X0 = -2.5
const Z0 = -2.0
const CELL = 0.5
const GAP = 0.055
export const CX = X0 + (NX * CELL) / 2 // 9.0
export const CZ = Z0 + (NZ * CELL) / 2 // 1.5

// ── 色（再現元の実測値をそのまま使う）────────────────────────────────
const COBALT = '#004898'
const GREEN = '#009840'
const LIME = '#e1ff00'
const INK = '#14181e'

// 数学の (x, z) を three の座標へ。three の −z が画面の上になるように組む。
const P = (x, z, y = 0) => [x, y, -z]

function unit(k) {
  const L = Math.hypot(k.Lx, k.Y)
  // 弧は弦より z の小さい側にあるので、法線は (uz, −ux) を取る（逆だと櫛が裏に出る）
  return { ux: k.Lx / L, uz: k.Y / L, px: k.Y / L, pz: -k.Lx / L, L }
}

/** 1色ぶんのタイル群。色ごとに InstancedMesh を分けて count で出し入れする。 */
function TileLayer({ cells, color }) {
  const ref = useRef()
  useLayoutEffect(() => {
    const o = ref.current
    const m = new THREE.Matrix4()
    cells.forEach(([x, z, h], i) => {
      m.makeScale(CELL - GAP, h, CELL - GAP)
      m.setPosition(x, h / 2, -z)
      o.setMatrixAt(i, m)
    })
    o.count = cells.length
    o.instanceMatrix.needsUpdate = true
  }, [cells])
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, NX * NZ]} castShadow receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={color} roughness={0.84} metalness={0} />
    </instancedMesh>
  )
}

function Tiles({ R, k }) {
  const layers = useMemo(() => {
    const out = [[], [], []] // 0 = 白, 1 = 青, 2 = 緑
    for (let i = 0; i < NX; i++) {
      const xc = X0 + (i + 0.5) * CELL
      const xs = Math.min(Math.max(xc, 0), k.Lx)
      const frac = k.Y > 0 ? zAtX(R, xs) / k.Y : 0
      const ink = inkColumn(i, NZ, frac)
      const h = 0.03 + 0.30 * frac
      for (let j = 0; j < NZ; j++) out[ink[j]].push([xc, Z0 + (j + 0.5) * CELL, h])
    }
    return out
  }, [R, k])
  return (
    <group>
      <TileLayer cells={layers[0]} color="#ffffff" />
      <TileLayer cells={layers[1]} color={COBALT} />
      <TileLayer cells={layers[2]} color={GREEN} />
    </group>
  )
}

/** 平たい棒を2点間に置く。 */
function Bar({ a, b, y = 0.6, w = 0.05, color = INK, h = 0.03 }) {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const len = Math.hypot(dx, dz) || 1e-4
  const ang = Math.atan2(dz, dx) // Y 回りの回転は local +X を (cosθ, −sinθ) へ送る
  return (
    <mesh position={[(a[0] + b[0]) / 2, y, -(a[1] + b[1]) / 2]} rotation={[0, ang, 0]} castShadow>
      <boxGeometry args={[len, h, w]} />
      <meshStandardMaterial color={color} roughness={0.5} metalness={0} />
    </mesh>
  )
}

function Arc({ R, k }) {
  const geo = useMemo(() => {
    const pts = path(R, k.C, 200).map(([x, z]) => new THREE.Vector3(x, 0.44, -z))
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 200, 0.085, 10, false)
  }, [R, k])
  return (
    <mesh geometry={geo} castShadow>
      <meshStandardMaterial color={LIME} roughness={0.35} metalness={0} emissive={LIME} emissiveIntensity={0.14} />
    </mesh>
  )
}

/**
 * 等時間のビーズ。速い蹴りと遅い蹴りを、同じ弧の左右に打つ。
 * 玉の間隔だけが違って、玉が乗っている線は**1本しかない**、という見え方にする。
 * 抗力だけなら ds/dt = v, dv/dt = −b v² が解けて s(t) = ln(1 + b v₀ t)/b。
 */
function Beads({ R, k, v0, dt, side, color }) {
  const b = (0.5 * BALL.rho * Math.PI * BALL.r * BALL.r * BALL.CD) / BALL.m
  const items = useMemo(() => {
    const out = []
    const sEnd = R * 2 * Math.asin(Math.min(1, k.C / (2 * R)))
    for (let n = 1; n < 400; n++) {
      const s = Math.log(1 + b * v0 * (n * dt)) / b
      if (s > sEnd) break
      const th = s / R
      out.push([R * Math.sin(th) + side * 0.3 * -Math.sin(th), R * (1 - Math.cos(th)) + side * 0.3 * Math.cos(th)])
    }
    return out
  }, [R, k, v0, dt, side, b])
  return (
    <group>
      {items.map((p, i) => (
        <group key={i}>
          <mesh position={P(p[0], p[1], 0.43)}>
            <cylinderGeometry args={[0.145, 0.145, 0.05, 18]} />
            <meshStandardMaterial color={INK} roughness={0.5} metalness={0} />
          </mesh>
          {color !== INK && (
            <mesh position={P(p[0], p[1], 0.47)}>
              <cylinderGeometry args={[0.1, 0.1, 0.045, 18]} />
              <meshStandardMaterial color={color} roughness={0.5} metalness={0} />
            </mesh>
          )}
        </group>
      ))}
    </group>
  )
}

/** 壁は弦の上、ボールから 9.144 m。弦に直交して並ぶ。 */
function Wall({ k }) {
  const { ux, uz, px, pz } = unit(k)
  const cx = ux * WALL
  const cz = uz * WALL
  const ang = Math.atan2(k.Y, k.Lx) // local +X が弦の向き、local +Z が弦の法線になる
  return (
    <group>
      {[-1.5, -0.5, 0.5, 1.5].map((o) => (
        <mesh key={o} position={P(cx + px * o * 0.62, cz + pz * o * 0.62, 0.88)} rotation={[0, ang, 0]} castShadow>
          <boxGeometry args={[0.26, 1.76, 0.4]} />
          <meshStandardMaterial color={INK} roughness={0.72} metalness={0} />
        </mesh>
      ))}
    </group>
  )
}

/**
 * 弦から軌跡までの垂線を弦に沿って等間隔に立てた櫛。
 * d(ξ) = √(R²−ξ²) − k は偶関数なので、櫛はいちばん真ん中がいちばん長い。
 * 壁は弦上 9.144 m にしか立てられないから、C = 18.288 でだけ壁と最長の歯が重なる。
 */
function Comb({ R, k }) {
  const { ux, uz, px, pz, L } = unit(k)
  const kk = Math.sqrt(Math.max(0, R * R - (k.C / 2) * (k.C / 2)))
  const teeth = []
  const N = 19
  for (let i = 0; i <= N; i++) {
    const xi = -k.C / 2 + (k.C * i) / N
    const d = Math.sqrt(Math.max(0, R * R - xi * xi)) - kk
    const t = (i / N) * L
    const bx = ux * t
    const bz = uz * t
    teeth.push([[bx, bz], [bx + px * d, bz + pz * d], d])
  }
  return (
    <group>
      {teeth.map(([a, b], i) => (
        <Bar key={i} a={a} b={b} y={0.35} w={0.05} color="#474e55" h={0.018} />
      ))}
    </group>
  )
}

/** 弦の中点から軌跡までの垂線 ＝「離れ」。C = 18.288 ではここが壁の真上。 */
function Clearance({ k }) {
  const { ux, uz, px, pz, L } = unit(k)
  const mx = ux * (L / 2)
  const mz = uz * (L / 2)
  const tip = [mx + px * k.sagitta, mz + pz * k.sagitta]
  return (
    <group>
      <Bar a={[mx, mz]} b={tip} y={1.99} w={0.075} color={LIME} h={0.07} />
      <mesh position={P(tip[0], tip[1], 2.0)} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.36, 0.05, 10, 40]} />
        <meshStandardMaterial color={LIME} roughness={0.4} metalness={0} emissive={LIME} emissiveIntensity={0.22} />
      </mesh>
      <mesh position={P(mx, mz, 1.99)}>
        <cylinderGeometry args={[0.1, 0.1, 0.08, 18]} />
        <meshStandardMaterial color={LIME} roughness={0.4} metalness={0} />
      </mesh>
    </group>
  )
}

function Ball({ R, k, tRef }) {
  const ref = useRef()
  useFrame(() => {
    const o = ref.current
    if (!o) return
    const phi = 2 * Math.asin(Math.min(1, k.C / (2 * R)))
    const th = phi * tRef.current
    o.position.set(R * Math.sin(th), 0.46, -R * (1 - Math.cos(th)))
    o.rotation.z -= 0.22
  })
  return (
    <mesh ref={ref} castShadow>
      <sphereGeometry args={[0.17, 28, 20]} />
      <meshStandardMaterial color="#ffffff" roughness={0.28} metalness={0} />
    </mesh>
  )
}

export default function Scene({ CL, C, tRef }) {
  const R = useMemo(() => bendRadius({ ...BALL, CL }), [CL])
  const k = useMemo(() => kick(R, C), [R, C])
  const { px, pz } = unit(k)
  const end = [k.Lx, k.Y]

  return (
    <group position={[-CX, 0, CZ]}>
      {/* 紙 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[CX, -0.09, -CZ]} receiveShadow>
        <planeGeometry args={[90, 70]} />
        <meshStandardMaterial color="#f1f0ea" roughness={0.98} metalness={0} />
      </mesh>
      {/* タイルの帯。紙の上に一段だけ載せる */}
      <mesh position={[CX, -0.04, -CZ]} receiveShadow castShadow>
        <boxGeometry args={[NX * CELL, 0.08, NZ * CELL]} />
        <meshStandardMaterial color="#dcdad2" roughness={0.95} metalness={0} />
      </mesh>

      <Tiles R={R} k={k} />

      {/* 狙い線（蹴り出し方向）。ゴールを Y だけ外して指している。 */}
      <Bar a={[0, 0]} b={[k.Lx, 0]} y={0.37} w={0.05} color="#8a9096" h={0.02} />
      {/* 弦（ボール → ゴール）。壁が立っているのはこの線の上。 */}
      <Bar a={[0, 0]} b={end} y={0.39} w={0.065} color={INK} h={0.026} />

      <Arc R={R} k={k} />
      <Beads R={R} k={k} v0={18} dt={0.06} side={+1} color={INK} />
      <Beads R={R} k={k} v0={34} dt={0.06} side={-1} color="#ffffff" />

      <Comb R={R} k={k} />
      <Wall k={k} />
      <Clearance k={k} />
      <Ball R={R} k={k} tRef={tRef} />

      {/* 蹴る点とゴール地点 */}
      <mesh position={P(0, 0, 0.42)}>
        <cylinderGeometry args={[0.22, 0.22, 0.09, 30]} />
        <meshStandardMaterial color={INK} roughness={0.5} />
      </mesh>
      <Bar
        a={[end[0] - px * 0.95, end[1] - pz * 0.95]}
        b={[end[0] + px * 0.95, end[1] + pz * 0.95]}
        y={0.66}
        w={0.17}
        color={INK}
        h={0.1}
      />

      <ambientLight intensity={1.32} />
      <hemisphereLight args={['#ffffff', '#c6c5be', 0.5]} />
      <directionalLight
        position={[CX - 15, 24, -CZ + 10]}
        intensity={1.72}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-14}
        shadow-camera-right={14}
        shadow-camera-top={14}
        shadow-camera-bottom={-14}
        shadow-camera-near={1}
        shadow-camera-far={90}
        shadow-bias={-0.0006}
      />
    </group>
  )
}
