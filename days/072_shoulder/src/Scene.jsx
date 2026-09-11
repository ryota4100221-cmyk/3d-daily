import React, { useMemo, useRef, useEffect, useLayoutEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { makeSupport, makeCloth, settle, advance, measure, hookPath } from './rig.js'

// ── 棒を作る ────────────────────────────────────────────────────────────
// TubeGeometry は半径が一定なので使えない。木のハンガーは中央が太く先が細く、
// 断面も丸ではなく前後に深い楕円で、そこが「余りを薄く配る」ことの実体なので、
// 一定半径の丸棒にしてしまうと今日の比較が成立しない。
function tubeFrom(samples, radial = 12, flatten = 1) {
  const n = samples.length
  const pos = new Float32Array(n * radial * 3)
  const nor = new Float32Array(n * radial * 3)
  const idx = []
  // 平行移動フレーム（法線を最小回転で運ぶ）。垂直な接線でも破綻しない。
  let nx = 0
  let ny = 1
  let nz = 0
  const tangent = (i) => {
    const a = samples[Math.max(0, i - 1)]
    const b = samples[Math.min(n - 1, i + 1)]
    const t = [b.x - a.x, b.y - a.y, b.z - a.z]
    const L = Math.hypot(t[0], t[1], t[2]) || 1
    return [t[0] / L, t[1] / L, t[2] / L]
  }
  {
    const t = tangent(0)
    let ref = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
    let c = [
      t[1] * ref[2] - t[2] * ref[1],
      t[2] * ref[0] - t[0] * ref[2],
      t[0] * ref[1] - t[1] * ref[0],
    ]
    const L = Math.hypot(c[0], c[1], c[2]) || 1
    nx = c[0] / L
    ny = c[1] / L
    nz = c[2] / L
  }
  for (let i = 0; i < n; i++) {
    const t = tangent(i)
    // 前の法線から接線成分を抜いて正規化＝最小回転
    const d = nx * t[0] + ny * t[1] + nz * t[2]
    let ax = nx - d * t[0]
    let ay = ny - d * t[1]
    let az = nz - d * t[2]
    const L = Math.hypot(ax, ay, az) || 1
    ax /= L
    ay /= L
    az /= L
    nx = ax
    ny = ay
    nz = az
    const bx = t[1] * az - t[2] * ay
    const by = t[2] * ax - t[0] * az
    const bz = t[0] * ay - t[1] * ax
    const s = samples[i]
    for (let k = 0; k < radial; k++) {
      const th = (k / radial) * Math.PI * 2
      const ca = Math.cos(th)
      const sa = Math.sin(th)
      // 断面は楕円（a 方向 r、b 方向 r·flatten）。法線は半径方向ではなく
      // (f·cos, sin) を正規化したもの——平たい木口に丸い棒の陰影が乗ると、
      // 厚みの違いが絵から消えてしまう。
      const ex = ca
      const ey = sa * flatten
      let lx = flatten * ca
      let ly = sa
      const lL = Math.hypot(lx, ly) || 1
      lx /= lL
      ly /= lL
      const o = (i * radial + k) * 3
      pos[o] = s.x + (ax * ex + bx * ey) * s.r
      pos[o + 1] = s.y + (ay * ex + by * ey) * s.r
      pos[o + 2] = s.z + (az * ex + bz * ey) * s.r
      nor[o] = ax * lx + bx * ly
      nor[o + 1] = ay * lx + by * ly
      nor[o + 2] = az * lx + bz * ly
    }
  }
  for (let i = 0; i + 1 < n; i++) {
    for (let k = 0; k < radial; k++) {
      const a = i * radial + k
      const b = i * radial + ((k + 1) % radial)
      const c = (i + 1) * radial + k
      const d = (i + 1) * radial + ((k + 1) % radial)
      idx.push(a, c, b, b, c, d)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  g.setIndex(idx)
  return g
}

// ── 白いスタジオ ────────────────────────────────────────────────────────
// Environment のプリセットは取りに行くので使わない（この実行環境は外へ出られ
// ない）。上が白く下が薄灰の縦グラデーションを equirect の DataTexture に焼き、
// PMREM に通すだけ。窓も反射板も置いていない。
function useStudio() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  useLayoutEffect(() => {
    const W = 64
    const H = 32
    const data = new Float32Array(W * H * 4)
    for (let y = 0; y < H; y++) {
      const v = y / (H - 1) // 0 = 天頂
      const up = 1.02
      const down = 0.47
      const k = up + (down - up) * Math.pow(v, 0.72)
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 4
        data[o] = k
        data[o + 1] = k * 0.998
        data[o + 2] = k * 0.994
        data[o + 3] = 1
      }
    }
    const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.FloatType)
    tex.mapping = THREE.EquirectangularReflectionMapping
    tex.needsUpdate = true
    const pmrem = new THREE.PMREMGenerator(gl)
    const rt = pmrem.fromEquirectangular(tex)
    scene.environment = rt.texture
    return () => {
      scene.environment = null
      rt.dispose()
      pmrem.dispose()
      tex.dispose()
    }
  }, [gl, scene])
}

