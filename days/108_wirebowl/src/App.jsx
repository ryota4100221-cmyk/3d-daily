import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'

// 鉢だけが WebGL（正投影・1 unit = 1 px）。ロゴ・ナビ・SCROLL・赤い弧は DOM（再現元も DOM）
export default function App() {
  return (
    <>
      <div className="ground" />
      {/* 地のむら：再現元の漆喰のような斑。低周波の乱流を白黒の濃淡にして薄く重ねる */}
      <svg className="mottle" width="1440" height="900" preserveAspectRatio="none" viewBox="0 0 1440 900">
        <filter id="mott"><feTurbulence type="fractalNoise" baseFrequency="0.0035 0.005" numOctaves="4" seed="11" /><feColorMatrix type="saturate" values="0" /><feComponentTransfer><feFuncA type="linear" slope="0" intercept="1" /></feComponentTransfer></filter>
        <rect width="1440" height="900" filter="url(#mott)" />
      </svg>
      <Canvas className="gl" orthographic flat dpr={[1, 2]} gl={{ antialias: true, alpha: true }} camera={{ position: [0, 0, 1500], zoom: 1, near: 1, far: 4000 }}>
        <Suspense fallback={null}>
          <Scene />
        </Suspense>
      </Canvas>
      <div className="ui">
        <svg width="0" height="0" style={{ position: 'absolute' }}>
          <filter id="rough"><feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="2" seed="7" /><feDisplacementMap in="SourceGraphic" scale="3.2" /></filter>
        </svg>
        <a className="logo">KAESHI</a>
        <nav className="nav">
          <span>Location</span>
          <span>Menu</span>
          <span>News</span>
          <span>Journal</span>
          <span>About</span>
        </nav>
        <p className="lang"><span>Ja</span><i>|</i><u>En</u></p>
        <p className="scroll">SCROLL</p>
        <div className="scroll-line" />
        <div className="red" />
        <a className="credit" href="../../">
          <b>3D Daily</b>
          <span className="t">Day 108 — Where the Brush Passes</span>
          <span>A study after MENSHO. Brand and copy are fictional.</span>
        </a>
      </div>
    </>
  )
}
