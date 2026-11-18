import React from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'

export default function App() {
  return (
    <div className="stage">
      <Canvas className="gl" dpr={[1, 2]} gl={{ antialias: false }} flat linear>
        <Scene />
      </Canvas>

      <header className="top">
        <div className="logo">The Late Hour Guild</div>
        <div className="rec"><i />Rec 00:00:09:03</div>
        <nav className="nav">
          <span>Objects</span><span>Manners</span><span>Rituals</span><span>Letters</span>
          <span className="off">Offering <b>0</b></span>
        </nav>
      </header>
      <div className="scene">SC. 01 / INT. PARLOUR / NIGHT</div>

      <h1 className="head">
        <span className="w">Welcome to the</span>
        <span className="u">Unfinished</span>
        <span className="e">Age</span>
      </h1>
      <p className="lede">Objects for the slow, deliberate habit. For people who have finished the paper and would still like something heavy to hold.</p>

      <div className="btns"><span className="b1">See the objects</span><span className="b2">Enter late</span></div>
      <div className="rule" />
      <div className="foot l">For adults who keep late hours</div>
      <div className="foot r">Scroll. It gets later.</div>

      <a className="credit" href="../../">
        <b>3D Daily</b>
        <span className="t">Day 120 — The Ashtray Printed in Halftone</span>
        <span>A study after The Sugar Coated Cult. Brand and copy are fictional.</span>
      </a>
    </div>
  )
}
