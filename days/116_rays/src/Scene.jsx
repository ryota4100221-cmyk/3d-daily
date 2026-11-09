import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { Text } from '@react-three/drei'

// 一点に集まる光の帯：視線の軸に平行な板を半径 1 の筒に並べ、内側から見る。
// 板は透視で消失点へ集まる楔になり、手前の端 z_near が画面上の切れ目 r = F / |z_near| になる。
export const FOV = 60
const F = 450 / Math.tan((FOV / 2) * Math.PI / 180) // 779.4 px（高さ 900 のとき）

// [中心角°, 半幅°, 切れ目 r(px), 内色, 中色, 外色, 不透明度, 奥の始まり r(px)]
// 角度は画面の +x から反時計回り（y 上向き）
const OFF = 2600
export const RAYS = [
  // 暗い半透明の帯（先に描く）
  [336.0, 3.8, OFF, '#3a3737', '#474444', '#4c4949', 0.75, 120],
  [201.0, 1.3, OFF, '#5a5450', '#5c5250', '#6a4c58', 0.8, 40],
  [202.4, 0.32, OFF, '#f4ecdc', '#f2d0b0', '#e48aa0', 1, 0],
  // 左上・左
  [163.0, 3.0, OFF, '#efd0d6', '#c785de', '#bb74e8', 1, 0],
  [183.2, 3.0, OFF, '#f0d8d6', '#d7a8d6', '#f6b58c', 1, 0],
  [179.0, 1.3, 466, '#f2dce0', '#dcb4e2', '#cc9ce4', 1, 0],
  // 上
  [100.8, 1.75, OFF, '#f8c8c4', '#f2a0b0', '#ec86a0', 1, 0],
  [114.2, 3.25, OFF, '#f6c0c2', '#ee8eaa', '#da86c2', 1, 0],
  // 右上
  [62.0, 1.75, OFF, '#fdf0c8', '#f9d090', '#f6b778', 1, 0],
  [38.8, 3.25, OFF, '#fdf2c8', '#f9d898', '#f2b67a', 1, 0],
  [34.4, 1.6, 470, '#fdf2c8', '#f8d494', '#f4c07e', 1, 0],
  // 右
  [356.5, 3.0, OFF, '#f6f2da', '#ecf0e0', '#e2f0f2', 1, 0],
  [341.5, 5.0, 465, '#f5f3dc', '#e4f0ea', '#d8eef4', 1, 0],
  [347.2, 0.9, OFF, '#eef3ee', '#dcecf2', '#d4eaf4', 1, 0],
  // 下
  [237.0, 2.4, OFF, '#f0ebe4', '#d6d2cc', '#b4b0aa', 1, 0],
  [245.5, 4.2, OFF, '#f4ecee', '#ebe6e8', '#e2e0dc', 1, 0],
  [267.5, 1.3, OFF, '#f4f1ea', '#e2e2dc', '#c4c6c4', 1, 0],
  [294.0, 1.2, OFF, '#eef2f0', '#d0dce2', '#b4c4cc', 1, 0],
  [299.2, 1.3, OFF, '#f2f5ee', '#dfeaf0', '#c8dae4', 1, 0],
]

// 見出しの 2 行目より前に描く帯（左の紫と上の桃）。ほかの帯は 2 行目の後ろ、1・3 行目の前
const FRONT = [100.8, 114.2, 163.0, 183.2, 179.0]

// 見出し：z = -1 の面に置く（1 単位 = F px）。帯と同じ空間に入れて描く順で前後を交互にする
const LINES_TXT = [['交差せよ。', 217.5, 1], ['新しい火が灯る', 72.5, 100], ['始動だ。', -72.5, 1]]

// 帯の中を走る細い破線（帯の幅の何割の位置か）
const DASH = { 183.2: 0.18, 38.8: 0.62, 341.5: 0.7, 245.5: 0.4, 114.2: 0.55 }

// 灰の細い線：消失点を通らない斜めの線（[角°, 半径オフセット, 始まり r, 終わり r]）
const LINES = [
  [148, 0.03, 160, 900], [140, 0.35, 330, 520], [25, -0.04, 200, 900], [8, 0.18, 300, 600],
  [205, -0.03, 120, 700], [228, -0.05, 260, 640], [300, 0.32, 210, 480], [283, -0.03, 180, 700],
  [318, -0.04, 300, 900], [80, -0.02, 150, 520], [132, 0.05, 220, 650], [195, -0.22, 360, 760],
]

const vert = /* glsl */ `
  varying float vR;
  varying float vU;
  attribute float aU;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vR = -mv.z;
    vU = aU;
    gl_Position = projectionMatrix * mv;
  }
`
const frag = /* glsl */ `
  uniform vec3 c0; uniform vec3 c1; uniform vec3 c2;
  uniform float alpha; uniform float grow; uniform float rStart;
  uniform float pxScale; uniform float grain; uniform float dash; uniform float time; uniform float phase;
  varying float vR;
  varying float vU;
  float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
  void main() {
    float r = ${F.toFixed(2)} / max(vR, 1e-4);
    if (r > grow) discard;
    float t = clamp(r / 760.0, 0.0, 1.0);
    vec3 col = t < 0.62 ? mix(c0, c1, t / 0.62) : mix(c1, c2, smoothstep(0.0, 1.0, (t - 0.62) / 0.38));
    // 帯を外へ走る光の脈（手前へ飛ぶ速さ）
    float P = mod(time * 900.0 + phase, 2600.0) - 200.0;
    col += 0.10 * exp(-pow((r - P) / (40.0 + P * 0.12), 2.0)) * step(0.9, alpha);
    float g = h(floor(gl_FragCoord.xy)) - 0.5;
    col += g * grain;
    if (dash > 0.0) {
      float w = fwidth(vU);
      float on = 1.0 - smoothstep(0.0, w * 0.8, abs(vU - dash));
      on *= step(0.6, fract(r / 3.5)) * smoothstep(60.0, 120.0, r);
      col = mix(col, col * 0.6, on);
    }
    float a = alpha * smoothstep(rStart, rStart + 40.0, r);
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }
`

