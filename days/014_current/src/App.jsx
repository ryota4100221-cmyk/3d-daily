import { useState } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'

export default function App() {
  const [state, setState] = useState('drift')

  return (
    <>
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: false }}
        camera={{ position: [0, 6.4, 8.6], fov: 30, near: 0.1, far: 120 }}
      >
        <Scene onState={setState} />
      </Canvas>

      <div className="overlay">
        <div className="hud-top">
          <div className="mark">3D&nbsp;Daily</div>
          <div className="day">Day&nbsp;014 · ★★★</div>
        </div>

        <div className="legend">
          <div className="row"><b>flow</b> — curl noise</div>
          <div className="row"><b>vortex</b> — pointer</div>
          <div className="row"><b>ease</b> — damped</div>
        </div>

        <div className="hud-title">
          <div className="eyebrow">Week 2 · Capstone</div>
          <h1>
            Current<em>.</em>
          </h1>
          <p>
            Two thousand blades bow to a divergence-free curl field that drifts
            like water. Move the cursor and the current curls into a vortex —
            everything leans, warms, and eases back the instant you leave.
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
