import { useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'

// カードの写真の代わり：明るい窓の部屋・明るい木の床・天井のスポット・画面の中の黄色い立方体・長机を囲む人の影
function floorTex() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 512
  const g = c.getContext('2d')
  for (let i = 0; i < 16; i++) {
    const l = 70 + Math.random() * 8
    g.fillStyle = `hsl(32, 48%, ${l - 10}%)`; g.fillRect(i * 32, 0, 32, 512)
    g.fillStyle = 'rgba(90,60,30,.18)'; g.fillRect(i * 32, 0, 1, 512)
    for (let k = 0; k < 3; k++) { const y = Math.random() * 512; g.fillRect(i * 32, y, 32, 1) }
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 3); t.colorSpace = THREE.SRGBColorSpace
  return t
}
function screenTex() {
  const c = document.createElement('canvas'); c.width = 320; c.height = 180
  const g = c.getContext('2d')
  g.fillStyle = '#f7f6f1'; g.fillRect(0, 0, 320, 180)
  g.fillStyle = '#ffe600'
  g.beginPath(); g.moveTo(150, 30); g.lineTo(250, 70); g.lineTo(235, 160); g.lineTo(120, 175); g.lineTo(95, 70); g.closePath(); g.fill()
  g.fillStyle = '#f5cf00'; g.beginPath(); g.moveTo(170, 95); g.lineTo(250, 70); g.lineTo(235, 160); g.lineTo(170, 170); g.fill()
  g.fillStyle = '#333'; g.fillRect(30, 70, 50, 7); g.fillRect(30, 84, 40, 7)
  g.fillStyle = '#fff'; g.fillRect(230, 120, 70, 45)
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace
  return t
}

function Person({ p, ry = 0, shirt = '#222', sit = true }) {
  return (
    <group position={p} rotation-y={ry}>
      <mesh position={[0, sit ? 0.95 : 1.2, 0]}><capsuleGeometry args={[0.17, sit ? 0.36 : 0.8, 4, 10]} /><meshStandardMaterial color={shirt} roughness={0.9} /></mesh>
      <mesh position={[0, sit ? 1.38 : 1.86, 0]}><sphereGeometry args={[0.11, 14, 10]} /><meshStandardMaterial color="#d9b49a" roughness={0.8} /></mesh>
      <mesh position={[0, sit ? 1.43 : 1.91, -0.02]}><sphereGeometry args={[0.112, 14, 10, 0, Math.PI * 2, 0, 1.4]} /><meshStandardMaterial color="#1a1612" /></mesh>
      {sit && <mesh position={[0, 0.5, 0.2]}><boxGeometry args={[0.3, 0.12, 0.45]} /><meshStandardMaterial color="#2a2a2a" /></mesh>}
    </group>
  )
}

