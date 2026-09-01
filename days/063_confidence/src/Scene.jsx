import React, { useMemo, useRef, useLayoutEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import {
  N,
  PLATE,
  SIG_H,
  SIG_K,
  GAIN,
  AMP,
  STEP,
  REACH,
  makeSurvey,
  freshness,
  pulse,
  age,
  fieldAt,
  coverage,
  FIELD_GLSL,
} from './rig.js'

// Alethia の実測配色（スワイプDBの行より）: #0f1f10 / #c6f19d / #d5eebc / #f5f4f2
const PAPER = new THREE.Color('#e9eeda') // 版面の紙＝まだ何も言えない場所
const WASH = new THREE.Color('#9dbd74') // 確度が上がった所の刷り
const INK = new THREE.Color('#12240f') // 等高線と測点
const LIME = new THREE.Color('#c6f19d') // 測りたての合図（画面で唯一の彩度）

const VERT = /* glsl */ `
precision highp float;
${FIELD_GLSL}
uniform float uAmp;
varying float vH;
varying float vK;
varying vec3  vN;
varying vec2  vUv;
varying vec2  vP;

void main() {
  vUv = uv;
  vec2 p = position.xz;
  vP = p;

  float h, k;
  fieldAt(p, h, k);
  float y = uAmp * h * k;

  // 法線は差分で作る。h ではなく h·k の勾配であることが大事で、
  // 「確度が落ちて土地が沈む」動きにもちゃんと陰影が付く。
  float e = 0.05;
  float hx, kx, hz, kz;
  fieldAt(p + vec2(e, 0.0), hx, kx);
  fieldAt(p + vec2(0.0, e), hz, kz);
  vec3 tx = vec3(e, uAmp * (hx * kx - h * k), 0.0);
  vec3 tz = vec3(0.0, uAmp * (hz * kz - h * k), e);
  vN = normalize(cross(tz, tx));

  vH = h;
  vK = k;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p.x, y, p.y, 1.0);
}
`

const FRAG = /* glsl */ `
precision highp float;
${FIELD_GLSL}
uniform vec3  uPaper;
uniform vec3  uWash;
uniform vec3  uInk;
uniform vec3  uLime;
uniform float uStep;
uniform vec2  uPlate;
varying float vH;
varying float vK;
varying vec3  vN;
varying vec2  vUv;
varying vec2  vP;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  float k = clamp(vK, 0.0, 1.0);

  // 1. 刷り — 確度そのものが濃度になる。測っていない所は白紙のまま。
  //    連続階調にすると「霧」に見えてしまうので、確度を6段に量子化して
  //    段のある刷りにする。地図の等確度線（isoline of confidence）。
  float ks = smoothstep(0.06, 0.86, k);
  ks = (floor(ks * 6.0) + smoothstep(0.66, 1.0, fract(ks * 6.0))) / 6.0;
  vec3 c = mix(uPaper, uWash, ks);

  // 2. 等高線 — 形は全域で分かっているのに、引くのは確度のある所だけ。
  float lv = vH / uStep;
  float d = abs(fract(lv - 0.5) - 0.5);
  float w = fwidth(lv);
  float thin = 1.0 - smoothstep(0.0, w * 1.2, d);
  float lv5 = vH / (uStep * 5.0);
  float d5 = abs(fract(lv5 - 0.5) - 0.5);
  float w5 = fwidth(lv5);
  float bold = 1.0 - smoothstep(0.0, w5 * 1.15, d5);
  float known = smoothstep(0.16, 0.52, k);
  c = mix(c, uInk, thin * known * 0.58);
  c = mix(c, uInk, bold * known * 0.86);

  // 2b. 主張してよい範囲の境界 — 下のバーの DEFENSIBLE AREA と同じ k=0.40。
  //     数字と絵が同じ1本の線を指している。
  float bw = max(fwidth(k), 1e-4);
  float bound = 1.0 - smoothstep(0.0, bw * 1.7, abs(k - 0.40));
  c = mix(c, uInk, bound * 0.62);

  // 3. 起伏の陰 — 紙が浮き出したくらいの弱さで足す
  vec3 L = normalize(vec3(-0.40, 0.86, 0.32));
  float sh = clamp(dot(normalize(vN), L), 0.0, 1.0);
  c *= 0.78 + 0.40 * sh;

  // 4. 測り直しの波
  float pu = pulseAt(vP);
  c = mix(c, uLime, pu * 0.85);

  // 5. 版面の縁 — 地図には枠がある
  vec2 mm = min(vUv, 1.0 - vUv) * uPlate;
  float b = min(mm.x, mm.y);
  float frame = 1.0 - smoothstep(0.018, 0.032, abs(b - 0.34));
  c = mix(c, uInk, frame * 0.38);
  c *= smoothstep(0.0, 0.07, b);

  // 6. 紙の目
  c += (hash(vUv * vec2(1370.0, 910.0)) - 0.5) * 0.022;

  gl_FragColor = vec4(c, 1.0);
}
`

// three は vertexColors:true のとき geometry の color 属性を必ず掛ける。
// instanceColor だけ入れて color 属性が無いと vColor が 0 になり、
// インスタンスが全部まっ黒になる（今日1回踏んだ）。白で埋めておく。
function withWhiteColors(g) {
  const n = g.attributes.position.count
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3))
  return g
}

