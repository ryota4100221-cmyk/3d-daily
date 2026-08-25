import { useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene, { SKY } from './Scene.jsx'

// 再現元の組み方だけ借りる：1書体・全大文字・5段のスケール（134 / 64 / 40 / 32 / 24）・
// 見出し字間 -2.5%・左揃えの多段グリッド。文言は借りない。
export default function App() {
  const refs = {
    arrived: useRef(null),
    visible: useRef(null),
    sigma: useRef(null),
    fix: useRef(null),
    radii: useRef(null),
    epoch: useRef(null),
  }

  return (
    <div className="page">
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: false }}
        camera={{ fov: 33, near: 0.1, far: 40 }}
        onCreated={({ gl }) => gl.setClearColor(SKY, 1)}
      >
        <Scene refs={refs} />
      </Canvas>

      <div className="ui">
        <header className="head">
          <p className="kicker">Day 057 · Range Circle · Satellite Timekeeping</p>
          <h1>
            Where the
            <br />
            circles cross
          </h1>
          <p className="lede">
            Nothing in this scene stores the position. Four wavefronts leave at the same instant and
            spread at the same rate; each one stops when it arrives. The place is whatever point all
            four happen to pass through.
          </p>
        </header>

        <div className="tr">
          <dl>
            <dt>SV in view</dt>
            <dd ref={refs.visible}>—</dd>
            <dt>Arrived</dt>
            <dd ref={refs.arrived}>—</dd>
            <dt>Epoch</dt>
            <dd ref={refs.epoch}>—</dd>
          </dl>
        </div>

        <div className="bl">
          <span className="lbl">Residual σ</span>
          <span className="val big" ref={refs.sigma}>
            —
          </span>
          <span className="lbl">Solved position</span>
          <span className="val" ref={refs.fix}>
            —
          </span>
        </div>

        <div className="br">
          <span className="lbl">Range · km</span>
          <span className="val" ref={refs.radii}>
            —
          </span>
        </div>
      </div>
    </div>
  )
}
