import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { Text, MeshTransmissionMaterial, Environment, Lightformer } from '@react-three/drei'

const FONT = import.meta.env.BASE_URL + 'Montserrat-Bold.ttf'
const TAN = Math.tan((30 / 2) * Math.PI / 180)

// 画面の px（1440×900 で測った値）を、奥行き z の平面上の世界座標へ。ref の実測をそのまま置くための1本
function usePx() {
  const { size } = useThree()
  return useMemo(() => {
    const k = (z) => (2 * (10 - z) * TAN) / size.height
    return {
      k,
      x: (px, z = 0) => (px - size.width / 2) * k(z),
      y: (py, z = 0) => (size.height / 2 - py) * k(z),
      // 1440 幅で測った x を、今の幅の中央基準へ（構図は中央から測る）
      cx: (px, z = 0) => (px - 720) * k(z),
      cy: (py, z = 0) => (450 - py) * k(z),
    }
  }, [size])
}

// 地：上が深い紺、画面の半ばから黒へ落ちる。屈折に映るよう scene の中の板として描く
function Sky() {
  const { k } = usePx()
  const z = -8
  const w = 2400 * k(z), h = 1300 * k(z)
  const mat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: `
      varying vec2 vUv;
      void main(){
        // 画面の y（上=0）へ直す：板は 1300px ぶん、中央=450px
        float py = 450.0 + (0.5 - vUv.y) * 1300.0;
        float px = 720.0 + (vUv.x - 0.5) * 2400.0;
        vec3 navy = vec3(0.016, 0.118, 0.27);
        float t = smoothstep(40.0, 470.0, py);
        vec3 c = mix(navy, vec3(0.0), pow(t, 0.8));
        c *= 1.0 - 0.18 * smoothstep(700.0, 1440.0, px);
        // 岩の背後の明るみ：岩の輪郭が紺に抜けて見えるよう、中央上に淡い光だまり
        float g = exp(-pow(length(vec2((px - 720.0) / 520.0, (py - 300.0) / 230.0)), 2.0));
        c += vec3(0.02, 0.07, 0.17) * g;
        // 遠景の稜線：左下から中央へ上る細い斜めの帯（ref の y≈500→440）
        float ridge = 505.0 - px * 0.11;
        float d = ridge - py;
        float fade = 1.0 - smoothstep(420.0, 660.0, px);
        c += vec3(0.012, 0.025, 0.05) * smoothstep(-60.0, -6.0, d) * (1.0 - smoothstep(-6.0, 0.0, d)) * fade;
        c *= 1.0 - 0.85 * smoothstep(-2.0, 4.0, d) * (1.0 - smoothstep(18.0, 50.0, d)) * fade;
        // 左上の隅を沈める・粒状のノイズ
        c *= 1.0 - 0.15 * exp(-pow(length(vec2(px / 520.0, py / 360.0)), 2.0));
        float n = fract(sin(dot(floor(vec2(px, py)), vec2(12.9898, 78.233))) * 43758.5453);
        c += (n - 0.5) * 0.018 * (1.0 - smoothstep(300.0, 600.0, py));
        gl_FragColor = vec4(c, 1.0);
      }`,
    depthWrite: false,
  }), [])
  return <mesh position={[0, 0, z]} material={mat}><planeGeometry args={[w, h]} /></mesh>
}

// 輪の向こうの黒い塊（岩）。上が平らに欠けた多角形を押し出す
function Rock() {
  const { cx, cy, k } = usePx()
  const z = -2.5
  const geo = useMemo(() => {
    // 丸みのある不規則な塊：左上の丸い耳・ほぼ平らな上辺・穴の中へ張り出す左の膨らみ。下は地の黒へ溶けるまで伸ばす
    // 上辺と右は直線で角を立て（右上 x≈855 の鋭い角）、左の耳と穴の中の膨らみだけ曲線にする
    const V = ([x, y]) => new THREE.Vector2(cx(x, z), cy(y, z))
    const sh = new THREE.Shape()
    sh.moveTo(...V([700, 198]).toArray())
    sh.lineTo(...V([744, 214]).toArray())
    sh.lineTo(...V([856, 205]).toArray())
    sh.lineTo(...V([866, 300]).toArray())
    sh.lineTo(...V([870, 800]).toArray())
    sh.lineTo(...V([690, 800]).toArray())
    // 穴の中で左へ丸く張り出し（y≈370）、その下は右へ引っ込む（ref の C 字の塊）
    sh.splineThru([[700, 520], [690, 440], [618, 410], [596, 365], [622, 318], [652, 262], [670, 218], [700, 198]].map(V))
    const g = new THREE.ExtrudeGeometry(sh, { depth: 1.0, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.06, bevelSegments: 4, curveSegments: 64 })
    g.translate(0, 0, -1.0)
    return g
  }, [cx, cy, k])
  return (
    <mesh geometry={geo} position={[0, 0, z]}>
      <meshBasicMaterial color="#000000" />
    </mesh>
  )
}

