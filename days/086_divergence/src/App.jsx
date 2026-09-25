import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import Scene, { layout } from './Scene.jsx'
import { GOLDEN, LADDER, convergents, packing, spokes, family, idleF, knobF, KNOB } from './rig.js'

const N = 2400
const q = new URLSearchParams(location.search)
const FIXED = q.has('f') ? (q.get('f') === 'golden' ? GOLDEN : Number(q.get('f'))) : null

function Aim() {
  const cam = useThree((s) => s.camera)
  useEffect(() => {
    cam.up.set(0, 0, -1)
    cam.position.set(0, 5000, 0)
    cam.lookAt(0, 0, 0)
    cam.updateProjectionMatrix()
  }, [cam])
  return null
}

const fmt = (x, d = 4) => x.toFixed(d)

function useSize() {
  const [s, set] = useState({ w: innerWidth, h: innerHeight })
  useEffect(() => {
    const on = () => set({ w: innerWidth, h: innerHeight })
    addEventListener('resize', on)
    return () => removeEventListener('resize', on)
  }, [])
  return s
}

export default function App() {
  const fRef = useRef(FIXED ?? GOLDEN)
  const famRef = useRef(family(N, fRef.current))
  const [hud, setHud] = useState(() => read(fRef.current))
  const { w, h } = useSize()
  const L = layout(w, h)

  // The knob. Pointer x drives f directly (eased); without a pointer for 3 s
  // the idle path takes over. ?f= pins it for captures.
  useEffect(() => {
    if (FIXED != null) return
    let target = null, last = -1e9, raf, f = fRef.current, t0 = performance.now(), lastHud = 0
    const move = (e) => {
      const x = (e.touches ? e.touches[0].clientX : e.clientX) / innerWidth
      target = knobF(x)
      last = performance.now()
    }
    addEventListener('pointermove', move)
    addEventListener('touchmove', move, { passive: true })
    const tick = (now) => {
      const idle = now - last > 3000
      const goal = idle ? idleF((now - t0) / 1000) : target
      f += (goal - f) * (idle ? 0.08 : 0.12)
      fRef.current = f
      famRef.current = family(N, f)
      if (now - lastHud > 120) {
        lastHud = now
        setHud(read(f))
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      removeEventListener('pointermove', move)
      removeEventListener('touchmove', move)
    }
  }, [])

  const ladderStats = useMemo(() => LADDER.map((s) => packing(420, s.f)), [])
  const knobPos = (hud.f - KNOB[0]) / (KNOB[1] - KNOB[0])

  return (
    <>
      <Canvas
        orthographic
        dpr={[1, 2]}
        camera={{ position: [0, 5000, 0], up: [0, 0, -1], zoom: 1, near: 1, far: 10000 }}
        gl={{ antialias: true }}
        style={{ position: 'fixed', inset: 0 }}
      >
        <Aim />
        <Scene n={N} fRef={fRef} famRef={famRef} />
      </Canvas>

      <main className={L.narrow ? 'hud narrow' : 'hud'} style={{ '--col0': `${L.col0 ?? 24}px` }}>
        <header className="top">
          <span className="mono">AUSTENSOR / ACT I — 01</span>
          <span className="mono dim">After austensor.com · Day 086</span>
        </header>

        <div className="col">
        <section className="lede">
          <p className="mono kicker">Enter the field.</p>
          <h1>
            The angle
            <br />
            that never
            <br />
            repeats.
          </h1>
          <p className="body">
            {N.toLocaleString('en')} grains on a sphere. Grain <i>i</i> sits at height 1 − (2i+1)/N and turns by{' '}
            <i>i·f</i> of a revolution. Nothing else is placed. Move across the page to turn <i>f</i>.
          </p>
        </section>

        <dl className="readout mono">
          <div>
            <dt>divergence f</dt>
            <dd>
              {fmt(hud.f, 6)} <span className="dim">· {fmt(hud.f * 360, 3)}°</span>
            </dd>
          </div>
          <div>
            <dt>nearest spokes</dt>
            <dd className={hud.sp ? 'warn' : ''}>{hud.sp ? `${hud.sp.q} straight arms (${hud.sp.p}/${hud.sp.q})` : `none ≤ √N = ${Math.floor(Math.sqrt(N))}`}</dd>
          </div>
          <div>
            <dt>packing mean/min</dt>
            <dd>
              {fmt(hud.pk.mean, 3)} / {fmt(hud.pk.min, 3)} <span className="dim">× hex</span>
            </dd>
          </div>
          <div>
            <dt>traced family</dt>
            <dd>every {hud.fam}th grain</dd>
          </div>
          <div className="chain">
            <dt>convergents</dt>
            <dd>
              {hud.cs.map((c, k) => (
                <span key={k} className={c.q === hud.fam ? 'on' : c.q > Math.sqrt(N) ? 'dim' : ''}>
                  {c.p}/{c.q}
                </span>
              ))}
            </dd>
          </div>
        </dl>
        </div>

        <div className="knob" aria-hidden>
          <span className="mono dim">{KNOB[0]}</span>
          <div className="rail">
            {LADDER.slice(1).map((s) => (
              <i key={s.label} style={{ left: `${((s.f - KNOB[0]) / (KNOB[1] - KNOB[0])) * 100}%` }} data-l={s.label} className={s.label === '8/21' ? 'below' : ''} />
            ))}
            <b style={{ left: `${Math.min(1, Math.max(0, knobPos)) * 100}%` }} />
          </div>
          <span className="mono dim">{KNOB[1]}</span>
        </div>

        {LADDER.map((s, k) => (
          <figure
            key={s.label}
            className="rung mono"
            style={{ left: L.ladder[k].cx, top: L.ladder[k].cy + L.ladder[k].r + 12 }}
          >
            <b>{s.label}</b>
            <span className="dim">{fmt(ladderStats[k].mean, 2)}</span>
          </figure>
        ))}
        {!L.narrow && (
          <p className="mono dim ladder-cap" style={{ left: L.col0, top: L.ladder[0].cy - L.ladder[0].r - 34 }}>
            F<sub>k</sub>/F<sub>k+2</sub> → 1/φ² · 420 grains · mean NN × hex
          </p>
        )}
      </main>
    </>
  )
}

function read(f) {
  return {
    f,
    pk: packing(N, f),
    sp: spokes(N, f),
    fam: family(N, f),
    cs: convergents(f, 2000).filter((c) => c.q >= 2).slice(0, 10),
  }
}
