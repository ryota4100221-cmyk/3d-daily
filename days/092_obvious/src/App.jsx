import { useEffect, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'
import { loudness, SPAN } from './rig.js'

const fixed = new URLSearchParams(location.search).get('p')

const tc = (s) => {
  const m = Math.floor(s / 60)
  const r = s - m * 60
  return `${String(m).padStart(2, '0')}:${r.toFixed(2).padStart(5, '0')}`
}

const STATES = [
  [0.18, 'Face', 'What you read. Every strip has the same front.'],
  [0.72, 'Depth', 'What was said. Each strip is as deep as the voice was loud.'],
  [1.01, 'Plan', 'From above, the headline is a recording.'],
]

export default function App() {
  const progress = useRef(fixed != null ? Number(fixed) : 0)
  const angle = useRef()
  const time = useRef()
  const meter = useRef()
  const state = useRef()
  const note = useRef()
  const lastState = useRef(-1)

  useEffect(() => {
    if (fixed != null) return
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - innerHeight
      progress.current = max > 0 ? scrollY / max : 0
    }
    addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => removeEventListener('scroll', onScroll)
  }, [])

  const hud = (p, off) => {
    if (angle.current) angle.current.textContent = String(Math.round(p * 100)).padStart(3, '0')
    if (time.current) time.current.textContent = tc(off)
    if (meter.current) {
      // the strip at the left edge is "now"
      const l = loudness(off)
      meter.current.style.transform = `scaleX(${l.toFixed(3)})`
    }
    const i = STATES.findIndex(([q]) => p < q)
    if (i !== lastState.current && state.current) {
      lastState.current = i
      state.current.textContent = STATES[i][1]
      note.current.textContent = STATES[i][2]
    }
  }

  return (
    <>
      <div className="stage">
        <Canvas orthographic camera={{ position: [0, 0, 30], zoom: 200, near: -200, far: 200 }} dpr={[1, 2]} gl={{ antialias: true }}>
          <color attach="background" args={['#f7f6f3']} />
          <Scene progress={progress} hud={hud} />
        </Canvas>
      </div>

      <header className="top">
        <span>Nippori Seminar</span>
        <span className="mid">A reading of “Under the Obvious”</span>
        <span>Day 092</span>
      </header>

      <aside className="left">
        <p className="label">Leading 75% · Tracking −5% · 900 strips</p>
        <p className="body">
          The face never moves. Behind it, each strip is pushed back by how loud a voice is at that instant — {SPAN.toFixed(0)} seconds of
          speech laid across three lines, sliding right to left. Scroll to turn the type.
        </p>
      </aside>

      <footer className="bottom">
        <div className="state">
          <span className="k" ref={state}>Face</span>
          <span className="v" ref={note}>What you read.</span>
        </div>
        <div className="read">
          <span><i>Turn</i> <b ref={angle}>000</b></span>
          <span><i>Rec</i> <b ref={time}>00:00.00</b></span>
          <span className="meter"><em ref={meter} /></span>
        </div>
      </footer>

      <div className="scroll" />
    </>
  )
}
