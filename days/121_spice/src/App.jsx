import React from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'

export default function App() {
  return (
    <div className="stage">
      <Canvas className="gl" dpr={[1, 2]} shadows flat gl={{ antialias: true }} camera={{ fov: 30, position: [0, 0, 10], near: 2, far: 30 }}>
        <Scene />
      </Canvas>

      <header className="top">
        <nav className="nav">
          <span>Home</span><i /><span>Gossip Pages</span><i /><span>Our Story</span><i /><span>Press</span><i /><span>Contact Us</span>
        </nav>
        <div className="logo">
          <span className="l1">Beatrix</span>
          <span className="l2"><em>snack loud</em><b>Swore</b><em>stay hot</em></span>
        </div>
        <div className="cta">Our Snacks</div>
        <div className="search"><svg viewBox="0 0 24 24" width="24" height="24"><circle cx="10.5" cy="10.5" r="7.5" fill="none" stroke="#2a2522" strokeWidth="1.8" /><path d="M16 16 L21.5 21.5" stroke="#2a2522" strokeWidth="1.8" strokeLinecap="round" /></svg></div>
      </header>

      <a className="credit" href="../../">
        <b>3D Daily</b>
        <span className="t">Day 121 — The Snack That Wears Its Sunglasses</span>
        <span>A study after Henrietta Said. Brand and copy are fictional.</span>
      </a>
    </div>
  )
}
