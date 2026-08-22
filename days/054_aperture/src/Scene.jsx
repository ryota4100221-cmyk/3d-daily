import React, { useMemo, useRef, useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import {
  RIG,
  PERIOD,
  buildApertureGeometry,
  buildApertureMaterial,
  setOpaque,
} from './rig.js'

// カメラは原点に置いたまま動かさない。動くのは開口の側（u が減る）。
// 「前進」を開口の移動として書くと、蛇行も くびれ も トンネル座標 u だけの
// 関数で済み、カメラの姿勢に一切の状態を持たせずに済む。
export default function Scene({ gainIdx, opaque, u0 }) {
  const { camera } = useThree()
  const geo = useMemo(() => buildApertureGeometry(), [])
  const mat = useMemo(() => buildApertureMaterial(RIG.gains[gainIdx]), [])
  const look = useRef({ x: 0, y: 0, tx: 0, ty: 0 })
  const t0 = useRef(u0 / RIG.speed)

  useEffect(() => {
    mat.uniforms.uGain.value = RIG.gains[gainIdx]
  }, [gainIdx, mat])

  useEffect(() => {
    setOpaque(mat, opaque)
  }, [opaque, mat])

  useEffect(() => {
    const onMove = (e) => {
      look.current.tx = (e.clientY / window.innerHeight - 0.5) * 0.20
      look.current.ty = -(e.clientX / window.innerWidth - 0.5) * 0.26
    }
    window.addEventListener('pointermove', onMove)
    return () => window.removeEventListener('pointermove', onMove)
  }, [])

  useEffect(() => () => { geo.dispose(); mat.dispose() }, [geo, mat])

  useFrame((state, dt) => {
    const t = t0.current + state.clock.elapsedTime
    mat.uniforms.uTime.value = t
    // 首を振るだけ。位置は原点から動かさない（管の中に居ることが崩れる）
    const k = 1 - Math.exp(-Math.min(dt, 0.05) * 6)
    look.current.x += (look.current.tx - look.current.x) * k
    look.current.y += (look.current.ty - look.current.y) * k
    camera.rotation.set(look.current.x, look.current.y, 0, 'YXZ')
  })

  return (
    <mesh geometry={geo} material={mat} frustumCulled={false} renderOrder={1} />
  )
}

export { PERIOD }
export const AXIS_FOG = new THREE.Color(0x000000)
