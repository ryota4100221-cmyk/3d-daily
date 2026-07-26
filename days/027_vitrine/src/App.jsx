import { useState } from 'react'
import { Canvas } from '@react-three/fiber'
import Gallery from './Gallery.jsx'
import { PLATES } from './plates.js'

export default function App() {
  const [active, setActive] = useState(0)
  const plate = PLATES[active] ?? PLATES[0]

  return (
    <div className="app">
      <Canvas
        flat
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: false }}
        camera={{ position: [0, 0, 9], fov: 30, near: 0.1, far: 60 }}
      >
        {/* direct child of the scene — attaching background inside a <group>
            silently does nothing (Day 026) */}
        <color attach="background" args={['#ede7da']} />
        <Gallery onActive={setActive} />
      </Canvas>

      <div className="ui">
        <header className="top">
          <div className="mark">3D · DAILY</div>
          <div className="day">DAY 027</div>
        </header>

        <div className="bottom">
          <div className="lead">
            <h1>VITRINE</h1>
            <p className="sub">
              An infinite circular gallery — one number drives the whole room.
            </p>
          </div>

          <footer className="bot">
            <div className="meta">
              <span>WEEK 04 — AWWWARDS RE-CONSTRUCTION</span>
              <span>CANVAS TEXTURE · ARC LAYOUT · VELOCITY DISTORTION</span>
            </div>

            <div className="readout">
              <div className="now">
                <span className="idx">
                  N° {String(active + 1).padStart(2, '0')}
                </span>
                <span className="ttl">{plate.title}</span>
              </div>
              <div className="rail">
                {PLATES.map((p, i) => (
                  <i key={p.title} className={i === active ? 'on' : ''} />
                ))}
              </div>
            </div>
          </footer>
        </div>

        <div className="hint">DRAG · SCROLL — IT NEVER ENDS</div>
      </div>
    </div>
  )
}
