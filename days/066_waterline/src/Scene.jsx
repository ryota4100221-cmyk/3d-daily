import React, { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import {
  Color,
  DynamicDrawUsage,
  FrontSide,
  InstancedBufferAttribute,
  Matrix4,
  Quaternion,
  RingGeometry,
  ShaderMaterial,
  Vector3,
  Vector4,
} from 'three'
import {
  BEND,
  ETA,
  HEAD_PART,
  PALETTE,
  PARTS,
  WASH,
  WAVES,
  WAVE_GLSL,
  capsuleGeometry,
  makeSegments,
  makeShoal,
  poseSwimmer,
  waveH,
} from './rig.js'

const COUNT = 36
const SPLASH_MAX = 64
const SPLASH_LIFE = 1.7

const waveVec = WAVES.map((s) => new Vector4(s.ax, s.kx, s.kz, s.w))
const wavePh = WAVES.map((s) => s.ph)

// ── 地 ──────────────────────────────────────────────────────────────────
// 海は面ではない。「カメラから出た光線が y=0 の高さを下に切ったか」だけ。
// 水面のメッシュを1枚も置かないので、水平線は無限遠まで正確で、遠景で割れない。
const backdropVert = /* glsl */ `
  varying vec2 vNdc;
  void main() {
    vNdc = position.xy;
    gl_Position = vec4(position.xy, 1.0, 1.0);
  }
`

const backdropFrag = /* glsl */ `
  precision highp float;
  varying vec2 vNdc;
  uniform mat4 uInvVP;
  uniform vec3 uCam;
  uniform vec3 uSkyHigh, uSkyLow, uSea, uHaze;

  void main() {
    vec4 far = uInvVP * vec4(vNdc, 1.0, 1.0);
    vec3 dir = normalize(far.xyz / far.w - uCam);

    vec3 c;
    if (dir.y >= 0.0) {
      c = mix(uSkyLow, uSkyHigh, pow(clamp(dir.y * 5.2, 0.0, 1.0), 0.78));
    } else {
      float t = uCam.y / -dir.y;             // 視線が水面の高さに届くまでの距離
      float f = smoothstep(18.0, 200.0, t);  // 遠いほど空気に食われる
      c = mix(uSea, uHaze, pow(f, 0.86));
    }
    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }
`

function Backdrop() {
  const mat = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: backdropVert,
        fragmentShader: backdropFrag,
        depthTest: false,
        depthWrite: false,
        uniforms: {
          uInvVP: { value: new Matrix4() },
          uCam: { value: new Vector3() },
          uSkyHigh: { value: new Color(PALETTE.skyHigh) },
          uSkyLow: { value: new Color(PALETTE.skyLow) },
          uSea: { value: new Color(PALETTE.sea) },
          uHaze: { value: new Color(PALETTE.haze) },
        },
      }),
    []
  )

  useFrame(({ camera }) => {
    mat.uniforms.uInvVP.value.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse)
    mat.uniforms.uCam.value.setFromMatrixPosition(camera.matrixWorld)
  })

  return (
    <mesh frustumCulled={false} renderOrder={-100} material={mat}>
      <planeGeometry args={[2, 2]} />
    </mesh>
  )
}

// ── 泳者 ────────────────────────────────────────────────────────────────
// 頂点シェーダの仕事は2つ。
//   ① 縮退した赤道の帯を aHalf ぶん開いてカプセルにする
//   ② 水面より下に落ちた点を、もう一度だけ読み直す（d′ = d/η ＋ ∇h ぶんの横流れ）
// ②に入る条件は「その点の真上の水面より下か」だけで、胴・腕・脚の区別をしない。
// 腕が水を切る瞬間は腕の都合ではなく、水面の側の都合で決まっている。
const bodyVert = /* glsl */ `
  attribute float aStretch;
  attribute float aHalf;
  attribute vec3 aTint;

  uniform float uTime, uEta, uBend;

  varying vec3 vColor;
  varying vec3 vN;
  varying float vSunk;
  varying float vFar;

  ${WAVE_GLSL}

  void main() {
    vec3 lp = position + vec3(0.0, aStretch * aHalf, 0.0);
    vec4 wp = modelMatrix * instanceMatrix * vec4(lp, 1.0);
    vec3 p = wp.xyz;

    vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
    vColor = aTint;

    float surf = waveH(p.xz, uTime);
    float d = surf - p.y;
    if (d > 0.0) {
      float da = d / uEta;                        // 見かけの深さは浮き上がる
      p.xz += waveGrad(p.xz, uTime) * da * uBend; // 面が傾いていれば横へ流れる
      p.y = surf - da;
      vSunk = da;
    } else {
      vSunk = 0.0;
    }

    vec4 mv = viewMatrix * vec4(p, 1.0);
    vFar = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`

