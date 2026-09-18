import React, { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { R, L, NM, COLS, Y_MID, columns, PHI } from './rig.js'

// 地の色は実測値（ganso.osaka の DB 行）から。#E5E0CA が地、#C95055 があずきの差し色、
// #F8C830 系が蜜。蜜の色だけは設計の色の 30.57% を占めていたので、ここでも主役に置く。
const GROUND = '#E5E0CA'
const GROUND_EDGE = '#D3CBB0'
const SYRUP_THIN = '#FBD873'
const SYRUP_THICK = '#7A3B04'
const AZUKI = '#B0424A'
const INK = '#2A2520'

// ── 糸の形 ──────────────────────────────────────────────────────────────
// 回転体 r(s) の頂点シェーダ。s に沿って 46 本の余弦を足すだけで、曲げも
// キーフレームも無い。法線は解析で出る: n ∝ (cosθ, −r'(s), sinθ)
const VERT = /* glsl */ `
  #define NM ${NM}
  uniform float uA[NM];
  uniform float uPhi[NM];
  uniform float uR;
  uniform float uL;
  uniform float uFlow;
  uniform float uSwell;
  varying vec3 vN;
  varying vec3 vWP;
  varying float vP;
  varying float vS;

  void main() {
    float s = position.y + uL * 0.5;
    vec2 dir = normalize(position.xz);

    float p = 1.0;
    float dp = 0.0;
    for (int n = 1; n <= NM; n++) {
      float k = 6.283185307179586 * float(n) / uL;
      float a = uA[n - 1];
      float ph = k * (s + uFlow) + uPhi[n - 1];
      p += a * cos(ph);
      dp += -a * k * sin(ph);
    }
    // くびれは 0 にはせず髪の毛一本ぶん残す。ちぎれる直前の糸は実際こう見える
    p = max(p, 0.018);

    float r = uR * p * uSwell;
    vec3 pos = vec3(dir.x * r, position.y, dir.y * r);
    vN = normalize(vec3(dir.x, -uR * dp * uSwell, dir.y));
    vP = p;
    vS = s / uL;
    vec4 wp = modelMatrix * vec4(pos, 1.0);
    vWP = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`

// 蜜の見え方。厚みは円柱の弦長 2rn·(N·V) で近似し、Beer–Lambert で吸収させる。
// 芯は濃く、ふちは透けて明るい——蜜が蜜に見えるのはこの向きの階調だけによる。
const FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uThin;
  uniform vec3 uThick;
  uniform vec3 uCam;
  uniform vec3 uLight;
  uniform float uR;
  uniform float uSigma;
  varying vec3 vN;
  varying vec3 vWP;
  varying float vP;
  varying float vS;

  void main() {
    vec3 N = normalize(vN);
    vec3 V = normalize(uCam - vWP);
    float ndv = clamp(dot(N, V), 0.0, 1.0);
    float chord = 2.0 * uR * vP * ndv;
    float T = exp(-uSigma * chord);
    vec3 col = mix(uThick, uThin, T);

    vec3 Lv = normalize(uLight);
    vec3 H = normalize(Lv + V);
    float spec = pow(max(dot(N, H), 0.0), 120.0);
    float sheen = pow(max(dot(N, H), 0.0), 14.0);
    float edge = pow(1.0 - ndv, 3.0);

    col += vec3(1.0, 0.985, 0.94) * spec * 0.9;
    col += vec3(1.0, 0.92, 0.72) * sheen * 0.13;
    col += vec3(1.0, 0.86, 0.55) * edge * 0.30;
    col *= 0.94 + 0.10 * (1.0 - vS); // 上ほどわずかに明るい（鍋の口から降りてくる）
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`

// 背に落ちる影。糸を太らせて、法線の向きだけでふちをぼかした安い近似。
const SHADOW_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uCam;
  varying vec3 vN;
  varying vec3 vWP;
  varying float vP;
  varying float vS;
  void main() {
    vec3 N = normalize(vN);
    vec3 V = normalize(uCam - vWP);
    float ndv = clamp(dot(N, V), 0.0, 1.0);
    float a = pow(ndv, 1.35) * 0.20;
    gl_FragColor = vec4(0.36, 0.31, 0.22, a);
    #include <colorspace_fragment>
  }
`

function Strand({ col, shadow }) {
  const { camera } = useThree()
  const mat = useRef()
  const geo = useMemo(
    () =>
      shadow
        ? new THREE.CylinderGeometry(1, 1, L, 18, 240, true)
        : new THREE.CylinderGeometry(1, 1, L, 30, 420, true),
    [shadow]
  )
  const uniforms = useMemo(
    () => ({
      uA: { value: col.A },
      uPhi: { value: PHI },
      uR: { value: R },
      uL: { value: L },
      uFlow: { value: 0 },
      uSwell: { value: shadow ? 2.1 : 1 },
      uThin: { value: new THREE.Color(SYRUP_THIN) },
      uThick: { value: new THREE.Color(SYRUP_THICK) },
      uCam: { value: new THREE.Vector3() },
      uLight: { value: new THREE.Vector3(-0.45, 0.72, 1).normalize() },
      uSigma: { value: 5.2 },
    }),
    [col, shadow]
  )

  // 動きは「流れ落ちること」だけ。位相を k·δ ずらすだけなので L で完全に巻き戻り、
  // どの瞬間に撮っても構図が変わらない（headless の仮想時間で撮るための条件）
  useFrame(({ clock }) => {
    const u = mat.current.uniforms
    u.uFlow.value = -((clock.elapsedTime * 0.085) % L)
    u.uCam.value.copy(camera.position)
  })

  return (
    <mesh
      geometry={geo}
      position={[col.x + (shadow ? 0.085 : 0), Y_MID - (shadow ? 0.05 : 0), shadow ? -0.62 : 0]}
      renderOrder={shadow ? -1 : 0}
    >
      <shaderMaterial
        ref={mat}
        args={[
          {
            uniforms,
            vertexShader: VERT,
            fragmentShader: shadow ? SHADOW_FRAG : FRAG,
            transparent: !!shadow,
            depthWrite: !shadow,
            side: THREE.DoubleSide,
          },
        ]}
      />
    </mesh>
  )
}

function Backdrop() {
  const uniforms = useMemo(
    () => ({
      uA: { value: new THREE.Color(GROUND) },
      uB: { value: new THREE.Color(GROUND_EDGE) },
    }),
    []
  )
  return (
    <mesh position={[0, 0, -2.4]}>
      <planeGeometry args={[22, 13]} />
      <shaderMaterial
        args={[
          {
            uniforms,
            vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
            fragmentShader: `
              precision highp float;
              uniform vec3 uA; uniform vec3 uB; varying vec2 vUv;
              void main(){
                vec2 d = (vUv - vec2(0.5, 0.56)) * vec2(1.35, 1.0);
                float v = smoothstep(0.08, 0.62, length(d));
                gl_FragColor = vec4(mix(uA, uB, v), 1.0);
                #include <colorspace_fragment>
              }
            `,
          },
        ]}
      />
    </mesh>
  )
}

// 糸が下がっている縁。鍋の口ではなく、ただの水平な一本にする——
// 何から垂れているかを描くと、この絵の主語がそっちへ移ってしまう
function Lip() {
  return (
    <group>
      <mesh position={[0, 2.52, 0]}>
        <boxGeometry args={[8.72, 0.15, 0.42]} />
        <meshBasicMaterial color={INK} />
      </mesh>
      <mesh position={[0, 2.5955, 0.212]}>
        <boxGeometry args={[8.72, 0.014, 0.001]} />
        <meshBasicMaterial color="#6E665A" />
      </mesh>
      <mesh position={[0, 2.4455, 0.212]}>
        <boxGeometry args={[8.72, 0.013, 0.001]} />
        <meshBasicMaterial color={AZUKI} />
      </mesh>
    </group>
  )
}

export default function Scene() {
  return (
    <>
      <Backdrop />
      <Lip />
      {columns.map((c) => (
        <Strand key={`s${c.j}`} col={c} shadow />
      ))}
      {columns.map((c) => (
        <Strand key={c.j} col={c} />
      ))}
    </>
  )
}
