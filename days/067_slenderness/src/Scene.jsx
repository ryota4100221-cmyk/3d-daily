import React, { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import {
  FIELD,
  buildField,
  rodLattice,
  amplitude,
  survey,
  frontX,
} from './rig.js'

// UNIPLEX の実測パレット。蛍光イエローグリーンを7段に割って、地から文字色まで
// 一系統で回すのがあのサイトの型なので、陰影も7段に量子化して同じ段を使う。
// 連続階調で塗ると、7段に割ったという設計そのものが消える。
const RAMP = [
  '#FDFFC4',
  '#F7FD46',
  '#E3E92A',
  '#D8E319',
  '#CFDB00',
  '#686E00',
  '#63666A',
].map((h) => new THREE.Color(h))

const BEIGE = new THREE.Color('#E2DBD7') // 対のウォームベージュ＝台
const AIR = new THREE.Color('#EAE4E0') // 台の向こう
const SLATE = new THREE.Color('#63666A')

// ── 棒 ──────────────────────────────────────────────────────────────────
const ROD_VERT = /* glsl */ `
  attribute float aS;
  attribute float aAng;
  attribute float aRad;
  attribute float aCap;
  attribute vec3  iPos;
  attribute float iR;
  attribute vec2  iDir;
  attribute float iCrit;
  attribute float iTint;

  uniform float uDelta;
  uniform float uL;

  varying vec3  vN;
  varying float vS;
  varying float vTint;

  const float PI = 3.141592653589793;

  void main() {
    float s = aS;

    // 倒れているかどうかは、この1行の比較しかない。状態は持っていない。
    float over = max(uDelta - iCrit, 0.0);
    float A = (2.0 / PI) * sqrt(uL * over);

    // 第1モード（両端固定・頭が滑る）とその微分
    float a  = 0.5 * A * (1.0 - cos(2.0 * PI * s));
    float da = A * PI * sin(2.0 * PI * s);

    float H = uL - uDelta;          // 板の高さ。全部の棒で同じ
    vec3  dir = vec3(iDir.x, 0.0, iDir.y);

    vec3 c = iPos + dir * a + vec3(0.0, H * s, 0.0);
    vec3 T = normalize(dir * da + vec3(0.0, H, 0.0));
    // 座屈は1つの鉛直面の中で起きるので、その面の法線は定数。
    // 特異点が無いのでフレームは cross 一発で足りる。
    vec3 B = vec3(-iDir.y, 0.0, iDir.x);
    vec3 N = normalize(cross(B, T));

    vec3 radial = cos(aAng) * N + sin(aAng) * B;
    vec3 p = c + iR * aRad * radial;

    // 天面の法線は接線。板に押さえられている面なので、ここが radial のままだと
    // 棒の頭に穴が空いて見える
    vN = mix(radial, T, aCap);
    vS = s;
    vTint = iTint;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`

const ROD_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uRamp[7];
  varying vec3  vN;
  varying float vS;
  varying float vTint;

  vec3 pick(float q) {
    vec3 c = uRamp[0];
    for (int i = 1; i < 7; i++) {
      if (float(i) <= q) c = uRamp[i];
    }
    return c;
  }

  void main() {
    vec3 n = normalize(vN);
    vec3 key = normalize(vec3(-0.40, 0.72, 0.56));
    float d = max(dot(n, key), 0.0);
    float wrap = clamp(0.38 + 0.62 * dot(n, normalize(vec3(0.55, 0.20, 0.80))), 0.0, 1.0);

    float lum = 0.66 * d + 0.34 * wrap;
    lum *= mix(0.46, 1.0, smoothstep(0.0, 0.14, vS)); // 根元は台の陰に沈む
    lum = clamp(lum + vTint, 0.0, 1.0);

    float q = clamp(1.0 - lum, 0.0, 0.9999) * 7.0;
    gl_FragColor = vec4(pick(q), 1.0);
  }
`

function Rods({ rods, deltaRef }) {
  const geometry = useMemo(() => {
    const lat = rodLattice(22, 8)
    const g = new THREE.InstancedBufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(lat.position, 3))
    g.setAttribute('aS', new THREE.BufferAttribute(lat.aS, 1))
    g.setAttribute('aAng', new THREE.BufferAttribute(lat.aAng, 1))
    g.setAttribute('aRad', new THREE.BufferAttribute(lat.aRad, 1))
    g.setAttribute('aCap', new THREE.BufferAttribute(lat.aCap, 1))
    g.setIndex(new THREE.BufferAttribute(lat.index, 1))

    const n = rods.length
    const iPos = new Float32Array(n * 3)
    const iR = new Float32Array(n)
    const iDir = new Float32Array(n * 2)
    const iCrit = new Float32Array(n)
    const iTint = new Float32Array(n)
    rods.forEach((r, i) => {
      iPos[i * 3] = r.x
      iPos[i * 3 + 1] = 0
      iPos[i * 3 + 2] = r.z
      iR[i] = r.r
      iDir[i * 2] = Math.cos(r.az)
      iDir[i * 2 + 1] = Math.sin(r.az)
      iCrit[i] = r.dcr
      iTint[i] = r.tint
    })
    g.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 3))
    g.setAttribute('iR', new THREE.InstancedBufferAttribute(iR, 1))
    g.setAttribute('iDir', new THREE.InstancedBufferAttribute(iDir, 2))
    g.setAttribute('iCrit', new THREE.InstancedBufferAttribute(iCrit, 1))
    g.setAttribute('iTint', new THREE.InstancedBufferAttribute(iTint, 1))
    g.instanceCount = n
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.3, 0), 9)
    return g
  }, [rods])

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: ROD_VERT,
        fragmentShader: ROD_FRAG,
        side: THREE.DoubleSide,
        uniforms: {
          uDelta: { value: 0 },
          uL: { value: FIELD.L },
          uRamp: { value: RAMP },
        },
      }),
    []
  )

  useFrame(() => {
    material.uniforms.uDelta.value = deltaRef.current
  })

  return <mesh geometry={geometry} material={material} frustumCulled={false} />
}

// ── 影 ──────────────────────────────────────────────────────────────────
// 影マップは使わない（棒の形は頂点シェーダの中にしか無いので深度パスを
// 二重に書くことになる）。代わりに、倒れた向きに伸びる楕円を1本につき1枚だけ
// 台に置いて乗算する。影が伸びること自体が「どちらに倒れたか」を言う。
const SHADOW_VERT = /* glsl */ `
  attribute vec3  iPos;
  attribute float iR;
  attribute vec2  iDir;
  attribute float iCrit;
  uniform float uDelta;
  uniform float uL;
  varying vec2 vUv;
  const float PI = 3.141592653589793;
  void main() {
    float A = (2.0 / PI) * sqrt(uL * max(uDelta - iCrit, 0.0));
    vec3 dir = vec3(iDir.x, 0.0, iDir.y);
    vec3 side = vec3(-iDir.y, 0.0, iDir.x);

    float along  = iR * 7.0 + A * 1.9;
    float across = iR * 6.4;
    vec3 c = iPos + vec3(0.0, 0.004, 0.0) + dir * (A * 0.62) + vec3(0.10, 0.0, 0.06);

    vec3 p = c + dir * (position.x * along) + side * (position.y * across);
    vUv = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`

const SHADOW_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uTint;
  varying vec2 vUv;
  void main() {
    float a = 1.0 - smoothstep(0.18, 1.0, length(vUv) * 2.0);
    gl_FragColor = vec4(mix(vec3(1.0), uTint, a * 0.55), 1.0);
  }
`

function Shadows({ rods, deltaRef }) {
  const geometry = useMemo(() => {
    const g = new THREE.InstancedBufferGeometry()
    const quad = new THREE.PlaneGeometry(1, 1)
    g.setAttribute('position', quad.getAttribute('position'))
    g.setIndex(quad.getIndex())
    const n = rods.length
    const iPos = new Float32Array(n * 3)
    const iR = new Float32Array(n)
    const iDir = new Float32Array(n * 2)
    const iCrit = new Float32Array(n)
    rods.forEach((r, i) => {
      iPos[i * 3] = r.x
      iPos[i * 3 + 2] = r.z
      iR[i] = r.r
      iDir[i * 2] = Math.cos(r.az)
      iDir[i * 2 + 1] = Math.sin(r.az)
      iCrit[i] = r.dcr
    })
    g.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 3))
    g.setAttribute('iR', new THREE.InstancedBufferAttribute(iR, 1))
    g.setAttribute('iDir', new THREE.InstancedBufferAttribute(iDir, 2))
    g.setAttribute('iCrit', new THREE.InstancedBufferAttribute(iCrit, 1))
    g.instanceCount = n
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 9)
    quad.dispose()
    return g
  }, [rods])

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: SHADOW_VERT,
        fragmentShader: SHADOW_FRAG,
        blending: THREE.MultiplyBlending,
        transparent: true,
        depthWrite: false,
        uniforms: {
          uDelta: { value: 0 },
          uL: { value: FIELD.L },
          uTint: { value: new THREE.Color('#C6BCB6') },
        },
      }),
    []
  )

  useFrame(() => {
    material.uniforms.uDelta.value = deltaRef.current
  })

  // 変形なし。四角形は頂点シェーダの中で dir / side に張り直しているので、
  // ここで回すと二重に回る。
  return <mesh geometry={geometry} material={material} renderOrder={1} frustumCulled={false} />

}