// 見出し：ref の cap の上端と左端に合わせる（Montserrat の cap 高 = 0.70 em）
function Headline() {
  const { cx, cy, k } = usePx()
  const fs = 124 * k(0)
  const lines = [
    ['THE', 318, 238],
    ['ELEVATION', 570, 405],
    ['COMPASS', 95, 575],
  ]
  return lines.map(([s, x, y]) => (
    <Text key={s} font={FONT} fontSize={fs} anchorX="left" anchorY="top-cap" position={[cx(x), cy(y), 0]} letterSpacing={0.0} color="#E2E2E2">
      {s}
      <meshBasicMaterial color="#E2E2E2" toneMapped={false} />
    </Text>
  ))
}

// 主役：平たいガラスの座金。角を小さく丸めた長方形の断面を回して作る（トーラスだと管が丸く、縁が二重に見えた）
function washerProfile(rIn, rOut, h, c, n = 6) {
  const pts = []
  const corner = (cx, cy, a0) => {
    for (let i = 0; i <= n; i++) {
      const a = a0 + (i / n) * (Math.PI / 2)
      pts.push(new THREE.Vector2(cx + c * Math.cos(a), cy + c * Math.sin(a)))
    }
  }
  corner(rIn + c, -h / 2 + c, Math.PI)        // 内・下
  corner(rOut - c, -h / 2 + c, -Math.PI / 2)  // 外・下
  corner(rOut - c, h / 2 - c, 0)              // 外・上
  corner(rIn + c, h / 2 - c, Math.PI / 2)     // 内・上
  pts.push(pts[0].clone())
  return pts
}

const HAZE_V = `varying vec3 vN; varying vec3 vV;
void main(){ vec4 mv = modelViewMatrix * vec4(position,1.); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`
const HAZE_F = `varying vec3 vN; varying vec3 vV;
void main(){
  float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  float up = 0.5 + 0.5 * normalize(vN).y;
  vec3 c = vec3(0.55, 0.6, 0.7) * (0.0 + 0.8 * pow(f, 6.0)) * (0.55 + 0.6 * up);
  gl_FragColor = vec4(c, 1.0);
}`

const AXIS = new THREE.Vector3(1, -1.15, 0).normalize()
const TILT = 0.95

function Ring() {
  const ref = useRef()
  const { cx, cy, k } = usePx()
  const z = 1.0
  const geo = useMemo(() => {
    const g = new THREE.LatheGeometry(washerProfile(194 * k(z), 282 * k(z), 34 * k(z), 6 * k(z)), 220)
    g.rotateX(Math.PI / 2) // 回転軸を z（カメラ向き）へ
    g.computeVertexNormals()
    return g
  }, [k])
  const haze = useRef()
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    // ref の楕円の長軸（左上→右下）を回転軸にして約 57° 倒す（穴の縦横比 ≈ 0.55）。ゆっくり呼吸する
    ref.current.quaternion.setFromAxisAngle(AXIS, TILT + 0.03 * Math.sin(t * 0.35))
    ref.current.rotateZ(0.04 * Math.sin(t * 0.23))
    haze.current.quaternion.copy(ref.current.quaternion)
  })
  return (
    <group position={[cx(700, z), cy(478, z), z]}>
      <mesh ref={ref} geometry={geo}>
        <MeshTransmissionMaterial
          samples={8} resolution={2048} transmission={1} thickness={0.18} roughness={0.02}
          ior={1.5} chromaticAberration={0.2} anisotropicBlur={0.05} distortion={0}
          color="#ffffff" envMapIntensity={1.8}
        />
      </mesh>
      {/* ガラスの霞と縁：面は淡く、斜めに見える壁ほど明るい（フレネル）。加算で重ねるだけ */}
      <mesh ref={haze} geometry={geo}>
        <shaderMaterial transparent depthWrite={false} blending={THREE.AdditiveBlending} vertexShader={HAZE_V} fragmentShader={HAZE_F} />
      </mesh>
    </group>
  )
}

export default function Scene() {
  return (
    <>
      <Sky />
      <ambientLight intensity={0.3} />
      <directionalLight position={[2, 6, 4]} intensity={1.2} />
      <Environment resolution={256}>
        <Lightformer form="rect" intensity={0.9} color="#a9b4c6" position={[0, 6, 1]} rotation-x={Math.PI / 2} scale={[14, 6, 1]} />
        <Lightformer form="rect" intensity={0.2} color="#7f8fa8" position={[-6, 2, 2]} rotation-y={Math.PI / 2} scale={[6, 8, 1]} />
        <Lightformer form="rect" intensity={0.05} color="#b8c4d8" position={[0, 0, 9]} rotation-y={Math.PI} scale={[30, 30, 1]} />
        <Lightformer form="rect" intensity={1.5} color="#ffffff" position={[-4, 4, 6]} scale={[2, 6, 1]} />
      </Environment>
      <Rock />
      <Headline />
      <Ring />
    </>
  )
}
