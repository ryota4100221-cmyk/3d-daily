import { useEffect, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'
import { TRACK, CHAPTERS, LAYERS, DESIGN_H } from './rig.js'

function useViewport() {
  const [v, setV] = useState({ w: window.innerWidth, h: window.innerHeight })
  useEffect(() => {
    const on = () => setV({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return v
}

export default function App() {
  const { w, h } = useViewport()
  const k = h / DESIGN_H // page px on the word plane scale with viewport height
  const track = TRACK * k
  const scrollRef = useRef(0)
  const stripRef = useRef()
  const barRef = useRef()
  const pxRef = useRef()
  const readout = useRef({})

  useEffect(() => {
    const q = new URLSearchParams(location.search).get('s')
    // ?s=<px> pins a scroll position without scrolling the window (headless
    // --screenshot captures nothing once the document itself is scrolled).
    const fixed = q !== null ? Number(q) * k : null
    const apply = () => {
      const y = fixed ?? window.scrollY
      scrollRef.current = y
      // The DOM strip is moved by the page, 1 px per px. Nothing projects it.
      if (stripRef.current) stripRef.current.style.transform = `translate3d(${-y}px,0,0)`
      if (barRef.current) barRef.current.style.width = `${Math.min(100, (y / track) * 100)}%`
      if (pxRef.current) pxRef.current.textContent = Math.round(y) + ' px'
    }
    apply()
    window.addEventListener('scroll', apply, { passive: true })
    return () => window.removeEventListener('scroll', apply)
  }, [track, k])

  return (
    <>
      <div style={{ height: h + track }} />
      <div className="stage">
        <Canvas flat dpr={[1, 2]} gl={{ antialias: true }} camera={{ manual: true, position: [0, 1.6, 0] }}>
          <Scene scrollRef={scrollRef} readout={readout} />
        </Canvas>
      </div>

      <div className="strip" ref={stripRef}>
        {CHAPTERS.map((c) => (
          <div className="cap" key={c.no} style={{ left: w / 2 + c.px * k, top: h * 0.79 }}>
            <span className="cap-line" />
            <span className="cap-row">
              <span className="cap-no">{c.no}</span>
              <span className="cap-en">{c.en}</span>
            </span>
            <span className="cap-ja">{c.ja}</span>
          </div>
        ))}
        <div className="cap end" style={{ left: w / 2 + (TRACK + 500) * k, top: h * 0.79 }}>
          <span className="cap-en">Live with comfort.</span>
          <span className="cap-ja">心地よさと暮らす家</span>
        </div>
      </div>

      <header className="head">
        <p className="kicker">3D Daily · Day 085 · after Shichifuku (e-729.com)</p>
        <h1>The Depth the Page<br />Is Sewn To</h1>
        <p className="lede">
          A horizontal-scroll strip, but the camera travels instead of the strip.
          A truck of Δx moves a point at distance d by Δx·K/d — so <b>exactly one depth</b> keeps
          pace with the page. The wordmark sits there, and the captions below are plain DOM
          moved by the scroll alone. Frames overtake it; the ridge falls behind.
        </p>
      </header>

      <aside className="meter">
        <div className="meter-row meter-head"><span>Layer</span><span>d</span><span>px / scroll px</span></div>
        {LAYERS.map((l) => (
          <div className={'meter-row' + (l.key === 'word' ? ' sewn' : '')} key={l.key}>
            <span>{l.label}</span>
            <span>{l.d} m</span>
            <b ref={(el) => (readout.current[l.key] = el)}>—</b>
          </div>
        ))}
        <div className="meter-row"><span>Camera x</span><span /><b ref={(el) => (readout.current.cam = el)}>—</b></div>
      </aside>

      <footer className="foot">
        <span>Scroll ↓ &nbsp;travels →</span>
        <div className="bar"><i ref={barRef} /></div>
        <span ref={pxRef}>0 px</span>
      </footer>
    </>
  )
}
