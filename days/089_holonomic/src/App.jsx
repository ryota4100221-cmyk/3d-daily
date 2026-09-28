import { useRef, useCallback } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'
import { balls } from './rig.js'

const f2 = (v) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2)

export default function App() {
  const vRef = useRef(), wRef = useRef(), thRef = useRef(), modeRef = useRef(), spinRef = useRef([])
  const onRead = useCallback((s) => {
    if (!vRef.current) return
    vRef.current.textContent = `${f2(s.twist.vx)}  ${f2(s.twist.vz)}`
    wRef.current.textContent = f2(s.twist.w)
    thRef.current.textContent = `${((((s.pose.th * 180) / Math.PI) % 360) + 360) % 360 | 0}°`
    modeRef.current.textContent = s.auto ? 'autopilot — square, heading free' : s.holding ? 'held — turning in place' : 'following pointer'
    s.ball.forEach((b, i) => {
      const el = spinRef.current[i]
      if (el) el.style.setProperty('--k', Math.min(b.spin / 14, 1).toFixed(3))
    })
  }, [])

  return (
    <>
      <Canvas
        orthographic
        shadows
        dpr={[1, 2]}
        camera={{ position: [10, 11, 10], zoom: 88, near: 0.1, far: 100 }}
        onCreated={({ camera }) => {
          // frame the square the autopilot walks up and to the right of the type
          camera.position.set(0.8 + 10, 11, 1.5 + 10)
          camera.lookAt(0.8, 0, 1.5)
        }}
      >
        <Scene onRead={onRead} />
      </Canvas>

      <header className="top">
        <span className="mark">3D Daily <b>089</b></span>
        <span className="after">After — TriOrb, Recruit site</span>
      </header>

      <section className="title">
        <p className="kicker">Omnidirectional transport / three units, nine spheres</p>
        <h1>Every direction<br />is forward.</h1>
        <p className="lede">
          A wheel has one axis. A sphere has all of them. Each ball reads its own contact
          velocity off the load&apos;s twist and rolls the only way that does not slip — so the
          load walks a square without ever turning to face it.
        </p>
      </section>

      <aside className="read">
        <div className="row"><span>V  (x, z)</span><b ref={vRef}>—</b></div>
        <div className="row"><span>Ω</span><b ref={wRef}>—</b></div>
        <div className="row"><span>Heading</span><b ref={thRef}>—</b></div>
        <div className="eq">ω<sub>b</sub> = n × (V + Ω × r) / R</div>
        <div className="spins">
          {balls.map((_, i) => (
            <i key={i} ref={(el) => (spinRef.current[i] = el)} />
          ))}
        </div>
        <div className="mode" ref={modeRef}>—</div>
      </aside>

      <footer className="hint">Move to steer · Hold to turn in place</footer>
    </>
  )
}
