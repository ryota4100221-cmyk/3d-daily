import { useState } from 'react'
import { Canvas } from '@react-three/fiber'
import * as THREE from 'three'
import Scene from './Scene.jsx'

export default function App() {
  const [focus, setFocus] = useState('mid')

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
        camera={{ position: [0, 0.55, 8.4], fov: 42, near: 0.1, far: 60 }}
      >
        <color attach="background" args={['#e7e1d5']} />
        <fog attach="fog" args={['#e7e1d5', 12, 30]} />
        <Scene onFocus={setFocus} />
      </Canvas>

      <div className="overlay">
        <div className="hud-top">
          <div className="mark">3D&nbsp;Daily</div>
          <div className="day">Day&nbsp;022 · ★★★★</div>
        </div>

        <div className="legend">
          <div className="row"><b>bloom</b> — HDR embers</div>
          <div className="row"><b>depth of field</b> — bokeh</div>
          <div className="row"><b>vignette</b> — frame</div>
          <div className="row"><b>grain</b> — film noise</div>
        </div>

        <div className="hud-title">
          <div className="eyebrow">Week 4 · Composition &amp; Polish</div>
          <h1>
            Aperture<em>.</em>
          </h1>
          <p>
            A quiet constellation of porcelain, receding into haze. Nothing new
            in the scene &mdash; the day lives in the <em>compositor</em>: an
            EffectComposer racks the frame through bloom, depth&#8209;of&#8209;field,
            vignette and film grain before it ever reaches the glass. A handful
            of terracotta embers burn past white and blossom in the HDR bloom.
            Move the cursor to <em>rack the focus</em> through the depth of the
            field &mdash; the sharp plane travels with you.
          </p>
        </div>

        <div className="hud-hint">
          <span className="now">
            focus&nbsp;·&nbsp;<span className="k">{focus}</span>
          </span>
          <span>Move — <span className="k">rack focus</span></span>
        </div>
      </div>
    </>
  )
}
