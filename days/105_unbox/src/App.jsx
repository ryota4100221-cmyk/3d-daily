import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'
import Backdrop from './Backdrop.jsx'

// 地（平らな黄と2つのベタの波）は SVG、本だけが WebGL。文字は DOM。
const CAM = { position: [0, 0, 10], fov: 30, near: 0.1, far: 50 }

export default function App() {
  return (
    <>
      <Backdrop />
      {/* 奥と手前の2冊は別の canvas に置いてぼかす（被写界深度の代わり） */}
      <Canvas className="gl gl-back" flat dpr={[1, 2]} gl={{ alpha: true, antialias: true }} camera={CAM}>
        <Scene layer="back" />
      </Canvas>
      <Canvas className="gl" flat dpr={[1, 2]} gl={{ alpha: true, antialias: true }} camera={CAM}>
        <Scene layer="front" />
      </Canvas>
      <div className="ui">
        <header className="top">
          <a className="logo">
            <svg className="logo-mark" viewBox="0 0 30 34" fill="#000"><path d="M3 30 C3 18 9 9 18 6 L17 2 L21 6 C26 8 28 13 27 18 C25 14 21 13 18 15 C22 17 23 22 20 26 C17 30 10 32 3 30 Z" /></svg>
            <span className="logo-word">Pangolin</span>
            <span className="logo-sub">BOOK<br />CLUB</span>
          </a>
          <nav className="pills">
            <span className="pill">All Books</span>
            <span className="pill">Gifting</span>
            <span className="pill">Merch</span>
            <span className="pill">FAQ</span>
            <span className="pill pill-or">Log-in / Sign-up<i>→</i></span>
          </nav>
          <div className="right">
            <span className="pill"><svg width="18" height="12" viewBox="0 0 18 12" style={{ marginRight: 6 }}><rect width="18" height="12" fill="#2a3f8f" /><path d="M0 0L18 12M18 0L0 12" stroke="#fff" strokeWidth="2.4" /><path d="M9 0V12M0 6H18" stroke="#fff" strokeWidth="3.6" /><path d="M9 0V12M0 6H18" stroke="#d22" strokeWidth="2" /></svg>Shipping from the UK?</span>
            <span className="dot">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#FFD24A" strokeWidth="2.2"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.3" cy="6.7" r="0.6" fill="#FFD24A" /></svg>
            </span>
            <span className="dot">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="#FFD24A"><path d="M14 3h3c.3 2 1.6 3.4 3.6 3.6v3c-1.4 0-2.6-.4-3.6-1.1V15a6 6 0 1 1-6-6v3.1A3 3 0 1 0 14 15V3z" /></svg>
            </span>
          </div>
        </header>
        <h1 className="hero">
          Unwrap books<br />worth passing<br />around
        </h1>
        <p className="lede">
          A book club that reads like a dinner party. Pick up to 3 new titles every month, find them on your
          doorstep, then argue about the endings with everyone else.
        </p>
        <span className="cta">Log-in / Sign-up now<i>→</i></span>
        <p className="hand">Posted to<br />your door<br />monthly</p>
        <svg className="a11y" viewBox="0 0 60 60" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="30" cy="30" r="27" />
          <circle cx="30" cy="15.5" r="3.2" fill="#fff" stroke="none" />
          <path d="M17 23 L30 26 L43 23 M30 26 L30 35 L23 47 M30 35 L37 47" />
        </svg>
        <p className="credit">Day 105 — after Aardvark Book Club</p>
      </div>
    </>
  )
}
