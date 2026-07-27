import { useState, useEffect } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene.jsx'
import Pipeline from './Pipeline.jsx'

const PASSES = [
  { id: 0, key: 'Composite', note: 'beauty · occlusion · contour · grade' },
  { id: 1, key: 'Beauty', note: 'lit scene, graded only' },
  { id: 2, key: 'Normals', note: 'G-buffer, view space' },
  { id: 3, key: 'Occlusion', note: 'accumulated SSAO' },
]

export default function App() {
  const [mode, setMode] = useState(0)

  useEffect(() => {
    const onKey = (e) => {
      const i = Number(e.key)
      if (i >= 1 && i <= 4) setMode(i - 1)
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
        camera={{ position: [-0.15, 1.34, 5.45], fov: 34, near: 0.1, far: 60 }}
      >
        <Scene />
        <Pipeline mode={mode} />
      </Canvas>

      <div className="ui">
        <div className="top">
          <div className="mark">3D&nbsp;Daily</div>
          <div className="day">Day&nbsp;028 · ★★★★★</div>
        </div>

        <div className="bottom">
          <div className="lead">
            <div className="eyebrow">Month One · Capstone</div>
            <h1>
              Atelier<em>.</em>
            </h1>
            <p className="sub">
              Twenty-seven days of parts, rebuilt around a renderer of our own.
              The scene is drawn four times a frame — normals and depth, then
              light, then occlusion that keeps refining itself, then a single
              composite that owns every last decision about colour.
            </p>
          </div>

          <div className="bot">
            <div className="meta">
              <span>Deferred G&#8209;buffer · SSAO</span>
              <span>Temporal accumulation</span>
              <span>Procedural IBL · Lathed porcelain</span>
            </div>

            <div className="passes">
              <div className="passes-label">Render pass</div>
              <div className="chips">
                {PASSES.map((p) => (
                  <button
                    key={p.id}
                    className={p.id === mode ? 'chip on' : 'chip'}
                    onClick={() => setMode(p.id)}
                  >
                    {p.key}
                  </button>
                ))}
              </div>
              <div className="passes-note">{PASSES[mode].note}</div>
            </div>
          </div>
        </div>

        <div className="hint">Move — parallax&nbsp;&nbsp;·&nbsp;&nbsp;1–4 — inspect the pipeline</div>
      </div>
    </div>
  )
}
