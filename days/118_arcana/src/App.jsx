import React, { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'

export default function App() {
  return (
    <div className="stage">
      <Canvas className="gl" flat dpr={[1, 2]} gl={{ antialias: true, powerPreference: 'high-performance' }}
        camera={{ fov: 45, near: 0.1, far: 400, position: [0, 3.4, 11.2] }}>
        <Suspense fallback={null}><Scene /></Suspense>
      </Canvas>

      <div className="logo">sib<i>yl</i></div>
      <nav className="nav"><a>ABOUT</a><a>DECKS</a><a>CARDS</a><a>SHOP</a></nav>
      <div className="tog"><span>JP</span><span className="on">EN</span></div>
      <div className="set">
        <svg viewBox="0 0 12 12" fill="none" stroke="#D3CCE0" strokeWidth="1"><circle cx="6" cy="6" r="2.2" />{[0,1,2,3,4,5,6,7].map(i => { const a = i * Math.PI / 4; return <line key={i} x1={6 + Math.cos(a) * 3.6} y1={6 + Math.sin(a) * 3.6} x2={6 + Math.cos(a) * 5.4} y2={6 + Math.sin(a) * 5.4} /> })}</svg>
        SETTINGS
      </div>
      <a className="draw">Draw your card<svg viewBox="0 0 14 17" fill="none" stroke="#3A2460" strokeWidth="1.2"><path d="M0 1 H11 V16 M8 13 L11 16 L14 13" /></svg></a>
      <div className="glyph">7VQEL 2</div>
      <div className="tr">T<sub>r</sub></div>
      <div className="reticle" />
      <div className="orb" />

      <a className="credit" href="../../">
        <b>3D Daily</b>
        <span className="t">Day 118 — The Sphere That Spills into the Pond</span>
        <span>A study after ARCANA Tarot Worlds. Brand and copy are fictional.</span>
      </a>
    </div>
  )
}
