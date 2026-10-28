import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

// 自分の稜線で描かれる衛星：面は濃紺の半透明（縁ほど明るい）、稜線と翼のセルだけ水色の線。
// 局所座標：X＝翼の軸、Y＝翼の幅、Z＝望遠鏡の向き（翼の面の法線と同じ）。単位は m 相当。

const lin = (hex) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace)   // sRGB の 16 進 → 線形

const faceVert = /* glsl */ `
varying vec3 vN; varying vec3 vV; varying vec2 vUv;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.);
  vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vUv = uv;
  gl_Position = projectionMatrix * mv;
}`
const faceFrag = /* glsl */ `
uniform vec3 uDeep; uniform vec3 uRim; uniform float uOpacity; uniform float uGrid;
uniform vec2 uCells; uniform vec2 uFine; uniform vec2 uCellSize;
varying vec3 vN; varying vec3 vV; varying vec2 vUv;
float line(float x, float w){ float d = abs(fract(x - .5) - .5); return 1. - smoothstep(0., w * fwidth(x), d); }
void main(){
  float f = pow(1. - abs(dot(normalize(vN), normalize(vV))), 2.);
  float lit = 0.65 + 0.6 * max(dot(normalize(vN), normalize(vec3(-0.5, 0.7, 0.6))), 0.);
  vec3 c = mix(uDeep, uRim, f) * (uGrid > 0. ? 1. : lit);
  float a = uOpacity + f * 0.25;
  if (uGrid > 0.) {
    // セルの継ぎ目（明るい）・セルの中の細い格子（暗め）
    vec2 g = vUv * uCells;
    float seam = max(line(g.x, 1.6), line(g.y, 1.2));
    float dsx = abs(fract(g.x - .5) - .5) / fwidth(g.x), dsy = abs(fract(g.y - .5) - .5) / fwidth(g.y);
    float glow = exp(-min(dsx, dsy) / 2.2);
    vec2 h = vUv * uFine;
    float fine = max(line(h.x, 0.9), line(h.y, 0.9));
    // セルの中の濃淡（セルごとにわずかに違う青）
    vec2 id = floor(g);
    float v = fract(sin(dot(id, vec2(12.9, 78.2))) * 43758.5);
    c *= 0.3 + 1.1 * v;
    // 長辺の縁へ向かって明るくなる帯
    float edgeY = min(vUv.y, 1. - vUv.y);
    c += uRim * 0.28 * exp(-edgeY * 12.);
    // セルの中の長方形の部品（セルごとに位置・大きさが違う）
    vec2 fc0 = fract(g);
    vec2 rc = vec2(0.3 + 0.4 * fract(v * 7.3), 0.3 + 0.4 * fract(v * 13.1));
    vec2 rs = vec2(0.08 + 0.1 * fract(v * 3.7), 0.12 + 0.12 * fract(v * 5.9));
    vec2 rd = abs(fc0 - rc) - rs;
    float rbox = max(rd.x, rd.y);
    float rline = 1. - smoothstep(0., 1.5 * fwidth(rbox), abs(rbox));
    c += uRim * 0.3 * rline + (rbox < 0. ? -c * 0.35 : vec3(0.));
    // セルの内側に一回り小さい枠（薄く・縁から 0.1 m）
    vec2 fc = fract(g); vec2 e = min(fc, 1. - fc) * uCellSize;
    float de = min(e.x, e.y);
    float frame = 1. - smoothstep(0., 1.2 * fwidth(de), abs(de - 0.1));
    // 明るさのムラ（セル内の低周波）と密な格子
    float mura = fract(sin(dot(floor(vUv * vec2(60., 14.)), vec2(7.1, 3.3))) * 951.7);
    vec2 h2 = vUv * uFine * 2.;
    float fine2 = max(line(h2.x, 0.7), line(h2.y, 0.7));
    c *= 0.8 + 0.5 * mura;
    float wob = fract(sin(dot(floor(vUv * uFine), vec2(3.7, 9.1))) * 517.3);
    c += uRim * (0.22 * fine * (0.4 + 1.2 * wob) + 0.1 * fine2) + uRim * 0.35 * frame + vec3(0.35, 0.6, 1.6) * 0.9 * seam + vec3(0.2, 0.4, 1.0) * 0.22 * glow;
    a = max(a, seam * 0.9);
  }
  gl_FragColor = vec4(c, a);
}`