// ── 一着 ────────────────────────────────────────────────────────────────
function Hanger({ cloth, support, kind, x, tint }) {
  const geo = useMemo(() => {
    const { nu, nv } = cloth
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nu * nv * 3), 3))
    const idx = []
    for (let j = 0; j + 1 < nv; j++) {
      for (let i = 0; i + 1 < nu; i++) {
        const a = j * nu + i
        const b = j * nu + i + 1
        const c = (j + 1) * nu + i
        const d = (j + 1) * nu + i + 1
        idx.push(a, c, b, b, c, d)
      }
    }
    g.setIndex(idx)
    g.attributes.position.array.set(cloth.pos)
    g.computeVertexNormals()
    return g
  }, [cloth])

  const barGeo = useMemo(
    () => tubeFrom(support.shoulder.concat(support.caps), 14, kind === 'wood' ? 0.6 : 1),
    [support, kind]
  )
  const hookGeo = useMemo(() => {
    const pts = hookPath(kind).map(([px, py, pz]) => ({ x: px, y: py, z: pz, r: 0.0018 }))
    return tubeFrom(pts, 9, 1)
  }, [kind])

  useFrame((_, dt) => {
    advance(cloth, Math.min(dt, 1 / 30))
    geo.attributes.position.array.set(cloth.pos)
    geo.attributes.position.needsUpdate = true
    geo.computeVertexNormals()
    geo.computeBoundingSphere()
  })

  return (
    <group position={[x, 0, 0]}>
      <mesh geometry={barGeo} castShadow receiveShadow>
        {kind === 'wood' ? (
          <meshPhysicalMaterial
            color={tint.wood}
            roughness={0.46}
            clearcoat={0.4}
            clearcoatRoughness={0.42}
          />
        ) : (
          <meshStandardMaterial color={tint.metal} metalness={0.82} roughness={0.29} />
        )}
      </mesh>
      <mesh geometry={hookGeo} castShadow>
        <meshStandardMaterial color={tint.metal} metalness={0.85} roughness={0.26} />
      </mesh>
      <mesh geometry={geo} castShadow receiveShadow>
        <meshPhysicalMaterial
          color={tint.cloth}
          roughness={0.95}
          metalness={0}
          sheen={1}
          sheenRoughness={0.45}
          sheenColor={'#ffffff'}
          side={THREE.DoubleSide}
          shadowSide={THREE.DoubleSide}
        />
      </mesh>
    </group>
  )
}

// 弦（肩先から肩先までのまっすぐ）。曲線のほうが長いことは、線を1本引けば
// それで済む。針金では V と水平線の隙間がそのまま「奪われた長さ」に見える。
function Chord({ support, x, color }) {
  const geo = useMemo(() => {
    const a = support.shoulder[0]
    const b = support.shoulder[support.shoulder.length - 1]
    const g = new THREE.BufferGeometry()
    g.setAttribute(
      'position',
      new THREE.BufferAttribute(
        new Float32Array([a.x, a.y, a.z + 0.055, b.x, b.y, b.z + 0.055]),
        3
      )
    )
    return g
  }, [support])
  return (
    <group position={[x, 0, 0]}>
      <line geometry={geo}>
        <lineBasicMaterial color={color} transparent opacity={0.55} />
      </line>
    </group>
  )
}

const SPREAD = 0.3

export default function Scene({ onStats, tint }) {
  useStudio()
  // 布は2枚ともここで一度だけ作って落ち着かせる。数値は落ち着いた直後に
  // 一度読み、あとは毎フレーム読み直す。frame ループの中でしか読まない作りに
  // していたら、初期値の「—」が焼き付いたまま preview が撮れた（Day 050 と
  // 同じ事故の別の顔）。
  const rigs = useMemo(() => {
    const out = {}
    for (const kind of ['wood', 'wire']) {
      const support = makeSupport(kind)
      const cloth = makeCloth({ support })
      settle(cloth)
      out[kind] = { support, cloth }
    }
    return out
  }, [])

  const tick = useRef(0)
  useEffect(() => {
    onStats({ wood: measure(rigs.wood.cloth), wire: measure(rigs.wire.cloth) })
  }, [rigs, onStats])

  useFrame(() => {
    tick.current++
    if (tick.current % 6 !== 0) return
    onStats({ wood: measure(rigs.wood.cloth), wire: measure(rigs.wire.cloth) })
  })

  return (
    <>
      <directionalLight
        position={[-1.5, 2.3, 2.1]}
        intensity={2.1}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-bias={-0.0004}
        shadow-normalBias={0.0025}
        shadow-camera-left={-0.9}
        shadow-camera-right={0.9}
        shadow-camera-top={0.6}
        shadow-camera-bottom={-0.8}
        shadow-camera-near={0.5}
        shadow-camera-far={6}
      />
      <directionalLight position={[2.4, 0.4, 1.4]} intensity={0.5} />
      <Hanger kind="wood" x={-SPREAD} {...rigs.wood} tint={tint} />
      <Hanger kind="wire" x={SPREAD} {...rigs.wire} tint={tint} />
      <Chord support={rigs.wood.support} x={-SPREAD} color={tint.rule} />
      <Chord support={rigs.wire.support} x={SPREAD} color={tint.rule} />
    </>
  )
}
