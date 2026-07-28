import { useState, useEffect } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'
import Pipeline from './Pipeline.jsx'

const PASSES = [
  { key: 'Composite', note: 'beauty · reflection · grade' },
  { key: 'Beauty', note: 'lit scene only' },
  { key: 'Normals', note: 'G-buffer, attachment 0' },
  { key: 'Motion', note: 'G-buffer, attachment 1' },
  { key: 'Reflection', note: 'accumulated SSR' },
]

export default function App() {
  const [mode, setMode] = useState(0)

  useEffect(() => {
    const onKey = (e) => {
      const i = Number(e.key)
      if (i >= 1 && i <= PASSES.length) setMode(i - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="app">
      <Canvas
        flat
        shadows
        dpr={[1, 2]}
        gl={{ antialias: false, alpha: false, powerPreference: 'high-performance' }}
        camera={{ position: [0, 0.62, 8.4], fov: 30, near: 0.1, far: 80 }}
      >
        <Scene />
        <Pipeline mode={mode} />
      </Canvas>

      <div className="ui">
        <div className="top">
          <div className="mark">3D&nbsp;Daily</div>
          <div className="day">Day&nbsp;029 · ★★★★★</div>
        </div>

        <div className="lead">
          <div className="eyebrow">Loop 02 · Reflection</div>
          <h1>
            Basin<em>.</em>
          </h1>
          <p className="sub">
            Still water is not a material. It is whatever is standing above it,
            traced back through the surface — so the basin here is drawn almost
            black, and everything you read as water is a ray marched across the
            screen and gathered, frame after frame, through its own motion.
          </p>
        </div>

        <div className="bottom">
          <div className="meta">
            <span>MRT&nbsp;G&#8209;buffer · one draw, two attachments</span>
            <span>Screen&#8209;space reflections · 48 steps + binary refine</span>
            <span>Motion&#8209;vector reprojection · history survives the drift</span>
          </div>

          <div className="passes">
            <div className="passes-label">Render pass</div>
            <ul>
              {PASSES.map((p, i) => (
                <li
                  key={p.key}
                  className={i === mode ? 'on' : ''}
                  onClick={() => setMode(i)}
                >
                  <span className="idx">{i + 1}</span>
                  <span className="name">{p.key}</span>
                  <span className="note">{p.note}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