function useFaceMat(opts = {}) {
  return useMemo(() => new THREE.ShaderMaterial({
    vertexShader: faceVert, fragmentShader: faceFrag,
    uniforms: {
      uDeep: { value: lin(opts.deep ?? 0x0a1f5c) }, uRim: { value: lin(opts.rim ?? 0x2f63e0) },
      uOpacity: { value: opts.opacity ?? 0.55 }, uGrid: { value: opts.grid ? 1 : 0 },
      uCells: { value: new THREE.Vector2(...(opts.cells ?? [4, 1])) }, uFine: { value: new THREE.Vector2(...(opts.fine ?? [24, 6])) },
      uCellSize: { value: new THREE.Vector2(...(opts.cellSize ?? [1.55, 1.6])) },
    },
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    extensions: { derivatives: true },
  }), [])
}

// 稜線：奥ほど暗く（カメラからの距離 17→23 で 1→0.4）
const lineMat = (rgb, op) => new THREE.ShaderMaterial({
  uniforms: { uC: { value: new THREE.Color(...rgb) }, uOp: { value: op } },
  vertexShader: `varying float vD; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.); vD = -mv.z; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform vec3 uC; uniform float uOp; varying float vD; void main(){ float k = mix(1.15, 0.4, smoothstep(17.5, 22.5, vD)); gl_FragColor = vec4(uC * k, uOp); }`,
  transparent: true, depthWrite: false, toneMapped: false,
})
const edgeMat = lineMat([0.5, 0.72, 1.0], 0.8)
const edgeDim = lineMat([0.16, 0.3, 0.7], 0.5)

// 面＋稜線をひとまとめに
function Part({ geo, mat, edge = edgeMat, thresh = 20, ...props }) {
  const edges = useMemo(() => new THREE.EdgesGeometry(geo, thresh), [geo])
  return (
    <group {...props}>
      <mesh geometry={geo} material={mat} />
      <lineSegments geometry={edges} material={edge} />
    </group>
  )
}

function Wing({ side, faceMat, panelMat }) {
  // 翼：腕（細い棒）→ 4 セルの板。板は 5.4 × 1.25 × 0.06
  const L = 6.2, W = 1.6
  const geo = useMemo(() => new THREE.BoxGeometry(L, W, 0.06), [])
  const arm = useMemo(() => new THREE.BoxGeometry(0.7, 0.12, 0.12), [])
  const yoke = useMemo(() => new THREE.BoxGeometry(0.1, 0.9, 0.1), [])
  const x0 = 0.22
  return (
    <group scale={[side, 1, 1]}>
            <Part geo={yoke} mat={faceMat} position={[x0 + 0.72, 0, 0]} edge={edgeDim} />
      <Part geo={geo} mat={panelMat} position={[x0 + 0.78 + L / 2, 0, 0]} />
      {/* 板の上の小さな丸い穴（センサ）：セルごとに1つ */}
      {[0, 1, 2, 3].map((i) => (
        <mesh key={i} position={[x0 + 0.78 + (i + 0.5) * (L / 4) + [0.3, -0.25, 0.1, -0.4][i], [-0.35, 0.3, 0.05, -0.5][i], 0.04]}>
          <ringGeometry args={[0.02, 0.035 + (i % 3) * 0.01, 12]} />
          <meshBasicMaterial color={new THREE.Color(0.45, 0.65, 1.1)} toneMapped={false} transparent opacity={0.6} />
        </mesh>
      ))}
    </group>
  )
}

