// Scene.jsx — Day 051 / Ribbon
//
// 帯を作るのは rig.js。ここがやるのは「その帯をどう照らすと、ロールが見えるか」。
//
// ロール露光は照明の問題でもある。真っ黒な地に白い帯を1本置いたとき、
// 明るさを決めているのは3つだけ:
//   (a) 表か裏か      — サテンは表と裏で反射率が違う。ねじれるたびに入れ替わる
//   (b) 長手に沿った筋 — 異方性ハイライト（Kajiya-Kay）。帯の向きにだけ光が伸びる
//   (c) 真横を向いた所 — 面はラスタライザから消える。そこだけ縁の線1本が残る
// (c) が今日の要で、「消える」を暗くして描くのではなく、**面積をゼロにして消す**。

import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { buildFrames, ribbonGeometry, edgeGeometry, edgeOnCount, TAU } from './rig.js'

const HALF_W = 0.235

// ロールの時間。連続して回し続けるのはやめた。
//
// 理由は絵ではなく計測のほうにある。headless の screenshot は DOM のレイヤを
// **最初のラスタのまま**焼くことがあり（Day 050 の「数字が初期値で焼き付く」と同型・
// --run-all-compositor-stages-before-draw を足しても再発した）、canvas だけが最新に
// なる。ロールが流れ続けると「絵の φ」と「文字の φ」が必ず食い違う。
//
// そこで φ は指数で目標値へ落ち着き、あとは ±6° 呼吸するだけにする。落ち着いた先の
// 値は t に依らないので、最初のペイントの前に同じ数字を入れておける（下の useLayoutEffect）。
const PHASE_END = 1.15
const PHASE_TAU = 1.7
const BREATH = 0.108

function rollPhase(t) {
  return PHASE_END * (1 - Math.exp(-t / PHASE_TAU)) + BREATH * Math.sin(t * 0.30)
}

// 曲線点 → 帯の面。押し出しもロールもここでやるので、turns を変えても
// ジオメトリは作り直さない（CPU に残るのは曲線1本ぶんの配列だけ）。
const VERT = /* glsl */ `
  attribute vec3 aR;
  attribute vec3 aT;
  attribute float aSide;
  attribute float aArc;

  uniform float uPhase;   // ロールの位相（時間で流す）
  uniform float uRot;     // 一周ぶんの総回転 = turns*TAU - holonomy
  uniform float uHalfW;
  uniform float uInvL;    // 1/曲線長。φ' = uRot * uInvL

  varying vec3 vN;
  varying vec3 vT;
  varying vec3 vW;
  varying float vArc;

  void main() {
    float phi = uPhase + uRot * aArc;
    vec3 T = normalize(aT);
    vec3 R = normalize(aR);
    vec3 B = cross(T, R);
    float c = cos(phi), s = sin(phi);
    vec3 u  =  c * R + s * B;   // 幅方向
    vec3 up = -s * R + c * B;   // ねじれが無ければこれが面法線

    vec3 p = position + aSide * uHalfW * u;

    // ねじれている帯の法線は、幅の端ほど接線方向へ倒れる。
    // X(s,v) = P + v*u  →  N = normalize(up - v * φ' * T)
    vec3 n = normalize(up - (aSide * uHalfW * uRot * uInvL) * T);

    vec4 wp = modelMatrix * vec4(p, 1.0);
    vW = wp.xyz;
    vN = normalize(mat3(modelMatrix) * n);
    vT = normalize(mat3(modelMatrix) * T);
    vArc = aArc;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`

const NOISE = /* glsl */ `
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
`

const FRAG = /* glsl */ `
  varying vec3 vN;
  varying vec3 vT;
  varying vec3 vW;
  varying float vArc;

  uniform float uTime;

  ${NOISE}

  void main() {
    vec3 N = normalize(vN);
    float face = gl_FrontFacing ? 1.0 : 0.0;
    if (face < 0.5) N = -N;

    vec3 V = normalize(cameraPosition - vW);
    vec3 T = normalize(vT);

    // (a) 表と裏。裏は同じ白でも 1/3 しか返さない。ねじれるたびに入れ替わる
    vec3 albedo = mix(vec3(0.300), vec3(0.985), face);

    vec3 L1 = normalize(vec3(-0.52, 0.80, 0.62)); // キー・左上手前
    vec3 L2 = normalize(vec3(0.88, -0.16, -0.42)); // 起こし・右下奥
    vec3 L3 = normalize(vec3(0.30, 0.55, 0.78));  // 前オチ・帯が正面を向く区間を白へ持ち上げる
    float d1 = max(dot(N, L1), 0.0) * 1.32;
    float d2 = max(dot(N, L2), 0.0) * 0.30;
    float d3 = max(dot(N, L3), 0.0) * 0.46;

    // (b) 異方性ハイライト。帯の長手に沿ってだけ伸びる筋
    vec3 H = normalize(L1 + V);
    float th = dot(T, H);
    float sp = pow(sqrt(max(0.0, 1.0 - th * th)), 74.0);

    float grz = 1.0 - abs(dot(N, V));
    float sheen = pow(grz, 3.4) * 0.16;

    vec3 c = albedo * (d1 + d2 + d3 + 0.030)
           + vec3(1.0) * sp * mix(0.30, 1.30, face)
           + vec3(0.92, 0.94, 1.0) * sheen;

    // 奥は黒に沈める。地が #000 なので、遠い側は距離だけで消えてよい
    float dist = length(cameraPosition - vW);
    c *= mix(0.30, 1.0, 1.0 - smoothstep(9.0, 16.5, dist));

    // 広い面が一度に正面を向く瞬間があるので、白は潰さずに丸める
    c = c / (c + 0.98) * 1.52;
    c += (hash12(gl_FragCoord.xy + uTime * 41.0) - 0.5) * 0.0035;

    gl_FragColor = vec4(max(c, 0.0), 1.0);
  }
`