const bodyFrag = /* glsl */ `
  precision highp float;
  varying vec3 vColor;
  varying vec3 vN;
  varying float vSunk;
  varying float vFar;

  uniform vec3 uSea, uHaze;
  uniform float uWash;

  void main() {
    // 水は色を洗う。深いほど地の青へ寄る。透明度は1つも使っていない。
    float k = 1.0 - exp(-vSunk * uWash);
    vec3 c = mix(vColor, uSea, k * 0.88);

    // 塗り分けを壊さない程度の面の向きだけ。光源は0個。
    float s = 0.5 + 0.5 * dot(normalize(vN), normalize(vec3(0.18, 1.0, 0.34)));
    c *= 0.925 + 0.15 * s;

    c = mix(c, uHaze, smoothstep(18.0, 200.0, vFar));
    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }
`

function Shoal({ splash }) {
  const ref = useRef()
  const shoal = useMemo(() => makeShoal(COUNT), [])
  const segs = useMemo(() => makeSegments(), [])
  const hands = useMemo(() => [new Vector3(), new Vector3()], [])
  const prevHand = useMemo(() => new Float32Array(COUNT * 2).fill(1), [])

  // 幾何と、インスタンスごとの2つの数（半長・色）は最初に一度だけ作る。
  const { geo, half } = useMemo(() => {
    const g = capsuleGeometry(7, 16, 14)
    const n = COUNT * PARTS
    const h = new Float32Array(n).fill(0.5)
    const tint = new Float32Array(n * 3)
    const ha = new InstancedBufferAttribute(h, 1)
    ha.setUsage(DynamicDrawUsage)
    g.setAttribute('aHalf', ha)
    const c = new Color()
    for (let i = 0; i < COUNT; i++) {
      for (let p = 0; p < PARTS; p++) {
        c.set(p === HEAD_PART ? shoal[i].cap : PALETTE.body)
        const k = (i * PARTS + p) * 3
        tint[k] = c.r
        tint[k + 1] = c.g
        tint[k + 2] = c.b
      }
    }
    g.setAttribute('aTint', new InstancedBufferAttribute(tint, 3))
    return { geo: g, half: h }
  }, [shoal])

  const mat = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: bodyVert,
        fragmentShader: bodyFrag,
        side: FrontSide,
        uniforms: {
          uTime: { value: 0 },
          uEta: { value: ETA },
          uBend: { value: BEND },
          uWash: { value: WASH },
          uSea: { value: new Color(PALETTE.sea) },
          uHaze: { value: new Color(PALETTE.haze) },
          uWave: { value: waveVec },
          uWavePh: { value: wavePh },
        },
      }),
    []
  )

  const sc = useMemo(
    () => ({
      m: new Matrix4(),
      q: new Quaternion(),
      up: new Vector3(0, 1, 0),
      mid: new Vector3(),
      dir: new Vector3(),
      s3: { x: 1, y: 1, z: 1 },
    }),
    []
  )

  useFrame(({ clock }) => {
    const mesh = ref.current
    if (!mesh) return
    const t = clock.getElapsedTime()
    mat.uniforms.uTime.value = t

    let n = 0
    for (let i = 0; i < COUNT; i++) {
      const sw = shoal[i]
      poseSwimmer(sw, t, segs, hands)
      for (let p = 0; p < PARTS; p++) {
        const s = segs[p]
        sc.dir.subVectors(s.b, s.a)
        const len = Math.max(sc.dir.length(), 1e-5)
        sc.dir.divideScalar(len)
        sc.mid.addVectors(s.a, s.b).multiplyScalar(0.5)
        sc.q.setFromUnitVectors(sc.up, sc.dir)
        sc.s3.x = sc.s3.y = sc.s3.z = s.r
        sc.m.compose(sc.mid, sc.q, sc.s3)
        mesh.setMatrixAt(n, sc.m)
        // 半径で割るのは、instanceMatrix の一様スケールが後から効くから
        half[n] = len / 2 / s.r
        n++
      }
      // 手が水面を下向きに切った瞬間だけ、輪を1つ置く
      for (let h = 0; h < 2; h++) {
        const dy = hands[h].y - waveH(hands[h].x, hands[h].z, t)
        const key = i * 2 + h
        if (prevHand[key] > 0 && dy <= 0) splash.spawn(hands[h].x, hands[h].z, t, sw.scale)
        prevHand[key] = dy
      }
    }
    mesh.instanceMatrix.needsUpdate = true
    mesh.geometry.getAttribute('aHalf').needsUpdate = true
  })

  return <instancedMesh ref={ref} args={[geo, mat, COUNT * PARTS]} frustumCulled={false} />
}

