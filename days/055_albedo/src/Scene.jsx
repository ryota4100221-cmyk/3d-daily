import React, { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Environment, Lightformer } from '@react-three/drei'
import * as THREE from 'three'
import { ACCENT, ALBEDO, PIECES, bracketBars, lightPlan, makeGrain } from './rig.js'

// 真上からの静物。カメラは 4.4° だけ手前に倒してあり、これがないと
// 立っている CAP がただの円になって、厚みの情報が1つも残らない。
function Camera() {
  const { camera } = useThree()
  camera.position.set(0, 17, 1.3)
  camera.lookAt(0, 0, 0.05)
  camera.updateProjectionMatrix()
  return null
}

function Geometry({ p }) {
  switch (p.kind) {
    case 'capsule':
      return <capsuleGeometry args={[p.rad, p.len, 12, 32]} />
    case 'torus':
      return <torusGeometry args={[p.rad, p.tube, 24, 96]} />
    case 'cyl':
      return <cylinderGeometry args={[p.rad, p.rad, p.h, 96]} />
    case 'sphere':
    case 'blob':
      return <sphereGeometry args={[p.rad, 72, 52]} />
    default:
      return <boxGeometry args={[p.w, p.h, p.d]} />
  }
}

// 全パーツが同じ色を指す。ここに色を渡す口は1つしかない。
function Piece({ p, onHover }) {
  return (
    <mesh
      castShadow
      receiveShadow
      position={p.pos}
      rotation={p.rot}
      scale={p.scl || 1}
      onPointerOver={(e) => {
        e.stopPropagation()
        onHover()
      }}
    >
      <Geometry p={p} />
      <meshPhysicalMaterial
        color={ALBEDO}
        roughness={p.rough}
        metalness={0}
        clearcoat={0.34}
        clearcoatRoughness={0.35}
        envMapIntensity={1.15}
      />
    </mesh>
  )
}

// key の面光源は2つの仕事をする。環境マップに焼かれて「反射のかたち」になり、
// 同じ座標に置いた平行光が「落ちる影」になる。光源が1つなので、
// ハイライトの向きと影の向きが最後まで食い違わない。
function KeyShadow() {
  const dir = useRef()
  useFrame(({ clock }) => {
    const L = lightPlan(clock.elapsedTime)
    dir.current?.position.set(L.key[0], L.key[1], L.key[2])
  })
  const L0 = lightPlan(0)
  return (
    <directionalLight
      ref={dir}
      castShadow
      position={L0.key}
      intensity={0.42}
      shadow-mapSize={[2048, 2048]}
      shadow-camera-left={-8}
      shadow-camera-right={8}
      shadow-camera-top={6}
      shadow-camera-bottom={-6}
      shadow-camera-near={0.5}
      shadow-camera-far={26}
      shadow-bias={-0.0006}
      shadow-normalBias={0.02}
    />
  )
}

function Lights() {
  const key = useRef()
  const edge = useRef()
  const sweep = useRef()

  useFrame(({ clock }) => {
    const L = lightPlan(clock.elapsedTime)
    key.current?.position.fromArray(L.key)
    key.current?.lookAt(0, 0, 0)
    edge.current?.position.fromArray(L.edge)
    edge.current?.lookAt(0, 0, 0)
    sweep.current?.position.fromArray(L.sweep)
    sweep.current?.lookAt(0, 0, 0)
  })

  const L0 = lightPlan(0)
  return (
    <Environment resolution={256} frames={Infinity}>
      <color attach="background" args={['#171615']} />
      <Lightformer ref={key} form="rect" intensity={3.0} position={L0.key} scale={[10.5, 2.2, 1]} />
      <Lightformer ref={edge} form="rect" intensity={1.7} position={L0.edge} scale={[1.4, 6.5, 1]} />
      <Lightformer ref={sweep} form="rect" intensity={1.4} position={L0.sweep} scale={[7.0, 0.8, 1]} />
      <Lightformer form="rect" intensity={0.03} position={L0.fill} scale={[26, 26, 1]} rotation-x={Math.PI / 2} />
    </Environment>
  )
}

// 触れる場所のしるし。この4隅だけが色を持っている。
function Bracket({ p }) {
  const bars = useMemo(() => bracketBars(p), [p])
  return (
    <group>
      {bars.map((b, i) => (
        <mesh key={i} position={b.pos} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[b.size[0], b.size[1]]} />
          <meshBasicMaterial color={ACCENT} toneMapped={false} />
        </mesh>
      ))}
    </group>
  )
}

export default function Scene({ sel, setSel }) {
  const grain = useMemo(() => makeGrain(), [])

  return (
    <>
      <Camera />
      <Lights />
      <KeyShadow />

      {/* 地。物とまったく同じ色を指している */}
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]}>
        <planeGeometry args={[60, 60]} />
        <meshStandardMaterial
          color={ALBEDO}
          roughness={0.92}
          roughnessMap={grain}
          metalness={0}
          envMapIntensity={0.45}
        />
      </mesh>

      {PIECES.map((p, i) => (
        <Piece key={p.code} p={p} onHover={() => setSel(i)} />
      ))}

      <Bracket p={PIECES[sel]} />

      <fog attach="fog" args={[new THREE.Color(ALBEDO), 30, 72]} />
    </>
  )
}
