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
        camera={{ position: [0, 0.15, 4.2], fov: 38 }}
      >
        <color attach="background" args={['#ece7dd']} />
        <Scene onState={setState} />
      </Canvas>

      <div className="overlay">
        <div className="hud-top">
          <div className="mark">3D&nbsp;Daily</div>
          <div className="day">Day&nbsp;016 · ★★★★</div>
        </div>

        <div className="legend">
          <div className="row"><b>vertex</b> — displacement</div>
          <div className="row"><b>normals</b> — analytic</div>
          <div className="row"><b>lines</b> — on surface</div>
        </div>

        <div className="hud-title">
          <div className="eyebrow">Week 3 · Shaders</div>
          <h1>
            Relief<em>.</em>
          </h1>
          <p>
            The terrain is no longer faked — every vertex of the plane moves. A
            sin-and-noise height field displaces the mesh in the vertex shader,
            and fresh normals are derived in-shader so the crests truly catch the
            light. Move the cursor and the ground swells and warms beneath it.
          </p>
        </div>

        <div className="hud-hint">
          <span className="now">
            <span className="k">{state}</span>
          </span>
          <span>Move — <span className="k">swell</span></span>
        </div>
      </div>
    </>
  )
}
