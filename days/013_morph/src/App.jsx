import { useState } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'

export default function App() {
  const [form, setForm] = useState('Sphere')

  return (
    <>
      <Canvas
        shadows
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: false }}
        camera={{ position: [0, 1.05, 6.6], fov: 32, near: 0.1, far: 100 }}
      >
        <Scene onForm={setForm} />
      </Canvas>

      <div className="overlay">
        <div className="hud-top">
          <div className="mark">3D&nbsp;Daily</div>
          <div className="day">Day&nbsp;013 · ★★★</div>
        </div>

        <div className="hud-title">
          <h1>
            Morph<em>.</em>
          </h1>
          <p>
            One body, five forms. A single icosphere carries morph targets; its
            influences are damped from shape to shape, so geometry — and its
            lighting — never stops interpolating.
          </p>
        </div>

        <div className="hud-hint">
          <span className="now">
            <span className="k">{form}</span>
          </span>
          <span>Move — <span className="k">parallax</span></span>
        </div>
      </div>
    </>
  )
}
