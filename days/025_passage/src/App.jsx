import { useState } from 'react'
import { Canvas } from '@react-three/fiber'
import * as THREE from 'three'
import Compositor from './Compositor.jsx'

export default function App() {
  const [hud, setHud] = useState({
    phase: 'load',
    name: 'Origin',
    type: 'noise dissolve',
    progress: 0,
    load: 0,
  })

  const loading = hud.phase === 'load'

  return (
    <>
      <Canvas
        dpr={[1, 1.75]}
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: 'high-performance',
          toneMapping: THREE.ACESFilmicToneMapping,
        }}
        camera={{ position: [0, 0.55, 6.4], fov: 40, near: 0.1, far: 60 }}
      >
        <Compositor onState={setHud} />
      </Canvas>

      {/* ---- choreographed loading curtain (designed, not asset-bound) ---- */}
      <div className={`loader ${loading ? '' : 'gone'}`}>
        <div className="loader-inner">
          <div className="loader-mark">3D&nbsp;Daily</div>
          <div className="loader-count">
            {String(hud.load).padStart(3, '0')}
            <span className="pct">%</span>
          </div>
          <div className="loader-label">Preparing&nbsp;passage</div>
          <div className="loader-bar">
            <span style={{ transform: `scaleX(${hud.load / 100})` }} />
          </div>
        </div>
      </div>

      {/* ---- overlay HUD ---- */}
      <div className="overlay">
        <div className="hud-top">
          <div className="mark">3D&nbsp;Daily</div>
          <div className="day">Day&nbsp;025 · ★★★★★</div>
        </div>

        {/* transition readout — the pointer directs the passage */}
        <div className="scene">
          <div className="scene-label">{hud.name}</div>
          <div className="scene-meta">
            <span className="tick">{hud.type}</span>
            <span className="tick">{String(hud.progress).padStart(2, '0')}%</span>
          </div>
        </div>

        <div className="hud-title">
          <div className="eyebrow">Week 4 · Composition &amp; Polish</div>
          <h1>
            Passage<em>.</em>
          </h1>
          <p>
            Not one scene but a <em>sequence</em>. Three porcelain chapters —
            Origin, Assembly, Ascent — each rendered into its own off&#8209;screen
            buffer, then cross&#8209;composited by a directed transition:
            a directional wipe, a noise dissolve, a radial iris, each carrying a
            seam of terracotta light along its front. It opens on a
            choreographed load, then turns its own pages. Move the cursor to
            <em> steer the seam</em> and scrub the passage between worlds.
          </p>
        </div>

        <div className="hud-hint">
          <span className="now">
            now&nbsp;·&nbsp;<span className="k">{hud.name}</span>
          </span>
          <span>Move — <span className="k">direct the passage</span></span>
        </div>
      </div>
    </>
  )
}