// 胴の細かい部品（支柱・金具・アンテナ）：ref の胴は線が密に重なる
const B = (x, y, z) => new THREE.BoxGeometry(x, y, z)
// 胴のまわりの小さな部品を種つき乱数で（配線・金具の密度）
let seed = 7
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
const MORE = Array.from({ length: 22 }, () => {
  const face = Math.floor(rnd() * 3)
  const u = (rnd() - 0.5) * 1.3, v = (rnd() - 0.5) * 1.1
  const thin = true; rnd()
  const size = thin ? [0.018, 0.018, 0.15 + rnd() * 0.35] : [0.08 + rnd() * 0.2, 0.06 + rnd() * 0.18, 0.05 + rnd() * 0.12]
  const p = face === 0 ? [u, v, 0.66 + size[2] / 2 * (thin ? 0 : 1)] : face === 1 ? [u, 0.68, v * 0.9] : [0.78, v, u * 0.8]
  return { geo: B(...size), p, r: thin ? [rnd() * 3, rnd() * 3, 0] : [0, 0, 0] }
})
const DETAILS = [
  ...MORE,
  { geo: B(0.06, 0.06, 1.3), p: [-0.6, 0.62, 0.55], r: [0, 0, 0] },
  { geo: B(0.06, 0.06, 1.3), p: [0.6, 0.62, 0.55], r: [0, 0, 0] },
  { geo: B(1.3, 0.06, 0.06), p: [0, 0.62, 1.2] },
  { geo: B(0.06, 0.06, 1.1), p: [0.2, 0.4, 0.95], r: [0.6, 0.5, 0] },
  { geo: B(0.06, 0.06, 1.1), p: [-0.3, 0.3, 0.95], r: [-0.4, 0.7, 0] },
  { geo: B(0.35, 0.22, 0.22), p: [0.62, 0.42, 0.95] },
  { geo: B(0.2, 0.35, 0.18), p: [-0.72, -0.45, 0.85] },
  { geo: B(0.5, 0.12, 0.3), p: [0.35, -0.68, 0.6] },
  { geo: B(0.04, 0.5, 0.04), p: [0.55, 0.9, 0.3], r: [0, 0, 0.3] },
  { geo: B(0.04, 0.4, 0.04), p: [-0.4, 0.85, 0.4], r: [0.3, 0, -0.2] },
  { geo: B(0.9, 0.5, 0.05), p: [0.1, 0.4, -0.7] },
  { geo: B(0.25, 0.25, 0.25), p: [-0.85, 0.45, -0.3] },
  { geo: B(0.9, 0.04, 0.04), p: [0.05, 0.1, 0.64], r: [0, 0, 0.5] },
  { geo: B(0.7, 0.04, 0.04), p: [-0.1, -0.2, 0.64], r: [0, 0, -0.4] },
  { geo: B(0.04, 0.9, 0.04), p: [0.3, 0.0, 0.66] },
  { geo: B(0.25, 0.18, 0.1), p: [-0.35, 0.35, 0.68] },
  { geo: B(0.18, 0.28, 0.1), p: [0.45, -0.15, 0.68] },
  { geo: B(0.04, 0.04, 0.6), p: [-0.62, -0.5, 0.7], r: [0.3, 0.4, 0] },
  { geo: new THREE.CylinderGeometry(0.18, 0.05, 0.25, 12, 1, true), p: [0.75, 0.7, 0.65], r: [1.2, 0, 0.4] },
]

