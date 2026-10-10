import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { H, W, SIPHON } from './rig.js'

// 粒の色。砂色はサイトの #D8B088（実測アクセント）、取水線の青は #0858B8。
const SAND = '#D8B088'
const SILT = '#8E959C'
const CLAY = '#F3F1EB'
const BLUE = '#2C7BE0' // #0858B8 は黒地では沈むので、線だけ1段明るく

const vert = /* glsl */ `
  attribute float aY0;
  attribute float aW;
  attribute float aSlot;
  attribute float aD;
  attribute float aKind;
  uniform float uT;
  uniform float uPx;
  varying float vKind;
  varying float vBed;
  varying float vD;
  void main() {
    float arrive = aY0 / aW;
    float bed = step(arrive, uT);
    // 浮いている間は y0 − w t、床に着いたら自分の段（着いた順）に座る。
    float y = mix(aY0 - aW * uT, aSlot, bed);
    vec3 p = vec3(position.x, y, position.z);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    // 実寸では 400 µm でも 1 px に満たないので、大きさは log d で見せる
    float s = clamp((log(aD) - log(0.4)) / (log(400.0) - log(0.4)), 0.0, 1.0);
    // 浮いている粘土は1粒ずつではなく「乳白の濁り」として見える：大きく薄い点
    float haze = (1.0 - bed) * step(1.5, aKind);
    gl_PointSize = uPx * mix(1.3 + 2.6 * s * s, 5.0, haze);
    vKind = aKind;
    vBed = bed;
    vD = s;
  }
`
const frag = /* glsl */ `
  uniform vec3 uSand;
  uniform vec3 uSilt;
  uniform vec3 uClay;
  varying float vKind;
  varying float vBed;
  varying float vD;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c);
    if (r > 0.5) discard;
    // 色は種類ではなく粒径の連続な関数：細かいほど白（粘土）、粗いほど砂色。
    // こうすると「上の水が白くなっていく」こと自体が選り分けの読み値になる。
    float s = vD;
    vec3 col = s < 0.33 ? mix(uClay, uSilt, smoothstep(0.2, 0.33, s)) : mix(uSilt, uSand, smoothstep(0.5, 0.72, s));
    // 浮いている細粒は薄く（濁りとして重なって見える）、床の粒は詰まって不透明
    float a;
    if (vBed > 0.5) a = 0.95;
    else if (vKind > 1.5) a = 0.075;           // 濁り
    else a = mix(0.55, 1.0, vD);               // シルトと砂は粒として
    a *= vKind > 1.5 && vBed < 0.5 ? smoothstep(0.5, 0.0, r) : smoothstep(0.5, 0.3, r);
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }
`

export default function Scene({ col, timeRef }) {
  const { size, camera } = useThree()
  const mat = useRef()

  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const pos = new Float32Array(col.N * 3)
    for (let i = 0; i < col.N; i++) {
      pos[i * 3] = col.x[i]
      pos[i * 3 + 2] = col.z[i]
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aY0', new THREE.BufferAttribute(col.y0, 1))
    g.setAttribute('aW', new THREE.BufferAttribute(col.w, 1))
    g.setAttribute('aSlot', new THREE.BufferAttribute(col.slot, 1))
    g.setAttribute('aD', new THREE.BufferAttribute(col.d, 1))
    g.setAttribute('aKind', new THREE.BufferAttribute(col.kind, 1))
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, H / 2, 0), 40)
    return g
  }, [col])

  const uniforms = useMemo(
    () => ({
      uT: { value: 0 },
      uPx: { value: 1 },
      uSand: { value: new THREE.Color(SAND) },
      uSilt: { value: new THREE.Color(SILT) },
      uClay: { value: new THREE.Color(CLAY) },
    }),
    []
  )

  useFrame(() => {
    if (!mat.current) return
    mat.current.uniforms.uT.value = timeRef.current
    mat.current.uniforms.uPx.value = Math.min(2, window.devicePixelRatio || 1) * Math.max(0.8, size.height / 1000)
  })

  // 柱（30 cm + 床）が画面の高さの 78% に収まる zoom。柱は右寄り（左は文字の余白）。
  // viewport は zoom を変えても再計算されないので、px から直接出す（初版はこれで柱が画面外に飛んだ）。
  const wide = size.width / size.height > 1.1
  const zoom = (size.height * (wide ? 0.78 : 0.5)) / (H + 2)
  useLayoutEffect(() => {
    camera.zoom = zoom
    camera.updateProjectionMatrix()
  }, [camera, zoom])
  const ox = wide ? (size.width * 0.17) / zoom : 0
  const oy = wide ? -H / 2 - 0.6 : -H / 2 - 4
  const ySiphon = H - SIPHON

  return (
    <group position={[ox, oy, 0]}>
      <points geometry={geom} frustumCulled={false}>
        <shaderMaterial
          ref={mat}
          vertexShader={vert}
          fragmentShader={frag}
          uniforms={uniforms}
          transparent
          depthWrite={false}
        />
      </points>
      {/* 柱の床と水面。ガラスの壁は描かない（粒が壁を決める） */}
      <Hair y={0} color="#5A5F66" />
      <Hair y={H} color="#2A2E34" />
      {/* 取水口の深さ。ここより上の水は、時刻 t に d* より細かい粒しか持っていない */}
      <Hair y={ySiphon} color={BLUE} extend={2.2} />
    </group>
  )
}

function Hair({ y, color, extend = 0.6 }) {
  const g = useMemo(() => {
    const b = new THREE.BufferGeometry()
    b.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([-W / 2 - extend, y, 0, W / 2 + extend, y, 0]), 3)
    )
    return b
  }, [y, extend])
  return (
    <lineSegments geometry={g}>
      <lineBasicMaterial color={color} />
    </lineSegments>
  )
}
