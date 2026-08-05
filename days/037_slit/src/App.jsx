import { useState, useEffect, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'
import Pipeline from './Pipeline.jsx'
import { buildRig } from './rig.js'

const PASSES = [
  { key: 'Composite', note: 'volume · wash · motes' },
  { key: 'Direct', note: 'the area term alone' },
  { key: 'Albedo', note: 'G-buffer, attachment 2' },
  { key: 'Radiosity', note: 'what surfaces hand back' },
  { key: 'In-scatter', note: 'volume, read at depth' },
  { key: 'Transmittance', note: 'what the air kept' },
  { key: 'The wash', note: 'air → surface, alone' },
  { key: 'No return', note: 'surfaces light nothing' },
  { key: 'Round source', note: 'same solid angle, no axis' },
  { key: 'Point source', note: 'no size at all' },
]

// Debug handles, in the tradition of Day 023's ?grade, 025's ?t, 030's ?phase
// and 031's ?pass.
//
//   ?t=12.5    pins the scene clock. Velocities go to zero, so TAA converges to
//              a perfectly clean still and the motion blur disappears with the
//              motion — right for reading buffers, wrong for judging blur.
//   ?phase=40  keeps the piece running but starts it 40 seconds in.
//   ?pass=9    selects a render pass without a keyboard, which is the only way a
//              headless capture can put "a source with a shape", "a source with
//              a size" and "a source with neither" side by side.
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
        dpr={[1, 2]}
        gl={{ antialias: false, alpha: false, powerPreference: 'high-performance' }}
        camera={{ position: [1.30, 4.05, 11.4], fov: 30, near: 0.1, far: 80 }}
      >
        <Scene rig={rig} />
        <Pipeline rig={rig} mode={mode} freeze={freeze} phase={phase} />
      </Canvas>

      <div className="ui">
        <div className="top">
          <div className="mark">3D&nbsp;Daily</div>
          <div className="day">Day&nbsp;037 · ★★★★★</div>
        </div>

        <div className="lead">
          <div className="eyebrow">Loop 10 · The lamp has a shape</div>
          <h1>
            Slit<em>.</em>
            <span className="ghost">turn&nbsp;it,&nbsp;and&nbsp;the&nbsp;edge&nbsp;changes</span>
          </h1>
          <p className="sub">
            Yesterday one number — the lamp&rsquo;s angular radius — reached the
            shadow test and nothing else. Today it is two numbers, and they reach
            everything: the blocker search and the PCF become an{' '}
            <em>ellipse</em> in the source&rsquo;s own frame, Lambert&rsquo;s
            cosine becomes the analytic irradiance of a disc setting over the
            horizon, and the GGX lobe is widened per axis so a glaze reflects the
            opening&rsquo;s shape. Seven identical blades, turned through ninety
            degrees: one dissolves, one stays a line. Press 9 to round the source
            off, 0 to collapse it to a point.
          </p>
        </div>

        <div className="bottom">
          <div className="meta">
            <span>Anisotropic PCSS · elliptical blocker search, θ·gap per axis</span>
            <span>Area diffuse · analytic disc irradiance at the horizon</span>
            <span>Area specular · representative point + per-axis lobe widening</span>
            <span>One lamp, one description, read by the stone, the air and the dust</span>
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