function rayGeometry(theta, half, rCut, rFar = 1.2) {
  // 半径 1 の筒の上の弦（θ±half）を z 方向に伸ばした長方形
  const a0 = (theta - half) * Math.PI / 180
  const a1 = (theta + half) * Math.PI / 180
  const zFar = -F / rFar
  const zNear = -F / rCut
  const p = (a, z) => [Math.cos(a), Math.sin(a), z]
  const pos = new Float32Array([
    ...p(a0, zFar), ...p(a1, zFar), ...p(a1, zNear),
    ...p(a0, zFar), ...p(a1, zNear), ...p(a0, zNear),
  ])
  const u = new Float32Array([0, 1, 1, 0, 1, 0])
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('aU', new THREE.BufferAttribute(u, 1))
  return g
}

function lineGeometry(theta, off, r0, r1) {
  // 消失点を通らない細い線：画面上の (r0, θ) から (r1, θ+off) へ。3D の線分は直線に写る
  const a0 = theta * Math.PI / 180, a1 = a0 + off
  const pos = new Float32Array([Math.cos(a0), Math.sin(a0), -F / r0, Math.cos(a1), Math.sin(a1), -F / r1])
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('aU', new THREE.BufferAttribute(new Float32Array(2), 1))
  return g
}

function makeMat(c0, c1, c2, alpha, rStart) {
  return new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    uniforms: {
      c0: { value: new THREE.Color(c0) },
      c1: { value: new THREE.Color(c1) },
      c2: { value: new THREE.Color(c2) },
      alpha: { value: alpha },
      grow: { value: 0 },
      rStart: { value: rStart },
      pxScale: { value: 1 },
      grain: { value: alpha < 0.9 ? 0.012 : 0.065 },
      dash: { value: -1 },
      time: { value: 0 },
      phase: { value: Math.random() * 2600 },
    },
  })
}

export default function Scene({ pointer }) {
  const group = useRef()
  const { camera, size } = useThree()
  const items = useMemo(() => {
    const out = []
    RAYS.forEach(([th, hw, cut, c0, c1, c2, al, rs], i) => {
      const mat = makeMat(c0, c1, c2, al, rs)
      if (DASH[th] !== undefined) mat.uniforms.dash.value = DASH[th]
      out.push({ geo: rayGeometry(th, hw, cut), mat, order: FRONT.includes(th) ? 200 + i : i + 2, delay: (i % 7) * 0.05 })
    })
    LINES.forEach(([th, off, r0, r1], i) => {
      out.push({ line: true, geo: lineGeometry(th, off, r0, r1), mat: makeMat('#8c8686', '#7a7474', '#6e6868', 0.5, 0), order: -10 + i * 0.01, delay: 0.2 })
    })
    return out
  }, [])
  const vp = useRef([0, 0])
  useFrame((state) => {
    const t = state.clock.elapsedTime
    // 画面上の消失点 (712, 450)。ポインタで最大 ±36 px ずれる
    const s = size.height / 900
    const tx = -8 * s + pointer.current[0] * 36 * s
    const ty = -pointer.current[1] * 22 * s
    vp.current[0] += (tx - vp.current[0]) * 0.06
    vp.current[1] += (ty - vp.current[1]) * 0.06
    camera.setViewOffset(size.width, size.height, -vp.current[0], -vp.current[1], size.width, size.height)
    // 帯がゆっくり揺れて回る
    if (group.current) group.current.rotation.z = Math.sin(t * 0.21) * 0.025
    for (const it of items) {
      const k = Math.min(1, Math.max(0, (t - 0.15 - it.delay) / 1.1))
      const e = 1 - Math.pow(1 - k, 4)
      it.mat.uniforms.grow.value = e * 3000
      it.mat.uniforms.time.value = t
    }
  })
  const font = import.meta.env.BASE_URL + 'serif-jp.otf'
  return (
    <>
    {LINES_TXT.map(([txt, y, ord], i) => (
      <Text key={i} font={font} fontSize={136 / F} position={[8 / F, y / F, -1]} anchorX="center" anchorY="middle"
        color="#ffffff" outlineWidth={1.6 / F} outlineColor="#2a2525" renderOrder={ord} sdfGlyphSize={128}
        onSync={(m) => { m.material.depthTest = false; m.material.depthWrite = false }}>
        {txt}
      </Text>
    ))}
    <group ref={group}>
      {items.map((it, i) => it.line
        ? <lineSegments key={i} geometry={it.geo} material={it.mat} renderOrder={it.order} frustumCulled={false} />
        : <mesh key={i} geometry={it.geo} material={it.mat} renderOrder={it.order} frustumCulled={false} />)}
    </group>
    </>
  )
}