// ── 入水の輪 ────────────────────────────────────────────────────────────
// 水面を描かない代わりに、水面が「そこにある」ことを1つだけ言わせる。
// 輪は必ず y = waveH(...) の上に乗るので、波と一緒に上下する。
const ringVert = /* glsl */ `
  attribute vec3 aRing;    // (x, z, t0)
  attribute float aScale;
  uniform float uTime, uLife;
  varying float vFade;
  ${WAVE_GLSL}
  void main() {
    float age = (uTime - aRing.z) / uLife;
    if (aRing.z < 0.0 || age > 1.0 || age < 0.0) {
      gl_Position = vec4(3.0, 3.0, 3.0, 1.0);   // 空き枠は画面の外へ捨てる
      vFade = 0.0;
      return;
    }
    float r = aScale * (0.08 + 0.78 * pow(age, 0.60));
    vec3 p = vec3(aRing.x + position.x * r, 0.0, aRing.y + position.z * r);
    p.y = waveH(p.xz, uTime) + 0.004;
    vFade = pow(1.0 - age, 1.8) * 0.52;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
`

const ringFrag = /* glsl */ `
  precision highp float;
  varying float vFade;
  uniform vec3 uInk;
  void main() {
    if (vFade <= 0.002) discard;
    gl_FragColor = vec4(uInk, vFade);
    #include <colorspace_fragment>
  }
`

function Splash({ api }) {
  const { geo, ring, scale, state } = useMemo(() => {
    const g = new RingGeometry(0.9, 1.0, 44)
    g.rotateX(-Math.PI / 2)
    const r = new Float32Array(SPLASH_MAX * 3).fill(-1)
    const s = new Float32Array(SPLASH_MAX).fill(1)
    const ra = new InstancedBufferAttribute(r, 3)
    const sa = new InstancedBufferAttribute(s, 1)
    ra.setUsage(DynamicDrawUsage)
    sa.setUsage(DynamicDrawUsage)
    g.setAttribute('aRing', ra)
    g.setAttribute('aScale', sa)
    return { geo: g, ring: r, scale: s, state: { head: 0 } }
  }, [])

  const mat = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: ringVert,
        fragmentShader: ringFrag,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        uniforms: {
          uTime: { value: 0 },
          uLife: { value: SPLASH_LIFE },
          uInk: { value: new Color('#f4f8f9') },
          uWave: { value: waveVec },
          uWavePh: { value: wavePh },
        },
      }),
    []
  )

  api.spawn = (x, z, t, s) => {
    const i = state.head
    state.head = (state.head + 1) % SPLASH_MAX
    ring[i * 3] = x
    ring[i * 3 + 1] = z
    ring[i * 3 + 2] = t
    scale[i] = s
    geo.getAttribute('aRing').needsUpdate = true
    geo.getAttribute('aScale').needsUpdate = true
  }

  useFrame(({ clock }) => {
    mat.uniforms.uTime.value = clock.getElapsedTime()
  })

  return <instancedMesh args={[geo, mat, SPLASH_MAX]} renderOrder={-10} frustumCulled={false} />
}

// ── カメラ ──────────────────────────────────────────────────────────────
// 目の高さは水面のすぐ上（0.60）。ここに置くと、遠くの泳者が全部1本の線に潰れる。
// 再現元が空と海を「上下に割る」ことで作っていた強さは、この高さから出ている。
function Eye() {
  const { camera } = useThree()
  const target = useMemo(() => new Vector3(), [])
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime()
    // 横に振らない（水平線を動かさない）。前後にだけ、息の速さで寄る。
    camera.position.set(0.45 + 0.09 * Math.sin(t * 0.17), 1.30, 2.70 + 0.30 * Math.sin(t * 0.12))
    target.set(0.0, 0.10, -10.9)
    camera.lookAt(target)
  })
  return null
}

export default function Scene() {
  const api = useMemo(() => ({ spawn: () => {} }), [])
  return (
    <>
      <Eye />
      <Backdrop />
      <Splash api={api} />
      <Shoal splash={api} />
    </>
  )
}
