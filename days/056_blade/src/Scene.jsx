// Scene.jsx — Day 056 / Blade Phase
//
// 置くものは2つしかない。地（方向で塗る球）と、268枚の羽根を1本に畳んだ帯。
// ライトオブジェクトは1つも置かない（陰影は羽根の shader が2方向で作る）。

import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import {
  PAL,
  RING,
  buildBladeField,
  seamAngle,
  BLADE_VERT,
  BLADE_FRAG,
  SKY_VERT,
  SKY_FRAG,
} from './rig.js'

const C = (hex) => new THREE.Color(hex).convertSRGBToLinear()

function Ground() {
  const uniforms = useMemo(
    () => ({
      uDeep: { value: C(PAL.deep) },
      uGround: { value: C(PAL.ground) },
      uGlow: { value: C(PAL.glow) },
      uRes: { value: new THREE.Vector2(1, 1) },
    }),
    []
  )
  const { size, viewport } = useThree()
  uniforms.uRes.value.set(size.width * viewport.dpr, size.height * viewport.dpr)
  return (
    <mesh frustumCulled={false} renderOrder={-1}>
      <sphereGeometry args={[38, 48, 32]} />
      <shaderMaterial
        vertexShader={SKY_VERT}
        fragmentShader={SKY_FRAG}
        uniforms={uniforms}
        side={THREE.BackSide}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  )
}

function Blades({ onSeam }) {
  const mat = useRef()
  const group = useRef()
  const { camera } = useThree()

  const geometry = useMemo(() => buildBladeField(RING), [])

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uSeam: { value: 0 },
      uBand: { value: 0.56 },
      uRadius: { value: RING.radius },
      uLength: { value: RING.length },
      uWidth: { value: RING.width },
      uPsi: { value: 0.78 },
      uPsiAmp: { value: 0.12 },
      uBend: { value: 1.95 },
      uBendAmp: { value: 0.18 },
      uTwist: { value: 0.80 },
      uViolet: { value: C(PAL.violet) },
      uMagenta: { value: C(PAL.magenta) },
      uLime: { value: C(PAL.lime) },
      uGround: { value: C(PAL.ground) },
      uDeep: { value: C(PAL.deep) },
      uCamPos: { value: new THREE.Vector3() },
    }),
    []
  )

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime()
    const u = mat.current?.uniforms
    if (!u) return
    const seam = seamAngle(t)
    u.uTime.value = t
    u.uSeam.value = seam
    u.uCamPos.value.copy(camera.position)
    if (group.current) {
      // 環そのものはほとんど回さない。回すと「動いているのは環」に見えてしまう。
      // 動いているのは位相の継ぎ目のほうだと読ませたいので、こちらは 1/6 の速さ。
      group.current.rotation.y = -seam / 6
    }
    onSeam?.(seam)
  })

  return (
    <group ref={group} rotation={[0.10, 0, 0.15]} position={[0, -0.10, 0]}>
      <mesh geometry={geometry} frustumCulled={false}>
        <shaderMaterial
          ref={mat}
          vertexShader={BLADE_VERT}
          fragmentShader={BLADE_FRAG}
          uniforms={uniforms}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>
    </group>
  )
}

export default function Scene({ onSeam }) {
  const { camera } = useThree()
  useMemo(() => {
    // 広角。手前の弧を大きく、奥の弧を小さくするのが今日の構図
    camera.fov = 58
    camera.position.set(0.06, 1.86, 4.28)
    camera.lookAt(0, 0.06, 0)
    camera.updateProjectionMatrix()
  }, [camera])

  return (
    <>
      <Ground />
      <Blades onSeam={onSeam} />
    </>
  )
}
