import { useState, useEffect, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'
import Pipeline from './Pipeline.jsx'
import { buildRig } from './rig.js'

const PASSES = [
  { key: 'Composite', note: 'volume · wash · motes' },
  { key: 'Direct', note: 'the integral alone' },
  { key: 'Albedo', note: 'G-buffer, attachment 2' },
  { key: 'Radiosity', note: 'what surfaces hand back' },
  { key: 'In-scatter', note: 'volume, read at depth' },
  { key: 'Transmittance', note: 'what the air kept' },
  { key: 'The wash', note: 'air → surface, alone' },
  { key: 'Flat visibility', note: 'one number for six panes — Day 038' },
  { key: 'Day 037', note: 'representative point, not LTC' },
  { key: 'Point source', note: 'no size at all' },
]

// Debug handles, in the tradition of Day 023's ?grade, 025's ?t, 030's ?phase
// and 031's ?pass.
//
//   ?t=12.5    pins the scene clock. Velocities go to zero, so TAA converges to
//              a perfectly clean still and the motion blur disappears with the
//              motion — right for reading buffers, wrong for judging blur.
//   ?phase=40  keeps the piece running but starts it 40 seconds in.
//   ?pass=8    selects a render pass without a keyboard, which is the only way a
//              headless capture can put "a window with three of its panes taken
//              away", "the same window dimmed by one number" and "a source with
//              no shape at all" side by side. Two modes have no key any more:
//              ?pass=11 removes the tracery, ?pass=12 the return path. There are
//              ten digits and twelve things worth looking at.
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
    return p != null && p >= 1 && p <= PASSES.length + 2 ? p - 1 : 0
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
          <div className="day">Day&nbsp;039 · ★★★★★</div>
        </div>

        <div className="lead">
          <div className="eyebrow">Loop 12 · A shadow falls on the lamp, not on the room</div>
          <h1>
            Eclipse<em>.</em>
            <span className="ghost">a&nbsp;shadow&nbsp;does&nbsp;not&nbsp;dim&nbsp;a&nbsp;window</span>
          </h1>
          <p className="sub">
            Yesterday the source became six rectangles of stone-divided sky and
            the highlight became a picture of it. But the shadow was still one
            number: <em>how much</em> of the window this point can see, never{' '}
            <em>which part</em>. Today visibility is a <em>mask over the panes</em>,
            and it goes <em>inside</em> Heitz&rsquo;s integral rather than on top
            of it — legal because a vector integral is additive over its domain,
            weights and all. So a lath crossing the beam takes panes out of the
            near tablet&rsquo;s reflection and leaves the rest at full brightness:
            the window is not dimmed, it is <em>partly gone</em>. Press 8 to
            flatten the mask back to one number and watch the eclipse vanish
            entirely — a saturated highlight does not notice being halved.
          </p>
          <p className="sub">
            Press 9 for Day 037&rsquo;s approximation, 0 to take the lamp&rsquo;s
            size away.
          </p>
        </div>

        <div className="bottom">
          <div className="meta">
            <span>Shadowed area light · visibility as a mask over the panes, not a scalar</span>
            <span>The mask lives inside the LTC sum · additivity does not mind weights</span>
            <span>Taps re-allocated per pane · a per-pane estimate needs its own samples</span>
            <span>One window, one description, read by the stone, the air and the dust</span>
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
