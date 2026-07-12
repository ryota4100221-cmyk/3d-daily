import { useEffect, useMemo, useRef } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/*
 * Day 013 — Morph / interpolation.
 * ONE indexed icosphere carries four morph targets (position + normal deltas).
 * A cursor of morphTargetInfluences is damped toward a one-hot vector, so the
 * body cross-fades continuously through Sphere · Cube · Gem · Bloom · Ripple.
 * Because we ship morph NORMALS too, lighting stays correct at every in-between.
 */

// ---- target shape functions: unit sphere direction (x,y,z) -> new position ----
function roundedCube(x, y, z) {
  const e = 4
  const d = Math.pow(
    Math.pow(Math.abs(x), e) + Math.pow(Math.abs(y), e) + Math.pow(Math.abs(z), e),
    1 / e,
  )
  return [x / d, y / d, z / d]
}

function gem(x, y, z) {
  const e = 1.55
  const d = Math.pow(
    Math.pow(Math.abs(x), e) + Math.pow(Math.abs(y), e) + Math.pow(Math.abs(z), e),
    1 / e,
  )
  return [x / d, y / d, z / d]
}

function bloom(x, y, z) {
  // lobed flower — low-frequency angular swell
  const theta = Math.acos(Math.max(-1, Math.min(1, y))) // 0..pi
  const phi = Math.atan2(z, x)
  const r = 1 + 0.34 * Math.abs(Math.sin(4 * phi) * Math.sin(3 * theta))
  return [x * r, y * r, z * r]
}

function ripple(x, y, z) {
  // horizontal rings running pole-to-pole
  const theta = Math.acos(Math.max(-1, Math.min(1, y)))
  const r = 1 + 0.11 * Math.sin(11 * theta)
  return [x * r, y * r, z * r]
}

const SHAPES = [roundedCube, gem, bloom, ripple]
// state[0] = Sphere (all influences 0); 1..4 activate morph target i-1
const FORMS = ['Sphere', 'Cube', 'Gem', 'Bloom', 'Ripple']
const HOLD = 3.4 // seconds per form

function useMorphGeometry() {
  return useMemo(() => {
    const ico = new THREE.IcosahedronGeometry(1, 5)
    const geo = mergeVertices(ico) // smooth, shared vertices
    geo.computeVertexNormals()

    const posA = geo.attributes.position
    const norA = geo.attributes.normal
    const count = posA.count

    const morphPos = []
    const morphNor = []
    const tmp = new THREE.BufferGeometry()
    tmp.setIndex(geo.index)

    for (const fn of SHAPES) {
      const abs = new Float32Array(count * 3)
      const dPos = new Float32Array(count * 3)
      for (let i = 0; i < count; i++) {
        const x = posA.getX(i)
        const y = posA.getY(i)
        const z = posA.getZ(i)
        const [tx, ty, tz] = fn(x, y, z)
        abs[i * 3] = tx
        abs[i * 3 + 1] = ty
        abs[i * 3 + 2] = tz
        dPos[i * 3] = tx - x
        dPos[i * 3 + 1] = ty - y
        dPos[i * 3 + 2] = tz - z
      }
      // derive matching morph normals from the target surface
      tmp.setAttribute('position', new THREE.BufferAttribute(abs, 3))
      tmp.computeVertexNormals()
      const tn = tmp.attributes.normal
      const dNor = new Float32Array(count * 3)
      for (let i = 0; i < count; i++) {
        dNor[i * 3] = tn.getX(i) - norA.getX(i)
        dNor[i * 3 + 1] = tn.getY(i) - norA.getY(i)
        dNor[i * 3 + 2] = tn.getZ(i) - norA.getZ(i)
      }
      morphPos.push(new THREE.BufferAttribute(dPos, 3))
      morphNor.push(new THREE.BufferAttribute(dNor, 3))
    }

    geo.morphAttributes.position = morphPos
    geo.morphAttributes.normal = morphNor
    geo.morphTargetsRelative = true

    tmp.dispose()
    ico.dispose()
    return geo
  }, [])
}