export default function Room() {
  const { camera } = useThree()
  useMemo(() => { camera.position.set(-1.2, 2.3, 4.6); camera.lookAt(0.6, 1.1, -1.5); camera.fov = 48; camera.updateProjectionMatrix() }, [camera])
  const fl = useMemo(floorTex, []), sc = useMemo(screenTex, [])
  const tables = [[-0.7, 0.6], [1.2, 0.2]]
  return (
    <group>
      <color attach="background" args={['#f3efe6']} />
      <hemisphereLight args={['#fff6e8', '#b58a5a', 1.7]} />
      <directionalLight position={[3, 5, -4]} intensity={1.5} color="#fff1dc" />
      <directionalLight position={[-2, 4, 3]} intensity={0.6} />
      <mesh rotation-x={-Math.PI / 2}><planeGeometry args={[14, 14]} /><meshStandardMaterial map={fl} roughness={0.55} /></mesh>
      {/* 奥の窓（明るい）と柱 */}
      <mesh position={[0, 2, -3.2]}><planeGeometry args={[14, 4]} /><meshBasicMaterial color="#fbfbf8" /></mesh>
      {[-3, -1.6, -0.2, 2.6].map((x, i) => <mesh key={i} position={[x, 2, -3.1]}><boxGeometry args={[0.08, 4, 0.08]} /><meshStandardMaterial color="#9a9a96" /></mesh>)}
      <mesh position={[-2.6, 1.2, -3.15]}><planeGeometry args={[2.4, 1.6]} /><meshBasicMaterial color="#b9c7a6" /></mesh>
      <mesh position={[2.3, 2, -2.2]}><boxGeometry args={[1.2, 4, 1.6]} /><meshStandardMaterial color="#f4f4f1" /></mesh>
      {/* 天井の黒い格子とスポット */}
      <mesh position={[0, 3.3, 0]} rotation-x={Math.PI / 2}><planeGeometry args={[14, 14]} /><meshStandardMaterial color="#b4b4b0" side={THREE.DoubleSide} /></mesh>
      {[-2.2, -1.2, -0.2, 0.8].map((z, i) => <mesh key={i} position={[-0.8 - i * 0.15, 3.05, z]} rotation-x={0.6}><cylinderGeometry args={[0.07, 0.07, 0.28, 10]} /><meshStandardMaterial color="#111" /></mesh>)}
      {/* 左の棚と本 */}
      <mesh position={[-2.4, 0.95, -1.6]}><boxGeometry args={[1.8, 0.04, 0.4]} /><meshStandardMaterial color="#e8e4dc" /></mesh>
      {Array.from({ length: 14 }).map((_, i) => <mesh key={i} position={[-3.2 + i * 0.12, 1.1, -1.6]}><boxGeometry args={[0.09, 0.28 + (i % 3) * 0.04, 0.3]} /><meshStandardMaterial color={['#c8452c', '#e3a83b', '#e8e2d2', '#3b6e8f', '#d26b3d'][i % 5]} /></mesh>)}
      <mesh position={[-2.4, 0.5, -1.55]}><boxGeometry args={[1.8, 0.9, 0.3]} /><meshStandardMaterial color="#e07a2e" /></mesh>
      {/* 画面 */}
      <group position={[0.9, 0, -1.8]} rotation-y={-0.15}>
        <mesh position={[0, 1.75, 0]}><boxGeometry args={[1.9, 1.12, 0.06]} /><meshStandardMaterial color="#2b2b2b" /></mesh>
        <mesh position={[0, 1.75, 0.035]}><planeGeometry args={[1.82, 1.04]} /><meshBasicMaterial map={sc} toneMapped={false} /></mesh>
        <mesh position={[0, 0.6, -0.05]}><boxGeometry args={[0.12, 1.2, 0.08]} /><meshStandardMaterial color="#222" /></mesh>
      </group>
      {/* 長机と人 */}
      {tables.map(([x, z], i) => (
        <group key={i} position={[x, 0, z]} rotation-y={0.35}>
          <mesh position={[0, 0.74, 0]}><boxGeometry args={[0.9, 0.04, 2.6]} /><meshStandardMaterial color="#e9dcc6" /></mesh>
          {[[-0.4, -1.2], [0.4, -1.2], [-0.4, 1.2], [0.4, 1.2]].map(([a, b], j) => <mesh key={j} position={[a, 0.37, b]}><boxGeometry args={[0.035, 0.74, 0.035]} /><meshStandardMaterial color="#222" /></mesh>)}
          <mesh position={[0.1, 0.8, -0.4]} rotation-x={-0.2}><boxGeometry args={[0.32, 0.01, 0.22]} /><meshStandardMaterial color="#c9c9cb" /></mesh>
        </group>
      ))}
      <Person p={[-1.35, 0, 0.9]} ry={1.6} shirt="#1f2125" />
      <Person p={[-1.25, 0, 0.1]} ry={1.5} shirt="#e8e6e0" />
      <Person p={[-1.1, 0, -0.6]} ry={1.4} shirt="#2b2d33" />
      <Person p={[1.85, 0, 0.6]} ry={-1.4} shirt="#efe7d6" />
      <Person p={[1.75, 0, -0.3]} ry={-1.5} shirt="#1b1b1b" />
      <Person p={[-0.2, 0, -0.9]} ry={0.2} shirt="#3c4a5c" />
      <Person p={[1.95, 0, 1.4]} ry={-1.7} shirt="#d9cdb8" />
      <Person p={[-1.45, 0, 1.7]} ry={1.6} shirt="#111" />
    </group>
  )
}
