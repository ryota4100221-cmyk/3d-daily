import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { AudioEngine } from './audio.js'
import Scene from './Scene.jsx'

export default function App() {
  // one engine instance for the whole app
  const engine = useMemo(() => new AudioEngine(), [])
  // ?nogate=1 hides the start overlay (used for the preview capture). Audio still
  // needs a gesture, but the synthetic-spectrum fallback keeps the scene alive.
  const nogate = useMemo(
    () => new URLSearchParams(window.location.search).has('nogate'),
    [],
  )
  const [started, setStarted] = useState(false)
  const [muted, setMuted] = useState(false)
  const levelRef = useRef(null)

  const begin = async () => {
    await engine.start()
    setStarted(true)
  }

  const toggleMute = () => {
    const m = !muted
    setMuted(m)
    engine.setMuted(m)
  }

  // lightweight HUD level meter (reads engine each frame without re-rendering React)
  useEffect(() => {
    let raf
    const tick = () => {
      if (levelRef.current) {
        const w = Math.round(engine.level * 100)
        levelRef.current.style.width = `${Math.max(2, w)}%`
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [engine])

  return (
    <div className="app">
      <Canvas
        shadows
        flat
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: false }}
        camera={{ position: [0, 4.3, 10.8], fov: 38, near: 0.1, far: 100 }}
      >
        <Scene engine={engine} />
      </Canvas>

      {/* --- typographic overlay --- */}
      <div className="ui">
        <header className="top">
          <div className="mark">3D · DAILY</div>
          <div className="day">DAY 026</div>
        </header>

        <div className="bottom">
          <div className="title">
            <h1>RESONANCE</h1>
            <p className="sub">A generative score, rendered as matter.</p>
          </div>

          <footer className="bot">
            <div className="meta">
              <span>WEEK 04 — COMPOSITION &amp; POLISH</span>
              <span>WEBAUDIO · FFT · INSTANCED FIELD</span>
            </div>
            <div className="meter">
              <span className="lbl">LEVEL</span>
              <div className="track"><i ref={levelRef} /></div>
            </div>
          </footer>
        </div>

        {started && (
          <button className="mute" onClick={toggleMute}>
            {muted ? 'SOUND OFF' : 'SOUND ON'}
          </button>
        )}
      </div>

      {!started && !nogate && (
        <div className="gate" onClick={begin}>
          <div className="gate-inner">
            <div className="ring" />
            <button className="begin" onClick={begin}>BEGIN</button>
            <p className="hint">click to let it play · move to conduct</p>
          </div>
        </div>
      )}
    </div>
  )
}
