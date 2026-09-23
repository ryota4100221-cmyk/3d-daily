import { useEffect, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'
import { R, WEIGHTS, inkO, counterO } from './rig.js'

const f = (x, n = 3) => x.toFixed(n)

// Live readout of the breathing row. Written straight into the DOM from rAF —
// React state at 60 Hz would re-render the table for nothing.
function Live() {
  const w = useRef(), c = useRef(), name = useRef(), bar = useRef()
  useEffect(() => {
    let id
    const tick = () => {
      const r = window.__weight
      if (r != null && w.current) {
        const open = r < R
        w.current.textContent = f(r, 3)
        c.current.textContent = open ? f(R - r, 3) : 'closed'
        c.current.dataset.closed = open ? '0' : '1'
        let k = 0
        for (let i = 0; i < 10; i++) if (r >= WEIGHTS[i].r * 0.999) k = i
        name.current.textContent = !open ? 'Counters shut' : r > WEIGHTS[9].r ? 'Beyond Black' : WEIGHTS[k].name
        bar.current.style.width = `${Math.min(100, (100 * r) / (R * 1.12))}%`
      }
      id = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(id)
  }, [])
  return (
    <div className="live">
      <div className="live-name" ref={name}>Regular</div>
      <div className="live-row"><span>half-stroke r</span><b ref={w}>0.100</b></div>
      <div className="live-row"><span>counter left R − r</span><b ref={c}>0.400</b></div>
      <div className="live-track"><i ref={bar} /><em style={{ left: `${100 / 1.12}%` }}>R</em></div>
    </div>
  )
}

export default function App() {
  return (
    <>
      <Canvas
        dpr={[1, 2]}
        camera={{ position: [0, 0, 22], fov: 36, near: 0.1, far: 80 }}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
      >
        <Scene />
      </Canvas>

      <header className="head">
        <p className="kicker">Day 084 · after PP Neue Montreal — Pangram Pangram specimen</p>
        <h1>Weight<br />is a radius.</h1>
        <p className="lede">
          Eleven weights, one skeleton. Every row is the same single line, inked out to
          distance <i>r</i>. The bowls of <i>b o d</i> are one circle of radius <i>R</i>, so all
          three counters shut at the same weight — <b>r = R</b> — and not a hair before.
        </p>
      </header>

      <Live />

      <table className="ramp">
        <thead>
          <tr><th>weight</th><th>r</th><th>ink of o</th><th>counter</th></tr>
        </thead>
        <tbody>
          {WEIGHTS.map((w) => (
            <tr key={w.name} className={w.r >= R ? 'shut' : ''}>
              <td>{w.name}</td>
              <td>{f(w.r)}</td>
              <td>{f(inkO(w.r))}</td>
              <td>{w.r >= R ? '—' : f(counterO(w.r))}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <footer className="foot">
        <span>ink(o) = 4πRr while open · π(R+r)² once shut</span>
        <span>the counter is the largest empty circle: R − r</span>
      </footer>
    </>
  )
}
