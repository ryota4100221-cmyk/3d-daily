import { useMemo, useRef, useLayoutEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import {
  Grillage,
  loadPath,
  BAND_LINEAR,
  COLUMNS,
  N,
  NX,
  NZ,
  H,
  gx,
  gz,
  idx,
  INK,
} from './rig.js'

// 版面の外側は無彩色に固定する（再現元の運用ルール）。有彩色は部材にしか出さない。
const BG = '#74767a'
const FLOOR = '#84868b'
const FLOOR_Y = -2.4

const DEPTH = 0.13 // 部材のせい（見えるのはほぼ上面なので、影の出方にだけ効く）
const WID = 0.075 // 部材の幅
const TARGET_DEFL = 0.78 // たわみの表示上の最大値（world）。誇張率はHUDに出す

const dummy = new THREE.Object3D()

export default function Scene({ stats }) {
  const grill = useMemo(() => {
    const g = new Grillage()
    g.measure()
    return g
  }, [])

  // φ → world の縮尺は起動時に1回だけ決める。毎フレーム正規化すると
  //「たわみが大きくなった」が絵から消える。
  const defl = useMemo(() => TARGET_DEFL / Math.max(1e-6, grill.phiMax), [grill])

  const xRef = useRef()
  const zRef = useRef()
  const ringRef = useRef()
  const pointer = useRef({ x: 0, z: 0, at: -1e9 })
  const target = useRef([0, 0])
  const yBuf = useMemo(() => new Float32Array(N * N), [])

  const { gl, scene } = useThree()
  useLayoutEffect(() => {
    scene.background = new THREE.Color(BG)
    gl.toneMapping = THREE.NoToneMapping // 凡例の13色をそのままの値で出す
  }, [gl, scene])

  // 単位立方体1つを両方向で使い回す。寸法は全部 instance の scale で持つ
  //（geometry 側にも寸法を入れると scale と二重にかかって、部材が 0.5px になる）。
  const unit = useMemo(() => new THREE.BoxGeometry(1, 1, 1), [])

  // instanceColor は setColorAt で1度作らせておく（直接生やすとシェーダが
  // 分岐を積まずにコンパイルされ、色が全部白のまま出ることがある）。
  useLayoutEffect(() => {
    const c = new THREE.Color()
    for (const m of [xRef.current, zRef.current]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      m.setColorAt(0, c)
      m.instanceColor.setUsage(THREE.DynamicDrawUsage)
    }
  }, [])

  useFrame(({ clock }, dt) => {
    const t = clock.getElapsedTime()

    // 荷重の位置。ポインタが動いていればそちらへ、離れていれば自走の経路へ戻る。
    const auto = loadPath(t)
    const p = pointer.current
    const useP = performance.now() - p.at < 2600 // 触るのをやめて2.6秒で自走へ戻る
    const tx = useP ? p.x : auto[0]
    const tz = useP ? p.z : auto[1]
    const k = 1 - Math.exp(-dt * (useP ? 7 : 2.4))
    target.current[0] += (tx - target.current[0]) * k
    target.current[1] += (tz - target.current[1]) * k
    const [lx, lz] = target.current

    grill.step(lx, lz)

    // 節点の高さ。形は φ そのもの——ここに形状の式は1行も無い。
    const { phi, bandX, bandZ } = grill
    for (let n = 0; n < N * N; n++) yBuf[n] = -defl * phi[n]

    // X方向の部材
    const xm = xRef.current
    const xc = xm.instanceColor.array
    for (let j = 0; j < N; j++) {
      const z = gz(j)
      for (let i = 0; i < N - 1; i++) {
        const k2 = j * (N - 1) + i
        const ya = yBuf[idx(i, j)]
        const yb = yBuf[idx(i + 1, j)]
        const dy = yb - ya
        const len = Math.sqrt(H * H + dy * dy)
        dummy.position.set(gx(i) + H * 0.5, (ya + yb) * 0.5, z)
        dummy.rotation.set(0, 0, Math.atan2(dy, H))
        dummy.scale.set(len, DEPTH, WID)
        dummy.updateMatrix()
        xm.setMatrixAt(k2, dummy.matrix)
        const col = BAND_LINEAR[bandX[k2]]
        const o = k2 * 3
        xc[o] = col[0]
        xc[o + 1] = col[1]
        xc[o + 2] = col[2]
      }
    }
    xm.instanceMatrix.needsUpdate = true
    xm.instanceColor.needsUpdate = true

    // Z方向の部材
    const zm = zRef.current
    const zc = zm.instanceColor.array
    for (let j = 0; j < N - 1; j++) {
      const zA = gz(j)
      for (let i = 0; i < N; i++) {
        const k2 = j * N + i
        const ya = yBuf[idx(i, j)]
        const yb = yBuf[idx(i, j + 1)]
        const dy = yb - ya
        const len = Math.sqrt(H * H + dy * dy)
        dummy.position.set(gx(i), (ya + yb) * 0.5, zA + H * 0.5)
        dummy.rotation.set(Math.atan2(-dy, H), 0, 0)
        dummy.scale.set(WID, DEPTH, len)
        dummy.updateMatrix()
        zm.setMatrixAt(k2, dummy.matrix)
        const col = BAND_LINEAR[bandZ[k2]]
        const o = k2 * 3
        zc[o] = col[0]
        zc[o + 1] = col[1]
        zc[o + 2] = col[2]
      }
    }
    zm.instanceMatrix.needsUpdate = true
    zm.instanceColor.needsUpdate = true

    // 荷重の輪。有彩色は使わない——色は力にしか出さないと決めたので、
    // 荷重そのものは白い輪1本で置く。
    const fi = (lx + SPAN_HALF) / H
    const fj = (lz + SPAN_HALF) / H
    const i0 = Math.min(N - 2, Math.max(0, Math.floor(fi)))
    const j0 = Math.min(N - 2, Math.max(0, Math.floor(fj)))
    const u = Math.min(1, Math.max(0, fi - i0))
    const v = Math.min(1, Math.max(0, fj - j0))
    const yL =
      yBuf[idx(i0, j0)] * (1 - u) * (1 - v) +
      yBuf[idx(i0 + 1, j0)] * u * (1 - v) +
      yBuf[idx(i0, j0 + 1)] * (1 - u) * v +
      yBuf[idx(i0 + 1, j0 + 1)] * u * v
    ringRef.current.position.set(lx, yL + 0.17, lz)

    if (stats) {
      stats.peak = grill.peak
      stats.defl = grill.phiMax * defl
      stats.residual = grill.residual
      stats.lx = lx
      stats.lz = lz
      stats.exagg = defl
    }
  })

  return (
    <>
      <color attach="background" args={[BG]} />
      {/* 影を落とすためだけの1灯。強くすると床の影が塊になって版面より目立つので、
          環境光を上げて指向光を落とし、影は「接地の合図」の濃さに留める。 */}
      <ambientLight intensity={0.92} />
      <directionalLight
        position={[7, 20, 5]}
        intensity={0.34}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-9}
        shadow-camera-right={9}
        shadow-camera-top={9}
        shadow-camera-bottom={-9}
        shadow-camera-near={1}
        shadow-camera-far={52}
        shadow-bias={-0.0007}
        shadow-normalBias={0.02}
      />

      {/* 拾いは床で受けて、当たり点は使わずレイを y=0 平面と自分で交える。
          板の上に見えない板をもう1枚置くと、それが薄く写り込む（実測）。 */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, FLOOR_Y, 0]}
        receiveShadow
        onPointerMove={(e) => {
          const r = e.ray
          if (Math.abs(r.direction.y) < 1e-6) return
          const s = -r.origin.y / r.direction.y
          const px = r.origin.x + r.direction.x * s
          const pz = r.origin.z + r.direction.z * s
          pointer.current.x = Math.max(-4.6, Math.min(4.6, px))
          pointer.current.z = Math.max(-4.6, Math.min(4.6, pz))
          pointer.current.at = performance.now()
        }}
      >
        <planeGeometry args={[70, 70]} />
        <meshLambertMaterial color={FLOOR} />
      </mesh>

      <instancedMesh ref={xRef} args={[unit, undefined, NX]} castShadow receiveShadow>
        <meshLambertMaterial />
      </instancedMesh>
      <instancedMesh ref={zRef} args={[unit, undefined, NZ]} castShadow receiveShadow>
        <meshLambertMaterial />
      </instancedMesh>

      {COLUMNS.map(([i, j], n) => (
        <mesh key={n} position={[gx(i), (FLOOR_Y + 0) / 2, gz(j)]} castShadow>
          <boxGeometry args={[0.17, -FLOOR_Y, 0.17]} />
          <meshLambertMaterial color={INK} />
        </mesh>
      ))}

      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.56, 0.019, 8, 64]} />
        <meshBasicMaterial color="#f7f8f8" />
      </mesh>

    </>
  )
}

const SPAN_HALF = ((N - 1) * H) / 2