// ── 台・板・前線 ────────────────────────────────────────────────────────
// 台。縁を持たせると、この俯角では奥の縁が画面の上半分を横切って
// 見出しにぶつかる（1回目の実描画がそれだった）。縁を作らずに地の色ごと
// 空へ溶かす。溶ける距離だけが奥行きを言う。
const BENCH_VERT = /* glsl */ `
  varying vec3 vW;
  void main() {
    vW = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const BENCH_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uNear;
  uniform vec3 uFar;
  varying vec3 vW;
  void main() {
    // 奥だけで溶かす。半径で溶かすと画面の左右下の隅まで色が変わって、
    // 台が丸い皿に見える
    gl_FragColor = vec4(mix(uNear, uFar, smoothstep(-1.0, -7.5, vW.z)), 1.0);
  }
`

function Bench() {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: BENCH_VERT,
        fragmentShader: BENCH_FRAG,
        uniforms: { uNear: { value: BEIGE }, uFar: { value: AIR } },
      }),
    []
  )
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} material={material}>
      <planeGeometry args={[60, 60]} />
    </mesh>
  )
}

// 板は面では描かない。俯角を付けた瞬間、4.2 奥行きの面は画面の3割を占める
// 灰色の板になって、押されている側が全部隠れる。描くのは板の輪郭＝
// 高さ H の1つの平面に載った長方形だけ。棒の頭が全部その高さで切り揃うので、
// 面が無くても板はそこに在る。
function Plate({ deltaRef }) {
  const ref = useRef()
  const posts = useRef()
  useFrame(() => {
    const H = FIELD.L - deltaRef.current
    if (ref.current) ref.current.position.y = H + 0.026
    // 支柱は板と一緒に縮む。板がどれだけ下りたかを、絵の中で測れる長さにする
    if (posts.current) {
      posts.current.scale.y = H
      posts.current.position.y = H / 2
    }
  })
  const X = 4.9
  const Z = 1.62
  const T = 0.042
  return (
    <>
      <group ref={ref}>
        <mesh position={[0, 0, -Z]}>
          <boxGeometry args={[X * 2 + T, T, T]} />
          <meshBasicMaterial color={SLATE} toneMapped={false} />
        </mesh>
      </group>
      {/* 支柱は板と別の group。板の group の中に入れると平行移動と伸縮が
          二重にかかって、板の倍の高さまで伸びる */}
      <group ref={posts}>
        {[X, -X].map((x) => (
          <mesh key={x} position={[x, 0, -Z]}>
            <boxGeometry args={[T * 0.7, 1, T * 0.7]} />
            <meshBasicMaterial color={SLATE} toneMapped={false} />
          </mesh>
        ))}
      </group>
    </>
  )
}

