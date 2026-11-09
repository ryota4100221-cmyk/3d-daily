import { Suspense, useEffect, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import * as THREE from 'three'
import Scene, { FOV } from './Scene.jsx'

function Mark() {
  // 架空のロゴ：8 本の放射（長さ違い）
  const L = [15, 9, 14, 8, 15, 10, 13, 8]
  return (
    <svg width="34" height="36" viewBox="-17 -18 34 36" aria-hidden="true">
      {L.map((l, i) => {
        const a = (i / L.length) * Math.PI * 2 + 0.2
        return <line key={i} x1={Math.cos(a) * 3} y1={Math.sin(a) * 3} x2={Math.cos(a) * l} y2={Math.sin(a) * l} stroke="#fff" strokeWidth="2.6" strokeLinecap="butt" />
      })}
    </svg>
  )
}

export default function App() {
  const pointer = useRef([0, 0])
  useEffect(() => {
    const onMove = (e) => {
      pointer.current = [(e.clientX / window.innerWidth) * 2 - 1, -((e.clientY / window.innerHeight) * 2 - 1)]
    }
    window.addEventListener('pointermove', onMove)
    return () => window.removeEventListener('pointermove', onMove)
  }, [])
  const lines = ['交差せよ。', '新しい火が灯る', '始動だ。']
  return (
    <div className="stage">
      <h1 className="sr">{lines.join('')}</h1>
      <Canvas
        className="gl"
        dpr={[1, 2]}
        camera={{ position: [0, 0, 0], fov: FOV, near: 0.01, far: 2000 }}
        gl={{ antialias: true, alpha: true, toneMapping: THREE.NoToneMapping }}
        onCreated={({ camera, gl }) => { camera.lookAt(0, 0, -1); gl.setClearColor(0x000000, 0) }}
      >
        <Suspense fallback={null}>
          <Scene pointer={pointer} />
        </Suspense>
      </Canvas>
      <div className="fade" aria-hidden="true" />

      <header className="nav">
        <div className="logo"><Mark /><span>ARC-iLAB</span></div>
        <nav className="pill">
          <a>ABOUT ARC</a><a>WHAT WE DO</a><a>TEAMS</a><a>TOPICS</a>
        </nav>
        <a className="join">Join ARC</a>
        <a className="lang">EN</a>
      </header>

      <a className="cta"><i className="sh1" /><i className="sh2" /><i className="tab" /><span>Join ARC →</span></a>

      <footer className="foot">
        <span>The Origin</span><span>of Hard Science</span><span>Ventures.</span>
      </footer>

      <a className="credit" href="../../">
        <b>3D Daily</b>
        <span className="t">Day 116 — Where the Rays Converge</span>
        <span>A study after ECC-iCAP. Brand and copy are fictional.</span>
      </a>
    </div>
  )
}
