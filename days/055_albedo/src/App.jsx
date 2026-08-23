import React, { Suspense, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'
import { ALBEDO, PIECES } from './rig.js'

// 端の見当（トンボ）。灰一色の面に対して、位置を決めているのが
// 誰なのかを見せるためのもの。色は持たせない。
function Ticks({ side }) {
  return (
    <div className={`ticks ticks--${side}`}>
      {Array.from({ length: 25 }, (_, i) => (
        <i key={i} className={i % 5 === 0 ? 'long' : ''} />
      ))}
    </div>
  )
}

export default function App() {
  const [sel, setSel] = useState(5)
  const p = PIECES[sel]

  return (
    <div className="stage">
      <Canvas
        shadows
        dpr={[1, 2]}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        camera={{ position: [0, 17, 1.3], fov: 24, near: 0.1, far: 80 }}
      >
        <Suspense fallback={null}>
          <Scene sel={sel} setSel={setSel} />
        </Suspense>
      </Canvas>

      <div className="ui">
        <header>
          <h1>
            Albedo
            <br />
            Lock
          </h1>
          <div className="meta">
            <span>DAY 055</span>
            <span>2026.08.24</span>
            <span>AFTER CLEND</span>
          </div>
        </header>

        <Ticks side="left" />
        <Ticks side="right" />

        <footer>
          <p>
            Ground and subject are painted with one and the same albedo — {ALBEDO}. Nothing in this
            frame owns a colour. What reads as form is only the light coming back. Roughness is the
            one property a piece is allowed to keep for itself. Nothing here moves except the light.
          </p>
          <div className="sel">
            <b>
              <span className="dot" />
              {p.code} {p.name}
            </b>
            <span className="sub">
              OPERABLE · ROUGHNESS {p.rough.toFixed(2)}
            </span>
          </div>
        </footer>
      </div>
    </div>
  )
}
