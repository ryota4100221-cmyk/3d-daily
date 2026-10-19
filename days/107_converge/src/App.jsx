import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'

// 三角錐だけが WebGL（正投影・1 unit = 1 px）。見出し・ロゴ・ナビは DOM（再現元も DOM の文字）
function LogoMark() {
  // 傾いた楕円の上に小さな三角錐を並べた輪（骨格だけ借りて、枚数と欠け方は変えた）。各片は明・暗の2面
  const n = 11
  const tris = Array.from({ length: n }, (_, i) => {
    const a = -0.35 + (i / n) * Math.PI * 2 * 0.95
    const cx = 41 + 34 * Math.cos(a), cy = 30 + 24 * Math.sin(a)
    const deg = (a * 180) / Math.PI + 90 + (i % 2 ? 8 : -6)
    const s = 1.3 + 0.2 * Math.sin(i * 1.7)
    return (
      <g key={i} transform={`translate(${cx} ${cy}) rotate(${deg}) scale(${s})`}>
        <path d="M-5.5 3.5 L0 -6 L0 3.5 Z" fill="#48DADE" />
        <path d="M0 -6 L5.5 3.5 L0 3.5 Z" fill="#00AFAF" />
      </g>
    )
  })
  return <svg className="logo-mark" viewBox="0 0 82 60">{tris}</svg>
}

export default function App() {
  return (
    <>
      <Canvas className="gl" orthographic flat dpr={[1, 2]} gl={{ antialias: true }} camera={{ position: [0, 0, 1000], zoom: 1, near: 1, far: 3000 }}>
        <Suspense fallback={null}>
          <Scene />
        </Suspense>
      </Canvas>
      <div className="ui">
        <a className="logo">
          <LogoMark />
          <span className="logo-type">
            <b>KANAE GROUP</b>
            <small>A Gathering Point for Ideas and Makers in the Shared Age</small>
          </span>
        </a>
        <h1 className="hero">
          Gathering for<br />Ideas and Imagination<br />in the Shared Age
        </h1>
        <p className="scroll">SCROLL <i>▼</i></p>
        <nav className="bar">
          <span>リサーチ</span>
          <span>デザイン</span>
          <span>採用・育成<svg className="ext" viewBox="0 0 12 12" fill="none" stroke="#333" strokeWidth="1.3"><path d="M5 1.5H1.5v9h9V7" /><path d="M7 1.5h3.5V5M10.5 1.5 5.5 6.5" /></svg></span>
          <span>地域ビジネス<svg className="ext" viewBox="0 0 12 12" fill="none" stroke="#333" strokeWidth="1.3"><path d="M5 1.5H1.5v9h9V7" /><path d="M7 1.5h3.5V5M10.5 1.5 5.5 6.5" /></svg></span>
        </nav>
        <a className="credit" href="../../">
          <b>3D Daily</b>
          <span className="t">Day 107 — The Gathering Point</span>
          <span>A study after KAIGI GROUP. Brand and copy are fictional.</span>
        </a>
      </div>
    </>
  )
}
