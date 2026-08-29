import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { makeSkyBand, makeGlyphField, VERT, FRAG, scroll } from './rig.js'

// 面は1枚。光源は0個。環境は256×1。
// 「金属」を作っているものが本当に1本の帯だけであることを、
// 部品の数で示せる状態にしておきたかった。
const SEG_X = 220
const SEG_Y = 140
const W = 7.6
const H = 3.2

// 空をどの高さで切るか（uHorizon）と地紋の強さ（uGlyphAmp）は、実描画を撮らないと
// 決められない類の数字なので、URL から差し替えられるようにしてある。
// 既定値がそのまま今日の値。
const q = new URLSearchParams(typeof location !== 'undefined' ? location.search : '')
const num = (k, d) => (q.has(k) ? Number(q.get(k)) : d)

export default function Scene() {
  const mat = useRef()
  const sheet = useRef()
  const { size } = useThree()

  const uniforms = useMemo(
    () => ({
      uBand: { value: makeSkyBand(256) },
      uGlyph: { value: makeGlyphField(1024, 512) },
      uTime: { value: 0 },
      uScroll: { value: 0 },
      uAmp: { value: 1.0 },
      uGlyphAmp: { value: num('g', 0.014) },
      uRough: { value: num('r', 0.0035) },
      uBandShift: { value: 0 },
      uHorizon: { value: num('h', -0.26) },
      uTint: { value: new THREE.Color('#ffeee6') },
      uRes: { value: new THREE.Vector2(1, 1) },
      uNrm: { value: new THREE.Matrix3() },
    }),
    []
  )

  useFrame((state, dt) => {
    const u = mat.current?.uniforms
    if (!u) return
    if (sheet.current) u.uNrm.value.getNormalMatrix(sheet.current.matrixWorld)
    u.uTime.value = state.clock.elapsedTime
    u.uRes.value.set(size.width, size.height)

    // スクロールは追従を1段遅らせる。帯の掃きは指で押した所より少し遅れて来る
    scroll.value += (scroll.target - scroll.value) * Math.min(1, dt * 3.4)
    u.uScroll.value = scroll.value

    // スクロールで空そのものを回す。面は動いていない——見えている空のほうが動く
    u.uBandShift.value = -0.085 * scroll.value
  })

  return (
    <mesh ref={sheet} position={[0, -0.25, 0]} rotation={[-0.34, 0, 0]}>
      <planeGeometry args={[W, H, SEG_X, SEG_Y]} />
      <shaderMaterial
        ref={mat}
        vertexShader={VERT}
        fragmentShader={FRAG}
        uniforms={uniforms}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}
