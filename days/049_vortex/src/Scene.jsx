import { useMemo, useRef, useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { createVortexRig, coreRing, GROUND, PARAMS } from './rig.js'

// 渦を1つだけ置く。地は色を持たない（再現元と同じ約束）。
// 尾 = LineSegments（毎フレーム引き直す）／頭 = Points／芯 = 輪 + 軸の細線。

const COUNT = 3000
const TRAIL = 26

export default function Scene({ rc = 0.62, paused = false }) {
  const gl = useThree((s) => s.gl)
  const rig = useMemo(() => {
    const r = createVortexRig({ count: COUNT, trail: TRAIL })
    r.warm(13, rc) // 初見も撮影も、育った渦から始める
    return r
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const lineGeo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(rig.linePos, 3).setUsage(THREE.DynamicDrawUsage))
    g.setAttribute('color', new THREE.BufferAttribute(rig.lineCol, 3).setUsage(THREE.DynamicDrawUsage))
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.5, 0), 8)
    return g
  }, [rig])

  const headGeo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(rig.headPos, 3).setUsage(THREE.DynamicDrawUsage))
    g.setAttribute('color', new THREE.BufferAttribute(rig.headCol, 3).setUsage(THREE.DynamicDrawUsage))
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.5, 0), 8)
    return g
  }, [rig])

  // 芯半径の輪。rc を変えると、尾がいちばん伸びる輪がこの円に一致する。
  const ringGeo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(coreRing(rc), 3))
    return g
  }, [rc])

  // 芯の印。俯瞰なので軸の縦線は画面を縦断するだけで読めない。面内の十字にする。
  const spineGeo = useMemo(() => {
    const a = new Float32Array([-0.17, 0, 0, 0.17, 0, 0, 0, 0, -0.17, 0, 0, 0.17])
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(a, 3))
    return g
  }, [])

  const core = useRef(new THREE.Group())
  const rigRef = useRef(new THREE.Group())

  useEffect(() => {
    gl.setClearColor(new THREE.Color(GROUND[0], GROUND[1], GROUND[2]), 1)
  }, [gl])

  useFrame((state, dt) => {
    if (!paused) {
      const c = rig.step(dt, { rc, pointer: [state.pointer.x, state.pointer.y] })
      core.current.position.set(c.x, 0, c.z)
      lineGeo.attributes.position.needsUpdate = true
      lineGeo.attributes.color.needsUpdate = true
      headGeo.attributes.position.needsUpdate = true
      headGeo.attributes.color.needsUpdate = true
    }
    // 視差だけ。渦の回転はポインタに触らせない（触ると装置が読めなくなる）
    const px = state.pointer.x * 0.22
    const py = state.pointer.y * 0.14
    rigRef.current.rotation.y += (px * 0.35 - rigRef.current.rotation.y) * 0.05
    state.camera.position.x += (px * 0.6 - state.camera.position.x) * 0.04
    state.camera.position.y += (6.1 + py * 0.7 - state.camera.position.y) * 0.04
    state.camera.lookAt(0.55, 0.0, 0.15)
  })

  return (
    <group position={[0.62, 0, 0]} scale={0.72} ref={rigRef}>
      <group ref={core}>
        {/* rc の輪と芯の十字は、渦の下に埋もれると本文が指すものが画面に無くなる。
            深度を切って最後に描く。 */}
        <lineLoop geometry={ringGeo} renderOrder={3}>
          <lineBasicMaterial color="#8d948d" transparent opacity={0.8} depthTest={false} />
        </lineLoop>
        <lineSegments geometry={spineGeo} renderOrder={3}>
          <lineBasicMaterial color="#8d948d" transparent opacity={0.8} depthTest={false} />
        </lineSegments>
      </group>

      <lineSegments geometry={lineGeo} frustumCulled={false}>
        <lineBasicMaterial vertexColors transparent opacity={0.92} depthWrite={false} />
      </lineSegments>

      <points geometry={headGeo} frustumCulled={false}>
        <pointsMaterial
          vertexColors
          size={3.0}
          sizeAttenuation={false}
          transparent
          opacity={0.92}
          depthWrite={false}
        />
      </points>
    </group>
  )
}

export { PARAMS }
