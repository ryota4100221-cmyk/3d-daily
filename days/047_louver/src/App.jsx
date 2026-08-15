import { useState, useEffect, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'
import Pipeline from './Pipeline.jsx'
import { buildRig } from './rig.js'
import { TAP_MAX as MAX_TAPS, MASS_KAPPA } from './footprint.js'
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
//              and ?pass=16 the tap count, the anisotropy and how oblique the
//              footprint's major axis is. ?pass=17 is the support's map, 18 the
//              measured area's, 19 the coverage the fetch averaged, and ?pass=20
//              is today's: how much of that coverage the point can see.
//   ?aniso=0   Day 042's claim, removed: the footprint goes back to a circle and
//              the level pair onto the ripmap's diagonal. The `a` key toggles it.
//   ?supp=0    Day 044's claim, removed: the ellipse stops knowing that the
//              window has edges, and the fetch goes back to Day 043's. The `s`
//              key toggles it, and ?pass=17 is the map of where it matters.
//   ?mass=0    today's claim, removed: the footprint's area goes back to being
//              a function of two chosen constants instead of the kernel's own
//              mass over its own peak, which is Day 044 to the texel. Any
//              positive number is a profile constant, for arguing with — 1 is a
//              kernel uniform on its ellipse, 2 a Gaussian of the same
//              covariance, 1.2 what 1024 configurations measured. The `m` key
//              toggles it and ?pass=18 is the map of where it moved the fetch.
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
    return p != null && p >= 1 && p <= PASSES.length + 10 ? p - 1 : 0
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
  // ?mass=0 takes today's measurement back out and lets Day 044's two constants
  // decide the size again. Same atlas, same taps, same addressing: one multiply
  // on two floats, exactly as ?supp did yesterday.
  const [mass, setMass] = useState(() => {
    const v = readNum('mass')
    return v != null && v >= 0 ? v : MASS_KAPPA
  })
  // ?lead=0 takes today's mask back out of the pyramid. It is the one switch on
  // this list that is not a uniform — the mask is *in* the atlas, so turning it
  // off rebuilds the atlas with alpha 1 everywhere and the colour normalised the
  // old way, which is Day 045's texture read by today's shader. Dividing by an
  // alpha of 1 is the identity, so there is no second path through the fetch.
  const [lead, setLead] = useState(() => readNum('lead') !== 0)
  // ?vfit=1 turns on the mechanism this morning built and then measured: each
  // tap of the fetch weighted by the visibility the mask fitted. It is off by
  // default because it loses — 5.48% to 5.85% over 1022 occluded configurations
  // — and it is here because a negative result nobody can re-run is an
  // assertion. The `v` key toggles it and ?pass=20 is the map of the pixels it
  // is about.
  const [vfit, setVfit] = useState(() => readNum('vfit') === 1)

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
      if (e.key === 'm' || e.key === 'M') {
        setMass((v) => (v > 0 ? 0 : MASS_KAPPA))
        return
      }
      if (e.key === 'l' || e.key === 'L') {
        setLead((v) => !v)
        return
      }
      if (e.key === 'v' || e.key === 'V') {
        setVfit((v) => !v)
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
          mass={mass}
          lead={lead}
          vfit={vfit}
        />
      </Canvas>

      <div className="ui">
        <div className="top">
          <div className="mark">3D&nbsp;Daily</div>
          <div className="day">Day&nbsp;047 · ★★★★★</div>
        </div>

        <div className="lead">
          <div className="eyebrow">Loop 20 · Something in the way</div>
          <h1>
            Louver<em>.</em>
            <span className="ghost">the&nbsp;shadow&nbsp;was&nbsp;already&nbsp;inside</span>
          </h1>
          <p className="sub">
            Six mornings of filtering were scored against a window with nothing
            in front of it. The renderer's split carries the visible{' '}
            <em>mass</em> in one factor and the mean radiance in the other, and the second has
            no visibility written into it anywhere — so the top of every day's
            list has been the same line: the shadow has a resolution of six.
          </p>
          <p className="sub">
            Today the harness gets a blocker, and the line was wrong. Without a
            visibility term the fetch would be 18.73% out; it measures 5.48%,
            because pointing it along the <em>visibility-weighted</em> edge sum —
            an accident recorded in one sentence on Day 041 — was already doing
            three quarters of the work. Four mechanisms were built against the
            remaining quarter and all four lost. Press <em>v</em> to see one of
            them, and <em>l</em> for Day 045, <em>m</em> for Day 044, <em>s</em>{' '}
            for Day 043, <em>x</em> for Day 042, <em>a</em> for Day 041.
          </p>
        </div>

        <div className="bottom">
          <div className="meta">
            <span>Area-light filtering · the day the harness grew an occluder</span>
            <span>18.73% without a visibility term · 5.48% with the one that was already there</span>
            <span>v → the mechanism that lost, l → Day 045, m → Day 044, s → Day 043</span>
            <span>Measured against the visibility-weighted mean over the panes</span>
          </div>

          <div className="passes">
            <div className="passes-label">Render pass · a anisotropy · x taps · s support · m area · l mask · v shadow</div>
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
