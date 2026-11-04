import { useMemo, useRef, useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { bodyGeometry, headGeometry, legGeometry, snoutGeometry, earGeometry, tailGeometry } from './pig.js'

const lin = (hex) => new THREE.Color(hex) // sRGB の16進 → 線形（出力で sRGB に戻る）

// 面の法線は画面上の微分から取る（＝頂点を共有していても必ず平らに塗れる）
const facetVert = /* glsl */ `
  attribute float fr;
  varying vec3 vW;
  varying float vFr;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vFr = fr;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`
const facetFrag = /* glsl */ `
  uniform vec3 uDark, uMid, uLight, uBg;
  uniform vec3 uL;
  uniform float uFloor;
  varying vec3 vW;
  varying float vFr;
  void main() {
    vec3 n = normalize(cross(dFdx(vW), dFdy(vW)));
    float d = dot(n, normalize(uL));
    float k = clamp(0.5 + 0.85 * d, 0.0, 1.0);
    float up = clamp(n.y, 0.0, 1.0);
    vec3 c = k < 0.5 ? mix(uDark, uMid, k / 0.5) : mix(uMid, uLight, (k - 0.5) / 0.5);
    c = mix(c, uLight, up * 0.3);
    c = mix(c, uDark, smoothstep(0.15, 0.85, -n.x) * 0.4);
    c = mix(c, uDark, smoothstep(-2.1, -2.9, vW.x) * (0.25 + 0.3 * vFr) * (1.0 - up));
    c = mix(c, uMid, clamp(-n.y, 0.0, 1.0) * 0.25);
    c *= 1.0 + (vFr - 0.5) * 0.05;
    // 奥の脚は沈む
    c = mix(c, uDark, smoothstep(-0.1, -0.5, vW.z) * smoothstep(-1.1, -1.5, vW.y) * 0.35);
    // 脚の先は地へ溶ける
    float f = smoothstep(uFloor + 0.9, uFloor, vW.y) * 0.25;
    c = mix(c, uBg, f);
    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }
`

function useFacetMat() {
  return useMemo(() => new THREE.ShaderMaterial({
    vertexShader: facetVert,
    fragmentShader: facetFrag,
    uniforms: {
      uDark: { value: lin(0xd3a1ad) },
      uMid: { value: lin(0xe6c5cc) },
      uLight: { value: lin(0xf7eaed) },
      uBg: { value: lin(0xf4f1ee) },
      uL: { value: new THREE.Vector3(-0.3, 0.9, 0.12) },
      uFloor: { value: -2.55 },
    },
  }), [])
}

const shadowFrag = /* glsl */ `
  uniform vec3 uC;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p * vec2(1.0, 1.0 + 0.6 * smoothstep(-0.6, 0.8, p.x)));
    float a = smoothstep(1.0, 0.1, r) * 0.6;
    gl_FragColor = vec4(uC, a);
    #include <colorspace_fragment>
  }
`
const shadowVert = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`

export default function Scene() {
  const mat = useFacetMat()
  const discMat = useMemo(() => {
    const m = mat.clone()
    m.uniforms.uDark.value = lin(0xe2bfc7); m.uniforms.uMid.value = lin(0xecd5da); m.uniforms.uLight.value = lin(0xf6e9ec)
    return m
  }, [mat])
  const group = useRef()
  const geos = useMemo(() => ({
    body: bodyGeometry(),
    head: headGeometry(),
    legs: [
      ...legGeometry(-1.3, 0.42, { kind: 'f', seed: 3, rTop: 0.55, splay: -0.08 }),
      ...legGeometry(-1.6, -0.42, { kind: 'f', seed: 4, rTop: 0.5, splay: 0.02 }),
      ...legGeometry(1.95, 0.42, { kind: 'r', seed: 5, rTop: 0.78, splay: -0.12 }),
      ...legGeometry(1.55, -0.42, { kind: 'r', seed: 6, rTop: 0.72, splay: -0.04 }),
    ],
    snout: snoutGeometry(10),
    ears: [earGeometry(1, 7), earGeometry(-1, 8)],
    tail: tailGeometry(9),
  }), [])
  const shadowMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: shadowVert, fragmentShader: shadowFrag, transparent: true, depthWrite: false,
    uniforms: { uC: { value: lin(0xd9d5d1) } },
  }), [])

  const { camera } = useThree()
  useEffect(() => {
    camera.position.set(-0.375, 2.25, 28.5)
    camera.lookAt(-0.375, -0.74, 0)
    camera.updateProjectionMatrix()
  }, [camera])

  const scroll = useRef(0)
  useEffect(() => {
    const on = () => { scroll.current = Math.min(1, window.scrollY / Math.max(1, window.innerHeight)) }
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])
  const yaw = useRef(0)
  useFrame((st, dt) => {
    const target = 0.22 - scroll.current * 0.9
    yaw.current += (target - yaw.current) * Math.min(1, dt * 4)
    const g = group.current
    g.rotation.y = yaw.current
    const t = st.clock.elapsedTime
    g.position.y = Math.sin(t * 1.1) * 0.015
  })

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[1.6, -2.53, -0.55]} scale={[7.4, 2.2, 1]} material={shadowMat} renderOrder={-1}>
        <planeGeometry args={[1, 1]} />
      </mesh>
      <group ref={group}>
        <mesh geometry={geos.body} material={mat} />
        {geos.legs.map((g, i) => <mesh key={i} geometry={g} material={mat} />)}
        <mesh geometry={geos.tail} material={mat} />
        {/* 頭は首の付け根でもう少しこちらへ振る（ref は顔が体より手前を向き、鼻盤が見える） */}
        <group position={[-2.0, -0.2, 0]} rotation={[0, 0.32, -0.04]}>
          <group position={[2.0, 0.2, 0]}>
            <mesh geometry={geos.head} material={mat} />
            {geos.ears.map((g, i) => <mesh key={'e' + i} geometry={g} material={mat} />)}
            <mesh geometry={geos.snout} material={discMat} />
          </group>
        </group>
      </group>
    </group>
  )
}
