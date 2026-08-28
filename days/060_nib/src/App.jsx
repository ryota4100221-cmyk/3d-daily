import { useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'

export default function App() {
  const readout = { nib: useRef(null), contrast: useRef(null) }

  return (
    <div className="stage">
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: false }}
        camera={{ fov: 30, position: [0, 0.02, 7.5], near: 0.1, far: 60 }}
      >
        <Scene readout={readout} />
      </Canvas>

      <header className="ui tl">
        <span className="mark">3D DAILY</span>
        <span className="dim">DAY 060</span>
      </header>

      <div className="ui tr">
        <span className="dim">AFTER</span>
        <span className="mark">CREDIT SAISON TYPEFACE</span>
      </div>

      <div className="ui bl">
        <h1>THE NIB ANGLE</h1>
        <p>
          A geometric sans has no outline. It has a skeleton — arcs and segments — and one pen.
          Stroke weight is <em>|sin(φ − θ)|</em>: the angle between the path and the nib. Turn the
          nib and SAISON&nbsp;Sans becomes SAISON&nbsp;Sans&nbsp;Advance.
        </p>
      </div>

      <div className="ui br">
        <div className="row">
          <span className="dim">NIB</span>
          <span className="num" ref={readout.nib}>
            ---°
          </span>
        </div>
        <div className="row">
          <span className="dim">CONTRAST</span>
          <span className="num" ref={readout.contrast}>
            --%
          </span>
        </div>
        <span className="dim hint">MOVE THE POINTER</span>
      </div>
    </div>
  )
}
