import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import * as THREE from 'three'
import { sliceTexture, contentsTexture, glassTexture, lidTexture, bubbleTexture, neckTexture, rimTexture, lidTopTexture, shadowTexture } from './paint.js'

// 画面 px → 正投影の座標（1 単位 = 1 px、原点は画面中央）
const P = (x, y) => [x - 720, 450 - y]
const BASE = import.meta.env.BASE_URL

// 胡瓜の輪切り：ref の中心 (x, y)・半径 r。depth で文字の前後と視差の量が決まる
const SLICES = [
  { x: 1105, y: 567, r: 136, z: -300, tilt: [0.32, -0.18], rot: 0.4, seed: 3 },
  { x: 445, y: 315, r: 122, z: -260, tilt: [-0.22, 0.28], rot: 1.1, seed: 5 },
  { x: 222, y: 432, r: 81, z: -220, tilt: [0.12, 0.25], rot: 2.0, seed: 8 },
  { x: 1003, y: 272, r: 63, z: -240, tilt: [0.2, -0.1], rot: 0.2, seed: 13 },
  { x: 1137, y: 330, r: 47, z: -200, tilt: [-0.18, 0.15], rot: 2.6, seed: 21 },
  { x: 482, y: 640, r: 93, z: 220, tilt: [-0.3, -0.12], rot: 1.7, seed: 34 },
  { x: 826, y: 680, r: 53, z: 260, tilt: [0.25, 0.2], rot: 0.9, seed: 55 },
]

const BUBBLES = [
  [1295, 497, 37], [167, 587, 24], [135, 568, 12], [608, 692, 19], [374, 781, 18], [780, 778, 17],
  [800, 762, 10], [1312, 165, 20], [1296, 172, 13], [1375, 240, 9], [583, 808, 13], [757, 805, 7],
]

function Slice({ s, tex, t0 }) {
  const ref = useRef()
  const [x, y] = P(s.x, s.y)
  useFrame(({ clock }) => {
    const t = clock.elapsedTime + t0
    ref.current.rotation.x = s.tilt[0] + Math.sin(t * 0.35) * 0.06
    ref.current.rotation.y = s.tilt[1] + Math.cos(t * 0.29) * 0.06
    ref.current.position.y = y + Math.sin(t * 0.42) * 3
  })
  const k = s.r / 0.97 // テクスチャの皮の外縁は 0.97
  const th = s.r * 0.07
  return (
    <group ref={ref} position={[x, y, s.z]} rotation={[s.tilt[0], s.tilt[1], 0]}>
      <mesh rotation={[0, 0, s.rot]} position={[0, 0, th / 2]} scale={k} renderOrder={1}>
        <circleGeometry args={[1, 128]} />
        <meshBasicMaterial map={tex} transparent alphaTest={0.02} opacity={s.z > 0 ? 0.93 : 1} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[s.r * 0.985, s.r * 0.985, th, 96, 1, true]} />
        <meshBasicMaterial color="#3f6a1c" side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation={[0, Math.PI, s.rot]} position={[0, 0, -th / 2]} scale={k}>
        <circleGeometry args={[1, 128]} />
        <meshBasicMaterial map={tex} transparent alphaTest={0.02} />
      </mesh>
    </group>
  )
}

// 瓶の外形（半径, 画面 y）→ (r, 450−y)
const GLASS = [[0, 641], [92, 641], [108, 637], [115, 628], [117, 612], [117, 318], [114, 306], [108, 298], [106, 290], [106, 280]].map(([r, y]) => new THREE.Vector2(r, 450 - y))

