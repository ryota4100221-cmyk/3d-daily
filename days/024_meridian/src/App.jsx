import { useState } from 'react'
import { Canvas } from '@react-three/fiber'
import * as THREE from 'three'
import Scene from './Scene.jsx'

export default function App() {
  const [sun, setSun] = useState({ label: 'Low sun', az: 14, el: 14 })

  return (
    <>
      <Canvas
        dpr={[1, 1.75]}
        gl={{
          antialias: false,
          alpha: false,
          powerPreference: 'high-performance',
          toneMapping: THREE.ACESFilmicToneMapping,
        }}
        camera={{ position: [0, 0.8, 9.0], fov: 42, near: 0.1, far: 90 }}
      >
        <Scene onSun={setSun} />
      </Canvas>

      <div className="overlay">
        <div className="hud-top">
          <div className="mark">3D&nbsp;Daily</div>
          <div className="day">Day&nbsp;024 · ★★★★★</div>
        </div>

        {/* time-of-day readout — the pointer moves the sun */}
        <div className="sun">
          <div className="sun-label">{sun.label}</div>
          <div className="sun-arc">
            <span className="tick">az {sun.az >= 0 ? '+' : ''}{sun.az}°</span>
            <span className="tick">el {sun.el}°</span>
          </div>
        </div>

        <div className="hud-title">
          <div className="eyebrow">Week 4 · Composition &amp; Polish</div>
          <h1>
            Meridian<em>.</em>
          </h1>
          <p>
            A month of parts, composed into one <em>place</em>. Real lights, a
            procedural studio, a relief&#8209;shaded ground, a field of
            porcelain monuments receding into haze, drifting motes &mdash; all
            bound by a custom depth&#8209;buffer atmosphere pass that paints the
            sky and folds near and far into a single volume of air. Move the
            cursor to <em>steer the sun</em>: the key light, the sky, the fog
            and the glow shift together, dawn&nbsp;→&nbsp;high&nbsp;morning.
          </p>
        </div>

        <div className="hud-hint">
          <span className="now">
            sun&nbsp;·&nbsp;<span className="k">{sun.label}</span>
          </span>
          <span>Move — <span className="k">steer the light</span></span>
        </div>
      </div>
    </>
  )
}
