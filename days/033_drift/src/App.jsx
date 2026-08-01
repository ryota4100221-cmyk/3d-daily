import { useState, useEffect, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'
import Pipeline from './Pipeline.jsx'
import { buildRig } from './rig.js'

const PASSES = [
  { key: 'Composite', note: 'volume · motes · TAA' },
  { key: 'Beauty', note: 'opaque surfaces, dry air' },
  { key: 'Normals', note: 'G-buffer, attachment 0' },
  { key: 'Velocity', note: 'G-buffer, attachment 1' },
  { key: 'In-scatter', note: 'volume, read at depth' },
  { key: 'Transmittance', note: 'what the air kept' },
  { key: 'Froxel atlas', note: '64 slices, 256×144' },
  { key: 'Light depth', note: 'our own shadow map' },
  { key: 'Single scatter', note: 'the second bounce off' },
  { key: 'Motes', note: '7,000 specks, alone' },
]

// Debug handles, in the tradition of Day 023's ?grade, 025's ?t, 030's ?phase
// and 031's ?pass.
//
//   ?t=12.5    pins the scene clock. Velocities go to zero, so TAA converges to
//              a perfectly clean still and the motion blur disappears with the
//              motion — right for reading buffers, wrong for judging blur.
//   ?phase=40  keeps the piece running but starts it 40 seconds in.
//   ?pass=9    selects a render pass without a keyboard, which is the only way a
//              headless capture can put single and multiple scattering side by
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
          <div className="day">Day&nbsp;033 · ★★★★★</div>
        </div>

        <div className="lead">
          <div className="eyebrow">Loop 06 · Second bounce</div>
          <h1>
            Drift<em>.</em>
            <span className="ghost">the&nbsp;air&nbsp;lights&nbsp;the&nbsp;room</span>
          </h1>
          <p className="sub">
            One light. Everything else you can see is the mist passing the beam
            along to itself. Each froxel gathers what its neighbours held last
            frame, keeps half, and gives it back with no direction — one Jacobi
            iteration per frame, and the frames add up to the whole series. Seven
            thousand specks fall through it, each one reading the same volume at
            its own depth.
          </p>
        </div>

        <div className="bottom">
          <div className="meta">
            <span>Multiple scattering · one diffusion iteration per frame</span>
            <span>Tetrahedral gather in world space · golden-angle rotation</span>
            <span>7,000 analytic billboards · one draw, no CPU</span>
            <span>Transparency composited outside the temporal resolve</span>
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
