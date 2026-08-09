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
  { key: 'Six constants', note: 'panes, not an image — Day 040' },
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
//              flattens Day 039's mask, ?pass=14 greys the glass entirely. There
//              are ten digits and fourteen things worth looking at, and the
//              newest claim takes the keyed slot.
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
    return p != null && p >= 1 && p <= PASSES.length + 4 ? p - 1 : 0
  })
  const rig = useMemo(() => buildRig(), [])
  const freeze = useMemo(() => readNum('t'), [])
  const phase = useMemo(() => readNum('phase') ?? 0, [])
  // ?k=128 overrides the pyramid's one tuned constant — texels of footprint per
  // unit of apparent source size. It is here because a number that decides how
  // much of a picture a lobe averages should be arguable from the address bar
  // rather than from a rebuild; see NOTES for what was compared with it.
  const glassK = useMemo(() => readNum('k'), [])

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
        <Pipeline rig={rig} mode={mode} freeze={freeze} phase={phase} glassK={glassK} />
      </Canvas>

      <div className="ui">
        <div className="top">
          <div className="mark">3D&nbsp;Daily</div>
          <div className="day">Day&nbsp;041 · ★★★★★</div>
        </div>

        <div className="lead">
          <div className="eyebrow">Loop 14 · The lamp stops being a list of numbers</div>
          <h1>
            Grisaille<em>.</em>
            <span className="ghost">a&nbsp;window&nbsp;is&nbsp;a&nbsp;picture</span>
          </h1>
          <p className="sub">
            Yesterday the glass had six colours, one per pane, and six numbers
            cannot paint a window. Today the source is <em>an image</em> — quarries,
            a leaded lattice, a roundel in grisaille — and the shading reads it
            once, at a level of its own filtered pyramid chosen from how much of
            the window the lobe covers. Nothing about the polygons moved.
          </p>
          <p className="sub">
            So the two lacquer tablets are the pyramid, rendered: the near one at
            roughness 0.05 resolves the leads and the painted rose, the far one at
            0.125 averages the same picture into a colour. Press 8 to put Day
            040&rsquo;s six constants back — same shape, same shadows, same
            exposure, and the window goes flat. 9 is Day 037&rsquo;s
            approximation, 0 takes the lamp&rsquo;s size away.
          </p>
        </div>

        <div className="bottom">
          <div className="meta">
            <span>A textured area light · Heitz §5, one filtered fetch per term</span>
            <span>Roughness picks the mip · the pair of tablets is the pyramid made visible</span>
            <span>The fetch follows the lobe&rsquo;s own direction, not the point&rsquo;s projection</span>
            <span>Mean-preserving pyramid · the top level is white, so exposure never moved</span>
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
