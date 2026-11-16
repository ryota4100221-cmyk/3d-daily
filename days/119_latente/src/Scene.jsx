import React, { useMemo, useRef, useEffect } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { RoundedBox } from '@react-three/drei'
import { EffectComposer, Bloom, Vignette, Noise, ToneMapping } from '@react-three/postprocessing'
import { BlendFunction, ToneMappingMode } from 'postprocessing'
import { lampGeometries } from './lamp.js'
import { makeRock, makeWood, makeOnyx, makeFloor, makeGobo } from './textures.js'

// 画面座標の当て込み：カメラ (0, 1.75, 6)・水平・縦画角 40°。
// 床 y=0、奥の壁 z=-5.4（床と壁の境が画面 y≈640）、灯りは x=1.62, z=0（画面 x≈1055）。
const LX = 1.62, LZ = 0

function Lamp() {
  const geo = useMemo(() => lampGeometries(), [])
  const wood = useMemo(() => makeWood(), [])
  const onyx = useMemo(() => makeOnyx(), [])
  const woodMat = useMemo(() => new THREE.MeshStandardMaterial({ map: wood, color: '#83746a', roughness: 0.62, metalness: 0, side: THREE.DoubleSide }), [wood])
  const glowMat = useMemo(() => new THREE.MeshStandardMaterial({ map: onyx, emissiveMap: onyx, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.9, roughness: 0.4, side: THREE.DoubleSide }), [onyx])
  const g = useRef()
  useFrame((st) => {
    const t = st.clock.elapsedTime
    glowMat.emissiveIntensity = 0.92 + Math.sin(t * 0.7) * 0.03
  })
  return (
    <group ref={g} position={[LX, 0, LZ]} rotation={[0, -0.15, 0]}>
      <mesh geometry={geo.outer} material={woodMat} castShadow receiveShadow />
      <mesh geometry={geo.edgeA} material={woodMat} castShadow receiveShadow />
      <mesh geometry={geo.edgeB} material={woodMat} castShadow receiveShadow />
      <mesh geometry={geo.inner} material={glowMat} />
      {/* 台座 */}
      <mesh position={[0.02, 0.065, 0]} castShadow receiveShadow material={woodMat}>
        <cylinderGeometry args={[0.47, 0.49, 0.13, 72]} />
      </mesh>
      {/* 内の灯り：開口から漏れて床と縁を照らす */}
      <pointLight position={[0.02, 1.9, 0.1]} color="#ffc27a" intensity={1.0} distance={4.5} decay={1.6} />
      <pointLight position={[-0.05, 1.2, 0.15]} color="#ffb867" intensity={0.7} distance={3.5} decay={1.6} />
    </group>
  )
}

function Chair() {
  const leather = useMemo(() => new THREE.MeshStandardMaterial({ color: '#232820', roughness: 0.38 }), [])
  const frame = useMemo(() => new THREE.MeshStandardMaterial({ color: '#4a2c17', roughness: 0.45 }), [])
  return (
    <group position={[1.05, 0, -4.45]} rotation={[0, 0.18, 0]}>
      <RoundedBox args={[1.5, 0.34, 1.3]} radius={0.12} smoothness={4} position={[0, 0.8, 0.05]} material={leather} castShadow receiveShadow />
      <RoundedBox args={[1.42, 1.15, 0.32]} radius={0.12} smoothness={4} position={[0, 1.5, -0.52]} rotation={[-0.14, 0, 0]} material={leather} castShadow receiveShadow />
      {[-0.82, 0.82].map((x) => (
        <group key={x}>
          <RoundedBox args={[0.13, 0.07, 1.45]} radius={0.03} smoothness={3} position={[x, 1.2, 0.08]} material={frame} castShadow />
          <mesh position={[x, 0.98, 0.68]} material={frame} castShadow><cylinderGeometry args={[0.045, 0.04, 0.46, 12]} /></mesh>
          {[-0.55, 0.6].map((z) => (
            <mesh key={z} position={[x * 0.9, 0.32, z]} rotation={[z > 0 ? 0.08 : -0.08, 0, 0]} material={frame} castShadow><cylinderGeometry args={[0.045, 0.03, 0.66, 12]} /></mesh>
          ))}
        </group>
      ))}
      <mesh position={[0, 0.6, 0.05]} material={frame} castShadow><boxGeometry args={[1.62, 0.08, 1.2]} /></mesh>
    </group>
  )
}

