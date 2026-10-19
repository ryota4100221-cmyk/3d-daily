import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

// 正投影・1 unit = 1 px。画面座標 (X, Y)（左上原点）→ (X − 720, 450 − Y)
// 各片は四面体1つ。4頂点を「画面上の位置」で置き、手前に出す頂点にだけ奥行き z を与える：
//   面が3枚見える片 → 真ん中の1頂点を手前へ／面が2枚見える片 → 2枚が共有する稜線の2頂点を手前へ
// こうすると正面から見た輪郭は置いた4点の凸包そのまま。
// 面の色は「塗り分け」：面ごとに3段のどれかを持たせる（Round 02 で1つの光源から段を引くと、
// 再現元の14面のうち4面がどう光を置いても合わなかった＝再現元は光で塗っていない）
const F = [[0, 1, 2], [0, 1, 3], [1, 2, 3], [0, 2, 3]]
function makeTetra(pts, front, depth, tones) {
  const v = pts.map(([X, Y], i) => new THREE.Vector3(X - 720, 450 - Y, front.includes(i) ? depth : 0))
  const c = v.reduce((a, b) => a.add(b), new THREE.Vector3()).multiplyScalar(0.25)
  v.forEach((p) => p.sub(c))
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(F.flatMap((f) => f.flatMap((i) => v[i].toArray())), 3))
  g.setAttribute('tone', new THREE.Float32BufferAttribute(F.flatMap((f) => { const t = tones[f.join('')] ?? 1; return [t, t, t] }), 1))
  return { geo: g, center: c }
}

const PALETTE = ['#00AFAF', '#01CBCE', '#48DADE'].map((h) => new THREE.Color(h))
const material = new THREE.ShaderMaterial({
  uniforms: { uC: { value: PALETTE } },
  vertexShader: /* glsl */ `
    attribute float tone;
    varying float vT;
    void main() {
      vT = tone;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 uC[3];
    varying float vT;
    void main() {
      vec3 c = vT < 0.5 ? uC[0] : (vT < 1.5 ? uC[1] : uC[2]);
      gl_FragColor = vec4(c, 1.0);
      #include <colorspace_fragment>
    }`,
  side: THREE.DoubleSide,
})

// 再現元（ref.png）の各片の4頂点（画面 px）・手前に出す頂点・見える面の段（0 暗／1 中／2 明）
const PIECES = [
  { p: [[462, 80], [556, 12], [690, -20], [610, 150]], f: [1, 3], d: 70, t: { '013': 2, '123': 1 } },
  { p: [[795, -10], [855, -14], [975, -10], [835, 105]], f: [1, 3], d: 50, t: { '013': 2, '123': 1 } },
  { p: [[1043, 162], [1150, -2], [1352, 85], [1090, -40]], f: [0, 1], d: 80, t: { '013': 2, '012': 1 } },
  { p: [[195, 297], [290, 178], [370, 138], [417, 275]], f: [1, 3], d: 60, t: { '013': 2, '123': 1 } },
  { p: [[1163, 333], [1385, 225], [1480, 150], [1470, 410]], f: [1], d: 90, t: { '012': 2, '013': 1, '123': 0 } },
  { p: [[36, 610], [105, 430], [130, 388], [300, 460]], f: [1, 3], d: 60, t: { '013': 2, '123': 1 } },
  { p: [[1100, 582], [1322, 612], [1540, 572], [1340, 940]], f: [1], d: 120, t: { '012': 2, '013': 1, '123': 0 } },
  { p: [[25, 725], [85, 735], [315, 667], [117, 960]], f: [1], d: 90, t: { '012': 1, '123': 2, '013': 0 } },
  { p: [[512, 808], [455, 880], [530, 905], [495, 868]], f: [3], d: 25, t: { '013': 1, '023': 2 } },
  { p: [[833, 787], [895, 835], [810, 900], [845, 850]], f: [3], d: 25, t: { '013': 2, '123': 2, '023': 1 } },
]

function Spike({ p, f, d, t: tones, i }) {
  const ref = useRef()
  const { geo, center } = useMemo(() => makeTetra(p, f, d, tones), [p, f, d, tones])
  const phase = i * 1.37
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    const m = ref.current
    const breathe = 1 + 0.012 * Math.sin(0.4 * t + phase)
    m.position.set(center.x * breathe, center.y * breathe, center.z)
    m.rotation.set(0.05 * Math.sin(0.21 * t + phase), 0.06 * Math.sin(0.17 * t + phase * 0.7), 0.04 * Math.sin(0.13 * t + phase))
  })
  return <mesh ref={ref} geometry={geo} material={material} />
}

export default function Scene() {
  return (
    <>
      {PIECES.map((x, i) => (
        <Spike key={i} i={i} {...x} />
      ))}
    </>
  )
}
