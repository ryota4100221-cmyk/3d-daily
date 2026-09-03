import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import {
  BANDS,
  GROUND,
  SKY,
  GLOW,
  M,
  createBand,
  hexToVec,
  backOf,
} from './rig.js'

// ── 地 ──────────────────────────────────────────────────────────────────
// 画面いっぱいの1枚。NDC に直接置くので、カメラが動いても付いてくる。
// 粒（hash ノイズ）は見た目のためだけではない——完全に滑らかなグラデは
// PNG が異様に小さくなり、空カンバスとの区別がバイト数で付かなくなる。
const GROUND_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy * 2.0, 0.9999, 1.0);
}
`

const GROUND_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uSky;
uniform vec3 uGround;
uniform vec3 uGlow;
uniform vec2 uCenter;
uniform float uAspect;
varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  float t = smoothstep(0.0, 1.0, vUv.y);
  vec3 c = mix(uGround, uSky, t);
  vec2 d = (vUv - uCenter) * vec2(uAspect, 1.0);
  c = mix(c, uGlow, exp(-dot(d, d) * 3.2) * 0.62);
  c += (hash(gl_FragCoord.xy) - 0.5) * 0.017;
  gl_FragColor = vec4(c, 1.0);
}
`

// ── 帯 ──────────────────────────────────────────────────────────────────
// 表と裏を分けるのに gl_FrontFacing は使っていない。三角形の巻き方向を
// 間違えると表裏が入れ替わり、しかもそれはビルドでは絶対に出ない種類の
// 事故になる。ここでは「法線がカメラを向いているか」で判定する——球面上の
// 点では、それがそのまま「手前の半球か・向こうの半球か」になる。
const BAND_VERT = /* glsl */ `
attribute float aU;
varying vec3 vW;
varying vec3 vN;
varying float vU;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vU = aU;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`

const BAND_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uFront;
uniform vec3 uBack;
uniform vec3 uKey;
uniform vec3 uCam;
uniform vec3 uFade;
varying vec3 vW;
varying vec3 vN;
varying float vU;

void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(uCam - vW);
  float side = dot(n, v);
  bool outer = side > 0.0;
  vec3 nn = outer ? n : -n;
  vec3 base = outer ? uFront : uBack;

  float lam = 0.5 + 0.5 * dot(nn, normalize(uKey));   // 巻き付けたラップ拡散
  float sky = 0.5 + 0.5 * nn.y;                       // 上からの薄い空
  float rim = pow(1.0 - min(1.0, abs(side)), 3.0);    // 帯が視線に立つ縁

  vec3 c = base * (0.70 + 0.44 * lam) * (0.88 + 0.18 * sky);
  c += vec3(0.93, 0.97, 1.0) * rim * (outer ? 0.11 : 0.05);
  c = mix(uFade, c, smoothstep(0.0, 0.14, vU));       // 尾は地に溶ける

  gl_FragColor = vec4(c, 1.0);
}
`

function Band({ cfg, band, keyDir }) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(band.vPos, 3))
    g.setAttribute('normal', new THREE.BufferAttribute(band.vNor, 3))
    g.setAttribute('aU', new THREE.BufferAttribute(band.vU, 1))
    g.setIndex(new THREE.BufferAttribute(band.index, 1))
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.4)
    return g
  }, [band])

  const uniforms = useMemo(
    () => ({
      uFront: { value: hexToVec(cfg.front) },
      uBack: { value: backOf(cfg.front) },
      uKey: { value: keyDir },
      uCam: { value: new THREE.Vector3() },
      uFade: { value: hexToVec('#BBD5E1') },
    }),
    [cfg, keyDir]
  )

  const mat = useRef()
  const { camera } = useThree()

  useFrame(() => {
    geo.attributes.position.needsUpdate = true
    geo.attributes.normal.needsUpdate = true
    if (mat.current) mat.current.uniforms.uCam.value.copy(camera.position)
  })

  return (
    <mesh geometry={geo} frustumCulled={false}>
      <shaderMaterial
        ref={mat}
        vertexShader={BAND_VERT}
        fragmentShader={BAND_FRAG}
        uniforms={uniforms}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

export default function Scene({ stats, out }) {
  const bands = useMemo(() => BANDS.map((c) => createBand(c)), [])
  const keyDir = useMemo(() => new THREE.Vector3(-0.42, 0.78, 0.46).normalize(), [])
  const group = useRef()

  // 球そのものは1枚も描いていない。帯の並びだけが球を出す。
  // 群れをゆっくり回すのは、球が「在る」ことを一度は見せるため。
  useFrame((state, dt) => {
    const d = Math.min(0.05, dt)
    let steps = 0
    for (const b of bands) {
      steps = b.advance(d)
      b.build()
    }
    if (group.current) {
      group.current.rotation.y += d * 0.085
      group.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.11) * 0.10
    }
    stats.arc = bands[0].arc
    stats.kg = bands[0].kg
    stats.lat = bands[0].lat
    stats.steps = steps
    void out
  })

  const groundUniforms = useMemo(
    () => ({
      uSky: { value: hexToVec(SKY) },
      uGround: { value: hexToVec(GROUND) },
      uGlow: { value: hexToVec(GLOW) },
      uCenter: { value: new THREE.Vector2(0.635, 0.505) },
      uAspect: { value: 1.6 },
    }),
    []
  )

  const { size } = useThree()
  groundUniforms.uAspect.value = size.width / size.height

  return (
    <>
      <mesh renderOrder={-10} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
        <shaderMaterial
          vertexShader={GROUND_VERT}
          fragmentShader={GROUND_FRAG}
          uniforms={groundUniforms}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>

      <group ref={group} position={[0.64, -0.07, 0]}>
        {bands.map((b, i) => (
          <Band key={i} cfg={BANDS[i]} band={b} keyDir={keyDir} />
        ))}
      </group>
    </>
  )
}

export { M }
