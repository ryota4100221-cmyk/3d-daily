import { useEffect, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'
import { DELTA, EPS } from './rig.js'

const qs = new URLSearchParams(location.search)
const fmt = (v) => v.toFixed(6).replace(/(\d{3})$/, ' $1')

export default function App() {
  const m0 = qs.get('m') === '1' ? 1 : 0
  const state = useRef({
    t: Number(qs.get('t') || 7.5),
    speed: 1,
    mix: m0,
    target: m0,
    dragX: 0,
    dragY: 0,
    width: 1,
    lo: Infinity,
    hi: -Infinity,
    frames: 0,
  })
  const [gleich, setGleich] = useState(m0 === 0)
  const gap = useRef(), spread = useRef(), lohi = useRef()

  useEffect(() => {
    let raf
    const tick = () => {
      const s = state.current
      if (gap.current && s.frames) {
        gap.current.textContent = fmt(s.width)
        spread.current.textContent = fmt(s.hi - s.lo)
        lohi.current.textContent = `${s.lo.toFixed(3)} – ${s.hi.toFixed(3)}`
      }
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [])

  const flip = () => {
    const s = state.current
    s.target = s.target ? 0 : 1
    s.lo = Infinity
    s.hi = -Infinity
    setGleich(s.target === 0)
  }

  return (
    <>
      <Canvas dpr={[1, 2]} camera={{ fov: 9, near: 1, far: 60 }} gl={{ antialias: true }}>
        <Scene state={state} />
      </Canvas>

      <div className="word left" aria-hidden>bleibt</div>
      <div className={'word right' + (gleich ? '' : ' un')} aria-hidden>{gleich ? 'gleich' : 'ungleich'}</div>

      <header>
        <span>Day 103</span>
        <span>after bleibtgleich.dev</span>
      </header>

      <aside className="read">
        <div className="k">gap between the plates</div>
        <div className="v" ref={gap}>1.000 000</div>
        <div className="k">max − min, since you started watching</div>
        <div className="v small" ref={spread}>0.000 000</div>
        <div className="k">range</div>
        <div className="v small" ref={lohi}>—</div>
      </aside>

      <footer>
        <h1>
          The width
          <br />
          that stays the same.
        </h1>
        <p>
          One support function, h(u) = ½ + ε·p(u), with p an odd cubic. Squeeze it from any
          two opposite sides and you read h(u) + h(−u) = 1 — so the upper plate never
          moves, however lumpy the body turns. Drag to turn it yourself.
        </p>
        <button onClick={flip}>{gleich ? 'make it ungleich' : 'make it gleich'}</button>
        <small>
          ε = {EPS.toFixed(4)} (96 % of the convex limit) · twin: 0.6ε + δ·q, δ = {DELTA.toFixed(4)}
        </small>
      </footer>
    </>
  )
}
