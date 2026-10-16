import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'

// 地・岩・見出し・輪はすべて WebGL（輪が屈折で曲げられるのは scene の中にあるものだけ）。ナビと和文は DOM。
export default function App() {
  return (
    <>
      <Canvas className="gl" flat dpr={[1, 2]} gl={{ antialias: true }} camera={{ position: [0, 0, 10], fov: 30, near: 0.1, far: 60 }}>
        <Suspense fallback={null}>
          <Scene />
        </Suspense>
      </Canvas>
      <div className="ui">
        <header className="top">
          <a className="logo">
            <svg className="logo-mark" viewBox="0 0 30 20" fill="none" stroke="#E8D3A6" strokeWidth="3.2"><path d="M27 4 H9 a6 6 0 0 0 0 12 H27" /><path d="M14 10 H24" /></svg>
            <span>FOLIO NINE</span>
          </a>
          <nav className="nav">
            <span>ABOUT<i>+</i></span>
            <span>BUSINESS<i>+</i></span>
            <span>CAREER<i>+</i></span>
            <span>NEWS</span>
            <span>KNOWLEDGE</span>
            <span>EVENTS</span>
            <span>CONTACT</span>
          </nav>
          <div className="lang"><u>JA</u><b>|</b><em>EN</em></div>
        </header>
        <p className="lede">
          事業の高度を測ることから始める<br />羅針盤のような会社「FOLIO NINE」
        </p>
        <a className="credit" href="../../">
          <b>3D Daily</b> Day 106 — The Elevation Compass
          <span>A study after CARTA ZERO. Brand and copy are fictional.</span>
        </a>
      </div>
    </>
  )
}
