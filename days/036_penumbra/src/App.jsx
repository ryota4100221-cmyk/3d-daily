import { useState, useEffect, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'
import Pipeline from './Pipeline.jsx'
import { buildRig } from './rig.js'

const PASSES = [
  { key: 'Composite', note: 'volume · wash · motes' },
  { key: 'Direct', note: 'our lighting, ours alone' },
  { key: 'Albedo', note: 'G-buffer, attachment 2' },
  { key: 'Radiosity', note: 'what surfaces hand back' },
  { key: 'In-scatter', note: 'volume, read at depth' },
  { key: 'Transmittance', note: 'what the air kept' },
  { key: 'The wash', note: 'air → surface, alone' },
  { key: 'No return', note: 'surfaces light nothing' },
  { key: 'Hard shadows', note: 'the lamp as a point' },
  { key: 'Light depth', note: 'the only shadow map' },
]

// Debug handles, in the tradition of Day 023's ?grade, 025's ?t, 030's ?phase
// and 031's ?pass.
//
//   ?t=12.5    pins the scene clock. Velocities go to zero, so TAA converges to
//              a perfectly clean still and the motion blur disappears with the
//              motion — right for reading buffers, wrong for judging blur.
//   ?phase=40  keeps the piece running but starts it 40 seconds in.
//   ?pass=9    selects a render pass without a keyboard, which is the only way a
//              headless capture can put "with a source that has a size" and
//              "without" side by side.
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
        camera={{ position: [1.10, 3.05, 11.9], fov: 30, near: 0.1, far: 80 }}
      >
        <Scene rig={rig} />
        <Pipeline rig={rig} mode={mode} freeze={freeze} phase={phase} />
      </Canvas>

      <div className="ui">
        <div className="top">
          <div className="mark">3D&nbsp;Daily</div>
          <div className="day">Day&nbsp;036 · ★★★★★</div>
        </div>

        <div className="lead">
          <div className="eyebrow">Loop 09 · The lamp has a size</div>
          <h1>
            Penumbra<em>.</em>
            <span className="ghost">sharp&nbsp;where&nbsp;it&nbsp;touches</span>
          </h1>
          <p className="sub">
            The beauty pass is gone, and with it three&rsquo;s light, three&rsquo;s
            shadow map and the last environment map. All of the lighting is
            computed here now, from the G-buffer, against the one depth map this
            renderer has kept in metres since Day&nbsp;031 — which is what makes
            the shadow test able to answer with a *fraction* instead of a yes.
            Search for a blocker, measure the gap, and the source&rsquo;s own
            angular size gives the width of the edge. Press 9 to collapse the lamp
            back to a point.
          </p>
        </div>

        <div className="bottom">
          <div className="meta">
            <span>Fully deferred direct lighting · Lambert + GGX from the G-buffer</span>
            <span>Percentage-closer soft shadows · blocker search, θ·gap, 20 taps</span>
            <span>One shadow map, three budgets — 20 taps, 2 taps, 1 tap</span>
            <span>No ambient, no fill, no environment map — one lamp, and a cycle</span>
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
