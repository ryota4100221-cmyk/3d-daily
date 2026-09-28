import { useMemo, useRef, useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { createRig, units, balls, R, BALL_R, TRAIL } from './rig.js'

const FLOOR = '#8b8e91'
const SHELL = '#e4e4e1'
const SKIRT = '#3a3c3f'
const BLUE = '#2952cc'
const INK = '#26282b'

// a rounded triangle, corners at the three balls
function chassisShape(r, round) {
  const s = new THREE.Shape()
  const pts = [0, 1, 2].map((k) => {
    const a = Math.PI / 2 + (k * 2 * Math.PI) / 3
    return new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r)
  })
  for (let k = 0; k < 3; k++) {
    const p = pts[k], prev = pts[(k + 2) % 3], next = pts[(k + 1) % 3]
    const a = p.clone().add(prev.clone().sub(p).setLength(round))
    const b = p.clone().add(next.clone().sub(p).setLength(round))
    if (k === 0) s.moveTo(a.x, a.y)
    else s.lineTo(a.x, a.y)
    s.quadraticCurveTo(p.x, p.y, b.x, b.y)
  }
  s.closePath()
  return s
}

function useBallTexture() {
  return useMemo(() => {
    const c = document.createElement('canvas')
    c.width = 256; c.height = 128
    const g = c.getContext('2d')
    g.fillStyle = INK; g.fillRect(0, 0, 256, 128)
    g.fillStyle = '#d8d9d6'
    g.fillRect(0, 60, 256, 8) // equator
    for (let i = 0; i < 4; i++) g.fillRect(i * 64 + 28, 0, 8, 128) // meridians
    g.fillStyle = BLUE
    g.fillRect(0, 20, 256, 4)
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 4
    return t
  }, [])
}

function Unit({ i, rig }) {
  const ref = useRef()
  const geo = useMemo(() => {
    const top = new THREE.ExtrudeGeometry(chassisShape(BALL_R + 0.2, 0.26), {
      depth: 0.16, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 3, curveSegments: 10,
    })
    top.rotateX(-Math.PI / 2)
    const skirt = new THREE.ExtrudeGeometry(chassisShape(BALL_R + 0.17, 0.24), {
      depth: 0.1, bevelEnabled: false, curveSegments: 10,
    })
    skirt.rotateX(-Math.PI / 2)
    const line = new THREE.ExtrudeGeometry(chassisShape(BALL_R + 0.215, 0.265), {
      depth: 0.018, bevelEnabled: false, curveSegments: 10,
    })
    line.rotateX(-Math.PI / 2)
    return { top, skirt, line }
  }, [])
  useFrame(() => {
    const p = rig.unitPose(units[i])
    ref.current.position.set(p.x, 0, p.z)
    ref.current.rotation.y = p.yaw
  })
  return (
    <group ref={ref}>
      <mesh geometry={geo.skirt} position-y={R + 0.02} castShadow receiveShadow>
        <meshStandardMaterial color={SKIRT} roughness={0.7} />
      </mesh>
      <mesh geometry={geo.line} position-y={R + 0.125}>
        <meshStandardMaterial color={BLUE} emissive={BLUE} emissiveIntensity={1.4} toneMapped={false} />
      </mesh>
      <mesh geometry={geo.top} position-y={R + 0.15} castShadow receiveShadow>
        <meshStandardMaterial color={SHELL} roughness={0.42} />
      </mesh>
      {/* the post the slab sits on */}
      <mesh position-y={R + 0.42} castShadow>
        <cylinderGeometry args={[0.12, 0.15, 0.2, 24]} />
        <meshStandardMaterial color={SKIRT} roughness={0.6} />
      </mesh>
    </group>
  )
}

function Balls({ rig }) {
  const map = useBallTexture()
  const refs = useRef([])
  useFrame(() => {
    rig.state.ball.forEach((s, i) => {
      const m = refs.current[i]
      m.position.copy(s.pos)
      m.quaternion.copy(s.q)
    })
  })
  return balls.map((_, i) => (
    <mesh key={i} ref={(m) => (refs.current[i] = m)} castShadow>
      <sphereGeometry args={[R, 40, 24]} />
      <meshStandardMaterial map={map} roughness={0.35} metalness={0.1} />
    </mesh>
  ))
}

// the marks each ball leaves on the floor, fading into the floor colour
function Trails({ rig }) {
  const objs = useMemo(() => {
    const floor = new THREE.Color(FLOOR).convertSRGBToLinear()
    const ink = new THREE.Color('#1d1f22').convertSRGBToLinear()
    const blue = new THREE.Color(BLUE).convertSRGBToLinear()
    return balls.map((b, i) => {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3))
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3))
      const line = new THREE.Line(g, new THREE.LineBasicMaterial({ vertexColors: true }))
      line.userData = { floor, head: i % 3 === 0 ? blue : ink }
      line.frustumCulled = false
      return line
    })
  }, [])
  const col = new THREE.Color()
  useFrame(() => {
    rig.state.ball.forEach((s, i) => {
      const line = objs[i]
      const pos = line.geometry.attributes.position
      const cl = line.geometry.attributes.color
      const n = s.count
      for (let j = 0; j < n; j++) {
        const src = (s.head - n + j + TRAIL) % TRAIL
        pos.array[j * 3] = s.trail[src * 3]
        pos.array[j * 3 + 1] = s.trail[src * 3 + 1]
        pos.array[j * 3 + 2] = s.trail[src * 3 + 2]
        const f = Math.pow(j / Math.max(n - 1, 1), 1.6)
        col.copy(line.userData.floor).lerp(line.userData.head, f * 0.85)
        cl.array[j * 3] = col.r; cl.array[j * 3 + 1] = col.g; cl.array[j * 3 + 2] = col.b
      }
      line.geometry.setDrawRange(0, n)
      pos.needsUpdate = true
      cl.needsUpdate = true
    })
  })
  return objs.map((o, i) => <primitive key={i} object={o} />)
}

