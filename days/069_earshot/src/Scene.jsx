import React, { useLayoutEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { buildPopulation, buildEdges, buildMarks, buildStems, simulate, rFromT } from './rig.js'

// honeyeater.org の実測色（アクセント #002828 16.6% ／ #F8D080 7.3%）から。
// THREE.Color は hex を sRGB として受けて作業色空間（線形）へ変換するので、
// ここで作った三つ組はそのまま ShaderMaterial に渡してよい。
const hex = (h) => {
  const c = new THREE.Color(h)
  return [c.r, c.g, c.b]
}
const PALETTE = {
  norm: hex('#f8d080'), // 地域の規範を歌う
  drift: hex('#6f8b86'), // 規範から外れた歌
  lost: hex('#c8d3cd'), // 自種の歌を1つも歌えない
  carry: hex('#493c22'), // 規範どうしを結ぶ辺＝歌の通り道
  wire: hex('#24504b'), // ただ聞こえているだけの辺
}
export const GROUND = '#061a19'

// ── 地 ──────────────────────────────────────────────────────────────────
// 縁を作らない。円盤の外周を地の色そのものへ落として、場の終わりを見せない。
const groundVert = /* glsl */ `
  varying vec2 vXz;
  void main() {
    vXz = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const groundFrag = /* glsl */ `
  uniform vec3 uCore;
  uniform vec3 uEdge;
  varying vec2 vXz;
  void main() {
    float d = length(vXz) / 52.0;
    float k = 1.0 - smoothstep(0.05, 1.05, d);
    vec3 c = mix(uEdge, uCore, k);
    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }
`

// ── 聞こえる辺 ──────────────────────────────────────────────────────────
// 加算合成。辺が濃く重なる所ほど明るくなる＝そこが歌の通っている場所。
// 脈は装飾で、状態は1つも持たない（フレーム数に依存する量を作らない）。
const edgeVert = /* glsl */ `
  attribute float aT;
  attribute float aSeed;
  varying vec3 vCol;
  varying float vT;
  varying float vSeed;
  void main() {
    vCol = color;
    vT = aT;
    vSeed = aSeed;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const edgeFrag = /* glsl */ `
  uniform float uTime;
  varying vec3 vCol;
  varying float vT;
  varying float vSeed;
  void main() {
    float pulse = 0.74 + 0.26 * sin(6.2831853 * (vT * 0.5 - uTime * 0.09 + vSeed));
    gl_FragColor = vec4(vCol * pulse, 1.0);
    #include <colorspace_fragment>
  }
`

// R3F は初期化時にカメラを原点へ向け直すことがあるので、注視点はここで固定する。
function Aim() {
  const camera = useThree((s) => s.camera)
  useLayoutEffect(() => {
    // 場を画面の右へ寄せる。左下は巨大な数字（再現元の表示級数の数字）に空ける。
    camera.lookAt(-2.5, 0.6, -1.5)
    camera.updateProjectionMatrix()
  }, [camera])
  return null
}

function Field({ t }) {
  const pop = useMemo(() => buildPopulation(), [])
  // r は 0.1 刻みに丸める。スクロール1pxごとに 240 ステップ回す必要はないし、
  // 丸めておけば同じスクロール位置がいつでも同じ絵になる。
  const r = useMemo(() => Math.round(rFromT(t) * 10) / 10, [t])
  const sim = useMemo(() => simulate(pop, r), [pop, r])

  const marks = useMemo(() => buildMarks(pop, sim, PALETTE), [pop, sim])
  const edges = useMemo(() => buildEdges(pop, sim, PALETTE), [pop, sim])

  const markGeo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(marks.positions, 3))
    g.setAttribute('color', new THREE.BufferAttribute(marks.colors, 3))
    return g
  }, [marks])

  const edgeGeo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(edges.positions, 3))
    g.setAttribute('color', new THREE.BufferAttribute(edges.colors, 3))
    g.setAttribute('aT', new THREE.BufferAttribute(edges.aT, 1))
    g.setAttribute('aSeed', new THREE.BufferAttribute(edges.aSeed, 1))
    return g
  }, [edges])

  const stemGeo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(buildStems(pop), 3))
    return g
  }, [pop])

  const edgeMat = useRef()
  useFrame((state) => {
    if (edgeMat.current) edgeMat.current.uniforms.uTime.value = state.clock.elapsedTime
  })

  return (
    <group position={[0, 0, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
        <circleGeometry args={[110, 96]} />
        <shaderMaterial
          vertexShader={groundVert}
          fragmentShader={groundFrag}
          uniforms={{
            uCore: { value: new THREE.Color('#123330') },
            uEdge: { value: new THREE.Color(GROUND) },
          }}
        />
      </mesh>

      <lineSegments geometry={stemGeo}>
        <lineBasicMaterial color="#12332f" transparent opacity={0.85} depthWrite={false} />
      </lineSegments>

      <lineSegments geometry={edgeGeo}>
        <shaderMaterial
          ref={edgeMat}
          vertexShader={edgeVert}
          fragmentShader={edgeFrag}
          uniforms={{ uTime: { value: 0 } }}
          vertexColors
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </lineSegments>

      <mesh geometry={markGeo}>
        <meshBasicMaterial vertexColors side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

export default function Scene({ t }) {
  return (
    <Canvas
      dpr={[1, 2]}
      gl={{ alpha: true, antialias: true }}
      camera={{ fov: 30, near: 1, far: 400, position: [26, 66, 58] }}
    >
      <Aim />
      <Field t={t} />
    </Canvas>
  )
}
