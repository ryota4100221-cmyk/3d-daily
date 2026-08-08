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
  { key: 'Grey glass', note: 'one colour for six panes — Day 039' },
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
//              headless capture can put "a window whose two lights are different
//              colours", "the same window in grey glass" and "a source with no
//              shape at all" side by side. Three modes have no key any more:
//              ?pass=11 removes the tracery, ?pass=12 the return path, ?pass=13
//              flattens Day 039's mask. There are ten digits and thirteen things
//              worth looking at, and the newest claim takes the keyed slot.
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
    return p != null && p >= 1 && p <= PASSES.length + 3 ? p - 1 : 0
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
          <div className="day">Day&nbsp;040 · ★★★★★</div>
        </div>

        <div className="lead">
          <div className="eyebrow">Loop 13 · Six panes, six lamps, one frame of stone</div>
          <h1>
            Vitrail<em>.</em>
            <span className="ghost">a&nbsp;window&nbsp;is&nbsp;not&nbsp;one&nbsp;colour</span>
          </h1>
          <p className="sub">
            Three days of giving the lamp a <em>shape</em> — two angles, six
            rectangles, a shadow mask over them — and all through it the opening
            stayed one warm white. Today the glass differs pane to pane: the left
            light older and amber, the right cooler and green. The source is no
            longer uniform, so the integral, the air and the dust each have to
            carry a <em>colour</em> where they carried a number.
          </p>
          <p className="sub">
            The lacquer reflects only the panes its lobe can reach — so the
            highlight is <em>two colours with stone between them</em> while the
            plaster beside it averages all six back to white. Press 8 to grey the
            glass: the tints are normalised to a mean of white, so that frame gets
            exactly the same quantity of light and differs by hue alone. 9 is Day
            037&rsquo;s approximation, 0 takes the lamp&rsquo;s size away.
          </p>
        </div>

        <div className="bottom">
          <div className="meta">
            <span>A source with non-uniform radiance · six tints, one frame of stone</span>
            <span>Colour inside the LTC sum · one clip for the shape, a weighted mean for the hue</span>
            <span>The shadow taps carry the pane they drew from · the air gets a colour, not a mask</span>
            <span>Tints normalised to white · greying the glass is not an exposure change</span>
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
