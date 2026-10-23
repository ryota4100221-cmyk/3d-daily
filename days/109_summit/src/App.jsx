import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'

// 山と雲だけが WebGL。空のグラデ・ナビ・ロゴ・SCROLL は DOM（再現元も DOM）
function Mark() {
  // 架空のマーク：六方に伸びる点の結晶（再現元の「点の木」とは別の形）
  const dots = []
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI) / 3 - Math.PI / 2
    for (let j = 1; j <= 4; j++) {
      const r = j * 6.4
      dots.push([30 + Math.cos(a) * r, 30 + Math.sin(a) * r, j === 4 ? 2.2 : 2.6])
      if (j === 2 || j === 3) for (const s of [-1, 1]) {
        const b = a + s * 0.62
        const r2 = 5.2 * (j === 2 ? 1 : 0.8)
        dots.push([30 + Math.cos(a) * r + Math.cos(b) * r2, 30 + Math.sin(a) * r + Math.sin(b) * r2, 1.9])
      }
    }
  }
  dots.push([30, 30, 3.2])
  return (
    <svg className="mark" width="60" height="60" viewBox="0 0 60 60">
      {dots.map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r} fill="#2D628C" />)}
    </svg>
  )
}

export default function App() {
  return (
    <>
      <div className="sky" />
      <Canvas className="gl" flat dpr={[1, 2]} gl={{ antialias: true, alpha: true }} camera={{ fov: 27, near: 0.5, far: 600 }}>
        <Suspense fallback={null}>
          <Scene />
        </Suspense>
      </Canvas>
      <div className="ui">
        <nav className="nav">
          <span className="on">Briseval Group</span>
          <span>Briseval Trading</span>
          <span>Briseval Capital</span>
          <span>Briseval Maritime</span>
          <span>Vale Energy</span>
        </nav>
        <div className="navline" />
        <p className="right"><span>News</span><b>14</b><span>Menu</span><i /><i /></p>
        <div className="logo"><Mark /><em /><span>BRISEVAL</span></div>
        <p className="scroll">Scroll down to discover</p>
        <div className="dash" />
        <a className="credit" href="../../">
          <b>3D Daily</b>
          <span className="t">Day 109 — Above the Cloud Line</span>
          <span>A study after Montfort Group. Brand and copy are fictional.</span>
        </a>
      </div>
    </>
  )
}
