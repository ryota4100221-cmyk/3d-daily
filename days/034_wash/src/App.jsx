import { useState, useEffect, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'
import Pipeline from './Pipeline.jsx'
import { buildRig } from './rig.js'

const PASSES = [
  { key: 'Composite', note: 'volume · wash · motes' },
  { key: 'Beauty', note: 'the key alone, no fill' },
  { key: 'Albedo', note: 'G-buffer, attachment 2' },
  { key: 'Normals', note: 'G-buffer, attachment 0' },
  { key: 'In-scatter', note: 'volume, read at depth' },
  { key: 'Transmittance', note: 'what the air kept' },
  { key: 'The wash', note: 'air → surface, alone' },
  { key: 'No wash', note: 'the air lights nothing' },
  { key: 'Single scatter', note: 'the air’s 2nd bounce off' },
  { key: 'Light depth', note: 'our own shadow map' },
]

// Debug handles, in the tradition of Day 023's ?grade, 025's ?t, 030's ?phase
// and 031's ?pass.
//
//   ?t=12.5    pins the scene clock. Velocities go to zero, so TAA converges to
//              a perfectly clean still and the motion blur disappears with the
//              motion — right for reading buffers, wrong for judging blur.
//   ?phase=40  keeps the piece running but starts it 40 seconds in.
//   ?pass=8    selects a render pass without a keyboard, which is the only way a
//              headless capture can put "with the wash" and "without it" side by
//              side.
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
      if (!/^[0-9]$/.test(e.key)) return
      // 1..9 select the first nine; 0 is the tenth, because a keyboard has ten
      // digits and this list has ten entries
      const i = e.key === '0' ? 10 : Number(e.key)
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
        camera={{ position: [0.28, 2.34, 13.6], fov: 30, near: 0.1, far: 80 }}
      >
        <Scene rig={rig} />
        <Pipeline rig={rig} mode={mode} freeze={freeze} phase={phase} />
      </Canvas>

      <div className="ui">
        <div className="top">
          <div className="mark">3D&nbsp;Daily</div>
          <div className="day">Day&nbsp;034 · ★★★★★</div>
        </div>

        <div className="lead">
          <div className="eyebrow">Loop 07 · Air as a light source</div>
          <h1>
            Wash<em>.</em>
            <span className="ghost">nothing&nbsp;here&nbsp;faces&nbsp;the&nbsp;lamp</span>
          </h1>
          <p className="sub">
            Both plaster fields are turned away from the only light in the room,
            so the renderer's direct term on them is exactly zero. What you can
            see of them arrived by scattering twice in the mist and reflecting
            once. Each shaded pixel takes four taps into the froxel grid, around
            its own position and along its own normal, and keeps its albedo's
            share. Press 8 to take that away and watch the plaster fall back to
            a flat grey that knows nothing about where the light is.
          </p>
        </div>

        <div className="bottom">
          <div className="meta">
            <span>Froxel → surface irradiance · four taps per lit pixel</span>
            <span>Deferred albedo · G-buffer attachment 2</span>
            <span>Spectral scattering albedo · the air warms as it bounces</span>
            <span>No ambient, no fill, no hemisphere — one light</span>
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
                  <span className="idx">{i === 9 ? 0 : i + 1}</span>
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
