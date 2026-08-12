import { useState, useEffect, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'
import Pipeline from './Pipeline.jsx'
import { buildRig } from './rig.js'
import { TAP_MAX as MAX_TAPS } from './footprint.js'
import { GLASS_SIZE } from './glass.js'

// The window's own support, as a semi-axis in texels: a unit square's covariance
// is (1/12) I, and an ellipse of semi-axis a has a^2/4, so the square weighs the
// same as one of N/sqrt(3). Derived here rather than typed, for the reason
// footprint.js gives at length.
const SUPPORT = GLASS_SIZE / Math.sqrt(3)

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
//              shape at all" side by side. Six modes have no key: ?pass=11
//              removes the tracery, ?pass=12 the return path, ?pass=13 flattens
//              Day 039's mask, ?pass=14 greys the glass entirely, ?pass=15 is
//              Day 042's instrument — the level pair the fetch chose, drawn —
//              and ?pass=16 is today's: the tap count, the anisotropy, and how
//              oblique the footprint's major axis is.
//   ?aniso=0   Day 042's claim, removed: the footprint goes back to a circle and
//              the level pair onto the ripmap's diagonal. The `a` key toggles it.
//   ?supp=0    today's claim, removed: the ellipse stops knowing that the window
//              has edges, and the fetch goes back to Day 043's. The `s` key
//              toggles it, and ?pass=17 is the map of where it matters.
//   ?tap=1     yesterday's claim, removed. One tap is the whole ellipse under one
//              bounding box, which is Day 042 exactly — same atlas, same cells.
//              2 and 3 are the intermediate builds and 4 is the default. It is a
//              flag rather than a pass because it composes with all sixteen of
//              them, and the `x` key toggles between 1 and the budget, which is
//              the fastest way to watch a diagonal highlight on the near
//              tablet's rim stop smearing across the leads.
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
    return p != null && p >= 1 && p <= PASSES.length + 7 ? p - 1 : 0
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
  // ?tap=1 puts the whole ellipse back under a single fetch of its bounding box
  // — Day 042, reading the same cells of the same atlas through the same
  // addressing. Anything from 1 to the budget is a build that existed on the way
  // here.
  const [taps, setTaps] = useState(() => {
    const t = readNum('tap')
    return t != null && t >= 1 && t <= MAX_TAPS ? Math.round(t) : MAX_TAPS
  })
  // ?supp=0 takes the window's edges back out of the kernel — Day 043, reading
  // the same cells of the same atlas through the same addressing, with a longer
  // ellipse. Any positive number is a support width in texels, for arguing with.
  const [support, setSupport] = useState(() => {
    const v = readNum('supp')
    return v != null && v >= 0 ? v : SUPPORT
  })

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'a' || e.key === 'A') {
        setAniso((v) => !v)
        return
      }
      if (e.key === 's' || e.key === 'S') {
        setSupport((v) => (v > 0 ? 0 : SUPPORT))
        return
      }
      if (e.key === 'x' || e.key === 'X') {
        setTaps((v) => (v > 1 ? 1 : MAX_TAPS))
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
          taps={taps}
          support={support}
        />
      </Canvas>

      <div className="ui">
        <div className="top">
          <div className="mark">3D&nbsp;Daily</div>
          <div className="day">Day&nbsp;044 · ★★★★★</div>
        </div>

        <div className="lead">
          <div className="eyebrow">Loop 17 · The window is half of the weight</div>
          <h1>
            Taper<em>.</em>
            <span className="ghost">the&nbsp;kernel&nbsp;has&nbsp;edges</span>
          </h1>
          <p className="sub">
            For three mornings the footprint has been an ellipse: the preimage
            of a disc half a radian across, a number chosen by eye on Day 041 and
            not asked about since. Each day improved how that ellipse is
            <em> sampled</em> — a level pair, then four probes along its long
            axis. None of them asked whether it was the right ellipse.
          </p>
          <p className="sub">
            It was not. The fetch stands in for the lobe-weighted mean of the
            window&rsquo;s image, and the window is half of that weight — outside
            the opening there is nothing to average. Two kernels multiplying is
            two variances adding reciprocally, and a square&rsquo;s covariance is
            isotropic, so the opening shortens both axes and turns neither. Two
            lines, no extra fetch. Against a brute-forced lobe-weighted mean:
            4.44% error against yesterday&rsquo;s 8.09%, which is more than the
            last two mornings bought together. Press <em>s</em> for yesterday, <em>x</em> for
            Day 042, <em>a</em> for Day 041.
          </p>
        </div>

        <div className="bottom">
          <div className="meta">
            <span>Area-light filtering · the kernel is the lobe times the window</span>
            <span>Two variances add reciprocally · the opening shortens both axes</span>
            <span>s → Day 043, x → Day 042, a → Day 041, all on the same atlas</span>
            <span>Measured off the GPU, against the weighted mean the fetch stands in for</span>
          </div>

          <div className="passes">
            <div className="passes-label">Render pass · a anisotropy · x taps · s support</div>
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
