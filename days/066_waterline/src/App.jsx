import React from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'
import { ETA } from './rig.js'

// 文字は3D側に一切入れない（troika が落ちると Scene ごと消えるため）。
// 版面は空の側にだけ置く。海の側に置くのは、いちばん下の1行だけ。
export default function App() {
  return (
    <div className="stage">
      <Canvas
        dpr={1}
        gl={{ antialias: true }}
        camera={{ position: [0.45, 1.3, 2.7], fov: 30, near: 0.1, far: 400 }}
      >
        <Scene />
      </Canvas>

      <div className="hud">
        <header className="tl">
          <h1>
            THE
            <br />
            WATERLINE
          </h1>
          <p className="lede">one plane, two readings</p>
        </header>

        <div className="tr">
          <dl>
            <dt>Source</dt>
            <dd>DENTSU INC. RECRUITING 2026</dd>
            <dt>Device</dt>
            <dd>apparent depth</dd>
            <dt>Rule</dt>
            <dd>d&prime; = d &divide; {ETA.toFixed(2)}</dd>
          </dl>
        </div>

        <footer className="bl">
          <span className="k">Day 066</span>
          <span className="v">
            No water surface is drawn. The sea is a region of colour, not a plane &mdash; the only
            evidence of it is that a body crossing the line goes short, sideways and pale.
          </span>
        </footer>

        <div className="br">3D&nbsp;DAILY</div>
      </div>
    </div>
  )
}
