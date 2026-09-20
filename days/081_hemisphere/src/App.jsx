import { useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene, { BG, MASK_DEG } from './Scene.jsx'
import { HORIZON, FULLSKY, CONST } from './rig.js'

// A fixed epoch can be pinned with ?t=<hours> so a capture is reproducible;
// without it the constellation just runs.
const qs = new URLSearchParams(location.search)
const FIXED = qs.has('t') ? Number(qs.get('t')) : null

function Row({ k, kref, sink, lit }) {
  return (
    <div className={'row' + (lit ? ' lit' : '')}>
      <span className="k">{k}</span>
      <span
        className="v"
        ref={(el) => {
          if (sink.current) sink.current[kref] = el
        }}
      >
        —
      </span>
    </div>
  )
}

export default function App() {
  // every live number is written into these nodes from inside the frame loop
  const sink = useRef({})

  return (
    <div className="wrap">
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: true }}
        camera={{ position: [5.5, 13.4, 13.6], fov: 30 }}
        onCreated={({ camera }) => camera.lookAt(-1.15, 0.45, 0.45)}
      >
        <color attach="background" args={[BG]} />
        <Scene sink={sink} fixedHours={FIXED} />
      </Canvas>

      <header>
        <div className="eyebrow">3D Daily — Day 081 / after Space Capital</div>
        <h1>
          The Half
          <br />
          You Stand On
        </h1>
        <p>
          A receiver solves for four unknowns at once — where it is, and what time it thinks it
          is. Nothing in that solve knows which way is up. But every satellite it can hear is
          above it, and never below. That one missing hemisphere is the whole reason the vertical
          is the bad axis.
        </p>
      </header>

      <section className="panel left">
        <div className="cap">Dilution of precision · live</div>
        <Row k="HDOP" kref="H" sink={sink} />
        <Row k="VDOP" kref="V" sink={sink} />
        <Row k="TDOP" kref="T" sink={sink} />
        <div className="rule" />
        <Row k="σz / σx" kref="ratio" sink={sink} lit />
        <Row k="ρ (altitude, clock)" kref="rho" sink={sink} lit />
      </section>

      <section className="panel right">
        <div className="cap">Same instant · ground removed</div>
        <Row k="σz / σx" kref="fratio" sink={sink} />
        <Row k="ρ (altitude, clock)" kref="frho" sink={sink} />
        <div className="rule" />
        <div className="note">
          The same {CONST.planes * CONST.perPlane} satellites, the same second, the same clock.
          The only edit is that the solve may use the ones underfoot. The penalty does not
          shrink. It disappears.
        </div>
      </section>

      <footer>
        <div className="fcol">
          <span className="fk">Closed form · flat horizon</span>
          <span className="fv">
            σz/σx = {HORIZON.perAxis.toFixed(3)} · ρ = {HORIZON.rho.toFixed(3)} = √3⁄2
          </span>
        </div>
        <div className="fcol">
          <span className="fk">Closed form · full sphere</span>
          <span className="fv">
            σz/σx = {FULLSKY.perAxis.toFixed(3)} · ρ = {FULLSKY.rho.toFixed(3)}
          </span>
        </div>
        <div className="fcol">
          <span className="fk">In view</span>
          <span className="fv">
            <b ref={(el) => (sink.current.count = el)}>—</b> · mask {MASK_DEG}° ·{' '}
            <b ref={(el) => (sink.current.epoch = el)}>—</b>
          </span>
        </div>
        <div className="fcol">
          <span className="fk">No light source in scene</span>
          <span className="fv">55° inclination · 6 planes · r = 4.164 R⊕</span>
        </div>
      </footer>
    </div>
  )
}
