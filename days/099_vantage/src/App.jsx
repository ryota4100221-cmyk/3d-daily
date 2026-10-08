import { useRef, useState, useCallback, useEffect } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'
import { buildDots, eyeAt, latticeError, predictedRms, T_NEAR, T_FAR, COLS, ROWS, PERIOD } from './rig.js'

const q = new URLSearchParams(location.search)
const FIXED_T = q.has('t') ? Number(q.get('t')) : null

// closed-form numbers for the side panel, computed once from the same cloud
const DOTS = buildDots()
const PER_10CM = predictedRms(DOTS, 0.1)

const fmt = (x, n = 2) => (Number.isFinite(x) ? x.toFixed(n) : '—')

export default function App() {
  const pointer = useRef({ x: 0, y: 0, active: false, weight: 0, idle: 0 })
  const clock = useRef({ t: FIXED_T ?? 0, frozen: FIXED_T !== null })
  // initial readout straight from the rig so a still capture never shows dashes
  const [r, setR] = useState(() => {
    const e = eyeAt(clock.current.t, null)
    const err = latticeError(DOTS, e.C, e.yaw, e.pitch)
    return { d: Math.hypot(...e.C), yaw: (e.yaw * 180) / Math.PI, pitch: (e.pitch * 180) / Math.PI, ...err, breath: e.breath }
  })
  const onReadout = useCallback((v) => setR(v), [])
  const timer = useRef(0)

  const move = (e) => {
    const p = pointer.current
    p.x = (e.clientX / window.innerWidth) * 2 - 1
    p.y = -((e.clientY / window.innerHeight) * 2 - 1)
    p.active = true
    clearTimeout(timer.current)
    timer.current = setTimeout(() => (p.active = false), 3500)
  }
  useEffect(() => () => clearTimeout(timer.current), [])

  const aligned = r.rms < 0.05
  const narrow = typeof window !== 'undefined' && window.innerWidth < 760

  return (
    <div className="stage" onPointerMove={move} onPointerDown={move}>
      <Canvas
        dpr={[1, 2]}
        camera={{ fov: narrow ? 64 : 40, near: 0.1, far: 1000, position: [0, 0, 0] }}
        gl={{ antialias: true }}
        onCreated={({ gl }) => gl.setClearColor('#b7bcbf')}
      >
        <Scene pointer={pointer} clock={clock} onReadout={onReadout} />
      </Canvas>

      <header className="top">
        <span>3D Daily — 099</span>
        <span>after Eggforward · Make the Point For Change</span>
      </header>

      <section className="title">
        <p className="kicker">Vantage</p>
        <h1>
          Make the
          <br />
          Point.
        </h1>
        <p className="sub">
          {COLS * ROWS} red points, {fmt(T_NEAR, 0)} to {fmt(T_FAR, 0)} metres away.
          <br />A grid from exactly one place.
        </p>
      </section>

      <p className="lede">
        Each point sits on its own ray from the eye, at its own depth, and is sized so that from the eye they are
        all the same. <em>Turn</em> your head and the grid turns with you, intact. <em>Step</em> sideways and a near
        point slides further than a far one — the grid tears by the amount of the step.
      </p>

      <dl className="spec">
        <div>
          <dt>Step from the point</dt>
          <dd className="big">{fmt(r.d * 100, 1)} cm</dd>
        </div>
        <div>
          <dt>Turn (yaw / pitch)</dt>
          <dd>
            {fmt(r.yaw, 1)}° / {fmt(r.pitch, 1)}°
          </dd>
        </div>
        <div>
          <dt>Grid error, RMS</dt>
          <dd className={`big ${aligned ? 'ok' : ''}`}>{fmt(r.rms, 3)} cell</dd>
        </div>
        <div>
          <dt>Worst point</dt>
          <dd>{fmt(r.worst, 2)} cell</dd>
        </div>
        <div>
          <dt>Per 10 cm of step</dt>
          <dd>{fmt(PER_10CM, 3)} cell</dd>
        </div>
      </dl>

      <footer className="foot">
        <span className={aligned ? 'state on' : 'state'}>{aligned ? '● On the point' : '○ Off the point'}</span>
        <span>Move the pointer to step · leave it to drift back every {PERIOD} s</span>
      </footer>
    </div>
  )
}
