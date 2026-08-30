import { useMemo, useRef, useLayoutEffect } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { P, track, poseAt, railPoints, STEP_COUNT, STEP_PITCH, INCLINE, UPPER_LEN } from './rig.js'

// 実測値（スワイプファイルDB / 東芝エレベータ 採用サイト 2026-08-11 実測）
// 地#FFFFFF ／ 濃灰#303030 ／ 淡灰#F4F4F4・#A0A0A0 ／ 差し色#E61E1E
const C = {
  graphite: '#303030',
  steel: '#A0A0A0',
  pale: '#F4F4F4',
  red: '#E61E1E',
  white: '#FFFFFF',
}

const TOP_Y = poseAt(20).y + P.TREAD
const BOT_Y = poseAt(2).y + P.TREAD

// ── 背景（1枚の内向き球に縦グラデーション。トーンマップは通さない）────────
function Backdrop() {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        toneMapped: false,
        uniforms: {
          uTop: { value: new THREE.Color(C.white) },
          uBot: { value: new THREE.Color('#E6E6E6') },
        },
        vertexShader: `varying vec3 vP;
          void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `varying vec3 vP; uniform vec3 uTop; uniform vec3 uBot;
          void main(){
            float t = clamp(normalize(vP).y * 0.5 + 0.5, 0.0, 1.0);
            gl_FragColor = vec4(mix(uBot, uTop, pow(t, 0.75)), 1.0);
          }`,
      }),
    [],
  )
  return <mesh geometry={useMemo(() => new THREE.SphereGeometry(120, 24, 16), [])} material={mat} />
}

// ── 踏段1個ぶんの形。踏面・クリート・蹴上げ・側ブラケット ──────────────
function buildStepBody() {
  const parts = []
  const box = (w, h, d, x, y, z) => {
    const g = new THREE.BoxGeometry(w, h, d)
    g.translate(x, y, z)
    return g
  }
  // 踏面。前端は main 軸の少し先、後端は trailing 軸の手前
  const front = 0.085
  const back = -P.D + 0.085
  const depth = front - back
  const cx = (front + back) / 2
  parts.push(box(depth, 0.05, P.W, cx, P.TREAD - 0.025, 0))
  // クリート（溝）。実機の踏面は縦溝で、櫛板と噛む
  const n = 19
  const span = P.W - 0.07
  for (let i = 0; i < n; i++) {
    const z = -span / 2 + (span / (n - 1)) * i
    parts.push(box(depth - 0.02, 0.024, 0.027, cx, P.TREAD + 0.012, z))
  }
  // 蹴上げ。後端からRISEぶん下へ、後ろへ少し膨らむ円弧の板
  const shape = new THREE.Shape()
  const K = 16
  const cvx = (t) => back - 0.085 * Math.sin(Math.PI * t) - 0.015
  const cvy = (t) => P.TREAD - P.RISE * t
  shape.moveTo(cvx(0), cvy(0))
  for (let i = 1; i <= K; i++) shape.lineTo(cvx(i / K), cvy(i / K))
  for (let i = K; i >= 0; i--) shape.lineTo(cvx(i / K) + 0.028, cvy(i / K))
  const riser = new THREE.ExtrudeGeometry(shape, { depth: P.W, bevelEnabled: false })
  riser.translate(0, 0, -P.W / 2)
  // 🔴 ExtrudeGeometry は非indexed、BoxGeometry は indexed。混ぜたまま渡すと
  //    mergeGeometries は黙って null を返し、画面は「DOMだけが残った白」になる
  //    ＝空カンバスと見分けが付かない（今日これで1枚無駄にした）。
  parts.push(riser)
  // 側ブラケット（2本の車軸を1つの剛体にしているもの）
  for (const z of [-1, 1]) {
    parts.push(box(P.D + 0.1, 0.1, 0.032, -P.D / 2, 0.005, z * (P.Z_A - 0.05)))
    parts.push(box(0.1, 0.1, 0.2, 0, 0.005, z * (P.Z_A - 0.12)))
    parts.push(box(0.1, 0.1, 0.2, -P.D, 0.005, z * (P.Z_B - 0.09)))
  }
  return mergeGeometries(parts.map((g) => g.toNonIndexed()), false)
}

// ── ローラー4個（main × 2 / trailing × 2）───────────────────────────────
function buildRollers() {
  const parts = []
  const roll = (r, x, z) => {
    const g = new THREE.CylinderGeometry(r, r, 0.058, 18)
    g.rotateX(Math.PI / 2)
    g.translate(x, 0, z)
    return g
  }
  for (const s of [-1, 1]) {
    parts.push(roll(0.085, 0, s * P.Z_A))
    parts.push(roll(0.072, -P.D, s * P.Z_B))
  }
  return mergeGeometries(parts.map((g) => g.toNonIndexed()), false)
}

function tube(which, z, radius) {
  const pts = railPoints(which, z).map((p) => new THREE.Vector3(p[0], p[1], p[2]))
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0)
  return new THREE.TubeGeometry(curve, 620, radius, 9, false)
}

// ── 踏段の列 ────────────────────────────────────────────────────────────
function Chain({ report }) {
  const body = useRef()
  const rollers = useRef()
  const bodyGeo = useMemo(buildStepBody, [])
  const rollGeo = useMemo(buildRollers, [])
  const m = useMemo(() => new THREE.Matrix4(), [])
  const q = useMemo(() => new THREE.Quaternion(), [])
  const v = useMemo(() => new THREE.Vector3(), [])
  const one = useMemo(() => new THREE.Vector3(1, 1, 1), [])
  const zero = useMemo(() => new THREE.Vector3(0, 0, 0), [])
  const zAxis = useMemo(() => new THREE.Vector3(0, 0, 1), [])

  useFrame(() => {
    // 🔴 時計はフレーム数ではなく実経過。headless では rAF がほとんど来ない
    //    （Day 058 の実測: budget 11.9秒に対し rAF は45回）ので、フレームを
    //    時計にすると1秒ぶんも進まない絵が焼き上がる。
    const t = performance.now() / 1000
    const s0 = t * P.SPEED
    for (let i = 0; i < STEP_COUNT; i++) {
      const s = s0 + i * STEP_PITCH
      const pz = poseAt(s)
      q.setFromAxisAngle(zAxis, pz.phi)
      // 返り路の踏段は畳んで消す（実機はトラスの中で、見えない）
      const on = ((s % track.L) + track.L) % track.L <= UPPER_LEN ? 1 : 0
      m.compose(v.set(pz.x, pz.y, 0), q, on ? one : zero)
      body.current.setMatrixAt(i, m)
      rollers.current.setMatrixAt(i, m)
    }
    body.current.instanceMatrix.needsUpdate = true
    rollers.current.instanceMatrix.needsUpdate = true
    report(s0)
  })

  return (
    <group>
      <instancedMesh ref={body} args={[bodyGeo, undefined, STEP_COUNT]} frustumCulled={false}>
        <meshStandardMaterial color={C.graphite} metalness={0.62} roughness={0.4} />
      </instancedMesh>
      <instancedMesh ref={rollers} args={[rollGeo, undefined, STEP_COUNT]} frustumCulled={false}>
        <meshStandardMaterial color={C.pale} metalness={0.1} roughness={0.5} />
      </instancedMesh>
    </group>
  )
}

// ── 2本の軌条。A = main（外・太）／ B = trailing（内・細）────────────────
function Rails() {
  const geos = useMemo(
    () => [
      tube('A', P.Z_A, 0.026),
      tube('A', -P.Z_A, 0.026),
      tube('B', P.Z_B, 0.02),
      tube('B', -P.Z_B, 0.02),
    ],
    [],
  )
  return (
    <group>
      {geos.map((g, i) => (
        <mesh key={i} geometry={g}>
          <meshStandardMaterial
            color={i < 2 ? C.steel : C.red}
            metalness={i < 2 ? 0.95 : 0.35}
            roughness={i < 2 ? 0.18 : 0.42}
          />
        </mesh>
      ))}
    </group>
  )
}

// ── 乗降口。床板と櫛板、そして今日ゆいいつの有彩色 ───────────────────────
function Landings() {
  const plate = (x, y, flip) => (
    <group position={[x, y, 0]}>
      <mesh position={[flip * 0.95, -0.03, 0]}>
        <boxGeometry args={[1.5, 0.09, P.W + 0.66]} />
        <meshStandardMaterial color="#D6D6D6" metalness={0.2} roughness={0.62} />
      </mesh>
      <mesh position={[flip * 0.26, 0.005, 0]}>
        <boxGeometry args={[0.52, 0.028, P.W + 0.18]} />
        <meshStandardMaterial color={C.steel} metalness={0.9} roughness={0.26} />
      </mesh>
      <mesh position={[0, 0.012, 0]}>
        <boxGeometry args={[0.03, 0.036, P.W + 0.18]} />
        <meshStandardMaterial color="#585858" metalness={0.5} roughness={0.4} />
      </mesh>
    </group>
  )
  return (
    <group>
      {plate(19.35, TOP_Y, 1)}
      {plate(1.15, BOT_Y, -1)}
    </group>
  )
}

// ── カメラ。ローラーの居場所に据える ────────────────────────────────────
// 位置は踏段と同じ poseAt() から出す。つまりこのカメラは装置の部品で、
// 走行のたびに軌条が決めた軌跡をなぞる。三脚は一度も立てていない。
const RIDE_FROM = INCLINE.from - 0.6
const RIDE_SPAN = INCLINE.to - INCLINE.from + 1.6
const RIDE_PHASE = 6.2
// 長玉で真横から。この距離だと踏面の水平と傾斜の差が圧縮されて読め、
// 画面の対角に機械が乗るので左上と右下が空く（版面はそこに置く）。
const CAMS = [
  { p: [-1.2, 2.7, 12.0], l: [3.0, 0.8, 0.4], fov: 25 },
  { p: [-1.2, 3.1, 13.0], l: [3.2, 0.6, 0.4], fov: 24 },
  { p: [-1.2, 2.3, 11.0], l: [2.8, 1.0, 0.4], fov: 27 },
]

function Rider({ report }) {
  const { camera } = useThree()
  const look = useMemo(() => new THREE.Vector3(), [])
  useFrame(() => {
    const t = performance.now() / 1000
    const sc = RIDE_FROM + ((t * P.SPEED + RIDE_PHASE) % RIDE_SPAN)
    const here = poseAt(sc)
    const c = CAMS[Number(new URLSearchParams(location.search).get('cam') || 0)] || CAMS[0]
    camera.position.set(here.x + c.p[0], here.y + c.p[1], c.p[2])
    look.set(here.x + c.l[0], here.y + c.l[1], c.l[2])
    camera.lookAt(look)
    if (camera.fov !== c.fov) {
      camera.fov = c.fov
      camera.updateProjectionMatrix()
    }
    report(sc)
  })
  return null
}

export default function Scene({ readout }) {
  const state = useRef({ s0: 0, sc: 0 })
  const push = () => {
    const { s0, sc } = state.current
    // 目の前を通っている1段
    const idx = Math.round((sc + 1.5 - s0) / STEP_PITCH)
    const s = s0 + idx * STEP_PITCH
    const pz = poseAt(s)
    readout({
      tread: (pz.phi * 180) / Math.PI,
      gap: pz.p * 1000,
      step: ((idx % STEP_COUNT) + STEP_COUNT) % STEP_COUNT,
      travel: sc,
      lift: pz.y,
    })
  }
  return (
    <Canvas
      camera={{ fov: 34, near: 0.05, far: 400, position: [8, 3, 3] }}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.18 }}
      dpr={[1, 2]}
    >
      <Env />
      <Backdrop />
      <ambientLight intensity={0.2} />
      <directionalLight position={[7, 15, 11]} intensity={2.3} />
      <directionalLight position={[-11, 5, -7]} intensity={0.6} />
      <directionalLight position={[-2, -6, 8]} intensity={0.35} />
      <Rails />
      <Chain
        report={(s0) => {
          state.current.s0 = s0
        }}
      />
      <Landings />
      <Rider
        report={(sc) => {
          state.current.sc = sc
          push()
        }}
      />
    </Canvas>
  )
}

function Env() {
  const { gl, scene } = useThree()
  useLayoutEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl)
    const rt = pmrem.fromScene(new RoomEnvironment(), 0.04)
    scene.environment = rt.texture
    return () => {
      rt.dispose()
      pmrem.dispose()
      scene.environment = null
    }
  }, [gl, scene])
  return null
}

export { track }