// (c) 面が消えた所にだけ残る縁。正面を向いている間は 0 なので出てこない。
const EDGE_FRAG = /* glsl */ `
  varying vec3 vN;
  varying vec3 vT;
  varying vec3 vW;
  varying float vArc;

  void main() {
    vec3 N = normalize(vN);
    vec3 V = normalize(cameraPosition - vW);
    float e = 1.0 - smoothstep(0.02, 0.26, abs(dot(N, V)));
    float dist = length(cameraPosition - vW);
    e *= mix(0.30, 1.0, 1.0 - smoothstep(9.0, 16.5, dist));
    if (e < 0.004) discard;
    gl_FragColor = vec4(vec3(0.98, 0.98, 0.96) * e, e * 0.85);
  }
`

const BG_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.9999, 1.0);
  }
`

const BG_FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform float uTime;
  ${NOISE}
  void main() {
    float r = length((vUv - vec2(0.5, 0.56)) * vec2(1.55, 1.0));
    vec3 base = mix(vec3(0.0150, 0.0154, 0.0166), vec3(0.0007, 0.0007, 0.0009),
                    smoothstep(0.10, 0.92, r));
    base += (hash12(gl_FragCoord.xy + uTime * 57.0) - 0.5) * 0.0062;
    gl_FragColor = vec4(max(base, 0.0), 1.0);
  }
`

export default function Scene({ turns, mobius, onRead }) {
  const frames = useMemo(() => buildFrames(1500), [])
  const geo = useMemo(() => ribbonGeometry(frames), [frames])
  const edgeA = useMemo(() => edgeGeometry(frames, -1), [frames])
  const edgeB = useMemo(() => edgeGeometry(frames, 1), [frames])

  const uniforms = useMemo(
    () => ({
      uPhase: { value: 0 },
      uRot: { value: 0 },
      uHalfW: { value: HALF_W },
      uInvL: { value: 1 / frames.length },
      uTime: { value: 0 },
    }),
    [frames]
  )

  const surfMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms,
        side: THREE.DoubleSide,
        // 縁の polyline は面とまったく同じ深度に来るので、押さないと
        // 真横区間がステップル状にちらつく（1回目の実描画で左上に出た）
        polygonOffset: true,
        polygonOffsetFactor: 1.2,
        polygonOffsetUnits: 1.2,
      }),
    [uniforms]
  )

  const edgeMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: EDGE_FRAG,
        uniforms,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [uniforms]
  )

  const bgMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: BG_VERT,
        fragmentShader: BG_FRAG,
        uniforms: { uTime: uniforms.uTime },
        depthTest: false,
        depthWrite: false,
      }),
    [uniforms]
  )

  const lineA = useMemo(() => new THREE.Line(edgeA, edgeMat), [edgeA, edgeMat])
  const lineB = useMemo(() => new THREE.Line(edgeB, edgeMat), [edgeB, edgeMat])

  const group = useRef()
  const { camera, pointer } = useThree()
  const acc = useRef(0)
  const camPos = useMemo(() => new THREE.Vector3(), [])

  // 総回転。holonomy を引くので、turns が整数なら帯はきれいに閉じ、
  // メビウス（+0.5）にすると継ぎ目に1本ねじれが残る
  const rot = (turns + (mobius ? 0.5 : 0)) * TAU - frames.holonomy

  const report = (phase) => {
    if (!onRead) return
    camPos.copy(camera.position)
    if (group.current) camPos.applyMatrix4(group.current.matrixWorld.clone().invert())
    onRead({
      phi: (((phase % TAU) + TAU) % TAU / TAU) * 360,
      turnsDeg: (rot / TAU) * 360,
      holonomy: (frames.holonomy / TAU) * 360,
      edgeOn: edgeOnCount(frames, rot, phase, camPos),
      samples: Math.ceil(frames.N / 3),
    })
  }

  // 最初のペイントの前に、落ち着いた先の数字を入れておく。
  // これが無いと preview.png の DOM が placeholder のまま焼き付く（上のコメント）。
  useLayoutEffect(() => {
    uniforms.uRot.value = rot
    uniforms.uPhase.value = PHASE_END
    if (group.current) {
      group.current.rotation.set(-0.17 + 0.032, 0.34, 0)
      group.current.updateMatrixWorld(true)
    }
    report(PHASE_END)
  })

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime
    uniforms.uRot.value = rot
    uniforms.uPhase.value = rollPhase(t) // 落ち着いてからは ±6° 呼吸するだけ
    uniforms.uTime.value = t

    if (group.current) {
      group.current.rotation.y = 0.34 + Math.sin(t * 0.07) * 0.055 + pointer.x * 0.09
      group.current.rotation.x = -0.17 + Math.cos(t * 0.055) * 0.032 - pointer.y * 0.05
    }

    acc.current += dt
    if (acc.current > 0.12) {
      acc.current = 0
      report(uniforms.uPhase.value)
    }
  })

  return (
    <>
      <mesh material={bgMat} renderOrder={-10} frustumCulled={false}>
        <planeGeometry args={[2, 2]} />
      </mesh>
      <group ref={group} position={[0, 0.55, 0]}>
        <mesh geometry={geo} material={surfMat} frustumCulled={false} />
        <primitive object={lineA} frustumCulled={false} />
        <primitive object={lineB} frustumCulled={false} />
      </group>
    </>
  )
}

export { HALF_W }
