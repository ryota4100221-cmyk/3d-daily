// Scene.jsx — 三幕の舞台
//
// 舞台に置いてあるのは3つだけ:
//   ・ホリゾント（背景の1枚。幕の色そのもの。原作の舞台は箱で、奥行きを持たない）
//   ・床（手前は幕の暗い側、奥はホリゾントに溶ける。境目が地平線になる）
//   ・三体（rig.js の旋盤の身体）
// 影は落とさない。原作の舞台には影が無く、影を足した瞬間に舞台が部屋になる。
// 足元だけ、接地を示す楕円を1枚敷く。

import React, { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { ACTS, buildFigures, FIGURE_SHADER, actWeights, mixScalar } from './rig.js'

// ── ホリゾント ──────────────────────────────────────────────────────────
const CYC_VERT = /* glsl */ `
  varying vec3 vPos;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vPos = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`
const CYC_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uGround;
  uniform vec3 uHorizon;
  uniform float uSeed;
  varying vec3 vPos;
  void main() {
    // 地平線（世界の y=0）で床の色に接ぎ、上へ行くほど幕の色に戻る。
    // 舞台の掃き上げ。継ぎ目が見えないことがホリゾントの条件。
    vec3 col = mix(uHorizon, uGround, smoothstep(0.0, 9.5, vPos.y));
    col *= 1.0 - 0.07 * smoothstep(12.0, 40.0, vPos.y);
    // 端に向かって少しだけ落とす（幕を1枚の平面に見せないための1段）
    col *= 1.0 - 0.06 * smoothstep(24.0, 78.0, abs(vPos.x));
    // 平坦な大面積はバンディングするので、ディザを1粒だけ足す
    float d = fract(sin(dot(vPos.xy * 41.0 + uSeed, vec2(12.9898, 78.233))) * 43758.5453);
    col += (d - 0.5) * 0.007;
    gl_FragColor = vec4(col, 1.0);
  }
`

// ── 床 ──────────────────────────────────────────────────────────────────
const FLOOR_VERT = /* glsl */ `
  varying vec3 vPos;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vPos = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`
const FLOOR_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3  uFloor;
  uniform vec3  uHorizon;
  uniform vec3  uGround;
  uniform vec3  uFeet;     // 三体の x 位置
  uniform vec3  uFootR;    // 三体の足元半径
  uniform float uShadow;
  uniform float uSeed;
  varying vec3 vPos;

  void main() {
    float d = clamp((-vPos.z) / 30.0, 0.0, 1.0);
    // 奥へ行くほどホリゾントの掃き上げに合流する。地平線で色が一致するので継ぎ目が消える。
    vec3 col = mix(uFloor, uHorizon, smoothstep(0.06, 1.0, d));
    col = mix(col, uGround, smoothstep(0.86, 1.0, d) * 0.12);

    // 接地の楕円。落とし影ではなく「そこに立っている」ことの印。
    float occ = 0.0;
    for (int i = 0; i < 3; i++) {
      float rx = (vPos.x - uFeet[i]) / uFootR[i];
      float rz = (vPos.z - 0.16) / (uFootR[i] * 0.5);
      float r = sqrt(rx * rx + rz * rz);
      occ += (1.0 - smoothstep(0.18, 1.0, r));
    }
    col *= 1.0 - clamp(occ, 0.0, 1.0) * uShadow;

    float g = fract(sin(dot(vPos.xz * 31.0 + uSeed, vec2(12.9898, 78.233))) * 43758.5453);
    col += (g - 0.5) * 0.006;
    gl_FragColor = vec4(col, 1.0);
  }
`

export default function Scene({ actPos }) {
  const { camera } = useThree()
  const figures = useMemo(() => buildFigures(), [])
  const groupRefs = [useRef(), useRef(), useRef()]
  const spinRef = useRef([0, 0, 0])

  const mats = useMemo(
    () =>
      figures.map((f) => {
        f.uniforms.uRadius.value = f.radius
        f.uniforms.uBands.value = f.bands
        return new THREE.ShaderMaterial({
          vertexShader: FIGURE_SHADER.VERT,
          fragmentShader: FIGURE_SHADER.FRAG,
          uniforms: f.uniforms,
          side: THREE.DoubleSide,
        })
      }),
    [figures]
  )

  const cyc = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: CYC_VERT,
        fragmentShader: CYC_FRAG,
        uniforms: {
          uGround: { value: new THREE.Color(ACTS[0].ground) },
          uHorizon: { value: new THREE.Color(ACTS[0].horizon) },
          uSeed: { value: 3.7 },
        },
        depthWrite: false,
      }),
    []
  )

  const floor = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: FLOOR_VERT,
        fragmentShader: FLOOR_FRAG,
        uniforms: {
          uFloor: { value: new THREE.Color(ACTS[0].floor) },
          uHorizon: { value: new THREE.Color(ACTS[0].horizon) },
          uGround: { value: new THREE.Color(ACTS[0].ground) },
          uFeet: { value: new THREE.Vector3(...figures.map((f) => f.x)) },
          uFootR: { value: new THREE.Vector3(1.16, 0.7, 0.95) },
          uShadow: { value: ACTS[0].shadow },
          uSeed: { value: 11.2 },
        },
      }),
    [figures]
  )

  // 幕をまたぐ色は、幕の重みではなく位置で直接補間する（3色の三角形の上を歩く）
  const tmp = useMemo(
    () => ({
      w: new THREE.Vector3(),
      a: new THREE.Color(),
      b: new THREE.Color(),
      cols: ACTS.map((a) => ({
        ground: new THREE.Color(a.ground),
        floor: new THREE.Color(a.floor),
        horizon: new THREE.Color(a.horizon),
        tint: new THREE.Color(a.tint),
        key: new THREE.Color(a.key),
        fill: new THREE.Color(a.fill),
      })),
    }),
    []
  )

  function lerpAct(key, pos, out) {
    const i = Math.min(ACTS.length - 2, Math.max(0, Math.floor(pos)))
    const u = Math.min(1, Math.max(0, pos - i))
    const e = u * u * (3 - 2 * u)
    return out.copy(tmp.cols[i][key]).lerp(tmp.cols[i + 1][key], e)
  }

  useFrame((state, dt) => {
    const pos = actPos.current
    const t = state.clock.elapsedTime
    const step = Math.min(0.05, dt)

    actWeights(pos, tmp.w)
    const spin = mixScalar(pos, ACTS.map((a) => a.spin))
    const breath = mixScalar(pos, ACTS.map((a) => a.breath))

    lerpAct('ground', pos, tmp.a)
    cyc.uniforms.uGround.value.copy(tmp.a)
    floor.uniforms.uGround.value.copy(tmp.a)
    lerpAct('horizon', pos, tmp.a)
    cyc.uniforms.uHorizon.value.copy(tmp.a)
    floor.uniforms.uHorizon.value.copy(tmp.a)
    lerpAct('floor', pos, tmp.a)
    floor.uniforms.uFloor.value.copy(tmp.a)
    floor.uniforms.uShadow.value = mixScalar(pos, ACTS.map((a) => a.shadow))

    figures.forEach((f, i) => {
      const u = f.uniforms
      u.uActW.value.copy(tmp.w)
      u.uHeight.value = mixScalar(pos, f.height)
      u.uBreath.value = breath
      u.uTime.value = t
      u.uCam.value.copy(camera.position)
      lerpAct('tint', pos, u.uTint.value)
      lerpAct('key', pos, u.uKey.value)
      lerpAct('fill', pos, u.uFill.value)
      u.uGloss.value = 0.42 + 0.5 * Math.min(1, pos / 2)

      // 各体は自分の速度で回る。第1幕は三者三様、第3幕でほぼ止まる。
      const rate = spin * (0.55 + 0.35 * i) * (i === 1 ? -1 : 1)
      spinRef.current[i] += rate * step
      const g = groupRefs[i].current
      if (g) {
        g.rotation.y = spinRef.current[i]
        // 傾きは幕が進むほど正される（諧謔 → 荘重）
        g.rotation.z = THREE.MathUtils.degToRad(f.lean) * (1 - Math.min(1, pos / 2) * 0.82)
      }
    })
  })

  return (
    <group>
      <mesh material={cyc} position={[0, 14, -30]}>
        <planeGeometry args={[190, 76]} />
      </mesh>
      <mesh material={floor} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -14]}>
        <planeGeometry args={[190, 76]} />
      </mesh>
      {figures.map((f, i) => (
        <group key={f.id} ref={groupRefs[i]} position={[f.x, -0.025, 0]}>
          <mesh geometry={f.geometry} material={mats[i]} frustumCulled={false} />
        </group>
      ))}
    </group>
  )
}
