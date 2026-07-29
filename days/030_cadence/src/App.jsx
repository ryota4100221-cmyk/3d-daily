import { useState, useEffect, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'
import Pipeline from './Pipeline.jsx'
import { buildRig } from './rig.js'

const PASSES = [
  { key: 'Composite', note: 'TAA · blur · grade' },
  { key: 'Beauty', note: '1 sample, no AA' },
  { key: 'Normals', note: 'G-buffer, attachment 0' },
  { key: 'Velocity', note: 'G-buffer, attachment 1' },
  { key: 'Reflection', note: 'accumulated SSR' },
  { key: 'TAA off', note: 'the same frame, alone' },
]

// Two debug handles, in the tradition of Day 023's ?grade, Day 025's ?t and
// Day 027's ?speed — every pipeline needs a way to be stopped and looked at.
//
//   ?t=12.5      pins the scene clock. The piece stops, so all velocities go to
//                zero: TAA converges to a perfectly clean still, and the motion
//                blur necessarily disappears with the motion. Right for reading
//                the buffers, wrong for judging the blur.
//   ?phase=40    keeps the piece running but starts it 40 seconds in. This is
//                how a composition gets chosen: the orbits are slow, so which
//                moment you catch is a real design decision, and a capture
//                without this parameter can only take whatever it is handed.
//   ?pass=4      selects a render pass without a keyboard, which is the only
//                way a headless capture can check that the velocity buffer
//                really holds what this page claims it holds.
function readNum(key) {
  if (typeof window === 'undefined') return null
  const v = new URLSearchParams(window.location.search).get(key)
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export default function App() {
  const [mode, setMode] = useState(() => {
    const p = readNum('pass')
    return p != null && p >= 1 && p <= PASSES.length ? p - 1 : 0
  })
  const rig = useMemo(() => buildRig(), [])
  const freeze = useMemo(() => readNum('t'), [])
  const phase = useMemo(() => readNum('phase') ?? 0, [])

  useEffect(() => {
    const onKey = (e) => {
      const i = Number(e.key)
      if (i >= 1 && i <= PASSES.length) setMode(i - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="app">
      <Canvas
        flat
        shadows
        dpr={[1, 2]}
        gl={{ antialias: false, alpha: false, powerPreference: 'high-performance' }}
        camera={{ position: [0.2, 1.2, 8.3], fov: 30, near: 0.1, far: 80 }}
      >
        <Scene rig={rig} />
        <Pipeline rig={rig} mode={mode} freeze={freeze} phase={phase} />
      </Canvas>

      <div className="ui">
        <div className="top">
          <div className="mark">3D&nbsp;Daily</div>
          <div className="day">Day&nbsp;030 · ★★★★★</div>
        </div>

        <div className="lead">
          <div className="eyebrow">Loop 03 · Motion</div>
          <h1>
            Cadence<em>.</em>
            <span className="ghost">in&nbsp;motion</span>
          </h1>
          <p className="sub">
            For twenty-nine days nothing in these scenes was allowed to move,
            because the renderer could only remember where the camera had been.
            Now every form carries its own past — one previous matrix per object,
            one per instance — so the frame knows the velocity of each pixel, and
            spends it twice: on eight sub-pixel samples resolved into one clean
            image, and on the length of a shutter.
          </p>
        </div>

        <div className="bottom">
          <div className="meta">
            <span>Per&#8209;object motion vectors · 14 velocities, one draw</span>
            <span>TAA · Halton(2,3) jitter · YCoCg variance clipping</span>
            <span>Motion blur · gathered along the velocity buffer</span>
            <span>Shutter 1/30s · MSAA removed</span>
          </div>

          <div className="passes">
            <div className="passes-label">Render pass</div>
            <ul>
              {PASSES.map((p, i) => (
                <li
                  key={p.key}
                  className={i === mode ? 'on' : ''}
                  onClick={() => setMode(i)}
                >
                  <span className="idx">{i + 1}</span>
                  <span className="name">{p.key}</span>
                  <span className="note">{p.note}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