export default function Scene({ onReadout, t0 = 0 }) {
  const samples = useMemo(() => makeSurvey(), [])
  const fresh = useMemo(() => new Float32Array(N), [])
  const puls = useMemo(() => new Float32Array(N).fill(1), [])

  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(PLATE.w, PLATE.d, 300, 190)
    g.rotateX(-Math.PI / 2)
    return g
  }, [])
  const pinGeo = useMemo(() => withWhiteColors(new THREE.CylinderGeometry(0.009, 0.009, 1, 8)), [])
  const capGeo = useMemo(() => withWhiteColors(new THREE.SphereGeometry(0.034, 14, 10)), [])

  const uniforms = useMemo(
    () => ({
      uS: { value: samples.map((s) => new THREE.Vector3(s.x, s.z, s.v)) },
      uF: { value: fresh },
      uP: { value: puls },
      uSigH: { value: SIG_H },
      uSigK: { value: SIG_K },
      uGain: { value: GAIN },
      uReach: { value: REACH },
      uAmp: { value: AMP },
      uStep: { value: STEP },
      uPaper: { value: PAPER },
      uWash: { value: WASH },
      uInk: { value: INK },
      uLime: { value: LIME },
      uPlate: { value: new THREE.Vector2(PLATE.w, PLATE.d) },
    }),
    [samples, fresh, puls]
  )

  const pins = useRef()
  const caps = useRef()
  const acc = useRef(9)

  const dummy = useMemo(() => new THREE.Object3D(), [])
  const col = useMemo(() => new THREE.Color(), [])

  // instanceColor は setColorAt で初めて生成される。最初のコンパイルまでに
  // 存在しないと USE_INSTANCING_COLOR が定義されず、色が一切効かなくなる。
  useLayoutEffect(() => {
    for (let i = 0; i < N; i++) {
      pins.current.setColorAt(i, INK)
      caps.current.setColorAt(i, INK)
    }
  }, [])

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime + t0

    for (let i = 0; i < N; i++) {
      fresh[i] = freshness(t, samples[i])
      puls[i] = pulse(t, samples[i])
    }

    // 測点の柱は、その測点が立っている「今の」地面から生える。
    // 地面は h·k なので、鮮度が落ちた測点は自分の足元ごと紙に沈む。
    for (let i = 0; i < N; i++) {
      const s = samples[i]
      const f = fresh[i]
      const g = fieldAt(s.x, s.z, samples, fresh)
      const base = AMP * g.h * g.k
      const len = 0.10 + 0.46 * f
      dummy.position.set(s.x, base + len / 2, s.z)
      dummy.scale.set(1, len, 1)
      dummy.updateMatrix()
      pins.current.setMatrixAt(i, dummy.matrix)
      col.copy(INK).lerp(LIME, f * f * 0.9)
      pins.current.setColorAt(i, col)

      dummy.position.set(s.x, base + len, s.z)
      dummy.scale.setScalar(1)
      dummy.updateMatrix()
      caps.current.setMatrixAt(i, dummy.matrix)
      caps.current.setColorAt(i, col)
    }
    pins.current.instanceMatrix.needsUpdate = true
    caps.current.instanceMatrix.needsUpdate = true
    pins.current.instanceColor.needsUpdate = true
    caps.current.instanceColor.needsUpdate = true

    acc.current += dt
    if (acc.current > 0.12 && onReadout) {
      acc.current = 0
      let nf = 0
      let sum = 0
      for (let i = 0; i < N; i++) {
        if (fresh[i] > 0.45) nf++
        sum += age(t, samples[i])
      }
      onReadout({ coverage: coverage(samples, fresh), freshCount: nf, meanAge: sum / N, t })
    }
  })

  return (
    <group>
      <mesh geometry={geo} frustumCulled={false}>
        <shaderMaterial vertexShader={VERT} fragmentShader={FRAG} uniforms={uniforms} />
      </mesh>

      <instancedMesh ref={pins} args={[pinGeo, null, N]} frustumCulled={false}>
        <meshBasicMaterial vertexColors />
      </instancedMesh>

      <instancedMesh ref={caps} args={[capGeo, null, N]} frustumCulled={false}>
        <meshBasicMaterial vertexColors />
      </instancedMesh>
    </group>
  )
}
