import { Suspense, useEffect, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { EffectComposer, Bloom } from '@react-three/postprocessing'
import { HalfFloatType } from 'three'
import Backdrop from './Backdrop.jsx'
import Satellite from './Satellite.jsx'

// 架空のマーク：青い2枚の羽根（再現元の3本の山形とは別の形）
function Mark() {
  return (
    <svg className="mark" width="52" height="50" viewBox="0 0 52 50">
      <path d="M4 30 L30 30 L22 40 L-0 40 Z" transform="translate(4 0)" fill="#1E8BF0" />
      <path d="M8 18 L36 18 L28 28 L2 28 Z" transform="translate(4 0)" fill="#1466C8" />
      <path d="M40 4 L46 10 L30 36 L26 30 Z" fill="#1E8BF0" />
    </svg>
  )
}

export default function App() {
  const pointer = useMemo(() => ({ x: 0, y: 0 }), [])
  useEffect(() => {
    const onMove = (e) => {
      pointer.x = (e.clientX / innerWidth) * 2 - 1
      pointer.y = (e.clientY / innerHeight) * 2 - 1
    }
    addEventListener('pointermove', onMove)
    return () => removeEventListener('pointermove', onMove)
  }, [])

  return (
    <div className="stage">
      <Canvas className="gl" flat dpr={[1, 2]} gl={{ antialias: false }} camera={{ fov: 30, position: [0, 0, 20], near: 1, far: 100 }}>
        <Backdrop />
        <Suspense fallback={null}>
          <Satellite pointer={pointer} />
        </Suspense>
        <EffectComposer multisampling={4} frameBufferType={HalfFloatType}>
          <Bloom luminanceThreshold={0.4} luminanceSmoothing={0.25} intensity={0.6} mipmapBlur radius={0.5} />
        </EffectComposer>
      </Canvas>

      <header className="nav">
        <Mark />
        <nav className="links"><span>Missions</span><span>Spacecraft</span><span>Careers</span></nav>
        <span className="contact">Contact</span>
        <span className="burger"><i /><i /></span>
      </header>

      <div className="hero">
        <p className="kicker">ONE PRICE. A CLEAR PATH TO ORBIT</p>
        <h1>LAUNCH WINDOWS<br />HELD STEADY</h1>
      </div>

      <div className="cta"><span>PLAN YOUR FLIGHT</span><i>
        <svg width="26" height="26" viewBox="0 0 26 26"><path d="M5 21 L21 5 M8 5 H21 V18" stroke="#c9ced6" strokeWidth="1.6" fill="none" /></svg>
      </i></div>

      <a className="credit" href="../../">
        <b>3D Daily</b>
        <span className="t">Day 111 — Drawn in Its Own Edges</span>
        <span>A study after EnduroSat. Brand and copy are fictional.</span>
      </a>
    </div>
  )
}
