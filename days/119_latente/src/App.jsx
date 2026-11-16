import React, { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import * as THREE from 'three'
import Scene from './Scene.jsx'

export default function App() {
  return (
    <div className="stage">
      <Canvas className="gl" shadows dpr={[1, 2]}
        camera={{ position: [0, 1.75, 6], fov: 40, near: 0.1, far: 60 }}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.0 }}>
        <Suspense fallback={null}><Scene /></Suspense>
      </Canvas>

      <nav className="nav l"><span className="burger"><i /><i /></span>Menu<span className="col">Collection <em>NEW</em></span></nav>
      <div className="logo">Velune</div>
      <nav className="nav r"><span>Eng <small>⌄</small></span><span>Cart&nbsp;&nbsp;( o )</span></nav>

      <h1 className="head" aria-label="Soft Hours">
        <span className="cap c1">S</span><span className="low l1">oft</span>
        <span className="cap c2">H</span><span className="low l2">ours</span>
      </h1>

      <div className="objects">Objects</div>
      <p className="lede">The evening had nearly settled. Then a piece arrived that asked you to clear the low shelf, dim the ceiling and pull a chair a little closer. It keeps its light turned inward, mostly.</p>
      <div className="clock">18:00</div>
      <div className="explore"><span>Explore</span></div>

      <a className="credit" href="../../">
        <b>3D Daily</b>
        <span className="t">Day 119 — The Lamp That Turns Its Light Inward</span>
        <span>A study after Latente. Brand and copy are fictional.</span>
      </a>
    </div>
  )
}
