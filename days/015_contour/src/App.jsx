import { useState } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'

export default function App() {
  const [state, setState] = useState('flow')

  return (
    <>
      <Canvas
        flat
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: false }}
        camera={{ position: [0, 0, 1], fov: 40 }}
      >
        <Scene onState={setState} />
      </Canvas>

      <div className="overlay">
        <div className="hud-top">
          <div className="mark">3D&nbsp;Daily</div>
          <div className="day">Day&nbsp;015 · ★★★</div>
        </div>

        <div className="legend">
          <div className="row"><b>drei</b> — shaderMaterial</div>
          <div className="row"><b>field</b> — uv · fBm</div>
          <div className="row"><b>lines</b> — isolines</div>
        </div>

        <div className="hud-title">
          <div className="eyebrow">Week 3 · Shaders</div>
          <h1>
            Contour<em>.</em>
          </h1>
          <p>
            A single fragment shader draws a topographic map of noise onto paper —
            anti-aliased isolines that drift like a slow tide. No geometry, no
            lights: every pixel is math. Move the cursor and the terrain parts and
            warms around it, then eases back the moment you leave.
          </p>
        </div>

        <div className="hud-hint">
          <span className="now">
            <span className="k">{state}</span>
          </span>
          <span>Move — <span className="k">warp</span></span>
        </div>
      </div>
    </>
  )
}
