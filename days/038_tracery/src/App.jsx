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
  { key: 'Day 037', note: 'representative point, not LTC' },
  { key: 'Untraceried', note: 'one rectangle, same light' },
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
//              headless capture can put "an integral of a window", "a fit to an
//              ellipse" and "a source with no shape at all" side by side.
//              ?pass=11 is the one mode with no key: the return path off. There
//              are ten digits and eleven things worth looking at.
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
    return p != null && p >= 1 && p <= PASSES.length + 1 ? p - 1 : 0
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
          <div className="day">Day&nbsp;038 · ★★★★★</div>
        </div>

        <div className="lead">
          <div className="eyebrow">Loop 11 · The lamp has a drawing in it</div>
          <h1>
            Tracery<em>.</em>
            <span className="ghost">a&nbsp;highlight&nbsp;is&nbsp;a&nbsp;picture&nbsp;of&nbsp;the&nbsp;source</span>
          </h1>
          <p className="sub">
            Yesterday the lamp was two numbers — an ellipse. Two numbers cannot
            say <em>mullion</em>. Today the source is six rectangles of stone-
            divided sky, and the shading is Heitz&rsquo;s{' '}
            <em>linearly transformed cosines</em>: the exact integral of that
            polygon set against a GGX lobe, not a fit to it. The two lacquer
            tablets are the same object at two roughnesses — on the near one the
            window is legible, on the far one it has closed into yesterday&rsquo;s
            lozenge. The soft shadows carry the same drawing: the PCF kernel
            <em> is</em> the window, so a mullion lays a pale seam through every
            penumbra it crosses. Press 8 for the old approximation, 9 to take the
            tracery out, 0 to take the size out.
          </p>
        </div>

        <div className="bottom">
          <div className="meta">
            <span>LTC · analytic polygon integral, one clipped form factor for six panes</span>
            <span>Shaped PCSS · the kernel is the source, sampled by area through a CDF</span>
            <span>Cranley&ndash;Patterson decorrelation · you cannot rotate a kernel with a picture in it</span>
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
