import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Environment, Lightformer, ContactShadows } from '@react-three/drei'
import * as THREE from 'three'
import { buildMesh, plates } from './rig.js'

const INK = '#0B0B0C'
const PLATE = '#F1F1F1'
const PLATE_W = 1.7
const PLATE_D = 1.5
const PLATE_T = 0.035

// The tumble: three incommensurate slow spins, so no orientation repeats
// and the body shows every face in a minute or so.
function tumble(t, out) {
  const e = new THREE.Euler(0.23 * t + 0.4, 0.31 * t + 1.1, 0.17 * t + 0.2, 'YXZ')
  return out.setFromEuler(e)
}

function Body({ state }) {
  const mesh = useMemo(() => {
    const m = buildMesh()
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(m.pos, 3))
    g.setAttribute('position2', new THREE.BufferAttribute(m.pos2, 3))
    g.setAttribute('normal', new THREE.BufferAttribute(m.nrm, 3))
    g.setIndex(new THREE.BufferAttribute(m.idx, 1))
    g.computeBoundingSphere()
    g.boundingSphere.radius = 0.7
    return g
  }, [])

  const uniforms = useMemo(() => ({ uMix: { value: 0 } }), [])
  const mat = useMemo(() => {
    const m = new THREE.MeshPhysicalMaterial({
      color: INK,
      roughness: 0.26,
      metalness: 0.0,
      clearcoat: 1,
      clearcoatRoughness: 0.12,
      envMapIntensity: 1.0,
    })
    // Both bodies are gradients of a support function that is linear in
    // (ε, δ), so the twin is an exact lerp of positions — and the outward
    // normal at a vertex is the same direction u for both. Only position mixes.
    m.onBeforeCompile = (s) => {
      s.uniforms.uMix = uniforms.uMix
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 position2;\nuniform float uMix;')
        .replace('#include <begin_vertex>', 'vec3 transformed = mix(position, position2, uMix);')
    }
    return m
  }, [uniforms])

  const group = useRef()
  const top = useRef()
  const cal = useRef()
  const calTop = useRef()
  const q = useMemo(() => new THREE.Quaternion(), [])
  const qi = useMemo(() => new THREE.Quaternion(), [])
  const d = useMemo(() => new THREE.Vector3(), [])
  const drag = useMemo(() => new THREE.Quaternion(), [])

  useFrame((_, dt) => {
    const s = state.current
    s.t += Math.min(dt, 1 / 20) * s.speed
    s.mix += (s.target - s.mix) * (1 - Math.exp(-Math.min(dt, 0.1) * 5))
    if (Math.abs(s.target - s.mix) < 1e-4) s.mix = s.target
    uniforms.uMix.value = s.mix

    drag.setFromEuler(new THREE.Euler(s.dragY, s.dragX, 0, 'YXZ'))
    tumble(s.t, q).premultiply(drag)
    // world up, seen from the body's own frame
    qi.copy(q).invert()
    d.set(0, 1, 0).applyQuaternion(qi)
    const p = plates(d.x, d.y, d.z, s.mix)
    group.current.quaternion.copy(q)
    group.current.position.y = p.bot
    top.current.position.y = p.width + PLATE_T / 2
    cal.current.scale.y = p.width
    cal.current.position.y = p.width / 2
    calTop.current.position.y = p.width
    s.width = p.width
    s.lo = Math.min(s.lo, p.width)
    s.hi = Math.max(s.hi, p.width)
    s.frames++
  })

  return (
    <>
      <group ref={group}>
        <mesh geometry={mesh} material={mat} castShadow />
      </group>
      {/* the upper plate: it only ever rests on the body */}
      <mesh ref={top} position={[0, 1, 0]}>
        <boxGeometry args={[PLATE_W, PLATE_T, PLATE_D]} />
        <meshPhysicalMaterial
          color="#FFFFFF"
          roughness={0.08}
          transmission={0.92}
          thickness={0.03}
          ior={1.49}
          transparent
          opacity={0.9}
        />
      </mesh>
      {/* caliper: one hairline the height of the gap */}
      <group position={[PLATE_W / 2 + 0.16, 0, PLATE_D / 2]}>
        <mesh ref={cal} position={[0, 0, 0]}>
          <boxGeometry args={[0.006, 1, 0.006]} />
          <meshBasicMaterial color={INK} />
        </mesh>
        <mesh position={[0, 0.0, 0]}>
          <boxGeometry args={[0.11, 0.006, 0.006]} />
          <meshBasicMaterial color={INK} />
        </mesh>
        <mesh ref={calTop}>
          <boxGeometry args={[0.11, 0.006, 0.006]} />
          <meshBasicMaterial color={INK} />
        </mesh>
      </group>
    </>
  )
}

function Rig({ state }) {
  const { camera } = useThree()
  useFrame(() => {
    // telephoto, a few degrees above the lower plate: the plates read as lines
    const el = (3.2 * Math.PI) / 180
    const D = 14.2
    const look = new THREE.Vector3(-0.14, 0.33, 0)
    camera.position.set(look.x + Math.sin(0.06) * D, look.y + Math.sin(el) * D, Math.cos(el) * D)
    camera.lookAt(look)
  })
  return null
}

function PointerSpin({ state }) {
  const { gl } = useThree()
  useMemo(() => {
    let down = null
    const el = gl.domElement
    el.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, ax: state.current.dragX, ay: state.current.dragY }
      el.setPointerCapture(e.pointerId)
    })
    el.addEventListener('pointermove', (e) => {
      if (!down) return
      state.current.dragX = down.ax + (e.clientX - down.x) * 0.008
      state.current.dragY = down.ay + (e.clientY - down.y) * 0.008
    })
    const up = () => (down = null)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }, [gl, state])
  return null
}

export default function Scene({ state }) {
  return (
    <>
      <color attach="background" args={['#FFFFFF']} />
      <Rig state={state} />
      <PointerSpin state={state} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[2.5, 6, 3]} intensity={1.6} />
      <Environment resolution={256} frames={1}>
        <Lightformer form="rect" intensity={3.2} position={[0, 5, 1]} rotation-x={Math.PI / 2} scale={[8, 3, 1]} />
        <Lightformer form="rect" intensity={1.8} position={[-5, 1.5, 2]} rotation-y={Math.PI / 2} scale={[3, 6, 1]} />
        <Lightformer form="rect" intensity={1.1} position={[5, 1.0, -1]} rotation-y={-Math.PI / 2} scale={[2, 4, 1]} />
        <Lightformer form="ring" intensity={2.4} position={[1.5, 2.5, 5]} scale={1.2} />
        <Lightformer form="rect" intensity={2.6} position={[0, -1, -5]} scale={[10, 1.2, 1]} />
        <Lightformer form="rect" intensity={1.4} position={[0, 0.2, 6]} scale={[10, 0.6, 1]} />
      </Environment>
      <Body state={state} />
      {/* the lower plate */}
      <mesh position={[0, -PLATE_T / 2, 0]}>
        <boxGeometry args={[PLATE_W, PLATE_T, PLATE_D]} />
        <meshStandardMaterial color={PLATE} roughness={0.6} />
      </mesh>
      <ContactShadows position={[0, 0.001, 0]} scale={[PLATE_W, PLATE_D]} opacity={0.55} blur={1.6} far={1.2} resolution={512} color="#000000" />
    </>
  )
}
