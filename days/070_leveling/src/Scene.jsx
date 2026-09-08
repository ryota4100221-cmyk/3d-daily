// Scene.jsx — Day 070
//
// 画面に出るのは黒い鏡面板と、そこに映り込んだ縞板（ライトボックス）だけ。
// 板の高さは一切見えない——稜線の高さは 0.22〜7.1µm、板は 260mm なので、
// 幾何として出したところで1画素も動かない。見えているのは**傾き**で、
// 傾きを可視化しているのは光ではなく**映り込み**のほう。
// （現場で塗膜のうねりを見るときにやっているのと同じことをしている）
//
// ライトオブジェクトは0個。反射方向を縞板の平面と交差させて縞を読むだけ。
import React, { useMemo, useRef, useLayoutEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { SPECIMENS, PANEL, GAP, MODES, slopesAt } from './rig.js'

// 縞板（ライトボックス）。カメラの後ろ 5m に立てた、横縞の板。
export const BOARD = { z: 8.0, period: 0.115, duty: 0.36, phase: 0.0 }
export const RIG = {
  dist: 3.05, // カメラから見本板の面までの距離
  tiltX: -0.14, // ラックを 8° 後ろへ倒す
}
// 板は全部同じ平面に置く（弧に並べて1枚ずつカメラへ向けると、映り込んだ縞が
// 板ごとに傾いてしまい、「曲がっているのは勾配のせい」という読みが壊れる）。
// 正投影にすれば入射角まで揃うが、平らな鏡を平行光線で見ると板の全面が
// 縞板の1点だけを映して真っ平らな一色になる——縞が要るので透視のまま。
// カメラは固定。目盛りの位置はこの値から直接投影して出す（描画ループに依らせない）。
export const CAM = { fov: 24, pos: [0, 0.03, 3.05], look: [0, 0, 0] }

const VERT = /* glsl */ `
  varying vec2 vLocal;
  varying vec3 vWPos;
  varying vec3 vN;
  varying vec3 vTx;
  varying vec3 vTy;
  void main() {
    vLocal = position.xy;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWPos = wp.xyz;
    mat3 nm = mat3(modelMatrix);
    vN  = normalize(nm * vec3(0.0, 0.0, 1.0));
    vTx = normalize(nm * vec3(1.0, 0.0, 0.0));
    vTy = normalize(nm * vec3(0.0, 1.0, 0.0));
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`

const FRAG = /* glsl */ `
  precision highp float;
  uniform vec2  uK[${MODES}];   // 波数ベクトル（rad/m）
  uniform float uA[${MODES}];   // 振幅（m）— 時間に依るのはここだけ
  uniform float uP[${MODES}];   // 位相
  uniform float uBoardZ;
  uniform float uPeriod;
  uniform float uDuty;
  uniform float uPhase;
  varying vec2 vLocal;
  varying vec3 vWPos;
  varying vec3 vN;
  varying vec3 vTx;
  varying vec3 vTy;

  void main() {
    // 1画素が板の上で覆う長さ。これより細い稜線はカメラ側が積分してしまうので
    // 傾きとしては効かない（実際の目にも写真にも出ない）。エイリアスよけではなく
    // 「見えないものは足さない」ための項。
    float fp = max(fwidth(vLocal.x), fwidth(vLocal.y)) * 1.25 + 1e-7;

    float dhdx = 0.0;
    float dhdy = 0.0;
    for (int m = 0; m < ${MODES}; m++) {
      vec2 k = uK[m];
      float km = length(k);
      float fade = 1.0 - smoothstep(1.0, 2.8, km * fp);
      float d = -uA[m] * sin(dot(k, vLocal) + uP[m]) * fade;
      dhdx += d * k.x;
      dhdy += d * k.y;
    }

    vec3 N = normalize(vN - dhdx * vTx - dhdy * vTy);
    vec3 V = normalize(vWPos - cameraPosition);
    vec3 R = reflect(V, N);

    float lum = 0.0;
    if (R.z > 1e-4) {
      float tH = (uBoardZ - vWPos.z) / R.z;
      vec3 hit = vWPos + tH * R;
      if (abs(hit.x) < 4.2 && hit.y > -2.0 && hit.y < 5.0) {
        float f = (hit.y + uPhase) / uPeriod;
        float w = fwidth(f) * 0.8 + 2e-4;
        float ff = fract(f);
        // 幅 uDuty の明るい帯。縞板は「白地に黒」ではなく「暗い天井に細い灯」。
        lum = smoothstep(-w, w, ff) - smoothstep(uDuty - w, uDuty + w, ff);
      }
    }

    float fres = pow(1.0 - abs(dot(N, -V)), 5.0);
    vec3 col = vec3(0.0050) + lum * (0.90 + 0.10 * fres) * vec3(0.86, 0.86, 0.86);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`

function Specimen({ spec, t, x, y }) {
  const mat = useRef()

  const uniforms = useMemo(() => {
    const u = {
      uK: { value: spec.modes.map((m) => new THREE.Vector2(m.kx, m.ky)) },
      uA: { value: new Float32Array(MODES) },
      uP: { value: Float32Array.from(spec.modes.map((m) => m.ph)) },
      uBoardZ: { value: BOARD.z },
      uPeriod: { value: BOARD.period },
      uDuty: { value: BOARD.duty },
      uPhase: { value: BOARD.phase },
    }
    return u
  }, [spec])

  // 振幅だけが時間に依る。位相も波数も一度も動かさない——
  // レベリングはモードを混ぜないし、動かしもしない。落とすだけ。
  useLayoutEffect(() => {
    const sl = slopesAt(spec.modes, t)
    spec.modes.forEach((m, i) => (uniforms.uA.value[i] = sl[i] / m.k))
    if (mat.current) mat.current.uniformsNeedUpdate = true
  }, [t, spec, uniforms])

  return (
    <mesh position={[x, y, 0]} rotation={[RIG.tiltX, 0, 0]}>
      <planeGeometry args={[PANEL.w, PANEL.h, 1, 1]} />
      <shaderMaterial
        ref={mat}
        vertexShader={VERT}
        fragmentShader={FRAG}
        uniforms={uniforms}
      />
    </mesh>
  )
}

export default function Scene({ t, still }) {
  const group = useRef()

  const cols = SPECIMENS.length
  const pitch = PANEL.w + GAP.x
  const rowY = [(PANEL.h + GAP.y) / 2, -(PANEL.h + GAP.y) / 2]

  // 検査員が板を少しだけ傾ける動き。縞が板の上をゆっくり滑る。
  // still=1 のときは位相0で止める（プレビューを rAF の回数に依存させない）。
  useFrame(({ clock }) => {
    if (group.current) {
      group.current.rotation.x = still ? 0 : 0.0044 * Math.sin(clock.elapsedTime * 0.31)
    }
  })

  return (
    <group ref={group}>
      {rowY.map((y, r) =>
        SPECIMENS.map((spec, c) => (
          <Specimen
            key={`${r}-${c}`}
            spec={spec}
            t={r === 0 ? t : t * 16}
            x={(c - (cols - 1) / 2) * pitch}
            y={y}
          />
        ))
      )}
    </group>
  )
}
