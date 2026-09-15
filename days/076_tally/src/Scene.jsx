import React, { useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import {
  RIG,
  WALL_H,
  WALL_X0,
  WALL_X1,
  STILE_XS,
  PANEL_GAP,
  GLSL_VISIBLE,
  bladeYs,
  sunDirection,
} from './rig.js'

// ── 色 ────────────────────────────────────────────────────────────────
// Son Daven の実測は「設計の色 0.01% / アクセントは砂色 #A89474 だけ」。
// つまり**面には色を置かない**。色は太陽の側にしか無い、という決まりでそろえる。
// （リニア値。<Canvas flat> でトーンマップを切ってあるので、ここは素の放射輝度）
const SUN_RGB = new THREE.Color('#FFE8D2').convertSRGBToLinear()
const SKY_RGB = new THREE.Color('#9FB0BE').convertSRGBToLinear()
const SAND_RGB = new THREE.Color('#A89474').convertSRGBToLinear() // 唯一のアクセント色
const FLOOR_ALB = new THREE.Color('#ABA69B').convertSRGBToLinear()
const WOOD_ALB = new THREE.Color('#6E5D49').convertSRGBToLinear()

const SUN_I = 2.15
const SKY_I = 0.72
const BOUNCE_I = 0.28

// ── 共通のシェーダ ────────────────────────────────────────────────────
// 太陽（1灯）＋ 空の半球光。影はシャドウマップではなく rig.js の当たり判定で出す。
// 床も羽根も同じ式で塗る（照明が食い違うと「同じ明るさ」の主張が濁る）。
const COMMON = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uSunCol;
  uniform vec3 uSkyCol;
  uniform vec3 uBounceCol;
  uniform vec3 uAlbedo;
  uniform float uExposure;

  varying vec3 vWorld;
  varying vec3 vNormal;

  vec3 shade(vec3 n, float vis) {
    float ndl = max(dot(n, uSunDir), 0.0);
    vec3 direct = uSunCol * ndl * vis;
    // 半球光：上を向けば空、下を向けば床からの照り返し（＝砂色）
    float up = 0.5 + 0.5 * n.y;
    vec3 ambient = mix(uBounceCol, uSkyCol, up);
    return uAlbedo * (direct + ambient);
  }

  // 🔴 生の ShaderMaterial には three が出力色空間の変換を差し込んでくれない
  // （組み込みマテリアルの colorspace_fragment が入らない）。リニア値をそのまま
  // 書くと sRGB のバッファに素通しされ、**全部が暗く沈む**。最初の1枚がこれで、
  // 空まで真っ黒になった。ビルドも描画も通っていて、絵だけが間違っている類。
  vec3 toSRGB(vec3 c) {
    c = max(c, vec3(0.0));
    return mix(c * 12.92,
               1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055,
               step(vec3(0.0031308), c));
  }

  vec3 tonemap(vec3 c) {
    c *= uExposure;
    return toSRGB(c / (1.0 + c));   // やわらかいロールオフ。白飛びさせない
  }
`

const VERT = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vNormal;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`

// ── 床 ────────────────────────────────────────────────────────────────
// 1ピクセルが床の上で占める幅（fwidth）ぶんを刻んで平均する。
// 遠くで縞が潰れたところは、その区間の「通った割合」そのものに収束する——
// **縞が見えなくなった床は、A も B も C も同じ1つの灰色になる。**
// 数字を読まなくても、絵のほうが先に定理を言う。
const FLOOR_FRAG = /* glsl */ `
  ${COMMON}
  ${GLSL_VISIBLE}
  uniform float uBias;

  const int K = 8;

  void main() {
    vec3 n = normalize(vNormal);

    // 壁からの距離。fwidth でこのピクセルが覆う幅を取り、そのぶんを積分する。
    float a = -vWorld.z;
    float w = fwidth(a);

    float vis = 0.0;
    for (int i = 0; i < K; i++) {
      float f = (float(i) + 0.5) / float(K) - 0.5;
      vec3 q = vec3(vWorld.x, vWorld.y + uBias, vWorld.z - f * w);
      vis += louverVisible(q);
    }
    vis /= float(K);

    gl_FragColor = vec4(tonemap(shade(n, vis)), 1.0);
  }
`

// ── 羽根・方立 ────────────────────────────────────────────────────────
// 逆光なのでカメラ側を向いた面は NdotL < 0 ＝ 空の光だけ。シルエットになる。
// 上面は太陽を向くが、1枚上の羽根に遮られるところは同じ判定で落とす。
const WOOD_FRAG = /* glsl */ `
  ${COMMON}
  ${GLSL_VISIBLE}
  uniform float uBias;

  void main() {
    vec3 n = normalize(vNormal);
    vec3 q = vWorld + n * uBias;
    float vis = louverVisible(q);
    gl_FragColor = vec4(tonemap(shade(n, vis)), 1.0);
  }
`

// 空。夕方の霞。地平の少し上がいちばん明るい。
const SKY_FRAG = /* glsl */ `
  uniform vec3 uSkyCol;
  uniform vec3 uSunCol;
  uniform vec3 uHazeCol;
  uniform float uSunY;
  uniform float uExposure;
  varying vec3 vWorld;
  varying vec3 vNormal;

  void main() {
    float h = clamp(vWorld.y / 26.0, 0.0, 1.0);
    vec3 c = mix(uHazeCol, uSkyCol, pow(h, 0.72));
    // 太陽のあたりのにじみ（壁の向こうにあるので、縁にだけ効く）
    float d = length(vec2(vWorld.x * 0.16, vWorld.y - uSunY));
    c += uSunCol * 0.55 * exp(-d * d * 0.055);
    c *= uExposure;
    c = c / (1.0 + c);
    c = max(c, vec3(0.0));
    c = mix(c * 12.92,
            1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055,
            step(vec3(0.0031308), c));
    gl_FragColor = vec4(c, 1.0);
  }
`

function useLouverUniforms() {
  return useMemo(() => {
    const panel = RIG.map((p) => new THREE.Vector4(p.x0, p.x1, p.s, p.d))
    return {
      uPanel: { value: panel },
      uPanelT: { value: RIG.map((p) => p.t) },
      uPanelN: { value: RIG.map((p) => p.n) },
      uPanelGap: { value: PANEL_GAP },
      uWallX0: { value: WALL_X0 },
      uWallX1: { value: WALL_X1 },
      uWallH: { value: WALL_H },
      uTanA: { value: 0.6 },
      uSunDir: { value: new THREE.Vector3(0, 0.5, 0.86) },
      uSunCol: { value: SUN_RGB.clone().multiplyScalar(SUN_I) },
      uSkyCol: { value: SKY_RGB.clone().multiplyScalar(SKY_I) },
      uBounceCol: { value: SAND_RGB.clone().multiplyScalar(BOUNCE_I) },
      uExposure: { value: 1.0 },
      uBias: { value: 0.0016 },
    }
  }, [])
}

function Rig({ getAlt }) {
  const shared = useLouverUniforms()

  const floorUniforms = useMemo(
    () => ({ ...shared, uAlbedo: { value: FLOOR_ALB.clone() } }),
    [shared]
  )
  const woodUniforms = useMemo(
    () => ({ ...shared, uAlbedo: { value: WOOD_ALB.clone() } }),
    [shared]
  )
  const skyUniforms = useMemo(
    () => ({
      uSkyCol: { value: SKY_RGB.clone().multiplyScalar(0.62) },
      uHazeCol: { value: SAND_RGB.clone().multiplyScalar(0.72) },
      uSunCol: { value: SUN_RGB.clone().multiplyScalar(0.55) },
      uSunY: { value: 3.0 },
      uExposure: { value: 1.0 },
    }),
    []
  )

  // 羽根54枚＋方立5本を1つずつ置く（数が少ないので素直に）
  const blades = useMemo(() => {
    const out = []
    for (const p of RIG) {
      const cx = (p.x0 + p.x1) / 2
      for (const by of bladeYs(p)) {
        out.push({
          key: `${p.id}-${by.toFixed(4)}`,
          pos: [cx, by + p.t / 2, p.d / 2],
          size: [p.x1 - p.x0, p.t, p.d],
        })
      }
    }
    return out
  }, [])

  const stiles = useMemo(() => {
    const out = []
    const d = Math.max(...RIG.map((p) => p.d))
    STILE_XS.forEach((x, i) =>
      out.push({
        key: `st-${i}`,
        pos: [x, WALL_H / 2, d / 2],
        size: [PANEL_GAP, WALL_H, d],
      })
    )
    return out
  }, [])

  useFrame(() => {
    const alt = getAlt()
    const [sx, sy, sz] = sunDirection(alt)
    shared.uSunDir.value.set(sx, sy, sz)
    shared.uTanA.value = Math.tan(alt)
    skyUniforms.uSunY.value = 2.0 + 18.0 * Math.sin(alt)
  })

  return (
    <group>
      {/* 空（壁の向こう・十分遠く） */}
      <mesh position={[0, 11, 34]}>
        <planeGeometry args={[150, 60]} />
        <shaderMaterial
          vertexShader={VERT}
          fragmentShader={SKY_FRAG}
          uniforms={skyUniforms}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>

      {/* 床。壁の手前（内側）から向こう側まで1枚で通す */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -2.0]}>
        <planeGeometry args={[46, 26]} />
        <shaderMaterial
          vertexShader={VERT}
          fragmentShader={FLOOR_FRAG}
          uniforms={floorUniforms}
          toneMapped={false}
        />
      </mesh>

      {blades.map((b) => (
        <mesh key={b.key} position={b.pos}>
          <boxGeometry args={b.size} />
          <shaderMaterial
            vertexShader={VERT}
            fragmentShader={WOOD_FRAG}
            uniforms={woodUniforms}
            toneMapped={false}
          />
        </mesh>
      ))}

      {stiles.map((s) => (
        <mesh key={s.key} position={s.pos}>
          <boxGeometry args={s.size} />
          <shaderMaterial
            vertexShader={VERT}
            fragmentShader={WOOD_FRAG}
            uniforms={woodUniforms}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  )
}

function Camera() {
  const { camera } = useThree()
  React.useLayoutEffect(() => {
    // 壁を画面の下半分に落として、上に空を残す（見出しを3Dに重ねないため）。
    camera.position.set(0.45, 3.30, -9.0)
    camera.lookAt(0, 1.75, -1.0)
    camera.updateProjectionMatrix()
  }, [camera])
  return null
}

export default function Scene({ getAlt }) {
  return (
    <Canvas
      flat
      dpr={1}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
      camera={{ fov: 38, near: 0.1, far: 400 }}
    >
      <Camera />
      <Rig getAlt={getAlt} />
    </Canvas>
  )
}
