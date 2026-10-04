import { useEffect, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene, { BG, XS } from './Scene.jsx'
import { makeSet, scales, IMPACT_SPEEDS, LOOP, T_IMPACT } from './rig.js'

const params = new URLSearchParams(location.search)
const frozen = params.has('t') ? Number(params.get('t')) / 1000 : null // ms of physical time
const R0 = params.has('r') ? Number(params.get('r')) : 1.0

const ms = (s) => (s * 1e3).toFixed(1)

// Bottom strip: one row per drop, one bar per contact, on a shared time axis.
// The bars are measured from the integrator, not drawn to a length.
function Strip({ world }) {
  const ref = useRef()
  useEffect(() => {
    let raf
    const draw = () => {
      const cv = ref.current
      if (!cv) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const W = cv.clientWidth, H = cv.clientHeight
      if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr }
      const g = cv.getContext('2d')
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, W, H)
      const w = world.current
      const x0 = 92, x1 = W - 74
      const X = (t) => x0 + ((t - 0.045) / (LOOP - 0.045)) * (x1 - x0)
      const rowH = (H - 26) / w.set.length
      g.font = '10px "Helvetica Neue", Arial, "Liberation Sans", sans-serif'
      g.textBaseline = 'middle'
      // time ticks
      g.strokeStyle = 'rgba(30,34,38,0.12)'
      g.fillStyle = 'rgba(30,34,38,0.45)'
      g.lineWidth = 1
      for (let t = 0.05; t <= LOOP + 1e-9; t += 0.05) {
        const x = Math.round(X(t)) + 0.5
        g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H - 18); g.stroke()
        g.textAlign = 'center'
        g.fillText(`${Math.round(t * 1e3)} ms`, x, H - 8)
      }
      w.set.forEach((dp, i) => {
        const y = 4 + rowH * (i + 0.5)
        g.textAlign = 'left'
        g.fillStyle = 'rgba(30,34,38,0.7)'
        g.fillText(`${dp.V.toFixed(2)} m/s`, 0, y)
        g.fillStyle = 'rgba(30,34,38,0.35)'
        g.fillText(`${(dp.h * 1e3).toFixed(1)} mm`, 48, y)
        g.strokeStyle = 'rgba(30,34,38,0.18)'
        g.beginPath(); g.moveTo(x0, Math.round(y) + 0.5); g.lineTo(x1, Math.round(y) + 0.5); g.stroke()
        dp.contacts.forEach((c, k) => {
          const t1 = c.t1 ?? Math.min(w.t, LOOP)
          const a = X(c.t0), b = X(t1)
          g.fillStyle = k === 0 ? '#1d2226' : 'rgba(29,34,38,0.55)'
          g.fillRect(a, y - 4, Math.max(b - a, 1), 8)
        })
        const first = dp.contacts[0]
        if (first && first.t1) {
          g.textAlign = 'right'
          g.fillStyle = '#1d2226'
          g.fillText(`${ms(first.t1 - first.t0)}`, W - 30, y)
          g.fillStyle = 'rgba(30,34,38,0.4)'
          g.fillText('ms', W, y)
        }
      })
      // playhead
      const px = Math.round(X(Math.max(w.t, 0.045))) + 0.5
      g.strokeStyle = '#2f6fd6'
      g.beginPath(); g.moveTo(px, 0); g.lineTo(px, H - 18); g.stroke()
      raf = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [world])
  return <canvas ref={ref} className="strip" />
}

// Small labels under each drop, positioned from the 3D projection.
function Tags({ world }) {
  const refs = useRef([])
  useEffect(() => {
    let raf
    const tick = () => {
      const w = world.current
      w.set.forEach((dp, i) => {
        const el = refs.current[i]
        const p = w.screen[i]
        if (!el || !p) return
        el.style.transform = `translate(${p[0]}px, ${p[1]}px)`
        const last = dp.contacts[dp.contacts.length - 1]
        const on = dp.phase === 'contact'
        el.dataset.on = on ? '1' : '0'
        el.lastChild.textContent = on
          ? `on the floor ${ms(w.t - last.t0)} ms`
          : last && last.t1
          ? `${dp.contacts.length}× · last ${ms(last.t1 - last.t0)} ms`
          : 'falling'
      })
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [world])
  return (
    <div className="tags">
      {XS.map((_, i) => (
        <div className="tag" key={i} ref={(e) => (refs.current[i] = e)}>
          <b>{String(i + 1).padStart(2, '0')}</b>
          <span />
        </div>
      ))}
    </div>
  )
}

export default function App() {
  const [R, setR] = useState(R0)
  const world = useRef({
    set: makeSet(R0),
    t: frozen ?? 0.03,
    frozen,
    slow: 55,
    R: R0,
    screen: [],
  })
  const sc = scales(R)

  // Drag sideways to choose the radius; release re-drops all five.
  const drag = useRef(null)
  const onDown = (e) => (drag.current = { x: e.clientX, R })
  const onMove = (e) => {
    if (!drag.current) return
    const r = Math.min(1.5, Math.max(0.6, drag.current.R + (e.clientX - drag.current.x) / 600))
    setR(Math.round(r * 20) / 20)
  }
  const onUp = () => {
    if (!drag.current) return
    drag.current = null
    const w = world.current
    w.R = R
    w.set = makeSet(R)
    w.t = w.frozen ?? 0.03
  }

  return (
    <div className="stage" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
      <Canvas
        dpr={[1, 2]}
        camera={{ position: [0, 4.6, 34], fov: 33, near: 0.5, far: 600 }}
        onCreated={({ camera, scene }) => {
          camera.lookAt(0, 5.2, 0)
          scene.background = BG
        }}
        gl={{ antialias: true }}
        flat
      >
        <Scene world={world} />
      </Canvas>

      <header className="head">
        <p className="kicker">Study 095 — after ORBIS, “bounce back”</p>
        <h1>
          The time a drop
          <br />
          keeps the ground
        </h1>
        <p className="lede">
          Five water drops land on a floor they cannot wet, each four times harder than the last.
          They squash differently. They leave together. Surface tension is a spring, and a
          spring’s half-period does not ask how hard it was hit.
        </p>
      </header>

      <aside className="spec">
        <div>
          <span>τ ≈ 2.6 √(ρR³/σ)</span>
          <b>{ms(sc.tau)} ms</b>
        </div>
        <div>
          <span>R — drag ↔</span>
          <b>{R.toFixed(2)} mm</b>
        </div>
        <div>
          <span>impact energy</span>
          <b>×{Math.round((IMPACT_SPEEDS.at(-1) / IMPACT_SPEEDS[0]) ** 2)}</b>
        </div>
        <div>
          <span>replay</span>
          <b>1 / {world.current.slow}</b>
        </div>
      </aside>

      <Tags world={world} />

      <footer className="foot">
        <p className="axis">
          contact, measured · all five first land at {Math.round(T_IMPACT * 1e3)} ms
        </p>
        <Strip world={world} />
      </footer>
    </div>
  )
}
