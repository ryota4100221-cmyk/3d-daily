import { useState } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'

export default function App() {
  const [state, setState] = useState('flowing')

  return (
    <>
      <Canvas
        flat
        dpr={[1, 2]}
        orthographic
        camera={{ position: [0, 0, 1], zoom: 1 }}
        gl={{ antialias: false, alpha: false }}
      >
        <color attach="background" args={['#ece7dd']} />
        <Scene onState={setState} />
      </Canvas>

      <div className="overlay">
        <div className="hud-top">
          <div className="mark">3D&nbsp;Daily</div>
          <div className="day">Day&nbsp;020 · ★★★★</div>
        </div>

        <div className="legend">
          <div className="row"><b>advect</b> — semi-lagrangian</div>
          <div className="row"><b>curl</b> — divergence-free flow</div>
          <div className="row"><b>ping-pong</b> — stateful FBO</div>
        </div>

        <div className="hud-title">
          <div className="eyebrow">Week 3 · Shaders</div>
          <h1>
            Ink<em>.</em>
          </h1>
          <p>
            Not a picture recomputed each frame — a fluid that <em>remembers</em>.
            Two float buffers ping-pong an ink density through advect · diffuse ·
            dissipate: every texel backtraces where the flow came from, so a
            divergence-free curl field folds the ink into sumi-nagashi marbling.
            The cursor is a brush — its splat seeds pigment and its velocity is
            added to the flow, dragging a real wake through the field. Terracotta
            marks the wet front where fresh ink still burns.
          </p>
        </div>

        <div className="hud-hint">
          <span className="now">
            <span className="k">{state}</span>
          </span>
          <span>Move — <span className="k">stir the ink</span></span>
        </div>
      </div>
    </>
  )
}
