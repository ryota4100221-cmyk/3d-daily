import { useEffect, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import Bubbles from './Bubbles.jsx'

// 架空のマーク：角の丸い正方形の輪と、半分の円（再現元の2つの記号とは別の形）
function Mark() {
  return (
    <svg className="mark" width="62" height="30" viewBox="0 0 62 30">
      <rect x="2" y="2" width="26" height="26" rx="8" fill="none" stroke="#fff" strokeWidth="4" />
      <path d="M34 2 H44 A13 13 0 0 1 44 28 H34 Z" fill="#fff" />
    </svg>
  )
}

const LINKS = ['Company', 'Programs', 'Partnerships', 'Insights', 'Careers']

export default function App() {
  const pointer = useMemo(() => ({ x: 0, y: 0 }), [])
  useEffect(() => {
    const onMove = (e) => {
      pointer.x = (e.clientX / innerWidth) * 2 - 1
      pointer.y = (e.clientY / innerHeight) * 2 - 1
    }
    addEventListener('pointermove', onMove)
    return () => removeEventListener('pointermove', onMove)
  }, [])

  return (
    <div className="stage">
      <Canvas className="gl" flat dpr={[1, 2]} gl={{ antialias: false }} orthographic camera={{ position: [0, 0, 1] }}>
        <Bubbles pointer={pointer} />
      </Canvas>

      <svg width="0" height="0" style={{ position: 'absolute' }}>
        <filter id="goo">
          <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="b" />
          <feColorMatrix in="b" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -10" />
        </filter>
      </svg>

      <header className="nav">
        <div className="logo">
          <Mark />
          <span>KESTREL<br />BIOLOGICS</span>
        </div>
        <nav className="links">
          <div className="pills">{LINKS.map((l) => <i key={l} />)}</div>
          <div className="labels">
            {LINKS.map((l, i) => (
              <span key={l}>{l}{i === 0 && <svg width="11" height="8" viewBox="0 0 11 8"><path d="M1.5 2 L5.5 6 L9.5 2" stroke="#fff" strokeWidth="1.5" fill="none" /></svg>}</span>
            ))}
          </div>
        </nav>
        <span className="contact">Contact</span>
      </header>

      <div className="hero">
        <h1>Equivalence isn’t<br />stumbled upon. It’s<br />constructed.</h1>
        <p>Accuracy in every strand.</p>
      </div>

      <span className="down"><svg width="16" height="18" viewBox="0 0 16 18"><path d="M8 1 V16 M2 10 L8 16 L14 10" stroke="#3f7f82" strokeWidth="1.6" fill="none" /></svg></span>
      <span className="touch"><i className="dots"><b /><b /><b /><b /></i>Get in touch</span>

      <a className="credit" href="../../">
        <b>3D Daily</b>
        <span className="t">Day 112 — Where Two Bubbles Meet</span>
        <span>A study after Polpharma Biologics. Brand and copy are fictional.</span>
      </a>
    </div>
  )
}
