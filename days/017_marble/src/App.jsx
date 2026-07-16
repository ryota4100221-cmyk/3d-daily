import { useState } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'

export default function App() {
  const [state, setState] = useState('drift')

  return (
    <>
      <Canvas
        flat
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: false }}
      >
        <color attach="background" args={['#ece7dd']} />
        <Scene onState={setState} />
      </Canvas>

      <div className="overlay">
        <div className="hud-top">
          <div className="mark">3D&nbsp;Daily</div>
          <div className="day">Day&nbsp;017 · ★★★★</div>
        </div>

        <div className="legend">
          <div className="row"><b>simplex</b> — with derivatives</div>
          <div className="row"><b>fbm</b> — slope-eroded</div>
          <div className="row"><b>warp</b> — domain feedback</div>
        </div>

        <div className="hud-title">
          <div className="eyebrow">Week 3 · Shaders</div>
          <h1>
            Marble<em>.</em>
          </h1>
          <p>
            One fragment shader, no geometry. True simplex noise returns its
            own gradient, so the field erodes along its slopes and folds back
            through itself twice — noise becomes flowing marble. The same
            gradient embosses the flat plane into relief. Move the cursor to
            stir the veins and warm them.
          </p>
        </div>

        <div className="hud-hint">
          <span className="now">
            <span className="k">{state}</span>
          </span>
          <span>Move — <span className="k">stir</span></span>
        </div>
      </div>
    </>
  )
}