// short blue ticks: each ball's contact velocity, the quantity everything is read from
function Ticks({ rig }) {
  const seg = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(balls.length * 6), 3))
    const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: BLUE, toneMapped: false }))
    l.frustumCulled = false
    return l
  }, [])
  useFrame(() => {
    const a = seg.geometry.attributes.position.array
    rig.state.ball.forEach((s, i) => {
      a.set([s.pos.x, 0.01, s.pos.z, s.pos.x + s.vc.x * 0.45, 0.01, s.pos.z + s.vc.z * 0.45], i * 6)
    })
    seg.geometry.attributes.position.needsUpdate = true
  })
  return <primitive object={seg} />
}

function Slab({ rig }) {
  const ref = useRef()
  useFrame(() => {
    const p = rig.state.pose
    ref.current.position.set(p.x, R + 0.56, p.z)
    ref.current.rotation.y = p.th
  })
  return (
    <group ref={ref}>
      {/* an open truss between the three posts: the load, kept see-through so the machines stay visible */}
      {[0, 1, 2].map((k) => {
        const a = units[k], c = units[(k + 1) % 3]
        const len = Math.hypot(c.x - a.x, c.z - a.z)
        return (
          <mesh key={k} position={[(a.x + c.x) / 2, 0, (a.z + c.z) / 2]} rotation-y={-Math.atan2(c.z - a.z, c.x - a.x)} castShadow receiveShadow>
            <boxGeometry args={[len + 0.3, 0.1, 0.22]} />
            <meshStandardMaterial color="#f1f0ec" roughness={0.5} />
          </mesh>
        )
      })}
      {units.map((u, k) => (
        <mesh key={'n' + k} position={[u.x, 0.02, u.z]} castShadow>
          <cylinderGeometry args={[0.2, 0.2, 0.14, 32]} />
          <meshStandardMaterial color={k === 0 ? BLUE : '#f1f0ec'} roughness={0.5} />
        </mesh>
      ))}
    </group>
  )
}

function Floor() {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uBase: { value: new THREE.Color(FLOOR) } },
        vertexShader: /* glsl */ `
          varying vec3 vW;
          void main(){ vec4 w = modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uBase; varying vec3 vW;
          float grid(vec2 p, float s, float w){ vec2 g=abs(fract(p/s-.5)-.5)*s/fwidth(p); return 1.-min(min(g.x,g.y)/w,1.); }
          void main(){
            vec3 c = uBase;
            c = mix(c, c*0.9, grid(vW.xz, 0.5, 1.0)*0.55);
            c = mix(c, c*0.78, grid(vW.xz, 2.5, 1.2)*0.8);
            float d = length(vW.xz);
            c *= 1.0 - smoothstep(4.0, 16.0, d)*0.12;
            gl_FragColor = vec4(c,1.);
            #include <colorspace_fragment>
          }`,
      }),
    []
  )
  return (
    <>
      <mesh rotation-x={-Math.PI / 2} material={mat}>
        <planeGeometry args={[80, 80]} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.002} receiveShadow>
        <planeGeometry args={[80, 80]} />
        <shadowMaterial opacity={0.28} />
      </mesh>
    </>
  )
}

function Pointer({ rig }) {
  const { camera, gl, size } = useThree()
  useEffect(() => {
    const ray = new THREE.Raycaster()
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    const hit = new THREE.Vector3()
    const nd = new THREE.Vector2()
    const el = gl.domElement
    const move = (e) => {
      const r = el.getBoundingClientRect()
      nd.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
      ray.setFromCamera(nd, camera)
      if (ray.ray.intersectPlane(plane, hit)) {
        const s = rig.state
        if (s.auto) s.target.th = s.pose.th
        s.target.x = THREE.MathUtils.clamp(hit.x, -6, 6)
        s.target.z = THREE.MathUtils.clamp(hit.z, -6, 6)
        s.idle = 0
      }
    }
    const down = (e) => { rig.state.holding = true; move(e) }
    const up = () => { rig.state.holding = false }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerdown', down)
    window.addEventListener('pointerup', up)
    return () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerdown', down)
      window.removeEventListener('pointerup', up)
    }
  }, [camera, gl, size, rig])
  return null
}

export default function Scene({ onRead }) {
  const rig = useMemo(() => createRig(), [])
  const acc = useRef(1)
  useFrame((_, dt) => {
    const h = Math.min(dt, 1 / 30)
    rig.step(h / 2)
    rig.step(h / 2)
    acc.current += dt
    if (acc.current > 0.1 && onRead) {
      acc.current = 0
      onRead(rig.state)
    }
  })
  return (
    <>
      <color attach="background" args={[FLOOR]} />
      <hemisphereLight args={['#f4f5f7', '#6d7073', 1.1]} />
      <directionalLight
        position={[-5, 11, 4]}
        intensity={2.2}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-9}
        shadow-camera-right={9}
        shadow-camera-top={9}
        shadow-camera-bottom={-9}
        shadow-bias={-0.0004}
      />
      <Floor />
      <Trails rig={rig} />
      <Ticks rig={rig} />
      <Balls rig={rig} />
      {units.map((_, i) => <Unit key={i} i={i} rig={rig} />)}
      <Slab rig={rig} />
      <Pointer rig={rig} />
    </>
  )
}
