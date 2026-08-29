import { useEffect, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'
import { scroll } from './rig.js'

export default function App() {
  const [pct, setPct] = useState(0)

  useEffect(() => {
    const onScroll = () => {
      const max = document.body.scrollHeight - window.innerHeight
      const v = max > 0 ? window.scrollY / max : 0
      scroll.target = v
      setPct(v)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <>
      <div className="stage">
        <Canvas
          dpr={[1, 1.75]}
          gl={{ antialias: true }}
          camera={{ position: [0, 0.15, 3.15], fov: 40, near: 0.1, far: 40 }}
          onCreated={({ gl }) => gl.setClearColor('#070202', 1)}
        >
          <Scene />
        </Canvas>
      </div>

      <div className="scrim" aria-hidden="true" />

      <div className="ui">
        <header>
          <span className="no">061</span>
          <span className="ttl">THE ONE&#8209;DIMENSIONAL SKY</span>
          <span className="src">AFTER — IVS2026, KYOTO</span>
        </header>

        <h1>
          <span>METAL IS NOT A MATERIAL.</span>
          <span>IT IS A SKY WITH ONE STRIP IN IT.</span>
        </h1>

        <dl className="spec">
          <div><dt>ENVIRONMENT</dt><dd>256 × 1 px</dd></div>
          <div><dt>LIGHTS</dt><dd>0</dd></div>
          <div><dt>NORMAL</dt><dd>analytic ∂h</dd></div>
          <div><dt>MESH</dt><dd>220 × 140</dd></div>
          <div><dt>SCROLL</dt><dd>{(pct * 100).toFixed(1)} %</dd></div>
        </dl>

        <span className="hint">SCROLL TO SWEEP THE BAND</span>
      </div>

      <div className="scroller" aria-hidden="true" />
    </>
  )
}
