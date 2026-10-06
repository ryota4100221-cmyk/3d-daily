import { useMemo, useRef, useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { N, TANK, createSchool, step, knock, quiet, densest, stateOf, LATENCY, BURST } from './rig.js'

const WATER = new THREE.Color('#E6F8F9')
const CYAN = new THREE.Color('#07D0D8')
const INK = new THREE.Color('#0B2E33')

// one fish, nose at +x, length 1 BL, flat — seen from above
function fishGeometry() {
  const P = []
  const body = 14
  for (let k = 0; k < body; k++) {
    const x0 = 0.5 - (k / body) * 0.78
    const x1 = 0.5 - ((k + 1) / body) * 0.78
    const w = (x) => {
      const u = (0.5 - x) / 0.78
      return 0.13 * Math.sin(Math.PI * Math.pow(u, 0.62)) + 0.012
    }
    P.push(x0, w(x0), x1, w(x1), x1, -w(x1))
    P.push(x0, w(x0), x1, -w(x1), x0, -w(x0))
  }
  // forked tail
  P.push(-0.27, 0.02, -0.5, 0.12, -0.42, 0.0)
  P.push(-0.27, -0.02, -0.42, 0.0, -0.5, -0.12)
  const g = new THREE.InstancedBufferGeometry()
  const pos = new Float32Array(P.length / 2 * 3)
  for (let i = 0; i < P.length / 2; i++) {
    pos[i * 3] = P[i * 2]
    pos[i * 3 + 1] = P[i * 2 + 1]
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  return g
}

const vert = /* glsl */ `
  attribute vec4 aFish;   // x, y, heading x, heading y
  attribute vec2 aState;  // alarm 0..1, tail phase
  uniform float uScale;
  varying float vAlarm;
  void main() {
    vec2 p = position.xy;
    float tail = clamp(-(p.x - 0.25), 0.0, 1.0);
    p.y += sin(aState.y - p.x * 5.0) * 0.07 * tail * tail * 4.0;
    p *= uScale;
    vec2 h = aFish.zw;
    vec2 w = vec2(p.x * h.x - p.y * h.y, p.x * h.y + p.y * h.x) + aFish.xy;
    vAlarm = aState.x;
    gl_Position = projectionMatrix * viewMatrix * vec4(w, 0.1 + aState.x * 0.1, 1.0);
  }
`
const frag = /* glsl */ `
  uniform vec3 uCyan;
  uniform vec3 uInk;
  varying float vAlarm;
  void main() {
    gl_FragColor = vec4(mix(uCyan, uInk, vAlarm), 1.0);
    #include <colorspace_fragment>
  }
`

function Tank() {
  const pts = useMemo(() => {
    const T = TANK
    return new Float32Array([T.x0, T.y0, 0, T.x1, T.y0, 0, T.x1, T.y1, 0, T.x0, T.y1, 0, T.x0, T.y0, 0])
  }, [])
  const ticks = useMemo(() => {
    // a ruler along the bottom glass, every 8 BL
    const a = []
    for (let x = TANK.x0; x <= TANK.x1 + 0.01; x += 8) {
      const L = (x - TANK.x0) % 32 === 0 ? 1.6 : 0.8
      a.push(x, TANK.y0, 0, x, TANK.y0 - L, 0)
    }
    return new Float32Array(a)
  }, [])
  return (
    <group>
      <mesh position={[(TANK.x0 + TANK.x1) / 2, (TANK.y0 + TANK.y1) / 2, -0.5]}>
        <planeGeometry args={[TANK.x1 - TANK.x0, TANK.y1 - TANK.y0]} />
        <meshBasicMaterial color={WATER} />
      </mesh>
      <line>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[pts, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color="#07D0D8" />
      </line>
      <lineSegments>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[ticks, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color="#07D0D8" />
      </lineSegments>
    </group>
  )
}

// the circle the fitted wave speed predicts: r = c·(t − t0) + b
// clipped to the glass so it never runs into the type
const ringMat = new THREE.ShaderMaterial({
  transparent: true,
  uniforms: { uOpacity: { value: 1 }, uInk: { value: INK } },
  vertexShader: /* glsl */ `
    varying vec2 vW;
    void main() {
      vec4 w = modelMatrix * vec4(position, 1.0);
      vW = w.xy;
      gl_Position = projectionMatrix * viewMatrix * w;
    }`,
  fragmentShader: /* glsl */ `
    uniform float uOpacity;
    uniform vec3 uInk;
    varying vec2 vW;
    void main() {
      if (vW.x < ${TANK.x0.toFixed(1)} || vW.x > ${TANK.x1.toFixed(1)} || vW.y < ${TANK.y0.toFixed(1)} || vW.y > ${TANK.y1.toFixed(1)}) discard;
      gl_FragColor = vec4(uInk, uOpacity * 0.8);
      #include <colorspace_fragment>
    }`,
})

function Front({ school }) {
  const ref = useRef()
  const geo = useMemo(() => {
    const a = []
    for (let k = 0; k <= 160; k++) {
      const t = (k / 160) * Math.PI * 2
      a.push(Math.cos(t), Math.sin(t), 0)
    }
    return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(a, 3))
  }, [])
  useFrame(() => {
    const c = school.cascade
    const m = ref.current
    if (!c || c.c == null) { m.visible = false; return }
    const age = school.t - c.t0
    const r = c.c * age + c.b
    const fade = Math.max(0, 1 - age / 3.2)
    m.visible = r > 0.5 && fade > 0
    m.position.set(c.x, c.y, 0.3)
    m.scale.setScalar(Math.max(r, 0.01))
    ringMat.uniforms.uOpacity.value = fade
  })
  return (
    <lineLoop ref={ref} geometry={geo} material={ringMat} />
  )
}

function Knock({ school }) {
  const ref = useRef()
  useFrame(() => {
    const c = school.cascade
    const m = ref.current
    if (!c) { m.visible = false; return }
    m.visible = true
    m.position.set(c.x, c.y, 0.4)
  })
  return (
    <mesh ref={ref}>
      <ringGeometry args={[0.55, 0.85, 40]} />
      <meshBasicMaterial color="#0B2E33" />
    </mesh>
  )
}

function Fish({ school }) {
  const { geo, mat, aFish, aState } = useMemo(() => {
    const geo = fishGeometry()
    const aFish = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4)
    const aState = new THREE.InstancedBufferAttribute(new Float32Array(N * 2), 2)
    aFish.setUsage(THREE.DynamicDrawUsage)
    aState.setUsage(THREE.DynamicDrawUsage)
    geo.setAttribute('aFish', aFish)
    geo.setAttribute('aState', aState)
    geo.instanceCount = N
    const mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: { uScale: { value: 1.25 }, uCyan: { value: CYAN }, uInk: { value: INK } },
      side: THREE.DoubleSide,
    })
    return { geo, mat, aFish, aState }
  }, [])
  useFrame(() => {
    const s = school
    const f = aFish.array
    const a = aState.array
    for (let i = 0; i < N; i++) {
      f[i * 4] = s.px[i]
      f[i * 4 + 1] = s.py[i]
      f[i * 4 + 2] = s.hx[i]
      f[i * 4 + 3] = s.hy[i]
      const st = stateOf(s, i)
      let al = 0
      const age = s.t - s.trig[i]
      if (st === 1) al = 0.35
      else if (st === 2) al = 1
      else if (st === 3) al = Math.max(0, 1 - (age - LATENCY - BURST) / 0.9)
      a[i * 2] = al
      a[i * 2 + 1] = s.phase[i]
    }
    aFish.needsUpdate = true
    aState.needsUpdate = true
  })
  return <mesh geometry={geo} material={mat} frustumCulled={false} />
}

