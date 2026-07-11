import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'

export default function App() {
  return (
    <>
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: false }}
        camera={{ position: [0, 6.2, 13.5], fov: 38, near: 0.1, far: 120 }}
      >
        <Scene />
      </Canvas>

      <div className="overlay">
        <div className="hud-top">
          <div className="mark">3D&nbsp;Daily</div>
          <div className="day">Day&nbsp;012 · ★★★</div>
        </div>

        <div className="hud-title">
          <h1>
            Drift<em>.</em>
          </h1>
          <p>
            Forty thousand particles, one curl-noise current. Move the cursor to
            part the field; press to lift it.
          </p>
        </div>

        <div className="hud-hint">
          <span>Move — <span className="k">disturb</span></span>
          <span>Hold — <span className="k">updraft</span></span>
        </div>
      </div>
    </>
  )
}