export default function Satellite({ pointer }) {
  const root = useRef()
  const faceMat = useFaceMat({ deep: 0x0a1d4a, rim: 0x2f5fc0, opacity: 0.5 })
  const panelMat = useFaceMat({ deep: 0x041030, rim: 0x163a80, opacity: 0.82, grid: true, cells: [4, 1], fine: [36, 9] })
  const bodyMat = useFaceMat({ deep: 0x0c2460, rim: 0x3f72d8, opacity: 0.6 })

  const g = useMemo(() => ({
    bus: new THREE.BoxGeometry(1.5, 1.3, 1.25),
    top: new THREE.BoxGeometry(1.3, 0.7, 0.9),
    tube: new THREE.CylinderGeometry(0.52, 0.52, 1.25, 28, 1, true),
    tubeRing: new THREE.TorusGeometry(0.52, 0.018, 6, 36),
    lens: new THREE.CircleGeometry(0.3, 28),
    lensRing: new THREE.TorusGeometry(0.3, 0.014, 6, 28),
    frame: new THREE.BoxGeometry(0.08, 1.4, 0.08),
    box1: new THREE.BoxGeometry(0.45, 0.35, 0.3),
    box2: new THREE.BoxGeometry(0.3, 0.5, 0.25),
  }), [])

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime
    const r = root.current
    // ポインタでわずかに向きを変える＋ごく遅い漂い
    const tx = pointer.y * 0.12 + Math.sin(t * 0.21) * 0.02
    const ty = pointer.x * 0.16 + Math.sin(t * 0.17) * 0.025
    r.rotation.x += (tx - r.rotation.x) * Math.min(1, dt * 2)
    r.rotation.y += (ty - r.rotation.y) * Math.min(1, dt * 2)
  })

  return (
    <group position={[4.95, -0.22, 0]} scale={0.65}>
      <group ref={root}>
        {/* 姿勢：翼の軸を画面で右下へ 47.5°、望遠鏡を手前・左下へ */}
        <group rotation={[0, 0, 0]} rotation-order="ZYX">
          <group rotation={[0.55, -0.35, -0.76]}>
            <group scale={1.25}>
            <Part geo={g.bus} mat={bodyMat} />
            <Part geo={g.top} mat={faceMat} position={[0.05, 0.55, -0.35]} />
            <Part geo={g.box1} mat={faceMat} position={[-0.55, 0.45, 0.75]} edge={edgeMat} />
            <Part geo={g.box2} mat={faceMat} position={[0.5, -0.3, 0.75]} edge={edgeMat} />
            <Part geo={g.frame} mat={faceMat} position={[-0.78, 0, 0.5]} edge={edgeDim} />
            <Part geo={g.frame} mat={faceMat} position={[0.78, 0, 0.5]} edge={edgeDim} />
            {DETAILS.map((d, i) => (
              <Part key={i} geo={d.geo} mat={faceMat} position={d.p} rotation={d.r || [0, 0, 0]} edge={i < MORE.length ? edgeDim : (i % 3 ? edgeMat : edgeDim)} />
            ))}
            {/* 望遠鏡：胴の手前（+Z）へ */}
            <group position={[-0.1, -0.4, 1.15]} rotation={[Math.PI / 2 + 0.35, 0, 0]}>
              <mesh geometry={g.tube} material={bodyMat} />
              <lineSegments material={edgeDim}>
                <edgesGeometry args={[new THREE.CylinderGeometry(0.52, 0.52, 1.25, 14, 3, true), 1]} />
              </lineSegments>
              <mesh geometry={g.tubeRing} material={edgeMat} position={[0, 0.62, 0]} rotation={[Math.PI / 2, 0, 0]} />
              <mesh geometry={g.tubeRing} material={edgeDim} position={[0, -0.62, 0]} rotation={[Math.PI / 2, 0, 0]} />
              <mesh geometry={g.lens} material={faceMat} position={[0, 0.4, 0]} rotation={[-Math.PI / 2, 0, 0]} />
              <mesh geometry={g.lensRing} material={edgeDim} position={[0, 0.4, 0]} rotation={[Math.PI / 2, 0, 0]} />
              <mesh geometry={g.lensRing} material={edgeDim} position={[0, 0.4, 0]} rotation={[Math.PI / 2, 0, 0]} scale={0.55} />
              <mesh geometry={g.tubeRing} material={edgeDim} position={[0, 0.15, 0]} rotation={[Math.PI / 2, 0, 0]} />
            </group>
            </group>
            <Wing side={1} faceMat={faceMat} panelMat={panelMat} />
            <Wing side={-1} faceMat={faceMat} panelMat={panelMat} />
          </group>
        </group>
      </group>
    </group>
  )
}
