import { useState, useEffect, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'
import Pipeline from './Pipeline.jsx'
import { buildRig } from './rig.js'

const PASSES = [
  { key: 'Composite', note: 'volume · wash · motes' },
  { key: 'Beauty', note: 'the key alone, no fill' },
  { key: 'Albedo', note: 'G-buffer, attachment 2' },
  { key: 'Radiosity', note: 'what surfaces hand back' },
  { key: 'In-scatter', note: 'volume, read at depth' },
  { key: 'Transmittance', note: 'what the air kept' },
  { key: 'The wash', note: 'air → surface, alone' },
  { key: 'No return', note: 'surfaces light nothing' },
  { key: 'No visibility', note: 'the wash through walls' },
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
//              headless capture can put "with the return path" and "without it"
//              side by side.
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
        camera={{ position: [0.60, 1.30, 12.6], fov: 30, near: 0.1, far: 80 }}
      >
        <Scene rig={rig} />
        <Pipeline rig={rig} mode={mode} freeze={freeze} phase={phase} />
      </Canvas>

      <div className="ui">
        <div className="top">
          <div className="mark">3D&nbsp;Daily</div>
          <div className="day">Day&nbsp;035 · ★★★★★</div>
        </div>

        <div className="lead">
          <div className="eyebrow">Loop 08 · The light goes round</div>
          <h1>
            Return<em>.</em>
            <span className="ghost">the&nbsp;ceiling&nbsp;is&nbsp;lit&nbsp;by&nbsp;the&nbsp;floor</span>
          </h1>
          <p className="sub">
            A downward beam cannot reach the underside of a slab. Yesterday the
            air could light stone; today stone lights the air back — the
            composite writes what every surface reflects into a second buffer,
            and the froxel injection reads it next frame as a source. Floor to
            air to ceiling, one iteration per frame, solved by the same temporal
            filter that has been running since Day&nbsp;033. Press 8 to cut the
            return path and watch the alcove close.
          </p>
        </div>

        <div className="bottom">
          <div className="meta">
            <span>Surface → volume injection · seven screen-space taps per froxel</span>
            <span>Deferred radiosity · composite attachment 1</span>
            <span>Screen-space visibility march on the wash · five steps per tap</span>
            <span>No ambient, no fill, no hemisphere — one light, and a cycle</span>
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
