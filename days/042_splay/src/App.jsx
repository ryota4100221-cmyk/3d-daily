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
//              shape at all" side by side. Five modes have no key: ?pass=11
//              removes the tracery, ?pass=12 the return path, ?pass=13 flattens
//              Day 039's mask, ?pass=14 greys the glass entirely, and ?pass=15 is
//              Day 042's instrument — the level pair the fetch chose, drawn.
//   ?aniso=0   today's claim, removed. It is a flag rather than a pass because
//              it composes with all fifteen of them: any render in the set can be
//              taken with the footprint elliptical or forced round. The `a` key
//              toggles it live, which is the fastest way to see that the near
//              tablet's two roses are one rose without it.
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
    return p != null && p >= 1 && p <= PASSES.length + 5 ? p - 1 : 0
  })
  const rig = useMemo(() => buildRig(), [])
  const freeze = useMemo(() => readNum('t'), [])
  const phase = useMemo(() => readNum('phase') ?? 0, [])
  // ?k=128 overrides the pyramid's one tuned constant — texels of footprint per
  // unit of apparent source size. It is here because a number that decides how
  // much of a picture a lobe averages should be arguable from the address bar
  // rather than from a rebuild; see NOTES for what was compared with it.
  const glassK = useMemo(() => readNum('k'), [])
  // ?aniso=0 forces the level pair onto the ripmap's diagonal — Day 041's square
  // pyramid, reading the same texels through today's addressing.
  const [aniso, setAniso] = useState(() => readNum('aniso') !== 0)

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'a' || e.key === 'A') {
        setAniso((v) => !v)
        return
      }
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
        <Pipeline
          rig={rig}
          mode={mode}
          freeze={freeze}
          phase={phase}
          glassK={glassK}
          aniso={aniso}
        />
      </Canvas>

      <div className="ui">
        <div className="top">
          <div className="mark">3D&nbsp;Daily</div>
          <div className="day">Day&nbsp;042 · ★★★★★</div>
        </div>

        <div className="lead">
          <div className="eyebrow">Loop 15 · The lobe stops looking through a circle</div>
          <h1>
            Splay<em>.</em>
            <span className="ghost">a&nbsp;footprint&nbsp;is&nbsp;an&nbsp;ellipse</span>
          </h1>
          <p className="sub">
            Yesterday the window became a picture, read once from a filtered
            pyramid at a level set by how much of it the lobe covered. One level is
            one number, and one number can only describe <em>a circle</em>. A GGX
            lobe is not round and this window is square-on to nothing, so what a
            surface averages is an ellipse — long across the leads, short up them,
            or the other way about.
          </p>
          <p className="sub">
            So the pyramid grew a second axis. A <em>ripmap</em> holds the glass
            averaged 2<sup>m</sup> across and 2<sup>n</sup> up, and the level pair
            comes out of the 2×2 Jacobian from the window&rsquo;s own coordinates
            to the lobe&rsquo;s tangent plane. Press <em>a</em> for Day
            041&rsquo;s single level, on the same atlas — a small change on this
            frame, and measurably the right one: against a brute-forced
            elliptical average, 5.3% error against 6.0%, and 5.5% against 7.3%
            wherever the ellipse is both long and square to the leads.
          </p>
        </div>

        <div className="bottom">
          <div className="meta">
            <span>Anisotropic filtering of an area light · ripmap, 81 cells in one atlas</span>
            <span>The footprint is a Jacobian · the constant became an angle and kept its value</span>
            <span>The mip chain is the ripmap&rsquo;s diagonal · a → yesterday, same memory</span>
            <span>Yesterday&rsquo;s hue regression was in the cartoon, not the filter — corrected</span>
          </div>

          <div className="passes">
            <div className="passes-label">Render pass · a toggles anisotropy</div>
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