function Camera() {
  const { camera, size } = useThree()
  useEffect(() => {
    // fit the tank, leaving the lower band to the type
    const w = TANK.x1 - TANK.x0 + 14
    const h = TANK.y1 - TANK.y0 + 30
    const mobile = size.width < 760
    camera.zoom = mobile ? Math.min(size.width / (w * 0.62), size.height / h) : Math.min(size.width / w, size.height / h)
    camera.position.set(mobile ? 0 : 0, -7, 50)
    camera.lookAt(0, -7, 0)
    camera.updateProjectionMatrix()
  }, [camera, size])
  return null
}

export default function Scene({ school, onTick, presim }) {
  const acc = useRef(0)
  const next = useRef(school.t + 1.6)
  const { camera, gl } = useThree()

  useEffect(() => {
    const el = gl.domElement
    const down = (e) => {
      const r = el.getBoundingClientRect()
      const v = new THREE.Vector3(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1, 0)
      v.unproject(camera)
      if (knock(school, v.x, v.y, 4)) next.current = school.t + 7
    }
    el.addEventListener('pointerdown', down)
    return () => el.removeEventListener('pointerdown', down)
  }, [camera, gl, school])

  useFrame((_, delta) => {
    if (presim) { onTick(); return }
    acc.current += Math.min(delta, 0.05)
    let n = 0
    while (acc.current >= 1 / 60 && n < 2) {
      step(school, 1 / 60)
      acc.current -= 1 / 60
      n++
    }
    if (n === 2) acc.current = 0
    if (school.t > next.current && quiet(school)) {
      const [x, y] = densest(school)
      knock(school, x, y)
      next.current = school.t + 6.5
    }
    onTick()
  })

  return (
    <>
      <Camera />
      <Tank />
      <Fish school={school} />
      <Front school={school} />
      <Knock school={school} />
    </>
  )
}
