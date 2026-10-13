import { useMemo, useRef, useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Environment, Lightformer } from '@react-three/drei'
import * as THREE from 'three'
import { grad, FLAVORS } from './flavors.js'
import { drawLabel, LW, LH } from './label.js'

const N = FLAVORS.length - 1
const H = 5.14 // 250 ml スリム缶：高さ/直径 = 2.57（ref の 447/174 px）
const smoother = (x) => x * x * x * (x * (x * 6 - 15) + 10)

// 背景：ref の 16×16 実測から。明度は (y − 0.158x) の1変数の折れ線＝左下から斜めに立つ灰の煙
const bgVert = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy * 2.0, 0.9999, 1.0); }`
const bgFrag = /* glsl */ `
varying vec2 vUv; uniform vec3 uA; uniform vec3 uB; uniform vec2 uRes;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
void main(){
  float px = vUv.x * 1440.0, py = (1.0 - vUv.y) * 900.0;
  float t = py - 0.158 * px;
  float n = noise(vec2(px, py) * 0.006) * 0.6 + noise(vec2(px, py) * 0.015) * 0.4;
  t += (n - 0.5) * 28.0;
  float L = clamp((t - 192.0) / 468.0, 0.0, 1.0) * 0.452;
  L *= 1.0 - smoothstep(680.0, 900.0, py) * 0.6;
  vec3 c = vec3(L, L * 0.99, L * 0.975);
  // 足元の光だまり2つ（ref: 中央下 #69516f・右下 #334f62）
  float ga = exp(-pow((px - 640.0) / 260.0, 2.0) - pow((py - 920.0) / 150.0, 2.0));
  float gb = exp(-pow((px - 960.0) / 220.0, 2.0) - pow((py - 900.0) / 130.0, 2.0));
  c = mix(c, uA * 0.62, ga * 0.85);
  c = mix(c, uB * 0.36, gb * 0.65);
  c += (hash(vec2(px, py)) - 0.5) / 255.0; // 階調の段を崩す
  gl_FragColor = vec4(c, 1.0);
}`

function Background({ s }) {
  const mat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: bgVert, fragmentShader: bgFrag, depthWrite: false, depthTest: false,
    uniforms: { uA: { value: new THREE.Color() }, uB: { value: new THREE.Color() }, uRes: { value: new THREE.Vector2() } },
  }), [])
  useFrame(() => {
    const v = s.current.v
    mat.uniforms.uA.value.setRGB(...grad(Math.min(1, v + 0.86)))
    mat.uniforms.uB.value.setRGB(...grad(v + 0.12))
  })
  return <mesh renderOrder={-1} frustumCulled={false} material={mat}><planeGeometry args={[1, 1]} /></mesh>
}

// 円柱の端で印刷面が沈む（視線と法線の角）。ref の缶は左右の端が黒へ落ちる
const edgeFall = (sh) => {
  sh.fragmentShader = sh.fragmentShader.replace('#include <dithering_fragment>',
    'float nv = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);\n gl_FragColor.rgb *= mix(0.12, 1.0, pow(nv, 0.8));\n#include <dithering_fragment>')
}

function lathe(pts) {
  return new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 128)
}

function Can({ s }) {
  const group = useRef()
  const { label, masks, tex, mtex } = useMemo(() => {
    const label = document.createElement('canvas'); label.width = LW; label.height = LH
    const masks = document.createElement('canvas'); masks.width = LW; masks.height = LH
    const tex = new THREE.CanvasTexture(label); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8
    const mtex = new THREE.CanvasTexture(masks); mtex.anisotropy = 8
    return { label, masks, tex, mtex }
  }, [])
  const shown = useRef(-1)
  const paint = (i) => {
    drawLabel(label, masks, grad(i / N)); tex.needsUpdate = true; mtex.needsUpdate = true; shown.current = i
  }
  const ready = useRef(false)
  useEffect(() => {
    Promise.all([document.fonts.load('italic 900 100px Archivo'), document.fonts.load('600 30px Inter')])
      .then(() => { ready.current = true; paint(Math.round(s.current.v * N)) })
  }, [])

  const ends = useMemo(() => ({
    bottom: lathe([[0, 0.16], [0.5, 0.15], [0.7, 0.07], [0.79, 0.0], [0.86, 0.0], [0.93, 0.05], [0.975, 0.12], [0.997, 0.19], [1.0, 0.23]]),
    top: lathe([[1.0, 4.91], [0.993, 4.95], [0.975, 4.97], [0.94, 5.03], [0.93, 5.07], [0.935, 5.1], [0.93, 5.12], [0.9, 5.1], [0.885, 5.06], [0.6, 5.055], [0, 5.055]]),
  }), [])

  useFrame((st) => {
    const f = s.current.v * N
    const k = Math.floor(f), fr = f - k
    const turned = k + smoother(Math.min(1, fr * 1.25))
    const want = Math.round(f)
    // 味は缶の裏が正面を向いている間（半回転の前後）に入れ替える
    if (want !== shown.current && ready.current) paint(want)
    const t = st.clock.elapsedTime
    group.current.rotation.y = -turned * Math.PI * 2 + Math.sin(t * 0.5) * 0.05
    group.current.position.y = -H / 2 + Math.sin(t * 0.8) * 0.04
  })

  return (
    <group ref={group} rotation={[0, 0, 0]}>
      <mesh position={[0, 0.22 + 2.35, 0]}>
        <cylinderGeometry args={[1.0005, 1.0005, 4.7, 160, 1, true, Math.PI]} />
        <meshPhysicalMaterial map={tex} roughnessMap={mtex} metalnessMap={mtex} roughness={1} metalness={1} envMapIntensity={1.0} clearcoat={0.55} clearcoatRoughness={0.28} onBeforeCompile={edgeFall} />
      </mesh>
      <mesh geometry={ends.bottom}><meshStandardMaterial color="#e4e4ea" metalness={0.65} roughness={0.38} side={THREE.DoubleSide} /></mesh>
      <mesh geometry={ends.top}><meshStandardMaterial color="#ececf0" metalness={0.75} roughness={0.18} side={THREE.DoubleSide} /></mesh>
    </group>
  )
}

export default function Scene({ s }) {
  return (
    <>
      <Background s={s} />
      <ambientLight intensity={0.15} />
      <directionalLight position={[-2, 3, 6]} intensity={0.35} />
      <Environment resolution={256} frames={1}>
        <Lightformer form="rect" intensity={2.2} position={[-2, 1, 6]} rotation-y={-0.3} scale={[3.5, 9, 1]} />
        <Lightformer form="rect" intensity={3} position={[0, -6, 5]} rotation-x={-0.9} scale={[8, 1, 1]} />
        <Lightformer form="rect" intensity={6} position={[-6.5, 0, 2.6]} rotation-y={1.18} scale={[0.7, 12, 1]} />
        <Lightformer form="rect" intensity={3} position={[-7, 0, -2.5]} rotation-y={Math.PI / 2} scale={[0.5, 12, 1]} />
        <Lightformer form="rect" intensity={2} position={[7, 0, -1.5]} rotation-y={-Math.PI / 2} scale={[0.8, 12, 1]} />
        <Lightformer form="rect" intensity={1.2} position={[0, 9, 0]} rotation-x={Math.PI / 2} scale={[6, 6, 1]} />
      </Environment>
      <Can s={s} />
    </>
  )
}
