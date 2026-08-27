import React, { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import {
  TRACES,
  SAMPLES,
  COUNT,
  SPAN_X,
  makeTable,
  fillTable,
  traceIndex,
  ruleGeometry,
  dayPhase,
  crossingX,
  VERT,
  FRAG_POINTS,
  FRAG_LINES,
} from './rig.js'

const COLD = new THREE.Color('#2f6bff') // データ側 = 正投影
const WARM = new THREE.Color('#de2525') // スポーツ側 = 透視投影

// 正投影カメラは three のシーンには入れない。行列を1本作るためだけに存在する。
// 「測る目」は動かない。動くのは見る目のほうだけ、という役割分担をここで固定する。
function makeOrthoCamera() {
  const c = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 40)
  c.position.set(0, 0, 8)
  return c
}

export default function Scene({ onStats }) {
  const { size, camera } = useThree()

  const table = useMemo(() => makeTable(), [])
  const ortho = useMemo(() => makeOrthoCamera(), [])
  const rules = useMemo(() => ruleGeometry(), [])

  // 点と線が共有する1本のバッファ。線側は index を持つだけで頂点を複製しない。
  const { geoPoints, geoLines, posAttr, geoRules } = useMemo(() => {
    const pos = new THREE.BufferAttribute(table.pos, 3)
    pos.setUsage(THREE.DynamicDrawUsage)
    const val = new THREE.BufferAttribute(table.val, 1)
    val.setUsage(THREE.DynamicDrawUsage)

    const gp = new THREE.BufferGeometry()
    gp.setAttribute('position', pos)
    gp.setAttribute('aVal', val)
    gp.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 6)

    const gl = new THREE.BufferGeometry()
    gl.setAttribute('position', pos)
    gl.setAttribute('aVal', val)
    gl.setIndex(new THREE.BufferAttribute(traceIndex(), 1))
    gl.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 6)

    const gr = new THREE.BufferGeometry()
    gr.setAttribute('position', new THREE.BufferAttribute(rules.pos, 3))
    gr.setAttribute('aVal', new THREE.BufferAttribute(rules.val, 1))
    gr.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 6)

    return { geoPoints: gp, geoLines: gl, posAttr: pos, geoRules: gr, valAttr: val }
  }, [table, rules])

  const uniforms = useMemo(
    () => ({
      uOrthoVP: { value: new THREE.Matrix4() },
      uCrossX: { value: 0 },
      uCrossK: { value: 0.80 },
      uSize: { value: 2.9 },
      uPix: { value: 1 },
      uOpacity: { value: 1 },
      uCold: { value: COLD.clone() },
      uWarm: { value: WARM.clone() },
    }),
    []
  )
  // 線と罫線は同じ uniform オブジェクトを共有する。1つの装置なので、
  // 交差の位置が3つのマテリアルでずれる余地を最初から作らない。
  const uLines = useMemo(
    () => ({ ...uniforms, uOpacity: { value: 0.52 } }),
    [uniforms]
  )
  const uRules = useMemo(
    () => ({ ...uniforms, uOpacity: { value: 0.22 } }),
    [uniforms]
  )

  const t0 = useRef(0)
  const stat = useRef({ ortho: 0, persp: 0 })

  useFrame(({ clock }, dt) => {
    const time = clock.getElapsedTime()
    t0.current += dt

    fillTable(table, time)
    posAttr.needsUpdate = true
    geoPoints.attributes.aVal.needsUpdate = true

    // 時刻 → 交差の位置。1日で画面を1回横断する。
    const phase = dayPhase()
    const cx = crossingX(phase)
    uniforms.uCrossX.value = cx

    // 測る目は固定。見る目だけが呼吸する。
    const drift = Math.sin(time * 0.19) * 0.055
    camera.position.set(0.92 + drift, 1.02 + Math.sin(time * 0.13) * 0.03, 4.95)
    camera.lookAt(0, 0.10, 0)
    camera.updateMatrixWorld()

    // 正投影の枠を透視投影の中心高さに合わせる。ここを合わせないと mix が
    // 「別の絵への乗り換え」になり、勾配ではなく段差が出る。
    const dist = camera.position.length()
    const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) * dist
    const halfW = halfH * (size.width / size.height)
    ortho.left = -halfW
    ortho.right = halfW
    ortho.top = halfH
    ortho.bottom = -halfH
    ortho.position.set(0, 0.10, 8)
    ortho.lookAt(0, 0.10, 0)
    ortho.updateProjectionMatrix()
    ortho.updateMatrixWorld()
    uniforms.uOrthoVP.value.multiplyMatrices(
      ortho.projectionMatrix,
      ortho.matrixWorldInverse
    )

    // 数字は絵と同じ表から引く。別々に計算した瞬間、数字は飾りになる。
    let nOrtho = 0
    const k = uniforms.uCrossK.value
    for (let i = 0; i < COUNT; i++) {
      const x = table.pos[i * 3]
      if (x < cx - k) nOrtho++
      else if (x < cx + k) {
        const w = (x - (cx - k)) / (2 * k)
        if (w < 0.5) nOrtho++
      }
    }
    stat.current.ortho = nOrtho
    stat.current.persp = COUNT - nOrtho

    if (onStats) {
      onStats({
        phase,
        crossX: cx,
        ortho: nOrtho,
        persp: COUNT - nOrtho,
        mean: table.mean,
        peak: table.peak,
      })
    }
  })

  uniforms.uPix.value = Math.min(2, window.devicePixelRatio || 1)

  return (
    <group>
      <lineSegments geometry={geoRules} frustumCulled={false}>
        <shaderMaterial
          vertexShader={VERT}
          fragmentShader={FRAG_LINES}
          uniforms={uRules}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </lineSegments>

      <lineSegments geometry={geoLines} frustumCulled={false}>
        <shaderMaterial
          vertexShader={VERT}
          fragmentShader={FRAG_LINES}
          uniforms={uLines}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </lineSegments>

      <points geometry={geoPoints} frustumCulled={false}>
        <shaderMaterial
          vertexShader={VERT}
          fragmentShader={FRAG_POINTS}
          uniforms={uniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
    </group>
  )
}

export { TRACES, SAMPLES, COUNT, SPAN_X }
