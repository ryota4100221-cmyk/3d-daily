import { useEffect, useMemo, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'
import { drawSketch } from './sketch.js'

// 架空のマーク：3枚の葉が下の1点から開く（再現元の木の形のマークとは別の形）
function Mark() {
  return (
    <svg className="mark" width="38" height="38" viewBox="0 0 38 38">
      <path d="M19 33 C 11 26, 10 15, 19 5 C 28 15, 27 26, 19 33 Z" fill="#B08A4E" />
      <path d="M18 33 C 9 33, 3 26, 3 17 C 11 18, 17 24, 18 33 Z" fill="#B08A4E" opacity="0.85" />
      <path d="M20 33 C 29 33, 35 26, 35 17 C 27 18, 21 24, 20 33 Z" fill="#B08A4E" opacity="0.85" />
      <rect x="18" y="20" width="2" height="15" fill="#4A4C40" />
    </svg>
  )
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }

export default function App() {
  const sketch = useMemo(() => document.createElement('canvas'), [])
  const holder = useRef()
  const state = useMemo(() => ({ model: 0, gain: 0.9, baked: null }), [])
  const q = new URLSearchParams(location.search)

  useEffect(() => {
    const draw = () => drawSketch(sketch, 2, "'Caveat', cursive")
    const f = new FontFace('Caveat', `url(${import.meta.env.BASE_URL}Caveat.ttf)`)
    f.load().then((ff) => { document.fonts.add(ff); draw() }).catch(draw)
    draw()
    holder.current.appendChild(sketch)
    const t0 = performance.now()
    let raf
    const tick = () => {
      const t = (performance.now() - t0) / 1000
      const intro = q.has('sketch') ? 0 : smooth(0.8, 4.2, t)
      const p = Math.min(1, window.scrollY / (window.innerHeight * 1.4))
      state.model = intro * (1 - smooth(0, 1, p))
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <>
      <div className="stage">
        <div className="bg" />
        <div className="sketch" ref={holder} />
        <Canvas className="gl" flat dpr={[1, 2]} gl={{ antialias: true, alpha: true }} camera={{ fov: 28, near: 1, far: 80 }}>
          <Scene sketch={sketch} state={state} />
        </Canvas>
        <div className="fog" />
        <nav className="pill">
          <span className="menu"><i /><i />MENU</span>
          <Mark />
          <span className="inq">INQUIRE<em>⟶</em></span>
        </nav>
        <a className="credit" href="../../">
          <b>3D Daily</b>
          <span className="t">Day 110 — The Facade That Rises from Its Sketch</span>
          <span>A study after Belgrade Arbor. Brand and copy are fictional.</span>
        </a>
      </div>
      <div className="runway" />
    </>
  )
}