function Front({ deltaRef }) {
  const ref = useRef()
  useFrame(() => {
    if (ref.current) ref.current.position.x = frontX(deltaRef.current)
  })
  // 場の中を1本の線で貫くと、棒に隠れて切れ切れの筋になり、ただの傷に見える。
  // 場の手前と奥に出した2つの目盛りにする。前線の位置は、隠れない所で言う。
  return (
    <group ref={ref}>
      {[1.95, -1.95].map((z) => (
        <mesh key={z} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, z]}>
          <planeGeometry args={[0.032, 0.38]} />
          <meshBasicMaterial color={SLATE} toneMapped={false} />
        </mesh>
      ))}
    </group>
  )
}

// ── カメラ ──────────────────────────────────────────────────────────────
// 正投影。太さを比べる絵なので、遠近で太さが変わると比較が壊れる。
function Rig() {
  const { camera, size } = useThree()
  useFrame(() => {
    const z = Math.min(size.width / 13.0, size.height / 7.2)
    if (camera.zoom !== z) {
      camera.zoom = z
      camera.updateProjectionMatrix()
    }
    // R3F は自分の作ったカメラを原点に向ける。注視点はここで毎フレーム言い直す
    // （onCreated で1回だけ言うと、条件によって上書きされる）
    camera.lookAt(0, 1.72, 0)
  })
  return null
}

export default function Scene({ deltaRef, readout }) {
  const rods = useMemo(() => buildField(20260906), [])

  useFrame(() => {
    const s = survey(rods, deltaRef.current)
    if (readout.delta.current)
      readout.delta.current.textContent = (deltaRef.current / FIELD.L).toFixed(4)
    if (readout.count.current)
      readout.count.current.textContent = `${String(s.buckled).padStart(3, '0')} / ${s.total}`
    if (readout.lam.current) readout.lam.current.textContent = s.lamFront.toFixed(1)
  })

  return (
    <>
      <color attach="background" args={[AIR.getHex()]} />
      <Rig />
      <Bench />
      <Shadows rods={rods} deltaRef={deltaRef} />
      <Front deltaRef={deltaRef} />
      <Rods rods={rods} deltaRef={deltaRef} />
      <Plate deltaRef={deltaRef} />
    </>
  )
}