function Jar() {
  const contents = useMemo(() => contentsTexture(101), [])
  const glass = useMemo(() => glassTexture(), [])
  const lid = useMemo(() => lidTexture(), [])
  const neck = useMemo(() => neckTexture(), [])
  const rim = useMemo(() => rimTexture(), [])
  const lidTop = useMemo(() => lidTopTexture(), [])
  const shadow = useMemo(() => shadowTexture(), [])
  const half = [-Math.PI / 2, Math.PI]
  // 瓶の中心 x=753、縦は画面 y をそのまま 450−y で
  return (
    <group position={[753 - 720, 0, -120]} rotation={[0.045, 0, 0.05]}>
      {/* 外側のガラス（丸い肩と底の角）：中身の後ろに淡く */}
      <mesh>
        <latheGeometry args={[GLASS, 96, Math.PI / 2, Math.PI]} />
        <meshBasicMaterial map={rim} side={THREE.DoubleSide} />
      </mesh>
      {/* 中身 */}
      <mesh position={[0, (450 - 626 + 450 - 300) / 2, 2]}>
        <cylinderGeometry args={[109, 109, 626 - 300, 96, 1, true, ...half]} />
        <meshBasicMaterial map={contents} />
      </mesh>
      {/* 首の空き（ガラスだけ） */}
      <mesh position={[0, 450 - 292, 0]}>
        <cylinderGeometry args={[106, 110, 18, 96, 1, true, ...half]} />
        <meshBasicMaterial map={neck} />
      </mesh>
      {/* ガラスの光 */}
      <mesh position={[0, (450 - 640 + 450 - 288) / 2, 4]}>
        <cylinderGeometry args={[117, 117, 640 - 288, 96, 1, true, ...half]} />
        <meshBasicMaterial map={glass} transparent depthWrite={false} />
      </mesh>
      {/* 蓋 */}
      <mesh position={[0, 450 - 254, 0]}>
        <cylinderGeometry args={[109, 109, 56, 128, 1, true, ...half]} />
        <meshBasicMaterial map={lid} />
      </mesh>
      {/* 蓋の上の縁：明るい丸み＋細い影の線 */}
      <mesh position={[0, 450 - 229, 0]}>
        <cylinderGeometry args={[108, 109.5, 7, 128, 1, true, ...half]} />
        <meshBasicMaterial map={lidTop} />
      </mesh>
      {/* 接地の影 */}
      <mesh position={[4, 450 - 643, -130]}>
        <planeGeometry args={[320, 40]} />
        <meshBasicMaterial map={shadow} transparent depthWrite={false} />
      </mesh>
      <mesh position={[0, 450 - 226, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[109, 128]} />
        <meshBasicMaterial color="#d6d6d6" />
      </mesh>
    </group>
  )
}

export default function Scene({ pointer }) {
  const texs = useMemo(() => SLICES.map((s) => sliceTexture(s.seed)), [])
  const btex = useMemo(() => bubbleTexture(), [])
  const back = useRef(), mid = useRef(), front = useRef()
  useFrame(() => {
    const lerp = (o, k) => {
      o.position.x += (pointer.x * k - o.position.x) * 0.06
      o.position.y += (-pointer.y * k - o.position.y) * 0.06
    }
    lerp(back.current, -10)
    lerp(mid.current, -4)
    lerp(front.current, 14)
  })
  return (
    <>
      <group ref={back}>
        {SLICES.filter((s) => s.z < 0).map((s, i) => <Slice key={i} s={s} tex={texs[i]} t0={i * 1.7} />)}
      </group>
      <group ref={mid}>
        <Jar />
      </group>
      <Text
        font={BASE + 'Montserrat-Bold.ttf'}
        sdfGlyphSize={256}
        fontSize={326}
        letterSpacing={-0.04}
        scale={[0.923, 1, 1]}
        anchorX="left"
        anchorY="bottom-baseline"
        position={[184 - 720, 450 - 590, 0]}
        color="#20221C"
      >
        MATSU
      </Text>
      <group ref={front}>
        {SLICES.map((s, i) => (s.z > 0 ? <Slice key={i} s={s} tex={texs[i]} t0={i * 1.7} /> : null))}
        {BUBBLES.map(([x, y, r], i) => (
          <mesh key={i} position={[...P(x, y), 400]}>
            <planeGeometry args={[r * 2, r * 2]} />
            <meshBasicMaterial map={btex} transparent depthWrite={false} />
          </mesh>
        ))}
      </group>
    </>
  )
}
