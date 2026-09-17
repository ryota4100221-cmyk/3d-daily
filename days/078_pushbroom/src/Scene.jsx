import React, { useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { CONST, VEHICLES, FRAG, VERT, makeState, step } from './rig.js'

// 帯（センサが吐いている画像そのもの）の置き場所。画面の右側に1枚だけ置いて、
// 左は全部余白にする。文字は帯に重ねない——重ねた瞬間に「UIの背景」になって、
// これが1枚の観測画像であることが読めなくなる。
export const RECT_WIDE = [0.455, 0.075, 0.945, 0.925] // x0,y0,x1,y1（y は上向き）
export const RECT_NARROW = [0.08, 0.05, 0.92, 0.56]

function Strip({ ctl, onTick }) {
  const { size } = useThree()
  const st = useRef(null)
  if (!st.current) {
    st.current = makeState()
    // 0秒の画面が「まだ何も映っていない」になるのを避ける。線走査は蓄積装置では
    // ないので絵は1フレームで完成するが、地形の原点にいると尾根が出ない。
    st.current.t = 41.3
    st.current.s = CONST.GS_MS * 41.3
  }
  const lastReport = useRef(0)

  const uniforms = useMemo(
    () => ({
      uRes: { value: new THREE.Vector2(1, 1) },
      uT: { value: 0 },
      uS: { value: 0 },
      uGS: { value: CONST.GS_MS },
      uAlt: { value: CONST.ALT_M },
      uHalfFov: { value: (CONST.FOV_DEG * Math.PI) / 360 },
      uSpan: { value: CONST.SPAN_S },
      uVeh: { value: VEHICLES.map(() => new THREE.Vector4()) },
      uVeh2: { value: VEHICLES.map((v) => new THREE.Vector4(v.lane, v.temp, 0, 0)) },
      uRect: { value: new THREE.Vector4(...RECT_WIDE) },
    }),
    []
  )

  useFrame((state, delta) => {
    const dt = Math.min(delta, 1 / 20)
    const s = st.current
    s.gs = ctl.current.gs
    step(s, dt)

    const u = uniforms
    u.uRes.value.set(size.width, size.height)
    u.uT.value = s.t
    u.uS.value = s.s
    u.uGS.value = s.gs
    const rect = size.width < 900 ? RECT_NARROW : RECT_WIDE
    u.uRect.value.set(rect[0], rect[1], rect[2], rect[3])
    for (let i = 0; i < VEHICLES.length; i++) {
      const v = VEHICLES[i]
      u.uVeh.value[i].set(s.o[i], v.v, v.len, v.wid)
    }

    const now = state.clock.elapsedTime
    if (now - lastReport.current > 0.12) {
      lastReport.current = now
      onTick(s.gs)
    }
  })

  return (
    <mesh frustumCulled={false}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        vertexShader={VERT}
        fragmentShader={FRAG}
        uniforms={uniforms}
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
  )
}

export default function Scene({ ctl, onTick }) {
  return (
    <Canvas
      dpr={1}
      flat
      gl={{ antialias: false, preserveDrawingBuffer: true }}
      camera={{ position: [0, 0, 1] }}
    >
      <Strip ctl={ctl} onTick={onTick} />
    </Canvas>
  )
}
