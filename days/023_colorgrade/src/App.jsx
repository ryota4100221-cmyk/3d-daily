import { useState } from 'react'
import { Canvas } from '@react-three/fiber'
import * as THREE from 'three'
import Scene from './Scene.jsx'
import { WORLDS } from './GradeEffect.jsx'

export default function App() {
  const [grade, setGrade] = useState({ p: 1.0, idx: 1 })
  const span = WORLDS.length - 1
  const active = WORLDS[grade.idx] || WORLDS[1]

  return (
    <>
      <Canvas
        dpr={[1, 1.75]}
        gl={{
          antialias: false,
          alpha: false,
          powerPreference: 'high-performance',
          // NoToneMapping — the custom Grade effect performs the tone map itself.
          toneMapping: THREE.NoToneMapping,
        }}
        camera={{ position: [0, 0.6, 8.0], fov: 40, near: 0.1, far: 60 }}
      >
        <color attach="background" args={['#e7e1d5']} />
        <fog attach="fog" args={['#d8cebd', 9, 22]} />
        <Scene onGrade={setGrade} />
      </Canvas>

      <div className="overlay">
        <div className="hud-top">
          <div className="mark">3D&nbsp;Daily</div>
          <div className="day">Day&nbsp;023 · ★★★★</div>
        </div>

        {/* the three graded worlds — active one lit, others dimmed */}
        <div className="grades">
          {WORLDS.map((w, i) => (
            <div key={w.name} className={'grade-row' + (i === grade.idx ? ' on' : '')}>
              <span className="gname">{w.name}</span>
              <span className="gcap">{w.caption}</span>
            </div>
          ))}
          <div className="grade-track">
            <div className="grade-dot" style={{ left: `${(grade.p / span) * 100}%` }} />
          </div>
        </div>

        <div className="hud-title">
          <div className="eyebrow">Week 4 · Composition &amp; Polish</div>
          <h1>
            Chroma<em>.</em>
          </h1>
          <p>
            One neutral still life, three worlds. Nothing in the scene changes
            &mdash; the day lives in the <em>grade</em>. A custom color&#8209;grading
            pass owns the whole display transform: exposure, white balance, an
            ACES tone&#8209;map, lift/gamma/gain, saturation and split&#8209;toning,
            exactly the pipeline a creative LUT bakes down. Sweep the cursor
            left&nbsp;→&nbsp;right to <em>dissolve between grades</em> &mdash;
            clean bone, golden&nbsp;hour, cool nocturne.
          </p>
        </div>

        <div className="hud-hint">
          <span className="now">
            grade&nbsp;·&nbsp;<span className="k">{active.name}</span>
          </span>
          <span>Sweep — <span className="k">shift the world</span></span>
        </div>
      </div>
    </>
  )
}