// procedural gradient environment (offline-safe, no HDRI fetch)
function useEnvMap() {
  const gl = useThree((s) => s.gl)
  return useMemo(() => {
    const c = document.createElement('canvas')
    c.width = 512
    c.height = 256
    const ctx = c.getContext('2d')
    const g = ctx.createLinearGradient(0, 0, 0, 256)
    g.addColorStop(0, '#fbf7ef')
    g.addColorStop(0.55, '#e6dfd2')
    g.addColorStop(1, '#8d867a')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 512, 256)
    // soft warm key reflection
    const rg = ctx.createRadialGradient(140, 66, 0, 140, 66, 130)
    rg.addColorStop(0, '#fff4e3')
    rg.addColorStop(1, 'rgba(255,244,227,0)')
    ctx.fillStyle = rg
    ctx.fillRect(0, 0, 512, 256)
    const tex = new THREE.CanvasTexture(c)
    tex.mapping = THREE.EquirectangularReflectionMapping
    tex.colorSpace = THREE.SRGBColorSpace
    const pmrem = new THREE.PMREMGenerator(gl)
    pmrem.compileEquirectangularShader()
    const env = pmrem.fromEquirectangular(tex).texture
    tex.dispose()
    pmrem.dispose()
    return env
  }, [gl])
}

export default function Scene({ onForm }) {
  const geometry = useMorphGeometry()
  const envMap = useEnvMap()

  const meshRef = useRef()
  const groupRef = useRef()
  const pointer = useRef({ x: 0, y: 0 })
  const stateRef = useRef(-1)

  // R3F assigns geometry after the Mesh is constructed, so the influences
  // array is never auto-built — do it once, or the renderer reads undefined.
  useEffect(() => {
    meshRef.current?.updateMorphTargets()
  }, [geometry])

  useFrame((s, delta) => {
    const mesh = meshRef.current
    const grp = groupRef.current
    if (!mesh || !grp) return

    // wall-clock form cycle (frame-drop tolerant)
    const t = s.clock.elapsedTime
    const idx = Math.floor(t / HOLD) % FORMS.length
    if (idx !== stateRef.current) {
      stateRef.current = idx
      onForm?.(FORMS[idx])
    }

    // damp influences toward one-hot for the current form
    const inf = mesh.morphTargetInfluences
    if (inf) {
      for (let i = 0; i < inf.length; i++) {
        const target = idx - 1 === i ? 1 : 0
        inf[i] = THREE.MathUtils.damp(inf[i], target, 3.2, delta)
      }
    }

    // pointer parallax + slow constant spin
    const p = s.pointer
    pointer.current.x = THREE.MathUtils.damp(pointer.current.x, p.x, 4, delta)
    pointer.current.y = THREE.MathUtils.damp(pointer.current.y, p.y, 4, delta)
    grp.rotation.y += delta * 0.28
    grp.rotation.x = THREE.MathUtils.damp(
      grp.rotation.x,
      -pointer.current.y * 0.32,
      5,
      delta,
    )
    grp.position.x = THREE.MathUtils.damp(grp.position.x, pointer.current.x * 0.35, 5, delta)
    // subtle breathing
    const b = 1 + Math.sin(t * 0.9) * 0.012
    grp.scale.setScalar(1.04 * b)
  })

  return (
    <>
      <color attach="background" args={['#ece7dd']} />
      <fog attach="fog" args={['#ece7dd', 9, 20]} />

      <hemisphereLight args={['#fbf6ec', '#b9b0a0', 0.55]} />
      <directionalLight
        position={[4.5, 6, 4]}
        intensity={2.1}
        color={'#fff3e2'}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0002}
        shadow-camera-near={1}
        shadow-camera-far={20}
        shadow-camera-left={-4}
        shadow-camera-right={4}
        shadow-camera-top={4}
        shadow-camera-bottom={-4}
      />
      {/* warm terracotta rim from behind */}
      <directionalLight position={[-5, 2.5, -4]} intensity={1.3} color={'#e08a54'} />

      <group ref={groupRef} position={[0, 0.55, 0]}>
        <mesh
          ref={meshRef}
          geometry={geometry}
          morphTargetInfluences={[0, 0, 0, 0]}
          castShadow
        >
          <meshPhysicalMaterial
            color={'#b3a290'}
            roughness={0.34}
            metalness={0.05}
            clearcoat={0.65}
            clearcoatRoughness={0.35}
            envMap={envMap}
            envMapIntensity={0.9}
            sheen={0.4}
            sheenColor={'#e6c9ad'}
          />
        </mesh>
      </group>

      {/* grounding shadow catcher */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.15, 0]} receiveShadow>
        <planeGeometry args={[40, 40]} />
        <shadowMaterial transparent opacity={0.22} color={'#2a2620'} />
      </mesh>
    </>
  )
}