function Vases() {
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#3d3a2c', roughness: 0.7 }), [])
  const tall = useMemo(() => {
    const pts = [[0, 0], [0.22, 0], [0.27, 0.3], [0.3, 0.9], [0.24, 1.25], [0.12, 1.45], [0.11, 1.62], [0.14, 1.68], [0, 1.68]].map(([r, y]) => new THREE.Vector2(r, y))
    return new THREE.LatheGeometry(pts, 48)
  }, [])
  const round = useMemo(() => {
    const pts = [[0, 0], [0.25, 0.02], [0.42, 0.25], [0.43, 0.4], [0.3, 0.6], [0.14, 0.68], [0.14, 0.72], [0, 0.72]].map(([r, y]) => new THREE.Vector2(r, y))
    return new THREE.LatheGeometry(pts, 48)
  }, [])
  const twigs = useMemo(() => {
    let s = 11
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647
    const out = []
    function grow(p, dir, len, r, d) {
      if (d > 4) return
      const pts = [p.clone()]
      let q = p.clone(), v = dir.clone()
      for (let k = 0; k < 4; k++) {
        v.add(new THREE.Vector3((rnd() - 0.5) * 0.5, (rnd() - 0.3) * 0.3, (rnd() - 0.5) * 0.2)).normalize()
        q = q.clone().addScaledVector(v, len / 4); pts.push(q)
      }
      out.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, r, 5))
      const n = d < 2 ? 3 : 2
      for (let k = 0; k < n; k++) {
        const nd = v.clone().add(new THREE.Vector3((rnd() - 0.5) * 1.6, rnd() * 0.5, (rnd() - 0.5) * 0.4)).normalize()
        grow(q, nd, len * 0.65, r * 0.62, d + 1)
      }
    }
    grow(new THREE.Vector3(0, 1.6, 0), new THREE.Vector3(0.15, 1, 0).normalize(), 1.1, 0.02, 0)
    return out
  }, [])
  return (
    <group>
      <group position={[4.6, 0, -4.9]}>
        <mesh geometry={tall} material={mat} castShadow receiveShadow />
        {twigs.map((g, i) => <mesh key={i} geometry={g} castShadow><meshStandardMaterial color="#1c140c" roughness={0.9} /></mesh>)}
      </group>
      <mesh geometry={round} material={mat} position={[3.15, 0, -4.4]} castShadow receiveShadow />
    </group>
  )
}

function Room() {
  const rock = useMemo(() => makeRock(), [])
  const floorTex = useMemo(() => { const t = makeFloor(); t.repeat.set(3, 3); return t }, [])
  return (
    <group>
      <mesh position={[0, 4, -5.4]} receiveShadow>
        <planeGeometry args={[16, 9, 1, 1]} />
        <meshStandardMaterial map={rock.map} bumpMap={rock.bump} bumpScale={11} roughness={0.95} />
      </mesh>
      {/* 左の壁（影の中） */}
      <mesh position={[-5.2, 4, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[14, 9]} />
        <meshStandardMaterial color="#120c07" roughness={1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[24, 16]} />
        <meshStandardMaterial map={floorTex} color="#6e6a66" roughness={0.45} metalness={0} />
      </mesh>
    </group>
  )
}

function Lights() {
  const gobo = useMemo(() => makeGobo(), [])
  const spot = useRef(), low = useRef(), key = useRef()
  const { scene } = useThree()
  useEffect(() => {
    const s = spot.current
    s.target.position.set(2.1, 3.0, -5.4); scene.add(s.target)
    s.map = gobo
    low.current.target.position.set(1.1, 0, 0.3)
    key.current.target.position.set(LX, 1.9, LZ); scene.add(key.current.target); scene.add(low.current.target)
  }, [])
  return (
    <>
      <ambientLight intensity={0.05} color="#ffd9a8" />
      {/* 窓の光：左上の窓から奥の壁へ斜めに */}
      <spotLight ref={spot} position={[-3, 9, 4]} angle={0.4} penumbra={1} intensity={430} decay={2} color="#ecdcc8"
        castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} />
      {/* 胴のキー（左手前上・細い） */}
      <spotLight ref={key} position={[-3.5, 5.5, 4.5]} angle={0.3} penumbra={0.7} intensity={300} decay={2} color="#f2dcc0"
        castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} />
      {/* 床と彫刻の左面を照らす低い光（左手前） */}
      <spotLight ref={low} position={[-5, 3.2, 3.5]} angle={0.36} penumbra={1} intensity={900} decay={2} color="#e8dccd"
        castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004}  />
    </>
  )
}

function Rig() {
  const { camera, pointer } = useThree()
  useFrame(() => {
    camera.position.x += (pointer.x * 0.12 - camera.position.x) * 0.04
    camera.position.y += (1.75 + pointer.y * 0.06 - camera.position.y) * 0.04
    camera.lookAt(camera.position.x * 0.5, 1.75, 0)
  })
  return null
}

export default function Scene() {
  return (
    <>
      <color attach="background" args={['#020101']} />
      <Room />
      <Chair />
      <Vases />
      <Lamp />
      <Lights />
      <Rig />
      <EffectComposer multisampling={4}>
        <Bloom luminanceThreshold={0.55} luminanceSmoothing={0.3} intensity={0.55} radius={0.7} mipmapBlur />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        <Vignette eskil={false} offset={0.25} darkness={0.75} />
        <Noise premultiply blendFunction={BlendFunction.SOFT_LIGHT} opacity={0.12} />
      </EffectComposer>
    </>
  )
}
